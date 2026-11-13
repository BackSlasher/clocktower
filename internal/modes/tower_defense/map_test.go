package towerdefense

import (
	"encoding/json"
	"testing"
)

func TestMapConstraints(t *testing.T) {
	m := Map
	if m.W != 1920 || m.H != 1080 || m.Tower.X != 960 || m.Tower.Y != 540 {
		t.Fatalf("map frame: %+v", m)
	}
	if len(m.Paths) != 3 {
		t.Fatalf("want 3 paths, got %d", len(m.Paths))
	}
	edges := map[string]bool{}
	for i, p := range m.Paths {
		if len(p.Pts) < 5 {
			t.Errorf("path %d has only %d points; want several bends", i, len(p.Pts))
		}
		last := p.Pts[len(p.Pts)-1]
		if last[0] != m.Tower.X || last[1] != m.Tower.Y {
			t.Errorf("path %d ends at %v, not the tower", i, last)
		}
		s := p.Pts[0]
		switch {
		case s[0] <= 0:
			edges["west"] = true
		case s[0] >= m.W:
			edges["east"] = true
		case s[1] <= 0:
			edges["north"] = true
		case s[1] >= m.H:
			edges["south"] = true
		default:
			t.Errorf("path %d starts on-screen at %v", i, s)
		}
		for j := 1; j < len(p.Pts); j++ {
			a, b := p.Pts[j-1], p.Pts[j]
			if a[0] != b[0] && a[1] != b[1] {
				t.Errorf("path %d segment %d is not axis-aligned", i, j)
			}
		}
	}
	if len(edges) != 3 {
		t.Errorf("paths should enter from 3 different edges, got %v", edges)
	}

	// Plot tiers: about 22 for 1–4 players, ~28 for 5–6, ~34 for 7–8.
	open := func(n int) int {
		c := 0
		for _, pl := range m.Plots {
			if PlotOpen(pl.ID, n) {
				c++
			}
		}
		return c
	}
	for n, want := range map[int][2]int{1: {20, 24}, 4: {20, 24}, 5: {26, 30}, 6: {26, 30}, 7: {32, 36}, 8: {32, 36}} {
		if c := open(n); c < want[0] || c > want[1] {
			t.Errorf("%d players: %d open plots, want %d–%d", n, c, want[0], want[1])
		}
	}
	for i, pl := range m.Plots {
		if pl.Min < 0 || pl.Min > Defs.MaxPlayers {
			t.Errorf("plot %d: min %d", i, pl.Min)
		}
		if i > 0 && pl.Min < m.Plots[i-1].Min {
			t.Errorf("plot %d: tier plots come after the plots they add to (min %d after %d)", i, pl.Min, m.Plots[i-1].Min)
		}
	}
	if PlotOpen(-1, 8) || PlotOpen(len(m.Plots), 8) {
		t.Error("PlotOpen accepts a plot that does not exist")
	}
	covered := make([]int, len(m.Paths))
	premium := 0
	for i, pl := range m.Plots {
		if pl.ID != i {
			t.Errorf("plot %d has id %d", i, pl.ID)
		}
		if pl.X < 80 || pl.Y < 80 || pl.X > m.W-80 || pl.Y > m.H-80 {
			t.Errorf("plot %d at (%v,%v) is within 80px of the edge", i, pl.X, pl.Y)
		}
		if d := dist(pl.X, pl.Y, m.Tower.X, m.Tower.Y); d < 150 {
			t.Errorf("plot %d is %.0fpx from the tower", i, d)
		}
		nearest := 1e9
		for _, p := range m.Paths {
			nearest = min(nearest, p.DistToPoint(pl.X, pl.Y))
		}
		if nearest < 70 || nearest > 120 {
			t.Errorf("plot %d is %.0fpx from the nearest path (want 70–120)", i, nearest)
		}
		for j := 0; j < i; j++ {
			o := m.Plots[j]
			if d := dist(pl.X, pl.Y, o.X, o.Y); d < 120 {
				t.Errorf("plots %d and %d are only %.0fpx apart", i, j, d)
			}
		}
		if pl.Min > 1 {
			continue // the coverage rules below are for the base set
		}
		n := 0
		for k, p := range m.Paths {
			if p.CoverLen(pl.X, pl.Y, Defs.Towers["rivet"].Levels[0].Range, m.W, m.H) > 60 {
				covered[k]++
				n++
			}
		}
		if n >= 2 {
			premium++
		}
	}
	for k, c := range covered {
		if c < 4 {
			t.Errorf("path %d is covered by only %d plots", k, c)
		}
	}
	if premium < 3 {
		t.Errorf("want a few premium plots covering two paths, got %d", premium)
	}
}

func TestDefsJSON(t *testing.T) {
	b, err := json.Marshal(Defs)
	if err != nil {
		t.Fatal(err)
	}
	var back map[string]any
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"towers", "enemies", "towerOrder", "enemyOrder", "maxLives", "waves", "sellRefund", "windPerTap", "windBonus"} {
		if _, ok := back[k]; !ok {
			t.Errorf("defs JSON missing %q", k)
		}
	}
	if _, ok := back["WaveDefs"]; ok {
		t.Error("server-only fields leaked into defs JSON")
	}
	if len(Defs.WaveDefs) != Defs.Waves {
		t.Fatalf("%d wave defs, want %d", len(Defs.WaveDefs), Defs.Waves)
	}
	for i, w := range Defs.WaveDefs {
		for _, gr := range w.Groups {
			if Defs.Enemies[gr.Kind] == nil {
				t.Errorf("wave %d: unknown kind %q", i+1, gr.Kind)
			}
			for _, p := range gr.Paths {
				if p < 0 || p >= len(Map.Paths) {
					t.Errorf("wave %d: bad path %d", i+1, p)
				}
			}
			if gr.N < 1 || len(gr.Paths) == 0 {
				t.Errorf("wave %d: empty group", i+1)
			}
		}
	}
	for _, k := range Defs.TowerOrder {
		if len(Defs.Towers[k].Levels) != 3 {
			t.Errorf("tower %s needs 3 levels", k)
		}
	}
	// Bosses on 8 and 15 only.
	for i, w := range Defs.WaveDefs {
		boss := false
		for _, gr := range w.Groups {
			boss = boss || Defs.Enemies[gr.Kind].Boss
		}
		if boss != (i+1 == 8 || i+1 == 15) {
			t.Errorf("wave %d boss=%v", i+1, boss)
		}
	}
}
