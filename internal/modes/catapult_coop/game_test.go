package catapultcoop

import (
	"encoding/json"
	"math/rand/v2"
	"strings"
	"testing"

	"clocktower/internal/mode"
)

// done files an empty queue and says done.
func done(g *Game, pid string) error { return g.Apply(pid, Cmd{T: "plan", Done: true}) }

func TestStartSeatsEngineers(t *testing.T) {
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
	if len(s.Bombs) != len(g.lay.Bombs) || len(s.Plans) != 3 || !s.Untimed {
		t.Fatalf("snap %+v", s)
	}
	var names []string
	for _, e := range s.Ev {
		b, _ := json.Marshal(e)
		var h struct{ E string }
		_ = json.Unmarshal(b, &h)
		names = append(names, h.E)
	}
	if !strings.HasPrefix(strings.Join(names, ","), "level_start,place,place,place,bomb") {
		t.Fatalf("events %v", names)
	}
	g6, _ := started(t, 6)
	if g6.keep.ID != "large" {
		t.Fatal("6 players should get the large keep")
	}
}

func TestStartErrors(t *testing.T) {
	g, ids := newGame(t, 2)
	wantCode(t, g.Start(ids[1]), "not_host")
	wantCode(t, done(g, ids[0]), "bad_request") // lobby
	if err := g.Start(ids[0]); err != nil {
		t.Fatal(err)
	}
	wantCode(t, g.Start(ids[0]), "bad_request")
}

func TestPlanShape(t *testing.T) {
	g, ids := started(t, 2)
	a := ids[0]
	bad := []Cmd{
		{T: "plan", Acts: []Act{{A: "dance"}}},
		{T: "plan", Acts: []Act{{A: AMove}}},                // no direction
		{T: "plan", Acts: []Act{Dir(AMove, 1, 1)}},          // diagonal
		{T: "plan", Acts: []Act{Dir(AThrow, 0, 2)}},         // not a unit
		{T: "plan", Acts: []Act{{A: APickup, DX: IntP(1)}}}, // half a direction
		{T: "plan", Acts: []Act{Dir(APickup, 2, 0)}},        //
		{T: "plan", Acts: []Act{Dir(ALoad, 1, 0)}},          // load takes none
		{T: "plan", Acts: []Act{wt, wt, wt, wt, wt}},        // too many
	}
	for _, c := range bad {
		wantCode(t, g.Apply(a, c), "bad_request")
	}
	ok := []Cmd{
		{T: "plan", Acts: []Act{mv(1, 0), th(0, -1), pk, Dir(APickup, 0, 0)}},
		{T: "plan", Acts: []Act{pkd(0, 1), ld, fr, wt}},
		{T: "plan"}, // empty, not done
	}
	for _, c := range ok {
		if err := g.Apply(a, c); err != nil {
			t.Fatalf("%+v: %v", c, err)
		}
	}
	// Impossible actions are accepted (they fizzle later).
	if err := g.Apply(a, Cmd{T: "plan", Acts: []Act{fr, ld, th(1, 0)}}); err != nil {
		t.Fatal(err)
	}
}

func TestQueueIsPublicAndDoneEndsThePhase(t *testing.T) {
	g, ids := started(t, 2)
	slow := g.SlowVersion()
	if err := g.Apply(ids[0], Cmd{T: "plan", Acts: []Act{mv(-1, 0)}}); err != nil {
		t.Fatal(err)
	}
	if g.SlowVersion() != slow {
		t.Fatal("a plan edit must not resend the room message")
	}
	s := g.View()
	if s.Plans[0].PID != ids[0] || len(s.Plans[0].Acts) != 1 || s.Plans[0].Done || s.Plans[1].Done {
		t.Fatalf("plans %+v", s.Plans)
	}
	b, _ := json.Marshal(s.Plans[0])
	if string(b) != `{"pid":"p1","acts":[{"a":"move","dx":-1,"dy":0}],"done":false}` {
		t.Fatalf("plan json %s", b)
	}
	_ = g.Apply(ids[0], Cmd{T: "plan", Acts: []Act{mv(-1, 0)}, Done: true})
	if !g.View().Plans[0].Done || g.Phase() != PhasePlan {
		t.Fatal("done not shown, or phase ended early")
	}
	// A new queue without done clears done.
	_ = g.Apply(ids[0], Cmd{T: "plan", Acts: []Act{wt}})
	if g.View().Plans[0].Done {
		t.Fatal("done not cleared")
	}
	_ = g.Apply(ids[0], Cmd{T: "plan", Acts: []Act{wt}, Done: true})
	_ = done(g, ids[1]) // empty + done is a legal "do nothing"
	if g.Phase() != PhaseResolve {
		t.Fatalf("phase %s", g.phase)
	}
	if g.View().Plans[0].Acts[0].A != AWait {
		t.Fatal("queues stay visible while the turn plays")
	}
	wantCode(t, done(g, ids[0]), "too_late")
	leave(g, 30)
	if g.Phase() != PhasePlan || g.Round() != 2 || len(g.View().Plans[0].Acts) != 0 {
		t.Fatalf("phase %s round %d", g.phase, g.round)
	}
}

func TestFirstTurnHasNoTimer(t *testing.T) {
	g, ids := started(t, 2)
	if s := g.View(); !s.Untimed || s.Left != 0 {
		t.Fatalf("first turn %+v", s)
	}
	steps(g, Defs.PlanTime*5)
	if g.Phase() != PhasePlan || g.Round() != 1 {
		t.Fatal("the first turn timed out")
	}
	// A disconnected player is not waited for, even now.
	g.SetConnected(ids[1], false)
	_ = done(g, ids[0])
	if g.Phase() != PhaseResolve {
		t.Fatal("waited for a disconnected player")
	}
	g.SetConnected(ids[1], true)
	leave(g, 30)
	if s := g.View(); s.Untimed || s.Left != Defs.PlanTime {
		t.Fatalf("second turn %+v", s)
	}
	if leave(g, Defs.PlanTime+0.1) != PhaseResolve {
		t.Fatal("second turn did not time out")
	}
}

func TestPausesWithNobodyConnected(t *testing.T) {
	g, ids := started(t, 1)
	g.rounds = 1
	g.startPlan(1)
	g.SetConnected(ids[0], false)
	steps(g, 100)
	if g.Phase() != PhasePlan || g.Round() != 1 {
		t.Fatal("ran while empty")
	}
}

func TestAwayRule(t *testing.T) {
	g, ids := started(t, 2)
	a, b := ids[0], ids[1]
	g.rounds = 1                                                                         // skip the untimed first turn
	g.machines, g.script = nil, []spawnEntry{{round: 99, lane: 0, kind: "scrap", hp: 1}} // keep the level open
	g.startPlan(1)
	// b files nothing: turns 1 and 2 wait for the timer, then b is away and
	// a alone ends turn 3.
	for r := 1; r <= 2; r++ {
		_ = done(g, a)
		if g.Phase() != PhasePlan {
			t.Fatalf("turn %d ended without b", r)
		}
		leave(g, Defs.PlanTime+0.1)
		leave(g, 30)
	}
	rs := g.RoomState()
	if !rs.Players[1].Away || rs.Players[0].Away || g.activeCount() != 1 {
		t.Fatalf("away flags %+v", rs.Players)
	}
	_ = done(g, a)
	if g.Phase() != PhaseResolve {
		t.Fatal("turn waited for an away player")
	}
	leave(g, 30)
	// Any plan stands b back up (even one not done).
	_ = g.Apply(b, Cmd{T: "plan", Acts: []Act{wt}})
	if g.RoomState().Players[1].Away {
		t.Fatal("plan did not stand b up")
	}
	// Filing something without done is not "missed".
	g.player(b).missed = 1
	leave(g, Defs.PlanTime+0.1)
	if g.player(b).missed != 0 {
		t.Fatal("a filed queue counts as taking part")
	}
}

func TestDisconnectEndsPlanPhase(t *testing.T) {
	g, ids := started(t, 2)
	_ = done(g, ids[0])
	g.SetConnected(ids[1], false)
	if g.Phase() != PhaseResolve {
		t.Fatal("phase should end once the only missing player left")
	}
}

// clearLevel kills everything and plays a turn, leaving the level done.
func clearLevel(t *testing.T, g *Game) {
	t.Helper()
	if g.Phase() == PhaseResolve {
		leave(g, 30)
	}
	g.machines, g.script = nil, nil
	for _, p := range g.players {
		if p.connected && !p.done && g.Phase() == PhasePlan {
			_ = done(g, p.id)
		}
	}
	leave(g, 30)
}

func TestLevelFlowToWin(t *testing.T) {
	old := Defs.BreakHeal
	Defs.BreakHeal = 2
	defer func() { Defs.BreakHeal = old }()
	g, ids := started(t, 2)
	g.player(ids[0]).carry = &BombRef{ID: 999, Kind: "keg"}
	g.wall = Defs.WallHP - 3
	g.events = nil
	clearLevel(t, g)
	if g.Phase() != PhaseBreak || g.Level() != 1 || g.wall != Defs.WallHP-1 {
		t.Fatalf("phase %s level %d wall %d", g.phase, g.level, g.wall)
	}
	lc := evs[EvLevelClear](g.events)
	if len(lc) != 1 || lc[0].Heal != 2 || lc[0].Wall != g.wall {
		t.Fatalf("level_clear %+v", lc)
	}
	wantCode(t, done(g, ids[0]), "too_late")
	_ = g.Apply(ids[0], Cmd{T: "ready"})
	if g.Phase() != PhaseBreak || !g.RoomState().Players[0].Ready {
		t.Fatal("break ended early")
	}
	_ = g.Apply(ids[1], Cmd{T: "ready"})
	if g.Phase() != PhasePlan || g.Level() != 2 || g.Round() != 1 {
		t.Fatalf("phase %s level %d", g.phase, g.level)
	}
	if g.View().Untimed {
		t.Fatal("only the game's first turn is untimed")
	}
	if g.lay.ID != Defs.Levels[1].Layout || g.RoomState().Layout.ID != g.lay.ID {
		t.Fatalf("layout %s", g.lay.ID)
	}
	if at(g, ids[0]) != g.lay.Spawns[0] || g.player(ids[0]).carry != nil {
		t.Fatal("level start did not reset the engineers")
	}
	if len(g.bombs) != len(g.lay.Bombs) {
		t.Fatalf("bombs %d, layout has %d", len(g.bombs), len(g.lay.Bombs))
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
	_ = done(g, ids[0])
	if g.Phase() != PhaseResolve || g.Wall() != 0 {
		t.Fatalf("phase %s wall %d", g.phase, g.wall)
	}
	leave(g, 30)
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
	g, _ := board(t, 1)
	g.level = 4
	for i := 0; i < 50; i++ {
		g.bombs = []*bomb{{id: 1, kind: "stopwatch", x: 4, y: 4}}
		if k := g.drawKind(); k == "stopwatch" {
			t.Fatal("drew a stopwatch with no damaging bomb around")
		}
	}
}

func TestRestart(t *testing.T) {
	g, ids := started(t, 2)
	g.player(ids[0]).st.kills = 3
	wantCode(t, g.Restart(ids[1]), "not_host")
	if err := g.Restart(ids[0]); err != nil {
		t.Fatal(err)
	}
	if g.Phase() != PhaseLobby || len(g.players) != 2 || g.player(ids[0]).placed || g.player(ids[0]).st.kills != 0 {
		t.Fatal("restart did not reset")
	}
	if s := g.View(); len(s.Engineers) != 0 || len(s.Machines) != 0 {
		t.Fatal("board survived the restart")
	}
	wantCode(t, g.Restart(ids[0]), "bad_request")
	if err := g.Start(ids[0]); err != nil || g.Level() != 1 || g.Wall() != Defs.WallHP || !g.View().Untimed {
		t.Fatal("could not start again")
	}
}

func TestReconnectAndLateJoin(t *testing.T) {
	g, ids := started(t, 2)
	g.SetConnected(ids[1], false)
	g.SetConnected(ids[1], true)
	if at(g, ids[1]) != g.lay.Spawns[1] {
		t.Fatal("reconnect moved the engineer")
	}
	if err := done(g, ids[1]); err != nil {
		t.Fatal(err)
	}
	ev := len(g.events)
	v := g.View()
	if len(v.Ev) != 0 || len(g.events) != ev || len(v.Engineers) != 2 || !v.Plans[1].Done {
		t.Fatal("View must not drain events, and must show the queues")
	}
	if rs := g.RoomState(); rs.Layout == nil || rs.Layout.ID != g.lay.ID || rs.Keep != "small" {
		t.Fatal("room lacks the layout")
	}
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
	if err := gm.Command("p4", "plan", []byte(`{"t":"plan","acts":[{"a":"move","dx":1,"dy":0},{"a":"pickup"}],"done":true}`)); err != nil {
		t.Fatal(err)
	}
	if gm.Phase() != PhaseResolve {
		t.Fatal("plan did not resolve")
	}
	wantCode(t, gm.Command("p4", "plan", []byte(`{"t":"plan","acts":"no"}`)), "bad_request")
	for _, gone := range []string{"opt", "perk", "bogus"} {
		if err := gm.Command("p4", gone, []byte(`{}`)); err != nil {
			t.Fatalf("%s: unknown types are ignored", gone)
		}
	}
	s := gm.Setup()
	var mp MapT
	if err := json.Unmarshal(s.Map, &mp); err != nil || len(mp.Keeps) != 2 || len(mp.Keeps[0].Lanes) != 4 {
		t.Fatalf("map %s", s.Map)
	}
	var d map[string]any
	if err := json.Unmarshal(s.Defs, &d); err != nil || d["maxPlayers"].(float64) != 8 || d["slots"].(float64) != 4 || d["perks"] != nil {
		t.Fatalf("defs %s", s.Defs)
	}
	b, _ := json.Marshal(gm.RoomState())
	rs := string(b)
	if !strings.Contains(rs, `"mode":"catapult_coop"`) || !strings.Contains(rs, `"cells":[[`) ||
		strings.Contains(rs, "acts") || strings.Contains(rs, "perk") || strings.Contains(rs, "openPlans") {
		t.Fatalf("room %s", b)
	}
	sb, _ := json.Marshal(gm.Snapshot())
	if !strings.Contains(string(sb), `"plans":[{"pid":"p4"`) {
		t.Fatalf("snap %s", sb)
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
			if g.Phase() == PhasePlan {
				for _, id := range ids {
					_ = g.Apply(id, Cmd{T: "plan", Acts: []Act{mv(-1, 0), pk, mv(0, -1), th(0, -1)}, Done: true})
				}
			}
			g.Step(0.1)
		}
		b, _ := json.Marshal(g.View())
		return string(b)
	}
	if play() != play() {
		t.Fatal("not deterministic")
	}
}
