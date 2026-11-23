// Offline tests: no network, no installed dependencies. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeCtx } from '../tools/lib/ctx.mjs';
import { run } from '../tools/check-text.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const example = path.join(repo, 'examples/hello');

function copyExample() {
  const dir = mkdtempSync(path.join(tmpdir(), 'syntax-deck-'));
  cpSync(path.join(example, 'data'), path.join(dir, 'data'), { recursive: true });
  return dir;
}
function check(root) { return run(makeCtx(['--scope', 's1'], root)); }

test('example tokens pass check-text', () => {
  const r = check(example);
  assert.deepEqual(r.errs, []);
});

test('Latin letters in a token are rejected', () => {
  const dir = copyExample();
  const f = path.join(dir, 'data/locked/tokens.json');
  const t = JSON.parse(require_(f));
  t[1].raw = t[1].text = 'pais';
  writeFileSync(f, JSON.stringify(t));
  const r = check(dir);
  assert.ok(r.errs.some(e => /Latin letters/.test(e)), r.errs.join('\n'));
  rmSync(dir, { recursive: true });
});

test('a wrong global order is rejected', () => {
  const dir = copyExample();
  const f = path.join(dir, 'data/locked/tokens.json');
  const t = JSON.parse(require_(f));
  t[2].g = 9;
  writeFileSync(f, JSON.stringify(t));
  const r = check(dir);
  assert.ok(r.errs.some(e => /expected 3/.test(e)), r.errs.join('\n'));
  rmSync(dir, { recursive: true });
});

test('missing data is reported, not thrown', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'syntax-deck-'));
  mkdirSync(path.join(dir, 'data/locked'), { recursive: true });
  const r = check(dir);
  assert.ok(r.errs.some(e => /file missing/.test(e)));
  rmSync(dir, { recursive: true });
});

test('CLI exits 0 on the example and 1 on a missing root', () => {
  const ok = spawnSync(process.execPath, ['tools/check-text.mjs', '--scope', 's1', '--root', 'examples/hello'], { cwd: repo, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^ok\s+check-text: 0 failure\(s\)/m);
  const bad = spawnSync(process.execPath, ['tools/check-text.mjs', '--scope', 's1', '--root', 'no-such-dir'], { cwd: repo, encoding: 'utf8' });
  assert.equal(bad.status, 1);
});

import { readFileSync } from 'node:fs';
function require_(f) { return readFileSync(f, 'utf8'); }
