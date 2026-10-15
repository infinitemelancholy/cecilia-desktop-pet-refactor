const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'candidate/cel-timeline.js');
const api=fs.existsSync(file)?require(file):{};
test('animation cels hold on twos independently of display refresh',()=>{
 assert.equal(typeof api.sample,'function','Authored exposure sampling is required');
 const clip={frames:[{duration:1000/12,layers:[{asset:'pose0'}]},{duration:1000/12,layers:[{asset:'pose1'}]}],loop:[0,2]};
 assert.equal(api.sample(clip,0).frame.layers[0].asset,'pose0');
 assert.equal(api.sample(clip,80).frame.layers[0].asset,'pose0');
 assert.equal(api.sample(clip,90).frame.layers[0].asset,'pose1');
 assert.equal(api.sample(clip,170).frame.layers[0].asset,'pose0');
 assert.equal(api.sample(clip,90).frame.layers.length,1,'Never dissolve two whole actors');
});
test('secondary motion time advances inside a held cel',()=>{
 const clip={frames:[{duration:1000,layers:[{asset:'pose0'}]}]};
 assert.equal(api.sample(clip,100).frame,api.sample(clip,150).frame);
 assert.equal(api.sample(clip,100).seconds,.1);
 assert.equal(api.sample(clip,150).seconds,.15);
});
test('invalid time cannot corrupt exposure lookup',()=>{
 const clip={frames:[{duration:100,layers:[]}]};
 for(const t of [-1,NaN,Infinity])assert.throws(()=>api.sample(clip,t),/finite/);
});
test('held cels retain one drawing while depth and hair time advance at display cadence',()=>{
 const clip={frames:[{duration:1000,layers:[{asset:'actor',source:[0,0,384,416],volume:{bodyYaw:0,headYaw:0,time:0}}]}],secondaryMotion:{bodyYaw:.08,headYaw:.12}};
 assert.equal(typeof api.present,'function','Continuous secondary presentation is required');
 const a=api.present(clip,100,5),b=api.present(clip,110,5.01);
 assert.deepEqual(a.layers[0].source,b.layers[0].source);
 assert.equal(a.layers.length,1);
 assert.equal(a.layers[0].volume.time,5);
 assert.equal(b.layers[0].volume.time,5.01);
 assert.notEqual(a.layers[0].volume.headYaw,b.layers[0].volume.headYaw);
 assert.equal(clip.frames[0].layers[0].volume.time,0,'Asset definitions stay immutable');
});
test('global secondary time prevents restarting breath when another action begins',()=>{
 const clip={frames:[{duration:1000,layers:[{asset:'actor',volume:{time:0}}]}]};
 assert.deepEqual(api.present(clip,950,7).layers,api.present(clip,0,7).layers);
});
