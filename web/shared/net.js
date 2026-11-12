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
//
// Watchdog: a ping goes out every PING_MS while open; if nothing at all has
// arrived for DEAD_MS the socket is abandoned (status 'closed', handlers
// detached, close() without waiting) and a normal backoff reconnect follows.
// Throttled timers or a hidden page are not evidence of a dead connection, so
// in that case the clock is reset and a ping is sent first.

const FATAL = new Set(['no_room', 'room_full', 'bad_name']);
const PING_MS = 5000;
const DEAD_MS = 12000;
const TICK_MS = 1000;
const LATE_MS = 3000; // a tick this much late means the page itself was frozen

export function connect(params, { onMessage, onStatus } = {}) {
  let ws = null;
  let stopped = false;
  let attempt = 0;
  let timer = null;
  let lastRx = 0;
  let lastPing = 0;
  let lastTick = 0;

  function scheduleReconnect() {
    const delay = Math.min(5000, 300 * 2 ** attempt++) * (0.75 + Math.random() * 0.5);
    clearTimeout(timer);
    timer = setTimeout(open, delay);
  }

  function ping() {
    lastPing = performance.now();
    if (ws?.readyState === WebSocket.OPEN) ws.send('{"t":"ping"}');
  }

  function tick() {
    const now = performance.now();
    const late = now - lastTick - TICK_MS > LATE_MS;
    lastTick = now;
    if (!ws) return;
    if (late || document.hidden) {
      lastRx = now;
      ping();
      return;
    }
    if (now - lastRx > DEAD_MS) {
      const old = ws;
      ws = null;
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try {
        old.close();
      } catch {
        /* already gone */
      }
      onStatus?.('closed');
      if (!stopped) scheduleReconnect();
    } else if (now - lastPing >= PING_MS) ping();
  }
  const watchdog = setInterval(tick, TICK_MS);

  function open() {
    if (stopped) return;
    onStatus?.('connecting');
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params())) {
      if (v !== undefined && v !== null && v !== '') q.set(k, v);
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const sock = (ws = new WebSocket(`${proto}//${location.host}/ws?${q}`));
    lastRx = lastPing = lastTick = performance.now();
    sock.onopen = () => {
      if (ws !== sock) return;
      attempt = 0;
      onStatus?.('open');
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      lastRx = performance.now();
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'error' && FATAL.has(msg.code)) stopped = true;
      onMessage?.(msg);
    };
    sock.onclose = (ev) => {
      if (ws !== sock) return; // abandoned by the watchdog
      ws = null;
      // Another tab took over this session; reconnecting would start a tug of war.
      if (ev.reason === 'replaced') stopped = true;
      onStatus?.(ev.reason === 'replaced' ? 'replaced' : 'closed');
      if (stopped) return;
      scheduleReconnect();
    };
    sock.onerror = () => sock.close();
  }

  // Phones suspend sockets when the screen locks; reconnect promptly on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!ws && !stopped) {
      clearTimeout(timer);
      attempt = 0;
      open();
    } else if (ws) {
      lastRx = performance.now(); // timers were throttled; give it a fresh window
      ping();
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
      clearInterval(watchdog);
      ws?.close();
    },
  };
}
