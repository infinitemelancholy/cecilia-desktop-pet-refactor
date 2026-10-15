/* Composes authored PNG frames inside the original native pet renderer. */
(function (root, factory) {
  const api = factory(typeof module==='object'&&module.exports?require('./cel-timeline.js'):root.CeciliaCels);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CeciliaPlayer = api;
})(typeof globalThis === 'object' ? globalThis : this, function (Cels) {
  'use strict';
  const SELECTOR = '[data-testid="avatar-mascot-button"]';
  const MEASURE = '[data-avatar-overlay-size="mascot"]';
  const HEARTBEAT_MS = 5000;
  const LOGICAL_WIDTH = 192, LOGICAL_HEIGHT = 208;
    const LAYOUT_MOVE_MS=500;
    const TARGET_FRAME_MS=1000/120;
  const displayOffsets=new WeakMap();
  const continuousTimelines=new WeakMap();
  function sampleContinuous(clip,elapsed,index,secondarySeconds=elapsed/1000) {
    if(clip.motionModel==='authored-cel-depth25-v1')return Cels.present(clip,elapsed,secondarySeconds);
    let starts=continuousTimelines.get(clip);
    if(!starts){let time=0;starts=clip.frames.map(frame=>{const start=time;time+=frame.duration;return start;});starts.total=time;continuousTimelines.set(clip,starts);}
    let time=Math.max(0,Math.min(elapsed,starts.total));
    if(clip.loop && elapsed>=starts.total){const [begin,end]=clip.loop,prefix=starts[begin],finish=end===clip.frames.length?starts.total:starts[end];time=prefix+(elapsed-starts.total)%(finish-prefix);}
    const current=clip.frames[index],next=clip.frames[index+1]||
      (clip.motionModel==='canonical-painted-depth25-v5' && clip.loop ? clip.frames[clip.loop[0]] : null);
    if(!next)return current;
    const fraction=Math.max(0,Math.min(1,(time-starts[index])/current.duration));
    const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const mix=(a,b)=>a+(b-a)*fraction;
    const interpolate=(a,b)=>typeof a==='number' && typeof b==='number'?mix(a,b):
      Array.isArray(a) && Array.isArray(b)?a.map((value,i)=>interpolate(value,b[i])):
      a && b && typeof a==='object' && typeof b==='object'?Object.fromEntries(Object.entries(a).map(([key,value])=>[key,interpolate(value,b[key])])):a;
    if(clip.motionModel==='canonical-painted-depth25-v5' && !current.layers.some(layer=>layer.motion)) {
      return {...current,layers:current.layers.map((layer,i)=>{
        const following=next.layers[i];
        if(!following || layer.asset!==following.asset || !equal(layer.source,following.source))return layer;
        const result={...layer};
        for(const key of ['matrix','skeleton','volume','opacity','blink'])
          if(layer[key]!==undefined && following[key]!==undefined)result[key]=interpolate(layer[key],following[key]);
        return result;
      })};
    }
    return {...current,layers:current.layers.map((layer,i)=>{
      const following=next.layers[i],a=layer.motion,b=following?.motion;
      if(following && !a && !b && clip.motionModel==='canonical-painted-depth25-v5' && layer.asset===following.asset && equal(layer.source,following.source)){
        const result={...layer};for(const key of ['matrix','skeleton','volume','opacity','blink'])
          if(layer[key]!==undefined && following[key]!==undefined)result[key]=interpolate(layer[key],following[key]);
        return result;
      }
      if(!following || layer.asset!==following.asset || !a || !b || a.asset!==b.asset ||
        !equal(a.first,b.first) || !equal(a.second,b.second) || a.flowFirst?.[1]!==b.flowFirst?.[1])return layer;
      const motion={...a,time:mix(a.time,b.time),anchorMix:mix(a.anchorMix,b.anchorMix)};
      if(a.flowFirst && b.flowFirst){
        const width=a.flowFirst[2],position=mix(a.flowFirst[0]/width+a.anchorMix,b.flowFirst[0]/width+b.anchorMix);
        const left=Math.floor(position);motion.flowFirst=[left*width,...a.flowFirst.slice(1)];
        motion.flowSecond=[(left+1)*width,...a.flowSecond.slice(1)];motion.anchorMix=position-left;
      }
      const result={...layer,motion,opacity:mix(layer.opacity??1,following.opacity??1)};
      if(layer.footCut!==undefined && following.footCut!==undefined)result.footCut=mix(layer.footCut,following.footCut);
      if(layer.volume && following.volume)result.volume=Object.fromEntries(Object.keys(layer.volume).map(key=>[key,mix(layer.volume[key],following.volume[key])]));
      if(layer.guestOpacity!==undefined)result.guestOpacity=mix(layer.guestOpacity,following.guestOpacity??1);
      return result;
    })};
  }
  function frameForDisplay(clip,elapsed,frameAt) {
    if(!displayOffsets.has(clip))displayOffsets.set(clip,clip.frames.reduce((n,f)=>Math.min(n,f.duration),Infinity)/2);
    // Floor sampling at a refresh boundary can turn tiny callback jitter into
    // a repeated frame followed by a skipped one. Select the nearest sample.
    return frameAt(clip,elapsed+displayOffsets.get(clip));
  }

  function createLayout(env) {
    const button=env.document.querySelector(SELECTOR);
    const sprite=button?.querySelector('[data-codex-pet-state]');
    const measure=env.document.querySelector(MEASURE);
    const host=button?.closest('.group.absolute');
    if (!button || !sprite || !measure || !host) throw Error('Native layout structure does not match');
    const css=env.getComputedStyle(sprite);
    const width=parseFloat(css.width),height=parseFloat(css.height);
    const original=[];
    const originalTranslate={value:host.style.getPropertyValue('translate'),priority:host.style.getPropertyPriority('translate')};
    for (const [element,keys] of [[button,['width','justify-content']],
      [sprite,['width','height','flex-shrink']],
      [measure,['--codex-pet-width','width','height']]]) {
      for (const key of keys) original.push({element,key,value:element.style.getPropertyValue(key),
        priority:element.style.getPropertyPriority(key)});
    }
    let multiplier=1,requestedAt=0,shiftX=0,shiftY=0,movement=null,pendingMove=null,singleAnchor=null;
    function translate() {
      const value=`${shiftX}px ${shiftY}px`;
      if(host.style.getPropertyValue('translate')!==value)host.style.setProperty('translate',value);
    }
    function restoreDimensions() {
      original.forEach(({element,key,value,priority})=>{
        if(value)element.style.setProperty(key,value,priority);else element.style.removeProperty(key);
      });
    }
    function restore() {
      restoreDimensions();
      if(originalTranslate.value)host.style.setProperty('translate',originalTranslate.value,originalTranslate.priority);
      else host.style.removeProperty('translate');
      multiplier=1;requestedAt=env.performance.now();shiftX=0;shiftY=0;movement=null;pendingMove=null;singleAnchor=null;
    }
    return {width,height,restore,
      request(next,{immediate=false}={}) {
        if (![1,2].includes(next)) throw Error('Only single or duo layouts are supported');
        if(immediate && next===1){restore();return;}
        if(next===multiplier)return;
        const before=host.getBoundingClientRect();
        pendingMove={left:before.left,top:before.top};
        if(next===2)singleAnchor={left:before.left,top:before.top};
        requestedAt=env.performance.now();
        multiplier=next;
        movement=null;
        if(next===1){restoreDimensions();return;}
        measure.style.setProperty('--codex-pet-width',`${width*next}px`);
        measure.style.setProperty('width',`${width*next}px`);
        measure.style.setProperty('height',`${height}px`);
        button.style.setProperty('width',`${width*next}px`);
        button.style.setProperty('justify-content','flex-start');
        sprite.style.setProperty('width',`${width}px`);sprite.style.setProperty('height',`${height}px`);
        sprite.style.setProperty('flex-shrink','0');
      },
      ready() {
        const rect=host.getBoundingClientRect();
        const ready=Math.abs(rect.width-width*multiplier)<=2 && Math.abs(rect.height-height)<=2;
        if(!ready && env.performance.now()-requestedAt>1000) throw Error('Native host did not acknowledge duo width');
        if(Number.isFinite(env.innerWidth) && Number.isFinite(env.innerHeight)) {
          const baseLeft=rect.left-shiftX,baseTop=rect.top-shiftY;
          const clampLeft=left=>Math.max(0,Math.min(left,env.innerWidth-Math.max(width*multiplier,rect.width)));
          const clampTop=top=>Math.max(0,Math.min(top,env.innerHeight-Math.max(height,rect.height)));
          if(pendingMove) {
            // The native host recenters its left coordinate when width changes.
            // Cancel that movement before painting, then animate physical position.
            shiftX=pendingMove.left-baseLeft;shiftY=pendingMove.top-baseTop;translate();
            if(!ready)return false;
            movement={fromX:pendingMove.left,fromY:pendingMove.top,
              x:multiplier===2?clampLeft(pendingMove.left):(singleAnchor?.left ?? baseLeft),
              y:multiplier===2?clampTop(pendingMove.top):(singleAnchor?.top ?? baseTop),
              started:env.performance.now(),baseLeft,baseTop};
            pendingMove=null;
          } else if(!movement || (env.performance.now()-movement.started>=LAYOUT_MOVE_MS &&
              (Math.abs(baseLeft-movement.baseLeft)>.5 || Math.abs(baseTop-movement.baseTop)>.5))) {
            singleAnchor=null;
            movement={fromX:rect.left,fromY:rect.top,x:multiplier===2?clampLeft(baseLeft):baseLeft,
              y:multiplier===2?clampTop(baseTop):baseTop,started:env.performance.now(),baseLeft,baseTop};
          }
          const fraction=Math.min(1,(env.performance.now()-movement.started)/LAYOUT_MOVE_MS);
          const eased=fraction*fraction*(3-2*fraction);
          const left=movement.fromX+(movement.x-movement.fromX)*eased;
          const top=movement.fromY+(movement.y-movement.fromY)*eased;
          shiftX=left-baseLeft;shiftY=top-baseTop;movement.baseLeft=baseLeft;movement.baseTop=baseTop;translate();
          if(Math.abs(left-movement.x)>.01 || Math.abs(top-movement.y)>.01)return false;
          if(multiplier===1 && Math.abs(shiftX)<.01 && Math.abs(shiftY)<.01) {
            if(originalTranslate.value)host.style.setProperty('translate',originalTranslate.value,originalTranslate.priority);
            else host.style.removeProperty('translate');
          }
        }
        return ready;
      },
      bounds() {const r=button.getBoundingClientRect();return {left:r.left,top:r.top,width,height,
        right:r.left+width,bottom:r.top+height};},
      status() {const r=host.getBoundingClientRect();return {requestedWidth:width*multiplier,
        requestedHeight:height,hostWidth:r.width,hostHeight:r.height,left:r.left,top:r.top};},
    };
  }

  async function install(config, env = globalThis) {
    const doc = env.document;
    const button = doc.querySelector(SELECTOR);
    const sprite = button?.querySelector('[data-codex-pet-state]');
    const measure = doc.querySelector(MEASURE);
    if (!env.electronBridge || !button || !sprite || !measure) throw Error('Native client structure does not match');
    if (sprite.dataset.codexPetId !== config.petId) throw Error('Native pet ID does not match');
    env.__ceciliaPlayerStopReason = null;
    const assets = new Map();
    const decoding = new Map();
    const nativeIds=new Set(Object.values(config.outfits).map(outfit=>outfit.nativeAtlas));
    const textureRuns=new WeakMap();
    let nativeSource=null;
    const resident=config.artwork?.residentAssets||[];
    let pinnedAssets=new Set(resident),decodedBytes=0,disposed=false,compositor=null;
    function layerAssets(layer){return [layer.asset,layer.motion?.asset,layer.face?.asset].filter(Boolean);}
    let rasterDecodeScale=Math.min(1,parseFloat(env.getComputedStyle(sprite).width)*(env.devicePixelRatio||1)/
      (config.artwork?.highResolutionSingle?.[0]||576));
    const maxDecodedBytes=config.artwork?.maxDecodedBytes ?? Infinity;
    function sourceScale(id) {
      return !nativeIds.has(id) && config.assetMetadata?.[id]?.height>=624 &&
        config.assetMetadata?.[id]?.kind!=='flow' &&
        typeof env.createImageBitmap==='function' ? rasterDecodeScale : 1;
    }
    function assetBytes(id,image=assets.get(id)) {
      const width=image?.naturalWidth||image?.width,height=image?.naturalHeight||image?.height;
      if(width && height)return width*height*4;
      return (config.assetMetadata?.[id]?.decodedBytes||0)*sourceScale(id)**2;
    }
    function releaseImage(image) {
      compositor?.release?.(image);
      if(typeof image.close==='function')image.close();
      else image.src='';
    }
    function evictAssets() {
      while(assets.size>(config.artwork?.maxDecodedAssets ?? 5) || decodedBytes>maxDecodedBytes) {
        const id=[...assets.keys()].find(key=>!pinnedAssets.has(key) && key!==nativeSource?.id);
        if(!id)break;
        const image=assets.get(id);decodedBytes-=assetBytes(id,image);
        releaseImage(image);assets.delete(id);
      }
    }
    async function prepare(ids) {
      await Promise.all([...new Set(ids)].map(id => {
        if (assets.has(id))return compositor?.gpu && !nativeIds.has(id) ? compositor.prepareTexture(assets.get(id),config.assetMetadata?.[id]?.kind!=='flow') : undefined;
        if (decoding.has(id)) return decoding.get(id);
        const source=config.assets[id];
        const embedded=/^data:image\/(png|webp);base64,/.test(source||'');
        const local=source==='local-png:'+id && typeof env.__ceciliaRequestAsset==='function';
        if (!embedded && !local) throw Error(`Missing local PNG ${id}`);
        const image=new env.Image();let decoded;
        if(embedded){image.src=source;decoded=image.decode();}
        else decoded=env.__ceciliaRequestAsset(id).then(value=>{
          const data=/^data:image\/(png|webp);base64,/.test(value||'');
          const http=env.__ceciliaAssetBaseURL && value===env.__ceciliaAssetBaseURL+id;
          if(!data && !http)throw Error(`Invalid local PNG ${id}`);
          if(http && /^https?:/.test(value))image.crossOrigin='anonymous';
          image.src=value;return image.decode();
        });
        const pending=decoded.then(async()=>{
          let texture=image;
          if(!nativeIds.has(id) && typeof env.createImageBitmap==='function') {
            const flow=config.assetMetadata?.[id]?.kind==='flow';
            const options=flow ? {premultiplyAlpha:'none',colorSpaceConversion:'none'} :
              {premultiplyAlpha:'premultiply',resizeWidth:Math.round(image.naturalWidth*sourceScale(id)),
               resizeHeight:Math.round(image.naturalHeight*sourceScale(id)),resizeQuality:'high'};
            texture=await env.createImageBitmap(image,options);
            image.src='';
          }
          if(disposed){releaseImage(texture);decoding.delete(id);return;}
          if(compositor?.gpu && !nativeIds.has(id))await compositor.prepareTexture(texture,config.assetMetadata?.[id]?.kind!=='flow');
          if(disposed){releaseImage(texture);decoding.delete(id);return;}
          assets.set(id,texture);decodedBytes+=assetBytes(id,texture);decoding.delete(id);
          if(nativeIds.has(id))nativeSource={id,source:image.src};
          evictAssets();
        }).catch(error=>{decoding.delete(id);throw error;});
        decoding.set(id,pending);return pending;
      }));
    }
    const {Scheduler, frameAt} = env.CeciliaAnimation;
    const scheduler = new Scheduler({...config.schedule, outfits: Object.keys(config.outfits), saved: config.saved});
    function clipFor(frame) {
      const outfit=config.outfits[frame.outfit];
      return frame.clip==='dance' ? outfit.dances?.[frame.danceId] : outfit.clips[frame.clip];
    }
    function upcomingAssets(clip,index) {
      let compiled=textureRuns.get(clip);
      if(!compiled || compiled.frames!==clip.frames) {
        const runs=[],runAt=new Uint32Array(clip.frames.length),ends=new Float64Array(clip.frames.length);
        let elapsed=0;
        clip.frames.forEach((frame,i)=>{
          const ids=[...new Set(frame.layers.flatMap(layerAssets))].sort(),signature=ids.join('|');
          if(!runs.length || runs.at(-1).signature!==signature || clip.loop?.includes(i))
            runs.push({start:i,end:i+1,ids,signature});
          else runs.at(-1).end=i+1;
          runAt[i]=runs.length-1;elapsed+=frame.duration;ends[i]=elapsed;
        });
        compiled={frames:clip.frames,runs,runAt,ends};textureRuns.set(clip,compiled);
      }
      const {runs,runAt,ends}=compiled,ids=new Set();let ahead=0,current=index,visited=0;
      // Process texture changes rather than allocating sets for every 120Hz
      // pose. All intervening frames are covered, including a loop's prefix.
      while(visited<clip.frames.length && ahead<=(config.artwork?.preloadMs ?? 300)) {
        const run=runs[runAt[current]],nextIds=new Set([...ids,...run.ids]);
        if(visited>0 && nextIds.size>(config.artwork?.maxDecodedAssets ?? 5))break;
        const nativeBytes=nativeSource ? assetBytes(nativeSource.id) : 0;
        if(visited>0 && [...nextIds].reduce((sum,id)=>sum+assetBytes(id),nativeBytes)>maxDecodedBytes)break;
        run.ids.forEach(id=>ids.add(id));
        ahead+=(ends[run.end-1]-(current ? ends[current-1] : 0))/(clip.playbackRate || 1);
        visited+=run.end-current;current=run.end;
        if(current===(clip.loop?.[1] ?? clip.frames.length)) {
          if(!clip.loop)break;
          current=clip.loop[0];
        }
      }
      return [...ids];
    }
    const initial=scheduler.tick(0,{task:sprite.dataset.codexPetState});
    const initialClip=clipFor(initial);
    if (!initialClip) throw Error('Initial animation is missing');
    await prepare([config.outfits[initial.outfit].nativeAtlas,...resident,...initialClip.frames[0].layers.flatMap(layerAssets)]);
    env.__ceciliaPlayer?.stop();
    const original = [];
    function remember(element, keys) {
      for (const key of keys) original.push({element, key,
        value: element.style.getPropertyValue(key), priority: element.style.getPropertyPriority(key)});
    }
    remember(sprite, ['visibility','background-image']);
    const layout=createLayout(env);
    const baseWidth=layout.width,baseHeight=layout.height;
    if (!(baseWidth > 0 && baseHeight > 0)) throw Error('Native pet has no display size');
    const canvas = doc.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true'); canvas.setAttribute('data-cecilia-extension', 'true');
    for (const [key,value] of Object.entries({position:'absolute',left:'0',top:'0',
      'pointer-events':'none','z-index':'20'})) canvas.style.setProperty(key,value);
    button.append(canvas);
    let ctx;
    try {ctx=config.artwork?.renderMode==='gpu-pose-flow-v1' ? env.CeciliaGPU.create(canvas) : canvas.getContext('2d');}
    catch(error){canvas.remove();throw error;}
    compositor=ctx;
    if (!ctx) {canvas.remove(); throw Error('Canvas compositor unavailable');}
    // Installation keeps the native pet visible until the first GPU textures
    // have completed their asynchronous upload as well as their decode.
    try {await prepare([...resident,...initialClip.frames[0].layers.flatMap(layerAssets)]);}
    catch(error) {
      disposed=true;for(const image of assets.values())releaseImage(image);
      ctx.stop?.();canvas.remove();original.forEach(restore);layout.restore();throw error;
    }
    let heartbeat = env.performance.now(), previousTime = heartbeat;
    let stopped = false, visible = true, nearby = false, gaze = 0, held = false, clickUntil = 0;
    let requestId, widthMultiplier = 1, lastFrame = null;
    let waitingForAssets = false, presentationPending=false;
    const NATIVE_BACKGROUND_CHECK_MS=250;
    let nativeBackground=null,nativeBackgroundState=null,lastNativeBackgroundCheck=-Infinity;
    let report = {stopped:false, mode:'loading', renderFrames:0, slowFrames:0,
      callbackFrames:0,duplicateCallbacks:0,skippedSamples:0,drawMsMax:0,gpuMotion:Boolean(ctx.gpu),
      frameBudgetMs:TARGET_FRAME_MS,overBudgetFrames:0,callbackIntervalMsMax:0,
      decodedBytes:0,assetWaitMs:0,layoutWaitMs:0};
    let previousClip=null,previousIndex=-1,lastPresentation=null;
    let interactionElapsed=0,visibleElapsed=0;

    function drawAuthored(authored,multiplier,clip,index) {
      const width=canvas.width,height=canvas.height,drawStart=env.performance.now();
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);
      ctx.setTransform(width/(LOGICAL_WIDTH*multiplier),0,0,height/LOGICAL_HEIGHT,0,0);
      for(const layer of authored.layers) {
        const image=assets.get(layer.asset);if(!image)throw Error(`Missing PNG ${layer.asset}`);
        assets.delete(layer.asset);assets.set(layer.asset,image);
        ctx.globalAlpha=layer.opacity ?? 1;
        const metadata=config.assetMetadata?.[layer.asset];
        const scaleX=metadata && image.width ? image.width/metadata.width : 1;
        const scaleY=metadata && image.height ? image.height/metadata.height : 1;
        const source=layer.source.map((value,i)=>value*(i%2 ? scaleY : scaleX));
        if(ctx.gpu){
          const beat=(visibleElapsed%4300)/180,blink=beat<1?Math.sin(beat*Math.PI)**2:0;
          ctx.drawLayer(image,layer.face?{...layer,blink:Math.max(layer.blink||0,blink)}:layer,id=>assets.get(id),config.assetMetadata);
        }
        else ctx.drawImage(image,...source,...layer.target);
      }
      ctx.globalAlpha=1;lastFrame=authored;report.renderFrames++;
      report.drawMsMax=Math.max(report.drawMsMax,env.performance.now()-drawStart);
      if(previousClip===clip && index>previousIndex+1)report.skippedSamples+=index-previousIndex-1;
      previousClip=clip;previousIndex=index;
      evictAssets();report.decodedAssets=assets.size;report.decodedBytes=decodedBytes;
    }
    function animatePrevious(elapsed) {
      if(!lastPresentation || !lastFrame)return;
      const p=lastPresentation;p.elapsed+=elapsed*(p.clip.playbackRate || 1);
      if(!p.clip.loop && p.elapsed>=p.total) {
        p.clip=config.outfits[p.outfit].clips.idle;p.elapsed=0;
      }
      const index=config.artwork?.continuousSampling?frameAt(p.clip,p.elapsed):frameForDisplay(p.clip,p.elapsed,frameAt);
      const authored=config.artwork?.continuousSampling?sampleContinuous(p.clip,p.elapsed,index,visibleElapsed/1000):p.clip.frames[index];
      const ids=authored.layers.flatMap(layerAssets);
      if(ids.some(id=>!assets.has(id) || (ctx.gpu && !ctx.textureReady(assets.get(id)))))return;
      if(lastFrame!==authored) {
        drawAuthored(authored,p.multiplier,p.clip,index);
        report.transitionRenderFrames=(report.transitionRenderFrames || 0)+1;
      }
    }

    function bounds() {
      return layout.bounds();
    }
    function size(multiplier,immediate=false) {
      if (widthMultiplier === multiplier && !immediate) return;
      widthMultiplier=multiplier;layout.request(multiplier,{immediate});
    }
    function restore(item) {
      if(item.key==='background-image' && sprite.dataset.codexPetId!==config.petId)return;
      if (item.value) item.element.style.setProperty(item.key,item.value,item.priority);
      else item.element.style.removeProperty(item.key);
    }
    function keepNativeOutfit(frame) {
      const atlas=frame && config.outfits[frame.outfit].nativeAtlas;
      if(atlas) {
        const now=env.performance.now();
        const state=`${sprite.dataset.codexPetState}:${frame.mode}`;
        // Serializing a multi-megabyte CSS URL every frame triggers GC stalls.
        // Host state changes sync immediately; background-only rewrites get a
        // bounded check while ordinary animation reuses the installed URL.
        if(nativeBackground?.id===atlas && nativeBackgroundState===state &&
           now-lastNativeBackgroundCheck<NATIVE_BACKGROUND_CHECK_MS)return;
        const source=config.assets[atlas]?.startsWith('data:')?config.assets[atlas]:(assets.get(atlas)?.src || (nativeSource?.id===atlas?nativeSource.source:null));
        if(!source){prepare([atlas]).then(()=>{if(!stopped)keepNativeOutfit(frame);}).catch(error=>stop(error.message));return;}
        if(nativeBackground?.id!==atlas || nativeBackground.source!==source)
          nativeBackground={id:atlas,source,value:`url("${source}")`};
        const background=nativeBackground.value;
        // React rewrites this style when the native walking state changes.
        // The outfit ID alone cannot tell whether our actual image survived.
        if(sprite.style.getPropertyValue('background-image')!==background)sprite.style.setProperty('background-image',background);
        nativeBackgroundState=state;lastNativeBackgroundCheck=now;
      }
    }
    function native(frame) {
      canvas.style.setProperty('display','none');
      original.filter(item => item.element === sprite && item.key === 'visibility').forEach(restore);
      keepNativeOutfit(frame);
      size(1,true);
    }
    function stop(reason = 'stopped') {
      if (stopped) return;
      disposed=true;
      env.__ceciliaPlayerStopReason = reason;
      stopped = true; report = {...report, stopped:true, reason};
      env.cancelAnimationFrame(requestId); env.clearInterval(timer);
      observer.disconnect();hostObserver.disconnect();
      for (const [name,handler] of listeners) env.removeEventListener(name,handler,true);
      canvas.remove(); original.forEach(restore);layout.restore();
      for(const image of assets.values())releaseImage(image);
      ctx.stop?.();
      assets.clear();nativeSource=null;
      if (env.__ceciliaPlayer === player) delete env.__ceciliaPlayer;
    }
    function pointer(event) {
      if (!event.target?.closest?.(SELECTOR)) return;
      held = true; clickUntil = env.performance.now()+300; render(0);
    }
    function release() {held = false; clickUntil = env.performance.now()+300;}
    function message(event) {
      if (event.data?.type !== 'avatar-overlay-computer-use-cursor-changed') return;
      // Cursor messages may still be emitted by the host. They no longer
      // pause authored animation or change this character's facing direction.
      nearby = false;
    }
    function render(elapsed) {
      if (stopped) return;
      try {
        const nextScale=Math.min(1,baseWidth*(env.devicePixelRatio||1)/
          (config.artwork?.highResolutionSingle?.[0]||576));
        if(Math.abs(nextScale-rasterDecodeScale)>.0001) {
          for(const [id,image] of assets)if(!nativeIds.has(id)) {
            decodedBytes-=assetBytes(id,image);releaseImage(image);assets.delete(id);
          }
          rasterDecodeScale=nextScale;lastFrame=null;
        }
        if (!button.isConnected || sprite.dataset.codexPetId !== config.petId) throw Error('Native client structure changed');
        const frame = scheduler.tick(presentationPending ? 0 : elapsed, {visible:visible && doc.visibilityState !== 'hidden',
          task:sprite.dataset.codexPetState, nearby,
            interaction:held || env.performance.now() < clickUntil});
        if(frame.mode!=='hidden')visibleElapsed+=elapsed;
        if(frame.mode==='native' && config.artwork?.gpuNativeInteractions){
          interactionElapsed+=elapsed;frame.mode='interaction';frame.clip=held?'running':(config.outfits[frame.outfit].clips.shy?'shy':'idle');
          frame.elapsed=interactionElapsed;frame.duo=false;
        }else interactionElapsed=0;
        report = {...report, ...frame, ready:false};
        if(config.assets[config.outfits[frame.outfit].nativeAtlas]?.startsWith('local-png:'))keepNativeOutfit(frame);
        if (frame.mode === 'native' || frame.mode === 'hidden') {presentationPending=false;native(frame); return;}
        const clip = clipFor(frame);
        if (!clip) throw Error(`Missing ${frame.outfit}/${frame.clip}/${frame.danceId || ''}`);
        const playbackRate=clip.playbackRate || 1;
        const index = frame.mode === 'gaze' ? gaze : config.artwork?.continuousSampling?frameAt(clip,frame.elapsed*playbackRate):frameForDisplay(clip,frame.elapsed*playbackRate,frameAt);
        report.playbackRate=playbackRate;
        report.frameIndex=index;
        report.lookDirection=frame.mode==='gaze' ? gaze : null;
        report.danceId=frame.clip==='dance' ? frame.danceId : null;
        const authored = config.artwork?.continuousSampling && frame.mode!=='gaze'?sampleContinuous(clip,frame.elapsed*playbackRate,index,visibleElapsed/1000):clip.frames[index];
        if (!authored?.layers?.length) throw Error('Empty animation frame');
        const upcoming=upcomingAssets(clip,index);
        if(frame.duo) {
          for(const id of upcomingAssets(config.outfits[frame.outfit].clips.idle,0)) {
            if(!upcoming.includes(id) && upcoming.length<(config.artwork?.maxDecodedAssets ?? 5)) {
              const nativeBytes=nativeSource ? assetBytes(nativeSource.id) : 0;
              if([...upcoming,id].reduce((sum,key)=>sum+assetBytes(key),nativeBytes)<=maxDecodedBytes)upcoming.push(id);
            }
          }
        }
        // Future textures are prepared in the background. Only an unavailable
        // current pose may suspend visible time.
        if(frame.mode==='daily') {
          for(const next of scheduler.preloadViews(config.artwork?.preloadMs ?? 300)) {
            const nextClip=clipFor(next),budget=config.artwork?.maxDecodedAssets ?? 5;
            if(nextClip)for(const id of upcomingAssets(nextClip,0)) {
              if(!upcoming.includes(id)) {
                if(upcoming.length>=budget)break;
                const nativeBytes=nativeSource ? assetBytes(nativeSource.id) : 0;
                if([...upcoming,id].reduce((sum,key)=>sum+assetBytes(key),nativeBytes)>maxDecodedBytes)break;
                upcoming.push(id);
              }
            }
          }
        }
        pinnedAssets=new Set([...resident,...upcoming,...authored.layers.flatMap(layerAssets)]);
        if(lastPresentation && lastPresentation.clip!==clip) {
          const oldIndex=frameForDisplay(lastPresentation.clip,lastPresentation.elapsed,frameAt);
          upcomingAssets(lastPresentation.clip,oldIndex).forEach(id=>pinnedAssets.add(id));
        }
        prepare(upcoming).catch(error=>stop(error.message));
        const missing=authored.layers.flatMap(layerAssets).filter(id=>!assets.has(id) || (ctx.gpu && !ctx.textureReady(assets.get(id))));
        if (missing.length) {
          report.assetWaitMs+=elapsed;
          presentationPending=true;
          report.loadingAssets=missing.length;
          if (!waitingForAssets) {
            waitingForAssets=true;
            prepare(missing).then(()=>{
              waitingForAssets=false;
              if(!stopped){lastFrame=null;render(0);}
            }).catch(error=>stop(error.message));
          }
          if (!lastFrame) native(frame);
          else animatePrevious(elapsed);
          return;
        }
        report.loadingAssets=0;
        const multiplier = frame.duo ? 2 : 1;
        size(multiplier);
        if (!layout.ready()) {
          report.layoutWaitMs+=elapsed;
          presentationPending=true;
          if(lastFrame) {
            keepNativeOutfit(frame);
            // Keep the preceding owner visible while the host moves. On exit,
            // hide the companion half before the old wide canvas reaches an edge.
            canvas.style.setProperty('clip-path',multiplier===1 && canvas.width>baseWidth*(env.devicePixelRatio||1) ? 'inset(0 50% 0 0)' : 'none');
            animatePrevious(elapsed);
            return;
          }
          canvas.style.setProperty('display','none');
          keepNativeOutfit(frame);
          original.filter(item=>item.key==='visibility').forEach(restore);
          return;
        }
        const ratio = env.devicePixelRatio || 1;
        const width = Math.round(baseWidth*multiplier*ratio), height = Math.round(baseHeight*ratio);
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width; canvas.height = height;
          ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
          canvas.style.setProperty('width',`${baseWidth*multiplier}px`);
          canvas.style.setProperty('height',`${baseHeight}px`);
          lastFrame = null;
        }
        if (lastFrame !== authored) {
          drawAuthored(authored,multiplier,clip,index);
        } else report.duplicateCallbacks++;
        lastPresentation={clip,elapsed:frame.elapsed*playbackRate,multiplier,outfit:frame.outfit,
          total:textureRuns.get(clip).ends.at(-1)};
        report.ready=true;
        presentationPending=false;
        canvas.style.setProperty('clip-path','none');
        canvas.style.setProperty('display','block');sprite.style.setProperty('visibility','hidden');
      } catch (error) {stop(error.message);}
    }
    function tick(time) {
      if (stopped) return;
      const elapsed = Math.max(0,time-previousTime);previousTime=time;
      report.callbackFrames++;
      report.callbackIntervalMsMax=Math.max(report.callbackIntervalMsMax,elapsed);
      if(elapsed>TARGET_FRAME_MS)report.overBudgetFrames++;
      if (elapsed > 50) report.slowFrames++;
      // A delayed/background rAF never creates a catch-up burst after reveal.
      render(elapsed > 1000 ? 0 : elapsed);
      if (!stopped) requestId = env.requestAnimationFrame(tick);
    }
    const listeners = [['pointerdown',pointer],['pointerup',release],['pointercancel',release],['message',message]];
    listeners.forEach(([name,handler]) => env.addEventListener(name,handler,true));
    const observer = new env.MutationObserver(() => render(0));
    observer.observe(sprite,{attributes:true,attributeFilter:['data-codex-pet-state','data-codex-pet-id']});
    const host=button.closest('.group.absolute');
    const hostSignature=()=>['left','top','width','height','transform'].map(key=>host.style.getPropertyValue(key)).join('|');
    let previousHostSignature=hostSignature();
    const hostObserver=new env.MutationObserver(()=>{
      const signature=hostSignature();
      if(signature!==previousHostSignature){previousHostSignature=signature;render(0);}
    });
    hostObserver.observe(host,{attributes:true,attributeFilter:['style']});
    const timer = env.setInterval(() => {
      if (env.performance.now()-heartbeat > HEARTBEAT_MS) stop('helper heartbeat lost');
    },250);
    const player = {stop, bounds,
      isLiveScheduler(candidate) {return candidate===scheduler;},
      pulse(isVisible = true) {
        heartbeat=env.performance.now();
        if(visible!==isVisible) {
          visible=isVisible;previousTime=heartbeat;render(0);
        }
      },
      status() {return {...report,drawCalls:report.renderFrames,presentedFrames:null,
        drawTimingKind:'cpu-submission',cpuSubmissionMsMax:report.drawMsMax,
        measurementWidth:baseWidth*widthMultiplier,layout:layout.status()};},
      restore(saved) {
        if (!scheduler.validSaved(saved)) throw Error('Invalid playback checkpoint');
        scheduler.state=JSON.parse(JSON.stringify(saved));
        previousTime=env.performance.now();lastFrame=null;render(0);
      },
      snapshot() {return scheduler.snapshot();}};
    env.__ceciliaPlayer = player;
    requestId = env.requestAnimationFrame(tick);
    return player;
  }
  return {install,createLayout,frameForDisplay,sampleContinuous};
});
