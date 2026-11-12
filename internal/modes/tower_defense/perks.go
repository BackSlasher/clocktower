package towerdefense

import (
	"fmt"
	"math"
	"slices"
)

// Perks: after every wave but the last, each connected player is offered
// three perks and keeps one (docs/DESIGN.md "Perks"). All perk numbers live
// in this file; the player-facing descriptions are generated from them so the
// text can never drift from the effect.

// PerkDef describes a perk. Only Name, Desc and Rare go to clients.
type PerkDef struct {
	Name   string  `json:"name"`
	Desc   string  `json:"desc"`
	Rare   bool    `json:"rare"`
	Weight float64 `json:"-"` // relative chance of being drawn
	Max    int     `json:"-"` // stack cap (0 = none); a maxed perk is never offered
	Amount float64 `json:"-"` // effect per stack (meaning depends on the perk)
}

// Perk tuning knobs.
const (
	perkOffer        = 3   // perks per offer
	slowCap          = 0.7 // Heavy Pendulum never takes a slow past this (bosses get half)
	windfallBase     = 16  // Windfall: cogs...
	windfallPerWave  = 4   // ...plus this per wave cleared so far
	clockRepairLives = 3
)

// offersAfter is the perk cadence: an offer follows the clear of every odd
// wave except the last (1, 3, …, 13 — seven picks a game, the first right
// after wave 1). An unpicked offer stays open until the next one replaces it.
func offersAfter(wave int) bool { return wave%2 == 1 && wave < Defs.Waves }

// perkOrder is the display order (and the order offers are drawn in).
var perkOrder = []string{"overwound", "strong_arm", "sights", "hot_rivets", "big_shells", "capacitor",
	"heavy_pendulum", "bulk_discount", "master_fitter", "salvage", "windfall", "free_sample", "clock_repair"}

var perkDefs = func() map[string]*PerkDef {
	pct := func(v float64) int { return int(math.Round(v * 100)) }
	capTxt := func(n int) string {
		if n == 1 {
			return " Can be taken once."
		}
		return fmt.Sprintf(" Stacks up to %d times.", n)
	}
	m := map[string]*PerkDef{
		"overwound":      {Name: "Overwound Springs", Weight: 10, Max: 2, Amount: 0.15},
		"strong_arm":     {Name: "Strong Arm", Weight: 9, Max: 2, Amount: 0.2},
		"sights":         {Name: "Calibrated Sights", Weight: 10, Max: 3, Amount: 0.06},
		"hot_rivets":     {Name: "Hot Rivets", Weight: 10, Max: 3, Amount: 0.1},
		"big_shells":     {Name: "Bigger Shells", Weight: 8, Max: 2, Amount: 0.12},
		"capacitor":      {Name: "Capacitor Bank", Weight: 6, Max: 1, Amount: 1},
		"heavy_pendulum": {Name: "Heavy Pendulum", Weight: 7, Max: 2, Amount: 0.06},
		"bulk_discount":  {Name: "Bulk Discount", Weight: 9, Max: 2, Amount: 0.08},
		"master_fitter":  {Name: "Master Fitter", Weight: 9, Max: 2, Amount: 0.08},
		"salvage":        {Name: "Salvage Rights", Weight: 8, Max: 2, Amount: 0.1},
		"windfall":       {Name: "Windfall", Weight: 9},
		"free_sample":    {Name: "Free Sample", Weight: 2},
		"clock_repair":   {Name: "Clock Repair", Weight: 3, Rare: true, Amount: clockRepairLives},
	}
	d := func(id, f string, a ...any) { m[id].Desc = fmt.Sprintf(f, a...) + capTxt(m[id].Max) }
	d("overwound", "Your towers lose tension %d%% more slowly.", pct(m["overwound"].Amount))
	d("strong_arm", "Each crank tap you make adds %d%% more tension.", pct(m["strong_arm"].Amount))
	d("sights", "Your towers have %d%% more range.", pct(m["sights"].Amount))
	d("hot_rivets", "Your Rivet Guns deal %d%% more damage.", pct(m["hot_rivets"].Amount))
	d("big_shells", "Your Steam Mortars' splash radius is %d%% larger.", pct(m["big_shells"].Amount))
	d("capacitor", "Your Tesla Coils chain to 1 more target.")
	d("heavy_pendulum", "Your Chrono Pendulums slow enemies by %d more points (e.g. 30%% becomes %d%%; never past %d%%, bosses still take half).",
		pct(m["heavy_pendulum"].Amount), 30+pct(m["heavy_pendulum"].Amount), pct(slowCap))
	d("bulk_discount", "New towers cost you %d%% less.", pct(m["bulk_discount"].Amount))
	d("master_fitter", "Upgrades cost you %d%% less.", pct(m["master_fitter"].Amount))
	d("salvage", "You get %d%% more from every kill bounty (new cogs, not taken from your team).", pct(m["salvage"].Amount))
	m["windfall"].Desc = fmt.Sprintf("Get %d cogs right now, plus %d for every wave cleared so far.",
		int(windfallBase), int(windfallPerWave))
	m["free_sample"].Desc = "Your next tower is free (any kind). Each pick adds another free tower."
	m["clock_repair"].Desc = fmt.Sprintf("The Great Clock gets %d lives back (up to %d).", clockRepairLives, maxLives)
	return m
}()

// --- effects -----------------------------------------------------------------

func stacks(p *player, id string) int {
	if p == nil {
		return 0
	}
	return p.perks[id]
}

func perkAmt(id string) float64 { return Defs.Perks[id].Amount }

// decayMul scales how fast the owner's towers lose tension.
func decayMul(p *player) float64 {
	return math.Pow(1-perkAmt("overwound"), float64(stacks(p, "overwound")))
}

// crankMul scales the tension each of the winder's taps adds.
func crankMul(p *player) float64 { return 1 + perkAmt("strong_arm")*float64(stacks(p, "strong_arm")) }

// rangeMul scales the range of the owner's towers.
func rangeMul(p *player) float64 { return 1 + perkAmt("sights")*float64(stacks(p, "sights")) }

func dmgMul(p *player, kind string) float64 {
	if kind == "rivet" {
		return 1 + perkAmt("hot_rivets")*float64(stacks(p, "hot_rivets"))
	}
	return 1
}

func splashMul(p *player) float64 { return 1 + perkAmt("big_shells")*float64(stacks(p, "big_shells")) }

func extraChains(p *player) int { return int(perkAmt("capacitor")) * stacks(p, "capacitor") }

// chronoSlow is the slow of a chrono level for its owner, before the boss halving.
func chronoSlow(p *player, base float64) float64 {
	n := stacks(p, "heavy_pendulum")
	if n == 0 {
		return base
	}
	return math.Max(base, math.Min(slowCap, base+perkAmt("heavy_pendulum")*float64(n)))
}

func bountyMul(p *player) float64 { return 1 + perkAmt("salvage")*float64(stacks(p, "salvage")) }

func discounted(cost int, frac float64, n int) int {
	return int(math.Round(float64(cost) * math.Max(0, 1-frac*float64(n))))
}

// buildCost is what p pays for a new tower of def, ignoring Free Sample.
func buildCost(p *player, def *TowerDef) int {
	return discounted(def.Levels[0].Cost, perkAmt("bulk_discount"), stacks(p, "bulk_discount"))
}

// upgradeCost is what p pays to raise a tower of def to level lvl+1.
func upgradeCost(p *player, def *TowerDef, lvl int) int {
	return discounted(def.Levels[lvl].Cost, perkAmt("master_fitter"), stacks(p, "master_fitter"))
}

func windfallCogs(cleared int) int { return int(windfallBase + windfallPerWave*float64(cleared)) }

// --- offers and picks ----------------------------------------------------------

// makeOffers gives every connected player a fresh choice after a wave clear
// (see offersAfter),
// replacing any unpicked offer. Players who are not connected get nothing new
// (an older unpicked offer of theirs stays). Draws come from the game RNG in
// player order, so they are deterministic for a seed and command sequence.
func (g *Game) makeOffers() {
	for _, p := range g.players {
		if p.connected {
			p.offer = g.drawOffer(p)
		}
	}
	g.slowVer++
}

func (g *Game) offerable(p *player, id string) bool {
	d := Defs.Perks[id]
	if d.Max > 0 && p.perks[id] >= d.Max {
		return false
	}
	if id == "clock_repair" && g.lives >= Defs.MaxLives {
		return false
	}
	return true
}

func (g *Game) drawOffer(p *player) []string {
	var pool []string
	total := 0.0
	for _, id := range Defs.PerkOrder {
		if g.offerable(p, id) {
			pool = append(pool, id)
			total += Defs.Perks[id].Weight
		}
	}
	var out []string
	for len(out) < perkOffer && len(pool) > 0 {
		x := g.rng.Float64() * total
		i := 0
		for ; i < len(pool)-1; i++ {
			if x -= Defs.Perks[pool[i]].Weight; x < 0 {
				break
			}
		}
		out = append(out, pool[i])
		total -= Defs.Perks[pool[i]].Weight
		pool = slices.Delete(pool, i, i+1)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// Perk takes one perk from the player's current offer.
func (g *Game) Perk(pid, id string) error {
	p := g.player(pid)
	if p == nil || !g.Running() {
		return badReq("Not now")
	}
	if Defs.Perks[id] == nil {
		return ErrUnknownPerk
	}
	if p.offer == nil {
		return ErrNoOffer
	}
	if !slices.Contains(p.offer, id) {
		return ErrNotOffered
	}
	p.offer = nil
	p.perks[id]++
	switch id {
	case "windfall":
		// The offer came from the last clear, so waves cleared = wave − 1.
		p.purse += float64(windfallCogs(g.wave - 1))
	case "free_sample":
		p.free++
	case "clock_repair":
		g.lives = min(Defs.MaxLives, g.lives+clockRepairLives)
	}
	g.emit(EvPerk{E: "perk", PID: pid, ID: id})
	g.slowVer++
	return nil
}

// costTable is the per-kind [build, up2, up3] price list p pays, or nil when
// p has no cost perk (clients then use defs).
func costTable(p *player) map[string][3]int {
	if stacks(p, "bulk_discount") == 0 && stacks(p, "master_fitter") == 0 {
		return nil
	}
	m := make(map[string][3]int, len(Defs.Towers))
	for kind, def := range Defs.Towers {
		m[kind] = [3]int{buildCost(p, def), upgradeCost(p, def, 1), upgradeCost(p, def, 2)}
	}
	return m
}
