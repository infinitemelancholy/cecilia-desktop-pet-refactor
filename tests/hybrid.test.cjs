const {test}=require('node:test');
const assert=require('node:assert/strict');
const rig=require('../rig-motion.js');
const resources=require('./rig-resources.json').rig;
const close=(a,b)=>a.forEach((value,i)=>assert.ok(Math.abs(value-b[i])<1e-6,`${a} != ${b}`));

test('detached limbs retain each actor neutral painted registration',()=>{
  for(const person of Object.keys(resources.actors)) {
    const layers=rig.hybrid(person,'idle',0,0,resources);
    for(const part of layers.slice(1))close(part.matrix,rig.identity);
  }
});

test('each actor hand follows its own painted bone anchors',()=>{
  for(const person of Object.keys(resources.actors)) {
    const phase=.5,offset=105,p=rig.pose('tiptoe-clap',phase);
    const layers=rig.hybrid(person,'tiptoe-clap',phase,offset,resources);
    for(const [side,index,neutral] of [['left',2,[61,130]],['right',4,[131,130]]]) {
      const [s,e,w,bend]=resources.actors[person].bones[side];
      const hand=p[side+'Hand'];
      const goal=[w[0]+hand[0]-neutral[0],w[1]+hand[1]-neutral[1]];
      const solved=resources.actors[person].shoulderFixed?{lower:rig.rotate(e,Math.atan2(goal[1]-e[1],goal[0]-e[0])-Math.atan2(w[1]-e[1],w[0]-e[0]))}:rig.arm(s,e,w,goal,bend);
      const expected=rig.compose(layers[0].matrix,rig.compose([1,0,0,1,offset,0],solved.lower));
      close(layers[index].matrix,expected);
    }
  }
});

test('costume and Hazelita blouse shoulders remain attached while the forearms move',()=>{
  for(const person of ['classic','travel','cafe','hazelita']) {
    const layers=rig.hybrid(person,'hop',.5,0,resources);
    close(layers[1].matrix,layers[0].matrix);
    close(layers[3].matrix,layers[0].matrix);
    assert.notDeepEqual(layers[2].matrix,layers[0].matrix);
  }
});

test('limb motion leaves the complete cloth surface and shared face stable',()=>{
  for(const person of ['classic','travel','cafe']) {
    const base=rig.hybrid(person,'tiptoe-clap',.5,0,resources)[0];
    assert.deepEqual(base.skeleton.limbs,[0,0,0,0]);
    assert.deepEqual(base.face.transform,resources.faceTransforms[person]);
  }
});

test('the optional separated rig uses the selected actor instead of an undefined person',()=>{
  const layers=rig.expand({target:[26,5,140,202],rig:{person:'travel',action:'idle',phase:0}},resources);
  assert.ok(layers.length>=5);
});
