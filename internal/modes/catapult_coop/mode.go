package catapultcoop

import (
	"encoding/json"
	"math/rand/v2"
	"strconv"
	"strings"
	"sync"

	"clocktower/internal/mode"
)

// ModeID is this mode's stable id; Info is its one display-name site.
const ModeID = "catapult_coop"

// Info is the registry entry.
var Info = mode.Info{ID: ModeID, Name: "Bomb Voyage", Tagline: "Bombs up, machines down"}

// Register adds the mode to the default registry.
func Register() { RegisterTo(mode.Default) }

// RegisterTo adds the mode to r.
func RegisterTo(r *mode.Registry) { r.Register(Info, newMode) }

func newMode(rng *rand.Rand, roster []mode.Member) mode.Game {
	return &modeGame{NewFromRoster(rng, roster)}
}

var knownCmds = map[string]bool{"start": true, "restart": true, "plan": true, "ready": true}

// modeGame adapts *Game to mode.Game (the concrete methods return concrete
// wire types, which tests and bots use).
type modeGame struct{ *Game }

func (m *modeGame) RoomState() any { return m.Game.RoomState() }
func (m *modeGame) Snapshot() any  { return m.Game.Snapshot() }
func (m *modeGame) View() any      { return m.Game.View() }

func (m *modeGame) Command(pid, typ string, raw []byte) error {
	if !knownCmds[typ] {
		return nil
	}
	var c Cmd
	if err := json.Unmarshal(raw, &c); err != nil {
		return badReq("Malformed message")
	}
	return m.Game.Apply(pid, c)
}

// MapT is the `map` payload: the keep shells. Each level's interior comes
// in the `room` message (`layout`).
type MapT struct {
	Keeps []*Keep `json:"keeps"`
}

var setup struct {
	once sync.Once
	v    mode.Setup
}

func (m *modeGame) Setup() mode.Setup {
	setup.once.Do(func() {
		setup.v.Map, _ = json.Marshal(MapT{Keeps: Keeps})
		setup.v.Defs, _ = json.Marshal(Defs)
	})
	return setup.v
}

// Roster lists the players in join order.
func (g *Game) Roster() []mode.Member {
	out := make([]mode.Member, 0, len(g.players))
	for _, p := range g.players {
		out = append(out, mode.Member{ID: p.id, Name: p.name, Color: p.color, Connected: p.connected, Host: p.id == g.host})
	}
	return out
}

// NewFromRoster creates a lobby game seating the given players (ids, names,
// colours, connected state and host kept). Players beyond MaxPlayers are
// dropped.
func NewFromRoster(rng *rand.Rand, roster []mode.Member) *Game {
	g := New(rng)
	for _, m := range roster {
		if len(g.players) >= Defs.MaxPlayers {
			break
		}
		p := &player{id: m.ID, name: m.Name, color: m.Color}
		if m.Connected {
			p.connected = true
			g.connSeq++
			p.connSeq = g.connSeq
		}
		g.players = append(g.players, p)
		if n, err := strconv.Atoi(strings.TrimPrefix(m.ID, "p")); err == nil && n >= g.nextPID {
			g.nextPID = n + 1
		}
		if m.Host {
			g.host = m.ID
		}
	}
	if g.player(g.host) == nil {
		g.host = ""
		for _, p := range g.players {
			if p.connected {
				g.host = p.id
				break
			}
		}
		if g.host == "" && len(g.players) > 0 {
			g.host = g.players[0].id
		}
	}
	g.slowVer++
	return g
}
