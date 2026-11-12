package bot

import (
	"fmt"
	"math/rand/v2"

	"clocktower/internal/game"
)

// Scenario configures a headless game.
type Scenario struct {
	Players    int
	Skill      Skill
	TapsPerSec float64 // 0 = default (3)
	ReadyDelay float64 // seconds into build before readying; <0 never
	Seed       uint64
}

// Result summarises a headless game.
type Result struct {
	Won   bool
	Wave  int
	Lives int
	Time  float64 // sim seconds
	End   *game.End
	Trace []int // lives remaining after each wave
}

func (r Result) String() string {
	return fmt.Sprintf("won=%v wave=%d lives=%d time=%.0fs trace=%v", r.Won, r.Wave, r.Lives, r.Time, r.Trace)
}

// Run plays a full game with bots at 30 Hz and 10 Hz snapshots, exactly like
// a room does, and returns the outcome.
func Run(sc Scenario) Result {
	g := game.New(rand.New(rand.NewPCG(sc.Seed, 7)))
	var bots []*Bot
	for i := 0; i < sc.Players; i++ {
		pid, _, err := g.AddPlayer(fmt.Sprintf("Bot%d", i+1))
		if err != nil {
			panic(err)
		}
		g.SetConnected(pid, true)
		b := New(pid, sc.Skill, sc.Seed*100+uint64(i))
		if sc.TapsPerSec > 0 {
			b.TapsPerSec = sc.TapsPerSec
		}
		b.ReadyDelay = sc.ReadyDelay
		bots = append(bots, b)
	}
	if err := g.Start(g.Host()); err != nil {
		panic(err)
	}
	const dt = 1.0 / 30
	var trace []int
	lastWave := g.Wave()
	for tick := 0; g.Running() && tick < 30*60*60; tick++ {
		g.Step(dt)
		if g.Wave() != lastWave || !g.Running() {
			trace = append(trace, g.Lives())
			lastWave = g.Wave()
		}
		if tick%3 == 2 {
			snap := g.Snapshot()
			room := g.RoomState()
			for _, b := range bots {
				for _, c := range b.Act(g.Time(), room, snap) {
					_ = g.Apply(b.ID, c)
				}
			}
		}
	}
	return Result{Won: g.Phase() == game.PhaseWon, Wave: g.Wave(), Lives: g.Lives(), Time: g.Time(), End: g.End(), Trace: trace}
}
