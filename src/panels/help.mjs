import { h, trapKeys } from './util.mjs';

const KEYS = [
  ['→ ↓ Space', 'Next step'],
  ['← ↑ Shift+Space', 'Back'],
  ['Home / End', 'First / last step'],
  ['/', 'Step index'],
  ['F', 'Fullscreen'],
  ['T', 'Light or dark'],
  ['P', 'Projector washout'],
  ['M', 'Reduce motion'],
  ['?', 'This help'],
  ['Esc', 'Close'],
];

export function mountHelp(ctx) {
  const close = h('button', { type: 'button', class: 'ov-close', 'aria-label': 'Close' }, '×');
  const dl = h('dl', { class: 'hp-keys' });
  for (const [k, v] of KEYS) dl.append(h('div', { class: 'hp-row' }, h('dt', null, h('kbd', null, k)), h('dd', null, v)));
  const el = h('div', { id: 'help', class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Help', hidden: true, tabindex: '-1' },
    h('div', { class: 'ov-panel' }, h('div', { class: 'ov-head' }, h('h2', { class: 'ov-title' }, 'Keys'), close), dl));
  // Notices the build writes into the page (tools/build.mjs) from the deck's own data. None are added here.
  const notice = ctx.data && Array.isArray(ctx.data.notices) ? ctx.data.notices : null;
  if (notice && notice.length) {
    const box = h('div', { class: 'hp-notice' }, h('h3', { class: 'hp-notice-title' }, 'Sources'));
    for (const line of notice) box.append(h('p', null, line));
    el.firstChild.append(box);
  }
  trapKeys(el);
  let back = null;
  const shut = () => { el.hidden = true; ctx.ov.drop('help'); if (back && document.contains(back)) back.focus(); back = null; };
  close.addEventListener('click', () => ctx.ov.closeTop());
  el.addEventListener('click', (e) => { if (e.target === el) ctx.ov.closeTop(); });
  return {
    el,
    open() { if (!el.hidden) return; back = document.activeElement; el.hidden = false; ctx.ov.push('help', shut); close.focus(); },
    close() { if (!el.hidden) { ctx.ov.drop('help'); shut(); } },
    isOpen: () => !el.hidden,
  };
}
