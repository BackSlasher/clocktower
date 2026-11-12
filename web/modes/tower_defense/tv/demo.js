// Dev-only showcase: /tv?demo=wave|build|boss|won|lost feeds synthetic room
// and snap messages through the normal handlers, so every tower/enemy kind,
// tension state and screen can be inspected without playing to that point.
// Uses the real welcome (map + defs) from the server.

import { preparePath } from './geom.js';

export function startDemo(mode, welcome, deliver) {
  const { defs, map } = welcome;
  const players = [
    { id: 'p1', name: 'Ada', color: '#e0a030', connected: true, ready: true },
    { id: 'p2', name: 'Brunel', color: '#4fb39a', connected: true, ready: false },
    { id: 'p3', name: 'Tesla', color: '#e2553f', connected: false, ready: false },
    { id: 'p4', name: 'Babbage', color: '#6a8cff', connected: true, ready: true },
  ];
  // ?n=8: a full room with long names
  const extra = [['Lovelace-Byr', '#c06adf'], ['Watt', '#8fd14f'], ['Faraday', '#f0f0f0'], ['Stephenson', '#ff8fb0']];
  const N8 = Number(new URLSearchParams(location.search).get('n')) || 4;
  for (let i = 4; i < Math.min(8, N8); i++) players.push({ id: `p${i + 1}`, name: extra[i - 4][0], color: extra[i - 4][1], connected: i !== 6, ready: i % 2 === 0 });
  const paths = map.paths.map((p) => preparePath(p.pts));
  const kinds = defs.enemyOrder;
  const tk = defs.towerOrder;
  const phase = mode === 'boss' ? 'wave' : mode;
  const wave = mode === 'boss' ? 8 : mode === 'build' ? 8 : 11;

  const end =
    mode === 'won' || mode === 'lost'
      ? {
          won: mode === 'won',
          wave: mode === 'won' ? defs.waves : 9,
          time: 612.4,
          stats: {
            p1: { kills: 141, dmg: 25210, spent: 1880, winds: 312, built: 9, gifted: 50 },
            p2: { kills: 98, dmg: 18030, spent: 1420, winds: 655, built: 6, gifted: 0 },
            p3: { kills: 40, dmg: 6400, spent: 900, winds: 120, built: 4, gifted: 220 },
            p4: { kills: 77, dmg: 12900, spent: 1610, winds: 280, built: 7, gifted: 10 },
            ...Object.fromEntries(players.slice(4).map((p, i) => [p.id, { kills: 20 + i, dmg: 3000 + i * 500, spent: 400, winds: 90, built: 2, gifted: 0 }])),
          },
          awards: [
            { pid: 'p1', title: 'Top Gun', detail: '141 kills' },
            { pid: 'p2', title: 'Chief Winder', detail: '655 cranks' },
            { pid: 'p3', title: 'Philanthropist', detail: '220 cogs gifted' },
            { pid: 'p1', title: 'Architect', detail: '9 towers built' },
            { pid: 'p4', title: 'Heavy Hitter', detail: '120591 damage' },
            { pid: 'p2', title: 'Big Spender', detail: '2530 cogs spent' },
          ],
        }
      : null;

  const room = {
    t: 'room',
    phase,
    host: 'p1',
    players,
    wave,
    nextWave: phase === 'build' ? [{ kind: 'scrap', n: 14 }, { kind: 'roach', n: 22 }, { kind: 'brute', n: 4 }, { kind: 'tinker', n: 3 }, { kind: 'baron', n: 1 }] : [],
    end,
  };

  // towers: every kind, every level, a spread of tensions
  const tensions = [1, 0.8, 0.5, 0.3, 0.12, 0.02];
  const towers = map.plots.slice(0, 16).map((p, i) => ({
    plot: p.id,
    kind: tk[i % tk.length],
    lvl: (Math.floor(i / tk.length) % 3) + 1,
    owner: players[i % players.length].id,
    tension: tensions[i % tensions.length],
    aim: 0,
    spent: 100,
  }));

  // enemies spread along all paths
  const enemies = [];
  const N = mode === 'boss' ? 60 : phase === 'wave' ? 160 : 0;
  for (let i = 0; i < N; i++) {
    const kind = kinds[i % (kinds.length - 1)];
    enemies.push({ id: i + 1, k: kinds.indexOf(kind), p: i % paths.length, off: (i / N) * 0.95, hp: 0.3 + ((i * 37) % 70) / 100, f: i % 7 === 0 ? 1 : i % 11 === 0 ? 2 : 0 });
  }
  if (mode === 'boss' || phase === 'wave') enemies.push({ id: 999, k: kinds.indexOf('baron'), p: 1, off: 0.55, hp: 0.62, f: 1 });

  deliver(room);
  let t = 0;
  let nextId = 2000;
  const tick = () => {
    t += 0.1;
    const ens = [];
    const pos = new Map();
    for (const e of enemies) {
      const def = defs.enemies[kinds[e.k]];
      const P = paths[e.p];
      const d = ((e.off * P.len + t * (def.speed || 50) * 0.5) % (P.len - 60)) + 10;
      ens.push([e.id, e.k, e.p, d, e.hp, e.f]);
      pos.set(e.id, { P, d });
    }
    const ev = [];
    if (phase === 'wave') {
      const pick = () => ens[Math.floor(Math.random() * ens.length)];
      for (const tw of towers) {
        const pl = map.plots.find((p) => p.id === tw.plot);
        const target = pick();
        if (!target) continue;
        const P = paths[target[2]];
        const pt = at(P, target[3]);
        tw.aim = Math.atan2(pt.y - pl.y, pt.x - pl.x);
        if (Math.random() > 0.25) continue;
        if (tw.kind === 'rivet') ev.push({ e: 'shot', plot: tw.plot, kind: 'rivet', to: target[0], x: pt.x, y: pt.y, travel: 0.1 });
        if (tw.kind === 'mortar' && Math.random() < 0.3) ev.push({ e: 'shot', plot: tw.plot, kind: 'mortar', to: target[0], x: pt.x, y: pt.y, travel: 0.6 });
        if (tw.kind === 'tesla' && Math.random() < 0.3) {
          const ids = [target[0]];
          const pts = [[pl.x, pl.y], [pt.x, pt.y]];
          for (let k = 1; k < 3; k++) {
            const o = pick();
            const q = at(paths[o[2]], o[3]);
            ids.push(o[0]);
            pts.push([q.x, q.y]);
          }
          ev.push({ e: 'chain', plot: tw.plot, ids, pts });
        }
      }
      if (Math.random() < 0.3) {
        const o = pick();
        const q = at(paths[o[2]], o[3]);
        ev.push({ e: 'die', id: nextId++, kind: kinds[o[1]], x: q.x, y: q.y, bounty: defs.enemies[kinds[o[1]]].bounty });
      }
      if (Math.random() < 0.15) {
        const tw = towers[Math.floor(Math.random() * towers.length)];
        ev.push({ e: 'wind', plot: tw.plot, pid: players[Math.floor(Math.random() * 4)].id });
      }
    }
    deliver({
      t: 'snap',
      time: t,
      phase,
      wave,
      left: phase === 'build' ? Math.max(0, 18 - t) : 0,
      lives: mode === 'lost' ? 0 : mode === 'boss' ? 4 : 14,
      purses: Object.fromEntries(players.map((p, i) => [p.id, [140, 75, 12, 260, 1450, 9, 33, 87][i]])),
      towers,
      enemies: ens,
      ev,
    });
  };
  tick();
  setInterval(tick, 100);
}

function at(P, d) {
  const { pts, cum } = P;
  let i = 1;
  while (i < pts.length - 1 && cum[i] < d) i++;
  const t = Math.min(1, Math.max(0, (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)));
  return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t };
}
