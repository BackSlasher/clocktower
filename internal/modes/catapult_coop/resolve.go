package catapultcoop

import (
	"math"
	"slices"
)

// A turn resolves slot by slot (docs/CATAPULT_COOP.md "Resolve order").
// In each slot every player's action for that slot is first turned into a
// concrete step against the board as it stands at the start of the slot (an
// impossible action fizzles), then the slot plays in four stages:
//
//  1. throws fly and are caught or blocked, or land
//  2. moves (bumps on shared destinations, swaps and blocked cells)
//  3. pick-ups (own cell), then loads (contested loads fail)
//  4. loaded catapults whose lane has a machine fire by themselves
//
// After the last slot, once per turn: machines advance, the turn's new
// machines appear, bombs are topped up.
//
// The board is updated at once; the events (one batch, starting with
// `resolve`) let the TV animate it. Within a stage, events are in player
// join order (machines: id order); fizzles come first in their stage.

// step is one action made concrete for the slot being resolved.
type step struct {
	a      string
	x, y   int // move: destination; pickup: the bomb's cell
	dx, dy int // throw: direction
	cat    int // load, fire: catapult id
}

func (g *Game) resolve() {
	for _, p := range g.players {
		if !p.placed {
			continue
		}
		if len(p.acts) == 0 && !p.done {
			if p.missed < Defs.AwayAfter {
				p.missed++
			}
		} else {
			p.missed = 0
		}
	}
	saved := g.events
	g.events = nil
	hdr := EvResolve{E: "resolve", Level: g.level, Round: g.round, Slots: []SlotTiming{}}
	t := Defs.ResolveBase / 2
	for slot := 0; slot < Defs.Slots; slot++ { // every slot runs: catapults fire by themselves
		g.curSlot = slot
		fz := g.buildSteps(slot)
		st := SlotTiming{Slot: slot, At: t, Stages: []StageTiming{}}
		stage := func(name string, run func()) {
			n := len(g.events)
			for _, e := range fz[name] {
				g.emit(e)
			}
			run()
			if len(g.events) > n {
				st.Stages = append(st.Stages, StageTiming{S: name, At: t, Dur: Defs.StageTime})
				t += Defs.StageTime
			}
		}
		stage(StThrow, g.resolveThrows)
		stage(StMove, g.resolveMoves)
		stage(StGrab, g.resolveGrabs)
		stage(StFire, g.autoFire)
		if len(st.Stages) > 0 {
			st.Dur = t - st.At
			hdr.Slots = append(hdr.Slots, st)
		}
	}
	g.curSlot = -1
	for _, p := range g.players {
		p.cur = nil
	}
	n := len(g.events)
	g.resolveMachines()
	if len(g.events) > n {
		hdr.Machines = &StageTiming{S: StMachines, At: t, Dur: Defs.MachineTime}
		t += Defs.MachineTime
	}
	hdr.Dur = round1(t + Defs.ResolveBase/2)
	for i := range hdr.Slots { // clean numbers on the wire
		sl := &hdr.Slots[i]
		sl.At, sl.Dur = round2(sl.At), round2(sl.Dur)
		for j := range sl.Stages {
			sl.Stages[j].At, sl.Stages[j].Dur = round2(sl.Stages[j].At), round2(sl.Stages[j].Dur)
		}
	}
	if hdr.Machines != nil {
		hdr.Machines.At, hdr.Machines.Dur = round2(hdr.Machines.At), round2(hdr.Machines.Dur)
	}
	batch := g.events
	g.events = append(append(saved, hdr), batch...)
	if g.guide != nil {
		g.guideEvents(batch)
	}

	g.rounds++
	g.phase = PhaseResolve
	g.left = hdr.Dur
	g.slowVer++
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// slotP is the slot tag for events (nil in the machine stage).
func (g *Game) slotP() *int {
	if g.curSlot < 0 {
		return nil
	}
	return IntP(g.curSlot)
}

func planned(p *player, a string) bool { return p.placed && p.cur != nil && p.cur.a == a }

func stageOf(a string) string {
	switch a {
	case AThrow:
		return StThrow
	case AMove:
		return StMove
	}
	return StGrab // pickup, load
}

// buildSteps sets every player's step for slot (nil for wait, fizzle or no
// action) and returns the fizzle events by stage.
func (g *Game) buildSteps(slot int) map[string][]any {
	fz := map[string][]any{}
	for _, p := range g.players {
		p.cur = nil
		if !p.placed || slot >= len(p.acts) {
			continue
		}
		a := p.acts[slot]
		st, reason := g.stepFor(p, a)
		if reason != "" {
			p.st.fizzles++
			s := stageOf(a.A)
			fz[s] = append(fz[s], EvFizzle{E: "fizzle", S: s, Slot: g.slotP(), PID: p.id, A: a.A, At: [2]int{p.x, p.y}, Reason: reason})
			continue
		}
		p.cur = st
	}
	return fz
}

// stepFor makes act concrete for p on the current board, or says why it
// fizzles.
func (g *Game) stepFor(p *player, act Act) (*step, string) {
	l := g.lay
	switch act.A {
	case AMove:
		x, y := p.x+*act.DX, p.y+*act.DY
		if !l.CanStep(p.x, p.y, x, y) {
			return nil, FzBlocked
		}
		return &step{a: AMove, x: x, y: y}, ""
	case AThrow:
		if p.carry == nil {
			return nil, FzEmptyHands
		}
		if _, ok := l.Landing(l.ThrowLine(p.x, p.y, *act.DX, *act.DY, Defs.ThrowRange)); !ok {
			return nil, FzNoTarget
		}
		return &step{a: AThrow, dx: *act.DX, dy: *act.DY}, ""
	case APickup:
		if p.carry != nil {
			return nil, FzHandsFull
		}
		b := g.bombAt(p.x, p.y) // own cell only
		if b == nil {
			return nil, FzNoBomb
		}
		return &step{a: APickup, x: b.x, y: b.y}, ""
	case ALoad:
		if p.carry == nil {
			return nil, FzEmptyHands
		}
		next := false
		for _, c := range g.keep.Catapults { // lowest id first
			if !l.LoadCell(p.x, p.y, c) {
				continue
			}
			next = true
			if g.cats[c.ID] == nil {
				return &step{a: ALoad, cat: c.ID}, ""
			}
		}
		if !next {
			return nil, FzNoCatapult
		}
		return nil, FzCatapultFull
	}
	return nil, "" // wait
}

// --- 1. throws ---------------------------------------------------------------------

// resolveThrows: every thrower lets go at once, so a thrower can catch in the
// same stage. In player order, each bomb flies along its throw line (see
// Layout.ThrowLine) and stops at the first engineer on it (positions at the
// start of the slot): caught if that engineer's hands are empty at that
// point, otherwise blocked, dropping at their feet. With nobody on the line
// it lands on the furthest walkable cell of the line. A bomb that comes down
// on a cell that is not floor or already has a bomb settles on the nearest
// free floor cell.
func (g *Game) resolveThrows() {
	type flight struct {
		p *player
		b *BombRef
	}
	var fl []flight
	for _, p := range g.players {
		if planned(p, AThrow) && p.carry != nil {
			fl = append(fl, flight{p, p.carry})
			p.carry = nil
		}
	}
	for _, f := range fl {
		dx, dy := f.p.cur.dx, f.p.cur.dy
		line := g.lay.ThrowLine(f.p.x, f.p.y, dx, dy, Defs.ThrowRange)
		f.p.st.throws++
		ev := EvThrow{E: "throw", S: StThrow, Slot: g.slotP(), PID: f.p.id, Bomb: f.b.ID, Kind: f.b.Kind,
			From: [2]int{f.p.x, f.p.y}, Dir: [2]int{dx, dy}}
		var stop *player
		for _, c := range line {
			if o := g.engineerAt(c[0], c[1]); o != nil {
				stop = o
				break
			}
		}
		switch {
		case stop != nil && stop.carry == nil:
			stop.carry = f.b
			stop.st.catches++
			ev.Result, ev.By = "caught", stop.id
			ev.To = [2]int{stop.x, stop.y}
			ev.At = ev.To
		default:
			to, _ := g.lay.Landing(line) // checked: the line has a walkable cell
			ev.Result = "landed"
			if stop != nil {
				to = [2]int{stop.x, stop.y}
				ev.Result, ev.By = "blocked", stop.id
			}
			lx, ly := g.landCell(to[0], to[1])
			g.bombs = append(g.bombs, &bomb{id: f.b.ID, kind: f.b.Kind, x: lx, y: ly})
			ev.To, ev.At = to, [2]int{lx, ly}
		}
		g.emit(ev)
	}
}

// landCell is where a bomb coming down at (x, y) comes to rest: (x, y)
// itself if it is floor without a bomb, else the nearest such cell by
// Manhattan distance (ties: smaller y, then smaller x).
func (g *Game) landCell(x, y int) (int, int) {
	free := func(cx, cy int) bool { return g.lay.At(cx, cy).Kind == KFloor && g.bombAt(cx, cy) == nil }
	if free(x, y) {
		return x, y
	}
	for d := 1; d < g.lay.W+g.lay.H; d++ {
		for cy := y - d; cy <= y+d; cy++ {
			r := d - abs(cy-y)
			for _, cx := range []int{x - r, x + r} {
				if free(cx, cy) {
					return cx, cy
				}
				if r == 0 {
					break
				}
			}
		}
	}
	return x, y // unreachable on any real layout
}

// --- 2. moves ----------------------------------------------------------------------

// resolveMoves: a move fails (bump) if another engineer heads for the same
// cell, if it swaps places with another mover, or if its destination is
// occupied by an engineer who does not leave. Chains into a vacated cell
// succeed, and so do rotations of four.
func (g *Game) resolveMoves() {
	const (
		unknown = iota
		ok
		bump
	)
	var movers []*player
	status := map[*player]int{}
	claims := map[[2]int]int{}
	dest := func(p *player) [2]int { return [2]int{p.cur.x, p.cur.y} }
	for _, p := range g.players {
		if planned(p, AMove) {
			movers = append(movers, p)
			claims[dest(p)]++
		}
	}
	for _, p := range movers {
		d := dest(p)
		if claims[d] > 1 {
			status[p] = bump
			continue
		}
		if o := g.engineerAt(d[0], d[1]); o != nil && planned(o, AMove) && dest(o) == [2]int{p.x, p.y} {
			status[p] = bump
		}
	}
	for changed := true; changed; {
		changed = false
		for _, p := range movers {
			if status[p] != unknown {
				continue
			}
			o := g.engineerAt(dest(p)[0], dest(p)[1])
			switch {
			case o == nil:
				status[p] = ok
			case !planned(o, AMove) || status[o] == bump:
				status[p] = bump
			case status[o] == ok:
				status[p] = ok
			default:
				continue
			}
			changed = true
		}
	}
	var moved []*player
	for _, p := range movers {
		ev := EvMove{E: "move", S: StMove, Slot: g.slotP(), PID: p.id, From: [2]int{p.x, p.y}, To: dest(p), Result: "ok"}
		if status[p] == bump {
			ev.Result = "bump"
			p.st.bumps++
		} else {
			moved = append(moved, p)
			p.st.steps++
		}
		g.emit(ev)
	}
	// Positions change only after every outcome is known (engineerAt above
	// relies on the start-of-slot board).
	for _, p := range moved {
		p.x, p.y = p.cur.x, p.cur.y
	}
}

// --- 3. pick-ups and loads ------------------------------------------------------------

// resolveGrabs: pick-ups first (each takes the bomb in the picker's own cell;
// it fails if their hands are full now — they caught a throw earlier in the
// slot), then loads (fail if another engineer loads the same catapult).
func (g *Game) resolveGrabs() {
	for _, p := range g.players {
		if !planned(p, APickup) {
			continue
		}
		b := g.bombAt(p.cur.x, p.cur.y)
		ev := EvPickup{E: "pickup", S: StGrab, Slot: g.slotP(), PID: p.id, At: [2]int{p.cur.x, p.cur.y}, Bomb: b.id, Kind: b.kind}
		if p.carry != nil {
			ev.Result = "hands_full"
		} else {
			ev.Result = "ok"
			p.carry = &BombRef{ID: b.id, Kind: b.kind}
			p.st.pickups++
			g.bombs = slices.DeleteFunc(g.bombs, func(o *bomb) bool { return o == b })
		}
		g.emit(ev)
	}
	loads := map[int]int{}
	for _, p := range g.players {
		if planned(p, ALoad) {
			loads[p.cur.cat]++
		}
	}
	for _, p := range g.players {
		if !planned(p, ALoad) {
			continue
		}
		c := p.cur.cat
		ev := EvLoad{E: "load", S: StGrab, Slot: g.slotP(), PID: p.id, Cat: c, Bomb: p.carry.ID, Kind: p.carry.Kind}
		if loads[c] > 1 {
			ev.Result = "contested"
		} else {
			ev.Result = "ok"
			g.cats[c], g.catBy[c] = p.carry, p.id
			p.carry = nil
			p.st.loads++
		}
		g.emit(ev)
	}
}

// --- 4. fires -------------------------------------------------------------------------

// autoFire: at the end of the slot every loaded catapult whose lane has a
// machine fires by itself (catapult id order). The loader is credited.
func (g *Game) autoFire() {
	for _, c := range g.keep.Catapults {
		b := g.cats[c.ID]
		if b == nil || !slices.ContainsFunc(g.machines, func(m *machine) bool { return m.lane == c.Lane }) {
			continue
		}
		by := g.player(g.catBy[c.ID])
		g.cats[c.ID], g.catBy[c.ID] = nil, ""
		ev := EvFire{E: "fire", S: StFire, Slot: g.slotP(), Cat: c.ID, Lane: c.Lane, Bomb: b.ID, Kind: b.Kind}
		if by != nil {
			ev.PID = by.id
		}
		ev.Hits = g.blast(by, c.Lane, b.Kind)
		g.emit(ev)
	}
}

// blast applies a bomb of kind to a lane, crediting p (may be nil), and
// removes destroyed machines.
func (g *Game) blast(p *player, lane int, kind string) []Hit {
	def := Defs.Bombs[kind]
	st := &stats{}
	if p != nil {
		st = &p.st
	}
	var in []*machine
	for _, m := range g.machines {
		if m.lane == lane {
			in = append(in, m)
		}
	}
	if kind == "keg" && len(in) > 0 {
		near := in[0]
		for _, m := range in[1:] {
			if m.pos < near.pos {
				near = m
			}
		}
		in = []*machine{near}
	}
	hits := []Hit{}
	for _, m := range in {
		h := Hit{ID: m.id}
		if def.Dmg > 0 {
			h.Dmg = min(def.Dmg, m.hp)
			m.hp -= def.Dmg
			st.dmg += h.Dmg
		}
		if def.Freeze > 0 {
			m.frozen = max(m.frozen, def.Freeze)
		}
		h.HP, h.Frozen = max(0, m.hp), m.frozen
		if m.hp <= 0 {
			h.Killed, h.Frozen = true, 0
			st.kills++
		}
		hits = append(hits, h)
	}
	g.machines = slices.DeleteFunc(g.machines, func(m *machine) bool { return m.hp <= 0 })
	return hits
}

// --- 5. machines ----------------------------------------------------------------------

// resolveMachines advances every machine (id order), then spawns this
// turn's arrivals and tops up the bombs.
func (g *Game) resolveMachines() {
	var gone []*machine
	for _, m := range g.machines {
		if g.guide != nil && !g.guide.live() {
			break // guide targets stand still
		}
		if m.frozen > 0 {
			m.frozen--
			g.emit(EvStall{E: "stall", S: StMachines, ID: m.id, Lane: m.lane, Pos: m.pos, Frozen: m.frozen})
			continue
		}
		m.age++
		if m.age%m.def.Every != 0 {
			continue
		}
		to := m.pos - m.def.Speed
		if to < 0 {
			g.wall = max(0, g.wall-m.def.Dmg)
			g.emit(EvWall{E: "wall", S: StMachines, ID: m.id, Kind: m.kind, Lane: m.lane, From: m.pos, Dmg: m.def.Dmg, Wall: g.wall})
			gone = append(gone, m)
			continue
		}
		g.emit(EvAdvance{E: "advance", S: StMachines, ID: m.id, Kind: m.kind, Lane: m.lane, From: m.pos, To: to})
		m.pos = to
	}
	g.machines = slices.DeleteFunc(g.machines, func(m *machine) bool { return slices.Contains(gone, m) })
	g.spawnRound(g.round, StMachines)
	g.topUpBombs(StMachines)
}
