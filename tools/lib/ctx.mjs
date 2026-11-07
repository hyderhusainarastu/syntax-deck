// ctx.mjs: shared run context (roots, scope, flags) and small helpers for every tool.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FILES = ['overture', 's1', 's2', 's3', 's4', 'close'];

// --stub swaps the data/steps root to docs/stub (a small fixture, not part of this repository) and implies sentence S1; --scope s1 limits to S1.
// Neither flag changes any rule. Locked data, src/ (except steps), assets and fonts always come from ROOT.
export function makeCtx(argv = process.argv.slice(2), root = ROOT) {
  const flag = (n) => argv.includes(n);
  const val = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
  const stub = flag('--stub');
  const scopeArg = (val('--scope') || 'all').toLowerCase();
  if (!['all', 's1'].includes(scopeArg)) throw new Error(`unsupported --scope ${scopeArg} (use s1)`);
  const reduced = stub || scopeArg === 's1';
  const dataRoot = stub ? path.join(root, 'docs/stub') : root;
  const ctx = {
    argv, root, stub, strict: flag('--strict'),
    scope: stub ? 'stub' : scopeArg,
    sentences: reduced ? ['S1'] : ['S1', 'S2', 'S3', 'S4'],
    files: reduced ? ['overture', 's1'] : FILES,
    dataRoot,
    stepsDir: path.join(dataRoot, 'src/steps'),
    flag, val,
    P: (...s) => path.join(root, ...s),        // real project paths
    D: (...s) => path.join(dataRoot, ...s),    // data-root paths (docs/stub when --stub)
    rel: (p) => path.relative(root, p),
    suffix: stub ? '-stub' : scopeArg === 's1' ? '-s1' : '',
  };
  return ctx;
}

export const isMain = (metaUrl) => process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === metaUrl;

export function readJson(file, errs, label) {
  if (!existsSync(file)) { errs?.push(`${label || file}: file missing`); return null; }
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { errs?.push(`${label || file}: invalid JSON (${e.message})`); return null; }
}

// Prints every failure and warning; returns the process exit code.
export function report(name, errs, warns = [], strict = false) {
  for (const w of warns) console.warn(`  ! ${name}: ${w}`);
  for (const e of errs) console.error(`  ✗ ${name}: ${e}`);
  const bad = errs.length || (strict && warns.length);
  console.log(`${bad ? 'FAIL' : 'ok  '} ${name}: ${errs.length} failure(s), ${warns.length} warning(s)`);
  return bad ? 1 : 0;
}
