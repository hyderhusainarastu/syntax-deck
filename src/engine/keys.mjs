// Keyboard input. `?`, `/` and Esc belong to panels, which own those overlays; the deck has no call for them.
// No click opens anything on stage, and selection in #tokens stays native.

function typing(e) {
  const t = e.target;
  if (!t || t === document.body) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? '');
}

function fullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen()?.catch?.(() => {});
  } catch { /* unavailable: nothing to do */ }
}

export function installKeys(deck) {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
    const key = e.key;
    let act = null;
    if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown') act = () => deck.next();
    else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') act = () => deck.back();
    else if (key === ' ') act = () => (e.shiftKey ? deck.back() : deck.next());
    else if (key === 'Home') act = () => deck.go(0);
    else if (key === 'End') act = () => deck.go(deck.count() - 1);
    else if (key === 'f' || key === 'F') act = fullscreen;
    else if (key === 't' || key === 'T') act = () => deck.theme(deck.theme() === 'light' ? 'dark' : 'light');
    else if (key === 'p' || key === 'P') act = () => deck.wash(!deck.wash());
    else if (key === 'm' || key === 'M') act = () => deck.reduced(!deck.reduced());
    if (!act) return;
    e.preventDefault();
    act();
  });
}
