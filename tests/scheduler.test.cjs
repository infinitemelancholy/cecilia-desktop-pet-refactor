const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '..', 'scheduler.js');
const api = fs.existsSync(modulePath) ? require(modulePath) : {};
function engine(options = {}) {
  assert.equal(typeof api.Scheduler, 'function', 'animation scheduler must be implemented');
  return new api.Scheduler({
    outfits: ['classic', 'travel', 'cafe'],
    danceMs: 9600, interludeMs: 15000, recoveryMs: 1200,
    sceneDurations: {rest: 3200, lawrence: 4800, hazelita: 4800},
    outfitInterval: [300000, 600000], random: () => 0.25,
    ...options,
  });
}

test('preload forecast refills an empty scene bag and agrees with the real next scene',()=>{
  const s=engine();s.state.sceneBag=[];s.tick(8500);
  const before=s.snapshot();const future=s.preloadViews(1200);
  assert.equal(s.state.phaseElapsed,before.phaseElapsed);
  assert.equal(s.state.visibleMs,before.visibleMs);
  assert.ok(future.length>0);
  assert.equal(s.tick(1100).clip,future[0].clip);
});

test('preload forecast follows an outfit swap and its resumed scene',()=>{
  const s=engine({outfitInterval:[9000,9000]});s.tick(8500);
  const views=s.preloadViews(4000);
  const next=s.tick(1100);
  assert.equal(next.clip,'showcase');assert.equal(next.outfit,views[0].outfit);
  assert.equal(views[0].clip,'showcase');
  assert.ok(views.some(v=>v.clip===s.state.resume.phase || v.clip===s.state.scene));
});

test('preload forecasting does not consume the reserved shuffle bag entry twice',()=>{
  const s=engine();s.tick(8500);
  const a=s.preloadViews(1200),bag=s.snapshot().sceneBag;
  const b=s.preloadViews(1200);
  assert.deepEqual(a,b);assert.deepEqual(s.snapshot().sceneBag,bag);
});
test('dance is followed by a 15 second interlude, then another dance', () => {
  const s = engine();
  assert.equal(s.tick(9599).clip, 'dance');
  assert.equal(s.tick(1).phase, 'interlude');
  assert.equal(s.tick(14999).phase, 'interlude');
  assert.equal(s.tick(1).clip, 'dance');
});

test('a truncated saved checkpoint starts a healthy fresh schedule', () => {
  const s=engine({saved:{version:1,outfit:'cafe',visibleMs:350000,phase:'interlude',phaseElapsed:4000}});
  assert.doesNotThrow(()=>s.tick(16000));
  assert.ok(Array.isArray(s.snapshot().sceneBag));
});

test('an impossible saved phase cannot create a negative-time scheduling loop', () => {
  const valid=engine().snapshot();valid.phaseElapsed=999999;
  const s=engine({saved:valid});
  assert.equal(s.snapshot().phaseElapsed,0);
});

test('task reaction starts from its first frame whenever the task state changes', () => {
  const s=engine();s.tick(5000);
  assert.equal(s.tick(16,{task:'failed'}).elapsed,0);
  assert.equal(s.tick(100,{task:'failed'}).elapsed,100);
  assert.equal(s.tick(16,{task:'waiting'}).elapsed,0);
});
test('hidden time advances neither scene nor outfit deadline', () => {
  const s = engine(); s.tick(4000);
  const before = s.snapshot();
  s.tick(600000, {visible: false});
  assert.deepEqual(s.snapshot(), before);
});
test('task reactions immediately preempt dance and both guest scenes', () => {
  for (const task of ['running', 'waiting', 'failed', 'review']) {
    const s = engine();
    s.tick(9600);
    const elapsed = s.snapshot().phaseElapsed;
    assert.equal(s.tick(1000, {task}).clip, task);
    assert.equal(s.tick(0, {task, nearby: true}).clip, task);
    assert.equal(s.snapshot().phaseElapsed, elapsed);
  }
});
test('drag and clicks give control to the native pet immediately', () => {
  const s = engine(); s.tick(9600);
  const frame = s.tick(100, {task: 'waiting', interaction: true});
  assert.equal(frame.mode, 'native');
  assert.equal(frame.duo, false);
});
test('gaze pauses daily shows, then light idle precedes resuming', () => {
  const s = engine(); s.tick(2000);
  assert.equal(s.tick(1000, {nearby: true}).mode, 'gaze');
  assert.equal(s.tick(1199).clip, 'idle');
  assert.equal(s.tick(1).clip, 'dance');
  assert.equal(s.snapshot().phaseElapsed, 2000);
});

test('light idle recovery animates instead of freezing its first pose',()=>{
  const s=engine();s.tick(2000);s.tick(100,{nearby:true});
  assert.equal(s.tick(300).elapsed,300);
  assert.equal(s.tick(300).elapsed,600);
  assert.equal(s.snapshot().phaseElapsed,2000);
});
test('shuffle bag gives every scene one turn without consecutive duplicates', () => {
  const s = engine(); const scenes = [];
  for (let i = 0; i < 9; i++) {
    const frame = s.tick(9600); scenes.push(frame.clip);
    s.tick(15000);
  }
  for (let i = 0; i < 9; i += 3) {
    assert.equal(new Set(scenes.slice(i, i + 3)).size, 3);
  }
  assert.ok(scenes.every((id, i) => !i || id !== scenes[i - 1]));
});
test('outfit change waits for a completed animation and shows new clothes first', () => {
  const s = engine({outfitInterval: [5000, 5000]});
  assert.equal(s.tick(5000).outfit, 'classic');
  const frame = s.tick(4600);
  assert.notEqual(frame.outfit, 'classic');
  assert.equal(frame.clip, 'showcase');
  assert.equal(frame.duo, false);
});

test('a long visible tick applies outfit deadlines at their actual animation boundary', () => {
  const coarse=engine({outfitInterval:[10000,10000]});
  const fine=engine({outfitInterval:[10000,10000]});
  coarse.tick(24600);
  for(let i=0;i<246;i++)fine.tick(100);
  assert.deepEqual(coarse.snapshot(),fine.snapshot());
});
test('outfit shuffle never immediately returns to the same outfit', () => {
  const s = engine({outfitInterval: [1, 1]}); let previous = 'classic';
  const outfits = [];
  for (let i = 0; i < 6; i++) {
    // Walk to the next swap while allowing each showcase to finish.
    let frame;
    do {frame = s.tick(100);} while (frame.outfit === previous);
    outfits.push(frame.outfit); assert.notEqual(frame.outfit, previous);
    previous = frame.outfit;
  }
  assert.equal(new Set(outfits.slice(0, 3)).size, 3);
});
test('renderer reconnection preserves clothes, scene bag, and visible time', () => {
  const s = engine(); s.tick(10500); s.tick(2300, {task: 'review'});
  const saved = s.snapshot(); const restored = engine({saved});
  assert.deepEqual(restored.snapshot(), saved);
  assert.deepEqual(restored.tick(100), s.tick(100));
});
test('frame lookup uses authored duration and loop bounds', () => {
  assert.equal(typeof api.frameAt, 'function', 'variable frame timing must be implemented');
  const clip = {frames: [{duration: 40}, {duration: 80}, {duration: 40}], loop: [1, 3]};
  assert.equal(api.frameAt(clip, 39), 0);
  assert.equal(api.frameAt(clip, 40), 1);
  assert.equal(api.frameAt(clip, 119), 1);
  assert.equal(api.frameAt(clip, 120), 2);
  assert.equal(api.frameAt(clip, 160), 1);
});

test('high refresh playback reuses the immutable duration index instead of rescanning every sample',()=>{
  let reads=0;
  const clip={frames:Array.from({length:600},()=>({get duration(){reads++;return 1000/120;}})),loop:[0,600]};
  for(let i=0;i<1650;i++)api.frameAt(clip,i*1000/165);
  assert.ok(reads<=600,'one duration scan is sufficient for thousands of display callbacks');
});
test('single-character chibi poses never request a two-character layout', () => {
  const s=engine({sceneDurations: {pout: 3000}, duoScenes: []});
  assert.equal(s.tick(9600).clip, 'pout');
  assert.equal(s.tick(0).duo, false);
});
