// catapult_coop on the phone: the plan rules from docs/PROTOCOL.md ("bad_plan rules") that the
// controller needs to grey out flatly illegal choices. Every number comes from the player's `can`
// abilities and the board; the server stays the judge. No predictions: where a throw ends up is
// for the team to read on the TV.

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

// Can a bomb be thrown from (x, y) in direction d at all? The throw line runs up to `range`
// cells and ends before the first cell off the grid, a catapult, void, or a block of height 1 (the
// outer wall); everything else (crates, platforms, stairs) is flown over. Legal when the line
// holds a walkable cell.
export function canThrow(lay, x, y, d, range) {
  for (let k = 1; k <= range; k++) {
    const cx = x + d[0] * k;
    const cy = y + d[1] * k;
    const c = cellAt(lay, cx, cy);
    if (!inGrid(lay, cx, cy) || c.kind === 'catapult' || c.kind === 'void' || (c.kind === 'block' && c.h === 1)) return false;
    if (walkable(lay, cx, cy)) return true;
  }
  return false;
}

// Can an engineer on (x, y) load or fire catapult c? 4-adjacent floor cell of the catapult's height.
export function loadCell(lay, x, y, c) {
  const cell = cellAt(lay, x, y);
  return cell.kind === 'floor' && cell.h === cellAt(lay, c.x, c.y).h && Math.abs(x - c.x) + Math.abs(y - c.y) === 1;
}

// Everything the engineer could plan right now.
//   b = { lay, keep, me: {x, y, carry}, can, bombs: [{id,kind,x,y}], cats: Map(id -> bomb|null) }
// Returns { move, throw, pickup, load, fire }: move and throw list the legal directions as
// {dx, dy} (move also has the cell x, y); pickup has x, y and bomb; load/fire have cat and the
// catapult's x, y.
export function options(b) {
  const out = { move: [], throw: [], pickup: [], load: [], fire: [] };
  const { lay, keep, me, can } = b;
  if (!lay || !keep || !me || !can) return out;
  const carrying = !!me.carry;
  for (const [dx, dy] of DIRS) {
    // move: exactly one step
    if (canStep(lay, me.x, me.y, me.x + dx, me.y + dy)) out.move.push({ dx, dy, x: me.x + dx, y: me.y + dy });
    // throw: carrying, a direction with somewhere to land
    if (carrying && canThrow(lay, me.x, me.y, [dx, dy], can.throw)) out.throw.push({ dx, dy });
  }
  // pick up: hands empty, a bomb within reach (Manhattan, any height)
  if (!carrying) {
    for (const bm of b.bombs || []) {
      if (Math.abs(bm.x - me.x) + Math.abs(bm.y - me.y) <= can.reach) out.pickup.push({ x: bm.x, y: bm.y, bomb: bm });
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
