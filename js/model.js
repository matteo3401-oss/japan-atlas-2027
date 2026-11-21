/* ════════════════════════════════════════════════════════════════════════
   Model: turns the hand-edited itinerary + the generated geodata into the
   structures the interface needs. Pure data in, pure data out (no DOM), so
   the same code runs in the browser and in the Node tools under /tools.
   ════════════════════════════════════════════════════════════════════════ */

import { ACCURACY } from './experience/labels.js';
import { haversineKm, greatCircle, measureLine } from './lib/geo.js';
import { dateParts, fmtTime, minutesOf } from './lib/time.js';

/** Consecutive stops closer than this are offered a walking route. */
export const WALK_MAX_KM = 2.4;
const WALK_MIN_KM = 0.06;

export const walkKey = (a, b) => `${a}>${b}`;

/**
 * @param bundle  { itinerary, places, categories, geo, photos, routes, walks }
 *   itinerary   the exports of js/data/itinerary.js
 *   places      PLACES from js/data/places.js;  categories  CATEGORIES from the same file
 *   The same bundle is what a hosted copy decrypts, so nothing below reads a file itself.
 */
export function buildModel({ itinerary, places: PLACES, categories: CATEGORIES, geo, photos, routes = null, walks = null, experiences: XP = null, narration: NAR = null }) {
  const { TRIP, DESTINATIONS, STAYS, DAYS, CHECKLIST, TICKET_LINKS, PLAN_NOTES, FLAGS, LORE, NATION_VIEW } = itinerary;
  geo = geo || {};
  photos = photos || {};
  /* ── Places ─────────────────────────────────────────────────────────── */
  const places = {};
  for (const [id, p] of Object.entries(PLACES)) {
    const g = geo[id] || null;
    const hasCoords = g && typeof g.lat === 'number' && typeof g.lon === 'number';
    // Branch not named in the plan: no single position, only candidates.
    const candidates = hasCoords ? [] : ((g && g.candidates) || []).map((c) => ({ ...c, coords: [c.lon, c.lat] }));
    const drawn = candidates.filter((c) => !c.listOnly);
    const focus = hasCoords ? [g.lon, g.lat]
      : drawn.length ? [drawn.reduce((a, c) => a + c.lon, 0) / drawn.length, drawn.reduce((a, c) => a + c.lat, 0) / drawn.length] : null;
    places[id] = {
      id, ...p,
      glyph: p.glyph || CATEGORIES[p.cat].glyph,
      coords: hasCoords ? [g.lon, g.lat] : null,
      candidates,
      focus,                                    // where the camera looks (never used to draw a route)
      spreadKm: drawn.length > 1 ? Math.max(...drawn.map((c) => haversineKm(focus, c.coords))) * 2 : 0,
      precision: hasCoords ? (g.precision || 'exact') : candidates.length ? 'candidates' : 'unplaced',
      geo: g,
      photo: photos[p.photo || id] || null,
      visits: [], lore: [], status: 'none',
    };
  }
  for (const entry of LORE) {
    for (const pid of entry.places) if (places[pid]) places[pid].lore.push(entry);
  }

  /* ── Route geometry lookups ─────────────────────────────────────────── */
  const routeById = {};
  for (const f of (routes && routes.features) || []) routeById[f.properties.id] = f;
  const walkByKey = {};
  for (const f of (walks && walks.features) || []) walkByKey[f.properties.key] = f;

  const stayByPlace = {};
  for (const s of STAYS) stayByPlace[s.place] = s;
  const destinations = DESTINATIONS.map((dst) => ({ ...dst, dayIndexes: [], stayRef: null }));
  const destById = {};
  for (const d of destinations) destById[d.id] = d;
  const flagById = {};
  for (const f of FLAGS) flagById[f.id] = f;
  const checkById = {};
  for (const c of CHECKLIST) checkById[c.id] = c;

  /* ── Days, items and the segments that connect them ─────────────────── */
  const segments = [];
  const walkCandidates = [];
  const items = {};
  let seq = 0;

  const days = DAYS.map((d, dayIndex) => {
    const parts = dateParts(d.date);
    const dayItems = [];
    const stops = [];           // unique placed places, in order of first visit
    const stopNumber = {};
    const daySegments = [];
    let cursor = null;          // last place with a known position
    let openCands = [];         // "?" stops just visited, still waiting for a possible walk onward
    let openAlts = [];          // second options of an "A / B" entry, waiting likewise

    const pushSegment = (seg) => {
      const full = { id: `seg-${segments.length}`, date: d.date, dayIndex, status: 'none', ...seg };
      full.km = measureLine(full.coords).length;
      segments.push(full);
      daySegments.push(full);
      return full;
    };

    /* A stop whose branch the plan does not name has no single position, so no route is
       asserted to or from it. What CAN be shown honestly is each possibility: one
       "maybe" walk per candidate branch, clearly styled as such on the map. */
    const maybeWalks = (placedId, cand, inbound, viaItemId) => {
      const placed = places[placedId];
      cand.candidates.forEach((c, i) => {
        if (c.listOnly) return;
        const a = inbound ? placed.coords : c.coords, b = inbound ? c.coords : placed.coords;
        const km = haversineKm(a, b);
        if (km < WALK_MIN_KM || km > WALK_MAX_KM) return;
        const key = inbound ? `${placedId}>${cand.id}#${i}` : `${cand.id}#${i}>${placedId}`;
        const w = walkByKey[key];
        if (!w) { walkCandidates.push({ key, from: inbound ? placedId : cand.id, to: inbound ? cand.id : placedId, fromCoords: a, toCoords: b, km }); return; }
        pushSegment({ kind: 'maybe', mode: 'maybe', from: inbound ? placedId : cand.id, to: inbound ? cand.id : placedId, candPlace: cand.id, candLabel: c.label, inbound,
          itemId: viaItemId, coords: w.geometry.coordinates, source: 'OpenStreetMap foot routing', suggested: true });
      });
    };

    /* The other option of an "A / B" entry: the route itself follows the first option, and
       the alternative gets a "maybe" walk in and out, so both choices can be compared. */
    const altWalk = (fromId, toId, altId, inbound, viaItemId) => {
      const a = places[fromId], b = places[toId];
      if (!a || !b || !a.coords || !b.coords || fromId === toId) return;
      const km = haversineKm(a.coords, b.coords);
      if (km < WALK_MIN_KM || km > WALK_MAX_KM) return;
      const key = walkKey(fromId, toId);
      const w = walkByKey[key];
      if (!w) { walkCandidates.push({ key, from: fromId, to: toId, fromCoords: a.coords, toCoords: b.coords, km }); return; }
      pushSegment({ kind: 'maybe', mode: 'maybe', alt: true, from: fromId, to: toId, candPlace: altId, inbound, itemId: viaItemId,
        coords: w.geometry.coordinates, source: 'OpenStreetMap foot routing', suggested: true });
    };

    /* `origin` is where you were before this timeline entry began. */
    const connect = (toId, viaItemId, origin = cursor) => {
      const to = places[toId];
      if (!to) return;
      if (!to.coords) {
        if (to.candidates.length) {
          if (origin) maybeWalks(origin, to, true, viaItemId);
          openCands.push(to);
        } else {
          openCands = [];   // a stop with no known position at all (no address): the chain simply breaks
          openAlts = [];
        }
        if (cursor === origin) cursor = null;
        return;
      }
      for (const cand of openCands) maybeWalks(toId, cand, false, viaItemId);
      for (const alt of openAlts) altWalk(alt, toId, alt, false, viaItemId);
      openCands = [];
      openAlts = [];
      if (cursor && cursor !== toId) {
        const from = places[cursor];
        const km = haversineKm(from.coords, to.coords);
        if (km >= WALK_MIN_KM) {
          const key = walkKey(cursor, toId);
          const w = walkByKey[key];
          if (w) {
            pushSegment({ kind: 'link', mode: 'walk', from: cursor, to: toId, itemId: viaItemId, coords: w.geometry.coordinates,
              source: 'OpenStreetMap foot routing', suggested: true });
          } else {
            if (km <= WALK_MAX_KM) walkCandidates.push({ key, from: cursor, to: toId, fromCoords: from.coords, toCoords: to.coords, km });
            pushSegment({ kind: 'link', mode: 'transfer', from: cursor, to: toId, itemId: viaItemId, coords: [from.coords, to.coords], straight: true });
          }
        }
      }
      cursor = toId;
    };

    const noteStop = (pid) => {
      const pl = places[pid];
      if (!pl || !pl.focus || pid in stopNumber) return;
      stops.push(pid);
      stopNumber[pid] = stops.length;
    };

    d.items.forEach((raw, j) => {
      const placeIds = raw.places || (raw.place ? [raw.place] : []);
      const id = `${d.date}/${raw.t}/${j}`;
      const leg = raw.leg || null;
      const item = {
        ...raw, id, seq: seq++, index: j, date: d.date, dayIndex, placeIds,
        timeLabel: fmtTime(raw.t) + (raw.tz === 'ET' ? ' ET' : ''),
        minutes: minutesOf(raw.t),
        status: raw.status || 'none',
        isLeg: !!leg,
        cat: leg ? 'transport' : (placeIds.length && places[placeIds[0]] ? places[placeIds[0]].cat : null),
        checklist: raw.check ? checkById[raw.check] || null : null,
      };

      if (leg) {
        const from = places[leg.from], to = places[leg.to];
        let coords = null, source = null, schematic = false, note = null;
        if (leg.mode === 'flight' && from?.coords && to?.coords) {
          coords = greatCircle(from.coords, to.coords, 128);
          source = 'Great-circle arc between the two airports (not the flown track)';
          schematic = true;
        } else if (leg.route && leg.route.every((rid) => routeById[rid])) {
          coords = leg.route.flatMap((rid, k) => { const c = routeById[rid].geometry.coordinates; return k ? c.slice(1) : c; });
          source = [...new Set(leg.route.map((rid) => routeById[rid].properties.source))].join(' + ');
          note = leg.route.map((rid) => routeById[rid].properties.note).filter(Boolean).join(' ');
        } else if (from?.coords && to?.coords) {
          coords = [from.coords, to.coords];
          source = 'Straight line: route geometry not available';
          schematic = true;
        }
        if (coords) {
          // Getting to the departure point (e.g. hotel → station) is a local transfer.
          if (leg.mode !== 'walk') connect(leg.from, id);
          item.segment = pushSegment({ kind: 'leg', mode: leg.mode, from: leg.from, to: leg.to, itemId: id, coords, source, note, schematic,
            status: item.status, service: leg.service });
        }
        if (to?.coords) { cursor = leg.to; openCands = []; openAlts = []; }
      } else {
        if (raw.via && raw.via.route && raw.via.route.every((rid) => routeById[rid])) {
          const coords = raw.via.route.flatMap((rid, k) => { const c = routeById[rid].geometry.coordinates; return k ? c.slice(1) : c; });
          item.viaSegment = pushSegment({ kind: 'via', mode: raw.via.mode, from: cursor, to: placeIds[0], itemId: id, coords,
            source: routeById[raw.via.route[0]].properties.source, service: raw.via.service, inferred: raw.via.inferred });
          cursor = null; // the via line already brings you to the stop
        }
        // "A / B" written as alternatives: the route continues from the first option only.
        // Any alternative without a confirmed branch still gets its possible walks.
        const origin = cursor;
        const isCand = (pid) => places[pid] && !places[pid].coords && places[pid].candidates.length > 0;
        if (placeIds.length && placeIds.every(isCand)) openCands = [];   // "?" straight after "?": nothing certain to link
        const linkIds = raw.join === 'or' ? placeIds.filter((pid, k) => k === 0 || isCand(pid)) : placeIds;
        linkIds.forEach((pid, k) => connect(pid, id, raw.join === 'or' || k === 0 ? origin : cursor));
        if (raw.join === 'or') {
          for (const pid of placeIds.slice(1)) {
            if (!places[pid] || !places[pid].coords) continue;
            if (origin) altWalk(origin, pid, pid, true, id);
            openAlts.push(pid);
          }
        }
        for (const pid of placeIds) {
          noteStop(pid);
          const pl = places[pid];
          if (!pl) continue;
          pl.visits.push({ itemId: id, dayIndex, date: d.date, time: item.timeLabel, label: raw.label, status: item.status, est: !!raw.est });
          if (raw.flag && flagById[raw.flag]) pl.flagText = flagById[raw.flag].text;
          const st = stayByPlace[pid] ? stayByPlace[pid].status : item.status;
          if (pl.status === 'none' && st !== 'none') pl.status = st;
        }
      }
      item.stopNumbers = placeIds.map((pid) => stopNumber[pid]).filter(Boolean);
      items[id] = item;
      dayItems.push(item);
    });

    const dest = d.destination ? destById[d.destination] : null;
    return {
      ...d, index: dayIndex, number: dayIndex + 1, parts,
      dest, items: dayItems, stops, stopNumber, segments: daySegments,
      points: [...stops.flatMap((pid) => (places[pid].coords ? [places[pid].coords] : places[pid].candidates.filter((c) => !c.listOnly).map((c) => c.coords))), ...daySegments.filter((s) => s.mode !== 'flight').flatMap((s) => sample(s.coords, 24))],
    };
  });

  for (const pl of Object.values(places)) {
    if (pl.unscheduled || pl.reference) pl.status = 'ref';
  }

  /* ── Derived lists ──────────────────────────────────────────────────── */
  const stays = STAYS.map((s) => ({ ...s, placeRef: places[s.place], dest: destById[s.destination] }));
  for (const st of stays) if (st.dest) st.dest.stayRef = st;
  for (const d of days) if (d.dest) d.dest.dayIndexes.push(d.index);
  const legs = days.flatMap((d) => d.items.filter((it) => it.isLeg));
  const placed = Object.values(places).filter((p) => p.coords);

  function nearby(placeId, radiusKm = 0.9, limit = 5) {
    const origin = places[placeId];
    if (!origin || !origin.coords) return [];
    return placed
      .filter((p) => p.id !== placeId && (p.visits.length || p.unscheduled))
      .map((p) => ({ place: p, km: haversineKm(origin.coords, p.coords) }))
      .filter((x) => x.km <= radiusKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, limit);
  }

  /* Immersive sequences, each resolved to the itinerary entry (or day) it belongs to. */
  const experiences = ((XP && XP.list) || []).map((x) => {
    const day = days.find((d) => d.date === x.event.date);
    const item = day && x.event.time ? day.items.find((i) => i.t === x.event.time) : null;
    const asset = XP.assets[x.asset] || null;
    const v = asset && asset.viewpoint;
    return { ...x, accuracy: { ...x.accuracy, label: (x.accuracy && x.accuracy.label) || ACCURACY[x.accuracy && x.accuracy.level] }, dayIndex: day ? day.index : -1, itemId: item ? item.id : null, ready: (x.type === 'film' || !!asset) && !!day && (!x.event.time || !!item),
      viewpoint: v ? (Array.isArray(v) ? v : [v.lon, v.lat]) : (x.viewpoint || null) };
  }).filter((x) => x.ready);

  /* Narration: only the lines that have been recorded, each with its clip. */
  const clips = (NAR && NAR.index) || {};
  const narration = ((NAR && NAR.lines) || []).filter((l) => clips[l.id])
    .map((l) => ({ ...l, dayIndex: parseInt(l.id, 10) - 1, src: clips[l.id].src, length: clips[l.id].length }));

  return {
    narration,
    experiences, experienceAssets: (XP && XP.assets) || {},
    trip: TRIP, nationView: NATION_VIEW, categories: CATEGORIES,
    places, days, items, segments, legs, stays, destinations, destById,
    checklist: CHECKLIST, ticketLinks: TICKET_LINKS, planNotes: PLAN_NOTES, flags: FLAGS, lore: LORE,
    walkCandidates, nearby,
    totalItems: Object.keys(items).length,
    dayIndexForDate: (iso) => days.findIndex((d) => d.date === iso),
  };
}

/** Thin a long line to at most n points (for bounds / framing only). */
function sample(coords, n) {
  if (coords.length <= n) return coords;
  const out = [];
  const step = (coords.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(coords[Math.round(i * step)]);
  return out;
}
