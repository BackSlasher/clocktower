// catapult_coop on the TV: the keep in isometric view, resolve playback, HUD, break panel, end
// screen and sound. Contract: see web/modes/README.md; wire: docs/PROTOCOL.md "Mode catapult_coop".

import { Game } from './game.js';
import { UI, HTML } from './ui.js';

export async function mount(ctx) {
  await ctx.loadCSS(new URL('./tv.css', import.meta.url).href);
  const root = document.createElement('div');
  root.className = 'cc-root';
  root.innerHTML = HTML;
  ctx.el.append(root);
  const ui = new UI(root);
  const game = new Game(root.querySelector('#ccCv'), ui);
  game.resize(ctx.px);
  ui.setSetup(ctx.setup);
  game.setSetup(ctx.setup);
  let sound = null;
  let gone = false;
  let stopDemo = null;
  ctx.debug.game = game;
  ctx.debug.ui = ui;

  import('./sound.js')
    .then(({ createTVSound }) => createTVSound({ audio: ctx.audio, ready: ctx.audioReady }))
    .then((s) => {
      if (!s) return;
      if (gone) return s.stop();
      sound = s;
      game.sound = s;
      ctx.debug.sound = s;
      if (ui.room) s.onRoom(ui.room);
    })
    .catch(() => {});

  return {
    onRoom(room) {
      game.setRoom(room);
      ui.setRoom(room);
      sound?.onRoom(room);
    },
    onSnap(snap, now) {
      game.onSnap(snap, now);
    },
    resize: (px) => game.resize(px),
    frame(now, dt) {
      game.frame(now, dt);
      ui.tick(game, now);
      sound?.tick(game, now);
    },
    perfInfo() {
      const n = game.board?.mach.size || 0;
      const c = `${game.cv.width}x${game.cv.height}`;
      return { canvas: c, enemies: n, text: `${c}  ${n} machines${game.pb ? '  (resolving)' : ''}` };
    },
    // /tv?demo=plan|resolve|break|won|lost|boss[&n=8]: a synthetic game, for looking at any screen
    demo(kind, deliver) {
      import('./demo.js').then(({ startDemo }) => {
        if (!gone) stopDemo = startDemo(kind, ctx.setup, deliver);
      });
    },
    unmount() {
      gone = true;
      stopDemo?.();
      sound?.stop();
      game.sound = null;
      game.destroy();
      ui.destroy();
      delete ctx.debug.game;
      delete ctx.debug.ui;
      delete ctx.debug.sound;
    },
  };
}
