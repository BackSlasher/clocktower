# `catapult_coop` — design

Second mode for Clocktower. Internal id `catapult_coop`; display name
"Hold the Keep" (kept in one place, free to change). Status: server built
(`internal/modes/catapult_coop`, behind the server flag `-wip-modes`); web
clients to come. Wire contract: docs/PROTOCOL.md, "Mode `catapult_coop`".

## Pitch

The horde has reached Brasswick's walls. The engineers are inside the keep
with four steam catapults on the ramparts and the powder store down in the
far corner of the courtyard. Fetch bombs, pass them hand to hand up to the ramparts and
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
  and pipes blocking cells. In one corner of it lies the **powder store**:
  the bombs lie there, and new ones appear there.
- **Ramparts** (high ground): the two sides of the square furthest from the
  viewer are raised walkways. Each has **two catapults**. The only way up is
  by **stairs**, built as corner steps: in the courtyard's inner corner where
  the two ramparts meet, or beside a short ledge sticking out of a rampart.
  The stairs are always far from the store.
- **Lanes**: each catapult looks out over its own lane, running away from the
  wall, 4 cells long. Four catapults, four lanes. Machines appear at the far
  end of a lane and step toward the wall, one step a turn.

There is one keep (id `small`): 9 × 9 cells with a 7 × 7 courtyard. Its
outer shape (size, wall, the four catapults and their lanes) never changes,
so the TV camera never moves, and with at most four players the TV's queue
strip is always a single row under it.

### Nobody can do it alone

The first playtest's lesson: when one engineer starts next to both a bomb
and a catapult, they play the game and the others watch. So the keep is
built for passing:

- The store is down in the courtyard, the catapults up on the ramparts, and
  the stairs on the far side from the store: walking a bomb from the store
  to any catapult takes at least 8 steps (two whole turns, a test checks
  every layout), while a throw crosses the keep in one action.
- So bombs go up by throws: a **fetcher** in the courtyard picks a bomb up,
  steps into a catapult's column or row and throws; a **gunner** on the
  rampart catches and loads. A bomb thrown with nobody to catch it still
  lands on the rampart (the last cell before the wall), where a gunner can
  pick it up, a step or two from a catapult.
- Seats are roles: seats 1 and 3 start in the courtyard by the store
  (fetchers), seat 2 on the top rampart and seat 4 on the left one, each at a
  catapult (gunners). Two players are a fetcher and a gunner; three, two
  fetchers feeding one gunner; four, two of each. A lone player starts by the
  store and has to do the long walk.
- Machines come on several lanes over a level, more lanes for bigger teams
  (up to three players mostly the top two, four players both ramparts from
  level 1), so a team of four has to split: each gunner minds a rampart,
  each fetcher feeds whoever is in trouble.

**The interior belongs to the level.** Each level brings its own layout of
the keep: which courtyard cells are crates, which are raised platforms or
ledges (height 1, reached by stairs like the ramparts), where the stairs and
the store are, where the engineers start and which store cells hold a bomb
when the level begins. At every level start the engineers go back to the
start cells and the board is cleared of bombs (in hands, in catapults, on
the ground) before the level's own bombs are placed. Layouts are ASCII
drawings in the code; tests check every one (all catapults reachable from
every start cell, every bomb reachable, no walled-off pockets, every stairs
cell a corner step: two raised neighbours at a right angle, two low ones,
nothing blocked; the store at least 8 steps from every catapult's loading
cell and big enough for a full team's bombs). The keep has four layouts:

```
 open (level 1)   crates (2, 5)    platform (3)     split (4, 6)
 WWWCWWCWW        WWWCWWCWW        WWWCWWCWW        WWWCWWCWW
 W=====b==        W==b=====        W=====b==        W==b=====
 W=S......        W=.....S=        W=..#,.o,        W=S......
 C=.......        C=..#....        Cd.....3.        C=.......
 W=.......        W=....#..        W=..#,.o,        W=.......
 W=.......        W=.#.....        W=.....1,        W=######.
 Cd.......        Cd...#...        C===.....        Cd.1.....
 W=..o,o,,        W=o,,,#..        W==S..#..        W=o,,....
 W=..3,1,,        W=,o1.3..        W=.......        W=,o,.3..
```

`W` wall, `C` catapult, `=` raised floor (rampart, ledge), `.` courtyard,
`#` crate, `S` stairs, `,` store, `o` store with a bomb at the start, `1` `3`
fetcher seats, `b` `d` gunner seats (seats 2 and 4, on the rampart). *open*
is flat with the store in the far corner; *crates* puts the store in the
near-left corner and the stairs top right behind a ledge; *platform* has the
store top right and the stairs bottom left in an L-shaped ledge off the left
rampart; *split* walls the store off from the stairs with a row of crates
(the way round is through the far gap).

## A turn

1. **Plan** (a timer per level, long while the team learns: 90, 70, 60,
   50, 45, 40 s for levels 1–6; the tutorial's turns have no timer, so a new
   group can take its time). Every player files a **queue** of up to
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

Bombs appear on free cells of the powder store, so there are always a few
lying there (more for bigger groups). A catapult has no aim: it fires down its own lane.

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

## Guided tutorial

The first playtest's verdict on the old free-play level 1: it "didn't
involve people enough and have them move around and do things enough to
understand the mechanics", and level 2's 20-second timer had them
scrambling. So the game now opens with a guided tutorial on level 1's
layout, before level 1: a script of untimed turns ("steps"), each with one
concrete goal per player, written big at the top of the TV (a short
imperative title and one sentence) with a personal line per player, a
marked cell, and a suggested exact queue the phone can file in one tap. A
step repeats until every goal is met, then the next starts. Goals are
checked by what happened, not by whether the suggestion was followed;
suggestions are path-found on the board every turn, for the whole team at
once, so they stay right after someone wanders off and never make two
engineers bump.

By the end every player has walked somewhere (someone over the stairs, in
fact everyone), picked a bomb up, thrown one a teammate caught, caught one,
and loaded a catapult that fired and destroyed a machine. Fetchers and
gunners swap jobs halfway. Machines are still targets until the last step,
"Now for real!", where a few Scraplings move as usual (still untimed). Then
level 1 starts with the wall repaired and the stats cleared. The host can
skip the tutorial (`skip_tutorial`); `go` still plays a stuck turn.

Seats as in the levels: 1 and 3 fetchers in the courtyard, 2 and 4 gunners
on the ramparts. With 2 players (one pair) or 4 (pairs 1→2 and 3→4):

| # | title | fetchers (seats 1, 3) | gunners (seats 2, 4) |
|---|-------|-----------------------|----------------------|
| 1 | Pick up a bomb | walk onto the marked bomb, pick it up | 2 walks along the rampart to catapult 0; 4 is already at catapult 3 |
| 2 | Throw it up | step into the gunner's column or row, throw | catch |
| 3 | Load and fire | walk to the foot of the stairs | load: the catapult kills its target |
| 4 | Swap: gunners come down | wait at the foot of the stairs | take the stairs down into the yard |
| 5 | Swap: climb the stairs | climb to catapult 1 (seat 1) / 3 (seat 3) | pick up a bomb |
| 6 | Throw it up | catch | throw up to your old fetcher |
| 7 | Load and fire | load: kill | pick up another bomb |
| 8 | Now for real! | play | play |

With 3 players (one gunner): 3 picks up while 1 steps into line and 2 walks
to catapult 0; 3 throws across the yard to 1 (a catch in the courtyard); 1
throws up to 2; 2 loads and fires; 2 comes down while 1 and 3 wait at the
foot of the stairs; 1 and 3 climb (1 beside catapult 1, 3 to catapult 3)
while 2 picks up; 2 throws to 3; 3 loads and fires; 2 lobs a bomb up
column 6 with nobody on the line, so it lands on the rampart by catapult 1;
1 picks it up and loads it; now for real (11 steps). Alone: pick up, lob it
onto the rampart, climb the stairs, pick it up and load it, now for real (4
steps).

Following the suggestions exactly, the bots finish the tutorial in about 10
turns alone, 11 for two, 17 for three, 14 for four; bots wasting a quarter
of their actions need about 21, 29 and 27 turns for two, three and four.

## Levels

A game is a series of levels. A level is a script: which machines appear on
which lane in which turn, a few at a time over the level. It ends when
everything in the script has been destroyed or has reached the wall. Lanes are
4 cells, so a machine can be shot during four plan phases (a Clockroach,
two cells a turn, during two); a level lasts about five to seven turns.
Difficulty is how many machines come on how many lanes, how close together:

1. **First Shots** (*open*): Scraplings, a few at a time, on the gunners'
   lanes; four players get both ramparts from the start.
2. **Two Fronts** (*crates*): more Scraplings, closer together.
3. **Roach Run** (*platform*): a Clockroach pair; grapeshot appears.
4. **Brass Arrives** (*split*): the first Brute; stopwatches appear.
5. **Full Tilt** (*crates*): everything at once.
6. **The Iron Baron** (*split*): the Baron, with company.

Each level lists the bomb kinds that can appear, with weights: levels 1–2
have powder kegs only, grapeshot arrives with the Clockroaches (level 3), the
stopwatch with the Brutes (level 4).

Machine counts, lanes and the Iron Baron's hit points are set per team size
in the level data, so the curve can be shaped. The scripts today (turn 0 =
on the board at the level start, turn t = arrives at the end of turn t; `S`
Scrapling, `R` Clockroach, `B` Brute, `I` Iron Baron, digit = lane; lanes 0
and 1 are the top rampart's, 2 and 3 the left one's):

| level | 1 player | 2 players | 3 players | 4 players |
|-------|----------|-----------|-----------|-----------|
| 1 | 1: S1 | 0: S1 · 1: S0 · 3: S1 | 0: S1 · 1: S0 · 3: S1 · 4: S0 | 0: S1 S3 · 1: S0 · 3: S1 S3 |
| 2 | 0: S0 · 1: S1 | 0: S0 · 1: S1 · 2: S0 · 3: S1 | 0: S0 · 1: S1 S3 · 2: S0 | 0: S0 · 1: S1 S3 · 2: S0 · 3: S2 |
| 3 | 0: S1 · 1: 2×R0 | 0: S1 · 1: S0 2×R0 | 0: S1 · 1: S0 2×R0 | 0: S1 S2 · 1: 2×R0 · 2: S3 |
| 4 | 0: S0 · 1: B1 | 0: S0 · 1: S3 B1 · 2: S1 | 0: S0 · 1: S3 B1 | 0: S0 · 1: S3 B1 · 2: S1 · 3: S2 |
| 5 | 0: S0 · 1: S1 | 0: S0 · 1: S1 · 2: S0 2×R1 | 0: S0 · 1: S1 · 2: S0 2×R1 · 3: B0 | 0: S0 · 1: S1 S3 · 2: 2×R1 |
| 6 | 0: S1 · 1: I0 (3 HP) S3 | 0: S1 · 1: I0 (5 HP) S3 | 0: S1 · 1: I0 (4 HP) S3 | 0: S1 · 1: I0 (6 HP) S3 · 2: S2 |

Teams of two and three are pressed mostly on the top lanes (one gunner); a
left-lane machine now and then makes someone take the long way round. Wall
hit points (20) carry over between levels. Clearing the last level wins.

Between levels there is a short break: a few seconds showing the level result
(level cleared, wall hit points), over when everyone presses ready. There are
no choices to make; a tunable can give the wall a hit point or two back at
each break.

## Players who are away

- The timer ends every plan phase after the tutorial, so nobody can stall
  the game. The tutorial's turns (and the first turn, if the tutorial is
  skipped at once) wait for every connected player
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
  on random free cells of the layout's store (no bomb, no engineer; with
  every store cell taken the top-up waits a turn); if no keg or grapeshot
  exists anywhere, the next one drawn is never a stopwatch.
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
team (gunners on the ramparts catch, pick up bombs lobbed onto the rampart
and load; fetchers in the courtyard walk, pick up and throw), simulating each
slot to plan the next. The tuning target is a **sloppy** team whose every
player wastes a quarter of their actions (25% chance per slot to wait
instead). Run the tables with
`CT_BALANCE_RUNS=200 go test ./internal/modes/catapult_coop/bot -run 'TestBalance|TestParticipation' -v`
(`CT_TRACE=4` with `-run TestDebugTrace` prints a game turn by turn;
`CT_TRACE_MISTAKE=0.25` makes it sloppy; the trace plays the tutorial
first). The balance runs skip the tutorial (the host sends
`skip_tutorial`); `TestGuideTeaches` and `TestGuideNoDeadlock` play it, the
harness acting as a host would (`go` on a turn stuck for 30 s, a skip after
60 turns). The bots play the tutorial by filing `guide.tasks[me].acts`.

Current knobs: wall 20 HP, lanes 4 cells, every machine moving one step a
turn (Clockroaches two), machines arriving over the level (see the scripts
under "Levels"), bombs on the ground players + 2 in the store, no heal at
breaks. Results, 200 games per row (first playtest build, for comparison:
wall 16, lanes 3, one wave per level, bombs anywhere):

| team | wins | wall left when won (of 20) | turns per game | losses |
|------|------|----------------------------|----------------|--------|
| 4 perfect bots | 100% | 14.1 | 32 | — |
| 4 bots, 15% wasted | 99% | 6.2 | 36 | level 6 |
| **4 sloppy (25% wasted)** | **58%** | 2.6 | 37 | level 6 (one on 5) |
| 4 sloppy, 10% pointless moves on top | 4% | 1.6 | 35 | levels 5–6 |
| **2 / 3 sloppy** | **58% / 56%** | 2.4 / 2.6 | 35 / 36 | level 6 (a few on 5) |
| 3 sloppy + 1 idle | 13% | 1.9 | 34 | levels 5–6 |
| 2 perfect | 100% | 11.2 | 32 | — |
| 1 perfect / 1 sloppy | 100% / 100% | 6.9 / 4.5 | 27 / 29 | — |

Turns per level in a won 4-player sloppy game: about 7, 7, 5, 7, 5, 6.
Levels 1–4 are never lost.

**Everyone plays.** `TestParticipation` counts, per level, the players who
did something useful (picked a bomb up, loaded one, threw one that was
caught, or caught one that was later loaded) and, stricter, who handled a
bomb that ended up in a catapult. With the new layouts every seat is useful
in every level (perfect bots: 100% of players on every level and team size;
sloppy: 98–99% on level 1, 87–99% elsewhere); in the first playtest build a
4-player team had one useful player on level 1 (25%). The share of
player-turns with a useful action is 69–88% on level 1 for perfect bots, 45–48%
for sloppy ones.

**Nobody can do it alone.** Level 1 with one perfect bot and idle
teammates, against a full team (wall hit points lost on level 1):

| players | full perfect team | full sloppy team | 1 worker (a fetcher) + idle | 1 worker (a gunner) + idle |
|---------|-------------------|------------------|-----------------------------|----------------------------|
| 2 | 0 | 1.0 | 3 (every machine) | 3 |
| 3 | 0 | 1.1 | 3 | 4 (every machine) |
| 4 | 0 | 1.4 | 5 (every machine) | 5 |

Idle teammates also get in the way: a free-handed engineer standing in a
throw line catches the bomb and holds it.

Solo play is weak by design (a lone engineer walks every bomb round to the
stairs: about one kill per four turns) and the solo scripts are short, so a
solo game is won on the wall outlasting the machines rather than by killing
them; the level 1 Scrapling comes a turn late so a lone engineer can reach it.

The outcome is steep in wasted actions (15% wasted wins 99%, 25% wins 58%),
and pointless moves (bumps, walking out of a catcher's line) hurt much more
than plain waiting.
