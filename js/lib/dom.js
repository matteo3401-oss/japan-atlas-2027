/* Tiny DOM helpers: no framework, just composable element builders. */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'line', 'rect', 'g', 'polyline', 'polygon']);

/** h('div.card', { onclick }, child, 'text', [more]) */
export function h(spec, attrs, ...children) {
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  const [tagAndId, ...classes] = spec.split('.');
  const [tag, id] = tagAndId.split('#');
  const name = tag || 'div';
  const el = SVG_TAGS.has(name) ? document.createElementNS(SVG_NS, name) : document.createElement(name);
  if (id) el.id = id;
  if (classes.length) el.setAttribute('class', classes.join(' '));
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.setAttribute('class', `${el.getAttribute('class') || ''} ${v}`.trim());
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

/* Line icons, drawn on a 20×20 grid with a 1.4 stroke. */
const ICONS = {
  play: 'M6.5 4.5v11l9-5.5z',
  scene: 'M3 4.5h14v11H3zM3.5 13.6l4-4.6 3 3.2 2.2-2.2 3.8 3.6',
  pause: 'M6.5 4.5v11M13.5 4.5v11',
  prev: 'M14.5 4.5v11l-8-5.5zM5.5 4.5v11',
  next: 'M5.5 4.5v11l8-5.5zM14.5 4.5v11',
  rewind: 'M10 5v10l-7-5zM17 5v10l-7-5z',
  forward: 'M10 5v10l7-5zM3 5v10l7-5z',
  close: 'M5 5l10 10M15 5L5 15',
  chevronL: 'M12 4.5L6.5 10l5.5 5.5',
  chevronR: 'M8 4.5l5.5 5.5L8 15.5',
  chevronD: 'M4.5 7.5L10 13l5.5-5.5',
  chevronU: 'M4.5 12.5L10 7l5.5 5.5',
  layers: 'M10 3l7.5 4L10 11 2.5 7zM2.5 10.5L10 14.5l7.5-4M2.5 13.5L10 17.5l7.5-4',
  sun: 'M10 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4',
  moon: 'M16.5 12.2A7 7 0 017.8 3.5a7 7 0 108.7 8.7z',
  mountain: 'M1.8 16.5l5.7-10 3.3 5.6 2.2-3.2 5.2 7.6zM6 9.2l1.5 1.3 1.4-1.2',
  flat: 'M2.5 14.5h15M2.5 10h15M2.5 5.5h15',
  expand: 'M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4',
  shrink: 'M7.5 3.5v4h-4M12.5 3.5v4h4M7.5 16.5v-4h-4M12.5 16.5v-4h4',
  reset: 'M4 10a6 6 0 106-6H5.5M8 1.5L5.2 4 8 6.5',
  plus: 'M10 4v12M4 10h12',
  minus: 'M4 10h12',
  compass: 'M10 2.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15zM12.8 7.2l-1.6 4-4 1.6 1.6-4z',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  external: 'M8 4.5H4.5v11h11V12M11.5 4.5h4v4M15.5 4.5L9 11',
  pin: 'M10 17.5s5.5-5 5.5-9a5.5 5.5 0 10-11 0c0 4 5.5 9 5.5 9zM10 6.5a2 2 0 100 4 2 2 0 000-4z',
  route: 'M5 16.5a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6zM15 7.1a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6zM6.8 14.7h4.7a2.5 2.5 0 000-5h-3a2.5 2.5 0 010-5h4.7',
  dashboard: 'M3 3.5h6v6H3zM11 3.5h6v3.5h-6zM11 9.5h6v7h-6zM3 12h6v4.5H3z',
  satellite: 'M10 2.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15zM2.5 10h15M10 2.5c2.2 2 3.3 4.5 3.3 7.5s-1.1 5.5-3.3 7.5c-2.2-2-3.3-4.5-3.3-7.5S7.8 4.500 10 2.5z',
  building: 'M4 17V6.5l5-2.5v13M9 17V8.5h7V17M2.5 17h15M6 8.5v0M6 11.5v0M6 14.5v0M12 11.5v0M12 14.5v0',
  flag: 'M5 17.5v-15M5 3.5h10l-2.3 3.3L15 10H5',
  info: 'M10 2.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15zM10 9v5M10 6.2v.2',
  list: 'M7 5h10M7 10h10M7 15h10M3.5 5v0M3.5 10v0M3.5 15v0',
  train: 'M6 3.5h8a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2v-7a2 2 0 012-2zM4 9.500h12M7 12v0M13 12v0M6.500 14.5l-2 3M13.5 14.5l2 3',
  bus: 'M5 3.5h10a1.5 1.5 0 011.5 1.5v9.500h-13V5A1.5 1.5 0 015 3.5zM3.5 10h13M6.500 14.5v2M13.5 14.5v2M6.500 12.3v0M13.5 12.3v0',
  plane: 'M10.800 2.5l1.2 5.5 5.5 3.2v1.600l-5.5-1.600-.5 3.800 1.800 1.300v1.200L10 16.700l-3.300.800v-1.200l1.800-1.300-.5-3.800-5.5 1.600v-1.600L8 8l1.200-5.500z',
  walk: 'M11 4.300a1.300 1.300 0 100-2.600 1.300 1.300 0 000 2.600zM8.500 18l1.500-5-2-2 .8-4.200 3 .7 2 2.500 2.200.500M7.800 7.200L5.500 9v2.500M11.800 13l1.700 5',
  dots: 'M4.500 10v0M10 10v0M15.500 10v0',
  sound: 'M3.5 8v4h3l4 3.5v-11l-4 3.5zM13.6 7.6a3.4 3.4 0 010 4.8M15.6 5.4a6.5 6.5 0 010 9.2',
  mute: 'M3.5 8v4h3l4 3.5v-11l-4 3.5zM13.5 8l4 4M17.5 8l-4 4',
};

export function icon(name, size = 18) {
  const d = ICONS[name];
  const svg = h('svg', { viewBox: '0 0 20 20', width: size, height: size, 'aria-hidden': 'true', class: 'ico' });
  svg.append(h('path', { d: d || '', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  if (name === 'play') svg.firstChild.setAttribute('fill', 'currentColor');
  return svg;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
