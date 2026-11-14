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
	for _, n := range []int{1, 3, 4} {
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
	for _, n := range []int{1, 2, 3, 4} {
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
	// "sloppy" is the tuning target: a party player who wastes a quarter of
	// their actions (25% of slots are waits). "sloppy+" also wanders.
	sloppy := func(n int) Scenario { return Scenario{Players: n, Mistake: 0.25} }
	scens := []scen{
		{"4 perfect", Scenario{Players: 4}},
		{"4 bots 15% wasted", Scenario{Players: 4, Mistake: 0.15}},
		{"4 sloppy", sloppy(4)},
		{"4 sloppy+ (10% wander)", Scenario{Players: 4, Mistake: 0.25, Wander: 0.1}},
		{"1 sloppy", sloppy(1)},
		{"2 sloppy", sloppy(2)},
		{"3 sloppy", sloppy(3)},
		{"3 sloppy + 1 idle", Scenario{Players: 3, Idle: 1, Mistake: 0.25}},
		{"1 perfect", Scenario{Players: 1}},
		{"2 perfect", Scenario{Players: 2}},
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
	t.Logf("%-22s %8s %10s %10s %8s  %s", "scenario", "wins", "wall(won)", "wall(all)", "turns", "losses by level / avg wall after each level")
	for _, s := range scens {
		rs := RunMany(s.sc, 1000, runs)
		wins, wallWon, wallAll, rounds := 0, 0, 0, 0
		lossAt := make([]int, levels+1)
		lvlR := make([]float64, levels)
		lvlN := make([]int, levels)
		after := make([]float64, levels)
		cnt := make([]int, levels)
		for _, r := range rs {
			wallAll += r.Wall
			rounds += r.Rounds
			if r.Won {
				for i, n := range r.LvlRounds {
					lvlR[i] += float64(n)
					lvlN[i]++
				}
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
		b.WriteString(" / turns per level (won):")
		for i := range lvlR {
			if lvlN[i] > 0 {
				fmt.Fprintf(&b, " %.1f", lvlR[i]/float64(lvlN[i]))
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

// TestParticipation prints, per team and level, how many of the players
// pulled their weight (see LevelUse), and compares a full team on level 1
// with one worker whose teammates stand idle. Skipped unless
// CT_BALANCE_RUNS is set (games per row).
func TestParticipation(t *testing.T) {
	v := os.Getenv("CT_BALANCE_RUNS")
	if v == "" {
		t.Skip("set CT_BALANCE_RUNS to run")
	}
	runs, err := strconv.Atoi(v)
	if err != nil || runs < 1 {
		t.Fatalf("bad CT_BALANCE_RUNS %q", v)
	}
	levels := len(game.Defs.Levels)
	t.Logf("players useful in the level (share of seats) / player-turns useful (share), per level")
	for _, s := range []struct {
		name string
		sc   Scenario
	}{
		{"2 perfect", Scenario{Players: 2}},
		{"3 perfect", Scenario{Players: 3}},
		{"4 perfect", Scenario{Players: 4}},
		{"2 sloppy", Scenario{Players: 2, Mistake: 0.25}},
		{"3 sloppy", Scenario{Players: 3, Mistake: 0.25}},
		{"4 sloppy", Scenario{Players: 4, Mistake: 0.25}},
	} {
		rs := RunMany(s.sc, 1000, runs)
		var b strings.Builder
		for lv := 1; lv <= levels; lv++ {
			seats, used, pturns, uturns, contrib := 0, 0, 0, 0, 0
			for _, r := range rs {
				if lv > len(r.Use) || r.Use[lv-1].Turns == 0 {
					continue
				}
				u := r.Use[lv-1]
				seats += u.Players
				used += len(u.Useful)
				contrib += len(u.Contrib)
				pturns += u.Players * u.Turns
				uturns += u.UsefulTurns
			}
			if seats > 0 {
				fmt.Fprintf(&b, " L%d %3.0f%%/%3.0f%%/%3.0f%%", lv, 100*float64(used)/float64(seats),
					100*float64(contrib)/float64(seats), 100*float64(uturns)/float64(pturns))
			}
		}
		t.Logf("%-10s useful/contributed/turns:%s", s.name, b.String())
	}
	t.Logf("level 1: wall lost and turns, full team vs one perfect worker (a fetcher, seat 1, or a gunner, seat 2) + idle teammates")
	for n := 2; n <= 4; n++ {
		row := fmt.Sprintf("%d players:", n)
		for _, sc := range []Scenario{{Players: n}, {Players: n, Mistake: 0.25}, {Players: 1, Idle: n - 1}, {Players: 1, Idle: n - 1, BotSeat: 1}} {
			rs := RunMany(sc, 1000, runs)
			lost, turns, dead := 0, 0, 0
			for _, r := range rs {
				lost += r.Use[0].WallLost
				turns += r.Use[0].Turns
				if !r.Won && r.Level == 1 {
					dead++
				}
			}
			row += fmt.Sprintf("  [%d+%d idle seat %d, %.0f%% wasted] wall lost %.1f turns %.1f lost-on-L1 %d%%", sc.Players, sc.Idle,
				sc.BotSeat+1, 100*sc.Mistake, float64(lost)/float64(runs), float64(turns)/float64(runs), 100*dead/runs)
		}
		t.Logf("%s", row)
	}
}
