const {test}=require('node:test');
const assert=require('node:assert/strict');
const Volume=require('./candidate/volume-mesh.js');
test('small whole-head correction is uniform and leaves the sole anchored',()=>{
  assert.equal(typeof Volume.alignPoint,'function');
  const a={sourceY:.48,targetY:.40,floorY:.97,headScale:1.09};
  const left=Volume.alignPoint(.45,.33,a),right=Volume.alignPoint(.55,.33,a);
  const top=Volume.alignPoint(.5,.30,a),bottom=Volume.alignPoint(.5,.36,a);
  assert.ok(Math.abs(right[0]-left[0]-.10*1.09)<1e-12);
  assert.ok(Math.abs(bottom[1]-top[1]-.06*1.09)<1e-12);
  assert.deepEqual(Volume.alignPoint(.5,.97,a),[.5,.97]);
});
test('neck joins continuously while cheek and shoulder widths remain monotonic',()=>{
  assert.equal(typeof Volume.alignPoint,'function');
  const a={sourceY:.48,targetY:.40,floorY:.97,headScale:1.09};
  const above=Volume.alignPoint(.55,.48-1e-8,a),below=Volume.alignPoint(.55,.48+1e-8,a);
  assert.ok(Math.hypot(above[0]-below[0],above[1]-below[1])<1e-6);
  for(const v of [.20,.42,.46,.48,.60]){
    let last=-Infinity;
    for(let i=0;i<=100;i++){const p=Volume.alignPoint(i/100,v,a);assert.ok(p[0]>last);last=p[0];}
  }
});
test('default head scale keeps historical registered images identical',()=>{
  assert.equal(typeof Volume.alignPoint,'function');
  const a={sourceY:.48,targetY:.40,floorY:.97};
  assert.deepEqual(Volume.alignPoint(.2,.30,a),[.2,Volume.alignY(.30,a)]);
  assert.deepEqual(Volume.alignPoint(.2,.60,a),[.2,Volume.alignY(.60,a)]);
});
test('large or non-finite head corrections are refused instead of hiding bad art',()=>{
  assert.equal(typeof Volume.alignPoint,'function');
  for(const headScale of [NaN,0,.75,1.25,Infinity])
    assert.throws(()=>Volume.alignPoint(.4,.3,{sourceY:.48,targetY:.40,floorY:.97,headScale}));
});
