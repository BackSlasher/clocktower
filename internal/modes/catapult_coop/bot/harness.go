package bot

import (
	"fmt"
	"math/rand/v2"
	"runtime"
	"sync"

	game "clocktower/internal/modes/catapult_coop"
)

// Scenario configures a headless game.
type Scenario struct {
	Players int
	Idle    int     // extra connected players who press done on the first turn, then nothing
	BotSeat int     // seat (0-based) of the first bot; idle players fill the seats before it and after the bots
	Mistake float64 // per-bot chance per slot to waste it (wait)
	Wander  float64 // per-bot chance per slot to make a pointless move instead
	Seed    uint64
}

// Result summarises a headless game.
type Result struct {
	Won       bool
	Level     int
	Wall      int
	Rounds    int // turns
	Time      float64
	End       *game.End
	Trace     []int      // wall HP after each level
	LvlRounds []int      // turns played in each level reached
	Use       []LevelUse // participation, per level reached
}

// LevelUse is the participation in one level. A player was useful in a turn
// when they picked a bomb up, loaded one, threw one that was caught, or
// caught one that was later loaded (by anyone). Contrib is stricter: they
// handled a bomb (picked up, threw, caught, loaded) that ended up loaded.
type LevelUse struct {
	Players     int            // seated players (bots and idle ones)
	Turns       int            // turns played
	Useful      map[string]int // player → turns in which they were useful
	Contrib     map[string]int // player → turns in which they handled a bomb later loaded
	WallLost    int            // wall hit points lost in the level
	UsefulTurns int            // player-turns with a useful action
}

// usage follows the events of a game and fills the participation table.
type usage struct {
	levels  map[int]*LevelUse
	level   int
	round   int
	pending map[int][][3]any // bomb → (level, round, pid) of catches waiting for a load
	handled map[int][][3]any // bomb → (level, round, pid) of everyone who handled it
	seen    map[[3]any]bool  // (level, round, pid) already counted useful
	seenC   map[[3]any]bool
}

func newUsage() *usage {
	return &usage{levels: map[int]*LevelUse{}, pending: map[int][][3]any{}, handled: map[int][][3]any{},
		seen: map[[3]any]bool{}, seenC: map[[3]any]bool{}}
}

func (u *usage) lv(l int) *LevelUse {
	if u.levels[l] == nil {
		u.levels[l] = &LevelUse{Useful: map[string]int{}, Contrib: map[string]int{}}
	}
	return u.levels[l]
}

func (u *usage) useful(k [3]any) {
	if !u.seen[k] {
		u.seen[k] = true
		u.lv(k[0].(int)).Useful[k[2].(string)]++
		u.lv(k[0].(int)).UsefulTurns++
	}
}

func (u *usage) contrib(k [3]any) {
	if !u.seenC[k] {
		u.seenC[k] = true
		u.lv(k[0].(int)).Contrib[k[2].(string)]++
	}
}

func (u *usage) events(evs []any) {
	for _, e := range evs {
		switch ev := e.(type) {
		case game.EvResolve:
			u.level, u.round = ev.Level, ev.Round
			u.lv(ev.Level).Turns++
		case game.EvPickup:
			if ev.Result == "ok" {
				k := [3]any{u.level, u.round, ev.PID}
				u.useful(k)
				u.handled[ev.Bomb] = append(u.handled[ev.Bomb], k)
			}
		case game.EvThrow:
			k := [3]any{u.level, u.round, ev.PID}
			u.handled[ev.Bomb] = append(u.handled[ev.Bomb], k)
			if ev.Result == "caught" {
				u.useful(k)
				c := [3]any{u.level, u.round, ev.By}
				u.pending[ev.Bomb] = append(u.pending[ev.Bomb], c)
				u.handled[ev.Bomb] = append(u.handled[ev.Bomb], c)
			}
		case game.EvLoad:
			if ev.Result == "ok" {
				k := [3]any{u.level, u.round, ev.PID}
				u.useful(k)
				u.contrib(k)
				for _, c := range u.pending[ev.Bomb] {
					u.useful(c)
				}
				for _, c := range u.handled[ev.Bomb] {
					u.contrib(c)
				}
				delete(u.pending, ev.Bomb)
				delete(u.handled, ev.Bomb)
			}
		case game.EvWall:
			u.lv(u.level).WallLost += ev.Dmg
		}
	}
}

func (u *usage) table(players, levels int) []LevelUse {
	var out []LevelUse
	for l := 1; l <= levels; l++ {
		lu := u.lv(l)
		lu.Players = players
		out = append(out, *lu)
	}
	return out
}

func (r Result) String() string {
	return fmt.Sprintf("won=%v level=%d wall=%d rounds=%d trace=%v", r.Won, r.Level, r.Wall, r.Rounds, r.Trace)
}

// Run plays a full game with bots, stepping 0.1 s at a time and handing the
// bots a fresh room + snap every step, like a room does.
func Run(sc Scenario) Result {
	g := game.New(rand.New(rand.NewPCG(sc.Seed, 7)))
	var bots []*Bot
	var idle []string
	for i := 0; i < sc.Players+sc.Idle; i++ {
		pid, _, err := g.AddPlayer(fmt.Sprintf("Bot%d", i+1))
		if err != nil {
			panic(err)
		}
		g.SetConnected(pid, true)
		if i < sc.BotSeat || i >= sc.BotSeat+sc.Players {
			idle = append(idle, pid)
		} else {
			b := New(pid, sc.Seed*100+uint64(i-sc.BotSeat))
			b.Mistake, b.Wander = sc.Mistake, sc.Wander
			bots = append(bots, b)
		}
	}
	if err := g.Start(g.Host()); err != nil {
		panic(err)
	}
	for _, pid := range idle { // the untimed first turn waits for them once
		_ = g.Apply(pid, game.Cmd{T: "plan", Done: true})
	}
	var trace, lvlRounds []int
	use := newUsage()
	level, startRound := g.Level(), 0
	for tick := 0; g.Running() && tick < 200000; tick++ {
		g.Step(0.1)
		if g.Level() != level || !g.Running() {
			trace = append(trace, g.Wall())
			lvlRounds = append(lvlRounds, g.Rounds()-startRound)
			level, startRound = g.Level(), g.Rounds()
		}
		snap, room := g.Snapshot(), g.RoomState()
		use.events(snap.Ev)
		for _, b := range bots {
			for _, c := range b.Act(room, snap, g.Keep()) {
				if err := g.Apply(b.ID, c); err != nil {
					if c.T == "plan" {
						panic(fmt.Sprintf("bot %s plan %+v refused: %v", b.ID, c, err))
					}
				}
				room = g.RoomState()
			}
		}
	}
	if g.End() == nil {
		panic(fmt.Sprintf("game did not finish (phase %s, level %d, turn %d)", g.Phase(), g.Level(), g.Round()))
	}
	return Result{Won: g.Phase() == game.PhaseWon, Level: g.Level(), Wall: g.Wall(), Rounds: g.End().Rounds,
		Time: g.Time(), End: g.End(), Trace: trace, LvlRounds: lvlRounds, Use: use.table(sc.Players+sc.Idle, g.Level())}
}

// RunMany plays seeds base..base+n-1 in parallel, results in seed order.
func RunMany(sc Scenario, base uint64, n int) []Result {
	out := make([]Result, n)
	var wg sync.WaitGroup
	sem := make(chan struct{}, runtime.GOMAXPROCS(0))
	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer func() { <-sem; wg.Done() }()
			s := sc
			s.Seed = base + uint64(i)
			out[i] = Run(s)
		}(i)
	}
	wg.Wait()
	return out
}
