/* Left panel: the itinerary explorer.
   Three views share it — the whole trip, one destination, one day. */

import { h, icon, mount } from '../lib/dom.js';
import { fmtDow, fmtRange, nightsBetween } from '../lib/time.js';
import { formatKm } from '../lib/geo.js';
import { seal, statusChip, estChip, photo, hero, mapsUrl, checkButton, MODE_LABEL, MODE_ICON } from './common.js';

export function mountPanel(el, ctx) {
  const { store, model, actions } = ctx;
  const tab = h('button.panel__tab', { type: 'button', 'aria-label': 'Show or hide the itinerary', onclick: () => store.set({ panelOpen: !store.get().panelOpen }) });
  document.body.append(tab);
  let lastKey = '';

  function render() {
    const s = store.get();
    const key = `${s.mode}:${s.mode === 'day' ? s.dayIndex : s.destinationId}`;
    const body = el.querySelector('.panel__body');
    const keepScroll = key === lastKey && body ? body.scrollTop : 0;
    lastKey = key;

    const handle = h('button.panel__handle', { type: 'button', 'aria-label': 'Expand or collapse the itinerary', onclick: () => store.set({ panelOpen: !s.panelOpen }) });
    const view = s.mode === 'day' ? dayView(s) : s.mode === 'destination' ? destinationView(s) : tripView(s);
    mount(el, handle, ...view);
    const nb = el.querySelector('.panel__body');
    if (nb && keepScroll) nb.scrollTop = keepScroll;

    document.body.classList.toggle('panel-closed', !s.panelOpen);
    mount(tab, icon(s.panelOpen ? 'chevronL' : 'chevronR', 14));
  }

  /* ── Day ────────────────────────────────────────────────────────────── */
  function dayView(s) {
    const day = model.days[s.dayIndex];
    const doneCount = day.items.filter((it) => s.done[it.id]).length;
    const stay = day.dest && day.dest.stayRef ? null : null; // (stay line is built below from destinations)
    const dest = day.dest ? model.destinations.find((d) => d.id === day.dest.id) : null;

    const head = h('header.panel__head',
      h('div.dayhead',
        h('div',
          h('p.kicker.kicker--red', `Day ${String(day.number).padStart(2, '0')} of ${model.days.length}`),
          h('p.kicker', { style: { marginTop: '6px' } }, `${day.parts.dowLong}, ${day.parts.monLong} ${day.parts.d}`)),
        h('div.dayhead__nav',
          h('button.iconbtn', { type: 'button', 'aria-label': 'Previous day', disabled: s.dayIndex === 0, onclick: () => actions.selectDay(s.dayIndex - 1) }, icon('chevronL')),
          h('button.iconbtn', { type: 'button', 'aria-label': 'Next day', disabled: s.dayIndex === model.days.length - 1, onclick: () => actions.selectDay(s.dayIndex + 1) }, icon('chevronR'))),
        h('h2.dayhead__title', day.title),
        h('div.dayhead__meta',
          dest
            ? h('button', { type: 'button', onclick: () => actions.selectDestination(dest.id), title: 'Destination overview' },
                h('b', `${dest.name}${dest.district ? ` · ${dest.district}` : ''}`), ' ', h('span.jp', dest.kanji))
            : h('span', day.region || ''),
          h('span.tnum', `${doneCount} / ${day.items.length} done`))),
      h('div.progress', { style: { marginTop: '12px' } }, h('i', { style: { width: `${(doneCount / day.items.length) * 100}%` } })));

    const list = h('ol.sched');
    const seenPlaces = new Set();
    for (const item of day.items) {
      const links = day.segments.filter((sg) => sg.itemId === item.id && sg.kind !== 'leg');
      for (const seg of links.filter((sg) => sg.kind !== 'maybe')) list.append(linkRow(seg));
      // possible walks: one line per "?" stop, not one per branch
      const groups = new Map();
      for (const seg of links.filter((sg) => sg.kind === 'maybe')) {
        const key = `${seg.candPlace}:${seg.inbound}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(seg);
      }
      for (const segs of groups.values()) list.append(maybeRow(segs));
      list.append(item.isLeg ? legRow(item, s) : stopRow(item, s, seenPlaces));
    }

    const dayFlags = flagsForDay(day);
    const dawn = model.experiences.filter((x) => x.dayIndex === day.index && !x.itemId);
    const body = h('div.panel__body', dawn.length ? h('div.doors', dawn.map(sceneDoor)) : null, list,
      dayFlags.length ? h('div.block', h('p.kicker.block__title', 'Worth knowing'), dayFlags.map((f) => h('div.notice', icon('flag', 14), h('div', h('b', f.title), h('br'), f.text)))) : null);

    const foot = h('footer.panel__foot',
      h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => actions.frameDay() }, icon('reset', 15), 'Frame the day'),
      h('button.btn.btn--sm', { type: 'button', onclick: () => actions.startJourney(s.dayIndex) }, icon('play', 13), 'Play from this day'));
    return [head, body, foot];
  }

  /** The door into an immersive sequence, shown on the entry (or day) it belongs to. */
  function sceneDoor(exp) {
    return h('button.door', { type: 'button', onclick: (e) => { e.stopPropagation(); actions.playExperience(exp.id); } },
      exp.jp ? h('span.door__jp', exp.jp) : null,
      h('span.door__text', h('span.door__k', 'Step inside'), h('b', exp.title), h('span.door__acc', exp.accuracy.label)),
      h('span.door__go', icon('play', 12)));
  }
  const doorsFor = (item) => model.experiences.filter((x) => x.itemId === item.id).map(sceneDoor);

  function stopRow(item, s, seenPlaces) {
    const placesHere = item.placeIds.map((id) => model.places[id]).filter(Boolean);
    const primary = placesHere[0] || null;
    const first = primary && !seenPlaces.has(primary.id);
    placesHere.forEach((p) => seenPlaces.add(p.id));
    const done = !!s.done[item.id];
    const active = primary && s.placeId && item.placeIds.includes(s.placeId);
    const n = item.stopNumbers.length ? item.stopNumbers.join('·') : null;
    const cat = primary ? model.categories[primary.cat] : null;

    const notes = [];
    if (item.statusNote) notes.push(h('p.item__note', item.statusNote));
    if (item.join === 'or') notes.push(h('p.item__note.item__note--quiet', 'Written as either / or. The route follows the first option; the other gets a faint dotted path.'));
    if (item.join === 'either') notes.push(h('p.item__note.item__note--quiet', 'Two places on one line. The plan does not say whether it is one, the other, or both.'));
    if (item.note) notes.push(h('p.item__note.item__note--quiet', item.note));
    if (item.inferred) notes.push(h('p.item__note.item__note--quiet', item.inferred));
    if (primary && primary.precision === 'unplaced') notes.push(h('p.item__note.item__note--quiet', 'Not on the map: no address in the plan.'));
    for (const pl of placesHere) if (pl.precision === 'candidates') notes.push(h('p.item__note.item__note--quiet', pl.candidates.length === 1 ? `${pl.name}: no exact match for this name. The closest match is marked “?”.` : `${pl.name}: the plan names no branch. ${pl.candidates.filter((c) => !c.listOnly).length} candidates are marked “?”.`));

    return h(`li.item${done ? '.is-done' : ''}${active ? '.is-active' : ''}`, { onclick: () => actions.openItem(item), dataset: { item: item.id } },
      h('div.item__time', item.timeLabel.replace(' ET', ''), item.tz === 'ET' ? h('small', 'EASTERN') : null),
      h('div.item__mark', primary ? seal(primary.cat, primary.glyph) : h('span.seal.seal--district', '·'), n ? h('span.item__n', n) : null),
      h('div.item__main',
        h('h3.item__title', item.label),
        primary ? h('p.item__sub', cat.short, placesHere.length === 1 && primary.ja ? [' · ', h('span.jp', primary.ja)] : null) : h('p.item__sub', 'No location in the plan'),
        first && primary.photo ? photo(primary.photo, { small: true, className: 'item__thumb' }) : null,
        first && primary.blurb ? h('p.item__desc', primary.blurb) : null,
        (item.status !== 'none' || item.est) ? h('div.item__tags', statusChip(item.status), item.est ? estChip() : null) : null,
        notes, doorsFor(item),
        h('div.item__actions',
          checkButton(done, done ? 'Mark as not done' : 'Mark as done', () => store.toggleDone(item.id)),
          h('span.item__donelbl', done ? 'Done' : 'Mark done'),
          h('span', { style: { flex: '1' } }),
          primary && !primary.noMaps ? h('a.btn', { href: mapsUrl(primary), target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, icon('external', 13), 'Maps') : null)));
  }

  function legRow(item, s) {
    const done = !!s.done[item.id];
    const seg = item.segment;
    const mode = item.leg.mode;
    const facts = [MODE_LABEL[mode], item.leg.service, item.leg.cabin, seg && mode !== 'flight' ? formatKm(seg.km) : null].filter(Boolean);
    const notes = [];
    if (item.statusNote) notes.push(h('p.item__note', item.statusNote));
    if (item.leg.seats) notes.push(h('p.item__note.item__note--quiet', `Seats ${item.leg.seats}. The confirmation code is kept out of this app.`));
    if (item.leg.inferred) notes.push(h('p.item__note.item__note--quiet', item.leg.inferred));
    if (seg && mode === 'bus') notes.push(h('p.item__note.item__note--quiet', seg.note || 'Road line from OpenStreetMap routing. It is indicative, not the operator’s published route.'));
    if (seg && mode === 'flight') notes.push(h('p.item__note.item__note--quiet', 'Drawn as a great-circle arc, not the flown track.'));
    if (seg && mode === 'train' && !seg.schematic) notes.push(h('p.item__note.item__note--quiet', 'Line follows the real tracks (OpenStreetMap).'));
    if (seg && mode === 'walk') notes.push(h('p.item__note.item__note--quiet', seg.note || 'Trail from OpenStreetMap foot routing.'));
    if (seg && seg.schematic && mode !== 'flight') notes.push(h('p.item__note', 'Route geometry unavailable: shown as a straight line.'));

    return h(`li.item.item--leg${done ? '.is-done' : ''}`, { onclick: () => actions.openItem(item), dataset: { item: item.id } },
      h('div.item__time', item.timeLabel.replace(' ET', ''), item.tz === 'ET' ? h('small', 'EASTERN') : null),
      h('div.item__mark', h(`span.legicon.legicon--${mode}`, icon(MODE_ICON[mode], 15))),
      h('div.item__main',
        h('h3.item__title', item.label),
        h('p.item__sub', facts.join(' · ')),
        item.leg.photo && ctx.photos[item.leg.photo] ? photo(ctx.photos[item.leg.photo], { small: true, className: 'item__thumb' }) : null,
        h('div.item__tags', statusChip(item.status), item.est ? estChip() : null),
        notes, doorsFor(item),
        h('div.item__actions',
          checkButton(done, done ? 'Mark as not done' : 'Mark as done', () => store.toggleDone(item.id)),
          h('span.item__donelbl', done ? 'Done' : 'Mark done'),
          h('span', { style: { flex: '1' } }),
          item.checklist && item.checklist.link && model.ticketLinks[item.checklist.link]
            ? h('a.btn', { href: model.ticketLinks[item.checklist.link].url, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, icon('external', 13), model.ticketLinks[item.checklist.link].label)
            : null)));
  }

  function linkRow(seg) {
    let text;
    if (seg.kind === 'via') text = [icon(MODE_ICON[seg.mode], 12), `${seg.service} · ${formatKm(seg.km)} · implied, not listed`];
    else if (seg.mode === 'walk') text = [icon('walk', 12), seg.km > 1.5 ? `${formatKm(seg.km)} on foot, or by local transport` : `Walk · ${formatKm(seg.km)} · suggested path`];
    else text = [`${formatKm(seg.km)} apart · how you travel is not in the plan`];
    return h(`li.link.link--${seg.kind === 'via' ? 'via' : seg.mode}`, { 'aria-label': 'Connection' }, h('span'), h('span.link__mark'), h('span.link__txt', text));
  }

  function maybeRow(segs) {
    const cand = model.places[segs[0].candPlace];
    const kms = segs.map((sg) => sg.km).sort((x, y) => x - y);
    const range = kms.length > 1 && kms[kms.length - 1] - kms[0] > 0.05 ? `${formatKm(kms[0])} to ${formatKm(kms[kms.length - 1])}` : formatKm(kms[0]);
    const text = `${segs[0].inbound ? 'Possible walk to' : 'Possible walk from'} ${cand.short || cand.name} · ${range}, ${segs[0].alt ? 'if you choose it' : 'depending on the branch'}`;
    return h('li.link.link--maybe', { 'aria-label': 'Possible connection' }, h('span'), h('span.link__mark'), h('span.link__txt', icon('walk', 12), text));
  }

  function flagsForDay(day) {
    const ids = new Set(day.items.flatMap((it) => [it.flag, it.dayFlag]).filter(Boolean));
    for (const f of day.flags || []) ids.add(f);
    return model.flags.filter((f) => ids.has(f.id));
  }

  /* ── Destination ────────────────────────────────────────────────────── */
  function destinationView(s) {
    const dest = model.destinations.find((d) => d.id === s.destinationId) || model.destinations[0];
    const cityPhoto = ctx.photos[dest.photo || dest.city] || null;
    const nights = nightsBetween(dest.from, dest.to);
    const stay = dest.stayRef;
    const lore = model.lore.filter((l) => l.places.some((pid) => { const p = model.places[pid]; return p && placeInDestination(p, dest); }));

    const head = hero(cityPhoto, dest.kanji, { shade: true, over: [h('p.bigkanji', dest.kanji), h('h2.desttitle', `${dest.name}${dest.district ? ` · ${dest.district}` : ''}`)] });
    const body = h('div.panel__body',
      head,
      h('div.block',
        h('p.kicker.kicker--red', `${fmtRange(dest.from, dest.to)} · ${nights} night${nights === 1 ? '' : 's'}`),
        h('p.lede', { style: { marginTop: '10px' } }, dest.tagline),
        h('p.card__p', { style: { marginTop: '10px' } }, dest.identity)),
      stay ? h('div.block', h('p.kicker.block__title', 'Where you stay'),
        h('button.stay', { type: 'button', onclick: () => actions.openPlace(stay.place, { fly: true }) },
          seal('stay', '宿'),
          h('div', h('p.stay__n', stay.placeRef.name), h('p.stay__d', `${fmtRange(stay.checkIn, stay.checkOut)} · ${nightsBetween(stay.checkIn, stay.checkOut)} nights`), h('p.stay__note', stay.note)),
          statusChip(stay.status))) : null,
      h('div.block', { style: { padding: '18px 0 8px' } }, h('p.kicker.block__title', { style: { padding: '0 20px' } }, 'Days here'),
        dest.dayIndexes.map((i) => {
          const d = model.days[i];
          return h('button.rowbtn', { type: 'button', onclick: () => actions.selectDay(i) },
            h('span.rowbtn__n', `DAY ${String(d.number).padStart(2, '0')}`),
            h('span', h('span.rowbtn__t', d.title), h('span.rowbtn__s', { style: { display: 'block' } }, `${fmtDow(d.date)} · ${d.items.length} entries`)),
            icon('chevronR', 14));
        })),
      lore.length ? h('div.block', h('p.kicker.block__title', 'From your itinerary notes'),
        lore.map((l) => h('div.lore', { style: { marginBottom: '16px' } },
          h('p.lore__title', l.title, l.scheduled ? null : h('span.chip.chip--tentative', 'Not on the schedule')),
          l.text.map((t) => h('p', t))))) : null);

    const foot = h('footer.panel__foot',
      h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => actions.showTrip() }, icon('chevronL', 14), 'Whole trip'),
      h('button.btn.btn--sm', { type: 'button', onclick: () => actions.startJourney(dest.dayIndexes[0]) }, icon('play', 13), 'Play from here'));
    return [body, foot];
  }

  function placeInDestination(place, dest) {
    return place.visits.some((v) => model.days[v.dayIndex].destination === dest.id) || (place.unscheduled && place.city.toLowerCase() === dest.city);
  }

  /* ── Whole trip ─────────────────────────────────────────────────────── */
  function tripView(s) {
    const doneCount = Object.keys(s.done).filter((id) => model.items[id]).length;
    const rows = [];
    const outbound = model.legs.find((l) => l.leg.mode === 'flight');
    if (outbound) rows.push(stepRow(outbound));
    model.destinations.forEach((dest, i) => {
      const nights = nightsBetween(dest.from, dest.to);
      rows.push(h('button.rowbtn', { type: 'button', onclick: () => actions.selectDestination(dest.id) },
        h('span.rowbtn__n.jp', { style: { fontSize: '17px', letterSpacing: '.08em', color: 'var(--ink)' } }, dest.kanji),
        h('span', h('span.rowbtn__t', `${dest.name}${dest.district ? ` · ${dest.district}` : ''}`),
          h('span.rowbtn__s', { style: { display: 'block' } }, `${fmtRange(dest.from, dest.to)} · ${nights} nights`)),
        icon('chevronR', 14)));
      const next = model.destinations[i + 1];
      const leg = next
        ? model.legs.find((l) => l.leg.mode !== 'flight' && l.leg.mode !== 'walk' && model.days[l.dayIndex].destination === next.id)
        : model.legs.filter((l) => l.leg.mode === 'flight').pop();
      if (leg) rows.push(stepRow(leg));
    });

    const head = h('header.panel__head',
      h('p.kicker.kicker--red', 'The journey'),
      h('h2.dayhead__title', model.trip.headline),
      h('div.dayhead__meta', h('span', `${model.days.length} days`), h('span', `${model.stays.length} stays`), h('span.tnum', `${doneCount} / ${model.totalItems} done`)));
    const flags = model.flags.filter((f) => f.severity !== 'note').length;
    const body = h('div.panel__body',
      h('div.block', h('p.lede', model.trip.lede)),
      h('div.block', { style: { padding: '14px 0' } }, rows),
      h('div.block', h('div.notice', icon('flag', 14),
        h('div', h('b', `${flags} things in the plan need a decision or a check.`), ' ',
          h('button', { type: 'button', style: { textDecoration: 'underline' }, onclick: () => actions.openDashboard('flags') }, 'See the list')))));
    const foot = h('footer.panel__foot',
      h('span.small.muted', 'Select a day below, or'),
      h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => actions.startJourney(0) }, icon('play', 13), 'Play the journey'));
    return [head, body, foot];
  }

  function stepRow(leg) {
    return h('div.route-step', h('i'),
      h('span', icon(MODE_ICON[leg.leg.mode], 13),
        h('span', `${fmtDow(leg.date)} · ${leg.label}`, leg.status === 'pending' ? h('em', ' · not booked') : null)));
  }

  store.on(['mode', 'dayIndex', 'destinationId', 'done', 'placeId', 'panelOpen'], render);
  render();
  return { render };
}
