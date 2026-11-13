// Package all wires every game mode into the default mode registry. The first
// mode registered here is the default for new rooms.
package all

import (
	"sync"

	"clocktower/internal/mode"
	catapultcoop "clocktower/internal/modes/catapult_coop"
	"clocktower/internal/modes/stub"
	towerdefense "clocktower/internal/modes/tower_defense"
)

var once, stubOnce, wipOnce sync.Once

// RegisterTo registers the product modes in r, plus the dev-only stub mode
// when withStub is set. The stub always comes after the real modes.
func RegisterTo(r *mode.Registry, withStub bool) {
	towerdefense.RegisterTo(r)
	if withStub {
		stub.RegisterTo(r)
	}
}

// RegisterWIPTo registers the work-in-progress modes (the server's
// -wip-modes flag) in r: catapult_coop. Call it after RegisterTo's product
// modes and before the stub.
func RegisterWIPTo(r *mode.Registry) {
	catapultcoop.RegisterTo(r)
}

// RegisterWIP additionally registers the work-in-progress modes in the
// default registry, after the product modes; safe to call more than once.
func RegisterWIP() {
	Register()
	wipOnce.Do(func() { RegisterWIPTo(mode.Default) })
}

// Register registers all product modes; safe to call more than once.
func Register() {
	once.Do(func() { towerdefense.Register() })
}

// RegisterStub additionally registers the dev-only stub mode (the server's
// -stub-mode flag). It registers the product modes first if needed.
func RegisterStub() {
	Register()
	stubOnce.Do(stub.Register)
}
