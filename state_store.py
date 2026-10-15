"""Atomic visible-time checkpoints and one-way migration from scheduler v1."""
import json
import math
from pathlib import Path

from asset_bundle import DAILY, OUTFITS

DANCES=('op-turn','small-sway','tiptoe-clap')
DANCE_MS=11789.5555555556
DANCE_DURATIONS={'op-turn':18000,'small-sway':14000,'tiptoe-clap':8400}
INTERLUDE_MS=15000
SHOWCASE_MS=2400
RECOVERY_MS=1200


class StateStore:
    def __init__(self,path):
        self.path=Path(path)

    @staticmethod
    def _finite(value):
        return type(value) in (int,float) and math.isfinite(value) and value>=0

    @staticmethod
    def _bag(value,choices):
        return isinstance(value,list) and all(item in choices for item in value) and len(set(value))==len(value)

    @classmethod
    def _durations(cls,state):
        if state.get('timingRevision') in (4,5,6,7,8,9):
            limits=state.get('timingLimits')
            if not isinstance(limits,dict) or any(not cls._finite(limits.get(k)) or limits[k]<=0 for k in ('dance','interlude','showcase')):
                return None
            return limits
        dance_limit=DANCE_DURATIONS.get(state.get('danceId'),DANCE_MS) if state.get('timingRevision')==3 else DANCE_MS
        return {'dance':dance_limit,'interlude':INTERLUDE_MS,'showcase':SHOWCASE_MS}

    @classmethod
    def _valid_common(cls,state,version):
        if not isinstance(state,dict) or state.get('version')!=version or state.get('outfit') not in OUTFITS:
            return False
        tasks=('running','waiting','failed','review')
        resume=state.get('resume')
        if state.get('phase')=='showcase':
            if not isinstance(resume,dict) or resume.get('phase') not in ('dance','interlude'):
                return False
            if not cls._finite(resume.get('elapsed')):
                return False
            durations=cls._durations(state)
            if durations is None or resume['elapsed']>=durations[resume['phase']]:
                return False
        elif resume is not None:
            return False
        return (state.get('phase') in ('dance','interlude','showcase')
          and all(cls._finite(state.get(k)) for k in ('visibleMs','phaseElapsed','nextOutfitAt','recoveryRemaining','taskElapsed'))
          and (state.get('scene') is None or state.get('scene') in DAILY)
          and (state.get('phase')!='interlude' or state.get('scene') in DAILY)
          and (state.get('lastScene') is None or state.get('lastScene') in DAILY)
          and state.get('lastMode') in ('daily','native','gaze','task')
          and state.get('lastTask') in (None,*tasks)
          and cls._bag(state.get('sceneBag'),DAILY) and cls._bag(state.get('outfitBag'),OUTFITS))

    @classmethod
    def _valid_v1(cls,state):
        if not cls._valid_common(state,1):
            return False
        limit={'dance':DANCE_MS,'interlude':INTERLUDE_MS,'showcase':SHOWCASE_MS}[state['phase']]
        return state['phaseElapsed'] < limit

    @classmethod
    def valid(cls,state):
        if not cls._valid_common(state,2):
            return False
        durations=cls._durations(state)
        if durations is None or state['phaseElapsed'] >= durations[state['phase']]:
            return False
        dance=state.get('danceId')
        if dance is not None and dance not in DANCES:
            return False
        if state['phase']=='dance' and dance is None and state['phaseElapsed'] != 0:
            return False
        return ((state.get('lastDance') is None or state.get('lastDance') in DANCES)
          and cls._bag(state.get('danceBag'),DANCES))

    @staticmethod
    def migrate_v1(state):
        migrated=dict(state)
        migrated.update(version=2,phase='dance',phaseElapsed=0,danceId=None,danceBag=[],lastDance=None,
                        scene=None,lastMode='native',lastTask=None,taskElapsed=0,
                        recoveryRemaining=RECOVERY_MS,resume=None)
        return migrated

    def load(self):
        try:
            state=json.loads(self.path.read_text('utf8'))
            if self._valid_v1(state):
                return self.migrate_v1(state)
            if isinstance(state,dict) and state.get('version')==2 and state.get('timingRevision') not in (3,4,5,6,7,8,9):
                if not self.valid(state):return None
                ratio=DANCE_DURATIONS.get(state.get('danceId'),DANCE_MS)/DANCE_MS
                if state.get('phase')=='dance':state['phaseElapsed']*=ratio
                if state.get('resume',{} ) and state['resume']['phase']=='dance':state['resume']['elapsed']*=ratio
                state['timingRevision']=3
            return state if self.valid(state) else None
        except (OSError,ValueError,TypeError):
            return None

    def save(self,state):
        if not self.valid(state):
            return
        self.path.parent.mkdir(parents=True,exist_ok=True)
        temporary=self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state,ensure_ascii=False,indent=2),'utf8')
        temporary.replace(self.path)
