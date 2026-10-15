from pathlib import Path
import sys,unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import launch
class LaunchTest(unittest.TestCase):
 def test_background_helper_never_opens_the_app_without_user_launch(self):
  with patch('launch.helper_running',return_value=False),patch('launch.subprocess.Popen') as popen:
   launch.start_helper()
  command=popen.call_args.args[0]
  self.assertEqual(Path(command[0]).name,'pythonw.exe');self.assertIn('--watch',command)
  self.assertNotIn('--launch',command)
 def test_app_launch_never_stops_the_client_or_restarts_existing_helpers(self):
  with patch('launch.helper_running',return_value=True),patch('launch.subprocess.run') as stop,patch('launch.subprocess.Popen') as popen:
   launch.start()
  stop.assert_not_called();self.assertEqual(popen.call_count,1)
  self.assertEqual(Path(popen.call_args.args[0][0]).name,'ChatGPT.exe')
  self.assertNotIn('--restart-approved',popen.call_args.args[0])
if __name__=='__main__':unittest.main()
