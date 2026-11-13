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
	Name   string `json:"name"`
	Desc   string `json:"desc"`
	Team   bool   `json:"team,omitempty"` // the effect is for the whole team (applied at once)
	Max    int    `json:"-"`              // stack cap (0 = none)
	Amount int    `json:"-"`
}

const perkOffer = 3

var perkOrder = []string{"strong_arm", "light_feet", "long_reach", "quick_hands", "mason"}

var perkDefs = func() map[string]*PerkDef {
	m := map[string]*PerkDef{
		"strong_arm":  {Name: "Strong Arm", Max: 1, Amount: 6},
		"light_feet":  {Name: "Light Feet", Max: 1, Amount: 1},
		"long_reach":  {Name: "Long Reach", Max: 1, Amount: 2},
		"quick_hands": {Name: "Quick Hands", Max: 1},
		"mason":       {Name: "Mason", Team: true, Amount: 1},
	}
	m["strong_arm"].Desc = fmt.Sprintf("You throw up to %d cells instead of 4.", m["strong_arm"].Amount)
	m["light_feet"].Desc = fmt.Sprintf("You move %d cell further, carrying or not.", m["light_feet"].Amount)
	m["long_reach"].Desc = fmt.Sprintf("You pick up bombs from up to %d cells away.", m["long_reach"].Amount)
	m["quick_hands"].Desc = "Load a catapult and fire it in the same action."
	m["mason"].Desc = fmt.Sprintf("The wall gets %d hit points back (up to its maximum). One Mason per break for the whole team.", m["mason"].Amount)
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
	if has(p, "light_feet") {
		a.Move += Defs.Perks["light_feet"].Amount
		a.MoveCarry += Defs.Perks["light_feet"].Amount
	}
	if has(p, "strong_arm") {
		a.Throw = max(a.Throw, Defs.Perks["strong_arm"].Amount)
	}
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
		// A team perk: one pick per break. It leaves everyone else's offer
		// (they keep the other choices).
		g.wall = min(Defs.WallHP, g.wall+Defs.Perks["mason"].Amount)
		for _, o := range g.players {
			if i := slices.Index(o.offer, "mason"); i >= 0 {
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
