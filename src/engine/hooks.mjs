// Event bus between engine, panels and world.
const subs = Object.create(null);
const sticky = Object.create(null);          // last payload of 'deck' and 'nowebgl', replayed to late subscribers
const STICKY = new Set(['deck', 'nowebgl']);

export const hooks = {
  on(ev, fn) {
    (subs[ev] || (subs[ev] = [])).push(fn);
    if (ev in sticky) { try { fn(...sticky[ev]); } catch (e) { console.error('[hooks]', ev, e); } }
    return () => hooks.off(ev, fn);
  },
  off(ev, fn) {
    const a = subs[ev];
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  },
  emit(ev, ...args) {
    if (STICKY.has(ev)) sticky[ev] = args;
    const a = subs[ev];
    if (!a) return;
    for (const fn of a.slice()) { try { fn(...args); } catch (e) { console.error('[hooks]', ev, e); } }
  },
};
