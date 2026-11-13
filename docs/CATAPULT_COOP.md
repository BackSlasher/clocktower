# `catapult_coop` — design

Second mode for Clocktower. Internal id `catapult_coop`; display name
"Bomb Voyage" (kept in one place, free to change). Status: being built.

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

The keep is larger for big groups; the layout is data, so more keeps can be
added.

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

Machine counts scale with the number of players. Wall hit points carry over
between levels. Clearing the last level wins.

Between levels there is a short break: every player picks one of three perks
(the same pick-one-of-three as the tower defense), e.g. *Strong Arm* (throw
6 cells), *Light Feet* (move one cell further), *Long Reach* (pick up from
two cells away), *Mason* (the wall gets 2 hit points back).

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
