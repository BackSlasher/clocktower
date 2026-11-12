// Package all wires every game mode into the default mode registry. The first
// mode registered here is the default for new rooms.
package all

import (
	"sync"

	towerdefense "clocktower/internal/modes/tower_defense"
)

var once sync.Once

// Register registers all modes; safe to call more than once.
func Register() {
	once.Do(func() {
		towerdefense.Register()
	})
}
