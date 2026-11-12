#!/usr/bin/env node
// Screenshot a page through the Chromium debugging port (default :9222).
//
//   node tools/shot.mjs <url> <out.png> [--size 1920x1080] [--wait 2000]
//                       [--mobile] [--eval 'js run before the shot'] [--keep]
//
// Opens its own tab and closes it afterwards (--keep leaves it open and prints
// the tab id). Never closes the browser's last tab. Prints console errors and
// the value of --eval to stdout.

import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};

const port = opt('port', process.env.CDP_PORT || '9222');
const [w, h] = opt('size', '1920x1080').split('x').map(Number);
const wait = Number(opt('wait', '2000'));
const js = opt('eval', '');
const mobile = flag('mobile');
const keep = flag('keep');
const [url, out] = args;
if (!url || !out) {
  console.error('usage: shot.mjs <url> <out.png> [--size WxH] [--wait ms] [--mobile] [--eval js] [--keep]');
  process.exit(2);
}

const base = `http://localhost:${port}`;
const tab = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    console.log('[page exception]', d.exception?.description || d.text);
  } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    console.log(`[console.${m.params.type}]`, m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
};
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

try {
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
  });
  if (mobile) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
  await cdp('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, wait));
  if (js) {
    const r = await cdp('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) console.log('[eval exception]', r.exceptionDetails.exception?.description);
    else if (r.result.value !== undefined) console.log(JSON.stringify(r.result.value));
  }
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`saved ${out}`);
} finally {
  ws.close();
  if (keep) {
    console.log(`tab ${tab.id}`);
  } else {
    const pages = (await (await fetch(`${base}/json`)).json()).filter((t) => t.type === 'page');
    if (pages.length <= 1) await fetch(`${base}/json/new?about:blank`, { method: 'PUT' });
    await fetch(`${base}/json/close/${tab.id}`);
  }
}
