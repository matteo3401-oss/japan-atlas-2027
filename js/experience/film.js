/* ════════════════════════════════════════════════════════════════════════
   Film players for the experience director.

   A "film" experience is a piece of footage played full screen. Two players
   share one small interface, so the director does not care which it has:

     createFilmPlayer    the footage itself (a <video>)
     createStillsPlayer  real photographs, shown slowly one after another.
                         This is what plays when the footage is missing or
                         the device cannot play it. Never a 3D stand-in.

     { kind, el, time, duration, paused, ended,
       play() → true | 'muted' | false, pause(), replay(), setSound(volume, on),
       on(type, fn)   'play' | 'pause' | 'ended',
       dispose() }
   ════════════════════════════════════════════════════════════════════════ */

import { h } from '../lib/dom.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

function settled(target, ok, bad, ms) {
  return new Promise((resolve, reject) => {
    const done = (fn, v) => { clearTimeout(timer); for (const t of ok) target.removeEventListener(t, yes); for (const t of bad) target.removeEventListener(t, no); fn(v); };
    const yes = () => done(resolve);
    const no = () => done(reject, new Error('media failed to load'));
    const timer = setTimeout(() => done(reject, new Error('media timed out')), ms);
    for (const t of ok) target.addEventListener(t, yes);
    for (const t of bad) target.addEventListener(t, no);
  });
}

/** The footage. `url` is a blob: URL (the file is already on the device), so it is seekable everywhere. */
export async function createFilmPlayer({ url, poster = null, focus = null }) {
  const video = h('video.xp__film', { preload: 'auto', playsinline: '', 'webkit-playsinline': '', disablepictureinpicture: '', 'aria-label': 'Film' });
  video.playsInline = true;
  video.controls = false;
  if (poster) video.poster = poster;
  if (focus) video.style.objectPosition = `${focus[0]}% ${focus[1]}%`;
  const ready = settled(video, ['canplay'], ['error'], 9000);
  video.src = url;
  video.load();
  await ready;

  return {
    kind: 'film',
    el: video,
    get time() { return video.currentTime || 0; },
    get duration() { return Number.isFinite(video.duration) ? video.duration : 0; },
    get paused() { return video.paused; },
    get ended() { return video.ended; },
    /** Browsers may refuse sound until the page has been touched: then it starts silent and says so. */
    async play() {
      try { await video.play(); return true; } catch (err) { /* try without sound */ }
      if (!video.muted) { video.muted = true; try { await video.play(); return 'muted'; } catch (err) { /* cannot play at all */ } }
      return false;
    },
    pause() { video.pause(); },
    replay() { video.currentTime = 0; return this.play(); },
    setSound(volume, on) { video.volume = clamp01(volume); video.muted = !on; },
    on(type, fn) { video.addEventListener(type, fn); },
    dispose() { try { video.pause(); video.removeAttribute('src'); video.load(); } catch (err) { /* already gone */ } },
  };
}

/** Real photographs, each held for `each` seconds with a slow drift. `stills`: [{ url, caption, credit }]. */
export async function createStillsPlayer({ stills, each = 6.5 }) {
  const figures = stills.map((s) => h('figure.xp__still',
    h('img', { src: s.url, alt: s.caption || '', draggable: 'false' }),
    h('figcaption', s.caption ? h('b', s.caption) : null, h('span', s.credit || ''))));
  const el = h('div.xp__stills', figures);
  const first = figures[0].querySelector('img');
  if (!first.complete) await settled(first, ['load'], ['error'], 9000);

  const bus = new EventTarget();
  const duration = stills.length * each;
  let t = 0, paused = true, ended = false, raf = 0, last = 0;

  const draw = () => {
    const at = Math.min(stills.length - 1, Math.floor(t / each));
    figures.forEach((f, i) => {
      f.classList.toggle('is-on', i === at);
      if (Math.abs(i - at) > 1) return;
      const p = clamp01((t - i * each) / each);                    // 0 → 1 across this photograph (it keeps drifting while it fades)
      const dir = i % 2 ? -1 : 1;
      f.firstChild.style.transform = `scale(${(1.06 + 0.07 * p).toFixed(4)}) translate3d(${(dir * (1.4 - 2.8 * p)).toFixed(3)}%, ${(-0.6 * p).toFixed(3)}%, 0)`;
    });
  };
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (paused || ended) return;
    t = Math.min(duration, t + dt);
    draw();
    if (t >= duration) { ended = true; paused = true; bus.dispatchEvent(new Event('pause')); bus.dispatchEvent(new Event('ended')); }
  };
  draw();

  return {
    kind: 'stills',
    el,
    get time() { return t; },
    get duration() { return duration; },
    get paused() { return paused; },
    get ended() { return ended; },
    async play() {
      if (ended) { t = 0; ended = false; }
      paused = false;
      last = performance.now();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
      bus.dispatchEvent(new Event('play'));
      return true;
    },
    pause() { if (!paused) { paused = true; bus.dispatchEvent(new Event('pause')); } },
    replay() { t = 0; ended = false; draw(); return this.play(); },
    setSound() { /* photographs are silent */ },
    on(type, fn) { bus.addEventListener(type, fn); },
    dispose() { cancelAnimationFrame(raf); },
  };
}
