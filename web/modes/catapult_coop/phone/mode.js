// catapult_coop on the phone: a controller without a map, so eyes stay on the TV. Who you are
// (colour, name, what you carry), a diamond d-pad whose arrows match the TV's isometric diagonals
// (one tap = move one cell that way; with Throw armed, throw that way), action buttons that ask
// with chips when there is a real choice, and the committed plan in words ("Move ↖"). No hints
// or predictions: the team reads the TV and talks. Also: countdown and who has committed, "watch
// the TV" during resolve, perks and Ready in the break, the end screen, the ⋯ menu, and the Open
// plans switch in the shell's lobby.
// Contract: web/modes/README.md. Wire: docs/PROTOCOL.md, "Mode `catapult_coop`".
import { options } from './rules.js';
import { $, h } from '/shared/dom.js';

const HTML = `
  <section id="ccGame" class="screen ccgame" hidden>
    <header id="ccTop" class="plate cctop">
      <div class="ccident">
        <i id="ccSw" class="ccswatch"></i>
        <div class="ccidt"><b id="ccName"></b><span id="ccCarry"></span></div>
      </div>
      <div class="cclvl"><small id="ccLvlName">Level</small><b id="ccLvl">1/6</b></div>
      <div class="cctimer" id="ccTimerBox"><small id="ccTimerLbl">Plan</small><b id="ccTimer"></b></div>
      <button id="ccMenuBtn" class="menubtn" type="button" aria-label="Menu">&#8943;</button>
      <i id="ccTbar" class="cctbar"></i>
    </header>
    <div id="ccPad" class="ccpad">
      ${['nw', 'ne', 'sw', 'se'].map((d) => `<button class="btn ccarrow ${d}" type="button" data-dir="${d}"><span class="arw"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 22 13h-6v8.5H8V13H2z"/></svg></span></button>`).join('')}
      <div id="ccHub" class="cchub"><b></b><small></small></div>
    </div>
    <div id="ccResolve" class="ccover" hidden><div class="gear spin">&#9881;</div><b class="display">Watch the TV</b><span>Everyone's moves are playing out</span></div>
    <button id="ccAway" class="ccover away" type="button" hidden><b class="display">You sat down</b><span>Tap to rejoin. Picking any action stands you back up.</span></button>
    <div id="ccState" class="ccstate">
      <span id="ccStateTxt"></span>
      <button id="ccClear" class="btn sm ghost" type="button" hidden>Withdraw</button>
      <button id="ccCancel" class="btn sm ghost" type="button" hidden>Cancel</button>
    </div>
    <div id="ccChips" class="ccchips" hidden></div>
    <div id="ccBtns" class="ccbtns">
      <button class="btn ccact" type="button" data-act="pickup"><b>Pick up</b><small></small></button>
      <button class="btn ccact" type="button" data-act="throw"><b>Throw</b><small></small></button>
      <button class="btn ccact" type="button" data-act="load"><b>Load</b><small></small></button>
      <button class="btn ccact" type="button" data-act="loadfire" hidden><b>Load + fire</b><small></small></button>
      <button class="btn ccact" type="button" data-act="fire"><b>Fire</b><small></small></button>
      <button class="btn ccact ghost" type="button" data-act="wait"><b>Wait</b><small>stay put</small></button>
    </div>
    <div id="ccWho" class="ccwho"></div>
  </section>

  <section id="ccBreak" class="screen ccbreak" hidden>
    <div class="cchead">
      <h1 id="ccBrTitle" class="display"></h1>
      <p id="ccBrSub" class="dim"></p>
    </div>
    <div class="ccperks">
      <div class="ttl" id="ccPerkTtl">Pick a perk (optional)</div>
      <div id="ccPerkCards" class="perk-cards"></div>
    </div>
    <div class="ccbrfoot">
      <button id="ccReady" class="btn big-btn" type="button">Ready</button>
      <div class="ccbrinfo"><span id="ccBrTimer" class="dim"></span><div id="ccBrWho" class="ccwho"></div></div>
    </div>
    <button id="ccMenuBtn2" class="menubtn ccmenu2" type="button" aria-label="Menu">&#8943;</button>
  </section>

  <section id="ccEnd" class="screen ccend" hidden>
    <h1 id="ccEndTitle" class="display"></h1>
    <p id="ccEndSub" class="dim center-text"></p>
    <div id="ccEndMine" class="plate mine"></div>
    <div id="ccEndPerks" class="perklist" hidden></div>
    <div id="ccEndAwards" class="awards"></div>
    <div class="lobby-foot">
      <button id="ccAgain" class="btn big-btn" type="button" hidden>Back to lobby</button>
      <p id="ccAgainWait" class="dim center-text" hidden></p>
    </div>
  </section>

  <div id="ccMenu" class="sheet" hidden>
    <div class="sheet-body plate">
      <div class="sheet-head"><b class="display">Menu</b><button id="ccMenuClose" class="x" aria-label="Close">&times;</button></div>
      <div id="ccMenuBody" class="menu-body"></div>
    </div>
  </div>
`;

const ACT_KEY = { pickup: 'pickup', throw: 'throw', load: 'load', loadfire: 'load', fire: 'fire' };
const PLAN_ERR = new Set(['bad_plan', 'too_late', 'bad_request']);
// The d-pad, in the TV's isometric view: grid (x, y) is drawn at ((x - y)·TW/2, (x + y)·TH/2),
// so -x is up-left, -y up-right, +x down-right and +y down-left on the TV.
const PAD = [
  { id: 'nw', d: [-1, 0], g: '↖' },
  { id: 'ne', d: [0, -1], g: '↗' },
  { id: 'sw', d: [0, 1], g: '↙' },
  { id: 'se', d: [1, 0], g: '↘' },
];
const padOf = (dx, dy) => PAD.find((p) => p.d[0] === Math.sign(dx) && p.d[1] === Math.sign(dy)) || null;
// glyphs for an offset: one arrow per cell along each axis ("↖↗" for (-1, -1)); '' for (0, 0)
const glyphs = (dx, dy) => (dx < 0 ? '↖' : '↘').repeat(Math.abs(dx)) + (dy < 0 ? '↗' : '↙').repeat(Math.abs(dy));
const BOMB_COLORS = { keg: '#b5743a', grapeshot: '#9aa6aa', stopwatch: '#7fd4ff' };
const bombColor = (kind) => BOMB_COLORS[kind] || '#ccc';

export async function mount(ctx) {
  await ctx.loadCSS(new URL('./phone.css', import.meta.url).href);
  ctx.el.insertAdjacentHTML('beforeend', HTML);

  const defs = ctx.setup.defs;
  // light haptics, only once the page has had a tap (browsers refuse vibrate before that)
  const buzz = (p) => { if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; ctx.buzz(p); };
  const st = {
    room: null, players: new Map(), initials: new Map(),
    snap: null, snapAt: 0, held: null, // held: last snap outside resolve (what I carried while the TV plays it out)
  };
  // My plan for the current round. The server only tells us `planned`, so we remember what we sent.
  // state: 'none' | 'pending' (sent, not confirmed) | 'committed'
  let plan = { key: '', cmd: null, state: 'none', prev: null, sentAt: 0 };
  let mode = null; // action waiting for a target: 'pickup' | 'throw' | 'load' | 'loadfire' | 'fire'
  let opts = options({});
  let screen = '';
  let awayDismissed = false;
  let feedback = []; // [{msg, bad}] about me from the last resolve, shown when it ends
  let picked = null; // perk card tapped, awaiting the server
  let timers = [];

  const me = () => st.players.get(ctx.you);
  const isHost = () => st.room?.host === ctx.you;
  const pname = (id) => st.players.get(id)?.name || '?';
  const keep = () => ctx.setup.map.keeps.find((k) => k.id === st.room?.keep) || null;
  const roundKey = () => (st.room ? `${st.room.level}:${st.room.round}` : '');
  const inPlan = () => st.room?.phase === 'plan' && st.snap?.phase !== 'resolve';
  const myEng = () => st.snap?.engineers?.find((e) => e.pid === ctx.you) || null;
  const boardSnap = () => (st.snap?.phase === 'resolve' && st.held ? st.held : st.snap);
  const awayShown = () => inPlan() && !!me()?.away && !awayDismissed;
  const perkName = (id) => defs.perks?.[id]?.name || id;
  const bombName = (k) => defs.bombs?.[k]?.name || k;
  const levelDef = (lv) => defs.levels?.[lv - 1];

  const samePlan = (a, b) => !!a && !!b && a.a === b.a && (a.a === 'throw' ? a.dx === b.dx && a.dy === b.dy
    : a.a === 'load' || a.a === 'fire' ? a.cat === b.cat && !!a.fire === !!b.fire : a.x === b.x && a.y === b.y);

  // My plan to show: what this phone sent, or the server's copy (open plans) when it differs.
  function myPlan() {
    const p = me();
    const local = plan.key === roundKey() && plan.cmd && (p?.planned || plan.state === 'pending') ? plan.cmd : null;
    return p?.plan && !samePlan(local, p.plan) ? p.plan : local;
  }
  // remember the plan across a reload of the page (the server only says `planned`)
  const PLAN_STORE = `cc.plan:${ctx.room}`;
  function savePlan() {
    try { sessionStorage.setItem(PLAN_STORE, JSON.stringify({ you: ctx.you, key: plan.key, cmd: plan.cmd })); } catch { /* storage blocked */ }
  }
  function storedPlan() {
    try {
      const v = JSON.parse(sessionStorage.getItem(PLAN_STORE) || 'null');
      return v && v.you === ctx.you && v.key === roundKey() && v.cmd ? v.cmd : null;
    } catch { return null; }
  }
  const committed = () => !!me()?.planned || (plan.state === 'pending' && plan.key === roundKey());

  // ---------------------------------------------------------------- planning
  function recompute() {
    const r = st.room;
    const e = myEng();
    const k = keep();
    if (!r || !e || !k || r.phase !== 'plan' || st.snap?.phase !== 'plan') { opts = options({}); return; }
    opts = options({
      lay: r.layout, keep: k, me: e, can: me()?.can, bombs: st.snap.bombs,
      cats: new Map(st.snap.catapults.map((c) => [c.id, c.bomb])),
    });
    if (mode && !(opts[ACT_KEY[mode]] || []).length) mode = null;
  }

  function commitTarget(kind, t) {
    let cmd;
    switch (kind) {
      case 'move': cmd = { a: 'move', x: t.x, y: t.y }; break;
      case 'pickup': cmd = { a: 'pickup', x: t.x, y: t.y }; break;
      case 'throw': cmd = { a: 'throw', dx: t.dx, dy: t.dy }; break;
      case 'load': cmd = { a: 'load', cat: t.cat }; break;
      case 'loadfire': cmd = { a: 'load', cat: t.cat, fire: true }; break;
      case 'fire': cmd = { a: 'fire', cat: t.cat }; break;
      default: return;
    }
    send(cmd);
  }
  function send(cmd) {
    const prev = { key: plan.key, cmd: plan.cmd, state: plan.state };
    plan = { key: roundKey(), cmd, state: 'pending', prev, sentAt: performance.now() };
    if (cmd.a === 'clear') plan = { key: roundKey(), cmd: null, state: 'none', prev, sentAt: performance.now() };
    ctx.send({ t: 'plan', ...cmd });
    savePlan();
    if (cmd.a !== 'clear') buzz(18);
    awayDismissed = true;
    mode = null;
    renderSide();
  }

  function setMode(m) {
    mode = m;
    if (m) buzz(6);
    renderSide();
  }

  function onAction(act) {
    if (!inPlan() || !myEng()) return;
    if (awayShown()) dismissAway();
    if (act === 'wait') { send({ a: 'wait' }); return; }
    const list = opts[ACT_KEY[act]] || [];
    if (!list.length) return;
    if (mode === act) { setMode(null); return; }
    // a single choice commits at once; Throw always waits for its arrow
    if (list.length === 1 && act !== 'throw') { commitTarget(act, list[0]); return; }
    setMode(act);
  }
  for (const b of $('ccBtns').querySelectorAll('[data-act]')) b.onclick = () => onAction(b.dataset.act);
  $('ccCancel').onclick = () => setMode(null);
  $('ccClear').onclick = () => { if (inPlan()) send({ a: 'clear' }); };

  // ---------------------------------------------------------------- the d-pad
  // The one place that decides whether an arrow can be tapped: only when the action is flatly
  // illegal (a wall, crate or ledge that way; no cell at all to throw onto) is it greyed out.
  // A "never grey anything" mode would return true after the first line.
  function arrowEnabled(d) {
    if (!inPlan() || !myEng() || awayShown()) return false;
    return (mode === 'throw' ? opts.throw : opts.move).some((q) => q.dx === d[0] && q.dy === d[1]);
  }
  // One tap on an arrow: move one cell that way, or, while Throw is armed, throw that way.
  function onArrow(id) {
    const p = PAD.find((q) => q.id === id);
    const e = myEng();
    if (!p || !e || !arrowEnabled(p.d)) return;
    const [dx, dy] = p.d;
    if (mode === 'throw') commitTarget('throw', { dx, dy });
    else commitTarget('move', { x: e.x + dx, y: e.y + dy });
  }
  for (const b of $('ccPad').querySelectorAll('[data-dir]')) b.onclick = () => onArrow(b.dataset.dir);
  $('ccAway').onclick = dismissAway;

  function renderPad() {
    const e = myEng();
    const throwing = mode === 'throw';
    const cur = myPlan();
    const isC = committed();
    $('ccPad').classList.toggle('throwing', throwing);
    for (const b of $('ccPad').querySelectorAll('[data-dir]')) {
      const p = PAD.find((q) => q.id === b.dataset.dir);
      const chosen = isC && cur && e && !throwing && (
        (cur.a === 'move' && cur.x - e.x === p.d[0] && cur.y - e.y === p.d[1])
        || (cur.a === 'throw' && cur.dx === p.d[0] && cur.dy === p.d[1]));
      b.disabled = !arrowEnabled(p.d);
      b.classList.toggle('chosen', !!chosen);
    }
    const hub = $('ccHub');
    hub.style.setProperty('--c', me()?.color || '#999');
    hub.querySelector('b').textContent = st.initials.get(ctx.you) || '';
    hub.querySelector('small').textContent = throwing ? 'throw' : inPlan() && e ? 'move' : '';
  }

  // chips: the choices of an armed pick-up / load / fire when there is more than one
  function renderChips() {
    const box = $('ccChips');
    const e = myEng();
    let items = [];
    if (mode === 'pickup' && e) {
      items = opts.pickup.map((t) => ({
        key: `p${t.x},${t.y}`, main: bombName(t.bomb.kind), gl: glyphs(t.x - e.x, t.y - e.y), sub: t.x === e.x && t.y === e.y ? 'under you' : '',
        dot: bombColor(t.bomb.kind), fn: () => commitTarget('pickup', t),
      }));
    } else if ((mode === 'load' || mode === 'loadfire' || mode === 'fire') && e) {
      items = (opts[ACT_KEY[mode]] || []).map((t) => ({
        key: `c${t.cat}`, main: 'Catapult', gl: glyphs(t.x - e.x, t.y - e.y),
        sub: mode === 'fire' ? `${bombName(t.bomb?.kind)} loaded` : 'empty', fn: () => commitTarget(mode, t),
      }));
    }
    const key = mode + '|' + items.map((i) => i.key + i.main + i.gl + i.sub).join(';');
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    // (the question itself is in the state line)
    box.replaceChildren(...items.map((i) => h('button', { class: 'btn ccchip', type: 'button', onclick: i.fn },
      h('b', {}, i.dot ? h('i', { class: 'ccbomb', style: `--c:${i.dot}` }) : null, i.main, i.gl ? h('span', { class: 'gl' }, i.gl) : null),
      i.sub ? h('small', {}, i.sub) : null)));
  }

  function dismissAway() {
    awayDismissed = true;
    ctx.toast('Pick any action to stand back up');
    renderSide();
  }

  // ---------------------------------------------------------------- screens
  function show(name) {
    if (screen === name) return;
    screen = name;
    $('ccGame').hidden = name !== 'game';
    $('ccBreak').hidden = name !== 'break';
    $('ccEnd').hidden = name !== 'end';
    ctx.wake(name === 'game' || name === 'break');
    if (name !== 'game' && name !== 'break') $('ccMenu').hidden = true;
  }

  function onRoom(m) {
    const prev = st.room;
    st.room = m;
    st.players = new Map(m.players.map((p) => [p.id, p]));
    computeInitials();
    const ph = m.phase;
    // a new round (or level) began
    if (ph === 'plan' && (!prev || prev.phase !== 'plan' || prev.round !== m.round || prev.level !== m.level)) {
      mode = null;
      if (plan.key !== roundKey()) {
        // a reload mid-plan: take back what this phone had sent, if the server still has a plan
        const kept = !prev && me()?.planned ? storedPlan() : null;
        plan = { key: roundKey(), cmd: kept, state: kept ? 'committed' : 'none', prev: null, sentAt: 0 };
      }
      if (prev && prev.phase !== 'lobby') buzz(30);
    }
    if (ph !== 'plan') mode = null;
    if (prev?.phase === 'resolve' && ph !== 'resolve') flushFeedback();
    if (ph === 'lobby') { st.snap = null; st.held = null; plan = { key: '', cmd: null, state: 'none', prev: null, sentAt: 0 }; feedback = []; picked = null; }
    // confirm or drop my plan from `planned`
    const p = me();
    if (plan.key === roundKey() && ph === 'plan') {
      if (p?.planned && plan.state === 'pending') plan.state = 'committed';
      else if (!p?.planned && plan.state === 'committed') plan = { key: roundKey(), cmd: null, state: 'none', prev: null, sentAt: 0 };
      else if (!p?.planned && plan.state === 'pending' && performance.now() - plan.sentAt > 2500) plan.state = 'none';
    }
    if (!p?.away) awayDismissed = false;
    if (ph === 'break' && prev?.phase !== 'break') picked = null;
    render();
  }

  function render() {
    const r = st.room;
    if (!r) return;
    const ph = r.phase;
    show(ph === 'lobby' ? 'lobby' : ph === 'won' || ph === 'lost' ? 'end' : ph === 'break' ? 'break' : 'game');
    recompute();
    if (screen === 'game') renderSide();
    if (screen === 'break') renderBreak();
    if (screen === 'end') renderEnd();
    if (!$('ccMenu').hidden) renderMenu();
  }

  function computeInitials() {
    const first = (n) => (n || '?').trim().charAt(0).toUpperCase() || '?';
    const count = new Map();
    for (const p of st.room.players) count.set(first(p.name), (count.get(first(p.name)) || 0) + 1);
    st.initials = new Map(st.room.players.map((p) => {
      const f = first(p.name);
      return [p.id, count.get(f) > 1 ? f + (p.name.trim().charAt(1) || '') : f];
    }));
  }

  // ---------------------------------------------------------------- snaps and events
  function onSnap(m) {
    st.snap = m;
    st.snapAt = performance.now();
    if (m.phase !== 'resolve') st.held = m;
    for (const e of m.ev || []) onEvent(e);
    if (m.phase !== 'resolve' && feedback.length) flushFeedback();
    if (!st.room) return;
    if (screen === 'game') { recompute(); renderSide(); }
    if (screen === 'break') renderBreak();
  }

  function say(msg, bad = false, now = false) {
    feedback.push({ msg, bad });
    if (now && st.snap?.phase !== 'resolve') flushFeedback();
  }
  function flushFeedback() {
    if (!feedback.length) return;
    const bad = feedback.some((f) => f.bad);
    ctx.toast(feedback.map((f) => f.msg).join(' · '), bad ? 'err' : 'ok', 3200);
    if (bad) buzz([25, 40, 25]);
    feedback = [];
  }

  function onEvent(e) {
    const you = ctx.you;
    switch (e.e) {
      case 'throw':
        if (e.pid === you) {
          if (e.result === 'caught') say(e.by === you ? 'You caught your own throw' : `${pname(e.by)} caught your ${bombName(e.kind)}`);
          else if (e.result === 'blocked') say(`${pname(e.by)}'s hands were full: your ${bombName(e.kind)} dropped at their feet`, true);
          else say(`Your ${bombName(e.kind)} landed`);
        } else if (e.by === you) {
          if (e.result === 'blocked') say(`Your hands were full: ${pname(e.pid)}'s ${bombName(e.kind)} dropped at your feet`, true);
          else say(`Caught a ${bombName(e.kind)} from ${pname(e.pid)}!`);
        }
        break;
      case 'move':
        if (e.pid === you && e.result === 'bump') say('Bumped! You stayed put', true);
        break;
      case 'pickup':
        if (e.pid !== you) break;
        if (e.result === 'ok') say(`Picked up a ${bombName(e.kind)}`);
        else if (e.result === 'contested') say('Someone else grabbed for it too: nobody got it', true);
        else if (e.result === 'hands_full') say('Hands full: no pick-up', true);
        else say('The bomb was gone', true);
        break;
      case 'load':
        if (e.pid !== you) break;
        if (e.result === 'ok') say(`Loaded a ${bombName(e.kind)}`);
        else if (e.result === 'contested') say('Two loaders, one catapult: neither loaded', true);
        else say('Load fizzled', true);
        break;
      case 'fire':
        if (e.pid !== you) break;
        if (e.result === 'ok') {
          const kills = e.hits.filter((x) => x.killed).length;
          say(kills ? `Boom! ${kills} machine${kills > 1 ? 's' : ''} destroyed` : e.hits.length ? `Hit ${e.hits.length} machine${e.hits.length > 1 ? 's' : ''}` : 'Fired');
        } else if (e.result === 'wasted') say('Fired into an empty lane', true);
        else say('Someone fired it first', true);
        break;
      case 'wall': { // one line for all the wall hits of a resolve
        const w = feedback.find((f) => f.wall != null);
        if (w) { w.wall += e.dmg; w.msg = `The wall took ${w.wall} damage`; } else feedback.push({ msg: `The wall took ${e.dmg} damage`, bad: true, wall: e.dmg });
        break;
      }
      case 'level_start': {
        const d = levelDef(e.level);
        say(`Level ${e.level}: ${e.name || d?.name || ''}`, false, true);
        break;
      }
      case 'level_clear':
        say(`Level ${e.level} cleared!`);
        break;
      case 'place':
        if (e.pid === you && st.room?.phase !== 'lobby' && st.snap?.phase === 'plan' && st.room?.round > 1) say('You are on the board', false, true);
        break;
      case 'perk':
        if (e.pid === you) { ctx.toast(`Perk: ${perkName(e.id)}`); buzz(20); } else if (e.id === 'mason' || defs.perks?.[e.id]?.team) ctx.toast(`${pname(e.pid)} repaired the wall`);
        break;
    }
  }

  // ---------------------------------------------------------------- side panel (game screen)
  function tick() {
    const r = st.room;
    const s = st.snap;
    if (!r || !s) return;
    const left = Math.max(0, s.left - (s.phase === 'plan' || s.phase === 'resolve' || s.phase === 'break' ? (performance.now() - st.snapAt) / 1000 : 0));
    if (screen === 'game') {
      const plan = s.phase === 'plan';
      $('ccTimerLbl').textContent = plan ? 'Plan' : s.phase === 'resolve' ? 'Resolve' : '';
      $('ccTimer').textContent = plan || s.phase === 'resolve' ? Math.ceil(left) + 's' : '';
      $('ccTimerBox').classList.toggle('hurry', plan && left <= 3.5);
      const tot = plan ? defs.planTime : s.phase === 'resolve' ? Math.max(left, 0.1) : 1;
      $('ccTbar').style.width = (plan ? Math.min(100, (left / tot) * 100) : 0).toFixed(1) + '%';
      $('ccTbar').classList.toggle('hurry', plan && left <= 3.5);
    }
    if (screen === 'break') $('ccBrTimer').textContent = s.phase === 'break' ? `Next level in ${Math.ceil(left)}s` : '';
  }
  timers.push(setInterval(tick, 200));

  function renderSide() {
    const r = st.room;
    if (!r || screen !== 'game') return;
    const p = me();
    const e = myEng();
    $('ccLvlName').textContent = `Level ${r.level}/${r.levels}`;
    $('ccLvl').textContent = r.round ? `Rd ${r.round}` : '';
    const resolving = r.phase === 'resolve' || st.snap?.phase === 'resolve';
    $('ccResolve').hidden = !resolving;
    $('ccAway').hidden = !awayShown();
    $('ccGame').classList.toggle('resolving', resolving);
    tick();

    // who I am and what I carry
    $('ccSw').style.background = p?.color || '#999';
    $('ccSw').textContent = st.initials.get(ctx.you) || '';
    $('ccName').textContent = p?.name || '';
    const carry = (st.snap?.phase === 'resolve' ? boardSnap() : st.snap)?.engineers?.find((q) => q.pid === ctx.you)?.carry;
    const ckey = carry ? carry.kind : e ? '-' : '?';
    if ($('ccCarry').dataset.key !== ckey) {
      $('ccCarry').dataset.key = ckey;
      $('ccCarry').replaceChildren(...(carry
        ? [h('i', { class: 'ccbomb', style: `--c:${bombColor(carry.kind)}` }), `carrying ${bombName(carry.kind)}`]
        : [e ? 'empty hands' : 'not on the board yet']));
    }

    // state line
    let txt;
    const cur = myPlan();
    const isC = committed();
    if (resolving) txt = 'Watch the TV';
    else if (!e) txt = 'No engineer yet: you join at the next free spot';
    else if (awayShown()) txt = 'You sat down';
    else if (mode) txt = { pickup: 'Pick up which bomb?', throw: 'Throw which way? Tap an arrow', load: 'Load which catapult?', loadfire: 'Load and fire which catapult?', fire: 'Fire which catapult?' }[mode];
    else if (plan.state === 'pending' && plan.key === roundKey() && !p?.planned) txt = `Sending ${planText(cur)}…`;
    else if (isC) txt = cur ? `Committed ✓ ${planText(cur)} · tap anything to change` : 'Committed ✓ · tap anything to change';
    else if (me()?.away) txt = 'Pick any action to stand up';
    else txt = 'Tap an arrow to move one cell, or pick an action';
    $('ccStateTxt').textContent = txt;
    $('ccState').classList.toggle('done', !!isC && !mode && !resolving);
    $('ccState').classList.toggle('picking', !!mode);
    $('ccCancel').hidden = !mode;
    $('ccClear').hidden = !(isC && !mode && !resolving && inPlan());

    // action buttons
    const can = p?.can;
    const live = inPlan() && !!e;
    const chosen = cur ? (cur.a === 'load' && cur.fire ? 'loadfire' : cur.a) : null;
    for (const b of $('ccBtns').querySelectorAll('[data-act]')) {
      const act = b.dataset.act;
      if (act === 'loadfire') b.hidden = !can?.quickHands;
      const list = act === 'wait' ? [1] : opts[ACT_KEY[act]] || [];
      b.disabled = !live || !list.length;
      b.classList.toggle('armed', mode === act);
      b.classList.toggle('chosen', chosen === act && isC);
      const sub = b.querySelector('small');
      if (act !== 'wait') sub.textContent = live ? subLabel(act, list) : '';
    }
    // the choices of an armed pick-up / load / fire replace the buttons
    const chips = !!mode && mode !== 'throw' && live;
    $('ccChips').hidden = !chips;
    $('ccBtns').classList.toggle('under', chips);
    if (chips) renderChips();
    renderPad();
    renderWho($('ccWho'), 'plan');
  }

  // "Move ↖", "Throw ↗", "Load ↖"... the plan in words and the TV's arrows
  function planText(pl) {
    if (!pl) return '';
    const e = myEng();
    const at = (x, y) => (e ? glyphs(x - e.x, y - e.y) : '');
    switch (pl.a) {
      case 'move': return `Move ${at(pl.x, pl.y)}`;
      case 'pickup': {
        const bm = st.snap?.bombs?.find((b) => b.x === pl.x && b.y === pl.y);
        return `Pick up ${bm ? bombName(bm.kind) + ' ' : ''}${at(pl.x, pl.y) || 'here'}`;
      }
      case 'throw': return `Throw ${padOf(pl.dx, pl.dy)?.g || ''}`;
      case 'load':
      case 'fire': {
        const c = keep()?.catapults.find((q) => q.id === pl.cat);
        const g = c ? at(c.x, c.y) : '';
        return `${pl.a === 'fire' ? 'Fire' : pl.fire ? 'Load + fire' : 'Load'} ${g}`.trim();
      }
      case 'wait': return 'Wait';
    }
    return '';
  }

  function subLabel(act, list) {
    if (!list.length) {
      const e = myEng();
      if (act === 'pickup') return e?.carry ? 'hands full' : 'no bomb in reach';
      if (act === 'throw') return e?.carry ? 'no way to throw' : 'carry a bomb first';
      if (act === 'load' || act === 'loadfire') return e?.carry ? 'stand by an empty catapult' : 'carry a bomb first';
      if (act === 'fire') return 'stand by a loaded catapult';
      return '';
    }
    if (act === 'throw') return 'then an arrow';
    if (list.length > 1) return `${list.length} to choose`;
    const t = list[0];
    if (act === 'pickup') return bombName(t.bomb.kind);
    if (act === 'fire') return bombName(t.bomb?.kind);
    if (act === 'load' || act === 'loadfire') return bombName(myEng()?.carry?.kind);
    return '';
  }

  function renderWho(box, what) {
    const r = st.room;
    const placed = new Set((st.snap?.engineers || []).map((e) => e.pid));
    const key = r.players.map((p) => [p.id, p.planned, p.ready, p.away, p.connected, placed.has(p.id)].join()).join('|') + what;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.classList.toggle('many', r.players.length > 4);
    box.replaceChildren(...r.players.map((p) => {
      const ok = what === 'plan' ? p.planned : p.ready;
      const cls = 'who' + (ok ? ' ok' : '') + (p.away ? ' away' : '') + (p.id === ctx.you ? ' me' : '');
      return h('span', { class: cls, title: p.name },
        h('i', { class: 'dot', style: `background:${p.color}` }, st.initials.get(p.id) || ''),
        h('span', { class: 'nm' }, p.name),
        h('b', {}, p.away ? 'zz' : ok ? '✓' : '…'));
    }));
  }

  // ---------------------------------------------------------------- break: perks and ready
  function renderBreak() {
    const r = st.room;
    const s = st.snap;
    $('ccBrTitle').textContent = `Level ${r.level} cleared!`;
    const next = levelDef(r.level + 1);
    $('ccBrSub').textContent = `Wall ${s?.wall ?? '?'}/${s?.wallMax ?? defs.wallHP}` + (next ? ` · Next: ${next.name}. ${next.desc || ''}` : '');
    const p = me();
    const offer = p?.offer;
    const owned = p?.perks || {};
    const key = (offer || []).join(',') + '|' + picked + '|' + JSON.stringify(owned);
    if ($('ccPerkCards').dataset.key !== key) {
      $('ccPerkCards').dataset.key = key;
      if (offer?.length) {
        $('ccPerkTtl').textContent = 'Pick a perk (optional)';
        $('ccPerkCards').replaceChildren(...offer.map((id) => {
          const def = defs.perks?.[id] || { name: id, desc: '' };
          return h('button', {
            class: 'pcard' + (def.team ? ' rare' : '') + (picked === id ? ' taken' : ''), type: 'button', 'data-id': id,
            disabled: picked != null && picked !== id,
            onclick: () => { if (picked) return; picked = id; ctx.send({ t: 'perk', id }); buzz(15); renderBreak(); },
          },
          def.team ? h('span', { class: 'rare-tag' }, 'TEAM') : null,
          h('span', { class: 'pn' }, def.name),
          h('span', { class: 'pd' }, def.desc),
          h('span', { class: 'pown' }, picked === id ? 'Taken ✓' : owned[id] ? `you have ${owned[id]}` : ''));
        }));
      } else {
        const mine = Object.keys(owned).filter((k) => owned[k] > 0);
        $('ccPerkTtl').textContent = mine.length ? 'Your perks' : 'No perk to pick';
        $('ccPerkCards').replaceChildren(h('div', { class: 'ccperkdone' }, mine.length
          ? mine.map((id) => h('div', {}, h('b', {}, perkName(id)), h('span', {}, defs.perks?.[id]?.desc || '')))
          : h('span', { class: 'dim' }, 'Nothing on offer this time.')));
      }
    }
    const ready = !!p?.ready;
    $('ccReady').classList.toggle('on', ready);
    $('ccReady').textContent = ready ? 'Ready ✓' : 'Ready';
    renderWho($('ccBrWho'), 'ready');
    tick();
  }
  $('ccReady').onclick = () => { ctx.send({ t: 'ready', ready: !me()?.ready }); buzz(12); };

  // ---------------------------------------------------------------- end screen
  function renderEnd() {
    const r = st.room;
    const end = r.end;
    const won = !!end?.won;
    $('ccEnd').classList.toggle('won', won);
    $('ccEnd').classList.toggle('lost', !won);
    $('ccEndTitle').textContent = won ? 'The Keep Holds!' : 'The Wall Has Fallen';
    const secs = Math.round(end?.time || 0);
    $('ccEndSub').textContent = `Level ${end?.level ?? r.level}/${r.levels} · ${end?.rounds ?? 0} rounds · wall ${end?.wall ?? 0} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const s = end?.stats?.[ctx.you] || {};
    const tiles = [['kills', 'Kills'], ['dmg', 'Damage'], ['fires', 'Fires'], ['loads', 'Loads'], ['throws', 'Throws'], ['catches', 'Catches'], ['pickups', 'Pick-ups'], ['steps', 'Steps'], ['bumps', 'Bumps']];
    $('ccEndMine').replaceChildren(...tiles.map(([k, l]) => h('div', {}, h('b', {}, Math.round(s[k] || 0)), h('span', {}, l))));
    $('ccEndAwards').replaceChildren(...(end?.awards || []).map((a) => h('div', { class: 'award' + (a.pid === ctx.you ? ' me' : '') },
      h('i', { class: 'dot', style: `background:${st.players.get(a.pid)?.color || '#999'}` }),
      h('div', {}, h('div', { class: 'at' }, a.title), h('div', { class: 'ad' }, a.detail)),
      h('div', { class: 'ap' }, a.pid === ctx.you ? 'You' : pname(a.pid)))));
    const pk = Object.entries(s.perks || me()?.perks || {}).filter(([, n]) => n > 0).map(([id, n]) => h('span', { class: 'pkc' }, perkName(id) + (n > 1 ? ` ×${n}` : '')));
    $('ccEndPerks').hidden = !pk.length;
    $('ccEndPerks').replaceChildren(...(pk.length ? [h('div', { class: 'ttl' }, 'Your perks'), h('div', { class: 'pkcs' }, pk)] : []));
    $('ccAgain').hidden = !isHost();
    $('ccAgainWait').hidden = isHost();
    $('ccAgainWait').textContent = `Waiting for ${pname(r.host)} to go back to the lobby…`;
  }
  $('ccAgain').onclick = () => ctx.send({ t: 'restart' });

  // ---------------------------------------------------------------- menu
  let armed = null; let armTimer = null;
  const openMenu = () => { armed = null; $('ccMenu').hidden = false; renderMenu(); };
  $('ccMenuBtn').onclick = openMenu;
  $('ccMenuBtn2').onclick = openMenu;
  $('ccMenuClose').onclick = () => ($('ccMenu').hidden = true);
  $('ccMenu').addEventListener('click', (e) => { if (e.target === $('ccMenu')) $('ccMenu').hidden = true; });
  function renderMenu() {
    const p = me();
    const can = p?.can;
    const owned = Object.entries(p?.perks || {}).filter(([, n]) => n > 0);
    const abil = can ? h('p', { class: 'ccabil' },
      [can.reach != null ? `Pick up from ${can.reach} cell${can.reach === 1 ? '' : 's'} away` : '', can.quickHands ? 'load and fire at once' : '']
        .filter(Boolean).join(' · ')) : null;
    const perks = owned.length
      ? h('ul', { class: 'myperks' }, owned.map(([id, n]) => h('li', {}, h('b', {}, perkName(id) + (n > 1 ? ` ×${n}` : '')), h('span', {}, defs.perks?.[id]?.desc || ''))))
      : null;
    const confirmItem = (key, label, ask, fn) => armed === key
      ? h('div', { class: 'confirm' }, h('span', {}, ask),
        h('button', { class: 'btn sm danger', type: 'button', onclick: fn }, 'Yes'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { armed = null; renderMenu(); } }, 'No'))
      : h('button', {
        class: 'btn sm ghost warn', type: 'button',
        onclick: () => { armed = key; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = null; if (!$('ccMenu').hidden) renderMenu(); }, 5000); renderMenu(); },
      }, label);
    const items = [];
    if (isHost()) items.push(confirmItem('end', 'End game', 'End the game for everyone?', () => { armed = null; $('ccMenu').hidden = true; ctx.send({ t: 'restart' }); }));
    items.push(confirmItem('leave', 'Leave game', 'Leave this game?', () => { $('ccMenu').hidden = true; ctx.leave(); }));
    $('ccMenuBody').replaceChildren(...[
      h('div', { class: 'ttl' }, 'You'), abil, perks,
      h('div', { class: 'mrow' }, items)].filter(Boolean));
  }

  // ---------------------------------------------------------------- lobby option (shell hook)
  function lobbyOptions(box, { isHost: host, room }) {
    const on = !!room?.openPlans;
    // rebuilt only on a change, so a tap is never lost to a re-render between touch start and end
    const key = `${host}|${on}`;
    if (box.dataset.ccKey === key && box.firstChild) return;
    box.dataset.ccKey = key;
    const sw = h('span', { class: 'ccsw' + (on ? ' on' : '') }, h('i'));
    const head = h('span', { class: 'ccoptl' }, h('b', {}, 'Open plans'), host ? sw : h('em', {}, on ? 'on' : 'off'));
    const expl = h('span', { class: 'ccopte' }, "Everyone's plan is shown as it is picked: good for learning.");
    const el = host
      ? h('button', { class: 'ccopt', type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', onclick: () => { ctx.send({ t: 'opt', openPlans: !on }); buzz(8); } }, head, expl)
      : h('div', { class: 'ccopt static' }, head, expl);
    box.replaceChildren(el);
  }

  // poke from the console / test drivers: where a button is on screen, what is legal now
  window.ccDebug = {
    opts: () => opts, plan: () => plan, mode: () => mode, keep, you: () => ctx.you, st,
    commit: commitTarget, // commit(kind, {x, y} | {dx, dy} | {cat}) without the legality checks, to try the server's
    // centre of a d-pad arrow ('nw' | 'ne' | 'sw' | 'se') or an element, in CSS pixels
    at(sel) {
      const el = PAD.some((p) => p.id === sel) ? $('ccPad').querySelector(`[data-dir="${sel}"]`) : document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2, !el.disabled && !el.closest('[hidden]')];
    },
    eng: myEng, myPlan, planText: () => planText(myPlan()),
  };

  return {
    onRoom,
    onSnap,
    onError(m) {
      if (picked && m.code === 'bad_request' && st.room?.phase === 'break') { picked = null; renderBreak(); return; }
      if (PLAN_ERR.has(m.code) && plan.prev && performance.now() - plan.sentAt < 5000) {
        const p = plan.prev;
        plan = p.key === roundKey() ? { ...p, prev: null, sentAt: 0 } : { key: roundKey(), cmd: null, state: 'none', prev: null, sentAt: 0 };
        savePlan();
        renderSide();
      }
    },
    lobbyOptions,
    unmount() {
      delete window.ccDebug;
      for (const t of timers) clearInterval(t);
      clearTimeout(armTimer);
      ctx.wake(false);
    },
  };
}
