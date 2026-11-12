// Small DOM helpers shared by the shells and the mode modules.

export const $ = (id) => document.getElementById(id);

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Element builder: h('button', { class: 'btn', onclick: fn }, 'label', child, …)
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

function gearD(r, teeth) {
  const inner = r * 0.75;
  const step = (Math.PI * 2) / teeth;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [a - step * 0.3, inner],
      [a - step * 0.16, r],
      [a + step * 0.16, r],
      [a + step * 0.3, inner],
    ];
    for (const [an, rr] of pts) d += `${d ? 'L' : 'M'}${(Math.cos(an) * rr).toFixed(2)} ${(Math.sin(an) * rr).toFixed(2)}`;
  }
  return d + 'Z';
}

export const GEAR_SVG = (cls = '') =>
  `<svg class="gear ${cls}" viewBox="-12 -12 24 24" aria-hidden="true"><path d="${gearD(11, 8)}"/><circle r="3.2" class="hole"/></svg>`;

export const CROWN_SVG = `<svg class="crown" viewBox="0 0 24 18" aria-hidden="true"><path d="M2 16h20l1-11-6 5-5-8-5 8-6-5z"/></svg>`;
