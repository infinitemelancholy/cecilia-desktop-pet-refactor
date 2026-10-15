const images=new Map(),decoding=new Map();
const outfit=document.querySelector('#outfit'),action=document.querySelector('#action');
const canvas=document.querySelector('#canvas'),ctx=canvas.getContext('2d'),status=document.querySelector('#status');
let start=performance.now(),paused=false,pausedElapsed=0,last=-1,current=null,epoch=0;
for(const [id,name] of Object.entries(labels))outfit.add(new Option(name,id));
for(const [id,name] of Object.entries(clipLabels))action.add(new Option(name,id));
action.value='hop';
function nearbyAssets(clip,index){
  const ids=new Set();let ahead=0,next=index;
  const lead=manifest.artwork?.preloadMs??300;
  for(let n=0;n<clip.frames.length&&ahead<=lead;n++){
    clip.frames[next].layers.forEach(l=>ids.add(l.asset));ahead+=clip.frames[next].duration/(clip.playbackRate||1);next++;
    if(next===(clip.loop?.[1]??clip.frames.length)){if(!clip.loop)break;next=clip.loop[0];}
  }
  return [...ids];
}
async function prepare(data,ids,request){
  await Promise.all(ids.map(id=>{
    const key=data.version+':'+id;
    if(images.has(key))return;
    if(decoding.has(key))return decoding.get(key);
    const image=new Image();image.src=data.prefix+data.source.assets[id]+'?revision='+data.version;
    const pending=image.decode().then(()=>{
      if(request===epoch)images.set(key,image);else image.src='';
    }).finally(()=>decoding.delete(key));
    decoding.set(key,pending);return pending;
  }));
}
function trim(data,ids){
  const keep=new Set(ids.map(id=>data.version+':'+id));
  while(images.size>(manifest.artwork?.maxDecodedAssets??5)){
    const oldest=[...images.keys()].find(key=>!keep.has(key));if(!oldest)break;
    images.get(oldest).src='';images.delete(oldest);
  }
}
async function change(){
  const request=++epoch;current=null;last=-1;pausedElapsed=0;
  const source=manifest,data=source.outfits[outfit.value];
  const clip=data.dances[action.value]||data.clips[action.value];
  const next={clip,source,version:'cadence7',prefix:source.assetPrefix||'',
    width:action.value.startsWith('lawrence-')||action.value.startsWith('hazelita-')?384:192};
  status.textContent='正在加载';
  try{
    const ids=nearbyAssets(clip,0);await prepare(next,ids,request);
    if(request!==epoch)return;
    trim(next,ids);current=next;start=performance.now();
    const seconds=clip.frames.reduce((sum,f)=>sum+f.duration,0)/(1000*(clip.playbackRate||1));
    status.textContent='连贯动作 · 本轮 '+seconds.toFixed(1)+' 秒';
  }catch(error){if(request===epoch)status.textContent='资源无法读取：'+error.message;}
}
function frameAt(clip,time){
  time+=clip.frames[0].duration*.5;
  const total=clip.frames.reduce((sum,f)=>sum+f.duration,0);
  if(time>=total){if(clip.loop)time%=total;else return clip.frames.length-1;}
  for(let i=0;i<clip.frames.length;i++){if(time<clip.frames[i].duration)return i;time-=clip.frames[i].duration;}
  return clip.frames.length-1;
}
function draw(now){
  if(current){
    const request=epoch,data=current,t=paused?pausedElapsed:now-start,idx=frameAt(data.clip,t*(data.clip.playbackRate||1)),frame=data.clip.frames[idx];
    const ids=nearbyAssets(data.clip,idx);
    prepare(data,ids,request).then(()=>{if(request===epoch)trim(data,ids)}).catch(error=>{
      if(request===epoch)status.textContent='资源无法读取：'+error.message;
    });
    const ratio=typeof devicePixelRatio==='number'?devicePixelRatio:1;
    const width=Math.round(data.width/192*224*ratio),height=Math.round(208/192*224*ratio);
    if(canvas.width!==width||canvas.height!==height){
      canvas.width=width;canvas.height=height;last=-1;
      canvas.style.width=data.width/192*224+'px';canvas.style.height=208/192*224+'px';
    }
    if(idx!==last&&frame.layers.every(l=>images.has(data.version+':'+l.asset))){
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);
      ctx.setTransform(width/data.width,0,0,height/208,0,0);
      for(const layer of frame.layers){ctx.globalAlpha=layer.opacity??1;ctx.drawImage(images.get(data.version+':'+layer.asset),...layer.source,...layer.target);}
      ctx.globalAlpha=1;last=idx;
    }
  }
  requestAnimationFrame(draw);
}
outfit.onchange=change;action.onchange=change;
document.querySelector('#play').onclick=()=>{
  paused=!paused;
  if(paused)pausedElapsed=performance.now()-start;else start=performance.now()-pausedElapsed;
  document.querySelector('#play').textContent=paused?'播放':'暂停';
};
document.querySelector('#restart').onclick=()=>{start=performance.now();pausedElapsed=0;last=-1;};
let dark=false;
document.querySelector('#background').onclick=()=>{dark=!dark;document.querySelector('#stage').style.background=dark?'#202a3a':'#dde3ec';};
change();requestAnimationFrame(draw);
