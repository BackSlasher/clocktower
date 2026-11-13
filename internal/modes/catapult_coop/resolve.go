package catapultcoop

import "slices"

// resolve plays out one round (docs/CATAPULT_COOP.md "Resolve order"):
//
//  1. throws fly and are caught
//  2. moves (bumps on shared destinations, swaps and blocked cells)
//  3. pick-ups, then loads (contested ones fail)
//  4. catapults fire
//  5. machines advance, the round's new machines appear, bombs are topped up
//
// The board is updated at once; the events (one batch, starting with
// `resolve`) let the TV animate it. Within a stage, events are in player
// join order (machines: id order).
func (g *Game) resolve() {
	for _, p := range g.players {
		if !p.placed {
			continue
		}
		if p.plan == nil {
			if p.missed < Defs.AwayAfter {
				p.missed++
			}
		} else {
			p.missed = 0
		}
	}
	saved := g.events
	g.events = nil
	stages := []string{StThrow, StMove, StGrab, StFire, StMachines}
	counts := make([]int, len(stages))
	mark := func(i int) { counts[i] = len(g.events) }

	g.resolveThrows()
	mark(0)
	g.resolveMoves()
	mark(1)
	fires := g.resolveGrabs()
	mark(2)
	g.resolveFires(fires)
	mark(3)
	g.resolveMachines()
	mark(4)

	hdr := EvResolve{E: "resolve", Level: g.level, Round: g.round, Stages: []StageTiming{}}
	t, prev := Defs.ResolveBase/2, 0
	for i, s := range stages {
		if counts[i] > prev {
			hdr.Stages = append(hdr.Stages, StageTiming{S: s, At: t, Dur: Defs.StageTime})
			t += Defs.StageTime
		}
		prev = counts[i]
	}
	hdr.Dur = Defs.ResolveBase + Defs.StageTime*float64(len(hdr.Stages))
	batch := g.events
	g.events = append(append(saved, hdr), batch...)

	g.rounds++
	g.phase = PhaseResolve
	g.left = hdr.Dur
	for _, p := range g.players {
		p.plan = nil
	}
	g.slowVer++
}

func planned(p *player, a string) bool { return p.placed && p.plan != nil && p.plan.A == a }

func xyOf(pl *Plan) (int, int) { return *pl.X, *pl.Y }

// --- 1. throws ---------------------------------------------------------------------

// resolveThrows: every thrower lets go at once, so a thrower can catch in the
// same stage. In player order, each bomb is caught by the engineer standing
// on the target cell if their hands are empty at that point, else lands there
// (or, if that cell is not floor or already has a bomb, on the nearest free
// floor cell).
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
		x, y := xyOf(f.p.plan)
		f.p.st.throws++
		ev := EvThrow{E: "throw", S: StThrow, PID: f.p.id, Bomb: f.b.ID, Kind: f.b.Kind,
			From: [2]int{f.p.x, f.p.y}, To: [2]int{x, y}}
		if c := g.engineerAt(x, y); c != nil && c.carry == nil {
			c.carry = f.b
			c.st.catches++
			ev.Result, ev.By, ev.At = "caught", c.id, [2]int{x, y}
		} else {
			lx, ly := g.landCell(x, y)
			g.bombs = append(g.bombs, &bomb{id: f.b.ID, kind: f.b.Kind, x: lx, y: ly})
			ev.Result, ev.At = "landed", [2]int{lx, ly}
		}
		g.emit(ev)
	}
}

// landCell is where a bomb thrown at (x, y) comes to rest: (x, y) itself if
// it is floor without a bomb, else the nearest such cell by Manhattan
// distance (ties: smaller y, then smaller x).
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
// succeed, and so do rotations of three or more.
func (g *Game) resolveMoves() {
	const (
		unknown = iota
		ok
		bump
	)
	var movers []*player
	status := map[*player]int{}
	claims := map[[2]int]int{}
	for _, p := range g.players {
		if planned(p, AMove) {
			movers = append(movers, p)
			x, y := xyOf(p.plan)
			claims[[2]int{x, y}]++
		}
	}
	dest := func(p *player) [2]int { x, y := xyOf(p.plan); return [2]int{x, y} }
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
			d := dest(p)
			o := g.engineerAt(d[0], d[1])
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
	type mv struct {
		p        *player
		from, to [2]int
	}
	var done []mv
	for _, p := range movers {
		d := dest(p)
		ev := EvMove{E: "move", S: StMove, PID: p.id, From: [2]int{p.x, p.y}, To: d, Path: slices.Clone(p.plan.Path), Result: "ok"}
		if status[p] == bump {
			ev.Result = "bump"
			p.st.bumps++
		} else {
			done = append(done, mv{p, ev.From, d})
			p.st.steps += len(p.plan.Path)
		}
		g.emit(ev)
	}
	// Positions change only after every outcome is known (engineerAt above
	// relies on the start-of-round board).
	for _, m := range done {
		m.p.x, m.p.y = m.to[0], m.to[1]
	}
}

// --- 3. pick-ups and loads ------------------------------------------------------------

// resolveGrabs: pick-ups first (each fails if the picker's hands are full —
// they caught a throw — or if another engineer planned to pick up the same
// cell), then loads (fail if another engineer loads the same catapult). It
// returns the Quick Hands loaders whose load succeeded and who asked to fire.
func (g *Game) resolveGrabs() []*player {
	claims := map[[2]int]int{}
	for _, p := range g.players {
		if planned(p, APickup) {
			x, y := xyOf(p.plan)
			claims[[2]int{x, y}]++
		}
	}
	for _, p := range g.players {
		if !planned(p, APickup) {
			continue
		}
		x, y := xyOf(p.plan)
		b := g.bombAt(x, y)
		ev := EvPickup{E: "pickup", S: StGrab, PID: p.id, At: [2]int{x, y}}
		if b != nil {
			ev.Bomb, ev.Kind = b.id, b.kind
		}
		switch {
		case p.carry != nil:
			ev.Result = "hands_full"
		case claims[[2]int{x, y}] > 1:
			ev.Result = "contested"
		case b == nil:
			ev.Result = "gone"
		default:
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
			loads[*p.plan.Cat]++
		}
	}
	var fire []*player
	for _, p := range g.players {
		if !planned(p, ALoad) {
			continue
		}
		c := *p.plan.Cat
		ev := EvLoad{E: "load", S: StGrab, PID: p.id, Cat: c}
		if p.carry != nil {
			ev.Bomb, ev.Kind = p.carry.ID, p.carry.Kind
		}
		switch {
		case p.carry == nil:
			ev.Result = "empty_hands"
		case loads[c] > 1:
			ev.Result = "contested"
		case g.cats[c] != nil:
			ev.Result = "full"
		default:
			ev.Result = "ok"
			g.cats[c] = p.carry
			p.carry = nil
			p.st.loads++
			if p.plan.Fire {
				fire = append(fire, p)
			}
		}
		g.emit(ev)
	}
	return fire
}

// --- 4. fires -------------------------------------------------------------------------

// resolveFires fires, in player order, every planned fire plus the Quick
// Hands loads. A catapult fires once; a later fire on it finds it empty.
func (g *Game) resolveFires(quick []*player) {
	for _, p := range g.players {
		var c int
		switch {
		case planned(p, AFire):
			c = *p.plan.Cat
		case slices.Contains(quick, p):
			c = *p.plan.Cat
		default:
			continue
		}
		ev := EvFire{E: "fire", S: StFire, PID: p.id, Cat: c, Lane: g.keep.Catapults[c].Lane, Hits: []Hit{}}
		b := g.cats[c]
		if b == nil {
			ev.Result = "empty"
			g.emit(ev)
			continue
		}
		g.cats[c] = nil
		p.st.fires++
		ev.Bomb, ev.Kind = b.ID, b.Kind
		ev.Hits = g.blast(p, ev.Lane, b.Kind)
		ev.Result = "ok"
		if len(ev.Hits) == 0 {
			ev.Result = "wasted"
		}
		g.emit(ev)
	}
}

// blast applies a bomb of kind to a lane and removes destroyed machines.
func (g *Game) blast(p *player, lane int, kind string) []Hit {
	def := Defs.Bombs[kind]
	var in []*machine
	for _, m := range g.machines {
		if m.lane == lane {
			in = append(in, m)
		}
	}
	if len(in) == 0 {
		return []Hit{}
	}
	switch kind {
	case "keg":
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
			p.st.dmg += h.Dmg
		}
		if def.Freeze > 0 {
			m.frozen = max(m.frozen, def.Freeze)
		}
		h.HP, h.Frozen = max(0, m.hp), m.frozen
		if m.hp <= 0 {
			h.Killed, h.Frozen = true, 0
			p.st.kills++
		}
		hits = append(hits, h)
	}
	g.machines = slices.DeleteFunc(g.machines, func(m *machine) bool { return m.hp <= 0 })
	return hits
}

// --- 5. machines ----------------------------------------------------------------------

// resolveMachines advances every machine (id order), then spawns this
// round's arrivals and tops up the bombs.
func (g *Game) resolveMachines() {
	var gone []*machine
	for _, m := range g.machines {
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
