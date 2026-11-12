// Package stub is a minimal second mode for exercising the multi-mode path
// (mode selection, setup, switching back and forth). It is registered only
// when the server runs with -stub-mode and is the template for a new mode:
// a lobby, a host-started "running" phase and a restart back to the lobby.
// Nothing happens while it runs except a clock in its snapshot.
package stub

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"strings"
	"unicode"
	"unicode/utf8"

	"clocktower/internal/mode"
)

// ModeID is the mode's stable id; Info is the one place its display name lives.
const ModeID = "stub"

var Info = mode.Info{ID: ModeID, Name: "Stub", Tagline: "Test mode — does nothing"}

// PhaseRunning is the only phase besides the lobby.
const PhaseRunning mode.Phase = "running"

const (
	maxPlayers = 8
	nameMax    = 12
)

var palette = []string{"#e0a030", "#4fb39a", "#d1594a", "#6f8fe0", "#c77dd6", "#9bc53d", "#e07a30", "#3ec1d3"}

// Register adds the mode to the default registry.
func Register() { RegisterTo(mode.Default) }

// RegisterTo adds the mode to r.
func RegisterTo(r *mode.Registry) { r.Register(Info, New) }

// New is the mode factory; a non-empty roster is adopted as is.
func New(_ *rand.Rand, roster []mode.Member) mode.Game {
	g := &Game{phase: mode.PhaseLobby, nextPID: 1, slowVer: 1}
	for _, m := range roster {
		if len(g.players) >= maxPlayers {
			break
		}
		g.players = append(g.players, m)
		var n int
		if _, err := fmt.Sscanf(m.ID, "p%d", &n); err == nil && n >= g.nextPID {
			g.nextPID = n + 1
		}
		if m.Host {
			g.host = m.ID
		}
	}
	g.fixHost()
	return g
}

// Game implements mode.Game.
type Game struct {
	players []mode.Member
	host    string
	nextPID int
	phase   mode.Phase
	time    float64
	slowVer uint64
}

type playerInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	Connected bool   `json:"connected"`
}

type roomMsg struct {
	T       string       `json:"t"`
	Mode    string       `json:"mode"`
	Phase   mode.Phase   `json:"phase"`
	Host    string       `json:"host"`
	Players []playerInfo `json:"players"`
}

type snapMsg struct {
	T       string     `json:"t"`
	Phase   mode.Phase `json:"phase"`
	Time    float64    `json:"time"`
	Seconds int        `json:"seconds"`
}

func (g *Game) index(pid string) int {
	for i := range g.players {
		if g.players[i].ID == pid {
			return i
		}
	}
	return -1
}

// fixHost keeps the host valid: the current one, else the first connected
// player, else the first player.
func (g *Game) fixHost() {
	if i := g.index(g.host); i >= 0 && g.players[i].Connected {
		return
	}
	g.host = ""
	for _, p := range g.players {
		if p.Connected {
			g.host = p.ID
			return
		}
	}
	if len(g.players) > 0 && g.index(g.host) < 0 {
		g.host = g.players[0].ID
	}
}

func sanitize(s string) (string, bool) {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.ToValidUTF8(s, ""))
	s = strings.Join(strings.Fields(s), " ")
	n := utf8.RuneCountInString(s)
	return s, n >= 1 && n <= nameMax
}

func (g *Game) AddPlayer(name string) (string, string, error) {
	name, ok := sanitize(name)
	if !ok {
		return "", "", mode.ErrBadName
	}
	if len(g.players) >= maxPlayers {
		return "", "", mode.ErrRoomFull
	}
	used := map[string]bool{}
	for _, p := range g.players {
		used[p.Color] = true
	}
	color := palette[0]
	for _, c := range palette {
		if !used[c] {
			color = c
			break
		}
	}
	m := mode.Member{ID: fmt.Sprintf("p%d", g.nextPID), Name: name, Color: color}
	g.nextPID++
	g.players = append(g.players, m)
	if g.host == "" {
		g.host = m.ID
	}
	g.slowVer++
	return m.ID, "", nil
}

func (g *Game) HasPlayer(pid string) bool { return g.index(pid) >= 0 }

func (g *Game) SetConnected(pid string, on bool) {
	i := g.index(pid)
	if i < 0 || g.players[i].Connected == on {
		return
	}
	g.players[i].Connected = on
	if on && (g.index(g.host) < 0 || !g.players[g.index(g.host)].Connected) {
		g.host = pid
	} else if !on && g.host == pid {
		g.fixHost()
	}
	g.slowVer++
}

func (g *Game) Host() string { return g.host }

func (g *Game) Roster() []mode.Member {
	out := make([]mode.Member, len(g.players))
	for i, p := range g.players {
		p.Host = p.ID == g.host
		out[i] = p
	}
	return out
}

// Command handles "start" (host, lobby) and "restart" (host, while running).
func (g *Game) Command(pid, typ string, _ []byte) error {
	switch typ {
	case "start":
		if pid != g.host {
			return mode.ErrNotHost
		}
		if g.phase != mode.PhaseLobby {
			return mode.ErrBadRequest
		}
		g.phase, g.time = PhaseRunning, 0
	case "restart":
		if pid != g.host {
			return mode.ErrNotHost
		}
		if g.phase != PhaseRunning {
			return mode.ErrBadRequest
		}
		g.phase = mode.PhaseLobby
	default:
		return nil
	}
	g.slowVer++
	return nil
}

func (g *Game) Step(dt float64)     { g.time += dt }
func (g *Game) Running() bool       { return g.phase == PhaseRunning }
func (g *Game) Phase() mode.Phase   { return g.phase }
func (g *Game) SlowVersion() uint64 { return g.slowVer }

func (g *Game) Setup() mode.Setup {
	return mode.Setup{Map: json.RawMessage(`{}`), Defs: json.RawMessage(`{"maxPlayers":8}`)}
}

func (g *Game) RoomState() any {
	ps := make([]playerInfo, len(g.players))
	for i, p := range g.players {
		ps[i] = playerInfo{ID: p.ID, Name: p.Name, Color: p.Color, Connected: p.Connected}
	}
	return roomMsg{T: "room", Mode: ModeID, Phase: g.phase, Host: g.host, Players: ps}
}

func (g *Game) Snapshot() any {
	return snapMsg{T: "snap", Phase: g.phase, Time: g.time, Seconds: int(g.time)}
}
func (g *Game) View() any { return g.Snapshot() }
