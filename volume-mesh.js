/* A restrained curved 2.5D surface. Feet remain anchored and faces never dissolve. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CeciliaVolume=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  function offset(u,v,{bodyYaw=0,headYaw=0,time=0}={}) {
    const head=1-smooth(.30,.43,v),feet=1-smooth(.85,1,v),x=u-.5;
    const headZ=.09*Math.max(0,1-(x/.24)**2-((v-.22)/.19)**2);
    const bodyZ=.045*Math.max(0,1-(x/.22)**2);
    const dx=(x*(Math.cos(headYaw)-1)+headZ*Math.sin(headYaw))*head+
      (x*(Math.cos(bodyYaw)-1)+bodyZ*Math.sin(bodyYaw))*(1-head)*feet+
      .004*Math.sin(time*1.8-v*2)*smooth(.35,.65,v)*feet*smooth(.23,.32,Math.abs(x));
    const dy=.0025*Math.sin(time*2.1)*(1-smooth(.65,1,v));
    const shade=.065*Math.sin(headYaw)*x/.24*head+.05*Math.sin(bodyYaw)*x/.30*(1-head)*feet;
    return [dx===0?0:dx,dy===0?0:dy,shade];
  }
  const shader=`
    float ease(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
    vec3 curved(vec2 p,vec3 model){
      float head=1.-ease(.30,.43,p.y),feet=1.-ease(.85,1.,p.y),x=p.x-.5;
      float hz=.09*max(0.,1.-pow(x/.24,2.)-pow((p.y-.22)/.19,2.));
      float bz=.045*max(0.,1.-pow(x/.22,2.));
      float dx=(x*(cos(model.y)-1.)+hz*sin(model.y))*head+
        (x*(cos(model.x)-1.)+bz*sin(model.x))*(1.-head)*feet+
        .004*sin(model.z*1.8-p.y*2.)*ease(.35,.65,p.y)*feet*ease(.23,.32,abs(x));
      float dy=.0025*sin(model.z*2.1)*(1.-ease(.65,1.,p.y));
      float light=.065*sin(model.y)*x/.24*head+.05*sin(model.x)*x/.30*(1.-head)*feet;
      return vec3(dx,dy,light);
    }`;
  return {offset,shader};
});
