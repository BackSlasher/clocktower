package bot

import (
	"os"
	"testing"
)

// TestBalance plays headless games with scripted bots. It asserts only loose
// bounds so it stays stable; run with -v to see the table, and set
// CT_BALANCE_RUNS to play more seeds per scenario.
func TestBalance(t *testing.T) {
	if testing.Short() {
		t.Skip("slow")
	}
	runs := 6
	if os.Getenv("CT_BALANCE_RUNS") != "" {
		var n int
		for _, c := range os.Getenv("CT_BALANCE_RUNS") {
			n = n*10 + int(c-'0')
		}
		runs = n
	}
	type scen struct {
		name string
		sc   Scenario
	}
	scens := []scen{
		{"4 good", Scenario{Players: 4, Skill: Good, ReadyDelay: 4}},
		{"4 good, never ready", Scenario{Players: 4, Skill: Good, ReadyDelay: -1}},
		{"1 good", Scenario{Players: 1, Skill: Good, ReadyDelay: 4}},
		{"2 good", Scenario{Players: 2, Skill: Good, ReadyDelay: 4}},
		{"8 good", Scenario{Players: 8, Skill: Good, ReadyDelay: 4}},
		{"4 bad", Scenario{Players: 4, Skill: Bad, ReadyDelay: 2}},
		{"1 bad", Scenario{Players: 1, Skill: Bad, ReadyDelay: 2}},
	}
	summary := map[string][]Result{}
	for _, s := range scens {
		for i := 0; i < runs; i++ {
			sc := s.sc
			sc.Seed = uint64(1000 + i)
			r := Run(sc)
			summary[s.name] = append(summary[s.name], r)
			t.Logf("%-22s seed=%d %v", s.name, sc.Seed, r)
		}
	}
	for _, s := range scens {
		wins, lives, wave, tm := 0, 0, 0, 0.0
		for _, r := range summary[s.name] {
			if r.Won {
				wins++
			}
			lives += r.Lives
			wave += r.Wave
			tm += r.Time
		}
		n := len(summary[s.name])
		t.Logf("SUMMARY %-22s wins %d/%d  avg lives %.1f  avg wave %.1f  avg time %.1f min",
			s.name, wins, n, float64(lives)/float64(n), float64(wave)/float64(n), tm/float64(n)/60)
	}
	count := func(name string) (wins int) {
		for _, r := range summary[name] {
			if r.Won {
				wins++
			}
		}
		return
	}
	if w := count("4 good"); w*2 < runs {
		t.Errorf("4 good bots should win most games, won %d/%d", w, runs)
	}
	if w := count("4 bad"); w > 0 {
		t.Errorf("4 bad bots should lose, won %d/%d", w, runs)
	}
}
