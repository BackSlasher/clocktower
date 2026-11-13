// TV sound for catapult_coop: maps playback cues, phase changes and room changes onto the
// shell's audio engine (ctx.audio), using the existing sample set only. Degrades silently.
//
// Music: lobby and break -> music_lobby (break quieter); plan/resolve -> music_battle, or
// music_boss while a boss machine is on the board; won/lost -> fade, then the sting.

const W = 1920;

export async function createTVSound({ audio, ready }) {
  if (!audio.supported) return null;
  const S = { ready: false, phase: null, seen: null, readyFlags: new Map(), lastCeil: null, endTimer: 0, musicKey: '' };
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  const play = (id, o) => {
    if (hidden() || !S.ready) return;
    try {
      audio.play(id, o);
    } catch {
      /* ignore */
    }
  };
  const panAt = (game, x, y, z = 0) => {
    const S2 = game.scene;
    if (!S2) return 0;
    return audio.panForX(S2.p(x, y, z)[0], W);
  };

  // one playback cue or a non-batch event (see Game.cue / Game.event)
  S.cue = (c, game) => {
    if (!S.ready) return;
    const ev = c.ev || {};
    const P = (xy, z) => (xy ? panAt(game, xy[0], xy[1], z) : 0);
    switch (c.kind) {
      case 'throw':
        play('wind', { pan: P(ev.from), gain: 1.3, rate: 0.8 });
        break;
      case 'catch':
        play('ready', { pan: P(ev.at), gain: 0.9 });
        break;
      case 'blocked':
        play('build', { pan: P(ev.to), gain: 0.8, rate: 0.6 });
        break;
      case 'land':
        play('die_small', { pan: P(ev.at), gain: 0.5, rate: 0.7 });
        break;
      case 'bump':
        play('build', { pan: P(ev.from), gain: 0.8, rate: 1.25 });
        break;
      case 'pickup':
        play('gift', { pan: P(ev.at), gain: 0.6 });
        break;
      case 'load':
        play('build', { pan: P(catXY(game, ev.cat)), gain: 0.9 });
        break;
      case 'fizzle':
        play('sell', { pan: P(c.at), gain: 0.6, rate: 0.6 });
        break;
      case 'fire':
        play('shot_mortar', { pan: P(catXY(game, ev.cat)) });
        break;
      case 'impact':
        if (ev.result === 'wasted') play('die_small', { pan: P(c.shot?.to), gain: 0.5, rate: 0.6 });
        else if (ev.kind === 'stopwatch') play('pulse_chrono', { pan: P(c.shot?.to) });
        else if (ev.kind === 'grapeshot') play('chain_tesla', { pan: P(c.shot?.to), gain: 0.5, rate: 0.6 }), play('impact_mortar', { pan: P(c.shot?.to), gain: 0.7 });
        else play('impact_mortar', { pan: P(c.shot?.to) });
        break;
      case 'kill': {
        const boss = game.defs?.machines?.[c.m?.kind]?.boss;
        const id = boss ? 'die_boss' : c.m?.kind === 'brute' ? 'die_big' : 'die_small';
        play(id, { pan: c.m ? P(game.scene?.lanePt(c.m.lane, c.m.pos0)) : 0 });
        break;
      }
      case 'wall':
        play('leak');
        break;
      case 'spawn':
        if (game.defs?.machines?.[ev.kind]?.boss) play('boss_arrive');
        break;
      case 'level_start':
        play('wave_start');
        break;
      case 'level_clear':
        play('wave_clear');
        break;
      case 'step':
        // one music-box tink per step, rising: step 1, 2, 3, 4
        play('ready', { gain: 0.7, rate: 0.85 + 0.15 * (c.slot || 0) });
        break;
      case 'machines':
        play('build', { gain: 0.55, rate: 0.6 });
        break;
    }
  };

  S.onRoom = (room) => {
    const first = S.seen === null;
    if (first) S.seen = new Set();
    for (const p of room.players) {
      if (!S.seen.has(p.id)) {
        S.seen.add(p.id);
        if (!first && room.phase !== 'lobby') play('join');
      }
      if (p.ready && !S.readyFlags.get(p.id) && !first && room.phase === 'break') play('ready');
      S.readyFlags.set(p.id, !!p.ready);
    }
    const prev = S.phase;
    S.phase = room.phase;
    if (room.phase !== prev) {
      S.lastCeil = null;
      clearTimeout(S.endTimer);
      S.endTimer = 0;
      const live = prev && prev !== 'lobby' && prev !== 'won' && prev !== 'lost';
      if (live && (room.phase === 'won' || room.phase === 'lost')) {
        const id = room.phase === 'won' ? 'victory' : 'defeat';
        S.endTimer = setTimeout(() => play(id), 1100);
      }
    }
  };

  // per frame: music and the countdown ticks in the last 3 s of a plan phase
  S.tick = (game, now) => {
    if (!S.ready) return;
    const phase = S.phase;
    let music = null;
    let mg = 1;
    let amb = null;
    if (phase === 'lobby') music = 'music_lobby';
    else if (phase === 'break') {
      music = 'music_lobby';
      mg = 0.55;
      amb = 'amb_town';
    } else if (phase === 'plan' || phase === 'resolve') {
      let boss = false;
      for (const m of game.board?.mach?.values() || []) if (game.defs?.machines?.[m.kind]?.boss) boss = true;
      music = boss ? 'music_boss' : 'music_battle';
      mg = 0.8;
      amb = 'amb_town';
    }
    const key = `${music}|${mg}|${amb}`;
    if (key !== S.musicKey) {
      S.musicKey = key;
      audio.music(music, { fade: 1.5, gain: mg });
      audio.ambience(amb, { fade: 2.5, gain: 1 });
    }
    if (phase === 'plan' && game.snap && !hidden()) {
      const c = Math.ceil(game.left(now));
      if (S.lastCeil !== null && c < S.lastCeil && c >= 1 && c <= 3) play('countdown_tick');
      S.lastCeil = c;
    } else S.lastCeil = null;
  };

  try {
    await ready;
  } catch {
    /* engine swallows its own errors */
  }
  S.ready = true;
  (async () => {
    for (const id of ['music_lobby', 'music_battle', 'music_boss']) await audio.preload(id);
  })();
  S.stop = () => {
    S.ready = false;
    clearTimeout(S.endTimer);
    audio.music(null, { fade: 0.3 });
    audio.ambience(null, { fade: 0.3 });
  };
  return S;
}

function catXY(game, id) {
  const c = game.scene?.catapult(id);
  return c ? [c.x, c.y] : null;
}
