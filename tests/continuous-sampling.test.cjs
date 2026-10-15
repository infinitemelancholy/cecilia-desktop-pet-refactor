const {test}=require('node:test'),assert=require('node:assert/strict');
const Player=require('../renderer-player.js');
test('the live sampler advances inside a display sample instead of repeating its geometry',()=>{
  assert.equal(typeof Player.sampleContinuous,'function','Missing continuous-time pose sampler');
  const motion=t=>({asset:'f',first:[0,0,10,10],second:[10,0,10,10],poseSize:[10,10],flowFirst:[0,0,8,8],flowSecond:[8,0,8,8],anchorMix:t,time:t,range:2,gridHeight:8});
  const clip={frames:[0,.5].map(t=>({duration:10,layers:[{asset:'p',source:[0,0,10,10],target:[0,0,192,208],motion:motion(t)}]}))};
  const sample=Player.sampleContinuous(clip,5,0);
  assert.equal(sample.layers[0].motion.time,.25);
  assert.equal(sample.layers[0].motion.anchorMix,.25);
});
test('continuous sampling never interpolates across a different painted pose or flow interval',()=>{
  assert.equal(typeof Player.sampleContinuous,'function','Missing continuous-time pose sampler');
  const frames=[0,1].map(i=>({duration:10,layers:[{asset:'p',source:[i*10,0,10,10],target:[0,0,192,208],motion:{asset:'f',first:[i*10,0,10,10],second:[(i+1)*10,0,10,10],time:.9,anchorMix:.4}}]}));
  assert.equal(Player.sampleContinuous({frames},9,0).layers[0].motion.time,.9);
});
