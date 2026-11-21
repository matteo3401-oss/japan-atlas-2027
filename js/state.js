/* A very small observable store with local persistence.

   Everything the traveller changes (completed activities, ticked checklist
   items, theme, layer toggles, last day viewed) is kept in localStorage on
   this device only. Nothing is sent anywhere. */

const KEY = 'japan-atlas-2027:v1';
const PERSISTED = ['done', 'checks', 'theme', 'terrain', 'imagery', 'buildings', 'layers', 'dayIndex', 'xpMode', 'xpSound', 'xpVolume', 'narration'];

export const DEFAULT_LAYERS = {
  stay: true, food: true, temple: true, shop: true, culture: true, view: true, transport: true, district: true,
  walking: true, confirmed: true, pending: true,
};

const defaults = {
  // what is in view
  mode: 'trip',            // 'trip' | 'destination' | 'day'
  dayIndex: 0,
  destinationId: null,
  placeId: null,
  // appearance
  theme: 'day',
  terrain: true,
  imagery: false,
  buildings: true,
  layers: { ...DEFAULT_LAYERS },
  // immersive sequences: 'cinematic' | 'interactive' | 'express', and whether their sound is on
  xpMode: 'cinematic',
  xpSound: true,
  xpVolume: 0.8,           // films only
  narration: true,         // the recorded voice in Play Journey
  // chrome
  panelOpen: true,
  dashboardOpen: false,
  layersOpen: false,
  journey: false,
  // progress (persisted)
  done: {},                // itemId → true
  checks: {},              // checklistId → true
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw);
    const out = {};
    for (const k of PERSISTED) if (k in saved) out[k] = saved[k];
    if (out.layers) out.layers = { ...DEFAULT_LAYERS, ...out.layers };
    return out;
  } catch (err) {
    return {};
  }
}

export function createStore() {
  let state = { ...defaults, ...load() };
  const listeners = new Set();
  let storageOk = true;

  function persist() {
    if (!storageOk) return;
    try {
      const out = {};
      for (const k of PERSISTED) out[k] = state[k];
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch (err) {
      storageOk = false; // private mode or storage full: keep working in memory
    }
  }

  return {
    get: () => state,
    get storageAvailable() { return storageOk; },
    /** Merge a patch; listeners receive (state, changedKeys). */
    set(patch) {
      const changed = [];
      for (const [k, v] of Object.entries(patch)) {
        if (state[k] !== v) changed.push(k);
      }
      if (!changed.length) return;
      state = { ...state, ...patch };
      if (changed.some((k) => PERSISTED.includes(k))) persist();
      for (const fn of listeners) fn(state, changed);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Run fn whenever any of the named keys change. */
    on(keys, fn) {
      const list = Array.isArray(keys) ? keys : [keys];
      return this.subscribe((s, changed) => { if (changed.some((k) => list.includes(k))) fn(s, changed); });
    },
    toggleDone(itemId) {
      const done = { ...state.done };
      if (done[itemId]) delete done[itemId]; else done[itemId] = true;
      this.set({ done });
    },
    toggleCheck(id) {
      const checks = { ...state.checks };
      if (checks[id]) delete checks[id]; else checks[id] = true;
      this.set({ checks });
    },
    toggleLayer(id) { this.set({ layers: { ...state.layers, [id]: !state.layers[id] } }); },
    soloLayer(id, groupIds) {
      const layers = { ...state.layers };
      const alreadySolo = groupIds.every((g) => layers[g] === (g === id));
      for (const g of groupIds) layers[g] = alreadySolo ? true : g === id;
      this.set({ layers });
    },
    resetProgress() { this.set({ done: {}, checks: {} }); },
  };
}
