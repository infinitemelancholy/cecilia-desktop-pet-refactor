import hashlib,json,unittest
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
class CanonicalArt(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.m=json.loads((ROOT/'manifest.json').read_text('utf8'))
 def test_all_sixty_actions_use_only_the_previously_painted_depth_art(self):
  self.assertEqual(self.m['artwork']['model'],'canonical-painted-depth25-v5')
  count=0
  for outfit,data in self.m['outfits'].items():
   for name,clip in {**data['clips'],**data['dances']}.items():
    count+=1
    self.assertEqual(clip['motionModel'],'canonical-painted-depth25-v5')
    for frame in clip['frames']:
     self.assertIn(frame['layers'][0]['asset'],['portrait_'+outfit,'canonical_poses_'+outfit])
     for layer in frame['layers']:
      self.assertTrue(layer['asset'].startswith(('portrait_','painted_','canonical_poses_')))
      if layer.get('motion'):self.assertTrue(layer['motion']['asset'].startswith('canonical_flow_'))
    if name.startswith(('lawrence','hazelita')):
     self.assertEqual(len(clip['frames'][0]['layers']),10)
     self.assertEqual(clip['frames'][0]['layers'][5]['asset'],'portrait_'+name.split('-')[0])
  self.assertEqual(count,60)
 def test_source_mother_art_is_preserved_byte_for_byte(self):
  for person,record in self.m['artwork']['sourceArt'].items():
   actual=hashlib.sha256((ROOT/self.m['assets']['painted_'+person]).read_bytes()).hexdigest()
   self.assertEqual(actual,record['sha256'])
 def test_all_neutral_actors_share_a_ground_and_requested_height(self):
  for person,spec in self.m['artwork']['registrations'].items():
   with Image.open(ROOT/self.m['assets']['portrait_'+person]) as image:a=np.asarray(image)[:,:,3]>180
   y,x=np.where(a);dx,dy,dw,dh=spec['target'];s,_,_,_,tx,ty=spec['matrix']
   top=(dy+y.min()*dh/1536)*s+ty;foot=(dy+(y.max()+1)*dh/1536)*s+ty
   self.assertAlmostEqual(foot,201.5,places=5)
   self.assertAlmostEqual(foot-top,198 if person=='lawrence' else 189,places=5)
 def test_no_old_pose_bank_or_native_fallback_is_active(self):
  self.assertTrue(all('canonical25-v5/' in relative for relative in self.m['assets'].values()))
  for data in self.m['outfits'].values():self.assertTrue(data['nativeAtlas'].startswith('native25_'))

if __name__=='__main__':unittest.main()
