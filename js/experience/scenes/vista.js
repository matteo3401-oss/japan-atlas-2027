/* Scene type "vista": a true-scale landscape seen from a shore at dawn.

   The land is a heightfield of real elevation data. The sun follows its real
   path for the configured date and place. Mist, water, snow patches and colour
   are simulated. First light reaches the highest ground first, as it does in
   life, then works its way down the mountain. */

import { clamp, lerp, ramp, smooth, decodeU16, gradient, sunAtAltitude, skyVector, skyDome, NOISE_GLSL } from '../kit.js';

const EARTH = 6371000;

export async function create({ THREE, renderer, config, asset, quality }) {
  const A = asset, cfg = config;
  const heights = decodeU16(A.heights);
  const lat0 = A.viewpoint.lat, lon0 = A.viewpoint.lon;
  const mx = 111320 * Math.cos(lat0 * Math.PI / 180), mz = 110574;
  const lake = A.lakeLevel;

  /* ── Land ── */
  const { cols, rows } = A;
  const pos = new Float32Array(cols * rows * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let h = heights[i] / 8;
      if (h < lake + 1.6) h = lake - 40;                      // the lake bed: the data records the water surface, not the bottom
      pos[i * 3] = A.xs[c];
      pos[i * 3 + 1] = h;
      pos[i * 3 + 2] = A.zs[r];
    }
  }
  const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) { const a = r * cols + c; index.set([a, a + cols, a + 1, a + 1, a + cols, a + cols + 1], k); k += 6; }
  const landGeo = new THREE.BufferGeometry();
  landGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  landGeo.setIndex(new THREE.BufferAttribute(index, 1));
  landGeo.computeVertexNormals();

  const U = {
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() }, sunAmt: { value: 0 }, ambient: { value: new THREE.Color() },
    haze: { value: new THREE.Color() }, hazeDensity: { value: 0.00005 }, terminator: { value: 1e6 }, snowline: { value: cfg.effects.snowline || 3300 },
    lake: { value: lake }, camPos: { value: new THREE.Vector3() }, time: { value: 0 },
    peak: { value: new THREE.Vector2((A.target.lon - lon0) * mx, -(A.target.lat - lat0) * mz) },
  };
  const landMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: 'varying vec3 vPos; varying vec3 vN; void main(){ vPos = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${NOISE_GLSL}
      uniform vec3 sunDir, sunColor, ambient, haze, camPos; uniform vec2 peak; uniform float sunAmt, hazeDensity, terminator, snowline, lake;
      varying vec3 vPos; varying vec3 vN;
      void main(){
        vec3 N = normalize(vN);
        float h = vPos.y;
        float n1 = fbm(vPos.xz * 0.0011), n2 = fbm(vPos.xz * 0.0052 + 31.0);
        vec3 forest = mix(vec3(0.060, 0.105, 0.070), vec3(0.095, 0.150, 0.085), n2);
        vec3 scree = mix(vec3(0.300, 0.215, 0.190), vec3(0.230, 0.200, 0.200), n1);
        vec3 col = mix(forest, scree, smoothstep(1500.0, 2550.0, h + (n1 - 0.5) * 520.0));
        // lingering early-summer snow: streaks in the gullies near the top, not a full cap
        float streak = fbm(vec2(atan(vPos.z - peak.y, vPos.x - peak.x) * 22.0, h * 0.0022));   // radial, like gullies running down from the summit
        float snow = smoothstep(snowline - 260.0, snowline + 330.0, h + (streak - 0.5) * 760.0) * smoothstep(0.40, 0.62, streak + (h - snowline) * 0.0006);
        col = mix(col, vec3(0.90, 0.93, 0.97), snow * 0.9);
        if (h < lake) col = vec3(0.020, 0.035, 0.050);
        float lit = smoothstep(terminator - 90.0, terminator + 320.0, h);
        float ndl = max(dot(N, sunDir), 0.0);
        float wrap = max(dot(N, sunDir) * 0.5 + 0.5, 0.0);
        vec3 light = ambient * (0.42 + 0.58 * N.y) + sunColor * sunAmt * lit * (ndl * 1.25 + wrap * 0.22);
        col *= light;
        col += snow * sunColor * sunAmt * lit * ndl * 0.35;          // snow catches the first light
        float d = distance(camPos, vPos);
        float f = 1.0 - exp(-d * hazeDensity);
        f *= mix(1.0, 0.55, smoothstep(lake + 300.0, lake + 2600.0, h));   // haze lies low; the summit stands clear of it
        col = mix(col, haze, clamp(f, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const land = new THREE.Mesh(landGeo, landMat);
  /* ── Sky ── */
  const sky = skyDome(THREE, 90000);

  /* ── Camera: on the water just off the shore, facing the mountain ── */
  const camBase = new THREE.Vector3((A.camera.lon - lon0) * mx, 0, -(A.camera.lat - lat0) * mz);
  const toTarget = new THREE.Vector3((A.target.lon - lon0) * mx, 0, -(A.target.lat - lat0) * mz).sub(camBase);
  const dist = toTarget.length();
  const dir = toTarget.clone().normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const camera = new THREE.PerspectiveCamera(cfg.camera.fov || 36, 1, 4, 140000);
  const baseYaw = Math.atan2(dir.x, -dir.z);            // heading as a rotation about +y from "north" (−z)
  const summitAngle = Math.atan2(A.target.elevation - lake, dist);

  /* ── Water with a planar reflection ── */
  const reflRT = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
  const mirror = camera.clone();
  const W = { tRefl: { value: reflRT.texture }, res: { value: new THREE.Vector2(1, 1) }, time: U.time, deep: { value: new THREE.Color() }, camPos: U.camPos, haze: U.haze, hazeDensity: U.hazeDensity };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: W,
    vertexShader: 'varying vec3 vPos; void main(){ vPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }',
    fragmentShader: `${NOISE_GLSL}
      uniform sampler2D tRefl; uniform vec2 res; uniform float time, hazeDensity; uniform vec3 deep, camPos, haze; varying vec3 vPos;
      void main(){
        vec2 uv = gl_FragCoord.xy / res;
        float d = distance(camPos, vPos);
        vec2 rip = vec2(fbm(vPos.xz * 0.06 + vec2(time * 0.22, 0.0)), fbm(vPos.xz * 0.05 - vec2(0.0, time * 0.18))) - 0.5;
        float near = exp(-d / 700.0);
        vec3 refl = texture2D(tRefl, vec2(uv.x, 1.0 - uv.y) + rip * vec2(0.006 + 0.03 * near, 0.012 + 0.07 * near)).rgb;
        float fres = mix(0.50, 0.97, smoothstep(0.0, 2200.0, d));
        vec3 col = mix(deep, refl, fres);
        col += (fbm(vPos.xz * 0.35 + time * 0.5) - 0.5) * 0.03 * near;
        float f = 1.0 - exp(-d * hazeDensity);
        col = mix(col, haze, clamp(f, 0.0, 1.0) * 0.8);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  water.position.y = lake;

  /* ── Mist: low banks over the water, and a veil that parts to reveal the mountain ── */
  const M = { amt: { value: 1 }, time: U.time, tint: U.haze, reveal: { value: 0 } };
  const bankMat = (seed) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { ...M, seed: { value: seed } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${NOISE_GLSL}
      uniform float amt, time, seed; uniform vec3 tint; varying vec2 vUv;
      void main(){
        float n = fbm(vec2(vUv.x * 5.0 + time * 0.012 + seed, vUv.y * 1.6 + seed * 3.0));
        float a = smoothstep(0.30, 0.85, n) * smoothstep(0.0, 0.16, vUv.y) * (1.0 - smoothstep(0.30, 1.0, vUv.y)) * smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
        gl_FragColor = vec4(tint * 1.08 + 0.03, a * amt);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const banks = new THREE.Group();
  const bankCount = quality === 'low' ? 4 : 7;
  for (let i = 0; i < bankCount; i++) {
    const d = 700 + i * (quality === 'low' ? 2300 : 1350);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(d * 2.4, 130 + d * 0.045), bankMat(i * 7.3));
    m.position.copy(camBase).addScaledVector(dir, d).addScaledVector(side, (i % 2 ? 1 : -1) * d * 0.12);
    m.position.y = lake + (130 + d * 0.045) * 0.42;
    m.lookAt(camBase.x, m.position.y, camBase.z);
    banks.add(m);
  }
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, uniforms: M,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `${NOISE_GLSL}
      uniform float reveal, time; uniform vec3 tint; varying vec2 vUv;
      void main(){
        float n = fbm(vUv * vec2(2.6, 1.9) + vec2(time * 0.016, -time * 0.006)) + (1.0 - vUv.y) * 0.22;
        float th = mix(-0.25, 1.25, reveal);
        float a = smoothstep(th - 0.20, th + 0.20, n);
        gl_FragColor = vec4(tint * 1.05 + 0.02, a * 0.97);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  veil.frustumCulled = false;
  veil.renderOrder = 20;

  const scene = new THREE.Scene();
  scene.add(sky.mesh, land, water, banks, veil);

  /* ── Sun: its real azimuth at the start and end altitudes of the sequence ── */
  const sun0 = sunAtAltitude(cfg.light.date, lat0, lon0, cfg.light.from);
  const sun1 = sunAtAltitude(cfg.light.date, lat0, lon0, cfg.light.to);
  const size = new THREE.Vector2();

  function update({ t, look }) {
    const u = clamp(t / cfg.duration);
    U.time.value = t;
    const alt = lerp(cfg.light.from, cfg.light.to, u);
    const az = lerp(sun0.azimuth, sun1.azimuth, u);
    U.sunDir.value.copy(skyVector(THREE, az, Math.max(alt, 1.5)));       // direction of the light on lit slopes
    sky.uniforms.sunDir.value.copy(skyVector(THREE, az, alt));
    U.sunColor.value.copy(gradient(THREE, [[-3, '#ff5f3e'], [-0.5, '#ff8a55'], [2.5, '#ffc48e'], [7, '#fff0da']], alt));
    U.sunAmt.value = ramp(alt, -2.6, 5) * 2.6;
    U.ambient.value.copy(gradient(THREE, [[-8, '#141c33'], [-4.5, '#34406a'], [-1.5, '#6a7397'], [2.5, '#8f9db6'], [7, '#9fb0c8']], alt)).multiplyScalar(0.9);
    U.haze.value.copy(gradient(THREE, [[-8, '#111830'], [-4.5, '#454a6c'], [-1.5, '#a58f9c'], [1.5, '#dcc3b4'], [7, '#d3dfea']], alt));
    U.hazeDensity.value = lerp(0.000075, 0.000030, u) * (0.6 + (cfg.light.haze || 0.6));
    U.terminator.value = alt < 1 ? EARTH * (1 / Math.cos((alt - 1) * Math.PI / 180) - 1) : -1e5;
    sky.uniforms.top.value.copy(gradient(THREE, [[-8, '#070b1c'], [-5, '#131e44'], [-2, '#2a427c'], [1.5, '#4d7cbd'], [7, '#69a0db']], alt));
    sky.uniforms.horizon.value.copy(gradient(THREE, [[-8, '#161e38'], [-5, '#514a6c'], [-2.5, '#c08a7c'], [0, '#f0b58a'], [3, '#f5dbc1'], [7, '#e2ebf3']], alt));
    sky.uniforms.glow.value.copy(gradient(THREE, [[-8, '#33253f'], [-4, '#ff7e52'], [0, '#ffae6c'], [7, '#ffe8c6']], alt));
    sky.uniforms.glowAmt.value = lerp(0.35, 0.8, ramp(alt, -7, 0));
    sky.uniforms.stars.value = cfg.effects.stars ? 1 - ramp(alt, -7.2, -3.4) : 0;
    sky.uniforms.time.value = t;
    W.deep.value.copy(U.haze.value).multiplyScalar(0.28);
    M.reveal.value = cfg.effects.mist ? ramp(u, 0.07, 0.52) : 1;
    M.amt.value = cfg.effects.mist ? lerp(0.95, 0.30, ramp(u, 0.25, 0.95)) : 0;

    // camera: rises from the water to the mountain, and eases forward
    const rise = smooth(ramp(u, 0.0, 0.62));
    camera.fov = lerp((cfg.camera.fov || 36) + 5, cfg.camera.fov || 36, rise);
    camera.position.copy(camBase).addScaledVector(dir, 30 * smooth(u)).addScaledVector(side, 24 * smooth(u));   // a slow drift, staying over the water
    camera.position.y = lake + (cfg.camera.eye || 6);
    const pitch = lerp(-0.045, summitAngle * 0.56, rise) + look.pitch * Math.PI / 180;
    const yaw = baseYaw + look.yaw * Math.PI / 180;
    camera.rotation.set(pitch, -yaw, 0, 'YXZ');
    camera.updateProjectionMatrix();
    U.camPos.value.copy(camera.position);
    sky.mesh.position.copy(camera.position);
  }

  function render() {
    if (cfg.effects.reflection !== false) {
      // mirror the camera in the water plane and draw what the lake would reflect
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      mirror.fov = camera.fov; mirror.aspect = camera.aspect; mirror.near = camera.near; mirror.far = camera.far;
      mirror.position.set(camera.position.x, 2 * lake - camera.position.y, camera.position.z);
      mirror.up.set(0, 1, 0);
      mirror.lookAt(mirror.position.x + fwd.x, mirror.position.y - fwd.y, mirror.position.z + fwd.z);
      mirror.updateProjectionMatrix();
      mirror.updateMatrixWorld();
      water.visible = false; veil.visible = false; banks.visible = false;
      sky.mesh.position.copy(mirror.position);
      renderer.setRenderTarget(reflRT);
      renderer.render(scene, mirror);
      renderer.setRenderTarget(null);
      sky.mesh.position.copy(camera.position);
      water.visible = true; veil.visible = true; banks.visible = true;
    }
    renderer.render(scene, camera);
  }

  function resize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(size);
    W.res.value.copy(size);
    const s = quality === 'low' ? 0.4 : 0.6;
    reflRT.setSize(Math.max(4, Math.round(size.x * s)), Math.max(4, Math.round(size.y * s)));
  }

  function dispose() {
    reflRT.dispose();
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  return {
    update, render, resize, dispose,
    facts: [`Sun: rises at ${sun1.azimuth.toFixed(0)}° on this date; the sequence runs from about ${sun0.localTime} to ${sun1.localTime} local time.`, `Distance to the summit: ${A.distanceKm.toFixed(1)} km.`],
  };
}
