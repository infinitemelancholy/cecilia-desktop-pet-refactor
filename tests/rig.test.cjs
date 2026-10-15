const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');const file=path.join(__dirname,'..','rig-motion.js');
const rig=fs.existsSync(file)?require(file):{};
test('two-bone arm matrices meet at one elbow and reach a reachable hand target',()=>{
  assert.equal(typeof rig.arm,'function','fixed painted limbs need a deterministic bone solver');
  const shoulder=[84,80],elbow=[73,106],wrist=[61,130],goal=[92,103];
  const solved=rig.arm(shoulder,elbow,wrist,goal,1);
  const upperElbow=rig.apply(solved.upper,elbow),lowerElbow=rig.apply(solved.lower,elbow),hand=rig.apply(solved.lower,wrist);
  assert.ok(Math.hypot(upperElbow[0]-lowerElbow[0],upperElbow[1]-lowerElbow[1])<1e-7);
  assert.ok(Math.hypot(hand[0]-goal[0],hand[1]-goal[1])<1e-7);
});
test('cyclic walking and dance parameters have continuous loop positions',()=>{
  assert.equal(typeof rig.pose,'function');
  for(const name of ['running','idle','op-turn','small-sway','tiptoe-clap']){
    const a=rig.pose(name,0),b=rig.pose(name,1);
    for(const key of ['rootY','roll','headRoll','bodyYaw','headYaw'])assert.ok(Math.abs(a[key]-b[key])<1e-8,name+'/'+key);
    for(const key of ['leftHand','rightHand'])assert.ok(Math.hypot(a[key][0]-b[key][0],a[key][1]-b[key][1])<1e-7,name+'/'+key);
  }
});
test('a gentle jump returns neutral and raises tucked feet without crossing the window top',()=>{
  assert.equal(typeof rig.pose,'function');
  const first=rig.pose('hop',0),last=rig.pose('hop',1),air=rig.pose('hop',.5);
  assert.ok(Math.abs(first.rootY)<1e-9 && Math.abs(last.rootY)<1e-9);
  assert.ok(air.legLift>12,'the visible feet leave the ground');
  assert.ok(air.rootY>=-4,'retain space above the fixed-size native canvas');
});
