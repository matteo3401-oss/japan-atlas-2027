/* Map controls: layer filters, light, terrain, fullscreen, reset, zoom,
   and the four-step scale (nation / region / city / street). */

import { h, icon, mount } from '../lib/dom.js';
import { seal, toast } from './common.js';

const PLACE_LAYERS = ['stay', 'food', 'temple', 'shop', 'culture', 'view', 'transport', 'district'];

export function mountControls(el, scaleEl, layersEl, ctx) {
  const { store, model, atlas, actions } = ctx;
  const map = atlas.map;

  const btn = (name, tip, onclick, extra = {}) => h('button.iconbtn', { type: 'button', 'aria-label': tip, 'data-tip': tip, onclick, ...extra }, icon(name));

  const layersBtn = btn('layers', 'Layers and filters', () => store.set({ layersOpen: !store.get().layersOpen }));
  const themeBtn = btn('moon', 'Day / night', () => actions.setTheme(store.get().theme === 'day' ? 'night' : 'day'));
  const terrainBtn = btn('mountain', '3D terrain', () => store.set({ terrain: !store.get().terrain }));
  const imageryBtn = btn('satellite', 'Satellite imagery', () => store.set({ imagery: !store.get().imagery }));
  const fsBtn = btn('expand', 'Fullscreen', toggleFullscreen);
  const resetBtn = btn('reset', 'Reset camera', () => actions.resetCamera());
  const compassBtn = btn('compass', 'Face north', () => atlas.resetNorth(), { class: 'compass' });

  mount(el,
    h('div.ctlgroup', layersBtn, themeBtn, terrainBtn, imageryBtn),
    h('div.ctlgroup', document.fullscreenEnabled ? fsBtn : null, resetBtn),
    h('div.ctlgroup.ctl--zoom', btn('plus', 'Zoom in', () => atlas.zoomBy(1)), btn('minus', 'Zoom out', () => atlas.zoomBy(-1)), compassBtn));

  function toggleFullscreen() {
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    Promise.resolve(p).catch(() => toast('Fullscreen is not available in this browser.'));
  }
  document.addEventListener('fullscreenchange', () => {
    mount(fsBtn, icon(document.fullscreenElement ? 'shrink' : 'expand'));
    fsBtn.setAttribute('aria-pressed', String(!!document.fullscreenElement));
  });
  map.on('rotate', () => { compassBtn.firstChild.style.transform = `rotate(${-map.getBearing()}deg)`; });

  /* ── Scale: nation / region / city / street ─────────────────────────── */
  const SCALES = [
    { id: 'nation', jp: '国', en: 'Nation' },
    { id: 'region', jp: '域', en: 'Region' },
    { id: 'city', jp: '市', en: 'City' },
    { id: 'street', jp: '路', en: 'Street' },
  ];
  const scaleButtons = SCALES.map((sc) => h('button', { type: 'button', title: `${sc.en} view`, 'aria-label': `${sc.en} view`, onclick: () => actions.setScale(sc.id) }, h('b', sc.jp), h('span', sc.en)));
  mount(scaleEl, scaleButtons);
  const scaleOf = (z) => (z < 7.6 ? 'nation' : z < 11 ? 'region' : z < 15 ? 'city' : 'street');
  const syncScale = () => { const cur = scaleOf(map.getZoom()); SCALES.forEach((sc, i) => scaleButtons[i].setAttribute('aria-pressed', String(sc.id === cur))); };
  map.on('zoom', syncScale);
  syncScale();

  /* ── Layers popover ─────────────────────────────────────────────────── */
  const counts = {};
  for (const p of Object.values(model.places)) if (p.coords) counts[p.cat] = (counts[p.cat] || 0) + 1;
  const statusCount = (st) => Object.values(model.places).filter((p) => p.coords && p.status === st).length + model.legs.filter((l) => l.status === st).length;

  function layerRow(id, label, swatch, n, soloGroup) {
    const on = store.get().layers[id];
    return h(`div.layer${on ? '' : '.is-off'}`,
      swatch,
      h('span.layer__lbl', label),
      soloGroup ? h('button.layer__only', { type: 'button', onclick: () => store.soloLayer(id, soloGroup), title: `Show only ${label.toLowerCase()}` }, 'only') : h('span'),
      h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: () => store.toggleLayer(id) }),
      n != null ? null : null);
  }
  function mapRow(label, on, onToggle, key) {
    return h(`div.layer${on ? '' : '.is-off'}`, h('span.linekey', { style: { borderTop: '0', height: 'auto', width: '26px', display: 'grid', placeItems: 'center' } }, icon(key, 16)),
      h('span.layer__lbl', label), h('span'), h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: onToggle }));
  }

  function renderLayers() {
    const s = store.get();
    layersEl.hidden = !s.layersOpen || s.journey;
    layersBtn.setAttribute('aria-pressed', String(s.layersOpen));
    if (layersEl.hidden) return;
    const cats = model.categories;
    mount(layersEl,
      h('h3', h('span.kicker', 'Places'), h('button.layer__only', { type: 'button', style: { opacity: 1 }, onclick: () => store.set({ layers: { ...s.layers, ...Object.fromEntries(PLACE_LAYERS.map((k) => [k, true])), walking: true, confirmed: true, pending: true } }) }, 'show all')),
      PLACE_LAYERS.map((id) => layerRow(id, `${cats[id].label} (${counts[id] || 0})`, seal(id, cats[id].glyph, 'sm'), null, PLACE_LAYERS)),
      h('h3', h('span.kicker', 'Routes')),
      h('div.legend',
        h('span.linekey'), h('span', 'Train (real track geometry)'),
        h('span.linekey.linekey--bus'), h('span', 'Bus (indicative road route)'),
        h('span.linekey.linekey--flight'), h('span', 'Flight (great-circle arc)'),
        h('span.linekey.linekey--transfer'), h('span', 'Transfer, mode not in the plan')),
      layerRow('walking', 'Walking routes', h('span.linekey.linekey--walk'), null, null),
      h('div.legend', h('span.linekey.linekey--maybe'), h('span', 'Possible walk: the other option of an either / or meal, or a place not yet confirmed (selected day only)')),
      h('h3', h('span.kicker', 'Reservations')),
      layerRow('confirmed', `Confirmed reservations (${statusCount('confirmed')})`, h('span.chip.chip--confirmed', { style: { padding: '0 5px', height: '15px' } }), null, ['confirmed', 'pending']),
      layerRow('pending', `Pending reservations (${statusCount('pending')})`, h('span.chip.chip--pending', { style: { padding: '0 5px', height: '15px' } }), null, ['confirmed', 'pending']),
      h('p.fine', { style: { margin: '2px 0 6px' } }, 'Switching one of these off hides the places and legs with that status.'),
      h('h3', h('span.kicker', 'Map')),
      mapRow('3D terrain', s.terrain, () => store.set({ terrain: !s.terrain }), 'mountain'),
      mapRow('3D buildings', s.buildings, () => store.set({ buildings: !s.buildings }), 'building'),
      mapRow('Satellite imagery', s.imagery, () => store.set({ imagery: !s.imagery }), 'satellite'),
      mapRow('Night light', s.theme === 'night', () => actions.setTheme(s.theme === 'day' ? 'night' : 'day'), 'moon'),
      h('h3', { class: 'layers__scale' }, h('span.kicker', 'Perspective')),
      h('div.linkrow', { style: { marginTop: '4px', marginBottom: '8px' } }, SCALES.map((sc) => h('button.btn.btn--sm', { type: 'button', onclick: () => { actions.setScale(sc.id); store.set({ layersOpen: false }); } }, h('span.jp', sc.jp), sc.en))));
  }

  function syncButtons() {
    const s = store.get();
    mount(themeBtn, icon(s.theme === 'day' ? 'moon' : 'sun'));
    themeBtn.setAttribute('aria-pressed', String(s.theme === 'night'));
    terrainBtn.setAttribute('aria-pressed', String(s.terrain));
    imageryBtn.setAttribute('aria-pressed', String(s.imagery));
  }

  store.on(['layers', 'layersOpen', 'terrain', 'imagery', 'buildings', 'theme', 'journey'], () => { renderLayers(); syncButtons(); });
  document.addEventListener('pointerdown', (e) => {
    if (!store.get().layersOpen) return;
    if (layersEl.contains(e.target) || layersBtn.contains(e.target)) return;
    store.set({ layersOpen: false });
  });
  renderLayers();
  syncButtons();
}
