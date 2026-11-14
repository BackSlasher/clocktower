// The town at night: the static layers, drawn once from map data. The street
// layout, plots and clock come from the map; each map's look (ground, roofs,
// street details) comes from THEMES, keyed by map id, and its scenery (canals,
// yards) from map.scenery.
//
// Produces two offscreen canvases at logical 1920x1080 × `res`:
//   base  - ground, cobbled streets, plaza, rooftops, lamp posts
//   light - additive gaslight pools (drawn every frame with a slight flicker)
// plus a list of chimney positions for animated smoke.
//
// If /assets/manifest.json names a backdrop (e.g. "backdrop": "img/backdrop.png",
// relative to /assets/) and the image loads, it replaces the procedural base
// (the light layer and chimneys are then skipped; a painted backdrop has its
// own). The manifest always exists, so nothing is probed with a request that
// 404s and the browser console stays clean.

import { TAU, rng, distToPaths, gearPath } from './geom.js';

export const STREET_W = 64;

let painted = null;
let probed = null;

// Probe once for a painted backdrop. Resolves to an Image or null.
export function probeBackdrop() {
  if (probed) return probed;
  probed = fetch('/assets/manifest.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => {
      const file = typeof m?.backdrop === 'string' ? m.backdrop.replace(/^\/+/, '') : '';
      if (!file) return null;
      return new Promise((res) => {
        const img = new Image();
        img.onload = () => res((painted = img));
        img.onerror = () => res(null);
        img.src = `/assets/${file}`;
      });
    })
    .catch(() => null);
  return probed;
}

// Per-map look. Brasswick is the original (and the fallback for unknown ids).
const THEMES = {
  brasswick: { seed: 0xb7a55 },
  // the clockmakers' quarter: warm soot, copper and brass roofs, a tram rail down the street
  spindle: {
    seed: 0x5917d1e,
    ground: ['#15130f', '40,33,24', '10,9,7'],
    roofs: [
      ['#4a2f26', '#36211b', '#5d3b2e'],
      ['#5a4023', '#3f2c17', '#74542f'],
      ['#2e4a43', '#22362f', '#3e6058'],
      ['#38332d', '#29251f', '#4a443b'],
    ],
    rails: true,
  },
  // the canal quarter: damp green-grey ground, slate and verdigris roofs, water
  lockgate: {
    seed: 0x10c6a7e,
    ground: ['#0d1817', '22,44,42', '6,12,12'],
    roofs: [
      ['#2c3a41', '#1f2a2f', '#3a4b53'],
      ['#2e4a43', '#22362f', '#3e6058'],
      ['#2a3436', '#1d2527', '#3a4749'],
      ['#4a2f26', '#36211b', '#5d3b2e'],
    ],
  },
};

export function buildBackdrop(map, res) {
  const W = map.w || 1920;
  const H = map.h || 1080;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(W * res);
    c.height = Math.round(H * res);
    const g = c.getContext('2d');
    g.scale(res, res);
    return [c, g];
  };
  const [base, g] = mk();
  const [light, lg] = mk();
  const out = { base, light, chimneys: [], lamps: [], painted: !!painted };

  if (painted) {
    g.drawImage(painted, 0, 0, W, H);
    return out;
  }

  const theme = THEMES[map.id] || THEMES.brasswick;
  const R = rng(theme.seed);
  const paths = map.paths;
  const T = map.tower;
  const sc = map.scenery || {};
  const [ground, mottleA, mottleB] = theme.ground || ['#0e1719', '20,36,38', '8,12,13'];

  // --- ground: damp soot with mottling
  g.fillStyle = ground;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    const x = R() * W;
    const y = R() * H;
    const r = 60 + R() * 220;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const c = R() < 0.5 ? mottleA : mottleB;
    grd.addColorStop(0, `rgba(${c},0.5)`);
    grd.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.18)';
    g.fillRect(R() * W, R() * H, 2, 2);
  }

  // --- canals (under the streets; a street over water gets a bridge below)
  if (sc.water) drawWater(g, lg, sc, R);

  // --- streets
  const strokePaths = (width, style) => {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.lineWidth = width;
    g.strokeStyle = style;
    for (const p of paths) {
      g.beginPath();
      p.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  };
  strokePaths(STREET_W + 26, '#07090a'); // gutter shadow
  strokePaths(STREET_W + 16, '#3b3631'); // kerb stones
  strokePaths(STREET_W + 8, '#15110f'); // kerb edge
  const cobbles = g.createPattern(cobblePattern(R), 'repeat');
  strokePaths(STREET_W, cobbles);
  strokePaths(STREET_W * 0.4, 'rgba(255,220,170,0.035)'); // worn centre
  if (theme.rails) {
    // a pair of brass tram rails down the middle of the street
    strokePaths(24, 'rgba(0,0,0,0.4)');
    strokePaths(20, 'rgba(201,154,74,0.6)');
    strokePaths(14, cobbles);
  }
  if (sc.water) drawBridges(g, paths, sc.water);

  // --- clock plaza: concentric flagstones
  {
    const pr = 150;
    g.save();
    g.beginPath();
    g.arc(T.x, T.y, pr + 10, 0, TAU);
    g.fillStyle = '#15110f';
    g.fill();
    g.beginPath();
    g.arc(T.x, T.y, pr, 0, TAU);
    g.clip();
    g.fillStyle = '#3d3832';
    g.fillRect(T.x - pr, T.y - pr, pr * 2, pr * 2);
    for (let ring = 0; ring < 6; ring++) {
      const r0 = 40 + ring * 22;
      const n = Math.round((TAU * r0) / 34);
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU + ring * 0.3;
        const a1 = ((i + 1) / n) * TAU + ring * 0.3;
        g.beginPath();
        g.arc(T.x, T.y, r0 + 20, a0 + 0.01, a1 - 0.01);
        g.arc(T.x, T.y, r0, a1 - 0.01, a0 + 0.01, true);
        g.closePath();
        const v = 48 + Math.floor(R() * 18);
        g.fillStyle = `rgb(${v + 6},${v},${v - 6})`;
        g.fill();
      }
    }
    g.restore();
    g.lineWidth = 4;
    g.strokeStyle = '#8f6a2a';
    g.beginPath();
    g.arc(T.x, T.y, pr - 4, 0, TAU);
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(240,212,138,0.35)';
    g.beginPath();
    g.arc(T.x, T.y, pr - 12, 0, TAU);
    g.stroke();
  }

  // --- occupancy grid for buildings
  const CELL = 10;
  const gw = Math.ceil(W / CELL);
  const gh = Math.ceil(H / CELL);
  const occ = new Uint8Array(gw * gh);
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      const x = cx * CELL + CELL / 2;
      const y = cy * CELL + CELL / 2;
      let blocked = distToPaths(paths, x, y) < STREET_W / 2 + 26;
      if (!blocked && Math.hypot(x - T.x, y - T.y) < 175) blocked = true;
      if (!blocked && sc.water) blocked = sc.water.some((w) => distToPaths([w], x, y) < (w.w || 80) / 2 + 14);
      if (!blocked && sc.yards) blocked = sc.yards.some((yd) => Math.hypot(x - yd.x, y - yd.y) < yd.r + 16);
      if (!blocked) {
        for (const p of map.plots) {
          if (Math.hypot(x - p.x, y - p.y) < 58) {
            blocked = true;
            break;
          }
        }
      }
      occ[cy * gw + cx] = blocked ? 1 : 0;
    }
  }
  const free = (cx, cy, w, h) => {
    if (cx < -2 || cy < -2 || cx + w > gw + 2 || cy + h > gh + 2) return false;
    for (let y = cy; y < cy + h; y++) {
      if (y < 0 || y >= gh) continue;
      for (let x = cx; x < cx + w; x++) {
        if (x < 0 || x >= gw) continue;
        if (occ[y * gw + x]) return false;
      }
    }
    return true;
  };
  const mark = (cx, cy, w, h, v) => {
    for (let y = cy; y < cy + h; y++) {
      if (y < 0 || y >= gh) continue;
      for (let x = cx; x < cx + w; x++) {
        if (x < 0 || x >= gw) continue;
        occ[y * gw + x] = v;
      }
    }
  };

  // Yards: open courts with a brass centrepiece (scenery.yards).
  for (const yd of sc.yards || []) drawYard(g, lg, yd, R);

  // Lamps first (they reserve small spots along the kerbs).
  const lamps = [];
  for (const p of paths) {
    const pts = p.pts;
    let side = 1;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      for (let d = 60; d < len - 40; d += 170) {
        side = -side;
        const x = ax + ((bx - ax) * d) / len + nx * side * (STREET_W / 2 + 14);
        const y = ay + ((by - ay) * d) / len + ny * side * (STREET_W / 2 + 14);
        if (x < 10 || y < 10 || x > W - 10 || y > H - 10) continue;
        if (distToPaths(paths, x, y) < STREET_W / 2 + 8) continue;
        if (Math.hypot(x - T.x, y - T.y) < 170) continue;
        if (map.plots.some((pl) => Math.hypot(pl.x - x, pl.y - y) < 52)) continue;
        if (lamps.some((l) => Math.hypot(l.x - x, l.y - y) < 120)) continue;
        lamps.push({ x, y });
      }
    }
  }
  // Four lamps around the plaza.
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    lamps.push({ x: T.x + Math.cos(a) * 160, y: T.y + Math.sin(a) * 160 });
  }
  out.lamps = lamps;

  // Buildings: big blocks first, then fillers.
  const blds = [];
  const sizes = [
    [16, 12], [14, 10], [12, 12], [12, 9], [10, 8], [9, 7], [8, 6], [7, 6], [6, 5], [5, 5],
  ];
  for (const [bw, bh] of sizes) {
    for (let attempt = 0; attempt < 2600; attempt++) {
      const flip = R() < 0.5;
      const w = (flip ? bh : bw) + Math.floor(R() * 3) - 1;
      const h = (flip ? bw : bh) + Math.floor(R() * 3) - 1;
      const cx = Math.floor(R() * (gw + 4)) - 2;
      const cy = Math.floor(R() * (gh + 4)) - 2;
      if (!free(cx - 1, cy - 1, w + 2, h + 2)) continue;
      mark(cx, cy, w, h, 2);
      blds.push({ x: cx * CELL, y: cy * CELL, w: w * CELL, h: h * CELL });
    }
  }
  blds.sort((a, b) => a.y + a.h - (b.y + b.h));

  const roofs = theme.roofs || [
    ['#2c3a41', '#1f2a2f', '#3a4b53'], // slate
    ['#2e4a43', '#22362f', '#3e6058'], // verdigris copper
    ['#4a2f26', '#36211b', '#5d3b2e'], // rust tile
    ['#38332d', '#29251f', '#4a443b'], // tar
  ];
  for (const b of blds) {
    const fh = Math.min(22, b.h * 0.28); // visible facade height
    const rh = b.h - fh;
    // drop shadow
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(b.x + 6, b.y + 8, b.w, b.h);
    // facade (brick) with windows
    g.fillStyle = '#2a1d19';
    g.fillRect(b.x, b.y + rh, b.w, fh);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(b.x, b.y + b.h - 3, b.w, 3);
    const nwin = Math.max(1, Math.floor(b.w / 22));
    for (let i = 0; i < nwin; i++) {
      const wx = b.x + (b.w / nwin) * (i + 0.5) - 4;
      const wy = b.y + rh + fh * 0.3;
      const lit = R() < 0.42;
      g.fillStyle = lit ? (R() < 0.5 ? '#ffcf7a' : '#f6a947') : '#120d0b';
      g.fillRect(wx, wy, 8, Math.max(5, fh * 0.45));
      if (lit) {
        const grd = lg.createRadialGradient(wx + 4, wy + 6, 0, wx + 4, wy + 6, 26);
        grd.addColorStop(0, 'rgba(255,180,80,0.22)');
        grd.addColorStop(1, 'rgba(255,180,80,0)');
        lg.fillStyle = grd;
        lg.fillRect(wx - 26, wy - 20, 60, 56);
      }
    }
    // roof
    const [mid, dark, hi] = roofs[Math.floor(R() * roofs.length)];
    const horiz = b.w >= rh;
    if (R() < 0.18) {
      // flat roof with parapet
      g.fillStyle = dark;
      g.fillRect(b.x, b.y, b.w, rh);
      g.fillStyle = mid;
      g.fillRect(b.x + 4, b.y + 4, b.w - 8, rh - 8);
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 1;
      for (let x = b.x + 12; x < b.x + b.w - 8; x += 14) {
        g.beginPath();
        g.moveTo(x, b.y + 6);
        g.lineTo(x, b.y + rh - 6);
        g.stroke();
      }
    } else if (horiz) {
      g.fillStyle = hi;
      g.fillRect(b.x, b.y, b.w, rh / 2);
      g.fillStyle = dark;
      g.fillRect(b.x, b.y + rh / 2, b.w, rh / 2);
      roofLines(g, b.x, b.y, b.w, rh, true);
      g.fillStyle = 'rgba(255,230,190,0.12)';
      g.fillRect(b.x, b.y + rh / 2 - 1.5, b.w, 3);
    } else {
      g.fillStyle = hi;
      g.fillRect(b.x, b.y, b.w / 2, rh);
      g.fillStyle = dark;
      g.fillRect(b.x + b.w / 2, b.y, b.w / 2, rh);
      roofLines(g, b.x, b.y, b.w, rh, false);
      g.fillStyle = 'rgba(255,230,190,0.12)';
      g.fillRect(b.x + b.w / 2 - 1.5, b.y, 3, rh);
    }
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 2;
    g.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    // chimneys
    const nch = b.w * b.h > 9000 ? 2 : R() < 0.7 ? 1 : 0;
    for (let i = 0; i < nch; i++) {
      const cx = b.x + 10 + R() * (b.w - 30);
      const cy = b.y + 6 + R() * (rh - 22);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(cx + 3, cy + 4, 14, 12);
      g.fillStyle = '#5a3a2c';
      g.fillRect(cx, cy, 14, 12);
      g.fillStyle = '#120c0a';
      g.fillRect(cx + 3, cy + 2, 8, 6);
      if (cx > 0 && cy > 0 && cx < W && cy < H) out.chimneys.push({ x: cx + 7, y: cy + 4 });
    }
  }

  // Small yards / crates in leftover space to avoid big empty voids.
  for (let i = 0; i < 400; i++) {
    const x = R() * W;
    const y = R() * H;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    if (!free(cx - 1, cy - 1, 4, 4)) continue;
    mark(cx, cy, 2, 2, 3);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(x + 3, y + 3, 16, 14);
    g.fillStyle = R() < 0.5 ? '#3a2b1d' : '#2b2f2c';
    g.fillRect(x, y, 16, 14);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, 15, 13);
  }

  // Lamp posts + light pools.
  for (const l of lamps) {
    const grd = lg.createRadialGradient(l.x, l.y, 0, l.x, l.y, 150);
    grd.addColorStop(0, 'rgba(255,190,90,0.55)');
    grd.addColorStop(0.25, 'rgba(255,160,60,0.22)');
    grd.addColorStop(1, 'rgba(255,140,40,0)');
    lg.fillStyle = grd;
    lg.fillRect(l.x - 150, l.y - 150, 300, 300);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.arc(l.x + 3, l.y + 4, 7, 0, TAU);
    g.fill();
    g.fillStyle = '#1b1a18';
    g.beginPath();
    g.arc(l.x, l.y, 7, 0, TAU);
    g.fill();
    g.strokeStyle = '#8f6a2a';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#ffe2a0';
    g.beginPath();
    g.arc(l.x, l.y, 3.5, 0, TAU);
    g.fill();
  }

  // Night grade: vignette on the base.
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,4,8,0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);

  // Street entry gates: a hint of where the horde comes from.
  for (const p of paths) {
    const [ax, ay] = p.pts[0];
    const [bx, by] = p.pts[1];
    // first on-screen point along the first segment
    let t = 0;
    for (; t < 1; t += 0.01) {
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      if (x >= 0 && y >= 0 && x <= W && y <= H) break;
    }
    const ex = ax + (bx - ax) * t;
    const ey = ay + (by - ay) * t;
    const grd = lg.createRadialGradient(ex, ey, 0, ex, ey, 140);
    grd.addColorStop(0, 'rgba(226,85,63,0.35)');
    grd.addColorStop(1, 'rgba(226,85,63,0)');
    lg.fillStyle = grd;
    lg.fillRect(ex - 140, ey - 140, 280, 280);
  }
  return out;
}

// Canals: stone banks, dark water with a sheen, lock gates and moored boats.
function drawWater(g, lg, sc, R) {
  const trace = (w) => {
    g.beginPath();
    w.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  };
  g.lineJoin = 'miter';
  g.lineCap = 'butt';
  for (const w of sc.water) {
    const ww = w.w || 80;
    trace(w);
    g.lineWidth = ww + 30;
    g.strokeStyle = '#07090a';
    g.stroke();
    trace(w);
    g.lineWidth = ww + 18;
    g.strokeStyle = '#47423a'; // coping stones
    g.stroke();
    trace(w);
    g.lineWidth = ww + 6;
    g.strokeStyle = '#1a1714';
    g.stroke();
    trace(w);
    g.lineWidth = ww;
    g.strokeStyle = '#0f2b33';
    g.stroke();
    trace(w);
    g.lineWidth = ww * 0.55;
    g.strokeStyle = 'rgba(40,96,108,0.35)';
    g.stroke();
  }
  // ripples: short pale dashes along each channel
  g.lineCap = 'round';
  for (const w of sc.water) {
    const ww = w.w || 80;
    for (let i = 1; i < w.pts.length; i++) {
      const [ax, ay] = w.pts[i - 1];
      const [bx, by] = w.pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      for (let d = 20; d < len; d += 26 + R() * 30) {
        const off = (R() - 0.5) * ww * 0.7;
        const x = ax + ux * d - uy * off;
        const y = ay + uy * d + ux * off;
        const l = 8 + R() * 14;
        g.strokeStyle = `rgba(150,200,210,${0.08 + R() * 0.1})`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + ux * l, y + uy * l);
        g.stroke();
      }
    }
  }
  // lock gates: two heavy timber beams meeting in a shallow V, with balance arms
  for (const lk of sc.locks || []) {
    const half = (lk.w || 80) / 2 + 8;
    const a = lk.a || 0; // the channel's direction at the gate (radians)
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const tip = { x: lk.x + ux * 12, y: lk.y + uy * 12 };
    for (const s of [-1, 1]) {
      const bx = lk.x + nx * half * s;
      const by = lk.y + ny * half * s;
      g.lineCap = 'butt';
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 14;
      g.beginPath();
      g.moveTo(bx + 3, by + 4);
      g.lineTo(tip.x + 3, tip.y + 4);
      g.stroke();
      g.strokeStyle = '#4a3220';
      g.lineWidth = 10;
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(tip.x, tip.y);
      g.stroke();
      g.strokeStyle = '#8f6a2a';
      g.lineWidth = 2;
      g.stroke();
      // balance beam on the bank
      g.strokeStyle = '#3a2718';
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx - ux * 46 + nx * 10 * s, by - uy * 46 + ny * 10 * s);
      g.stroke();
    }
    const grd = lg.createRadialGradient(lk.x, lk.y, 0, lk.x, lk.y, 90);
    grd.addColorStop(0, 'rgba(255,190,90,0.25)');
    grd.addColorStop(1, 'rgba(255,190,90,0)');
    lg.fillStyle = grd;
    lg.fillRect(lk.x - 90, lk.y - 90, 180, 180);
  }
  // narrowboats: long hulls with a cabin and a lit window
  for (const b of sc.boats || []) {
    g.save();
    g.translate(b.x, b.y);
    g.rotate(b.a || 0);
    const L = b.len || 150;
    const Wd = 30;
    g.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(g, -L / 2 + 4, -Wd / 2 + 5, L, Wd, 12);
    g.fill();
    g.fillStyle = b.color || '#2f4a2c';
    roundRect(g, -L / 2, -Wd / 2, L, Wd, 12);
    g.fill();
    g.strokeStyle = '#8f6a2a';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#5a3a2c';
    g.fillRect(-L / 2 + 22, -Wd / 2 + 5, L * 0.55, Wd - 10);
    g.fillStyle = '#3a271c';
    for (let x = -L / 2 + 30; x < -L / 2 + 22 + L * 0.55 - 6; x += 16) g.fillRect(x, -Wd / 2 + 5, 2, Wd - 10);
    g.fillStyle = '#ffcf7a';
    g.fillRect(-L / 2 + 22 + L * 0.55 - 14, -4, 7, 8);
    g.fillStyle = '#1b1a18';
    g.beginPath();
    g.arc(L / 2 - 26, 0, 5, 0, TAU);
    g.fill();
    g.restore();
    const grd = lg.createRadialGradient(b.x, b.y, 0, b.x, b.y, 60);
    grd.addColorStop(0, 'rgba(255,180,80,0.18)');
    grd.addColorStop(1, 'rgba(255,180,80,0)');
    lg.fillStyle = grd;
    lg.fillRect(b.x - 60, b.y - 60, 120, 120);
  }
}

// Bridges: wherever a street crosses a canal, iron railings along both kerbs.
function drawBridges(g, paths, water) {
  for (const p of paths) {
    for (let i = 1; i < p.pts.length; i++) {
      const [ax, ay] = p.pts[i - 1];
      const [bx, by] = p.pts[i];
      for (const w of water) {
        for (let j = 1; j < w.pts.length; j++) {
          const hit = segCross(ax, ay, bx, by, ...w.pts[j - 1], ...w.pts[j]);
          if (!hit) continue;
          const len = Math.hypot(bx - ax, by - ay);
          const ux = (bx - ax) / len;
          const uy = (by - ay) / len;
          const span = (w.w || 80) / 2 + 14;
          for (const s of [-1, 1]) {
            const ox = -uy * s * (STREET_W / 2 + 5);
            const oy = ux * s * (STREET_W / 2 + 5);
            g.lineCap = 'butt';
            g.strokeStyle = 'rgba(0,0,0,0.55)';
            g.lineWidth = 9;
            g.beginPath();
            g.moveTo(hit.x - ux * span + ox + 2, hit.y - uy * span + oy + 3);
            g.lineTo(hit.x + ux * span + ox + 2, hit.y + uy * span + oy + 3);
            g.stroke();
            g.strokeStyle = '#6b5a3c';
            g.lineWidth = 6;
            g.beginPath();
            g.moveTo(hit.x - ux * span + ox, hit.y - uy * span + oy);
            g.lineTo(hit.x + ux * span + ox, hit.y + uy * span + oy);
            g.stroke();
            g.fillStyle = '#c99a4a';
            for (const e of [-1, 1]) {
              g.beginPath();
              g.arc(hit.x + ux * span * e + ox, hit.y + uy * span * e + oy, 5, 0, TAU);
              g.fill();
            }
          }
        }
      }
    }
  }
}

function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const r = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (!r) return null;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / r;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / r;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
}

// A yard: a ring of flagstones with a brass centrepiece — a coiled mainspring
// ("spring") or a great gear set into the ground ("gear").
function drawYard(g, lg, yd, R) {
  const { x, y, r } = yd;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.arc(x + 4, y + 6, r + 10, 0, TAU);
  g.fill();
  g.fillStyle = '#2a2621';
  g.beginPath();
  g.arc(x, y, r + 8, 0, TAU);
  g.fill();
  g.fillStyle = '#3a352f';
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  // flagstone joints
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1.5;
  for (let rr = 26; rr < r; rr += 24) {
    g.beginPath();
    g.arc(x, y, rr, 0, TAU);
    g.stroke();
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + R() * 0.1;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * 26, y + Math.sin(a) * 26);
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    g.stroke();
  }
  g.lineWidth = 4;
  g.strokeStyle = '#8f6a2a';
  g.beginPath();
  g.arc(x, y, r + 4, 0, TAU);
  g.stroke();
  if (yd.kind === 'gear') {
    gearPath(g, x, y, r * 0.62, 14, 0.1, 0.2);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.save();
    g.translate(3, 5);
    g.fill();
    g.restore();
    gearPath(g, x, y, r * 0.62, 14, 0.1, 0.2);
    g.fillStyle = '#6e5224';
    g.fill();
    g.strokeStyle = '#c99a4a';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#3a352f';
    g.beginPath();
    g.arc(x, y, r * 0.22, 0, TAU);
    g.fill();
    g.stroke();
  } else {
    // a coiled mainspring: an Archimedean spiral of brass strip
    const turns = 4.2;
    const r0 = r * 0.1;
    const r1 = r * 0.8;
    const spiral = () => {
      g.beginPath();
      for (let t = 0; t <= 1; t += 0.004) {
        const a = t * turns * TAU;
        const rr = r0 + (r1 - r0) * t;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        t ? g.lineTo(px, py) : g.moveTo(px, py);
      }
    };
    g.lineCap = 'round';
    g.save();
    g.translate(3, 5);
    spiral();
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 9;
    g.stroke();
    g.restore();
    spiral();
    g.strokeStyle = '#8f6a2a';
    g.lineWidth = 8;
    g.stroke();
    spiral();
    g.strokeStyle = '#e0b860';
    g.lineWidth = 2.5;
    g.stroke();
    g.fillStyle = '#c99a4a';
    g.beginPath();
    g.arc(x, y, r0 + 4, 0, TAU);
    g.fill();
  }
  const grd = lg.createRadialGradient(x, y, 0, x, y, r * 1.2);
  grd.addColorStop(0, 'rgba(255,190,90,0.22)');
  grd.addColorStop(1, 'rgba(255,190,90,0)');
  lg.fillStyle = grd;
  lg.fillRect(x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4);
}

function roofLines(g, x, y, w, h, horiz) {
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 1;
  g.beginPath();
  if (horiz) {
    for (let yy = y + 6; yy < y + h; yy += 6) {
      g.moveTo(x, yy);
      g.lineTo(x + w, yy);
    }
  } else {
    for (let xx = x + 6; xx < x + w; xx += 6) {
      g.moveTo(xx, y);
      g.lineTo(xx, y + h);
    }
  }
  g.stroke();
}

function cobblePattern(R) {
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = '#16120f';
  g.fillRect(0, 0, 48, 48);
  const rows = 4;
  const rh = 48 / rows;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? 8 : 0;
    for (let i = -1; i < 3; i++) {
      const x = i * 16 + off;
      const v = 52 + Math.floor(R() * 22);
      g.fillStyle = `rgb(${v + 4},${v},${v - 6})`;
      roundRect(g, x + 1.5, r * rh + 1.5, 13, rh - 3, 4);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.07)';
      roundRect(g, x + 3, r * rh + 2.5, 8, 3, 2);
      g.fill();
    }
  }
  return c;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
