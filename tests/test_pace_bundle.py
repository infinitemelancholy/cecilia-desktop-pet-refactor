import unittest,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from asset_bundle import load_bundle
class PaceBundleTest(unittest.TestCase):
 def test_complete_retimed_bundle_can_load_before_the_live_helper_is_replaced(self):
  try:config=load_bundle(ROOT,lazy=True)
  except ValueError as error:self.fail('A complete retimed bundle must be accepted: '+str(error))
  self.assertEqual(config['schedule']['timingRevision'],9)
  self.assertEqual(config['schedule']['interludeMs'],1600)
if __name__=='__main__':unittest.main()
