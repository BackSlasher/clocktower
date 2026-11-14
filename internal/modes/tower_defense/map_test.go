package towerdefense

import (
	"encoding/json"
	"math/rand/v2"
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
			if Map.PlotOpen(pl.ID, n) {
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
	if Map.PlotOpen(-1, 8) || Map.PlotOpen(len(m.Plots), 8) {
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

// TestAllMaps validates every map: frame, ids, paths reaching the tower,
// plots on buildable ground (near a street but off it, apart, clear of the
// edges, the tower and the TV's wave plate), plot tiers, lanes and scenery.
func TestAllMaps(t *testing.T) {
	if len(Maps) < 3 || Maps[0] != Map || Map.ID != "brasswick" {
		t.Fatalf("want Brasswick first of 3+ maps, got %d", len(Maps))
	}
	ids := map[string]bool{}
	for _, m := range Maps {
		t.Run(m.ID, func(t *testing.T) {
			if m.ID == "" || m.ID == MapRandom || ids[m.ID] || MapByID(m.ID) != m {
				t.Fatalf("bad or duplicate id %q", m.ID)
			}
			ids[m.ID] = true
			if m.Name == "" || m.Desc == "" {
				t.Error("map needs a name and a description")
			}
			if m.W != 1920 || m.H != 1080 {
				t.Errorf("frame %vx%v", m.W, m.H)
			}
			T := m.Tower
			if T.X < 300 || T.Y < 300 || T.X > m.W-300 || T.Y > m.H-300 {
				t.Errorf("tower at %v is too close to the edge", T)
			}
			if len(m.Paths) == 0 {
				t.Fatal("no paths")
			}
			for i, p := range m.Paths {
				if len(p.Pts) < 4 || p.Name == "" {
					t.Errorf("path %d: %d points, name %q", i, len(p.Pts), p.Name)
				}
				if last := p.Pts[len(p.Pts)-1]; last[0] != T.X || last[1] != T.Y {
					t.Errorf("path %d ends at %v, not the tower", i, last)
				}
				if s := p.Pts[0]; s[0] > 0 && s[1] > 0 && s[0] < m.W && s[1] < m.H {
					t.Errorf("path %d starts on-screen at %v", i, s)
				}
				for j := 1; j < len(p.Pts); j++ {
					a, b := p.Pts[j-1], p.Pts[j]
					if a[0] != b[0] && a[1] != b[1] {
						t.Errorf("path %d segment %d is not axis-aligned", i, j)
					}
				}
				if p.Len() < 1200 || p.Len() > 4500 {
					t.Errorf("path %d is %.0fpx long", i, p.Len())
				}
			}
			// The wave table has three lanes; each must land on a path, and
			// every path must get enemies.
			used := make([]bool, len(m.Paths))
			for l := 0; l < 3; l++ {
				p := m.Lane(l)
				if p < 0 || p >= len(m.Paths) {
					t.Fatalf("lane %d maps to path %d", l, p)
				}
				used[p] = true
			}
			for _, wd := range Defs.WaveDefs {
				for _, gr := range wd.Groups {
					for _, l := range gr.Paths {
						if l < 0 || l > 2 {
							t.Fatalf("wave table uses lane %d", l)
						}
					}
				}
			}
			for i, u := range used {
				if !u {
					t.Errorf("no lane walks path %d", i)
				}
			}
			if m.HPMul != 0 && (m.HPMul < 0.5 || m.HPMul > 2) {
				t.Errorf("hpMul %v", m.HPMul)
			}

			// Tiers: 20–24 plots for 1–4 players, 26–30 for 5–6, 32–36 for 7–8.
			for n, want := range map[int][2]int{1: {20, 24}, 4: {20, 24}, 5: {26, 30}, 6: {26, 30}, 7: {32, 36}, 8: {32, 36}} {
				c := 0
				for _, pl := range m.Plots {
					if m.PlotOpen(pl.ID, n) {
						c++
					}
				}
				if c < want[0] || c > want[1] {
					t.Errorf("%d players: %d open plots, want %d–%d", n, c, want[0], want[1])
				}
			}
			for i, pl := range m.Plots {
				if pl.ID != i {
					t.Errorf("plot %d has id %d", i, pl.ID)
				}
				if pl.Min < 0 || pl.Min > Defs.MaxPlayers || (i > 0 && pl.Min < m.Plots[i-1].Min) {
					t.Errorf("plot %d: min %d (tier plots go last, in order)", i, pl.Min)
				}
				if pl.X < 80 || pl.Y < 80 || pl.X > m.W-80 || pl.Y > m.H-80 {
					t.Errorf("plot %d at (%v,%v) is within 80px of the edge", i, pl.X, pl.Y)
				}
				if pl.X < 470 && pl.Y < 270 {
					t.Errorf("plot %d at (%v,%v) is under the TV's wave plate", i, pl.X, pl.Y)
				}
				if d := dist(pl.X, pl.Y, T.X, T.Y); d < 150 {
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
					if d := dist(pl.X, pl.Y, m.Plots[j].X, m.Plots[j].Y); d < 120 {
						t.Errorf("plots %d and %d are only %.0fpx apart", i, j, d)
					}
				}
			}

			// Scenery must leave streets and plots clear.
			var sc struct {
				Water []struct {
					Pts []Point `json:"pts"`
					W   float64 `json:"w"`
				} `json:"water"`
				Yards []struct{ X, Y, R float64 } `json:"yards"`
			}
			if len(m.Scenery) > 0 {
				if err := json.Unmarshal(m.Scenery, &sc); err != nil {
					t.Fatalf("scenery: %v", err)
				}
			}
			for k, w := range sc.Water {
				wp := &MapPath{Pts: w.Pts}
				for _, pl := range m.Plots {
					if d := wp.DistToPoint(pl.X, pl.Y); d < w.W/2+30 {
						t.Errorf("water %d covers plot %d", k, pl.ID)
					}
				}
			}
			for k, y := range sc.Yards {
				for _, pl := range m.Plots {
					if dist(pl.X, pl.Y, y.X, y.Y) < y.R+40 {
						t.Errorf("yard %d covers plot %d", k, pl.ID)
					}
				}
				for i, p := range m.Paths {
					if p.DistToPoint(y.X, y.Y) < y.R+40 {
						t.Errorf("yard %d covers path %d", k, i)
					}
				}
				if dist(y.X, y.Y, T.X, T.Y) < y.R+160 {
					t.Errorf("yard %d covers the clock square", k)
				}
			}
		})
	}
}

// Map choice: host only, lobby only, known ids; "random" draws at Start; the
// room message names the map, and the pick survives a restart.
func TestPickMap(t *testing.T) {
	g, ids := newGame(t, 2)
	wantCode(t, g.Apply(ids[1], Cmd{T: "map", ID: "spindle"}), "not_host")
	wantCode(t, g.Apply(ids[0], Cmd{T: "map", ID: "atlantis"}), "bad_request")
	if err := g.Apply(ids[0], Cmd{T: "map", ID: "lockgate"}); err != nil {
		t.Fatal(err)
	}
	r := g.RoomState()
	if r.Map != "lockgate" || r.MapPick != "lockgate" || len(g.towers) != len(MapByID("lockgate").Plots) {
		t.Fatalf("room map %q pick %q", r.Map, r.MapPick)
	}
	if err := g.Start(ids[0]); err != nil {
		t.Fatal(err)
	}
	wantCode(t, g.Apply(ids[0], Cmd{T: "map", ID: "spindle"}), "bad_request")
	if err := g.Restart(ids[0]); err != nil {
		t.Fatal(err)
	}
	if g.RoomState().MapPick != "lockgate" {
		t.Fatal("pick lost on restart")
	}
	// Surprise me: "" in the lobby, a real map once started; every map comes up.
	seen := map[string]bool{}
	for seed := uint64(0); seed < 40; seed++ {
		g := New(rand.New(rand.NewPCG(seed, 9)))
		id, _, _ := g.AddPlayer("A")
		g.SetConnected(id, true)
		if g.MapPick() != MapRandom || g.RoomState().Map != "" {
			t.Fatalf("default pick %q, room map %q", g.MapPick(), g.RoomState().Map)
		}
		if err := g.Start(id); err != nil {
			t.Fatal(err)
		}
		m := g.RoomState().Map
		if MapByID(m) == nil || len(g.towers) != len(MapByID(m).Plots) {
			t.Fatalf("started on %q", m)
		}
		seen[m] = true
	}
	if len(seen) != len(Maps) {
		t.Errorf("random draw only ever chose %v", seen)
	}
}

// Lanes: on Spindle Row all three of the wave table's lanes walk the one
// street.
func TestLanes(t *testing.T) {
	g, ids := newGame(t, 1)
	if err := g.PickMap(ids[0], "spindle"); err != nil {
		t.Fatal(err)
	}
	if err := g.Start(ids[0]); err != nil {
		t.Fatal(err)
	}
	g.startWave("")
	n := map[int]int{}
	for _, s := range g.spawns {
		n[s.path]++
	}
	// wave 1: 12 scraps over lanes 0, 1, 2 in turn
	if n[0] != 12 || len(n) != 1 {
		t.Fatalf("spawns per path %v", n)
	}
}
