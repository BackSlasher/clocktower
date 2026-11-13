# `catapult_coop` — design draft

**Status: proposal, nothing built.** Second mode for Clocktower. Internal id
`catapult_coop`; display name undecided ("Bomb Voyage" is used below as a
placeholder). Everything here is open to change; the questions at the end are
the ones that shape the rest.

## Pitch

The horde has reached Brasswick's wall. The engineers are in the foundry yard
behind it with a steam catapult and a powder store that is, unhelpfully, on
the far side of the yard. Carry bombs across, pass them hand to hand, load,
aim, fire. Everybody plans their move in secret at the same time, then all the
moves happen at once.

Where the tower defense is real-time and loose, this is turn-based and tight:
nothing happens until everyone has committed, and one person walking the wrong
way breaks the chain. The fun is the talking during the planning seconds and
the groan when two people both went for the same bomb.

2–8 players, best at 3–5. One game is about 12–15 minutes.

## The yard

The TV shows one screen, split in two:

- **The yard** (bottom two thirds): a grid, roughly 9 × 5 cells for four
  players. It holds the engineers, one or two **powder stores** on one edge,
  one or two **catapults** against the wall on the opposite edge, and a few
  crates and pipes that block cells so there is no single straight route.
- **The approach** (top third): 5 lanes running away from the wall, 6 cells
  deep. Machines appear at the far end and step toward the wall every round.

Yard size, number of catapults and number of lanes grow with player count.

## A round

1. **Plan** (12 s, shorter in later rounds). Every phone shows the yard and
   that player's choices. Each player picks **one** action. The TV shows a
   tick next to each name as plans come in, and the phase ends as soon as
   everyone has committed. A plan can be changed until then.
2. **Resolve** (about 3 s). The TV plays all actions at once, in a fixed order
   (below), then the machines advance and new ones arrive.
3. Repeat. A machine that reaches the wall damages it and is destroyed. The
   wall has shared hit points; at zero the game is lost. Survive the last
   round to win.

## Actions

| action | effect |
|--------|--------|
| **Move** | walk up to 2 cells (1 cell while carrying a bomb) |
| **Pick up** | take a bomb from an adjacent powder store, or one lying in your cell or next to it |
| **Throw** | throw the bomb you carry up to 4 cells in a straight line; a free-handed engineer in the target cell catches it, otherwise it lands on the ground there |
| **Load** | put the bomb you carry into an adjacent, empty catapult |
| **Fire** | adjacent to a loaded catapult: pick a cell on the approach; the bomb lands there this round |
| **Wait** | do nothing (also what happens if the timer runs out) |

Carrying is slow and throwing is fast, which is the whole point: one engineer
walking a bomb across the yard takes five rounds; four engineers standing in a
line move one bomb per round.

### Resolve order

1. Throws fly and are caught.
2. Moves. Two engineers heading for the same cell bump and both stay put.
   Swapping places is also a bump.
3. Pick-ups and loads. Two engineers grabbing the same bomb: neither gets it.
4. Catapults fire. The bomb lands where it was aimed, **before** the machines
   move, so you aim at what you see, not at a guess.
5. Machines advance; new machines appear.

Because throws go first, "I throw to where you are, then you walk" works, and
"you walk there and I throw to where you will be" does not. That is one simple
rule to learn, and it makes catching a deliberate, called play.

## Bombs

Different stores hold different bombs; a store shows what it gives.

| bomb | effect |
|------|--------|
| **Powder keg** | 2 damage to one cell |
| **Grapeshot** | 1 damage to a cell and its four neighbours |
| **Stopwatch** | no damage; machines in a 3 × 3 area skip their next move |

Later, maybe: a fused bomb that goes off after three rounds wherever it is,
including in someone's hands.

## Machines

| machine | traits |
|---------|--------|
| **Scrapling** | 1 hit point, 1 cell a round |
| **Clockroach** | 1 hit point, 2 cells a round, comes in clusters (grapeshot fodder) |
| **Brass Brute** | 4 hit points, 1 cell every other round, hits the wall hard |
| **Aero-Drone** | flies over the wall and drops into the yard, blocking a cell until someone spends an action shoving it out |
| **Iron Baron** | boss of the final rounds; many hit points, takes two lanes |

Same cast as the tower defense, so both modes share art and sounds.

The TV shows the next round's arrivals as shadows at the far end of the
lanes, so planning has something to plan against.

## Shape of a game

Three shifts of about 10 rounds. Between shifts there is a short breather:
the wall gets a little repair and every player picks one of three perks (the
same pick-one-of-three screen as the tower defense), for example *Strong
Arm* (throw 6 cells), *Light Feet* (move 3), *Juggler* (catch while
carrying, holding two).

## Player count

- **Solo and two players** would be dull with one action a round, so each
  engineer gets two actions per round.
- **3–5**: as described.
- **6–8**: second catapult, second store, wider yard, more lanes.

Machine numbers scale with player count; the bots-and-harness approach used
to balance the tower defense applies here unchanged (and is easier, since
the game is deterministic per round).

## Players who are away

- The timer ends every plan phase, so nobody can stall the game.
- An engineer whose player missed two rounds in a row, or is disconnected,
  sits down: the round no longer waits for them and they are not counted
  for scaling. Any plan from them stands them back up.
- A phone that reconnects mid-plan gets the board and can still commit.

## Phone

Landscape. The yard fills the screen, your engineer highlighted.

- Tap a highlighted cell to move there.
- Action buttons along the side for what is possible right now (Pick up,
  Throw, Load, Fire); Throw and Fire then ask for a target cell.
- Your chosen action is drawn on your own phone as an arrow or icon, with a
  big **Change** button until the round resolves.
- During resolve the phone just says "watch the TV".

## What the shared shell needs

The mode interface built for the tower defense already covers lobby, roster,
commands, reconnect, the TV/phone module loading and mode switching. This
mode adds three needs:

1. **Turn pacing.** The existing `Step(dt)` loop is enough to run the plan
   timer and the resolve delay; no change to the interface. The 10-per-second
   snapshot stream is wasteful for a turn game but harmless; the mode can send
   the same small snapshot.
2. **Resolve playback.** The TV needs the list of what happened in a round,
   in order, to animate it. That fits the existing events-in-snapshot channel.
   A TV that reconnects mid-resolve just shows the end state.
3. **Hidden plans.** If plans stay secret (see question 1), phones only need
   to know *who* has committed, which is public; each phone already knows its
   own plan. So no per-player private messages are needed. If we ever want
   real hidden information, the interface needs a per-recipient view, which it
   does not have today.

So: no shell changes required to start. Work is one new server package
(`internal/modes/catapult_coop`), two web modules, a bot for balance, and
registering the mode — at which point the lobby's mode picker appears on its
own.

## Open questions

1. **Secret or visible plans?** Secret (TV shows only ticks) forces people to
   talk and produces collisions, which is the comedy. Visible (TV draws ghost
   arrows as people choose) is calmer and more of a puzzle. I lean secret.
2. **One action a round, or move-then-act?** One action is easier on the
   phone and makes passing matter more. Move-then-act is faster-paced. I lean
   one action.
3. **How punishing are collisions?** Bump-and-stay is mild. Dropping what you
   carry on a bump is funnier and harsher.
4. **Timer length.** 12 s is a guess; it decides whether this is a thinking
   game or a shouting game.
5. **Name.**
