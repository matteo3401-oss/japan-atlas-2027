import { openMedia } from './lock.js';

/* Loads the trip data as one "bundle":
     { itinerary, places, categories, geo, photos, routes, walks }

   · On your own computer the bundle is read straight from the editable files.
   · In a hosted copy those files are not published at all. The same bundle
     ships as a single encrypted file and is opened with a passphrase
     (see lock.js and tools/build-site.mjs). */

async function json(url, fallback) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch (err) {
    return fallback;
  }
}

export const isLockedBuild = () => document.querySelector('meta[name="atlas-data"]')?.content === 'locked';

export async function loadPlain() {
  const [itinerary, places, geo, photos, routes, walks] = await Promise.all([
    import('./data/itinerary.js'),
    import('./data/places.js'),
    json('data/places.geo.json', null),
    json('data/photos.json', {}),
    json('data/routes.geojson', null),
    json('data/walks.geojson', null),
  ]);
  // immersive sequences: their configuration, plus the baked geography each one is built from
  let list = [];
  try { list = (await import('./data/experiences.js')).EXPERIENCES; } catch (err) { /* none defined */ }
  const assets = {};
  await Promise.all(list.map(async (x) => { if (x.asset) assets[x.asset] = await json(`data/experiences/${x.asset}`, null); }));
  // narration: which line is spoken where, and the clips that have been recorded so far
  let lines = [];
  try { lines = (await import('./data/narration.js')).NARRATION; } catch (err) { /* none written */ }
  const narration = { lines, index: lines.length ? await json('data/narration/index.json', {}) : {} };
  return { itinerary: { ...itinerary }, places: places.PLACES, categories: places.CATEGORIES, geo, photos, routes, walks, experiences: { list, assets }, narration };
}

/**
 * How films, their photographs and the narration reach the page: `load(src)` resolves with a Blob.
 * On your own computer that is the file itself. In a hosted copy the file was
 * published encrypted under an opaque name, listed in the bundle, and is
 * decrypted here with the key the passphrase opened.
 */
export function mediaLoader(bundle) {
  if (!isLockedBuild()) return (src) => fetch(src).then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.blob(); });
  const index = (bundle && bundle.media) || {};
  return (src) => openMedia(index[src]);
}
