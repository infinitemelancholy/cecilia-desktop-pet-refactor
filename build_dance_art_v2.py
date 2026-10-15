"""Package authored transparent pose sheets and optically interpolated frames."""
import hashlib
import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image,ImageChops,ImageFilter
import imageio_ffmpeg

ROOT=Path(__file__).resolve().parent
CYCLE_MS=5894.7777777778
PLAY_MS=CYCLE_MS*2
FPS=144/(CYCLE_MS/1000)
SHEETS={
    ('classic','small-sway'):'art/outfits/classic/dance-v2/small-sway-keyposes.png',
    ('travel','small-sway'):'art/outfits/travel/dance-v2/small-sway-keyposes.png',
    ('cafe','small-sway'):'art/outfits/cafe/dance-v2/small-sway-keyposes.png',
    ('classic','tiptoe-clap'):'art/outfits/classic/dance-v2/tiptoe-clap-keyposes.png',
    ('travel','tiptoe-clap'):'art/outfits/travel/dance-v2/tiptoe-clap-keyposes.png',
    ('cafe','tiptoe-clap'):'art/outfits/cafe/dance-v2/tiptoe-clap-keyposes.png',
}


def frame_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def extract_grid(sheet_path,columns,rows,target=(192,208),fixed_scale=None):
    sheet=Image.open(sheet_path).convert('RGBA')
    if sheet.width%columns or sheet.height%rows:
        raise ValueError(f'{sheet_path} is not an exact {columns}x{rows} sprite grid')
    cw,ch=sheet.width//columns,sheet.height//rows
    if cw!=ch:raise ValueError(f'{sheet_path} grid cells must be square, got {cw}x{ch}')
    frames=[]
    for index in range(columns*rows):
        cell=sheet.crop(((index%columns)*cw,(index//columns)*ch,
                         (index%columns+1)*cw,(index//columns+1)*ch))
        alpha=cell.getchannel('A')
        core=alpha.point(lambda value:255 if value>192 else 0)
        edge=core.filter(ImageFilter.MaxFilter(5))
        cell.putalpha(ImageChops.multiply(alpha,edge))
        alpha=cell.getchannel('A')
        bbox=alpha.getbbox()
        if not bbox:raise ValueError(f'{sheet_path} has an empty cell {index}')
        # A single fixed scale/offset per complete sheet keeps the character stable
        # through every pose; the full cell is retained so no limbs are reframed.
        scale=fixed_scale or min(target[0]/cw,target[1]/ch)
        size=(round(cw*scale),round(ch*scale))
        cell=cell.resize(size,Image.Resampling.LANCZOS)
        canvas=Image.new('RGBA',target,(0,0,0,0))
        canvas.alpha_composite(cell,((target[0]-size[0])//2,(target[1]-size[1])//2))
        frames.append(canvas)
    return frames


def extract_op_strip(path):
    sheet=Image.open(path).convert('RGBA')
    if sheet.height!=208 or sheet.width%192:
        raise ValueError(f'Unexpected OP source strip size {sheet.size}')
    return [sheet.crop((i*192,0,(i+1)*192,208)) for i in range(sheet.width//192)]


def interpolate(frames,destination,input_fps):
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
    ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.TemporaryDirectory(prefix='cecilia-motion-v2-') as folder:
        source=Path(folder)/'in';source.mkdir()
        for index,frame in enumerate([*frames,frames[0],frames[1]]):
            frame.save(source/f'{index:03d}.png')
        pattern=str(source/'%03d.png')
        out_pattern=str(destination/'%03d.png')
        filter_arg=(f'minterpolate=fps={FPS:.9f}:mi_mode=mci:mc_mode=obmc:'
                    'me_mode=bidir:vsbmc=1')
        command=[ffmpeg,'-y','-loglevel','error','-framerate',f'{input_fps:.9f}',
            '-i',pattern,'-vf',filter_arg,'-frames:v','144','-fps_mode','vfr',
            '-c:v','png','-pix_fmt','rgba',out_pattern]
        result=subprocess.run(command,capture_output=True,text=True)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or 'FFmpeg motion interpolation failed')
    paths=sorted(destination.glob('*.png'))
    if len(paths)!=144:
        raise RuntimeError(f'Motion interpolation produced {len(paths)} frames, expected 144')
    first=Image.open(paths[0]);last=Image.open(paths[-1])
    if first.mode!='RGBA' or first.size!=(192,208) or last.mode!='RGBA' or last.size!=(192,208):
        raise RuntimeError('Interpolated frames must remain transparent 192x208 RGBA')
    hashes={frame_hash(path) for path in paths}
    if len(hashes)<116:
        raise RuntimeError(f'Only {len(hashes)}/144 distinct rendered frames; refusing low-FPS substitution')
    return paths,{'frames':len(paths),'distinctFrames':len(hashes),'inputFps':input_fps,
        'outputFps':FPS,'cycleMs':CYCLE_MS,'loopClosure':'Source frames 0 and 1 appended for the final optical-flow transition.'}


def pack_strip(paths,destination):
    sheet=Image.new('RGBA',(192*len(paths),208),(0,0,0,0))
    for i,path in enumerate(paths):
        with Image.open(path) as frame:sheet.alpha_composite(frame.convert('RGBA'),(192*i,0))
    sheet.save(destination,optimize=True)


def build_dances():
    sourcefps={}
    frames_by_key={}
    for (outfit,dance),relative in SHEETS.items():
        sheet_path=ROOT/relative
        frames_by_key[(outfit,dance)]=extract_grid(sheet_path,6,4)
        sourcefps[(outfit,dance)]=24/(CYCLE_MS/1000)
    for outfit in ('classic','travel','cafe'):
        op_path=ROOT/'art/runtime'/f'{outfit}-dance.png'
        frames_by_key[(outfit,'op-turn')]=extract_op_strip(op_path)
        original_cycle=4421.083333334835
        sourcefps[(outfit,'op-turn')]=108/((original_cycle/1000)/0.75)
    report={'version':2,'cycleMs':CYCLE_MS,'playMs':PLAY_MS,'outputFps':FPS,'dances':{}}
    runtime=ROOT/'art/runtime/v2';runtime.mkdir(parents=True,exist_ok=True)
    for outfit in ('classic','travel','cafe'):
        for dance in ('op-turn','small-sway','tiptoe-clap'):
            frames=frames_by_key[(outfit,dance)]
            outdir=runtime/outfit/dance
            paths,quality=interpolate(frames,outdir,sourcefps[(outfit,dance)])
            strip=runtime/f'{outfit}-{dance}.png';pack_strip(paths,strip)
            report['dances'][f'{outfit}/{dance}']={**quality,
                'keyframes':len(frames),'sourceStrip':SHEETS.get((outfit,dance),f'art/runtime/{outfit}-dance.png'),
                'runtimeStrip':strip.relative_to(ROOT).as_posix()}
    (runtime/'artwork-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf8')
    return report


def build_guest_atlas(guest):
    source=ROOT/'art/guests'/guest/'v2-motion-sheet.png'
    frames=extract_grid(source,4,3)
    runtime=ROOT/'art/runtime/v2';runtime.mkdir(parents=True,exist_ok=True)
    strip=runtime/f'{guest}-motion.png';sheet=Image.new('RGBA',(192*12,208),(0,0,0,0))
    for i,frame in enumerate(frames):sheet.alpha_composite(frame,(192*i,0))
    sheet.save(strip,optimize=True)
    return strip,frames


if __name__=='__main__':
    output=build_dances()
    output['guests']={}
    for guest in ('lawrence','hazelita'):
        strip,frames=build_guest_atlas(guest)
        output['guests'][guest]={'frames':len(frames),'strip':strip.relative_to(ROOT).as_posix(),
            'frameDurationMs':1000/12,'source':f'art/guests/{guest}/v2-motion-sheet.png'}
    (ROOT/'art/runtime/v2/artwork-report.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),'utf8')
    print(json.dumps({'dances':len(output['dances']),'guestLoops':len(output['guests']),
        'framesPerDance':144,'fps':FPS,'cycleMs':CYCLE_MS},ensure_ascii=False))
