// Clocktower phone shell: join form, lobby (players, mode choice, Start, Leave), connection and
// session handling, and loading the current mode's module (web/modes/<id>/phone/mode.js;
// contract in web/modes/README.md). Knows nothing about any particular game.
import { connect } from '/shared/net.js';
import { $, h } from '/shared/dom.js';

const tokKey = (room) => 'ct.token.' + room;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* unsupported */ } };

// ---------------------------------------------------------------- state
let you = null; // my player id
let code = null; // room code
let welcome = null; // latest welcome
let setup = null; // { mode, map, defs } of the mode being shown
let room = null; // latest room message
let players = new Map();
let conn = null;
let joinInfo = null; // {room, name}
let welcomed = false;
let screen = '';
let toastTimer = null;
let paused = null; // the room-layer `paused` message while the host has paused the game, else null
let armedKick = null; // the player whose Remove is awaiting confirmation (lobby list / pause overlay)
let armedLeave = false; // Leave on the pause overlay is awaiting confirmation
let armTimer = null;

const me = () => players.get(you);
const isHost = () => !!room && room.host === you;
const pname = (id) => players.get(id)?.name || '?';
const multi = () => (welcome?.modes?.length || 0) > 1;

// ---------------------------------------------------------------- screens
function show(name) {
  if (screen === name) return;
  screen = name;
  for (const s of ['splash', 'join', 'lobby']) $('s-' + s).hidden = s !== name;
  $('mode').hidden = name !== 'mode';
  renderPaused();
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
let wantLock = false;
async function wake(on) {
  wantLock = on;
  try {
    if (on && !lock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } else if (!on && lock) { await lock.release(); lock = null; }
  } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => { if (wantLock) wake(true); });

// ---------------------------------------------------------------- mode loading
const modeEl = $('mode');
const sheets = [];
let mod = null; // the mounted mode, or null
let modeId = null;
let loadToken = 0; // bumped on every (re)load so a stale import cannot mount
let loading = false;
let queue = []; // room/snap messages that arrived while the mode module was loading

function makeCtx(id, s) {
  return {
    id,
    el: modeEl,
    get setup() { return s; },
    get welcome() { return welcome; },
    get you() { return you; },
    get room() { return code; },
    send: (m) => conn?.send(m),
    toast,
    buzz,
    wake,
    leave: leaveRoom,
    // Adds a stylesheet for the lifetime of the mount; resolves once applied.
    loadCSS(href) {
      return new Promise((ok) => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        l.onload = l.onerror = () => ok();
        document.head.append(l);
        sheets.push(l);
      });
    },
  };
}

function unmountMode() {
  loadToken++;
  const old = mod;
  mod = null;
  modeId = null;
  loading = false;
  queue = [];
  try { old?.unmount?.(); } catch (e) { console.error('mode unmount failed', e); }
  modeEl.replaceChildren();
  $('modeOpts').replaceChildren();
  $('modeOpts').hidden = true;
  for (const l of sheets.splice(0)) l.remove();
  wake(false);
}

async function loadMode(id, s) {
  unmountMode();
  setup = s;
  renderLobby();
  const token = loadToken;
  loading = true;
  try {
    if (!/^[a-z0-9_]+$/.test(id)) throw new Error(`bad mode id ${id}`);
    const m = await import(`/modes/${id}/phone/mode.js`);
    if (token !== loadToken) return;
    const mounted = await m.mount(makeCtx(id, s));
    if (token !== loadToken) { mounted?.unmount?.(); return; }
    mod = mounted;
    modeId = id;
  } catch (e) {
    console.error(`mode ${id} failed to load`, e);
    toast('Could not load this game mode', 'err', 4000);
  }
  if (token !== loadToken) return;
  loading = false;
  const q = queue;
  queue = [];
  for (const m of q) dispatch(m);
  renderLobby(); // the mode's lobby options, now that it is loaded
}

// room and snap go to the mode (queued while it loads)
function dispatch(m) {
  if (m.t === 'room') mod?.onRoom?.(m);
  else if (m.t === 'snap') mod?.onSnap?.(m);
}

// ---------------------------------------------------------------- connection
function startConn(roomCode, name) {
  conn?.close();
  joinInfo = { room: roomCode, name };
  welcomed = false;
  conn = connect(() => ({ role: 'player', room: roomCode, name, token: store.get(tokKey(roomCode)) }), { onMessage, onStatus });
}

function onStatus(s) {
  if (s === 'kicked') return kickedOut();
  if (s === 'left') return; // our own `leave`: leaveRoom already tidied up
  const lost = s === 'closed' || (s === 'connecting' && (welcomed || screen === 'splash'));
  $('banner').hidden = !(lost && s !== 'replaced' && (welcomed || screen === 'splash'));
  $('replaced').hidden = s !== 'replaced';
  if (s === 'replaced') buzz(30);
  mod?.onStatus?.(s);
}

function joinFail(msg) {
  conn?.close();
  conn = null;
  welcomed = false;
  $('banner').hidden = true;
  const c = joinInfo?.room;
  if (c) store.del(tokKey(c));
  unmountMode();
  room = null; welcome = null; setup = null; paused = null;
  showJoin(msg, c);
}

// The host removed this player: the session is gone (the server refuses the token from now on).
// Back to the join form with the room code filled in, so joining again as a new player is a tap.
function kickedOut() {
  store.del('ct.room');
  joinFail('The host removed you from the game.');
  buzz([60, 60, 60]);
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome': return onWelcome(m);
    case 'setup': // the host picked another mode: the old mode's pages go, the new one loads
      loadMode(m.mode, { mode: m.mode, map: m.map, defs: m.defs });
      return;
    case 'room': return onRoom(m);
    case 'paused':
      paused = m.on ? m : null;
      armedKick = null; armedLeave = false;
      renderPaused();
      return;
    case 'snap':
      if (loading) queue.push(m); else dispatch(m);
      return;
    case 'error': {
      if (m.code === 'no_room') return joinFail(`No room "${joinInfo?.room}" found. Check the code on the TV.`);
      if (m.code === 'room_full') return joinFail(m.msg || 'That room is full.');
      if (m.code === 'bad_name') return joinFail(m.msg || 'Pick another name (1-12 characters).');
      if (m.code === 'kicked') return kickedOut();
      toast(m.msg || m.code, 'err');
      buzz([30, 40, 30]);
      mod?.onError?.(m);
    }
  }
}

function onWelcome(m) {
  const fresh = !welcome || welcome.room !== m.room;
  welcomed = true;
  $('banner').hidden = true;
  welcome = m;
  you = m.you; code = m.room;
  store.set(tokKey(m.room), m.token);
  store.set('ct.room', m.room);
  $('joinMsg').hidden = true;
  $('fGo').disabled = false;
  if (screen === 'join' || screen === 'splash') show('splash');
  // a reconnect to the same room and mode keeps the mounted mode (and whatever its player was doing)
  if (fresh || modeId !== m.mode) loadMode(m.mode, { mode: m.mode, map: m.map, defs: m.defs });
  else renderLobby();
}

function onRoom(m) {
  room = m;
  players = new Map(m.players.map((p) => [p.id, p]));
  show(m.phase === 'lobby' ? 'lobby' : 'mode');
  if (m.phase === 'lobby') renderLobby();
  renderPaused();
  if (loading) queue.push(m); else dispatch(m);
}

// ---------------------------------------------------------------- removing players
// One row per player: dot, name, tags; for the host, a × on everyone else that turns into an
// inline "Remove <name>?" confirmation. Used by the lobby list and the pause overlay.
function arm(fn) {
  fn();
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { armedKick = null; armedLeave = false; renderLobby(); renderPaused(); }, 5000);
  renderLobby(); renderPaused();
}
function playerRow(p) {
  const canKick = isHost() && p.id !== you;
  if (canKick && armedKick === p.id) {
    return h('li', { class: 'confirm' },
      h('span', {}, `Remove ${p.name}?`),
      h('button', { class: 'btn sm danger', type: 'button', onclick: () => { armedKick = null; send({ t: 'kick', id: p.id }); } }, 'Remove'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => arm(() => (armedKick = null)) }, 'Cancel'));
  }
  return h('li', { class: p.connected ? '' : 'off' },
    h('i', { class: 'dot', style: `background:${p.color}` }),
    h('span', {}, p.name),
    h('span', { class: 'tag' }, [p.id === room.host ? 'host' : '', p.id === you ? 'you' : '', p.connected ? '' : 'offline'].filter(Boolean).join(' · ')),
    canKick ? h('button', { class: 'kick', type: 'button', 'aria-label': `Remove ${p.name}`, title: 'Remove', onclick: () => arm(() => (armedKick = p.id)) }, '×') : null);
}

// ---------------------------------------------------------------- pause overlay
// Shown over the mode while the host has paused the game. The host gets Resume (and can remove
// players from here, since the mode's own menu is underneath); everyone can leave.
function renderPaused() {
  const box = $('hostPaused');
  const on = !!paused && !!room && screen === 'mode';
  box.hidden = !on;
  if (!on) return;
  const by = players.get(paused.by);
  $('pausedBy').textContent = by ? (paused.by === you ? 'You paused the game' : `Paused by ${by.name}`) : 'Paused';
  $('resumeBtn').hidden = !isHost();
  $('pausedWait').hidden = isHost();
  $('pausedWait').textContent = `Waiting for ${pname(room.host)} to resume…`;
  const others = room.players.filter((p) => p.id !== you);
  $('pausedList').hidden = !isHost() || !others.length;
  if (isHost()) $('pausedList').replaceChildren(...others.map(playerRow));
  $('pausedLeave').replaceChildren(armedLeave
    ? h('span', { class: 'confirm' }, h('span', {}, 'Leave this game?'),
      h('button', { class: 'btn sm danger', type: 'button', onclick: () => { armedLeave = false; leaveRoom(); } }, 'Leave'),
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => arm(() => (armedLeave = false)) }, 'Cancel'))
    : h('button', { class: 'link', type: 'button', onclick: () => arm(() => (armedLeave = true)) }, 'Leave game'));
}

// ---------------------------------------------------------------- join form
function showJoin(msg, c) {
  show('join');
  const box = $('joinMsg');
  box.hidden = !msg;
  box.textContent = msg || '';
  if (c) $('fCode').value = c;
  $('fGo').disabled = false;
  $('fGo').textContent = 'Join the town';
}

$('fCode').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});
$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const r = $('fCode').value.trim().toUpperCase();
  const name = $('fName').value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 12);
  if (r.length !== 4) return showJoin('Enter the 4-letter code shown on the TV.');
  if (!name) return showJoin('Enter a name (1-12 characters).', r);
  store.set('ct.name', name);
  $('joinMsg').hidden = true;
  $('fGo').disabled = true;
  $('fGo').textContent = 'Joining…';
  startConn(r, name);
});

// ---------------------------------------------------------------- lobby
function renderLobby() {
  if (!room) return;
  const mine = me();
  $('lobbyName').textContent = mine?.name || '';
  $('lobbyDot').style.background = mine?.color || '';
  $('lobbyRoom').textContent = code;
  if (armedKick && !players.has(armedKick)) armedKick = null;
  $('lobbyList').replaceChildren(...room.players.map(playerRow));
  $('startBtn').hidden = !isHost();
  const w = $('waitMsg');
  w.hidden = isHost();
  w.textContent = `Waiting for ${pname(room.host)} to start…`;
  renderModes();
  renderModeOpts();
}

// The mode's own lobby controls (optional `lobbyOptions(container, {isHost, room})` hook), shown
// under the mode cards; hidden when the mode has none or renders nothing.
function renderModeOpts() {
  const box = $('modeOpts');
  if (!mod?.lobbyOptions || room?.phase !== 'lobby') { box.hidden = true; return; }
  try { mod.lobbyOptions(box, { isHost: isHost(), room }); } catch (e) { console.error('lobbyOptions failed', e); }
  box.hidden = !box.childElementCount;
}

// Mode choice, only when there is something to choose. The host gets one tappable card per
// mode, everyone else just sees the current one.
function renderModes() {
  const box = $('modeBox');
  box.hidden = !multi();
  if (!multi()) return;
  const cur = setup?.mode || room?.mode;
  const host = isHost();
  const card = (info) => {
    const on = info.id === cur;
    const kids = [h('b', { class: 'mn display' }, info.name), h('span', { class: 'mt' }, info.tagline || '')];
    return host
      ? h('button', { class: 'mcard' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', 'data-mode': info.id, onclick: () => { if (!on) send({ t: 'mode', id: info.id }); } }, kids)
      : h('div', { class: 'mcard static on', 'data-mode': info.id }, kids);
  };
  const list = host ? welcome.modes : welcome.modes.filter((i) => i.id === cur);
  $('modeCards').replaceChildren(...list.map(card));
}
const send = (m) => conn?.send(m);
$('startBtn').onclick = () => send({ t: 'start' });
// Leave: tell the server (it frees the seat and closes with `left`), then forget the session.
// Works with the socket down too: the server then keeps a disconnected seat until the host
// removes it (or a full lobby evicts it).
function leaveRoom() {
  conn?.send({ t: 'leave' });
  conn?.close(); conn = null;
  store.del(tokKey(code)); store.del('ct.room');
  unmountMode();
  room = null; welcomed = false; welcome = null; setup = null; players = new Map(); paused = null;
  $('banner').hidden = true;
  showJoin('', '');
}
$('leaveBtn').onclick = leaveRoom;
$('resumeBtn').onclick = () => send({ t: 'pause', on: false });
$('takeBtn').onclick = () => { $('replaced').hidden = true; if (joinInfo) startConn(joinInfo.room, joinInfo.name); };

// ---------------------------------------------------------------- boot
(function boot() {
  const q = (new URLSearchParams(location.search).get('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  const name = store.get('ct.name') || '';
  $('fName').value = name;
  const r = q || store.get('ct.room') || '';
  if (r.length === 4 && store.get(tokKey(r))) {
    show('splash');
    startConn(r, name || 'Engineer');
  } else {
    showJoin('', q);
  }
})();
