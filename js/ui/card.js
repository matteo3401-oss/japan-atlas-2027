/* Location card: opens when a marker (or a timeline entry) is selected. */

import { h, icon, mount } from '../lib/dom.js';
import { fmtDow } from '../lib/time.js';
import { formatKm } from '../lib/geo.js';
import { seal, statusChip, hero, mapsUrl, directionsUrl, mapsUrlForText, checkButton } from './common.js';

const PRECISION_NOTE = {
  area: 'This is a district or street, so the marker is a representative point rather than an entrance.',
  candidates: 'The plan does not say which one. Every candidate is marked with a “?” on the map, and no route is drawn to or from it.',
  unplaced: 'No address in the plan, so this is not on the map.',
};

export function mountCard(el, ctx) {
  const { store, model, actions } = ctx;

  function render() {
    const s = store.get();
    const place = s.placeId ? model.places[s.placeId] : null;
    if (!place || s.journey) { el.hidden = true; mount(el); return; }
    el.hidden = false;
    const cat = model.categories[place.cat];
    const candidates = place.candidates;
    const accuracy = [PRECISION_NOTE[place.precision], place.geo && place.geo.note].filter(Boolean);
    const near = model.nearby(place.id);
    const unscheduled = place.unscheduled || place.reference;

    const scroll = h('div.card__scroll',
      hero(place.photo, place.glyph),
      h('div.card__head',
        h('div.card__cat', seal(place.cat, place.glyph), h('span.kicker', cat.label), h('span', { style: { flex: '1' } }), statusChip(place.status === 'ref' ? null : place.status)),
        h('h2.card__name', place.name),
        place.ja ? h('p.card__ja', place.ja) : null,
        h('p.small.muted', { style: { marginTop: '6px' } }, place.city)),

      /* When */
      h('section.card__sec',
        h('span.kicker', unscheduled ? 'Not on the schedule' : place.visits.length > 1 ? 'Scheduled visits' : 'Scheduled arrival'),
        unscheduled
          ? h('p.card__p', place.reference ? 'A landmark shown for orientation. It is not a stop in your plan.' : 'This place appears only in the background notes of your plan. No day includes a visit.')
          : place.visits.map((v) => {
              const done = !!s.done[v.itemId];
              return h('div.visit',
                checkButton(done, done ? 'Mark as not done' : 'Mark as done', () => store.toggleDone(v.itemId)),
                h('button.visit__when', { type: 'button', onclick: () => actions.selectDay(v.dayIndex, { keepPlace: true }), title: 'Go to this day' },
                  h('b', `${v.time}${v.est ? ' (est.)' : ''}`),
                  h('span', `Day ${v.dayIndex + 1} · ${fmtDow(v.date)}${v.label !== place.name ? ` · “${v.label}”` : ''}`)),
                statusChip(v.status));
            })),

      place.blurb || place.culture ? h('section.card__sec',
        h('span.kicker', 'About'),
        place.blurb ? h('p.card__p', place.blurb) : null,
        place.culture ? h('p.card__p', place.culture) : null) : null,

      place.lore.map((l) => h('section.card__sec',
        h('span.kicker.kicker--red', 'From your itinerary notes'),
        h('div.lore', l.title !== place.name ? h('p.lore__title', l.title) : null, l.text.map((t) => h('p', t))))),

      accuracy.length || place.flagText || candidates.length ? h('section.card__sec',
        h('span.kicker', candidates.length ? 'Which one?' : 'Accuracy'),
        accuracy.map((t) => h('div.notice.notice--quiet', icon('info', 14), h('div', t))),
        place.flagText ? h('div.notice', icon('flag', 14), h('div', place.flagText)) : null,
        candidates.length ? h('ul.cands', { style: { marginTop: '10px' } }, candidates.map((c) => h('li',
          h('span', c.label, c.note ? h('span.fine', { style: { display: 'block' } }, c.note) : null),
          h('a', { href: mapsUrlForText(c.address ? `${place.ja || place.name} ${c.address}` : `${c.lat},${c.lon}`), target: '_blank', rel: 'noopener' }, 'Maps ↗')))) : null) : null,

      near.length ? h('section.card__sec',
        h('span.kicker', 'Nearby on your itinerary'),
        near.map(({ place: p, km }) => h('button.near', { type: 'button', onclick: () => actions.openPlace(p.id, { fly: true }) },
          seal(p.cat, p.glyph, 'sm'), h('span.near__n', p.short || p.name), h('span.near__d', formatKm(km))))) : null,

      place.coords && place.geo.source ? h('section.card__sec', h('p.fine', `Position: ${describeSource(place)}`)) : null);

    const actionsRow = place.noMaps || place.precision === 'unplaced'
      ? h('div.card__actions', h('p.fine', { style: { gridColumn: '1 / -1' } }, 'Add this place’s coordinates to data/places.geo.json to map it.'))
      : place.precision === 'candidates'
      ? h('div.card__actions', { style: { gridTemplateColumns: '1fr' } }, h('a.btn', { href: mapsUrl(place), target: '_blank', rel: 'noopener' }, icon('pin', 15), 'Search in Google Maps'))
      : h('div.card__actions',
          h('a.btn.btn--primary', { href: mapsUrl(place), target: '_blank', rel: 'noopener' }, icon('pin', 15), 'Open in Google Maps'),
          h('a.btn', { href: directionsUrl(place), target: '_blank', rel: 'noopener', title: 'Directions in Google Maps' }, icon('route', 15), 'Directions'));

    mount(el,
      h('button.iconbtn.card__close', { type: 'button', 'aria-label': 'Close', onclick: () => actions.closePlace() }, icon('close', 15)),
      scroll, actionsRow);
  }

  store.on(['placeId', 'done', 'journey'], render);
  render();
}

function describeSource(place) {
  const g = place.geo;
  const src = { nominatim: 'OpenStreetMap (Nominatim)', overpass: 'OpenStreetMap', wikidata: 'Wikidata', 'address-geocoded': 'official address, geocoded' }[g.source] || g.source;
  return `${src}${g.osm ? ` · ${g.osm}` : ''}${g.address ? ` · ${g.address}` : ''}`;
}
