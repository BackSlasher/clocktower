// TV sound: maps game events, phase changes and room changes onto the audio engine.
// Loaded lazily by main.js; everything here degrades silently (no throw into the game).
//
// Music policy: lobby -> music_lobby; build -> music_lobby at reduced volume (same track, so
// no restless switching every build phase); wave -> music_battle; boss wave -> music_boss;
// won/lost -> fade out, then the victory/defeat sting. amb_town is a quiet bed in build/wave.

import { createAudio } from './audio.js';

const KEY = 'ct.tv.audio';
const MAP_W = 1920;
const BUILD_GAIN = 0.55;

const readSaved = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null') || {};
  } catch {
    return {};
  }
};
const writeSaved = (o) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
};

export async function createTVSound({ stage, ui }) {
  const audio = createAudio({ base: '/assets/audio/', log: () => {} });
  if (!audio.supported) return null;

  // ---- volume / mute state -------------------------------------------------------------
  const q = new URLSearchParams(location.search);
  const saved = readSaved();
  let master = typeof saved.master === 'number' ? saved.master : 0.8;
  let muted = !!saved.muted;
  if (q.has('vol') && isFinite(parseFloat(q.get('vol')))) master = parseFloat(q.get('vol'));
  if (q.get('mute') === '1') muted = true;
  master = Math.min(1, Math.max(0, master));
  const apply = () => {
    audio.setVolume({ master });
    audio.setMuted(muted);
  };
  apply();

  // ---- on-screen bits ------------------------------------------------------------------
  const hint = document.createElement('div');
  hint.id = 'soundhint';
  hint.textContent = 'Sound is off — press any key or click to enable';
  const vol = document.createElement('div');
  vol.id = 'voltoast';
  stage.append(hint, vol);
  let volTimer = 0;
  const showVol = () => {
    vol.textContent = muted ? 'Sound muted' : `Volume ${Math.round(master * 100)}%`;
    vol.classList.add('on');
    clearTimeout(volTimer);
    volTimer = setTimeout(() => vol.classList.remove('on'), 1400);
  };
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const k = e.key;
    let used = true;
    if (k === 'm' || k === 'M') muted = !muted;
    else if (k === ']' || k === '=' || k === '+') {
      master = Math.min(1, Math.round((master + 0.1) * 10) / 10);
      muted = false;
    } else if (k === '[' || k === '-' || k === '_') master = Math.max(0, Math.round((master - 0.1) * 10) / 10);
    else used = false;
    if (!used) return;
    apply();
    writeSaved({ master, muted });
    showVol();
  });

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
    hintOn: null,
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

  // ---- per-frame: music, countdown, chrono pulse, hint -----------------------------------
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

    // unlock hint
    const want = audio.locked && !muted;
    if (want !== S.hintOn) {
      S.hintOn = want;
      hint.classList.toggle('on', want);
    }
  };

  // ---- go ---------------------------------------------------------------------------------
  try {
    await audio.load();
  } catch {
    /* engine swallows its own errors */
  }
  S.ready = true;
  // decode music in the background, lobby first, so phase switches are instant
  (async () => {
    for (const id of ['music_lobby', 'music_battle', 'music_boss']) await audio.preload(id);
  })();
  return S;
}
