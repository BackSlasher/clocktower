package catapultcoop

import "testing"

// The game's first turn has no timer and waits for everyone; removing the
// one player who has not pressed done ends it, as if they had.
func TestRemoveEndsPlanWaitingOnlyForThem(t *testing.T) {
	g, ids := started(t, 3)
	if !g.untimed || g.Phase() != PhasePlan {
		t.Fatalf("phase %s untimed %v", g.Phase(), g.untimed)
	}
	for _, id := range ids[:2] {
		if err := g.SetPlan(id, Cmd{Done: true}); err != nil {
			t.Fatal(err)
		}
	}
	steps(g, 10)
	if g.Phase() != PhasePlan {
		t.Fatal("the untimed turn should still wait for p3")
	}
	g.RemovePlayer(ids[2])
	if g.Phase() != PhaseResolve {
		t.Fatalf("phase %s, want resolve", g.Phase())
	}
	for _, e := range g.Snapshot().Engineers {
		if e.PID == ids[2] {
			t.Fatal("engineer still on the board")
		}
	}
	for _, pl := range g.Snapshot().Plans {
		if pl.PID == ids[2] {
			t.Fatal("plan still listed")
		}
	}
}

func TestRemoveDropsCarriedBomb(t *testing.T) {
	g, ids := board(t, 2)
	put(g, ids[0], 4, 4)
	put(g, ids[1], 5, 5)
	ground(g, 5, 5, "keg") // their cell is taken: the bomb settles next to it
	b := give(g, ids[1], "keg")
	q(g, ids[1], mv(1, 0), wt)
	g.events = nil
	g.RemovePlayer(ids[1])
	if g.HasPlayer(ids[1]) || g.engineerAt(5, 5) != nil {
		t.Fatal("still seated")
	}
	var dropped *bomb
	for _, gb := range g.bombs {
		if gb.id == b.ID {
			dropped = gb
		}
	}
	if dropped == nil || dropped.kind != "keg" || (dropped.x == 5 && dropped.y == 5) || abs(dropped.x-5)+abs(dropped.y-5) != 1 {
		t.Fatalf("dropped %+v", dropped)
	}
	if ev := evs[EvBomb](g.events); len(ev) != 1 || ev[0].ID != b.ID {
		t.Fatalf("events %+v", g.events)
	}
	// Removing the host hands it on; the other player's turn still resolves.
	if g.Host() != ids[0] {
		t.Fatalf("host %s", g.Host())
	}
	if err := g.SetPlan(ids[0], Cmd{Done: true}); err != nil {
		t.Fatal(err)
	}
	if g.Phase() != PhaseResolve {
		t.Fatalf("phase %s", g.Phase())
	}
}

func TestRemoveDuringBreakAndHost(t *testing.T) {
	g, ids := started(t, 3)
	g.phase = PhaseBreak
	g.left = Defs.BreakTime
	if err := g.Ready(ids[1], true); err != nil {
		t.Fatal(err)
	}
	if err := g.Ready(ids[2], true); err != nil {
		t.Fatal(err)
	}
	if g.Phase() != PhaseBreak {
		t.Fatal("break ended without the host")
	}
	g.RemovePlayer(ids[0]) // the host, the one not ready
	if g.Phase() != PhasePlan || g.Level() != 2 {
		t.Fatalf("phase %s level %d", g.Phase(), g.Level())
	}
	if g.Host() != ids[1] {
		t.Fatalf("host %s", g.Host())
	}
}

func TestRemoveLastPlayerPauses(t *testing.T) {
	g, ids := started(t, 1)
	g.RemovePlayer(ids[0])
	if g.Host() != "" || len(g.players) != 0 || !g.Running() {
		t.Fatalf("host %q players %d phase %s", g.Host(), len(g.players), g.Phase())
	}
	tm := g.Time()
	steps(g, 2)
	if g.Time() != tm {
		t.Fatal("time advanced with nobody left")
	}
	id, _, err := g.AddPlayer("New")
	if err != nil {
		t.Fatal(err)
	}
	g.SetConnected(id, true)
	if g.Host() != id || !g.player(id).placed {
		t.Fatal("newcomer not seated as host")
	}
	if err := g.SetPlan(id, Cmd{Done: true}); err != nil {
		t.Fatal(err)
	}
	if g.Phase() != PhaseResolve {
		t.Fatalf("phase %s", g.Phase())
	}
}

func TestRemoveAfterEnd(t *testing.T) {
	g, ids := started(t, 2)
	g.player(ids[1]).st.kills = 9
	g.finish(true)
	g.RemovePlayer(ids[1])
	if _, ok := g.End().Stats[ids[1]]; ok {
		t.Fatal("stats kept")
	}
	for _, a := range g.End().Awards {
		if a.PID == ids[1] {
			t.Fatalf("award kept %+v", a)
		}
	}
	g.RemovePlayer("p99") // unknown: no-op
}
