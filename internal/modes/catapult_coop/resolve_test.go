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

func TestPickupTargets(t *testing.T) {
	g, ids := board(t, 2)
	a, b := ids[0], ids[1]
	put(g, a, 4, 4)
	own := ground(g, 4, 4, "keg")
	ground(g, 4, 3, "keg")
	right := ground(g, 5, 4, "grapeshot")
	q(g, a, pk) // own cell first
	run(g)
	if g.player(a).carry.ID != own.id {
		t.Fatal("own cell first")
	}
	// Without a direction and nothing underfoot: nearest, up before right.
	g.startPlan(2)
	g.player(a).carry = nil
	q(g, a, pk)
	run(g)
	if g.player(a).carry.ID == right.id || g.bombAt(4, 3) != nil {
		t.Fatal("up first")
	}
	// With a direction.
	g.startPlan(3)
	g.player(a).carry = nil
	q(g, a, pkd(1, 0))
	run(g)
	if g.player(a).carry.ID != right.id {
		t.Fatal("direction")
	}
	// From the rampart down into the courtyard (any height).
	g.startPlan(4)
	put(g, b, 5, 1)
	ground(g, 5, 2, "keg")
	q(g, b, pkd(0, 1))
	run(g)
	if g.player(b).carry == nil {
		t.Fatal("from above")
	}
	// Nothing there; hands already full.
	g.startPlan(5)
	q(g, a, pkd(0, 1))
	g.player(a).carry = nil
	q(g, b, pk)
	f := fizzles(run(g))
	if f[a] != FzNoBomb || f[b] != FzHandsFull {
		t.Fatalf("%v", f)
	}
}

func TestPickupContestedAndHandsFull(t *testing.T) {
	g, ids := board(t, 3)
	a, b, c := ids[0], ids[1], ids[2]
	put(g, a, 4, 4)
	put(g, b, 6, 4)
	bomb := ground(g, 5, 4, "keg")
	q(g, a, pkd(1, 0))
	q(g, b, pkd(-1, 0))
	ev := evs[EvPickup](run(g))
	if ev[0].Result != "contested" || ev[1].Result != "contested" || g.bombAt(5, 4) != bomb {
		t.Fatalf("%+v", ev)
	}
	// A pick-up by someone who catches a throw in the same slot fails.
	g.startPlan(2)
	put(g, c, 4, 7)
	give(g, c, "grapeshot")
	q(g, c, th(0, -1)) // a at (4,4) is first on the line
	q(g, a, pkd(1, 0))
	ev = evs[EvPickup](run(g))
	if ev[0].Result != "hands_full" || g.player(a).carry.Kind != "grapeshot" {
		t.Fatalf("%+v", ev)
	}
}

func TestLoadAndFireTargetsAndFizzles(t *testing.T) {
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
	if l := evs[EvLoad](ev); len(l) != 1 || l[0].Cat != 0 || l[0].Result != "ok" || g.cats[0] == nil {
		t.Fatalf("%+v", l)
	}
	// Fire: catapult 0 is loaded now; catapult 1 too; d has none next to it.
	g.startPlan(2)
	g.cats[1] = nil
	q(g, a, fr)
	q(g, c, fr) // catapult 1 is empty now
	q(g, d, fr)
	f = fizzles(run(g))
	if f[c] != FzCatapultEmpty || f[d] != FzNoCatapult || f[a] != "" || g.cats[0] != nil {
		t.Fatalf("%v", f)
	}
}

func TestLoadContested(t *testing.T) {
	// Catapult 2 (0,3) has one loading cell (1,3); use a 2-wide rampart.
	g, ids := board(t, 2)
	g.lay.Cells[3][2] = Cell{Kind: KFloor, H: 1} // not a loading cell: not adjacent
	put(g, ids[0], 1, 3)
	give(g, ids[0], "keg")
	put(g, ids[1], 2, 3)
	give(g, ids[1], "keg")
	g.player(ids[0]).acts = []Act{ld}
	ev := run(g)
	if l := evs[EvLoad](ev); len(l) != 1 || l[0].Result != "ok" {
		t.Fatalf("%+v", l)
	}
	// Two loaders on one catapult (forced): both fail.
	g.startPlan(2)
	g.cats[2] = nil
	give(g, ids[0], "keg")
	g.curSlot = 0
	g.player(ids[0]).cur = &step{a: ALoad, cat: 2}
	g.player(ids[1]).cur = &step{a: ALoad, cat: 2}
	g.events = nil
	g.resolveGrabs()
	l := evs[EvLoad](g.events)
	if len(l) != 2 || l[0].Result != "contested" || l[1].Result != "contested" || g.cats[2] != nil {
		t.Fatalf("%+v", l)
	}
}

// --- 4. fires ----------------------------------------------------------------------

func TestFireEffects(t *testing.T) {
	g, ids := board(t, 4)
	for i, c := range []int{0, 1, 2, 3} {
		cat := g.keep.Catapults[c]
		for _, dv := range Dirs4 {
			if g.lay.LoadCell(cat.X+dv[0], cat.Y+dv[1], cat) {
				put(g, ids[i], cat.X+dv[0], cat.Y+dv[1])
			}
		}
		q(g, ids[i], fr)
	}
	near := addMachine(g, "brute", 0, 2)
	far := addMachine(g, "scrap", 0, 4)
	g.cats[0] = &BombRef{ID: 50, Kind: "keg"}
	s1, s2 := addMachine(g, "scrap", 1, 5), addMachine(g, "brute", 1, 3)
	g.cats[1] = &BombRef{ID: 51, Kind: "grapeshot"}
	w := addMachine(g, "scrap", 2, 5)
	g.cats[2] = &BombRef{ID: 52, Kind: "stopwatch"}
	g.cats[3] = &BombRef{ID: 53, Kind: "keg"}

	all := run(g)
	fires := evs[EvFire](all)
	if len(fires) != 4 {
		t.Fatalf("%+v", fires)
	}
	if f := fires[0]; f.Result != "ok" || len(f.Hits) != 1 || f.Hits[0].ID != near.id || f.Hits[0].Dmg != 2 || near.hp != 2 || far.hp != 1 {
		t.Fatalf("keg: %+v", f)
	}
	if f := fires[1]; len(f.Hits) != 2 || !f.Hits[0].Killed || s2.hp != 3 || slices.Contains(g.machines, s1) {
		t.Fatalf("grapeshot: %+v", f)
	}
	if f := fires[2]; f.Hits[0].Frozen != 2 || f.Hits[0].Dmg != 0 {
		t.Fatalf("stopwatch: %+v", f)
	}
	if f := fires[3]; f.Result != "wasted" || g.cats[3] != nil {
		t.Fatalf("empty lane: %+v", f)
	}
	if w.pos != 5 || w.frozen != 1 {
		t.Fatalf("frozen machine pos=%d frozen=%d", w.pos, w.frozen)
	}
	g.startPlan(2)
	run(g)
	g.startPlan(3)
	run(g)
	if w.pos != 4 {
		t.Fatalf("after freeze pos=%d", w.pos)
	}
}

func TestSecondFireInSlotFindsCatapultEmpty(t *testing.T) {
	g, ids := board(t, 2)
	g.lay.Cells[2][0] = Cell{Kind: KFloor, H: 1} // a second loading cell for catapult 2 (0,3)
	put(g, ids[0], 1, 3)
	put(g, ids[1], 0, 2)
	addMachine(g, "scrap", 2, 3)
	g.cats[2] = &BombRef{ID: 9, Kind: "keg"}
	q(g, ids[0], fr)
	q(g, ids[1], fr)
	f := evs[EvFire](run(g))
	if len(f) != 2 || f[0].Result != "ok" || f[1].Result != "empty" {
		t.Fatalf("%+v", f)
	}
}

// --- slots ------------------------------------------------------------------------------

func TestSlotsPlayInOrderOnTheNewState(t *testing.T) {
	// One engineer: walk, pick up, walk, throw — each slot on the board the
	// previous one left; machines move once, after the last slot.
	g, ids := board(t, 2)
	a, b := ids[0], ids[1]
	put(g, a, 4, 6)
	put(g, b, 3, 1) // catches in column 3
	ground(g, 4, 4, "keg")
	m := addMachine(g, "scrap", 0, 5)
	q(g, a, mv(0, -1), pkd(0, -1), mv(-1, 0), th(0, -1))
	q(g, b, wt, wt, wt, wt)
	ev := run(g)
	if at(g, a) != [2]int{3, 5} || g.player(b).carry == nil || len(fizzles(ev)) != 0 {
		t.Fatalf("at %v carry %v ev %+v", at(g, a), g.player(b).carry, ev)
	}
	if m.pos != 4 || len(evs[EvAdvance](ev)) != 1 {
		t.Fatalf("machine moved %d", m.pos)
	}
	// b loads in slot 0 and fires in slot 1 of the next turn.
	g.startPlan(2)
	q(g, b, ld, fr)
	ev = run(g)
	if f := evs[EvFire](ev); len(f) != 1 || *f[0].Slot != 1 || !f[0].Hits[0].Killed {
		t.Fatalf("%+v", f)
	}
	// A fizzle does not stop the later slots.
	g.startPlan(3)
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
	addMachine(g, "scrap", 2, 3)
	g.cats[2] = &BombRef{ID: 77, Kind: "keg"}
	q(g, ids[0], th(0, -1))
	q(g, ids[1], mv(0, -1), wt, mv(0, -1))
	q(g, ids[2], wt, fr)
	ev := run(g)
	h, ok := ev[0].(EvResolve)
	if !ok {
		t.Fatalf("first event %+v", ev[0])
	}
	// Slot 0: throw, move. Slot 1: fire. Slot 2: move. Then machines (bomb top-up).
	if len(h.Slots) != 3 || h.Slots[0].Slot != 0 || len(h.Slots[0].Stages) != 2 || h.Slots[1].Stages[0].S != StFire ||
		h.Slots[2].Slot != 2 || h.Machines == nil {
		t.Fatalf("header %+v", h)
	}
	last := h.Slots[2]
	if h.Slots[1].At < h.Slots[0].At+h.Slots[0].Dur || h.Machines.At < last.At+last.Dur || h.Dur < h.Machines.At+h.Machines.Dur {
		t.Fatalf("timeline not in order %+v", h)
	}
	// Events come in slot order and carry their slot; machine events don't.
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
