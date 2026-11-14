// Entity drawing registry for the keep: one draw function per entity kind.
//
//   bombSprites[kind](g, x, y, s, t)      a bomb standing on (x, y) (bottom centre), scale s
//   drawEngineer(g, e)                     an engineer standing on (e.sx, e.sy)
//   drawCatapult(g, S, c)                  a catapult on its wall cell, arm angle c.phi
//   drawMachine(g, S, m)                   a clockwork machine standing on a lane ring
//
// Sprites are designed at a tile width of 130 logical px and scaled by S.k.

import { TAU, softSprite } from '../../tower_defense/tv/geom.js';

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
  if (e.ring) {
    // a ring in the player's colour under the feet, matching their card in the queue strip
    g.beginPath();
    g.ellipse(0, 0, 25 * k, 11 * k, 0, 0, TAU);
    g.lineWidth = 7 * k;
    g.strokeStyle = 'rgba(20,14,8,0.85)';
    g.stroke();
    g.lineWidth = 4 * k;
    g.strokeStyle = color;
    g.stroke();
  }
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
  const k = S.k;
  // local frame: u along the lane (outward), v across it, z up
  const SC = 1.3; // drawn larger than its cell: it is the star of the wall
  const P = (u, v, z) => S.p(x + (dir[0] * u - dir[1] * v) * SC, y + (dir[1] * u + dir[0] * v) * SC, z);
  const near = -dir[1] + dir[0] > 0 ? 1 : -1; // which v side faces the camera
  const beam = (a, b, w, col, dark = '#24140a') => {
    g.lineCap = 'round';
    g.strokeStyle = dark;
    g.lineWidth = w + 3;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
    g.strokeStyle = col;
    g.lineWidth = w;
    g.stroke();
    g.strokeStyle = 'rgba(255,230,180,0.25)';
    g.lineWidth = Math.max(1, w * 0.25);
    g.stroke();
  };
  const pz = z0 + SC * 1.0; // pivot height
  const side = (v) => {
    // sled runner, A-frame and brass caps on one side
    beam(P(-0.46, v, z0 + SC * 0.07), P(0.46, v, z0 + SC * 0.07), 11 * k, '#9a4426');
    beam(P(-0.38, v, z0 + SC * 0.1), P(0, v, pz), 10 * k, '#b8582c');
    beam(P(0.38, v, z0 + SC * 0.1), P(0, v, pz), 10 * k, '#b8582c');
    beam(P(-0.19, v, z0 + SC * 0.5), P(0.19, v, z0 + SC * 0.5), 6 * k, '#9a4426');
    const cap = P(0, v, pz);
    g.fillStyle = '#d9b25a';
    g.beginPath();
    g.arc(cap[0], cap[1], 5.5 * k, 0, TAU);
    g.fill();
    g.strokeStyle = '#3a2a0c';
    g.lineWidth = 1.5;
    g.stroke();
  };
  // a gear wheel standing in the u-z plane at v
  const gear = (u, v, z, rr, teeth, rot) => {
    g.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const an = rot + (i / (teeth * 2)) * TAU;
      const r2 = i % 2 ? rr * 0.82 : rr;
      const q = P(u + Math.cos(an) * r2, v, z + (SC * Math.sin(an) * r2) / 0.62);
      if (i) g.lineTo(q[0], q[1]);
      else g.moveTo(q[0], q[1]);
    }
    g.closePath();
    g.fillStyle = '#b88a34';
    g.fill();
    g.strokeStyle = '#3a2a0c';
    g.lineWidth = 1.6;
    g.stroke();
    const hub = P(u, v, z);
    g.fillStyle = '#5a4520';
    g.beginPath();
    g.arc(hub[0], hub[1], rr * S.TW * 0.22, 0, TAU);
    g.fill();
  };
  const vFar = -0.32 * near;
  const vNear = 0.32 * near;

  // shadow on the deck
  const sc = P(0, 0, z0);
  g.fillStyle = 'rgba(20,10,2,0.35)';
  g.beginPath();
  g.ellipse(sc[0], sc[1], S.TW * 0.42, S.TH * 0.42, 0, 0, TAU);
  g.fill();
  // cross beams of the sled
  beam(P(-0.4, -0.34, z0 + SC * 0.06), P(-0.4, 0.34, z0 + SC * 0.06), 7 * k, '#6e2e18');
  beam(P(0.4, -0.34, z0 + SC * 0.06), P(0.4, 0.34, z0 + SC * 0.06), 7 * k, '#6e2e18');
  side(vFar);
  // winch drum between the runners at the keep end, with its rope up to the arm
  beam(P(-0.3, -0.3, z0 + SC * 0.2), P(-0.3, 0.3, z0 + SC * 0.2), 11 * k, '#5a2614');
  g.strokeStyle = 'rgba(200,170,110,0.6)';
  g.lineWidth = 2 * k;
  for (let i = -2; i <= 2; i++) {
    const a = P(-0.3, i * 0.1, z0 + SC * 0.15);
    const b = P(-0.3, i * 0.1, z0 + SC * 0.25);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  }

  // the arm: pivot at (0, 0, pz); bucket at R toward phi; counterweight opposite
  const R = 1.1;
  const phi = c.phi;
  const bu = -Math.cos(phi) * R;
  const bz = pz + (SC * Math.sin(phi) * R) / 0.62;
  const cu = Math.cos(phi) * R * 0.32;
  const cz = pz - (SC * Math.sin(phi) * R * 0.32) / 0.62;
  const piv = P(0, 0, pz);
  const q = P(bu, 0, bz);
  const w = P(cu, 0, cz);
  // rope from the winch to the arm (taut when cocked)
  const rp = P(bu * 0.45, 0, pz + (bz - pz) * 0.45);
  const wd = P(-0.3, 0, z0 + SC * 0.22);
  // armed: the rope is drawn taut and bright
  g.strokeStyle = c.kind ? '#f0d48a' : '#a88a5a';
  g.lineWidth = (c.kind ? 3 : 2) * k;
  g.beginPath();
  g.moveTo(wd[0], wd[1]);
  g.lineTo(rp[0], rp[1]);
  g.stroke();
  // axle
  beam(P(0, -0.36, pz), P(0, 0.36, pz), 5 * k, '#3a3632', '#111');
  beam(w, q, 13 * k, '#c4643a');
  // iron bands on the arm
  g.strokeStyle = '#2b2a28';
  g.lineWidth = 3 * k;
  for (const t of [0.35, 0.7]) {
    const bx = w[0] + (q[0] - w[0]) * t;
    const by = w[1] + (q[1] - w[1]) * t;
    const an = Math.atan2(q[1] - w[1], q[0] - w[0]) + Math.PI / 2;
    g.beginPath();
    g.moveTo(bx + Math.cos(an) * 7 * k, by + Math.sin(an) * 7 * k);
    g.lineTo(bx - Math.cos(an) * 7 * k, by - Math.sin(an) * 7 * k);
    g.stroke();
  }
  // counterweight: an iron block with rivets
  g.fillStyle = '#3d3a36';
  g.strokeStyle = '#111';
  g.lineWidth = 1.5;
  g.beginPath();
  g.rect(w[0] - 13 * k, w[1] - 9 * k, 26 * k, 20 * k);
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(w[0] - 13 * k, w[1] - 9 * k, 26 * k, 4 * k);
  g.fillStyle = '#d9b25a';
  for (const [a, b] of [[-9, -5], [9, -5], [-9, 7], [9, 7]]) {
    g.beginPath();
    g.arc(w[0] + a * k, w[1] + b * k, 1.8 * k, 0, TAU);
    g.fill();
  }
  // pivot hub
  g.fillStyle = '#d9b25a';
  g.beginPath();
  g.arc(piv[0], piv[1], 6 * k, 0, TAU);
  g.fill();
  g.strokeStyle = '#3a2a0c';
  g.stroke();
  // the bucket: an iron cup on the end of the arm
  const bw = 23 * k;
  g.fillStyle = '#2b2a28';
  g.beginPath();
  g.moveTo(q[0] - bw, q[1]);
  g.quadraticCurveTo(q[0], q[1] + bw * 1.25, q[0] + bw, q[1]);
  g.closePath();
  g.fill();
  g.strokeStyle = '#8a8d90';
  g.lineWidth = 2 * k;
  g.stroke();
  g.fillStyle = c.kind ? '#2a2420' : '#4a4540';
  g.beginPath();
  g.ellipse(q[0], q[1], bw, bw * 0.45, 0, 0, TAU);
  g.fill();
  g.strokeStyle = '#a9adb0';
  g.lineWidth = 2.5 * k;
  g.stroke();
  if (c.kind) {
    // loaded: the bomb sits in the bucket, glowing
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.35 + 0.15 * Math.sin(c.t * 3);
    g.drawImage(softSprite('rgba(255,190,90,1)', 64, 0.2), q[0] - 46 * k, q[1] - 56 * k, 92 * k, 92 * k);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    drawBomb(g, c.kind, q[0], q[1] + 6 * k, 1.05 * k, c.t);
    // a pulsing ring: armed and waiting for something to come down the lane
    const pr = 0.5 + 0.5 * Math.sin(c.t * 4);
    g.strokeStyle = `rgba(255,${180 + Math.round(pr * 50)},80,${0.55 + 0.4 * pr})`;
    g.lineWidth = 3 * k;
    g.beginPath();
    g.ellipse(q[0], q[1] - 4 * k, bw * (1.35 + pr * 0.2), bw * (0.75 + pr * 0.1), 0, 0, TAU);
    g.stroke();
  }
  side(vNear);
  gear(-0.26, vNear * 1.1, z0 + SC * 0.3, 0.24, 12, (c.phi || 0) * 2);
}

// ---------------------------------------------------------------- machines

// Clockwork machines standing upright on their lane rings, in the same view as the engineers:
// drawn in screen space around their foot point, facing the keep, with a ground shadow.
// Designed at TW = 130 (like the engineers), from the little Scrapling to the Iron Baron.
//   drawMachine(g, S, m)        m = { kind, x, y (grid), z, a (heading toward the keep, grid
//                               radians), t, walk (0..1), flash, alpha, frozen }
//   drawMachineShadow(g, S, m)  a machine arriving next turn: a pulsing ghost on its ring
export const MACHINE_CELLS = { scrap: 0.36, roach: 0.42, brute: 0.52, baron: 0.68 }; // footprint radius in cells
const MACHINE_K = { scrap: 1.3, roach: 1.5, brute: 1.3, baron: 1.25 }; // drawn size (engineers are 1.3)

const OUTLINE = '#21170e';

function hexRGB(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixer(m) {
  if (m.ghost) return () => m.ghost;
  const fl = Math.max(0, Math.min(1, m.flash || 0));
  const fr = m.frozen > 0 ? 0.38 : 0;
  if (!fl && !fr) return (c) => c;
  return (c) => {
    let [r, g, b] = hexRGB(c);
    if (fr) {
      r += (168 - r) * fr;
      g += (220 - g) * fr;
      b += (255 - b) * fr;
    }
    r += (255 - r) * fl;
    g += (255 - g) * fl;
    b += (255 - b) * fl;
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  };
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function fillOut(g, col, lw = 2.4) {
  g.fillStyle = col;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = g._out;
  g.stroke();
}

function limb(g, x0, y0, x1, y1, w, col) {
  g.lineCap = 'round';
  g.strokeStyle = g._out;
  g.lineWidth = w + 4;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = col;
  g.lineWidth = w;
  g.stroke();
}

function dot(g, x, y, r, col, out = true) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  if (out) fillOut(g, col, 2);
  else {
    g.fillStyle = col;
    g.fill();
  }
}

// a tin-can walker: one big lamp eye, an antenna with a red bulb, a pincer
function paintScrap(g, C, t, walk) {
  const ph = Math.sin(t * 9) * 6 * walk;
  limb(g, -6, -16, -7 + ph, -2, 5, C('#4b4d55'));
  limb(g, 6, -16, 7 - ph, -2, 5, C('#5b5e66'));
  g.beginPath();
  g.ellipse(-6 + ph, -1, 6, 3, 0, 0, TAU);
  fillOut(g, C('#3a3c42'), 2);
  g.beginPath();
  g.ellipse(8 - ph, -1, 6, 3, 0, 0, TAU);
  fillOut(g, C('#3a3c42'), 2);
  limb(g, -4, -40, -9, -50, 2.5, C('#5b5e66'));
  dot(g, -9, -51, 3.6, C('#ff4a2e'));
  rr(g, -15, -42, 30, 28, 7);
  fillOut(g, C('#d8702f'));
  g.fillStyle = C('#a8501d');
  g.fillRect(-13, -21, 26, 5);
  for (const [x, y] of [[-11, -38], [11, -38], [-11, -19], [11, -19]]) dot(g, x, y, 1.6, C('#f3c46a'), false);
  dot(g, 5, -30, 7.5, C('#2b2c30'));
  dot(g, 5, -30, 5, C('#ffd23a'), false);
  dot(g, 6.5, -30, 2, C('#2b2c30'), false);
  limb(g, 13, -24, 21, -18, 3.5, C('#5b5e66'));
  g.strokeStyle = C('#3a3c42');
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(21, -18);
  g.lineTo(26, -22);
  g.moveTo(21, -18);
  g.lineTo(26, -14);
  g.stroke();
  return -56;
}

// a copper beetle on six legs with a wind-up key on its back
function paintRoach(g, C, t, walk) {
  const ph = Math.sin(t * 16) * 4 * (0.3 + walk);
  for (let i = 0; i < 3; i++) {
    const x = -13 + i * 12;
    const s = i % 2 ? 1 : -1;
    limb(g, x, -10, x - 5 + ph * s, 0, 2.6, C('#3a2a1c'));
  }
  g.beginPath();
  g.ellipse(-1, -15, 22, 12, 0, 0, TAU);
  fillOut(g, C('#c26a2a'));
  g.strokeStyle = C('#8a4518');
  g.lineWidth = 2;
  for (const x of [-9, 2]) {
    g.beginPath();
    g.moveTo(x, -26);
    g.quadraticCurveTo(x + 3, -15, x, -4);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.3)';
  g.beginPath();
  g.ellipse(-6, -21, 9, 3.5, -0.2, 0, TAU);
  g.fill();
  dot(g, 21, -12, 7, C('#5a3820'));
  dot(g, 24, -14, 2.4, C('#ff3a20'), false);
  g.strokeStyle = g._out;
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(25, -17);
  g.quadraticCurveTo(32, -26, 36, -22);
  g.moveTo(23, -18);
  g.quadraticCurveTo(28, -30, 33, -29);
  g.stroke();
  limb(g, -2, -26, -2, -31, 2.5, C('#c9a040'));
  const sx = Math.cos(t * 5);
  g.save();
  g.translate(-2, -34);
  g.scale(Math.abs(sx) < 0.15 ? 0.15 : sx, 1);
  dot(g, -5, 0, 4.2, C('#e6b443'));
  dot(g, 5, 0, 4.2, C('#e6b443'));
  g.restore();
  return -40;
}

// a brass boiler on legs: furnace window, visor eye, piston arms, smokestack
function paintBrute(g, C, t, walk) {
  const ph = Math.sin(t * 6) * 7 * walk;
  limb(g, -11, -36, -12 + ph, -3, 10, C('#585b63'));
  limb(g, 11, -36, 12 - ph, -3, 10, C('#666a72'));
  for (const [x] of [[-12 + ph], [14 - ph]]) {
    rr(g, x - 9, -6, 18, 7, 3);
    fillOut(g, C('#3a3c42'));
  }
  limb(g, -22, -74, -30, -44, 9, C('#5c5f67'));
  dot(g, -30, -41, 8.5, C('#4a4d55'));
  rr(g, -18, -106, 9, 26, 2);
  fillOut(g, C('#3a3a40'));
  rr(g, -26, -84, 52, 52, 14);
  fillOut(g, C('#d9a93e'), 2.8);
  g.fillStyle = C('#b5852a');
  g.fillRect(-24, -48, 48, 10);
  g.strokeStyle = C('#7c5a1c');
  g.lineWidth = 4;
  for (const y of [-70, -50]) {
    g.beginPath();
    g.moveTo(-25, y);
    g.lineTo(25, y);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(-18, -80, 8, 26);
  dot(g, 9, -60, 9, C('#ff8a2a'));
  dot(g, 9, -60, 5, C('#ffd27a'), false);
  rr(g, -10, -98, 21, 17, 5);
  fillOut(g, C('#9a7a30'));
  rr(g, 2, -93, 10, 5, 2);
  g.fillStyle = C('#ff3a20');
  g.fill();
  limb(g, 22, -74, 33, -46, 9, C('#6a6e76'));
  dot(g, 34, -43, 9, C('#55585f'));
  return -110;
}

// the boss: a cast-iron giant in a top hat, monocle aglow, furnace chest, gold trim
function paintBaron(g, C, t, walk) {
  const ph = Math.sin(t * 4.5) * 7 * walk;
  limb(g, -16, -54, -18 + ph, -4, 16, C('#3f434b'));
  limb(g, 16, -54, 18 - ph, -4, 16, C('#4a4f58'));
  for (const x of [-18 + ph, 20 - ph]) {
    rr(g, x - 14, -8, 28, 9, 4);
    fillOut(g, C('#2c2f35'));
  }
  limb(g, -32, -104, -48, -62, 14, C('#43474f'));
  dot(g, -49, -57, 13, C('#373a41'));
  rr(g, -36, -118, 72, 70, 18);
  fillOut(g, C('#505762'), 3);
  g.strokeStyle = C('#e0b440');
  g.lineWidth = 4;
  rr(g, -30, -112, 60, 58, 14);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(-26, -106, 10, 40);
  dot(g, 6, -84, 15, C('#ff5a1e'), true);
  dot(g, 6, -84, 9, C('#ffd070'), false);
  g.strokeStyle = g._out;
  g.lineWidth = 2;
  for (const dx of [-6, 0, 6]) {
    g.beginPath();
    g.moveTo(6 + dx, -97);
    g.lineTo(6 + dx, -71);
    g.stroke();
  }
  dot(g, -30, -114, 8, C('#e0b440'));
  dot(g, 30, -114, 8, C('#e0b440'));
  rr(g, -15, -136, 30, 22, 7);
  fillOut(g, C('#3c4048'));
  dot(g, 7, -125, 6.5, C('#e0b440'));
  dot(g, 7, -125, 4, C('#ff2a1a'), false);
  g.beginPath();
  g.ellipse(0, -137, 22, 4.5, 0, 0, TAU);
  fillOut(g, C('#23252b'));
  rr(g, -14, -170, 28, 33, 3);
  fillOut(g, C('#2a2c32'));
  g.fillStyle = C('#e0b440');
  g.fillRect(-13, -146, 26, 6);
  limb(g, 32, -104, 50, -64, 14, C('#4d525a'));
  dot(g, 51, -59, 13, C('#41454c'));
  return -172;
}

const PAINT = { scrap: paintScrap, roach: paintRoach, brute: paintBrute, baron: paintBaron };

// screen facing of a machine heading `a` (grid radians): +1 right, -1 left
function facing(a) {
  const dx = Math.cos(a) - Math.sin(a);
  return dx >= 0 ? 1 : -1;
}

export function drawMachine(g, S, m) {
  const [sx, sy] = S.p(m.x, m.y, m.z);
  const [, gy] = S.p(m.x, m.y, Math.min(m.z, -0.3));
  const s = S.k * (m.scale || 1) * (MACHINE_K[m.kind] || 1.3);
  const alpha = m.alpha ?? 1;
  const cells = MACHINE_CELLS[m.kind] || 0.3;
  g.save();
  g.globalAlpha = alpha * (m.ghost ? 1 : 1);
  if (!m.ghost) {
    g.fillStyle = 'rgba(30,60,12,0.32)';
    g.beginPath();
    g.ellipse(sx + 5 * s, gy + 2 * s, cells * S.TW * 0.8, cells * S.TW * 0.3, 0, 0, TAU);
    g.fill();
  }
  g.translate(sx, sy);
  g.scale(s * facing(m.a), s);
  g._out = m.ghost ? m.ghost : OUTLINE;
  g.lineJoin = 'round';
  const top = (PAINT[m.kind] || paintScrap)(g, mixer(m), m.t || 0, m.walk ?? 0.15);
  g.restore();
  return sy + top * s;
}

// a machine arriving at the end of this turn: a pulsing ghost on its ring, ringed in red
export function drawMachineShadow(g, S, m) {
  const [sx, sy] = S.p(m.x, m.y, m.z);
  const a = m.alpha ?? 0.6;
  const cells = Math.max(0.36, MACHINE_CELLS[m.kind] || 0.3);
  g.save();
  g.globalAlpha = Math.min(1, a + 0.2);
  g.setLineDash([8 * S.k, 6 * S.k]);
  g.lineDashOffset = -m.t * 20;
  g.lineWidth = 3.5 * S.k;
  g.strokeStyle = '#c8321e';
  g.beginPath();
  g.ellipse(sx, sy, cells * S.TW * 0.9, cells * S.TH * 0.9, 0, 0, TAU);
  g.stroke();
  g.restore();
  drawMachine(g, S, { ...m, ghost: `rgba(60,40,30,${(0.45 * a).toFixed(3)})`, alpha: 1 });
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
