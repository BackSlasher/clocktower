package catapultcoop

import (
	"slices"
	"testing"
)

// --- 1. throws ------------------------------------------------------------------

func TestThrowCaughtAndLanded(t *testing.T) {
	g, ids := board(t, 3)
	a, b, c := ids[0], ids[1], ids[2]
	put(g, a, 3, 5)
	put(g, b, 3, 2) // free hands: catches
	put(g, c, 6, 5) // carrying, not throwing: the bomb lands at their feet
	ba := give(g, a, "keg")
	give(g, c, "keg")
	mustPlan(t, g, a, cmd(AThrow, 3, 2))
	ev := evs[EvThrow](run(g))
	if len(ev) != 1 || ev[0].Result != "caught" || ev[0].By != b || ev[0].Bomb != ba.ID {
		t.Fatalf("throw: %+v", ev)
	}
	if g.player(b).carry != ba || g.player(a).carry != nil {
		t.Fatal("bomb not in catcher's hands")
	}

	g.startPlan(2)
	mustPlan(t, g, b, cmd(AThrow, 6, 2))
	mustPlan(t, g, c, cmd(AWait, 0, 0))
	g.player(c).x, g.player(c).y = 6, 2
	ev = evs[EvThrow](run(g))
	if ev[0].Result != "landed" || ev[0].At != [2]int{6, 2} || g.bombAt(6, 2) == nil {
		t.Fatalf("throw at a carrier: %+v", ev)
	}
}

func TestThrowSettlesOnNearestFreeFloor(t *testing.T) {
	g, ids := board(t, 2)
	a, b := ids[0], ids[1]
	put(g, a, 5, 5)
	put(g, b, 5, 8)
	give(g, a, "keg")
	give(g, b, "keg")
	ground(g, 5, 3, "grapeshot")
	mustPlan(t, g, a, cmd(AThrow, 5, 3)) // a bomb lies there already
	mustPlan(t, g, b, cmd(AThrow, 1, 8)) // stairs: not floor
	ev := evs[EvThrow](run(g))
	if ev[0].Result != "landed" || ev[0].To != [2]int{5, 3} || ev[0].At != [2]int{5, 2} {
		t.Fatalf("onto a bomb: %+v", ev[0])
	}
	// Nearest floor to the stairs (1,8): (1,7) rampart is distance 1 and comes
	// first (smaller y).
	if ev[1].At != [2]int{1, 7} {
		t.Fatalf("onto stairs: %+v", ev[1])
	}
}

func TestThrowChainSameRound(t *testing.T) {
	// A throws to B while B throws to C: B's hands are free once B lets go.
	g, ids := board(t, 3)
	a, b, c := ids[0], ids[1], ids[2]
	put(g, a, 3, 7)
	put(g, b, 3, 4)
	put(g, c, 3, 1)
	ba, bb := give(g, a, "keg"), give(g, b, "grapeshot")
	mustPlan(t, g, a, cmd(AThrow, 3, 4))
	mustPlan(t, g, b, cmd(AThrow, 3, 1))
	run(g)
	if g.player(b).carry != ba || g.player(c).carry != bb {
		t.Fatalf("relay failed: b=%v c=%v", g.player(b).carry, g.player(c).carry)
	}
}

func TestTwoThrowsOneCatcher(t *testing.T) {
	g, ids := board(t, 3)
	a, b, c := ids[0], ids[1], ids[2]
	put(g, a, 2, 5)
	put(g, b, 8, 5)
	put(g, c, 5, 5)
	ba := give(g, a, "keg")
	give(g, b, "keg")
	mustPlan(t, g, a, cmd(AThrow, 5, 5))
	mustPlan(t, g, b, cmd(AThrow, 5, 5))
	ev := evs[EvThrow](run(g))
	if ev[0].Result != "caught" || ev[1].Result != "landed" || g.player(c).carry != ba {
		t.Fatalf("%+v", ev)
	}
	if ev[1].At != [2]int{5, 5} {
		t.Fatalf("second bomb should land at the catcher's feet: %+v", ev[1])
	}
}

func TestThrowThenMove(t *testing.T) {
	// "I throw to where you are, then you walk" works: B catches, then moves
	// (with the bomb).
	g, ids := board(t, 2)
	a, b := ids[0], ids[1]
	put(g, a, 3, 6)
	put(g, b, 3, 3)
	ba := give(g, a, "keg")
	mustPlan(t, g, a, cmd(AThrow, 3, 3))
	mustPlan(t, g, b, cmd(AMove, 5, 3))
	run(g)
	if g.player(b).carry != ba || at(g, b) != [2]int{5, 3} {
		t.Fatalf("catch-and-walk: carry=%v at=%v", g.player(b).carry, at(g, b))
	}
	// "You walk there and I throw to where you will be" does not: the bomb
	// lands, and B ends up standing on it.
	g.startPlan(2)
	put(g, a, 3, 6)
	give(g, a, "keg")
	g.player(b).carry = nil
	put(g, b, 5, 6)
	mustPlan(t, g, a, cmd(AThrow, 6, 6))
	mustPlan(t, g, b, cmd(AMove, 6, 6))
	ev := evs[EvThrow](run(g))
	if ev[0].Result != "landed" || g.player(b).carry != nil || at(g, b) != [2]int{6, 6} || g.bombAt(6, 6) == nil {
		t.Fatalf("throw ahead: %+v carry=%v", ev, g.player(b).carry)
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
	mustPlan(t, g, ids[0], cmd(AMove, 4, 4))
	mustPlan(t, g, ids[1], cmd(AMove, 4, 4))
	r := moveResults(run(g))
	if r[ids[0]] != "bump" || r[ids[1]] != "bump" || at(g, ids[0]) != [2]int{3, 4} || at(g, ids[1]) != [2]int{5, 4} {
		t.Fatalf("%v", r)
	}
}

func TestMoveSwapBumps(t *testing.T) {
	g, ids := board(t, 2)
	put(g, ids[0], 3, 4)
	put(g, ids[1], 4, 4)
	mustPlan(t, g, ids[0], cmd(AMove, 4, 4))
	mustPlan(t, g, ids[1], cmd(AMove, 3, 4))
	r := moveResults(run(g))
	if r[ids[0]] != "bump" || r[ids[1]] != "bump" || at(g, ids[0]) != [2]int{3, 4} {
		t.Fatalf("%v", r)
	}
}

func TestMoveIntoStayingEngineerBumps(t *testing.T) {
	g, ids := board(t, 2)
	put(g, ids[0], 3, 4)
	put(g, ids[1], 4, 4)
	mustPlan(t, g, ids[0], cmd(AMove, 4, 4))
	mustPlan(t, g, ids[1], cmd(AWait, 0, 0))
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
	mustPlan(t, g, a, cmd(AMove, 3, 4))
	mustPlan(t, g, b, cmd(AMove, 4, 4))
	mustPlan(t, g, c, cmd(AMove, 6, 4))
	r := moveResults(run(g))
	if r[a] != "ok" || r[b] != "ok" || r[c] != "ok" || at(g, a) != [2]int{3, 4} || at(g, c) != [2]int{6, 4} {
		t.Fatalf("%v", r)
	}
}

func TestMoveChainBehindABumpBumps(t *testing.T) {
	g, ids := board(t, 4)
	a, b, c, d := ids[0], ids[1], ids[2], ids[3]
	put(g, a, 2, 4)
	put(g, b, 3, 4)
	put(g, c, 5, 3)
	put(g, d, 5, 5)
	mustPlan(t, g, a, cmd(AMove, 3, 4)) // into b's cell
	mustPlan(t, g, b, cmd(AMove, 5, 4)) // b and c and d all want (5,4)
	mustPlan(t, g, c, cmd(AMove, 5, 4))
	mustPlan(t, g, d, cmd(AMove, 5, 4))
	r := moveResults(run(g))
	for _, p := range ids {
		if r[p] != "bump" {
			t.Fatalf("%s: %v", p, r)
		}
	}
}

func TestMoveRotationOfThreeSucceeds(t *testing.T) {
	g, ids := board(t, 4)
	a, b, c := ids[0], ids[1], ids[2]
	put(g, a, 3, 3)
	put(g, b, 4, 3)
	put(g, c, 4, 4)
	put(g, ids[3], 7, 7)
	// a → b's cell, b → c's cell, c → (3,4) → wait: a 3-cycle needs c → a's cell.
	mustPlan(t, g, a, cmd(AMove, 4, 3))
	mustPlan(t, g, b, cmd(AMove, 4, 4))
	mustPlan(t, g, c, cmd(AMove, 3, 3))
	r := moveResults(run(g))
	if r[a] != "ok" || r[b] != "ok" || r[c] != "ok" || at(g, c) != [2]int{3, 3} {
		t.Fatalf("%v", r)
	}
}

func TestMoveValidation(t *testing.T) {
	g, ids := board(t, 1)
	a := ids[0]
	put(g, a, 3, 4)
	p := g.player(a)
	_, err := g.validate(p, cmd(AMove, 3, 7))
	wantCode(t, err, "bad_plan") // 3 cells
	if _, err := g.validate(p, cmd(AMove, 4, 5)); err != nil {
		t.Fatal(err)
	}
	give(g, a, "keg")
	_, err = g.validate(p, cmd(AMove, 3, 6))
	wantCode(t, err, "bad_plan") // carrying: 1 cell
	if _, err := g.validate(p, cmd(AMove, 3, 5)); err != nil {
		t.Fatal(err)
	}
	p.carry = nil
	put(g, a, 3, 2)
	_, err = g.validate(p, cmd(AMove, 3, 1)) // up the wall without stairs
	wantCode(t, err, "bad_plan")
	_, err = g.validate(p, cmd(AMove, 3, 0)) // a wall cell
	wantCode(t, err, "bad_plan")
	_, err = g.validate(p, cmd(AMove, 3, 2)) // own cell
	wantCode(t, err, "bad_plan")
	put(g, a, 8, 3)
	pl, err := g.validate(p, cmd(AMove, 8, 1)) // up the stairs
	if err != nil || len(pl.Path) != 2 {
		t.Fatalf("%v %+v", err, pl)
	}
	// Other engineers do not block pathing (only the destination matters at resolve).
}

// --- 3. pick-ups and loads ------------------------------------------------------------

func TestPickupContestedAndHandsFull(t *testing.T) {
	g, ids := board(t, 3)
	a, b, c := ids[0], ids[1], ids[2]
	put(g, a, 4, 4)
	put(g, b, 6, 4)
	bomb := ground(g, 5, 4, "keg")
	mustPlan(t, g, a, cmd(APickup, 5, 4))
	mustPlan(t, g, b, cmd(APickup, 5, 4))
	ev := evs[EvPickup](run(g))
	if ev[0].Result != "contested" || ev[1].Result != "contested" || g.bombAt(5, 4) != bomb {
		t.Fatalf("%+v", ev)
	}
	// A pick-up planned by someone who catches a throw in the same round fails.
	g.startPlan(2)
	put(g, c, 4, 7)
	give(g, c, "grapeshot")
	mustPlan(t, g, c, cmd(AThrow, 4, 4))
	mustPlan(t, g, a, cmd(APickup, 5, 4))
	ev = evs[EvPickup](run(g))
	if ev[0].Result != "hands_full" || g.player(a).carry.Kind != "grapeshot" {
		t.Fatalf("%+v", ev)
	}
	// Alone: works, any height, from an adjacent cell.
	g.startPlan(3)
	put(g, b, 5, 2)
	ground(g, 5, 1, "keg") // on the rampart
	mustPlan(t, g, b, cmd(APickup, 5, 1))
	ev = evs[EvPickup](run(g))
	if ev[0].Result != "ok" || g.player(b).carry == nil || g.bombAt(5, 1) != nil {
		t.Fatalf("%+v", ev)
	}
	// Out of reach.
	g.startPlan(4)
	_, err := g.validate(g.player(a), cmd(APickup, 6, 6))
	wantCode(t, err, "bad_plan")
}

func TestLoadContestedAndOK(t *testing.T) {
	g, ids := board(t, 2)
	a, b := ids[0], ids[1]
	// Catapult 0 is at (3,0); its loading cell is (3,1). Put two engineers
	// next to catapult 2 (0,3): only (1,3) is a loading cell, so contest
	// catapult 0 via a crafted plan instead.
	put(g, a, 3, 1)
	put(g, b, 2, 1)
	give(g, a, "keg")
	give(g, b, "keg")
	mustPlan(t, g, a, catCmd(ALoad, 0))
	g.player(b).plan = &Plan{A: ALoad, Cat: IntP(0)} // (2,1) is not a loading cell; forced
	ev := evs[EvLoad](run(g))
	if ev[0].Result != "contested" || ev[1].Result != "contested" || g.cats[0] != nil {
		t.Fatalf("%+v", ev)
	}
	g.startPlan(2)
	mustPlan(t, g, a, Cmd{T: "plan", A: ALoad}) // catapult inferred
	ev = evs[EvLoad](run(g))
	if ev[0].Result != "ok" || g.cats[0] == nil || g.player(a).carry != nil {
		t.Fatalf("%+v", ev)
	}
}

func TestLoadFireValidation(t *testing.T) {
	g, ids := board(t, 1)
	a := ids[0]
	p := g.player(a)
	put(g, a, 3, 2) // courtyard below catapult 0's loading cell
	give(g, a, "keg")
	_, err := g.validate(p, catCmd(ALoad, 0))
	wantCode(t, err, "bad_plan")
	put(g, a, 3, 1)
	_, err = g.validate(p, catCmd(ALoad, 1))
	wantCode(t, err, "bad_plan") // not adjacent
	_, err = g.validate(p, catCmd(ALoad, 9))
	wantCode(t, err, "bad_request")
	_, err = g.validate(p, catCmd(AFire, 0))
	wantCode(t, err, "bad_plan") // not loaded
	_, err = g.validate(p, Cmd{T: "plan", A: ALoad, Cat: IntP(0), Fire: true})
	wantCode(t, err, "bad_plan") // no Quick Hands
	g.cats[0] = &BombRef{ID: 99, Kind: "keg"}
	_, err = g.validate(p, catCmd(ALoad, 0))
	wantCode(t, err, "bad_plan") // already loaded
	if _, err := g.validate(p, catCmd(AFire, 0)); err != nil {
		t.Fatal(err)
	}
	// Throws: straight lines only, within range, onto walkable cells.
	put(g, a, 4, 5)
	_, err = g.validate(p, cmd(AThrow, 5, 6))
	wantCode(t, err, "bad_plan")
	_, err = g.validate(p, cmd(AThrow, 4, 0))
	wantCode(t, err, "bad_plan") // wall cell, and 5 away
	_, err = g.validate(p, cmd(AThrow, 4, 1))
	if err != nil {
		t.Fatal(err) // 4 cells, over the height difference
	}
	_, err = g.validate(p, Cmd{T: "plan", A: AThrow})
	wantCode(t, err, "bad_request")
	_, err = g.validate(p, Cmd{T: "plan", A: "dance"})
	wantCode(t, err, "bad_request")
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
		mustPlan(t, g, ids[i], cmd(AWait, 0, 0))
	}
	// Lane 0: keg hits the nearest machine for 2.
	near := addMachine(g, "brute", 0, 2)
	far := addMachine(g, "scrap", 0, 4)
	g.cats[0] = &BombRef{ID: 50, Kind: "keg"}
	mustPlan(t, g, ids[0], catCmd(AFire, 0))
	// Lane 1: grapeshot hits all for 1.
	s1, s2 := addMachine(g, "scrap", 1, 5), addMachine(g, "brute", 1, 3)
	g.cats[1] = &BombRef{ID: 51, Kind: "grapeshot"}
	mustPlan(t, g, ids[1], catCmd(AFire, 1))
	// Lane 2: stopwatch freezes.
	w := addMachine(g, "scrap", 2, 5)
	g.cats[2] = &BombRef{ID: 52, Kind: "stopwatch"}
	mustPlan(t, g, ids[2], catCmd(AFire, 2))
	// Lane 3: empty lane wastes the bomb.
	g.cats[3] = &BombRef{ID: 53, Kind: "keg"}
	mustPlan(t, g, ids[3], catCmd(AFire, 3))

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
	// The frozen scrap stalls twice, then moves.
	if w.pos != 5 || w.frozen != 1 {
		t.Fatalf("frozen machine pos=%d frozen=%d", w.pos, w.frozen)
	}
	stalls := evs[EvStall](all)
	if len(stalls) != 1 || stalls[0].ID != w.id {
		t.Fatalf("stalls %+v", stalls)
	}
	g.startPlan(2)
	run(g)
	g.startPlan(3)
	run(g)
	if w.pos != 4 {
		t.Fatalf("after freeze pos=%d", w.pos)
	}
}

func TestSecondFireFindsCatapultEmpty(t *testing.T) {
	g, ids := board(t, 2)
	put(g, ids[0], 1, 3)
	put(g, ids[1], 1, 2) // not a loading cell for catapult 2; forced plan
	addMachine(g, "scrap", 2, 3)
	g.cats[2] = &BombRef{ID: 9, Kind: "keg"}
	mustPlan(t, g, ids[0], catCmd(AFire, 2))
	g.player(ids[1]).plan = &Plan{A: AFire, Cat: IntP(2)}
	f := evs[EvFire](run(g))
	if f[0].Result != "ok" || f[1].Result != "empty" {
		t.Fatalf("%+v", f)
	}
}

func TestQuickHandsLoadsAndFires(t *testing.T) {
	g, ids := board(t, 1)
	a := ids[0]
	g.player(a).perks["quick_hands"] = 1
	put(g, a, 1, 6)
	give(g, a, "keg")
	m := addMachine(g, "scrap", 3, 4)
	mustPlan(t, g, a, Cmd{T: "plan", A: ALoad, Cat: IntP(3), Fire: true})
	ev := run(g)
	if l := evs[EvLoad](ev); l[0].Result != "ok" {
		t.Fatalf("%+v", l)
	}
	if f := evs[EvFire](ev); len(f) != 1 || !f[0].Hits[0].Killed || slices.Contains(g.machines, m) || g.cats[3] != nil {
		t.Fatalf("%+v", f)
	}
}

// --- 5. machines --------------------------------------------------------------------

func TestMachinesAdvanceHitWallAndSpawn(t *testing.T) {
	g, ids := board(t, 1)
	put(g, ids[0], 5, 5)
	s := addMachine(g, "scrap", 0, 0)
	r := addMachine(g, "roach", 1, 3)
	b := addMachine(g, "brute", 2, 4)
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
	if r.pos != 1 || b.pos != 4 { // brute moves every other round
		t.Fatalf("roach %d brute %d", r.pos, b.pos)
	}
	sp := evs[EvSpawn](ev)
	if len(sp) != 1 || sp[0].Lane != 3 || sp[0].Pos != laneLen-1 || sp[0].S != StMachines {
		t.Fatalf("spawn %+v", sp)
	}
	// The batch starts with the resolve header, whose stages are the
	// non-empty ones in order.
	h, ok := ev[0].(EvResolve)
	if !ok || h.Dur != Defs.ResolveBase+Defs.StageTime || len(h.Stages) != 1 || h.Stages[0].S != StMachines {
		t.Fatalf("header %+v", ev[0])
	}
	g.startPlan(2)
	run(g)
	if b.pos != 3 {
		t.Fatalf("brute %d", b.pos)
	}
	// Bombs were topped up: bombsBase + bombsPerPlayer × 1.
	if len(g.bombs) != Defs.BombsBase+Defs.BombsPerPlayer {
		t.Fatalf("bombs %d", len(g.bombs))
	}
	for _, bm := range g.bombs {
		if c := g.lay.At(bm.x, bm.y); c.Kind != KFloor || c.H != 0 {
			t.Fatalf("bomb on %+v", c)
		}
	}
}

func TestResolveEventOrder(t *testing.T) {
	g, ids := board(t, 3)
	put(g, ids[0], 3, 5)
	put(g, ids[1], 6, 6)
	put(g, ids[2], 1, 3)
	give(g, ids[0], "keg")
	addMachine(g, "scrap", 2, 3)
	g.cats[2] = &BombRef{ID: 77, Kind: "keg"}
	mustPlan(t, g, ids[0], cmd(AThrow, 3, 2))
	mustPlan(t, g, ids[1], cmd(AMove, 6, 4))
	mustPlan(t, g, ids[2], catCmd(AFire, 2))
	ev := run(g)
	var names []string
	for _, e := range ev {
		switch v := e.(type) {
		case EvResolve:
			names = append(names, "resolve")
		case EvThrow:
			names = append(names, v.S)
		case EvMove:
			names = append(names, v.S)
		case EvFire:
			names = append(names, v.S)
		case EvBomb:
			names = append(names, v.S)
		}
	}
	want := []string{"resolve", StThrow, StMove, StFire}
	if !slices.Equal(names[:4], want) {
		t.Fatalf("order %v", names)
	}
	h := ev[0].(EvResolve)
	if len(h.Stages) != 4 || h.Stages[0].At >= h.Stages[1].At {
		t.Fatalf("stages %+v", h.Stages)
	}
}
