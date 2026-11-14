// The keep in isometric view, in bright daylight: projection, the static (cached) layers and
// the per-cell prop sprites used by the depth-sorted pass.
//
// Projection: grid cell (x, y) has its centre at grid point (x, y); z is height in levels
// (0 courtyard, 1 ramparts). Screen = origin + ((x - y)·TW/2, (x + y)·TH/2 − z·HZ), so the
// grid's (0, 0) corner is at the top of the screen and the (w, h) corner at the bottom: the
// viewer stands at the (w, h) corner and the walls (row y = 0, column x = 0) are the far
// sides, with the lanes running away up-right (row 0) and up-left (column 0) over the lawn.
//
// Readability first: a flat, saturated palette (lawn green outside, light stone for walls and
// raised walkways, packed brown earth for the low courtyard, red-brown timber), dark outlines,
// soft shadows. Where an engineer can walk is drawn explicitly: a ring on every standable cell
// and a dashed link between every pair of neighbours one can step between (same height, or
// either is stairs). Each lane is a dashed line from its catapult out over the lawn with a ring
// at every lane position; machines stand on the rings.
//
// Depth: something at grid point (x, y) is in front of everything with a smaller x + y. A
// raised cell or prop has key x + y − 0.01; an entity standing on a cell has key x + y (so
// it is drawn after its own cell and before anything nearer the viewer). Flat floor is in
// the pre-rendered ground layer and never occludes. Every cell draws its own half of each
// walk link (from its centre to the shared edge), so links are occluded like the floor.
//
// Everything static is drawn once (seeded, so it looks the same on every reload) into
// offscreen canvases at device resolution: the ground layer and one sprite per prop.

import { rng, TAU } from '../../tower_defense/tv/geom.js';

export const W = 1920;
export const H = 1080;

const TH_K = 0.5; // tile height / tile width
const HZ_K = 0.42; // one height level / tile width
export const OUT_Z = -0.3; // the lawn outside the keep (the keep stands on a plinth)
export const CRATE_Z = 0.72;
export const WALL_Z = 1; // wall walk height (the merlons stand above it)
const MERLON = 0.4; // merlon height above the wall walk
export const LANE0 = 1.0; // cells from a lane's own start point to its position 0
export const LANE_STRIDE = 1.65; // cells between two lane positions on screen
const LANE_RING = 0.36; // lane ring radius (cells)
const NODE_R = 0.13; // walk node ring radius (cells)
const MACH_HEAD = 3.4; // headroom (levels) kept above the far lane rings for the biggest machine

// ---------------------------------------------------------------- palette

export const PAL = {
  lawn: '#9ad94c',
  lawnDark: ['#86c63f', '#7fbd3b', '#8acb42'],
  lawnLight: ['#ade65e', '#b5ea69'],
  earth: ['#a8724a', '#a26d46', '#ae784e', '#9d6943'],
  earthDark: '#7d5232',
  stoneTop: ['#ddd5c1', '#d7cfba', '#e1dac8', '#d3cab4'],
  stoneMortar: '#bfb49b',
  stoneL: ['#c4b99f', '#bdb299', '#c9bfa6'], // +y faces (lit)
  stoneR: ['#a59a80', '#9e9379', '#aa9f86'], // +x faces (half shade)
  stoneJoint: '#857a63',
  cap: ['#e6dfcd', '#ded6c2'],
  outline: '#3a3024',
  wood: ['#b5602f', '#a9582b', '#bd6834', '#9f522a'],
  woodDark: '#5c2a14',
  node: 'rgba(58,30,12,0.78)', // walk graph on earth
  nodeStone: 'rgba(92,80,58,0.85)', // walk graph on stone
  lane: 'rgba(36,86,18,0.78)',
};

export class Scene {
  // keep: map.keeps[i]; layout: room.layout (same w/h); box: the screen area for the board
  constructor(keep, layout, px, box) {
    this.box = box || { x0: 24, x1: W - 24, y0: 24, y1: H - 24 };
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

  // Fit the keep and the full length of every lane (with headroom for the machines standing on
  // the far rings and for the name tags on the ramparts) into the box, centred.
  fit() {
    const { w, h } = this;
    const pts = [];
    for (const [x, y] of [[-0.5, -0.5], [w - 0.5, -0.5], [-0.5, h - 0.5], [w - 0.5, h - 0.5]]) pts.push([x, y, OUT_Z - 0.05], [x, y, WALL_Z + MERLON]);
    pts.push([1, 1, 2.9]); // a tag over an engineer at the rampart corner
    for (const L of this.keep.lanes) {
      const [ex, ey] = this.lanePtRaw(L, L.len - 1);
      for (const [dx, dy] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) pts.push([ex + dx, ey + dy, OUT_Z], [ex + dx, ey + dy, OUT_Z + MACH_HEAD]);
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

  // vertical face facing +x at x = fx, from y = y0 (u runs toward +y, v up, in cells/levels)
  faceX(g, fx, y0, z0) {
    const [sx, sy] = this.p(fx, y0, z0);
    g.transform(-this.TW / 2, this.TH / 2, 0, -this.HZ, sx, sy);
  }

  // vertical face facing +y at y = fy, from x = x0 (u runs toward +x, v up)
  faceY(g, x0, fy, z0) {
    const [sx, sy] = this.p(x0, fy, z0);
    g.transform(this.TW / 2, this.TH / 2, 0, -this.HZ, sx, sy);
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

  // the height of whatever stands on (x, y), for shadows and occlusion
  solidZ(x, y) {
    const c = this.cell(x, y);
    if (!c) return OUT_Z;
    if (c.kind === 'block') return c.h ? WALL_Z + (x === 0 || y === 0 ? 0.3 : 0) : CRATE_Z;
    if (c.kind === 'catapult') return WALL_Z;
    if (c.kind === 'stairs') return 0.5;
    return c.h || 0;
  }

  // can an engineer stand on (x, y)?
  walkable(x, y) {
    const c = this.cell(x, y);
    return !!c && (c.kind === 'floor' || c.kind === 'stairs');
  }

  // can an engineer step from (x, y) to its neighbour (x + dx, y + dy)? (docs/PROTOCOL.md,
  // "Stepping": both walkable and of equal height, unless either is stairs)
  link(x, y, dx, dy) {
    if (!this.walkable(x, y) || !this.walkable(x + dx, y + dy)) return false;
    const a = this.cell(x, y);
    const b = this.cell(x + dx, y + dy);
    return a.kind === 'stairs' || b.kind === 'stairs' || (a.h || 0) === (b.h || 0);
  }

  // a cell next to a catapult at the catapult's height: where loading happens
  loadingCell(x, y) {
    const c = this.cell(x, y);
    if (!c || c.kind !== 'floor') return false;
    for (const k of this.keep.catapults) if (Math.abs(k.x - x) + Math.abs(k.y - y) === 1 && (c.h || 0) === 1) return true;
    return false;
  }

  lanePtRaw(L, p) {
    const d = p >= 0 ? LANE0 + p * LANE_STRIDE : LANE0 * Math.max(-0.2, 1 + p / 0.75);
    return [L.x + d * L.dir[0], L.y + d * L.dir[1]];
  }

  // world point of lane `lane` position p (float; < 0 runs into the wall)
  lanePt(lane, p) {
    const L = this.keep.lanes[lane];
    if (!L) return [0, 0];
    return this.lanePtRaw(L, p);
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
          else this.props.push({ x, y, kind: (x * 7 + y * 13) % 4 === 1 ? 'pipes' : 'crate', seed: r() });
        } else if (c.kind === 'catapult') this.props.push({ x, y, kind: 'wall', cat: true });
        else if (c.kind === 'floor' && c.h) this.props.push({ x, y, kind: 'raised' });
        else if (c.kind === 'stairs') this.props.push({ x, y, kind: 'stairs', highs: this.stairHighs(x, y) });
      }
    }
  }

  // the directions of a stairs cell's raised neighbours (walkable h1 first, else any h1)
  stairHighs(x, y) {
    const dirs = [[0, -1], [-1, 0], [1, 0], [0, 1]];
    let out = dirs.filter(([dx, dy]) => {
      const n = this.cell(x + dx, y + dy);
      return n && n.kind === 'floor' && n.h;
    });
    if (!out.length) out = dirs.filter(([dx, dy]) => (this.cell(x + dx, y + dy)?.h || 0) > 0);
    return out.length ? out : [[0, -1]];
  }

  // ---------------------------------------------------------------- static layers

  build() {
    const px = Math.min(2, Math.max(1, this.px));
    this.rpx = px;
    this.ground = drawGround(this, px);
    this.blocks = [];
    for (const pr of this.props) {
      const spr = propSprite(this, pr, px);
      if (spr) this.blocks.push({ ...pr, key: pr.x + pr.y - 0.01, ...spr });
    }
  }
}

// ---------------------------------------------------------------- helpers

function poly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// a colour from a palette list, brightened/darkened by f (1 = as is)
function tone(list, r, f = 1) {
  const [R, G, B] = hex(list[Math.floor(r() * list.length)]);
  const j = 0.96 + r() * 0.08;
  const m = f * j;
  return `rgb(${Math.min(255, Math.round(R * m))},${Math.min(255, Math.round(G * m))},${Math.min(255, Math.round(B * m))})`;
}

function shadeHex(c, m) {
  const [R, G, B] = hex(c);
  return `rgb(${Math.min(255, Math.round(R * m))},${Math.min(255, Math.round(G * m))},${Math.min(255, Math.round(B * m))})`;
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function line(g, a, b) {
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
}

// ---------------------------------------------------------------- the walk graph

// The node of cell (x, y) and its half of every walk link: a ring at the centre, and from it a
// dash toward each neighbour one can step to, ending just short of the shared edge (the
// neighbour draws the other dash). Heights follow the surface: on stairs a link rises from the
// tread in the middle to the height of the neighbour it leads to.
function graphCell(S, g, x, y) {
  if (!S.walkable(x, y)) return;
  const c = S.cell(x, y);
  const z0 = S.standZ(x, y);
  const stone = (c.h || 0) > 0 || c.kind === 'stairs';
  const col = stone ? PAL.nodeStone : PAL.node;
  const lw = Math.max(2, S.TW * 0.034);
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = col;
  g.lineWidth = lw;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!S.link(x, y, dx, dy)) continue;
    const zb = c.kind === 'stairs' ? S.standZ(x + dx, y + dy) : z0; // height at the shared edge
    const zt = (t) => z0 + ((zb - z0) * t) / 0.5;
    const t0 = NODE_R + 0.09;
    const t1 = 0.43;
    line(g, S.p(x + dx * t0, y + dy * t0, zt(t0)), S.p(x + dx * t1, y + dy * t1, zt(t1)));
  }
  const [cx, cy] = S.p(x, y, z0);
  const rx = NODE_R * S.TW * Math.SQRT1_2;
  const ry = NODE_R * S.TH * Math.SQRT1_2;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  g.stroke();
  if (S.loadingCell(x, y)) {
    // where a catapult is loaded from: a filled timber-red centre
    g.fillStyle = '#b5482a';
    g.beginPath();
    g.ellipse(cx, cy, rx * 0.55, ry * 0.55, 0, 0, TAU);
    g.fill();
  }
  g.restore();
}

// ---------------------------------------------------------------- textures (in local units)

// Flagstones filling the rect [x0, x0+w] × [y0, y0+h] of a plane: a seeded partition into
// slabs of varied size and gentle tone, thin joints. Kept quiet so the walk graph dominates.
function flagstones(g, r, x0, y0, w, h, pal, mortar, opts = {}) {
  const m = opts.m ?? 0.018;
  g.fillStyle = mortar;
  g.fillRect(x0, y0, w, h);
  const slabs = [];
  const split = (x, y, sw, sh, depth) => {
    const big = sw > 0.62 || sh > 0.62;
    if (depth > 2 || (!big && r() < 0.55) || sw < 0.3 || sh < 0.3) {
      slabs.push([x, y, sw, sh]);
      return;
    }
    const t = 0.35 + r() * 0.3;
    if (sw >= sh) {
      split(x, y, sw * t, sh, depth + 1);
      split(x + sw * t, y, sw * (1 - t), sh, depth + 1);
    } else {
      split(x, y, sw, sh * t, depth + 1);
      split(x, y + sh * t, sw, sh * (1 - t), depth + 1);
    }
  };
  split(x0, y0, w, h, opts.depth ?? 0);
  for (const [x, y, sw, sh] of slabs) {
    g.fillStyle = tone(pal, r, 0.98 + r() * 0.04);
    g.fillRect(x + m, y + m, sw - 2 * m, sh - 2 * m);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(x + m, y + m, sw - 2 * m, 0.018);
  }
}

// Coursed masonry on a vertical face: u along [0, len], v up [0, hgt] (local units).
function masonry(g, r, len, hgt, pal, opts = {}) {
  const mortar = opts.mortar || PAL.stoneJoint;
  g.fillStyle = mortar;
  g.fillRect(0, 0, len, hgt);
  const course = opts.course ?? 0.22;
  const rows = Math.max(1, Math.round(hgt / course));
  const ch = hgt / rows;
  const m = 0.016;
  for (let i = 0; i < rows; i++) {
    const v0 = i * ch;
    let u = -r() * 0.25;
    while (u < len) {
      const sl = 0.24 + r() * 0.3;
      const a = Math.max(0, u);
      const b = Math.min(len, u + sl);
      if (b - a > 0.04) {
        g.fillStyle = tone(pal, r, 0.97 + r() * 0.06);
        g.fillRect(a + m, v0 + m, b - a - 2 * m, ch - 2 * m);
        g.fillStyle = 'rgba(255,255,255,0.14)';
        g.fillRect(a + m, v0 + ch - m - 0.018, b - a - 2 * m, 0.018);
      }
      u += sl;
    }
  }
}

// darken the foot of a face (soft ambient occlusion)
function faceFoot(g, len, hgt, ao = 0.22) {
  const gr = g.createLinearGradient(0, 0, 0, Math.min(hgt, 0.35));
  gr.addColorStop(0, `rgba(40,30,15,${ao})`);
  gr.addColorStop(1, 'rgba(40,30,15,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, len, hgt);
}

// ---------------------------------------------------------------- ground layer

function drawGround(S, px) {
  const c = newCanvas(W * px, H * px);
  const g = c.getContext('2d');
  g.scale(px, px);
  const r = rng(99);
  const { w, h, keep } = S;

  // the lawn: flat bright green, a little mottling, tufts and a few stones
  g.fillStyle = PAL.lawn;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    const x = r() * W;
    const y = r() * H;
    g.fillStyle = r() < 0.5 ? 'rgba(120,190,60,0.22)' : 'rgba(180,235,110,0.22)';
    g.beginPath();
    g.ellipse(x, y, 60 + r() * 160, 30 + r() * 70, 0, 0, TAU);
    g.fill();
  }
  const keepHit = (x, y) => {
    // is the screen point over the keep's footprint (or close to it)?
    const gx = (x - S.ox) / S.TW + (y - S.oy) / S.TH;
    const gy = (y - S.oy) / S.TH - (x - S.ox) / S.TW;
    return gx > -1.2 && gy > -1.2 && gx < w + 0.6 && gy < h + 0.6;
  };
  const sk = S.k;
  for (let i = 0; i < 260; i++) {
    const x = r() * W;
    const y = r() * H;
    if (keepHit(x, y)) continue;
    g.strokeStyle = tone(PAL.lawnDark, r, 0.9);
    g.lineWidth = 2 * sk;
    g.lineCap = 'round';
    const s = (5 + r() * 6) * sk;
    g.beginPath();
    g.moveTo(x - s * 0.6, y - s);
    g.lineTo(x, y);
    g.lineTo(x + s * 0.1, y - s * 1.2);
    g.moveTo(x, y);
    g.lineTo(x + s * 0.7, y - s * 0.8);
    g.stroke();
  }
  for (let i = 0; i < 9; i++) {
    const x = r() * W;
    const y = r() * H;
    if (keepHit(x, y) || y < S.box.y0 + 20 || y > S.box.y1 - 10) continue;
    const s = (7 + r() * 9) * sk;
    g.fillStyle = 'rgba(40,70,20,0.25)';
    g.beginPath();
    g.ellipse(x + s * 0.3, y + s * 0.25, s * 1.2, s * 0.5, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#b9b7ad';
    g.strokeStyle = '#5a5850';
    g.lineWidth = 1.5 * sk;
    g.beginPath();
    g.ellipse(x, y, s, s * 0.62, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = '#d6d4cb';
    g.beginPath();
    g.ellipse(x - s * 0.25, y - s * 0.2, s * 0.45, s * 0.25, 0, 0, TAU);
    g.fill();
  }

  // the lanes: a dashed path from each catapult out over the lawn, a ring at every position
  for (const L of keep.lanes) drawLane(S, g, L);

  // a soft shadow of the keep on the lawn (light from the upper left)
  g.save();
  S.planeAt(g, 0, 0, OUT_Z);
  g.fillStyle = 'rgba(40,80,20,0.22)';
  g.fillRect(-0.5 + 0.25, -0.5 + 0.15, w + 0.25, h + 0.2);
  g.restore();

  // the plinth: the near sides of the keep, in masonry
  g.save();
  S.faceX(g, w - 0.5, -0.5, OUT_Z);
  masonry(g, r, h, -OUT_Z, PAL.stoneR, { course: 0.15 });
  g.restore();
  g.save();
  S.faceY(g, -0.5, h - 0.5, OUT_Z);
  masonry(g, r, w, -OUT_Z, PAL.stoneL, { course: 0.15 });
  g.restore();
  g.strokeStyle = PAL.outline;
  g.lineWidth = 2;
  g.lineJoin = 'round';
  poly(g, [S.p(w - 0.5, -0.5, 0), S.p(w - 0.5, h - 0.5, 0), S.p(-0.5, h - 0.5, 0), S.p(-0.5, h - 0.5, OUT_Z), S.p(w - 0.5, h - 0.5, OUT_Z), S.p(w - 0.5, -0.5, OUT_Z)]);
  g.stroke();

  // courtyard floor: packed earth, smooth, with a few lighter worn patches and pebbles
  g.save();
  S.planeAt(g, 0, 0, 0);
  g.fillStyle = PAL.earth[0];
  g.fillRect(-0.5, -0.5, w, h);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(200,150,100,0.16)' : 'rgba(110,70,40,0.12)';
    g.beginPath();
    g.ellipse(-0.5 + r() * w, -0.5 + r() * h, 0.4 + r() * 1.1, 0.3 + r() * 0.8, r() * 3, 0, TAU);
    g.fill();
  }
  for (let i = 0; i < 110; i++) {
    const x = -0.5 + r() * w;
    const y = -0.5 + r() * h;
    const s = 0.03 + r() * 0.05;
    g.fillStyle = r() < 0.5 ? '#c49a6c' : '#8a5a38';
    g.beginPath();
    g.ellipse(x, y, s, s * 0.8, 0, 0, TAU);
    g.fill();
  }
  g.restore();

  // soft cast shadows (toward +x) and a darker foot along anything raised
  g.save();
  S.planeAt(g, 0, 0, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const zz = S.solidZ(x, y);
      if (zz <= 0) continue;
      const len = Math.min(0.9, zz * 0.7);
      g.fillStyle = 'rgba(70,40,15,0.16)';
      g.fillRect(x - 0.5 + len * 0.8, y - 0.5 + len * 0.3, 1, 1);
    }
  }
  g.restore();

  // the walk graph on the low floor
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (S.cell(x, y)?.kind === 'floor' && !S.cell(x, y).h) graphCell(S, g, x, y);
  return c;
}

function drawLane(S, g, L) {
  const along = L.dir;
  const last = L.len - 1;
  const lw = Math.max(2.5, S.TW * 0.045);
  g.save();
  g.strokeStyle = PAL.lane;
  g.lineWidth = lw;
  g.lineCap = 'round';
  const pt = (d) => S.p(L.x + along[0] * d, L.y + along[1] * d, OUT_Z);
  // dashes between consecutive stops: from the wall foot to ring 0, then ring to ring, and a
  // little way on beyond the last ring (where the machines come from)
  const stops = [0.15 - LANE_RING];
  for (let p = 0; p <= last; p++) stops.push(S.lanePtRaw(L, p)[0] * along[0] + S.lanePtRaw(L, p)[1] * along[1] - (L.x * along[0] + L.y * along[1]));
  stops.push(stops[stops.length - 1] + LANE_STRIDE * 0.9);
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i] + LANE_RING + 0.1;
    const b = stops[i + 1] - (i + 1 < stops.length - 1 ? LANE_RING + 0.1 : 0);
    if (b <= a) continue;
    const n = Math.max(1, Math.round((b - a) / 0.36));
    const step = (b - a) / n;
    if (i + 1 === stops.length - 1) g.globalAlpha = 0.5;
    for (let j = 0; j < n; j++) line(g, pt(a + j * step + step * 0.18), pt(a + j * step + step * 0.82));
  }
  g.globalAlpha = 1;
  // the rings the machines stand on; the far one (where they appear) doubled
  for (let p = 0; p <= last; p++) {
    const [x, y] = S.lanePtRaw(L, p);
    const [cx, cy] = S.p(x, y, OUT_Z);
    const rx = LANE_RING * S.TW * Math.SQRT1_2;
    const ry = LANE_RING * S.TH * Math.SQRT1_2;
    g.fillStyle = 'rgba(60,120,30,0.18)';
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    g.stroke();
    if (p === last) {
      g.lineWidth = lw * 0.6;
      g.beginPath();
      g.ellipse(cx, cy, rx * 1.28, ry * 1.28, 0, 0, TAU);
      g.stroke();
      g.lineWidth = lw;
    }
  }
  g.restore();
}

// ---------------------------------------------------------------- props (one sprite per cell)

// bounding box (logical px) of a cell column from z0 to z1, with padding
function cellBox(S, x, y, z0, z1, pad = 4, ext = 0.5) {
  const pts = [];
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pts.push(S.p(x + dx * ext, y + dy * ext, z1), S.p(x + dx * ext, y + dy * ext, z0));
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
  const r = rng(Math.floor(x * 7919 + y * 104729 + 17));
  let z0 = 0;
  let z1 = 1.05;
  if (kind === 'wall') {
    z0 = OUT_Z;
    z1 = WALL_Z + MERLON + 0.1;
  }
  if (kind === 'crate') z1 = CRATE_Z + 0.05;
  if (kind === 'pipes') z1 = CRATE_Z + 0.35;
  const box = cellBox(S, x, y, z0, z1, 8, 0.5);
  const c = newCanvas(box.w * px, box.h * px);
  const g = c.getContext('2d');
  g.scale(px, px);
  g.translate(-box.x, -box.y);
  g.lineJoin = 'round';
  switch (kind) {
    case 'wall':
      drawWallCell(S, g, r, x, y, pr.cat);
      break;
    case 'raised':
    case 'pillar':
      stoneColumn(S, g, r, x, y, 0, 1, kind === 'pillar' ? PAL.cap : PAL.stoneTop, PAL.stoneMortar);
      if (kind === 'raised') graphCell(S, g, x, y);
      break;
    case 'crate':
      drawCrate(S, g, r, x, y);
      break;
    case 'pipes':
      drawPipes(S, g, r, x, y);
      break;
    case 'stairs':
      drawStairs(S, g, r, x, y, pr.highs);
      graphCell(S, g, x, y);
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

// a stone column: visible faces in masonry, top in quiet slabs, dark outline on the drop edges
function stoneColumn(S, g, r, x, y, z0, z1, topPal, topMortar) {
  if (lowerAt(S, x + 1, y, z1)) {
    g.save();
    S.faceX(g, x + 0.5, y - 0.5, z0);
    masonry(g, r, 1, z1 - z0, PAL.stoneR);
    faceFoot(g, 1, z1 - z0);
    g.restore();
  }
  if (lowerAt(S, x, y + 1, z1)) {
    g.save();
    S.faceY(g, x - 0.5, y + 0.5, z0);
    masonry(g, r, 1, z1 - z0, PAL.stoneL);
    faceFoot(g, 1, z1 - z0);
    g.restore();
  }
  g.save();
  S.planeAt(g, x, y, z1);
  flagstones(g, r, -0.5, -0.5, 1, 1, topPal, topMortar, { depth: 1 });
  g.restore();
  // crisp outline of the edges that drop away, and the vertical corner between two faces
  g.strokeStyle = PAL.outline;
  g.lineWidth = Math.max(1.5, S.TW * 0.016);
  g.lineCap = 'round';
  const dropX = lowerAt(S, x + 1, y, z1);
  const dropY = lowerAt(S, x, y + 1, z1);
  if (dropX) line(g, S.p(x + 0.5, y - 0.5, z1), S.p(x + 0.5, y + 0.5, z1));
  if (dropY) line(g, S.p(x - 0.5, y + 0.5, z1), S.p(x + 0.5, y + 0.5, z1));
  // vertical edges where a face starts or ends (the face continues into a neighbour of the
  // same height whose face also shows)
  const high = (cx, cy) => !lowerAt(S, cx, cy, z1);
  const zb = Math.max(z0, 0);
  if (dropX && dropY) line(g, S.p(x + 0.5, y + 0.5, z1), S.p(x + 0.5, y + 0.5, zb));
  if (dropX && !dropY && !(high(x, y + 1) && lowerAt(S, x + 1, y + 1, z1))) line(g, S.p(x + 0.5, y + 0.5, z1), S.p(x + 0.5, y + 0.5, zb));
  if (dropY && !dropX && !(high(x + 1, y) && lowerAt(S, x + 1, y + 1, z1))) line(g, S.p(x + 0.5, y + 0.5, z1), S.p(x + 0.5, y + 0.5, zb));
  if (dropX && !(high(x, y - 1) && lowerAt(S, x + 1, y - 1, z1))) line(g, S.p(x + 0.5, y - 0.5, z1), S.p(x + 0.5, y - 0.5, zb));
  if (dropY && !(high(x - 1, y) && lowerAt(S, x - 1, y + 1, z1))) line(g, S.p(x - 0.5, y + 0.5, z1), S.p(x - 0.5, y + 0.5, zb));
}

// a stone box (merlon)
function stoneBox(S, g, r, x0, y0, x1, y1, z0, z1) {
  poly(g, [S.p(x1, y0, z1), S.p(x1, y1, z1), S.p(x1, y1, z0), S.p(x1, y0, z0)]);
  g.fillStyle = tone(PAL.stoneR, r);
  g.fill();
  poly(g, [S.p(x0, y1, z1), S.p(x1, y1, z1), S.p(x1, y1, z0), S.p(x0, y1, z0)]);
  g.fillStyle = tone(PAL.stoneL, r);
  g.fill();
  const top = [S.p(x0, y0, z1), S.p(x1, y0, z1), S.p(x1, y1, z1), S.p(x0, y1, z1)];
  poly(g, top);
  g.fillStyle = tone(PAL.cap, r);
  g.fill();
  g.strokeStyle = PAL.outline;
  g.lineWidth = Math.max(1.2, S.TW * 0.012);
  poly(g, [S.p(x0, y0, z1), S.p(x1, y0, z1), S.p(x1, y0, z0), S.p(x1, y1, z0), S.p(x0, y1, z0), S.p(x0, y1, z1)]);
  g.stroke();
  line(g, S.p(x1, y1, z1), S.p(x1, y1, z0));
  line(g, S.p(x0, y1, z1), S.p(x1, y1, z1));
  line(g, S.p(x1, y0, z1), S.p(x1, y1, z1));
}

function drawWallCell(S, g, r, x, y, isCat) {
  const z0 = x === 0 || y === 0 ? OUT_Z : 0;
  stoneColumn(S, g, r, x, y, z0, WALL_Z, PAL.cap, PAL.stoneMortar);
  if (isCat) {
    // a timber deck for the catapult
    g.save();
    S.planeAt(g, x, y, WALL_Z);
    g.fillStyle = PAL.woodDark;
    g.fillRect(-0.44, -0.44, 0.88, 0.88);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = tone(PAL.wood, r, 0.95);
      g.fillRect(-0.42, -0.42 + i * 0.172, 0.84, 0.15);
    }
    g.restore();
    return;
  }
  // crenellations on the outer edge: merlons with gaps, drawn back to front
  const mz = WALL_Z + MERLON;
  const d = 0.24;
  const boxes = [];
  if (y === 0) {
    boxes.push([x - 0.5, y - 0.5, x - 0.08, y - 0.5 + d]);
    boxes.push([x + 0.14, y - 0.5, x + 0.5, y - 0.5 + d]);
  }
  if (x === 0) {
    boxes.push([x - 0.5, y - 0.5, x - 0.5 + d, y - 0.08]);
    boxes.push([x - 0.5, y + 0.14, x - 0.5 + d, y + 0.5]);
  }
  boxes.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [a, b, c2, d2] of boxes) stoneBox(S, g, r, a, b, c2, d2, WALL_Z, mz);
}

// a plank box with corner braces
function drawCrate(S, g, r, x, y) {
  const s = 0.38;
  const z1 = CRATE_Z;
  const x0 = x - s;
  const x1 = x + s;
  const y0 = y - s;
  const y1 = y + s;
  const planks = (len, hgt, dark) => {
    g.fillStyle = shadeHex('#7a4a22', dark);
    g.fillRect(0, 0, len, hgt);
    const n = 3;
    for (let i = 0; i < n; i++) {
      g.fillStyle = shadeHex('#c98a4a', dark * (0.95 + r() * 0.1));
      g.fillRect(0.02, (i * hgt) / n + 0.015, len - 0.04, hgt / n - 0.03);
    }
    g.fillStyle = shadeHex('#8a5426', dark);
    g.fillRect(0, 0, 0.1, hgt);
    g.fillRect(len - 0.1, 0, 0.1, hgt);
    g.fillRect(0, hgt - 0.09, len, 0.09);
    g.fillRect(0, 0, len, 0.08);
  };
  g.save();
  S.faceX(g, x1, y0, 0);
  planks(y1 - y0, z1, 0.78);
  g.restore();
  g.save();
  S.faceY(g, x0, y1, 0);
  planks(x1 - x0, z1, 1);
  g.restore();
  g.save();
  S.planeAt(g, x, y, z1);
  g.fillStyle = '#8a5426';
  g.fillRect(-s, -s, 2 * s, 2 * s);
  for (let i = 0; i < 3; i++) {
    g.fillStyle = shadeHex('#dca05e', 0.95 + r() * 0.1);
    g.fillRect(-s + 0.08, -s + 0.08 + (i * (2 * s - 0.16)) / 3 + 0.01, 2 * s - 0.16, (2 * s - 0.16) / 3 - 0.02);
  }
  g.restore();
  g.strokeStyle = PAL.outline;
  g.lineWidth = Math.max(1.5, S.TW * 0.016);
  poly(g, [S.p(x0, y0, z1), S.p(x1, y0, z1), S.p(x1, y0, 0), S.p(x1, y1, 0), S.p(x0, y1, 0), S.p(x0, y1, z1)]);
  g.stroke();
  line(g, S.p(x1, y1, z1), S.p(x1, y1, 0));
  line(g, S.p(x0, y1, z1), S.p(x1, y1, z1));
  line(g, S.p(x1, y0, z1), S.p(x1, y1, z1));
}

// convex hull (monotone chain) of screen points
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// an iron pipe lying along x from xa to xb at (y, z), radius rr (grid units)
function pipe(S, g, xa, xb, y, z, rr, col) {
  const cap = (x) => {
    const pts = [];
    for (let i = 0; i < 20; i++) {
      const an = (i / 20) * TAU;
      pts.push(S.p(x, y + Math.cos(an) * rr, z + ((Math.sin(an) * rr) / HZ_K) * 0.5));
    }
    return pts;
  };
  const A = cap(xa);
  const B = cap(xb);
  const body = hull([...A, ...B]);
  const [, ty] = S.p(xa, y, z + rr * 1.4);
  const [, by] = S.p(xa, y, z - rr * 1.4);
  const gr = g.createLinearGradient(0, ty - S.TH * 0.2, 0, by + S.TH * 0.2);
  gr.addColorStop(0, shadeHex(col, 1.35));
  gr.addColorStop(0.5, col);
  gr.addColorStop(1, shadeHex(col, 0.6));
  poly(g, body);
  g.fillStyle = gr;
  g.fill();
  g.strokeStyle = PAL.outline;
  g.lineWidth = Math.max(1.5, S.TW * 0.014);
  g.stroke();
  poly(g, B);
  g.fillStyle = shadeHex(col, 0.8);
  g.fill();
  g.stroke();
  const inner = B.map(([a, b]) => {
    const [cx, cy] = S.p(xb, y, z);
    return [cx + (a - cx) * 0.6, cy + (b - cy) * 0.6];
  });
  poly(g, inner);
  g.fillStyle = '#2a2a2a';
  g.fill();
}

// a stack of iron pipes on timber cradles, with a red valve wheel: clearly not a bomb
function drawPipes(S, g, r, x, y) {
  const k = S.k;
  for (const cx of [x - 0.28, x + 0.28]) {
    poly(g, [S.p(cx + 0.06, y - 0.42, 0.16), S.p(cx + 0.06, y + 0.42, 0.16), S.p(cx + 0.06, y + 0.42, 0), S.p(cx + 0.06, y - 0.42, 0)]);
    g.fillStyle = '#7a3a1c';
    g.fill();
    poly(g, [S.p(cx - 0.06, y - 0.42, 0.16), S.p(cx + 0.06, y - 0.42, 0.16), S.p(cx + 0.06, y + 0.42, 0.16), S.p(cx - 0.06, y + 0.42, 0.16)]);
    g.fillStyle = '#b5602f';
    g.fill();
  }
  pipe(S, g, x - 0.45, x + 0.45, y - 0.2, 0.3, 0.17, '#8d969b');
  pipe(S, g, x - 0.45, x + 0.45, y + 0.2, 0.3, 0.17, '#848d92');
  pipe(S, g, x - 0.42, x + 0.4, y, 0.6, 0.17, '#97a0a5');
  const [vx, vy] = S.p(x - 0.05, y, 0.93);
  g.save();
  g.translate(vx, vy - 4 * k);
  g.scale(1, 0.5);
  g.strokeStyle = '#d2321e';
  g.lineWidth = 4.5 * k;
  g.beginPath();
  g.arc(0, 0, 13 * k, 0, TAU);
  g.stroke();
  g.lineWidth = 2.6 * k;
  for (let i = 0; i < 3; i++) {
    const an = (i / 3) * Math.PI;
    g.beginPath();
    g.moveTo(Math.cos(an) * 13 * k, Math.sin(an) * 13 * k);
    g.lineTo(-Math.cos(an) * 13 * k, -Math.sin(an) * 13 * k);
    g.stroke();
  }
  g.restore();
}

// Corner steps: the cell climbs toward its raised neighbours. With two raised neighbours at a
// right angle (A and B) the height is max(sa, sb) in steps (sa runs 0..1 toward A, sb toward
// B): L-shaped treads whose top runs along both raised sides and which descend toward the
// corner between the two low sides, so the stairs can be entered from either low neighbour
// and left onto either high one. With one raised neighbour (or two opposite ones) it is a
// straight flight. Each tread is drawn as up to two boxes standing on the tread below.
const STEP_AT = [0, 0.27, 0.55, 0.8]; // where each tread starts (0 = low side, 1 = high side)
function drawStairs(S, g, r, x, y, highs) {
  const A = highs[0];
  const B = highs.find((d) => d[0] * A[0] + d[1] * A[1] === 0) || null;
  const C = B || [A[1], A[0]];
  const n = STEP_AT.length;
  const pt = (sa, sb) => [x + A[0] * (sa - 0.5) + C[0] * (sb - 0.5), y + A[1] * (sa - 0.5) + C[1] * (sb - 0.5)];
  const rect = (sa0, sa1, sb0, sb1, z0, z1, lvl) => {
    const a = pt(sa0, sb0);
    const b = pt(sa1, sb1);
    return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]), z0, z: z1, lvl };
  };
  const steps = [];
  for (let i = 0; i < n; i++) {
    const s0 = STEP_AT[i];
    const z0 = i / n;
    const z1 = (i + 1) / n;
    steps.push(rect(s0, 1, 0, 1, z0, z1, i));
    if (B && s0 > 0) steps.push(rect(0, s0, s0, 1, z0, z1, i));
  }
  steps.sort((p, q) => p.lvl - q.lvl || p.x0 + p.y0 - (q.x0 + q.y0));
  const lw = Math.max(1.2, S.TW * 0.012);
  for (const st of steps) {
    poly(g, [S.p(st.x1, st.y0, st.z), S.p(st.x1, st.y1, st.z), S.p(st.x1, st.y1, st.z0), S.p(st.x1, st.y0, st.z0)]);
    g.fillStyle = tone(PAL.stoneR, r);
    g.fill();
    poly(g, [S.p(st.x0, st.y1, st.z), S.p(st.x1, st.y1, st.z), S.p(st.x1, st.y1, st.z0), S.p(st.x0, st.y1, st.z0)]);
    g.fillStyle = tone(PAL.stoneL, r);
    g.fill();
    const top = [S.p(st.x0, st.y0, st.z), S.p(st.x1, st.y0, st.z), S.p(st.x1, st.y1, st.z), S.p(st.x0, st.y1, st.z)];
    poly(g, top);
    g.fillStyle = tone(PAL.stoneTop, r);
    g.fill();
    g.strokeStyle = 'rgba(58,48,36,0.75)';
    g.lineWidth = lw;
    g.stroke();
  }
}
