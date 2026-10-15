import sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from state_store import StateStore
class UniformStateTest(unittest.TestCase):
 def test_long_calibrated_dance_survives_save_load_without_being_migrated_back(self):
  state=dict(version=2,timingRevision=4,outfit='cafe',phase='dance',phaseElapsed=25000,
   danceId='op-turn',lastDance='op-turn',danceBag=[],scene=None,sceneBag=[],outfitBag=[],lastScene=None,
   lastMode='daily',lastTask=None,taskElapsed=0,recoveryRemaining=0,resume=None,
   visibleMs=123456,nextOutfitAt=300000,timingLimits={'dance':62000,'interlude':15000,'showcase':7100})
  with tempfile.TemporaryDirectory() as folder:
   store=StateStore(Path(folder)/'state.json');store.save(state)
   self.assertEqual(store.load(),state)
 def test_corrupt_calibrated_limits_are_rejected(self):
  self.assertFalse(StateStore.valid({'version':2,'timingRevision':4,'outfit':'cafe','timingLimits':{'dance':float('inf')}}))

 def test_revision_five_checkpoint_is_not_migrated_as_a_legacy_clock(self):
  state=dict(version=2,timingRevision=5,outfit='cafe',phase='dance',phaseElapsed=25000,
   danceId='op-turn',lastDance='op-turn',danceBag=[],scene=None,sceneBag=[],outfitBag=[],lastScene=None,
   lastMode='daily',lastTask=None,taskElapsed=0,recoveryRemaining=0,resume=None,
   visibleMs=123456,nextOutfitAt=300000,timingLimits={'dance':56000,'interlude':15000,'showcase':7100})
  with tempfile.TemporaryDirectory() as folder:
   store=StateStore(Path(folder)/'state.json');store.save(state)
   self.assertEqual(store.load(),state)
