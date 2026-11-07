// build.mjs (BUILD GLUE): compile, check, bundle -> build/deck.html (one offline file, opens from file://, zero network).
// Run: npm run build | build:strict   (= node tools/build.mjs [--strict] [--scope s1] [--stub] [--steps dir] [--out file])
//   --strict  any warning is fatal (final build). Failures in any check are ALWAYS fatal; all are printed first.
//   --steps   builds any folder of step files on the real tokens, tree, parses and sources. A probe is a sample of
//             presses, so the whole-deck coverage and continuity refusals alone are dropped.
// Optional data/deck.json: { "title": "...", "notices": ["line", ...] }. The title goes in the page; the notices go in the page
// (as a CSS comment) and in the help view. Nothing else is written as a notice: the build adds no text about any deck.
import * as esbuild from 'esbuild';
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { makeCtx } from './lib/ctx.mjs';
import { deepRefs } from './lib/refs.mjs';
import { compile, writeSteps, probeCtx } from './compile-steps.mjs';
import { run as checkText, checkDom } from './check-text.mjs';
import { run as checkParse } from './check-parse.mjs';
import { run as checkCites, usedKeys, stripData, bannedIn } from './check-cites.mjs';
import { loadParses, loadLsjPassage } from './lib/data.mjs';

const ctx = probeCtx(makeCtx());
ctx.skipBuilt = true; // the page does not exist yet: it is scanned in memory below
const { root: ROOT, P } = ctx;
const OUT = ctx.val('--out') ? path.resolve(process.cwd(), ctx.val('--out')) : P('build', `deck${ctx.suffix}.html`);
const readDeckFile = () => { const f = ctx.D('data/deck.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}; };
const DECKFILE = readDeckFile();
const TITLE = typeof DECKFILE.title === 'string' && DECKFILE.title.trim() ? DECKFILE.title.trim() : 'Syntax deck';
let warnings = 0, fatal = 0;
const warn = (m) => { warnings++; console.warn('  ! ' + m); };
const fail = (m) => { fatal++; console.error('  ✗ ' + m); };
const stop = () => { console.error(`build failed: ${fatal} error(s), ${warnings} warning(s); ${ctx.rel(OUT)} NOT written`); process.exit(1); };
const rel = ctx.rel;
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
const safeScript = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const safeStyle = (s) => s.replace(/<\/style/gi, '<\\/style');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', woff2: 'font/woff2', avif: 'image/avif', gif: 'image/gif' };
const dataUri = async (f) => `data:${MIME[f.split('.').pop().toLowerCase()] || 'application/octet-stream'};base64,${(await readFile(f)).toString('base64')}`;
const show = (name, r) => { for (const w of r.warns) warn(`${name}: ${w}`); for (const e of r.errs) fail(`${name}: ${e}`); };

// ---------- 1 compile + checks (all printed, then stop) ----------
// `rows` replaces `card` and `list`, and compile counts them, so the old card obligations no longer hold.
const SUPERSEDED = [/: stop "own" but no step has card/, /: stop "with:[^"]*" but no step lists it/];
// What only a whole deck can satisfy. A probe drops these and nothing else.
const COVERAGE = [/in no step's list and no step's card/, /: stop "list" but no step lists it/, /not "on" at the last step/, /^S[1-4]: no steps$/];
const drop = (r, res) => ({ ...r, errs: r.errs.filter((e) => !res.some((x) => x.test(e))) });
const comp = await compile(ctx);
show('compile', comp);
if (!comp.errs.length) writeSteps(ctx, comp.steps, ctx.val('--out') ? path.join(path.dirname(OUT), 'steps.json') : P('build', `steps${ctx.suffix}.json`));
const tx = checkText(ctx); show('check-text', tx);
const ps = await checkParse(ctx, comp.errs.length ? null : comp); show('check-parse', drop(ps, ctx.probe ? [...SUPERSEDED, ...COVERAGE] : SUPERSEDED));
// check-cites turns the unanswered LSJ entries into warnings on a scoped build; a probe is scoped in that sense.
// Parse rows name citation keys across every word; a sample shows few of them, and compile has already refused any
// undefined key in a step's own rail, callouts or derive. So on a probe these print as warnings and do not stop it.
const ct = await checkCites(ctx.probe ? { ...ctx, scope: 's1' } : ctx, comp.errs.length ? null : comp);
const ROW_KEY = /^\S+ (?:sources|override\.sources|alternative \d+): citation (\S+) is not defined$/;
if (ctx.probe) { ct.warns.push(...ct.errs.filter((e) => ROW_KEY.test(e))); ct.errs = ct.errs.filter((e) => !ROW_KEY.test(e)); }
show('check-cites', ct);
if (fatal) stop();
console.log(`checks ok: ${comp.steps.steps.length} steps`);

// ---------- 2 data ----------
const { tokens, gap, table } = comp.locked;
const dataErrs = [];
const parsesRaw = loadParses(ctx, dataErrs);
// trees and english are read again as plain JSON so the output equals the files, with references resolved
const rj = (f) => JSON.parse(readFileSync(f, 'utf8'));
const treeOut = {}, enOut = {}, parsesOut = {};
for (const S of ctx.sentences) {
  const k = S.toLowerCase();
  treeOut[S] = deepRefs(rj(ctx.D('data/tree', `${k}.json`)), table, dataErrs, `tree ${S}`);
  // comp.en: a probe may overlay English stages; otherwise it equals the file
  enOut[S] = deepRefs(ctx.probe ? comp.en[S] : rj(ctx.D('data/en', `${k}.json`)), table, dataErrs, `en ${S}`);
  parsesOut[S] = {};
  for (const r of parsesRaw[S].rows) parsesOut[S][r.id] = deepRefs(comp.rowMore[r.id] ? { ...r, more: comp.rowMore[r.id] } : r, table, dataErrs, `parse ${r.id}`);
}
const used = usedKeys(comp.steps.steps, parsesRaw);
for (const k of loadLsjPassage(ctx, null).map(e => e.key)) if (!used.has(k)) used.set(k, 'lsj-passage');
const citesOut = {};
for (const k of [...used.keys()].sort()) { const c = comp.cites[k]; if (!c || c.grade === 'D') continue; citesOut[k] = deepRefs(c, table, dataErrs, `cite ${k}`); }
dataErrs.forEach(e => fail('data: ' + e));
const stepsOut = comp.steps;
const skipped = comp.skipped;
const DATA = {
  meta: stepsOut.meta, steps: stepsOut.steps,
  tokens: tokens.map(({ id, g, s, extract, text, post }) => ({ id, g, s, extract, text, post })),
  gap, skipped, tree: treeOut, en: enOut, parses: parsesOut, cites: citesOut,
};

// ---------- 3 images (only those referenced by compiled data), keyed as written in the data ----------
const IMG = {};
const addImg = async (key, file, where) => {
  if (IMG[key] !== undefined) return;
  // A page image is optional. A missing image is skipped; the reference still shows (no image, no break).
  if (!existsSync(file)) { warn(`${where}: image ${key} not found; the reference is shown without it`); return; }
  IMG[key] = await dataUri(file);
};
for (const s of stepsOut.steps) if (s.view?.mode === 'plate') await addImg(s.view.img, P('assets/img', s.view.img), `${s.id} plate`);
for (const c of Object.values(citesOut)) if (c.screenshot && c.evidence?.image !== 'withheld') await addImg(c.screenshot, ctx.D(c.screenshot), `citation ${c.key}`);

// ---------- 4 bundle ----------
const presenter = P('src/presenter/entry.mjs');
if (!existsSync(presenter)) warn('src/presenter/entry.mjs is missing: bundling src/main.mjs without the source view');
const entry = existsSync(presenter) ? presenter : P('src/main.mjs');
if (!existsSync(entry)) { fail(`${rel(entry)} is missing`); stop(); }
const r = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020',
  loader: { '.json': 'json' }, legalComments: 'eof', logLevel: 'silent' }).catch(e => { for (const m of e.errors || []) fail('esbuild: ' + m.text + (m.location ? ` (${m.location.file}:${m.location.line})` : '')); return null; });
if (!r) stop();
for (const m of r.warnings) warn('esbuild: ' + m.text);
const js = r.outputFiles[0].text;

// ---------- 5 CSS and fonts ----------
async function inlineFonts(css, label) {
  const re = /url\((["']?)((?:\.\.\/)*assets\/fonts\/([^)"']+))\1\)/g; const jobs = [];
  css.replace(re, (m, q, full, f) => { jobs.push({ m, f }); return m; });
  for (const j of jobs) {
    // Gentium Book Plus (SIL OFL 1.1) is read from the npm package; assets/fonts is used only if a local copy is present.
    const f = [P('assets/fonts', j.f), P('node_modules/@fontsource/gentium-book-plus/files', j.f)].find(existsSync);
    if (!f) { fail(`${label}: missing font ${j.f} (run npm ci)`); continue; }
    css = css.split(j.m).join(`url(${await dataUri(f)})`);
  }
  return css;
}
const cssDir = P('src/css');
const cssNames = existsSync(cssDir) ? (await readdir(cssDir)).filter(f => f.endsWith('.css')) : [];
const ORDER = ['fonts.css', 'tokens.css', 'stage.css', 'panels.css'];
for (const f of ORDER) if (!cssNames.includes(f)) warn(`src/css/${f} is missing`);
const cssList = [...ORDER.filter(f => cssNames.includes(f)), ...cssNames.filter(f => !ORDER.includes(f)).sort()];
const css = [];
// Gentium Book Plus is embedded below (SIL OFL 1.1). The licence asks that its notice travel with every copy, so the
// built page carries it as a comment, read from licenses/ so that the text is the one shipped in this repository.
const gentiumFile = P('licenses/OFL-gentium-book-plus.txt');
if (existsSync(gentiumFile)) {
  css.push('/* Gentium Book Plus, embedded in this page as base64 font data, is licensed under the SIL Open Font License 1.1.\n'
    + '   Copyright holder as named in the licence file packaged with the font (@fontsource/gentium-book-plus 5.2.5), reproduced here:\n\n'
    + (await readFile(gentiumFile, 'utf8')).replace(/\*\//g, '* /').trimEnd() + '\n*/');
} else warn('licenses/OFL-gentium-book-plus.txt is missing: the Gentium notice is not in the page');
// Alegreya Sans (SIL OFL 1.1) is embedded in src/css/fonts.css; its licence text travels with the page the same way.
const alegreyaFile = P('licenses/OFL-alegreya-sans.txt');
if (existsSync(alegreyaFile)) {
  css.push('/* Alegreya Sans, embedded in this page as base64 font data, is licensed under the SIL Open Font License 1.1.\n'
    + '   Copyright 2013 The Alegreya Sans Project Authors (https://github.com/huertatipografica/Alegreya-Sans). Licence text, reproduced here:\n\n'
    + (await readFile(alegreyaFile, 'utf8')).replace(/\*\//g, '* /').trimEnd() + '\n*/');
} else warn('licenses/OFL-alegreya-sans.txt is missing: the Alegreya Sans notice is not in the page');
// Notices come only from the deck's own data (data/deck.json): in the page as a comment and as data for the help view.
const notices = Array.isArray(DECKFILE.notices) ? DECKFILE.notices.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim()) : [];
if (notices.length) {
  css.push('/* ' + notices.join('\n   ').replace(/\*\//g, '* /') + ' */');
  DATA.notices = notices;
}
for (const f of cssList) css.push(`/* src/css/${f} */\n` + await inlineFonts(await readFile(path.join(cssDir, f), 'utf8'), f));

// ---------- 6 page ----------
const spans = (list) => list.map(t => `<span class="tk" data-id="${t.id}"><span class="w">${esc(t.text)}</span><span class="pc">${esc(t.post ?? '')}</span> </span>`).join('');
const TOKENS = `<div id="tokens" lang="grc">${spans(tokens)}</div>\n    <div id="extras" lang="grc">${spans([...gap.gapSentence, ...(gap.variant ? [gap.variant] : []), ...(skipped?.tokens ?? [])])}</div>\n    <div id="glosses" aria-hidden="true"></div>`;
let page = await readFile(P('src/index.html'), 'utf8');
const put = (key, val) => { if (!page.includes(key)) { fail(`src/index.html lacks the ${key} slot`); return; } page = page.replace(key, () => val); };
put('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src data: blob:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`);
put('<!--TITLE-->', esc(TITLE));
put('/*STYLE*/', safeStyle(css.join('\n')));
put('<!--TOKENS-->', TOKENS);
put('/*DATA*/', `window.__DATA__=${safeJson(DATA)};window.__IMG=${safeJson(IMG)};`);
put('/*BUNDLE*/', safeScript(js));

// ---------- 7 checks on the page: zero network, banned terms, token bytes ----------
const htmlOnly = page.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<template[\s\S]*?<\/template>/gi, '');
const cssOnly = [...page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
const net = [];
const grab = (re, s) => { let m; while ((m = re.exec(s))) net.push(m[1].slice(0, 80)); };
grab(/<(?:img|script|link|iframe|source|video|audio|embed|object|image|use)\b[^>]*\s(?:src|href|xlink:href|data|srcset)=["'](?!data:|blob:|#|about:)([^"']+)["']/gi, htmlOnly);
grab(/url\(\s*["']?(?!data:|#|blob:)([^"')\s]+)["']?\s*\)/gi, cssOnly);
grab(/@import\s+(?:url\()?["']?([^"');]+)/gi, cssOnly);
if (/<script\b[^>]*\ssrc=/i.test(page)) net.push('<script src=…>');
for (const u of [...new Set(net)]) warn(`possible external reference in output: ${u}`);
if (bannedIn(stripData(page))) fail('the banned name appears in the built html');
// Any skipped words sit in #extras with the gap sentence and are held to the same byte check.
const domLocked = { tokens, gap: { ...gap, gapSentence: [...gap.gapSentence, ...(skipped?.tokens ?? [])] } };
const domErrs = []; checkDom(page, domLocked, domErrs, 'built html'); domErrs.forEach(fail);
if (fatal) stop();

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, page);
const sz = (await stat(OUT)).size;
console.log(`${rel(OUT)}  ${(sz / 1024).toFixed(0)} KB  (${stepsOut.steps.length} steps, js ${(js.length / 1024).toFixed(0)} KB, ${cssList.length} css, ${Object.keys(IMG).length} images, ${Object.keys(citesOut).length} citations) · ${warnings} warning(s)`);
if (ctx.strict && warnings) process.exit(1);
