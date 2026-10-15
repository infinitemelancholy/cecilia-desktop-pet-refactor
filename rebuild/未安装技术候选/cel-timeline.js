/* Exposure timing for authored whole-character cels; no colour interpolation. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./scheduler.js'):root.CeciliaAnimation);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.CeciliaCels=api;
})(globalThis,function(Animation){
  'use strict';
  function sample(clip,elapsedMs){
    if(!Number.isFinite(elapsedMs)||elapsedMs<0)throw Error('Animation time must be finite and nonnegative');
    if(!clip?.frames?.length)throw Error('Authored cels are required');
    const index=Animation.frameAt(clip,elapsedMs);
    return {frame:clip.frames[index],index,seconds:elapsedMs/1000};
  }
  function present(clip,elapsedMs,secondarySeconds=elapsedMs/1000){
    if(!Number.isFinite(secondarySeconds)||secondarySeconds<0)throw Error('Secondary time must be finite and nonnegative');
    const {frame}=sample(clip,elapsedMs),motion=clip.secondaryMotion||{};
    return {...frame,layers:frame.layers.map(layer=>{
      if(!layer.volume)return layer;
      return {...layer,volume:{...layer.volume,time:secondarySeconds,
        bodyYaw:(layer.volume.bodyYaw||0)+(motion.bodyYaw||0)*Math.sin(secondarySeconds*1.3),
        headYaw:(layer.volume.headYaw||0)+(motion.headYaw||0)*Math.sin(secondarySeconds*1.3-.35)}};
    })};
  }
  return {sample,present};
});
