// catapult_coop on the phone: the flat top-down map of the keep, drawn on a canvas.
//
// The keep fills the canvas; its four lanes are drawn as compact strips outside the wall (row
// y = 0 on top, column x = 0 on the left). The strip along the long side of the screen gets the
// spare room, so on a landscape phone the left lanes are long and the top ones short. The
// top-left corner between the strips shows the wall's hit points.
//
// Height reads at a glance: courtyard (h 0) is dark flagstone, raised cells (h 1) are light
// stone with a bevel and a cast shadow, every edge you cannot walk across (a height change
// without stairs) is a thick dark line, stairs are drawn as steps rising toward the high side.

import { cellAt, walkable } from './rules.js';

const TAU = Math.PI * 2;
const MACHINE_COLORS = ['#d8d0b4', '#e2c34a', '#d9824f', '#ff5a45'];
const BOMB_COLORS = { keg: '#b5743a', grapeshot: '#9aa6aa', stopwatch: '#7fd4ff' };
export const bombColor = (kind) => BOMB_COLORS[kind] || '#ccc';
const FONT = 'Georgia, serif';

export class Board {
  // get(): the view to draw, read every frame:
  //   { lay, keep, defs, snap, players: Map, you, targets: [..], plan, planFrom, committed,
  //     ghosts: [{color, plan, from}], initials: Map }
  constructor(canvas, get, onTap) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.get = get;
    this.onTap = onTap;
    this.W = 0; this.H = 0; this.dpr = 1;
    this.geo = null;
    this.running = false;
    this._bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  destroy() { this.stop(); this.ro.disconnect(); }

  resize() {
    const r = this.c.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.W = r.width; this.H = r.height;
    this.c.width = Math.max(1, Math.round(r.width * this.dpr));
    this.c.height = Math.max(1, Math.round(r.height * this.dpr));
    this.geo = null;
  }

  // Cell size and offsets for the current canvas and layout.
  geometry(lay) {
    const key = `${this.W}x${this.H}:${lay.w}x${lay.h}`;
    if (this.geo?.key === key) return this.geo;
    const pad = 3;
    const minLS = 1.5;
    const maxLS = 4;
    const aw = this.W - pad * 2;
    const ah = this.H - pad * 2;
    const s = Math.max(4, Math.min(aw / (lay.w + minLS), ah / (lay.h + minLS)));
    const lsL = Math.min(maxLS, Math.max(minLS, aw / s - lay.w));
    const lsT = Math.min(maxLS, Math.max(minLS, ah / s - lay.h));
    const ox = Math.round((this.W - (lsL + lay.w) * s) / 2 + lsL * s);
    const oy = Math.round((this.H - (lsT + lay.h) * s) / 2 + lsT * s);
    this.geo = { key, s, lsL, lsT, ox, oy };
    return this.geo;
  }

  // Lane strip rectangle (screen) of lane L, plus the screen centre of position p.
  laneRect(L, cat, geo) {
    const { s, ox, oy, lsL, lsT } = geo;
    const half = 1.1; // the strip is 2.2 cells wide
    if (L.dir[1] === -1) {
      const x0 = ox + (cat.x + 0.5 - half) * s;
      return { x: x0, y: oy - lsT * s, w: half * 2 * s, h: lsT * s, vertical: true,
        at: (p) => [ox + (cat.x + 0.5) * s, oy - ((p + 0.5) * lsT / L.len) * s], step: (lsT / L.len) * s };
    }
    const y0 = oy + (cat.y + 0.5 - half) * s;
    return { x: ox - lsL * s, y: y0, w: lsL * s, h: half * 2 * s, vertical: false,
      at: (p) => [ox - ((p + 0.5) * lsL / L.len) * s, oy + (cat.y + 0.5) * s], step: (lsL / L.len) * s };
  }

  _bind() {
    const c = this.c;
    let down = null;
    c.addEventListener('pointerdown', (e) => {
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      down = { x: e.clientX, y: e.clientY, moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 14) down.moved = true;
    });
    const end = (e) => {
      if (!down) return;
      const d = down;
      down = null;
      if (e.type === 'pointercancel' || d.moved) return;
      const r = c.getBoundingClientRect();
      this.onTap(this.pick(e.clientX - r.left, e.clientY - r.top));
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // What a tap at screen (sx, sy) means: the nearest highlighted target within a forgiving
  // radius (a tap on a lane strip counts as a tap on its catapult), else the cell tapped.
  pick(sx, sy) {
    const v = this.get();
    if (!v?.lay || !v.keep) return null;
    const geo = this.geometry(v.lay);
    let fx = (sx - geo.ox) / geo.s;
    let fy = (sy - geo.oy) / geo.s;
    for (const L of v.keep.lanes) {
      const cat = v.keep.catapults[L.cat];
      const r = this.laneRect(L, cat, geo);
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) { fx = cat.x + 0.5; fy = cat.y + 0.5; }
    }
    let best = null;
    let bd = 0.9;
    for (const t of v.targets || []) {
      const d = Math.hypot(t.x + 0.5 - fx, t.y + 0.5 - fy);
      if (d < bd) { bd = d; best = t; }
    }
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);
    return { target: best, cell: [cx, cy] };
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      try { this.draw(); } catch (e) { console.error(e); this.running = false; return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  stop() { this.running = false; }

  // ------------------------------------------------------------------ drawing
  draw() {
    const v = this.get();
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    if (!v?.lay || !v.keep || !this.W) return;
    const now = performance.now();
    const lay = v.lay;
    const geo = this.geometry(lay);
    const { s, ox, oy } = geo;
    const X = (x) => ox + x * s;
    const Y = (y) => oy + y * s;
    const C = (x, y) => [ox + (x + 0.5) * s, oy + (y + 0.5) * s];
    const snap = v.snap;

    this.drawLanes(v, geo, now);
    this.drawCorner(v, geo);

    // ---- cells
    for (let y = 0; y < lay.h; y++) {
      for (let x = 0; x < lay.w; x++) this.drawCell(lay, x, y, X(x), Y(y), s, v);
    }
    // cast shadows of raised cells onto low ones (light from the top left)
    g.fillStyle = 'rgb(0 0 0 / 0.42)';
    for (let y = 0; y < lay.h; y++) {
      for (let x = 0; x < lay.w; x++) {
        const c = cellAt(lay, x, y);
        if (c.h !== 1 || c.kind === 'void') continue;
        const below = cellAt(lay, x, y + 1);
        if (y + 1 < lay.h && below.h === 0 && below.kind !== 'block') g.fillRect(X(x), Y(y + 1), s, s * 0.2);
        const right = cellAt(lay, x + 1, y);
        if (x + 1 < lay.w && right.h === 0 && right.kind !== 'block') g.fillRect(X(x + 1), Y(y), s * 0.2, s);
      }
    }
    // cliffs: edges between two walkable cells that cannot be crossed
    g.strokeStyle = '#05090a';
    g.lineWidth = Math.max(2.5, s * 0.1);
    g.lineCap = 'round';
    g.beginPath();
    for (let y = 0; y < lay.h; y++) {
      for (let x = 0; x < lay.w; x++) {
        if (!walkable(lay, x, y)) continue;
        const a = cellAt(lay, x, y);
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx; const ny = y + dy;
          if (!walkable(lay, nx, ny)) continue;
          const b = cellAt(lay, nx, ny);
          if (a.kind === 'stairs' || b.kind === 'stairs' || a.h === b.h) continue;
          if (dx) { g.moveTo(X(nx), Y(y) + 2); g.lineTo(X(nx), Y(y + 1) - 2); } else { g.moveTo(X(x) + 2, Y(ny)); g.lineTo(X(x + 1) - 2, Y(ny)); }
        }
      }
    }
    g.stroke();
    // thin grid
    g.strokeStyle = 'rgb(0 0 0 / 0.35)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 1; x < lay.w; x++) { g.moveTo(X(x) + 0.5, Y(1)); g.lineTo(X(x) + 0.5, Y(lay.h)); }
    for (let y = 1; y < lay.h; y++) { g.moveTo(X(1), Y(y) + 0.5); g.lineTo(X(lay.w), Y(y) + 0.5); }
    g.stroke();

    // ---- catapults (with their load)
    const cats = new Map((snap?.catapults || []).map((c) => [c.id, c.bomb]));
    for (const cat of v.keep.catapults) this.drawCatapult(cat, v.keep.lanes[cat.lane], cats.get(cat.id), X(cat.x), Y(cat.y), s);

    // ---- targets
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    for (const t of v.targets || []) {
      const [cx, cy] = C(t.x, t.y);
      g.save();
      if (t.kind === 'move') {
        g.fillStyle = `rgb(255 214 120 / ${0.16 + 0.1 * pulse})`;
        g.fillRect(X(t.x) + 2, Y(t.y) + 2, s - 4, s - 4);
        g.strokeStyle = 'rgb(255 214 120 / 0.85)';
        g.lineWidth = 1.5;
        g.strokeRect(X(t.x) + 2.5, Y(t.y) + 2.5, s - 5, s - 5);
        g.fillStyle = 'rgb(255 214 120 / 0.9)';
        g.beginPath(); g.arc(cx, cy, Math.max(2, s * 0.07), 0, TAU); g.fill();
      } else {
        const catcher = t.kind === 'throw' && t.catcher;
        const col = catcher ? '#9dffb0' : t.kind === 'throw' ? '#7fd4ff' : t.kind === 'pickup' ? '#8be0c8' : '#ffb648';
        if (catcher) {
          g.font = `800 ${Math.max(9, s * 0.26)}px ${FONT}`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.lineWidth = 3; g.strokeStyle = '#0b1112'; g.fillStyle = col;
          g.strokeText('catch', cx, cy + s * 0.62); g.fillText('catch', cx, cy + s * 0.62);
        }
        g.strokeStyle = col;
        g.shadowColor = col;
        g.shadowBlur = 6 + pulse * 8;
        g.lineWidth = Math.max(2.5, s * 0.08);
        g.beginPath(); g.arc(cx, cy, s * (0.46 + 0.04 * pulse), 0, TAU); g.stroke();
        if (t.kind === 'throw') {
          g.fillStyle = 'rgb(127 212 255 / 0.18)';
          g.fillRect(X(t.x) + 2, Y(t.y) + 2, s - 4, s - 4);
        }
      }
      g.restore();
    }

    // ---- bombs on the ground
    const engAt = new Map((snap?.engineers || []).map((e) => [e.x + ',' + e.y, e]));
    for (const b of snap?.bombs || []) {
      const [cx, cy] = C(b.x, b.y);
      const under = engAt.has(b.x + ',' + b.y);
      // a bomb under an engineer peeks out from the bottom-left corner
      drawBomb(g, b.kind, under ? cx - s * 0.28 : cx, under ? cy + s * 0.26 : cy, s * (under ? 0.2 : 0.3));
    }

    // ---- plans: other players' (open plans) as ghosts, then mine
    for (const gh of v.ghosts || []) this.drawPlan(gh.plan, gh.from, gh.color, true, v, geo, now);
    if (v.plan && v.planFrom) this.drawPlan(v.plan, v.planFrom, '#fff2c8', false, v, geo, now);

    // ---- engineers
    const mine = (snap?.engineers || []).find((e) => e.pid === v.you);
    for (const e of snap?.engineers || []) {
      if (e.pid !== v.you) this.drawEngineer(e, v, C(e.x, e.y), s, false, now);
    }
    if (mine) this.drawEngineer(mine, v, C(mine.x, mine.y), s, true, now);
  }

  drawCorner(v, geo) {
    const g = this.g;
    const { s, ox, oy, lsL, lsT } = geo;
    const snap = v.snap;
    if (!snap) return;
    const w = lsL * s;
    const hh = lsT * s;
    const x0 = ox - w;
    const y0 = oy - hh;
    const max = snap.wallMax || v.defs?.wallHP || 1;
    const f = Math.max(0, Math.min(1, snap.wall / max));
    g.save();
    g.fillStyle = '#101a1c';
    g.fillRect(x0 + 2, y0 + 2, w - 4, hh - 4);
    // a wall-coloured fill rising with hit points
    g.fillStyle = f > 0.5 ? '#4a5a52' : f > 0.25 ? '#7a5a2a' : '#7a2a1c';
    g.fillRect(x0 + 2, y0 + 2 + (hh - 4) * (1 - f), w - 4, (hh - 4) * f);
    g.strokeStyle = '#6e5120';
    g.lineWidth = 2;
    g.strokeRect(x0 + 2, y0 + 2, w - 4, hh - 4);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fs = Math.min(hh * 0.42, w * 0.34);
    g.fillStyle = '#f4ead2';
    g.font = `800 ${fs}px ${FONT}`;
    g.fillText(`${snap.wall}`, x0 + w / 2, y0 + hh * 0.42);
    g.font = `600 ${Math.max(8, fs * 0.42)}px ${FONT}`;
    g.fillStyle = '#d9c99a';
    g.fillText('WALL', x0 + w / 2, y0 + hh * 0.78);
    g.restore();
  }

  drawLanes(v, geo, now) {
    const g = this.g;
    const snap = v.snap;
    const byLane = new Map();
    for (const m of snap?.machines || []) {
      if (!byLane.has(m.lane)) byLane.set(m.lane, []);
      byLane.get(m.lane).push(m);
    }
    const order = v.defs?.machineOrder || [];
    for (const L of v.keep.lanes) {
      const cat = v.keep.catapults[L.cat];
      const r = this.laneRect(L, cat, geo);
      const ms = byLane.get(L.id) || [];
      const nearest = ms.reduce((a, m) => Math.min(a, m.pos), Infinity);
      // ground
      g.save();
      g.beginPath();
      g.roundRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 4);
      g.fillStyle = '#18231f';
      g.fill();
      // danger: the closer the nearest machine, the redder the strip near the wall
      if (nearest < Infinity) {
        const danger = 1 - nearest / Math.max(1, L.len - 1);
        const a = 0.15 + 0.55 * danger * danger;
        const gr = r.vertical ? g.createLinearGradient(0, r.y + r.h, 0, r.y) : g.createLinearGradient(r.x + r.w, 0, r.x, 0);
        gr.addColorStop(0, `rgb(226 85 63 / ${a})`);
        gr.addColorStop(1, 'rgb(226 85 63 / 0.04)');
        g.fillStyle = gr;
        g.fill();
        if (nearest <= 1) {
          g.strokeStyle = `rgb(255 120 90 / ${0.5 + 0.5 * Math.sin(now / 160)})`;
          g.lineWidth = 2;
          g.stroke();
        }
      }
      // position ticks
      g.strokeStyle = 'rgb(255 255 255 / 0.07)';
      g.lineWidth = 1;
      g.beginPath();
      for (let p = 1; p < L.len; p++) {
        const [px, py] = r.at(p - 0.5);
        if (r.vertical) { g.moveTo(r.x + 4, py); g.lineTo(r.x + r.w - 4, py); } else { g.moveTo(px, r.y + 4); g.lineTo(px, r.y + r.h - 4); }
      }
      g.stroke();
      // incoming shadows at the far end
      const inc = (snap?.incoming || []).filter((i) => i.lane === L.id);
      inc.forEach((i, k) => {
        const [px, py] = this.spread(r, L.len - 1, k, inc.length);
        g.setLineDash([3, 3]);
        g.strokeStyle = 'rgb(255 255 255 / 0.45)';
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(px, py, this.mr(r, geo, false), 0, TAU); g.stroke();
        g.setLineDash([]);
      });
      // machines, stacked side by side per position
      const at = new Map();
      for (const m of ms) { if (!at.has(m.pos)) at.set(m.pos, []); at.get(m.pos).push(m); }
      for (const [pos, list] of at) {
        list.forEach((m, k) => {
          const def = v.defs?.machines?.[m.kind];
          const [px, py] = this.spread(r, pos, k, list.length);
          const rad = this.mr(r, geo, def?.boss);
          const i = Math.max(0, order.indexOf(m.kind));
          g.fillStyle = MACHINE_COLORS[i % MACHINE_COLORS.length];
          g.strokeStyle = '#000';
          g.lineWidth = 1;
          g.beginPath();
          if (m.kind === order[1]) { // the fast one: a diamond
            g.moveTo(px, py - rad * 1.15); g.lineTo(px + rad * 1.15, py); g.lineTo(px, py + rad * 1.15); g.lineTo(px - rad * 1.15, py); g.closePath();
          } else if (i >= 2) { // the heavy ones: squares
            g.rect(px - rad, py - rad, rad * 2, rad * 2);
          } else g.arc(px, py, rad, 0, TAU);
          g.fill(); g.stroke();
          if (m.max > 1 && rad >= 5) {
            g.fillStyle = '#1a0d05';
            g.font = `800 ${rad * 1.3}px ${FONT}`;
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(String(m.hp), px, py + 0.5);
          }
          if (m.frozen > 0) { g.strokeStyle = '#7fd4ff'; g.lineWidth = 2; g.beginPath(); g.arc(px, py, rad + 2.5, 0, TAU); g.stroke(); }
        });
      }
      // how many machines are on this lane, at the far end
      if (ms.length) {
        const [px, py] = r.vertical ? [r.x + r.w - 7, r.y + 8] : [r.x + 8, r.y + 8];
        g.fillStyle = '#f4ead2';
        g.font = `800 ${Math.max(9, geo.s * 0.28)}px ${FONT}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(ms.length), px, py);
      }
      g.restore();
    }
  }
  // machine radius on a lane strip
  mr(r, geo, boss) {
    const base = Math.min(r.step * 0.5, geo.s * 0.32);
    return Math.max(4, base) * (boss ? 1.3 : 1);
  }
  // centre of the k-th of n machines sharing position p (spread across the strip's width)
  spread(r, p, k, n) {
    const [px, py] = r.at(p);
    if (n <= 1) return [px, py];
    const span = (r.vertical ? r.w : r.h) * 0.62;
    const off = (k / (n - 1) - 0.5) * span;
    const jig = (k % 2 ? 0.22 : -0.22) * r.step; // a little along the lane too, so stacks read as stacks
    return r.vertical ? [px + off, py + jig] : [px + jig, py + off];
  }

  drawCell(lay, x, y, px, py, s, v) {
    const g = this.g;
    const c = cellAt(lay, x, y);
    if (c.kind === 'void') return;
    if (c.kind === 'catapult') {
      g.fillStyle = '#2f3532';
      g.fillRect(px, py, s, s);
      return;
    }
    if (c.kind === 'block' && c.h === 1) { // outer wall: dark stone with battlements
      g.fillStyle = '#3a403c';
      g.fillRect(px, py, s, s);
      g.fillStyle = '#4c544e';
      const m = s / 4;
      if (y === 0 && x > 0) { g.fillRect(px + m * 0.3, py + 1, m * 1.4, m * 1.2); g.fillRect(px + m * 2.3, py + 1, m * 1.4, m * 1.2); }
      if (x === 0 && y > 0) { g.fillRect(px + 1, py + m * 0.3, m * 1.2, m * 1.4); g.fillRect(px + 1, py + m * 2.3, m * 1.2, m * 1.4); }
      g.strokeStyle = 'rgb(0 0 0 / 0.35)';
      g.lineWidth = 1;
      g.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
      return;
    }
    if (c.kind === 'block') { // crate on the courtyard
      g.fillStyle = '#1a2628';
      g.fillRect(px, py, s, s);
      const i = s * 0.1;
      g.fillStyle = '#7a5530';
      g.fillRect(px + i, py + i, s - 2 * i, s - 2 * i);
      g.strokeStyle = '#3d2814';
      g.lineWidth = Math.max(1.5, s * 0.06);
      g.strokeRect(px + i, py + i, s - 2 * i, s - 2 * i);
      g.beginPath();
      g.moveTo(px + i, py + i); g.lineTo(px + s - i, py + s - i);
      g.moveTo(px + s - i, py + i); g.lineTo(px + i, py + s - i);
      g.stroke();
      return;
    }
    if (c.kind === 'stairs') {
      // steps rising toward the high neighbour
      let dir = null;
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
        const n = cellAt(lay, x + dx, y + dy);
        if (n.h === 1 && n.kind === 'floor') { dir = [dx, dy]; break; }
      }
      dir = dir || [0, -1];
      const n = 5;
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        const l = Math.round(42 + t * 46);
        g.fillStyle = `rgb(${l + 8} ${l + 18} ${l + 14})`;
        // k = 0 is the low end (away from dir)
        const f0 = k / n; const f1 = (k + 1) / n;
        if (dir[1] === -1) g.fillRect(px, py + s * (1 - f1), s, s / n + 0.5);
        else if (dir[1] === 1) g.fillRect(px, py + s * f0, s, s / n + 0.5);
        else if (dir[0] === -1) g.fillRect(px + s * (1 - f1), py, s / n + 0.5, s);
        else g.fillRect(px + s * f0, py, s / n + 0.5, s);
      }
      g.strokeStyle = 'rgb(0 0 0 / 0.45)';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 1; k < n; k++) {
        if (dir[1]) { g.moveTo(px, py + (s * k) / n); g.lineTo(px + s, py + (s * k) / n); } else { g.moveTo(px + (s * k) / n, py); g.lineTo(px + (s * k) / n, py + s); }
      }
      g.stroke();
      // a chevron pointing up the stairs
      g.strokeStyle = 'rgb(255 240 200 / 0.75)';
      g.lineWidth = Math.max(1.5, s * 0.06);
      const cx = px + s / 2; const cy = py + s / 2; const a = s * 0.2;
      const [qx, qy] = [-dir[1], dir[0]]; // perpendicular
      g.beginPath();
      g.moveTo(cx - dir[0] * a * 0.5 + qx * a, cy - dir[1] * a * 0.5 + qy * a);
      g.lineTo(cx + dir[0] * a * 0.5, cy + dir[1] * a * 0.5);
      g.lineTo(cx - dir[0] * a * 0.5 - qx * a, cy - dir[1] * a * 0.5 - qy * a);
      g.stroke();
      return;
    }
    // floor
    if (c.h === 1) { // raised: light stone, bevelled
      g.fillStyle = '#6d7f75';
      g.fillRect(px, py, s, s);
      g.fillStyle = '#8a9c90';
      g.fillRect(px, py, s, s * 0.12);
      g.fillRect(px, py, s * 0.12, s);
      g.fillStyle = '#4f5e56';
      g.fillRect(px, py + s * 0.88, s, s * 0.12);
      g.fillRect(px + s * 0.88, py, s * 0.12, s);
    } else { // courtyard: dark flagstone
      g.fillStyle = (x + y) % 2 ? '#1f2f31' : '#223436';
      g.fillRect(px, py, s, s);
    }
  }

  drawCatapult(cat, lane, bomb, px, py, s) {
    const g = this.g;
    const cx = px + s / 2;
    const cy = py + s / 2;
    const [dx, dy] = lane.dir; // the arm points out down the lane
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.atan2(dy, dx) + Math.PI / 2); // local "up" = down the lane
    // frame
    g.fillStyle = '#6a4a2a';
    g.strokeStyle = '#2a1a0a';
    g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(-s * 0.4, -s * 0.2, s * 0.8, s * 0.55, 3); g.fill(); g.stroke();
    // wheels / gears
    g.fillStyle = '#c99a4a';
    for (const wx of [-0.3, 0.3]) { g.beginPath(); g.arc(wx * s, s * 0.3, s * 0.11, 0, TAU); g.fill(); g.stroke(); }
    // arm
    g.strokeStyle = '#d9b25a';
    g.lineWidth = Math.max(2, s * 0.09);
    g.beginPath(); g.moveTo(0, s * 0.2); g.lineTo(0, -s * 0.36); g.stroke();
    // cup
    g.fillStyle = bomb ? '#ffd27a' : '#2a1a0a';
    g.strokeStyle = '#d9b25a';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, -s * 0.36, s * 0.14, 0, TAU); g.fill(); g.stroke();
    g.restore();
    if (bomb) {
      g.save();
      g.shadowColor = '#ffb648';
      g.shadowBlur = 10;
      drawBomb(g, bomb.kind, cx + dx * s * 0.36, cy + dy * s * 0.36, s * 0.24);
      g.restore();
    }
  }

  drawEngineer(e, v, [cx, cy], s, mine, now) {
    const g = this.g;
    const p = v.players.get(e.pid);
    const col = p?.color || '#999';
    const r = s * (mine ? 0.4 : 0.34);
    g.save();
    if (mine) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 300);
      g.fillStyle = `rgb(255 240 200 / ${0.18 + 0.14 * pulse})`;
      g.beginPath(); g.arc(cx, cy, r + s * 0.1 + pulse * s * 0.04, 0, TAU); g.fill();
    }
    g.fillStyle = col;
    g.strokeStyle = mine ? '#fff' : '#0b1112';
    g.lineWidth = mine ? Math.max(2.5, s * 0.09) : 2;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = '#10181a';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const ini = v.initials?.get(e.pid) || '?';
    g.font = `800 ${r * (ini.length > 1 ? 0.95 : 1.15)}px ${FONT}`;
    g.fillText(ini, cx, cy + r * 0.06);
    if (p?.away) {
      g.fillStyle = 'rgb(10 14 16 / 0.55)';
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.fillStyle = '#cfd8d8';
      g.font = `italic 700 ${r * 0.8}px ${FONT}`;
      g.fillText('zz', cx + r * 0.7, cy - r * 0.8);
    }
    if (e.carry) drawBomb(g, e.carry.kind, cx + r * 0.75, cy - r * 0.7, s * 0.2, true);
    if (mine && v.committed) { // ✓ badge
      const bx = cx - r * 0.8; const by = cy - r * 0.8; const br = s * 0.15;
      g.fillStyle = '#4fb39a'; g.strokeStyle = '#06261d'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fill(); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.5, br * 0.35);
      g.beginPath(); g.moveTo(bx - br * 0.5, by); g.lineTo(bx - br * 0.1, by + br * 0.4); g.lineTo(bx + br * 0.55, by - br * 0.45); g.stroke();
    }
    g.restore();
  }

  // A plan: arrow / arc / marker from the engineer's cell. Ghosts are dashed and faint.
  drawPlan(plan, from, color, ghost, v, geo, now) {
    if (!plan || !from) return;
    const g = this.g;
    const { s, ox, oy } = geo;
    const C = (x, y) => [ox + (x + 0.5) * s, oy + (y + 0.5) * s];
    const [fx, fy] = C(from[0], from[1]);
    g.save();
    g.globalAlpha = ghost ? 0.7 : 1;
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = ghost ? Math.max(2, s * 0.07) : Math.max(3, s * 0.11);
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (ghost) g.setLineDash([s * 0.18, s * 0.14]);
    else { g.shadowColor = 'rgb(0 0 0 / 0.8)'; g.shadowBlur = 4; }
    const arrowHead = (x1, y1, x2, y2) => {
      const a = Math.atan2(y2 - y1, x2 - x1);
      const L = s * (ghost ? 0.24 : 0.3);
      g.setLineDash([]);
      g.beginPath();
      g.moveTo(x2, y2);
      g.lineTo(x2 - L * Math.cos(a - 0.5), y2 - L * Math.sin(a - 0.5));
      g.lineTo(x2 - L * Math.cos(a + 0.5), y2 - L * Math.sin(a + 0.5));
      g.closePath(); g.fill();
    };
    const ring = (x, y, rr) => { g.setLineDash([]); g.beginPath(); g.arc(x, y, rr, 0, TAU); g.stroke(); };
    switch (plan.a) {
      case 'move': {
        const pts = [[fx, fy], ...(plan.path?.length ? plan.path : [[plan.x, plan.y]]).map(([x, y]) => C(x, y))];
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        // stop short of the centre so the head sits on the destination
        g.stroke();
        const [ax, ay] = pts[pts.length - 2];
        const [bx, by] = pts[pts.length - 1];
        arrowHead(ax, ay, bx, by);
        ring(bx, by, s * 0.42);
        break;
      }
      case 'pickup': {
        const [bx, by] = C(plan.x, plan.y);
        if (plan.x !== from[0] || plan.y !== from[1]) {
          const k = 0.55;
          const tx = fx + (bx - fx) * k; const ty = fy + (by - fy) * k;
          g.beginPath(); g.moveTo(fx, fy); g.lineTo(tx, ty); g.stroke();
          arrowHead(fx, fy, tx + (bx - fx) * 0.1, ty + (by - fy) * 0.1);
        }
        ring(bx, by, s * 0.44);
        hand(g, bx, by - s * 0.42, s * 0.16, color);
        break;
      }
      case 'throw': {
        const [tx, ty] = C(plan.x, plan.y);
        const mx = (fx + tx) / 2; const my = (fy + ty) / 2;
        const len = Math.hypot(tx - fx, ty - fy) || 1;
        const nx = -(ty - fy) / len; const ny = (tx - fx) / len;
        const lift = Math.min(len * 0.35, s * 1.2);
        const qx = mx + nx * lift * (ny > 0 ? -1 : 1); const qy = my + ny * lift * (ny > 0 ? -1 : 1);
        g.beginPath(); g.moveTo(fx, fy); g.quadraticCurveTo(qx, qy, tx, ty); g.stroke();
        arrowHead(qx, qy, tx, ty);
        ring(tx, ty, s * 0.44);
        // a little bomb at the top of the arc
        if (!ghost) {
          const t = ((now / 900) % 1);
          const bx = (1 - t) * (1 - t) * fx + 2 * (1 - t) * t * qx + t * t * tx;
          const by = (1 - t) * (1 - t) * fy + 2 * (1 - t) * t * qy + t * t * ty;
          const carry = v.snap?.engineers?.find((e) => e.x === from[0] && e.y === from[1])?.carry;
          drawBomb(g, carry?.kind || 'keg', bx, by, s * 0.16);
        }
        break;
      }
      case 'load':
      case 'fire': {
        const cat = v.keep.catapults[plan.cat ?? 0];
        if (!cat) break;
        const [cx, cy] = C(cat.x, cat.y);
        const k = 0.6;
        g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx + (cx - fx) * k, fy + (cy - fy) * k); g.stroke();
        arrowHead(fx, fy, fx + (cx - fx) * k, fy + (cy - fy) * k);
        ring(cx, cy, s * 0.48);
        if (plan.a === 'fire' || plan.fire) {
          const lane = v.keep.lanes[cat.lane];
          const r = this.laneRect(lane, cat, geo);
          g.setLineDash([]);
          g.globalAlpha *= 0.85;
          burst(g, cx + lane.dir[0] * s * 0.55, cy + lane.dir[1] * s * 0.55, s * 0.32, color);
          g.globalAlpha = ghost ? 0.25 : 0.35;
          g.fillStyle = color;
          g.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
        }
        break;
      }
      case 'wait': {
        g.setLineDash([]);
        g.font = `italic 800 ${s * 0.34}px ${FONT}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 3; g.strokeStyle = '#0b1112';
        g.strokeText('wait', fx, fy + s * 0.56);
        g.fillText('wait', fx, fy + s * 0.56);
        break;
      }
    }
    g.restore();
  }
}

// Bombs, drawn in code: powder keg (barrel), grapeshot (cluster), stopwatch (clock).
export function drawBomb(g, kind, x, y, r, outline) {
  g.save();
  g.setLineDash([]);
  g.lineWidth = Math.max(1, r * 0.14);
  g.strokeStyle = '#120a04';
  if (outline) { g.fillStyle = 'rgb(0 0 0 / 0.55)'; g.beginPath(); g.arc(x, y, r * 1.25, 0, TAU); g.fill(); }
  if (kind === 'grapeshot') {
    g.fillStyle = '#a7b2b6';
    for (const [dx, dy] of [[-0.42, 0.3], [0.42, 0.3], [0, -0.38]]) {
      g.beginPath(); g.arc(x + dx * r, y + dy * r, r * 0.52, 0, TAU); g.fill(); g.stroke();
    }
    g.fillStyle = '#e8eef0';
    g.beginPath(); g.arc(x - r * 0.12, y - r * 0.5, r * 0.14, 0, TAU); g.fill();
  } else if (kind === 'stopwatch') {
    g.fillStyle = '#d6f2ff';
    g.beginPath(); g.arc(x, y + r * 0.08, r * 0.85, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = '#4aa6d6';
    g.fillRect(x - r * 0.2, y - r * 1.02, r * 0.4, r * 0.25);
    g.strokeStyle = '#123';
    g.lineWidth = Math.max(1, r * 0.16);
    g.beginPath(); g.moveTo(x, y + r * 0.08); g.lineTo(x, y - r * 0.5); g.moveTo(x, y + r * 0.08); g.lineTo(x + r * 0.4, y + r * 0.25); g.stroke();
  } else { // keg (and anything unknown)
    g.fillStyle = BOMB_COLORS.keg;
    g.beginPath(); g.ellipse(x, y, r * 0.78, r * 0.95, 0, 0, TAU); g.fill(); g.stroke();
    g.strokeStyle = '#3a2410';
    g.lineWidth = Math.max(1, r * 0.18);
    g.beginPath();
    g.moveTo(x - r * 0.72, y - r * 0.4); g.lineTo(x + r * 0.72, y - r * 0.4);
    g.moveTo(x - r * 0.72, y + r * 0.4); g.lineTo(x + r * 0.72, y + r * 0.4);
    g.stroke();
    g.strokeStyle = '#ffd27a';
    g.lineWidth = Math.max(1, r * 0.14);
    g.beginPath(); g.moveTo(x, y - r * 0.95); g.quadraticCurveTo(x + r * 0.4, y - r * 1.3, x + r * 0.2, y - r * 1.5); g.stroke();
  }
  g.restore();
}

function burst(g, x, y, r, color) {
  g.save();
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
  g.restore();
}

function hand(g, x, y, r, color) {
  g.save();
  g.setLineDash([]);
  g.fillStyle = color;
  g.strokeStyle = '#0b1112';
  g.lineWidth = 1;
  g.beginPath(); g.roundRect(x - r * 0.8, y - r * 0.3, r * 1.6, r * 1.1, r * 0.3); g.fill(); g.stroke();
  for (let i = 0; i < 4; i++) { g.beginPath(); g.roundRect(x - r * 0.8 + i * r * 0.42, y - r * 0.9, r * 0.34, r * 0.7, r * 0.15); g.fill(); g.stroke(); }
  g.restore();
}
