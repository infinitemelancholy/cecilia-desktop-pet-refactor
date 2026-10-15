"""Validate and embed a self-contained local PNG animation bundle."""
import base64
import copy
import hashlib
import json
import math
from collections import OrderedDict
from pathlib import Path

from PIL import Image

PET_ID='pet_6ac71429ba50819188d4388111562bbd'
OUTFITS=('classic','travel','cafe')
DANCES=('op-turn','small-sway','tiptoe-clap')
DAILY=('bean','pout','shy','hop','sleepy','lie','lump',
       'lawrence-care','lawrence-sleeve','hazelita-chat','hazelita-showcase')
BASE_CLIPS=('idle','showcase','running','waiting','failed','review',*DAILY)


class TextureCache:
    """Keep only nearby rasters decoded during chronological motion validation."""
    def __init__(self):
        self.images=OrderedDict()

    def crop(self,path,bounds):
        if path not in self.images:
            with Image.open(path) as image:
                self.images[path]=image.convert('RGBA')
            while len(self.images)>2:
                _,old=self.images.popitem(last=False);old.close()
        self.images.move_to_end(path)
        return self.images[path].crop(bounds)

    def close(self):
        for image in self.images.values():image.close()
        self.images.clear()


class ValidatedTexture:
    def __init__(self,path,size,cache):
        self.path=path;self.size=size;self.width,self.height=size;self.cache=cache

    def crop(self,bounds):
        return self.cache.crop(self.path,bounds)


def validate_dance(clip,cycle_ms=5894.7777777778):
    frames=clip.get('frames',[])
    durations=[frame.get('duration',0) for frame in frames]
    if clip.get('presentationFps') in (60,120):
        fps=clip['presentationFps']
        rate=clip.get('playbackRate',1)
        if type(rate) not in (int,float) or not math.isfinite(rate) or rate<=0:
            raise ValueError('Playback rate must be positive and finite')
        count=math.ceil(cycle_ms*fps/(1000*rate)-1e-8)
        if len(frames)!=count or any(type(d) not in (int,float) or not math.isfinite(d) or d<=0 for d in durations):
            raise ValueError(f'Presentation frames must match the complete {fps} Hz playback cycle')
        if abs(sum(durations)-cycle_ms)>.1 or clip.get('loop')!=[0,count]:
            raise ValueError('Presentation samples must retain a complete source cycle')
        if max(durations)/rate>1000/(fps-.1):
            raise ValueError(f'Presentation samples must support a {fps} Hz display')
        return
    samples=clip.get('temporalSamplesPerFrame',1)
    if type(samples)!=int or not 1<=samples<=8:
        raise ValueError('Temporal sample count must be a positive integer up to eight')
    if len(frames)!=round(cycle_ms*60/1000)*samples or any(not isinstance(d,(int,float)) or not math.isfinite(d) or d<=0 for d in durations):
        raise ValueError('Each dance must contain a complete 60 fps cycle with positive frame durations')
    total=sum(durations)
    if abs(total-cycle_ms)>0.1:
        raise ValueError('A dance cycle must last 5.895 seconds')
    if clip.get('loop')!=[0,len(frames)]:
        raise ValueError('Each dance must loop across the full cycle')
    if len(frames)*1000/total<59.9 or max(durations)>1000/59.9+0.1:
        raise ValueError('Dance needs at least 60 rendered frames per second')
    if samples>1:
        rate=clip.get('playbackRate',1)
        if type(rate) not in (int,float) or not math.isfinite(rate) or rate<=0 or max(durations)/rate>1000/59.9:
            raise ValueError('Interpolated dance samples must support a 60 Hz display at the actual playback rate')


def validate_limb_mask(mask):
    if not isinstance(mask,dict):raise ValueError('Limb mask must contain a polygon and vertical bounds')
    polygon=mask.get('polygon',[]);bounds=mask.get('yBounds',[])
    if (not isinstance(polygon,list) or not 3<=len(polygon)<=10
            or any(not isinstance(p,list) or len(p)!=2 for p in polygon)):
        raise ValueError('Limb mask polygon needs three to ten coordinate pairs')
    if not isinstance(bounds,list) or len(bounds)!=2:
        raise ValueError('Limb mask needs two vertical bounds')
    values=[v for p in polygon for v in p]+bounds
    if any(type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=1 for v in values) or bounds[0]>bounds[1]:
        raise ValueError('Limb mask coordinates must be finite normalized values with ordered bounds')


def check_clip(clip,images,width=192,look=False):
    frames=clip.get('frames',[])
    if not frames or (look and len(frames)!=16):
        raise ValueError('Clip needs complete frames; gaze needs all 16 directions')
    for frame in frames:
        duration=frame.get('duration',0)
        if not isinstance(duration,(int,float)) or not math.isfinite(duration) or duration<=0:
            raise ValueError('Each frame needs a positive duration')
        if not frame.get('layers'):
            raise ValueError('Empty animation frame')
        for layer in frame['layers']:
            opacity=layer.get('opacity',1)
            if type(opacity) not in (int,float) or not math.isfinite(opacity) or not 0<=opacity<=1:
                raise ValueError('Layer opacity must be between zero and one')
            image=images.get(layer.get('asset'))
            if image is None:raise ValueError('Frame references an unavailable PNG')
            source=layer.get('source',[]);target=layer.get('target',[])
            if len(source)!=4 or len(target)!=4 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in source+target):
                raise ValueError('Source and destination bounds must contain four finite coordinates')
            x,y,w,h=source;dx,dy,dw,dh=target
            if x<0 or y<0 or w<=0 or h<=0 or x+w>image.width or y+h>image.height:
                raise ValueError('Frame source bounds are outside its PNG')
            if dx<0 or dy<0 or dw<=0 or dh<=0 or dx+dw>width or dy+dh>208:
                raise ValueError('Frame destination would be clipped')
            matrix=layer.get('matrix')
            if matrix is not None and (len(matrix)!=6 or any(type(v) not in (int,float) or not math.isfinite(v) for v in matrix)):
                raise ValueError('Bone transform must have six finite coordinates')
            if 'partMask' in layer:validate_limb_mask(layer['partMask'])
            if layer.get('face') and layer['face'].get('asset') not in images:
                raise ValueError('Shared face references an unavailable PNG')
            motion=layer.get('motion')
            if motion:
                flow=images.get(motion.get('asset'))
                if flow is None:raise ValueError('GPU motion references an unavailable flow atlas')
                if not 0<=motion.get('time',-1)<=1 or not 0<=motion.get('anchorMix',-1)<=1:
                    raise ValueError('GPU motion sample must remain in its authored interval')
                for bounds in (motion['flowFirst'],motion['flowSecond']):
                    x,y,w,h=bounds
                    if min(x,y)<0 or min(w,h)<=0 or x+w>flow.width or y+h>flow.height:
                        raise ValueError('GPU flow bounds are outside their atlas')
    if 'loop' in clip:
        start,end=clip['loop']
        if not isinstance(start,int) or not isinstance(end,int) or not 0<=start<end<=len(frames):
            raise ValueError('Invalid animation loop range')


def validate_authored_motion(clip,images):
    """Ensure dance cycles use distinct generated/interpolated transparent poses."""
    frames=clip['frames'];start,end=clip.get('loop',[0,len(frames)])
    if clip.get('motionModel') in ('authored-multiview-depth25-v3','registered-occlusion-depth25-v4'):
        samples=frames[start:end]
        geometry=[json.dumps([{k:l.get(k) for k in ('source','motion','volume')} for l in f['layers']],sort_keys=True) for f in samples]
        poses={(l['asset'],tuple(l['source'])) for f in samples for l in f['layers']}
        distinct=len(set(geometry))
        if len(poses)<4 or distinct<math.ceil(len(samples)*.8):
            raise ValueError('Multiview dance needs distinct painted poses and advancing GPU geometry')
        return {'renderedFrames':len(samples),'distinctGeometrySamples':distinct,'distinctPaintedPoses':len(poses),
                'limitation':'GPU geometry is auxiliary evidence; inspect complete normal-size animation and source-switch continuity.'}
    if clip.get('motionModel') in ('continuous-painted-surface-v1','canonical-painted-depth25-v5'):
        samples=[json.dumps([{k:l.get(k) for k in ('skeleton','matrix','volume','motion')} for l in f['layers']],sort_keys=True) for f in frames[start:end]]
        unique=len(set(samples))
        if unique<math.ceil(len(samples)*.8):raise ValueError('Surface animation must contain distinct continuous geometry samples')
        return {'renderedFrames':len(samples),'distinctGeometrySamples':unique,
                'limitation':'Geometry sampling is auxiliary evidence; verify actual GPU pixels and desktop timing separately.'}
    fingerprints=[]
    for frame in frames[start:end]:
        canvas=Image.new('RGBA',(192,208))
        for layer in frame['layers']:
            x,y,w,h=layer['source'];dx,dy,dw,dh=layer['target']
            crop=images[layer['asset']].crop((x,y,x+w,y+h)).resize(
                (max(1,round(dw)),max(1,round(dh))),Image.Resampling.LANCZOS)
            opacity=layer.get('opacity',1)
            if opacity!=1:crop.putalpha(crop.getchannel('A').point(lambda a:round(a*opacity)))
            canvas.alpha_composite(crop,(round(dx),round(dy)))
        fingerprints.append(hashlib.sha256(canvas.tobytes()).digest())
    unique=len(set(fingerprints))
    if unique<math.ceil(len(fingerprints)*.8):
        raise ValueError('Dance needs distinct motion frames, not repeated low-FPS images')
    return {'renderedFrames':len(fingerprints),'distinctRasterFrames':unique,
            'limitation':'Raster uniqueness does not prove smooth limb motion; inspect the normal-size animation.'}


def load_bundle(root,require_ready=True,lazy=False):
    root=Path(root).resolve()
    manifest=json.loads((root/'manifest.json').read_text('utf8'))
    if manifest.get('version')!=2 or manifest.get('petId')!=PET_ID:
        raise ValueError('Bundle version or pet identity does not match')
    if require_ready and manifest.get('ready') is not True:
        raise ValueError('Animation art is not ready; retain the original pet')
    if require_ready and set(manifest.get('outfits',{}))!=set(OUTFITS):
        raise ValueError('Complete bundle needs classic, travel, cafe outfits')
    result=copy.deepcopy(manifest);images={};embedded={};cache=TextureCache()
    for name,relative in manifest.get('assets',{}).items():
        path=(root/relative).resolve()
        if not path.is_relative_to(root):raise ValueError('Asset path is outside the bundle')
        try:
            raw=None if lazy else path.read_bytes()
            with Image.open(path) as image:
                if image.format not in ('PNG','WEBP') or image.mode!='RGBA':raise ValueError('Asset must be an RGBA animation image')
                if not lazy:image.load()
                images[name]=ValidatedTexture(path,image.size,cache)
        except (OSError,ValueError) as error:
            raise ValueError(f'Unreadable RGBA PNG: {relative}') from error
        mime='image/webp' if path.suffix.lower()=='.webp' else 'image/png'
        embedded[name]=('local-png:'+name if lazy else 'data:'+mime+';base64,'+base64.b64encode(raw).decode('ascii'))
    if require_ready:
        schedule=manifest.get('schedule',{})
        interlude=schedule.get('interludeMs')
        if (type(interlude) not in (int,float) or not math.isfinite(interlude) or interlude<=0
            or schedule.get('outfitInterval')!=[300000,600000]
            or abs(schedule.get('danceMs',0)-11789.5555555556)>0.1
            or abs(schedule.get('danceCycleMs',0)-5894.7777777778)>0.1):
            raise ValueError('Schedule needs complete dance clocks, a positive interlude and valid outfit interval')
        for outfit in OUTFITS:
            data=manifest['outfits'][outfit];clips=data.get('clips',{});dances=data.get('dances',{})
            native_atlas=images.get(data.get('nativeAtlas'))
            if native_atlas is None or native_atlas.size!=(1536,2288):
                raise ValueError(f'{outfit} needs a complete native v2 atlas for click and drag')
            missing=set(BASE_CLIPS)-set(clips)
            if missing:raise ValueError(f'{outfit} is missing {sorted(missing)}')
            if set(dances)!=set(DANCES):
                raise ValueError(f'{outfit} needs OP, small-sway and tiptoe-clap dances')
            check_clip(data.get('look',{}),images,look=True)
            for dance_id,clip in dances.items():
                cycle=schedule.get('danceCyclesMs',{}).get(dance_id,schedule['danceCycleMs'])
                play=schedule.get('danceDurationsMs',{}).get(dance_id,schedule['danceMs'])
                if abs(play-cycle*2)>.1 or abs(clip.get('cycleMs',cycle)-cycle)>.1:
                    raise ValueError('Each dance needs its own complete two-cycle duration')
                validate_dance(clip,cycle)
                # Full raster QA runs at build/install time. Runtime checks all
                # geometry and PNG headers, then decodes only requested chunks.
                if not lazy:validate_authored_motion(clip,images)
                for frame in clip['frames']:check_clip({'frames':[frame]},images)
            for name,clip in clips.items():
                check_clip(clip,images,width=384 if name.startswith(('lawrence-','hazelita-')) else 192)
            if not data.get('officialSource'):
                raise ValueError(f'{outfit} has no recorded official clothing source')
    cache.close()
    result['assets']=embedded
    return result


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('root',nargs='?',default=Path(__file__).parent)
    args=parser.parse_args()
    try:
        bundle=load_bundle(args.root)
        print(json.dumps({'valid':True,'petId':bundle['petId'],'outfits':list(bundle['outfits']),
                          'dances':list(bundle['outfits']['classic']['dances'])}))
    except (OSError,ValueError,KeyError,TypeError) as error:
        print(json.dumps({'valid':False,'error':str(error)},ensure_ascii=False));raise SystemExit(1)
