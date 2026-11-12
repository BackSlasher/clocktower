// Package server wires HTTP routes: static pages, the QR endpoint and the
// websocket upgrade.
package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	qrcode "github.com/skip2/go-qrcode"

	"clocktower/internal/room"
)

// Config configures the HTTP layer.
type Config struct {
	BaseURL string // public base URL for join links; "" = derive per request
	Dev     bool   // no caching (and the caller passes a disk FS)
	Logger  *slog.Logger
}

// Server is the HTTP handler.
type Server struct {
	cfg  Config
	reg  *room.Registry
	web  fs.FS
	mux  *http.ServeMux
	base *url.URL // parsed BaseURL or nil

	etagMu sync.Mutex
	etags  map[string]string
}

// New builds the handler. web is the root of the web/ tree.
func New(cfg Config, reg *room.Registry, web fs.FS) (*Server, error) {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	s := &Server{cfg: cfg, reg: reg, web: web, mux: http.NewServeMux(), etags: map[string]string{}}
	if cfg.BaseURL != "" {
		u, err := url.Parse(strings.TrimRight(cfg.BaseURL, "/"))
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return nil, fmt.Errorf("bad base URL %q", cfg.BaseURL)
		}
		s.base = u
	}
	s.mux.HandleFunc("GET /{$}", s.page("index.html"))
	s.mux.HandleFunc("GET /tv", s.page("tv/index.html"))
	s.mux.HandleFunc("GET /tv/{$}", s.page("tv/index.html"))
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("ok"))
	})
	s.mux.HandleFunc("GET /qr.svg", s.qr)
	s.mux.HandleFunc("GET /ws", s.ws)
	for _, dir := range []string{"shared", "phone", "tv", "modes", "assets"} {
		s.mux.HandleFunc("GET /"+dir+"/", s.static)
	}
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "same-origin")
	h.Set("X-Frame-Options", "DENY")
	s.mux.ServeHTTP(w, r)
}

// --- base URL ---------------------------------------------------------------

var hostRE = regexp.MustCompile(`^[A-Za-z0-9.\-]+(:[0-9]{1,5})?$|^\[[0-9A-Fa-f:.]+\](:[0-9]{1,5})?$`)

func firstValue(h string) string {
	if i := strings.IndexByte(h, ','); i >= 0 {
		h = h[:i]
	}
	return strings.TrimSpace(h)
}

// baseURL returns the public base URL (scheme://host) for a request.
func (s *Server) baseURL(r *http.Request) (base, host string) {
	if s.base != nil {
		return s.base.String(), s.base.Host
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if p := strings.ToLower(firstValue(r.Header.Get("X-Forwarded-Proto"))); p == "http" || p == "https" {
		scheme = p
	}
	host = r.Host
	if fh := firstValue(r.Header.Get("X-Forwarded-Host")); fh != "" && hostRE.MatchString(fh) {
		host = fh
	}
	if !hostRE.MatchString(host) {
		host = "localhost"
	}
	return scheme + "://" + host, host
}

// --- websocket ----------------------------------------------------------------

func (s *Server) originOK(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true // non-browser client
	}
	u, err := url.Parse(o)
	if err != nil || u.Host == "" {
		return false
	}
	ok := strings.EqualFold(u.Host, r.Host)
	if fh := firstValue(r.Header.Get("X-Forwarded-Host")); fh != "" && strings.EqualFold(u.Host, fh) {
		ok = true
	}
	if s.base != nil && strings.EqualFold(u.Host, s.base.Host) {
		ok = true
	}
	return ok
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	// Behind a local reverse proxy, trust the proxy's last X-Forwarded-For hop.
	if ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if last := strings.TrimSpace(parts[len(parts)-1]); net.ParseIP(last) != nil {
				return last
			}
		}
	}
	return host
}

func (s *Server) ws(w http.ResponseWriter, r *http.Request) {
	if !s.originOK(r) {
		http.Error(w, "cross-origin websocket refused", http.StatusForbidden)
		return
	}
	// The hijacked connection would otherwise inherit the server's deadlines.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // origin checked above
	if err != nil {
		return
	}
	q := r.URL.Query()
	base, host := s.baseURL(r)
	s.reg.Serve(c, room.Query{
		Role: q.Get("role"), Room: q.Get("room"), Name: q.Get("name"), Token: q.Get("token"),
		JoinURL:  func(code string) string { return base + "/?c=" + code },
		JoinHost: host,
		IP:       clientIP(r),
	})
}

// --- QR -------------------------------------------------------------------------

func (s *Server) qr(w http.ResponseWriter, r *http.Request) {
	code := room.NormalizeCode(r.URL.Query().Get("room"))
	if code == "" {
		http.Error(w, "bad room code", http.StatusBadRequest)
		return
	}
	base, _ := s.baseURL(r)
	svg, err := qrSVG(base + "/?c=" + code)
	if err != nil {
		http.Error(w, "qr failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(svg)
}

// qrSVG renders dark modules as one path on a transparent background, with
// the standard 4-module quiet zone.
func qrSVG(text string) ([]byte, error) {
	q, err := qrcode.New(text, qrcode.Medium)
	if err != nil {
		return nil, err
	}
	bm := q.Bitmap()
	n := len(bm)
	var b bytes.Buffer
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges"><path fill="#000" d="`, n, n)
	for y, row := range bm {
		for x := 0; x < len(row); {
			if !row[x] {
				x++
				continue
			}
			start := x
			for x < len(row) && row[x] {
				x++
			}
			fmt.Fprintf(&b, "M%d %dh%dv1h-%dz", start, y, x-start, x-start)
		}
	}
	b.WriteString(`"/></svg>`)
	return b.Bytes(), nil
}

// --- static files ------------------------------------------------------------

func (s *Server) page(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { s.serveFile(w, r, name) }
}

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	p := path.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if p == "." || strings.HasPrefix(p, "..") || strings.Contains(p, "/.") || strings.HasPrefix(p, ".") {
		http.NotFound(w, r)
		return
	}
	s.serveFile(w, r, p)
}

func (s *Server) serveFile(w http.ResponseWriter, r *http.Request, name string) {
	data, err := fs.ReadFile(s.web, name)
	if err != nil {
		if st, serr := fs.Stat(s.web, name); serr == nil && st.IsDir() {
			data, err = fs.ReadFile(s.web, path.Join(name, "index.html"))
			name = path.Join(name, "index.html")
		}
		if err != nil {
			http.NotFound(w, r)
			return
		}
	}
	h := w.Header()
	switch {
	case s.cfg.Dev:
		h.Set("Cache-Control", "no-cache, no-store, must-revalidate")
	case strings.HasPrefix(name, "assets/"):
		h.Set("Cache-Control", "public, max-age=86400")
	default:
		h.Set("Cache-Control", "no-cache") // revalidate via ETag
	}
	if !s.cfg.Dev {
		h.Set("ETag", s.etag(name, data))
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

func (s *Server) etag(name string, data []byte) string {
	s.etagMu.Lock()
	defer s.etagMu.Unlock()
	if e, ok := s.etags[name]; ok {
		return e
	}
	sum := sha256.Sum256(data)
	e := `"` + hex.EncodeToString(sum[:8]) + `"`
	s.etags[name] = e
	return e
}
