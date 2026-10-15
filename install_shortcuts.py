"""Install shortcuts that prepare the icon listener before launching the official app."""
import ctypes,json,os,shutil
from pathlib import Path
import pythoncom,win32com.client
from win32com.propsys import propsys
from windows_branding import relaunch_properties,KEYS
from launch import PYTHONW
ROOT=Path(__file__).resolve().parent

def eligible(link,launcher):
    return Path(link.TargetPath).name.lower()=='wscript.exe' and os.path.normcase(link.Arguments.strip().strip('"'))==os.path.normcase(str(launcher))

def notify(path):ctypes.windll.shell32.SHChangeNotify(0x2000,0x5,ctypes.c_wchar_p(str(path)),None)

def install():
    executable=Path(json.loads((ROOT/'installed-client.json').read_text('utf8'))['executable'])
    if not executable.is_file():raise FileNotFoundError(executable)
    icon=ROOT/'official-chatgpt-white.ico'
    if not icon.is_file():shutil.copy2(executable.parent/'resources/chatgpt-app-dark.ico',icon)
    appdata=Path(os.environ['APPDATA']);home=Path(os.environ['USERPROFILE'])
    paths=[home/'Desktop/ChatGPT.lnk',appdata/'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar/Codex.lnk',appdata/'Microsoft/Windows/Start Menu/Programs/ChatGPT.lnk']
    record=ROOT/'launch-cleanup-backup';record.mkdir(exist_ok=True);pythoncom.CoInitialize()
    try:
        shell=win32com.client.Dispatch('WScript.Shell');links=[]
        for i,path in enumerate(paths):
            if not path.is_file():raise FileNotFoundError(path)
            link=shell.CreateShortcut(str(path))
            guarded=os.path.normcase(link.TargetPath)==os.path.normcase(str(PYTHONW)) and link.Arguments==f'"{ROOT / "launch.py"}" start'
            if not (eligible(link,ROOT/'启动塞西莉亚.vbs') or guarded or os.path.normcase(link.TargetPath)==os.path.normcase(str(executable))):raise ValueError(f'Unrelated shortcut: {path}')
            backup=record/f'shortcut-{i}.lnk'
            if not backup.exists():shutil.copy2(path,backup)
            links.append((path,link))
        properties=relaunch_properties(executable,icon);report=[]
        for path,link in links:
            link.TargetPath=str(PYTHONW);link.Arguments=f'"{ROOT / "launch.py"}" start';link.WorkingDirectory=str(ROOT)
            link.IconLocation=f'{icon},0';link.Description='ChatGPT';link.Save()
            store=propsys.SHGetPropertyStoreFromParsingName(str(path),None,2)
            for key,value in properties.items():store.SetValue(KEYS[key],propsys.PROPVARIANTType(value))
            store.Commit();notify(path)
            report.append({'path':str(path),'target':str(PYTHONW),'arguments':link.Arguments,'icon':link.IconLocation,'appId':properties['appId']})
        startup=appdata/'Microsoft/Windows/Start Menu/Programs/Startup/Cecilia Animation Helper.lnk'
        link=shell.CreateShortcut(str(startup));link.TargetPath=r'C:\anaconda3\pythonw.exe'
        link.Arguments=f'"{ROOT / "bridge.py"}" --watch';link.WorkingDirectory=str(ROOT);link.IconLocation=f'{icon},0'
        link.Description='Cecilia animation background helper';link.WindowStyle=7;link.Save();notify(startup)
        return {'shortcuts':report,'backgroundStartup':str(startup),'appLaunchIndependent':True,'iconListenerBeforeApp':True}
    finally:pythoncom.CoUninitialize()
if __name__=='__main__':print(json.dumps(install(),ensure_ascii=False,indent=2))
