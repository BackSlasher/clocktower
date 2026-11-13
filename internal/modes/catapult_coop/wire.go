package catapultcoop

import "clocktower/internal/mode"

// Wire types shared by the game, the room and the bots. Field names follow
// docs/PROTOCOL.md ("catapult_coop") exactly.

// Phase is the game phase.
type Phase = mode.Phase

const (
	PhaseLobby         = mode.PhaseLobby
	PhasePlan    Phase = "plan"
	PhaseResolve Phase = "resolve"
	PhaseBreak   Phase = "break"
	PhaseWon           = mode.PhaseWon
	PhaseLost          = mode.PhaseLost
)

// Error is a command refusal; Code is a protocol error code.
type Error = mode.Error

// Protocol error codes.
var (
	ErrNotHost    = mode.ErrNotHost
	ErrBadRequest = mode.ErrBadRequest
	ErrRoomFull   = mode.ErrRoomFull
	ErrBadName    = mode.ErrBadName
	ErrTooLate    = &Error{Code: "too_late", Msg: "Too late, the round is under way"}
)

func badReq(msg string) *Error  { return &Error{Code: "bad_request", Msg: msg} }
func badPlan(msg string) *Error { return &Error{Code: "bad_plan", Msg: msg} }

// Actions.
const (
	AMove   = "move"
	APickup = "pickup"
	AThrow  = "throw"
	ALoad   = "load"
	AFire   = "fire"
	AWait   = "wait"
	AClear  = "clear" // command only: withdraw the plan
)

// Cmd is a client → server message. Pointer fields distinguish "absent".
type Cmd struct {
	T         string `json:"t"`
	A         string `json:"a,omitempty"`    // plan: action
	X         *int   `json:"x,omitempty"`    // plan: target cell (move, pickup)
	Y         *int   `json:"y,omitempty"`    //
	DX        *int   `json:"dx,omitempty"`   // plan throw: direction
	DY        *int   `json:"dy,omitempty"`   //
	Cat       *int   `json:"cat,omitempty"`  // plan: catapult id
	Fire      bool   `json:"fire,omitempty"` // plan load: also fire (Quick Hands)
	ID        string `json:"id,omitempty"`   // perk
	Ready     *bool  `json:"ready,omitempty"`
	OpenPlans *bool  `json:"openPlans,omitempty"` // opt
}

// IntP and BoolP help build commands in Go (bots, tests).
func IntP(v int) *int    { return &v }
func BoolP(v bool) *bool { return &v }

// Plan is a player's chosen action as the server stores and shows it.
type Plan struct {
	A    string   `json:"a"`
	X    *int     `json:"x,omitempty"`
	Y    *int     `json:"y,omitempty"`
	DX   *int     `json:"dx,omitempty"` // throw: direction
	DY   *int     `json:"dy,omitempty"`
	Cat  *int     `json:"cat,omitempty"`
	Fire bool     `json:"fire,omitempty"`
	Path [][2]int `json:"path,omitempty"` // move: the cells walked, start excluded
}

// PlayerInfo is a player entry in the `room` message.
type PlayerInfo struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Color     string         `json:"color"`
	Connected bool           `json:"connected"`
	Away      bool           `json:"away"`
	Planned   bool           `json:"planned"`
	Ready     bool           `json:"ready"`
	Plan      *Plan          `json:"plan"` // only with openPlans, else null
	Offer     []string       `json:"offer"`
	Perks     map[string]int `json:"perks"`
	Can       Abilities      `json:"can"`
}

// StatsOut is one player's end-of-game stats.
type StatsOut struct {
	Throws  int            `json:"throws"`
	Catches int            `json:"catches"`
	Pickups int            `json:"pickups"`
	Loads   int            `json:"loads"`
	Fires   int            `json:"fires"`
	Kills   int            `json:"kills"`
	Dmg     int            `json:"dmg"`
	Steps   int            `json:"steps"`
	Bumps   int            `json:"bumps"`
	Perks   map[string]int `json:"perks"`
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
	Level  int                 `json:"level"`
	Rounds int                 `json:"rounds"`
	Wall   int                 `json:"wall"`
	Time   float64             `json:"time"`
	Stats  map[string]StatsOut `json:"stats"`
	Awards []Award             `json:"awards"`
}

// RoomMsg is the `room` message.
type RoomMsg struct {
	T         string       `json:"t"`
	Mode      string       `json:"mode"`
	Phase     Phase        `json:"phase"`
	Host      string       `json:"host"`
	Players   []PlayerInfo `json:"players"`
	OpenPlans bool         `json:"openPlans"`
	Keep      string       `json:"keep"`
	Layout    *Layout      `json:"layout"`
	Level     int          `json:"level"`
	Levels    int          `json:"levels"`
	Round     int          `json:"round"`
	End       *End         `json:"end"`
}

// BombRef is a bomb not on the ground (carried or loaded).
type BombRef struct {
	ID   int    `json:"id"`
	Kind string `json:"kind"`
}

// EngineerSnap is an engineer in a snap.
type EngineerSnap struct {
	PID   string   `json:"pid"`
	X     int      `json:"x"`
	Y     int      `json:"y"`
	Carry *BombRef `json:"carry"`
}

// BombSnap is a bomb lying on the ground.
type BombSnap struct {
	ID   int    `json:"id"`
	Kind string `json:"kind"`
	X    int    `json:"x"`
	Y    int    `json:"y"`
}

// CatapultSnap is a catapult's load.
type CatapultSnap struct {
	ID   int      `json:"id"`
	Bomb *BombRef `json:"bomb"`
}

// MachineSnap is a machine in a lane.
type MachineSnap struct {
	ID     int    `json:"id"`
	Kind   string `json:"kind"`
	Lane   int    `json:"lane"`
	Pos    int    `json:"pos"`
	HP     int    `json:"hp"`
	Max    int    `json:"max"`
	Frozen int    `json:"frozen"`
}

// Incoming is a machine that appears at the end of the current round.
type Incoming struct {
	Lane int    `json:"lane"`
	Kind string `json:"kind"`
}

// Snap is the `snap` message.
type Snap struct {
	T         string         `json:"t"`
	Phase     Phase          `json:"phase"`
	Time      float64        `json:"time"`
	Level     int            `json:"level"`
	Round     int            `json:"round"`
	Left      float64        `json:"left"`
	Wall      int            `json:"wall"`
	WallMax   int            `json:"wallMax"`
	Engineers []EngineerSnap `json:"engineers"`
	Bombs     []BombSnap     `json:"bombs"`
	Catapults []CatapultSnap `json:"catapults"`
	Machines  []MachineSnap  `json:"machines"`
	Incoming  []Incoming     `json:"incoming"`
	Ev        []any          `json:"ev"`
}

// Stage names of a resolve, in order.
const (
	StThrow    = "throw"
	StMove     = "move"
	StGrab     = "grab"
	StFire     = "fire"
	StMachines = "machines"
)

// StageTiming places one stage on the resolve timeline.
type StageTiming struct {
	S   string  `json:"s"`
	At  float64 `json:"at"`
	Dur float64 `json:"dur"`
}

// Hit is one machine affected by a fired bomb.
type Hit struct {
	ID     int  `json:"id"`
	Dmg    int  `json:"dmg"`
	HP     int  `json:"hp"`
	Killed bool `json:"killed"`
	Frozen int  `json:"frozen"`
}

// Events. Each has E set to its event name; resolve events also carry their
// stage in S.
type (
	EvResolve struct {
		E      string        `json:"e"`
		Level  int           `json:"level"`
		Round  int           `json:"round"`
		Dur    float64       `json:"dur"`
		Stages []StageTiming `json:"stages"`
	}
	EvThrow struct {
		E      string `json:"e"`
		S      string `json:"s"`
		PID    string `json:"pid"`
		Bomb   int    `json:"bomb"`
		Kind   string `json:"kind"`
		From   [2]int `json:"from"`
		Dir    [2]int `json:"dir"`          // the throw's direction (dx, dy)
		To     [2]int `json:"to"`           // where the flight ends: the catcher's cell, or the landing cell
		Result string `json:"result"`       // caught | blocked | landed
		By     string `json:"by,omitempty"` // the engineer who caught or blocked it
		At     [2]int `json:"at"`           // where the bomb ends up (catcher's cell, or resting cell)
	}
	EvMove struct {
		E      string   `json:"e"`
		S      string   `json:"s"`
		PID    string   `json:"pid"`
		From   [2]int   `json:"from"`
		To     [2]int   `json:"to"`
		Path   [][2]int `json:"path"`
		Result string   `json:"result"` // ok | bump
	}
	EvPickup struct {
		E      string `json:"e"`
		S      string `json:"s"`
		PID    string `json:"pid"`
		At     [2]int `json:"at"`
		Bomb   int    `json:"bomb"`
		Kind   string `json:"kind"`
		Result string `json:"result"` // ok | contested | hands_full
	}
	EvLoad struct {
		E      string `json:"e"`
		S      string `json:"s"`
		PID    string `json:"pid"`
		Cat    int    `json:"cat"`
		Bomb   int    `json:"bomb"`
		Kind   string `json:"kind"`
		Result string `json:"result"` // ok | contested
	}
	EvFire struct {
		E      string `json:"e"`
		S      string `json:"s"`
		PID    string `json:"pid"`
		Cat    int    `json:"cat"`
		Lane   int    `json:"lane"`
		Bomb   int    `json:"bomb"`
		Kind   string `json:"kind"`
		Result string `json:"result"` // ok | wasted | empty
		Hits   []Hit  `json:"hits"`
	}
	EvAdvance struct {
		E    string `json:"e"`
		S    string `json:"s"`
		ID   int    `json:"id"`
		Kind string `json:"kind"`
		Lane int    `json:"lane"`
		From int    `json:"from"`
		To   int    `json:"to"`
	}
	EvStall struct {
		E      string `json:"e"`
		S      string `json:"s"`
		ID     int    `json:"id"`
		Lane   int    `json:"lane"`
		Pos    int    `json:"pos"`
		Frozen int    `json:"frozen"` // skips left after this one
	}
	EvWall struct {
		E    string `json:"e"`
		S    string `json:"s"`
		ID   int    `json:"id"`
		Kind string `json:"kind"`
		Lane int    `json:"lane"`
		From int    `json:"from"`
		Dmg  int    `json:"dmg"`
		Wall int    `json:"wall"`
	}
	EvSpawn struct {
		E    string `json:"e"`
		S    string `json:"s,omitempty"`
		ID   int    `json:"id"`
		Kind string `json:"kind"`
		Lane int    `json:"lane"`
		Pos  int    `json:"pos"`
		HP   int    `json:"hp"`
	}
	EvBomb struct {
		E    string `json:"e"`
		S    string `json:"s,omitempty"`
		ID   int    `json:"id"`
		Kind string `json:"kind"`
		X    int    `json:"x"`
		Y    int    `json:"y"`
	}
	EvLevelStart struct {
		E      string `json:"e"`
		Level  int    `json:"level"`
		Name   string `json:"name"`
		Layout string `json:"layout"`
	}
	EvLevelClear struct {
		E     string `json:"e"`
		Level int    `json:"level"`
		Wall  int    `json:"wall"`
	}
	EvPlace struct {
		E   string `json:"e"`
		PID string `json:"pid"`
		X   int    `json:"x"`
		Y   int    `json:"y"`
	}
	EvPerk struct {
		E    string `json:"e"`
		PID  string `json:"pid"`
		ID   string `json:"id"`
		Wall int    `json:"wall"`
	}
)
