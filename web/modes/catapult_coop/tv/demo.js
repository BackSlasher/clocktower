// Dev-only showcase: /tv?demo=plan|tutorial|guide|resolve|break|won|lost|boss[&n=1..4] feeds synthetic room and
// snap messages through the normal handlers, so every screen can be looked at without playing
// to it. `tutorial` is the game's first turn (level 1, untimed plan phase); `guide` is a step of the
// guided tutorial (snap.guide), which moves on to the next step after 6 s (`&hold` keeps it). Uses the real setup (keeps + defs) from the server; the interior layouts below are
// sample drawings in the server's notation (W wall, C catapult, = raised floor, . floor,
// # crate, S stairs). `ctDebug.game.freezeT = 1.35` holds a resolve playback at 1.35 s
// (the middle of step 2 in the resolve scene).

// corner stairs in two orientations: (2,2) climbs to the rampart corner, (6,4) climbs onto a
// platform to its right and behind
const ART = [
    'WWWCWWCWW',
    'W========',
    'W=S......',
    'C=...===.',
    'W=....S=.',
    'W=.......',
    'C=....#..',
    'W=.......',
    'W=.......',
];

// the sample drawing if it fits the keep, else a plain interior of the keep's own size (the
// keep shell may change): ramparts along both walls, corner stairs and one crate
function demoRows(keep) {
  if (keep.w === ART[0].length && keep.h === ART.length) return ART;
  const rows = [];
  for (let y = 0; y < keep.h; y++) {
    let r = '';
    for (let x = 0; x < keep.w; x++) {
      if (keep.catapults.some((c) => c.x === x && c.y === y)) r += 'C';
      else if (x === 0 || y === 0) r += 'W';
      else if (x === 1 || y === 1) r += '=';
      else if (x === 2 && y === 2) r += 'S';
      else if (x === keep.w - 3 && y === keep.h - 3) r += '#';
      else r += '.';
    }
    rows.push(r);
  }
  return rows;
}

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
  // the powder store: the bottom-right corner of the courtyard (free floor only)
  const store = [];
  for (let y = rows.length - 2; y < rows.length; y++) for (let x = rows[0].length - 3; x < rows[0].length; x++) if (cells[y]?.[x]?.kind === 'floor' && !cells[y][x].h) store.push([x, y]);
  return { id, w: rows[0].length, h: rows.length, cells, spawns: [], store };
}

const mv = (dx, dy) => ({ a: 'move', dx, dy });
const th = (dx, dy) => ({ a: 'throw', dx, dy });
const W8 = { a: 'wait' };

export function startDemo(kind, setup, deliver) {
  const { map, defs } = setup;
  const N = Math.min(4, Math.max(1, Number(new URLSearchParams(location.search).get('n')) || 4));
  const keep = map.keeps[0];
  const lay = layoutFrom(demoRows(keep), 'platform');
  const names = ['Ada', 'Brunel', 'Tesla', 'Babbage', 'Lovelace-Byr', 'Watt', 'Faraday', 'Stephenson'];
  const colors = ['#e0a030', '#4fb39a', '#d1594a', '#6a8cff', '#c06adf', '#8fd14f', '#f0f0f0', '#ff8fb0'];
  const levels = defs.levels?.length || 6;
  const guided = kind === 'guide';
  const tutorial = kind === 'tutorial' || guided;
  if (tutorial) kind = 'plan';
  const level = tutorial ? 1 : kind === 'boss' ? levels : kind === 'break' ? 3 : 4;
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
    { acts: [mv(1, 0), { a: 'load' }, W8, W8], done: true },
    { acts: [W8, { a: 'pickup' }, mv(-1, 0)], done: true },
    { acts: [W8, th(0, -1), mv(1, 0)], done: true },
    { acts: [mv(0, -1), mv(0, -1), th(0, -1), W8], done: true },
    { acts: [mv(-1, 0), { a: 'pickup' }, th(-1, 0)], done: true },
    { acts: [mv(0, 1), W8, W8, W8], done: true },
    { acts: [], done: false },
    { acts: [mv(0, -1), mv(1, 0)], done: true },
  ];
  // the plan scene: queues being filled
  const QP = [
    { acts: [mv(1, 0), { a: 'load' }, W8, W8], done: true },
    { acts: [{ a: 'pickup' }, th(-1, 0)], done: false },
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
          stats: Object.fromEntries(players.map((p, i) => [p.id, { throws: 30 - i * 3, catches: 12 + i, pickups: 20 - i, loads: 9 - i, kills: 14 - i * 2, dmg: 22 - i * 3, steps: 120 + i * 9, bumps: i % 3, fizzles: (i * 5) % 9 }])),
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
  const room = { t: 'room', mode: 'catapult_coop', phase, host: 'p1', keep: keep.id, layout: lay, level, levels, round: tutorial ? 1 : 4, players, end };

  const machines = tutorial
    ? [{ id: 1, kind: 'scrap', lane: 1, pos: far(1), hp: 1, max: 1, frozen: 0 }]
    : kind === 'boss'
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
        ];
  const engineers = players.map((p, i) => ({ pid: p.id, x: P[i][0], y: P[i][1], carry: carry[i] ? { id: 100 + i, kind: carry[i] } : null }));
  // a bomb under Brunel's feet in the plan scene (pick-up works on your own cell)
  const bombs = [
    { id: 1, kind: 'keg', x: 4, y: 2 },
    { id: 2, kind: 'grapeshot', x: 8, y: 4 },
    { id: 3, kind: 'stopwatch', x: 6, y: 7 },
    ...(kind === 'plan' ? [{ id: 4, kind: 'keg', x: 5, y: 1 }] : []),
  ];
  // catapult 4 is loaded and its lane is empty: armed, waiting for a machine
  const catapults = cats.map((c, i) => ({ id: c.id, bomb: i === 3 ? { id: 50, kind: 'stopwatch' } : null }));
  const A = {
    t: 'snap', phase, time: 100, level, round: 4, left: tutorial ? 0 : kind === 'break' ? 5 : 14.4, untimed: tutorial, wall: kind === 'lost' ? 0 : kind === 'boss' ? 4 : 11, wallMax: defs.wallHP,
    engineers, bombs, catapults, machines,
    incoming: kind === 'plan' && !tutorial ? [{ lane: 3, kind: 'brute' }, { lane: 0, kind: 'scrap' }] : [],
    plans: phase === 'plan' && !tutorial ? plansOf(kind === 'plan' ? QP : Q) : players.map((p, i) => ({ pid: p.id, acts: tutorial && i === 0 ? [mv(1, 0)] : [], done: false })),
    ev: [],
  };
  // the guided tutorial (snap.guide): step 3 of 7, every player with their own task; after a few
  // seconds the step moves on to 4 (to see the "Nice!" beat)
  const guideAt = (step) =>
    step === 3
      ? {
          step: 3, of: 7, title: 'Throw it up to the gunners',
          text: 'Throws fly in a straight line: throw ↗ from the courtyard and the first engineer on the line catches.',
          tasks: [
            { pid: 'p1', text: 'Step ↘ onto the red dot by catapult 1', cell: [3, 1], acts: [mv(1, 0)], done: false },
            { pid: 'p2', text: 'Stay put: you catch', cell: null, acts: [W8], done: true },
            { pid: 'p3', text: 'Wait, then throw ↗ up to Ada', cell: null, acts: [W8, th(0, -1)], done: false },
            { pid: 'p4', text: 'Walk ↙ ↙ into the powder store', cell: [6, 7], acts: [mv(0, 1), mv(0, 1)], done: false },
          ].filter((t) => players.some((p) => p.id === t.pid)),
        }
      : {
          step: 4, of: 7, title: 'Load it and watch it fire',
          text: 'Standing on the red dot with a bomb? Load: the catapult fires by itself when a machine walks into its lane.',
          tasks: players.map((p, i) => ({ pid: p.id, text: i === 0 ? 'Load catapult 1' : 'Wait and watch', cell: i === 0 ? [3, 1] : null, acts: i === 0 ? [{ a: 'load' }] : [W8], done: i === 1 })),
        };
  if (guided) {
    A.guide = guideAt(3);
    A.engineers = A.engineers.map((e, i) => (i === 0 ? { ...e, carry: null } : e));
    A.plans = players.map((p, i) => ({ pid: p.id, acts: i === 1 ? [W8] : i === 3 ? [mv(0, 1)] : [], done: i === 1 }));
  }

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
    timers.push(setInterval(() => {
      t += 0.1;
      if (guided && t > 106 && A.guide.step === 3 && !new URLSearchParams(location.search).has('hold')) A.guide = guideAt(4);
      deliver({ ...A, time: t, left: Math.max(0, A.left - (t - 100)) });
    }, 100));
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
        stage(1, ['throw', 'move', 'grab', 'fire']);
        stage(2, ['throw', 'move']);
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
        // its lane has a machine, so catapult 1 fires by itself at the end of the slot
        ev.push({ e: 'fire', s: 'fire', slot: 1, pid: pid(0), cat: c0.id, lane: c0.lane, bomb: 100, kind: 'keg', hits: [{ id: 1, dmg: 2, hp: 0, killed: true, frozen: 0 }] });
        // slot 3 (index 2): Babbage throws up into the empty rampart; Brunel steps
        if (N > 3) ev.push({ e: 'throw', s: 'throw', slot: 2, pid: pid(3), bomb: 103, kind: 'grapeshot', from: [6, 3], dir: [0, -1], to: [6, 1], result: 'landed', at: [6, 1] });
        ev.push({ e: 'move', s: 'move', slot: 2, pid: pid(1), from: [5, 1], to: [4, 1], result: 'ok' });
        ev.push({ e: 'move', s: 'move', slot: 2, pid: pid(2), from: [3, 5], to: [4, 5], result: 'ok' });
        // machines
        ev.push({ e: 'stall', s: 'machines', id: 2, lane: 1, pos: far(1), frozen: 0 });
        ev.push({ e: 'advance', s: 'machines', id: 3, kind: 'roach', lane: 2, from: far(2), to: Math.max(0, far(2) - 2) });
        ev.push({ e: 'advance', s: 'machines', id: 4, kind: 'roach', lane: 2, from: far(2), to: Math.max(0, far(2) - 2) });
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
        deliver({ ...A, time: time + 0.5, phase: 'resolve', left: dur, engineers: engB, bombs: bB, catapults, machines: mB, ev });
      }, 500),
    );
  };
  let time = 100;
  loopOnce(time);
  timers.push(setInterval(() => loopOnce((time += 6)), 6000));
  return stop;
}
