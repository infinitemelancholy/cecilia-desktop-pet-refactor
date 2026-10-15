import sys
import json
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))


class GPUFlowTest(unittest.TestCase):
    def test_joint_scene_has_no_duplicate_owner_in_the_companion_half(self):
        root=Path(__file__).resolve().parents[1]
        manifest=json.loads((root/'manifest.json').read_text('utf8'))
        for outfit in manifest['outfits']:
            clip=manifest['outfits'][outfit]['clips']['lawrence-sleeve']
            layer=clip['frames'][0]['layers'][0]
            if clip.get('motionModel') in ('authored-multiview-depth25-v3','registered-occlusion-depth25-v4'):
                if clip.get('interaction',{}).get('pairedContact'):
                    self.assertTrue(all(len(f['layers'])==1 and f['layers'][0]['target'][2]==384 for f in clip['frames']))
                    with Image.open(root/manifest['assets'][layer['asset']]) as atlas:
                        width,height=layer['motion']['poseSize'];x,y,_,_=layer['source']
                        alpha=np.asarray(atlas.crop((x+width//2,y,x+width,y+height)))[:,:,3]
                        self.assertLess(int((alpha>128).sum()),50,'Neutral entry has no duplicate owner in the companion slot')
                    continue
                for frame in clip['frames']:
                    self.assertEqual(len(frame['layers']),2)
                    self.assertIn('mv3_lawrence_',frame['layers'][1]['asset'])
                guest_key=clip['frames'][0]['layers'][1]['asset']
                with Image.open(root/manifest['assets'][guest_key]) as guest:
                    pixels=np.asarray(guest).astype(float)
                    green=(pixels[:,:,1]>pixels[:,:,0]*1.04)&(pixels[:,:,1]>pixels[:,:,2]*1.15)&(pixels[:,:,3]>200)
                    self.assertLess(int(green.sum()),50,'Partner bank must not contain a duplicate Cecilia')
                continue
            if clip.get('motionModel') in ('continuous-painted-surface-v1','canonical-painted-depth25-v5'):
                for frame in clip['frames']:
                    portraits=[l['asset'] for l in frame['layers'] if l['asset'].startswith('portrait_')]
                    self.assertEqual(portraits,['portrait_'+outfit,'portrait_lawrence'])
                    if manifest['artwork'].get('hybridRevision'):
                        self.assertEqual(len(frame['layers']),10)
                        self.assertTrue(all(l['asset']=='painted_'+outfit for l in frame['layers'][1:5]))
                        self.assertTrue(all(l['asset']=='painted_lawrence' for l in frame['layers'][6:]))
                with Image.open(root/manifest['assets']['portrait_lawrence']) as guest:
                    self.assertEqual(guest.size,(1024,1536))
                    pixels=np.asarray(guest).astype(float)
                    green=(pixels[:,:,1]>pixels[:,:,0]*1.04)&(pixels[:,:,1]>pixels[:,:,2]*1.15)&(pixels[:,:,3]>200)
                    self.assertLess(int(green.sum()),50,'Lawrence portrait must not contain an extra green-haired owner')
                continue
            with Image.open(root/manifest['assets'][layer['asset']]) as atlas:
                width,height=layer['motion']['poseSize']
                for x in range(0,atlas.width,width):
                    pixels=np.asarray(atlas.crop((x+width//2,0,x+width,height)))
                    green=(pixels[:,:,1]>pixels[:,:,0]*1.04)&(pixels[:,:,1]>pixels[:,:,2]*1.15)&(pixels[:,:,3]>200)
                    self.assertLess(int(green.sum()),15,(outfit,'misregistered Cecilia copy in companion half'))

    def test_signed_flow_encoding_preserves_zero_and_subpixel_geometry(self):
        module=Path(__file__).resolve().parents[1]/'gpu_motion.py'
        self.assertTrue(module.is_file(),'GPU flow compiler must exist')
        from gpu_motion import encode_flow
        field=np.zeros((64,64,4),dtype=np.float32)
        field[10:30,10:30,0]=23.75;field[10:30,10:30,3]=-15.25
        image,span=encode_flow(field)
        decoded=(np.asarray(image).astype(float)-128)*span/127
        self.assertTrue(np.all(decoded[0,0]==0))
        self.assertLess(float(np.abs(decoded-field).max()),span/127+.001)

    def test_flow_png_is_opaque_so_image_decoding_cannot_destroy_motion_channels(self):
        from gpu_motion import pack_flow_field
        field=np.zeros((20,24,4),dtype=np.float32);field[:,:,0]=12.5;field[:,:,3]=-40
        image=pack_flow_field(field,50)
        pixels=np.asarray(image)
        self.assertTrue(np.all(pixels[:,:,3]==255))
        encoded=np.dstack([pixels[:20,:,:3],pixels[20:,:,0]])
        decoded=(encoded.astype(float)-128)*50/127
        self.assertLess(float(abs(decoded-field).max()),50/127)


if __name__=='__main__':unittest.main()
