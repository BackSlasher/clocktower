// Transient effects: projectiles, chain bolts, particles, rings, floating
// text, screen shake. All pools are capped so busy waves stay cheap.

import { TAU, softSprite, gearPath, clamp } from './geom.js';

const MAX_PARTS = 900;
const MAX_PROJ = 300;
const MAX_TEXT = 60;
const MAX_RINGS = 80;
const MAX_BOLTS = 40;

const swapRemove = (arr, i) => {
  arr[i] = arr[arr.length - 1];
  arr.pop();
};

export class FX {
  constructor() {
    this.parts = [];
    this.projs = [];
    this.bolts = [];
    this.rings = [];
    this.texts = [];
    this.scorch = [];
    this.shake = 0;
    this.leakFlash = 0;
    this.redVignette = 0;
  }

  clear() {
    this.parts.length = this.projs.length = this.bolts.length = 0;
    this.rings.length = this.texts.length = this.scorch.length = 0;
    this.shake = this.leakFlash = this.redVignette = 0;
  }

  // type: spark (additive streak) | glow (additive soft) | smoke | cog | dust
  part(type, x, y, vx, vy, life, size, color, extra = 0) {
    if (this.parts.length >= MAX_PARTS) {
      if (type === 'smoke' || type === 'dust') return;
      swapRemove(this.parts, (Math.random() * this.parts.length) | 0);
    }
    this.parts.push({ type, x, y, vx, vy, life, max: life, size, color, rot: Math.random() * TAU, spin: extra });
  }

  burst(x, y, n, { speed = 200, life = 0.5, size = 3, color = '#ffd27a', type = 'spark', up = 0 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.part(type, x, y, Math.cos(a) * s, Math.sin(a) * s - up, life * (0.6 + Math.random() * 0.6), size, color, (Math.random() - 0.5) * 12);
    }
  }

  smoke(x, y, n, { size = 26, life = 1.2, speed = 30, color = 'rgba(200,200,190,0.5)' } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * Math.random();
      this.part('smoke', x + Math.cos(a) * 6, y + Math.sin(a) * 6, Math.cos(a) * s, Math.sin(a) * s - 12, life * (0.7 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6), color);
    }
  }

  ring(x, y, r0, r1, life, color, width = 4) {
    if (this.rings.length >= MAX_RINGS) swapRemove(this.rings, 0);
    this.rings.push({ x, y, r0, r1, life, max: life, color, width });
  }

  text(x, y, str, color, size = 34, life = 1.3, cog = false) {
    if (this.texts.length >= MAX_TEXT) swapRemove(this.texts, 0);
    this.texts.push({ x, y, str, color, size, life, max: life, cog });
  }

  // kind 'rivet' streak or 'mortar' arc shell; dur in real seconds
  proj(kind, x0, y0, x1, y1, dur, onHit) {
    if (this.projs.length >= MAX_PROJ) {
      const p = this.projs[0];
      p.onHit?.();
      swapRemove(this.projs, 0);
    }
    const d = Math.hypot(x1 - x0, y1 - y0);
    this.projs.push({ kind, x0, y0, x1, y1, t: 0, dur: Math.max(0.04, dur), h: kind === 'mortar' ? 90 + d * 0.35 : 0, onHit });
  }

  bolt(pts, life = 0.28) {
    if (this.bolts.length >= MAX_BOLTS) swapRemove(this.bolts, 0);
    this.bolts.push({ pts, life, max: life, seed: Math.random() * 1000 });
  }

  addScorch(x, y, r) {
    if (this.scorch.length > 40) this.scorch.shift();
    this.scorch.push({ x, y, r, life: 6, max: 6 });
  }

  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 30);
    this.leakFlash = Math.max(0, this.leakFlash - dt * 1.8);
    this.redVignette = Math.max(0, this.redVignette - dt * 0.9);
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) {
        swapRemove(P, i);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'smoke') {
        p.vx *= 1 - dt * 1.5;
        p.vy = p.vy * (1 - dt * 1.5) - 14 * dt;
      } else if (p.type === 'cog') {
        p.vy += 520 * dt;
        p.vx *= 1 - dt;
        p.rot += p.spin * dt;
      } else if (p.type === 'dust') {
        p.vx *= 1 - dt * 3;
        p.vy *= 1 - dt * 3;
      } else {
        p.vx *= 1 - dt * 2.5;
        p.vy *= 1 - dt * 2.5;
      }
    }
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      p.t += dt;
      if (p.kind === 'mortar' && Math.random() < 0.6) {
        const k = p.t / p.dur;
        const x = p.x0 + (p.x1 - p.x0) * k;
        const y = p.y0 + (p.y1 - p.y0) * k - p.h * 4 * k * (1 - k);
        this.part('smoke', x, y, 0, 0, 0.5, 10, 'rgba(220,220,210,0.35)');
      }
      if (p.t >= p.dur) {
        swapRemove(this.projs, i);
        p.onHit?.();
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      if ((this.bolts[i].life -= dt) <= 0) swapRemove(this.bolts, i);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      if ((this.rings[i].life -= dt) <= 0) swapRemove(this.rings, i);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y -= 46 * dt;
      if (t.life <= 0) swapRemove(this.texts, i);
    }
    for (let i = this.scorch.length - 1; i >= 0; i--) {
      if ((this.scorch[i].life -= dt) <= 0) this.scorch.splice(i, 1);
    }
  }

  drawGround(g) {
    for (const s of this.scorch) {
      g.globalAlpha = clamp(s.life / s.max, 0, 1) * 0.55;
      g.drawImage(softSprite('rgba(10,8,6,1)', 64, 0.4), s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    }
    g.globalAlpha = 1;
    // mortar shell shadows
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (const p of this.projs) {
      if (p.kind !== 'mortar') continue;
      const k = p.t / p.dur;
      g.beginPath();
      g.ellipse(p.x0 + (p.x1 - p.x0) * k, p.y0 + (p.y1 - p.y0) * k, 8, 5, 0, 0, TAU);
      g.fill();
    }
  }

  drawAir(g, now) {
    // projectiles
    for (const p of this.projs) {
      const k = p.t / p.dur;
      const x = p.x0 + (p.x1 - p.x0) * k;
      const y = p.y0 + (p.y1 - p.y0) * k;
      if (p.kind === 'mortar') {
        const h = p.h * 4 * k * (1 - k);
        const sc = 1 + h / 200;
        g.fillStyle = '#141210';
        g.beginPath();
        g.arc(x, y - h, 7 * sc, 0, TAU);
        g.fill();
        g.strokeStyle = '#d9b25a';
        g.lineWidth = 2;
        g.stroke();
        g.globalCompositeOperation = 'lighter';
        g.drawImage(softSprite('rgba(255,150,60,1)', 32, 0.2), x - 10, y - h - 10, 20, 20);
        g.globalCompositeOperation = 'source-over';
      } else {
        const dx = p.x1 - p.x0;
        const dy = p.y1 - p.y0;
        const L = Math.hypot(dx, dy) || 1;
        g.globalCompositeOperation = 'lighter';
        g.strokeStyle = 'rgba(255,214,130,0.95)';
        g.lineWidth = 3.5;
        g.beginPath();
        g.moveTo(x - (dx / L) * 18, y - (dy / L) * 18);
        g.lineTo(x, y);
        g.stroke();
        g.globalCompositeOperation = 'source-over';
      }
    }

    // chain lightning
    if (this.bolts.length) {
      g.globalCompositeOperation = 'lighter';
      g.lineJoin = 'round';
      for (const b of this.bolts) {
        const a = b.life / b.max;
        const path = jag(b.pts, now, b.seed);
        g.strokeStyle = `rgba(90,170,255,${0.35 * a})`;
        g.lineWidth = 12;
        strokePts(g, path);
        g.strokeStyle = `rgba(170,225,255,${0.8 * a})`;
        g.lineWidth = 4;
        strokePts(g, path);
        g.strokeStyle = `rgba(255,255,255,${a})`;
        g.lineWidth = 1.6;
        strokePts(g, path);
        for (let i = 1; i < b.pts.length; i++) {
          const [px, py] = b.pts[i];
          g.globalAlpha = a;
          g.drawImage(softSprite('rgba(150,210,255,1)', 64, 0.2), px - 26, py - 26, 52, 52);
        }
        g.globalAlpha = 1;
      }
      g.globalCompositeOperation = 'source-over';
    }

    // rings
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      const e = 1 - (1 - k) * (1 - k);
      g.globalAlpha = Math.max(0, 1 - k);
      g.lineWidth = r.width * (1 - k * 0.5);
      g.strokeStyle = r.color;
      g.beginPath();
      g.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;

    // particles: normal-blend ones first, then additive
    for (const p of this.parts) {
      const a = p.life / p.max;
      if (p.type === 'smoke' || p.type === 'dust') {
        const s = p.size * (1.6 - a * 0.6);
        g.globalAlpha = a * 0.9;
        g.drawImage(softSprite(p.color, 64, 0.25), p.x - s, p.y - s, s * 2, s * 2);
      } else if (p.type === 'cog') {
        g.globalAlpha = Math.min(1, a * 2);
        g.fillStyle = p.color;
        gearPath(g, p.x, p.y, p.size, 6, p.rot, 0.3);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (const p of this.parts) {
      const a = p.life / p.max;
      if (p.type === 'spark') {
        g.strokeStyle = p.color;
        g.globalAlpha = a;
        g.lineWidth = p.size;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        g.stroke();
      } else if (p.type === 'glow') {
        g.globalAlpha = a;
        const s = p.size * (1.4 - a * 0.4);
        g.drawImage(softSprite(p.color, 64, 0.15), p.x - s, p.y - s, s * 2, s * 2);
      }
    }
    g.lineCap = 'butt';
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  drawTexts(g) {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.life / t.max;
      g.globalAlpha = Math.min(1, k * 2.5);
      const pop = 1 + Math.max(0, (k - 0.85) * 3);
      g.font = `bold ${Math.round(t.size * pop)}px Georgia, serif`;
      const w = g.measureText(t.str).width;
      let x = t.x;
      if (t.cog) {
        x += 14;
        g.fillStyle = '#2a1c05';
        gearPath(g, x - w / 2 - 18, t.y + 2, 15, 8, t.life * 3);
        g.fill();
        g.fillStyle = '#e9c36a';
        gearPath(g, x - w / 2 - 20, t.y, 14, 8, t.life * 3);
        g.fill();
        g.fillStyle = '#6e5120';
        g.beginPath();
        g.arc(x - w / 2 - 20, t.y, 5, 0, TAU);
        g.fill();
      }
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(10,8,6,0.9)';
      g.strokeText(t.str, x, t.y);
      g.fillStyle = t.color;
      g.fillText(t.str, x, t.y);
    }
    g.globalAlpha = 1;
  }
}

function strokePts(g, pts) {
  g.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    if (i === 0) g.moveTo(pts[0], pts[1]);
    else g.lineTo(pts[i], pts[i + 1]);
  }
  g.stroke();
}

// Jagged lightning between successive points; re-randomised ~30x/s.
function jag(pts, now, seed) {
  const out = [];
  let s = Math.floor(now * 30) * 7919 + seed;
  const rnd = () => {
    s = (s * 16807 + 11) % 2147483647;
    return (s / 2147483647) * 2 - 1;
  };
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / L;
    const ny = (bx - ax) / L;
    const steps = Math.max(2, Math.round(L / 18));
    if (i === 1) out.push(ax, ay);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const off = k === steps ? 0 : rnd() * Math.min(14, L * 0.12);
      out.push(ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off);
    }
  }
  return out;
}
