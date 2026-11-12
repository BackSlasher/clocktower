// Minimap of the town, drawn on a canvas from welcome.map. Never rotated: the
// phone shows the same landscape orientation as the TV.
//
// Two views: "fit" (whole map across the width, a landscape strip at the top
// of the canvas) and "zoom" (about 2.2x, drag to pan). Tapping picks the
// nearest plot within a generous radius.

const KIND_COLORS = ['#e8a23a', '#d1794a', '#7fd4ff', '#b79cff', '#7be0a0', '#ff8fb0'];
const ENEMY_COLORS = ['#c9c2a8', '#e2c34a', '#c9754a', '#7fd4ff', '#7be0a0', '#e2553f'];
const TAU = Math.PI * 2;

export function kindColor(defs, kind) {
  const i = Math.max(0, defs.towerOrder.indexOf(kind));
  return KIND_COLORS[i % KIND_COLORS.length];
}

export class Minimap {
  // st: shared state object (read live): {map, defs, snap, snapAt, players, sel}
  constructor(canvas, st, onPick) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.st = st;
    this.onPick = onPick;
    this.zoom = false;
    this.pan = { x: 0, y: 0 };
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.lens = null;
    this.running = false;
    this._bind();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  setMap() {
    const { map } = this.st;
    this.lens = map.paths.map((p) => {
      const cum = [0];
      for (let i = 1; i < p.pts.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]));
      }
      return cum;
    });
    this.resize();
  }

  setZoom(z) {
    this.zoom = z;
    this.pan = { x: 0, y: 0 };
    if (z && this.st.sel != null) this.centerOn(this.st.sel);
    this.resize();
  }

  centerOn(plotId) {
    const p = this.st.map?.plots.find((q) => q.id === plotId);
    if (!p) return;
    const s = this.scale();
    this.pan = { x: this.W / 2 - p.x * s, y: this.H / 2 - p.y * s };
    this._clamp();
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.W = r.width;
    this.H = r.height;
    this.c.width = Math.max(1, Math.round(r.width * this.dpr));
    this.c.height = Math.max(1, Math.round(r.height * this.dpr));
    this._clamp();
    this.onLayout?.(this.mapBottom());
  }

  fitScale() {
    return this.st.map ? Math.min(this.W / this.st.map.w, this.H / this.st.map.h) : 1;
  }
  // Fit view: map top-aligned, centred horizontally if the height binds.
  _off() {
    if (this.zoom) return this.pan;
    return { x: this.st.map ? Math.max(0, (this.W - this.st.map.w * this.fitScale()) / 2) : 0, y: 0 };
  }
  scale() {
    return this.zoom ? Math.max(this.W / this.st.map.w, this.H / this.st.map.h) * 2.2 : this.fitScale();
  }
  // Screen y of the bottom edge of the map in fit view.
  mapBottom() {
    return this.zoom || !this.st.map ? this.H : this.st.map.h * this.fitScale();
  }
  _origin() {
    const { map } = this.st;
    if (!this.zoom) return { x: 0, y: 0 };
    const s = this.scale();
    return { x: this.pan.x, y: this.pan.y, w: map.w * s, h: map.h * s };
  }
  _clamp() {
    if (!this.zoom || !this.st.map) return;
    const s = this.scale();
    const mw = this.st.map.w * s;
    const mh = this.st.map.h * s;
    this.pan.x = mw <= this.W ? (this.W - mw) / 2 : Math.min(0, Math.max(this.W - mw, this.pan.x));
    this.pan.y = mh <= this.H ? (this.H - mh) / 2 : Math.min(0, Math.max(this.H - mh, this.pan.y));
  }
  toScreen(x, y) {
    const s = this.scale();
    const o = this._off();
    return [x * s + o.x, y * s + o.y];
  }

  _bind() {
    const c = this.c;
    let down = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      down = { x: e.clientX, y: e.clientY, t: performance.now(), px: this.pan.x, py: this.pan.y, moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (Math.hypot(dx, dy) > 8) down.moved = true;
      if (this.zoom && down.moved) {
        this.pan.x = down.px + dx;
        this.pan.y = down.py + dy;
        this._clamp();
      }
    });
    const end = (e) => {
      if (!down) return;
      const d = down;
      down = null;
      if (e.type === 'pointercancel' || d.moved) return;
      const r = c.getBoundingClientRect();
      this.onPick(this.pick(e.clientX - r.left, e.clientY - r.top));
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  // Nearest plot within a forgiving radius (screen px); null = tapped empty ground.
  pick(sx, sy) {
    const { map } = this.st;
    if (!map) return null;
    const radius = this.zoom ? 56 : 46;
    let best = null;
    let bd = radius;
    for (const p of map.plots) {
      const [x, y] = this.toScreen(p.x, p.y);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) {
        bd = d;
        best = p.id;
      }
    }
    return best;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  stop() {
    this.running = false;
  }

  enemyPos(e, dtSec) {
    const [, kind, pi, dist] = e;
    const path = this.st.map.paths[pi];
    if (!path) return null;
    const def = this.st.defs.enemies[this.st.defs.enemyOrder[kind]];
    let d = dist + (def ? def.speed * dtSec * (e[5] & 1 ? 0.6 : 1) : 0);
    const cum = this.lens[pi];
    const total = cum[cum.length - 1];
    d = Math.max(0, Math.min(total, d));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const f = (d - cum[i - 1]) / seg;
    const a = path.pts[i - 1];
    const b = path.pts[i];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  draw() {
    const { st, ctx } = this;
    const { map, defs } = st;
    if (!map || !this.W) return;
    const now = performance.now();
    const s = this.scale();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const o = this._off();
    ctx.save();
    ctx.translate(o.x, o.y);

    // ground
    const g = ctx.createRadialGradient(map.w * s * 0.5, map.h * s * 0.5, 10, map.w * s * 0.5, map.h * s * 0.5, map.w * s * 0.65);
    g.addColorStop(0, '#22383c');
    g.addColorStop(1, '#10191b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, map.w * s, map.h * s);
    ctx.strokeStyle = 'rgb(255 255 255 / 0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= map.w; x += 120) { ctx.moveTo(x * s, 0); ctx.lineTo(x * s, map.h * s); }
    for (let y = 0; y <= map.h; y += 120) { ctx.moveTo(0, y * s); ctx.lineTo(map.w * s, y * s); }
    ctx.stroke();

    // streets
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const p of map.paths) {
      const trace = () => {
        ctx.beginPath();
        p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
      };
      trace();
      ctx.strokeStyle = '#3a3a30';
      ctx.lineWidth = Math.max(8, 54 * s);
      ctx.stroke();
      trace();
      ctx.strokeStyle = '#8a7340';
      ctx.lineWidth = Math.max(1.5, 4 * s);
      ctx.setLineDash([Math.max(5, 22 * s), Math.max(5, 20 * s)]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // clock tower
    const [tx, ty] = [map.tower.x * s, map.tower.y * s];
    const tr = Math.max(14, 40 * s);
    const glow = ctx.createRadialGradient(tx, ty, 2, tx, ty, tr * 2.4);
    glow.addColorStop(0, 'rgb(255 182 72 / 0.45)');
    glow.addColorStop(1, 'rgb(255 182 72 / 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(tx, ty, tr * 2.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1d2e33';
    ctx.strokeStyle = '#d9b25a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(tx, ty, tr, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      ctx.moveTo(tx + Math.cos(a) * tr * 0.78, ty + Math.sin(a) * tr * 0.78);
      ctx.lineTo(tx + Math.cos(a) * tr * 0.94, ty + Math.sin(a) * tr * 0.94);
    }
    ctx.stroke();
    const ta = now / 4000;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(ta) * tr * 0.7, ty + Math.sin(ta) * tr * 0.7);
    ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(ta / 12 - 1) * tr * 0.45, ty + Math.sin(ta / 12 - 1) * tr * 0.45);
    ctx.stroke();

    // plots
    const towers = new Map((st.snap?.towers || []).map((t) => [t.plot, t]));
    const pr = Math.max(11, 26 * s) * (this.zoom ? 1.0 : 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of map.plots) {
      const x = p.x * s;
      const y = p.y * s;
      const t = towers.get(p.id);
      const sel = st.sel === p.id;
      if (!t) {
        ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU);
        ctx.fillStyle = 'rgb(217 178 90 / 0.12)'; ctx.fill();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgb(217 178 90 / 0.8)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgb(217 178 90 / 0.8)';
        ctx.font = `700 ${pr}px ${'Georgia, serif'}`;
        ctx.fillText('+', x, y + 1);
      } else {
        const col = st.players.get(t.owner)?.color || '#999';
        const kc = kindColor(defs, t.kind);
        // tension ring
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgb(255 255 255 / 0.12)';
        ctx.beginPath(); ctx.arc(x, y, pr + 5, 0, TAU); ctx.stroke();
        if (t.tension > 0.01) {
          ctx.strokeStyle = t.tension > 0.66 ? '#ffd27a' : '#ffb648';
          ctx.shadowColor = '#ffb648';
          ctx.shadowBlur = t.tension > 0.5 ? 8 : 0;
          ctx.beginPath();
          ctx.arc(x, y, pr + 5, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, t.tension));
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU);
        ctx.fillStyle = '#101a1c'; ctx.fill();
        ctx.lineWidth = 3.5; ctx.strokeStyle = col; ctx.stroke();
        ctx.fillStyle = kc;
        ctx.font = `800 ${pr * 1.15}px ${'Georgia, serif'}`;
        const nm = defs.towers[t.kind]?.name || t.kind;
        ctx.fillText(nm[0].toUpperCase(), x, y + 1);
        // level pips
        ctx.fillStyle = '#f0d48a';
        for (let i = 0; i < t.lvl; i++) {
          ctx.beginPath(); ctx.arc(x + (i - (t.lvl - 1) / 2) * 6, y + pr + 11, 2.2, 0, TAU); ctx.fill();
        }
      }
      if (sel) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 180);
        ctx.strokeStyle = '#ffb648';
        ctx.shadowColor = '#ffb648';
        ctx.shadowBlur = 10 + pulse * 8;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, pr + 11 + pulse * 2, 0, TAU); ctx.stroke();
        ctx.shadowBlur = 0;
        // range hint
        const lv = t ? defs.towers[t.kind]?.levels[t.lvl - 1] : null;
        if (lv?.range) {
          ctx.setLineDash([6, 6]);
          ctx.strokeStyle = 'rgb(255 182 72 / 0.55)';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(x, y, lv.range * (t.rangeMul || 1) * s, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // enemies
    const dt = Math.min(0.15, (now - (st.snapAt || now)) / 1000);
    for (const e of st.snap?.enemies || []) {
      const pos = this.enemyPos(e, dt);
      if (!pos) continue;
      const kind = defs.enemyOrder[e[1]];
      const def = defs.enemies[kind];
      const r = Math.max(3.2, (def?.radius || 12) * s * 1.1) * (def?.boss ? 1.5 : 1);
      const x = pos[0] * s;
      const y = pos[1] * s;
      ctx.fillStyle = ENEMY_COLORS[e[1] % ENEMY_COLORS.length];
      ctx.beginPath();
      if (def?.flying) {
        ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.2, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r * 1.2, y); ctx.closePath();
      } else ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgb(0 0 0 / 0.6)';
      ctx.stroke();
      if (e[4] < 0.98) {
        ctx.fillStyle = '#000a';
        ctx.fillRect(x - r, y - r - 4, r * 2, 2.5);
        ctx.fillStyle = e[4] > 0.4 ? '#7be0a0' : '#e2553f';
        ctx.fillRect(x - r, y - r - 4, r * 2 * e[4], 2.5);
      }
      if (e[5] & 1) { ctx.strokeStyle = '#7fd4ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, TAU); ctx.stroke(); }
    }
    ctx.restore();
  }
}
