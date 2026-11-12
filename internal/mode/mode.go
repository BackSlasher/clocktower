// Package mode is the seam between the generic room layer (internal/room,
// internal/server) and the game modes (internal/modes/...). A mode has a
// stable id, used in code, paths and the wire protocol, and a display name
// that appears in exactly one place (its Info).
//
// The room goroutine owns a Game and is the only caller of its methods, so
// implementations need no locking.
package mode

import (
	"encoding/json"
	"math/rand/v2"
)

// Info describes a registered mode. It is sent to clients in `welcome.modes`.
type Info struct {
	ID      string `json:"id"`      // stable: code, package, wire protocol
	Name    string `json:"name"`    // display name, free to change
	Tagline string `json:"tagline"` // one line under the name
}

// Phase is a game phase. Modes may define their own phases; the room layer
// only knows these three.
type Phase string

const (
	PhaseLobby Phase = "lobby"
	PhaseWon   Phase = "won"
	PhaseLost  Phase = "lost"
)

// Error is a command refusal; Code is a protocol error code.
type Error struct {
	Code string
	Msg  string
}

func (e *Error) Error() string { return e.Code + ": " + e.Msg }

// Errors the room layer itself produces; modes reuse them so the codes stay
// identical everywhere.
var (
	ErrNotHost    = &Error{Code: "not_host", Msg: "Only the host can do that"}
	ErrBadRequest = &Error{Code: "bad_request", Msg: "Can't do that"}
	ErrNoRoom     = &Error{Code: "no_room", Msg: "No such room"}
	ErrRoomFull   = &Error{Code: "room_full", Msg: "Room is full"}
	ErrBadName    = &Error{Code: "bad_name", Msg: "Pick a name of 1–12 characters"}
)

// Member is one player as carried across a mode switch.
type Member struct {
	ID        string
	Name      string
	Color     string
	Connected bool
	Host      bool
}

// Setup is the mode-specific part of `welcome` (and of `setup`).
type Setup struct {
	Map  json.RawMessage
	Defs json.RawMessage
}

// Game is one room's game instance.
type Game interface {
	// Players. Ownership of the lobby stays with the game.
	AddPlayer(name string) (pid, evicted string, err error)
	HasPlayer(pid string) bool
	SetConnected(pid string, on bool)
	Host() string
	// Roster lists the players in join order, for carrying over to another
	// mode's factory.
	Roster() []Member

	// Command handles one client message of type typ (anything but ping and
	// mode) with its raw JSON. Unknown types are ignored (nil). The returned
	// error is sent to the sender as an `error` message; a *Error keeps its
	// code, any other error becomes bad_request.
	Command(pid, typ string, raw []byte) error

	// Time and phases.
	Step(dt float64)
	Running() bool // true while Step should be called and snaps broadcast
	Phase() Phase
	SlowVersion() uint64 // bumps whenever RoomState changes

	// Wire payloads; each must be JSON-serialisable.
	Setup() Setup
	RoomState() any // the `room` message; must carry "mode": <id>
	Snapshot() any  // the `snap` message; drains pending events
	View() any      // like Snapshot, for a new connection; leaves events alone
}

// Factory makes a game for a room. A non-empty roster is the player list of
// the mode being replaced; the new game must adopt it (ids, names, colours,
// connected state, host), dropping players it cannot seat.
type Factory func(rng *rand.Rand, roster []Member) Game
