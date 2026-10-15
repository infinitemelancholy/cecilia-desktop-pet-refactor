const {test}=require('node:test'),assert=require('node:assert/strict');
const {Scheduler}=require('../scheduler.js');
const options={outfits:['classic'],danceIds:['op-turn'],timingRevision:5,danceMs:10000,
  interludeMs:15000,showcaseMs:2400,recoveryMs:1200,outfitInterval:[300000,600000],
  sceneDurations:{hop:7200},duoScenes:[],random:()=>0,
  outfitTimings:{classic:{danceDurationsMs:{'op-turn':10000},sceneDurations:{hop:7200},showcaseMs:2400}}};

test('a hop saved during ascent retains its scene progress after its time is compressed',()=>{
  const old=new Scheduler(options);old.state.phase='interlude';old.state.scene='hop';old.state.phaseElapsed=3600;
  const updated=JSON.parse(JSON.stringify(options));updated.timingRevision=6;
  updated.outfitTimings.classic.sceneDurations.hop=1500;
  updated.previousTiming={revision:5,outfitTimings:options.outfitTimings};
  const restored=new Scheduler({...updated,saved:old.snapshot()});
  assert.equal(restored.tick(0).clip,'hop');assert.equal(restored.state.phaseElapsed,750);
});

test('a completed hop stays in its rest period during speed migration',()=>{
  const old=new Scheduler(options);old.state.phase='interlude';old.state.scene='hop';old.state.phaseElapsed=8200;
  const updated=JSON.parse(JSON.stringify(options));updated.timingRevision=6;
  updated.outfitTimings.classic.sceneDurations.hop=1500;
  updated.previousTiming={revision:5,outfitTimings:options.outfitTimings};
  const restored=new Scheduler({...updated,saved:old.snapshot()});
  assert.equal(restored.tick(0).clip,'idle');assert.equal(restored.state.phaseElapsed,2500);
});
