import json
import unittest
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

class HybridBundleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest=json.loads((ROOT/'manifest.json').read_text('utf8'))

    def test_every_action_preserves_cloth_and_fades_the_complete_guest(self):
        count=0
        for outfit,data in self.manifest['outfits'].items():
            for clips in (data['clips'],data['dances']):
                for name,clip in clips.items():
                    count+=1
                    for frame in clip['frames']:
                        owner=frame['layers'][0]
                        self.assertNotIn('partMask',owner)
                        if clip.get('motionModel')=='canonical-painted-depth25-v5':
                            self.assertEqual(owner['asset'],'canonical_poses_'+outfit if clip.get('authoring') else 'portrait_'+outfit)
                            if not owner.get('motion'):self.assertIn('skeleton',owner)
                        else:self.assertIn('motion',owner)
                        self.assertIn('volume',owner)
                        if name.startswith(('lawrence','hazelita')):
                            if clip.get('motionModel')=='canonical-painted-depth25-v5':
                                guest=frame['layers'][5:]
                                self.assertEqual(len(guest),5)
                                self.assertEqual(guest[0]['asset'],'portrait_'+name.split('-')[0])
                                self.assertEqual(len({l['opacity'] for l in guest}),1)
                                continue
                            guest=frame['layers'][1:]
                            if clip.get('interaction',{}).get('pairedContact'):
                                self.assertEqual(guest,[])
                                self.assertEqual(owner['target'][2],384)
                            else:
                                self.assertEqual(len(guest),1)
                                self.assertNotEqual(guest[0]['asset'],owner['asset'])
                                self.assertIn('stableMaterial',guest[0])
                            if guest:self.assertEqual(len({l['opacity'] for l in guest}),1)
        self.assertEqual(count,60)

    def test_all_textures_are_real_rgba_within_the_resident_budget(self):
        total=0
        for key in self.manifest['artwork']['residentAssets']:
            with Image.open(ROOT/self.manifest['assets'][key]) as image:
                self.assertEqual(image.mode,'RGBA')
                self.assertEqual(list(image.size),[self.manifest['assetMetadata'][key]['width'],self.manifest['assetMetadata'][key]['height']])
                total+=image.width*image.height*4
        self.assertLess(total,self.manifest['artwork']['maxDecodedBytes'])

if __name__=='__main__':unittest.main()
