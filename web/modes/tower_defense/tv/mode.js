// tower_defense ("Cobble Crawlers") on the TV: the battlefield, HUD, banners, perk
// announcements, end screen and sound. Contract: see web/modes/README.md.

import { Game } from './game.js';
import { UI } from './ui.js';

const HTML = `
  <canvas id="cv"></canvas>
  <section id="hud">
    <div id="wavePlate" class="plate">
      <div class="wv"><span class="lbl">Wave</span><span id="waveN">1</span><span id="waveTotal" class="of">/ 15</span></div>
      <div class="ph"><span id="phaseLbl"></span><span id="phaseVal"></span></div>
      <div id="preview"></div>
    </div>
    <div id="pstrip"></div>
    <div id="paused">Paused &mdash; waiting for engineers to reconnect</div>
  </section>
  <div id="glow"></div>
  <div id="banner"></div>
  <section id="end"></section>`;

export async function mount(ctx) {
  await ctx.loadCSS(new URL('./tv.css', import.meta.url).href);
  ctx.el.innerHTML = HTML;
  const ui = new UI();
  const game = new Game(ctx.el.querySelector('#cv'), ui);
  game.resize(ctx.px); // before the map arrives, as the old page did
  game.setWelcome(ctx.setup);
  ui.setWelcome(ctx.setup);
  let sound = null; // the event -> sound map, once the audio engine has loaded
  let gone = false;
  ctx.debug.game = game;
  ctx.debug.ui = ui;

  import('./sound.js')
    .then(({ createTVSound }) => createTVSound({ audio: ctx.audio, ready: ctx.audioReady, ui }))
    .then((s) => {
      if (!s) return;
      if (gone) return s.stop();
      s.game = game;
      game.sound = s;
      sound = s;
      ctx.debug.sound = s;
      s.onWelcome(ctx.welcome);
      if (ui.room) s.onRoom(ui.room);
    })
    .catch(() => {});

  return {
    onRoom(room) {
      game.setRoom(room);
      ui.setRoom(room, game);
      sound?.onRoom(room);
    },
    onSnap(snap, now) {
      game.onSnap(snap, now);
      ui.renderStrip(game);
    },
    resize: (px) => game.resize(px),
    frame(now, dt) {
      game.frame(now, dt);
      ui.tick(game, now);
      sound?.tick(game, now);
    },
    perfInfo() {
      let n = 0;
      for (const e of game.ents.values()) if (!e.gone) n++;
      return { canvas: `${game.cv.width}x${game.cv.height}`, enemies: n, text: `${game.cv.width}x${game.cv.height}  ${n} enemies` };
    },
    // /tv?demo=wave|build|boss|won|lost: synthetic game state, for looking at any screen
    demo(kind, deliver) {
      import('./demo.js').then(({ startDemo }) => startDemo(kind, ctx.setup, deliver));
    },
    unmount() {
      gone = true;
      sound?.stop();
      delete ctx.debug.game;
      delete ctx.debug.ui;
      delete ctx.debug.sound;
    },
  };
}
