package bot

import (
	"slices"

	game "clocktower/internal/modes/catapult_coop"
)

// The planner looks ahead within a turn: after deciding slot k for everyone
// it simulates that slot (the server's rules, simplified: the planner never
// plans conflicting moves or grabs) and plans slot k+1 on the result.
// Machines do not move between slots, so only the board changes.

func cloneSnap(s *game.Snap) *game.Snap {
	c := *s
	c.Engineers = slices.Clone(s.Engineers)
	for i, e := range c.Engineers {
		if e.Carry != nil {
			b := *e.Carry
			c.Engineers[i].Carry = &b
		}
	}
	c.Bombs = slices.Clone(s.Bombs)
	c.Catapults = slices.Clone(s.Catapults)
	c.Machines = slices.Clone(s.Machines)
	c.Ev = nil
	return &c
}

// simulate returns the board after one slot of decs.
func simulate(l *game.Layout, keep *game.Keep, s *game.Snap, decs map[string]dec) *game.Snap {
	n := cloneSnap(s)
	engAt := func(x, y int) int {
		for i, e := range n.Engineers {
			if e.X == x && e.Y == y {
				return i
			}
		}
		return -1
	}
	bombAt := func(x, y int) int {
		return slices.IndexFunc(n.Bombs, func(b game.BombSnap) bool { return b.X == x && b.Y == y })
	}
	order := func(a string) []int {
		var out []int
		for i, e := range n.Engineers {
			if d, ok := decs[e.PID]; ok && d.A == a {
				out = append(out, i)
			}
		}
		return out
	}
	// 1. throws: release all, then fly in order.
	type flight struct {
		i int
		b game.BombRef
	}
	var fl []flight
	for _, i := range order(game.AThrow) {
		if c := n.Engineers[i].Carry; c != nil {
			fl = append(fl, flight{i, *c})
			n.Engineers[i].Carry = nil
		}
	}
	for _, f := range fl {
		e := n.Engineers[f.i]
		d := decs[e.PID]
		line := l.ThrowLine(e.X, e.Y, d.DX, d.DY, game.Defs.ThrowRange)
		to, ok := l.Landing(line)
		if !ok {
			continue
		}
		stop := -1
		for _, c := range line {
			if j := engAt(c[0], c[1]); j >= 0 {
				stop = j
				break
			}
		}
		if stop >= 0 && n.Engineers[stop].Carry == nil {
			b := f.b
			n.Engineers[stop].Carry = &b
			continue
		}
		if stop >= 0 {
			to = [2]int{n.Engineers[stop].X, n.Engineers[stop].Y}
		}
		x, y := landCell(l, to[0], to[1], func(x, y int) bool { return bombAt(x, y) >= 0 })
		n.Bombs = append(n.Bombs, game.BombSnap{ID: f.b.ID, Kind: f.b.Kind, X: x, Y: y})
	}
	// 2. moves (the planner avoids conflicts; a move into a cell someone
	// stays on is dropped).
	var moved [][3]int
	for _, i := range order(game.AMove) {
		d := decs[n.Engineers[i].PID]
		if j := engAt(d.X, d.Y); j >= 0 {
			if dj, ok := decs[n.Engineers[j].PID]; !ok || dj.A != game.AMove {
				continue
			}
		}
		moved = append(moved, [3]int{i, d.X, d.Y})
	}
	for _, m := range moved {
		n.Engineers[m[0]].X, n.Engineers[m[0]].Y = m[1], m[2]
	}
	// 3. pick-ups, then loads.
	for _, i := range order(game.APickup) {
		d := decs[n.Engineers[i].PID]
		if k := bombAt(d.X, d.Y); k >= 0 && n.Engineers[i].Carry == nil {
			b := n.Bombs[k]
			n.Engineers[i].Carry = &game.BombRef{ID: b.ID, Kind: b.Kind}
			n.Bombs = slices.Delete(n.Bombs, k, k+1)
		}
	}
	for _, i := range order(game.ALoad) {
		d := decs[n.Engineers[i].PID]
		if c := n.Engineers[i].Carry; c != nil && n.Catapults[d.Cat].Bomb == nil {
			b := *c
			n.Catapults[d.Cat].Bomb = &b
			n.Engineers[i].Carry = nil
		}
	}
	// 4. fires.
	for _, i := range order(game.AFire) {
		d := decs[n.Engineers[i].PID]
		b := n.Catapults[d.Cat].Bomb
		if b == nil {
			continue
		}
		n.Catapults[d.Cat].Bomb = nil
		blast(n, keep.Catapults[d.Cat].Lane, b.Kind)
	}
	return n
}

func blast(s *game.Snap, lane int, kind string) {
	def := game.Defs.Bombs[kind]
	near := -1
	for i, m := range s.Machines {
		if m.Lane == lane && (near < 0 || m.Pos < s.Machines[near].Pos) {
			near = i
		}
	}
	for i := range s.Machines {
		m := &s.Machines[i]
		if m.Lane != lane || kind == "keg" && i != near {
			continue
		}
		m.HP -= def.Dmg
		if def.Freeze > 0 {
			m.Frozen = max(m.Frozen, def.Freeze)
		}
	}
	s.Machines = slices.DeleteFunc(s.Machines, func(m game.MachineSnap) bool { return m.HP <= 0 })
}

// landCell mirrors the server: (x, y) if it is floor without a bomb, else the
// nearest such cell (ties: smaller y, then smaller x).
func landCell(l *game.Layout, x, y int, hasBomb func(x, y int) bool) (int, int) {
	free := func(cx, cy int) bool { return l.At(cx, cy).Kind == game.KFloor && !hasBomb(cx, cy) }
	if free(x, y) {
		return x, y
	}
	for d := 1; d < l.W+l.H; d++ {
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
	return x, y
}
