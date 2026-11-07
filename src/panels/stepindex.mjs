import { h, rich, trapKeys } from './util.mjs';

// Step index: key `/`. Live filter by head and id; Enter jumps. Its input never leaks keys to the deck.
export function mountIndex(ctx) {
  const input = h('input', { type: 'text', class: 'ix-input', placeholder: 'Filter steps', 'aria-label': 'Filter steps', autocomplete: 'off', spellcheck: 'false' });
  const list = h('ol', { class: 'ix-list', role: 'listbox', 'aria-label': 'Steps' });
  const empty = h('p', { class: 'ix-empty', hidden: true }, 'No steps match');
  const close = h('button', { type: 'button', class: 'ov-close', 'aria-label': 'Close' }, '×');
  const el = h('div', { id: 'index', class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Step index', hidden: true, tabindex: '-1' },
    h('div', { class: 'ov-panel' }, h('div', { class: 'ov-head' }, h('h2', { class: 'ov-title' }, 'Steps'), close), input, list, empty));
  trapKeys(el);
  let shown = [], active = 0, back = null;

  const matches = () => {
    const q = input.value.trim().toLowerCase();
    const steps = ctx.deck.steps;
    return steps.filter((s) => !q || s.head.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || String(s.i + 1) === q);
  };
  const paint = () => {
    list.replaceChildren(...shown.map((s, k) => h('li', { class: 'ix-item', role: 'option', 'aria-selected': k === active ? 'true' : 'false', 'aria-current': s.i === ctx.deck.i() ? 'step' : null, 'data-i': s.i },
      h('button', { type: 'button', class: 'ix-btn', tabindex: '-1', onclick: () => jump(s.i) },
        h('span', { class: 'ix-num' }, String(s.i + 1)), h('span', { class: 'ix-head' }, rich(s.head)), h('span', { class: 'ix-id' }, s.id)))));
    empty.hidden = shown.length > 0;
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const filter = (keepCurrent) => {
    shown = matches();
    active = keepCurrent ? Math.max(0, shown.findIndex((s) => s.i === ctx.deck.i())) : 0;
    paint();
  };
  const jump = (i) => { ctx.ov.closeTop(); ctx.deck.go(i); };
  input.addEventListener('input', () => filter(false));
  input.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) { active = (active + 1) % shown.length; paint(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { active = (active - 1 + shown.length) % shown.length; paint(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) jump(shown[active].i); }
    if (e.key !== 'Escape') e.stopPropagation();
  });
  const shut = () => { el.hidden = true; ctx.ov.drop('index'); const ok = back && back !== input && document.contains(back) && !back.hidden && !/^(input|textarea|select)$/i.test(back.tagName);
    if (ok) back.focus();
    if (document.activeElement === input || /^(input|textarea|select)$/i.test(document.activeElement?.tagName || '')) { input.blur(); document.activeElement?.blur?.(); }
    back = null; };
  close.addEventListener('click', () => ctx.ov.closeTop());
  el.addEventListener('click', (e) => { if (e.target === el) ctx.ov.closeTop(); });
  return {
    el,
    open() { if (!el.hidden) { input.focus(); return; } back = document.activeElement; input.value = ''; el.hidden = false; ctx.ov.push('index', shut); filter(true); input.focus(); },
    close() { if (!el.hidden) { ctx.ov.drop('index'); shut(); } },
    isOpen: () => !el.hidden,
  };
}
