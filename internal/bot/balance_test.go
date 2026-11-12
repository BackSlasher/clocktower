package bot

import (
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func team(parts ...any) []Skill {
	var t []Skill
	for i := 0; i < len(parts); i += 2 {
		for j := 0; j < parts[i].(int); j++ {
			t = append(t, parts[i+1].(Skill))
		}
	}
	return t
}

// TestBalance plays headless games with scripted bots. It asserts only loose
// bounds so it stays stable; run with -v to see the table, and set
// CT_BALANCE_RUNS to play more seeds per scenario (20+ for tuning).
//
// The casual profiles are the tuning target (see docs/DESIGN.md "Balance
// targets"); the good bots are an expert reference and the bad bots a floor.
func TestBalance(t *testing.T) {
	if testing.Short() {
		t.Skip("slow")
	}
	runs := 6
	if v := os.Getenv("CT_BALANCE_RUNS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			t.Fatalf("bad CT_BALANCE_RUNS %q", v)
		}
		runs = n
	}
	type scen struct {
		name string
		sc   Scenario
	}
	scens := []scen{
		{"4 casual", Scenario{Team: team(4, Casual)}},
		{"3 casual + 1 idle", Scenario{Team: team(3, Casual, 1, Idle)}},
		{"1 casual", Scenario{Team: team(1, Casual)}},
		{"2 casual", Scenario{Team: team(2, Casual)}},
		{"8 casual", Scenario{Team: team(8, Casual)}},
		{"4 casual, no winding", Scenario{Team: team(4, Casual), NoWind: true}},
		{"4 casual, no perks", Scenario{Team: team(4, Casual), NoPerks: true}},
		{"4 good (expert)", Scenario{Team: team(4, Good), ReadyDelay: 4}},
		{"3 good + 1 idle", Scenario{Team: team(3, Good, 1, Idle), ReadyDelay: 4}},
		{"1 good", Scenario{Team: team(1, Good), ReadyDelay: 4}},
		{"4 bad (no wind)", Scenario{Team: team(4, Bad), ReadyDelay: 2}},
		{"1 bad (no wind)", Scenario{Team: team(1, Bad), ReadyDelay: 2}},
	}
	if f := os.Getenv("CT_BALANCE_ONLY"); f != "" {
		scens = slices.DeleteFunc(scens, func(s scen) bool { return !strings.Contains(s.name, f) })
	}
	summary := map[string]Summary{}
	for _, s := range scens {
		rs := RunMany(s.sc, 1000, runs)
		for i, r := range rs {
			t.Logf("%-22s seed=%d %v", s.name, 1000+i, r)
		}
		summary[s.name] = Summarize(rs)
	}
	t.Logf("%-22s %7s %10s %10s %9s %8s  %s", "scenario", "wins", "lives(won)", "loss wave", "win min", "all min", "losses by wave")
	for _, s := range scens {
		m := summary[s.name]
		var lw []string
		for w := 1; w <= 15; w++ {
			if n := m.LossesByWave[w]; n > 0 {
				lw = append(lw, fmt.Sprintf("w%d:%d", w, n))
			}
		}
		t.Logf("%-22s %3d/%-3d %10.1f %10.1f %9.1f %8.1f  %s", s.name, m.Wins, m.N, m.AvgLivesWon, m.AvgLossWave,
			m.AvgWinMins, m.AvgMinutes, strings.Join(lw, " "))
	}
	t.Log("average lives lost per wave:")
	for _, s := range scens {
		var b strings.Builder
		for _, v := range summary[s.name].LostPerWave {
			fmt.Fprintf(&b, "%5.1f", v)
		}
		t.Logf("  %-22s%s", s.name, b.String())
	}

	// Loose sanity bounds (stable at the default 6 seeds).
	check := func(name string, minWins, maxWins int) {
		m, ok := summary[name]
		if !ok {
			return
		}
		lo, hi := minWins*m.N/6, (maxWins*m.N+5)/6
		if m.Wins < lo || m.Wins > hi {
			t.Errorf("%s: won %d/%d, want %d..%d", name, m.Wins, m.N, lo, hi)
		}
	}
	check("4 casual", 2, 6)
	check("3 casual + 1 idle", 1, 5)
	check("4 good (expert)", 5, 6)
	check("4 bad (no wind)", 0, 0)
	check("4 casual, no winding", 0, 4)
	check("4 casual, no perks", 0, 4)
	if m, ok := summary["4 bad (no wind)"]; ok && m.AvgLossWave < 8 {
		t.Errorf("4 bad bots should survive the opening, lost on average at wave %.1f", m.AvgLossWave)
	}
}
