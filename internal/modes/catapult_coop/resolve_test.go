package catapultcoop

import (
	"slices"
	"testing"
)

// The flat test keep (helpers_test.go): wall row y=0 and column x=0, rampart
// walkway row y=1 / column x=1 (h1), stairs (8,1) and (1,8), courtyard
// x,y 2..8. Catapults 0 (3,0), 1 (6,0), 2 (0,3), 3 (0,6); loading cells
// (3,1), (6,1), (1,3), (1,6).

func fizzles(ev []any) map[string]string {
	out := map[string]string{}
	for _, f := range evs[EvFizzle](ev) {
		out[f.PID] = f.Reason
	}
	return out
}

// --- 1. throws ------------------------------------------------------------------

func TestThrowStopsAtFirstEngineer(t *testing.T) {
	g, ids := board(t, 4)
	a, b, c, d := ids[0], ids[1], ids[2], ids[3]
	put(g, a, 3, 7)
	put(g, b, 3, 5) // free hands: first on the line, catches
	put(g, c, 3, 3) // never reached
	put(g, d, 6, 7)
	ba := give(g, a, "keg")
	q(g, a, th(0, -1))
	ev := evs[EvThrow](run(g))
	if len(ev) != 1 || ev[0].Result != "caught" || ev[0].By != b || ev[0].To != [2]int{3, 5} || ev[0].Dir != [2]int{0, -1} {
		t.Fatalf("throw: %+v", ev)
	}
	if g.player(b).carry != ba || g.player(a).carry != nil || g.player(c).carry != nil {
		t.Fatal("wrong catcher")
	}
	// A carrier first on the line blocks it: the bomb drops at their feet.
	g.startPlan(2)
	give(g, d, "grapeshot")
	put(g, a, 6, 5)
	give(g, a, "keg")
	q(g, d, th(0, -1))
	ev = evs[EvThrow](run(g))
	if ev[0].Result != "blocked" || ev[0].By != a || ev[0].To != [2]int{6, 5} || ev[0].At != [2]int{6, 5} || g.bombAt(6, 5) == nil {
		t.Fatalf("blocked: %+v", ev)
	}
}

func TestThrowLandsAtEndOfLine(t *testing.T) {
	g, ids := board(t, 4)
	for i, c := range [][2]int{{3, 7}, {5, 4}, {6, 6}, {5, 5}} {
		put(g, ids[i], c[0], c[1])
		give(g, ids[i], "keg")
	}
	g.lay.Cells[6][7] = Cell{Kind: KBlock} // a crate on row 6
	q(g, ids[0], th(0, -1))                // up column 3: stops before the catapult (3,0) → (3,1)
	q(g, ids[1], th(-1, 0))                // left on row 4: over the height step, stops at the wall → (1,4)
	q(g, ids[2], th(1, 0))                 // right on row 6: over the crate (7,6) → (8,6)
	q(g, ids[3], th(0, 1))                 // down column 5 to the grid edge → (5,8)
	ev := evs[EvThrow](run(g))
	want := [][2]int{{3, 1}, {1, 4}, {8, 6}, {5, 8}}
	for i, e := range ev {
		if e.Result != "landed" || e.To != want[i] || e.Slot == nil || *e.Slot != 0 {
			t.Fatalf("throw %d: %+v want %v", i, e, want[i])
		}
	}
}

func TestThrowSettlesOnNearestFreeFloor(t *testing.T) {
	g, ids := board(t, 3)
	a, b, c := ids[0], ids[1], ids[2]
	put(g, a, 5, 5)
	put(g, b, 8, 5)
	put(g, c, 2, 6)
	give(g, a, "keg")
	give(g, b, "keg")
	give(g, c, "keg")
	ground(g, 5, 8, "grapeshot")
	q(g, a, th(0, 1))  // lands at (5,8), where a bomb lies
	q(g, b, th(0, -1)) // ends on the stairs (8,1): not floor
	q(g, c, th(1, 0))  // nobody on row 6 → (8,6)
	ev := evs[EvThrow](run(g))
	if ev[0].To != [2]int{5, 8} || ev[0].At != [2]int{5, 7} {
		t.Fatalf("onto a bomb: %+v", ev[0])
	}
	if ev[1].To != [2]int{8, 1} || ev[1].At != [2]int{7, 1} { // nearest floor, smaller y first
		t.Fatalf("onto stairs: %+v", ev[1])
	}
	if ev[2].At != [2]int{8, 6} {
		t.Fatalf("%+v", ev[2])
	}
}

func TestThrowChainSameSlot(t *testing.T) {
	// A throws to B while B throws on to C: B's hands are free once B lets go.
	g, ids := board(t, 3)
	a, b, c := ids[0], ids[1], ids[2]
	put(g, a, 3, 7)
	put(g, b, 3, 4)
	put(g, c, 3, 1)
	ba, bb := give(g, a, "keg"), give(g, b, "grapeshot")
	q(g, a, th(0, -1))
	q(g, b, th(0, -1))
	run(g)
	if g.player(b).carry != ba || g.player(c).carry != bb {
		t.Fatalf("relay failed: b=%v c=%v", g.player(b).carry, g.player(c).carry)
	}
}

func TestTwoThrowsOneCatcher(t *testing.T) {
	// c between a and b catches a's bomb (player order), then blocks b's.
	g, ids := board(t, 3)
	a, b, c := ids[0], ids[1], ids[2]
	put(g, a, 2, 5)
	put(g, b, 8, 5)
	put(g, c, 5, 5)
	ba := give(g, a, "keg")
	give(g, b, "keg")
	q(g, a, th(1, 0))
	q(g, b, th(-1, 0))
	ev := evs[EvThrow](run(g))
	if ev[0].Result != "caught" || ev[1].Result != "blocked" || ev[1].By != c || g.player(c).carry != ba || ev[1].At != [2]int{5, 5} {
		t.Fatalf("%+v", ev)
	}
}

func TestThrowThenMove(t *testing.T) {
	// "I throw at you, then you walk" works within a slot: B catches, then moves.
	g, ids := board(t, 2)
	a, b := ids[0], ids[1]
	put(g, a, 3, 6)
	put(g, b, 3, 3)
	ba := give(g, a, "keg")
	q(g, a, th(0, -1))
	q(g, b, mv(1, 0))
	run(g)
	if g.player(b).carry != ba || at(g, b) != [2]int{4, 3} {
		t.Fatalf("catch-and-walk: carry=%v at=%v", g.player(b).carry, at(g, b))
	}
	// Walking into the line in the same slot is too late; one slot later works.
	g.startPlan(2)
	g.bombs = nil // the top-up may have put one where this throw lands
	put(g, a, 3, 6)
	give(g, a, "keg")
	g.player(b).carry = nil
	put(g, b, 5, 5)
	q(g, a, th(1, 0))
	q(g, b, mv(0, 1))
	ev := evs[EvThrow](run(g))
	if ev[0].Result != "landed" || ev[0].At != [2]int{8, 6} || g.player(b).carry != nil {
		t.Fatalf("same slot: %+v", ev)
	}
	g.startPlan(3)
	g.bombs = nil
	put(g, a, 3, 6)
	give(g, a, "keg")
	put(g, b, 5, 5)
	q(g, a, wt, th(1, 0))
	q(g, b, mv(0, 1))
	ev = evs[EvThrow](run(g))
	if ev[0].Result != "caught" || ev[0].By != b || *ev[0].Slot != 1 {
		t.Fatalf("next slot: %+v", ev)
	}
}

// --- 2. moves -------------------------------------------------------------------

func moveResults(ev []any) map[string]string {
	out := map[string]string{}
	for _, m := range evs[EvMove](ev) {
		out[m.PID] = m.Result
	}
	return out
}

func TestMoveSameDestinationBumps(t *testing.T) {
	g, ids := board(t, 2)
	put(g, ids[0], 3, 4)
	put(g, ids[1], 5, 4)
	q(g, ids[0], mv(1, 0))
	q(g, ids[1], mv(-1, 0))
	r := moveResults(run(g))
	if r[ids[0]] != "bump" || r[ids[1]] != "bump" || at(g, ids[0]) != [2]int{3, 4} || at(g, ids[1]) != [2]int{5, 4} {
		t.Fatalf("%v", r)
	}
}

func TestMoveSwapBumps(t *testing.T) {
	g, ids := board(t, 2)
	put(g, ids[0], 3, 4)
	put(g, ids[1], 4, 4)
	q(g, ids[0], mv(1, 0))
	q(g, ids[1], mv(-1, 0))
	r := moveResults(run(g))
	if r[ids[0]] != "bump" || r[ids[1]] != "bump" || at(g, ids[0]) != [2]int{3, 4} {
		t.Fatalf("%v", r)
	}
}

func TestMoveIntoStayingEngineerBumps(t *testing.T) {
	g, ids := board(t, 2)
	put(g, ids[0], 3, 4)
	put(g, ids[1], 4, 4)
	q(g, ids[0], mv(1, 0))
	q(g, ids[1], wt)
	r := moveResults(run(g))
	if r[ids[0]] != "bump" || at(g, ids[0]) != [2]int{3, 4} || g.player(ids[0]).st.bumps != 1 {
		t.Fatalf("%v", r)
	}
}

func TestMoveChainIntoVacatedCell(t *testing.T) {
	g, ids := board(t, 3)
	a, b, c := ids[0], ids[1], ids[2]
	put(g, a, 2, 4)
	put(g, b, 3, 4)
	put(g, c, 4, 4)
	q(g, a, mv(1, 0))
	q(g, b, mv(1, 0))
	q(g, c, mv(1, 0))
	r := moveResults(run(g))
	if r[a] != "ok" || r[b] != "ok" || r[c] != "ok" || at(g, a) != [2]int{3, 4} || at(g, c) != [2]int{5, 4} {
		t.Fatalf("%v", r)
	}
}

func TestMoveChainBehindABumpBumps(t *testing.T) {
	g, ids := board(t, 4)
	a, b, c, d := ids[0], ids[1], ids[2], ids[3]
	put(g, a, 2, 4)
	put(g, b, 3, 4)
	put(g, c, 4, 3)
	put(g, d, 4, 5)
	q(g, a, mv(1, 0))  // into b's cell
	q(g, b, mv(1, 0))  // b, c and d all want (4,4)
	q(g, c, mv(0, 1))  //
	q(g, d, mv(0, -1)) //
	r := moveResults(run(g))
	for _, p := range ids {
		if r[p] != "bump" {
			t.Fatalf("%s: %v", p, r)
		}
	}
}

func TestMoveRotationOfFourSucceeds(t *testing.T) {
	g, ids := board(t, 4)
	cells := [][2]int{{3, 3}, {4, 3}, {4, 4}, {3, 4}}
	for i, c := range cells {
		put(g, ids[i], c[0], c[1])
	}
	for i := range ids {
		n := cells[(i+1)%4]
		q(g, ids[i], mv(n[0]-cells[i][0], n[1]-cells[i][1]))
	}
	r := moveResults(run(g))
	for i, p := range ids {
		if r[p] != "ok" || at(g, p) != cells[(i+1)%4] {
			t.Fatalf("%v", r)
		}
	}
}

func TestMoveFizzlesAtWallsAndLedges(t *testing.T) {
	g, ids := board(t, 3)
	put(g, ids[0], 3, 2) // courtyard below the rampart: a ledge
	put(g, ids[1], 3, 1) // rampart below the catapult
	put(g, ids[2], 8, 2) // next to the stairs
	q(g, ids[0], mv(0, -1))
	q(g, ids[1], mv(0, -1))
	q(g, ids[2], mv(0, -1), mv(-1, 0)) // up the stairs, then along the rampart
	ev := run(g)
	f := fizzles(ev)
	if f[ids[0]] != FzBlocked || f[ids[1]] != FzBlocked || f[ids[2]] != "" {
		t.Fatalf("fizzles %v", f)
	}
	if at(g, ids[0]) != [2]int{3, 2} || at(g, ids[2]) != [2]int{7, 1} || g.player(ids[0]).st.fizzles != 1 {
		t.Fatal("positions")
	}
	fz := evs[EvFizzle](ev)[0]
	if fz.S != StMove || fz.A != AMove || *fz.Slot != 0 || fz.At != [2]int{3, 2} {
		t.Fatalf("%+v", fz)
	}
}

// --- 3. pick-ups and loads ------------------------------------------------------------

func TestPickupOwnCellOnly(t *testing.T) {
	g, ids := board(t, 2)
	a, b := ids[0], ids[1]
	put(g, a, 4, 4)
	put(g, b, 6, 4)
	own := ground(g, 4, 4, "keg")
	ground(g, 7, 4, "grapeshot") // next to b: out of reach
	q(g, a, pk)
	q(g, b, pk)
	ev := run(g)
	if g.player(a).carry == nil || g.player(a).carry.ID != own.id || g.bombAt(4, 4) != nil {
		t.Fatal("own cell")
	}
	if f := fizzles(ev); f[b] != FzNoBomb || g.player(b).carry != nil {
		t.Fatalf("neighbour cell: %v", f)
	}
	// Walk onto it, then pick it up (a bomb never blocks walking).
	g.startPlan(2)
	q(g, b, mv(1, 0), pk)
	run(g)
	if g.player(b).carry == nil || at(g, b) != [2]int{7, 4} {
		t.Fatal("walk then pick up")
	}
	// Hands already full.
	g.startPlan(3)
	ground(g, 4, 4, "keg")
	q(g, a, pk)
	if f := fizzles(run(g)); f[a] != FzHandsFull {
		t.Fatalf("%v", f)
	}
}

func TestPickupFailsAfterCatch(t *testing.T) {
	g, ids := board(t, 2)
	a, c := ids[0], ids[1]
	put(g, a, 4, 4)
	ground(g, 4, 4, "keg")
	put(g, c, 4, 7)
	give(g, c, "grapeshot")
	q(g, c, th(0, -1)) // a at (4,4) is first on the line
	q(g, a, pk)
	ev := evs[EvPickup](run(g))
	if len(ev) != 1 || ev[0].Result != "hands_full" || g.player(a).carry.Kind != "grapeshot" || g.bombAt(4, 4) == nil {
		t.Fatalf("%+v", ev)
	}
}

func TestLoadTargetsAndFizzles(t *testing.T) {
	g, ids := board(t, 4)
	a, b, c, d := ids[0], ids[1], ids[2], ids[3]
	put(g, a, 3, 1) // loading cell of catapult 0
	put(g, b, 3, 2) // below it, in the courtyard
	put(g, c, 6, 1) // loading cell of catapult 1
	put(g, d, 5, 5)
	give(g, a, "keg")
	give(g, b, "keg")
	g.cats[1] = &BombRef{ID: 90, Kind: "keg"}
	give(g, c, "keg")
	q(g, a, ld)
	q(g, b, ld) // wrong height
	q(g, c, ld) // catapult 1 is loaded
	q(g, d, ld) // empty hands
	ev := run(g)
	f := fizzles(ev)
	if f[b] != FzNoCatapult || f[c] != FzCatapultFull || f[d] != FzEmptyHands || f[a] != "" {
		t.Fatalf("%v", f)
	}
	if l := evs[EvLoad](ev); len(l) != 1 || l[0].Cat != 0 || l[0].Result != "ok" || g.cats[0] == nil || g.catBy[0] != a {
		t.Fatalf("%+v", l)
	}
	// No machine in lane 0: it stays loaded.
	if len(evs[EvFire](ev)) != 0 || g.cats[0] == nil {
		t.Fatal("fired into an empty lane")
	}
}

func TestLoadContested(t *testing.T) {
	g, ids := board(t, 2)
	g.lay.Cells[2][0] = Cell{Kind: KFloor, H: 1} // a second loading cell for catapult 2 (0,3)
	put(g, ids[0], 1, 3)
	put(g, ids[1], 0, 2)
	give(g, ids[0], "keg")
	give(g, ids[1], "keg")
	q(g, ids[0], ld)
	q(g, ids[1], ld)
	l := evs[EvLoad](run(g))
	if len(l) != 2 || l[0].Result != "contested" || l[1].Result != "contested" || g.cats[2] != nil {
		t.Fatalf("%+v", l)
	}
}

// --- 4. fires (automatic) ------------------------------------------------------------

func TestAutoFireEffects(t *testing.T) {
	g, ids := board(t, 1)
	a := ids[0]
	put(g, a, 8, 8)
	near := addMachine(g, "brute", 0, 0)
	far := addMachine(g, "scrap", 0, 2)
	g.cats[0], g.catBy[0] = &BombRef{ID: 50, Kind: "keg"}, a
	s1, s2 := addMachine(g, "scrap", 1, 2), addMachine(g, "brute", 1, 1)
	g.cats[1], g.catBy[1] = &BombRef{ID: 51, Kind: "grapeshot"}, a
	w := addMachine(g, "scrap", 2, 2)
	g.cats[2], g.catBy[2] = &BombRef{ID: 52, Kind: "stopwatch"}, "gone" // loader removed
	g.cats[3] = &BombRef{ID: 53, Kind: "keg"}                           // empty lane: stays loaded
	all := run(g)
	fires := evs[EvFire](all)
	if len(fires) != 3 || *fires[0].Slot != 0 || g.cats[3] == nil {
		t.Fatalf("%+v", fires)
	}
	if f := fires[0]; f.PID != a || f.Cat != 0 || len(f.Hits) != 1 || f.Hits[0].ID != near.id || f.Hits[0].Dmg != 2 || near.hp != 2 || far.hp != 1 {
		t.Fatalf("keg: %+v", f)
	}
	if f := fires[1]; len(f.Hits) != 2 || !f.Hits[0].Killed || s2.hp != 3 || slices.Contains(g.machines, s1) {
		t.Fatalf("grapeshot: %+v", f)
	}
	if f := fires[2]; f.PID != "" || f.Hits[0].Frozen != 2 || f.Hits[0].Dmg != 0 {
		t.Fatalf("stopwatch: %+v", f)
	}
	if st := g.player(a).st; st.kills != 1 || st.dmg != 4 {
		t.Fatalf("loader credit %+v", st)
	}
	if w.pos != 2 || w.frozen != 1 {
		t.Fatalf("frozen machine pos=%d frozen=%d", w.pos, w.frozen)
	}
}

func TestLoadFiresInTheSameSlotOrWaitsForAMachine(t *testing.T) {
	g, ids := board(t, 2)
	a, b := ids[0], ids[1]
	put(g, a, 3, 1)
	put(g, b, 1, 3)
	give(g, a, "keg")
	give(g, b, "keg")
	m := addMachine(g, "scrap", 0, 2)
	q(g, a, wt, ld) // lane 0 has a machine: fires at the end of slot 1
	q(g, b, ld)     // lane 2 is empty: stays loaded
	g.script = []spawnEntry{{round: 1, lane: 2, kind: "scrap", hp: 1}}
	ev := run(g)
	f := evs[EvFire](ev)
	if len(f) != 1 || *f[0].Slot != 1 || f[0].PID != a || slices.Contains(g.machines, m) {
		t.Fatalf("same slot: %+v", f)
	}
	if g.cats[2] == nil || len(evs[EvSpawn](ev)) != 1 {
		t.Fatal("lane 2 catapult should still be loaded, a machine arrived at the end of the turn")
	}
	// Next turn: it fires at the end of slot 0, even with nobody acting.
	g.startPlan(2)
	f = evs[EvFire](run(g))
	if len(f) != 1 || f[0].Cat != 2 || *f[0].Slot != 0 || f[0].PID != b || g.cats[2] != nil {
		t.Fatalf("next turn: %+v", f)
	}
}

// --- slots ------------------------------------------------------------------------------

func TestSlotsPlayInOrderOnTheNewState(t *testing.T) {
	// Walk onto a bomb, pick it up, walk into line, throw; machines move once.
	g, ids := board(t, 2)
	a, b := ids[0], ids[1]
	put(g, a, 4, 6)
	put(g, b, 3, 1) // catches in column 3, then loads
	ground(g, 4, 5, "keg")
	m := addMachine(g, "scrap", 3, 2)
	q(g, a, mv(0, -1), pk, mv(-1, 0), th(0, -1))
	q(g, b, wt, wt, wt, wt)
	ev := run(g)
	if at(g, a) != [2]int{3, 5} || g.player(b).carry == nil || len(fizzles(ev)) != 0 {
		t.Fatalf("at %v carry %v ev %+v", at(g, a), g.player(b).carry, ev)
	}
	if m.pos != 1 || len(evs[EvAdvance](ev)) != 1 {
		t.Fatalf("machine moved %d", m.pos)
	}
	// A fizzle does not stop the later slots.
	g.startPlan(2)
	put(g, a, 3, 2)
	q(g, a, mv(0, -1), mv(1, 0))
	ev = run(g)
	if f := fizzles(ev); f[a] != FzBlocked || at(g, a) != [2]int{4, 2} {
		t.Fatalf("%v %v", f, at(g, a))
	}
}

func TestResolveHeaderTimeline(t *testing.T) {
	g, ids := board(t, 3)
	put(g, ids[0], 3, 5)
	put(g, ids[1], 6, 6)
	put(g, ids[2], 1, 3)
	give(g, ids[0], "keg")
	give(g, ids[2], "keg")
	addMachine(g, "scrap", 2, 2)
	q(g, ids[0], th(0, -1))
	q(g, ids[1], mv(0, -1), wt, mv(0, -1))
	q(g, ids[2], wt, ld)
	ev := run(g)
	h, ok := ev[0].(EvResolve)
	if !ok {
		t.Fatalf("first event %+v", ev[0])
	}
	// Slot 0: throw, move. Slot 1: grab (load), fire. Slot 2: move. Then machines (bomb top-up).
	if len(h.Slots) != 3 || h.Slots[0].Slot != 0 || len(h.Slots[0].Stages) != 2 || len(h.Slots[1].Stages) != 2 ||
		h.Slots[1].Stages[1].S != StFire || h.Slots[2].Slot != 2 || h.Machines == nil {
		t.Fatalf("header %+v", h)
	}
	last := h.Slots[2]
	const eps = 1e-6
	if h.Slots[1].At+eps < h.Slots[0].At+h.Slots[0].Dur || h.Machines.At+eps < last.At+last.Dur || h.Dur+eps < h.Machines.At+h.Machines.Dur {
		t.Fatalf("timeline not in order %+v", h)
	}
	prev := -1
	for _, e := range ev[1:] {
		switch v := e.(type) {
		case EvMove:
			if *v.Slot < prev {
				t.Fatal("slot order")
			}
			prev = *v.Slot
		case EvFire:
			if *v.Slot != 1 {
				t.Fatal("fire slot")
			}
		}
	}
}

// --- 5. machines --------------------------------------------------------------------

func TestMachinesAdvanceHitWallAndSpawn(t *testing.T) {
	g, ids := board(t, 1)
	put(g, ids[0], 5, 5)
	s := addMachine(g, "scrap", 0, 0)
	r := addMachine(g, "roach", 1, 3)
	b := addMachine(g, "brute", 2, 4)
	b.def = &MachineDef{Name: "slow", HP: 4, Speed: 1, Every: 2, Dmg: 2} // every other turn
	g.script = []spawnEntry{{round: 1, lane: 3, kind: "scrap", hp: 1}, {round: 2, lane: 3, kind: "roach", hp: 1}}
	snap := g.View()
	if len(snap.Incoming) != 1 || snap.Incoming[0] != (Incoming{Lane: 3, Kind: "scrap"}) {
		t.Fatalf("incoming %+v", snap.Incoming)
	}
	ev := run(g)
	walls := evs[EvWall](ev)
	if len(walls) != 1 || walls[0].ID != s.id || g.wall != Defs.WallHP-1 || walls[0].Wall != g.wall {
		t.Fatalf("wall %+v", walls)
	}
	if r.pos != 1 || b.pos != 4 { // the slow one moves every other turn
		t.Fatalf("roach %d brute %d", r.pos, b.pos)
	}
	sp := evs[EvSpawn](ev)
	if len(sp) != 1 || sp[0].Lane != 3 || sp[0].Pos != laneLen-1 || sp[0].S != StMachines {
		t.Fatalf("spawn %+v", sp)
	}
	h := ev[0].(EvResolve)
	if len(h.Slots) != 0 || h.Machines == nil {
		t.Fatalf("header %+v", h)
	}
	g.startPlan(2)
	run(g)
	if b.pos != 3 {
		t.Fatalf("slow machine %d", b.pos)
	}
	if len(g.bombs) != Defs.BombsBase+Defs.BombsPerPlayer {
		t.Fatalf("bombs %d", len(g.bombs))
	}
	for _, bm := range g.bombs {
		if c := g.lay.At(bm.x, bm.y); c.Kind != KFloor || c.H != 0 {
			t.Fatalf("bomb on %+v", c)
		}
	}
}
