package towerdefense

import (
	"encoding/json"
	"errors"
	"math"
	"math/rand/v2"
	"strings"
	"testing"
)

const dt = 1.0 / 30

func newGame(t *testing.T, n int) (*Game, []string) {
	t.Helper()
	g := New(rand.New(rand.NewPCG(1, 2)))
	var ids []string
	for i := 0; i < n; i++ {
		id, _, err := g.AddPlayer("P" + string(rune('A'+i)))
		if err != nil {
			t.Fatal(err)
		}
		g.SetConnected(id, true)
		ids = append(ids, id)
	}
	return g, ids
}

func started(t *testing.T, n int) (*Game, []string) {
	g, ids := newGame(t, n)
	if err := g.Start(ids[0]); err != nil {
		t.Fatal(err)
	}
	return g, ids
}

func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Code != code {
		t.Fatalf("want error %q, got %v", code, err)
	}
}

func steps(g *Game, secs float64) {
	for i := 0; i < int(math.Round(secs/dt)); i++ {
		g.Step(dt)
	}
}

// enterWave starts the wave right away with no scheduled spawns, so a test
// can place enemies by hand.
func enterWave(g *Game) {
	g.startWave("")
	g.spawns = nil
}

// plotNear finds a plot within r of some on-screen point of path p and
// returns the plot id and the path distance of that point.
func plotNear(p int, r float64) (int, float64) {
	path := Map.Paths[p]
	for _, pl := range Map.Plots {
		for d := 0.0; d < path.Len(); d += 5 {
			x, y := path.PosAt(d)
			if x > 0 && y > 0 && x < Map.W && y < Map.H && dist(x, y, pl.X, pl.Y) < r {
				return pl.ID, d
			}
		}
	}
	panic("no plot")
}

func TestNameSanitising(t *testing.T) {
	cases := map[string]string{"  Ada  ": "Ada", "a\x00b\nc": "abc", "Grace  Hopper": "Grace Hopper"}
	for in, want := range cases {
		got, ok := SanitizeName(in)
		if !ok || got != want {
			t.Errorf("SanitizeName(%q) = %q,%v want %q", in, got, ok, want)
		}
	}
	for _, bad := range []string{"", "   ", "\x01\x02", "abcdefghijklm"} {
		if _, ok := SanitizeName(bad); ok {
			t.Errorf("SanitizeName(%q) should fail", bad)
		}
	}
	if _, ok := SanitizeName("ÅçéñtédNàmé"); !ok {
		t.Error("unicode names up to 12 runes should pass")
	}
}

func TestEconomy(t *testing.T) {
	g, ids := started(t, 4)
	a, b := ids[0], ids[1]
	if got := g.Purse(a); got != 80 {
		t.Fatalf("4-player start purse %d, want 80", got)
	}
	g1, ids1 := started(t, 1)
	if got := g1.Purse(ids1[0]); got != 320 {
		t.Fatalf("1-player start purse %d, want 320", got)
	}

	if err := g.Build(a, 0, "mortar"); err == nil {
		t.Fatal("mortar should be unaffordable")
	} else {
		wantCode(t, err, "poor")
	}
	if err := g.Build(a, 0, "rivet"); err != nil {
		t.Fatal(err)
	}
	wantCode(t, g.Build(b, 0, "rivet"), "occupied")
	wantCode(t, g.Build(a, 99, "rivet"), "bad_request")
	wantCode(t, g.Build(a, -1, "rivet"), "bad_request")
	wantCode(t, g.Build(a, 1, "laser"), "bad_request")
	if g.Purse(a) != 30 {
		t.Fatalf("purse after build %d", g.Purse(a))
	}
	// Anyone upgrades, paying themselves; only the owner sells.
	if err := g.Upgrade(b, 0); err != nil {
		t.Fatal(err)
	}
	if g.Purse(b) != 20 || g.towers[0].lvl != 2 || g.towers[0].spent != 110 {
		t.Fatalf("upgrade bookkeeping: purse %d tower %+v", g.Purse(b), g.towers[0])
	}
	wantCode(t, g.Sell(b, 0), "not_owner")
	wantCode(t, g.Upgrade(b, 0), "poor")
	g.players[1].purse = 1000
	if err := g.Upgrade(b, 0); err != nil {
		t.Fatal(err)
	}
	wantCode(t, g.Upgrade(b, 0), "max_level")
	if err := g.Sell(a, 0); err != nil {
		t.Fatal(err)
	}
	// spent 50+60+110 = 220, 60% = 132
	if g.Purse(a) != 30+132 {
		t.Fatalf("sell refund: purse %d", g.Purse(a))
	}
	wantCode(t, g.Sell(a, 0), "bad_request")

	// Gifts.
	wantCode(t, g.Gift(a, b, 0), "bad_request")
	wantCode(t, g.Gift(a, b, -5), "bad_request")
	wantCode(t, g.Gift(a, a, 5), "bad_request")
	wantCode(t, g.Gift(a, "p99", 5), "bad_request")
	wantCode(t, g.Gift(a, b, 10000), "poor")
	before := g.Purse(b)
	if err := g.Gift(a, b, 62); err != nil {
		t.Fatal(err)
	}
	if g.Purse(a) != 100 || g.Purse(b) != before+62 {
		t.Fatalf("gift: %d %d", g.Purse(a), g.Purse(b))
	}

	// Split bounty among connected players only.
	g.SetConnected(ids[3], false)
	enterWave(g)
	purses := []int{g.Purse(ids[0]), g.Purse(ids[1]), g.Purse(ids[2]), g.Purse(ids[3])}
	e := g.addEnemy("brute", 0, 100, 1) // bounty 14 → 14/3 each
	g.damage(e, 1e6, true, a)
	g.players[0].purse += 0 // keep fractions
	if got := g.players[0].purse - float64(purses[0]); math.Abs(got-14.0/3) > 0.01 {
		t.Fatalf("bounty share %.3f want %.3f", got, 14.0/3)
	}
	if g.Purse(ids[3]) != purses[3] {
		t.Fatal("disconnected player got a bounty share")
	}
	if g.players[0].st.kills != 1 {
		t.Fatal("kill not credited")
	}

	// Wave clear bonus goes to connected players and is reported per player.
	g.sweep()
	g.Snapshot()
	g.stepWave(dt)
	s := g.Snapshot()
	var clear *EvWaveClear
	for _, ev := range s.Ev {
		if c, ok := ev.(EvWaveClear); ok {
			clear = &c
		}
	}
	if clear == nil || clear.Bonus != int(math.Round(float64(Defs.WaveDefs[0].Bonus)/3)) {
		t.Fatalf("wave clear event %+v", clear)
	}
	if g.Phase() != PhaseBuild || g.Wave() != 2 {
		t.Fatalf("after clear: %s %d", g.Phase(), g.Wave())
	}
}

func TestStartRules(t *testing.T) {
	g, ids := newGame(t, 2)
	wantCode(t, g.Start(ids[1]), "not_host")
	wantCode(t, g.Restart(ids[0]), "bad_request") // nothing to end in the lobby
	wantCode(t, g.Build(ids[0], 0, "rivet"), "bad_request")
	if err := g.Start(ids[0]); err != nil {
		t.Fatal(err)
	}
	wantCode(t, g.Start(ids[0]), "bad_request")
	wantCode(t, g.Restart(ids[1]), "not_host")
	// Unknown commands are ignored.
	if err := g.Apply(ids[0], Cmd{T: "dance"}); err != nil {
		t.Fatal(err)
	}
	wantCode(t, g.Apply(ids[0], Cmd{T: "build", Kind: "rivet"}), "bad_request")
}

func TestTension(t *testing.T) {
	g, ids := started(t, 1)
	a := ids[0]
	if err := g.Build(a, 0, "rivet"); err != nil {
		t.Fatal(err)
	}
	if err := g.Wind(a, 0, 4); err != nil {
		t.Fatal(err)
	}
	if got := g.towers[0].tension; math.Abs(got-4*Defs.WindPerTap) > 1e-9 {
		t.Fatalf("tension %.3f", got)
	}
	// Tap cap: budget is MaxTapsPerSec; 4 used, so only 6 more count now.
	_ = g.Wind(a, 0, 50)
	if got := g.players[0].st.winds; got != 10 {
		t.Fatalf("winds counted %d, want 10 (cap)", got)
	}
	_ = g.Wind(a, 0, 5)
	if g.players[0].st.winds != 10 {
		t.Fatal("taps over the cap should be dropped")
	}
	wantCode(t, g.Wind(a, 0, 0), "bad_request")
	wantCode(t, g.Wind(a, 5, 1), "bad_request")
	g.towers[0].tension = 1
	steps(g, 5)
	if got := g.towers[0].tension; math.Abs(got-(1-5*Defs.TensionDecay)) > 0.01 {
		t.Fatalf("tension after 5s %.3f", got)
	}
	steps(g, 25)
	if g.towers[0].tension != 0 {
		t.Fatal("tension should bottom out at 0")
	}
	// One wind event per tower per player per snap.
	g.Snapshot()
	steps(g, 1)
	_ = g.Wind(a, 0, 1)
	_ = g.Wind(a, 0, 1)
	n := 0
	for _, ev := range g.Snapshot().Ev {
		if _, ok := ev.(EvWind); ok {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("%d wind events, want 1", n)
	}
}

func TestFireRateScalesWithTension(t *testing.T) {
	shots := func(tension float64) int {
		g, ids := started(t, 1)
		plot, d := plotNear(0, 120)
		_ = g.Build(ids[0], plot, "rivet")
		enterWave(g)
		e := g.addEnemy("baron", 0, d, 100)
		e.def = &EnemyDef{HP: 1e9, Speed: 0, Lives: 1} // a training dummy
		n := 0
		for i := 0; i < 300; i++ {
			g.towers[plot].tension = tension
			g.stepWave(dt)
			for _, ev := range g.Snapshot().Ev {
				if _, ok := ev.(EvShot); ok {
					n++
				}
			}
		}
		return n
	}
	slack, wound := shots(0), shots(1)
	ratio := float64(wound) / float64(slack)
	if math.Abs(ratio-(1+Defs.WindBonus)) > 0.1 {
		t.Fatalf("shots %d vs %d, ratio %.2f want %.2f", slack, wound, ratio, 1+Defs.WindBonus)
	}
}

func TestArmour(t *testing.T) {
	g, ids := started(t, 1)
	enterWave(g)
	b := g.addEnemy("brute", 0, 100, 1)
	g.damage(b, 14, false, ids[0])
	if want := b.max - (14 - Defs.Enemies["brute"].Armor); math.Abs(b.hp-want) > 1e-9 {
		t.Fatalf("armour: hp %.1f want %.1f", b.hp, want)
	}
	hp := b.hp
	g.damage(b, 2, false, ids[0]) // below armour: minimum fraction applies
	if math.Abs(hp-b.hp-2*Defs.MinDmgFrac) > 1e-9 {
		t.Fatalf("min damage: lost %.2f", hp-b.hp)
	}
	hp = b.hp
	g.damage(b, 14, true, ids[0]) // tesla ignores armour
	if math.Abs(hp-b.hp-14) > 1e-9 {
		t.Fatalf("pierce: lost %.2f", hp-b.hp)
	}
}

func TestFlyingVsMortar(t *testing.T) {
	g, ids := started(t, 1)
	plot, d := plotNear(0, 150)
	_ = g.Build(ids[0], plot, "mortar")
	enterWave(g)
	drone := g.addEnemy("drone", 0, d, 1)
	tw := g.towers[plot]
	if g.pickTarget(tw) != nil {
		t.Fatal("mortar targeted a flyer")
	}
	scrap := g.addEnemy("scrap", 0, d, 1)
	if g.pickTarget(tw) != scrap {
		t.Fatal("mortar should target the walker")
	}
	// Splash lands on both positions; only the walker is hurt.
	x, y := g.enemyPos(scrap)
	g.land(pendingHit{x: x, y: y, dmg: 10, splash: 80, owner: ids[0]})
	if drone.hp != drone.max || scrap.hp == scrap.max {
		t.Fatalf("splash: drone %.0f/%.0f scrap %.0f/%.0f", drone.hp, drone.max, scrap.hp, scrap.max)
	}
	// Rivets and teslas do hit flyers.
	g.towers[plot] = nil
	_ = g.Build(ids[0], plot, "rivet")
	scrap.dead = true
	g.sweep()
	if g.pickTarget(g.towers[plot]) != drone {
		t.Fatal("rivet should target the drone")
	}
}

func TestDelayedShot(t *testing.T) {
	g, ids := started(t, 1)
	plot, d := plotNear(0, 120)
	_ = g.Build(ids[0], plot, "rivet")
	enterWave(g)
	e := g.addEnemy("baron", 0, d, 1)
	g.stepWave(dt)
	var shot *EvShot
	for _, ev := range g.Snapshot().Ev {
		if s, ok := ev.(EvShot); ok {
			shot = &s
		}
	}
	if shot == nil || shot.Travel <= 0 || shot.To != e.id || shot.Kind != "rivet" {
		t.Fatalf("shot %+v", shot)
	}
	if e.hp != e.max {
		t.Fatal("damage should land after travel time")
	}
	steps(g, shot.Travel+2*dt)
	if e.hp >= e.max {
		t.Fatal("damage never landed")
	}
}

func TestTeslaChain(t *testing.T) {
	g, ids := started(t, 1)
	g.players[0].purse = 1000
	plot, d := plotNear(0, 100)
	_ = g.Build(ids[0], plot, "tesla")
	enterWave(g)
	for i := 0; i < 5; i++ {
		g.addEnemy("brute", 0, d+float64(i)*30, 1)
	}
	g.stepWave(dt)
	var ch *EvChain
	for _, ev := range g.Snapshot().Ev {
		if c, ok := ev.(EvChain); ok {
			ch = &c
		}
	}
	if ch == nil || len(ch.IDs) != 3 || len(ch.Pts) != 4 {
		t.Fatalf("chain %+v", ch)
	}
	hurt := 0
	for _, e := range g.enemies {
		if e.hp < e.max {
			hurt++
			if math.Abs(e.max-e.hp-Defs.Towers["tesla"].Levels[0].Dmg) > 1e-9 {
				t.Fatal("tesla should ignore armour")
			}
		}
	}
	if hurt != 3 {
		t.Fatalf("%d enemies hurt, want 3", hurt)
	}
}

func TestSlows(t *testing.T) {
	g, ids := started(t, 1)
	g.players[0].purse = 10000
	plot, d := plotNear(0, 100)
	_ = g.Build(ids[0], plot, "chrono")
	enterWave(g)
	e := g.addEnemy("scrap", 0, d, 1)
	boss := g.addEnemy("baron", 0, d, 1)
	g.stepWave(dt)
	if math.Abs(e.slow-0.3) > 1e-9 || math.Abs(boss.slow-0.15) > 1e-9 {
		t.Fatalf("slow %.2f boss %.2f", e.slow, boss.slow)
	}
	// A second, stronger chrono: strongest wins, no stacking.
	for _, pl := range Map.Plots {
		if pl.ID != plot && dist(pl.X, pl.Y, Map.Plots[plot].X, Map.Plots[plot].Y) < 260 {
			_ = g.Build(ids[0], pl.ID, "chrono")
			_ = g.Upgrade(ids[0], pl.ID)
			_ = g.Upgrade(ids[0], pl.ID)
			g.towers[pl.ID].tension = 1
			x, y := g.enemyPos(e)
			if dist(x, y, pl.X, pl.Y) <= 180*1.3 {
				g.stepWave(dt)
				if math.Abs(e.slow-0.5) > 1e-9 {
					t.Fatalf("stacked/strongest slow %.2f want 0.5", e.slow)
				}
				return
			}
		}
	}
	t.Log("no second chrono plot in reach; stacking part skipped")
}

func TestTinkerRepair(t *testing.T) {
	g, _ := started(t, 1)
	enterWave(g)
	tk := g.addEnemy("tinker", 0, 500, 1)
	b := g.addEnemy("brute", 0, 520, 1)
	far := g.addEnemy("brute", 0, 1200, 1)
	tk.def = &EnemyDef{HP: 90, Repair: 8, RepairRange: 110, Lives: 1} // speed 0
	b.def = &EnemyDef{HP: 240, Lives: 2}
	far.def = b.def
	b.hp, far.hp = 100, 100
	g.waveHPMul = 1
	steps(g, 1)
	if math.Abs(b.hp-108) > 0.5 || far.hp != 100 {
		t.Fatalf("repair: near %.1f far %.1f", b.hp, far.hp)
	}
	s := g.Snapshot()
	for _, en := range s.Enemies {
		if int(en[EID]) == b.id && int(en[EFlags])&FlagRepaired == 0 {
			t.Fatal("repaired flag missing")
		}
	}
}

func TestWaveProgressionWinLose(t *testing.T) {
	g, ids := started(t, 2)
	if g.Phase() != PhaseBuild || g.Wave() != 1 {
		t.Fatal("start → build 1")
	}
	rm := g.RoomState()
	if len(rm.NextWave) == 0 || rm.NextWave[0].Kind != "scrap" {
		t.Fatalf("preview %+v", rm.NextWave)
	}
	steps(g, Defs.BuildTime-1)
	if g.Phase() != PhaseBuild {
		t.Fatal("build ended early")
	}
	steps(g, 1.1)
	if g.Phase() != PhaseWave {
		t.Fatal("wave did not start")
	}
	if len(g.RoomState().NextWave) != 0 {
		t.Fatal("no preview during waves")
	}
	// Undefended: every enemy of wave 1 leaks and costs lives.
	leak := 0
	for _, gr := range Defs.WaveDefs[0].Groups {
		leak += gr.N * Defs.Enemies[gr.Kind].Lives
	}
	steps(g, 60)
	if g.Lives() != Defs.MaxLives-leak || g.Phase() != PhaseBuild || g.Wave() != 2 {
		t.Fatalf("after wave 1: lives %d phase %s wave %d", g.Lives(), g.Phase(), g.Wave())
	}
	// Ready skip: all active connected ready → wave starts now. (ids[1]
	// sat out cycle 1, so show up first or they would not block at all.)
	_ = g.Apply(ids[1], Cmd{T: "ready", Ready: BoolP(false)})
	_ = g.Ready(ids[0], true)
	if g.Phase() != PhaseBuild {
		t.Fatal("one ready should not start")
	}
	g.SetConnected(ids[1], false) // the only unready player leaves
	if g.Phase() != PhaseWave {
		t.Fatal("all connected ready should start the wave")
	}
	g.SetConnected(ids[1], true)
	steps(g, 300)
	if g.Phase() != PhaseLost || g.Lives() != 0 || g.End() == nil || g.End().Won {
		t.Fatalf("should have lost: %s lives %d", g.Phase(), g.Lives())
	}
	if g.RoomState().End == nil {
		t.Fatal("room end missing")
	}
	// Restart → lobby with the same players.
	wantCode(t, g.Restart(ids[1]), "not_host")
	if err := g.Restart(g.Host()); err != nil {
		t.Fatal(err)
	}
	if g.Phase() != PhaseLobby || g.NumPlayers() != 2 || g.Lives() != Defs.MaxLives || g.RoomState().End != nil {
		t.Fatal("restart state")
	}
}

func TestWin(t *testing.T) {
	g, _ := started(t, 1)
	g.wave = Defs.Waves
	enterWave(g)
	g.stepWave(dt)
	if g.Phase() != PhaseWon || !g.End().Won || g.End().Wave != 15 {
		t.Fatalf("win: %s %+v", g.Phase(), g.End())
	}
}

func TestPauseWithoutPlayers(t *testing.T) {
	g, ids := started(t, 1)
	steps(g, 1)
	tm := g.Time()
	g.SetConnected(ids[0], false)
	steps(g, 5)
	if g.Time() != tm {
		t.Fatal("sim advanced with nobody connected")
	}
}

func TestHostMigration(t *testing.T) {
	g, ids := newGame(t, 3)
	if g.Host() != ids[0] {
		t.Fatal("first player is host")
	}
	g.SetConnected(ids[1], false)
	g.SetConnected(ids[1], true) // p2 reconnects: now newest connection
	g.SetConnected(ids[0], false)
	if g.Host() != ids[2] {
		t.Fatalf("host %s, want longest-connected %s", g.Host(), ids[2])
	}
	g.SetConnected(ids[2], false)
	if g.Host() != ids[1] {
		t.Fatal("host passes to the remaining player")
	}
	g.SetConnected(ids[1], false)
	if g.Host() != ids[1] {
		t.Fatal("host should stay put when nobody else is connected")
	}
	g.SetConnected(ids[0], true)
	if g.Host() != ids[0] {
		t.Fatal("first to reconnect to a hostless room becomes host")
	}
}

func TestRoomFullAndLobbyEviction(t *testing.T) {
	g, _ := newGame(t, 8)
	if _, _, err := g.AddPlayer("Nine"); err == nil {
		t.Fatal("9th player should be refused")
	} else {
		wantCode(t, err, "room_full")
	}
	g.SetConnected("p3", false)
	id, ev, err := g.AddPlayer("Nine")
	if err != nil || ev != "p3" || id != "p9" {
		t.Fatalf("lobby eviction: %s %s %v", id, ev, err)
	}
	_, _, err = g.AddPlayer("")
	wantCode(t, err, "bad_name")
}

func TestCatchUpPurse(t *testing.T) {
	g, ids := started(t, 2)
	g.players[0].purse = 400
	g.players[1].purse = 200
	id, _, _ := g.AddPlayer("Late")
	if got := g.Purse(id); got != 150 {
		t.Fatalf("catch-up purse %d want 150", got)
	}
	_ = ids
}

func TestHPScaling(t *testing.T) {
	g, _ := started(t, 4)
	g.startWave("")
	want := Defs.WaveDefs[0].HPMul * (1 + 3*Defs.HPPerPlayer)
	if math.Abs(g.spawns[0].hpMul-want) > 1e-9 {
		t.Fatalf("hp mul %.3f want %.3f", g.spawns[0].hpMul, want)
	}
	// The table: one entry per seat, the old linear rule up to 4, then
	// rising and above that rule for bigger groups.
	tab := Defs.HPPlayerMul
	if len(tab) != Defs.MaxPlayers {
		t.Fatalf("hpPlayerMul has %d entries, want %d", len(tab), Defs.MaxPlayers)
	}
	for n := 1; n <= Defs.MaxPlayers; n++ {
		if n <= 4 && math.Abs(tab[n-1]-(1+Defs.HPPerPlayer*float64(n-1))) > 1e-9 {
			t.Errorf("hpPlayerMul[%d] = %.3f, want the linear %.3f", n-1, tab[n-1], 1+Defs.HPPerPlayer*float64(n-1))
		}
		if n > 4 && (tab[n-1] <= tab[n-2] || tab[n-1] < 1+Defs.HPPerPlayer*float64(n-1)) {
			t.Errorf("hpPlayerMul[%d] = %.3f: must rise and stay above the linear rule", n-1, tab[n-1])
		}
	}
	if hpMulFor(0) != 1 || hpMulFor(99) != tab[len(tab)-1] {
		t.Fatal("hpMulFor does not clamp")
	}
	g8, _ := started(t, 8)
	g8.startWave("")
	if want := Defs.WaveDefs[0].HPMul * tab[7]; math.Abs(g8.spawns[0].hpMul-want) > 1e-9 {
		t.Fatalf("8 players: hp mul %.3f want %.3f", g8.spawns[0].hpMul, want)
	}
}

func TestDeterminismAndSnapJSON(t *testing.T) {
	run := func() string {
		g, ids := started(t, 2)
		_ = g.Build(ids[0], 3, "rivet")
		_ = g.Build(ids[1], 7, "mortar")
		out := ""
		for i := 0; i < 30*120; i++ {
			g.Step(dt)
			if i%3 == 0 {
				_ = g.Wind(ids[0], 3, 1)
				b, err := json.Marshal(g.Snapshot())
				if err != nil {
					t.Fatal(err)
				}
				out = string(b)
			}
			if off := g.player(ids[1]).offer; off != nil {
				_ = g.Perk(ids[1], off[0]) // offers come from the game RNG too
			}
		}
		if g.Wave() < 2 || len(g.player(ids[1]).perks) == 0 {
			t.Fatalf("determinism run should clear wave 1 and take a perk (wave %d)", g.Wave())
		}
		rs, _ := json.Marshal(g.RoomState())
		return out + "\n" + string(rs)
	}
	a, b := run(), run()
	if a != b {
		t.Fatal("simulation is not deterministic")
	}
	a = a[:strings.IndexByte(a, '\n')]
	var m map[string]any
	if err := json.Unmarshal([]byte(a), &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"t", "time", "phase", "wave", "left", "lives", "purses", "towers", "enemies", "ev"} {
		if _, ok := m[k]; !ok {
			t.Errorf("snap missing %q", k)
		}
	}
}

func TestIdleShareRedistributed(t *testing.T) {
	g, ids := started(t, 3)
	a, b, c := ids[0], ids[1], ids[2]
	pay := func() [3]float64 {
		var before [3]float64
		for i, p := range g.players {
			before[i] = p.purse
		}
		g.payAll(30)
		var got [3]float64
		for i, p := range g.players {
			got[i] = math.Round((p.purse-before[i])*100) / 100
		}
		return got
	}
	// Wave 1: everyone shares, even before doing anything.
	if got := pay(); got != [3]float64{10, 10, 10} {
		t.Fatalf("wave 1 split %v", got)
	}
	// a taps Ready, b builds; c does nothing all cycle.
	if err := g.Apply(a, Cmd{T: "ready", Ready: BoolP(true)}); err != nil {
		t.Fatal(err)
	}
	if err := g.Apply(b, Cmd{T: "build", Plot: IntP(0), Kind: "rivet"}); err != nil {
		t.Fatal(err)
	}
	g.wave = 2
	if got := pay(); got != [3]float64{15, 15, 0} {
		t.Fatalf("idle player should be left out of the split: %v", got)
	}
	// Enemy HP still scales with everyone connected, so idling never helps.
	enterWave(g)
	if want := Defs.WaveDefs[1].HPMul * (1 + 2*Defs.HPPerPlayer); math.Abs(g.waveHPMul-want) > 1e-9 {
		t.Fatalf("hp mul %.3f want %.3f", g.waveHPMul, want)
	}
	// Any command brings c straight back (a wind outside its cycle too).
	if err := g.Apply(c, Cmd{T: "wind", Plot: IntP(0), N: IntP(1)}); err != nil {
		t.Fatal(err)
	}
	if got := pay(); got != [3]float64{10, 10, 10} {
		t.Fatalf("returning player should share again: %v", got)
	}
	// One command keeps a player in for the rest of this cycle and the next,
	// so nobody flaps between waves: in cycle 3 a and b (last seen in cycle
	// 1) drop out, c (cycle 2) stays.
	g.wave = 3
	if got := pay(); got != [3]float64{0, 0, 30} {
		t.Fatalf("cycle 3 split %v", got)
	}
	// If nobody is active, every connected player shares (and a disconnected
	// one never does).
	g.wave = 5
	g.SetConnected(b, false)
	if got := pay(); got != [3]float64{15, 0, 15} {
		t.Fatalf("nobody active: %v", got)
	}
	// Reconnecting counts as showing up.
	g.SetConnected(b, true)
	if got := pay(); got != [3]float64{0, 30, 0} {
		t.Fatalf("after reconnect: %v", got)
	}
}

func TestReadyIgnoresIdlePlayers(t *testing.T) {
	g, ids := started(t, 3)
	a, b, c := ids[0], ids[1], ids[2]
	ready := func(id string) {
		t.Helper()
		if err := g.Apply(id, Cmd{T: "ready", Ready: BoolP(true)}); err != nil {
			t.Fatal(err)
		}
	}
	// Wave 1: everyone is active, so all must be ready.
	ready(a)
	ready(b)
	if g.phase != PhaseBuild {
		t.Fatal("wave 1 must wait for everyone")
	}
	ready(c)
	if g.phase != PhaseWave {
		t.Fatal("wave 1 should start when all are ready")
	}
	// Move to wave 3's build phase with only a and b having acted in cycle 2.
	g.phase, g.wave = PhaseBuild, 3
	for _, p := range g.players {
		p.ready = false
	}
	g.player(a).actWave, g.player(b).actWave, g.player(c).actWave = 3, 3, 1
	g.checkAllReady()
	if g.phase != PhaseBuild {
		t.Fatal("nobody ready must not start the wave")
	}
	ready(a)
	if g.phase != PhaseBuild {
		t.Fatal("active b has not readied")
	}
	ready(b)
	if g.phase != PhaseWave {
		t.Fatal("idle c must not block the wave")
	}
	// An idle player who taps Ready is active again and counted.
	g.phase, g.wave = PhaseBuild, 4
	for _, p := range g.players {
		p.ready = false
	}
	g.player(a).actWave, g.player(b).actWave, g.player(c).actWave = 4, 1, 1
	ready(a)
	if g.phase != PhaseWave {
		t.Fatal("only a is active; a ready should start")
	}
	g.phase, g.wave = PhaseBuild, 5
	for _, p := range g.players {
		p.ready = false
	}
	g.player(a).actWave, g.player(b).actWave, g.player(c).actWave = 5, 1, 1
	ready(b) // b was idle; tapping ready makes b active, so a must ready too
	if g.phase != PhaseBuild {
		t.Fatal("b's ready should count and a (active) still blocks")
	}
	ready(a)
	if g.phase != PhaseWave {
		t.Fatal("a and b ready, idle c ignored")
	}
}

// The host can end a running game: everyone returns to the lobby and the
// same players can start again.
func TestHostEndsRunningGame(t *testing.T) {
	g, ids := newGame(t, 2)
	if err := g.Start(ids[0]); err != nil {
		t.Fatal(err)
	}
	if err := g.Build(ids[0], 0, "rivet"); err != nil {
		t.Fatal(err)
	}
	if err := g.Restart(ids[0]); err != nil {
		t.Fatal(err)
	}
	if g.Phase() != PhaseLobby {
		t.Fatalf("phase after ending: %s", g.Phase())
	}
	if err := g.Start(ids[0]); err != nil {
		t.Fatalf("start after ending: %v", err)
	}
}

func TestHostStartsWaveNow(t *testing.T) {
	g, ids := newGame(t, 3)
	// Lobby: not the build phase.
	wantCode(t, g.Apply(ids[0], Cmd{T: "go"}), "bad_request")
	if err := g.Start(ids[0]); err != nil {
		t.Fatal(err)
	}
	steps(g, 2)
	_ = g.Ready(ids[1], true) // p3 never readies: the phase would run its timer
	if g.Phase() != PhaseBuild {
		t.Fatalf("phase %s want build", g.Phase())
	}
	wantCode(t, g.Apply(ids[1], Cmd{T: "go"}), "not_host")
	if g.Phase() != PhaseBuild {
		t.Fatal("a non-host started the wave")
	}
	g.Snapshot() // drain
	if err := g.Apply(ids[0], Cmd{T: "go"}); err != nil {
		t.Fatal(err)
	}
	if g.Phase() != PhaseWave || g.Wave() != 1 || len(g.spawns) == 0 {
		t.Fatalf("phase %s wave %d spawns %d", g.Phase(), g.Wave(), len(g.spawns))
	}
	for _, id := range ids {
		if g.player(id).ready {
			t.Fatalf("%s still ready after the wave started", id)
		}
	}
	var got *EvWaveStart
	for _, ev := range g.Snapshot().Ev {
		if e, ok := ev.(EvWaveStart); ok {
			got = &e
		}
	}
	if got == nil || got.Wave != 1 || got.By != ids[0] {
		t.Fatalf("wave_start event %+v, want wave 1 by %s", got, ids[0])
	}
	// During the wave: refused, nothing changes.
	wantCode(t, g.Apply(ids[0], Cmd{T: "go"}), "bad_request")
	if g.Phase() != PhaseWave || g.Wave() != 1 {
		t.Fatal("go during a wave changed the game")
	}
	// The timer and the ready check still leave `by` out.
	g2, ids2 := started(t, 1)
	g2.Snapshot()
	_ = g2.Ready(ids2[0], true)
	for _, ev := range g2.Snapshot().Ev {
		if e, ok := ev.(EvWaveStart); ok && e.By != "" {
			t.Fatalf("ready-check wave_start has by %q", e.By)
		}
	}
}

func TestPlotTiers(t *testing.T) {
	tier5, tier7 := -1, -1
	for _, pl := range Map.Plots {
		if pl.Min == 5 && tier5 < 0 {
			tier5 = pl.ID
		}
		if pl.Min == 7 && tier7 < 0 {
			tier7 = pl.ID
		}
	}
	if tier5 < 0 || tier7 < 0 {
		t.Fatal("map has no tier plots")
	}
	g, ids := newGame(t, 4)
	if g.RoomState().PlotsFor != 4 {
		t.Fatalf("lobby preview %d want 4", g.RoomState().PlotsFor)
	}
	_ = g.Start(ids[0])
	g.player(ids[0]).purse = 1000
	wantCode(t, g.Build(ids[0], tier5, "rivet"), "bad_request")
	if g.towers[tier5] != nil {
		t.Fatal("built on a closed plot")
	}
	// A fifth player joins mid-game: the tier rises and stays risen.
	id, _, _ := g.AddPlayer("Eve")
	g.SetConnected(id, true)
	if g.RoomState().PlotsFor != 5 {
		t.Fatalf("after a join: plotsFor %d want 5", g.RoomState().PlotsFor)
	}
	if err := g.Build(ids[0], tier5, "rivet"); err != nil {
		t.Fatal(err)
	}
	wantCode(t, g.Build(ids[0], tier7, "rivet"), "bad_request")
	g.RemovePlayer(id)
	g.SetConnected(ids[3], false)
	if g.RoomState().PlotsFor != 5 || g.towers[tier5] == nil {
		t.Fatal("leaving players closed a plot")
	}
	_ = g.Restart(ids[0])
	if g.RoomState().PlotsFor != 4 {
		t.Fatalf("back in the lobby: plotsFor %d want 4", g.RoomState().PlotsFor)
	}

	g8, ids8 := started(t, 8)
	g8.player(ids8[0]).purse = 1000
	if g8.RoomState().PlotsFor != 8 {
		t.Fatal("8 players: plotsFor")
	}
	for _, p := range []int{tier5, tier7} {
		if err := g8.Build(ids8[0], p, "rivet"); err != nil {
			t.Fatalf("8 players, plot %d: %v", p, err)
		}
	}
}
