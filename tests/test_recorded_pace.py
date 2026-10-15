import json,unittest,sys,tempfile,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from state_store import StateStore
TARGETS={'op-turn':4000,'small-sway':3000,'tiptoe-clap':2400,'showcase':2400,
         'lie':4200,'lump':3000,'lawrence-care':4400,'hazelita-showcase':4400}
class RecordedPaceTest(unittest.TestCase):
 def test_retiming_keeps_all_existing_intermediate_poses_of_interactions(self):
  signatures=json.loads((ROOT/'tests/interaction-pose-signatures.json').read_text('utf8'))
  new=json.loads((ROOT/'manifest.json').read_text('utf8'))
  for outfit in new['outfits']:
   for name in ('lawrence-care','hazelita-chat','hazelita-showcase'):
    with self.subTest(outfit=outfit,action=name):
     clip=new['outfits'][outfit]['clips'][name]
     if clip.get('hdRevision') in (1,2):
      rate=clip['playbackRate'];duration=sum(f['duration'] for f in clip['frames'])/rate
      self.assertGreaterEqual(len(clip['frames']),duration*120/1000-1e-6)
      if clip.get('motionModel') in ('continuous-painted-surface-v1','canonical-painted-depth25-v5'):
       if new['artwork'].get('hybridRevision'):
        self.assertTrue(all(len(f['layers'])==10 and all(f['layers'][i]['source'][2:]==[1024,1536] and f['layers'][i].get('skeleton') for i in (0,5)) for f in clip['frames']))
        self.assertTrue(all(all(l.get('partMask') for l in f['layers'][1:5]+f['layers'][6:]) for f in clip['frames']))
       else:self.assertTrue(all(len(f['layers'])==2 and all(l['source'][2:]==[1024,1536] and l.get('skeleton') for l in f['layers']) for f in clip['frames']))
       samples=[json.dumps({k:f['layers'][0][k] for k in ('skeleton','matrix','volume')},sort_keys=True) for f in clip['frames']]
       self.assertGreater(sum(a!=b for a,b in zip(samples,samples[1:])),(len(samples)-1)*.98,'consecutive motion samples must advance; returning to a pose later is valid')
      elif clip.get('gpuMotionRevision'):
       self.assertTrue(all(len(f['layers'])==2 and all(l.get('motion') and l['source'][2:]==l['motion']['poseSize'] and l['source'][2]>=384 for l in f['layers']) for f in clip['frames']))
      else:self.assertTrue(all(f['layers'][0]['source'][2:]==[1152,624] for f in clip['frames']))
     else:
      actual=hashlib.sha256(json.dumps([f['layers'] for f in clip['frames']],sort_keys=True).encode()).hexdigest()
      self.assertEqual(actual,signatures[outfit+'/'+name])
 def test_slow_recorded_actions_finish_in_a_lively_but_complete_cycle(self):
  m=json.loads((ROOT/'manifest.json').read_text('utf8'))
  for outfit,data in m['outfits'].items():
   for name,target in TARGETS.items():
    with self.subTest(outfit=outfit,action=name):
     c=data['dances'].get(name) or data['clips'][name]
     self.assertAlmostEqual(sum(f['duration'] for f in c['frames'])/c['playbackRate'],target,places=5)
 def test_a_short_expression_does_not_pad_to_4_point_2_seconds(self):
  m=json.loads((ROOT/'manifest.json').read_text('utf8'))
  self.assertLessEqual(m['schedule']['interludeMs'],1600)
 def test_revision_nine_checkpoint_preserves_outfit_and_phase(self):
  state=dict(version=2,timingRevision=9,outfit='cafe',phase='dance',phaseElapsed=7500,
   danceId='op-turn',lastDance='op-turn',danceBag=[],scene=None,sceneBag=[],outfitBag=[],lastScene=None,
   lastMode='daily',lastTask=None,taskElapsed=0,recoveryRemaining=0,resume=None,
   visibleMs=123456,nextOutfitAt=300000,timingLimits={'dance':8000,'interlude':1600,'showcase':2400})
  with tempfile.TemporaryDirectory() as folder:
   store=StateStore(Path(folder)/'state.json');store.save(state);self.assertEqual(store.load(),state)
if __name__=='__main__':unittest.main()
