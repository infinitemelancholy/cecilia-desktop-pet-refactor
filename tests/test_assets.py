import json
from pathlib import Path
import sys
import tempfile
import unittest
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
try:
    import asset_bundle
except ImportError:
    asset_bundle=None

class AssetsTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        # Small non-character pixels test only the parser; never delivered as art.
        Image.new('RGBA',(8,8),(20,40,60,255)).save(self.root/'fixture.png')
        self.manifest={'version':2,'ready':False,
          'petId':'pet_6ac71429ba50819188d4388111562bbd',
          'assets':{'fixture':'fixture.png'},'outfits':{},'schedule':{}}
    def write(self):
        (self.root/'manifest.json').write_text(json.dumps(self.manifest),'utf8')
    def api(self):
        self.assertIsNotNone(asset_bundle,'asset bundle loader must be implemented')
        return asset_bundle
    def test_pending_art_cannot_replace_a_working_pet(self):
        self.write()
        with self.assertRaisesRegex(ValueError,'not ready'):
            self.api().load_bundle(self.root)
    def test_paths_cannot_escape_the_bundle(self):
        self.manifest['assets']['fixture']='../external.png';self.write()
        with self.assertRaisesRegex(ValueError,'outside'):
            self.api().load_bundle(self.root,require_ready=False)
    def test_corrupt_images_are_rejected_before_injection(self):
        (self.root/'fixture.png').write_bytes(b'not an image');self.write()
        with self.assertRaisesRegex(ValueError,'PNG'):
            self.api().load_bundle(self.root,require_ready=False)
    def test_complete_bundle_requires_all_three_outfits(self):
        self.manifest['ready']=True;self.write()
        with self.assertRaisesRegex(ValueError,'classic.*travel.*cafe'):
            self.api().load_bundle(self.root)
    def test_dance_rejects_low_effective_frame_rate(self):
        clip={'frames':[{'duration':100} for _ in range(12)],'loop':[0,12]}
        with self.assertRaisesRegex(ValueError,'60 fps'):
            self.api().validate_dance(clip)
    def test_source_dance_uses_60_fps_for_one_5895ms_cycle(self):
        count=round(5894.7777777778*60/1000)
        clip={'frames':[{'duration':5894.7777777778/count} for _ in range(count)],'loop':[0,count]}
        self.api().validate_dance(clip)
    def test_exact_encoded_png_is_embedded_for_local_offline_playback(self):
        self.write();config=self.api().load_bundle(self.root,require_ready=False)
        self.assertTrue(config['assets']['fixture'].startswith('data:image/png;base64,'))
    def test_repeated_raster_poses_cannot_masquerade_as_24_authored_fps(self):
        image=Image.open(self.root/'fixture.png').convert('RGBA')
        layer={'asset':'fixture','source':[0,0,8,8],'target':[0,0,192,208]}
        clip={'frames':[{'duration':5894.7777777778/144,'layers':[layer]} for _ in range(144)]}
        with self.assertRaisesRegex(ValueError,'distinct'):
            self.api().validate_authored_motion(clip,{'fixture':image})
    def test_invalid_opacity_is_rejected_before_the_native_layer_changes(self):
        image=Image.open(self.root/'fixture.png').convert('RGBA')
        clip={'frames':[{'duration':40,'layers':[{'asset':'fixture','source':[0,0,8,8],
            'target':[0,0,192,208],'opacity':-1}]}]}
        with self.assertRaisesRegex(ValueError,'opacity'):
            self.api().check_clip(clip,{'fixture':image})
    def test_malformed_limb_masks_are_rejected_before_gpu_upload(self):
        image=Image.open(self.root/'fixture.png').convert('RGBA')
        layer={'asset':'fixture','source':[0,0,8,8],'target':[0,0,192,208]}
        for mask in ({'polygon':[[0,0]]*11,'yBounds':[0,1]},
                     {'polygon':[[0,0],[1,0],[float('nan'),1]],'yBounds':[0,1]},
                     {'polygon':[[0,0],[1,0],[0,1]],'yBounds':[1,0]}):
            with self.subTest(mask=mask),self.assertRaisesRegex(ValueError,'Limb mask'):
                self.api().check_clip({'frames':[{'duration':40,'layers':[{**layer,'partMask':mask}]}]},{'fixture':image})

if __name__=='__main__':unittest.main()
