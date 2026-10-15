"""Extension lifecycle over the existing strictly loopback pet transport."""
import json
import logging
from pathlib import Path
import time

from asset_bundle import load_bundle
from state_store import StateStore
from lazy_assets import LocalAssets

class ExtensionConnection:
    def __init__(self,transport,root,clock=time.monotonic):
        self.transport=transport
        self.root=Path(root)
        self.store=StateStore(self.root/'runtime/state.json')
        self.clock=clock
        self.last_checkpoint=float('-inf')
        self.last_state=None
        self.player_ready=False
        self.status={}
        self.rate_sample=None;self.rates={'callbackFps':0,'rasterFps':0}

    def install(self,bundle=None):
        try:
            config=dict(bundle) if bundle is not None else load_bundle(self.root,lazy=True)
            config['saved']=self.store.load()
            # Send separate assets instead of one 600MB+ expression. Every
            # decoded scene has its own texture lifetime in the renderer.
            lazy=any(source.startswith('local-png:') for source in config.get('assets',{}).values())
            if lazy:
                manifest=json.loads((self.root/'manifest.json').read_text('utf8'))
                self.asset_source=LocalAssets(self.root,manifest)
                self.asset_source.install(self.transport)
                sources={}
            else:sources=config.pop('assets',{})
            self.transport.evaluate('window.__ceciliaAssetSources=Object.create(null);true;')
            for name,source in sources.items():
                self.transport.evaluate('window.__ceciliaAssetSources['+json.dumps(name)+']='+json.dumps(source)+';true;')
            # Decode the complete animation bundle without running the gaze
            # watchdog. A first decode can exceed its five-second deadline.
            script='window.__ceciliaGaze?.stop();window.__ceciliaPresence?.stop();\n'
            modules=('scheduler.js','volume-mesh.js','gpu-compositor.js','renderer-player.js') if config.get('artwork',{}).get('renderMode')=='gpu-pose-flow-v1' else ('scheduler.js','renderer-player.js')
            script+='\n'.join((self.root/name).read_text('utf8') for name in modules)
            presence=(self.root/'renderer-presence.js').read_text('utf8')
            script+='\n(async()=>{const config='+json.dumps(config,ensure_ascii=False)+';'
            if not lazy:script+='config.assets=window.__ceciliaAssetSources;'
            script+='delete window.__ceciliaAssetSources;'
            script+='await CeciliaPlayer.install(config);\n'+presence+';\nreturn true;})()'
            socket=getattr(self.transport,'socket',None)
            previous_timeout=socket.gettimeout() if socket else None
            try:
                if socket:socket.settimeout(15)
                self.transport.evaluate(script,await_promise=True)
            finally:
                if socket:socket.settimeout(previous_timeout)
            self.player_ready=True
            logging.info('Local animation bundle attached to original pet')
            return True
        except (OSError,ValueError,KeyError,TypeError,RuntimeError) as error:
            self.player_ready=False
            logging.warning('Original pet retained: %s',error)
            self.transport.evaluate('window.__ceciliaPlayer?.stop();true;')
            if hasattr(self,'asset_source'):self.asset_source.close()
            return False

    def tick(self,point,visible):
        now=self.clock()
        checkpoint=now-self.last_checkpoint>=1
        flag='true' if visible else 'false'
        pulse=f'window.__ceciliaPresence?.pulse({flag});'
        script='(()=>{'+pulse+'return {alive:Boolean(window.__ceciliaPresence),'
        script+='status:window.__ceciliaPlayer?.status()||null,'
        script+=('state:window.__ceciliaPlayer?.snapshot()||null' if checkpoint else 'state:null')+'};})()'
        result=self.transport.evaluate(script) or {}
        self.status=result.get('status') or {'mode':'original','outfit':None}
        counters=(self.status.get('callbackFrames'),self.status.get('renderFrames'))
        if all(type(value) in (int,float) for value in counters):
            if self.rate_sample is None:self.rate_sample=(now,*counters)
            elif now-self.rate_sample[0]>=1:
                seconds=now-self.rate_sample[0]
                self.rates={'callbackFps':max(0,(counters[0]-self.rate_sample[1])/seconds),
                            'rasterFps':max(0,(counters[1]-self.rate_sample[2])/seconds)}
                self.rate_sample=(now,*counters)
            self.status.update(self.rates)
        if hasattr(self,'asset_source'):
            self.status.update(encodedCacheBytes=self.asset_source.cache_bytes,
                               assetCacheHits=self.asset_source.cache_hits,
                               assetDiskReads=self.asset_source.disk_reads)
        if checkpoint:
            self.last_checkpoint=now
            if result.get('state'):
                self.last_state=result['state'];self.store.save(self.last_state)
        # Presence can survive a compositor failure. Ask the helper to reconnect
        # rather than leaving a stopped installed player in native fallback.
        player=result.get('status')
        return bool(result.get('alive')) and (not self.player_ready or bool(player and not player.get('stopped')))

    def close(self):
        try:
            state=self.transport.evaluate('window.__ceciliaPlayer?.snapshot()||null')
            if isinstance(state,dict) and 'outfit' in state:self.store.save(state)
            elif self.last_state:self.store.save(self.last_state)
            self.transport.evaluate('window.__ceciliaPlayer?.stop();window.__ceciliaGaze?.stop();window.__ceciliaPresence?.stop();window.__ceciliaAssetRequests?.stop();true;')
        except (OSError,RuntimeError):
            if self.last_state:self.store.save(self.last_state)
        finally:self.transport.close()
        if hasattr(self,'asset_source'):self.asset_source.close()
