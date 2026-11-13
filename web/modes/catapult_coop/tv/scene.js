// The keep in isometric view: projection, the static ground layer and the per-cell block
// sprites used by the depth-sorted pass.
//
// Projection: grid cell (x, y) has its centre at grid point (x, y); z is height in levels
// (0 courtyard, 1 ramparts). Screen = origin + ((x - y)·TW/2, (x + y)·TH/2 − z·HZ), so the
// grid's (0, 0) corner is at the top of the screen and the (w, h) corner at the bottom: the
// viewer stands at the (w, h) corner and the walls (row y = 0, column x = 0) are the far
// sides, with the lanes running away up-right (row 0) and up-left (column 0).
//
// Depth: something at grid point (x, y) is in front of everything with a smaller x + y. A
// raised cell or prop has key x + y − 0.01; an entity standing on a cell has key x + y (so
// it is drawn after its own cell and before anything nearer the viewer). Flat floor is in
// the pre-rendered ground layer and never occludes.

import { rng, softSprite, TAU } from '../../tower_defense/tv/geom.js';

export const W = 1920;
export const H = 1080;

const TH_K = 0.5; // tile height / tile width
const HZ_K = 0.34; // one height level / tile width
export const OUT_Z = -0.32; // the ground outside the keep (the keep stands on a plinth)
export const CRATE_Z = 0.78;
export const WALL_Z = 1; // wall walk height (the merlons stand above it)

// Fit box for the whole scene (logical px).
const BOX = { x0: 34, x1: W - 34, y0: 40, y1: H - 12 };

export class Scene {
  // keep: map.keeps[i]; layout: room.layout (same w/h)
  constructor(keep, layout, px, box) {
    this.box = box || BOX;
    this.keep = keep;
    this.lay = layout;
    this.w = keep.w;
    this.h = keep.h;
    this.px = px;
    this.fit();
    this.analyse();
    this.build();
  }

  // ---------------------------------------------------------------- projection

  fit() {
    const pts = [];
    const { w, h } = this;
    for (const [x, y] of [[-0.5, -0.5], [w - 0.5, -0.5], [-0.5, h - 0.5], [w - 0.5, h - 0.5]]) {
      pts.push([x, y, OUT_Z], [x, y, 1.6]);
    }
    for (const L of this.keep.lanes) {
      const far = L.len - 1;
      const ex = L.x + far * L.dir[0];
      const ey = L.y + far * L.dir[1];
      for (const [dx, dy] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) pts.push([ex + dx, ey + dy, OUT_Z], [ex + dx, ey + dy, 1.0]);
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y, z] of pts) {
      const u = (x - y) / 2;
      const v = ((x + y) * TH_K) / 2 - z * HZ_K;
      minX = Math.min(minX, u);
      maxX = Math.max(maxX, u);
      minY = Math.min(minY, v);
      maxY = Math.max(maxY, v);
    }
    const B = this.box;
    const tw = Math.min((B.x1 - B.x0) / (maxX - minX), (B.y1 - B.y0) / (maxY - minY));
    this.TW = tw;
    this.TH = tw * TH_K;
    this.HZ = tw * HZ_K;
    this.k = tw / 130; // sprite scale (sprites are designed at TW = 130)
    this.ox = (B.x0 + B.x1) / 2 - ((minX + maxX) / 2) * tw;
    this.oy = (B.y0 + B.y1) / 2 - ((minY + maxY) / 2) * tw;
  }

  // screen point of grid point (x, y) at height z
  p(x, y, z = 0) {
    return [this.ox + ((x - y) * this.TW) / 2, this.oy + ((x + y) * this.TH) / 2 - z * this.HZ];
  }

  // affine matrix mapping grid units on the plane at height z (around grid point x, y) to screen
  planeAt(g, x, y, z, s = 1) {
    const [sx, sy] = this.p(x, y, z);
    const a = (this.TW / 2) * s;
    const b = (this.TH / 2) * s;
    g.transform(a, b, -a, b, sx, sy);
  }

  // ---------------------------------------------------------------- cells

  cell(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.lay.cells[y]?.[x] || null;
  }

  // the height an engineer stands at on (x, y)
  standZ(x, y) {
    const c = this.cell(x, y);
    if (!c) return 0;
    if (c.kind === 'stairs') return 0.5;
    return c.h || 0;
  }

  // the height of the top surface (for things lying on it)
  topZ(x, y) {
    const c = this.cell(x, y);
    if (!c) return OUT_Z;
    if (c.kind === 'stairs') return 0.5;
    if (c.kind === 'block' && !c.h) return CRATE_Z;
    return c.h || 0;
  }

  // world point of lane `lane` position p (float; < 0 runs into the wall)
  lanePt(lane, p) {
    const L = this.keep.lanes[lane];
    if (!L) return [0, 0];
    return [L.x + p * L.dir[0], L.y + p * L.dir[1]];
  }

  catapult(id) {
    return this.keep.catapults.find((c) => c.id === id);
  }

  laneOfCat(id) {
    const c = this.catapult(id);
    return this.keep.lanes.find((l) => l.id === (c ? c.lane : id)) || this.keep.lanes[id];
  }

  // classify blocks: crates vs pipes vs wall; stairs direction
  analyse() {
    const r = rng(1234 + this.w * 7);
    this.props = []; // {x, y, kind}
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.cell(x, y);
        if (!c) continue;
        if (c.kind === 'block') {
          if (c.h) this.props.push({ x, y, kind: x === 0 || y === 0 ? 'wall' : 'pillar' });
          else this.props.push({ x, y, kind: (x * 7 + y * 13) % 5 === 2 ? 'pipes' : 'crate', seed: r() });
        } else if (c.kind === 'catapult') this.props.push({ x, y, kind: 'wall', cat: true });
        else if (c.kind === 'floor' && c.h) this.props.push({ x, y, kind: 'raised' });
        else if (c.kind === 'stairs') this.props.push({ x, y, kind: 'stairs', dir: this.stairDir(x, y) });
      }
    }
  }

  // stairs rise toward a walkable h1 neighbour; returns that direction [dx, dy]
  stairDir(x, y) {
    const opts = [];
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const n = this.cell(x + dx, y + dy);
      if (n && n.kind === 'floor' && n.h) opts.push([dx, dy]);
    }
    if (!opts.length) return [0, -1];
    // prefer the one whose opposite side is low ground (the approach)
    for (const d of opts) {
      const o = this.cell(x - d[0], y - d[1]);
      if (o && (o.kind === 'floor' || o.kind === 'stairs') && !o.h) return d;
    }
    return opts[0];
  }

  // ---------------------------------------------------------------- static layers

  build() {
    const px = Math.min(2, Math.max(1, this.px));
    this.rpx = px;
    this.ground = drawGround(this, px);
    this.light = drawLight(this, px);
    this.blocks = [];
    for (const pr of this.props) {
      const spr = propSprite(this, pr, px);
      if (spr) this.blocks.push({ ...pr, key: pr.x + pr.y - 0.01, ...spr });
    }
  }
}

// ---------------------------------------------------------------- drawing helpers

function poly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

// top diamond of cell (x, y) at height z, optionally inset
function diamond(S, x, y, z, inset = 0) {
  const d = 0.5 - inset;
  return [S.p(x - d, y - d, z), S.p(x + d, y - d, z), S.p(x + d, y + d, z), S.p(x - d, y + d, z)];
}

function mix(a, b, t) {
  const pa = hex(a);
  const pb = hex(b);
  return `rgb(${Math.round(pa[0] + (pb[0] - pa[0]) * t)},${Math.round(pa[1] + (pb[1] - pa[1]) * t)},${Math.round(pa[2] + (pb[2] - pa[2]) * t)})`;
}
function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// ---------------------------------------------------------------- ground layer

function drawGround(S, px) {
  const c = newCanvas(W * px, H * px);
  const g = c.getContext('2d');
  g.scale(px, px);
  const r = rng(99);
  // night sky over the moor
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0a1214');
  sky.addColorStop(0.5, '#0f1a1c');
  sky.addColorStop(1, '#0b1012');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  const { w, h, keep } = S;
  const maxLen = Math.max(...keep.lanes.map((l) => l.len));
  // the moor: one big diamond of ground around keep and lanes
  const m0 = -maxLen - 1.5;
  const moor = [S.p(m0, m0, OUT_Z), S.p(w + 1.5, m0, OUT_Z), S.p(w + 1.5, h + 1.5, OUT_Z), S.p(m0, h + 1.5, OUT_Z)];
  const [cx, cy] = S.p((w - 1) / 2 - 2, (h - 1) / 2 - 2, OUT_Z);
  const rad = g.createRadialGradient(cx, cy, 50, cx, cy, S.TW * (w + maxLen) * 0.62);
  rad.addColorStop(0, '#2a3528');
  rad.addColorStop(0.55, '#1a241f');
  rad.addColorStop(1, 'rgba(14,20,20,0)');
  poly(g, moor);
  g.fillStyle = rad;
  g.fill();
  // moor tufts
  for (let i = 0; i < 520; i++) {
    const gx = m0 + r() * (w + 1.5 - m0);
    const gy = m0 + r() * (h + 1.5 - m0);
    if (gx > -0.6 && gy > -0.6 && gx < w - 0.4 && gy < h - 0.4) continue;
    const [sx, sy] = S.p(gx, gy, OUT_Z);
    const d = Math.hypot(sx - cx, sy - cy) / (S.TW * (w + maxLen) * 0.6);
    if (d > 1) continue;
    g.globalAlpha = (1 - d) * 0.55;
    g.fillStyle = r() < 0.5 ? '#3a4a30' : '#24301f';
    g.beginPath();
    g.ellipse(sx, sy, 3 + r() * 7 * S.k, 1.5 + r() * 3 * S.k, 0, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;

  // lanes: rutted dirt roads with a stone at every cell boundary
  for (const L of keep.lanes) {
    const perp = [-L.dir[1], L.dir[0]];
    for (let p = 0; p < L.len; p++) {
      const x = L.x + p * L.dir[0];
      const y = L.y + p * L.dir[1];
      const d = diamond(S, x, y, OUT_Z, 0.02);
      poly(g, d);
      const t = p / (L.len - 1);
      g.fillStyle = mix('#5a4630', '#3a2e22', t);
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(20,14,8,0.55)';
      g.stroke();
      // ruts along the lane
      g.strokeStyle = 'rgba(30,20,10,0.45)';
      g.lineWidth = 3 * S.k;
      for (const o of [-0.22, 0.22]) {
        const a = S.p(x + perp[0] * o - L.dir[0] * 0.5, y + perp[1] * o - L.dir[1] * 0.5, OUT_Z);
        const b = S.p(x + perp[0] * o + L.dir[0] * 0.5, y + perp[1] * o + L.dir[1] * 0.5, OUT_Z);
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.stroke();
      }
      // pebbles
      for (let i = 0; i < 5; i++) {
        const [sx, sy] = S.p(x + (r() - 0.5) * 0.85, y + (r() - 0.5) * 0.85, OUT_Z);
        g.fillStyle = r() < 0.5 ? 'rgba(140,120,90,0.5)' : 'rgba(25,18,10,0.5)';
        g.beginPath();
        g.ellipse(sx, sy, 2.2 * S.k, 1.2 * S.k, 0, 0, TAU);
        g.fill();
      }
      // boundary stones (count distance)
      for (const s of [-0.5, 0.5]) {
        const [sx, sy] = S.p(x + perp[0] * s * 1.05 + L.dir[0] * 0.5, y + perp[1] * s * 1.05 + L.dir[1] * 0.5, OUT_Z);
        g.fillStyle = '#6d6656';
        g.beginPath();
        g.ellipse(sx, sy, 5 * S.k, 3 * S.k, 0, 0, TAU);
        g.fill();
        g.fillStyle = '#a49b84';
        g.beginPath();
        g.ellipse(sx - 1, sy - 1.5 * S.k, 3.5 * S.k, 2 * S.k, 0, 0, TAU);
        g.fill();
      }
    }
    // the far end: a dark breach in the hedge where machines come from
    const fx = L.x + (L.len - 0.4) * L.dir[0];
    const fy = L.y + (L.len - 0.4) * L.dir[1];
    const [sx, sy] = S.p(fx, fy, OUT_Z);
    g.globalAlpha = 0.45;
    g.drawImage(softSprite('rgba(0,0,0,1)', 64, 0.3), sx - S.TW * 0.6, sy - S.TH * 0.6, S.TW * 1.2, S.TH * 1.2);
    g.globalAlpha = 1;
  }

  // the keep plinth: near sides visible
  const near1 = [S.p(w - 0.5, -0.5, 0), S.p(w - 0.5, h - 0.5, 0), S.p(w - 0.5, h - 0.5, OUT_Z), S.p(w - 0.5, -0.5, OUT_Z)];
  const near2 = [S.p(-0.5, h - 0.5, 0), S.p(w - 0.5, h - 0.5, 0), S.p(w - 0.5, h - 0.5, OUT_Z), S.p(-0.5, h - 0.5, OUT_Z)];
  poly(g, near1);
  g.fillStyle = '#3b3833';
  g.fill();
  poly(g, near2);
  g.fillStyle = '#4a463f';
  g.fill();
  // courses of masonry on the plinth
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < w; i++) {
    for (const [a, b] of [[S.p(w - 0.5, i - 0.5, 0), S.p(w - 0.5, i - 0.5, OUT_Z)], [S.p(i - 0.5, h - 0.5, 0), S.p(i - 0.5, h - 0.5, OUT_Z)]]) {
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
  }

  // courtyard: flagstones on every cell (raised cells cover theirs)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = S.cell(x, y);
      if (!cell || cell.kind === 'void') continue;
      const d = diamond(S, x, y, 0);
      poly(g, d);
      const shade = ((x * 31 + y * 17) % 7) / 7;
      g.fillStyle = mix('#5d5a50', '#4c4a43', shade);
      g.fill();
      // inner stone lines
      g.lineWidth = 1.2;
      g.strokeStyle = 'rgba(20,18,14,0.6)';
      g.stroke();
      const ins = diamond(S, x, y, 0, 0.06);
      poly(g, ins);
      g.strokeStyle = 'rgba(255,240,210,0.07)';
      g.stroke();
      // a crack or two
      if (r() < 0.35) {
        const [ax, ay] = S.p(x - 0.2 + r() * 0.2, y - 0.3 + r() * 0.2, 0);
        g.strokeStyle = 'rgba(20,18,14,0.45)';
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(ax + (r() - 0.5) * 18 * S.k, ay + r() * 10 * S.k);
        g.lineTo(ax + (r() - 0.5) * 30 * S.k, ay + r() * 18 * S.k);
        g.stroke();
      }
    }
  }
  // soft vignette at the edges of the stage
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  return c;
}

// gaslight pools (drawn additively, flickering)
function drawLight(S, px) {
  const c = newCanvas(W * px, H * px);
  const g = c.getContext('2d');
  g.scale(px, px);
  const { w, h } = S;
  const spots = [
    [w * 0.5, h * 0.5, 0, 5.2, 0.16],
    [1.2, 1.2, 1, 3.2, 0.22],
    [w - 1, 1, 1, 2.6, 0.18],
    [1, h - 1, 1, 2.6, 0.18],
  ];
  for (const [x, y, z, rr, a] of spots) {
    const [sx, sy] = S.p(x, y, z);
    const R = rr * S.TW * 0.5;
    g.globalAlpha = a;
    g.drawImage(softSprite('rgba(255,182,72,1)', 128, 0.05), sx - R, sy - R * 0.6, R * 2, R * 1.2);
  }
  g.globalAlpha = 1;
  return c;
}

// ---------------------------------------------------------------- props (one sprite per cell)

// bounding box (logical px) of a cell column from z0 to z1, with padding
function cellBox(S, x, y, z0, z1, pad = 4) {
  const pts = [S.p(x - 0.5, y - 0.5, z1), S.p(x + 0.5, y - 0.5, z1), S.p(x - 0.5, y + 0.5, z1), S.p(x + 0.5, y + 0.5, z0), S.p(x + 0.5, y - 0.5, z0), S.p(x - 0.5, y + 0.5, z0)];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [a, b] of pts) {
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, a);
    y1 = Math.max(y1, b);
  }
  return { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + pad * 2), h: Math.ceil(y1 - y0 + pad * 2) };
}

function propSprite(S, pr, px) {
  const { x, y, kind } = pr;
  let z1 = 1;
  let extraTop = 0;
  if (kind === 'wall') extraTop = 0.45;
  if (kind === 'crate' || kind === 'pipes') z1 = CRATE_Z + (kind === 'pipes' ? 0.5 : 0.1);
  if (kind === 'stairs') z1 = 1;
  const z0 = kind === 'wall' && (x === 0 || y === 0) ? OUT_Z : 0;
  const box = cellBox(S, x, y, z0, z1 + extraTop, 6);
  const c = newCanvas(box.w * px, box.h * px);
  const g = c.getContext('2d');
  g.scale(px, px);
  g.translate(-box.x, -box.y);
  g.lineJoin = 'round';
  switch (kind) {
    case 'wall':
      drawWallCell(S, g, x, y, pr.cat);
      break;
    case 'raised':
    case 'pillar':
      drawRaised(S, g, x, y, kind === 'pillar');
      break;
    case 'crate':
      drawCrate(S, g, x, y, pr.seed);
      break;
    case 'pipes':
      drawPipes(S, g, x, y);
      break;
    case 'stairs':
      drawStairs(S, g, x, y, pr.dir);
      break;
  }
  return { img: c, bx: box.x, by: box.y, bw: box.w, bh: box.h };
}

// is the neighbour lower than height z (so the side face shows)?
function lowerAt(S, x, y, z) {
  const c = S.cell(x, y);
  if (!c) return true;
  if (c.kind === 'block' && c.h) return false;
  if (c.kind === 'catapult') return false;
  if (c.kind === 'stairs') return z > 0.5;
  return (c.h || 0) < z;
}

function stoneFaces(S, g, x, y, z0, z1, topCol, rightCol, leftCol) {
  // +x face (lower right) and +y face (lower left)
  if (lowerAt(S, x + 1, y, z1)) {
    const f = [S.p(x + 0.5, y - 0.5, z1), S.p(x + 0.5, y + 0.5, z1), S.p(x + 0.5, y + 0.5, z0), S.p(x + 0.5, y - 0.5, z0)];
    poly(g, f);
    g.fillStyle = rightCol;
    g.fill();
    bricks(S, g, f, z0, z1, x + 0.5, y, 'x');
  }
  if (lowerAt(S, x, y + 1, z1)) {
    const f = [S.p(x - 0.5, y + 0.5, z1), S.p(x + 0.5, y + 0.5, z1), S.p(x + 0.5, y + 0.5, z0), S.p(x - 0.5, y + 0.5, z0)];
    poly(g, f);
    g.fillStyle = leftCol;
    g.fill();
    bricks(S, g, f, z0, z1, x, y + 0.5, 'y');
  }
  const top = diamond(S, x, y, z1);
  poly(g, top);
  g.fillStyle = topCol;
  g.fill();
  g.lineWidth = 1.2;
  g.strokeStyle = 'rgba(15,12,8,0.7)';
  g.stroke();
  poly(g, diamond(S, x, y, z1, 0.07));
  g.strokeStyle = 'rgba(255,235,200,0.10)';
  g.stroke();
}

// brick courses on a vertical face
function bricks(S, g, f, z0, z1, fx, fy, axis) {
  g.save();
  poly(g, f);
  g.clip();
  g.strokeStyle = 'rgba(0,0,0,0.32)';
  g.lineWidth = 1;
  const rows = Math.max(1, Math.round((z1 - z0) * 4));
  for (let i = 1; i < rows; i++) {
    const z = z0 + ((z1 - z0) * i) / rows;
    const a = axis === 'x' ? S.p(fx, fy - 0.5, z) : S.p(fx - 0.5, fy, z);
    const b = axis === 'x' ? S.p(fx, fy + 0.5, z) : S.p(fx + 0.5, fy, z);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
    for (let j = 0; j < 3; j++) {
      const t = (j + (i % 2 ? 0.5 : 0)) / 3 - 0.5 + 1 / 6;
      const zz = z0 + ((z1 - z0) * (i - 1)) / rows;
      const p0 = axis === 'x' ? S.p(fx, fy + t, z) : S.p(fx + t, fy, z);
      const p1 = axis === 'x' ? S.p(fx, fy + t, zz) : S.p(fx + t, fy, zz);
      g.beginPath();
      g.moveTo(p0[0], p0[1]);
      g.lineTo(p1[0], p1[1]);
      g.stroke();
    }
  }
  // shading toward the bottom
  const [, ya] = S.p(fx, fy, z1);
  const [, yb] = S.p(fx, fy, z0);
  const gr = g.createLinearGradient(0, ya, 0, yb);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = gr;
  g.fill();
  g.restore();
  poly(g, f);
  g.lineWidth = 1.2;
  g.strokeStyle = 'rgba(10,8,6,0.75)';
  g.stroke();
}

function drawRaised(S, g, x, y, pillar) {
  stoneFaces(S, g, x, y, 0, 1, pillar ? '#4c4840' : '#7a7262', '#4a453c', '#5d574b');
  if (!pillar) {
    // walkway planks/flags
    g.strokeStyle = 'rgba(30,25,18,0.35)';
    g.lineWidth = 1;
    for (const t of [-0.17, 0.17]) {
      const a = S.p(x - 0.45, y + t, 1);
      const b = S.p(x + 0.45, y + t, 1);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
  }
}

function drawWallCell(S, g, x, y, isCat) {
  const z0 = x === 0 || y === 0 ? OUT_Z : 0;
  stoneFaces(S, g, x, y, z0, WALL_Z, isCat ? '#6f6656' : '#696255', '#45403a', '#57514a');
  if (isCat) {
    // timber deck for the catapult
    poly(g, diamond(S, x, y, WALL_Z, 0.1));
    g.fillStyle = '#5a3e22';
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.stroke();
    g.strokeStyle = 'rgba(20,12,4,0.55)';
    for (let i = -2; i <= 2; i++) {
      const a = S.p(x - 0.4, y + i * 0.16, WALL_Z);
      const b = S.p(x + 0.4, y + i * 0.16, WALL_Z);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
    return;
  }
  // merlons on the outer edge
  const outerY = y === 0;
  const outerX = x === 0;
  const mz = WALL_Z + 0.42;
  const ms = [];
  if (outerY) ms.push([[x - 0.45, y - 0.48], [x - 0.05, y - 0.48]], [[x + 0.1, y - 0.48], [x + 0.45, y - 0.48]]);
  if (outerX) ms.push([[x - 0.48, y - 0.45], [x - 0.48, y - 0.05]], [[x - 0.48, y + 0.1], [x - 0.48, y + 0.45]]);
  for (const [a, b] of ms) {
    const d = 0.18;
    const n = outerY ? [0, d] : [d, 0];
    drawBox(S, g, a[0], a[1], b[0] + n[0], b[1] + n[1], WALL_Z, mz, '#79705f', '#4a453c', '#5e574b');
  }
}

// axis-aligned box from grid (x0,y0) to (x1,y1), z0..z1, viewed from (+x,+y)
function drawBox(S, g, x0, y0, x1, y1, z0, z1, top, right, left) {
  const fr = [S.p(x1, y0, z1), S.p(x1, y1, z1), S.p(x1, y1, z0), S.p(x1, y0, z0)];
  poly(g, fr);
  g.fillStyle = right;
  g.fill();
  g.strokeStyle = 'rgba(10,8,6,0.7)';
  g.lineWidth = 1;
  g.stroke();
  const fl = [S.p(x0, y1, z1), S.p(x1, y1, z1), S.p(x1, y1, z0), S.p(x0, y1, z0)];
  poly(g, fl);
  g.fillStyle = left;
  g.fill();
  g.stroke();
  const tp = [S.p(x0, y0, z1), S.p(x1, y0, z1), S.p(x1, y1, z1), S.p(x0, y1, z1)];
  poly(g, tp);
  g.fillStyle = top;
  g.fill();
  g.stroke();
}

function drawCrate(S, g, x, y, seed) {
  const s = 0.38 - (seed || 0) * 0.04;
  drawBox(S, g, x - s, y - s, x + s, y + s, 0, CRATE_Z, '#a07a48', '#6b4a28', '#86603a');
  // planks and cross braces
  g.strokeStyle = 'rgba(40,24,8,0.75)';
  g.lineWidth = 2 * S.k;
  const faces = [
    [S.p(x + s, y - s, CRATE_Z), S.p(x + s, y + s, CRATE_Z), S.p(x + s, y + s, 0), S.p(x + s, y - s, 0)],
    [S.p(x - s, y + s, CRATE_Z), S.p(x + s, y + s, CRATE_Z), S.p(x + s, y + s, 0), S.p(x - s, y + s, 0)],
  ];
  for (const f of faces) {
    g.beginPath();
    g.moveTo(f[0][0], f[0][1]);
    g.lineTo(f[2][0], f[2][1]);
    g.moveTo(f[1][0], f[1][1]);
    g.lineTo(f[3][0], f[3][1]);
    g.stroke();
    // frame
    g.lineWidth = 3 * S.k;
    poly(g, f);
    g.strokeStyle = 'rgba(55,34,12,0.9)';
    g.stroke();
    g.lineWidth = 2 * S.k;
    g.strokeStyle = 'rgba(40,24,8,0.75)';
  }
  // brass corner plates
  g.fillStyle = '#d9b25a';
  for (const [a, b, c] of [[x + s, y + s, CRATE_Z], [x + s, y + s, 0.06], [x + s, y - s, CRATE_Z], [x - s, y + s, CRATE_Z]]) {
    const [sx, sy] = S.p(a, b, c);
    g.beginPath();
    g.arc(sx, sy, 2.6 * S.k, 0, TAU);
    g.fill();
  }
  // stencilled mark on top
  const [tx, ty] = S.p(x, y, CRATE_Z);
  g.save();
  g.translate(tx, ty);
  g.scale(1, 0.5);
  g.strokeStyle = 'rgba(40,24,8,0.6)';
  g.lineWidth = 2.5 * S.k;
  g.beginPath();
  g.arc(0, 0, 11 * S.k, 0, TAU);
  g.stroke();
  g.restore();
}

function drawPipes(S, g, x, y) {
  // a squat boiler with pipes: copper drum on an iron base
  drawBox(S, g, x - 0.4, y - 0.4, x + 0.4, y + 0.4, 0, 0.18, '#3d3a36', '#24221f', '#2f2c28');
  const [bx, by] = S.p(x, y, 0.18);
  const [, ty] = S.p(x, y, CRATE_Z + 0.35);
  const rw = S.TW * 0.3;
  const rh = rw * 0.5;
  const gr = g.createLinearGradient(bx - rw, 0, bx + rw, 0);
  gr.addColorStop(0, '#5a2e18');
  gr.addColorStop(0.35, '#d1794a');
  gr.addColorStop(0.6, '#a85a32');
  gr.addColorStop(1, '#4a2412');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(bx - rw, ty);
  g.lineTo(bx - rw, by);
  g.ellipse(bx, by, rw, rh, 0, Math.PI, 0, true);
  g.lineTo(bx + rw, ty);
  g.closePath();
  g.fill();
  g.strokeStyle = '#2a1408';
  g.lineWidth = 1.5;
  g.stroke();
  // bands
  g.strokeStyle = '#d9b25a';
  g.lineWidth = 3 * S.k;
  for (const t of [0.25, 0.7]) {
    const yy = ty + (by - ty) * t;
    g.beginPath();
    g.ellipse(bx, yy, rw, rh, 0, 0, Math.PI);
    g.stroke();
  }
  // lid
  g.fillStyle = '#e09a6a';
  g.beginPath();
  g.ellipse(bx, ty, rw, rh, 0, 0, TAU);
  g.fill();
  g.strokeStyle = '#2a1408';
  g.lineWidth = 1.5;
  g.stroke();
  // pipe elbow
  g.strokeStyle = '#8a8d90';
  g.lineWidth = 7 * S.k;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(bx + rw * 0.3, ty);
  g.lineTo(bx + rw * 0.3, ty - 22 * S.k);
  g.lineTo(bx + rw * 0.9, ty - 30 * S.k);
  g.stroke();
  g.strokeStyle = '#c8cbcc';
  g.lineWidth = 2.5 * S.k;
  g.stroke();
  g.lineCap = 'butt';
  // gauge
  g.fillStyle = '#efe3c2';
  g.beginPath();
  g.arc(bx - rw * 0.35, ty + (by - ty) * 0.48, 7 * S.k, 0, TAU);
  g.fill();
  g.strokeStyle = '#3a2a0c';
  g.lineWidth = 1.5;
  g.stroke();
}

function drawStairs(S, g, x, y, dir) {
  // steps rise toward dir (the h1 neighbour); the cell is h0
  const n = 4;
  const [dx, dy] = dir;
  // along: unit along the rise; across: perpendicular
  const ax = [-dy, dx];
  // corners in local (u along -0.5..0.5, v across -0.5..0.5)
  const P = (u, v, z) => S.p(x + dx * u + ax[0] * v, y + dy * u + ax[1] * v, z);
  // one box per step, drawn back to front
  const steps = [];
  for (let i = 0; i < n; i++) {
    const u0 = -0.5 + i / n;
    const u1 = u0 + 1 / n;
    const z = (i + 1) / n;
    const xs = [x + dx * u0 + ax[0] * -0.5, x + dx * u1 + ax[0] * 0.5];
    const ys = [y + dy * u0 + ax[1] * -0.5, y + dy * u1 + ax[1] * 0.5];
    steps.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), z });
  }
  steps.sort((a, b) => a.x0 + a.y0 - (b.x0 + b.y0));
  for (const s of steps) drawBox(S, g, s.x0, s.y0, s.x1, s.y1, 0, s.z, '#8a8270', '#4e493f', '#615b4f');
  // a brass handrail on one side
  g.strokeStyle = '#b88a34';
  g.lineWidth = 3 * S.k;
  const a = P(-0.5, 0.46, 0.45);
  const b = P(0.5, 0.46, 1.45);
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
  g.lineWidth = 2 * S.k;
  for (const u of [-0.4, 0.4]) {
    const t = P(u, 0.46, (u + 0.5) + 0.45);
    const bt = P(u, 0.46, (u + 0.5));
    g.beginPath();
    g.moveTo(t[0], t[1]);
    g.lineTo(bt[0], bt[1]);
    g.stroke();
  }
}
