// Source view. Read-only companion window: lists the citations of the step on screen,
// with exact reference, evidence grade, the path of any saved image, Copy path and a file:// link.
// No timer, no notes, no skip route; the view never moves the deck.
import { hooks } from '../engine/hooks.mjs';

const TITLE = 'Sources';
const CHANNEL = 'pl-sources';

/* ---------------- pure helpers ---------------- */
export function sourceKeys(state, data, cardId = null) {
  const row = id => Object.values(data.parses).map(p => p[id]).find(Boolean);
  const v = state.view ?? {};
  const keys = [...(state.cite ?? []), state.callout?.cite, v.cite, v.left?.cite, v.right?.cite,
    ...[...(state.list ?? []), state.card?.token, cardId].filter(Boolean).flatMap(id => row(id)?.sources ?? [])];
  return [...new Set(keys)].filter(k => k && data.cites[k]);
}
export function sourceRow(key, data, root) {
  const c = data.cites[key], path = c.shot ? `${root}/${c.shot}` : null;
  return { key, grade: c.grade, display: c.ref?.display || c.label, shot: c.shot ?? null, path, withheld: c.evidence?.image === 'withheld', refOnly: c.evidence?.reference_only === true,
           href: path ? 'file://' + path.split('/').map(encodeURIComponent).join('/') : null };
}


/* ---------------- the six blocks' data, computed on the deck side ----------------
   Every step field read here may be missing: a missing field hides its block and throws nothing. */
const TYPE_NAME = { finite: 'finite verb', ptc: 'participle', conj: 'conjunction', gabs: 'genitive absolute',
  indst: 'indirect statement', analogy: 'analogy', neutral: 'neutral' };
const str = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strs = v => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
const toks = new WeakMap();
function tokIndex(data) {
  let m = toks.get(data);
  if (!m) { m = new Map(); for (const t of data.tokens ?? []) m.set(t.id, t); toks.set(data, m); }
  return m;
}
function treeNode(data, id) {
  for (const t of Object.values(data.tree ?? {})) { const n = (t.nodes ?? []).find(n => n.id === id); if (n) return { n, nodes: t.nodes }; }
  return null;
}
function span(data, id) {
  const hit = treeNode(data, id); if (!hit) return [];
  const idx = tokIndex(data), out = [], walk = nid => {
    const n = hit.nodes.find(x => x.id === nid); if (!n) return;
    out.push(...(n.tokens ?? [])); hit.nodes.filter(c => c.parent === nid).forEach(c => walk(c.id));
  };
  walk(id);
  return [...new Set(out)].sort((a, b) => (idx.get(a)?.g ?? 0) - (idx.get(b)?.g ?? 0));
}
function range(ids) { return ids.length < 2 ? (ids[0] ?? '') : ids[0] + '-' + ids[ids.length - 1]; }
/** An endpoint of a mark: a token id, a tree node id or en:<slot>. -> { id, greek } */
function endpoint(e, data) {
  const idx = tokIndex(data);
  if (typeof e !== 'string') return { id: '', greek: '' };
  if (e.startsWith('en:')) {
    const q = e.slice(3), [s, slot] = q.includes('.') ? q.split('.') : [null, q];
    const sets = s ? [data.en?.[s]] : Object.values(data.en ?? {});
    const hit = sets.flatMap(x => x?.slots ?? []).find(x => x.id === slot);
    return { id: e, greek: hit ? 'English: ' + (hit.text ?? '') : '' };
  }
  if (idx.has(e)) return { id: e, greek: idx.get(e).text };
  const ids = span(data, e);
  if (ids.length) return { id: range(ids), greek: ids.map(i => idx.get(i)?.text ?? '').join(' ') };
  return { id: e, greek: '' };
}
function marksOf(m) {
  if (Array.isArray(m)) return m;
  if (m && typeof m === 'object') return [].concat(Array.isArray(m.keep) ? m.keep : [], Array.isArray(m.add) ? m.add : []);
  return [];
}
function aloudLine(m, data) {
  if (typeof m === 'string') return { text: m, greek: '' };
  if (!m || typeof m !== 'object') return null;
  const tn = TYPE_NAME[m.type] ?? m.type ?? null;
  const rel = [str(m.rel), str(m.text), str(m.gloss)].filter(Boolean);
  const tag = str(m.tag) ? '(' + str(m.tag) + ')' : null;
  if (m.k === 'arrow') {
    const f = endpoint(m.from, data), t = endpoint(m.to, data);
    const what = [rel.join(', ') || 'relates to', tn, str(m.label) ? 'labelled ' + str(m.label) : null].filter(Boolean).join(', ') + (tag ? ' ' + tag : '');
    return { text: f.id + ' → ' + t.id + ': ' + what, greek: [f.greek, t.greek].filter(Boolean).join(' → ') };
  }
  if (m.k === 'tag') {
    const a = endpoint(m.at, data);
    return { text: a.id + ': ' + [rel.join(', '), tn].filter(Boolean).join(', ') + (tag ? ' ' + tag : ''), greek: a.greek };
  }
  if (m.k === 'bracket') {
    const a = endpoint(m.node ?? (m.en ? 'en:' + m.en : ''), data), n = m.node ? treeNode(data, m.node)?.n : null;
    return { text: 'bracket ' + a.id + (n?.label ? ' (' + n.label + ')' : '') + ': ' + [tn].filter(Boolean).join(', ') + (tag ? ' ' + tag : ''), greek: a.greek };
  }
  if (m.k === 'link') {
    const a = endpoint(m.a, data), b = endpoint(m.b, data);
    return { text: a.id + ' ~ ' + b.id + ': agree' + (Array.isArray(m.on) && m.on.length ? ' in ' + m.on.join(', ') : ''), greek: [a.greek, b.greek].filter(Boolean).join(' ~ ') };
  }
  return null;
}
function parseRow(data, id) { return Object.values(data.parses ?? {}).map(p => p?.[id]).find(Boolean); }
function heldBack(state, data, cardId) {
  const idx = tokIndex(data), seen = new Set(), out = [];
  for (const id of [state.card?.token, cardId, ...(state.list ?? []), ...(state.focus ?? [])]) {
    if (!id || seen.has(id)) continue; seen.add(id);
    const r = parseRow(data, id); if (!r) continue;
    const alts = (Array.isArray(r.alternatives) ? r.alternatives : []).map(a => ({
      reading: str(a?.reading), rejected: str(a?.rejected) })).filter(a => a.reading || a.rejected);
    const item = { id, word: idx.get(id)?.text ?? id, gloss: str(r.gloss), why: str(r.why), syntax: str(r.syntax), alts, more: strs(r.more) };
    if (item.why || item.syntax || alts.length || item.more.length) out.push(item);
  }
  return out;
}

/* ---------------- On screen block and the sidebar (data side) ---------------- */
const SENTS = ['S1', 'S2', 'S3', 'S4'];
function tokenPos(data) {
  let m = tokPos.get(data);
  if (!m) { m = new Map(); (data.tokens ?? []).forEach((t, i) => m.set(t.id, i)); tokPos.set(data, m); }
  return m;
}
const tokPos = new WeakMap();
/** A sentence's lines, validated: [{ a, b, en }] with a <= b as positions in data.tokens. Missing or bad data gives []. */
function linesOf(data, S) {
  const pos = tokenPos(data), raw = data.en?.[S]?.lines;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const l of raw) {
    const t = l?.tokens, en = str(l?.en);
    if (!Array.isArray(t) || t.length < 2 || !en || !pos.has(t[0]) || !pos.has(t[1])) continue;
    const a = pos.get(t[0]), b = pos.get(t[1]);
    if (a <= b) out.push({ a, b, en });
  }
  return out.sort((x, y) => x.a - y.a);
}
const sentOf = t => 'S' + t.s;
/** The Greek ids on this press: state.st (not hidden) and the view's groups (not hidden), else what the view names. */
function visibleSet(state, data) {
  const idx = tokIndex(data), v = state.view ?? {}, out = new Set();
  const add = id => { if (idx.has(id)) out.add(id); };
  if (v.mode === 'home' || v.mode === 'final') {
    const ss = v.mode === 'final' ? SENTS : (Array.isArray(v.sentences) ? v.sentences : []);
    for (const t of data.tokens ?? []) if (ss.includes(sentOf(t))) out.add(t.id);
    return out;
  }
  for (const [id, s] of Object.entries(state.st ?? {})) if (s !== 'hidden') add(id);
  for (const g of Array.isArray(v.groups) ? v.groups : [])
    if (g && g.st !== 'hidden' && g.plane !== 'wings' && g.plane !== 'home') (g.tokens ?? []).forEach(add);
  if (!out.size) {
    if (/^S[1-4]$/.test(v.scope ?? '')) for (const t of data.tokens ?? []) { if (sentOf(t) === v.scope) out.add(t.id); }
    [...(v.left?.tokens ?? []), ...(v.right?.tokens ?? []), ...(v.tokens ?? [])].forEach(add);
    if (v.node) span(data, v.node).forEach(add);
  }
  return out;
}
/** The English of whatever Greek is on screen. Whole lines get their line English; partial lines get word glosses. */
function screenModel(state, data) {
  const v = state.view ?? {}, items = [];
  if (v.mode === 'skipped') {
    for (const t of Array.isArray(v.turns) ? v.turns : []) if (str(t?.text)) items.push({ t: 'en', text: str(t.text), who: str(t.speaker) });
    return { label: 'Full translation', items };
  }
  const vis = visibleSet(state, data), idx = tokIndex(data), pos = tokenPos(data), all = data.tokens ?? [];
  const sents = [...new Set(all.filter(t => vis.has(t.id)).map(sentOf))];
  const grouped = v.mode === 'home' || v.mode === 'final';
  let partial = false;
  for (const S of sents) {
    const lines = linesOf(data, S), done = new Set();
    let run = null;
    const flush = () => { if (run && run.words.length) items.push(run); run = null; };
    for (const t of all) {
      if (sentOf(t) !== S || !vis.has(t.id)) continue;
      const p = pos.get(t.id), ln = lines.findIndex(l => p >= l.a && p <= l.b);
      let whole = false;
      if (ln >= 0) { whole = true; for (let q = lines[ln].a; q <= lines[ln].b; q++) if (!vis.has(all[q].id)) { whole = false; break; } }
      if (whole) {
        if (!done.has(ln)) { flush(); done.add(ln); items.push({ t: 'en', text: lines[ln].en }); }
      } else {
        if (!run || run.line !== ln) { flush(); run = { t: 'wbw', line: ln, words: [] }; }
        run.words.push({ g: t.text, gl: str(parseRow(data, t.id)?.gloss) });
        partial = true;
      }
    }
    flush();
  }
  if (str(data.gap?.en) && [...vis].some(id => !idx.has(id))) items.push({ t: 'en', text: str(data.gap.en) });
  const kinds = new Set(items.map(i => i.t));
  const label = grouped ? 'Whole translation so far' : kinds.has('wbw') ? (kinds.has('en') ? 'Whole lines, then single words' : 'Part of a line only') : 'Full translation';
  return { label, items: items.map(({ line, ...i }) => i), partial };
}
const joinGreek = ts => ts.map(t => t.text + (t.post ?? '')).join(' ');
/** The sidebar: every sentence with its lines, the skipped words between S3 and S4. Static, cached per data. */
const sideCache = new WeakMap();
function sideModel(data) {
  let m = sideCache.get(data); if (m) return m;
  const all = data.tokens ?? [], blocks = [];
  for (const S of SENTS) {
    const ts = all.filter(t => sentOf(t) === S);
    if (!ts.length) continue;
    if (S === 'S4' && Array.isArray(data.skipped?.slides)) {
      const sk = data.skipped.tokens ?? [], at = new Map(sk.map((t, i) => [t.id, i])), rows = [];
      data.skipped.slides.forEach((sl, si) => (sl?.en ?? []).forEach((tu, ti) => {
        const a = at.get(tu?.tokens?.[0]), b = at.get(tu?.tokens?.[1]);
        if (a == null || b == null || !str(tu.text)) return;
        rows.push({ key: 'x:' + si + ':' + ti, who: str(tu.speaker), greek: joinGreek(sk.slice(a, b + 1)), en: str(tu.text) });
      }));
      if (rows.length) blocks.push({ key: 'x', name: 'Skipped words', note: 'Not parsed', skipped: true, rows });
    }
    const lines = linesOf(data, S), rows = [];
    if (lines.length) lines.forEach((l, i) => rows.push({ key: S + ':' + i, greek: joinGreek(all.slice(l.a, l.b + 1)), en: l.en }));
    else rows.push({ key: S + ':0', greek: joinGreek(ts), en: null });
    blocks.push({ key: S, name: 'Sentence ' + S.slice(1), rows });
  }
  m = { blocks }; sideCache.set(data, m); return m;
}
/** Which sidebar rows are on screen now, and the sentence to keep in view. */
function curModel(state, data, screen) {
  const v = state.view ?? {}, keys = [];
  let sentence = state.sentence ? String(state.sentence).toUpperCase() : null;
  if (v.mode === 'skipped') {
    (Array.isArray(v.turns) ? v.turns : []).forEach((t, ti) => keys.push('x:' + v.slide + ':' + ti));
    return { keys, sentence: 'x' };
  }
  const vis = visibleSet(state, data), all = data.tokens ?? [], pos = tokenPos(data);
  if (v.mode === 'home' || v.mode === 'final') {
    const last = [...vis].map(id => tokIndex(data).get(id)).filter(Boolean).map(sentOf).sort().pop();
    return { keys, sentence: last ?? null };
  }
  for (const S of SENTS) {
    const lines = linesOf(data, S);
    const here = all.filter(t => sentOf(t) === S && vis.has(t.id));
    if (!here.length) continue;
    if (!lines.length) keys.push(S + ':0');
    else lines.forEach((l, i) => { if (here.some(t => pos.get(t.id) >= l.a && pos.get(t.id) <= l.b)) keys.push(S + ':' + i); });
    if (!sentence || !SENTS.includes(sentence)) sentence = S;
  }
  return { keys, sentence: SENTS.includes(sentence) ? sentence : null };
}
const SENT_CODE = { overture: 'o', close: 'c', s1: '1', s2: '2', s3: '3', s4: '4' };
function sentenceName(step) {
  if (step.sentence) return 'Sentence ' + String(step.sentence).replace(/^S/i, '');
  return step.file === 'overture' ? 'Overture' : step.file === 'close' ? 'Close' : null;
}
/** Everything the view shows except the citation rows. Pure. */
export function stepModel(state, data, cardId = null) {
  const idx = tokIndex(data), steps = data.steps ?? [];
  const wordId = state.card?.token ?? cardId ?? (state.focus ?? [])[0] ?? null;
  const own = [str(state.why), ...strs(state.more)].filter(Boolean);
  return {
    pos: { n: (state.i ?? 0) + 1, count: steps.length, sentence: sentenceName(state), head: str(state.head),
           word: wordId && idx.has(wordId) ? idx.get(wordId).text : null },
    ticks: steps.map(s => SENT_CODE[s.file] ?? 'o').join(''),
    cue: str(state.cue),
    notes: strs(state.notes),
    aloud: marksOf(state.marks).map(m => { try { return aloudLine(m, data); } catch (e) { return null; } }).filter(Boolean),
    held: heldBack(state, data, cardId), heldStep: own,
    screen: safe(() => screenModel(state, data), { label: '', items: [] }),
    side: safe(() => sideModel(data), { blocks: [] }),
    cur: safe(() => curModel(state, data), { keys: [], sentence: null }),
  };
}
/** Why a row is on this view: the step itself, its callout or view, or the words whose parse cites it. */
function rowContext(key, state, data, cardId) {
  const idx = tokIndex(data), v = state.view ?? {}, out = [];
  if (state.callout?.cite === key) out.push('callout');
  if ([v.cite, v.left?.cite, v.right?.cite].includes(key)) out.push('view');
  for (const id of [...(state.list ?? []), state.card?.token, cardId].filter(Boolean))
    if ((parseRow(data, id)?.sources ?? []).includes(key)) out.push(idx.get(id)?.text ?? id);
  return [...new Set(out)].join(', ');
}

/* ---------------- the view: runs in the popup and, unchanged, in the ?view=sources tab ----------------
   Closes over nothing. It is written into the popup through toString(), so no module-level helper may be used. */
function SourceApp(D, mode) {
  var doc = document, win = window;
  function $(id) { return doc.getElementById(id); }
  var S = null, sig = '', bc = null, lastSync = 0, heldOpen = false, sideSig = '', scrollSig = '';

  function imgs() {
    try {
      if (mode === 'popup') { var o = win.opener; if (o && !o.closed && o.__IMG) return o.__IMG; }
    } catch (e) {}
    try { return win.__IMG || {}; } catch (e) { return {}; }
  }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function flash(t) {
    var f = $('pl-flash'); if (!f) return;
    f.textContent = t; f.hidden = false;
    clearTimeout(flash.t); flash.t = setTimeout(function () { f.hidden = true; }, 2200);
  }
  function copy(text) {
    function fallback() {
      var ok = false;
      try {
        var ta = doc.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        doc.body.appendChild(ta); ta.focus(); ta.select();
        ok = doc.execCommand('copy');
        doc.body.removeChild(ta);
      } catch (e) { ok = false; }
      flash(ok ? 'Path copied' : 'Copy failed: select the path and press Ctrl+C');
    }
    try {
      if (win.navigator.clipboard && win.navigator.clipboard.writeText) {
        win.navigator.clipboard.writeText(text).then(function () { flash('Path copied'); }, fallback);
        return;
      }
    } catch (e) {}
    fallback();
  }
  function post(m) { try { if (bc) bc.postMessage(m); } catch (e) {} }

  /* ---- keys: forward and back only, handled in the capture phase before any focused control ---- */
  function navDir(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return 0;
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown') return 1;
    if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') return -1;
    if (k === ' ' || k === 'Spacebar') return e.shiftKey ? -1 : 1;
    return 0;
  }
  win.addEventListener('keydown', function (e) {
    var d = navDir(e); if (!d) return;
    e.preventDefault(); e.stopPropagation();
    post({ type: 'nav', dir: d });
  }, true);
  win.addEventListener('keyup', function (e) {          // a button activates on Space keyup: stop that too
    if (navDir(e)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* ---- blocks ---- */
  function section(id, title) {
    var s = $(id); s.innerHTML = '';
    s.appendChild(el('h2', 'sec', title));
    return s;
  }
  function show(id, on) { $(id).hidden = !on; }

  function renderPosition() {
    var p = S.pos || {}, bits = ['Press ' + p.n + ' of about ' + p.count];
    if (p.sentence) bits.push(p.sentence);
    if (p.head && p.head !== p.sentence) bits.push(p.head);
    var line = $('pl-pos'); line.innerHTML = '';
    line.appendChild(el('span', 'posline', bits.join(' · ')));
    if (p.word) { line.appendChild(doc.createTextNode(' · ')); line.appendChild(el('span', 'greek', p.word)); }
    var tk = $('pl-ticks'); tk.innerHTML = '';
    var t = S.ticks || '';
    for (var i = 0; i < t.length; i++) {
      var c = el('span', 'tick'); c.setAttribute('data-s', t.charAt(i));
      if (i === S.i) c.className += ' now'; else if (i < S.i) c.className += ' past';
      tk.appendChild(c);
    }
  }
  function renderCue() {
    show('pl-cue', !!S.cue);
    if (!S.cue) return;
    var s = section('pl-cue', 'Cue'); s.appendChild(el('p', 'cuetext', S.cue));
  }
  function renderNotes() {
    var n = S.notes || [];
    show('pl-notes', n.length > 0);
    if (!n.length) return;
    var s = section('pl-notes', 'Notes'), ul = el('ol', 'notelist');
    for (var i = 0; i < n.length; i++) {
      var li = el('li'), t = String(n[i]), c = t.indexOf(':');
      if (c > 0 && c <= 80) { li.appendChild(el('strong', 'nname', t.slice(0, c + 1))); li.appendChild(doc.createTextNode(t.slice(c + 1))); }
      else li.appendChild(doc.createTextNode(t));
      ul.appendChild(li);
    }
    s.appendChild(ul);
  }
  function renderScreen() {
    var sc = S.screen || {}, it = sc.items || [];
    show('pl-screen', it.length > 0);
    if (!it.length) return;
    var s = section('pl-screen', 'On screen'), prev = '';
    if (sc.label) s.appendChild(el('div', 'sclabel', sc.label));
    for (var i = 0; i < it.length; i++) {
      var x = it[i];
      if (x.t === 'en') {
        var p = el('p', 'scen');
        if (x.who) p.appendChild(el('span', 'who', x.who + ': '));
        p.appendChild(doc.createTextNode(x.text));
        s.appendChild(p);
      } else if (x.t === 'wbw') {
        var r = el('div', 'scw');
        if (prev !== 'wbw') r.appendChild(el('span', 'chip wchip', 'word by word'));
        for (var j = 0; j < x.words.length; j++) {
          var w = el('span', 'w'); w.appendChild(el('span', 'greek wg', x.words[j].g));
          w.appendChild(el('span', 'wgl', x.words[j].gl || '\u2013')); r.appendChild(w);
        }
        s.appendChild(r);
      }
      prev = x.t;
    }
  }
  function renderSide() {
    var side = $('pl-side'); if (!side) return;
    var blocks = (S && S.side && S.side.blocks) || [], g = JSON.stringify(blocks);
    if (g !== sideSig) {
      sideSig = g; scrollSig = ''; side.innerHTML = '';
      if (blocks.length) side.appendChild(el('h2', 'sec sidehead', 'The whole text'));
      for (var b = 0; b < blocks.length; b++) {
        var blk = blocks[b], box = el('section', 'sent' + (blk.skipped ? ' skipped' : ''));
        box.setAttribute('data-key', blk.key);
        var h = el('h3', 'senthead', blk.name);
        if (blk.note) h.appendChild(el('span', 'chip notparsed', blk.note));
        box.appendChild(h);
        for (var r = 0; r < blk.rows.length; r++) {
          var row = blk.rows[r], d = el('div', 'line'); d.setAttribute('data-key', row.key);
          if (row.who) d.appendChild(el('div', 'lwho', row.who));
          d.appendChild(el('div', 'greek lg', row.greek));
          if (row.en) d.appendChild(el('div', 'len', row.en));
          box.appendChild(d);
        }
        side.appendChild(box);
      }
    }
    var cur = (S && S.cur) || {}, keys = cur.keys || [], rows = side.querySelectorAll('.line'), first = null, last = null, i;
    for (i = 0; i < rows.length; i++) {
      var on = keys.indexOf(rows[i].getAttribute('data-key')) >= 0;
      rows[i].classList.toggle('now', on);
      if (on) { if (!first) first = rows[i]; last = rows[i]; }
    }
    var sents = side.querySelectorAll('.sent');
    for (i = 0; i < sents.length; i++) sents[i].classList.toggle('cursent', sents[i].getAttribute('data-key') === cur.sentence);
    var target = first || side.querySelector('.sent.cursent'), end = last || target;
    var sg = keys.join(',') + '|' + (cur.sentence || '');
    if (target && sg !== scrollSig) {
      scrollSig = sg;
      try {
        var top = target.offsetTop, bot = end.offsetTop + end.offsetHeight, H = side.clientHeight;
        var y = (bot - top < H - 80) ? top - (H - (bot - top)) / 2 : top - 60;
        side.scrollTop = Math.max(0, y);
      } catch (e) {}
    }
  }
  function renderAloud() {
    var a = S.aloud || [];
    show('pl-aloud', a.length > 0);
    if (!a.length) return;
    var s = section('pl-aloud', 'Read aloud'), ul = el('ul', 'aloudlist');
    for (var i = 0; i < a.length; i++) {
      var li = el('li'); li.appendChild(el('div', 'al', a[i].text));
      if (a[i].greek) li.appendChild(el('div', 'greek alg', a[i].greek));
      ul.appendChild(li);
    }
    s.appendChild(ul);
  }

  function refBits(ref) {
    var out = [];
    if (!ref) return out;
    if (ref.page) out.push(['page', ref.page]);
    if (ref.footnote) out.push(['footnote', ref.footnote]);
    if (ref.line) out.push(['line', ref.line]);
    if (ref.section) out.push(['section', ref.section]);
    if (ref.sense) out.push(['sense', ref.sense]);
    if (ref.column) out.push(['column', ref.column]);
    return out;
  }
  function buildRow(r, thumbs) {
    var li = el('li', 'row'); li.setAttribute('data-key', r.key); li.setAttribute('data-grade', r.grade);
    var top = el('div', 'top');
    top.appendChild(el('span', 'disp', r.display));
    var chip = el('span', 'grade', 'grade ' + r.grade); chip.title = r.key;
    top.appendChild(chip);
    li.appendChild(top);
    var bits = refBits(r.ref), meta = el('div', 'meta');
    for (var i = 0; i < bits.length; i++) {
      var b = el('span', 'bit'); b.appendChild(el('span', 'bk', bits[i][0] + ' ')); b.appendChild(doc.createTextNode(bits[i][1]));
      meta.appendChild(b);
    }
    if (r.ctx) meta.appendChild(el('span', 'bit ctx', 'for ' + r.ctx));
    if (meta.childNodes.length) li.appendChild(meta);
    if (r.path) {
      var p = el('div', 'path', r.path); p.setAttribute('data-role', 'path');
      li.appendChild(p);
      var acts = el('div', 'acts');
      var bt = el('button', 'copy', 'Copy path'); bt.type = 'button';
      bt.addEventListener('click', function (ev) { ev.stopPropagation(); copy(r.path); });
      acts.appendChild(bt);
      var a = el('a', 'file', 'Open image'); a.href = r.href; a.target = '_blank'; a.rel = 'noopener';
      a.setAttribute('data-role', 'link');
      acts.appendChild(a);
      li.appendChild(acts);
      var uri = thumbs && r.shot ? thumbs[r.shot] : null;
      if (uri) { var im = el('img', 'thumb'); im.alt = 'Screenshot of ' + r.display; im.src = uri; li.appendChild(im); }
    } else {
      li.appendChild(el('div', 'none', r.withheld ? 'Image not available. Reference only.' : r.refOnly ? 'Reference only.' : 'No screenshot saved'));
    }
    li.addEventListener('click', function () { setSelected(r.key, false); });
    return li;
  }
  function renderCited() {
    var s = section('pl-cited', 'Cited here'), rows = S.rows || [];
    var ul = el('ul', 'rows'); ul.id = 'pl-rows';
    if (!rows.length) ul.appendChild(el('li', 'empty', 'No citations on this view'));
    else {
      var thumbs = imgs();
      for (var i = 0; i < rows.length; i++) ul.appendChild(buildRow(rows[i], thumbs));
    }
    s.appendChild(ul);
  }
  function renderHeld() {
    var h = S.held || [], own = S.heldStep || [];
    show('pl-held', h.length > 0 || own.length > 0);
    if (!h.length && !own.length) return;
    var s = $('pl-held'); s.innerHTML = '';
    var d = el('details', 'held'); d.open = heldOpen;
    d.addEventListener('toggle', function () { heldOpen = d.open; });
    d.appendChild(el('summary', 'sec', 'Held back'));
    function para(parent, label, text) {
      var p = el('p', 'hp'); p.appendChild(el('span', 'hl', label + ' ')); p.appendChild(doc.createTextNode(text)); parent.appendChild(p);
    }
    if (own.length) {
      var o = el('div', 'hw'); o.appendChild(el('div', 'hh', 'This press'));
      var ul = el('ul', 'hm'); for (var k = 0; k < own.length; k++) ul.appendChild(el('li', null, own[k]));
      o.appendChild(ul); d.appendChild(o);
    }
    for (var i = 0; i < h.length; i++) {
      var w = h[i], box = el('div', 'hw'), hh = el('div', 'hh');
      hh.appendChild(el('span', 'greek', w.word)); if (w.gloss) hh.appendChild(doc.createTextNode(' · ' + w.gloss));
      box.appendChild(hh);
      if (w.why) para(box, 'Why', w.why);
      if (w.syntax) para(box, 'Syntax', w.syntax);
      for (var j = 0; j < w.alts.length; j++) {
        var a = w.alts[j];
        para(box, 'Rejected', (a.reading || '') + (a.reading && a.rejected ? ' — ' : '') + (a.rejected || ''));
      }
      if (w.more.length) { var m = el('ul', 'hm'); for (var q = 0; q < w.more.length; q++) m.appendChild(el('li', null, w.more[q])); box.appendChild(m); }
      d.appendChild(box);
    }
    s.appendChild(d);
  }

  function markSelected(scroll) {
    var rows = doc.querySelectorAll('#pl-rows .row'), hit = null;
    for (var i = 0; i < rows.length; i++) {
      var on = !!S && rows[i].getAttribute('data-key') === S.selected;
      rows[i].classList.toggle('sel', on);
      if (on) hit = rows[i];
    }
    if (hit && scroll) { try { hit.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
  }
  function setSelected(key, scroll) {
    if (!S) return;
    S.selected = key; sig = ''; markSelected(scroll);
  }

  function render() {
    var root = doc.documentElement;
    if (!S) { $('pl-pos').textContent = 'Waiting for deck'; $('pl-ticks').innerHTML = ''; ['pl-cue', 'pl-screen', 'pl-notes', 'pl-aloud', 'pl-held'].forEach(function (i) { show(i, false); }); $('pl-cited').innerHTML = ''; return; }
    root.setAttribute('data-theme', S.theme === 'light' ? 'light' : 'dark');
    root.classList.toggle('wash', !!S.wash);
    function run(f) { try { f(); } catch (e) { try { console.warn('sources: render failed', e); } catch (x) {} } }
    run(renderPosition); run(renderCue); run(renderNotes); run(renderScreen); run(renderAloud); run(renderCited); run(renderHeld); run(renderSide);
    markSelected(true);
  }

  function apply(m) {
    if (!m || m.type !== 'state') return;
    var g = JSON.stringify(m);
    if (g === sig) return;
    var fresh = !S || S.i !== m.i;
    sig = g; S = m; render();
    if (fresh) { try { $('pl-root').scrollTop = 0; } catch (e) {} }
  }
  function opener() {
    try {
      var o = win.opener;
      if (o && !o.closed && o.__plSources && typeof o.__plSources.snapshot === 'function') return o;
    } catch (e) {}
    return null;
  }
  function sync() {
    var o = opener(), m = null;
    if (o) { try { m = o.__plSources.snapshot(); } catch (e) { m = null; } }
    if (m) { lastSync = Date.now(); apply(m); }
  }

  try {
    bc = new BroadcastChannel(D.channel);
    bc.onmessage = function (e) {
      try {
        var m = e && e.data; if (!m) return;
        if (m.type === 'state') { lastSync = Date.now(); apply(m); }
        else if (m.type === 'select') setSelected(m.key, true);
      } catch (x) {}
    };
  } catch (e) { bc = null; }

  doc.title = D.title;
  render();
  sync();
  post({ type: 'hello' });
  /* recovery: the opener link and the channel both feed apply(); ask again while nothing has arrived */
  win.setInterval(function () {
    sync();
    if (!S || Date.now() - lastSync > 4000) post({ type: 'hello' });
  }, 700);
  win.addEventListener('focus', function () { sync(); post({ type: 'hello' }); });
  win.__plSourceView = { state: function () { return S; } };
}

/* ---------------- page: inline CSS and body, written into the popup or the tab ----------------
   No literal colour. Every colour is a variable from the deck's own tokens.css, copied at open time (tokenCss),
   so both themes and washout apply. The fallbacks are system colours, which still follow color-scheme. */
const GREEK = '"Gentium Book Plus","Gentium Plus","Palatino Linotype",Palatino,"New Athena Unicode","Times New Roman",serif';
const V = {
  bg: 'var(--bg,Canvas)', fg: 'var(--fg,CanvasText)', muted: 'var(--muted,GrayText)', rule: 'var(--rule,GrayText)',
  amber: 'var(--amber,Highlight)', card: 'var(--veil,var(--bg,Canvas))',
};
const CSS = [
  'html{color-scheme:dark}html[data-theme="light"]{color-scheme:light}',
  '*{box-sizing:border-box}html,body{margin:0;height:100%;background:' + V.bg + ';color:' + V.fg + ';overflow:hidden}',
  'body{font:400 22px/1.45 var(--font-label,"Alegreya Sans",system-ui,-apple-system,"Segoe UI",sans-serif)}',
  '.greek{font-family:var(--font-greek,' + GREEK + '),' + GREEK + '}',
  '#pl-app{display:grid;grid-template-columns:minmax(0,1fr) clamp(380px,34vw,620px);height:100vh}',
  '#pl-root{min-width:0;overflow:auto;padding:18px 28px 70px}#pl-root>*{max-width:1120px}',
  '#pl-side{position:relative;min-width:0;overflow:auto;border-left:3px solid ' + V.rule + ';padding:16px 20px 60px;background:' + V.card + '}',
  '@media (max-width:860px){#pl-app{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) 38vh}#pl-side{border-left:0;border-top:3px solid ' + V.rule + '}}',
  'h2.sidehead{margin:0 0 6px}.sent{margin:0 0 18px;padding:0;border:0}.senthead{margin:10px 0 6px;font-size:22px;font-weight:700;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}',
  '.sent.cursent .senthead{color:' + V.amber + '}.notparsed{font-size:18px;font-weight:700;color:' + V.muted + ';border-color:' + V.muted + '}',
  '.line{padding:8px 12px 10px;margin:4px 0;border-left:6px solid transparent;border-radius:6px}',
  '.sent.skipped .line{border-left-style:dashed;border-left-color:' + V.rule + '}',
  '.line.now{border-left:6px solid ' + V.amber + ';background:' + V.bg + ';box-shadow:0 0 0 2px ' + V.amber + '}',
  '.lg{font-size:25px;line-height:1.4}.len{font-size:21px;color:' + V.muted + ';margin-top:2px}.line.now .len{color:' + V.fg + '}',
  '.lwho{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:' + V.muted + '}',
  '.sclabel{font-size:20px;color:' + V.muted + ';margin:0 0 6px}.scen{margin:6px 0;font-size:26px;line-height:1.4}.who{font-weight:700;color:' + V.muted + '}',
  '.scw{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-start;margin:8px 0}.wchip{font-size:18px;font-weight:700;color:' + V.muted + ';border-color:' + V.muted + ';align-self:center}',
  '.w{display:inline-flex;flex-direction:column;align-items:center}.wg{font-size:26px}.wgl{font-size:21px;color:' + V.fg + '}',
  '#pl-top{position:sticky;top:0;background:' + V.bg + ';padding:4px 0 12px;border-bottom:2px solid ' + V.rule + ';z-index:2}',
  '#pl-pos{font-size:26px;font-weight:600;line-height:1.3}#pl-pos .greek{font-size:30px;font-weight:400}',
  '#pl-ticks{display:flex;gap:1px;height:26px;align-items:flex-end;margin-top:10px}',
  '.tick{flex:1 1 0;min-width:1px;height:10px;background:var(--c-neutral,' + V.muted + ');opacity:.55}',
  '.tick[data-s="1"]{background:var(--c-finite,' + V.fg + ')}.tick[data-s="2"]{background:var(--c-ptc,' + V.fg + ')}',
  '.tick[data-s="3"]{background:var(--c-conj,' + V.fg + ')}.tick[data-s="4"]{background:var(--c-gabs,' + V.fg + ')}',
  '.tick.past{opacity:.9}.tick.now{height:26px;opacity:1;outline:2px solid ' + V.fg + '}',
  'section{margin-top:20px;padding-top:12px;border-top:1px solid ' + V.rule + '}section[hidden]{display:none}',
  'h2.sec,summary.sec{margin:0 0 8px;font-size:20px;letter-spacing:.08em;text-transform:uppercase;color:' + V.muted + ';font-weight:700}',
  'summary.sec{cursor:pointer}',
  '.cuetext{margin:0;font-size:26px;font-weight:600;color:' + V.amber + '}',
  '.notelist,.aloudlist,.hm{margin:0;padding-left:26px}.notelist{list-style:none;padding-left:0}.notelist li{margin:0 0 14px;font-size:24px;line-height:1.45}.nname{font-weight:800}',
  '.aloudlist li{margin:8px 0}.al{font-size:22px}.alg{font-size:24px;color:' + V.muted + '}',
  '.rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:16px}',
  '.row{background:' + V.card + ';border:1px solid ' + V.rule + ';border-left:6px solid ' + V.rule + ';border-radius:8px;padding:14px 18px;cursor:default}',
  '.row.sel{border-color:' + V.amber + ';border-left-color:' + V.amber + ';box-shadow:0 0 0 3px ' + V.amber + '}',
  '.top{display:flex;gap:14px;align-items:baseline;justify-content:space-between}',
  '.disp{font-size:25px;font-weight:600;font-family:var(--font-greek,' + GREEK + '),' + GREEK + ';user-select:text;-webkit-user-select:text}',
  '.grade{flex:none;font-weight:700;font-size:20px;border:2px solid currentColor;border-radius:6px;padding:0 8px;white-space:nowrap}',
  '.row[data-grade="A"] .grade{color:var(--c-gabs,' + V.fg + ')}.row[data-grade="B"] .grade{color:var(--c-ptc,' + V.fg + ')}.row[data-grade="C"] .grade{color:var(--c-conj,' + V.fg + ')}',
  '.meta{font-size:20px;color:' + V.muted + ';margin:4px 0 8px;display:flex;flex-wrap:wrap;gap:4px 18px}',
  '.bk{text-transform:uppercase;letter-spacing:.05em;font-size:18px}',
  '.chip{font-weight:700;border:2px solid var(--c-conj,currentColor);color:var(--c-conj,' + V.fg + ');border-radius:6px;padding:0 8px}',
  '.path{font:500 20px/1.35 ui-monospace,Menlo,Consolas,monospace;word-break:break-all;user-select:text;-webkit-user-select:text;background:' + V.bg + ';border:1px solid ' + V.rule + ';border-radius:6px;padding:8px 10px}',
  '.acts{display:flex;gap:14px;align-items:center;margin-top:10px}',
  'button.copy{font-weight:600;font-size:20px;line-height:1;font-family:inherit;color:' + V.bg + ';background:' + V.fg + ';border:0;border-radius:6px;padding:10px 16px;cursor:pointer}',
  'a.file{font-size:20px;color:var(--c-ptc,' + V.fg + ');text-decoration:underline}',
  '.thumb{display:block;max-width:100%;max-height:260px;margin-top:12px;border:1px solid ' + V.rule + ';border-radius:4px}',
  '.none,.empty{font-size:22px;color:' + V.muted + '}.empty{padding:6px 0}',
  '.hw{margin:12px 0;padding:8px 0 4px;border-top:1px dashed ' + V.rule + '}.hh{font-size:24px;font-weight:600}.hh .greek{font-size:28px}',
  '.hp{margin:4px 0}.hl{font-weight:700;color:' + V.muted + ';text-transform:uppercase;font-size:18px;letter-spacing:.05em}',
  '#pl-flash{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:' + V.fg + ';color:' + V.bg + ';font-weight:600;font-size:22px;padding:12px 20px;border-radius:8px}',
  '#pl-flash[hidden]{display:none}',
  'button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid ' + V.amber + ';outline-offset:2px}'
].join('\n');
const BODY = '<div id="pl-app"><div id="pl-root"><div id="pl-top"><div id="pl-pos">Waiting for deck</div><div id="pl-ticks" aria-hidden="true"></div></div>' +
  '<section id="pl-cue" hidden></section><section id="pl-notes" hidden></section><section id="pl-screen" hidden></section><section id="pl-aloud" hidden></section>' +
  '<section id="pl-cited"></section><section id="pl-held" hidden></section></div><aside id="pl-side" aria-label="The whole text with line translations"></aside></div><div id="pl-flash" role="status" hidden></div>';

/** The deck's own colour and font variables, copied as text: :root / html rules (both themes, washout) and @font-face. */
function tokenCss(withFonts) {
  let css = '';
  try {
    for (const sh of Array.from(document.styleSheets)) {
      let rules = []; try { rules = Array.from(sh.cssRules); } catch (e) { continue; }
      for (const r of rules) {
        if (r.type === 5) { if (withFonts) css += r.cssText + '\n'; }
        else if (r.type === 1 && /^(:root|html)\b/.test(r.selectorText || '') && /--[a-z]/.test(r.cssText)) css += r.cssText + '\n';
      }
    }
  } catch (e) {}
  return css;
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function payload(mode) { return { title: TITLE, channel: CHANNEL, mode }; }
function htmlAttrs() {
  let wash = false;
  try { wash = document.documentElement.classList.contains('wash'); } catch (e) {}
  return 'data-theme="' + currentTheme() + '"' + (wash ? ' class="wash"' : '');
}
function buildPage() {
  const json = JSON.stringify(payload('popup')).replace(/</g, '\\u003c').replace(new RegExp('\\u2028','g'), '\\u2028').replace(new RegExp('\\u2029','g'), '\\u2029');
  return '<!doctype html><html lang="en" ' + htmlAttrs() + '><head><meta charset="utf-8"><title>' + esc(TITLE) + '</title><style>' + tokenCss(false) + CSS +
    '</style></head><body>' + BODY + '<script>(' + SourceApp.toString() + ')(' + json + ',"popup");<' + '/script></body></html>';
}
function currentTheme() {
  try { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; }
}

/* ---------------- ?view=sources tab ---------------- */
export function isSourceView() {
  try { return new URLSearchParams(location.search).get('view') === 'sources'; } catch (e) { return false; }
}
export function mountSourceView() {
  const go = () => {
    try {
      const tokens = tokenCss(true);
      for (const sh of Array.from(document.styleSheets)) { try { sh.disabled = true; } catch (e) {} }
      const st = document.createElement('style'); st.id = 'pl-sources-style'; st.textContent = tokens + CSS;
      document.head.appendChild(st);
      document.body.removeAttribute('class'); document.body.removeAttribute('style');
      document.body.innerHTML = BODY;
      SourceApp(payload('tab'), 'tab');
    } catch (e) { try { console.warn('sources: view failed', e); } catch (x) {} }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
  else go();
}

/* ---------------- deck side ---------------- */
let deck = null, win = null, bc = null, toastEl = null;
let cur = null, cardId = null, selected = null, attached = false;

function root() { try { return window.__ROOT__ || ''; } catch (e) { return ''; } }
function snapshot() {
  const data = window.__DATA__;
  if (!deck || !data || !cur) return null;
  let rows = [], model = {};
  try {
    rows = sourceKeys(cur, data, cardId).map(k => ({ ...sourceRow(k, data, root()), ref: data.cites[k].ref ?? null,
      ctx: rowContext(k, cur, data, cardId) }));
  } catch (e) { rows = []; }
  try { model = stepModel(cur, data, cardId); } catch (e) { model = {}; }
  const sel = rows.some(r => r.key === selected) ? selected : null;
  let wash = false; try { wash = document.documentElement.classList.contains('wash'); } catch (e) {}
  return { type: 'state', i: cur.i, id: cur.id, head: cur.head ?? '', count: data.steps.length, rows, selected: sel,
           theme: currentTheme(), wash, ...model };
}
function postState() { try { const m = snapshot(); if (m && bc) bc.postMessage(m); } catch (e) {} }

function toast(msg) {
  try {
    if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
    const t = document.createElement('div');
    t.id = 'pl-sources-toast'; t.setAttribute('role', 'status'); t.textContent = msg || 'Allow pop-ups, then press S';
    t.style.cssText = 'position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:2147483600;background:var(--fg,CanvasText);color:var(--bg,Canvas);' +
      'font:600 22px/1.3 system-ui,sans-serif;padding:14px 22px;border-radius:8px;box-shadow:0 6px 28px rgba(0,0,0,.5);pointer-events:none';
    document.body.appendChild(t); toastEl = t;
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); if (toastEl === t) toastEl = null; }, 6000);
  } catch (e) {}
}

function open() {
  for (let tries = 0; tries < 2; tries++) {
    let w = null;
    try { w = window.open('', CHANNEL, 'width=1400,height=1000'); } catch (e) { w = null; }
    if (!w) { toast('Allow pop-ups, then press S'); return false; }
    let live = false, reachable = true;
    try { live = !!(w.document && w.document.getElementById('pl-root')); } catch (e) { reachable = false; }
    if (!reachable) { try { w.close(); } catch (e) {} continue; }   // a reloaded popup lost its creator: open a fresh one
    win = w;
    try {
      if (!live) { w.document.open(); w.document.write(buildPage()); w.document.close(); }
      try { w.focus(); } catch (e) {}
    } catch (e) { try { console.warn('sources: could not build window', e); } catch (x) {} }
    postState();
    return true;
  }
  return false;
}

function typing(t) {
  try {
    if (!t) return false;
    const tag = (t.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  } catch (e) { return false; }
}

// The deck answers 'hello' and 'nav' (forward/back relayed from the view) and nothing else.
function onMessage(e) {
  try {
    const m = e && e.data; if (!m) return;
    if (m.type === 'hello') postState();
    else if (m.type === 'nav' && deck && (m.dir === 1 || m.dir === -1)) { if (m.dir === 1) deck.next(); else deck.back(); }
  } catch (x) {}
}

export function attachSources() {
  if (attached) return;
  attached = true;
  try { bc = new BroadcastChannel(CHANNEL); bc.onmessage = onMessage; } catch (e) { bc = null; }
  try { window.__plSources = { snapshot, open }; } catch (e) {}

  hooks.on('deck', d => { deck = d; try { cur = d.state(); } catch (e) {} postState(); });
  hooks.on('apply', ({ state }) => { cur = state; selected = null; postState(); });
  hooks.on('leave', () => { cardId = null; });
  hooks.on('card', p => { cardId = p && p.id ? p.id : null; postState(); });
  hooks.on('theme', () => postState());
  hooks.on('wash', () => postState());
  hooks.on('source:select', ({ key }) => { selected = key; try { if (bc) bc.postMessage({ type: 'select', key }); } catch (e) {} postState(); });

  // rail click: highlight the row, never preventDefault, so the rail still opens its screenshot
  document.addEventListener('click', ev => {
    try {
      const n = ev.target && ev.target.closest ? ev.target.closest('#rail .cite[data-key]') : null;
      if (n) hooks.emit('source:select', { key: n.getAttribute('data-key') });
    } catch (e) {}
  }, true);

  document.addEventListener('keydown', ev => {
    try {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (typing(ev.target)) return;
      if (ev.key !== 's' && ev.key !== 'S') return;
      ev.preventDefault();
      open();
    } catch (e) {}
  });
}
