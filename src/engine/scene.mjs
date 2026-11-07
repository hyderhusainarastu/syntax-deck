// Engine-owned chrome that holds no token: plane backdrops and chips in #parents, the #plate layer.
import { project } from './layout.mjs';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const px = (n, box, v) => { n.style[box] = `${v}px`; };

function citeLabel(data, key) {
  const c = key ? data.cites?.[key] : null;   // grade D rows are gone from the data, so they cannot reach here
  if (!c) return null;
  const s = el('span', 'cite', c.label ?? key);
  s.dataset.grade = c.grade ?? '';
  return s;
}

/** #parents is resized to its zone. `origin` is the perspective origin of #tokens in stage px. */
export function renderParents(host, L, origin, k) {
  const z = L.zones.parents;
  host.style.position = 'absolute';
  host.style.left = '0';
  host.style.right = '0';
  px(host, 'top', z.y * k);
  px(host, 'height', z.h * k);
  host.style.perspectiveOrigin = `${origin.x * k}px ${(origin.y - z.y) * k}px`;
  host.replaceChildren();

  for (const p of L.planes) {
    // The plane sits at real z. Un-project its rect so that it lands on the band.
    const f = project(p.z);
    const un = (c, o) => o + (c - o) / f;
    const x0 = un(p.x, origin.x), y0 = un(p.y, origin.y);
    const x1 = un(p.x + p.w, origin.x), y1 = un(p.y + p.h, origin.y);
    const d = el('div', 'plane');
    d.dataset.z = String(p.z);
    d.style.position = 'absolute';
    px(d, 'left', x0 * k);
    px(d, 'top', (y0 - z.y) * k);
    px(d, 'width', (x1 - x0) * k);
    px(d, 'height', (y1 - y0) * k);
    d.style.transform = `translateZ(${p.z * k}px)`;
    host.append(d);
  }
  for (const c of L.chips) {
    const d = el('div', 'chip', c.text);
    d.dataset.id = c.id;
    d.dataset.kind = c.kind ?? '';
    d.style.position = 'absolute';
    px(d, 'left', c.x * k);
    px(d, 'top', (c.y - z.y) * k);
    px(d, 'width', c.w * k);
    px(d, 'height', c.h * k);
    host.append(d);
  }
}

function place(n, r, k) {
  n.style.position = 'absolute';
  px(n, 'left', r.x * k);
  px(n, 'top', r.y * k);
  px(n, 'width', r.w * k);
  px(n, 'height', r.h * k);
}

function pairSide(side, rect, data, k, name) {
  const col = el('section', 'pair-side');
  col.dataset.side = name;
  place(col, rect, k);
  if (side?.label) col.append(el('h3', 'pair-label', side.label));
  if (side?.text) col.append(el('p', 'pair-text', side.text));
  const cite = citeLabel(data, side?.cite);
  if (cite) col.append(cite);
  return col;
}

export function renderPlate(host, L, state, data, img, k) {
  host.replaceChildren();
  const p = L.plate;
  if (!p) return;
  if (p.kind === 'pair' || p.kind === 'lower') {
    const v = p.kind === 'lower' ? state.view.lower : state.view;
    host.append(pairSide(v.left, p.left, data, k, 'left'), pairSide(v.right, p.right, data, k, 'right'));
    return;
  }
  const v = state.view;
  const fig = el('figure', 'plate-figure');
  place(fig, p.img, k);
  const src = img?.[v.img];
  if (src) {
    const im = el('img', 'plate-img');
    im.src = src;
    im.alt = v.caption ?? '';
    fig.append(im);
  }
  const cap = el('figcaption', 'plate-caption', v.caption ?? null);
  const cite = citeLabel(data, v.cite);
  if (cite) cap.append(cite);
  fig.append(cap);
  host.append(fig);
}
