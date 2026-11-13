// Entity drawing registry for the keep: one draw function per entity kind.
//
//   bombSprites[kind](g, x, y, s, t)      a bomb standing on (x, y) (bottom centre), scale s
//   drawEngineer(g, e)                     an engineer standing on (e.sx, e.sy)
//   drawCatapult(g, S, c)                  a catapult on its wall cell, arm angle c.phi
//   drawMachine(g, S, m)                   a machine on a lane (the tower defense's creatures,
//                                          laid on the ground plane of the iso view)
//
// Sprites are designed at a tile width of 130 logical px and scaled by S.k.

import { TAU, softSprite } from '../../tower_defense/tv/geom.js';
import { enemySprites } from '../../tower_defense/tv/sprites.js';

const circle = (g, x, y, r) => {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
};

// ---------------------------------------------------------------- bombs

function keg(g, x, y, s, t) {
  const w = 15 * s;
  const hgt = 30 * s;
  const top = y - hgt;
  // barrel body with bulging staves
  const gr = g.createLinearGradient(x - w, 0, x + w, 0);
  gr.addColorStop(0, '#4a2c12');
  gr.addColorStop(0.35, '#a8693a');
  gr.addColorStop(0.65, '#8a5228');
  gr.addColorStop(1, '#3a200c');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(x - w * 0.82, top + 3 * s);
  g.quadraticCurveTo(x - w * 1.12, y - hgt / 2, x - w * 0.82, y - 3 * s);
  g.ellipse(x, y - 3 * s, w * 0.82, 4.5 * s, 0, Math.PI, 0, true);
  g.quadraticCurveTo(x + w * 1.12, y - hgt / 2, x + w * 0.82, top + 3 * s);
  g.closePath();
  g.fill();
  g.lineWidth = 1.5 * s;
  g.strokeStyle = '#1e1006';
  g.stroke();
  // staves
  g.strokeStyle = 'rgba(30,15,4,0.5)';
  g.lineWidth = 1 * s;
  for (const o of [-0.45, 0, 0.45]) {
    g.beginPath();
    g.moveTo(x + o * w * 0.8, top + 4 * s);
    g.quadraticCurveTo(x + o * w * 1.1, y - hgt / 2, x + o * w * 0.8, y - 2 * s);
    g.stroke();
  }
  // iron hoops
  g.strokeStyle = '#2b2a28';
  g.lineWidth = 3 * s;
  for (const k of [0.22, 0.78]) {
    const yy = top + hgt * k;
    g.beginPath();
    g.ellipse(x, yy, w * 0.98, 4 * s, 0, 0, Math.PI);
    g.stroke();
  }
  // red powder band with a white skull-ish cross
  g.strokeStyle = '#b8281a';
  g.lineWidth = 5 * s;
  g.beginPath();
  g.ellipse(x, top + hgt * 0.5, w * 1.04, 4.4 * s, 0, 0.1, Math.PI - 0.1);
  g.stroke();
  // lid
  g.fillStyle = '#b97a44';
  g.beginPath();
  g.ellipse(x, top + 3 * s, w * 0.82, 4.5 * s, 0, 0, TAU);
  g.fill();
  g.strokeStyle = '#1e1006';
  g.lineWidth = 1.5 * s;
  g.stroke();
  // fuse with a spark
  g.strokeStyle = '#2a1c05';
  g.lineWidth = 2.2 * s;
  g.beginPath();
  g.moveTo(x + 2 * s, top + 3 * s);
  g.quadraticCurveTo(x + 6 * s, top - 6 * s, x + 10 * s, top - 7 * s);
  g.stroke();
  const fl = 0.7 + 0.3 * Math.sin(t * 23);
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = fl;
  g.drawImage(softSprite('rgba(255,180,60,1)', 32, 0.15), x + 10 * s - 9 * s, top - 7 * s - 9 * s, 18 * s, 18 * s);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#fff3c0';
  circle(g, x + 10 * s, top - 7 * s, 2 * s);
  g.fill();
}

function grapeshot(g, x, y, s, t) {
  // a cluster of iron balls in a rope net, copper cap and fuse on top
  const balls = [
    [-9, -6], [0, -5], [9, -6],
    [-5, -14], [5, -14],
    [-9, -20], [0, -22], [9, -20],
    [0, -29],
  ];
  for (const [bx, by] of balls) {
    const cx = x + bx * s;
    const cy = y + by * s - 2 * s;
    const r = 6.6 * s;
    const gr = g.createRadialGradient(cx - r * 0.4, cy - r * 0.4, r * 0.1, cx, cy, r);
    gr.addColorStop(0, '#9aa6ad');
    gr.addColorStop(0.5, '#4a5258');
    gr.addColorStop(1, '#1c2124');
    g.fillStyle = gr;
    circle(g, cx, cy, r);
    g.fill();
    g.lineWidth = 1 * s;
    g.strokeStyle = '#0c0f10';
    g.stroke();
  }
  // net cords
  g.strokeStyle = 'rgba(214,190,140,0.75)';
  g.lineWidth = 1.4 * s;
  g.beginPath();
  for (const k of [-1, 1]) {
    g.moveTo(x, y - 33 * s);
    g.quadraticCurveTo(x + k * 18 * s, y - 18 * s, x + k * 6 * s, y);
    g.moveTo(x, y - 33 * s);
    g.quadraticCurveTo(x + k * 8 * s, y - 18 * s, x + k * 1 * s, y);
  }
  g.stroke();
  // copper cap
  g.fillStyle = '#d1794a';
  g.beginPath();
  g.ellipse(x, y - 34 * s, 6 * s, 3 * s, 0, 0, TAU);
  g.fill();
  g.strokeStyle = '#4a2412';
  g.lineWidth = 1.2 * s;
  g.stroke();
  // fuse
  g.strokeStyle = '#2a1c05';
  g.lineWidth = 2 * s;
  g.beginPath();
  g.moveTo(x, y - 35 * s);
  g.quadraticCurveTo(x - 4 * s, y - 42 * s, x - 8 * s, y - 42 * s);
  g.stroke();
  const fl = 0.7 + 0.3 * Math.sin(t * 19 + 1);
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = fl;
  g.drawImage(softSprite('rgba(255,180,60,1)', 32, 0.15), x - 16 * s, y - 50 * s, 16 * s, 16 * s);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

function stopwatch(g, x, y, s, t) {
  // a big brass pocket watch standing on its rim, with an icy face
  const r = 15 * s;
  const cx = x;
  const cy = y - r - 1 * s;
  // cold glow
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.45 + 0.2 * Math.sin(t * 4);
  g.drawImage(softSprite('rgba(110,200,255,1)', 64, 0.2), cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // crown and ring
  g.fillStyle = '#b88a34';
  g.fillRect(cx - 3 * s, cy - r - 6 * s, 6 * s, 6 * s);
  g.lineWidth = 2.5 * s;
  g.strokeStyle = '#d9b25a';
  g.beginPath();
  g.arc(cx, cy - r - 9 * s, 4.5 * s, 0, TAU);
  g.stroke();
  // case
  const gr = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  gr.addColorStop(0, '#fff1c2');
  gr.addColorStop(0.4, '#d9b25a');
  gr.addColorStop(1, '#6e5120');
  g.fillStyle = gr;
  circle(g, cx, cy, r);
  g.fill();
  g.lineWidth = 1.5 * s;
  g.strokeStyle = '#3a2a0c';
  g.stroke();
  // face
  const fg = g.createRadialGradient(cx - 3 * s, cy - 3 * s, 1, cx, cy, r * 0.78);
  fg.addColorStop(0, '#ffffff');
  fg.addColorStop(1, '#bfe6ff');
  g.fillStyle = fg;
  circle(g, cx, cy, r * 0.76);
  g.fill();
  g.strokeStyle = '#2a4a66';
  g.lineWidth = 1.2 * s;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6);
    g.lineTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
    g.stroke();
  }
  // hands (the minute hand ticks)
  const tick = Math.floor(t * 2) / 2;
  g.lineCap = 'round';
  g.strokeStyle = '#13283a';
  g.lineWidth = 2 * s;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(tick * 1.2 - 1.5) * r * 0.55, cy + Math.sin(tick * 1.2 - 1.5) * r * 0.55);
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(-0.6) * r * 0.36, cy + Math.sin(-0.6) * r * 0.36);
  g.stroke();
  g.lineCap = 'butt';
  g.fillStyle = '#b8281a';
  circle(g, cx, cy, 1.8 * s);
  g.fill();
}

export const bombSprites = { keg, grapeshot, stopwatch, _default: keg };

export function drawBomb(g, kind, x, y, s, t) {
  (bombSprites[kind] || bombSprites._default)(g, x, y, s, t);
}

// ---------------------------------------------------------------- engineers

const SKIN = '#e6bd92';

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// e = { sx, sy, k, color, face (+1 right, -1 left), walk (0..1 phase or -1), carry (kind|null),
//       pose: 'idle'|'throw'|'reach'|'sit', poseK (0..1), t (seconds), dim }
export function drawEngineer(g, e) {
  const { sx, sy, k, color } = e;
  const f = e.face < 0 ? -1 : 1;
  const sit = e.pose === 'sit';
  g.save();
  g.translate(sx, sy);
  // shadow
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.ellipse(0, 0, 22 * k, 9 * k, 0, 0, TAU);
  g.fill();
  g.scale(k * f, k);
  if (e.dim) g.globalAlpha = 0.72;
  const bob = e.walk >= 0 ? -Math.abs(Math.sin(e.walk * Math.PI * 2)) * 3 : Math.sin(e.t * 2.2) * 0.8;
  const lift = sit ? 14 : 0;
  g.translate(0, bob + lift);
  const coat = color;
  const coatD = shade(color, 0.62);
  const coatL = shade(color, 1.25);

  // legs
  const sw = e.walk >= 0 ? Math.sin(e.walk * Math.PI * 2) * 7 : 0;
  g.lineCap = 'round';
  g.strokeStyle = '#2b2620';
  g.lineWidth = 7;
  if (sit) {
    g.beginPath();
    g.moveTo(-5, -18);
    g.lineTo(8, -12);
    g.lineTo(9, -2);
    g.moveTo(4, -18);
    g.lineTo(16, -12);
    g.lineTo(17, -2);
    g.stroke();
  } else {
    g.beginPath();
    g.moveTo(-5, -22);
    g.lineTo(-5 + sw, -4);
    g.moveTo(5, -22);
    g.lineTo(5 - sw, -4);
    g.stroke();
    // boots
    g.fillStyle = '#1a1612';
    g.beginPath();
    g.ellipse(-3 + sw, -3, 6, 3.5, 0, 0, TAU);
    g.ellipse(7 - sw, -3, 6, 3.5, 0, 0, TAU);
    g.fill();
  }

  // reach/throw lean
  let lean = 0;
  if (e.pose === 'reach') lean = Math.sin(Math.min(1, e.poseK) * Math.PI) * 0.35;
  if (e.pose === 'throw') lean = Math.sin(Math.min(1, e.poseK) * Math.PI) * 0.25;
  g.translate(0, -20);
  g.rotate(lean);

  // coat (tails + body)
  const gr = g.createLinearGradient(-15, 0, 15, 0);
  gr.addColorStop(0, coatL);
  gr.addColorStop(0.55, coat);
  gr.addColorStop(1, coatD);
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(-14, 4);
  g.lineTo(-11, -34);
  g.quadraticCurveTo(0, -40, 11, -34);
  g.lineTo(14, 4);
  g.lineTo(3, 0);
  g.lineTo(0, 6);
  g.lineTo(-3, 0);
  g.closePath();
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(10,8,6,0.85)';
  g.stroke();
  // lapels + buttons
  g.strokeStyle = coatD;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-5, -34);
  g.lineTo(0, -18);
  g.lineTo(5, -34);
  g.stroke();
  g.fillStyle = '#f0d48a';
  for (const by of [-14, -8]) {
    circle(g, 3.5, by, 1.6);
    g.fill();
  }
  // belt with brass buckle
  g.fillStyle = '#2a1c10';
  g.fillRect(-12.5, -6, 25, 4.5);
  g.fillStyle = '#d9b25a';
  g.fillRect(-3, -6.5, 6, 5.5);

  // arms
  const arm = (x0, y0, x1, y1) => {
    g.strokeStyle = coatD;
    g.lineWidth = 6.5;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.fillStyle = SKIN;
    circle(g, x1, y1, 3.6);
    g.fill();
  };
  const carrying = !!e.carry;
  if (carrying) {
    arm(-10, -31, -9, -56);
    arm(10, -31, 9, -56);
  } else if (e.pose === 'throw') {
    const a = -2.6 + Math.min(1, e.poseK) * 2.4;
    arm(-10, -31, -12, -12);
    arm(10, -31, 10 + Math.cos(a) * 18, -31 + Math.sin(a) * 18);
  } else if (e.pose === 'reach') {
    const r = Math.sin(Math.min(1, e.poseK) * Math.PI);
    arm(-10, -31, -14, -12);
    arm(10, -31, 14 + r * 12, -18 + r * 6);
  } else if (sit) {
    arm(-10, -31, -4, -12);
    arm(10, -31, 12, -12);
  } else {
    const s2 = e.walk >= 0 ? Math.sin(e.walk * Math.PI * 2) * 5 : 0;
    arm(-10, -31, -13 - s2, -11);
    arm(10, -31, 13 + s2, -11);
  }

  // head
  g.fillStyle = SKIN;
  circle(g, 0, -45, 10);
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = '#3a2410';
  g.stroke();
  // whiskers/beard shadow
  g.fillStyle = 'rgba(90,60,30,0.35)';
  g.beginPath();
  g.ellipse(2, -38, 6, 3, 0, 0, TAU);
  g.fill();
  // goggles on the forehead
  g.fillStyle = '#6e5120';
  g.fillRect(-10, -51, 20, 4);
  for (const gx of [-3.5, 4.5]) {
    g.fillStyle = '#d9b25a';
    circle(g, gx, -49, 4.4);
    g.fill();
    g.fillStyle = '#7fd0e8';
    circle(g, gx, -49, 2.6);
    g.fill();
  }
  // eye
  g.fillStyle = '#1a1208';
  circle(g, 5, -43.5, 1.4);
  g.fill();
  // cap with a coloured band
  g.fillStyle = '#2a2622';
  g.beginPath();
  g.ellipse(0, -54, 12, 3.5, 0, 0, TAU);
  g.fill();
  g.fillRect(-8, -66, 16, 12);
  g.fillStyle = coat;
  g.fillRect(-8, -59, 16, 4);
  g.fillStyle = '#3a3530';
  g.beginPath();
  g.ellipse(0, -66, 8, 2.5, 0, 0, TAU);
  g.fill();

  if (carrying) drawBomb(g, e.carry, 0, -55, 0.95, e.t);
  g.restore();
}

// little stars circling a bumped engineer's head (k = 1 → 0 fading)
export function drawStars(g, x, y, k, t, s) {
  for (let i = 0; i < 4; i++) {
    const a = t * 7 + (i / 4) * TAU;
    const px = x + Math.cos(a) * 22 * s;
    const py = y + Math.sin(a) * 7 * s;
    g.globalAlpha = Math.min(1, k * 1.6);
    star(g, px, py, 6 * s, '#ffe27a');
  }
  g.globalAlpha = 1;
}

export function star(g, x, y, r, col) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 1.2;
  g.strokeStyle = 'rgba(60,40,0,0.9)';
  g.stroke();
}

// ---------------------------------------------------------------- catapults

// c = { x, y, dir: [dx, dy] (lane direction), phi (arm angle), kind (loaded bomb|null), t, hot }
// phi: 0 = arm horizontal pointing back into the keep, PI/2 = up, PI = toward the lane.
export function drawCatapult(g, S, c) {
  const { x, y, dir } = c;
  const z0 = 1;
  const P = (u, v, z) => S.p(x + dir[0] * u - dir[1] * v, y + dir[1] * u + dir[0] * v, z);
  const k = S.k;
  // boiler behind (toward the lane side)
  const [bx, by] = P(0.22, 0.26, z0);
  const [, bt] = P(0.22, 0.26, z0 + 1.1);
  const rw = 16 * k;
  const gr = g.createLinearGradient(bx - rw, 0, bx + rw, 0);
  gr.addColorStop(0, '#5a2e18');
  gr.addColorStop(0.4, '#d1794a');
  gr.addColorStop(1, '#4a2412');
  g.fillStyle = gr;
  g.fillRect(bx - rw, bt, rw * 2, by - bt);
  g.beginPath();
  g.ellipse(bx, by, rw, rw * 0.5, 0, 0, Math.PI);
  g.fill();
  g.fillStyle = '#e09a6a';
  g.beginPath();
  g.ellipse(bx, bt, rw, rw * 0.5, 0, 0, TAU);
  g.fill();
  g.strokeStyle = '#2a1408';
  g.lineWidth = 1.5;
  g.stroke();
  g.strokeStyle = '#d9b25a';
  g.lineWidth = 2.5 * k;
  g.beginPath();
  g.ellipse(bx, bt + (by - bt) * 0.5, rw, rw * 0.5, 0, 0, Math.PI);
  g.stroke();
  // chimney
  g.fillStyle = '#2b2a28';
  g.fillRect(bx - 3 * k, bt - 16 * k, 6 * k, 16 * k);

  // A-frame uprights either side of the arm
  const pz = z0 + 0.74;
  for (const v of [-0.32, 0.32]) {
    const [a0, a1] = P(-0.22, v, z0);
    const [b0, b1] = P(0.18, v, z0);
    const [t0, t1] = P(0, v, pz);
    g.strokeStyle = '#3a2410';
    g.lineWidth = 7 * k;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(a0, a1);
    g.lineTo(t0, t1);
    g.lineTo(b0, b1);
    g.stroke();
    g.strokeStyle = '#7a5530';
    g.lineWidth = 3 * k;
    g.stroke();
  }
  // axle
  const [ax0, ay0] = P(0, -0.32, pz);
  const [ax1, ay1] = P(0, 0.32, pz);
  g.strokeStyle = '#2b2a28';
  g.lineWidth = 4 * k;
  g.beginPath();
  g.moveTo(ax0, ay0);
  g.lineTo(ax1, ay1);
  g.stroke();

  // arm: pivot at (0, 0, pz); bucket at R toward phi; counterweight opposite
  const R = 0.8;
  const phi = c.phi;
  const bu = -Math.cos(phi) * R;
  const bz = pz + Math.sin(phi) * R;
  const cu = Math.cos(phi) * R * 0.38;
  const cz = pz - Math.sin(phi) * R * 0.38;
  const [p0, p1] = P(0, 0, pz);
  const [q0, q1] = P(bu, 0, bz);
  const [w0, w1] = P(cu, 0, cz);
  g.strokeStyle = '#2a1808';
  g.lineWidth = 7 * k;
  g.beginPath();
  g.moveTo(w0, w1);
  g.lineTo(q0, q1);
  g.stroke();
  g.strokeStyle = '#9a6a3a';
  g.lineWidth = 4 * k;
  g.stroke();
  g.lineCap = 'butt';
  // counterweight block
  g.fillStyle = '#3d3a36';
  g.fillRect(w0 - 8 * k, w1 - 6 * k, 16 * k, 12 * k);
  g.strokeStyle = '#111';
  g.lineWidth = 1.2;
  g.strokeRect(w0 - 8 * k, w1 - 6 * k, 16 * k, 12 * k);
  // brass pivot cap
  g.fillStyle = '#d9b25a';
  circle(g, p0, p1, 4 * k);
  g.fill();
  // bucket
  g.fillStyle = '#2f2c28';
  g.beginPath();
  g.ellipse(q0, q1, 15 * k, 8.5 * k, 0, 0, TAU);
  g.fill();
  g.strokeStyle = '#8a8d90';
  g.lineWidth = 2 * k;
  g.stroke();
  if (c.kind) drawBomb(g, c.kind, q0, q1 + 5 * k, 0.95 * k, c.t);
  // loaded: a warm halo so a ready catapult reads from the sofa
  if (c.kind) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.25 + 0.12 * Math.sin(c.t * 3);
    g.drawImage(softSprite('rgba(255,200,110,1)', 64, 0.2), q0 - 34 * k, q1 - 40 * k, 68 * k, 68 * k);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}

// ---------------------------------------------------------------- machines

// The tower defense draws its creatures top-down, facing +x, around a radius r (px). Here each
// is laid along its lane's direction on screen, seen from above at a steep angle (squashed
// across), raised a little over a dark underside so it reads as a body, not a decal.
export const MACHINE_R = { scrap: 20, roach: 15, brute: 29, baron: 46 }; // TD radius x its visual scale
export const MACHINE_CELLS = { scrap: 0.36, roach: 0.3, brute: 0.46, baron: 0.6 }; // radius in cells
const SQUASH = 0.72;

// screen frame for a machine at grid (x, y, z) heading a (grid radians): [hx, hy, nx, ny] unit vectors
function frame(S, x, y, z, a) {
  const [x0, y0] = S.p(x, y, z);
  const [x1, y1] = S.p(x + Math.cos(a), y + Math.sin(a), z);
  const L = Math.hypot(x1 - x0, y1 - y0) || 1;
  const hx = (x1 - x0) / L;
  const hy = (y1 - y0) / L;
  return [x0, y0, hx, hy, -hy, hx];
}

function sized(S, kind, scale = 1) {
  const r = MACHINE_R[kind] || 20;
  const cells = (MACHINE_CELLS[kind] || 0.34) * scale;
  return { r, cells, px: cells * S.TW * 0.62, s: (cells * S.TW * 0.62) / r };
}

// The sprite is rendered into a small scratch canvas first, so the dark underside and the
// incoming silhouettes are a cheap 'source-atop' fill instead of a canvas filter (filters are
// very slow on software-rendered canvases).
const scratch = { a: null, b: null };
function spriteTo(S, kind, r, t, dark) {
  const q = Math.max(0.6, Math.min(4, (sized(S, kind).s * (S.px || 1)) * 1.25));
  const half = Math.ceil(r * (kind === 'baron' ? 3 : 2.2));
  const n = Math.ceil(half * 2 * q);
  if (!scratch.a) {
    scratch.a = document.createElement('canvas');
    scratch.b = document.createElement('canvas');
  }
  const A = scratch.a;
  const B = scratch.b;
  for (const c of [A, B]) {
    if (c.width < n) c.width = c.height = n;
  }
  const ga = A.getContext('2d');
  ga.setTransform(1, 0, 0, 1, 0, 0);
  ga.clearRect(0, 0, n, n);
  ga.setTransform(q, 0, 0, q, half * q, half * q);
  (enemySprites[kind] || enemySprites._default)(ga, { x: 0, y: 0, a: 0, r, t, hp: 1, flags: 0, def: {}, flash: 0 });
  let gb = null;
  if (dark !== undefined) {
    gb = B.getContext('2d');
    gb.setTransform(1, 0, 0, 1, 0, 0);
    gb.globalCompositeOperation = 'source-over';
    gb.clearRect(0, 0, n, n);
    gb.drawImage(A, 0, 0);
    gb.globalCompositeOperation = 'source-atop';
    gb.fillStyle = dark;
    gb.fillRect(0, 0, n, n);
    gb.globalCompositeOperation = 'source-over';
  }
  return { n, half, q };
}

// m = { kind, x, y (grid), z, a (heading, grid radians), t, flash, alpha, scale }
export function drawMachine(g, S, m) {
  const { r, px, s } = sized(S, m.kind, m.scale);
  const lift = 9 * S.k + px * 0.12;
  const [sx, sy, hx, hy, nx, ny] = frame(S, m.x, m.y, m.z, m.a);
  const alpha = m.alpha ?? 1;
  // shadow
  g.globalAlpha = alpha;
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  g.ellipse(sx, sy + 2 * S.k, px * 1.05, px * 0.5, 0, 0, TAU);
  g.fill();
  const { n, half, q } = spriteTo(S, m.kind, r, m.t, 'rgba(12,10,8,0.82)');
  // dark underside, a little lower, then the body
  for (const [img, dy] of [[scratch.b, lift * 0.35], [scratch.a, lift]]) {
    g.save();
    g.transform(hx * s, hy * s, nx * s * SQUASH, ny * s * SQUASH, sx, sy - dy);
    g.drawImage(img, 0, 0, n, n, -half, -half, n / q, n / q);
    g.restore();
  }
  g.globalAlpha = 1;
  if (m.flash > 0) {
    const rr = px * 1.9;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(1, m.flash);
    g.drawImage(softSprite('rgba(255,240,210,1)', 64, 0.35), sx - rr, sy - lift - rr * 0.8, rr * 2, rr * 1.6);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  return sy - lift - px; // top of the sprite on screen
}

// an incoming arrival: the same creature as a dark, pulsing silhouette with an amber ring
export function drawMachineShadow(g, S, m) {
  const { r, px, s } = sized(S, m.kind);
  const [sx, sy, hx, hy, nx, ny] = frame(S, m.x, m.y, m.z, m.a);
  const a = m.alpha ?? 0.5;
  g.save();
  g.globalAlpha = Math.min(1, a * 1.1);
  g.drawImage(softSprite('rgba(255,170,70,1)', 64, 0.2), sx - px * 1.6, sy - px * 1.1, px * 3.2, px * 1.8);
  g.globalAlpha = Math.min(1, a * 1.6);
  g.setLineDash([8 * S.k, 6 * S.k]);
  g.lineDashOffset = -m.t * 20;
  g.lineWidth = 3 * S.k;
  g.strokeStyle = 'rgba(255,182,72,0.95)';
  g.beginPath();
  g.ellipse(sx, sy, px * 1.25, px * 0.62, 0, 0, TAU);
  g.stroke();
  g.setLineDash([]);
  const { n, half, q } = spriteTo(S, m.kind, r, m.t, 'rgb(70,26,12)');
  g.transform(hx * s, hy * s, nx * s * SQUASH, ny * s * SQUASH, sx, sy - 8 * S.k);
  g.globalAlpha = Math.min(1, a * 1.5);
  g.drawImage(scratch.b, 0, 0, n, n, -half, -half, n / q, n / q);
  g.restore();
}

// ---------------------------------------------------------------- small icons (HUD / ghosts)

export function drawIcon(g, kind, x, y, s, col) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = col;
  g.fillStyle = col;
  switch (kind) {
    case 'wait': {
      // hourglass
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(-8, -11);
      g.lineTo(8, -11);
      g.lineTo(-8, 11);
      g.lineTo(8, 11);
      g.closePath();
      g.stroke();
      g.beginPath();
      g.moveTo(-4, 8);
      g.lineTo(4, 8);
      g.lineTo(0, 3);
      g.closePath();
      g.fill();
      break;
    }
    case 'pickup': {
      // open hand / grabbing claw
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(-9, -2);
      g.quadraticCurveTo(-9, 10, 0, 10);
      g.quadraticCurveTo(9, 10, 9, -2);
      g.stroke();
      for (const fx of [-6, -1, 4]) {
        g.beginPath();
        g.moveTo(fx, -1);
        g.lineTo(fx + 1, -11);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(9, -2);
      g.lineTo(12, -8);
      g.stroke();
      break;
    }
    case 'load': {
      // arrow down into a bucket
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(0, -12);
      g.lineTo(0, 2);
      g.moveTo(-6, -4);
      g.lineTo(0, 2);
      g.lineTo(6, -4);
      g.stroke();
      g.beginPath();
      g.moveTo(-10, 4);
      g.lineTo(-7, 11);
      g.lineTo(7, 11);
      g.lineTo(10, 4);
      g.stroke();
      break;
    }
    case 'fire': {
      // burst
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const rr = i % 2 ? 6 : 13;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.fillStyle = '#fff3c0';
      circle(g, 0, 0, 4);
      g.fill();
      break;
    }
    case 'throw': {
      g.lineWidth = 3;
      g.beginPath();
      g.arc(0, 8, 12, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
      break;
    }
  }
  g.restore();
}
