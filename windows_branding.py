"""White ChatGPT window identity, early icon listener, and guarded relaunch metadata."""
from pathlib import Path
import ctypes
from ctypes import wintypes as W
import sys
import time
import psutil,pythoncom,win32gui,win32process,win32con
from win32com.propsys import propsys,pscon
from win32com.shell import shell
# Keep this icon group separate from the packaged app's cached artwork.
APP_ID='com.openai.codex.chatgpt.white'
PORT=49305
BRANDING_READY_EVENT='Local\\CeciliaBrandingReady76363842'

def app_arguments():return [f'--remote-debugging-port={PORT}','--remote-debugging-address=127.0.0.1']
def relaunch_properties(executable,icon):
    launcher=Path(icon).parent/'launch.py'
    pythonw=Path(sys.executable).with_name('pythonw.exe')
    return {'appId':APP_ID,'relaunchCommand':f'"{pythonw}" "{launcher}" start','displayName':'ChatGPT','icon':str(icon)+',0'}
KEYS={'appId':pscon.PKEY_AppUserModel_ID,'relaunchCommand':pscon.PKEY_AppUserModel_RelaunchCommand,'displayName':pscon.PKEY_AppUserModel_RelaunchDisplayNameResource,'icon':pscon.PKEY_AppUserModel_RelaunchIconResource}

def refresh_taskbar_registration(hwnd):
    # Explorer keeps a running group's old icon even after WM_SETICON and its
    # window properties change. Re-register just this window with the new icon.
    taskbar=pythoncom.CoCreateInstance(shell.CLSID_TaskbarList,None,
        pythoncom.CLSCTX_INPROC_SERVER,shell.IID_ITaskbarList)
    taskbar.HrInit()
    taskbar.DeleteTab(hwnd)
    try:time.sleep(.15)
    finally:taskbar.AddTab(hwnd)

class OfficialWindows:
    def __init__(self,executable,icon):
        pythoncom.CoInitialize();self.executable=Path(executable);self.icon=Path(icon);self.seen=set();self.icons=[]
        for kind,pixels in [(win32con.ICON_SMALL,32),(win32con.ICON_BIG,256)]:
            handle=win32gui.LoadImage(0,str(self.icon),win32con.IMAGE_ICON,pixels,pixels,win32con.LR_LOADFROMFILE)
            self.icons.append((kind,handle))
        self.user=ctypes.WinDLL('user32',use_last_error=True)
        callback_type=ctypes.WINFUNCTYPE(None,W.HANDLE,W.DWORD,W.HWND,W.LONG,W.LONG,W.DWORD,W.DWORD)
        self.callback=callback_type(self._window_event)
        self.user.SetWinEventHook.argtypes=[W.DWORD,W.DWORD,W.HANDLE,callback_type,W.DWORD,W.DWORD,W.DWORD]
        self.user.SetWinEventHook.restype=W.HANDLE
        self.user.UnhookWinEvent.argtypes=[W.HANDLE]
        # OUTOFCONTEXT events are delivered on this thread's message queue.
        self.hook=self.user.SetWinEventHook(0x8000,0x8002,None,self.callback,0,0,0)
        if not self.hook:raise ctypes.WinError(ctypes.get_last_error())
        self.kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        self.kernel.CreateEventW.argtypes=[ctypes.c_void_p,W.BOOL,W.BOOL,W.LPCWSTR]
        self.kernel.CreateEventW.restype=W.HANDLE
        self.kernel.CloseHandle.argtypes=[W.HANDLE]
        self.ready_event=self.kernel.CreateEventW(None,True,True,BRANDING_READY_EVENT)
        if not self.ready_event:raise ctypes.WinError(ctypes.get_last_error())

    def _window_event(self,hook,event,hwnd,object_id,child_id,thread,time_ms):
        if object_id or child_id or not hwnd:return
        try:self._apply(hwnd)
        except (OSError,RuntimeError,pythoncom.com_error,psutil.Error):
            # A CREATE notification can arrive before the window is queryable;
            # SHOW and the periodic scan both retry it.
            return

    def pump(self):
        pythoncom.PumpWaitingMessages()

    def _apply(self,hwnd):
        if not win32gui.IsWindow(hwnd) or win32gui.GetAncestor(hwnd,win32con.GA_ROOT)!=hwnd:return None
        _,pid=win32process.GetWindowThreadProcessId(hwnd)
        if Path(psutil.Process(pid).exe())!=self.executable or win32gui.GetWindow(hwnd,win32con.GW_OWNER):return None
        if win32gui.GetWindowLong(hwnd,win32con.GWL_EXSTYLE)&(win32con.WS_EX_TOOLWINDOW|win32con.WS_EX_NOACTIVATE):return None
        values=relaunch_properties(self.executable,self.icon)
        store=propsys.SHGetPropertyStoreForWindow(hwnd)
        changed=(hwnd,pid) not in self.seen
        for kind,handle in self.icons:
            if win32gui.SendMessage(hwnd,win32con.WM_GETICON,kind,0)!=handle:
                win32gui.SendMessage(hwnd,win32con.WM_SETICON,kind,handle)
        if changed:
            for key,value in values.items():
                if key!='appId':store.SetValue(KEYS[key],propsys.PROPVARIANTType(value))
            store.SetValue(KEYS['appId'],propsys.PROPVARIANTType(values['appId']))
            # Hidden windows are ready before Explorer creates their group.
            # Only an already-visible fallback needs its group re-registered.
            if win32gui.IsWindowVisible(hwnd):refresh_taskbar_registration(hwnd)
            self.seen.add((hwnd,pid))
        return {'hwnd':hwnd,'pid':pid,**{key:store.GetValue(prop).GetValue() for key,prop in KEYS.items()}}

    def refresh(self):
        self.pump()
        pids={p.pid for p in psutil.process_iter(['exe']) if p.info['exe'] and Path(p.info['exe'])==self.executable};results=[]
        def visit(hwnd,_):
            _,pid=win32process.GetWindowThreadProcessId(hwnd)
            if pid not in pids:return
            row=self._apply(hwnd)
            if row and win32gui.IsWindowVisible(hwnd):results.append(row)
        win32gui.EnumWindows(visit,None);return results
    def close(self):
        self.user.UnhookWinEvent(self.hook)
        self.kernel.CloseHandle(self.ready_event)
        # Windows retain the official metadata; never restore the retired gaze identity.
        pythoncom.CoUninitialize()
