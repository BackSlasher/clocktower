// The keep on the TV: board state from snaps, resolve playback, effects and the per-frame
// canvas drawing (depth-sorted iso scene). Numbers about the game come from setup.defs/map
// and the room/snap messages only.

import { TAU, clamp, softSprite } from '../../tower_defense/tv/geom.js';
import { FX } from '../../tower_defense/tv/fx.js';
import { Scene, W, H, OUT_Z } from './scene.js';
import { boardFromSnap, viewOf, Playback } from './board.js';
import { drawBomb, drawEngineer, drawCatapult, drawMachine, drawMachineShadow, drawStars, drawIcon, MACHINE_CELLS } from './sprites.js';

const ENG_K = 1.15; // engineers are drawn a little larger than the tile scale

export class Game {
  constructor(canvas, ui) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.ui = ui;
    this.px = 1;
    this.fx = new FX();
    this.setup = null;
    this.room = null;
    this.scene = null;
    this.sceneKey = '';
    this.players = new Map(); // pid -> room player
    this.sound = null;
    this.reset();
  }

  reset() {
    this.board = null;
    this.snap = null;
    this.snapRecv = 0;
    this.rate = 1; // game seconds per real second (EMA)
    this.pb = null; // running Playback
    this.pbStart = 0;
    this.staticView = null;
    this.introAt = -1e9;
    this.placed = new Map(); // pid -> ms when placed (pop-in)
    this.bumps = new Map(); // pid -> ms of last bump
    this.face = new Map(); // pid -> last facing (+1/-1)
    this.wallFlash = 0;
    this.fx.clear();
  }

  setSetup(s) {
    this.setup = s;
    this.defs = s.defs;
    this.rebuild();
  }

  keep() {
    const keeps = this.setup?.map?.keeps || [];
    return keeps.find((k) => k.id === this.room?.keep) || keeps[0] || null;
  }

  setRoom(room) {
    const prev = this.room;
    this.room = room;
    this.players = new Map(room.players.map((p) => [p.id, p]));
    if (room.phase === 'lobby' && prev && prev.phase !== 'lobby') this.reset();
    this.rebuild();
  }

  resize(px) {
    if (px === this.px && this.cv.width === Math.round(W * px)) return;
    this.px = px;
    this.cv.width = Math.round(W * px);
    this.cv.height = Math.round(H * px);
    clearTimeout(this._rb);
    this._rb = setTimeout(() => this.rebuild(true), 150);
  }

  rebuild(force = false) {
    const keep = this.keep();
    const lay = this.room?.layout;
    if (!keep || !lay || lay.w !== keep.w || lay.h !== keep.h) return;
    const key = `${keep.id}|${JSON.stringify(lay.cells)}`;
    if (!force && key === this.sceneKey && this.scene) return;
    this.sceneKey = key;
    this.scene = new Scene(keep, lay, this.px);
    this.staticView = null;
  }

  destroy() {
    clearTimeout(this._rb);
  }

  color(pid) {
    return this.players.get(pid)?.color || '#d9b25a';
  }

  // seconds left in the current phase, counted down locally between snaps
  left(now) {
    if (!this.snap) return 0;
    return Math.max(0, (this.snap.left || 0) - ((now - this.snapRecv) / 1000) * this.rate);
  }

  // ------------------------------------------------------------ snapshots

  onSnap(m, now) {
    const last = this.snap;
    if (last && now - this.snapRecv < 1500 && m.time > last.time) {
      const dt = (now - this.snapRecv) / 1000;
      if (dt > 0.03 && dt < 0.6) this.rate = clamp(this.rate * 0.85 + ((m.time - last.time) / dt) * 0.15, 0.5, 60);
    }
    const evs = m.ev || [];
    const before = this.board;
    const after = boardFromSnap(m);
    const levelStart = evs.some((e) => e.e === 'level_start');
    const ri = evs.findIndex((e) => e.e === 'resolve');
    const inBatch = new Set();
    if (ri >= 0) {
      inBatch.add(ri);
      for (let j = ri + 1; j < evs.length && evs[j].s; j++) inBatch.add(j);
    }
    if (ri >= 0 && before && !levelStart && this.scene) {
      const batch = [];
      for (let j = ri + 1; j < evs.length && evs[j].s; j++) batch.push(evs[j]);
      this.pb = new Playback(evs[ri], batch, before, after, this.scene);
      this.pbStart = now;
      this.ui.resolveStart?.(evs[ri]);
    }
    this.board = after;
    this.staticView = null;
    this.snap = m;
    this.snapRecv = now;
    evs.forEach((ev, i) => {
      if (!inBatch.has(i)) this.event(ev, now);
    });
  }

  event(ev, now) {
    switch (ev.e) {
      case 'level_start':
        this.introAt = now;
        this.pb = null;
        this.fx.clear();
        this.ui.levelStart?.(ev);
        this.sound?.cue({ kind: 'level_start', ev }, this);
        break;
      case 'place':
        if (now - this.introAt > 300) this.placed.set(ev.pid, now);
        break;
      case 'level_clear':
        this.ui.levelClear?.(ev);
        this.sound?.cue({ kind: 'level_clear', ev }, this);
        break;
      case 'perk':
        this.ui.perk?.(ev);
        this.sound?.cue({ kind: 'perk', ev }, this);
        break;
    }
  }

  // ------------------------------------------------------------ playback clock and cues

  view(now) {
    const S = this.scene;
    if (this.pb) {
      const t = this.freezeT ?? ((now - this.pbStart) / 1000) * this.rate;
      for (const c of this.pb.due(t)) this.cue(c, now);
      if (t < this.pb.dur) return this.pb.sample(t);
      this.pb = null;
    }
    if (!this.board) return null;
    if (!this.staticView) this.staticView = viewOf(this.board, S);
    return this.staticView;
  }

  playbackT(now) {
    return this.pb ? ((now - this.pbStart) / 1000) * this.rate : -1;
  }

  // effects for one playback cue (sound is mapped in sound.js)
  cue(c, now) {
    const S = this.scene;
    const fx = this.fx;
    const ev = c.ev;
    if (!S) return;
    const late = ((now - this.pbStart) / 1000) * this.rate - c.t > 0.4;
    if (!late) this.sound?.cue(c, this);
    const at = (x, y, z) => S.p(x, y, z);
    switch (c.kind) {
      case 'throw': {
        const [x, y] = ev.from;
        const [sx, sy] = at(x, y, S.standZ(x, y) + 1);
        fx.smoke(sx, sy, 3, { size: 12 * S.k, life: 0.5, speed: 40, color: 'rgba(230,225,210,0.45)' });
        break;
      }
      case 'catch': {
        const [x, y] = ev.at;
        const [sx, sy] = at(x, y, S.standZ(x, y) + 1);
        fx.ring(sx, sy, 6, 40 * S.k, 0.45, this.color(ev.by), 5);
        fx.burst(sx, sy, 10, { speed: 160, life: 0.4, size: 2.5, color: 'rgba(255,230,160,1)' });
        fx.text(sx, sy - 120 * S.k, 'Caught!', '#8ff0c8', 32, 1.1);
        break;
      }
      case 'land': {
        const [x, y] = ev.at;
        const [sx, sy] = at(x, y, S.topZ(x, y));
        fx.smoke(sx, sy, 5, { size: 16 * S.k, life: 0.7, speed: 50, color: 'rgba(150,140,120,0.55)' });
        break;
      }
      case 'bump': {
        this.bumps.set(ev.pid, now);
        const [x, y] = ev.from;
        const [bx, by] = ev.path?.[0] || ev.to;
        const [sx, sy] = at((x + bx) / 2, (y + by) / 2, S.standZ(x, y) + 0.8);
        fx.burst(sx, sy, 10, { speed: 220, life: 0.35, size: 3, color: 'rgba(255,230,120,1)' });
        fx.text(sx, sy - 40 * S.k, 'Bump!', '#ffd76a', 30, 1.0);
        break;
      }
      case 'pickup': {
        const p = this.pb?.engPosAtStart(ev.pid, 'grab') || ev.at;
        const [sx, sy] = at(p[0], p[1], S.standZ(p[0], p[1]) + 1.2);
        fx.burst(sx, sy, 8, { speed: 120, life: 0.35, size: 2.5, color: 'rgba(255,220,150,1)' });
        break;
      }
      case 'load': {
        const cat = S.catapult(ev.cat);
        if (!cat) break;
        const [sx, sy] = at(cat.x, cat.y, 1.4);
        fx.burst(sx, sy, 14, { speed: 200, life: 0.4, size: 3, color: 'rgba(255,210,120,1)' });
        fx.burst(sx, sy, 3, { type: 'cog', speed: 120, life: 0.7, size: 5, color: '#d9b25a', up: 140 });
        fx.text(sx, sy - 50 * S.k, 'Loaded', '#ffd76a', 28, 1.0);
        break;
      }
      case 'fizzle': {
        if (!c.at) break;
        const [x, y] = c.at;
        const [sx, sy] = at(x, y, c.z ?? S.topZ(x, y) + 0.4);
        fx.smoke(sx, sy, 6, { size: 18 * S.k, life: 0.8, speed: 50, color: 'rgba(120,120,120,0.6)' });
        const msg = ev.result === 'contested' ? 'Clash!' : ev.result === 'empty' ? 'Empty!' : 'Fizzle';
        if (ev.result === 'contested') fx.burst(sx, sy, 14, { speed: 260, life: 0.35, size: 3, color: 'rgba(255,120,80,1)' });
        fx.text(sx, sy - 40 * S.k, msg, '#ff8a6a', 32, 1.2);
        break;
      }
      case 'fire': {
        const cat = S.catapult(ev.cat);
        if (!cat) break;
        const [sx, sy] = at(cat.x, cat.y, 1.7);
        fx.smoke(sx, sy, 8, { size: 22 * S.k, life: 1.1, speed: 70, color: 'rgba(220,220,210,0.55)' });
        fx.part('glow', sx, sy, 0, 0, 0.25, 40 * S.k, 'rgba(255,190,100,1)');
        fx.shake = Math.min(fx.shake + 4, 10);
        break;
      }
      case 'impact': {
        const sh = c.shot;
        const [sx, sy] = at(sh.to[0], sh.to[1], OUT_Z + 0.2);
        const k = S.k;
        if (ev.result === 'wasted') {
          fx.smoke(sx, sy, 8, { size: 22 * k, life: 1.0, speed: 60, color: 'rgba(120,100,70,0.6)' });
          fx.text(sx, sy - 50 * k, 'Wasted!', '#ff8a6a', 32, 1.3);
          break;
        }
        if (ev.kind === 'stopwatch') {
          fx.ring(sx, sy, 10, S.TW * 1.6, 0.8, 'rgba(140,210,255,0.95)', 8);
          fx.ring(sx, sy, 6, S.TW * 1.1, 0.6, 'rgba(230,248,255,0.9)', 4);
          fx.part('glow', sx, sy, 0, 0, 0.5, 90 * k, 'rgba(120,200,255,1)');
          fx.burst(sx, sy, 24, { speed: 260, life: 0.7, size: 3, color: 'rgba(170,225,255,1)' });
        } else if (ev.kind === 'grapeshot') {
          fx.part('glow', sx, sy - 40 * k, 0, 0, 0.3, 60 * k, 'rgba(255,190,100,1)');
          fx.burst(sx, sy - 40 * k, 40, { speed: 420, life: 0.5, size: 3, color: 'rgba(255,200,120,1)' });
          fx.smoke(sx, sy - 40 * k, 6, { size: 20 * k, life: 1.0, speed: 60, color: 'rgba(170,165,155,0.55)' });
        } else {
          fx.ring(sx, sy, 8, 70 * k, 0.45, 'rgba(255,200,120,0.95)', 6);
          fx.part('glow', sx, sy, 0, 0, 0.35, 80 * k, 'rgba(255,170,80,1)');
          fx.burst(sx, sy, 22, { speed: 340, life: 0.5, size: 3, color: 'rgba(255,190,100,1)' });
          fx.smoke(sx, sy, 8, { size: 26 * k, life: 1.3, speed: 60, color: 'rgba(170,165,155,0.6)' });
        }
        fx.shake = Math.min(fx.shake + 3, 12);
        break;
      }
      case 'hit':
      case 'kill': {
        const m = c.m;
        const [gx, gy] = S.lanePt(m.lane, m.pos0);
        const [sx, sy] = at(gx, gy, OUT_Z + 0.4);
        const h = c.hit;
        const k = S.k;
        if (h.dmg) fx.text(sx, sy - 60 * k, `−${h.dmg}`, '#ffb648', 38, 1.2);
        else if (h.frozen) fx.text(sx, sy - 60 * k, 'Frozen', '#9fdcff', 30, 1.2);
        if (c.kind === 'kill') {
          const boss = this.defs.machines?.[m.kind]?.boss;
          const r = (MACHINE_CELLS[m.kind] || 0.34) * S.TW;
          fx.smoke(sx, sy, 4 + Math.round(r / 10), { size: r * 0.8, life: 1.0, speed: 50, color: 'rgba(90,85,78,0.7)' });
          fx.burst(sx, sy, 14 + (boss ? 40 : 0), { speed: boss ? 480 : 280, life: 0.5, size: 3, color: 'rgba(255,170,80,1)' });
          fx.burst(sx, sy, boss ? 16 : 4, { type: 'cog', speed: 200, life: 1.0, size: 6, color: '#c9a04a', up: 200 });
          fx.part('glow', sx, sy, 0, 0, 0.3, r * 2, 'rgba(255,160,70,1)');
          if (boss) fx.shake += 18;
        }
        break;
      }
      case 'stall': {
        const [gx, gy] = S.lanePt(ev.lane, ev.pos);
        const [sx, sy] = at(gx, gy, OUT_Z + 0.5);
        fx.burst(sx, sy, 8, { speed: 90, life: 0.6, size: 2.5, color: 'rgba(170,225,255,1)' });
        break;
      }
      case 'wall': {
        const [gx, gy] = S.lanePt(ev.lane, -0.6);
        const [sx, sy] = at(gx, gy, 0.7);
        this.wallFlash = 1;
        fx.shake += Math.min(26, 10 + ev.dmg * 4);
        fx.redVignette = Math.min(1, fx.redVignette + 0.5 + ev.dmg * 0.1);
        fx.burst(sx, sy, 30, { speed: 380, life: 0.6, size: 3.5, color: 'rgba(255,110,60,1)' });
        fx.burst(sx, sy, 8, { type: 'cog', speed: 220, life: 1.0, size: 6, color: '#8a8070', up: 180 });
        fx.smoke(sx, sy, 10, { size: 30 * S.k, life: 1.4, speed: 70, color: 'rgba(110,100,90,0.7)' });
        fx.text(sx, sy - 70 * S.k, `Wall −${ev.dmg}`, '#ff6a4a', 44, 1.6);
        this.ui.wallHit?.(ev);
        break;
      }
      case 'spawn': {
        const [gx, gy] = S.lanePt(ev.lane, ev.pos);
        const [sx, sy] = at(gx, gy, OUT_Z);
        fx.smoke(sx, sy, 6, { size: 22 * S.k, life: 1.0, speed: 50, color: 'rgba(80,70,60,0.6)' });
        if (this.defs.machines?.[ev.kind]?.boss) this.ui.bossArrives?.(ev);
        break;
      }
      case 'drop': {
        const [sx, sy] = at(ev.x, ev.y, S.topZ(ev.x, ev.y));
        fx.smoke(sx, sy, 4, { size: 12 * S.k, life: 0.6, speed: 40, color: 'rgba(150,140,120,0.5)' });
        break;
      }
    }
  }

  // ------------------------------------------------------------ drawing

  frame(now, dt) {
    const g = this.g;
    const px = this.px;
    const fx = this.fx;
    const S = this.scene;
    const tsec = now / 1000;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (!S) {
      g.fillStyle = '#0d1416';
      g.fillRect(0, 0, this.cv.width, this.cv.height);
      return;
    }
    const phase = this.room?.phase;
    const inGame = phase && phase !== 'lobby';
    const v = inGame ? this.view(now) : null;
    this.wallNow = v ? v.wall : null;
    fx.update(dt);
    this.wallFlash = Math.max(0, this.wallFlash - dt * 1.5);

    const sh = fx.shake;
    const sx = sh ? (Math.random() - 0.5) * sh : 0;
    const sy = sh ? (Math.random() - 0.5) * sh : 0;
    g.setTransform(px, 0, 0, px, sx * px, sy * px);
    g.imageSmoothingEnabled = true;
    g.drawImage(S.ground, 0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.85 + 0.08 * Math.sin(tsec * 7.1) * Math.sin(tsec * 2.3);
    g.drawImage(S.light, 0, 0, W, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    if (v) this.drawWorld(g, v, now, tsec);
    else this.drawBare(g, tsec);
    fx.drawAir(g, tsec);
    fx.drawTexts(g);

    if (fx.redVignette > 0) {
      g.setTransform(px, 0, 0, px, 0, 0);
      g.globalAlpha = Math.min(1, fx.redVignette);
      g.drawImage(redVignette(), 0, 0, W, H);
      g.globalAlpha = 1;
    }
    if (phase === 'lobby') {
      g.setTransform(px, 0, 0, px, 0, 0);
      g.fillStyle = 'rgba(6,10,12,0.66)';
      g.fillRect(0, 0, W, H);
    }
  }

  // the empty keep (lobby preview)
  drawBare(g, tsec) {
    const S = this.scene;
    const items = S.blocks.map((b) => ({ k: b.key, b }));
    for (const c of S.keep.catapults) items.push({ k: c.x + c.y - 0.005, c });
    items.sort((a, b) => a.k - b.k);
    for (const it of items) {
      if (it.b) g.drawImage(it.b.img, it.b.bx, it.b.by, it.b.bw, it.b.bh);
      else this.drawCat(g, { id: it.c.id, kind: null, phi: -0.28 }, tsec);
    }
  }

  drawCat(g, c, tsec) {
    const S = this.scene;
    const cat = S.catapult(c.id);
    if (!cat) return;
    const L = S.laneOfCat(c.id);
    drawCatapult(g, S, { x: cat.x, y: cat.y, dir: L ? L.dir : [0, -1], phi: c.phi, kind: c.kind, t: tsec });
  }

  machPos(m) {
    const S = this.scene;
    const L = S.keep.lanes[m.lane];
    const [x, y] = S.lanePt(m.lane, m.pos);
    const dir = L ? L.dir : [0, -1];
    return { x, y, z: OUT_Z + (m.hop || 0) - (m.rise || 0) * 0.4, a: Math.atan2(-dir[1], -dir[0]), perp: [-dir[1], dir[0]], dir };
  }

  drawWorld(g, v, now, tsec) {
    const S = this.scene;
    const k = S.k;
    const room = this.room;
    const planPhase = room?.phase === 'plan';

    // incoming arrivals: shadows at the far end of their lanes
    if (planPhase && this.board?.incoming?.length && !this.pb) {
      const per = new Map();
      for (const inc of this.board.incoming) {
        const n = per.get(inc.lane) || 0;
        per.set(inc.lane, n + 1);
        const L = S.keep.lanes[inc.lane];
        if (!L) continue;
        const [x, y] = S.lanePt(inc.lane, L.len - 1 + 0.15 * n);
        const perp = [-L.dir[1], L.dir[0]];
        const o = (n % 2 ? 1 : -1) * 0.18 * (n > 0 ? 1 : 0);
        const pulse = 0.62 + 0.18 * Math.sin(tsec * 4 + inc.lane);
        drawMachineShadow(g, S, { kind: inc.kind, x: x + perp[0] * o, y: y + perp[1] * o, z: OUT_Z, a: Math.atan2(-L.dir[1], -L.dir[0]), t: tsec, alpha: pulse });
      }
    }

    // ground shadows of things in the air
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (const f of [...v.flying, ...v.shots]) {
      const gx = f.x;
      const gy = f.y;
      const [sx, sy] = S.p(gx, gy, S.cell(Math.round(gx), Math.round(gy)) ? S.topZ(Math.round(gx), Math.round(gy)) : OUT_Z);
      g.beginPath();
      g.ellipse(sx, sy, 12 * k, 6 * k, 0, 0, TAU);
      g.fill();
    }

    // depth-sorted pass
    const items = [];
    for (const b of S.blocks) items.push({ k: b.key, b });
    for (const c of v.cats) {
      const cat = S.catapult(c.id);
      if (cat) items.push({ k: cat.x + cat.y - 0.005, c });
    }
    for (const b of v.bombs) items.push({ k: b.x + b.y - 0.003, bomb: b });
    // machines: stacked ones side by side
    const groups = new Map();
    for (const m of v.machs) {
      const key = `${m.lane}|${Math.round(m.pos)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    const mpos = new Map();
    const mtop = new Map();
    for (const list of groups.values()) {
      list.sort((a, b) => a.id - b.id);
      list.forEach((m, i) => {
        const p = this.machPos(m);
        const o = (i - (list.length - 1) / 2) * 0.34;
        p.x += p.perp[0] * o + p.dir[0] * (i % 2) * 0.12;
        p.y += p.perp[1] * o + p.dir[1] * (i % 2) * 0.12;
        mpos.set(m.id, p);
        items.push({ k: p.x + p.y, m, p });
      });
    }
    const intro = now - this.introAt;
    v.engs.forEach((e, i) => {
      let z = e.z;
      if (intro < 1600) z += Math.max(0, 1 - Math.max(0, intro - i * 90) / 420) ** 2 * 5;
      const pl = this.placed.get(e.pid);
      if (pl && now - pl < 600) z += (1 - (now - pl) / 600) ** 2 * 4;
      items.push({ k: e.key ?? e.x + e.y, e, z });
    });
    items.sort((a, b) => a.k - b.k);

    const engScreen = new Map();
    for (const it of items) {
      if (it.b) {
        g.drawImage(it.b.img, it.b.bx, it.b.by, it.b.bw, it.b.bh);
      } else if (it.c) {
        this.drawCat(g, it.c, tsec);
      } else if (it.bomb) {
        const b = it.bomb;
        const [sx, sy] = S.p(b.x, b.y, b.z);
        g.globalAlpha = b.a;
        // a faint warm ring so bombs on the ground catch the eye
        g.fillStyle = 'rgba(255,200,110,0.16)';
        g.beginPath();
        g.ellipse(sx, sy, 24 * k, 12 * k, 0, 0, TAU);
        g.fill();
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.beginPath();
        g.ellipse(sx, sy, 15 * k, 6 * k, 0, 0, TAU);
        g.fill();
        drawBomb(g, b.kind, sx, sy, 1.05 * k, tsec + b.id);
        g.globalAlpha = 1;
      } else if (it.m) {
        const m = it.m;
        const p = it.p;
        const top = drawMachine(g, S, { kind: m.kind, x: p.x, y: p.y, z: p.z, a: p.a, t: tsec * (m.frozen > 0 ? 0.15 : 1) + m.id, flash: m.flash, alpha: m.alpha });
        mtop.set(m.id, [S.p(p.x, p.y, p.z)[0], top]);
        if (m.frozen > 0) {
          // frost over the machine
          const [fx, fy] = S.p(p.x, p.y, p.z + 0.25);
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = 0.18 + 0.06 * Math.sin(tsec * 3);
          const r = (MACHINE_CELLS[m.kind] || 0.34) * S.TW * 1.3;
          g.drawImage(softSprite('rgba(120,200,255,1)', 64, 0.3), fx - r, fy - r * 0.6, r * 2, r * 1.2);
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
        }
      } else if (it.e) {
        const e = it.e;
        const p = this.players.get(e.pid);
        const [sx, sy] = S.p(e.x, e.y, it.z);
        if (e.face) this.face.set(e.pid, e.face > 0 ? 1 : -1);
        const away = !!p?.away && e.walk < 0;
        drawEngineer(g, {
          sx,
          sy,
          k: k * ENG_K,
          color: this.color(e.pid),
          face: this.face.get(e.pid) || (e.pid.charCodeAt(e.pid.length - 1) % 2 ? 1 : -1),
          walk: e.walk,
          carry: e.carry,
          pose: away && e.pose === 'idle' ? 'sit' : e.pose,
          poseK: e.poseK,
          t: tsec + e.pid.length * 1.7 + (e.pid.charCodeAt(e.pid.length - 1) || 0),
          dim: away,
        });
        engScreen.set(e.pid, { sx, sy, carry: e.carry, away });
      }
    }

    // air: bombs in flight and catapult shots
    for (const f of v.flying) {
      const [sx, sy] = S.p(f.x, f.y, f.z);
      g.save();
      g.translate(sx, sy);
      g.rotate(Math.sin(f.spin) * 0.6);
      drawBomb(g, f.kind, 0, 14 * k, 0.95 * k, tsec);
      g.restore();
    }
    for (const s of v.shots) {
      const [sx, sy] = S.p(s.x, s.y, s.z);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(softSprite('rgba(255,170,80,1)', 32, 0.2), sx - 22 * k, sy - 22 * k, 44 * k, 44 * k);
      g.globalCompositeOperation = 'source-over';
      g.save();
      g.translate(sx, sy);
      g.rotate(s.spin);
      drawBomb(g, s.kind, 0, 14 * k, 1.0 * k, tsec);
      g.restore();
      if (Math.random() < 0.7) this.fx.part('smoke', sx, sy, 0, 0, 0.5, 9 * k, 'rgba(220,220,210,0.35)');
    }

    // wall damage glow along the outer wall
    if (this.wallFlash > 0) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = this.wallFlash * 0.6;
      const pts = [S.p(-0.5, S.h - 0.5, 1.2), S.p(-0.5, -0.5, 1.2), S.p(S.w - 0.5, -0.5, 1.2)];
      g.strokeStyle = 'rgba(255,70,40,1)';
      g.lineWidth = 16 * k;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      g.lineTo(pts[1][0], pts[1][1]);
      g.lineTo(pts[2][0], pts[2][1]);
      g.stroke();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    // ---- overlays (never occluded)
    if (room?.openPlans && planPhase && !this.pb) this.drawGhosts(g, tsec, engScreen);

    // machine status: hp pips, frozen badge, boss name
    for (const m of v.machs) {
      const tp = mtop.get(m.id);
      if (!tp) continue;
      const sx = tp[0];
      const sy = tp[1] - 6 * k;
      g.globalAlpha = m.alpha;
      if (m.max > 1) drawPips(g, sx, sy, m.hp, m.max, k);
      if (m.frozen > 0) drawFrozen(g, sx + (m.max > 1 ? pipsW(m.max, k) / 2 + 18 * k : 0), sy - (m.max > 1 ? 0 : 6 * k), m.frozen, k, tsec);
      if (this.defs.machines?.[m.kind]?.boss) {
        g.font = `bold ${Math.round(22 * k)}px Georgia, serif`;
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        g.lineWidth = 5;
        g.strokeStyle = 'rgba(20,6,4,0.9)';
        const nm = (this.defs.machines[m.kind].name || '').toUpperCase();
        g.strokeText(nm, sx, sy - 14 * k);
        g.fillStyle = '#ff9a7a';
        g.fillText(nm, sx, sy - 14 * k);
      }
      g.globalAlpha = 1;
    }

    // engineers: bump stars and name tags (with a tick once planned)
    for (const [pid, s] of engScreen) {
      const b = this.bumps.get(pid);
      const headY = s.sy - 70 * k * ENG_K;
      if (b && now - b < 1200) drawStars(g, s.sx, headY - 6 * k, 1 - (now - b) / 1200, tsec, k);
      const p = this.players.get(pid);
      if (!p) continue;
      const ty = s.sy - (s.carry ? 118 : 90) * k * ENG_K;
      drawTag(g, s.sx, ty, p.name, p.color, planPhase && p.planned, s.away, k);
    }
  }

  // open plans: each player's current plan, drawn as a ghost in their colour
  drawGhosts(g, tsec, engScreen) {
    const S = this.scene;
    const k = S.k;
    const dash = -tsec * 30;
    for (const p of this.room.players) {
      const plan = p.plan;
      const e = this.board?.eng.get(p.id);
      if (!plan || !e) continue;
      const col = p.color;
      const z0 = S.standZ(e.x, e.y);
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = col;
      g.globalAlpha = 0.9;
      switch (plan.a) {
        case 'move': {
          const pts = [[e.x, e.y], ...(plan.path || [[plan.x, plan.y]])];
          const sp = pts.map(([x, y]) => S.p(x, y, S.standZ(x, y) + 0.05));
          outlined(g, () => {
            g.beginPath();
            g.moveTo(sp[0][0], sp[0][1]);
            for (let i = 1; i < sp.length; i++) g.lineTo(sp[i][0], sp[i][1]);
          }, col, 6 * k, [14 * k, 10 * k], dash);
          const n = sp.length;
          arrowHead(g, sp[n - 2], sp[n - 1], col, k);
          const [dx, dy] = sp[n - 1];
          g.globalAlpha = 0.5 + 0.2 * Math.sin(tsec * 5);
          g.lineWidth = 4 * k;
          g.setLineDash([]);
          g.beginPath();
          g.ellipse(dx, dy, 30 * k, 15 * k, 0, 0, TAU);
          g.stroke();
          break;
        }
        case 'throw':
        case 'pickup': {
          const tx = plan.x;
          const ty = plan.y;
          const a = S.p(e.x, e.y, z0 + (plan.a === 'throw' ? 1.1 : 0.6));
          const b = S.p(tx, ty, S.topZ(tx, ty) + (plan.a === 'throw' ? 0.2 : 0.1));
          const mid = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - (plan.a === 'throw' ? 70 : 24) * k];
          outlined(g, () => {
            g.beginPath();
            g.moveTo(a[0], a[1]);
            g.quadraticCurveTo(mid[0], mid[1], b[0], b[1]);
          }, col, 5 * k, [12 * k, 9 * k], dash);
          // arrowhead along the curve's end tangent
          arrowHead(g, [mid[0] * 0.5 + b[0] * 0.5, mid[1] * 0.5 + b[1] * 0.5], b, col, k);
          g.globalAlpha = 0.55 + 0.2 * Math.sin(tsec * 5);
          g.setLineDash([]);
          g.lineWidth = 4 * k;
          g.beginPath();
          g.ellipse(b[0], b[1], 28 * k, 14 * k, 0, 0, TAU);
          g.stroke();
          g.globalAlpha = 1;
          if (plan.a === 'pickup') badge(g, b[0], b[1] - 46 * k, 'pickup', col, k);
          break;
        }
        case 'load':
        case 'fire': {
          const cat = S.catapult(plan.cat);
          if (!cat) break;
          const a = S.p(e.x, e.y, z0 + 0.8);
          const b = S.p(cat.x, cat.y, 1.6);
          outlined(g, () => {
            g.beginPath();
            g.moveTo(a[0], a[1]);
            g.lineTo(b[0], b[1]);
          }, col, 5 * k, [10 * k, 8 * k], dash);
          const icons = plan.a === 'load' ? (plan.fire ? ['load', 'fire'] : ['load']) : ['fire'];
          icons.forEach((ic, i) => badge(g, b[0] + (i - (icons.length - 1) / 2) * 52 * k, b[1] - 58 * k, ic, col, k));
          break;
        }
        case 'wait': {
          const s = engScreen.get(p.id);
          if (s) badge(g, s.sx + 40 * k, s.sy - 70 * k, 'wait', col, k);
          break;
        }
      }
      g.restore();
    }
  }
}

// ---------------------------------------------------------------- small drawing helpers

function outlined(g, path, col, w, dash, off) {
  g.setLineDash(dash);
  g.lineDashOffset = off;
  path();
  g.lineWidth = w + 5;
  g.strokeStyle = 'rgba(10,8,6,0.75)';
  g.stroke();
  g.lineWidth = w;
  g.strokeStyle = col;
  g.stroke();
  g.setLineDash([]);
}

function arrowHead(g, a, b, col, k) {
  if (!a || !b) return;
  const an = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const L = 20 * k;
  g.beginPath();
  g.moveTo(b[0], b[1]);
  g.lineTo(b[0] - Math.cos(an - 0.5) * L, b[1] - Math.sin(an - 0.5) * L);
  g.lineTo(b[0] - Math.cos(an + 0.5) * L, b[1] - Math.sin(an + 0.5) * L);
  g.closePath();
  g.globalAlpha = 1;
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(10,8,6,0.8)';
  g.stroke();
  g.fillStyle = col;
  g.fill();
}

function badge(g, x, y, icon, col, k) {
  g.globalAlpha = 0.95;
  g.fillStyle = 'rgba(12,16,18,0.9)';
  g.beginPath();
  g.arc(x, y, 22 * k, 0, TAU);
  g.fill();
  g.lineWidth = 3.5 * k;
  g.strokeStyle = col;
  g.stroke();
  drawIcon(g, icon, x, y, 1.05 * k, col);
  g.globalAlpha = 1;
}

function pipsW(max, k) {
  const pw = (max > 8 ? 8 : 11) * k;
  return max * (pw + 3 * k) - 3 * k;
}

function drawPips(g, x, y, hp, max, k) {
  const pw = (max > 8 ? 8 : 11) * k;
  const ph = 13 * k;
  const gap = 3 * k;
  const w = pipsW(max, k);
  const x0 = x - w / 2;
  g.fillStyle = 'rgba(8,6,4,0.85)';
  roundRect(g, x0 - 4 * k, y - ph - 4 * k, w + 8 * k, ph + 8 * k, 5 * k);
  g.fill();
  for (let i = 0; i < max; i++) {
    const on = i < hp;
    g.fillStyle = on ? (hp / max > 0.5 ? '#ffb648' : '#ff5a3f') : '#3a2a22';
    g.fillRect(x0 + i * (pw + gap), y - ph, pw, ph);
    if (on) {
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillRect(x0 + i * (pw + gap), y - ph, pw, 3 * k);
    }
  }
}

function drawFrozen(g, x, y, n, k, t) {
  const r = 15 * k;
  const cy = y - 6 * k;
  g.fillStyle = 'rgba(10,30,50,0.9)';
  g.beginPath();
  g.arc(x, cy, r + 3 * k, 0, TAU);
  g.fill();
  g.fillStyle = '#d8f2ff';
  g.beginPath();
  g.arc(x, cy, r, 0, TAU);
  g.fill();
  g.strokeStyle = '#4aa8e0';
  g.lineWidth = 3 * k;
  g.stroke();
  g.strokeStyle = '#13283a';
  g.lineWidth = 2 * k;
  g.beginPath();
  g.moveTo(x, cy);
  g.lineTo(x, cy - r * 0.7);
  g.moveTo(x, cy);
  g.lineTo(x + Math.cos(t) * r * 0.5, cy + Math.sin(t) * r * 0.5);
  g.stroke();
  g.font = `bold ${Math.round(18 * k)}px Georgia, serif`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(5,15,25,0.95)';
  g.strokeText(`×${n}`, x + r + 4 * k, cy);
  g.fillStyle = '#9fdcff';
  g.fillText(`×${n}`, x + r + 4 * k, cy);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawTag(g, x, y, name, col, ticked, away, k) {
  const fs = Math.round(24 * Math.max(0.85, k));
  g.font = `bold ${fs}px Georgia, serif`;
  const tw = g.measureText(name).width;
  const tick = ticked ? fs + 4 : 0;
  const w = tw + 24 + tick;
  const h = fs + 12;
  const x0 = x - w / 2;
  const y0 = y - h;
  g.globalAlpha = away ? 0.55 : 0.95;
  g.fillStyle = 'rgba(10,14,16,0.88)';
  roundRect(g, x0, y0, w, h, h / 2);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = col;
  g.stroke();
  // pointer
  g.beginPath();
  g.moveTo(x - 7, y);
  g.lineTo(x, y + 8);
  g.lineTo(x + 7, y);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = '#f4ead2';
  g.fillText(name, x0 + 12 + tick, y0 + h / 2 + 1);
  if (ticked) {
    const cx = x0 + 12 + fs / 2 - 2;
    const cy = y0 + h / 2;
    g.fillStyle = '#5fd3a8';
    g.beginPath();
    g.arc(cx, cy, fs / 2 - 1, 0, TAU);
    g.fill();
    g.strokeStyle = '#0d1416';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - fs * 0.22, cy);
    g.lineTo(cx - fs * 0.05, cy + fs * 0.17);
    g.lineTo(cx + fs * 0.24, cy - fs * 0.18);
    g.stroke();
    g.lineCap = 'butt';
  }
  g.globalAlpha = 1;
}

let _rv = null;
function redVignette() {
  if (_rv) return _rv;
  _rv = document.createElement('canvas');
  _rv.width = 960;
  _rv.height = 540;
  const g = _rv.getContext('2d');
  const grd = g.createRadialGradient(480, 270, 180, 480, 270, 560);
  grd.addColorStop(0, 'rgba(200,30,20,0)');
  grd.addColorStop(1, 'rgba(200,30,20,0.55)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 960, 540);
  return _rv;
}
