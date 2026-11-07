// compile-steps.mjs: src/steps/*.mjs -> build/steps.json.
// Fails on any malformed step. --steps <dir> compiles any folder on the real data and drops only the
// whole-deck coverage and continuity refusals, because a probe is a sample of presses.
// Run: node tools/compile-steps.mjs [--stub] [--scope s1] [--steps dir] [--out file]
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeCtx, isMain, report, readJson } from './lib/ctx.mjs';
import { loadLocked, loadTrees, loadEn, loadCites, loadParses, loadLsjPassage, SENT } from './lib/data.mjs';
import { TOKEN_RE, NODE_RE, expandRange, resolveRefs } from './lib/refs.mjs';

const KEYS = ['id', 'head', 'sub', 'view', 'depth', 'en', 'open', 'tree', 'world', 'spine', 'marks', 'rows', 'reason', 'rail', 'callouts', 'derive', 'cite', 'cue', 'notes', 'why', 'more'];
const RETIRED = { focus: 'use lit on a scene group', list: 'use rows', card: 'use rows', callout: 'use callouts', t: 'does not exist', tier: 'does not exist' };
const TYPES = ['finite', 'ptc', 'conj', 'gabs', 'indst', 'analogy', 'neutral'];
const WORLDS = ['rest', 'form', 'identify', 'fork', 'twin', 'ascend'];
const MODES = ['full', 'line', 'lift', 'pair', 'plate', 'scene', 'home', 'final', 'skipped'];
const STATES = ['hidden', 'fresh', 'lit', 'tagged', 'done'];
const KINDS = ['cites-passage', 'variant', 'gap'];
const SPINE = ['slots', 'running'];
const EN_STATES = ['off', 'blank', 'prov', 'on'];
// The closed relation list. `spine` marks the four forms mirrored on the English.
const RELS = {
  predicate: { dir: true, spine: true }, describes: { dir: true, spine: true }, governs: { dir: true }, modifies: { dir: true },
  agrees: { dir: false }, connects: { dir: false, spine: true }, introduces: { dir: true }, resumes: { dir: true, spine: true },
};
const VIA = ['above', 'below', 'left', 'right', 'line'];
const LINE_KINDS = ['double', 'dotted'];
// Anchor names. Numbers live in layout.mjs; the compiler checks the name and fills size and plane.
const ANCHORS = {
  centre: [96, 0], 'centre.l': [96, 0], 'centre.r': [96, 0], 'lintel.l': [64, 1], 'lintel.r': [64, 1], 'lintel.t': [44, 1], 'lintel.m': [64, 1],
  margin: [38, 1], f1: [72, 0], f2: [72, 0], 'up.r2': [48, 1], 'up.r3': [48, 1], 'arrow.mid': [64, 1], 'wings.l': [72, 'wings'], 'wings.r': [72, 'wings'],
  home: [38, 'home'], boards: [56, 0], b1: [56, 0], b2: [56, 0], b3: [56, 0], b4: [56, 0], b5: [56, 0], 'stack.top': [44, 1], 'stack.bot': [44, 1],
};
const RUNS = ['centre', 'centre.l', 'centre.r', 'lintel.l', 'lintel.r', 'f1', 'f2', 'up.r2', 'up.r3', 'b1', 'b2', 'b3', 'b4', 'b5'];
const TABLE_ROWS = ['T', 'A1', 'A2', 'B1', 'B2', 'C'], TABLE_COLS = ['head', 'pred', 'inf', 'obj', 'verdict'];
const GREEK = /[Ͱ-Ͽἀ-῿]/;
const ID_RE = /^(ov|s[1-4]|sk|cl)-\d\d[a-z]?$/;
const FILE_OF = { ov: 'overture', sk: 'skipped', cl: 'close' };
const fileToSentence = (f) => /^s[1-4]$/.test(f) ? f.toUpperCase() : null;
const filePrefix = (f) => f === 'overture' ? 'ov' : f === 'skipped' ? 'sk' : f === 'close' ? 'cl' : f;
const chars = (s) => [...(s ?? '').normalize('NFC')].length;
const isInt = (n) => Number.isInteger(n);

/** --steps <dir>: real roots, all four sentences, every .mjs in the folder in name order. */
export function probeCtx(ctx) {
  const dir = ctx.val('--steps');
  if (!dir) return ctx;
  if (ctx.stub) throw new Error('--steps builds on the real data: do not combine it with --stub');
  const abs = path.resolve(process.cwd(), dir);
  ctx.probe = true;
  ctx.stepsDir = abs;
  ctx.files = readdirSync(abs).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();
  ctx.sentences = [...SENT];
  ctx.scope = 'probe';
  ctx.suffix = '-probe';
  return ctx;
}

// The two skipped-words views sit between S3 and S4. The file is optional.
const stepFiles = (ctx) => ctx.probe ? ctx.files : ctx.files.flatMap((f) => f === 's4' ? ['skipped', f] : [f]);
const OPTIONAL = new Set(['skipped']);

export async function compile(ctx, pre = {}) {
  const errs = [], warns = [];
  const E = (m) => errs.push(m);
  const { tokens, gap, table } = pre.locked || loadLocked(ctx, errs);
  const { idx } = pre.trees || loadTrees(ctx, table, errs);
  const en = pre.en || loadEn(ctx, errs);
  const cites = pre.cites || loadCites(ctx, errs);
  const parses = loadParses(ctx, errs);
  const passage = loadLsjPassage(ctx, errs);
  const skipped = loadSkipped(ctx, errs);
  const R = (s, w) => resolveRefs(s, table, errs, w);
  const parseRow = new Map(Object.values(parses).flatMap((p) => (p.rows || []).map((r) => [r.id, r])));

  // A probe may carry English stages the data does not hold yet (see --steps).
  const stagesFile = ctx.probe ? path.join(ctx.stepsDir, 'stages.json') : null;
  if (stagesFile && existsSync(stagesFile)) {
    const raw = readFileSync(stagesFile, 'utf8');
    if (GREEK.test(raw)) E('stages.json: Greek literal');
    for (const [q, list] of Object.entries(JSON.parse(raw))) {
      const [S, id] = q.split('.');
      const slot = en[S]?.slots?.find((x) => x.id === id);
      if (!slot) E(`stages.json: unknown slot ${q}`); else slot.stages = list;
    }
  }

  // ---- selectors
  const sortU = (ids) => [...new Set(ids)].sort((a, b) => table.ord(a) - table.ord(b));
  function sel(list, w) {
    if (list == null) return [];
    if (!Array.isArray(list)) { E(`${w}: selector list must be an array`); return []; }
    const out = [];
    for (const s of list) {
      if (typeof s !== 'string') { E(`${w}: selector ${JSON.stringify(s)} is not a string`); continue; }
      if (s.includes('..')) {
        const [a, b, ...rest] = s.split('..');
        if (rest.length || !TOKEN_RE.test(a) || !TOKEN_RE.test(b)) { E(`${w}: bad range "${s}"`); continue; }
        try { out.push(...expandRange(table, a, b)); } catch (e) { E(`${w}: ${e.message}`); }
      } else if (TOKEN_RE.test(s)) { if (table.has(s)) out.push(s); else E(`${w}: unknown token ${s}`); }
      else if (NODE_RE.test(s)) { const n = nodeSpan(s); if (n) out.push(...n); else E(`${w}: unknown node ${s}`); }
      else E(`${w}: bad selector "${s}"`);
    }
    return sortU(out);
  }
  const nodeOf = (id) => idx[id.split('.')[0]]?.byId.get(id) || null;
  const nodeSpan = (id) => { const ix = idx[id.split('.')[0]]; return ix?.byId.has(id) ? ix.span(id) : null; };
  const nodeDepth = (id) => idx[id.split('.')[0]].depth(id);
  const slotOf = (q) => { const [S, slot] = q.split('.'); return en[S]?.slots?.find((s) => s.id === slot) ?? null; };
  const ownerNode = new Map();
  for (const ix of Object.values(idx)) for (const n of ix.byId.values()) for (const t of n.tokens || []) ownerNode.set(t, n);
  /** Construction of a token under the active `tree`, deepest node first (same rule as the engine's data-c). */
  function typeOfToken(id, tree) {
    const active = new Set(tree);
    for (let n = ownerNode.get(id); n; n = n.parent == null ? null : nodeOf(n.parent)) if (active.has(n.id)) return n.type;
    return null;
  }

  function qualify(name, S, w) {
    if (typeof name !== 'string') { E(`${w}: slot name must be a string`); return null; }
    let q;
    if (/^S[1-4]\.[a-z][a-z0-9]*$/.test(name)) q = name;
    else if (/^[a-z][a-z0-9]*$/.test(name) && S) q = `${S}.${name}`;
    else { E(`${w}: slot "${name}" must be written qualified (S1.slot) outside a sentence`); return null; }
    if (!slotOf(q)) { E(`${w}: unknown English slot ${q}`); return null; }
    return q;
  }
  const citeKey = (k, w) => { if (typeof k !== 'string' || !cites[k]) E(`${w}: citation key "${k}" is not defined`); return k; };
  const onlyKeys = (o, allowed, w) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) E(`${w}: unknown key "${k}"`); };
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

  // ---- scene groups
  function anchorOf(at, w) {
    if (typeof at !== 'string') { E(`${w}: at required`); return null; }
    const t = /^table\.(T|A1|A2|B1|B2|C)(?:\.([a-z]+))?$/.exec(at);
    if (t) {
      if (t[2] && !TABLE_COLS.includes(t[2])) { E(`${w}: unknown table column "${t[2]}"`); return null; }
      return { at, base: at, run: null, size: 56, plane: 0, table: true };
    }
    const m = /^(.*?)(?:\.(\d))?$/.exec(at);
    const known = (b) => Object.prototype.hasOwnProperty.call(ANCHORS, b);
    const base = known(at) ? at : m[1];
    const run = known(at) ? null : Number(m[2]);
    if (!known(base) || (run !== null && !RUNS.includes(base))) { E(`${w}: unknown anchor "${at}"`); return null; }
    return { at, base, run, size: ANCHORS[base][0], plane: ANCHORS[base][1] };
  }
  function resolveGroup(g, n, w) {
    const gw = `${w}.groups[${n}]`;
    if (!isObj(g)) { E(`${gw}: group must be an object`); return null; }
    onlyKeys(g, ['tokens', 'reserve', 'box', 'at', 'plane', 'size', 'st', 'gloss', 'lit', 'spread', 'pitch', 'indent', 'holes'], gw);
    if ((g.tokens === undefined) === (g.reserve === undefined)) E(`${gw}: needs exactly one of tokens or reserve`);
    const a = anchorOf(g.at, gw);
    if (!a) return null;
    const o = { tokens: g.tokens !== undefined ? sel(g.tokens, `${gw}.tokens`) : [], at: a.at, base: a.base, run: a.run };
    if (g.reserve !== undefined) {
      o.reserve = sel(g.reserve, `${gw}.reserve`);
      if (typeof g.box !== 'string' || !/^[a-z][a-z0-9-]*$/.test(g.box)) E(`${gw}: reserve needs a box name`); else o.box = g.box;
    } else if (g.box !== undefined) E(`${gw}: box goes with reserve`);
    const plane = g.plane ?? a.plane;
    if (![0, 1, 2, 'wings', 'home'].includes(plane)) E(`${gw}: bad plane ${plane}`);
    o.plane = plane;
    o.size = g.size ?? a.size;
    if (!isInt(o.size) || o.size < 34 || o.size > 96) E(`${gw}: bad size ${o.size}`);
    if (g.st !== undefined && !STATES.includes(g.st)) E(`${gw}: unknown st "${g.st}"`);
    const hiddenAnchor = plane === 'wings' || plane === 'home';
    if (hiddenAnchor && g.st !== undefined && g.st !== 'hidden') E(`${gw}: ${a.base} holds hidden words only`);
    if (g.tokens !== undefined) o.st = hiddenAnchor ? 'hidden' : g.st ?? null;
    if (g.gloss !== undefined) { if (typeof g.gloss !== 'boolean') E(`${gw}: gloss must be boolean`); o.gloss = g.gloss; }
    if (g.spread !== undefined) { if (typeof g.spread !== 'boolean') E(`${gw}: spread must be boolean`); o.spread = g.spread; }
    if (g.lit !== undefined) {
      o.lit = sel(g.lit, `${gw}.lit`);
      for (const id of o.lit) if (!o.tokens.includes(id)) E(`${gw}: lit ${id} is not in this group`);
    }
    if (g.pitch !== undefined) { if (!isInt(g.pitch) || g.pitch < 44 || g.pitch > 96) E(`${gw}: bad pitch ${g.pitch}`); o.pitch = g.pitch; }
    if (g.indent !== undefined) { if (!isInt(g.indent) || g.indent < 0) E(`${gw}: bad indent ${g.indent}`); o.indent = g.indent; }
    if (g.holes !== undefined) {
      if (!Array.isArray(g.holes)) E(`${gw}: holes must be an array`);
      else o.holes = g.holes.map((h, i) => {
        const hw = `${gw}.holes[${i}]`;
        if (!isObj(h)) { E(`${hw}: hole must be an object`); return null; }
        onlyKeys(h, ['after', 'for', 'em'], hw);
        if (!o.tokens.includes(h.after)) E(`${hw}: after ${h.after} is not in this group`);
        if ((h.for === undefined) === (h.em === undefined)) E(`${hw}: needs exactly one of for or em`);
        return h.for !== undefined ? { after: h.after, for: sel(h.for, `${hw}.for`) } : { after: h.after, em: h.em };
      }).filter(Boolean);
    }
    return o;
  }

  // ---- view
  function resolveView(v, S, w) {
    if (!isObj(v)) { E(`${w}: view must be an object`); return v; }
    if (!MODES.includes(v.mode)) { E(`${w}: unknown view mode "${v.mode}"`); return v; }
    const out = { mode: v.mode };
    const scopeOk = (sc) => {
      if (sc === 'all') return true;
      if (/^S[1-4]$/.test(sc)) return true;
      const m = /^(s[1-4]\.\d\d)\.\.(s[1-4]\.\d\d)$/.exec(sc || '');
      if (!m) return false;
      try { expandRange(table, m[1], m[2]); return true; } catch (e) { E(`${w}: ${e.message}`); return true; }
    };
    if (v.mode === 'full' || v.mode === 'line') {
      onlyKeys(v, v.mode === 'full' ? ['mode', 'scope'] : ['mode', 'scope', 'gloss', 'size'], w);
      if (v.scope !== undefined) { if (!scopeOk(v.scope)) E(`${w}: bad scope "${v.scope}"`); out.scope = v.scope; }
      if (v.gloss !== undefined) { if (typeof v.gloss !== 'boolean') E(`${w}: gloss must be boolean`); out.gloss = v.gloss; }
      if (v.size !== undefined) { if (!isInt(v.size) || v.size < 56 || v.size > 96) E(`${w}: bad size ${v.size}`); out.size = v.size; }
    } else if (v.mode === 'lift') {
      onlyKeys(v, ['mode', 'node', 'gloss', 'collapse'], w);
      if (!nodeOf(v.node || '')) E(`${w}: unknown lift node ${v.node}`);
      out.node = v.node;
      if (v.gloss !== undefined) out.gloss = v.gloss;
      if (v.collapse !== undefined) {
        if (!Array.isArray(v.collapse)) E(`${w}: collapse must be an array`);
        else for (const c of v.collapse) {
          if (!nodeOf(c)) E(`${w}: unknown collapse node ${c}`);
          else if (nodeOf(v.node) && !idx[c.split('.')[0]].isDescendant(c, v.node)) E(`${w}: collapse node ${c} is not inside ${v.node}`);
        }
        out.collapse = v.collapse;
      }
    } else if (v.mode === 'pair') {
      onlyKeys(v, ['mode', 'left', 'right'], w);
      Object.assign(out, resolvePair(v, w));
    } else if (v.mode === 'plate') {
      onlyKeys(v, ['mode', 'img', 'cite', 'tokens', 'caption'], w);
      if (typeof v.img !== 'string' || !v.img) E(`${w}: plate needs img`); else if (path.isAbsolute(v.img) || v.img.includes('..')) E(`${w}: img must be relative to assets/img/`);
      out.img = v.img;
      if (v.cite !== undefined) out.cite = citeKey(v.cite, `${w}.cite`);
      if (v.tokens !== undefined) out.tokens = sel(v.tokens, `${w}.tokens`);
      if (v.caption !== undefined) out.caption = R(v.caption, `${w}.caption`);
    } else if (v.mode === 'scene') {
      onlyKeys(v, ['mode', 'groups', 'depth', 'tags', 'pitch', 'lower'], w);
      if (!Array.isArray(v.groups) || !v.groups.length) { E(`${w}: scene needs groups`); return { ...out, groups: [], depth: 0 }; }
      out.groups = v.groups.map((g, n) => resolveGroup(g, n, w)).filter(Boolean);
      const seen = new Map(), lines = new Map();
      for (const g of out.groups) {
        for (const id of [...g.tokens, ...(g.reserve ?? [])]) {
          if (seen.has(id)) E(`${w}: ${id} is in two groups`);
          seen.set(id, g);
        }
        if (g.run !== null) {
          if (lines.has(g.base) && lines.get(g.base) !== g.size) E(`${w}: runs of ${g.base} differ in size`);
          lines.set(g.base, g.size);
        }
      }
      out.depth = v.depth ?? 0;
      if (!isInt(out.depth) || out.depth < 0) E(`${w}: bad depth ${out.depth}`);
      out.tags = v.tags ?? 'auto';
      if (!['auto', 'none'].includes(out.tags)) E(`${w}: tags must be auto or none`);
      if (v.pitch !== undefined) { if (!isInt(v.pitch) || v.pitch < 56 || v.pitch > 96) E(`${w}: bad pitch ${v.pitch}`); out.pitch = v.pitch; }
      if (v.lower !== undefined) {
        const lw = `${w}.lower`;
        if (!isObj(v.lower)) E(`${lw}: lower must be an object`);
        else { onlyKeys(v.lower, ['left', 'right'], lw); out.lower = resolvePair(v.lower, lw, true); }
      }
    } else if (v.mode === 'home') {
      onlyKeys(v, ['mode', 'sentences'], w);
      out.sentences = sentenceList(v.sentences ?? [], w);
    } else if (v.mode === 'final') {
      onlyKeys(v, ['mode'], w);
      out.sentences = ['S1', 'S2', 'S3', 'S4'];
    } else if (v.mode === 'skipped') {
      onlyKeys(v, ['mode', 'slide'], w);
      const sl = skipped?.slides?.[v.slide];
      if (!sl) { E(`${w}: no skipped slide ${v.slide}`); return { ...out, slide: v.slide, ids: [], turns: [] }; }
      const ids = skipRange(sl.tokens);
      Object.assign(out, { slide: v.slide, ids, turns: sl.en.map((t) => ({ speaker: t.speaker, ids: skipRange(t.tokens), text: t.text })) });
    }
    return out;
  }
  function sentenceList(list, w) {
    if (!Array.isArray(list) || list.some((x) => !/^S[1-4]$/.test(x))) { E(`${w}: sentences must list S1..S4`); return []; }
    return list;
  }
  const skipRange = ([a, z]) => { const ids = skipped.tokens.map((t) => t.id); return ids.slice(ids.indexOf(a), ids.indexOf(z) + 1); };
  function resolvePair(v, w, textOnly = false) {
    const out = {};
    for (const side of ['left', 'right']) {
      const s = v[side], sw = `${w}.${side}`;
      if (!isObj(s)) { E(`${sw}: missing`); continue; }
      onlyKeys(s, ['tokens', 'text', 'label', 'cite'], sw);
      if ((s.tokens === undefined) === (s.text === undefined)) E(`${sw}: needs exactly one of tokens or text`);
      if (textOnly && s.tokens !== undefined) E(`${sw}: a lower pair holds text only`);
      const o = {};
      if (s.tokens !== undefined) o.tokens = sel(s.tokens, `${sw}.tokens`);
      if (s.text !== undefined) o.text = R(s.text, `${sw}.text`);
      if (s.label !== undefined) o.label = R(s.label, `${sw}.label`);
      if (s.cite !== undefined) o.cite = citeKey(s.cite, `${sw}.cite`);
      out[side] = o;
    }
    return out;
  }
  /** Every token a view shows, sorted. */
  function viewIds(view) {
    switch (view.mode) {
      case 'full': case 'line': {
        const sc = view.scope ?? 'all';
        if (sc === 'all') return tokens.map((t) => t.id);
        if (/^S[1-4]$/.test(sc)) return table.sentenceIds(sc);
        const [a, b] = sc.split('..');
        try { return expandRange(table, a, b); } catch { return []; }
      }
      case 'lift': return nodeSpan(view.node ?? '') ?? [];
      case 'pair': return [...(view.left?.tokens ?? []), ...(view.right?.tokens ?? [])];
      case 'plate': return view.tokens ?? [];
      case 'scene': return view.groups.flatMap((g) => (g.plane === 'wings' || g.plane === 'home' || g.st === 'hidden' ? [] : g.tokens));
      case 'home': case 'final': return tokens.map((t) => t.id);
      case 'skipped': return view.ids ?? [];
      default: return [];
    }
  }

  // ---- marks
  /** selector string or list, 'en:slot', 'box:name', 'hole:token' -> { ref, ids } */
  function endOf(v, S, w) {
    if (typeof v === 'string' && v.startsWith('en:')) { const q = qualify(v.slice(3), S, w); return { ref: q ? `en:${q}` : v, ids: [], slot: q }; }
    if (typeof v === 'string' && v.startsWith('box:')) return { ref: v, ids: [], box: v.slice(4) };
    if (typeof v === 'string' && v.startsWith('hole:')) { if (!TOKEN_RE.test(v.slice(5)) || !table.has(v.slice(5))) E(`${w}: bad hole "${v}"`); return { ref: v, ids: [v.slice(5)] }; }
    const list = typeof v === 'string' ? [v] : v;
    if (!Array.isArray(list) || !list.length) { E(`${w}: endpoint missing`); return { ref: '', ids: [] }; }
    return { ref: list.join(','), ids: sel(list, w) };
  }
  const runsOf = (ids) => {
    const runs = [];
    for (const id of ids) {
      const last = runs[runs.length - 1];
      if (last && table.ord(id) === table.ord(last[1]) + 1) last[1] = id; else runs.push([id, id]);
    }
    return runs;
  };
  const typeOk = (t, w) => { if (t !== undefined && !TYPES.includes(t)) E(`${w}: unknown type "${t}"`); return t; };
  const COMMON = ['key', 'alpha', 'seq', 'tag'];
  function common(m, w, o) {
    if (typeof m.key !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(m.key)) E(`${w}: mark needs a key`);
    o.key = m.key;
    if (m.alpha !== undefined) { if (!(m.alpha > 0 && m.alpha <= 1)) E(`${w}: bad alpha`); o.alpha = m.alpha; }
    if (m.seq !== undefined) { if (!isInt(m.seq)) E(`${w}: bad seq`); o.seq = m.seq; }
    if (m.tag !== undefined) o.tag = R(m.tag, `${w}.tag`);
    return o;
  }
  function resolveMark(m, S, w) {
    if (!isObj(m)) { E(`${w}: mark must be an object`); return null; }
    if (m.rel !== undefined) return resolveRel(m, S, w);
    switch (m.k) {
      case 'bracket': {
        onlyKeys(m, [...COMMON, 'k', 'node', 'tokens', 'box', 'en', 'type', 'label', 'tie', 'closer', 'lid'], w);
        const o = common(m, w, { k: 'bracket' });
        if ([m.node, m.tokens, m.box, m.en].filter((x) => x !== undefined).length !== 1) { E(`${w}: bracket needs exactly one of node, tokens, box, en`); return o; }
        if (m.label !== undefined) o.label = R(m.label, `${w}.label`);
        if (m.tie !== undefined) o.tie = R(m.tie, `${w}.tie`);
        if (m.lid !== undefined) o.lid = R(m.lid, `${w}.lid`);
        if (m.closer !== undefined) { if (!table.has(m.closer)) E(`${w}: unknown closer ${m.closer}`); o.closer = m.closer; }
        o.type = typeOk(m.type, w) ?? 'neutral';
        if (m.node !== undefined) {
          const n = NODE_RE.test(m.node) ? nodeOf(m.node) : null;
          if (!n) { E(`${w}: unknown node ${m.node}`); return o; }
          o.node = m.node; o.ids = nodeSpan(m.node); o.runs = runsOf(o.ids); o.type = typeOk(m.type, w) ?? n.type;
        } else if (m.tokens !== undefined) {
          o.node = (Array.isArray(m.tokens) ? m.tokens : [m.tokens]).join(','); o.ids = sel(Array.isArray(m.tokens) ? m.tokens : [m.tokens], `${w}.tokens`); o.runs = runsOf(o.ids);
        } else if (m.box !== undefined) {
          o.box = m.box; o.open = true; o.node = `box:${m.box}`; o.ids = [];
        } else { o.en = qualify(m.en, S, w); o.ids = []; }
        if (o.tag === undefined && (o.label ?? o.lid) !== undefined) o.tag = o.label ?? o.lid;
        return o;
      }
      case 'encompass': {
        onlyKeys(m, [...COMMON, 'k', 'left', 'right'], w);
        return common(m, w, { k: 'encompass', left: sel(m.left, `${w}.left`), right: sel(m.right, `${w}.right`) });
      }
      case 'tag': {
        onlyKeys(m, [...COMMON, 'k', 'at', 'type', 'text', 'under', 'size'], w);
        const end = endOf(m.at, S, `${w}.at`);
        const o = common(m, w, { k: 'tag', at: end.ref, atIds: end.ids, text: R(m.text, `${w}.text`), type: typeOk(m.type, w) ?? 'neutral' });
        if (end.slot) o.slot = end.slot;
        if (m.under !== undefined) o.under = !!m.under;
        if (m.size !== undefined) o.size = m.size;
        return o;
      }
      case 'supplies': {
        onlyKeys(m, [...COMMON, 'k', 'slot', 'text'], w);
        const text = R(m.text, `${w}.text`);
        if (typeof text !== 'string' || !/^\[.*\]$/.test(text)) E(`${w}: supplies text must be in square brackets`);
        return common(m, w, { k: 'supplies', slot: qualify(m.slot, S, w), text });
      }
      case 'candidate': {
        onlyKeys(m, [...COMMON, 'k', 'from', 'to', 'label', 'failed', 'via'], w);
        const f = endOf(m.from, S, `${w}.from`), t = endOf(m.to, S, `${w}.to`);
        const o = common(m, w, { k: 'arrow', rel: 'candidate', from: f.ref, to: t.ref, fromIds: f.ids, toIds: t.ids, rank: 3, label: R(m.label ?? '?', `${w}.label`) });
        if (m.failed) o.failed = true;
        return o;
      }
      case 'gap': {
        onlyKeys(m, [...COMMON, 'k', 'from', 'to', 'line'], w);
        if (!LINE_KINDS.includes(m.line)) E(`${w}: gap line must be double or dotted`);
        const f = endOf(m.from, S, `${w}.from`), t = endOf(m.to, S, `${w}.to`);
        return common(m, w, { k: 'gap', from: f.ref, to: t.ref, fromIds: f.ids, toIds: t.ids, line: m.line });
      }
      case 'note': {
        onlyKeys(m, [...COMMON, 'k', 'at', 'text'], w);
        if (!anchorOf(m.at, `${w}.at`)) return null;
        return common(m, w, { k: 'note', at: m.at, text: R(m.text, `${w}.text`) });
      }
      default: E(`${w}: unknown mark kind "${m.k}"`); return null;
    }
  }
  function resolveRel(m, S, w) {
    const form = RELS[m.rel];
    if (!form) { E(`${w}: unknown rel "${m.rel}"`); return null; }
    const allow = [...COMMON, 'rel', 'rank', 'label', 'type', 'via', 'arc', 'dock', 'failed', 'spine', 'sa', 'sb', 'hook', 'at', form.dir ? 'from' : 'a', form.dir ? 'to' : 'b'];
    onlyKeys(m, allow, w);
    const o = common(m, w, { k: 'arrow', rel: m.rel, rank: m.rank ?? 3 });
    if (![1, 2, 3].includes(o.rank)) E(`${w}: rank must be 1, 2 or 3`);
    if (m.label !== undefined) o.label = R(m.label, `${w}.label`);
    if (m.type !== undefined) o.type = typeOk(m.type, w);
    if (m.spine) {
      if (!form.spine) E(`${w}: ${m.rel} has no slot tie`);
      if (!S) E(`${w}: a spine mark needs a current sentence`);
      const slotIn = (name, n) => {
        const bare = typeof name === 'string' ? name.replace(/^S[1-4]\./, '') : '';
        const ok = S && en[S]?.slots?.some((s) => s.id === bare) && (name === bare || name === `${S}.${bare}`);
        if (!ok) E(`${w}: spine ${n} "${name}" is not a slot of ${S ?? 'the current sentence'}`);
        return ok ? `${S}.${bare}` : null;
      };
      o.spine = true; o.sa = slotIn(m.sa, 'sa'); o.sb = slotIn(m.sb, 'sb');
      o.from = `en:${o.sa}`; o.to = `en:${o.sb}`; o.fromIds = []; o.toIds = [];
      return o;
    }
    if (m.sa !== undefined || m.sb !== undefined) E(`${w}: sa and sb go with spine:true`);
    const f = endOf(form.dir ? m.from : m.a, S, `${w}.${form.dir ? 'from' : 'a'}`);
    o.from = f.ref; o.fromIds = f.ids;
    if (m.hook) { if ((form.dir ? m.to : m.b) !== undefined) E(`${w}: hook means no target`); o.hook = true; o.to = null; o.toIds = []; }
    else { const t = endOf(form.dir ? m.to : m.b, S, `${w}.${form.dir ? 'to' : 'b'}`); o.to = t.ref; o.toIds = t.ids; }
    if (m.via !== undefined) { if (!VIA.includes(m.via)) E(`${w}: bad via "${m.via}"`); o.via = m.via; }
    if (m.arc !== undefined) { if (!['low', 'high'].includes(m.arc)) E(`${w}: arc must be low or high`); o.arc = m.arc; }
    if (m.dock !== undefined) { if (!table.has(m.dock)) E(`${w}: unknown dock ${m.dock}`); o.dock = m.dock; }
    if (m.at !== undefined) { if (m.rel !== 'connects' || !table.has(m.at)) E(`${w}: at names the coordinator of a connects tie`); o.at = m.at; }
    if (m.failed) { if (m.rel !== 'agrees') E(`${w}: failed goes with agrees`); o.failed = true; }
    return o;
  }

  // ---- steps
  const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  const sentenceCount = (s) => (s.replace(/\{[^}]*\}/g, 'X').match(/[.!?](?=\s+[A-Z“"‘']|\s*$)/g) || []).length || 1;
  const out = [], seenIds = new Set(), compiledFiles = [], rowMore = {}, rowCount = new Map();
  // Carried across files: English, each word's state, what has been rowed, the live marks, constructions met.
  const carry = { en: {}, open: {}, st: {}, rowed: new Set(), live: new Map(), met: new Set() };
  for (const file of stepFiles(ctx)) {
    const fp = path.join(ctx.stepsDir, `${file}.mjs`);
    if (!existsSync(fp)) { if (ctx.stub || OPTIONAL.has(file)) continue; E(`src/steps/${file}.mjs is missing`); continue; }
    compiledFiles.push(file);
    const src = readFileSync(fp, 'utf8');
    const g = [...src].find(c => GREEK.test(c));
    if (g) E(`${file}.mjs: Greek literal (${g}); use {id} references`);
    if (/^\s*import\s|\bimport\s*\(|\brequire\s*\(/m.test(src.replace(/\/\/.*$/gm, ''))) E(`${file}.mjs: step files may not import anything`);
    let steps;
    try { steps = (await import(pathToFileURL(fp).href)).default; } catch (e) { E(`${file}.mjs: cannot load (${e.message})`); continue; }
    if (!Array.isArray(steps)) { E(`${file}.mjs: default export must be an array`); continue; }
    let prev = { view: null, depth: 0, tree: [], world: 'rest', spine: 'slots' }, lastOrd = null;
    steps.forEach((s, si) => {
      const w = `${file}.mjs[${si}]${s?.id ? ' ' + s.id : ''}`;
      if (!isObj(s)) { E(`${w}: step must be an object`); return; }
      for (const k of Object.keys(s)) if (!KEYS.includes(k)) E(`${w}: unknown key "${k}"${RETIRED[k] ? ` (${RETIRED[k]})` : ''}`);
      // id
      const prefix = typeof s.id === 'string' ? s.id.split('-')[0] : '';
      const fileKey = ctx.probe ? (FILE_OF[prefix] ?? prefix) : file;
      const S = fileToSentence(fileKey);
      if (typeof s.id !== 'string' || !ID_RE.test(s.id)) E(`${w}: malformed id "${s.id}"`);
      else {
        if (!ctx.probe && !s.id.startsWith(filePrefix(file) + '-')) E(`${w}: id prefix does not match ${file}.mjs`);
        if (seenIds.has(s.id)) E(`${w}: duplicate id ${s.id}`);
        seenIds.add(s.id);
        const ordKey = s.id.slice(s.id.indexOf('-') + 1).padEnd(3, ' ');
        if (!ctx.probe && lastOrd !== null && ordKey <= lastOrd) E(`${w}: id out of file order`);
        lastOrd = ordKey;
      }
      // head
      let head = null;
      if (typeof s.head !== 'string' || !s.head.trim()) E(`${w}: head required`);
      else { head = R(s.head, `${w}.head`); if (wordCount(head) > 6) E(`${w}: head over 6 words ("${head}")`); }
      const sub = s.sub != null ? R(s.sub, `${w}.sub`) : null;

      // carried state
      if (s.view !== undefined && !isObj(s.view)) E(`${w}: view must be an object`);
      const cur = { view: s.view !== undefined ? resolveView(s.view, S, `${w}.view`) : prev.view, depth: prev.depth, tree: prev.tree, world: s.world ?? prev.world, spine: s.spine ?? prev.spine };
      if (!cur.view) { E(`${w}: first step of ${file}.mjs must set view`); cur.view = { mode: 'full' }; }
      const mode = cur.view.mode;
      if (s.depth !== undefined && mode !== 'lift') E(`${w}: depth belongs in view on a scene, and nowhere else outside lift`);
      cur.depth = mode === 'lift' ? s.depth ?? prev.depth : mode === 'scene' ? cur.view.depth ?? 0 : 0;
      if (!isInt(cur.depth) || cur.depth < 0) E(`${w}: bad depth ${cur.depth}`);
      if (!SPINE.includes(cur.spine)) E(`${w}: spine must be ${SPINE.join(' or ')}`);
      if (s.en !== undefined) {
        if (!isObj(s.en)) E(`${w}: en must be an object`);
        else for (const [slot, val] of Object.entries(s.en)) {
          const q = qualify(slot, S, `${w}.en.${slot}`); if (!q) continue;
          if (isInt(val)) {
            const st = slotOf(q)?.stages;
            if (!Array.isArray(st)) { E(`${w}.en.${slot}: stage ${val} but slot ${q} has no stages in data/en`); continue; }
            if (val < 0 || val >= st.length) { E(`${w}.en.${slot}: stage ${val} is outside 0..${st.length - 1}`); continue; }
          } else if (!EN_STATES.includes(val)) { E(`${w}.en.${slot}: value must be ${EN_STATES.join('|')} or a stage index`); continue; }
          carry.en[q] = val;
        }
      }
      if (s.open !== undefined) {
        if (!isObj(s.open)) E(`${w}: open must be an object`);
        else for (const [id, val] of Object.entries(s.open)) {
          const ow = `${w}.open.${id}`;
          if (!TOKEN_RE.test(id) || !table.has(id)) { E(`${ow}: unknown token`); continue; }
          if (!parseRow.get(id)?.features?.case) { E(`${ow}: the parse row holds no case to replace`); continue; }
          if (val === null) delete carry.open[id];
          else if (typeof val !== 'string' || !val.trim()) E(`${ow}: value must be the text to print, or null`);
          else carry.open[id] = val;
        }
      }
      if (s.tree !== undefined) {
        if (!Array.isArray(s.tree)) E(`${w}: tree must be an array`);
        else { cur.tree = s.tree; for (const n of s.tree) if (!NODE_RE.test(n) || !nodeOf(n)) E(`${w}: unknown tree node ${n}`); }
      }
      if (!WORLDS.includes(cur.world)) E(`${w}: unknown world "${cur.world}"`);
      if (mode === 'lift' && cur.view.node && nodeOf(cur.view.node)) {
        const d = nodeDepth(cur.view.node);
        if (cur.depth !== d) E(`${w}: depth ${cur.depth} differs from tree depth ${d} of ${cur.view.node}`);
      }
      // A home view colours finished sentences for that view only; the carried tree stays as it was.
      const tree = mode === 'home' || mode === 'final'
        ? [...new Set([...cur.tree, ...cur.view.sentences.flatMap((x) => [...(idx[x]?.byId.keys() ?? [])])])] : cur.tree;
      for (const n of tree) { const t = nodeOf(n)?.type; if (t && t !== 'neutral') carry.met.add(t); }

      // rows, on stage at most 3; a compact pair counts as one
      const rows = [], list = [];
      let rowTotal = 0, reasonParts = [];
      if (s.rows !== undefined) {
        if (!Array.isArray(s.rows)) E(`${w}: rows must be an array`);
        else s.rows.forEach((r, n) => {
          const rw = `${w}.rows[${n}]`;
          if (!isObj(r)) { E(`${rw}: row must be an object`); return; }
          onlyKeys(r, ['ids', 'pair', 'restate', 'basis', 'reason', 'more'], rw);
          const ids = sel(r.ids, `${rw}.ids`);
          if (!ids.length) E(`${rw}: ids required`);
          if (r.pair && ids.length !== 2) E(`${rw}: a compact pair holds exactly 2 ids`);
          rowTotal += r.pair ? 1 : ids.length;
          const basis = {};
          for (const id of ids) {
            const pr = parseRow.get(id);
            if (!pr) { E(`${rw}: ${id} has no parse row`); continue; }
            basis[id] = pr.basis?.via ?? null;
            if (r.basis !== undefined && r.basis !== basis[id]) E(`${rw}: basis "${r.basis}" for ${id}, whose parse rests on "${basis[id]}"`);
            if (!r.restate) { rowCount.set(id, (rowCount.get(id) ?? 0) + 1); carry.rowed.add(id); }
            list.push(id);
          }
          const text = r.reason != null ? R(r.reason, `${rw}.reason`) : ids.map((id) => parseRow.get(id)?.reason).filter(Boolean).map((x) => R(x, `${rw}.reason`)).join(' ');
          if (text) reasonParts.push(text);
          if (r.more !== undefined) {
            if (!Array.isArray(r.more) || r.more.length > 5) E(`${rw}: more is an array of at most 5`);
            else (rowMore[ids[0]] ??= []).push(...r.more.map((b, i) => R(b, `${rw}.more[${i}]`)));
          }
          rows.push({ ids, pair: !!r.pair, restate: !!r.restate, basis });
        });
      }
      if (rowTotal > 3) E(`${w}: rows hold ${rowTotal} (max 3; a compact pair counts as one)`);
      if (s.reason != null) { if (typeof s.reason !== 'string') E(`${w}: reason must be a string`); else reasonParts.push(R(s.reason, `${w}.reason`)); }
      const reason = reasonParts.join(' ') || null;
      if (chars(reason) > 400) E(`${w}: reason has ${chars(reason)} characters (max 400 per press)`);

      // word states. A word rowed on this very press may go to the margin as done.
      const st = {}, focus = [], wings = [], plane = {}, tags = {};
      const visible = viewIds(cur.view);
      if (mode === 'scene') {
        for (const g of cur.view.groups) {
          if (g.plane === 'wings') wings.push(...g.tokens);
          if (g.st === 'hidden' || g.plane === 'wings' || g.plane === 'home') continue;
          for (const id of g.tokens) {
            const lit = g.lit?.includes(id);
            const base = g.st ?? carry.st[id] ?? 'fresh';
            if (base === 'done' && !ctx.probe && !carry.rowed.has(id)) E(`${w}: ${id} is done but no step up to here rowed it`);
            st[id] = lit ? 'lit' : base;
            carry.st[id] = base;
            plane[id] = g.plane;
            if (lit) focus.push(id);
            if (g.plane === 0 && cur.view.tags === 'auto') { const form = st[id] === 'lit' ? 'full' : st[id] === 'tagged' ? 'short' : null; if (form) tags[id] = form; }
          }
        }
      } else {
        const coloured = new Set(mode === 'home' || mode === 'final' ? cur.view.sentences : []);
        for (const id of visible) { const v = coloured.has(table.sentenceOf(id)) ? 'tagged' : carry.st[id] ?? 'fresh'; st[id] = v; carry.st[id] = v; }
      }
      const shown = new Set(Object.keys(st));
      for (const id of list) if (!shown.has(id)) E(`${w}: row for ${id}, which is not on stage`);
      const parsed = [...carry.rowed].sort((a, b) => table.ord(a) - table.ord(b));

      // marks: an omitted keep keeps everything, except that home, final and skipped views start clean
      const mw = `${w}.marks`;
      if (s.marks !== undefined && (!isObj(s.marks) || Array.isArray(s.marks))) E(`${mw}: marks must be { keep, add }`);
      const mk = isObj(s.marks) ? s.marks : {};
      if (isObj(s.marks)) onlyKeys(s.marks, ['keep', 'add'], mw);
      const before = carry.live;
      const clean = mode === 'home' || mode === 'final' || mode === 'skipped';
      const keepKeys = mk.keep ?? (clean ? [] : [...before.keys()]);
      if (!Array.isArray(keepKeys)) E(`${mw}.keep must be an array`);
      const next = new Map();
      for (const key of Array.isArray(keepKeys) ? keepKeys : []) {
        if (typeof key !== 'string') { E(`${mw}.keep: key must be a string`); continue; }
        if (next.has(key)) { E(`${mw}.keep: ${key} twice`); continue; }
        const held = before.get(key);
        if (held) next.set(key, held);
        else if (ctx.probe) warns.push(`${w}: keep key ${key} has no definition in this sample; left out`);
        else E(`${mw}.keep: ${key} was neither kept nor added by the previous step`);
      }
      const kept = new Set(next.keys()), added = [];
      if (mk.add !== undefined && !Array.isArray(mk.add)) E(`${mw}.add must be an array`);
      (Array.isArray(mk.add) ? mk.add : []).forEach((m, n) => {
        const def = resolveMark(m, S, `${mw}.add[${n}]`);
        if (!def) return;
        if (kept.has(def.key)) { E(`${mw}.add[${n}]: ${def.key} is also in keep`); return; }
        if (added.includes(def.key)) { E(`${mw}.add[${n}]: ${def.key} twice`); return; }
        const was = before.get(def.key);
        def.rev = was ? was.rev + (JSON.stringify({ ...was, rev: 0 }) === JSON.stringify({ ...def, rev: 0 }) ? 0 : 1) : 0;
        next.set(def.key, def); added.push(def.key);
      });
      carry.live = next;
      if (mode === 'skipped' && next.size) E(`${w}: the skipped words carry no marks`);
      const boxes = new Set(mode === 'scene' ? cur.view.groups.map((g) => g.box).filter(Boolean) : []);
      const slotOn = (q) => (carry.en[q] ?? 'off') !== 'off';
      const endVisible = (ids, ref) => ref == null ? true
        : ref.startsWith('box:') ? boxes.has(ref.slice(4))
        : ref.startsWith('en:') ? slotOn(ref.slice(3))
        : ids.some((id) => shown.has(id));
      const dress = (def) => {
        const o = { ...def };
        if (def.k === 'arrow' && def.rel !== undefined && !def.spine) {
          const tail = def.fromIds?.[0];
          o.type = def.type ?? (tail ? typeOfToken(tail, tree) : null) ?? 'neutral';
          const all = [...(def.fromIds ?? []), ...(def.toIds ?? [])];
          o.layer = all.length && all.every((id) => (plane[id] ?? 0) >= 1) ? 'back' : 'front';
        } else if (def.k === 'arrow') { o.type = def.type ?? 'neutral'; o.layer = 'spine'; }
        else o.layer = def.k === 'encompass' ? 'back' : 'front';
        o.dormant = !(def.k === 'arrow' || def.k === 'gap' ? endVisible(def.fromIds, def.from) && endVisible(def.toIds, def.to)
          : def.k === 'bracket' ? (def.box ? boxes.has(def.box) : def.en ? slotOn(def.en) : def.runs.every(([a, b]) => expandRange(table, a, b).some((id) => shown.has(id))))
          : def.k === 'encompass' ? def.left.some((id) => shown.has(id)) && def.right.some((id) => shown.has(id))
          : def.k === 'tag' ? (def.slot ? slotOn(def.slot) : def.atIds.some((id) => shown.has(id)))
          : def.k === 'supplies' ? slotOn(def.slot) : true);
        return o;
      };
      const marks = { keep: [...kept].map((k) => dress(next.get(k))), add: added.map((k) => dress(next.get(k))) };

      // sources
      let rail = [];
      if (s.rail !== undefined) { if (!Array.isArray(s.rail)) E(`${w}: rail must be an array`); else rail = s.rail.map((k, i) => citeKey(k, `${w}.rail[${i}]`)); }
      if (rail.length > 2) E(`${w}: rail has ${rail.length} keys (max 2)`);
      let extra = [];
      if (s.cite !== undefined) { if (!Array.isArray(s.cite)) E(`${w}: cite must be an array`); else extra = s.cite.map((k, i) => citeKey(k, `${w}.cite[${i}]`)); }
      const callouts = [];
      if (s.callouts !== undefined) {
        if (!Array.isArray(s.callouts)) E(`${w}: callouts must be an array`);
        else s.callouts.forEach((c, n) => {
          const cw = `${w}.callouts[${n}]`;
          if (!isObj(c)) { E(`${cw}: callout must be an object`); return; }
          onlyKeys(c, ['key', 'kind', 'at', 'text', 'locus'], cw);
          if (!KINDS.includes(c.kind)) E(`${cw}: unknown kind "${c.kind}"`);
          citeKey(c.key, cw);
          const entry = passage.find((p) => p.key === c.key);
          const words = [...list, ...focus];
          const at = c.at ?? words.find((id) => entry && parseRow.get(id)?.lemma === entry.lemma) ?? focus[focus.length - 1] ?? list[list.length - 1];
          if (!at || !table.has(at)) E(`${cw}: no word to stand beside`);
          else if (!shown.has(at)) E(`${cw}: ${at} is not on stage`);
          const o = { kind: c.kind, key: c.key, at };
          if (c.kind === 'cites-passage') {
            if (cites[c.key]?.source !== 'LSJ') E(`${cw}: cites-passage needs an LSJ row`);
            const locus = c.locus ?? entry?.locus;
            if (!locus) E(`${cw}: ${c.key} is not in lsj-passage.json and names no locus`);
            o.locus = locus; o.text = `LSJ cites this line · ${locus}`;
          } else { if (typeof c.text !== 'string') E(`${cw}: text required`); else o.text = R(c.text, `${cw}.text`); }
          callouts.push(o);
        });
      }
      if (callouts.filter((c) => c.kind === 'cites-passage').length > 1) E(`${w}: more than one cites-passage callout`);
      let derive = null;
      if (s.derive != null) {
        const d = s.derive;
        if (!isObj(d)) E(`${w}: derive must be an object`);
        else {
          onlyKeys(d, ['form', 'fact', 'move', 'limit', 'cite'], `${w}.derive`);
          for (const k of ['form', 'fact', 'move', 'limit', 'cite']) if (typeof d[k] !== 'string' || !d[k].trim()) E(`${w}.derive: ${k} required`);
          citeKey(d.cite, `${w}.derive`);
          const c = cites[d.cite];
          derive = { form: R(d.form, `${w}.derive.form`), fact: R(d.fact, `${w}.derive.fact`), move: R(d.move, `${w}.derive.move`),
            page: c?.ref?.page ?? null, ref: c?.ref?.display ?? c?.label ?? null, limit: R(d.limit, `${w}.derive.limit`), cite: d.cite, grade: c?.grade ?? null };
        }
      }
      const lsj = callouts.find((c) => c.kind === 'cites-passage') ?? null;
      const callout = lsj ? { kind: 'lsj-here', cite: lsj.key, at: lsj.at, text: lsj.text } : null;
      const cite = [...new Set([...rail, ...callouts.map((c) => c.key), ...extra, ...(derive ? [derive.cite] : [])])];

      // presenter
      let why = null;
      if (s.why != null) {
        if (typeof s.why !== 'string') E(`${w}: why must be a string`);
        else {
          why = R(s.why, `${w}.why`);
          if (wordCount(why) > 45) E(`${w}: why has ${wordCount(why)} words (max 45)`);
          if (sentenceCount(s.why) > 2) E(`${w}: why has more than 2 sentences`);
        }
      }
      let more = [];
      if (s.more !== undefined) {
        if (!Array.isArray(s.more)) E(`${w}: more must be an array`);
        else { more = s.more.map((b, i) => R(b, `${w}.more[${i}]`)); if (more.length > 5) E(`${w}: more has ${more.length} bullets (max 5)`); }
      }
      let cue = null;
      if (s.cue != null) {
        if (typeof s.cue !== 'string') E(`${w}: cue must be a string`);
        else { cue = R(s.cue, `${w}.cue`); if (wordCount(cue) > 20) E(`${w}: cue has ${wordCount(cue)} words (max 20)`); }
      }
      let notes = [];
      if (s.notes !== undefined) {
        if (!Array.isArray(s.notes)) E(`${w}: notes must be an array`);
        else { notes = s.notes.map((b, i) => R(b, `${w}.notes[${i}]`)); }
      }
      if (mode === 'skipped' && (rows.length || callouts.length || derive || rail.length)) E(`${w}: the skipped words are not parsed: no rows, rail, callouts or derive`);

      const spineShown = S && !['home', 'final', 'skipped'].includes(mode) && Object.keys(carry.en).some((q) => q.startsWith(`${S}.`) && carry.en[q] !== 'off');
      out.push({ i: out.length, id: s.id, file: fileKey, sentence: S, head, sub, view: cur.view, depth: cur.depth, en: { ...carry.en }, open: { ...carry.open }, spine: spineShown ? cur.spine : 'off',
        tree, world: cur.world, st, tags, focus, wings, parsed, met: [...carry.met], marks, rows, list, reason, rail, callouts, callout, derive, cite, card: null, cue, notes, why, more });
      prev = cur;
    });
  }
  if (!out.length && !errs.length) E('no steps compiled');

  // ---- whole-deck coverage: a probe is a sample, so these do not apply to it
  if (!ctx.probe && out.length) {
    for (const S of ctx.sentences) for (const id of table.sentenceIds(S)) {
      const n = rowCount.get(id) ?? 0;
      if (n !== 1) E(`${id}: in ${n} rows entries, expected exactly 1`);
    }
  }
  const meta = { scope: ctx.scope, built: new Date().toISOString(), count: out.length, files: compiledFiles };
  return { steps: { meta, steps: out }, errs, warns, locked: { tokens, gap, table }, idx, en, cites, skipped, rowMore };
}

/** data/gap/skipped.json (optional), checked: words x.01.. in order, NFC, slides and turns in range. */
export function loadSkipped(ctx, errs) {
  const f = ctx.P('data/gap/skipped.json');
  if (!existsSync(f)) return null;
  const j = readJson(f, errs, ctx.rel(f));
  if (!j) return null;
  const ids = (j.tokens ?? []).map((t) => t.id);
  if (j.count != null && j.count !== ids.length) errs.push(`${ctx.rel(f)}: count ${j.count} but ${ids.length} words`);
  ids.forEach((id, i) => { if (id !== `x.${String(i + 1).padStart(2, '0')}`) errs.push(`${ctx.rel(f)}: word ${i + 1} is ${id}`); });
  for (const t of j.tokens ?? []) if (t.text !== t.text.normalize('NFC') || t.post !== t.post.normalize('NFC')) errs.push(`${t.id}: not NFC`);
  for (const s of j.slides ?? []) for (const r of [s.tokens, ...s.en.map((e) => e.tokens)]) if (!ids.includes(r[0]) || !ids.includes(r[1])) errs.push(`${ctx.rel(f)}: bad range ${r}`);
  return j;
}

export function outPath(ctx) { return ctx.val('--out') ? path.resolve(process.cwd(), ctx.val('--out')) : ctx.P('build', `steps${ctx.suffix}.json`); }
export function writeSteps(ctx, steps, file = outPath(ctx)) {
  const f = file; mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(steps, null, 1) + '\n'); return f;
}

if (isMain(import.meta.url)) {
  const ctx = probeCtx(makeCtx());
  const r = await compile(ctx);
  const code = report('compile', r.errs, r.warns, ctx.strict);
  if (!code) { const f = writeSteps(ctx, r.steps); console.log(`${ctx.rel(f)}  ${r.steps.steps.length} steps`); }
  process.exit(code);
}
