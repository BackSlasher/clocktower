package catapultcoop

import (
	"encoding/json"
	"math/rand/v2"
	"strings"
	"testing"

	"clocktower/internal/mode"
)

func TestStartSeatsEngineersAndSpawnsTutorial(t *testing.T) {
	g, ids := started(t, 3)
	if g.Phase() != PhasePlan || g.Level() != 1 || g.Round() != 1 || g.keep.ID != "small" {
		t.Fatalf("phase %s level %d round %d keep %s", g.phase, g.level, g.round, g.keep.ID)
	}
	for i, id := range ids {
		if at(g, id) != g.lay.Spawns[i] {
			t.Fatalf("%s at %v", id, at(g, id))
		}
	}
	s := g.Snapshot()
	// The tutorial's one machine comes later (a setup window).
	if len(s.Bombs) != 1 || s.Bombs[0].Kind != "keg" || len(s.Machines) != 0 || len(g.script) != 1 {
		t.Fatalf("snap %+v", s)
	}
	var names []string
	for _, e := range s.Ev {
		b, _ := json.Marshal(e)
		var h struct{ E string }
		_ = json.Unmarshal(b, &h)
		names = append(names, h.E)
	}
	if strings.Join(names, ",") != "level_start,place,place,place,bomb" {
		t.Fatalf("events %v", names)
	}
	// Six or more players get the large keep.
	g6, _ := started(t, 6)
	if g6.keep.ID != "large" {
		t.Fatal("6 players should get the large keep")
	}
}

func TestStartErrors(t *testing.T) {
	g, ids := newGame(t, 2)
	wantCode(t, g.Start(ids[1]), "not_host")
	wantCode(t, g.Apply(ids[0], Cmd{T: "plan", A: AWait}), "bad_request")
	if err := g.Start(ids[0]); err != nil {
		t.Fatal(err)
	}
	wantCode(t, g.Start(ids[0]), "bad_request")
}

func TestPlanPhaseEndsWhenAllPlannedOrOnTimeout(t *testing.T) {
	g, ids := started(t, 2)
	if err := g.Apply(ids[0], Cmd{T: "plan", A: AWait}); err != nil {
		t.Fatal(err)
	}
	if g.Phase() != PhasePlan || !g.RoomState().Players[0].Planned {
		t.Fatal("ended early or planned flag missing")
	}
	// Replace, then clear, then plan again.
	if err := g.Apply(ids[0], cmd(AMove, g.lay.Spawns[0][0]+1, g.lay.Spawns[0][1]-1)); err != nil {
		t.Fatal(err)
	}
	if err := g.Apply(ids[0], Cmd{T: "plan", A: AClear}); err != nil || g.RoomState().Players[0].Planned {
		t.Fatal("clear failed")
	}
	_ = g.Apply(ids[0], Cmd{T: "plan", A: AWait})
	_ = g.Apply(ids[1], Cmd{T: "plan", A: AWait})
	if g.Phase() != PhaseResolve {
		t.Fatalf("phase %s", g.phase)
	}
	wantCode(t, g.Apply(ids[0], Cmd{T: "plan", A: AWait}), "too_late")
	leave(g, 5)
	if g.Phase() != PhasePlan || g.Round() != 2 {
		t.Fatalf("phase %s round %d", g.phase, g.round)
	}
	// Timeout.
	if leave(g, Defs.PlanTime+0.1) != PhaseResolve {
		t.Fatalf("timeout: phase %s", g.phase)
	}
}

func TestPausesWithNobodyConnected(t *testing.T) {
	g, ids := started(t, 1)
	g.SetConnected(ids[0], false)
	steps(g, 100)
	if g.Phase() != PhasePlan || g.Round() != 1 {
		t.Fatal("ran while empty")
	}
}

func TestAwayRule(t *testing.T) {
	g, ids := started(t, 2)
	a, b := ids[0], ids[1]
	// b never plans: rounds 1 and 2 wait for the timer, then b is away and
	// a's plan alone ends round 3.
	for r := 1; r <= 2; r++ {
		_ = g.Apply(a, Cmd{T: "plan", A: AWait})
		if g.Phase() != PhasePlan {
			t.Fatalf("round %d ended without b", r)
		}
		leave(g, Defs.PlanTime+0.1)
		leave(g, 5)
	}
	rs := g.RoomState()
	if !rs.Players[1].Away || rs.Players[0].Away {
		t.Fatalf("away flags %+v", rs.Players)
	}
	if g.activeCount() != 1 {
		t.Fatalf("active %d", g.activeCount())
	}
	_ = g.Apply(a, Cmd{T: "plan", A: AWait})
	if g.Phase() != PhaseResolve {
		t.Fatal("round waited for an away player")
	}
	leave(g, 5)
	// Any plan stands b back up.
	_ = g.Apply(b, Cmd{T: "plan", A: AWait})
	if g.RoomState().Players[1].Away {
		t.Fatal("plan did not stand b up")
	}
	// A disconnected player is away at once and not waited for.
	g.SetConnected(b, false)
	if g.Phase() != PhasePlan {
		t.Fatal("b's plan counted: wrong")
	}
	_ = g.Apply(a, Cmd{T: "plan", A: AWait})
	if g.Phase() != PhaseResolve || !g.RoomState().Players[1].Away {
		t.Fatal("disconnect should make b away")
	}
}

func TestDisconnectEndsPlanPhase(t *testing.T) {
	g, ids := started(t, 2)
	_ = g.Apply(ids[0], Cmd{T: "plan", A: AWait})
	g.SetConnected(ids[1], false)
	if g.Phase() != PhaseResolve {
		t.Fatal("phase should end once the only missing player left")
	}
}

// clearLevel kills everything and resolves, leaving the level done.
func clearLevel(t *testing.T, g *Game) {
	t.Helper()
	if g.Phase() == PhaseResolve {
		leave(g, 5)
	}
	g.machines, g.script = nil, nil
	for _, p := range g.players {
		if p.connected && p.plan == nil && g.Phase() == PhasePlan {
			_ = g.Apply(p.id, Cmd{T: "plan", A: AWait})
		}
	}
	leave(g, 5)
}

func TestLevelFlowToWin(t *testing.T) {
	g, ids := started(t, 2)
	g.player(ids[0]).carry = &BombRef{ID: 999, Kind: "keg"}
	clearLevel(t, g)
	if g.Phase() != PhaseBreak || g.Level() != 1 {
		t.Fatalf("phase %s level %d", g.phase, g.level)
	}
	rs := g.RoomState()
	for _, p := range rs.Players {
		if len(p.Offer) != 3 {
			t.Fatalf("offer %+v", p.Offer)
		}
	}
	// Commands in the break: plan is too late, ready ends it when all are ready.
	wantCode(t, g.Apply(ids[0], Cmd{T: "plan", A: AWait}), "too_late")
	_ = g.Apply(ids[0], Cmd{T: "ready"})
	if g.Phase() != PhaseBreak || !g.RoomState().Players[0].Ready {
		t.Fatal("break ended early")
	}
	_ = g.Apply(ids[1], Cmd{T: "ready"})
	if g.Phase() != PhasePlan || g.Level() != 2 || g.Round() != 1 {
		t.Fatalf("phase %s level %d", g.phase, g.level)
	}
	// New layout, engineers on its spawns, carried bombs cleared, offers gone.
	if g.lay.ID != Defs.Levels[1].Layout || g.RoomState().Layout.ID != g.lay.ID {
		t.Fatalf("layout %s", g.lay.ID)
	}
	if at(g, ids[0]) != g.lay.Spawns[0] || g.player(ids[0]).carry != nil || g.RoomState().Players[0].Offer != nil {
		t.Fatal("level start did not reset the engineers")
	}
	if len(g.bombs) != len(g.lay.Bombs) {
		t.Fatalf("bombs %d, layout has %d", len(g.bombs), len(g.lay.Bombs))
	}
	for _, b := range g.bombs {
		if b.kind != "keg" {
			t.Fatalf("level 2 bomb kind %s", b.kind)
		}
	}
	for lv := 2; lv < len(Defs.Levels); lv++ {
		clearLevel(t, g)
		leave(g, Defs.BreakTime+0.1) // break times out
		if g.Level() != lv+1 || g.Phase() != PhasePlan {
			t.Fatalf("level %d phase %s", g.level, g.phase)
		}
	}
	clearLevel(t, g)
	if g.Phase() != PhaseWon || g.End() == nil || !g.End().Won || g.End().Level != len(Defs.Levels) {
		t.Fatalf("phase %s end %+v", g.phase, g.End())
	}
	if g.Running() {
		t.Fatal("running after the win")
	}
}

func TestLoseWhenWallFalls(t *testing.T) {
	g, ids := started(t, 1)
	g.wall = 1
	addMachine(g, "scrap", 0, 0)
	_ = g.Apply(ids[0], Cmd{T: "plan", A: AWait})
	if g.Phase() != PhaseResolve || g.Wall() != 0 {
		t.Fatalf("phase %s wall %d", g.phase, g.wall)
	}
	leave(g, 5)
	if g.Phase() != PhaseLost || g.End() == nil || g.End().Won {
		t.Fatalf("phase %s", g.phase)
	}
}

func TestBombKindsPerLevel(t *testing.T) {
	for lv, want := range map[int][]string{1: {"keg"}, 2: {"keg"}, 3: {"keg", "grapeshot"}, 4: {"keg", "grapeshot", "stopwatch"}} {
		var got []string
		for _, k := range Defs.BombOrder {
			if Defs.Levels[lv-1].Bombs[k] > 0 {
				got = append(got, k)
			}
		}
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("level %d bombs %v want %v", lv, got, want)
		}
	}
	// A damaging bomb is always available: with only a stopwatch around,
	// the next draw is never a stopwatch.
	g, _ := board(t, 1)
	g.level = 4
	for i := 0; i < 50; i++ {
		g.bombs = []*bomb{{id: 1, kind: "stopwatch", x: 4, y: 4}}
		if k := g.drawKind(); k == "stopwatch" {
			t.Fatal("drew a stopwatch with no damaging bomb around")
		}
	}
}

func TestPerks(t *testing.T) {
	g, ids := board(t, 1)
	a := ids[0]
	p := g.player(a)
	put(g, a, 3, 7)
	give(g, a, "keg")
	_, err := g.validate(p, cmd(AThrow, 3, 1))
	wantCode(t, err, "bad_plan") // 6 cells
	p.perks["strong_arm"] = 1
	if _, err := g.validate(p, cmd(AThrow, 3, 1)); err != nil {
		t.Fatal(err)
	}
	p.perks["light_feet"] = 1
	if _, err := g.validate(p, cmd(AMove, 3, 5)); err != nil { // carrying: 2
		t.Fatal(err)
	}
	p.carry = nil
	if _, err := g.validate(p, cmd(AMove, 3, 4)); err != nil { // free: 3
		t.Fatal(err)
	}
	ground(g, 5, 7, "keg")
	_, err = g.validate(p, cmd(APickup, 5, 7))
	wantCode(t, err, "bad_plan")
	p.perks["long_reach"] = 1
	if _, err := g.validate(p, cmd(APickup, 5, 7)); err != nil {
		t.Fatal(err)
	}
	if c := g.RoomState().Players[0].Can; c.Throw != 6 || c.Move != 3 || c.MoveCarry != 2 || c.Reach != 2 || c.QuickHands {
		t.Fatalf("abilities %+v", c)
	}

	// Picking: break only, from the offer; Mason heals the wall (capped).
	wantCode(t, g.Perk(a, "mason"), "bad_request")
	g.phase = PhaseBreak
	g.wall = 5
	p.offer = []string{"mason", "quick_hands", "light_feet"}
	wantCode(t, g.Perk(a, "nope"), "bad_request")
	wantCode(t, g.Perk(a, "strong_arm"), "bad_request")
	if err := g.Perk(a, "mason"); err != nil || g.wall != 5+Defs.Perks["mason"].Amount || p.offer != nil {
		t.Fatalf("mason: %v wall %d", err, g.wall)
	}
	wantCode(t, g.Perk(a, "quick_hands"), "bad_request") // offer used up
	// One Mason per break: taking it removes it from the others' offers.
	g2, ids2 := started(t, 2)
	g2.phase, g2.wall = PhaseBreak, 3
	g2.player(ids2[0]).offer = []string{"mason", "light_feet"}
	g2.player(ids2[1]).offer = []string{"strong_arm", "mason"}
	if err := g2.Perk(ids2[0], "mason"); err != nil || g2.wall != 3+Defs.Perks["mason"].Amount {
		t.Fatal(err)
	}
	if o := g2.player(ids2[1]).offer; len(o) != 1 || o[0] != "strong_arm" {
		t.Fatalf("other offer %v", o)
	}
	// Maxed perks and Mason at full wall are never offered.
	g.wall = Defs.WallHP
	for i := 0; i < 20; i++ {
		g.makeOffers()
		for _, id := range p.offer {
			if id == "mason" || id == "strong_arm" || id == "light_feet" || id == "long_reach" {
				t.Fatalf("offered %s", id)
			}
		}
	}
}

func TestRestart(t *testing.T) {
	g, ids := started(t, 2)
	g.player(ids[0]).perks["mason"] = 1
	wantCode(t, g.Restart(ids[1]), "not_host")
	if err := g.Restart(ids[0]); err != nil {
		t.Fatal(err)
	}
	if g.Phase() != PhaseLobby || len(g.players) != 2 || g.player(ids[0]).placed || len(g.player(ids[0]).perks) != 0 {
		t.Fatal("restart did not reset")
	}
	if s := g.View(); len(s.Engineers) != 0 || len(s.Machines) != 0 {
		t.Fatal("board survived the restart")
	}
	wantCode(t, g.Restart(ids[0]), "bad_request")
	if err := g.Start(ids[0]); err != nil || g.Level() != 1 || g.Wall() != Defs.WallHP {
		t.Fatal("could not start again")
	}
}

func TestOpenPlans(t *testing.T) {
	g, ids := newGame(t, 2)
	wantCode(t, g.Apply(ids[1], Cmd{T: "opt", OpenPlans: BoolP(true)}), "not_host")
	_ = g.Start(ids[0])
	wantCode(t, g.Apply(ids[0], Cmd{T: "opt", OpenPlans: BoolP(true)}), "bad_request")
	_ = g.Apply(ids[0], Cmd{T: "plan", A: AWait})
	if rs := g.RoomState(); rs.Players[0].Plan != nil || !rs.Players[0].Planned || rs.OpenPlans {
		t.Fatal("plan leaked with open plans off")
	}
	_ = g.Restart(ids[0])
	if err := g.Apply(ids[0], Cmd{T: "opt", OpenPlans: BoolP(true)}); err != nil {
		t.Fatal(err)
	}
	_ = g.Start(ids[0])
	s := g.lay.Spawns[0]
	_ = g.Apply(ids[0], cmd(AMove, s[0]+1, s[1]))
	rs := g.RoomState()
	if !rs.OpenPlans || rs.Players[0].Plan == nil || rs.Players[0].Plan.A != AMove || len(rs.Players[0].Plan.Path) != 1 {
		t.Fatalf("open plan %+v", rs.Players[0].Plan)
	}
	// Survives a restart (it is a room option).
	_ = g.Restart(ids[0])
	if !g.RoomState().OpenPlans {
		t.Fatal("option lost on restart")
	}
}

func TestReconnectAndLateJoin(t *testing.T) {
	g, ids := started(t, 2)
	g.SetConnected(ids[1], false)
	g.SetConnected(ids[1], true)
	if at(g, ids[1]) != g.lay.Spawns[1] {
		t.Fatal("reconnect moved the engineer")
	}
	// The reconnecting phone can still commit.
	if err := g.Apply(ids[1], Cmd{T: "plan", A: AWait}); err != nil {
		t.Fatal(err)
	}
	ev := len(g.events)
	v := g.View()
	if len(v.Ev) != 0 || len(g.events) != ev || len(v.Engineers) != 2 {
		t.Fatal("View must not drain events")
	}
	if rs := g.RoomState(); rs.Layout == nil || rs.Layout.ID != g.lay.ID || rs.Keep != "small" {
		t.Fatal("room lacks the layout")
	}
	// Late join: seated on a free spawn on connect, in any phase.
	pid, _, err := g.AddPlayer("Late")
	if err != nil {
		t.Fatal(err)
	}
	if g.player(pid).placed {
		t.Fatal("seated before connecting")
	}
	g.SetConnected(pid, true)
	if at(g, pid) != g.lay.Spawns[2] {
		t.Fatalf("late joiner at %v", at(g, pid))
	}
	// A disconnected player at a level start gets no engineer until they return.
	g.SetConnected(ids[1], false)
	g.startLevel(2)
	if g.player(ids[1]).placed {
		t.Fatal("seated while away")
	}
	g.SetConnected(ids[1], true)
	if !g.player(ids[1]).placed {
		t.Fatal("not seated on return")
	}
}

func TestHostMigrationAndFullRoom(t *testing.T) {
	g, ids := newGame(t, 8)
	g.SetConnected(ids[0], false)
	if g.Host() != ids[1] {
		t.Fatalf("host %s", g.Host())
	}
	// Lobby: a 9th evicts a disconnected player.
	_, ev, err := g.AddPlayer("Ninth")
	if err != nil || ev != ids[0] {
		t.Fatalf("%v %s", err, ev)
	}
	_ = g.Start(g.Host())
	if _, _, err := g.AddPlayer("Tenth"); err == nil {
		t.Fatal("room should be full")
	}
}

func TestModeAdapter(t *testing.T) {
	r := mode.NewRegistry()
	RegisterTo(r)
	m, _ := r.Get(ModeID)
	gm := m.New(rand.New(rand.NewPCG(3, 4)), []mode.Member{{ID: "p4", Name: "Ada", Color: "#e0a030", Connected: true, Host: true}})
	if !gm.HasPlayer("p4") || gm.Host() != "p4" {
		t.Fatal("roster not adopted")
	}
	if err := gm.Command("p4", "start", []byte(`{"t":"start"}`)); err != nil {
		t.Fatal(err)
	}
	if err := gm.Command("p4", "plan", []byte(`{"t":"plan","a":"wait"}`)); err != nil {
		t.Fatal(err)
	}
	if gm.Phase() != PhaseResolve {
		t.Fatal("plan did not resolve")
	}
	wantCode(t, gm.Command("p4", "plan", []byte(`{"t":"plan","x":"no"}`)), "bad_request")
	if err := gm.Command("p4", "bogus", nil); err != nil {
		t.Fatal("unknown types are ignored")
	}
	s := gm.Setup()
	var mp MapT
	if err := json.Unmarshal(s.Map, &mp); err != nil || len(mp.Keeps) != 2 || len(mp.Keeps[0].Lanes) != 4 {
		t.Fatalf("map %s", s.Map)
	}
	var d map[string]any
	if err := json.Unmarshal(s.Defs, &d); err != nil || d["maxPlayers"].(float64) != 8 {
		t.Fatalf("defs %s", s.Defs)
	}
	b, _ := json.Marshal(gm.RoomState())
	if !strings.Contains(string(b), `"mode":"catapult_coop"`) || !strings.Contains(string(b), `"cells":[[`) {
		t.Fatalf("room %s", b)
	}
	if _, err := json.Marshal(gm.Snapshot()); err != nil {
		t.Fatal(err)
	}
}

func TestDeterministic(t *testing.T) {
	play := func() string {
		g := New(rand.New(rand.NewPCG(9, 9)))
		var ids []string
		for i := 0; i < 3; i++ {
			id, _, _ := g.AddPlayer("X")
			g.SetConnected(id, true)
			ids = append(ids, id)
		}
		_ = g.Start(ids[0])
		for i := 0; i < 400 && g.Running(); i++ {
			g.Step(0.1)
		}
		b, _ := json.Marshal(g.View())
		return string(b)
	}
	if play() != play() {
		t.Fatal("not deterministic")
	}
}
