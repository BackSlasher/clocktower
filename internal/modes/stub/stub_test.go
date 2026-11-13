package stub

import (
	"encoding/json"
	"math/rand/v2"
	"testing"

	"clocktower/internal/mode"
	towerdefense "clocktower/internal/modes/tower_defense"
)

func TestLifecycle(t *testing.T) {
	g := New(rand.New(rand.NewPCG(1, 2)), nil)
	a, _, err := g.AddPlayer("Ada")
	if err != nil {
		t.Fatal(err)
	}
	b, _, _ := g.AddPlayer(" Brunel ")
	g.SetConnected(a, true)
	g.SetConnected(b, true)
	if g.Host() != a || g.Phase() != mode.PhaseLobby || g.Running() {
		t.Fatalf("host %q phase %q", g.Host(), g.Phase())
	}
	if err := g.Command(b, "start", nil); err != mode.ErrNotHost {
		t.Fatalf("non-host start: %v", err)
	}
	if err := g.Command(a, "restart", nil); err != mode.ErrBadRequest {
		t.Fatalf("restart in lobby: %v", err)
	}
	if err := g.Command(a, "bogus", nil); err != nil {
		t.Fatalf("unknown command: %v", err)
	}
	v0 := g.SlowVersion()
	if err := g.Command(a, "start", nil); err != nil {
		t.Fatal(err)
	}
	if !g.Running() || g.Phase() != PhaseRunning || g.SlowVersion() == v0 {
		t.Fatal("start did not run the game")
	}
	for i := 0; i < 20; i++ {
		g.Step(0.25)
	}
	raw, _ := json.Marshal(g.Snapshot())
	var snap struct {
		T       string
		Phase   string
		Seconds int
	}
	json.Unmarshal(raw, &snap)
	if snap.T != "snap" || snap.Phase != "running" || snap.Seconds != 5 {
		t.Fatalf("snap %s", raw)
	}
	if err := g.Command(b, "restart", nil); err != mode.ErrNotHost {
		t.Fatalf("non-host restart: %v", err)
	}
	if err := g.Command(a, "restart", nil); err != nil {
		t.Fatal(err)
	}
	if g.Phase() != mode.PhaseLobby || g.Running() {
		t.Fatal("restart did not return to the lobby")
	}
	if len(g.RoomState().(roomMsg).Players) != 2 {
		t.Fatal("players lost on restart")
	}
	// A new run starts its clock from zero.
	g.Command(a, "start", nil)
	if s := g.Snapshot().(snapMsg); s.Seconds != 0 {
		t.Fatalf("clock not reset: %d", s.Seconds)
	}
}

func TestBadNameAndFull(t *testing.T) {
	g := New(nil, nil)
	if _, _, err := g.AddPlayer("   "); err != mode.ErrBadName {
		t.Fatalf("empty name: %v", err)
	}
	if _, _, err := g.AddPlayer("abcdefghijklm"); err != mode.ErrBadName {
		t.Fatalf("13 chars: %v", err)
	}
	for i := 0; i < maxPlayers; i++ {
		if _, _, err := g.AddPlayer("p"); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := g.AddPlayer("late"); err != mode.ErrRoomFull {
		t.Fatalf("9th player: %v", err)
	}
}

func TestHostHandover(t *testing.T) {
	g := New(nil, nil)
	a, _, _ := g.AddPlayer("A")
	b, _, _ := g.AddPlayer("B")
	g.SetConnected(a, true)
	g.SetConnected(b, true)
	g.SetConnected(a, false)
	if g.Host() != b {
		t.Fatalf("host %q after the host left", g.Host())
	}
}

// Switching modes carries players over (ids, names, colours, host).
func TestRosterCarriedBothWays(t *testing.T) {
	reg := mode.NewRegistry()
	towerdefense.RegisterTo(reg)
	RegisterTo(reg)
	tdm, _ := reg.Get("tower_defense")
	sm, _ := reg.Get("stub")

	g := tdm.New(nil, nil)
	a, _, _ := g.AddPlayer("Ada")
	b, _, _ := g.AddPlayer("Brunel")
	g.SetConnected(a, true)
	g.SetConnected(b, true)
	roster := g.Roster()

	s := sm.New(nil, roster)
	if s.Host() != a || len(s.Roster()) != 2 || !s.HasPlayer(b) {
		t.Fatalf("stub roster %+v host %q", s.Roster(), s.Host())
	}
	back := tdm.New(nil, s.Roster())
	if back.Host() != a || len(back.Roster()) != 2 {
		t.Fatalf("tower roster %+v", back.Roster())
	}
	for i, m := range back.Roster() {
		if m != roster[i] {
			t.Fatalf("member %d changed: %+v vs %+v", i, m, roster[i])
		}
	}
	c, _, _ := s.AddPlayer("Cog")
	if c != "p3" {
		t.Fatalf("next id after carry-over: %q", c)
	}
}

func TestRemovePlayer(t *testing.T) {
	g := New(rand.New(rand.NewPCG(1, 2)), nil)
	a, _, _ := g.AddPlayer("Ada")
	b, _, _ := g.AddPlayer("Bea")
	g.SetConnected(a, true)
	g.SetConnected(b, true)
	v := g.SlowVersion()
	g.RemovePlayer(a)
	if g.HasPlayer(a) || g.Host() != b || g.SlowVersion() == v {
		t.Fatalf("host %s", g.Host())
	}
	g.RemovePlayer(b)
	if g.Host() != "" || len(g.Roster()) != 0 {
		t.Fatalf("host %q", g.Host())
	}
	g.RemovePlayer("p9")
}
