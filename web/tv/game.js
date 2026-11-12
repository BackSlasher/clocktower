// The battlefield: snapshot interpolation, event effects and the per-frame
// canvas drawing. Everything about stats comes from welcome.defs/map.

import { TAU, clamp, lerp, lerpAngle, preparePath, pointAt, softSprite, gearPath } from './geom.js';
import { buildBackdrop, probeBackdrop } from './backdrop.js';
import { drawTower, drawEnemy, drawTension, drawChronoField, drawClockTower, ENEMY_VIS, TOWER_VIS, TENSION_R } from './sprites.js';
import { FX } from './fx.js';

const W = 1920;
const H = 1080;

export class Game {
  constructor(canvas, ui) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.ui = ui;
    this.px = 1; // device pixels per logical pixel
    this.fx = new FX();
    this.map = null;
    this.defs = null;
    this.paths = [];
    this.bd = null;
    this.colors = new Map(); // pid -> color
    this.phase = 'connecting';
    this.sound = null; // set by main.js once the audio module has loaded
    this.lobbyGears = null;
    this.steam = [];
    this.reset();
    probeBackdrop().then((img) => {
      if (img && this.map) this.rebuild();
    });
  }

  reset() {
    this.ents = new Map(); // enemy id -> render state
    this.towers = new Map(); // plot -> render state
    this.queue = []; // delayed events
    this.lastSnap = null;
    this.snapRecv = 0;
    this.ivl = 100; // ms between snaps (EMA)
    this.simRate = 1; // sim seconds per real second (EMA)
    this.lives = this.defs?.maxLives ?? 20;
    this.livesShown = this.lives;
    this.boss = null;
    this.fx.clear();
  }

  setWelcome(w) {
    const first = !this.map || JSON.stringify(this.map) !== JSON.stringify(w.map);
    this.map = w.map;
    this.defs = w.defs;
    this.paths = w.map.paths.map((p) => preparePath(p.pts));
    this.plots = new Map(w.map.plots.map((p) => [p.id, p]));
    if (first || !this.bd) this.rebuild();
  }

  setRoom(room) {
    for (const p of room.players) this.colors.set(p.id, p.color);
    if (room.phase === 'lobby' && this.phase !== 'lobby' && this.phase !== 'connecting') this.reset();
    this.phase = room.phase;
  }

  resize(px) {
    if (px === this.px && this.cv.width === Math.round(W * px)) return;
    this.px = px;
    this.cv.width = Math.round(W * px);
    this.cv.height = Math.round(H * px);
    clearTimeout(this._rb);
    this._rb = setTimeout(() => this.rebuild(), 150);
  }

  rebuild() {
    if (!this.map) return;
    this.bd = buildBackdrop(this.map, Math.min(2, Math.max(1, this.px)));
  }

  color(pid) {
    return this.colors.get(pid) || '#d9b25a';
  }

  alpha(now) {
    return clamp((now - this.snapRecv) / this.ivl, 0, 1.25);
  }

  // ------------------------------------------------------------ snapshots

  onSnap(m, now) {
    const last = this.lastSnap;
    const contiguous = last && m.time >= last.time && now - this.snapRecv < 1500;
    if (contiguous) {
      const dt = now - this.snapRecv;
      if (dt > 30 && dt < 600) {
        this.ivl = this.ivl * 0.85 + dt * 0.15;
        const r = (m.time - last.time) / (dt / 1000);
        this.simRate = this.simRate * 0.8 + clamp(r, 0, 60) * 0.2;
      }
    }
    const a = contiguous ? this.alpha(now) : 1;

    // enemies
    const seen = new Set();
    for (const [id, k, p, d, hp, f] of m.enemies) {
      seen.add(id);
      let e = this.ents.get(id);
      if (e && contiguous) {
        e.d0 = lerp(e.d0, e.d1, a);
        e.hp0 = lerp(e.hp0, e.hp1, Math.min(1, a));
        e.d1 = d;
        e.hp1 = hp;
        e.f = f;
        e.gone = 0;
      } else {
        const kind = this.defs.enemyOrder[k] || 'scrap';
        e = { id, k, kind, def: this.defs.enemies[kind] || {}, p, d0: d, d1: d, hp0: hp, hp1: hp, f, flash: 0, gone: 0, x: 0, y: 0, a: 0, seed: (id * 0.618) % 1 };
        this.ents.set(id, e);
      }
    }
    for (const [id, e] of this.ents) {
      if (seen.has(id)) continue;
      if (!contiguous) this.ents.delete(id);
      else if (!e.gone) {
        e.d0 = lerp(e.d0, e.d1, a);
        e.gone = now;
      }
    }

    // towers
    const tseen = new Set();
    for (const t of m.towers) {
      tseen.add(t.plot);
      let s = this.towers.get(t.plot);
      if (s && s.kind === t.kind) {
        s.aim0 = contiguous ? lerpAngle(s.aim0, s.aim1, Math.min(1, a)) : t.aim;
        s.ten0 = contiguous ? lerp(s.ten0, s.ten1, Math.min(1, a)) : t.tension;
        s.aim1 = t.aim;
        s.ten1 = t.tension;
        s.lvl = t.lvl;
        s.owner = t.owner;
        s.spent = t.spent;
      } else {
        const pl = this.plots.get(t.plot) || { x: 0, y: 0 };
        s = { plot: t.plot, kind: t.kind, lvl: t.lvl, owner: t.owner, spent: t.spent, x: pl.x, y: pl.y, aim0: t.aim, aim1: t.aim, ten0: t.tension, ten1: t.tension, born: contiguous ? now : now - 1000, recoil: 0, anim: Math.random() * 10, kick: 0 };
        this.towers.set(t.plot, s);
      }
    }
    for (const plot of [...this.towers.keys()]) if (!tseen.has(plot)) this.towers.delete(plot);

    this.lastSnap = m;
    this.snapRecv = now;
    this.lives = m.lives;

    // events: shown one snap interval later, in step with the interpolation
    // (a snap arriving after a long gap carries a burst of events: show them, but silently)
    const quiet = contiguous && now - (this._prevRecv || now) > 500;
    this._prevRecv = now;
    if (contiguous) for (const ev of m.ev || []) this.queue.push({ at: now + this.ivl, ev, quiet });
  }

  // ------------------------------------------------------------ events

  runEvents(now) {
    if (!this.queue.length) return;
    let i = 0;
    for (; i < this.queue.length && this.queue[i].at <= now; i++) {
      const q = this.queue[i];
      // events that are late (background tab, stalled frame) or part of a reconnect burst stay silent
      if (this.sound && !q.quiet && now - q.at < 400) this.sound.event(q.ev, this);
      this.event(q.ev, now);
    }
    if (i) this.queue.splice(0, i);
    // never let a backlog build up (e.g. background tab)
    if (this.queue.length > 600) this.queue.splice(0, this.queue.length - 600);
  }

  towerLevel(kind, lvl) {
    const L = this.defs.towers[kind]?.levels || [];
    return L[clamp((lvl || 1) - 1, 0, L.length - 1)] || {};
  }

  event(ev, now) {
    const fx = this.fx;
    const plot = ev.plot !== undefined ? this.plots.get(ev.plot) : null;
    const tw = ev.plot !== undefined ? this.towers.get(ev.plot) : null;
    switch (ev.e) {
      case 'shot': {
        if (!plot) break;
        const kind = ev.kind || tw?.kind;
        const lv = this.towerLevel(kind, tw?.lvl);
        const aim = tw ? tw.aim1 : Math.atan2(ev.y - plot.y, ev.x - plot.x);
        if (tw) {
          tw.recoil = 1;
          tw.aim0 = tw.aim1 = Math.atan2(ev.y - plot.y, ev.x - plot.x);
        }
        const mx = plot.x + Math.cos(aim) * 26;
        const my = plot.y + Math.sin(aim) * 26;
        const dur = (ev.travel || 0.05) / Math.max(0.2, this.simRate);
        if (lv.splash) {
          fx.smoke(mx, my, 3, { size: 18, life: 0.9, color: 'rgba(230,230,220,0.55)' });
          fx.part('glow', mx, my, 0, 0, 0.2, 26, 'rgba(255,190,100,1)');
          fx.proj('mortar', mx, my, ev.x, ev.y, dur, () => {
            this.sound?.impact(ev.x);
            this.splash(ev.x, ev.y, lv.splash, ev.to);
          });
        } else {
          fx.proj('rivet', mx, my, ev.x, ev.y, dur, () => {
            fx.burst(ev.x, ev.y, 3, { speed: 160, life: 0.25, size: 2, color: 'rgba(255,220,150,1)' });
            this.hit(ev.to);
          });
        }
        break;
      }
      case 'chain': {
        if (tw) tw.recoil = 1;
        if (ev.pts?.length > 1) {
          const pts = ev.pts.slice();
          if (plot) pts[0] = [plot.x, plot.y];
          fx.bolt(pts);
        }
        for (const id of ev.ids || []) this.hit(id);
        break;
      }
      case 'die': {
        const def = this.defs.enemies[ev.kind] || {};
        const r = def.radius || 14;
        if (def.boss) {
          fx.shake += 22;
          fx.ring(ev.x, ev.y, 20, 260, 1.0, 'rgba(255,190,90,0.9)', 10);
          fx.burst(ev.x, ev.y, 60, { speed: 520, life: 1.0, size: 4, color: 'rgba(255,170,70,1)' });
          fx.burst(ev.x, ev.y, 18, { type: 'cog', speed: 420, life: 1.6, size: 10, color: '#d9b25a', up: 260 });
          fx.smoke(ev.x, ev.y, 18, { size: 60, life: 2.2, speed: 90, color: 'rgba(60,55,50,0.8)' });
          fx.part('glow', ev.x, ev.y, 0, 0, 0.5, 200, 'rgba(255,200,120,1)');
          fx.text(ev.x, ev.y - 70, `+${ev.bounty}`, '#ffd76a', 64, 2.4, true);
        } else {
          fx.smoke(ev.x, ev.y, 3 + Math.round(r / 6), { size: r * 1.3, life: 0.9, speed: 40, color: 'rgba(90,85,78,0.7)' });
          fx.burst(ev.x, ev.y, 6 + Math.round(r / 3), { speed: 260, life: 0.4, size: 2.5, color: 'rgba(255,170,80,1)' });
          fx.burst(ev.x, ev.y, 2 + Math.round(r / 8), { type: 'cog', speed: 160, life: 0.8, size: 5, color: '#c9a04a', up: 160 });
          fx.part('glow', ev.x, ev.y, 0, 0, 0.25, r * 2.5, 'rgba(255,160,70,1)');
          if (ev.bounty >= 4) fx.text(ev.x, ev.y - r * 1.45 - 12, `+${ev.bounty}`, '#f0d48a', 30, 1.1, true);
        }
        break;
      }
      case 'leak': {
        const T = this.map.tower;
        const def = this.defs.enemies[ev.kind] || {};
        fx.leakFlash = 1;
        fx.redVignette = Math.min(1, fx.redVignette + 0.6 + (def.boss ? 1 : 0));
        fx.shake += Math.min(30, 9 + (ev.lives || 1) * 2);
        fx.burst(T.x, T.y, 24, { speed: 380, life: 0.6, size: 3, color: 'rgba(255,90,60,1)' });
        fx.text(T.x, T.y - 130, `−${ev.lives || 1}`, '#ff6a4a', def.boss ? 72 : 48, 1.6);
        this.ui.livesHit?.();
        break;
      }
      case 'build': {
        if (!plot) break;
        const c = this.color(ev.pid);
        fx.ring(plot.x, plot.y, 12, 70, 0.6, c, 7);
        fx.burst(plot.x, plot.y, 20, { speed: 260, life: 0.5, size: 3, color: 'rgba(255,215,140,1)' });
        fx.burst(plot.x, plot.y, 5, { type: 'cog', speed: 180, life: 0.9, size: 6, color: '#d9b25a', up: 200 });
        fx.smoke(plot.x, plot.y + 10, 6, { size: 22, life: 0.9, speed: 70, color: 'rgba(150,140,125,0.55)' });
        break;
      }
      case 'upgrade': {
        if (!plot) break;
        fx.ring(plot.x, plot.y, 20, 80, 0.7, 'rgba(255,215,110,1)', 6);
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * TAU;
          fx.part('glow', plot.x + Math.cos(a) * 30, plot.y + Math.sin(a) * 30, 0, -60 - Math.random() * 90, 0.9, 10, 'rgba(255,215,120,1)');
        }
        fx.text(plot.x, plot.y - 58, `Level ${ev.lvl}`, '#ffd76a', 32, 1.4);
        if (tw) tw.born = now - 120; // little pop
        break;
      }
      case 'sell': {
        if (!plot) break;
        fx.ring(plot.x, plot.y, 60, 8, 0.5, 'rgba(240,212,138,0.8)', 5);
        fx.smoke(plot.x, plot.y, 10, { size: 26, life: 1.1, speed: 80, color: 'rgba(150,140,125,0.6)' });
        fx.burst(plot.x, plot.y, 8, { type: 'cog', speed: 200, life: 1.0, size: 6, color: '#d9b25a', up: 220 });
        if (ev.refund) fx.text(plot.x, plot.y - 40, `+${ev.refund}`, this.color(ev.pid), 34, 1.5, true);
        break;
      }
      case 'wind': {
        if (!plot) break;
        const c = this.color(ev.pid);
        if (tw) tw.kick = 1;
        fx.ring(plot.x, plot.y, TENSION_R - 6, TENSION_R + 14, 0.35, c, 4);
        for (let i = 0; i < 4; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
          fx.part('spark', plot.x + Math.cos(a) * TENSION_R, plot.y + Math.sin(a) * TENSION_R, Math.cos(a) * 140, Math.sin(a) * 140, 0.3, 2.5, c);
        }
        break;
      }
      case 'gift':
        this.ui.gift?.(ev);
        break;
      case 'wave_start':
        this.ui.waveStart?.(ev);
        break;
      case 'wave_clear':
        this.ui.waveClear?.(ev);
        break;
    }
  }

  hit(id) {
    const e = this.ents.get(id);
    if (e) e.flash = 1;
  }

  splash(x, y, r, to) {
    const fx = this.fx;
    fx.ring(x, y, 8, r, 0.45, 'rgba(255,200,120,0.95)', 6);
    fx.ring(x, y, 4, r * 0.7, 0.3, 'rgba(255,255,230,0.8)', 3);
    fx.part('glow', x, y, 0, 0, 0.3, r * 1.2, 'rgba(255,170,80,1)');
    fx.burst(x, y, 14, { speed: 320, life: 0.45, size: 3, color: 'rgba(255,190,100,1)' });
    fx.smoke(x, y, 6, { size: 30, life: 1.3, speed: 60, color: 'rgba(170,165,155,0.55)' });
    fx.addScorch(x, y, r * 0.7);
    fx.shake = Math.min(fx.shake + 1.5, 12);
    const r2 = r * r;
    for (const e of this.ents.values()) {
      if (e.def.flying) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy < r2) e.flash = 1;
    }
    this.hit(to);
  }

  // ------------------------------------------------------------ drawing

  frame(now, dt) {
    const g = this.g;
    const px = this.px;
    const fx = this.fx;
    const tsec = now / 1000;
    if (!this.map || !this.bd) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#0d1416';
      g.fillRect(0, 0, this.cv.width, this.cv.height);
      return;
    }
    const inGame = this.phase === 'build' || this.phase === 'wave' || this.phase === 'won' || this.phase === 'lost';
    if (inGame) this.runEvents(now);
    fx.update(dt);

    const sh = fx.shake;
    const sx = sh ? (Math.random() - 0.5) * sh : 0;
    const sy = sh ? (Math.random() - 0.5) * sh : 0;
    g.setTransform(px, 0, 0, px, sx * px, sy * px);
    g.imageSmoothingEnabled = true;

    // backdrop + gaslight
    g.drawImage(this.bd.base, 0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.8 + 0.06 * Math.sin(tsec * 7.1) * Math.sin(tsec * 2.3);
    g.drawImage(this.bd.light, 0, 0, W, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // chimney smoke
    for (const c of this.bd.chimneys) {
      if (Math.random() < dt * 0.9) fx.part('smoke', c.x, c.y, 8 + Math.random() * 6, -10, 3.5, 12, 'rgba(120,125,125,0.28)');
    }

    if (inGame) this.drawBattle(g, now, tsec, dt);
    else {
      drawClockTower(g, this.map.tower, { lives: this.defs.maxLives, maxLives: this.defs.maxLives, now: tsec, flash: 0, low: false });
      this.drawPlots(g, tsec, false);
      fx.drawAir(g, tsec);
    }

    if (this.phase === 'lobby' || this.phase === 'connecting') this.drawLobbyDecor(g, tsec, dt);

    // damage vignette
    if (fx.redVignette > 0) {
      g.setTransform(px, 0, 0, px, 0, 0);
      g.globalAlpha = Math.min(1, fx.redVignette);
      g.drawImage(redVignette(), 0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  drawPlots(g, t, building) {
    for (const p of this.map.plots) {
      if (this.towers.has(p.id)) continue;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.beginPath();
      g.arc(p.x + 2, p.y + 3, 29, 0, TAU);
      g.fill();
      g.fillStyle = '#2b2824';
      g.beginPath();
      g.arc(p.x, p.y, 27, 0, TAU);
      g.fill();
      g.save();
      g.setLineDash([9, 7]);
      g.lineDashOffset = building ? -t * 12 : 0;
      g.lineWidth = 3;
      const pulse = building ? 0.55 + 0.35 * Math.sin(t * 3 + p.id) : 0.45;
      g.strokeStyle = `rgba(217,178,90,${pulse})`;
      g.beginPath();
      g.arc(p.x, p.y, 24, 0, TAU);
      g.stroke();
      g.restore();
      // a little cross of rivets marks the foundation
      g.fillStyle = `rgba(217,178,90,${building ? 0.7 : 0.4})`;
      g.fillRect(p.x - 8, p.y - 1.5, 16, 3);
      g.fillRect(p.x - 1.5, p.y - 8, 3, 16);
    }
  }

  drawBattle(g, now, t, dt) {
    const fx = this.fx;
    const defs = this.defs;
    const a = this.alpha(now);
    const building = this.phase === 'build';

    // enemy positions
    const tmp = {};
    let boss = null;
    for (const [id, e] of this.ents) {
      if (e.gone && now - e.gone > this.ivl * 1.2) {
        this.ents.delete(id);
        continue;
      }
      const path = this.paths[e.p] || this.paths[0];
      const d = e.gone ? e.d0 : lerp(e.d0, e.d1, a);
      pointAt(path, d, tmp);
      e.x = tmp.x;
      e.y = tmp.y;
      e.a = tmp.a;
      e.hp = e.gone ? 0 : lerp(e.hp0, e.hp1, Math.min(1, a));
      e.flash = Math.max(0, e.flash - dt * 6);
      if (e.def.boss && !e.gone && (!boss || e.hp > boss.hp)) boss = e;
    }
    this.boss = boss;

    // under-layer: chrono fields, tinker auras
    for (const s of this.towers.values()) {
      const td = defs.towers[s.kind];
      if (td?.wind === 'range') {
        const lv = this.towerLevel(s.kind, s.lvl);
        const ten = lerp(s.ten0, s.ten1, Math.min(1, a));
        const r = (lv.range || 150) * (1 + (defs.windRangeBonus || 0) * ten);
        drawChronoField(g, s.x, s.y, r, t, ten);
      }
    }
    for (const e of this.ents.values()) {
      if (e.def.repairRange && !e.gone) {
        g.fillStyle = 'rgba(110,255,170,0.035)';
        g.beginPath();
        g.arc(e.x, e.y, e.def.repairRange, 0, TAU);
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = 'rgba(125,255,176,0.14)';
        g.stroke();
      }
    }

    this.drawPlots(g, t, building);
    fx.drawGround(g);

    // ground enemies
    for (const e of this.ents.values()) if (!e.def.flying) this.drawEnemy(g, e, now, t);

    // towers
    for (const s of this.towers.values()) this.drawTowerState(g, s, now, t, dt, a);

    // clock tower (enemies vanish into it)
    const low = this.lives <= Math.max(3, Math.round(defs.maxLives * 0.25));
    drawClockTower(g, this.map.tower, { lives: this.lives, maxLives: defs.maxLives, now: t, flash: fx.leakFlash, low });

    // flyers above
    for (const e of this.ents.values()) if (e.def.flying) this.drawEnemy(g, e, now, t);

    fx.drawAir(g, t);

    // health bars and status markers on top
    for (const e of this.ents.values()) this.drawEnemyStatus(g, e, t);

    fx.drawTexts(g);

    // HUD drawn on canvas: lives gauge + boss bar (unshaken)
    g.setTransform(this.px, 0, 0, this.px, 0, 0);
    this.drawLivesGauge(g, t, low);
    if (boss) this.drawBossBar(g, boss);
  }

  drawEnemy(g, e, now, t) {
    const slowed = e.f & 1;
    const fade = e.gone ? clamp(1 - (now - e.gone) / this.ivl, 0, 1) : 1;
    if (fade <= 0) return;
    if (fade < 1) g.globalAlpha = fade;
    const sp = (e.def.speed || 50) / 50;
    e.t = (t * sp * (slowed ? 0.45 : 1)) + e.seed * 10;
    e.r = (e.def.radius || 14) * ENEMY_VIS;
    drawEnemy(g, e.kind, e);
    g.globalAlpha = 1;
  }

  drawEnemyStatus(g, e, t) {
    if (e.gone) return;
    const r = (e.def.radius || 14) * ENEMY_VIS * (e.def.boss ? 1.35 : 1);
    const y0 = e.y - r - (e.def.flying ? 14 : 10);
    if (e.f & 1) {
      // slowed: icy clock ring
      g.save();
      g.setLineDash([5, 5]);
      g.lineDashOffset = t * 8;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(140,205,255,0.95)';
      g.beginPath();
      g.arc(e.x, e.y, r + 6, 0, TAU);
      g.stroke();
      g.restore();
    }
    if (e.f & 2) {
      // being repaired: green glow + plus
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.5 + 0.3 * Math.sin(t * 8 + e.seed * 9);
      g.drawImage(softSprite('rgba(90,255,150,1)', 64, 0.2), e.x - r * 1.6, e.y - r * 1.6, r * 3.2, r * 3.2);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      const py = y0 - 14 - ((t * 30 + e.seed * 40) % 14);
      g.fillStyle = '#7dffb0';
      g.fillRect(e.x + r - 3, py - 1.5 - 4, 10, 4);
      g.fillRect(e.x + r, py - 8, 4, 10);
    }
    if (e.def.boss) return; // the boss has its own big bar
    if (e.hp >= 0.995) return;
    const w = Math.max(30, r * 2.4);
    const x = e.x - w / 2;
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillRect(x - 2, y0 - 2, w + 4, 9);
    g.fillStyle = e.hp > 0.6 ? '#5fd3a8' : e.hp > 0.3 ? '#ffb648' : '#ff5a3f';
    g.fillRect(x, y0, w * clamp(e.hp, 0, 1), 5);
  }

  drawTowerState(g, s, now, t, dt, a) {
    const ten = lerp(s.ten0, s.ten1, Math.min(1, a));
    const aim = lerpAngle(s.aim0, s.aim1, Math.min(1, a * 1.5));
    s.anim += dt * (0.2 + 1.6 * ten); // run-down towers move sluggishly
    s.recoil = Math.max(0, s.recoil - dt * 6);
    s.kick = Math.max(0, s.kick - dt * 3);
    const age = (now - s.born) / 1000;
    let scale = TOWER_VIS;
    if (age < 0.45) {
      const k = age / 0.45;
      scale = k < 0.7 ? (k / 0.7) * 1.15 : 1.15 - ((k - 0.7) / 0.3) * 0.15;
      scale = Math.max(0.05, scale) * TOWER_VIS;
    }
    const def = this.defs.towers[s.kind];
    const st = { x: s.x, y: s.y, lvl: s.lvl, aim, tension: ten, t: s.anim, recoil: s.recoil, color: this.color(s.owner), def };
    {
      g.save();
      g.translate(s.x, s.y);
      g.scale(scale, scale);
      g.translate(-s.x, -s.y);
    }
    drawTower(g, s.kind, st);
    g.restore();
    // run down: soot over the tower
    if (ten < 0.35) {
      g.fillStyle = `rgba(5,10,14,${(0.35 - ten) * 1.3})`;
      g.beginPath();
      g.arc(s.x, s.y, 36, 0, TAU);
      g.fill();
    } else if (ten > 0.85 && Math.random() < dt * 4) {
      const an = Math.random() * TAU;
      this.fx.part('glow', s.x + Math.cos(an) * 20, s.y + Math.sin(an) * 20, 0, -40, 0.5, 8, 'rgba(255,225,150,1)');
    }
    drawTension(g, s.x, s.y, ten, t);
    if (s.kick > 0) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = s.kick * 0.8;
      g.lineWidth = 10;
      g.strokeStyle = 'rgba(255,240,200,0.7)';
      g.beginPath();
      g.arc(s.x, s.y, TENSION_R, -Math.PI / 2, -Math.PI / 2 + TAU * ten);
      g.stroke();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  }

  drawLivesGauge(g, t, low) {
    const max = this.defs.maxLives || 20;
    // ease the needle
    this.livesShown += (this.lives - this.livesShown) * 0.12;
    const k = clamp(this.livesShown / max, 0, 1);
    const cx = 1785;
    const cy = 150;
    const R = 112;
    const a0 = Math.PI * 0.94;
    const sweep = Math.PI * 1.12;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    g.arc(cx + 6, cy + 8, R + 8, 0, TAU);
    g.fill();
    g.fillStyle = '#6e5120';
    g.beginPath();
    g.arc(cx, cy, R + 8, 0, TAU);
    g.fill();
    const rim = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    rim.addColorStop(0, '#f0d48a');
    rim.addColorStop(0.5, '#b88a34');
    rim.addColorStop(1, '#6e5120');
    g.fillStyle = rim;
    g.beginPath();
    g.arc(cx, cy, R + 3, 0, TAU);
    g.fill();
    g.fillStyle = '#e9dcbc';
    g.beginPath();
    g.arc(cx, cy, R - 6, 0, TAU);
    g.fill();
    // red zone
    g.lineWidth = 14;
    g.strokeStyle = 'rgba(200,50,30,0.85)';
    g.beginPath();
    g.arc(cx, cy, R - 20, a0, a0 + sweep * 0.25);
    g.stroke();
    g.strokeStyle = 'rgba(79,179,154,0.8)';
    g.beginPath();
    g.arc(cx, cy, R - 20, a0 + sweep * 0.6, a0 + sweep);
    g.stroke();
    // ticks
    g.strokeStyle = '#2a1c05';
    for (let i = 0; i <= max; i++) {
      const an = a0 + (sweep * i) / max;
      const big = i % 5 === 0;
      g.lineWidth = big ? 3.5 : 1.5;
      g.beginPath();
      g.moveTo(cx + Math.cos(an) * (R - (big ? 34 : 28)), cy + Math.sin(an) * (R - (big ? 34 : 28)));
      g.lineTo(cx + Math.cos(an) * (R - 12), cy + Math.sin(an) * (R - 12));
      g.stroke();
    }
    // number
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = low && Math.sin(t * 6) > 0 ? '#b8281a' : '#1a1208';
    g.font = 'bold 64px Georgia, serif';
    g.fillText(String(Math.max(0, this.lives)), cx, cy + 50);
    g.font = 'bold 28px Georgia, serif';
    g.fillStyle = '#5a4520';
    g.fillText('LIVES', cx, cy + 92);
    // needle
    const an = a0 + sweep * k + (this.fx.leakFlash ? Math.sin(t * 60) * 0.05 : 0);
    g.lineCap = 'round';
    g.lineWidth = 6;
    g.strokeStyle = '#a8321f';
    g.beginPath();
    g.moveTo(cx - Math.cos(an) * 12, cy - Math.sin(an) * 12);
    g.lineTo(cx + Math.cos(an) * (R - 24), cy + Math.sin(an) * (R - 24));
    g.stroke();
    g.lineCap = 'butt';
    g.fillStyle = '#b88a34';
    g.beginPath();
    g.arc(cx, cy, 10, 0, TAU);
    g.fill();
    g.fillStyle = '#2a1c05';
    g.beginPath();
    g.arc(cx, cy, 4, 0, TAU);
    g.fill();
    // glass glint
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.ellipse(cx - 30, cy - 50, 55, 26, -0.5, 0, TAU);
    g.fill();
    if (low) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.3 + 0.3 * Math.sin(t * 6);
      g.drawImage(softSprite('rgba(255,60,30,1)', 64, 0.4), cx - R - 40, cy - R - 40, (R + 40) * 2, (R + 40) * 2);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  }

  drawBossBar(g, boss) {
    const w = 760;
    const x = (W - w) / 2;
    const y = 28;
    g.fillStyle = 'rgba(10,6,6,0.82)';
    roundRectPath(g, x - 16, y - 8, w + 32, 84, 12);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#8f1d14';
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 32px Georgia, serif';
    g.fillStyle = '#ffcf9a';
    g.fillText((boss.def.name || 'Boss').toUpperCase(), W / 2, y + 16);
    g.fillStyle = '#2a0c08';
    g.fillRect(x, y + 40, w, 24);
    const k = clamp(boss.hp, 0, 1);
    const grd = g.createLinearGradient(x, 0, x + w, 0);
    grd.addColorStop(0, '#ff3a20');
    grd.addColorStop(1, '#ff9a3a');
    g.fillStyle = grd;
    g.fillRect(x, y + 40, w * k, 24);
    g.fillStyle = 'rgba(255,255,255,0.2)';
    g.fillRect(x, y + 40, w * k, 7);
    g.strokeStyle = '#d9b25a';
    g.lineWidth = 2;
    g.strokeRect(x, y + 40, w, 24);
  }

  // ------------------------------------------------------------ lobby decor

  drawLobbyDecor(g, t, dt) {
    if (!this.lobbyGears) this.lobbyGears = makeLobbyGears();
    g.fillStyle = 'rgba(6,10,12,0.62)';
    g.fillRect(0, 0, W, H);
    for (const gr of this.lobbyGears) {
      g.save();
      g.translate(gr.x, gr.y);
      g.rotate(gr.phase + t * gr.speed);
      g.globalAlpha = gr.alpha;
      g.drawImage(gr.img, -gr.img.width / 2, -gr.img.height / 2);
      g.restore();
    }
    g.globalAlpha = 1;
    // drifting steam
    const S = this.steam;
    if (S.length < 70 && Math.random() < dt * 14) {
      const fromLeft = Math.random() < 0.5;
      S.push({
        x: fromLeft ? 80 + Math.random() * 420 : 1500 + Math.random() * 420,
        y: 1110,
        vx: 10 + Math.random() * 25,
        vy: -(40 + Math.random() * 50),
        s: 50 + Math.random() * 60,
        life: 0,
        max: 9 + Math.random() * 6,
      });
    }
    for (let i = S.length - 1; i >= 0; i--) {
      const p = S[i];
      p.life += dt;
      if (p.life > p.max) {
        S.splice(i, 1);
        continue;
      }
      p.x += (p.vx + Math.sin(p.life * 0.8 + p.s) * 14) * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;
      const s = p.s * (1 + k * 2.2);
      g.globalAlpha = Math.sin(Math.PI * k) * 0.22;
      g.drawImage(softSprite('rgba(223,233,234,1)', 64, 0.1), p.x - s, p.y - s, s * 2, s * 2);
    }
    g.globalAlpha = 1;
  }
}

function makeLobbyGears() {
  const spec = [
    { x: 40, y: 1060, r: 260, teeth: 24, speed: 0.12, alpha: 0.5 },
    { x: 390, y: 1045, r: 120, teeth: 12, speed: -0.26, alpha: 0.5, phase: 0.13 },
    { x: 1900, y: 40, r: 210, teeth: 20, speed: -0.14, alpha: 0.45 },
    { x: 1640, y: 30, r: 90, teeth: 10, speed: 0.33, alpha: 0.45, phase: 0.2 },
    { x: 1880, y: 330, r: 110, teeth: 11, speed: 0.27, alpha: 0.4 },
  ];
  return spec.map((s) => ({ ...s, phase: s.phase || 0, img: gearSprite(s.r, s.teeth) }));
}

function gearSprite(r, teeth) {
  const size = Math.ceil(r * 2 + 8);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const m = size / 2;
  const grd = g.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, '#f0d48a');
  grd.addColorStop(0.5, '#b88a34');
  grd.addColorStop(1, '#6e5120');
  g.fillStyle = grd;
  gearPath(g, m, m, r, teeth, 0, Math.min(0.22, 26 / r));
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#3a2a0c';
  g.stroke();
  g.globalCompositeOperation = 'destination-out';
  const holes = teeth > 16 ? 6 : 5;
  for (let i = 0; i < holes; i++) {
    const a = (i / holes) * TAU;
    g.beginPath();
    g.arc(m + Math.cos(a) * r * 0.5, m + Math.sin(a) * r * 0.5, r * 0.2, 0, TAU);
    g.fill();
  }
  g.beginPath();
  g.arc(m, m, r * 0.1, 0, TAU);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(58,42,12,0.8)';
  g.beginPath();
  g.arc(m, m, r * 0.78, 0, TAU);
  g.stroke();
  g.beginPath();
  g.arc(m, m, r * 0.2, 0, TAU);
  g.stroke();
  return c;
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

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

