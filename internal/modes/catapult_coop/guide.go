package catapultcoop

import (
	"fmt"
	"slices"
)

// The guided tutorial: level 1's prelude, a script of untimed turns ("guide
// steps"), each with one concrete goal per player. A step repeats (a new
// untimed turn, same goals) until every goal is met, then the next starts.
// By the end every player has walked (some over the stairs), picked a bomb
// up, thrown one a teammate caught, caught one, and loaded a catapult that
// fired and destroyed a machine: the fetchers and gunners swap roles halfway.
// Machines stand still as targets until the last step, which is played for
// real (machines move; still untimed). Then level 1 starts with the wall
// repaired and the stats cleared. The host can skip it (skip_tutorial).
//
// The script uses the "open" layout's coordinates (level 1's layout); the
// suggested queues are path-found on the board every turn, so they stay
// right when someone wanders off, and a goal met another way still counts.

// Goal kinds.
const (
	gWalk   = iota + 1 // stand on cell at the end of a turn
	gPickup            // hold a bomb (cell: the bomb to prefer)
	gThrow             // throw a bomb that mate catches
	gCatch             // catch a bomb thrown by mate (stand on cell)
	gLoad              // load a bomb that fires and destroys a machine (cat: the catapult to use)
	gLob               // throw a bomb that lands on cell (nobody on the line)
	gLive              // the last step: play it for real
)

type goal struct {
	k    int
	cell [2]int
	mate int // seat (1-based) of the partner: throw, catch
	cat  int
	note string // replaces the generated task text
	soft bool   // does not hold the step up (walking ahead, waiting out of the way)
}

type gstep struct {
	title, text string
	goals       map[int]goal // by seat, 1-based
}

type progress struct {
	picked, kills int
	threwTo       map[string]int // catcher → throws they caught
	caughtFrom    map[string]int // thrower → throws caught
	lobbed        map[[2]int]int // landing cell → throws that landed there
}

func newProgress() *progress {
	return &progress{threwTo: map[string]int{}, caughtFrom: map[string]int{}, lobbed: map[[2]int]int{}}
}

func (p *progress) clone() *progress {
	c := *p
	c.threwTo, c.caughtFrom, c.lobbed = cloneMap(p.threwTo), cloneMap(p.caughtFrom), cloneMap(p.lobbed)
	return &c
}

func cloneMap[K comparable](m map[K]int) map[K]int {
	c := make(map[K]int, len(m))
	for k, v := range m {
		c[k] = v
	}
	return c
}

type guideState struct {
	steps []gstep
	i     int            // current step (0-based)
	seats map[string]int // pid → seat (1-based), fixed at the guide's start
	pids  map[int]string // seat → pid
	prog  map[string]*progress
	base  map[string]*progress // progress at the start of the previous step: what counts for this one
	next  map[string]*progress // progress at the start of this step
	done  map[string]bool      // goals of this step met
}

func (gs *guideState) step() gstep { return gs.steps[gs.i] }
func (gs *guideState) live() bool  { return gs.step().goals[1].k == gLive }

// Coordinates on the "open" layout.
var (
	gLoadCell = [4][2]int{{3, 1}, {6, 1}, {1, 3}, {1, 6}} // loading cell of catapult 0..3
	gBomb     = [2][2]int{{6, 7}, {4, 7}}                 // the bombs lying at the start: pair 1, pair 2
	gFoot     = [2][2]int{{3, 2}, {4, 2}}                 // fetchers wait at the foot of the stairs
	gYard     = [2][2]int{{3, 4}, {2, 4}}                 // gunners come down to here
)

// guideScript is the step list for n players.
func guideScript(n int) []gstep {
	live := gstep{"Now for real!", "The machines move now: keep the bombs coming until they are all gone.", nil}
	all := func(k int) map[int]goal {
		m := map[int]goal{}
		for s := 1; s <= n; s++ {
			m[s] = goal{k: k}
		}
		return m
	}
	live.goals = all(gLive)
	switch n {
	case 1:
		return []gstep{
			{"Pick up a bomb", "Walk onto the bomb and pick it up.", map[int]goal{1: {k: gPickup, cell: gBomb[0]}}},
			{"Lob it onto the rampart", "Alone, you can throw a bomb up onto the rampart and fetch it later.", map[int]goal{1: {k: gLob, cell: gLoadCell[1]}}},
			{"Climb up and load it", "Take the stairs, pick the bomb up and load the catapult: it fires by itself.", map[int]goal{1: {k: gLoad, cat: 1}}},
			live,
		}
	case 3:
		return []gstep{
			{"Get ready", "One fetcher picks up a bomb, the other steps into line, the gunner walks to a catapult.", map[int]goal{
				3: {k: gPickup, cell: gBomb[1]}, 1: {k: gWalk, cell: [2]int{3, 7}, soft: true}, 2: {k: gWalk, cell: gLoadCell[0], soft: true}}},
			{"Pass it along", "Throw the bomb across the yard to your teammate, who catches it.", map[int]goal{
				3: {k: gThrow, mate: 1}, 1: {k: gCatch, mate: 3, cell: [2]int{3, 7}}, 2: {k: gWalk, cell: gLoadCell[0], soft: true}}},
			{"Throw it up", "Throw the bomb up to the gunner on the rampart, who catches it.", map[int]goal{
				1: {k: gThrow, mate: 2}, 2: {k: gCatch, mate: 1, cell: gLoadCell[0]}, 3: {k: gWalk, cell: gFoot[1], note: "Walk to the foot of the stairs", soft: true}}},
			{"Load and fire", "Load the catapult: it fires by itself at the machine in its lane.", map[int]goal{
				2: {k: gLoad, cat: 0}, 1: {k: gWalk, cell: gFoot[0], note: "Walk to the foot of the stairs", soft: true}, 3: {k: gWalk, cell: gFoot[1], note: "Wait at the foot of the stairs", soft: true}}},
			{"Swap: gunner comes down", "Time to swap jobs: the gunner takes the stairs down to the yard.", map[int]goal{
				2: {k: gWalk, cell: gYard[0], note: "Take the stairs down to the marked spot"}, 1: {k: gWalk, cell: gFoot[0], note: "Wait at the foot of the stairs", soft: true}, 3: {k: gWalk, cell: gFoot[1], note: "Wait at the foot of the stairs", soft: true}}},
			{"Swap: climb the stairs", "The fetchers climb to the ramparts; the new fetcher picks up a bomb.", map[int]goal{
				1: {k: gWalk, cell: [2]int{5, 1}, note: "Climb the stairs to the marked spot"}, 3: {k: gWalk, cell: gLoadCell[3], note: "Climb the stairs to the marked spot"}, 2: {k: gPickup}}},
			{"Throw it up", "Throw the bomb up to the gunner on the left rampart.", map[int]goal{
				2: {k: gThrow, mate: 3}, 3: {k: gCatch, mate: 2, cell: gLoadCell[3]}, 1: {k: gWalk, cell: [2]int{5, 1}, note: "Wait on the marked spot", soft: true}}},
			{"Load and fire", "Load the catapult: it fires by itself at the machine in its lane.", map[int]goal{
				3: {k: gLoad, cat: 3}, 2: {k: gPickup, note: "Pick up another bomb"}, 1: {k: gWalk, cell: [2]int{5, 1}, note: "Wait on the marked spot", soft: true}}},
			{"Lob it onto the rampart", "With nobody on the line, a thrown bomb lands on the rampart by the catapult.", map[int]goal{
				2: {k: gLob, cell: gLoadCell[1]}, 1: {k: gWalk, cell: [2]int{5, 1}, note: "Stay off the line: wait here", soft: true},
				3: {k: gWalk, cell: gLoadCell[3], note: "Wait at your catapult", soft: true}}},
			{"Pick it up and load", "Pick up the bomb on the rampart and load the catapult.", map[int]goal{
				1: {k: gLoad, cat: 1}, 2: {k: gPickup, note: "Pick up another bomb"},
				3: {k: gWalk, cell: gLoadCell[3], note: "Wait at your catapult", soft: true}}},
			live,
		}
	}
	// Two or four: pairs (1 fetches for 2) and (3 fetches for 4); halfway
	// they swap.
	pairs := min(n, 4) / 2
	g := func(f func(pair, fetcher, gunner int) (goal, goal)) map[int]goal {
		m := map[int]goal{}
		for i := range pairs {
			fg, gg := f(i, 2*i+1, 2*i+2)
			m[2*i+1], m[2*i+2] = fg, gg
		}
		return m
	}
	catA := func(i int) int { return [2]int{0, 3}[i] } // phase A: catapults 0 (top) and 3 (left, where seat 4 starts)
	catB := func(i int) int { return [2]int{1, 3}[i] } // phase B: catapults 1 (top) and 3 again (left)
	return []gstep{
		{"Pick up a bomb", "Fetchers pick up a bomb in the store; gunners walk to their catapult.", g(func(i, f, gu int) (goal, goal) {
			return goal{k: gPickup, cell: gBomb[i]}, goal{k: gWalk, cell: gLoadCell[catA(i)], note: "Walk along the rampart to the marked catapult", soft: true}
		})},
		{"Throw it up", "Fetchers step into line and throw the bomb up; gunners catch it.", g(func(i, f, gu int) (goal, goal) {
			return goal{k: gThrow, mate: gu}, goal{k: gCatch, mate: f, cell: gLoadCell[catA(i)]}
		})},
		{"Load and fire", "Gunners load the catapult: it fires by itself at the machine in its lane.", g(func(i, f, gu int) (goal, goal) {
			return goal{k: gWalk, cell: gFoot[i], note: "Walk to the foot of the stairs", soft: true}, goal{k: gLoad, cat: catA(i)}
		})},
		{"Swap: gunners come down", "Time to swap jobs: gunners take the stairs down to the yard.", g(func(i, f, gu int) (goal, goal) {
			return goal{k: gWalk, cell: gFoot[i], note: "Wait at the foot of the stairs", soft: true}, goal{k: gWalk, cell: gYard[i], note: "Take the stairs down to the marked spot"}
		})},
		{"Swap: climb the stairs", "Fetchers climb to the ramparts; the new fetchers pick up a bomb.", g(func(i, f, gu int) (goal, goal) {
			return goal{k: gWalk, cell: gLoadCell[catB(i)], note: "Climb the stairs to the marked catapult"}, goal{k: gPickup}
		})},
		{"Throw it up", "Now the other way round: throw the bomb up to your teammate.", g(func(i, f, gu int) (goal, goal) {
			return goal{k: gCatch, mate: gu, cell: gLoadCell[catB(i)]}, goal{k: gThrow, mate: f}
		})},
		{"Load and fire", "Load the catapult: it fires by itself at the machine in its lane.", g(func(i, f, gu int) (goal, goal) {
			return goal{k: gLoad, cat: catB(i)}, goal{k: gPickup, note: "Pick up another bomb"}
		})},
		live,
	}
}

// startGuide sets up level 1's board for the tutorial: no level script;
// still targets in the lanes the script loads.
func (g *Game) startGuide() {
	g.setupBoard(1)
	gs := &guideState{seats: map[string]int{}, pids: map[int]string{}, prog: map[string]*progress{}}
	n := 0
	for _, p := range g.players {
		if p.placed {
			n++
			gs.seats[p.id], gs.pids[n] = n, p.id
		}
	}
	gs.steps = guideScript(min(max(n, 1), 4))
	g.guide = gs
	lanes := map[int]bool{}
	for _, st := range gs.steps {
		for _, gl := range st.goals {
			if gl.k == gLoad {
				lanes[g.keep.Catapults[gl.cat].Lane] = true
			}
		}
	}
	for l := range len(g.keep.Lanes) {
		if lanes[l] {
			g.addTarget(l)
		}
	}
	g.enterStep(0)
	g.startPlan(1)
}

func (g *Game) addTarget(lane int) {
	g.script = append(g.script, spawnEntry{round: g.round, lane: lane, kind: "scrap", hp: Defs.Machines["scrap"].HP})
	g.spawnRound(g.round, "")
}

func (g *Game) progressOf(pid string) *progress {
	gs := g.guide
	if gs.prog[pid] == nil {
		gs.prog[pid] = newProgress()
	}
	return gs.prog[pid]
}

// enterStep starts step i: what counts for it is what was done since the
// previous step began (so a goal met a turn early still counts).
func (g *Game) enterStep(i int) {
	gs := g.guide
	gs.i = i
	gs.base = gs.next
	gs.next = map[string]*progress{}
	for _, p := range g.players {
		gs.next[p.id] = g.progressOf(p.id).clone()
	}
	if gs.base == nil {
		gs.base = gs.next
	}
	gs.done = map[string]bool{}
	if gs.live() {
		lanes := map[int]bool{}
		for _, st := range gs.steps {
			for _, gl := range st.goals {
				if gl.k == gLoad {
					lanes[g.keep.Catapults[gl.cat].Lane] = true
				}
			}
		}
		// The last phase's lanes: the catapults loaded in the second half.
		last := map[int]bool{}
		for _, st := range gs.steps[len(gs.steps)/2:] {
			for _, gl := range st.goals {
				if gl.k == gLoad {
					last[g.keep.Catapults[gl.cat].Lane] = true
				}
			}
		}
		if len(last) > 0 {
			lanes = last
		}
		extra := len(gs.pids) > 1 // a team gets one more, a turn later
		for l := range len(g.keep.Lanes) {
			if lanes[l] {
				g.script = append(g.script, spawnEntry{round: g.round, lane: l, kind: "scrap", hp: 1})
				if extra {
					g.script = append(g.script, spawnEntry{round: g.round + 1, lane: l, kind: "scrap", hp: 1})
					extra = false
				}
			}
		}
		g.spawnRound(g.round, "")
		return
	}
	for _, gl := range gs.step().goals { // a target in every lane about to be shot at
		gl = g.fixGoal(gl)
		if gl.k == gLoad {
			lane := g.keep.Catapults[gl.cat].Lane
			if !slices.ContainsFunc(g.machines, func(m *machine) bool { return m.lane == lane }) {
				g.addTarget(lane)
			}
		}
	}
	g.checkGoals()
}

// guideEvents records what the turn's events achieved.
func (g *Game) guideEvents(batch []any) {
	for _, e := range batch {
		switch ev := e.(type) {
		case EvPickup:
			if ev.Result == "ok" {
				g.progressOf(ev.PID).picked++
			}
		case EvThrow:
			switch ev.Result {
			case "caught":
				g.progressOf(ev.PID).threwTo[ev.By]++
				g.progressOf(ev.By).caughtFrom[ev.PID]++
			case "landed":
				g.progressOf(ev.PID).lobbed[ev.At]++
			}
		case EvFire:
			if ev.PID != "" && slices.ContainsFunc(ev.Hits, func(h Hit) bool { return h.Killed }) {
				g.progressOf(ev.PID).kills++
			}
		}
	}
	g.checkGoals()
}

// waived: a goal whose player (or partner) is gone or away does not count.
func (g *Game) waived(pid string, gl goal) bool {
	p := g.player(pid)
	if p == nil || !p.placed || g.away(p) {
		return true
	}
	if gl.k == gThrow || gl.k == gCatch {
		m := g.player(g.guide.pids[gl.mate])
		return m == nil || !m.placed || g.away(m)
	}
	return false
}

// checkGoals marks the current step's goals that are met.
func (g *Game) checkGoals() {
	gs := g.guide
	for seat, gl := range gs.step().goals {
		gl = g.fixGoal(gl)
		pid := gs.pids[seat]
		p := g.player(pid)
		if p == nil || gs.done[pid] {
			continue
		}
		now, base := g.progressOf(pid), gs.base[pid]
		if base == nil {
			base = newProgress()
		}
		mate := gs.pids[gl.mate]
		ok := false
		switch gl.k {
		case gWalk:
			ok = p.placed && [2]int{p.x, p.y} == gl.cell
		case gPickup:
			ok = p.carry != nil || now.picked > base.picked
		case gThrow:
			ok = now.threwTo[mate] > base.threwTo[mate]
		case gCatch:
			ok = now.caughtFrom[mate] > base.caughtFrom[mate]
		case gLoad:
			ok = now.kills > base.kills
		case gLob:
			ok = now.lobbed[gl.cell] > base.lobbed[gl.cell] || g.bombAt(gl.cell[0], gl.cell[1]) != nil
		}
		if ok {
			gs.done[pid] = true
			g.slowVer++
		}
	}
}

// fixGoal works around an away engineer standing where a goal needs someone
// (they stay on the board): a catapult whose loading cell they hold is
// swapped for the other one on that rampart, a spot they hold for the
// nearest free cell next to it.
func (g *Game) fixGoal(gl goal) goal {
	held := func(c [2]int) bool {
		o := g.engineerAt(c[0], c[1])
		return o != nil && g.away(o)
	}
	alt := [4]int{1, 0, 3, 2}
	switch gl.k {
	case gLoad:
		if held(gLoadCell[gl.cat]) && !held(gLoadCell[alt[gl.cat]]) {
			gl.cat = alt[gl.cat]
		}
	case gWalk, gCatch:
		if !held(gl.cell) {
			break
		}
		if i := slices.Index(gLoadCell[:], gl.cell); i >= 0 && !held(gLoadCell[alt[i]]) {
			gl.cell = gLoadCell[alt[i]]
			break
		}
		for _, dv := range Dirs4 {
			n := [2]int{gl.cell[0] + dv[0], gl.cell[1] + dv[1]}
			if g.lay.CanStep(gl.cell[0], gl.cell[1], n[0], n[1]) && !held(n) {
				gl.cell = n
				break
			}
		}
	}
	return gl
}

// stepDone: every goal of the step is met or waived; the live step when no
// machine is left.
func (g *Game) stepDone() bool {
	gs := g.guide
	if gs.live() {
		return len(g.machines) == 0 && len(g.script) == 0
	}
	for seat, gl := range gs.step().goals {
		pid := gs.pids[seat]
		if !gl.soft && !gs.done[pid] && !g.waived(pid, gl) {
			return false
		}
	}
	return true
}

func (g *Game) guideAfterTurn() {
	g.checkGoals()
	for g.guide != nil && g.stepDone() {
		if g.guide.i+1 >= len(g.guide.steps) {
			g.finishGuide()
			return
		}
		g.enterStep(g.guide.i + 1)
	}
	g.startPlan(g.round + 1)
}

// finishGuide ends the tutorial: the wall is repaired, the stats cleared, and
// level 1 starts.
func (g *Game) finishGuide() {
	g.guide = nil
	g.wall = Defs.WallHP
	for _, p := range g.players {
		p.st = stats{}
	}
	g.startLevel(1)
}

// SkipTutorial is the host ending the guide now: level 1 starts.
func (g *Game) SkipTutorial(pid string) error {
	if pid != g.host {
		return ErrNotHost
	}
	if g.guide == nil || (g.phase != PhasePlan && g.phase != PhaseResolve) {
		return ErrTooLate
	}
	g.finishGuide()
	return nil
}

// --- the snap view and the suggested queues --------------------------------------

func (g *Game) guideSnap() *GuideSnap {
	gs := g.guide
	if gs == nil {
		return nil
	}
	st := gs.step()
	out := &GuideSnap{Step: gs.i + 1, Of: len(gs.steps), Title: st.title, Text: st.text, Tasks: []GuideTask{}}
	plans := g.guidePlans()
	for _, p := range g.players {
		if !p.placed {
			continue
		}
		seat, ok := gs.seats[p.id]
		gl, has := st.goals[seat]
		gl = g.fixGoal(gl)
		t := GuideTask{PID: p.id}
		switch {
		case !ok || !has:
			t.Text, t.Done = "Watch this one: you join in from level 1.", true
		case gs.live():
			t.Text = "Fetch bombs from the store and throw them up."
			if g.lay.At(p.x, p.y).H > 0 {
				t.Text = "Catch the bombs and load the catapults."
			}
		case gs.done[p.id] || g.waived(p.id, gl):
			t.Text, t.Done = "Done! Wait for the others.", true
			t.Acts = []Act{}
			if pl := plans[p.id]; pl != nil && len(pl.acts) > 0 {
				t.Text, t.Acts = "Done! Step aside to let a teammate through.", pl.acts
			}
		default:
			pl := plans[p.id]
			t.Text = g.taskText(p, gl)
			if pl != nil {
				t.Acts = pl.acts
				if pl.mark != nil {
					c := *pl.mark
					t.Cell = &c
				}
			}
		}
		out.Tasks = append(out.Tasks, t)
	}
	return out
}

func (g *Game) nameOf(seat int) string {
	if p := g.player(g.guide.pids[seat]); p != nil {
		return p.name
	}
	return "your teammate"
}

func (g *Game) taskText(p *player, gl goal) string {
	if gl.note != "" {
		return gl.note
	}
	switch gl.k {
	case gWalk:
		return "Walk to the marked spot"
	case gPickup:
		return "Walk onto a bomb and pick it up"
	case gThrow:
		if p.carry == nil {
			return fmt.Sprintf("Get a bomb and throw it to %s", g.nameOf(gl.mate))
		}
		return fmt.Sprintf("Step into line and throw to %s", g.nameOf(gl.mate))
	case gCatch:
		return fmt.Sprintf("Stand on the mark and catch %s's throw", g.nameOf(gl.mate))
	case gLoad:
		if p.carry == nil {
			return "Fetch the bomb and load the catapult"
		}
		return "Load the marked catapult"
	case gLob:
		return "Throw the bomb up onto the rampart"
	}
	return ""
}

// dec is one suggested action, in board terms.
type dec struct {
	a    Act
	to   [2]int
	dir  [2]int
	cat  int
	kind string
}

// stepAside moves a waiting soft-goal engineer off cell n (to a free
// neighbour that is not from, the cell of the one coming in) and reports
// whether it did.
func (g *Game) stepAside(n, from [2]int, order []*player, goalOf map[string]goal, decs map[string]dec, sim *guideSim, occ, entering map[[2]int]bool, leaving map[[2]int][2]int) bool {
	for _, o := range order {
		d, decided := decs[o.id]
		if sim.pos[o.id] != n || !goalOf[o.id].soft || !decided || d.kind != "" {
			continue
		}
		for _, dv := range Dirs4 {
			m := [2]int{n[0] + dv[0], n[1] + dv[1]}
			if m == from || occ[m] || entering[m] || !g.lay.CanStep(n[0], n[1], m[0], m[1]) {
				continue
			}
			decs[o.id] = dec{a: Dir(AMove, dv[0], dv[1]), to: m, kind: AMove}
			entering[m], leaving[n] = true, m
			delete(occ, n)
			return true
		}
		return false
	}
	return false
}

type gplan struct {
	acts []Act
	mark *[2]int
}

// guideSim is the board as the suggested queues would leave it, slot by slot.
type guideSim struct {
	pos   map[string][2]int
	carry map[string]bool
	bombs map[[2]int]bool
	full  []bool // catapults loaded
}

// guidePlans path-finds a suggested queue for every player with an open goal,
// together, slot by slot: in seat order each player picks an action for the
// slot on the board the earlier slots left, never stepping into a cell
// someone stays on or another player is entering
// (so the suggestions never bump).
func (g *Game) guidePlans() map[string]*gplan {
	gs := g.guide
	out := map[string]*gplan{}
	if gs.live() {
		return out
	}
	sim := &guideSim{pos: map[string][2]int{}, carry: map[string]bool{}, bombs: map[[2]int]bool{}, full: make([]bool, len(g.cats))}
	var order []*player
	for _, p := range g.players {
		if p.placed {
			sim.pos[p.id] = [2]int{p.x, p.y}
			sim.carry[p.id] = p.carry != nil
		}
	}
	for _, b := range g.bombs {
		sim.bombs[[2]int{b.x, b.y}] = true
	}
	for i, c := range g.cats {
		sim.full[i] = c != nil
	}
	goalOf := map[string]goal{}
	for seat := 1; seat <= len(gs.pids); seat++ {
		p := g.player(gs.pids[seat])
		gl, ok := gs.step().goals[seat]
		gl = g.fixGoal(gl)
		if p == nil || !p.placed || g.away(p) {
			continue
		}
		if !ok || gs.done[p.id] || g.waived(p.id, gl) {
			gl = goal{soft: true} // done: stays, or steps aside for someone
		}
		goalOf[p.id] = gl
		order = append(order, p)
		out[p.id] = &gplan{}
	}
	// Players only walking ahead or out of the way decide first, so the
	// others can walk into the cells they leave.
	slices.SortStableFunc(order, func(a, b *player) int {
		sa, sb := goalOf[a.id].soft, goalOf[b.id].soft
		switch {
		case sa && !sb:
			return -1
		case sb && !sa:
			return 1
		}
		return 0
	})
	finished := map[string]bool{}
	claimedBomb := map[[2]int]string{}
	for range Defs.Slots {
		occ := map[[2]int]bool{}
		for _, at := range sim.pos {
			occ[at] = true
		}
		entering := map[[2]int]bool{}
		leaving := map[[2]int][2]int{} // cell → where its engineer walks this slot
		want := map[string][2]int{}    // blocked walkers: the step they want
		decs := map[string]dec{}
		for _, p := range order {
			gl := goalOf[p.id]
			pl := out[p.id]
			here := sim.pos[p.id]
			wait := dec{a: Act{A: AWait}}
			if finished[p.id] || gl.k == 0 {
				decs[p.id] = wait
				continue
			}
			step := func(target func(c [2]int) bool) dec {
				// A cell is free if nobody stands there, or its engineer has
				// already chosen to walk out (but not into here: a swap bumps).
				blocked := func(c [2]int) bool {
					return c != here && (occ[c] || entering[c] || leaving[c] == here)
				}
				// Someone only waiting on the way steps aside rather than
				// sending us round.
				if n, _, ok := g.stepToward(here, target, func([2]int) bool { return false }); ok && n != here && blocked(n) && !gl.soft {
					if g.stepAside(n, here, order, goalOf, decs, sim, occ, entering, leaving) {
						entering[n] = true
						delete(occ, here)
						leaving[here] = n
						return dec{a: Dir(AMove, n[0]-here[0], n[1]-here[1]), to: n, kind: AMove}
					}
				}
				next, goal, ok := g.stepToward(here, target, blocked)
				if ok && next == here && goal != here {
					want[p.id], _, _ = g.stepToward(here, target, func([2]int) bool { return false })
				}
				if pl.mark == nil && ok {
					m := goal
					pl.mark = &m
				}
				if !ok || next == here {
					return wait
				}
				entering[next] = true
				delete(occ, here)
				leaving[here] = next
				return dec{a: Dir(AMove, next[0]-here[0], next[1]-here[1]), to: next, kind: AMove}
			}
			fetch := func() dec {
				free := func(c [2]int) bool {
					return sim.bombs[c] && (claimedBomb[c] == "" || claimedBomb[c] == p.id)
				}
				if free(here) {
					claimedBomb[here] = p.id
					if pl.mark == nil {
						m := here
						pl.mark = &m
					}
					return dec{a: Act{A: APickup}, kind: APickup}
				}
				// Loading takes a bomb lying on the rampart if there is one;
				// anything else a bomb at the engineer's own height if there
				// is one (no climbing for it); a pick-up prefers its marked
				// bomb.
				wantH := g.lay.At(here[0], here[1]).H
				if gl.k == gLoad {
					wantH = 1
				}
				level := false
				for c := range sim.bombs {
					if free(c) && g.lay.At(c[0], c[1]).H == wantH {
						level = true
					}
				}
				pref := gl.cell
				return step(func(c [2]int) bool {
					if !free(c) || level && g.lay.At(c[0], c[1]).H != wantH {
						return false
					}
					return gl.k != gPickup || pref == [2]int{} || c == pref || !free(pref)
				})
			}
			var d dec
			switch gl.k {
			case gCatch:
				if pl.mark == nil {
					m := gl.cell
					pl.mark = &m
				}
				if !sim.carry[p.id] {
					d = step(func(c [2]int) bool { return c == gl.cell })
					if here == gl.cell {
						d = wait
					}
					break
				}
				// Full hands can't catch: load what you hold if a catapult is
				// free next to you, else throw it away.
				d = wait
				for _, c := range g.keep.Catapults {
					if g.lay.LoadCell(here[0], here[1], c) && !sim.full[c.ID] {
						d = dec{a: Act{A: ALoad}, cat: c.ID, kind: ALoad}
						break
					}
				}
				if d.kind == "" {
					for _, dv := range Dirs4 {
						line := g.lay.ThrowLine(here[0], here[1], dv[0], dv[1], Defs.ThrowRange)
						if _, ok := g.lay.Landing(line); !ok || slices.ContainsFunc(line, func(c [2]int) bool {
							for _, at := range sim.pos {
								if at == c {
									return true
								}
							}
							return false
						}) {
							continue
						}
						d = dec{a: Dir(AThrow, dv[0], dv[1]), dir: dv, kind: AThrow}
						break
					}
				}
			case gWalk:
				if pl.mark == nil {
					m := gl.cell
					pl.mark = &m
				}
				if here == gl.cell {
					d = wait
				} else {
					d = step(func(c [2]int) bool { return c == gl.cell })
				}
			case gPickup:
				if sim.carry[p.id] {
					finished[p.id] = true
					d = wait
				} else {
					d = fetch()
				}
			case gThrow, gLob:
				if !sim.carry[p.id] {
					d = fetch()
					break
				}
				hits := func(c [2]int) (dir [2]int, ok bool) {
					for _, dv := range Dirs4 {
						line := g.lay.ThrowLine(c[0], c[1], dv[0], dv[1], Defs.ThrowRange)
						land, can := g.lay.Landing(line)
						if !can {
							continue
						}
						var stop string
						for _, lc := range line {
							for pid, at := range sim.pos {
								if pid != p.id && at == lc && stop == "" {
									stop = pid
								}
							}
							if stop != "" {
								break
							}
						}
						if gl.k == gThrow && stop == gs.pids[gl.mate] && !sim.carry[stop] {
							return dv, true
						}
						if gl.k == gLob && stop == "" && land == gl.cell {
							return dv, true
						}
					}
					return [2]int{}, false
				}
				if dv, ok := hits(here); ok {
					if pl.mark == nil {
						m := here
						pl.mark = &m
					}
					d = dec{a: Dir(AThrow, dv[0], dv[1]), dir: dv, kind: AThrow}
					finished[p.id] = true
				} else {
					d = step(func(c [2]int) bool { _, ok := hits(c); return ok })
				}
			case gLoad:
				lc := gLoadCell[gl.cat]
				if !sim.carry[p.id] {
					d = fetch()
					break
				}
				if here == lc && !sim.full[gl.cat] {
					if pl.mark == nil {
						m := lc
						pl.mark = &m
					}
					d = dec{a: Act{A: ALoad}, cat: gl.cat, kind: ALoad}
					finished[p.id] = true
				} else {
					d = step(func(c [2]int) bool { return c == lc })
				}
			}
			decs[p.id] = d
		}
		// A walker with a real goal, blocked by someone who is only waiting
		// (done, or walking ahead) who decided after them, asks them to step
		// aside and takes their cell.
		for _, h := range order {
			n, ok := want[h.id]
			if !ok || goalOf[h.id].soft || decs[h.id].kind != "" {
				continue
			}
			here := sim.pos[h.id]
			if g.stepAside(n, here, order, goalOf, decs, sim, occ, entering, leaving) {
				decs[h.id] = dec{a: Dir(AMove, n[0]-here[0], n[1]-here[1]), to: n, kind: AMove}
				entering[n], leaving[here] = true, n
				delete(occ, here)
			}
		}
		// Play the slot on the sim: throws (start-of-slot positions), moves,
		// pick-ups, loads.
		for _, p := range order {
			d := decs[p.id]
			pl := out[p.id]
			pl.acts = append(pl.acts, d.a)
			if d.kind != AThrow {
				continue
			}
			here := sim.pos[p.id]
			sim.carry[p.id] = false
			line := g.lay.ThrowLine(here[0], here[1], d.dir[0], d.dir[1], Defs.ThrowRange)
			land, _ := g.lay.Landing(line)
			caught := false
			for _, lc := range line {
				for pid, at := range sim.pos {
					if pid != p.id && at == lc && !caught {
						caught = true
						if !sim.carry[pid] {
							sim.carry[pid] = true
						} else {
							sim.bombs[lc] = true
						}
					}
				}
				if caught {
					break
				}
			}
			if !caught {
				sim.bombs[land] = true
			}
		}
		for _, p := range order {
			if d := decs[p.id]; d.kind == AMove {
				sim.pos[p.id] = d.to
			}
		}
		for _, p := range order {
			switch d := decs[p.id]; d.kind {
			case APickup:
				delete(sim.bombs, sim.pos[p.id])
				sim.carry[p.id] = true
			case ALoad:
				sim.full[d.cat] = true
				sim.carry[p.id] = false
			}
		}
	}
	for _, pl := range out {
		for len(pl.acts) > 0 && pl.acts[len(pl.acts)-1].A == AWait {
			pl.acts = pl.acts[:len(pl.acts)-1]
		}
		if pl.acts == nil {
			pl.acts = []Act{}
		}
	}
	return out
}

// stepToward is the first step of a shortest walk from here to the nearest
// cell where target holds (that cell is returned too). The walk is planned
// on the bare layout; the step must not enter a blocked cell. If every
// shortest step is blocked it detours around the engineers, and if that is
// impossible too it stays (next == here).
func (g *Game) stepToward(here [2]int, target func(c [2]int) bool, blocked func(c [2]int) bool) (next, goal [2]int, ok bool) {
	d := g.distTo(target, nil)
	dh, reach := d[here]
	if !reach {
		return here, here, false
	}
	goal = here
	for c := here; ; { // the nearest target, for the mark
		if d[c] == 0 {
			goal = c
			break
		}
		moved := false
		for _, dv := range Dirs4 {
			n := [2]int{c[0] + dv[0], c[1] + dv[1]}
			if v, ok := d[n]; ok && v == d[c]-1 && g.lay.CanStep(c[0], c[1], n[0], n[1]) {
				c, moved = n, true
				break
			}
		}
		if !moved {
			break
		}
	}
	if dh == 0 {
		return here, goal, true
	}
	for _, try := range []map[[2]int]int{d, g.distTo(target, blocked)} {
		dh, ok := try[here]
		if !ok {
			continue
		}
		for _, dv := range Dirs4 {
			n := [2]int{here[0] + dv[0], here[1] + dv[1]}
			if v, ok := try[n]; ok && v == dh-1 && g.lay.CanStep(here[0], here[1], n[0], n[1]) && !blocked(n) {
				return n, goal, true
			}
		}
	}
	return here, goal, true
}

// distTo: walking steps from every cell to the nearest target cell, through
// cells that are not blocked (blocked may be nil).
func (g *Game) distTo(target func(c [2]int) bool, blocked func(c [2]int) bool) map[[2]int]int {
	l := g.lay
	d := map[[2]int]int{}
	var q [][2]int
	for y := range l.H {
		for x := range l.W {
			if c := [2]int{x, y}; l.Walkable(x, y) && target(c) && (blocked == nil || !blocked(c)) {
				d[c] = 0
				q = append(q, c)
			}
		}
	}
	for len(q) > 0 {
		c := q[0]
		q = q[1:]
		for _, dv := range Dirs4 {
			n := [2]int{c[0] + dv[0], c[1] + dv[1]}
			if _, seen := d[n]; seen || !l.In(n[0], n[1]) || !l.CanStep(c[0], c[1], n[0], n[1]) {
				continue
			}
			if blocked != nil && blocked(n) {
				// still reachable as the walker's own cell
				d[n] = d[c] + 1
				continue
			}
			d[n] = d[c] + 1
			q = append(q, n)
		}
	}
	return d
}
