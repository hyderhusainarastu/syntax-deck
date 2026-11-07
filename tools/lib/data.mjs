// data.mjs: loaders shared by the tools. Everything resolves against ctx (the project root, or docs/stub with --stub).
import { existsSync } from 'node:fs';
import { readJson } from './ctx.mjs';
import { buildTable, treeIndex } from './refs.mjs';

export const SENT = ['S1', 'S2', 'S3', 'S4'];
export const sKey = (S) => S.toLowerCase();

export function loadLocked(ctx, errs) {
  const tokens = readJson(ctx.P('data/locked/tokens.json'), errs, 'data/locked/tokens.json') || [];
  const gap = readJson(ctx.P('data/locked/gap.json'), errs, 'data/locked/gap.json') || { gapSentence: [], variant: null };
  return { tokens, gap, table: buildTable(tokens, gap) };
}

// Trees and English for every sentence present on disk. Required ones are checked by the callers.
export function loadTrees(ctx, table, errs, required = ctx.sentences) {
  const trees = {}, idx = {};
  for (const S of SENT) {
    const f = ctx.D('data/tree', `${sKey(S)}.json`);
    if (existsSync(f) || required.includes(S)) { const j = readJson(f, required.includes(S) ? errs : null, `${ctx.rel(f)}`); if (j) { trees[S] = j; idx[S] = treeIndex(j, table); } }
  }
  return { trees, idx };
}
export function loadEn(ctx, errs, required = ctx.sentences) {
  const en = {};
  for (const S of SENT) {
    const f = ctx.D('data/en', `${sKey(S)}.json`);
    if (existsSync(f) || required.includes(S)) { const j = readJson(f, required.includes(S) ? errs : null, ctx.rel(f)); if (j) en[S] = j; }
  }
  return en;
}
export const loadCites = (ctx, errs) => {
  const f = ctx.D('data/sources/citations.json');
  return existsSync(f) ? readJson(f, errs, ctx.rel(f)) || {} : (errs?.push(`${ctx.rel(f)}: file missing`), {});
};
export const loadLsjPassage = (ctx, errs) => {
  const f = ctx.D('data/sources/lsj-passage.json');
  return existsSync(f) ? readJson(f, errs, ctx.rel(f)) || [] : (errs?.push(`${ctx.rel(f)}: file missing`), []);
};
export function loadParses(ctx, errs) {
  const out = {};
  for (const S of ctx.sentences) {
    const f = ctx.D('data/parses', `${sKey(S)}.json`);
    const j = readJson(f, errs, ctx.rel(f)); if (j) out[S] = j;
  }
  return out;
}
