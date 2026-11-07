// The stage. go() is the only path; token motion never branches on dir.
import gsap from 'gsap';
import { hooks } from './hooks.mjs';
import { layout, buildIndex, tagLines, posWord, LINE, GLOSS_SIZE, INK_T, INK_B, PLANES } from './layout.mjs';
import { createMarks } from './marks.mjs';
import { renderParents, renderPlate } from './scene.mjs';
import { installKeys } from './keys.mjs';

const MEASURE_PX = 100;
const T_FADE_OUT = 0.12, T_REDUCED = 0.15;
// Two beats: 0-.6 what recedes or fades, .4-1 the rest. A press with only one beat takes .6 s.
const T_FLIGHT = 1, T_SINGLE = 0.6, BEAT_ONE = [0, 0.6], BEAT_TWO = [0.4, 1], T_CEIL = 1200;
const MAX_NEAR = 0.6;                   // a receding word starts at most this far toward the eye, as a part of the perspective
const STILL = 0.25;                     // px under which a word has not moved
const ease = gsap.parseEase('power2.inOut');
const html = document.documentElement;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* file:// may refuse */ } },
};

const $ = (id) => document.getElementById(id);

export function createDeck(data, img = {}) {
  const steps = data.steps;
  const idx = buildIndex(data);
  const stageEl = $('stage'), tokensEl = $('tokens'), extrasEl = $('extras'), glossEl = $('glosses');
  const marksEl = $('marks'), marksBackEl = $('marks-back'), parentsEl = $('parents'), plateEl = $('plate');

  // ---- spans. The build wrote them; the engine only finds them.
  const spans = new Map();
  for (const el of document.querySelectorAll('#tokens .tk, #extras .tk')) {
    spans.set(el.dataset.id, {
      id: el.dataset.id, el, w: el.querySelector('.w'), pc: el.querySelector('.pc'),
      layer: el.parentElement, z: 0,
    });
    el.style.lineHeight = String(LINE);
    el.style.transformOrigin = '0 0';
  }
  // Layers pass the pointer through; each visible .tk takes it back in writeFinal.
  for (const n of [tokensEl, extrasEl, glossEl, marksEl, marksBackEl]) if (n) n.style.pointerEvents = 'none';

  const rowOf = (t) => data.parses?.[`S${t.s}`]?.[t.id];
  const line = (cls, text) => {
    const n = document.createElement('span');
    n.className = cls;
    n.textContent = text;
    return n;
  };

  // The gloss stack above a word: the English, then its part of speech.
  const gl = new Map();
  for (const t of data.tokens) {
    const row = rowOf(t);
    const n = document.createElement('span');
    n.className = 'gl';
    n.dataset.id = t.id;
    if (row?.gloss) n.append(line('gl-g', row.gloss), line('gl-p', posWord(row)));
    n.style.transformOrigin = '0 0';
    glossEl?.append(n);
    gl.set(t.id, n);
  }

  // The tag under a word, one span per form, built once, and again for each case a step holds open. layout() says which shows.
  const opens = new Map();
  for (const st of steps) for (const [id, v] of Object.entries(st.open ?? {})) opens.set(id, (opens.get(id) ?? new Set()).add(v));
  const tg = new Map();
  for (const t of data.tokens) {
    const row = rowOf(t);
    if (!row) continue;
    const form = (name, ...lines) => {
      const n = document.createElement('span');
      n.className = 'tg';
      n.dataset.id = t.id;
      n.dataset.form = name;
      n.append(...lines);
      glossEl?.append(n);
      return n;
    };
    const forms = {};
    for (const open of [null, ...(opens.get(t.id) ?? [])]) {
      const { l1, l2, short } = tagLines(row, open);
      const key = (name) => (open ? `${name}:${open}` : name);
      forms[key('full')] = form('full', line('tg-l1', l1), line('tg-l2', l2));
      forms[key('short')] = form('short', line('tg-l1', short));
    }
    tg.set(t.id, forms);
  }
  const tagEls = () => [...tg.entries()].flatMap(([id, f]) => Object.entries(f).map(([key, el]) => ({ id, key, el })));

  // ---- box and origins
  let box = null;
  let current = null;       // layout of the applied state
  let shownState = null;    // the state `current` was laid out from
  let widths = {}, gw = {}, tw = {};

  function computeBox() {
    const k = Math.min(innerWidth / 1920, innerHeight / 1080);
    box = { k, W: innerWidth / k, H: innerHeight / k, widths, gw, tw, idx };
    for (const n of [marksEl, marksBackEl]) {
      if (!n) continue;
      n.setAttribute('viewBox', `0 0 ${box.W} ${box.H}`);
      n.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      Object.assign(n.style, { position: 'absolute', left: '0', top: '0', width: `${innerWidth}px`, height: `${innerHeight}px` });
    }
  }

  const stageOrigin = () => { const r = stageEl.getBoundingClientRect(); return { x: r.left, y: r.top }; };
  const layerOrigin = (n) => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top }; };

  /** Perspective of a layer in viewport px, or null when it has none. */
  function perspectiveOf(layer) {
    const cs = getComputedStyle(layer);
    const d = parseFloat(cs.perspective);
    if (!d) return null;
    const [ox, oy] = cs.perspectiveOrigin.split(' ').map(parseFloat);
    const r = layer.getBoundingClientRect();
    return { d, x: r.left + ox, y: r.top + oy };
  }

  function originStage() {
    const p = perspectiveOf(tokensEl);
    const s = stageOrigin();
    if (p) return { x: (p.x - s.x) / box.k, y: (p.y - s.y) / box.k };
    return { x: box.W / 2, y: box.H / 2 };
  }

  // ---- step 3: final geometry and state attributes
  const stateAttrs = (st) => {
    const focus = new Set(st.focus);
    const tree = new Set(st.tree);
    const lit = new Set([...st.focus, ...(st.callouts ?? []).map((c) => c.at)]);
    return { focus, tree, lit };
  };

  function deepestType(id, tree) {
    for (let n = idx.nodes[idx.nodeOf[id]]; n; n = idx.nodes[n.parent]) if (tree.has(n.id)) return n.type;
    return null;
  }

  function writeFinal(L, st) {
    const { k } = box;
    const { focus, tree, lit } = stateAttrs(st);
    const origins = new Map();
    for (const s of spans.values()) {
      if (!origins.has(s.layer)) origins.set(s.layer, layerOrigin(s.layer));
    }
    for (const s of spans.values()) {
      const t = L.tokens[s.id];
      const o = origins.get(s.layer);
      const es = s.el.style;
      es.transform = '';
      es.left = `${t.x * k - o.x}px`;
      es.top = `${t.y * k - o.y}px`;
      es.fontSize = `${t.size * k}px`;
      es.zIndex = String(t.opacity > 0 ? 10 + Math.round(t.z / 360) : 0);
      es.pointerEvents = t.opacity > 0 ? 'auto' : 'none';
      const type = deepestType(s.id, tree);
      if (type) s.el.dataset.c = type; else delete s.el.dataset.c;
      s.el.dataset.st = st.st?.[s.id] ?? 'hidden';
      if (focus.has(s.id)) s.el.dataset.f = '1'; else delete s.el.dataset.f;
      if (lit.has(s.id)) s.el.dataset.lit = '1'; else delete s.el.dataset.lit;
    }
    stageEl.dataset.mode = st.view?.mode ?? 'full';
    const go = glossEl ? layerOrigin(glossEl) : { x: 0, y: 0 };
    for (const [id, n] of gl) {
      const g = L.glosses[id];
      n.style.transform = '';
      n.style.left = `${g.x * k - go.x}px`;
      n.style.top = `${g.y * k - go.y}px`;
      n.style.fontSize = `${GLOSS_SIZE * k}px`;
    }
    for (const { id, key, el } of tagEls()) {
      const t = L.tags[id];
      el.style.transform = '';
      if (t?.key !== key) continue;       // a tag that is leaving stays where it was and fades
      el.style.left = `${t.x * k - go.x}px`;
      el.style.top = `${t.y * k - go.y}px`;
    }
    renderParents(parentsEl, L, originStage(), k);
    renderPlate(plateEl, L, st, data, img, k);
  }

  function restOpacity(L) {
    for (const s of spans.values()) { s.el.style.opacity = String(L.tokens[s.id].opacity); s.z = L.tokens[s.id].z; s.el.style.willChange = ''; }
    for (const [id, n] of gl) { n.style.opacity = String(L.glosses[id].opacity); n.style.willChange = ''; }
    for (const { id, key, el } of tagEls()) { el.style.opacity = L.tags[id]?.key === key ? '1' : '0'; el.style.willChange = ''; }
  }

  // ---- step 1: current boxes, mid-tween included
  function capture() {
    const old = new Map();
    for (const s of spans.values()) {
      const r = s.el.getBoundingClientRect();
      old.set(s.id, { x: r.left, y: r.top, h: r.height, z: s.z, opacity: parseFloat(getComputedStyle(s.el).opacity) });
    }
    const oldGl = new Map();
    for (const [id, n] of gl) {
      const r = n.getBoundingClientRect();
      oldGl.set(id, { x: r.left, y: r.top, opacity: parseFloat(getComputedStyle(n).opacity) });
    }
    const oldTg = new Map();
    for (const { el } of tagEls()) {
      const r = el.getBoundingClientRect();
      oldTg.set(el, { x: r.left, y: r.top, opacity: parseFloat(getComputedStyle(el).opacity) });
    }
    return { old, oldGl, oldTg };
  }

  // ---- step 5-6: FLIP. The start transform lands each token exactly on its old box, through the perspective.
  /** A two-dimensional item: a gloss or a tag. It flies if it was showing, else it fades in where it rests. */
  function flatItem(el, o, opacity) {
    const r = el.getBoundingClientRect();
    const moves = o.opacity > 0 && opacity > 0;
    return { el, dx: moves ? o.x - r.left : 0, dy: moves ? o.y - r.top : 0, dz: 0, scale: 1, o0: o.opacity, o1: opacity, falls: opacity < o.opacity };
  }

  function flipItems(L, cap) {
    const { k } = box;
    const items = [];
    const persp = new Map();
    for (const s of spans.values()) {
      if (!persp.has(s.layer)) persp.set(s.layer, perspectiveOf(s.layer));
      const o = cap.old.get(s.id);
      const t = L.tokens[s.id];
      if (o.opacity === 0 && t.opacity === 0) { s.z = t.z; s.el.style.opacity = '0'; continue; }
      const r = s.el.getBoundingClientRect();
      const P = persp.get(s.layer);
      // Words rest flat, so a word that falls in z starts toward the eye. Home is as deep as the perspective: hold it short of the eye.
      const dz = P ? Math.min((o.z - t.z) * k, P.d * MAX_NEAR) : 0;
      const f = P && dz ? P.d / (P.d - dz) : 1;
      const ox = P ? P.x : 0, oy = P ? P.y : 0;
      items.push({
        s, el: s.el, restZ: t.z, z0: o.z,
        dx: (o.x - ox) / f + ox - r.left, dy: (o.y - oy) / f + oy - r.top, dz,
        scale: (o.h / (r.height || 1)) / f, o0: o.opacity, o1: t.opacity,
        falls: t.z < o.z || t.opacity < o.opacity,
      });
    }
    for (const [id, n] of gl) {
      const o = cap.oldGl.get(id);
      const g = L.glosses[id];
      if (o.opacity === 0 && g.opacity === 0) { n.style.opacity = '0'; continue; }
      items.push(flatItem(n, o, g.opacity));
    }
    for (const { id, key, el } of tagEls()) {
      const o = cap.oldTg.get(el);
      const on = L.tags[id]?.key === key ? 1 : 0;
      if (o.opacity === 0 && !on) { el.style.opacity = '0'; continue; }
      items.push(flatItem(el, o, on));
    }
    // A word that neither moves nor fades takes no part, so a press where nothing moves does not wait on a flight.
    const moving = items.filter((it) => {
      const still = Math.abs(it.dx) < STILL && Math.abs(it.dy) < STILL && Math.abs(it.dz) < STILL && Math.abs(it.scale - 1) < 0.005 && it.o0 === it.o1;
      if (still) { it.el.style.opacity = String(it.o1); if (it.s) it.s.z = it.restZ; }
      return !still;
    });
    const one = moving.some((it) => it.falls), two = moving.some((it) => !it.falls);
    for (const it of moving) {
      [it.a, it.b] = !(one && two) ? [0, 1] : it.falls ? BEAT_ONE : BEAT_TWO;
      it.p = 0;
      it.el.style.willChange = 'transform, opacity';
    }
    return { items: moving, duration: one && two ? T_FLIGHT : T_SINGLE };
  }

  function frame(items, e) {
    for (const it of items) {
      it.p = ease(Math.max(0, Math.min(1, (e - it.a) / (it.b - it.a))));
      const r = 1 - it.p;
      it.el.style.transform = `translate3d(${it.dx * r}px,${it.dy * r}px,${it.dz * r}px) scale(${1 + (it.scale - 1) * r})`;
      it.el.style.opacity = String(it.o0 + (it.o1 - it.o0) * it.p);
    }
    marks.follow(e);
  }

  // ---- machine
  let target = 0, shown = -1;
  let phase = 'boot';                  // boot | idle | leaving | moving
  let run = 0;                         // bumps when a running sequence is abandoned
  let tween = null, ceiling = 0, layerTween = null;
  let moving = null;                   // the items of a running flight
  let fades = [];                      // running mark fades
  let cap = null;
  let waiters = [];
  let cardId = null;

  const flushWaiters = () => { const w = waiters; waiters = []; for (const r of w) r(); };

  function killTween() {
    if (tween) { tween.kill(); tween = null; }
    clearTimeout(ceiling);
    if (moving) {
      for (const it of moving) if (it.s) it.s.z = it.restZ + (it.z0 - it.restZ) * (1 - it.p);
      moving = null;
    }
  }

  function killFades() { for (const t of fades) t.kill(); fades = []; }

  /** Fade only the marks that leave or move; everything else stays lit. */
  function fadeMarks(els, done) {
    if (!els.length) { done?.(); return; }
    fades.push(gsap.to(els, { opacity: 0, duration: T_FADE_OUT, ease: 'none', onComplete: done }));
  }

  const dirOf = (from, to) => (to - from === 1 ? 1 : to - from === -1 ? -1 : 0);

  function applyState(immediate) {
    const st = steps[target];
    const prev = shown >= 0 ? steps[shown] : null;
    const L = layout(st, box);
    current = L;
    shownState = st;
    writeFinal(L, st);
    if (prev?.i !== st.i) closeCard();     // on a resize prev is this same step
    const dir = prev ? dirOf(prev.i, st.i) : 0;
    shown = target;
    hooks.emit('apply', { state: st, prev, dir, zones: L.zones, immediate });   // panels write their DOM here
    return { st, L };
  }

  function settle(st, { instant = false, redraw = false } = {}) {
    phase = 'idle';
    fades = [];
    if (redraw) marks.redraw(st);
    else marks.arrive(st, { instant: instant || reduced() });
    hooks.emit('settled', { state: st });
    document.dispatchEvent(new CustomEvent('deckstate', { detail: { i: st.i, id: st.id } }));
    trackUrl(st.i);
    flushWaiters();
  }

  function moveReduced() {
    const layers = [tokensEl, extrasEl, glossEl].filter(Boolean);
    const mine = ++run;
    phase = 'moving';
    if (layerTween) layerTween.kill();
    layerTween = gsap.to(layers, { opacity: 0, duration: T_REDUCED, ease: 'none', onComplete() {
      if (mine !== run) return;
      const { st, L } = applyState(false);
      restOpacity(L);
      layerTween = gsap.to(layers, { opacity: 1, duration: T_REDUCED, ease: 'none', clearProps: 'opacity', onComplete() {
        if (mine !== run) return;
        settle(st);
      } });
    } });
  }

  function moveTokens() {
    const { st, L } = applyState(false);
    phase = 'moving';
    const { items, duration } = flipItems(L, cap);
    const finish = () => {
      if (mine !== run) return;
      clearTimeout(ceiling);
      if (tween) { tween.kill(); tween = null; }
      moving = null;
      for (const it of items) it.el.style.removeProperty('transform');
      restOpacity(L);
      settle(st);
    };
    const mine = ++run;
    if (!items.length) { finish(); return; }
    frame(items, 0);
    const proxy = { e: 0 };
    moving = items;
    tween = gsap.to(proxy, { e: 1, duration, ease: 'none', onUpdate: () => frame(items, proxy.e), onComplete: finish });
    ceiling = setTimeout(finish, T_CEIL);
  }

  function clearLayers() {
    if (layerTween) { layerTween.kill(); layerTween = null; }
    for (const n of [tokensEl, extrasEl, glossEl]) if (n) n.style.removeProperty('opacity');
  }

  function runImmediate(resize = false) {
    run++;
    killTween();
    killFades();
    clearLayers();
    const { st, L } = applyState(true);
    restOpacity(L);
    if (!resize) marks.clear();
    settle(st, { instant: true, redraw: resize });
  }

  function go(i, { immediate = false } = {}) {
    const to = Math.max(0, Math.min(steps.length - 1, Math.round(Number(i)) || 0));
    const done = new Promise((r) => waiters.push(r));
    if (immediate) { target = to; runImmediate(); return done; }
    if (phase === 'boot') { target = to; return done; }
    if (to === target) { if (phase === 'idle') flushWaiters(); return done; }

    const from = steps[target];
    const dir = dirOf(target, to);
    target = to;
    const wasLeaving = phase === 'leaving';
    if (!wasLeaving) {
      run++;                     // abandons a running sequence; its positions are captured and retargeted
      killTween();
      if (layerTween) layerTween.kill();
      cap = capture();
    }
    hooks.emit('leave', { from, to: steps[to], dir });
    const leaving = marks.leave(steps[shown], steps[to], layout(steps[to], box));
    if (wasLeaving) { fadeMarks(leaving); return done; }   // the pending fade picks up the latest target
    phase = 'leaving';
    const mine = run;
    fadeMarks(leaving, () => {
      if (mine !== run) return;
      if (reduced()) moveReduced();
      else { clearLayers(); moveTokens(); }
    });
    return done;
  }

  // ---- measure once, after fonts
  async function fontsReady() {
    void tokensEl.offsetWidth;
    try {
      const sample = spans.size ? [...spans.values()].map((s) => s.el.textContent).join('') : '';
      const family = spans.size ? getComputedStyle(spans.values().next().value.el).fontFamily : '';
      if (family && document.fonts?.load) {
        await Promise.all(['400', '700'].map((w) => document.fonts.load(`${w} 40px ${family}`, sample)));
      }
      const label = getComputedStyle(html).getPropertyValue('--font-label');
      await Promise.all(['400', '500'].map((w) => document.fonts?.load(`${w} 40px ${label}`)));
      await document.fonts?.ready;
    } catch { /* measure with whatever loaded */ }
  }

  function measure() {
    for (const s of spans.values()) s.el.style.fontSize = `${MEASURE_PX}px`;
    for (const n of gl.values()) n.style.fontSize = `${MEASURE_PX}px`;
    for (const { el } of tagEls()) el.style.fontSize = `${MEASURE_PX}px`;
    widths = {}; gw = {}; tw = {};
    for (const id of idx.ids) {
      const s = spans.get(id);
      if (!s) { widths[id] = 0; continue; }
      const a = s.w?.getBoundingClientRect().width ?? 0;
      const b = s.pc?.getBoundingClientRect().width ?? 0;
      widths[id] = (a + b) / MEASURE_PX;
    }
    const em = (n) => (n?.getBoundingClientRect().width ?? 0) / MEASURE_PX;
    for (const [id, n] of gl) gw[id] = n.textContent ? em(n) : 0;
    for (const [id, f] of tg) {
      tw[id] = {};
      for (const [key, el] of Object.entries(f)) {
        tw[id][key] = el.dataset.form === 'full' ? [em(el.querySelector('.tg-l1')), em(el.querySelector('.tg-l2'))] : em(el.querySelector('.tg-l1'));
        el.style.removeProperty('font-size');
      }
    }
  }

  // ---- rects, in stage px
  function stageRect(r) {
    const o = stageOrigin();
    return { x: (r.left - o.x) / box.k, y: (r.top - o.y) / box.k, w: r.width / box.k, h: r.height / box.k };
  }

  function tokenRect(id) {
    const s = spans.get(id);
    if (!s) return null;
    const a = s.w.getBoundingClientRect();
    const b = s.pc?.getBoundingClientRect();
    const right = b && b.width ? Math.max(a.right, b.right) : a.right;
    const box_ = s.el.getBoundingClientRect();     // height from the line box: the inline rect overshoots it
    return stageRect({ left: a.left, top: box_.top, width: right - a.left, height: box_.height });
  }

  const visible = (id) => (current?.tokens[id]?.opacity ?? 0) > 0;
  const union = (rects) => {
    const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
    const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  function slotEl(name) {
    return document.querySelector(`[data-slot="${CSS.escape(name)}"]`);
  }

  /** Ids of a selector: a token, a range, a tree node, or a comma list of those. */
  function selectIds(selector) {
    return selector.split(',').flatMap((part) => {
      const p = part.trim();
      if (spans.has(p)) return [p];
      const m = /^(.+)\.\.(.+)$/.exec(p);
      if (m && m[1] in idx.order && m[2] in idx.order) return idx.ids.slice(idx.order[m[1]], idx.order[m[2]] + 1);
      return idx.nodes[p]?.span ?? [];
    });
  }

  function rect(target_) {
    if (typeof target_ !== 'string') return null;
    if (target_.startsWith('en:')) {
      const n = slotEl(target_.slice(3));
      return n ? stageRect(n.getBoundingClientRect()) : null;
    }
    if (target_.startsWith('box:')) return current?.boxes[target_.slice(4)] ?? null;
    if (target_.startsWith('hole:')) return current?.holes[target_.slice(5)] ?? null;
    if (spans.has(target_)) return tokenRect(target_);
    const ids = selectIds(target_).filter(visible);
    return ids.length ? union(ids.map(tokenRect)) : null;
  }

  function inkRect(id) {
    const r = tokenRect(id), t = current?.tokens[id];
    return r && t ? { x: r.x, y: t.y + INK_T * t.size, w: r.w, h: (INK_B - INK_T) * t.size } : null;
  }

  function tagRect(id) {
    const t = current?.tags[id];
    const el = t ? tg.get(id)?.[t.key] : null;
    return el ? stageRect(el.getBoundingClientRect()) : null;
  }

  function stackRect(id) {
    const n = gl.get(id);
    return n && (current?.glosses[id]?.opacity ?? 0) > 0 ? stageRect(n.getBoundingClientRect()) : null;
  }

  const markEnv = {
    get W() { return box.W; },
    get H() { return box.H; },
    reduced: () => reduced(),
    visible,
    plane(id) { const n = PLANES.indexOf(current?.tokens[id]?.z); return n < 0 ? null : n; },
    typeOf: (id) => (shownState ? deepestType(id, new Set(shownState.tree)) : null),
    rect: tokenRect,
    ink: inkRect,
    runRects: (a, b) => idx.ids.slice(idx.order[a], idx.order[b] + 1).filter(visible).map(tokenRect),
    box: (name) => current?.boxes[name] ?? null,
    hole: (id) => current?.holes[id] ?? null,
    slotRects(name) {
      const n = slotEl(name);
      return n ? [...n.getClientRects()].map(stageRect) : [];
    },
    tagRect,
    stackRect,
    rowRect(id) {
      const n = document.querySelector(`.pl-row[data-id="${CSS.escape(id)}"]`);
      return n ? stageRect(n.getBoundingClientRect()) : null;
    },
    obstacles() {
      const out = [];
      for (const id of spans.keys()) if (visible(id)) out.push(inkRect(id));
      for (const id of Object.keys(current?.tags ?? {})) out.push(tagRect(id));
      return out.filter(Boolean);
    },
  };

  const marks = createMarks({ front: marksEl, back: marksBackEl, env: markEnv });

  // ---- cards, modes, url
  function openCard(id) {
    if (id === cardId) return;
    cardId = id;
    hooks.emit('card', { id });
  }

  function closeCard() {
    if (cardId === null) return;
    cardId = null;
    hooks.emit('card', { id: null });
  }

  function theme(v) {
    if (v === undefined) return html.dataset.theme;
    html.dataset.theme = v;
    store.set('pl-theme', v);
    hooks.emit('theme', v);
    return v;
  }

  function wash(v) {
    if (v === undefined) return html.classList.contains('wash');
    html.classList.toggle('wash', !!v);
    store.set('pl-wash', v ? '1' : '0');
    hooks.emit('wash', !!v);
    return !!v;
  }

  function reduced(v) {
    if (v === undefined) return html.classList.contains('reduced');
    html.classList.toggle('reduced', !!v);
    hooks.emit('reduced', !!v);
    return !!v;
  }

  function trackUrl(i) {
    try {
      const u = new URL(location.href);
      u.searchParams.set('i', String(i));
      history.replaceState(null, '', u);
    } catch { /* file:// may refuse */ }
  }

  function initialIndex() {
    const q = new URLSearchParams(location.search);
    if (q.get('debug') === '1') html.classList.add('debug');
    return Math.max(0, Math.min(steps.length - 1, parseInt(q.get('i') ?? '0', 10) || 0));
  }

  // Persisted modes, without events: nothing subscribes yet.
  const savedTheme = store.get('pl-theme');
  if (savedTheme === 'light' || savedTheme === 'dark') html.dataset.theme = savedTheme;
  html.classList.toggle('wash', store.get('pl-wash') === '1');
  html.classList.toggle('reduced', !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  hooks.on('nowebgl', () => html.classList.add('no-webgl'));

  let resizeQueued = false;
  function onResize() {
    resizeQueued = false;
    computeBox();
    hooks.emit('resize', box);
    // Same step, new geometry. A pending go() has already moved target, so this also lands it.
    runImmediate(true);
  }

  const deck = {
    data, img, steps,
    i: () => target,
    count: () => steps.length,
    state: (i = target) => steps[i],
    go,
    next: () => go(target + 1),
    back: () => go(target - 1),
    box: () => box,
    zones: () => current?.zones ?? null,
    current: () => current,
    layout,
    rect,
    openCard, closeCard,
    theme, wash, reduced,
    async start() {
      await fontsReady();
      measure();
      computeBox();
      const first = initialIndex();
      installKeys(deck);
      window.addEventListener('resize', () => {
        if (resizeQueued || phase === 'boot') return;
        resizeQueued = true;
        requestAnimationFrame(onResize);
      });
      target = first;
      await go(first, { immediate: true });
      hooks.emit('deck', deck);
    },
  };

  window.__deck = {
    ...deck,
    settled: () => phase === 'idle',
    tokens() {
      const out = [];
      for (const s of spans.values()) {
        const cs = getComputedStyle(s.el);
        const r = stageRect(s.el.getBoundingClientRect());
        out.push({
          id: s.id, text: s.w.textContent, post: s.pc?.textContent ?? '',
          x: r.x, y: r.y, w: r.w, h: r.h, size: parseFloat(cs.fontSize) / box.k,
          opacity: parseFloat(cs.opacity), transform: cs.transform, fontFamily: cs.fontFamily,
        });
      }
      return out;
    },
    tags() {
      return Object.entries(current?.tags ?? {}).map(([id, t]) => ({ id, form: t.form, ...tagRect(id) }));
    },
    overflow: () => !!current?.overflow,
    marks: () => marks.records(),
    world: () => ({ mode: html.classList.contains('no-webgl') ? 'fallback' : 'webgl', cue: steps[shown]?.world ?? 'rest' }),
  };
  return deck;
}
