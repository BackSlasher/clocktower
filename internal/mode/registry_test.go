package mode

import (
	"math/rand/v2"
	"testing"
)

func stub(*rand.Rand, []Member) Game { return nil }

func TestRegistry(t *testing.T) {
	r := NewRegistry()
	if len(r.List()) != 0 {
		t.Fatal("not empty")
	}
	r.Register(Info{ID: "a", Name: "A", Tagline: "ta"}, stub)
	r.Register(Info{ID: "b", Name: "B"}, stub)
	l := r.List()
	if len(l) != 2 || l[0].ID != "a" || l[1].ID != "b" || l[0].Tagline != "ta" {
		t.Fatalf("list %v", l)
	}
	if m, ok := r.Get("b"); !ok || m.Name != "B" || m.New == nil {
		t.Fatalf("get b: %v %v", m, ok)
	}
	if _, ok := r.Get("nope"); ok {
		t.Fatal("unknown id found")
	}
	// List returns a copy.
	l[0].ID = "zzz"
	if r.List()[0].ID != "a" {
		t.Fatal("List aliases registry")
	}
}

func TestRegisterPanics(t *testing.T) {
	r := NewRegistry()
	r.Register(Info{ID: "a"}, stub)
	for name, f := range map[string]func(){
		"duplicate": func() { r.Register(Info{ID: "a"}, stub) },
		"empty id":  func() { r.Register(Info{}, stub) },
		"nil":       func() { r.Register(Info{ID: "c"}, nil) },
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s: no panic", name)
				}
			}()
			f()
		}()
	}
}

func TestDefault(t *testing.T) {
	// Default is shared process state; use a unique id and leave it be.
	Register(Info{ID: "registry_test_only"}, stub)
	if _, ok := Get("registry_test_only"); !ok {
		t.Fatal("not found")
	}
	found := false
	for _, i := range List() {
		found = found || i.ID == "registry_test_only"
	}
	if !found {
		t.Fatal("not listed")
	}
}

func TestRegisterPlayerLimits(t *testing.T) {
	r := NewRegistry()
	r.Register(Info{ID: "a"}, func(*rand.Rand, []Member) Game { return nil })
	if i := r.List()[0]; i.MinPlayers != 1 || i.MaxPlayers != 8 {
		t.Fatalf("defaults %+v", i)
	}
	r.Register(Info{ID: "b", MinPlayers: 2, MaxPlayers: 4}, func(*rand.Rand, []Member) Game { return nil })
	if e := ErrTooManyPlayers(Info{Name: "B", MaxPlayers: 4}); e.Code != "too_many_players" || e.Msg != "B takes up to 4 players — remove someone first" {
		t.Fatalf("%+v", e)
	}
	defer func() {
		if recover() == nil {
			t.Fatal("bad limits should panic")
		}
	}()
	r.Register(Info{ID: "c", MinPlayers: 3, MaxPlayers: 2}, func(*rand.Rand, []Member) Game { return nil })
}
