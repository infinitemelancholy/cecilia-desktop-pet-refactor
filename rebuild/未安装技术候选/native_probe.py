"""Bounded native renderer measurements and reversible action fixtures."""
import os
import json
import sys
import time
from pathlib import Path

BASE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get('CECILIA_RUNTIME_ROOT',str(Path(__file__).resolve().parents[2])))
sys.path.insert(0,str(ROOT))
import native_transport as native

SETUP=r'''(()=>{
 if(window.__hdProbe)throw Error('A native probe is already active');
 const player=window.__ceciliaPlayer,original=CeciliaAnimation.Scheduler.prototype.tick;
 window.__hdProbe={state:player.snapshot(),original,action:null,elapsed:0,cycle:1};
 CeciliaAnimation.Scheduler.prototype.tick=function(elapsed,input){
   const value=original.call(this,elapsed,input),probe=window.__hdProbe;
 if(!probe?.action || !player.isLiveScheduler(this))return value;
   probe.elapsed+=elapsed;
   const a=probe.action;
   return {...value,mode:'daily',outfit:a.outfit,clip:a.kind==='dances'?'dance':a.name,
     danceId:a.kind==='dances'?a.name:null,duo:a.duo,
     elapsed:probe.elapsed%probe.cycle};
 };
 return window.__hdProbe.state;
})()'''
CLEANUP=r'''(()=>{const probe=window.__hdProbe;if(!probe)return;
 CeciliaAnimation.Scheduler.prototype.tick=probe.original;
 window.__ceciliaPlayer.restore(probe.state);delete window.__hdProbe;return true;})()'''


def client():
    connection=native.CDP(native.targets()[0]['webSocketDebuggerUrl'])
    connection.socket.settimeout(60)
    return connection


def select(connection,outfit,name,manifest):
    kind='dances' if name in manifest['outfits'][outfit]['dances'] else 'clips'
    clip=manifest['outfits'][outfit][kind][name]
    cycle=sum(f['duration'] for f in clip['frames'])/clip.get('playbackRate',1)
    spec={'outfit':outfit,'name':name,'kind':kind,'duo':name.startswith(('lawrence-','hazelita-'))}
    connection.evaluate('Object.assign(window.__hdProbe,{action:'+json.dumps(spec)+
        ',elapsed:0,cycle:'+str(cycle)+'});true;')
    return cycle


def measure(connection,duration_ms):
    script=r'''new Promise(resolve=>{const samples=[],began=performance.now();
      function sample(time){const s=__ceciliaPlayer.status();
        samples.push({t:time,draws:s.renderFrames,frame:s.frameIndex,
          loading:s.loadingAssets,ready:s.ready,bytes:s.decodedBytes,
          assetWait:s.assetWaitMs,layoutWait:s.layoutWaitMs});
        if(time-began<DURATION)requestAnimationFrame(sample);else{
          const first=samples[0],last=samples.at(-1),elapsed=last.t-first.t;
          const intervals=samples.slice(1).map((s,i)=>s.t-samples[i].t).sort((a,b)=>a-b);
          const draws=samples.filter((s,i)=>i===0||s.draws!==samples[i-1].draws);
          const drawIntervals=draws.slice(1).map((s,i)=>s.t-draws[i].t).sort((a,b)=>a-b);
          resolve({durationMs:elapsed,callbackFps:(samples.length-1)*1000/elapsed,
            rasterFps:(last.draws-first.draws)*1000/elapsed,
            callbackP95:intervals[Math.floor(intervals.length*.95)],
            drawIntervalP95:drawIntervals[Math.floor(drawIntervals.length*.95)],
            maxDrawInterval:Math.max(0,...drawIntervals),
            loadingSamples:samples.filter(s=>s.loading>0).length,
            notReadySamples:samples.filter(s=>!s.ready).length,
            maxDecodedBytes:Math.max(0,...samples.map(s=>s.bytes||0)),
            assetWaitMs:(last.assetWait||0)-(first.assetWait||0),
            layoutWaitMs:(last.layoutWait||0)-(first.layoutWait||0),
            status:__ceciliaPlayer.status()});
        }}requestAnimationFrame(sample);})'''.replace('DURATION',str(duration_ms))
    return connection.evaluate(script,await_promise=True)


if __name__=='__main__':
    manifest_path=Path(sys.argv[1])
    names=sys.argv[2].split(',')
    duration=float(sys.argv[3]) if len(sys.argv)>3 else 30
    output=BASE.parent/'outputs'/sys.argv[4] if len(sys.argv)>4 else BASE.parent/'outputs/native-performance.json'
    manifest=json.loads(manifest_path.read_text('utf8'))
    connection=client();results=[]
    try:
        connection.evaluate(SETUP)
        for action in names:
            outfit,name=action.split('/')
            cycle=select(connection,outfit,name,manifest)
            time.sleep(min(cycle/1000+.5,6))
            result=measure(connection,duration*1000)
            results.append(dict(outfit=outfit,action=name,**result))
            output.write_text(json.dumps(results,indent=2),'utf8')
            print(outfit,name,round(result['rasterFps'],2),'FPS',
                  result['loadingSamples'],'loading samples',flush=True)
    finally:
        connection.evaluate(CLEANUP);connection.close()
