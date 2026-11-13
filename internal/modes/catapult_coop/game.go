// Package catapultcoop is the catapult_coop mode: a turn-based co-op game in
// which engineers carry, throw and load bombs into four catapults on the
// ramparts of a keep (docs/CATAPULT_COOP.md). The package is the pure
// simulation: no goroutines, no clocks, no networking. Time advances only
// through Step and all randomness comes from the injected rng.
package catapultcoop

import (
	"fmt"
	"maps"
	"math"
	"math/rand/v2"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Palette is the fixed player colour palette (same as the other modes).
var Palette = []string{"#e0a030", "#4fb39a", "#d1594a", "#6f8fe0", "#c77dd6", "#9bc53d", "#e07a30", "#3ec1d3"}

// NameMaxLen is the maximum player name length in characters.
const NameMaxLen = 12

type stats struct {
	throws, catches, pickups, loads, fires, kills, dmg, steps, bumps int
}

type player struct {
	id, name, color string
	connected       bool
	connSeq         uint64
	ready           bool
	missed          int // rounds in a row resolved without a plan from this player

	placed bool // has an engineer on the board
	x, y   int
	carry  *BombRef
	plan   *Plan

	perks map[string]int
	offer []string
	st    stats
}

type bomb struct {
	id   int
	kind string
	x, y int
}

type machine struct {
	id     int
	kind   string
	def    *MachineDef
	lane   int
	pos    int
	hp     int
	max    int
	frozen int
	age    int // advance stages taken unfrozen
}

type spawnEntry struct {
	round int
	lane  int
	kind  string
	hp    int
}

// Game is one room's game.
type Game struct {
	rng *rand.Rand

	phase  Phase
	time   float64
	left   float64 // seconds left in plan / resolve / break
	level  int
	round  int
	rounds int // rounds resolved this game

	players []*player
	nextPID int
	host    string
	connSeq uint64

	openPlans bool
	keep      *Keep
	lay       *Layout

	wall     int
	bombs    []*bomb    // on the ground
	cats     []*BombRef // per catapult: loaded bomb or nil
	machines []*machine
	script   []spawnEntry // this level's spawns not yet made
	nextMID  int
	nextBID  int

	events  []any
	slowVer uint64
	end     *End
}

// New creates a game in the lobby phase.
func New(rng *rand.Rand) *Game {
	g := &Game{rng: rng, nextPID: 1}
	g.reset()
	return g
}

func (g *Game) reset() {
	g.phase = PhaseLobby
	g.time, g.left, g.level, g.round, g.rounds = 0, 0, 0, 0, 0
	g.keep, g.lay = nil, nil
	g.wall = Defs.WallHP
	g.bombs, g.cats, g.machines, g.script, g.events = nil, nil, nil, nil, nil
	g.nextMID, g.nextBID = 1, 1
	g.end = nil
	for _, p := range g.players {
		p.ready, p.missed, p.placed, p.carry, p.plan = false, 0, false, nil, nil
		p.perks, p.offer, p.st = map[string]int{}, nil, stats{}
	}
	g.slowVer++
}

// --- accessors -----------------------------------------------------------------

func (g *Game) Phase() Phase        { return g.phase }
func (g *Game) Host() string        { return g.host }
func (g *Game) SlowVersion() uint64 { return g.slowVer }
func (g *Game) Running() bool {
	return g.phase == PhasePlan || g.phase == PhaseResolve || g.phase == PhaseBreak
}
func (g *Game) HasPlayer(id string) bool { return g.player(id) != nil }
func (g *Game) Level() int               { return g.level }
func (g *Game) Round() int               { return g.round }
func (g *Game) Wall() int                { return g.wall }
func (g *Game) Time() float64            { return g.time }
func (g *Game) End() *End                { return g.end }
func (g *Game) Keep() *Keep              { return g.keep }
func (g *Game) Layout() *Layout          { return g.lay }

func (g *Game) player(id string) *player {
	for _, p := range g.players {
		if p.id == id {
			return p
		}
	}
	return nil
}

func (g *Game) connectedCount() int {
	n := 0
	for _, p := range g.players {
		if p.connected {
			n++
		}
	}
	return n
}

// away: disconnected, or missed AwayAfter rounds in a row.
func (g *Game) away(p *player) bool { return !p.connected || p.missed >= Defs.AwayAfter }

// activeCount is the number of players who count for scaling (≥ 1).
func (g *Game) activeCount() int {
	n := 0
	for _, p := range g.players {
		if !g.away(p) {
			n++
		}
	}
	return max(1, n)
}

func (g *Game) engineerAt(x, y int) *player {
	for _, p := range g.players {
		if p.placed && p.x == x && p.y == y {
			return p
		}
	}
	return nil
}

func (g *Game) bombAt(x, y int) *bomb {
	for _, b := range g.bombs {
		if b.x == x && b.y == y {
			return b
		}
	}
	return nil
}

func (g *Game) emit(ev any) { g.events = append(g.events, ev) }

// --- players ---------------------------------------------------------------------

// SanitizeName trims, strips control characters and validates length.
func SanitizeName(s string) (string, bool) {
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "")
	}
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || r == '�' {
			return -1
		}
		if unicode.IsSpace(r) {
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	n := utf8.RuneCountInString(s)
	if n < 1 || n > NameMaxLen {
		return "", false
	}
	return s, true
}

// AddPlayer creates a (disconnected) player. In the lobby a full room evicts
// a disconnected player; its id is returned in evicted. Joining is allowed in
// every phase; a running game seats the engineer when the player connects.
func (g *Game) AddPlayer(name string) (pid, evicted string, err error) {
	name, ok := SanitizeName(name)
	if !ok {
		return "", "", ErrBadName
	}
	if len(g.players) >= Defs.MaxPlayers {
		if g.phase != PhaseLobby {
			return "", "", ErrRoomFull
		}
		i := slices.IndexFunc(g.players, func(p *player) bool { return !p.connected })
		if i < 0 {
			return "", "", ErrRoomFull
		}
		evicted = g.players[i].id
		g.players = slices.Delete(g.players, i, i+1)
		if g.host == evicted {
			g.host = ""
		}
	}
	p := &player{id: fmt.Sprintf("p%d", g.nextPID), name: name, perks: map[string]int{}}
	g.nextPID++
	used := map[string]bool{}
	for _, o := range g.players {
		used[o.color] = true
	}
	for _, c := range Palette {
		if !used[c] {
			p.color = c
			break
		}
	}
	g.players = append(g.players, p)
	if g.host == "" {
		g.host = p.id
	}
	g.slowVer++
	return p.id, evicted, nil
}

// SetConnected marks a player (dis)connected: host migration, seating a late
// joiner's engineer, and the end-of-phase checks.
func (g *Game) SetConnected(pid string, on bool) {
	p := g.player(pid)
	if p == nil || p.connected == on {
		return
	}
	p.connected = on
	g.slowVer++
	if on {
		g.connSeq++
		p.connSeq = g.connSeq
		if h := g.player(g.host); h == nil || !h.connected {
			g.host = pid
		}
		if g.Running() && !p.placed {
			g.seatLate(p)
		}
		return
	}
	if g.host == pid {
		var best *player
		for _, o := range g.players {
			if o.connected && (best == nil || o.connSeq < best.connSeq) {
				best = o
			}
		}
		if best != nil {
			g.host = best.id
		}
	}
	g.checkPhaseEnd()
}

// --- commands --------------------------------------------------------------------

// Apply dispatches a client command. Unknown types are ignored (nil).
func (g *Game) Apply(pid string, c Cmd) error {
	p := g.player(pid)
	if p == nil {
		return ErrBadRequest
	}
	switch c.T {
	case "start":
		return g.Start(pid)
	case "restart":
		return g.Restart(pid)
	case "opt":
		return g.Opt(pid, c)
	case "plan":
		return g.SetPlan(pid, c)
	case "ready":
		r := true
		if c.Ready != nil {
			r = *c.Ready
		}
		return g.Ready(pid, r)
	case "perk":
		return g.Perk(pid, c.ID)
	}
	return nil
}

// Start begins the game (host, lobby, at least one player).
func (g *Game) Start(pid string) error {
	if pid != g.host {
		return ErrNotHost
	}
	if g.phase != PhaseLobby || len(g.players) == 0 {
		return badReq("The game has already started")
	}
	g.keep = keepFor(len(g.players))
	g.cats = make([]*BombRef, len(g.keep.Catapults))
	g.wall = Defs.WallHP
	for _, p := range g.players {
		p.missed = 0
	}
	g.startLevel(1)
	return nil
}

// Restart ends the game (host, any phase but the lobby) and returns everyone
// to the lobby.
func (g *Game) Restart(pid string) error {
	if pid != g.host {
		return ErrNotHost
	}
	if g.phase == PhaseLobby {
		return badReq("No game is running")
	}
	g.reset()
	return nil
}

// Opt sets a lobby option (host, lobby).
func (g *Game) Opt(pid string, c Cmd) error {
	if pid != g.host {
		return ErrNotHost
	}
	if g.phase != PhaseLobby {
		return badReq("Options can only change in the lobby")
	}
	if c.OpenPlans != nil && *c.OpenPlans != g.openPlans {
		g.openPlans = *c.OpenPlans
		g.slowVer++
	}
	return nil
}

// Ready marks a player ready during a break. Outside a break it is a harmless
// no-op (it races with the phase change).
func (g *Game) Ready(pid string, r bool) error {
	p := g.player(pid)
	if p == nil {
		return ErrBadRequest
	}
	if g.phase != PhaseBreak {
		return nil
	}
	g.stand(p)
	if p.ready != r {
		p.ready = r
		g.slowVer++
	}
	g.checkPhaseEnd()
	return nil
}

// stand marks a player as taking part again (any plan, ready or perk).
func (g *Game) stand(p *player) {
	if p.missed != 0 {
		p.missed = 0
		g.slowVer++
	}
}

// SetPlan validates and stores (or clears) a player's plan.
func (g *Game) SetPlan(pid string, c Cmd) error {
	p := g.player(pid)
	if p == nil {
		return ErrBadRequest
	}
	switch g.phase {
	case PhasePlan:
	case PhaseResolve, PhaseBreak:
		return ErrTooLate
	default:
		return badReq("Not now")
	}
	if !p.placed {
		return badPlan("You have no engineer yet")
	}
	if c.A == AClear {
		if p.plan != nil {
			p.plan = nil
			g.slowVer++
		}
		return nil
	}
	pl, err := g.validate(p, c)
	if err != nil {
		return err
	}
	p.plan = pl
	g.stand(p)
	g.slowVer++
	g.checkPhaseEnd()
	return nil
}

// validate checks a plan command against the board as it stands (the board
// only changes in resolve, so this is the board the plan will run on).
func (g *Game) validate(p *player, c Cmd) (*Plan, error) {
	can := abilities(p)
	l := g.lay
	xy := func() (int, int, error) {
		if c.X == nil || c.Y == nil {
			return 0, 0, badReq("Missing cell")
		}
		if !l.In(*c.X, *c.Y) {
			return 0, 0, badPlan("That cell is off the map")
		}
		return *c.X, *c.Y, nil
	}
	switch c.A {
	case AWait:
		return &Plan{A: AWait}, nil
	case AMove:
		x, y, err := xy()
		if err != nil {
			return nil, err
		}
		if x == p.x && y == p.y {
			return nil, badPlan("You are already there")
		}
		if !l.Walkable(x, y) {
			return nil, badPlan("You can't stand there")
		}
		budget := can.Move
		if p.carry != nil {
			budget = can.MoveCarry
		}
		path := l.Path(p.x, p.y, x, y)
		if path == nil || len(path) > budget {
			return nil, badPlan(fmt.Sprintf("Too far: you can walk %d cells", budget))
		}
		return &Plan{A: AMove, X: IntP(x), Y: IntP(y), Path: path}, nil
	case APickup:
		x, y, err := xy()
		if err != nil {
			return nil, err
		}
		if p.carry != nil {
			return nil, badPlan("Your hands are full")
		}
		if g.bombAt(x, y) == nil {
			return nil, badPlan("No bomb there")
		}
		if abs(x-p.x)+abs(y-p.y) > can.Reach {
			return nil, badPlan("Out of reach")
		}
		return &Plan{A: APickup, X: IntP(x), Y: IntP(y)}, nil
	case AThrow:
		x, y, err := xy()
		if err != nil {
			return nil, err
		}
		if p.carry == nil {
			return nil, badPlan("You are not carrying a bomb")
		}
		d := abs(x-p.x) + abs(y-p.y)
		if (x != p.x && y != p.y) || d < 1 || d > can.Throw {
			return nil, badPlan(fmt.Sprintf("Throw in a straight line, 1–%d cells", can.Throw))
		}
		if !l.Walkable(x, y) {
			return nil, badPlan("Throw to a cell someone can stand on")
		}
		return &Plan{A: AThrow, X: IntP(x), Y: IntP(y)}, nil
	case ALoad, AFire:
		cat, err := g.pickCatapult(p, c.Cat)
		if err != nil {
			return nil, err
		}
		if c.A == ALoad {
			if p.carry == nil {
				return nil, badPlan("You are not carrying a bomb")
			}
			if g.cats[cat] != nil {
				return nil, badPlan("That catapult is already loaded")
			}
			if c.Fire && !can.QuickHands {
				return nil, badPlan("Loading and firing at once needs Quick Hands")
			}
			return &Plan{A: ALoad, Cat: IntP(cat), Fire: c.Fire}, nil
		}
		if g.cats[cat] == nil {
			return nil, badPlan("That catapult is not loaded")
		}
		return &Plan{A: AFire, Cat: IntP(cat)}, nil
	}
	return nil, badReq("Unknown action")
}

// pickCatapult resolves the catapult of a load/fire plan: the given id, which
// must be next to the engineer, or (id absent) the only one next to them.
func (g *Game) pickCatapult(p *player, id *int) (int, error) {
	if id != nil {
		if *id < 0 || *id >= len(g.keep.Catapults) {
			return 0, badReq("No such catapult")
		}
		if !g.lay.LoadCell(p.x, p.y, g.keep.Catapults[*id]) {
			return 0, badPlan("Stand next to the catapult, up on the rampart")
		}
		return *id, nil
	}
	found := -1
	for _, c := range g.keep.Catapults {
		if g.lay.LoadCell(p.x, p.y, c) {
			if found >= 0 {
				return 0, badReq("Say which catapult")
			}
			found = c.ID
		}
	}
	if found < 0 {
		return 0, badPlan("Stand next to the catapult, up on the rampart")
	}
	return found, nil
}

// --- phases ---------------------------------------------------------------------

// Step advances time. It does nothing outside plan/resolve/break or while no
// player is connected (the game pauses).
func (g *Game) Step(dt float64) {
	if !g.Running() || g.connectedCount() == 0 || dt <= 0 {
		return
	}
	g.time += dt
	g.left -= dt
	if g.left > 0 {
		return
	}
	switch g.phase {
	case PhasePlan:
		g.resolve()
	case PhaseResolve:
		g.afterResolve()
	case PhaseBreak:
		g.endBreak()
	}
}

// checkPhaseEnd ends a plan phase once every present player has planned, and
// a break once every present player is ready. Present = connected and not
// away; with nobody present only the timer ends the phase.
func (g *Game) checkPhaseEnd() {
	if g.phase != PhasePlan && g.phase != PhaseBreak {
		return
	}
	n := 0
	for _, p := range g.players {
		if g.away(p) || (g.phase == PhasePlan && !p.placed) {
			continue
		}
		n++
		if g.phase == PhasePlan && p.plan == nil || g.phase == PhaseBreak && !p.ready {
			return
		}
	}
	if n == 0 {
		return
	}
	if g.phase == PhasePlan {
		g.resolve()
	} else {
		g.endBreak()
	}
}

func (g *Game) startPlan(round int) {
	g.phase = PhasePlan
	g.round = round
	g.left = Defs.PlanTime
	for _, p := range g.players {
		p.plan = nil
	}
	g.slowVer++
}

// startLevel sets up level lv: its layout, engineers on its spawn cells
// (carried and loaded bombs are cleared), its authored bombs, the machine
// script (scaled to the active players now) and the round-0 spawns.
func (g *Game) startLevel(lv int) {
	g.level = lv
	ld := Defs.Levels[lv-1]
	g.lay = g.keep.LevelLayout(lv)
	g.emit(EvLevelStart{E: "level_start", Level: lv, Name: ld.Name, Layout: g.lay.ID})
	g.machines = nil
	g.bombs = nil
	for i := range g.cats {
		g.cats[i] = nil
	}
	for _, p := range g.players {
		p.placed, p.carry, p.plan, p.ready = false, nil, nil, false
	}
	for _, p := range g.players {
		if p.connected {
			g.seat(p)
		}
	}
	for _, at := range g.lay.Bombs {
		g.addBomb(at[0], at[1], g.drawKind(), "")
	}
	n := g.activeCount()
	g.script = nil
	for _, gr := range ld.Groups {
		hp := gr.hp(n)
		for i := range gr.count(n) {
			e := spawnEntry{round: gr.Start + i*gr.Every, lane: gr.Lanes[i%len(gr.Lanes)], kind: gr.Kind, hp: hp}
			for range gr.cluster() {
				g.script = append(g.script, e)
			}
		}
	}
	slices.SortStableFunc(g.script, func(a, b spawnEntry) int { return a.round - b.round })
	g.spawnRound(0, "")
	g.startPlan(1)
}

func (g *Game) afterResolve() {
	switch {
	case g.wall <= 0:
		g.finish(false)
	case len(g.script) == 0 && len(g.machines) == 0:
		g.emit(EvLevelClear{E: "level_clear", Level: g.level, Wall: g.wall})
		if g.level >= len(Defs.Levels) {
			g.finish(true)
			return
		}
		g.phase = PhaseBreak
		g.left = Defs.BreakTime
		for _, p := range g.players {
			p.ready, p.plan = false, nil
		}
		g.makeOffers()
		g.slowVer++
	default:
		g.startPlan(g.round + 1)
	}
}

func (g *Game) endBreak() {
	for _, p := range g.players {
		p.offer, p.ready = nil, false
	}
	g.startLevel(g.level + 1)
}

func (g *Game) finish(won bool) {
	if won {
		g.phase = PhaseWon
	} else {
		g.phase = PhaseLost
	}
	g.left = 0
	g.end = &End{Won: won, Level: g.level, Rounds: g.rounds, Wall: max(0, g.wall), Time: round1(g.time),
		Stats: map[string]StatsOut{}, Awards: g.awards()}
	for _, p := range g.players {
		so := p.st.out()
		so.Perks = maps.Clone(p.perks)
		g.end.Stats[p.id] = so
	}
	g.slowVer++
}

// --- seating ---------------------------------------------------------------------

// seat puts p's engineer on the first free spawn cell of the layout, else
// the free walkable cell nearest to the first spawn.
func (g *Game) seat(p *player) {
	for _, s := range g.lay.Spawns {
		if g.engineerAt(s[0], s[1]) == nil {
			g.place(p, s[0], s[1])
			return
		}
	}
	d := g.lay.Dists(g.lay.Spawns[0][0], g.lay.Spawns[0][1])
	best, bd := [2]int{-1, -1}, math.MaxInt
	for y := range g.lay.H {
		for x := range g.lay.W {
			if d[y][x] >= 0 && d[y][x] < bd && g.engineerAt(x, y) == nil {
				best, bd = [2]int{x, y}, d[y][x]
			}
		}
	}
	if best[0] >= 0 {
		g.place(p, best[0], best[1])
	}
}

func (g *Game) place(p *player, x, y int) {
	p.placed, p.x, p.y = true, x, y
	g.emit(EvPlace{E: "place", PID: p.id, X: x, Y: y})
}

// seatLate seats a player who connects while a game runs.
func (g *Game) seatLate(p *player) {
	g.seat(p)
	p.missed = 0
}

// --- bombs and machines ------------------------------------------------------------

func (g *Game) addBomb(x, y int, kind, stage string) {
	b := &bomb{id: g.nextBID, kind: kind, x: x, y: y}
	g.nextBID++
	g.bombs = append(g.bombs, b)
	g.emit(EvBomb{E: "bomb", S: stage, ID: b.id, Kind: kind, X: x, Y: y})
}

// drawKind picks a bomb kind from the level's weights. If no keg or grapeshot
// exists anywhere (ground, hands, catapults) and the level has one, the draw
// is limited to those, so a damaging bomb is always available.
func (g *Game) drawKind() string {
	w := Defs.Levels[g.level-1].Bombs
	needDmg := !g.anyDamaging()
	total := 0
	for _, k := range Defs.BombOrder {
		if needDmg && Defs.Bombs[k].Dmg == 0 {
			continue
		}
		total += w[k]
	}
	if total == 0 {
		needDmg = false
		for _, k := range Defs.BombOrder {
			total += w[k]
		}
	}
	x := g.rng.IntN(total)
	for _, k := range Defs.BombOrder {
		if needDmg && Defs.Bombs[k].Dmg == 0 {
			continue
		}
		if x -= w[k]; x < 0 {
			return k
		}
	}
	return Defs.BombOrder[0]
}

func (g *Game) anyDamaging() bool {
	dmg := func(k string) bool { return Defs.Bombs[k].Dmg > 0 }
	for _, b := range g.bombs {
		if dmg(b.kind) {
			return true
		}
	}
	for _, p := range g.players {
		if p.carry != nil && dmg(p.carry.Kind) {
			return true
		}
	}
	for _, c := range g.cats {
		if c != nil && dmg(c.Kind) {
			return true
		}
	}
	return false
}

// topUpBombs keeps bombsBase + bombsPerPlayer × active players on the ground,
// placing new ones on random free courtyard (height 0) floor cells with no
// bomb and no engineer.
func (g *Game) topUpBombs(stage string) {
	want := Defs.BombsBase + Defs.BombsPerPlayer*g.activeCount()
	for len(g.bombs) < want {
		var free [][2]int
		for y := range g.lay.H {
			for x := range g.lay.W {
				c := g.lay.Cells[y][x]
				if c.Kind == KFloor && c.H == 0 && g.bombAt(x, y) == nil && g.engineerAt(x, y) == nil {
					free = append(free, [2]int{x, y})
				}
			}
		}
		if len(free) == 0 {
			return
		}
		at := free[g.rng.IntN(len(free))]
		g.addBomb(at[0], at[1], g.drawKind(), stage)
	}
}

// spawnRound makes the script's machines for round r.
func (g *Game) spawnRound(r int, stage string) {
	i := 0
	for ; i < len(g.script) && g.script[i].round <= r; i++ {
		e := g.script[i]
		def := Defs.Machines[e.kind]
		m := &machine{id: g.nextMID, kind: e.kind, def: def, lane: e.lane, pos: g.keep.Lanes[e.lane].Len - 1, hp: e.hp, max: e.hp}
		g.nextMID++
		g.machines = append(g.machines, m)
		g.emit(EvSpawn{E: "spawn", S: stage, ID: m.id, Kind: m.kind, Lane: m.lane, Pos: m.pos, HP: m.hp})
	}
	g.script = g.script[i:]
}

// --- views -------------------------------------------------------------------------

// RoomState builds the `room` message.
func (g *Game) RoomState() *RoomMsg {
	keep, lay := g.keep, g.lay
	if keep == nil {
		keep = keepFor(max(1, len(g.players)))
		lay = keep.LevelLayout(1)
	}
	m := &RoomMsg{T: "room", Mode: ModeID, Phase: g.phase, Host: g.host, OpenPlans: g.openPlans,
		Keep: keep.ID, Layout: lay, Level: g.level, Levels: len(Defs.Levels), Round: g.round, End: g.end,
		Players: make([]PlayerInfo, 0, len(g.players))}
	for _, p := range g.players {
		pi := PlayerInfo{ID: p.id, Name: p.name, Color: p.color, Connected: p.connected, Away: g.away(p),
			Planned: p.plan != nil, Ready: p.ready, Offer: slices.Clone(p.offer), Perks: maps.Clone(p.perks), Can: abilities(p)}
		if g.openPlans && p.plan != nil {
			c := *p.plan
			pi.Plan = &c
		}
		m.Players = append(m.Players, pi)
	}
	return m
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

// Snapshot builds a `snap` message and drains the event list.
func (g *Game) Snapshot() *Snap { return g.snapshot(true) }

// View is Snapshot without events, leaving the event list alone.
func (g *Game) View() *Snap { return g.snapshot(false) }

func (g *Game) snapshot(drain bool) *Snap {
	s := &Snap{T: "snap", Phase: g.phase, Time: round1(g.time), Level: g.level, Round: g.round,
		Left: round1(math.Max(0, g.left)), Wall: max(0, g.wall), WallMax: Defs.WallHP,
		Engineers: []EngineerSnap{}, Bombs: []BombSnap{}, Catapults: []CatapultSnap{},
		Machines: []MachineSnap{}, Incoming: []Incoming{}, Ev: []any{}}
	if drain && len(g.events) > 0 {
		s.Ev = g.events
		g.events = nil
	}
	for _, p := range g.players {
		if p.placed {
			s.Engineers = append(s.Engineers, EngineerSnap{PID: p.id, X: p.x, Y: p.y, Carry: p.carry})
		}
	}
	for _, b := range g.bombs {
		s.Bombs = append(s.Bombs, BombSnap{ID: b.id, Kind: b.kind, X: b.x, Y: b.y})
	}
	for i, c := range g.cats {
		s.Catapults = append(s.Catapults, CatapultSnap{ID: i, Bomb: c})
	}
	for _, m := range g.machines {
		s.Machines = append(s.Machines, MachineSnap{ID: m.id, Kind: m.kind, Lane: m.lane, Pos: m.pos, HP: m.hp, Max: m.max, Frozen: m.frozen})
	}
	if g.phase == PhasePlan {
		for _, e := range g.script {
			if e.round == g.round {
				s.Incoming = append(s.Incoming, Incoming{Lane: e.lane, Kind: e.kind})
			}
		}
	}
	return s
}

// --- end of game ---------------------------------------------------------------------

func (s stats) out() StatsOut {
	return StatsOut{Throws: s.throws, Catches: s.catches, Pickups: s.pickups, Loads: s.loads, Fires: s.fires,
		Kills: s.kills, Dmg: s.dmg, Steps: s.steps, Bumps: s.bumps}
}

func (g *Game) awards() []Award {
	list := []struct {
		title, detail string
		val           func(s stats) int
	}{
		{"Sharpshooter", "%d machines destroyed", func(s stats) int { return s.kills }},
		{"Safe Hands", "%d catches", func(s stats) int { return s.catches }},
		{"Bomb Lobber", "%d throws", func(s stats) int { return s.throws }},
		{"Loader", "%d bombs loaded", func(s stats) int { return s.loads }},
		{"Marathon", "%d cells walked", func(s stats) int { return s.steps }},
		{"Traffic Jam", "%d bumps", func(s stats) int { return s.bumps }},
	}
	out := []Award{}
	for _, a := range list {
		var best *player
		bv := 0
		for _, p := range g.players {
			if v := a.val(p.st); v > bv {
				best, bv = p, v
			}
		}
		if best != nil {
			out = append(out, Award{PID: best.id, Title: a.title, Detail: fmt.Sprintf(a.detail, bv)})
		}
	}
	return out
}
