"""Loopback transport and native pet window discovery, without cursor tracking."""
import json,os,ctypes
from pathlib import Path
from urllib.parse import urlparse,unquote
from urllib.request import build_opener,ProxyHandler
import psutil,websocket,win32gui,win32process,win32con
PORT=49305
HTTP=build_opener(ProxyHandler({}))

def is_pet_target(target):
    parsed=urlparse(target.get('url',''))
    local=parsed.scheme in ('app','file','codex') or (parsed.scheme in ('http','https') and parsed.hostname in ('127.0.0.1','localhost'))
    return target.get('type')=='page' and local and '/avatar-overlay' in unquote(target.get('url',''))

def targets(port=PORT):
    with HTTP.open(f'http://127.0.0.1:{port}/json/list',timeout=1) as response:
        return [target for target in json.load(response) if is_pet_target(target)]

class CDP:
    def __init__(self,url,port=PORT):
        parsed=urlparse(url)
        if parsed.scheme!='ws' or parsed.hostname not in ('127.0.0.1','localhost') or parsed.port!=port:
            raise ValueError('Only the selected loopback pet debugger is accepted')
        self.socket=websocket.create_connection(url,timeout=2,suppress_origin=True,http_no_proxy=['127.0.0.1','localhost']);self.sequence=0
        self.pending={};self.bindings={}
        self.image_handler=None
    def command(self,method,params):
        self.sequence+=1
        request_id=self.sequence
        self.socket.send(json.dumps({'id':request_id,'method':method,'params':params}))
        while True:
            response=self.pending.pop(request_id,None)
            if response is None:response=json.loads(self.socket.recv())
            if response.get('method')=='Runtime.bindingCalled':
                event=response['params'];handler=self.bindings.get(event['name'])
                if handler:handler(event['payload'])
                continue
            if response.get('method')=='Fetch.requestPaused' and self.image_handler:
                event=response['params']
                reply=self.image_handler(event['request']['url'])
                self.command('Fetch.fulfillRequest',{'requestId':event['requestId'],**reply})
                continue
            if response.get('id')!=request_id:
                if 'id' in response:self.pending[response['id']]=response
                continue
            if 'error' in response:raise RuntimeError(response['error'].get('message','CDP error'))
            result=response.get('result',{})
            if 'exceptionDetails' in result:
                details=result['exceptionDetails']
                raise RuntimeError(details.get('exception',{}).get('description') or details.get('text','JavaScript exception'))
            return result
    def bind(self,name,handler):
        self.bindings[name]=handler
        self.command('Runtime.enable',{})
        self.command('Runtime.addBinding',{'name':name})
    def intercept_images(self,prefix,handler):
        self.image_handler=handler
        self.command('Fetch.enable',{'patterns':[{'urlPattern':prefix+'*','resourceType':'Image','requestStage':'Request'}]})
    def evaluate(self,expression,await_promise=False):
        return self.command('Runtime.evaluate',{'expression':expression,'returnByValue':True,'awaitPromise':await_promise}).get('result',{}).get('value')
    def close(self):
        try:
            if self.image_handler:self.command('Fetch.disable',{})
        finally:self.socket.close()

def attach(target,port=PORT):
    client=CDP(target['webSocketDebuggerUrl'],port)
    try:
        if not client.evaluate("Boolean(window.electronBridge && window.codexWindowType==='electron')"):
            raise RuntimeError('The pet target is not the installed native renderer')
        return client
    except Exception:client.close();raise

def installed_executable(root):
    root=Path(root);saved=root/'installed-client.json';candidates=[]
    if saved.is_file():
        path=Path(json.loads(saved.read_text('utf8'))['executable'])
        if path.is_file():candidates.append(path)
    for process in psutil.process_iter(['exe']):
        exe=process.info['exe']
        if exe and 'OpenAI.Codex_' in exe and Path(exe).name=='ChatGPT.exe':candidates.append(Path(exe))
    if not candidates:raise FileNotFoundError('Installed ChatGPT executable unavailable')
    path=max(candidates,key=lambda p:tuple(int(v) for v in p.parents[1].name.split('_')[1].split('.')))
    saved.write_text(json.dumps({'executable':str(path)},indent=2),'utf8');return path

class NativePetWindow:
    def __init__(self):
        self.hwnd=None
        user=ctypes.WinDLL('user32',use_last_error=True)
        user.SetThreadDpiAwarenessContext.argtypes=[ctypes.c_void_p];user.SetThreadDpiAwarenessContext.restype=ctypes.c_void_p
        user.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
    def bind_native_window(self,client,executable):
        geometry=client.evaluate('({width:innerWidth,height:innerHeight,ratio:devicePixelRatio||1})')
        width=geometry['width']*geometry['ratio'];height=geometry['height']*geometry['ratio']
        pids={p.pid for p in psutil.process_iter(['exe']) if p.info['exe'] and Path(p.info['exe'])==Path(executable)};matches=[]
        def visit(hwnd,_):
            _,pid=win32process.GetWindowThreadProcessId(hwnd)
            if pid not in pids or not win32gui.IsWindowVisible(hwnd):return
            if not win32gui.GetWindowLong(hwnd,win32con.GWL_EXSTYLE)&win32con.WS_EX_TOOLWINDOW:return
            left,top,right,bottom=win32gui.GetClientRect(hwnd)
            if abs(right-left-width)<=2 and abs(bottom-top-height)<=2:matches.append(hwnd)
        win32gui.EnumWindows(visit,None)
        if len(matches)!=1:raise RuntimeError(f'Expected one native pet window, found {len(matches)}')
        self.hwnd=matches[0];return self.hwnd
