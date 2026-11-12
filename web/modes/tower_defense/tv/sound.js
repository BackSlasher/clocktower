// TV sound: maps game events, phase changes and room changes onto the audio engine.
// Created by mode.js; everything here degrades silently (no throw into the game).
//
// Music policy: lobby -> music_lobby; build -> music_lobby at reduced volume (same track, so
// no restless switching every build phase); wave -> music_battle; boss wave -> music_boss;
// won/lost -> fade out, then the victory/defeat sting. amb_town is a quiet bed in build/wave.

const MAP_W = 1920;
const BUILD_GAIN = 0.55;

// The audio engine, volume/mute keys and the "sound is off" hint are the shell's (web/tv/main.js);
// this file only maps the game onto them. `audio` is ctx.audio, `ready` is ctx.audioReady.
export async function createTVSound({ audio, ready, ui }) {
  if (!audio.supported) return null;

  // ---- state ---------------------------------------------------------------------------
  const S = {
    audio,
    ui,
    game: null,
    ready: false,
    roomCode: null,
    phase: null, // last room phase seen
    seen: null, // Set of pids (null until the first room list is seen)
    ready_: new Map(), // pid -> ready flag
    bossWave: false,
    lastCeil: null,
    pulses: new Map(), // plot -> last chrono pulse (ms)
    shots: [], // recent shot times for gain scaling
    endTimer: 0,
    musicKey: '',
  };

  const hidden = () => typeof document !== 'undefined' && document.hidden;
  const play = (id, o) => {
    if (hidden()) return;
    try {
      audio.play(id, o);
    } catch {
      /* ignore */
    }
  };
  const pan = (x) => audio.panForX(x, MAP_W);

  S.play = play;

  // ---- events (called from Game.event, already in step with the visuals) -----------------
  S.event = (ev, game) => {
    if (!S.ready) return;
    const plot = ev.plot !== undefined ? game.plots.get(ev.plot) : null;
    const px = plot ? pan(plot.x) : 0;
    switch (ev.e) {
      case 'shot': {
        const tw = game.towers.get(ev.plot);
        const kind = ev.kind || tw?.kind;
        const t = performance.now();
        while (S.shots.length && t - S.shots[0] > 300) S.shots.shift();
        S.shots.push(t);
        const g = Math.max(0.4, 1 - 0.035 * (S.shots.length - 1));
        const splash = game.towerLevel(kind, tw?.lvl).splash;
        if (kind === 'mortar' || splash) play('shot_mortar', { pan: px, gain: g });
        else play('shot_rivet', { pan: px, gain: g * 0.9 });
        break;
      }
      case 'chain':
        play('chain_tesla', { pan: pan(plot ? plot.x : ev.pts?.[0]?.[0]) });
        break;
      case 'die': {
        const def = game.defs.enemies[ev.kind] || {};
        const id = def.boss ? 'die_boss' : ev.kind === 'brute' ? 'die_big' : 'die_small';
        play(id, { pan: pan(ev.x) });
        break;
      }
      case 'leak':
        play('leak');
        break;
      case 'build':
      case 'upgrade':
      case 'sell':
      case 'wind':
        play(ev.e, { pan: px });
        break;
      case 'gift':
        play('gift');
        break;
      case 'perk':
        play('upgrade', { gain: 0.8 });
        break;
      case 'wave_start':
        play('wave_start');
        if (ui.isBossWave?.(ev.wave)) {
          S.bossWave = true;
          play('boss_arrive');
        }
        break;
      case 'wave_clear':
        play('wave_clear');
        break;
    }
  };
  S.impact = (x) => {
    if (S.ready) play('impact_mortar', { pan: pan(x), gain: 0.9 });
  };

  // ---- welcome / room -------------------------------------------------------------------
  S.onWelcome = (w) => {
    if (S.roomCode !== null && S.roomCode !== w.room) {
      S.seen = null;
      S.ready_.clear();
      S.phase = null;
    }
    S.roomCode = w.room;
  };

  S.onRoom = (room) => {
    const first = S.seen === null;
    if (first) S.seen = new Set();
    for (const p of room.players) {
      if (!S.seen.has(p.id)) {
        S.seen.add(p.id);
        if (!first && S.ready && (room.phase === 'lobby' || room.phase === 'build')) play('join');
      }
      if (p.ready && !S.ready_.get(p.id) && !first && room.phase === 'build') play('ready');
      S.ready_.set(p.id, !!p.ready);
    }
    const prev = S.phase;
    S.phase = room.phase;
    if (room.phase !== prev) {
      S.bossWave = false;
      S.lastCeil = null;
      clearTimeout(S.endTimer);
      S.endTimer = 0;
      const live = prev === 'wave' || prev === 'build';
      if (live && (room.phase === 'won' || room.phase === 'lost') && S.ready) {
        const id = room.phase === 'won' ? 'victory' : 'defeat';
        S.endTimer = setTimeout(() => play(id), 1100);
      }
    }
  };

  // ---- per-frame: music, countdown, chrono pulse -----------------------------------
  S.tick = (game, now) => {
    if (!S.ready) return;
    const phase = S.phase;
    // music + ambience target
    let music = null;
    let mg = 1;
    let amb = null;
    if (phase === 'lobby') music = 'music_lobby';
    else if (phase === 'build') {
      music = 'music_lobby';
      mg = BUILD_GAIN;
      amb = 'amb_town';
    } else if (phase === 'wave') {
      if (game.boss || ui.isBossWave?.(ui.room?.wave)) S.bossWave = true;
      music = S.bossWave ? 'music_boss' : 'music_battle';
      amb = 'amb_town';
    }
    const key = `${music}|${mg}|${amb}`;
    if (key !== S.musicKey) {
      const was = S.musicKey;
      S.musicKey = key;
      audio.music(music, { fade: 1.5, gain: mg });
      audio.ambience(amb, { fade: 2.5, gain: 1 });
      void was;
    }

    // countdown ticks, last 5 s of the build phase
    const snap = game.lastSnap;
    if (phase === 'build' && snap && !hidden()) {
      const el = Math.min(0.35, (now - game.snapRecv) / 1000) * game.simRate;
      const c = Math.ceil(Math.max(0, (snap.left || 0) - el));
      if (S.lastCeil !== null && c < S.lastCeil && c >= 1 && c <= 5) play('countdown_tick');
      S.lastCeil = c;
    }

    // Chrono Pendulum: no event, so pulse while an enemy is inside its field
    if (phase === 'wave' && !hidden()) {
      for (const s of game.towers.values()) {
        if (game.defs.towers[s.kind]?.wind !== 'range') continue;
        if (now - (S.pulses.get(s.plot) || 0) < 2000) continue;
        const r = (game.towerLevel(s.kind, s.lvl).range || 150) * (1 + (game.defs.windRangeBonus || 0) * s.ten1);
        let near = false;
        for (const e of game.ents.values()) {
          if (e.gone) continue;
          const dx = e.x - s.x;
          const dy = e.y - s.y;
          if (dx * dx + dy * dy < r * r) {
            near = true;
            break;
          }
        }
        if (near) {
          S.pulses.set(s.plot, now);
          play('pulse_chrono', { pan: pan(s.x), gain: 0.5 });
        }
      }
    }
  };

  // ---- go ---------------------------------------------------------------------------------
  try {
    await ready;
  } catch {
    /* engine swallows its own errors */
  }
  S.ready = true;
  // decode music in the background, lobby first, so phase switches are instant
  (async () => {
    for (const id of ['music_lobby', 'music_battle', 'music_boss']) await audio.preload(id);
  })();
  // unmount: silence this mode's music and ambience
  S.stop = () => {
    S.ready = false;
    clearTimeout(S.endTimer);
    audio.music(null, { fade: 0.3 });
    audio.ambience(null, { fade: 0.3 });
  };
  return S;
}
