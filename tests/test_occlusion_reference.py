import json,tempfile,unittest,sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from gpu_raster import RasterReference
from asset_bundle import validate_authored_motion

class OcclusionReference(unittest.TestCase):
    def test_registered_gpu_geometry_is_validated_as_motion(self):
        frames=[{'layers':[{'asset':'painted','source':[(i//30)*192,0,192,208],'target':[0,0,192,208],'motion':{'asset':'flow','time':i/120,'anchorMix':i%9/8}}]} for i in range(120)]
        try:report=validate_authored_motion({'motionModel':'registered-occlusion-depth25-v4','frames':frames},{'painted':Image.new('RGBA',(768,208),(40,70,90,255))})
        except ValueError as error:self.fail('Registered GPU animation incorrectly rejected as repeated source rasters: '+str(error))
        self.assertGreater(report['distinctGeometrySamples'],100)
    def test_occlusion_reference_preserves_opacity_and_has_no_midpoint_cut(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);poses=Image.new('RGBA',(128,64),(255,0,0,255));poses.paste(Image.new('RGBA',(64,64),(0,0,255,255)),(64,0));poses.save(root/'p.png')
            Image.new('RGBA',(16,16),(128,128,128,255)).save(root/'f.png')
            reference=RasterReference(root,{'assets':{'p':'p.png','f':'f.png'}})
            layer={'asset':'p','source':[0,0,64,64],'target':[0,0,64,64],'motion':{'asset':'f','first':[0,0,64,64],'second':[64,0,64,64],'poseSize':[64,64],'flowFirst':[0,0,8,8],'flowSecond':[8,0,8,8],'anchorMix':0,'time':.4999,'range':1,'gridHeight':8,'visibility':True}}
            a=reference.layer(layer);layer['motion']['time']=.5001;b=reference.layer(layer)
            self.assertLess(float(abs(a-b).max()),.01)
            self.assertEqual(float(a[32,32,3]),1)
            reference.close()

if __name__=='__main__':unittest.main()
