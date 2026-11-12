package bot

import (
	"math"
	"slices"

	game "clocktower/internal/modes/tower_defense"
)

// Casual policy knobs. They describe a first-time player holding a phone in a
// living room, not an optimiser; see Casual.
const (
	casualReactMin   = 1.0  // seconds before acting on something new...
	casualReactSpan  = 1.5  // ...plus up to this much
	casualMenuMin    = 1.5  // seconds between menu actions (tap plot, pick, confirm)
	casualMenuSpan   = 1.5  //
	casualDither     = 0.35 // chance a menu decision is "not now" (talking, looking at the TV)
	casualBurstMin   = 4.0  // a winding burst lasts this long...
	casualBurstSpan  = 5.0  //
	casualPauseMin   = 5.0  // ...then the phone is down for this long
	casualPauseSpan  = 5.0  //
	casualTapsMin    = 1.6  // taps/s while cranking
	casualTapsSpan   = 0.8  //
	casualTopPlots   = 6    // picks among the N best free plots for the kind
	casualBuildBias  = 0.65 // chance to build rather than upgrade while short of towers
	casualNeverReady = 0.3  // chance it never taps Ready in a build phase
	casualSettle     = 0.02 // per decision, chance to settle for a rivet when saving up
)

func (b *Bot) actCasual(now float64, room *game.RoomMsg, s *game.Snap) []game.Cmd {
	var out []game.Cmd
	newBuild := room.Phase == game.PhaseBuild && (b.lastPhase != game.PhaseBuild || b.buildWave != room.Wave)
	if newBuild {
		b.buildStart, b.buildWave = now, room.Wave
		b.nextAct = now + casualReactMin + casualReactSpan*b.rng.Float64()
		b.crankUntil, b.crankNext = 0, 0
		b.readyAt = -1
		if b.rng.Float64() >= casualNeverReady {
			b.readyAt = now + 6 + 12*b.rng.Float64()
		}
	}
	if room.Phase == game.PhaseWave && b.lastPhase != game.PhaseWave {
		// The wave just started: notice it, then reach for the crank.
		b.crankNext = now + casualReactMin + casualReactSpan*b.rng.Float64()
	}
	b.lastPhase = room.Phase
	b.watch(s)

	towers := map[int]game.TowerSnap{}
	for _, t := range s.Towers {
		towers[t.Plot] = t
	}

	// Winding bursts during waves; the menu is not used while cranking.
	cranking := now < b.crankUntil
	if room.Phase == game.PhaseWave && !cranking && now >= b.crankNext && len(towers) > 0 {
		if plot := b.pickHotTower(s); plot >= 0 {
			b.windPlot = plot
			b.crankUntil = now + casualBurstMin + casualBurstSpan*b.rng.Float64()
			b.crankNext = b.crankUntil + casualPauseMin + casualPauseSpan*b.rng.Float64()
			b.crankRate = casualTapsMin + casualTapsSpan*b.rng.Float64()
			b.lastWind, b.tapAcc = now, 0
			cranking = true
		} else {
			b.crankNext = now + 1 // nothing near a tower yet; look again soon
		}
	}
	if cranking {
		b.tapAcc += b.crankRate * math.Max(0, math.Min(1, now-b.lastWind))
		b.lastWind = now
		if t, ok := towers[b.windPlot]; !ok || t.Tension > 0.95 {
			if plot := b.pickHotTower(s); plot >= 0 && plot != b.windPlot {
				b.windPlot = plot
				b.tapAcc = 0 // switching towers costs a moment
			}
		}
		if n := int(b.tapAcc); n >= 1 && b.windPlot >= 0 && !b.NoWind {
			b.tapAcc -= float64(n)
			out = append(out, game.Cmd{T: "wind", Plot: game.IntP(b.windPlot), N: game.IntP(n)})
		}
		return out
	}

	// Perk cards are picked from the same menu, between other actions.
	if c, ok := b.perkChoice(now, room, s); ok {
		b.nextAct = math.Max(b.nextAct, now+casualMenuMin)
		return append(out, c)
	}
	if now >= b.nextAct {
		b.nextAct = now + casualMenuMin + casualMenuSpan*b.rng.Float64()
		if b.rng.Float64() >= casualDither {
			if c, ok := b.decideCasual(room.Wave, s.Purses[b.ID], towers); ok {
				return append(out, c)
			}
		}
	}
	if room.Phase == game.PhaseBuild && b.readyAt >= 0 && now >= b.readyAt && !b.isReady(room) {
		out = append(out, game.Cmd{T: "ready", Ready: game.BoolP(true)})
	}
	return out
}

// pathCover[kind][plot][path] is how much of the on-screen path lies within
// the kind's level-1 range of the plot.
var pathCover = func() map[string][][]float64 {
	m := map[string][][]float64{}
	for kind, def := range game.Defs.Towers {
		pc := make([][]float64, len(game.Map.Plots))
		for i, pl := range game.Map.Plots {
			pc[i] = make([]float64, len(game.Map.Paths))
			for j, p := range game.Map.Paths {
				pc[i][j] = p.CoverLen(pl.X, pl.Y, def.Levels[0].Range, game.Map.W, game.Map.H)
			}
		}
		m[kind] = pc
	}
	return m
}()

// watch keeps a fading tally of which streets enemies have been seen on, the
// way a player notices "they're all coming down Foundry Street".
func (b *Bot) watch(s *game.Snap) {
	if b.pathSeen == nil {
		b.pathSeen = make([]float64, len(game.Map.Paths))
	}
	for i := range b.pathSeen {
		b.pathSeen[i] *= 0.999
	}
	for _, e := range s.Enemies {
		b.pathSeen[int(e[2])] += 0.01
	}
}

// casualPlotScores rates plots for kind by coverage, favouring the streets
// where enemies have been seen (all streets equally before the first wave)
// and, mildly, streets the team has not covered yet.
func (b *Bot) casualPlotScores(kind string, towers map[int]game.TowerSnap) []float64 {
	have := make([]float64, len(game.Map.Paths))
	for _, t := range towers {
		for j, c := range pathCover[t.Kind][t.Plot] {
			have[j] += c
		}
	}
	total := 0.0
	for _, v := range b.pathSeen {
		total += v
	}
	sc := make([]float64, len(game.Map.Plots))
	for i, pc := range pathCover[kind] {
		for j, c := range pc {
			w := 1.0
			if total > 0 {
				w = 0.3 + 2*b.pathSeen[j]/total
			}
			sc[i] += c * w / (1 + have[j]/1200)
		}
	}
	return sc
}

// pickHotTower returns a tower with enemies in range (damage towers first),
// choosing loosely among the busiest, or -1 if no tower has any.
func (b *Bot) pickHotTower(s *game.Snap) int {
	type cand struct {
		plot int
		n    float64
	}
	var cs []cand
	for _, t := range s.Towers {
		def := game.Defs.Towers[t.Kind]
		pl := game.Map.Plots[t.Plot]
		r := def.Levels[t.Lvl-1].Range
		if t.RangeMul > 0 {
			r *= t.RangeMul
		}
		n := 0.0
		for _, e := range s.Enemies {
			ed := game.Defs.Enemies[game.Defs.EnemyOrder[int(e[1])]]
			if ed.Flying && def.GroundOnly {
				continue
			}
			x, y := game.Map.Paths[int(e[2])].PosAt(e[3])
			if math.Hypot(x-pl.X, y-pl.Y) <= r {
				n++
			}
		}
		if n == 0 || t.Tension > 0.9 {
			continue
		}
		if t.Kind == "chrono" {
			n *= 0.5
		}
		cs = append(cs, cand{t.Plot, n})
	}
	if len(cs) == 0 {
		return -1
	}
	slices.SortFunc(cs, func(a, c cand) int {
		if a.n != c.n {
			if a.n > c.n {
				return -1
			}
			return 1
		}
		return a.plot - c.plot
	})
	return cs[b.rng.IntN(min(3, len(cs)))].plot
}

// casualKind picks a tower kind the way a newcomer does: rivets first, then
// a loose mix of whatever looks fun, without much of a plan.
func (b *Bot) casualKind(towers map[int]game.TowerSnap) string {
	count := map[string]int{}
	for _, t := range towers {
		count[t.Kind]++
	}
	if len(towers) < 3 {
		return "rivet"
	}
	w := map[string]float64{"rivet": 0.35, "mortar": 0.25, "tesla": 0.25, "chrono": 0.15}
	if count["chrono"] >= 3 {
		w["chrono"] = 0
	}
	sum := 0.0
	for _, k := range game.Defs.TowerOrder {
		sum += w[k]
	}
	x := b.rng.Float64() * sum
	for _, k := range game.Defs.TowerOrder {
		if x -= w[k]; x < 0 {
			return k
		}
	}
	return "rivet"
}

func (b *Bot) decideCasual(wave, purse int, towers map[int]game.TowerSnap) (game.Cmd, bool) {
	var free []int
	for _, pl := range game.Map.Plots {
		if _, ok := towers[pl.ID]; !ok {
			free = append(free, pl.ID)
		}
	}
	if len(free) == 0 {
		b.wantKind = ""
	}
	short := len(towers) < min(len(game.Map.Plots), 5+wave)
	if b.wantKind == "" && len(free) > 0 && (len(towers) < 3 || (short && b.rng.Float64() < casualBuildBias)) {
		b.wantKind = b.casualKind(towers)
	}
	if b.wantKind != "" {
		kind := b.wantKind
		if purse < b.price(kind, 0) {
			// Can't afford it: now and then settle for a rivet; mostly keep
			// saving, sometimes spend on an upgrade instead.
			switch r := b.rng.Float64(); {
			case purse >= b.price("rivet", 0) && r < casualSettle:
				kind = "rivet"
			case r < 0.75:
				return game.Cmd{}, false
			default:
				kind = ""
			}
		}
		if kind != "" {
			b.wantKind = ""
			sc := b.casualPlotScores(kind, towers)
			slices.SortFunc(free, func(a, c int) int {
				if sc[a] != sc[c] {
					if sc[a] > sc[c] {
						return -1
					}
					return 1
				}
				return a - c
			})
			pick := free[b.rng.IntN(min(casualTopPlots, len(free)))]
			return game.Cmd{T: "build", Plot: game.IntP(pick), Kind: kind}, true
		}
	}
	// Upgrade something affordable that looks useful (loosely: well placed,
	// low level, damage dealers before pendulums).
	type cand struct {
		plot int
		key  float64
	}
	var cs []cand
	upgradable := 0
	for _, t := range towers {
		def := game.Defs.Towers[t.Kind]
		if t.Lvl >= len(def.Levels) {
			continue
		}
		upgradable++
		if b.price(t.Kind, t.Lvl) > purse {
			continue
		}
		key := plotScore[t.Kind][t.Plot] - 300*float64(t.Lvl)
		if t.Kind == "chrono" {
			key -= 400
		}
		cs = append(cs, cand{t.Plot, key})
	}
	if len(cs) == 0 {
		// Nothing to upgrade, or plenty of cogs: plan another tower.
		if b.wantKind == "" && len(free) > 0 && (upgradable == 0 || purse >= 300) {
			b.wantKind = b.casualKind(towers)
		}
		return game.Cmd{}, false
	}
	slices.SortFunc(cs, func(a, c cand) int {
		if a.key != c.key {
			if a.key > c.key {
				return -1
			}
			return 1
		}
		return a.plot - c.plot
	})
	return game.Cmd{T: "upgrade", Plot: game.IntP(cs[b.rng.IntN(min(4, len(cs)))].plot)}, true
}
