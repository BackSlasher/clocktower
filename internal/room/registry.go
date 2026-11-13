// Package room owns live rooms: codes, session tokens, one goroutine per
// room driving its mode.Game, and websocket fan-out.
package room

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"clocktower/internal/mode"
)

// Config tunes the registry. Zero values get defaults.
type Config struct {
	MaxRooms       int            // total rooms (default 200)
	MaxConns       int            // total websocket connections (default 3000)
	IdleTimeout    time.Duration  // drop a room after this long with nobody connected (10m)
	TickRate       int            // sim ticks per second (30)
	SnapEvery      int            // ticks per snap (3 → 10 Hz)
	Speed          int            // sim steps per tick (1; >1 only for testing)
	SendQueue      int            // per-connection outbound queue (256 messages)
	WriteTimeout   time.Duration  // per message (5s)
	PingEvery      time.Duration  // ws ping interval (15s)
	CreatePerMin   float64        // room creations per IP per minute (6)
	CreateBurst    float64        // (6)
	MsgRate        float64        // inbound messages per second per connection (20)
	MsgBurst       float64        // (40)
	AbuseThreshold float64        // dropped messages (decaying 2/s) before disconnect (60)
	Modes          *mode.Registry // available modes (default mode.Default); the first is the default
	Logger         *slog.Logger
}

func (c *Config) defaults() {
	set := func(p *int, v int) {
		if *p == 0 {
			*p = v
		}
	}
	setf := func(p *float64, v float64) {
		if *p == 0 {
			*p = v
		}
	}
	setd := func(p *time.Duration, v time.Duration) {
		if *p == 0 {
			*p = v
		}
	}
	set(&c.MaxRooms, 200)
	set(&c.MaxConns, 3000)
	setd(&c.IdleTimeout, 10*time.Minute)
	set(&c.TickRate, 30)
	set(&c.SnapEvery, 3)
	set(&c.Speed, 1)
	set(&c.SendQueue, 256)
	setd(&c.WriteTimeout, 5*time.Second)
	setd(&c.PingEvery, 15*time.Second)
	setf(&c.CreatePerMin, 6)
	setf(&c.CreateBurst, 6)
	setf(&c.MsgRate, 20)
	setf(&c.MsgBurst, 40)
	setf(&c.AbuseThreshold, 60)
	if c.Modes == nil {
		c.Modes = mode.Default
	}
	if len(c.Modes.List()) == 0 {
		panic("room: no game modes registered")
	}
	if c.Logger == nil {
		c.Logger = slog.Default()
	}
}

// Registry holds all rooms.
type Registry struct {
	cfg    Config
	ctx    context.Context
	cancel context.CancelFunc

	mu    sync.Mutex
	rooms map[string]*Room
	ipLim map[string]*bucket
	conns int
	wg    sync.WaitGroup
}

// NewRegistry creates an empty registry.
func NewRegistry(cfg Config) *Registry {
	cfg.defaults()
	ctx, cancel := context.WithCancel(context.Background())
	r := &Registry{cfg: cfg, ctx: ctx, cancel: cancel, rooms: map[string]*Room{}, ipLim: map[string]*bucket{}}
	return r
}

// Close stops all rooms and waits for them.
func (r *Registry) Close() {
	r.cancel()
	r.wg.Wait()
}

// Count returns the number of live rooms.
func (r *Registry) Count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.rooms)
}

// Exists reports whether a room code is live.
func (r *Registry) Exists(code string) bool { return r.get(code) != nil }

func (r *Registry) get(code string) *Room {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.rooms[code]
}

var errBusy = errors.New("busy")

func (r *Registry) create(ip string) (*Room, error) {
	now := time.Now()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.rooms) >= r.cfg.MaxRooms {
		return nil, errBusy
	}
	b := r.ipLim[ip]
	if b == nil {
		if len(r.ipLim) > 10000 {
			for k, v := range r.ipLim {
				if now.Sub(v.last) > 10*time.Minute {
					delete(r.ipLim, k)
				}
			}
		}
		b = newBucket(r.cfg.CreatePerMin/60, r.cfg.CreateBurst, now)
		r.ipLim[ip] = b
	}
	if !b.take(now, 1) {
		return nil, errBusy
	}
	var code string
	for {
		code = newCode()
		if r.rooms[code] == nil {
			break
		}
	}
	rm := newRoom(r, code)
	r.rooms[code] = rm
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		rm.run()
	}()
	r.cfg.Logger.Info("room created", "room", code, "rooms", len(r.rooms))
	return rm, nil
}

func (r *Registry) remove(rm *Room) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.rooms[rm.code] == rm {
		delete(r.rooms, rm.code)
	}
	r.cfg.Logger.Info("room closed", "room", rm.code, "rooms", len(r.rooms))
}

func (r *Registry) addConn() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.conns >= r.cfg.MaxConns {
		return false
	}
	r.conns++
	return true
}

func (r *Registry) dropConn() {
	r.mu.Lock()
	r.conns--
	r.mu.Unlock()
}

// --- codes and tokens --------------------------------------------------------

// No I or O (look like 1 and 0).
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"

var rude = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`ANAL ANUS ARSE BUTT CLIT COCK COON CRAP CUMS CUNT DAMN DICK DYKE FAGS FUCK
		FUKK GOOK HELL HOMO JAPS JIZZ KIKE KILL MUFF NAZI NIGG PAKI PISS POOP PORN PUSS RAPE SCUM SEXY SHAT
		SHIT SLAG SLUT SPAZ SPIC TITS TURD TWAT WANK WHOR`) {
		rude[w] = true
	}
}

func newCode() string {
	for {
		var b [4]byte
		for i := range b {
			n, err := rand.Int(rand.Reader, big.NewInt(int64(len(codeAlphabet))))
			if err != nil {
				panic(err)
			}
			b[i] = codeAlphabet[n.Int64()]
		}
		if s := string(b[:]); !rude[s] {
			return s
		}
	}
}

func newToken() string {
	var b [18]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}

// NormalizeCode uppercases and validates a room code ("" if invalid).
func NormalizeCode(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	if len(s) != 4 {
		return ""
	}
	for _, c := range s {
		if c < 'A' || c > 'Z' {
			return ""
		}
	}
	return s
}

// --- connection entry point -------------------------------------------------

// Query is a parsed /ws request.
type Query struct {
	Role     string // "tv" or "player"
	Room     string
	Name     string
	Token    string
	JoinURL  func(code string) string
	JoinHost string
	IP       string
}

// Serve runs one accepted websocket until it closes.
func (r *Registry) Serve(ws *websocket.Conn, q Query) {
	ws.SetReadLimit(4096)
	c := newClient(ws, r.cfg.SendQueue, r.cfg.WriteTimeout, r.cfg.PingEvery)
	defer func() { <-c.wdone }()
	if !r.addConn() {
		c.refuse("bad_request", "Server busy, try again shortly")
		return
	}
	defer r.dropConn()

	code := NormalizeCode(q.Room)
	if len(q.Token) > 64 {
		q.Token = ""
	}
	var rm *Room
	switch q.Role {
	case "tv":
		if code != "" && q.Token != "" {
			rm = r.get(code)
		}
		if rm != nil {
			if resp := rm.join(joinReq{c: c, tv: true, token: q.Token, q: q}); resp.err != nil {
				rm = nil // unknown TV token: make a fresh room instead
			}
		}
		if rm == nil {
			var err error
			if rm, err = r.create(q.IP); err != nil {
				c.refuse("bad_request", "Server busy, try again shortly")
				return
			}
			if resp := rm.join(joinReq{c: c, tv: true, token: rm.tvToken, q: q}); resp.err != nil {
				c.refuse(resp.err.Code, resp.err.Msg)
				return
			}
		}
		r.readLoop(c, rm, "")
	case "player":
		if code == "" || r.get(code) == nil {
			c.refuse("no_room", "No room with that code")
			return
		}
		rm = r.get(code)
		resp := rm.join(joinReq{c: c, token: q.Token, name: q.Name, q: q})
		if resp.err != nil {
			c.refuse(resp.err.Code, resp.err.Msg)
			return
		}
		r.readLoop(c, rm, resp.pid)
	default:
		c.refuse("bad_request", "Unknown role")
	}
}

func (r *Registry) readLoop(c *client, rm *Room, pid string) {
	defer func() {
		rm.post(leaveReq{c: c, pid: pid})
		c.kill(websocket.StatusNormalClosure, "")
	}()
	now := time.Now()
	lim := newBucket(r.cfg.MsgRate, r.cfg.MsgBurst, now)
	abuse := newBucket(2, r.cfg.AbuseThreshold, now) // drains as messages are dropped
	pong := []byte(`{"t":"pong"}`)
	for {
		typ, data, err := c.ws.Read(r.ctx)
		if err != nil {
			return
		}
		now := time.Now()
		if !lim.take(now, 1) {
			if !abuse.take(now, 1) {
				r.cfg.Logger.Warn("dropping abusive connection", "room", rm.code, "pid", pid)
				c.kill(websocket.StatusPolicyViolation, "rate limit")
				return
			}
			continue
		}
		if typ != websocket.MessageText {
			continue
		}
		var head struct {
			T string `json:"t"`
		}
		if json.Unmarshal(data, &head) != nil {
			c.sendJSON(errorMsg{T: "error", Code: "bad_request", Msg: "Malformed message"})
			continue
		}
		if head.T == "ping" {
			c.send(pong)
			continue
		}
		if pid == "" {
			continue // TV sends nothing
		}
		if head.T == "mode" {
			var req struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(data, &req); err != nil {
				c.sendJSON(errorMsg{T: "error", Code: "bad_request", Msg: "Malformed message"})
				continue
			}
			if !rm.post(modeReq{c: c, pid: pid, id: req.ID}) {
				return
			}
			continue
		}
		if head.T == "pause" {
			var req struct {
				On bool `json:"on"`
			}
			if err := json.Unmarshal(data, &req); err != nil {
				c.sendJSON(errorMsg{T: "error", Code: "bad_request", Msg: "Malformed message"})
				continue
			}
			if !rm.post(pauseReq{c: c, pid: pid, on: req.On}) {
				return
			}
			continue
		}
		if head.T == "kick" || head.T == "leave" {
			var req struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(data, &req); err != nil {
				c.sendJSON(errorMsg{T: "error", Code: "bad_request", Msg: "Malformed message"})
				continue
			}
			if !rm.post(removeReq{c: c, pid: pid, target: req.ID, kick: head.T == "kick"}) {
				return
			}
			continue
		}
		// Everything else goes to the game, which ignores types it does not know.
		if !rm.post(cmdReq{c: c, pid: pid, typ: head.T, raw: data}) {
			return
		}
	}
}
