# `catapult_coop` — design

Second mode for Clocktower. Internal id `catapult_coop`; display name
"Bomb Voyage" (kept in one place, free to change). Status: server built
(`internal/modes/catapult_coop`, behind the server flag `-wip-modes`); web
clients to come. Wire contract: docs/PROTOCOL.md, "Mode `catapult_coop`".

## Pitch

The horde has reached Brasswick's walls. The engineers are inside the keep
with four steam catapults on the ramparts and bombs lying all over the
courtyard below. Fetch bombs, pass them hand to hand up to the ramparts, load,
fire. Everybody plans their move in secret at the same time, then all the
moves happen at once.

Where the tower defense is real-time and loose, this is turn-based and tight:
nothing happens until everyone has committed, and one person walking the wrong
way breaks the chain. The fun is the talking during the planning seconds and
the groan when two people both went for the same bomb.

1–8 players, best at 3–5.

## The keep

The TV shows the keep in an isometric view: a square courtyard seen from one
corner.

- **Courtyard** (low ground): a grid of about 7 × 7 cells with a few crates
  and pipes blocking cells. Bombs lie scattered here.
- **Ramparts** (high ground): the two sides of the square furthest from the
  viewer are raised walkways. Each has **two catapults**. The only way up is
  by **stairs** (one or two flights per rampart).
- **Lanes**: each catapult looks out over its own lane, running away from the
  wall, 6 cells long. Four catapults, four lanes. Machines appear at the far
  end of a lane and step toward the wall.

The keep is larger for big groups (9 × 9 cells with a 7 × 7 courtyard for
1–5 players, 11 × 11 for 6–8). Its outer shape (size, wall, the four
catapults and their lanes) is fixed for the whole game, so the TV camera
never moves.

**The interior belongs to the level.** Each level brings its own layout of
the keep: which courtyard cells are crates, which are raised platforms
(height 1, reached by stairs like the ramparts), where the stairs are, where
the engineers start and where bombs lie when the level begins. At every level
start the engineers go back to the start cells and the board is cleared of
bombs (in hands, in catapults, on the ground) before the level's own bombs are
placed. Layouts are ASCII drawings in the code; a test checks every one (all
catapults reachable from every start cell, every bomb reachable, no
walled-off pockets). Today each keep has four layouts: *open* (flat, the
tutorial), *crates*, *platform* (a raised platform with a bomb on it) and
*split* (a line of crates splitting the courtyard, two platforms).

## A round

1. **Plan** (12 s; a tunable). Every phone shows the keep and that player's
   choices. Each player picks **one** action. The TV shows a tick next to each
   name as plans come in, and the phase ends as soon as everyone has
   committed. A plan can be changed until then.
2. **Resolve** (2–3 s). The TV plays all actions at once, in a fixed order
   (below), then the machines advance and new ones arrive.
3. Repeat. A machine that reaches the wall damages it and is destroyed. The
   wall has shared hit points; at zero the game is lost.

### Plans are secret — unless the host says otherwise

By default the TV shows only who has committed. The host can switch on
**Open plans** in the lobby: then the TV (and every phone) draws each
player's chosen action as it is picked. That is the learning setting.

## Actions

One per player per round.

| action | effect |
|--------|--------|
| **Move** | walk up to 2 cells (1 cell while carrying a bomb); levels change only via stairs |
| **Pick up** | take a bomb lying in your cell or an adjacent one |
| **Throw** | throw the bomb you carry up to 4 cells in a straight line, over anything and between levels; a free-handed engineer in the target cell catches it, otherwise it lands there |
| **Load** | put the bomb you carry into an adjacent, empty catapult |
| **Fire** | fire an adjacent, loaded catapult down its lane |
| **Wait** | do nothing (also what happens if the timer runs out) |

Carrying is slow, stairs are a detour, and throwing is fast and ignores
height. So one engineer walking a bomb up to a catapult takes many rounds; a
chain of engineers with one standing on the rampart moves a bomb a round.

### Resolve order

1. Throws fly and are caught.
2. Moves. Two engineers heading for the same cell bump and both stay put.
   Swapping places is also a bump. Walking into a cell someone is leaving is
   fine.
3. Pick-ups and loads. Two engineers grabbing the same bomb, or loading the
   same catapult: neither succeeds.
4. Catapults fire.
5. Machines advance; new machines appear; new bombs appear in the courtyard.

Because throws go first, "I throw to where you are, then you walk" works, and
"you walk there and I throw to where you will be" does not. Catching is a
deliberate, called play.

## Bombs

Bombs appear on free courtyard cells, so there are always a few lying about
(more for bigger groups). A catapult has no aim: it fires down its own lane.

| bomb | effect when fired |
|------|-------------------|
| **Powder keg** | 2 damage to the machine nearest the wall |
| **Grapeshot** | 1 damage to every machine in the lane |
| **Stopwatch** | every machine in the lane skips its next two moves |

## Machines

| machine | traits |
|---------|--------|
| **Scrapling** | 1 hit point, 1 cell a round, 1 wall damage |
| **Clockroach** | 1 hit point, 2 cells a round, comes in clusters (grapeshot fodder) |
| **Brass Brute** | 4 hit points, 1 cell every other round, 2 wall damage |
| **Iron Baron** | boss; many hit points, slow, 5 wall damage |

Same cast as the tower defense, so both modes share art and sounds. The TV
shows the next round's arrivals as shadows at the far end of the lanes.

Later, maybe: Aero-Drones that land in the courtyard and block a cell; a
fused bomb that goes off after three rounds wherever it is.

## Levels

A game is a series of levels. A level is a script: which machines appear on
which lane in which round. It ends when everything in the script has been
destroyed or has reached the wall. Difficulty is nothing more than how many
machines are put on how many lanes:

1. **Tutorial**: one Scrapling on one lane.
2. Two lanes, a handful of Scraplings.
3. Clockroach clusters arrive; three lanes.
4. All four lanes; first Brutes.
5. Everything, faster.
6. The Iron Baron, with company.

Each level also lists the bomb kinds that can appear, with weights: levels 1–2
have powder kegs only, grapeshot arrives with the Clockroaches (level 3), the
stopwatch with the Brutes (level 4). Each level uses one interior layout
(tutorial: *open*; 2–3: *crates*; 4: *platform*; 5–6: *split*), and every
level gives the team a few rounds to get into position before the first
machine arrives.

Machine counts scale with the number of players (an explicit count per team
size in the level data, so the curve can be shaped). Wall hit points carry
over between levels. Clearing the last level wins.

Between levels there is a short break: every player picks one of three perks
(the same pick-one-of-three as the tower defense), e.g. *Strong Arm* (throw
6 cells), *Light Feet* (move one cell further), *Long Reach* (pick up from
two cells away), *Quick Hands* (load and fire in one action), *Mason* (the
wall gets 2 hit points back; one Mason per break for the whole team).

## Players who are away

- The timer ends every plan phase, so nobody can stall the game.
- An engineer whose player missed two rounds in a row, or is disconnected,
  sits down: the round no longer waits for them and they are not counted for
  scaling. Any plan from them stands them back up.
- A phone that reconnects mid-plan gets the board and can still commit.

## Phone

Landscape. A flat top-down map of the keep fills the screen (the isometric
view is for the TV), your engineer highlighted.

- Tap a highlighted cell to move there.
- Action buttons along the side for what is possible right now (Pick up,
  Throw, Load, Fire, Wait); Pick up and Throw then ask for a target cell when
  there is a choice.
- Your chosen action is drawn on your own phone, changeable until the round
  resolves.
- During resolve the phone says "watch the TV".

## Shared shell

No changes to the mode interface are needed. `Step(dt)` runs the plan timer
and resolve delay; the resolve playback travels as ordered events in the
snapshot; and because phones only need to know *who* has committed, no
per-player private messages are needed (a phone remembers its own plan).

## Clarifications

Decisions taken while building the server, where the text above is silent.
The protocol (docs/PROTOCOL.md, "Mode `catapult_coop`") has the exact rules.

- **Geometry.** The outer wall is the row `y = 0` and the column `x = 0`;
  the rampart walkway is the next row and column, at height 1. Catapults are
  wall cells; an engineer loads or fires from the walkway cell next to one.
  Stairs connect both heights; otherwise a step needs equal height.
- **Moves** are to a destination cell within the move budget along any walk
  (other engineers do not block the path, only the destination matters at
  resolve). Three or more engineers rotating cells all succeed; only a swap of
  two bumps.
- **Throws** are straight (row or column), 1–4 cells, onto a cell someone could
  stand on. All throws leave the hands at once, so a chain of throws in one
  round works (A to B while B throws on to C). Two throws at one catcher: the
  first (player order) is caught, the second lands at their feet. A bomb that
  cannot rest where it lands (stairs, or a bomb already there) settles on the
  nearest free floor cell. An engineer who catches and also planned a move
  walks on with the bomb (their move was checked when they were empty-handed).
- **Pick-up** reaches the own cell and the four neighbours at any height.
  Contested pick-ups and loads fail for everyone involved; a pick-up also
  fails if the engineer just caught a bomb.
- **Firing** an empty lane wastes the bomb. If two engineers fire the same
  catapult, it fires once.
- **Stopwatch** freezes do not stack: a machine skips `max(current, 2)` more
  advances.
- **Machines** stack freely on lane cells. New machines appear at the far end
  during the machine stage and first move the round after. The TV gets next
  round's arrivals (`incoming`) to draw as shadows.
- **Bombs** on the ground are topped up to *players + 2* after every resolve,
  on random free courtyard floor cells (no bomb, no engineer); if no keg or
  grapeshot exists anywhere, the next one drawn is never a stopwatch.
- **Boss scaling.** The Iron Baron moves every third round and its hit points
  scale with the team (4 for one player, 9 for four, 13 for eight).
- **Mason** is one pick per break for the team: the first pick heals and
  removes Mason from everyone else's offer. Perk offers last only for the
  break; unpicked ones vanish.
- **Away.** Two missed rounds in a row (a timed-out round counts) or a
  disconnect make a player away; any plan, ready or perk stands them back up;
  reconnecting alone does not. Their engineer stays on the board.
- **Late joiners and returning players** get an engineer on a free start cell
  at once, in any phase. A player disconnected at a level start has no engineer
  until they return.
- **Restart** (host) works in any phase but the lobby; Open plans survives it.
- **Keep size** is chosen at the start by the number of players in the room.
