// pdf.mjs: one PDF page per step, through ?i=N, in the cached Chromium.
// Run: npm run pdf [-- --file build/deck.html] [--out build/deck.pdf] [--vp 1920x1080]
// Each step is printed to its own single-page PDF, then the pages are joined without a new dependency.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = path.resolve(arg('--file', existsSync('build/deck.html') ? 'build/deck.html' : 'build/deck-s1.html'));
const OUT = path.resolve(arg('--out', FILE.replace(/\.html$/, '.pdf')));
const [W, H] = arg('--vp', '1920x1080').split('x').map(Number);
if (!existsSync(FILE)) { console.error('missing ' + FILE + ': run npm run build first'); process.exit(1); }

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
const load = async (i) => {
  await page.goto('file://' + FILE + '?i=' + i);
  await page.waitForFunction(() => window.__deck && window.__deck.count, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__deck.settled(), null, { timeout: 15000 });
  await page.waitForTimeout(400);
};
await load(0);
const n = await page.evaluate(() => window.__deck.count());
const pages = [];
for (let i = 0; i < n; i++) {
  if (i > 0) await load(i);
  pages.push(await page.pdf({ width: W + 'px', height: H + 'px', printBackground: true, pageRanges: '1', margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
  console.error(`step ${i + 1}/${n}`);
}
await browser.close();

// Join single-page PDFs: pdf-lib is not a dependency, so use qpdf or pdfunite if present, else write numbered files.
import { spawnSync } from 'node:child_process';
const dir = path.join(path.dirname(OUT), path.basename(OUT, '.pdf') + '-pages');
mkdirSync(dir, { recursive: true });
const files = pages.map((b, i) => { const f = path.join(dir, String(i + 1).padStart(3, '0') + '.pdf'); writeFileSync(f, b); return f; });
let joined = false;
for (const [cmd, args] of [['qpdf', ['--empty', '--pages', ...files, '--', OUT]], ['pdfunite', [...files, OUT]]]) {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  if (r.status === 0) { joined = true; console.log(`${path.relative(process.cwd(), OUT)} (${n} pages, joined with ${cmd})`); break; }
}
if (!joined) console.log(`no qpdf or pdfunite: ${n} single-page files in ${path.relative(process.cwd(), dir)}/ (install qpdf to join them)`);
if (errs.length) { console.error('page errors:\n' + errs.join('\n')); process.exit(1); }
