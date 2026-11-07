import { h, rich, typeOf } from './util.mjs';

// Words on stage this press: the keys of state.st plus the wings. Ticks only; no Greek.
export function scopeSet(state) {
  return new Set([...Object.keys(state.st || {}), ...(state.wings || [])]);
}

const KEY = { finite: 'finite', ptc: 'participle', conj: 'conjunct', gabs: 'genitive absolute', indst: 'infinitive construction', analogy: 'analogy' };

export function mountRibbon(ctx) {
  const head = h('h1', { class: 'rb-head' });
  const sub = h('p', { class: 'rb-sub' });
  const title = h('div', { class: 'rb-title' }, head, sub);
  const ticks = h('div', { class: 'rb-ticks', 'aria-hidden': 'true' });
  const key = h('ul', { class: 'rb-key', 'aria-label': 'Constructions met' });
  const el = h('header', { id: 'ribbon', 'aria-label': 'Step' }, title, ticks, key);
  return {
    el,
    render(state) {
      head.replaceChildren(rich(state.head || ''));
      sub.replaceChildren(rich(state.sub || ''));
      sub.hidden = !state.sub;
      const skipped = state.view?.mode === 'skipped';
      const sentence = state.sentence;
      const toks = skipped ? [] : sentence ? ctx.data.tokens.filter((t) => 'S' + t.s === sentence) : ctx.data.tokens;
      const scope = scopeSet(state), parsed = new Set(state.parsed || []), focus = new Set(state.focus || []), wings = new Set(state.wings || []);
      ticks.replaceChildren();
      ticks.dataset.sentence = sentence || '';
      let prevS = null;
      for (const t of toks) {
        const c = typeOf(ctx.lookup, state, t.id);
        ticks.append(h('i', { class: 'rb-tick', 'data-id': t.id, 'data-tick': parsed.has(t.id) ? 'parsed' : 'pending', 'data-wing': wings.has(t.id) ? '1' : null, 'data-f': focus.has(t.id) ? '1' : null, 'data-c': c, 'data-scope': scope.has(t.id) ? '1' : null, 'data-first': prevS !== null && prevS !== t.s ? '1' : null }));
        prevS = t.s;
      }
      key.replaceChildren(...(state.met || []).filter((m) => KEY[m]).map((m) => h('li', { class: 'rb-k', 'data-c': m }, h('span', { class: 'rb-kl' }, KEY[m]))));
    },
  };
}
