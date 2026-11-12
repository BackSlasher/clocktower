// Entity drawing registry: one draw function per tower kind and enemy kind.
//
// Every function draws centred on (s.x, s.y) in map coordinates. To swap in
// painted sprites later, replace a registry entry, e.g.
//
//   import { towerSprites, imageSprite } from './sprites.js';
//   towerSprites.rivet = imageSprite('/assets/img/rivet.png', { size: 80, rotate: true });
//
// Tower state  s = { x, y, lvl, aim, tension, t, recoil, color, def }
// Enemy state  e = { x, y, a, r, t, hp, flags, def, flash }
//   (t = animation clock in seconds, already scaled by how lively it should be)

import { TAU, gearPath, softSprite } from './geom.js';

// Visual scale factors: entities are drawn larger than their simulation radii
// so they read from across the room.
export const ENEMY_VIS = 1.45;
export const TOWER_VIS = 1.22;
export const TENSION_R = 48;

const circle = (g, x, y, r) => {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
};

// ---------------------------------------------------------------- towers

function base(g, s, plate = '#575047') {
  const { x, y, lvl, color } = s;
  // ground shadow
  g.fillStyle = 'rgba(0,0,0,0.55)';
  circle(g, x + 4, y + 6, 34);
  g.fill();
  // stone octagon
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    g.lineTo(x + Math.cos(a) * 33, y + Math.sin(a) * 33);
  }
  g.closePath();
  g.fillStyle = plate;
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = '#0d0a08';
  g.stroke();
  // owner ring + dark well
  g.fillStyle = '#1c1916';
  circle(g, x, y, 27);
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = color;
  circle(g, x, y, 26);
  g.stroke();
  // owner pennant
  g.lineWidth = 2;
  g.strokeStyle = '#2a1c05';
  g.beginPath();
  g.moveTo(x - 25, y - 22);
  g.lineTo(x - 25, y - 44);
  g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x - 24, y - 44);
  g.lineTo(x - 8, y - 39 + Math.sin(s.t * 3) * 2);
  g.lineTo(x - 24, y - 33);
  g.closePath();
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.stroke();
  // level studs below the base
  for (let i = 0; i < lvl; i++) {
    const sx = x + (i - (lvl - 1) / 2) * 15;
    const sy = y + 31;
    g.beginPath();
    g.moveTo(sx, sy - 7);
    g.lineTo(sx + 6, sy);
    g.lineTo(sx, sy + 7);
    g.lineTo(sx - 6, sy);
    g.closePath();
    g.fillStyle = '#f0d48a';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = '#3a2a0c';
    g.stroke();
  }
}

function brassFill(g, r) {
  const grd = g.createLinearGradient(-r, -r, r, r);
  grd.addColorStop(0, '#f6dc96');
  grd.addColorStop(0.45, '#c99a3e');
  grd.addColorStop(1, '#6e5120');
  return grd;
}

function rivet(g, s) {
  base(g, s);
  const { x, y, lvl, aim, recoil } = s;
  g.save();
  g.translate(x, y);
  g.rotate(aim);
  const n = lvl; // one barrel per level
  const spread = 8;
  for (let i = 0; i < n; i++) {
    const oy = (i - (n - 1) / 2) * spread;
    const back = recoil * 8 * (i === Math.floor(s.t * 8) % n ? 1 : 0.5);
    g.fillStyle = '#0c0b0a';
    g.fillRect(4 - back, oy - 4.5, 34, 9);
    g.fillStyle = '#a9adb0';
    g.fillRect(5 - back, oy - 3.5, 32, 7);
    g.fillStyle = '#eef0f0';
    g.fillRect(5 - back, oy - 2.5, 32, 2);
    g.fillStyle = '#d9b25a';
    g.fillRect(30 - back, oy - 5, 6, 10);
  }
  // round brass turret
  g.fillStyle = brassFill(g, 17);
  circle(g, 0, 0, 17);
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = '#2a1c05';
  g.stroke();
  // sight block + hatch
  g.fillStyle = '#3a2a0c';
  g.fillRect(6, -6, 9, 12);
  g.fillStyle = '#5a4520';
  circle(g, -4, 0, 8);
  g.fill();
  g.fillStyle = '#f0d48a';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    circle(g, Math.cos(a) * 13, Math.sin(a) * 13, 1.6);
    g.fill();
  }
  if (recoil > 0.55) {
    g.globalCompositeOperation = 'lighter';
    g.drawImage(softSprite('rgba(255,210,120,1)', 64, 0.2), 26, -18, 36, 36);
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
}

function mortar(g, s) {
  base(g, s, '#4f4a44');
  const { x, y, lvl, aim, recoil } = s;
  g.save();
  g.translate(x, y);
  g.rotate(aim);
  // iron carriage with side wheels
  g.fillStyle = '#16130f';
  g.fillRect(-14, -21, 24, 7);
  g.fillRect(-14, 14, 24, 7);
  g.fillStyle = '#3b352e';
  g.fillRect(-18, -15, 30, 30);
  g.lineWidth = 2;
  g.strokeStyle = '#0d0a08';
  g.strokeRect(-18, -15, 30, 30);
  // boiler
  g.fillStyle = '#8f4a2a';
  circle(g, -12, 0, 9);
  g.fill();
  g.fillStyle = '#d1794a';
  circle(g, -14, -3, 4);
  g.fill();
  // fat bronze barrel, flared at the muzzle
  const L = 18 - recoil * 7;
  g.fillStyle = brassFill(g, 20);
  g.beginPath();
  g.moveTo(-6, -11);
  g.lineTo(L, -14);
  g.lineTo(L, 14);
  g.lineTo(-6, 11);
  g.closePath();
  g.fill();
  g.strokeStyle = '#2a1c05';
  g.stroke();
  for (let i = 0; i < lvl; i++) {
    g.fillStyle = '#3a2a0c';
    g.fillRect(-2 + i * 6, -12.5, 2.5, 25);
  }
  g.fillStyle = brassFill(g, 16);
  circle(g, L, 0, 16);
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = '#2a1c05';
  g.stroke();
  g.fillStyle = '#050403';
  circle(g, L, 0, 10.5);
  g.fill();
  if (recoil > 0.4) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = recoil;
    g.drawImage(softSprite('rgba(255,170,80,1)', 64, 0.2), L - 22, -22, 44, 44);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
}

function tesla(g, s) {
  base(g, s, '#4a5054');
  const { x, y, lvl, t, tension, recoil } = s;
  const rings = 2 + lvl;
  for (let i = 0; i < rings; i++) {
    const r = 21 - i * (14 / rings);
    g.lineWidth = 3.5;
    g.strokeStyle = i % 2 ? '#d1794a' : '#8f4a2a';
    circle(g, x, y, r);
    g.stroke();
  }
  // prongs
  for (let i = 0; i < 3 + lvl; i++) {
    const a = (i / (3 + lvl)) * TAU + t * 0.4;
    g.lineWidth = 3;
    g.strokeStyle = '#b88a34';
    g.beginPath();
    g.moveTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
    g.lineTo(x + Math.cos(a) * 22, y + Math.sin(a) * 22);
    g.stroke();
  }
  // orb
  const pulse = 0.6 + 0.4 * Math.sin(t * 6);
  const glow = 0.35 + tension * 0.5 + recoil * 0.8;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = Math.min(1, glow * pulse);
  g.drawImage(softSprite('rgba(140,220,255,1)', 64, 0.15), x - 30, y - 30, 60, 60);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#dff6ff';
  circle(g, x, y, 7);
  g.fill();
  // idle sparks, more frequent when wound
  if (Math.sin(t * 13.7) > 1 - tension * 0.9) {
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(190,240,255,0.9)';
    const a = (t * 7.3) % TAU;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * 14 + 4, y + Math.sin(a) * 14 - 3);
    g.lineTo(x + Math.cos(a) * 24, y + Math.sin(a) * 24);
    g.stroke();
  }
}

function chrono(g, s) {
  base(g, s, '#4c5156');
  const { x, y, lvl, t } = s;
  // dial
  g.fillStyle = '#efe3c2';
  circle(g, x, y, 18);
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = '#b88a34';
  g.stroke();
  g.strokeStyle = '#3a2a0c';
  g.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13);
    g.lineTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16);
    g.stroke();
  }
  // ornaments per level
  for (let i = 0; i < lvl; i++) {
    const a = -Math.PI / 2 + (i - (lvl - 1) / 2) * 0.6;
    g.fillStyle = '#4fb39a';
    circle(g, x + Math.cos(a) * 25, y + Math.sin(a) * 25, 3.5);
    g.fill();
  }
  // swinging pendulum
  const sw = Math.sin(t * 2.4) * 0.9;
  const px = x + Math.sin(sw) * 22;
  const py = y + Math.cos(sw) * 22;
  g.lineWidth = 3;
  g.strokeStyle = '#6e5120';
  g.beginPath();
  g.moveTo(x, y - 2);
  g.lineTo(px, py);
  g.stroke();
  g.fillStyle = '#f0d48a';
  circle(g, px, py, 7);
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = '#3a2a0c';
  g.stroke();
  g.fillStyle = '#3a2a0c';
  circle(g, x, y, 3);
  g.fill();
}

function genericTower(g, s) {
  base(g, s);
  g.fillStyle = '#b88a34';
  circle(g, s.x, s.y, 14);
  g.fill();
}

export const towerSprites = { rivet, mortar, tesla, chrono, _default: genericTower };

// Chrono slow-field disc (drawn beneath everything).
export function drawChronoField(g, x, y, r, t, tension) {
  g.fillStyle = 'rgba(110,180,255,0.07)';
  circle(g, x, y, r);
  g.fill();
  g.save();
  g.setLineDash([10, 14]);
  g.lineDashOffset = -t * 20;
  g.lineWidth = 2.5;
  g.strokeStyle = `rgba(150,205,255,${0.25 + tension * 0.3})`;
  circle(g, x, y, r);
  g.stroke();
  g.restore();
}

// Tension: a wound-spring gauge arc around the tower, plus a winding key when
// the tower is nearly run down.
export function drawTension(g, x, y, tension, now) {
  const r = TENSION_R;
  g.lineCap = 'round';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  circle(g, x, y, r);
  g.stroke();
  let col;
  if (tension > 0.55) col = '#5fd3a8';
  else if (tension > 0.25) col = '#ffb648';
  else col = Math.sin(now * 8) > 0 ? '#ff5a3f' : '#a8321f';
  if (tension > 0.01) {
    g.lineWidth = 7;
    g.strokeStyle = col;
    g.beginPath();
    g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * tension);
    g.stroke();
  }
  // tick marks (spring coils)
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    g.moveTo(x + Math.cos(a) * (r - 3), y + Math.sin(a) * (r - 3));
    g.lineTo(x + Math.cos(a) * (r + 3), y + Math.sin(a) * (r + 3));
  }
  g.stroke();
  g.lineCap = 'butt';
  if (tension < 0.25) drawKey(g, x + 36, y - 46 - Math.abs(Math.sin(now * 3)) * 6, now);
}

function drawKey(g, x, y, now) {
  g.save();
  g.translate(x, y);
  g.rotate(Math.sin(now * 4) * 0.5);
  g.scale(Math.cos(now * 4) * 0.4 + 0.75, 1);
  g.fillStyle = '#ff6a4a';
  g.strokeStyle = '#2a0c06';
  g.lineWidth = 2.5;
  // two loops + shaft
  for (const sx of [-9, 9]) {
    g.beginPath();
    g.ellipse(sx, -6, 8, 7, 0, 0, TAU);
    g.fill();
    g.stroke();
  }
  g.fillRect(-3, -4, 6, 20);
  g.strokeRect(-3, -4, 6, 20);
  g.restore();
}

// ---------------------------------------------------------------- enemies

function legs(g, e, n, len, w, col) {
  const { r, t } = e;
  g.strokeStyle = col;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const fx = ((i + 0.5) / n - 0.5) * r * 1.4;
    const ph = Math.sin(t * 14 + i * 2.1) * len * 0.5;
    for (const side of [-1, 1]) {
      g.moveTo(fx, side * r * 0.6);
      g.lineTo(fx + ph * side, side * (r * 0.6 + len));
    }
  }
  g.stroke();
  g.lineCap = 'butt';
}

function eye(g, x, y, r, col = '#ff5a3a') {
  g.globalCompositeOperation = 'lighter';
  g.drawImage(softSprite(col, 32, 0.1), x - r * 3, y - r * 3, r * 6, r * 6);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#ffe0b0';
  circle(g, x, y, r * 0.6);
  g.fill();
}

function scrap(g, e) {
  const { r, t } = e;
  // two stomping feet
  const st = Math.sin(t * 9) * r * 0.45;
  g.fillStyle = '#2a201a';
  g.fillRect(st - 5, -r * 0.95, 10, 7);
  g.fillRect(-st - 5, r * 0.95 - 7, 10, 7);
  g.fillStyle = '#7a5a44';
  circle(g, 0, 0, r);
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = '#2b1d14';
  g.stroke();
  // patchwork plates
  g.fillStyle = '#5d4433';
  g.fillRect(-r * 0.7, -r * 0.5, r * 0.6, r);
  g.fillStyle = '#9a7558';
  g.fillRect(-r * 0.1, -r * 0.65, r * 0.35, r * 0.4);
  g.fillStyle = '#c9a07a';
  circle(g, -r * 0.45, -r * 0.35, 1.8);
  circle(g, -r * 0.45, r * 0.35, 1.8);
  g.fill();
  eye(g, r * 0.55, 0, r * 0.28);
}

function roach(g, e) {
  const { r, t } = e;
  legs(g, e, 3, r * 0.6, 2, '#2b140a');
  g.fillStyle = '#b8643a';
  g.beginPath();
  g.ellipse(0, 0, r * 1.25, r * 0.85, 0, 0, TAU);
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = '#3a1a0c';
  g.stroke();
  g.beginPath();
  g.moveTo(-r * 1.1, 0);
  g.lineTo(r * 0.6, 0);
  g.stroke();
  g.fillStyle = 'rgba(255,220,180,0.35)';
  g.beginPath();
  g.ellipse(-r * 0.1, -r * 0.4, r * 0.6, r * 0.18, 0, 0, TAU);
  g.fill();
  // wind-up key on its back
  g.save();
  g.translate(-r * 0.6, 0);
  g.scale(Math.cos(t * 12), 1);
  g.fillStyle = '#d9b25a';
  g.fillRect(-1.5, -r * 0.7, 3, r * 1.4);
  g.fillRect(-4, -r * 0.7, 8, 3);
  g.fillRect(-4, r * 0.7 - 3, 8, 3);
  g.restore();
  eye(g, r * 1.05, -r * 0.3, r * 0.2, '#ffd23a');
  eye(g, r * 1.05, r * 0.3, r * 0.2, '#ffd23a');
}

function brute(g, e) {
  const { r, t } = e;
  const sway = Math.sin(t * 5) * 3;
  // fists
  g.fillStyle = '#6e5120';
  circle(g, r * 0.35 + sway, -r * 1.0, r * 0.38);
  circle(g, r * 0.35 - sway, r * 1.0, r * 0.38);
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = '#1c1206';
  circle(g, r * 0.35 + sway, -r * 1.0, r * 0.38);
  g.stroke();
  circle(g, r * 0.35 - sway, r * 1.0, r * 0.38);
  g.stroke();
  // armoured body
  const s = r * 0.95;
  g.fillStyle = '#a88a3c';
  g.beginPath();
  g.moveTo(-s, -s * 0.8);
  g.lineTo(s * 0.6, -s);
  g.lineTo(s, 0);
  g.lineTo(s * 0.6, s);
  g.lineTo(-s, s * 0.8);
  g.closePath();
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#2a1c05';
  g.stroke();
  g.fillStyle = '#7d6428';
  g.fillRect(-s * 0.8, -s * 0.15, s * 1.4, s * 0.3);
  g.fillStyle = '#f0d48a';
  for (const [px, py] of [[-s * 0.7, -s * 0.55], [-s * 0.7, s * 0.55], [s * 0.3, -s * 0.65], [s * 0.3, s * 0.65], [-s * 0.2, 0]]) {
    circle(g, px, py, 2.4);
    g.fill();
  }
  eye(g, s * 0.62, -s * 0.28, r * 0.17, '#ff8a2a');
  eye(g, s * 0.62, s * 0.28, r * 0.17, '#ff8a2a');
}

function drone(g, e) {
  const { r, t } = e;
  // shadow on the street below (it is airborne)
  g.save();
  g.rotate(-e.a);
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.beginPath();
  g.ellipse(12, 26, r * 1.1, r * 0.7, 0, 0, TAU);
  g.fill();
  g.restore();
  const bob = Math.sin(t * 4) * 2;
  g.translate(0, bob);
  // arms + rotors
  g.lineWidth = 3;
  g.strokeStyle = '#3d474b';
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * r * 1.0, Math.sin(a) * r * 1.0);
  }
  g.stroke();
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const rx = Math.cos(a) * r * 1.0;
    const ry = Math.sin(a) * r * 1.0;
    g.fillStyle = 'rgba(200,220,225,0.22)';
    circle(g, rx, ry, r * 0.55);
    g.fill();
    g.strokeStyle = 'rgba(230,240,240,0.7)';
    g.lineWidth = 2;
    const sp = t * 40 + i;
    g.beginPath();
    g.moveTo(rx + Math.cos(sp) * r * 0.5, ry + Math.sin(sp) * r * 0.5);
    g.lineTo(rx - Math.cos(sp) * r * 0.5, ry - Math.sin(sp) * r * 0.5);
    g.stroke();
  }
  g.fillStyle = '#8a9aa0';
  circle(g, 0, 0, r * 0.6);
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = '#1e2629';
  g.stroke();
  g.fillStyle = '#4fb39a';
  circle(g, 0, 0, r * 0.25);
  g.fill();
  const blink = Math.sin(t * 6) > 0.3;
  eye(g, r * 0.5, 0, r * 0.2, blink ? '#ff4a3a' : '#601810');
}

function tinker(g, e) {
  const { r, t } = e;
  // tool arm with wrench
  const sw = Math.sin(t * 7) * 0.6;
  g.save();
  g.rotate(sw);
  g.strokeStyle = '#3a3226';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, r * 0.4);
  g.lineTo(r * 1.1, r * 0.8);
  g.stroke();
  g.fillStyle = '#c0c6c8';
  circle(g, r * 1.2, r * 0.82, 4.5);
  g.fill();
  g.restore();
  // coat
  g.fillStyle = '#4f6b4a';
  circle(g, 0, 0, r);
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = '#18220f';
  g.stroke();
  // backpack boiler
  g.fillStyle = '#8f4a2a';
  g.fillRect(-r * 0.95, -r * 0.5, r * 0.6, r);
  // goggles
  g.fillStyle = '#d9b25a';
  circle(g, r * 0.45, -r * 0.3, r * 0.26);
  circle(g, r * 0.45, r * 0.3, r * 0.26);
  g.fill();
  eye(g, r * 0.5, -r * 0.3, r * 0.14, '#7dffb0');
  eye(g, r * 0.5, r * 0.3, r * 0.14, '#7dffb0');
  // green repair cross on the back
  g.fillStyle = '#7dffb0';
  g.fillRect(-r * 0.75, -2, r * 0.4, 4);
  g.fillRect(-r * 0.57, -r * 0.2, 4, r * 0.4);
}

function baron(g, e) {
  const { t } = e;
  const r = e.r * 1.35; // drawn larger than its hit radius: unmistakable
  // menacing ground ring
  g.save();
  g.rotate(-e.a);
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.65 + 0.25 * Math.sin(t * 3);
  g.drawImage(softSprite('rgba(255,50,20,1)', 64, 0.25), -r * 2, -r * 2, r * 4, r * 4);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.restore();
  // treads
  g.fillStyle = '#16171a';
  g.fillRect(-r * 0.9, -r * 1.05, r * 1.8, r * 0.38);
  g.fillRect(-r * 0.9, r * 0.67, r * 1.8, r * 0.38);
  g.fillStyle = '#4a4c52';
  const tr = (t * 30) % 10;
  for (let x = -r * 0.9 + tr; x < r * 0.9; x += 10) {
    g.fillRect(x, -r * 1.05, 3, r * 0.38);
    g.fillRect(x, r * 0.67, 3, r * 0.38);
  }
  // hull
  g.fillStyle = '#4a4d55';
  circle(g, 0, 0, r * 0.88);
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = Math.sin(t * 5) > 0 ? '#e2553f' : '#8f1d14';
  g.stroke();
  // spikes
  g.fillStyle = '#8a8d94';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    g.beginPath();
    g.moveTo(Math.cos(a - 0.12) * r * 0.86, Math.sin(a - 0.12) * r * 0.86);
    g.lineTo(Math.cos(a) * r * 1.08, Math.sin(a) * r * 1.08);
    g.lineTo(Math.cos(a + 0.12) * r * 0.86, Math.sin(a + 0.12) * r * 0.86);
    g.fill();
  }
  // plating
  g.lineWidth = 2;
  g.strokeStyle = '#25262a';
  circle(g, 0, 0, r * 0.62);
  g.stroke();
  // top hat (seen from above): brim + crown
  g.fillStyle = '#121214';
  circle(g, -r * 0.12, 0, r * 0.46);
  g.fill();
  g.fillStyle = '#26262b';
  circle(g, -r * 0.12, 0, r * 0.3);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#8f1d14';
  circle(g, -r * 0.12, 0, r * 0.36);
  g.stroke();
  // monocle eyes
  eye(g, r * 0.62, -r * 0.24, r * 0.12, '#ff3a20');
  eye(g, r * 0.62, r * 0.24, r * 0.12, '#ff3a20');
  g.lineWidth = 2;
  g.strokeStyle = '#f0d48a';
  circle(g, r * 0.62, -r * 0.24, r * 0.15);
  g.stroke();
}

function genericEnemy(g, e) {
  g.fillStyle = '#8a8070';
  circle(g, 0, 0, e.r);
  g.fill();
  eye(g, e.r * 0.5, 0, e.r * 0.25);
}

export const enemySprites = { scrap, roach, brute, drone, tinker, baron, _default: genericEnemy };

// Draw an enemy rotated to its heading, with hit flash.
export function drawEnemy(g, kind, e) {
  const fn = enemySprites[kind] || enemySprites._default;
  g.save();
  g.translate(e.x, e.y);
  g.rotate(e.a);
  fn(g, e);
  g.restore();
  if (e.flash > 0) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(1, e.flash);
    const rr = e.r * (e.def?.boss ? 2.4 : 1.8);
    g.drawImage(softSprite('rgba(255,240,210,1)', 64, 0.35), e.x - rr, e.y - rr, rr * 2, rr * 2);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}

export function drawTower(g, kind, s) {
  (towerSprites[kind] || towerSprites._default)(g, s);
}

// Icon for HUD previews: draws the enemy kind into a square canvas context.
export function drawEnemyIcon(g, kind, def, size) {
  const r = def?.boss ? size * 0.3 : size * 0.34;
  drawEnemy(g, kind, { x: size / 2, y: size / 2, a: 0, r, t: 0.3, hp: 1, flags: 0, def, flash: 0 });
}

// ---------------------------------------------------------------- image sprites

// Wrap a picture as a registry draw function. Until the image has loaded, the
// fallback (the vector sprite) is drawn.
export function imageSprite(url, { size = 64, rotate = false, fallback } = {}) {
  const img = new Image();
  let ok = false;
  img.onload = () => (ok = true);
  img.src = url;
  return (g, s) => {
    if (!ok) return fallback?.(g, s);
    const isTower = 'lvl' in s && 'aim' in s;
    g.save();
    if (isTower) {
      g.translate(s.x, s.y);
      if (rotate) g.rotate(s.aim);
    }
    g.drawImage(img, -size / 2, -size / 2, size, size);
    g.restore();
  };
}

// ---------------------------------------------------------------- clock tower

export function drawClockTower(g, T, opts) {
  const { lives, maxLives, now, flash, low } = opts;
  const { x, y } = T;
  // glow
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.5 + 0.1 * Math.sin(now * 1.3);
  g.drawImage(softSprite('rgba(255,182,72,1)', 128, 0.1), x - 190, y - 190, 380, 380);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // shadow
  g.fillStyle = 'rgba(0,0,0,0.55)';
  circle(g, x + 8, y + 12, 104);
  g.fill();
  // octagonal stone base with buttresses
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    g.lineTo(x + Math.cos(a) * 108, y + Math.sin(a) * 108);
  }
  g.closePath();
  g.fillStyle = '#2f2a25';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#100c09';
  g.stroke();
  // brass rim
  g.lineWidth = 7;
  g.strokeStyle = '#6e5120';
  circle(g, x, y, 96);
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = '#d9b25a';
  circle(g, x, y, 96);
  g.stroke();

  // lives ring: one pip per life
  const n = maxLives;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + ((i + 0.5) / n) * TAU;
    const px = x + Math.cos(a) * 86;
    const py = y + Math.sin(a) * 86;
    const on = i < lives;
    g.fillStyle = on ? (low ? (Math.sin(now * 6) > 0 ? '#ff6a4a' : '#c23a24') : '#ffcf6a') : '#2a1612';
    circle(g, px, py, 5.2);
    g.fill();
  }
  // face
  g.fillStyle = '#efe3c2';
  circle(g, x, y, 74);
  g.fill();
  const fg = g.createRadialGradient(x - 20, y - 25, 10, x, y, 74);
  fg.addColorStop(0, 'rgba(255,255,255,0.25)');
  fg.addColorStop(1, 'rgba(110,81,32,0.35)');
  g.fillStyle = fg;
  circle(g, x, y, 74);
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#3a2a0c';
  circle(g, x, y, 74);
  g.stroke();
  // hour marks (roman-ish bars)
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU;
    const big = i % 5 === 0;
    g.lineWidth = big ? 5 : 1.5;
    g.strokeStyle = '#2a1c05';
    g.beginPath();
    g.moveTo(x + Math.cos(a) * (big ? 54 : 63), y + Math.sin(a) * (big ? 54 : 63));
    g.lineTo(x + Math.cos(a) * 68, y + Math.sin(a) * 68);
    g.stroke();
  }
  g.fillStyle = '#2a1c05';
  g.font = 'bold 20px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('XII', x, y - 40);
  g.fillText('VI', x, y + 40);
  g.fillText('III', x + 40, y);
  g.fillText('IX', x - 40, y);
  // hands: real time, with a ticking second hand
  // the Great Clock stops when the town falls
  const d = lives > 0 ? new Date() : new Date(2000, 0, 1, 11, 58, 47);
  const sec = d.getSeconds() + Math.min(1, (d.getMilliseconds() / 1000) * 6); // snappy tick
  const min = d.getMinutes() + sec / 60;
  const hr = (d.getHours() % 12) + min / 60;
  const hand = (ang, len, w, col) => {
    g.lineWidth = w;
    g.strokeStyle = col;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x - Math.cos(ang) * 10, y - Math.sin(ang) * 10);
    g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
    g.lineCap = 'butt';
  };
  hand((hr / 12) * TAU - Math.PI / 2, 36, 7, '#1a1208');
  hand((min / 60) * TAU - Math.PI / 2, 56, 4.5, '#1a1208');
  hand((sec / 60) * TAU - Math.PI / 2, 60, 2, '#a8321f');
  g.fillStyle = '#b88a34';
  circle(g, x, y, 7);
  g.fill();
  if (lives <= 0) {
    g.fillStyle = 'rgba(40,10,6,0.45)';
    circle(g, x, y, 74);
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(20,8,4,0.9)';
    g.beginPath();
    g.moveTo(x - 50, y - 30);
    g.lineTo(x - 12, y - 8);
    g.lineTo(x - 18, y + 20);
    g.lineTo(x + 30, y + 52);
    g.moveTo(x - 12, y - 8);
    g.lineTo(x + 40, y - 22);
    g.stroke();
  }
  // leak flash
  if (flash > 0) {
    g.fillStyle = `rgba(226,60,40,${Math.min(0.75, flash)})`;
    circle(g, x, y, 100);
    g.fill();
  }
  // gear decoration spinning slowly at the base
  g.save();
  g.globalAlpha = 0.9;
  g.fillStyle = '#6e5120';
  gearPath(g, x + 76, y + 76, 24, 10, now * 0.6);
  g.fill();
  g.fillStyle = '#d9b25a';
  gearPath(g, x + 76, y + 76, 20, 10, now * 0.6);
  g.fill();
  g.fillStyle = '#2f2a25';
  circle(g, x + 76, y + 76, 6);
  g.fill();
  g.restore();
}
