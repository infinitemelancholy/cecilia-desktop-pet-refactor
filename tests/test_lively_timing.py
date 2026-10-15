import json,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from state_store import StateStore
class LivelyTimingTest(unittest.TestCase):
 def test_turn_and_other_dances_use_the_requested_livelier_clock(self):
  m=json.loads((ROOT/'manifest.json').read_text('utf8'))
  for outfit in m['outfits'].values():
   for name,target in {'op-turn':4000,'small-sway':3000,'tiptoe-clap':2400}.items():
    clip=outfit['dances'][name]
    self.assertAlmostEqual(sum(f['duration'] for f in clip['frames'])/clip['playbackRate'],target,places=5)
 def test_short_interaction_is_not_followed_by_a_twelve_second_idle_gap(self):
  m=json.loads((ROOT/'manifest.json').read_text('utf8'))
  for clocks in m['schedule']['outfitTimings'].values():
   self.assertLessEqual(max(m['schedule']['interludeMs'],clocks['sceneDurations']['lawrence-sleeve'])-clocks['sceneDurations']['lawrence-sleeve'],2200)
 def test_revision_eight_checkpoint_preserves_outfit_and_progress(self):
  state=dict(version=2,timingRevision=8,outfit='travel',phase='dance',phaseElapsed=12500,
   danceId='op-turn',lastDance='op-turn',danceBag=[],scene=None,sceneBag=[],outfitBag=[],lastScene=None,
   lastMode='daily',lastTask=None,taskElapsed=0,recoveryRemaining=0,resume=None,
   visibleMs=123456,nextOutfitAt=300000,timingLimits={'dance':13280,'interlude':4200,'showcase':5200})
  with tempfile.TemporaryDirectory() as folder:
   store=StateStore(Path(folder)/'state.json');store.save(state);self.assertEqual(store.load(),state)
if __name__=='__main__':unittest.main()
