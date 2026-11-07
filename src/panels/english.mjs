import { h, typeOf } from './util.mjs';

// English spine. Slots are absolute: positions come from computeSpine(S), once per
// sentence, from the widest form of each slot at 40 px. Nothing reflows; a slot's width is its widest state,
// so blank -> arrow -> "is" and every fill happen in place. FLIP only when state.spine arrives at 'running'.
const LINE_W = 1824, PITCH = 46, FONT = 40, BASELINE = 38, NS = 'http://www.w3.org/2000/svg';
const brk = (t) => (t.includes('[') ? t : `[${t}]`);
// Text of one slot in one state. `0..n` indexes `stages`. Brackets only on `prov`.
export function slotText(s, st) {
  if (st === 'blank') return s.blank ?? '';
  if (st === 'prov') return brk(s.text);
  if (typeof st === 'number') return (s.stages && s.stages[st] != null) ? s.stages[st] : s.text;
  return s.text;
}
const forms = (s, prov) => [s.text, ...(prov ? [brk(s.text)] : []), s.blank ?? '', ...(s.stages || [])];

let probe = null;
function width(txt) {
  if (!probe) {
    probe = document.createElement('span');
    probe.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font:400 ${FONT}px/1 var(--font-body)`;
    document.body.append(probe);
  }
  probe.textContent = txt;
  return probe.getBoundingClientRect().width;
}

// Exported pure-ish: given slots and a width function, returns positions for 'slots' and 'running'.
export function computeSpine(slots, w = (s) => Math.max(...forms(s, false).map(width))) {
  const GAP = width(' '); // one word space, as the measured running widths use
  const W = new Map(slots.map((s) => [s.id, w(s)]));
  const pos = new Map();
  const base = slots.filter((s) => !s.under), hung = slots.filter((s) => s.under);
  let line = 0;
  const depthOn = (L) => hung.reduce((m, s) => (pos.get(s.under)?.y === L ? Math.max(m, s.row - (slots.find((p) => p.id === s.under)?.row ?? 0)) : m), 0);
  for (const r of [...new Set(base.map((s) => s.row))].sort((a, b) => a - b)) {
    let x = 0;
    for (const s of base.filter((b) => b.row === r)) {
      const sw = W.get(s.id);
      if (x > 0 && x + sw > LINE_W) { line += 1 + depthOn(line); x = 0; }
      pos.set(s.id, { x, y: line, w: sw });
      x += sw + GAP;
    }
    line += 1 + depthOn(line);
  }
  for (const s of hung) {
    const p = pos.get(s.under), pr = slots.find((q) => q.id === s.under)?.row ?? 0;
    const sw = W.get(s.id);
    const x = Math.max(0, Math.min((p?.x ?? 0) + 18, LINE_W - sw));
    pos.set(s.id, { x, y: (p?.y ?? 0) + (s.row - pr), w: sw, hung: true });
  }
  const run = new Map();
  let x = 0, y = 0;
  for (const s of slots) {
    const sw = W.get(s.id);
    if (x > 0 && x + sw > LINE_W) { y++; x = 0; }
    run.set(s.id, { x, y, w: sw });
    x += sw + GAP;
  }
  const lines = (m) => Math.max(0, ...[...m.values()].map((p) => p.y)) + 1;
  return { pos, run, lines: lines(pos), runLines: lines(run) };
}

const svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); return e; };

export function mountEnglish(ctx) {
  const el = h('section', { id: 'en', 'aria-label': 'English', hidden: true });
  const lay = h('div', { class: 'en-slots' });
  const tie = svg('svg', { class: 'en-ties', 'aria-hidden': 'true', viewBox: `0 0 ${LINE_W} 150`, width: '100%', height: '100%' });
  const stemG = svg('g', { class: 'en-stems' }), tieG = svg('g', { class: 'en-tieset' });
  tie.append(stemG, tieG);
  el.append(lay, tie);
  const home = h('section', { id: 'homeen', 'aria-label': 'English so far', hidden: true });

  let S = null, spine = null, els = new Map(), slotsOf = [], cur = null, lastI = -1, lastEn = {}, newSet = new Set(), mode = 'slots';
  const k = () => ctx.deck.box?.().k ?? 1;
  const reduced = () => document.documentElement.classList.contains('reduced');
  const calc = (n) => `calc(${n} * var(--u))`;

  function build(sentence) {
    ensureFont();
    S = sentence; slotsOf = ctx.data.en?.[S]?.slots || [];
    // a slot reserves its bracketed form only if some step ever shows it as `prov`
    const prov = new Set();
    for (const st of ctx.data.steps || []) for (const k in st.en || {}) if (st.en[k] === 'prov') prov.add(k);
    spine = computeSpine(slotsOf, (s) => Math.max(...forms(s, prov.has(`${S}.${s.id}`)).map(width)));
    els = new Map();
    lay.replaceChildren();
    for (const s of slotsOf) {
      const e = h('span', { class: 'slot', 'data-slot': `${S}.${s.id}`, 'data-state': 'off' });
      e.style.width = calc(spine.pos.get(s.id).w);
      els.set(s.id, e); lay.append(e);
    }
    tieG.replaceChildren(); stemG.replaceChildren();
  }
  const place = (m) => { for (const s of slotsOf) { const p = m.get(s.id), e = els.get(s.id); e.style.left = calc(p.x); e.style.top = calc(6 + PITCH * p.y); } };

  function stems(state) {
    stemG.replaceChildren();
    if (mode === 'running') return;
    for (const s of slotsOf) {
      if (!s.under) continue;
      if ((state.en?.[`${S}.${s.id}`] ?? 'off') === 'off') continue;
      const p = spine.pos.get(s.under), q = spine.pos.get(s.id);
      const x = p.x + 8, y0 = 6 + PITCH * p.y + BASELINE + 6, y1 = 6 + PITCH * q.y + 24;
      stemG.append(svg('path', { d: `M${x} ${y0}V${y1}H${q.x - 4}`, class: 'en-stem' }));
    }
  }

  const DASH = { predicate: null, describes: '14 8', connects: '0.1 8', resumes: '14 5 2 5' };
  function renderTies(state = cur) {
    tieG.replaceChildren();
    if (!state || !spine || mode === 'running' || state.spine === 'off') return;
    const marks = [...(state.marks?.keep || []), ...(state.marks?.add || [])];
    const seen = new Set();
    for (const m of marks) {
      if (!m || !m.spine || m.dormant || seen.has(m.key)) continue;
      seen.add(m.key);
      const a = String(m.sa).split('.').pop(), b = String(m.sb).split('.').pop();
      const p = spine.pos.get(a), q = spine.pos.get(b);
      if (!p || !q) continue;
      const rank = m.rank ?? 3, sw = rank === 1 ? 6 : 2.5;
      const g = svg('g', { class: 'en-tie', 'data-key': m.key, 'data-rel': m.rel, 'data-rank': rank, 'data-c': m.type || '' });
      const y = 6 + PITCH * (p.y === q.y ? p.y : q.y) + BASELINE + 3;
      let d, tip;
      if (p.y === q.y) {
        const fwd = q.x >= p.x;
        const x0 = fwd ? p.x : p.x + p.w, x1 = fwd ? q.x + q.w : q.x;
        d = `M${x0} ${y}H${x1}`; tip = { x: x1, y, dir: fwd ? 1 : -1 };
      } else {
        const hi = p.y < q.y ? p : q, lo = hi === p ? q : p;
        const yy = 6 + PITCH * lo.y + BASELINE + 3;
        d = `M${hi.x + 8} ${6 + PITCH * hi.y + BASELINE + 6}V${yy}H${lo.x - 4}`; tip = { x: lo.x - 4, y: yy, dir: 1 };
      }
      const paint = (off, w) => svg('path', { d, transform: off ? `translate(0 ${off})` : null, 'stroke-width': w, 'stroke-dasharray': DASH[m.rel] || null, 'stroke-linecap': m.rel === 'connects' ? 'round' : 'butt', fill: 'none' });
      const clean = (e) => { if (!e.getAttribute('transform')) e.removeAttribute('transform'); if (!e.getAttribute('stroke-dasharray')) e.removeAttribute('stroke-dasharray'); return e; };
      if (m.rel === 'predicate') { g.append(clean(paint(-2, sw / 3)), clean(paint(2, sw / 3))); }
      else g.append(clean(paint(0, sw)));
      if (m.rel === 'predicate') g.append(svg('path', { d: `M${tip.x} ${tip.y}l${-9 * tip.dir} -6v12z`, class: 'en-head' }));
      else if (m.rel === 'describes' || m.rel === 'resumes') g.append(svg('path', { d: `M${tip.x - 9 * tip.dir} ${tip.y - 6}L${tip.x} ${tip.y}L${tip.x - 9 * tip.dir} ${tip.y + 6}`, class: 'en-head open', fill: 'none' }));
      tieG.append(g);
    }
  }

  function flip(from) {
    if (reduced()) return;
    const kk = k();
    for (const s of slotsOf) {
      const e = els.get(s.id), a = from.get(s.id), b = spine.run.get(s.id);
      const dx = (a.x - b.x) * kk, dy = (PITCH * (a.y - b.y)) * kk;
      if (!dx && !dy) continue;
      e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 900, easing: 'cubic-bezier(.3,.1,.2,1)' });
    }
  }

  function homeText(state) {
    home.replaceChildren();
    const v = state.view || {};
    const list = v.mode === 'final' ? ['S1', 'S2', 'S3', 'S4'] : (v.mode === 'home' ? (v.sentences || []) : []);
    for (const s of list) {
      const t = (ctx.data.en?.[s]?.slots || []).map((x) => x.text).join(' ');
      home.append(h('p', { class: 'he-s', 'data-sentence': s }, t));
    }
    home.hidden = !list.length;
  }

  // Widths are measured in the real face. If it is not loaded yet, lay the sentence out again once it is.
  const relayout = () => { if (cur && S) { const c = cur; S = null; probe?.remove(); probe = null; lastI = -1; api.render(c, { immediate: true }); } };
  const needFont = () => { try { return !document.fonts.check('40px "Gentium Book Plus"', 'Well then'); } catch (e) { return false; } };
  const ensureFont = () => { if (needFont()) document.fonts.load('40px "Gentium Book Plus"', 'Well then').then(relayout, () => {}); };
  const api = {
    el, home,
    renderTies,
    // `ev` is the apply payload: it carries prev and immediate.
    render(state, ev = {}) {
      cur = state;
      homeText(state);
      const on = state.spine && state.spine !== 'off' && state.sentence && ctx.data.en?.[state.sentence];
      el.hidden = !on;
      el.dataset.empty = on ? '0' : '1';
      if (!on) { tieG.replaceChildren(); stemG.replaceChildren(); lastI = state.i; lastEn = {}; newSet = new Set(); return; }
      const fresh = S !== state.sentence;
      if (fresh) { build(state.sentence); lastEn = {}; }
      const prevMode = mode;
      mode = state.spine === 'running' ? 'running' : 'slots';
      if (state.i !== lastI) {
        // the changed slots of this press only
        newSet = new Set();
        // against the step before it in the deck, not the last one painted, so back and a jump read the same as forward
        const before = ctx.deck.steps?.[state.i - 1]?.en ?? {};
        for (const s of slotsOf) { const key = `${S}.${s.id}`, v = state.en?.[key] ?? 'off'; if (v !== 'off' && v !== (before[key] ?? 'off')) newSet.add(key); }
        lastEn = {}; for (const s of slotsOf) lastEn[`${S}.${s.id}`] = state.en?.[`${S}.${s.id}`] ?? 'off';
        lastI = state.i;
      }
      const old = new Map(spine.pos);
      place(mode === 'running' ? spine.run : spine.pos);
      for (const s of slotsOf) {
        const key = `${S}.${s.id}`, v = state.en?.[key] ?? 'off', e = els.get(s.id);
        const kind = typeof v === 'number' ? 'stage' : v;
        e.dataset.state = kind;
        if (kind === 'stage') e.dataset.stage = String(v); else delete e.dataset.stage;
        const txt = v === 'off' ? s.text : slotText(s, v);
        if (e.textContent !== txt) e.textContent = txt;
        const c = s.tokens?.[0] ? typeOf(ctx.lookup, state, s.tokens[0]) : null;
        if (c) e.dataset.c = c; else delete e.dataset.c;
        // a blank that holds a glyph (the arrow) is not an underscore
        if (kind === 'blank' && !/_/.test(txt)) e.dataset.glyph = '1'; else delete e.dataset.glyph;
        if (newSet.has(key)) e.dataset.new = '1'; else delete e.dataset.new;
      }
      el.dataset.mode = mode;
      stems(state);
      if (mode === 'running' && prevMode !== 'running' && !fresh && !ev.immediate) flip(old);
      if (ev.immediate) renderTies(state); else tieG.replaceChildren();
    },
  };
  return api;
}
