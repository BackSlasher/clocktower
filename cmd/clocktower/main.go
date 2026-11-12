// Command clocktower serves the Clocktower game: TV page, phone page and
// the websocket game server, as one binary.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"clocktower/internal/modes/all"
	"clocktower/internal/room"
	"clocktower/internal/server"
	"clocktower/web"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	addr := flag.String("addr", env("CLOCKTOWER_ADDR", ":8080"), "listen address (env CLOCKTOWER_ADDR)")
	baseURL := flag.String("base-url", env("CLOCKTOWER_BASE_URL", ""), "public base URL for join links, e.g. https://ct.example.com (env CLOCKTOWER_BASE_URL)")
	dev := flag.Bool("dev", false, "serve web/ from disk with caching disabled")
	webDir := flag.String("web-dir", "web", "web directory used with -dev")
	speed := flag.Int("speed", 1, "run the simulation N times faster (testing only)")
	stubMode := flag.Bool("stub-mode", false, "also register the dev-only \"stub\" mode, to try mode selection (testing only)")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(log)

	var webFS fs.FS
	if *dev {
		webFS = os.DirFS(*webDir)
		if _, err := fs.Stat(webFS, "index.html"); err != nil {
			log.Error("-dev: cannot find index.html", "dir", *webDir, "err", err)
			os.Exit(1)
		}
	} else {
		webFS = web.FS
	}

	if *speed < 1 || *speed > 50 {
		log.Error("-speed must be 1..50")
		os.Exit(2)
	}
	all.Register()
	if *stubMode {
		all.RegisterStub()
	}
	reg := room.NewRegistry(room.Config{Logger: log, Speed: *speed})
	h, err := server.New(server.Config{BaseURL: *baseURL, Dev: *dev, Logger: log}, reg, webFS)
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(2)
	}
	srv := &http.Server{
		Addr:              *addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Error("listen", "err", err)
		os.Exit(1)
	}
	log.Info("clocktower listening", "addr", ln.Addr().String(), "dev", *dev)
	if *baseURL == "" {
		for _, u := range lanURLs(ln.Addr()) {
			log.Info("open the TV page at", "url", u+"/tv")
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		log.Info("shutting down")
		reg.Close()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("serve", "err", err)
		os.Exit(1)
	}
}

// lanURLs lists http URLs on this machine's non-loopback IPv4 addresses, so
// the host knows what to open on the TV (phones cannot reach "localhost").
func lanURLs(a net.Addr) []string {
	port := "8080"
	if ta, ok := a.(*net.TCPAddr); ok {
		port = fmt.Sprint(ta.Port)
		if !ta.IP.IsUnspecified() {
			return []string{"http://" + ta.String()}
		}
	}
	var out []string
	addrs, _ := net.InterfaceAddrs()
	for _, ad := range addrs {
		ipn, ok := ad.(*net.IPNet)
		if !ok || ipn.IP.IsLoopback() || ipn.IP.To4() == nil || !ipn.IP.IsPrivate() {
			continue
		}
		out = append(out, "http://"+net.JoinHostPort(ipn.IP.String(), port))
	}
	if len(out) == 0 {
		out = append(out, "http://localhost:"+strings.TrimPrefix(port, ":"))
	}
	return out
}
