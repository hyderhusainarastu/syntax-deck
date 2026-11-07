import { h, rich, greek, parseWords } from './util.mjs';
import { renderCite } from './cite.mjs';
import { MISSING_NOTE, EXTRA_NOTE, BASIS } from './parselist.mjs';

// Parse card. Opened by the engine's `card` event; docks over #parse and scrolls inside itself.
export function mountCard(ctx) {
  const close = h('button', { type: 'button', class: 'ov-close cd-close', 'aria-label': 'Close card' }, '×');
  const body = h('div', { class: 'cd-body' });
  const el = h('aside', { id: 'card', role: 'dialog', 'aria-label': 'Word card', hidden: true, tabindex: '-1' }, close, body);
  close.addEventListener('click', () => ctx.deck.closeCard());
  const sec = (cls, label, ...kids) => h('section', { class: 'cd-sec ' + cls }, h('h3', { class: 'cd-h' }, label), ...kids);

  const basisText = (r) => {
    const via = r.basis?.via;
    return via ? 'Basis: ' + (BASIS[via] || via) : null;
  };

  function build(id) {
    body.replaceChildren();
    const f = ctx.lookup.form(id);
    if (!f) return false;
    const r = ctx.lookup.row(id);
    body.append(h('div', { class: 'cd-top' }, greek(f.text, 'cd-form')));
    el.dataset.id = id;
    if (!r) {
      el.dataset.kind = ctx.lookup.isExtra(id) ? 'extra' : 'missing';
      body.append(h('p', { class: 'cd-note' }, ctx.lookup.isExtra(id) ? EXTRA_NOTE : MISSING_NOTE));
      return true;
    }
    el.dataset.kind = 'row';
    el.dataset.via = r.basis?.via || '';
    body.append(
      h('div', { class: 'cd-id' }, greek(r.lemma, 'cd-lemma'), ' ', h('span', { class: 'cd-parse' }, parseWords(r)), ' ', r.gloss ? h('span', { class: 'cd-gloss' }, rich(r.gloss)) : null));
    const bt = basisText(r);
    if (bt) body.append(h('p', { class: 'cd-basis', 'data-via': r.basis?.via || '' }, bt));
    if (r.override?.reason) {
      const srcs = (r.override.sources || []).map((k) => renderCite(ctx, k)).filter(Boolean);
      body.append(sec('cd-override', 'Why this reading', h('p', null, rich(r.override.reason)), ...srcs));
    }
    if (r.why) body.append(sec('cd-why', 'Why this form', h('p', null, rich(r.why))));
    if (r.syntax) body.append(sec('cd-syntax', 'In the clause', h('p', null, rich(r.syntax))));
    if (r.alternatives?.length) {
      body.append(sec('cd-alts', 'Other readings', h('ul', { class: 'cd-alt-list' }, r.alternatives.map((a) => h('li', { class: 'cd-alt' },
        h('span', { class: 'cd-alt-parse' }, greek(a.analysis?.lemma || ''), ' ', parseWords(a.analysis)),
        a.reading ? h('p', { class: 'cd-alt-reading' }, rich(a.reading)) : null,
        a.rejected ? h('p', { class: 'cd-alt-no' }, 'Not chosen: ', rich(a.rejected)) : null,
        ...(a.sources || []).map((k) => renderCite(ctx, k)).filter(Boolean))))));
    }
    const cites = (r.sources || []).map((k) => ctx.lookup.cite(k)).filter(Boolean);
    const lsj = cites.filter((c) => c.source === 'LSJ'), rest = cites.filter((c) => c.source !== 'LSJ');
    if (lsj.length) body.append(sec('cd-lsj', 'Dictionary', ...lsj.map((c) => renderCite(ctx, c.key))));
    if (rest.length) body.append(sec('cd-src', 'Sources', ...rest.map((c) => renderCite(ctx, c.key))));
    return true;
  }

  return {
    el,
    show(id) {
      if (!id) { this.hide(); return; }
      if (!build(id)) { this.hide(); return; }
      el.hidden = false;
      body.scrollTop = 0;
      ctx.ov.push('card', () => { ctx.deck.closeCard(); this.hide(); });
    },
    hide() {
      el.hidden = true;
      body.replaceChildren();
      delete el.dataset.id;
      ctx.ov.drop('card');
    },
    isOpen: () => !el.hidden,
    id: () => el.dataset.id || null,
  };
}
