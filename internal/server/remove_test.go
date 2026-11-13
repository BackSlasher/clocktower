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
