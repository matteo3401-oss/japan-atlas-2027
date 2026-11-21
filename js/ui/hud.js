/* Journey HUD: the lower-third of the "travel documentary" — date,
   destination, transport, what is next, and the playback controls. */

import { h, icon, mount } from '../lib/dom.js';
import { fmtRange, nightsBetween } from '../lib/time.js';
import { formatKm } from '../lib/geo.js';
import { SPEEDS } from '../journey.js';
import { statusChip, MODE_LABEL, MODE_ICON, toast } from './common.js';
import { MODES } from '../experience/director.js';

export function mountHud(el, titleEl, ctx) {
  const { store, model, journey, actions, photos, atlas } = ctx;
  let titleTimer = null;
  let shownPhoto = null;

  const kicker = h('div.hud__kicker');
  const title = h('h2.hud__title');
  const meta = h('div.hud__meta');
  const note = h('p.hud__note');
  const next = h('ul.hud__next');
  const photoBox = h('figure.hud__photo.is-off', { 'aria-live': 'off' });
  const fill = h('div.hud__fill');
  const track = h('div.hud__track', { role: 'slider', 'aria-label': 'Journey position', 'aria-valuemin': '0', 'aria-valuemax': '100', tabindex: '0' }, fill);
  const time = h('span.hud__time');
  const playBtn = h('button.iconbtn.hud__play', { type: 'button', 'aria-label': 'Play or pause', onclick: () => journey.toggle() });
  const lightBtn = h('button.hud__btn', { type: 'button', title: 'Switch to evening light automatically after dusk', onclick: () => { journey.autoLight = !journey.autoLight; syncState(); if (journey.autoLight) applyLight(); } }, icon('moon', 14), h('span', 'Auto light'));
  const hasVoice = journey.beats.some((b) => b.lines);
  const voiceBtn = h('button.hud__btn', { type: 'button', hidden: !hasVoice, onclick: () => store.set({ narration: !store.get().narration }) }, icon('sound', 14), h('span', 'Narration'));
  function syncVoice() {
    const on = store.get().narration !== false;
    const fast = journey.speed > 1;
    voiceBtn.setAttribute('aria-pressed', String(on));
    mount(voiceBtn, icon(on && !fast ? 'sound' : 'mute', 14), h('span', 'Narration'));
    voiceBtn.title = !on ? 'Narration is off. Click to turn it on.' : fast ? 'Narration plays at 1× and 0.5×. It is silent at faster speeds.' : 'Narration is on. The journey waits for each line to finish. Click to turn it off.';
  }
  store.on(['narration'], syncVoice);
  const speeds = h('div.speeds', { role: 'group', 'aria-label': 'Playback speed' },
    SPEEDS.map((sp) => h('button', { type: 'button', dataset: { speed: sp }, onclick: () => journey.setSpeed(sp) }, `${sp}×`)));

  // immersive sequences: one button cycles Cinematic → Interactive → Express
  const hasScenes = journey.beats.some((b) => b.cue);
  const modeLabel = h('span');
  const modeBtn = h('button.hud__btn.hud__mode', { type: 'button', hidden: !hasScenes, onclick: () => {
    const at = MODES.findIndex((m) => m.id === store.get().xpMode), nextMode = MODES[(at + 1) % MODES.length];
    store.set({ xpMode: nextMode.id });
    toast(`${nextMode.label}: ${nextMode.hint.charAt(0).toLowerCase()}${nextMode.hint.slice(1)}.`, { duration: 3200 });
  } }, icon('scene', 14), modeLabel);
  function syncMode() {
    const m = MODES.find((x) => x.id === store.get().xpMode) || MODES[0];
    modeLabel.textContent = m.label;
    modeBtn.title = `Immersive sequences: ${m.label}. ${m.hint}. Click to change.`;
    modeBtn.setAttribute('aria-label', modeBtn.title);
    modeBtn.dataset.mode = m.id;
    el.classList.toggle('hud--express', m.id === 'express');
  }
  store.on(['xpMode'], syncMode);
  syncMode();
  for (const b of journey.beats) {
    if (!b.cue) continue;
    const at = b.start + (typeof b.cue.at === 'number' ? b.fly + (b.duration - b.fly - 0.4) * 0.5 : b.cue.at === 'end' ? b.duration : 0);
    track.append(h('span.hud__tick.hud__tick--xp', { style: { left: `${(at / journey.total) * 100}%` }, title: b.cue.exp.title }));
  }

  // day ticks on the scrubber
  let lastDest;
  for (const day of model.days) {
    const first = journey.beats.find((b) => b.dayIndex === day.index);
    if (!first || first.start === 0) { lastDest = day.destination; continue; }
    const destChange = day.destination !== lastDest;
    lastDest = day.destination;
    track.append(h(`span.hud__tick${destChange ? '.hud__tick--dest' : ''}`, { style: { left: `${(first.start / journey.total) * 100}%` } }));
  }

  mount(el,
    h('div.hud__row', h('div', kicker, title, meta, note), h('div.hud__side', photoBox, next)),
    track,
    h('div.hud__bar',
      h('button.iconbtn', { type: 'button', 'aria-label': 'Previous day', title: 'Previous day', onclick: () => journey.prevDay() }, icon('rewind')),
      h('button.iconbtn', { type: 'button', 'aria-label': 'Rewind to previous stop', title: 'Previous stop', onclick: () => journey.prev() }, icon('prev')),
      playBtn,
      h('button.iconbtn', { type: 'button', 'aria-label': 'Skip to next stop', title: 'Next stop', onclick: () => journey.next() }, icon('next')),
      h('button.iconbtn', { type: 'button', 'aria-label': 'Next day', title: 'Next day', onclick: () => journey.nextDay() }, icon('forward')),
      time,
      h('span.hud__spacer'),
      modeBtn, voiceBtn, lightBtn, speeds,
      h('button.hud__btn', { type: 'button', onclick: () => actions.exitJourney(), 'aria-label': 'Exit journey' }, icon('close', 14), h('span', 'Exit'))));

  /* scrubbing */
  const seekFromEvent = (e) => { const r = track.getBoundingClientRect(); journey.seek((e.clientX - r.left) / r.width); };
  track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); seekFromEvent(e); });
  track.addEventListener('pointermove', (e) => { if (e.buttons) seekFromEvent(e); });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { journey.next(); e.preventDefault(); e.stopPropagation(); }
    if (e.key === 'ArrowLeft') { journey.prev(); e.preventDefault(); e.stopPropagation(); }
  });

  function fmtClock(sec) { const m = Math.floor(sec / 60); return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}`; }

  function showTitle(nodes, ms) {
    clearTimeout(titleTimer);
    mount(titleEl, h('div', nodes));
    titleEl.classList.add('is-on');
    titleTimer = setTimeout(() => titleEl.classList.remove('is-on'), ms);
  }
  function hideTitle() { clearTimeout(titleTimer); titleEl.classList.remove('is-on'); }

  /* ── The photograph of whatever is on screen ────────────────────────── */
  /** Which photo belongs to a beat (null for title cards and entries without a place). */
  function photoFor(b) {
    if (!b) return null;
    if (b.type === 'stop') return b.place.photo;
    if (b.type === 'chapter') return photos[b.dest.photo || b.dest.city] || null;
    if (b.type === 'leg') {
      if (b.link) return b.toPlace.photo;                       // walking: a glimpse of where you are heading
      if (b.inferred) return photos[b.item.via && b.item.via.photo] || null;
      const leg = b.item.leg;
      if (leg.photo && photos[leg.photo]) return photos[leg.photo];
      if (leg.mode === 'flight') return model.places[leg.from].photo;
    }
    return null;
  }
  const photoUrl = (p) => (window.innerWidth < 820 ? (p.srcSmall || p.src) : p.src);

  function showPhoto(p) {
    if (p === shownPhoto) return;
    shownPhoto = p;
    if (!p) { photoBox.classList.add('is-off'); return; }
    const img = h('img', { src: photoUrl(p), alt: p.alt || '', decoding: 'async', referrerpolicy: 'no-referrer' });
    const frame = [img, h('figcaption',
      p.representative && p.caption ? h('span.hud__photo-rep', p.caption) : h('span'),
      p.page ? h('a', { href: p.page, target: '_blank', rel: 'noopener', title: 'Photo source and licence' }, `${p.credit || 'Wikimedia Commons'} · ${p.license || ''}`) : h('span.hud__photo-own', p.credit || ''))];
    const reveal = () => { if (shownPhoto !== p) return; mount(photoBox, frame); photoBox.classList.remove('is-off'); requestAnimationFrame(() => img.classList.add('is-in')); };
    img.addEventListener('load', reveal);
    img.addEventListener('error', () => { if (shownPhoto === p) photoBox.classList.add('is-off'); });
    if (img.complete && img.naturalWidth) reveal();
  }

  /** Fetch the next photo ahead of time, so it is ready the moment its stop comes up. */
  function preloadAfter(index) {
    for (let k = index + 1; k < Math.min(index + 6, journey.beats.length); k++) {
      const p = photoFor(journey.beats[k]);
      if (p && p !== shownPhoto) { new Image().src = photoUrl(p); return; }
    }
  }

  function applyLight() {
    if (!journey.autoLight || !journey.active) return;
    actions.setTheme(journey.isNight() ? 'night' : 'day', { temporary: true });
  }

  function onBeat() {
    const b = journey.beat;
    const day = model.days[b.dayIndex];
    const dest = b.type === 'chapter' ? b.dest : day.dest;
    if (store.get().dayIndex !== b.dayIndex || store.get().mode !== 'day') store.set({ mode: 'day', dayIndex: b.dayIndex, placeId: null });
    applyLight();
    showPhoto(photoFor(b));
    preloadAfter(b.index);

    mount(kicker,
      h('span', `Day ${String(day.number).padStart(2, '0')} / ${model.days.length}`), h('i'),
      h('span', `${day.parts.dow} ${day.parts.mon} ${day.parts.d}`),
      dest ? [h('i'), h('span.jp', dest.kanji), h('span', `${dest.name}${dest.district ? ` · ${dest.district}` : ''}`)] : [h('i'), h('span', day.region || 'In flight')]);

    let noteText = '';
    const real = 1000 / journey.speed;
    if (b.type === 'day') {
      title.textContent = day.title;
      mount(meta, h('span', `${day.items.length} entries today`));
      showTitle([h('p.titlecard__sub', `Day ${day.number} · ${day.parts.dowLong}, ${day.parts.monLong} ${day.parts.d}`), h('h2.titlecard__name', day.title), h('div.titlecard__rule')], 2100 * real / 1000);
    } else if (b.type === 'chapter') {
      const nights = nightsBetween(b.dest.from, b.dest.to);
      title.textContent = `${b.dest.name}${b.dest.district ? ` · ${b.dest.district}` : ''}`;
      mount(meta, h('span', `${fmtRange(b.dest.from, b.dest.to)} · ${nights} nights`), h('span.sep'), h('span', b.dest.stayRef ? b.dest.stayRef.placeRef.name : ''));
      noteText = b.dest.tagline;
      showTitle([h('p.titlecard__kanji', b.dest.kanji), h('h2.titlecard__name', `${b.dest.name}${b.dest.district ? ` · ${b.dest.district}` : ''}`),
        h('p.titlecard__sub', `${fmtRange(b.dest.from, b.dest.to)} · ${nights} nights`), h('p.titlecard__tag', b.dest.tagline), h('div.titlecard__rule')], 4200 * real / 1000);
    } else if (b.type === 'leg') {
      hideTitle();
      const seg = b.segment;
      if (b.link) {
        // a walk between two stops of the day
        const to = b.toPlace, from = b.fromPlace;
        title.textContent = `Walk to ${to.short || to.name}`;
        mount(meta,
          h('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, icon('walk', 15), 'On foot'),
          h('span.sep'), h('span', formatKm(seg.km)),
          h('span.sep'), h('span', `from ${from.short || from.name}`));
        noteText = seg.km > 1.5
          ? 'A long walk: this is the path on foot, though you may prefer local transport. The plan lists the stops, not the way between them.'
          : 'Suggested walking path. The plan lists the stops, not the way between them.';
      } else {
      title.textContent = b.inferred ? seg.service : b.item.label;
      mount(meta,
        h('span', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, icon(MODE_ICON[seg.mode], 15), MODE_LABEL[seg.mode]),
        h('span.sep'), h('span', b.inferred ? 'On the way to the next stop' : `${b.item.timeLabel}${b.item.est ? ' (est.)' : ''}`),
        seg.mode !== 'flight' ? [h('span.sep'), h('span', formatKm(seg.km))] : null,
        !b.inferred && seg.service && seg.service !== b.item.label ? [h('span.sep'), h('span', seg.service)] : null,
        !b.inferred ? statusChip(b.item.status) : null);
      noteText = b.inferred ? 'Implied by the plan, not listed in it.'
        : seg.mode === 'bus' ? 'Indicative road route, not the operator’s published path.'
        : seg.mode === 'flight' ? 'Great-circle arc between the two airports.'
        : seg.mode === 'train' ? 'Following the real line.' : '';
      }
    } else {
      hideTitle();
      const it = b.item;
      title.textContent = it.label;
      const place = b.place;
      mount(meta,
        h('span', `${it.timeLabel}${it.est ? ' (est.)' : ''}`),
        place ? [h('span.sep'), h('span', model.categories[place.cat].label)] : null,
        place && place.ja ? [h('span.sep'), h('span.jp', place.ja)] : null,
        statusChip(it.status));
      noteText = b.type === 'note' ? (it.note || 'No specific location in the plan.')
        : it.join === 'or' ? 'Written as either / or; the first option is shown.'
        : place && place.precision === 'candidates' ? 'The branch is not confirmed, so each possibility is marked “?”. Faint dotted paths show the walk to each one.'
        : place ? (place.blurb || '') : '';
    }
    note.textContent = noteText;

    // while walking TO an entry, that entry is itself still "up next"
    const fromSeq = b.item ? b.item.seq - (b.link && b.before ? 1 : 0) : -1;
    const rest = day.items.filter((it) => it.seq > fromSeq);
    const upcoming = (b.type === 'day' || b.type === 'chapter') && !b.item ? day.items.slice(0, 3) : rest.slice(0, 3);
    mount(next, upcoming.length
      ? [h('li', { style: { display: 'block' } }, h('span.kicker', 'Up next')), upcoming.map((it) => h('li', h('span', it.timeLabel.replace(' ET', '')), h('span', it.label)))]
      : h('li', { style: { display: 'block' } }, h('span.kicker', 'End of the day')));
  }

  function onTick() {
    const pct = journey.progress * 100;
    fill.style.width = `${pct}%`;
    track.setAttribute('aria-valuenow', String(Math.round(pct)));
    time.textContent = `${fmtClock(journey.progress * journey.total)} / ${fmtClock(journey.total)}`;
  }

  function syncState() {
    mount(playBtn, icon(journey.playing ? 'pause' : 'play', 20));
    playBtn.setAttribute('aria-label', journey.playing ? 'Pause' : journey.ended ? 'Replay' : 'Play');
    lightBtn.setAttribute('aria-pressed', String(journey.autoLight));
    syncVoice();
    speeds.querySelectorAll('button').forEach((bn) => bn.setAttribute('aria-pressed', String(Number(bn.dataset.speed) === journey.speed)));
    if (journey.ended) {
      title.textContent = 'Home again';
      mount(meta, h('span', 'The journey is complete. Press play to watch it again.'));
      note.textContent = '';
    }
  }

  journey.addEventListener('beat', () => { onBeat(); onTick(); });
  journey.addEventListener('tick', onTick);
  journey.addEventListener('state', syncState);

  /* Tell the map which part of the screen the HUD leaves free, so the train, the
     walker and each stop are framed in the clear area rather than behind a panel. */
  function syncCameraPadding() {
    const zero = { top: 0, right: 0, bottom: 0, left: 0 };
    if (!store.get().journey) { atlas.map.setPadding(zero); return; }
    const phone = window.innerWidth < 820;
    const strip = track.offsetHeight + el.querySelector('.hud__bar').offsetHeight + 34;
    // on a phone the caption panel spans the width, so the clear area ends above it
    atlas.map.setPadding({ ...zero, top: phone ? 64 : 36, bottom: phone ? Math.round(Math.min(310, window.innerHeight * 0.36)) : strip });
    // fold the map credits down to their (i) button so they do not sit over the controls
    const credits = document.querySelector('.maplibregl-ctrl-attrib');
    if (credits) { credits.classList.remove('maplibregl-compact-show'); credits.removeAttribute('open'); }
  }
  window.addEventListener('resize', () => { if (store.get().journey) syncCameraPadding(); });

  function render() {
    const on = store.get().journey;
    el.hidden = !on;
    document.body.classList.toggle('journey', on);
    if (!on) { hideTitle(); showPhoto(null); }
    else { syncState(); }
    syncCameraPadding();
  }
  store.on(['journey'], render);
  render();

  document.addEventListener('keydown', (e) => {
    if (!store.get().journey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const onButton = e.target instanceof Element && e.target.closest('button');
    if (e.key === ' ' && onButton) return;                 // let the focused button act
    if (e.key === ' ' || e.key === 'k') { journey.toggle(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { if (e.shiftKey) journey.nextDay(); else journey.next(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { if (e.shiftKey) journey.prevDay(); else journey.prev(); e.preventDefault(); }
    else if (e.key === 'Escape') actions.exitJourney();
  });
}
