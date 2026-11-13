// Board state and resolve playback.
//
// A snap always holds the end state. A `resolve` batch (header + slot and machine events)
// says how the board got there: every player's queue plays slot by slot (each slot in its
// stages throw, move, grab, fire), then the machines move once. Playback rebuilds the turn as
// per-entity timelines starting from the board the TV showed before, and sample(t) gives the
// scene at playback time t (game seconds since the batch). Past `dur` the caller shows the
// snap's board itself, so the end state is always exactly the server's.
//
// It also keeps a record of the turn for the queue strip: per player and slot, what came of
// the action (marks), and which slot is playing at time t.

const THROW_GO = 0.06;
const THROW_LAND = 0.8;
const THROW_SETTLE = 0.97;
const GRAB_HIT = 0.5;
const FIRE_GO = 0.06;
const FIRE_HIT = 0.75;
const MACH_MOVE = 0.62;
const WALL_HIT = 0.5;
const SPAWN_AT = 0.5;
const BOMB_AT = 0.62;

export const ARM_REST = -0.28;
const ARM_TOP = 2.35;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t) => t * t * (3 - 2 * t);

export const FIZZLE_TEXT = {
  blocked: 'Blocked',
  no_bomb: 'Nothing there',
  hands_full: 'Hands full',
  empty_hands: 'Empty hands',
  no_target: 'No target',
  no_catapult: 'No catapult',
  catapult_full: 'Catapult full',
  catapult_empty: 'Catapult empty',
  gone: 'Gone',
  full: 'Catapult full',
};

// the same, short enough for a queue slot
const FIZZLE_SHORT = {
  blocked: 'Blocked',
  no_bomb: 'No bomb',
  hands_full: 'Full hands',
  empty_hands: 'No bomb',
  no_target: 'No line',
  no_catapult: 'No catapult',
  catapult_full: 'Full',
  catapult_empty: 'Empty',
  gone: 'Gone',
  full: 'Full',
};

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
  // hdr: the `resolve` event; evs: its events; before/after: boards; S: scene
  constructor(hdr, evs, before, after, S) {
    this.dur = hdr.dur;
    this.S = S;
    this.before = before;
    this.after = after;
    this.cues = []; // {t, kind, ev, ...}  effects and sounds, fired once as the clock passes
    this.marks = []; // {pid, slot, t, kind: ok|warn|fizzle, text, prio}
    this.slots = (hdr.slots || []).slice().sort((a, b) => a.at - b.at);
    this.mstage = hdr.machines || null;
    const slotBy = new Map(this.slots.map((s) => [s.slot, s]));
    // time of fraction f through the stage an event belongs to
    const T = (ev, f, s = ev.s) => {
      if (s === 'machines') {
        const m = this.mstage;
        return m ? m.at + m.dur * f : this.dur * 0.8;
      }
      const sl = slotBy.get(ev.slot);
      const st = sl?.stages?.find((x) => x.s === s) || sl;
      return st ? st.at + st.dur * f : 0;
    };
    for (const sl of this.slots) this.cues.push({ t: sl.at, kind: 'step', slot: sl.slot });
    if (this.mstage) this.cues.push({ t: this.mstage.at, kind: 'machines' });
    const mark = (pid, slot, t, kind, text, prio = 2) => this.marks.push({ pid, slot, t, kind, text, prio });

    // ---- engineers
    this.engs = new Map();
    const eng = (pid) => {
      let e = this.engs.get(pid);
      if (!e) {
        const b = before.eng.get(pid) || after.eng.get(pid);
        if (!b) return null;
        e = { pid, x0: b.x, y0: b.y, carry0: before.eng.get(pid)?.carry ?? null, carry: [], moves: [], poses: [], appear: !before.eng.has(pid) };
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

    this.flights = []; // bombs in the air {kind, from:[x,y,z], to:[x,y,z], t0, t1, h}
    this.cats = [];
    const ncat = Math.max(before.cats.length, after.cats.length, S.keep.catapults.length);
    for (let i = 0; i < ncat; i++) this.cats[i] = { kind0: before.cats[i] ?? null, load: [], swings: [] };
    this.machs = new Map();
    for (const m of before.mach.values()) this.machs.set(m.id, { id: m.id, kind: m.kind, lane: m.lane, pos0: m.pos, hp0: m.hp, max: m.max, frozen0: m.frozen, hp: [], frozen: [], moves: [], from: -1, until: Infinity, flashes: [], stall: null });
    this.wall = [];
    this.shots = [];

    const handZ = (x, y) => S.standZ(x, y) + 0.95;
    let bombIdx = 0;
    // events arrive in time order, so an engineer's position at an event's time is known from
    // the moves recorded so far
    for (const ev of evs) {
      switch (ev.e) {
        case 'fizzle': {
          const t = T(ev, 0.5);
          this.cues.push({ t, kind: 'fizzle', ev, at: ev.at });
          mark(ev.pid, ev.slot, t, 'fizzle', FIZZLE_SHORT[ev.reason] || 'Fizzle', 3);
          const e = eng(ev.pid);
          if (e) e.poses.push({ pose: 'shrug', t0: T(ev, 0.1), t1: T(ev, 0.9) });
          break;
        }
        case 'throw': {
          const e = eng(ev.pid);
          const t0 = T(ev, THROW_GO);
          const t1 = T(ev, THROW_LAND);
          if (e) {
            e.carry.push([t0, null]);
            e.poses.push({ pose: 'throw', t0: T(ev, 0), t1: T(ev, 0.3) });
          }
          const caught = ev.result === 'caught';
          const blocked = ev.result === 'blocked';
          // `to` is where the flight ends (a catcher/blocker's cell or the landing cell); `at` is where the bomb rests
          const [tx, ty] = ev.to;
          const [fx, fy] = ev.from;
          const dist = Math.abs(tx - fx) + Math.abs(ty - fy);
          this.flights.push({ kind: ev.kind, from: [fx, fy, handZ(fx, fy)], to: [tx, ty, caught || blocked ? handZ(tx, ty) : S.topZ(tx, ty)], t0, t1, h: 0.9 + dist * 0.3 });
          this.cues.push({ t: t0, kind: 'throw', ev });
          const [ax, ay] = ev.at;
          const t2 = T(ev, THROW_SETTLE);
          if (caught) {
            const c = eng(ev.by);
            if (c) {
              c.carry.push([t1, ev.kind]);
              c.poses.push({ pose: 'reach', t0: t1 - 0.1, t1: t1 + 0.15 });
            }
            this.cues.push({ t: t1, kind: 'catch', ev });
            mark(ev.pid, ev.slot, t1, 'ok', 'Caught');
            mark(ev.by, ev.slot, t1, 'ok', 'Catch!', 1);
          } else if (blocked) {
            // bounces off the engineer's full hands and drops to the ground
            this.flights.push({ kind: ev.kind, from: [tx, ty, handZ(tx, ty)], to: [ax, ay, S.topZ(ax, ay)], t0: t1, t1: t2, h: ax !== tx || ay !== ty ? 0.7 : 0.55 });
            groundAdd(ev.bomb, ev.kind, ax, ay, t2);
            this.cues.push({ t: t1, kind: 'blocked', ev });
            mark(ev.pid, ev.slot, t1, 'warn', 'Blocked');
          } else {
            if (ax !== tx || ay !== ty) {
              this.flights.push({ kind: ev.kind, from: [tx, ty, S.topZ(tx, ty)], to: [ax, ay, S.topZ(ax, ay)], t0: t1, t1: t2, h: 0.35 });
              groundAdd(ev.bomb, ev.kind, ax, ay, t2);
            } else groundAdd(ev.bomb, ev.kind, ax, ay, t1);
            this.cues.push({ t: t1, kind: 'land', ev });
            mark(ev.pid, ev.slot, t1, 'ok', 'Landed');
          }
          break;
        }
        case 'move': {
          const e = eng(ev.pid);
          const ok = ev.result === 'ok';
          const t0 = T(ev, 0);
          const t1 = T(ev, 1);
          if (e) e.moves.push({ from: ev.from, to: ev.to, ok, t0, t1 });
          if (!ok) {
            this.cues.push({ t: T(ev, 0.45), kind: 'bump', ev });
            mark(ev.pid, ev.slot, T(ev, 0.45), 'warn', 'Bump!');
          } else mark(ev.pid, ev.slot, t1, 'ok', '');
          break;
        }
        case 'pickup': {
          const e = eng(ev.pid);
          const tg = T(ev, GRAB_HIT);
          if (e) e.poses.push({ pose: 'reach', t0: T(ev, 0.05), t1: T(ev, 0.7) });
          if (ev.result === 'ok') {
            groundTake(ev.bomb, T(ev, 0.18));
            const [bx, by] = ev.at;
            const p = this.engPos(ev.pid, T(ev, 0));
            this.flights.push({ kind: ev.kind, from: [bx, by, S.topZ(bx, by)], to: [p[0], p[1], handZ(p[0], p[1])], t0: T(ev, 0.18), t1: tg, h: 0.45 });
            if (e) e.carry.push([tg, ev.kind]);
            this.cues.push({ t: tg, kind: 'pickup', ev, p });
            mark(ev.pid, ev.slot, tg, 'ok', 'Got it');
          } else {
            this.cues.push({ t: tg, kind: 'fizzle', ev, at: ev.at });
            if (ev.result === 'contested') mark(ev.pid, ev.slot, tg, 'warn', 'Clash!');
            else mark(ev.pid, ev.slot, tg, 'fizzle', FIZZLE_SHORT[ev.result] || 'Fizzle', 3);
          }
          break;
        }
        case 'load': {
          const e = eng(ev.pid);
          const tg = T(ev, GRAB_HIT);
          const cat = S.catapult(ev.cat);
          if (e) e.poses.push({ pose: 'reach', t0: T(ev, 0.05), t1: T(ev, 0.7) });
          if (ev.result === 'ok' && cat) {
            const p = this.engPos(ev.pid, T(ev, 0));
            if (e) e.carry.push([T(ev, 0.15), null]);
            this.flights.push({ kind: ev.kind, from: [p[0], p[1], handZ(p[0], p[1])], to: [cat.x, cat.y, 1.25], t0: T(ev, 0.15), t1: tg, h: 0.5 });
            if (this.cats[ev.cat]) this.cats[ev.cat].load.push([tg, ev.kind]);
            this.cues.push({ t: tg, kind: 'load', ev });
            mark(ev.pid, ev.slot, tg, 'ok', 'Loaded');
          } else {
            this.cues.push({ t: tg, kind: 'fizzle', ev, at: cat ? [cat.x, cat.y] : null, z: 1.3 });
            if (ev.result === 'contested') mark(ev.pid, ev.slot, tg, 'warn', 'Clash!');
            else mark(ev.pid, ev.slot, tg, 'fizzle', FIZZLE_SHORT[ev.result] || 'Fizzle', 3);
          }
          break;
        }
        case 'fire': {
          const c = this.cats[ev.cat];
          const tf = T(ev, FIRE_GO);
          const th = T(ev, FIRE_HIT);
          const e = eng(ev.pid);
          if (e) e.poses.push({ pose: 'reach', t0: T(ev, 0), t1: T(ev, 0.35) });
          if (ev.result === 'empty') {
            if (c) c.swings.push([tf, 0.25]);
            this.cues.push({ t: tf, kind: 'fizzle', ev, at: this.catXY(ev.cat), z: 1.4 });
            mark(ev.pid, ev.slot, tf, 'fizzle', 'Empty', 3);
            break;
          }
          if (c) {
            c.load.push([tf, null]);
            c.swings.push([tf, 1]);
          }
          const lane = ev.lane ?? S.laneOfCat(ev.cat)?.id ?? ev.cat;
          const L = S.keep.lanes[lane];
          let target = L ? L.len - 1 : 2;
          const hits = ev.hits || [];
          if (hits.length) {
            const ps = hits.map((h) => this.machs.get(h.id)?.pos0).filter((v) => v !== undefined);
            if (ps.length) target = ev.kind === 'keg' ? Math.min(...ps) : (Math.min(...ps) + Math.max(...ps)) / 2;
          } else if (ev.result === 'wasted' && L) target = (L.len - 1) * 0.6;
          const cat = S.catapult(ev.cat);
          const [lx, ly] = S.lanePt(lane, target);
          const shot = { kind: ev.kind, lane, target, from: [cat?.x ?? 0, cat?.y ?? 0, 1.95], to: [lx, ly, -0.1], t0: tf + 0.04, t1: th, h: 1.3 + target * 0.25, ev };
          this.shots.push(shot);
          this.cues.push({ t: tf, kind: 'fire', ev });
          this.cues.push({ t: th, kind: 'impact', ev, shot });
          let kills = 0;
          for (const h of hits) {
            const m = this.machs.get(h.id);
            if (!m) continue;
            const tt = th + (ev.kind === 'grapeshot' ? Math.abs((m.pos0 ?? 0) - target) * 0.03 : 0);
            m.hp.push([tt, h.hp]);
            m.frozen.push([tt, h.frozen]);
            m.flashes.push(tt);
            if (h.killed) {
              m.until = tt;
              kills++;
            }
            this.cues.push({ t: tt, kind: h.killed ? 'kill' : 'hit', ev, hit: h, m });
          }
          if (ev.result === 'wasted') mark(ev.pid, ev.slot, th, 'warn', 'Wasted');
          else mark(ev.pid, ev.slot, th, 'ok', kills ? (kills > 1 ? `${kills} kills` : 'Kill!') : ev.kind === 'stopwatch' ? 'Frozen' : 'Hit');
          break;
        }
        case 'advance': {
          const m = this.machs.get(ev.id);
          if (m) m.moves.push({ from: ev.from, to: ev.to, t0: T(ev, 0), t1: T(ev, MACH_MOVE) });
          break;
        }
        case 'stall': {
          const m = this.machs.get(ev.id);
          if (m) {
            m.stall = T(ev, 0.1);
            m.frozen.push([T(ev, 0.35), ev.frozen]);
          }
          this.cues.push({ t: T(ev, 0.2), kind: 'stall', ev });
          break;
        }
        case 'wall': {
          const m = this.machs.get(ev.id);
          const tw = T(ev, WALL_HIT);
          if (m) {
            m.moves.push({ from: ev.from, to: -0.75, t0: T(ev, 0), t1: tw });
            m.until = tw;
          }
          this.wall.push([tw, ev.wall]);
          this.cues.push({ t: tw, kind: 'wall', ev });
          break;
        }
        case 'spawn': {
          const t0 = T(ev, SPAWN_AT);
          const a = after.mach.get(ev.id);
          this.machs.set(ev.id, { id: ev.id, kind: ev.kind, lane: ev.lane, pos0: ev.pos, hp0: ev.hp, max: a?.max ?? ev.hp, frozen0: 0, hp: [], frozen: [], moves: [], from: t0, until: Infinity, flashes: [], stall: null, spawn: true });
          this.cues.push({ t: t0, kind: 'spawn', ev });
          break;
        }
        case 'bomb': {
          const t0 = T(ev, BOMB_AT) + bombIdx * 0.05;
          bombIdx++;
          groundAdd(ev.id, ev.kind, ev.x, ev.y, t0, true);
          this.cues.push({ t: t0 + 0.25, kind: 'drop', ev });
          break;
        }
      }
    }
    for (const e of this.engs.values()) {
      e.carry.sort((a, b) => a[0] - b[0]);
      e.moves.sort((a, b) => a.t0 - b.t0);
    }
    for (const c of this.cats) c.load.sort((a, b) => a[0] - b[0]);
    for (const m of this.machs.values()) {
      m.hp.sort((a, b) => a[0] - b[0]);
      m.frozen.sort((a, b) => a[0] - b[0]);
    }
    this.cues.sort((a, b) => a.t - b.t);
    this.marks.sort((a, b) => a.t - b.t);
    this.cueIdx = 0;
  }

  catXY(id) {
    const c = this.S.catapult(id);
    return c ? [c.x, c.y] : null;
  }

  // where an engineer stands at time t (after the moves finished by then)
  engPos(pid, t) {
    const e = this.engs.get(pid);
    if (!e) return [0, 0];
    let p = [e.x0, e.y0];
    for (const m of e.moves) if (m.ok && m.t1 <= t + 1e-6) p = m.to;
    return p;
  }

  // which slot is playing at t: { slot, idx } or { machines: true } or null
  stepAt(t) {
    if (this.mstage && t >= this.mstage.at) return { machines: true };
    let cur = null;
    this.slots.forEach((s, i) => {
      if (t >= s.at) cur = { slot: s.slot, idx: i };
    });
    return cur;
  }

  // marks recorded by time t: Map "pid|slot" -> mark (the most telling one)
  marksAt(t) {
    const out = new Map();
    for (const m of this.marks) {
      if (m.t > t) break;
      const k = `${m.pid}|${m.slot}`;
      const o = out.get(k);
      if (!o || m.prio >= o.prio) out.set(k, m);
    }
    return out;
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
      for (const m of e.moves) {
        if (t < m.t0) break;
        const [ax, ay] = m.from;
        const [bx, by] = m.to;
        const u = clamp01((t - m.t0) / (m.t1 - m.t0));
        if (m.ok) {
          const k = ease(u);
          x = ax + (bx - ax) * k;
          y = ay + (by - ay) * k;
          z = S.standZ(ax, ay) + (S.standZ(bx, by) - S.standZ(ax, ay)) * k;
          if (u < 1) {
            walk = u * 1.5;
            face = bx - ax - (by - ay);
            if (S.standZ(bx, by) >= S.standZ(ax, ay)) key = Math.max(ax + ay, bx + by) + (k > 0.5 ? 0 : -0.5);
          }
        } else {
          // bump: lunge toward the cell and back
          const b = Math.sin(u * Math.PI) * 0.36;
          x = ax + (bx - ax) * b;
          y = ay + (by - ay) * b;
          z = S.standZ(ax, ay);
          if (u < 1) {
            walk = u * 1.5;
            face = bx - ax - (by - ay);
          }
        }
      }
      let pose = 'idle';
      let poseK = 0;
      for (const p of e.poses) {
        if (t >= p.t0 && t <= p.t1) {
          pose = p.pose === 'shrug' ? 'reach' : p.pose;
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
        if (d < 0.14) phi = ARM_REST + (top - ARM_REST) * ease(d / 0.14);
        else if (d < 0.6) phi = top - (top - ARM_REST) * ease((d - 0.14) / 0.46);
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
