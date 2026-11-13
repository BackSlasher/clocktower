package mode

import (
	"fmt"
	"sync"
)

// Mode is a registered mode.
type Mode struct {
	Info
	New Factory
}

// Registry is an ordered set of modes. The first registered is the default.
type Registry struct {
	mu    sync.RWMutex
	modes []*Mode
}

// NewRegistry returns an empty registry (tests; production uses Default).
func NewRegistry() *Registry { return &Registry{} }

// Default is the process-wide registry used by the package-level functions.
var Default = NewRegistry()

// Register adds a mode. It panics on an empty or duplicate id or a nil factory.
func (r *Registry) Register(info Info, f Factory) {
	if info.ID == "" || f == nil {
		panic("mode: Register needs an id and a factory")
	}
	if info.MinPlayers == 0 {
		info.MinPlayers = 1
	}
	if info.MaxPlayers == 0 {
		info.MaxPlayers = 8
	}
	if info.MinPlayers < 1 || info.MaxPlayers < info.MinPlayers {
		panic(fmt.Sprintf("mode: %q has bad player limits %d–%d", info.ID, info.MinPlayers, info.MaxPlayers))
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range r.modes {
		if m.ID == info.ID {
			panic(fmt.Sprintf("mode: %q registered twice", info.ID))
		}
	}
	r.modes = append(r.modes, &Mode{Info: info, New: f})
}

// List returns the registered modes' info in registration order.
func (r *Registry) List() []Info {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Info, len(r.modes))
	for i, m := range r.modes {
		out[i] = m.Info
	}
	return out
}

// Get looks a mode up by id.
func (r *Registry) Get(id string) (*Mode, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, m := range r.modes {
		if m.ID == id {
			return m, true
		}
	}
	return nil, false
}

// Package-level helpers on Default.

func Register(info Info, f Factory) { Default.Register(info, f) }
func List() []Info                  { return Default.List() }
func Get(id string) (*Mode, bool)   { return Default.Get(id) }
