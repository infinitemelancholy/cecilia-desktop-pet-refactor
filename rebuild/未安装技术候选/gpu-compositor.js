/* GPU geometry between registered poses; color is never dissolved between drawings. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./volume-mesh.js'):root.CeciliaVolume);if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CeciliaGPU=api;
})(typeof globalThis==='object'?globalThis:this,function(Volume){
  'use strict';
  const vertex=`attribute vec2 position;attribute vec2 texcoord;varying vec2 uv;varying float meshLight;
    uniform vec4 clipRect;uniform vec3 volumeModel;uniform float volumeEnabled;uniform float actorCount;
    uniform vec4 poseAlignment;uniform float poseAlignmentEnabled;uniform float poseHorizontalShift;
    uniform float spatialEnabled;uniform vec4 spatialProfile;uniform float spatialLighting;
    uniform vec4 logicalRect;uniform vec2 logicalViewport;uniform vec4 boneMatrix;uniform vec2 boneOffset;
    uniform float rigEnabled;uniform vec4 limbMotion;uniform vec4 torsoMotion;uniform vec3 legMotion;uniform float legSpacing;
    ${Volume.shader}
    float influence(vec2 p,vec2 center,vec2 radius){vec2 d=(p-center)/radius;return exp(-dot(d,d)*2.);}
    void main(){uv=texcoord;vec2 shaped=position;meshLight=0.;
      if(rigEnabled>.5){float below=smoothstep(.30,.38,position.y);
        float left=influence(position,vec2(.25,.59),vec2(.21,.22))*below;
        float right=influence(position,vec2(.75,.59),vec2(.21,.22))*below;
        shaped+=vec2(limbMotion.x*left+limbMotion.z*right,limbMotion.y*left+limbMotion.w*right);
        float legWidth=smoothstep(.36,.40,position.x)*(1.-smoothstep(.62,.66,position.x));
        float legs=smoothstep(.80,.87,position.y)*legWidth;float side=position.x<.507?1.:-1.;
        shaped.x+=legMotion.x*side*legs*(position.y-.72);
        shaped.x-=side*legSpacing*legs*smoothstep(.84,.93,position.y);
        shaped.y-=(side>0.?legMotion.y:legMotion.z)*legs;
        float head=1.-smoothstep(.29,.34,position.y);vec2 q=position-vec2(.5,.30);
        float angle=torsoMotion.x*head;float ca=cos(angle),sa=sin(angle);
        shaped+=vec2(ca*q.x-sa*q.y,sa*q.x+ca*q.y)-q;
      }
      if(poseAlignmentEnabled>.5){shaped=alignPose(shaped,poseAlignment);
        shaped.x+=poseHorizontalShift*(1.-smoothstep(.42,poseAlignment.z,position.y));}
      vec2 point=mix(clipRect.xy,clipRect.zw,shaped);
      if(volumeEnabled>.5){vec2 local=vec2(fract(min(position.x,.99999)*actorCount),position.y);
        if(poseAlignmentEnabled>.5){local.x=fract(clamp(shaped.x,0.,.99999)*actorCount);local.y=shaped.y;}
        vec3 delta=spatialEnabled>.5?spatial(local,volumeModel,spatialProfile,spatialLighting):curved(local,volumeModel);delta.x/=actorCount;
        point+=delta.xy*(clipRect.zw-clipRect.xy);meshLight=delta.z;}
      vec2 logical=vec2((point.x+1.)*.5*logicalViewport.x,(1.-point.y)*.5*logicalViewport.y);
      logical=vec2(dot(boneMatrix.xy,logical),dot(boneMatrix.zw,logical))+boneOffset;
      gl_Position=vec4(logical.x/logicalViewport.x*2.-1.,1.-logical.y/logicalViewport.y*2.,0.,1.);}`;
  const fragment=`precision highp float;varying vec2 uv;varying float meshLight;
    uniform sampler2D poses;uniform sampler2D flow;
    uniform sampler2D identityFace;uniform float hasIdentityFace;uniform float faceValidA;uniform float faceValidB;
    uniform vec4 faceMatrixA;uniform vec4 faceMatrixB;uniform vec2 faceOffsetA;uniform vec2 faceOffsetB;
    uniform vec4 rectA;uniform vec4 rectB;uniform vec4 flowA;uniform vec4 flowB;
    uniform vec2 poseSize;uniform float flowRange;uniform float anchorMix;
    uniform float poseTime;uniform float sourceSwitch;uniform float opacity;uniform float hasFlow;uniform float flowRowOffset;uniform float guestOpacity;uniform float hasVisibility;uniform float ownershipExponent;
    uniform vec4 neutralRect;uniform float hasGuestMask;
    uniform float blink;
    uniform float bootGap;uniform float groundLimit;uniform float footCut;
    uniform float partMaskEnabled;uniform vec2 partPolygon[10];uniform float partPolygonCount;
    uniform vec2 partYBounds;uniform float excludeHair;
    uniform float hasStableMaterial;uniform vec4 stableMaterialRect;
    uniform float spatialEnabled;
    uniform float hasAuthoredBlink;uniform vec4 blinkRect;uniform vec4 blinkTransform;
    uniform vec4 blinkRegionA;uniform vec4 blinkRegionB;
    vec4 source(vec2 p,vec4 r){
      if(p.x<0.||p.y<0.||p.x>1.||p.y>1.)return vec4(0.);
      return texture2D(poses,r.xy+clamp(p,vec2(.0003),vec2(.9997))*r.zw);
    }
    void main(){
      if(groundLimit>0. && uv.y>groundLimit)discard;
      if(footCut>0. && uv.y>footCut && uv.x>.39 && uv.x<.64)discard;
      if(bootGap>0. && uv.y>.905 && abs(uv.x-.507)<bootGap)discard;
      if(partMaskEnabled>.5){
        bool inside=false;
        for(int i=0;i<10;i++){
          if(float(i)>=partPolygonCount)break;
          vec2 a=partPolygon[i],b=partPolygon[0];
          if(float(i+1)<partPolygonCount)b=partPolygon[i+1];
          if((a.y>uv.y)!=(b.y>uv.y) && uv.x<(b.x-a.x)*(uv.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
        }
        if(!inside || uv.y<partYBounds.x || uv.y>partYBounds.y)discard;
      }
      vec4 color;vec2 sampled=uv;bool fromFirst=true;
      if(hasFlow<.5){color=source(uv,rectA);}
      else{
        vec2 fa=flowA.xy+uv*flowA.zw,fb=flowB.xy+uv*flowB.zw;
        vec4 field=mix(texture2D(flow,fa),texture2D(flow,fb),anchorMix);
        field.a=mix(texture2D(flow,fa+vec2(0.,flowRowOffset)).r,
          texture2D(flow,fb+vec2(0.,flowRowOffset)).r,anchorMix);
        field=(field*255.-128.)*flowRange/127.;
        // Switch a whole authored actor together. A spatial source wipe splits
        // the face, sleeves and hair between incompatible painted orientations.
        fromFirst=poseTime<sourceSwitch;sampled=uv+(fromFirst?field.xy:field.zw)/poseSize;
        color=fromFirst?source(sampled,rectA):source(sampled,rectB);
        if(hasVisibility>.5){
          // RIFE supplies occlusion ownership after both painted sources have
          // reached the SAME intermediate geometry. Premultiplied RGBA keeps
          // transparent edges clean; endpoint colours remain exact.
          float ownership=mix(texture2D(flow,fa+vec2(0.,flowRowOffset)).g,
            texture2D(flow,fb+vec2(0.,flowRowOffset)).g,anchorMix);
          float ownA=pow(ownership,ownershipExponent),ownB=pow(1.-ownership,ownershipExponent);
          ownership=ownA/max(ownA+ownB,.000001);
          ownership=mix(1.,ownership,smoothstep(0.,.04,poseTime));
          ownership*=1.-smoothstep(.96,1.,poseTime);
          color=mix(source(uv+field.zw/poseSize,rectB),source(uv+field.xy/poseSize,rectA),ownership);
        }
      }
      if(hasStableMaterial>.5){
        float arms=smoothstep(.46,.49,uv.y)*(1.-smoothstep(.64,.70,uv.y))*
          (1.-smoothstep(.40,.44,uv.x)+smoothstep(.56,.60,uv.x));
        color=mix(source(uv,stableMaterialRect),color,clamp(arms,0.,1.));
      }
      if(hasAuthoredBlink>.5){
        float a=length((uv-blinkRegionA.xy)/blinkRegionA.zw);
        float b=length((uv-blinkRegionB.xy)/blinkRegionB.zw);
        float weight=1.-smoothstep(.78,1.,min(a,b));
        if(weight>0.)color=mix(color,source(uv*blinkTransform.xy+blinkTransform.zw,blinkRect),weight);
      }
      if(hasIdentityFace>.5 && (fromFirst?faceValidA:faceValidB)>.5){
        vec4 matrix=fromFirst?faceMatrixA:faceMatrixB;vec2 origin=fromFirst?faceOffsetA:faceOffsetB;
        vec2 faceUV=vec2(dot(matrix.xy,sampled),dot(matrix.zw,sampled))+origin;
        float radius=length((faceUV-vec2(.5))*2.);
        if(radius<.98){vec4 core=texture2D(identityFace,clamp(faceUV,vec2(0.),vec2(1.)));
          if(core.a>.8){
            if(blink>.001){
              for(int eye=0;eye<2;eye++){
                vec2 center=eye==0?vec2(.282,.413):vec2(.671,.282);vec2 d=faceUV-center;
                float edge=1.-smoothstep(.92,1.,length(d/vec2(.16,.31)));
                float lid=smoothstep(.035,.055,blink*.62-.31-d.y)*edge;
                vec4 skin=texture2D(identityFace,center+vec2(0.,.32));
                core=mix(core,skin,lid);
                float lineY=.065+.035*(1.-pow(d.x/.13,2.));
                float line=(1.-smoothstep(.010,.018,abs(d.y-lineY)))*(1.-smoothstep(.11,.14,abs(d.x)))*smoothstep(.85,.98,blink);
                core.rgb=mix(core.rgb,vec3(.20,.12,.12)*core.a,line);
              }
            }
            color=mix(color,core,1.-smoothstep(.65,.98,radius));}}
      }
      if(color.a<.008)color=vec4(0.);
      if(excludeHair>.5 && color.g>color.r+3./255.*color.a && color.g>color.b+14./255.*color.a)discard;
      if(hasGuestMask>.5 && source(uv,neutralRect).a<.008)color*=guestOpacity;
      color.rgb*=spatialEnabled>.5?clamp(1.+meshLight,.82,1.18):clamp(1.+meshLight,.92,1.08);
      if(spatialEnabled>.5)color.rgb=min(color.rgb,vec3(color.a));
      gl_FragColor=color*opacity;
    }`;

  function create(canvas){
    const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true});
    if(!gl?.createShader)throw Error('GPU motion requires a WebGL context');
    function shader(type,source){
      const value=gl.createShader(type);gl.shaderSource(value,source);gl.compileShader(value);
      if(!gl.getShaderParameter(value,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(value));
      return value;
    }
    const program=gl.createProgram(),vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    const uniforms=Object.fromEntries(['poses','flow','rectA','rectB','flowA','flowB','poseSize',
      'flowRange','anchorMix','poseTime','sourceSwitch','opacity','hasFlow','flowRowOffset','guestOpacity','neutralRect','hasGuestMask','hasVisibility','ownershipExponent',
      'clipRect','volumeModel','volumeEnabled','actorCount','poseAlignment','poseAlignmentEnabled','poseHorizontalShift','spatialEnabled','spatialProfile','spatialLighting','identityFace','hasIdentityFace',
      'faceValidA','faceValidB','faceMatrixA','faceMatrixB','faceOffsetA','faceOffsetB',
      'logicalRect','logicalViewport','boneMatrix','boneOffset','rigEnabled','limbMotion','torsoMotion','legMotion','blink',
      'hasAuthoredBlink','blinkRect','blinkTransform','blinkRegionA','blinkRegionB',
      'partMaskEnabled','partPolygon[0]','partPolygonCount','partYBounds','excludeHair','hasStableMaterial','stableMaterialRect','legSpacing','bootGap','groundLimit','footCut'].map(name=>[name,gl.getUniformLocation(program,name)]));
    const positions=gl.createBuffer(),coordinates=gl.createBuffer();
    const position=gl.getAttribLocation(program,'position'),texcoord=gl.getAttribLocation(program,'texcoord');
    const cells=[];
    for(let row=0;row<64;row++)for(let column=0;column<48;column++) {
      const x=column/48,y=row/64,r=(column+1)/48,b=(row+1)/64;
      cells.push(x,y,r,y,x,b,x,b,r,y,r,b);
    }
    const grid=new Float32Array(cells),vertexCount=grid.length/2;
    gl.bindBuffer(gl.ARRAY_BUFFER,positions);gl.bufferData(gl.ARRAY_BUFFER,grid,gl.STATIC_DRAW);
    gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,coordinates);
    gl.bufferData(gl.ARRAY_BUFFER,grid,gl.STATIC_DRAW);
    gl.enableVertexAttribArray(texcoord);gl.vertexAttribPointer(texcoord,2,gl.FLOAT,false,0,0);
    const textures=new Map(),uploads=new Map(),prepared=new Set();let scaleX=1,scaleY=1;
    function texture(image,unit,premultiply){
      gl.activeTexture(gl.TEXTURE0+unit);
      let value=textures.get(image);
      if(!value){
        value=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,value);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiply);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
        textures.set(image,value);
      }
      gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,value);
    }
    function normalized(bounds,metadata){return bounds.map((value,index)=>value/(index%2?metadata.height:metadata.width));}
    function prepareTexture(image,premultiply){
      if(prepared.has(image))return Promise.resolve();
      if(uploads.has(image))return uploads.get(image);
      const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
      const value=gl.createTexture();textures.set(image,value);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,value);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      const task=(async()=>{
        const band=new OffscreenCanvas(width,64),context=band.getContext('2d');
        for(let row=0;row<height;row+=64){
          if(!textures.has(image))return;
          const rows=Math.min(64,height-row);if(band.height!==rows)band.height=rows;
          context.clearRect(0,0,width,rows);context.drawImage(image,0,-row);
          gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,value);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiply);
          gl.texSubImage2D(gl.TEXTURE_2D,0,0,row,gl.RGBA,gl.UNSIGNED_BYTE,band);
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        prepared.add(image);uploads.delete(image);
      })();uploads.set(image,task);return task;
    }
    return {
      gpu:true,globalAlpha:1,
      prepareTexture,textureReady(image){return prepared.has(image);},
      clearRect(){gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);},
      setTransform(a,b,c,d){scaleX=a;scaleY=d;},
      drawLayer(image,layer,getAsset,metadata){
        gl.useProgram(program);texture(image,0,true);gl.uniform1i(uniforms.poses,0);
        const motion=layer.motion;
        const info=metadata[layer.asset];
        gl.uniform4fv(uniforms.rectA,normalized(motion?.first||layer.source,info));
        gl.uniform4fv(uniforms.rectB,normalized(motion?.second||layer.source,info));
        const authoredBlink=layer.authoredBlink;
        if(authoredBlink)validateAuthoredBlink(authoredBlink,info,motion);
        gl.uniform1f(uniforms.hasAuthoredBlink,authoredBlink?1:0);
        if(authoredBlink){
          gl.uniform4fv(uniforms.blinkRect,normalized(authoredBlink.source,info));
          gl.uniform4fv(uniforms.blinkTransform,authoredBlink.transform);
          gl.uniform4fv(uniforms.blinkRegionA,authoredBlink.regions[0]);
          gl.uniform4fv(uniforms.blinkRegionB,authoredBlink.regions[1]);
        }
        gl.uniform1f(uniforms.opacity,layer.opacity??1);
        const mask=layer.partMask;
        gl.uniform1f(uniforms.hasStableMaterial,layer.stableMaterial?1:0);
        if(layer.stableMaterial)gl.uniform4fv(uniforms.stableMaterialRect,normalized(layer.stableMaterial,info));
        gl.uniform1f(uniforms.partMaskEnabled,mask?1:0);
        gl.uniform1f(uniforms.excludeHair,mask?.excludeHair?1:0);
        if(mask){
          const polygon=mask.polygon.flat();while(polygon.length<20)polygon.push(0);
          gl.uniform2fv(uniforms['partPolygon[0]'],polygon);
          gl.uniform1f(uniforms.partPolygonCount,mask.polygon.length);
          gl.uniform2fv(uniforms.partYBounds,mask.yBounds);
        }
        gl.uniform1f(uniforms.guestOpacity,layer.guestOpacity??1);
        gl.uniform1f(uniforms.hasGuestMask,layer.guestMask?1:0);
        if(layer.guestMask)gl.uniform4fv(uniforms.neutralRect,normalized(layer.guestMask,info));
        gl.uniform1f(uniforms.hasFlow,motion?1:0);
        gl.uniform1f(uniforms.hasVisibility,motion?.visibility?1:0);
        gl.uniform1f(uniforms.ownershipExponent,motion?.ownershipExponent||1);
        gl.uniform1f(uniforms.groundLimit,motion?.groundLimit||0);
        gl.uniform1f(uniforms.footCut,layer.footCut||0);
        const volume=layer.volume;
        const spatialProfile=volume?.spatial?Volume.spatialProfile(volume.spatial):null;
        if(spatialProfile)Volume.spatialOffset(.5,.5,volume,spatialProfile);
        gl.uniform1f(uniforms.spatialEnabled,spatialProfile?1:0);
        gl.uniform4fv(uniforms.spatialProfile,spatialProfile?[spatialProfile.headDepth,spatialProfile.bodyDepth,spatialProfile.rearHairDepth,spatialProfile.cameraDistance]:[.13,.08,.055,1.75]);
        gl.uniform1f(uniforms.spatialLighting,spatialProfile?.lighting??.3);
        const alignment=layer.poseAlignment;
        if(alignment)Volume.alignPoint(.5,.5,alignment);
        gl.uniform1f(uniforms.poseAlignmentEnabled,alignment?1:0);
        gl.uniform4fv(uniforms.poseAlignment,alignment?[alignment.sourceY,alignment.targetY,alignment.floorY,alignment.headScale??1]:[.5,.5,1,1]);
        gl.uniform1f(uniforms.poseHorizontalShift,alignment?.horizontalShift??0);
        gl.uniform1f(uniforms.volumeEnabled,volume?1:0);
        gl.uniform3fv(uniforms.volumeModel,[volume?.bodyYaw||0,volume?.headYaw||0,volume?.time||0]);
        gl.uniform1f(uniforms.actorCount,layer.target[2]>192?2:1);
        const skeleton=layer.skeleton;
        gl.uniform1f(uniforms.rigEnabled,skeleton?1:0);
        gl.uniform4fv(uniforms.limbMotion,skeleton?.limbs||[0,0,0,0]);
        gl.uniform4fv(uniforms.torsoMotion,skeleton?.torso||[0,0,0,0]);
        gl.uniform3fv(uniforms.legMotion,skeleton?.legs||[0,0,0]);
        gl.uniform1f(uniforms.legSpacing,layer.legSpacing||0);gl.uniform1f(uniforms.bootGap,layer.bootGap||0);
        const identity=layer.face;
        gl.uniform1f(uniforms.blink,layer.blink||0);
        gl.uniform1f(uniforms.hasIdentityFace,identity?1:0);
        if(identity){
          texture(getAsset(identity.asset),2,true);gl.uniform1i(uniforms.identityFace,2);
          const a=motion?.faceFirst||identity.transform,b=motion?.faceSecond||identity.transform;
          gl.uniform1f(uniforms.faceValidA,a?1:0);gl.uniform1f(uniforms.faceValidB,b?1:0);
          gl.uniform4fv(uniforms.faceMatrixA,a?.matrix||[0,0,0,0]);
          gl.uniform4fv(uniforms.faceMatrixB,b?.matrix||[0,0,0,0]);
          gl.uniform2fv(uniforms.faceOffsetA,a?.offset||[0,0]);gl.uniform2fv(uniforms.faceOffsetB,b?.offset||[0,0]);
        }
        if(motion){
          const flowImage=getAsset(motion.asset);texture(flowImage,1,false);
          const flowInfo=metadata[motion.asset];
          gl.uniform1i(uniforms.flow,1);
          gl.uniform4fv(uniforms.flowA,normalized(motion.flowFirst,flowInfo));
          gl.uniform4fv(uniforms.flowB,normalized(motion.flowSecond,flowInfo));
          gl.uniform2fv(uniforms.poseSize,motion.poseSize);
          gl.uniform1f(uniforms.flowRange,motion.range);
          gl.uniform1f(uniforms.flowRowOffset,motion.gridHeight/flowInfo.height);
          gl.uniform1f(uniforms.anchorMix,motion.anchorMix);
          gl.uniform1f(uniforms.poseTime,motion.time);
          gl.uniform1f(uniforms.sourceSwitch,motion.sourceSwitch??.5);
        }
        const [x,y,w,h]=layer.target;
        const left=x*scaleX/canvas.width*2-1,right=(x+w)*scaleX/canvas.width*2-1;
        const top=1-y*scaleY/canvas.height*2,bottom=1-(y+h)*scaleY/canvas.height*2;
        gl.uniform4fv(uniforms.clipRect,[left,top,right,bottom]);
        const matrix=layer.matrix||[1,0,0,1,0,0];
        gl.uniform2fv(uniforms.logicalViewport,[canvas.width/scaleX,canvas.height/scaleY]);
        gl.uniform4fv(uniforms.boneMatrix,[matrix[0],matrix[2],matrix[1],matrix[3]]);
        gl.uniform2fv(uniforms.boneOffset,[matrix[4],matrix[5]]);
        gl.bindBuffer(gl.ARRAY_BUFFER,positions);
        gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,coordinates);gl.vertexAttribPointer(texcoord,2,gl.FLOAT,false,0,0);
        gl.drawArrays(gl.TRIANGLES,0,vertexCount);
      },
      release(image){const value=textures.get(image);if(value){gl.deleteTexture(value);textures.delete(image);prepared.delete(image);uploads.delete(image);}},
      stop(){for(const value of textures.values())gl.deleteTexture(value);textures.clear();
        gl.deleteBuffer(positions);gl.deleteBuffer(coordinates);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);},
      pixels(){const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;},
    };
  }
  function validateAuthoredBlink(blink,info,motion){
    const finite4=v=>Array.isArray(v)&&v.length===4&&v.every(Number.isFinite);
    if(motion || !blink || !finite4(blink.source) || !finite4(blink.transform) ||
      !Array.isArray(blink.regions) || blink.regions.length!==2 || !blink.regions.every(finite4))throw Error('Invalid authored blink');
    const [x,y,w,h]=blink.source,[sx,sy,tx,ty]=blink.transform;
    if(x<0||y<0||w<=0||h<=0||x+w>info.width||y+h>info.height||sx<.8||sx>1.25||sy<.8||sy>1.25||Math.abs(tx)>.1||Math.abs(ty)>.1 ||
      blink.regions.some(([u,v,rx,ry])=>u<.25||u>.75||v<.15||v>.36||rx<=0||rx>.09||ry<=0||ry>.09))throw Error('Invalid authored blink');
    return blink;
  }
  return {create,validateAuthoredBlink};
});
