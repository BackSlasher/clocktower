import { createAudio } from './audio.js';

const audio = createAudio({ base: '/assets/audio/', persist: 'clocktower.soundboard' });
window.audio = audio; // for poking from the console

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};
const kb = (b) => (b / 1024).toFixed(1) + ' kB';
const logEl = $('#log');
const log = (m) => { logEl.textContent = m; };

// ---- volumes -----------------------------------------------------------------------------------
const sliders = ['master', 'music', 'sfx', 'amb'];
function syncSliders() {
  const v = audio.volume;
  for (const k of sliders) { $('#v-' + k).value = v[k]; $('#o-' + k).textContent = Math.round(v[k] * 100) + '%'; }
  $('#mute').classList.toggle('on', audio.muted);
  $('#mute').textContent = audio.muted ? 'Muted' : 'Mute';
}
for (const k of sliders) $('#v-' + k).addEventListener('input', (e) => { audio.setVolume({ [k]: +e.target.value }); syncSliders(); });
$('#mute').addEventListener('click', () => { audio.setMuted(!audio.muted); syncSliders(); });
syncSliders();

// ---- peak meter (reads the node just before the speakers) ----------------------------------------
let peak = 0;
const buf = new Float32Array(8192);
function pollPeak() {
  const an = audio.analyser;
  if (an) {
    an.getFloatTimeDomainData(buf);
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
    window.__peak = peak;
    const d = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    $('#peak').textContent = isFinite(d) ? d.toFixed(1) : '-inf';
    $('#meter').classList.toggle('hot', d > -1);
  }
  $('#lock').classList.toggle('show', audio.supported && audio.locked);
}
setInterval(pollPeak, 40);
$('#peakreset').addEventListener('click', () => { peak = 0; });

// ---- table ---------------------------------------------------------------------------------------
const CATS = [['sfx', 'Sound effects'], ['music', 'Music loops'], ['amb', 'Ambience']];
const GROUPS = {
  Towers: ['shot_rivet', 'shot_mortar', 'impact_mortar', 'chain_tesla', 'pulse_chrono'],
  Enemies: ['die_small', 'die_big', 'die_boss', 'leak', 'boss_arrive'],
  Players: ['build', 'upgrade', 'sell', 'wind', 'gift', 'join', 'ready'],
  'Game flow': ['wave_start', 'wave_clear', 'victory', 'defeat', 'countdown_tick'],
};

function row(id) {
  const m = audio.manifest.sounds[id], info = audio.info(id);
  const isLoop = m.category !== 'sfx';
  const tr = el('tr');
  const play = el('button', { className: 'btn small', textContent: isLoop ? 'Play' : 'Play' });
  const vars = el('span', { className: 'vars' });
  const playOne = (variant) => {
    if (isLoop) { toggleLoop(id); return; }
    audio.unlock();
    const h = audio.play(id, { variant, pan: (Math.random() - .5) * .8 });
    if (!h) log(`${id}: not played (${audio.locked ? 'audio locked' : 'throttled, capped, or not loaded'})`);
  };
  play.addEventListener('click', () => playOne());
  if (!isLoop && m.files.length > 1) m.files.forEach((_, i) => vars.append(el('button', { className: 'btn small', textContent: String(i + 1), title: 'variation ' + (i + 1), onclick: () => playOne(i) })));
  const dur = info && info.durations.length ? info.durations.map((d) => d.toFixed(2)).join(' / ') + ' s' : m.category === 'music' ? '(decodes on play)' : '';
  const syn = /synth/i.test(m.license);
  const throttle = [m.minIntervalMs ? `min ${m.minIntervalMs} ms` : '', m.maxPerSecond ? `${m.maxPerSecond}/s` : '', m.maxVoices ? `${m.maxVoices} voices` : '', m.duck ? 'ducks music' : ''].filter(Boolean).join(', ');
  const srcCell = el('td', { className: 'src' });
  if (/^https?:/.test(m.source)) srcCell.append(el('a', { href: m.source, target: '_blank', rel: 'noopener', textContent: m.source.replace(/^https?:\/\//, '') }));
  else srcCell.textContent = m.source;
  srcCell.append(el('div', { className: 'tag', textContent: m.author }));
  tr.append(
    el('td', {}, play, vars),
    el('td', { className: 'id', textContent: id }),
    el('td', { className: 'num' + (info && info.loaded === false && m.category !== 'music' ? ' missing' : ''), textContent: dur }),
    el('td', { className: 'num', textContent: kb(m.bytes.reduce((a, b) => a + b, 0)) }),
    el('td', { className: 'lic' + (syn ? ' syn' : ''), textContent: syn ? 'CC0, synthesised' : m.license }),
    srcCell,
    el('td', { className: 'proc', textContent: m.processing + (throttle ? ' | ' + throttle : '') }),
  );
  return tr;
}

function table(ids) {
  const t = el('table');
  t.append(el('thead', {}, el('tr', {}, ...['', 'id', 'duration', 'size', 'licence', 'source / author', 'processing | limits'].map((h, i) => el('th', { textContent: h, className: i === 6 ? 'proc' : '' })))));
  const tb = el('tbody'); for (const id of ids) tb.append(row(id)); t.append(tb);
  return t;
}

function render() {
  const main = $('#main'); main.replaceChildren();
  const all = Object.keys(audio.manifest.sounds);
  const total = all.reduce((a, id) => a + audio.manifest.sounds[id].bytes.reduce((x, y) => x + y, 0), 0);
  main.append(el('p', { className: 'tag', textContent: `${all.length} sounds, ${(total / 1048576).toFixed(2)} MB total. Frequent sounds are mastered quietly on purpose; judge them in the stress test, not alone.` }));
  const used = new Set();
  for (const [g, ids] of Object.entries(GROUPS)) {
    const present = ids.filter((i) => audio.manifest.sounds[i]); present.forEach((i) => used.add(i));
    main.append(el('h2', { className: 'display', textContent: g }), table(present));
  }
  for (const [cat, title] of CATS.slice(1)) {
    const ids = all.filter((i) => audio.manifest.sounds[i].category === cat);
    if (ids.length) main.append(el('h2', { className: 'display', textContent: title }), table(ids));
  }
  const rest = all.filter((i) => !used.has(i) && audio.manifest.sounds[i].category === 'sfx');
  if (rest.length) main.append(el('h2', { className: 'display', textContent: 'Other' }), table(rest));
}

// ---- music / ambience ---------------------------------------------------------------------------
function toggleLoop(id) {
  audio.unlock();
  if (audio.manifest.sounds[id].category === 'amb') audio.ambience(audio.currentAmbience === id ? null : id);
  else audio.music(audio.currentMusic === id ? null : id, { fade: 1.5 });
  setTimeout(syncLoops, 100);
}
function syncLoops() {
  document.querySelectorAll('[data-music]').forEach((b) => b.classList.toggle('on', b.dataset.music === (audio.currentMusic || '')));
  $('#amb').classList.toggle('on', !!audio.currentAmbience);
}
document.querySelectorAll('[data-music]').forEach((b) => b.addEventListener('click', () => {
  audio.unlock(); audio.music(b.dataset.music || null, { fade: 1.5 });
  log(b.dataset.music ? 'crossfading to ' + b.dataset.music + ' (decodes on first use)' : 'music faded out');
  setTimeout(syncLoops, 300); setTimeout(syncLoops, 2000);
}));
$('#amb').addEventListener('click', () => { audio.unlock(); audio.ambience(audio.currentAmbience ? null : 'amb_town', { fade: 2 }); setTimeout(syncLoops, 300); });

// ---- stress test: a busy wave -------------------------------------------------------------------
let stressTimer = null;
function stress(seconds = 15) {
  if (stressTimer) return;
  audio.unlock();
  const btn = $('#stress'); btn.classList.add('on');
  peak = 0;
  audio.music('music_battle', { fade: 0.5 });
  const rates = { shot_rivet: 12, wind: 6, die_small: 4, chain_tesla: 2.5, shot_mortar: 0.6, die_big: 0.3, pulse_chrono: 0.4, build: 0.15, sell: 0.1 };
  const started = performance.now(); let last = started; const errors = [];
  const fired = {}; const tally = (id, h) => { fired[id] = fired[id] || [0, 0]; fired[id][h ? 0 : 1]++; };
  stressTimer = setInterval(() => {
    try {
      const t = performance.now(), dt = (t - last) / 1000; last = t;
      for (const [id, r] of Object.entries(rates)) {
        let n = r * dt; let k = Math.floor(n); if (Math.random() < n - k) k++;
        for (let i = 0; i < k; i++) {
          tally(id, audio.play(id, { pan: audio.panForX(Math.random() * 1920, 1920) }));
          if (id === 'shot_mortar') setTimeout(() => tally('impact_mortar', audio.play('impact_mortar', { pan: audio.panForX(Math.random() * 1920, 1920) })), 600);
        }
      }
      const left = seconds - (t - started) / 1000;
      log(`stress test: ${Math.max(0, left).toFixed(0)} s left | played ${audio.stats.played}, throttled ${audio.stats.throttled}, capped ${audio.stats.capped}, voices ${audio.stats.voices}`);
      if (left <= 0) {
        clearInterval(stressTimer); stressTimer = null; btn.classList.remove('on');
        const d = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
        window.__stress = { peakLinear: peak, peakDb: d, stats: audio.stats, errors, fired, done: true };
        log(`stress test done: master peak ${d.toFixed(1)} dBFS | ${JSON.stringify(audio.stats)}`);
      }
    } catch (e) { errors.push(String(e)); }
  }, 20);
  window.__stress = { done: false };
}
$('#stress').addEventListener('click', () => stress(15));
window.runStress = stress;

// ---- go --------------------------------------------------------------------------------------------
(async () => {
  const res = await audio.load();
  window.__loadResult = res;
  if (!audio.manifest) { log('manifest.json failed to load'); return; }
  render();
  window.__decoded = Object.fromEntries(audio.ids().filter((i) => audio.has(i)).map((i) => [i, audio.info(i).durations]));
  log(`${res.loaded.length} effects decoded${res.missing.length ? ', MISSING: ' + res.missing.join(', ') : ''}; ${res.lazy.length} music tracks decode on first play`);
  syncLoops();
})();
