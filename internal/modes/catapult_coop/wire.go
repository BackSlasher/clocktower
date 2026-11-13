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
	ErrTooLate    = &Error{Code: "too_late", Msg: "Too late, the turn is under way"}
)

func badReq(msg string) *Error { return &Error{Code: "bad_request", Msg: msg} }

// Actions.
const (
	AMove   = "move"
	APickup = "pickup"
	AThrow  = "throw"
	ALoad   = "load"
	AWait   = "wait"
)

// Act is one queued action. DX, DY: a direction for move and throw
// (required); absent otherwise.
type Act struct {
	A  string `json:"a"`
	DX *int   `json:"dx,omitempty"`
	DY *int   `json:"dy,omitempty"`
}

// Cmd is a client → server message. Pointer fields distinguish "absent".
type Cmd struct {
	T     string `json:"t"`
	Acts  []Act  `json:"acts,omitempty"`  // plan: the whole queue
	Done  bool   `json:"done,omitempty"`  // plan: finished planning
	Ready *bool  `json:"ready,omitempty"` // ready (break)
}

// IntP and BoolP help build commands in Go (bots, tests).
func IntP(v int) *int    { return &v }
func BoolP(v bool) *bool { return &v }

// Dir builds an act with a direction.
func Dir(a string, dx, dy int) Act { return Act{A: a, DX: IntP(dx), DY: IntP(dy)} }

// PlayerInfo is a player entry in the `room` message.
type PlayerInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Connected bool   `json:"connected"`
	Away      bool   `json:"away"`
	Ready     bool   `json:"ready"` // break: pressed ready
}

// StatsOut is one player's end-of-game stats.
type StatsOut struct {
	Throws  int `json:"throws"`
	Catches int `json:"catches"`
	Pickups int `json:"pickups"`
	Loads   int `json:"loads"`
	Kills   int `json:"kills"`
	Dmg     int `json:"dmg"`
	Steps   int `json:"steps"`
	Bumps   int `json:"bumps"`
	Fizzles int `json:"fizzles"`
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
	Rounds int                 `json:"rounds"` // turns resolved
	Wall   int                 `json:"wall"`
	Time   float64             `json:"time"`
	Stats  map[string]StatsOut `json:"stats"`
	Awards []Award             `json:"awards"`
}

// RoomMsg is the `room` message.
type RoomMsg struct {
	T       string       `json:"t"`
	Mode    string       `json:"mode"`
	Phase   Phase        `json:"phase"`
	Host    string       `json:"host"`
	Players []PlayerInfo `json:"players"`
	Keep    string       `json:"keep"`
	Layout  *Layout      `json:"layout"`
	Level   int          `json:"level"`
	Levels  int          `json:"levels"`
	Round   int          `json:"round"` // turn within the level
	End     *End         `json:"end"`
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

// Incoming is a machine that appears at the end of the current turn.
type Incoming struct {
	Lane int    `json:"lane"`
	Kind string `json:"kind"`
}

// PlanSnap is one player's live, public queue.
type PlanSnap struct {
	PID  string `json:"pid"`
	Acts []Act  `json:"acts"`
	Done bool   `json:"done"`
}

// Snap is the `snap` message.
type Snap struct {
	T         string         `json:"t"`
	Phase     Phase          `json:"phase"`
	Time      float64        `json:"time"`
	Level     int            `json:"level"`
	Round     int            `json:"round"`
	Left      float64        `json:"left"`
	Untimed   bool           `json:"untimed"` // plan phase without a timer (the game's first turn)
	Wall      int            `json:"wall"`
	WallMax   int            `json:"wallMax"`
	Engineers []EngineerSnap `json:"engineers"`
	Bombs     []BombSnap     `json:"bombs"`
	Catapults []CatapultSnap `json:"catapults"`
	Machines  []MachineSnap  `json:"machines"`
	Incoming  []Incoming     `json:"incoming"`
	Plans     []PlanSnap     `json:"plans"`
	Ev        []any          `json:"ev"`
}

// Stage names of a slot, in order, and the machine stage.
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

// SlotTiming places one slot (and its stages) on the resolve timeline.
type SlotTiming struct {
	Slot   int           `json:"slot"`
	At     float64       `json:"at"`
	Dur    float64       `json:"dur"`
	Stages []StageTiming `json:"stages"`
}

// Hit is one machine affected by a fired bomb.
type Hit struct {
	ID     int  `json:"id"`
	Dmg    int  `json:"dmg"`
	HP     int  `json:"hp"`
	Killed bool `json:"killed"`
	Frozen int  `json:"frozen"`
}

// Fizzle reasons.
const (
	FzBlocked      = "blocked"       // move: the next cell is a wall, crate, catapult or ledge
	FzNoBomb       = "no_bomb"       // pickup: no bomb in the engineer's own cell
	FzHandsFull    = "hands_full"    // pickup: already carrying
	FzEmptyHands   = "empty_hands"   // throw, load: not carrying
	FzNoTarget     = "no_target"     // throw: nothing to throw to that way
	FzNoCatapult   = "no_catapult"   // load: not next to a catapult, up on the rampart
	FzCatapultFull = "catapult_full" // load: the catapult(s) next to you are loaded
)

// Events. Each has E set to its event name. Events of a slot carry S (their
// stage) and Slot (0-based); machine-stage events carry S only.
type (
	EvResolve struct {
		E        string       `json:"e"`
		Level    int          `json:"level"`
		Round    int          `json:"round"`
		Dur      float64      `json:"dur"`
		Slots    []SlotTiming `json:"slots"`
		Machines *StageTiming `json:"machines"`
	}
	EvFizzle struct {
		E      string `json:"e"`
		S      string `json:"s"`
		Slot   *int   `json:"slot,omitempty"`
		PID    string `json:"pid"`
		A      string `json:"a"`
		At     [2]int `json:"at"` // where the engineer stands
		Reason string `json:"reason"`
	}
	EvThrow struct {
		E      string `json:"e"`
		S      string `json:"s"`
		Slot   *int   `json:"slot,omitempty"`
		PID    string `json:"pid"`
		Bomb   int    `json:"bomb"`
		Kind   string `json:"kind"`
		From   [2]int `json:"from"`
		Dir    [2]int `json:"dir"`
		To     [2]int `json:"to"`
		Result string `json:"result"` // caught | blocked | landed
		By     string `json:"by,omitempty"`
		At     [2]int `json:"at"`
	}
	EvMove struct {
		E      string `json:"e"`
		S      string `json:"s"`
		Slot   *int   `json:"slot,omitempty"`
		PID    string `json:"pid"`
		From   [2]int `json:"from"`
		To     [2]int `json:"to"`
		Result string `json:"result"` // ok | bump
	}
	EvPickup struct {
		E      string `json:"e"`
		S      string `json:"s"`
		Slot   *int   `json:"slot,omitempty"`
		PID    string `json:"pid"`
		At     [2]int `json:"at"`
		Bomb   int    `json:"bomb"`
		Kind   string `json:"kind"`
		Result string `json:"result"` // ok | hands_full (caught a bomb earlier in the slot)
	}
	EvLoad struct {
		E      string `json:"e"`
		S      string `json:"s"`
		Slot   *int   `json:"slot,omitempty"`
		PID    string `json:"pid"`
		Cat    int    `json:"cat"`
		Bomb   int    `json:"bomb"`
		Kind   string `json:"kind"`
		Result string `json:"result"` // ok | contested
	}
	// EvFire: a catapult fired by itself (all fires are automatic). PID is
	// the engineer who loaded that bomb (absent if they were removed).
	EvFire struct {
		E    string `json:"e"`
		S    string `json:"s"`
		Slot *int   `json:"slot,omitempty"`
		PID  string `json:"pid,omitempty"`
		Cat  int    `json:"cat"`
		Lane int    `json:"lane"`
		Bomb int    `json:"bomb"`
		Kind string `json:"kind"`
		Hits []Hit  `json:"hits"`
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
		Wall  int    `json:"wall"` // after the break's heal
		Heal  int    `json:"heal"` // hit points the wall got back for the break
	}
	EvPlace struct {
		E   string `json:"e"`
		PID string `json:"pid"`
		X   int    `json:"x"`
		Y   int    `json:"y"`
	}
)
