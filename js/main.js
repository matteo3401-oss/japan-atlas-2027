/* ════════════════════════════════════════════════════════════════════════
   Japan Atlas — bootstrap and wiring.

   Loads the itinerary and the generated geodata, builds the model, creates
   the map, then mounts each interface component. Components never talk to
   each other directly: they read the store and call the `actions` below.
   ════════════════════════════════════════════════════════════════════════ */

import { createStore } from './state.js';
import { buildModel } from './model.js';
import { isLockedBuild, loadPlain, mediaLoader } from './load.js';
import { openLocked } from './lock.js';
import { Atlas } from './map/atlas.js';
import { loadSealFont } from './map/seals.js';
import { PALETTES } from './map/style.js';
import { Journey, stopCamera } from './journey.js';
import { Narrator } from './voice.js';
import { isMobile } from './lib/dom.js';
import { todayInJapan } from './lib/time.js';
import { mountPanel } from './ui/panel.js';
import { mountCard } from './ui/card.js';
import { mountTimeline, mountChapters } from './ui/timeline.js';
import { mountControls } from './ui/controls.js';
import { mountDashboard } from './ui/dashboard.js';
import { mountHud } from './ui/hud.js';
import { toast } from './ui/common.js';
import { ExperienceDirector } from './experience/director.js';

const $ = (id) => document.getElementById(id);

function fail(message) {
  $('loading-text').textContent = message;
  document.querySelector('.loading__seal').style.animation = 'none';
}

async function boot() {
  if (!window.maplibregl) { fail('The map library did not load. Check the connection and reload.'); return; }

  const store = createStore();
  if (isMobile()) store.set({ panelOpen: false });   // on a phone the map comes first; the itinerary is a sheet you pull up

  /* Trip data: read from the editable files here, or decrypted with the passphrase in a hosted copy. */
  let bundle;
  try {
    bundle = isLockedBuild() ? await openLocked($('lock')) : await loadPlain();
  } catch (err) {
    fail(err.message || 'The trip data could not be loaded.');
    return;
  }
  document.body.classList.remove('is-locked');
  const { geo, photos, routes } = bundle;
  const model = buildModel(bundle);
  document.title = `${model.trip.title} · ${model.trip.datesLabel}`;
  $('brand-dates').textContent = model.trip.datesLabel;

  /* ── Map ─────────────────────────────────────────────────────────────── */
  let atlas;
  try {
    const intro = { ...model.nationView, zoom: model.nationView.zoom - 1.6, pitch: 0, bearing: 0 };
    atlas = new Atlas($('map'), { theme: store.get().theme, terrain: store.get().terrain, view: intro });
  } catch (err) {
    fail('This device could not start the 3D map (WebGL is unavailable).');
    return;
  }
  document.body.classList.toggle('theme-night', store.get().theme === 'night');
  await Promise.all([atlas.ready, loadSealFont('宿食社買文景駅空街')]);

  const journey = new Journey({ atlas, model });
  const media = mediaLoader(bundle);
  const director = new ExperienceDirector({ list: model.experiences, assets: model.experienceAssets, store, atlas, toast, media });
  // narration: the journey slows itself down so that every recorded line can finish
  const narrator = model.narration.length ? new Narrator(media) : null;
  journey.voice = narrator;
  journey.wantsVoice = () => store.get().narration !== false;
  if (narrator) {
    journey.addEventListener('beat', () => { if (journey._voiceOn()) journey.upcomingLines().forEach((line) => narrator.preload(line)); });
    store.on(['narration'], (s) => { if (!s.narration) journey.hush(); });
  }
  const ctx = { store, model, atlas, journey, photos, director, actions: null };

  /* ── Derived map content ─────────────────────────────────────────────── */
  const placeVisible = (p, layers) => layers[p.cat]
    && (p.status !== 'confirmed' || layers.confirmed)
    && (p.status !== 'pending' || layers.pending);
  const point = (p, coords, props) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: coords },
    properties: { id: p.id, cat: p.cat, glyph: p.glyph, status: p.status, label: p.short || p.name, rank: p.cat === 'stay' ? 0 : p.status === 'ref' ? 3 : 1, ...props },
  });
  /** One marker for a placed stop; one "?" marker per candidate when the plan names no branch. */
  const features = (p, extra = {}) => (p.coords
    ? [point(p, p.coords, extra)]
    : p.candidates.filter((c) => !c.listOnly).map((c) => point(p, c.coords, { status: 'cand', label: `${p.short || p.name}? ${c.label.replace(/^(Possible|Closest) match: /, '')}`, rank: 2, ...extra })));

  function syncMarkers() {
    const s = store.get();
    const day = s.mode === 'day' ? model.days[s.dayIndex] : null;
    const inDay = new Set(day ? day.stops : []);
    const placed = Object.values(model.places).filter((p) => p.focus && placeVisible(p, s.layers));
    atlas.setPlaces(placed.filter((p) => !inDay.has(p.id)).flatMap((p) => features(p)));
    atlas.setDayStops(placed.filter((p) => inDay.has(p.id)).flatMap((p) => features(p, { n: String(day.stopNumber[p.id]), order: day.stopNumber[p.id] })));
    atlas.setRouteState({
      date: day ? day.date : '',
      visibility: { transport: s.layers.transport, walking: s.layers.walking, confirmed: s.layers.confirmed, pending: s.layers.pending },
    });
  }

  atlas.setRoutes(model.segments.map((seg) => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates: seg.coords },
    properties: { id: seg.id, mode: seg.mode, date: seg.date, status: seg.status, kind: seg.kind },
  })));

  function syncPadding() {
    const s = store.get();
    if (s.journey) { atlas.setPadding({ top: 60, right: 20, bottom: 200, left: 20 }); return; }
    if (isMobile()) {
      const sheet = s.panelOpen ? Math.min(window.innerHeight * 0.64, 560) : 74;
      // an open location card is a sheet over the lower two-thirds of the screen
      atlas.setPadding({ top: 118, right: 54, bottom: s.placeId ? window.innerHeight * 0.68 : 72 + sheet, left: 10 });
    } else {
      atlas.setPadding({ top: 76, right: s.placeId ? 446 : 64, bottom: 124, left: s.panelOpen ? 408 : 24 });
    }
  }

  function applyTheme(theme) {
    atlas.setTheme(theme);
    document.body.classList.toggle('theme-night', theme === 'night');
    document.querySelector('meta[name="theme-color"]').setAttribute('content', PALETTES[theme].paper);
  }

  /* ── Actions ─────────────────────────────────────────────────────────── */
  const flightView = (day) => {
    const seg = day.segments.find((sg) => sg.mode === 'flight');
    if (!seg) return null;
    const mid = seg.coords[Math.floor(seg.coords.length / 2)];
    return { center: mid, zoom: isMobile() ? 1.2 : 1.8, pitch: 0, bearing: 0 };
  };

  const actions = {
    selectDay(i, { keepPlace = false, fly = true } = {}) {
      const day = model.days[i];
      if (!day) return;
      store.set({ mode: 'day', dayIndex: i, destinationId: day.destination, placeId: keepPlace ? store.get().placeId : null, layersOpen: false });
      if (fly && !store.get().journey) actions.frameDay();
    },
    frameDay() {
      const day = model.days[store.get().dayIndex];
      syncPadding();
      const fv = flightView(day);
      if (fv) { atlas.flyTo(fv, 2600); return; }
      const pts = day.points.filter((c) => c[0] > 100 && c[0] < 160);
      if (!pts.length) { if (day.dest) atlas.flyTo(day.dest.view); return; }
      const intercity = day.segments.some((sg) => sg.kind === 'leg' && sg.km > 40);
      atlas.fit(pts, { pitch: intercity ? 40 : 54, bearing: intercity ? 0 : (day.dest ? day.dest.view.bearing * 0.35 : 0), maxZoom: 15.2 });
    },
    selectDestination(id) {
      const dest = model.destById[id];
      if (!dest) return;
      store.set({ mode: 'destination', destinationId: id, placeId: null, layersOpen: false });
      syncPadding();
      atlas.flyTo(dest.view, 3200);
    },
    showTrip() {
      store.set({ mode: 'trip', destinationId: null, placeId: null, layersOpen: false });
      syncPadding();
      atlas.flyTo(nationView(), 3000);
    },
    openPlace(id, { fly = false } = {}) {
      const place = model.places[id];
      if (!place) return;
      store.set({ placeId: id, layersOpen: false });
      syncPadding();
      if (fly && place.coords) {
        const cam = stopCamera(place);
        atlas.flyToPlace(place.coords, { zoom: Math.min(cam.zoom, 16), pitch: cam.pitch, bearing: cam.bearing });
      } else if (fly && place.focus) {
        atlas.fit(place.candidates.filter((c) => !c.listOnly).map((c) => c.coords), { pitch: 48, maxZoom: 15.6 });
      } else if (place.coords) {
        atlas.reveal(place.coords);      // marker click: only move if a panel would hide it
      }
    },
    openItem(item) {
      if (item.isLeg) {
        if (!item.segment) return;
        store.set({ placeId: null });
        syncPadding();
        if (item.segment.mode === 'flight') { const fv = flightView(model.days[item.dayIndex]); if (fv) atlas.flyTo(fv); return; }
        atlas.fit(item.segment.coords.filter((_, k, a) => k % Math.ceil(a.length / 60) === 0 || k === a.length - 1), { pitch: 45, bearing: 0 });
        return;
      }
      const place = item.placeIds.map((pid) => model.places[pid]).find((p) => p && p.focus) || model.places[item.placeIds[0]];
      if (place) actions.openPlace(place.id, { fly: true });
    },
    closePlace() { store.set({ placeId: null }); syncPadding(); },
    setTheme(theme, { temporary = false } = {}) {
      if (temporary) applyTheme(theme); else if (store.get().theme === theme) applyTheme(theme); else store.set({ theme });
    },
    setScale(id) {
      const s = store.get();
      const map = atlas.map;
      const place = s.placeId ? model.places[s.placeId] : null;
      const dest = s.destinationId ? model.destById[s.destinationId] : (s.mode === 'day' ? model.days[s.dayIndex].dest : null);
      const anchor = (place && place.coords) || (dest && dest.view.center) || map.getCenter().toArray();
      if (id === 'nation') atlas.flyTo(nationView(), 2600);
      else if (id === 'region') atlas.flyTo({ center: (dest && dest.view.center) || anchor, zoom: 9.3, pitch: 48, bearing: dest ? dest.view.bearing * 0.5 : 0 }, 2600);
      else if (id === 'city') atlas.flyTo(dest && !place ? dest.view : { center: anchor, zoom: 13.2, pitch: 58, bearing: map.getBearing() }, 2600);
      else atlas.flyTo({ center: (place && place.coords) || map.getCenter().toArray(), zoom: 17.2, pitch: 68, bearing: map.getBearing() }, 2600);
    },
    resetCamera() {
      const s = store.get();
      if (s.mode === 'day') actions.frameDay();
      else if (s.mode === 'destination') atlas.flyTo(model.destById[s.destinationId].view, 2200);
      else atlas.flyTo(nationView(), 2200);
    },
    startJourney(dayIndex = 0) {
      store.set({ journey: true, placeId: null, layersOpen: false, dashboardOpen: false });
      syncPadding();
      if (narrator) narrator.prime();   // this is a click, which is what lets the page speak
      journey.start(dayIndex);
    },
    exitJourney() {
      journey.stop();
      store.set({ journey: false });
      applyTheme(store.get().theme);
      syncPadding();
      actions.frameDay();
    },
    openDashboard(section) { dashboard.openSection(section); },
  };
  ctx.actions = actions;

  function nationView() {
    const v = model.nationView;
    return isMobile() ? { ...v, zoom: v.zoom - 1.25, pitch: 20 } : v;
  }

  /* ── Mount the interface ─────────────────────────────────────────────── */
  mountChapters($('chapters'), ctx);
  mountPanel($('panel'), ctx);
  mountCard($('card'), ctx);
  mountTimeline($('timeline'), ctx);
  mountControls($('controls'), $('scalebar'), $('layers'), ctx);
  const dashboard = mountDashboard($('dashboard'), $('scrim'), $('topbar-right'), ctx);
  mountHud($('hud'), $('titlecard'), ctx);

  /* ── Immersive sequences ─────────────────────────────────────────────── */
  journey.wantsCue = () => store.get().xpMode !== 'express';
  // the interface fades back in as the map comes back into focus
  const settle = () => setTimeout(() => { if (!director.active) document.body.classList.remove('in-experience'); }, 750);
  // step in when the journey reaches one, and resume from the same instant afterwards
  journey.addEventListener('experience', async (e) => {
    const mode = store.get().xpMode === 'interactive' ? 'interactive' : 'cinematic';
    document.body.classList.add('in-experience');
    try { await director.run(e.detail.exp, { mode, descend: true, covered: () => journey.restoreCamera() }); }
    finally { settle(); journey.release(); }
  });
  // fetch the next one while the map is still playing, so the cut is not held up
  const warm = () => { if (store.get().xpMode !== 'express') journey.upcomingCues().forEach((x) => director.preload(x)); };
  journey.addEventListener('beat', warm);
  store.on(['xpMode'], warm);
  // outside the journey: open one directly from the itinerary
  actions.playExperience = async (id) => {
    const exp = director.byId(id);
    if (!exp || director.active) return;
    const wasPlaying = journey.active && journey.playing;
    if (wasPlaying) journey.pause();
    const map = atlas.map, cam = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    document.body.classList.add('in-experience');
    try { await director.run(exp, { mode: 'interactive', descend: !journey.active, leaveLabel: journey.active ? 'Return to the journey' : 'Back to the atlas', covered: () => map.jumpTo(cam) }); }
    finally { settle(); map.jumpTo(cam); if (wasPlaying) journey.play(); }
  };
  $('brand').addEventListener('click', () => actions.showTrip());

  /* ── Reactions ───────────────────────────────────────────────────────── */
  store.on(['mode', 'dayIndex', 'layers'], syncMarkers);
  store.on(['placeId'], (s) => { const p = s.placeId ? model.places[s.placeId] : null; atlas.showPulse(p && p.coords && !s.journey ? p.coords : null); });
  store.on(['theme'], (s) => applyTheme(s.theme));
  store.on(['terrain'], (s) => atlas.setTerrain(s.terrain));
  store.on(['imagery'], (s) => atlas.setImagery(s.imagery));
  store.on(['buildings'], (s) => atlas.setBuildings(s.buildings));
  store.on(['panelOpen', 'placeId', 'journey'], syncPadding);

  atlas.addEventListener('place', (e) => { if (!store.get().journey) actions.openPlace(e.detail.id); });
  atlas.addEventListener('blank', () => { if (store.get().placeId && !store.get().journey) actions.closePlace(); });
  atlas.addEventListener('interact', () => { if (journey.active && journey.playing) journey.pause(); });
  atlas.addEventListener('fallback', (e) => {
    toast(e.detail.message, { duration: 9000 });
    if (e.detail.what === 'terrain' && store.get().terrain) store.set({ terrain: false });
    if (e.detail.what === 'imagery' && store.get().imagery) store.set({ imagery: false });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || store.get().journey) return;
    const s = store.get();
    if (s.dashboardOpen) store.set({ dashboardOpen: false });
    else if (s.layersOpen) store.set({ layersOpen: false });
    else if (s.placeId) actions.closePlace();
  });
  window.addEventListener('resize', syncPadding);
  // Crossing the phone / desktop breakpoint (rotating a tablet, resizing a window):
  // the itinerary is a side panel on desktop and a pull-up sheet on a phone.
  window.matchMedia('(max-width: 820px)').addEventListener('change', (e) => { store.set({ panelOpen: !e.matches }); syncPadding(); });

  /* ── First frame ─────────────────────────────────────────────────────── */
  atlas.setImagery(store.get().imagery);
  atlas.setBuildings(store.get().buildings);
  syncPadding();
  syncMarkers();
  document.body.classList.remove('is-loading');

  const today = todayInJapan();
  const todayIndex = model.dayIndexForDate(today);
  if (todayIndex >= 0) actions.selectDay(todayIndex);       // during the trip: open on today
  else atlas.flyTo(nationView(), 4200);                      // otherwise: settle over Japan

  if (!geo) toast('Place coordinates (data/places.geo.json) did not load, so markers are hidden.', { duration: 0 });
  else if (!routes) toast('Route geometry (data/routes.geojson) did not load; legs are drawn as straight lines.', { duration: 9000 });

  window.__atlas = { store, model, atlas, journey, actions, director };   // handy in the console
}

boot().catch((err) => { console.error(err); fail('Something went wrong while starting the atlas. Reload to try again.'); });
