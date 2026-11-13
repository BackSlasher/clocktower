// Package bot is a scripted catapult_coop player used by the balance harness
// and by cmd/ctbot. It sees only what a client sees (keep from `map`, room,
// snap) and produces only protocol commands.
//
// Coordination works the way a team that talks would: every bot runs the same
// deterministic team planner on the same board and sends its own line of the
// result. The planner gives some engineers a "gunner" job (stand by a
// catapult on the rampart, catch, load, fire) and the rest fetch bombs and
// pass them up by throwing, choosing among throws and moves by an estimate of
// the rounds until the bomb is in a catapult. Everything is path-found on
// the current level's layout; nothing is hard-coded to a map.
package bot

import (
	"math"
	"math/rand/v2"
	"slices"

	game "clocktower/internal/modes/catapult_coop"
)

// Bot is one scripted player.
type Bot struct {
	ID      string
	Delay   float64 // seconds into a timed plan phase before filing (ctbot: looks human)
	Mistake float64 // chance per slot to waste it (wait) instead of following the team plan
	Wander  float64 // chance per slot to step somewhere pointless instead (makes bumps)

	rng      *rand.Rand
	sentKey  [2]int // level, round of the last queue filed
	readyKey int    // level of the last break readied
	rejected bool   // the last queue was refused: file an empty one
}

// New makes a bot.
func New(id string, seed uint64) *Bot {
	return &Bot{ID: id, rng: rand.New(rand.NewPCG(seed, 0xb07))}
}

// Act returns the commands to send now. keep is the room's keep (from
// `map.keeps` by `room.keep`).
func (b *Bot) Act(rm *game.RoomMsg, s *game.Snap, keep *game.Keep) []game.Cmd {
	if rm == nil || s == nil || keep == nil || rm.Layout == nil || s.Phase != rm.Phase {
		return nil
	}
	if !slices.ContainsFunc(rm.Players, func(p game.PlayerInfo) bool { return p.ID == b.ID }) {
		return nil
	}
	switch rm.Phase {
	case game.PhaseBreak:
		if b.readyKey != rm.Level {
			b.readyKey = rm.Level
			return []game.Cmd{{T: "ready", Ready: game.BoolP(true)}}
		}
	case game.PhasePlan:
		key := [2]int{rm.Level, s.Round}
		if b.sentKey == key || s.Round != rm.Round {
			return nil
		}
		if !s.Untimed && game.Defs.PlanTime-s.Left < b.Delay {
			return nil
		}
		b.sentKey = key
		if b.rejected {
			b.rejected = false
			return []game.Cmd{{T: "plan", Done: true}}
		}
		queues, at := TeamQueues(rm, s, keep)
		acts := queues[b.ID]
		for i := range acts {
			switch x := b.rng.Float64(); {
			case x < b.Mistake:
				acts[i] = game.Act{A: game.AWait}
			case x < b.Mistake+b.Wander:
				acts[i] = b.wander(rm.Layout, at[b.ID][i])
			}
		}
		return []game.Cmd{{T: "plan", Acts: acts, Done: true}}
	}
	return nil
}

// Rejected tells the bot its last queue was refused: it files again, an
// empty queue marked done (so a bad queue can't loop).
func (b *Bot) Rejected() { b.sentKey, b.rejected = [2]int{}, true }

// wander is a legal but pointless step from c (a wait if there is none).
func (b *Bot) wander(l *game.Layout, c [2]int) game.Act {
	var ok [][2]int
	for _, d := range game.Dirs4 {
		if l.CanStep(c[0], c[1], c[0]+d[0], c[1]+d[1]) {
			ok = append(ok, d)
		}
	}
	if len(ok) == 0 {
		return game.Act{A: game.AWait}
	}
	d := ok[b.rng.IntN(len(ok))]
	return game.Dir(game.AMove, d[0], d[1])
}

// TeamQueues plans a whole turn for every present engineer: slot by slot,
// the team plan for the board, then the board as that slot would leave it.
// It returns each player's queue and their cell at the start of each slot.
func TeamQueues(rm *game.RoomMsg, s *game.Snap, keep *game.Keep) (map[string][]game.Act, map[string][][2]int) {
	queues := map[string][]game.Act{}
	at := map[string][][2]int{}
	sim := cloneSnap(s)
	for slot := 0; slot < game.Defs.Slots; slot++ {
		decs := TeamPlan(rm, sim, keep)
		for _, e := range sim.Engineers {
			d, ok := decs[e.PID]
			if !ok {
				continue
			}
			queues[e.PID] = append(queues[e.PID], d.act(e.X, e.Y))
			at[e.PID] = append(at[e.PID], [2]int{e.X, e.Y})
		}
		sim = simulate(rm.Layout, keep, sim, decs)
	}
	return queues, at
}

// dec is one engineer's decision for a slot, in board terms.
type dec struct {
	A      string
	X, Y   int // move: destination; pickup: bomb cell
	DX, DY int // throw
	Cat    int // load, fire
}

// act turns d into the relative action for an engineer at (x, y).
func (d dec) act(x, y int) game.Act {
	switch d.A {
	case game.AMove:
		return game.Dir(game.AMove, d.X-x, d.Y-y)
	case game.APickup:
		dx, dy := d.X-x, d.Y-y
		return game.Dir(game.APickup, sign(dx), sign(dy))
	case game.AThrow:
		return game.Dir(game.AThrow, d.DX, d.DY)
	}
	return game.Act{A: d.A}
}

func sign(v int) int {
	switch {
	case v > 0:
		return 1
	case v < 0:
		return -1
	}
	return 0
}

// abil is what an engineer can do (the same for everyone).
type abil struct{ Move, MoveCarry, Throw, Reach int }

func abilities() abil {
	return abil{Move: 1, MoveCarry: 1, Throw: game.Defs.ThrowRange, Reach: game.Defs.Reach}
}

// --- team planner ---------------------------------------------------------------

const inf = math.MaxInt / 4

type eng struct {
	pid   string
	x, y  int
	carry *game.BombRef
	can   abil
	busy  bool // planned already
	catch bool // stays put with free hands after the throw stage
	plan  dec
}

type planner struct {
	l     *game.Layout
	k     *game.Keep
	s     *game.Snap
	engs  []*eng
	byPos map[[2]int]*eng
	bombs map[[2]int]game.BombSnap

	threat   []float64 // per catapult (its lane)
	machines []int     // per catapult
	loadD    [][][]int // per catapult: walking steps to its loading cells
	wantD    [][]int   // steps to the loading cell of a catapult worth filling (+ penalty)
	reachD   map[[3]int][][]int

	claimedBomb map[[2]int]bool
	taken       map[[2]int]bool // move destinations planned
	landing     map[[2]int]bool // cells a thrown bomb is planned to land on
	caught      map[*eng]bool   // catchers already targeted
	gunners     map[*eng]int
	solo        bool // one engineer plans: nobody can catch, so throwing never pays
}

// TeamPlan returns a plan command for every present engineer.
func TeamPlan(rm *game.RoomMsg, s *game.Snap, keep *game.Keep) map[string]dec {
	p := &planner{l: rm.Layout, k: keep, s: s, byPos: map[[2]int]*eng{}, bombs: map[[2]int]game.BombSnap{},
		reachD: map[[3]int][][]int{}, claimedBomb: map[[2]int]bool{}, taken: map[[2]int]bool{},
		landing: map[[2]int]bool{}, caught: map[*eng]bool{}}
	present := map[string]game.PlayerInfo{}
	for _, pi := range rm.Players {
		present[pi.ID] = pi
	}
	for _, e := range s.Engineers {
		pi, ok := present[e.PID]
		en := &eng{pid: e.PID, x: e.X, y: e.Y, carry: e.Carry, can: abilities()}
		if !ok || pi.Away {
			en.busy = true // an obstacle; we do not plan for them
		}
		p.engs = append(p.engs, en)
		p.byPos[[2]int{e.X, e.Y}] = en
	}
	for _, b := range s.Bombs {
		p.bombs[[2]int{b.X, b.Y}] = b
	}
	p.assess()
	p.run()
	out := map[string]dec{}
	for _, e := range p.engs {
		if e.plan.A != "" {
			out[e.pid] = e.plan
		}
	}
	return out
}

func (p *planner) assess() {
	n := len(p.k.Catapults)
	p.threat = make([]float64, n)
	p.machines = make([]int, n)
	for _, m := range p.s.Machines {
		c := p.catOfLane(m.Lane)
		p.threat[c] += float64(m.HP) * 10 / float64(m.Pos+1)
		p.machines[c]++
	}
	for _, in := range p.s.Incoming {
		p.threat[p.catOfLane(in.Lane)] += 1
	}
	p.loadD = make([][][]int, n)
	for _, c := range p.k.Catapults {
		var src [][2]int
		for _, d := range game.Dirs4 {
			if p.l.LoadCell(c.X+d[0], c.Y+d[1], c) {
				src = append(src, [2]int{c.X + d[0], c.Y + d[1]})
			}
		}
		p.loadD[c.ID] = p.bfs(src)
	}
	// Where bombs should go: empty catapults, threatened ones first; if all
	// are loaded, next to any catapult (to reload after firing).
	p.wantD = p.grid(inf)
	anyEmpty := false
	for _, c := range p.s.Catapults {
		if c.Bomb == nil {
			anyEmpty = true
		}
	}
	for _, c := range p.k.Catapults {
		if anyEmpty && p.s.Catapults[c.ID].Bomb != nil {
			continue
		}
		pen := 0
		if p.threat[c.ID] == 0 {
			pen = 10
		}
		for y := range p.l.H {
			for x := range p.l.W {
				if d := p.loadD[c.ID][y][x]; d >= 0 && d+pen < p.wantD[y][x] {
					p.wantD[y][x] = d + pen
				}
			}
		}
	}
}

func (p *planner) catOfLane(lane int) int {
	for _, c := range p.k.Catapults {
		if c.Lane == lane {
			return c.ID
		}
	}
	return 0
}

func (p *planner) grid(v int) [][]int {
	g := make([][]int, p.l.H)
	for y := range g {
		g[y] = make([]int, p.l.W)
		for x := range g[y] {
			g[y][x] = v
		}
	}
	return g
}

// bfs: walking steps from any of src (−1 unreachable).
func (p *planner) bfs(src [][2]int) [][]int {
	d := p.grid(-1)
	var q [][2]int
	for _, s := range src {
		if p.l.Walkable(s[0], s[1]) && d[s[1]][s[0]] < 0 {
			d[s[1]][s[0]] = 0
			q = append(q, s)
		}
	}
	for len(q) > 0 {
		c := q[0]
		q = q[1:]
		for _, dv := range game.Dirs4 {
			nx, ny := c[0]+dv[0], c[1]+dv[1]
			if p.l.In(nx, ny) && d[ny][nx] < 0 && p.l.CanStep(c[0], c[1], nx, ny) {
				d[ny][nx] = d[c[1]][c[0]] + 1
				q = append(q, [2]int{nx, ny})
			}
		}
	}
	return d
}

// pickCells lists the walkable cells from which a bomb at (x, y) can be
// picked up with reach r and progress: same height or above (or stairs).
// Picking a bomb up from below takes it back down, which is never progress;
// picking it up from the rampart above the courtyard is.
func (p *planner) pickCells(x, y, r int) [][2]int {
	var out [][2]int
	for cy := y - r; cy <= y+r; cy++ {
		for cx := x - r; cx <= x+r; cx++ {
			c := p.l.At(cx, cy)
			if abs(cx-x)+abs(cy-y) <= r && p.l.Walkable(cx, cy) && (c.Kind == game.KStairs || c.H >= p.l.At(x, y).H) {
				out = append(out, [2]int{cx, cy})
			}
		}
	}
	return out
}

// reachDist: walking steps to a cell from which (x, y) can be picked up
// (see pickCells).
func (p *planner) reachDist(x, y, r int) [][]int {
	k := [3]int{x, y, r}
	if d, ok := p.reachD[k]; ok {
		return d
	}
	d := p.bfs(p.pickCells(x, y, r))
	p.reachD[k] = d
	return d
}

// bombHand: rounds until a bomb lying at (x, y) is loaded once someone holds
// it, from the best cell to pick it up from.
func (p *planner) bombHand(x, y, r int) int {
	best := inf
	for _, c := range p.pickCells(x, y, r) {
		best = min(best, p.handCost(c[0], c[1], 1))
	}
	return best
}

func ceilDiv(a, b int) int { return (a + b - 1) / max(1, b) }

// handCost: rounds until a bomb held at (x, y) is loaded.
func (p *planner) handCost(x, y, moveCarry int) int {
	d := p.wantD[y][x]
	if d >= inf {
		return inf
	}
	return ceilDiv(d, moveCarry) + 1
}

// pickupDelay: rounds until someone free-handed can pick up a bomb at (x, y).
// thrower counts as free-handed; skip is left out.
func (p *planner) pickupDelay(x, y int, thrower, skip *eng) int {
	best := inf
	for _, e := range p.engs {
		if e == skip || e.carry != nil && e != thrower {
			continue
		}
		if e.busy && e != thrower && !e.catch {
			continue
		}
		d := p.reachDist(x, y, e.can.Reach)[e.y][e.x]
		if d >= 0 {
			best = min(best, ceilDiv(d, e.can.Move))
		}
	}
	return best
}

// throwRes is the predicted outcome of one throw.
type throwRes struct {
	cost    int
	dir     [2]int
	stopper *eng   // the engineer who catches (catch) or blocks it
	catch   bool   // stopper catches
	land    [2]int // where it comes down when not caught
}

// bestThrow predicts the four throws e could make from (x, y): the first
// engineer on the line catches (free hands) or blocks it (full hands; it
// drops at their feet); with nobody on the line it lands at the line's end.
// cost is the estimated rounds until the bomb is loaded.
func (p *planner) bestThrow(e *eng, x, y int) throwRes {
	best := throwRes{cost: inf}
	for _, d := range game.Dirs4 {
		line := p.l.ThrowLine(x, y, d[0], d[1], e.can.Throw)
		land, ok := p.l.Landing(line)
		if !ok {
			continue
		}
		res := throwRes{dir: d}
		for _, c := range line {
			if o := p.byPos[c]; o != nil && o != e {
				res.stopper = o
				break
			}
		}
		if o := res.stopper; o != nil {
			if (o.carry == nil || o.plan.A == game.AThrow) && !p.caught[o] {
				res.catch = true
				res.cost = 1 + p.handCost(o.x, o.y, o.can.MoveCarry)
				if o.plan.A == game.APickup {
					res.cost += 2 // their pick-up will fail
				}
			} else {
				land = [2]int{o.x, o.y}
			}
		}
		if !res.catch {
			if p.l.At(land[0], land[1]).Kind != game.KFloor || p.landing[land] || p.hasBomb(land[0], land[1]) {
				continue // it would settle somewhere else; too unpredictable
			}
			pd := p.pickupDelay(land[0], land[1], e, nil)
			if pd >= inf {
				continue
			}
			res.land = land
			res.cost = 1 + pd + 1 + p.bombHand(land[0], land[1], 1)
		}
		if res.cost < best.cost {
			best = res
		}
	}
	return best
}

func (p *planner) hasBomb(x, y int) bool { _, ok := p.bombs[[2]int{x, y}]; return ok }

// freeDest: may e plan to walk to (x, y)? Not onto anyone, not onto a cell
// another engineer is walking to.
func (p *planner) freeDest(e *eng, x, y int) bool {
	k := [2]int{x, y}
	if o := p.byPos[k]; o != nil && o != e {
		return false
	}
	return !p.taken[k] && !(x == e.x && y == e.y)
}

// moves lists the cells e can walk to this round, with their paths' lengths.
func (p *planner) moves(e *eng) [][2]int {
	budget := e.can.Move
	if e.carry != nil {
		budget = e.can.MoveCarry
	}
	d := p.l.Dists(e.x, e.y)
	var out [][2]int
	for y := range p.l.H {
		for x := range p.l.W {
			if d[y][x] > 0 && d[y][x] <= budget && p.freeDest(e, x, y) {
				out = append(out, [2]int{x, y})
			}
		}
	}
	return out
}

func (p *planner) setMove(e *eng, x, y int) {
	e.plan = dec{A: game.AMove, X: x, Y: y}
	e.busy = true
	p.taken[[2]int{x, y}] = true
}

func (p *planner) setWait(e *eng) {
	e.plan = dec{A: game.AWait}
	e.busy = true
	e.catch = e.carry == nil
}

// adjacentCats lists catapults e can load or fire from where it stands.
func (p *planner) adjacentCats(e *eng) []int {
	var out []int
	for _, c := range p.k.Catapults {
		if p.l.LoadCell(e.x, e.y, c) {
			out = append(out, c.ID)
		}
	}
	return out
}

// tryCatapult fires a loaded adjacent catapult whose lane has machines, or
// loads an empty adjacent one when carrying.
func (p *planner) tryCatapult(e *eng) bool { return p.tryCatapultAt(e, -1) }

// tryCatapultAt is tryCatapult for a gunner whose station is catapult own:
// it also loads its own catapult when that lane is quiet (ready for later).
func (p *planner) tryCatapultAt(e *eng, own int) bool {
	cats := p.adjacentCats(e)
	for _, c := range cats {
		if p.s.Catapults[c].Bomb != nil && p.machines[c] > 0 {
			e.plan = dec{A: game.AFire, Cat: c}
			e.busy, e.catch = true, e.carry == nil
			return true
		}
	}
	if e.carry == nil {
		return false
	}
	slices.SortStableFunc(cats, func(a, b int) int { return cmpF(p.threat[b], p.threat[a]) })
	anyThreat := slices.ContainsFunc(p.threat, func(t float64) bool { return t > 0 })
	for _, c := range cats {
		if p.s.Catapults[c].Bomb == nil && (p.threat[c] > 0 || !anyThreat || c == own) {
			e.plan = dec{A: game.ALoad, Cat: c}
			e.busy = true
			return true
		}
	}
	return false
}

func cmpF(a, b float64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// tryPickup picks up the best unclaimed bomb within reach. Unless always is
// set (gunners), only when holding it beats leaving it for someone else.
func (p *planner) tryPickup(e *eng, always bool) bool {
	if e.carry != nil {
		return false
	}
	best, bc := [2]int{}, inf
	for k := range p.bombs {
		if p.claimedBomb[k] || abs(k[0]-e.x)+abs(k[1]-e.y) > e.can.Reach {
			continue
		}
		c := p.wantD[k[1]][k[0]]
		if !always && c < inf {
			hold := p.handCost(e.x, e.y, e.can.MoveCarry)
			held := &eng{pid: e.pid, x: e.x, y: e.y, carry: &game.BombRef{}, can: e.can}
			if t := p.bestThrow(held, e.x, e.y).cost; t < hold {
				hold = t
			}
			leave := p.pickupDelay(k[0], k[1], nil, e) + 1 + p.bombHand(k[0], k[1], 1)
			if 1+hold >= leave {
				continue
			}
		}
		if c < bc || c == bc && less(k, best) {
			best, bc = k, c
		}
	}
	if bc == inf {
		return false
	}
	p.claimedBomb[best] = true
	e.plan = dec{A: game.APickup, X: best[0], Y: best[1]}
	e.busy = true
	return true
}

func less(a, b [2]int) bool { return a[1] < b[1] || a[1] == b[1] && a[0] < b[0] }

// moveToward walks e as close as it can to the zero set of dist (dist from
// a target), breaking ties by tie (smaller is better). Returns false if no
// step improves on standing still.
func (p *planner) moveToward(e *eng, dist [][]int, tie [][]int) bool {
	here := dist[e.y][e.x]
	if here < 0 {
		here = inf
	}
	best, bd, bt := [2]int{-1, -1}, here, inf
	for _, m := range p.moves(e) {
		d := dist[m[1]][m[0]]
		if d < 0 {
			continue
		}
		t := 0
		if tie != nil {
			t = tie[m[1]][m[0]]
		}
		if d < bd || d == bd && best[0] >= 0 && t < bt {
			best, bd, bt = m, d, t
		}
	}
	if best[0] < 0 {
		return false
	}
	p.setMove(e, best[0], best[1])
	return true
}

func (p *planner) gunnerCount(n int) int {
	switch {
	case n <= 0:
		return 0
	case n <= 2:
		return 1
	case n <= 6:
		return 2
	}
	return 4
}

// groups splits the catapults among g gunners: all together, by side of the
// keep, or one each (the busier side splits first).
func (p *planner) groups(g int) [][]int {
	if g <= 0 {
		return nil
	}
	var all, top, left []int
	for _, c := range p.k.Catapults {
		all = append(all, c.ID)
		if c.Y == 0 {
			top = append(top, c.ID)
		} else {
			left = append(left, c.ID)
		}
	}
	sum := func(cs []int) (t float64) {
		for _, c := range cs {
			t += p.threat[c]
		}
		return
	}
	single := func(cs []int) (o [][]int) {
		for _, c := range cs {
			o = append(o, []int{c})
		}
		return
	}
	switch {
	case g == 1:
		return [][]int{all}
	case g == 2:
		return [][]int{top, left}
	case g == 3:
		if sum(top) >= sum(left) {
			return append(single(top), left)
		}
		return append(single(left), top)
	}
	return single(all)
}

func (p *planner) run() {
	var free []*eng
	for _, e := range p.engs {
		if !e.busy {
			free = append(free, e)
		}
	}
	// Gunners: each owns a group of catapults (the whole rampart, one side,
	// or one catapult, by team size) and stands by the most threatened one
	// in it. Groups are fixed so gunners do not run about.
	gunner := map[*eng]int{}
	for _, grp := range p.groups(p.gunnerCount(len(free))) {
		var best *eng
		bd := inf
		for _, e := range free {
			if _, ok := gunner[e]; ok {
				continue
			}
			for _, c := range grp {
				d := p.loadD[c][e.y][e.x]
				if d < 0 {
					continue
				}
				if e.carry != nil {
					d += 2 // rather keep carriers carrying
				}
				if d < bd {
					best, bd = e, d
				}
			}
		}
		if best == nil {
			continue
		}
		st, sd := -1, 0
		for _, c := range grp {
			d := p.loadD[c][best.y][best.x]
			if st < 0 || p.threat[c] > p.threat[st] || p.threat[c] == p.threat[st] && d < sd {
				st, sd = c, d
			}
		}
		gunner[best] = st
	}
	// 1. Gunners.
	for _, e := range free {
		c, ok := gunner[e]
		if !ok {
			continue
		}
		solo := len(free) == 1 // a lone engineer is gunner and fetcher at once
		p.solo = solo
		switch {
		case p.tryCatapultAt(e, c):
		case p.l.At(e.x, e.y).H > 0 && p.tryPickup(e, true):
		case e.carry == nil && p.l.At(e.x, e.y).H > 0 && p.gunnerFetch(e):
		case solo && e.carry != nil:
			p.carry(e)
		case solo && p.l.At(e.x, e.y).H == 0 && p.tryPickup(e, true):
		case solo && p.fetch(e):
		case p.loadD[c][e.y][e.x] > 0 && p.moveToward(e, p.loadD[c], nil):
		default:
			p.setWait(e)
		}
	}
	p.gunners = gunner
	// 2. Carriers holding a bomb, closest to a catapult first.
	var holders []*eng
	for _, e := range free {
		if !e.busy && e.carry != nil {
			holders = append(holders, e)
		}
	}
	slices.SortStableFunc(holders, func(a, b *eng) int { return p.wantD[a.y][a.x] - p.wantD[b.y][b.x] })
	for _, e := range holders {
		if p.tryCatapult(e) {
			continue
		}
		p.carry(e)
	}
	// 3. Free-handed fetchers (one a carrier is throwing to stays to catch).
	for _, e := range free {
		if e.busy {
			continue
		}
		switch {
		case p.caught[e]:
			p.setWait(e)
		case p.tryCatapult(e):
		case p.tryPickup(e, false):
		case p.fetch(e):
		default:
			p.setWait(e)
		}
	}
}

// carry decides between throwing now, walking (to a better throwing spot or
// toward a catapult) and holding. value[c] estimates the rounds until the
// bomb is loaded if e stands on c holding it: carry it on from there, throw
// from there, or walk further (+1 a step).
func (p *planner) carry(e *eng) {
	value := p.grid(inf)
	for y := range p.l.H {
		for x := range p.l.W {
			if !p.l.Walkable(x, y) {
				continue
			}
			v := p.handCost(x, y, e.can.MoveCarry)
			if t := p.bestThrow(e, x, y).cost; t < v && !p.solo {
				v = t
			}
			value[y][x] = v
		}
	}
	for changed := true; changed; {
		changed = false
		for y := range p.l.H {
			for x := range p.l.W {
				for _, d := range game.Dirs4 {
					nx, ny := x+d[0], y+d[1]
					if p.l.In(nx, ny) && p.l.CanStep(x, y, nx, ny) && value[ny][nx] < inf && value[ny][nx]+1 < value[y][x] {
						value[y][x] = value[ny][nx] + 1
						changed = true
					}
				}
			}
		}
	}
	th := p.bestThrow(e, e.x, e.y)
	if p.solo {
		th.cost = inf
	}
	bestMove, mv := [2]int{-1, -1}, inf
	for _, m := range p.moves(e) {
		if v := value[m[1]][m[0]] + 1; v < mv {
			bestMove, mv = m, v
		}
	}
	switch {
	case th.cost < inf && th.cost <= mv:
		e.plan = dec{A: game.AThrow, DX: th.dir[0], DY: th.dir[1]}
		e.busy = true
		if th.catch {
			p.caught[th.stopper] = true
		} else {
			p.landing[th.land] = true
		}
	case mv < inf:
		p.setMove(e, bestMove[0], bestMove[1])
	default:
		p.setWait(e)
	}
}

// gunnerFetch steps a free-handed gunner toward an unclaimed bomb at its own
// height or below (picked up from above) that it can reach this round.
func (p *planner) gunnerFetch(e *eng) bool {
	h := p.l.At(e.x, e.y).H
	best, bd := [2]int{-1, -1}, inf
	for k := range p.bombs {
		if p.claimedBomb[k] || p.l.At(k[0], k[1]).H > h {
			continue
		}
		d := p.reachDist(k[0], k[1], e.can.Reach)[e.y][e.x]
		if d >= 0 && d <= e.can.Move && (d < bd || d == bd && less(k, best)) {
			best, bd = k, d
		}
	}
	if best[0] < 0 {
		return false
	}
	p.claimedBomb[best] = true
	return p.moveToward(e, p.reachDist(best[0], best[1], e.can.Reach), nil)
}

// nearGunner: a gunner can get to the bomb at k within a round.
func (p *planner) nearGunner(k [2]int) bool {
	for g := range p.gunners {
		if g.carry == nil {
			if d := p.reachDist(k[0], k[1], g.can.Reach)[g.y][g.x]; d >= 0 && d <= g.can.Move {
				return true
			}
		}
	}
	return false
}

// fetch walks a free-handed engineer toward the best unclaimed bomb.
func (p *planner) fetch(e *eng) bool {
	best, bc := [2]int{-1, -1}, inf
	for k := range p.bombs {
		if p.claimedBomb[k] || p.nearGunner(k) {
			continue
		}
		d := p.reachDist(k[0], k[1], e.can.Reach)[e.y][e.x]
		h := p.bombHand(k[0], k[1], e.can.Reach)
		if d < 0 || h >= inf {
			continue
		}
		c := ceilDiv(d, e.can.Move) + 1 + h
		if c < bc || c == bc && less(k, best) {
			best, bc = k, c
		}
	}
	if best[0] < 0 {
		return false
	}
	p.claimedBomb[best] = true
	return p.moveToward(e, p.reachDist(best[0], best[1], e.can.Reach), p.wantD)
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
