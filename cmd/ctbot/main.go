// Command ctbot joins a Clocktower room as N scripted players over real
// websockets and plays. Without -room it first opens a TV connection to
// create a room (and acts as that TV, counting what it receives).
//
//	ctbot -url http://localhost:8080 -room ABCD -n 4 [-skill good|bad|casual|idle] [-name-prefix Bot] [-no-start] [-loop] [-mode ID]
//
// Bots take perks from their offers by sending `perk` like a phone does.
// They play whatever mode the room is in (`welcome.mode`, `setup.mode`,
// `room.mode`): tower_defense or catapult_coop. With -mode, the host bot
// switches the room to that mode in the lobby before starting.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/coder/websocket"

	cc "clocktower/internal/modes/catapult_coop"
	ccbot "clocktower/internal/modes/catapult_coop/bot"
	game "clocktower/internal/modes/tower_defense"
	"clocktower/internal/modes/tower_defense/bot"
)

var (
	baseURL    = flag.String("url", "http://localhost:8080", "server base URL")
	roomCode   = flag.String("room", "", "room code to join (empty: create one via a TV connection)")
	n          = flag.Int("n", 4, "number of bot players (1-8)")
	skillName  = flag.String("skill", "good", "good|bad|casual|idle")
	namePrefix = flag.String("name-prefix", "Bot", "bot name prefix")
	names      = flag.String("names", "", "comma-separated bot names (e.g. Ada,Brunel,Tesla,Watt); overrides -name-prefix, extra bots fall back to it")
	noStart    = flag.Bool("no-start", false, "never press start")
	loop       = flag.Bool("loop", false, "after the game ends, host restarts and plays again")
	taps       = flag.Float64("taps", 3, "winding taps per second per bot")
	startWait  = flag.Duration("start-wait", 2*time.Second, "how long the host waits for the other bots before starting")
	quiet      = flag.Bool("q", false, "less logging")
	modeID     = flag.String("mode", "", "host switches the room to this mode id in the lobby before starting (e.g. catapult_coop)")
	planDelay  = flag.Float64("plan-delay", 1.5, "catapult_coop: seconds into a plan phase before a bot commits (staggered per bot)")
)

type fatalErr struct{ code, msg string }

func (e fatalErr) Error() string { return e.code + ": " + e.msg }

func wsURL(params url.Values) string {
	u, err := url.Parse(*baseURL)
	if err != nil {
		log.Fatalf("bad -url: %v", err)
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	default:
		u.Scheme = "ws"
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/ws"
	u.RawQuery = params.Encode()
	return u.String()
}

func main() {
	flag.Parse()
	log.SetFlags(log.Ltime)
	skill, ok := bot.ParseSkill(*skillName)
	if !ok || *n < 1 || *n > 8 {
		flag.Usage()
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	code := strings.ToUpper(*roomCode)
	var tvDone chan tvStats
	if code == "" {
		codeCh := make(chan string, 1)
		tvDone = make(chan tvStats, 1)
		go func() { tvDone <- runTV(ctx, codeCh) }()
		select {
		case code = <-codeCh:
		case <-time.After(10 * time.Second):
			log.Fatal("TV connection did not get a room")
		}
		log.Printf("created room %s", code)
	}

	results := make(chan *outcome, *n)
	var wg sync.WaitGroup
	for i := 0; i < *n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			seed := uint64(time.Now().UnixNano()) + uint64(i)*7919
			p := &player{idx: i, name: botName(i), room: code,
				bot: bot.New("", skill, seed), cb: ccbot.New("", seed)}
			p.bot.TapsPerSec = *taps
			p.cb.Delay = *planDelay + 0.4*float64(i)
			p.cb.NoPerks = skill == bot.Idle
			if skill == bot.Bad || skill == bot.Casual {
				p.cb.Mistake = map[bot.Skill]float64{bot.Bad: 0.4, bot.Casual: 0.1}[skill]
			}
			end, err := p.run(ctx)
			if err != nil && ctx.Err() == nil {
				log.Printf("[%s] stopped: %v", p.name, err)
			}
			results <- end
		}(i)
		time.Sleep(150 * time.Millisecond) // join in order: bot 1 is host
	}
	wg.Wait()
	close(results)
	var end *outcome
	for e := range results {
		if e != nil {
			end = e
		}
	}
	cancel()
	if tvDone != nil {
		st := <-tvDone
		log.Printf("TV received: %d welcome, %d room, %d snap, %d events (%v)", st.welcome, st.room, st.snap, st.events, st.kinds)
	}
	if end == nil {
		log.Print("no game result")
		os.Exit(1)
	}
	log.Printf("RESULT mode=%s won=%v %s", end.mode, end.won, end.desc)
	fmt.Println(string(end.raw))
}

// outcome is a finished game as one bot saw it.
type outcome struct {
	mode string
	won  bool
	desc string
	raw  json.RawMessage // the room's `end` object
}

// --- TV ---------------------------------------------------------------------

type tvStats struct {
	welcome, room, snap, events int
	kinds                       map[string]int
}

func runTV(ctx context.Context, codeCh chan<- string) tvStats {
	st := tvStats{kinds: map[string]int{}}
	c, _, err := websocket.Dial(ctx, wsURL(url.Values{"role": {"tv"}}), nil)
	if err != nil {
		log.Fatalf("TV dial: %v", err)
	}
	defer c.CloseNow()
	c.SetReadLimit(1 << 22)
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			return st
		}
		var m struct {
			T    string            `json:"t"`
			Room string            `json:"room"`
			Ev   []json.RawMessage `json:"ev"`
		}
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		switch m.T {
		case "welcome":
			st.welcome++
			codeCh <- m.Room
		case "room":
			st.room++
		case "snap":
			st.snap++
			for _, e := range m.Ev {
				var ev struct {
					E string `json:"e"`
				}
				_ = json.Unmarshal(e, &ev)
				st.events++
				st.kinds[ev.E]++
			}
		}
	}
}

// --- players -----------------------------------------------------------------

type player struct {
	idx   int
	name  string
	room  string
	token string
	bot   *bot.Bot
	cb    *ccbot.Bot

	you       string
	mode      string     // the room's current mode id
	keeps     []*cc.Keep // catapult_coop map
	rm        *game.RoomMsg
	snap      *game.Snap
	crm       *cc.RoomMsg // catapult_coop room / snap
	csnap     *cc.Snap
	modeAsked time.Time
	started   time.Time // when this bot first saw the lobby as host
	restartAt time.Time
	lastSend  time.Time
	queued    []game.Cmd
	windAcc   map[int]int
	lastWind  time.Time
}

func (p *player) logf(format string, a ...any) {
	if !*quiet {
		log.Printf("[%s] "+format, append([]any{p.name}, a...)...)
	}
}

// run keeps a connection up (reconnecting with the token) until the game
// ends or a fatal error arrives.
func (p *player) run(ctx context.Context) (*outcome, error) {
	backoff := 300 * time.Millisecond
	for ctx.Err() == nil {
		end, err := p.session(ctx)
		if end != nil {
			return end, nil
		}
		var fe fatalErr
		if errors.As(err, &fe) {
			return nil, err
		}
		p.logf("disconnected (%v); reconnecting in %v", err, backoff)
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
		}
		backoff = min(5*time.Second, backoff*2)
	}
	return nil, ctx.Err()
}

func (p *player) session(ctx context.Context) (*outcome, error) {
	q := url.Values{"role": {"player"}, "room": {p.room}, "name": {p.name}}
	if p.token != "" {
		q.Set("token", p.token)
	}
	dctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	c, _, err := websocket.Dial(dctx, wsURL(q), nil)
	cancel()
	if err != nil {
		return nil, err
	}
	defer c.CloseNow()
	c.SetReadLimit(1 << 22)

	msgs := make(chan []byte, 64)
	rerr := make(chan error, 1)
	go func() {
		for {
			_, data, err := c.Read(ctx)
			if err != nil {
				rerr <- err
				return
			}
			msgs <- data
		}
	}()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case err := <-rerr:
			return nil, err
		case data := <-msgs:
			end, err := p.handle(data)
			if end != nil || err != nil {
				return end, err
			}
		case <-tick.C:
		}
		for _, cmd := range p.decide() {
			b, _ := json.Marshal(cmd)
			wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := c.Write(wctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				return nil, err
			}
		}
	}
}

func (p *player) handle(data []byte) (*outcome, error) {
	var head struct {
		T string `json:"t"`
	}
	if json.Unmarshal(data, &head) != nil {
		return nil, nil
	}
	switch head.T {
	case "welcome":
		var w struct {
			Token string `json:"token"`
			You   string `json:"you"`
		}
		_ = json.Unmarshal(data, &w)
		p.token, p.you = w.Token, w.You
		p.bot.ID, p.cb.ID = w.You, w.You
		p.setup(data)
		p.logf("joined room %s as %s (mode %s)", p.room, p.you, p.mode)
	case "setup":
		p.setup(data)
		p.logf("mode is now %s", p.mode)
	case "room":
		if p.mode == cc.ModeID {
			return p.handleCCRoom(data)
		}
		var rm game.RoomMsg
		if json.Unmarshal(data, &rm) == nil {
			prev := p.rm
			p.rm = &rm
			if prev == nil || prev.Phase != rm.Phase || prev.Wave != rm.Wave {
				p.logf("phase %s wave %d", rm.Phase, rm.Wave)
			}
			if (rm.Phase == game.PhaseWon || rm.Phase == game.PhaseLost) && rm.End != nil {
				if !*loop {
					raw, _ := json.Marshal(rm.End)
					return &outcome{mode: game.ModeID, won: rm.End.Won, raw: raw,
						desc: fmt.Sprintf("wave=%d time=%.0fs", rm.End.Wave, rm.End.Time)}, nil
				}
				if p.restartAt.IsZero() {
					p.restartAt = time.Now().Add(10 * time.Second)
				}
			}
			if rm.Phase == game.PhaseLobby {
				p.restartAt = time.Time{}
			}
		}
	case "snap":
		if p.mode == cc.ModeID {
			var s cc.Snap
			if json.Unmarshal(data, &s) == nil {
				p.csnap = &s
			}
			return nil, nil
		}
		var s game.Snap
		if json.Unmarshal(data, &s) == nil {
			p.snap = &s
		}
	case "error":
		var e struct {
			Code string `json:"code"`
			Msg  string `json:"msg"`
		}
		_ = json.Unmarshal(data, &e)
		switch e.Code {
		case "no_room", "room_full", "bad_name":
			return nil, fatalErr{e.Code, e.Msg}
		case "occupied", "poor":
			// races with teammates; harmless
		case "too_late":
			// a plan raced the end of the plan phase; harmless
		case "bad_plan":
			p.logf("plan refused: %s", e.Msg)
			p.cb.Rejected()
		default:
			p.logf("error %s: %s", e.Code, e.Msg)
		}
	}
	return nil, nil
}

func (p *player) decide() []any {
	if p.mode == cc.ModeID {
		return p.decideCC()
	}
	if p.rm == nil || p.you == "" {
		return nil
	}
	if c := p.switchMode(p.rm.Phase == game.PhaseLobby, p.rm.Host == p.you); c != nil {
		return []any{c}
	}
	var out []any
	for _, c := range p.decideTD() {
		out = append(out, c)
	}
	return out
}

func (p *player) decideTD() []game.Cmd {
	now := time.Now()
	var out []game.Cmd
	isHost := p.rm.Host == p.you
	switch p.rm.Phase {
	case game.PhaseLobby:
		if p.started.IsZero() {
			p.started = now
		}
		if isHost && !*noStart && (*modeID == "" || *modeID == p.mode) && (len(p.rm.Players) >= *n || now.Sub(p.started) > *startWait) && now.Sub(p.lastSend) > time.Second {
			p.lastSend = now
			p.logf("starting the game with %d players", len(p.rm.Players))
			out = append(out, game.Cmd{T: "start"})
		}
		return out
	case game.PhaseWon, game.PhaseLost:
		if isHost && !p.restartAt.IsZero() && now.After(p.restartAt) && now.Sub(p.lastSend) > time.Second {
			p.lastSend = now
			p.started = time.Time{}
			out = append(out, game.Cmd{T: "restart"})
		}
		return out
	}
	if p.snap == nil {
		return nil
	}
	// The bot runs on sim time so it behaves the same at any server -speed.
	// Actions are throttled to keep well under the server's rate limit, and
	// winding taps are batched (at most one wind message per 300 ms).
	if now.Sub(p.lastSend) < 250*time.Millisecond {
		return nil
	}
	if p.windAcc == nil {
		p.windAcc = map[int]int{}
	}
	for _, c := range p.bot.Act(p.snap.Time, p.rm, p.snap) {
		if c.T == "wind" {
			p.windAcc[*c.Plot] += *c.N
			continue
		}
		if c.T == "perk" {
			p.logf("takes perk %s", c.ID)
		}
		out = append(out, c)
	}
	if now.Sub(p.lastWind) >= 300*time.Millisecond {
		for plot, taps := range p.windAcc {
			out = append(out, game.Cmd{T: "wind", Plot: game.IntP(plot), N: game.IntP(min(taps, 10))})
		}
		clear(p.windAcc)
		p.lastWind = now
	}
	if len(out) > 0 {
		p.lastSend = now
	}
	return out
}

// botName returns the i-th name from -names, or prefix+number.
func botName(i int) string {
	if list := strings.Split(*names, ","); *names != "" && i < len(list) && strings.TrimSpace(list[i]) != "" {
		return strings.TrimSpace(list[i])
	}
	return fmt.Sprintf("%s%d", *namePrefix, i+1)
}

// --- catapult_coop -------------------------------------------------------------

// setup reads `mode` and `map` from a welcome or setup message.
func (p *player) setup(data []byte) {
	var m struct {
		Mode string          `json:"mode"`
		Map  json.RawMessage `json:"map"`
	}
	if json.Unmarshal(data, &m) != nil {
		return
	}
	if m.Mode != p.mode {
		p.rm, p.snap, p.crm, p.csnap = nil, nil, nil, nil
	}
	p.mode = m.Mode
	p.keeps = nil
	if m.Mode == cc.ModeID {
		var mp cc.MapT
		if json.Unmarshal(m.Map, &mp) == nil {
			p.keeps = mp.Keeps
		}
	}
}

// switchMode asks for -mode once a second while this bot is the host in
// the lobby and the room is in another mode.
func (p *player) switchMode(lobby, host bool) *map[string]string {
	if *modeID == "" || *modeID == p.mode || !lobby || !host || time.Since(p.modeAsked) < time.Second {
		return nil
	}
	p.modeAsked = time.Now()
	p.logf("switching the room to %s", *modeID)
	return &map[string]string{"t": "mode", "id": *modeID}
}

func (p *player) handleCCRoom(data []byte) (*outcome, error) {
	var rm cc.RoomMsg
	if json.Unmarshal(data, &rm) != nil {
		return nil, nil
	}
	prev := p.crm
	p.crm = &rm
	if prev == nil || prev.Phase != rm.Phase || prev.Level != rm.Level {
		p.logf("phase %s level %d", rm.Phase, rm.Level)
	}
	if (rm.Phase == cc.PhaseWon || rm.Phase == cc.PhaseLost) && rm.End != nil {
		if !*loop {
			raw, _ := json.Marshal(rm.End)
			return &outcome{mode: cc.ModeID, won: rm.End.Won, raw: raw,
				desc: fmt.Sprintf("level=%d wall=%d rounds=%d time=%.0fs", rm.End.Level, rm.End.Wall, rm.End.Rounds, rm.End.Time)}, nil
		}
		if p.restartAt.IsZero() {
			p.restartAt = time.Now().Add(10 * time.Second)
		}
	}
	if rm.Phase == cc.PhaseLobby {
		p.restartAt = time.Time{}
	}
	return nil, nil
}

func (p *player) decideCC() []any {
	rm := p.crm
	if rm == nil || p.you == "" {
		return nil
	}
	now := time.Now()
	isHost := rm.Host == p.you
	switch rm.Phase {
	case cc.PhaseLobby:
		if p.started.IsZero() {
			p.started = now
		}
		if c := p.switchMode(true, isHost); c != nil {
			return []any{c}
		}
		if isHost && !*noStart && (*modeID == "" || *modeID == p.mode) && (len(rm.Players) >= *n || now.Sub(p.started) > *startWait) && now.Sub(p.lastSend) > time.Second {
			p.lastSend = now
			p.logf("starting the game with %d players", len(rm.Players))
			return []any{cc.Cmd{T: "start"}}
		}
		return nil
	case cc.PhaseWon, cc.PhaseLost:
		if isHost && !p.restartAt.IsZero() && now.After(p.restartAt) && now.Sub(p.lastSend) > time.Second {
			p.lastSend = now
			p.started = time.Time{}
			return []any{cc.Cmd{T: "restart"}}
		}
		return nil
	}
	var keep *cc.Keep
	for _, k := range p.keeps {
		if k.ID == rm.Keep {
			keep = k
		}
	}
	if p.bot.Skill == bot.Idle || keep == nil {
		return nil
	}
	var out []any
	for _, c := range p.cb.Act(rm, p.csnap, keep) {
		if c.T == "perk" {
			p.logf("takes perk %s", c.ID)
		}
		out = append(out, c)
	}
	return out
}
