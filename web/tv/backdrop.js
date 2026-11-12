// Brasswick at night: the static town layers, drawn once from map data.
//
// Produces two offscreen canvases at logical 1920x1080 × `res`:
//   base  - ground, cobbled streets, plaza, rooftops, lamp posts
//   light - additive gaslight pools (drawn every frame with a slight flicker)
// plus a list of chimney positions for animated smoke.
//
// If /assets/img/backdrop.png exists it replaces the procedural base (the
// light layer and chimneys are then skipped; a painted backdrop has its own).

import { TAU, rng, distToPaths } from './geom.js';

export const STREET_W = 64;

let painted = null;
let probed = null;

// Probe once for a painted backdrop. Resolves to an Image or null.
export function probeBackdrop() {
  if (probed) return probed;
  probed = fetch('/assets/img/backdrop.png', { method: 'HEAD' })
    .then((r) => {
      if (!r.ok) return null;
      return new Promise((res) => {
        const img = new Image();
        img.onload = () => res((painted = img));
        img.onerror = () => res(null);
        img.src = '/assets/img/backdrop.png';
      });
    })
    .catch(() => null);
  return probed;
}

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

  const R = rng(0xb7a55);
  const paths = map.paths;
  const T = map.tower;

  // --- ground: damp soot with mottling
  g.fillStyle = '#0e1719';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    const x = R() * W;
    const y = R() * H;
    const r = 60 + R() * 220;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const c = R() < 0.5 ? '20,36,38' : '8,12,13';
    grd.addColorStop(0, `rgba(${c},0.5)`);
    grd.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.18)';
    g.fillRect(R() * W, R() * H, 2, 2);
  }

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
  strokePaths(STREET_W, g.createPattern(cobblePattern(R), 'repeat'));
  strokePaths(STREET_W * 0.4, 'rgba(255,220,170,0.035)'); // worn centre

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

  const roofs = [
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
