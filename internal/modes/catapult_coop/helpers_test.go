package catapultcoop

import (
	"errors"
	"math/rand/v2"
	"testing"
)

const dt = 1.0 / 30

// flatArt is a test keep: flat courtyard, ramparts on the top row and left
// column, stairs at both far ends, catapults 0 (3,0), 1 (6,0), 2 (0,3), 3 (0,6).
var flatArt = []string{
	"WWWCWWCWW",
	"W=======S",
	"W=.......",
	"C=.......",
	"W=.......",
	"W=.......",
	"C=.......",
	"W=.......",
	"WS......1",
}

func newGame(t *testing.T, n int) (*Game, []string) {
	t.Helper()
	g := New(rand.New(rand.NewPCG(1, 2)))
	var ids []string
	for i := 0; i < n; i++ {
		id, _, err := g.AddPlayer("P" + string(rune('A'+i)))
		if err != nil {
			t.Fatal(err)
		}
		g.SetConnected(id, true)
		ids = append(ids, id)
	}
	return g, ids
}

func started(t *testing.T, n int) (*Game, []string) {
	t.Helper()
	g, ids := newGame(t, n)
	if err := g.Start(ids[0]); err != nil {
		t.Fatal(err)
	}
	return g, ids
}

// board starts a game with n players on the flat test layout, with no bombs,
// no machines, no script and every engineer off the board, in a plan phase.
func board(t *testing.T, n int) (*Game, []string) {
	t.Helper()
	g, ids := started(t, n)
	l := parseLayout("test", flatArt)
	k := &Keep{ID: "test", MinPlayers: 1, MaxPlayers: 8, W: l.W, H: l.H, Layouts: map[string]*Layout{"test": l}}
	k.Catapults, k.Lanes = shellOf(l)
	g.keep, g.lay = k, l
	g.cats = make([]*BombRef, len(k.Catapults))
	g.bombs, g.machines, g.script, g.events = nil, nil, nil, nil
	for _, p := range g.players {
		p.placed, p.carry = false, nil
	}
	g.rounds = 1 // not the game's first turn: timed
	g.startPlan(1)
	return g, ids
}

func put(g *Game, pid string, x, y int) {
	p := g.player(pid)
	p.placed, p.x, p.y = true, x, y
}

func give(g *Game, pid, kind string) *BombRef {
	b := &BombRef{ID: g.nextBID, Kind: kind}
	g.nextBID++
	g.player(pid).carry = b
	return b
}

func ground(g *Game, x, y int, kind string) *bomb {
	b := &bomb{id: g.nextBID, kind: kind, x: x, y: y}
	g.nextBID++
	g.bombs = append(g.bombs, b)
	return b
}

func addMachine(g *Game, kind string, lane, pos int) *machine {
	def := Defs.Machines[kind]
	m := &machine{id: g.nextMID, kind: kind, def: def, lane: lane, pos: pos, hp: def.HP, max: def.HP}
	g.nextMID++
	g.machines = append(g.machines, m)
	return m
}

// q sets a player's queue directly (the phase does not end).
func q(g *Game, pid string, acts ...Act) { g.player(pid).acts = acts }

func mv(dx, dy int) Act  { return Dir(AMove, dx, dy) }
func th(dx, dy int) Act  { return Dir(AThrow, dx, dy) }
func pkd(dx, dy int) Act { return Dir(APickup, dx, dy) }

var (
	pk = Act{A: APickup}
	ld = Act{A: ALoad}
	fr = Act{A: AFire}
	wt = Act{A: AWait}
)

func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Code != code {
		t.Fatalf("want error %q, got %v", code, err)
	}
}

// run resolves the turn and returns its events (the batch).
func run(g *Game) []any {
	g.events = nil
	g.resolve()
	ev := g.events
	g.events = nil
	return ev
}

func evs[T any](ev []any) []T {
	var out []T
	for _, e := range ev {
		if v, ok := e.(T); ok {
			out = append(out, v)
		}
	}
	return out
}

func at(g *Game, pid string) [2]int {
	p := g.player(pid)
	return [2]int{p.x, p.y}
}

func steps(g *Game, secs float64) {
	for i := 0; i < int(secs/dt+0.5); i++ {
		g.Step(dt)
	}
}

// leave steps until the current phase ends (at most secs) and returns the
// new phase.
func leave(g *Game, secs float64) Phase {
	ph := g.phase
	for i := 0; i < int(secs/dt+0.5) && g.phase == ph; i++ {
		g.Step(dt)
	}
	return g.phase
}
