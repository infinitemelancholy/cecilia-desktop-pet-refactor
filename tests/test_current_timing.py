"""Wardrobe edits share one canonical pose sequence and one motion clock."""
import json,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class CurrentTimingTest(unittest.TestCase):
 def test_canonical_actions_have_the_same_cycle_in_every_outfit(self):
  m=json.loads((ROOT/'manifest.json').read_text('utf8'))
  self.assertGreaterEqual(m['artwork']['proportionRevision'],8)
  for group in ('clips','dances'):
   for name in m['outfits']['travel'][group]:
    durations=[]
    for outfit in m['outfits'].values():
     c=outfit[group][name];durations.append(sum(f['duration'] for f in c['frames'])/c['playbackRate'])
    with self.subTest(action=name):self.assertLess(max(durations)/min(durations),1.015)
 def test_schedule_finishes_full_canonical_cycles(self):
  m=json.loads((ROOT/'manifest.json').read_text('utf8'))
  for outfit,data in m['outfits'].items():
   clock=m['schedule']['outfitTimings'][outfit]
   for name,c in data['dances'].items():
    actual=sum(f['duration'] for f in c['frames'])/c['playbackRate']
    self.assertAlmostEqual(clock['danceDurationsMs'][name],actual*2,places=5)
   for name,actual in clock['sceneDurations'].items():
    c=data['clips'][name];self.assertAlmostEqual(actual,sum(f['duration'] for f in c['frames'])/c['playbackRate'],places=5)
 def test_every_retimed_action_has_samples_for_a_60_hz_display(self):
  m=json.loads((ROOT/'manifest.json').read_text('utf8'))
  for outfit,data in m['outfits'].items():
   for name,c in {**data['clips'],**data['dances']}.items():
    with self.subTest(outfit=outfit,action=name):
     self.assertLessEqual(max(f['duration'] for f in c['frames'])/c['playbackRate'],1000/59.9)
 def test_shared_timing_revision_survives_the_checkpoint_store(self):
  import sys,tempfile
  sys.path.insert(0,str(ROOT))
  from state_store import StateStore
  state=dict(version=2,timingRevision=7,outfit='travel',phase='dance',phaseElapsed=7500,
   danceId='op-turn',lastDance='op-turn',danceBag=[],scene=None,sceneBag=[],outfitBag=[],lastScene=None,
   lastMode='daily',lastTask=None,taskElapsed=0,recoveryRemaining=0,resume=None,
   visibleMs=123456,nextOutfitAt=300000,timingLimits={'dance':16600,'interlude':15000,'showcase':6500})
  with tempfile.TemporaryDirectory() as folder:
   store=StateStore(Path(folder)/'state.json');store.save(state)
   self.assertEqual(store.load(),state)
if __name__=='__main__':unittest.main()
