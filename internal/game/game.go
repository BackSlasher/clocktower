// Package game is the pure Clocktower simulation: no goroutines, no clocks,
// no networking. Time advances only through Step and all randomness comes
// from the injected RNG, so a game is fully deterministic.
package game

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

// Palette is the fixed player colour palette.
var Palette = []string{"#e0a030", "#4fb39a", "#d1594a", "#6f8fe0", "#c77dd6", "#9bc53d", "#e07a30", "#3ec1d3"}

// NameMaxLen is the maximum player name length in characters.
const NameMaxLen = 12

type stats struct {
	kills, spent, winds, built, gifted int
	saved                              int // cogs perks took off build and upgrade prices
	dmg                                float64
}

type player struct {
	id, name, color string
	connected       bool
	ready           bool
	connSeq         uint64 // order of the current connection (lower = longer connected)
	purse           float64
	windBudget      float64
	actWave         int // wave cycle of the player's last command or connect (see active)
	st              stats

	perks map[string]int // picked perks (never nil)
	offer []string       // unpicked choice, nil if none
	free  int            // Free Sample charges left
}

type tower struct {
	plot     int
	kind     string
	def      *TowerDef
	lvl      int // 1..3
	owner    string
	tension  float64
	aim      float64
	spent    int
	cooldown float64
}

func (t *tower) level() *Level { return &t.def.Levels[t.lvl-1] }

type enemy struct {
	id       int
	kind     string
	kindIdx  int
	def      *EnemyDef
	path     int
	dist     float64
	hp, max  float64
	slow     float64
	repaired bool
	dead     bool
}

type spawn struct {
	hpMul float64
	at    float64
	kind  string
	path  int
}

type pendingHit struct {
	at      float64
	towerK  string
	owner   string
	target  int // enemy id (single target)
	x, y    float64
	dmg     float64
	splash  float64
	pierce  bool
	hitsAir bool
}

type windKey struct {
	plot int
	pid  string
}

// Game is one room's simulation.
type Game struct {
	rng *rand.Rand

	phase     Phase
	time      float64 // sim time since Start
	wave      int     // current/upcoming wave (1-based), 0 in lobby
	buildLeft float64
	waveTime  float64
	waveHPMul float64
	lives     int

	players []*player
	nextPID int
	host    string
	connSeq uint64

	towers   []*tower // indexed by plot id; nil = empty
	enemies  []*enemy
	byID     map[int]*enemy
	nextEID  int
	spawns   []spawn
	hits     []pendingHit
	events   []any
	windSeen map[windKey]bool

	slowVer uint64
	end     *End
}

// New creates a game in the lobby phase.
func New(rng *rand.Rand) *Game {
	g := &Game{rng: rng, phase: PhaseLobby, nextPID: 1}
	g.reset()
	return g
}

func (g *Game) reset() {
	g.phase = PhaseLobby
	g.time, g.wave, g.buildLeft, g.waveTime = 0, 0, 0, 0
	g.lives = Defs.MaxLives
	g.towers = make([]*tower, len(Map.Plots))
	g.enemies = nil
	g.byID = map[int]*enemy{}
	g.spawns, g.hits, g.events = nil, nil, nil
	g.windSeen = map[windKey]bool{}
	g.end = nil
	for _, p := range g.players {
		p.purse, p.ready, p.st = 0, false, stats{}
		p.perks, p.offer, p.free = map[string]int{}, nil, 0
	}
	g.slowVer++
}

// --- accessors -------------------------------------------------------------

func (g *Game) Phase() Phase             { return g.phase }
func (g *Game) Wave() int                { return g.wave }
func (g *Game) Lives() int               { return g.lives }
func (g *Game) Time() float64            { return g.time }
func (g *Game) Host() string             { return g.host }
func (g *Game) End() *End                { return g.end }
func (g *Game) SlowVersion() uint64      { return g.slowVer }
func (g *Game) NumPlayers() int          { return len(g.players) }
func (g *Game) Running() bool            { return g.phase == PhaseBuild || g.phase == PhaseWave }
func (g *Game) HasPlayer(id string) bool { return g.player(id) != nil }

// Purse returns a player's spendable cogs.
func (g *Game) Purse(pid string) int {
	if p := g.player(pid); p != nil {
		return int(math.Floor(p.purse + 1e-9))
	}
	return 0
}

func (g *Game) player(id string) *player {
	for _, p := range g.players {
		if p.id == id {
			return p
		}
	}
	return nil
}

func (g *Game) connected() []*player {
	var out []*player
	for _, p := range g.players {
		if p.connected {
			out = append(out, p)
		}
	}
	return out
}

// ConnectedCount is the number of connected players.
func (g *Game) ConnectedCount() int { return len(g.connected()) }

// active reports whether p is taking part: connected, and has sent a game
// command (build, upgrade, sell, wind, gift or ready) during the current wave
// cycle or the previous one. A cycle is a build phase plus its wave, so a
// player who does anything at all once per cycle never flaps. (Re)connecting
// counts as a command, and everyone starts active for wave 1.
func (g *Game) active(p *player) bool { return p.connected && p.actWave >= g.wave-1 }

// earners are the players who share bounties and wave bonuses: the active
// players, or every connected player if nobody is active. An idle player's
// share thus goes to the teammates who are playing; the team's total income
// never changes, and enemy HP still scales with connected players, so going
// idle can never make the game easier.
func (g *Game) earners() []*player {
	var out []*player
	for _, p := range g.players {
		if g.active(p) {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		out = g.connected()
	}
	return out
}

// --- players ---------------------------------------------------------------

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

// AddPlayer creates a (disconnected) player. In the lobby, a full room evicts
// a disconnected player to make space; its id is returned in evicted.
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
	p := &player{id: fmt.Sprintf("p%d", g.nextPID), name: name, windBudget: Defs.MaxTapsPerSec, perks: map[string]int{}}
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
	if g.Running() {
		p.purse = g.catchUpPurse()
	}
	g.players = append(g.players, p)
	if g.host == "" {
		g.host = p.id
	}
	g.slowVer++
	return p.id, evicted, nil
}

func (g *Game) startPurse(n int) float64 {
	if n < 1 {
		n = 1
	}
	return math.Max(Defs.StartPurseMin, math.Round(Defs.StartPurseTotal/float64(n)/5)*5)
}

// catchUpPurse: a late joiner gets a share of the average net worth.
func (g *Game) catchUpPurse() float64 {
	if len(g.players) == 0 {
		return g.startPurse(1)
	}
	worth := map[string]float64{}
	for _, p := range g.players {
		worth[p.id] = p.purse
	}
	for _, t := range g.towers {
		if t != nil {
			worth[t.owner] += float64(t.spent)
		}
	}
	total := 0.0
	for _, w := range worth {
		total += w
	}
	avg := total / float64(len(g.players))
	return math.Max(g.startPurse(len(g.players)+1), math.Floor(avg*Defs.CatchUpFrac))
}

// SetConnected marks a player (dis)connected. Handles host migration and
// ready checks.
func (g *Game) SetConnected(pid string, on bool) {
	p := g.player(pid)
	if p == nil || p.connected == on {
		return
	}
	p.connected = on
	g.slowVer++
	if on {
		p.actWave = g.wave
		g.connSeq++
		p.connSeq = g.connSeq
		if h := g.player(g.host); h == nil || !h.connected {
			g.host = pid
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
	if g.phase == PhaseBuild {
		g.checkAllReady()
	}
}

// --- commands --------------------------------------------------------------

// Apply dispatches a client command. Unknown types are ignored (nil).
func (g *Game) Apply(pid string, c Cmd) error {
	p := g.player(pid)
	if p == nil {
		return ErrBadRequest
	}
	switch c.T {
	case "build", "upgrade", "sell", "wind", "ready", "gift", "perk":
		if g.Running() {
			p.actWave = g.wave
		}
	}
	switch c.T {
	case "start":
		return g.Start(pid)
	case "restart":
		return g.Restart(pid)
	case "build":
		if c.Plot == nil {
			return badReq("Missing plot")
		}
		return g.Build(pid, *c.Plot, c.Kind)
	case "upgrade":
		if c.Plot == nil {
			return badReq("Missing plot")
		}
		return g.Upgrade(pid, *c.Plot)
	case "sell":
		if c.Plot == nil {
			return badReq("Missing plot")
		}
		return g.Sell(pid, *c.Plot)
	case "wind":
		if c.Plot == nil {
			return badReq("Missing plot")
		}
		n := 1
		if c.N != nil {
			n = *c.N
		}
		return g.Wind(pid, *c.Plot, n)
	case "ready":
		r := true
		if c.Ready != nil {
			r = *c.Ready
		}
		return g.Ready(pid, r)
	case "gift":
		if c.Amount == nil {
			return badReq("Missing amount")
		}
		return g.Gift(pid, c.To, *c.Amount)
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
	g.phase = PhaseBuild
	g.wave = 1
	g.buildLeft = Defs.BuildTime
	g.lives = Defs.MaxLives
	sp := g.startPurse(len(g.players))
	for _, p := range g.players {
		p.purse = sp
		p.ready = false
		p.actWave = 0 // active for wave 1 only, unless they do something
		p.windBudget = Defs.MaxTapsPerSec
	}
	g.slowVer++
	return nil
}

// Restart returns a finished game to the lobby (host, won/lost).
func (g *Game) Restart(pid string) error {
	if pid != g.host {
		return ErrNotHost
	}
	// Also allowed mid-game: the host ends the game and everyone returns to
	// the lobby.
	if g.phase == PhaseLobby {
		return badReq("No game is running")
	}
	g.reset()
	return nil
}

func (g *Game) plotOK(plot int) bool { return plot >= 0 && plot < len(g.towers) }

func (g *Game) spend(p *player, cost int) bool {
	if float64(cost) > p.purse+1e-9 {
		return false
	}
	p.purse -= float64(cost)
	p.st.spent += cost
	return true
}

// Build places a level-1 tower.
func (g *Game) Build(pid string, plot int, kind string) error {
	p := g.player(pid)
	if p == nil || !g.Running() {
		return badReq("Not now")
	}
	if !g.plotOK(plot) {
		return badReq("No such plot")
	}
	def := Defs.Towers[kind]
	if def == nil {
		return badReq("No such tower")
	}
	if g.towers[plot] != nil {
		return ErrOccupied
	}
	cost, free := buildCost(p, def), p.free > 0
	if free {
		cost = 0
	}
	if !g.spend(p, cost) {
		return ErrPoor
	}
	if free {
		p.free--
		g.slowVer++ // the charge count is in the room message
	}
	p.st.saved += def.Levels[0].Cost - cost
	g.towers[plot] = &tower{plot: plot, kind: kind, def: def, lvl: 1, owner: pid, spent: cost, aim: -math.Pi / 2}
	p.st.built++
	g.emit(EvBuild{E: "build", Plot: plot, Kind: kind, PID: pid})
	return nil
}

// Upgrade raises a tower one level; anyone may pay for it.
func (g *Game) Upgrade(pid string, plot int) error {
	p := g.player(pid)
	if p == nil || !g.Running() {
		return badReq("Not now")
	}
	if !g.plotOK(plot) || g.towers[plot] == nil {
		return badReq("No tower there")
	}
	t := g.towers[plot]
	if t.lvl >= len(t.def.Levels) {
		return ErrMaxLevel
	}
	cost := upgradeCost(p, t.def, t.lvl)
	if !g.spend(p, cost) {
		return ErrPoor
	}
	p.st.saved += t.def.Levels[t.lvl].Cost - cost
	t.lvl++
	t.spent += cost
	g.emit(EvUpgrade{E: "upgrade", Plot: plot, Lvl: t.lvl, PID: pid})
	return nil
}

// Sell removes a tower (builder only) for a partial refund.
func (g *Game) Sell(pid string, plot int) error {
	p := g.player(pid)
	if p == nil || !g.Running() {
		return badReq("Not now")
	}
	if !g.plotOK(plot) || g.towers[plot] == nil {
		return badReq("No tower there")
	}
	t := g.towers[plot]
	if t.owner != pid {
		return ErrNotOwner
	}
	refund := int(math.Floor(float64(t.spent) * Defs.SellRefund))
	p.purse += float64(refund)
	g.towers[plot] = nil
	g.emit(EvSell{E: "sell", Plot: plot, PID: pid, Refund: refund})
	return nil
}

// Wind adds n taps of tension to a tower, capped by the player's tap budget.
func (g *Game) Wind(pid string, plot, n int) error {
	p := g.player(pid)
	if p == nil || !g.Running() {
		return badReq("Not now")
	}
	if !g.plotOK(plot) || g.towers[plot] == nil {
		return badReq("No tower there")
	}
	if n < 1 || n > 100 {
		return badReq("Bad tap count")
	}
	n = min(n, int(math.Floor(p.windBudget+1e-9)))
	if n <= 0 {
		return nil // over the tap cap: silently dropped
	}
	p.windBudget -= float64(n)
	t := g.towers[plot]
	t.tension = math.Min(1, t.tension+float64(n)*Defs.WindPerTap*crankMul(p))
	p.st.winds += n
	k := windKey{plot, pid}
	if !g.windSeen[k] {
		g.windSeen[k] = true
		g.emit(EvWind{E: "wind", Plot: plot, PID: pid})
	}
	return nil
}

// Ready marks a player ready during the build phase. Outside the build phase
// it is a harmless no-op (it races with the phase change).
func (g *Game) Ready(pid string, r bool) error {
	p := g.player(pid)
	if p == nil {
		return ErrBadRequest
	}
	if g.phase != PhaseBuild {
		return nil
	}
	if p.ready != r {
		p.ready = r
		g.slowVer++
	}
	g.checkAllReady()
	return nil
}

// checkAllReady starts the wave once every active connected player is ready
// and at least one player is. Idle players (see active) never block it; in
// wave 1 everyone is active, so the first build phase waits for all.
func (g *Game) checkAllReady() {
	any := false
	for _, p := range g.connected() {
		if p.ready {
			any = true
		} else if g.active(p) {
			return
		}
	}
	if any {
		g.startWave()
	}
}

// Gift sends cogs to another player.
func (g *Game) Gift(pid, to string, amount int) error {
	p := g.player(pid)
	if p == nil || !g.Running() {
		return badReq("Not now")
	}
	q := g.player(to)
	if q == nil || q == p {
		return badReq("No such player")
	}
	if amount < 1 || amount > 1_000_000 {
		return badReq("Bad amount")
	}
	if float64(amount) > p.purse+1e-9 {
		return ErrPoor
	}
	p.purse -= float64(amount)
	q.purse += float64(amount)
	p.st.gifted += amount
	g.emit(EvGift{E: "gift", From: pid, To: to, Amount: amount})
	return nil
}

func (g *Game) emit(ev any) { g.events = append(g.events, ev) }

// --- views -----------------------------------------------------------------

// RoomState builds the `room` message.
func (g *Game) RoomState() *RoomMsg {
	m := &RoomMsg{T: "room", Phase: g.phase, Host: g.host, Wave: g.wave, NextWave: []WaveEntry{}, End: g.end,
		Players: make([]PlayerInfo, 0, len(g.players))}
	for _, p := range g.players {
		m.Players = append(m.Players, PlayerInfo{ID: p.id, Name: p.name, Color: p.color, Connected: p.connected, Ready: p.ready,
			Offer: slices.Clone(p.offer), Perks: maps.Clone(p.perks), Costs: costTable(p), Free: p.free})
	}
	if g.phase == PhaseBuild && g.wave >= 1 && g.wave <= len(Defs.WaveDefs) {
		m.NextWave = WavePreview(g.wave)
	}
	return m
}

// WavePreview totals the enemies of wave w (1-based) by kind, in order of
// first appearance.
func WavePreview(w int) []WaveEntry {
	out := []WaveEntry{}
	for _, gr := range Defs.WaveDefs[w-1].Groups {
		i := slices.IndexFunc(out, func(e WaveEntry) bool { return e.Kind == gr.Kind })
		if i < 0 {
			out = append(out, WaveEntry{Kind: gr.Kind, N: gr.N})
		} else {
			out[i].N += gr.N
		}
	}
	return out
}

func round(v, step float64) float64 {
	k := math.Round(1 / step)
	return math.Round(v*k) / k
}

// Snapshot builds a `snap` message and drains the event list.
func (g *Game) Snapshot() *Snap { return g.snapshot(true) }

// View builds a `snap` message without events, leaving the event list alone
// (for a client that has just connected).
func (g *Game) View() *Snap { return g.snapshot(false) }

func (g *Game) snapshot(drain bool) *Snap {
	s := &Snap{T: "snap", Time: round(g.time, 0.01), Phase: g.phase, Wave: g.wave, Lives: g.lives,
		Purses: make(map[string]int, len(g.players)), Towers: []TowerSnap{}, Enemies: [][6]float64{}}
	if drain {
		s.Ev = g.events
		g.events = nil
		clear(g.windSeen)
	}
	if g.phase == PhaseBuild {
		s.Left = round(math.Max(0, g.buildLeft), 0.1)
	}
	for _, p := range g.players {
		s.Purses[p.id] = g.Purse(p.id)
	}
	for _, t := range g.towers {
		if t != nil {
			ts := TowerSnap{Plot: t.plot, Kind: t.kind, Lvl: t.lvl, Owner: t.owner,
				Tension: round(t.tension, 0.01), Aim: round(t.aim, 0.01), Spent: t.spent}
			if m := rangeMul(g.player(t.owner)); m != 1 {
				ts.RangeMul = round(m, 0.01)
			}
			s.Towers = append(s.Towers, ts)
		}
	}
	for _, e := range g.enemies {
		if e.dead {
			continue
		}
		flags := 0
		if e.slow > 0 {
			flags |= FlagSlowed
		}
		if e.repaired {
			flags |= FlagRepaired
		}
		s.Enemies = append(s.Enemies, [6]float64{float64(e.id), float64(e.kindIdx), float64(e.path),
			round(e.dist, 0.1), round(e.hp/e.max, 0.001), float64(flags)})
	}
	if s.Ev == nil {
		s.Ev = []any{}
	}
	return s
}
