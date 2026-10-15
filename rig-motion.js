/* Fixed painted parts, continuous motion and two-bone inverse kinematics. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CeciliaRig=api;})(globalThis,function(){
  'use strict';
  const identity=[1,0,0,1,0,0];
  function apply(m,p){return [m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]];}
  function compose(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
  function rotate(p,angle){const c=Math.cos(angle),s=Math.sin(angle);return [c,s,-s,c,p[0]-c*p[0]+s*p[1],p[1]-s*p[0]-c*p[1]];}
  function arm(shoulder,elbow,wrist,goal,side){
    const l1=Math.hypot(elbow[0]-shoulder[0],elbow[1]-shoulder[1]),l2=Math.hypot(wrist[0]-elbow[0],wrist[1]-elbow[1]);
    const dx=goal[0]-shoulder[0],dy=goal[1]-shoulder[1],raw=Math.hypot(dx,dy);
    const d=Math.max(Math.abs(l1-l2)+1e-6,Math.min(l1+l2-1e-6,raw));
    const angle=Math.atan2(dy,dx)+(side||1)*Math.acos(Math.max(-1,Math.min(1,(l1*l1+d*d-l2*l2)/(2*l1*d))));
    const joint=[shoulder[0]+l1*Math.cos(angle),shoulder[1]+l1*Math.sin(angle)];
    const target=[shoulder[0]+dx*d/(raw||1),shoulder[1]+dy*d/(raw||1)];
    const upper=rotate(shoulder,angle-Math.atan2(elbow[1]-shoulder[1],elbow[0]-shoulder[0]));
    const lower=rotate(elbow,Math.atan2(target[1]-joint[1],target[0]-joint[0])-Math.atan2(wrist[1]-elbow[1],wrist[0]-elbow[0]));
    lower[4]+=joint[0]-elbow[0];lower[5]+=joint[1]-elbow[1];
    return {upper,lower,joint,target};
  }
  function pose(name,u){
    const p=Math.max(0,Math.min(1,u)),s=Math.sin(2*Math.PI*p),c=Math.cos(2*Math.PI*p),e=Math.sin(Math.PI*p)**2;
    const r={rootY:0,roll:0,headRoll:0,bodyYaw:0,headYaw:0,leftHand:[61,130],rightHand:[131,130],leftLeg:0,rightLeg:0,legLift:0,blink:0};
    if(name==='running'){r.leftLeg=.045*s;r.rightLeg=-.045*s;r.leftHand=[61+7*s,130-4*s];r.rightHand=[131-7*s,130+4*s];r.roll=.018*s;r.bodyYaw=.08*s;r.headYaw=-.12*s;}
    else if(name==='hop'){r.rootY=12*e-15*e*e;r.legLift=22*e;r.leftLeg=-.18*e;r.rightLeg=.18*e;r.leftHand=[61-7*e,130-16*e];r.rightHand=[131+7*e,130-16*e];}
    else if(name==='op-turn'){r.bodyYaw=.24*s;r.headYaw=.32*s;r.roll=.035*s;r.leftHand=[61-10*e,130-12*e];r.rightHand=[131+10*e,130-12*e];}
    else if(name==='tiptoe-clap'){r.rootY=-3*e;r.leftHand=[61+33*e,130-27*e];r.rightHand=[131-32*e,130-27*e];r.headRoll=.025*s;}
    else if(name==='small-sway'){r.roll=.045*s;r.headRoll=-.04*s;r.bodyYaw=.10*s;r.headYaw=-.15*s;r.leftHand=[61-6*e,130-5*e];r.rightHand=[131+6*e,130-5*e];}
    else if(['shy','pout','bean','review','waiting'].includes(name)){r.leftHand=[61+18*e,130-18*e];r.rightHand=[131-18*e,130-18*e];r.headRoll=.055*s;r.headYaw=.10*s;}
    else if(['sleepy','lie','lump'].includes(name)){r.rootY=8*e;r.headRoll=.12*e;r.legLift=10*e;r.blink=e;}
    else if(name.includes('showcase')){r.leftHand=[61-9*e,130-24*e];r.rightHand=[131+9*e,130-24*e];r.bodyYaw=.12*s;r.headYaw=.18*s;}
    else if(name==='lawrence-sleeve'){r.headYaw=.18*e;r.rightHand=[131+35*e,130-10*e];r.leftHand=[61+4*e,130-8*e];}
    else if(name==='lawrence-care'){r.headYaw=.18*e;r.rightHand=[131+22*e,130-30*e];r.leftHand=[61+4*e,130-8*e];}
    else if(name.includes('chat')){r.headYaw=.18*e;r.rightHand=[131+5*e,130-24*e];r.leftHand=[61,130-5*e];}
    else {r.headRoll=.02*s;r.bodyYaw=.035*s;r.headYaw=.075*s;}
    return r;
  }
  function limb(actor,side,hand){
    const [shoulder,elbow,wrist,bend]=actor.bones[side];
    const neutral=side==='left'?[61,130]:[131,130];
    const goal=[wrist[0]+hand[0]-neutral[0],wrist[1]+hand[1]-neutral[1]];
    if(actor.shoulderFixed){
      // A cape's shoulder fabric stays attached to the torso. The exposed
      // forearm rotates at the elbow rather than tearing the cape panel away.
      const angle=Math.atan2(goal[1]-elbow[1],goal[0]-elbow[0])-Math.atan2(wrist[1]-elbow[1],wrist[0]-elbow[0]);
      return {upper:identity,lower:rotate(elbow,angle)};
    }
    return arm(shoulder,elbow,wrist,goal,bend);
  }
  function expand(layer,rig){
    const spec=layer.rig,owner=['classic','travel','cafe'].includes(spec.person),actor=rig.actors[spec.person],common=owner?rig.actors.travel:actor;
    const p=pose(spec.action,spec.phase),offset=[1,0,0,1,layer.target[0]-26,p.rootY];
    const parent=compose(offset,rotate([96,190],p.roll)),head=compose(parent,rotate([96,65],p.headRoll));
    const layers=[];
    function part(name,source=actor,matrix=parent,volume){const item=source.parts[name];if(!item)return;
      layers.push({...item,matrix,opacity:layer.opacity??1,...(volume?{volume}:{} )});}
    const volume={bodyYaw:p.bodyYaw,headYaw:p.headYaw,time:spec.phase*6};
    part('hairBack',common,compose(parent,rotate([96,70],.025*Math.sin(spec.phase*Math.PI*2))));
    part('leftLeg',common,compose(parent,compose([1,0,0,1,0,-p.legLift],rotate([90,155],p.leftLeg))));
    part('rightLeg',common,compose(parent,compose([1,0,0,1,0,-p.legLift],rotate([103,155],p.rightLeg))));
    part('body',actor,parent,volume);
    const left=limb(actor,'left',p.leftHand),right=limb(actor,'right',p.rightHand);
    part('leftUpper',actor,compose(parent,left.upper));part('leftLower',actor,compose(parent,left.lower));
    part('rightUpper',actor,compose(parent,right.upper));part('rightLower',actor,compose(parent,right.lower));
    part('hairFront',common,compose(parent,rotate([78,68],.018*Math.sin(spec.phase*Math.PI*2))));
    part('head',common,head,volume);part('headwear',actor,head,volume);part('bow',actor,parent);
    return layers;
  }
  function surface(person,action,phase,x=0){
    const p=pose(action,phase),shift=person==='classic'?-26*202/1536:0;
    if(person==='lawrence' && action.startsWith('lawrence')){
      const e=Math.sin(Math.PI*phase)**2;p.leftHand=[61+3*e,130-(action==='lawrence-care'?30:10)*e];p.rightHand=[131,130-4*e];p.headYaw=-.18*e;
    }
    const layer={asset:'portrait_'+person,source:[0,0,1024,1536],target:[x+26,5+shift,140,202],
      volume:{bodyYaw:p.bodyYaw,headYaw:p.headYaw,time:Math.sin(phase*Math.PI*2)*.45},
      skeleton:{limbs:[(p.leftHand[0]-61)/140,(p.leftHand[1]-130)/202,(p.rightHand[0]-131)/140,(p.rightHand[1]-130)/202],
        torso:[p.headRoll,0,0,0],legs:[p.leftLeg,(p.legLift+(action==='running'?6*Math.max(0,Math.sin(phase*Math.PI*2)):0))/202,(p.legLift+(action==='running'?6*Math.max(0,-Math.sin(phase*Math.PI*2)):0))/202]},
      matrix:compose([1,0,0,1,0,p.rootY],rotate([x+96,190],p.roll))};
    layer.blink=p.blink;
    if(['classic','travel','cafe'].includes(person))layer.face={asset:'identity_face',transform:{matrix:[1024/390,0,0,1536/195],offset:[-330/390,(-275+26*(person==='classic'))/195]}};
    if(action==='lie'||action==='lump'){
      const amount=Math.sin(Math.PI*phase)**2,angle=-1.1*amount;
      const scale=1-.25*amount,center=[x+96,112],m=rotate(center,angle);
      layer.matrix=compose([scale,0,0,scale,(x+96)*(1-scale),132*(1-scale)],m);
    }
    return layer;
  }
  function hybrid(person,action,phase,x,rig){
    const base=surface(person,action,phase,x),p=pose(action,phase),parent=base.matrix;
    // The complete, inpainted torso retains every hair and cloth pixel; only
    // the explicitly detached sleeves move on the limb bones.
    base.skeleton.limbs=[0,0,0,0];const result=[base];
    if(base.face)base.face.transform=rig.faceTransforms[person];
    if(person==='lawrence' && action.startsWith('lawrence')){const e=Math.sin(Math.PI*phase)**2;p.leftHand=[61-12*e,130-(action==='lawrence-care'?17:12)*e];p.rightHand=[131,130-4*e];}
    const actor=rig.actors[person];
    const left=limb(actor,'left',p.leftHand),right=limb(actor,'right',p.rightHand);
    for(const [name,matrix]of [['leftUpper',left.upper],['leftLower',left.lower],['rightUpper',right.upper],['rightLower',right.lower]]){
      const part=rig.actors[person].parts[name];if(part)result.push({...part,matrix:compose(parent,compose([1,0,0,1,x,0],matrix))});
    }
    return result;
  }
  return {identity,apply,compose,rotate,arm,pose,expand,surface,hybrid};
});
