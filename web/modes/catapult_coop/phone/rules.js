// catapult_coop on the phone: the plan rules from docs/PROTOCOL.md ("bad_plan rules"), used to
// highlight legal targets. Every number comes from the player's `can` abilities and the board;
// the server stays the judge.

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // same neighbour order as the server

const VOID = { kind: 'void', h: 0 };
export const inGrid = (lay, x, y) => x >= 0 && y >= 0 && x < lay.w && y < lay.h;
export const cellAt = (lay, x, y) => (inGrid(lay, x, y) ? lay.cells[y][x] : VOID);
export function walkable(lay, x, y) {
  const k = cellAt(lay, x, y).kind;
  return k === 'floor' || k === 'stairs';
}
// One step between 4-adjacent cells: both walkable, equal height unless either is stairs.
export function canStep(lay, ax, ay, bx, by) {
  if (!walkable(lay, ax, ay) || !walkable(lay, bx, by) || Math.abs(ax - bx) + Math.abs(ay - by) !== 1) return false;
  const a = cellAt(lay, ax, ay);
  const b = cellAt(lay, bx, by);
  return a.kind === 'stairs' || b.kind === 'stairs' || a.h === b.h;
}

// Walking steps from (x, y) to every cell, -1 = unreachable (engineers never block paths).
export function dists(lay, x, y) {
  const d = Array.from({ length: lay.h }, () => new Array(lay.w).fill(-1));
  if (!walkable(lay, x, y)) return d;
  d[y][x] = 0;
  const q = [[x, y]];
  for (let i = 0; i < q.length; i++) {
    const [cx, cy] = q[i];
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (inGrid(lay, nx, ny) && d[ny][nx] < 0 && canStep(lay, cx, cy, nx, ny)) {
        d[ny][nx] = d[cy][cx] + 1;
        q.push([nx, ny]);
      }
    }
  }
  return d;
}

// Shortest walk from (fx, fy) to (tx, ty), start excluded, the way the server picks it.
export function walkPath(lay, fx, fy, tx, ty) {
  const d = dists(lay, tx, ty);
  if (!inGrid(lay, fx, fy) || d[fy][fx] < 0) return null;
  const out = [];
  let x = fx;
  let y = fy;
  while (d[y][x] > 0) {
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (inGrid(lay, nx, ny) && d[ny][nx] === d[y][x] - 1 && canStep(lay, x, y, nx, ny)) { x = nx; y = ny; break; }
    }
    out.push([x, y]);
  }
  return out;
}

// Can an engineer on (x, y) load or fire catapult c? 4-adjacent floor cell of the catapult's height.
export function loadCell(lay, x, y, c) {
  const cell = cellAt(lay, x, y);
  return cell.kind === 'floor' && cell.h === cellAt(lay, c.x, c.y).h && Math.abs(x - c.x) + Math.abs(y - c.y) === 1;
}

// Everything the engineer could plan right now.
//   b = { lay, keep, me: {x, y, carry}, can, bombs: [{id,kind,x,y}], cats: Map(id -> bomb|null),
//         engineers: [{pid,x,y,carry}], you }
// Returns { move, pickup, throw, load, fire } lists of targets: move/pickup/throw have x, y
// (move: path; pickup: bomb; throw: catcher = engineer standing there with free hands, or the
// engineer standing there at all as `on`); load/fire have cat and the catapult's x, y.
export function options(b) {
  const out = { move: [], pickup: [], throw: [], load: [], fire: [] };
  const { lay, keep, me, can } = b;
  if (!lay || !keep || !me || !can) return out;
  const carrying = !!me.carry;
  // move
  const budget = carrying ? can.moveCarry : can.move;
  const d = dists(lay, me.x, me.y);
  for (let y = 0; y < lay.h; y++) {
    for (let x = 0; x < lay.w; x++) {
      if (d[y][x] >= 1 && d[y][x] <= budget) out.move.push({ x, y, steps: d[y][x] });
    }
  }
  // pick up: hands empty, a bomb within reach (Manhattan, any height)
  if (!carrying) {
    for (const bm of b.bombs || []) {
      if (Math.abs(bm.x - me.x) + Math.abs(bm.y - me.y) <= can.reach) out.pickup.push({ x: bm.x, y: bm.y, bomb: bm });
    }
  }
  // throw: carrying, straight line, 1..can.throw cells, onto a walkable cell (over anything)
  if (carrying) {
    const byCell = new Map((b.engineers || []).map((e) => [e.x + ',' + e.y, e]));
    for (const [dx, dy] of DIRS) {
      for (let k = 1; k <= can.throw; k++) {
        const x = me.x + dx * k;
        const y = me.y + dy * k;
        if (!inGrid(lay, x, y)) break;
        if (!walkable(lay, x, y)) continue;
        const on = byCell.get(x + ',' + y) || null;
        out.throw.push({ x, y, on, catcher: on && !on.carry ? on : null });
      }
    }
  }
  // load / fire: standing on a loading cell of the catapult
  for (const c of keep.catapults) {
    if (!loadCell(lay, me.x, me.y, c)) continue;
    const loaded = b.cats?.get(c.id) || null;
    if (carrying && !loaded) out.load.push({ cat: c.id, x: c.x, y: c.y, lane: c.lane });
    if (loaded) out.fire.push({ cat: c.id, x: c.x, y: c.y, lane: c.lane, bomb: loaded });
  }
  return out;
}
