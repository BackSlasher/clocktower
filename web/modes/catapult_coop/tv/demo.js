// Dev-only showcase: /tv?demo=plan|resolve|break|won|lost|boss[&n=1..4] feeds synthetic room and
// snap messages through the normal handlers, so every screen can be looked at without playing
// to it. Uses the real setup (keeps + defs) from the server; the interior layouts below are
// sample drawings in the server's notation (W wall, C catapult, = raised floor, . floor,
// # crate, S stairs). `ctDebug.game.freezeT = 1.35` holds a resolve playback at 1.35 s
// (the middle of step 2 in the resolve scene).

const ART = [
    'WWWCWWCWW',
    'W=======S',
    'W=.o.....',
    'C=...==*.',
    'W=...=S.o',
    'W=.......',
    'C=....#..',
    'W=....o..',
    'WS.......',
];

function layoutFrom(rows, id) {
  const cells = rows.map((row) =>
    [...row].map((ch) => {
      switch (ch) {
        case 'W':
          return { kind: 'block', h: 1 };
        case 'C':
          return { kind: 'catapult', h: 1 };
        case '=':
        case '*':
          return { kind: 'floor', h: 1 };
        case '#':
          return { kind: 'block', h: 0 };
        case 'S':
          return { kind: 'stairs', h: 0 };
        default:
          return { kind: 'floor', h: 0 };
      }
    }),
  );
  return { id, w: rows[0].length, h: rows.length, cells, spawns: [] };
}

const mv = (dx, dy) => ({ a: 'move', dx, dy });
const th = (dx, dy) => ({ a: 'throw', dx, dy });
const W8 = { a: 'wait' };

export function startDemo(kind, setup, deliver) {
  const { map, defs } = setup;
  const N = Math.min(4, Math.max(1, Number(new URLSearchParams(location.search).get('n')) || 4));
  const keep = map.keeps[0];
  const lay = layoutFrom(ART, 'platform');
  const names = ['Ada', 'Brunel', 'Tesla', 'Babbage', 'Lovelace-Byr', 'Watt', 'Faraday', 'Stephenson'];
  const colors = ['#e0a030', '#4fb39a', '#d1594a', '#6a8cff', '#c06adf', '#8fd14f', '#f0f0f0', '#ff8fb0'];
  const levels = defs.levels?.length || 6;
  const level = kind === 'boss' ? levels : kind === 'break' ? 3 : 4;
  const phase = kind === 'resolve' || kind === 'boss' ? 'plan' : kind;
  const cats = keep.catapults;
  const lane = (i) => keep.lanes[i % keep.lanes.length];
  const far = (i) => lane(i).len - 1;

  // seats: three on the rampart, the rest in the courtyard
  const P = [[2, 1], [5, 1], [3, 5], [6, 5], [4, 7], [2, 6], [7, 7], [8, 8]];
  const carry = ['keg', null, 'stopwatch', 'grapeshot', null, 'keg', null, null];
  const players = names.slice(0, N).map((name, i) => ({ id: `p${i + 1}`, name, color: colors[i], connected: i !== 6, away: i === 6, ready: kind === 'break' && i % 2 === 0 }));

  // the queues (resolve scene: see the batch below)
  const Q = [
    { acts: [mv(1, 0), { a: 'load' }, { a: 'fire' }, W8], done: true },
    { acts: [W8, { a: 'pickup' }, mv(-1, 0)], done: true },
    { acts: [W8, th(0, -1), mv(1, 0)], done: true },
    { acts: [mv(0, -1), mv(0, -1), th(0, -1), W8], done: true },
    { acts: [mv(-1, 0), { a: 'pickup', dx: 0, dy: -1 }, th(-1, 0)], done: true },
    { acts: [mv(0, 1), W8, W8, W8], done: true },
    { acts: [], done: false },
    { acts: [mv(0, -1), mv(1, 0)], done: true },
  ];
  // the plan scene: queues being filled
  const QP = [
    { acts: [mv(1, 0), { a: 'load' }, { a: 'fire' }, W8], done: true },
    { acts: [{ a: 'pickup', dx: 0, dy: 1 }, th(-1, 0)], done: false },
    { acts: [th(0, -1), mv(1, 0), mv(0, -1)], done: true },
    { acts: [], done: false },
    { acts: [mv(-1, 0), mv(-1, 0), { a: 'pickup' }], done: false },
    { acts: [W8, W8, mv(0, 1), th(1, 0)], done: true },
    { acts: [], done: false },
    { acts: [mv(0, -1)], done: false },
  ];
  const plansOf = (q) => players.map((p, i) => ({ pid: p.id, acts: q[i].acts, done: q[i].done }));

  const end =
    kind === 'won' || kind === 'lost'
      ? {
          won: kind === 'won',
          level: kind === 'won' ? levels : 4,
          rounds: kind === 'won' ? 31 : 17,
          wall: kind === 'won' ? 5 : 0,
          time: 912.5,
          stats: Object.fromEntries(players.map((p, i) => [p.id, { throws: 30 - i * 3, catches: 12 + i, pickups: 20 - i, loads: 9 - i, fires: 8 - i, kills: 14 - i * 2, dmg: 22 - i * 3, steps: 120 + i * 9, bumps: i % 3, fizzles: (i * 5) % 9 }])),
          awards: [
            { pid: 'p1', title: 'Sharpshooter', detail: '14 kills' },
            { pid: 'p2', title: 'Safe Hands', detail: '13 catches' },
            { pid: 'p3', title: 'Bomb Lobber', detail: '24 throws' },
            { pid: 'p1', title: 'Loader', detail: '9 loads' },
            { pid: 'p4', title: 'Marathon', detail: '147 steps' },
            { pid: 'p2', title: 'Butterfingers', detail: '8 fizzles' },
          ],
        }
      : null;
  const room = { t: 'room', mode: 'catapult_coop', phase, host: 'p1', keep: keep.id, layout: lay, level, levels, round: 4, players, end };

  const machines =
    kind === 'boss'
      ? [
          { id: 1, kind: 'baron', lane: 1, pos: far(1), hp: 7, max: 9, frozen: 0 },
          { id: 2, kind: 'scrap', lane: 0, pos: 1, hp: 1, max: 1, frozen: 0 },
          { id: 3, kind: 'roach', lane: 3, pos: far(3), hp: 1, max: 1, frozen: 0 },
          { id: 4, kind: 'roach', lane: 3, pos: far(3), hp: 1, max: 1, frozen: 0 },
        ]
      : [
          { id: 1, kind: 'scrap', lane: 0, pos: 1, hp: 1, max: 1, frozen: 0 },
          { id: 2, kind: 'brute', lane: 1, pos: far(1), hp: 3, max: 4, frozen: 1 },
          { id: 3, kind: 'roach', lane: 2, pos: far(2), hp: 1, max: 1, frozen: 0 },
          { id: 4, kind: 'roach', lane: 2, pos: far(2), hp: 1, max: 1, frozen: 0 },
          { id: 5, kind: 'scrap', lane: 3, pos: 0, hp: 1, max: 1, frozen: 0 },
        ];
  const engineers = players.map((p, i) => ({ pid: p.id, x: P[i][0], y: P[i][1], carry: carry[i] ? { id: 100 + i, kind: carry[i] } : null }));
  const bombs = [
    { id: 1, kind: 'keg', x: 3, y: 2 },
    { id: 2, kind: 'grapeshot', x: 8, y: 4 },
    { id: 3, kind: 'stopwatch', x: 6, y: 7 },
  ];
  const catapults = cats.map((c) => ({ id: c.id, bomb: null }));
  const A = {
    t: 'snap', phase, time: 100, level, round: 4, left: kind === 'break' ? 5 : 14.4, untimed: false, wall: kind === 'lost' ? 0 : kind === 'boss' ? 4 : 11, wallMax: defs.wallHP,
    engineers, bombs, catapults, machines,
    incoming: [],
    plans: phase === 'plan' ? plansOf(kind === 'plan' ? QP : Q) : players.map((p) => ({ pid: p.id, acts: [], done: false })),
    ev: [],
  };

  const timers = [];
  const timeouts = [];
  const stop = () => {
    timers.forEach(clearInterval);
    timeouts.forEach(clearTimeout);
  };
  deliver(room);
  if (kind === 'break') deliver({ ...A, ev: [{ e: 'level_clear', level, wall: 11, heal: defs.breakHeal || 1 }] });
  else deliver(A);
  if (kind !== 'resolve' && kind !== 'boss') {
    let t = 100;
    timers.push(setInterval(() => deliver({ ...A, time: (t += 0.1), left: Math.max(0, A.left - (t - 100)) }), 100));
    return stop;
  }

  // resolve: every 6 s, the plan board then the turn's batch (see the queues Q above)
  const loopOnce = (time) => {
    deliver({ ...room, phase: 'plan' });
    deliver({ ...A, time, left: 0.4 });
    timeouts.push(
      setTimeout(() => {
        const T = { st: defs.stageTime || 0.35, at: (defs.resolveBase || 0.4) / 2 };
        const slots = [];
        const stage = (slot, ss) => {
          const s0 = T.at;
          const stages = ss.map((s) => {
            const r = { s, at: T.at, dur: T.st };
            T.at += T.st;
            return r;
          });
          slots.push({ slot, at: s0, dur: T.at - s0, stages });
        };
        stage(0, ['move']);
        stage(1, ['throw', 'move', 'grab']);
        stage(2, ['throw', 'move', 'fire']);
        const machinesAt = T.at;
        const dur = machinesAt + (defs.machineTime || 0.6) + (defs.resolveBase || 0.4) / 2;
        const pid = (i) => players[i]?.id;
        const ev = [{ e: 'resolve', level, round: 4, dur, slots, machines: { s: 'machines', at: machinesAt, dur: defs.machineTime || 0.6 } }];
        const engB = engineers.map((x) => ({ ...x }));
        const c0 = cats[0];
        // slot 1 (index 0): Ada steps onto the loading cell; Babbage climbs
        ev.push({ e: 'move', s: 'move', slot: 0, pid: pid(0), from: [2, 1], to: [3, 1], result: 'ok' });
        if (N > 3) ev.push({ e: 'move', s: 'move', slot: 0, pid: pid(3), from: [6, 5], to: [6, 4], result: 'ok' });
        // slot 2 (index 1): Tesla throws up the column at Ada, whose hands are full: blocked
        ev.push({ e: 'throw', s: 'throw', slot: 1, pid: pid(2), bomb: 102, kind: 'stopwatch', from: [3, 5], dir: [0, -1], to: [3, 1], result: 'blocked', by: pid(0), at: [3, 1] });
        if (N > 3) ev.push({ e: 'move', s: 'move', slot: 1, pid: pid(3), from: [6, 4], to: [6, 3], result: 'ok' });
        ev.push({ e: 'fizzle', s: 'grab', slot: 1, pid: pid(1), a: 'pickup', at: [5, 1], reason: 'no_bomb' });
        ev.push({ e: 'load', s: 'grab', slot: 1, pid: pid(0), cat: c0.id, bomb: 100, kind: 'keg', result: 'ok' });
        // slot 3 (index 2): Babbage throws up into the empty rampart; Brunel steps; Ada fires
        if (N > 3) ev.push({ e: 'throw', s: 'throw', slot: 2, pid: pid(3), bomb: 103, kind: 'grapeshot', from: [6, 3], dir: [0, -1], to: [6, 1], result: 'landed', at: [6, 1] });
        ev.push({ e: 'move', s: 'move', slot: 2, pid: pid(1), from: [5, 1], to: [4, 1], result: 'ok' });
        ev.push({ e: 'move', s: 'move', slot: 2, pid: pid(2), from: [3, 5], to: [4, 5], result: 'ok' });
        ev.push({ e: 'fire', s: 'fire', slot: 2, pid: pid(0), cat: c0.id, lane: c0.lane, bomb: 100, kind: 'keg', result: 'ok', hits: [{ id: 1, dmg: 2, hp: 0, killed: true, frozen: 0 }] });
        // machines
        ev.push({ e: 'stall', s: 'machines', id: 2, lane: 1, pos: far(1), frozen: 0 });
        ev.push({ e: 'advance', s: 'machines', id: 3, kind: 'roach', lane: 2, from: far(2), to: Math.max(0, far(2) - 2) });
        ev.push({ e: 'advance', s: 'machines', id: 4, kind: 'roach', lane: 2, from: far(2), to: Math.max(0, far(2) - 2) });
        ev.push({ e: 'wall', s: 'machines', id: 5, kind: 'scrap', lane: 3, from: 0, dmg: 1, wall: A.wall - 1 });
        ev.push({ e: 'spawn', s: 'machines', id: 40, kind: 'scrap', lane: 0, pos: far(0), hp: 1 });
        ev.push({ e: 'bomb', s: 'machines', id: 60, kind: 'keg', x: 7, y: 8 });

        engB[0] = { ...engB[0], x: 3, y: 1, carry: null };
        engB[1] = { ...engB[1], x: 4, y: 1 };
        engB[2] = { ...engB[2], x: 4, y: 5, carry: null };
        if (N > 3) engB[3] = { ...engB[3], x: 6, y: 3, carry: null };
        const bB = [...bombs, { id: 102, kind: 'stopwatch', x: 3, y: 1 }, ...(N > 3 ? [{ id: 103, kind: 'grapeshot', x: 6, y: 1 }] : []), { id: 60, kind: 'keg', x: 7, y: 8 }].filter((b, i, a) => a.findIndex((o) => o.x === b.x && o.y === b.y) === i);
        const mB = [
          { ...machines[1], frozen: 0 },
          { ...machines[2], pos: Math.max(0, far(2) - 2) },
          { ...machines[3], pos: Math.max(0, far(2) - 2) },
          { id: 40, kind: 'scrap', lane: 0, pos: far(0), hp: 1, max: 1, frozen: 0 },
        ];
        deliver({ ...room, phase: 'resolve' });
        deliver({ ...A, time: time + 0.5, phase: 'resolve', left: dur, wall: A.wall - 1, engineers: engB, bombs: bB, catapults, machines: mB, ev });
      }, 500),
    );
  };
  let time = 100;
  loopOnce(time);
  timers.push(setInterval(() => loopOnce((time += 6)), 6000));
  return stop;
}
