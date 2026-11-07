// check-cites.mjs: citation records are well-formed, graded, and every citation a step uses is defined and not grade D.
// Run: node tools/check-cites.mjs [--stub] [--scope s1] [--html file]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { makeCtx, isMain, report, readJson } from './lib/ctx.mjs';
import { loadLocked, loadTrees, loadEn, loadCites, loadLsjPassage, loadParses } from './lib/data.mjs';
import { resolveRefs } from './lib/refs.mjs';
import { compile } from './compile-steps.mjs';

const nfc = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
// Banned terms are private and configured per machine: DECK_BANNED_TERMS="term1,term2". Empty by default, so nothing is scanned.
const BANNED = (process.env.DECK_BANNED_TERMS || '').split(',').map((t) => t.trim()).filter(Boolean)
  .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const BANNED_RE = BANNED.length ? new RegExp(`\\b(${BANNED.join('|')})\\b`, 'i') : null;
const SKIP_EXT = new Set(['.woff2', '.woff', '.png', '.webp', '.jpg', '.jpeg', '.gif', '.avif', '.ico', '.zip', '.docx', '.pdf']);

// Banned-term scan on built html: strip data: runs first, since base64 contains the letters by chance.
export const stripData = (html) => html.replace(/data:[^"')]*/g, 'data:');
export const bannedIn = (text) => (BANNED_RE ? BANNED_RE.test(text) : false);

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p); else if (!SKIP_EXT.has(path.extname(n).toLowerCase())) yield p;
  }
}

// Every citation key a step or a parse row can put in front of the reader.
export function usedKeys(steps, parses) {
  const used = new Map(); // key -> where
  const add = (k, w) => { if (k && !used.has(k)) used.set(k, w); };
  for (const s of steps) {
    (s.cite || []).forEach(k => add(k, `${s.id} cite`));
    if (s.callout?.cite) add(s.callout.cite, `${s.id} callout`);
    const v = s.view || {};
    if (v.cite) add(v.cite, `${s.id} view`);
    if (v.left?.cite) add(v.left.cite, `${s.id} view.left`);
    if (v.right?.cite) add(v.right.cite, `${s.id} view.right`);
  }
  for (const [S, P] of Object.entries(parses || {})) for (const r of P.rows || []) {
    (r.sources || []).forEach(k => add(k, `${r.id} sources`));
    (r.override?.sources || []).forEach(k => add(k, `${r.id} override.sources`));
    (r.alternatives || []).forEach((a, j) => (a.sources || []).forEach(k => add(k, `${r.id} alternative ${j}`)));
  }
  return used;
}

export async function run(ctx, pre = null) {
  const errs = [], warns = [];
  const locked = pre?.locked || loadLocked(ctx, errs);
  const cites = pre?.cites || loadCites(ctx, errs);
  const lsj = loadLsjPassage(ctx, errs);
  const parses = loadParses(ctx, errs);
  const comp = pre || await compile(ctx, { locked, ...(pre || {}) });
  if (!pre) errs.push(...comp.errs.map(e => `compile: ${e}`));
  const steps = comp.steps?.steps || [];
  const R = (s) => resolveRefs(s, locked.table, null);
  const exists = (p) => existsSync(ctx.D(p));

  let nWithheld = 0;
  // ---- entry rules (entries graded D are unconfirmed leads: they are never shown, so only their grade is checked)
  for (const [key, c] of Object.entries(cites)) {
    const w = `citation ${key}`;
    if (c.key !== key) errs.push(`${w}: key field "${c.key}" differs from its object key`);
    if (!/^[a-z]+:[a-z0-9.-]+$/.test(key)) errs.push(`${w}: key format must be <source>:<slug>`);
    if (!['A', 'B', 'C', 'D'].includes(c.grade)) { errs.push(`${w}: grade "${c.grade}" is not A, B, C or D`); continue; }
    if (c.grade === 'D') continue;
    if (typeof c.source !== 'string' || !c.source.trim()) errs.push(`${w}: source missing`);
    if (typeof c.label !== 'string' || !c.label.trim()) errs.push(`${w}: label missing`);
    // A record may ship without a page image: it says so in `evidence` (an image withheld, or a reference only) and keeps its exact reference.
    const withheld = c.evidence?.image === 'withheld' || c.evidence?.reference_only === true;
    if (withheld) nWithheld++;
    const page = c.locator?.page;
    if (page != null && page !== '' && !c.screenshot && !withheld) errs.push(`${w}: locator.page "${page}" set but no screenshot`);
    if (c.screenshot && !withheld && !exists(c.screenshot)) errs.push(`${w}: screenshot ${c.screenshot} does not exist on disk`);
    if (c.grade === 'A' && !c.screenshot && !withheld) errs.push(`${w}: grade A without a screenshot`);
    if (c.grade === 'B') { if (!c.via || !c.via.work || !c.via.page) errs.push(`${w}: grade B needs via { work, page }`); }
    else if (c.via != null) errs.push(`${w}: via must be null outside grade B`);
    if (c.source === 'LSJ') {
      if (!c.captured) errs.push(`${w}: LSJ row has no captured text`);
      else if (!exists(c.captured)) errs.push(`${w}: captured file ${c.captured} does not exist`);
      // A quote is optional: where the captured text does not hold it, the record keeps its headword and sense and no quote.
      else if (c.quote != null && (typeof c.quote !== 'string' || !c.quote.trim())) errs.push(`${w}: LSJ quote is empty`);
      else if (c.quote != null && !nfc(readFileSync(ctx.D(c.captured), 'utf8')).includes(nfc(R(c.quote)))) errs.push(`${w}: quote "${c.quote.slice(0, 60)}" is not in ${c.captured}`);
    }
  }

  // ---- usage
  const used = usedKeys(steps, parses);
  for (const [k, where] of used) {
    if (!cites[k]) errs.push(`${where}: citation ${k} is not defined`);
    else if (cites[k].grade === 'D') errs.push(`${where}: citation ${k} is grade D and may not reach the screen`);
  }

  // ---- LSJ entries that cite this passage must each be answered by an lsj-here callout
  const answered = new Set(steps.filter(s => s.callout?.kind === 'lsj-here').map(s => s.callout.cite));
  for (const e of lsj) {
    if (!cites[e.key]) errs.push(`lsj-passage ${e.key}: not defined in citations.json`);
    if (e.harvest && !exists(e.harvest)) errs.push(`lsj-passage ${e.key}: harvest ${e.harvest} does not exist`);
    if (!answered.has(e.key)) {
      const m = `lsj-passage ${e.key}: no step has an lsj-here callout citing it`;
      // A scoped build holds a subset of the steps, and an entry does not say which sentence answers it.
      if (ctx.scope === 's1') warns.push(m + ' (scoped build: not decidable here)'); else errs.push(m);
    }
  }

  // ---- STUB markers must not exist outside the fixture
  const scan = [ctx.P('src'), ctx.D('data'), ctx.stepsDir];
  if (!ctx.stub) {
    for (const dir of [ctx.D('data'), ctx.P('src/steps')]) for (const f of walk(dir)) {
      if (/STUB/.test(readFileSync(f, 'utf8'))) errs.push(`${ctx.rel(f)}: contains the string STUB`);
    }
  }
  // ---- banned terms (only when DECK_BANNED_TERMS is set)
  const seen = new Set();
  for (const dir of scan) for (const f of walk(dir)) {
    if (seen.has(f)) continue; seen.add(f);
    if (bannedIn(readFileSync(f, 'utf8'))) errs.push(`${ctx.rel(f)}: contains the banned name`);
  }
  const stepsJson = ctx.val('--steps-json') || ctx.P('build', `steps${ctx.suffix}.json`);
  for (const f of ctx.skipBuilt ? [] : [stepsJson]) if (existsSync(f) && bannedIn(readFileSync(f, 'utf8'))) errs.push(`${ctx.rel(f)}: contains the banned name`);
  const html = ctx.skipBuilt ? null : ctx.val('--html') || ctx.P('build', ctx.stub ? 'deck-stub.html' : ctx.scope === 's1' ? 'deck-s1.html' : 'deck.html');
  if (html && existsSync(html) && bannedIn(stripData(readFileSync(html, 'utf8')))) errs.push(`${ctx.rel(html)}: contains the banned name`);
  if (nWithheld) warns.push(`${nWithheld} citation(s) are reference only (no page image is present)`);
  return { errs, warns, used };
}
if (isMain(import.meta.url)) { const ctx = makeCtx(); const r = await run(ctx); process.exit(report('check-cites', r.errs, r.warns, ctx.strict)); }
