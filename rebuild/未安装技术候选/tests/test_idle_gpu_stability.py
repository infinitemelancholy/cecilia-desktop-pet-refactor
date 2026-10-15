"""A blink may change eyelids, never the idle actor's torso or planted shoes."""
import unittest
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import label
OUT=Path(__file__).resolve().parents[2]/'outputs'/'重构验证'/'S3-体积视差试作'
class IdleGPUStability(unittest.TestCase):
    def test_two_separate_shoes_survive_the_actual_gpu_output(self):
        for i in range(3):
            a=np.asarray(Image.open(OUT/f'idle-{i}-actor-space-neutral.png').convert('RGBA'))
            ids,n=label(a[365:408,130:250,3]>8);areas=np.bincount(ids.ravel())[1:]
            self.assertEqual(int((areas>20).sum()),2,i)
    def test_body_and_hair_pixels_are_identical_during_a_blink(self):
        arrays=[np.asarray(Image.open(OUT/f'idle-{i}-actor-space-neutral.png').convert('RGBA')).astype(int) for i in range(3)]
        mask=np.ones(arrays[0].shape[:2],bool);mask[85:134,130:245]=False
        for i in (1,2):self.assertEqual(int(np.abs(arrays[i]-arrays[0])[mask].max()),0,i)
    def test_lids_have_three_distinct_exposures(self):
        import json
        values=[r['greenEyePixels'] for r in json.loads((OUT/'待机实际GPU检查.json').read_text('utf8'))[:3]]
        self.assertGreater(values[0],values[1]);self.assertGreater(values[1],values[2]);self.assertEqual(values[2],0)
if __name__=='__main__':unittest.main()
