import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
try:from install_shortcuts import eligible
except ImportError:eligible=None

class ShortcutTest(unittest.TestCase):
    def test_existing_cecilia_launcher_is_eligible_but_other_chatgpt_install_is_not(self):
        self.assertIsNotNone(eligible,'shortcut target boundary must be implemented')
        original=ROOT/'backup/启动原宠物视线跟随.vbs'
        good=SimpleNamespace(TargetPath=r'C:\Windows\System32\wscript.exe',Arguments=f'"{original}"')
        other=SimpleNamespace(TargetPath=r'C:\Program Files\ChatGPT\ChatGPT.exe',Arguments='')
        self.assertTrue(eligible(good,original));self.assertFalse(eligible(other,original))
    def test_a_different_script_with_the_same_filename_is_not_a_match(self):
        self.assertIsNotNone(eligible,'shortcut target boundary must be implemented')
        original=ROOT/'backup/启动原宠物视线跟随.vbs'
        wrong=SimpleNamespace(TargetPath=r'C:\Windows\System32\wscript.exe',Arguments='"C:\\Other\\启动原宠物视线跟随.vbs"')
        self.assertFalse(eligible(wrong,original))

if __name__=='__main__':unittest.main()
