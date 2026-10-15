"""Background animation helper; the official app launches independently."""
import argparse
import ctypes
from ctypes import wintypes as W
import json
import logging
import os
from pathlib import Path
import time

import psutil
import websocket
import win32gui

ROOT=Path(__file__).resolve().parent
import native_transport as native
from windows_branding import OfficialWindows
from connection import ExtensionConnection
from asset_bundle import load_bundle
from pet_recovery import PetRecovery

STOP_FILE=ROOT/'runtime/stop.request'
ERRORS=(OSError,RuntimeError,ValueError,websocket.WebSocketException)

def write_status(data):
    path=ROOT/'runtime/status.json'
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2),'utf8')

def stop_helper():
    STOP_FILE.parent.mkdir(parents=True,exist_ok=True);STOP_FILE.touch()
    expected=os.path.normcase(str(ROOT/'bridge.py'))
    helpers=[]
    for process in psutil.process_iter(['pid','cmdline']):
        try:
            if process.pid!=os.getpid() and any(os.path.normcase(arg)==expected for arg in process.info['cmdline'] or []):
                helpers.append(process)
        except (psutil.NoSuchProcess,psutil.AccessDenied):pass
    _,remaining=psutil.wait_procs(helpers,timeout=5)
    write_status({'mode':'stopped' if not remaining else 'stopping','helperPids':[p.pid for p in remaining]})

def run(port,wait_seconds,watch=False):
    bundle=None
    executable=native.installed_executable(ROOT)
    branding=OfficialWindows(executable,ROOT/'official-chatgpt-white.ico')
    connections={};last_scan=0;attached_once=False;deadline=time.monotonic()+wait_seconds
    previous_identity=None
    recovery=PetRecovery(Path(os.environ.get('CODEX_HOME',str(Path.home()/'.codex')))/'config.toml')
    try:
        while not STOP_FILE.exists():
            branding.pump()
            now=time.monotonic()
            if now-last_scan>=1:
                last_scan=now
                current_identity=branding.refresh()
                if current_identity!=previous_identity:
                    previous_identity=current_identity
                    (ROOT/'runtime/taskbar-window-verification.json').write_text(
                        json.dumps(current_identity,ensure_ascii=False,indent=2),'utf8')
                try:
                    current=native.targets(port);current_ids={target['id'] for target in current}
                    if current and bundle is None:
                        write_status({'mode':'loading-animation','appLaunchIndependent':True})
                        bundle=load_bundle(ROOT,lazy=True)
                    for key in list(connections):
                        if key not in current_ids:
                            connection,_=connections.pop(key);connection.close()
                    for target in current:
                        if target['id'] in connections:continue
                        transport=native.attach(target,port)
                        pointer=native.NativePetWindow()
                        try:
                            if not recovery.ready(transport,bundle['petId'],target['id']):
                                transport.close();continue
                            pointer.bind_native_window(transport,executable)
                            connection=ExtensionConnection(transport,ROOT)
                            if not connection.install(bundle):raise RuntimeError('Animation installation failed')
                            connections[target['id']]=(connection,pointer)
                            attached_once=True
                            logging.info('Native pet window attached: %s',pointer.hwnd)
                        except Exception:
                            transport.close();raise
                    write_status({'mode':'connected' if connections else 'waiting',
                        'connections':len(connections),
                        'players':[c.status for c,_ in connections.values()]})
                except ERRORS as error:logging.debug('Waiting for native pet: %s',error)
            for key,(connection,pointer) in list(connections.items()):
                try:
                    visible=bool(pointer.hwnd and win32gui.IsWindow(pointer.hwnd) and win32gui.IsWindowVisible(pointer.hwnd))
                    if not connection.tick(None,visible):
                        connections.pop(key);connection.close()
                except ERRORS as error:
                    logging.info('Native connection reset: %s',error)
                    connections.pop(key)
                    try:connection.close()
                    except Exception:pass
            if not watch and not attached_once and now>deadline:
                raise TimeoutError('Native pet debugger unavailable. Fully exit Codex from its tray, then use the Cecilia launcher and show the pet.')
            time.sleep(.04)
    finally:
        for connection,_ in connections.values():
            try:connection.close()
            except Exception:pass
        branding.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--launch',action='store_true');parser.add_argument('--stop',action='store_true')
    parser.add_argument('--watch',action='store_true')
    parser.add_argument('--check',action='store_true');parser.add_argument('--probe',action='store_true')
    parser.add_argument('--port',type=int,default=native.PORT);parser.add_argument('--wait',type=float,default=120)
    args=parser.parse_args()
    if args.stop:stop_helper();return
    if args.check:
        try:
            config=load_bundle(ROOT)
            print(json.dumps({'ready':True,'petId':config['petId']}))
        except (OSError,ValueError,KeyError,TypeError) as error:
            print(json.dumps({'ready':False,'reason':str(error)},ensure_ascii=False));raise SystemExit(1)
        return
    if args.probe:
        try:print(json.dumps({'ready':bool(native.targets(args.port))}))
        except OSError:print(json.dumps({'ready':False}))
        return
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateMutexW.argtypes=[ctypes.c_void_p,W.BOOL,W.LPCWSTR];kernel.CreateMutexW.restype=W.HANDLE
    handle=kernel.CreateMutexW(None,False,'Local\\CeciliaAnimation76363842')
    if not handle:raise ctypes.WinError(ctypes.get_last_error())
    if ctypes.get_last_error()==183:return
    (ROOT/'runtime').mkdir(exist_ok=True)
    logging.basicConfig(filename=ROOT/'runtime/player.log',level=logging.INFO,
        format='%(asctime)s %(levelname)s %(message)s',encoding='utf8')
    STOP_FILE.unlink(missing_ok=True)
    try:
        if args.launch:
            from launch import start
            start()
        run(args.port,args.wait,watch=args.watch)
    except Exception as error:
        logging.exception('Cecilia helper did not start');write_status({'mode':'error','message':str(error)})
    finally:
        kernel.CloseHandle.argtypes=[W.HANDLE];kernel.CloseHandle(handle)

if __name__=='__main__':main()
