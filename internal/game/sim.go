package game

import (
	"cmp"
	"fmt"
	"maps"
	"math"
	"slices"
)

// Step advances the simulation by dt seconds. It does nothing outside the
// build/wave phases or while no player is connected (the game pauses).
func (g *Game) Step(dt float64) {
	if !g.Running() || g.ConnectedCount() == 0 || dt <= 0 {
		return
	}
	g.time += dt
	for _, p := range g.players {
		p.windBudget = math.Min(Defs.MaxTapsPerSec, p.windBudget+Defs.MaxTapsPerSec*dt)
	}
	for _, t := range g.towers {
		if t != nil {
			t.tension = math.Max(0, t.tension-Defs.TensionDecay*decayMul(g.player(t.owner))*dt)
		}
	}
	switch g.phase {
	case PhaseBuild:
		g.buildLeft -= dt
		if g.buildLeft <= 0 {
			g.startWave()
		}
	case PhaseWave:
		g.stepWave(dt)
	}
}

func (g *Game) startWave() {
	wd := Defs.WaveDefs[g.wave-1]
	g.phase = PhaseWave
	g.buildLeft = 0
	g.waveTime = 0
	n := max(1, g.ConnectedCount())
	playerMul := 1 + Defs.HPPerPlayer*float64(n-1)
	g.waveHPMul = wd.HPMul * playerMul
	g.spawns = g.spawns[:0]
	for _, gr := range wd.Groups {
		for i := 0; i < gr.N; i++ {
			at := gr.Delay + float64(i)*gr.Interval
			if i > 0 {
				at += (g.rng.Float64() - 0.5) * 0.2 * gr.Interval
			}
			mul := wd.HPMul
			if gr.HPMul > 0 {
				mul = gr.HPMul
			}
			g.spawns = append(g.spawns, spawn{at: at, kind: gr.Kind, path: gr.Paths[i%len(gr.Paths)], hpMul: mul * playerMul})
		}
	}
	slices.SortStableFunc(g.spawns, func(a, b spawn) int { return cmp.Compare(a.at, b.at) })
	for _, p := range g.players {
		p.ready = false
	}
	g.emit(EvWaveStart{E: "wave_start", Wave: g.wave})
	g.slowVer++
}

func (g *Game) addEnemy(kind string, path int, d, hpMul float64) *enemy {
	def := Defs.Enemies[kind]
	hp := def.HP * hpMul
	e := &enemy{id: g.nextEID, kind: kind, kindIdx: slices.Index(Defs.EnemyOrder, kind), def: def,
		path: path, dist: d, hp: hp, max: hp}
	g.nextEID++
	g.enemies = append(g.enemies, e)
	g.byID[e.id] = e
	return e
}

func (g *Game) enemyPos(e *enemy) (float64, float64) { return Map.Paths[e.path].PosAt(e.dist) }

func (g *Game) effSpeed(e *enemy) float64 { return e.def.Speed * (1 - e.slow) }

func (g *Game) stepWave(dt float64) {
	g.waveTime += dt

	// Spawns.
	for len(g.spawns) > 0 && g.spawns[0].at <= g.waveTime {
		s := g.spawns[0]
		g.spawns = g.spawns[1:]
		g.addEnemy(s.kind, s.path, 0, s.hpMul)
	}

	// Chrono slows: strongest wins, bosses at half strength.
	for _, e := range g.enemies {
		e.slow, e.repaired = 0, false
	}
	for _, t := range g.towers {
		if t == nil || t.kind != "chrono" {
			continue
		}
		lv := t.level()
		r := g.towerRange(t) * (1 + Defs.WindRangeBonus*t.tension)
		slow := chronoSlow(g.player(t.owner), lv.Slow)
		pl := Map.Plots[t.plot]
		t.aim = math.Mod(g.time*1.5, 2*math.Pi) // pendulum swing, cosmetic
		for _, e := range g.enemies {
			x, y := g.enemyPos(e)
			if dist(x, y, pl.X, pl.Y) <= r {
				s := slow
				if e.def.Boss {
					s /= 2
				}
				e.slow = math.Max(e.slow, s)
			}
		}
	}

	// Tinker repairs.
	for _, tk := range g.enemies {
		if tk.def.Repair <= 0 {
			continue
		}
		tx, ty := g.enemyPos(tk)
		for _, e := range g.enemies {
			if e == tk || e.hp >= e.max {
				continue
			}
			x, y := g.enemyPos(e)
			if dist(x, y, tx, ty) <= tk.def.RepairRange {
				e.hp = math.Min(e.max, e.hp+tk.def.Repair*g.waveHPMul*dt)
				e.repaired = true
			}
		}
	}

	// Movement and leaks.
	for _, e := range g.enemies {
		e.dist += g.effSpeed(e) * dt
		if e.dist >= Map.Paths[e.path].Len() {
			e.dead = true
			g.lives = max(0, g.lives-e.def.Lives)
			g.emit(EvLeak{E: "leak", ID: e.id, Kind: e.kind, Lives: e.def.Lives})
		}
	}
	g.sweep()
	if g.lives <= 0 {
		g.finish(false)
		return
	}

	// Delayed hits land.
	keep := g.hits[:0]
	for _, h := range g.hits {
		if h.at > g.time {
			keep = append(keep, h)
			continue
		}
		g.land(h)
	}
	g.hits = keep

	// Towers fire.
	for _, t := range g.towers {
		if t == nil || t.kind == "chrono" {
			continue
		}
		t.cooldown -= dt * (1 + Defs.WindBonus*t.tension)
		if t.cooldown > 0 {
			continue
		}
		target := g.pickTarget(t)
		if target == nil {
			t.cooldown = 0
			continue
		}
		t.cooldown += 1 / t.level().Rate
		g.fire(t, target)
	}
	g.sweep()

	if len(g.spawns) == 0 && len(g.enemies) == 0 {
		g.waveCleared()
	}
}

// sweep removes dead enemies.
func (g *Game) sweep() {
	g.enemies = slices.DeleteFunc(g.enemies, func(e *enemy) bool {
		if e.dead {
			delete(g.byID, e.id)
		}
		return e.dead
	})
}

// towerRange is the tower's base radius including its owner's perks (chrono
// tension widens it further in stepWave).
func (g *Game) towerRange(t *tower) float64 { return t.level().Range * rangeMul(g.player(t.owner)) }

// pickTarget returns the enemy in range closest to the clock tower ("first").
func (g *Game) pickTarget(t *tower) *enemy {
	pl := Map.Plots[t.plot]
	r := g.towerRange(t)
	var best *enemy
	bestLeft := math.Inf(1)
	for _, e := range g.enemies {
		if e.dead || (e.def.Flying && t.def.GroundOnly) {
			continue
		}
		x, y := g.enemyPos(e)
		if dist(x, y, pl.X, pl.Y) > r {
			continue
		}
		left := Map.Paths[e.path].Len() - e.dist
		if left < bestLeft {
			best, bestLeft = e, left
		}
	}
	return best
}

func (g *Game) fire(t *tower, target *enemy) {
	pl := Map.Plots[t.plot]
	lv := t.level()
	owner := g.player(t.owner)
	dmg := lv.Dmg * dmgMul(owner, t.kind)
	switch t.kind {
	case "tesla":
		ids := []int{target.id}
		x, y := g.enemyPos(target)
		pts := []Point{{pl.X, pl.Y}, {round(x, 0.1), round(y, 0.1)}}
		hit := []*enemy{target}
		t.aim = math.Atan2(y-pl.Y, x-pl.X)
		for len(hit) < lv.Chains+extraChains(owner) {
			var next *enemy
			bd := t.def.ChainRange
			for _, e := range g.enemies {
				if e.dead || slices.Contains(hit, e) {
					continue
				}
				ex, ey := g.enemyPos(e)
				if d := dist(ex, ey, x, y); d <= bd {
					next, bd = e, d
				}
			}
			if next == nil {
				break
			}
			hit = append(hit, next)
			x, y = g.enemyPos(next)
			ids = append(ids, next.id)
			pts = append(pts, Point{round(x, 0.1), round(y, 0.1)})
		}
		g.emit(EvChain{E: "chain", Plot: t.plot, IDs: ids, Pts: pts})
		for _, e := range hit {
			g.damage(e, dmg, true, t.owner)
		}
	default: // rivet, mortar: delayed projectile at the predicted position
		x, y := g.enemyPos(target)
		travel := t.def.ShotTravel
		if travel == 0 {
			travel = dist(pl.X, pl.Y, x, y) / t.def.ShotSpeed
		}
		path := Map.Paths[target.path]
		x, y = path.PosAt(math.Min(path.Len(), target.dist+g.effSpeed(target)*travel))
		x, y = round(x, 0.1), round(y, 0.1)
		t.aim = math.Atan2(y-pl.Y, x-pl.X)
		travel = round(travel, 0.01)
		g.emit(EvShot{E: "shot", Plot: t.plot, Kind: t.kind, To: target.id, X: x, Y: y, Travel: travel})
		g.hits = append(g.hits, pendingHit{at: g.time + travel, towerK: t.kind, owner: t.owner, target: target.id,
			x: x, y: y, dmg: dmg, splash: lv.Splash * splashMul(owner), pierce: t.def.IgnoresArmor, hitsAir: !t.def.GroundOnly})
	}
}

func (g *Game) land(h pendingHit) {
	if h.splash > 0 {
		for _, e := range g.enemies {
			if e.dead || (e.def.Flying && !h.hitsAir) {
				continue
			}
			x, y := g.enemyPos(e)
			if dist(x, y, h.x, h.y) <= h.splash+e.def.Radius*0.5 {
				g.damage(e, h.dmg, h.pierce, h.owner)
			}
		}
		return
	}
	if e := g.byID[h.target]; e != nil && !e.dead {
		g.damage(e, h.dmg, h.pierce, h.owner)
	}
}

// damage applies one hit, crediting the tower's owner.
func (g *Game) damage(e *enemy, dmg float64, pierce bool, owner string) {
	if e.dead {
		return
	}
	d := dmg
	if !pierce {
		d = math.Max(dmg-e.def.Armor, dmg*Defs.MinDmgFrac)
	}
	d = math.Min(d, e.hp)
	e.hp -= d
	o := g.player(owner)
	if o != nil {
		o.st.dmg += d
	}
	if e.hp > 1e-6 {
		return
	}
	e.dead = true
	if o != nil {
		o.st.kills++
	}
	x, y := g.enemyPos(e)
	g.pay(float64(e.def.Bounty), true)
	g.emit(EvDie{E: "die", ID: e.id, Kind: e.kind, X: round(x, 0.1), Y: round(y, 0.1), Bounty: e.def.Bounty})
}

// payAll splits cogs equally among the earners (active players, see
// earners); returns each share.
func (g *Game) payAll(total float64) float64 { return g.pay(total, false) }

// pay splits total among the earners. For kill bounties (salvage), each
// earner also gets their Salvage Rights bonus on top of their share: new cogs,
// not taken from teammates.
func (g *Game) pay(total float64, salvage bool) float64 {
	conn := g.earners()
	if len(conn) == 0 {
		conn = g.players
	}
	if len(conn) == 0 {
		return 0
	}
	share := total / float64(len(conn))
	for _, p := range conn {
		p.purse += share
		if salvage {
			p.purse += share * (bountyMul(p) - 1)
		}
	}
	return share
}

func (g *Game) waveCleared() {
	wd := Defs.WaveDefs[g.wave-1]
	share := g.payAll(float64(wd.Bonus))
	g.emit(EvWaveClear{E: "wave_clear", Wave: g.wave, Bonus: int(math.Round(share))})
	g.hits = g.hits[:0]
	if g.wave >= Defs.Waves {
		g.finish(true)
		return
	}
	if offersAfter(g.wave) {
		g.makeOffers()
	}
	g.wave++
	g.phase = PhaseBuild
	g.buildLeft = Defs.BuildTime
	for _, p := range g.players {
		p.ready = false
	}
	g.slowVer++
}

func (g *Game) finish(won bool) {
	if won {
		g.phase = PhaseWon
	} else {
		g.phase = PhaseLost
	}
	g.spawns = nil
	g.hits = nil
	g.end = &End{Won: won, Wave: g.wave, Time: round(g.time, 0.1), Stats: map[string]StatsOut{}, Awards: g.awards()}
	for _, p := range g.players {
		so := p.st.out()
		so.Perks = maps.Clone(p.perks)
		g.end.Stats[p.id] = so
	}
	g.slowVer++
}

func (s stats) out() StatsOut {
	return StatsOut{Kills: s.kills, Dmg: int(math.Round(s.dmg)), Spent: s.spent, Winds: s.winds, Built: s.built, Gifted: s.gifted}
}

func (g *Game) awards() []Award {
	type aw struct {
		title  string
		val    func(s StatsOut) int
		detail string
	}
	list := []aw{
		{"Top Gun", func(s StatsOut) int { return s.Kills }, "%d kills"},
		{"Chief Winder", func(s StatsOut) int { return s.Winds }, "%d cranks"},
		{"Heavy Hitter", func(s StatsOut) int { return s.Dmg }, "%d damage"},
		{"Architect", func(s StatsOut) int { return s.Built }, "%d towers built"},
		{"Big Spender", func(s StatsOut) int { return s.Spent }, "%d cogs spent"},
		{"Philanthropist", func(s StatsOut) int { return s.Gifted }, "%d cogs gifted"},
	}
	out := []Award{}
	for _, a := range list {
		var best *player
		bv := 0
		for _, p := range g.players {
			if v := a.val(p.st.out()); v > bv {
				best, bv = p, v
			}
		}
		if best != nil {
			out = append(out, Award{PID: best.id, Title: a.title, Detail: fmt.Sprintf(a.detail, bv)})
		}
	}
	return append(out, g.perkAwards()...)
}

// perkAwards: Specialist (most picks of one perk, at least 2) and Bargain
// Hunter (most cogs saved by discounts and free towers).
func (g *Game) perkAwards() []Award {
	var out []Award
	var spec *player
	specID, specN := "", 1
	for _, p := range g.players {
		for _, id := range Defs.PerkOrder {
			if n := p.perks[id]; n > specN {
				spec, specID, specN = p, id, n
			}
		}
	}
	if spec != nil {
		out = append(out, Award{PID: spec.id, Title: "Specialist", Detail: fmt.Sprintf("%d× %s", specN, Defs.Perks[specID].Name)})
	}
	var thrift *player
	saved := 0
	for _, p := range g.players {
		if p.st.saved > saved {
			thrift, saved = p, p.st.saved
		}
	}
	if thrift != nil {
		out = append(out, Award{PID: thrift.id, Title: "Bargain Hunter", Detail: fmt.Sprintf("%d cogs saved", saved)})
	}
	return out
}
