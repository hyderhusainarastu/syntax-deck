// check-text.mjs: the tokens must be well-formed text (NFC, no stray Latin letters), and a built page must carry them byte for byte.
// Run: node tools/check-text.mjs [--dom build/deck.html] [--stub] [--scope s1]   (flags never change rules)
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { makeCtx, isMain, report, readJson } from './lib/ctx.mjs';
import { loadLocked } from './lib/data.mjs';
import { loadSkipped } from './compile-steps.mjs';

const nf = (s) => s.normalize('NFC');
const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
const LATIN = /\p{Script=Latin}/u, GREEK = /\p{Script=Greek}/u;

export function checkTokens(ctx, locked, errs) {
  const { tokens } = locked;
  tokens.forEach((t, i) => {
    if (t.g !== i + 1) errs.push(`${t.id}: g=${t.g}, expected ${i + 1}`);
    if (t.text !== nf(t.text)) errs.push(`${t.id}: text is not NFC`);
    if ((t.post ?? '') !== nf(t.post ?? '')) errs.push(`${t.id}: post is not NFC`);
    if (t.text !== nf(t.raw)) errs.push(`${t.id}: text differs from NFC of raw ("${t.text}" vs "${nf(t.raw)}")`);
    if (LATIN.test(t.text) && GREEK.test(t.text)) errs.push(`${t.id}: mixes Latin and Greek letters ("${t.text}")`);
    if (LATIN.test(t.text) && !GREEK.test(t.text)) errs.push(`${t.id}: Latin letters in "${t.text}"`);
  });
  for (const x of locked.gap.gapSentence || []) {
    if (x.text !== nf(x.text)) errs.push(`${x.id}: text is not NFC`);
    if (LATIN.test(x.text)) errs.push(`${x.id}: Latin letters in "${x.text}"`);
  }
}

// --dom: every .tk in #tokens / #extras must carry .w byte-equal to text and .pc byte-equal to post.
export function checkDom(html, locked, errs, label = 'dom') {
  const secs = {};
  for (const id of ['tokens', 'extras']) {
    const m = new RegExp(`<div id="${id}"[^>]*>([\\s\\S]*?)</div>`).exec(html);
    if (!m) { errs.push(`${label}: <div id="${id}"> not found`); secs[id] = ''; } else secs[id] = m[1];
  }
  const want = new Map(); locked.tokens.forEach(t => want.set(t.id, { ...t, sec: 'tokens' }));
  (locked.gap.gapSentence || []).forEach(t => want.set(t.id, { ...t, post: t.post ?? '', sec: 'extras' }));
  if (locked.gap.variant) want.set(locked.gap.variant.id, { ...locked.gap.variant, post: '', sec: 'extras' });
  const got = new Map();
  for (const sec of ['tokens', 'extras']) {
    for (const m of secs[sec].matchAll(/<span class="tk" data-id="([^"]+)">\s*<span class="w">([\s\S]*?)<\/span><span class="pc">([\s\S]*?)<\/span>([\s\S]*?)<\/span>(?=<span class="tk"|\s*$)/g)) {
      if (got.has(m[1])) errs.push(`${label}: ${m[1]} appears twice`);
      got.set(m[1], { sec, w: dec(m[2]), pc: dec(m[3]), tail: m[4] });
    }
  }
  for (const [id, t] of want) {
    const g = got.get(id);
    if (!g) { errs.push(`${label}: ${id} missing from #${t.sec}`); continue; }
    if (g.sec !== t.sec) errs.push(`${label}: ${id} is in #${g.sec}, expected #${t.sec}`);
    if (g.w !== t.text) errs.push(`${label}: ${id} .w "${g.w}" differs from text "${t.text}"`);
    if (g.pc !== t.post) errs.push(`${label}: ${id} .pc "${g.pc}" differs from post "${t.post}"`);
    if (g.tail !== ' ') errs.push(`${label}: ${id} lacks the trailing literal space (found ${JSON.stringify(g.tail)})`);
  }
  for (const id of got.keys()) if (!want.has(id)) errs.push(`${label}: unexpected token ${id}`);
  const order = [...got.keys()].filter(id => want.get(id)?.sec === 'tokens');
  if (order.join() !== locked.tokens.map(t => t.id).join()) errs.push(`${label}: #tokens are not in reading order`);
}

export function run(ctx) {
  const errs = [], warns = [];
  const locked = loadLocked(ctx, errs);
  if (!errs.length) checkTokens(ctx, locked, errs);
  const dom = ctx.val('--dom');
  if (dom && !errs.length) {
    const f = path.resolve(process.cwd(), dom);
    if (!existsSync(f)) errs.push(`--dom file ${dom} missing`); else {
      // any skipped words sit in #extras and are held to the same byte check; the file is optional
      const sk = loadSkipped(ctx, []);
      const dl = { tokens: locked.tokens, gap: { ...locked.gap, gapSentence: [...(locked.gap.gapSentence || []), ...(sk?.tokens ?? [])] } };
      checkDom(readFileSync(f, 'utf8'), dl, errs, ctx.rel(f));
    }
  }
  return { errs, warns };
}
if (isMain(import.meta.url)) { const ctx = makeCtx(); const r = run(ctx); process.exit(report('check-text', r.errs, r.warns, ctx.strict)); }
