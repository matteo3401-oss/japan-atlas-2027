/* ════════════════════════════════════════════════════════════════════════
   Experience director: steps out of the atlas into an immersive scene and
   back again.

   It owns everything a scene should not have to care about: the full-screen
   stage, the title, the fades in and out, the clock (pause / replay), looking
   around, sound on/off, fullscreen, the three playback preferences, loading
   and failure. A scene only has to build its world and draw a frame.

   Scene types live in ./scenes/<type>.js and export
       create({ THREE, renderer, config, asset, quality, audio }) →
         { update({ t, dt, look, input, mode }), render(), resize(w, h), dispose(), facts? }

   A "film" experience has no scene: it is footage played full screen (see
   ./film.js), with real photographs as the stand-in when the footage is
   missing or cannot be played.
   ════════════════════════════════════════════════════════════════════════ */

import { h, icon, mount } from '../lib/dom.js';
import { clamp, createAudio } from './kit.js';
import { createFilmPlayer, createStillsPlayer } from './film.js';
import { ACCURACY } from './labels.js';

export const MODES = [
  { id: 'cinematic', label: 'Cinematic', hint: 'Plays each immersive sequence, then carries on' },
  { id: 'interactive', label: 'Interactive', hint: 'Stays in each sequence until you choose to leave' },
  { id: 'express', label: 'Express', hint: 'Skips the immersive sequences' },
];
const SCENES = { vista: () => import('./scenes/vista.js'), trail: () => import('./scenes/trail.js'), window: () => import('./scenes/window.js') };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class ExperienceDirector {
  /** `media(src)` resolves with a Blob of a film or photograph (decrypted first, in a hosted copy). */
  constructor({ list, assets, store, atlas, toast, media }) {
    this.list = list || [];
    this.assets = assets || {};
    this.store = store;
    this.atlas = atlas;
    this.toast = toast;
    this.media = media || ((src) => fetch(src).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); }));
    this.active = false;
    this.film = null;
    this._three = null;
    this._films = new Map();
    this._build();
  }

  byId(id) { return this.list.find((x) => x.id === id) || null; }

  quality() {
    const small = Math.min(window.innerWidth, window.innerHeight) < 500;
    const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
    return small && weak ? 'low' : 'high';
  }

  /** Fetch the 3D library and the scene code ahead of time, so the cut is instant. */
  async preload(exp) {
    if (exp && exp.type === 'film') { this._filmSources(exp); return; }
    if (!exp || !SCENES[exp.type]) return;
    try { this._three = this._three || import('../../vendor/three.module.min.js'); await Promise.all([this._three, SCENES[exp.type]()]); } catch (err) { /* handled when played */ }
  }

  _build() {
    const b = (name, label, onclick, cls = '') => h(`button.xp__btn${cls}`, { type: 'button', 'aria-label': label, title: label, onclick }, icon(name, 18));
    this.canvas = null;
    this.fade = h('div.xp__fade');
    this.title = h('div.xp__title');
    this.label = h('button.xp__label', { type: 'button', onclick: () => { this.about.hidden = !this.about.hidden; } });
    this.about = h('div.xp__about', { hidden: true });
    this.hint = h('p.xp__hint');
    this.pauseBtn = b('pause', 'Pause', () => this._togglePause());
    this.soundBtn = h('button.xp__btn.xp__btn--text.xp__sound', { type: 'button', onclick: () => this._toggleSound() }, 'Sound on');
    // films: a speaker and a volume slider instead of the on/off word, and a hairline of progress
    this.volBtn = b('sound', 'Mute', () => this._toggleSound());
    this.volRange = h('input.xp__range', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Volume' });
    this.volRange.addEventListener('input', () => this._setVolume(Number(this.volRange.value) / 100));
    this.vol = h('div.xp__vol', this.volBtn, this.volRange);
    this.progress = h('div.xp__progress', h('i'));
    this.walkBtn = h('button.xp__btn.xp__btn--text.xp__walk', { type: 'button', hidden: true }, icon('walk', 16), 'Hold to walk');
    this.leaveBtn = h('button.xp__btn.xp__btn--text.xp__leave', { type: 'button', onclick: () => this._finish() }, 'Return to the journey', icon('chevronR', 15));
    this.controls = h('div.xp__controls', this.progress,
      this.pauseBtn, b('reset', 'Replay from the start', () => this._replay()),
      this.soundBtn, this.vol, document.fullscreenEnabled ? b('expand', 'Fullscreen', () => this._fullscreen()) : null,
      h('span.xp__spacer'), this.walkBtn, this.leaveBtn);
    this.stage = h('div.xp__stage');
    this.el = h('section.xp', { hidden: true, 'aria-label': 'Immersive sequence' }, this.stage, h('div.xp__bar.xp__bar--t'), h('div.xp__bar.xp__bar--b'),
      this.title, this.label, this.about, this.hint, this.controls, this.fade);
    document.body.append(this.el);

    // films: the controls step back while it plays and return at the first movement
    this._seen = 0;
    this._wake = () => { this._seen = performance.now(); this.el.classList.remove('is-idle'); };
    for (const ev of ['pointermove', 'pointerdown', 'focusin']) this.el.addEventListener(ev, this._wake, { passive: true });
    let wasIdle = false;
    this.stage.addEventListener('pointerdown', () => { wasIdle = this.el.classList.contains('is-idle'); });
    this.stage.addEventListener('click', () => { if (this.film && !wasIdle) this._togglePause(); });   // a tap on a resting screen only brings the controls back

    // walking (keys, or holding the button on a touch screen)
    const hold = (v) => (e) => { e.preventDefault(); this.input.walk = v; };
    this.walkBtn.addEventListener('pointerdown', hold(1));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) this.walkBtn.addEventListener(ev, hold(0));
    this._keys = (e) => {
      if (!this.active) return;
      const down = e.type === 'keydown';
      if (down) this._wake();
      if (this.film && down && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const vol = this.store.get().xpSound === false ? 0 : (this.store.get().xpVolume ?? 0.8);
        if (e.key === 'm' || e.key === 'M') { this._toggleSound(); e.stopPropagation(); return; }
        if (e.key === 'r' || e.key === 'R') { this._replay(); e.stopPropagation(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { this._setVolume(vol + (e.key === 'ArrowUp' ? 0.1 : -0.1)); e.preventDefault(); e.stopPropagation(); return; }
      }
      if (['w', 'W', 'ArrowUp'].includes(e.key)) { this.input.walk = down ? 1 : 0; e.preventDefault(); e.stopPropagation(); }
      else if (['s', 'S', 'ArrowDown'].includes(e.key)) { this.input.walk = down ? -1 : 0; e.preventDefault(); e.stopPropagation(); }
      else if (down && e.key === 'Escape') { this._finish(); e.stopPropagation(); }
      else if (down && e.key === ' ') { this._togglePause(); e.preventDefault(); e.stopPropagation(); }
      else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key !== 'Tab' && e.key !== 'Enter') e.stopPropagation();   // the journey's own shortcuts wait
    };
    window.addEventListener('keydown', this._keys, true);
    window.addEventListener('keyup', this._keys, true);
    this.input = { walk: 0 };
  }

  /** A WebGL context cannot be reused once released, so each run gets its own canvas. */
  _newCanvas() {
    const canvas = h('canvas.xp__canvas');
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); this.el.classList.add('is-looking'); this.hint.classList.add('is-off'); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || !this.look) return;
      const k = 0.11 * (this.fov / 50);
      this.lookTarget.yaw = clamp(this.lookTarget.yaw - (e.clientX - drag.x) * k, -this.limit[0], this.limit[0]);
      this.lookTarget.pitch = clamp(this.lookTarget.pitch + (e.clientY - drag.y) * k, -this.limit[1], this.limit[1]);
      drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => { drag = null; this.el.classList.remove('is-looking'); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    mount(this.stage, canvas);
    this.canvas = canvas;
  }

  _syncButtons() {
    const paused = this.film ? this.film.paused : this.paused;
    mount(this.pauseBtn, icon(paused ? 'play' : 'pause', 18));
    this.pauseBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    const s = this.store.get();
    const on = s.xpSound !== false && !this._needTap;
    this.soundBtn.textContent = on ? 'Sound on' : 'Sound off';
    this.soundBtn.setAttribute('aria-pressed', String(on));
    mount(this.volBtn, icon(on ? 'sound' : 'mute', 18));
    this.volBtn.setAttribute('aria-label', on ? 'Mute' : 'Turn the sound on');
    this.volBtn.title = on ? 'Mute' : 'Turn the sound on';
    this.volRange.value = String(Math.round((on ? (s.xpVolume ?? 0.8) : 0) * 100));
  }
  _togglePause() {
    if (this.film) { if (this.film.paused) this.film.play(); else this.film.pause(); return; }   // its own play / pause events update the button
    this.paused = !this.paused; if (this.audio) this.audio.duck(this.paused ? 0.25 : 1); this._syncButtons();
  }
  _replay() {
    if (this.film) { this.film.replay(); return; }
    this.t = 0; this.paused = false; this._syncButtons();
  }
  _toggleSound() {
    if (this._needTap) this._needTap = false;       // the browser held the sound back until a touch: this is that touch
    else this.store.set({ xpSound: this.store.get().xpSound === false });
    this._applySound();
  }
  _setVolume(v) { this._needTap = false; const volume = clamp(v, 0, 1); this.store.set(volume > 0.005 ? { xpVolume: volume, xpSound: true } : { xpSound: false }); this._applySound(); }
  _applySound() {
    const s = this.store.get();
    const on = s.xpSound !== false && !this._needTap;
    if (this.film) this.film.setSound((s.xpVolume ?? 0.8) * (this._gain ?? 1), on);
    if (this.audio) this.audio.setOn(on);
    if (this.film) this.hint.textContent = this._needTap ? 'Tap the speaker for sound' : '';
    this._syncButtons();
  }
  /** Ease the film's sound in or out (steps on a timer, so it also runs in a background tab). */
  async _ramp(from, to, ms) {
    for (let i = 0; i <= 10; i++) { this._gain = from + (to - from) * (i / 10); const s = this.store.get(); if (this.film) this.film.setSound((s.xpVolume ?? 0.8) * this._gain, s.xpSound !== false && !this._needTap); if (i < 10) await wait(ms / 10); }
  }
  _fullscreen() { const p = document.fullscreenElement ? document.exitFullscreen() : this.el.requestFullscreen(); Promise.resolve(p).catch(() => {}); }
  _finish() { if (this._resolve) { const r = this._resolve; this._resolve = null; r(); } else if (this.active) this._skip = true; }

  /**
   * Play one experience. Resolves when it is over (finished, skipped or failed):
   * the caller simply carries on from where it was.
   *   mode      'cinematic' | 'interactive'
   *   descend   fly the map down to the place first (used when called from the journey)
   */
  async run(exp, { mode = 'cinematic', descend = true, leaveLabel = 'Return to the journey', covered = null } = {}) {
    if (this.active || !exp) return { played: false };
    if (exp.type === 'film') return this._runFilm(exp, { mode, descend, leaveLabel, covered });
    if (!SCENES[exp.type]) return { played: false };
    const asset = this.assets[exp.asset];
    if (!asset) { this.toast('This immersive sequence has no data yet, so it was skipped.'); return { played: false }; }
    this.active = true;
    this._skip = false;
    const narrow = window.innerWidth < 560;
    mount(this.leaveBtn, narrow ? 'Return' : leaveLabel, icon('chevronR', 15));
    this.leaveBtn.setAttribute('aria-label', leaveLabel);
    mount(this.walkBtn, icon('walk', 16), narrow ? 'Walk' : 'Hold to walk');
    const map = this.atlas.map;
    const vp = asset.viewpoint ? (Array.isArray(asset.viewpoint) ? asset.viewpoint : [asset.viewpoint.lon, asset.viewpoint.lat]) : null;
    let inst = null, renderer = null, ro = null, raf = 0;

    try {
      // 1–2. highlight the place and come down toward it, while the scene loads behind the curtain
      const loading = Promise.all([this._three = this._three || import('../../vendor/three.module.min.js'), SCENES[exp.type]()]);
      loading.catch(() => {});
      await this._approach(vp, descend);

      // 3. the title, over a closing curtain
      this.walkBtn.hidden = !(exp.interaction || []).includes('walk');
      this.hint.textContent = !(exp.interaction || []).includes('walk') ? 'Drag to look around' : narrow ? 'Drag to look · hold Walk to move' : 'Drag to look around · hold W or the button to walk';
      this.hint.classList.remove('is-off');
      await this._raise(exp, mode, 'scene');
      this._setLabel(exp.accuracy.level, exp.accuracy.label || ACCURACY[exp.accuracy.level]);
      await wait(650);

      // 4. build the world
      const [THREE, mod] = await loading;
      this._newCanvas();
      const quality = this.quality();
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      this.audio = createAudio();
      inst = await mod.create({ THREE, renderer, config: exp, asset, quality, audio: this.audio });
      mount(this.about, h('p.xp__about-k', ACCURACY[exp.accuracy.level]), h('p', exp.accuracy.text),
        (inst.facts || []).map((f) => h('p', f)), h('p.xp__credit', (exp.attribution || []).join(' · ')));

      this.limit = (exp.camera && exp.camera.lookLimit) || [30, 12];
      this.fov = (exp.camera && exp.camera.fov) || 50;
      this.look = { yaw: 0, pitch: 0 };
      this.lookTarget = { yaw: 0, pitch: 0 };
      this.input.walk = 0;
      this.t = 0;
      this.paused = false;
      this._syncButtons();
      const fit = () => { const w = this.el.clientWidth, hh = this.el.clientHeight; if (!w || !hh) return; renderer.setSize(w, hh, false); inst.resize(w, hh); };
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(this.el);

      // 5. play
      const done = new Promise((resolve) => { this._resolve = resolve; });
      if (this._skip) this._finish();                    // Esc was pressed while it was still loading
      let last = performance.now(), revealed = false;
      const frame = (now) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        if (!this.paused) this.t += dt;
        this.look.yaw += (this.lookTarget.yaw - this.look.yaw) * Math.min(1, dt * 7);
        this.look.pitch += (this.lookTarget.pitch - this.look.pitch) * Math.min(1, dt * 7);
        inst.update({ t: this.t, dt: this.paused ? 0 : dt, look: this.look, input: this.input, mode });
        inst.render();
        if (!revealed) {   // first frame is on the glass: lift the curtain
          revealed = true;
          this.fade.classList.remove('is-on');
          if (this.audio && exp.audio) { this.audio.start(exp.audio.bed, exp.audio.level); this.audio.setOn(this.store.get().xpSound !== false); }
          setTimeout(() => this.title.classList.remove('is-on'), 3600);
          setTimeout(() => this.el.classList.add('is-live'), 2400);
        }
        if (mode === 'cinematic' && this.t >= exp.duration) this._finish();
        if (mode === 'interactive' && this.t >= exp.duration * 0.6) this.leaveBtn.classList.add('is-ready');
      };
      raf = requestAnimationFrame(frame);
      await done;

      // 6. back to the atlas
      this.fade.classList.add('is-on');
      if (this.audio) this.audio.stop();
      await wait(900);
      if (covered) covered();          // the map is put back where it was while nothing can be seen
      return { played: true };
    } catch (err) {
      console.error(err);
      this.toast('This device could not show the immersive sequence, so the journey carries on without it.');
      return { played: false, error: true };
    } finally {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      if (document.fullscreenElement === this.el) document.exitFullscreen().catch(() => {});
      try { if (inst) inst.dispose(); if (renderer) { renderer.dispose(); renderer.forceContextLoss(); } } catch (err) { /* nothing left to free */ }
      this.audio = null;
      await this._lower();
    }
  }

  /* ── Shared entrance and exit ───────────────────────────────────────── */

  /** Come down toward the place; as the flight ends the map pushes in and drops out of focus. */
  async _approach(vp, descend) {
    const map = this.atlas.map;
    if (descend && vp) {
      this.atlas.showPulse(vp);
      map.flyTo({ center: vp, zoom: Math.max(map.getZoom(), 13.6), pitch: 66, duration: 2100, essential: true });
      await wait(1150);
      document.body.classList.add('xp-approach');
      await wait(950);
    } else {
      document.body.classList.add('xp-approach');
      await wait(500);
    }
  }

  /** Close the curtain over the map and bring up the title. */
  async _raise(exp, mode, kind) {
    mount(this.title, exp.jp ? h('p.xp__jp', exp.jp) : null, h('p.xp__kicker', exp.kicker || ''), h('h2.xp__name', exp.title), h('div.xp__rule'));
    this.about.hidden = true;
    this.leaveBtn.classList.toggle('is-key', mode === 'interactive');
    this.el.hidden = false;
    this.el.dataset.mode = mode;
    this.el.dataset.kind = kind;
    this.el.classList.toggle('is-barred', kind === 'film');
    this.fade.classList.add('is-on');
    await wait(60);
    this.el.classList.add('is-open');
    this.title.classList.add('is-on');
  }

  _setLabel(level, text) { mount(this.label, h('span.xp__dot', { 'data-level': level }), h('span', text), icon('info', 14)); }

  /** Lift the stage away: the map comes back into focus underneath as it goes. */
  async _lower() {
    this._resolve = null;
    this.el.classList.remove('is-open', 'is-live', 'is-idle');
    this.title.classList.remove('is-on');
    this.leaveBtn.classList.remove('is-ready');
    document.body.classList.remove('xp-approach');
    await wait(520);
    this.el.hidden = true;
    this.el.classList.remove('is-barred');
    this.fade.classList.remove('is-on');
    this.hint.textContent = '';
    mount(this.stage);
    this.atlas.showPulse(null);
    this.film = null;
    this._needTap = false;
    this._gain = 1;
    this.active = false;
  }

  /* ── Films ──────────────────────────────────────────────────────────── */

  /** Start fetching a film (once). Resolves with blob: URLs; `video` is null when there is no footage to play. */
  _filmSources(exp) {
    if (!this._films.has(exp.id)) {
      const url = async (src) => { if (!src) return null; try { return URL.createObjectURL(await this.media(src)); } catch (err) { return null; } };
      const job = Promise.all([url(exp.film && exp.film.src), url(exp.film && exp.film.poster)]).then(([video, poster]) => {
        if (!video) this._films.delete(exp.id);      // not there (yet), or offline: look again next time
        return { video, poster };
      });
      this._films.set(exp.id, job);
    }
    return this._films.get(exp.id);
  }

  /** The real photographs that stand in for a film. */
  async _stills(exp) {
    const list = await Promise.all((exp.stills || []).map(async (s) => { try { return { ...s, url: URL.createObjectURL(await this.media(s.src)) }; } catch (err) { return null; } }));
    return list.filter(Boolean);
  }

  async _runFilm(exp, { mode, descend, leaveLabel, covered }) {
    this.active = true;
    this._skip = false;
    this._needTap = false;
    this._gain = 0;
    const narrow = window.innerWidth < 560;
    mount(this.leaveBtn, narrow ? 'Return' : leaveLabel, icon('chevronR', 15));
    this.leaveBtn.setAttribute('aria-label', leaveLabel);
    this.walkBtn.hidden = true;
    this.hint.textContent = '';
    this.hint.classList.remove('is-off');
    let player = null, raf = 0, stillUrls = [];

    try {
      // 1–2. the footage starts downloading while the map comes down to the place
      const sources = this._filmSources(exp);
      await this._approach(exp.viewpoint, descend);

      // 3. the title, over a closing curtain
      await this._raise(exp, mode, 'film');
      const [src] = await Promise.all([sources, wait(1500)]);

      // 4. the footage; or, when there is none on this device, real photographs of the same view
      if (src.video) { try { player = await createFilmPlayer({ url: src.video, poster: src.poster, focus: exp.film.focus }); } catch (err) { player = null; } }
      const useStills = async () => {
        if (player) player.dispose();
        const stills = await this._stills(exp);
        stillUrls = stills.map((s) => s.url);
        return stills.length ? createStillsPlayer({ stills }) : null;
      };
      if (!player) player = await useStills();
      if (!player) { this.toast('This film is not on this device yet, so the journey carries on without it.'); return { played: false }; }

      const done = new Promise((resolve) => { this._resolve = resolve; });
      if (this._skip) this._finish();                    // Esc was pressed while it was still loading
      const show = (p) => {
        mount(this.stage, p.el);
        this.film = p;
        const real = p.kind === 'stills';
        this._setLabel(real ? 'real' : exp.accuracy.level, real ? 'Real photographs' : (exp.accuracy.label || ACCURACY[exp.accuracy.level]));
        mount(this.about, h('p.xp__about-k', real ? 'Real photographs' : ACCURACY[exp.accuracy.level]),
          h('p', real ? 'The film for this moment is not on this device, or it could not be played here. These are real photographs of the same view, taken by other travellers.' : exp.accuracy.text),
          h('ul.xp__credits', (real ? (exp.stills || []).map((s) => s.credit) : (exp.attribution || [])).map((line) => h('li', line))));
        p.on('play', () => this._syncButtons());
        p.on('pause', () => { this._wake(); this._syncButtons(); });
        p.on('ended', () => { if (mode === 'cinematic') this._finish(); else { this.leaveBtn.classList.add('is-ready'); this._wake(); } });
      };
      show(player);
      let started = await player.play();
      if (started === false && player.kind === 'film') { player = await useStills(); if (player) { show(player); started = await player.play(); } }
      if (!player || started === false) { this.toast('This device could not play the film, so the journey carries on without it.'); return { played: false }; }
      this._needTap = started === 'muted' && this.store.get().xpSound !== false;
      this._applySound();

      // 5. the curtain lifts on the first frame, held still, so none of the film is spent behind it;
      //    the letterboxed frame then opens to the full screen
      if (player.kind === 'film') { player.pause(); player.el.currentTime = 0; }
      this.fade.classList.remove('is-on');
      setTimeout(() => { if (this.film === player && this._resolve) { player.play(); this._ramp(0, 1, 900); } }, player.kind === 'film' ? 700 : 0);
      setTimeout(() => this.el.classList.remove('is-barred'), 500);
      setTimeout(() => this.title.classList.remove('is-on'), 900);
      setTimeout(() => { if (this.active) { this.el.classList.add('is-live'); this._wake(); } }, 1700);
      const bar = this.progress.firstChild;
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const d = player.duration;
        bar.style.transform = `scaleX(${d ? clamp(player.time / d, 0, 1) : 0})`;
        const resting = !player.paused && !player.ended && this.about.hidden && !this._needTap && !this.controls.matches(':hover') && performance.now() - this._seen > 2800;
        if (resting) this.el.classList.add('is-idle');
      };
      raf = requestAnimationFrame(tick);
      await done;

      // 6. back to the atlas
      this.el.classList.add('is-barred');
      this.fade.classList.add('is-on');
      await this._ramp(this._gain ?? 1, 0, 800);
      player.pause();
      await wait(150);
      if (covered) covered();          // the map is put back where it was while nothing can be seen
      return { played: true, kind: player.kind };
    } catch (err) {
      console.error(err);
      this.toast('This device could not show the film, so the journey carries on without it.');
      return { played: false, error: true };
    } finally {
      cancelAnimationFrame(raf);
      if (document.fullscreenElement === this.el) document.exitFullscreen().catch(() => {});
      await this._lower();
      if (player) player.dispose();
      for (const u of stillUrls) URL.revokeObjectURL(u);
    }
  }
}
