import { h, rich } from './util.mjs';

// The skipped words (section 10). Greek is drawn by the engine; here only the speaker labels beside it and
// the English below. Nothing here holds a Greek word.
export function mountSkipped(ctx) {
  const el = h('section', { id: 'skipped', 'aria-label': 'The skipped words', hidden: true });
  return {
    el,
    render(state) {
      el.replaceChildren();
      const v = state.view || {};
      el.hidden = v.mode !== 'skipped';
      if (el.hidden) return;
      const L = ctx.deck.current?.();
      const turns = v.turns || [];
      turns.forEach((t, n) => {
        const y = L?.turns?.[n]?.y;
        const who = h('span', { class: 'sk-who', 'data-speaker': t.speaker }, t.speaker);
        if (y != null) who.style.top = `calc(${y + 30} * var(--u))`;
        el.append(who);
      });
      el.append(h('div', { class: 'sk-text' }, turns.map((t) => h('p', { class: 'sk-turn', 'data-speaker': t.speaker }, h('span', { class: 'sk-sp' }, t.speaker + ' '), rich(t.text)))));
    },
  };
}
