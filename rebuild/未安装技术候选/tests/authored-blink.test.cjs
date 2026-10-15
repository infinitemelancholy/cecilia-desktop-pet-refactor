const {test}=require('node:test');const assert=require('node:assert/strict');
const GPU=require('./candidate/gpu-compositor.js');
const info={width:2304,height:832},good={source:[768,0,768,832],transform:[.99,.99,.005,.004],regions:[[.44,.27,.044,.04],[.55,.26,.044,.04]]};
test('authored blink stays inside its own atlas and two bounded eyelid regions',()=>assert.equal(GPU.validateAuthoredBlink(good,info),good));
test('blink rejects body-sized patches, flow motion, nonfinite and atlas overrun',()=>{
 for(const blink of [{...good,source:[2000,0,768,832]},{...good,transform:[NaN,1,0,0]},
   {...good,regions:[[.4,.5,.3,.3],good.regions[1]]},{...good,regions:[good.regions[0]]}])
   assert.throws(()=>GPU.validateAuthoredBlink(blink,info));
 assert.throws(()=>GPU.validateAuthoredBlink(good,info,{}));
});
