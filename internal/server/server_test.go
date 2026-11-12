package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"

	"clocktower/internal/modes/all"
	"clocktower/internal/room"
)

type env struct {
	t   *testing.T
	srv *httptest.Server
	reg *room.Registry
}

func newEnv(t *testing.T) *env {
	t.Helper()
	return newEnvCfg(t, room.Config{IdleTimeout: time.Minute})
}

func newEnvCfg(t *testing.T, cfg room.Config) *env {
	t.Helper()
	all.Register()
	reg := room.NewRegistry(cfg)
	web := fstest.MapFS{
		"index.html":     {Data: []byte("<p>phone</p>")},
		"tv/index.html":  {Data: []byte("<p>tv</p>")},
		"shared/net.js":  {Data: []byte("export {}")},
		"assets/a.txt":   {Data: []byte("a")},
		"shared/.secret": {Data: []byte("x")},
	}
	h, err := New(Config{}, reg, web)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	t.Cleanup(func() {
		reg.Close()
		srv.Close()
	})
	return &env{t: t, srv: srv, reg: reg}
}

type wsc struct {
	t *testing.T
	c *websocket.Conn
}

func (e *env) dial(q url.Values) *wsc {
	e.t.Helper()
	u := "ws" + strings.TrimPrefix(e.srv.URL, "http") + "/ws?" + q.Encode()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, u, nil)
	if err != nil {
		e.t.Fatal(err)
	}
	c.SetReadLimit(1 << 22)
	e.t.Cleanup(func() { c.CloseNow() })
	return &wsc{t: e.t, c: c}
}

type msg map[string]any

func (w *wsc) read() (msg, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := w.c.Read(ctx)
	if err != nil {
		return nil, err
	}
	var m msg
	if err := json.Unmarshal(data, &m); err != nil {
		w.t.Fatal(err)
	}
	return m, nil
}

// next returns the next message of type t (skipping others).
func (w *wsc) next(t string) msg {
	w.t.Helper()
	for {
		m, err := w.read()
		if err != nil {
			w.t.Fatalf("waiting for %q: %v", t, err)
		}
		if m["t"] == t {
			return m
		}
	}
}

// until reads until pred matches a message of type t.
func (w *wsc) until(t string, pred func(msg) bool) msg {
	w.t.Helper()
	for {
		m := w.next(t)
		if pred(m) {
			return m
		}
	}
}

func (w *wsc) send(v any) {
	w.t.Helper()
	b, _ := json.Marshal(v)
	if err := w.c.Write(context.Background(), websocket.MessageText, b); err != nil {
		w.t.Fatal(err)
	}
}

// closed asserts the server closes the connection (after optional messages).
func (w *wsc) closed() {
	w.t.Helper()
	for {
		if _, err := w.read(); err != nil {
			return
		}
	}
}

func q(kv ...string) url.Values {
	v := url.Values{}
	for i := 0; i < len(kv); i += 2 {
		v.Set(kv[i], kv[i+1])
	}
	return v
}

func TestRoomFlow(t *testing.T) {
	e := newEnv(t)
	tv := e.dial(q("role", "tv"))
	w := tv.next("welcome")
	code, _ := w["room"].(string)
	tvTok, _ := w["token"].(string)
	if len(code) != 4 || tvTok == "" || w["role"] != "tv" || w["you"] != nil {
		t.Fatalf("tv welcome %v", w)
	}
	if !strings.HasSuffix(w["joinUrl"].(string), "/?c="+code) || w["joinHost"] == "" || w["map"] == nil || w["defs"] == nil {
		t.Fatalf("tv welcome fields %v", w)
	}
	if r := tv.next("room"); r["phase"] != "lobby" || r["end"] != nil {
		t.Fatalf("room %v", r)
	}

	// Refusals.
	bad := e.dial(q("role", "player", "room", "ZZZZ", "name", "X"))
	if m := bad.next("error"); m["code"] != "no_room" {
		t.Fatal(m)
	}
	bad.closed()
	bad = e.dial(q("role", "player", "room", code, "name", "   "))
	if m := bad.next("error"); m["code"] != "bad_name" {
		t.Fatal(m)
	}
	bad.closed()

	// Two players; lowercase code works.
	a := e.dial(q("role", "player", "room", strings.ToLower(code), "name", "  Ada "))
	wa := a.next("welcome")
	if wa["you"] != "p1" || wa["role"] != "player" || wa["token"] == "" {
		t.Fatalf("player welcome %v", wa)
	}
	ra := a.next("room")
	if ra["host"] != "p1" {
		t.Fatalf("host %v", ra["host"])
	}
	b := e.dial(q("role", "player", "room", code, "name", "Bea"))
	wb := b.next("welcome")
	tokB := wb["token"].(string)
	tv.until("room", func(m msg) bool { return len(m["players"].([]any)) == 2 })

	// Error codes.
	b.send(map[string]any{"t": "start"})
	if m := b.next("error"); m["code"] != "not_host" {
		t.Fatal(m)
	}
	b.send(map[string]any{"t": "ping"})
	b.next("pong")
	b.send(map[string]any{"t": "no_such_thing"}) // ignored
	b.send("garbage")
	if m := b.next("error"); m["code"] != "bad_request" {
		t.Fatal(m)
	}
	a.send(map[string]any{"t": "start"})
	tv.until("room", func(m msg) bool { return m["phase"] == "build" })
	r := a.until("room", func(m msg) bool { return m["phase"] == "build" })
	if nw, _ := r["nextWave"].([]any); len(nw) == 0 {
		t.Fatalf("no wave preview %v", r)
	}
	s := tv.next("snap")
	if s["phase"] != "build" || s["purses"].(map[string]any)["p1"] != 160.0 {
		t.Fatalf("snap %v", s)
	}
	a.send(map[string]any{"t": "build", "plot": 99, "kind": "rivet"})
	if m := a.next("error"); m["code"] != "bad_request" {
		t.Fatal(m)
	}
	a.send(map[string]any{"t": "build", "plot": 1.5, "kind": "rivet"})
	if m := a.next("error"); m["code"] != "bad_request" {
		t.Fatal(m)
	}
	a.send(map[string]any{"t": "build", "plot": 3, "kind": "tesla"})
	a.send(map[string]any{"t": "build", "plot": 3, "kind": "tesla"})
	if m := a.next("error"); m["code"] != "occupied" {
		t.Fatal(m)
	}
	b.send(map[string]any{"t": "sell", "plot": 3})
	if m := b.next("error"); m["code"] != "not_owner" {
		t.Fatal(m)
	}
	b.send(map[string]any{"t": "gift", "to": "p1", "amount": 0})
	if m := b.next("error"); m["code"] != "bad_request" {
		t.Fatal(m)
	}
	b.send(map[string]any{"t": "gift", "to": "p1", "amount": 10000})
	if m := b.next("error"); m["code"] != "poor" {
		t.Fatal(m)
	}
	b.send(map[string]any{"t": "wind", "plot": 3, "n": 3})
	tv.until("snap", func(m msg) bool {
		for _, ev := range m["ev"].([]any) {
			if ev.(map[string]any)["e"] == "wind" {
				return true
			}
		}
		return false
	})

	// Host migration: p1 leaves, p2 becomes host.
	a.c.Close(websocket.StatusNormalClosure, "")
	tv.until("room", func(m msg) bool { return m["host"] == "p2" })

	// Resume by token: same player, name ignored; old connection replaced.
	b2 := e.dial(q("role", "player", "room", code, "name", "Other", "token", tokB))
	if w := b2.next("welcome"); w["you"] != "p2" || w["token"] != tokB {
		t.Fatalf("resume %v", w)
	}
	b.closed()
	rm := b2.next("room")
	for _, p := range rm["players"].([]any) {
		pm := p.(map[string]any)
		if pm["id"] == "p2" && (pm["name"] != "Bea" || pm["connected"] != true) {
			t.Fatalf("resumed player %v", pm)
		}
	}
	b2.next("snap") // mid-game joiners get a snap right away

	// TV resume keeps the room; a bad token makes a new one.
	tv.c.Close(websocket.StatusNormalClosure, "")
	tv2 := e.dial(q("role", "tv", "room", code, "token", tvTok))
	if w := tv2.next("welcome"); w["room"] != code {
		t.Fatalf("tv resume %v", w)
	}
	tv3 := e.dial(q("role", "tv", "room", code, "token", "nope"))
	if w := tv3.next("welcome"); w["room"] == code {
		t.Fatal("bad TV token should create a new room")
	}
}

func TestRoomFull(t *testing.T) {
	e := newEnv(t)
	tv := e.dial(q("role", "tv"))
	code := tv.next("welcome")["room"].(string)
	for i := 0; i < 8; i++ {
		p := e.dial(q("role", "player", "room", code, "name", "P"+string(rune('A'+i))))
		p.next("welcome")
	}
	p := e.dial(q("role", "player", "room", code, "name", "Nine"))
	if m := p.next("error"); m["code"] != "room_full" {
		t.Fatal(m)
	}
	p.closed()
}

func TestHardening(t *testing.T) {
	e := newEnv(t)
	tv := e.dial(q("role", "tv"))
	code := tv.next("welcome")["room"].(string)

	// Oversized frames are refused by closing the connection.
	p := e.dial(q("role", "player", "room", code, "name", "Big"))
	p.next("welcome")
	_ = p.c.Write(context.Background(), websocket.MessageText, []byte(`{"t":"ping","pad":"`+strings.Repeat("x", 5000)+`"}`))
	p.closed()

	// Flooding gets dropped, then disconnected.
	f := e.dial(q("role", "player", "room", code, "name", "Flood"))
	f.next("welcome")
	for i := 0; i < 400; i++ {
		if f.c.Write(context.Background(), websocket.MessageText, []byte(`{"t":"nothing"}`)) != nil {
			break
		}
	}
	f.closed()

	// Cross-origin websocket upgrades are refused.
	req, _ := http.NewRequest("GET", e.srv.URL+"/ws?role=tv", nil)
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin: %d", resp.StatusCode)
	}
	// Same origin is fine.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(e.srv.URL, "http")+"/ws?role=tv",
		&websocket.DialOptions{HTTPHeader: http.Header{"Origin": {e.srv.URL}}})
	if err != nil {
		t.Fatalf("same-origin dial: %v", err)
	}
	c.CloseNow()
}

func TestHTTPRoutes(t *testing.T) {
	e := newEnv(t)
	get := func(path string, hdr ...string) *http.Response {
		req, _ := http.NewRequest("GET", e.srv.URL+path, nil)
		for i := 0; i < len(hdr); i += 2 {
			req.Header.Set(hdr[i], hdr[i+1])
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp
	}
	for path, want := range map[string]int{"/": 200, "/?c=ABCD": 200, "/tv": 200, "/healthz": 200, "/shared/net.js": 200,
		"/assets/a.txt": 200, "/nope": 404, "/shared/.secret": 404, "/qr.svg?room=ABCD": 200, "/qr.svg?room=1": 400,
		"/shared/../../go.mod": 404} {
		if got := get(path).StatusCode; got != want {
			t.Errorf("GET %s = %d, want %d", path, got, want)
		}
	}
	if ct := get("/qr.svg?room=ABCD").Header.Get("Content-Type"); ct != "image/svg+xml" {
		t.Errorf("qr content type %q", ct)
	}
	r := get("/shared/net.js")
	if r.Header.Get("Cache-Control") != "no-cache" || r.Header.Get("ETag") == "" {
		t.Errorf("cache headers %v", r.Header)
	}
	if get("/shared/net.js", "If-None-Match", r.Header.Get("ETag")).StatusCode != http.StatusNotModified {
		t.Error("ETag revalidation")
	}
}

func TestBaseURL(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest("GET", "http://lan:8080/qr.svg", nil)
	if b, h := s.baseURL(req); b != "http://lan:8080" || h != "lan:8080" {
		t.Errorf("plain: %s %s", b, h)
	}
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "ct.example.com")
	if b, h := s.baseURL(req); b != "https://ct.example.com" || h != "ct.example.com" {
		t.Errorf("forwarded: %s %s", b, h)
	}
	req.Header.Set("X-Forwarded-Host", "evil\"><script>")
	if b, _ := s.baseURL(req); b != "https://lan:8080" {
		t.Errorf("bad forwarded host not ignored: %s", b)
	}
	s2, err := New(Config{BaseURL: "https://play.example.org/"}, nil, fstest.MapFS{})
	if err != nil {
		t.Fatal(err)
	}
	if b, h := s2.baseURL(req); b != "https://play.example.org" || h != "play.example.org" {
		t.Errorf("configured: %s %s", b, h)
	}
	svg, err := qrSVG("https://play.example.org/?c=ABCD")
	if err != nil || !strings.HasPrefix(string(svg), "<svg") {
		t.Fatal("qr svg")
	}
}

func TestRoomExpiry(t *testing.T) {
	reg := room.NewRegistry(room.Config{IdleTimeout: 300 * time.Millisecond})
	h, _ := New(Config{}, reg, fstest.MapFS{})
	srv := httptest.NewServer(h)
	defer func() { reg.Close(); srv.Close() }()
	e := &env{t: t, srv: srv, reg: reg}
	tv := e.dial(q("role", "tv"))
	code := tv.next("welcome")["room"].(string)
	p := e.dial(q("role", "player", "room", code, "name", "Solo"))
	p.next("welcome")
	time.Sleep(500 * time.Millisecond)
	if !reg.Exists(code) {
		t.Fatal("room with connections expired")
	}
	tv.c.Close(websocket.StatusNormalClosure, "")
	p.c.Close(websocket.StatusNormalClosure, "")
	deadline := time.Now().Add(3 * time.Second)
	for reg.Exists(code) && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if reg.Exists(code) {
		t.Fatal("idle room was not dropped")
	}
	late := e.dial(q("role", "player", "room", code, "name", "Late"))
	if m := late.next("error"); m["code"] != "no_room" {
		t.Fatal(m)
	}
}

// TestPerkOverWebsocket: after wave 1 a player finds an offer in `room`, takes
// one with a `perk` message, and everyone sees the pick.
func TestPerkOverWebsocket(t *testing.T) {
	e := newEnvCfg(t, room.Config{IdleTimeout: time.Minute, Speed: 40})
	tv := e.dial(q("role", "tv"))
	w := tv.next("welcome")
	code := w["room"].(string)
	defs := w["defs"].(map[string]any)
	if len(defs["perkOrder"].([]any)) == 0 || len(defs["perks"].(map[string]any)) == 0 {
		t.Fatal("defs without perks")
	}
	a := e.dial(q("role", "player", "room", code, "name", "Ada"))
	a.next("welcome")
	r := a.next("room")
	p0 := r["players"].([]any)[0].(map[string]any)
	if p0["offer"] != nil || p0["perks"] == nil {
		t.Fatalf("lobby player %v", p0)
	}
	a.send(map[string]any{"t": "perk", "id": "sights"})
	if m := a.next("error"); m["code"] != "bad_request" {
		t.Fatal(m)
	}
	a.send(map[string]any{"t": "start"})
	a.until("room", func(m msg) bool { return m["phase"] == "build" })
	a.send(map[string]any{"t": "ready", "ready": true})
	var offer []any
	a.until("room", func(m msg) bool {
		p := m["players"].([]any)[0].(map[string]any)
		offer, _ = p["offer"].([]any)
		return len(offer) == 3
	})
	a.send(map[string]any{"t": "perk", "id": "no_such_perk"})
	if m := a.next("error"); m["code"] != "bad_request" {
		t.Fatal(m)
	}
	id := offer[1].(string)
	a.send(map[string]any{"t": "perk", "id": id})
	a.until("room", func(m msg) bool {
		p := m["players"].([]any)[0].(map[string]any)
		return p["offer"] == nil && p["perks"].(map[string]any)[id] == 1.0
	})
	tv.until("snap", func(m msg) bool {
		for _, ev := range m["ev"].([]any) {
			if ev := ev.(map[string]any); ev["e"] == "perk" && ev["id"] == id && ev["pid"] == "p1" {
				return true
			}
		}
		return false
	})
}
