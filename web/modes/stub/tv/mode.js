// stub mode on the TV: says that it is running, with a clock. Template for a new mode:
// mount(ctx) builds into ctx.el and returns the hooks the shell calls (web/modes/README.md).

export function mount(ctx) {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;font:bold 96px Georgia,serif;color:#f0d48a;background:#0d1416';
  ctx.el.append(box);
  let seconds = 0;
  const show = () => (box.textContent = `Stub mode running: ${seconds} s`);
  return {
    // the shell shows its lobby in the lobby phase; any other phase is ours
    onRoom(room) {
      box.style.display = room.phase === 'lobby' ? 'none' : 'flex';
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
