// TV entry point: connection, phase routing, stage scaling and the frame loop.

import { connect } from '/shared/net.js';
import { Game } from './game.js';
import { UI } from './ui.js';

const stage = document.getElementById('stage');
const canvas = document.getElementById('cv');
const ui = new UI();
const game = new Game(canvas, ui);

// ---------------------------------------------------------------- stage scaling

function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  const x = (innerWidth - 1920 * s) / 2;
  const y = (innerHeight - 1080 * s) / 2;
  stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  // backing store = displayed device pixels, so the canvas stays crisp
  const px = Math.max(0.25, Math.min(3, s * (devicePixelRatio || 1)));
  game.resize(Math.round(px * 100) / 100);
}
addEventListener('resize', fit);
fit();

// ---------------------------------------------------------------- connection

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

const demo = new URLSearchParams(location.search).get('demo');
let demoOn = false;
let sound = null; // audio, loaded lazily (see bottom)
let lastWelcome = null;
let lastRoom = null;

function handle(m) {
  const now = performance.now();
  switch (m.t) {
    case 'welcome':
      store.set(KEY_ROOM, m.room);
      store.set(KEY_TOKEN, m.token);
      if (ui.welcome && ui.welcome.room !== m.room) game.reset(); // got a fresh room
      game.setWelcome(m);
      ui.setWelcome(m);
      lastWelcome = m;
      sound?.onWelcome(m);
      break;
    case 'room':
      game.setRoom(m);
      ui.setRoom(m, game);
      lastRoom = m;
      sound?.onRoom(m);
      break;
    case 'snap':
      game.onSnap(m, now);
      ui.renderStrip(game);
      break;
    case 'error':
      console.warn('server:', m.code, m.msg);
      break;
  }
}

connect(() => ({ role: 'tv', room: store.get(KEY_ROOM), token: store.get(KEY_TOKEN) }), {
  onStatus(s) {
    ui.setStatus(s);
  },
  onMessage(m) {
    if (demoOn) return;
    handle(m);
    if (demo && m.t === 'welcome') {
      demoOn = true;
      import('./demo.js').then(({ startDemo }) => startDemo(demo, m, handle));
    }
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
    let e = 0;
    for (const en of game.ents.values()) if (!en.gone) e++;
    p.fps = n;
    p.worstGap = Math.round(worst);
    p.drawMs = n ? Math.round((sum / n) * 100) / 100 : 0;
    p.canvas = `${canvas.width}x${canvas.height}`;
    p.enemies = e;
    el.textContent = `${p.fps} fps  gap ${p.worstGap} ms  draw ${p.drawMs.toFixed(1)} ms  ${p.canvas}  ${p.enemies} enemies`;
  };
  return p;
}

let last = performance.now();
function frame() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.frame(now, dt);
  ui.tick(game, now);
  sound?.tick(game, now);
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

window.ctDebug = { game, ui, perf };

// ---------------------------------------------------------------- sound (lazy, optional)
// The lobby paints first; the engine and samples load afterwards. Any failure leaves the
// game exactly as it was, just silent.
setTimeout(() => {
  import('./sound.js')
    .then(({ createTVSound }) => createTVSound({ stage, ui }))
    .then((s) => {
      if (!s) return;
      s.game = game;
      game.sound = s;
      sound = s;
      window.ctDebug.sound = s;
      if (lastWelcome) s.onWelcome(lastWelcome);
      if (lastRoom) s.onRoom(lastRoom);
    })
    .catch(() => {});
}, 200);

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
