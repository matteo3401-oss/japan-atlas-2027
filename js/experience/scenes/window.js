/* Scene type "window": the view from a seat on a fast train.

   One thing here is real: the far skyline. It is the horizon profile computed
   from elevation data for the exact point on the line, so the mountain has its
   true shape and size. Everything nearer is invented scenery, laid out in true
   3D and moved past at the train's real speed so the parallax is honest. */

import { clamp, lerp, ramp, smooth, rng, skyDome, skyVector, NOISE_GLSL } from '../kit.js';

export async function create({ THREE, renderer, config, asset, quality, audio }) {
  const A = asset, cfg = config, fx = cfg.effects || {};
  const rand = rng(1964);
  const low = quality === 'low';
  const v = (fx.speedKmh || 285) / 3.6;              // metres per second
  const eyeH = 13;                                    // viaduct height above the fields
  const RANGE = 2400;                                 // scenery is recycled this far ahead and behind
  const haze = new THREE.Color('#c9d8e6');
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(haze.getHex(), 500, 10500);
  scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x55604a, 1.5));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
  sun.position.copy(skyVector(THREE, 150, 62));
  scene.add(sun);

  const sky = skyDome(THREE, 60000);
  sky.uniforms.top.value.set('#5d92cf'); sky.uniforms.horizon.value.set('#d8e4ee'); sky.uniforms.glow.value.set('#ffffff');
  sky.uniforms.glowAmt.value = 0.12; sky.uniforms.clouds.value = fx.clouds ?? 0.5; sky.uniforms.sunDir.value.copy(sun.position);
  scene.add(sky.mesh);

  /* ── The real skyline ── */
  const viewAz = A.headingOfTravel + 90;             // straight out of the right-hand window
  const R = 30000, n = A.angles.length;
  const sp = new Float32Array(n * 2 * 3), sa = new Float32Array(n * 2), sv = new Float32Array(n * 2), si = [];
  for (let i = 0; i < n; i++) {
    const rel = (A.az0 + i * A.step - viewAz) * Math.PI / 180, ang = A.angles[i] / 100;
    const x = Math.sin(rel) * R, z = -Math.cos(rel) * R;
    sp.set([x, -400, z, x, Math.tan(ang * Math.PI / 180) * R, z], i * 6);
    sa.set([ang, ang], i * 2); sv.set([0, 1], i * 2);
    if (i) { const a = (i - 1) * 2; si.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const skyGeo = new THREE.BufferGeometry();
  skyGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  skyGeo.setAttribute('ang', new THREE.BufferAttribute(sa, 1));
  skyGeo.setAttribute('v', new THREE.BufferAttribute(sv, 1));
  skyGeo.setIndex(si);
  const skyline = new THREE.Mesh(skyGeo, new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: false, uniforms: { haze: { value: haze }, peak: { value: A.peakAngle } },
    vertexShader: 'attribute float ang; attribute float v; varying float vAng; varying float vV; varying vec3 vP; void main(){ vAng = ang; vV = v; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${NOISE_GLSL}
      uniform vec3 haze; uniform float peak; varying float vAng; varying float vV; varying vec3 vP;
      void main(){
        float e = vAng * vV;                                     // elevation angle of this fragment, degrees
        vec3 far = mix(vec3(0.55, 0.66, 0.79), vec3(0.33, 0.44, 0.61), smoothstep(0.0, peak, e));
        vec3 col = mix(haze, far, smoothstep(-0.2, 1.6, e) * 0.86);
        // early-summer snow: streaks in the upper gullies of the one summit tall enough to keep it
        float streak = fbm(vec2(vP.x * 0.0011, e * 1.7));
        float snow = smoothstep(peak * 0.80, peak * 0.97, e + (streak - 0.5) * peak * 0.20) * smoothstep(peak * 0.55, peak * 0.9, vAng) * smoothstep(0.42, 0.6, streak + (e - peak * 0.85) * 0.25);
        col = mix(col, vec3(0.97, 0.98, 1.0), snow * 0.85);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  scene.add(skyline);

  /* ── Ground: fields, flooded paddies, lanes; and a river bed where the bridge is ── */
  const G = { dist: { value: 0 }, haze: { value: haze }, river: { value: new THREE.Vector2(1e9, 1) }, time: { value: 0 } };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 40000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: G, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }',
    fragmentShader: `${NOISE_GLSL}
      uniform float dist, time; uniform vec3 haze; uniform vec2 river; varying vec3 vP;
      void main(){
        vec2 w = vec2(vP.x - dist, vP.z);
        vec2 cell = floor(w / vec2(52.0, 74.0)), f = fract(w / vec2(52.0, 74.0));
        float id = hash21(cell), id2 = hash21(cell + 7.7);
        vec3 paddy = mix(vec3(0.42, 0.55, 0.50), vec3(0.62, 0.72, 0.78), 0.55);            // flooded, mirroring the sky
        paddy = mix(paddy, vec3(0.30, 0.50, 0.22), 0.35 + 0.3 * step(0.5, fract(w.y * 0.9)));   // rows of young rice
        vec3 green = mix(vec3(0.24, 0.42, 0.17), vec3(0.36, 0.50, 0.20), id2);
        green *= 0.86 + 0.14 * step(0.5, fract((id2 > 0.5 ? w.x : w.y) / 3.6));            // clipped rows of tea
        vec3 soil = vec3(0.47, 0.40, 0.28);
        vec3 col = id < 0.46 ? paddy : (id < 0.86 ? green : soil);
        float bank = smoothstep(0.0, 0.035, f.x) * smoothstep(1.0, 0.965, f.x) * smoothstep(0.0, 0.03, f.y) * smoothstep(1.0, 0.97, f.y);
        col = mix(vec3(0.33, 0.37, 0.20), col, bank);
        float lane = step(0.985, fract(w.x / 416.0)) + step(0.988, fract(w.y / 592.0));
        col = mix(col, vec3(0.55, 0.55, 0.54), clamp(lane, 0.0, 1.0));
        float patch_ = fbm(w * 0.0016);
        col = mix(col, vec3(0.17, 0.30, 0.15), smoothstep(0.60, 0.72, patch_) * 0.85);      // wooded rises
        // the river: gravel bars and braided channels
        float rx = abs(vP.x - river.x) / river.y;
        if (rx < 1.0) {
          float ch = fbm(vec2(w.x * 0.012, w.y * 0.0025));
          vec3 bed = mix(vec3(0.66, 0.64, 0.58), vec3(0.47, 0.47, 0.43), fbm(w * 0.05));
          vec3 wat = mix(vec3(0.20, 0.38, 0.50), vec3(0.46, 0.63, 0.75), fbm(w * 0.02 + time * 0.4));
          col = mix(col, mix(bed, wat, smoothstep(0.46, 0.56, ch)), smoothstep(1.0, 0.9, rx));
        }
        float d = length(vP.xz);
        col = mix(col, haze, 1.0 - exp(-d * 0.00022));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  ground.position.set(0, -eyeH, -19000);
  scene.add(ground);

  /* ── Things that go by: houses, trees, catenary masts ── */
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  const movers = [];
  const field = (mesh, count, make) => {
    const items = [];
    for (let i = 0; i < count; i++) items.push({ x: (rand() * 2 - 1) * RANGE, ...make(i) });
    mesh.frustumCulled = false;
    scene.add(mesh);
    movers.push({ mesh, items });
    return items;
  };
  const houseCount = low ? 150 : 320;
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial(), houseCount);
  // a gabled roof: ridge along x
  const gable = new THREE.BufferGeometry();
  { const a = [-.5, 0, -.5], b = [.5, 0, -.5], c = [.5, 0, .5], d = [-.5, 0, .5], e = [-.5, 1, 0], f = [.5, 1, 0];
    gable.setAttribute('position', new THREE.Float32BufferAttribute([d, c, f, d, f, e, b, a, e, b, e, f, a, d, e, c, b, f].flat(), 3)); gable.computeVertexNormals(); }
  const roofs = new THREE.InstancedMesh(gable, new THREE.MeshLambertMaterial(), houseCount);
  const wall = ['#e9e4d8', '#d9d2c2', '#f1efe8', '#c9c5ba', '#b9b2a2', '#e4dccb'], tile = ['#39414c', '#4a4f57', '#2f3640', '#5a4a40', '#3b4a5a'];
  const houses = field(bodies, houseCount, (i) => {
    const cluster = Math.floor(rand() * 9);
    const z = -(70 + Math.pow(rand(), 1.8) * 1700), w = 8 + rand() * 7, d = 6 + rand() * 4, hgt = 3.2 + rand() * 3.4;
    bodies.setColorAt(i, tint.set(wall[(rand() * wall.length) | 0]));
    roofs.setColorAt(i, tint.set(tile[(rand() * tile.length) | 0]));
    return { z, w, d, h: hgt, cluster, rot: rand() < 0.5 ? 0 : Math.PI / 2 };
  });
  // gather the houses into villages rather than an even scatter
  for (const hs of houses) hs.x = ((hs.cluster / 9) * 2 - 1) * RANGE + (rand() - 0.5) * 420;
  roofs.frustumCulled = false; scene.add(roofs);
  const treeCount = low ? 140 : 300;
  const blob = new THREE.SphereGeometry(1, 9, 6);
  { const bp = blob.attributes.position; for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i), q = Math.sin(Math.round(x * 30) * 12.9 + Math.round(y * 30) * 78.2 + Math.round(z * 30) * 37.7) * 43758.5, j = 0.8 + (q - Math.floor(q)) * 0.36; bp.setXYZ(i, x * j, y * j, z * j); } blob.computeVertexNormals(); }
  const treeMesh = new THREE.InstancedMesh(blob, new THREE.MeshLambertMaterial(), treeCount);
  // most trees stand with the houses; a band of them runs close to the line, where the speed shows
  field(treeMesh, treeCount, (i) => {
    treeMesh.setColorAt(i, tint.setHSL(0.27 + rand() * 0.07, 0.36, 0.2 + rand() * 0.12, THREE.SRGBColorSpace));
    const near = i % 4 === 0, home = houses[(rand() * houses.length) | 0];
    return near ? { z: -(26 + rand() * 46), s: 1.3 + rand() * 1.5 } : (rand() < 0.6 ? { z: home.z + (rand() - 0.5) * 60, s: 3 + rand() * 4.5, by: home } : { z: -(60 + Math.pow(rand(), 1.6) * 2200), s: 3.5 + rand() * 6 });
  });
  for (const tr of movers[movers.length - 1].items) if (tr.by) tr.x = tr.by.x + (rand() - 0.5) * 90;
  // a line of pylons striding off across the plain
  const pylonMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 4, 3, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0x8a959e, wireframe: true, transparent: true, opacity: 0.75 }), 24);
  const pylons = field(pylonMesh, 24, (i) => ({ z: -(130 + (i % 8) * 290), line: Math.floor(i / 8) }));
  for (const py of pylons) py.x = (py.line - 1) * 1600 + 300 + py.z * 0.22;
  const mastCount = Math.ceil((RANGE * 2) / 50);
  const masts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x5b6470, transparent: true, opacity: 0.3, fog: false }), mastCount);
  if (fx.poles !== false) field(masts, mastCount, (i) => ({ fixed: -RANGE + i * 50 }));

  /* ── The bridge: truss members flicking past, with the river under them ── */
  const [b0, b1] = fx.bridge || [1e9, 1e9];
  const riverX0 = -v * ((b0 + b1) / 2), riverHalf = v * (b1 - b0) / 2;
  const trussCount = Math.ceil((riverHalf * 2) / 9);
  const truss = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x8794a0, transparent: true, opacity: 0.42, fog: false }), Math.max(1, trussCount + 2));
  truss.frustumCulled = false;
  scene.add(truss);

  /* ── The tunnel the scene opens in ── */
  const tunnelEnd = fx.tunnel || 0;
  const tunnel = new THREE.Mesh(new THREE.PlaneGeometry(6000, 60), new THREE.MeshBasicMaterial({ color: 0x0b0c0f, fog: false }));
  tunnel.visible = tunnelEnd > 0;
  scene.add(tunnel);
  const lamps = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.6, 0.22), new THREE.MeshBasicMaterial({ color: 0xffe6b0, fog: false }), 40);
  lamps.frustumCulled = false; lamps.visible = tunnelEnd > 0;
  scene.add(lamps);

  /* ── The parapet outside, and the window itself ── */
  const P = { dist: G.dist };
  const parapet = new THREE.Mesh(new THREE.PlaneGeometry(900, 2.2), new THREE.ShaderMaterial({
    uniforms: P, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${NOISE_GLSL}
      uniform float dist; varying vec2 vUv;
      void main(){
        float x = vUv.x * 900.0 - dist;
        float streak = vnoise(vec2(x * 0.02, vUv.y * 5.0)) * 0.10 + step(0.94, fract(x / 12.5)) * 0.10;
        vec3 col = vec3(0.60, 0.62, 0.63) - streak - (1.0 - vUv.y) * 0.10;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  parapet.position.set(0, -2.25, -2.6);
  scene.add(parapet);

  const frame = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.4), new THREE.ShaderMaterial({
    transparent: true, fog: false, toneMapped: false, uniforms: { shade: { value: 1 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float shade; varying vec2 vP;
      float box(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      void main(){
        float d = box(vP - vec2(0.0, 0.02), vec2(0.60, 0.345), 0.10);
        if (d < -0.012) discard;
        vec3 wallc = vec3(0.86, 0.85, 0.82) * (0.80 + 0.20 * smoothstep(-1.2, 1.2, vP.y)) * shade;
        vec3 gasket = vec3(0.10, 0.10, 0.11);
        vec3 col = mix(gasket, wallc, smoothstep(0.0, 0.012, d));
        col *= 0.78 + 0.22 * smoothstep(0.0, 0.16, d);                 // the reveal is in shadow
        col *= 1.0 - 0.10 * step(0.992, fract(vP.x * 1.6 + 0.3));      // a panel seam
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  frame.position.set(0, 0, -0.82);
  frame.renderOrder = 30;
  frame.material.depthTest = false;
  scene.add(frame);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vUv; void main(){ float g = smoothstep(0.35, 0.0, abs(vUv.x - vUv.y * 0.6 - 0.25)) * 0.05 + smoothstep(0.75, 1.0, vUv.y) * 0.05; gl_FragColor = vec4(vec3(1.0), g); }',
  }));
  glass.position.set(0, 0.02, -0.815);
  glass.renderOrder = 29;
  scene.add(glass);

  const camera = new THREE.PerspectiveCamera(cfg.camera.fov || 50, 1, 0.05, 90000);
  // sit a little forward of the window and look back through it, so the turned head still sees it square-on
  // On an upright phone the window is a narrow slot, so the head turns far enough to keep the summit in it.
  const peakRel = ((A.peakAz - viewAz + 540) % 360) - 180;
  let baseYaw = cfg.camera.yaw || 0, seatX = 0;
  const aim = (portrait) => { baseYaw = portrait ? clamp(peakRel, -32, 32) : (cfg.camera.yaw || 0); seatX = -Math.tan(baseYaw * Math.PI / 180) * 0.82 * 0.92; };
  aim(false);
  let dist = 0, lastBridge = false, wasTunnel = tunnelEnd > 0;
  if (audio && tunnelEnd > 0) audio.muffle(0.85);

  function update({ t, dt, look }) {
    dist = v * t;                                       // position follows the clock, so replay and scrubbing agree
    G.dist.value = dist; G.time.value = t; sky.uniforms.time.value = t;
    const wrap = (x) => ((((x + dist + RANGE) % (2 * RANGE)) + 2 * RANGE) % (2 * RANGE)) - RANGE;

    // houses (and their roofs), trees, masts. Nothing stands in the river bed.
    const riverAt = riverX0 + dist, dry = (x) => (Math.abs(x - riverAt) < riverHalf + 45 ? 0 : 1);
    houses.forEach((hs, i) => {
      const x = wrap(hs.x), on = dry(x);
      dummy.rotation.set(0, hs.rot, 0);
      dummy.position.set(x, -eyeH - (1 - on) * 60, hs.z); dummy.scale.set(hs.w, hs.h, hs.d); dummy.updateMatrix(); bodies.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, -eyeH + hs.h - (1 - on) * 60, hs.z); dummy.scale.set(hs.w * 1.14, hs.d * 0.34, hs.d * 1.18); dummy.updateMatrix(); roofs.setMatrixAt(i, dummy.matrix);
    });
    bodies.instanceMatrix.needsUpdate = true; roofs.instanceMatrix.needsUpdate = true;
    dummy.rotation.set(0, 0, 0);
    movers[1].items.forEach((tr, i) => { const x = wrap(tr.x); dummy.position.set(x, -eyeH + tr.s * 0.7 - (1 - dry(x)) * 60, tr.z); dummy.scale.set(tr.s, tr.s * 0.78, tr.s); dummy.updateMatrix(); treeMesh.setMatrixAt(i, dummy.matrix); });
    treeMesh.instanceMatrix.needsUpdate = true;
    pylons.forEach((py, i) => { dummy.position.set(wrap(py.x), -eyeH, py.z); dummy.scale.set(4.5, 38, 4.5); dummy.updateMatrix(); pylonMesh.setMatrixAt(i, dummy.matrix); });
    pylonMesh.instanceMatrix.needsUpdate = true;
    if (movers[3]) {
      movers[3].items.forEach((m, i) => { dummy.position.set(wrap(m.fixed), -2.5, -4.4); dummy.scale.set(0.55, 11, 0.3); dummy.updateMatrix(); masts.setMatrixAt(i, dummy.matrix); });   // stretched along the track: motion blur
      masts.instanceMatrix.needsUpdate = true;
    }

    // the bridge and its river
    const rx = riverX0 + dist;
    G.river.value.set(rx, riverHalf + 60);
    for (let i = 0; i < truss.count; i++) {
      const x = rx - riverHalf + i * 9;
      dummy.position.set(x, 1.5, -2.9); dummy.rotation.set(0, 0, (i % 2 ? 1 : -1) * 0.62); dummy.scale.set(0.5, 16, 0.4); dummy.updateMatrix();
      truss.setMatrixAt(i, dummy.matrix);
    }
    truss.instanceMatrix.needsUpdate = true;
    dummy.rotation.set(0, 0, 0);
    const onBridge = Math.abs(rx) < riverHalf;
    if (audio && onBridge !== lastBridge) { audio.whoosh(0.3, 0.5); lastBridge = onBridge; }

    // the tunnel: its mouth passes the window at tunnelEnd seconds
    const mouth = -v * tunnelEnd + dist;
    tunnel.position.set(mouth + 3000, 0, -2.4);
    for (let i = 0; i < lamps.count; i++) { dummy.position.set(mouth + 12 + i * 24 - 2.2 * 0, 1.9, -2.38); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); lamps.setMatrixAt(i, dummy.matrix); }
    lamps.instanceMatrix.needsUpdate = true;
    const inTunnel = mouth < 0.5 && tunnelEnd > 0;
    if (wasTunnel && !inTunnel && audio) { audio.muffle(0); audio.whoosh(0.35, 0.6); }
    wasTunnel = inTunnel;
    // eyes adjusting as the train bursts into daylight
    const since = t - tunnelEnd;
    renderer.toneMappingExposure = inTunnel ? 0.85 : lerp(2.3, 1.0, smooth(clamp(since / 1.5)));
    frame.material.uniforms.shade.value = inTunnel ? 0.42 : lerp(0.75, 1.0, smooth(clamp(since / 1.2)));

    // the skyline slides slowly: the true change of bearing over the distance covered
    skyline.rotation.y = -Math.atan2(dist, 26000) + Math.atan2(v * cfg.duration * 0.5, 26000);

    const shake = low ? 0 : 0.0016;
    camera.position.set(seatX - Math.sin(look.yaw * Math.PI / 180) * 0.14 + (Math.sin(t * 31.0) + Math.sin(t * 17.3)) * shake * 0.5, (Math.sin(t * 23.0) + Math.sin(t * 41.7)) * shake, 0);
    camera.rotation.set((cfg.camera.pitch || 0) * Math.PI / 180 + look.pitch * Math.PI / 180, -(baseYaw + look.yaw) * Math.PI / 180, 0, 'YXZ');
    sky.mesh.position.copy(camera.position);
  }

  return {
    update,
    render() { renderer.render(scene, camera); },
    resize(w, h) { camera.aspect = w / h; camera.fov = h > w ? 62 : (cfg.camera.fov || 50); aim(h > w); camera.updateProjectionMatrix(); },
    dispose() { renderer.toneMappingExposure = 1; scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); },
    facts: [`The summit stands ${A.peakAngle.toFixed(1)}° above the horizon from this point on the line, at a bearing of ${Math.round(A.peakAz)}°.`],
  };
}
