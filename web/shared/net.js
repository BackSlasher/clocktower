// Websocket connection with automatic reconnect. Used by both TV and phone.
//
//   const conn = connect(() => ({ role: 'player', room, name, token }), {
//     onMessage(msg) {}, onStatus(status) {}   // 'connecting' | 'open' | 'closed' | 'replaced'
//   });
//   conn.send({ t: 'build', plot: 4, kind: 'rivet' });
//   conn.close();
//
// `params` is a function so each reconnect can pick up a freshly stored token.
// A server `error` with a fatal code (no_room, room_full, bad_name) stops
// reconnecting; the message is still delivered to onMessage.

const FATAL = new Set(['no_room', 'room_full', 'bad_name']);

export function connect(params, { onMessage, onStatus } = {}) {
  let ws = null;
  let stopped = false;
  let attempt = 0;
  let timer = null;

  function open() {
    if (stopped) return;
    onStatus?.('connecting');
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params())) {
      if (v !== undefined && v !== null && v !== '') q.set(k, v);
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws?${q}`);
    ws.onopen = () => {
      attempt = 0;
      onStatus?.('open');
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'error' && FATAL.has(msg.code)) stopped = true;
      onMessage?.(msg);
    };
    ws.onclose = (ev) => {
      ws = null;
      // Another tab took over this session; reconnecting would start a tug of war.
      if (ev.reason === 'replaced') stopped = true;
      onStatus?.(ev.reason === 'replaced' ? 'replaced' : 'closed');
      if (stopped) return;
      const delay = Math.min(5000, 300 * 2 ** attempt++) * (0.75 + Math.random() * 0.5);
      timer = setTimeout(open, delay);
    };
    ws.onerror = () => ws?.close();
  }

  // Phones suspend sockets when the screen locks; reconnect promptly on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !ws && !stopped) {
      clearTimeout(timer);
      attempt = 0;
      open();
    }
  });

  open();

  return {
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
