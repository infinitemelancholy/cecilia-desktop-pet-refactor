const {test}=require('node:test'),assert=require('node:assert/strict');
const Player=require('../renderer-player.js');
function layer(x,opacity=1){return {asset:'painted',source:[0,0,1024,1536],target:[26,5,140,202],matrix:[1,0,0,1,x,0],volume:{bodyYaw:x/100,headYaw:0,time:0},skeleton:{limbs:[0,0,0,0],torso:[0,0,0,0],legs:[x/100,0,0]},opacity};}
test('painted character layers advance between presentation samples',()=>{
 const clip={motionModel:'canonical-painted-depth25-v5',frames:[{duration:10,layers:[layer(0,0)]},{duration:10,layers:[layer(10,1)]}]};
 const l=Player.sampleContinuous(clip,5,0).layers[0];
 assert.equal(l.matrix[4],5);assert.equal(l.volume.bodyYaw,.05);assert.equal(l.skeleton.legs[0],.05);assert.equal(l.opacity,.5);
});
test('painted loop interpolation reaches the first pose without a held final sample',()=>{
 const clip={motionModel:'canonical-painted-depth25-v5',loop:[0,2],frames:[{duration:10,layers:[layer(0)]},{duration:10,layers:[layer(10)]}]};
 assert.equal(Player.sampleContinuous(clip,15,1).layers[0].matrix[4],5);
});
test('painted interpolation preserves the immutable art and masks',()=>{
 const mask={polygon:[[0,0],[1,0],[0,1]],yBounds:[0,.5]};
 const a={...layer(0),partMask:mask},b={...layer(10),partMask:mask};
 const clip={motionModel:'canonical-painted-depth25-v5',frames:[{duration:10,layers:[a]},{duration:10,layers:[b]}]};
 const result=Player.sampleContinuous(clip,5,0).layers[0];assert.equal(result.partMask,mask);assert.deepEqual(result.source,a.source);
});
test('a walking intro loops only over its steady gait without replaying the intro',()=>{
 const clip={motionModel:'canonical-painted-depth25-v5',loop:[1,3],frames:[{duration:10,layers:[layer(100)]},{duration:10,layers:[layer(0)]},{duration:10,layers:[layer(10)]}]};
 assert.equal(Player.sampleContinuous(clip,45,2).layers[0].matrix[4],5);
});
test('fixed painted feet interpolate alongside a flow-driven torso',()=>{
 const torso={asset:'poses',source:[0,0,10,10],motion:{asset:'flow',first:[0,0,10,10],second:[10,0,10,10],time:0,anchorMix:0}};
 const clip={motionModel:'canonical-painted-depth25-v5',frames:[{duration:10,layers:[torso,layer(0)]},{duration:10,layers:[torso,layer(10)]}]};
 assert.equal(Player.sampleContinuous(clip,5,0).layers[1].matrix[4],5);
});
