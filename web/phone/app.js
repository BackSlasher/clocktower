// Clocktower phone controller: screens, connection and the game panel.
import { connect } from '/shared/net.js';
import { Minimap, kindColor } from './map.js';

const $ = (id) => document.getElementById(id);
const tokKey = (room) => 'ct.token.' + room;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* unsupported */ } };

// ---------------------------------------------------------------- state
const st = {
  map: null, defs: null, you: null, code: null,
  room: null, snap: null, snapAt: 0,
  players: new Map(), sel: null,
};
let conn = null;
let joinInfo = null; // {room, name}
let welcomed = false;
let screen = '';
let toastTimer = null;

const me = () => st.players.get(st.you);
const isHost = () => st.room && st.room.host === st.you;
const purse = () => st.snap?.purses?.[st.you] ?? 0;
const towerAt = (plot) => st.snap?.towers?.find((t) => t.plot === plot) || null;
// prices: the server's per-player `costs` (price perks) win over defs; `free` builds cost nothing
const freeLeft = () => me()?.free || 0;
const buildCost = (kind) => (freeLeft() > 0 ? 0 : me()?.costs?.[kind]?.[0] ?? st.defs.towers[kind].levels[0].cost);
const upCost = (kind, lvl) => me()?.costs?.[kind]?.[lvl] ?? st.defs.towers[kind].levels[lvl]?.cost;
const pname = (id) => st.players.get(id)?.name || '?';

// ---------------------------------------------------------------- screens
function show(name) {
  if (screen === name) return;
  screen = name;
  for (const s of ['splash', 'join', 'lobby', 'game', 'end']) $('s-' + s).hidden = s !== name;
  $('s-end').classList.toggle('won', !!st.room?.end?.won);
  $('s-end').classList.toggle('lost', !!st.room && !st.room.end?.won);
  if (name === 'game') { map.start(); map.resize(); wake(true); } else { map.stop(); wake(false); }
}

function toast(msg, kind = 'ok', ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), kind === 'err' ? Math.max(ms, 2600) : ms);
}

let lock = null;
async function wake(on) {
  try {
    if (on && !lock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } else if (!on && lock) { await lock.release(); lock = null; }
  } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => { if (screen === 'game') wake(true); });

// ---------------------------------------------------------------- connection
function startConn(room, name) {
  conn?.close();
  joinInfo = { room, name };
  welcomed = false;
  conn = connect(() => ({ role: 'player', room, name, token: store.get(tokKey(room)) }), { onMessage, onStatus });
}
const send = (m) => conn?.send(m);

function onStatus(s) {
  const lost = s === 'closed' || (s === 'connecting' && (welcomed || screen === 'splash'));
  $('banner').hidden = !(lost && s !== 'replaced' && (welcomed || screen === 'splash'));
  $('replaced').hidden = s !== 'replaced';
  if (s === 'replaced') { flushWind(); buzz(30); }
}

function joinFail(msg) {
  conn?.close();
  conn = null;
  welcomed = false;
  $('banner').hidden = true;
  const code = joinInfo?.room;
  if (code) store.del(tokKey(code));
  showJoin(msg, code);
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome': return onWelcome(m);
    case 'room': return onRoom(m);
    case 'snap': return onSnap(m);
    case 'error': {
      if (m.code === 'no_room') return joinFail(`No room "${joinInfo?.room}" found. Check the code on the TV.`);
      if (m.code === 'room_full') return joinFail(m.msg || 'That room is full.');
      if (m.code === 'bad_name') return joinFail(m.msg || 'Pick another name (1-12 characters).');
      toast(m.msg || m.code, 'err');
      buzz([30, 40, 30]);
      if (picked) { picked = null; if (!$('perkSheet').hidden) renderOffer(); }
    }
  }
}

function onWelcome(m) {
  welcomed = true;
  $('banner').hidden = true;
  st.map = m.map; st.defs = m.defs; st.you = m.you; st.code = m.room;
  store.set(tokKey(m.room), m.token);
  store.set('ct.room', m.room);
  st.snap = null;
  map.setMap();
  $('joinMsg').hidden = true;
  $('fGo').disabled = false;
  if (screen === 'join' || screen === 'splash') show('splash');
}

function onRoom(m) {
  const prev = st.room;
  st.room = m;
  st.players = new Map(m.players.map((p) => [p.id, p]));
  if (!prev || prev.phase !== m.phase) {
    if (m.phase === 'lobby') { st.snap = null; st.sel = null; renderPanel(); }
    if (m.phase === 'build' || m.phase === 'wave') renderPanel();
  }
  renderAll();
}

function renderAll() {
  const r = st.room;
  if (!r) return;
  show(r.phase === 'lobby' ? 'lobby' : r.phase === 'won' || r.phase === 'lost' ? 'end' : 'game');
  if (screen === 'lobby') renderLobby();
  if (screen === 'game') { renderTop(); renderUnder(); renderActions(); updatePanel(); }
  if (screen === 'end') renderEnd();
  if (!$('giftSheet').hidden) renderGift();
  syncPerks();
}

// ---------------------------------------------------------------- join form
function showJoin(msg, code) {
  show('join');
  const box = $('joinMsg');
  box.hidden = !msg;
  box.textContent = msg || '';
  if (code) $('fCode').value = code;
  $('fGo').disabled = false;
  $('fGo').textContent = 'Join the town';
}

$('fCode').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});
$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const room = $('fCode').value.trim().toUpperCase();
  const name = $('fName').value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 12);
  if (room.length !== 4) return showJoin('Enter the 4-letter code shown on the TV.');
  if (!name) return showJoin('Enter a name (1-12 characters).', room);
  store.set('ct.name', name);
  $('joinMsg').hidden = true;
  $('fGo').disabled = true;
  $('fGo').textContent = 'Joining…';
  startConn(room, name);
});

// ---------------------------------------------------------------- lobby
function renderLobby() {
  const r = st.room;
  const mine = me();
  $('lobbyName').textContent = mine?.name || '';
  $('lobbyDot').style.background = mine?.color || '';
  $('lobbyRoom').textContent = st.code;
  const ul = $('lobbyList');
  ul.replaceChildren(...r.players.map((p) => h('li', { class: p.connected ? '' : 'off' },
    h('i', { class: 'dot', style: `background:${p.color}` }),
    h('span', {}, p.name),
    h('span', { class: 'tag' }, [p.id === r.host ? 'host' : '', p.id === st.you ? 'you' : '', p.connected ? '' : 'offline'].filter(Boolean).join(' · ')))));
  $('startBtn').hidden = !isHost();
  const w = $('waitMsg');
  w.hidden = isHost();
  w.textContent = `Waiting for ${pname(r.host)} to start…`;
}
$('startBtn').onclick = () => send({ t: 'start' });
function leaveRoom() {
  conn?.close(); conn = null;
  store.del(tokKey(st.code)); store.del('ct.room');
  st.room = null; st.snap = null; st.sel = null; welcomed = false;
  $('banner').hidden = true;
  for (const id of ['giftSheet', 'perkSheet', 'menuSheet']) $(id).hidden = true;
  offerKey = ''; shownOffer = ''; picked = null;
  showJoin('', '');
}
$('leaveBtn').onclick = leaveRoom;
$('takeBtn').onclick = () => { $('replaced').hidden = true; if (joinInfo) startConn(joinInfo.room, joinInfo.name); };

// ---------------------------------------------------------------- top bar & under-map
let lastPurse = null; let lastLives = null;
function renderTop() {
  const { defs, room, snap } = st;
  const p = purse();
  $('tPurse').textContent = p;
  if (lastPurse != null && p > lastPurse) bump($('tPurse'), 'bump');
  lastPurse = p;
  const lives = snap ? snap.lives : defs.maxLives;
  $('tLives').textContent = lives;
  if (lastLives != null && lives < lastLives) { bump($('tLives'), 'hurt'); buzz(60); }
  lastLives = lives;
  $('tWave').textContent = `${room.wave}/${defs.waves}`;
  const build = room.phase === 'build';
  $('tTimerBox').classList.toggle('idle', !build);
  $('tTimer').textContent = build && snap ? Math.ceil(snap.left) + 's' : '';
}
function bump(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

let underKey = '';
function renderUnder() {
  const { room, defs, snap } = st;
  let key; let kids;
  if (room.phase === 'build') {
    key = 'b' + JSON.stringify(room.nextWave);
    kids = () => [h('div', { class: 'ttl' }, 'Next wave'), h('div', { class: 'wv' },
      room.nextWave.map((g) => h('span', { class: defs.enemies[g.kind]?.boss ? 'boss' : '' }, h('b', {}, g.n + '×'), ' ' + (defs.enemies[g.kind]?.name || g.kind))))];
  } else {
    const n = snap?.enemies?.length || 0;
    key = 'w' + n;
    kids = () => [h('div', { class: 'ttl' }, 'Wave ' + room.wave), h('div', { class: 'wv' }, h('span', {}, h('b', {}, n), n === 1 ? ' enemy marching' : ' enemies marching'))];
  }
  if (key === underKey) return;
  underKey = key;
  $('under').replaceChildren(...kids());
}

function renderActions() {
  const build = st.room.phase === 'build';
  const rb = $('readyBtn');
  rb.hidden = !build;
  const ready = !!me()?.ready;
  rb.classList.toggle('on', ready);
  rb.textContent = ready ? 'Ready ✓' : 'Ready';
  // nobody to gift to when playing solo: hide the button rather than open an empty sheet
  const solo = st.room.players.length < 2;
  $('giftBtn').hidden = solo;
  if (solo) $('giftSheet').hidden = true;
}
$('readyBtn').onclick = () => { send({ t: 'ready', ready: !me()?.ready }); buzz(10); };

// ---------------------------------------------------------------- snapshots
function onSnap(m) {
  st.snap = m;
  st.snapAt = performance.now();
  unacked = 0;
  for (const e of m.ev || []) onEvent(e);
  if (!st.room || screen === 'splash') return;
  if (screen === 'game') { renderTop(); renderUnder(); updatePanel(); }
  if (!$('giftSheet').hidden) updateGiftAmts();
  const k = panelKey();
  if (k !== shownKey) renderPanel();
}

function onEvent(e) {
  const d = st.defs;
  switch (e.e) {
    case 'build': if (e.pid === st.you) { toast(`Built ${d.towers[e.kind]?.name || e.kind}`); buzz(20); } break;
    case 'upgrade': if (e.pid === st.you) { toast(`Upgraded to level ${e.lvl}`); buzz(20); } break;
    case 'sell': if (e.pid === st.you) { toast(`Sold for ${e.refund} cogs`); buzz(20); } break;
    case 'gift':
      if (e.from === st.you) toast(`Sent ${e.amount} cogs to ${pname(e.to)}`);
      else if (e.to === st.you) { toast(`${pname(e.from)} sent you ${e.amount} cogs`); buzz([15, 30, 15]); }
      break;
    case 'perk': if (e.pid === st.you) { toast(`Perk: ${d.perks?.[e.id]?.name || e.id}`); buzz(20); } break;
    case 'wave_clear': toast(`Wave ${e.wave} cleared! +${e.bonus} cogs`); break;
    case 'wave_start': buzz(40); break;
  }
}

// ---------------------------------------------------------------- map
const landscape = matchMedia('(orientation: landscape) and (max-height: 560px)');
landscape.addEventListener?.('change', () => map.resize());
const map = new Minimap($('map'), st, (plot) => select(plot));
map.onLayout = (bottom) => {
  const u = $('under');
  const w = $('mapwrap');
  u.hidden = map.zoom;
  u.style.top = bottom + 2 + 'px';
  // Fit view: wrapper hugs the map strip (plus the info line) so the panel,
  // and the big CRANK button in it, get the rest. Zoom view fills the space.
  if (map.zoom || !st.map || landscape.matches) { w.style.flex = '1'; w.style.height = ''; }
  else { w.style.flex = 'none'; w.style.height = bottom + 76 + 'px'; }
};
function select(plot) {
  if (plot === st.sel) { if (plot == null) return; plot = null; } // tap again to deselect
  flushWind();
  st.sel = plot;
  sellArmed = false;
  buzz(5);
  renderPanel();
}
$('zoomBtn').onclick = () => {
  map.setZoom(!map.zoom);
  map.onLayout(map.mapBottom());
  $('s-game').classList.toggle('zoomed', map.zoom);
  $('zoomBtn').classList.toggle('on', map.zoom);
  $('zoomBtn').textContent = map.zoom ? 'Full map' : 'Zoom';
  $('under').hidden = map.zoom;
};

$('rotateX').onclick = () => { $('rotate').hidden = true; try { sessionStorage.setItem('ct.rot', '1'); } catch { /* ignore */ } };
try { if (sessionStorage.getItem('ct.rot')) $('rotate').hidden = true; } catch { /* ignore */ }

// ---------------------------------------------------------------- panel
let shownKey = '';
let sellArmed = false; let sellTimer = null; let lastCrankAt = -1e9;
let refs = {};
const panelKey = () => {
  const ph = st.room?.phase;
  if (st.sel == null) return 'none:' + ph;
  const t = towerAt(st.sel);
  return t ? `t${st.sel}:${t.kind}:${t.lvl}:${t.owner}:${t.spent}` : `e${st.sel}`;
};

const LABELS = [['dmg', 'dmg', (v) => v], ['rate', 'rate', (v) => v + '/s'], ['range', 'range', (v) => v], ['splash', 'splash', (v) => v], ['chains', 'chain', (v) => '×' + v], ['slow', 'slow', (v) => Math.round(v * 100) + '%']];
function statStr(lv, only) {
  return LABELS.filter(([k]) => lv[k] != null && (!only || only.includes(k)))
    .map(([k, l, f]) => `${l} ${f(lv[k])}`).join(' · ');
}
function diffStr(a, b) {
  return LABELS.filter(([k]) => a[k] != null && b[k] != null && a[k] !== b[k])
    .map(([k, l, f]) => `${l} ${f(a[k])}→${f(b[k])}`).slice(0, 2).join(' · ');
}

function renderPanel() {
  const P = $('panel');
  shownKey = panelKey();
  refs = {};
  const { defs } = st;
  if (!defs || !st.room) return;
  if (st.sel == null) {
    P.replaceChildren(h('p', { class: 'hint' }, st.room.phase === 'build'
      ? 'Tap a plot on the map to build. Get ready before the wave arrives!'
      : 'Tap a tower on the map, then crank it to wind it up. Wound towers shoot faster.'));
    return;
  }
  const t = towerAt(st.sel);
  if (!t) {
    refs.cards = defs.towerOrder.map((kind) => {
      const def = defs.towers[kind];
      const lv = def.levels[0];
      const b = h('button', {
        class: 'card', type: 'button',
        onclick: () => {
          if (b.dataset.lock) return;
          b.dataset.lock = 1; setTimeout(() => delete b.dataset.lock, 500);
          send({ t: 'build', plot: st.sel, kind });
        },
      },
        h('span', { class: 'nm' }, h('span', { style: `color:${kindColor(defs, kind)}` }, def.name), h('span', { class: 'cost' }, lv.cost + '⚙')),
        h('span', { class: 'st' }, statStr(lv)));
      b.dataset.kind = kind;
      return b;
    });
    P.replaceChildren(h('div', { class: 'cards' }, refs.cards));
    updatePanel();
    return;
  }
  // built tower
  const def = defs.towers[t.kind];
  const lv = def.levels[t.lvl - 1];
  const next = def.levels[t.lvl];
  const own = t.owner === st.you;
  const owner = st.players.get(t.owner);
  refs.up = h('button', { class: 'btn', type: 'button', onclick: () => { send({ t: 'upgrade', plot: st.sel }); } });
  if (next) {
    refs.upKind = t.kind; refs.upLvl = t.lvl;
    refs.upLbl = h('span', {}, '');
    refs.up.append(refs.upLbl, h('small', {}, diffStr(lv, next) || `level ${t.lvl + 1}`));
  } else {
    refs.up.disabled = true;
    refs.up.append(h('span', {}, 'Max level'), h('small', {}, statStr(lv, ['dmg', 'rate', 'range'])));
  }
  const refund = Math.floor(defs.sellRefund * t.spent);
  const brow = [refs.up];
  if (own) {
    refs.sell = h('button', {
      class: 'btn sell', type: 'button',
      onclick: () => {
        if (!sellArmed) {
          sellArmed = true; setSell();
          clearTimeout(sellTimer);
          sellTimer = setTimeout(() => { sellArmed = false; setSell(); }, 3000);
        } else { sellArmed = false; clearTimeout(sellTimer); send({ t: 'sell', plot: st.sel }); }
      },
    });
    refs.refund = refund;
    brow.push(refs.sell);
    setSell();
  }
  refs.fill = h('span', { class: 'fill' });
  refs.pct = h('span', { class: 'pct' }, '0%');
  refs.gear = h('span', { class: 'g' }, '⚙');
  refs.crank = h('button', { class: 'crank', type: 'button', 'aria-label': 'Crank' }, refs.fill, refs.gear, h('span', { class: 'lbl' }, 'CRANK'), refs.pct);
  refs.crank.addEventListener('pointerdown', (e) => { e.preventDefault(); refs.crank.classList.add('pressed'); crankTap(); });
  const unpress = () => refs.crank?.classList.remove('pressed');
  refs.crank.addEventListener('pointerup', unpress);
  refs.crank.addEventListener('pointercancel', unpress);
  refs.crank.addEventListener('pointerleave', unpress);
  refs.crank.addEventListener('contextmenu', (e) => e.preventDefault());
  P.replaceChildren(
    h('div', { class: 'trow' },
      h('i', { class: 'dot', style: `background:${owner?.color || '#999'}` }),
      h('div', {}, h('div', { class: 'nm' }, def.name), h('div', { class: 'sub' }, `Level ${t.lvl} · ${own ? 'yours' : owner?.name || '?'} · ${statStr(lv, ['dmg', 'rate', 'range', 'slow'])}`)),
      h('span', { class: 'pips' }, '★'.repeat(t.lvl))),
    h('div', { class: 'brow' }, brow),
    refs.crank);
  updatePanel();
}
function setSell() {
  if (!refs.sell) return;
  refs.sell.classList.toggle('danger', sellArmed);
  refs.sell.replaceChildren(h('span', {}, sellArmed ? 'Confirm sell' : 'Sell'), h('small', {}, `+${refs.refund}⚙`));
}

function updatePanel() {
  const p = purse();
  const free = freeLeft() > 0;
  for (const c of refs.cards || []) {
    const cost = buildCost(c.dataset.kind);
    c.classList.toggle('poor', p < cost);
    c.classList.toggle('free', free);
    const el = c.querySelector('.cost');
    const txt = free ? 'FREE' : cost + '⚙';
    if (el.textContent !== txt) el.textContent = txt;
  }
  if (refs.up && refs.upLbl) {
    const cost = upCost(refs.upKind, refs.upLvl);
    refs.up.disabled = p < cost;
    const txt = `Upgrade · ${cost}⚙`;
    if (refs.upLbl.textContent !== txt) refs.upLbl.textContent = txt;
  }
  updateGauge();
}

// ---------------------------------------------------------------- cranking
let pending = 0; let unacked = 0; let windPlot = null; let windTimer = null; let lastSend = 0;
function crankTap() {
  const t = towerAt(st.sel);
  if (!t) return;
  windPlot = st.sel;
  lastCrankAt = performance.now();
  pending++; unacked++;
  refs.angle = (refs.angle || 0) + 45;
  refs.gear.style.transform = `rotate(${refs.angle}deg)`;
  buzz(6);
  updateGauge();
  if (!windTimer) windTimer = setTimeout(flushWind, Math.max(0, 150 - (performance.now() - lastSend)));
}
function flushWind() {
  clearTimeout(windTimer); windTimer = null;
  if (pending > 0 && windPlot != null) {
    send({ t: 'wind', plot: windPlot, n: Math.min(100, pending) });
    lastSend = performance.now();
  }
  pending = 0;
}
function updateGauge() {
  if (!refs.fill) return;
  const t = towerAt(st.sel);
  if (!t) return;
  const v = Math.min(1, t.tension + unacked * st.defs.windPerTap);
  refs.fill.style.width = (v * 100).toFixed(0) + '%';
  refs.pct.textContent = Math.round(v * 100) + '%';
}

// ---------------------------------------------------------------- gifting
let giftTo = null; let giftAmt = null;
function openGift() { giftTo = null; giftAmt = null; $('giftSheet').hidden = false; renderGift(); }
$('giftBtn').onclick = openGift;
$('giftClose').onclick = () => ($('giftSheet').hidden = true);
$('giftSheet').addEventListener('click', (e) => { if (e.target === $('giftSheet')) $('giftSheet').hidden = true; });
function renderGift() {
  const others = st.room.players.filter((p) => p.id !== st.you);
  if (giftTo && !others.some((p) => p.id === giftTo)) giftTo = null;
  $('giftPlayers').replaceChildren(...(others.length ? others.map((p) => h('button', {
    class: 'chip' + (p.id === giftTo ? ' sel' : ''), type: 'button',
    onclick: () => { giftTo = p.id; renderGift(); },
  }, h('i', { class: 'dot', style: `background:${p.color}` }), p.name)) : [h('p', { class: 'dim' }, 'No one else to send cogs to yet.')]));
  const amts = [25, 50, 100, 'all'];
  $('giftAmts').replaceChildren(...amts.map((a) => h('button', {
    class: 'chip' + (a === giftAmt ? ' sel' : ''), type: 'button', 'data-a': a,
    onclick: () => { giftAmt = a; renderGift(); },
  }, a === 'all' ? 'All' : a)));
  updateGiftAmts();
}
function updateGiftAmts() {
  const p = purse();
  for (const b of $('giftAmts').children) {
    const a = b.dataset.a === 'all' ? Math.floor(p) : +b.dataset.a;
    b.disabled = a < 1 || a > p;
  }
  const amt = giftAmt === 'all' ? Math.floor(p) : giftAmt;
  $('giftSend').disabled = !(giftTo && amt >= 1 && amt <= p);
  $('giftSend').textContent = giftTo && amt ? `Send ${amt}⚙ to ${pname(giftTo)}` : 'Send';
}
$('giftSend').onclick = () => {
  const amt = giftAmt === 'all' ? Math.floor(purse()) : giftAmt;
  if (!giftTo || !(amt >= 1)) return;
  send({ t: 'gift', to: giftTo, amount: amt });
  $('giftSheet').hidden = true;
};

// ---------------------------------------------------------------- end screen
function renderEnd() {
  const { end } = st.room;
  const d = st.defs;
  $('s-end').classList.toggle('won', !!end?.won);
  $('s-end').classList.toggle('lost', !end?.won);
  $('endTitle').textContent = end?.won ? 'Victory!' : 'The Clock Has Fallen';
  const secs = Math.round(end?.time || 0);
  $('endSub').textContent = `${end?.won ? 'Brasswick is saved' : 'Brasswick is overrun'} · wave ${end?.wave}/${d.waves} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const s = end?.stats?.[st.you] || {};
  const tiles = [['kills', 'Kills'], ['dmg', 'Damage'], ['spent', 'Spent'], ['winds', 'Winds'], ['built', 'Built'], ['gifted', 'Gifted']];
  $('endMine').replaceChildren(...tiles.map(([k, l]) => h('div', {}, h('b', {}, Math.round(s[k] || 0)), h('span', {}, l))));
  $('endAwards').replaceChildren(...(end?.awards || []).map((a) => h('div', { class: 'award' + (a.pid === st.you ? ' me' : '') },
    h('i', { class: 'dot', style: `background:${st.players.get(a.pid)?.color || '#999'}` }),
    h('div', {}, h('div', { class: 'at' }, a.title), h('div', { class: 'ad' }, a.detail)),
    h('div', { class: 'ap' }, a.pid === st.you ? 'You' : pname(a.pid)))));
  const pk = Object.entries(me()?.perks || {}).filter(([, n]) => n > 0).map(([id, n]) => h('span', { class: 'pkc' + (d.perks?.[id]?.rare ? ' rare' : '') }, perkName(id) + (n > 1 ? ` ×${n}` : '')));
  const ep = $('endPerks');
  ep.hidden = !pk.length;
  ep.replaceChildren(...(pk.length ? [h('div', { class: 'ttl' }, 'Your perks'), h('div', { class: 'pkcs' }, pk)] : []));
  $('againBtn').hidden = !isHost();
  $('againWait').hidden = isHost();
  $('againWait').textContent = `Waiting for ${pname(st.room.host)} to play again…`;
}
$('againBtn').onclick = () => send({ t: 'restart' });

// ---------------------------------------------------------------- perks
const perkName = (id) => st.defs?.perks?.[id]?.name || id;
let offerKey = ''; // the offer we have seen (joined ids), '' when none
let shownOffer = ''; // the offer the sheet currently shows
let picked = null; // card tapped, awaiting the server
let deferTimer = null;
const CRANK_QUIET_MS = 1500;
// any touch on the game screen counts as "busy": a sheet must not open under a moving finger
$('s-game').addEventListener('pointerdown', () => { lastCrankAt = performance.now(); }, true);

// Called from every room update: reacts to the offer appearing, changing or being taken.
function syncPerks() {
  const offer = me()?.offer;
  const key = offer ? offer.join(',') : '';
  const inGame = screen === 'game';
  $('perkBtn').hidden = !(offer && inGame);
  if (key !== offerKey) {
    offerKey = key;
    picked = null;
    if (key && inGame) {
      if (!$('perkSheet').hidden) renderOffer(); // replaced while open: refresh in place
      else openOfferSoon();
    } else if (!key) $('perkSheet').hidden = true;
  }
  if (!inGame) $('perkSheet').hidden = true;
  if (!$('menuSheet').hidden) renderMenu();
}

// Opens the offer, but never over a player who is cranking right now (the wave may be running).
function openOfferSoon() {
  clearTimeout(deferTimer);
  const wait = CRANK_QUIET_MS - (performance.now() - lastCrankAt);
  if (wait > 0) { deferTimer = setTimeout(openOfferSoon, wait + 50); return; }
  if (!me()?.offer || screen !== 'game' || offerKey !== me().offer.join(',')) return;
  if (!$('giftSheet').hidden || !$('menuSheet').hidden) { deferTimer = setTimeout(openOfferSoon, 800); return; }
  openOffer();
}
function openOffer() { flushWind(); $('perkSheet').hidden = false; renderOffer(); }
function renderOffer() {
  const offer = me()?.offer;
  if (!offer) { $('perkSheet').hidden = true; return; }
  shownOffer = offer.join(',');
  const owned = me()?.perks || {};
  $('perkCards').replaceChildren(...offer.map((id) => {
    const def = st.defs.perks?.[id] || { name: id, desc: '' };
    const n = owned[id] || 0;
    return h('button', {
      class: 'pcard' + (def.rare ? ' rare' : '') + (picked === id ? ' taken' : ''), type: 'button', 'data-id': id,
      disabled: picked != null && picked !== id,
      onclick: () => {
        if (picked) return;
        picked = id; send({ t: 'perk', id }); buzz(15); renderOffer();
      },
    },
      def.rare ? h('span', { class: 'rare-tag' }, 'RARE') : null,
      h('span', { class: 'pn' }, def.name),
      h('span', { class: 'pd' }, def.desc),
      h('span', { class: 'pown' }, picked === id ? 'Taken ✓' : n > 0 ? `you have ${n}` : ''));
  }));
}
$('perkBtn').onclick = openOffer;
$('perkLater').onclick = () => ($('perkSheet').hidden = true);

// ---------------------------------------------------------------- menu
let armed = null; let armTimer = null;
function openMenu() { armed = null; $('menuSheet').hidden = false; renderMenu(); }
$('menuBtn').onclick = openMenu;
$('menuClose').onclick = () => ($('menuSheet').hidden = true);
$('menuSheet').addEventListener('click', (e) => { if (e.target === $('menuSheet')) $('menuSheet').hidden = true; });
function renderMenu() {
  const owned = Object.entries(me()?.perks || {}).filter(([, n]) => n > 0);
  const perks = owned.length
    ? h('ul', { class: 'myperks' }, owned.map(([id, n]) => h('li', {}, h('b', {}, `${perkName(id)} ×${n}`), h('span', {}, st.defs.perks?.[id]?.desc || ''))))
    : h('p', { class: 'dim small nopk' }, 'No perks yet. You pick one after each cleared wave.');
  const confirmItem = (key, label, ask, danger, fn) => armed === key
    ? h('div', { class: 'confirm' }, h('span', {}, ask),
      h('button', { class: 'btn sm danger', type: 'button', onclick: fn }, 'Yes'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { armed = null; renderMenu(); } }, 'No'))
    : h('button', {
      class: 'btn sm ' + (danger ? 'ghost warn' : 'ghost'), type: 'button',
      onclick: () => { armed = key; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = null; if (!$('menuSheet').hidden) renderMenu(); }, 5000); renderMenu(); },
    }, label);
  const items = [];
  if (isHost()) {
    items.push(confirmItem('end', 'End game', 'End the game for everyone?', true, () => { armed = null; $('menuSheet').hidden = true; send({ t: 'restart' }); }));
  }
  items.push(confirmItem('leave', 'Leave game', 'Leave this game?', true, () => { $('menuSheet').hidden = true; leaveRoom(); }));
  $('menuBody').replaceChildren(h('div', { class: 'ttl' }, 'Your perks'), perks, h('div', { class: 'mrow' }, items));
}

// ---------------------------------------------------------------- boot
(function boot() {
  const q = (new URLSearchParams(location.search).get('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  const name = store.get('ct.name') || '';
  $('fName').value = name;
  const room = q || store.get('ct.room') || '';
  if (room.length === 4 && store.get(tokKey(room))) {
    show('splash');
    startConn(room, name || 'Engineer');
  } else {
    showJoin('', q);
  }
})();
