import sys,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import launch
class LaunchOrderTest(unittest.TestCase):
 def test_icon_listener_is_ready_before_official_app_process_is_created(self):
  events=[]
  with patch('launch.start_helper',side_effect=lambda:events.append('helper')),patch('launch.subprocess.Popen',side_effect=lambda *a,**k:events.append('app')):
   launch.start()
  self.assertEqual(events,['helper','app'],'an app window must not appear before its icon listener starts')
if __name__=='__main__':unittest.main()
