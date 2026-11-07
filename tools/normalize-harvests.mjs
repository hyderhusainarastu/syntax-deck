// normalize-harvests.mjs: Morpheus output -> research/normalized/morpheus.json, in the feature vocabulary of tools/lib/analysis.mjs.
//   research/raw/morpheus.json  {results:{id:{analyses:[{case:"nominative",...}]}}}  ->  research/normalized/morpheus.json  {forms:{id:[{lemma,pos,features}]}}
// The raw file is only read. Rerun any time; the output is fully derived and deterministic.
// Nothing the source lists is dropped: values that cannot be expressed in the vocabulary are kept in `unmapped`
// beside the raw text, and are printed as warnings.
// Run: node tools/normalize-harvests.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeCtx, isMain, readJson, report } from './lib/ctx.mjs';
import { VOCAB } from './lib/analysis.mjs';

const nfc = (s) => (s || '').normalize('NFC');
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

// ---------------- Morpheus ----------------
const M_POS = { noun: 'noun', adjective: 'adj', article: 'article', pronoun: 'pron', verb: 'verb', adverb: 'adv', preposition: 'prep', conjunction: 'conj', particle: 'particle' };
const M_MAP = {
  case: { nominative: 'nom', genitive: 'gen', dative: 'dat', accusative: 'acc', vocative: 'voc' },
  number: { singular: 'sg', plural: 'pl', dual: 'dual' },
  gender: { masculine: 'masc', feminine: 'fem', neuter: 'neut' },
  person: { '1st': '1', '2nd': '2', '3rd': '3' },
  tense: { present: 'pres', imperfect: 'impf', future: 'fut', aorist: 'aor', perfect: 'perf', pluperfect: 'plup' },
  mood: { indicative: 'ind', subjunctive: 'subj', optative: 'opt', imperative: 'imper', infinitive: 'inf', participle: 'ptc' },
  voice: { active: 'act', middle: 'mid', passive: 'pass', mediopassive: 'midpass' },
  degree: { positive: 'pos', comparative: 'comp', superlative: 'superl' },
};
// Morpheus marks some lemmas "irregular"; only the indefinite/interrogative pronoun is mapped here. Anything else is unmapped.
const M_IRREGULAR_POS = { 'τίς': 'pron', 'τις': 'pron' };

export function normMorpheusAnalysis(a) {
  const why = [];
  let pos = M_POS[a.pos];
  const features = {};
  if (a.pos === 'verb participle') { pos = 'verb'; features.mood = 'ptc'; }
  else if (a.pos === 'irregular') { pos = M_IRREGULAR_POS[nfc(a.lemma)]; if (!pos) why.push(`pos "irregular" with lemma ${a.lemma} has no mapping`); }
  else if (!pos) why.push(`pos "${a.pos}" outside vocabulary`);
  for (const [k, map] of Object.entries(M_MAP)) {
    const v = a[k];
    if (v === null || v === undefined || v === 'undefined') continue;
    if (map[v]) { if (features[k] && features[k] !== map[v]) why.push(`${k} "${v}" conflicts with ${features[k]}`); features[k] = map[v]; }
    else why.push(`${k} "${v}" outside vocabulary`);
  }
  if (typeof a.lemma !== 'string' || !a.lemma) why.push('no lemma');
  return { ok: !why.length, why, out: { lemma: nfc(a.lemma).replace(/[0-9]+$/, ''),  // Morpheus homograph number (lemma1); raw keeps it
     pos, features, raw: clean(a) } };
}

export function normalizeMorpheus(raw, warns) {
  const forms = {}, unmapped = {};
  for (const [id, r] of Object.entries(raw.results || {})) {
    forms[id] = [];
    for (const a of r.analyses || []) {
      const n = normMorpheusAnalysis(a);
      if (n.ok) forms[id].push(n.out);
      else {
        (unmapped[id] = unmapped[id] || []).push({ why: n.why, raw: a });
        warns.push(`morpheus ${id} ${r.form}: ${n.why.join('; ')} (kept in unmapped, not in forms)`);
      }
    }
  }
  const out = { source: raw.source, retrieved: raw.retrieved, normalizedFrom: 'research/raw/morpheus.json', forms };
  if (Object.keys(unmapped).length) out.unmapped = unmapped;
  if (raw.no_analysis) out.no_analysis = raw.no_analysis;
  return out;
}

if (isMain(import.meta.url)) {
  const ctx = makeCtx();
  const errs = [], warns = [];
  const outDir = ctx.P('research/normalized');
  const w = (f, o) => writeFileSync(f, JSON.stringify(o, null, 1) + '\n');

  const raw = readJson(ctx.P('research/raw/morpheus.json'), errs, 'research/raw/morpheus.json');
  if (raw) {
    const m = normalizeMorpheus(raw, warns);
    w(path.join(outDir, 'morpheus.json'), m);
    const n = Object.values(m.forms).reduce((s, x) => s + x.length, 0);
    console.log(`research/normalized/morpheus.json  ${Object.keys(m.forms).length} forms, ${n} analyses, ${Object.values(m.unmapped || {}).reduce((s, x) => s + x.length, 0)} unmapped`);
  }
  process.exit(report('normalize', errs, warns, ctx.strict));
}
