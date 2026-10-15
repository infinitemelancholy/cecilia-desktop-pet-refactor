/* Pure visible-time animation scheduler; shared by the renderer and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CeciliaAnimation = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const TASKS = new Set(['running', 'waiting', 'failed', 'review']);
  const DEFAULT_DANCES = ['op-turn', 'small-sway', 'tiptoe-clap'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const durationIndices=new WeakMap();

  function frameAt(clip, elapsed) {
    let index=durationIndices.get(clip);
    if(!index || index.frames!==clip.frames) {
      const ends=new Float64Array(clip.frames.length);let total=0;
      for(let i=0;i<clip.frames.length;i++){total+=clip.frames[i].duration;ends[i]=total;}
      index={frames:clip.frames,ends,total};durationIndices.set(clip,index);
    }
    const {ends,total}=index;
    let time = Math.max(0, elapsed);
    if (time >= total) {
      if (!clip.loop) return ends.length - 1;
      const [start, end] = clip.loop;
      const prefix = start ? ends[start-1] : 0;
      const period = ends[end-1]-prefix;
      time = prefix + (time - total) % period;
    }
    let left=0,right=ends.length-1;
    while(left<right){const middle=(left+right)>>1;if(time<ends[middle])right=middle;else left=middle+1;}
    return left;
  }

  class Scheduler {
    constructor(options) {
      this.options = {...options, danceIds: options.danceIds || DEFAULT_DANCES};
      this.random = options.random || Math.random;
      this.state = {
        version: 2, timingRevision:options.timingRevision ?? (options.outfitTimings ? 4 : 3), outfit: options.outfits[0], visibleMs: 0,
        nextOutfitAt: this.interval(), phase: 'dance', phaseElapsed: 0,
        danceId: null, danceBag: [], lastDance: null,
        scene: null, sceneBag: [], outfitBag: [], lastScene: null,
        lastMode: 'daily', lastTask: null, taskElapsed: 0, recoveryRemaining: 0, resume: null,
      };
      const saved=this.retimeSaved(options.saved);
      if (this.validSaved(saved)) this.state = clone(saved);
      else if (this.validLegacy(options.saved)) this.state = this.migrateLegacy(options.saved);
      if (this.state.danceId === null && this.state.phase === 'dance') this.nextDance();
    }
    timings(outfit=this.state?.outfit) {return this.options.outfitTimings?.[outfit] || {};}
    danceDuration(id=this.state?.danceId,outfit=this.state?.outfit) {
      return this.timings(outfit).danceDurationsMs?.[id] ?? this.options.danceDurationsMs?.[id] ?? this.options.danceMs;
    }
    sceneDuration(id=this.state?.scene,outfit=this.state?.outfit) {
      return this.timings(outfit).sceneDurations?.[id] ?? this.options.sceneDurations[id];
    }
    interludeDuration(scene=this.state?.scene,outfit=this.state?.outfit) {
      return Math.max(this.options.interludeMs,this.sceneDuration(scene,outfit) ?? 0);
    }
    showcaseDuration(outfit=this.state?.outfit) {
      return this.timings(outfit).showcaseMs ?? this.options.showcaseMs ?? 2400;
    }
    retimeSaved(saved) {
      const revision=this.options.timingRevision ?? (this.options.outfitTimings ? 4 : 3);
      if(saved?.version===2 && this.options.outfitTimings && saved.timingRevision===revision)return saved;
      if(saved?.version===2 && this.options.outfitTimings && saved.timingRevision>=4) {
        const previous=saved.timingLimits;
        if(!previous || ['dance','interlude','showcase'].some(phase=>!Number.isFinite(previous[phase]) || previous[phase]<=0))return null;
        const next=clone(saved),limits={dance:this.danceDuration(next.danceId,next.outfit),
          interlude:this.interludeDuration(next.scene,next.outfit),showcase:this.showcaseDuration(next.outfit)};
        const oldScene=previous.scene ?? (this.options.previousTiming?.revision===saved.timingRevision
          ? this.options.previousTiming.outfitTimings?.[next.outfit]?.sceneDurations?.[next.scene] : undefined);
        const retime=(phase,elapsed)=>{
          if(phase!=='interlude' || !Number.isFinite(oldScene) || oldScene<=0)return elapsed*limits[phase]/previous[phase];
          const newScene=this.sceneDuration(next.scene,next.outfit);
          const adjusted=elapsed<oldScene ? elapsed*newScene/oldScene : newScene+elapsed-oldScene;
          return Math.min(adjusted,limits.interlude-.001);
        };
        next.phaseElapsed=retime(next.phase,next.phaseElapsed);
        if(next.resume)next.resume.elapsed=retime(next.resume.phase,next.resume.elapsed);
        next.timingRevision=revision;next.timingLimits=limits;return next;
      }
      if(saved?.version===2 && this.options.outfitTimings && saved.timingRevision!==revision) {
        const next=clone(saved);
        const ratio=phase=>phase==='dance'
          ? this.danceDuration(next.danceId,next.outfit)/(this.options.danceDurationsMs?.[next.danceId] ?? this.options.danceMs)
          : phase==='showcase' ? this.showcaseDuration(next.outfit)/(this.options.showcaseMs||2400)
          : this.sceneDuration(next.scene,next.outfit)/this.options.sceneDurations[next.scene];
        const retime=(phase,elapsed)=>{
          if(phase!=='interlude')return elapsed*ratio(phase);
          const oldEnd=this.options.sceneDurations[next.scene],newEnd=this.sceneDuration(next.scene,next.outfit);
          const adjusted=elapsed<oldEnd ? elapsed*ratio(phase) : newEnd+elapsed-oldEnd;
          return Math.min(adjusted,this.interludeDuration(next.scene,next.outfit)-.001);
        };
        next.phaseElapsed=retime(next.phase,next.phaseElapsed);
        if(next.resume)next.resume.elapsed=retime(next.resume.phase,next.resume.elapsed);
        next.timingRevision=revision;return next;
      }
      if(!saved || saved.version!==2 || saved.timingRevision===3 || !this.options.danceDurationsMs)return saved;
      const next=clone(saved),ratio=this.danceDuration(next.danceId)/this.options.danceMs;
      if(next.phase==='dance')next.phaseElapsed*=ratio;
      if(next.resume?.phase==='dance')next.resume.elapsed*=ratio;
      next.timingRevision=3;return next;
    }
    validSaved(s) {
      if (!s || s.version !== 2 || !this.options.outfits.includes(s.outfit)) return false;
      const durations = {dance:this.danceDuration(s.danceId,s.outfit), interlude:this.interludeDuration(s.scene,s.outfit),
        showcase:this.showcaseDuration(s.outfit)};
      const finite = n => Number.isFinite(n) && n >= 0;
      const scenes = Object.keys(this.options.sceneDurations);
      const bag = (items, choices) => Array.isArray(items) && items.every(v=>choices.includes(v))
        && new Set(items).size === items.length;
      return Object.hasOwn(durations,s.phase) && finite(s.phaseElapsed)
        && s.phaseElapsed < durations[s.phase]
        && ['visibleMs','nextOutfitAt','recoveryRemaining','taskElapsed'].every(k=>finite(s[k]))
        && (s.danceId === null || this.options.danceIds.includes(s.danceId))
        && (s.lastDance === null || this.options.danceIds.includes(s.lastDance))
        && (s.phase !== 'dance' || this.options.danceIds.includes(s.danceId)
          || (s.danceId === null && s.phaseElapsed === 0))
        && bag(s.danceBag,this.options.danceIds)
        && (s.scene === null || scenes.includes(s.scene))
        && (s.phase !== 'interlude' || scenes.includes(s.scene))
        && (s.lastScene === null || scenes.includes(s.lastScene))
        && ['daily','native','gaze','task'].includes(s.lastMode)
        && (s.lastTask === null || TASKS.has(s.lastTask))
        && bag(s.sceneBag,scenes) && bag(s.outfitBag,this.options.outfits)
        && (s.phase === 'showcase' ? s.resume && ['dance','interlude'].includes(s.resume.phase)
          && finite(s.resume.elapsed) && s.resume.elapsed < durations[s.resume.phase] : s.resume === null);
    }
    validLegacy(s) {
      if (!s || s.version !== 1 || !this.options.outfits.includes(s.outfit)) return false;
      const durations = {dance:this.options.danceMs, interlude:this.options.interludeMs,
        showcase:this.options.showcaseMs || 2400};
      const finite = n => Number.isFinite(n) && n >= 0;
      const scenes = Object.keys(this.options.sceneDurations);
      const bag = (items, choices) => Array.isArray(items) && items.every(v=>choices.includes(v))
        && new Set(items).size === items.length;
      return Object.hasOwn(durations,s.phase) && finite(s.phaseElapsed)
        && s.phaseElapsed < durations[s.phase]
        && ['visibleMs','nextOutfitAt','recoveryRemaining','taskElapsed'].every(k=>finite(s[k]))
        && (s.scene === null || scenes.includes(s.scene))
        && (s.phase !== 'interlude' || scenes.includes(s.scene))
        && (s.lastScene === null || scenes.includes(s.lastScene))
        && ['daily','native','gaze','task'].includes(s.lastMode)
        && (s.lastTask === null || TASKS.has(s.lastTask))
        && bag(s.sceneBag,scenes) && bag(s.outfitBag,this.options.outfits)
        && (s.phase === 'showcase' ? s.resume && ['dance','interlude'].includes(s.resume.phase)
          && finite(s.resume.elapsed) && s.resume.elapsed < durations[s.resume.phase] : s.resume === null);
    }
    migrateLegacy(old) {
      return {...clone(old), version:2, phase:'dance', phaseElapsed:0,
        danceId:null, danceBag:[], lastDance:null, scene:null,
        lastMode:'native', lastTask:null, taskElapsed:0,
        recoveryRemaining:this.options.recoveryMs, resume:null};
    }
    interval() {
      const [min, max] = this.options.outfitInterval;
      return min + this.random() * (max - min);
    }
    reserveBag(key, choices, previous) {
      const s = this.state;
      if (!s[key].length) {
        s[key] = [...choices];
        for (let i = s[key].length - 1; i > 0; i--) {
          const j = Math.floor(this.random() * (i + 1));
          [s[key][i], s[key][j]] = [s[key][j], s[key][i]];
        }
        if (s[key][0] === previous && s[key].length > 1) {
          [s[key][0], s[key][1]] = [s[key][1], s[key][0]];
        }
      }
      return s[key];
    }
    drawBag(key, choices, previous) {
      return this.reserveBag(key,choices,previous).shift();
    }
    preloadViews(lead) {
      const s=this.state;
      const untilBoundary=s.phase==='dance' ? this.danceDuration()-s.phaseElapsed :
        s.phase==='showcase' ? this.showcaseDuration()-s.phaseElapsed :
        (s.phaseElapsed<this.sceneDuration() ? this.sceneDuration() : this.interludeDuration())-s.phaseElapsed;
      if(untilBoundary>lead)return [];
      // Reserve actual future choices before decoding. Peeking must not draw a
      // different random scene from the one the live clock later consumes.
      this.reserveBag('sceneBag',Object.keys(this.options.sceneDurations),s.lastScene);
      this.reserveBag('danceBag',this.options.danceIds,s.lastDance);
      this.reserveBag('outfitBag',this.options.outfits,s.outfit);
      const future=Object.create(Scheduler.prototype);
      future.options=this.options;future.random=this.random;future.state=clone(s);
      const views=[];let remaining=lead,step=untilBoundary;
      for(let i=0;i<4 && step<=remaining;i++) {
        const view=future.tick(Math.max(0,step),{task:'idle'});views.push(view);remaining-=Math.max(0,step);
        const next=future.state;
        step=next.phase==='dance' ? future.danceDuration()-next.phaseElapsed :
          next.phase==='showcase' ? future.showcaseDuration()-next.phaseElapsed :
          (next.phaseElapsed<future.sceneDuration() ? future.sceneDuration() : future.interludeDuration())-next.phaseElapsed;
        if(step<=0)break;
      }
      return views;
    }
    nextDance() {
      const s = this.state;
      s.danceId = this.drawBag('danceBag', this.options.danceIds, s.lastDance);
      s.lastDance = s.danceId;
    }
    nextScene() {
      const s = this.state;
      s.scene = this.drawBag('sceneBag', Object.keys(this.options.sceneDurations), s.lastScene);
      s.lastScene = s.scene;
    }
    swapAtBoundary(boundaryVisibleMs) {
      const s = this.state;
      if (boundaryVisibleMs < s.nextOutfitAt || this.options.outfits.length < 2) return;
      const oldSceneDuration=this.sceneDuration();
      s.outfit = this.drawBag('outfitBag', this.options.outfits, s.outfit);
      if(s.phase==='interlude' && s.phaseElapsed>=oldSceneDuration)s.phaseElapsed=this.sceneDuration();
      s.nextOutfitAt = boundaryVisibleMs + this.interval();
      s.resume = {phase: s.phase, elapsed: s.phaseElapsed};
      s.phase = 'showcase'; s.phaseElapsed = 0;
    }
    advance(elapsed) {
      const s = this.state;
      let remaining = elapsed;
      while (remaining > 0) {
        let boundary;
        if (s.phase === 'dance') boundary = this.danceDuration();
        else if (s.phase === 'showcase') boundary = this.showcaseDuration();
        else {
          const sceneEnd = this.sceneDuration();
          boundary = s.phaseElapsed < sceneEnd ? sceneEnd : this.interludeDuration();
        }
        const step = Math.min(remaining, boundary - s.phaseElapsed);
        s.phaseElapsed += step; remaining -= step;
        if (s.phaseElapsed < boundary) break;
        if (s.phase === 'showcase') {
          s.phase = s.resume.phase; s.phaseElapsed = s.resume.elapsed; s.resume = null;
        } else {
          if (s.phase === 'dance') {
            s.phase = 'interlude'; s.phaseElapsed = 0; this.nextScene();
          } else if (boundary === this.interludeDuration()) {
            s.phase = 'dance'; s.phaseElapsed = 0; this.nextDance();
          }
          this.swapAtBoundary(s.visibleMs - remaining);
        }
      }
    }
    tick(elapsed, {visible = true, task = 'idle', nearby = false, interaction = false} = {}) {
      if (!Number.isFinite(elapsed) || elapsed < 0) throw Error('Elapsed time must be nonnegative');
      const s = this.state;
      if (!visible) return this.view('hidden', 'idle', 0);
      s.visibleMs += elapsed;
      const mode = interaction ? 'native' : TASKS.has(task) ? 'task' : nearby ? 'gaze' : 'daily';
      if (mode !== 'daily') {
        if (mode === 'task') {
          s.taskElapsed = s.lastMode === 'task' && s.lastTask === task ? s.taskElapsed+elapsed : 0;
          s.lastTask = task;
        }
        s.lastMode = mode; s.recoveryRemaining = this.options.recoveryMs;
        return this.view(mode, mode === 'task' ? task : 'idle', mode === 'task' ? s.taskElapsed : 0);
      }
      s.lastMode = mode;
      if (s.recoveryRemaining > 0) {
        const consumed = Math.min(elapsed, s.recoveryRemaining);
        s.recoveryRemaining -= consumed; elapsed -= consumed;
        if (s.recoveryRemaining > 0) return this.view('daily', 'idle', this.options.recoveryMs-s.recoveryRemaining);
      }
      this.advance(elapsed);
      const clip = s.phase === 'interlude'
        ? s.phaseElapsed < this.sceneDuration() ? s.scene : 'idle'
        : s.phase;
      const elapsedForClip = clip==='idle' && s.phase==='interlude' ? s.phaseElapsed-this.sceneDuration() : s.phaseElapsed;
      return this.view('daily', clip, elapsedForClip);
    }
    view(mode, clip, elapsed) {
      return {mode, clip, elapsed, phase: this.state.phase, outfit: this.state.outfit,
        danceId: this.state.danceId,
        duo: mode === 'daily' && (this.options.duoScenes || ['lawrence-care','lawrence-sleeve',
          'hazelita-chat','hazelita-showcase']).includes(clip)};
    }
    snapshot() {
      const state=clone(this.state);
      if(this.options.outfitTimings)state.timingLimits={dance:this.danceDuration(),interlude:this.interludeDuration(),showcase:this.showcaseDuration(),scene:this.sceneDuration() ?? 0};
      return state;
    }
  }
  return {Scheduler, frameAt};
});
