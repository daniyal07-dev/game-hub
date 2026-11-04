// games/war/effects.js
// Shared visual effects: bullet tracers, sparks, flashes, explosions, camera shake.
// Everything is created once and reused (pooling), so the game never lags.
// v2: muzzle flash is small, dim and short (realistic). Knobs are just below.

import * as THREE from 'three';

/* ---------- KNOBS (easy to tweak) ---------- */
const MUZZLE_MAX = 0.09;      // biggest allowed flash radius in metres (was up to 0.5)
const MUZZLE_OPACITY = 0.55;  // flash brightness, 1 = full
const MUZZLE_LIFE = 0.045;    // seconds the flash stays visible
const TRACER_BRIGHT = 0.7;    // bullet line brightness, 1 = full
const SPARK_SIZE = 2.5;       // size of sparks in pixels (was 3.5)

export function createEffects(scene) {
  /* ---------- Particles (one object holds up to 800 sparks) ---------- */
  const MAX = 800;
  const pPos = new Float32Array(MAX * 3);
  const pCol = new Float32Array(MAX * 3);
  const pBase = new Float32Array(MAX * 3);
  const pVel = new Float32Array(MAX * 3);
  const pLife = new Float32Array(MAX);
  const pMax = new Float32Array(MAX);
  const pGrav = new Float32Array(MAX);
  for (let i = 0; i < MAX; i++) pPos[i * 3 + 1] = -1000;     // parked out of sight
  let cursor = 0;

  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: SPARK_SIZE, sizeAttenuation: false, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
  }));
  points.frustumCulled = false;
  scene.add(points);

  const tmpC = new THREE.Color();

  // A burst of sparks flying in all directions
  function burst(point, color = 0xffd84a, count = 10, speed = 6, life = 0.5, gravity = 9) {
    tmpC.set(color);
    for (let n = 0; n < count; n++) {
      const i = cursor;
      cursor = (cursor + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.3 + Math.random() * 0.7);
      pPos[i * 3] = point.x;
      pPos[i * 3 + 1] = point.y;
      pPos[i * 3 + 2] = point.z;
      pVel[i * 3] = Math.cos(a) * s * sp;
      pVel[i * 3 + 1] = u * sp;
      pVel[i * 3 + 2] = Math.sin(a) * s * sp;
      pBase[i * 3] = tmpC.r; pBase[i * 3 + 1] = tmpC.g; pBase[i * 3 + 2] = tmpC.b;
      pLife[i] = pMax[i] = life * (0.6 + Math.random() * 0.4);
      pGrav[i] = gravity;
    }
  }

  /* ---------- Bullet tracers (thin glowing lines) ---------- */
  const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  tracerGeo.translate(0, 0, 0.5);                  // so it grows forward from its start
  const tracers = [];
  for (let i = 0; i < 40; i++) {
    const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, toneMapped: false,
      depthWrite: false, blending: THREE.AdditiveBlending
    }));
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0, max: 0.07 });
  }
  let tCur = 0;

  function tracer(from, to, color = 0xffe08a, width = 0.035, life = 0.07) {
    const dist = from.distanceTo(to);
    if (dist < 0.2) return;
    const t = tracers[tCur];
    tCur = (tCur + 1) % tracers.length;
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(width, width, dist);
    t.mesh.material.color.set(color);
    t.mesh.material.opacity = TRACER_BRIGHT;
    t.mesh.visible = true;
    t.life = t.max = life;
  }

  /* ---------- Glowing spheres (muzzle flashes and explosion cores) ---------- */
  const sphereGeo = new THREE.SphereGeometry(1, 12, 8);
  const spheres = [];
  for (let i = 0; i < 40; i++) {
    const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, toneMapped: false,
      depthWrite: false, blending: THREE.AdditiveBlending
    }));
    mesh.visible = false;
    scene.add(mesh);
    spheres.push({ mesh, life: 0, max: 1, s0: 1, s1: 1, op: 1 });
  }
  let sCur = 0;

  function sphere(point, color, s0, s1, life, op = 1) {
    const e = spheres[sCur];
    sCur = (sCur + 1) % spheres.length;
    e.mesh.position.set(point.x, point.y, point.z);
    e.mesh.material.color.set(color);
    e.mesh.visible = true;
    e.life = e.max = life;
    e.s0 = s0; e.s1 = s1; e.op = op;
  }

  // Quick flash at a gun barrel (size is capped, so it can never fill the screen)
  function muzzle(point, color = 0xffd84a, size = 0.3) {
    const s = Math.min(size * 0.4, MUZZLE_MAX);
    sphere(point, color, s, s * 1.5, MUZZLE_LIFE, MUZZLE_OPACITY);
  }

  /* ---------- Shockwave rings ---------- */
  const ringGeo = new THREE.RingGeometry(0.85, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 10; i++) {
    const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, toneMapped: false,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, life: 0, max: 1, s0: 1, s1: 1, op: 1 });
  }
  let rCur = 0;

  function ring(point, color, size, life) {
    const e = rings[rCur];
    rCur = (rCur + 1) % rings.length;
    e.mesh.position.set(point.x, 0.1, point.z);
    e.mesh.material.color.set(color);
    e.mesh.visible = true;
    e.life = e.max = life;
    e.s0 = 0.5; e.s1 = size; e.op = 0.9;
  }

  /* ---------- One permanent flash light ---------- */
  // Created once and reused. Adding lights during the game would cause stutter.
  const boom = new THREE.PointLight(0xff9a3a, 0, 45);
  boom.position.set(0, -50, 0);
  scene.add(boom);
  let boomI = 0;

  /* ---------- Camera shake ---------- */
  let shakeAmt = 0;
  function addShake(a) { shakeAmt = Math.min(1.5, shakeAmt + a); }

  /* ---------- Ready-made effects ---------- */
  function hitSpark(point, color = 0xffd84a) {
    burst(point, color, 6, 4.5, 0.28, 10);
  }

  function explosion(point, radius = 6, color = 0xff8a3a) {
    sphere(point, 0xffffff, 0.5, radius * 0.6, 0.18);
    sphere(point, color, 0.5, radius, 0.45, 0.8);
    ring(point, color, radius * 1.4, 0.5);
    burst(point, color, 40, radius * 2, 0.9, 6);
    burst(point, 0xffffff, 18, radius * 2.5, 0.5, 4);
    boom.color.set(color);
    boom.position.set(point.x, point.y + 1.5, point.z);
    boomI = 420 * (radius / 6);
    addShake(Math.min(1.2, radius / 9));
  }

  function deathBurst(point, color = 0xff2d4a) {
    sphere(point, color, 0.4, 1.6, 0.25, 0.9);
    burst(point, color, 26, 7, 0.7, 8);
    burst(point, 0xffffff, 8, 5, 0.4, 6);
  }

  /* ---------- Update (call every frame) ---------- */
  function tickPool(list, dt) {
    for (const e of list) {
      if (e.life <= 0) continue;
      e.life -= dt;
      if (e.life <= 0) { e.mesh.visible = false; continue; }
      const f = e.life / e.max;
      e.mesh.scale.setScalar(e.s0 + (e.s1 - e.s0) * (1 - f));
      e.mesh.material.opacity = f * e.op;
    }
  }

  function update(dt) {
    // particles
    for (let i = 0; i < MAX; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt;
      const k = i * 3;
      if (pLife[i] <= 0) {
        pPos[k + 1] = -1000;
        pCol[k] = pCol[k + 1] = pCol[k + 2] = 0;
        continue;
      }
      pVel[k + 1] -= pGrav[i] * dt;
      pPos[k]     += pVel[k] * dt;
      pPos[k + 1] += pVel[k + 1] * dt;
      pPos[k + 2] += pVel[k + 2] * dt;
      if (pPos[k + 1] < 0.03) {                 // bounce on the floor
        pPos[k + 1] = 0.03;
        pVel[k + 1] *= -0.3;
        pVel[k] *= 0.6;
        pVel[k + 2] *= 0.6;
      }
      const f = pLife[i] / pMax[i];
      pCol[k] = pBase[k] * f;
      pCol[k + 1] = pBase[k + 1] * f;
      pCol[k + 2] = pBase[k + 2] * f;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;

    // tracers
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = (t.life / t.max) * TRACER_BRIGHT;
    }

    tickPool(spheres, dt);
    tickPool(rings, dt);

    boomI *= Math.exp(-dt * 7);
    if (boomI < 0.5) boomI = 0;
    boom.intensity = boomI;

    shakeAmt = Math.max(0, shakeAmt - dt * 2.5);
  }

  // Wipe everything (used when a stage restarts)
  function clear() {
    pLife.fill(0);
    pPos.fill(0);
    for (let i = 0; i < MAX; i++) pPos[i * 3 + 1] = -1000;
    pCol.fill(0);
    tracers.forEach(t => { t.life = 0; t.mesh.visible = false; });
    spheres.forEach(e => { e.life = 0; e.mesh.visible = false; });
    rings.forEach(e => { e.life = 0; e.mesh.visible = false; });
    boomI = 0;
    boom.intensity = 0;
    shakeAmt = 0;
  }

  function dispose() {
    clear();
    [points, boom, ...tracers.map(t => t.mesh), ...spheres.map(e => e.mesh), ...rings.map(e => e.mesh)]
      .forEach(o => scene.remove(o));
    pGeo.dispose();
    tracerGeo.dispose();
    sphereGeo.dispose();
    ringGeo.dispose();
  }

  return {
    burst, tracer, muzzle, sphere, ring, hitSpark, explosion, deathBurst,
    addShake,
    get shake() { return shakeAmt; },
    update, clear, dispose
  };
}