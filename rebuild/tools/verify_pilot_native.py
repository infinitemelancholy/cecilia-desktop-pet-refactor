"""Temporarily install only pilot assets; capture real desktop; restore in finally."""
import argparse,base64,importlib.util,json,os,shutil,subprocess,sys,time
from pathlib import Path
from PIL import Image,ImageGrab
import imageio_ffmpeg,win32gui
BASE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get('CECILIA_RUNTIME_ROOT',str(BASE.parents[1])))
C=Path(os.environ.get('CECILIA_PILOT_CANDIDATE',str(BASE.parent/'未安装技术候选'))) 
OUT=Path(os.environ.get('CECILIA_PILOT_OUTPUT',str(BASE.parent/'原画风格2.5D试作'))) 
parser=argparse.ArgumentParser();parser.add_argument('suffix',nargs='?',default='');parser.add_argument('actions',nargs='?')
parser.add_argument('--measure-seconds',type=float);parser.add_argument('--record-seconds',type=float,default=3)
args=parser.parse_args()
if args.measure_seconds is not None and not 3<=args.measure_seconds<=600:parser.error('Measurement must be 3–600 seconds')
if not 3<=args.record_seconds<=60:parser.error('Recording must be 3–60 seconds')
SUFFIX=args.suffix
BACKUP=OUT/('原生试作前备份'+SUFFIX);BACKUP.mkdir(exist_ok=True)
sys.dont_write_bytecode=True;sys.path.insert(0,str(ROOT))
import native_transport as native
spec=importlib.util.spec_from_file_location('fixed_probe',C/'native_probe.py')
probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
config=json.loads((OUT/'试作资源.json').read_text('utf8'))
from asset_bundle import check_clip
images={key:Image.open(C/path) for key,path in config['assets'].items()}
try:
    for name,clip in config['clips'].items():check_clip(clip,images,width=192)
finally:
    for image in images.values():image.close()
if any(c.get('review',{}).get('rejected') for c in config['clips'].values()):raise RuntimeError('Rejected visual content cannot be installed for pilot verification')
ACTIONS=args.actions.split(',') if args.actions else list(config['clips'])
if any(a not in config['clips'] for a in ACTIONS):raise ValueError('Unknown pilot action')
original=(ROOT/'manifest.json').read_bytes();manifest=json.loads(original)
backup=BACKUP/'manifest.json'
if backup.exists():raise RuntimeError('Pilot backup exists; inspect it before another run')
backup.write_bytes(original)
client=native.attach(native.targets()[0]);state=client.evaluate('__ceciliaPlayer.snapshot()');client.close()
(BACKUP/'native-state.json').write_text(json.dumps(state),'utf8')
created=[];results=[];client=None;module_originals={}
def helper(action):
    script='bridge.py' if action=='stop' else 'launch.py'
    args=['--stop'] if action=='stop' else ['helper']
    subprocess.run([sys.executable,'-B',str(ROOT/script),*args],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
def wait_ready():
    deadline=time.monotonic()+45
    while time.monotonic()<deadline:
        try:
            s=json.loads((ROOT/'runtime/status.json').read_text('utf8'))
            if s.get('mode')=='connected' and any(p.get('ready') for p in s.get('players',[])):return s
        except (OSError,ValueError):pass
        time.sleep(.2)
    raise RuntimeError('Native helper did not become ready')
try:
    helper('stop')
    for name in ('cel-timeline.js','renderer-player.js','connection.py','volume-mesh.js','gpu-compositor.js'):
        path=ROOT/name;module_originals[name]=path.read_bytes() if path.exists() else None
        if path.exists():shutil.copy2(path,BACKUP/name)
        shutil.copy2(C/name,path)
    for rel in config['assets'].values():
        dst=(ROOT/rel).resolve()
        if not dst.is_relative_to(ROOT.resolve()) or dst.exists():raise RuntimeError('Unsafe or existing pilot asset '+str(dst))
        dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(C/rel,dst);created.append(dst)
    manifest['assets'].update(config['assets']);manifest['assetMetadata'].update(config['assetMetadata'])
    for name,clip in config['clips'].items():manifest['outfits'][clip.get('outfit','travel')]['clips']['pilot-'+name]=clip
    (ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False),'utf8')
    helper('start');wait_ready()
    client=native.attach(native.targets()[0]);client.socket.settimeout(45);client.evaluate(probe.SETUP)
    window=native.NativePetWindow()
    exe=os.environ.get('CECILIA_CLIENT_EXECUTABLE')
    if not exe:
        client_info=ROOT/'installed-client.json'
        if not client_info.exists():raise RuntimeError('Set CECILIA_CLIENT_EXECUTABLE for this clone or provide installed-client.json locally')
        exe=json.loads(client_info.read_text('utf8'))['executable']
    window.bind_native_window(client,exe)
    for action in ACTIONS:
        outfit=config['clips'][action].get('outfit','travel')
        cycle=probe.select(client,outfit,'pilot-'+action,manifest);deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            s=client.evaluate('__ceciliaPlayer.status()')
            if s['ready'] and s['clip']=='pilot-'+action and s['loadingAssets']==0:break
            time.sleep(.1)
        else:raise RuntimeError('Pilot did not become ready')
        looping=bool(config['clips'][action].get('loop'))
        if not looping:client.evaluate('Object.assign(__hdProbe,{elapsed:0,cycle:1e12});true')
        duration=args.measure_seconds*1000 if args.measure_seconds is not None else max(3000,cycle*2)
        chunks=[];remaining=duration
        while remaining>0:
            chunk=probe.measure(client,min(20000,remaining));chunks.append(chunk);remaining-=min(20000,remaining)
            print(action,'measured',round(sum(c['durationMs'] for c in chunks)/1000,1),'s',flush=True)
        if len(chunks)==1:measurement=chunks[0]
        else:
            elapsed=sum(c['durationMs'] for c in chunks)
            measurement=dict(durationMs=elapsed,segments=chunks,status=chunks[-1]['status'],
              callbackFps=sum(c['callbackFps']*c['durationMs'] for c in chunks)/elapsed,
              rasterFps=sum(c['rasterFps']*c['durationMs'] for c in chunks)/elapsed,
              callbackP95=max(c['callbackP95'] for c in chunks),drawIntervalP95=max(c['drawIntervalP95'] for c in chunks),
              p95Method='maximum of segment percentiles, conservative bound',maxDrawInterval=max(c['maxDrawInterval'] for c in chunks),
              loadingSamples=sum(c['loadingSamples'] for c in chunks),notReadySamples=sum(c['notReadySamples'] for c in chunks),
              maxDecodedBytes=max(c['maxDecodedBytes'] for c in chunks),assetWaitMs=sum(c['assetWaitMs'] for c in chunks),layoutWaitMs=sum(c['layoutWaitMs'] for c in chunks))
        rect=client.evaluate('(()=>{const r=document.querySelector("[data-cecilia-extension]").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,dpr:devicePixelRatio}})()')
        origin=win32gui.ClientToScreen(window.hwnd,(0,0));dpr=rect['dpr']
        left=round(origin[0]+rect['x']*dpr);top=round(origin[1]+rect['y']*dpr)
        width=round(rect['w']*dpr);height=round(rect['h']*dpr)
        box=(left-12,top-12,left+width+12,top+height+12)
        size=(box[2]-box[0],box[3]-box[1]);size=(size[0]+size[0]%2,size[1]+size[1]%2)
        box=(box[0],box[1],box[0]+size[0],box[1]+size[1])
        # Start the recording from the actual first pose. A non-looping section
        # holds its end rather than fabricating a return-to-start transition.
        # Hold cel zero during encoder/capture setup. Starting the short action
        # before ImageGrab is ready can silently lose its first painted cels.
        client.evaluate('Object.assign(__hdProbe,{elapsed:0,cycle:1e-6});true')
        time.sleep(.04)
        encoder=subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24',
          '-s',f'{size[0]}x{size[1]}','-r','30','-i','-','-an','-c:v','libx264','-crf','18','-pix_fmt','yuv420p',str(OUT/('原生桌面-'+action+'.mp4'))],
          stdin=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
        timestamps=[];scheduler_indices=[];first_source_frame=None
        try:
            first_source_frame=client.evaluate('__ceciliaPlayer.status().frameIndex')
            if first_source_frame!=0:raise RuntimeError('Recording must begin with the first actual source cel')
            first_frame=ImageGrab.grab(bbox=box,all_screens=True).convert('RGB')
            encoder.stdin.write(first_frame.tobytes())
            client.evaluate('Object.assign(__hdProbe,{elapsed:0,cycle:'+str(cycle if looping else 1e12)+'});true')
            began=time.perf_counter();timestamps.append(0);scheduler_indices.append(first_source_frame)
            for i in range(1,round(args.record_seconds*30)):
                remaining=began+i/30-time.perf_counter()
                if remaining>0:time.sleep(remaining)
                scheduler_indices.append(client.evaluate('__ceciliaPlayer.status().frameIndex'))
                frame=ImageGrab.grab(bbox=box,all_screens=True).convert('RGB');timestamps.append(time.perf_counter()-began)
                encoder.stdin.write(frame.tobytes())
            encoder.stdin.close();error=encoder.stderr.read().decode('utf8',errors='replace');encoder.wait(timeout=10)
            if encoder.returncode:raise RuntimeError(error)
        finally:
            if encoder.poll() is None:encoder.terminate();encoder.wait(timeout=5)
        client.evaluate('Object.assign(__hdProbe,{elapsed:'+str(cycle*.5)+',cycle:1e12});true');time.sleep(.06)
        raw=client.evaluate('document.querySelector("[data-cecilia-extension]").toDataURL("image/png")')
        (OUT/('原生画布-'+action+'-中段.png')).write_bytes(base64.b64decode(raw.split(',')[1]))
        ImageGrab.grab(bbox=box,all_screens=True).save(OUT/('原生桌面-'+action+'-中段.png'))
        results.append(dict(action=action,outfit=outfit,cycleMs=cycle,looping=looping,measurement=measurement,captureFps=30,captureSeconds=args.record_seconds,captureTimestamps=timestamps,
          firstSourceFrame=first_source_frame,sourceClockStartedAfterFirstCapture=True,schedulerIndicesBeforeCapture=scheduler_indices,
          captureIndexScope='scheduler index before each screenshot; pixel capture may span a refresh boundary',desktopCrop=box,
          scope='whole actor seams/ghost outlines; pilot artwork and full animation quality remain under review'))
        print(action,'native pilot',round(measurement['rasterFps'],2),'draws/s',flush=True)
finally:
    if client:
        try:client.evaluate(probe.CLEANUP)
        finally:client.close()
    helper('stop');(ROOT/'manifest.json').write_bytes(original)
    for name,data in module_originals.items():
        if data is None:(ROOT/name).unlink(missing_ok=True)
        else:(ROOT/name).write_bytes(data)
    for path in created:
        if path.is_relative_to(ROOT.resolve()) and path.is_file():path.unlink()
    helper('start');wait_ready()
    restored=native.attach(native.targets()[0])
    try:
        restored.evaluate('__ceciliaPlayer.restore('+json.dumps(state)+');true')
        clean=restored.evaluate('({probeActive:!!window.__hdProbe,canvases:document.querySelectorAll("[data-cecilia-extension]").length,status:__ceciliaPlayer.status()})')
    finally:restored.close()
    restored_modules={n:((ROOT/n).read_bytes()==data if data is not None else not(ROOT/n).exists()) for n,data in module_originals.items()}
    record=dict(results=results,restoredManifest=(ROOT/'manifest.json').read_bytes()==original,restoredModules=restored_modules,remainingPilotFiles=[str(p) for p in created if p.exists()],cleanup=clean)
    (OUT/('原生试作验证'+SUFFIX+'.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2),'utf8')
    assert record['restoredManifest'] and all(restored_modules.values()) and not record['remainingPilotFiles'] and not clean['probeActive'] and clean['canvases']==1
    print('Original installed version (including nine dance calf fixes) restored; pilot files removed; native state restored.',flush=True)
