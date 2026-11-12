// Command ctbot joins a Clocktower room as N scripted players over real
// websockets and plays. Without -room it first opens a TV connection to
// create a room (and acts as that TV, counting what it receives).
//
//	ctbot -url http://localhost:8080 -room ABCD -n 4 [-skill good|bad] [-name-prefix Bot] [-no-start] [-loop]
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

	"clocktower/internal/bot"
	"clocktower/internal/game"
)

var (
	baseURL    = flag.String("url", "http://localhost:8080", "server base URL")
	roomCode   = flag.String("room", "", "room code to join (empty: create one via a TV connection)")
	n          = flag.Int("n", 4, "number of bot players (1-8)")
	skillName  = flag.String("skill", "good", "good|bad")
	namePrefix = flag.String("name-prefix", "Bot", "bot name prefix")
	names      = flag.String("names", "", "comma-separated bot names (e.g. Ada,Brunel,Tesla,Watt); overrides -name-prefix, extra bots fall back to it")
	noStart    = flag.Bool("no-start", false, "never press start")
	loop       = flag.Bool("loop", false, "after the game ends, host restarts and plays again")
	taps       = flag.Float64("taps", 3, "winding taps per second per bot")
	startWait  = flag.Duration("start-wait", 2*time.Second, "how long the host waits for the other bots before starting")
	quiet      = flag.Bool("q", false, "less logging")
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

	results := make(chan *game.End, *n)
	var wg sync.WaitGroup
	for i := 0; i < *n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			p := &player{idx: i, name: botName(i), room: code,
				bot: bot.New("", skill, uint64(time.Now().UnixNano())+uint64(i)*7919)}
			p.bot.TapsPerSec = *taps
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
	var end *game.End
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
	b, _ := json.Marshal(end)
	log.Printf("RESULT won=%v wave=%d time=%.0fs", end.Won, end.Wave, end.Time)
	fmt.Println(string(b))
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

	you       string
	rm        *game.RoomMsg
	snap      *game.Snap
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
func (p *player) run(ctx context.Context) (*game.End, error) {
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

func (p *player) session(ctx context.Context) (*game.End, error) {
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

func (p *player) handle(data []byte) (*game.End, error) {
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
		p.bot.ID = w.You
		p.logf("joined room %s as %s", p.room, p.you)
	case "room":
		var rm game.RoomMsg
		if json.Unmarshal(data, &rm) == nil {
			prev := p.rm
			p.rm = &rm
			if prev == nil || prev.Phase != rm.Phase || prev.Wave != rm.Wave {
				p.logf("phase %s wave %d", rm.Phase, rm.Wave)
			}
			if (rm.Phase == game.PhaseWon || rm.Phase == game.PhaseLost) && rm.End != nil {
				if !*loop {
					return rm.End, nil
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
		default:
			p.logf("error %s: %s", e.Code, e.Msg)
		}
	}
	return nil, nil
}

func (p *player) decide() []game.Cmd {
	if p.rm == nil || p.you == "" {
		return nil
	}
	now := time.Now()
	var out []game.Cmd
	isHost := p.rm.Host == p.you
	switch p.rm.Phase {
	case game.PhaseLobby:
		if p.started.IsZero() {
			p.started = now
		}
		if isHost && !*noStart && (len(p.rm.Players) >= *n || now.Sub(p.started) > *startWait) && now.Sub(p.lastSend) > time.Second {
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
