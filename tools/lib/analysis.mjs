// analysis.mjs: feature vocabulary and analysis equality.
export const VOCAB = {
  pos: ['noun', 'adj', 'article', 'pron', 'verb', 'verbal-adj', 'adv', 'prep', 'conj', 'particle'],
  case: ['nom', 'gen', 'dat', 'acc', 'voc'],
  number: ['sg', 'dual', 'pl'],
  gender: ['masc', 'fem', 'neut'],
  person: ['1', '2', '3'],
  tense: ['pres', 'impf', 'fut', 'aor', 'perf', 'plup'],
  mood: ['ind', 'subj', 'opt', 'imper', 'inf', 'ptc'],
  voice: ['act', 'mid', 'pass', 'midpass'],
  degree: ['pos', 'comp', 'superl'],
};
export const FEATURE_KEYS = Object.keys(VOCAB).filter(k => k !== 'pos');

export function checkAnalysis(a, where, errs) {
  if (!a || typeof a !== 'object') { errs.push(`${where}: analysis missing`); return; }
  if (typeof a.lemma !== 'string' || !a.lemma) errs.push(`${where}: lemma missing`);
  if (!VOCAB.pos.includes(a.pos)) errs.push(`${where}: pos "${a.pos}" outside vocabulary`);
  for (const [k, v] of Object.entries(a.features || {})) {
    if (!FEATURE_KEYS.includes(k)) errs.push(`${where}: feature key "${k}" outside vocabulary`);
    else if (!VOCAB[k].includes(v)) errs.push(`${where}: ${k}="${v}" outside vocabulary (${typeof v})`);
  }
}

const voiceEq = (x, y) => x === y || (x === 'midpass' && (y === 'mid' || y === 'pass')) || (y === 'midpass' && (x === 'mid' || x === 'pass'));
export function sameAnalysis(a, b) {
  if (!a || !b) return false;
  if ((a.lemma || '').normalize('NFC') !== (b.lemma || '').normalize('NFC') || a.pos !== b.pos) return false;
  const fa = a.features || {}, fb = b.features || {};
  const ka = Object.keys(fa).sort(), kb = Object.keys(fb).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every(k => k === 'voice' ? voiceEq(fa[k], fb[k]) : fa[k] === fb[k]);
}
export const inSet = (a, set) => (set || []).some(x => sameAnalysis(a, x));
