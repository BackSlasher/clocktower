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

function handle(m) {
  const now = performance.now();
  switch (m.t) {
    case 'welcome':
      store.set(KEY_ROOM, m.room);
      store.set(KEY_TOKEN, m.token);
      if (ui.welcome && ui.welcome.room !== m.room) game.reset(); // got a fresh room
      game.setWelcome(m);
      ui.setWelcome(m);
      break;
    case 'room':
      game.setRoom(m);
      ui.setRoom(m, game);
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

let last = performance.now();
function frame() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.frame(now, dt);
  ui.tick(game, now);
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

window.ctDebug = { game, ui };
