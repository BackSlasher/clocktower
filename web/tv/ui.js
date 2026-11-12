// DOM side of the TV: lobby, HUD plates, banners, end screen, status badge.

import { drawEnemyIcon } from './sprites.js';
import { fmtTime } from './geom.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const GEAR_SVG = (cls = '') =>
  `<svg class="gear ${cls}" viewBox="-12 -12 24 24" aria-hidden="true"><path d="${gearD(11, 8)}"/><circle r="3.2" class="hole"/></svg>`;

function gearD(r, teeth) {
  const inner = r * 0.75;
  const step = (Math.PI * 2) / teeth;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [a - step * 0.3, inner],
      [a - step * 0.16, r],
      [a + step * 0.16, r],
      [a + step * 0.3, inner],
    ];
    for (const [an, rr] of pts) d += `${d ? 'L' : 'M'}${(Math.cos(an) * rr).toFixed(2)} ${(Math.sin(an) * rr).toFixed(2)}`;
  }
  return d + 'Z';
}

const TICK_SVG = `<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>`;
const CROWN_SVG = `<svg class="crown" viewBox="0 0 24 18" aria-hidden="true"><path d="M2 16h20l1-11-6 5-5-8-5 8-6-5z"/></svg>`;

export class UI {
  constructor() {
    this.welcome = null;
    this.room = null;
    this.screen = '';
    this.bannerQueue = [];
    this.bannerBusy = false;
    this.lastPreviewKey = '';
    this.lastStripKey = '';
    this.previewByWave = new Map();
    this.lastCountdown = null;
    this.endTimer = null;
  }

  setWelcome(w) {
    this.welcome = w;
    window.ctRoom = w.room;
    $('code').innerHTML = [...w.room].map((ch) => `<span>${esc(ch)}</span>`).join('');
    $('joinHost').textContent = w.joinHost || location.host;
    $('code2').textContent = w.room;
    const qr = $('qr');
    const src = `/qr.svg?room=${encodeURIComponent(w.room)}`;
    if (qr.getAttribute('src') !== src) qr.src = src;
    $('waveTotal').textContent = `/ ${w.defs.waves}`;
  }

  setRoom(room, game) {
    const prev = this.room;
    this.room = room;
    if (room.nextWave?.length) this.previewByWave.set(room.wave, room.nextWave);
    this.renderLobby(room);
    this.renderStrip(game);
    this.renderPreview(room);
    $('waveN').textContent = this._wave = String(room.wave || 1);

    const phase = room.phase;
    const inGame = phase === 'build' || phase === 'wave';
    if (phase === 'lobby') {
      this.show('lobby');
      this.clearBanners();
      clearTimeout(this.endTimer);
      this.endTimer = null;
    } else if (inGame) {
      this.show('game');
    } else if (phase === 'won' || phase === 'lost') {
      this.renderEnd(room);
      // live transition: let the battlefield breathe a moment first
      const live = prev && (prev.phase === 'wave' || prev.phase === 'build');
      if (live) {
        clearTimeout(this.endTimer);
        this.banner(phase === 'won' ? 'Brasswick stands!' : 'The Clock has stopped', '', phase === 'won' ? 'win' : 'boss');
        this.endTimer = setTimeout(() => {
          this.endTimer = null;
          this.show('end');
        }, 2600);
      } else if (!this.endTimer) this.show('end');
    }
    document.body.dataset.phase = phase;
    this.updatePaused(room);
  }

  show(which) {
    if (this.screen === which) return;
    this.screen = which;
    if (which === 'end') this.clearBanners(); // the end overlay is translucent
    $('lobby').classList.toggle('on', which === 'lobby' || which === 'connecting');
    $('hud').classList.toggle('on', which === 'game');
    $('end').classList.toggle('on', which === 'end');
    if (which === 'end') this.fitAwards();
  }

  // long, wide names: shrink an award's name until it fits (never below 22 px).
  // Needs layout, so it also runs when the end screen is shown.
  fitAwards() {
    for (const an of $('end').querySelectorAll('.award .an')) {
      an.style.fontSize = '';
      for (let fs = 38; an.scrollWidth > an.clientWidth && fs >= 22; fs -= 2) an.style.fontSize = `${fs}px`;
    }
  }

  updatePaused(room) {
    const running = room.phase === 'build' || room.phase === 'wave';
    const anyone = room.players.some((p) => p.connected);
    $('paused').classList.toggle('on', running && !anyone);
  }

  // ------------------------------------------------------------ lobby

  renderLobby(room) {
    const max = this.welcome?.defs.maxPlayers || 8;
    const ps = room.players;
    $('pcount').textContent = `${ps.length} / ${max}`;
    const slots = Math.min(max, Math.max(4, ps.length + 1));
    let html = '';
    this.seenPids ??= new Set();
    for (const p of ps) {
      const fresh = !this.seenPids.has(p.id);
      this.seenPids.add(p.id);
      html += `<li class="pl ${p.connected ? '' : 'away'} ${fresh ? 'new' : ''}" style="--pc:${esc(p.color)}">
        ${GEAR_SVG('spin')}<span class="nm">${esc(p.name)}</span>
        ${p.id === room.host ? `<span class="host">${CROWN_SVG}Host</span>` : ''}
        ${p.connected ? '' : '<span class="aw">away</span>'}</li>`;
    }
    for (let i = ps.length; i < slots; i++) html += `<li class="pl empty"><span class="nm">waiting for an engineer…</span></li>`;
    $('plist').innerHTML = html;
    $('plist').classList.toggle('dense', ps.length > 5);
    const host = ps.find((p) => p.id === room.host);
    $('lobbyStatus').innerHTML = host
      ? `Waiting for <b style="color:${esc(host.color)}">${esc(host.name)}</b> to start the game<span class="dots"></span>`
      : `Waiting for engineers to join<span class="dots"></span>`;
  }

  // ------------------------------------------------------------ HUD

  renderStrip(game) {
    const room = this.room;
    if (!room) return;
    const purses = game?.lastSnap?.purses || {};
    const build = room.phase === 'build';
    const key = JSON.stringify([room.players, room.host, purses, build]);
    if (key === this.lastStripKey) return;
    this.lastStripKey = key;
    const old = new Map([...document.querySelectorAll('#pstrip .chip')].map((el) => [el.dataset.pid, el]));
    const strip = $('pstrip');
    const frag = [];
    for (const p of room.players) {
      let el = old.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'chip';
        el.dataset.pid = p.id;
        el.innerHTML = `<span class="sw">${GEAR_SVG()}</span><span class="nm"></span><span class="purse">${GEAR_SVG('coin')}<b></b></span><span class="rd">${TICK_SVG}</span>`;
      }
      el.style.setProperty('--pc', p.color);
      el.classList.toggle('away', !p.connected);
      el.classList.toggle('ready', build && p.ready);
      el.classList.toggle('isHost', p.id === room.host);
      el.querySelector('.nm').textContent = p.name;
      const v = purses[p.id];
      el.querySelector('.purse b').textContent = v === undefined ? '–' : v;
      frag.push(el);
    }
    strip.replaceChildren(...frag);
    // shrink to fit when many players are in the room
    strip.classList.toggle('many', room.players.length > 5);
    const w = strip.offsetWidth;
    strip.style.transform = `translateX(-50%) scale(${Math.min(1, 1880 / (w || 1))})`;
  }

  renderPreview(room) {
    const defs = this.welcome?.defs;
    if (!defs) return;
    const list = room.phase === 'build' ? room.nextWave || [] : [];
    const key = JSON.stringify(list);
    if (key === this.lastPreviewKey) return;
    this.lastPreviewKey = key;
    const box = $('preview');
    box.replaceChildren();
    let boss = false;
    for (const { kind, n } of list) {
      const def = defs.enemies[kind];
      if (def?.boss) boss = true;
      const item = document.createElement('div');
      item.className = 'pv' + (def?.boss ? ' boss' : '');
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      g.scale(2, 2);
      drawEnemyIcon(g, kind, def, 64);
      const n2 = document.createElement('span');
      n2.textContent = `×${n}`;
      item.title = def?.name || kind;
      item.append(c, n2);
      box.append(item);
    }
    $('wavePlate').classList.toggle('bosswave', boss);
  }

  // Called every frame; cheap (touches the DOM only when text changes).
  tick(game, now) {
    const room = this.room;
    if (!room) return;
    const snap = game.lastSnap;
    let label;
    let value;
    if (room.phase === 'build' && snap) {
      const el = Math.min(0.35, (now - game.snapRecv) / 1000) * game.simRate;
      const left = Math.max(0, (snap.left || 0) - el);
      label = 'Next wave in';
      value = String(Math.ceil(left));
      $('wavePlate').classList.toggle('hurry', left <= 5.0);
    } else if (room.phase === 'wave') {
      label = 'Enemies in town';
      let n = 0;
      for (const e of game.ents.values()) if (!e.gone) n++;
      value = String(n);
      $('wavePlate').classList.remove('hurry');
    } else {
      label = '';
      value = '';
    }
    if (label !== this._lbl) $('phaseLbl').textContent = this._lbl = label;
    if (value !== this._val) $('phaseVal').textContent = this._val = value;
    const wn = String(snap?.wave || room.wave || 1);
    if (wn !== this._wave) $('waveN').textContent = this._wave = wn;
  }

  livesHit() {
    // canvas gauge handles it; nothing in the DOM
  }

  gift(ev) {
    const strip = $('pstrip');
    const to = strip.querySelector(`.chip[data-pid="${ev.to}"]`);
    const from = strip.querySelector(`.chip[data-pid="${ev.from}"]`);
    from?.classList.remove('gave');
    to?.classList.remove('got');
    void strip.offsetWidth;
    from?.classList.add('gave');
    if (to) {
      to.classList.add('got');
      const f = document.createElement('div');
      f.className = 'giftfloat';
      f.innerHTML = `${GEAR_SVG('coin')}+${esc(ev.amount)}`;
      to.append(f);
      setTimeout(() => f.remove(), 1800);
    }
  }

  isBossWave(wave) {
    const defs = this.welcome?.defs;
    return !!(this.previewByWave.get(wave) || []).find((g) => defs?.enemies[g.kind]?.boss);
  }

  waveStart(ev) {
    const defs = this.welcome?.defs;
    const preview = this.previewByWave.get(ev.wave) || [];
    const bossKind = preview.find((g) => defs?.enemies[g.kind]?.boss)?.kind;
    if (bossKind) this.banner(`Boss wave ${ev.wave}`, `${defs.enemies[bossKind].name} approaches!`, 'boss');
    else if (ev.wave === defs?.waves) this.banner(`Final wave`, `Hold the line!`, 'wave');
    else this.banner(`Wave ${ev.wave}`, waveSub(preview, defs), 'wave');
  }

  waveClear(ev) {
    this.banner(`Wave ${ev.wave} cleared`, ev.bonus ? `+${ev.bonus} cogs each` : '', 'clear');
  }

  // ------------------------------------------------------------ banners

  banner(title, sub, kind) {
    this.bannerQueue.push({ title, sub, kind });
    if (!this.bannerBusy) this.nextBanner();
  }

  nextBanner() {
    const b = this.bannerQueue.shift();
    const el = $('banner');
    if (!b) {
      this.bannerBusy = false;
      return;
    }
    this.bannerBusy = true;
    el.className = '';
    el.innerHTML = `<div class="bt">${esc(b.title)}</div>${b.sub ? `<div class="bs">${esc(b.sub)}</div>` : ''}`;
    void el.offsetWidth;
    el.className = `on ${b.kind}`;
    const glow = $('glow');
    glow.className = '';
    if (b.kind === 'boss') {
      void glow.offsetWidth;
      glow.className = 'on';
    }
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      el.className = '';
      this.bannerTimer = setTimeout(() => this.nextBanner(), 350);
    }, 2500);
  }

  clearBanners() {
    this.bannerQueue.length = 0;
    clearTimeout(this.bannerTimer);
    $('banner').className = '';
    $('glow').className = '';
    this.bannerBusy = false;
  }

  // ------------------------------------------------------------ end

  renderEnd(room) {
    const end = room.end;
    const defs = this.welcome?.defs;
    if (!end) return;
    const won = end.won;
    const byId = new Map(room.players.map((p) => [p.id, p]));
    const name = (pid) => byId.get(pid)?.name || pid;
    const col = (pid) => byId.get(pid)?.color || '#d9b25a';
    const total = defs?.waves || 15;
    const sub = won
      ? `All ${total} waves held · ${fmtTime(end.time)}`
      : `Fell on wave ${end.wave} of ${total} · ${fmtTime(end.time)}`;
    const awards = (end.awards || [])
      .map(
        (a) => `<div class="award" style="--pc:${esc(col(a.pid))}">
          <div class="at">${esc(a.title)}</div>
          <div class="an">${esc(name(a.pid))}</div>
          <div class="ad">${esc(a.detail || '')}</div></div>`,
      )
      .join('');
    const cols = [
      ['kills', 'Kills'],
      ['dmg', 'Damage'],
      ['built', 'Built'],
      ['spent', 'Spent'],
      ['winds', 'Winds'],
      ['gifted', 'Gifted'],
    ];
    const ids = Object.keys(end.stats || {});
    ids.sort((a, b) => (end.stats[b].dmg || 0) - (end.stats[a].dmg || 0));
    const best = {};
    for (const [k] of cols) best[k] = Math.max(0, ...ids.map((id) => end.stats[id][k] || 0));
    const rows = ids
      .map((id) => {
        const s = end.stats[id];
        return `<tr style="--pc:${esc(col(id))}"><td class="who">${GEAR_SVG()}${esc(name(id))}</td>${cols
          .map(([k]) => `<td class="${s[k] && s[k] === best[k] ? 'best' : ''}">${Math.round(s[k] || 0).toLocaleString('en-US')}</td>`)
          .join('')}</tr>`;
      })
      .join('');
    const host = byId.get(room.host);
    const key = JSON.stringify([end, room.players.map((p) => [p.id, p.name, p.color]), host?.id]);
    if (key === this._endKey) return;
    this._endKey = key;
    $('end').innerHTML = `
      <div class="endwrap ${won ? 'won' : 'lost'}">
        <h1 class="et">${won ? 'Victory' : 'Defeat'}</h1>
        <div class="es">${esc(sub)}</div>
        ${awards ? `<div class="awards">${awards}</div>` : ''}
        <table class="stats"><thead><tr><th>Engineer</th>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
        <div class="ew">${host ? `Waiting for <b style="color:${esc(host.color)}">${esc(host.name)}</b> to start a new game` : 'Waiting for the host'}<span class="dots"></span></div>
      </div>`;
    $('end').classList.toggle('compact', ids.length > 5);
    this.fitAwards();
  }

  // ------------------------------------------------------------ status

  setStatus(s) {
    const b = $('badge');
    if (s === 'open') b.className = '';
    else if (s === 'replaced') {
      b.textContent = 'This room is now shown on another screen';
      b.className = 'on';
    } else if (s === 'connecting' || s === 'closed') {
      if (this.welcome) {
        b.textContent = 'Reconnecting…';
        b.className = 'on';
      }
    }
  }
}

function plural(name, n) {
  if (n === 1) return name;
  return /(ch|sh|s|x)$/.test(name) ? `${name}es` : `${name}s`;
}

function waveSub(preview, defs) {
  if (!preview.length || !defs) return '';
  return preview
    .slice()
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((g) => `${g.n} ${plural(defs.enemies[g.kind]?.name || g.kind, g.n)}`)
    .join(' · ');
}
