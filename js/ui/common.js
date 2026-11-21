/* Small shared interface components. */

import { h, icon } from '../lib/dom.js';

const STATUS_LABEL = { confirmed: 'Confirmed', pending: 'Pending', tentative: 'Tentative' };

export function statusChip(status, label) {
  if (!STATUS_LABEL[status]) return null;
  return h(`span.chip.chip--${status}`, label || STATUS_LABEL[status]);
}

export const estChip = () => h('span.chip.chip--est', { title: 'Marked as an estimate in the plan' }, 'Estimated time');

/** The category seal as an inline element (mirrors the map marker). */
export function seal(cat, glyph, size = '') {
  const el = h(`span.seal.seal--${cat}${size ? `.seal--${size}` : ''}`, { 'aria-hidden': 'true' });
  // the diamond rotates its box, so the glyph is counter-rotated in a span
  el.append(cat === 'view' ? h('span', glyph) : glyph);
  return el;
}

/** Lazy photograph with graceful failure: the frame simply stays empty. */
export function photo(p, { small = false, className = '' } = {}) {
  if (!p) return null;
  const img = h('img', { src: small ? (p.srcSmall || p.src) : p.src, alt: p.alt || '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', class: className });
  img.addEventListener('load', () => img.classList.add('is-in'));
  img.addEventListener('error', () => img.remove());
  return img;
}

/** Photo hero with a kanji fallback and a linked credit line. */
export function hero(p, glyph, { shade = false, over = null } = {}) {
  const el = h(`figure.hero${shade ? '.hero--shade' : ''}${p ? '' : '.hero--empty'}`, h('div.hero__fallback', { 'aria-hidden': 'true' }, glyph));
  if (p) {
    el.append(photo(p));
    // a stand-in image (the dish, the street, another branch) always says so
    if (p.representative && p.caption) el.append(h('span.hero__rep', `Shown: ${p.caption}`));
    el.append(p.page
      ? h('a.hero__credit', { href: p.page, target: '_blank', rel: 'noopener', title: 'Photo source and licence' }, `Photo: ${p.credit || 'Wikimedia Commons'} · ${p.license || ''}`)
      : h('span.hero__credit', p.credit || ''));
  }
  if (over) el.append(h('div.hero__over', over));
  return el;
}

/** Google Maps links: a search for the place itself, so the traveller lands on its page. */
export function mapsQuery(place) {
  if (place.maps) return place.maps;
  return [place.name, place.city, place.country || 'Japan'].filter(Boolean).join(', ');
}
export const mapsUrl = (place) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery(place))}`;
export const directionsUrl = (place) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsQuery(place))}`;
export const mapsUrlForText = (text) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;

export const MODE_LABEL = { flight: 'Flight', train: 'Train', bus: 'Bus', walk: 'On foot', transfer: 'Transfer' };
export const MODE_ICON = { flight: 'plane', train: 'train', bus: 'bus', walk: 'walk', transfer: 'dots' };

export function checkButton(checked, label, onToggle, square = false) {
  return h(`button.check${square ? '.check--sq' : ''}`, {
    type: 'button', role: 'checkbox', 'aria-checked': String(!!checked), 'aria-label': label, title: label,
    onclick: (e) => { e.stopPropagation(); onToggle(); },
  }, icon('check', 14));
}

/* Toasts */
let toastHost = null;
export function toast(message, { duration = 6000 } = {}) {
  toastHost = toastHost || document.getElementById('toasts');
  if (!toastHost) return;
  const el = h('div.toast', h('span', message), h('button', { type: 'button', 'aria-label': 'Dismiss', onclick: () => el.remove() }, icon('close', 14)));
  toastHost.append(el);
  if (duration) setTimeout(() => el.remove(), duration);
}
