/* Shared building blocks for immersive scenes: maths, sky, sun position,
   shader noise and a small procedural sound engine. Nothing here knows about
   any particular trip. */

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { const x = clamp(t); return x * x * (3 - 2 * x); };
export const ramp = (t, a, b) => smooth((t - a) / (b - a));

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function decodeU16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint16Array(bytes.buffer);
}

/** Interpolate between colour keyframes [[position, '#hex'], …]. */
export function gradient(THREE, keys, x) {
  const out = new THREE.Color();
  if (x <= keys[0][0]) return out.set(keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) return out.set(keys[i - 1][1]).lerp(new THREE.Color(keys[i][1]), (x - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
  }
  return out.set(keys[keys.length - 1][1]);
}

/* ── Sun position (NOAA low-precision; good to a fraction of a degree) ── */
export function solarPosition(dateUTC, lat, lon) {
  const rad = Math.PI / 180;
  const start = Date.UTC(dateUTC.getUTCFullYear(), 0, 0);
  const day = (dateUTC - start) / 86400000;
  const g = (2 * Math.PI / 365) * (day - 1 + (dateUTC.getUTCHours() - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const minutes = dateUTC.getUTCHours() * 60 + dateUTC.getUTCMinutes() + dateUTC.getUTCSeconds() / 60;
  const ha = ((minutes + eqTime + 4 * lon) / 4 - 180) * rad;
  const cosZen = Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(clamp(cosZen, -1, 1));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat * rad) - Math.tan(decl) * Math.cos(lat * rad)) / rad + 180;
  return { altitude: 90 - zen / rad, azimuth: (az + 360) % 360 };
}

/** The morning moment (UTC) at which the sun reaches a given altitude on a local date, and its azimuth then. */
export function sunAtAltitude(isoDate, lat, lon, altitude, utcOffsetHours = 9) {
  const [y, m, d] = isoDate.split('-').map(Number);
  let lo = Date.UTC(y, m - 1, d, 0 - utcOffsetHours + 1), hi = Date.UTC(y, m - 1, d, 12 - utcOffsetHours);   // 1 AM … noon, local
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (solarPosition(new Date(mid), lat, lon).altitude < altitude) lo = mid; else hi = mid;
  }
  const when = new Date((lo + hi) / 2);
  const local = new Date(when.getTime() + utcOffsetHours * 3600000);
  return { ...solarPosition(when, lat, lon), localTime: `${local.getUTCHours()}:${String(local.getUTCMinutes()).padStart(2, '0')}` };
}

/** Unit vector toward a compass bearing and altitude, in scene axes (x east, y up, z south). */
export function skyVector(THREE, azimuthDeg, altitudeDeg) {
  const a = azimuthDeg * Math.PI / 180, h = altitudeDeg * Math.PI / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h));
}

export const NOISE_GLSL = /* glsl */`
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), f.x), mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

/** A sky dome: vertical gradient, a glow toward the sun, optional stars and thin cloud. */
export function skyDome(THREE, radius = 60000) {
  const uniforms = {
    top: { value: new THREE.Color('#5b86c4') }, horizon: { value: new THREE.Color('#dfe9f2') }, glow: { value: new THREE.Color('#ffd9a8') },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, glowAmt: { value: 0.6 }, stars: { value: 0 }, clouds: { value: 0 }, time: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `${NOISE_GLSL}
      uniform vec3 top, horizon, glow, sunDir; uniform float glowAmt, stars, clouds, time; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.55));
        float toSun = max(dot(normalize(vec3(d.x, 0.0, d.z) + vec3(0.0, 0.0001, 0.0)), normalize(vec3(sunDir.x, 0.0, sunDir.z) + vec3(0.0, 0.0001, 0.0))), 0.0);
        col += glow * glowAmt * pow(toSun, 3.0) * pow(1.0 - h, 3.0);
        if (clouds > 0.0) {
          vec2 uv = d.xz / max(d.y + 0.18, 0.05);
          float c = fbm(uv * 0.9 + vec2(time * 0.006, 0.0));
          c = smoothstep(0.52, 0.86, c) * clouds * smoothstep(0.02, 0.3, d.y);
          col = mix(col, vec3(1.0, 0.99, 0.97), c * 0.75);
        }
        if (stars > 0.0) {
          vec2 g = floor(d.xz / (abs(d.y) + 0.35) * 190.0);
          float s = step(0.9965, hash21(g)) * smoothstep(0.05, 0.4, d.y);
          col += vec3(0.9, 0.93, 1.0) * s * stars * (0.6 + 0.4 * sin(time * 2.0 + hash21(g + 3.0) * 30.0));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, uniforms };
}

/* ── Procedural sound ───────────────────────────────────────────────────
   Every sound is synthesised in the browser: filtered noise for wind, water
   and rolling stock, short tone sweeps for birds. No recordings are used. */
export function createAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  let ctx;
  try { ctx = new Ctx(); } catch (err) { return null; }
  const master = ctx.createGain();
  master.gain.value = 0;
  const tone = ctx.createBiquadFilter();           // lets a scene muffle everything (a tunnel, say)
  tone.type = 'lowpass'; tone.frequency.value = 18000;
  master.connect(tone).connect(ctx.destination);

  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const timers = new Set();
  const nodes = new Set();
  let level = 0.5, on = true;

  const noise = (type, freq, q, gain) => {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = 0.6 + Math.random() * 0.8;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(master); src.start();
    nodes.add(src);
    return { src, filter: f, gain: g };
  };
  const swell = (param, base, depth, period) => {   // slow random breathing of a level
    const tick = () => { const t = ctx.currentTime; param.cancelScheduledValues(t); param.setTargetAtTime(base + (Math.random() * 2 - 1) * depth, t, period / 3); };
    tick(); const id = setInterval(tick, period * 1000); timers.add(id);
  };
  const chirp = (f0, f1, dur, vol, when = 0, pan = 0) => {
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; o.connect(g).connect(p).connect(master); } else o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  };
  const every = (min, max, fn) => { const go = () => { fn(); const id = setTimeout(go, (min + Math.random() * (max - min)) * 1000); timers.add(id); }; const id = setTimeout(go, (0.5 + Math.random() * max) * 1000); timers.add(id); };
  const birds = (density) => {
    every(2.5 / density, 7 / density, () => {   // small songbird: a few quick upward notes
      const pan = Math.random() * 1.6 - 0.8, base = 2600 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) chirp(base * (1 + i * 0.04), base * (1.18 + Math.random() * 0.2), 0.07 + Math.random() * 0.05, 0.035, i * 0.13, pan);
    });
    every(9 / density, 20 / density, () => {    // a long rising whistle, then a quick three-note tumble
      const pan = Math.random() * 1.4 - 0.7;
      chirp(1250, 1900, 0.95, 0.05, 0, pan); chirp(2600, 3300, 0.09, 0.05, 1.02, pan); chirp(3300, 2300, 0.1, 0.05, 1.13, pan); chirp(2500, 2900, 0.16, 0.045, 1.25, pan);
    });
  };

  const beds = {
    forest() {
      const wind = noise('lowpass', 420, 0.3, 0.16); swell(wind.gain.gain, 0.16, 0.09, 4.5);
      const leaves = noise('bandpass', 3200, 0.5, 0.035); swell(leaves.gain.gain, 0.035, 0.03, 3.1);
      birds(1);
    },
    lakeside() {
      const air = noise('lowpass', 300, 0.3, 0.07); swell(air.gain.gain, 0.07, 0.03, 6);
      const lap = noise('bandpass', 700, 0.8, 0.0); // water against the shore: slow swells
      every(2.4, 4.2, () => { const t = ctx.currentTime; lap.gain.gain.cancelScheduledValues(t); lap.gain.gain.setTargetAtTime(0.07 + Math.random() * 0.05, t, 0.5); lap.gain.gain.setTargetAtTime(0.004, t + 1.1, 0.7); });
      birds(0.55);
    },
    train() {
      noise('lowpass', 110, 0.4, 0.5);                       // the body of the carriage
      const rush = noise('bandpass', 900, 0.4, 0.07); swell(rush.gain.gain, 0.07, 0.02, 2.5);
      noise('highpass', 3800, 0.3, 0.012);                   // air over the windows
      const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 87;
      const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 260;
      const hg = ctx.createGain(); hg.gain.value = 0.035; hum.connect(hf).connect(hg).connect(master); hum.start(); nodes.add(hum);
    },
  };

  return {
    ctx,
    start(bed, lvl = 0.5) { level = lvl; if (ctx.state === 'suspended') ctx.resume().catch(() => {}); if (beds[bed]) beds[bed](); master.gain.setTargetAtTime(on ? level : 0, ctx.currentTime, 0.8); },
    setOn(v) { on = v; master.gain.setTargetAtTime(on ? level : 0, ctx.currentTime, 0.25); },
    duck(v) { master.gain.setTargetAtTime(on ? level * v : 0, ctx.currentTime, 0.3); },
    muffle(amount) { tone.frequency.setTargetAtTime(lerp(18000, 500, clamp(amount)), ctx.currentTime, 0.12); },
    /** a passing object: a short band of noise that sweeps by */
    whoosh(vol = 0.2, dur = 0.22) {
      const t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(1700, t + dur * 0.5); f.frequency.exponentialRampToValueAtTime(380, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(master); src.start(t, Math.random() * 2); src.stop(t + dur + 0.05);
    },
    /** a footfall on earth and litter */
    step(vol = 0.11) {
      const t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 900; f.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      src.connect(f).connect(g).connect(master); src.start(t, Math.random() * 2); src.stop(t + 0.2);
    },
    stop() {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      for (const id of timers) { clearInterval(id); clearTimeout(id); }
      timers.clear();
      setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch (err) { /* already stopped */ } } nodes.clear(); ctx.close().catch(() => {}); }, 900);
    },
  };
}
