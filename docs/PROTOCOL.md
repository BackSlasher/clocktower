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
| `-wip-modes`                    | off      | also register the work-in-progress modes, after the product modes and before `stub`: today `catapult_coop` ("Bomb Voyage"). Without it the binary serves exactly one mode (no picker). |

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
  The web clients unmount the old mode's module, load
  `/modes/<id>/{tv,phone}/mode.js` for the new one and stay in the lobby
  (contract in `web/modes/README.md`).
- Lobby UI: with exactly one entry in `welcome.modes` the clients show no mode
  selection and no mode name. With two or more, the host's phone shows one card
  (name + tagline) per mode and sends `mode`; other phones and the TV show the
  current mode's name and tagline. Display names come only from `welcome.modes`.
- The generic lobby reads one optional field of the mode's `defs`:
  `maxPlayers` (number, default 8), for the "n / max" counter.
- The server's `-stub-mode` flag registers a second, do-nothing mode
  (`stub`: lobby, host `start`, a "running" phase whose snaps carry `seconds`,
  host `restart` back to the lobby) so this path can be tested.
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

## Mode `catapult_coop`

Work in progress; registered only with the server flag `-wip-modes`. Id
`catapult_coop`; the display name and tagline come only from `welcome.modes`
(today "Bomb Voyage" / "Bombs up, machines down"). Game design:
docs/CATAPULT_COOP.md. Server code: `internal/modes/catapult_coop`.

Everything in "Websocket", "Modes" and the generic parts of `welcome`/`room`
(join, tokens, `setup` on a mode switch, `error`, `ping`, limits) applies
unchanged. This section defines `map`, `defs`, `room`, `snap`, the events and
the commands of this mode. JSON field names are exact; every field listed is
always present unless marked *optional*.

### Overview

Turn-based co-op on a square grid. Each player has one **engineer** in a
**keep**. Machines walk down four **lanes** toward the keep's wall; the team
carries, throws and loads **bombs** into four **catapults** and fires them.
A game is 6 **levels**; a level is a series of **rounds**; a round is a
**plan** phase (everyone secretly picks one action) then a **resolve** phase
(all actions play out at once in a fixed order, then the machines move). The
shared **wall** has hit points; at 0 the game is lost. Clearing level 6 wins.

### Grid, keeps and layouts

- Cells are `(x, y)`, integers, `x` to the right, `y` down, origin top-left.
  `cells[y][x]`.
- A **keep** is the fixed outer shell for a whole game: size, the outer wall
  (row `y = 0` and column `x = 0`), four catapults in that wall (two per
  side) and their lanes. It is chosen when the game starts, by the number of
  players in the room then (`small`: 1–5 players, 9 × 9; `large`: 6–8, 11 × 11),
  and never changes during the game. In the TV's isometric view the row
  `y = 0` and the column `x = 0` are the two far sides, seen from the
  `(w, h)` corner.
- A **layout** is one level's interior of that keep: every cell's kind and
  height, and the engineer start cells. Each level names its layout; the
  outer wall line and the catapults are identical in every layout of a keep.
- Cell `kind`: `floor` (walkable), `block` (crate, pipe or wall; not
  walkable), `stairs` (walkable; connects both heights), `catapult` (not
  walkable; on the wall, height 1), `void` (outside; not walkable; none today).
  `h` is 0 (courtyard) or 1 (ramparts and raised platforms). Stairs have
  `h: 0` but connect to both heights.
- **Walking**: one step goes to a 4-adjacent cell. Both cells must be walkable
  and of equal `h`, unless either is `stairs`. Engineers never block walking
  paths (only the destination cell matters, see resolve).
- **Lanes**: lane `L` leaves the keep from catapult `L.cat` in direction
  `L.dir` (`[0,-1]` from the `y = 0` side, `[-1,0]` from the `x = 0` side).
  Lane positions are integers `0 … len-1`; position `p` is drawn at cell
  `(L.x + p·L.dir[0], L.y + p·L.dir[1])` (outside the grid; position 0 is the
  cell just outside the wall next to the catapult, position `len-1` the far
  end). Catapult `i` fires down lane `catapults[i].lane` (today lane id =
  catapult id).
- **Loading cells**: an engineer can load or fire catapult `c` when standing
  on a `floor` cell 4-adjacent to it with the same `h` as the catapult (that is,
  on the rampart walkway next to it).

### `welcome` / `setup`: `map`

```jsonc
Map = { "keeps": [ Keep, … ] }      // smallest first
Keep = {
  "id": "small", "minPlayers": 1, "maxPlayers": 5, "w": 9, "h": 9,
  "catapults": [ { "id": 0, "x": 3, "y": 0, "lane": 0 }, … ],   // 4, ids 0..3
  "lanes": [ { "id": 0, "cat": 0, "len": 6, "dir": [0,-1], "x": 3, "y": -1 }, … ] }
```

The interior is not in `map`: it comes with the room message (`room.layout`),
because it changes from level to level.

### `welcome` / `setup`: `defs`

```jsonc
Defs = {
  "maxPlayers": 8,
  "wallHP": 10,                 // wall hit points at the start (and maximum)
  "planTime": 12,               // seconds of a plan phase
  "breakTime": 15,              // seconds of a break between levels
  "resolveBase": 0.5, "stageTime": 0.5,   // resolve length = resolveBase + stageTime × non-empty stages
  "move": 2,                    // cells per move, free-handed (before perks)
  "moveCarry": 1,               // cells per move while carrying
  "throwRange": 4,              // max throw distance
  "reach": 1,                   // pick-up distance (Manhattan)
  "awayAfter": 2,               // missed rounds in a row before an engineer is "away"
  "bombsBase": 2, "bombsPerPlayer": 1,    // bombs kept lying on the ground (see "Bombs")
  "bombs": { "keg": { "name": "Powder Keg", "desc": "2 damage to the machine nearest the wall.", "dmg": 2 },
             "grapeshot": { "name": "Grapeshot", "desc": "…", "dmg": 1 },
             "stopwatch": { "name": "Stopwatch", "desc": "…", "freeze": 2 } },
  "bombOrder": ["keg", "grapeshot", "stopwatch"],
  "machines": { "scrap": { "name": "Scrapling", "desc": "…", "hp": 1, "speed": 1, "every": 1, "dmg": 1 },
                "roach": { … "speed": 2 … }, "brute": { … "hp": 4, "every": 2, "dmg": 2 },
                "baron": { … "every": 3, "dmg": 5, "boss": true } },
  "machineOrder": ["scrap", "roach", "brute", "baron"],
  "levels": [ { "name": "Tutorial", "desc": "One Scrapling on one lane.", "layout": "open",
                "bombs": { "keg": 1 } }, … ],   // 6 levels; bombs = kinds that can appear (spawn weights)
  "perks": { "strong_arm": { "name": "Strong Arm", "desc": "You throw up to 6 cells instead of 4." }, …,
             "mason": { "name": "Mason", "desc": "…", "team": true } },
  "perkOrder": ["strong_arm", "light_feet", "long_reach", "quick_hands", "mason"] }
```

`desc` texts are complete and player-facing; clients show them verbatim.
Machine `hp` is the base value: a level may give a machine more (the Iron
Baron scales with the team), so use `hp`/`max` from `spawn` events and snaps
for health bars. A bomb has `dmg` (keg: to the one machine nearest the wall;
grapeshot: to every machine in the lane) or `freeze` (stopwatch: every machine
in the lane skips that many advances). Machines move `speed` cells on every
`every`-th advance.

### `room`

Sent after `welcome`, after `setup`, and whenever any field changes (plans
coming in change `planned`, so expect one per plan).

```jsonc
{ "t": "room", "mode": "catapult_coop",
  "phase": "lobby" | "plan" | "resolve" | "break" | "won" | "lost",
  "host": "p1",
  "openPlans": false,           // host option, see `opt`
  "keep": "small",              // keep id (lobby: the keep the current player count would get)
  "layout": Layout,             // the current level's interior (lobby/won/lost: see below)
  "level": 2,                   // 1-based; 0 in the lobby
  "levels": 6,
  "round": 3,                   // 1-based within the level; 0 in the lobby
  "players": [ {
      "id": "p1", "name": "Ada", "color": "#e0a030", "connected": true,
      "away": false,            // disconnected, or missed `awayAfter` rounds in a row (see "Away")
      "planned": true,          // has a plan this round (plan phase only; false otherwise)
      "ready": false,           // break phase: pressed ready
      "plan": Plan | null,      // only when openPlans is on, else always null
      "offer": ["strong_arm", "mason", "light_feet"] | null,  // break: unpicked perk choice
      "perks": { "strong_arm": 1 },                           // picked perks (never null)
      "can": { "move": 2, "moveCarry": 1, "throw": 4, "reach": 1, "quickHands": false } } ],
  "end": End | null }
```

```jsonc
Layout = { "id": "crates", "w": 9, "h": 9,
           "cells": [ [ { "kind": "block", "h": 1 }, … ], … ],   // cells[y][x], h rows of w cells
           "spawns": [ [x, y], … ] }                              // engineer start cells, in seating order
```

- `layout` is always present. In the lobby it is level 1's layout of the keep
  shown in `keep` (a preview); during a game it is the current level's; in
  `won`/`lost` the last level's. **A new level starts with a new `layout` in
  the `room` message** (and a `level_start` event); a reconnecting client gets
  the current one in the `room` message that follows `welcome`.
- `can` is that player's engineer abilities with perks applied: move budget
  free-handed and carrying, throw range, pick-up reach, whether `load` may
  also fire. Clients use it for highlighting and never compute perk effects.
- `End = { "won": true, "level": 6, "rounds": 84, "wall": 4, "time": 312.5,
  "stats": { "p1": { "throws", "catches", "pickups", "loads", "fires",
  "kills", "dmg", "steps", "bumps", "perks": {…} } }, "awards": [ { "pid",
  "title", "detail" } ] }` (all stats integers; `time` in seconds of game
  time; award titles today: Sharpshooter, Safe Hands, Bomb Lobber, Loader,
  Marathon, Traffic Jam).

```jsonc
Plan = { "a": "move", "x": 4, "y": 5, "path": [[4,4],[4,5]] }   // cells walked, start excluded
     | { "a": "pickup", "x": 5, "y": 1 }
     | { "a": "throw",  "x": 3, "y": 1 }
     | { "a": "load",   "cat": 0, "fire": true }    // "fire" present only when true (Quick Hands)
     | { "a": "fire",   "cat": 0 }
     | { "a": "wait" }
```

### `snap`

Sent at 10 Hz while the phase is `plan`, `resolve` or `break`, plus one final
snap on entering `won`/`lost`. A client that connects mid-game gets one snap
with `ev: []` right after `room`.

```jsonc
{ "t": "snap",
  "phase": "plan", "time": 81.2,     // game time, seconds (paused while nobody is connected)
  "level": 2, "round": 3,
  "left": 7.4,                       // seconds left in this plan / resolve / break; 0 otherwise
  "wall": 9, "wallMax": 10,
  "engineers": [ { "pid": "p1", "x": 4, "y": 5, "carry": { "id": 12, "kind": "keg" } | null } ],
  "bombs":     [ { "id": 7, "kind": "grapeshot", "x": 6, "y": 3 } ],   // lying on the ground
  "catapults": [ { "id": 0, "bomb": { "id": 3, "kind": "keg" } | null } ],   // all four, by id
  "machines":  [ { "id": 21, "kind": "brute", "lane": 2, "pos": 4, "hp": 3, "max": 4,
                   "frozen": 0 } ],  // frozen = advances it will still skip
  "incoming":  [ { "lane": 1, "kind": "scrap" } ],   // plan phase: machines that appear at the end of this round
  "ev": [ Event, … ] }
```

- The snap always holds the **end state**: a resolve updates the board at once
  and its events (in the same snap) say how it got there.
- Engineers absent from `engineers` have no engineer on the board (players
  who were disconnected when the level started, until they reconnect).
- A cell holds at most one engineer and at most one ground bomb; an engineer
  may stand on a cell with a bomb. Bomb ids are unique per game and a bomb
  keeps its id when picked up, thrown, loaded and fired.
- `incoming` is non-empty only in the plan phase: those machines appear at
  position `len-1` of their lane during this round's resolve (draw shadows).

### Events

Events are objects with `"e"`; resolve events also carry `"s"` (their stage).
Order guarantees:

- One resolve produces one **batch**, emitted in one go and therefore always
  in one snap, never split: first `resolve`, then the stage events in stage
  order `throw` → `move` → `grab` → `fire` → `machines`. Within a stage:
  players in `room.players` order (`grab`: all `pickup`s first, then all
  `load`s); in `machines`: `advance`/`stall`/`wall` in machine id order, then
  `spawn`s, then `bomb`s.
- Starting a level emits, in order: `level_start`, one `place` per seated
  engineer, one `bomb` per authored bomb, and `spawn`s for machines at round 0
  (none of these have `s`). The first level's arrive in the first snap after
  `start`; later levels' when the break ends.
- `level_clear` comes when the resolve animation of a level's last round ends,
  just before the phase becomes `break` (or `won`).

```jsonc
{ "e": "resolve", "level": 2, "round": 3, "dur": 2.0,
  "stages": [ { "s": "throw", "at": 0.25, "dur": 0.5 }, { "s": "move", "at": 0.75, "dur": 0.5 }, … ] }
   // dur = length of this resolve phase in seconds (= snap.left at its start). Only non-empty
   // stages are listed, back to back from resolveBase/2; play each stage's events in its slot.
{ "e": "throw", "s": "throw", "pid": "p1", "bomb": 12, "kind": "keg",
  "from": [3,5], "to": [3,1], "result": "caught" | "landed", "by": "p2", "at": [3,1] }
   // to = target cell; at = where the bomb ends up (catcher's cell, or the resting cell, which
   // differs from `to` when it settled elsewhere); by only when caught
{ "e": "move", "s": "move", "pid": "p1", "from": [4,4], "to": [4,6], "path": [[4,5],[4,6]],
  "result": "ok" | "bump" }        // bump: stays at `from` (animate a step toward path[0] and back)
{ "e": "pickup", "s": "grab", "pid": "p1", "at": [5,1], "bomb": 7, "kind": "keg",
  "result": "ok" | "contested" | "hands_full" | "gone" }
{ "e": "load", "s": "grab", "pid": "p2", "cat": 0, "bomb": 12, "kind": "keg",
  "result": "ok" | "contested" | "full" | "empty_hands" }
{ "e": "fire", "s": "fire", "pid": "p2", "cat": 0, "lane": 0, "bomb": 12, "kind": "keg",
  "result": "ok" | "wasted" | "empty",
  "hits": [ { "id": 21, "dmg": 2, "hp": 2, "killed": false, "frozen": 0 } ] }
   // wasted: fired into an empty lane (bomb gone, hits []); empty: someone else fired that
   // catapult earlier this stage (bomb 0, kind "", hits []). Per hit: dmg dealt, hp left,
   // killed (machine removed), frozen = its skip count now (stopwatch)
{ "e": "advance", "s": "machines", "id": 21, "kind": "brute", "lane": 2, "from": 4, "to": 3 }
{ "e": "stall", "s": "machines", "id": 21, "lane": 2, "pos": 4, "frozen": 1 }   // frozen skip; frozen = skips left
{ "e": "wall", "s": "machines", "id": 9, "kind": "scrap", "lane": 0, "from": 0, "dmg": 1, "wall": 8 }
   // reached the wall from position `from`: wall loses dmg (now `wall`), machine removed
{ "e": "spawn", "s": "machines", "id": 30, "kind": "roach", "lane": 3, "pos": 5, "hp": 1 }
{ "e": "bomb", "s": "machines", "id": 40, "kind": "keg", "x": 6, "y": 7 }   // new bomb on the ground
{ "e": "level_start", "level": 2, "name": "Two Fronts", "layout": "crates" }
{ "e": "level_clear", "level": 2, "wall": 8 }
{ "e": "place", "pid": "p3", "x": 4, "y": 4 }     // engineer put on the board (level start, late join)
{ "e": "perk", "pid": "p1", "id": "mason", "wall": 10 }   // wall = wall HP after the pick
```

`gone`, `full` and `empty_hands` cannot happen with plans validated as below;
clients should still accept them (show a fizzle). A machine stage advance of
a machine that does not move this round (`every` > 1) produces no event.

### Phases and timing

```
lobby --start--> plan(level 1, round 1) --all planned / planTime--> resolve --dur-->
   ├─ wall ≤ 0 ............................................. lost
   ├─ level done (script spawned, no machines left), not last → break --all ready / breakTime--> plan(next level, round 1)
   ├─ level done, last level ..................................... won
   └─ otherwise ............................................... plan(same level, round + 1)
restart (host, any phase but lobby) → lobby, same players
```

- **plan**: `planTime` seconds; ends early as soon as every *present* player
  (connected, not away, with an engineer) has a plan, provided there is at
  least one present player. Timeout = everyone without a plan waits.
- **resolve**: lasts the `dur` of its `resolve` event. No commands change the
  board; plans are cleared at its start.
- **break**: after every level but the last. `breakTime` seconds; ends early
  when every present (connected, not away) player is ready. Perk offers are
  made when it starts and unpicked offers vanish when it ends.
- `won`/`lost`: final; `room.end` is set. `restart` returns to the lobby.
- Everything pauses (timers too) while no player is connected.
- Disconnecting can end a plan phase or break early (the rest are done).

### Starting a level

At every level start (including level 1): the level's layout replaces the
interior; machines are cleared; **carried and loaded bombs and all ground
bombs are removed**; the layout's authored bombs are placed (kinds drawn from
the level's `bombs` weights); every connected player's engineer is put on the
layout's spawn cells in player order (beyond the spawn list: the free walkable
cell nearest the first spawn); the level script is fixed for the number of
active players at that moment; machines scheduled for round 0 appear. Wall HP
and perks carry over.

### Resolve rules

All plans were validated against the board at the start of the round (the
board changes only in resolve), so resolve needs only these rules:

1. **Throws.** Every thrower lets go at once. Then, in player order, each bomb
   is **caught** by the engineer standing on the target cell (positions at
   the start of the round) if that engineer's hands are empty at that moment,
   which includes an engineer who threw their own bomb this stage; otherwise it
   **lands**: on the target cell if it is `floor` without a bomb, else on the
   nearest such cell by Manhattan distance (ties: smaller `y`, then smaller
   `x`; any height). A catcher whose plan was a move then makes that move,
   carrying the bomb. A thrown bomb landing where an engineer will walk to just
   lies there.
2. **Moves.** A move fails (`bump`, engineer stays) if two or more engineers
   planned the same destination (all of them bump), if two engineers swap
   cells, or if the destination holds an engineer who is not leaving or whose
   own move bumps. Moving into a cell someone is successfully leaving is fine
   (chains), and rotations of three or more engineers all succeed.
3. **Grab.** Pick-ups: if two or more engineers planned to pick up the same
   cell, all of them fail (`contested`); a picker whose hands are full (they
   caught a throw in stage 1) fails (`hands_full`, takes precedence).
   Then loads: two or more loads into the same catapult all fail
   (`contested`); a successful load empties the loader's hands.
4. **Fire.** In player order: every `fire` plan, and every successful `load`
   with `fire: true`. The first fire of a catapult launches its bomb down its
   lane (`wasted` if the lane is empty); a later fire of the same catapult
   this round finds it `empty`. Keg: `dmg` to the machine with the lowest
   position (ties: lowest id). Grapeshot: `dmg` to every machine in the lane.
   Stopwatch: every machine in the lane gets `frozen = max(frozen, freeze)`.
   Machines at 0 hp are removed.
5. **Machines.** In id order, each machine: if `frozen` > 0 it skips (`stall`,
   `frozen` − 1); else its advance counter goes up and, on every `every`-th
   advance, it moves `speed` positions toward the wall (`advance`); a machine
   that would go below position 0 instead hits the wall (`wall`): the wall
   loses its `dmg` and the machine is removed. Then this round's script
   machines appear at position `len - 1` (`spawn`; they do not move this
   round). Then bombs are topped up.

### Bombs

After every resolve, new bombs are added until `bombsBase + bombsPerPlayer ×
active players` lie on the ground (active = connected and not away, at least
1). Each goes on a random `floor` cell with `h` 0 that has no bomb and no
engineer; its kind is drawn from the level's `bombs` weights, except that if
no keg or grapeshot exists anywhere (ground, hands, catapults) only those
damaging kinds are drawn. Levels 1–2 have kegs only; grapeshot comes with
level 3, the stopwatch with level 4.

### Away players

A player is **away** while disconnected, or after `awayAfter` (2) rounds in a
row resolved without a plan from them (a timed-out round counts as missed).
Away players are not waited for (plan phase, break) and do not count for
scaling (machine counts at level start, bomb top-up). Any `plan`, `ready` or
`perk` from them stands them back up at once. Reconnecting alone does not.
Their engineer stays on the board (as an obstacle, keeping what it carries)
and simply waits.

### Joining, leaving, host

- 1–8 players. Joining is allowed in every phase while there is a free seat
  (in the lobby a full room evicts a disconnected player, as in the other
  modes). A player who connects while a game runs gets an engineer at once on
  the first free spawn cell of the current layout (`place` event), with no
  missed rounds.
- Host migration on disconnect: the longest-connected remaining player.
- `restart` keeps the players, their colours and `openPlans`, and clears
  perks, stats and the board.

### Client → server

All from players only; malformed JSON (including fractional numbers where an
integer is expected) gets `bad_request`.

```jsonc
{ "t": "start" }                          // host, lobby
{ "t": "opt", "openPlans": true }         // host, lobby
{ "t": "plan", "a": "move",   "x": 4, "y": 6 }
{ "t": "plan", "a": "pickup", "x": 5, "y": 1 }
{ "t": "plan", "a": "throw",  "x": 3, "y": 1 }
{ "t": "plan", "a": "load",   "cat": 0 }             // "cat" optional; "fire": true needs Quick Hands
{ "t": "plan", "a": "fire",   "cat": 0 }             // "cat" optional
{ "t": "plan", "a": "wait" }
{ "t": "plan", "a": "clear" }             // withdraw your plan (planned → false)
{ "t": "ready", "ready": true }           // break; "ready" optional, default true
{ "t": "perk", "id": "strong_arm" }       // break
{ "t": "restart" }                        // host; any phase but lobby
```

A new `plan` replaces the previous one; the phone should remember and draw its
own plan (with `openPlans` off nobody else can see it). Validation (all
against the board at the start of the round; errors go to the sender only and
change nothing):

| command | refused with | when |
|---------|--------------|------|
| `start` | `not_host` | not the host |
| | `bad_request` | not in the lobby |
| `opt` | `not_host` / `bad_request` | not the host / not in the lobby |
| `plan` | `bad_request` | phase is lobby, won or lost; unknown `a`; `x`/`y` missing for move/pickup/throw; `cat` not a catapult id; `cat` omitted while next to two catapults |
| | `too_late` | phase is resolve or break (raced the end of the plan phase) |
| | `bad_plan` | no engineer yet; any rule below fails (`msg` says why) |
| `perk` | `bad_request` | not in a break; unknown id; no offer; id not in your offer |
| `restart` | `not_host` / `bad_request` | not the host / already in the lobby |

`ready` outside a break is ignored. `bad_plan` rules:

- every action: `x, y` (when given) must be on the grid;
- `move`: destination walkable, not your own cell, and reachable by a walk of
  at most `can.move` steps (`can.moveCarry` while carrying); the stored
  plan's `path` is the server's shortest path;
- `pickup`: hands empty; a bomb lies on `(x, y)`; Manhattan distance from
  your cell ≤ `can.reach` (any height difference);
- `throw`: carrying; `(x, y)` in the same row or column, 1 … `can.throw`
  cells away (over anything, any height); target walkable;
- `load`: carrying; you stand on a loading cell of the catapult; it is empty;
  `fire: true` only with `can.quickHands`;
- `fire`: you stand on a loading cell of the catapult; it is loaded.

### Perks

At the start of each break every connected player gets an `offer` of up to
three distinct perks (never one at its cap; Mason only while the wall is below
`wallHP`). Picking is optional. **Mason** is a team perk: the first pick in a
break heals the wall (up to `wallHP`) and removes Mason from everyone else's
offer (an offer left empty becomes `null`). Effects show up in `can` (and the
wall in snaps). Today: Strong Arm (throw 6), Light Feet (+1 move, also when
carrying), Long Reach (pick up from 2 cells), Quick Hands (`load` with
`fire: true`), Mason (wall +2). Each but Mason can be taken once.
