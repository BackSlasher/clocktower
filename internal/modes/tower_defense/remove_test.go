package towerdefense

import (
	"math"
	"testing"
)

func TestRemovePlayerMidWave(t *testing.T) {
	g, ids := started(t, 3)
	plot, _ := plotNear(0, 120)
	if err := g.Build(ids[1], plot, "rivet"); err != nil {
		t.Fatal(err)
	}
	g.players[1].offer = []string{"sights"}
	g.players[1].perks["sights"] = 2
	g.startWave("") // a real wave with spawns
	steps(g, 3)
	g.RemovePlayer(ids[1])
	if g.HasPlayer(ids[1]) || g.NumPlayers() != 2 {
		t.Fatal("still seated")
	}
	tw := g.towers[plot]
	if tw == nil || tw.owner != "" {
		t.Fatalf("tower %+v", tw)
	}
	if m := rangeMul(g.player(tw.owner)); m != 1 {
		t.Fatalf("a removed owner's perks still apply: %v", m)
	}
	// Anyone may upgrade it; nobody can sell it.
	g.players[0].purse = 1000
	if err := g.Upgrade(ids[0], plot); err != nil {
		t.Fatal(err)
	}
	wantCode(t, g.Sell(ids[0], plot), "not_owner")
	if _, ok := g.Snapshot().Purses[ids[1]]; ok {
		t.Fatal("removed player's purse still in snap")
	}
	for _, p := range g.RoomState().Players {
		if p.ID == ids[1] {
			t.Fatal("removed player in room")
		}
	}
	// The wave goes on and the ownerless tower keeps firing; nothing panics.
	wave, fired := g.Wave(), false
	g.Snapshot() // drain
	for i := 0; i < 30*180 && g.Phase() == PhaseWave; i++ {
		g.Step(dt)
		for _, ev := range g.Snapshot().Ev {
			if s, ok := ev.(EvShot); ok && s.Plot == plot {
				fired = true
			}
		}
	}
	if !fired {
		t.Fatal("the ownerless tower never fired")
	}
	if g.Phase() != PhaseBuild || g.Wave() != wave+1 {
		t.Fatalf("phase %s wave %d", g.Phase(), g.Wave())
	}
	// HP scaling of the next wave follows the two remaining players.
	g.startWave("")
	want := Defs.WaveDefs[wave].HPMul * (1 + Defs.HPPerPlayer)
	if math.Abs(g.waveHPMul-want) > 1e-9 {
		t.Fatalf("hp mul %.3f want %.3f", g.waveHPMul, want)
	}
}

func TestRemovePlayerReadyAndHost(t *testing.T) {
	g, ids := started(t, 3)
	if err := g.Ready(ids[0], true); err != nil {
		t.Fatal(err)
	}
	if err := g.Ready(ids[2], true); err != nil {
		t.Fatal(err)
	}
	if g.Phase() != PhaseBuild {
		t.Fatal("wave started without p2")
	}
	g.RemovePlayer(ids[1]) // the one everybody waited for
	if g.Phase() != PhaseWave {
		t.Fatalf("phase %s: the ready check should pass once p2 is gone", g.Phase())
	}
	// Host removed: the longest-connected remaining player takes over.
	g.RemovePlayer(ids[0])
	if g.Host() != ids[2] {
		t.Fatalf("host %s", g.Host())
	}
	// Last player removed: no host, the game pauses.
	g.RemovePlayer(ids[2])
	if g.Host() != "" || g.NumPlayers() != 0 {
		t.Fatalf("host %q players %d", g.Host(), g.NumPlayers())
	}
	tm := g.Time()
	steps(g, 2)
	if g.Time() != tm {
		t.Fatal("sim advanced with nobody left")
	}
	// A newcomer becomes host and the game goes on.
	id, _, err := g.AddPlayer("New")
	if err != nil {
		t.Fatal(err)
	}
	g.SetConnected(id, true)
	if g.Host() != id || g.Purse(id) <= 0 {
		t.Fatalf("host %s purse %d", g.Host(), g.Purse(id))
	}
	g.RemovePlayer("p99") // unknown: no-op
}

func TestRemovePlayerAfterEnd(t *testing.T) {
	g, ids := started(t, 2)
	g.players[1].st.kills = 50
	g.finish(false)
	if _, ok := g.End().Stats[ids[1]]; !ok {
		t.Fatal("no stats")
	}
	g.RemovePlayer(ids[1])
	if _, ok := g.End().Stats[ids[1]]; ok {
		t.Fatal("stats kept")
	}
	for _, a := range g.End().Awards {
		if a.PID == ids[1] {
			t.Fatalf("award kept %+v", a)
		}
	}
}
