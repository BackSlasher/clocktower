package room_test

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"

	"clocktower/internal/mode"
	"clocktower/internal/room"
	"clocktower/internal/server"
)

// stubGame is a minimal mode.Game: a lobby of players and a "go" command that
// leaves the lobby.
type stubGame struct {
	id      string
	players []mode.Member
	next    int
	phase   mode.Phase
	slow    uint64
	steps   int
}

func newStub(id string) mode.Factory {
	return func(_ *rand.Rand, roster []mode.Member) mode.Game {
		g := &stubGame{id: id, phase: mode.PhaseLobby, next: 1, slow: 1}
		for _, m := range roster {
			g.players = append(g.players, m)
			var n int
			if _, err := fmt.Sscanf(m.ID, "p%d", &n); err == nil && n >= g.next {
				g.next = n + 1
			}
		}
		return g
	}
}

func (g *stubGame) AddPlayer(name string) (string, string, error) {
	m := mode.Member{ID: fmt.Sprintf("p%d", g.next), Name: name, Color: "#000"}
	g.next++
	g.players = append(g.players, m)
	if g.Host() == "" {
		g.players[len(g.players)-1].Host = true
	}
	g.slow++
	return m.ID, "", nil
}
func (g *stubGame) HasPlayer(pid string) bool {
	for _, p := range g.players {
		if p.ID == pid {
			return true
		}
	}
	return false
}
func (g *stubGame) SetConnected(pid string, on bool) {
	for i := range g.players {
		if g.players[i].ID == pid {
			g.players[i].Connected = on
		}
	}
	g.slow++
}
func (g *stubGame) ReservePIDs(next int) { g.next = max(g.next, next) }
func (g *stubGame) RemovePlayer(pid string) {
	for i, p := range g.players {
		if p.ID == pid {
			g.players = append(g.players[:i], g.players[i+1:]...)
			if p.Host && len(g.players) > 0 {
				g.players[0].Host = true
			}
			g.slow++
			return
		}
	}
}
func (g *stubGame) Host() string {
	for _, p := range g.players {
		if p.Host {
			return p.ID
		}
	}
	return ""
}
func (g *stubGame) Roster() []mode.Member { return append([]mode.Member(nil), g.players...) }
func (g *stubGame) Command(pid, typ string, raw []byte) error {
	switch typ {
	case "go":
		g.phase = "play"
		g.slow++
	case "restart":
		g.phase = mode.PhaseLobby
		g.slow++
	}
	return nil
}
func (g *stubGame) Step(float64)        { g.steps++ }
func (g *stubGame) Running() bool       { return g.phase == "play" }
func (g *stubGame) Phase() mode.Phase   { return g.phase }
func (g *stubGame) SlowVersion() uint64 { return g.slow }
func (g *stubGame) Setup() mode.Setup {
	return mode.Setup{Map: json.RawMessage(`{"stub":"` + g.id + `"}`), Defs: json.RawMessage(`{"d":1}`)}
}
func (g *stubGame) RoomState() any {
	type pl struct {
		ID, Name  string
		Connected bool
	}
	ps := []map[string]any{}
	for _, p := range g.players {
		ps = append(ps, map[string]any{"id": p.ID, "name": p.Name, "color": p.Color, "connected": p.Connected})
	}
	return map[string]any{"t": "room", "mode": g.id, "phase": string(g.phase), "host": g.Host(), "players": ps}
}
func (g *stubGame) Snapshot() any { return map[string]any{"t": "snap", "steps": g.steps} }
func (g *stubGame) View() any     { return g.Snapshot() }

// conn reads in a goroutine (a read timeout would close a websocket).
type conn struct {
	t   *testing.T
	c   *websocket.Conn
	in  chan map[string]any
	err error // the read error, once in is closed
}

func newConn(t *testing.T, c *websocket.Conn) *conn {
	w := &conn{t: t, c: c, in: make(chan map[string]any, 256)}
	go func() {
		defer close(w.in)
		for {
			_, data, err := c.Read(context.Background())
			if err != nil {
				w.err = err
				return
			}
			var m map[string]any
			if json.Unmarshal(data, &m) == nil {
				w.in <- m
			}
		}
	}()
	return w
}

func (w *conn) next(t string) map[string]any {
	w.t.Helper()
	timeout := time.After(5 * time.Second)
	for {
		select {
		case m, ok := <-w.in:
			if !ok {
				w.t.Fatalf("waiting for %q: closed", t)
			}
			if m["t"] == t {
				return m
			}
		case <-timeout:
			w.t.Fatalf("waiting for %q: timeout", t)
		}
	}
}

func (w *conn) send(v any) {
	w.t.Helper()
	b, _ := json.Marshal(v)
	if err := w.c.Write(context.Background(), websocket.MessageText, b); err != nil {
		w.t.Fatal(err)
	}
}

// quiet asserts nothing arrives within a short while.
func (w *conn) quiet() {
	w.t.Helper()
	select {
	case m := <-w.in:
		w.t.Fatalf("unexpected message %v", m)
	case <-time.After(150 * time.Millisecond):
	}
}

// settle discards messages until the connection has been quiet for a while.
func (w *conn) settle() {
	for {
		select {
		case <-w.in:
		case <-time.After(150 * time.Millisecond):
			return
		}
	}
}

type fixture struct {
	t    *testing.T
	srv  *httptest.Server
	base string
}

func newFixture(t *testing.T, ids ...string) *fixture {
	t.Helper()
	modes := mode.NewRegistry()
	for _, id := range ids {
		modes.Register(mode.Info{ID: id, Name: strings.ToUpper(id), Tagline: "tag " + id}, newStub(id))
	}
	reg := room.NewRegistry(room.Config{Modes: modes, IdleTimeout: time.Minute})
	h, err := server.New(server.Config{}, reg, fstest.MapFS{"index.html": {Data: []byte("x")}, "tv/index.html": {Data: []byte("x")}})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	t.Cleanup(func() { reg.Close(); srv.Close() })
	return &fixture{t: t, srv: srv, base: "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?"}
}

func (f *fixture) dial(kv ...string) *conn {
	f.t.Helper()
	v := url.Values{}
	for i := 0; i < len(kv); i += 2 {
		v.Set(kv[i], kv[i+1])
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, f.base+v.Encode(), nil)
	if err != nil {
		f.t.Fatal(err)
	}
	f.t.Cleanup(func() { c.CloseNow() })
	return newConn(f.t, c)
}

func TestWelcomeAndRoomCarryMode(t *testing.T) {
	f := newFixture(t, "alpha", "beta")
	tv := f.dial("role", "tv")
	w := tv.next("welcome")
	if w["mode"] != "alpha" {
		t.Fatalf("mode = %v", w["mode"])
	}
	want := `[{"id":"alpha","maxPlayers":8,"minPlayers":1,"name":"ALPHA","tagline":"tag alpha"},{"id":"beta","maxPlayers":8,"minPlayers":1,"name":"BETA","tagline":"tag beta"}]`
	got, _ := json.Marshal(w["modes"])
	if string(got) != want {
		t.Fatalf("modes = %s", got)
	}
	if m, _ := json.Marshal(w["map"]); string(m) != `{"stub":"alpha"}` {
		t.Fatalf("map = %s", m)
	}
	if r := tv.next("room"); r["mode"] != "alpha" {
		t.Fatalf("room = %v", r)
	}
	p := f.dial("role", "player", "room", w["room"].(string), "name", "Ann")
	if pw := p.next("welcome"); pw["mode"] != "alpha" || pw["you"] != "p1" {
		t.Fatalf("player welcome %v", pw)
	}
	if r := p.next("room"); r["mode"] != "alpha" {
		t.Fatalf("room = %v", r)
	}
}

func TestModeSwitch(t *testing.T) {
	f := newFixture(t, "alpha", "beta")
	tv := f.dial("role", "tv")
	code := tv.next("welcome")["room"].(string)
	host := f.dial("role", "player", "room", code, "name", "Ann")
	hw := host.next("welcome")
	guest := f.dial("role", "player", "room", code, "name", "Bob")
	gw := guest.next("welcome")
	host.next("room")
	guest.next("room")

	// Not the host.
	guest.send(map[string]any{"t": "mode", "id": "beta"})
	if e := guest.next("error"); e["code"] != "not_host" {
		t.Fatalf("guest: %v", e)
	}
	// Unknown id.
	host.send(map[string]any{"t": "mode", "id": "gamma"})
	if e := host.next("error"); e["code"] != "bad_request" {
		t.Fatalf("unknown: %v", e)
	}
	// Selecting the current mode is a no-op.
	tv.settle()
	host.settle()
	host.send(map[string]any{"t": "mode", "id": "alpha"})
	host.quiet()
	tv.quiet()

	// Switch: everyone, TV included, gets setup then room.
	host.send(map[string]any{"t": "mode", "id": "beta"})
	for name, c := range map[string]*conn{"tv": tv, "host": host, "guest": guest} {
		s := c.next("setup")
		if s["mode"] != "beta" {
			t.Fatalf("%s setup %v", name, s)
		}
		if m, _ := json.Marshal(s["map"]); string(m) != `{"stub":"beta"}` || s["defs"] == nil {
			t.Fatalf("%s setup map %s", name, m)
		}
		r := c.next("room")
		if r["mode"] != "beta" || r["host"] != hw["you"] {
			t.Fatalf("%s room %v", name, r)
		}
		ps := r["players"].([]any)
		if len(ps) != 2 {
			t.Fatalf("%s players %v", name, ps)
		}
		p0, p1 := ps[0].(map[string]any), ps[1].(map[string]any)
		if p0["id"] != hw["you"] || p0["name"] != "Ann" || p0["connected"] != true ||
			p1["id"] != gw["you"] || p1["name"] != "Bob" || p1["connected"] != true {
			t.Fatalf("%s players %v", name, ps)
		}
	}

	// Sessions survive: the guest reconnects with its token into the new mode.
	guest.c.CloseNow()
	g2 := f.dial("role", "player", "room", code, "token", gw["token"].(string))
	w2 := g2.next("welcome")
	if w2["you"] != gw["you"] || w2["mode"] != "beta" {
		t.Fatalf("rejoin %v", w2)
	}

	// Switch back works.
	host.send(map[string]any{"t": "mode", "id": "alpha"})
	if s := host.next("setup"); s["mode"] != "alpha" {
		t.Fatalf("back: %v", s)
	}
	if r := host.next("room"); r["mode"] != "alpha" {
		t.Fatalf("back room: %v", r)
	}
	if s := tv.next("setup"); s["mode"] != "alpha" {
		t.Fatalf("tv back: %v", s)
	}
}

func TestModeSwitchLobbyOnly(t *testing.T) {
	f := newFixture(t, "alpha", "beta")
	tv := f.dial("role", "tv")
	code := tv.next("welcome")["room"].(string)
	host := f.dial("role", "player", "room", code, "name", "Ann")
	host.next("welcome")
	host.send(map[string]any{"t": "go"}) // stub leaves the lobby
	host.until(t, func(m map[string]any) bool { return m["phase"] == "play" })
	host.send(map[string]any{"t": "mode", "id": "beta"})
	if e := host.next("error"); e["code"] != "bad_request" {
		t.Fatalf("mid-game: %v", e)
	}
}

func (w *conn) until(t *testing.T, pred func(map[string]any) bool) map[string]any {
	for {
		if m := w.next("room"); pred(m) {
			return m
		}
	}
}

func TestSingleModeSwitchIsNoOp(t *testing.T) {
	f := newFixture(t, "alpha")
	tv := f.dial("role", "tv")
	code := tv.next("welcome")["room"].(string)
	host := f.dial("role", "player", "room", code, "name", "Ann")
	host.next("welcome")
	tv.settle()
	host.settle()
	host.send(map[string]any{"t": "mode", "id": "alpha"})
	host.quiet()
	tv.quiet()
	host.send(map[string]any{"t": "mode", "id": "beta"})
	if e := host.next("error"); e["code"] != "bad_request" {
		t.Fatalf("unknown: %v", e)
	}
}
