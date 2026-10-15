import json,unittest
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import label
BASE=Path(__file__).resolve().parent;OUT=BASE.parents[1]/'outputs'/'重构验证'/'完整动作试作'
class SpatialIdle(unittest.TestCase):
    def test_idle_has_real_blink_cels_and_irregular_exposure_schedule(self):
        config=json.loads((OUT/'试作资源.json').read_text('utf8'))
        self.assertTrue('spatial-idle' in config['clips'],'Finished idle art is not the geometry-only probe')
        clip=config['clips']['spatial-idle'];self.assertEqual(clip['authoredCels'],3)
        intervals=[f['duration'] for f in clip['frames'] if f['blinkCel']==0]
        self.assertGreater(len(set(intervals)),10);self.assertGreater(sum(f['duration'] for f in clip['frames']),120000)
        self.assertEqual({f['blinkCel'] for f in clip['frames']},{0,1,2})
    def test_neutral_shoes_remain_two_separate_connected_shapes(self):
        self.assertTrue((OUT/'spatial_idle_hd-0.png').exists(),'Idle cels need actual checked pixels')
        for i in range(3):
            with Image.open(OUT/f'spatial_idle_hd-{i}.png') as im:
                alpha=np.asarray(im.getchannel('A'));mask=alpha[750:810,270:500]>128
                ids,n=label(mask);areas=np.bincount(ids.ravel())[1:]
            self.assertEqual(int((areas>80).sum()),2,i)
    def test_one_whole_actor_contains_the_full_body_and_has_depth_metadata(self):
        config=json.loads((OUT/'试作资源.json').read_text('utf8'))
        self.assertTrue('spatial-idle' in config['clips'])
        for frame in config['clips']['spatial-idle']['frames']:
            actors=[l for l in frame['layers'] if config['assetMetadata'][l['asset']]['kind']=='authored-cels']
            self.assertEqual(len(actors),1);self.assertIn('spatial',actors[0]['volume'])
            for field in ('motion','face','partMask','footCut'):self.assertNotIn(field,actors[0])
if __name__=='__main__':unittest.main()
