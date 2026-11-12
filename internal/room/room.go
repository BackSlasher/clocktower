package room

import (
	"encoding/json"
	"math/rand/v2"
	"time"

	"github.com/coder/websocket"

	"clocktower/internal/game"
)

// Room is one live game. All fields below the channel are owned by the
// room goroutine; other goroutines talk to it only through inbox.
type Room struct {
	code    string
	tvToken string
	reg     *Registry
	inbox   chan any
	closed  chan struct{}

	game      *game.Game
	tv        *client
	players   map[string]*client // pid → current connection
	tokens    map[string]string  // token → pid
	lastSlow  uint64
	lastPhase game.Phase
	idleSince time.Time
	tick      int
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
	err *game.Error
}

type leaveReq struct {
	c   *client
	pid string
}

type cmdReq struct {
	c   *client
	pid string
	cmd game.Cmd
}

func newRoom(reg *Registry, code string) *Room {
	var seed [2]uint64
	for i := range seed {
		seed[i] = rand.Uint64()
	}
	return &Room{
		code: code, tvToken: newToken(), reg: reg,
		inbox: make(chan any, 256), closed: make(chan struct{}),
		game:    game.New(rand.New(rand.NewPCG(seed[0], seed[1]))),
		players: map[string]*client{}, tokens: map[string]string{},
		idleSince: time.Now(), lastPhase: game.PhaseLobby,
	}
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
		return joinResp{err: game.ErrNoRoom}
	}
	select {
	case r := <-j.reply:
		return r
	case <-rm.closed:
		return joinResp{err: game.ErrNoRoom}
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
	for i := 0; i < rm.reg.cfg.Speed && g.Running(); i++ {
		g.Step(dt)
	}
	rm.tick++
	ph := g.Phase()
	ended := ph != rm.lastPhase && (ph == game.PhaseWon || ph == game.PhaseLost)
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
		if err := rm.game.Apply(m.pid, m.cmd); err != nil {
			e, ok := err.(*game.Error)
			if !ok {
				e = game.ErrBadRequest
			}
			m.c.sendJSON(errorMsg{T: "error", Code: e.Code, Msg: e.Msg})
		}
	}
}

type welcomeMsg struct {
	T        string          `json:"t"`
	Role     string          `json:"role"`
	Room     string          `json:"room"`
	Token    string          `json:"token"`
	You      string          `json:"you,omitempty"`
	JoinURL  string          `json:"joinUrl"`
	JoinHost string          `json:"joinHost"`
	Map      json.RawMessage `json:"map"`
	Defs     json.RawMessage `json:"defs"`
}

func (rm *Room) handleJoin(j joinReq) joinResp {
	g := rm.game
	w := welcomeMsg{T: "welcome", Room: rm.code, JoinHost: j.q.JoinHost,
		Map: rm.reg.welcome.mapJSON, Defs: rm.reg.welcome.defsJSON}
	if j.q.JoinURL != nil {
		w.JoinURL = j.q.JoinURL(rm.code)
	}
	var pid string
	if j.tv {
		if j.token != rm.tvToken {
			return joinResp{err: game.ErrBadRequest}
		}
		if rm.tv != nil {
			rm.tv.kill(websocket.StatusNormalClosure, "replaced")
		}
		rm.tv = j.c
		w.Role, w.Token = "tv", rm.tvToken
	} else {
		token := j.token
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
				e, _ := err.(*game.Error)
				if e == nil {
					e = game.ErrBadRequest
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
	if g.Running() || g.Phase() == game.PhaseWon || g.Phase() == game.PhaseLost {
		j.c.sendJSON(g.View())
	}
	return joinResp{pid: pid}
}
