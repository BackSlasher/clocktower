package server

import (
	"errors"
	"testing"
	"time"

	"github.com/coder/websocket"

	"clocktower/internal/mode"
	"clocktower/internal/modes/all"
	"clocktower/internal/room"
)

func newEnvAllModes(t *testing.T) *env {
	t.Helper()
	r := mode.NewRegistry()
	all.RegisterTo(r, false)
	all.RegisterWIPTo(r)
	return newEnvCfg(t, room.Config{IdleTimeout: time.Minute, Modes: r})
}

// closedReason reads until the server closes and returns the close reason.
func (w *wsc) closedReason() string {
	w.t.Helper()
	for {
		if _, err := w.read(); err != nil {
			var ce websocket.CloseError
			if errors.As(err, &ce) {
				return ce.Reason
			}
			w.t.Fatalf("closed without a close frame: %v", err)
		}
	}
}

// Pause freezes the real modes' clocks (Step is not called) and refuses
// game commands; resume continues.
func TestPauseRealModes(t *testing.T) {
	for _, id := range []string{"tower_defense", "catapult_coop"} {
		t.Run(id, func(t *testing.T) {
			e := newEnvAllModes(t)
			tv := e.dial(q("role", "tv"))
			code := tv.next("welcome")["room"].(string)
			a := e.dial(q("role", "player", "room", code, "name", "Ada"))
			a.next("welcome")
			b := e.dial(q("role", "player", "room", code, "name", "Bea"))
			b.next("welcome")
			if id != "tower_defense" {
				a.send(map[string]any{"t": "mode", "id": id})
				a.next("setup")
			}
			a.send(map[string]any{"t": "start"})
			tv.until("room", func(m msg) bool { return m["phase"] != "lobby" })
			time.Sleep(200 * time.Millisecond)
			a.send(map[string]any{"t": "pause", "on": true})
			tv.until("paused", func(m msg) bool { return m["on"] == true && m["by"] == "p1" })
			tv.next("snap") // may predate the pause
			s1 := tv.next("snap")
			time.Sleep(400 * time.Millisecond)
			s2 := tv.next("snap")
			if s1["time"] != s2["time"] || s1["time"].(float64) == 0 {
				t.Fatalf("time moved while paused: %v → %v", s1["time"], s2["time"])
			}
			if id == "tower_defense" && s1["left"] != s2["left"] {
				t.Fatalf("build timer moved: %v → %v", s1["left"], s2["left"])
			}
			cmd := map[string]any{"t": "ready", "ready": true}
			if id == "catapult_coop" {
				cmd = map[string]any{"t": "plan", "acts": []any{}, "done": true}
			}
			b.send(cmd)
			if m := b.next("error"); m["code"] != "paused" {
				t.Fatalf("command while paused: %v", m)
			}
			a.send(map[string]any{"t": "pause", "on": false})
			tv.until("paused", func(m msg) bool { return m["on"] == false })
			tv.next("snap")
			s3 := tv.next("snap")
			time.Sleep(300 * time.Millisecond)
			if s4 := tv.next("snap"); s4["time"].(float64) <= s3["time"].(float64) {
				t.Fatalf("time stuck after resume: %v → %v", s3["time"], s4["time"])
			}
		})
	}
}

// A kick mid-game in tower_defense: the tower stays, now ownerless.
func TestKickTowerDefense(t *testing.T) {
	e := newEnvAllModes(t)
	tv := e.dial(q("role", "tv"))
	code := tv.next("welcome")["room"].(string)
	a := e.dial(q("role", "player", "room", code, "name", "Ada"))
	a.next("welcome")
	b := e.dial(q("role", "player", "room", code, "name", "Bea"))
	tokB := b.next("welcome")["token"].(string)
	a.send(map[string]any{"t": "start"})
	b.until("room", func(m msg) bool { return m["phase"] == "build" })
	b.send(map[string]any{"t": "build", "plot": 3, "kind": "rivet"})
	tv.until("snap", func(m msg) bool { return len(m["towers"].([]any)) == 1 })
	a.send(map[string]any{"t": "kick", "id": "p2"})
	if r := b.closedReason(); r != "kicked" {
		t.Fatalf("close reason %q", r)
	}
	tv.until("room", func(m msg) bool { return len(m["players"].([]any)) == 1 })
	s := tv.until("snap", func(m msg) bool { return true })
	tw := s["towers"].([]any)[0].(map[string]any)
	if tw["owner"] != "" {
		t.Fatalf("tower %v", tw)
	}
	if _, ok := s["purses"].(map[string]any)["p2"]; ok {
		t.Fatal("kicked player's purse in snap")
	}
	again := e.dial(q("role", "player", "room", code, "token", tokB))
	if m := again.next("error"); m["code"] != "kicked" {
		t.Fatalf("resume %v", m)
	}
}

// Per-mode player limits: catapult_coop seats 4. Switching a 5-player lobby
// to it is refused until the host removes someone; a full room refuses joins.
func TestModePlayerLimits(t *testing.T) {
	e := newEnvAllModes(t)
	tv := e.dial(q("role", "tv"))
	w := tv.next("welcome")
	code := w["room"].(string)
	for _, m := range w["modes"].([]any) {
		mi := m.(map[string]any)
		want := map[string]float64{"tower_defense": 8, "catapult_coop": 4}[mi["id"].(string)]
		if mi["maxPlayers"] != want || mi["minPlayers"] != 1.0 {
			t.Fatalf("mode info %v", mi)
		}
	}
	var ps []*wsc
	for _, n := range []string{"Ann", "Bob", "Cy", "Dee", "Eve"} {
		c := e.dial(q("role", "player", "room", code, "name", n))
		c.next("welcome")
		ps = append(ps, c)
	}
	host := ps[0]
	host.send(map[string]any{"t": "mode", "id": "catapult_coop"})
	m := host.next("error")
	if m["code"] != "too_many_players" || m["msg"] != "Hold the Keep takes up to 4 players — remove someone first" {
		t.Fatalf("switch with 5: %v", m)
	}
	// A disconnected player still counts.
	ps[4].c.Close(websocket.StatusNormalClosure, "")
	tv.until("room", func(m msg) bool {
		for _, p := range m["players"].([]any) {
			if p.(map[string]any)["id"] == "p5" && p.(map[string]any)["connected"] == false {
				return true
			}
		}
		return false
	})
	host.send(map[string]any{"t": "mode", "id": "catapult_coop"})
	if m := host.next("error"); m["code"] != "too_many_players" {
		t.Fatalf("switch with 4+1 offline: %v", m)
	}
	host.send(map[string]any{"t": "kick", "id": "p5"})
	tv.until("room", func(m msg) bool { return len(m["players"].([]any)) == 4 })
	host.send(map[string]any{"t": "mode", "id": "catapult_coop"})
	if s := host.next("setup"); s["mode"] != "catapult_coop" {
		t.Fatalf("setup %v", s)
	}
	// Full: a fifth joiner is refused.
	late := e.dial(q("role", "player", "room", code, "name", "Fay"))
	if m := late.next("error"); m["code"] != "room_full" {
		t.Fatalf("join full: %v", m)
	}
	// In the lobby a disconnected player makes room (evicted), as before.
	ps[3].c.Close(websocket.StatusNormalClosure, "")
	tv.until("room", func(m msg) bool {
		for _, p := range m["players"].([]any) {
			if p.(map[string]any)["id"] == "p4" && p.(map[string]any)["connected"] == false {
				return true
			}
		}
		return false
	})
	again := e.dial(q("role", "player", "room", code, "name", "Fay"))
	if w := again.next("welcome"); w["you"] != "p6" { // p5 was kicked: ids are never reused
		t.Fatalf("eviction join %v", w)
	}
	// Back to tower_defense is always fine (8 seats).
	host.send(map[string]any{"t": "mode", "id": "tower_defense"})
	if s := host.next("setup"); s["mode"] != "tower_defense" {
		t.Fatalf("setup %v", s)
	}
}
