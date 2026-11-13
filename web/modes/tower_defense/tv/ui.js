// DOM side of the tower_defense TV mode: HUD plates, banners, perk announcements and the end
// screen. (The lobby, room code and status badge belong to the shell: web/tv/main.js.)

import { drawEnemyIcon } from './sprites.js';
import { fmtTime } from './geom.js';
import { $, esc, GEAR_SVG } from '/shared/dom.js';

const TICK_SVG = `<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>`;
const CARD_SVG = `<svg class="pkicon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M12 7.5l1.4 3h3.2l-2.6 2 1 3.3-3-2-3 2 1-3.3-2.6-2h3.2z"/></svg>`;

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
    this.perkQueue = [];
    this.perkBusy = false;
  }

  // w: the mode's setup ({ map, defs }).
  setWelcome(w) {
    this.welcome = w;
    $('waveTotal').textContent = `/ ${w.defs.waves}`;
  }

  setRoom(room, game) {
    const prev = this.room;
    this.room = room;
    if (room.nextWave?.length) this.previewByWave.set(room.wave, room.nextWave);
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
    this.updatePaused(room);
  }

  show(which) {
    if (this.screen === which) return;
    this.screen = which;
    if (which === 'end') this.clearBanners(); // the end overlay is translucent
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
        el.innerHTML = `<span class="sw">${GEAR_SVG()}</span><span class="nm"></span><span class="purse">${GEAR_SVG('coin')}<b></b></span><span class="rd">${TICK_SVG}</span><span class="pk" title="Choosing a perk">${CARD_SVG}</span>`;
      }
      el.style.setProperty('--pc', p.color);
      el.classList.toggle('away', !p.connected);
      el.classList.toggle('ready', build && p.ready);
      el.classList.toggle('isHost', p.id === room.host);
      el.classList.toggle('offer', (room.phase === 'build' || room.phase === 'wave') && !!p.offer);
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

  // A perk pick: a small label floating above the player's chip, one at a time.
  perk(ev) {
    this.perkQueue.push(ev);
    if (!this.perkBusy) this.nextPerk();
  }

  nextPerk() {
    const ev = this.perkQueue.shift();
    if (!ev) {
      this.perkBusy = false;
      return;
    }
    this.perkBusy = true;
    const chip = document.querySelector(`#pstrip .chip[data-pid="${ev.pid}"]`);
    const defs = this.welcome?.defs;
    const who = this.room?.players.find((p) => p.id === ev.pid);
    if (chip && this.room?.phase !== 'lobby') {
      const f = document.createElement('div');
      f.className = 'perkfloat';
      const r = chip.getBoundingClientRect();
      if (r.left + r.width / 2 > innerWidth / 2) f.classList.add('right');
      f.innerHTML = `${CARD_SVG}<span><b>${esc(who?.name || '')}</b>: ${esc(defs?.perks?.[ev.id]?.name || ev.id)}</span>`;
      chip.append(f);
      setTimeout(() => f.remove(), 2400);
    }
    setTimeout(() => this.nextPerk(), this.perkQueue.length ? 1300 : 600);
  }

  isBossWave(wave) {
    const defs = this.welcome?.defs;
    return !!(this.previewByWave.get(wave) || []).find((g) => defs?.enemies[g.kind]?.boss);
  }

  waveStart(ev) {
    const defs = this.welcome?.defs;
    const preview = this.previewByWave.get(ev.wave) || [];
    const bossKind = preview.find((g) => defs?.enemies[g.kind]?.boss)?.kind;
    // `by`: the host skipped the rest of the build phase
    const host = ev.by && this.room?.players.find((p) => p.id === ev.by);
    const note = ev.by ? { name: host?.name || 'The host', color: host?.color } : null;
    if (bossKind) this.banner(`Boss wave ${ev.wave}`, `${defs.enemies[bossKind].name} approaches!`, 'boss', note);
    else if (ev.wave === defs?.waves) this.banner(`Final wave`, `Hold the line!`, 'wave', note);
    else this.banner(`Wave ${ev.wave}`, waveSub(preview, defs), 'wave', note);
  }

  waveClear(ev) {
    this.banner(`Wave ${ev.wave} cleared`, ev.bonus ? `+${ev.bonus} cogs each` : '', 'clear');
  }

  // ------------------------------------------------------------ banners

  banner(title, sub, kind, note = null) {
    this.bannerQueue.push({ title, sub, kind, note });
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
    el.innerHTML = `<div class="bt">${esc(b.title)}</div>${b.sub ? `<div class="bs">${esc(b.sub)}</div>` : ''}${
      b.note ? `<div class="bn"><b style="color:${esc(b.note.color || 'inherit')}">${esc(b.note.name)}</b> started the wave</div>` : ''}`;
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
    const perkText = (id) => {
      const m = end.stats[id].perks || {};
      const items = Object.keys(m).filter((k) => m[k] > 0).sort((a, b) => m[b] - m[a]);
      const nm = (k) => `${defs?.perks?.[k]?.name || k}${m[k] > 1 ? ` ×${m[k]}` : ''}`;
      const shown = items.slice(0, 8).map(nm).join(', ');
      return items.length > 8 ? `${shown} +${items.length - 8} more` : shown;
    };
    const ids = Object.keys(end.stats || {});
    ids.sort((a, b) => (end.stats[b].dmg || 0) - (end.stats[a].dmg || 0));
    const best = {};
    for (const [k] of cols) best[k] = Math.max(0, ...ids.map((id) => end.stats[id][k] || 0));
    const rows = ids
      .map((id) => {
        const s = end.stats[id];
        return `<tr style="--pc:${esc(col(id))}"><td class="who">${GEAR_SVG()}${esc(name(id))}</td>${cols
          .map(([k]) => `<td class="${s[k] && s[k] === best[k] ? 'best' : ''}">${Math.round(s[k] || 0).toLocaleString('en-US')}</td>`)
          .join('')}<td class="pk">${esc(perkText(id)) || '–'}</td></tr>`;
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
        <table class="stats"><thead><tr><th>Engineer</th>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th class="pk">Perks</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="ew">${host ? `Waiting for <b style="color:${esc(host.color)}">${esc(host.name)}</b> to start a new game` : 'Waiting for the host'}<span class="dots"></span></div>
      </div>`;
    $('end').classList.toggle('compact', ids.length > 5);
    this.fitAwards();
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
