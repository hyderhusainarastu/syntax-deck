// Pure stage geometry. No DOM, clock, globals or randomness.
// Measured widths and the static document index arrive in `box`: box = { k, W, H, widths, gw, tw, idx }.
// `idx` comes from buildIndex(data), since layout(state, box) has no other route to the tree.

export const LINE = 1.2;              // line box of a .tk, in em. stage.mjs writes the same value to the spans
export const BASE = 0.965;            // line-box top to baseline, em
export const INK_T = 0.10;            // line-box top to highest ink of any word, em
export const INK_B = 1.215;           // line-box top to lowest ink, em: below the box
export const GLOSS_SIZE = 26;         // the English above the word; `gw` is the wider of its two lines, in these em
export const POS_SIZE = 22;           // the part of speech, beneath the English and above the word
export const GLOSS_STACK = 54;        // height of those two lines
export const TAG_SIZE = 28;
export const PERSPECTIVE = 1600;
export const PLANES = [0, -360, -720];
export const Z_HOME = -1600, Z_WINGS = -200;
// Repeats panels.css. QA compares the two.
export const ZONE_VARS = { yRibbon: 96, ySpine: 596, yLedger: 746, yReason: 888, yEnd: 1056, xEdge: 48, xReasonR: 1230, xRail: 1290, xRailR: 1872, spinePitch: 46, spineW: 1824 };

const WORD = 0.3;                     // word gap, em
const TK_TAIL = 0.22;                 // span box past the measured word, em
const WORD_MIN = 0.2;                 // tightest word gap, only on a line that would otherwise pass its anchor's right edge
const GLOSS_GUTTER = 12;              // least space between two neighbouring gloss stacks
const STACK_CLEAR = 1;                // gloss stack to the highest ink of the word
const ROOM = 12;                      // between lines, for brackets
const FOCUS = { lo: 56, hi: 96, padT: 56, padB: 8 };
const FULL = { lo: 38, hi: 48, padT: 20, padB: 12 };
const PARENT_FLOOR = 24;
const PARENT_LINE = 1.25;
const EDGE = ZONE_VARS.xEdge;         // content width is W - 96, centred
const ZONE_EN = ZONE_VARS.ySpine, ZONE_LOWER = ZONE_VARS.yLedger, RIBBON = ZONE_VARS.yRibbon, PARENTS = 180;
const HOME = { size: 38, width: ZONE_VARS.spineW, top: 102.4, pitch: 61 };   // one layout at every viewport
const STAGE = { x: EDGE, y: RIBBON, w: ZONE_VARS.spineW, h: ZONE_LOWER - RIBBON };   // the sentence stage
const FLOOR = { 0: 56, 1: 44, 2: 44 };
const TAG_GAP = 3, TAG_GUTTER = 24, TAG_LINE = TAG_SIZE * 1.14;
const ROW_STEP = 4, ROW_GAP = 6, ROW_SLACK = 6;     // ROW_SLACK: line boxes sharing this little still have clear letters
const SKIP = { size: 56, x: 240, w: 1484, y: 116, pitch: 72, turn: 14 };
const BOARDS = { x: 48, right: 1872, y: 300, bottom: 596, inkEnd: 582 };   // inkEnd: the lowest ink of a board line, clear of the English strip
// Stacked sentences: the gap sentence, then the last sentence, each a block of its own lines, so each reads as a sentence.
// The pitch leaves a chip's height between lines. The sizes are set here: a group's `size` on these anchors does not apply.
const STACK = { x: 48, w: 1824, top: { size: 54, y: 110, pitch: 70 }, bot: { size: 64, y: 300, pitch: 120 } };
// A whole sentence alone on the boards. Five lines with stacks need 590 px of the 500 above the spine, four need 468.
const WHOLE = { top: 148, pitch: 124, lines: 4 };

export const project = (z) => PERSPECTIVE / (PERSPECTIVE - z);

/** Static index of the document. Pure; built once from __DATA__. */
export function buildIndex(data) {
  const main = data.tokens.map((t) => t.id);
  const extras = [...(data.gap?.gapSentence ?? []), ...(data.gap?.variant ? [data.gap.variant] : []), ...(data.skipped?.tokens ?? [])].map((t) => t.id);
  const ids = [...main, ...extras];
  const order = Object.fromEntries(ids.map((id, n) => [id, n]));
  const sentences = {};
  for (const t of data.tokens) (sentences[`S${t.s}`] ??= []).push(t.id);

  const nodes = {}, nodeOf = {};
  for (const tree of Object.values(data.tree ?? {})) {
    for (const n of tree.nodes) {
      nodes[n.id] = { id: n.id, type: n.type, parent: n.parent ?? null, own: n.tokens, kids: [], depth: 0, span: [] };
      for (const id of n.tokens) nodeOf[id] = n.id;
    }
  }
  for (const n of Object.values(nodes)) if (n.parent && nodes[n.parent]) nodes[n.parent].kids.push(n.id);
  const spanOf = (n, depth) => {
    n.depth = depth;
    const all = [...n.own];
    for (const k of n.kids) all.push(...spanOf(nodes[k], depth + 1));
    n.span = all.sort((a, b) => order[a] - order[b]);
    return n.span;
  };
  for (const n of Object.values(nodes)) if (!n.parent) spanOf(n, 0);
  return { main, extras, ids, order, sentences, nodes, nodeOf };
}

/** Expand a `view.scope`: 'all', 'SN', or a range 'a..b'. */
function scopeIds(scope, idx) {
  if (!scope || scope === 'all') return idx.main;
  if (idx.sentences[scope]) return idx.sentences[scope];
  const m = /^(.+)\.\.(.+)$/.exec(scope);
  if (m && m[1] in idx.order && m[2] in idx.order) return idx.ids.slice(idx.order[m[1]], idx.order[m[2]] + 1);
  return idx.main;
}

/** For W above 1920 every x gains this. H above 1080 goes to the ledger. */
const shift = (box) => (box.W - 1920) / 2;

/** Room a line needs above its line box for the gloss stack. The stack may start inside the box, above the ink. */
const glossRise = (size) => Math.max(0, GLOSS_STACK + STACK_CLEAR - INK_T * size);
const glossY = (top, size) => top + INK_T * size - STACK_CLEAR - GLOSS_STACK;

const cellW = (it, size, box, gloss) => {
  if (it.id) {
    const w = (box.widths[it.id] ?? 0) * size;
    return gloss ? Math.max(w, (box.gw[it.id] ?? 0) * GLOSS_SIZE) : w;
  }
  return it.em * size;
};

/** Greedy line fill. Items are {id}, {chip,em} or {hole,em}. */
function flow(items, size, width, box, gloss) {
  const gap = gloss ? Math.max(size * WORD, 18) : size * WORD;
  const lines = [];
  let cur = [], x = 0;
  for (const it of items) {
    const w = cellW(it, size, box, gloss);
    if (cur.length && x + w > width) { lines.push({ cells: cur, w: x - gap }); cur = []; x = 0; }
    cur.push({ it, x, w });
    x += w + gap;
  }
  if (cur.length) lines.push({ cells: cur, w: x - gap });
  return lines;
}

const focusPitch = (size, gloss) => size * LINE + (gloss ? glossRise(size) : 0) + ROOM;

/** Largest integer size in lo..hi at which every list fits its rect. */
function fitAll(lists, lo, hi, rects, box, gloss) {
  const at = (size) => lists.map((items, n) => {
    const lines = flow(items, size, rects[n].w, box, gloss);
    return { size, lines, h: Math.max(0, lines.length * focusPitch(size, gloss) - ROOM) };
  });
  for (let size = hi; size >= lo; size--) {
    const fits = at(size);
    if (fits.every((f, n) => f.h <= rects[n].h)) return { fits, size, ok: true };
  }
  return { fits: at(lo), size: lo, ok: false };
}

/** Write one fitted block, centred in `rect`. Returns the chips it placed, keyed by chip id. */
function place(out, fit, rect, box, { gloss = false, pitch, z = 0, opacity = 1 } = {}) {
  const step = pitch ?? focusPitch(fit.size, gloss);
  const blockW = Math.max(0, ...fit.lines.map((l) => l.w));
  const x0 = rect.x + (rect.w - blockW) / 2;
  const y0 = rect.y + Math.max(0, (rect.h - fit.h) / 2);
  const placed = {};
  fit.lines.forEach((line, n) => {
    const y = y0 + n * step + (gloss ? glossRise(fit.size) : 0);
    for (const c of line.cells) {
      if (c.it.id) {
        const id = c.it.id;
        const w = (box.widths[id] ?? 0) * fit.size;
        const x = x0 + c.x + (c.w - w) / 2;
        out.tokens[id] = { x, y, z, size: fit.size, opacity };
        const g = out.glosses[id];
        if (g) {
          const gw = (box.gw[id] ?? 0) * GLOSS_SIZE;
          const on = gloss && gw > 0;
          out.glosses[id] = { x: x0 + c.x + (c.w - gw) / 2, y: glossY(y, fit.size), opacity: on ? 1 : 0 };
        }
      } else if (c.it.chip) {
        placed[c.it.chip] = { id: c.it.chip, kind: 'collapse', x: x0 + c.x, y, w: c.w, h: fit.size * LINE, text: c.it.text ?? '' };
      }
    }
  });
  return { placed, x0, y0, blockW, step };
}

/** The home layout: fixed flow width, so line breaks are the same in every viewport. Used by home, final and park(). */
function homeFlow(out, ids, box, { z, opacity, glossed = false }) {
  const x0 = EDGE + shift(box);
  flow(ids.map((id) => ({ id })), HOME.size, HOME.width, box, false).forEach((line, n) => {
    const y = HOME.top + n * HOME.pitch;
    for (const c of line.cells) {
      out.tokens[c.it.id] = { x: x0 + c.x, y, z, size: HOME.size, opacity };
      if (glossed) out.glosses[c.it.id] = { x: x0 + c.x, y, opacity: 0 };
    }
  });
}

/** Every word starts each layout hidden at home. A view then places what it shows. */
function park(out, box, idx) {
  homeFlow(out, idx.main, box, { z: Z_HOME, opacity: 0, glossed: true });
  homeFlow(out, idx.extras, box, { z: Z_HOME, opacity: 0 });
}

/** Layer tokens with a hole wherever reading order skips, so the lifted words leave a visible gap. */
function withHoles(ids, order) {
  const items = [];
  ids.forEach((id, n) => {
    if (n && order[id] - order[ids[n - 1]] > 1) items.push({ hole: 'gap', em: 1.6 });
    items.push({ id });
  });
  return items;
}

function parentFit(items, top, rect, box) {
  for (let size = top; size >= PARENT_FLOOR; size--) {
    const lines = flow(items, size, rect.w, box, false);
    if (lines.length * size * PARENT_LINE <= rect.h) return { size, lines, h: lines.length * size * PARENT_LINE };
  }
  return null;
}

/** At the floor, drop the tokens farthest from the lifted node and mark each cut side. */
function parentCut(ids, inner, rect, box, order) {
  const lo = order[inner[0]], hi = order[inner[inner.length - 1]];
  const dist = (id) => Math.max(lo - order[id], order[id] - hi, 0);
  const kept = ids.slice();
  let left = false, right = false;
  const room = { ...rect, w: rect.w - 80 };
  while (kept.length > 1 && !parentFit(withHoles(kept, order), PARENT_FLOOR, room, box)) {
    let far = kept.length - 1;
    for (let n = kept.length - 1; n >= 0; n--) if (dist(kept[n]) > dist(kept[far])) far = n;
    if (order[kept[far]] < lo) left = true; else right = true;
    kept.splice(far, 1);
  }
  const fit = parentFit(withHoles(kept, order), PARENT_FLOOR, room, box)
    ?? { size: PARENT_FLOOR, lines: flow(withHoles(kept, order), PARENT_FLOOR, room.w, box, false), h: rect.h };
  return { fit, room, left, right };
}

function layoutParents(out, node, focusIds, focusSize, zone, box, idx) {
  const chain = [];
  for (let p = node.parent; p; p = idx.nodes[p]?.parent) chain.push(idx.nodes[p]);
  const shown = chain.slice(0, 2);
  const beyond = chain.length - shown.length;
  if (!shown.length || !zone.h) return;

  const width = box.W - EDGE * 2;
  const bands = shown.length === 1
    ? [{ y: zone.y, h: zone.h }]
    : [{ y: zone.y + zone.h * 0.42, h: zone.h * 0.58 }, { y: zone.y, h: zone.h * 0.42 }];   // bands[0] is the nearest layer

  let inner = focusIds, top = Math.floor(focusSize * project(PLANES[1]));
  shown.forEach((anc, j) => {
    const plane = j + 1, z = PLANES[plane], opacity = 1;      // size carries depth: .35 could never reach 4.5:1
    const f = project(z);
    const reserve = beyond > 0 && j === shown.length - 1 ? 80 : 0;
    const rect = { x: EDGE + reserve, y: bands[j].y, w: width - reserve * 2, h: bands[j].h };
    out.planes.push({ z, x: EDGE, y: bands[j].y, w: width, h: bands[j].h });

    const innerSet = new Set(inner);
    const ids = anc.span.filter((id) => !innerSet.has(id));
    if (ids.length) {
      const items = withHoles(ids, idx.order);
      top = Math.min(top, Math.floor(focusSize * f));
      let fit = parentFit(items, Math.max(top, PARENT_FLOOR), rect, box);
      let cut = null;
      if (!fit) { cut = parentCut(ids, inner, rect, box, idx.order); fit = cut.fit; }
      const r = cut ? cut.room : rect;
      const at = place(out, fit, { ...r, x: rect.x + (rect.w - r.w) / 2 }, box, { pitch: fit.size * PARENT_LINE, z, opacity });
      top = fit.size;
      if (cut?.left) out.chips.push({ id: `cut-${plane}-left`, kind: 'cut', x: at.x0 - 34, y: at.y0, w: 28, h: fit.size * PARENT_LINE, text: '…' });
      if (cut?.right) {
        const last = fit.lines[fit.lines.length - 1];
        out.chips.push({ id: `cut-${plane}-right`, kind: 'cut', x: at.x0 + last.w + 6, y: at.y0 + (fit.lines.length - 1) * at.step, w: 28, h: fit.size * PARENT_LINE, text: '…' });
      }
    }
    inner = anc.span;
  });
  if (beyond > 0) out.chips.push({ id: 'more-parents', kind: 'more', x: EDGE, y: zone.y + 4, w: 68, h: 36, text: `+${beyond}` });
}

function layoutLift(out, state, zones, box, idx) {
  const view = state.view;
  const node = idx.nodes[view.node];
  if (!node) return;
  const gloss = view.gloss !== false;
  const collapsed = {};
  for (const c of view.collapse ?? []) for (const id of idx.nodes[c]?.span ?? []) collapsed[id] = c;

  const items = [], seen = new Set();
  for (const id of node.span) {
    const c = collapsed[id];
    if (!c) items.push({ id });
    else if (!seen.has(c)) { seen.add(c); items.push({ chip: `collapse-${c}`, em: 2.4, text: '' }); }
  }
  const rect = { x: EDGE, y: zones.focus.y + FOCUS.padT, w: box.W - EDGE * 2, h: zones.focus.h - FOCUS.padT - FOCUS.padB };
  const { fits, size, ok } = fitAll([items], FOCUS.lo, FOCUS.hi, [rect], box, gloss);
  if (!ok) out.overflow = true;
  const { placed } = place(out, fits[0], rect, box, { gloss });
  out.chips.push(...Object.values(placed));
  for (const [id, c] of Object.entries(collapsed)) {
    const chip = placed[`collapse-${c}`];
    if (chip) out.tokens[id] = { x: chip.x, y: chip.y, z: 0, size, opacity: 0 };
  }
  layoutParents(out, node, node.span, size, zones.parents, box, idx);
}

function layoutPair(out, state, zones, box) {
  const view = state.view;
  const gutter = 48, label = 44;
  const colW = (box.W - EDGE * 2 - gutter) / 2;
  const y = zones.focus.y + 12, h = zones.focus.h - 20;
  const cols = [{ x: EDGE, y, w: colW, h }, { x: EDGE + colW + gutter, y, w: colW, h }];
  const rects = cols.map((c) => ({ x: c.x, y: c.y + label, w: c.w, h: c.h - label }));
  const lists = [view.left, view.right].map((s) => (s?.tokens ?? []).map((id) => ({ id })));
  const { fits, ok } = fitAll(lists, FOCUS.lo, FOCUS.hi, rects, box, !!view.gloss);
  if (!ok) out.overflow = true;
  fits.forEach((f, n) => place(out, f, rects[n], box, { gloss: !!view.gloss }));
  out.plate = { kind: 'pair', left: cols[0], right: cols[1], label };
}

function layoutPlate(out, state, zones, box) {
  const view = state.view;
  const y = zones.focus.y + 12, h = zones.focus.h - 20;
  const width = box.W - EDGE * 2;
  const ids = view.tokens ?? [];
  const imgW = ids.length ? width * 0.58 : width;
  const img = { x: EDGE, y, w: imgW, h };
  out.plate = { kind: 'plate', img };
  if (!ids.length) return;
  const rect = { x: EDGE + imgW + 32, y: y + 12, w: width - imgW - 32, h: h - 12 };
  const { fits, ok } = fitAll([ids.map((id) => ({ id }))], FOCUS.lo, FOCUS.hi, [rect], box, !!view.gloss);
  if (!ok) out.overflow = true;
  place(out, fits[0], rect, box, { gloss: !!view.gloss });
}

/** The text pair of `view.lower` stands in the ledger zone. */
function layoutLower(out, zones, box) {
  const gutter = 48, label = 44, x0 = EDGE + shift(box);
  const w = (ZONE_VARS.spineW - gutter) / 2;
  const y = zones.lower.y + 4, h = box.H - y - 24;
  out.plate = { kind: 'lower', left: { x: x0, y, w, h }, right: { x: x0 + w + gutter, y, w, h }, label };
}

// ---- scene anchors
const ANCHORS = {
  centre: { mid: 982, baseline: 420, lo: 240, hi: 1724 },
  'centre.l': { left: 240, baseline: 420, hi: 1724 },
  'centre.r': { right: 1724, baseline: 420, lo: 240 },
  'lintel.l': { left: 240, y: 150, hi: 1724 },
  'lintel.r': { right: 1724, y: 150, lo: 48 },
  'lintel.t': { left: 48, y: 150, hi: 1872 },
  'lintel.m': { left: 620, y: 150, hi: 1872 },
  margin: { right: 160, y: 150, lo: 48, floor: 38 },      // the table's own 38 px is under the plane 1 floor of 44
  f1: { left: 240, y: 350, hi: 1724, wide: [48, 1872] },    // the longest line needs the whole stage: past `hi` it slides left, as far as `wide` allows
  f2: { left: 240, y: 470, hi: 1724 },
  'up.r2': { left: 240, y: 218, hi: 1724 },
  'up.r3': { left: 240, y: 278, hi: 1724 },
  'arrow.mid': { mid: 772, y: 150, lo: 48, hi: 1872 },
  'wings.l': { left: -340, y: 420, off: true },
  'wings.r': { left: 2260, y: 420, off: true },
};
const TABLE_COL = { head: [48, 348], pred: [380, 740], inf: [772, 980], obj: [1012, 1404], verdict: [1436, 1752] };
const TABLE_ROW = ['T', 'A1', 'A2', 'B1', 'B2', 'C'];
const TABLE_PITCH = 66, TABLE_TOP = 130, TABLE_STACK = 66;      // TABLE_STACK: how much lower a row with gloss stacks stands than the pitch alone
const TABLE_BACK = 44;                // rows T, A1 and A2: moved back, at the plane 1 floor
const TABLE_END = 590;                // the lowest ink of the last row when the table has to pack
const TABLE_TRIM = 7;                 // a held cell in a packed table: its height comes off, so its corners clear the line above
const TABLE_OVER = 4;                 // a descender may reach this far into the line box of the stack under it, above that line's letters
const CENTRE_DROP = 30;               // up.r3's ink ends at 307 and the stack over a 96 px word would start at 282

const inRow = (g, r) => g.base === `table.${r}` || g.base.startsWith(`table.${r}.`);
const rowStacked = (view, r) => view.groups.some((g) => inRow(g, r) && shows(g) && !g.reserve && glossOn(g));
/** A row's size is that of its words on the plane nearest the eye; a head's own size does not count. */
const rowSize = (view, r) => Math.max(0, ...view.groups.filter((g) => inRow(g, r) && !g.base.endsWith('.head') && shows(g) && !g.reserve).map((g) => g.size));

/**
 * Row centres. A row with stacks pushes itself and the rows under it down. If that runs into the English strip, as with all six rows,
 * the rows stand on one another up from TABLE_END instead. Otherwise T, A1 and A2 keep their places: the dashed cell stands at A2 outside the table too.
 */
function tableYs(view) {
  const ys = {};
  let y = TABLE_TOP;
  TABLE_ROW.forEach((r, n) => {
    if (n) y += TABLE_PITCH + (rowStacked(view, r) ? TABLE_STACK : 0);
    ys[r] = y;
  });
  const used = TABLE_ROW.filter((r) => rowSize(view, r));
  const last = used[used.length - 1];
  const size = rowSize(view, last);
  if (!last || ys[last] + (INK_B - LINE / 2) * size <= TABLE_END) return ys;
  ys.packed = true;
  let floor = TABLE_END;
  for (const r of [...used].reverse()) {
    const s = rowSize(view, r);
    ys[r] = floor - (INK_B - LINE / 2) * s;
    floor = ys[r] - (LINE / 2 - INK_T) * s - (rowStacked(view, r) ? GLOSS_STACK + STACK_CLEAR - TABLE_OVER : 0);
  }
  return ys;
}

function anchorOf(base, view, g) {
  const named = ANCHORS[base];
  if (base === 'margin' && view.groups.some((x) => x.base === 'table.T')) return { ...named, y: tableYs(view).T + (BASE - LINE / 2) * (TABLE_BACK - g.size) };   // on row T's baseline
  if (named) return named.baseline != null && view.groups.some((x) => x.base === 'up.r3' && shows(x)) ? { ...named, baseline: named.baseline + CENTRE_DROP } : named;
  const b = /^b([1-5])$/.exec(base);
  if (b) {
    const pitch = g.pitch ?? view.pitch ?? 60;
    const rows = Math.max(...view.groups.map((x) => Number(/^b([1-5])$/.exec(x.base)?.[1] ?? 0)));
    return { left: BOARDS.x, y: boardsTop(rows, pitch, g.size) + (Number(b[1]) - 0.5) * pitch, hi: BOARDS.right };
  }
  const t = /^table\.([A-Z0-9]+)(?:\.([a-z]+))?$/.exec(base);
  if (!t) return null;
  const [left, hi] = t[2] ? TABLE_COL[t[2]] : [380, BOARDS.right];
  const ys = tableYs(view);
  return { left, y: ys[t[1]], hi, cell: !!t[2], rowsBelow: TABLE_ROW.length - 1 - TABLE_ROW.indexOf(t[1]), trim: ys.packed ? TABLE_TRIM : 0 };
}

/** Where the boards start: y 300, or as far above it as `rows` lines need to end clear of the English. */
const boardsTop = (rows, pitch, size) => Math.min(BOARDS.y, BOARDS.inkEnd - ((rows - 0.5) * pitch + (INK_B - LINE / 2) * size));

const zOf = (plane) => (plane === 'wings' ? Z_WINGS : plane === 'home' ? Z_HOME : PLANES[plane] ?? 0);
const shows = (g) => !!g.reserve || (g.st !== 'hidden' && g.plane !== 'wings' && g.plane !== 'home');
const tokenW = (id, size, box) => (box.widths[id] ?? 0) * size;
/** Joining and assembly anchors: their pitch (60 to 74) cannot hold a gloss stack and a word. */
const NO_STACK = /^(boards|b[1-5])$/;
/**
 * The gloss stack is on for every word on plane 0 unless the group sets gloss:false. Plane 1 carries none, nor do those anchors.
 * The table decides for itself, whatever the group says: every word on plane 0 has one, moved-back colour or not. Row T stands on plane 1:
 * see backRow().
 */
const glossOn = (g) => (g.base?.startsWith('table.') ? g.plane === 0 : g.gloss !== false && g.plane === 0 && !NO_STACK.test(g.base ?? ''));

/**
 * Row T stands on plane 1 with A1 and A2, all at that plane's floor. It has been moved back since it left the focus, and four rows of stacks do not fit:
 * T, B1, B2 and C with stacks over 56 px words, plus A1 and A2 at 44, need 573 px with no space between rows, and 494 lie between the ribbon and TABLE_END.
 */
const backRow = (g) => (/^table\.(T$|A[12]\b)/.test(g.base) ? { ...g, plane: g.base === 'table.T' ? 1 : g.plane, size: TABLE_BACK } : g);

/** Which built tag a word shows: its form, or that form with the case still open (step field `open`). */
const tagKey = (state, id, form) => (state.open?.[id] ? `${form}:${state.open[id]}` : form);

function tagW(id, key, box) {
  const t = box.tw?.[id]?.[key];
  if (t == null) return 0;
  return (Array.isArray(t) ? Math.max(...t) : t) * TAG_SIZE;
}

/** The width a word claims on its line in this group. A gloss claims none of it: packGloss() keeps neighbouring stacks apart. */
function wordCell(id, g, state, box) {
  const form = state.tags?.[id];
  let w = tokenW(id, g.size, box);
  if (g.spread && form) w = Math.max(w, tagW(id, tagKey(state, id, form), box));
  return w;
}

const gapOf = (g) => (g.spread ? Math.max(g.size * WORD, TAG_GUTTER) : g.size * WORD);

/** Stacks are centred on their words and may overhang a neighbour whose own stack is narrower. Extra space goes only where two would touch. */
function packGloss(part, g, box) {
  if (!glossOn(g)) return part;
  const gw = (c) => (c.id ? (box.gw[c.id] ?? 0) * GLOSS_SIZE : 0);
  const over = (c) => (c.id ? Math.max(0, (gw(c) - c.w) / 2) : 0);
  part.cells.forEach((c, n) => {
    const d = part.cells[n + 1];
    if (!d || !gw(c) || !gw(d)) return;
    c.pad = Math.max(0, (gw(c) + gw(d)) / 2 + GLOSS_GUTTER - (c.w + d.w) / 2 - part.gap);
  });
  const { cells } = part;
  if (cells.length) { part.lead = over(cells[0]); part.tail = over(cells[cells.length - 1]); }
  return part;
}

/** Width held for words that are not here yet, so the line does not shift when they arrive. */
function heldWidth(ids, g, state, box) {
  return cellsWidth(packGloss({ gap: gapOf(g), cells: ids.map((id) => ({ id, w: wordCell(id, g, state, box) })) }, g, box));
}

/** The cells of one group, in order: words, holes after words, or one reserved box. */
function groupCells(g, state, box) {
  const gap = gapOf(g);
  if (g.reserve) return { gap, cells: [{ box: g.box, w: heldWidth(g.reserve, g, state, box) }] };
  const cells = [];
  for (const id of g.tokens) {
    cells.push({ id, w: wordCell(id, g, state, box) });
    const hole = g.holes?.find((h) => h.after === id);
    if (hole) cells.push({ hole: id, w: hole.em != null ? hole.em * g.size : heldWidth(hole.for, g, state, box) });
  }
  return packGloss({ gap, cells }, g, box);
}

const cellsWidth = (p) => (p.lead ?? 0) + (p.tail ?? 0) + p.cells.reduce((w, c) => w + c.w + (c.pad ?? 0), 0) + p.gap * Math.max(0, p.cells.length - 1);

/** Write a line of cells at (x, top) and return the x past the last one. */
function putCells(out, part, g, x, top, state, box) {
  const size = g.size, z = zOf(g.plane);
  x += part.lead ?? 0;
  part.cells.forEach((c, n) => {
    const r = { x, y: top, w: c.w, h: size * LINE };
    if (c.id) {
      const w = tokenW(c.id, size, box);
      out.tokens[c.id] = { x: x + (c.w - w) / 2, y: top, z, size, opacity: g.st !== 'hidden' && state.st?.[c.id] ? 1 : 0 };
      const glossW = (box.gw[c.id] ?? 0) * GLOSS_SIZE;
      const on = glossOn(g) && glossW > 0 && out.tokens[c.id].opacity > 0;
      if (out.glosses[c.id]) out.glosses[c.id] = { x: x + (c.w - glossW) / 2, y: glossY(top, size), opacity: on ? 1 : 0 };
    } else if (c.hole) out.holes[c.hole] = r;
    else if (c.box) out.boxes[c.box] = { ...r, y: r.y + (part.trim ?? 0), h: r.h - 2 * (part.trim ?? 0) };
    x += c.w + (n < part.cells.length - 1 ? part.gap + (c.pad ?? 0) : 0);
  });
  return x + (part.tail ?? 0);
}

function checkFloor(out, g, a) {
  if (g.size < (a?.floor ?? FLOOR[g.plane] ?? 0)) out.overflow = true;
}

/** Room this anchor leaves its line, from the anchor's own edges. */
const roomOf = (a) => (a.hi != null && a.left != null ? a.hi - a.left : a.right != null && a.lo != null ? a.right - a.lo : Infinity);

/** A line past its anchor gives way first in the box that holds no word yet, then in its word gaps, never in size. */
function fitLine(parts, gs, lineW, a) {
  const held = parts.flatMap((p) => p.cells.filter((c) => c.box));
  const empty = held.length === parts.reduce((n, p) => n + p.cells.length, 0);
  const wide = a.wide ? a.wide[1] - a.wide[0] - (gs[0].indent ?? 0) : 0;
  const room = empty && a.wide ? wide : roomOf(a) - (gs[0].indent ?? 0);    // an empty line slides as its words will
  for (const c of held) c.w = Math.max(0, c.w - Math.max(0, lineW() - room));
  const gaps = parts.reduce((n, p) => n + Math.max(0, p.cells.length - 1), 0);
  if (!gaps) return;
  const most = gs[0].size * (WORD - WORD_MIN);
  const slides = a.wide && (lineW() - room) / gaps > most;     // closing the gaps would not be enough: it slides, and closes them only as far as the stage needs
  const over = lineW() - (slides ? wide : room);
  if (over <= 0) return;
  const cut = Math.min(over / gaps, most);
  parts.forEach((p, n) => { if (!gs[n].spread) p.gap = Math.max(gs[0].size * WORD_MIN, p.gap - cut); });
}

/** One line of an anchor: its runs left to right, one word gap between them, all at one size. */
function layoutAnchorLine(out, gs, a, state, box) {
  const parts = gs.map((g) => ({ ...groupCells(g, state, box), trim: a.trim }));
  const runGap = gs[0].size * WORD;
  const lineW = () => parts.reduce((w, p) => w + cellsWidth(p), 0) + runGap * (parts.length - 1);
  fitLine(parts, gs, lineW, a);
  const total = lineW();
  // A table cell wider than its column keeps its right edge and grows left, across the gutter: the columns are fixed, a short word sits to its left.
  const x0 = a.mid != null ? a.mid - total / 2 : a.right != null ? a.right - total : a.cell ? Math.min(a.left, a.hi - total)
    : a.wide ? Math.max(a.wide[0], Math.min(a.left + (gs[0].indent ?? 0), a.hi - total)) : a.left + (gs[0].indent ?? 0);
  const [lo, hi] = a.wide ?? [a.lo, a.hi];
  if (!a.off && gs.some(shows)) {
    if (hi != null && x0 + total > hi + 0.5) out.overflow = true;
    if (lo != null && x0 < lo - 0.5) out.overflow = true;
  }
  let x = x0 + shift(box);
  gs.forEach((g, n) => {
    if (shows(g) && !g.reserve) checkFloor(out, g, a);      // a reserve prints no word, so it has no floor
    const top = a.baseline != null ? a.baseline - BASE * g.size : a.y - (LINE / 2) * g.size;
    x = putCells(out, parts[n], g, x, top, state, box) + runGap;
  });
}

/** Greedy wrap of a group's cells to `width`. */
function wrapCells(part, width) {
  const lines = [];
  let cur = [], w = 0;
  for (const c of part.cells) {
    const step = cur.length ? part.gap + (cur[cur.length - 1].pad ?? 0) : 0;
    if (cur.length && w + step + c.w > width) { lines.push(cur); cur = []; w = 0; }
    else w += step;
    w += c.w;
    cur.push(c);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** A row head on the boards is a word in focus: the focus floor (no text in focus under 56) and the gloss stack. Too wide for its column, it takes the row below too. */
function layoutTableHead(out, g, a, state, box) {
  const h = { ...g, size: Math.max(g.size, FLOOR[0]), plane: 0 };
  const part = groupCells(h, state, box);
  const lines = wrapCells(part, a.hi - a.left);
  lines.forEach((cells, n) => {
    const top = a.y + n * TABLE_PITCH - (LINE / 2) * h.size;
    putCells(out, { cells, gap: part.gap }, h, a.left + shift(box), top, state, box);
  });
  if (shows(h) && lines.length - 1 > a.rowsBelow) out.overflow = true;
}

/** `boards`: greedy wrap in Greek order inside the boards rect. */
function layoutBoards(out, g, view, state, box) {
  const part = groupCells(g, state, box);
  // A .tk's box runs .22 em past its ink, for the copied space. The last word's box stays inside the boards too.
  const pitch = g.pitch ?? view.pitch ?? 60, width = BOARDS.right - BOARDS.x - TK_TAIL * g.size;
  // Greedy wrap can strand one word on a line the boards cannot hold: close the word gaps only as far as that needs.
  let lines = wrapCells(part, width);
  const most = Math.floor((BOARDS.bottom - BOARDS.y) / pitch);
  for (let em = WORD - 0.01; lines.length > most && em > WORD_MIN - 1e-9; em -= 0.01) {
    part.gap = g.size * em;
    lines = wrapCells(part, width);
  }
  const y0 = boardsTop(lines.length, pitch, g.size);
  lines.forEach((cells, n) => {
    const top = y0 + (n + 0.5) * pitch - (LINE / 2) * g.size;
    putCells(out, { cells, gap: part.gap }, g, BOARDS.x + shift(box) + (g.indent ?? 0), top, state, box);
  });
  if (shows(g)) {
    checkFloor(out, g, null);
    if (BOARDS.y + lines.length * pitch > BOARDS.bottom + 0.5) out.overflow = true;
  }
}

/** One sentence of the stack, in its own lines. */
function layoutStackBlock(out, group, spec, state, box) {
  if (!group) return;
  const g = { ...group, size: spec.size };
  const part = groupCells(g, state, box);
  wrapCells(part, STACK.w - TK_TAIL * g.size).forEach((cells, n) => {
    putCells(out, { cells, gap: part.gap }, g, STACK.x + shift(box), spec.y + n * spec.pitch, state, box);
  });
  if (shows(g)) checkFloor(out, g, null);
}

/** Five lines of one sentence and nothing else on stage: one wrap, four lines under their stacks. The word gaps close as far as four lines need. */
function layoutWhole(out, gs, state, box) {
  const g = { ...gs[0], base: 'whole', gloss: true, tokens: gs.flatMap((x) => x.tokens) };
  const part = groupCells(g, state, box);
  const width = BOARDS.right - BOARDS.x - TK_TAIL * g.size;
  let lines = wrapCells(part, width);
  for (let em = WORD - 0.01; lines.length > WHOLE.lines && em > WORD_MIN - 1e-9; em -= 0.01) {
    part.gap = g.size * em;
    packGloss(part, g, box);
    lines = wrapCells(part, width);
  }
  lines.forEach((cells, n) => putCells(out, { cells, gap: part.gap }, g, BOARDS.x + shift(box), WHOLE.top + n * WHOLE.pitch, state, box));
  if (shows(g)) {
    checkFloor(out, g, null);
    if (lines.length > WHOLE.lines) out.overflow = true;
  }
}

function layoutScene(out, state, zones, box) {
  const view = { ...state.view, groups: state.view.groups.map(backRow) };
  if (view.groups.length === 5 && view.groups.every((g) => /^b[1-5]$/.test(g.base))) { layoutWhole(out, view.groups, state, box); return; }
  const bases = new Map();
  for (const g of view.groups) {
    if (!bases.has(g.base)) bases.set(g.base, []);
    bases.get(g.base).push(g);
  }
  for (const [base, gs] of bases) {
    if (base === 'home') continue;
    if (base === 'stack.top' || base === 'stack.bot') layoutStackBlock(out, gs[0], base === 'stack.top' ? STACK.top : STACK.bot, state, box);
    else if (base === 'boards') for (const g of gs) layoutBoards(out, g, view, state, box);
    else {
      const a = anchorOf(base, view, gs[0]);
      if (!a) { out.overflow = true; continue; }
      if (base.endsWith('.head') && a.y >= BOARDS.y) { layoutTableHead(out, gs[0], a, state, box); continue; }
      layoutAnchorLine(out, [...gs].sort((p, q) => (p.run ?? 0) - (q.run ?? 0)), a, state, box);
    }
  }
  partRows(out, view, state, box);
  if (view.lower) layoutLower(out, zones, box);
}

/** The printed lines of a word's tag, each with its top, left and width. Empty when the form has nothing to print. */
function tagRects(id, t, state, box) {
  const form = state.tags?.[id];
  const em = form ? box.tw?.[id]?.[tagKey(state, id, form)] : null;
  if (!em) return [];
  const y = t.y + t.size * LINE + TAG_GAP, mid = t.x + tokenW(id, t.size, box) / 2;
  return [em].flat().filter(Boolean).map((e, n) => ({ x: mid - (e * TAG_SIZE) / 2, y: y + n * TAG_LINE, w: e * TAG_SIZE, h: TAG_LINE }));
}

/**
 * f1 and f2: a tag under f1 must not run into what stands over f2. The rows part only where one actually does, and only as far as that needs,
 * half up and half down, until f1 reaches what is above it or f2's last line reaches the English.
 * Where that is not enough, because a row stands between f1 and the lintel, f2 slides right, just past the tags it meets.
 */
function partRows(out, view, state, box) {
  const rowOf = (base) => view.groups.filter((g) => g.base === base && shows(g) && !g.reserve).flatMap((g) => g.tokens).filter((id) => out.tokens[id].opacity > 0);
  const upper = rowOf('f1'), lower = rowOf('f2');
  if (!upper.length || !lower.length) return;
  const heads = lower.map((id) => {
    const t = out.tokens[id], g = out.glosses[id];
    if (g?.opacity > 0) return { x: g.x, y: g.y, w: (box.gw[id] ?? 0) * GLOSS_SIZE, h: GLOSS_STACK };
    return { x: t.x, y: t.y + INK_T * t.size, w: tokenW(id, t.size, box), h: (INK_B - INK_T) * t.size };
  });
  const tags = upper.flatMap((id) => tagRects(id, out.tokens[id], state, box));
  const needAt = (dx, slack = ROW_SLACK) => {
    let need = 0;
    for (const r of tags) {
      for (const h of heads) {
        const shared = Math.min(r.y + r.h, h.y + h.h) - Math.max(r.y, h.y);
        if (r.x < h.x + dx + h.w + ROW_GAP && h.x + dx < r.x + r.w + ROW_GAP && shared > slack) need = Math.max(need, r.y + r.h + ROW_GAP - h.y);
      }
    }
    return need;
  };
  if (!needAt(0)) return;
  const need = needAt(0, -Infinity);       // once the rows part, every tag over a stack has to clear it, not only those that touch it now
  const top = Math.min(...upper.map((id) => (out.glosses[id]?.opacity > 0 ? out.glosses[id].y : out.tokens[id].y + INK_T * out.tokens[id].size)));
  const row = new Set([...upper, ...lower]);
  const above = Object.entries(out.tokens).filter(([id, t]) => !row.has(id) && t.opacity > 0 && t.y < top).map(([, t]) => t.y + INK_B * t.size);
  const up = Math.max(0, top - Math.max(RIBBON, ...above) - ROW_GAP);
  const bottom = Math.max(...lower.map((id) => {
    const t = out.tokens[id];
    return Math.max(t.y + INK_B * t.size, ...tagRects(id, t, state, box).map((r) => r.y + r.h));
  }));
  const move = (ids, base, dy, dx = 0) => {
    for (const id of ids) for (const t of [out.tokens[id], out.glosses[id]]) { t.y += dy; t.x += dx; }
    for (const g of view.groups.filter((x) => x.base === base)) {
      for (const r of [out.boxes[g.box], ...(g.holes ?? []).map((h) => out.holes[h.after])]) if (r) { r.y += dy; r.x += dx; }
    }
  };
  // First with air, then with none: no gap, and f2 down to the lowest line the English allows.
  for (const [want, end] of [[need, BOARDS.inkEnd], [need - ROW_GAP, TABLE_END]]) {
    const down = Math.max(0, end - bottom);
    const d = Math.min(down, Math.max(want / 2, want - up));
    const u = Math.min(up, want - d);
    if (u + d >= want - 0.5) { move(upper, 'f1', -u); move(lower, 'f2', d); return; }
  }
  const right = Math.max(...lower.map((id) => out.tokens[id].x + tokenW(id, out.tokens[id].size, box) * (1 + TK_TAIL)));
  for (let dx = ROW_STEP; right + dx <= BOARDS.right + shift(box); dx += ROW_STEP) {
    if (!needAt(dx)) { move(lower, 'f2', 0, dx); return; }
  }
  out.overflow = true;
}

/** Tags stay on plane 0, centred under the word, in the row under its line. A form with nothing to print has no tag. */
function layoutTags(out, state, box) {
  for (const [id, form] of Object.entries(state.tags ?? {})) {
    const t = out.tokens[id];
    const key = tagKey(state, id, form);
    const w = tagW(id, key, box);
    if (!t || !(t.opacity > 0) || !w) continue;
    out.tags[id] = { x: t.x + (tokenW(id, t.size, box) - w) / 2, y: t.y + t.size * LINE + TAG_GAP, form, key };
  }
}

/** The words outside the passage: each turn starts a line, greedy wrap inside a turn. */
function layoutSkipped(out, view, box) {
  const x0 = SKIP.x + shift(box);
  let y = SKIP.y;
  for (const turn of view.turns ?? []) {
    out.turns.push({ speaker: turn.speaker, first: turn.ids[0], last: turn.ids[turn.ids.length - 1], y });
    for (const line of flow(turn.ids.map((id) => ({ id })), SKIP.size, SKIP.w, box, false)) {
      for (const c of line.cells) out.tokens[c.it.id] = { x: x0 + c.x, y, z: 0, size: SKIP.size, opacity: 1 };
      y += SKIP.pitch;
    }
    y += SKIP.turn;
  }
  if (y - SKIP.pitch - SKIP.turn + SKIP.size * LINE > ZONE_VARS.ySpine) out.overflow = true;
}

/** Sentence stage: a fixed `size` when the step gives one, else the largest that fits. Glossed unless gloss:false. */
function layoutLine(out, view, box, idx) {
  const gloss = view.gloss !== false;
  const rect = { ...STAGE, x: STAGE.x + shift(box) };
  const items = scopeIds(view.scope, idx).map((id) => ({ id }));
  if (view.size) {
    const lines = flow(items, view.size, rect.w, box, gloss);
    const h = Math.max(0, lines.length * focusPitch(view.size, gloss) - ROOM);
    if (h > rect.h) out.overflow = true;
    place(out, { size: view.size, lines, h }, rect, box, { gloss });
    return;
  }
  const { fits, ok } = fitAll([items], FOCUS.lo, FOCUS.hi, [rect], box, gloss);
  if (!ok) out.overflow = true;
  place(out, fits[0], rect, box, { gloss });
}

const NO_SPINE = new Set(['home', 'final', 'line', 'skipped']);

export function zonesFor(state, box) {
  const mode = state.view?.mode ?? 'full';
  const enOn = (state.spine ?? 'off') !== 'off' && !NO_SPINE.has(mode);
  const parents = { y: RIBBON, h: mode === 'lift' && state.depth > 0 ? PARENTS : 0 };
  const focusY = parents.y + parents.h;
  const enZone = enOn ? { y: ZONE_EN, h: ZONE_LOWER - ZONE_EN } : { y: ZONE_LOWER, h: 0 };
  return {
    ribbon: { y: 0, h: RIBBON },
    parents,
    focus: { y: focusY, h: enZone.y - focusY },
    en: enZone,
    lower: { y: ZONE_LOWER, h: box.H - ZONE_LOWER },
  };
}

/** The tag under the word. Part of speech now stands above the word, so the tag does not repeat it. Values as stored; `open` stands in for the stored case. */
const TAG_FEATURES = ['case', 'number', 'gender', 'person', 'tense', 'mood', 'voice', 'degree'];
export function tagLines(row, open = null) {
  const f = open ? { ...row?.features, case: open } : row?.features ?? {};
  return {
    l1: row?.lemma ?? '',
    l2: TAG_FEATURES.map((k) => f[k]).filter(Boolean).join(' '),
    short: f.case && f.number ? `${f.case} ${f.number}` : '',
  };
}

const POS_WORD = { pron: 'pronoun', article: 'article', noun: 'noun', adj: 'adjective', adv: 'adverb', conj: 'conjunction', prep: 'preposition', particle: 'particle', verb: 'verb', 'verbal-adj': 'verbal adjective' };

/** The part of speech as a full word, from the parse row. */
export function posWord(row) {
  if (row?.pos === 'verb' && row.features?.mood === 'ptc') return 'participle';
  if (row?.pos === 'verb' && row.features?.mood === 'inf') return 'infinitive';
  return POS_WORD[row?.pos] ?? row?.pos ?? '';
}

export function layout(state, box) {
  const idx = box.idx;
  const zones = zonesFor(state, box);
  const out = { tokens: {}, glosses: {}, chips: [], zones, overflow: false, planes: [], plate: null, tags: {}, boxes: {}, holes: {}, turns: [] };
  park(out, box, idx);

  const view = state.view ?? { mode: 'full' };
  if (view.mode === 'full') {
    const gloss = !!view.gloss;
    const items = scopeIds(view.scope, idx).map((id) => ({ id }));
    const rect = { x: EDGE, y: zones.focus.y + FULL.padT, w: box.W - EDGE * 2, h: zones.focus.h - FULL.padT - FULL.padB };
    const { fits, ok } = fitAll([items], FULL.lo, FULL.hi, [rect], box, gloss);
    if (!ok) out.overflow = true;
    place(out, fits[0], rect, box, { gloss });
  } else if (view.mode === 'line') {
    layoutLine(out, view, box, idx);
  } else if (view.mode === 'lift') {
    layoutLift(out, state, zones, box, idx);
  } else if (view.mode === 'pair') {
    layoutPair(out, state, zones, box);
  } else if (view.mode === 'plate') {
    layoutPlate(out, state, zones, box);
  } else if (view.mode === 'scene') {
    layoutScene(out, state, zones, box);
  } else if (view.mode === 'home' || view.mode === 'final') {
    homeFlow(out, idx.main, box, { z: 0, opacity: 1 });
  } else if (view.mode === 'skipped') {
    layoutSkipped(out, view, box);
  }
  layoutTags(out, state, box);
  return out;
}
