import unittest,sys,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from asset_bundle import validate_authored_motion
class SurfaceArtTest(unittest.TestCase):
    def test_repeated_geometry_cannot_claim_high_fps_motion(self):
        clip={'motionModel':'continuous-painted-surface-v1','frames':[{'layers':[{'matrix':[1,0,0,1,0,0]}]}]*120}
        with self.assertRaisesRegex(ValueError,'distinct continuous'):validate_authored_motion(clip,{})
    def test_continuous_geometry_reports_its_evidence_limit(self):
        clip={'motionModel':'continuous-painted-surface-v1','frames':[{'layers':[{'matrix':[1,0,0,1,math.sin(i/120*2*math.pi),0]}]} for i in range(120)]}
        report=validate_authored_motion(clip,{})
        self.assertIn('desktop timing',report['limitation'])
if __name__=='__main__':unittest.main()
