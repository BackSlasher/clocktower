# Mode modules

The pages are a generic **shell** plus one **mode module** per game mode. The shell
(`web/tv/main.js`, `web/phone/app.js`) owns everything that is the same for every game and
knows nothing about any of them; a mode owns what happens once the game is on screen.

A mode has a stable id (`tower_defense`, `stub`) used in code, paths and the protocol, and a
display name and tagline that live only in the server's `mode.Info` and reach the pages in
`welcome.modes`. A module never hard-codes its own display name.

## Files

```
web/modes/<id>/tv/mode.js       TV module (required), plus whatever it imports
web/modes/<id>/phone/mode.js    phone module (required)
```

The shell loads them with `import('/modes/<id>/tv/mode.js')` when `welcome.mode` names the
mode, and again on a `setup` message (the host picked another mode). Paths inside a module are
relative to it (`new URL('./x.css', import.meta.url)`, `import './sprites.js'`); anything shared
is imported from `/shared/` (`dom.js` has `$`, `esc`, `h`, `GEAR_SVG`, `CROWN_SVG`; `audio.js`,
`net.js`, `theme.css`). No build step, no external requests.

`web/modes/stub/` is the smallest complete example; start a new mode by copying it.

## What the shell owns

* **TV**: stage scaling (a logical 1920x1080 stage), the lobby (title, room code, QR, player
  list, host marker, waiting text; with 2+ modes the current mode's name and tagline), the
  reconnecting / replaced badge, the audio engine with volume keys, mute and the "sound is off"
  hint, the Back-twice quit shortcut, the `?fps=1` readout, `?demo=` plumbing.
* **Phone**: connection and session (token, resume, "opened in another tab"), the join form,
  the lobby (players, Start for the host, Leave, mode cards for the host with 2+ modes), toasts,
  the reconnecting banner, the screen wake lock.
* The shell shows its lobby while `room.phase === "lobby"`. **Any other phase belongs to the
  mode**: its container is shown instead, so the mode draws the running game and its own end
  screen. A mode returns to the lobby by having the server move the room to phase `lobby`.
* `defs.maxPlayers` (a number, optional) is the one thing the TV lobby reads from the mode's
  defs (the "n / 8" counter, default 8).

## The contract

```js
export function mount(ctx) {          // may be async
  // build into ctx.el, load CSS with ctx.loadCSS(), keep state in the closure
  return {
    onRoom(room) {},                  // every `room` message, in every phase, lobby included
    onSnap(snap, now) {},             // every `snap` message (now = performance.now() on receipt)
    onStatus(status) {},              // optional: 'connecting' | 'open' | 'closed' | 'replaced'
    unmount() {},                     // remove listeners and timers, stop sound
    // optional, TV only:
    frame(now, dt) {},                // every animation frame (rAF, with a 33 ms timer fallback)
    resize(px) {},                    // device pixels per logical stage pixel (also right after mount)
    perfInfo() {},                    // { canvas, enemies, text } for the ?fps=1 readout
    demo(kind, deliver) {},           // ?demo=kind: feed synthetic room/snap messages to deliver()
    // optional, phone only:
    onError(msg) {},                  // a non-fatal server `error` (the shell already toasted it)
    lobbyOptions(container, { isHost, room }) {}, // the mode's own lobby controls, see below
  };
}
```

### Lobby options (phone, optional)

The lobby belongs to the shell, but a mode may have settings the host picks before starting
(e.g. `catapult_coop`'s Open plans). If the phone module returns `lobbyOptions`, the shell calls
it while the room is in the lobby — once the module has loaded and again on every `room`
message there — with an element under the mode cards and `{ isHost, room }` (the latest `room`
message). The module renders its controls into the container (replacing what it put there
last time) and sends its own messages with `ctx.send`; non-hosts should get a read-only view.
The shell hides the container when it is empty or the hook is absent, and empties it on
unmount. Modes without the hook are unaffected.

Order of calls: `mount(ctx)`, then `resize(px)` (TV), then the `room` and `snap` messages that
arrived while the module was loading, in order, then everything live. After `unmount()` the shell
empties `ctx.el`, removes the stylesheets added with `ctx.loadCSS` and loads the next mode (or
the same one again if the room changed). A reconnect to the same room and mode does **not**
remount: the server sends `welcome`, `room` and a `snap` again, and the mode just sees an
`onRoom` and `onSnap`. A mode must therefore treat `onRoom`/`onSnap` as full state, not deltas
(snap `ev` events aside).

### `ctx`

Both pages:

| member | meaning |
|---|---|
| `id` | this mode's id |
| `el` | empty container to build into; it sits above the shell's lobby (to draw a background under the lobby, give that element `z-index: -1`) and is only visible outside the lobby phase on the phone |
| `setup` | `{ mode, map, defs }`, the mode-specific part of `welcome` / `setup` |
| `welcome` | the latest `welcome` message (`modes`, `joinUrl`, ...) |
| `room` | the room code |
| `send(msg)` | send a client message (the TV sends nothing but may) |
| `loadCSS(href)` | add a stylesheet for the lifetime of the mount; resolves when applied |

Phone: `you` (my player id; read it when needed, it is a live getter), `toast(msg, kind, ms)`
(`kind` is `'ok'` or `'err'`), `buzz(pattern)`, `wake(on)` (keep the screen on), `leave()` (leave
the room and return to the join form; used by the in-game menu).

TV: `stage` (the 1920x1080 stage element), `px`, `audio` (the shared engine from
`/shared/audio.js`; always an object, `audio.supported` says if there is Web Audio),
`audioReady` (a promise that resolves when the sample set is loaded), `debug` (the object
`window.ctDebug`; attach whatever is useful to poke from the console).

## Switching modes

`setup` arrives for every connection when the host picks another mode in the lobby. The shell
calls `unmount()`, loads the new module and stays in the lobby; the `room` that follows goes to
the new module. Players, host and the room code carry over (server side).

## What a simultaneous-turn mode would need on top

Nothing in the contract forbids it, but a mode where every player submits a move per round on
the phone and all moves then resolve together on the TV wants a few additions (kept out until
there is a second real mode to design them against): a shell-level per-round timer / "waiting
for N players" strip fed from the room message, a way for the TV to receive per-player private
state (what each phone shows) without the TV drawing it, replay of the last resolved round to
a reconnecting TV, and a phone `onRoom` that can tell "my move is locked in" from "round over"
without relying on snaps.
