# Clocktower — architecture and wire protocol

This file is the contract between the server, the TV client and the phone
client. If something must change, change this file first.

The body below describes the `tower_defense` mode (display name "Cobble
Crawlers"), the default mode. The "Modes" section covers what is
mode-independent; the work-in-progress `catapult_coop` mode has its own
section at the end ("Mode `catapult_coop`").

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
  catapult_coop/    the catapult_coop mode (work in progress, behind -wip-modes)
    bot/            scripted players and the balance harness for this mode
web/                embedded with go:embed (web/embed.go)
  index.html        phone shell page: join form, lobby, then the current mode's page
  phone/            phone shell JS/CSS (connection, join, lobby, mode loading)
  tv/index.html     TV shell page
  tv/               TV shell JS/CSS (lobby, stage scaling, audio keys, mode loading), soundboard.html
  shared/           theme.css, net.js, audio.js, dom.js (used by both shells and the modes)
  modes/            one directory per mode id; README.md has the module contract
    tower_defense/  tv/ (battlefield, HUD, sound map, demo) and phone/ (minimap, panel, crank, perks)
    stub/           tv/ and phone/: the dev-only test mode, and the template for a new one
  assets/           audio samples and manifest
```

Single static binary. Frontend is plain ES modules — **no build step, no npm,
no external network requests** (no CDNs, no web fonts).

## Configuration

| env / flag                      | default  | meaning |
|---------------------------------|----------|---------|
| `CLOCKTOWER_ADDR` / `-addr`     | `:8080`  | listen address |
| `CLOCKTOWER_BASE_URL` / `-base-url` | (unset) | public base URL used in the QR/join link, e.g. `https://ct.example.com`. If unset, derived from the TV's request: `X-Forwarded-Proto`/`X-Forwarded-Host` if present, else scheme + `Host`. |
| `-dev`                          | off      | serve `web/` from disk instead of the embedded copy |
| `-stub-mode`                    | off      | also register the dev-only `stub` mode (id `stub`, "Stub"), so the lobby has something to choose; testing only |
| `-wip-modes` / `CLOCKTOWER_WIP_MODES` | off | also register the work-in-progress modes, after the product modes and before `stub`: today `catapult_coop` ("Hold the Keep"). Without it the binary serves exactly one mode (no picker). |

## HTTP

| route            | purpose |
|------------------|---------|
| `GET /`          | phone page. `?c=CODE` pre-fills the code. |
| `GET /tv`        | TV page |
| `GET /qr.svg?room=CODE` | QR code (SVG, dark modules on transparent) of the join URL `{base}/?c=CODE` |
| `GET /ws`        | websocket, see below |
| `GET /healthz`   | `ok` |
| static           | `/shared/*`, `/phone/*`, `/tv/*`, `/modes/*`, `/assets/*` |

## Websocket

`GET /ws` with query parameters:

- TV: `role=tv` creates a room. `role=tv&room=CODE&token=T` resumes one (falls
  back to creating a new room if the code/token is unknown).
- Player: `role=player&room=CODE&name=NAME&token=T`. `token` is optional; if it
  matches an existing player in that room the connection resumes that player
  (name is then ignored), otherwise a new player is created. Name: trimmed,
  1–12 characters, control characters stripped.

Refusals are sent as an `error` message followed by a close:
`no_room`, `room_full` (8 players), `bad_name`, `kicked` (the token belongs
to a player the host removed; see "Room commands").

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
               "tagline": "Hold the streets of Brasswick",
               "minPlayers": 1, "maxPlayers": 8 } ],  // all modes, in order
  "map": Map,                // map and defs belong to the current mode
  "defs": Defs }
```

```jsonc
Map = {
  "w": 1920, "h": 1080,
  "tower": { "x": 960, "y": 540 },            // the clock tower (goal)
  "paths": [ { "pts": [[x,y], …] } ],          // polylines, spawn → tower
  "plots": [ { "id": 0, "x": 400, "y": 300 },     // build sites
             { "id": 22, "x": 1130, "y": 800, "min": 5 } ] // min: open only when room.plotsFor ≥ min (absent = always)
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
  "plotsFor": 4,               // plot tier: plots with min ≤ this exist (see below)
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
  "towers": [ { "plot": 4, "kind": "rivet", "lvl": 1, "owner": "p1",   // "" = its builder was removed
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
{ "e": "wave_start", "wave": 3 }                          // + "by": "p1" when the host started it early with `go`
{ "e": "wave_clear", "wave": 3, "bonus": 40 }             // bonus = cogs each player received
```

#### `error`

```jsonc
{ "t": "error", "code": "poor" | "occupied" | "not_owner" | "max_level" | "not_host"
                      | "bad_request" | "no_room" | "room_full" | "bad_name"
                      | "paused" | "kicked" | "too_many_players",
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
{ "t": "go" }                             // host, build phase: start the wave now, ready or not
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
  `maxPlayers`, `hpPerPlayer`, `hpPlayerMul`. The Chrono Pendulum has no fire rate, so its
  tension widens its radius instead: `range × (1 + windRangeBonus × tension)`
  (`wind: "range"`). Every other tower: `rate × (1 + windBonus × tension)`.
- **Joining**: the joiner always gets `welcome`, then `room`, then (if the game
  is running or finished) one `snap` with `ev: []`. A TV gets the same.
- **`room.host`** is `""` only while the room has no players. Player ids are
  `p1`, `p2`, … and are never reused within a room (not after a kick, a leave, a lobby eviction or a mode switch either).
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
- **Enemy HP scaling**: `hpPlayerMul[n − 1]` for `n` connected players (array
  of `maxPlayers` multipliers). `hpPerPlayer` is kept: it is the per-player
  step of the first four entries (`1 + hpPerPlayer × (n − 1)` up to 4); from 5
  the table climbs faster.
- **Plot tiers**: a plot with `min` exists only when `room.plotsFor ≥ min`;
  plots without `min` always exist. In the lobby `plotsFor` is the number of
  seated players (a preview, at least 1); `start` fixes it to the seated
  players, and while the game runs it only rises (a player joining makes it
  `max(plotsFor, players)`), never falls (leaving, kicks, disconnects), so a
  plot that may hold a tower never closes. Clients draw and offer only open
  plots. `build` on a closed plot gets `bad_request`.
- **`go`** (host skips the wait): ends the build phase at once and starts the
  wave, exactly as if the countdown had run out, whoever is or isn't ready.
  Its `wave_start` event carries `"by"` (the host's id); a wave started by
  the timer or the ready check has no `by`. Refused with `not_host` for
  anyone else and `bad_request` outside the build phase (lobby, wave, won,
  lost); like every game command it gets `paused` while the host has paused
  the game. It counts as a game command for the idle rule.
- **Full lobby**: if a 9th player joins while in the lobby, a disconnected
  player (if any) is removed to make room; otherwise `room_full`.
- **Server busy** (room cap, connection cap, or room-creation rate limit per
  IP) is reported as a non-fatal `bad_request` "Server busy", then a close, so
  net.js retries with backoff.
- **Replaced connections** (same token connects again) are closed with a
  normal closure, reason `replaced`. Other close reasons the room layer uses:
  `kicked` and `left` (see "Room commands"), `no seat in this mode` (a mode
  switch could not seat the player).
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
  Selecting the current mode does nothing. If the room has more players seated
  (connected or not) than the new mode's `maxPlayers`, the switch is refused
  with `error` `too_many_players` ("Hold the Keep takes up to 4 players —
  remove someone first", built from that mode's info); the host removes
  someone (`kick`) and tries again. Otherwise the room replaces its game
  with a new one of that mode, keeping the players (ids, names, colours,
  tokens, connected state, host), and sends **every** connection, TV included,
  `{ "t": "setup", "mode": "<id>", "map": Map, "defs": Defs }` followed by a
  `room` message. A client treats `setup` as "the mode-specific part of
  `welcome` changed" and rebuilds anything derived from `map` and `defs`.
  The web clients unmount the old mode's module, load
  `/modes/<id>/{tv,phone}/mode.js` for the new one and stay in the lobby
  (contract in `web/modes/README.md`).
- Lobby UI: with exactly one entry in `welcome.modes` the clients show no mode
  selection and no mode name. With two or more, the host's phone shows one card
  (name + tagline) per mode and sends `mode`; other phones and the TV show the
  current mode's name and tagline. Display names come only from `welcome.modes`.
- **Player limits** live in each mode's info: `welcome.modes[i].minPlayers` /
  `maxPlayers` (`tower_defense` 1–8, `catapult_coop` 1–4, `stub` 1–8). A
  mode refuses joins beyond its max with `room_full` (in the lobby a
  disconnected player is evicted first, as before). The lobbies read the
  limits from `welcome.modes` only: the TV's "n / max" counter (and, with 2+
  modes, the range under the mode name), the phone's mode cards ("1–4
  players"; a card is disabled with "too many players" while the room has
  more seated players than its max). Modes still send `defs.maxPlayers` with
  the same value, as a fallback.
- The server's `-stub-mode` flag registers a second, do-nothing mode
  (`stub`: lobby, host `start`, a "running" phase whose snaps carry `seconds`,
  host `restart` back to the lobby) so this path can be tested.
- Messages other than `ping`, `mode`, `kick`, `leave` and `pause` are handed
  to the current mode; types it does not know are ignored.

## Room commands: kick, leave, pause

Mode-independent; the room layer handles them like `mode` and `ping` (the
game never sees them). Players only.

```jsonc
{ "t": "kick", "id": "p3" }     // host: remove another player
{ "t": "leave" }                // remove yourself
{ "t": "pause", "on": true }    // host: pause (true) or resume (false) a running game
```

**Removing a player** (`kick`, `leave`):

- `kick`: host only (`not_host`), any phase; `bad_request` for yourself (use
  `leave`), a missing id or an id that is not a player.
- The mode drops the player at once (`mode.Game.RemovePlayer`, see below), the
  player's session token stops working, their socket (if connected) is closed
  with a normal closure and reason `kicked` or `left`, and everyone gets the
  new `room` message. The host leaving or being removed migrates the host as
  on a disconnect (longest-connected remaining player; `""` once the room is
  empty). If the last player goes mid-game, the game pauses as it does with
  nobody connected.
- A kicked player's token is remembered by the room: connecting with it is
  refused with `error` `kicked` ("The host removed you from the game") and a
  close, so an old tab cannot sneak back in. A `left` token is simply
  forgotten (a connection presenting it becomes a new player). Either way the
  person may join again with the room code and a name, as a brand-new player
  (new id, new token).
- Clients: a close with reason `kicked` or `left` (like `replaced`) must not
  reconnect. The phone shell on `kicked` forgets the session and shows the
  join form, room code filled in, with "The host removed you from the game".
  Its Leave sends `leave` and then forgets the session (if the socket is down
  the seat stays as a disconnected player until the host removes it or a full
  lobby evicts it).

What each mode does on removal:

- `tower_defense`: the player's towers stay and keep working but belong to
  nobody (`owner: ""` in `snap.towers`): anyone may upgrade and wind them,
  nobody can sell them (`not_owner`), and the former owner's perks no longer
  apply to them. The purse is discarded (and drops out of `snap.purses`), a
  pending perk offer goes with the player, the build-phase ready check is
  re-run (a wave waiting only for them starts), bounty splits and the HP
  scaling of later waves follow the remaining players. Late joiners' catch-up
  purses ignore ownerless towers. After the game has ended the player also
  drops out of `end.stats` and `end.awards`.
- `catapult_coop`: the engineer leaves the board (`snap.engineers`,
  `snap.plans`); a bomb they carried drops on their cell, settling like a
  landing bomb (nearest free floor cell), with a `bomb` event (no `s`). Their
  queue is discarded, so a plan phase (the untimed first turn included) or a
  break that was waiting only for them ends at once, as if they had pressed
  done / ready. A removal during the resolve playback changes nothing already
  resolved. After the game has ended they drop out of `end.stats` and
  `end.awards`.
- `stub`: the player is dropped.

**Pausing** (`pause`):

- Host only (`not_host`); only while the game is running (the mode's
  `Running()`: build/wave, plan/resolve/break, stub's running), otherwise
  `bad_request`. Pausing a paused game or resuming a running one does
  nothing.
- While paused the room does not advance the game at all (no `Step`: build
  countdowns, waves, plan timers and resolve playback delays all freeze).
  Snaps keep coming at the usual rate (unchanged state), so (re)connecting
  clients work normally. Game commands from players are refused with `error`
  `paused`; `restart`, `kick`, `leave`, `pause`, `mode` and `ping` still work.
- Every connection gets `{ "t": "paused", "on": true, "by": "p1" }` when the
  host pauses and `{ "t": "paused", "on": false }` when the pause ends. Every
  new connection also gets the current state right after `welcome`, `room`
  (and the mid-game `snap`), so the flag never lives inside a mode's `room`.
- The pause clears by itself (with a `paused` `on: false`) when the game
  leaves the running phases (restart, game over; a mode switch can only
  happen from the lobby anyway), or when the player who paused is no longer
  the host: removed, or disconnected while others were connected so the host
  moved on. A reconnect that keeps them host (e.g. nobody else connected)
  keeps the pause.
- Independent of this, every mode still pauses by itself while no player is
  connected.
- Shells: the TV shows a large "Paused" overlay above the mode and ducks the
  music; the phone shows "Paused by <name>" over the mode, with Resume (and
  Remove buttons for the other players) for the host, and Leave for
  everyone. Modes need no code for it.

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

## Mode `catapult_coop`

Work in progress; registered only with the server flag `-wip-modes`. Id
`catapult_coop`; the display name and tagline come only from `welcome.modes`
(today "Hold the Keep" / "Pass the powder, man the catapults"). Game design:
docs/CATAPULT_COOP.md. Server code: `internal/modes/catapult_coop`.

Everything in "Websocket", "Modes" and the generic parts of `welcome`/`room`
(join, tokens, `setup` on a mode switch, `error`, `ping`, limits) applies
unchanged. This section defines `map`, `defs`, `room`, `snap`, the events and
the commands of this mode. JSON field names are exact; every field listed is
always present unless marked *optional*. There are no perks and no lobby
options in this mode.

### Overview

Turn-based co-op on a square grid. Each player has one **engineer** in a
**keep**. Machines walk down four **lanes** toward the keep's wall; the team
carries, throws and loads **bombs** into four **catapults**, which fire by
themselves as soon as their lane has a machine.
A game is 6 **levels**; a level is a series of **turns** (called `round` in
the messages). A turn is a **plan** phase, in which every player files a
**queue** of up to `defs.slots` (4) actions, then a **resolve** phase: slot 1
of every queue plays at once, then slot 2, and so on; after the last slot the
machines advance once. Queues are public and live: everyone sees everyone's
queue as it is edited. The shared **wall** has hit points; at 0 the game is
lost. Clearing level 6 wins.

### Where things live

| what | message | changes |
|------|---------|---------|
| keep shells (size, catapults, lanes) | `welcome`/`setup` `map` | never |
| numbers, bombs, machines, level names | `welcome`/`setup` `defs` | never |
| phase, level, turn, players (connected, away, ready), current level's layout, end | `room` | a few times per turn |
| board (engineers, bombs, catapults, machines, wall), timer, every player's live queue and done flag, events | `snap` (10 Hz) | continuously |

Editing a queue never triggers a `room` message; queues are only in `snap`.

### Grid, keeps and layouts

- Cells are `(x, y)`, integers, `x` to the right, `y` down, origin top-left.
  `cells[y][x]`. Directions `(dx, dy)` are one of `(1,0)` right, `(-1,0)`
  left, `(0,1)` down, `(0,-1)` up.
- A **keep** is the fixed outer shell for a whole game: size, the outer wall
  (row `y = 0` and column `x = 0`), four catapults in that wall (two per
  side) and their lanes. There is one keep today (`small`: 1–4 players,
  9 × 9); `map.keeps` stays a list and `room.keep` names the one in use. It
  never changes during the game. In the TV's isometric view the row
  `y = 0` and the column `x = 0` are the two far sides, seen from the
  `(w, h)` corner.
- A **layout** is one level's interior of that keep: every cell's kind and
  height, and the engineer start cells (seats 1 and 3 in the courtyard by the
  powder store, seats 2 and 4 on the ramparts at a catapult). Each level names its layout; the outer wall line and
  the catapults are identical in every layout of a keep.
- Cell `kind`: `floor` (walkable), `block` (crate, pipe or wall; not
  walkable), `stairs` (walkable; connects both heights), `catapult` (not
  walkable; on the wall, height 1), `void` (outside; not walkable; none today).
  `h` is 0 (courtyard) or 1 (ramparts and raised platforms). Stairs have
  `h: 0` but connect to both heights. Blocks of `h: 1` occur only in the outer
  wall; crates inside the keep are blocks of `h: 0`.
- **Stairs are corner steps.** In every layout each `stairs` cell sits in an
  inside corner: of its four neighbours, two are raised `floor` (`h: 1`) at a
  right angle to each other and the other two are low `floor` (`h: 0`); none is
  blocked. Draw them as steps rising from the two low sides to the two high
  sides. (A test enforces this.) The rampart's own flight is the courtyard's
  inner corner `(2, 2)`; others sit next to a one-cell ledge sticking out of
  the rampart or in the corner of a raised platform.
- **Stepping**: a move goes to the 4-adjacent cell in its direction. Both
  cells must be walkable and of equal `h`, unless either is `stairs`.
- **Throw line.** A bomb thrown from `(x, y)` in direction `(dx, dy)` passes
  over the cells `(x + k·dx, y + k·dy)` for `k = 1, 2, …`, up to `throwRange`
  cells (larger than any keep), and the line **ends before** the first cell
  that is off the grid, a `catapult`, `void`, or a `block` with `h: 1` (the
  outer wall). Everything else is flown over: crates (`block` with `h: 0`),
  platforms, stairs, height differences. The line's **landing cell** is its
  furthest walkable cell.
- **Lanes**: lane `L` leaves the keep from catapult `L.cat` in direction
  `L.dir` (`[0,-1]` from the `y = 0` side, `[-1,0]` from the `x = 0` side).
  Lane positions are integers `0 … len-1` (`len` is 4); position `p` is
  drawn at cell `(L.x + p·L.dir[0], L.y + p·L.dir[1])` (outside the grid;
  position 0 is the cell just outside the wall next to the catapult). Catapult
  `i` fires down lane `catapults[i].lane` (today lane id = catapult id).
- **Loading cells**: an engineer can load catapult `c` when standing
  on a `floor` cell 4-adjacent to it with the same `h` as the catapult (that is,
  on the rampart walkway next to it).

### `welcome` / `setup`: `map`

```jsonc
Map = { "keeps": [ Keep ] }         // one keep today
Keep = {
  "id": "small", "minPlayers": 1, "maxPlayers": 4, "w": 9, "h": 9,
  "catapults": [ { "id": 0, "x": 3, "y": 0, "lane": 0 }, … ],   // 4, ids 0..3
  "lanes": [ { "id": 0, "cat": 0, "len": 4, "dir": [0,-1], "x": 3, "y": -1 }, … ] }
```

The interior is not in `map`: it comes with the room message (`room.layout`),
because it changes from level to level.

### `welcome` / `setup`: `defs`

```jsonc
Defs = {
  "maxPlayers": 4,              // same as welcome.modes[…].maxPlayers
  "wallHP": 20,                 // wall hit points at the start (and maximum)
  "slots": 4,                   // actions per player per turn
  "planTime": 90,               // seconds of a plan phase in level 1 (each level has its own: levels[].planTime)
  "breakTime": 6,               // seconds of the break between levels
  "breakHeal": 0,               // wall hit points restored at each break (up to wallHP)
  "resolveBase": 0.4, "stageTime": 0.35, "machineTime": 0.6,   // resolve timeline, see `resolve`
  "throwRange": 20,             // cap on a throw line (larger than any keep: unlimited)
  "awayAfter": 2,               // turns in a row with nothing filed before a player is away
  "bombsBase": 2, "bombsPerPlayer": 1,    // bombs kept lying on the ground (see "Bombs")
  "bombs": { "keg": { "name": "Powder Keg", "desc": "2 damage to the machine nearest the wall.", "dmg": 2 },
             "grapeshot": { "name": "Grapeshot", "desc": "…", "dmg": 1 },
             "stopwatch": { "name": "Stopwatch", "desc": "…", "freeze": 2 } },
  "bombOrder": ["keg", "grapeshot", "stopwatch"],
  "machines": { "scrap": { "name": "Scrapling", "desc": "…", "hp": 1, "speed": 1, "every": 1, "dmg": 1 },
                "roach": { … "speed": 2 … }, "brute": { … "hp": 4, "dmg": 2 },
                "baron": { … "hp": 9, "dmg": 3, "boss": true } },
  "machineOrder": ["scrap", "roach", "brute", "baron"],
  "levels": [ { "name": "First Shots", "desc": "Scraplings, a few at a time. …", "layout": "open",
                "planTime": 90,   // seconds of a plan phase in this level: 90, 70, 60, 50, 45, 40
                "bombs": { "keg": 1 } }, … ] }   // 6 levels; bombs = kinds that can appear (spawn weights)
```

`desc` texts are complete and player-facing; clients show them verbatim.
Machine `hp` is the base value: a level may give a machine more (the Iron
Baron's hit points depend on the team size), so use `hp`/`max` from `spawn`
events and snaps for health bars. Machines move `speed` cells per turn, on
every `every`-th turn (all `every` are 1 today). A bomb has `dmg` (keg: to the
one machine nearest the wall; grapeshot: to every machine in the lane) or
`freeze` (stopwatch: every machine in the lane skips that many advances).

### `room`

Sent after `welcome`, after `setup`, and whenever a field changes. Queues are
not in it (see `snap`).

```jsonc
{ "t": "room", "mode": "catapult_coop",
  "phase": "lobby" | "plan" | "resolve" | "break" | "won" | "lost",
  "host": "p1",
  "keep": "small",              // keep id (lobby: the keep the current player count would get)
  "layout": Layout,             // the current level's interior (lobby: level 1's, as a preview)
  "level": 2,                   // 1-based; 0 in the lobby
  "levels": 6,
  "round": 3,                   // the turn, 1-based within the level; 0 in the lobby
  "players": [ { "id": "p1", "name": "Ada", "color": "#e0a030", "connected": true,
                 "away": false,   // disconnected, or filed nothing for `awayAfter` turns in a row
                 "ready": false } ],  // break: pressed ready
  "end": End | null }
```

```jsonc
Layout = { "id": "crates", "w": 9, "h": 9,
           "cells": [ [ { "kind": "block", "h": 1 }, … ], … ],   // cells[y][x]
           "spawns": [ [x, y], … ],                               // engineer start cells, in seating order
           "store": [ [x, y], … ] }                               // the powder store: where bombs lie and new ones appear
```

- **A new level starts with a new `layout` in the `room` message** (and a
  `level_start` event); a reconnecting client gets the current one in the
  `room` message that follows `welcome`.
- `End = { "won": true, "level": 6, "rounds": 18, "wall": 4, "time": 312.5,
  "stats": { "p1": { "throws", "catches", "pickups", "loads",
  "kills", "dmg", "steps", "bumps", "fizzles" } }, "awards": [ { "pid",
  "title", "detail" } ] }`. `rounds` is the number of turns played; all stats
  are integers; award titles today: Sharpshooter, Safe Hands, Bomb Lobber,
  Loader, Marathon, Traffic Jam, Butterfingers (most fizzles).

### `snap`

Sent at 10 Hz while the phase is `plan`, `resolve` or `break`, plus one final
snap on entering `won`/`lost`. A client that connects mid-game gets one snap
with `ev: []` right after `room`.

```jsonc
{ "t": "snap",
  "phase": "plan", "time": 81.2,     // game time, seconds (paused while nobody is connected)
  "level": 2, "round": 3,
  "left": 7.4,                       // seconds left in this plan / resolve / break; 0 when untimed
  "untimed": false,                  // true in the game's first plan phase and every turn of the tutorial: no timer, it waits for everyone
  "wall": 9, "wallMax": 16,
  "engineers": [ { "pid": "p1", "x": 4, "y": 5, "carry": { "id": 12, "kind": "keg" } | null } ],
  "bombs":     [ { "id": 7, "kind": "grapeshot", "x": 6, "y": 3 } ],   // lying on the ground
  "catapults": [ { "id": 0, "bomb": { "id": 3, "kind": "keg" } | null } ],   // all four, by id
  "machines":  [ { "id": 21, "kind": "brute", "lane": 2, "pos": 1, "hp": 3, "max": 4, "frozen": 0 } ],
  "incoming":  [ { "lane": 1, "kind": "scrap" } ],   // plan phase: machines that appear at the end of this turn
  "plans": [ { "pid": "p1", "acts": [ Act, … ], "done": true } ],   // every player, room order
  "guide": Guide,                    // only while the guided tutorial runs (absent otherwise)
  "ev": [ Event, … ] }
```

```jsonc
Guide = { "step": 2, "of": 8,                // the current step, 1-based, of the steps for this team size
  "title": "Throw it up",                    // ≤ 30 characters, imperative: the banner at the top of the TV
  "text": "Fetchers step into line and throw the bomb up; gunners catch it.",   // one sentence for the TV
  "tasks": [ { "pid": "p1",
               "text": "Step into line and throw to Ada",   // short personal instruction (phone, TV)
               "cell": [3, 6] | null,                       // the cell to mark for this player
               "acts": [ Act, … ] | null,                   // suggested queue, same shape as plan acts, ≤ slots
               "done": false } ] }                          // this player's goal is met
```

- **`plans`** are public and live: every player's current queue and done flag,
  for every player in the room (an empty `acts` and `done: false` for someone
  who has filed nothing). During `resolve` they still show the queues being
  played (so the TV can light up slot N); they are cleared when the next plan
  phase starts.
- The snap always holds the **end state**: a resolve updates the board at once
  and its events (in the same snap) say how it got there.
- Engineers absent from `engineers` have no engineer on the board (players
  who were disconnected when the level started, until they reconnect).
- A cell holds at most one engineer and at most one ground bomb; an engineer
  may stand on a cell with a bomb. Bomb ids are unique per game and a bomb
  keeps its id when picked up, thrown, loaded and fired.

### Actions

```jsonc
Act = { "a": "move",   "dx": 1, "dy": 0 }     // step to the neighbouring cell
    | { "a": "throw",  "dx": 0, "dy": -1 }    // throw the carried bomb along the line
    | { "a": "pickup" }                       // the bomb in your own cell
    | { "a": "load" } | { "a": "wait" }
```

Every action is relative to wherever the engineer is when its slot comes up,
and is checked only then. What each does at its slot:

- `move`: step one cell in the direction (see "Stepping"). Fizzles
  `blocked` if the step is not possible (wall, crate, catapult, ledge, edge).
- `throw`: throw the carried bomb in the direction. Fizzles `empty_hands` if
  not carrying, `no_target` if the throw line has no walkable cell.
- `pickup`: pick up the bomb lying in the engineer's **own cell** (walk onto
  it first; a bomb never blocks walking). Fizzles `hands_full` if already
  carrying, `no_bomb` if there is no bomb in that cell.
- `load`: put the carried bomb into the lowest-id adjacent catapult the
  engineer can load from (a loading cell) that is empty. Fizzles
  `empty_hands`, `no_catapult` (not on a loading cell), `catapult_full`.
- `wait`: nothing (no event). Slots beyond the queue's length are waits.

A fizzled action does nothing but its `fizzle` event; the player's later
slots still run.

### Resolve rules

At the start of each slot, every player's action for that slot is made
concrete against the board as it stands then (positions, hands, catapults),
or fizzles. Then the slot plays in four stages:

1. **Throws.** Every thrower lets go at once. Then, in player order, each bomb
   flies along its throw line and stops at the **first engineer on the line**
   (positions at the start of the slot, before this slot's moves). If that
   engineer's hands are empty at that moment (which includes an engineer who
   threw their own bomb this stage, and excludes one who already caught a bomb
   this stage) they **catch** it; otherwise it is **blocked** and drops at
   their feet. With nobody on the line it **lands** on the line's landing
   cell. A bomb that comes down (blocked or landed) rests on that cell if it is
   `floor` without a bomb, else on the nearest such cell by Manhattan distance
   (ties: smaller `y`, then smaller `x`; any height). A catcher whose action
   this slot is a move then makes that move, carrying the bomb.
2. **Moves.** A move fails (`bump`, engineer stays) if two or more engineers
   step into the same cell (all of them bump), if two engineers swap cells, or
   if the cell holds an engineer who is not leaving or whose own move bumps.
   Stepping into a cell someone is successfully leaving is fine (chains), and
   four engineers walking round a square all succeed.
3. **Grab.** Pick-ups first: each takes the bomb in the picker's own cell
   (two engineers never share a cell, so pick-ups cannot collide); a picker
   whose hands are full now (they caught a throw in stage 1) fails
   (`hands_full`). Then loads: two or more loads into the same catapult all
   fail (`contested`; no current layout has a catapult with two loading
   cells, so this cannot happen today).
4. **Fire (automatic).** At the end of the slot, every loaded catapult whose
   lane has at least one machine fires by itself, in catapult id order; so a
   `load` into a lane with a machine fires in the same slot. A loaded catapult
   whose lane is empty stays loaded and fires at the end of the first later
   slot in which its lane has a machine. Machines only arrive in the machine
   stage, so that is the first slot of a later turn (the team sees the
   machine for one plan phase first); it fires in that slot even if nobody
   acts. Keg: `dmg` to the machine with the lowest position (ties: lowest id).
   Grapeshot: `dmg` to every machine in the lane. Stopwatch: every machine in
   the lane gets `frozen = max(frozen, freeze)`. Machines at 0 hp are removed.
   Kills and damage are credited to the engineer who loaded the bomb.

After the last slot, once per turn, the **machine stage**: in id order, each
machine: if `frozen` > 0 it skips (`stall`, `frozen` − 1); else, on every
`every`-th turn, it moves `speed` positions toward the wall (`advance`); a
machine that would go below position 0 instead hits the wall (`wall`): the
wall loses its `dmg` and the machine is removed. Then this turn's script
machines appear at position `len − 1` (`spawn`); then bombs are topped up
(`bomb`).

### Events

Events are objects with `"e"`. Events of a slot carry `"s"` (their stage) and
`"slot"` (0-based); machine-stage events carry `"s": "machines"` and no
`slot`. Order guarantees:

- One resolve produces one **batch**, emitted in one go and therefore always
  in one snap, never split: first `resolve`, then slot 0's events, slot 1's,
  …, then the machine stage. Within a slot: stages in the order `throw`,
  `move`, `grab`, `fire`; within a stage the `fizzle`s of that stage's actions
  first, then the stage's events in player order (`grab`: all `pickup`s, then
  all `load`s; `fire`: the automatic fires in catapult id order). Machine stage: `advance`/`stall`/`wall` in machine id order,
  then `spawn`s, then `bomb`s.
- Starting a level emits, in order: `level_start`, one `place` per seated
  engineer, one `bomb` per authored bomb, and `spawn`s for machines of turn 0
  (none of these have `s`). The first level's arrive in the first snap after
  `start`; later levels' when the break ends.
- `level_clear` comes when the resolve animation of a level's last turn ends,
  just before the phase becomes `break` (or `won`).

```jsonc
{ "e": "resolve", "level": 2, "round": 3, "dur": 2.4,
  "slots": [ { "slot": 0, "at": 0.2, "dur": 0.35, "stages": [ { "s": "throw", "at": 0.2, "dur": 0.35 } ] },
             { "slot": 1, "at": 0.55, "dur": 0.7, "stages": [ { "s": "move", "at": 0.55, "dur": 0.35 },
                                                              { "s": "grab", "at": 0.9, "dur": 0.35 } ] }, … ],
  "machines": { "s": "machines", "at": 1.6, "dur": 0.6 } | null }
   // The timeline of this resolve, seconds from its start; dur = the whole resolve phase
   // (= snap.left at its start). Only slots and stages with events are listed, back to back
   // from resolveBase/2, each stage stageTime long; then the machine stage (machineTime) if it
   // has events. Play each event in its stage's slot.
{ "e": "fizzle", "s": "move", "slot": 0, "pid": "p1", "a": "move", "at": [3,2],
  "reason": "blocked" | "no_bomb" | "hands_full" | "empty_hands" | "no_target"
          | "no_catapult" | "catapult_full" }
   // a = the action that fizzled, at = where the engineer stands; s = the stage the action
   // belongs to (throw: throw; move: move; pickup, load: grab)
{ "e": "throw", "s": "throw", "slot": 0, "pid": "p1", "bomb": 12, "kind": "keg",
  "from": [3,5], "dir": [0,-1], "to": [3,1], "result": "caught" | "blocked" | "landed",
  "by": "p2", "at": [3,1] }
   // to = where the flight ends: the cell of the engineer who caught or blocked it, or the
   // line's landing cell. at = where the bomb ends up: the catcher's cell (caught), else its
   // resting cell (differs from `to` when it had to settle elsewhere). by = who caught or
   // blocked it; absent when landed.
{ "e": "move", "s": "move", "slot": 1, "pid": "p1", "from": [4,4], "to": [4,5], "result": "ok" | "bump" }
   // bump: stays at `from` (animate a nudge toward `to` and back)
{ "e": "pickup", "s": "grab", "slot": 1, "pid": "p1", "at": [5,1], "bomb": 7, "kind": "keg",
  "result": "ok" | "hands_full" }      // at = the engineer's own cell
{ "e": "load", "s": "grab", "slot": 2, "pid": "p2", "cat": 0, "bomb": 12, "kind": "keg",
  "result": "ok" | "contested" }
{ "e": "fire", "s": "fire", "slot": 3, "pid": "p2", "cat": 0, "lane": 0, "bomb": 12, "kind": "keg",
  "hits": [ { "id": 21, "dmg": 2, "hp": 2, "killed": false, "frozen": 0 } ] }
   // A catapult fired by itself (every fire is automatic, see "Resolve rules"). pid = the
   // engineer who loaded that bomb; absent if they were removed from the game. hits is never
   // empty (a catapult only fires when its lane has a machine). Per hit: dmg dealt, hp left,
   // killed (machine removed), frozen = its skip count now (stopwatch)
{ "e": "advance", "s": "machines", "id": 21, "kind": "brute", "lane": 2, "from": 2, "to": 1 }
{ "e": "stall", "s": "machines", "id": 21, "lane": 2, "pos": 2, "frozen": 1 }   // frozen = skips left
{ "e": "wall", "s": "machines", "id": 9, "kind": "scrap", "lane": 0, "from": 0, "dmg": 1, "wall": 8 }
   // reached the wall from position `from`: wall loses dmg (now `wall`), machine removed
{ "e": "spawn", "s": "machines", "id": 30, "kind": "roach", "lane": 3, "pos": 2, "hp": 1 }
{ "e": "bomb", "s": "machines", "id": 40, "kind": "keg", "x": 6, "y": 7 }   // new bomb on the ground
{ "e": "level_start", "level": 2, "name": "Two Fronts", "layout": "crates" }
{ "e": "level_clear", "level": 2, "wall": 8, "heal": 0 }   // wall after the break's heal; heal = hp restored
{ "e": "place", "pid": "p3", "x": 4, "y": 4 }     // engineer put on the board (level start, late join)
```

A machine that does not move this turn (`every` > 1) produces no event. A
slot in which nothing happens (no action, no fizzle, no automatic fire) is
left out of the `resolve` timeline.

### Phases and timing

```
lobby --start--> tutorial: plan(level 1, untimed, guide) ⇄ resolve … --last step done / host skip_tutorial--> plan(level 1, turn 1)
plan --all done / timeout / host go--> resolve --dur-->
   ├─ wall ≤ 0 ............................................. lost
   ├─ level done (script spawned, no machines left), not last → break --all ready / breakTime / host go--> plan(next level, turn 1)
   ├─ level done, last level ..................................... won
   └─ otherwise ............................................... plan(same level, turn + 1)
restart (host, any phase but lobby) → lobby, same players
```

- **The guided tutorial** comes first: `start` puts the game in level 1's
  layout with `snap.guide` set, and level 1 itself starts (a `level_start`
  event, a fresh board, the wall repaired, the stats cleared) when the
  tutorial ends or the host sends `skip_tutorial`. See "Guided tutorial".
- **plan**: ends when every *present* player (connected, not away, with an
  engineer) is `done`, provided there is at least one present player; or when
  the level's `planTime` runs out (`defs.levels[level-1].planTime`). The
  **game's first turn and every tutorial turn have no timer** (`snap.untimed`,
  `left: 0`) and end only when every present player is done; disconnected
  players are not waited for. On a timeout, queues play as filed (done or
  not). The host can end it at once with `go` (same effect as a timeout).
- **resolve**: lasts the `dur` of its `resolve` event. No commands change the
  board.
- **break**: after every level but the last: a short intermission showing the
  result. `breakTime` seconds, or until every present player sent `ready`,
  or the host sends `go`. The
  wall gets `breakHeal` hit points back when it starts (in `level_clear`).
- `won`/`lost`: final; `room.end` is set. `restart` returns to the lobby.
- Everything pauses (timers too) while no player is connected.
- Disconnecting can end a plan phase or break early (the rest are done).

### Guided tutorial

A scripted series of untimed turns ("steps") on level 1's layout, before
level 1. Each step gives every player one concrete goal (`guide.tasks`):
walk to a marked cell, pick up a bomb, throw to a named teammate, catch,
load the marked catapult (it fires at a machine and must destroy it), or
lob a bomb onto the rampart. A step repeats (a new untimed turn, `round` + 1,
same goals) until every goal is met, then the next step starts. A goal met
some other way than the suggestion still counts, and so does one met during
the previous step. Some goals (walking ahead, waiting out of the way) are
shown but do not hold the step up. A goal of a player who is away or gone,
or whose throw/catch partner is, is waived (shown `done`). Halfway the
fetchers and gunners swap, so everyone does everything; a lone player picks
up, lobs the bomb onto the rampart, climbs the stairs and loads it.

`cell` and `acts` are recomputed from the board every turn (path-found,
for the whole team together, never bumping each other); clients show them
and may offer to file `acts` as the plan. A player whose goal is met gets
`acts: []` (or a step aside to let a teammate through) and the text says so.
In the last step ("Now for real!") `acts` and `cell` are `null`.

Machines in the tutorial are targets that stand still (no `advance` events)
except in the last step, where they move as usual and may hit the wall (the
wall is repaired when level 1 starts). Bombs are topped up in the store as
in a level. Steps by team size: 1 player 4 steps, 2 or 4 players 8, 3
players 11 (docs/CATAPULT_COOP.md has them).

### Starting a level

At every level start (including level 1): the level's layout replaces the
interior; machines are cleared; **carried and loaded bombs and all ground
bombs are removed**; the layout's authored bombs are placed (kinds drawn from
the level's `bombs` weights); every connected player's engineer is put on the
layout's start cells in player order (beyond the list: the free walkable cell
nearest the first start cell); the level script is fixed for the number of
active players at that moment; machines scheduled for turn 0 appear (today
every machine of a level appears at its start, at the far end of its lane).
Wall hit points carry over.

### Bombs

After every turn's machine stage, new bombs are added until
`bombsBase + bombsPerPlayer × active players` lie on the ground (active =
connected and not away, at least 1). Each goes on a random `floor` cell with
`h` 0 of the layout's **powder store** (`layout.store`: a few courtyard
cells far from the stairs and catapults) that has no bomb and no engineer; with
every store cell taken the top-up waits for the next turn. Its kind is drawn from the level's
`bombs` weights, except that if no keg or grapeshot exists anywhere (ground,
hands, catapults) only those damaging kinds are drawn. Levels 1–2 have kegs
only; grapeshot comes with level 3, the stopwatch with level 4.

### Away players

A player is **away** while disconnected, or after `awayAfter` (2) turns in a
row resolved with nothing filed by them (an empty queue that is not `done`).
An empty queue marked `done` is a deliberate "do nothing" and counts as taking
part. Away players are not waited for (plan phase, break) and do not count
for scaling (machine counts at level start, bomb top-up). Any `plan` or
`ready` from them stands them back up at once; reconnecting alone does not.
Their engineer stays on the board (keeping what it carries).

### Joining, leaving, host

- 1–4 players. Joining is allowed in every phase while there is a free seat
  (in the lobby a full room evicts a disconnected player, as in the other
  modes). A player who connects while a game runs gets an engineer at once on
  the first free start cell of the current layout (`place` event), with no
  missed turns.
- Host migration on disconnect: the longest-connected remaining player.
- `kick` / `leave` remove a player for good, `pause` freezes the game: see
  "Room commands" (engineer off the board, carried bomb dropped, a phase
  waiting only for them ends).
- `restart` keeps the players and their colours and clears stats and the board.

### Client → server

All from players only; malformed JSON (including fractional numbers where an
integer is expected) gets `bad_request`.

```jsonc
{ "t": "start" }                          // host, lobby
{ "t": "plan", "acts": [ Act, … ], "done": true }   // replaces your whole queue; 0..slots acts
{ "t": "ready", "ready": true }            // break; "ready" optional, default true
{ "t": "go" }                              // host; plan or break: end it now
{ "t": "skip_tutorial" }                   // host; while the tutorial runs: start level 1 now
{ "t": "restart" }                        // host; any phase but lobby
```

- `plan` replaces the queue and the done flag at once. `done` omitted means
  `false`: sending a new queue without `done` clears done. `acts` omitted or
  `[]` with `done: true` is a legal "do nothing this turn". Send it on every
  edit; the server shows it to everyone (in `snap.plans`).
- Only the **shape** is checked when the plan arrives; whether an action is
  possible is decided when its slot comes up (it may fizzle).

| command | refused with | when |
|---------|--------------|------|
| `start` | `not_host` | not the host |
| | `bad_request` | not in the lobby |
| `plan` | `bad_request` | phase is lobby, won or lost; more than `slots` acts; unknown `a` (including the removed `fire`); `move`/`throw` without a unit direction; `dx`/`dy` on `pickup`, `load` or `wait` |
| | `too_late` | phase is resolve or break (raced the end of the plan phase) |
| `restart` | `not_host` / `bad_request` | not the host / already in the lobby |
| `skip_tutorial` | `not_host` | not the host |
| | `too_late` | the tutorial is not running (or the phase is not plan/resolve) |
| `go` | `not_host` | not the host |
| | `too_late` | phase is resolve |
| | `bad_request` | phase is lobby, won or lost |

`go` lets the host stop waiting: in a **plan** phase (timed or the untimed
first turn) the turn resolves at once with every queue as filed, done or
not, exactly as on a timeout (a player who filed nothing misses the turn as
usual); in a **break** the next level starts at once, ready or not. Like
every game command it gets `paused` while the host has paused the game.

`ready` outside a break is ignored. Unknown message types (including the old
`opt` and `perk`) are ignored.

Changes from the previous version of this contract: the `fire` action is gone
(catapults fire by themselves; a queue containing `fire` is refused with
`bad_request`); `pickup` takes no direction and works only on the engineer's
own cell; `defs.reach` is gone; fizzle reason `catapult_empty` is gone;
`pickup` results `contested`/`gone` and `load` results `full`/`empty_hands`
are gone; the `fire` event lost `result`, its `pid` is now the loader (and may
be absent) and `hits` is never empty; `end.stats` lost `fires`; lanes are 3
cells; stairs are always corner steps; seats 2 and 4 start in the courtyard.
Later, with no change to any message shape: lanes are 4 cells, `wallHP` is
20, seats 1 and 3 start in the courtyard and 2 and 4 on the ramparts, levels
take several turns with machines arriving over them, and new bombs appear
only in the layout's powder store.
Then (additions only): `snap.guide` and the `skip_tutorial` command (the
guided tutorial before level 1), `layout.store`, and `defs.levels[].planTime`
(plan timers per level, 90 s down to 40 s; `defs.planTime` is level 1's).
