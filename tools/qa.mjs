// qa.mjs: real-Chromium QA of one built deck.
// Run: node tools/qa.mjs --file build/deck-s1.html [--vp WxH,...] (default: seven viewports) [--out build/qa] [--root <dir>]
// Writes screenshots to <out>/<w>x<h>/ and raw findings to <out>/s1-raw.json.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FILE = path.resolve(arg('--file', 'build/deck-s1.html'));
const OUT = path.resolve(arg('--out', 'build/qa'));
const VPS = arg('--vp', '1920x1080,2560x1440,1440x900,1366x768,1280x720,1600x1200,1024x768').split(',').map(s => s.split('x').map(Number));
const URL0 = 'file://' + FILE;
const SRCONLY = process.argv.includes('--source-only');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GL_NOISE = /GL Driver Message|GPU stall|swiftshader|Automatic fallback to software WebGL/i;

const result = { file: FILE, vps: {} };
// the banned-term scan: word boundaries, over all visible text and attribute values of a window
// Banned terms are private and configured per machine: DECK_BANNED_TERMS="a,b". Empty by default, so the scan is a no-op.
const BANNED_RE = (process.env.DECK_BANNED_TERMS || '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const NAME_SCAN = BANNED_RE ? `(() => { const t = document.documentElement.outerHTML.replace(/data:[^"')\\s]*/g, '') + ' ' + document.body.innerText; return /\\b(${BANNED_RE})\\b/i.test(t); })()` : 'false';

// ---------- in-page helpers (serialised into the page) ----------
const PAGE_FNS = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const effOp = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const textRects = (root) => {
    const out = []; if (!root || !vis(root)) return out;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = tw.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement; if (!el || !vis(el)) continue;
      if (el.closest('[hidden]')) continue;
      if (effOp(el) < 0.05) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) out.push({ x: r.x, y: r.y, w: r.width, h: r.height, t: n.nodeValue.trim().slice(0, 40) });
    }
    return out;
  };
  window.__qa = {
    vis, textRects,
    overlaps() {
      const groups = [];
      const add = (g, rects) => rects.forEach(r => groups.push({ g, ...r }));
      const k = window.__deck.box().k;
      for (const tk of document.querySelectorAll('#tokens .tk, #extras .tk')) {
        if (parseFloat(getComputedStyle(tk).opacity) < 0.25) continue;
        const w = tk.querySelector('.w'); const r = w.getBoundingClientRect();
        if (r.width < 1) continue;
        groups.push({ g: 'tok:' + tk.dataset.id, x: r.x, y: r.y + r.height * 0.2, w: r.width, h: r.height * 0.6, t: w.textContent });
      }
      for (const gl of document.querySelectorAll('#glosses .gl')) {
        if (parseFloat(getComputedStyle(gl).opacity) < 0.25 || !vis(gl)) continue;
        const r = gl.getBoundingClientRect(); groups.push({ g: 'gl:' + gl.dataset.id, x: r.x, y: r.y, w: r.width, h: r.height, t: gl.textContent });
      }
      for (const id of ['ribbon', 'en', 'parse', 'rail', 'callout', 'card', 'more']) add('ui:' + id, textRects(document.getElementById(id)));
      for (const el of document.querySelectorAll('#marks .mk-label, #marks .mk-tag')) {
        if (effOp(el) < 0.25) continue;
        const r = el.getBoundingClientRect(); if (r.width > 1) groups.push({ g: 'mk:' + el.getAttribute('class'), x: r.x, y: r.y, w: r.width, h: r.height, t: el.textContent || '' });
      }
      const out = [];
      const ia = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        if (a.g === b.g && a.g.startsWith('ui:')) continue;           // same panel text lines
        if (a.g.startsWith('mk:') && b.g.startsWith('mk:') && a.g === b.g && a.t === b.t) continue;
        if (a.g.startsWith('mk:mk-tag') && b.g.startsWith('mk:mk-tag') && false) continue;
        // a tag rect holds its own text node: ignore pair tag rect vs nothing else inside; tag vs label counts
        const area = ia(a, b);
        const min = Math.min(a.w * a.h, b.w * b.h);
        if (area > 6 && area / min > 0.06) out.push({ a: a.g + ' "' + a.t + '"', b: b.g + ' "' + b.t + '"', area: Math.round(area), frac: +(area / min).toFixed(2) });
      }
      const pri = (o) => (/^(mk|ui)/.test(o.a) || /^(mk|ui)/.test(o.b)) ? 0 : (/gl:/.test(o.a + o.b) ? 1 : 2);
      out.sort((a, b) => pri(a) - pri(b) || b.frac - a.frac);
      return out;
    },
    pathHits() {
      const out = []; const rects = [];
      for (const tk of document.querySelectorAll('#tokens .tk')) { if (parseFloat(getComputedStyle(tk).opacity) < 0.25) continue; const r = tk.querySelector('.w').getBoundingClientRect(); rects.push({ id: tk.dataset.id, x: r.x + 2, y: r.y + r.height * 0.28, x2: r.right - 2, y2: r.bottom - r.height * 0.28, t: tk.querySelector('.w').textContent }); }
      for (const id of ['en', 'ribbon', 'parse', 'rail', 'callout', 'card']) for (const r of textRects(document.getElementById(id))) rects.push({ id: 'ui:' + id, x: r.x + 1, y: r.y + r.h * 0.2, x2: r.x + r.w - 1, y2: r.y + r.h * 0.8, t: r.t });
      for (const el of document.querySelectorAll('#marks .mk-label, #marks .mk-tag-text')) { const r = el.getBoundingClientRect(); rects.push({ id: 'mk:label', x: r.x, y: r.y, x2: r.right, y2: r.bottom, t: el.textContent, self: el.parentNode }); }
      for (const path of document.querySelectorAll('#marks .mk-arrow, #marks .mk-link, #marks .mk-tie')) {
        const L = path.getTotalLength(); const m = path.getScreenCTM(); const hits = new Map();
        for (let d = 8; d < L - 8; d += 5) {
          const pt = path.getPointAtLength(d); const X = pt.x * m.a + pt.y * m.c + m.e, Y = pt.x * m.b + pt.y * m.d + m.f;
          for (const r of rects) { if (r.self && r.self.contains(path)) continue; if (X > r.x && X < r.x2 && Y > r.y && Y < r.y2) hits.set(r.id + ':' + r.t, (hits.get(r.id + ':' + r.t) || 0) + 1); }
        }
        const real = [...hits].filter(([k, n]) => n >= 2);
        if (real.length) out.push({ path: path.getAttribute('class'), hits: real.map(([k, n]) => k + ' x' + n).slice(0, 5) });
      }
      return out;
    },
    hiddenRows() {
      const out = {};
      const fold = (id, sel) => { const p = document.getElementById(id); if (!p || !vis(p)) return; const pr = p.getBoundingClientRect(); const rows = [...p.querySelectorAll(sel)].filter(vis); const cut = rows.filter(r => r.getBoundingClientRect().bottom > Math.min(pr.bottom, innerHeight) + 1); if (cut.length) out[id] = { rows: rows.length, cut: cut.length, panelBottom: Math.round(pr.bottom), scrollable: p.scrollHeight > p.clientHeight + 2 }; };
      fold('parse', '.pl-row'); fold('rail', '.cite'); 
      const c = document.getElementById('card'); if (c && vis(c)) { const b = c.querySelector('.cd-body') || c; out.card = { sh: b.scrollHeight, ch: b.clientHeight, shown: Math.round(100 * Math.min(1, b.clientHeight / Math.max(1, b.scrollHeight))) + '%' }; }
      const more = document.querySelector('#more .more-btn'); if (more && vis(more)) { const mr = more.getBoundingClientRect(); const hit = []; for (const el of document.querySelectorAll('#parse .pl-row, #parse .pl-why, #card, #rail .cite')) { if (!vis(el)) continue; const r = el.getBoundingClientRect(); if (Math.min(mr.right, r.right) - Math.max(mr.left, r.left) > 2 && Math.min(mr.bottom, r.bottom) - Math.max(mr.top, r.top) > 2) hit.push(el.className.toString().slice(0, 20)); } if (hit.length) out.moreOverlaps = hit; out.moreRect = [Math.round(mr.left), Math.round(mr.top), Math.round(mr.right), Math.round(mr.bottom)]; }
      return out;
    },
    offscreen() {
      const out = []; const W = innerWidth, H = innerHeight;
      const chk = (g, r, t) => { if (r.x < -1 || r.y < -1 || r.x + r.w > W + 1 || r.y + r.h > H + 1) out.push({ g, t, r: [Math.round(r.x), Math.round(r.y), Math.round(r.x + r.w), Math.round(r.y + r.h)] }); };
      for (const tk of document.querySelectorAll('#tokens .tk')) { if (parseFloat(getComputedStyle(tk).opacity) < 0.25) continue; const r = tk.querySelector('.w').getBoundingClientRect(); chk('tok:' + tk.dataset.id, { x: r.x, y: r.y, w: r.width, h: r.height }, tk.querySelector('.w').textContent); }
      for (const id of ['ribbon', 'en', 'callout', 'more']) for (const r of textRects(document.getElementById(id))) chk('ui:' + id, r, r.t);
      for (const id of ['parse', 'rail', 'card']) { const pr = document.getElementById(id); if (!pr || !vis(pr)) continue; const b = pr.getBoundingClientRect(); if (b.bottom > H + 1 || b.right > W + 1) out.push({ g: 'panel:' + id, r: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] }); }
      for (const el of document.querySelectorAll('#marks .mk-label, #marks .mk-tag')) { const r = el.getBoundingClientRect(); chk('mk', { x: r.x, y: r.y, w: r.width, h: r.height }, el.textContent); }
      return out;
    },
    clipped() {
      const out = [];
      for (const id of ['ribbon', 'en', 'parse', 'rail', 'callout', 'card', 'more']) {
        const el = document.getElementById(id); if (!el || !vis(el)) continue;
        const cs = getComputedStyle(el);
        if (el.scrollHeight > el.clientHeight + 2 && !/(auto|scroll)/.test(cs.overflowY)) out.push({ id, kind: 'clipped-y', sh: el.scrollHeight, ch: el.clientHeight, ov: cs.overflowY });
        if (el.scrollWidth > el.clientWidth + 2 && !/(auto|scroll)/.test(cs.overflowX)) out.push({ id, kind: 'clipped-x', sw: el.scrollWidth, cw: el.clientWidth, ov: cs.overflowX });
        // any descendant text that extends past the panel bottom while overflow hidden
        const pr = el.getBoundingClientRect();
        for (const r of textRects(el)) if (r.y + r.h > pr.bottom + 2 && /hidden|clip/.test(cs.overflowY)) { out.push({ id, kind: 'text-below-panel', t: r.t }); break; }
      }
      return out;
    },
    sizes() {
      const k = window.__deck.box().k; const q = (sel) => [...document.querySelectorAll(sel)].filter(vis).map(e => +(parseFloat(getComputedStyle(e).fontSize) / k).toFixed(1));
      const mn = (a) => a.length ? Math.min(...a) : null;
      return { slot: mn(q('#en .slot')), plrow: mn(q('#parse .pl-row .pl-form, #parse .pl-row')), plwhy: mn(q('#parse .pl-why')), gl: mn(q('#glosses .gl')), cite: mn(q('#rail .cite')), card: mn(q('#card .cd-body')) };
    },
    sourceKeys(i, cardId) {
      const data = window.__DATA__, state = window.__deck.state(i);
      const row = id => Object.values(data.parses).map(p => p[id]).find(Boolean);
      const v = state.view ?? {};
      const keys = [...state.cite, state.callout?.cite, v.cite, v.left?.cite, v.right?.cite,
        ...[...state.list, state.card?.token, cardId].filter(Boolean).flatMap(id => row(id)?.sources ?? [])];
      return [...new Set(keys)].filter(k => k && data.cites[k]);
    },
  };
};

async function installFns(page) { await page.evaluate(`(${PAGE_FNS.toString()})()`); }

async function settle(page) {
  await page.waitForFunction(() => window.__deck && window.__deck.settled(), null, { timeout: 15000 });
  await sleep(380);
}
const goto = async (page, i) => { await page.evaluate(async (i) => { await window.__deck.go(i); }, i); await settle(page); };
const next = async (page) => { await page.evaluate(async () => { await window.__deck.next(); }); await settle(page); };
const back = async (page) => { await page.evaluate(async () => { await window.__deck.back(); }); await settle(page); };
const table = (page) => page.evaluate(() => window.__deck.tokens().map(t => ({ id: t.id, x: t.x, y: t.y, size: t.size, o: t.opacity, tr: t.transform })));
const cmpTables = (A, B, tolPx = 0.5) => {
  let worst = 0, bad = [];
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = B[i];
    const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.size - b.size));
    const od = Math.abs(a.o - b.o);
    // an invisible token's position is not observable; compare only if either is visible
    if ((a.o > 0.02 || b.o > 0.02) && (d > tolPx || od > 0.02)) bad.push({ id: a.id, d: +d.toFixed(2), od: +od.toFixed(3) });
    if (a.o > 0.02 || b.o > 0.02) worst = Math.max(worst, d);
  }
  return { worst: +worst.toFixed(3), bad: bad.slice(0, 6), nbad: bad.length };
};

async function runViewport(browser, W, H) {
  const tag = `${W}x${H}`; const dir = path.join(OUT, tag); mkdirSync(dir, { recursive: true });
  let PH = 'boot'; const R = { vp: tag, steps: [], errors: [], network: [], checks: {}, defects: [] };
  const D = (sev, check, step, msg, extra) => R.defects.push({ sev, check, step, msg, ...(extra ? { extra } : {}) });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, permissions: ['clipboard-read', 'clipboard-write'] });
  const watch = (p, name) => {
    p.on('console', m => { if (PH === 'boot' && /Unsafe attempt to load URL/.test(m.text())) return; /* CDP CSS.enable artefact, not a deck error */ if (m.type() === 'error' || (m.type() === 'warning' && !GL_NOISE.test(m.text()))) R.errors.push(`[${PH}] ${name} ${m.type()}: ${m.text().slice(0, 240)} @${(m.location().url || '').slice(-40)}:${m.location().lineNumber}`); });
    p.on('pageerror', e => R.errors.push(`${name} PAGEERROR: ${e.message.slice(0, 240)}`));
    p.on('request', rq => { const u = rq.url(); if (!/^(file:|data:|blob:|about:)/.test(u)) R.network.push(u.slice(0, 120)); });
  };
  const page = await ctx.newPage(); watch(page, 'deck');
  await page.goto(URL0 + '?i=0');
  await page.waitForFunction(() => window.__deck && window.__deck.count, null, { timeout: 20000 });
  await settle(page); await installFns(page);
  const meta = await page.evaluate(() => ({ n: window.__deck.count(), k: window.__deck.box().k, world: window.__deck.world(), root: window.__ROOT__, steps: window.__DATA__.steps.map(s => ({ i: s.i, id: s.id, head: s.head, mode: s.view.mode, world: s.world, card: s.card?.token ?? null, cites: s.cite.length })), tokens: window.__DATA__.tokens.map(t => [t.id, t.text, t.post]), gap: [...window.__DATA__.gap.gapSentence, window.__DATA__.gap.variant].map(t => [t.id, t.text, t.post]) }));
  R.n = meta.n; R.k = meta.k; R.world0 = meta.world; R.root = meta.root;
  const stepsMeta = meta.steps;
  // tag every token node: identity must survive the whole run
  await page.evaluate(() => { document.querySelectorAll('.tk').forEach((e, i) => { e.__qaid = i; }); window.__qaCount = document.querySelectorAll('.tk').length; });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const fontCheck = async () => {
    // every element holding Greek text: .w and .pc of each visible token, plus any Greek text in panels
    await page.evaluate(() => {
      document.querySelectorAll('[data-qag]').forEach(e => e.removeAttribute('data-qag'));
      const grc = /[Ͱ-Ͽἀ-῿]/; const seen = new Set();
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
      while ((n = tw.nextNode())) {
        const el = n.parentElement; if (!el || el.closest('script,style')) continue;
        const isTk = !!el.closest('.tk');
        if (!(grc.test(n.nodeValue) || (isTk && /[’·]/.test(n.nodeValue)))) continue;
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        const o = parseFloat(getComputedStyle(el.closest('.tk') || el).opacity);
        if (o < 0.02) continue;
        if (!isTk && (cs.display === 'none' || r.width === 0)) continue;
        el.setAttribute('data-qag', '1');
      }
    });
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-qag]' });
    const bad = []; let count = 0;
    for (const nodeId of nodeIds) {
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      count++;
      const nonG = fonts.filter(f => !/Gentium Book Plus/i.test(f.familyName) || !f.isCustomFont);
      if (!fonts.length || nonG.length) {
        const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId });
        bad.push({ html: outerHTML.slice(0, 90), fonts: fonts.map(f => f.familyName + (f.isCustomFont ? '' : '(system)') + ' x' + f.glyphCount) });
      }
    }
    return { count, bad };
  };

  async function sourcePhase() {
  PH = 'source';
  const order = []; for (let s = 0, i = 0; s < meta.n; s++) { order.push(i); i = (i + 13) % meta.n; }
  // ---------- source view ----------
  const SV = { fail: [], notes: [] };
  const popP = ctx.waitForEvent('page', { timeout: 6000 }).catch(() => null);
  await goto(page, 0);
  await page.keyboard.press('s');
  const pop = process.argv.includes('--nosource') ? null : await popP;
  if (process.argv.includes('--nosource')) SV.notes.push('source walk skipped at this viewport (--nosource)');
  else if (!pop) SV.fail.push('S did not open a popup');
  else {
    watch(pop, 'popup');
    await pop.waitForSelector('#pl-pos', { timeout: 5000 }).catch(() => SV.fail.push('popup has no #pl-pos'));
    const readPop = async (i) => {
      await pop.waitForFunction((n) => /Press (\d+) of/.test(document.getElementById('pl-pos').textContent) && +document.getElementById('pl-pos').textContent.match(/Press (\d+) of/)[1] === n, i + 1, { timeout: 4000 }).catch(() => { });
      return pop.evaluate(() => ({ step: document.getElementById('pl-pos').textContent, head: document.getElementById('pl-pos').textContent, notesLen: (document.getElementById('pl-notes') || { innerText: '' }).innerText.length, cueLen: (document.getElementById('pl-cue') || { innerText: '' }).innerText.length, aloudLen: (document.getElementById('pl-aloud') || { innerText: '' }).innerText.length, sideLen: (document.getElementById('pl-side') || { innerText: '' }).innerText.length, empty: document.querySelector('#pl-rows .empty')?.textContent ?? null, rows: [...document.querySelectorAll('#pl-rows .row')].map(r => ({ key: r.dataset.key, grade: r.dataset.grade, disp: r.querySelector('.disp')?.textContent, path: r.querySelector('.path')?.textContent ?? null, href: r.querySelector('a.file')?.href ?? null, none: r.querySelector('.none')?.textContent ?? null, copyBtn: !!r.querySelector('button.copy'), sel: r.classList.contains('sel') })) }));
    };
    const verifyStep = async (i, how) => {
      const want = await page.evaluate((i) => window.__qa.sourceKeys(i, null), i);
      const got = await readPop(i);
      if (await pop.evaluate(NAME_SCAN)) SV.fail.push(`${how} step ${i + 1}: banned name in the source window`);
      const keys = got.rows.map(r => r.key);
      if (JSON.stringify([...keys].sort()) !== JSON.stringify([...want].sort())) SV.fail.push(`${how} step ${i + 1}: rows ${JSON.stringify(keys)} != sourceKeys ${JSON.stringify(want)}`);
      if (!want.length && got.empty !== 'No citations on this view') SV.fail.push(`${how} step ${i + 1}: empty text "${got.empty}"`);
      if (!got.notesLen || !got.cueLen) SV.fail.push(`${how} step ${i + 1}: presenter notes ${got.notesLen} chars, cue ${got.cueLen} chars`);
      if (!got.sideLen) SV.fail.push(`${how} step ${i + 1}: presenter sidebar empty`);
      if (want.length && got.empty) SV.fail.push(`${how} step ${i + 1}: empty message shown with citations`);
      if (!got.step.startsWith(`Press ${i + 1} of`)) SV.fail.push(`${how} step ${i + 1}: header "${got.step}"`);
      const cites = await page.evaluate(() => window.__DATA__.cites);
      for (const r of got.rows) {
        const c = cites[r.key];
        if (r.grade !== c.grade) SV.fail.push(`${how} ${r.key}: grade ${r.grade} != ${c.grade}`);
        if (r.disp !== (c.ref?.display || c.label)) SV.fail.push(`${how} ${r.key}: display "${r.disp}"`);
        if (c.shot) {
          if (r.path !== `${meta.root}/${c.shot}`) SV.fail.push(`${how} ${r.key}: path "${r.path}" != ROOT/shot`);
          if (!r.copyBtn) SV.fail.push(`${how} ${r.key}: no Copy path`);
          if (!r.href || !r.href.startsWith('file://')) SV.fail.push(`${how} ${r.key}: bad link ${r.href}`);
        } else if (r.none !== 'No screenshot saved' && r.none !== 'Image not available. Reference only.' && r.none !== 'Reference only.') SV.fail.push(`${how} ${r.key}: no-shot text "${r.none}"`);
      }
      return got;
    };
    SV.checkedSteps = 0;
    await verifyStep(0, 'initial');
    for (let i = 1; i < meta.n; i++) { await next(page); await verifyStep(i, 'next'); SV.checkedSteps++; }
    for (let i = meta.n - 2; i >= 0; i--) { await back(page); await verifyStep(i, 'back'); SV.checkedSteps++; }
    for (const i of order) { await goto(page, i); await verifyStep(i, 'go'); SV.checkedSteps++; }
    // selectable path, link opens image, copy path
    let sampleStep = stepsMeta.find(s => s.cites > 0)?.i ?? 0;
    await goto(page, sampleStep); const got = await readPop(sampleStep);
    const withPath = got.rows.find(r => r.path);
    if (!withPath) SV.notes.push('no row with a path at the sample step');
    else {
      const us = await pop.evaluate(() => { const p = document.querySelector('#pl-rows .path'); const cs = getComputedStyle(p); return { us: cs.userSelect, ws: cs.webkitUserSelect }; });
      if (us.us === 'none') SV.fail.push('path text is not selectable');
      await pop.locator('#pl-rows .row').first().locator('button.copy').click(); await sleep(250);
      const clip = await page.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR ' + e.message));
      const clipPop = await pop.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR ' + e.message));
      const first = got.rows[0];
      if (clip !== first.path && clipPop !== first.path) SV.fail.push(`Copy path did not reach clipboard (page "${String(clip).slice(0, 60)}", popup "${String(clipPop).slice(0, 60)}")`);
      const lp = await ctx.newPage(); watch(lp, 'imgview');
      const resp = await lp.goto(first.href).catch(e => ({ ok: () => false, status: () => 'ERR' + e.message }));
      const okImg = resp && resp.ok && resp.ok() && await lp.evaluate(() => { const im = document.images[0]; return !!im && im.naturalWidth > 0; }).catch(() => false);
      if (!okImg) SV.fail.push('file:// link did not open an image: ' + first.href);
      await lp.close();
    }
    PH = 'source-rail';
    // rail click highlights its row
    const railStep = stepsMeta.find(s => s.cites > 0)?.i ?? 0;
    await goto(page, railStep);
    const railKey = await page.evaluate(() => document.querySelector('#rail .cite[data-key]')?.dataset.key ?? null);
    if (railKey) {
      await page.locator(`#rail .cite[data-key="${railKey}"]`).first().click({ position: { x: 6, y: 6 }, trial: false }).catch(e => SV.fail.push('rail click: ' + e.message.slice(0, 80)));
      await sleep(300);
      const selKey = await pop.evaluate(() => document.querySelector('#pl-rows .row.sel')?.dataset.key ?? null);
      if (selKey !== railKey) SV.fail.push(`rail click on ${railKey} highlights ${selKey}`);
      await page.keyboard.press('Escape'); await sleep(100);
    } else SV.notes.push('no rail cite at step ' + (railStep + 1));
    PH = 'source-reload';
    // reload recovery through BroadcastChannel
    await page.goto(URL0 + '?i=5'); await page.waitForFunction(() => window.__deck && window.__deck.count, null, { timeout: 20000 }); await settle(page);
    const rec = await readPop(5); if (!rec.step.startsWith('Press 6 of')) SV.fail.push(`deck reload did not recover the popup: "${rec.step}"`);
    await page.evaluate(`(${PAGE_FNS.toString()})()`);
    PH = 'source-tab';
    // ?view=sources tab
    const tab = await ctx.newPage(); watch(tab, 'tab');
    await tab.goto(URL0 + '?view=sources'); await sleep(800);
    const tinfo = await tab.evaluate(() => ({ deck: typeof window.__deck, canvas: document.querySelectorAll('canvas').length, tk: document.querySelectorAll('.tk').length, step: document.getElementById('pl-pos')?.textContent ?? null, buttons: [...document.querySelectorAll('button')].map(b => b.textContent), inputs: document.querySelectorAll('input,select,textarea').length, scriptsInBody: document.body.querySelectorAll('script').length, gl: (() => { try { return !!document.createElement('canvas').getContext('webgl'); } catch (e) { return false; } })() }));
    SV.tab = tinfo;
    if (tinfo.deck !== 'undefined') SV.fail.push('tab has __deck'); if (tinfo.canvas) SV.fail.push('tab has a canvas'); if (tinfo.tk) SV.fail.push('tab has tokens');
    if (!/Press 6 of/.test(tinfo.step || '')) SV.fail.push(`tab did not sync: "${tinfo.step}"`);
    if (tinfo.buttons.some(b => b !== 'Copy path')) SV.fail.push('tab has extra controls: ' + tinfo.buttons.filter(b => b !== 'Copy path'));
    await goto(page, 9); const tg = await tab.evaluate(() => document.getElementById('pl-pos').textContent); if (!/Press 10 of/.test(tg)) SV.fail.push(`tab did not follow go(): "${tg}"`);
    if (await tab.evaluate(NAME_SCAN)) SV.fail.push('banned name in the ?view=sources tab');
    await tab.screenshot({ path: path.join(dir, 'zz-sources-tab.png') });
    await pop.screenshot({ path: path.join(dir, 'zz-sources-popup.png') });
    await tab.close(); await pop.close();
  }
  R.checks.source = SV;
  }
  if (SRCONLY) { await sourcePhase(); await ctx.close(); return R; }
  PH = 'forward';
  // ---------- forward walk ----------
  const fwd = [], fwdLayout = [];
  const minSizes = {};
  const pageOvBad = [], nameBad = [], pathBad = [], hiddenBad = [], textBad = [], tfBad = [], ovBad = [], offBad = [], clipBad = [], fontBad = [], ovfBad = [], layoutBad = [], worldBad = [];
  const heads = [];
  for (let i = 0; i < meta.n; i++) {
    if (i > 0) await next(page);
    const st = stepsMeta[i];
    const T = await table(page); fwd.push(T);
    await page.screenshot({ path: path.join(dir, `${String(i + 1).padStart(2, '0')}-${st.id}.png`) });
    // text bytes
    const tb = await page.evaluate(({ tokens, gap }) => {
      const bad = [];
      for (const [id, text, post] of [...tokens, ...gap]) {
        const el = document.querySelector(`.tk[data-id="${id}"]`);
        if (!el) { bad.push(id + ' missing'); continue; }
        if (el.querySelector('.w').textContent !== text || (el.querySelector('.pc')?.textContent ?? '') !== (post ?? '')) bad.push(id);
      }
      return bad;
    }, { tokens: meta.tokens, gap: meta.gap });
    if (tb.length) { textBad.push({ i, tb }); }
    // transform at rest, overflow
    const nonNone = T.filter(t => t.tr !== 'none');
    if (nonNone.length) tfBad.push({ i, n: nonNone.length, e: nonNone[0].tr });
    if (await page.evaluate(() => window.__deck.overflow())) ovfBad.push(i);
    const pov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight }));
    if (pov.sw > pov.iw + 1 || pov.sh > pov.ih + 1) pageOvBad.push({ i, ...pov });
    if (await page.evaluate(NAME_SCAN)) nameBad.push({ i, win: 'deck' });
    // equality with layout(state, box)
    const L = await page.evaluate((i) => { const d = window.__deck; const l = d.layout(d.state(i), d.box()); return Object.entries(l.tokens).map(([id, v]) => ({ id, x: v.x * d.box().k, y: v.y * d.box().k, size: v.size, o: v.opacity })); }, i);
    // layout x,y are stage px top-left of the token box; compare after scaling by k, sizes in stage px
    const k = meta.k; const bx = await page.evaluate(() => { const d = window.__deck; return { x0: 0 }; });
    const Tm = new Map(T.map(t => [t.id, t]));
    let lw = 0, lbad = [];
    for (const l of L) { const t = Tm.get(l.id); if (!t || (t.o < 0.02 && l.o < 0.02)) continue; const dx = Math.abs(t.x - l.x / k * 1), dy = Math.abs(t.y - l.y / k * 1), ds = Math.abs(t.size - l.size); const d = Math.max(dx, dy, ds); lw = Math.max(lw, d); if (d > 0.75) lbad.push({ id: l.id, dx: +dx.toFixed(2), dy: +dy.toFixed(2), ds: +ds.toFixed(2) }); }
    if (lbad.length) layoutBad.push({ i, worst: +lw.toFixed(2), n: lbad.length, e: lbad.slice(0, 3) });
    // world cue
    const wd = await page.evaluate(() => window.__deck.world());
    if (wd.mode !== 'webgl') worldBad.push({ i, mode: wd.mode });
    if (wd.cue !== st.world) worldBad.push({ i, cue: wd.cue, want: st.world });
    // overlaps, offscreen, clipping
    const ov = await page.evaluate(() => window.__qa.overlaps()); if (ov.length) ovBad.push({ i, id: st.id, ov: ov.slice(0, 12), n: ov.length });
    const ph = await page.evaluate(() => window.__qa.pathHits()); if (ph.length) pathBad.push({ i, id: st.id, ph });
    const hr = await page.evaluate(() => window.__qa.hiddenRows()); if (Object.keys(hr).length) hiddenBad.push({ i, id: st.id, ...hr });
    const off = await page.evaluate(() => window.__qa.offscreen()); if (off.length) offBad.push({ i, id: st.id, off: off.slice(0, 4) });
    const cl = await page.evaluate(() => window.__qa.clipped()); if (cl.length) clipBad.push({ i, id: st.id, cl });
    // font
    const fc = await fontCheck(); if (fc.bad.length) fontBad.push({ i, id: st.id, count: fc.count, bad: fc.bad.slice(0, 4), nbad: fc.bad.length });
    R.fontElems = (R.fontElems || 0) + fc.count;
    // sizes
    const sz = await page.evaluate(() => window.__qa.sizes());
    const tkSizes = await page.evaluate(() => { const k = window.__deck.box().k; return window.__deck.tokens().filter(t => t.opacity > 0.9).map(t => t.size); });
    R.steps.push({ i, id: st.id, head: st.head, mode: st.mode, sz, tkMin: tkSizes.length ? Math.min(...tkSizes) : null, tkMax: tkSizes.length ? Math.max(...tkSizes) : null });
    heads.push(st.head);
  }
  R.checks.pageOverflow = pageOvBad; R.checks.nameScan = nameBad; R.checks.text = textBad; R.checks.transform = tfBad; R.checks.overflow = ovfBad; R.checks.layoutEq = layoutBad; R.checks.world = worldBad;
  R.checks.overlap = ovBad; R.checks.pathHits = pathBad; R.checks.hidden = hiddenBad; R.checks.headings = heads.map((h, i) => ({ i, h, words: h.trim().split(/\s+/).length })).filter(x => x.words > 6); R.checks.offscreen = offBad; R.checks.clipped = clipBad; R.checks.font = fontBad;
  R.checks.identity = await page.evaluate(() => { const els = [...document.querySelectorAll('.tk')]; return { n: els.length, was: window.__qaCount, ok: els.every(e => e.__qaid !== undefined), tokensLayer: document.querySelectorAll('#tokens > .tk').length, extrasLayer: document.querySelectorAll('#extras > .tk').length }; });

  PH = 'back';
  // ---------- back walk ----------
  const bk = []; bk[meta.n - 1] = fwd[meta.n - 1];
  for (let i = meta.n - 2; i >= 0; i--) { await back(page); bk[i] = await table(page); }
  PH = 'jump';
  // ---------- jump (scattered order, from distance) ----------
  const order = []; for (let s = 0, i = 0; s < meta.n; s++) { order.push(i); i = (i + 13) % meta.n; }
  const jp = [];
  for (const i of order) { await goto(page, i); jp[i] = await table(page); }
  const eq = { back: [], jump: [] };
  for (let i = 0; i < meta.n; i++) {
    const b = cmpTables(fwd[i], bk[i]); if (b.nbad) eq.back.push({ i, ...b });
    const j = cmpTables(fwd[i], jp[i]); if (j.nbad) eq.jump.push({ i, ...j });
  }
  // ?i=N: a fresh load straight to step N must give the same stage as the forward walk
  PH = 'url-jump'; eq.url = [];
  for (let i = 0; i < meta.n; i++) {
    const up = await ctx.newPage(); watch(up, 'url-i');
    await up.goto(URL0 + '?i=' + i); await up.waitForFunction(() => window.__deck && window.__deck.count, null, { timeout: 20000 }); await settle(up);
    const u = await table(up); const c = cmpTables(fwd[i], u); if (c.nbad) eq.url.push({ i, ...c });
    if (await up.evaluate(NAME_SCAN)) nameBad.push({ i, win: '?i=N' });
    await up.close();
  }
  R.checks.equality = eq;

  // ---------- copy test ----------
  await goto(page, 2);
  R.checks.copy = await page.evaluate((tokens) => {
    const t = document.getElementById('tokens'); const r = document.createRange(); r.selectNodeContents(t);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const got = s.toString(); const want = tokens.map(([, a, b]) => a + b).join(' ');
    s.removeAllRanges();
    return { ok: got.replace(/\s+/g, ' ').trim() === want, len: [got.length, want.length], diff: got.replace(/\s+/g, ' ').trim() === want ? null : [got.slice(0, 80), want.slice(0, 80)] };
  }, meta.tokens);

  PH = 'cards';
  // ---------- click opens nothing (no card on the stage), drag selects, #card is absent ----------
  const cards = { opened: 0, fail: [], kinds: {}, geom: [], dragOpened: null, cardElement: await page.evaluate(() => !!document.getElementById('card')) };
  try {
    for (const i of [2, 40, 100]) {
      await goto(page, i);
      for (const id of await page.evaluate(() => window.__deck.tokens().filter(t => t.opacity > 0.9).slice(0, 6).map(t => t.id))) {
        const box = await page.evaluate((id) => { const r = document.querySelector(`.tk[data-id="${id}"] .w`).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, id);
        await page.mouse.click(box[0], box[1]); await sleep(60);
        const opened = await page.evaluate(() => { const c = document.getElementById('card'); return !!c && window.__qa.vis(c); });
        if (opened) { cards.opened++; cards.fail.push(`step ${i + 1} click on ${id} opened a card`); }
      }
    }
    await goto(page, 2);
    const bx = await page.evaluate(() => { const r = document.querySelector('#tokens .tk .w').getBoundingClientRect(); return [r.x + 4, r.y + r.height / 2]; });
    await page.mouse.move(bx[0], bx[1]); await page.mouse.down(); await page.mouse.move(bx[0] + 140, bx[1] + 3, { steps: 8 }); await page.mouse.up(); await sleep(120);
    cards.dragOpened = await page.evaluate(() => { const c = document.getElementById('card'); return !!c && window.__qa.vis(c); }); await page.evaluate(() => getSelection().removeAllRanges());
  } catch (e) { R.errors.push('HARNESS cards: ' + String(e.message).slice(0, 160)); }
  R.checks.cards = cards;

  PH = 'world';
  try {
  // ---------- world, WebGL on ----------
  const worldPix = [];
  for (const i of [1, 12, 13]) {
    await goto(page, i);
    const stats = await page.evaluate(async () => {
      const ids = ['stage', 'scrim']; const saved = ids.map(id => document.getElementById(id).style.display);
      ids.forEach(id => document.getElementById(id).style.display = 'none');
      return { cue: window.__deck.world().cue, mode: window.__deck.world().mode };
    });
    const buf = await page.screenshot({ type: 'png' });
    await page.evaluate(() => { ['stage', 'scrim'].forEach(id => document.getElementById(id).style.display = ''); });
    worldPix.push({ i, ...stats, bytes: buf.length });
  }
  R.checks.worldRaw = worldPix;
  } catch (e) { R.errors.push('HARNESS world: ' + String(e.message).slice(0, 160)); }

  await sourcePhase();

  await ctx.close();
  return R;
}


// =====================================================================================================
// Probe and grammar checks.
// Run: node tools/qa.mjs --probe --file build/qa/probe.html [--vp 1920x1080,1440x1080,1024x768] [--out build/qa]
// Also exported to a full-deck run through --grammar: arrows vs token rects, --done contrast, mark-set equality, one row per token, greyscale.
// =====================================================================================================
const PROBE = process.argv.includes('--probe');
const GRAMMAR_FNS = () => {
  const effOpacity = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const effHidden = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return true; } return false; };
  const toStage = (r) => { const k = window.__deck.box().k; return { x: r.x / k, y: r.y / k, w: r.width / k, h: r.height / k }; };
  window.__gr = {
    effOpacity,
    /** every drawn arrow/tie/link/gap line sampled every 4 stage px; hits on visible token ink rects */
    arrowHits() {
      const k = window.__deck.box().k; const rects = [];
      for (const tk of document.querySelectorAll('#tokens .tk, #extras .tk')) {
        if (effOpacity(tk) < 0.25) continue; const w = tk.querySelector('.w'); const r = w.getBoundingClientRect(); if (r.width < 1) continue;
        rects.push({ id: tk.dataset.id, x: r.x + 1, y: r.y + r.height * 0.22, x2: r.right - 1, y2: r.bottom - r.height * 0.22 });
      }
      const out = [];
      for (const g of document.querySelectorAll('.mk[data-k="arrow"], .mk[data-k="gap"], .mk[data-k="supplies"]')) {
        if (g.dataset.dormant === '1' || effOpacity(g) < 0.2) continue;
        for (const path of g.querySelectorAll('.mk-line, .mk-gap, .mk-btie')) {
          const m = path.getScreenCTM(); let L; try { L = path.getTotalLength(); } catch (e) { continue; }
          const hits = new Map();
          for (let d = 6; d < L - 6; d += 4 * k) {
            const pt = path.getPointAtLength(d); const X = pt.x * m.a + pt.y * m.c + m.e, Y = pt.x * m.b + pt.y * m.d + m.f;
            for (const r of rects) if (X > r.x && X < r.x2 && Y > r.y && Y < r.y2) hits.set(r.id, (hits.get(r.id) || 0) + 1);
          }
          const real = [...hits].filter(([, n]) => n >= 2);
          if (real.length) out.push({ key: g.dataset.key, rel: g.dataset.rel, hits: real.map(([id, n]) => id + ' x' + n) });
        }
      }
      return out;
    },
    /** tag rows: each tag box vs its own line, its neighbours, other visible tokens, and the stage */
    tagRows() {
      const d = window.__deck, k = d.box().k, W = d.box().W, H = d.box().H; const bad = [];
      const tags = d.tags().filter(t => t && t.w > 0);
      const toks = d.tokens().filter(t => t.opacity > 0.25);
      const byId = new Map(d.tokens().map(t => [t.id, t]));
      const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      for (const t of tags) {
        if (t.x < -1 || t.x + t.w > W + 1 || t.y < -1 || t.y + t.h > H + 1) bad.push({ id: t.id, why: 'tag outside stage', r: [t.x, t.y, t.x + t.w, t.y + t.h].map(Math.round) });
        const own = byId.get(t.id);
        if (own) { const cx = own.x + own.w / 2, tc = t.x + t.w / 2; if (Math.abs(cx - tc) > Math.max(own.w, t.w) * 0.75 + 40) bad.push({ id: t.id, why: 'tag detached from its word', dx: Math.round(tc - cx) }); }
        for (const o of toks) if (o.id !== t.id && inter(t, { x: o.x, y: o.y + o.h * 0.2, w: o.w, h: o.h * 0.6 }) > 8) bad.push({ id: t.id, why: 'tag overlaps word ' + o.id });
      }
      // a line = tags whose tops are within 20 px; neighbours must not overlap, and the row must sit inside the span of its line's words plus 1 em
      const lines = []; for (const t of [...tags].sort((a, b) => a.y - b.y)) { const L = lines.find(l => Math.abs(l.y - t.y) < 20); if (L) L.t.push(t); else lines.push({ y: t.y, t: [t] }); }
      for (const L of lines) {
        L.t.sort((a, b) => a.x - b.x);
        for (let i = 1; i < L.t.length; i++) if (L.t[i].x < L.t[i - 1].x + L.t[i - 1].w - 1) bad.push({ id: L.t[i - 1].id + '/' + L.t[i].id, why: 'tags overlap on one row', by: Math.round(L.t[i - 1].x + L.t[i - 1].w - L.t[i].x) });
        const ws = L.t.map(t => byId.get(t.id)).filter(Boolean);
        if (ws.length) { const lo = Math.min(...ws.map(w => w.x)), hi = Math.max(...ws.map(w => w.x + w.w)); const tl = Math.min(...L.t.map(t => t.x)), th = Math.max(...L.t.map(t => t.x + t.w)); if (tl < lo - 80 || th > hi + 80) bad.push({ id: 'row@' + Math.round(L.y), why: 'tag row sticks out of its line', line: [lo, hi].map(Math.round), tags: [tl, th].map(Math.round) }); }
      }
      return { n: tags.length, bad, minTagPx: tags.length ? Math.min(...[...document.querySelectorAll('#glosses .tg')].filter(e => effOpacity(e) > 0.5).map(e => parseFloat(getComputedStyle(e).fontSize) / k)) : null };
    },
    /** nothing wider than its zone: lines of tokens vs 1920 stage, panels not scrolling or clipped, labels inside stage */
    widths() {
      const d = window.__deck, W = d.box().W, H = d.box().H, bad = [];
      const toks = d.tokens().filter(t => t.opacity > 0.25 && t.w > 0);
      for (const t of toks) if (t.x < -1 || t.x + t.w > W + 1 || t.y < -1 || t.y + t.h > H + 1) bad.push({ id: t.id, why: 'token outside stage', r: [t.x, t.y, t.x + t.w, t.y + t.h].map(Math.round) });
      const lines = []; for (const t of [...toks].sort((a, b) => a.y - b.y)) { const L = lines.find(l => Math.abs(l.y - t.y) < t.size * 0.35 && Math.abs(l.size - t.size) < 3); if (L) L.t.push(t); else lines.push({ y: t.y, size: t.size, t: [t] }); }
      const lineW = [];
      for (const L of lines) { const lo = Math.min(...L.t.map(t => t.x)), hi = Math.max(...L.t.map(t => t.x + t.w)); lineW.push({ y: Math.round(L.y), size: Math.round(L.size), n: L.t.length, x0: Math.round(lo), x1: Math.round(hi), w: Math.round(hi - lo) }); if (hi - lo > W - 96 + 2) bad.push({ why: 'line wider than the stage margins', y: Math.round(L.y), w: Math.round(hi - lo), n: L.t.length }); }
      for (const id of ['ribbon', 'en', 'parse', 'rail', 'callout']) { const el = document.getElementById(id); if (!el || effHidden(el)) continue; if (el.scrollWidth > el.clientWidth + 2) bad.push({ id, why: 'panel wider than itself', sw: el.scrollWidth, cw: el.clientWidth }); const r = el.getBoundingClientRect(); if (r.right > innerWidth + 1) bad.push({ id, why: 'panel off right edge' }); }
      for (const el of document.querySelectorAll('#marks text, #marks-back text, #marks .mk-chip, #marks-back .mk-chip, #glosses .gl')) { if (effOpacity(el) < 0.25) continue; const r = toStage(el.getBoundingClientRect()); if (r.w > 0 && (r.x < -1 || r.x + r.w > W + 1 || r.y < -1 || r.y + r.h > H + 1)) bad.push({ why: 'label/gloss outside stage', t: (el.textContent || '').slice(0, 30), r: [r.x, r.y, r.x + r.w, r.y + r.h].map(Math.round) }); }
      return { bad, lineW };
    },
    /** text floors in stage px: 56 focus, 44 upstage, 34 English. Margin words (x<200) and the home layout are exempt by name. */
    floors(mode) {
      const d = window.__deck, bad = []; const k = d.box().k; let minFocus = null, minUp = null;
      const homeLike = mode === 'home' || mode === 'full';
      for (const t of d.tokens()) {
        if (t.opacity < 0.9 || t.w < 1) continue; const up = t.y < 300; const margin = t.x < 200 && t.size < 44;
        if (margin || homeLike) continue;
        if (up) { minUp = minUp === null ? t.size : Math.min(minUp, t.size); if (t.size < 43.5) bad.push({ id: t.id, zone: 'upstage', size: +t.size.toFixed(1), floor: 44 }); }
        else { minFocus = minFocus === null ? t.size : Math.min(minFocus, t.size); if (t.size < 55.5) bad.push({ id: t.id, zone: 'focus', size: +t.size.toFixed(1), floor: 56 }); }
      }
      let minEn = null;
      for (const e of document.querySelectorAll('#en .slot')) { if (effHidden(e) || effOpacity(e) < 0.5 || !e.textContent.trim()) continue; const px = parseFloat(getComputedStyle(e).fontSize) / k; minEn = minEn === null ? px : Math.min(minEn, px); if (px < 33.5) bad.push({ zone: 'english', t: e.textContent.slice(0, 20), size: +px.toFixed(1), floor: 34 }); }
      return { bad, minFocus, minUp, minEn };
    },
    doneTokens() {
      const out = [];
      for (const tk of document.querySelectorAll('#tokens .tk[data-st="done"], #extras .tk[data-st="done"]')) {
        const o = effOpacity(tk); if (o < 0.5) continue; const w = tk.querySelector('.w'); const r = w.getBoundingClientRect(); if (r.width < 1) continue;
        out.push({ id: tk.dataset.id, x: r.x, y: r.y, w: r.width, h: r.height, color: getComputedStyle(w).color, o });
      }
      return out;
    },
    allText() {
      const out = [];
      for (const tk of document.querySelectorAll('#tokens .tk, #extras .tk')) {
        const o = effOpacity(tk); if (o < 0.9) continue; const w = tk.querySelector('.w'); const r = w.getBoundingClientRect(); if (r.width < 1) continue;
        out.push({ id: tk.dataset.id, x: r.x, y: r.y, w: r.width, h: r.height, color: getComputedStyle(w).color, o, c: tk.dataset.c || null, st: tk.dataset.st || null });
      }
      return out;
    },
    markStrokes() {
      const out = [];
      for (const g of document.querySelectorAll('.mk[data-k="arrow"], .mk[data-k="bracket"], .mk[data-k="gap"]')) {
        if (g.dataset.dormant === '1' || effOpacity(g) < 0.5) continue; const p = g.querySelector('.mk-line, .mk-bl, .mk-gap'); if (!p) continue;
        const cs = getComputedStyle(p); const r = p.getBoundingClientRect();
        out.push({ key: g.dataset.key, k: g.dataset.k, c: g.dataset.c, rel: g.dataset.rel, stroke: cs.stroke, dash: cs.strokeDasharray, w: cs.strokeWidth, x: r.x, y: r.y, wd: r.width, h: r.height });
      }
      return out;
    },
    /** the mark set as drawn: key, dormant, geometry */
    markSet() {
      return [...document.querySelectorAll('.mk[data-key]')].map(g => g.dataset.dormant === '1' ? g.dataset.key + '|1' : g.dataset.key + '|' + '' + '|' + Math.round(effOpacity(g) * 10) + '|' + [...g.querySelectorAll('path,circle,rect,text')].map(p => (p.getAttribute('d') || p.getAttribute('x') + ',' + p.getAttribute('y')) + (p.textContent || '')).join(';')).sort();
    },
    async animsDone() { await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))); await new Promise(r => setTimeout(r, 120)); },
    tokenStyles() { return Object.fromEntries([...document.querySelectorAll('[data-c]')].map(e => e.dataset.c).filter((v, i, a) => a.indexOf(v) === i).map(c => { const e = document.querySelector(`.tk[data-c="${c}"]`) || document.querySelector(`[data-c="${c}"]`); const cs = getComputedStyle(e); return [c, cs.getPropertyValue('--tl').trim() + '/' + cs.getPropertyValue('--tw').trim()]; })); },
  };
};

const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
const parseRGB = (s) => { const m = s.match(/[\d.]+/g).map(Number); return m.slice(0, 3); };
/** pixels of a PNG buffer, via the page canvas (no decoder dependency) */
async function pixelsOf(helper, buf, rects, k) {
  return helper.evaluate(async ({ b64, rects, k }) => {
    const img = new Image(); img.src = 'data:image/' + 'png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    return rects.map(r => {
      const X = Math.max(0, Math.floor(r.x)), Y = Math.max(0, Math.floor(r.y)), Wd = Math.max(1, Math.min(img.width - X, Math.ceil(r.w))), Hd = Math.max(1, Math.min(img.height - Y, Math.ceil(r.h)));
      const d = x.getImageData(X, Y, Wd, Hd).data; const px = [];
      for (let i = 0; i < d.length; i += 4 * 3) px.push([d[i], d[i + 1], d[i + 2]]);
      return px;
    });
  }, { b64: buf.toString('base64'), rects, k });
}

async function runProbe() {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const all = { file: FILE, vps: {} };
  const probeVps = arg('--vp', '1920x1080,1024x768').split(',').map(s => s.split('x').map(Number));
  for (const [W, H] of probeVps) {
    const tag = `${W}x${H}`; const dir = path.join(OUT, 'probe', tag); mkdirSync(dir, { recursive: true });
    let PH = 'boot'; const R = { vp: tag, errors: [], network: [], steps: [], checks: {} };
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && !GL_NOISE.test(m.text()))) R.errors.push(`[${PH}] ${m.type()}: ${m.text().slice(0, 240)}`); });
    page.on('pageerror', e => R.errors.push(`[${PH}] PAGEERROR: ${e.message.slice(0, 240)}`));
    page.on('request', rq => { const u = rq.url(); if (!/^(file:|data:|blob:|about:)/.test(u)) R.network.push(u.slice(0, 120)); });
    await page.goto(URL0 + '?i=0'); await page.waitForFunction(() => window.__deck && window.__deck.count, null, { timeout: 20000 }); await settle(page);
    await installFns(page); await page.evaluate(`(${GRAMMAR_FNS.toString()})()`);
    const meta = await page.evaluate(() => ({ n: window.__deck.count(), k: window.__deck.box().k, steps: window.__DATA__.steps.map(s => ({ i: s.i, id: s.id, head: s.head, mode: s.view.mode })), scope: window.__DATA__.meta?.scope ?? null }));
    R.n = meta.n; R.k = meta.k; R.scope = meta.scope;
    const hits = [], tagBad = [], wBad = [], floorBad = [], overlapBad = [], ovfBad = [], lineWs = {};
    const themes = [['dark', false], ['light', false], ['dark', true], ['light', true]];
    const contrast = {}; for (const [t, w] of themes) contrast[t + (w ? '+wash' : '')] = { worst: 99, step: null, id: null };
    const grey = { worst: 99, step: null };
    const fwdMarks = [];
    const png = [];
    const hide = `#tokens,#extras,#glosses,#marks,#marks-back,#ribbon,#en,#parse,#rail,#callout,#parents,#card,#more,#tokens *,#extras *,#glosses *{opacity:0 !important;visibility:hidden !important}`;
    for (let i = 0; i < meta.n; i++) {
      PH = 'step ' + i;
      if (i > 0) await next(page); const st = meta.steps[i];
      await page.evaluate(() => { window.__deck.theme('dark'); window.__deck.wash(false); }); await sleep(60);
      const ah = await page.evaluate(() => window.__gr.arrowHits()); if (ah.length) hits.push({ i, id: st.id, ah });
      const tr = await page.evaluate(() => window.__gr.tagRows()); if (tr.bad.length) tagBad.push({ i, id: st.id, bad: tr.bad.slice(0, 6), n: tr.bad.length });
      const wd = await page.evaluate(() => window.__gr.widths()); if (wd.bad.length) wBad.push({ i, id: st.id, bad: wd.bad.slice(0, 6), n: wd.bad.length }); lineWs[st.id] = wd.lineW;
      const fl = await page.evaluate((m) => window.__gr.floors(m), st.mode); if (fl.bad.length) floorBad.push({ i, id: st.id, bad: fl.bad.slice(0, 6), n: fl.bad.length });
      const ov = await page.evaluate(() => window.__qa.overlaps()); if (ov.length) overlapBad.push({ i, id: st.id, n: ov.length, ov: ov.slice(0, 5) });
      if (await page.evaluate(() => window.__deck.overflow())) ovfBad.push(i);
      await page.evaluate(() => window.__gr.animsDone()); fwdMarks[i] = await page.evaluate(() => window.__gr.markSet());
      const shot = path.join(dir, `${String(i + 1).padStart(2, '0')}-${st.id}.png`); png[i] = await page.screenshot({ path: shot });
      // --done contrast on the rendered worst frame, per theme
      for (const [t, w] of (process.argv.includes('--themes') ? themes : [])) {
        const key = t + (w ? '+wash' : '');
        await page.evaluate(([t, w]) => { window.__deck.theme(t); window.__deck.wash(w); }, [t, w]); await page.evaluate(() => window.__gr.animsDone()); await sleep(250);
        const done = await page.evaluate(() => window.__gr.doneTokens()); if (!done.length) continue;
        await page.addStyleTag({ content: hide }).then(async (h) => { await sleep(30); const bg = await page.screenshot(); await h.evaluate(e => e.remove()); const pix = await pixelsOf(page, bg, done.map(d => ({ x: d.x, y: d.y + d.h * 0.2, w: d.w, h: d.h * 0.6 })), 1);
          done.forEach((d, j) => { const fg = parseRGB(d.color); let worst = 99; for (const p of pix[j]) { const a = d.o; const f = fg.map((v, q) => v * a + p[q] * (1 - a)); worst = Math.min(worst, ratio(f, p)); } if (worst < contrast[key].worst) contrast[key] = { worst: +worst.toFixed(2), step: i, id: d.id, fg: d.color, rect: [d.x, d.y, d.w, d.h].map(Math.round), bg: pix[j][0] }; }); });
      }
      await page.evaluate(() => { window.__deck.theme('dark'); window.__deck.wash(false); });
      R.steps.push({ i, id: st.id, mode: st.mode, minFocus: fl.minFocus, minUp: fl.minUp, minEn: fl.minEn, minTagPx: tr.minTagPx, tags: tr.n });
    }
    R.checks.arrowHits = hits; R.checks.tagRows = tagBad; R.checks.widths = wBad; R.checks.floors = floorBad; R.checks.overlap = overlapBad; R.checks.overflow = ovfBad; R.checks.doneContrast = contrast; R.lineWidths = lineWs;
    // greyscale of the final view
    PH = 'grey';
    await goto(page, meta.n - 1);
    await page.addStyleTag({ content: 'html{filter:grayscale(1) !important}' });
    const gshot = await page.screenshot({ path: path.join(dir, 'zz-final-greyscale.png') });
    const txt = await page.evaluate(() => window.__gr.allText());
    const gp = await pixelsOf(page, gshot, txt.map(d => ({ x: d.x, y: d.y + d.h * 0.2, w: d.w, h: d.h * 0.6 })), 1);
    const gBad = [];
    txt.forEach((d, j) => { const L = gp[j].map(p => lum(p)); const hi = Math.max(...L), lo = Math.min(...L); const r = (hi + 0.05) / (lo + 0.05); if (r < 3) gBad.push({ id: d.id, ratio: +r.toFixed(2) }); grey.worst = Math.min(grey.worst, r); });
    const strokes = await page.evaluate(() => window.__gr.markStrokes());
    const styles = await page.evaluate(() => window.__gr.tokenStyles());
    const bgOnly = await (async () => { const h = await page.addStyleTag({ content: hide }); await sleep(30); const b = await page.screenshot(); await h.evaluate(e => e.remove()); return b; })();
    const sp = await pixelsOf(page, bgOnly, strokes.map(s => ({ x: s.x, y: s.y, w: Math.max(2, s.wd), h: Math.max(2, s.h) })), 1);
    const strokeBad = [];
    strokes.forEach((s, j) => { if (!s.stroke || !/rgb/.test(s.stroke)) return; const fg = parseRGB(s.stroke); const med = sp[j].map(lum).sort((a, b) => a - b)[Math.floor(sp[j].length / 2)] ?? 0; const g = lum(fg); const r = (Math.max(g, med) + 0.05) / (Math.min(g, med) + 0.05); if (r < 3) strokeBad.push({ key: s.key, ratio: +r.toFixed(2) }); });
    const sigs = {}; for (const [c, v] of Object.entries(styles)) (sigs[v] ||= []).push(c);
    const sameLook = Object.entries(sigs).filter(([, v]) => v.length > 1 && !(v.length === 2 && v.includes('neutral'))).map(([sig, cs]) => ({ sig, types: cs }));
    R.checks.greyscale = { textBad: gBad, strokeBad, worstText: +grey.worst.toFixed(2), types: styles, sameLook };
    await page.evaluate(() => { const s = [...document.querySelectorAll('style')].pop(); s.remove(); });
    await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (/grayscale/.test(s.textContent)) s.remove(); });

    if (process.argv.includes('--quick')) { all.vps[tag] = R; await ctx.close(); continue; }
    // mark sets: forward vs back vs ?i=N
    PH = 'marks-eq';
    const bkMarks = []; bkMarks[meta.n - 1] = fwdMarks[meta.n - 1];
    for (let i = meta.n - 2; i >= 0; i--) { await back(page); await page.evaluate(() => window.__gr.animsDone()); bkMarks[i] = await page.evaluate(() => window.__gr.markSet()); }
    const eq = { back: [], url: [] };
    const sameSet = (a, b) => { const A = new Set(a), B = new Set(b); return { only: [...A].filter(x => !B.has(x)).map(s => s.slice(0, 60)).slice(0, 3), other: [...B].filter(x => !A.has(x)).map(s => s.slice(0, 60)).slice(0, 3), ok: A.size === B.size && [...A].every(x => B.has(x)), keysOk: JSON.stringify(a.map(x => x.split('|')[0] + x.split('|')[1])) === JSON.stringify(b.map(x => x.split('|')[0] + x.split('|')[1])) }; };
    for (let i = 0; i < meta.n; i++) { const c = sameSet(fwdMarks[i], bkMarks[i]); if (!c.ok) eq.back.push({ i, id: meta.steps[i].id, keysOk: c.keysOk, only: c.only, other: c.other }); }
    for (let i = 0; i < meta.n; i++) {
      const up = await ctx.newPage(); up.on('pageerror', e => R.errors.push('[url] ' + e.message.slice(0, 200))); up.on('console', m => { if (m.type() === 'error') R.errors.push('[url] ' + m.text().slice(0, 200)); });
      await up.goto(URL0 + '?i=' + i); await up.waitForFunction(() => window.__deck && window.__deck.count, null, { timeout: 20000 }); await settle(up);
      await up.evaluate(`(${GRAMMAR_FNS.toString()})()`); await up.evaluate(() => window.__gr.animsDone()); const u = await up.evaluate(() => window.__gr.markSet()); const c = sameSet(fwdMarks[i], u);
      if (!c.ok) eq.url.push({ i, id: meta.steps[i].id, keysOk: c.keysOk, only: c.only, other: c.other }); await up.close();
    }
    R.checks.markEquality = eq;
    // one entry per token: not meaningful on a sample
    R.checks.oneRowPerToken = meta.scope === 'probe' ? { skipped: 'probe sample' } : await page.evaluate(() => {
      // one entry per token: a row that only restates ids already rowed is the same entry; a row that mixes new and old ids is a second entry
      const steps = window.__DATA__.steps, seen = new Set(), mixed = []; const ids = window.__DATA__.tokens.map(t => t.id);
      for (const s of steps) for (const r of (s.rows || [])) { const old = r.ids.filter(id => seen.has(id)), fresh = r.ids.filter(id => !seen.has(id)); if (old.length && fresh.length) mixed.push({ step: s.id, old, fresh }); r.ids.forEach(id => seen.add(id)); }
      return { missing: ids.filter(id => !seen.has(id)), mixed };
    });
    // contact sheets
    PH = 'sheets';
    if (process.argv.includes('--nosheets')) { await ctx.close(); all.vps[tag] = R; console.error('probe done', tag); continue; }
    mkdirSync(path.join(OUT, 'sheets'), { recursive: true });
    const sheetPage = await ctx.newPage(); const per = 6;
    for (let s0 = 0, n = 1; s0 < meta.n; s0 += per, n++) {
      const items = png.slice(s0, s0 + per).map((b, j) => ({ b: b.toString('base64'), label: meta.steps[s0 + j].id + '  ' + meta.steps[s0 + j].head }));
      await sheetPage.setViewportSize({ width: 1920, height: 1500 });
      await sheetPage.setContent('<body style="margin:0;background:#222"></body>');
      await sheetPage.evaluate(async (items) => { const c = document.createElement('canvas'); const cw = 960, ch = Math.round(960 * (innerHeight > 0 ? 1 : 1)); c.width = 1920; c.height = 1500; document.body.append(c); const x = c.getContext('2d'); x.fillStyle = '#222'; x.fillRect(0, 0, c.width, c.height); x.font = '22px sans-serif'; for (let j = 0; j < items.length; j++) { const im = new Image(); im.src = 'data:image/' + 'png;base64,' + items[j].b; await im.decode(); const sc = 960 / im.width; const h = im.height * sc; const X = (j % 2) * 960, Y = Math.floor(j / 2) * 500; x.drawImage(im, X, Y + 26, 960, Math.min(h, 470)); x.fillStyle = '#fff'; x.fillText(items[j].label, X + 8, Y + 20); } }, items);
      await sheetPage.locator('canvas').screenshot({ path: path.join(OUT, 'sheets', `probe-${tag}-${n}.png`) });
    }
    await sheetPage.close();
    await ctx.close();
    all.vps[tag] = R; console.error('probe done', tag);
  }
  await browser.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, arg('--raw', 'probe-raw.json')), JSON.stringify(all, null, 1));
  const n = (a) => (a && a.length) || 0; let failed = 0;
  const line = (vp, name, bad) => { if (bad) failed++; console.log(`${bad ? 'FAIL' : 'pass'}  ${vp}  ${name}${bad ? '  (' + bad + ')' : ''}`); };
  for (const [vp, R] of Object.entries(all.vps)) {
    const c = R.checks;
    line(vp, 'console errors', n(R.errors)); line(vp, 'network requests', n(R.network));
    line(vp, 'no arrow crosses a token rect', n(c.arrowHits)); line(vp, 'tag rows within their line', n(c.tagRows)); line(vp, 'nothing wider than its zone', n(c.widths));
    line(vp, 'text floors 56/44/34', n(c.floors)); line(vp, 'zone overlaps', n(c.overlap)); line(vp, 'no view overflows', n(c.overflow));
    for (const [k, v] of Object.entries(c.doneContrast)) line(vp, `--done contrast ${k}`, v.worst < 4.5 ? `${v.worst}:1 at ${R.steps[v.step]?.id}` : 0);
    if (c.markEquality) { line(vp, 'mark sets forward = back', n(c.markEquality.back)); line(vp, 'mark sets forward = ?i=N', n(c.markEquality.url)); }
    if (c.oneRowPerToken && !c.oneRowPerToken.skipped) line(vp, 'one rows entry per token', n(c.oneRowPerToken.missing) + n(c.oneRowPerToken.mixed)); else if (c.oneRowPerToken) console.log(`skip  ${vp}  one rows entry per token (${c.oneRowPerToken.skipped})`);
    line(vp, 'greyscale final view', n(c.greyscale.textBad) + n(c.greyscale.strokeBad) + n(c.greyscale.sameLook));
  }
  process.exit(failed ? 1 : 0);
}

// =====================================================================================================
// Full-deck extras: gloss and part of speech above the Greek, the "is" slot,
// themes and washout, reduced motion, no WebGL, copy from the stage, headings, one rows entry per token.
// Run: node tools/qa.mjs --extra --file build/qa/full.html --vp 1920x1080 [--themes-shots] [--modes] --out build/qa/run --raw extra-1920x1080.json
// =====================================================================================================
if (process.argv.includes('--extra')) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const all = { file: FILE, vps: {} };
  const EX = () => {
    const effOpacity = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
    window.__ex = {
      glossCheck(st) {
        const view = st.view || {}; const k = window.__deck.box().k; const out = { expected: 0, ok: 0, miss: [], badGeom: [], extra: [] };
        const exp = new Set();
        const modeOK = ['scene', 'line', 'lift'].includes(view.mode);
        if (modeOK && view.gloss !== false) {
          if (view.mode === 'scene') { for (const g of view.groups || []) if (g.plane === 0 && g.gloss !== false) for (const id of g.tokens) exp.add(id); }
          else { for (const t of window.__deck.tokens()) if (t.opacity > 0.9 && t.id.startsWith('s')) exp.add(t.id); }
        }
        const tk = new Map(window.__deck.tokens().map(t => [t.id, t]));
        for (const id of [...exp]) { const t = tk.get(id); if (!t || t.opacity < 0.9) exp.delete(id); }
        out.expected = exp.size;
        const gls = new Map([...document.querySelectorAll('#glosses .gl')].map(e => [e.dataset.id, e]));
        for (const id of exp) {
          const gl = gls.get(id); const el = document.querySelector(`.tk[data-id="${id}"] .w`); const w = el.getBoundingClientRect();
          if (!gl || effOpacity(gl) < 0.9) { out.miss.push(id); continue; }
          const g = gl.querySelector('.gl-g'), p = gl.querySelector('.gl-p');
          if (!g || !p || !g.textContent.trim() || !p.textContent.trim()) { out.miss.push(id + ' (gloss or pos empty)'); continue; }
          const gr = g.getBoundingClientRect(), pr = p.getBoundingClientRect(), glr = gl.getBoundingClientRect();
          const cx = w.left + w.width / 2;
          const above = glr.bottom <= w.top + w.height * 0.25 + 1;
          const order = gr.bottom <= pr.top + 2;
          const near = cx >= glr.left - 40 * k && cx <= glr.right + 40 * k;
          if (!above || !order || !near) out.badGeom.push({ id, above, order, near, gl: [glr.left, glr.top, glr.right, glr.bottom].map(Math.round), w: [w.left, w.top, w.right, w.bottom].map(Math.round) }); else out.ok++;
        }
        for (const [id, gl] of gls) if (!exp.has(id) && effOpacity(gl) > 0.9) out.extra.push(id + ' ' + gl.textContent.slice(0, 24));
        return out;
      },
      isSlot() { const e = document.querySelector('#en [data-slot="S1.is"]'); return e ? { state: e.dataset.state, glyph: e.dataset.glyph ?? null, text: e.textContent, vis: effOpacity(e) } : null; },
      enText() { return document.getElementById('en') ? document.getElementById('en').innerText.replace(/\s+/g, ' ').trim() : ''; },
      dormantBrackets() { return /\[is\]/.test(document.body.innerText); },
    };
  };
  const vps = VPS;
  const doShots = process.argv.includes('--themes-shots');
  for (const [W, H] of vps) {
    const tag = `${W}x${H}`; let PH = 'boot'; const R = { vp: tag, errors: [], network: [], checks: {}, is: [], heads: [] };
    const dir = path.join(OUT, 'themes', tag); if (doShots) mkdirSync(dir, { recursive: true });
    const mk = async (opts, url, extraInit) => {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, ...opts });
      if (extraInit) await ctx.addInitScript(extraInit);
      const page = await ctx.newPage();
      page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && !GL_NOISE.test(m.text()))) R.errors.push(`[${PH}] ${m.type()}: ${m.text().slice(0, 200)}`); });
      page.on('pageerror', e => R.errors.push(`[${PH}] PAGEERROR: ${e.message.slice(0, 200)}`));
      page.on('request', rq => { const u = rq.url(); if (!/^(file:|data:|blob:|about:)/.test(u)) R.network.push(u.slice(0, 120)); });
      await page.goto(url); await page.waitForFunction(() => window.__deck && window.__deck.count, null, { timeout: 30000 }); await settle(page);
      return { ctx, page };
    };
    // ---- main extra walk, dark, WebGL on
    PH = 'extra-walk';
    let { ctx, page } = await mk({}, URL0 + '?i=0');
    await page.evaluate(`(${EX.toString()})()`);
    const data = await page.evaluate(() => ({ n: window.__deck.count(), steps: window.__DATA__.steps.map(s => ({ i: s.i, id: s.id, head: s.head, sub: s.sub, view: s.view, rows: (s.rows || []).map(r => r.ids), cue: !!s.cue, notes: (s.notes || []).length })), tokens: window.__DATA__.tokens.map(t => [t.id, t.text, t.post]) }));
    R.n = data.n;
    const glossBad = [], geomBad = [], extraGl = [], isTrace = [], metaBad = [], bracketIs = [];
    const metaRx = /\b(next step|next|now we|let.?s|step \d|slide|press|recap|summary|overview|in this|moving on|we will|we now|section)\b/i;
    const fwdT = [];
    const copyAt = new Set([0, 1, 2, 30, 80, 130, data.n - 2, data.n - 1]); R.checks.copy = [];
    for (let i = 0; i < data.n; i++) {
      PH = 'step ' + i; if (i > 0) await next(page);
      const st = data.steps[i];
      fwdT[i] = await table(page);
      const gc = await page.evaluate((st) => window.__ex.glossCheck(st), st);
      if (gc.miss.length) glossBad.push({ i, id: st.id, mode: st.view.mode, expected: gc.expected, miss: gc.miss.slice(0, 8), n: gc.miss.length });
      if (gc.badGeom.length) geomBad.push({ i, id: st.id, bad: gc.badGeom.slice(0, 3), n: gc.badGeom.length });
      if (gc.extra.length) extraGl.push({ i, id: st.id, mode: st.view.mode, extra: gc.extra.slice(0, 6), n: gc.extra.length });
      R.is.push({ i, id: st.id, is: await page.evaluate(() => window.__ex.isSlot()) });
      if (await page.evaluate(() => window.__ex.dormantBrackets())) bracketIs.push({ i, id: st.id });
      R.heads.push({ i, id: st.id, head: st.head, sub: st.sub, words: st.head.trim().split(/\s+/).length });
      if (st.head.trim().split(/\s+/).length > 6 || metaRx.test(st.head)) metaBad.push({ i, id: st.id, head: st.head });
      if (copyAt.has(i)) R.checks.copy.push({ i, id: st.id, ...(await page.evaluate((tokens) => {
        const t = document.getElementById('tokens'); const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        const got = s.toString().replace(/\s+/g, ' ').trim(); const want = tokens.map(([, a, b]) => a + b).join(' '); s.removeAllRanges();
        // also select-all on the whole document and require the Greek to arrive in order
        document.execCommand('selectAll'); const all = getSelection().toString().replace(/\s+/g, ' '); getSelection().removeAllRanges();
        const wantWords = tokens.map(([, a, b]) => a + b); let pos = 0, order = true; for (const w of wantWords) { const j = all.indexOf(w, pos); if (j < 0) { order = false; break; } pos = j + w.length; }
        return { ok: got === want, docOrder: order, len: [got.length, want.length] };
      }, data.tokens)) });
    }
    R.checks.gloss = { missing: glossBad, geometry: geomBad, unexpected: extraGl };
    R.checks.metaHeadings = metaBad; R.checks.bracketIs = bracketIs;
    // one rows entry per token
    const seen = new Set(), mixed = [], dup = {};
    for (const s of data.steps) for (const r of s.rows) { const old = r.filter(id => seen.has(id)), fresh = r.filter(id => !seen.has(id)); if (old.length && fresh.length) mixed.push({ step: s.id, old, fresh }); r.forEach(id => { seen.add(id); dup[id] = (dup[id] || 0) + 1; }); }
    R.checks.rows = { covered: seen.size, of: data.tokens.length, missing: data.tokens.map(t => t[0]).filter(id => !seen.has(id)), mixed, multi: Object.entries(dup).filter(([, n]) => n > 1).map(([id, n]) => id + 'x' + n).slice(0, 12) };
    // notes/cue present on every step
    R.checks.cueNotes = data.steps.filter(s => !s.cue || !s.notes).map(s => s.id);
    await ctx.close();

    // ---- themes and washout screenshots
    if (doShots) {
      PH = 'themes';
      ({ ctx, page } = await mk({}, URL0 + '?i=0'));
      await page.evaluate(`(${EX.toString()})()`); await page.evaluate(`(${GRAMMAR_FNS.toString()})()`);
      const combos = [['light', false, 'light'], ['dark', true, 'dark-wash'], ['light', true, 'light-wash']];
      const ovf = [];
      for (let i = 0; i < data.n; i++) {
        if (i > 0) await next(page);
        await page.evaluate(() => window.__gr.animsDone()); await sleep(400);
        for (const [t, w, nm] of combos) {
          await page.evaluate(([t, w]) => { window.__deck.theme(t); window.__deck.wash(w); }, [t, w]); await sleep(120);
          await page.screenshot({ path: path.join(dir, `${String(i + 1).padStart(3, '0')}-${data.steps[i].id}-${nm}.png`) });
          if (await page.evaluate(() => window.__deck.overflow())) ovf.push({ i, nm });
        }
        await page.evaluate(() => { window.__deck.theme('dark'); window.__deck.wash(false); });
      }
      R.checks.themeOverflow = ovf;
      await ctx.close();
    }

    if (process.argv.includes('--themes-only')) { all.vps[tag] = R; continue; }
    // ---- reduced motion, walk; stage equals the default walk
    PH = 'reduced-motion';
    ({ ctx, page } = await mk({ reducedMotion: 'reduce' }, URL0 + '?i=0'));
    { const rm = { diffs: [], same: 0, motionClass: await page.evaluate(() => document.documentElement.className) }; let prev = null;
      for (let i = 0; i < data.n; i++) { if (i > 0) await next(page); const T = await table(page); const c = cmpTables(fwdT[i], T); if (c.nbad) rm.diffs.push({ i, ...c }); if (prev && JSON.stringify(prev) === JSON.stringify(T) && !['home','final'].includes(data.steps[i].view.mode)) rm.same++; prev = T; }
      R.checks.reducedMotion = rm; }
    await ctx.close();

    // ---- no WebGL: ?nowebgl=1
    PH = 'nowebgl';
    ({ ctx, page } = await mk({}, URL0 + '?i=0&nowebgl=1'));
    { const nw = { diffs: [], world: null, bg: null };
      nw.world = await page.evaluate(() => window.__deck.world());
      for (let i = 0; i < data.n; i++) { if (i > 0) await next(page); const T = await table(page); const c = cmpTables(fwdT[i], T); if (c.nbad) nw.diffs.push({ i, ...c }); }
      nw.bg = await page.evaluate(() => ({ canvas: document.querySelectorAll('canvas').length, cls: document.documentElement.className }));
      await page.screenshot({ path: path.join(OUT, `nowebgl-${tag}.png`) });
      R.checks.noWebgl = nw; }
    await ctx.close();
    // null getContext
    PH = 'null-getContext';
    ({ ctx, page } = await mk({}, URL0 + '?i=0', `const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (/webgl/i.test(t)) return null; return g.call(this, t, ...a); };`));
    { const nc = { diffs: [], world: await page.evaluate(() => window.__deck.world()) };
      for (let i = 0; i < data.n; i += 1) { if (i > 0) await next(page); if (i % 7 === 0 || i === data.n - 1) { const T = await table(page); const c = cmpTables(fwdT[i], T); if (c.nbad) nc.diffs.push({ i, ...c }); } }
      R.checks.nullContext = nc; }
    await ctx.close();
    // forced context loss mid-run
    PH = 'context-loss';
    ({ ctx, page } = await mk({}, URL0 + '?i=0'));
    { const cl = { lost: null, diffs: [] };
      for (let i = 1; i <= 30; i++) await next(page);
      cl.lost = await page.evaluate(() => { const c = document.querySelector('canvas'); if (!c) return 'no canvas'; const gl = c.getContext('webgl2') || c.getContext('webgl'); const e = gl && gl.getExtension('WEBGL_lose_context'); if (!e) return 'no extension'; e.loseContext(); return 'lost'; });
      await sleep(400);
      { const T0 = await table(page); const c0 = cmpTables(fwdT[30], T0); if (c0.nbad) cl.diffs.push({ i: 30, ...c0 }); }
      for (let i = 31; i < 60; i++) { await next(page); const T = await table(page); const c = cmpTables(fwdT[i], T); if (c.nbad) cl.diffs.push({ i, ...c }); }
      cl.world = await page.evaluate(() => window.__deck.world());
      R.checks.contextLoss = cl; }
    await ctx.close();
    all.vps[tag] = R; console.error('extra done', tag);
  }
  await browser.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, arg('--raw', 'extra-raw.json')), JSON.stringify(all, null, 1));
  console.log('wrote extra raw');
  process.exit(0);
}


// =====================================================================================================
// Contact sheets: node tools/qa.mjs --sheets --src build/qa/run/1920x1080 --prefix 1920x1080 [--per 4] [--cols 2] [--cell 960] [--out build/qa] [--file build/qa/full.html]
// Reads NN-id.png from --src, labels each with the step head, writes <out>/sheets/<prefix>-NN.png.
// =====================================================================================================
if (process.argv.includes('--sheets')) {
  const { readdirSync, readFileSync } = await import('node:fs');
  const src = path.resolve(arg('--src', 'build/qa/run/1920x1080')); const prefix = arg('--prefix', 'sheet'); const per = +arg('--per', 4), cols = +arg('--cols', 2), cell = +arg('--cell', 960);
  const only = arg('--only', null); // optional regexp on file name
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const dp = await browser.newPage(); await dp.goto(URL0 + '?i=0'); await dp.waitForFunction(() => window.__DATA__ && window.__DATA__.steps);
  const heads = await dp.evaluate(() => Object.fromEntries(window.__DATA__.steps.map(s => [s.id, s.head]))); await dp.close();
  const files = readdirSync(src).filter(f => /^\d+-.*\.png$/.test(f) && (!only || new RegExp(only).test(f))).sort((a, b) => parseInt(a) - parseInt(b));
  mkdirSync(path.join(OUT, 'sheets'), { recursive: true });
  const pg = await browser.newPage();
  for (let a = 0, n = 1 + +arg('--n0', 0); a < files.length; a += per, n++) {
    const items = files.slice(a, a + per).map(f => { const m = f.match(/^(\d+)-(.*?)(?:-(light|dark-wash|light-wash))?\.png$/); const id = m[2]; return { b: readFileSync(path.join(src, f)).toString('base64'), label: `${+m[1]}  ${id}  ${heads[id] ?? ''}${m[3] ? '  [' + m[3] + ']' : ''}` }; });
    const rows = Math.ceil(items.length / cols); const ch = Math.round(cell / eval(arg('--aspect', '16/9'))) + 26;
    await pg.setViewportSize({ width: cols * cell, height: rows * ch });
    await pg.setContent(`<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${cell}px);font:600 18px sans-serif;color:#fc6">${items.map(i => `<div style="height:${ch}px"><div style="height:26px;line-height:26px;padding-left:6px">${i.label.replace(/</g, '&lt;')}</div><img style="width:${cell}px;display:block" src="data:image/${'png'};base64,${i.b}"></div>`).join('')}</body>`);
    await pg.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth));
    await pg.screenshot({ path: path.join(OUT, 'sheets', `${prefix}-${String(n).padStart(2, '0')}.png`) });
  }
  await browser.close(); console.log('sheets', Math.ceil(files.length / per)); process.exit(0);
}

if (PROBE) await runProbe();

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [W, H] of VPS) {
  const t0 = Date.now();
  try { result.vps[`${W}x${H}`] = await runViewport(browser, W, H); } catch (e) { result.vps[`${W}x${H}`] = { error: String(e.stack || e) }; }
  console.error(`done ${W}x${H} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, arg('--raw', 's1-raw.json')), JSON.stringify(result, null, 1));
console.log('wrote', path.join(OUT, arg('--raw', 's1-raw.json')));
// ---------- summary ----------
let failed = 0;
const line = (vp, name, bad) => { if (bad) failed++; console.log(`${bad ? 'FAIL' : 'pass'}  ${vp}  ${name}${bad ? '  (' + bad + ')' : ''}`); };
for (const [vp, R] of Object.entries(result.vps)) {
  if (R.error) { line(vp, 'run', R.error.split('\n')[0]); continue; }
  const c = R.checks, n = (a) => (a && a.length) || 0;
  line(vp, 'console errors', n(R.errors));
  line(vp, 'network requests', n(R.network));
  line(vp, 'forward=back=?i=N stage states', n(c.equality.back) + n(c.equality.jump) + n(c.equality.url));
  line(vp, 'check-text at every view', n(c.text));
  line(vp, 'no view overflows', n(c.overflow) + n(c.pageOverflow) + n(c.clipped));
  line(vp, 'name scan, every window', n(c.nameScan) + n((c.source?.fail || []).filter(f => /banned name/.test(f))));
}
console.log('NOT YET IMPLEMENTED: no arrow crosses a token rect; --done contrast; every token id in exactly one cards/rows entry');
if (failed) process.exit(1);
