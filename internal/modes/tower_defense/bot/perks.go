package bot

import (
	"math"
	"slices"
	"strings"

	game "clocktower/internal/modes/tower_defense"
)

// Perk-picking knobs.
const (
	casualPerkMin    = 3.0  // a casual player reads the cards for this long...
	casualPerkSpan   = 12.0 // ...plus up to this much
	casualPerkForget = 0.15 // chance it never gets round to picking this offer
	goodPerkDelay    = 1.0
	badPerkDelay     = 2.0
)

// perkChoice notices new offers and, when the bot's delay is up, returns the
// pick. Idle bots and NoPerks bots never pick.
func (b *Bot) perkChoice(now float64, room *game.RoomMsg, s *game.Snap) (game.Cmd, bool) {
	if b.NoPerks || b.Skill == Idle || b.me == nil || len(b.me.Offer) == 0 {
		b.offerKey = ""
		return game.Cmd{}, false
	}
	if key := strings.Join(b.me.Offer, ","); key != b.offerKey {
		b.offerKey = key
		switch b.Skill {
		case Casual:
			b.pickAt = now + casualPerkMin + casualPerkSpan*b.rng.Float64()
			if b.rng.Float64() < casualPerkForget {
				b.pickAt = -1
			}
		case Good:
			b.pickAt = now + goodPerkDelay
		default:
			b.pickAt = now + badPerkDelay
		}
	}
	if b.pickAt < 0 || now < b.pickAt {
		return game.Cmd{}, false
	}
	b.pickAt = -1 // one attempt per offer
	var id string
	if b.Skill == Good {
		id = b.bestPerk(room, s)
	} else {
		id = b.me.Offer[b.rng.IntN(len(b.me.Offer))] // casual, bad: whatever looks fun
	}
	return game.Cmd{T: "perk", ID: id}, true
}

// bestPerk scores the offer by what suits the bot's own towers and the state
// of the game.
func (b *Bot) bestPerk(room *game.RoomMsg, s *game.Snap) string {
	spent := map[string]float64{}
	total := 0.0
	for _, t := range s.Towers {
		if t.Owner == b.ID {
			spent[t.Kind] += float64(t.Spent) + 30 // free towers still count
			total += float64(t.Spent) + 30
		}
	}
	share := func(kind string) float64 {
		if total == 0 {
			if kind == "rivet" {
				return 0.5 // what we will build first
			}
			return 0.15
		}
		return spent[kind] / total
	}
	wind := 1.0
	if b.NoWind {
		wind = 0
	}
	early := math.Max(0, float64(10-room.Wave)) / 10 // 0.9 after wave 1 → 0 by wave 10
	score := map[string]float64{
		"hot_rivets":     3 * share("rivet"),
		"big_shells":     1.6 * share("mortar"),
		"capacitor":      2.6 * share("tesla"),
		"heavy_pendulum": 2.2 * share("chrono"),
		"sights":         1.4,
		"overwound":      1.2 * wind,
		"strong_arm":     0.9 * wind,
		"bulk_discount":  0.4 + 1.4*early,
		"master_fitter":  0.9 + 0.6*early,
		"salvage":        0.3 + 1.6*early,
		"windfall":       0.9,
		"free_sample":    1.1,
		"clock_repair":   float64(game.Defs.MaxLives-s.Lives) / 3,
	}
	return slices.MaxFunc(b.me.Offer, func(x, y string) int {
		sx, sy := score[x], score[y]
		switch {
		case sx < sy:
			return -1
		case sx > sy:
			return 1
		}
		return strings.Compare(y, x)
	})
}
