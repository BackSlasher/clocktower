package room_test

import (
	"errors"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// closedWith waits for the server to close the connection and checks the
// close reason.
func (w *conn) closedWith(reason string) {
	w.t.Helper()
	timeout := time.After(5 * time.Second)
	for {
		select {
		case _, ok := <-w.in:
			if ok {
				continue
			}
			var ce websocket.CloseError
			if !errors.As(w.err, &ce) || ce.Reason != reason || ce.Code != websocket.StatusNormalClosure {
				w.t.Fatalf("closed with %v, want reason %q", w.err, reason)
			}
			return
		case <-timeout:
			w.t.Fatalf("waiting for close %q: timeout", reason)
		}
	}
}

func players(m map[string]any) []string {
	var out []string
	for _, p := range m["players"].([]any) {
		out = append(out, p.(map[string]any)["id"].(string))
	}
	return out
}

// lobby3 makes a room with a TV and three players p1 (host), p2, p3.
func lobby3(t *testing.T) (f *fixture, code string, tv *conn, ps []*conn, toks []string) {
	f = newFixture(t, "alpha", "beta")
	tv = f.dial("role", "tv")
	code = tv.next("welcome")["room"].(string)
	for _, n := range []string{"Ann", "Bob", "Cy"} {
		c := f.dial("role", "player", "room", code, "name", n)
		w := c.next("welcome")
		ps = append(ps, c)
		toks = append(toks, w["token"].(string))
	}
	tv.until(t, func(m map[string]any) bool { return len(m["players"].([]any)) == 3 })
	for _, c := range ps {
		c.settle()
	}
	return
}

func TestKick(t *testing.T) {
	f, code, tv, ps, toks := lobby3(t)
	host, bob, cy := ps[0], ps[1], ps[2]

	bob.send(map[string]any{"t": "kick", "id": "p3"})
	if e := bob.next("error"); e["code"] != "not_host" {
		t.Fatalf("non-host kick: %v", e)
	}
	host.send(map[string]any{"t": "kick", "id": "p1"})
	if e := host.next("error"); e["code"] != "bad_request" {
		t.Fatalf("self kick: %v", e)
	}
	host.send(map[string]any{"t": "kick", "id": "p9"})
	if e := host.next("error"); e["code"] != "bad_request" {
		t.Fatalf("unknown kick: %v", e)
	}
	host.send(map[string]any{"t": "kick"})
	if e := host.next("error"); e["code"] != "bad_request" {
		t.Fatalf("no id: %v", e)
	}

	// Kick mid-game: the stub goes to "play" first.
	host.send(map[string]any{"t": "go"})
	tv.until(t, func(m map[string]any) bool { return m["phase"] == "play" })
	host.send(map[string]any{"t": "kick", "id": "p2"})
	bob.closedWith("kicked")
	for _, c := range []*conn{tv, host, cy} {
		r := c.until(t, func(m map[string]any) bool { return len(m["players"].([]any)) == 2 })
		if got := players(r); got[0] != "p1" || got[1] != "p3" {
			t.Fatalf("players %v", got)
		}
	}

	// The token is dead: refused with `kicked`, and the room is unchanged.
	again := f.dial("role", "player", "room", code, "name", "Bob", "token", toks[1])
	if e := again.next("error"); e["code"] != "kicked" {
		t.Fatalf("resume after kick: %v", e)
	}
	again.closedWith("")
	// A fresh join is a brand-new player.
	fresh := f.dial("role", "player", "room", code, "name", "Bob")
	if w := fresh.next("welcome"); w["you"] != "p4" || w["token"] == toks[1] {
		t.Fatalf("rejoin %v", w)
	}
	tv.until(t, func(m map[string]any) bool { return len(m["players"].([]any)) == 3 })
}

func TestLeave(t *testing.T) {
	f, code, tv, ps, toks := lobby3(t)
	host, bob := ps[0], ps[1]

	bob.send(map[string]any{"t": "leave"})
	bob.closedWith("left")
	tv.until(t, func(m map[string]any) bool { return len(m["players"].([]any)) == 2 })
	// The old token no longer resumes: the connection becomes a new player.
	again := f.dial("role", "player", "room", code, "name", "Bob", "token", toks[1])
	if w := again.next("welcome"); w["you"] != "p4" || w["token"] == toks[1] {
		t.Fatalf("resume after leave %v", w)
	}
	again.c.CloseNow()

	// The host leaves: the host moves on.
	host.send(map[string]any{"t": "leave"})
	host.closedWith("left")
	r := tv.until(t, func(m map[string]any) bool {
		for _, id := range players(m) {
			if id == "p1" {
				return false
			}
		}
		return true
	})
	if r["host"] == "p1" || r["host"] == "" {
		t.Fatalf("host after leave %v", r)
	}
}

func TestLastPlayerLeaves(t *testing.T) {
	f := newFixture(t, "alpha")
	tv := f.dial("role", "tv")
	code := tv.next("welcome")["room"].(string)
	a := f.dial("role", "player", "room", code, "name", "Ann")
	a.next("welcome")
	a.send(map[string]any{"t": "go"})
	tv.until(t, func(m map[string]any) bool { return m["phase"] == "play" })
	a.send(map[string]any{"t": "leave"})
	a.closedWith("left")
	r := tv.until(t, func(m map[string]any) bool { return len(m["players"].([]any)) == 0 })
	if r["host"] != "" {
		t.Fatalf("host %v", r["host"])
	}
	// Someone new can still join and becomes host.
	b := f.dial("role", "player", "room", code, "name", "Bea")
	if w := b.next("welcome"); w["you"] != "p2" {
		t.Fatalf("join %v", w)
	}
	if r := b.next("room"); r["host"] != "p2" {
		t.Fatalf("host %v", r)
	}
}

// snapSteps reads snaps until one arrives and returns its step count.
func snapSteps(c *conn) int { return int(c.next("snap")["steps"].(float64)) }

func TestPause(t *testing.T) {
	f, code, tv, ps, toks := lobby3(t)
	host, bob := ps[0], ps[1]

	host.send(map[string]any{"t": "pause", "on": true})
	if e := host.next("error"); e["code"] != "bad_request" {
		t.Fatalf("pause in lobby: %v", e)
	}
	host.send(map[string]any{"t": "go"})
	tv.until(t, func(m map[string]any) bool { return m["phase"] == "play" })
	bob.send(map[string]any{"t": "pause", "on": true})
	if e := bob.next("error"); e["code"] != "not_host" {
		t.Fatalf("non-host pause: %v", e)
	}

	host.send(map[string]any{"t": "pause", "on": true})
	for _, c := range []*conn{tv, host, bob} {
		if m := c.next("paused"); m["on"] != true || m["by"] != "p1" {
			t.Fatalf("paused %v", m)
		}
	}
	// Step is no longer called; snaps keep coming.
	snapSteps(tv) // possibly from before the pause took effect
	s1 := snapSteps(tv)
	time.Sleep(300 * time.Millisecond)
	if s2 := snapSteps(tv); s2 != s1 {
		t.Fatalf("steps advanced while paused: %d → %d", s1, s2)
	}
	// Game commands are refused; room commands still work.
	bob.send(map[string]any{"t": "anything"})
	if e := bob.next("error"); e["code"] != "paused" {
		t.Fatalf("command while paused: %v", e)
	}
	bob.send(map[string]any{"t": "ping"})
	bob.next("pong")

	// A reconnect gets the flag.
	bob.c.CloseNow()
	b2 := f.dial("role", "player", "room", code, "token", toks[1])
	b2.next("welcome")
	if m := b2.next("paused"); m["on"] != true || m["by"] != "p1" {
		t.Fatalf("reconnect paused %v", m)
	}
	// The host reconnecting keeps the pause (still host: the stub keeps it).
	host.c.CloseNow()
	h2 := f.dial("role", "player", "room", code, "token", toks[0])
	h2.next("welcome")
	if m := h2.next("paused"); m["on"] != true {
		t.Fatalf("host reconnect paused %v", m)
	}

	// Resume.
	h2.send(map[string]any{"t": "pause", "on": false})
	if m := tv.next("paused"); m["on"] != false {
		t.Fatalf("resume %v", m)
	}
	s1 = snapSteps(tv)
	time.Sleep(200 * time.Millisecond)
	if s2 := snapSteps(tv); s2 <= s1 {
		t.Fatalf("steps did not advance after resume: %d → %d", s1, s2)
	}

	// Auto-clear: the game leaves the running phase.
	h2.send(map[string]any{"t": "pause", "on": true})
	tv.next("paused")
	h2.send(map[string]any{"t": "restart"}) // allowed while paused
	if m := tv.next("paused"); m["on"] != false {
		t.Fatalf("pause after restart %v", m)
	}

	// Auto-clear: the pausing host leaves.
	h2.send(map[string]any{"t": "go"})
	tv.until(t, func(m map[string]any) bool { return m["phase"] == "play" })
	h2.send(map[string]any{"t": "pause", "on": true})
	tv.next("paused")
	h2.send(map[string]any{"t": "leave"})
	if m := tv.next("paused"); m["on"] != false {
		t.Fatalf("pause after host left %v", m)
	}
}
