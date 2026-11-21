/* ════════════════════════════════════════════════════════════════════════
   Atlas: the 3D map controller.

   Owns the MapLibre map, terrain, 3D buildings, route lines, seal markers,
   clustering and every camera move. The rest of the app talks to it through
   a small imperative API and listens for 'place', 'blank' and 'interact'.
   ════════════════════════════════════════════════════════════════════════ */

import { buildStyle, PALETTES, skyFor, lightFor, reliefRamp } from './style.js';
import { drawSeal } from './seals.js';
import { boundsOf } from '../lib/geo.js';
import { h, icon, prefersReducedMotion } from '../lib/dom.js';

const TERRAIN = { source: 'dem-terrain', exaggeration: 1.25 };
const FIRST_LABEL = 'label-water';
const EMPTY = { type: 'FeatureCollection', features: [] };

export class Atlas extends EventTarget {
  constructor(container, { theme = 'day', terrain = true, view }) {
    super();
    this.theme = theme;
    this.terrainOn = terrain;
    this.buildingsOn = true;
    this.pad = { top: 0, right: 0, bottom: 0, left: 0 };
    this.selectedDate = '';
    this.routeVisibility = { transport: true, walking: true, confirmed: true, pending: true };
    this._sealIds = new Set();
    this._errors = { 'dem-terrain': 0, omt: 0, imagery: 0 };

    const ml = window.maplibregl;
    this.map = new ml.Map({
      container,
      style: buildStyle(theme),
      center: view.center, zoom: view.zoom, pitch: view.pitch, bearing: view.bearing,
      minZoom: 1.4, maxZoom: 19, maxPitch: 80,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
      fadeDuration: 220,
      // CJK labels are drawn with the device's own fonts instead of downloading glyph ranges.
      localIdeographFontFamily: '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", "Noto Sans CJK JP", sans-serif',
    });
    this.map.addControl(new ml.AttributionControl({ compact: true }), 'bottom-right');
    this.map.addControl(new ml.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
    this.map.touchZoomRotate.enable();
    this.map.touchPitch.enable();
    this.map.keyboard.enable();

    // MapLibre ignores the first size notification it receives. A page opened in a
    // background tab is measured at 0×0 and only laid out once it is shown, so that
    // "first" notification is the real one and the canvas would stay at its 400×300
    // fallback. Keep the canvas matched to the container ourselves.
    const fitCanvas = () => {
      const c = this.map.getCanvas();
      if (c.clientWidth !== container.clientWidth || c.clientHeight !== container.clientHeight) this.map.resize();
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitCanvas).observe(container);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) fitCanvas(); });
    window.addEventListener('pageshow', fitCanvas);

    this.ready = new Promise((resolve) => {
      // 'style.load' (not 'load'): the interface can appear as soon as the style is ready,
      // while tiles keep streaming in behind it.
      this.map.once('style.load', () => { this._onLoad(); resolve(this); });
    });

    this.map.on('styleimagemissing', (e) => this._makeSeal(e.id));
    this.map.on('error', (e) => this._onError(e));

    // Anything the traveller does by hand should pause an automated journey.
    for (const ev of ['dragstart', 'wheel', 'touchstart', 'rotatestart', 'pitchstart']) {
      this.map.on(ev, (e) => { if (e.originalEvent) this.dispatchEvent(new CustomEvent('interact')); });
    }
  }

  /* ── Setup ─────────────────────────────────────────────────────────── */

  _onLoad() {
    const map = this.map;
    const p = PALETTES[this.theme];

    if (this.terrainOn) this._applyTerrain(true);

    // Elevation tint (newer MapLibre layer type; skipped quietly if unsupported).
    try {
      map.addLayer({ id: 'relief-tint', type: 'color-relief', source: 'dem-shade',
        paint: { 'color-relief-color': reliefRamp(this.theme), 'color-relief-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 11, 0.55, 14, 0.25] } }, 'hillshade');
    } catch (err) { /* older engine: hillshade alone */ }

    /* Routes */
    map.addSource('routes', { type: 'geojson', data: EMPTY });
    map.addSource('journey', { type: 'geojson', data: EMPTY, lineMetrics: true });
    const round = { 'line-cap': 'round', 'line-join': 'round' };
    const add = (layer) => map.addLayer(layer, FIRST_LABEL);
    add({ id: 'rt-transfer', type: 'line', source: 'routes', filter: ['==', ['get', 'mode'], 'transfer'], layout: round,
      paint: { 'line-color': p.inkSoft, 'line-width': 1.3, 'line-dasharray': [0.4, 2.6] } });
    add({ id: 'rt-flight', type: 'line', source: 'routes', filter: ['==', ['get', 'mode'], 'flight'], layout: round,
      paint: { 'line-color': p.ink, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.1, 6, 1.8], 'line-dasharray': [3, 3] } });
    add({ id: 'rt-bus-case', type: 'line', source: 'routes', filter: ['==', ['get', 'mode'], 'bus'], layout: round,
      paint: { 'line-color': p.paper, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2.6, 12, 6] } });
    add({ id: 'rt-bus', type: 'line', source: 'routes', filter: ['==', ['get', 'mode'], 'bus'], layout: round,
      paint: { 'line-color': p.slate, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 12, 3.2] } });
    add({ id: 'rt-train-case', type: 'line', source: 'routes', filter: ['==', ['get', 'mode'], 'train'], layout: round,
      paint: { 'line-color': p.paper, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 12, 6.6] } });
    add({ id: 'rt-train', type: 'line', source: 'routes', filter: ['==', ['get', 'mode'], 'train'], layout: round,
      paint: { 'line-color': p.vermilion, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.8, 12, 3.6] } });
    // one faint dotted path per candidate branch of a stop whose branch is not confirmed
    add({ id: 'rt-maybe', type: 'line', source: 'routes', filter: ['==', ['get', 'mode'], 'maybe'], layout: round, minzoom: 11,
      paint: { 'line-color': p.vermilion, 'line-opacity': 0.5, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.3, 15, 2.6, 18, 3.8], 'line-dasharray': [0.05, 3.4] } });
    add({ id: 'rt-walk-case', type: 'line', source: 'routes', filter: ['==', ['get', 'mode'], 'walk'], layout: round, minzoom: 11,
      paint: { 'line-color': p.paper, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 6.5, 18, 9], 'line-opacity': 0.75 } });
    add({ id: 'rt-walk', type: 'line', source: 'routes', filter: ['==', ['get', 'mode'], 'walk'], layout: round, minzoom: 10,
      paint: { 'line-color': p.vermilion, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 15, 3.9, 18, 5.6], 'line-dasharray': [0.05, 2.1] } });
    add({ id: 'journey-line', type: 'line', source: 'journey', layout: round,
      paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 2.6, 12, 5.5], 'line-gradient': ['step', ['line-progress'], p.ink, 0, 'rgba(0,0,0,0)'] } });

    /* Markers */
    map.addSource('places', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 40, clusterMaxZoom: 12, clusterMinPoints: 2 });
    map.addSource('daystops', { type: 'geojson', data: EMPTY });
    const sealImage = ['concat', 'seal:', ['get', 'cat'], ':', ['get', 'glyph'], ':', ['get', 'status']];

    map.addLayer({ id: 'cluster-disc', type: 'circle', source: 'places', filter: ['has', 'point_count'],
      paint: { 'circle-radius': ['step', ['get', 'point_count'], 14, 6, 17, 14, 20], 'circle-color': p.paper, 'circle-stroke-color': p.ink, 'circle-stroke-width': 1.1, 'circle-opacity': 0.96 } });
    map.addLayer({ id: 'cluster-ring', type: 'circle', source: 'places', filter: ['has', 'point_count'],
      paint: { 'circle-radius': ['step', ['get', 'point_count'], 18, 6, 21, 14, 24], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': p.ink, 'circle-stroke-width': 0.5, 'circle-stroke-opacity': 0.45 } });
    map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'places', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true },
      paint: { 'text-color': p.ink } });

    map.addLayer({ id: 'place-sym', type: 'symbol', source: 'places', filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': sealImage, 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 0.74, 15, 0.92], 'icon-allow-overlap': true,
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-max-width': 9,
        'text-variable-anchor': ['left', 'right', 'bottom', 'top'], 'text-radial-offset': 1.25, 'text-justify': 'auto', 'text-optional': true,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.4 } });

    map.addLayer({ id: 'day-halo', type: 'circle', source: 'daystops',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 13, 15, 21], 'circle-color': p.vermilion, 'circle-opacity': 0.13, 'circle-stroke-color': p.vermilion, 'circle-stroke-width': 0.8, 'circle-stroke-opacity': 0.55 } });
    map.addLayer({ id: 'day-sym', type: 'symbol', source: 'daystops',
      layout: {
        'icon-image': sealImage, 'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 14, 1.05], 'icon-allow-overlap': true,
        'text-field': ['format', ['get', 'n'], { 'text-color': p.vermilion }, '  ', {}, ['get', 'label'], {}],
        'text-font': ['Noto Sans Bold'], 'text-size': 12.5, 'text-max-width': 10,
        'text-variable-anchor': ['left', 'right', 'bottom', 'top'], 'text-radial-offset': 1.5, 'text-justify': 'auto', 'text-optional': true,
        'symbol-sort-key': ['get', 'order'],
      },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.6 } });

    /* Interaction */
    const onPlace = (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      e.preventDefault();
      this.dispatchEvent(new CustomEvent('place', { detail: { id: f.properties.id } }));
    };
    for (const layer of ['place-sym', 'day-sym']) {
      map.on('click', layer, onPlace);
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }
    map.on('click', 'cluster-disc', async (e) => {
      const f = e.features[0];
      e.preventDefault();
      try {
        const zoom = await map.getSource('places').getClusterExpansionZoom(f.properties.cluster_id);
        map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom + 0.4, 17), duration: 700 });
      } catch (err) { /* cluster disappeared between frames */ }
    });
    map.on('mouseenter', 'cluster-disc', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'cluster-disc', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', (e) => { if (!e.defaultPrevented) this.dispatchEvent(new CustomEvent('blank')); });

    /* Selection pulse + journey vehicle (HTML, so they can animate in CSS) */
    this.pulse = new window.maplibregl.Marker({ element: h('div.map-pulse', h('span')), anchor: 'center' });
    this.vehicleEl = h('div.map-vehicle');
    this.vehicle = new window.maplibregl.Marker({ element: this.vehicleEl, anchor: 'center' });

    this._refreshRouteStyle();
  }

  _makeSeal(id) {
    if (!id.startsWith('seal:') || this.map.hasImage(id)) return;
    const [, cat, glyph, status] = id.split(':');
    const img = drawSeal({ cat, glyph, status, theme: this.theme });
    this.map.addImage(id, img, { pixelRatio: 2 });
    this._sealIds.add(id);
  }

  _onError(e) {
    const id = e && e.sourceId;
    if (!id || !(id in this._errors)) return;
    this._errors[id] += 1;
    if (id === 'dem-terrain' && this._errors[id] === 6 && this.terrainOn) {
      this._applyTerrain(false);
      this.dispatchEvent(new CustomEvent('fallback', { detail: { what: 'terrain', message: 'Elevation data is not loading, so the map is shown flat for now.' } }));
    }
    if (id === 'omt' && this._errors[id] === 8) {
      this.dispatchEvent(new CustomEvent('fallback', { detail: { what: 'basemap', message: 'Basemap tiles are not loading. Your itinerary, markers and routes still work.' } }));
    }
    if (id === 'imagery' && this._errors[id] === 6) {
      this.dispatchEvent(new CustomEvent('fallback', { detail: { what: 'imagery', message: 'Satellite imagery is not loading right now.' } }));
    }
  }

  /* ── Appearance ────────────────────────────────────────────────────── */

  setTheme(theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    const map = this.map;
    const p = PALETTES[theme];
    const style = buildStyle(theme);
    for (const layer of style.layers) {
      if (!map.getLayer(layer.id)) continue;
      for (const [k, v] of Object.entries(layer.paint || {})) map.setPaintProperty(layer.id, k, v);
    }
    map.setSky(skyFor(theme));
    map.setLight(lightFor(theme));
    if (map.getLayer('relief-tint')) map.setPaintProperty('relief-tint', 'color-relief-color', reliefRamp(theme));

    const set = (id, prop, v) => map.getLayer(id) && map.setPaintProperty(id, prop, v);
    set('rt-transfer', 'line-color', p.inkSoft);
    set('rt-flight', 'line-color', p.ink);
    set('rt-bus-case', 'line-color', p.paper);
    set('rt-bus', 'line-color', p.slate);
    set('rt-train-case', 'line-color', p.paper);
    set('rt-train', 'line-color', p.vermilion);
    set('rt-walk', 'line-color', p.vermilion);
    set('rt-walk-case', 'line-color', p.paper);
    set('rt-maybe', 'line-color', p.vermilion);
    set('cluster-disc', 'circle-color', p.paper);
    set('cluster-disc', 'circle-stroke-color', p.ink);
    set('cluster-ring', 'circle-stroke-color', p.ink);
    set('cluster-count', 'text-color', p.ink);
    for (const id of ['place-sym', 'day-sym']) { set(id, 'text-color', p.label); set(id, 'text-halo-color', p.halo); }
    set('day-halo', 'circle-color', p.vermilion);
    set('day-halo', 'circle-stroke-color', p.vermilion);
    if (map.getLayer('day-sym')) {
      map.setLayoutProperty('day-sym', 'text-field', ['format', ['get', 'n'], { 'text-color': p.vermilion }, '  ', {}, ['get', 'label'], {}]);
    }
    for (const id of this._sealIds) {
      const [, cat, glyph, status] = id.split(':');
      if (map.hasImage(id)) map.updateImage(id, drawSeal({ cat, glyph, status, theme }));
    }
    this._journeyPaint();
  }

  _applyTerrain(on) {
    this.terrainOn = on;
    try { this.map.setTerrain(on ? TERRAIN : null); } catch (err) { this.terrainOn = false; }
  }

  setTerrain(on) {
    this._errors['dem-terrain'] = 0;
    this._applyTerrain(on);
  }

  setImagery(on) {
    this._errors.imagery = 0;
    if (this.map.getLayer('imagery')) this.map.setLayoutProperty('imagery', 'visibility', on ? 'visible' : 'none');
  }

  setBuildings(on) {
    this.buildingsOn = on;
    if (this.map.getLayer('building-3d')) this.map.setLayoutProperty('building-3d', 'visibility', on ? 'visible' : 'none');
    if (this.map.getLayer('building-flat')) {
      this.map.setPaintProperty('building-flat', 'fill-opacity', on
        ? ['interpolate', ['linear'], ['zoom'], 13, 0, 13.6, 0.8, 14.6, 0.8, 15.2, 0]
        : ['interpolate', ['linear'], ['zoom'], 13, 0, 13.6, 0.85]);
    }
  }

  /* ── Data ──────────────────────────────────────────────────────────── */

  setPlaces(features) {
    this.map.getSource('places')?.setData({ type: 'FeatureCollection', features });
  }

  setDayStops(features) {
    this.map.getSource('daystops')?.setData({ type: 'FeatureCollection', features });
  }

  setRoutes(features) {
    this.map.getSource('routes')?.setData({ type: 'FeatureCollection', features });
  }

  /** Which day is emphasised ('' for none) and which route families are on. */
  setRouteState({ date, visibility, dimOthers }) {
    if (date !== undefined) this.selectedDate = date || '';
    if (visibility) this.routeVisibility = { ...this.routeVisibility, ...visibility };
    if (dimOthers !== undefined) this.dimOthers = dimOthers;
    this._refreshRouteStyle();
  }

  _refreshRouteStyle() {
    const map = this.map;
    if (!map.getLayer('rt-train')) return;
    const v = this.routeVisibility;
    const sel = this.selectedDate;
    const faint = sel ? 0.3 : 0.92;
    const emphasis = ['case', ['==', ['get', 'date'], sel], 1, faint];
    const statusOk = ['all',
      ['any', v.confirmed, ['!=', ['get', 'status'], 'confirmed']],
      ['any', v.pending, ['!=', ['get', 'status'], 'pending']]];
    const modeFilter = (mode) => ['all', ['==', ['get', 'mode'], mode], statusOk];

    const vis = (id, on) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    for (const id of ['rt-flight', 'rt-bus', 'rt-bus-case', 'rt-train', 'rt-train-case']) vis(id, v.transport);
    vis('rt-transfer', v.transport);
    vis('rt-walk', v.walking);
    vis('rt-walk-case', v.walking);
    vis('rt-maybe', v.walking);

    map.setFilter('rt-flight', modeFilter('flight'));
    map.setFilter('rt-bus', modeFilter('bus'));
    map.setFilter('rt-bus-case', modeFilter('bus'));
    map.setFilter('rt-train', modeFilter('train'));
    map.setFilter('rt-train-case', modeFilter('train'));
    // Possible walks to unconfirmed branches only appear for the selected day: they are too many to show all at once.
    map.setFilter('rt-maybe', ['all', ['==', ['get', 'mode'], 'maybe'], ['==', ['get', 'date'], sel]]);
    // Transfers (mode unspecified in the plan) only appear for the selected day.
    map.setFilter('rt-transfer', ['all', ['==', ['get', 'mode'], 'transfer'], ['==', ['get', 'date'], sel]]);

    map.setPaintProperty('rt-flight', 'line-opacity', ['case', ['==', ['get', 'date'], sel], 0.9, sel ? 0.25 : 0.6]);
    for (const id of ['rt-bus', 'rt-train']) map.setPaintProperty(id, 'line-opacity', emphasis);
    for (const id of ['rt-bus-case', 'rt-train-case']) map.setPaintProperty(id, 'line-opacity', ['case', ['==', ['get', 'date'], sel], 0.95, sel ? 0.2 : 0.8]);
    map.setPaintProperty('rt-walk', 'line-opacity', ['case', ['==', ['get', 'date'], sel], 1, sel ? 0.22 : 0.7]);
    map.setPaintProperty('rt-walk-case', 'line-opacity', ['case', ['==', ['get', 'date'], sel], 0.8, sel ? 0.1 : 0.45]);

    const dim = sel && this.dimOthers !== false;
    map.setPaintProperty('place-sym', 'icon-opacity', dim ? 0.55 : 1);
    map.setPaintProperty('place-sym', 'text-opacity', dim ? 0.6 : 1);
  }

  /* ── Selection & journey overlays ──────────────────────────────────── */

  showPulse(lngLat) {
    if (!this.pulse) return;
    if (!lngLat) { this.pulse.remove(); return; }
    this.pulse.setLngLat(lngLat).addTo(this.map);
  }

  _journeyPaint(progress = this._journeyProgress || 0) {
    this._journeyProgress = progress;
    if (!this.map.getLayer('journey-line')) return;
    const p = PALETTES[this.theme];
    const t = Math.max(0.0001, Math.min(0.9999, progress));
    this.map.setPaintProperty('journey-line', 'line-gradient', ['step', ['line-progress'], p.ink, t, 'rgba(0,0,0,0)']);
  }

  setJourneyLine(coords, mode) {
    const src = this.map.getSource('journey');
    if (!src) return;
    if (!coords) {
      src.setData(EMPTY);
      this.vehicle.remove();
      return;
    }
    src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    this._journeyPaint(0);
    this.vehicleEl.replaceChildren(icon({ train: 'train', bus: 'bus', flight: 'plane', walk: 'walk' }[mode] || 'route', 16));
    this.vehicleEl.dataset.mode = mode;
    this.vehicle.setLngLat(coords[0]).addTo(this.map);
  }

  setJourneyProgress(progress, lngLat) {
    this._journeyPaint(progress);
    if (lngLat) this.vehicle.setLngLat(lngLat);
  }

  /* ── Camera ────────────────────────────────────────────────────────── */

  setPadding(pad) { this.pad = { ...this.pad, ...pad }; }

  /* Panels float over the map, so "centre" means the centre of the area that
     is still visible. We shift with a per-move pixel offset rather than
     MapLibre's persistent padding, which would compound across moves. */
  _offset() { return [(this.pad.left - this.pad.right) / 2, (this.pad.top - this.pad.bottom) / 2]; }

  _move(opts, duration) {
    const ms = prefersReducedMotion() ? 0 : duration;
    const o = { offset: this._offset(), essential: true, ...opts };
    if (ms === 0) this.map.easeTo({ ...o, duration: 0 });
    else this.map.flyTo({ curve: 1.35, ...o, duration: ms });
  }

  flyTo(view, duration = 2600) { this._move(view, duration); }

  flyToPlace(coords, { zoom = 15.6, pitch = 60, bearing, duration = 2200 } = {}) {
    this._move({ center: coords, zoom, pitch, bearing: bearing ?? this.map.getBearing() }, duration);
    // once everything has loaded, make sure the place really is where it should be
    const token = (this._settle = Symbol('settle'));
    this.map.once('idle', () => {
      if (this._settle !== token || this.map.isMoving()) return;
      if (this.recenterIfOff(coords)) setTimeout(() => { if (this._settle === token) this.recenterIfOff(coords, this._offset(), { jump: true }); }, 1300);
    });
  }

  /** Frame a set of points, keeping them clear of the floating panels. */
  fit(points, { pitch = 52, bearing = 0, maxZoom = 15.4, duration = 2400, margin = 70 } = {}) {
    if (!points.length) return;
    if (points.length === 1) { this._move({ center: points[0], zoom: Math.min(15, maxZoom), pitch, bearing }, duration); return; }
    const m = Math.min(margin, this.map.getContainer().clientWidth * 0.07);   // slimmer margins on a phone
    const pad = { top: this.pad.top + m, right: this.pad.right + m, bottom: this.pad.bottom + m, left: this.pad.left + m };
    const cam = this.map.cameraForBounds(boundsOf(points), { padding: pad, bearing, maxZoom });
    if (!cam) return;
    // cameraForBounds assumes a top-down view; ease the zoom back a little when tilted.
    const zoom = Math.min(maxZoom, cam.zoom - pitch / 150);
    this._move({ center: cam.center, zoom, pitch, bearing, offset: [0, 0] }, duration);
  }

  /* On steep, high ground a camera move can land with the target well off its mark: the
     move is planned before the elevation tiles for the destination have arrived, so the
     hillside is not yet "there". This measures where the point really ended up and, if it
     is off, eases it back. Returns true when a correction was made. */
  recenterIfOff(coords, offset = this._offset(), { jump = false, tolerance = 70 } = {}) {
    const map = this.map;
    const c = map.getContainer();
    const pt = map.project(coords);
    const pad = map.getPadding();   // non-zero only during journey playback
    const cx = (pad.left + c.clientWidth - pad.right) / 2, cy = (pad.top + c.clientHeight - pad.bottom) / 2;
    if (Math.hypot(pt.x - (cx + offset[0]), pt.y - (cy + offset[1])) <= tolerance) return false;
    if (jump || prefersReducedMotion()) {
      // last resort: place it exactly (a jump reads the ground height directly), then apply the offset
      map.stop();
      map.jumpTo({ center: coords });
      if (offset[0] || offset[1]) map.jumpTo({ center: map.unproject([cx - offset[0], cy - offset[1]]) });
    } else {
      map.easeTo({ center: coords, offset, duration: 650, essential: true });
    }
    return true;
  }

  /** Slide the map just enough to bring a point out from under the floating panels. */
  reveal(coords) {
    const pt = this.map.project(coords);
    const c = this.map.getContainer();
    const inView = pt.x > this.pad.left + 30 && pt.x < c.clientWidth - this.pad.right - 30 && pt.y > this.pad.top + 30 && pt.y < c.clientHeight - this.pad.bottom - 30;
    if (!inView) this.map.easeTo({ center: coords, offset: this._offset(), duration: prefersReducedMotion() ? 0 : 800 });
  }

  /** Per-frame camera for journey playback (no animation, no panel offset). */
  follow(center, { zoom, pitch, bearing }) {
    this.map.jumpTo({ center, zoom, pitch, bearing });
  }

  zoomBy(delta) { this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: 350 }); }
  resetNorth() { this.map.easeTo({ bearing: 0, duration: 600 }); }
  resize() { this.map.resize(); }
}
