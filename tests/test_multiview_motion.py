import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from asset_bundle import validate_authored_motion
from PIL import Image
class MultiviewMotionTest(unittest.TestCase):
    def test_gpu_geometry_is_validated_without_counting_source_rectangles_as_raster_frames(self):
        frames=[]
        for i in range(120):
            layer={'asset':'painted','source':[(i//30)*192,0,192,208],'target':[0,0,192,208],
                   'motion':{'asset':'flow','time':i/120,'anchorMix':i%9/8}}
            frames.append({'layers':[layer]})
        try:report=validate_authored_motion({'motionModel':'authored-multiview-depth25-v3','frames':frames},{'painted':Image.new('RGBA',(768,208),(40,70,90,255))})
        except ValueError as error:self.fail('GPU geometry must be checked before a static source crop: '+str(error))
        self.assertEqual(report['distinctPaintedPoses'],4)
        self.assertGreater(report['distinctGeometrySamples'],100)
    def test_static_flow_cannot_claim_continuous_120hz_motion(self):
        f={'layers':[{'asset':'painted','source':[0,0,192,208],'target':[0,0,192,208],'motion':{'asset':'flow','time':0,'anchorMix':0}}]}
        with self.assertRaisesRegex(ValueError,'distinct'):
            validate_authored_motion({'motionModel':'authored-multiview-depth25-v3','frames':[copy.deepcopy(f) for _ in range(120)]},{'painted':Image.new('RGBA',(768,208),(40,70,90,255))})
if __name__=='__main__':unittest.main()
