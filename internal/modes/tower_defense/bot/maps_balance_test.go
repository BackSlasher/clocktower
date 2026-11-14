package bot

import (
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"testing"

	game "clocktower/internal/modes/tower_defense"
)

// TestMapBalance plays every map with 1–8 casual bots (and skilled teams)
// and compares each map's win rates with Brasswick's on the same seeds. It
// is slow, so it only runs when CT_MAP_BALANCE is set to the number of seeds
// per scenario (100+ for tuning; ±8 points is the target, see
// docs/DESIGN.md "Balance targets"):
//
//	CT_MAP_BALANCE=200 go test ./internal/modes/tower_defense/bot -run TestMapBalance -v
//
// For tuning: CT_MAP_ONLY limits it to maps whose id contains the value (the
// comparison with Brasswick needs Brasswick in the run), CT_MAP_HPMUL
// overrides those maps' hpMul, and CT_MAP_CASUAL=1 skips the skilled teams.
func TestMapBalance(t *testing.T) {
	v := os.Getenv("CT_MAP_BALANCE")
	if v == "" || testing.Short() {
		t.Skip("set CT_MAP_BALANCE=<seeds> to run")
	}
	runs, err := strconv.Atoi(v)
	if err != nil || runs < 1 {
		t.Fatalf("bad CT_MAP_BALANCE %q", v)
	}
	var maps []*game.MapT
	for _, m := range game.Maps {
		if f := os.Getenv("CT_MAP_ONLY"); f == "" || strings.Contains(m.ID, f) {
			maps = append(maps, m)
		}
	}
	if v := os.Getenv("CT_MAP_HPMUL"); v != "" {
		mul, err := strconv.ParseFloat(v, 64)
		if err != nil {
			t.Fatalf("bad CT_MAP_HPMUL %q", v)
		}
		for _, m := range maps {
			defer func(old float64) { m.HPMul = old }(m.HPMul)
			m.HPMul = mul
		}
	}
	type scen struct {
		name string
		sc   Scenario
		good bool
	}
	var scens []scen
	for n := 1; n <= 8; n++ {
		scens = append(scens, scen{fmt.Sprintf("%d casual", n), Scenario{Team: team(n, Casual)}, false})
	}
	if os.Getenv("CT_MAP_CASUAL") == "" {
		scens = append(scens,
			scen{"1 good", Scenario{Team: team(1, Good), ReadyDelay: 4}, true},
			scen{"4 good", Scenario{Team: team(4, Good), ReadyDelay: 4}, true},
			scen{"8 good", Scenario{Team: team(8, Good), ReadyDelay: 4}, true},
		)
	}
	pct := map[string]map[string]float64{} // map → scenario → win %
	head := fmt.Sprintf("%-10s", "map")
	for _, s := range scens {
		head += fmt.Sprintf(" %8s", s.name)
	}
	t.Log(head)
	for _, m := range maps {
		pct[m.ID] = map[string]float64{}
		line := fmt.Sprintf("%-10s", m.ID)
		for _, s := range scens {
			sc := s.sc
			sc.Map = m.ID
			sum := Summarize(RunMany(sc, 5000, runs))
			p := 100 * float64(sum.Wins) / float64(sum.N)
			pct[m.ID][s.name] = p
			line += fmt.Sprintf(" %7.0f%%", p)
		}
		t.Log(line)
	}
	// With few seeds the noise is large: allow ±8 points plus two standard
	// errors of the difference.
	slack := 8 + 2*100*math.Sqrt(2*0.25/float64(runs))
	ref, ok := pct["brasswick"]
	for _, m := range maps {
		if m.ID == "brasswick" || !ok {
			continue
		}
		for _, s := range scens {
			got := pct[m.ID][s.name]
			if s.good {
				if got < 90 {
					t.Errorf("%s, %s: skilled team won only %.0f%%", m.ID, s.name, got)
				}
				continue
			}
			if d := got - ref[s.name]; math.Abs(d) > slack {
				t.Errorf("%s, %s: %.0f%% vs Brasswick %.0f%% (±%.0f)", m.ID, s.name, got, ref[s.name], slack)
			}
		}
	}
}
