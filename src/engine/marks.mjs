// Marks. Two SVGs share one viewBox; everything is in stage px.
//
// A state is PLANNED whole, as a pure function of the state and the rects at rest, then RECONCILED with what is on
// stage. So forward, back and a jump give the same drawing, and a kept mark whose plan is unchanged is never touched.
// Every line is a dense polyline: trimming, parallel lines, tangents, hit tests and draw-on all read the same points.
//
// Nothing is placed on text. A word's cell is its ink, the gloss above it and the tag below it; ports stand outside
// the cell, and routes, labels, chips and rails are tested against all three. Where lines are too tight for that (ink
// boxes overlap at pitch 60), a route falls back through tiers: the word's body with its gloss still solid, so a line
// takes the channel between a line's descenders and the gloss below it; then no gloss; then the body only. Labels come
// last, once every line is known, and take the nearest free rect; none is ever set on text to save a search. A board too
// full for its labels sets the grammatical ones in short form, all of them, so a board reads one way.
const NS = 'http://www.w3.org/2000/svg';

const PORT = 6, STEP = 3, SAMPLE = 8;
const LOW = 26, HIGH = 60, BULGE_LOW = 48, BULGE_HIGH = 104;   // two arc heights
const TICK = 8, RAIL_GAP = 4, RAIL_STEP = 8, CORNER = 18;
const LABEL_PX = 26, CHIP_PX = 24, CHIP_H = 34, CHIP_PAD = 12;
const DRAW_MS = 700, FADE_MS = 240, LABEL_MS = 200;
const ZONE_TOP = 98, BOARDS_END = 592, LEDGER_TOP = 742;       // less a hair
const DOOR = { x0: 176, x1: 1744, y: 191.5, end: 586 };
const TABLE = { rows: ['T', 'A1', 'A2', 'B1', 'B2', 'C'], cols: { head: 48, pred: 380, inf: 753, obj: 988, verdict: 1405 }, y0: 130, pitch: 66 };
const BASE = .965, UNDER = .15, LINE = 1.2;                    // and the underline offset of stage.css
const INK_T = .10, INK_H = 1.115, BODY_T = .16, BODY_B = 1.04;   // body: accent line to just under the baseline, em from line-box top
const TIGHT_B = 1.15, LETTER_T = .46;                          // just under the underline; top of the letters without accents, em from line-box top: a tight rail may pass over accents, never letters
const LABEL_GAP_X = 14, LABEL_GAP_Y = 4, EN_GAP = 7;           // two labels on one line must read as two; a label stays off the English
const CROWD = 1;                                               // cost per px of running along a line already drawn
const LABEL_REACH = 170;                                       // a label further than this from its line is read as someone else's
const SHORT = { feminine: 'fem.', masculine: 'masc.', neuter: 'neut.', nominative: 'nom.', vocative: 'voc.', accusative: 'acc.', genitive: 'gen.', dative: 'dat.', singular: 'sg.', plural: 'pl.' };
const shorten = (text) => text.replace(/\b(feminine|masculine|neuter|nominative|vocative|accusative|genitive|dative|singular|plural)\b/g, (w) => SHORT[w]);

/** Stroke and end glyphs per relation. Widths and dashes are in marks.css. */
const ENDS = {
  predicate: { head: 'filled' }, describes: { head: 'open' }, governs: { tail: 'ring', head: 'filled' }, modifies: { head: 'small' },
  agrees: { tail: 'tick', head: 'tick' }, connects: {}, introduces: { tail: 'hook', head: 'corner' }, resumes: { head: 'open' }, candidate: {},
};
/** Glyphs drawn with +x along the tangent, the tip at 0,0. `trim` shortens the line so it does not poke through. */
const GLYPHS = {
  filled: { d: (s) => `M0,0L${-15 * s},${-6.5 * s}L${-15 * s},${6.5 * s}Z`, fill: true, trim: (s) => 11 * s },
  small: { d: () => 'M0,0L-10,-4L-10,4Z', fill: true, trim: () => 7 },
  open: { d: () => 'M-13,-7L0,0L-13,7', trim: () => 1 },
  tick: { d: () => 'M0,-8V8', trim: () => 0 },
  ring: { d: () => 'M-5,0a5,5 0 1,0 10,0a5,5 0 1,0 -10,0', trim: () => 5 },
  hook: { d: () => 'M0,0q0,-10 10,-10', trim: () => 0 },
  corner: { d: () => 'M-10,-9H0V9', trim: () => 0 },
  cup: { d: () => 'M-6,-9A9,9 0 0,1 -6,9', trim: () => 0 },
  cross: { d: () => 'M-8,-8L8,8M-8,8L8,-8', trim: () => 0 },
};

// ---- geometry
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => Math.round(v * 10) / 10;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const union = (rs) => {
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};
const within = (p, r, m) => p.x > r.x - m && p.x < r.x + r.w + m && p.y > r.y - m && p.y < r.y + r.h + m;
const overlaps = (a, b, m = 0, my = m) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + my && b.y < a.y + a.h + my;
const polyLength = (pts) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);
const toD = (pts) => `M${pts.map((p) => `${r1(p.x)},${r1(p.y)}`).join('L')}`;

function straight(a, b) {
  const n = Math.max(1, Math.ceil(dist(a, b) / STEP));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }));
}
function cubic(a, c1, c2, b) {
  const n = Math.max(6, Math.ceil((dist(a, c1) + dist(c1, c2) + dist(c2, b)) / STEP));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t, A = u * u * u, B = 3 * u * u * t, C = 3 * u * t * t, D = t * t * t;
    return { x: A * a.x + B * c1.x + C * c2.x + D * b.x, y: A * a.y + B * c1.y + C * c2.y + D * b.y };
  });
}
const chain = (...legs) => legs.flatMap((l, i) => (i ? l.slice(1) : l));
const polyline = (...pts) => chain(...pts.slice(1).map((p, i) => straight(pts[i], p)));

/** Points every `step` px along a polyline, both ends included. */
function along(pts, step) {
  const out = [pts[0]];
  let need = step;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let left = dist(a, b);
    while (left >= need) {
      const t = need / left, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(p); a = p; left -= need; need = step;
    }
    need -= left;
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > .01) out.push(last);
  return out;
}
function tangentAt(pts, i) {
  const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
  const L = dist(a, b) || 1;
  return { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
}
/** Drop `head` px from the start and `tail` px from the end. */
function trim(pts, head, tail) {
  let i = 0, j = pts.length - 1, run = 0;
  while (i < j && run < head) { run += dist(pts[i], pts[i + 1]); i++; }
  run = 0;
  while (j > i && run < tail) { run += dist(pts[j], pts[j - 1]); j--; }
  return pts.slice(i, j + 1);
}
function parallel(pts, d) {
  return pts.map((p, i) => {
    const t = tangentAt(pts, i);
    return { x: p.x - t.y * d, y: p.y + t.x * d };
  });
}
function wavy(pts) {   // amplitude 3, period 14
  const fine = along(pts, 2);
  return fine.map((p, i) => {
    const t = tangentAt(fine, i), s = 3 * Math.sin(i * 2 * 2 * Math.PI / 14);
    return { x: p.x - t.y * s, y: p.y + t.x * s };
  });
}

const svgEl = (tag, attrs = {}, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};

// ---- text measure: advance width and font box, which is the rect the text occupies on the page. No DOM
const measureCtx = document.createElement('canvas').getContext('2d');
function measure(text, px) {            // no small-caps here: the embedded face has none, so .mk-caps sets at full width
  measureCtx.font = `500 ${px}px "Alegreya Sans", "Gentium Book Plus", sans-serif`;
  const m = measureCtx.measureText(text);
  return { w: m.width, asc: m.fontBoundingBoxAscent, h: m.fontBoundingBoxAscent + m.fontBoundingBoxDescent };
}

// ---- orthogonal router, the last resort: Dijkstra on the lines given by obstacle edges, so a corridor of any width is found.
// A route leaves a port along its normal and arrives along its normal. `crowd(a, b)` prices a leg that runs along a drawn line.
const LEAVE = { right: 0, left: 1, bottom: 2, top: 3 }, ARRIVE = { left: 0, right: 1, top: 2, bottom: 3 };
function orthogonal(sources, targets, O, m, B, crowd) {
  const line = (vals, lo, hi) => {
    const s = [...new Set(vals.map(r1))].filter((v) => v >= lo && v <= hi).sort((a, b) => a - b);
    return [...new Set(s.flatMap((v, i) => (i ? [(s[i - 1] + v) / 2, v] : [v])))];
  };
  const xs = line([...O.flatMap((r) => [r.x - m - 1, r.x + r.w + m + 1]), ...sources.map((p) => p.x), ...targets.map((p) => p.x)], B.x0, B.x1);
  const ys = line([...O.flatMap((r) => [r.y - m - 1, r.y + r.h + m + 1]), ...sources.map((p) => p.y), ...targets.map((p) => p.y)], B.y0, B.y1);
  const W = xs.length, id = (i, j, d) => ((j * W + i) << 2) | d;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]], TURN = 60;
  const open = new Uint8Array(W * ys.length);    // 0 unknown, 1 free, 2 blocked
  const freeAt = (i, j) => {
    const c = j * W + i;
    if (!open[c]) { const p = { x: xs[i], y: ys[j] }; open[c] = O.some((r) => within(p, r, m)) ? 2 : 1; }
    return open[c] === 1;
  };
  const legs = new Map();                        // leg -> extra cost, or Infinity. One entry however many directions cross it
  const leg = (i, j, ii, jj) => {
    const lo = Math.min(j * W + i, jj * W + ii), k = lo * 2 + (j === jj ? 0 : 1);
    if (legs.has(k)) return legs.get(k);
    const a = { x: xs[i], y: ys[j] }, b = { x: xs[ii], y: ys[jj] }, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const extra = !freeAt(ii, jj) || O.some((r) => within(mid, r, m)) ? Infinity : crowd(a, b);
    legs.set(k, extra);
    return extra;
  };
  const best = new Map(), from = new Map(), heap = [];
  const push = (cost, n) => {
    heap.push([cost, n]);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], end = heap.pop();
    if (heap.length) {
      heap[0] = end;
      for (let i = 0; ;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
        if (heap[i][0] <= heap[c][0]) break;
        [heap[i], heap[c]] = [heap[c], heap[i]]; i = c;
      }
    }
    return top;
  };
  const at = (p) => [xs.findIndex((v) => Math.abs(v - r1(p.x)) < .06), ys.findIndex((v) => Math.abs(v - r1(p.y)) < .06)];
  const goal = new Map();
  for (const p of targets) {
    const [i, j] = at(p);
    if (i < 0 || j < 0) continue;
    const c = j * W + i;
    if (!goal.has(c)) goal.set(c, new Set());
    goal.get(c).add(ARRIVE[p.side]);
  }
  for (const p of sources) {
    const [i, j] = at(p);
    if (i < 0 || j < 0) continue;
    const n = id(i, j, LEAVE[p.side]);
    best.set(n, 0); push(0, n);
  }
  while (heap.length) {
    const [cost, n] = pop();
    if (cost > (best.get(n) ?? Infinity)) continue;
    const d = n & 3, cell = n >> 2, i = cell % W, j = (cell - i) / W;
    if (goal.get(cell)?.has(d) && cost > 0) {
      const out = [];
      for (let c = n; c !== undefined; c = from.get(c)) { const k = c >> 2, ii = k % W; out.unshift({ x: xs[ii], y: ys[(k - ii) / W] }); }
      return out.filter((p, q) => !q || dist(p, out[q - 1]) > .01);
    }
    for (let e = 0; e < 4; e++) {
      if (cost === 0 && e !== d) continue;       // no turn on the port
      const ii = i + DIRS[e][0], jj = j + DIRS[e][1];
      if (ii < 0 || jj < 0 || ii >= W || jj >= ys.length) continue;
      const extra = leg(i, j, ii, jj);
      if (extra === Infinity) continue;
      const c2 = cost + Math.abs(xs[ii] - xs[i]) + Math.abs(ys[jj] - ys[j]) + extra + (e === d ? 0 : TURN), m2 = id(ii, jj, e);
      if (c2 < (best.get(m2) ?? Infinity)) { best.set(m2, c2); from.set(m2, n); push(c2, m2); }
    }
  }
  return null;
}
/** Corner points to a polyline with rounded corners. */
function rounded(corners, radius = 12) {
  const clean = corners.filter((p, i) => {
    const a = corners[i - 1], b = corners[i + 1];
    return !a || !b || Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > .01;
  });
  const legs = [];
  let last = clean[0];
  for (let i = 1; i < clean.length - 1; i++) {
    const p = clean[i], a = clean[i - 1], b = clean[i + 1];
    const r = Math.min(radius, dist(p, a) / 2, dist(p, b) / 2);
    const ta = dist(p, a) || 1, tb = dist(p, b) || 1;
    const p1 = { x: p.x + (a.x - p.x) * r / ta, y: p.y + (a.y - p.y) * r / ta }, p2 = { x: p.x + (b.x - p.x) * r / tb, y: p.y + (b.y - p.y) * r / tb };
    legs.push(straight(last, p1), cubic(p1, p, p, p2));
    last = p2;
  }
  legs.push(straight(last, clean[clean.length - 1]));
  return chain(...legs);
}

const marksOf = (s) => [...(s?.marks?.keep ?? []), ...(s?.marks?.add ?? [])];

export function createMarks({ front, back, env }) {
  const doc = front.ownerDocument;
  const mount = (svg) => Object.fromEntries(['brackets', 'rings', 'arrows', 'chips', 'labels'].map((name) => {   // paint order
    const g = svgEl('g', { class: `mkl mkl-${name}` });
    svg.append(g);
    return [name, g];
  }));
  const layers = { front: mount(front), back: mount(back) };
  const leaders = svgEl('g', { class: 'mkl mkl-leaders' });
  back.prepend(leaders);

  const drawn = new Map();       // key -> { g, label, sig, base, rev, dormant, used, boxes, holes }
  let rings = { sig: null, els: new Map() };
  let recs = [], prevL = null;
  const lineOf = new Map();

  /** A client rect in stage px. The SVG's own matrix is the map, so this holds in any viewport. */
  function toStage(n) {
    const r = n.getBoundingClientRect(), m = front.getScreenCTM();
    return { x: (r.left - m.e) / m.a, y: (r.top - m.f) / m.d, w: r.width / m.a, h: r.height / m.d };
  }
  function shown(n) {
    const cs = getComputedStyle(n);
    return cs.visibility !== 'hidden' && parseFloat(cs.opacity) > .01;
  }
  /** Gloss rects by id. The env does not list them, so they are read from the spans. */
  function glossRects() {
    const out = new Map();
    for (const n of doc.querySelectorAll('#glosses .gl')) {
      if (!n.textContent || !shown(n)) continue;
      const r = toStage(n);
      if (r.w > 0) out.set(n.dataset.id, r);
    }
    return out;
  }
  function tlOf(type) {
    if (lineOf.has(type)) return lineOf.get(type);
    const n = svgEl('g', { 'data-c': type });
    front.append(n);
    const tl = getComputedStyle(n).getPropertyValue('--tl').trim() || 'solid';
    n.remove();
    lineOf.set(type, tl);
    return tl;
  }

  // ---- the plan's working context
  function contextFor(state) {
    const gloss = glossRects();
    const spine = state.spine !== 'off';
    const en = spine ? [...doc.querySelectorAll('[data-slot]')].filter(shown).map(toStage).filter((r) => r.w > 0) : [];
    const dx = (env.W - 1920) / 2;
    const stroked = new Map();   // 8 px cell -> points, for "does this run along another line"
    const cellKey = (x, y) => (Math.floor(x / SAMPLE) << 12) ^ Math.floor(y / SAMPLE);
    const words = Object.keys(state.st ?? {}).filter((id) => env.visible(id));
    const tags = Object.keys(state.tags ?? {}).map((id) => env.tagRect(id)).filter(Boolean);
    const ctx = {
      state, gloss, en, dx, tags,
      O: [...env.obstacles(), ...gloss.values()],
      tight: [...words.map((id) => tightOf(env.ink(id))), ...tags, ...gloss.values()],   // tier 1: word and underline, glosses still solid
      inked: [...words.map((id) => env.ink(id)), ...tags],   // tier 2: no gloss
      bodies: [...words.map((id) => bodyOf(env.ink(id))), ...tags],   // tier 3: what no line may touch
      letters: [...words.map((id) => lettersOf(env.ink(id))), ...tags],   // what no rail may touch where lines are too tight for more
      bodyGloss: [...words.map((id) => bodyOf(env.ink(id))), ...tags, ...gloss.values()],
      lettersGloss: [...words.map((id) => lettersOf(env.ink(id))), ...tags, ...gloss.values()],
      later: [],                 // labels, set once every line and chip is down
      short: false,              // this board sets grammatical labels short
      crowded: false,            // a label found no free rect near its line
      B: { x0: 6, x1: env.W - 6, y0: ZONE_TOP, y1: spine ? BOARDS_END : LEDGER_TOP },
      taken: [],                 // label and chip rects
      rails: [],
      stroke(pts) {
        for (const p of along(pts, 4)) {
          const k = cellKey(p.x, p.y);
          if (!stroked.has(k)) stroked.set(k, []);
          stroked.get(k).push(p);
        }
      },
      near(p, r) {
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          const list = stroked.get(cellKey(p.x + i * SAMPLE, p.y + j * SAMPLE));
          if (list?.some((q) => dist(p, q) < r)) return true;
        }
        return false;
      },
      /** A label or chip may stand here: on no text, label, line or English, and inside the zone. */
      free(r, overLines = false) {
        const { B } = ctx;
        if (r.x < B.x0 || r.x + r.w > B.x1 || r.y < B.y0 || r.y + r.h > B.y1) return false;
        if (ctx.O.some((o) => overlaps(r, o, 2)) || ctx.taken.some((o) => overlaps(r, o, LABEL_GAP_X, LABEL_GAP_Y)) || en.some((o) => overlaps(r, o, 2, EN_GAP))) return false;
        if (overLines) return true;
        for (let x = r.x; ; x = Math.min(x + 6, r.x + r.w)) {
          for (let y = r.y; ; y = Math.min(y + 6, r.y + r.h)) {
            if (ctx.near({ x, y }, 5)) return false;
            if (y >= r.y + r.h) break;
          }
          if (x >= r.x + r.w) break;
        }
        return true;
      },
    };
    return ctx;
  }

  // ---- endpoints
  /** The word without its accents and descenders. Ink says .10..1.215 em, which overlaps the next line at pitch 60. */
  function bodyOf(ink) {
    const size = ink.h / INK_H, top = ink.y - INK_T * size;
    return { x: ink.x, y: top + BODY_T * size, w: ink.w, h: (BODY_B - BODY_T) * size };
  }
  function tightOf(ink) {
    const size = ink.h / INK_H, top = ink.y - INK_T * size;
    return { x: ink.x, y: top + BODY_T * size, w: ink.w, h: (TIGHT_B - BODY_T) * size };
  }
  function lettersOf(ink) {
    const size = ink.h / INK_H, top = ink.y - INK_T * size;
    return { x: ink.x, y: top + LETTER_T * size, w: ink.w, h: (BASE - LETTER_T) * size };
  }
  /** An end as a tier sees it: ports stand off what that tier treats as solid. */
  function endFor(E, tier, ctx) {
    if (!tier || !E.ids?.length) return E;
    const inks = E.ids.map((id) => env.ink(id)), hard = tier === 1 ? inks.map(tightOf) : tier === 2 ? inks : inks.map(bodyOf);
    const cells = E.ids.map((id, i) => union([hard[i], env.tagRect(id), tier === 1 ? ctx.gloss.get(id) : null].filter(Boolean)));
    return { ...E, top: Math.min(...cells.map((c) => c.y)), bottom: Math.max(...cells.map((c) => c.y + c.h)) };
  }
  function plainEnd(r, ids = []) {
    return { ink: r, top: r.y, bottom: r.y + r.h, mid: r.y + r.h / 2, ids };
  }
  function runEnd(ids, ctx) {
    const inks = ids.map((id) => env.ink(id));
    const cells = ids.map((id, i) => union([inks[i], ctx.gloss.get(id), env.tagRect(id)].filter(Boolean)));
    const rects = ids.map((id) => env.rect(id));
    return {
      ink: union(inks), ids,
      top: Math.min(...cells.map((c) => c.y)), bottom: Math.max(...cells.map((c) => c.y + c.h)),
      mid: rects[0].y + rects[0].h / 2,
    };
  }
  /** Visible runs of a set, one per line, in reading order. */
  function runsOf(ids, ctx) {
    const runs = [];
    for (const id of ids.filter((i) => env.visible(i))) {
      const y = env.ink(id).y, last = runs[runs.length - 1];
      if (last && Math.abs(last.y - y) < 1) last.ids.push(id); else runs.push({ y, ids: [id] });
    }
    return runs.map((r) => runEnd(r.ids, ctx));
  }
  function endsOf(ref, ids, ctx) {
    if (typeof ref === 'string') {
      if (ref.startsWith('en:')) { const r = env.slotRects(ref.slice(3))[0]; return r ? [plainEnd(r)] : []; }
      if (ref.startsWith('box:')) { const r = env.box(ref.slice(4)); return r ? [{ ...plainEnd(r), box: ref.slice(4) }] : []; }
      if (ref.startsWith('hole:')) { const r = env.hole(ref.slice(5)); return r ? [{ ...plainEnd(r), hole: ref.slice(5) }] : []; }
    }
    return runsOf(ids ?? [], ctx);
  }
  const gapBetween = (a, b) => Math.hypot(Math.max(0, a.x - b.x - b.w, b.x - a.x - a.w), Math.max(0, a.y - b.y - b.h, b.y - a.y - a.h));
  /** A set endpoint uses the visible run nearest the other end. */
  function nearest(as, bs) {
    let best = [as[0], bs[0]], score = Infinity;
    for (const a of as) for (const b of bs) {
      const g = gapBetween(a.ink, b.ink);
      if (g < score) { score = g; best = [a, b]; }
    }
    return best;
  }

  // ---- ports and routes
  const NORMAL = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
  function port(end, side, toward) {
    const { ink } = end, cx = ink.x + ink.w / 2;
    if (side === 'left') return { x: ink.x - PORT, y: end.mid };
    if (side === 'right') return { x: ink.x + ink.w + PORT, y: end.mid };
    const reach = end.ids.length > 1 ? Math.max(0, ink.w / 2 - 14) : ink.w / 4;
    return { x: cx + clamp(toward - cx, -reach, reach), y: side === 'top' ? end.top - PORT : end.bottom + PORT };
  }
  /** Tangent to each port's normal. Same-side pairs share one control line, so the apex is level. */
  function bend(a, sa, b, sb, c) {
    const [ax, ay] = NORMAL[sa], [bx, by] = NORMAL[sb];
    if (sa === sb && ay) { const y = (ay < 0 ? Math.min(a.y, b.y) : Math.max(a.y, b.y)) + ay * c; return cubic(a, { x: a.x, y }, { x: b.x, y }, b); }
    if (sa === sb) { const x = (ax < 0 ? Math.min(a.x, b.x) : Math.max(a.x, b.x)) + ax * c; return cubic(a, { x, y: a.y }, { x, y: b.y }, b); }
    return cubic(a, { x: a.x + ax * c, y: a.y + ay * c }, { x: b.x + bx * c, y: b.y + by * c }, b);
  }
  const LEVEL = [['top', 'top'], ['bottom', 'bottom'], ['right', 'left']];
  const ACROSS = [['bottom', 'top'], ['left', 'left'], ['right', 'right'], ['left', 'top'], ['right', 'top'], ['bottom', 'left'], ['bottom', 'right'],
    ['top', 'top'], ['bottom', 'bottom'], ['top', 'left'], ['top', 'right'], ['left', 'bottom'], ['right', 'bottom']];

  /** Candidates in this order: via, then above, below, side; low and high within each. */
  function* candidates(A, B, m) {
    const level = Math.abs(A.mid - B.mid) < .5 * Math.min(A.ink.h, B.ink.h);
    const leftFirst = A.ink.x <= B.ink.x;
    if (m.via === 'line' && level) {
      const [sa, sb] = leftFirst ? ['right', 'left'] : ['left', 'right'];
      yield { pts: straight(port(A, sa), port(B, sb)) };
    }
    const down = A.mid <= B.mid;
    let pairs = level
      ? LEVEL.map(([a, b]) => (a === 'right' && !leftFirst ? ['left', 'right'] : [a, b]))
      : ACROSS.map(([u, l]) => (down ? [u, l] : [l, u]));
    const wants = { above: 'top', below: 'bottom', left: 'left', right: 'right' }[m.via];
    if (wants) pairs = [...pairs.filter((p) => p.includes(wants)), ...pairs.filter((p) => !p.includes(wants))];
    const far = Math.abs(A.ink.x - B.ink.x) >= 300;
    const heights = m.arc === 'high' || (!m.arc && far && m.rel !== 'agrees' && m.rel !== 'modifies') ? [HIGH, LOW] : [LOW, HIGH];
    for (const [sa, sb] of pairs) {
      const cb = B.ink.x + B.ink.w / 2, ca = A.ink.x + A.ink.w / 2;
      const a = port(A, sa, cb), b = port(B, sb, ca);
      if (sa === 'right' || sb === 'right' || sa === 'left' || sb === 'left') {
        if (level && sa !== sb) { if ((b.x - a.x) * (leftFirst ? 1 : -1) > 12) yield { pts: straight(a, b) }; continue; }
        const reach = sa === sb ? [BULGE_LOW, BULGE_HIGH] : [.4, .8].map((f) => clamp(f * dist(a, b), 40, 300));
        for (const c of reach) yield { pts: bend(a, sa, b, sb, c / .75) };
      } else if (sa === sb) {
        for (const h of heights) yield { pts: bend(a, sa, b, sb, h / .75), arc: h };
      } else {
        const gap = Math.abs(b.y - a.y);
        for (const c of [clamp(gap / 2, 14, 140), clamp(gap * .9, 14, 240)]) yield { pts: bend(a, sa, b, sb, c) };
      }
    }
  }
  const inBounds = (pts, B) => pts.every((p) => p.x >= B.x0 && p.x <= B.x1 && p.y >= B.y0 - 90 && p.y <= B.y1);
  const clear = (pts, O, m) => !pts.some((p) => O.some((r) => within(p, r, m)));
  /** Runs along a line already drawn, or through a label: crossing arcs must differ. */
  function shadows(pts, ctx) {
    let run = 0;
    for (const p of along(pts, SAMPLE)) {
      if (ctx.near(p, 5)) { if (++run > 4) return true; } else run = 0;
    }
    return ctx.taken.some((r) => pts.some((p) => within(p, r, 2)));
  }
  const strokeOf = (m) => (m.rank === 1 ? 6 : 3);

  /** Every port of an end, for the router: a run offers each word as well as the point facing the other end. */
  function portsOf(E, toward, O, m) {
    const xs = [toward, ...(E.ids ?? []).map((id) => { const r = env.ink(id); return r.x + r.w / 2; })];
    const out = [];
    for (const side of ['top', 'bottom', 'left', 'right']) {
      for (const x of side === 'top' || side === 'bottom' ? xs : [toward]) {
        const p = { ...port(E, side, x), side };
        if (!O.some((r) => within(p, r, m))) out.push(p);
      }
    }
    return out;
  }
  function router(A, B, O, margin, ctx) {
    const cx = (E) => E.ink.x + E.ink.w / 2;
    const s = portsOf(A, cx(B), O, margin), t = portsOf(B, cx(A), O, margin);
    if (!s.length || !t.length) return null;
    const crowd = (a, b) => {
      const n = Math.max(1, Math.ceil(dist(a, b) / SAMPLE));
      let hit = 0;
      for (let i = 0; i <= n; i++) if (ctx.near({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }, 5)) hit++;
      return dist(a, b) * CROWD * hit / (n + 1);
    };
    const found = orthogonal(s, t, O, margin, ctx.B, crowd);
    return found ? rounded(found) : null;
  }
  /** Tier by tier: curves, then the router. The last tier also tries wider then narrower clearance. */
  function route(A, B, m, ctx, dock) {
    const stroke = strokeOf(m), wide = stroke / 2 + 2;
    const spare = (list) => (dock ? list.filter((r) => !overlaps(r, dock)) : list);
    const tiers = [ctx.O, ctx.tight, ctx.inked, ctx.bodies].map(spare), last = tiers.length - 1;
    for (let t = 0; t < tiers.length; t++) {
      const margin = t === 1 ? stroke / 2 + 1 : wide;   // the channel under the underline is about 13 px
      const O = tiers[t], a = endFor(A, t, ctx), b = endFor(B, t, ctx);
      const all = [...candidates(a, b, m)].filter((c) => inBounds(c.pts, ctx.B) && clear(c.pts, O, margin));
      const pick = all.find((c) => !shadows(c.pts, ctx));
      if (pick) return pick.pts;
      for (const q of t === last ? [margin + 3, margin, stroke / 2 + .5] : [margin]) {
        const found = router(a, b, O, q, ctx);
        if (found) return found;
      }
      if (all.length) return all[0].pts;
    }
    const every = [...candidates(A, B, m)].filter((c) => inBounds(c.pts, ctx.B));   // nothing clear: the zero-hit test will name this mark
    return (every[0] ?? { pts: straight(port(A, 'right'), port(B, 'left')) }).pts;
  }
  function hookRoute(A, m, ctx, O) {
    const margin = strokeOf(m) / 2 + 2;
    for (const side of ['bottom', 'right', 'top', 'left']) {
      const a = port(A, side, A.ink.x + A.ink.w / 2);
      const [nx, ny] = NORMAL[side];
      for (const s of [1, -1]) {
        const b = { x: a.x + nx * 34 + ny * s * 48, y: a.y + ny * 34 + nx * s * 48 };
        const pts = cubic(a, { x: a.x + nx * 30, y: a.y + ny * 30 }, { x: b.x - ny * s * 20, y: b.y - nx * s * 20 }, b);
        if (inBounds(pts, ctx.B) && clear(pts, O, margin)) return pts;
      }
    }
    return straight(port(A, 'bottom', A.ink.x), { x: A.ink.x + 40, y: A.bottom + 40 });
  }
  /** The adjacent `connects`. Square tie below the line, or between lines, with a node at the coordinator. */
  function squareTie(A, B, C, m, ctx) {
    const margin = strokeOf(m) / 2 + 2;
    const cx = (E) => E.ink.x + E.ink.w / 2;
    const U = A.mid <= B.mid ? A : B, L = U === A ? B : A;
    const rails = [
      { y: Math.max(A.bottom, B.bottom, C.bottom) + PORT + 10, sides: [1, 1, 1] },
      { y: Math.max(A.bottom, B.bottom, C.bottom) + PORT + 22, sides: [1, 1, 1] },
    ];
    if (L.top - U.bottom > 2 * PORT + 8) {
      const y = (U.bottom + L.top) / 2;
      rails.push({ y, sides: [A === U ? 1 : -1, B === U ? 1 : -1, C.mid <= y ? 1 : -1] });
    }
    rails.push({ y: Math.min(A.top, B.top, C.top) - PORT - 10, sides: [-1, -1, -1] });
    for (const { y, sides } of rails) {
      const foot = (E, s) => ({ x: cx(E), y: (s > 0 ? E.bottom + PORT : E.top - PORT) });
      const a = foot(A, sides[0]), b = foot(B, sides[1]), c = foot(C, sides[2]);
      const path = polyline(a, { x: a.x, y }, { x: b.x, y }, b);
      const stem = polyline(c, { x: c.x, y });
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      const rail = c.x < lo || c.x > hi ? polyline({ x: c.x, y }, { x: c.x < lo ? lo : hi, y }) : [];
      const whole = [...path, ...stem, ...rail];
      if (inBounds(whole, ctx.B) && clear(whole, ctx.O, margin)) return { pts: path, extra: [stem, ...(rail.length ? [rail] : [])], node: { x: c.x, y } };
    }
    return null;
  }

  // ---- text placement
  function textOp(cls, text, r, px, extra = {}) {
    const { asc } = measure(text, px);
    return ['text', { class: cls, x: r1(r.x), y: r1(r.y + asc), ...extra }, text];
  }
  /** The free rect nearest the given points, level with them by preference, with `d` its distance from them and `clean` false if a line runs behind it. Null only if the zone has no room at all. */
  function spot(w, h, pts, ctx, own = []) {
    const { B } = ctx, near = along(pts, Math.max(24, polyLength(pts) / 24));
    const rects = [];
    for (let y = B.y0; y + h <= B.y1; y += 5) {
      for (let x = B.x0; x + w <= B.x1; x += 10) {
        let d = Infinity;
        for (const p of near) {
          const dx = Math.max(0, x - p.x, p.x - x - w), dy = Math.max(0, y - p.y, p.y - y - h);
          d = Math.min(d, dx * dx + dy * dy * .4);
        }
        rects.push({ x, y, w, h, d });
      }
    }
    rects.sort((a, b) => a.d - b.d);
    // Of the nearest few distinct rects, the first with no other word between it and the line: across a row of Greek it reads as that row's.
    const others = ctx.bodies.filter((b) => !own.some((id) => { const o = bodyOf(env.ink(id)); return o.x === b.x && o.y === b.y; }));
    const open = [];
    for (const c of rects) {
      if (open.length >= 6 || (open.length && Math.sqrt(c.d) > LABEL_REACH)) break;
      if (!open.some((o) => overlaps(c, o)) && ctx.free(c)) open.push(c);
    }
    const seen = (c) => {
      const m = { x: c.x + w / 2, y: c.y + h / 2 }, p = near.reduce((a, b) => (dist(a, m) <= dist(b, m) ? a : b));
      return !along([m, p], 6).some((q) => others.some((b) => within(q, b, 0)));
    };
    let r = open.find(seen) ?? open[0], clean = !!r;
    if (!r) {                                       // full zone: a line may pass behind the halo, as little of one as there is to be had
      let least = Infinity, seen = 0;
      for (const c of rects) {
        if (!ctx.free(c, true)) continue;
        let n = 0;
        for (let x = c.x; x <= c.x + w; x += 8) for (let y = c.y + 6; y <= c.y + h - 6; y += 6) if (ctx.near({ x, y }, 4)) n++;
        if (n < least) { least = n; r = c; }
        if (++seen >= 120) break;
      }
    }
    return r ? { x: r.x, y: r.y, w, h, d: Math.sqrt(r.d), clean } : null;
  }
  /** On the free side: away from the chord first, then the other; the middle first, then toward the ends. */
  function labelAlong(full, pts, ctx, it) {
    const text = ctx.short ? shorten(full) : full;
    const { w, h } = measure(text, LABEL_PX);
    const even = along(pts, 4), n = even.length - 1;
    const a = even[0], b = even[n], mid = even[n >> 1];
    const chord = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const out = dist(mid, chord) > 2 ? { x: mid.x - chord.x, y: mid.y - chord.y } : { x: 0, y: -1 };
    for (const stack of [0, 1, 2, 3]) for (const f of [.5, .4, .6, .3, .7, .2, .8]) {
      const i = Math.round(n * f), t = tangentAt(even, i);
      for (const s of [1, -1]) {
        const nrm = { x: -t.y, y: t.x }, sign = (nrm.x * out.x + nrm.y * out.y >= 0 ? 1 : -1) * s;
        const off = Math.abs(nrm.x) * w / 2 + Math.abs(nrm.y) * h / 2 + 7 + stack * (h + 6);
        const c = { x: even[i].x + nrm.x * sign * off, y: even[i].y + nrm.y * sign * off };
        const r = { x: c.x - w / 2, y: c.y - h / 2, w, h };
        if (ctx.free(r)) return settleLabel(text, r, ctx, it);
      }
    }
    const r = spot(w, h, even, ctx, it.used);
    if (!r?.clean || r.d > LABEL_REACH) ctx.crowded = true;
    return settleLabel(text, r ?? { x: clamp(mid.x - w / 2, ctx.B.x0, ctx.B.x1 - w), y: Math.max(ctx.B.y0, mid.y - h - 7), w, h }, ctx, it);
  }
  function settleLabel(text, r, ctx, it, cls = 'mk-label', px = LABEL_PX) {
    ctx.taken.push(r);
    it.boxes.push(r);
    it.label = textOp(cls, text, r, px);
    return r;
  }
  /** Rects in order of preference, then the nearest free rect to `home`. */
  function labelAt(text, tries, ctx, it, cls = 'mk-label', px = LABEL_PX, home = null) {
    const { w, h } = measure(text, px);
    const rects = tries(w, h);
    const r = rects.find((c) => ctx.free(c)) ?? spot(w, h, home ?? [{ x: rects[0].x + w / 2, y: rects[0].y + h / 2 }], ctx) ?? rects[0];
    settleLabel(text, r, ctx, it, cls, px);
  }

  // ---- brackets
  function railLine(pts, tl) {
    const attrs = { class: 'mk-bl', 'data-tl': tl };
    if (tl === 'double') return [parallel(pts, 2), parallel(pts, -2)].map((p) => ['path', { ...attrs, d: toD(p) }]);
    if (tl === 'wavy') return [['path', { ...attrs, d: toD(wavy(pts)) }]];
    return [['path', { ...attrs, d: toD(pts) }]];
  }
  /** A rail with ticks toward the text, on the first level that touches no text and no other rail. */
  function railFor(cells, inks, ctx) {
    const x0 = Math.min(...inks.map((r) => r.x)), x1 = Math.max(...inks.map((r) => r.x + r.w));
    const below = Math.max(...cells.map((c) => c.y + c.h)), above = Math.min(...cells.map((c) => c.y));
    const fit = (y, tick, O = ctx.O, apart = 6) => {
      const pts = polyline({ x: x0, y: y + tick }, { x: x0, y }, { x: x1, y }, { x: x1, y: y + tick });
      if (!clear(pts, O, 1.5) || !inBounds(pts, ctx.B)) return null;
      if (ctx.rails.some((r) => Math.abs(r.y - y) < apart && r.x0 < x1 && x0 < r.x1)) return null;
      return { y, tick, x0, x1 };
    };
    for (let n = 0; n < 6; n++) { const f = fit(below + RAIL_GAP + TICK + n * RAIL_STEP, -TICK); if (f) return f; }
    for (let n = 0; n < 6; n++) { const f = fit(above - RAIL_GAP - TICK - n * RAIL_STEP, TICK); if (f) return f; }
    // Lines too tight for that: the channel under the underline, over the next line's letters; if that is out of bounds, the channel over the line.
    const size = inks[0].h / INK_H, ink = Math.max(...inks.map((r) => r.y + r.h)), head = Math.min(...inks.map((r) => r.y));
    const low = cells.some((c, i) => c.y + c.h > inks[i].y + inks[i].h) ? below + 3 : ink - INK_T * size + 3;
    const high = cells.some((c, i) => c.y < inks[i].y) ? above - 3 : head + 2;
    const down = [0, 4, 8, 12].map((d) => low + d), up = [0, -4, 4, -8, 8].map((d) => high + d);
    const bodyLow = ink - INK_T * size - .075 * size, bodyHigh = head + (BODY_T - INK_T) * size;   // the word's letters and accents, underline apart
    const nearDown = [3, 6, 9, 12, 15].map((d) => bodyLow + d), nearUp = [3, 6, 9, 12, 15].map((d) => bodyHigh - d);
    for (const [O, apart] of [[ctx.tight, 6], [ctx.tight, 3.5], [ctx.bodyGloss, 6], [ctx.bodyGloss, 3.5], [ctx.lettersGloss, 6], [ctx.lettersGloss, 3.5], [ctx.bodies, 3.5], [ctx.letters, 3.5], [ctx.letters, 0]]) {
      for (const y of [...down, ...nearDown]) { const f = fit(y, -5, O, apart); if (f) return f; }
      for (const y of [...up, ...nearUp]) { const f = fit(y, 5, O, apart); if (f) return f; }
    }
    return { y: low, tick: -5, x0, x1 };
  }
  function planBracket(m, ctx, it) {
    const tl = m.type === 'neutral' ? 'solid' : tlOf(m.type);
    if (m.box) return planOpen(m, ctx, it, tl);
    if (m.en) {
      env.slotRects(m.en).forEach((r) => {
        const pts = polyline({ x: r.x, y: r.y + TICK }, { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + TICK });
        it.ops.push(...railLine(pts, tl));
        it.paths.push(pts);
        it.boxes.push({ x: r.x, y: r.y, w: r.w, h: TICK });
      });
      return null;
    }
    let tailEnd = null;
    for (const [first, last] of m.runs ?? []) {
      const ids = m.ids.slice(m.ids.indexOf(first), m.ids.indexOf(last) + 1).filter((id) => env.visible(id));
      it.used.push(...ids);
      const lines = [];
      for (const id of ids) {
        const y = env.ink(id).y, top = lines[lines.length - 1];
        if (top && Math.abs(top.y - y) < 1) top.ids.push(id); else lines.push({ y, ids: [id] });
      }
      lines.forEach((line, n) => {
        const inks = line.ids.map((id) => env.ink(id));
        const cells = line.ids.map((id, i) => union([inks[i], ctx.gloss.get(id), env.tagRect(id)].filter(Boolean)));
        const f = railFor(cells, inks, ctx);
        ctx.rails.push(f);
        const openL = n > 0, openR = n < lines.length - 1;
        const pts = polyline(...[
          ...(openL ? [] : [{ x: f.x0, y: f.y + f.tick }]), { x: f.x0, y: f.y }, { x: f.x1, y: f.y }, ...(openR ? [] : [{ x: f.x1, y: f.y + f.tick }]),
        ]);
        it.ops.push(...railLine(pts, tl));
        it.paths.push(pts);
        it.boxes.push({ x: f.x0, y: Math.min(f.y, f.y + f.tick), w: f.x1 - f.x0, h: TICK });
        ctx.stroke(pts);
        if (n === 0 && tailEnd) {
          const a = { x: tailEnd.x1, y: tailEnd.y }, b = { x: f.x0, y: f.y };
          const tie = Math.abs(a.y - b.y) < 1 ? straight(a, b) : route(plainEnd({ ...a, w: 0, h: 0 }), plainEnd({ ...b, w: 0, h: 0 }), { rank: 3 }, ctx);
          it.ops.push(['path', { class: 'mk-btie', d: toD(tie) }]);
          it.paths.push(tie);
          ctx.stroke(tie);
          if (m.tie) ctx.later.push(() => labelAlong(m.tie, tie, ctx, it));
        }
        if (n === lines.length - 1) tailEnd = f;
      });
    }
    if (m.label && tailEnd) {
      const { x0, x1, y } = tailEnd;
      ctx.later.push(() => labelAt(m.label, (w, h) => [
        { x: x1 - w, y: y + 6, w, h }, { x: x1 + 10, y: y - h / 2, w, h }, { x: x1 - w, y: y - h - 6, w, h }, { x: x0, y: y + 6, w, h }, { x: x0 - w - 10, y: y - h / 2, w, h },
      ], ctx, it, 'mk-label mk-caps', LABEL_PX, [{ x: x1, y }]));
    }
    return null;
  }
  /** Corners only, the lid above; a closer word stretches the opening to its right edge. A corner a gloss or tag stands on is left out. */
  function planOpen(m, ctx, it, tl) {
    const b = env.box(m.box);
    if (!b) return;
    it.boxes.push(b);
    it.boxNames.push(m.box);
    let x1 = b.x + b.w;
    if (m.closer && env.visible(m.closer)) { const c = env.ink(m.closer); x1 = Math.max(x1, c.x + c.w + PORT); it.used.push(m.closer); }
    const x0 = b.x, y0 = b.y - 2, y1 = b.y + b.h + 2;
    const corners = [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].map(([x, y, sx, sy]) => {   // shorter where a gloss stands
      const at = (L) => polyline({ x, y: y + sy * L }, { x, y }, { x: x + sx * L, y });
      return [CORNER, 12, 8].map(at).find((c) => clear(c, [...ctx.gloss.values(), ...ctx.tags], 1));
    }).filter(Boolean);
    for (const c of corners) { it.ops.push(...railLine(c, tl)); it.paths.push(c); }
    const text = m.lid ?? m.label;
    if (text) {
      ctx.later.push(() => labelAt(text, (w, h) => [
        { x: x0, y: y0 - h - 8, w, h }, { x: x0 + (x1 - x0 - w) / 2, y: y0 - h - 8, w, h }, { x: x0, y: y1 + 8, w, h },
      ], ctx, it, 'mk-label mk-lid', LABEL_PX, [{ x: x0, y: y0 }, { x: x1, y: y0 }]));
    }
    ctx.taken.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });   // the opening stays empty
  }

  // ---- the door
  function planDoor(m, ctx, it) {
    const { dx } = ctx;
    const { x0, x1, y, end } = DOOR;
    const pts = polyline({ x: x0 + dx, y: end }, { x: x0 + dx, y }, { x: x1 + dx, y }, { x: x1 + dx, y: end });
    it.ops.push(['path', { class: 'mk-door', d: toD(pts) }]);
    it.paths.push(pts);
    it.boxes.push({ x: x0 + dx, y, w: x1 - x0, h: end - y });
    ctx.rails.push({ y, x0: x0 + dx, x1: x1 + dx });
    ctx.stroke(pts);
  }

  // ---- arrows
  function glyphOp(name, p, t, scale = 1) {
    const g = GLYPHS[name];
    const deg = r1(Math.atan2(t.y, t.x) * 180 / Math.PI);
    return ['path', { class: `mk-glyph ${g.fill ? 'mk-fill' : 'mk-stroke'}`, 'data-g': name, d: g.d(scale), transform: `translate(${r1(p.x)} ${r1(p.y)}) rotate(${deg})` }];
  }
  /** Lines of one polyline in the mark's stroke. `predicate` is two parallel paths. */
  function strokeOps(m, pts) {
    if (m.rel !== 'predicate') return [['path', { class: 'mk-line', d: toD(pts) }]];
    const d = m.rank === 1 ? 2 : 1.4;
    return [parallel(pts, d), parallel(pts, -d)].map((p) => ['path', { class: 'mk-line', d: toD(p) }]);
  }
  function planArrow(m, ctx, it) {
    if (m.spine) {
      it.boxes.push(...[m.sa, m.sb].flatMap((s) => env.slotRects(s)));
      return;
    }
    const froms = endsOf(m.from, m.fromIds, ctx), tos = m.to == null ? [] : endsOf(m.to, m.toIds, ctx);
    if (!froms.length || (m.to != null && !tos.length)) return;
    const [A, B] = m.to == null ? [froms[0], null] : nearest(froms, tos);
    for (const E of [A, B]) {
      if (!E) continue;
      it.used.push(...E.ids);
      if (E.box) it.boxNames.push(E.box);
      if (E.hole) it.holeNames.push(E.hole);
    }
    const dock = m.dock && env.visible(m.dock) ? env.ink(m.dock) : null;
    if (dock) it.used.push(m.dock);

    let pts, extra = [], node = null;
    if (m.rel === 'connects' && m.at && B && env.visible(m.at)) {
      const tie = squareTie(A, B, runEnd([m.at], ctx), m, ctx);
      it.used.push(m.at);
      if (tie) ({ pts, extra, node } = tie);
    }
    pts ??= B ? route(A, B, m, ctx, dock) : hookRoute(A, m, ctx, dock ? ctx.O.filter((r) => !overlaps(r, dock)) : ctx.O);

    // "opens round that word": the stroke stops either side of the docked word.
    const clearOfDock = (p) => !dock || !within(p, dock, 10);
    const parts = [];
    for (const p of pts) {
      if (clearOfDock(p)) { if (!parts.length || parts[parts.length - 1].gap) parts.push([]); parts[parts.length - 1].push(p); }
      else if (parts.length) parts[parts.length - 1].gap = true;
    }

    const ends = ENDS[m.rel] ?? {};
    const scale = m.rank === 1 ? 1.5 : 1;
    const { tail } = ends, head = B ? ends.head : 'cup';
    parts.forEach((part, i) => {
      const line = trim(part, i === 0 && tail ? GLYPHS[tail].trim(scale) : 0, i === parts.length - 1 && head ? GLYPHS[head].trim(scale) : 0);
      it.ops.push(...strokeOps(m, line));
    });
    for (const e of extra) it.ops.push(['path', { class: 'mk-line', d: toD(e) }]);
    if (tail) it.ops.push(glyphOp(tail, pts[0], tangentAt(pts, 0), scale));
    if (head) it.ops.push(glyphOp(head, pts[pts.length - 1], tangentAt(pts, pts.length - 1), scale));
    if (node) it.ops.push(['circle', { class: 'mk-fill', cx: r1(node.x), cy: r1(node.y), r: 5 }]);
    if (m.failed) { const i = pts.length >> 1; it.ops.push(glyphOp('cross', pts[i], tangentAt(pts, i))); }

    it.paths.push(...parts, ...extra);
    it.reveal = pts;
    if (m.label) {
      if (dock) ctx.later.push(() => labelAt(m.label, (w, h) => {
        const x = dock.x + (dock.w - w) / 2;
        return [{ x, y: dock.y + dock.h + 4, w, h }, { x, y: dock.y - h - 2, w, h }];
      }, ctx, it));
      else ctx.later.push(() => labelAlong(m.label, pts, ctx, it));
    }
    ctx.stroke(pts);
    for (const e of extra) ctx.stroke(e);
  }

  // ---- chips, carets, notes, gap ties
  function planChip(m, ctx, it) {
    const refIsSlot = m.slot != null;
    const ends = refIsSlot ? env.slotRects(m.slot).slice(0, 1).map((r) => plainEnd(r)) : endsOf(m.at, m.atIds, ctx);
    if (!ends.length) return;
    const E = ends[0];
    it.used.push(...E.ids);
    const px = m.size ?? CHIP_PX, plain = !!m.under, pad = plain ? 0 : CHIP_PAD;
    const { w: tw, h: th } = measure(m.text, px);
    const w = tw + 2 * pad, h = plain ? th : Math.max(CHIP_H, th + 10);
    const cx = E.ink.x + E.ink.w / 2;
    const clampX = (x) => clamp(x, ctx.B.x0, ctx.B.x1 - w);
    const row = (y) => [0, -60, 60, -120, 120, -200, 200, -320, 320].map((s) => ({ x: clampX(cx - w / 2 + s), y, w, h }));
    const up = (n) => row(E.top - 6 - h - n * (h + 6)), down = (n) => row(E.bottom + 6 + n * (h + 6));
    const tries = plain ? [...down(0), ...down(1), ...up(0)] : [...up(0), ...up(1), ...down(0), ...down(1), ...up(2)];
    const r = tries.find((c) => ctx.free(c)) ?? spot(w, h, [{ x: cx, y: E.mid }], ctx) ?? tries[0];
    ctx.taken.push(r);
    it.boxes.push(r);
    if (!plain) it.ops.push(['rect', { class: 'mk-chip', x: r1(r.x), y: r1(r.y), width: r1(w), height: r1(h), rx: 6 }]);
    const ty = r.y + (h - th) / 2;
    it.ops.push(textOp(plain ? 'mk-chip-text mk-plain' : 'mk-chip-text', m.text, { x: r.x + pad, y: ty }, px, { 'font-size': px }));
  }
  /** A caret on the English, no stroke. Slot text that already prints the words keeps the caret alone. */
  function planSupplies(m, ctx, it) {
    const rects = env.slotRects(m.slot);
    if (!rects.length) return;
    const b = rects[rects.length - 1], x = b.x + b.w + 3, y = b.y + b.h - 4;
    const pts = polyline({ x: x - 7, y: y + 7 }, { x, y }, { x: x + 7, y: y + 7 });
    it.ops.push(['path', { class: 'mk-caret', d: toD(pts) }]);
    it.paths.push(pts);
    it.boxes.push({ x: x - 7, y, w: 14, h: 7 });
    const slot = doc.querySelector(`[data-slot="${CSS.escape(m.slot)}"]`);
    if (slot?.textContent.includes(m.text)) return;
    const { w, h } = measure(m.text, CHIP_PX);
    const tries = [{ x: x - w / 2, y: b.y - h - 2, w, h }, { x: x + 10, y: b.y + (b.h - h) / 2, w, h }, { x: x - w / 2, y: b.y + b.h + 8, w, h }];
    const fits = (r) => !ctx.en.some((o) => overlaps(r, o, 2)) && !ctx.O.some((o) => overlaps(r, o, 2));
    const r = tries.find(fits) ?? tries[0];
    it.boxes.push(r);
    it.ops.push(textOp('mk-chip-text', m.text, r, CHIP_PX, { 'font-size': CHIP_PX }));
  }
  /** A table anchor is a fixed cell. Any other anchor is a word group: the line of text under it, else over it, else the nearest free rect. */
  function planNote(m, ctx, it) {
    const t = /^table\.(\w+)(?:\.(\w+))?$/.exec(m.at);
    const { w, h } = measure(m.text, CHIP_PX);
    let r;
    if (t) r = { x: (TABLE.cols[t[2]] ?? TABLE.cols.pred) + ctx.dx, y: TABLE.y0 + TABLE.pitch * TABLE.rows.indexOf(t[1]) - h / 2, w, h };
    else {
      const ids = (ctx.state.view?.groups ?? []).filter((g) => g.at === m.at).flatMap((g) => g.tokens).filter((id) => env.visible(id));
      if (!ids.length) return;
      const E = union(ids.map((id) => env.ink(id))), x = clamp(E.x, ctx.B.x0, ctx.B.x1 - w);
      const tries = [{ x, y: E.y + E.h + 8, w, h }, { x, y: E.y - h - 8, w, h }];
      r = tries.find((c) => ctx.free(c)) ?? spot(w, h, [{ x: E.x + E.w / 2, y: E.y + E.h }], ctx) ?? tries[0];
    }
    ctx.taken.push(r);
    it.boxes.push(r);
    it.ops.push(textOp('mk-chip-text mk-note', m.text, r, CHIP_PX, { 'font-size': CHIP_PX }));
  }
  /** Orthogonal lines between the lines of the home layout, ticks on the exact words. */
  function planGap(m, ctx, it) {
    const as = endsOf(m.from, m.fromIds, ctx), bs = endsOf(m.to, m.toIds, ctx);
    if (!as.length || !bs.length) return;
    const [P, Q] = nearest(as, bs);
    it.used.push(...P.ids, ...Q.ids);
    const U = P.ink.y <= Q.ink.y ? P : Q, L = U === P ? Q : P;
    const cx = (E) => E.ink.x + E.ink.w / 2, under = (E) => E.ink.y + E.ink.h;
    const rows = [...new Set(ctx.O.map((r) => r1(r.y)))].sort((a, b) => a - b);
    const rowGap = rows.length > 1 ? Math.min(...rows.slice(1).map((v, i) => v - rows[i]).filter((v) => v > 4)) : 61;
    const chan = (E) => under(E) + Math.max(4, (rowGap - E.ink.h) / 2);
    const a = { x: cx(U), y: under(U) + 1 }, y1 = chan(U);
    let corners;
    if (L.ink.y < y1) {                                    // one line: down from each word and across
      corners = [a, { x: a.x, y: y1 }, { x: cx(L), y: y1 }, { x: cx(L), y: under(L) + 1 }];
    } else if (L.ink.y - y1 < rowGap) {                    // the next line: across, then down onto the word
      corners = [a, { x: a.x, y: y1 }, { x: cx(L), y: y1 }, { x: cx(L), y: L.ink.y - 1 }];
    } else {                                               // further: drop through a word gap
      const y2 = L.ink.y - Math.max(4, (rowGap - L.ink.h) / 2);
      const open = (x) => clear(straight({ x, y: y1 }, { x, y: y2 }), ctx.O, 1.5);
      let xv = cx(L);
      for (let s = 0; s < 960 && !open(xv); s += 2) { const t = cx(L) + (s % 4 ? s : -s); if (open(t)) { xv = t; break; } }
      corners = [a, { x: a.x, y: y1 }, { x: xv, y: y1 }, { x: xv, y: y2 }, { x: cx(L), y: y2 }, { x: cx(L), y: L.ink.y - 1 }];
    }
    const pts = polyline(...corners);
    const lines = m.line === 'double' ? [parallel(pts, 1.5), parallel(pts, -1.5)] : [pts];
    for (const l of lines) it.ops.push(['path', { class: 'mk-gap', 'data-line': m.line, d: toD(l) }]);
    it.paths.push(pts);
    it.reveal = pts;
    ctx.stroke(pts);
  }

  /** Marks in state order, so a kept mark wins over a new one and no result depends on the route taken here. */
  function planState(state) {
    const ctx = contextFor(state);
    const all = marksOf(state);
    const plans = new Map(all.map((m) => [m.key, {
      m, key: m.key, ops: [], paths: [], boxes: [], used: [], boxNames: [], holeNames: [], label: null, reveal: null,
    }]));
    const awake = all.filter((m) => !m.dormant);
    for (const m of awake) if (m.k === 'encompass') planDoor(m, ctx, plans.get(m.key));
    for (const m of awake) if (m.k === 'bracket') planBracket(m, ctx, plans.get(m.key));
    for (const m of awake) {
      const it = plans.get(m.key);
      if (m.k === 'arrow') planArrow(m, ctx, it);
      else if (m.k === 'tag') planChip(m, ctx, it);
      else if (m.k === 'supplies') planSupplies(m, ctx, it);
      else if (m.k === 'note') planNote(m, ctx, it);
      else if (m.k === 'gap') planGap(m, ctx, it);
    }
    const before = new Map([...plans.values()].map((it) => [it, it.boxes.length]));
    const seated = ctx.taken.length;
    for (const place of ctx.later) place();
    if (ctx.crowded) {                             // the same labels again, short, from the same empty board
      ctx.taken.length = seated;
      for (const [it, n] of before) it.boxes.length = n;
      ctx.short = true;
      for (const place of ctx.later) place();
    }
    for (const it of plans.values()) {
      it.opsSig = JSON.stringify(it.ops);
      it.sig = JSON.stringify([it.ops, it.label]);
      it.base = JSON.stringify([it.boxes.map((b) => [r1(b.x), r1(b.y), r1(b.w), r1(b.h)])]);
      it.pts = it.paths.flatMap((p) => along(p, SAMPLE)).map((p) => ({ x: r1(p.x), y: r1(p.y) }));
    }
    return [...plans.values()];
  }

  // ---- drawing
  const anims = new Set();
  function settleAnims() {
    for (const a of [...anims]) { a.done?.(); a.anim.cancel(); }
    anims.clear();
  }
  function track(anim, done) {
    const rec = { anim, done };
    anims.add(rec);
    anim.onfinish = () => { done?.(); anims.delete(rec); };
  }
  function fadeIn(n, delay = 0, ms = FADE_MS) {
    track(n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, delay, fill: 'backwards', easing: 'linear' }));
  }
  /** Tail to head, by a mask: dashes, double lines and glyphs all reveal the same way, and it leaves nothing behind. */
  function reveal(g, pts, delay) {
    const svg = g.ownerSVGElement;
    const id = `mk-reveal-${g.dataset.key}`;
    const a = tangentAt(pts, 0), b = tangentAt(pts, pts.length - 1), p0 = pts[0], p1 = pts[pts.length - 1];
    const path = [{ x: p0.x - a.x * 16, y: p0.y - a.y * 16 }, ...pts, { x: p1.x + b.x * 16, y: p1.y + b.y * 16 }];
    const stroke = svgEl('path', { d: toD(path), fill: 'none', stroke: '#fff', 'stroke-width': 56, pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': 1 });
    const mask = svgEl('mask', { id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: env.W, height: env.H });
    mask.append(stroke);
    svg.append(mask);
    g.setAttribute('mask', `url(#${id})`);
    const anim = stroke.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: DRAW_MS, delay, fill: 'both', easing: 'cubic-bezier(.45,0,.3,1)' });
    track(anim, () => { g.removeAttribute('mask'); mask.remove(); });
  }
  function fill(g, ops) {
    const inner = svgEl('g', { class: 'mk-in' });
    for (const [tag, attrs, text] of ops) inner.append(svgEl(tag, attrs, text));
    g.replaceChildren(inner);
  }
  const makeLabel = (op, key, type) => svgEl(op[0], { ...op[1], 'data-key': key, 'data-c': type }, op[2]);
  function alphaOf(m) {
    if (m.alpha !== undefined) return m.alpha;
    return m.k === 'arrow' && m.rank === 3 ? .7 : 1;
  }
  function group(m) {
    return svgEl('g', { class: `mk mk-k-${m.k}`, 'data-key': m.key, 'data-k': m.k });
  }
  function dress(g, m) {
    const set = (k, v) => (v === undefined || v === null ? g.removeAttribute(k) : g.setAttribute(k, v));
    set('data-rel', m.rel);
    set('data-rank', m.k === 'arrow' ? m.rank : undefined);
    set('data-c', m.type ?? (m.k === 'encompass' ? undefined : 'neutral'));
    set('data-layer', m.layer);
    set('data-dormant', m.dormant ? '1' : undefined);
    set('data-failed', m.failed ? '1' : undefined);
    set('data-line', m.line);
  }
  const SUB = { bracket: 'brackets', encompass: 'brackets', arrow: 'arrows', gap: 'arrows', tag: 'chips', supplies: 'chips', note: 'chips' };
  const homeOf = (m) => layers[m.layer === 'back' ? 'back' : 'front'];
  const removeDrawn = (d) => { d.g.remove(); d.label?.remove(); };

  function reconcile(state, instant) {
    const quiet = instant || env.reduced();
    const plan = planState(state);
    const keys = new Set(plan.map((p) => p.key));
    for (const [key, d] of drawn) if (!keys.has(key)) { removeDrawn(d); drawn.delete(key); }

    const seqs = [...new Set(plan.map((p) => p.m.seq ?? 0))].sort((a, b) => a - b);
    const delayOf = (m) => seqs.indexOf(m.seq ?? 0) * DRAW_MS;
    for (const p of plan) {
      const { m } = p;
      if (m.spine) continue;
      let d = drawn.get(p.key);
      if (!d) { d = { g: group(m), label: null, sig: null, rev: null, faded: false, dormant: false }; drawn.set(p.key, d); }
      const sub = homeOf(m)[SUB[m.k]];
      if (d.g.parentNode !== sub) sub.append(d.g);
      dress(d.g, m);
      if (m.dormant) {                             // keeps its <g>, at opacity 0
        d.g.style.opacity = '0';
        if (d.label) d.label.style.opacity = '0';
        d.dormant = true;
        d.rev = m.rev;
        continue;
      }
      const same = d.sig === p.sig && d.rev === m.rev;
      const inkSame = d.opsSig === p.opsSig;      // only the label moved or changed
      const recolour = !same && d.rev === m.rev && (d.base === p.base || inkSame);   // the bracket's type changed under it, or a label was reset
      const wasOff = d.dormant || d.g.style.opacity !== '';
      if (!same) {
        fill(d.g, p.ops);
        d.g.firstChild.setAttribute('opacity', alphaOf(m));
        d.label?.remove();
        d.label = p.label ? makeLabel(p.label, p.key, m.type ?? 'neutral') : null;
        if (d.label) { homeOf(m).labels.append(d.label); if (m.alpha !== undefined) d.label.setAttribute('opacity', m.alpha); }
      } else {
        if (d.label) { d.label.setAttribute('data-c', m.type ?? 'neutral'); if (d.label.parentNode !== homeOf(m).labels) homeOf(m).labels.append(d.label); }
      }
      d.g.style.opacity = '';
      if (d.label) d.label.style.opacity = '';
      if (!quiet) {
        const delay = delayOf(m);
        if (!same && !recolour && (p.reveal || m.k === 'bracket' || m.k === 'encompass')) {
          const path = p.reveal ?? p.paths.flat();
          if (path.length > 1) reveal(d.g, path, delay); else fadeIn(d.g, delay);
          if (d.label) fadeIn(d.label, delay + DRAW_MS, LABEL_MS);
        } else if (!same && !recolour) {
          fadeIn(d.g, delay);
          if (d.label) fadeIn(d.label, delay, FADE_MS);
        } else if (wasOff) {
          fadeIn(d.g);
          if (d.label) fadeIn(d.label);
        } else if (recolour && d.label) fadeIn(d.label, 0, FADE_MS);
      }
      Object.assign(d, { sig: p.sig, opsSig: p.opsSig, base: p.base, rev: m.rev, dormant: false, used: p.used, boxNames: p.boxNames, holeNames: p.holeNames });
    }
    recs = plan.map((p) => ({
      k: p.m.k, key: p.key, rel: p.m.rel, layer: p.m.layer, dormant: !!p.m.dormant,
      boxes: p.boxes.map((b) => ({ x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) })), pts: p.pts,
    }));
    drawRings(state, quiet);
    drawLeaders(state, quiet);
  }

  /** An open ring at the left end of each run of participle words whose underline shows. */
  function drawRings(state, quiet) {
    const on = Object.keys(state.st ?? {}).filter((id) => ['lit', 'tagged', 'done'].includes(state.st[id]) && env.visible(id) && env.typeOf(id) === 'ptc').sort();
    const heads = [];
    let prev = null;
    for (const id of on) {
      const r = env.rect(id), size = r.h / LINE;
      const joins = prev && Math.abs(prev.r.y - r.y) < 1 && r.x - (prev.r.x + prev.r.w) < size;
      if (!joins) heads.push({ id, cx: r1(r.x - 5), cy: r1(r.y + (BASE + UNDER) * size), layer: env.plane(id) >= 1 ? 'back' : 'front' });
      prev = { r };
    }
    const sig = JSON.stringify(heads);
    if (sig === rings.sig) {
      for (const n of rings.els.values()) { if (n.style.opacity !== '') { n.style.opacity = ''; if (!quiet) fadeIn(n); } }
      return;
    }
    for (const n of rings.els.values()) n.remove();
    rings = { sig, els: new Map() };
    for (const h of heads) {
      const n = svgEl('circle', { class: 'mk-ring', cx: h.cx, cy: h.cy, r: 3, 'data-id': h.id, 'data-c': 'ptc' });
      layers[h.layer].rings.append(n);
      rings.els.set(h.id, n);
      if (!quiet) fadeIn(n);
    }
  }
  /** From a full tag to its row, behind everything, under the spine. */
  function drawLeaders(state, quiet) {
    leaders.replaceChildren();
    for (const id of Object.keys(state.tags ?? {})) {
      if (state.tags[id] !== 'full') continue;
      const tag = env.tagRect(id), row = env.rowRect(id);
      if (!tag || !row) continue;
      const x = clamp(tag.x + tag.w / 2, row.x, row.x + row.w);
      const n = svgEl('path', { class: 'mk-leader', d: `M${r1(x)},${r1(tag.y + tag.h + 2)}V${r1(row.y)}` });
      leaders.append(n);
      if (!quiet) fadeIn(n, DRAW_MS);
    }
  }

  function wipe() {
    settleAnims();
    for (const d of drawn.values()) removeDrawn(d);
    drawn.clear();
    for (const n of rings.els.values()) n.remove();
    rings = { sig: null, els: new Map() };
    leaders.replaceChildren();
    for (const svg of [front, back]) svg.querySelectorAll('mask').forEach((n) => n.remove());
  }

  return {
    /** Elements to fade as the flight starts: keys leaving, rev changed, going dormant, or an end moving over .5 px. */
    leave(from, to, nextL) {
      settleAnims();
      const next = new Map(marksOf(to).map((m) => [m.key, m]));
      const moved = (id) => {
        const was = from?.st?.[id], will = to?.st?.[id];
        if (!was && !will) return false;
        const a = prevL?.tokens?.[id], b = nextL?.tokens?.[id];
        if (!was || !will || !a || !b) return true;
        return Math.abs(a.x - b.x) > .5 || Math.abs(a.y - b.y) > .5 || Math.abs(a.size - b.size) > .5;
      };
      const shifted = (list, name) => list?.some((k) => {
        const a = prevL?.[name]?.[k], b = nextL?.[name]?.[k];
        return !a || !b || Math.abs(a.x - b.x) > .5 || Math.abs(a.y - b.y) > .5 || Math.abs(a.w - b.w) > .5;
      });
      const out = [];
      for (const [key, d] of drawn) {
        if (d.dormant) continue;
        const n = next.get(key);
        if (!n || n.rev !== d.rev || n.dormant || d.used?.some(moved) || shifted(d.boxNames, 'boxes') || shifted(d.holeNames, 'holes')) {
          out.push(d.g);
          if (d.label) out.push(d.label);
        }
      }
      for (const [id, n] of rings.els) if (moved(id) || (to?.st?.[id] ?? 'hidden') === 'hidden') out.push(n);
      out.push(...leaders.childNodes);
      prevL = nextL;
      return out;
    },
    arrive(state, { instant = false } = {}) { settleAnims(); reconcile(state, instant); },
    redraw(state) { wipe(); reconcile(state, true); },
    clear() { wipe(); recs = []; },
    follow() {},                 // reserved
    records() { return recs; },
  };
}
