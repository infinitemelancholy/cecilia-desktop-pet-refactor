const {test}=require('node:test');
const assert=require('node:assert/strict');
const V=require('./candidate/volume-mesh.js');
test('new spatial projection is exactly neutral at rest',()=>{
  assert.equal(typeof V.spatialOffset,'function');
  for(const [u,v] of [[.5,.25],[.2,.6],[.8,.6],[.47,.971]])
    assert.deepEqual(V.spatialOffset(u,v,{bodyYaw:0,headYaw:0,time:0}),[0,0,0]);
});
test('head and rear hair move in opposite directions under the same camera turn',()=>{
  assert.equal(typeof V.spatialOffset,'function');
  const m={bodyYaw:.3,headYaw:.3,time:0};
  const front=V.spatialOffset(.5,.25,m),back=V.spatialOffset(.82,.6,m);
  assert.ok(front[0]>.025,'Visible head volume must have clear parallax');
  assert.ok(back[0]<-.015,'Rear hair must remain behind the face');
});
test('feet remain planted through body turns, light changes and breathing',()=>{
  assert.equal(typeof V.spatialOffset,'function');
  for(const angle of [-.35,-.2,0,.2,.35])for(const time of [0,1,3,5])for(const u of [.45,.5,.55])
    assert.deepEqual(V.spatialOffset(u,.975,{bodyYaw:angle,headYaw:-angle,time}),[0,0,0]);
});
test('bounded spatial motion cannot fold the character surface',()=>{
  assert.equal(typeof V.spatialOffset,'function');
  const e=1e-4;
  for(const angle of [-.35,0,.35])for(const time of [0,1,3])for(let row=0;row<=30;row++)for(let col=0;col<=24;col++){
    const u=col/24,v=row/30,m={bodyYaw:angle,headYaw:-angle,time};
    const point=(x,y)=>{const a=V.spatialOffset(x,y,m);return [x+a[0],y+a[1]];};
    const l=point(u-e,v),r=point(u+e,v),t=point(u,v-e),b=point(u,v+e);
    const xx=(r[0]-l[0])/(2*e),xy=(b[0]-t[0])/(2*e),yx=(r[1]-l[1])/(2*e),yy=(b[1]-t[1])/(2*e);
    assert.ok(xx*yy-xy*yx>.2,`Fold at ${u},${v}; angle ${angle}`);
  }
});
test('lighting responds to the turn while legacy curved offsets remain unchanged',()=>{
  assert.equal(typeof V.spatialOffset,'function');
  const a=V.spatialOffset(.5,.25,{bodyYaw:.3,headYaw:.3,time:0});
  const b=V.spatialOffset(.5,.25,{bodyYaw:-.3,headYaw:-.3,time:0});
  assert.notEqual(a[2],b[2]);assert.ok(Math.abs(a[2])<.18&&Math.abs(b[2])<.18);
  assert.deepEqual(V.offset(.5,1,{bodyYaw:.3,headYaw:.3,time:0}),[0,0,0]);
});
test('invalid depth profiles and large fake turns are refused',()=>{
  assert.equal(typeof V.spatialOffset,'function');
  for(const profile of [{headDepth:NaN},{cameraDistance:.1},{rearHairDepth:-1},{lighting:Infinity}])
    assert.throws(()=>V.spatialOffset(.5,.3,{bodyYaw:.2,headYaw:.2,time:0},profile));
  assert.throws(()=>V.spatialOffset(.5,.3,{bodyYaw:1,headYaw:0,time:0}));
});
