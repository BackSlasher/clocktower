// Reference-card vignettes: little drawings of each stage of a step, made from the game's own
// sprites on tiny fragments of floor and street, like the panels of a board game's reference
// card. Each is drawn once into an offscreen canvas (at 2× so it stays crisp at 4K) and then
// copied into the turn-order card and the first-turn card.
//
//   vignette(id) -> canvas   ids: throw, move, grab, fire, machines, good, bad

import { TAU, softSprite } from '../../tower_defense/tv/geom.js';
import { drawEngineer, drawBomb, drawCatapult, drawMachine } from './sprites.js';

export const VW = 220; // logical size of a vignette
export const VH = 150;
const RES = 2;

// a tiny iso projection with the same interface the sprites use (p, TW, TH, HZ, k, px)
class Mini {
  constructor(tw, ox, oy) {
    this.TW = tw;
    this.TH = tw * 0.5;
    this.HZ = tw * 0.34;
    this.k = tw / 130;
    this.px = RES;
    this.ox = ox;
    this.oy = oy;
  }
  p(x, y, z = 0) {
    return [this.ox + ((x - y) * this.TW) / 2, this.oy + ((x + y) * this.TH) / 2 - z * this.HZ];
  }
}

const AMBER = '#e0a030';
const TEAL = '#4fb39a';
const RED = '#d1594a';

function poly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

// a courtyard tile (or a raised one with its front faces), framed and studded like the board
function tile(g, S, x, y, z = 0, opts = {}) {
  const d = 0.5;
  const top = [S.p(x - d, y - d, z), S.p(x + d, y - d, z), S.p(x + d, y + d, z), S.p(x - d, y + d, z)];
  if (z > 0) {
    poly(g, [S.p(x + d, y - d, z), S.p(x + d, y + d, z), S.p(x + d, y + d, 0), S.p(x + d, y - d, 0)]);
    g.fillStyle = '#7d6649';
    g.fill();
    poly(g, [S.p(x - d, y + d, z), S.p(x + d, y + d, z), S.p(x + d, y + d, 0), S.p(x - d, y + d, 0)]);
    g.fillStyle = '#a68a66';
    g.fill();
    g.strokeStyle = 'rgba(40,24,8,0.6)';
    g.lineWidth = 1;
    g.stroke();
  }
  poly(g, top);
  g.fillStyle = opts.col || (z > 0 ? '#d4c6a6' : (x + y) % 2 ? '#a5825a' : '#9c7a52');
  g.fill();
  g.strokeStyle = 'rgba(46,26,8,0.75)';
  g.lineWidth = 1.4;
  g.stroke();
  if (opts.stud !== false) {
    const [cx, cy] = S.p(x, y, z);
    g.fillStyle = '#d9b25a';
    g.beginPath();
    g.ellipse(cx, cy, 2.4, 1.3, 0, 0, TAU);
    g.fill();
  }
}

// a cobbled street fragment along y from y0 to y1 at x
function street(g, S, x, y0, y1) {
  const z = -0.2;
  poly(g, [S.p(x - 0.55, y0, z), S.p(x + 0.55, y0, z), S.p(x + 0.55, y1, z), S.p(x - 0.55, y1, z)]);
  g.fillStyle = '#5f503f';
  g.fill();
  g.fillStyle = 'rgba(255,230,190,0.18)';
  for (let yy = Math.min(y0, y1) + 0.1; yy < Math.max(y0, y1); yy += 0.22) {
    for (let xx = x - 0.45; xx < x + 0.5; xx += 0.22) {
      const [cx, cy] = S.p(xx + ((yy * 7) % 0.1), yy, z);
      g.beginPath();
      g.ellipse(cx, cy, 2.2, 1.2, 0, 0, TAU);
      g.fill();
    }
  }
}

function arc(g, a, b, h, col, dash = [5, 4]) {
  g.save();
  g.setLineDash(dash);
  g.lineWidth = 2.2;
  g.strokeStyle = col;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.quadraticCurveTo((a[0] + b[0]) / 2, Math.min(a[1], b[1]) - h, b[0], b[1]);
  g.stroke();
  g.restore();
}

function arrow(g, a, b, col, w = 3.5) {
  const an = Math.atan2(b[1] - a[1], b[0] - a[0]);
  g.strokeStyle = 'rgba(10,8,6,0.75)';
  g.lineWidth = w + 3;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
  g.strokeStyle = col;
  g.lineWidth = w;
  g.stroke();
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(b[0] + Math.cos(an) * 6, b[1] + Math.sin(an) * 6);
  g.lineTo(b[0] - Math.cos(an - 0.6) * 9, b[1] - Math.sin(an - 0.6) * 9);
  g.lineTo(b[0] - Math.cos(an + 0.6) * 9, b[1] - Math.sin(an + 0.6) * 9);
  g.closePath();
  g.fill();
}

function eng(g, S, x, y, z, color, o = {}) {
  const [sx, sy] = S.p(x, y, z);
  drawEngineer(g, { sx, sy, k: S.k * 1.1, color, face: o.face ?? 1, walk: o.walk ?? -1, carry: o.carry || null, pose: o.pose || 'idle', poseK: o.poseK ?? 0.5, t: 0.3, dim: false });
}

function mark(g, x, y, ok) {
  g.fillStyle = ok ? '#5fd3a8' : '#ff5a3f';
  g.beginPath();
  g.arc(x, y, 14, 0, TAU);
  g.fill();
  g.strokeStyle = '#0d1416';
  g.lineWidth = 2.5;
  g.stroke();
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  if (ok) {
    g.moveTo(x - 6, y);
    g.lineTo(x - 1.5, y + 5);
    g.lineTo(x + 7, y - 5);
  } else {
    g.moveTo(x - 5, y - 5);
    g.lineTo(x + 5, y + 5);
    g.moveTo(x + 5, y - 5);
    g.lineTo(x - 5, y + 5);
  }
  g.stroke();
}

// ---------------------------------------------------------------- the panels

const PANELS = {
  // 1: a bomb thrown along a row and caught
  throw(g) {
    const S = new Mini(80, 52, 74);
    for (let i = 0; i < 3; i++) tile(g, S, i, 0);
    eng(g, S, 0, 0, 0, AMBER, { pose: 'throw', poseK: 0.6 });
    const a = S.p(0.15, 0, 1.35);
    const b = S.p(2, 0, 1.2);
    arc(g, a, b, 26, 'rgba(255,214,130,0.95)');
    const [mx, my] = S.p(1.1, 0, 2.1);
    drawBomb(g, 'keg', mx, my + 9, 0.8, 0.3);
    eng(g, S, 2, 0, 0, TEAL, { pose: 'reach', poseK: 0.5, face: -1 });
  },
  // 2: engineers stepping to the next tile
  move(g) {
    const S = new Mini(78, 96, 70);
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) tile(g, S, x, y);
    arrow(g, S.p(1, -0.35, 0.02), S.p(1, 0.45, 0.02), '#f4ead2');
    arrow(g, S.p(-0.3, 1, 0.02), S.p(0.5, 1, 0.02), '#f4ead2');
    eng(g, S, 1, 0.1, 0, TEAL, { walk: 0.7, face: -1 });
    eng(g, S, 0.15, 1, 0, AMBER, { walk: 0.3 });
  },
  // 3: picking up the bomb underfoot, and dropping one into a catapult's bucket
  grab(g) {
    const S = new Mini(76, 58, 104);
    tile(g, S, 0, 0);
    const [bx, by] = S.p(0.22, 0.22, 0);
    drawBomb(g, 'keg', bx, by, 0.6, 0.3);
    eng(g, S, 0, 0, 0, AMBER, { pose: 'reach', poseK: 0.5 });
    // a catapult on its wall block, a bomb dropping into the bucket
    const C = new Mini(66, 160, 70);
    tile(g, C, 0, 0, 1, { stud: false, col: '#c9b48d' });
    drawCatapult(g, C, { x: 0, y: 0, dir: [0, -1], phi: 0.95, kind: 'grapeshot', t: 0.4 });
  },
  // 4: the catapult fires itself at a machine in its lane
  fire(g) {
    const S = new Mini(58, 74, 112);
    street(g, S, 0, -0.5, -4.2);
    tile(g, S, 0, 0, 1, { stud: false, col: '#c9b48d' });
    drawMachine(g, S, { kind: 'scrap', x: 0, y: -3.5, z: -0.2, a: Math.PI / 2, t: 0.3, flash: 0, alpha: 1, scale: 1.25 });
    drawCatapult(g, S, { x: 0, y: 0, dir: [0, -1], phi: 2.5, kind: null, t: 0.4 });
    const a = S.p(0, -0.7, 2.6);
    const b = S.p(0, -3.4, 0.9);
    arc(g, a, b, 26, 'rgba(255,190,100,0.9)', [4, 4]);
    const [mx, my] = S.p(0, -2.2, 2.4);
    g.globalCompositeOperation = 'lighter';
    g.drawImage(softSprite('rgba(255,170,80,1)', 32, 0.2), mx - 18, my - 18, 36, 36);
    g.globalCompositeOperation = 'source-over';
    drawBomb(g, 'keg', mx, my + 7, 0.55, 0.3);
  },
  // after the last step: the machines take one stride down the street
  machines(g) {
    const S = new Mini(64, 64, 118);
    street(g, S, 0, 0.6, -4.4);
    street(g, S, 1.5, 0.6, -4.4);
    const pos = [[0, -1.0, 'scrap'], [1.5, -1.9, 'roach']];
    for (const [x, y, kind] of pos) {
      // where it was, faintly
      g.globalAlpha = 0.25;
      drawMachine(g, S, { kind, x, y: y - 1.6, z: -0.2, a: Math.PI / 2, t: 0.1, flash: 0, alpha: 0.35 });
      g.globalAlpha = 1;
      arrow(g, S.p(x, y - 1.3, -0.2), S.p(x, y - 0.35, -0.2), '#ffb648', 3);
      drawMachine(g, S, { kind, x, y, z: -0.2, a: Math.PI / 2, t: 0.3, flash: 0, alpha: 1, scale: 1.25 });
    }
  },
  // the gotcha: throw to where someone IS ...
  good(g) {
    const S = new Mini(76, 50, 76);
    for (let i = 0; i < 3; i++) tile(g, S, i, 0);
    eng(g, S, 0, 0, 0, AMBER, { pose: 'throw', poseK: 0.6 });
    arc(g, S.p(0.15, 0, 1.35), S.p(2, 0, 1.2), 24, 'rgba(255,214,130,0.95)');
    const [mx, my] = S.p(1.2, 0, 2.0);
    drawBomb(g, 'keg', mx, my + 8, 0.7, 0.3);
    eng(g, S, 2, 0, 0, TEAL, { pose: 'reach', poseK: 0.5, face: -1 });
    mark(g, VW - 22, 22, true);
  },
  // ... not where they are going: the bomb lands before they arrive
  bad(g) {
    const S = new Mini(70, 46, 68);
    for (let i = 0; i < 3; i++) tile(g, S, i, 0);
    tile(g, S, 2, 1);
    eng(g, S, 0, 0, 0, AMBER, { pose: 'throw', poseK: 0.6 });
    arc(g, S.p(0.15, 0, 1.35), S.p(2.15, 0.15, 0.1), 24, 'rgba(255,214,130,0.95)');
    const [bx, by] = S.p(2.15, 0.15, 0);
    g.fillStyle = 'rgba(200,190,170,0.5)';
    g.beginPath();
    g.ellipse(bx, by, 16, 7, 0, 0, TAU);
    g.fill();
    drawBomb(g, 'keg', bx, by, 0.65, 0.3);
    arrow(g, S.p(2, 1.25, 0.02), S.p(2, 0.6, 0.02), '#f4ead2', 3);
    eng(g, S, 2, 1.0, 0, TEAL, { walk: 0.6, face: -1 });
    mark(g, VW - 22, 22, false);
  },
};

const cache = new Map();

// the vignette `id` as a canvas (2× the logical VW × VH)
export function vignette(id) {
  let c = cache.get(id);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = VW * RES;
  c.height = VH * RES;
  const g = c.getContext('2d');
  g.scale(RES, RES);
  g.lineJoin = 'round';
  try {
    PANELS[id]?.(g);
  } catch (e) {
    console.error('vignette', id, e);
  }
  cache.set(id, c);
  return c;
}

// a copy of a vignette for placing in the DOM
export function vignetteEl(id, cls = '') {
  const src = vignette(id);
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.className = `cc-vig ${cls}`;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}
