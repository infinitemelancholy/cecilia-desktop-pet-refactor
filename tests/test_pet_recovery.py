import sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
try:from pet_recovery import PetRecovery
except ImportError:PetRecovery=None
class Transport:
 def __init__(self):self.pet='codex';self.commands=[]
 def evaluate(self,script):return self.pet
 def command(self,method,params):self.commands.append((method,params))
class RecoveryTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.config=Path(self.temp.name)/'config.toml';self.expected='pet_6ac71429ba50819188d4388111562bbd'
  self.choose(self.expected);self.clock=[0];self.transport=Transport()
 def choose(self,pet):self.config.write_text('[desktop]\nselected-avatar-id = "'+pet+'"\n','utf8')
 def recovery(self):
  self.assertIsNotNone(PetRecovery,'default-pet fallback recovery must be implemented')
  return PetRecovery(self.config,clock=lambda:self.clock[0])
 def test_persisted_cecilia_with_stuck_default_pet_reloads_only_after_grace(self):
  r=self.recovery();self.assertFalse(r.ready(self.transport,self.expected,'avatar'))
  self.clock[0]=14;self.assertFalse(r.ready(self.transport,self.expected,'avatar'));self.assertEqual(self.transport.commands,[])
  self.clock[0]=16;self.assertFalse(r.ready(self.transport,self.expected,'avatar'))
  self.assertEqual(self.transport.commands,[('Page.reload',{})])
  self.transport.pet=self.expected;self.assertTrue(r.ready(self.transport,self.expected,'avatar'))
 def test_explicit_other_pet_selection_never_reloads_or_overrides(self):
  self.choose('codex');r=self.recovery()
  r.ready(self.transport,self.expected,'avatar');self.clock[0]=60;r.ready(self.transport,self.expected,'avatar')
  self.assertEqual(self.transport.commands,[])
 def test_recovery_is_throttled_while_cloud_artwork_is_still_loading(self):
  r=self.recovery();r.ready(self.transport,self.expected,'avatar');self.clock[0]=16;r.ready(self.transport,self.expected,'avatar')
  self.clock[0]=40;r.ready(self.transport,self.expected,'avatar');self.clock[0]=120;r.ready(self.transport,self.expected,'avatar')
  self.assertEqual(len(self.transport.commands),1)
 def test_blank_loading_dom_is_not_treated_as_default_pet(self):
  self.transport.pet=None;r=self.recovery();r.ready(self.transport,self.expected,'avatar');self.clock[0]=30;r.ready(self.transport,self.expected,'avatar')
  self.assertEqual(self.transport.commands,[])
if __name__=='__main__':unittest.main()
