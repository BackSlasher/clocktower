// stub mode on the phone: shows a clock, and on the host's phone an End button. Template for a
// new mode: mount(ctx) builds into ctx.el and returns the hooks the shell calls
// (web/modes/README.md).

import { h } from '/shared/dom.js';

export function mount(ctx) {
  const text = h('p', { class: 'display', style: 'font-size:1.6rem;text-align:center;margin:0' });
  const end = h('button', { class: 'btn big-btn', type: 'button', onclick: () => ctx.send({ t: 'restart' }) }, 'End');
  const screen = h('section', { class: 'screen center', hidden: true }, text, end);
  ctx.el.append(screen);
  let seconds = 0;
  const show = () => (text.textContent = `Stub mode running: ${seconds} s`);
  return {
    // the shell shows its lobby in the lobby phase; any other phase is ours
    onRoom(room) {
      screen.hidden = room.phase === 'lobby';
      end.hidden = room.host !== ctx.you;
      if (room.phase === 'lobby') seconds = 0;
      show();
    },
    onSnap(snap) {
      seconds = snap.seconds;
      show();
    },
    unmount() {},
  };
}
