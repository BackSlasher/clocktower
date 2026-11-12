# Clocktower — design

A co-op steampunk tower defense for a living room. The TV shows the town; each
player's phone is their controller (Jackbox-style). 1–8 players, tuned for 4.

## Fiction

The town of Brasswick runs on the Great Clock. A scrap-metal horde marches down
its streets to tear the mechanism apart. The players are the town's engineers:
they build clockwork defences on the street corners and keep them wound.

## Core loop

1. **Lobby** — TV shows a 4-letter room code and a QR code. Phones join with a
   name. The first player to join is the host and presses Start.
2. **Build phase** (25 s, skippable when everyone taps Ready) — spend cogs on
   towers and upgrades.
3. **Wave** — enemies walk the streets toward the clock tower. Each one that
   arrives costs lives. Players keep building, upgrading and *winding*.
4. Repeat for 15 waves. Wave 8 and wave 15 are boss waves.
5. **End** — victory or defeat screen with per-player stats and awards.
   Host can return everyone to the lobby.

## What makes it co-op

- **Shared lives** (20) and a shared battlefield.
- **Split bounties**: every kill pays all connected players equally, so nobody
  fights over last hits. Each player still has their own purse and decides what
  to build.
- **Winding**: every tower has spring *tension* (0–1) that decays over ~25 s.
  Fire rate is multiplied by `1 + 0.75 × tension`. Any player can wind any
  tower from their phone by selecting it and mashing the crank. This is what
  phones are busy with during a wave, and it is where shouting across the sofa
  happens ("someone wind the mortar!").
- **Gifting**: send cogs to another player.
- Anyone may upgrade any tower (paying themselves); only the builder may sell.
- End-of-game awards give a little friendly rivalry (Top Gun, Chief Winder,
  Philanthropist, Architect ...).

## Towers

Built on fixed plots (about 22 on the map). Three levels each; upgrade cost is
listed per level. Sell refunds 60 % of everything spent on the tower.

| kind     | name           | cost / up2 / up3 | role |
|----------|----------------|------------------|------|
| `rivet`  | Rivet Gun      | 50 / 60 / 110    | fast single target, hits everything |
| `mortar` | Steam Mortar   | 120 / 130 / 220  | slow, long range, splash; cannot hit flyers |
| `tesla`  | Tesla Coil     | 150 / 160 / 260  | chain lightning over 3/4/5 targets, ignores armour |
| `chrono` | Chrono Pendulum| 100 / 110 / 180  | no damage; slows enemies in radius by 30/40/50 % |

## Enemies

| kind       | name         | traits |
|------------|--------------|--------|
| `scrap`    | Scrapling    | baseline walker |
| `roach`    | Clockroach   | fast, fragile, comes in swarms |
| `brute`    | Brass Brute  | slow, lots of HP, armour (flat damage reduction per hit) |
| `drone`    | Aero-Drone   | flying: mortars cannot target it |
| `tinker`   | Tinker       | repairs nearby enemies over time; priority target |
| `baron`    | Iron Baron   | boss; huge HP, armour, costs 10 lives if it arrives |

Slows do not stack (strongest wins). Bosses are slowed at half strength.

## Scaling

Income is split, so total team income is constant with player count. Extra
players bring extra hands for winding and more parallel decision making, so
enemy HP is multiplied by `1 + 0.10 × (players − 1)`. Starting purse is
`max(80, 320 / players)`-ish per player, tuned so a team can open with roughly
4–5 basic towers in total regardless of size.

Balance numbers live in one Go file (`internal/game/defs.go`) and are sent to
clients in the `welcome` message, so clients never hard-code stats.

## Sessions

- TV opens `/tv` → a room is created. Refreshing the TV resumes the same room.
- Phones open `/` (or scan the QR, which is `/?c=CODE`), enter code + name.
- Phone identity is a random token in `localStorage`; a phone that sleeps or
  reloads rejoins as the same player with purse and towers intact.
- Joining mid-game is allowed; the newcomer gets a catch-up purse.
- If the host disconnects, host passes to the longest-connected player.
- Rooms are dropped after 10 minutes with nobody connected.
- No accounts, no auth. Inputs are validated and rate-limited server-side.

## Look

Brass, copper and soot on deep teal-black; gaslight amber glow; serif display
type. v1 art is drawn in code (canvas/SVG) so it animates well. Painted
backdrops and illustrations can later be dropped in as image files without
changing game code — TV drawing code keeps one draw function per entity kind so
sprites can be swapped in.

## Later (not v1)

Per-player engineer classes with a signature ability, more maps, sound and
music, difficulty settings, endless mode, generated art.
