"""Loopback-renderer lifecycle tests; the transport is the external boundary."""
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
try:from connection import ExtensionConnection
except ImportError:ExtensionConnection=None

class Transport:
    def __init__(self):self.scripts=[];self.response={'alive':True,'state':None};self.closed=False
    def evaluate(self,script,await_promise=False):
        self.scripts.append((script,await_promise));return self.response
    def close(self):self.closed=True

class ConnectionTest(unittest.TestCase):
    def test_hybrid_install_loads_the_gpu_dependencies_in_a_fresh_renderer(self):
        for name in ('volume-mesh.js','gpu-compositor.js'):
            (self.root/name).write_text((ROOT/name).read_text('utf8'),'utf8')
        c=self.connection()
        self.assertTrue(c.install({'version':2,'artwork':{'renderMode':'gpu-pose-flow-v1','model':'complete-torso-detached-limbs-v2'}}))
        script=self.transport.scripts[-1][0]
        harness=r'''
const vm=require('node:vm'),fs=require('node:fs');
const context={CeciliaPlayer:{install:async()=>{}},performance:{now:()=>0},
document:{querySelector:()=>null,addEventListener(){},removeEventListener(){}},
MessageEvent:class{},PointerEvent:class{},dispatchEvent(){},
setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}};
context.window=context;
Promise.resolve(vm.runInNewContext(fs.readFileSync(0,'utf8'),context)).then(()=>{
  if(!context.CeciliaGPU || !context.CeciliaVolume)throw Error('Missing fresh GPU dependencies');
  process.stdout.write('fresh GPU dependencies loaded');
}).catch(error=>{console.error(error);process.exitCode=1});
'''
        result=subprocess.run(['node','-e',harness],input=script,text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('fresh GPU dependencies loaded',result.stdout)

    def test_status_reports_wall_clock_callback_and_raster_rates_separately(self):
        c=self.connection()
        self.transport.response={'alive':True,'status':{'renderFrames':10,'callbackFrames':20},'state':None}
        c.tick(None,True)
        self.clock[0]=2
        self.transport.response={'alive':True,'status':{'renderFrames':250,'callbackFrames':350},'state':None}
        c.tick(None,True)
        self.assertEqual(c.status.get('rasterFps'),120)
        self.assertEqual(c.status.get('callbackFps'),165)

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        for name in ('scheduler.js','renderer-player.js'):(self.root/name).write_text('//fixture','utf8')
        (self.root/'renderer-presence.js').write_text((ROOT/'renderer-presence.js').read_text('utf8'),'utf8')
        self.clock=[0];self.transport=Transport()
    def connection(self):
        self.assertIsNotNone(ExtensionConnection,'extension lifecycle must be implemented')
        return ExtensionConnection(self.transport,self.root,clock=lambda:self.clock[0])
    def test_missing_art_keeps_the_original_gaze_without_replacing_it(self):
        c=self.connection()
        with patch('connection.load_bundle',side_effect=ValueError('art pending')):
            self.assertFalse(c.install())
        self.assertFalse(any('CeciliaPlayer.install' in s for s,_ in self.transport.scripts))
        self.assertTrue(c.tick((10,20),True))
    def test_install_awaits_asset_decode_and_restores_checkpoint(self):
        c=self.connection()
        with patch('connection.load_bundle',return_value={'version':1}),patch.object(c.store,'load',return_value={'outfit':'cafe'}):
            self.assertTrue(c.install())
        script,wait=self.transport.scripts[-1]
        self.assertTrue(wait);self.assertIn('"outfit": "cafe"',script)
        self.assertIn('await CeciliaPlayer.install',script)
    def test_large_animation_assets_are_transferred_individually(self):
        c=self.connection()
        bundle={'version':2,'assets':{str(i):'data:image/png;base64,'+'a'*60000 for i in range(3)}}
        self.assertTrue(c.install(bundle))
        self.assertLess(max(len(s) for s,_ in self.transport.scripts),100000,
                        'dense animation must not become one oversized renderer expression')
    def test_full_art_install_has_a_bounded_longer_transport_deadline(self):
        class Socket:
            def __init__(self):self.timeout=2;self.changes=[]
            def gettimeout(self):return self.timeout
            def settimeout(self,value):self.timeout=value;self.changes.append(value)
        self.transport.socket=Socket()
        previous=self.transport.evaluate
        def decode(script,await_promise=False):
            if await_promise:self.assertEqual(self.transport.socket.timeout,15)
            return previous(script,await_promise)
        self.transport.evaluate=decode
        c=self.connection()
        with patch('connection.load_bundle',return_value={'version':1}):self.assertTrue(c.install())
        self.assertEqual(self.transport.socket.timeout,2)
        self.assertEqual(self.transport.socket.changes,[15,2])
    def test_hidden_window_keeps_heartbeat_but_pauses_visible_clock(self):
        c=self.connection();c.tick(None,False)
        script,_=self.transport.scripts[-1]
        self.assertIn('.pulse(false)',script)
        self.assertNotIn('.update(',script)
    def test_installed_player_loss_requires_reconnection_even_when_presence_is_alive(self):
        c=self.connection();self.assertTrue(c.install({'version':2}))
        self.transport.response={'alive':True,'status':None,'state':None}
        self.assertFalse(c.tick(None,True))
    def test_stopped_player_requires_reconnection_even_when_presence_is_alive(self):
        c=self.connection();self.assertTrue(c.install({'version':2}))
        self.transport.response={'alive':True,'status':{'stopped':True},'state':None}
        self.assertFalse(c.tick(None,True))
    def test_slow_asset_decode_keeps_gaze_alive_for_the_first_real_heartbeat(self):
        c=self.connection();self.assertTrue(c.install({'version':2}))
        script,_=self.transport.scripts[-1]
        # Execute the real generated installation and gaze wrapper; only the
        # external browser clock, DOM and image decoding boundary are simulated.
        harness=r'''
const vm=require('node:vm'),fs=require('node:fs');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
let clock=0,serial=0;const timers=new Map(),pulses=[];
globalThis.window=globalThis;
Object.defineProperty(globalThis,'performance',{value:{now:()=>clock}});
globalThis.setInterval=fn=>{timers.set(++serial,fn);return serial};
globalThis.clearInterval=id=>timers.delete(id);
globalThis.document={title:'Pet',body:{},querySelector:()=>null,
    addEventListener(){},removeEventListener(){}};
globalThis.PointerEvent=class{};globalThis.MessageEvent=class{};
globalThis.dispatchEvent=()=>{};
globalThis.CeciliaPlayer={install:async()=>{
    clock+=6000;
    for(const timer of [...timers.values()])timer();
    window.__ceciliaPlayer={pulse:v=>pulses.push(v)};
}};
vm.runInThisContext(input.gaze);
Promise.resolve(vm.runInThisContext(input.install)).then(()=>{
    window.__ceciliaPresence?.pulse(true);
    process.stdout.write(JSON.stringify({alive:!!window.__ceciliaPresence,
        timers:timers.size,pulses}));
}).catch(error=>{console.error(error);process.exitCode=1});
'''
        process=subprocess.run(['node','-e',harness],input=json.dumps({
            'gaze':(ROOT/'renderer-presence.js').read_text('utf8'),'install':script}),
            text=True,capture_output=True,check=True)
        self.assertEqual(json.loads(process.stdout),{'alive':True,'timers':1,'pulses':[True]})
    def test_checkpoints_are_throttled_and_stop_removes_both_extensions(self):
        c=self.connection();self.transport.response={'alive':True,'state':{'version':1}}
        with patch.object(c.store,'save') as save:
            c.tick((0,0),True);c.tick((0,0),True)
            self.assertEqual(save.call_count,1)
            self.clock[0]=2;c.tick((0,0),True);self.assertEqual(save.call_count,2)
        c.close();self.assertTrue(self.transport.closed)
        self.assertIn('__ceciliaPlayer?.stop()',self.transport.scripts[-1][0])
        self.assertIn('__ceciliaGaze?.stop()',self.transport.scripts[-1][0])

if __name__=='__main__':unittest.main()
