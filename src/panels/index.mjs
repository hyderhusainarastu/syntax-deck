// Panels: everything on screen that is not the moving Greek. Imports `hooks` from the engine and nothing else.
//
// CLASS LIST (ids are fixed; classes are for styling). Empty panels use `hidden` and data-empty.
//   #ui[data-mode][data-spine][data-ledger]
//   #ribbon  .rb-title > h1.rb-head + p.rb-sub ; .rb-ticks > i.rb-tick[data-tick=pending|parsed][data-wing][data-f][data-c][data-scope][data-first] ; ul.rb-key > li.rb-k[data-c] > .rb-kl
//   #en[data-mode=slots|running]  .en-slots > span.slot[data-slot][data-state=off|blank|prov|on|stage][data-stage][data-c][data-new][data-glyph]  svg.en-ties (.en-stem .en-tie[data-rel][data-rank][data-c] .en-head)
//   #homeen  p.he-s[data-sentence]
//   #parse   .pl-list > .pl-row[data-id][data-basis][data-pair][data-restate] > .pl-c(.pl-form .pl-lemma .pl-pos .pl-feat .pl-gloss .pl-src) .pl-note
//            .dv-row > .dv-cell(.dv-form .dv-fact .dv-move .dv-page .dv-limit) > .dv-h .dv-v
//   #reason  p
//   #rail    .rail-list > .rail-item > .cite[data-grade][data-key][data-source] (.cite-label .cite-via .cite-loc .cite-quote .chip.cite-chip[data-chip=amber])
//   #callout > p.co[data-kind][data-at][data-key][data-grade][data-placed]
//   #skipped .sk-who[data-speaker] .sk-text > p.sk-turn[data-speaker] .sk-sp
//   #index, #help  .overlay > .ov-panel > .ov-head(.ov-title .ov-close) ; .ix-input .ix-list .ix-item .ix-btn .ix-num .ix-head .ix-id .ix-empty ; .hp-keys .hp-row
//   Greek runs anywhere: span.grc[lang=grc].
import { hooks } from '../engine/hooks.mjs';
import { buildLookup, makeOverlays } from './util.mjs';
import { mountRibbon } from './ribbon.mjs';
import { mountEnglish } from './english.mjs';
import { mountParse } from './parselist.mjs';
import { mountRail } from './cite.mjs';
import { mountSkipped } from './skipped.mjs';
import { mountCallout } from './callout.mjs';
import { mountIndex } from './stepindex.mjs';
import { mountHelp } from './help.mjs';

const isEditable = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function initPanels(deck) {
  let ui = document.getElementById('ui');
  if (!ui) { ui = document.createElement('div'); ui.id = 'ui'; (document.getElementById('stage') || document.body).append(ui); }
  const ctx = { deck, data: deck.data, ui, lookup: buildLookup(deck.data), ov: makeOverlays(), hooks };

  const ribbon = mountRibbon(ctx);
  const en = mountEnglish(ctx);
  const parse = mountParse(ctx);
  const rail = mountRail(ctx);
  const callout = mountCallout(ctx);
  const skipped = mountSkipped(ctx);
  const index = mountIndex(ctx);
  const help = mountHelp(ctx);
  // No card, no more drawer, no map button on stage: a click opens nothing. Keys ? and / stay.
  ui.append(ribbon.el, en.home, en.el, parse.el, ...parse.extra, rail.el, callout.el, skipped.el, index.el, help.el);

  const panelsRender = (state, ev) => {
    const v = state.view || {};
    ui.dataset.mode = v.mode || '';
    ui.dataset.spine = state.spine || 'off';
    ui.dataset.ledger = (state.rows?.length || state.reason || state.rail?.length || state.derive) ? '1' : '0';
    ribbon.render(state); en.render(state, ev); parse.render(state); rail.render(state); callout.render(state); skipped.render(state);
  };

  // Synchronous: English slots exist before marks are drawn.
  hooks.on('apply', (ev) => panelsRender(ev.state, ev));
  hooks.on('settled', ({ state }) => { en.renderTies(state); callout.position(); });
  hooks.on('resize', () => { en.renderTies(); callout.position(); });
  hooks.on('deck', () => { try { panelsRender(deck.state(), { immediate: true }); } catch (e) { /* first apply will paint */ } });

  // Keys that belong to panels: ?, /, Esc. Capture phase so the deck's navigation never sees them.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (ctx.ov.closeTop()) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    if (isEditable(e.target)) return;
    if (e.key === '?') { e.preventDefault(); e.stopImmediatePropagation(); help.isOpen() ? help.close() : help.open(); }
    else if (e.key === '/') { e.preventDefault(); e.stopImmediatePropagation(); index.open(); }
  }, true);

  return { ctx, close: () => { while (ctx.ov.closeTop()); } };
}
