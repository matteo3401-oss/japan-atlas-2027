/* Bottom timeline: every day of the trip, grouped by destination,
   with the Play Journey button at its head. */

import { h, icon, mount } from '../lib/dom.js';
import { todayInJapan } from '../lib/time.js';
import { MODE_ICON } from './common.js';

export function mountTimeline(el, ctx) {
  const { store, model, actions } = ctx;

  const play = h('button.playbtn', { type: 'button', onclick: () => actions.startJourney(store.get().mode === 'day' ? store.get().dayIndex : 0) },
    h('span.playbtn__disc', icon('play', 18)),
    h('span.playbtn__lbl', h('span.playbtn__t', { style: { display: 'block' } }, 'Play Journey'), h('span.playbtn__s', { style: { display: 'block' } }, 'The trip as a film')));
  const days = h('div.days', { role: 'tablist', 'aria-label': 'Days' });
  mount(el, play, days);

  // destination bands
  const groups = [];
  for (const d of model.days) {
    const last = groups[groups.length - 1];
    if (last && last.id === d.destination) last.days.push(d); else groups.push({ id: d.destination, days: [d] });
  }

  function render() {
    const s = store.get();
    const today = todayInJapan();
    const current = s.mode === 'day' ? model.days[s.dayIndex] : null;
    let col = 1;
    const bands = groups.map((g) => {
      const start = col;
      col += g.days.length;
      const dest = g.id ? model.destById[g.id] : null;
      const isCurrent = (current && current.destination === g.id && g.days.includes(current)) || (s.mode === 'destination' && s.destinationId === g.id);
      return h(`button.band${isCurrent ? '.is-current' : ''}`, {
        type: 'button', style: { gridColumn: `${start} / span ${g.days.length}` }, tabindex: '-1',
        onclick: () => (dest ? actions.selectDestination(dest.id) : actions.selectDay(g.days[0].index)),
      }, dest
        ? [h('span.jp', dest.kanji), h(`span.band__city${dest.district ? '.band__city--opt' : ''}`, dest.name), dest.district ? h('span.band__district', dest.district) : null]
        : [icon('plane', 11), h('span.band__city.band__city--opt', 'In flight')]);
    });
    const cells = model.days.map((d, i) => {
      const done = d.items.filter((it) => s.done[it.id]).length;
      const travel = d.items.find((it) => it.isLeg && it.leg.mode !== 'walk');
      const first = i === 0 || model.days[i - 1].destination !== d.destination;
      return h(`button.day${first ? '.is-first' : ''}${d.date === today ? '.is-today' : ''}`, {
        type: 'button', role: 'tab', 'aria-selected': String(current === d), 'aria-current': current === d ? 'true' : null,
        'aria-label': `Day ${d.number}, ${d.parts.dowLong} ${d.parts.monLong} ${d.parts.d}: ${d.title}`, title: d.title,
        onclick: () => actions.selectDay(i), dataset: { day: i }, style: { gridColumn: String(i + 1) },
      },
        travel ? h('span.day__mode', icon(MODE_ICON[travel.leg.mode], 11)) : null,
        h('span.day__dow', d.parts.dow),
        h('span.day__num', d.parts.d),
        h('span.day__bar', h('i', { style: { width: `${(done / d.items.length) * 100}%` } })));
    });
    mount(days, bands, cells);
    const cur = days.querySelector('[aria-current="true"]');
    if (cur && days.scrollWidth > days.clientWidth) cur.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  days.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const s = store.get();
    const i = s.mode === 'day' ? s.dayIndex : -1;
    const next = Math.max(0, Math.min(model.days.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
    actions.selectDay(next);
    requestAnimationFrame(() => days.querySelector(`[data-day="${next}"]`)?.focus());
    e.preventDefault();
  });

  store.on(['mode', 'dayIndex', 'destinationId', 'done'], render);
  render();
}

/* Destination tabs in the top bar. */
export function mountChapters(el, ctx) {
  const { store, model, actions } = ctx;
  function render() {
    const s = store.get();
    const curDest = s.mode === 'destination' ? s.destinationId : s.mode === 'day' ? model.days[s.dayIndex].destination : null;
    mount(el,
      h('button.chapter', { type: 'button', 'aria-current': s.mode === 'trip' ? 'true' : null, onclick: () => actions.showTrip() },
        h('span.chapter__jp', '日本'), h('span.chapter__en', 'Nationwide')),
      model.destinations.map((d) => h('button.chapter', { type: 'button', 'aria-current': curDest === d.id ? 'true' : null, onclick: () => actions.selectDestination(d.id), title: d.tagline },
        h('span.chapter__jp', d.kanji), h('span.chapter__en', d.district || d.name))));
    el.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }
  store.on(['mode', 'dayIndex', 'destinationId'], render);
  render();
}
