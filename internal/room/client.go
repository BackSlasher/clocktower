package room

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/coder/websocket"

	"clocktower/internal/mode"
)

// client is one websocket connection. Outbound messages go through a bounded
// queue drained by a writer goroutine; a client that falls behind is dropped
// so it can never block its room.
type client struct {
	ws    *websocket.Conn
	out   chan []byte // nil entry = flush then close normally
	done  chan struct{}
	wdone chan struct{}

	once   sync.Once
	code   websocket.StatusCode
	reason string

	writeTimeout time.Duration
	pingEvery    time.Duration
}

func newClient(ws *websocket.Conn, queue int, writeTimeout, pingEvery time.Duration) *client {
	c := &client{ws: ws, out: make(chan []byte, queue), done: make(chan struct{}), wdone: make(chan struct{}),
		writeTimeout: writeTimeout, pingEvery: pingEvery}
	go c.writeLoop()
	go c.pingLoop()
	return c
}

// send queues a message; it never blocks. Overflow kills the connection.
func (c *client) send(b []byte) bool {
	select {
	case <-c.done:
		return false
	default:
	}
	select {
	case c.out <- b:
		return true
	default:
		c.kill(websocket.StatusPolicyViolation, "too slow")
		return false
	}
}

func (c *client) sendJSON(v any) bool {
	b, err := json.Marshal(v)
	if err != nil {
		return false
	}
	return c.send(b)
}

// refuse sends an error message and closes after it is flushed.
func (c *client) refuse(code, msg string) {
	c.sendJSON(errorMsg{T: "error", Code: code, Msg: msg})
	select {
	case c.out <- nil:
	default:
		c.kill(websocket.StatusNormalClosure, code)
	}
}

// kill closes the connection (asynchronously, via the writer).
func (c *client) kill(code websocket.StatusCode, reason string) {
	c.once.Do(func() {
		c.code, c.reason = code, reason
		close(c.done)
	})
}

func (c *client) dead() bool {
	select {
	case <-c.done:
		return true
	default:
		return false
	}
}

func (c *client) writeLoop() {
	defer close(c.wdone)
	for {
		select {
		case b := <-c.out:
			if b == nil {
				c.kill(websocket.StatusNormalClosure, "")
				_ = c.ws.Close(websocket.StatusNormalClosure, "")
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), c.writeTimeout)
			err := c.ws.Write(ctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				c.kill(websocket.StatusGoingAway, "write failed")
				_ = c.ws.CloseNow()
				return
			}
		case <-c.done:
			_ = c.ws.Close(c.code, c.reason)
			return
		}
	}
}

func (c *client) pingLoop() {
	t := time.NewTicker(c.pingEvery)
	defer t.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-t.C:
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			err := c.ws.Ping(ctx)
			cancel()
			if err != nil {
				c.kill(websocket.StatusGoingAway, "ping timeout")
				return
			}
		}
	}
}

// bucket is a token-bucket rate limiter (not goroutine-safe).
type bucket struct {
	tokens, rate, burst float64
	last                time.Time
}

func newBucket(rate, burst float64, now time.Time) *bucket {
	return &bucket{tokens: burst, rate: rate, burst: burst, last: now}
}

func (b *bucket) take(now time.Time, n float64) bool {
	b.tokens = min(b.burst, b.tokens+now.Sub(b.last).Seconds()*b.rate)
	b.last = now
	if b.tokens >= n {
		b.tokens -= n
		return true
	}
	return false
}

type errorMsg struct {
	T    string `json:"t"`
	Code string `json:"code"`
	Msg  string `json:"msg"`
}

// sendError reports a refused command; only *mode.Error keeps its code.
func (c *client) sendError(err error) {
	e, ok := err.(*mode.Error)
	if !ok {
		e = mode.ErrBadRequest
	}
	c.sendJSON(errorMsg{T: "error", Code: e.Code, Msg: e.Msg})
}
