// Clocktower audio engine (TV, and any page that needs sound). Web Audio, no dependencies.
//
//   import { createAudio } from '/shared/audio.js';
//   const audio = createAudio({ base: '/assets/audio/' });
//   await audio.load();                 // manifest + sfx/ambience decoded; music is decoded lazily
//   audio.unlock();                     // call from any user gesture (also auto-bound, see autoUnlock)
//   audio.play('shot_rivet', { pan: audio.panForX(x, mapW), gain: 0.8, rate: 1.05 });
//   audio.music('music_battle', { fade: 1.5 });   audio.music(null);
//   audio.ambience('amb_town');         audio.ambience(null);
//   audio.setVolume({ master: .8, music: .5, sfx: 1, amb: 1 }); audio.setMuted(true);
//
// Every method is a safe no-op while the browser blocks audio, when Web Audio is missing,
// or when a file failed to load; nothing here throws into the caller.

const MAX_TOTAL_VOICES = 48;
const PAN_SPREAD = 0.7; // never hard-pan; a TV in a room is not headphones

export function createAudio(opts = {}) {
  const base = (opts.base ?? '/assets/audio/').replace(/\/?$/, '/');
  const log = opts.log ?? ((...a) => console.warn('[audio]', ...a));
  const warned = new Set();
  const warnOnce = (key, ...a) => { if (!warned.has(key)) { warned.add(key); log(...a); } };

  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  let ctx = null;
  let master, comp, limiter, shaper, analyser, sfxBus, musicBus, ambBus, duckNode;
  const vol = { master: 0.8, music: 0.5, sfx: 1, amb: 0.6 };
  let muted = false;
  let suspendedByUs = false;          // page hidden
  let manifest = null;                // { sounds: {...} }
  const sounds = new Map();           // id -> { def, buffers: [AudioBuffer], pending: Promise|null, failed: bool }
  const stats = { played: 0, throttled: 0, capped: 0, locked: 0, missing: 0 };
  const lastPlay = new Map();         // id -> ms (performance.now)
  const recent = new Map();           // id -> [ms...] for maxPerSecond
  const lastVar = new Map();          // id -> last variation index
  const voices = new Map();           // id -> Set(source)
  let totalVoices = 0;
  const chan = { music: { cur: null, want: null, token: 0 }, amb: { cur: null, want: null, token: 0 } };

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  // ---- context and graph -------------------------------------------------------------------
  function build() {
    if (!Ctor) return;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      try { ctx = new Ctor(); } catch { ctx = null; return; }
    }
    try {
      master = ctx.createGain();
      comp = ctx.createDynamicsCompressor();       // gentle glue
      comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 4;
      comp.attack.value = 0.004; comp.release.value = 0.22;
      limiter = ctx.createDynamicsCompressor();    // fast catch for pile-ups
      limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.001; limiter.release.value = 0.08;
      shaper = ctx.createWaveShaper();             // last-resort soft clip: output can never exceed ~0.98
      const N = 2048, curve = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1, a = Math.abs(x);
        curve[i] = Math.sign(x) * (a <= 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28));
      }
      shaper.curve = curve; shaper.oversample = '2x';
      analyser = ctx.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0;
      master.connect(comp); comp.connect(limiter); limiter.connect(shaper); shaper.connect(analyser);
      analyser.connect(ctx.destination);

      sfxBus = ctx.createGain(); musicBus = ctx.createGain(); ambBus = ctx.createGain(); duckNode = ctx.createGain();
      sfxBus.connect(master);
      musicBus.connect(duckNode); duckNode.connect(master);
      ambBus.connect(master);
      applyVolumes(true);
      ctx.addEventListener?.('statechange', onState);
    } catch (e) {
      warnOnce('graph', 'could not build audio graph', e);
      ctx = null;
    }
  }

  function applyVolumes(immediate) {
    if (!ctx) return;
    const t = ctx.currentTime, set = (g, v) => {
      try {
        g.gain.cancelScheduledValues(t);
        if (immediate) g.gain.value = v; else g.gain.setTargetAtTime(v, t, 0.03);
      } catch { /* ignore */ }
    };
    set(master, muted ? 0 : vol.master);
    set(sfxBus, vol.sfx); set(musicBus, vol.music); set(ambBus, vol.amb);
    if (immediate) duckNode.gain.value = 1;
  }

  function onState() {
    if (ctx && ctx.state === 'running') {
      // browser let us in: start anything that was asked for while locked
      for (const k of ['music', 'amb']) {
        const c = chan[k];
        if (c.want && (!c.cur || c.cur.id !== c.want.id)) startLoop(k, c.want.id, c.want.opts);
      }
    }
  }

  build();

  // ---- visibility and gestures -------------------------------------------------------------
  function onVisibility() {
    if (!ctx) return;
    try {
      if (document.hidden) {
        if (ctx.state === 'running') { suspendedByUs = true; ctx.suspend().catch(() => {}); }
      } else if (suspendedByUs) {
        suspendedByUs = false; ctx.resume().catch(() => {});
      }
    } catch { /* ignore */ }
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  const GESTURES = ['pointerdown', 'mousedown', 'touchend', 'keydown', 'click'];
  function unlock() {
    if (!ctx) return;
    try {
      if (!(typeof document !== 'undefined' && document.hidden) && ctx.state !== 'running') {
        suspendedByUs = false;
        const p = ctx.resume(); p && p.catch && p.catch(() => {});
      }
    } catch { /* ignore */ }
  }
  function gestureHandler() {
    unlock();
    if (ctx && ctx.state === 'running') for (const g of GESTURES) window.removeEventListener(g, gestureHandler, true);
  }
  if (ctx && opts.autoUnlock !== false && typeof window !== 'undefined') {
    for (const g of GESTURES) window.addEventListener(g, gestureHandler, true);
  }

  // ---- loading -------------------------------------------------------------------------------
  async function fetchBuffer(file) {
    const res = await fetch(base + file);
    if (!res.ok) throw new Error(`${res.status} ${file}`);
    const data = await res.arrayBuffer();
    return await new Promise((ok, bad) => {
      const p = ctx.decodeAudioData(data, ok, bad); // callback form for old Safari
      if (p && p.then) p.then(ok, bad);
    });
  }

  function decodeSound(id) {
    const s = sounds.get(id);
    if (!s || !ctx) return Promise.resolve(false);
    if (s.buffers.length || s.failed) return Promise.resolve(s.buffers.length > 0);
    if (s.pending) return s.pending;
    s.pending = Promise.all(s.def.files.map(async (f) => {
      try { return await fetchBuffer(f); } catch (e) { warnOnce('file:' + f, `missing or undecodable: ${f}`, e && e.message); return null; }
    })).then((bufs) => {
      s.buffers = bufs.filter(Boolean);
      s.failed = s.buffers.length === 0;
      s.pending = null;
      return s.buffers.length > 0;
    });
    return s.pending;
  }

  async function load() {
    const result = { loaded: [], missing: [], lazy: [] };
    try {
      const res = await fetch(base + 'manifest.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      manifest = await res.json();
    } catch (e) {
      warnOnce('manifest', 'audio manifest unavailable; continuing silently', e && e.message);
      return result;
    }
    for (const [id, def] of Object.entries(manifest.sounds || {})) {
      if (!def || !Array.isArray(def.files) || !def.files.length) continue;
      sounds.set(id, { def, buffers: [], pending: null, failed: false });
    }
    if (!ctx) return result;
    const eager = [];
    for (const [id, s] of sounds) {
      if (s.def.category === 'music') result.lazy.push(id);
      else eager.push(decodeSound(id).then((ok) => (ok ? result.loaded : result.missing).push(id)));
    }
    await Promise.all(eager);
    return result;
  }

  // Decode music ahead of time (e.g. the lobby track while the page sits idle).
  const preload = (...ids) => Promise.all(ids.map((id) => decodeSound(id).catch(() => false)));

  // ---- one-shots -----------------------------------------------------------------------------
  function duck(depth, hold, release) {
    if (!ctx) return;
    const t = ctx.currentTime, g = duckNode.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(depth, t, 0.04);
    g.setTargetAtTime(1, t + 0.1 + hold, release / 3);
  }

  function play(id, o = {}) {
    try {
      if (!ctx || muted) return null;
      if (ctx.state !== 'running') { stats.locked++; return null; }
      const s = sounds.get(id);
      if (!s || !s.buffers.length) { stats.missing++; return null; }
      const def = s.def, t = now();

      const minGap = num(def.minIntervalMs, 0);
      if (minGap && t - (lastPlay.get(id) ?? -1e9) < minGap) { stats.throttled++; return null; }
      const mps = num(def.maxPerSecond, 0);
      if (mps) {
        const r = (recent.get(id) ?? []).filter((x) => t - x < 1000);
        recent.set(id, r);
        if (r.length >= mps) { stats.throttled++; return null; }
        r.push(t);
      }
      let set = voices.get(id); if (!set) voices.set(id, (set = new Set()));
      if (set.size >= num(def.maxVoices, 8) || totalVoices >= MAX_TOTAL_VOICES) { stats.capped++; return null; }
      lastPlay.set(id, t);

      let vi = 0;
      if (Number.isInteger(o.variant) && o.variant >= 0 && o.variant < s.buffers.length) {
        vi = o.variant;                                 // explicit pick (soundboard)
      } else if (s.buffers.length > 1) {                       // random variation, never the same twice in a row
        vi = Math.floor(Math.random() * (s.buffers.length - 1));
        if (vi >= (lastVar.get(id) ?? -1)) vi++;
        vi = Math.min(vi, s.buffers.length - 1);
        lastVar.set(id, vi);
      }
      const src = ctx.createBufferSource();
      src.buffer = s.buffers[vi];
      const pv = num(def.pitchVar, 0.04);
      src.playbackRate.value = clamp(num(o.rate, 1) * (1 + (Math.random() * 2 - 1) * pv), 0.25, 4);
      const gv = num(def.gainVar, 0.12);
      const g = ctx.createGain();
      g.gain.value = Math.max(0, num(def.gain, 1) * num(o.gain, 1) * (1 + (Math.random() * 2 - 1) * gv));
      src.connect(g);
      let tail = g;
      if (typeof o.pan === 'number' && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); g.connect(p); tail = p;
      }
      tail.connect(def.category === 'amb' ? ambBus : sfxBus);
      set.add(src); totalVoices++;
      src.onended = () => { set.delete(src); totalVoices--; try { src.disconnect(); g.disconnect(); tail !== g && tail.disconnect(); } catch { /* ignore */ } };
      src.start();
      stats.played++;
      if (def.duck) duck(num(def.duck.depth, 0.6), num(def.duck.hold, 0.8), num(def.duck.release, 1.2));
      return { stop() { try { src.stop(); } catch { /* ignore */ } } };
    } catch (e) {
      warnOnce('play:' + id, 'play failed', id, e && e.message);
      return null;
    }
  }

  // ---- loops: music and ambience -------------------------------------------------------------
  const curveIn = new Float32Array(64), curveOut = new Float32Array(64);
  for (let i = 0; i < 64; i++) { const x = i / 63; curveIn[i] = Math.sin(x * Math.PI / 2); curveOut[i] = Math.cos(x * Math.PI / 2); }

  function ramp(g, curve, t0, dur, peak) {
    const c = curve.map((v) => v * peak);
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueCurveAtTime(c, t0, Math.max(0.05, dur));
  }

  async function startLoop(kind, id, o) {
    const c = chan[kind], token = ++c.token;
    try {
      if (!ctx || ctx.state !== 'running') return;
      const ok = await decodeSound(id);
      if (token !== c.token || !ok) return;                 // superseded, or file missing
      const s = sounds.get(id);
      const fade = num(o.fade, 1.5), t0 = ctx.currentTime, peak = num(s.def.gain, 1) * num(o.gain, 1);
      const bus = kind === 'music' ? musicBus : ambBus;
      const src = ctx.createBufferSource(); src.buffer = s.buffers[0]; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0;
      // A second gain used only for the fade-out. The first may still be running its
      // fade-in curve when the track is retired, and scheduling over a running curve throws
      // in some browsers, which used to leave the old track playing under the new one.
      const out = ctx.createGain(); out.gain.value = 1;
      src.connect(g); g.connect(out); out.connect(bus); src.start();
      if (fade > 0.01) ramp(g, curveIn, t0, fade, peak); else g.gain.value = peak;
      const old = c.cur; c.cur = { id, src, g, out, peak };
      if (old) retire(old, fade);
    } catch (e) {
      warnOnce('loop:' + id, 'loop failed', id, e && e.message);
    }
  }

  function retire(v, fade) {
    const t0 = ctx.currentTime, f = Math.max(fade, 0.01);
    try {
      v.out.gain.setValueAtTime(1, t0);
      v.out.gain.linearRampToValueAtTime(0, t0 + f);
    } catch {
      try { v.out.gain.value = 0; } catch { /* ignore */ }
    }
    // Whatever happened to the fade, the source must stop.
    try { v.src.stop(t0 + f + 0.1); } catch { /* ignore */ }
    v.src.onended = () => { try { v.src.disconnect(); v.g.disconnect(); v.out.disconnect(); } catch { /* ignore */ } };
  }

  function loop(kind, id, o = {}) {
    try {
      const c = chan[kind];
      if (id == null) {
        c.want = null; c.token++;
        if (c.cur && ctx) { retire(c.cur, num(o.fade, 1.5)); c.cur = null; }
        return;
      }
      if (c.cur && c.cur.id === id) {
        c.want = { id, opts: o };
        // same track asked for at a different level (e.g. lobby track, quieter in build): glide there
        const s = sounds.get(id), peak = num(s && s.def.gain, 1) * num(o.gain, 1);
        if (ctx && s && Math.abs(peak - (c.cur.peak ?? peak)) > 0.001) {
          const t = ctx.currentTime, g = c.cur.g.gain;
          g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.setTargetAtTime(peak, t, 0.5);
          c.cur.peak = peak;
        }
        return;
      }
      c.want = { id, opts: o };
      if (ctx && ctx.state === 'running') startLoop(kind, id, o);   // otherwise starts on unlock
    } catch (e) {
      warnOnce('loopcall', 'music call failed', e && e.message);
    }
  }

  // ---- the public object ---------------------------------------------------------------------
  const api = {
    load, unlock, preload, play, duck,
    music: (id, o) => loop('music', id, o),
    ambience: (id, o) => loop('amb', id, o),
    get supported() { return !!ctx; },
    get locked() { return !!ctx && ctx.state !== 'running' && !suspendedByUs; },
    get muted() { return muted; },
    get volume() { return { ...vol }; },
    get currentMusic() { return chan.music.cur ? chan.music.cur.id : null; },
    get currentAmbience() { return chan.amb.cur ? chan.amb.cur.id : null; },
    get manifest() { return manifest; },
    get context() { return ctx; },
    get analyser() { return analyser; },
    get stats() { return { ...stats, voices: totalVoices }; },
    ids: () => [...sounds.keys()],
    has: (id) => !!(sounds.get(id) && sounds.get(id).buffers.length),
    info(id) {
      const s = sounds.get(id); if (!s) return null;
      return { ...s.def, loaded: s.buffers.length > 0, durations: s.buffers.map((b) => b.duration) };
    },
    setVolume(v = {}) {
      for (const k of ['master', 'music', 'sfx', 'amb']) if (typeof v[k] === 'number') vol[k] = clamp(v[k], 0, 1.5);
      applyVolumes(false);
      if (opts.persist) try { localStorage.setItem(opts.persist, JSON.stringify({ ...vol, muted })); } catch { /* ignore */ }
    },
    setMuted(m) {
      muted = !!m; applyVolumes(false);
      if (opts.persist) try { localStorage.setItem(opts.persist, JSON.stringify({ ...vol, muted })); } catch { /* ignore */ }
    },
    // Map x (0..mapWidth) to a stereo position; gentle so a far-left shot is not hard-panned.
    panForX(x, mapWidth) {
      if (!(mapWidth > 0) || typeof x !== 'number') return 0;
      return clamp((x / mapWidth) * 2 - 1, -1, 1) * PAN_SPREAD;
    },
    stopAll() {
      for (const set of voices.values()) for (const s of set) try { s.stop(); } catch { /* ignore */ }
      loop('music', null, { fade: 0.2 }); loop('amb', null, { fade: 0.2 });
    },
  };

  if (opts.persist) {
    try {
      const saved = JSON.parse(localStorage.getItem(opts.persist) || 'null');
      if (saved) { for (const k of ['master', 'music', 'sfx', 'amb']) if (typeof saved[k] === 'number') vol[k] = saved[k]; muted = !!saved.muted; applyVolumes(true); }
    } catch { /* ignore */ }
  }
  return api;
}
