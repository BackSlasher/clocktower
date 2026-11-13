// catapult_coop on the phone: a controller without a map, so eyes stay on the TV.
//
// A turn is a queue of up to `defs.slots` actions. The phone shows who you are (colour, name,
// what you carry), the queue as a strip of slots, a diamond d-pad whose arrows match the TV's
// isometric diagonals, and buttons for the other actions. Every edit sends the whole queue at
// once (`done: false`), so the TV shows it live; Done marks it finished. Nothing is greyed for
// legality and nothing is predicted: each action is judged when its slot comes up, and the team
// reads the TV and talks. During resolve the phone lights up the slot being played; afterwards it
// says what happened to you, fizzles included. Also: break (ready), end screen, ⋯ menu.
// Contract: web/modes/README.md. Wire: docs/PROTOCOL.md, "Mode `catapult_coop`".
import { $, h } from '/shared/dom.js';

// The d-pad, in the TV's isometric view: grid (x, y) is drawn at ((x - y)·TW/2, (x + y)·TH/2),
// so -x is up-left, -y up-right, +x down-right and +y down-left on the TV.
const PAD = [
  { id: 'nw', d: [-1, 0], g: '↖' },
  { id: 'ne', d: [0, -1], g: '↗' },
  { id: 'sw', d: [0, 1], g: '↙' },
  { id: 'se', d: [1, 0], g: '↘' },
];
const glyph = (dx, dy) => PAD.find((p) => p.d[0] === dx && p.d[1] === dy)?.g || '';
const BOMB_COLORS = { keg: '#b5743a', grapeshot: '#9aa6aa', stopwatch: '#7fd4ff' };
const bombColor = (kind) => BOMB_COLORS[kind] || '#ccc';
const ACT_NAME = { move: 'Move', throw: 'Throw', pickup: 'Pick up', load: 'Load', fire: 'Fire', wait: 'Wait' };
const PLAN_ERR = new Set(['bad_request', 'too_late', 'paused']);
const ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 22 13h-6v8.5H8V13H2z"/></svg>';

const HTML = `
  <section id="ccGame" class="screen ccgame" hidden>
    <header id="ccTop" class="plate cctop">
      <div class="ccident">
        <i id="ccSw" class="ccswatch"></i>
        <div class="ccidt"><b id="ccName"></b><span id="ccCarry"></span></div>
      </div>
      <div class="cclvl"><small id="ccLvlName">Level</small><b id="ccLvl"></b></div>
      <div class="cctimer" id="ccTimerBox"><small id="ccTimerLbl">Plan</small><b id="ccTimer"></b></div>
      <button id="ccMenuBtn" class="menubtn" type="button" aria-label="Menu">&#8943;</button>
      <i id="ccTbar" class="cctbar"></i>
    </header>
    <div id="ccQueue" class="ccqueue"></div>
    <div id="ccPad" class="ccpad">
      ${PAD.map((p) => `<button class="btn ccarrow ${p.id}" type="button" data-dir="${p.id}" aria-label="${p.g}"><span class="arw">${ARROW_SVG}</span></button>`).join('')}
      <button id="ccHub" class="cchub" type="button" disabled><b></b><small></small></button>
    </div>
    <div id="ccResolve" class="ccover" hidden><div class="gear spin">&#9881;</div><b class="display">Watch the TV</b><span id="ccResolveSub">Everyone's queues are playing out</span></div>
    <button id="ccAway" class="ccover away" type="button" hidden><b class="display">You sat down</b><span>Tap to rejoin. Filing any action stands you back up.</span></button>
    <div id="ccState" class="ccstate">
      <span id="ccStateTxt"></span>
      <button id="ccCancel" class="btn sm ghost" type="button" hidden>Cancel</button>
      <button id="ccClear" class="btn sm ghost" type="button">Clear</button>
    </div>
    <div id="ccBtns" class="ccbtns">
      <button class="btn ccact" type="button" data-act="pickup"><b>Pick up</b><small>then an arrow</small></button>
      <button class="btn ccact" type="button" data-act="throw"><b>Throw</b><small>then an arrow</small></button>
      <button class="btn ccact" type="button" data-act="load"><b>Load</b><small>next catapult</small></button>
      <button class="btn ccact" type="button" data-act="fire"><b>Fire</b><small>next catapult</small></button>
      <button class="btn ccact ghost" type="button" data-act="wait"><b>Wait</b><small>one step</small></button>
      <button class="btn ccact ghost" type="button" data-act="undo"><b>Undo</b><small>last step</small></button>
      <button id="ccDone" class="btn ccdone" type="button"><b>Done</b><small></small></button>
    </div>
    <div id="ccWho" class="ccwho"></div>
  </section>

  <section id="ccBreak" class="screen ccbreak" hidden>
    <div class="cchead">
      <h1 id="ccBrTitle" class="display"></h1>
      <p id="ccBrWall" class="ccbrwall"></p>
      <p id="ccBrSub" class="dim"></p>
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

export async function mount(ctx) {
  await ctx.loadCSS(new URL('./phone.css', import.meta.url).href);
  ctx.el.insertAdjacentHTML('beforeend', HTML);

  const defs = ctx.setup.defs;
  const SLOTS = defs.slots || 4;
  // light haptics, only once the page has had a tap (browsers refuse vibrate before that)
  const buzz = (p) => { if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; ctx.buzz(p); };
  const st = { room: null, players: new Map(), initials: new Map(), snap: null, snapAt: 0 };
  // My queue as last sent. The server echoes it in snap.plans; until the echo arrives (or if it
  // is refused) the phone shows what it sent. key = the turn it belongs to.
  let mine = { key: '', acts: [], done: false, at: 0, prev: null };
  let mode = null; // 'throw' | 'pickup': waiting for an arrow (pickup: or the hub)
  let screen = '';
  let awayDismissed = false;
  let undoneAt = 0; // an edit cleared Done: say so for a moment
  let feedback = []; // what happened to me in the last resolve, shown when it ends
  let res = null; // { ev, t0 } the resolve being played, to light up its slots
  const timers = [];

  const me = () => st.players.get(ctx.you);
  const isHost = () => st.room?.host === ctx.you;
  const pname = (id) => st.players.get(id)?.name || '?';
  const turnKey = () => (st.room ? `${st.room.level}:${st.room.round}` : '');
  const inPlan = () => st.room?.phase === 'plan' && st.snap?.phase === 'plan';
  const myEng = () => st.snap?.engineers?.find((e) => e.pid === ctx.you) || null;
  const awayShown = () => inPlan() && !!me()?.away && !awayDismissed;
  const bombName = (k) => defs.bombs?.[k]?.name || k;
  const levelDef = (lv) => defs.levels?.[lv - 1];
  const planOf = (pid) => st.snap?.plans?.find((p) => p.pid === pid) || null;

  // The queue to show and edit: what I just sent while the server has not echoed it yet,
  // else the server's copy (which also brings it back after a reload).
  function queue() {
    const sp = planOf(ctx.you);
    const fresh = mine.key === turnKey() && performance.now() - mine.at < 2000;
    if (fresh || !sp) return mine.key === turnKey() || fresh ? mine : { acts: [], done: false };
    return { acts: sp.acts || [], done: !!sp.done };
  }
  const canEdit = () => inPlan() && !!myEng();

  // ---------------------------------------------------------------- editing the queue
  function send(acts, done) {
    const q = queue();
    if (q.done && !done && acts !== q.acts) undoneAt = performance.now();
    mine = { key: turnKey(), acts, done, at: performance.now(), prev: { acts: q.acts, done: q.done } };
    ctx.send({ t: 'plan', acts, done });
    awayDismissed = true;
    mode = null;
    renderGame();
  }
  function append(act) {
    if (!canEdit()) return;
    const q = queue();
    if (q.acts.length >= SLOTS) { buzz([10, 30, 10]); return; }
    send([...q.acts, act], false);
    buzz(14);
  }
  function truncate(n) { // keep the first n actions
    if (!canEdit()) return;
    const q = queue();
    if (n >= q.acts.length) return;
    send(q.acts.slice(0, n), false);
    buzz(8);
  }
  function arm(m) {
    mode = mode === m ? null : m;
    if (mode) buzz(6);
    renderGame();
  }

  function onArrow(id) {
    if (!canEdit()) return;
    if (awayShown()) dismissAway();
    const [dx, dy] = PAD.find((p) => p.id === id).d;
    if (mode === 'throw') append({ a: 'throw', dx, dy });
    else if (mode === 'pickup') append({ a: 'pickup', dx, dy });
    else append({ a: 'move', dx, dy });
  }
  for (const b of $('ccPad').querySelectorAll('[data-dir]')) b.onclick = () => onArrow(b.dataset.dir);
  // the hub: with Pick up armed, the undirected pick-up (underfoot, else the nearest)
  $('ccHub').onclick = () => { if (mode === 'pickup') append({ a: 'pickup' }); };

  function onAction(act) {
    if (!canEdit()) return;
    if (awayShown()) dismissAway();
    switch (act) {
      case 'pickup': if (mode === 'pickup') append({ a: 'pickup' }); else arm('pickup'); break; // twice = undirected
      case 'throw': arm('throw'); break;
      case 'load': case 'fire': case 'wait': append({ a: act }); break;
      case 'undo': mode = null; truncate(queue().acts.length - 1); break;
    }
  }
  for (const b of $('ccBtns').querySelectorAll('[data-act]')) b.onclick = () => onAction(b.dataset.act);
  $('ccDone').onclick = () => {
    if (!canEdit()) return;
    if (awayShown()) dismissAway();
    const q = queue();
    send(q.acts, !q.done);
    buzz(q.done ? 8 : 24);
  };
  $('ccClear').onclick = () => { mode = null; truncate(0); };
  $('ccCancel').onclick = () => arm(null);
  $('ccQueue').addEventListener('click', (e) => {
    const s = e.target.closest('[data-slot]');
    if (s && s.classList.contains('full')) { mode = null; truncate(+s.dataset.slot); }
  });
  function dismissAway() {
    awayDismissed = true;
    ctx.toast('File any action to stand back up');
    renderGame();
  }
  $('ccAway').onclick = dismissAway;

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
    if (ph === 'plan' && (!prev || prev.phase !== 'plan' || prev.round !== m.round || prev.level !== m.level)) {
      mode = null;
      if (prev && prev.phase !== 'lobby') buzz(30);
    }
    if (ph !== 'plan') mode = null;
    if (ph === 'lobby') { st.snap = null; mine = { key: '', acts: [], done: false, at: 0, prev: null }; feedback = []; res = null; }
    if (!me()?.away) awayDismissed = false;
    render();
  }

  function render() {
    const r = st.room;
    if (!r) return;
    const ph = r.phase;
    show(ph === 'lobby' ? 'lobby' : ph === 'won' || ph === 'lost' ? 'end' : ph === 'break' ? 'break' : 'game');
    if (screen === 'game') renderGame();
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
    const prevPhase = st.snap?.phase;
    st.snap = m;
    st.snapAt = performance.now();
    if (m.phase !== 'plan' && mine.key && mine.key !== turnKey()) mine = { key: '', acts: [], done: false, at: 0, prev: null };
    for (const e of m.ev || []) onEvent(e);
    if (prevPhase === 'resolve' && m.phase !== 'resolve') { res = null; flushFeedback(); }
    if (m.phase === 'plan' && feedback.length && !res) flushFeedback();
    if (!st.room) return;
    if (screen === 'game') renderGame();
    if (screen === 'break') renderBreak();
  }

  function say(msg, bad = false) { feedback.push({ msg, bad }); }
  function flushFeedback() {
    if (!feedback.length) return;
    const bad = feedback.some((f) => f.bad);
    ctx.toast(feedback.map((f) => f.msg).join(' · '), bad ? 'err' : 'ok', 2600 + 900 * Math.min(4, feedback.length));
    if (bad) buzz([25, 40, 25]);
    feedback = [];
  }

  const FIZZLE = {
    blocked: () => "can't step that way",
    no_bomb: () => 'nothing to pick up',
    hands_full: () => 'hands already full',
    empty_hands: (a) => (a === 'load' ? 'nothing to load' : 'nothing to throw'),
    no_target: () => 'nowhere to throw',
    no_catapult: () => 'not next to a catapult',
    catapult_full: () => 'the catapult was already loaded',
    catapult_empty: () => 'the catapult was empty',
  };
  function onEvent(e) {
    const you = ctx.you;
    const step = e.slot != null ? `Step ${e.slot + 1}: ` : '';
    switch (e.e) {
      case 'resolve':
        res = { ev: e, t0: performance.now() };
        feedback = feedback.filter((f) => f.keep);
        break;
      case 'fizzle':
        if (e.pid === you) say(step + (FIZZLE[e.reason]?.(e.a) || `${ACT_NAME[e.a] || e.a} fizzled`), true);
        break;
      case 'throw':
        if (e.pid === you) {
          if (e.result === 'caught') say(step + (e.by === you ? 'you caught your own throw' : `${pname(e.by)} caught your ${bombName(e.kind)}`));
          else if (e.result === 'blocked') say(step + `${pname(e.by)}'s hands were full: your ${bombName(e.kind)} dropped at their feet`, true);
          else say(step + `your ${bombName(e.kind)} landed`);
        } else if (e.by === you) {
          if (e.result === 'blocked') say(step + `your hands were full: ${pname(e.pid)}'s ${bombName(e.kind)} dropped at your feet`, true);
          else say(step + `caught ${pname(e.pid)}'s ${bombName(e.kind)}`);
        }
        break;
      case 'move':
        if (e.pid === you && e.result === 'bump') {
          // whoever else was heading into or standing in that cell this slot
          const other = (st.snap?.ev || []).find((o) => o.e === 'move' && o.slot === e.slot && o.pid !== you
            && ((o.to[0] === e.to[0] && o.to[1] === e.to[1]) || (o.from[0] === e.to[0] && o.from[1] === e.to[1])));
          const by = other?.pid || st.snap?.engineers?.find((q) => q.pid !== you && q.x === e.to[0] && q.y === e.to[1])?.pid;
          say(step + (by ? `bumped into ${pname(by)}` : 'bumped, stayed put'), true);
        }
        break;
      case 'pickup':
        if (e.pid !== you) break;
        if (e.result === 'ok') say(step + `picked up a ${bombName(e.kind)}`);
        else if (e.result === 'contested') say(step + 'someone grabbed for it too: nobody got it', true);
        else if (e.result === 'hands_full') say(step + 'hands full: no pick-up', true);
        else say(step + 'the bomb was gone', true);
        break;
      case 'load':
        if (e.pid !== you) break;
        if (e.result === 'ok') say(step + `loaded a ${bombName(e.kind)}`);
        else if (e.result === 'contested') say(step + 'two loaders, one catapult: neither loaded', true);
        else say(step + 'load fizzled', true);
        break;
      case 'fire':
        if (e.pid !== you) break;
        if (e.result === 'ok') {
          const kills = e.hits.filter((x) => x.killed).length;
          say(step + (kills ? `boom! ${kills} machine${kills > 1 ? 's' : ''} destroyed` : e.hits.length ? `hit ${e.hits.length} machine${e.hits.length > 1 ? 's' : ''}` : 'fired'));
        } else if (e.result === 'wasted') say(step + 'fired into an empty lane', true);
        else say(step + 'someone fired it first', true);
        break;
      case 'wall': { // one line for all the wall hits of a resolve
        const w = feedback.find((f) => f.wall != null);
        if (w) { w.wall += e.dmg; w.msg = `The wall took ${w.wall} damage`; } else feedback.push({ msg: `The wall took ${e.dmg} damage`, bad: true, wall: e.dmg });
        break;
      }
      case 'level_start': {
        const d = levelDef(e.level);
        ctx.toast(`Level ${e.level}: ${e.name || d?.name || ''}`, 'ok', 2600);
        break;
      }
      case 'place':
        if (e.pid === you && st.room?.round > 1 && st.snap?.phase === 'plan') ctx.toast('You are on the board');
        break;
    }
  }

  // ---------------------------------------------------------------- game screen
  function tick() {
    const r = st.room;
    const s = st.snap;
    if (!r || !s) return;
    const left = snapLeft();
    if (screen === 'game') {
      const plan = s.phase === 'plan';
      const untimed = plan && s.untimed;
      $('ccTimerBox').classList.toggle('untimed', untimed);
      $('ccTimerLbl').textContent = untimed ? 'No timer' : plan ? 'Plan' : s.phase === 'resolve' ? 'Resolve' : '';
      $('ccTimer').textContent = untimed ? 'first round' : plan || s.phase === 'resolve' ? Math.ceil(left) + 's' : '';
      const hurry = plan && !untimed && left <= 5;
      $('ccTimerBox').classList.toggle('hurry', hurry);
      $('ccTbar').style.width = (plan && !untimed ? Math.min(100, (left / defs.planTime) * 100) : 0).toFixed(1) + '%';
      $('ccTbar').classList.toggle('hurry', hurry);
      if (res) renderQueue();
    }
    if (screen === 'break') $('ccBrTimer').textContent = s.phase === 'break' ? `Next level in ${Math.ceil(left)}s` : '';
  }
  timers.push(setInterval(tick, 100));

  // Seconds left in the phase, from the last snap; the local clock runs on for at most a second
  // past it, so a pause (no advancing snaps) freezes the countdown instead of running it out.
  const snapLeft = () => (st.snap ? Math.max(0, st.snap.left - Math.min(1, (performance.now() - st.snapAt) / 1000)) : 0);
  // which slot of my queue the resolve is playing now (-1: none yet / machines)
  function playingSlot() {
    if (!res) return { slot: -1, machines: false };
    const t = st.snap?.phase === 'resolve' ? res.ev.dur - snapLeft() : (performance.now() - res.t0) / 1000;
    let slot = -1;
    for (const sl of res.ev.slots || []) if (t >= sl.at) slot = sl.slot;
    const mach = res.ev.machines;
    if (mach && t >= mach.at) return { slot: -1, machines: true, done: slot };
    return { slot, machines: false, done: slot - 1 };
  }

  function renderQueue() {
    const box = $('ccQueue');
    const q = queue();
    const resolving = st.snap?.phase === 'resolve';
    const play = resolving ? playingSlot() : { slot: -1 };
    const next = canEdit() && q.acts.length < SLOTS ? q.acts.length : -1;
    const key = JSON.stringify([q.acts, q.done, next, play.slot, play.machines, play.done, resolving, mode]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.classList.toggle('done', q.done && !resolving);
    const cells = [];
    for (let i = 0; i < SLOTS; i++) {
      const a = q.acts[i];
      const cls = ['ccslot', a ? 'full' : 'empty'];
      if (i === next) cls.push('next', mode || 'move');
      if (resolving && i === play.slot) cls.push('playing');
      if (resolving && (i <= play.done || play.machines)) cls.push('played');
      let main = '';
      let sub = '';
      if (a) {
        main = ACT_NAME[a.a] || a.a;
        if (a.dx != null && (a.dx || a.dy)) sub = glyph(a.dx, a.dy);
        else if (a.a === 'pickup') sub = 'here / nearest';
      } else if (i === next) main = mode === 'throw' ? 'Throw…' : mode === 'pickup' ? 'Pick up…' : 'next';
      cells.push(h('button', { class: cls.join(' '), type: 'button', 'data-slot': i, 'aria-label': `Step ${i + 1}` },
        h('em', {}, String(i + 1)), h('b', {}, main), sub ? h('span', { class: sub.length === 1 ? 'gl' : 'sb' }, sub) : null));
    }
    box.replaceChildren(...cells);
  }

  function renderGame() {
    const r = st.room;
    if (!r || screen !== 'game') return;
    const p = me();
    const e = myEng();
    const q = queue();
    const resolving = r.phase === 'resolve' || st.snap?.phase === 'resolve';
    const live = canEdit() && !awayShown();
    const full = q.acts.length >= SLOTS;
    $('ccLvlName').textContent = `Level ${r.level}/${r.levels}`;
    $('ccLvl').textContent = r.round ? `Turn ${r.round}` : '';
    $('ccResolve').hidden = !resolving;
    $('ccAway').hidden = !awayShown();
    $('ccGame').classList.toggle('resolving', resolving);
    tick();

    // who I am and what I carry
    $('ccSw').style.background = p?.color || '#999';
    $('ccSw').textContent = st.initials.get(ctx.you) || '';
    $('ccName').textContent = p?.name || '';
    const carry = e?.carry;
    const ckey = carry ? carry.kind : e ? '-' : '?';
    if ($('ccCarry').dataset.key !== ckey) {
      $('ccCarry').dataset.key = ckey;
      $('ccCarry').replaceChildren(...(carry
        ? [h('i', { class: 'ccbomb', style: `--c:${bombColor(carry.kind)}` }), `carrying ${bombName(carry.kind)}`]
        : [e ? 'empty hands' : 'not on the board yet']));
    }

    // state line
    let txt;
    if (resolving) txt = 'Watch the TV';
    else if (!e) txt = 'No engineer yet: you join at the next free spot';
    else if (awayShown()) txt = 'You sat down';
    else if (mode === 'throw') txt = 'Throw which way? Tap an arrow';
    else if (mode === 'pickup') txt = 'Pick up which way? An arrow, or the middle for underfoot / nearest';
    else if (q.done) txt = q.acts.length ? 'Done ✓ waiting for the others · any change un-does it' : 'Done ✓ doing nothing this turn';
    else if (performance.now() - undoneAt < 3000) txt = 'Changed: not done any more. Tap Done again';
    else if (full) txt = 'Queue full: tap Done';
    else if (!q.acts.length) txt = `Plan up to ${SLOTS} steps: arrows move, buttons act`;
    else txt = `Step ${q.acts.length + 1} of ${SLOTS}, or tap Done`;
    $('ccStateTxt').textContent = txt;
    $('ccState').classList.toggle('done', q.done && !resolving);
    $('ccState').classList.toggle('picking', !!mode);
    $('ccCancel').hidden = !mode;
    $('ccClear').hidden = !!mode || !q.acts.length || !live;

    // arrows and the hub: never greyed for legality, only when nothing can be added
    $('ccPad').classList.toggle('throwing', mode === 'throw');
    $('ccPad').classList.toggle('picking', mode === 'pickup');
    for (const b of $('ccPad').querySelectorAll('[data-dir]')) b.disabled = !live || full;
    const hub = $('ccHub');
    hub.style.setProperty('--c', p?.color || '#999');
    hub.disabled = !(live && mode === 'pickup' && !full);
    hub.classList.toggle('tap', !hub.disabled);
    hub.querySelector('b').textContent = mode === 'pickup' ? 'HERE' : st.initials.get(ctx.you) || '';
    hub.querySelector('small').textContent = mode === 'pickup' ? 'or nearest' : mode === 'throw' ? 'throw' : live ? 'move' : '';

    for (const b of $('ccBtns').querySelectorAll('[data-act]')) {
      const act = b.dataset.act;
      b.disabled = !live || (act === 'undo' ? !q.acts.length : full);
      b.classList.toggle('armed', mode === act);
      if (act === 'pickup') b.querySelector('small').textContent = mode === 'pickup' ? 'again: here / nearest' : 'then an arrow';
    }
    const done = $('ccDone');
    done.disabled = !live;
    done.classList.toggle('on', q.done);
    done.classList.toggle('pulse', full && !q.done && live);
    done.querySelector('b').textContent = q.done ? 'Done ✓' : 'Done';
    done.querySelector('small').textContent = q.done ? 'tap to undo' : q.acts.length ? `${q.acts.length} step${q.acts.length > 1 ? 's' : ''}` : 'do nothing';
    renderQueue();
    renderWho($('ccWho'), 'plan');
  }

  function renderWho(box, what) {
    const r = st.room;
    const ok = (p) => (what === 'plan' ? !!planOf(p.id)?.done : p.ready);
    const key = r.players.map((p) => [p.id, ok(p), p.away, p.connected].join()).join('|') + what;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.classList.toggle('many', r.players.length > 4);
    box.replaceChildren(...r.players.map((p) => {
      const cls = 'who' + (ok(p) ? ' ok' : '') + (p.away ? ' away' : '') + (p.id === ctx.you ? ' me' : '');
      return h('span', { class: cls, title: p.name },
        h('i', { class: 'dot', style: `background:${p.color}` }, st.initials.get(p.id) || ''),
        h('span', { class: 'nm' }, p.name),
        h('b', {}, p.away ? 'zz' : ok(p) ? '✓' : '…'));
    }));
  }

  // ---------------------------------------------------------------- break: ready
  function renderBreak() {
    const r = st.room;
    const s = st.snap;
    $('ccBrTitle').textContent = `Level ${r.level} cleared!`;
    $('ccBrWall').textContent = `Wall ${s?.wall ?? '?'} / ${s?.wallMax ?? defs.wallHP}`;
    const next = levelDef(r.level + 1);
    $('ccBrSub').textContent = next ? `Next: ${next.name}. ${next.desc || ''}` : '';
    const ready = !!me()?.ready;
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
    $('ccEndSub').textContent = `Level ${end?.level ?? r.level}/${r.levels} · ${end?.rounds ?? 0} turns · wall ${end?.wall ?? 0} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const s = end?.stats?.[ctx.you] || {};
    const tiles = [['kills', 'Kills'], ['dmg', 'Damage'], ['fires', 'Fires'], ['loads', 'Loads'], ['throws', 'Throws'], ['catches', 'Catches'], ['pickups', 'Pick-ups'], ['steps', 'Steps'], ['bumps', 'Bumps'], ['fizzles', 'Fizzles']];
    $('ccEndMine').replaceChildren(...tiles.map(([k, l]) => h('div', {}, h('b', {}, Math.round(s[k] || 0)), h('span', {}, l))));
    $('ccEndAwards').replaceChildren(...(end?.awards || []).map((a) => h('div', { class: 'award' + (a.pid === ctx.you ? ' me' : '') },
      h('i', { class: 'dot', style: `background:${st.players.get(a.pid)?.color || '#999'}` }),
      h('div', {}, h('div', { class: 'at' }, a.title), h('div', { class: 'ad' }, a.detail)),
      h('div', { class: 'ap' }, a.pid === ctx.you ? 'You' : pname(a.pid)))));
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
    const confirmItem = (key, label, ask, fn) => armed === key
      ? h('div', { class: 'confirm' }, h('span', {}, ask),
        h('button', { class: 'btn sm danger', type: 'button', onclick: fn }, 'Yes'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { armed = null; renderMenu(); } }, 'No'))
      : h('button', {
        class: 'btn sm ghost warn', type: 'button',
        onclick: () => { armed = key; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = null; if (!$('ccMenu').hidden) renderMenu(); }, 5000); renderMenu(); },
      }, label);
    const items = [];
    if (isHost()) items.push(h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { $('ccMenu').hidden = true; ctx.send({ t: 'pause', on: true }); } }, 'Pause game'));
    if (isHost()) items.push(confirmItem('end', 'End game', 'End the game for everyone?', () => { armed = null; $('ccMenu').hidden = true; ctx.send({ t: 'restart' }); }));
    // host: remove a player (the server drops them; their phone goes back to the join form)
    const others = isHost() ? (st.room?.players || []).filter((p) => p.id !== ctx.you) : [];
    let kick = null;
    if (others.length && armed?.startsWith('kick')) {
      const target = armed.startsWith('kick:') ? st.players.get(armed.slice(5)) : null;
      kick = h('div', { class: 'cckick' }, target
        ? confirmItem(armed, '', `Remove ${target.name} from the game?`, () => { ctx.send({ t: 'kick', id: target.id }); armed = null; renderMenu(); })
        : [h('div', { class: 'ttl' }, 'Remove which player?'),
          h('div', { class: 'mrow' }, others.map((p) => h('button', {
            class: 'btn sm ghost', type: 'button', onclick: () => { armed = 'kick:' + p.id; renderMenu(); },
          }, h('i', { class: 'dot', style: `background:${p.color}` }), ' ', p.name + (p.connected ? '' : ' (gone)')))),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { armed = null; renderMenu(); } }, 'Never mind')]);
    } else if (others.length) items.push(h('button', { class: 'btn sm ghost warn', type: 'button', onclick: () => { armed = 'kick'; renderMenu(); } }, 'Remove a player…'));
    items.push(confirmItem('leave', 'Leave game', 'Leave this game?', () => { $('ccMenu').hidden = true; ctx.leave(); }));
    $('ccMenuBody').replaceChildren(
      h('div', { class: 'ttl' }, 'How a turn works'),
      h('p', { class: 'cchelp' }, `File up to ${SLOTS} steps, then Done. Everyone's step 1 plays at once, then step 2, and so on. Each step is judged when it comes up: one that can't happen just fizzles.`),
      ...(kick ? [kick] : []), h('div', { class: 'mrow' }, items));
  }

  // poke from the console / test drivers
  window.ccDebug = { st, queue, mode: () => mode, you: () => ctx.you, eng: myEng, keep: () => ctx.setup.map.keeps.find((k) => k.id === st.room?.keep) || null };

  return {
    onRoom,
    onSnap,
    onError(m) {
      // a refused queue: show the server's copy again
      if (PLAN_ERR.has(m.code) && mine.prev && performance.now() - mine.at < 5000) { mine.at = 0; renderGame(); }
    },
    unmount() {
      delete window.ccDebug;
      for (const t of timers) clearInterval(t);
      clearTimeout(armTimer);
      ctx.wake(false);
    },
  };
}
