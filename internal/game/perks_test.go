package game

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"slices"
	"testing"
)

// clearWave finishes the current wave at once (no enemies), as a real clear.
func clearWave(g *Game) {
	enterWave(g)
	g.stepWave(dt)
}

// give hands a player n stacks of a perk directly.
func give(g *Game, pid, id string, n int) { g.player(pid).perks[id] += n }

func near(t *testing.T, what string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-6 {
		t.Fatalf("%s = %.4f, want %.4f", what, got, want)
	}
}

func lastHit(g *Game) pendingHit { return g.hits[len(g.hits)-1] }

// fitted is an upgrade cost after one Master Fitter.
func fitted(cost int) int { return int(math.Round(float64(cost) * (1 - perkAmt("master_fitter")))) }

func TestPerkDefs(t *testing.T) {
	if len(Defs.PerkOrder) != len(Defs.Perks) {
		t.Fatal("perkOrder and perks disagree")
	}
	for _, id := range Defs.PerkOrder {
		d := Defs.Perks[id]
		if d == nil || d.Name == "" || d.Desc == "" || d.Weight <= 0 {
			t.Fatalf("perk %q incomplete: %+v", id, d)
		}
	}
	if !Defs.Perks["clock_repair"].Rare {
		t.Fatal("clock repair should be rare")
	}
	b, _ := json.Marshal(Defs)
	var m struct {
		Perks     map[string]map[string]any `json:"perks"`
		PerkOrder []string                  `json:"perkOrder"`
	}
	if err := json.Unmarshal(b, &m); err != nil || len(m.PerkOrder) != len(Defs.PerkOrder) {
		t.Fatalf("defs json: %v", err)
	}
	for id, p := range m.Perks {
		if len(p) != 3 || p["name"] == nil || p["desc"] == nil || p["rare"] == nil {
			t.Fatalf("perk %s on the wire: %v (want exactly name, desc, rare)", id, p)
		}
	}
	want := fmt.Sprintf("Your Rivet Guns deal %d%% more damage. Stacks up to %d times.",
		int(math.Round(100*perkAmt("hot_rivets"))), Defs.Perks["hot_rivets"].Max)
	if d := Defs.Perks["hot_rivets"].Desc; d != want {
		t.Fatalf("desc %q", d)
	}
}

func TestPerkOverwound(t *testing.T) {
	g, ids := started(t, 1)
	_ = g.Build(ids[0], 0, "rivet")
	give(g, ids[0], "overwound", 1)
	g.towers[0].tension = 1
	steps(g, 5)
	near(t, "tension", g.towers[0].tension, 1-5*Defs.TensionDecay*(1-perkAmt("overwound")))
}

func TestPerkStrongArm(t *testing.T) {
	g, ids := started(t, 2)
	_ = g.Build(ids[0], 0, "rivet")
	give(g, ids[1], "strong_arm", 1) // the winder's perk counts, not the owner's
	_ = g.Wind(ids[1], 0, 4)
	near(t, "tension", g.towers[0].tension, 4*Defs.WindPerTap*(1+perkAmt("strong_arm")))
}

func TestPerkSights(t *testing.T) {
	g, ids := started(t, 1)
	_ = g.Build(ids[0], 0, "rivet")
	give(g, ids[0], "sights", 2)
	near(t, "range", g.towerRange(g.towers[0]), Defs.Towers["rivet"].Levels[0].Range*(1+2*perkAmt("sights")))
}

func TestPerkHotRivets(t *testing.T) {
	g, ids := started(t, 1)
	plot, d := plotNear(0, 120)
	_ = g.Build(ids[0], plot, "rivet")
	give(g, ids[0], "hot_rivets", 1)
	enterWave(g)
	g.addEnemy("baron", 0, d, 1)
	g.stepWave(dt)
	near(t, "rivet dmg", lastHit(g).dmg, Defs.Towers["rivet"].Levels[0].Dmg*(1+perkAmt("hot_rivets")))
}

func TestPerkBigShells(t *testing.T) {
	g, ids := started(t, 1)
	g.players[0].purse = 1000
	plot, d := plotNear(0, 150)
	_ = g.Build(ids[0], plot, "mortar")
	give(g, ids[0], "big_shells", 1)
	enterWave(g)
	g.addEnemy("baron", 0, d, 1)
	g.stepWave(dt)
	near(t, "splash", lastHit(g).splash, Defs.Towers["mortar"].Levels[0].Splash*(1+perkAmt("big_shells")))
}

func TestPerkCapacitor(t *testing.T) {
	g, ids := started(t, 1)
	g.players[0].purse = 1000
	plot, d := plotNear(0, 100)
	_ = g.Build(ids[0], plot, "tesla")
	give(g, ids[0], "capacitor", 1)
	enterWave(g)
	for i := 0; i < 6; i++ {
		g.addEnemy("brute", 0, d+float64(i)*30, 1)
	}
	g.stepWave(dt)
	for _, ev := range g.Snapshot().Ev {
		if c, ok := ev.(EvChain); ok {
			if want := Defs.Towers["tesla"].Levels[0].Chains + int(perkAmt("capacitor")); len(c.IDs) != want {
				t.Fatalf("chain hit %d, want %d", len(c.IDs), want)
			}
			return
		}
	}
	t.Fatal("no chain")
}

func TestPerkHeavyPendulum(t *testing.T) {
	g, ids := started(t, 1)
	g.players[0].purse = 10000
	plot, d := plotNear(0, 100)
	_ = g.Build(ids[0], plot, "chrono")
	give(g, ids[0], "heavy_pendulum", 1)
	enterWave(g)
	e := g.addEnemy("scrap", 0, d, 1)
	boss := g.addEnemy("baron", 0, d, 1)
	g.stepWave(dt)
	slow := Defs.Towers["chrono"].Levels[0].Slow + perkAmt("heavy_pendulum")
	near(t, "slow", e.slow, slow)
	near(t, "boss slow", boss.slow, slow/2)
	// Enough stacks on level 3 to pass the cap: capped, bosses still half.
	_ = g.Upgrade(ids[0], plot)
	_ = g.Upgrade(ids[0], plot)
	give(g, ids[0], "heavy_pendulum", int(slowCap/perkAmt("heavy_pendulum")))
	g.stepWave(dt)
	near(t, "capped slow", e.slow, slowCap)
	near(t, "capped boss slow", boss.slow, slowCap/2)
}

func TestPerkBulkDiscount(t *testing.T) {
	g, ids := started(t, 1)
	give(g, ids[0], "bulk_discount", 1)
	before := g.Purse(ids[0])
	_ = g.Build(ids[0], 0, "rivet")
	want := int(math.Round(50 * (1 - perkAmt("bulk_discount"))))
	if paid := before - g.Purse(ids[0]); paid != want || g.towers[0].spent != want || want >= 50 {
		t.Fatalf("paid %d spent %d, want %d", paid, g.towers[0].spent, want)
	}
}

func TestPerkMasterFitter(t *testing.T) {
	g, ids := started(t, 1)
	_ = g.Build(ids[0], 0, "rivet")
	give(g, ids[0], "master_fitter", 1)
	before := g.Purse(ids[0])
	_ = g.Upgrade(ids[0], 0)
	if paid, want := before-g.Purse(ids[0]), fitted(60); paid != want || want >= 60 {
		t.Fatalf("upgrade paid %d, want %d", paid, want)
	}
}

func TestPerkSalvage(t *testing.T) {
	g, ids := started(t, 2)
	give(g, ids[0], "salvage", 1)
	enterWave(g)
	a, b := g.players[0].purse, g.players[1].purse
	e := g.addEnemy("brute", 0, 100, 1) // bounty 14 → 7 each
	g.damage(e, 1e6, true, ids[1])
	near(t, "salvage share", g.players[0].purse-a, 7*(1+perkAmt("salvage")))
	near(t, "teammate share", g.players[1].purse-b, 7)
}

func TestPerkWindfall(t *testing.T) {
	g, ids := started(t, 1)
	g.wave = 5
	clearWave(g) // wave 5 cleared, now building wave 6
	g.player(ids[0]).offer = []string{"windfall", "sights", "overwound"}
	before := g.players[0].purse
	if err := g.Perk(ids[0], "windfall"); err != nil {
		t.Fatal(err)
	}
	near(t, "windfall", g.players[0].purse-before, windfallBase+5*windfallPerWave)
}

func TestPerkFreeSample(t *testing.T) {
	g, ids := started(t, 1)
	a := ids[0]
	for i := 0; i < 2; i++ {
		g.player(a).offer = []string{"free_sample", "sights", "overwound"}
		if err := g.Perk(a, "free_sample"); err != nil {
			t.Fatal(err)
		}
	}
	if rm := g.RoomState(); rm.Players[0].Free != 2 {
		t.Fatalf("room free %d, want 2", rm.Players[0].Free)
	}
	before := g.Purse(a)
	_ = g.Build(a, 0, "tesla")
	_ = g.Build(a, 1, "tesla")
	if g.Purse(a) != before || g.towers[0].spent != 0 || g.towers[1].spent != 0 {
		t.Fatalf("two charges should give two free towers: purse %d→%d", before, g.Purse(a))
	}
	_ = g.Build(a, 2, "rivet")
	if g.Purse(a) != before-50 {
		t.Fatal("third tower should cost money")
	}
	// Sell refund is based on cogs actually spent: a free tower refunds 0.
	_ = g.Sell(a, 0)
	if g.Purse(a) != before-50 {
		t.Fatal("free tower refunded cogs")
	}
	if g.End() == nil {
		g.finish(true)
	}
	if aw := g.End().Awards; !slices.ContainsFunc(aw, func(x Award) bool { return x.Title == "Bargain Hunter" && x.PID == a }) {
		t.Fatalf("awards %+v", aw)
	}
}

func TestPerkClockRepair(t *testing.T) {
	g, ids := started(t, 1)
	a := ids[0]
	if g.offerable(g.player(a), "clock_repair") {
		t.Fatal("clock repair offered with full lives")
	}
	g.lives = 15
	if !g.offerable(g.player(a), "clock_repair") {
		t.Fatal("clock repair should be offerable when hurt")
	}
	g.player(a).offer = []string{"clock_repair", "sights", "overwound"}
	_ = g.Perk(a, "clock_repair")
	if g.Lives() != 15+clockRepairLives {
		t.Fatalf("lives %d, want %d", g.Lives(), 15+clockRepairLives)
	}
	g.lives = 19
	g.player(a).offer = []string{"clock_repair", "sights", "overwound"}
	_ = g.Perk(a, "clock_repair")
	if g.Lives() != Defs.MaxLives {
		t.Fatalf("lives %d, want capped at %d", g.Lives(), Defs.MaxLives)
	}
}

func TestPerkStackingAndCaps(t *testing.T) {
	g, ids := started(t, 1)
	a := ids[0]
	_ = g.Build(a, 0, "rivet")
	give(g, a, "overwound", 2)
	near(t, "decay mul", decayMul(g.player(a)), math.Pow(1-perkAmt("overwound"), 2))
	give(g, a, "sights", Defs.Perks["sights"].Max)
	near(t, "range", g.towerRange(g.towers[0]), Defs.Towers["rivet"].Levels[0].Range*(1+float64(Defs.Perks["sights"].Max)*perkAmt("sights")))
	g.lives = 10
	for i := 0; i < 300; i++ {
		for _, id := range g.drawOffer(g.player(a)) {
			if id == "sights" {
				t.Fatal("maxed perk offered")
			}
		}
	}
	// Offers never hold a maxed perk and one pick is made per offer, so caps hold.
	give(g, a, "bulk_discount", 3)
	if c := costTable(g.player(a))["rivet"]; c != [3]int{int(math.Round(50 * (1 - 3*perkAmt("bulk_discount")))), 60, 110} {
		t.Fatalf("cost table %v", c)
	}
}

func TestPerkOffers(t *testing.T) {
	g, ids := started(t, 3)
	g.SetConnected(ids[2], false)
	clearWave(g)
	for i, p := range g.players[:2] {
		if len(p.offer) != 3 {
			t.Fatalf("player %d offer %v", i, p.offer)
		}
		seen := map[string]bool{}
		for _, id := range p.offer {
			if seen[id] || Defs.Perks[id] == nil {
				t.Fatalf("offer %v not distinct/known", p.offer)
			}
			seen[id] = true
		}
	}
	if g.players[2].offer != nil {
		t.Fatal("disconnected player got an offer")
	}
	rm := g.RoomState()
	if !slices.Equal(rm.Players[0].Offer, g.players[0].offer) || rm.Players[2].Offer != nil || rm.Players[2].Perks == nil {
		t.Fatalf("room offers %+v", rm.Players)
	}
	// The wave_clear event comes before any perk activity; offers are replaced
	// on the next clear, and a late joiner gets none until then.
	old := slices.Clone(g.players[0].offer)
	late, _, _ := g.AddPlayer("Late")
	g.SetConnected(late, true)
	if g.player(late).offer != nil {
		t.Fatal("late joiner should wait for the next clear")
	}
	replaced := false
	for i := 0; i < 5 && !replaced; i++ {
		clearWave(g)
		replaced = !slices.Equal(old, g.players[0].offer)
	}
	if !replaced || g.player(late).offer == nil {
		t.Fatal("offers should be replaced on each clear")
	}
	// No offer after the final wave.
	for _, p := range g.players {
		p.offer = nil
	}
	g.wave = Defs.Waves
	clearWave(g)
	if g.Phase() != PhaseWon {
		t.Fatal("should have won")
	}
	for _, p := range g.players {
		if p.offer != nil {
			t.Fatal("offer after the final wave")
		}
	}
}

func TestPerkOffersDeterministic(t *testing.T) {
	offers := func(seed uint64) [][]string {
		g := New(rand.New(rand.NewPCG(seed, 2)))
		for i := 0; i < 3; i++ {
			id, _, _ := g.AddPlayer("P" + string(rune('A'+i)))
			g.SetConnected(id, true)
		}
		_ = g.Start("p1")
		var out [][]string
		for w := 0; w < 6; w++ {
			clearWave(g)
			for _, p := range g.players {
				out = append(out, p.offer)
			}
			if off := g.players[0].offer; off != nil {
				_ = g.Perk("p1", off[0])
			}
		}
		return out
	}
	a, b := offers(1), offers(1)
	for i := range a {
		if !slices.Equal(a[i], b[i]) {
			t.Fatal("offers are not deterministic")
		}
	}
	diff := false
	for s := uint64(2); s < 6 && !diff; s++ {
		c := offers(s)
		for i := range a {
			diff = diff || !slices.Equal(a[i], c[i])
		}
	}
	if !diff {
		t.Fatal("offers do not depend on the seed")
	}
}

func TestPerkCommand(t *testing.T) {
	g, ids := newGame(t, 2)
	a, b := ids[0], ids[1]
	wantCode(t, g.Apply(a, Cmd{T: "perk", ID: "sights"}), "bad_request") // lobby
	_ = g.Start(a)
	if err := g.Perk(a, "sights"); !errors.Is(err, ErrNoOffer) {
		t.Fatalf("no offer: %v", err)
	}
	clearWave(g)
	off := g.player(a).offer
	if err := g.Perk(a, "laser_eyes"); !errors.Is(err, ErrUnknownPerk) {
		t.Fatalf("unknown: %v", err)
	}
	var notOffered string
	for _, id := range Defs.PerkOrder {
		if !slices.Contains(off, id) {
			notOffered = id
			break
		}
	}
	if err := g.Perk(a, notOffered); !errors.Is(err, ErrNotOffered) {
		t.Fatalf("not offered: %v", err)
	}
	// Taking a perk counts as a command for the active-player rule.
	g.player(a).actWave = 0
	g.Snapshot()
	v := g.SlowVersion()
	if err := g.Apply(a, Cmd{T: "perk", ID: off[1]}); err != nil {
		t.Fatal(err)
	}
	if g.player(a).actWave != g.wave || g.SlowVersion() == v {
		t.Fatal("perk should mark the player active and change the room state")
	}
	if g.player(a).offer != nil || g.player(a).perks[off[1]] != 1 {
		t.Fatal("offer not consumed")
	}
	if err := g.Perk(a, off[0]); !errors.Is(err, ErrNoOffer) {
		t.Fatalf("second pick: %v", err)
	}
	found := false
	for _, ev := range g.Snapshot().Ev {
		if e, ok := ev.(EvPerk); ok && e.PID == a && e.ID == off[1] {
			found = true
		}
	}
	if !found {
		t.Fatal("perk event missing")
	}
	// Picking is never required: b's untouched offer does not block anything.
	if g.player(b).offer == nil {
		t.Fatal("b should still have an offer")
	}
}

func TestPerkOwnership(t *testing.T) {
	g, ids := started(t, 2)
	a, b := ids[0], ids[1]
	g.players[0].purse, g.players[1].purse = 1000, 1000
	plot, d := plotNear(0, 120)
	_ = g.Build(a, plot, "rivet")
	give(g, a, "hot_rivets", 1)
	give(g, b, "master_fitter", 1)
	give(g, b, "sights", 1)
	// b pays for the upgrade with b's discount...
	before := g.Purse(b)
	_ = g.Upgrade(b, plot)
	if before-g.Purse(b) != fitted(60) {
		t.Fatalf("b paid %d, want %d", before-g.Purse(b), fitted(60))
	}
	// ...but the tower keeps its builder's perks: a's damage, not b's range.
	near(t, "range", g.towerRange(g.towers[plot]), Defs.Towers["rivet"].Levels[1].Range)
	enterWave(g)
	g.addEnemy("baron", 0, d, 1)
	g.stepWave(dt)
	near(t, "dmg", lastHit(g).dmg, Defs.Towers["rivet"].Levels[1].Dmg*(1+perkAmt("hot_rivets")))
	// Refund: 60 % of what was actually spent.
	pa := g.Purse(a)
	_ = g.Sell(a, plot)
	if g.Purse(a)-pa != int(math.Floor(float64(50+fitted(60))*Defs.SellRefund)) {
		t.Fatalf("refund %d", g.Purse(a)-pa)
	}
}

func TestPerkRangeMulInSnap(t *testing.T) {
	g, ids := started(t, 2)
	_ = g.Build(ids[0], 0, "rivet")
	_ = g.Build(ids[1], 1, "rivet")
	give(g, ids[0], "sights", 1)
	b, _ := json.Marshal(g.Snapshot())
	var s struct {
		Towers []map[string]any `json:"towers"`
	}
	_ = json.Unmarshal(b, &s)
	for _, tw := range s.Towers {
		rm, has := tw["rangeMul"]
		switch tw["plot"] {
		case 0.0:
			if rm != round(1+perkAmt("sights"), 0.01) {
				t.Fatalf("rangeMul %v", rm)
			}
		case 1.0:
			if has {
				t.Fatal("rangeMul should be omitted when 1")
			}
		}
	}
}

func TestPerkRestartAndEnd(t *testing.T) {
	g, ids := started(t, 1)
	a := ids[0]
	give(g, a, "hot_rivets", 2)
	g.lives = 1
	clearWave(g)
	if g.player(a).offer == nil {
		t.Fatal("no offer")
	}
	g.finish(false)
	if st := g.End().Stats[a]; st.Perks["hot_rivets"] != 2 {
		t.Fatalf("end stats perks %v", st.Perks)
	}
	if !slices.ContainsFunc(g.End().Awards, func(x Award) bool { return x.Title == "Specialist" && x.PID == a }) {
		t.Fatalf("awards %+v", g.End().Awards)
	}
	if err := g.Restart(a); err != nil {
		t.Fatal(err)
	}
	p := g.player(a)
	if len(p.perks) != 0 || p.offer != nil || p.free != 0 {
		t.Fatal("restart should clear perks and offers")
	}
	if rm := g.RoomState(); rm.Players[0].Perks == nil || rm.Players[0].Offer != nil {
		t.Fatal("room perks should be {} and offer null after restart")
	}
}

func TestPerkCadence(t *testing.T) {
	var want []int
	for w := 1; w <= Defs.Waves; w++ {
		if offersAfter(w) {
			want = append(want, w)
		}
	}
	if !slices.Equal(want, []int{1, 3, 5, 7, 9, 11, 13}) {
		t.Fatalf("offers after waves %v", want)
	}
	g, ids := started(t, 1)
	p := g.player(ids[0])
	clearWave(g) // wave 1: first offer right away
	first := slices.Clone(p.offer)
	if len(first) != 3 {
		t.Fatal("no offer after wave 1")
	}
	clearWave(g) // wave 2: the unpicked offer stays open
	if !slices.Equal(first, p.offer) {
		t.Fatal("offer changed after an even wave")
	}
	clearWave(g) // wave 3: replaced by a fresh draw
	if p.offer == nil {
		t.Fatal("no offer after wave 3")
	}
	_ = g.Perk(ids[0], p.offer[0])
	clearWave(g) // wave 4: nothing new
	if p.offer != nil {
		t.Fatal("offer after an even wave")
	}
}
