/* ════════════════════════════════════════════════════════════════════════
   Journey mode: plays the whole trip in order, like a travel documentary.

   The itinerary is flattened into "beats":
     day      a title card for each new day
     chapter  arrival in a new destination (signature camera)
     leg      a flight / train / bus / hike animated along its route,
              and every walk between two consecutive stops (link: true)
     stop     a place on the schedule (fly in, slow orbit)
     note     a timeline entry that has no location
   A virtual clock (scaled by playback speed) drives every beat, so pause,
   skip, rewind and speed changes all behave consistently.

   A beat can also carry a "cue": an immersive sequence to step into. When
   playback reaches it the journey holds exactly where it is (clock, beat,
   camera), announces it, and carries on from the same instant on release().

   A beat can carry narration too: recorded lines spoken while it plays. The
   journey's clock slows down for as long as a line needs, so a stop or a leg
   simply takes longer and the line is never cut off (see "Narration" below).
   ════════════════════════════════════════════════════════════════════════ */

import { measureLine, pointAt, fractionOf, bearing as bearingBetween, angleDelta } from './lib/geo.js';
import { prefersReducedMotion } from './lib/dom.js';

export const SPEEDS = [0.5, 1, 2, 4];
const NIGHT_FROM = 18 * 60 + 45;   // evening light from 6:45 PM
const NIGHT_UNTIL = 5 * 60;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
const easeInOutInverse = (e) => (e < 0.5 ? Math.sqrt(e / 2) : 1 - Math.sqrt((1 - e) / 2));
const VOICE_GAP = 0.35;            // a breath between the end of a line and whatever comes next
const VOICE_REACH = 2;             // a long line may run on into this many quiet beats after its own

export function buildBeats(model) {
  const beats = [];
  let prevDest = null;

  for (const day of model.days) {
    const destChanged = day.destination && day.destination !== prevDest;
    const hasIntercityLeg = day.items.some((it) => it.isLeg && it.leg.mode !== 'walk');
    let chapterPending = destChanged ? day.dest : null;

    beats.push({ type: 'day', dayIndex: day.index, duration: 2.8, minutes: day.items[0]?.minutes ?? 600 });
    if (chapterPending && !hasIntercityLeg) {
      beats.push({ type: 'chapter', dayIndex: day.index, dest: chapterPending, duration: 6, minutes: day.items[0]?.minutes ?? 600 });
      chapterPending = null;
    }

    let lastPlace = null;
    for (const item of day.items) {
      if (item.viaSegment) beats.push(legBeat(day, item, item.viaSegment, true));
      // Walks that lead to this entry (e.g. hotel → station before a bus, or the stroll to dinner).
      const walks = day.segments.filter((sg) => sg.itemId === item.id && sg.kind === 'link' && sg.mode === 'walk');

      if (item.isLeg) {
        for (const sg of walks) beats.push(walkBeat(day, item, sg, model, true));
        if (item.segment) beats.push(legBeat(day, item, item.segment, false));
        else beats.push({ type: 'note', dayIndex: day.index, item, duration: 2.6, minutes: item.minutes });
        if (chapterPending && item.leg.mode !== 'walk') {
          beats.push({ type: 'chapter', dayIndex: day.index, dest: chapterPending, duration: 6, minutes: item.minutes });
          chapterPending = null;
        }
        lastPlace = null;
        continue;
      }

      const place = item.placeIds.map((id) => model.places[id]).find((p) => p && p.focus);
      if (!place) { beats.push({ type: 'note', dayIndex: day.index, item, duration: 2.6, minutes: item.minutes }); continue; }
      const same = lastPlace === place.id;
      const arriving = walks.filter((sg) => sg.to === place.id);
      for (const sg of arriving) beats.push(walkBeat(day, item, sg, model, true));
      // After a walk the camera is already there, so the stop needs only a short settle.
      const walkedIn = arriving.length > 0;
      beats.push({ type: 'stop', dayIndex: day.index, item, place, same, duration: same ? 3.2 : walkedIn ? 4.2 : 5.4, fly: same ? 0 : walkedIn ? 1.3 : 2.4, minutes: item.minutes });
      // "A / B" entries: the walk on from the first place to the second.
      for (const sg of walks.filter((x) => x.to !== place.id)) beats.push(walkBeat(day, item, sg, model, false));
      lastPlace = place.id;
    }
    if (day.destination) prevDest = day.destination;
  }

  let t = 0;
  beats.forEach((b, i) => { b.index = i; b.start = t; t += b.duration; });
  return { beats, total: t };
}

function legBeat(day, item, segment, inferred) {
  const km = segment.km;
  const flight = segment.mode === 'flight';
  const duration = flight ? 12 : clamp(6 + Math.sqrt(km) * 0.55, 7, 18);
  return {
    type: 'leg', dayIndex: day.index, item, segment, inferred, duration, fly: 2.3, minutes: item.minutes,
    cam: flight ? { zoom: 2.2, pitch: 0 } : { zoom: clamp(13.2 - Math.log2(Math.max(km, 1) / 8), 8.5, 14.8), pitch: km > 150 ? 56 : 62 },
  };
}

/** A walk between two consecutive stops, played like any other leg but shorter and closer in. */
function walkBeat(day, item, segment, model, before) {
  const km = segment.km;
  return {
    type: 'leg', link: true, before, dayIndex: day.index, item, segment, inferred: false, minutes: item.minutes,
    fromPlace: model.places[segment.from], toPlace: model.places[segment.to],
    duration: clamp(3.4 + km * 1.5, 3.8, 7.5), fly: 1.5,
    cam: { zoom: clamp(15.4 - Math.log2(Math.max(km, 0.1) / 0.5), 13.4, 16.6), pitch: 60 },
  };
}

export class Journey extends EventTarget {
  constructor({ atlas, model }) {
    super();
    this.atlas = atlas;
    this.model = model;
    const built = buildBeats(model);
    this.beats = built.beats;
    this.total = built.total;
    this.i = 0;
    this.elapsed = 0;
    this.speed = 1;
    this.playing = false;
    this.active = false;
    this.autoLight = true;
    this.ended = false;
    this._raf = null;
    this._last = 0;
    this._camBearing = 0;
    this._frame = this._frame.bind(this);
    this.held = false;
    this.wantsCue = () => true;        // the app answers false when sequences are switched off
    this._attachCues(model.experiences || []);
    this.voice = null;                 // a Narrator, when the app has one
    this.wantsVoice = () => true;      // the app answers false when narration is switched off
    this._speaking = null;
    this._said = new Set();
    this._attachLines(model.narration || []);
  }

  /* ── Narration ──────────────────────────────────────────────────────── */

  /** Pin each recorded line to its beat, and work out how far a long line may run on. */
  _attachLines(list) {
    const kinds = {
      day: (b) => b.type === 'day',
      chapter: (b) => b.type === 'chapter',
      stop: (b, t) => b.type === 'stop' && b.item.t === t,
      leg: (b, t) => b.type === 'leg' && !b.link && !b.inferred && b.item.t === t,
      via: (b, t) => b.type === 'leg' && !b.link && b.inferred && b.item.t === t,
      walk: (b, t) => b.type === 'leg' && b.link && b.item.t === t,
      note: (b, t) => b.type === 'note' && b.item.t === t,
    };
    for (const line of list) {
      const [kind, time] = String(line.at).split(' ');
      const beat = kinds[kind] && this.beats.find((b) => b.dayIndex === line.dayIndex && kinds[kind](b, time));
      if (!beat) { console.warn(`Narration line ${line.id}: no moment "${line.at}" on day ${line.dayIndex + 1}`); continue; }
      (beat.lines = beat.lines || []).push({ ...line, beatIndex: beat.index });
    }
    // A line longer than its own beat borrows the quiet beats that follow (same day, nothing of their own).
    for (const b of this.beats) {
      if (!b.lines) continue;
      b.lines.forEach((line, n) => {
        line.reach = b.index;
        if (n < b.lines.length - 1 || (b.cue && !this._afterFilm(b, line))) return;
        for (let k = b.index + 1; k <= b.index + VOICE_REACH && k < this.beats.length; k++) {
          const nx = this.beats[k];
          if (nx.dayIndex !== b.dayIndex || nx.lines || nx.cue) break;
          line.reach = k;
        }
      });
    }
  }

  /** Is this line spoken after the beat's film rather than before it? */
  _afterFilm(b, line) { return !!b.cue && (b.cue.at === 'start' || (typeof b.cue.at === 'number' && !!line.after)); }

  /** The moment within a beat (in its own seconds) at which its film is due. */
  _cuePoint(b) {
    if (b.cue.at === 'start') return (b.fly || 0) + 0.6;
    if (b.cue.at === 'end') return b.duration - 0.05;
    return b.fly + easeInOutInverse(b.cue.at) * (b.duration - b.fly - 0.4);
  }

  _voiceOn() { return !!this.voice && this.speed <= 1 && this.wantsVoice(); }

  /** Start the next line of this beat when its moment has come and nothing else is being said. */
  _speak() {
    const b = this.beat;
    if (!b.lines || !this._voiceOn() || this.voice.active) return;
    for (const line of b.lines) {
      if (this._said.has(line)) continue;
      if (this._afterFilm(b, line)) {
        const filmComing = this.wantsCue(b.cue.exp);
        if (filmComing ? !this._cueDone : (b.cue.at !== 'start' && this.elapsed < this._cuePoint(b))) return;
      }
      this._said.add(line);
      this._speaking = line;
      this.voice.say(line);
      return;
    }
  }

  /** How fast the clock may run while a line is being spoken: 1 when there is time to spare, down to 0 to wait for it. */
  _voiceRate(b) {
    const line = this._speaking;
    if (!line || !this.voice || !this.voice.active) { this._speaking = null; return 1; }
    let left;
    if (line.beatIndex === b.index && b.cue && !this._afterFilm(b, line)) {
      left = this._cuePoint(b) - 0.08 - this.elapsed;                 // finish before the film
    } else {
      left = b.duration - this.elapsed;
      for (let k = b.index + 1; k <= line.reach; k++) left += this.beats[k].duration;
    }
    return clamp(left / ((this.voice.remaining + VOICE_GAP) * this.speed), 0, 1);
  }

  /** Stop talking (narration switched off, a jump, a fast speed). */
  hush() { this._speaking = null; if (this.voice) this.voice.stop(); }

  /** Lines coming up within the next few beats (so they can be fetched early). */
  upcomingLines(span = 6) {
    const out = [];
    for (let k = this.i; k < Math.min(this.i + span, this.beats.length); k++) if (this.beats[k].lines) out.push(...this.beats[k].lines);
    return out;
  }

  /* ── Immersive sequences ────────────────────────────────────────────── */

  /** Pin each sequence to the beat it belongs to, and to the moment within it. */
  _attachCues(list) {
    for (const x of list) {
      if (x.trigger === 'viewpoint' && x.itemId && x.viewpoint) {
        const beat = this.beats.find((b) => b.type === 'leg' && !b.link && !b.inferred && b.item.id === x.itemId);
        if (beat) beat.cue = { exp: x, at: clamp(fractionOf(measureLine(beat.segment.coords), x.viewpoint), 0.02, 0.98) };
      } else if (x.itemId) {
        const beat = this.beats.find((b) => b.item && b.item.id === x.itemId && !b.link && !b.inferred);
        if (beat) beat.cue = { exp: x, at: 'start' };
      } else {
        const beat = this.beats.find((b) => b.type === 'day' && b.dayIndex === x.dayIndex);
        if (beat) beat.cue = { exp: x, at: 'end' };
      }
    }
  }

  /** Has playback reached this beat's cue? `e` is the eased progress along a leg. */
  _cueDue(b, e) {
    if (!b.cue || this._cueDone || !this.wantsCue(b.cue.exp)) return false;
    if (b.cue.at === 'start') return this.elapsed >= (b.fly || 0) + 0.6;
    if (b.cue.at === 'end') return this.elapsed >= b.duration - 0.05;
    return e !== null && e >= b.cue.at;
  }

  /** Freeze in place and hand over. Nothing about the playback state changes while held. */
  _hold(cue) {
    this._cueDone = true;
    this.held = true;
    this.hush();                       // never over a film
    cancelAnimationFrame(this._raf);
    const map = this.atlas.map;
    map.stop();
    this._heldCamera = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    this._emit('state');
    this.dispatchEvent(new CustomEvent('experience', { detail: { exp: cue.exp, journey: this } }));
  }

  /** Back from a sequence: put the camera exactly where it was and carry on. */
  /** Put the map back where it was held. Called while the curtain is still closed, so the cut is never seen. */
  restoreCamera() {
    if (this.held && this.active && this._heldCamera) { this.atlas.map.jumpTo(this._heldCamera); this._heldCamera = null; }
  }

  release() {
    if (!this.held) return;
    this.held = false;
    if (this.active && this._heldCamera) this.atlas.map.jumpTo(this._heldCamera);
    this._heldCamera = null;
    this._emit('state');
    if (this.active && this.playing) { this._last = performance.now(); this._raf = requestAnimationFrame(this._frame); }
  }

  /** Which sequences are coming up within the next few beats (so they can be fetched early). */
  upcomingCues(span = 8) {
    const out = [];
    for (let k = this.i; k < Math.min(this.i + span, this.beats.length); k++) if (this.beats[k].cue) out.push(this.beats[k].cue.exp);
    return out;
  }

  get beat() { return this.beats[this.i]; }
  get progress() { return clamp((this.beat.start + Math.min(this.elapsed, this.beat.duration)) / this.total, 0, 1); }

  /* ── Transport controls ─────────────────────────────────────────────── */

  start(dayIndex = 0) {
    this.active = true;
    this.ended = false;
    const idx = this.beats.findIndex((b) => b.dayIndex === dayIndex);
    this._enter(Math.max(0, idx));
    this.play();
  }

  stop() {
    this.pause();
    this.hush();
    this.active = false;
    this.held = false;
    this._heldCamera = null;
    this.atlas.setJourneyLine(null);
    this.atlas.showPulse(null);
    this._emit('state');
  }

  play() {
    if (this.ended) { this.ended = false; this._enter(0); }
    if (this.playing) return;
    this.playing = true;
    this._last = performance.now();
    if (!this.held) { this._resumeCamera(); this._raf = requestAnimationFrame(this._frame); }
    if (this.voice) this.voice.resume();
    this._emit('state');
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this._raf);
    if (this.voice) this.voice.pause();
    this.atlas.map.stop();
    this._emit('state');
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  next() { if (this.i < this.beats.length - 1) this._go(this.i + 1); else this._finish(); }

  /** Rewind: restart the current beat, or step back if it has only just begun. */
  prev() { this._go(this.elapsed > 1.4 || this.i === 0 ? this.i : this.i - 1); }

  nextDay() {
    const idx = this.beats.findIndex((b) => b.dayIndex > this.beat.dayIndex);
    if (idx >= 0) this._go(idx); else this._finish();
  }

  prevDay() {
    const cur = this.beat.dayIndex;
    const firstOfCur = this.beats.findIndex((b) => b.dayIndex === cur);
    const target = this.i > firstOfCur + 1 ? cur : Math.max(0, cur - 1);
    this._go(this.beats.findIndex((b) => b.dayIndex === target));
  }

  goToDay(dayIndex) { const idx = this.beats.findIndex((b) => b.dayIndex === dayIndex); if (idx >= 0) this._go(idx); }

  /** Seek by overall fraction (0..1): lands on the start of that beat. */
  seek(fraction) {
    const t = clamp(fraction, 0, 1) * this.total;
    let idx = this.beats.findIndex((b) => t < b.start + b.duration);
    if (idx < 0) idx = this.beats.length - 1;
    this._go(idx);
  }

  setSpeed(s) { this.speed = s; if (s > 1) this.hush(); this._emit('state'); }   // narration is for normal speed and slower

  /* ── Engine ─────────────────────────────────────────────────────────── */

  _go(i) {
    this.ended = false;
    this._enter(i);
    if (this.playing) this._last = performance.now();
    else this._emit('tick');
  }

  _finish() {
    this.pause();
    this.ended = true;
    this._emit('state');
  }

  _emit(type) { this.dispatchEvent(new CustomEvent(type, { detail: this })); }

  _enter(i, flowing = false) {
    // a line may carry on into this beat only when playback simply ran on into it
    if (!(flowing && this._speaking && this._speaking.reach >= i)) this.hush();
    this.i = i;
    this.elapsed = 0;
    this._checks = 0;
    this._cueDone = false;
    this._said = new Set();
    const b = this.beat;
    const atlas = this.atlas;
    atlas.map.stop();

    if (b.type === 'leg') {
      this._line = measureLine(b.segment.coords);
      atlas.setJourneyLine(b.segment.coords, b.segment.mode);
      atlas.showPulse(null);
      const flight = b.segment.mode === 'flight';
      this._camBearing = flight ? 0 : bearingBetween(pointAt(this._line, 0), pointAt(this._line, 0.12));
    } else {
      atlas.setJourneyLine(null);
      atlas.showPulse(b.type === 'stop' ? b.place.coords : null);   // no pulse on a candidate: its position is unknown
    }
    this._startCamera(b, 0);
    this._emit('beat');
  }

  /** Issue the fly-in for a beat; `done` is how many virtual seconds of it have already played. */
  _startCamera(b, done) {
    const map = this.atlas.map;
    const instant = prefersReducedMotion();
    const ms = (sec) => (instant ? 0 : Math.max(0, (sec - done) * 1000) / this.speed);
    const fly = (opts, sec) => { if (ms(sec) <= 0) map.jumpTo(opts); else map.flyTo({ ...opts, duration: ms(sec), curve: 1.4, essential: true }); };
    const offset = [0, 0];   // the HUD sets map padding, so "centre" already means the clear part of the screen

    if (b.type === 'leg') {
      if (done >= b.fly) return;
      fly({ center: b.segment.coords[0], zoom: b.cam.zoom, pitch: b.cam.pitch, bearing: this._camBearing, offset }, b.fly);
    } else if (b.type === 'stop') {
      if (b.same || done >= b.fly) return;
      const cam = stopCamera(b.place);
      this._orbitFrom = cam.bearing ?? (map.getBearing() + 28);
      fly({ center: b.place.focus, zoom: cam.zoom, pitch: cam.pitch, bearing: this._orbitFrom, offset }, b.fly);
    } else if (b.type === 'chapter') {
      const v = b.dest.view;
      this._orbitFrom = v.bearing;
      if (done >= 3.4) return;
      fly({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing, offset }, 3.4);
    }
  }

  _resumeCamera() {
    if (!this.active) return;
    this._startCamera(this.beat, this.elapsed);
  }

  _frame(now) {
    if (!this.playing || this.held) return;
    const real = Math.max(0, Math.min(0.1, (now - this._last) / 1000));   // clamp: tab switches and clock jumps must not skip or rewind
    this._last = now;
    const b = this.beat;
    this._speak();
    this.elapsed += real * this.speed * this._voiceRate(b);
    const map = this.atlas.map;
    let along = null;                  // eased progress along a leg, once it is under way

    if (b.type === 'leg') {
      const t = clamp((this.elapsed - b.fly) / (b.duration - b.fly - 0.4), 0, 1);
      if (this.elapsed >= b.fly) {
        const e = easeInOut(t);
        along = e;
        const pos = pointAt(this._line, e);
        if (b.segment.mode === 'flight') {
          this.atlas.follow(pos, { zoom: b.cam.zoom, pitch: 0, bearing: 0 });
        } else {
          const ahead = pointAt(this._line, Math.min(1, e + 0.1));
          const target = e > 0.9 ? this._camBearing : bearingBetween(pos, ahead);
          this._camBearing += angleDelta(this._camBearing, target) * Math.min(1, real * this.speed * 0.9);
          this.atlas.follow(pos, { zoom: b.cam.zoom, pitch: b.cam.pitch, bearing: this._camBearing });
        }
        this.atlas.setJourneyProgress(e, pos);
      }
    } else if (b.type === 'stop' || b.type === 'chapter') {
      // On hillsides the fly-in can land off target (see Atlas.recenterIfOff). Once it has
      // landed: first a gentle correction, then, if that did not take, an exact placement.
      const checks = this._checks || 0;
      if (b.type === 'stop' && !b.same && checks < 2 && this.elapsed >= b.fly + checks * 1.1 && (checks === 1 || !map.isEasing())) {
        this._checks = checks + 1;
        this.atlas.recenterIfOff(b.place.focus, [0, 0], { jump: checks === 1 });
      }
      // gentle orbit while nothing else is moving the camera
      if (!map.isEasing()) map.setBearing(map.getBearing() + real * this.speed * (b.type === 'chapter' ? 5 : 4));
    }

    if (this._cueDue(b, along)) { this._emit('tick'); this._hold(b.cue); return; }
    this._continue(b);
  }

  _continue(b) {
    this._emit('tick');
    if (this.elapsed >= b.duration) {
      if (this.i >= this.beats.length - 1) { this._finish(); return; }
      this._enter(this.i + 1, true);
    }
    this._raf = requestAnimationFrame(this._frame);
  }

  /** Should this beat be shown in evening light? */
  isNight(b = this.beat) {
    if (b.type === 'leg' && b.segment.mode === 'flight') return b.minutes >= NIGHT_FROM;
    return b.minutes >= NIGHT_FROM || b.minutes < NIGHT_UNTIL;
  }
}

/** Camera for a stop: a few places get a composed shot, the rest a default by type. */
export function stopCamera(place) {
  if (place.cam) return place.cam;
  if (!place.coords) return { zoom: Math.max(12.6, Math.min(15.6, 15.4 - Math.log2(Math.max(place.spreadKm, 0.35) / 0.5))), pitch: 52 };
  if (place.cat === 'view') return { zoom: 14.4, pitch: 70 };
  if (place.precision === 'area' || place.cat === 'district') return { zoom: 15.5, pitch: 60 };
  if (place.cat === 'transport') return { zoom: 15.2, pitch: 58 };
  return { zoom: 16.2, pitch: 62 };
}
