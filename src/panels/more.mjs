import { h, rich } from './util.mjs';

// Collapsible drawer. Hidden entirely when the step has no `more`; open/closed persists across steps.
export function mountMore(ctx) {
  let open = false;
  try { open = localStorage.getItem('pl-more') === '1'; } catch (e) { /* file:// */ }
  const list = h('ul', { class: 'more-list', id: 'more-list' });
  const btn = h('button', { type: 'button', class: 'more-btn', 'aria-controls': 'more-list', 'aria-expanded': 'false' }, 'More');
  const el = h('aside', { id: 'more', 'aria-label': 'More', hidden: true }, btn, list);
  const sync = () => { btn.setAttribute('aria-expanded', String(open)); list.hidden = !open; el.dataset.open = open ? '1' : '0'; };
  btn.addEventListener('click', () => { open = !open; try { localStorage.setItem('pl-more', open ? '1' : '0'); } catch (e) { /* ignore */ } sync(); });
  sync();
  return {
    el,
    render(state) {
      const items = state.more || [];
      list.replaceChildren(...items.map((t) => h('li', { class: 'more-item' }, rich(t))));
      el.hidden = !items.length;
      el.dataset.empty = items.length ? '0' : '1';
      sync();
    },
  };
}
