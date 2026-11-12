// Small geometry and helper utilities shared by the TV modules.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Shortest-arc angle interpolation.
export function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

// Deterministic PRNG so the procedural town looks the same on every reload.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Precompute cumulative lengths so positions along a path are cheap.
export function preparePath(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return { pts, cum, len: cum[cum.length - 1] };
}

// Writes {x, y, a} (a = heading in radians) for `d` pixels along a prepared path.
export function pointAt(path, d, out = {}) {
  const { pts, cum } = path;
  let i = 1;
  if (d <= 0) i = 1;
  else {
    while (i < pts.length - 1 && cum[i] < d) i++;
  }
  const p0 = pts[i - 1];
  const p1 = pts[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = clamp((d - cum[i - 1]) / seg, 0, 1);
  out.x = p0[0] + (p1[0] - p0[0]) * t;
  out.y = p0[1] + (p1[1] - p0[1]) * t;
  out.a = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  return out;
}

// Distance from point to segment.
export function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export function distToPaths(paths, x, y) {
  let best = Infinity;
  for (const p of paths) {
    const pts = p.pts;
    for (let i = 1; i < pts.length; i++) {
      const d = distSeg(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      if (d < best) best = d;
    }
  }
  return best;
}

// Cached soft radial sprites (glows, smoke). Much cheaper than shadowBlur or
// per-frame gradients.
const softCache = new Map();
export function softSprite(color, size = 64, hard = 0) {
  const key = `${color}|${size}|${hard}`;
  let c = softCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, color);
  grd.addColorStop(hard, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  softCache.set(key, c);
  return c;
}

// "#rrggbb" + alpha -> rgba()
export function rgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// A brass gear outline as a path (used by the lobby, HUD icons and particles).
export function gearPath(ctx, x, y, r, teeth, rot = 0, toothDepth = 0.18) {
  const inner = r * (1 - toothDepth);
  const step = TAU / teeth;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = rot + i * step;
    ctx.lineTo(x + Math.cos(a - step * 0.3) * inner, y + Math.sin(a - step * 0.3) * inner);
    ctx.lineTo(x + Math.cos(a - step * 0.18) * r, y + Math.sin(a - step * 0.18) * r);
    ctx.lineTo(x + Math.cos(a + step * 0.18) * r, y + Math.sin(a + step * 0.18) * r);
    ctx.lineTo(x + Math.cos(a + step * 0.3) * inner, y + Math.sin(a + step * 0.3) * inner);
  }
  ctx.closePath();
}

export function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
