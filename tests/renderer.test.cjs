const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const apiPath = path.join(__dirname, '..', 'renderer-player.js');
const api = fs.existsSync(apiPath) ? require(apiPath) : {};
function harness({imageFailure = false, petId = 'pet_6ac71429ba50819188d4388111562bbd'} = {}) {
  let now = 0, nextId = 1; const raf = new Map(), timers = new Map(), listeners = new Map();
  const style = () => {
    const values = new Map(); return {
      setProperty: (k,v) => values.set(k, String(v)),
      getPropertyValue: k => values.get(k) || '', getPropertyPriority: () => '',
      removeProperty: k => values.delete(k),
    };
  };
  const sprite = {style: style(), dataset: {codexPetId: petId, codexPetState: 'idle'}};
  const measure = {style: style()}; measure.style.setProperty('--codex-pet-width', '224px');
  const button = {style: style(), isConnected: true,
    getBoundingClientRect: () => ({left: 100, top: 100, width: 224, height: 243}),
    querySelector: () => sprite, append: e => {button.child = e;},
  };
  button.closest = () => button;
  const draws = []; const context = {clearRect() {}, setTransform() {},
    drawImage: (...args) => draws.push(args), globalAlpha: 1};
  const document = {visibilityState: 'visible', createElement: () => ({style: style(),
    setAttribute() {}, getContext: () => context, remove() {button.child = null;}}),
    querySelector: selector => selector.includes('avatar-overlay-size') ? measure : button};
  const env = {document, devicePixelRatio: 1, performance: {now: () => now},
    electronBridge: {}, CeciliaAnimation: require('../scheduler.js'),
    Image: class {async decode() {if (imageFailure) throw Error('bad PNG');}},
    getComputedStyle: e => ({width: '224px', height: '243px', display: 'block', visibility: 'visible'}),
    requestAnimationFrame: fn => {const id = nextId++; raf.set(id,fn); return id;},
    cancelAnimationFrame: id => raf.delete(id),
    setInterval: fn => {const id = nextId++;timers.set(id,fn); return id;},
    clearInterval: id => timers.delete(id),
    addEventListener: (k,fn) => listeners.set(k,fn),
    removeEventListener: k => listeners.delete(k),
    MutationObserver: class {observe() {} disconnect() {}},
  };
  const frames = [{duration: 100, layers: [{asset: 'original', source: [0,0,192,208], target: [0,0,192,208]}]}];
  const clips = Object.fromEntries(['dance','idle','rest','showcase','running','waiting','failed','review']
    .map(k => [k,{frames,loop: [0,1]}]));
  const dances = Object.fromEntries(['op-turn','small-sway','tiptoe-clap']
    .map(k => [k,{frames,loop:[0,1],playDurationMs:1000,cycleMs:500}]));
  const config = {petId, assets: {original: 'data:image/png;base64,fixture'},
    outfits: {classic: {clips, dances, nativeAtlas:'original', look: {frames: Array.from({length:16}, () => frames[0])}}},
    schedule: {danceMs: 1000, interludeMs: 15000, recoveryMs: 1200,
      danceIds:['op-turn','small-sway','tiptoe-clap'],duoScenes:['rest'],
      sceneDurations: {rest: 1000}, outfitInterval: [300000,600000]}};
  return {env, config, sprite, measure, button, draws, timers, listeners,
    advance(dt) {now += dt;const fns = [...raf.values()];raf.clear();fns.forEach(f => f(now));},
    elapseWithoutFrame(dt) {now += dt;},
    get now() {return now;}};
}
async function install(h) {
  assert.equal(typeof api.install, 'function', 'renderer player must be implemented');
  return api.install(h.config, h.env);
}
test('GPU native interaction keeps authored frames visible and advancing while dragging',async()=>{
  const h=harness();h.config.artwork={gpuNativeInteractions:true};
  const layers=h.config.outfits.classic.clips.running.frames[0].layers;
  const clip=h.config.outfits.classic.clips.running;clip.frames=Array.from({length:120},()=>({duration:1000/120,layers}));clip.loop=[0,120];
  const p=await install(h);h.advance(16);
  h.listeners.get('pointerdown')({target:{closest:()=>h.button}});
  const before=p.status().renderFrames;for(let i=0;i<30;i++)h.advance(1000/165);
  assert.equal(h.sprite.style.getPropertyValue('visibility'),'hidden');
  assert.equal(p.status().mode,'interaction');assert.ok(p.status().renderFrames>before+15);p.stop();
});

test('HD canvas uses high quality scaling at every DPI change', async()=>{
  const h=harness();h.env.devicePixelRatio=1.75;
  const p=await install(h);h.advance(10);
  const c=h.button.child;
  assert.equal(c.width,392);
  assert.equal(c.getContext('2d').imageSmoothingQuality,'high');
  h.env.devicePixelRatio=2;h.advance(10);
  assert.equal(c.width,448);
  assert.equal(c.getContext('2d').imageSmoothingQuality,'high');p.stop();
});

test('all five supported Windows DPI ratios preserve logical geometry',async()=>{
  const h=harness();const p=await install(h);
  for(const ratio of [1,1.25,1.5,1.75,2]) {
    h.env.devicePixelRatio=ratio;h.advance(20);
    assert.equal(h.button.child.width,Math.round(224*ratio));
    assert.equal(h.button.child.height,Math.round(243*ratio));
    assert.equal(h.button.child.style.getPropertyValue('width'),'224px');
  }
  p.stop();
});

test('120Hz source timing renders 120 poses on 165Hz callbacks with telemetry', async()=>{
  const h=harness();h.config.schedule.danceIds=['op-turn'];
  const clip=h.config.outfits.classic.dances['op-turn'];
  clip.frames=Array.from({length:120},()=>({duration:1000/120,layers:clip.frames[0].layers}));
  clip.loop=[0,120];clip.presentationFps=120;clip.playDurationMs=100000;
  const p=await install(h);
  for(let i=0;i<165;i++)h.advance(1000/165);
  assert.ok(p.status().renderFrames>=119);
  assert.ok(p.status().callbackFrames>=165,'measure callbacks separately');
  assert.ok(Number.isFinite(p.status().decodedBytes),'report decoded memory');
  assert.ok(Number.isFinite(p.status().drawMsMax),'report draw time');p.stop();
});

test('HD textures decode once to the actual screen pixel size and release their bitmap on stop',async()=>{
  const h=harness();h.env.devicePixelRatio=1.75;
  h.config.schedule.danceIds=['op-turn'];
  h.config.artwork={highResolutionSingle:[576,624],maxDecodedBytes:192*1024*1024};
  h.config.assets.hd='data:image/png;base64,hd';
  h.config.assetMetadata={hd:{width:576,height:624,decodedBytes:576*624*4}};
  const clip=h.config.outfits.classic.dances['op-turn'];
  clip.frames=[{duration:100,layers:[{asset:'hd',source:[0,0,576,624],target:[0,0,192,208]}]}];clip.loop=[0,1];
  h.env.Image=class{async decode(){this.naturalWidth=576;this.naturalHeight=624;}};
  let closed=0,options;
  h.env.createImageBitmap=async(image,o)=>{options=o;return {width:o.resizeWidth,height:o.resizeHeight,close(){closed++;}};};
  const p=await install(h);h.advance(10);
  assert.equal(options.resizeWidth,392);assert.equal(options.resizeHeight,425);
  assert.equal(options.resizeQuality,'high');
  assert.equal(h.draws.at(-1)[3],392);assert.equal(h.draws.at(-1)[4],425);
  p.stop();assert.ok(closed>0,'release decoded bitmap resources');
});

test('flow atlases become unmodified bitmaps without resize or color conversion',async()=>{
  const h=harness();h.config.schedule.danceIds=['op-turn'];
  h.config.artwork={highResolutionSingle:[576,624]};
  h.config.assets.flow='data:image/png;base64,flow';
  h.config.assetMetadata={flow:{width:1152,height:1728,kind:'flow',decodedBytes:1152*1728*4}};
  const clip=h.config.outfits.classic.dances['op-turn'];
  clip.frames=[{duration:100,layers:[{asset:'flow',source:[0,0,128,144],target:[0,0,192,208]}]}];clip.loop=[0,1];
  h.env.Image=class{async decode(){this.naturalWidth=1152;this.naturalHeight=1728;}};
  let options;
  h.env.createImageBitmap=async(image,o)=>{options=o;return {width:1152,height:1728,close(){}};};
  const p=await install(h);
  assert.equal(options.resizeWidth,undefined);assert.equal(options.premultiplyAlpha,'none');
  assert.equal(options.colorSpaceConversion,'none');p.stop();
});

test('initial GPU uploads finish before the playback clock starts',async()=>{
  const h=harness();let finish;
  h.config.artwork={renderMode:'gpu-pose-flow-v1'};
  const clip=h.config.outfits.classic.dances['op-turn'];h.config.schedule.danceIds=['op-turn'];
  h.config.assets.pose='data:image/png;base64,pose';
  clip.frames=[{duration:100,layers:[{asset:'pose',source:[0,0,192,208],target:[0,0,192,208]}]}];clip.loop=[0,1];
  h.env.CeciliaGPU={create:()=>({gpu:true,prepareTexture:()=>new Promise(resolve=>{finish=resolve;}),stop(){}})};
  const pending=install(h);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.env.__ceciliaPlayer,undefined,'do not start a visible clock with incomplete textures');
  finish();const p=await pending;assert.ok(p);p.stop();
});

test('a failed initial GPU upload removes its canvas and releases decoded resources',async()=>{
  const h=harness();h.config.artwork={renderMode:'gpu-pose-flow-v1'};
  h.config.assets.pose='data:image/png;base64,pose';h.config.schedule.danceIds=['op-turn'];
  const clip=h.config.outfits.classic.dances['op-turn'];
  clip.frames=[{duration:100,layers:[{asset:'pose',source:[0,0,192,208],target:[0,0,192,208]}]}];clip.loop=[0,1];
  let released=false;
  h.env.CeciliaGPU={create:()=>({gpu:true,prepareTexture:async()=>{throw Error('GPU upload failed');},stop(){released=true;}})};
  await assert.rejects(install(h),/GPU upload failed/);
  assert.equal(h.button.child,null);assert.equal(released,true);
  assert.equal(h.sprite.style.getPropertyValue('visibility'),'');
});
test('small rAF timing jitter does not alternate between duplicated and skipped 60Hz frames',()=>{
  assert.equal(typeof api.frameForDisplay,'function','choose the nearest sample for display timing');
  const clip={frames:Array.from({length:60},()=>({duration:1000/60})),loop:[0,60]};
  const times=[0,16.65,33.34,49.98,66.66,83.34,99.99];
  const indices=times.map(t=>api.frameForDisplay(clip,t,require('../scheduler.js').frameAt));
  assert.deepEqual(indices,[0,1,2,3,4,5,6]);
});

test('unused outfits and scenes are not decoded into memory at startup',async()=>{
  const h=harness();const decoded=[];
  h.env.Image=class{async decode(){decoded.push(this.src);}};
  h.config.assets.future='data:image/png;base64,future';
  const p=await install(h);h.advance(16);
  assert.deepEqual(decoded,['data:image/png;base64,fixture']);p.stop();
});
test('upcoming texture chunks are decoded before their first displayed frame',async()=>{
  const h=harness();const decoded=[];
  h.env.Image=class{async decode(){decoded.push(this.src);}};
  h.config.assets.next='data:image/png;base64,next';
  h.config.schedule.danceIds=['op-turn'];
  const dance=h.config.outfits.classic.dances['op-turn'];
  dance.frames=[{duration:200,layers:dance.frames[0].layers},
    {duration:200,layers:[{asset:'next',source:[0,0,192,208],target:[0,0,192,208]}]}];
  dance.loop=[0,2];
  const p=await install(h);h.advance(16);await Promise.resolve();await Promise.resolve();
  assert.ok(decoded.includes('data:image/png;base64,next'),'preload the next chunk during the current one');
  p.stop();
});
test('HD two-layer preloading stays within five textures at sixteen-frame boundaries',async()=>{
  const h=harness();const decoded=[];h.env.Image=class{async decode(){decoded.push(this.src);}};
  h.config.artwork={preloadMs:180};h.config.schedule.danceIds=['op-turn'];
  for(let p=0;p<3;p++)for(const who of ['a','b'])h.config.assets[who+p]='data:image/png;base64,'+who+p;
  const dance=h.config.outfits.classic.dances['op-turn'];
  dance.frames=Array.from({length:48},(_,i)=>({duration:1000/60,layers:['a','b'].map(who=>({asset:who+Math.floor(i/16),source:[0,0,384,416],target:[0,0,192,208]}))}));dance.loop=[0,48];
  const p=await install(h);h.advance(250);await Promise.resolve();await Promise.resolve();h.advance(1);
  assert.ok(new Set(decoded).size<=5,'prefetch must not decode three chunks for both characters');p.stop();
});

test('a ready pose keeps moving while a future texture is still decoding',async()=>{
  const h=harness();let finish;
  h.config.schedule.danceIds=['op-turn'];h.config.artwork={preloadMs:450,maxDecodedAssets:8};
  h.config.assets.future='data:image/png;base64,future';
  const clip=h.config.outfits.classic.dances['op-turn'];
  clip.frames=Array.from({length:8},(_,i)=>({duration:50,layers:i<6?clip.frames[0].layers:[{asset:'future',source:[0,0,192,208],target:[0,0,192,208]}]}));clip.loop=[0,8];
  h.env.Image=class{decode(){return this.src.endsWith(',future')?new Promise(resolve=>{finish=resolve;}):Promise.resolve();}};
  const p=await install(h);h.advance(16);const elapsed=p.snapshot().phaseElapsed;
  assert.equal(p.status().ready,true,'a decoded current pose should be displayed immediately');
  h.advance(100);assert.equal(p.snapshot().phaseElapsed,elapsed+100,'future decoding must not freeze available motion');
  assert.ok(p.status().frameIndex>0);
  finish();await new Promise(resolve=>setImmediate(resolve));p.stop();
});

test('a missing current texture freezes only until that texture is decoded',async()=>{
  const h=harness();let finish;
  h.config.schedule.danceIds=['op-turn'];h.config.artwork={preloadMs:450,maxDecodedAssets:8};
  h.config.assets.future='data:image/png;base64,future';
  const clip=h.config.outfits.classic.dances['op-turn'];
  clip.frames=[{duration:50,layers:clip.frames[0].layers},{duration:350,layers:[{asset:'future',source:[0,0,192,208],target:[0,0,192,208]}]}];clip.loop=[0,2];
  h.env.Image=class{decode(){return this.src.endsWith(',future')?new Promise(resolve=>{finish=resolve;}):Promise.resolve();}};
  const p=await install(h);h.advance(16);h.advance(50);const elapsed=p.snapshot().phaseElapsed;
  assert.equal(p.status().ready,false);h.advance(200);
  assert.equal(p.snapshot().phaseElapsed,elapsed,'unavailable current art must not disappear or consume its clock');
  finish();await new Promise(resolve=>setImmediate(resolve));h.advance(16);
  assert.equal(p.status().ready,true);p.stop();
});

test('the next scheduled scene starts decoding before the current dance ends',async()=>{
  const h=harness(),decoded=[];
  h.config.schedule.duoScenes=[];h.config.assets.scene='data:image/png;base64,scene';
  h.config.outfits.classic.clips.rest={frames:[{duration:100,layers:[{asset:'scene',source:[0,0,192,208],target:[0,0,192,208]}]}]};
  h.env.Image=class{async decode(){decoded.push(this.src);}};
  const p=await install(h);const state=p.snapshot();state.sceneBag=['rest'];p.restore(state);
  h.advance(800);await new Promise(resolve=>setImmediate(resolve));
  assert.ok(decoded.includes('data:image/png;base64,scene'),'use the last prefetch window of the dance to warm the next scene');
  assert.equal(p.status().clip,'dance');p.stop();
});

test('an empty next scene bag still preloads the actual scene before the boundary',async()=>{
  const h=harness(),decoded=[];h.config.schedule.duoScenes=[];
  h.config.assets.scene='data:image/png;base64,scene';
  h.config.outfits.classic.clips.rest={frames:[{duration:100,layers:[{asset:'scene',source:[0,0,192,208],target:[0,0,192,208]}]}]};
  h.env.Image=class{async decode(){decoded.push(this.src);}};
  const p=await install(h);const saved=p.snapshot();saved.sceneBag=[];p.restore(saved);
  h.advance(800);await new Promise(resolve=>setImmediate(resolve));
  assert.ok(decoded.includes('data:image/png;base64,scene'));
  assert.equal(p.status().clip,'dance');p.stop();
});

test('the preceding owner keeps animating during a native layout acknowledgement',async()=>{
  const h=harness();h.config.schedule.danceIds=['op-turn'];
  const dance=h.config.outfits.classic.dances['op-turn'];
  dance.frames=Array.from({length:120},()=>({duration:1000/120,layers:dance.frames[0].layers}));dance.loop=[0,120];
  const p=await install(h);h.advance(900);h.advance(100);
  assert.equal(p.status().ready,false);
  const elapsed=p.snapshot().phaseElapsed,draws=p.status().renderFrames;
  for(let i=0;i<20;i++)h.advance(1000/165);
  assert.equal(p.snapshot().phaseElapsed,elapsed,'the new scene clock waits for native geometry');
  assert.ok(p.status().renderFrames>=draws+14,'keep drawing the cached owner while its window moves');
  p.stop();
});

test('a completed non-looping duo uses animated idle during the single-window return',async()=>{
  const h=harness();h.config.schedule.danceIds=['op-turn'];h.config.schedule.interludeMs=200;
  h.config.schedule.sceneDurations.rest=200;
  const layers=h.config.outfits.classic.clips.idle.frames[0].layers;
  h.config.outfits.classic.clips.idle={frames:Array.from({length:120},()=>({duration:1000/120,layers})),loop:[0,120]};
  h.config.outfits.classic.clips.rest={frames:Array.from({length:24},()=>({duration:1000/120,layers}))};
  let width=224;
  h.button.getBoundingClientRect=()=>({left:100,top:100,width,height:243});
  const p=await install(h);h.advance(1000);width=448;h.advance(10);h.advance(200);
  const start=p.status().renderFrames;
  for(let i=0;i<40;i++)h.advance(1000/165);
  assert.equal(p.status().clip,'dance');
  assert.ok(p.status().renderFrames>=start+27,'the completed guest scene must not freeze the owner for the resize');
  width=224;h.advance(16);p.stop();
});

test('a longer prefetch window covers fast texture changes without exceeding its texture budget',async()=>{
  const h=harness(),decoded=[];
  h.env.Image=class{async decode(){decoded.push(this.src);}};
  h.config.artwork={preloadMs:450,maxDecodedAssets:8};h.config.schedule.danceIds=['op-turn'];
  for(let i=1;i<12;i++)h.config.assets['chunk'+i]='data:image/png;base64,chunk'+i;
  const clip=h.config.outfits.classic.dances['op-turn'];
  clip.playbackRate=3;
  clip.frames=Array.from({length:96},(_,i)=>({duration:1000/60,layers:[{asset:i<8?'original':'chunk'+Math.floor(i/8),source:[0,0,192,208],target:[0,0,192,208]}]}));
  clip.loop=[0,96];
  const p=await install(h);h.advance(16);await new Promise(resolve=>setImmediate(resolve));
  assert.ok(decoded.includes('data:image/png;base64,chunk7'));
  assert.ok(!decoded.includes('data:image/png;base64,chunk8'),'stop before a ninth texture');
  assert.ok(new Set(decoded).size<=8);p.stop();
});
test('lazy local PNGs request only current assets and retain a real native fallback',async()=>{
  const h=harness(),requested=[];
  h.config.assets.original='local-png:original';h.config.assets.future='local-png:future';
  h.env.__ceciliaRequestAsset=async id=>{requested.push(id);return 'data:image/png;base64,'+id;};
  const p=await install(h);h.advance(16);
  h.listeners.get('pointerdown')({target:{closest:()=>h.button}});
  assert.deepEqual(requested,['original']);
  assert.equal(h.sprite.style.getPropertyValue('background-image'),'url("data:image/png;base64,original")');
  p.stop();
});

test('steady animation does not serialize the multi-megabyte native atlas on every frame',async()=>{
  const h=harness();let reads=0;
  h.config.assets.original='local-png:original';
  h.env.__ceciliaRequestAsset=async()=> 'data:image/png;base64,'+'x'.repeat(3*1024*1024);
  const get=h.sprite.style.getPropertyValue;
  h.sprite.style.getPropertyValue=key=>{if(key==='background-image')reads++;return get(key);};
  const p=await install(h);h.advance(16);const before=reads;
  for(let i=0;i<60;i++)h.advance(1000/60);
  assert.ok(reads-before<=5,`one second of playback serialized the native atlas ${reads-before} times`);
  p.stop();
});

test('a background-only native host rewrite is repaired within a quarter second',async()=>{
  const h=harness();h.config.assets.original='local-png:original';
  h.env.__ceciliaRequestAsset=async()=> 'data:image/png;base64,native';
  const p=await install(h);h.advance(16);
  h.sprite.style.setProperty('background-image','url("host-classic.png")');
  h.advance(250);
  assert.equal(h.sprite.style.getPropertyValue('background-image'),'url("data:image/png;base64,native")');
  p.stop();
});
test('reported readiness waits for native width acknowledgement and a fresh draw',async()=>{
  const h=harness();let hostWidth=224;
  h.button.getBoundingClientRect=()=>({left:100,top:100,width:hostWidth,height:243});
  const p=await install(h);h.advance(16);
  const saved=p.snapshot();saved.phase='interlude';saved.phaseElapsed=20;saved.scene='rest';
  p.restore(saved);
  assert.equal(p.status().ready,false,'old canvas pixels do not prove the new scene is visible');
  hostWidth=448;h.advance(16);
  assert.equal(p.status().ready,true);assert.equal(p.status().layout.hostWidth,448);p.stop();
});
test('restoring a valid playback checkpoint changes scenes without replacing the player',async()=>{
  const h=harness();const p=await install(h);h.advance(16);
  assert.equal(typeof p.restore,'function','playback needs a validated checkpoint restore seam');
  const saved=p.snapshot();saved.phase='interlude';saved.phaseElapsed=20;saved.scene='rest';
  p.restore(saved);assert.equal(p.status().clip,'rest');assert.equal(h.env.__ceciliaPlayer,p);
  assert.throws(()=>p.restore({...saved,phaseElapsed:999999}),/checkpoint/);p.stop();
});
test('player waits for decoded assets before replacing the original pet', async () => {
  const h = harness();const p = await install(h);h.advance(16);
  assert.ok(h.draws.length > 0);assert.equal(h.sprite.style.getPropertyValue('visibility'),'hidden');
  assert.equal(p.status().outfit,'classic');p.stop();
});
test('a short interaction cannot expire while its first texture is still decoding',async()=>{
  const h=harness();let finish;
  h.config.assets.scene='data:image/png;base64,scene';
  h.config.outfits.classic.clips.rest={frames:[{duration:100,layers:[{asset:'scene',source:[0,0,192,208],target:[0,0,192,208]}]}]};
  h.config.schedule.sceneDurations.rest=100;h.config.schedule.duoScenes=[];
  h.env.Image=class{decode(){return this.src.endsWith(',scene')?new Promise(resolve=>{finish=resolve;}):Promise.resolve();}};
  const p=await install(h);h.advance(1000);h.advance(500);
  assert.equal(p.snapshot().phaseElapsed,0,'loading time must not consume the short scene');
  finish();await new Promise(resolve=>setImmediate(resolve));h.advance(16);
  assert.equal(p.status().clip,'rest');assert.equal(p.status().ready,true);p.stop();
});

test('the same motion clock slows fast clips and speeds up slow clips without changing their source frames',async()=>{
  for(const [rate,index] of [[.5,1],[2,4]]){
    const h=harness();h.config.outfits.classic.clips.running={frames:Array.from({length:10},()=>({duration:100,layers:h.config.outfits.classic.clips.running.frames[0].layers})),loop:[0,10],playbackRate:rate};
    h.sprite.dataset.codexPetState='running';const p=await install(h);h.advance(200);
    assert.equal(p.status().frameIndex,index);p.stop();
  }
});

test('duo content stays inside the viewport at the right and left edges without changing its anchor',()=>{
  const h=harness();h.env.innerWidth=963;h.env.innerHeight=1080;
  let x=620,width=224;
  h.button.getBoundingClientRect=()=>({left:x+(parseFloat(h.button.style.getPropertyValue('translate'))||0),top:715,width,height:243});
  const layout=api.createLayout(h.env);layout.request(2);width=448;
  assert.equal(layout.ready(),false);h.elapseWithoutFrame(500);assert.equal(layout.ready(),true);
  let r=h.button.getBoundingClientRect();assert.ok(r.left>=0 && r.left+r.width<=963,JSON.stringify(r));
  x=-20;assert.equal(layout.ready(),false);h.elapseWithoutFrame(500);assert.equal(layout.ready(),true);
  r=h.button.getBoundingClientRect();assert.ok(r.left>=0 && r.left+r.width<=963,JSON.stringify(r));
  layout.request(1);width=224;layout.ready();h.elapseWithoutFrame(500);layout.ready();assert.equal(h.button.style.getPropertyValue('translate'),'');
});

test('duo edge avoidance and return move continuously instead of jumping the owner',()=>{
  const h=harness();h.env.innerWidth=956;h.env.innerHeight=1080;
  let width=224;
  h.button.getBoundingClientRect=()=>({left:620+(parseFloat(h.button.style.getPropertyValue('translate'))||0),top:715,width,height:243});
  const layout=api.createLayout(h.env);layout.request(2);width=448;
  assert.equal(layout.ready(),false,'keep the old owner frame while moving into a safe position');
  assert.equal(h.button.getBoundingClientRect().left,620);
  h.elapseWithoutFrame(250);assert.equal(layout.ready(),false);
  const middle=h.button.getBoundingClientRect().left;
  assert.ok(middle<620 && middle>508,'avoid a whole-position switch');
  h.elapseWithoutFrame(250);assert.equal(layout.ready(),true);
  assert.equal(h.button.getBoundingClientRect().left,508);
  layout.request(1);width=224;
  assert.equal(h.button.getBoundingClientRect().left,508,'exit must keep the current position initially');
  assert.equal(layout.ready(),false);h.elapseWithoutFrame(500);
  assert.equal(layout.ready(),true);assert.equal(h.button.getBoundingClientRect().left,620);
  layout.restore();assert.equal(h.button.style.getPropertyValue('translate'),'');
});

test('native center anchoring cannot move the owner when duo width is acknowledged',()=>{
  const h=harness();h.env.innerWidth=956;h.env.innerHeight=1080;
  let width=224;
  h.button.getBoundingClientRect=()=>({left:732-width/2+(parseFloat(h.button.style.getPropertyValue('translate'))||0),top:715,width,height:243});
  const layout=api.createLayout(h.env);layout.request(2);width=448;
  assert.equal(layout.ready(),false);
  assert.equal(h.button.getBoundingClientRect().left,620,'compensate the automatic half-width shift before painting');
  h.elapseWithoutFrame(250);layout.ready();
  assert.ok(h.button.getBoundingClientRect().left<620 && h.button.getBoundingClientRect().left>508);
  h.elapseWithoutFrame(250);assert.equal(layout.ready(),true);
  assert.equal(h.button.getBoundingClientRect().left,508);
  layout.request(1);width=224;assert.equal(layout.ready(),false);
  assert.equal(h.button.getBoundingClientRect().left,508,'the reverse native center shift must also be compensated');
  h.elapseWithoutFrame(500);assert.equal(layout.ready(),true);
  assert.equal(h.button.getBoundingClientRect().left,620);layout.restore();
});

test('a host sprite rewrite during left and right dragging cannot replace the current outfit',async()=>{
  for(const outfit of ['travel','cafe']) {
    const h=harness();h.config.outfits[outfit]={...h.config.outfits.classic,nativeAtlas:outfit};
    h.config.assets[outfit]='data:image/png;base64,'+outfit;
    const p=await install(h);const state=p.snapshot();state.outfit=outfit;p.restore(state);
    await new Promise(resolve=>setImmediate(resolve));h.advance(16);
    h.listeners.get('pointerdown')({target:{closest:()=>h.button}});
    for(const direction of ['walking-left','walking-right']) {
      h.sprite.dataset.codexPetState=direction;
      h.sprite.style.setProperty('background-image','url("host-classic.png")');
      h.advance(16);
      assert.equal(h.sprite.style.getPropertyValue('background-image'),`url("data:image/png;base64,${outfit}")`);
      assert.equal(p.status().outfit,outfit);
    }
    p.stop();
  }
});
test('unreadable assets leave the original renderer untouched', async () => {
  const h = harness({imageFailure:true});
  assert.equal(typeof api.install, 'function', 'renderer player must be implemented');
  await assert.rejects(api.install(h.config,h.env), /bad PNG/);
  assert.equal(h.sprite.style.getPropertyValue('visibility'),'');assert.equal(h.button.child,undefined);
});
test('mismatched pet ID refuses to attach', async () => {
  const h = harness();h.sprite.dataset.codexPetId='other-pet';
  assert.equal(typeof api.install, 'function', 'renderer player must be implemented');
  await assert.rejects(api.install(h.config,h.env), /pet ID/);
});
test('native task state immediately replaces daily rendering', async () => {
  const h=harness();const p=await install(h);h.advance(16);
  h.sprite.dataset.codexPetState='failed';h.advance(16);
  assert.equal(p.status().clip,'failed');assert.equal(p.status().duo,false);p.stop();
});
test('pointer dragging restores the native sprite without capturing the event', async () => {
  const h=harness();const p=await install(h);h.advance(16);
  h.listeners.get('pointerdown')({target:{closest:() => h.button}});h.advance(16);
  assert.equal(p.status().mode,'native');assert.equal(h.sprite.style.getPropertyValue('visibility'),'');p.stop();
});

test('native click and drag animations retain the currently selected outfit atlas',async()=>{
  const h=harness();h.config.outfits.classic.nativeAtlas='original';
  h.sprite.style.setProperty('background-image','url("original-pet.png")');
  const p=await install(h);h.advance(16);
  h.listeners.get('pointerdown')({target:{closest:()=>h.button}});
  assert.equal(h.sprite.style.getPropertyValue('background-image'),'url("data:image/png;base64,fixture")');
  p.stop();assert.equal(h.sprite.style.getPropertyValue('background-image'),'url("original-pet.png")');
});

test('waiting for native duo resize acknowledgement retains the preceding owner and its outfit',async()=>{
  const h=harness();h.config.outfits.classic.nativeAtlas='original';
  h.config.schedule.duoScenes=['rest'];
  h.sprite.style.setProperty('background-image','url("original-pet.png")');
  const p=await install(h);h.advance(500);h.advance(500);
  assert.equal(p.status().duo,true);
  assert.equal(h.sprite.style.getPropertyValue('visibility'),'hidden');
  assert.equal(h.button.child.style.getPropertyValue('display'),'block');
  assert.equal(h.sprite.style.getPropertyValue('background-image'),'url("data:image/png;base64,fixture")');
  p.stop();
});
test('stop restores measurement and removes layers, events, and timers', async () => {
  const h=harness();const p=await install(h);h.advance(16);p.stop();p.stop();
  assert.equal(h.button.child,null);assert.equal(h.measure.style.getPropertyValue('--codex-pet-width'),'224px');
  assert.equal(h.sprite.style.getPropertyValue('visibility'),'');
  assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
});
test('lost heartbeat returns to the original renderer even while animation is suspended', async () => {
  const h=harness();const p=await install(h);h.advance(16);h.advance(5100);
  for (const tick of [...h.timers.values()]) tick();
  assert.equal(p.status().stopped,true);assert.equal(h.button.child,null);
  assert.equal(h.env.__ceciliaPlayerStopReason,'helper heartbeat lost');
});

test('a hide and reveal between animation callbacks never charges hidden time',async()=>{
  const h=harness();const p=await install(h);h.advance(16);
  p.pulse(false);h.elapseWithoutFrame(500);p.pulse(true);h.advance(16);
  assert.equal(p.snapshot().visibleMs,32);p.stop();
});

test('moving to a different display density resizes the raster without changing CSS scale',async()=>{
  const h=harness();const p=await install(h);h.advance(16);
  h.env.devicePixelRatio=1.5;h.advance(16);
  assert.equal(h.button.child.width,336);assert.equal(h.button.child.height,365);
  assert.equal(h.button.child.style.getPropertyValue('width'),'224px');p.stop();
});
test('native layout widens the measurement while keeping the original height', () => {
  const h=harness();
  assert.equal(typeof api.createLayout,'function','native layout adapter must be implemented');
  const layout=api.createLayout(h.env);layout.request(2);
  assert.equal(h.measure.style.getPropertyValue('width'),'448px');
  assert.equal(h.measure.style.getPropertyValue('height'),'243px');
  assert.equal(layout.bounds().width,224);
  layout.restore();assert.equal(h.measure.style.getPropertyValue('width'),'');
});
test('an unacknowledged duo measurement times out and restores the original layout', () => {
  const h=harness();
  assert.equal(typeof api.createLayout,'function','native layout adapter must be implemented');
  const layout=api.createLayout(h.env);layout.request(2);h.advance(1100);
  assert.throws(()=>layout.ready(),/acknowledge/);
  layout.restore();assert.equal(h.button.style.getPropertyValue('width'),'');
});
test('returning from a long duo gives the native host a fresh resize acknowledgement deadline',()=>{
  const h=harness();let hostWidth=224;
  h.button.getBoundingClientRect=()=>({left:100,top:100,width:hostWidth,height:243});
  const layout=api.createLayout(h.env);layout.request(2);hostWidth=448;
  assert.equal(layout.ready(),true);h.elapseWithoutFrame(6500);
  layout.request(1);
  assert.equal(layout.ready(),false);
  h.elapseWithoutFrame(50);hostWidth=224;assert.equal(layout.ready(),true);
});

test('stable texture runs do not rescan hundreds of source durations on every callback',async()=>{
  const h=harness();h.config.schedule.danceIds=['op-turn'];let reads=0;
  const clip=h.config.outfits.classic.dances['op-turn'];
  const layers=clip.frames[0].layers;
  clip.frames=Array.from({length:600},()=>({get duration(){reads++;return 1000/120;},layers}));clip.loop=[0,600];
  const p=await install(h);h.advance(16);const first=reads;
  for(let i=0;i<165;i++)h.advance(1000/165);
  assert.equal(reads,first,'immutable timing and texture-run indices should eliminate repeated scans');p.stop();
});

test('shared identity textures are decoded and pinned together with their costume pose',async()=>{
  const h=harness(),decoded=[];h.config.schedule.danceIds=['op-turn'];
  h.env.Image=class{async decode(){decoded.push(this.src);}};
  h.config.assets.face='data:image/png;base64,shared-face';
  const clip=h.config.outfits.classic.dances['op-turn'];
  clip.frames[0].layers[0].face={asset:'face',transform:{matrix:[1,0,0,1],offset:[0,0]}};
  const p=await install(h);h.advance(16);
  assert.ok(decoded.includes('data:image/png;base64,shared-face'),'a facial identity patch must be ready before drawLayer');
  assert.equal(decoded.filter(v=>v.endsWith(',shared-face')).length,1);p.stop();
});

test('edge clamping uses the real native width when DPI rounding adds a pixel',()=>{
  const h=harness();h.env.innerWidth=626;h.env.innerHeight=916;
  let width=225;
  h.button.getBoundingClientRect=()=>({left:400+(parseFloat(h.button.style.getPropertyValue('translate'))||0),top:100,width,height:243});
  const layout=api.createLayout(h.env);layout.request(2);width=449.00003;
  layout.ready();h.elapseWithoutFrame(500);assert.equal(layout.ready(),true);
  const rect=h.button.getBoundingClientRect();assert.ok(rect.left+rect.width<=626.001);
});

test('native fallback after a long duo grants a fresh single-width acknowledgement deadline',()=>{
  const h=harness();let hostWidth=224;
  h.button.getBoundingClientRect=()=>({left:100,top:100,width:hostWidth,height:243});
  const layout=api.createLayout(h.env);layout.request(2);hostWidth=448;layout.ready();
  h.elapseWithoutFrame(6500);layout.request(1,{immediate:true});
  assert.equal(layout.ready(),false,'fallback can restore CSS before the asynchronous native resize completes');
  h.elapseWithoutFrame(50);hostWidth=224;assert.equal(layout.ready(),true);
});
test('cursor messages cannot interrupt playback or change the facing direction',async()=>{
  const h=harness();const p=await install(h);h.advance(16);
  const send=h.listeners.get('message');
  send({data:{type:'avatar-overlay-computer-use-cursor-changed',point:{x:400,y:221.5}}});
  assert.notEqual(p.status().mode,'gaze');
  assert.equal(p.status().lookDirection,null);
  assert.equal(p.status().outfit,'classic');
  send({data:{type:'avatar-overlay-computer-use-cursor-changed',point:{x:212,y:400}}});
  assert.equal(p.status().lookDirection,null);
  p.stop();
});


test('unsolicited host jumping state keeps authored rendering and model visible',async()=>{
  const h=harness();const p=await install(h);h.advance(16);
  h.sprite.dataset.codexPetState='jumping';h.advance(16);
  assert.equal(p.status().mode,'daily','hover-driven host state must not expose the old jump atlas');
  assert.equal(h.sprite.style.getPropertyValue('visibility'),'hidden');
  assert.ok(p.status().ready);p.stop();
});
