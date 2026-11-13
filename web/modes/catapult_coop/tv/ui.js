// DOM side of the catapult_coop TV: the top plate (level, turn, countdown, wall), the queue
// strip (every player's live queue, the slot being played and what came of each action), the
// step indicator, the level title card, banners, the break panel and the end screen. Every
// element id is prefixed "cc" so nothing collides with the shell or another mode.

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
    <div id="ccStep"></div>
    <div id="ccQueue"></div>
    <div id="ccPaused">Paused &mdash; waiting for engineers to reconnect</div>
  </section>
  <div id="ccCard"></div>
  <div id="ccBanner"></div>
  <section id="ccBreak"></section>
  <section id="ccEnd"></section>`;

// ---------------------------------------------------------------- action icons
// Directions are drawn the way the TV shows the grid: +x runs down-right, +y down-left.

function screenAngle(dx, dy) {
  return (Math.atan2((dx + dy) * 0.5, dx - dy) * 180) / Math.PI;
}

function arrow(dx, dy, { len = 34, w = 11, head = 17, dash = false, cls = 'ar' } = {}) {
  const a = screenAngle(dx, dy);
  return `<g transform="rotate(${a.toFixed(1)})" class="${cls}"><path d="M${-len} 0H${len - head + 2}" stroke-width="${w}" fill="none"${dash ? ` stroke-dasharray="9 7"` : ''}/><path d="M${len - head - 2} ${-head}L${len + 4} 0L${len - head - 2} ${head}Z" stroke-width="3"/></g>`;
}

const BOMB_G = (x, y, r = 14) =>
  `<g class="bm"><circle cx="${x}" cy="${y}" r="${r}"/><path d="M${x + r * 0.5} ${y - r * 0.85}q${r * 0.4} ${-r * 0.6} ${r * 0.9} ${-r * 0.5}" fill="none" stroke-width="3"/><circle class="sp" cx="${x + r * 1.45}" cy="${y - r * 1.35}" r="${r * 0.32}"/></g>`;

const HAND_G = `<g class="hd"><path d="M-17 -2q0 22 17 22t17-22" fill="none" stroke-width="7"/><path d="M-12 -2v-20M-3 -2v-24M6 -2v-22M17 -2l5-10" fill="none" stroke-width="6"/></g>`;

export function actIcon(act) {
  const d = (act.dx || 0) !== 0 || (act.dy || 0) !== 0;
  let body = '';
  switch (act.a) {
    case 'move':
      body = arrow(act.dx || 0, act.dy || 0, { len: 36, w: 13, head: 19 });
      break;
    case 'throw': {
      const a = (screenAngle(act.dx || 0, act.dy || 0) * Math.PI) / 180;
      body = `${arrow(act.dx || 0, act.dy || 0, { len: 38, w: 8, head: 16, dash: true, cls: 'ar thr' })}${BOMB_G(-Math.cos(a) * 18, -Math.sin(a) * 18 + 2, 13)}`;
      break;
    }
    case 'pickup':
      body = d ? `<g transform="translate(-8 4) scale(0.8)">${HAND_G}</g>${arrowSmall(act.dx, act.dy)}` : HAND_G;
      break;
    case 'load':
      body = `<g class="ld"><path d="M0 -36V2M-14 -12L0 2L14 -12" fill="none" stroke-width="8"/><path d="M-26 10l6 22h40l6-22" fill="none" stroke-width="7"/></g>`;
      break;
    case 'fire': {
      let pts = '';
      for (let i = 0; i < 16; i++) {
        const an = (i / 16) * Math.PI * 2;
        const r = i % 2 ? 14 : 34;
        pts += `${(Math.cos(an) * r).toFixed(1)},${(Math.sin(an) * r).toFixed(1)} `;
      }
      body = `<g class="fi"><polygon points="${pts}"/><circle r="9"/></g>`;
      break;
    }
    case 'wait':
    default:
      body = `<g class="wt"><path d="M-17 -28h34L-17 28h34Z" fill="none" stroke-width="6" stroke-linejoin="round"/><path d="M-8 22h16l-8-9z"/></g>`;
  }
  return `<svg class="cc-ic" viewBox="-50 -50 100 100" aria-hidden="true">${body}</svg>`;
}

function arrowSmall(dx, dy) {
  const a = screenAngle(dx, dy);
  return `<g transform="rotate(${a.toFixed(1)})" class="ar"><path d="M18 0H34" stroke-width="7" fill="none"/><path d="M30 -11L44 0L30 11Z" stroke-width="2"/></g>`;
}

// ---------------------------------------------------------------- UI

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
    const el = this.$(id);
    if (el) el.textContent = text;
  }

  setSetup(s) {
    this.setup = s;
  }

  get defs() {
    return this.setup?.defs || {};
  }

  get slots() {
    return this.defs.slots || 4;
  }

  setRoom(room) {
    const prev = this.room;
    this.room = room;
    const phase = room.phase;
    this.set('ccLevels', `/ ${room.levels || this.defs.levels?.length || 6}`);
    this.set('ccLevel', String(room.level || 1));
    this.set('ccLevelName', this.defs.levels?.[(room.level || 1) - 1]?.name || '');
    this.set('ccRound', room.level ? `Turn ${room.round}` : '');
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

  // ------------------------------------------------------------ queue strip

  // st = { plans: Map pid -> {acts, done}, cur: slot index | -1, machines, marks: Map "pid|slot" -> mark, resolving }
  renderQueue(st) {
    const room = this.room;
    const n = this.slots;
    const plansKey = [];
    for (const p of room.players) {
      const pl = st.plans.get(p.id);
      plansKey.push([p.id, p.name, p.color, p.away, p.id === room.host, pl?.acts || [], !!pl?.done]);
    }
    const marks = [];
    for (const [k, m] of st.marks) marks.push([k, m.kind, m.text]);
    const key = JSON.stringify([plansKey, st.cur, st.machines, marks, st.resolving, n]);
    if (key === this._qk) return;
    this._qk = key;
    const box = this.$('ccQueue');
    const old = new Map([...box.children].map((el) => [el.dataset.pid, el]));
    const els = [];
    for (const p of room.players) {
      let el = old.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'cc-q';
        el.dataset.pid = p.id;
        el.innerHTML = `<div class="cc-qh"><span class="cc-sw">${GEAR_SVG()}</span><span class="cc-nm"></span><span class="cc-host">${CROWN_SVG}</span><span class="cc-qst"></span></div><div class="cc-qs"></div>`;
      }
      const pl = st.plans.get(p.id) || { acts: [], done: false };
      el.style.setProperty('--pc', p.color);
      el.querySelector('.cc-nm').textContent = p.name;
      el.classList.toggle('away', !!p.away);
      el.classList.toggle('isHost', p.id === room.host);
      el.classList.toggle('done', !!pl.done && !st.resolving);
      const stHtml = st.resolving ? '' : pl.done ? `<span class="cc-done">${TICK_SVG}Done</span>` : p.away ? '<span class="cc-aw">away</span>' : DOTS;
      const stEl = el.querySelector('.cc-qst');
      if (stEl.dataset.k !== stHtml) {
        stEl.dataset.k = stHtml;
        stEl.innerHTML = stHtml;
      }
      let slots = '';
      for (let i = 0; i < n; i++) {
        const act = pl.acts?.[i];
        const m = st.marks.get(`${p.id}|${i}`);
        const cls = ['cc-slot'];
        if (act) cls.push('filled');
        if (st.cur === i) cls.push('cur');
        else if (st.resolving && (st.machines || (st.cur >= 0 && i < st.cur))) cls.push('past');
        if (m) cls.push(`mk-${m.kind}`);
        const mk = m ? `<span class="cc-mk">${m.kind === 'ok' ? '✓' : m.kind === 'fizzle' ? '✗' : '!'}</span>${m.text ? `<span class="cc-mt">${esc(m.text)}</span>` : ''}` : '';
        slots += `<div class="${cls.join(' ')}"><span class="cc-sn">${i + 1}</span>${act ? actIcon(act) : ''}${mk}</div>`;
      }
      const qs = el.querySelector('.cc-qs');
      if (qs.dataset.k !== slots) {
        qs.dataset.k = slots;
        qs.innerHTML = slots;
      }
      els.push(el);
    }
    box.replaceChildren(...els);
    box.style.setProperty('--cols', String(Math.max(1, els.length))); // one row: at most 4 players
  }

  // ------------------------------------------------------------ per frame

  tick(game, now) {
    const room = this.room;
    if (!room) return;
    const phase = room.phase;
    const snap = game.snap;
    const left = game.left(now);
    let lbl = '';
    let val = '';
    let hurry = false;
    const present = room.players.filter((p) => !p.away && p.connected);
    const doneN = present.filter((p) => game.plans.get(p.id)?.done).length;
    if (phase === 'plan') {
      if (snap?.untimed) {
        lbl = 'First turn — no timer';
        val = '';
      } else {
        lbl = 'Plan your steps';
        val = String(Math.ceil(left));
        hurry = left <= 3.0;
      }
      this.set('ccRound', `Done: ${doneN} of ${present.length}`);
    } else if (phase === 'resolve') {
      lbl = 'Watch the keep!';
      this.set('ccRound', `Turn ${room.round}`);
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
    top.classList.toggle('untimed', phase === 'plan' && !!snap?.untimed);
    const wall = game.wallNow ?? game.board?.wall;
    const max = game.board?.wallMax || this.defs.wallHP || 10;
    if (wall !== null && wall !== undefined) {
      this.set('ccWall', String(Math.max(0, wall)));
      this.set('ccWallMax', `/ ${max}`);
      const pct = `${Math.max(0, Math.min(1, wall / max)) * 100}%`;
      if (this._k.bar !== pct) {
        this._k.bar = pct;
        this.$('ccWallBar').style.width = pct;
        top.classList.toggle('low', wall / max <= 0.3);
      }
    }

    // queue strip and step indicator
    if (phase === 'plan' || phase === 'resolve') {
      const st = game.queueState(now);
      this.renderQueue(st);
      let step = '';
      if (st.machines) step = 'Machines advance';
      else if (st.cur >= 0) step = `Step ${st.cur + 1}`;
      if (step !== this._step) {
        this._step = step;
        const el = this.$('ccStep');
        el.className = '';
        el.innerHTML = step ? `<span class="cc-stl">${esc(step)}</span>${st.machines ? '' : `<span class="cc-sto">of ${this.slots}</span>`}` : '';
        if (step) {
          void el.offsetWidth;
          el.className = st.machines ? 'on mach' : 'on';
        }
      }
    } else if (this._step) {
      this._step = '';
      this.$('ccStep').className = '';
    }
    this.$('ccQueue').classList.toggle('on', phase === 'plan' || phase === 'resolve');
  }

  wallHit() {
    const el = this.$('ccTop');
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

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
    this.lastClear = ev;
    const total = this.room?.levels || this.defs.levels?.length || 6;
    if (ev.level >= total) return; // the end screen says it
    if (this.room?.phase === 'break') this.renderBreak(this.room);
  }

  bossArrives(ev) {
    const nm = this.defs.machines?.[ev.kind]?.name || 'The boss';
    this.banner(`${nm} approaches!`, '', 'boss');
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

  renderBreak(room) {
    const defs = this.defs;
    const total = room.levels || defs.levels?.length || 6;
    const next = defs.levels?.[room.level]; // levels are 1-based; the next one is index room.level
    const lc = this.lastClear?.level === room.level ? this.lastClear : null;
    const wallMax = defs.wallHP || '';
    const wallLine = lc ? `Wall ${lc.wall} / ${wallMax}${lc.heal ? ` <span class="cc-heal">+${esc(lc.heal)} repaired</span>` : ''}` : '';
    const chips = room.players
      .map((p) => `<span class="cc-rchip${p.ready ? ' ready' : ''}${p.away ? ' away' : ''}" style="--pc:${esc(p.color)}">${GEAR_SVG()}${esc(p.name)}${p.ready ? TICK_SVG : ''}</span>`)
      .join('');
    const html = `
      <div class="cc-bwrap">
        <div class="cc-bh">Level ${esc(room.level)} cleared</div>
        ${wallLine ? `<div class="cc-bwall">${BRICK_SVG} ${wallLine}</div>` : ''}
        <div class="cc-bsub">Press Ready on your phone</div>
        <div class="cc-rchips">${chips}</div>
        ${next ? `<div class="cc-next"><span class="cc-nl">Next: Level ${esc(room.level + 1)} of ${esc(total)}</span> <b>${esc(next.name)}</b><div class="cc-nd">${esc(next.desc || '')}</div>${bombRow(next, defs)}</div>` : ''}
        <div class="cc-bc">Next level in <b id="ccBreakCount"></b></div>
      </div>`;
    if (html === this._bk) return;
    this._bk = html;
    this._k.ccBreakCount = undefined;
    this.$('ccBreak').innerHTML = html;
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
      ? `All ${total} levels held · ${end.rounds} turns · wall ${end.wall} / ${defs.wallHP || ''} · ${fmtTime(end.time)}`
      : `The wall fell on level ${end.level} of ${total} · ${end.rounds} turns · ${fmtTime(end.time)}`;
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
      ['fizzles', 'Fizzles'],
    ];
    const ids = Object.keys(end.stats || {});
    ids.sort((a, b) => (end.stats[b].kills || 0) - (end.stats[a].kills || 0) || (end.stats[b].dmg || 0) - (end.stats[a].dmg || 0));
    const best = {};
    for (const [k] of cols) best[k] = Math.max(0, ...ids.map((id) => end.stats[id][k] || 0));
    const rows = ids
      .map((id) => {
        const s = end.stats[id];
        return `<tr style="--pc:${esc(col(id))}"><td class="who">${GEAR_SVG()}${esc(name(id))}</td>${cols
          .map(([k]) => `<td class="${k === 'bumps' || k === 'fizzles' ? '' : s[k] && s[k] === best[k] ? 'best' : ''}">${Math.round(s[k] || 0)}</td>`)
          .join('')}</tr>`;
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
        <div class="cc-es">${esc(sub)}</div>
        ${awards ? `<div class="cc-awards">${awards}</div>` : ''}
        <table class="cc-stats"><thead><tr><th>Engineer</th>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
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
