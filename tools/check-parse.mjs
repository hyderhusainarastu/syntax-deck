// check-parse.mjs: parses, trees, English slots and authoring obligations.
// Run: node tools/check-parse.mjs [--stub] [--scope s1]
import { makeCtx, isMain, report, readJson } from './lib/ctx.mjs';
import { loadLocked, loadTrees, loadEn, loadParses, sKey } from './lib/data.mjs';
import { NODE_RE, treeIndex } from './lib/refs.mjs';
import { compile } from './compile-steps.mjs';
import { checkAnalysis, inSet } from './lib/analysis.mjs';
import { loadMorpheus } from './lib/harvest.mjs';

const TYPES = ['finite', 'ptc', 'conj', 'gabs', 'indst', 'analogy', 'neutral'];

export async function run(ctx, pre = null) {
  const errs = [], warns = [];
  const locked = pre?.locked || loadLocked(ctx, errs);
  const { table } = locked;
  const { trees, idx } = pre ? { trees: null, idx: pre.idx } : loadTrees(ctx, table, errs);
  const treeJson = trees || Object.fromEntries(Object.entries(idx).map(([S, ix]) => [S, { nodes: [...ix.byId.values()] }]));
  const en = pre?.en || loadEn(ctx, errs);
  const parses = loadParses(ctx, errs);
  const comp = pre || await compile(ctx, { locked, trees: { idx }, en });
  if (!pre) errs.push(...comp.errs.map(e => `compile: ${e}`));
  const steps = comp.steps?.steps || [];
  const morph = loadMorpheus(ctx, errs, true);

  for (const S of ctx.sentences) {
    const k = sKey(S), ids = table.sentenceIds(S).filter(id => !table.byId.get(id).extra);
    const idSet = new Set(ids);

    // ---- parse rows
    const P = parses[S], rows = new Map();
    if (P) {
      if (!Array.isArray(P.rows) || P.rows.length !== ids.length) errs.push(`${S} parses: ${P.rows?.length} rows for ${ids.length} tokens`);
      (P.rows || []).forEach((r, i) => {
        if (rows.has(r.id)) errs.push(`${S} parses: duplicate row ${r.id}`);
        rows.set(r.id, r);
        if (r.id !== ids[i]) errs.push(`${S} parses: row ${i} is ${r.id}, expected ${ids[i]} (token order)`);
      });
      for (const id of ids) {
        const r = rows.get(id);
        if (!r) { errs.push(`${id}: no parse row`); continue; }
        const a = { lemma: r.lemma, pos: r.pos, features: r.features };
        checkAnalysis(a, `${id}`, errs);
        const m = morph?.absent ? r.basis?.via === 'morpheus' : inSet(a, morph?.forms?.[id]), c = r.basis?.via === 'check';
        const via = c ? 'check' : m ? 'morpheus' : 'override';
        if (via === 'override' && !(r.override && r.override.reason)) errs.push(`${id}: analysis is outside the Morpheus set, not marked as externally checked, and has no reasoned override`);
        if (r.basis?.via !== via) errs.push(`${id}: basis.via is "${r.basis?.via}" but the harvests give "${via}"; run npm run merge`);
      }
    }

    // ---- tree
    const T = treeJson[S], ix = idx[S];
    if (!T) { errs.push(`${S}: no tree`); }
    else {
      const nodes = T.nodes || [], byId = new Map();
      for (const n of nodes) {
        if (byId.has(n.id)) errs.push(`${S} tree: duplicate node ${n.id}`);
        byId.set(n.id, n);
        if (!NODE_RE.test(n.id || '') || !n.id.startsWith(S)) errs.push(`${S} tree: bad node id "${n.id}"`);
        if (!TYPES.includes(n.type)) errs.push(`${n.id}: unknown type "${n.type}"`);
        if (typeof n.label !== 'string' || !n.label.trim()) errs.push(`${n.id}: label missing`);
      }
      const roots = nodes.filter(n => n.parent == null);
      if (roots.length !== 1 || roots[0].id !== (T.root || S)) errs.push(`${S} tree: expected one root ${T.root || S}, found [${roots.map(n => n.id)}]`);
      const count = new Map();
      for (const n of nodes) {
        if (n.parent != null) {
          if (!byId.has(n.parent)) errs.push(`${n.id}: parent ${n.parent} does not exist`);
          else { let cur = n, seen = new Set(); while (cur?.parent != null && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parent); } if (cur && cur.parent != null) errs.push(`${n.id}: parent chain loops`); else if (cur && cur.id !== roots[0]?.id) errs.push(`${n.id}: parent chain does not reach the root`); }
        }
        for (const t of n.tokens || []) {
          if (!idSet.has(t)) errs.push(`${n.id}: token ${t} is not in ${S}`);
          count.set(t, (count.get(t) || 0) + 1);
        }
      }
      for (const id of ids) { const c = count.get(id) || 0; if (c !== 1) errs.push(`${S} tree does not partition the sentence: ${id} is in ${c} nodes`); }
      const ixr = treeIndex({ nodes }, table);
      for (const n of nodes) {
        if (!n.head || !ixr.span(n.id).includes(n.head)) errs.push(`${n.id}: head "${n.head}" is not in the node's span`);
        for (const e of n.agree || []) {
          const ra = rows.get(e.a), rb = rows.get(e.b);
          if (!idSet.has(e.a) || !idSet.has(e.b)) { errs.push(`${n.id}: agree edge ${e.a}-${e.b} names a token outside ${S}`); continue; }
          if (!ra || !rb) continue;
          if (!Array.isArray(e.on) || !e.on.length) { errs.push(`${n.id}: agree edge ${e.a}-${e.b} lists no features`); continue; }
          for (const f of e.on) {
            const va = ra.features?.[f], vb = rb.features?.[f];
            if (va === undefined || vb === undefined || va !== vb) errs.push(`${n.id}: agree edge ${e.a}-${e.b} on ${f}: "${va}" vs "${vb}"`);
          }
        }
      }
    }

    // ---- English slots
    const E = en[S];
    if (!E) errs.push(`${S}: no English file`);
    else {
      const slotIds = new Set(), covered = new Set();
      for (const s of E.slots || []) {
        if (!/^[a-z][a-z0-9]*$/.test(s.id || '')) errs.push(`${S} slot: bad id "${s.id}"`);
        if (slotIds.has(s.id)) errs.push(`${S} slot ${s.id}: duplicate`);
        slotIds.add(s.id);
        if (![0, 1, 2].includes(s.row)) errs.push(`${S}.${s.id}: row must be 0, 1 or 2`);
        if (typeof s.text !== 'string' || !s.text || typeof s.blank !== 'string') errs.push(`${S}.${s.id}: text and blank required`);
        for (const t of s.tokens || []) { if (!idSet.has(t)) errs.push(`${S}.${s.id}: unknown token ${t}`); covered.add(t); }
      }
      for (const s of E.slots || []) if (s.under != null && !slotIds.has(s.under)) errs.push(`${S}.${s.id}: under "${s.under}" is not a slot`);
      for (const id of ids) if (!covered.has(id)) errs.push(`${id}: in no English slot`);
      const mine = steps.filter(s => s.sentence === S);
      const last = mine[mine.length - 1];
      if (!last) errs.push(`${S}: no steps`);
      else for (const s of E.slots || []) if (last.en[`${S}.${s.id}`] !== 'on') errs.push(`${S}.${s.id}: not "on" at the last step of ${S} (${last.id}); it is "${last.en[`${S}.${s.id}`] ?? 'off'}"`);
    }

    // ---- authoring obligations (every step of every file counts)
    const cardAt = new Map(), listed = new Map();
    for (const st of steps) {
      if (st.card) { if (!cardAt.has(st.card.token)) cardAt.set(st.card.token, []); cardAt.get(st.card.token).push(st); }
      for (const id of st.list) { if (!listed.has(id)) listed.set(id, []); listed.get(id).push(st); }
    }
    for (const id of ids) {
      if (!cardAt.has(id) && !listed.has(id)) errs.push(`${id}: in no step's list and no step's card`);
      const r = rows.get(id); if (!r) continue;
      // `rows` replaces `card` and `list`; the 'own' and 'with:' card obligations are superseded
      // (as build.mjs drops them). 'list' still requires that some step lists the word.
      if (r.stop === 'list') { if (!listed.has(id)) errs.push(`${id}: stop "list" but no step lists it`); }
    }
  }
  return { errs, warns };
}
if (isMain(import.meta.url)) { const ctx = makeCtx(); const r = await run(ctx); process.exit(report('check-parse', r.errs, r.warns, ctx.strict)); }
