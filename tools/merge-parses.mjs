// merge-parses.mjs: research/adjudicated/sN-parses.json + normalised harvests (run npm run normalize first) -> data/parses/sN.json.
// Run: node tools/merge-parses.mjs [--stub] [s1 s2 ...]   (no sentence = every adjudicated file present)
// With --stub the output goes to build/stub/parses-sN.json, never over the fixture in docs/stub. --out <file> overrides.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeCtx, isMain, readJson, report } from './lib/ctx.mjs';
import { loadLocked, SENT, sKey } from './lib/data.mjs';
import { checkAnalysis, inSet } from './lib/analysis.mjs';
import { loadMorpheus } from './lib/harvest.mjs';

export function mergeSentence(ctx, S, locked, morph) {
  const errs = [], k = sKey(S);
  const rel = (f) => ctx.rel(f);
  const ids = locked.table.sentenceIds(S).filter(id => !locked.table.byId.get(id).extra);
  const adjF = ctx.D('research/adjudicated', `${k}-parses.json`);
  const adj = readJson(adjF, errs, rel(adjF));
  if (!adj) return { errs };
  const rows = Array.isArray(adj.rows) ? adj.rows : (errs.push(`${k}-parses: rows must be an array`), []);
  const seen = new Set(), byId = new Map();
  rows.forEach((r, i) => {
    if (!r || typeof r.id !== 'string' || !r.id) { errs.push(`${k}-parses row ${i}: no id`); return; }
    if (seen.has(r.id)) errs.push(`${k}-parses: duplicate row ${r.id}`);
    seen.add(r.id); byId.set(r.id, r);
    if (!ids.includes(r.id)) errs.push(`${r.id}: not a token of ${S}`);
  });
  if (rows.length !== ids.length) errs.push(`${S}: ${rows.length} rows for ${ids.length} tokens`);
  const out = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) { errs.push(`${id}: no row`); continue; }
    const a = r.analysis;
    checkAnalysis(a, `${id} analysis`, errs);
    (r.alternatives || []).forEach((alt, j) => checkAnalysis(alt.analysis, `${id} alternative ${j}`, errs));
    for (const f of ['gloss', 'why', 'syntax']) if (typeof r[f] !== 'string' || !r[f].trim()) errs.push(`${id}: ${f} missing`);
    const m = inSet(a, morph?.forms?.[id]), c = r.external_check === true;
    const via = c ? 'check' : m ? 'morpheus' : 'override';
    if (via === 'override' && !(r.override && typeof r.override.reason === 'string' && r.override.reason.trim())) errs.push(`${id}: analysis is not in the Morpheus set, not marked external_check, and has no override.reason`);
    const stop = r.stop;
    if (stop === 'own' || stop === 'list') { /* ok */ }
    else if (typeof stop === 'string' && stop.startsWith('with:')) { if (!ids.includes(stop.slice(5))) errs.push(`${id}: stop target ${stop.slice(5)} is not in ${S}`); }
    else errs.push(`${id}: stop "${stop}" must be own, list or with:<id>`);
    out.push({ id, lemma: a?.lemma, pos: a?.pos, features: a?.features || {}, gloss: r.gloss, why: r.why, syntax: r.syntax,
      alternatives: r.alternatives || [], stop, sources: r.sources || [], override: r.override ?? null, basis: { morpheus: m, check: c, via } });
  }
  const res = { sentence: S };
  if (adj.stub) res.stub = true;
  res.rows = out;
  return { errs, out: res };
}

if (isMain(import.meta.url)) {
  const ctx = makeCtx();
  const named = ctx.argv.filter(a => /^s[1-4]$/i.test(a)).map(a => a.toUpperCase());
  const todo = named.length ? named : SENT.filter(S => existsSync(ctx.D('research/adjudicated', `${sKey(S)}-parses.json`)));
  const errs = [];
  if (!todo.length) errs.push('no adjudicated files found; name a sentence, e.g. npm run merge -- s1');
  const locked = loadLocked(ctx, errs);
  const morph = loadMorpheus(ctx, errs);
  for (const S of todo) {
    const r = mergeSentence(ctx, S, locked, morph);
    errs.push(...r.errs);
    if (r.out && !r.errs.length) {
      const f = ctx.val('--out') ? path.resolve(ctx.val('--out')) : ctx.stub ? ctx.P('build/stub', `parses-${sKey(S)}.json`) : ctx.D('data/parses', `${sKey(S)}.json`);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, JSON.stringify(r.out, null, 1) + '\n');
      const v = r.out.rows.reduce((o, x) => (o[x.basis.via] = (o[x.basis.via] || 0) + 1, o), {});
      console.log(`${ctx.rel(f)}  ${r.out.rows.length} rows  via ${JSON.stringify(v)}`);
    }
  }
  process.exit(report('merge', errs, [], ctx.strict));
}
