// refs.mjs: token tables, selector expansion and {id} / {id..id} reference resolution.
export const TOKEN_RE = /^(?:s[1-4]\.\d\d|g\.\d\d|v\.\d\d)$/;
export const NODE_RE = /^S[1-4](?:\.[a-z][a-z0-9]*)?$/;
const REF_RE = /\{([^{}]*)\}/g;

// tokens: data/locked/tokens.json; gap: data/locked/gap.json. Order: the tokens by g, then the gap sentence (g.01..), then the variant (v.01).
export function buildTable(tokens, gap) {
  const byId = new Map(), order = [];
  for (const t of tokens) { byId.set(t.id, { id: t.id, text: t.text, post: t.post ?? '', ord: t.g, s: t.s, extra: false }); }
  const extras = [...(gap?.gapSentence || []).map((t, i) => ({ ...t, ord: 1000 + i })), ...(gap?.variant ? [{ ...gap.variant, ord: 2000 }] : [])];
  for (const t of extras) byId.set(t.id, { id: t.id, text: t.text, post: t.post ?? '', ord: t.ord, s: null, extra: true });
  order.push(...[...byId.values()].sort((a, b) => a.ord - b.ord).map(t => t.id));
  const sentenceOf = (id) => { const m = /^s([1-4])\./.exec(id); return m ? `S${m[1]}` : null; };
  return { byId, order, has: (id) => byId.has(id), ord: (id) => byId.get(id).ord, sentenceOf, sentenceIds: (S) => order.filter(id => sentenceOf(id) === S) };
}

// 'a..b' -> ids in reading order, or throws. Same prefix (s1 / g), ascending.
export function expandRange(table, a, b) {
  if (!table.has(a)) throw new Error(`unknown token ${a}`);
  if (!table.has(b)) throw new Error(`unknown token ${b}`);
  const pa = a.split('.')[0], pb = b.split('.')[0];
  if (pa !== pb) throw new Error(`range ${a}..${b} crosses sentences`);
  if (pa === 'v') { if (a !== b) throw new Error(`range ${a}..${b} invalid`); return [a]; }
  const ia = table.order.indexOf(a), ib = table.order.indexOf(b);
  if (ia > ib) throw new Error(`range ${a}..${b} is not ascending`);
  return table.order.slice(ia, ib + 1);
}

// Replaces every {id} or {id..id} in a string. Reports unknown ids; returns the string with failures left as-is.
export function resolveRefs(str, table, errs, where = '') {
  if (typeof str !== 'string' || !str.includes('{')) {
    if (typeof str === 'string' && str.includes('}')) errs?.push(`${where}: stray "}" in "${str.slice(0, 50)}"`);
    return str;
  }
  return str.replace(REF_RE, (m, inner) => {
    try {
      const mm = /^((?:s[1-4]|g|v)\.\d\d)(?:\.\.((?:s[1-4]|g|v)\.\d\d))?$/.exec(inner);
      if (!mm) throw new Error(`bad reference ${m}`);
      const ids = mm[2] ? expandRange(table, mm[1], mm[2]) : [mm[1]];
      if (!table.has(ids[0])) throw new Error(`unknown token ${ids[0]}`);
      return ids.map((id, i) => { const t = table.byId.get(id); return i < ids.length - 1 ? t.text + t.post : t.text; }).join(' ');
    } catch (e) { errs?.push(`${where}: ${e.message}`); return m; }
  });
}

// Deep-applies resolveRefs to every string in a JSON-like value. Returns a new value.
export function deepRefs(v, table, errs, where = '') {
  if (typeof v === 'string') return resolveRefs(v, table, errs, where);
  if (Array.isArray(v)) return v.map((x, i) => deepRefs(x, table, errs, `${where}[${i}]`));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = deepRefs(x, table, errs, `${where}.${k}`); return o; }
  return v;
}

// Tree index: byId, children, depth, span (own + descendants, sorted by reading order).
export function treeIndex(tree, table) {
  const byId = new Map((tree?.nodes || []).map(n => [n.id, n]));
  const children = new Map();
  for (const n of byId.values()) if (n.parent != null) { if (!children.has(n.parent)) children.set(n.parent, []); children.get(n.parent).push(n.id); }
  const depth = (id) => { let d = 0, seen = new Set(), cur = byId.get(id); while (cur && cur.parent != null && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parent); d++; } return d; };
  const span = (id, seen = new Set()) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const n = byId.get(id); if (!n) return [];
    const ids = new Set(n.tokens || []);
    for (const c of children.get(id) || []) for (const t of span(c, seen)) ids.add(t);
    return [...ids].filter(t => table.has(t)).sort((a, b) => table.ord(a) - table.ord(b));
  };
  const isDescendant = (id, anc) => { let cur = byId.get(id), seen = new Set(); while (cur && cur.parent != null && !seen.has(cur.id)) { seen.add(cur.id); if (cur.parent === anc) return true; cur = byId.get(cur.parent); } return false; };
  return { byId, children, depth, span, isDescendant };
}
