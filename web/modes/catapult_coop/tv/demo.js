// Dev-only showcase: /tv?demo=plan|resolve|break|won|lost|boss[&n=8] feeds synthetic room and
// snap messages through the normal handlers, so every screen can be looked at without playing
// to it. Uses the real setup (keeps + defs) from the server; the interior layouts below are
// small sample drawings in the server's notation (W wall, C catapult, = raised floor, . floor,
// # crate, S stairs). `ctDebug.game.freezeT = 1.2` holds a resolve playback at 1.2 s.

const ARTS = {
  9: [
    'WWWCWWCWW',
    'W=======S',
    'W=.o.....',
    'C=...==*.',
    'W=...=S.o',
    'W=@@.....',
    'C=@@..#..',
    'W=@@..o..',
    'WS@@.....',
  ],
  11: [
    'WWWCWWWWCWW',
    'W====S====S',
    'W=.o..#....',
    'C=....#.o..',
    'W=.==S#....',
    'W=.*=.#..o.',
    'WS....S==..',
    'W=.o..#=*..',
    'C=....#....',
    'W=..@@@@...',
    'WS..@@@@...',
  ],
};

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

export function startDemo(kind, setup, deliver) {
  const { map, defs } = setup;
  const N = Math.min(8, Math.max(1, Number(new URLSearchParams(location.search).get('n')) || 4));
  const keep = N > 5 ? map.keeps[map.keeps.length - 1] : map.keeps[0];
  const big = keep.w > 9;
  const lay = layoutFrom(ARTS[keep.w] || ARTS[9], big ? 'split' : 'platform');
  const names = ['Ada', 'Brunel', 'Tesla', 'Babbage', 'Lovelace-Byr', 'Watt', 'Faraday', 'Stephenson'];
  const colors = ['#e0a030', '#4fb39a', '#d1594a', '#6a8cff', '#c06adf', '#8fd14f', '#f0f0f0', '#ff8fb0'];
  const can = { move: defs.move, moveCarry: defs.moveCarry, throw: defs.throwRange, reach: defs.reach, quickHands: false };
  const levels = defs.levels?.length || 6;
  const level = kind === 'boss' ? levels : kind === 'break' ? 3 : 4;
  const phase = kind === 'resolve' || kind === 'boss' ? 'plan' : kind;

  // positions (small keep / large keep)
  const P = big
    ? [[2, 1], [4, 1], [3, 5], [6, 5], [5, 9], [3, 3], [8, 7], [9, 9]]
    : [[2, 1], [4, 1], [3, 5], [6, 5], [4, 4], [3, 6], [7, 7], [8, 8]];
  const carry = ['keg', null, 'stopwatch', 'grapeshot', 'keg', 'keg', null, null];
  const players = names.slice(0, N).map((name, i) => ({
    id: `p${i + 1}`,
    name,
    color: colors[i],
    connected: i !== 6,
    away: i === 6 || (kind === 'plan' && i === 3 && N > 4),
    planned: i % 3 !== 2,
    ready: kind === 'break' && i % 2 === 0,
    plan: null,
    offer: kind === 'break' && i % 2 ? defs.perkOrder.slice(i % 3, (i % 3) + 3) : null,
    perks: kind === 'break' && i % 2 === 0 ? { [defs.perkOrder[i % defs.perkOrder.length]]: 1 } : {},
    can,
  }));
  const cats = keep.catapults;
  // open plans on the plan screen
  if (kind === 'plan') {
    const plans = [
      { a: 'throw', dx: 1, dy: 0 },
      { a: 'fire', cat: cats[0].id },
      { a: 'load', cat: cats[2].id },
      { a: 'wait' },
      { a: 'move', x: P[4][0], y: P[4][1] + 1, path: [[P[4][0], P[4][1] + 1]] },
      { a: 'pickup', x: P[5][0] + 1, y: P[5][1] },
      { a: 'wait' },
      { a: 'move', x: P[7][0], y: P[7][1] - 1, path: [[P[7][0], P[7][1] - 1]] },
    ];
    players.forEach((p, i) => (p.plan = p.planned ? plans[i] : null));
  }
  const end =
    kind === 'won' || kind === 'lost'
      ? {
          won: kind === 'won',
          level: kind === 'won' ? levels : 4,
          rounds: kind === 'won' ? 84 : 47,
          wall: kind === 'won' ? 4 : 0,
          time: 912.5,
          stats: Object.fromEntries(
            players.map((p, i) => [p.id, { throws: 30 - i * 3, catches: 12 + i, pickups: 20 - i, loads: 9 - i, fires: 8 - i, kills: 14 - i * 2, dmg: 22 - i * 3, steps: 120 + i * 9, bumps: i % 3, perks: { [defs.perkOrder[i % defs.perkOrder.length]]: 1 } }]),
          ),
          awards: [
            { pid: 'p1', title: 'Sharpshooter', detail: '14 kills' },
            { pid: 'p2', title: 'Safe Hands', detail: '13 catches' },
            { pid: 'p3', title: 'Bomb Lobber', detail: '24 throws' },
            { pid: 'p1', title: 'Loader', detail: '9 loads' },
            { pid: 'p4', title: 'Marathon', detail: '147 steps' },
            { pid: 'p3', title: 'Traffic Jam', detail: '2 bumps' },
          ],
        }
      : null;
  const room = { t: 'room', mode: 'catapult_coop', phase, host: 'p1', openPlans: kind === 'plan', keep: keep.id, layout: lay, level, levels, round: 7, players, end };

  const lane = (i) => keep.lanes[i % keep.lanes.length];
  const machines =
    kind === 'boss'
      ? [
          { id: 1, kind: 'baron', lane: 1, pos: 4, hp: 7, max: 9, frozen: 0 },
          { id: 2, kind: 'scrap', lane: 0, pos: 2, hp: 1, max: 1, frozen: 0 },
          { id: 3, kind: 'roach', lane: 3, pos: 5, hp: 1, max: 1, frozen: 0 },
          { id: 4, kind: 'roach', lane: 3, pos: 5, hp: 1, max: 1, frozen: 0 },
        ]
      : [
          { id: 1, kind: 'scrap', lane: 0, pos: 2, hp: 1, max: 1, frozen: 0 },
          { id: 2, kind: 'brute', lane: 1, pos: 3, hp: 3, max: 4, frozen: 2 },
          { id: 3, kind: 'roach', lane: 2, pos: 4, hp: 1, max: 1, frozen: 0 },
          { id: 4, kind: 'roach', lane: 2, pos: 4, hp: 1, max: 1, frozen: 0 },
          { id: 5, kind: 'scrap', lane: 3, pos: 1, hp: 1, max: 1, frozen: 0 },
          { id: 6, kind: 'baron', lane: 3, pos: lane(3).len - 2, hp: 9, max: 9, frozen: 0 },
        ];
  const engineers = players.map((p, i) => ({ pid: p.id, x: P[i][0], y: P[i][1], carry: carry[i] ? { id: 100 + i, kind: carry[i] } : null }));
  const bombs = [
    { id: 1, kind: 'keg', x: 3, y: 2 },
    { id: 2, kind: 'grapeshot', x: big ? 8 : 7, y: big ? 4 : 2 },
    { id: 3, kind: 'stopwatch', x: 5, y: big ? 8 : 7 },
    { id: 4, kind: 'keg', x: big ? 9 : 8, y: 4 },
  ];
  const catapults = cats.map((c, i) => ({ id: c.id, bomb: i === 0 ? { id: 50, kind: 'keg' } : i === 3 ? { id: 51, kind: 'grapeshot' } : null }));
  const A = {
    t: 'snap', phase, time: 100, level, round: 7, left: kind === 'break' ? 11 : 8.4, wall: kind === 'lost' ? 0 : kind === 'boss' ? 4 : 11, wallMax: defs.wallHP,
    engineers, bombs, catapults, machines,
    incoming: phase === 'plan' ? [{ lane: 0, kind: 'scrap' }, { lane: 2, kind: 'brute' }, { lane: 2, kind: 'roach' }] : [],
    ev: [],
  };

  const timers = [];
  const timeouts = [];
  deliver(room);
  deliver(A);
  if (kind !== 'resolve' && kind !== 'boss') {
    let t = 100;
    timers.push(setInterval(() => deliver({ ...A, time: (t += 0.1), left: Math.max(0, A.left - (t - 100)) }), 100));
    return () => timers.forEach(clearInterval);
  }

  // resolve: every 4 s, the plan board then a resolve batch onto board B
  const e = (i) => engineers[i];
  const pid = (i) => players[i].id;
  const cat0 = cats[0];
  const cat3 = cats[3];
  const loopOnce = (time) => {
    deliver({ ...room, phase: 'plan', players: players.map((p) => ({ ...p, planned: true })) });
    deliver({ ...A, time, left: 0.4 });
    timeouts.push(setTimeout(() => {
      const engB = engineers.map((x) => ({ ...x }));
      const ev = [];
      const stages = [];
      let at = defs.resolveBase / 2;
      for (const s of ['throw', 'move', 'grab', 'fire', 'machines']) {
        stages.push({ s, at, dur: defs.stageTime });
        at += defs.stageTime;
      }
      const dur = defs.resolveBase + defs.stageTime * stages.length;
      ev.push({ e: 'resolve', level, round: 7, dur, stages });
      // throw: p1 (keg) to p2 who catches
      ev.push({ e: 'throw', s: 'throw', pid: pid(0), bomb: 100, kind: 'keg', from: [e(0).x, e(0).y], dir: [Math.sign(e(1).x - e(0).x), Math.sign(e(1).y - e(0).y)], to: [e(1).x, e(1).y], result: 'caught', by: pid(1), at: [e(1).x, e(1).y] });
      engB[0].carry = null;
      engB[1].carry = { id: 100, kind: 'keg' };
      // blocked: p4 (grapeshot) throws west at p3, whose hands are full; it bounces and drops
      if (N > 3) {
        ev.push({ e: 'throw', s: 'throw', pid: pid(3), bomb: 103, kind: 'grapeshot', from: [e(3).x, e(3).y], dir: [-1, 0], to: [e(2).x, e(2).y], result: 'blocked', by: pid(2), at: [e(2).x + 1, e(2).y] });
        engB[3].carry = null;
      }
      // landed: p5 (keg) throws east into empty ground
      if (N > 4) {
        ev.push({ e: 'throw', s: 'throw', pid: pid(4), bomb: 104, kind: 'keg', from: [e(4).x, e(4).y], dir: [1, 0], to: [e(4).x + 3, e(4).y], result: 'landed', at: [e(4).x + 3, e(4).y] });
        engB[4].carry = null;
      }
      // moves: p6 steps one cell
      if (N > 5) {
        ev.push({ e: 'move', s: 'move', pid: pid(5), from: [e(5).x, e(5).y], to: [e(5).x + 1, e(5).y], path: [[e(5).x + 1, e(5).y]], result: 'ok' });
        engB[5].x += 1;
      }
      // grab: p3 loads the stopwatch into catapult 2 (contested demo: none)
      ev.push({ e: 'load', s: 'grab', pid: pid(2), cat: cats[2].id, bomb: 102, kind: 'stopwatch', result: 'ok' });
      engB[2].carry = null;
      // fire: catapult 0 (keg) at the scrap on lane 0; catapult 3 grapeshot
      ev.push({ e: 'fire', s: 'fire', pid: pid(1), cat: cat0.id, lane: cat0.lane, bomb: 50, kind: 'keg', result: 'ok', hits: [{ id: 1, dmg: 2, hp: 0, killed: true, frozen: 0 }] });
      ev.push({ e: 'fire', s: 'fire', pid: pid(2), cat: cat3.id, lane: cat3.lane, bomb: 51, kind: 'grapeshot', result: 'ok', hits: machines.filter((m) => m.lane === cat3.lane).map((m) => ({ id: m.id, dmg: 1, hp: m.hp - 1, killed: m.hp <= 1, frozen: 0 })) });
      const mB = machines.filter((m) => m.lane !== 0 && !(m.lane === cat3.lane && m.hp <= 1)).map((m) => ({ ...m, hp: m.lane === cat3.lane ? m.hp - 1 : m.hp }));
      // machines
      const evm = [];
      let wall = A.wall;
      for (const m of mB) {
        if (m.frozen > 0) {
          m.frozen--;
          evm.push({ e: 'stall', s: 'machines', id: m.id, lane: m.lane, pos: m.pos, frozen: m.frozen });
        } else if (m.pos - 1 < 0) {
          wall -= defs.machines[m.kind].dmg;
          evm.push({ e: 'wall', s: 'machines', id: m.id, kind: m.kind, lane: m.lane, from: m.pos, dmg: defs.machines[m.kind].dmg, wall });
          m.gone = true;
        } else {
          const to = Math.max(0, m.pos - defs.machines[m.kind].speed);
          evm.push({ e: 'advance', s: 'machines', id: m.id, kind: m.kind, lane: m.lane, from: m.pos, to });
          m.pos = to;
        }
      }
      ev.push(...evm);
      ev.push({ e: 'spawn', s: 'machines', id: 40, kind: 'scrap', lane: 0, pos: lane(0).len - 1, hp: 1 });
      ev.push({ e: 'bomb', s: 'machines', id: 60, kind: 'keg', x: 6, y: big ? 9 : 8 });
      const cB = catapults.map((c) => ({ id: c.id, bomb: c.id === cats[2].id ? { id: 102, kind: 'stopwatch' } : null }));
      const bB = [...bombs, { id: 103, kind: 'grapeshot', x: e(2)?.x + 1, y: e(2)?.y }, ...(N > 4 ? [{ id: 104, kind: 'keg', x: e(4).x + 3, y: e(4).y }] : []), { id: 60, kind: 'keg', x: 6, y: big ? 9 : 8 }].filter((b) => b.x !== undefined && (N > 3 || b.id !== 103));
      const machinesB = [...mB.filter((m) => !m.gone), { id: 40, kind: 'scrap', lane: 0, pos: lane(0).len - 1, hp: 1, max: 1, frozen: 0 }];
      deliver({ ...room, phase: 'resolve', players: players.map((p) => ({ ...p, planned: false })) });
      deliver({ ...A, time: time + 0.5, phase: 'resolve', left: dur, wall, engineers: engB, bombs: bB, catapults: cB, machines: machinesB, incoming: [], ev });
    }, 500));
  };
  let time = 100;
  loopOnce(time);
  timers.push(setInterval(() => loopOnce((time += 5)), 5000));
  return () => {
    timers.forEach(clearInterval);
    timeouts.forEach(clearTimeout);
  };
}
