#!/usr/bin/env node
// Render the GitHub social preview (1280x640) from the game's own TV page.
//
//   node tools/social-card.mjs [out.jpg] [--url http://localhost:8080] [--port 9222]
//
// Needs a running server, a Chromium with --remote-debugging-port (see
// shot.mjs) and ImageMagick's `magick`. Shoots /tv?demo=card with the HUD
// hidden and the lobby title laid over the top-left corner, then crops the
// 1920x1080 stage to 2:1 around the clock. The demo is animated, so every run
// gives a different frame: look at the result, and run again if an effect
// lands badly. Upload the file by hand: repo Settings > General > Social preview.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const url = opt('url', 'http://localhost:8080');
const port = opt('port', process.env.CDP_PORT || '9222');
const here = dirname(fileURLToPath(import.meta.url));
const out = args[0] || join(here, '..', 'docs', 'img', 'social-preview.jpg');

const TAGLINE = 'Co-op party games for the living room. The TV shows the action; everyone plays from their phone.';

// runs in the page, in stage coordinates (1920x1080)
const overlay = `(() => {
  for (const id of ['hud', 'badge']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
  for (const e of document.querySelectorAll('#stage *')) if (e.children.length === 0 && /Sound is off/.test(e.textContent)) e.style.display = 'none';
  const o = document.createElement('div');
  o.style.cssText = 'position:absolute;inset:0;z-index:9999;pointer-events:none;background:' +
    'radial-gradient(ellipse 1150px 560px at 330px 260px, rgba(8,10,12,0.95) 0%, rgba(8,10,12,0.86) 50%, rgba(8,10,12,0) 100%),' +
    'linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0) 30%, rgba(0,0,0,0) 75%, rgba(0,0,0,0.35))';
  o.innerHTML = '<h1 class="title display" style="position:absolute;left:84px;top:204px;font-size:122px">Clocktower</h1>' +
    '<p style="position:absolute;left:92px;top:356px;margin:0;width:660px;font-size:38px;line-height:1.3;color:#efe3c2;text-shadow:0 2px 6px #000">${TAGLINE}</p>';
  document.getElementById('stage').appendChild(o);
})()`;

const tmp = mkdtempSync(join(tmpdir(), 'ct-card-'));
try {
  const full = join(tmp, 'full.png');
  execFileSync('node', [join(here, 'shot.mjs'), `${url}/tv?demo=card`, full, '--port', port, '--size', '1920x1080', '--wait', '7500', '--eval', overlay], { stdio: 'inherit' });
  // 2:1 band of the stage with the clock right of centre, scaled to GitHub's recommended size; JPEG keeps it under the 1 MB limit
  execFileSync('magick', [full, '-crop', '1600x800+0+140', '+repage', '-resize', '1280x640', '-strip', '-quality', '92', out], { stdio: 'inherit' });
  console.log(`wrote ${out}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
