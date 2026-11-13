package catapultcoop

import (
	"fmt"
	"slices"
)

// Perks: at the start of every break between levels each connected player is
// offered three perks and may keep one. All perk numbers live here; the
// descriptions are generated from them.

// PerkDef describes a perk. Only Name, Desc and Team go to clients.
type PerkDef struct {
	Name string `json:"name"`
	Desc string `json:"desc"`
	Team bool   `json:"team,omitempty"` // the effect is for the whole team (applied at once)
	Max  int    `json:"-"`              // stack cap (0 = none)
	// TeamMax caps how many engineers of the team may hold it (0 = no cap).
	// Once the cap is reached it is offered to nobody else and leaves the
	// other open offers.
	TeamMax int `json:"-"`
	Amount  int `json:"-"`
}

const perkOffer = 3

var perkOrder = []string{"long_reach", "quick_hands", "heavy_keg", "long_stop", "wide_shot", "mason"}

var perkDefs = func() map[string]*PerkDef {
	m := map[string]*PerkDef{
		"long_reach":  {Name: "Long Reach", Max: 1, Amount: 2, TeamMax: 2},
		"quick_hands": {Name: "Quick Hands", Max: 1, TeamMax: 1},
		"heavy_keg":   {Name: "Heavy Keg", Max: 1, Amount: 1, TeamMax: 1},
		"long_stop":   {Name: "Long Stop", Max: 1, Amount: 1, TeamMax: 1},
		"wide_shot":   {Name: "Wide Shot", Max: 1, Amount: 1, TeamMax: 1},
		"mason":       {Name: "Mason", Team: true, Amount: 2, TeamMax: 1},
	}
	m["long_reach"].Desc = fmt.Sprintf("You pick up bombs from up to %d cells away. At most %d engineers in the team can have it.", m["long_reach"].Amount, m["long_reach"].TeamMax)
	one := " Only one engineer in the team can have it."
	m["quick_hands"].Desc = "Load a catapult and fire it in the same action." + one
	m["heavy_keg"].Desc = fmt.Sprintf("Powder kegs you fire deal %d more damage.", m["heavy_keg"].Amount) + one
	m["long_stop"].Desc = fmt.Sprintf("Stopwatches you fire make machines skip %d more move.", m["long_stop"].Amount) + one
	m["wide_shot"].Desc = fmt.Sprintf("Grapeshot you fire deals %d more damage to the machine nearest the wall.", m["wide_shot"].Amount) + one
	m["mason"].Desc = fmt.Sprintf("The wall gets %d hit points back (up to its maximum). Only one engineer in the team can take it.", m["mason"].Amount)
	return m
}()

func has(p *player, id string) bool { return p != nil && p.perks[id] > 0 }

// Abilities is what a player's engineer can do, perks included. It is sent
// per player in the room message so clients never compute perk effects.
type Abilities struct {
	Move       int  `json:"move"`
	MoveCarry  int  `json:"moveCarry"`
	Throw      int  `json:"throw"`
	Reach      int  `json:"reach"`
	QuickHands bool `json:"quickHands"`
}

func abilities(p *player) Abilities {
	a := Abilities{Move: Defs.Move, MoveCarry: Defs.MoveCarry, Throw: Defs.ThrowRange, Reach: Defs.Reach}
	if has(p, "long_reach") {
		a.Reach = max(a.Reach, Defs.Perks["long_reach"].Amount)
	}
	a.QuickHands = has(p, "quick_hands")
	return a
}

func (g *Game) offerable(p *player, id string) bool {
	d := Defs.Perks[id]
	if d.Max > 0 && p.perks[id] >= d.Max {
		return false
	}
	if id == "mason" && g.wall >= Defs.WallHP {
		return false
	}
	if d.TeamMax > 0 && g.holders(id) >= d.TeamMax {
		return false
	}
	return true
}

// makeOffers gives every connected player three perks to choose from (fewer
// if fewer are offerable), drawn uniformly in player order from the game rng.
func (g *Game) makeOffers() {
	for _, p := range g.players {
		p.offer = nil
		if !p.connected {
			continue
		}
		var pool []string
		for _, id := range Defs.PerkOrder {
			if g.offerable(p, id) {
				pool = append(pool, id)
			}
		}
		for len(p.offer) < perkOffer && len(pool) > 0 {
			i := g.rng.IntN(len(pool))
			p.offer = append(p.offer, pool[i])
			pool = slices.Delete(pool, i, i+1)
		}
	}
	g.slowVer++
}

// Perk takes one perk from the player's offer (break phase only).
func (g *Game) Perk(pid, id string) error {
	p := g.player(pid)
	if p == nil {
		return ErrBadRequest
	}
	if g.phase != PhaseBreak {
		return badReq("No perk to choose right now")
	}
	if Defs.Perks[id] == nil {
		return badReq("No such perk")
	}
	if p.offer == nil {
		return badReq("No perk to choose right now")
	}
	if !slices.Contains(p.offer, id) {
		return badReq("That perk is not on offer")
	}
	g.stand(p)
	p.offer = nil
	p.perks[id]++
	if id == "mason" {
		g.wall = min(Defs.WallHP, g.wall+Defs.Perks["mason"].Amount)
	}
	if d := Defs.Perks[id]; d.TeamMax > 0 && g.holders(id) >= d.TeamMax {
		// The team cap is reached: it leaves everyone else's offer (they
		// keep the other choices).
		for _, o := range g.players {
			if i := slices.Index(o.offer, id); i >= 0 {
				if o.offer = slices.Delete(o.offer, i, i+1); len(o.offer) == 0 {
					o.offer = nil
				}
			}
		}
	}
	g.emit(EvPerk{E: "perk", PID: pid, ID: id, Wall: g.wall})
	g.slowVer++
	return nil
}

// holders counts the players who hold perk id.
func (g *Game) holders(id string) int {
	n := 0
	for _, p := range g.players {
		if has(p, id) {
			n++
		}
	}
	return n
}
