/* Heartbeat and hover suppression only. No cursor coordinates are forwarded. */
(() => {
  window.__ceciliaGaze?.stop(); window.__ceciliaPresence?.stop();
  const selector='[data-testid="avatar-mascot-button"]';
  let heartbeat=performance.now(),stopped=false;
  const blockHover=event=>{if(event.target?.closest?.(selector))event.stopPropagation();};
  for(const name of ['pointerover','mouseover'])document.addEventListener(name,blockHover,true);
  document.querySelector(selector)?.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:document.body}));
  window.dispatchEvent(new MessageEvent('message',{data:{type:'avatar-overlay-computer-use-cursor-changed',point:null}}));
  function pulse(visible=true){if(stopped)return;heartbeat=performance.now();window.__ceciliaPlayer?.pulse(visible);}
  const timer=setInterval(()=>{if(performance.now()-heartbeat>5000)stop();},1000);
  function stop(){
    if(stopped)return;stopped=true;clearInterval(timer);
    for(const name of ['pointerover','mouseover'])document.removeEventListener(name,blockHover,true);
    delete window.__ceciliaPresence;
  }
  window.__ceciliaPresence={pulse,stop};
  return {installed:true,cursorEffects:false,hoverJump:false};
})()
