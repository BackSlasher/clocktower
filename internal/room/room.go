package room

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/coder/websocket"

	"clocktower/internal/mode"
)

// Room is one live game. All fields below the channel are owned by the
// room goroutine; other goroutines talk to it only through inbox.
type Room struct {
	code    string
	tvToken string
	reg     *Registry
	inbox   chan any
	closed  chan struct{}

	modeID    string
	game      mode.Game
	tv        *client
	players   map[string]*client // pid → current connection
	tokens    map[string]string  // token → pid
	revoked   map[string]bool    // tokens of kicked players: refused with `kicked`
	lastSlow  uint64
	lastPhase mode.Phase
	idleSince time.Time
	tick      int
	pausedBy  string // pid of the host who paused the game; "" = not paused
	nextPID   int    // one above the highest player id number ever seated here
}

type joinReq struct {
	c     *client
	tv    bool
	token string
	name  string
	q     Query
	reply chan joinResp
}

type joinResp struct {
	pid string
	err *mode.Error
}

type leaveReq struct {
	c   *client
	pid string
}

type cmdReq struct {
	c   *client
	pid string
	typ string
	raw []byte
}

// removeReq is a `kick` (target set) or a `leave` (target empty).
type removeReq struct {
	c      *client
	pid    string
	target string
	kick   bool
}

type pauseReq struct {
	c   *client
	pid string
	on  bool
}

type modeReq struct {
	c   *client
	pid string
	id  string
}

func newRoom(reg *Registry, code string) *Room {
	def := reg.cfg.Modes.List()[0].ID
	rm := &Room{
		code: code, tvToken: newToken(), reg: reg,
		inbox: make(chan any, 256), closed: make(chan struct{}),
		players: map[string]*client{}, tokens: map[string]string{}, revoked: map[string]bool{},
		idleSince: time.Now(), lastPhase: mode.PhaseLobby,
	}
	rm.modeID = def
	rm.game = rm.newGame(def, nil)
	return rm
}

// newGame makes a game of the given (registered) mode with a fresh seed.
func (rm *Room) newGame(id string, roster []mode.Member) mode.Game {
	var seed [2]uint64
	for i := range seed {
		seed[i] = rand.Uint64()
	}
	m, _ := rm.reg.cfg.Modes.Get(id)
	return m.New(rand.New(rand.NewPCG(seed[0], seed[1])), roster)
}

// post delivers a message to the room goroutine; false if the room is gone.
func (rm *Room) post(m any) bool {
	select {
	case rm.inbox <- m:
		return true
	case <-rm.closed:
		return false
	}
}

func (rm *Room) join(j joinReq) joinResp {
	j.reply = make(chan joinResp, 1)
	if !rm.post(j) {
		return joinResp{err: mode.ErrNoRoom}
	}
	select {
	case r := <-j.reply:
		return r
	case <-rm.closed:
		return joinResp{err: mode.ErrNoRoom}
	}
}

func (rm *Room) run() {
	defer close(rm.closed)
	defer rm.reg.remove(rm)
	dt := time.Second / time.Duration(rm.reg.cfg.TickRate)
	ticker := time.NewTicker(dt)
	defer ticker.Stop()
	for {
		select {
		case <-rm.reg.ctx.Done():
			rm.closeAll(websocket.StatusGoingAway, "server shutting down")
			return
		case m := <-rm.inbox:
			rm.handle(m)
		case <-ticker.C:
			if rm.connCount() == 0 && time.Since(rm.idleSince) > rm.reg.cfg.IdleTimeout {
				return
			}
			rm.step(dt.Seconds())
		}
		rm.flushSlow()
		rm.checkPause()
	}
}

func (rm *Room) connCount() int {
	n := len(rm.players)
	if rm.tv != nil {
		n++
	}
	return n
}

func (rm *Room) closeAll(code websocket.StatusCode, reason string) {
	if rm.tv != nil {
		rm.tv.kill(code, reason)
	}
	for _, c := range rm.players {
		c.kill(code, reason)
	}
}

func (rm *Room) step(dt float64) {
	g := rm.game
	for i := 0; i < rm.reg.cfg.Speed && g.Running() && rm.pausedBy == ""; i++ {
		g.Step(dt)
	}
	rm.tick++
	ph := g.Phase()
	ended := ph != rm.lastPhase && (ph == mode.PhaseWon || ph == mode.PhaseLost)
	if (g.Running() && rm.tick%rm.reg.cfg.SnapEvery == 0) || ended {
		rm.broadcastJSON(g.Snapshot())
	}
	if ph != rm.lastPhase {
		rm.lastPhase = ph
	}
}

func (rm *Room) flushSlow() {
	if v := rm.game.SlowVersion(); v != rm.lastSlow {
		rm.lastSlow = v
		rm.broadcastJSON(rm.game.RoomState())
	}
}

func (rm *Room) broadcastJSON(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		rm.reg.cfg.Logger.Error("marshal", "err", err)
		return
	}
	if rm.tv != nil {
		rm.tv.send(b)
	}
	for _, c := range rm.players {
		c.send(b)
	}
}

func (rm *Room) handle(m any) {
	switch m := m.(type) {
	case joinReq:
		m.reply <- rm.handleJoin(m)
	case leaveReq:
		if m.pid == "" {
			if rm.tv == m.c {
				rm.tv = nil
			}
		} else if rm.players[m.pid] == m.c {
			delete(rm.players, m.pid)
			rm.game.SetConnected(m.pid, false)
		}
		if rm.connCount() == 0 {
			rm.idleSince = time.Now()
		}
	case cmdReq:
		if rm.players[m.pid] != m.c {
			return // superseded connection
		}
		if rm.pausedBy != "" && m.typ != "restart" {
			m.c.sendError(ErrPaused)
			return
		}
		if err := rm.game.Command(m.pid, m.typ, m.raw); err != nil {
			m.c.sendError(err)
		}
	case modeReq:
		if rm.players[m.pid] != m.c {
			return
		}
		if err := rm.switchMode(m.pid, m.id); err != nil {
			m.c.sendError(err)
		}
	case pauseReq:
		if rm.players[m.pid] != m.c {
			return
		}
		if err := rm.setPause(m.pid, m.on); err != nil {
			m.c.sendError(err)
		}
	case removeReq:
		if rm.players[m.pid] != m.c {
			return
		}
		if err := rm.removePlayer(m); err != nil {
			m.c.sendError(err)
		}
	}
}

// ErrPaused refuses game commands while the host has paused the game.
var ErrPaused = &mode.Error{Code: "paused", Msg: "The game is paused"}

type pausedMsg struct {
	T  string `json:"t"`
	On bool   `json:"on"`
	By string `json:"by,omitempty"`
}

// setPause handles `pause` (host only, only while the game is running).
func (rm *Room) setPause(pid string, on bool) error {
	g := rm.game
	if pid != g.Host() {
		return mode.ErrNotHost
	}
	if !g.Running() {
		return &mode.Error{Code: "bad_request", Msg: "No game is running"}
	}
	switch {
	case on && rm.pausedBy == "":
		rm.pausedBy = pid
	case !on && rm.pausedBy != "":
		rm.pausedBy = ""
	default:
		return nil
	}
	rm.broadcastJSON(pausedMsg{T: "paused", On: on, By: rm.pausedBy})
	return nil
}

// checkPause clears the pause once it no longer applies: the game left the
// running phases (ended, restarted, mode switched) or the player who paused
// is no longer the host (removed, or disconnected while others were
// connected so the host moved on; a reconnect that keeps the host keeps the
// pause).
func (rm *Room) checkPause() {
	if rm.pausedBy == "" {
		return
	}
	if g := rm.game; !g.Running() || g.Host() != rm.pausedBy {
		rm.pausedBy = ""
		rm.broadcastJSON(pausedMsg{T: "paused"})
	}
}

// Close reasons of a removed player's socket.
const (
	ReasonKicked = "kicked"
	ReasonLeft   = "left"
)

// removePlayer handles `kick` (host only, not themselves, any phase) and
// `leave`: the game drops the player, their session token stops working (a
// kicked player's token is refused with `kicked` from then on; the person
// may still join again as a new player) and their socket is closed with
// reason `kicked` or `left`. The new room state goes out via flushSlow.
func (rm *Room) removePlayer(m removeReq) error {
	g := rm.game
	target, reason := m.pid, ReasonLeft
	if m.kick {
		if m.pid != g.Host() {
			return mode.ErrNotHost
		}
		if m.target == m.pid {
			return &mode.Error{Code: "bad_request", Msg: "You can't remove yourself; use Leave"}
		}
		if m.target == "" || !g.HasPlayer(m.target) {
			return &mode.Error{Code: "bad_request", Msg: "No such player"}
		}
		target, reason = m.target, ReasonKicked
	}
	g.RemovePlayer(target)
	for t, p := range rm.tokens {
		if p == target {
			delete(rm.tokens, t)
			if m.kick {
				rm.revoked[t] = true
			}
		}
	}
	if c := rm.players[target]; c != nil {
		delete(rm.players, target)
		c.kill(websocket.StatusNormalClosure, reason)
	}
	if rm.connCount() == 0 {
		rm.idleSince = time.Now()
	}
	return nil
}

// ErrKicked refuses a connection that presents a kicked player's token.
var ErrKicked = &mode.Error{Code: "kicked", Msg: "The host removed you from the game"}

type setupMsg struct {
	T    string          `json:"t"`
	Mode string          `json:"mode"`
	Map  json.RawMessage `json:"map"`
	Defs json.RawMessage `json:"defs"`
}

// switchMode replaces the game with a fresh one of another mode, carrying the
// players over, and tells every connection (setup, then room).
func (rm *Room) switchMode(pid, id string) error {
	g := rm.game
	if pid != g.Host() {
		return mode.ErrNotHost
	}
	if g.Phase() != mode.PhaseLobby {
		return &mode.Error{Code: "bad_request", Msg: "The mode can only change in the lobby"}
	}
	m, ok := rm.reg.cfg.Modes.Get(id)
	if !ok {
		return &mode.Error{Code: "bad_request", Msg: "No such mode"}
	}
	if id == rm.modeID {
		return nil
	}
	// Every seated player counts, connected or not; nobody is dropped silently.
	if len(g.Roster()) > m.MaxPlayers {
		return mode.ErrTooManyPlayers(m.Info)
	}
	ng := rm.newGame(id, g.Roster())
	ng.ReservePIDs(rm.nextPID) // ids of removed players are never handed out again
	rm.game, rm.modeID = ng, id
	rm.lastPhase = mode.PhaseLobby
	// Players the new mode could not seat lose their seat.
	for p, c := range rm.players {
		if !ng.HasPlayer(p) {
			delete(rm.players, p)
			c.kill(websocket.StatusNormalClosure, "no seat in this mode")
		}
	}
	for t, p := range rm.tokens {
		if !ng.HasPlayer(p) {
			delete(rm.tokens, t)
		}
	}
	rm.lastSlow = ng.SlowVersion()
	s := ng.Setup()
	rm.broadcastJSON(setupMsg{T: "setup", Mode: id, Map: s.Map, Defs: s.Defs})
	rm.broadcastJSON(ng.RoomState())
	return nil
}

type welcomeMsg struct {
	T        string          `json:"t"`
	Role     string          `json:"role"`
	Room     string          `json:"room"`
	Token    string          `json:"token"`
	You      string          `json:"you,omitempty"`
	JoinURL  string          `json:"joinUrl"`
	JoinHost string          `json:"joinHost"`
	Mode     string          `json:"mode"`
	Modes    []mode.Info     `json:"modes"`
	Map      json.RawMessage `json:"map"`
	Defs     json.RawMessage `json:"defs"`
}

func (rm *Room) handleJoin(j joinReq) joinResp {
	g := rm.game
	s := g.Setup()
	w := welcomeMsg{T: "welcome", Room: rm.code, JoinHost: j.q.JoinHost,
		Mode: rm.modeID, Modes: rm.reg.cfg.Modes.List(), Map: s.Map, Defs: s.Defs}
	if j.q.JoinURL != nil {
		w.JoinURL = j.q.JoinURL(rm.code)
	}
	var pid string
	if j.tv {
		if j.token != rm.tvToken {
			return joinResp{err: mode.ErrBadRequest}
		}
		if rm.tv != nil {
			rm.tv.kill(websocket.StatusNormalClosure, "replaced")
		}
		rm.tv = j.c
		w.Role, w.Token = "tv", rm.tvToken
	} else {
		token := j.token
		if rm.revoked[token] {
			return joinResp{err: ErrKicked}
		}
		pid = rm.tokens[token]
		if pid != "" && !g.HasPlayer(pid) {
			delete(rm.tokens, token) // evicted from the lobby earlier
			pid = ""
		}
		if pid == "" {
			var evicted string
			var err error
			pid, evicted, err = g.AddPlayer(j.name)
			if err != nil {
				e, _ := err.(*mode.Error)
				if e == nil {
					e = mode.ErrBadRequest
				}
				return joinResp{err: e}
			}
			if evicted != "" {
				for t, p := range rm.tokens {
					if p == evicted {
						delete(rm.tokens, t)
					}
				}
			}
			token = newToken()
			rm.tokens[token] = pid
			var n int
			if _, err := fmt.Sscanf(pid, "p%d", &n); err == nil && n >= rm.nextPID {
				rm.nextPID = n + 1
			}
		}
		if old := rm.players[pid]; old != nil {
			old.kill(websocket.StatusNormalClosure, "replaced")
		}
		rm.players[pid] = j.c
		g.SetConnected(pid, true)
		w.Role, w.Token, w.You = "player", token, pid
	}
	j.c.sendJSON(w)
	// The welcome is followed by the current room state (sent directly so the
	// newcomer gets it even if nothing changed) and, mid-game, a snap.
	rs, _ := json.Marshal(g.RoomState())
	rm.lastSlow = g.SlowVersion()
	if rm.tv != nil && rm.tv != j.c {
		rm.tv.send(rs)
	}
	for _, c := range rm.players {
		if c != j.c {
			c.send(rs)
		}
	}
	j.c.send(rs)
	if g.Running() || g.Phase() == mode.PhaseWon || g.Phase() == mode.PhaseLost {
		j.c.sendJSON(g.View())
	}
	j.c.sendJSON(pausedMsg{T: "paused", On: rm.pausedBy != "", By: rm.pausedBy})
	return joinResp{pid: pid}
}
