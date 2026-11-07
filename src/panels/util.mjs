// Shared helpers for the panels. DOM is always built with textContent, never innerHTML.

export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

const G = '\\u0370-\\u03FF\\u1F00-\\u1FFF';
const GREEK_RUN = new RegExp(`[${G}][${G}\\u0300-\\u036F\\u2019\\u00B7]*(?: (?=[${G}])[${G}][${G}\\u0300-\\u036F\\u2019\\u00B7]*)*`, 'g');

// Text with Greek runs wrapped in <span class="grc" lang="grc"> so --font-greek applies.
export function rich(text) {
  const f = document.createDocumentFragment();
  const s = String(text ?? '');
  let last = 0, m;
  GREEK_RUN.lastIndex = 0;
  while ((m = GREEK_RUN.exec(s))) {
    if (m.index > last) f.append(document.createTextNode(s.slice(last, m.index)));
    f.append(h('span', { class: 'grc', lang: 'grc', text: m[0] }));
    last = m.index + m[0].length;
  }
  if (last < s.length) f.append(document.createTextNode(s.slice(last)));
  return f;
}
export function greek(text, cls) { return h('span', { class: 'grc' + (cls ? ' ' + cls : ''), lang: 'grc', text }); }

const POS = { noun: 'noun', adj: 'adjective', article: 'article', pron: 'pronoun', verb: 'verb', 'verbal-adj': 'verbal adjective', adv: 'adverb', prep: 'preposition', conj: 'conjunction', particle: 'particle' };
const W = {
  case: { nom: 'nominative', gen: 'genitive', dat: 'dative', acc: 'accusative', voc: 'vocative' },
  number: { sg: 'singular', dual: 'dual', pl: 'plural' },
  gender: { masc: 'masculine', fem: 'feminine', neut: 'neuter' },
  person: { 1: '1st person', 2: '2nd person', 3: '3rd person' },
  tense: { pres: 'present', impf: 'imperfect', fut: 'future', aor: 'aorist', perf: 'perfect', plup: 'pluperfect' },
  mood: { ind: 'indicative', subj: 'subjunctive', opt: 'optative', imper: 'imperative', inf: 'infinitive', ptc: 'participle' },
  voice: { act: 'active', mid: 'middle', pass: 'passive', midpass: 'middle or passive' },
  degree: { pos: 'positive', comp: 'comparative', superl: 'superlative' },
};
// Parse in full words, from features only. Never derived from the Greek.
export function parseWords(a) {
  if (!a) return '';
  const f = a.features || {};
  const w = (k) => (f[k] != null ? (W[k][f[k]] ?? String(f[k])) : null);
  const verbal = ['tense', 'voice', 'mood'].map(w).filter(Boolean).join(' ');
  const agree = ['person', 'case', 'number', 'gender', 'degree'].map(w).filter(Boolean).join(' ');
  return [POS[a.pos] ?? a.pos, verbal, agree].filter(Boolean).join(', ');
}

// Features in full words, without the part of speech: "dative plural neuter present participle passive".
// A step's `open` value stands in for the stored case (a slash-separated list of case abbreviations), spelled in full words like the rest.
export const openCase = (v) => String(v).split('/').map((c) => W.case[c] ?? c).join(' / ');
export function featureWords(a, open = null) {
  if (!a) return '';
  const f = { ...(a.features || {}) };
  if (open) f.case = '\u0001';
  return ['case', 'number', 'gender', 'person', 'tense', 'mood', 'voice', 'degree']
    .map((k) => (f[k] != null ? (f[k] === '\u0001' ? openCase(open) : (W[k][f[k]] ?? String(f[k]))) : null)).filter(Boolean).join(' ');
}
export const posWord = (a) => (a ? (POS[a.pos] ?? a.pos ?? '') : '');

// Deepest active construction containing a token (the engine's data-c rule).
export function typeOf(lookup, state, id) {
  let best = null, bd = -1;
  for (const nid of state.tree || []) {
    if (lookup.span(nid).includes(id)) {
      const d = lookup.depth(nid);
      if (d > bd) { bd = d; best = nid; }
    }
  }
  if (!best) return null;
  return lookup.trees[best.split('.')[0]]?.byId.get(best)?.type ?? null;
}

// Shrink a block's font from `max` to `min` stage px until nothing overflows. Line pitch is set in CSS in
// stage px, so a smaller font only ever frees lines; the box is a whole number of lines, so a cut can only
// fall between lines. Returns the size used; data-over="1" is left when even `min` does not fit.
export function fit(el, max, min, over) {
  if (!el || el.hidden) return max;
  const test = over || (() => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
  let px = max;
  for (; px >= min; px -= 0.5) {
    el.style.fontSize = `calc(${px} * var(--u))`;
    if (!test()) { el.dataset.over = '0'; el.dataset.fit = String(px); return px; }
  }
  px = min;
  el.style.fontSize = `calc(${px} * var(--u))`;
  el.dataset.over = '1'; el.dataset.fit = String(px);
  return px;
}

const isExtraId = (id) => /^(g|v)\.\d+$/.test(id);

// Indexes over window.__DATA__.
export function buildLookup(data) {
  const tok = new Map();
  for (const t of data.tokens || []) tok.set(t.id, t);
  const extras = new Map();
  for (const t of data.gap?.gapSentence || []) extras.set(t.id, t);
  if (data.gap?.variant) extras.set(data.gap.variant.id || 'v.01', data.gap.variant);
  const rows = new Map();
  for (const S of Object.keys(data.parses || {})) for (const id of Object.keys(data.parses[S])) rows.set(id, data.parses[S][id]);
  const gOf = (id) => tok.get(id)?.g ?? 0;

  const trees = {};
  for (const S of Object.keys(data.tree || {})) {
    const nodes = data.tree[S].nodes || [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const kids = new Map();
    for (const n of nodes) if (n.parent) (kids.get(n.parent) || kids.set(n.parent, []).get(n.parent)).push(n.id);
    const depth = (id) => { let d = 0, n = byId.get(id); while (n && n.parent) { d++; n = byId.get(n.parent); } return d; };
    const spanMemo = new Map();
    const span = (id) => {
      if (spanMemo.has(id)) return spanMemo.get(id);
      const n = byId.get(id);
      const out = n ? [...n.tokens] : [];
      for (const k of kids.get(id) || []) out.push(...span(k));
      out.sort((a, b) => gOf(a) - gOf(b));
      spanMemo.set(id, out);
      return out;
    };
    trees[S] = { nodes, byId, kids, depth, span, root: data.tree[S].root };
  }
  const nodeSentence = (id) => String(id).split('.')[0];
  const tokenSentence = (id) => { const t = tok.get(id); return t ? 'S' + t.s : null; };
  return {
    tok, extras, rows, trees, depth: (id) => trees[nodeSentence(id)]?.depth(id) ?? 0,
    span: (id) => trees[nodeSentence(id)]?.span(id) ?? [],
    isExtra: isExtraId, tokenSentence,
    form: (id) => tok.get(id) ?? extras.get(id) ?? null,
    row: (id) => rows.get(id) ?? null,
    cite: (key) => {
      const c = data.cites?.[key];
      return c && c.grade && c.grade !== 'D' ? c : null; // grade D is never shown
    },
  };
}

// Overlay stack: Esc closes the top one.
export function makeOverlays() {
  const stack = [];
  const closers = new Map();
  return {
    push(name, onClose) {
      const i = stack.indexOf(name);
      if (i >= 0) stack.splice(i, 1);
      stack.push(name);
      closers.set(name, onClose);
    },
    drop(name) { const i = stack.indexOf(name); if (i >= 0) stack.splice(i, 1); closers.delete(name); },
    top: () => stack[stack.length - 1] || null,
    has: (name) => stack.includes(name),
    closeTop() { const n = stack[stack.length - 1]; if (!n) return false; const f = closers.get(n); stack.pop(); closers.delete(n); f && f(); return true; },
    size: () => stack.length,
  };
}

const FOCUSABLE = 'button:not([disabled]), input, [href], [tabindex]:not([tabindex="-1"])';
// Keep Tab inside an overlay and keep its keys away from the deck.
export function trapKeys(root) {
  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Tab') {
      const f = [...root.querySelectorAll(FOCUSABLE)].filter((x) => !x.closest('[hidden]'));
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if (e.key !== 'Escape') e.stopPropagation();
  });
}
