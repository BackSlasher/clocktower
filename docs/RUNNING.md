# Running and developing Clocktower

For how the game plays, see [GAMEPLAY.md](GAMEPLAY.md).

## From source

You need Go (the version is in `go.mod`). The front end is embedded in the binary, so there is no other build step.

```sh
go run ./cmd/clocktower
```

Open `http://<host>:8080/tv` on the TV or any big screen; players scan the QR code with their phones. Everyone must be able to reach the server: on a home network use the machine's LAN address, and for friends elsewhere see [Exposing it on the internet](#exposing-it-on-the-internet).

To build a binary instead:

```sh
go build -o bin/clocktower ./cmd/clocktower
```

## Configuration

| Env var | Flag | Default | Meaning |
|---|---|---|---|
| `CLOCKTOWER_ADDR` | `-addr` | `:8080` | Listen address. |
| `CLOCKTOWER_BASE_URL` | `-base-url` | unset | Public base URL used for the QR code and the join address on the lobby screen, e.g. `https://clocktower.example.com`. If unset it is derived from the TV's request (`X-Forwarded-Proto` / `X-Forwarded-Host` if present, otherwise the scheme and `Host`). |
| | `-dev` | off | Serve `web/` from disk (caching disabled) instead of the embedded copy. |
| | `-web-dir` | `web` | Web directory used with `-dev`. |
| | `-speed` | `1` | Run the simulation N times faster (1 to 50; testing only). |

The wire-level details of these are in [PROTOCOL.md](PROTOCOL.md).

## Exposing it on the internet

Clocktower is designed to be exposed publicly. There are no accounts and no auth by design: a room is just a four-letter code, and the server validates and rate-limits all input and caps rooms and connections.

- Put it behind any reverse proxy that passes websockets. The game uses `/ws`.
- Set `CLOCKTOWER_BASE_URL` to the public address so the QR code points at the right place.
- `GET /healthz` returns `ok`, for health checks.
- Rooms with nobody connected are dropped after 10 minutes.
- Game state is in memory. Restarting the server ends every game in progress.

## Container image

An image is published to GitHub Container Registry on every push to `main`. Tags: `latest`, `main`, and `sha-<full commit>`.

```sh
docker run --rm -p 8080:8080 \
  -e CLOCKTOWER_BASE_URL=https://clocktower.example.com \
  ghcr.io/backslasher/clocktower:latest
```

The image is a static binary on a distroless base, runs as a non-root user and listens on port 8080. To build it yourself: `docker build -t clocktower .`

## TV kiosk

Any browser works: open the `/tv` URL in kiosk or fullscreen mode. Browsers block sound until the page has had a key press or click, so for a TV that nobody touches, allow autoplay for the site. For example, Chromium takes `--autoplay-policy=no-user-gesture-required`, and Firefox has the preference `media.autoplay.default` set to `0`. Sound controls are in [GAMEPLAY.md](GAMEPLAY.md#sound-on-the-tv).

## Development

```
cmd/clocktower/   the server: flags/env, HTTP
cmd/ctbot/        dev tool: joins a room as bot players and plays
internal/mode/    mode registry and the mode.Game interface the room layer uses
internal/room/    rooms, codes, sessions, per-room loop, websocket fan-out (mode-agnostic)
internal/server/  HTTP routes, websocket upgrade, QR endpoint (mode-agnostic)
internal/modes/   game modes, one directory per mode id; all/ registers them
  tower_defense/      the tower defence game: pure simulation (no networking), unit-tested; balance numbers are in defs.go
  tower_defense/bot/  scripted players and the balance harness
web/              embedded front end: phone/ (controller), tv/ (big screen), shared/
tools/shot.mjs    screenshot helper for headless Chromium
docs/             DESIGN.md (design rationale), PROTOCOL.md (wire protocol), this page and GAMEPLAY.md
```

The front end is plain ES modules with no build step and makes no external network requests. The game art is drawn in code, one draw function per tower and enemy kind in `web/tv/sprites.js`. [PROTOCOL.md](PROTOCOL.md) is the contract between the server and both clients, so change it first if something must change.

### Tests

```sh
go vet ./...
go test ./...
```

CI runs the same two commands, then builds the container image.

### Dev server and fast-forward

`-dev` serves `web/` from disk, so front-end edits show on reload. `-speed N` multiplies simulation time, to reach the late waves quickly:

```sh
go run ./cmd/clocktower -addr :8096 -dev -speed 3
```

### Bots

`ctbot` fills a room with bots that build, upgrade and wind. Open `/tv` to get a room code, then:

```sh
go run ./cmd/ctbot -url http://localhost:8096 -room ABCD -n 3 -names Ada,Brunel,Tesla
```

Without `-room` it creates a room itself through a TV connection. Flags:

| Flag | Meaning |
|---|---|
| `-url` | Server base URL (default `http://localhost:8080`). |
| `-room` | Room code to join. |
| `-n` | Number of bots, 1 to 8 (default 4). |
| `-names` | Comma-separated bot names; extra bots fall back to the prefix. |
| `-name-prefix` | Bot name prefix (default `Bot`). |
| `-skill` | `good` (default), `casual`, `idle` or `bad`. `casual` plays like a hurried human, `idle` joins and does nothing, `bad` builds poorly and never winds. |
| `-taps` | Winding taps per second per bot (default 3). |
| `-no-start` | Never press Start. |
| `-loop` | Restart and play again after the game ends. |
| `-start-wait` | How long the host waits for the other bots before starting (default 2s). |
| `-q` | Less logging. |

`go run ./cmd/ctbot -h` has the full list.

### TV demo and diagnostic modes

- `/tv?demo=wave|build|boss|won|lost` is a dev-only mode that feeds the TV synthetic game state so you can look at any screen without playing to it. `&n=8` shows a full room.
- `/tv?fps=1` adds a readout of frames actually drawn.
- `/tv/soundboard.html` is a page for auditioning every sound and music track. Audio credits are in [../CREDITS.md](../CREDITS.md).

### Screenshots

The images in `docs/img/` were taken from live games with `tools/shot.mjs` against a headless Chromium started with `--remote-debugging-port`:

```sh
chromium --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/ct-profile about:blank
node tools/shot.mjs http://localhost:8096/tv shot.png --size 1920x1080 --wait 2000
```

`--mobile` emulates a phone, `--eval 'js'` runs script before the shot; run `node tools/shot.mjs` without arguments for usage. The tower and enemy sprites in `docs/img/towers/` and `docs/img/enemies/` were rendered by calling the draw functions from `web/tv/sprites.js` on a canvas.

### Balance

The bot harness plays whole games headlessly against scripted teams and prints win rates and the wave where losses happen:

```sh
CT_BALANCE_RUNS=100 go test -count=1 -run Balance -v ./internal/modes/tower_defense/bot
```

`CT_BALANCE_RUNS` is seeds per scenario (the default is small; use 20 or more for tuning). `CT_BALANCE_ONLY=<text>` runs only scenarios whose name contains the text. The targets and the reasoning are in the "Difficulty curve" section of [DESIGN.md](DESIGN.md). All balance numbers (tower and enemy stats, waves) live in `internal/modes/tower_defense/defs.go` and perk numbers in `internal/modes/tower_defense/perks.go`; the server sends them to clients in the `welcome` message, so clients hard-code no stats.
