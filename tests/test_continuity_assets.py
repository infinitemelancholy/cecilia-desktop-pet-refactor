import os,json,unittest,collections
import sys
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(os.environ.get('CECILIA_TEST_BUNDLE',str(Path(__file__).resolve().parents[1])))
sys.path.insert(0,str(ROOT))
from gpu_raster import RasterReference
class AssetContinuityTest(unittest.TestCase):
 def test_joint_interaction_returns_to_the_common_owner_pose_at_both_boundaries(self):
  m=json.loads((ROOT/'manifest.json').read_text('utf8'))
  def owner(frame):
   l=frame['layers'][0];x,y,w,h=l['source']
   half=w//2 if w/h>1.5 else w
   with Image.open(ROOT/m['assets'][l['asset']]) as im:a=np.asarray(im.convert('RGBA').crop((x,y,x+half,y+h)).resize((192,208),Image.Resampling.LANCZOS),dtype=float)/255
   a[:,:,:3]*=a[:,:,3:];return a
  for outfit,data in m['outfits'].items():
   neutral=owner(data['clips']['idle']['frames'][0])
   frames=data['clips']['lawrence-sleeve']['frames']
   for frame in (frames[0],frames[-1]):
    self.assertLess(float(np.abs(owner(frame)-neutral).mean()),.002,(outfit,'joint interaction needs a neutral entry and exit'))
 def test_companion_does_not_hold_a_pose_and_then_jump_between_authored_frames(self):
  m=json.loads((ROOT/'manifest.json').read_text('utf8'));cache=collections.OrderedDict();reference=RasterReference(ROOT,m)
  for outfit in m['outfits']:
   for name in ('lawrence-care','hazelita-chat','hazelita-showcase'):
    last=None;changes=[]
    for f in m['outfits'][outfit]['clips'][name]['frames']:
     if f['layers'][0].get('motion'):
      a=reference.frame(f,width=384)[:,192:]
      if last is not None:
       union=(a[:,:,3]>.1)|(last[:,:,3]>.1)
       changes.append(float(np.abs(a-last)[union].mean()) if union.any() else 0)
      last=a;continue
     l=f['layers'][0];p=ROOT/m['assets'][l['asset']]
     if p not in cache:
      with Image.open(p) as im:cache[p]=im.convert('RGBA')
      if len(cache)>5:_,im=cache.popitem(last=False);im.close()
     x,y,w,h=l['source'];a=np.asarray(cache[p].crop((x+w//2,y,x+w,y+h)).resize((192,208),Image.Resampling.LANCZOS),dtype=np.float32)/255
     a[:,:,:3]*=a[:,:,3:]
     if last is not None:
      union=(a[:,:,3]>.1)|(last[:,:,3]>.1)
      changes.append(float(np.abs(a-last)[union].mean()) if union.any() else 0)
     last=a
    for i,change in enumerate(changes):
     if change<=.04:continue
     neighbors=changes[max(0,i-3):i]+changes[i+1:i+4]
     typical=float(np.median(neighbors))
     self.assertLess(change,typical*2.5+.005,(outfit,name,'isolated companion pose cut',i+1,change,neighbors))
  reference.close()
if __name__=='__main__':unittest.main()
