package all

import (
	"testing"

	"clocktower/internal/mode"
)

func ids(r *mode.Registry) []string {
	var out []string
	for _, i := range r.List() {
		out = append(out, i.ID)
	}
	return out
}

// The stub mode is registered only on request, and always after the real mode.
func TestStubOnlyWhenAsked(t *testing.T) {
	off := mode.NewRegistry()
	RegisterTo(off, false)
	if got := ids(off); len(got) != 1 || got[0] != "tower_defense" {
		t.Fatalf("default registry: %v", got)
	}
	on := mode.NewRegistry()
	RegisterTo(on, true)
	if got := ids(on); len(got) != 2 || got[0] != "tower_defense" || got[1] != "stub" {
		t.Fatalf("with stub: %v", got)
	}
	if m, _ := on.Get("stub"); m.Name != "Stub" || m.Tagline != "Test mode — does nothing" {
		t.Fatalf("stub info: %+v", m.Info)
	}
}

// Register (the default path used without -stub-mode) never adds the stub.
func TestDefaultRegisterHasNoStub(t *testing.T) {
	Register()
	if _, ok := mode.Get("stub"); ok {
		t.Fatal("stub registered by default")
	}
	if _, ok := mode.Get("tower_defense"); !ok {
		t.Fatal("tower_defense missing")
	}
}

// The work-in-progress modes come after the product modes and only on request.
func TestWIPModesOrder(t *testing.T) {
	r := mode.NewRegistry()
	RegisterTo(r, false)
	RegisterWIPTo(r)
	if got := ids(r); len(got) != 2 || got[0] != "tower_defense" || got[1] != "catapult_coop" {
		t.Fatalf("with wip: %v", got)
	}
	if m, _ := r.Get("catapult_coop"); m.Name != "Hold the Keep" || m.Tagline != "Pass the powder, man the catapults" {
		t.Fatalf("catapult_coop info: %+v", m.Info)
	}
	if _, ok := mode.Get("catapult_coop"); ok {
		t.Fatal("catapult_coop registered by default")
	}
}
