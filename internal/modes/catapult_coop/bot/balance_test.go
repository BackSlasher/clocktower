package bot

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"

	game "clocktower/internal/modes/catapult_coop"
)

// TestBotsPlay is a quick smoke test: a handful of games, every plan the bots
// send is accepted (Run panics otherwise) and games finish.
func TestBotsPlay(t *testing.T) {
	for _, n := range []int{1, 3, 6} {
		r := Run(Scenario{Players: n, Seed: 5})
		if r.End == nil || r.Rounds == 0 {
			t.Fatalf("%d bots: %v", n, r)
		}
		t.Logf("%d bots: %v", n, r)
	}
}

// TestTutorialTrivial: any team clears the tutorial with the wall intact or
// nearly so.
func TestTutorialTrivial(t *testing.T) {
	for _, n := range []int{1, 2, 4, 8} {
		for seed := uint64(1); seed <= 3; seed++ {
			r := Run(Scenario{Players: n, Seed: seed})
			if r.Level < 2 && !r.Won {
				t.Fatalf("%d bots lost the tutorial: %v", n, r)
			}
		}
	}
}

// TestBalance plays many headless games per team size and prints win rate
// and wall HP left. Skipped unless CT_BALANCE_RUNS is set (games per row).
func TestBalance(t *testing.T) {
	v := os.Getenv("CT_BALANCE_RUNS")
	if v == "" {
		t.Skip("set CT_BALANCE_RUNS to run")
	}
	runs, err := strconv.Atoi(v)
	if err != nil || runs < 1 {
		t.Fatalf("bad CT_BALANCE_RUNS %q", v)
	}
	type scen struct {
		name string
		sc   Scenario
	}
	scens := []scen{
		{"1 bot", Scenario{Players: 1}},
		{"2 bots", Scenario{Players: 2}},
		{"3 bots", Scenario{Players: 3}},
		{"4 bots", Scenario{Players: 4}},
		{"5 bots", Scenario{Players: 5}},
		{"6 bots", Scenario{Players: 6}},
		{"8 bots", Scenario{Players: 8}},
		{"3 bots + 1 idle", Scenario{Players: 3, Idle: 1}},
		{"4 bots, 15% mistakes", Scenario{Players: 4, Mistake: 0.15}},
		{"4 bots, no perks", Scenario{Players: 4, NoPerks: true}},
	}
	if f := os.Getenv("CT_BALANCE_ONLY"); f != "" {
		var keep []scen
		for _, s := range scens {
			if strings.Contains(s.name, f) {
				keep = append(keep, s)
			}
		}
		scens = keep
	}
	levels := len(game.Defs.Levels)
	t.Logf("%-22s %8s %10s %10s %8s  %s", "scenario", "wins", "wall(won)", "wall(all)", "rounds", "losses by level / avg wall after each level")
	for _, s := range scens {
		rs := RunMany(s.sc, 1000, runs)
		wins, wallWon, wallAll, rounds := 0, 0, 0, 0
		lossAt := make([]int, levels+1)
		after := make([]float64, levels)
		cnt := make([]int, levels)
		for _, r := range rs {
			wallAll += r.Wall
			rounds += r.Rounds
			if r.Won {
				wins++
				wallWon += r.Wall
			} else {
				lossAt[r.Level]++
			}
			for i, w := range r.Trace {
				if i < levels {
					after[i] += float64(w)
					cnt[i]++
				}
			}
			if os.Getenv("CT_BALANCE_VERBOSE") != "" {
				t.Logf("  %s %v", s.name, r)
			}
		}
		var b strings.Builder
		for lv := 1; lv <= levels; lv++ {
			if lossAt[lv] > 0 {
				fmt.Fprintf(&b, "L%d:%d ", lv, lossAt[lv])
			}
		}
		b.WriteString("/")
		for i := range after {
			if cnt[i] > 0 {
				fmt.Fprintf(&b, " %.1f", after[i]/float64(cnt[i]))
			}
		}
		ww := 0.0
		if wins > 0 {
			ww = float64(wallWon) / float64(wins)
		}
		t.Logf("%-22s %3d/%-4d %10.1f %10.1f %8.1f  %s", s.name, wins, runs, ww, float64(wallAll)/float64(runs),
			float64(rounds)/float64(runs), b.String())
	}
}
