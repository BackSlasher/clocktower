// Board state and resolve playback.
//
// A snap always holds the end state. A `resolve` batch (header + stage events) says how the
// board got there; Playback rebuilds the round as per-entity timelines starting from the board
// the TV showed before, and sample(t) gives the scene at playback time t (game seconds since
// the batch). Past `dur` the caller shows the snap's board itself, so the end state is always
// exactly the server's.
//
// Within a stage slot [at, at + dur] everything of that stage happens together; fractions of
// the slot are named below (e.g. GRAB_HIT: when a picked-up bomb reaches the hands).

const THROW_GO = 0.06;
const THROW_LAND = 0.82;
const THROW_SETTLE = 0.98;
const GRAB_HIT = 0.5;
const FIRE_GO = 0.06;
const FIRE_HIT = 0.72;
const MACH_MOVE = 0.62;
const WALL_HIT = 0.5;
const SPAWN_AT = 0.5;
const BOMB_AT = 0.62;

export const ARM_REST = -0.28;
const ARM_TOP = 2.35;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t) => t * t * (3 - 2 * t);

export function boardFromSnap(s) {
  const cats = [];
  for (const c of s.catapults || []) cats[c.id] = c.bomb ? c.bomb.kind : null;
  return {
    eng: new Map((s.engineers || []).map((e) => [e.pid, { pid: e.pid, x: e.x, y: e.y, carry: e.carry ? e.carry.kind : null }])),
    bombs: new Map((s.bombs || []).map((b) => [b.id, { id: b.id, kind: b.kind, x: b.x, y: b.y }])),
    cats,
    mach: new Map((s.machines || []).map((m) => [m.id, { ...m }])),
    incoming: s.incoming || [],
    wall: s.wall,
    wallMax: s.wallMax,
  };
}

// static scene of a board (no playback)
export function viewOf(board, S) {
  const v = { engs: [], bombs: [], flying: [], cats: [], machs: [], wall: board.wall, shots: [] };
  for (const e of board.eng.values()) v.engs.push({ pid: e.pid, x: e.x, y: e.y, z: S.standZ(e.x, e.y), carry: e.carry, walk: -1, pose: 'idle', poseK: 0 });
  for (const b of board.bombs.values()) v.bombs.push({ id: b.id, kind: b.kind, x: b.x, y: b.y, z: S.topZ(b.x, b.y), a: 1 });
  board.cats.forEach((kind, id) => v.cats.push({ id, kind, phi: ARM_REST }));
  for (const m of board.mach.values()) v.machs.push({ id: m.id, kind: m.kind, lane: m.lane, pos: m.pos, hp: m.hp, max: m.max, frozen: m.frozen, flash: 0, alpha: 1 });
  return v;
}

// value of a step list [[t, v], ...] (sorted) at time t, starting at v0
function stepAt(list, v0, t) {
  let v = v0;
  for (const [tt, vv] of list) {
    if (tt <= t) v = vv;
    else break;
  }
  return v;
}

export class Playback {
  // hdr: the `resolve` event; evs: its stage events; before/after: boards; S: scene
  constructor(hdr, evs, before, after, S) {
    this.dur = hdr.dur;
    this.S = S;
    this.before = before;
    this.after = after;
    this.cues = []; // {t, kind, ev, ...}  effects and sounds, fired once as the clock passes
    this.stages = {};
    for (const st of hdr.stages || []) this.stages[st.s] = st;
    const T = (s, f) => {
      const st = this.stages[s];
      return st ? st.at + st.dur * f : 0;
    };
    this.T = T;

    // ---- engineers
    this.engs = new Map();
    const eng = (pid) => {
      let e = this.engs.get(pid);
      if (!e) {
        const b = before.eng.get(pid) || after.eng.get(pid);
        if (!b) return null;
        e = { pid, x0: b.x, y0: b.y, carry0: before.eng.get(pid)?.carry ?? null, carry: [], move: null, poses: [], appear: !before.eng.has(pid) };
        this.engs.set(pid, e);
      }
      return e;
    };
    for (const pid of new Set([...before.eng.keys(), ...after.eng.keys()])) eng(pid);

    // ---- ground bombs: id -> [{kind, x, y, from, until, drop}]
    this.ground = new Map();
    for (const b of before.bombs.values()) this.ground.set(b.id, [{ kind: b.kind, x: b.x, y: b.y, from: -1, until: Infinity }]);
    const groundAdd = (id, kind, x, y, from, drop = false) => {
      const list = this.ground.get(id) || [];
      list.push({ kind, x, y, from, until: Infinity, drop });
      this.ground.set(id, list);
    };
    const groundTake = (id, t) => {
      const list = this.ground.get(id);
      if (!list) return;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].until === Infinity) {
          list[i].until = t;
          return;
        }
      }
    };

    // ---- flights: bombs in the air {kind, from:[x,y,z], to:[x,y,z], t0, t1, h, then?}
    this.flights = [];

    // ---- catapults
    this.cats = [];
    const ncat = Math.max(before.cats.length, after.cats.length, S.keep.catapults.length);
    for (let i = 0; i < ncat; i++) this.cats[i] = { kind0: before.cats[i] ?? null, load: [], swings: [] };

    // ---- machines
    this.machs = new Map();
    for (const m of before.mach.values()) this.machs.set(m.id, { id: m.id, kind: m.kind, lane: m.lane, pos0: m.pos, hp0: m.hp, max: m.max, frozen0: m.frozen, hp: [], frozen: [], moves: [], from: -1, until: Infinity, flashes: [], stall: null });
    this.wall = [];
    this.shots = []; // fired projectiles

    const handZ = (x, y) => S.standZ(x, y) + 0.95;
    let grabIdx = 0;
    let bombIdx = 0;
    for (const ev of evs) {
      switch (ev.e) {
        case 'throw': {
          const e = eng(ev.pid);
          const t0 = T('throw', THROW_GO);
          const t1 = T('throw', THROW_LAND);
          if (e) {
            e.carry.push([t0, null]);
            e.poses.push({ pose: 'throw', t0: T('throw', 0), t1: T('throw', 0.3) });
          }
          const caught = ev.result === 'caught';
          const [tx, ty] = ev.to;
          const [fx, fy] = ev.from;
          const dist = Math.abs(tx - fx) + Math.abs(ty - fy);
          const fl = {
            kind: ev.kind,
            from: [fx, fy, handZ(fx, fy)],
            to: [tx, ty, caught ? handZ(tx, ty) : S.topZ(tx, ty)],
            t0,
            t1,
            h: 0.9 + dist * 0.35,
          };
          this.flights.push(fl);
          this.cues.push({ t: t0, kind: 'throw', ev });
          if (caught) {
            const c = eng(ev.by);
            if (c) {
              c.carry.push([t1, ev.kind]);
              c.poses.push({ pose: 'reach', t0: t1 - 0.12, t1: t1 + 0.15 });
            }
            this.cues.push({ t: t1, kind: 'catch', ev });
          } else {
            const [ax, ay] = ev.at;
            const t2 = T('throw', THROW_SETTLE);
            if (ax !== tx || ay !== ty) {
              this.flights.push({ kind: ev.kind, from: [tx, ty, S.topZ(tx, ty)], to: [ax, ay, S.topZ(ax, ay)], t0: t1, t1: t2, h: 0.35 });
              groundAdd(ev.bomb, ev.kind, ax, ay, t2);
            } else groundAdd(ev.bomb, ev.kind, ax, ay, t1);
            this.cues.push({ t: t1, kind: 'land', ev });
          }
          break;
        }
        case 'move': {
          const e = eng(ev.pid);
          if (!e) break;
          const pts = [ev.from, ...(ev.path || [])];
          e.move = { pts, ok: ev.result === 'ok', t0: T('move', 0), t1: T('move', 1) };
          if (ev.result !== 'ok') this.cues.push({ t: T('move', 0.45), kind: 'bump', ev });
          else this.cues.push({ t: T('move', 0.05), kind: 'step', ev });
          break;
        }
        case 'pickup': {
          const e = eng(ev.pid);
          const tg = T('grab', GRAB_HIT);
          const stagger = 0;
          if (e) e.poses.push({ pose: 'reach', t0: T('grab', 0.05), t1: T('grab', 0.7) });
          if (ev.result === 'ok') {
            groundTake(ev.bomb, T('grab', 0.18) + stagger);
            const [bx, by] = ev.at;
            const p = this.engPosAtStart(ev.pid, 'grab');
            this.flights.push({ kind: ev.kind, from: [bx, by, S.topZ(bx, by)], to: [p[0], p[1], handZ(p[0], p[1])], t0: T('grab', 0.18), t1: tg, h: 0.45 });
            if (e) e.carry.push([tg, ev.kind]);
            this.cues.push({ t: tg, kind: 'pickup', ev });
          } else this.cues.push({ t: tg, kind: 'fizzle', ev, at: ev.at });
          grabIdx++;
          break;
        }
        case 'load': {
          const e = eng(ev.pid);
          const tg = T('grab', GRAB_HIT);
          const cat = S.catapult(ev.cat);
          if (e) e.poses.push({ pose: 'reach', t0: T('grab', 0.05), t1: T('grab', 0.7) });
          if (ev.result === 'ok' && cat) {
            const p = this.engPosAtStart(ev.pid, 'grab');
            if (e) e.carry.push([T('grab', 0.15), null]);
            this.flights.push({ kind: ev.kind, from: [p[0], p[1], handZ(p[0], p[1])], to: [cat.x, cat.y, 1.25], t0: T('grab', 0.15), t1: tg, h: 0.5 });
            if (this.cats[ev.cat]) this.cats[ev.cat].load.push([tg, ev.kind]);
            this.cues.push({ t: tg, kind: 'load', ev });
          } else this.cues.push({ t: tg, kind: 'fizzle', ev, at: cat ? [cat.x, cat.y] : null, z: 1.3 });
          grabIdx++;
          break;
        }
        case 'fire': {
          const c = this.cats[ev.cat];
          const tf = T('fire', FIRE_GO);
          const th = T('fire', FIRE_HIT);
          const e = eng(ev.pid);
          if (e) e.poses.push({ pose: 'reach', t0: T('fire', 0), t1: T('fire', 0.35) });
          if (ev.result === 'empty') {
            if (c) c.swings.push([tf, 0.25]);
            this.cues.push({ t: tf, kind: 'fizzle', ev, at: this.catXY(ev.cat), z: 1.4 });
            break;
          }
          if (c) {
            c.load.push([tf, null]);
            c.swings.push([tf, 1]);
          }
          const lane = ev.lane ?? S.laneOfCat(ev.cat)?.id ?? ev.cat;
          const L = S.keep.lanes[lane];
          // where it comes down: the first hit machine, else the middle / far end of the lane
          let target = L ? L.len - 1 : 3;
          const hits = ev.hits || [];
          if (hits.length) {
            const ps = hits.map((h) => this.machs.get(h.id)?.pos0).filter((v) => v !== undefined);
            if (ps.length) target = ev.kind === 'keg' ? Math.min(...ps) : (Math.min(...ps) + Math.max(...ps)) / 2;
          } else if (ev.result === 'wasted' && L) target = L.len * 0.6;
          const cat = S.catapult(ev.cat);
          const [lx, ly] = S.lanePt(lane, target);
          const shot = { kind: ev.kind, lane, target, from: [cat?.x ?? 0, cat?.y ?? 0, 1.95], to: [lx, ly, -0.1], t0: tf + 0.06, t1: th, h: 1.6 + target * 0.18, ev };
          this.shots.push(shot);
          this.cues.push({ t: tf, kind: 'fire', ev });
          this.cues.push({ t: th, kind: 'impact', ev, shot });
          for (const h of hits) {
            const m = this.machs.get(h.id);
            if (!m) continue;
            const tt = th + (ev.kind === 'grapeshot' ? Math.abs((m.pos0 ?? 0) - target) * 0.03 : 0);
            m.hp.push([tt, h.hp]);
            m.frozen.push([tt, h.frozen]);
            m.flashes.push(tt);
            if (h.killed) m.until = tt;
            this.cues.push({ t: tt, kind: h.killed ? 'kill' : 'hit', ev, hit: h, m });
          }
          break;
        }
        case 'advance': {
          const m = this.machs.get(ev.id);
          if (m) m.moves.push({ from: ev.from, to: ev.to, t0: T('machines', 0), t1: T('machines', MACH_MOVE) });
          break;
        }
        case 'stall': {
          const m = this.machs.get(ev.id);
          if (m) {
            m.stall = T('machines', 0.1);
            m.frozen.push([T('machines', 0.35), ev.frozen]);
          }
          this.cues.push({ t: T('machines', 0.2), kind: 'stall', ev });
          break;
        }
        case 'wall': {
          const m = this.machs.get(ev.id);
          const tw = T('machines', WALL_HIT);
          if (m) {
            m.moves.push({ from: ev.from, to: -0.75, t0: T('machines', 0), t1: tw });
            m.until = tw;
          }
          this.wall.push([tw, ev.wall]);
          this.cues.push({ t: tw, kind: 'wall', ev });
          break;
        }
        case 'spawn': {
          const t0 = T('machines', SPAWN_AT);
          const a = after.mach.get(ev.id);
          this.machs.set(ev.id, { id: ev.id, kind: ev.kind, lane: ev.lane, pos0: ev.pos, hp0: ev.hp, max: a?.max ?? ev.hp, frozen0: 0, hp: [], frozen: [], moves: [], from: t0, until: Infinity, flashes: [], stall: null, spawn: true });
          this.cues.push({ t: t0, kind: 'spawn', ev });
          break;
        }
        case 'bomb': {
          const t0 = T('machines', BOMB_AT) + bombIdx * 0.05;
          bombIdx++;
          groundAdd(ev.id, ev.kind, ev.x, ev.y, t0, true);
          this.cues.push({ t: t0 + 0.25, kind: 'drop', ev });
          break;
        }
      }
    }
    for (const e of this.engs.values()) e.carry.sort((a, b) => a[0] - b[0]);
    for (const c of this.cats) c.load.sort((a, b) => a[0] - b[0]);
    for (const m of this.machs.values()) {
      m.hp.sort((a, b) => a[0] - b[0]);
      m.frozen.sort((a, b) => a[0] - b[0]);
    }
    this.cues.sort((a, b) => a.t - b.t);
    this.cueIdx = 0;
    void grabIdx;
  }

  catXY(id) {
    const c = this.S.catapult(id);
    return c ? [c.x, c.y] : null;
  }

  // where an engineer stands when stage `s` begins (after moves if s is after the move stage)
  engPosAtStart(pid, s) {
    const e = this.engs.get(pid);
    if (!e) return [0, 0];
    if (e.move && e.move.ok && s !== 'throw' && s !== 'move') return e.move.pts[e.move.pts.length - 1];
    return [e.x0, e.y0];
  }

  // cues due by time t (each returned once)
  due(t) {
    const out = [];
    while (this.cueIdx < this.cues.length && this.cues[this.cueIdx].t <= t) out.push(this.cues[this.cueIdx++]);
    return out;
  }

  sample(t) {
    const S = this.S;
    const v = { engs: [], bombs: [], flying: [], cats: [], machs: [], wall: stepAt(this.wall, this.before.wall, t), shots: [] };

    // engineers
    for (const e of this.engs.values()) {
      let x = e.x0;
      let y = e.y0;
      let z = S.standZ(x, y);
      let walk = -1;
      let face = 0;
      let key = null;
      const m = e.move;
      if (m && t >= m.t0) {
        const u = clamp01((t - m.t0) / (m.t1 - m.t0));
        const pts = m.pts;
        if (m.ok && pts.length > 1) {
          const segs = pts.length - 1;
          const f = ease(u) * segs;
          const i = Math.min(segs - 1, Math.floor(f));
          const k = f - i;
          const [ax, ay] = pts[i];
          const [bx, by] = pts[i + 1];
          x = ax + (bx - ax) * k;
          y = ay + (by - ay) * k;
          z = S.standZ(ax, ay) + (S.standZ(bx, by) - S.standZ(ax, ay)) * k;
          if (u < 1) {
            walk = f;
            face = bx - ax - (by - ay);
            // stepping onto something at least as high: draw with the destination's depth
            if (S.standZ(bx, by) >= S.standZ(ax, ay)) key = Math.max(ax + ay, bx + by) + (k > 0.5 ? 0 : -0.5);
          }
        } else if (!m.ok && pts.length > 1) {
          // bump: lunge toward the first step and back
          const [bx, by] = pts[1];
          const b = Math.sin(u * Math.PI) * 0.36;
          x = e.x0 + (bx - e.x0) * b;
          y = e.y0 + (by - e.y0) * b;
          if (u < 1) {
            walk = u * 1.5;
            face = bx - e.x0 - (by - e.y0);
          }
        }
      }
      let pose = 'idle';
      let poseK = 0;
      for (const p of e.poses) {
        if (t >= p.t0 && t <= p.t1) {
          pose = p.pose;
          poseK = (t - p.t0) / (p.t1 - p.t0);
        }
      }
      const carry = stepAt(e.carry, e.carry0, t);
      v.engs.push({ pid: e.pid, x, y, z, carry, walk, face, pose, poseK, key, appear: e.appear });
    }

    // ground bombs
    for (const [id, list] of this.ground) {
      for (const g of list) {
        if (t < g.from || t >= g.until) continue;
        let z = S.topZ(g.x, g.y);
        let a = 1;
        if (g.drop) {
          const u = clamp01((t - g.from) / 0.3);
          z += (1 - u * u) * 3;
          a = Math.min(1, u * 3);
        }
        v.bombs.push({ id, kind: g.kind, x: g.x, y: g.y, z, a });
      }
    }

    // flights
    for (const f of this.flights) {
      if (t < f.t0 || t >= f.t1) continue;
      const u = (t - f.t0) / (f.t1 - f.t0);
      v.flying.push({
        kind: f.kind,
        x: f.from[0] + (f.to[0] - f.from[0]) * u,
        y: f.from[1] + (f.to[1] - f.from[1]) * u,
        z: f.from[2] + (f.to[2] - f.from[2]) * u + f.h * 4 * u * (1 - u),
        gx: f.from[0] + (f.to[0] - f.from[0]) * u,
        gy: f.from[1] + (f.to[1] - f.from[1]) * u,
        spin: u * 9,
      });
    }

    // catapults
    this.cats.forEach((c, id) => {
      const kind = stepAt(c.load, c.kind0, t);
      let phi = ARM_REST;
      for (const [ts, power] of c.swings) {
        const d = t - ts;
        if (d < 0) continue;
        const top = ARM_REST + (ARM_TOP - ARM_REST) * power;
        if (d < 0.16) phi = ARM_REST + (top - ARM_REST) * ease(d / 0.16);
        else if (d < 0.75) phi = top - (top - ARM_REST) * ease((d - 0.16) / 0.59);
      }
      v.cats.push({ id, kind, phi });
    });

    // shots in the air
    for (const s of this.shots) {
      if (t < s.t0 || t >= s.t1) continue;
      const u = (t - s.t0) / (s.t1 - s.t0);
      v.shots.push({
        kind: s.kind,
        x: s.from[0] + (s.to[0] - s.from[0]) * u,
        y: s.from[1] + (s.to[1] - s.from[1]) * u,
        z: s.from[2] + (s.to[2] - s.from[2]) * u + s.h * 4 * u * (1 - u),
        spin: u * 12,
      });
    }

    // machines
    for (const m of this.machs.values()) {
      if (t < m.from || t >= m.until) continue;
      let pos = m.pos0;
      let hop = 0;
      for (const mv of m.moves) {
        if (t < mv.t0) break;
        const u = clamp01((t - mv.t0) / (mv.t1 - mv.t0));
        pos = mv.from + (mv.to - mv.from) * ease(u);
        if (u < 1) hop = Math.abs(Math.sin(u * Math.PI * Math.max(1, Math.abs(mv.to - mv.from)))) * 0.12;
      }
      let flash = 0;
      for (const ft of m.flashes) if (t >= ft && t - ft < 0.4) flash = 1 - (t - ft) / 0.4;
      const shiver = m.stall !== null && t >= m.stall && t < m.stall + 0.4 ? Math.sin((t - m.stall) * 60) * 0.03 : 0;
      v.machs.push({
        id: m.id,
        kind: m.kind,
        lane: m.lane,
        pos: pos + shiver,
        hop,
        hp: stepAt(m.hp, m.hp0, t),
        max: m.max,
        frozen: stepAt(m.frozen, m.frozen0, t),
        flash,
        alpha: m.spawn ? clamp01((t - m.from) / 0.35) : 1,
        rise: m.spawn ? 1 - clamp01((t - m.from) / 0.35) : 0,
      });
    }
    return v;
  }
}
