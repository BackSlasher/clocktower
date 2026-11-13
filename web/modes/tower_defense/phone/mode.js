// tower_defense ("Cobble Crawlers") on the phone: minimap, build/upgrade/sell panel, crank, gift,
// perk sheets, menu and the end screen. Contract: see web/modes/README.md.
import { Minimap, kindColor } from './map.js';
import { $, h } from '/shared/dom.js';

const HTML = `
  <!-- Game -->
  <section id="s-game" class="screen game" hidden>
    <header id="topbar" class="plate">
      <div class="stat" title="Cogs"><span class="ico cog">&#9881;</span><b id="tPurse">0</b></div>
      <div class="stat" title="Lives"><span class="ico heart">&#9829;</span><b id="tLives">0</b></div>
      <div class="stat wave"><small>Wave</small><b id="tWave">0/0</b></div>
      <div class="stat wave timer" id="tTimerBox"><small>Build</small><b id="tTimer">0</b></div>
      <button id="perkBtn" class="perkchip" type="button" hidden>Perk!</button>
      <button id="menuBtn" class="menubtn" type="button" aria-label="Menu">&#8943;</button>
    </header>
    <div id="mapwrap">
      <canvas id="map"></canvas>
      <div id="under"></div>
    </div>
    <div id="actions">
      <button id="giftBtn" class="btn sm">Gift cogs</button>
      <button id="readyBtn" class="btn sm" hidden>Ready</button>
      <button id="zoomBtn" class="btn sm ghost">Zoom</button>
    </div>
    <div id="rotate" class="rotate"><span>Rotate your phone for a bigger map</span><button id="rotateX" aria-label="Dismiss">&times;</button></div>
    <div id="panel" class="plate"></div>
  </section>

  <!-- End -->
  <section id="s-end" class="screen end" hidden>
    <h1 id="endTitle" class="display"></h1>
    <p id="endSub" class="dim center-text"></p>
    <div id="endMine" class="plate mine"></div>
    <div id="endPerks" class="perklist" hidden></div>
    <div id="endAwards" class="awards"></div>
    <div class="lobby-foot">
      <button id="againBtn" class="btn big-btn" hidden>Play again</button>
      <p id="againWait" class="dim center-text" hidden></p>
    </div>
  </section>

  <!-- Gift sheet -->
  <div id="giftSheet" class="sheet" hidden>
    <div class="sheet-body plate">
      <div class="sheet-head"><b class="display">Send cogs</b><button id="giftClose" class="x" aria-label="Close">&times;</button></div>
      <div id="giftPlayers" class="chips"></div>
      <div id="giftAmts" class="chips amts"></div>
      <button id="giftSend" class="btn big-btn" disabled>Send</button>
    </div>
  </div>

  <!-- Perk offer sheet -->
  <div id="perkSheet" class="sheet perk-sheet" hidden>
    <div class="sheet-body plate">
      <div class="sheet-head"><b class="display">Choose a perk</b><button id="perkLater" class="btn sm ghost later" type="button">Later</button></div>
      <div id="perkCards" class="perk-cards"></div>
    </div>
  </div>

  <!-- Menu sheet (my perks, end game, leave) -->
  <div id="menuSheet" class="sheet" hidden>
    <div class="sheet-body plate">
      <div class="sheet-head"><b class="display">Menu</b><button id="menuClose" class="x" aria-label="Close">&times;</button></div>
      <div id="menuBody" class="menu-body"></div>
    </div>
  </div>
`;

export async function mount(ctx) {
  await ctx.loadCSS(new URL('./phone.css', import.meta.url).href);
  ctx.el.innerHTML = HTML;

  // ---------------------------------------------------------------- state
  const st = {
    map: ctx.setup.map, defs: ctx.setup.defs,
    room: null, snap: null, snapAt: 0,
    players: new Map(), sel: null,
  };
  let screen = ''; // 'lobby' (the shell shows its lobby), 'game' or 'end'

  const me = () => st.players.get(ctx.you);
  const isHost = () => st.room && st.room.host === ctx.you;
  const purse = () => st.snap?.purses?.[ctx.you] ?? 0;
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
    for (const s of ['game', 'end']) $('s-' + s).hidden = s !== name;
    $('s-end').classList.toggle('won', !!st.room?.end?.won);
    $('s-end').classList.toggle('lost', !!st.room && !st.room.end?.won);
    if (name === 'game') { map.start(); map.resize(); ctx.wake(true); } else { map.stop(); ctx.wake(false); }
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
    if (screen === 'game') { renderTop(); renderUnder(); renderActions(); updatePanel(); }
    if (screen === 'end') renderEnd();
    if (!$('giftSheet').hidden) renderGift();
    syncPerks();
  }

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
    if (lastLives != null && lives < lastLives) { bump($('tLives'), 'hurt'); ctx.buzz(60); }
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
  $('readyBtn').onclick = () => { ctx.send({ t: 'ready', ready: !me()?.ready }); ctx.buzz(10); };

  // ---------------------------------------------------------------- snapshots
  function onSnap(m) {
    st.snap = m;
    st.snapAt = performance.now();
    unacked = 0;
    for (const e of m.ev || []) onEvent(e);
    if (!st.room) return;
    if (screen === 'game') { renderTop(); renderUnder(); updatePanel(); }
    if (!$('giftSheet').hidden) updateGiftAmts();
    const k = panelKey();
    if (k !== shownKey) renderPanel();
  }

  function onEvent(e) {
    const d = st.defs;
    switch (e.e) {
      case 'build': if (e.pid === ctx.you) { ctx.toast(`Built ${d.towers[e.kind]?.name || e.kind}`); ctx.buzz(20); } break;
      case 'upgrade': if (e.pid === ctx.you) { ctx.toast(`Upgraded to level ${e.lvl}`); ctx.buzz(20); } break;
      case 'sell': if (e.pid === ctx.you) { ctx.toast(`Sold for ${e.refund} cogs`); ctx.buzz(20); } break;
      case 'gift':
        if (e.from === ctx.you) ctx.toast(`Sent ${e.amount} cogs to ${pname(e.to)}`);
        else if (e.to === ctx.you) { ctx.toast(`${pname(e.from)} sent you ${e.amount} cogs`); ctx.buzz([15, 30, 15]); }
        break;
      case 'perk': if (e.pid === ctx.you) { ctx.toast(`Perk: ${d.perks?.[e.id]?.name || e.id}`); ctx.buzz(20); } break;
      case 'wave_clear': ctx.toast(`Wave ${e.wave} cleared! +${e.bonus} cogs`); break;
      case 'wave_start': ctx.buzz(40); break;
    }
  }

  // ---------------------------------------------------------------- map
  const landscape = matchMedia('(orientation: landscape) and (max-height: 560px)');
  const onLandscape = () => map.resize();
  landscape.addEventListener?.('change', onLandscape);
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
    ctx.buzz(5);
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
            ctx.send({ t: 'build', plot: st.sel, kind });
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
    const own = t.owner === ctx.you;
    const owner = st.players.get(t.owner);
    refs.up = h('button', { class: 'btn', type: 'button', onclick: () => { ctx.send({ t: 'upgrade', plot: st.sel }); } });
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
          } else { sellArmed = false; clearTimeout(sellTimer); ctx.send({ t: 'sell', plot: st.sel }); }
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
        h('div', {}, h('div', { class: 'nm' }, def.name), h('div', { class: 'sub' }, `Level ${t.lvl} · ${own ? 'yours' : t.owner === '' ? 'no owner' : owner?.name || '?'} · ${statStr(lv, ['dmg', 'rate', 'range', 'slow'])}`)),
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
    ctx.buzz(6);
    updateGauge();
    if (!windTimer) windTimer = setTimeout(flushWind, Math.max(0, 150 - (performance.now() - lastSend)));
  }
  function flushWind() {
    clearTimeout(windTimer); windTimer = null;
    if (pending > 0 && windPlot != null) {
      ctx.send({ t: 'wind', plot: windPlot, n: Math.min(100, pending) });
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
    const others = st.room.players.filter((p) => p.id !== ctx.you);
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
    ctx.send({ t: 'gift', to: giftTo, amount: amt });
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
    const s = end?.stats?.[ctx.you] || {};
    const tiles = [['kills', 'Kills'], ['dmg', 'Damage'], ['spent', 'Spent'], ['winds', 'Winds'], ['built', 'Built'], ['gifted', 'Gifted']];
    $('endMine').replaceChildren(...tiles.map(([k, l]) => h('div', {}, h('b', {}, Math.round(s[k] || 0)), h('span', {}, l))));
    $('endAwards').replaceChildren(...(end?.awards || []).map((a) => h('div', { class: 'award' + (a.pid === ctx.you ? ' me' : '') },
      h('i', { class: 'dot', style: `background:${st.players.get(a.pid)?.color || '#999'}` }),
      h('div', {}, h('div', { class: 'at' }, a.title), h('div', { class: 'ad' }, a.detail)),
      h('div', { class: 'ap' }, a.pid === ctx.you ? 'You' : pname(a.pid)))));
    const pk = Object.entries(me()?.perks || {}).filter(([, n]) => n > 0).map(([id, n]) => h('span', { class: 'pkc' + (d.perks?.[id]?.rare ? ' rare' : '') }, perkName(id) + (n > 1 ? ` ×${n}` : '')));
    const ep = $('endPerks');
    ep.hidden = !pk.length;
    ep.replaceChildren(...(pk.length ? [h('div', { class: 'ttl' }, 'Your perks'), h('div', { class: 'pkcs' }, pk)] : []));
    $('againBtn').hidden = !isHost();
    $('againWait').hidden = isHost();
    $('againWait').textContent = `Waiting for ${pname(st.room.host)} to play again…`;
  }
  $('againBtn').onclick = () => ctx.send({ t: 'restart' });

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
          picked = id; ctx.send({ t: 'perk', id }); ctx.buzz(15); renderOffer();
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
  let menuView = 'main'; // 'main' | 'kick' (host: pick a player to remove)
  function openMenu() { armed = null; menuView = 'main'; $('menuSheet').hidden = false; renderMenu(); }
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
    if (!isHost()) menuView = 'main';
    if (menuView === 'kick') {
      // Remove a player: one confirm button per other player; the server closes their phone.
      const others = st.room.players.filter((p) => p.id !== ctx.you);
      const rows = others.map((p) => confirmItem('kick:' + p.id, h('span', { class: 'who' }, h('i', { class: 'dot', style: `background:${p.color}` }), p.name, p.connected ? '' : h('small', {}, ' (offline)')),
        `Remove ${p.name}? Their towers stay.`, true, () => { armed = null; menuView = 'main'; $('menuSheet').hidden = true; ctx.send({ t: 'kick', id: p.id }); }));
      $('menuBody').replaceChildren(h('div', { class: 'ttl' }, 'Remove a player'),
        h('div', { class: 'mrow kickrow' }, rows.length ? rows : [h('p', { class: 'dim small' }, 'No one else is here.')]),
        h('div', { class: 'mrow' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { armed = null; menuView = 'main'; renderMenu(); } }, 'Back')));
      return;
    }
    const items = [];
    if (isHost()) {
      items.push(h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { $('menuSheet').hidden = true; ctx.send({ t: 'pause', on: true }); } }, 'Pause game'));
      if (st.room.players.length > 1) items.push(h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { armed = null; menuView = 'kick'; renderMenu(); } }, 'Remove a player…'));
      items.push(confirmItem('end', 'End game', 'End the game for everyone?', true, () => { armed = null; $('menuSheet').hidden = true; ctx.send({ t: 'restart' }); }));
    }
    items.push(confirmItem('leave', 'Leave game', 'Leave this game?', true, () => { $('menuSheet').hidden = true; ctx.leave(); }));
    $('menuBody').replaceChildren(h('div', { class: 'ttl' }, 'Your perks'), perks, h('div', { class: 'mrow' }, items));
  }


  // ---------------------------------------------------------------- shell hooks
  map.setMap();

  return {
    onRoom,
    onSnap,
    onStatus(s) { if (s === 'replaced') flushWind(); },
    onError() { if (picked) { picked = null; if (!$('perkSheet').hidden) renderOffer(); } },
    unmount() {
      map.destroy();
      landscape.removeEventListener?.('change', onLandscape);
      for (const t of [windTimer, deferTimer, sellTimer, armTimer]) clearTimeout(t);
      ctx.wake(false);
    },
  };
}

