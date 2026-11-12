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
2. **Build phase** (20 s, skippable when everyone taps Ready) — spend cogs on
   towers and upgrades. Building and upgrading also work during waves.
3. **Wave** — enemies walk the streets toward the clock tower. Each one that
   arrives costs lives. Players keep building, upgrading and *winding*.
4. Repeat for 15 waves. Wave 8 and wave 15 are boss waves.
5. **End** — victory or defeat screen with per-player stats and awards.
   Host can return everyone to the lobby.

## What makes it co-op

- **Shared lives** (20) and a shared battlefield.
- **Split bounties**: every kill (and the wave-clear bonus) pays all *active*
  players equally, so nobody fights over last hits. Each player still has their
  own purse and decides what to build. See "Idle players" below.
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
| `baron`    | Iron Baron   | boss; huge HP, armour, costs 5 lives if it arrives; walks with a tinker escort |

Slows do not stack (strongest wins). Bosses are slowed at half strength.

## Scaling

Income is split, so total team income is constant with player count. Extra
players bring extra hands for winding and more parallel decision making, so
enemy HP is multiplied by `1 + 0.07 × (connected players − 1)` (`hpPerPlayer`).
The factor is small on purpose: a casual group's extra hands are worth little
more than that, and split purses make big upgrades slower for larger groups.
Starting purse is `max(80, 320 / players)`-ish per player, tuned so a team can
open with roughly 4–5 basic towers in total regardless of size.

## Idle players

A player is *active* while connected and having sent any game command (build,
upgrade, sell, wind, gift or Ready) during the current wave cycle or the
previous one; a cycle is a build phase plus its wave. Connecting or
reconnecting counts as a command, and everyone is active for wave 1.

The Ready check follows the same rule: the build phase ends early once every
active connected player is ready (at least one must be), so an idle player
cannot hold up the wave; wave 1 still waits for everyone or the timer.

Bounties and wave-clear bonuses are split among active players only (among
all connected players if nobody is active), so a friend who wanders off does
not drain a quarter of the team's income into a purse nobody spends. Enemy HP
still scales with *connected* players. Why this rule:

- It can't be gamed: going idle never makes enemies weaker, and total team
  income is the same whoever receives it.
- It doesn't flap: one tap per cycle (even Ready) keeps a player in, and any
  command brings them straight back.
- The cost of an AFK friend is only their missing hands, which a team can
  survive. A disconnected player is excluded from the split as before; an idle
  player keeps whatever they already had and can be gifted cogs on return.

## Difficulty curve

Enemy HP (`hpMul` per wave) rises steadily to wave 8, then slowly; later waves
get harder through nastier mixes (more brutes and tinkers) rather than ever
fatter enemies, because a team's strength grows slowly once plots fill and
towers reach level 3. Wave 8 (one Iron Baron) is the hardest moment of the
first half and wave 15 (two Barons) of the game.

From wave 9 every wave ends with a few *runners*: very tough Clockroaches or
Aero-Drones (3–5 per wave) that cost one life each. A team rarely stops all of
them and can never lose many lives to them, so damage arrives in small, steady
lumps and won games end close (typically 5–11 lives left) instead of being
either flawless or a single collapse. The Barons cost 5 lives, not 10, for the
same reason.

Balance is tuned with the bot harness (`internal/bot`, run with
`CT_BALANCE_RUNS=100 go test -run Balance -v ./internal/bot`) against
human-like "casual" bots: they react a second or two late, wind in bursts at
about 2 taps/s for roughly half of each wave and only on towers with enemies in
range, never gift, sometimes dither with cogs in hand, and pick decent rather
than optimal plots. Targets:

| team | target |
|------|--------|
| 4 casual | wins ~60–75 %, losses mostly on waves 12–15; winners keep ~5–11 lives |
| 3 casual + 1 idle | wins ~35–55 %, rarely dies at wave 8 |
| 1, 2 casual | wins ~55–75 % |
| 8 casual | wins ~60–80 % |
| 4 casual who never wind | loses more often, but still wins sometimes |
| 4 casual who never pick a perk | clearly worse, ~15 % or more (see Perks) |
| 4 expert bots | wins nearly always |
| builds badly and never winds | loses, mostly in waves 9–13 |

A won game takes about 17 minutes.

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

## Perks (pick one of three)

Clearing a wave earns every connected player a choice: their phone shows three
random perk cards and they keep one. Perks are personal — they change that
player's towers, cranking or purse — and they stack. This is the decision of
each build phase and what makes two games play differently: one player drifts
into a rivet specialist, another into the team's winder.

- Offered after the odd waves 1, 3, 5 … 13 (seven picks a game; never after
  the final wave), so each pick is a treat rather than a chore. Three distinct
  perks, drawn by weight; the rare ones show up seldom.
- The offer stays open for two waves. If it is still unpicked when the next
  offer arrives, it is replaced by the new one.
- Picking is never required and never blocks the ready check.
- Perks are public: the TV announces each pick and the end screen lists them.
- Late joiners get their first offer at the next wave clear.

Starting set (ids in `internal/game/perks.go`; numbers are tuned there):

| perk | effect |
|------|--------|
| Overwound Springs | your towers lose tension more slowly |
| Strong Arm | your crank taps add more tension |
| Calibrated Sights | your towers gain range |
| Hot Rivets | your Rivet Guns deal more damage |
| Bigger Shells | your Steam Mortars get a larger splash |
| Capacitor Bank | your Tesla Coils chain to one more target |
| Heavy Pendulum | your Chrono Pendulums slow more |
| Bulk Discount | your new towers cost less |
| Master Fitter | your upgrades cost less |
| Salvage Rights | your share of bounties is larger |
| Windfall | cogs, right now |
| Free Sample | your next tower is free |
| Clock Repair (rare) | the team gets lives back |

Difficulty is tuned with perks in play: bots pick too (casual bots at random,
after a few seconds, sometimes not at all; good bots to suit what they have
built; idle players never).

Each card is a visible step (around +10 %), with low stack caps. Perks
compound and a casual team's win rate is very sensitive to total strength,
so a team that ignores them is much worse off: at the tuned difficulty four
casual bots win ~70 % with perks and ~12 % without.
