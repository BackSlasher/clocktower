// The keep in isometric view: projection, the static (cached) layers and the per-cell prop
// sprites used by the depth-sorted pass.
//
// Projection: grid cell (x, y) has its centre at grid point (x, y); z is height in levels
// (0 courtyard, 1 ramparts). Screen = origin + ((x - y)·TW/2, (x + y)·TH/2 − z·HZ), so the
// grid's (0, 0) corner is at the top of the screen and the (w, h) corner at the bottom: the
// viewer stands at the (w, h) corner and the walls (row y = 0, column x = 0) are the far
// sides, with the lanes running away up-right (row 0) and up-left (column 0).
//
// Lanes are a handful of positions long on the wire, but are drawn stretched: position p lies
// 1 + p·LANE_STRIDE cells out from its catapult, on a cobbled street that runs on into the
// dark, so every advance is a long stride toward the wall.
//
// Depth: something at grid point (x, y) is in front of everything with a smaller x + y. A
// raised cell or prop has key x + y − 0.01; an entity standing on a cell has key x + y (so
// it is drawn after its own cell and before anything nearer the viewer). Flat floor is in
// the pre-rendered ground layer and never occludes.
//
// Everything static is drawn once (seeded, so it looks the same on every reload) into
// offscreen canvases at device resolution: the ground layer, the light layer and one sprite
// per prop. Light comes from the courtyard and from the street lamps; faces toward +y are
// lit, faces toward +x in half shade, and props cast soft shadows toward +x.

import { rng, softSprite, TAU } from '../../tower_defense/tv/geom.js';

export const W = 1920;
export const H = 1080;

const TH_K = 0.5; // tile height / tile width
const HZ_K = 0.34; // one height level / tile width
export const OUT_Z = -0.32; // the ground outside the keep (the keep stands on a plinth)
export const CRATE_Z = 0.78;
export const WALL_Z = 1; // wall walk height (the merlons stand above it)
export const LANE_STRIDE = 2.4; // cells between two lane positions on screen
const ROAD_LEN = 20; // cells of street drawn beyond the wall
const ROAD_W = 1.35; // street width in cells

// Fit box for the keep (logical px); the lanes may use the rest of the screen.
const BOX = { x0: 34, x1: W - 34, y0: 40, y1: H - 12 };
const LANE_BOX = { x0: 40, x1: W - 40, y0: 30 };

// ---------------------------------------------------------------- palette

const PAL = {
  mortar: '#4a3a2a',
  floor: ['#9c7a52', '#93714b', '#a5825a', '#8b6a46', '#a07e55', '#957450'],
  worn: ['#b08d62', '#a9875d', '#b69468'],
  raised: ['#ddd0b2', '#d4c6a6', '#e2d6bb', '#cfc09f'],
  raisedMortar: '#7a6448',
  wallL: ['#a68a66', '#9b7f5c', '#b0936d', '#927758', '#a3866a'], // +y faces (lit)
  wallR: ['#7d6649', '#735d43', '#86704f', '#6c5840', '#7a6347'], // +x faces (half shade)
  wallMortar: '#3c2f22',
  cap: ['#c9b48d', '#bfa982', '#d1bd96'],
  wood: ['#a0703e', '#94663a', '#ab7944', '#8a5e34'],
  woodDark: '#5a3a1c',
  cobble: ['#6b5a47', '#5f503f', '#76634d', '#57493a', '#7f6b52'],
  grass: ['#26332a', '#212d24', '#2c3a2d', '#1d281f'],
};

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

  // The keep fills the box; then, if a lane's far end would leave the screen, zoom out a little.
  fit() {
    const { w, h } = this;
    const keepPts = [];
    for (const [x, y] of [[-0.5, -0.5], [w - 0.5, -0.5], [-0.5, h - 0.5], [w - 0.5, h - 0.5]]) keepPts.push([x, y, OUT_Z], [x, y, 1.5]);
    const lanePts = [];
    for (const L of this.keep.lanes) {
      const [ex, ey] = this.lanePtRaw(L, L.len - 1 + 0.25);
      for (const [dx, dy] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) lanePts.push([ex + dx, ey + dy, OUT_Z], [ex + dx, ey + dy, 1.3]);
    }
    const ext = (pts) => {
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
      return { minX, maxX, minY, maxY };
    };
    const K = ext(keepPts);
    const B = this.box;
    let tw = Math.min((B.x1 - B.x0) / (K.maxX - K.minX), (B.y1 - B.y0) / (K.maxY - K.minY));
    for (let i = 0; i < 40; i++) {
      this.setScale(tw, K, B);
      let ok = true;
      for (const [x, y, z] of lanePts) {
        const [sx, sy] = this.p(x, y, z);
        if (sx < LANE_BOX.x0 || sx > LANE_BOX.x1 || sy < LANE_BOX.y0) ok = false;
      }
      if (ok) break;
      tw *= 0.97;
    }
  }

  setScale(tw, K, B) {
    this.TW = tw;
    this.TH = tw * TH_K;
    this.HZ = tw * HZ_K;
    this.k = tw / 130; // sprite scale (sprites are designed at TW = 130)
    this.ox = (B.x0 + B.x1) / 2 - ((K.minX + K.maxX) / 2) * tw;
    this.oy = B.y1 - K.maxY * tw;
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

  lanePtRaw(L, p) {
    const d = p >= 0 ? p * LANE_STRIDE : p;
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

  // classify blocks: crates vs pipes vs wall; stairs direction; street lamps
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
    // a street lamp beside every lane position, alternating sides
    this.lamps = [];
    for (const L of this.keep.lanes) {
      const perp = [-L.dir[1], L.dir[0]];
      for (let p = 0; p < L.len; p++) {
        const [x, y] = this.lanePtRaw(L, p);
        const s = (p + L.id) % 2 ? 1 : -1;
        const off = ROAD_W / 2 + 0.28;
        this.lamps.push({ x: x + perp[0] * off * s, y: y + perp[1] * off * s, kind: 'lamp' });
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

  // stairs rise toward a walkable h1 neighbour; returns that direction [dx, dy]
  stairDir(x, y) {
    const opts = [];
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const n = this.cell(x + dx, y + dy);
      if (n && n.kind === 'floor' && n.h) opts.push([dx, dy]);
    }
    if (!opts.length) return [0, -1];
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
    // the light pools are baked into the ground (a full-screen additive draw per frame is
    // costly on software-rendered canvases); only the lamp flames flicker per frame
    {
      const light = drawLight(this, px);
      const g = this.ground.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.9;
      g.drawImage(light, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    this.blocks = [];
    for (const pr of [...this.props, ...this.lamps]) {
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
  const j = 0.93 + r() * 0.14;
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

// ---------------------------------------------------------------- textures (in local units)

// Flagstones filling the rect [x0, x0+w] × [y0, y0+h] of a plane: a seeded partition into
// slabs of varied size and tone, mortar joints, lit and shaded edges, chips and specks.
function flagstones(g, r, x0, y0, w, h, pal, mortar, opts = {}) {
  const m = opts.m ?? 0.028;
  g.fillStyle = mortar;
  g.fillRect(x0, y0, w, h);
  const slabs = [];
  const split = (x, y, sw, sh, depth) => {
    const big = sw > 0.62 || sh > 0.62;
    if (depth > 2 || (!big && r() < 0.55) || sw < 0.3 || sh < 0.3) {
      slabs.push([x, y, sw, sh]);
      return;
    }
    if (sw >= sh) {
      const t = 0.35 + r() * 0.3;
      split(x, y, sw * t, sh, depth + 1);
      split(x + sw * t, y, sw * (1 - t), sh, depth + 1);
    } else {
      const t = 0.35 + r() * 0.3;
      split(x, y, sw, sh * t, depth + 1);
      split(x, y + sh * t, sw, sh * (1 - t), depth + 1);
    }
  };
  split(x0, y0, w, h, opts.depth ?? 0);
  for (const [x, y, sw, sh] of slabs) {
    const f = (opts.light ?? 1) * (0.95 + r() * 0.08);
    g.fillStyle = tone(pal, r, f);
    g.fillRect(x + m, y + m, sw - 2 * m, sh - 2 * m);
    // lit edges toward −x and −y (screen up), shade toward +x and +y
    g.fillStyle = 'rgba(255,240,205,0.13)';
    g.fillRect(x + m, y + m, sw - 2 * m, 0.022);
    g.fillRect(x + m, y + m, 0.022, sh - 2 * m);
    g.fillStyle = 'rgba(30,18,6,0.13)';
    g.fillRect(x + m, y + sh - m - 0.026, sw - 2 * m, 0.026);
    g.fillRect(x + sw - m - 0.026, y + m, 0.026, sh - 2 * m);
    // specks
    for (let i = 0; i < 3; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(40,26,10,0.18)' : 'rgba(255,245,220,0.14)';
      g.fillRect(x + m + r() * (sw - 3 * m), y + m + r() * (sh - 3 * m), 0.025, 0.025);
    }
    // a chipped corner
    if (r() < 0.28) {
      const cx = r() < 0.5 ? x + m : x + sw - m;
      const cy = r() < 0.5 ? y + m : y + sh - m;
      const d = 0.05 + r() * 0.05;
      g.fillStyle = mortar;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + (cx === x + m ? d : -d), cy);
      g.lineTo(cx, cy + (cy === y + m ? d : -d));
      g.closePath();
      g.fill();
    }
    // a hairline crack
    if (opts.cracks && r() < 0.18) {
      g.strokeStyle = 'rgba(40,26,10,0.45)';
      g.lineWidth = 0.012;
      g.beginPath();
      let cx = x + sw * (0.2 + r() * 0.6);
      let cy = y + m;
      g.moveTo(cx, cy);
      for (let i = 0; i < 3; i++) {
        cx += (r() - 0.5) * sw * 0.4;
        cy += sh * 0.3;
        g.lineTo(cx, cy);
      }
      g.stroke();
    }
  }
}

// The frame of a walkable tile (in the tile's plane, centred on 0,0): a dark inset joint with
// a lit inner edge, and a small brass stud in the middle. Drawn on every walkable cell at its
// own height, so tiles read as tiles on the courtyard, the platforms and the wall-walks.
export function tileFrame(g, opts = {}) {
  const i = 0.045;
  g.lineJoin = 'miter';
  g.strokeStyle = opts.dark || 'rgba(46,26,8,0.72)';
  g.lineWidth = 0.05;
  g.strokeRect(-0.5 + i, -0.5 + i, 1 - 2 * i, 1 - 2 * i);
  g.strokeStyle = 'rgba(255,236,196,0.22)';
  g.lineWidth = 0.018;
  g.strokeRect(-0.5 + i + 0.035, -0.5 + i + 0.035, 1 - 2 * i - 0.07, 1 - 2 * i - 0.07);
  if (opts.stud !== false) stud(g);
}

function stud(g) {
  g.fillStyle = 'rgba(30,16,4,0.55)';
  g.beginPath();
  g.ellipse(0.012, 0.012, 0.07, 0.07, 0, 0, TAU);
  g.fill();
  const gr = g.createRadialGradient(-0.02, -0.02, 0.005, 0, 0, 0.06);
  gr.addColorStop(0, '#fff1c2');
  gr.addColorStop(0.45, '#d9b25a');
  gr.addColorStop(1, '#6e5120');
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(0, 0, 0.058, 0.058, 0, 0, TAU);
  g.fill();
}

// Coursed masonry on a vertical face: u along [0, len], v up [0, hgt] (local units).
function masonry(g, r, len, hgt, pal, opts = {}) {
  const mortar = opts.mortar || PAL.wallMortar;
  g.fillStyle = mortar;
  g.fillRect(0, 0, len, hgt);
  const course = opts.course ?? 0.2;
  const rows = Math.max(1, Math.round(hgt / course));
  const ch = hgt / rows;
  const m = 0.022;
  for (let i = 0; i < rows; i++) {
    const v0 = i * ch;
    let u = -r() * 0.25;
    while (u < len) {
      const sl = 0.2 + r() * 0.32;
      const a = Math.max(0, u);
      const b = Math.min(len, u + sl);
      if (b - a > 0.04) {
        g.fillStyle = tone(pal, r, 0.92 + r() * 0.16);
        g.fillRect(a + m, v0 + m, b - a - 2 * m, ch - 2 * m);
        // top lip catches the light, the underside is in shadow
        g.fillStyle = 'rgba(255,238,200,0.18)';
        g.fillRect(a + m, v0 + ch - m - 0.02, b - a - 2 * m, 0.02);
        g.fillStyle = 'rgba(20,12,4,0.22)';
        g.fillRect(a + m, v0 + m, b - a - 2 * m, 0.022);
        if (r() < 0.12) {
          // chipped edge
          g.fillStyle = mortar;
          g.fillRect(a + m + r() * (b - a - 0.1), v0 + ch - m - 0.04, 0.06, 0.04);
        }
      }
      u += sl;
    }
  }
  // soot and moss, sparingly
  if (opts.streaks) {
    for (let i = 0; i < 2; i++) {
      if (r() > 0.45) continue;
      const u = r() * len;
      const moss = r() < 0.4;
      const gr = g.createLinearGradient(0, hgt, 0, hgt * (0.2 + r() * 0.5));
      gr.addColorStop(0, moss ? 'rgba(70,90,40,0.38)' : 'rgba(20,16,12,0.35)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(u, 0, 0.06 + r() * 0.1, hgt);
    }
  }
}

// shade a face rect (local units) and darken its foot (ambient occlusion)
function faceShade(g, len, hgt, dark, ao = 0.4) {
  if (dark > 0) {
    g.fillStyle = `rgba(18,10,4,${dark})`;
    g.fillRect(0, 0, len, hgt);
  }
  const gr = g.createLinearGradient(0, 0, 0, Math.min(hgt, 0.45));
  gr.addColorStop(0, `rgba(12,6,2,${ao})`);
  gr.addColorStop(1, 'rgba(12,6,2,0)');
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

  // dusk over the town
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#101a1d');
  sky.addColorStop(0.6, '#141f20');
  sky.addColorStop(1, '#0c1213');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  // the town ground: a big diamond of rough grass and packed earth
  const m0 = -ROAD_LEN;
  const m1 = Math.max(w, h) + 8;
  g.save();
  S.planeAt(g, 0, 0, OUT_Z);
  g.fillStyle = '#1e2922';
  g.fillRect(m0, m0, m1 - m0, m1 - m0);
  for (let i = 0; i < 2600; i++) {
    const x = m0 + r() * (m1 - m0);
    const y = m0 + r() * (m1 - m0);
    g.fillStyle = tone(PAL.grass, r, 0.85 + r() * 0.3);
    g.beginPath();
    g.ellipse(x, y, 0.06 + r() * 0.14, 0.05 + r() * 0.1, r() * 3, 0, TAU);
    g.fill();
  }
  // a cobbled apron right around the keep
  g.fillStyle = PAL.mortar;
  g.fillRect(-1.6, -1.6, w + 2.6, h + 2.6);
  cobbles(g, r, -1.6, -1.6, w + 2.6, h + 2.6, 0.82);
  g.restore();

  // houses of Brasswick: behind the keep and out on the flanks
  const houses = [
    [-3.4, -3.2, 2.2, 1.8, 1.5], [-6.6, -2.6, 2.0, 2.0, 1.9], [-3.0, -6.6, 1.8, 2.4, 1.7], [-7.0, -6.4, 2.6, 2.2, 2.3],
    [-10.4, -3.4, 2.4, 2.0, 1.6], [-3.6, -10.2, 2.0, 2.4, 1.8], [-9.8, -8.8, 2.6, 2.6, 2.1],
    [w + 1.4, -3.0, 2.0, 2.2, 1.6], [w + 1.2, -7.4, 2.4, 2.0, 2.0], [-3.0, h + 1.4, 2.2, 2.0, 1.6], [-7.4, h + 1.2, 2.0, 2.4, 2.0],
  ];
  houses.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const hs of houses) drawHouse(S, g, r, ...hs);

  // streets: the lanes, cobbled, with a brass-ringed marker at every position
  for (const L of keep.lanes) drawStreet(S, g, r, L);

  // dusk falls off away from the keep
  {
    const [cx, cy] = S.p((w - 1) / 2, (h - 1) / 2, 0);
    const R = S.TW * w * 0.55;
    const fog = g.createRadialGradient(cx, cy, R * 0.72, cx, cy, R * 1.65);
    fog.addColorStop(0, 'rgba(8,12,13,0)');
    fog.addColorStop(0.35, 'rgba(8,12,13,0.55)');
    fog.addColorStop(1, 'rgba(6,9,10,0.92)');
    g.fillStyle = fog;
    g.fillRect(0, 0, W, H);
  }

  // the plinth: the near sides of the keep, in masonry
  g.save();
  S.faceX(g, w - 0.5, -0.5, OUT_Z);
  masonry(g, r, h, -OUT_Z, PAL.wallR, { course: 0.16 });
  faceShade(g, h, -OUT_Z, 0.25, 0.2);
  g.restore();
  g.save();
  S.faceY(g, -0.5, h - 0.5, OUT_Z);
  masonry(g, r, w, -OUT_Z, PAL.wallL, { course: 0.16 });
  faceShade(g, w, -OUT_Z, 0.08, 0.2);
  g.restore();

  // courtyard floor: flagstones, lighter along the worn paths through the middle
  const mid = (w - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = S.cell(x, y);
      if (!cell || cell.kind === 'void') continue;
      const worn = Math.abs(x - mid - 0.5) < 1.2 || Math.abs(y - mid - 0.5) < 1.2 || (x === y && x > 2);
      g.save();
      S.planeAt(g, x, y, 0);
      flagstones(g, r, -0.5, -0.5, 1, 1, worn ? PAL.worn : PAL.floor, PAL.mortar, { cracks: true, depth: 1 });
      if (cell.kind === 'floor' && !cell.h) tileFrame(g);
      g.restore();
    }
  }

  // the cell grid: a darker joint along every cell edge, so steps can be counted
  g.save();
  S.planeAt(g, 0, 0, 0);
  g.fillStyle = 'rgba(40,24,10,0.55)';
  for (let i = 0; i <= w; i++) g.fillRect(i - 0.5 - 0.022, -0.5, 0.044, h);
  for (let i = 0; i <= h; i++) g.fillRect(-0.5, i - 0.5 - 0.022, w, 0.044);
  g.restore();

  // soft cast shadows (toward +x) and ambient occlusion at the foot of anything raised
  g.save();
  S.planeAt(g, 0, 0, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const zz = S.solidZ(x, y);
      if (zz <= 0) continue;
      const len = Math.min(1.1, zz * 0.85);
      for (let i = 1; i <= 4; i++) {
        g.fillStyle = 'rgba(24,12,2,0.085)';
        const o = (len * i) / 4;
        g.fillRect(x - 0.5 + o * 0.9, y - 0.5 + o * 0.35, 1, 1);
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (S.solidZ(x, y) > 0) continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (S.solidZ(x + dx, y + dy) <= 0.01 && S.cell(x + dx, y + dy)) continue;
        if (!S.cell(x + dx, y + dy)) continue;
        const ex = x + dx * 0.5;
        const ey = y + dy * 0.5;
        const gr = g.createLinearGradient(ex, ey, ex - dx * 0.38, ey - dy * 0.38);
        gr.addColorStop(0, 'rgba(20,10,2,0.5)');
        gr.addColorStop(1, 'rgba(20,10,2,0)');
        g.fillStyle = gr;
        if (dx) g.fillRect(dx < 0 ? x - 0.5 : x + 0.12, y - 0.5, 0.38, 1);
        else g.fillRect(x - 0.5, dy < 0 ? y - 0.5 : y + 0.12, 1, 0.38);
      }
    }
  }
  g.restore();
  return c;
}

// small rounded cobbles over a rect of the current plane
function cobbles(g, r, x0, y0, w, h, light = 1) {
  const s = 0.17;
  for (let y = y0 + s / 2; y < y0 + h; y += s * 0.86) {
    const shift = (Math.round((y - y0) / (s * 0.86)) % 2) * s * 0.5;
    for (let x = x0 + s / 2 + shift; x < x0 + w; x += s) {
      g.fillStyle = tone(PAL.cobble, r, light * (0.85 + r() * 0.3));
      g.beginPath();
      g.ellipse(x + (r() - 0.5) * 0.03, y + (r() - 0.5) * 0.03, s * 0.44, s * 0.4, 0, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,235,200,0.12)';
      g.beginPath();
      g.ellipse(x - 0.02, y - 0.02, s * 0.22, s * 0.18, 0, 0, TAU);
      g.fill();
    }
  }
}

function drawStreet(S, g, r, L) {
  const cat = S.catapult(L.cat) || { x: L.x - L.dir[0], y: L.y - L.dir[1] };
  const along = L.dir;
  const perp = [-L.dir[1], L.dir[0]];
  g.save();
  // local frame: u along the street from the wall, v across it
  const [sx, sy] = S.p(cat.x + along[0] * 0.5, cat.y + along[1] * 0.5, OUT_Z);
  const a = S.TW / 2;
  const b = S.TH / 2;
  // grid (gx, gy) -> screen: (gx - gy)·a, (gx + gy)·b; u = along, v = perp
  const ux = (along[0] - along[1]) * a;
  const uy = (along[0] + along[1]) * b;
  const vx = (perp[0] - perp[1]) * a;
  const vy = (perp[0] + perp[1]) * b;
  g.transform(ux, uy, vx, vy, sx, sy);
  const hw = ROAD_W / 2;
  // kerbs, then the cobbled bed
  g.fillStyle = '#2a221a';
  g.fillRect(0, -hw - 0.14, ROAD_LEN, ROAD_W + 0.28);
  for (const side of [-1, 1]) {
    let u = 0;
    while (u < ROAD_LEN) {
      const l = 0.35 + r() * 0.3;
      g.fillStyle = tone(['#8f7c62', '#837058', '#9a866a'], r);
      g.fillRect(u + 0.02, side < 0 ? -hw - 0.12 : hw + 0.02, l - 0.04, 0.1);
      u += l;
    }
  }
  g.fillStyle = PAL.mortar;
  g.fillRect(0, -hw, ROAD_LEN, ROAD_W);
  cobbles(g, r, 0, -hw, ROAD_LEN, ROAD_W, 1);
  // a worn track down the middle
  const tr = g.createLinearGradient(0, -hw, 0, hw);
  tr.addColorStop(0, 'rgba(0,0,0,0)');
  tr.addColorStop(0.5, 'rgba(255,230,190,0.07)');
  tr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = tr;
  g.fillRect(0, -hw, ROAD_LEN, ROAD_W);
  // a marker at every lane position: a brass-ringed paving disc
  for (let p = 0; p < L.len; p++) {
    const u = 0.5 + p * LANE_STRIDE;
    g.fillStyle = '#3a2e22';
    g.beginPath();
    g.ellipse(u, 0, 0.46, 0.46, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#b88a34';
    g.beginPath();
    g.ellipse(u, 0, 0.42, 0.42, 0, 0, TAU);
    g.fill();
    g.fillStyle = '#8a8270';
    g.beginPath();
    g.ellipse(u, 0, 0.35, 0.35, 0, 0, TAU);
    g.fill();
    // a cog engraved in the stone
    g.strokeStyle = 'rgba(40,30,18,0.7)';
    g.lineWidth = 0.035;
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const an = (i / 16) * TAU;
      const rr = i % 2 ? 0.2 : 0.26;
      g.lineTo(u + Math.cos(an) * rr, Math.sin(an) * rr);
    }
    g.closePath();
    g.stroke();
    // chevrons pointing at the keep, between this marker and the next
    if (p < L.len - 1) {
      g.fillStyle = 'rgba(240,212,138,0.22)';
      for (let i = 0; i < 2; i++) {
        const cu = u + LANE_STRIDE * (0.4 + i * 0.22);
        g.beginPath();
        g.moveTo(cu - 0.12, 0);
        g.lineTo(cu + 0.04, -0.26);
        g.lineTo(cu + 0.14, -0.26);
        g.lineTo(cu - 0.02, 0);
        g.lineTo(cu + 0.14, 0.26);
        g.lineTo(cu + 0.04, 0.26);
        g.closePath();
        g.fill();
      }
    }
  }
  g.restore();
}

// a town house: brick walls with lit windows, slate roof, chimney (static, behind everything)
function drawHouse(S, g, r, x, y, wx, wy, hz) {
  const x0 = x;
  const y0 = y;
  const x1 = x + wx;
  const y1 = y + wy;
  const z0 = OUT_Z;
  const z1 = OUT_Z + hz;
  const brickL = ['#5a4436', '#523d31', '#614a3a'];
  const brickR = ['#3e2f26', '#382a22', '#44332a'];
  // +x face
  g.save();
  S.faceX(g, x1, y0, z0);
  masonry(g, r, wy, hz, brickR, { course: 0.12, mortar: '#241a14' });
  windows(g, r, wy, hz, 0.75);
  g.restore();
  // +y face
  g.save();
  S.faceY(g, x0, y1, z0);
  masonry(g, r, wx, hz, brickL, { course: 0.12, mortar: '#2a1f18' });
  windows(g, r, wx, hz, 1);
  g.restore();
  // roof: ridge along x; the slope toward +y and the gable end at +x are visible
  const zr = z1 + Math.min(wx, wy) * 0.55;
  const ym = (y0 + y1) / 2;
  const slope = [S.p(x0 - 0.1, ym, zr), S.p(x1 + 0.1, ym, zr), S.p(x1 + 0.1, y1 + 0.15, z1 - 0.05), S.p(x0 - 0.1, y1 + 0.15, z1 - 0.05)];
  poly(g, slope);
  g.fillStyle = '#3c4146';
  g.fill();
  // slate rows
  g.strokeStyle = 'rgba(15,18,20,0.6)';
  g.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const a = S.p(x0 - 0.1, ym + (y1 + 0.15 - ym) * t, zr + (z1 - 0.05 - zr) * t);
    const b = S.p(x1 + 0.1, ym + (y1 + 0.15 - ym) * t, zr + (z1 - 0.05 - zr) * t);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  }
  const gable = [S.p(x1, y0 - 0.1, z1), S.p(x1, ym, zr), S.p(x1, y1 + 0.1, z1)];
  poly(g, gable);
  g.fillStyle = '#33271f';
  g.fill();
  const back = [S.p(x0 - 0.1, ym, zr), S.p(x1 + 0.1, ym, zr), S.p(x1 + 0.1, y0 - 0.15, z1 - 0.05), S.p(x0 - 0.1, y0 - 0.15, z1 - 0.05)];
  poly(g, back);
  g.fillStyle = '#2c3034';
  g.fill();
  poly(g, slope);
  g.fill();
  poly(g, slope);
  g.fillStyle = '#41474c';
  g.fill();
  g.strokeStyle = 'rgba(15,18,20,0.55)';
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const a = S.p(x0 - 0.1, ym + (y1 + 0.15 - ym) * t, zr + (z1 - 0.05 - zr) * t);
    const b = S.p(x1 + 0.1, ym + (y1 + 0.15 - ym) * t, zr + (z1 - 0.05 - zr) * t);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  }
  // chimney with a wisp of smoke
  const cx = x0 + wx * (0.25 + r() * 0.4);
  const cy = ym - 0.1;
  boxSolid(S, g, cx - 0.16, cy - 0.16, cx + 0.16, cy + 0.16, zr - 0.3, zr + 0.55, '#5a4436', '#3e2f26', '#4a382c');
  const [sx, sy] = S.p(cx, cy, zr + 0.9);
  g.globalAlpha = 0.18;
  g.drawImage(softSprite('rgba(170,170,165,1)', 64, 0.1), sx - S.TW * 0.4, sy - S.TW * 0.5, S.TW * 0.8, S.TW * 0.7);
  g.globalAlpha = 1;
}

function windows(g, r, len, hgt, lit) {
  const n = Math.max(1, Math.floor(len / 0.7));
  for (let i = 0; i < n; i++) {
    for (const v of hgt > 1.4 ? [0.3, 0.95] : [0.35]) {
      const u = (i + 0.5) * (len / n) - 0.12;
      const on = r() < 0.55;
      g.fillStyle = '#1a120c';
      g.fillRect(u - 0.03, v - 0.03, 0.3, 0.36);
      g.fillStyle = on ? `rgba(255,${170 + Math.floor(r() * 40)},80,${0.75 * lit})` : 'rgba(40,46,50,0.9)';
      g.fillRect(u, v, 0.24, 0.3);
      g.fillStyle = '#1a120c';
      g.fillRect(u + 0.11, v, 0.02, 0.3);
      g.fillRect(u, v + 0.14, 0.24, 0.02);
    }
  }
}

// a plain shaded box (no texture)
function boxSolid(S, g, x0, y0, x1, y1, z0, z1, top, right, left) {
  poly(g, [S.p(x1, y0, z1), S.p(x1, y1, z1), S.p(x1, y1, z0), S.p(x1, y0, z0)]);
  g.fillStyle = right;
  g.fill();
  poly(g, [S.p(x0, y1, z1), S.p(x1, y1, z1), S.p(x1, y1, z0), S.p(x0, y1, z0)]);
  g.fillStyle = left;
  g.fill();
  poly(g, [S.p(x0, y0, z1), S.p(x1, y0, z1), S.p(x1, y1, z1), S.p(x0, y1, z1)]);
  g.fillStyle = top;
  g.fill();
}

// light: warm pools, drawn additively and flickering a little
function drawLight(S, px) {
  const c = newCanvas(W * px, H * px);
  const g = c.getContext('2d');
  g.scale(px, px);
  const { w, h } = S;
  const pool = (x, y, z, rr, a, col = 'rgba(255,182,72,1)') => {
    const [sx, sy] = S.p(x, y, z);
    const R = rr * S.TW * 0.5;
    g.globalAlpha = a;
    g.drawImage(softSprite(col, 128, 0.05), sx - R, sy - R * 0.62, R * 2, R * 1.24);
  };
  pool((w - 1) / 2 + 0.5, (h - 1) / 2 + 0.5, 0, 8.5, 0.2);
  pool((w - 1) / 2, (h - 1) / 2, 0, 4.5, 0.12, 'rgba(255,214,150,1)');
  pool(1.5, 1.5, 1, 3.4, 0.16);
  pool(w - 1.5, 1, 1, 2.6, 0.14);
  pool(1, h - 1.5, 1, 2.6, 0.14);
  for (const l of S.lamps) {
    pool(l.x, l.y, OUT_Z, 3.0, 0.2);
    pool(l.x, l.y, OUT_Z + 1.5, 0.9, 0.5, 'rgba(255,200,110,1)');
  }
  g.globalAlpha = 1;
  return c;
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
  let z1 = 1;
  let ext = 0.5;
  if (kind === 'wall') {
    z0 = OUT_Z;
    z1 = WALL_Z + 0.5;
  }
  if (kind === 'crate') z1 = CRATE_Z + 0.05;
  if (kind === 'pipes') z1 = CRATE_Z + 0.3;
  if (kind === 'lamp') {
    z0 = OUT_Z;
    z1 = OUT_Z + 1.9;
    ext = 0.3;
  }
  const box = cellBox(S, x, y, z0, z1, 8, ext);
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
      drawRaised(S, g, r, x, y, kind === 'pillar');
      break;
    case 'crate':
      drawCrate(S, g, r, x, y);
      break;
    case 'pipes':
      drawPipes(S, g, r, x, y);
      break;
    case 'stairs':
      drawStairs(S, g, r, x, y, pr.highs);
      break;
    case 'lamp':
      drawLamp(S, g, x, y);
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

// a textured stone column: visible faces in masonry, top in slabs
function stoneColumn(S, g, r, x, y, z0, z1, topPal, topMortar, walkable = false) {
  if (lowerAt(S, x + 1, y, z1)) {
    g.save();
    S.faceX(g, x + 0.5, y - 0.5, z0);
    masonry(g, r, 1, z1 - z0, PAL.wallR, { streaks: true });
    faceShade(g, 1, z1 - z0, 0.08, 0.45);
    g.restore();
  }
  if (lowerAt(S, x, y + 1, z1)) {
    g.save();
    S.faceY(g, x - 0.5, y + 0.5, z0);
    masonry(g, r, 1, z1 - z0, PAL.wallL, { streaks: true });
    faceShade(g, 1, z1 - z0, 0, 0.4);
    g.restore();
  }
  g.save();
  S.planeAt(g, x, y, z1);
  flagstones(g, r, -0.5, -0.5, 1, 1, topPal, topMortar, { m: 0.022, depth: 1 });
  if (walkable) tileFrame(g, { dark: 'rgba(90,66,36,0.75)' });
  // bright lip along the edges that drop away: the platform reads as raised at a glance
  g.fillStyle = 'rgba(255,240,200,0.55)';
  if (lowerAt(S, x + 1, y, z1)) g.fillRect(0.44, -0.5, 0.06, 1);
  if (lowerAt(S, x, y + 1, z1)) g.fillRect(-0.5, 0.44, 1, 0.06);
  g.fillStyle = 'rgba(30,18,6,0.35)';
  if (lowerAt(S, x - 1, y, z1)) g.fillRect(-0.5, -0.5, 0.04, 1);
  if (lowerAt(S, x, y - 1, z1)) g.fillRect(-0.5, -0.5, 1, 0.04);
  g.restore();
  // crisp outline of the visible edges
  g.strokeStyle = 'rgba(30,18,6,0.65)';
  g.lineWidth = 1.2;
  if (lowerAt(S, x + 1, y, z1)) {
    const a = S.p(x + 0.5, y - 0.5, z1);
    const b = S.p(x + 0.5, y + 0.5, z1);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  }
  if (lowerAt(S, x, y + 1, z1)) {
    const a = S.p(x - 0.5, y + 0.5, z1);
    const b = S.p(x + 0.5, y + 0.5, z1);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  }
}

function drawRaised(S, g, r, x, y, pillar) {
  stoneColumn(S, g, r, x, y, 0, 1, pillar ? PAL.wallL : PAL.raised, PAL.raisedMortar, !pillar);
}

// a stone box (merlon) with masonry faces
function stoneBox(S, g, r, x0, y0, x1, y1, z0, z1) {
  g.save();
  S.faceX(g, x1, y0, z0);
  masonry(g, r, y1 - y0, z1 - z0, PAL.wallR, { course: 0.15 });
  faceShade(g, y1 - y0, z1 - z0, 0.1, 0.2);
  g.restore();
  g.save();
  S.faceY(g, x0, y1, z0);
  masonry(g, r, x1 - x0, z1 - z0, PAL.wallL, { course: 0.15 });
  faceShade(g, x1 - x0, z1 - z0, 0, 0.2);
  g.restore();
  const top = [S.p(x0, y0, z1), S.p(x1, y0, z1), S.p(x1, y1, z1), S.p(x0, y1, z1)];
  poly(g, top);
  g.fillStyle = tone(PAL.cap, r, 1.04);
  g.fill();
  g.strokeStyle = 'rgba(30,18,6,0.6)';
  g.lineWidth = 1;
  g.stroke();
}

function drawWallCell(S, g, r, x, y, isCat) {
  const z0 = x === 0 || y === 0 ? OUT_Z : 0;
  stoneColumn(S, g, r, x, y, z0, WALL_Z, PAL.cap, PAL.wallMortar);
  if (isCat) {
    // a timber deck for the catapult
    g.save();
    S.planeAt(g, x, y, WALL_Z);
    g.fillStyle = PAL.woodDark;
    g.fillRect(-0.44, -0.44, 0.88, 0.88);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = tone(PAL.wood, r, 0.9);
      g.fillRect(-0.42, -0.42 + i * 0.172, 0.84, 0.15);
    }
    g.fillStyle = '#d9b25a';
    for (const [a, b] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) {
      g.beginPath();
      g.arc(a, b, 0.035, 0, TAU);
      g.fill();
    }
    g.restore();
    return;
  }
  // crenellations on the outer edge: merlons with gaps, drawn back to front
  const mz = WALL_Z + 0.42;
  const d = 0.22;
  const boxes = [];
  if (y === 0) {
    boxes.push([x - 0.5, y - 0.5, x - 0.06, y - 0.5 + d]);
    boxes.push([x + 0.12, y - 0.5, x + 0.5, y - 0.5 + d]);
  }
  if (x === 0) {
    boxes.push([x - 0.5, y - 0.5, x - 0.5 + d, y - 0.06]);
    boxes.push([x - 0.5, y + 0.12, x - 0.5 + d, y + 0.5]);
  }
  boxes.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [a, b, c2, d2] of boxes) stoneBox(S, g, r, a, b, c2, d2, WALL_Z, mz);
}

// a plank box with corner braces, nails and a stencil
function drawCrate(S, g, r, x, y) {
  const s = 0.36 + r() * 0.04;
  const z1 = CRATE_Z - r() * 0.08;
  const x0 = x - s;
  const x1 = x + s;
  const y0 = y - s;
  const y1 = y + s;
  const planks = (len, hgt, dark) => {
    g.fillStyle = PAL.woodDark;
    g.fillRect(0, 0, len, hgt);
    const n = 4;
    for (let i = 0; i < n; i++) {
      g.fillStyle = tone(PAL.wood, r, dark);
      g.fillRect(0.02, (i * hgt) / n + 0.012, len - 0.04, hgt / n - 0.024);
      // grain
      g.fillStyle = 'rgba(60,30,8,0.25)';
      g.fillRect(0.05 + r() * 0.2, (i * hgt) / n + hgt / n / 2, len * 0.5, 0.008);
    }
    // corner braces and a diagonal
    g.fillStyle = shadeHex('#6a4422', dark);
    g.fillRect(0, 0, 0.09, hgt);
    g.fillRect(len - 0.09, 0, 0.09, hgt);
    g.fillRect(0, hgt - 0.08, len, 0.08);
    g.fillRect(0, 0, len, 0.07);
    g.save();
    g.beginPath();
    g.rect(0.09, 0.07, len - 0.18, hgt - 0.15);
    g.clip();
    g.strokeStyle = shadeHex('#6a4422', dark);
    g.lineWidth = 0.08;
    g.beginPath();
    g.moveTo(0.09, 0.07);
    g.lineTo(len - 0.09, hgt - 0.08);
    g.stroke();
    g.restore();
    // nails
    g.fillStyle = '#2a2622';
    for (const [u, v] of [[0.045, 0.035], [len - 0.045, 0.035], [0.045, hgt - 0.04], [len - 0.045, hgt - 0.04], [0.045, hgt / 2], [len - 0.045, hgt / 2]]) {
      g.beginPath();
      g.arc(u, v, 0.016, 0, TAU);
      g.fill();
    }
  };
  g.save();
  S.faceX(g, x1, y0, 0);
  planks(y1 - y0, z1, 0.72);
  g.restore();
  g.save();
  S.faceY(g, x0, y1, 0);
  planks(x1 - x0, z1, 0.95);
  // stencil: a cog and an arrow
  g.fillStyle = 'rgba(30,18,6,0.55)';
  g.font = 'bold 0.16px Georgia, serif';
  g.save();
  g.translate((x1 - x0) / 2, z1 / 2);
  g.scale(1, -1);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('BRASSWICK', 0, 0);
  g.restore();
  g.restore();
  g.save();
  S.planeAt(g, x, y, z1);
  g.fillStyle = PAL.woodDark;
  g.fillRect(-s, -s, 2 * s, 2 * s);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = tone(PAL.wood, r, 1.12);
    g.fillRect(-s + 0.02, -s + (i * 2 * s) / 4 + 0.012, 2 * s - 0.04, (2 * s) / 4 - 0.024);
  }
  g.strokeStyle = 'rgba(40,20,4,0.5)';
  g.lineWidth = 0.03;
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const an = (i / 12) * TAU;
    const rr = i % 2 ? 0.1 : 0.15;
    g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
  }
  g.closePath();
  g.stroke();
  g.fillStyle = '#2a2622';
  for (const [u, v] of [[-s + 0.05, -s + 0.05], [s - 0.05, -s + 0.05], [-s + 0.05, s - 0.05], [s - 0.05, s - 0.05]]) {
    g.beginPath();
    g.arc(u, v, 0.018, 0, TAU);
    g.fill();
  }
  g.restore();
  // outline
  g.strokeStyle = 'rgba(30,14,2,0.8)';
  g.lineWidth = 1.2;
  poly(g, [S.p(x0, y0, z1), S.p(x1, y0, z1), S.p(x1, y0, 0), S.p(x1, y1, 0), S.p(x0, y1, 0), S.p(x0, y1, z1)]);
  g.stroke();
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
      pts.push(S.p(x, y + Math.cos(an) * rr, z + (Math.sin(an) * rr) / HZ_K * 0.5));
    }
    return pts;
  };
  const A = cap(xa);
  const B = cap(xb);
  const body = hull([...A, ...B]);
  const [, ty] = S.p(xa, y, z + rr * 1.4);
  const [, by] = S.p(xa, y, z - rr * 1.4);
  const gr = g.createLinearGradient(0, ty - S.TH * 0.2, 0, by + S.TH * 0.2);
  gr.addColorStop(0, shadeHex(col, 1.45));
  gr.addColorStop(0.45, col);
  gr.addColorStop(1, shadeHex(col, 0.45));
  poly(g, body);
  g.fillStyle = gr;
  g.fill();
  g.strokeStyle = 'rgba(10,8,6,0.8)';
  g.lineWidth = 1.2;
  g.stroke();
  // flanges
  for (const t of [0.08, 0.92]) {
    const F = cap(xa + (xb - xa) * t);
    poly(g, F);
    g.strokeStyle = 'rgba(20,16,12,0.7)';
    g.lineWidth = 2.2 * S.k;
    g.stroke();
  }
  // the open end facing +x
  poly(g, B);
  g.fillStyle = shadeHex(col, 0.75);
  g.fill();
  g.stroke();
  const inner = B.map(([a, b]) => {
    const [cx, cy] = S.p(xb, y, z);
    return [cx + (a - cx) * 0.62, cy + (b - cy) * 0.62];
  });
  poly(g, inner);
  g.fillStyle = '#120e0a';
  g.fill();
}

// a stack of iron pipes on timber cradles, with a red valve wheel: clearly not a bomb
function drawPipes(S, g, r, x, y) {
  // cradles
  for (const cx of [x - 0.28, x + 0.28]) boxSolid(S, g, cx - 0.06, y - 0.42, cx + 0.06, y + 0.42, 0, 0.16, '#8a6038', '#4a2e16', '#6a4422');
  const col = ['#6f767a', '#646b6f', '#7a8084'];
  pipe(S, g, x - 0.45, x + 0.45, y - 0.2, 0.32, 0.17, col[0]);
  pipe(S, g, x - 0.45, x + 0.45, y + 0.2, 0.32, 0.17, col[1]);
  pipe(S, g, x - 0.42, x + 0.4, y, 0.62, 0.17, col[2]);
  // valve wheel standing on the top pipe
  const [vx, vy] = S.p(x - 0.05, y, 0.95);
  g.strokeStyle = '#2a0c06';
  g.lineWidth = 3.4 * S.k;
  g.beginPath();
  g.moveTo(vx, vy + 12 * S.k);
  g.lineTo(vx, vy);
  g.stroke();
  g.save();
  g.translate(vx, vy - 4 * S.k);
  g.scale(1, 0.5);
  g.strokeStyle = '#b8281a';
  g.lineWidth = 4 * S.k;
  g.beginPath();
  g.arc(0, 0, 13 * S.k, 0, TAU);
  g.stroke();
  for (let i = 0; i < 3; i++) {
    const an = (i / 3) * Math.PI;
    g.beginPath();
    g.moveTo(Math.cos(an) * 13 * S.k, Math.sin(an) * 13 * S.k);
    g.lineTo(-Math.cos(an) * 13 * S.k, -Math.sin(an) * 13 * S.k);
    g.lineWidth = 2.4 * S.k;
    g.stroke();
  }
  g.fillStyle = '#d9b25a';
  g.beginPath();
  g.arc(0, 0, 3.5 * S.k, 0, TAU);
  g.fill();
  g.restore();
  // pressure gauge on a stub
  const [gx, gy] = S.p(x + 0.25, y + 0.2, 0.72);
  g.fillStyle = '#efe3c2';
  g.beginPath();
  g.arc(gx, gy, 7 * S.k, 0, TAU);
  g.fill();
  g.strokeStyle = '#6e5120';
  g.lineWidth = 2.2 * S.k;
  g.stroke();
  g.strokeStyle = '#b8281a';
  g.lineWidth = 1.5 * S.k;
  g.beginPath();
  g.moveTo(gx, gy);
  g.lineTo(gx + 4 * S.k, gy - 4 * S.k);
  g.stroke();
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
  const C = B || [A[1], A[0]]; // the across direction of a straight flight
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
    steps.push(rect(s0, 1, 0, 1, z0, z1, i)); // the slab along A
    if (B && s0 > 0) steps.push(rect(0, s0, s0, 1, z0, z1, i)); // the rest of the L, along B
  }
  // lower treads first; within a tread, back to front
  steps.sort((p, q) => p.lvl - q.lvl || p.x0 + p.y0 - (q.x0 + q.y0));
  // outer (low, large) treads first; each higher tread sits on the one below
  for (const st of steps) {
    const hz = st.z - st.z0;
    g.save();
    S.faceX(g, st.x1, st.y0, st.z0);
    masonry(g, r, st.y1 - st.y0, hz, PAL.wallR, { course: 0.125 });
    faceShade(g, st.y1 - st.y0, hz, 0.14, 0.12);
    g.restore();
    g.save();
    S.faceY(g, st.x0, st.y1, st.z0);
    masonry(g, r, st.x1 - st.x0, hz, PAL.wallL, { course: 0.125 });
    faceShade(g, st.x1 - st.x0, hz, 0.02, 0.12);
    g.restore();
    const top = [S.p(st.x0, st.y0, st.z), S.p(st.x1, st.y0, st.z), S.p(st.x1, st.y1, st.z), S.p(st.x0, st.y1, st.z)];
    poly(g, top);
    g.fillStyle = tone(PAL.raised, r, 0.98);
    g.fill();
    g.strokeStyle = 'rgba(46,26,8,0.6)';
    g.lineWidth = 1.1;
    g.stroke();
    // a bright nosing on the tread's front edges
    g.strokeStyle = 'rgba(255,240,205,0.5)';
    g.lineWidth = 1.6 * S.k;
    g.beginPath();
    const e1 = S.p(st.x1, st.y0, st.z);
    const e2 = S.p(st.x1, st.y1, st.z);
    const e3 = S.p(st.x0, st.y1, st.z);
    g.moveTo(e1[0], e1[1]);
    g.lineTo(e2[0], e2[1]);
    g.lineTo(e3[0], e3[1]);
    g.stroke();
  }
  // the stud on the tread underfoot (the centre of the cell)
  g.save();
  S.planeAt(g, x, y, 0.5);
  stud(g);
  g.restore();
}

// a cast-iron street lamp
function drawLamp(S, g, x, y) {
  const k = S.k;
  const [bx, by] = S.p(x, y, OUT_Z);
  const [, ty] = S.p(x, y, OUT_Z + 1.55);
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.beginPath();
  g.ellipse(bx, by, 9 * k, 4 * k, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#1c1a18';
  g.fillRect(bx - 5 * k, by - 8 * k, 10 * k, 8 * k);
  g.fillRect(bx - 2 * k, ty, 4 * k, by - ty - 6 * k);
  g.fillStyle = '#3a3632';
  g.fillRect(bx - 1 * k, ty, 1.5 * k, by - ty - 6 * k);
  // lantern
  g.fillStyle = '#1c1a18';
  g.beginPath();
  g.moveTo(bx - 9 * k, ty - 2 * k);
  g.lineTo(bx + 9 * k, ty - 2 * k);
  g.lineTo(bx + 6 * k, ty - 20 * k);
  g.lineTo(bx - 6 * k, ty - 20 * k);
  g.closePath();
  g.fill();
  g.fillStyle = '#ffd27a';
  g.fillRect(bx - 5 * k, ty - 17 * k, 10 * k, 13 * k);
  g.fillStyle = '#fff3c8';
  g.fillRect(bx - 2 * k, ty - 14 * k, 4 * k, 8 * k);
  g.fillStyle = '#1c1a18';
  g.fillRect(bx - 0.75 * k, ty - 17 * k, 1.5 * k, 13 * k);
  g.beginPath();
  g.moveTo(bx - 8 * k, ty - 20 * k);
  g.lineTo(bx, ty - 27 * k);
  g.lineTo(bx + 8 * k, ty - 20 * k);
  g.closePath();
  g.fill();
}
