const {test}=require('node:test');
const assert=require('node:assert/strict');
const Volume=require('./candidate/volume-mesh.js');
const base={sourceY:.48,targetY:.40,floorY:.97,headScale:1};

test('bounded horizontal pose registration preserves head size and planted feet',()=>{
  const a={...base,horizontalShift:.02};
  assert.ok(Math.abs(Volume.alignPoint(.4,.20,a)[0]-.42)<1e-12);
  assert.ok(Math.abs(Volume.alignPoint(.6,.20,a)[0]-.62)<1e-12);
  assert.deepEqual(Volume.alignPoint(.4,.97,a),[.4,.97]);
  const waist=Volume.alignPoint(.4,.70,a)[0];
  assert.ok(waist>.4&&waist<.42);
});
test('registration rejects oversized or nonfinite shifts',()=>{
  for(const horizontalShift of [NaN,Infinity,.026,-.026])
    assert.throws(()=>Volume.alignPoint(.4,.2,{...base,horizontalShift}));
});
test('omitted and zero horizontal shift retain legacy geometry exactly',()=>{
  for(const v of [.1,.3,.48,.7,.97])
    assert.deepEqual(Volume.alignPoint(.4,v,base),Volume.alignPoint(.4,v,{...base,horizontalShift:0}));
});
