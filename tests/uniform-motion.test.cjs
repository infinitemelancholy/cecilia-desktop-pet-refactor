const {test}=require('node:test'),assert=require('node:assert/strict');
const {Scheduler}=require('../scheduler.js');
const options={outfits:['classic','cafe'],danceIds:['op-turn'],danceMs:18000,danceDurationsMs:{'op-turn':18000},
  interludeMs:15000,showcaseMs:2400,recoveryMs:1200,outfitInterval:[300000,600000],
  sceneDurations:{'lawrence-sleeve':8000},duoScenes:['lawrence-sleeve'],random:()=>0,
  outfitTimings:{classic:{danceDurationsMs:{'op-turn':12000},sceneDurations:{'lawrence-sleeve':3000},showcaseMs:4200},
    cafe:{danceDurationsMs:{'op-turn':26000},sceneDurations:{'lawrence-sleeve':3200},showcaseMs:5000}}};
test('each outfit uses the calibrated dance clock and plays two full cycles',()=>{
  for(const [outfit,duration] of [['classic',12000],['cafe',26000]]){
    const s=new Scheduler(options);s.state.outfit=outfit;
    assert.equal(s.tick(duration-1).clip,'dance');assert.equal(s.tick(1).clip,'lawrence-sleeve');
  }
});
test('interaction ends at its calibrated clock rather than the old eight-second clock',()=>{
  const s=new Scheduler(options);s.state.phase='interlude';s.state.scene='lawrence-sleeve';s.state.phaseElapsed=0;
  assert.equal(s.tick(2999).clip,'lawrence-sleeve');assert.equal(s.tick(1).clip,'idle');
});
test('migration preserves outfit and progress when moving from the previous timing revision',()=>{
  const old=new Scheduler({...options,outfitTimings:undefined});old.state.outfit='cafe';old.state.phaseElapsed=9000;
  const saved=old.snapshot();saved.timingRevision=3;
  const current=new Scheduler({...options,saved});assert.equal(current.state.outfit,'cafe');
  assert.equal(current.state.phaseElapsed,13000);assert.equal(current.state.timingRevision,4);
});
test('a reconnect with the calibrated timing revision does not retime the saved progress a second time',()=>{
  const s=new Scheduler(options);s.state.outfit='cafe';s.state.phaseElapsed=25000;
  const restored=new Scheduler({...options,saved:s.snapshot()});
  assert.equal(restored.state.phaseElapsed,25000);assert.equal(restored.state.timingRevision,4);
});
test('a calibrated scene longer than the old interlude cannot be truncated',()=>{
  const extended={...JSON.parse(JSON.stringify(options)),random:()=>0};extended.outfitTimings.classic.sceneDurations['lawrence-sleeve']=18000;
  const s=new Scheduler(extended);s.state.phase='interlude';s.state.scene='lawrence-sleeve';
  assert.equal(s.tick(17999).clip,'lawrence-sleeve');assert.equal(s.tick(1).clip,'dance');
});

test('revision five keeps costume and dance progress while increasing speed ten percent',()=>{
  const old=new Scheduler(options);old.state.outfit='cafe';old.state.phaseElapsed=25000;
  const updated=JSON.parse(JSON.stringify(options));updated.timingRevision=5;
  updated.outfitTimings.cafe.danceDurationsMs['op-turn']/=1.1;
  const restored=new Scheduler({...updated,saved:old.snapshot()});
  assert.equal(restored.state.outfit,'cafe');assert.equal(restored.state.timingRevision,5);
  assert.ok(Math.abs(restored.state.phaseElapsed-25000/1.1)<1e-8);
  const again=new Scheduler({...updated,saved:restored.snapshot()});
  assert.equal(again.state.phaseElapsed,restored.state.phaseElapsed);
});
test('speed migration keeps scene progress and retimes a dance paused for outfit showcase',()=>{
  const old=new Scheduler(options);old.state.outfit='cafe';old.state.phase='showcase';
  old.state.phaseElapsed=1000;old.state.resume={phase:'dance',elapsed:25000};
  const updated=JSON.parse(JSON.stringify(options));updated.timingRevision=5;
  updated.outfitTimings.cafe.danceDurationsMs['op-turn']/=1.1;
  const restored=new Scheduler({...updated,saved:old.snapshot()});
  assert.equal(restored.state.phaseElapsed,1000);
  assert.ok(Math.abs(restored.state.resume.elapsed-25000/1.1)<1e-8);
  old.state.phase='interlude';old.state.scene='lawrence-sleeve';old.state.phaseElapsed=4000;old.state.resume=null;
  assert.equal(new Scheduler({...updated,saved:old.snapshot()}).state.phaseElapsed,4000);
});
