# Clocktower — architecture and wire protocol

This file is the contract between the server, the TV client and the phone
client. If something must change, change this file first.

The body below describes the `tower_defense` mode (display name "Cobble
Crawlers"), which is the only mode today. The "Modes" section covers what is
mode-independent.

## Layout

```
cmd/clocktower/     main: flags/env, starts HTTP server
cmd/ctbot/          dev tool: joins a room as N bot players and plays
internal/mode/      mode registry and the mode.Game interface (generic)
internal/room/      room registry, codes, sessions, per-room loop, ws fan-out (generic)
internal/server/    HTTP routes, websocket upgrade, QR endpoint (generic)
internal/modes/     one directory per game mode, named by its mode id
  all/              registers every mode (called from cmd/clocktower)
  tower_defense/    the tower_defense mode: pure simulation, no networking, unit-tested
    bot/            scripted players and the balance harness for this mode
web/                embedded with go:embed (web/embed.go)
  index.html        phone entry: join form, then the controller
  phone/            phone JS/CSS
  tv/index.html     TV page
  tv/               TV JS/CSS
  shared/           theme.css, net.js (used by both clients)
```

Single static binary. Frontend is plain ES modules — **no build step, no npm,
no external network requests** (no CDNs, no web fonts).

## Configuration

| env / flag                      | default  | meaning |
|---------------------------------|----------|---------|
| `CLOCKTOWER_ADDR` / `-addr`     | `:8080`  | listen address |
| `CLOCKTOWER_BASE_URL` / `-base-url` | (unset) | public base URL used in the QR/join link, e.g. `https://ct.example.com`. If unset, derived from the TV's request: `X-Forwarded-Proto`/`X-Forwarded-Host` if present, else scheme + `Host`. |
| `-dev`                          | off      | serve `web/` from disk instead of the embedded copy |

## HTTP

| route            | purpose |
|------------------|---------|
| `GET /`          | phone page. `?c=CODE` pre-fills the code. |
| `GET /tv`        | TV page |
| `GET /qr.svg?room=CODE` | QR code (SVG, dark modules on transparent) of the join URL `{base}/?c=CODE` |
| `GET /ws`        | websocket, see below |
| `GET /healthz`   | `ok` |
| static           | `/shared/*`, `/phone/*`, `/tv/*`, `/assets/*` |

## Websocket

`GET /ws` with query parameters:

- TV: `role=tv` creates a room. `role=tv&room=CODE&token=T` resumes one (falls
  back to creating a new room if the code/token is unknown).
- Player: `role=player&room=CODE&name=NAME&token=T`. `token` is optional; if it
  matches an existing player in that room the connection resumes that player
  (name is then ignored), otherwise a new player is created. Name: trimmed,
  1–12 characters, control characters stripped.

Refusals are sent as an `error` message followed by a close:
`no_room`, `room_full` (8 players), `bad_name`.

All messages are JSON text frames: an object with a `t` field. Server sends a
ws ping every 15 s; clients reconnect with backoff on close (see
`web/shared/net.js`). A second connection for the same token replaces the first.

### Coordinates and units

The map is a logical 1920×1080 space, origin top-left. Distances are in map
pixels, times in seconds, angles in radians. The simulation ticks at 30 Hz;
snapshots are sent at 10 Hz and clients interpolate.

### Server → client

#### `welcome` (once per connection, first message)

```jsonc
{ "t": "welcome",
  "role": "tv" | "player",
  "room": "ABCD",
  "token": "…",              // store it; TV: sessionStorage, phone: localStorage
  "you": "p3",               // player id; absent for TV
  "joinUrl": "https://host/?c=ABCD",
  "joinHost": "host",        // short text for "go to HOST and enter ABCD"
  "mode": "tower_defense",   // the room's current mode id (see "Modes")
  "modes": [ { "id": "tower_defense", "name": "Cobble Crawlers",
               "tagline": "Hold the streets of Brasswick" } ],  // all modes, in order
  "map": Map,                // map and defs belong to the current mode
  "defs": Defs }
```

```jsonc
Map = {
  "w": 1920, "h": 1080,
  "tower": { "x": 960, "y": 540 },            // the clock tower (goal)
  "paths": [ { "pts": [[x,y], …] } ],          // polylines, spawn → tower
  "plots": [ { "id": 0, "x": 400, "y": 300 } ] // build sites
}
Defs = {
  "towers": { "rivet": { "name": "Rivet Gun", "desc": "…",
                         "levels": [ { "cost": 50, "range": 220, "dmg": 8, "rate": 3.0, … } ×3 ] }, … },
  "enemies": { "scrap": { "name": "Scrapling", "hp": 40, "speed": 60, "flying": false,
                          "armor": 0, "lives": 1, "bounty": 6, "radius": 14 }, … },
  "towerOrder": ["rivet","mortar","tesla","chrono"],   // menu order
  "enemyOrder": ["scrap","roach","brute","drone","tinker","baron"], // index used in snap
  "maxLives": 20, "waves": 15, "sellRefund": 0.6,
  "windPerTap": 0.08, "windBonus": 0.75
}
```

Level objects carry whatever stats apply: `cost`, `range`, `dmg`, `rate`
(shots/s), `splash` (radius), `chains`, `slow` (0–1). Clients show the ones
present.

#### `room` (sent on every change to slow-moving state, and after `welcome`)

```jsonc
{ "t": "room",
  "phase": "lobby" | "build" | "wave" | "won" | "lost",
  "host": "p1",
  "players": [ { "id": "p1", "name": "Ada", "color": "#e0a030",
                 "connected": true, "ready": false } ],
  "wave": 3,                   // current or upcoming wave, 1-based; 0 in lobby
  "nextWave": [ { "kind": "scrap", "n": 12 }, … ],  // preview during build; else []
  "end": End | null }          // set in won/lost
```

```jsonc
End = {
  "won": true, "wave": 15, "time": 612.4,
  "stats": { "p1": { "kills": 41, "dmg": 5210, "spent": 880, "winds": 312,
                     "built": 6, "gifted": 50 } },
  "awards": [ { "pid": "p1", "title": "Chief Winder", "detail": "312 cranks" } ] }
```

Player colors are assigned by the server from a fixed 8-color palette.

#### `snap` (10 Hz while phase is build/wave; one final snap on entering won/lost)

```jsonc
{ "t": "snap",
  "time": 123.4,                 // sim time
  "phase": "build" | "wave",
  "wave": 3,
  "left": 12.3,                  // build: seconds until the wave starts; wave: 0
  "lives": 18,
  "purses": { "p1": 140, "p2": 75 },
  "towers": [ { "plot": 4, "kind": "rivet", "lvl": 1, "owner": "p1",
                "tension": 0.42, "aim": 1.57, "spent": 110 } ],
  "enemies": [ [id, kindIndex, pathIndex, dist, hpFrac, flags] ],
  "ev": [ Event, … ] }           // everything that happened since the last snap
```

Enemy position is `dist` pixels along `map.paths[pathIndex]`. `hpFrac` is 0–1.
`flags` bit 0 = slowed, bit 1 = being repaired. Enemies absent from a snap are
gone (a `die` or `leak` event says why).

Phones receive the same snaps (they draw enemies as dots on a minimap).

Events:

```jsonc
{ "e": "shot",  "plot": 4, "kind": "rivet", "to": 17, "x": 500, "y": 300, "travel": 0.1 }
   // x,y = impact point. Damage lands `travel` seconds after the event; mortar
   // has a visible arc (travel ≈ 0.6) and splash radius from defs.
{ "e": "chain", "plot": 7, "ids": [17, 18, 21], "pts": [[x,y], …] }  // tesla; instant
{ "e": "die",   "id": 17, "kind": "scrap", "x": 500, "y": 300, "bounty": 6 }
{ "e": "leak",  "id": 17, "kind": "scrap", "lives": 1 }   // reached the tower
{ "e": "build", "plot": 4, "kind": "rivet", "pid": "p1" }
{ "e": "upgrade", "plot": 4, "lvl": 2, "pid": "p2" }
{ "e": "sell",  "plot": 4, "pid": "p1", "refund": 66 }
{ "e": "wind",  "plot": 4, "pid": "p2" }                  // at most one per tower per snap per player
{ "e": "gift",  "from": "p1", "to": "p2", "amount": 50 }
{ "e": "wave_start", "wave": 3 }
{ "e": "wave_clear", "wave": 3, "bonus": 40 }             // bonus = cogs each player received
```

#### `error`

```jsonc
{ "t": "error", "code": "poor" | "occupied" | "not_owner" | "max_level" | "not_host"
                      | "bad_request" | "no_room" | "room_full" | "bad_name",
  "msg": "Not enough cogs" }     // human-readable, phones show it as a toast
```

### Client → server (players only; TV sends nothing but pings)

```jsonc
{ "t": "start" }                          // host, in lobby (≥1 player)
{ "t": "build",   "plot": 4, "kind": "rivet" }
{ "t": "upgrade", "plot": 4 }
{ "t": "sell",    "plot": 4 }
{ "t": "wind",    "plot": 4, "n": 3 }     // n taps since last send; send at most every 150 ms; server caps at 10 taps/s per player
{ "t": "ready",   "ready": true }         // build phase; every active connected player ready (≥1 ready) → wave starts now
{ "t": "gift",    "to": "p2", "amount": 50 }
{ "t": "restart" }                        // host; in won/lost, or mid-game to end it → back to lobby, same players
{ "t": "ping" }                           // optional; server replies { "t": "pong" }
```

Invalid or unaffordable actions get an `error` to that player only and change
nothing. Unknown message types are ignored.

## Clarifications (as implemented by the server)

Additive details; nothing above changed meaning.

- **Map** objects also carry `"name"` (map and each path). Paths start just
  off-screen and end exactly at `tower`.
- **Defs** extra fields: per tower `wind` (`"rate"` or `"range"`),
  `groundOnly`, `ignoresArmor`, `chainRange` (tesla hop distance); per enemy
  `desc`, `boss`, `repair` (HP/s) and `repairRange`; top level
  `windRangeBonus`, `tensionDecay` (per second), `maxTapsPerSec`, `buildTime`,
  `maxPlayers`, `hpPerPlayer`. The Chrono Pendulum has no fire rate, so its
  tension widens its radius instead: `range × (1 + windRangeBonus × tension)`
  (`wind: "range"`). Every other tower: `rate × (1 + windBonus × tension)`.
- **Joining**: the joiner always gets `welcome`, then `room`, then (if the game
  is running or finished) one `snap` with `ev: []`. A TV gets the same.
- **`room.host`** is `""` only while the room has no players. Player ids are
  `p1`, `p2`, … and are never reused within a room.
- **Pausing**: the simulation (including the build countdown) stops while no
  player is connected.
- **Purses** are integers on the wire; split bounties keep fractional cogs
  server-side, so a purse may tick up by one a little later than expected.
  `wave_clear.bonus` is the rounded per-player share.
- **Idle players**: bounties and wave bonuses are split among *active*
  players only: connected, and having sent `build`/`upgrade`/`sell`/`wind`/
  `gift`/`ready` (or (re)connected) during the current or previous wave cycle
  (a build phase plus its wave); everyone is active for wave 1. If nobody is
  active, all connected players share. An idle player's purse simply stops
  growing; `wave_clear.bonus` is the share each active player received. Enemy
  HP scaling (`hpPerPlayer`) still counts all connected players. No message
  carries the active flag. See DESIGN.md "Idle players".
- **`shot`**: `x,y` is the predicted impact point; mortar splash (radius from
  defs) is centred there and only hits ground enemies.
- **`chain.pts`** has one more point than `ids`: the tower's position first,
  then each target in order.
- **Commands**: `build`/`upgrade`/`sell`/`wind`/`gift` outside build/wave get
  `bad_request`. `ready` outside the build phase is silently ignored (it races
  with the countdown); a wave starts early once every *active* connected player
  is ready and at least one is, so idle players never block it (in wave 1
  everyone is active). `wind.n` must be an integer 1–100; taps over the
  per-player cap (`maxTapsPerSec`, sim time) are dropped silently. Numbers that
  should be integers (`plot`, `n`, `amount`) are rejected if fractional. Gifts
  may go to disconnected players.
- **Full lobby**: if a 9th player joins while in the lobby, a disconnected
  player (if any) is removed to make room; otherwise `room_full`.
- **Server busy** (room cap, connection cap, or room-creation rate limit per
  IP) is reported as a non-fatal `bad_request` "Server busy", then a close, so
  net.js retries with backoff.
- **Replaced connections** (same token connects again) are closed with a
  normal closure, reason `replaced`.
- **Limits**: frames over 4 KiB close the connection; more than ~20
  messages/s per connection are dropped and sustained flooding disconnects.
  Websocket upgrades must be same-origin (Origin host = Host, X-Forwarded-Host
  or the configured base URL host); a missing Origin is allowed.
- **Testing flag**: `clocktower -speed N` runs the simulation N× faster.

## Modes

Additive to everything above. A mode is a complete game that plugs into the
generic room: it has a stable **id** (used in code, package names, paths and
this protocol) and a separate display **name** and **tagline** (shown to
players, free to change). `tower_defense` / "Cobble Crawlers" / "Hold the
streets of Brasswick" is the only mode today. The first registered mode is the
default for new rooms. Everything else in this file is the `tower_defense`
protocol.

- `welcome` carries `"mode"` (the room's current mode id) and `"modes"` (every
  registered mode as `{ id, name, tagline }`, in registration order). `map` and
  `defs` are those of the current mode.
- `room` carries `"mode": "<id>"`.
- Client → server `{ "t": "mode", "id": "<id>" }` (players only). Host only
  (`not_host`), lobby only, and the id must be registered (both `bad_request`).
  Selecting the current mode does nothing. Otherwise the room replaces its game
  with a new one of that mode, keeping the players (ids, names, colours,
  tokens, connected state, host), and sends **every** connection, TV included,
  `{ "t": "setup", "mode": "<id>", "map": Map, "defs": Defs }` followed by a
  `room` message. A client treats `setup` as "the mode-specific part of
  `welcome` changed" and rebuilds anything derived from `map` and `defs`.
- Messages other than `ping` and `mode` are handed to the current mode; types it
  does not know are ignored.

## Perks

Additive to everything above; see docs/DESIGN.md "Perks".

- **Defs** gains `perks`: `{ "<id>": { "name": "Hot Rivets", "desc": "Your Rivet
  Guns deal 20% more damage. …", "rare": false } }` and `perkOrder: ["<id>", …]`
  (the numbers in this example are illustrative; the real ones are in `desc`).
  `desc` is complete, player-facing text with the real numbers; clients show
  it verbatim and never compute perk effects.
- **`room.players[]`** entries gain:
  - `offer`: `["<id>","<id>","<id>"]` while that player has an unpicked choice,
    otherwise `null`.
  - `perks`: `{ "<id>": count }` — everything the player has picked (may be `{}`).
  - `costs` (omitted unless the player has a price perk): `{ "<kind>": [build,
    up2, up3] }`, the cogs this player pays to build that kind and to upgrade
    any tower of it to level 2 / 3. Use it instead of the `defs` costs when
    present. (Added: without it a phone could not show prices after Bulk
    Discount / Master Fitter without computing perk effects.)
  - `free` (omitted when 0): free builds left (Free Sample); while it is > 0
    this player's next build of any kind costs 0.
  A `room` message is sent whenever any of these changes.
- **Client → server** `{ "t": "perk", "id": "<id>" }` — take one perk from your
  current offer. Allowed in build and wave phases (`bad_request` otherwise).
  `bad_request` if the id is unknown, you have no offer, or the id is not in
  it. The offer is then cleared and the effect applies at once. Like the other
  game commands it counts as activity for the idle-player rule.
- **Event** `{ "e": "perk", "pid": "p1", "id": "<id>" }` in the next snap.
- **Offers** are created for every connected player when an odd-numbered wave
  other than the last is cleared (waves 1, 3, … 13; after the `wave_clear`
  event), replacing any unpicked offer, so an offer stays open for two waves.
  Three distinct perks, never one the player already has at its stack cap.
  A player not connected at that moment gets no new offer (an older unpicked
  one stays); late joiners get their first at the next clear.
  `restart` clears offers and perks.
- **`snap.towers[]`** entries gain `rangeMul` (number, omitted when 1): the
  owner's perk multiplier on that tower's range. Clients drawing a range ring
  use `level.range × rangeMul` (× the tension factor for `wind: "range"` towers).
  Other perk effects need no client maths.
- **`End.stats[pid]`** gains `perks`: the same `{id: count}` map.
- **Sell refunds** stay `sellRefund` × cogs actually spent on the tower
  (`snap.towers[].spent`), so discounted or free towers refund less.
- **Awards** may include the perk titles "Specialist" (most picks of one perk)
  and "Bargain Hunter" (most cogs saved by price perks); same `Award` shape.
