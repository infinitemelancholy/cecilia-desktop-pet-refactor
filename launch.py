"""Prepare the icon listener, then launch the official app; animations connect independently."""
import argparse,ctypes,json,os,subprocess,time
from ctypes import wintypes as W
from pathlib import Path
import psutil
from windows_branding import app_arguments,BRANDING_READY_EVENT
ROOT=Path(__file__).resolve().parent
PYTHON=Path(r'C:\anaconda3\python.exe');PYTHONW=Path(r'C:\anaconda3\pythonw.exe')
HIDDEN=subprocess.CREATE_NO_WINDOW

def executable():
    saved=ROOT/'installed-client.json'
    if saved.is_file():
        path=Path(json.loads(saved.read_text('utf8'))['executable'])
        if path.is_file():return path
    from native_transport import installed_executable
    return installed_executable(ROOT)

def helper_running():
    expected=os.path.normcase(str(ROOT/'bridge.py'))
    for process in psutil.process_iter(['cmdline']):
        args=process.info['cmdline'] or []
        if '--watch' not in args and '--launch' not in args:continue
        if any(os.path.normcase(arg)==expected for arg in args):return True
    return False

def start_helper():
    if not helper_running():
        subprocess.Popen([str(PYTHONW),str(ROOT/'bridge.py'),'--watch'],cwd=ROOT,creationflags=HIDDEN,stdin=subprocess.DEVNULL)

def start():
    start_helper()
    wait_for_branding()
    subprocess.Popen([str(executable()),*app_arguments()],creationflags=HIDDEN)

def wait_for_branding(timeout=2):
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenEventW.argtypes=[W.DWORD,W.BOOL,W.LPCWSTR];kernel.OpenEventW.restype=W.HANDLE
    kernel.WaitForSingleObject.argtypes=[W.HANDLE,W.DWORD]
    kernel.CloseHandle.argtypes=[W.HANDLE]
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        handle=kernel.OpenEventW(0x100000,False,BRANDING_READY_EVENT)
        if handle:
            try:return kernel.WaitForSingleObject(handle,0)==0
            finally:kernel.CloseHandle(handle)
        time.sleep(.01)
    return False

def stop():subprocess.run([str(PYTHON),str(ROOT/'bridge.py'),'--stop'],check=True,creationflags=HIDDEN)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=('start','helper','stop'))
    action=parser.parse_args().action
    if action=='helper':start_helper()
    elif action=='stop':stop()
    else:start()
if __name__=='__main__':main()
