/* ════════════════════════════════════════════════════════════════════════
   Basemap style: a hand-built editorial style over open data.

   · Vector tiles   OpenFreeMap (OpenMapTiles schema, © OpenStreetMap)
   · Elevation      Mapzen Terrain Tiles on AWS Open Data (terrarium encoding)
   · Imagery        Sentinel-2 cloudless by EOX (optional layer)

   No API keys. One style, two palettes (day / night); switching themes only
   updates paint properties, so custom layers and camera stay untouched.
   ════════════════════════════════════════════════════════════════════════ */

export const SOURCES = {
  vector: 'https://tiles.openfreemap.org/planet',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  dem: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  imagery: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
};

export const ATTRIBUTION = {
  vector: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> Data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
  dem: 'Elevation: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen Terrain Tiles</a> (JAXA AW3D30, USGS SRTM, GMTED2010, ETOPO1)',
  imagery: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by <a href="https://eox.at" target="_blank" rel="noopener">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2020), CC BY-NC-SA 4.0',
};

/* Interface + map tokens shared with the CSS (see :root in app.css). */
export const PALETTES = {
  day: {
    paper: '#F6F1E7', ink: '#26231F', inkSoft: '#6A6359', vermilion: '#B8432C', slate: '#3F5A6B', rule: '#CFC6B4',
    land: '#EEE8DA', urban: '#E6DECC', wood: '#D7DCC2', grass: '#DEE2C8', park: '#D3DCBC', sand: '#EDE3CB', ice: '#F7F6F1',
    water: '#BCCFD3', waterLine: '#A9C0C5', waterText: '#5F7F88',
    hillShadow: '#5E5343', hillHighlight: '#FFFBF0', hillAccent: '#7E705B', hillStrength: 0.42,
    roadCase: '#CDBFA5', roadMinor: '#FBF8F1', roadMajor: '#FFFDF7', motorway: '#F4E3BF', motorwayCase: '#C7AE7C', path: '#B9AB92',
    rail: '#8F867A', railTie: '#EEE8DA', boundary: '#B5A88F', aeroway: '#DDD5C3',
    building: '#DFD5C1', buildingLow: '#E4DBC9', buildingHigh: '#F1EBDD', buildingOutline: '#CBBFA8', buildingOpacity: 0.92,
    label: '#3B3630', labelSoft: '#6E665A', halo: '#F6F1E7', glow: 'rgba(0,0,0,0)',
    sky: '#BFD3DD', horizon: '#EFE7D8', fog: '#EFE7D8', satBright: 1, satSat: -0.2, satContrast: -0.12, satMin: 0.16,
    lightIntensity: 0.38, lightColor: '#FFF6E6',
  },
  night: {
    paper: '#1D1B1E', ink: '#EFE8DA', inkSoft: '#A39A8B', vermilion: '#DB6247', slate: '#8FB2C6', rule: '#3A363B',
    land: '#1A191C', urban: '#201E22', wood: '#171C1A', grass: '#1A1F1C', park: '#182019', sand: '#22201D', ice: '#2A2B2E',
    water: '#0E1317', waterLine: '#141C22', waterText: '#6C8794',
    hillShadow: '#000000', hillHighlight: '#4A443C', hillAccent: '#0F0E10', hillStrength: 0.5,
    roadCase: '#121113', roadMinor: '#4A4038', roadMajor: '#B98A55', motorway: '#EBB56E', motorwayCase: '#3A2C1C', path: '#3C3630',
    rail: '#6A635A', railTie: '#1A191C', boundary: '#4A443C', aeroway: '#262328',
    building: '#4A434B', buildingLow: '#39343C', buildingHigh: '#B08A5E', buildingOutline: '#17161A', buildingOpacity: 0.96,
    label: '#E9E1D2', labelSoft: '#A99F8F', halo: '#151416', glow: '#F0B060',
    sky: '#07090F', horizon: '#241E2A', fog: '#161519', satBright: 0.42, satSat: -0.45, satContrast: 0.1, satMin: 0,
    lightIntensity: 0.42, lightColor: '#FFDDB0',
  },
};

const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
const NAME_JA = ['coalesce', ['get', 'name:ja'], ['get', 'name:nonlatin'], ''];
const lineGeom = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel'];
const tunnelFade = ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.4, 1];
const width = (...stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];

export function skyFor(theme) {
  const p = PALETTES[theme];
  return {
    'sky-color': p.sky,
    'sky-horizon-blend': 0.7,
    'horizon-color': p.horizon,
    'horizon-fog-blend': 0.8,
    'fog-color': p.fog,
    'fog-ground-blend': 0.72,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4.5, 0.85, 7, 0],
  };
}

export function lightFor(theme) {
  const p = PALETTES[theme];
  return { anchor: 'viewport', color: p.lightColor, intensity: p.lightIntensity, position: [1.4, 215, 38] };
}

/** Elevation tint: subtle, so the vector cartography stays the main voice. */
export function reliefRamp(theme) {
  return theme === 'night'
    ? ['interpolate', ['linear'], ['elevation'], 0, 'rgba(26,25,28,0)', 600, 'rgba(34,36,34,0.55)', 1600, 'rgba(48,44,40,0.7)', 2600, 'rgba(70,64,58,0.8)', 3700, 'rgba(120,112,104,0.9)']
    : ['interpolate', ['linear'], ['elevation'], 0, 'rgba(238,232,218,0)', 500, 'rgba(206,214,184,0.5)', 1400, 'rgba(214,203,172,0.62)', 2400, 'rgba(204,190,166,0.72)', 3100, 'rgba(226,218,204,0.85)', 3700, 'rgba(250,248,242,0.95)'];
}

export function buildStyle(theme = 'day') {
  const p = PALETTES[theme];
  const night = theme === 'night';

  const layers = [
    { id: 'background', type: 'background', paint: { 'background-color': p.land } },

    /* ── Land ── */
    { id: 'landuse-urban', type: 'fill', source: 'omt', 'source-layer': 'landuse', maxzoom: 14,
      filter: ['match', ['get', 'class'], ['residential', 'commercial', 'industrial', 'retail'], true, false],
      paint: { 'fill-color': p.urban, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.9, 12, 0.7, 14, 0] } },
    { id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['match', ['get', 'class'], ['grass', 'farmland'], true, false],
      paint: { 'fill-color': p.grass, 'fill-opacity': 0.75 } },
    { id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'],
      paint: { 'fill-color': p.wood, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.55, 9, 0.85, 14, 0.9] } },
    { id: 'landcover-sand', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'sand'], paint: { 'fill-color': p.sand } },
    { id: 'landcover-ice', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'ice'], paint: { 'fill-color': p.ice } },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park',
      filter: ['match', ['geometry-type'], ['MultiPolygon', 'Polygon'], true, false],
      paint: { 'fill-color': p.park, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.25, 11, 0.55] } },

    /* ── Relief ── */
    { id: 'hillshade', type: 'hillshade', source: 'dem-shade',
      paint: {
        'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 4, p.hillStrength * 0.75, 9, p.hillStrength, 15, p.hillStrength * 0.55],
        'hillshade-shadow-color': p.hillShadow, 'hillshade-highlight-color': p.hillHighlight, 'hillshade-accent-color': p.hillAccent,
        'hillshade-illumination-direction': 315,
      } },

    /* ── Water ── */
    { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 8, filter: notTunnel,
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': p.water, 'line-width': width(8, 0.4, 12, 1.2, 16, 4, 20, 14) } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', filter: notTunnel,
      paint: { 'fill-color': p.water } },
    { id: 'water-edge', type: 'line', source: 'omt', 'source-layer': 'water', minzoom: 7, filter: notTunnel,
      paint: { 'line-color': p.waterLine, 'line-width': 0.7, 'line-opacity': 0.9 } },

    /* ── Optional satellite imagery sits above the flat land/water fills ── */
    { id: 'imagery', type: 'raster', source: 'imagery', layout: { visibility: 'none' },
      paint: { 'raster-opacity': 1, 'raster-saturation': p.satSat, 'raster-contrast': p.satContrast, 'raster-brightness-max': p.satBright, 'raster-brightness-min': p.satMin, 'raster-fade-duration': 250 } },

    { id: 'aeroway-area', type: 'fill', source: 'omt', 'source-layer': 'aeroway', minzoom: 10,
      filter: ['match', ['geometry-type'], ['MultiPolygon', 'Polygon'], true, false],
      paint: { 'fill-color': p.aeroway, 'fill-opacity': 0.8 } },
    { id: 'aeroway-runway', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 10,
      filter: ['all', lineGeom, ['==', ['get', 'class'], 'runway']],
      paint: { 'line-color': p.aeroway, 'line-width': width(10, 1.5, 14, 14, 17, 80) } },

    /* ── Boundaries ── */
    { id: 'boundary-pref', type: 'line', source: 'omt', 'source-layer': 'boundary', minzoom: 5,
      filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': p.boundary, 'line-width': 0.6, 'line-dasharray': [3, 3], 'line-opacity': 0.7 } },
    { id: 'boundary-country', type: 'line', source: 'omt', 'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': p.boundary, 'line-width': 1 } },

    /* ── Roads (night: warm glow under the major streets) ── */
    { id: 'road-glow', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9,
      filter: ['all', lineGeom, notTunnel, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.glow, 'line-opacity': night ? 0.22 : 0, 'line-blur': width(9, 2, 14, 8, 18, 22), 'line-width': width(9, 2, 13, 8, 16, 26, 19, 70) } },

    { id: 'road-path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13.5,
      filter: ['all', lineGeom, ['match', ['get', 'class'], ['path', 'track'], true, false]],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': p.path, 'line-width': width(14, 0.6, 18, 2.2), 'line-dasharray': [2, 2], 'line-opacity': tunnelFade } },

    { id: 'road-minor-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12.5,
      filter: ['all', lineGeom, ['match', ['get', 'class'], ['minor', 'service'], true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadCase, 'line-width': width(12.5, 0.8, 14, 2.4, 16, 7.5, 19, 30), 'line-opacity': tunnelFade } },
    { id: 'road-secondary-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9,
      filter: ['all', lineGeom, ['match', ['get', 'class'], ['secondary', 'tertiary'], true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadCase, 'line-width': width(9, 0.5, 12, 2, 14, 4.4, 16, 11, 19, 40), 'line-opacity': tunnelFade } },
    { id: 'road-primary-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 7,
      filter: ['all', lineGeom, ['match', ['get', 'class'], ['primary', 'trunk'], true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadCase, 'line-width': width(7, 0.6, 12, 2.8, 14, 5.6, 16, 13, 19, 46), 'line-opacity': tunnelFade } },
    { id: 'road-motorway-case', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 5,
      filter: ['all', lineGeom, ['==', ['get', 'class'], 'motorway']],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': p.motorwayCase, 'line-width': width(5, 0.5, 10, 1.8, 13, 4.6, 16, 14, 19, 50), 'line-opacity': tunnelFade } },

    { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12.5,
      filter: ['all', lineGeom, ['match', ['get', 'class'], ['minor', 'service'], true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadMinor, 'line-width': width(12.5, 0.4, 14, 1.5, 16, 6, 19, 27), 'line-opacity': tunnelFade } },
    { id: 'road-secondary', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9,
      filter: ['all', lineGeom, ['match', ['get', 'class'], ['secondary', 'tertiary'], true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': night ? p.roadMinor : p.roadMajor, 'line-width': width(9, 0.3, 12, 1.1, 14, 3.2, 16, 9.4, 19, 37), 'line-opacity': tunnelFade } },
    { id: 'road-primary', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 7,
      filter: ['all', lineGeom, ['match', ['get', 'class'], ['primary', 'trunk'], true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadMajor, 'line-width': width(7, 0.3, 12, 1.7, 14, 4.2, 16, 11.4, 19, 43), 'line-opacity': tunnelFade } },
    { id: 'road-motorway', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 5,
      filter: ['all', lineGeom, ['==', ['get', 'class'], 'motorway']],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': p.motorway, 'line-width': width(5, 0.25, 10, 1, 13, 3.2, 16, 11.6, 19, 46), 'line-opacity': tunnelFade } },

    /* ── Rail ── */
    { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 7,
      filter: ['all', lineGeom, ['==', ['get', 'class'], 'rail']],
      paint: { 'line-color': p.rail, 'line-width': width(7, 0.4, 12, 0.9, 15, 1.8, 18, 3.5), 'line-opacity': ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.35, 0.9] } },
    { id: 'rail-ties', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13,
      filter: ['all', lineGeom, ['==', ['get', 'class'], 'rail'], notTunnel],
      paint: { 'line-color': p.railTie, 'line-width': width(13, 0.5, 15, 1, 18, 2), 'line-dasharray': [2.5, 2.5] } },
    { id: 'transit', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11,
      filter: ['all', lineGeom, ['==', ['get', 'class'], 'transit'], notTunnel],
      paint: { 'line-color': p.rail, 'line-width': width(11, 0.4, 15, 1.2, 18, 2.6), 'line-opacity': 0.8 } },

    /* ── Buildings ── */
    { id: 'building-flat', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13,
      paint: { 'fill-color': p.building, 'fill-outline-color': p.buildingOutline,
               'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 13.6, 0.8, 14.6, 0.8, 15.2, 0] } },
    { id: 'building-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14,
      filter: ['!', ['has', 'hide_3d']],
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, p.buildingLow, 30, p.building, 220, p.buildingHigh],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, ['coalesce', ['get', 'render_height'], 6]],
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, ['coalesce', ['get', 'render_min_height'], 0]],
        'fill-extrusion-opacity': p.buildingOpacity,
        'fill-extrusion-vertical-gradient': true,
      } },

    /* ── Labels ── */
    { id: 'label-water', type: 'symbol', source: 'omt', 'source-layer': 'water_name', minzoom: 3,
      filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10.5, 10, 13],
                'text-letter-spacing': 0.14, 'text-max-width': 6 },
      paint: { 'text-color': p.waterText, 'text-halo-color': p.halo, 'text-halo-width': 1, 'text-halo-blur': 0.5 } },
    { id: 'label-water-line', type: 'symbol', source: 'omt', 'source-layer': 'water_name', minzoom: 3,
      filter: lineGeom,
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10.5, 10, 13],
                'text-letter-spacing': 0.2, 'symbol-placement': 'line', 'symbol-spacing': 420 },
      paint: { 'text-color': p.waterText, 'text-halo-color': p.halo, 'text-halo-width': 1, 'text-halo-blur': 0.5 } },
    { id: 'label-peak', type: 'symbol', source: 'omt', 'source-layer': 'mountain_peak', minzoom: 8,
      filter: ['<=', ['get', 'rank'], ['step', ['zoom'], 1, 10, 2, 12, 5]],
      layout: { 'text-field': ['format', '▲ ', { 'font-scale': 0.7 }, NAME, {}, '\n', {}, ['concat', ['to-string', ['get', 'ele']], ' m'], { 'font-scale': 0.82 }],
                'text-font': ['Noto Sans Italic'], 'text-size': 11.5, 'text-max-width': 8, 'text-padding': 6 },
      paint: { 'text-color': p.labelSoft, 'text-halo-color': p.halo, 'text-halo-width': 1.2 } },
    { id: 'label-road', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 15,
      filter: lineGeom,
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'symbol-placement': 'line', 'text-letter-spacing': 0.05, 'symbol-spacing': 320 },
      paint: { 'text-color': p.labelSoft, 'text-halo-color': p.halo, 'text-halo-width': 1.2 } },
    { id: 'label-station', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 13.5,
      filter: ['all', ['==', ['get', 'class'], 'railway'], ['<=', ['get', 'rank'], ['step', ['zoom'], 3, 15, 12, 16, 40]]],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'text-max-width': 8, 'text-padding': 8 },
      paint: { 'text-color': p.labelSoft, 'text-halo-color': p.halo, 'text-halo-width': 1.2 } },
    { id: 'label-suburb', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 11.5,
      filter: ['match', ['get', 'class'], ['suburb', 'quarter', 'neighbourhood'], true, false],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.16, 'text-max-width': 7, 'text-padding': 10 },
      paint: { 'text-color': p.labelSoft, 'text-halo-color': p.halo, 'text-halo-width': 1.2, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0, 12.2, 0.95, 16, 0.95, 17, 0] } },
    { id: 'label-village', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 9.5,
      filter: ['==', ['get', 'class'], 'village'],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 7 },
      paint: { 'text-color': p.labelSoft, 'text-halo-color': p.halo, 'text-halo-width': 1.2 } },
    { id: 'label-town', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 7,
      filter: ['==', ['get', 'class'], 'town'],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10.5, 12, 13], 'text-max-width': 7 },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.3 } },
    { id: 'label-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 3,
      filter: ['all', ['==', ['get', 'class'], 'city'], ['<=', ['coalesce', ['get', 'rank'], 9], ['step', ['zoom'], 3, 5, 5, 6.5, 8, 8, 12]]],
      layout: {
        'text-field': ['format', NAME, {}, '\n', {}, NAME_JA, { 'font-scale': 0.72 }],
        'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 7, 12.5, 11, 16],
        'text-transform': 'uppercase', 'text-letter-spacing': 0.2, 'text-max-width': 9, 'text-line-height': 1.35, 'text-padding': 6,
      },
      paint: { 'text-color': p.label, 'text-halo-color': p.halo, 'text-halo-width': 1.5,
               'text-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 1, 13.5, 0] } },
    { id: 'label-country', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 6,
      filter: ['==', ['get', 'class'], 'country'],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9.5, 5, 14],
                'text-transform': 'uppercase', 'text-letter-spacing': 0.3, 'text-max-width': 7 },
      paint: { 'text-color': p.labelSoft, 'text-halo-color': p.halo, 'text-halo-width': 1.2 } },
  ];

  return {
    version: 8,
    name: `Japan Atlas — ${theme}`,
    glyphs: SOURCES.glyphs,
    // A globe when zoomed far out (the flights), flat Mercator from regional zooms in,
    // where horizon fog and terrain are fully supported.
    projection: { type: ['interpolate', ['linear'], ['zoom'], 4.6, 'vertical-perspective', 6, 'mercator'] },
    sky: skyFor(theme),
    light: lightFor(theme),
    sources: {
      omt: { type: 'vector', url: SOURCES.vector, attribution: ATTRIBUTION.vector },
      // Two DEM sources on purpose: MapLibre renders terrain and hillshade more
      // cleanly when they do not share one tile cache.
      'dem-terrain': { type: 'raster-dem', tiles: [SOURCES.dem], tileSize: 256, maxzoom: 13, encoding: 'terrarium', attribution: ATTRIBUTION.dem },
      'dem-shade': { type: 'raster-dem', tiles: [SOURCES.dem], tileSize: 256, maxzoom: 12, encoding: 'terrarium' },
      imagery: { type: 'raster', tiles: [SOURCES.imagery], tileSize: 256, maxzoom: 14, attribution: ATTRIBUTION.imagery },
    },
    layers,
  };
}
