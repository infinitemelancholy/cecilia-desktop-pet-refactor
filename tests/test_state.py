from pathlib import Path
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
try:from state_store import StateStore
except ImportError:StateStore=None

class StateTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'state.json'
    def store(self):
        self.assertIsNotNone(StateStore,'reconnection state store must be implemented')
        return StateStore(self.path)
    def test_new_session_has_no_stale_state(self):
        self.assertIsNone(self.store().load())
    def test_visible_clock_and_current_outfit_survive_a_reconnection(self):
        state=self.valid_state()
        self.store().save(state);self.assertEqual(self.store().load(),state)
    @staticmethod
    def valid_state():
        return {'version':2,'timingRevision':3,'outfit':'cafe','visibleMs':350000,'nextOutfitAt':620000,
                'phase':'interlude','phaseElapsed':4000,'scene':'bean',
                'sceneBag':['pout'],'outfitBag':['classic','travel'],'lastScene':'bean',
                'lastMode':'daily','lastTask':None,'taskElapsed':0,'recoveryRemaining':0,'resume':None,
                'danceId':'op-turn','danceBag':['small-sway','tiptoe-clap'],'lastDance':'op-turn'}
    def test_incomplete_checkpoint_cannot_break_the_renderer_after_reconnect(self):
        state=self.valid_state();state.pop('sceneBag')
        self.path.write_text(__import__('json').dumps(state),'utf8')
        self.assertIsNone(self.store().load())
    def test_nonfinite_clock_and_unknown_scene_bag_are_discarded(self):
        for key,value in [('nextOutfitAt',float('nan')),('sceneBag',['missing-scene'])]:
            state=self.valid_state();state[key]=value
            self.path.write_text(__import__('json').dumps(state),'utf8')
            self.assertIsNone(self.store().load())
    def test_corrupt_state_does_not_prevent_native_fallback(self):
        self.path.write_text('{partial','utf8');self.assertIsNone(self.store().load())
    def test_invalid_outfit_state_is_discarded(self):
        self.path.write_text('{"version":1,"outfit":"unknown"}','utf8')
        self.assertIsNone(self.store().load())

if __name__=='__main__':unittest.main()
