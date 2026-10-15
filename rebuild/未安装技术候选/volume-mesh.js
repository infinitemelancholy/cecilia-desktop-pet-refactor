/* A restrained curved 2.5D surface. Feet remain anchored and faces never dissolve. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CeciliaVolume=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  function alignY(value,alignment) {
    if(!alignment)return value;
    const {sourceY,targetY,floorY}=alignment;
    const headScale=alignment.headScale===undefined?1:alignment.headScale;
    if(![value,sourceY,targetY,floorY,headScale].every(Number.isFinite) || sourceY<0 || targetY<0 ||
       sourceY>=floorY || targetY>=floorY || floorY>1 || headScale<.9 || headScale>1.1)throw Error('Invalid pose registration');
    return value<=sourceY ? (headScale===1?value+targetY-sourceY:targetY+(value-sourceY)*headScale) :
      targetY+(value-sourceY)*(floorY-targetY)/(floorY-sourceY);
  }
  function alignPoint(u,v,alignment) {
    if(!Number.isFinite(u))throw Error('Invalid pose registration');
    const y=alignY(v,alignment);
    const headScale=alignment?.headScale??1;
    const shift=alignment?.horizontalShift??0;
    if(!Number.isFinite(shift)||Math.abs(shift)>.025)throw Error('Invalid horizontal pose registration');
    const plantedShift=shift*(1-smooth(.42,alignment?.floorY??1,v));
    if(headScale===1)return [u+plantedShift,y];
    const weight=1-smooth(alignment.sourceY-.06,alignment.sourceY,v);
    return [.5+(u-.5)*(1+(headScale-1)*weight)+plantedShift,y];
  }
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
  const SPATIAL_DEFAULTS={headDepth:.13,bodyDepth:.08,rearHairDepth:.055,cameraDistance:1.75,lighting:.3};
  function spatialProfile(input={}) {
    if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!(key in SPATIAL_DEFAULTS)))
      throw Error('Invalid spatial volume profile');
    const p={...SPATIAL_DEFAULTS,...input};
    if(!Object.values(p).every(Number.isFinite) || p.headDepth<0 || p.headDepth>.18 ||
       p.bodyDepth<0 || p.bodyDepth>.12 || p.rearHairDepth<0 || p.rearHairDepth>.08 ||
       p.cameraDistance<1.4 || p.cameraDistance>3 || p.lighting<0 || p.lighting>.4)
      throw Error('Invalid spatial volume profile');
    return p;
  }
  function spatialSurface(u,v,p) {
    const x=u-.5,head=1-smooth(.35,.50,v);
    const hb=Math.max(0,1-(x/.23)**2-((v-.25)/.20)**2);
    const bb=Math.max(0,1-(x/.22)**2-((v-.60)/.32)**2);
    const hair=smooth(.23,.43,Math.abs(x))*smooth(.20,.36,v)*(1-smooth(.75,.94,v));
    return [p.headDepth*hb*hb*head+p.bodyDepth*bb*bb*(1-head)-p.rearHairDepth*hair,head,hair];
  }
  function spatialOffset(u,v,{bodyYaw=0,headYaw=0,time=0}={},profile={}) {
    if(![u,v,bodyYaw,headYaw,time].every(Number.isFinite) || time<0 || Math.abs(bodyYaw)>.35 || Math.abs(headYaw)>.35)
      throw Error('Spatial motion is limited to small finite turns');
    const p=spatialProfile(profile),[z,head,hair]=spatialSurface(u,v,p);
    const planted=1-smooth(.80,.97,v);if(planted===0)return [0,0,0];
    const yaw=bodyYaw*(1-head)+headYaw*head,ca=Math.cos(yaw),sa=Math.sin(yaw),x=u-.5;
    const rotatedX=x*ca+z*sa,rotatedZ=z*ca-x*sa;
    const perspective=(p.cameraDistance-z)/(p.cameraDistance-rotatedZ);
    const breath=Math.sin(time*1.4),chest=Math.max(0,1-((v-.55)/.23)**2);
    const dx=((rotatedX*perspective-x)+.006*(Math.sin(time*1.6-v*2)-Math.sin(-v*2))*hair+.014*x*breath*chest)*planted;
    const dy=((v-.45)*(perspective-1)-.0045*breath*(.45+.55*head)-.003*breath*chest)*planted;
    const e=.001;
    const gx=(spatialSurface(u+e,v,p)[0]-spatialSurface(u-e,v,p)[0])/(2*e);
    const gy=(spatialSurface(u,v+e,p)[0]-spatialSurface(u,v-e,p)[0])/(2*e);
    const length=Math.hypot(gx,gy,1),nx=-gx/length,nz=1/length;
    const shade=p.lighting*((nx*ca+nz*sa-nx)*-.45+(nz*ca-nx*sa-nz)*.86)*planted;
    return [dx===0?0:dx,dy===0?0:dy,shade===0?0:shade];
  }
  const shader=`
    vec3 spatialSurface(vec2 p,vec4 profile){
      float x=p.x-.5,head=1.-smoothstep(.35,.50,p.y);
      vec2 h=vec2(x/.23,(p.y-.25)/.20),b=vec2(x/.22,(p.y-.60)/.32);
      float hb=max(0.,1.-dot(h,h)),bb=max(0.,1.-dot(b,b));
      float hair=smoothstep(.23,.43,abs(x))*smoothstep(.20,.36,p.y)*(1.-smoothstep(.75,.94,p.y));
      return vec3(profile.x*hb*hb*head+profile.y*bb*bb*(1.-head)-profile.z*hair,head,hair);
    }
    vec3 spatial(vec2 p,vec3 motion,vec4 profile,float lighting){
      vec3 surface=spatialSurface(p,profile);float z=surface.x,head=surface.y,hair=surface.z;
      float planted=1.-smoothstep(.80,.97,p.y);if(planted==0.)return vec3(0.);
      float yaw=mix(motion.x,motion.y,head),ca=cos(yaw),sa=sin(yaw),x=p.x-.5;
      float rx=x*ca+z*sa,rz=z*ca-x*sa,k=(profile.w-z)/(profile.w-rz);
      float breath=sin(motion.z*1.4),chestY=(p.y-.55)/.23,chest=max(0.,1.-chestY*chestY);
      float dx=(rx*k-x+.006*(sin(motion.z*1.6-p.y*2.)-sin(-p.y*2.))*hair+.014*x*breath*chest)*planted;
      float dy=((p.y-.45)*(k-1.)-.0045*breath*(.45+.55*head)-.003*breath*chest)*planted;
      float gx=(spatialSurface(p+vec2(.001,0.),profile).x-spatialSurface(p-vec2(.001,0.),profile).x)/.002;
      float gy=(spatialSurface(p+vec2(0.,.001),profile).x-spatialSurface(p-vec2(0.,.001),profile).x)/.002;
      vec3 normal=normalize(vec3(-gx,-gy,1.));
      float light=lighting*((normal.x*ca+normal.z*sa-normal.x)*-.45+(normal.z*ca-normal.x*sa-normal.z)*.86)*planted;
      return vec3(dx,dy,light);
    }
    vec2 alignPose(vec2 p,vec4 alignment){
      float y=p.y<=alignment.x ? (alignment.w==1. ? p.y+alignment.y-alignment.x : alignment.y+(p.y-alignment.x)*alignment.w) :
        alignment.y+(p.y-alignment.x)*(alignment.z-alignment.y)/(alignment.z-alignment.x);
      if(alignment.w==1.)return vec2(p.x,y);
      float weight=1.-smoothstep(alignment.x-.06,alignment.x,p.y);
      return vec2(.5+(p.x-.5)*(1.+(alignment.w-1.)*weight),y);
    }
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
  return {offset,alignY,alignPoint,spatialProfile,spatialOffset,shader};
});
