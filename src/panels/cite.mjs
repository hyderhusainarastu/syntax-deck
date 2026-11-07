import { h, rich, fit } from './util.mjs';

function locatorText(c) {
  const l = c.locator || {};
  const parts = [];
  if (l.work && l.work !== c.source) parts.push(l.work);
  if (l.entry) parts.push(l.entry);
  if (l.sense) parts.push('sense ' + l.sense);
  if (l.page) parts.push('p. ' + l.page);
  return parts.join(', ');
}

// Display. A and B: a grade chip, then the reference (B: "as reported in ..."). C: the same, plus the amber
// "page needed" chip. D: never shown (lookup.cite returns null). Nothing here is clickable: a live deck opens nothing on stage.
export function renderCite(ctx, key, opts = {}) {
  const c = ctx.lookup.cite(key);
  if (!c) return null;
  const box = h('p', { class: 'cite', 'data-grade': c.grade, 'data-key': c.key, 'data-source': c.source });
  box.append(h('span', { class: 'gchip', 'data-grade': c.grade }, c.grade), ' ');
  if (c.grade === 'B' && c.via) {
    box.append(h('span', { class: 'cite-label' }, rich(c.ref?.display ?? c.label)), ' ', h('span', { class: 'cite-via' }, 'as reported in ' + c.via.work + (c.via.page ? ', ' + c.via.page : '')));
  } else if (c.ref?.display) {
    box.append(h('span', { class: 'cite-label' }, rich(c.ref.display)));
  } else {
    box.append(h('span', { class: 'cite-label' }, rich(c.label)));
    const loc = c.ref?.display || locatorText(c);
    if (loc) box.append(' ', h('span', { class: 'cite-loc' }, rich(loc)));
  }
  // a screenshot with the page not shown needs no chip (page numbers are not hunted for)
  if (c.grade === 'C' && !(c.screenshot && c.locator?.page_status === 'not shown')) box.append(' ', h('span', { class: 'chip cite-chip', 'data-chip': 'amber' }, 'page needed'));
  if (c.quote && opts.quote !== false) box.append(' ', h('span', { class: 'cite-quote' }, rich(c.quote)));
  return box;
}

// The sources rail: x 1290-1872, y 888-1056. state.rail, at most two quoted rows; state.cite goes to the source view only.
export function mountRail(ctx) {
  const el = h('aside', { id: 'rail', 'aria-label': 'Sources', hidden: true });
  const list = h('ul', { class: 'rail-list' });
  el.append(list);
  const over = () => el.scrollHeight > el.clientHeight + 1;
  // If 22 px is still too much, the last quote ends in an ellipsis at a word, so the box never cuts through a line.
  // The whole quote stays in the source view.
  const shrink = () => {
    delete list.dataset.tight;
    fit(list, 24, 22, over);
    if (over()) { list.dataset.tight = '1'; fit(list, 24, 22, over); }   // then tighter leading before any quote is cut
    const q = [...list.querySelectorAll('.cite-quote')].pop();
    if (!q || !over()) return;
    const full = q.textContent;
    const words = full.split(' ');
    while (words.length > 3 && over()) { words.pop(); q.textContent = words.join(' ') + ' …'; }
    list.dataset.cut = '1';
  };
  return {
    el,
    render(state) {
      const items = (state.rail || []).slice(0, 2).map((k) => renderCite(ctx, k)).filter(Boolean);
      list.replaceChildren(...items.map((c) => h('li', { class: 'rail-item' }, c)));
      el.hidden = !items.length;
      el.dataset.empty = items.length ? '0' : '1';
      if (items.length) shrink();
    },
    refit() { if (!el.hidden) shrink(); },
  };
}
