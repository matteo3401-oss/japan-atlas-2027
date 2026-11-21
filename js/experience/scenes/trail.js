/* Scene type "trail": a first-person walk along a real footpath.

   The ground is a heightfield of real elevation data and the path is the real
   trail, so the bends and the gradient under your feet are true. Everything
   growing on it (the conifers, ferns, roots across the path, the light and the
   floating dust) is a simulation of a cedar forest, not a survey of this one. */

import { clamp, lerp, smooth, decodeU16, rng } from '../kit.js';

function canvasTexture(THREE, w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}

/** Join simple geometries (position / normal / uv / index) into one. */
function merge(THREE, geos) {
  const pos = [], nor = [], uv = [], idx = [];
  let base = 0;
  for (const g of geos) {
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
    idx.push(...Array.from(g.index.array, (v) => v + base));
    base += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
const hash3 = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); };

export async function create({ THREE, renderer, config, asset, quality, audio }) {
  const A = asset, cfg = config, fx = cfg.effects || {};
  const rand = rng(20270613);
  const low = quality === 'low';
  const { cols, rows, cell } = A;
  const H = decodeU16(A.heights);
  const sizeX = (cols - 1) * cell, sizeZ = (rows - 1) * cell;
  const baseY = (x, z) => {
    const fx_ = clamp(x / cell, 0, cols - 1.001), fz = clamp(z / cell, 0, rows - 1.001);
    const c = Math.floor(fx_), r = Math.floor(fz), dx = fx_ - c, dz = fz - r, i = r * cols + c;
    return (H[i] * (1 - dx) * (1 - dz) + H[i + 1] * dx * (1 - dz) + H[i + cols] * (1 - dx) * dz + H[i + cols + 1] * dx * dz) / 16;
  };

  const scene = new THREE.Scene();
  const mist = new THREE.Color(cfg.light.tint || '#9fb48a');
  scene.background = mist.clone().multiplyScalar(1.12);
  scene.fog = new THREE.FogExp2(mist.getHex(), 0.016 + 0.008 * (cfg.light.haze || 0.7));
  scene.add(new THREE.HemisphereLight(0xd6e6c0, 0x2b2a1c, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0d2, 2.0);
  sun.position.set(-0.35, 1, 0.3);
  scene.add(sun);

  /* ── The path ── */
  const pts = [];
  for (let i = 0; i < A.path.length; i += 3) pts.push(new THREE.Vector3(A.path[i][0], baseY(A.path[i][0], A.path[i][1]), A.path[i][1]));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const L = curve.getLength();
  const samples = [];                                     // every metre: position and sideways direction
  for (let s = 0; s <= L; s += 1) {
    const p = curve.getPointAt(s / L), t = curve.getTangentAt(s / L);
    samples.push({ p, n: new THREE.Vector3(-t.z, 0, t.x).normalize() });
  }
  let nearY = 0;                                          // height of the path at the closest point, set by nearPath()
  const nearPath = (x, z) => {
    let m = 1e9, at = 0;
    for (let i = 0; i < samples.length; i++) { const d = (samples[i].p.x - x) ** 2 + (samples[i].p.z - z) ** 2; if (d < m) { m = d; at = i; } }
    const a = samples[Math.max(0, at - 1)].p, b = samples[Math.min(samples.length - 1, at + 1)].p;
    const ux = b.x - a.x, uz = b.z - a.z, f = clamp(((x - a.x) * ux + (z - a.z) * uz) / (ux * ux + uz * uz || 1));
    nearY = lerp(a.y, b.y, f);
    return Math.hypot(a.x + ux * f - x, a.z + uz * f - z);
  };
  // A footpath is cut level into the hillside. The elevation data is too coarse to
  // show that, so the ground is benched for a metre either side of the real line.
  const groundY = (x, z) => { const d = nearPath(x, z), b = baseY(x, z); return d > 4 ? b : lerp(nearY, b, smooth(clamp((d - 1.05) / 2.9))); };

  /* ── Ground ── */
  const litter = canvasTexture(THREE, 512, 512, (g, w, h) => {
    g.fillStyle = '#4a4532'; g.fillRect(0, 0, w, h);
    const tones = ['#5b5136', '#3c3a27', '#6a5a3a', '#40492c', '#2f2c1f', '#75643f', '#4c5a33'];
    for (let i = 0; i < 26000; i++) { g.fillStyle = tones[(Math.random() * tones.length) | 0]; g.globalAlpha = 0.25 + Math.random() * 0.5; const x = Math.random() * w, y = Math.random() * h; g.save(); g.translate(x, y); g.rotate(Math.random() * 3.14); g.fillRect(0, 0, 2 + Math.random() * 7, 1 + Math.random() * 1.6); g.restore(); }
    g.globalAlpha = 1;
  }, [sizeX / 6, sizeZ / 6]);
  // sunlight that makes it through the canopy: soft warm patches on the forest floor
  const dapple = canvasTexture(THREE, 512, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 5 + Math.random() * 22, a = 0.25 + Math.random() * 0.6;
      for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
        const rg = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        rg.addColorStop(0, `rgba(255,236,190,${a})`); rg.addColorStop(1, 'rgba(255,236,190,0)');
        g.fillStyle = rg; g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.5 + Math.random() * 0.5), Math.random() * 3, 0, 6.3); g.fill();
      }
    }
  }, [sizeX / 46, sizeZ / 46]);
  dapple.channel = 0;
  const step = low ? 2.5 : 1.25, gc = Math.floor(sizeX / step) + 1, gr = Math.floor(sizeZ / step) + 1;
  const gpos = new Float32Array(gc * gr * 3), gcol = new Float32Array(gc * gr * 3), guv = new Float32Array(gc * gr * 2);
  for (let r = 0; r < gr; r++) for (let c = 0; c < gc; c++) {
    const i = r * gc + c, x = c * step, z = r * step, v = 0.74 + rand() * 0.36;
    gpos.set([x, groundY(x, z), z], i * 3);
    gcol.set([0.80 * v, 0.92 * v, 0.70 * v], i * 3);
    guv.set([x / sizeX, z / sizeZ], i * 2);
  }
  const gidx = new Uint32Array((gc - 1) * (gr - 1) * 6);
  let k = 0;
  for (let r = 0; r < gr - 1; r++) for (let c = 0; c < gc - 1; c++) { const a = r * gc + c; gidx.set([a, a + gc, a + 1, a + 1, a + gc, a + gc + 1], k); k += 6; }
  const ggeo = new THREE.BufferGeometry();
  ggeo.setAttribute('position', new THREE.BufferAttribute(gpos, 3));
  ggeo.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  ggeo.setAttribute('uv', new THREE.BufferAttribute(guv, 2));
  ggeo.setIndex(new THREE.BufferAttribute(gidx, 1));
  ggeo.computeVertexNormals();
  scene.add(new THREE.Mesh(ggeo, new THREE.MeshLambertMaterial({ map: litter, vertexColors: true, lightMap: dapple, lightMapIntensity: 2.6 })));

  /* the trodden path: a ribbon laid along the trail */
  const ribbon = [], ruv = [], ruv2 = [], ridx = [];
  samples.forEach((sm, i) => {
    for (const side of [-1, 1]) {
      const x = sm.p.x + sm.n.x * side * 0.85, z = sm.p.z + sm.n.z * side * 0.85;
      ribbon.push(x, sm.p.y + 0.06, z); ruv.push(side < 0 ? 0 : 1, i / 2.2);
      ruv2.push(x / sizeX, z / sizeZ);
    }
    if (i) { const a = (i - 1) * 2; ridx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  });
  const rgeo = new THREE.BufferGeometry();
  rgeo.setAttribute('position', new THREE.Float32BufferAttribute(ribbon, 3));
  rgeo.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
  rgeo.setAttribute('uv1', new THREE.Float32BufferAttribute(ruv2, 2));
  const dapplePath = dapple.clone(); dapplePath.channel = 1; dapplePath.needsUpdate = true;
  rgeo.setIndex(ridx);
  rgeo.computeVertexNormals();
  const earth = canvasTexture(THREE, 128, 128, (g, w, h) => {
    g.fillStyle = '#6b563c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) { g.fillStyle = ['#7b6546', '#584630', '#8a7350', '#4d3d2a'][(Math.random() * 4) | 0]; g.globalAlpha = 0.4; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 5, 1 + Math.random() * 3); }
    const edge = g.createLinearGradient(0, 0, w, 0); edge.addColorStop(0, 'rgba(60,58,36,.95)'); edge.addColorStop(0.22, 'rgba(60,58,36,0)'); edge.addColorStop(0.78, 'rgba(60,58,36,0)'); edge.addColorStop(1, 'rgba(60,58,36,.95)');
    g.globalAlpha = 1; g.fillStyle = edge; g.fillRect(0, 0, w, h);
  }, [1, 1]);
  earth.wrapT = THREE.RepeatWrapping;
  scene.add(new THREE.Mesh(rgeo, new THREE.MeshLambertMaterial({ map: earth, lightMap: dapplePath, lightMapIntensity: 2.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })));

  /* ── Conifers: tall straight trunks with the crowns far overhead ── */
  const treeCount = Math.round((low ? 420 : 900) * (fx.trees ?? 1));
  const bark = canvasTexture(THREE, 64, 256, (g, w, h) => {
    g.fillStyle = '#6a4a37'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { g.strokeStyle = ['#4f3527', '#7c5943', '#3f2a1f', '#8a6650'][(Math.random() * 4) | 0]; g.globalAlpha = 0.55; g.lineWidth = 1 + Math.random() * 2; const x = Math.random() * w; g.beginPath(); g.moveTo(x, Math.random() * h); g.lineTo(x + (Math.random() - 0.5) * 5, Math.random() * h); g.stroke(); }
  }, [2, 6]);
  const trunkGeo = new THREE.CylinderGeometry(0.62, 1, 1, 8, 1, true).translate(0, 0.5, 0);
  const tiers = low ? 3 : 5;
  const foliage = canvasTexture(THREE, 256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      const x = Math.random() * w, y = Math.pow(Math.random(), 1.25) * h, len = 9 + Math.random() * 16;
      g.strokeStyle = `hsl(${104 + Math.random() * 34}, ${22 + Math.random() * 18}%, ${30 + Math.random() * 34}%)`;
      g.lineWidth = 2 + Math.random() * 3.5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 12, y + len); g.stroke();
      if (x < 14) { g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w + 4, y + len); g.stroke(); }
    }
  }, [3, 1]);
  const crownGeo = new THREE.ConeGeometry(1, 1, 12, 4, true).translate(0, 0.5, 0);
  { // break the perfect cone into drooping, uneven boughs
    const cp = crownGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i), rad = Math.hypot(x, z);
      if (rad < 1e-4) continue;
      const kx = Math.round(x * 50), ky = Math.round(y * 50), kz = Math.round(z * 50);
      const j = 0.72 + hash3(kx, ky, kz) * 0.55;
      cp.setXYZ(i, x * j, y - rad * 0.16 + (hash3(kz, kx, ky) - 0.5) * 0.07, z * j);
    }
    crownGeo.computeVertexNormals();
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ map: bark }), treeCount);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ map: foliage, alphaTest: 0.45, side: THREE.DoubleSide }), treeCount * tiers);
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  const placed = [];
  const taken = new Map();
  const cellKey = (x, z) => `${Math.floor(x / 3)},${Math.floor(z / 3)}`;
  let n = 0;
  for (let tries = 0; tries < treeCount * 9 && n < treeCount; tries++) {
    const sm = samples[(rand() * samples.length) | 0];
    const off = (2.3 + Math.pow(rand(), 1.7) * 46) * (rand() < 0.5 ? -1 : 1);
    const x = sm.p.x + sm.n.x * off + (rand() - 0.5) * 6, z = sm.p.z + sm.n.z * off + (rand() - 0.5) * 6;
    if (x < 1 || z < 1 || x > sizeX - 1 || z > sizeZ - 1 || nearPath(x, z) < 2.1 || taken.has(cellKey(x, z))) continue;
    taken.set(cellKey(x, z), 1);
    const r = 0.26 + rand() * 0.34, hgt = 19 + rand() * 15, y = groundY(x, z) - 0.3;
    dummy.position.set(x, y, z); dummy.rotation.set((rand() - 0.5) * 0.04, rand() * 6.28, (rand() - 0.5) * 0.04); dummy.scale.set(r, hgt, r); dummy.updateMatrix();
    trunks.setMatrixAt(n, dummy.matrix);
    trunks.setColorAt(n, tint.setHSL(0.05 + rand() * 0.03, 0.25 + rand() * 0.15, 0.62 + rand() * 0.3, THREE.SRGBColorSpace));
    for (let c = 0; c < tiers; c++) {
      const w = (3.1 + rand() * 1.7) * (1 - c * 0.7 / tiers), ch = 6 + rand() * 4;
      dummy.position.set(x, y + hgt * (0.54 + c * 0.46 / tiers), z); dummy.rotation.set(0, rand() * 6.28, 0); dummy.scale.set(w, ch, w); dummy.updateMatrix();
      crowns.setMatrixAt(n * tiers + c, dummy.matrix);
      crowns.setColorAt(n * tiers + c, tint.setHSL(0.31 + rand() * 0.05, 0.3 + rand() * 0.15, 0.3 + rand() * 0.16, THREE.SRGBColorSpace));
    }
    placed.push([x, z]);
    n++;
  }
  trunks.count = n; crowns.count = n * tiers;
  scene.add(trunks, crowns);

  /* ── Roots across the path: sinuous, half-buried, a few shapes repeated ── */
  if (fx.roots !== 0) {
    const shapes = [];
    for (let v = 0; v < 5; v++) {
      const strands = [];
      for (let k2 = 0; k2 < 2 + (v % 2); k2++) {
        const cp = [], z0 = (rand() - 0.5) * 0.5, wob = rand() * 6.28;
        for (let i = 0; i <= 7; i++) {
          const u = i / 7, end = Math.sin(u * Math.PI);
          cp.push(new THREE.Vector3(-1 + u * 2, -0.05 + end * (0.035 + rand() * 0.05), z0 + Math.sin(u * 5 + wob) * 0.16 + (rand() - 0.5) * 0.1));
        }
        strands.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cp), 20, 0.03 + rand() * 0.028, 6, false));
      }
      shapes.push(merge(THREE, strands));
    }
    const rootMat = new THREE.MeshLambertMaterial({ color: 0x4a382a });
    const per = Math.ceil(L / 0.9 / shapes.length) + 2;
    const meshes = shapes.map((g) => { const m = new THREE.InstancedMesh(g, rootMat, per); m.count = 0; scene.add(m); return m; });
    for (let s = 2; s < L - 2; s += 0.5 + rand() * 1.4) {
      const m = meshes[(rand() * meshes.length) | 0];
      if (m.count >= per) continue;
      const sm = samples[Math.round(s)], len = 0.8 + rand() * 0.9, fat = 0.8 + rand() * 0.9;
      const across = (rand() - 0.5) * 0.9;
      dummy.position.set(sm.p.x + sm.n.x * across, sm.p.y + 0.05, sm.p.z + sm.n.z * across);
      dummy.rotation.set(0, Math.atan2(-sm.n.z, sm.n.x) + (rand() - 0.5) * 1.5, (rand() - 0.5) * 0.08);
      dummy.scale.set(len, fat, fat); dummy.updateMatrix();
      m.setMatrixAt(m.count++, dummy.matrix);
    }

    // mossy stones along the edges
    const stoneGeo = new THREE.SphereGeometry(1, 10, 7);
    { const sp = stoneGeo.attributes.position; for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i), j = 0.78 + hash3(Math.round(x * 40), Math.round(y * 40), Math.round(z * 40)) * 0.4; sp.setXYZ(i, x * j, y * j * 0.62, z * j); } stoneGeo.computeVertexNormals(); }
    const stoneCount = low ? 90 : 220;
    const stones = new THREE.InstancedMesh(stoneGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), stoneCount);
    for (let i = 0; i < stoneCount; i++) {
      const sm = samples[(rand() * samples.length) | 0], off = (0.95 + Math.pow(rand(), 2) * 6) * (rand() < 0.5 ? -1 : 1), sc = 0.12 + Math.pow(rand(), 2.2) * 0.5;
      const x = sm.p.x + sm.n.x * off, z = sm.p.z + sm.n.z * off;
      dummy.position.set(x, groundY(x, z) + sc * 0.12, z); dummy.rotation.set(rand() * 0.4, rand() * 6.28, rand() * 0.4); dummy.scale.setScalar(sc); dummy.updateMatrix();
      stones.setMatrixAt(i, dummy.matrix);
      stones.setColorAt(i, rand() < 0.55 ? tint.setHSL(0.25 + rand() * 0.06, 0.3, 0.2 + rand() * 0.1, THREE.SRGBColorSpace) : tint.setHSL(0.1, 0.06, 0.26 + rand() * 0.14, THREE.SRGBColorSpace));
    }
    scene.add(stones);
  }

  /* ── Ferns and low growth beside the path ── */
  if (fx.undergrowth !== 0) {
    const frond = canvasTexture(THREE, 128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.translate(w / 2, h);
      for (let f = 0; f < 9; f++) {
        const a = -Math.PI / 2 + (f - 4) * 0.27, len = h * (0.62 + Math.random() * 0.34);
        g.strokeStyle = `hsl(${96 + Math.random() * 24}, ${36 + Math.random() * 18}%, ${24 + Math.random() * 16}%)`;
        g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(Math.cos(a) * len * 0.5, Math.sin(a) * len * 0.7, Math.cos(a) * len, Math.sin(a) * len * 0.82); g.stroke();
        for (let s = 0.2; s < 1; s += 0.085) {
          const px = Math.cos(a) * len * s, py = Math.sin(a) * len * (0.7 * s + 0.12 * s * s), l = 11 * (1 - s) + 3;
          g.lineWidth = 1.6; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a + 1.2) * l, py + Math.sin(a + 1.2) * l); g.moveTo(px, py); g.lineTo(px + Math.cos(a - 1.2) * l, py + Math.sin(a - 1.2) * l); g.stroke();
        }
      }
    });
    const one = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), two = one.clone().rotateY(Math.PI / 2);
    const cross = new THREE.BufferGeometry();
    cross.setAttribute('position', new THREE.Float32BufferAttribute([...one.attributes.position.array, ...two.attributes.position.array], 3));
    cross.setAttribute('uv', new THREE.Float32BufferAttribute([...one.attributes.uv.array, ...two.attributes.uv.array], 2));
    cross.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(8).fill([0, 1, 0]).flat(), 3));
    const front = [...one.index.array, ...Array.from(two.index.array, (v) => v + 4)], back = [];
    for (let i = 0; i < front.length; i += 3) back.push(front[i], front[i + 2], front[i + 1]);
    cross.setIndex([...front, ...back]);                    // both windings, one upward normal: no dark backs
    const fernCount = Math.round((low ? 600 : 1500) * (fx.undergrowth ?? 1));
    const ferns = new THREE.InstancedMesh(cross, new THREE.MeshLambertMaterial({ map: frond, alphaTest: 0.4 }), fernCount);
    for (let i = 0; i < fernCount; i++) {
      const sm = samples[(rand() * samples.length) | 0], off = (1.05 + Math.pow(rand(), 1.4) * 11) * (rand() < 0.5 ? -1 : 1);
      const x = sm.p.x + sm.n.x * off + (rand() - 0.5) * 2, z = sm.p.z + sm.n.z * off + (rand() - 0.5) * 2, sc = 0.55 + rand() * 0.8;
      dummy.position.set(x, groundY(x, z) - 0.02, z); dummy.rotation.set(0, rand() * 6.28, 0); dummy.scale.set(sc * 1.3, sc, sc * 1.3); dummy.updateMatrix();
      ferns.setMatrixAt(i, dummy.matrix);
      ferns.setColorAt(i, tint.setHSL(0.25 + rand() * 0.06, 0.3, 0.5 + rand() * 0.3, THREE.SRGBColorSpace));
    }
    scene.add(ferns);
  }

  /* ── Shafts of light through the canopy ── */
  const shafts = [];
  if (fx.shafts !== 0) {
    const beam = canvasTexture(THREE, 64, 256, (g, w, h) => {
      const a = g.createLinearGradient(0, 0, w, 0); a.addColorStop(0, 'rgba(255,244,214,0)'); a.addColorStop(0.5, 'rgba(255,244,214,1)'); a.addColorStop(1, 'rgba(255,244,214,0)');
      g.fillStyle = a; g.fillRect(0, 0, w, h);
      const b = g.createLinearGradient(0, 0, 0, h); b.addColorStop(0, 'rgba(0,0,0,0)'); b.addColorStop(0.25, 'rgba(0,0,0,1)'); b.addColorStop(0.8, 'rgba(0,0,0,.8)'); b.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalCompositeOperation = 'destination-in'; g.fillStyle = b; g.fillRect(0, 0, w, h);
    });
    const count = low ? 14 : 30;
    for (let i = 0; i < count; i++) {
      const sm = samples[Math.min(samples.length - 1, Math.round((i + rand()) / count * samples.length))], off = (3 + rand() * 13) * (rand() < 0.5 ? -1 : 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2 + rand() * 4, 30), new THREE.MeshBasicMaterial({ map: beam, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      const x = sm.p.x + sm.n.x * off, z = sm.p.z + sm.n.z * off;
      m.position.set(x, groundY(x, z) + 12, z);
      m.rotation.set(0, Math.atan2(sm.n.z, -sm.n.x) + (rand() - 0.5) * 0.9, 0.3 + rand() * 0.12);
      m.userData.base = 0.1 + rand() * 0.14; m.userData.phase = rand() * 6.28;
      shafts.push(m); scene.add(m);
    }
  }

  /* ── Dust and pollen in the light ── */
  let motes = null, moteBase = null;
  if (fx.motes !== 0) {
    const count = low ? 220 : 520;
    moteBase = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) moteBase[i] = rand();
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    motes = new THREE.Points(mg, new THREE.PointsMaterial({ color: 0xfff1cc, size: 0.045, map: canvasTexture(THREE, 32, 32, (g) => { const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, 32, 32); }), sizeAttenuation: true, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    motes.frustumCulled = false;
    scene.add(motes);
  }

  /* ── Walking ── */
  const camera = new THREE.PerspectiveCamera(cfg.camera.fov || 62, 1, 0.1, 420);
  let s = L * 0.3, yaw = null, stride = 0, lastFoot = 0;
  const eye = cfg.camera.eye || 1.62, pace = fx.walkSpeed || 1.25;

  function update({ t, dt, look, input, mode }) {
    // cinematic: a steady walk. interactive: a few paces to set off, then you decide.
    let v = mode === 'interactive' ? (input.walk ? input.walk * pace * 1.5 : (t < 7 ? pace : 0)) : pace;
    v *= smooth(clamp(t / 2.5));
    s = clamp(s + v * dt, 3, L - 9);
    const p = curve.getPointAt(s / L), ahead = curve.getPointAt(clamp((s + 6) / L));
    const want = Math.atan2(ahead.x - p.x, -(ahead.z - p.z));
    if (yaw === null) yaw = want;
    let d = want - yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    yaw += d * Math.min(1, dt * 1.6);
    stride += Math.abs(v) * dt / 0.74;
    const bob = Math.sin(stride * Math.PI * 2) * 0.03 * clamp(Math.abs(v)), sway = Math.sin(stride * Math.PI) * 0.025 * clamp(Math.abs(v));
    camera.position.set(p.x + Math.cos(yaw) * sway, p.y + eye + bob, p.z + Math.sin(yaw) * sway);
    const slope = Math.atan2(ahead.y - p.y, 6);
    camera.rotation.set(slope * 0.55 + look.pitch * Math.PI / 180 - 0.02, -(yaw + look.yaw * Math.PI / 180), Math.sin(stride * Math.PI) * 0.004, 'YXZ');
    if (audio && Math.floor(stride * 2) !== lastFoot) { lastFoot = Math.floor(stride * 2); if (Math.abs(v) > 0.2) audio.step(0.07 + Math.random() * 0.05); }

    for (const m of shafts) m.material.opacity = m.userData.base * (0.7 + 0.3 * Math.sin(t * 0.5 + m.userData.phase));
    if (motes) {
      const arr = motes.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        const wrap = (base, drift, span, centre) => ((((base * span + drift) % span) + span) % span) - span / 2 + centre;
        arr[i] = wrap(moteBase[i], t * 0.05 + Math.sin(t * 0.3 + i) * 0.2 - camera.position.x, 26, camera.position.x);
        arr[i + 1] = wrap(moteBase[i + 1], -t * 0.03 - camera.position.y, 9, camera.position.y + 2);
        arr[i + 2] = wrap(moteBase[i + 2], t * 0.04 - camera.position.z, 26, camera.position.z);
      }
      motes.geometry.attributes.position.needsUpdate = true;
    }
  }

  return {
    update,
    render() { renderer.render(scene, camera); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() { scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); },
    facts: [`This stretch: ${Math.round(L)} m of the trail, between ${A.minElevation + Math.round(Math.min(...pts.map((p) => p.y)))} and ${A.minElevation + Math.round(Math.max(...pts.map((p) => p.y)))} m above sea level.`],
  };
}
