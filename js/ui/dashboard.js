/* Travel dashboard: a collapsible drawer with the countdown, progress,
   deadlines, checklist, stays, transport, timeline and the plan's open flags. */

import { h, icon, mount } from '../lib/dom.js';
import { countdownParts, daysUntil, fmtDow, fmtRange, fmtShort, nightsBetween, todayInJapan } from '../lib/time.js';
import { seal, statusChip, checkButton, MODE_ICON, MODE_LABEL } from './common.js';
import { ATTRIBUTION } from '../map/style.js';
import { isLockedBuild } from '../load.js';
import { forgetKey, hasRememberedKey } from '../lock.js';

export function mountDashboard(el, scrim, btnHost, ctx) {
  const { store, model, actions } = ctx;
  const open = { now: true, progress: true, deadlines: true };   // which sections start expanded
  let timer = null;

  /* The button in the top bar carries the live countdown. */
  const num = h('span.dashbtn__num', '');
  const lbl = h('span.dashbtn__lbl', '');
  const button = h('button.dashbtn', { type: 'button', 'aria-haspopup': 'dialog', onclick: () => store.set({ dashboardOpen: !store.get().dashboardOpen }) },
    h('span.dashbtn__count', num, lbl), h('span.dashbtn__sep'), icon('dashboard', 18));
  btnHost.append(button);

  function tripPhase() {
    const today = todayInJapan();
    if (today < model.trip.start) return { phase: 'before' };
    if (today > model.trip.end) return { phase: 'after' };
    return { phase: 'during', dayIndex: Math.max(0, model.dayIndexForDate(today)) };
  }

  function tickButton() {
    const ph = tripPhase();
    if (ph.phase === 'before') {
      const c = countdownParts(model.trip.departureISO);
      num.textContent = c.days > 0 ? String(c.days) : `${c.hours}h`;
      lbl.textContent = c.days === 1 ? 'day to go' : c.days > 0 ? 'days to go' : 'to departure';
    } else if (ph.phase === 'during') {
      num.textContent = `${ph.dayIndex + 1}/${model.days.length}`;
      lbl.textContent = 'day of trip';
    } else { num.textContent = '✓'; lbl.textContent = 'trip complete'; }
  }

  const section = (id, title, meta, ...body) => {
    const d = h('details.dsec', { open: open[id] ? true : null, id: `dash-${id}` },
      h('summary', h('h3', title), meta ? h('span.dsec__meta', meta) : null, icon('chevronD', 16)),
      h('div.dsec__body', body));
    d.addEventListener('toggle', () => { open[id] = d.open; });
    return d;
  };

  function render() {
    const s = store.get();
    el.hidden = !s.dashboardOpen;
    scrim.hidden = !s.dashboardOpen;
    button.setAttribute('aria-expanded', String(s.dashboardOpen));
    clearInterval(timer);
    tickButton();
    if (!s.dashboardOpen) { timer = setInterval(tickButton, 60000); return; }

    const keep = el.querySelector('.dash__body')?.scrollTop || 0;
    const ph = tripPhase();
    const doneIds = Object.keys(s.done).filter((id) => model.items[id]);
    const pct = Math.round((doneIds.length / model.totalItems) * 100);
    const selDay = model.days[s.dayIndex];

    /* Countdown */
    const countEl = h('div.count');
    const drawCount = () => {
      const c = countdownParts(model.trip.departureISO);
      if (ph.phase === 'before') {
        mount(countEl, h('p.kicker.kicker--red', 'Until wheels up'),
          h('div.count__nums',
            h('span.count__n', String(c.days), h('small', c.days === 1 ? 'day' : 'days')),
            h('span.count__n.count__n--sm', String(c.hours).padStart(2, '0'), h('small', 'hours')),
            h('span.count__n.count__n--sm', String(c.minutes).padStart(2, '0'), h('small', 'min'))),
          h('p.count__sub', model.trip.departureNote));
      } else if (ph.phase === 'during') {
        const d = model.days[ph.dayIndex];
        mount(countEl, h('p.kicker.kicker--red', 'On the road'),
          h('div.count__nums', h('span.count__n', String(ph.dayIndex + 1), h('small', `of ${model.days.length} days`))),
          h('p.count__sub', `Today: ${d.title}.`));
      } else {
        mount(countEl, h('p.kicker.kicker--red', 'Home again'), h('p.count__sub', { style: { marginTop: '10px' } }, 'The trip is complete. Everything you marked is still saved on this device.'));
      }
    };
    drawCount();
    timer = setInterval(() => { drawCount(); tickButton(); }, 30000);

    /* Now */
    const currentDest = ph.phase === 'during' ? model.days[ph.dayIndex].dest : null;
    const nowSec = section('now', 'Where you are', null,
      h('div.statgrid',
        h('div.stat', h('span.kicker', 'Current destination'),
          h('b', ph.phase === 'during' ? (currentDest ? `${currentDest.name}${currentDest.district ? ` · ${currentDest.district}` : ''}` : 'In flight') : ph.phase === 'before' ? 'Not travelling yet' : 'Home'),
          h('span', ph.phase === 'before' ? model.trip.firstStopNote : ph.phase === 'during' ? fmtDow(model.days[ph.dayIndex].date) : model.trip.datesLabel)),
        h('div.stat', h('span.kicker', 'Selected day'),
          h('b', `Day ${selDay.number} · ${fmtShort(selDay.date)}`),
          h('span', selDay.title))),
      h('div.linkrow',
        ph.phase === 'during' ? h('button.btn.btn--sm.btn--ink', { type: 'button', onclick: () => { actions.selectDay(ph.dayIndex); store.set({ dashboardOpen: false }); } }, 'Go to today') : null,
        h('button.btn.btn--sm', { type: 'button', onclick: () => { actions.selectDay(s.dayIndex); store.set({ dashboardOpen: false }); } }, 'Open selected day'),
        h('button.btn.btn--sm', { type: 'button', onclick: () => { store.set({ dashboardOpen: false }); actions.startJourney(0); } }, icon('play', 12), 'Play journey')));

    /* Progress */
    const progSec = section('progress', 'Trip progress', `${doneIds.length} / ${model.totalItems}`,
      h('div.progress', { style: { height: '4px' } }, h('i', { style: { width: `${pct}%` } })),
      h('p.small.muted', { style: { marginTop: '8px' } }, doneIds.length
        ? `${pct}% of the plan marked done. Saved on this device only.`
        : 'Tick activities off as you go; your progress is saved on this device.'),
      h('div.destbars', [{ id: null, label: 'Flights out' }, ...model.destinations.map((d) => ({ id: d.id, label: `${d.name}${d.district ? ` · ${d.district}` : ''}` }))].map((g) => {
        const its = model.days.filter((d) => d.destination === g.id).flatMap((d) => d.items);
        const dn = its.filter((it) => s.done[it.id]).length;
        return its.length ? h('div.destbar', h('span', g.label), h('div.progress', h('i', { style: { width: `${(dn / its.length) * 100}%` } })), h('span', `${dn}/${its.length}`)) : null;
      })),
      !store.storageAvailable ? h('div.notice', { style: { marginTop: '12px' } }, icon('info', 14), h('div', 'This browser is blocking local storage, so progress will not survive a reload.')) : null,
      doneIds.length || Object.keys(s.checks).length ? h('div.linkrow', resetButton()) : null);

    /* Deadlines */
    const deadlines = model.checklist.filter((c) => c.kind === 'deadline' || c.due)
      .map((c) => ({ ...c, when: c.now ? '0000' : (c.date || c.due.slice(0, 10)) }))
      .sort((a, b) => a.when.localeCompare(b.when));
    const openDeadlines = deadlines.filter((c) => !s.checks[c.id]);
    const dlSec = section('deadlines', 'Booking deadlines', `${openDeadlines.length} open`,
      deadlines.map((c) => checklistRow(c, s, true)),
      h('p.fine', { style: { marginTop: '10px' } }, 'Dates are as written in your plan (month and day; read as the year of the trip). Opening dates marked “verify” are your own reminders, not confirmed sales dates.'));

    /* Checklist */
    const groups = [
      ['Booked', model.checklist.filter((c) => c.kind === 'booked')],
      ['To reserve', model.checklist.filter((c) => c.kind === 'reserve')],
      ['To check or ask', model.checklist.filter((c) => c.kind === 'verify' || c.kind === 'task')],
    ];
    const checkSec = section('checklist', 'Reservation checklist', `${model.checklist.filter((c) => s.checks[c.id] || c.kind === 'booked').length} / ${model.checklist.length}`,
      groups.map(([title, list]) => [h('p.kicker', { style: { margin: '14px 0 4px' } }, title), list.map((c) => checklistRow(c, s, false))]),
      h('p.kicker', { style: { margin: '18px 0 4px' } }, 'Ticket sites from your plan'),
      h('div.linkrow', Object.values(model.ticketLinks).map((l) => h('a.btn.btn--sm', { href: l.url, target: '_blank', rel: 'noopener' }, l.label, icon('external', 12)))),
      h('p.fine', { style: { marginTop: '12px' } }, 'Booking reference numbers are intentionally left out of this app. Keep them in your PDF or password manager.'));

    /* Stays */
    const staySec = section('stays', 'Accommodation', `${model.stays.length} stays`,
      model.stays.map((st) => h('button.stay', { type: 'button', onclick: () => { store.set({ dashboardOpen: false }); actions.openPlace(st.place, { fly: true }); } },
        seal('stay', '宿'),
        h('div', h('p.stay__n', st.placeRef.name),
          h('p.stay__d', `${st.dest.name}${st.dest.district ? ` · ${st.dest.district}` : ''} · ${fmtRange(st.checkIn, st.checkOut)} · ${nightsBetween(st.checkIn, st.checkOut)} nights`),
          h('p.stay__note', st.note)),
        statusChip(st.status))));

    /* Transport */
    const transSec = section('transport', 'Transportation', `${model.legs.filter((l) => l.status === 'pending').length} to book`,
      model.legs.map((l) => h('button.stay', { type: 'button', onclick: () => { store.set({ dashboardOpen: false }); actions.selectDay(l.dayIndex); } },
        h(`span.legicon.legicon--${l.leg.mode}`, icon(MODE_ICON[l.leg.mode], 15)),
        h('div', h('p.stay__n', l.label),
          h('p.stay__d', `${fmtDow(l.date)} · ${l.timeLabel}${l.est ? ' (est.)' : ''} · ${MODE_LABEL[l.leg.mode]}`),
          l.statusNote ? h('p.stay__note', l.statusNote) : null),
        statusChip(l.status))),
      model.planNotes.map((n) => h('div.notice.notice--quiet', { style: { marginTop: '10px' } }, icon('info', 14), h('div', h('b', `${n.tag}. `), n.text))));

    /* Timeline */
    let lastDest;
    const tlRows = [];
    for (const d of model.days) {
      if (d.destination !== lastDest) {
        lastDest = d.destination;
        tlRows.push(h('div.tl__dest', d.dest ? [h('span.jp', d.dest.kanji), h('span.kicker', `${d.dest.name}${d.dest.district ? ` · ${d.dest.district}` : ''}`)] : h('span.kicker', 'In flight')));
      }
      const dn = d.items.filter((it) => s.done[it.id]).length;
      tlRows.push(h('button.tl', { type: 'button', onclick: () => { store.set({ dashboardOpen: false }); actions.selectDay(d.index); } },
        h('span.tl__d', `${d.parts.dow} ${d.parts.d}`), h('span.tl__t', d.title), h('span.tl__s.tnum', `${dn}/${d.items.length}`)));
    }
    const tlSec = section('timeline', 'Complete timeline', `${model.days.length} days`, tlRows);

    /* Flags */
    const conflicts = model.flags.filter((f) => f.severity === 'conflict');
    const uncertain = model.flags.filter((f) => f.severity === 'uncertain');
    const notes = model.flags.filter((f) => f.severity === 'note');
    const flagBlock = (title, list, quiet) => list.length ? [h('p.kicker', { style: { margin: '14px 0 8px' } }, title),
      list.map((f) => h(`div.notice${quiet ? '.notice--quiet' : ''}`, icon(quiet ? 'info' : 'flag', 14), h('div', h('b', f.title), h('br'), f.text)))] : null;
    const flagSec = section('flags', 'Open questions in the plan', `${conflicts.length + uncertain.length}`,
      h('p.small.muted', 'Where the plan is unclear or contradicts itself, nothing was decided for you. Each item is listed here instead.'),
      flagBlock('Conflicts', conflicts, false), flagBlock('Uncertain', uncertain, false), flagBlock('Notes', notes, true));

    /* Sources */
    const srcSec = section('sources', 'Sources and credits', null,
      h('div.fine',
        h('p', { html: `Map: ${ATTRIBUTION.vector}.` }),
        h('p', { html: `${ATTRIBUTION.dem}.` }),
        h('p', { html: `Imagery (optional layer): ${ATTRIBUTION.imagery}.` }),
        h('p', 'Rail lines follow OpenStreetMap track geometry. Bus lines and walking paths come from OpenStreetMap routing and are indicative. Flights are great-circle arcs.'),
        h('p', 'Marker positions were looked up in OpenStreetMap and official addresses, never estimated. Each card states its source.'),
        h('p', 'Photographs are from Wikimedia Commons under free licences; each one links to its author and licence.'),
        h('p', 'Itinerary, times and statuses: your Japan Trip Master Itinerary PDF. Place descriptions outside the “from your notes” sections are general background.')));

    mount(el,
      h('header.dash__head', h('div', h('p.kicker', 'Travel dashboard'), h('h2', { style: { font: '600 26px/1.1 var(--serif)', marginTop: '4px' } }, model.trip.dashboardTitle)),
        h('button.iconbtn', { type: 'button', 'aria-label': 'Close dashboard', onclick: () => store.set({ dashboardOpen: false }) }, icon('close'))),
      h('div.dash__body', countEl, nowSec, progSec, dlSec, checkSec, staySec, transSec, tlSec, flagSec, srcSec,
        isLockedBuild() ? h('div.dsec__body', { style: { paddingTop: '18px' } },
          h('p.fine', hasRememberedKey()
            ? 'This device remembers the passphrase. Lock it again if you lend or lose the phone.'
            : 'This device will ask for the passphrase each time it opens the atlas.'),
          hasRememberedKey() ? h('div.linkrow', h('button.btn.btn--sm', { type: 'button', onclick: () => { forgetKey(); location.reload(); } }, 'Lock this device')) : null) : null));
    el.querySelector('.dash__body').scrollTop = keep;
  }

  function checklistRow(c, s, showWhen) {
    const checked = !!s.checks[c.id];
    const booked = c.kind === 'booked';
    let when = null;
    if (c.now) when = h('b', 'Actionable now');
    else if (c.date) {
      const n = daysUntil(c.date);
      const end = c.dateEnd ? daysUntil(c.dateEnd) : n;
      when = n > 0 ? `in ${n} day${n === 1 ? '' : 's'}` : end >= 0 ? h('b', c.dateEnd ? 'Window open now' : 'Today') : h('b', `${-end} day${end === -1 ? '' : 's'} ago`);
    } else if (c.due) {
      const n = daysUntil(c.due.slice(0, 10));
      when = [`${c.dueLabel}: `, n >= 0 ? `in ${n} days` : h('b', 'passed')];
    }
    const overdue = !checked && !booked && c.date && daysUntil(c.dateEnd || c.date) < 0;
    const link = c.link && model.ticketLinks[c.link];
    return h(`div.dl${checked ? '.is-checked' : ''}${overdue ? '.is-overdue' : ''}`,
      h('span.dl__tag', c.tag),
      h('div', h('p.dl__txt', c.text),
        (showWhen && when) || link || c.privateNote ? h('p.dl__when', showWhen && when ? h('span', when) : null,
          link ? h('a', { href: link.url, target: '_blank', rel: 'noopener' }, link.label, icon('external', 11)) : null,
          c.privateNote ? h('span', c.privateNote) : null) : null),
      booked && !c.due ? h('span.check.check--sq', { 'aria-checked': 'true', title: 'Booked, per your plan', style: { background: 'var(--ink)', borderColor: 'var(--ink)', color: 'var(--paper)' } }, icon('check', 14))
        : checkButton(checked, checked ? 'Mark as open' : 'Mark as handled', () => store.toggleCheck(c.id), true));
  }

  function resetButton() {
    let armed = false;
    const b = h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => {
      if (!armed) { armed = true; b.textContent = 'Tap again to clear all ticks'; setTimeout(() => { armed = false; b.textContent = 'Reset progress'; }, 4000); return; }
      store.resetProgress();
    } }, 'Reset progress');
    return b;
  }

  scrim.addEventListener('click', () => store.set({ dashboardOpen: false }));
  store.on(['dashboardOpen', 'done', 'checks', 'dayIndex'], render);
  render();

  return {
    openSection(id) {
      open[id] = true;
      store.set({ dashboardOpen: true });
      render();
      requestAnimationFrame(() => el.querySelector(`#dash-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    },
  };
}
