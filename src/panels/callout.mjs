import { h, rich } from './util.mjs';

// Callouts sit beside their word on the boards, in --amber. Position from deck.rect(at).
export function mountCallout(ctx) {
  const el = h('div', { id: 'callout', 'aria-label': 'Notes on this word', hidden: true });
  let items = [];
  const stagePx = (v) => v / (ctx.deck.box?.().k || 1);
  // Visible Greek and glosses, in stage px: a callout may not cover any of them.
  const busy = () => {
    const o = el.getBoundingClientRect(), k = ctx.deck.box?.().k || 1, out = [];
    for (const n of document.querySelectorAll('#tokens *, #extras *, #glosses *, #marks text')) {
      if (n.childElementCount || !n.textContent.trim()) continue;
      let hid = false;
      for (let a = n; a && a.id !== 'stage' && a !== document.body; a = a.parentElement) if (parseFloat(getComputedStyle(a).opacity) < 0.05 || getComputedStyle(a).visibility === 'hidden') { hid = true; break; }
      if (hid) continue;
      const r = n.getBoundingClientRect();
      if (r.width && r.height) out.push({ x: (r.left - o.left) / k, y: (r.top - o.top) / k, w: r.width / k, h: r.height / k });
    }
    // Whole panels are off limits too: the English strip, the ledger, the reason line and the rail.
    for (const id of ['en', 'parse', 'reason', 'rail']) {
      const n = document.getElementById(id);
      if (!n || n.hidden || n.dataset.empty === '1') continue;
      const r = n.getBoundingClientRect();
      if (r.width && r.height) out.push({ x: (r.left - o.left) / k, y: (r.top - o.top) / k, w: r.width / k, h: r.height / k });
    }
    return out;
  };
  const hit = (a, b) => a.x < b.x + b.w + 4 && a.x + a.w > b.x - 4 && a.y < b.y + b.h + 2 && a.y + a.h > b.y - 2;
  const position = () => {
    const W = ctx.deck.box?.().W ?? 1920, H = ctx.deck.box?.().H ?? 1080;
    const taken = busy();
    for (const { node, at } of items) {
      const r = at ? ctx.deck.rect?.(at) : null;
      if (!r) { node.dataset.placed = '0'; continue; }
      const w = stagePx(node.offsetWidth), hh = stagePx(node.offsetHeight);
      const cx = Math.min(Math.max(48, r.x + r.w / 2 - w / 2), W - 48 - w);
      const cands = [
        { x: r.x + r.w + 16, y: r.y + r.h / 2 - hh / 2 },
        { x: r.x - 16 - w, y: r.y + r.h / 2 - hh / 2 },
        { x: cx, y: r.y - hh - 4 },
        { x: cx, y: r.y + r.h + 4 },
      ];
      const fits = (c) => c.x >= 48 && c.x + w <= W - 48 && c.y >= 96 && c.y + hh <= H - 8 && !taken.some((t) => hit({ x: c.x, y: c.y, w, h: hh }, t));
      let c = cands.find(fits);
      if (!c) {
        // Nothing beside the word is free: scan the board for the clear spot nearest the word.
        let best = null, bd = Infinity;
        for (let y = 96; y + hh <= H - 8; y += 8) for (let x = 48; x + w <= W - 48; x += 16) {
          const q = { x, y };
          if (!fits(q)) continue;
          const d = Math.hypot(x + w / 2 - (r.x + r.w / 2), y + hh / 2 - (r.y + r.h / 2));
          if (d < bd) { bd = d; best = q; }
        }
        c = best || cands[0];
      }
      taken.push({ x: c.x, y: c.y, w, h: hh });
      node.style.left = `calc(${c.x} * var(--u))`;
      node.style.top = `calc(${Math.min(c.y, H - 8 - hh)} * var(--u))`;
      node.dataset.placed = '1';
    }
  };
  return {
    el, position,
    render(state) {
      el.replaceChildren();
      items = [];
      for (const c of state.callouts || []) {
        const cite = c.key ? ctx.lookup.cite(c.key) : null;
        const node = h('p', { class: 'co', 'data-kind': c.kind, 'data-at': c.at || null, 'data-key': c.key || null, 'data-grade': cite?.grade || null }, rich(c.text || ''));
        el.append(node); items.push({ node, at: c.at });
      }
      el.hidden = !items.length;
      el.dataset.empty = items.length ? '0' : '1';
      position();
    },
  };
}
