// Boot.
import { hooks } from './engine/hooks.mjs';
import { createDeck } from './engine/stage.mjs';
import { initPanels } from './panels/index.mjs';
import { initWorld } from './world/index.mjs';

const deck = createDeck(window.__DATA__, window.__IMG);   // no animation yet
initPanels(deck);                                         // subscribes and builds its DOM
initWorld(document.getElementById('world'), deck)         // never blocks the deck
  .catch(err => hooks.emit('nowebgl', { reason: String(err) }));
deck.start();    // fonts.ready -> measure -> go(initial, {immediate:true}) -> hooks.emit('deck', deck)
