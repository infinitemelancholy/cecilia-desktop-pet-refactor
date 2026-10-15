"""A short native action must start on cel zero and expose its entire timeline."""
import json,unittest
from pathlib import Path
OUT=Path(__file__).resolve().parents[2]/'outputs'/'重构验证'/'完整动作试作'
class NativeRecordingStart(unittest.TestCase):
    def test_corrected_native_recording_has_a_verified_first_cel_and_complete_scheduler_coverage(self):
        record=json.loads((OUT/'原生试作验证-v13.json').read_text('utf8'));r=record['results'][0]
        self.assertEqual(r['firstSourceFrame'],0);self.assertTrue(r['sourceClockStartedAfterFirstCapture'])
        self.assertEqual(set(r['schedulerIndicesBeforeCapture']),set(range(18)))
        self.assertTrue(record['restoredManifest']);self.assertTrue(all(record['restoredModules'].values()))
        self.assertFalse(record['remainingPilotFiles']);self.assertFalse(record['cleanup']['probeActive'])
if __name__=='__main__':unittest.main()
