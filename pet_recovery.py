"""Recover a stuck native default without overriding the user's pet selection."""
import logging
import time
import tomllib
from pathlib import Path


class PetRecovery:
    def __init__(self,config_path,clock=time.monotonic):
        self.config_path=Path(config_path)
        self.clock=clock
        self.waiting={}
        self.last_reload={}

    def ready(self,transport,expected,target_id):
        actual=transport.evaluate("document.querySelector('[data-codex-pet-state]')?.dataset.codexPetId||null")
        if actual==expected:
            self.waiting.pop(target_id,None)
            return True
        try:
            config=tomllib.loads(self.config_path.read_text('utf8'))
            selected=config.get('desktop',{}).get('selected-avatar-id')
        except (OSError,ValueError):
            selected=None
        if actual!='codex' or selected!=expected:
            self.waiting.pop(target_id,None)
            return False
        now=self.clock()
        since=self.waiting.setdefault(target_id,now)
        if now-since>=15 and now-self.last_reload.get(target_id,float('-inf'))>=120:
            self.last_reload[target_id]=now
            self.waiting.pop(target_id,None)
            logging.info('Reloading stuck default pet; saved selection remains %s',expected)
            transport.command('Page.reload',{})
        return False
