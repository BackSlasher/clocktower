// DOM side of the catapult_coop TV: the top plate (level, round, countdown, wall), the player
// strip, the level title card, banners, the break panel and the end screen. Every element id
// is prefixed "cc" so nothing collides with the shell or another mode.

import { fmtTime } from '../../tower_defense/tv/geom.js';
import { esc, GEAR_SVG, CROWN_SVG } from '/shared/dom.js';
import { drawBomb } from './sprites.js';

const TICK_SVG = `<svg class="cc-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>`;
const DOTS = `<span class="cc-think"><i></i><i></i><i></i></span>`;
const BRICK_SVG = `<svg class="cc-brick" viewBox="0 0 24 20" aria-hidden="true"><path d="M1 1h10v5H1zM13 1h10v5H13zM1 8h5v5H1zM8 8h10v5H8zM20 8h3v5h-3zM1 15h10v4H1zM13 15h10v4H13z"/></svg>`;

export const HTML = `
  <canvas id="ccCv"></canvas>
  <section id="ccHud">
    <div id="ccTop">
      <div class="cc-lvl"><div class="cc-lbl">Level</div><div class="cc-big"><span id="ccLevel">1</span><span class="cc-of" id="ccLevels">/ 6</span></div><div class="cc-sub" id="ccLevelName"></div></div>
      <div class="cc-phase"><div class="cc-lbl" id="ccPhaseLbl"></div><div class="cc-count" id="ccCount"></div><div class="cc-sub" id="ccRound"></div></div>
      <div class="cc-wall"><div class="cc-lbl">${BRICK_SVG} Wall</div><div class="cc-big"><span id="ccWall">10</span><span class="cc-of" id="ccWallMax">/ 10</span></div><div class="cc-bar"><div id="ccWallBar"></div></div></div>
    </div>
    <div id="ccPlayersL" class="cc-players"></div>
    <div id="ccPlayersR" class="cc-players right"></div>
    <div id="ccPaused">Paused &mdash; waiting for engineers to reconnect</div>
  </section>
  <div id="ccCard"></div>
  <div id="ccBanner"></div>
  <section id="ccBreak"></section>
  <section id="ccEnd"></section>`;

export class UI {
  constructor(root) {
    this.root = root;
    this.$ = (id) => root.querySelector(`#${id}`);
    this.setup = null;
    this.room = null;
    this.screen = '';
    this.timers = new Set();
    this.bannerQueue = [];
    this.bannerBusy = false;
    this.breakBase = null; // perks at the start of the break (to tell who picked what)
    this.picks = new Map(); // pid -> perk id picked this break
    this._k = {};
  }

  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  destroy() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  set(id, text) {
    if (this._k[id] === text) return;
    this._k[id] = text;
    this.$(id).textContent = text;
  }

  setSetup(s) {
    this.setup = s;
  }

  get defs() {
    return this.setup?.defs || {};
  }

  setRoom(room) {
    const prev = this.room;
    this.room = room;
    const phase = room.phase;
    this.set('ccLevels', `/ ${room.levels || this.defs.levels?.length || 6}`);
    this.set('ccLevel', String(room.level || 1));
    this.set('ccLevelName', this.defs.levels?.[(room.level || 1) - 1]?.name || '');
    this.set('ccRound', room.level ? `Round ${room.round}` : '');

    if (phase === 'break' && prev?.phase !== 'break') {
      this.breakBase = new Map(room.players.map((p) => [p.id, { ...(p.perks || {}) }]));
      this.picks.clear();
    }
    if (phase !== 'break') this.breakBase = null;
    if (phase === 'lobby') {
      this.show('lobby');
      this.clearBanners();
      this.$('ccCard').className = '';
    } else if (phase === 'won' || phase === 'lost') {
      this.renderEnd(room);
      const live = prev && prev.phase !== 'won' && prev.phase !== 'lost' && prev.phase !== 'lobby';
      if (live) {
        this.banner(phase === 'won' ? 'The keep holds!' : 'The wall has fallen', '', phase === 'won' ? 'win' : 'boss');
        clearTimeout(this.endTimer);
        this.endTimer = this.later(() => {
          this.endTimer = null;
          this.show('end');
        }, 2800);
      } else if (!this.endTimer) this.show('end');
    } else this.show(phase === 'break' ? 'break' : 'game');
    this.renderPlayers(room);
    if (phase === 'break') this.renderBreak(room);
    const running = phase !== 'lobby' && phase !== 'won' && phase !== 'lost';
    this.$('ccPaused').classList.toggle('on', running && !room.players.some((p) => p.connected));
  }

  show(which) {
    if (this.screen === which) return;
    this.screen = which;
    this.$('ccHud').classList.toggle('on', which === 'game' || which === 'break');
    this.$('ccBreak').classList.toggle('on', which === 'break');
    this.$('ccEnd').classList.toggle('on', which === 'end');
    if (which === 'end') {
      this.clearBanners();
      this.fitAwards();
    }
  }

  // ------------------------------------------------------------ players

  renderPlayers(room) {
    const phase = room.phase;
    const key = JSON.stringify([room.players.map((p) => [p.id, p.name, p.color, p.connected, p.away, p.planned, p.ready, !!p.offer]), room.host, phase]);
    if (key === this._pk) return;
    this._pk = key;
    const L = this.$('ccPlayersL');
    const R = this.$('ccPlayersR');
    const old = new Map([...this.root.querySelectorAll('.cc-chip')].map((el) => [el.dataset.pid, el]));
    const els = [];
    for (const p of room.players) {
      let el = old.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'cc-chip';
        el.dataset.pid = p.id;
        el.innerHTML = `<span class="cc-sw">${GEAR_SVG()}</span><span class="cc-nm"></span><span class="cc-host">${CROWN_SVG}</span><span class="cc-st"></span>`;
      }
      el.style.setProperty('--pc', p.color);
      el.querySelector('.cc-nm').textContent = p.name;
      el.classList.toggle('away', !!p.away);
      el.classList.toggle('isHost', p.id === room.host);
      let st = '';
      let done = false;
      if (phase === 'plan') {
        done = p.planned;
        st = p.planned ? TICK_SVG : p.away ? '' : DOTS;
      } else if (phase === 'break') {
        done = p.ready;
        st = p.ready ? TICK_SVG : p.away ? '' : DOTS;
      }
      el.classList.toggle('done', done);
      const stEl = el.querySelector('.cc-st');
      if (stEl.dataset.k !== st) {
        stEl.dataset.k = st;
        stEl.innerHTML = st;
      }
      els.push(el);
    }
    const split = els.length > 4 ? Math.ceil(els.length / 2) : els.length;
    L.replaceChildren(...els.slice(0, split));
    R.replaceChildren(...els.slice(split));
  }

  // ------------------------------------------------------------ per frame

  tick(game, now) {
    const room = this.room;
    if (!room) return;
    const phase = room.phase;
    const left = game.left(now);
    let lbl = '';
    let val = '';
    let hurry = false;
    if (phase === 'plan') {
      const n = room.players.filter((p) => !p.away && p.planned).length;
      const of = room.players.filter((p) => !p.away).length;
      lbl = `Plans in: ${n} of ${of}`;
      val = String(Math.ceil(left));
      hurry = left <= 3.0;
    } else if (phase === 'resolve') {
      lbl = 'Watch the keep!';
      val = '';
    } else if (phase === 'break') {
      lbl = 'Next level in';
      val = String(Math.ceil(left));
      if (this.screen === 'break') this.set('ccBreakCount', val);
    }
    this.set('ccPhaseLbl', lbl);
    this.set('ccCount', val);
    const top = this.$('ccTop');
    if (top.classList.contains('hurry') !== hurry) top.classList.toggle('hurry', hurry);
    if (top.dataset.ph !== phase) top.dataset.ph = phase;
    const wall = game.wallNow ?? game.board?.wall;
    const max = game.board?.wallMax || this.defs.wallHP || 10;
    if (wall !== null && wall !== undefined) {
      this.set('ccWall', String(Math.max(0, wall)));
      this.set('ccWallMax', `/ ${max}`);
      const pct = `${Math.max(0, Math.min(1, wall / max)) * 100}%`;
      if (this._k.bar !== pct) {
        this._k.bar = pct;
        this.$('ccWallBar').style.width = pct;
        this.$('ccTop').classList.toggle('low', wall / max <= 0.3);
      }
    }
  }

  wallHit() {
    const el = this.$('ccTop');
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  resolveStart() {}

  // ------------------------------------------------------------ cards and banners

  levelStart(ev) {
    const defs = this.defs;
    const total = this.room?.levels || defs.levels?.length || 6;
    const ld = defs.levels?.[ev.level - 1];
    const el = this.$('ccCard');
    const boss = ev.level === total;
    el.innerHTML = `<div class="cc-cl">Level ${esc(ev.level)} of ${esc(total)}</div><div class="cc-ct">${esc(ev.name || ld?.name || '')}</div>${ld?.desc ? `<div class="cc-cd">${esc(ld.desc)}</div>` : ''}${bombRow(ld, defs)}`;
    el.className = '';
    void el.offsetWidth;
    el.className = `on${boss ? ' boss' : ''}`;
    for (const c of el.querySelectorAll('canvas[data-kind]')) paintBomb(c);
    clearTimeout(this.cardTimer);
    this.cardTimer = this.later(() => (el.className = ''), 3200);
  }

  levelClear(ev) {
    const total = this.room?.levels || this.defs.levels?.length || 6;
    if (ev.level >= total) return; // the end screen says it
    this.banner(`Level ${ev.level} cleared`, `Wall ${ev.wall} / ${this.defs.wallHP || ''}`.replace(/ \/ $/, ''), 'clear');
  }

  bossArrives(ev) {
    const nm = this.defs.machines?.[ev.kind]?.name || 'The boss';
    this.banner(`${nm} approaches!`, '', 'boss');
  }

  perk(ev) {
    this.picks.set(ev.pid, ev.id);
    if (this.room?.phase === 'break') this.renderBreak(this.room, ev.pid);
  }

  banner(title, sub, kind) {
    this.bannerQueue.push({ title, sub, kind });
    if (!this.bannerBusy) this.nextBanner();
  }

  nextBanner() {
    const b = this.bannerQueue.shift();
    const el = this.$('ccBanner');
    if (!b) {
      this.bannerBusy = false;
      return;
    }
    this.bannerBusy = true;
    el.className = '';
    el.innerHTML = `<div class="cc-bt">${esc(b.title)}</div>${b.sub ? `<div class="cc-bs">${esc(b.sub)}</div>` : ''}`;
    void el.offsetWidth;
    el.className = `on ${b.kind}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = this.later(() => {
      el.className = '';
      this.bannerTimer = this.later(() => this.nextBanner(), 350);
    }, 2400);
  }

  clearBanners() {
    this.bannerQueue.length = 0;
    clearTimeout(this.bannerTimer);
    this.$('ccBanner').className = '';
    this.bannerBusy = false;
  }

  // ------------------------------------------------------------ break

  renderBreak(room, flash) {
    const defs = this.defs;
    const total = room.levels || defs.levels?.length || 6;
    const next = defs.levels?.[room.level]; // levels are 1-based; the next one is index room.level
    const pname = (id) => defs.perks?.[id]?.name || id;
    const rows = room.players
      .map((p) => {
        let pick = this.picks.get(p.id);
        if (!pick && this.breakBase) {
          const base = this.breakBase.get(p.id) || {};
          for (const [id, n] of Object.entries(p.perks || {})) if (n > (base[id] || 0)) pick = id;
        }
        let what;
        if (pick) what = `<span class="cc-pick">${esc(pname(pick))}</span><span class="cc-pd">${esc(defs.perks?.[pick]?.desc || '')}</span>`;
        else if (p.offer?.length) what = `<span class="cc-choosing">choosing: ${p.offer.map((id) => esc(pname(id))).join(' · ')}</span>`;
        else what = `<span class="cc-choosing">${p.away ? 'away' : 'no perk this time'}</span>`;
        return `<div class="cc-brow${p.away ? ' away' : ''}${flash === p.id ? ' flash' : ''}" style="--pc:${esc(p.color)}"><span class="cc-bn">${GEAR_SVG()}${esc(p.name)}</span><span class="cc-bw">${what}</span><span class="cc-br">${p.ready ? TICK_SVG : ''}</span></div>`;
      })
      .join('');
    const key = JSON.stringify([rows, room.level]);
    if (key === this._bk && !flash) return;
    this._bk = key;
    this._k.ccBreakCount = undefined;
    this.$('ccBreak').innerHTML = `
      <div class="cc-bwrap">
        <div class="cc-bh">Level ${esc(room.level)} cleared</div>
        <div class="cc-bsub">Pick a perk on your phone, then press Ready</div>
        <div class="cc-brows">${rows}</div>
        ${next ? `<div class="cc-next"><span class="cc-nl">Next: Level ${esc(room.level + 1)} of ${esc(total)}</span> <b>${esc(next.name)}</b><div class="cc-nd">${esc(next.desc || '')}</div>${bombRow(next, defs)}</div>` : ''}
        <div class="cc-bc">Next level in <b id="ccBreakCount"></b></div>
      </div>`;
    for (const c of this.$('ccBreak').querySelectorAll('canvas[data-kind]')) paintBomb(c);
  }

  // ------------------------------------------------------------ end

  fitAwards() {
    for (const an of this.root.querySelectorAll('#ccEnd .cc-award .an')) {
      an.style.fontSize = '';
      for (let fs = 38; an.scrollWidth > an.clientWidth && fs >= 22; fs -= 2) an.style.fontSize = `${fs}px`;
    }
  }

  renderEnd(room) {
    const end = room.end;
    const defs = this.defs;
    if (!end) return;
    const won = end.won;
    const byId = new Map(room.players.map((p) => [p.id, p]));
    const name = (pid) => byId.get(pid)?.name || pid;
    const col = (pid) => byId.get(pid)?.color || '#d9b25a';
    const total = room.levels || defs.levels?.length || 6;
    const sub = won
      ? `All ${total} levels held · ${end.rounds} rounds · wall ${end.wall} / ${defs.wallHP || ''} · ${fmtTime(end.time)}`
      : `The wall fell on level ${end.level} of ${total} · ${end.rounds} rounds · ${fmtTime(end.time)}`;
    const awards = (end.awards || [])
      .map((a) => `<div class="cc-award" style="--pc:${esc(col(a.pid))}"><div class="at">${esc(a.title)}</div><div class="an">${esc(name(a.pid))}</div><div class="ad">${esc(a.detail || '')}</div></div>`)
      .join('');
    const cols = [
      ['kills', 'Kills'],
      ['dmg', 'Damage'],
      ['fires', 'Fires'],
      ['loads', 'Loads'],
      ['throws', 'Throws'],
      ['catches', 'Catches'],
      ['pickups', 'Pick-ups'],
      ['steps', 'Steps'],
      ['bumps', 'Bumps'],
    ];
    const ids = Object.keys(end.stats || {});
    ids.sort((a, b) => (end.stats[b].kills || 0) - (end.stats[a].kills || 0) || (end.stats[b].dmg || 0) - (end.stats[a].dmg || 0));
    const best = {};
    for (const [k] of cols) best[k] = Math.max(0, ...ids.map((id) => end.stats[id][k] || 0));
    const perkText = (id) => {
      const m = end.stats[id].perks || {};
      return Object.keys(m)
        .filter((k) => m[k] > 0)
        .map((k) => `${defs.perks?.[k]?.name || k}${m[k] > 1 ? ` ×${m[k]}` : ''}`)
        .join(', ');
    };
    const rows = ids
      .map((id) => {
        const s = end.stats[id];
        return `<tr style="--pc:${esc(col(id))}"><td class="who">${GEAR_SVG()}${esc(name(id))}</td>${cols
          .map(([k]) => `<td class="${k === 'bumps' ? '' : s[k] && s[k] === best[k] ? 'best' : ''}">${Math.round(s[k] || 0)}</td>`)
          .join('')}<td class="pk">${esc(perkText(id)) || '–'}</td></tr>`;
      })
      .join('');
    const host = byId.get(room.host);
    const key = JSON.stringify([end, room.players.map((p) => [p.id, p.name, p.color]), host?.id]);
    if (key === this._endKey) return;
    this._endKey = key;
    const el = this.$('ccEnd');
    el.innerHTML = `
      <div class="cc-endwrap ${won ? 'won' : 'lost'}">
        <h1 class="cc-et">${won ? 'Victory' : 'Defeat'}</h1>
        <div class="cc-es">${esc(sub.replace(/ \/ ·/, ' ·'))}</div>
        ${awards ? `<div class="cc-awards">${awards}</div>` : ''}
        <table class="cc-stats"><thead><tr><th>Engineer</th>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th class="pk">Perks</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="cc-ew">${host ? `Waiting for <b style="color:${esc(host.color)}">${esc(host.name)}</b> to start a new game` : 'Waiting for the host'}<span class="cc-dots"></span></div>
      </div>`;
    el.classList.toggle('compact', ids.length > 5);
    this.fitAwards();
  }
}

// a row of the bomb kinds a level brings
function bombRow(ld, defs) {
  if (!ld?.bombs) return '';
  const order = defs?.bombOrder || Object.keys(ld.bombs);
  const kinds = order.filter((k) => ld.bombs[k] > 0);
  return `<div class="cc-bombs">${kinds.map((k) => `<span class="cc-bk"><canvas width="96" height="96" data-kind="${esc(k)}"></canvas><span>${esc(defs?.bombs?.[k]?.name || k)}</span></span>`).join('')}</div>`;
}

function paintBomb(c) {
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  drawBomb(g, c.dataset.kind, c.width / 2, c.height * 0.84, c.width / 52, 0.4);
}
