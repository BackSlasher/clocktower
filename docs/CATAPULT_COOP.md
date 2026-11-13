# `catapult_coop` — design

Second mode for Clocktower. Internal id `catapult_coop`; display name
"Hold the Keep" (kept in one place, free to change). Status: server built
(`internal/modes/catapult_coop`, behind the server flag `-wip-modes`); web
clients to come. Wire contract: docs/PROTOCOL.md, "Mode `catapult_coop`".

## Pitch

The horde has reached Brasswick's walls. The engineers are inside the keep
with four steam catapults on the ramparts and bombs lying all over the
courtyard below. Fetch bombs, pass them hand to hand up to the ramparts and
load them; a loaded catapult fires by itself the moment a machine is in its
lane. Everybody plans their next few moves at the same time, in full view of
each other, then all the moves happen at once, step by step.

Where the tower defense is real-time and loose, this is turn-based and tight:
nothing happens until everyone has committed, and one person walking the wrong
way breaks the chain. The fun is the shouting during planning ("no, throw it
*left*, I'm on the rampart!") and the groan when two people both went for the
same bomb.

1–4 players, best at 3–4 (the mode's `maxPlayers`; the lobby refuses to switch
to it with more players seated).

## The keep

The TV shows the keep in an isometric view: a square courtyard seen from one
corner.

- **Courtyard** (low ground): a grid of about 7 × 7 cells with a few crates
  and pipes blocking cells. Bombs lie scattered here.
- **Ramparts** (high ground): the two sides of the square furthest from the
  viewer are raised walkways. Each has **two catapults**. The only way up is
  by **stairs**, built as corner steps: the main flight in the courtyard's
  inner corner where the two ramparts meet, sometimes a second one beside a
  short ledge sticking out of a rampart.
- **Lanes**: each catapult looks out over its own lane, running away from the
  wall, 3 cells long. Four catapults, four lanes. Machines appear at the far
  end of a lane and step toward the wall, one step a turn.

There is one keep (id `small`): 9 × 9 cells with a 7 × 7 courtyard. Its
outer shape (size, wall, the four catapults and their lanes) never changes,
so the TV camera never moves, and with at most four players the TV's queue
strip is always a single row under it.

**The interior belongs to the level.** Each level brings its own layout of
the keep: which courtyard cells are crates, which are raised platforms
(height 1, reached by stairs like the ramparts), where the stairs are, where
the engineers start and where bombs lie when the level begins. At every level
start the engineers go back to the start cells (seat 1 on a rampart right at
a catapult, seat 3 on the other rampart; seats 2 and 4 in the courtyard, lined
up with them for a first throw) and the board is cleared of
bombs (in hands, in catapults, on the ground) before the level's own bombs are
placed. Layouts are ASCII drawings in the code; a test checks every one (all
catapults reachable from every start cell, every bomb reachable, no
walled-off pockets, every stairs cell a corner step: two raised neighbours at
a right angle, two low ones, nothing blocked). The keep has four layouts: *open* (flat, the
tutorial), *crates*, *platform* (a raised platform with a bomb on it) and
*split* (a line of crates splitting the courtyard, two platforms).

## A turn

1. **Plan** (20 s; a tunable; the game's very first turn has no timer, so a
   new group can take its time). Every player files a **queue** of up to
   **four actions**, and presses **done**. Queues are visible to everyone as
   they are edited, on the TV and every phone. The phase ends as soon as
   everyone is done, or on the timer.
2. **Resolve** (a few seconds). The TV plays action 1 of every queue at once,
   then action 2, then 3, then 4 (each in the fixed order below); then the
   machines advance one step and new ones arrive.
3. Repeat. A machine that reaches the wall damages it and is destroyed. The
   wall has shared hit points; at zero the game is lost.

### Plans are public

Every player's queue is shown to everyone, live, while it is being edited:
the TV draws each engineer's planned path and actions, and every phone sees
them too. There are no secret plans. Four actions per turn are a lot to
coordinate, and since nobody can know for certain where a teammate will be
at action 3, seeing their queue is what makes plans like "you walk two cells
right, then I throw at you" possible. The fun moves from guessing to talking:
the team spots the bump or the missing catcher on the TV and shouts a
correction before the timer runs out.

## Actions

Up to four per player per turn, played in order. Every action is relative to
where the engineer is when it comes up, and is checked only then: an action
that turns out impossible (walking into a wall, picking up where no bomb
lies, loading with empty hands) **fizzles** and the rest of the queue still
runs. There is no fire action: catapults fire themselves.

| action | effect |
|--------|--------|
| **Move** | step to the neighbouring cell in one of four directions (carrying or not); levels change only via stairs |
| **Pick up** | take the bomb lying in your own cell (walk onto it first) |
| **Throw** | throw the bomb you carry in one of four directions; it flies in a straight line over crates, platforms and height differences until it meets an engineer or the wall. The first engineer on the line catches it if their hands are free, otherwise it bounces off them and drops at their feet; with nobody on the line it lands on the last cell before the wall (or the edge of the keep) |
| **Load** | put the bomb you carry into the catapult next to you (on the rampart); it fires by itself as soon as its lane has a machine — right away if one is there |
| **Wait** | do nothing (also what empty slots do) |

Walking is one cell an action and stairs are a detour, while a throw crosses
the whole keep and ignores height. A good turn for a pair: the courtyard
engineer walks onto a bomb, picks it up, steps into line and throws; the
rampart engineer waits for the catch, then loads, and the catapult fires. Lining up, and keeping the line
clear of teammates with full hands, is the game.

### Resolve order

For each action slot in turn (1, 2, 3, 4), for everyone at once:

1. Throws fly and are caught, bounce off a full-handed engineer, or land.
2. Moves. Two engineers heading for the same cell bump and both stay put.
   Swapping places is also a bump. Walking into a cell someone is leaving is
   fine.
3. Pick-ups (each from its own cell) and loads. Two engineers loading the
   same catapult: neither succeeds.
4. Every loaded catapult whose lane has a machine fires by itself. A catapult
   loaded while its lane is empty waits, and fires in the first slot after a
   machine has arrived (machines arrive at the end of a turn, so the team sees
   it for one plan phase first).

Then, once per turn: machines advance; new machines appear; new bombs appear
in the courtyard.

Each slot acts on the board the previous slots left. Within a slot throws go
first (positions before moves), so "I throw at you, then you walk" works in
the same slot, and "you walk into my line and I throw" needs your step one
slot earlier. Catching is a deliberate, called play.

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
| **Scrapling** | 1 hit point, 1 cell a turn, 1 wall damage |
| **Clockroach** | 1 hit point, 2 cells a turn, comes in clusters (grapeshot fodder) |
| **Brass Brute** | 4 hit points, 1 cell a turn, 2 wall damage |
| **Iron Baron** | boss; hit points grow with the team, 1 cell a turn, 3 wall damage |

Same cast as the tower defense, so both modes share art and sounds. The TV
shows the next turn's arrivals as shadows at the far end of the lanes.

Later, maybe: Aero-Drones that land in the courtyard and block a cell; a
fused bomb that goes off after three rounds wherever it is.

## Levels

A game is a series of levels. A level is a script: which machines appear on
which lane in which turn (today each level is one wave: all its machines
appear at the start). It ends when everything in the script has been
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
(tutorial: *open*; 2–3: *crates*; 4: *platform*; 5–6: *split*). A level
takes about three turns.

Machine counts scale with the number of players (an explicit count per team
size in the level data, so the curve can be shaped). Wall hit points carry
over between levels. Clearing the last level wins.

Between levels there is a short break: a few seconds showing the level result
(level cleared, wall hit points), over when everyone presses ready. There are
no choices to make; a tunable can give the wall a hit point or two back at
each break.

## Players who are away

- The timer ends every plan phase but the game's first, so nobody can stall
  the game after the start. The first turn waits for every connected player
  to press done (it never waits for a disconnected one); the host can play
  the turn at once from the ⋯ menu ("Play the turn now", queues as filed),
  end a break early ("Start now"), or restart.
- An engineer whose player filed nothing for two turns in a row, or is
  disconnected, sits down: the turn no longer waits for them and they are not
  counted for scaling. Any plan from them stands them back up. Pressing done
  with an empty queue is a deliberate "do nothing" and does not count as
  missed.
- A phone that reconnects mid-plan gets the board and can still commit.

## Phone

A controller, not a map: eyes stay on the TV. Landscape first.

- Your colour and name in large type (to find your engineer on the TV), what
  you are carrying, the countdown and who has committed.
- A diamond of four arrows matching the TV's diagonals. One tap moves one
  cell that way.
- Buttons for Pick up, Throw, Load and Wait. Throw then takes one arrow.
  Pick up takes the bomb underfoot; Load needs no choice (the server uses the
  catapult next to you). There is no Fire button: a loaded catapult fires by
  itself.
- The phone predicts nothing: no catcher, no landing spot. An arrow is greyed
  only when the action is flatly impossible (a wall, a ledge). A later hard
  mode could stop greying too.
- Your queue (up to four actions, then done) can be changed until the turn
  resolves; everyone's queue is public. During resolve the phone says "watch
  the TV", then tells you what happened to you.

## Shared shell

No changes to the mode interface are needed. `Step(dt)` runs the plan timer
and resolve delay; the resolve playback travels as ordered events in the
snapshot; and because plans are public, they travel in the snapshot too: no
per-player private messages are needed.

## Clarifications

Decisions taken while building the server, where the text above is silent.
The protocol (docs/PROTOCOL.md, "Mode `catapult_coop`") has the exact rules.

- **Geometry.** The outer wall is the row `y = 0` and the column `x = 0`;
  the rampart walkway is the next row and column, at height 1. Catapults are
  wall cells; an engineer loads from the walkway cell next to one.
  Stairs connect both heights; otherwise a step needs equal height.
- **Moves** are one step in a direction. Four engineers walking round a
  square all succeed; only a swap of two bumps.
- **Actions are relative and checked when their slot plays.** Load uses the
  lowest-numbered empty catapult next to the engineer. Pick-up takes the bomb
  underfoot. A fizzle is reported with a reason and the rest of the queue
  runs.
- **Throws** take a direction only. The line ends before a catapult, the outer
  wall or the edge of the grid; crates are flown over and can't be landed on.
  All throws of a slot leave the hands at once, so a chain of throws works
  (A to B while B throws on to C), and an engineer who caught one bomb in a
  slot blocks the next. A bomb that can't rest where it comes down (stairs,
  or a bomb already there) settles on the nearest free floor cell. An engineer
  who catches and also moves in that slot walks on with the bomb.
- **Pick-up** works only on the engineer's own cell, so two pick-ups can
  never collide; it fails if the engineer just caught a bomb in the same
  slot. Contested loads fail for everyone involved (no current layout has a
  catapult with two loading cells).
- **Automatic fire** is checked at the end of every slot, after that slot's
  loads, in catapult order; a catapult never fires into an empty lane. Kills
  and damage are credited to whoever loaded the bomb.
- **Stopwatch** freezes do not stack: a machine skips `max(current, 2)` more
  advances.
- **Machines** stack freely on lane cells, move once per turn after the last
  action slot, appear at the far end and first move the turn after. The TV
  gets next turn's arrivals (`incoming`) to draw as shadows.
- **Bombs** on the ground are topped up to *players + 2* after every turn,
  on random free courtyard floor cells (no bomb, no engineer); if no keg or
  grapeshot exists anywhere, the next one drawn is never a stopwatch.
- **Iron Baron** does 3 wall damage; its hit points are set per team size in
  the level data.
- **No perks.** The break between levels is a short intermission with no
  choices (an optional wall heal is a tunable, `breakHeal`, 0 today).
- **Away.** Two turns in a row with nothing filed (an empty queue not marked
  done) or a disconnect make a player away; any plan or ready stands them
  back up; reconnecting alone does not. Their engineer stays on the board.
- **Late joiners and returning players** get an engineer on a free start cell
  at once, in any phase. A player disconnected at a level start has no engineer
  until they return.
- **Restart** (host) works in any phase but the lobby. The next game's first
  turn is untimed again.

## Balance notes

Tuned for error-prone party players, not for perfect play. The scripted bots
(`internal/modes/catapult_coop/bot`) plan whole four-action queues for the
team (gunners on the ramparts catch and load; fetchers in the courtyard
walk, pick up and throw), simulating each slot to plan the next. The tuning
target is a **sloppy** team whose every player wastes a quarter of their
actions (25% chance per slot to wait instead). Run the table with
`CT_BALANCE_RUNS=100 go test ./internal/modes/catapult_coop/bot -run TestBalance -v`.

Current knobs: wall 16 HP, lanes 3 cells, every machine moving one step a
turn (Clockroaches two), each level one wave at its start, bombs on the ground
players + 2, seats 1 and 3 on the ramparts and 2 and 4 in the courtyard lined
up with them, machine counts and Iron Baron HP per team size in each level's
data (tuned by searching a ladder of single-machine steps per team size), no
heal at breaks. Results, 100 games per row:

| team | wins | wall left when won (of 16) | turns per game | losses |
|------|------|----------------------------|----------------|--------|
| 4 perfect bots | 100% | 6.0 | 18 | — |
| 4 bots, 15% wasted | 93% | 2.8 | 18 | level 6 |
| **4 sloppy (25% wasted)** | **49%** | 1.6 | 17 | level 6 |
| 4 sloppy, 10% pointless moves on top | 8% | 1.6 | 17 | level 6 |
| 1 / 2 / 3 sloppy | 31% / 68% / 58% | 1.1 / 1.3 / 1.4 | 17 / 17 / 17 | level 6 |
| 3 sloppy + 1 idle | 31% | 1.5 | 17 | level 6 |
| 1 / 2 perfect | 100% / 100% | 1.9 / 4.2 | 16 / 17 | — |

Turns per level in a won 4-player game: about 2, 3, 3, 3, 3, 3. The tutorial
and levels 2–5 are never lost; every loss is on level 6. Wins end with a hit
point or two left.

Solo play is nearly deterministic: a lone engineer kills little (fetching a
bomb, climbing the corner stairs and loading takes most of a turn) and wins or
loses on total machine damage against wall hit points, so one machine more or
less moves the solo win rate between about 31% and 88%; 31% is the current
setting.

The outcome is steep in wasted actions (15% wasted wins 93%, 25% wins 49%),
and pointless moves (bumps, walking out of a catcher's line) hurt much more
than plain waiting.
