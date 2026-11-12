package bot

import (
	"fmt"
	"math/rand/v2"
	"runtime"
	"sync"

	"clocktower/internal/game"
)

// Scenario configures a headless game.
type Scenario struct {
	Players    int
	Skill      Skill
	Team       []Skill // if set, one bot per entry (overrides Players/Skill)
	TapsPerSec float64 // 0 = default (3)
	ReadyDelay float64 // seconds into build before readying; <0 never
	NoWind     bool    // bots never wind (to measure what winding is worth)
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

func (sc Scenario) team() []Skill {
	if sc.Team != nil {
		return sc.Team
	}
	t := make([]Skill, sc.Players)
	for i := range t {
		t[i] = sc.Skill
	}
	return t
}

// Run plays a full game with bots at 30 Hz and 10 Hz snapshots, exactly like
// a room does, and returns the outcome.
func Run(sc Scenario) Result {
	g := game.New(rand.New(rand.NewPCG(sc.Seed, 7)))
	var bots []*Bot
	for i, sk := range sc.team() {
		pid, _, err := g.AddPlayer(fmt.Sprintf("Bot%d", i+1))
		if err != nil {
			panic(err)
		}
		g.SetConnected(pid, true)
		b := New(pid, sk, sc.Seed*100+uint64(i))
		if sc.TapsPerSec > 0 {
			b.TapsPerSec = sc.TapsPerSec
		}
		b.ReadyDelay = sc.ReadyDelay
		b.NoWind = sc.NoWind
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

// RunMany plays seeds base..base+n-1 in parallel and returns results in seed
// order.
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

// Summary aggregates results.
type Summary struct {
	N, Wins      int
	AvgLivesWon  float64 // average lives left in won games
	AvgLossWave  float64 // average final wave of lost games
	MinLossWave  int
	AvgMinutes   float64 // average sim minutes over all games
	AvgWinMins   float64 // average sim minutes of won games
	LostPerWave  []float64
	LossesByWave map[int]int
}

// Summarize aggregates a slice of results.
func Summarize(rs []Result) Summary {
	s := Summary{N: len(rs), LostPerWave: make([]float64, game.Defs.Waves), LossesByWave: map[int]int{}}
	losses := 0
	for _, r := range rs {
		s.AvgMinutes += r.Time / 60
		prev := game.Defs.MaxLives
		for i, l := range r.Trace {
			if i < len(s.LostPerWave) {
				s.LostPerWave[i] += float64(prev - l)
			}
			prev = l
		}
		if r.Won {
			s.Wins++
			s.AvgLivesWon += float64(r.Lives)
			s.AvgWinMins += r.Time / 60
		} else {
			losses++
			s.AvgLossWave += float64(r.Wave)
			s.LossesByWave[r.Wave]++
			if s.MinLossWave == 0 || r.Wave < s.MinLossWave {
				s.MinLossWave = r.Wave
			}
		}
	}
	if s.N > 0 {
		s.AvgMinutes /= float64(s.N)
		for i := range s.LostPerWave {
			s.LostPerWave[i] /= float64(s.N)
		}
	}
	if s.Wins > 0 {
		s.AvgLivesWon /= float64(s.Wins)
		s.AvgWinMins /= float64(s.Wins)
	}
	if losses > 0 {
		s.AvgLossWave /= float64(losses)
	}
	return s
}
