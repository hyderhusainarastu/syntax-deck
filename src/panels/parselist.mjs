import { h, rich, greek, featureWords, posWord, fit } from './util.mjs';

export const MISSING_NOTE = 'No parse in this build';
export const EXTRA_NOTE = 'Outside this passage';
export const BASIS = { morpheus: 'Morpheus', check: 'External check', override: 'Editor’s reading' };

// The ledger: #parse holds rows (at most 3) or the derivation row; #reason holds the press's reason line.
export function mountParse(ctx) {
  const el = h('section', { id: 'parse', 'aria-label': 'Parse', hidden: true });
  const reason = h('p', { id: 'reason', hidden: true });
  const L = ctx.lookup;

  const sourceOf = (id) => {
    const r = L.row(id), via = r?.basis?.via;
    return BASIS[via] || via || '';
  };
  const rowEl = (row, state) => {
    const ids = row.ids, first = ids[0];
    const rs = ids.map((i) => L.row(i)), fs = ids.map((i) => L.form(i));
    const r0 = rs[0];
    const e = h('div', { class: 'pl-row', 'data-id': first, 'data-basis': r0?.basis?.via ?? null, 'data-pair': ids.length > 1 ? '1' : null, 'data-restate': row.restate ? '1' : null });
    if (!r0) { e.append(greek(fs.map((f) => f?.text).join(' '), 'pl-form'), h('span', { class: 'pl-note' }, L.isExtra(first) ? EXTRA_NOTE : MISSING_NOTE)); return e; }
    const cell = (cls, ...kids) => h('span', { class: 'pl-c ' + cls }, ...kids);
    e.append(
      cell('pl-form', ...ids.map((i, n) => [n ? ' ' : '', greek(fs[n]?.text ?? '')])),
      cell('pl-lemma', ...rs.map((r, n) => [n ? ' · ' : '', greek(r.lemma)])),
      cell('pl-pos', rs.map((r) => posWord(r)).join(' · ')),
      cell('pl-feat', rs.map((r, n) => featureWords(r, state.open?.[ids[n]])).filter(Boolean).join(' / ')),
      cell('pl-gloss', rich(rs.map((r) => r.gloss).join(' · '))),
      cell('pl-src', ...[...new Set(ids.map(sourceOf))].map((t, n) => [n ? ' / ' : '', t])));
    return e;
  };

  const derive = (d) => {
    const g = d.grade;
    const c = (cls, label, ...kids) => h('div', { class: 'dv-cell ' + cls }, h('span', { class: 'dv-h' }, label), h('span', { class: 'dv-v' }, ...kids));
    return h('div', { class: 'dv-row', 'data-grade': g || null },
      c('dv-form', 'Form', rich(d.form)), c('dv-fact', 'Grammar', rich(d.fact)), c('dv-move', 'Move', rich(d.move)),
      c('dv-page', d.page ? 'Page' : 'Reference', rich(d.page ? 'p. ' + d.page : d.ref || ''), g === 'C' && !d.page ? h('span', { class: 'chip cite-chip', 'data-chip': 'amber' }, 'page needed') : null),
      c('dv-limit', 'Limit', rich(d.limit)));
  };

  return {
    el, extra: [reason],
    render(state) {
      el.replaceChildren();
      if (state.derive) el.append(derive(state.derive));
      else if ((state.rows || []).length) el.append(h('div', { class: 'pl-list', 'data-count': state.rows.reduce((n, r) => n + (r.pair ? 1 : r.ids.length), 0) }, state.rows.flatMap((r) => (r.pair ? [r] : r.ids.map((id) => ({ ...r, ids: [id] })))).map((r) => rowEl(r, state))));
      el.hidden = !el.childNodes.length;
      el.dataset.empty = el.hidden ? '1' : '0';
      reason.textContent = '';
      reason.append(rich(state.reason || ''));
      reason.hidden = !state.reason;
      // fit after paint-independent measure: shrink only when something would be cut
      if (!el.hidden) {
        el.querySelectorAll('.pl-row').forEach((r) => {
          const src = r.querySelector('.pl-src'), rest = [...r.children].filter((c) => c !== src);
          const tall = (c) => c.scrollHeight > r.clientHeight + 1;
          fit(r, 28, 26, () => rest.some((c) => tall(c) || c.scrollWidth > c.clientWidth + 1));
          // A long source string wraps and then shrinks inside its own row (floor 17 in a 3-row band), so the band never grows.
          if (src && tall(src)) {
            for (let px = 22; px >= 17; px -= 0.5) { src.style.fontSize = `calc(${px} * var(--u))`; src.style.lineHeight = '1.02'; if (!tall(src)) break; }
          }
        });
        const dv = el.querySelector('.dv-row');
        if (dv) fit(dv, 26, 22, () => [...dv.children].some((c) => c.scrollHeight > c.clientHeight + 1));
      }
      reason.style.lineHeight = '';
      if (!reason.hidden) { fit(reason, 28, 26); if (reason.dataset.over === '1') { reason.style.lineHeight = '1.3'; fit(reason, 28, 24); } }
    },
  };
}
