import sys,time,unittest
from pathlib import Path
import pythoncom,win32gui,win32con
from win32com.propsys import propsys,pscon
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from windows_branding import OfficialWindows,APP_ID
class StartupIconTest(unittest.TestCase):
 def setUp(self):
  self.branding=OfficialWindows(sys.executable,ROOT/'official-chatgpt-white.ico')
  self.hwnd=win32gui.CreateWindowEx(win32con.WS_EX_APPWINDOW,'Static','Cecilia startup icon regression',win32con.WS_OVERLAPPEDWINDOW,0,0,80,80,0,0,0,None)
 def tearDown(self):
  win32gui.DestroyWindow(self.hwnd);self.branding.close()
 def id(self):return propsys.SHGetPropertyStoreForWindow(self.hwnd).GetValue(pscon.PKEY_AppUserModel_ID).GetValue()
 def test_hidden_main_window_is_branded_before_it_can_reach_taskbar(self):
  self.assertFalse(win32gui.IsWindowVisible(self.hwnd))
  self.branding.refresh()
  self.assertEqual(self.id(),APP_ID,'startup must set icon identity before showing the window')
  self.assertNotEqual(win32gui.SendMessage(self.hwnd,win32con.WM_GETICON,0,0),0)
 def test_window_creation_event_does_not_wait_for_one_second_scan(self):
  end=time.monotonic()+.3
  while time.monotonic()<end and self.id()!=APP_ID:
   pythoncom.PumpWaitingMessages();time.sleep(.01)
  self.assertEqual(self.id(),APP_ID,'create event must apply the white icon while the new window is hidden')
if __name__=='__main__':unittest.main()
