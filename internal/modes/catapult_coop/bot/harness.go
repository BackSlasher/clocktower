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
	Idle    int     // extra connected players who never send anything
	Mistake float64 // per-bot chance per round to just wait
	Wander  float64 // per-bot chance per round to make a random move instead
	NoPerks bool
	Seed    uint64
}

// Result summarises a headless game.
type Result struct {
	Won       bool
	Level     int
	Wall      int
	Rounds    int
	Time      float64
	End       *game.End
	Trace     []int // wall HP after each level
	LvlRounds []int // rounds played in each level reached
}

func (r Result) String() string {
	return fmt.Sprintf("won=%v level=%d wall=%d rounds=%d trace=%v", r.Won, r.Level, r.Wall, r.Rounds, r.Trace)
}

// Run plays a full game with bots, stepping 0.1 s at a time and handing the
// bots a fresh room + snap every step, like a room does.
func Run(sc Scenario) Result {
	g := game.New(rand.New(rand.NewPCG(sc.Seed, 7)))
	var bots []*Bot
	for i := 0; i < sc.Players+sc.Idle; i++ {
		pid, _, err := g.AddPlayer(fmt.Sprintf("Bot%d", i+1))
		if err != nil {
			panic(err)
		}
		g.SetConnected(pid, true)
		if i < sc.Players {
			b := New(pid, sc.Seed*100+uint64(i))
			b.Mistake, b.Wander, b.NoPerks = sc.Mistake, sc.Wander, sc.NoPerks
			bots = append(bots, b)
		}
	}
	if err := g.Start(g.Host()); err != nil {
		panic(err)
	}
	var trace, lvlRounds []int
	level, startRound := g.Level(), 0
	for tick := 0; g.Running() && tick < 200000; tick++ {
		g.Step(0.1)
		if g.Level() != level || !g.Running() {
			trace = append(trace, g.Wall())
			lvlRounds = append(lvlRounds, g.Rounds()-startRound)
			level, startRound = g.Level(), g.Rounds()
		}
		snap, room := g.Snapshot(), g.RoomState()
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
	return Result{Won: g.Phase() == game.PhaseWon, Level: g.Level(), Wall: g.Wall(), Rounds: g.End().Rounds,
		Time: g.Time(), End: g.End(), Trace: trace, LvlRounds: lvlRounds}
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
