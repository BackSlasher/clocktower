// Package bot is a scripted Clocktower player used by the balance harness
// and by cmd/ctbot. It only sees what a real client sees (room + snap) and
// only produces protocol commands.
package bot

import (
	"math"
	"math/rand/v2"
	"slices"
	"sort"

	"clocktower/internal/game"
)

// Skill selects a policy.
type Skill int

const (
	// Good builds on strong plots with a sensible mix, upgrades and winds.
	Good Skill = iota
	// Bad builds random towers on random plots, never upgrades, never winds.
	Bad
)

// ParseSkill maps "good"/"bad" to a Skill.
func ParseSkill(s string) (Skill, bool) {
	switch s {
	case "good":
		return Good, true
	case "bad":
		return Bad, true
	}
	return Good, false
}

// Bot is one scripted player.
type Bot struct {
	ID         string
	Skill      Skill
	TapsPerSec float64 // winding speed (Good only)
	ReadyDelay float64 // seconds into a build phase before readying up; <0 = never ready

	rng        *rand.Rand
	nextAct    float64
	lastWind   float64
	tapAcc     float64
	windPlot   int
	buildStart float64
	buildWave  int
	lastPhase  game.Phase
}

// New creates a bot for player id.
func New(id string, skill Skill, seed uint64) *Bot {
	return &Bot{ID: id, Skill: skill, TapsPerSec: 3, ReadyDelay: 4, rng: rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15)), windPlot: -1}
}

// plot quality per tower kind: on-screen path length within level-1 range.
var plotScore = func() map[string][]float64 {
	m := map[string][]float64{}
	for kind, def := range game.Defs.Towers {
		sc := make([]float64, len(game.Map.Plots))
		for i, pl := range game.Map.Plots {
			for _, p := range game.Map.Paths {
				c := p.CoverLen(pl.X, pl.Y, def.Levels[0].Range, game.Map.W, game.Map.H)
				// weight the later (closer to the tower) part of the town a bit higher
				sc[i] += c
			}
		}
		m[kind] = sc
	}
	return m
}()

// Act returns the commands to send now. now is a monotonically increasing
// clock in seconds; call it ~10 times per second with the latest state.
func (b *Bot) Act(now float64, room *game.RoomMsg, s *game.Snap) []game.Cmd {
	if room == nil || s == nil || (room.Phase != game.PhaseBuild && room.Phase != game.PhaseWave) {
		b.lastPhase = ""
		return nil
	}
	var out []game.Cmd
	if room.Phase == game.PhaseBuild && (b.lastPhase != game.PhaseBuild || b.buildWave != room.Wave) {
		b.buildStart, b.buildWave = now, room.Wave
		b.nextAct = now + 0.5 + b.rng.Float64()
	}
	b.lastPhase = room.Phase

	purse := s.Purses[b.ID]
	towers := map[int]game.TowerSnap{}
	for _, t := range s.Towers {
		towers[t.Plot] = t
	}

	if now >= b.nextAct {
		b.nextAct = now + 0.4 + 0.4*b.rng.Float64()
		c, want, ok := b.decide(room.Wave, purse, towers)
		if ok {
			out = append(out, c)
		} else if g, ok := b.pool(s.Purses, purse, want); ok {
			out = append(out, g)
		} else if room.Phase == game.PhaseBuild && b.ReadyDelay >= 0 && now-b.buildStart >= b.ReadyDelay && !b.isReady(room) {
			out = append(out, game.Cmd{T: "ready", Ready: game.BoolP(true)})
		}
	}

	if b.Skill == Good && len(towers) > 0 {
		b.tapAcc += b.TapsPerSec * math.Max(0, math.Min(3, now-b.lastWind))
		b.lastWind = now
		if t, ok := towers[b.windPlot]; !ok || t.Tension > 0.92 {
			b.windPlot = b.pickWind(s.Towers)
		}
		if n := int(b.tapAcc); n >= 1 && b.windPlot >= 0 {
			b.tapAcc -= float64(n)
			out = append(out, game.Cmd{T: "wind", Plot: game.IntP(b.windPlot), N: game.IntP(n)})
		}
	} else {
		b.lastWind = now
	}
	return out
}

func (b *Bot) isReady(room *game.RoomMsg) bool {
	for _, p := range room.Players {
		if p.ID == b.ID {
			return p.Ready
		}
	}
	return false
}

// pickWind chooses a low-tension damage tower, spreading bots out randomly.
func (b *Bot) pickWind(ts []game.TowerSnap) int {
	type cand struct {
		plot int
		key  float64
	}
	var cs []cand
	for _, t := range ts {
		w := float64(t.Spent)
		if t.Kind == "chrono" {
			w *= 0.3
		}
		cs = append(cs, cand{t.Plot, t.Tension - w/2000})
	}
	if len(cs) == 0 {
		return -1
	}
	sort.Slice(cs, func(i, j int) bool { return cs[i].key < cs[j].key })
	k := min(3, len(cs))
	return cs[b.rng.IntN(k)].plot
}

// decide picks a build/upgrade. If it is saving up instead, want is the cost
// it is saving for.
func (b *Bot) decide(wave, purse int, towers map[int]game.TowerSnap) (c game.Cmd, want int, ok bool) {
	if b.Skill == Bad {
		c, ok = b.decideBad(purse, towers)
		return c, 0, ok
	}
	return b.decideGood(wave, purse, towers)
}

// pool gifts our cogs to the richest teammate when neither of us can afford
// what the team is saving for, so split income still buys big towers.
func (b *Bot) pool(purses map[string]int, purse, want int) (game.Cmd, bool) {
	if b.Skill != Good || want <= purse || purse < 10 {
		return game.Cmd{}, false
	}
	rich, rp := "", -1
	for id, p := range purses {
		if p > rp || (p == rp && id < rich) {
			rich, rp = id, p
		}
	}
	if rich == "" || rich == b.ID || rp >= want || rp+purse > want+60 {
		return game.Cmd{}, false
	}
	return game.Cmd{T: "gift", To: rich, Amount: game.IntP(purse)}, true
}

func (b *Bot) decideBad(purse int, towers map[int]game.TowerSnap) (game.Cmd, bool) {
	kind := game.Defs.TowerOrder[b.rng.IntN(len(game.Defs.TowerOrder))]
	cost := game.Defs.Towers[kind].Levels[0].Cost
	if purse < cost {
		return game.Cmd{}, false
	}
	var free []int
	for _, pl := range game.Map.Plots {
		if _, ok := towers[pl.ID]; !ok {
			free = append(free, pl.ID)
		}
	}
	if len(free) == 0 {
		return game.Cmd{}, false
	}
	return game.Cmd{T: "build", Plot: game.IntP(free[b.rng.IntN(len(free))]), Kind: kind}, true
}

// desiredTowers is how many towers the team wants before it starts upgrading.
func desiredTowers(wave int) int { return min(len(game.Map.Plots), 4+wave) }

func (b *Bot) nextKind(wave int, towers map[int]game.TowerSnap) string {
	count := map[string]int{}
	for _, t := range towers {
		count[t.Kind]++
	}
	n := len(towers)
	switch {
	case n < 4:
		return "rivet"
	case count["mortar"] == 0 && wave >= 2:
		return "mortar"
	case count["tesla"] == 0 && wave >= 3:
		return "tesla"
	case count["chrono"] < 2 && n >= 7:
		return "chrono"
	}
	want := map[string]float64{"rivet": 0.4, "mortar": 0.3, "tesla": 0.3}
	best, bd := "rivet", math.Inf(-1)
	for _, k := range []string{"rivet", "mortar", "tesla"} {
		d := want[k]*float64(n+1) - float64(count[k])
		if d > bd {
			best, bd = k, d
		}
	}
	return best
}

func (b *Bot) decideGood(wave, purse int, towers map[int]game.TowerSnap) (game.Cmd, int, bool) {
	if len(towers) < desiredTowers(wave) {
		kind := b.nextKind(wave, towers)
		if cost := game.Defs.Towers[kind].Levels[0].Cost; purse < cost {
			return game.Cmd{}, cost, false // save up
		}
		sc := plotScore[kind]
		var free []int
		for _, pl := range game.Map.Plots {
			if _, ok := towers[pl.ID]; !ok {
				free = append(free, pl.ID)
			}
		}
		if len(free) > 0 {
			slices.SortFunc(free, func(a, c int) int {
				if sc[a] > sc[c] {
					return -1
				} else if sc[a] < sc[c] {
					return 1
				}
				return a - c
			})
			pick := free[b.rng.IntN(min(2, len(free)))]
			return game.Cmd{T: "build", Plot: game.IntP(pick), Kind: kind}, 0, true
		}
	}
	// Upgrade: cheapest-level, best-placed tower we can afford next.
	type cand struct {
		plot int
		cost int
		key  float64
	}
	var cs []cand
	for _, t := range towers {
		def := game.Defs.Towers[t.Kind]
		if t.Lvl >= len(def.Levels) {
			continue
		}
		key := float64(t.Lvl)*1000 - plotScore[t.Kind][t.Plot]
		if t.Kind == "chrono" {
			key += 1500
		}
		cs = append(cs, cand{t.Plot, def.Levels[t.Lvl].Cost, key})
	}
	if len(cs) == 0 {
		return game.Cmd{}, 0, false
	}
	slices.SortFunc(cs, func(a, c cand) int {
		if a.key < c.key {
			return -1
		} else if a.key > c.key {
			return 1
		}
		return a.plot - c.plot
	})
	if purse < cs[0].cost {
		return game.Cmd{}, cs[0].cost, false
	}
	return game.Cmd{T: "upgrade", Plot: game.IntP(cs[0].plot)}, 0, true
}
