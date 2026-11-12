package towerdefense

import "clocktower/internal/mode"

// Wire types shared by the simulation, the room and the bots. Field names
// follow docs/PROTOCOL.md exactly.

// Phase is the game phase. The lobby, won and lost phases are shared with the
// room layer (package mode); build and wave are specific to this mode.
type Phase = mode.Phase

const (
	PhaseLobby       = mode.PhaseLobby
	PhaseBuild Phase = "build"
	PhaseWave  Phase = "wave"
	PhaseWon         = mode.PhaseWon
	PhaseLost        = mode.PhaseLost
)

// Error is a command refusal; Code is a protocol error code.
type Error = mode.Error

// Protocol error codes.
var (
	ErrPoor       = &Error{Code: "poor", Msg: "Not enough cogs"}
	ErrOccupied   = &Error{Code: "occupied", Msg: "That plot is taken"}
	ErrNotOwner   = &Error{Code: "not_owner", Msg: "Only the builder can sell this"}
	ErrMaxLevel   = &Error{Code: "max_level", Msg: "Already at max level"}
	ErrNotHost    = mode.ErrNotHost
	ErrBadRequest = mode.ErrBadRequest
	ErrNoRoom     = mode.ErrNoRoom
	ErrRoomFull   = mode.ErrRoomFull
	ErrBadName    = mode.ErrBadName

	// Perk refusals (all bad_request on the wire).
	ErrNoOffer     = &Error{Code: "bad_request", Msg: "No perk to choose right now"}
	ErrNotOffered  = &Error{Code: "bad_request", Msg: "That perk is not on offer"}
	ErrUnknownPerk = &Error{Code: "bad_request", Msg: "No such perk"}
)

func badReq(msg string) *Error { return &Error{Code: "bad_request", Msg: msg} }

// Cmd is a client → server message. Pointer fields distinguish "absent".
type Cmd struct {
	T      string `json:"t"`
	Plot   *int   `json:"plot,omitempty"`
	Kind   string `json:"kind,omitempty"`
	N      *int   `json:"n,omitempty"`
	Ready  *bool  `json:"ready,omitempty"`
	To     string `json:"to,omitempty"`
	Amount *int   `json:"amount,omitempty"`
	ID     string `json:"id,omitempty"` // perk
}

// Helpers for building commands in Go (bots, tests).
func IntP(v int) *int    { return &v }
func BoolP(v bool) *bool { return &v }

// PlayerInfo is a player entry in the `room` message.
type PlayerInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Connected bool   `json:"connected"`
	Ready     bool   `json:"ready"`
	// Perks (see perks.go). Offer is null while there is no unpicked choice;
	// Perks is never null. Costs and Free are present only when they apply.
	Offer []string          `json:"offer"`
	Perks map[string]int    `json:"perks"`
	Costs map[string][3]int `json:"costs,omitempty"` // kind → [build, up2, up3] this player pays
	Free  int               `json:"free,omitempty"`  // free builds left (Free Sample)
}

// WaveEntry is one line of the next-wave preview.
type WaveEntry struct {
	Kind string `json:"kind"`
	N    int    `json:"n"`
}

// StatsOut is one player's end-of-game stats.
type StatsOut struct {
	Kills  int            `json:"kills"`
	Dmg    int            `json:"dmg"`
	Spent  int            `json:"spent"`
	Winds  int            `json:"winds"`
	Built  int            `json:"built"`
	Gifted int            `json:"gifted"`
	Perks  map[string]int `json:"perks"`
}

// Award is a fun end-of-game title.
type Award struct {
	PID    string `json:"pid"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

// End summarises a finished game.
type End struct {
	Won    bool                `json:"won"`
	Wave   int                 `json:"wave"`
	Time   float64             `json:"time"`
	Stats  map[string]StatsOut `json:"stats"`
	Awards []Award             `json:"awards"`
}

// RoomMsg is the `room` message.
type RoomMsg struct {
	T        string       `json:"t"`
	Mode     string       `json:"mode"`
	Phase    Phase        `json:"phase"`
	Host     string       `json:"host"`
	Players  []PlayerInfo `json:"players"`
	Wave     int          `json:"wave"`
	NextWave []WaveEntry  `json:"nextWave"`
	End      *End         `json:"end"`
}

// TowerSnap is a tower in a snap.
type TowerSnap struct {
	Plot     int     `json:"plot"`
	Kind     string  `json:"kind"`
	Lvl      int     `json:"lvl"`
	Owner    string  `json:"owner"`
	Tension  float64 `json:"tension"`
	Aim      float64 `json:"aim"`
	Spent    int     `json:"spent"`
	RangeMul float64 `json:"rangeMul,omitempty"` // owner's perk range multiplier; omitted when 1
}

// Enemy tuple indices in Snap.Enemies.
const (
	EID = iota
	EKind
	EPath
	EDist
	EHP
	EFlags
)

// Enemy flag bits.
const (
	FlagSlowed   = 1
	FlagRepaired = 2
)

// Snap is the `snap` message.
type Snap struct {
	T       string         `json:"t"`
	Time    float64        `json:"time"`
	Phase   Phase          `json:"phase"`
	Wave    int            `json:"wave"`
	Left    float64        `json:"left"`
	Lives   int            `json:"lives"`
	Purses  map[string]int `json:"purses"`
	Towers  []TowerSnap    `json:"towers"`
	Enemies [][6]float64   `json:"enemies"`
	Ev      []any          `json:"ev"`
}

// Events. Each has E set to its event name.
type (
	EvShot struct {
		E      string  `json:"e"`
		Plot   int     `json:"plot"`
		Kind   string  `json:"kind"`
		To     int     `json:"to"`
		X      float64 `json:"x"`
		Y      float64 `json:"y"`
		Travel float64 `json:"travel"`
	}
	EvChain struct {
		E    string  `json:"e"`
		Plot int     `json:"plot"`
		IDs  []int   `json:"ids"`
		Pts  []Point `json:"pts"` // tower position first, then one per id
	}
	EvDie struct {
		E      string  `json:"e"`
		ID     int     `json:"id"`
		Kind   string  `json:"kind"`
		X      float64 `json:"x"`
		Y      float64 `json:"y"`
		Bounty int     `json:"bounty"`
	}
	EvLeak struct {
		E     string `json:"e"`
		ID    int    `json:"id"`
		Kind  string `json:"kind"`
		Lives int    `json:"lives"`
	}
	EvBuild struct {
		E    string `json:"e"`
		Plot int    `json:"plot"`
		Kind string `json:"kind"`
		PID  string `json:"pid"`
	}
	EvUpgrade struct {
		E    string `json:"e"`
		Plot int    `json:"plot"`
		Lvl  int    `json:"lvl"`
		PID  string `json:"pid"`
	}
	EvSell struct {
		E      string `json:"e"`
		Plot   int    `json:"plot"`
		PID    string `json:"pid"`
		Refund int    `json:"refund"`
	}
	EvWind struct {
		E    string `json:"e"`
		Plot int    `json:"plot"`
		PID  string `json:"pid"`
	}
	EvGift struct {
		E      string `json:"e"`
		From   string `json:"from"`
		To     string `json:"to"`
		Amount int    `json:"amount"`
	}
	EvWaveStart struct {
		E    string `json:"e"`
		Wave int    `json:"wave"`
	}
	EvPerk struct {
		E   string `json:"e"`
		PID string `json:"pid"`
		ID  string `json:"id"`
	}
	EvWaveClear struct {
		E     string `json:"e"`
		Wave  int    `json:"wave"`
		Bonus int    `json:"bonus"`
	}
)
