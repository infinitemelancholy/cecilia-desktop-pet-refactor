"""Build the v2 manifest from reviewed local RGBA sprites and pose atlases."""
import argparse
import json
from pathlib import Path

from PIL import Image

from asset_bundle import DANCES,OUTFITS,PET_ID

ROOT=Path(__file__).resolve().parent
Q=('bean','pout','shy','hop','sleepy','lie','lump')
DAILY_MS=dict(zip(Q,(3000,2800,3200,2500,4000,4500,3500)))
DUO=('lawrence-care','lawrence-sleeve','hazelita-chat','hazelita-showcase')
DUO_MS=8000
CYCLE_MS=5894.7777777778
PLAY_MS=CYCLE_MS*2
FRAME_MS=CYCLE_MS/144
SOURCES={
    'op-turn':'https://shiroseijyo-anime.com/movie/',
    'small-sway':'Original chibi choreography, designed for this desktop pet.',
    'tiptoe-clap':'Original chibi choreography, designed for this desktop pet.',
}
OFFICIAL_CLOTHES={
    'classic':'https://shiroseijyo-anime.com/character/',
    'travel':'https://shiroseijyo-anime.com/story/?id=05',
    'cafe':'https://shiroseijyo-anime.com/story/?id=06',
}


def build(ready=False):
    assets={};outfits={}
    def asset(path):
        path=Path(path).resolve()
        if not path.is_relative_to(ROOT):raise ValueError('Asset path leaves the pet directory')
        rel=path.relative_to(ROOT).as_posix();key=rel.replace('/','_').replace('.png','')
        assets[key]=rel;return key
    def layer(key,frame,width=192):
        return {'asset':key,'source':[frame*192,0,192,208],
                'target':[width-192,0,192,208]}
    def frame_at(frames,elapsed):
        return frames[min(len(frames)-1,max(0,int(elapsed/(FRAME_MS if frames is not None else 1))))]
    def atlas_layers(key,row,count):
        return [{'asset':key,'source':[i*192,row*208,192,208],'target':[0,0,192,208]} for i in range(count)]
    def single_clip(layers,duration,weights=None,loop=None):
        if weights is None:weights=[duration/len(layers)]*len(layers)
        result={'frames':[{'duration':ms,'layers':[item.copy()]} for item,ms in zip(layers,weights)]}
        if loop is not None:result['loop']=loop
        return result
    def numeric(folder,count):return [folder/f'{i:02d}.png' for i in range(count)]
    def pack(paths,name):
        images=[Image.open(path).convert('RGBA') for path in paths]
        size=images[0].size
        if any(image.size!=size for image in images):raise ValueError(f'{name} pose size mismatch')
        sheet=Image.new('RGBA',(size[0]*len(images),size[1]),(0,0,0,0))
        for index,image in enumerate(images):sheet.alpha_composite(image,(size[0]*index,0))
        path=ROOT/'art/runtime/v2'/f'{name}.png';path.parent.mkdir(parents=True,exist_ok=True)
        sheet.save(path,optimize=True)
        key=asset(path)
        return [{'asset':key,'source':[i*size[0],0,size[0],size[1]],'target':[0,0,size[0],size[1]]} for i in range(len(images))]
    def strip_layers(path,key):
        if not path.exists():raise ValueError(f'Missing compiled art: {path}')
        return [{'asset':asset(path),'source':[i*192,0,192,208],'target':[0,0,192,208]}
            for i in range(144)]
    def duo_frame(cecilia,guest,guest_x=192,guest_opacity=1):
        a=cecilia.copy();b=guest.copy();b['target']=[guest_x,0,192,208]
        if guest_opacity!=1:b['opacity']=max(0,min(1,guest_opacity))
        return {'duration':DUO_MS/96,'layers':[a,b]}

    scene_durations={**DAILY_MS,**{name:DUO_MS for name in DUO}}
    schedule={'danceMs':PLAY_MS,'danceCycleMs':CYCLE_MS,'interludeMs':15000,
        'showcaseMs':2400,'recoveryMs':1200,'outfitInterval':[300000,600000],
        'sceneDurations':scene_durations,'duoScenes':list(DUO),
        'danceIds':list(DANCES),'maxDanceRun':2,'renderedFps':144/(CYCLE_MS/1000)}

    for outfit in OUTFITS:
        base=ROOT/'art/outfits'/outfit
        native=asset(ROOT/'references/current-pet.png' if outfit=='classic' else base/'spritesheet-v2.png')
        clips={};poses={}
        for name,row,count,ms in [('idle',0,6,180),('failed',5,8,170),('waiting',6,6,200),
            ('running',7,6,180),('review',8,6,200)]:
            layers=atlas_layers(native,row,count)
            clips[name]=single_clip(layers,count*ms,loop=[0,len(layers)])
        look={'frames':[{'duration':100,'layers':[item]} for row in (9,10) for item in atlas_layers(native,row,8)]}
        for name in Q:
            folder=base/name
            if name=='lie' and (base/'lie-compact').exists():folder=base/'lie-compact'
            layers=pack(numeric(folder,6),f'{outfit}-{name}-v2');poses[name]=layers
            sequence=[0,1,2,3,4,0] if name in ('shy','sleepy','lump') else list(range(6))
            weights=[.12,.12,.2,.3,.14,.12]
            clips[name]={'frames':[{'duration':DAILY_MS[name]*weight,'layers':[layers[index]]}
                for index,weight in zip(sequence,weights)]}

        dance_clips={}
        for dance in DANCES:
            strip=ROOT/'art/runtime/v2'/f'{outfit}-{dance}.png'
            key=asset(strip)
            frames=[{'duration':FRAME_MS,'layers':[{'asset':key,'source':[i*192,0,192,208],
                'target':[0,0,192,208]}]} for i in range(144)]
            dance_clips[dance]={'frames':frames,'loop':[0,144],
                'cycleMs':CYCLE_MS,'playDurationMs':PLAY_MS,'authoredKeyframes':108 if dance=='op-turn' else 24,
                'source':SOURCES[dance]}

        showcase_paths=strip_layers(ROOT/'art/runtime/v2'/f'{outfit}-op-turn.png',outfit+'-op-showcase')
        # A short clothes turn sampled from the authored OP set; no body redraw occurs here.
        showcase=[showcase_paths[index] for index in range(48,63)]
        clips['showcase']=single_clip(showcase,2400,loop=None)

        guests={}
        for guest in ('lawrence','hazelita'):
            strip=ROOT/'art/runtime/v2'/f'{guest}-motion.png'
            key=asset(strip)
            guests[guest]=[{'asset':key,'source':[i*192,0,192,208],
                'target':[192,0,192,208]} for i in range(12)]

        # Three scenes use a continuous 12-frame guest loop underneath Cecilia's
        # independently changing idle/shy/showcase pose. Enter/exit uses opacity.
        for scene in ('lawrence-care','hazelita-chat','hazelita-showcase'):
            guest='lawrence' if scene=='lawrence-care' else 'hazelita'
            frames=[]
            for n in range(96):
                t=n*DUO_MS/96;guest_frame=guests[guest][n%12]
                opacity=min(1,t/500,(DUO_MS-t)/500)
                if scene=='lawrence-care':
                    ceci=clips['idle']['frames'][0]['layers'][0] if t<1200 or t>5900 else poses['shy'][min(4,1+int((t-1200)/900))]
                elif scene=='hazelita-chat':
                    ceci=clips['idle']['frames'][0]['layers'][0] if t<1100 or t>6300 else poses['shy'][2+int((t-1100)/1200)%2]
                elif t<1500 or t>6500:
                    ceci=clips['idle']['frames'][0]['layers'][0]
                else:
                    index=min(len(showcase)-1,int((t-1500)/(6500-1500)*len(showcase)))
                    ceci=showcase[index]
                frames.append(duo_frame(ceci,guest_frame,guest_opacity=opacity))
            clips[scene]={'frames':frames}

        # Sleeve-pull preserves the generated hands-on-cuff paired poses and
        # advances through them at least once every 1.2 seconds.
        sleeve_layers=pack(numeric(ROOT/'art/scenes'/outfit/'sleeve-tug/anchored-left',6),f'{outfit}-sleeve-v2')
        timeline=[(0,0),(700,0),(1300,1),(2000,2),(2700,3),(3900,3),(4700,4),(5900,5)]
        frames=[]
        for n in range(96):
            t=n*DUO_MS/96
            index=next((idx for start,idx in reversed(timeline) if t>=start),0)
            pair=sleeve_layers[index].copy();fade=min(1,t/250,(DUO_MS-t)/400)
            pair['opacity']=max(0,fade)
            neutral=clips['idle']['frames'][0]['layers'][0].copy()
            frames.append({'duration':DUO_MS/96,'layers':[neutral,pair]})
        clips['lawrence-sleeve']={'frames':frames}

        outfits[outfit]={'nativeAtlas':native,'officialSource':OFFICIAL_CLOTHES[outfit],
            'look':look,'clips':clips,'dances':dance_clips}

    manifest={'version':2,'ready':False,'petId':PET_ID,'assets':assets,'schedule':schedule,
        'outfits':outfits,'danceCatalog':{
          'op-turn':{'label':'OP 转身举手舞','origin':'official OP, slowed to 75% and optically interpolated to 144 frames'},
          'small-sway':{'label':'小手摇摆舞','origin':'original chibi choreography'},
          'tiptoe-clap':{'label':'踮脚拍手舞','origin':'original chibi choreography'}},
        'artwork':{'version':2,'cycleMs':CYCLE_MS,'framesPerDance':144,
          'sourceReport':'art/runtime/v2/artwork-report.json','interpolation':'FFmpeg minterpolate, RGBA output'},
    }
    path=ROOT/'manifest.json';path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),'utf8')
    if ready:
        from asset_bundle import load_bundle
        manifest['ready']=True;path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),'utf8')
        try:load_bundle(ROOT)
        except Exception:
            manifest['ready']=False;path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),'utf8');raise
    print(json.dumps({'ready':ready,'outfits':len(outfits),'dancesPerOutfit':len(DANCES),
        'duoScenes':list(DUO),'assets':len(assets)},ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--ready',action='store_true')
    build(parser.parse_args().ready)
