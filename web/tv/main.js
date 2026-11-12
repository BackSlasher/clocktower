// TV shell: connection, the lobby, stage scaling, audio engine and keys, the quit shortcut,
// and loading the current mode's module (web/modes/<id>/tv/mode.js; contract in
// web/modes/README.md). Knows nothing about any particular game.

import { connect } from '/shared/net.js';
import { createAudio } from '/shared/audio.js';
import { $, esc, GEAR_SVG, CROWN_SVG } from '/shared/dom.js';

const stage = $('stage');
const modeEl = $('mode');
window.ctDebug = {};

// ---------------------------------------------------------------- stage scaling

let px = 1; // device pixels per logical (1920x1080) pixel
let mod = null; // the mounted mode, or null

function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  const x = (innerWidth - 1920 * s) / 2;
  const y = (innerHeight - 1080 * s) / 2;
  stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  // backing store = displayed device pixels, so the canvas stays crisp
  px = Math.round(Math.max(0.25, Math.min(3, s * (devicePixelRatio || 1))) * 100) / 100;
  mod?.resize?.(px);
}
addEventListener('resize', fit);
fit();

// ---------------------------------------------------------------- storage

const KEY_ROOM = 'ct.room';
const KEY_TOKEN = 'ct.tvtoken';
const store = {
  get: (k) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* private mode: no resume, still works */
    }
  },
};

// ---------------------------------------------------------------- audio (shell-owned)
// One engine for every mode. The volume keys, mute and the "sound is off" hint live here; what
// to play when is the mode's business (ctx.audio). The lobby paints first; the samples load after.

const AUDIO_KEY = 'ct.tv.audio';
const audio = createAudio({ base: '/assets/audio/', log: () => {} });
let audioReady = Promise.resolve();
let muted = false;
let tickHint = () => {}; // toggles the unlock hint; set below when audio is supported
if (audio.supported) {
  const readSaved = () => {
    try {
      return JSON.parse(localStorage.getItem(AUDIO_KEY) || 'null') || {};
    } catch {
      return {};
    }
  };
  const q = new URLSearchParams(location.search);
  const saved = readSaved();
  let master = typeof saved.master === 'number' ? saved.master : 0.8;
  muted = !!saved.muted;
  if (q.has('vol') && isFinite(parseFloat(q.get('vol')))) master = parseFloat(q.get('vol'));
  if (q.get('mute') === '1') muted = true;
  master = Math.min(1, Math.max(0, master));
  const apply = () => {
    audio.setVolume({ master });
    audio.setMuted(muted);
  };
  apply();
  const hint = document.createElement('div');
  hint.id = 'soundhint';
  hint.textContent = 'Sound is off — press any key or click to enable';
  const vol = document.createElement('div');
  vol.id = 'voltoast';
  stage.append(hint, vol);
  let volTimer = 0;
  const showVol = () => {
    vol.textContent = muted ? 'Sound muted' : `Volume ${Math.round(master * 100)}%`;
    vol.classList.add('on');
    clearTimeout(volTimer);
    volTimer = setTimeout(() => vol.classList.remove('on'), 1400);
  };
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const k = e.key;
    let used = true;
    if (k === 'm' || k === 'M') muted = !muted;
    else if (k === ']' || k === '=' || k === '+') {
      master = Math.min(1, Math.round((master + 0.1) * 10) / 10);
      muted = false;
    } else if (k === '[' || k === '-' || k === '_') master = Math.max(0, Math.round((master - 0.1) * 10) / 10);
    else used = false;
    if (!used) return;
    apply();
    try {
      localStorage.setItem(AUDIO_KEY, JSON.stringify({ master, muted }));
    } catch {
      /* ignore */
    }
    showVol();
  });
  let hintOn = null;
  tickHint = () => {
    const want = audio.locked && !muted;
    if (want !== hintOn) {
      hintOn = want;
      hint.classList.toggle('on', want);
    }
  };
  audioReady = new Promise((ok) =>
    setTimeout(() => {
      audio.load().then(ok, ok); // the engine swallows its own errors
    }, 200),
  );
}
window.ctDebug.audio = audio;

// ---------------------------------------------------------------- lobby (shell UI)

let welcome = null; // latest welcome (map/defs there are the mode's at connect time)
let setup = null; // { mode, map, defs } of the mode being shown
const seenPids = new Set();
const multi = () => (welcome?.modes?.length || 0) > 1;

function renderWelcome(w) {
  window.ctRoom = w.room;
  $('code').innerHTML = [...w.room].map((ch) => `<span>${esc(ch)}</span>`).join('');
  $('joinHost').textContent = w.joinHost || location.host;
  $('code2').textContent = w.room;
  const qr = $('qr');
  const src = `/qr.svg?room=${encodeURIComponent(w.room)}`;
  if (qr.getAttribute('src') !== src) qr.src = src;
}

// With one mode there is nothing to choose, so no mode name anywhere; with several the
// lobby says which one is selected.
function renderModeLine() {
  const info = multi() ? welcome.modes.find((m) => m.id === setup?.mode) : null;
  $('tagline').hidden = !!info;
  $('modeline').hidden = !info;
  if (info) {
    $('modeName').textContent = info.name;
    $('modeTag').textContent = info.tagline || '';
  }
}

function renderLobby(r) {
  const max = setup?.defs?.maxPlayers || 8;
  const ps = r.players;
  $('pcount').textContent = `${ps.length} / ${max}`;
  const slots = Math.min(max, Math.max(4, ps.length + 1));
  let html = '';
  for (const p of ps) {
    const fresh = !seenPids.has(p.id);
    seenPids.add(p.id);
    html += `<li class="pl ${p.connected ? '' : 'away'} ${fresh ? 'new' : ''}" style="--pc:${esc(p.color)}">
        ${GEAR_SVG('spin')}<span class="nm">${esc(p.name)}</span>
        ${p.id === r.host ? `<span class="host">${CROWN_SVG}Host</span>` : ''}
        ${p.connected ? '' : '<span class="aw">away</span>'}</li>`;
  }
  for (let i = ps.length; i < slots; i++) html += `<li class="pl empty"><span class="nm">waiting for an engineer…</span></li>`;
  $('plist').innerHTML = html;
  $('plist').classList.toggle('dense', ps.length > 5);
  const host = ps.find((p) => p.id === r.host);
  $('lobbyStatus').innerHTML = host
    ? `Waiting for <b style="color:${esc(host.color)}">${esc(host.name)}</b> to start the game<span class="dots"></span>`
    : `Waiting for engineers to join<span class="dots"></span>`;
}

function setStatus(s) {
  const b = $('badge');
  if (s === 'open') b.className = '';
  else if (s === 'replaced') {
    b.textContent = 'This room is now shown on another screen';
    b.className = 'on';
  } else if (s === 'connecting' || s === 'closed') {
    if (welcome) {
      b.textContent = 'Reconnecting…';
      b.className = 'on';
    }
  }
}

// ---------------------------------------------------------------- mode loading

const sheets = [];
let loadToken = 0; // bumped on every (re)load so a stale import cannot mount
let loading = false;
let queue = []; // room/snap messages that arrived while the mode module was loading
let modeId = null;

function makeCtx(id, s, w) {
  return {
    id,
    el: modeEl,
    stage,
    get setup() {
      return s;
    },
    get welcome() {
      return welcome || w;
    },
    get room() {
      return (welcome || w).room;
    },
    get px() {
      return px;
    },
    send: (m) => conn.send(m),
    audio,
    audioReady,
    debug: window.ctDebug,
    // Adds a stylesheet for the lifetime of the mount; resolves once applied.
    loadCSS(href) {
      return new Promise((ok) => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        l.onload = l.onerror = () => ok();
        document.head.append(l);
        sheets.push(l);
      });
    },
  };
}

function unmountMode() {
  loadToken++;
  const old = mod;
  mod = null;
  modeId = null;
  try {
    old?.unmount?.();
  } catch (e) {
    console.error('mode unmount failed', e);
  }
  modeEl.replaceChildren();
  for (const l of sheets.splice(0)) l.remove();
  const ctxDebug = window.ctDebug;
  for (const k of Object.keys(ctxDebug)) if (!['audio', 'perf'].includes(k)) delete ctxDebug[k];
}

async function loadMode(id, s, w) {
  unmountMode();
  setup = s;
  renderModeLine();
  const token = loadToken;
  loading = true;
  queue = [];
  try {
    if (!/^[a-z0-9_]+$/.test(id)) throw new Error(`bad mode id ${id}`);
    const m = await import(`/modes/${id}/tv/mode.js`);
    if (token !== loadToken) return;
    const mounted = await m.mount(makeCtx(id, s, w));
    if (token !== loadToken) {
      mounted?.unmount?.();
      return;
    }
    mod = mounted;
    modeId = id;
    mod.resize?.(px);
  } catch (e) {
    console.error(`mode ${id} failed to load`, e);
    $('lobbyStatus').textContent = 'Could not load this game mode';
  }
  if (token !== loadToken) return;
  loading = false;
  const q = queue;
  queue = [];
  for (const m of q) dispatch(m, performance.now());
  if (demo && demoPending) {
    demoPending = false;
    demoOn = true;
    mod?.demo?.(demo, handle);
  }
}

// ---------------------------------------------------------------- messages

const demo = new URLSearchParams(location.search).get('demo');
let demoPending = false;
let demoOn = false;

// room and snap go to the mode (queued while it loads)
function dispatch(m, now) {
  if (m.t === 'room') mod?.onRoom?.(m);
  else if (m.t === 'snap') mod?.onSnap?.(m, now);
}

function handle(m) {
  const now = performance.now();
  switch (m.t) {
    case 'welcome': {
      store.set(KEY_ROOM, m.room);
      store.set(KEY_TOKEN, m.token);
      const fresh = !welcome || welcome.room !== m.room;
      welcome = m;
      renderWelcome(m);
      if (fresh || modeId !== m.mode) {
        seenPids.clear();
        loadMode(m.mode, { mode: m.mode, map: m.map, defs: m.defs }, m);
        if (demo) demoPending = true;
      } else renderModeLine();
      break;
    }
    case 'setup':
      // the host picked another mode: the old mode's pages go, the new one loads
      loadMode(m.mode, { mode: m.mode, map: m.map, defs: m.defs }, welcome);
      break;
    case 'room':
      document.body.dataset.phase = m.phase;
      $('lobby').classList.toggle('on', m.phase === 'lobby');
      renderLobby(m);
      if (loading) queue.push(m);
      else dispatch(m, now);
      break;
    case 'snap':
      if (loading) queue.push(m);
      else dispatch(m, now);
      break;
    case 'error':
      console.warn('server:', m.code, m.msg);
      break;
  }
}

const conn = connect(() => ({ role: 'tv', room: store.get(KEY_ROOM), token: store.get(KEY_TOKEN) }), {
  onStatus(s) {
    setStatus(s);
    mod?.onStatus?.(s);
  },
  onMessage(m) {
    if (demoOn) return;
    handle(m);
  },
});

// ---------------------------------------------------------------- frame loop

// ?fps=1: readout of frames actually drawn (rAF and timer fallback both pass
// through frame()). Without the flag `perf` is null and costs one check.
const perf = new URLSearchParams(location.search).get('fps') === '1' ? makePerf() : null;

function makePerf() {
  const el = document.createElement('div');
  el.id = 'fps';
  stage.append(el);
  const stamps = []; // frame start times, last 5 s
  const draws = []; // matching draw durations (ms)
  const p = { fps: 0, worstGap: 0, drawMs: 0, canvas: '', enemies: 0 };
  let lastShown = 0;
  p.record = (t0, t1) => {
    stamps.push(t0);
    draws.push(t1 - t0);
    while (stamps[0] < t1 - 5000) {
      stamps.shift();
      draws.shift();
    }
    if (t1 - lastShown < 500) return;
    lastShown = t1;
    let n = 0;
    let sum = 0;
    let worst = t1 - stamps[stamps.length - 1];
    for (let i = stamps.length - 1; i >= 0; i--) {
      if (stamps[i] >= t1 - 1000) {
        n++;
        sum += draws[i];
      }
      if (i > 0) worst = Math.max(worst, stamps[i] - stamps[i - 1]);
    }
    const info = mod?.perfInfo?.() || {};
    p.fps = n;
    p.worstGap = Math.round(worst);
    p.drawMs = n ? Math.round((sum / n) * 100) / 100 : 0;
    p.canvas = info.canvas || '';
    p.enemies = info.enemies || 0;
    el.textContent = `${p.fps} fps  gap ${p.worstGap} ms  draw ${p.drawMs.toFixed(1)} ms${info.text ? `  ${info.text}` : ''}`;
  };
  return p;
}
window.ctDebug.perf = perf;

let last = performance.now();
function frame() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!loading) mod?.frame?.(now, dt);
  tickHint();
  perf?.record(now, performance.now());
}
function raf() {
  frame();
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);
// Some TV browsers (and occluded windows) throttle rAF; keep animating anyway.
setInterval(() => {
  if (performance.now() - last > 60) frame();
}, 33);

// ---------------------------------------------------------------- quit shortcut
// Back/Escape once: "Press Back again to quit" for 3 s; again within that time: window.close().
// Browsers refuse to close windows scripts did not open, so if we are still here 300 ms later,
// tell the viewer to close it themselves. Never stops propagation: audio keys and the
// sound-unlock-on-first-key behaviour are untouched.
{
  const el = document.createElement('div');
  el.id = 'quit';
  stage.append(el);
  let armed = false;
  let timer = 0;
  const say = (text, ms) => {
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.classList.remove('on');
      armed = false;
    }, ms);
  };
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (!['Escape', 'GoBack', 'BrowserBack', 'Backspace'].includes(e.key)) return;
    e.preventDefault();
    if (!armed) {
      armed = true;
      say('Press Back again to quit', 3000);
      return;
    }
    armed = false;
    clearTimeout(timer);
    window.close();
    setTimeout(() => {
      if (!window.closed) say('Close this window to quit', 4000);
    }, 300);
  });
}
