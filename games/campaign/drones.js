// games/campaign/drones.js  (v1)
// Space Gang attack drones that guard Port Town (look copied from War: models/drone.glb + health ring).
//  - Patrol over the town streets, never hover over buildings or trees (they use collision.js).
//  - When they see the player, a soldier or a base guard they dive in, keep 9-16 m away, strafe and fire cyan bursts.
//  - Real health: your rifle / pistol / shotgun work (the 'shot' event is ray-tested here, no player.js edit).
//  - Your soldiers and the base guards shoot back at drones.
//  - Own sounds: rotor hum, zap shots, explosion.  Own explosion effect.
// Loaded by extras.js (needs 'drones' in MODULES).  Console: spawnDrone(), dronesInfo()

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { blockedAt, lineClear, groundHeight } from './collision.js';
import { hurtSoldier } from './units.js';
import { getBaseGuards } from './base-npcs.js';
import { difficultyName } from './enemies.js';
import { extrasEvent } from './extras.js';

/* ---------- Settings you can change ---------- */
const COUNT        = 4;            // drones over the town
const MODEL_URL    = new URL('../../models/drone.glb', import.meta.url).href;
const SIZE         = 2.2;          // drone size in metres (same as War)
const MODEL_YAW    = 0;            // if the drone flies sideways, try Math.PI / 2
const TOWN         = { x: 120, z: 80 };
const PATROL_MIN   = 12;           // patrol ring around the town square (metres)
const PATROL_MAX   = 62;
const PATROL_ALT   = 8;            // height above ground while patrolling
const COMBAT_ALT   = 4.5;          // height above ground while attacking
const PATROL_SPEED = 3.5;
const APPROACH     = 6;            // speed when too far
const BACKOFF      = 5;            // speed when too close
const STRAFE       = 4;            // sideways speed
const SIGHT        = 55;           // sees targets within this distance (flat)
const RANGE        = 30;           // shoots within this distance
const KEEP_MIN     = 9;
const KEEP_MAX     = 16;
const LEASH        = 110;          // never leaves this far from the town
const HP           = { easy: 40, normal: 60, hard: 80 };
const DMG          = { easy: 6,  normal: 8,  hard: 10 };
const HIT_BASE     = 0.60;         // chance to hit, falls with distance
const HIT_FALL     = 0.012;
const HIT_MIN      = 0.15;
const BURST        = 2;            // shots per burst
const GAP          = 0.18;
const PAUSE        = 1.1;          // seconds between bursts
const REACT        = 0.7;          // seconds before the first shot after spotting you
const BODY_R       = 1.3;          // keeps this far from walls / trees
const HIT_R        = 1.2;          // your bullets hit within this radius of the drone centre
const ALLY_RANGE   = 38;           // soldiers / guards shoot a drone within this distance
const ALLY_HIT     = 0.40;
const ALLY_DMG     = 9;
const ALLY_FIRE_ANIM = true;       // soldiers play their shoot animation at drones
const RESPAWN      = 100;          // seconds until a destroyed drone is replaced
const SHOW_DIST    = 250;
const SHADOWS      = true;
const VOLUME       = 0.7;
const MAX_DIST     = 110;          // sounds fade out at this distance
const HUM_VOL      = 0.10;
const MAX_TOTAL    = 8;            // with test drones

const SHOTS = {                    // same numbers as your guns in player.js
  pistol:  { dmg: 28, range: 70,  pellets: 1, spread: 0 },
  rifle:   { dmg: 18, range: 130, pellets: 1, spread: 0 },
  shotgun: { dmg: 14, range: 35,  pellets: 8, spread: 0.04 }
};
const RING_COLORS = { 3: 0x00f0ff, 2: 0x7b2ff7, 1: 0xff2d95 };   // same as War

/* ---------- State ---------- */
let C = null, scene = null;
let template = null, loaded = false, started = false;
let gen = 0, senseT = 0, warnT = 0, warnedHurt = false;
const drones = [];
const targets = [];
const camPos = new THREE.Vector3();
const TP = { x: 0, y: 0, z: 0 };

/* ---------- Small helpers ---------- */
function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const mats = (o) => (Array.isArray(o.material) ? o.material : [o.material]);

function loadModel() {
  new GLTFLoader().load(MODEL_URL,
    (g) => { template = g.scene; loaded = true; console.log('[drones] drone.glb loaded'); },
    undefined,
    () => { loaded = true; console.warn('[drones] models/drone.glb not found, using a built-in shape'); });
}

// same look settings as War (STYLE_DRONE)
function prepare(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = mats(o).map((m) => {
      const n = m.clone();
      if (n.color) n.color.multiplyScalar(1.15);
      if (n.metalness !== undefined) {
        n.metalness = Math.min(n.metalness, 0.6);
        n.roughness = Math.max(n.roughness, 0.4);
        n.envMapIntensity = 0.8;
      }
      return n;
    });
    o.material = Array.isArray(o.material) ? list : list[0];
    if (SHADOWS) { o.castShadow = true; o.receiveShadow = true; }
  });
}

// scale so the biggest side = SIZE, centre it, long side along Z (same as War's fitModel)
function fit(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const holder = new THREE.Group();
  holder.add(root);
  holder.scale.setScalar(SIZE / Math.max(size.x, size.y, size.z, 0.0001));
  holder.rotation.y = (size.x > size.z ? Math.PI / 2 : 0) + MODEL_YAW;
  const outer = new THREE.Group();
  outer.add(holder);
  return outer;
}

function glow(obj, color, intensity) {
  const c = new THREE.Color(color);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    mats(o).forEach((m) => {
      if (!m.emissive) return;
      if (!m.userData.base) m.userData.base = { c: m.emissive.clone(), i: m.emissiveIntensity };
      m.emissive.copy(c);
      m.emissiveIntensity = intensity;
    });
  });
}
function unglow(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    mats(o).forEach((m) => {
      if (m.userData.base) { m.emissive.copy(m.userData.base.c); m.emissiveIntensity = m.userData.base.i; }
    });
  });
}

function buildMesh() {
  const g = new THREE.Group();
  const tilt = new THREE.Group();
  g.add(tilt);
  if (template) {
    const m = template.clone(true);
    prepare(m);
    tilt.add(fit(m));
  } else {
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(SIZE * 0.45),
      new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.6, roughness: 0.4 }));
    core.castShadow = SHADOWS;
    tilt.add(core);
  }
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(SIZE * 0.55, 0.03, 8, 32),
    new THREE.MeshBasicMaterial({ color: RING_COLORS[3], toneMapped: false }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -SIZE * 0.25;
  g.add(ring);
  return { g, tilt, ring };
}

function look(d) {
  const f = d.hp / d.maxHp;
  const stage = f > 0.66 ? 3 : f > 0.33 ? 2 : 1;
  const col = RING_COLORS[stage];
  d.ring.material.color.setHex(col);
  if (d.flash > 0) glow(d.tilt, 0xffffff, 1.6);
  else if (d.hp < d.maxHp) glow(d.tilt, col, 0.5);
  else unglow(d.tilt);
}

/* ---------- Beams (tracers) ---------- */
const beams = [];
let beamI = 0;
function makeBeams() {
  for (let i = 0; i < 16; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const m = new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 1, toneMapped: false });
    const l = new THREE.Line(geo, m);
    l.visible = false;
    l.frustumCulled = false;
    scene.add(l);
    beams.push({ l, life: 0 });
  }
}
function beam(x1, y1, z1, x2, y2, z2, color) {
  const b = beams[beamI++ % beams.length];
  const p = b.l.geometry.attributes.position;
  p.setXYZ(0, x1, y1, z1);
  p.setXYZ(1, x2, y2, z2);
  p.needsUpdate = true;
  b.l.material.color.setHex(color);
  b.l.material.opacity = 1;
  b.l.visible = true;
  b.life = 0.1;
}
function updateBeams(dt) {
  for (const b of beams) {
    if (b.life <= 0) continue;
    b.life -= dt;
    if (b.life <= 0) b.l.visible = false;
    else b.l.material.opacity = b.life / 0.1;
  }
}

/* ---------- Explosion effect ---------- */
const fx = [];
const debrisGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const debrisMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.5 });
function boom(x, y, z) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x66f6ff, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
  flash.position.set(x, y, z);
  scene.add(flash);
  fx.push({ kind: 'flash', o: flash, t: 0, life: 0.5 });
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(debrisGeo, debrisMat);
    m.position.set(x, y, z);
    const a = Math.random() * Math.PI * 2;
    const sp = 3 + Math.random() * 5;
    scene.add(m);
    fx.push({ kind: 'debris', o: m, t: 0, life: 1.6,
      vx: Math.cos(a) * sp, vy: 3 + Math.random() * 5, vz: Math.sin(a) * sp,
      rx: Math.random() * 8, rz: Math.random() * 8 });
  }
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    const k = f.t / f.life;
    if (f.kind === 'flash') {
      f.o.scale.setScalar(0.5 + k * 3.5);
      f.o.material.opacity = Math.max(0, 0.9 * (1 - k));
    } else {
      f.vy -= 14 * dt;
      f.o.position.x += f.vx * dt;
      f.o.position.y += f.vy * dt;
      f.o.position.z += f.vz * dt;
      f.o.rotation.x += f.rx * dt;
      f.o.rotation.z += f.rz * dt;
      const gy = groundHeight(f.o.position.x, f.o.position.z);
      if (f.o.position.y < gy + 0.1) { f.o.position.y = gy + 0.1; f.vx *= 0.3; f.vz *= 0.3; f.vy = 0; }
      f.o.scale.setScalar(Math.max(0.01, 1 - Math.max(0, k - 0.7) / 0.3));
    }
    if (f.t >= f.life) {
      scene.remove(f.o);
      if (f.kind === 'flash') { f.o.geometry.dispose(); f.o.material.dispose(); }
      fx.splice(i, 1);
    }
  }
}
function clearFx() {
  for (const f of fx) {
    scene.remove(f.o);
    if (f.kind === 'flash') { f.o.geometry.dispose(); f.o.material.dispose(); }
  }
  fx.length = 0;
}

/* ---------- Sound (own small audio graph) ---------- */
let AC = null, master = null, hum = null, noiseBuf = null;
function ac() {
  if (!AC) {
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain();
      master.gain.value = VOLUME;
      master.connect(AC.destination);
      makeHum();
    } catch (e) { AC = null; return null; }
  }
  if (AC.state === 'suspended') AC.resume().catch(() => {});
  return AC;
}
function voice(pan) {
  if (AC.createStereoPanner) {
    const p = AC.createStereoPanner();
    p.pan.value = pan;
    p.connect(master);
    return p;
  }
  return master;
}
function makeHum() {
  const o1 = AC.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 64;
  const o2 = AC.createOscillator(); o2.type = 'square';   o2.frequency.value = 96.5;
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
  const g = AC.createGain(); g.gain.value = 0;
  const lfo = AC.createOscillator(); lfo.frequency.value = 17;
  const depth = AC.createGain(); depth.gain.value = 0;
  lfo.connect(depth); depth.connect(g.gain);
  o1.connect(lp); o2.connect(lp); lp.connect(g);
  const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
  if (pan) { g.connect(pan); pan.connect(master); } else g.connect(master);
  o1.start(); o2.start(); lfo.start();
  hum = { g, depth, pan };
}
function setHum(vol, pan) {
  if (!AC || !hum) return;
  const t = AC.currentTime;
  hum.g.gain.setTargetAtTime(vol, t, 0.1);
  hum.depth.gain.setTargetAtTime(vol * 0.35, t, 0.1);
  if (hum.pan) hum.pan.pan.setTargetAtTime(pan, t, 0.1);
}
function spatial(x, y, z) {
  const dx = x - camPos.x, dy = y - camPos.y, dz = z - camPos.z;
  const dist = Math.hypot(dx, dy, dz) || 0.001;
  const e = C.camera.matrixWorld.elements;           // first column = camera's right direction
  const lateral = (dx * e[0] + dy * e[1] + dz * e[2]) / dist;
  return { dist, vol: Math.pow(Math.max(0, 1 - dist / MAX_DIST), 1.4), pan: Math.max(-1, Math.min(1, lateral)) * 0.8 };
}
function zap(x, y, z) {
  if (!ac()) return;
  const s = spatial(x, y, z);
  if (s.vol < 0.03) return;
  const t = AC.currentTime;
  const o = AC.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(1500, t);
  o.frequency.exponentialRampToValueAtTime(240, t + 0.13);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.28 * s.vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  o.connect(g); g.connect(voice(s.pan));
  o.start(t); o.stop(t + 0.17);
}
function boomSound(x, y, z) {
  if (!ac()) return;
  const s = spatial(x, y, z);
  if (s.vol < 0.02) return;
  const t = AC.currentTime;
  if (!noiseBuf) {
    noiseBuf = AC.createBuffer(1, Math.floor(AC.sampleRate * 0.8), AC.sampleRate);
    const a = noiseBuf.getChannelData(0);
    for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / a.length);
  }
  const out = voice(s.pan);
  const src = AC.createBufferSource(); src.buffer = noiseBuf;
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2200, t);
  lp.frequency.exponentialRampToValueAtTime(120, t + 0.7);
  const g = AC.createGain();
  g.gain.setValueAtTime(0.9 * s.vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
  src.connect(lp); lp.connect(g); g.connect(out);
  src.start(t);
  const th = AC.createOscillator(); th.type = 'sine';
  th.frequency.setValueAtTime(110, t);
  th.frequency.exponentialRampToValueAtTime(38, t + 0.35);
  const tg = AC.createGain();
  tg.gain.setValueAtTime(0.8 * s.vol, t);
  tg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  th.connect(tg); tg.connect(out);
  th.start(t); th.stop(t + 0.45);
}

/* ---------- Warning text ---------- */
let warnEl = null;
function warn(text) {
  if (performance.now() - warnT < 15000) return;
  warnT = performance.now();
  if (!warnEl) {
    warnEl = document.createElement('div');
    warnEl.style.cssText = 'position:fixed;top:24%;left:50%;transform:translateX(-50%);z-index:60;' +
      'pointer-events:none;color:#00f0ff;font:700 18px system-ui,sans-serif;letter-spacing:3px;' +
      'text-shadow:0 0 10px #00f0ff,0 2px 4px #000;opacity:0;transition:opacity .3s';
    document.body.appendChild(warnEl);
  }
  warnEl.textContent = text;
  warnEl.style.opacity = '1';
  setTimeout(() => { if (warnEl) warnEl.style.opacity = '0'; }, 2500);
}

/* ---------- Creating drones ---------- */
function pickWp(d) {
  for (let k = 0; k < 16; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = d.rMin + Math.random() * (d.rMax - d.rMin);
    const x = d.hx + Math.cos(a) * r, z = d.hz + Math.sin(a) * r;
    if (!blockedAt(x, z, BODY_R + 0.5)) return { x, z };
  }
  return { x: d.hx, z: d.hz };
}

function createDrone(hx, hz, rMin, rMax, leash, temp) {
  const p = buildMesh();
  scene.add(p.g);
  const hp = HP[difficultyName()] || HP.normal;
  const d = {
    g: p.g, tilt: p.tilt, ring: p.ring,
    x: hx, z: hz, y: 0, alt: PATROL_ALT, yaw: Math.random() * 6.28,
    hx, hz, rMin, rMax, leash, temp: !!temp,
    hp, maxHp: hp, dead: false, deadT: 0, flash: 0,
    state: 'patrol', target: null, wp: null, clear: false,
    phase: Math.random() * 10, seed: Math.random() * 10,
    strafeDir: Math.random() < 0.5 ? -1 : 1, strafeT: 1,
    burstLeft: 0, shotT: 0, pauseT: 0, reactT: 0,
    senseT: Math.random() * 0.3, allyT: Math.random() * 0.6,
    vx: 0, vz: 0
  };
  d.wp = pickWp(d);
  if (!temp) { d.x = d.wp.x; d.z = d.wp.z; d.wp = pickWp(d); }
  d.y = groundHeight(d.x, d.z) + d.alt;
  p.g.position.set(d.x, d.y, d.z);
  look(d);
  drones.push(d);
  return d;
}

function spawnAll() {
  for (let i = 0; i < COUNT; i++) createDrone(TOWN.x, TOWN.z, PATROL_MIN, PATROL_MAX, LEASH, false);
  console.log('[drones] ' + COUNT + ' drones patrolling Port Town');
}

function respawn(d) {
  for (let k = 0; k < 12; k++) {
    const a = Math.random() * Math.PI * 2;
    const x = d.hx + Math.cos(a) * 65, z = d.hz + Math.sin(a) * 65;
    if (blockedAt(x, z, BODY_R + 0.5)) continue;
    if (Math.hypot(x - camPos.x, z - camPos.z) < 90) continue;     // never pops up next to you
    d.x = x; d.z = z; d.alt = 10;
    d.hp = d.maxHp = HP[difficultyName()] || HP.normal;
    d.dead = false; d.flash = 0; d.target = null; d.state = 'patrol';
    d.burstLeft = 0; d.pauseT = 0;
    d.wp = pickWp(d);
    d.y = groundHeight(x, z) + d.alt;
    d.g.position.set(d.x, d.y, d.z);
    d.g.visible = true;
    look(d);
    return;
  }
  d.deadT = RESPAWN - 5;                                          // try again in 5 s
}

function spawnTestDrone() {
  if (!started || !C) return 'drones are not ready yet';
  if (drones.length >= MAX_TOTAL) return 'too many drones';
  const dir = new THREE.Vector3();
  C.camera.getWorldDirection(dir);
  const x = camPos.x + dir.x * 25, z = camPos.z + dir.z * 25;
  createDrone(x, z, 8, 30, 80, true);
  return 'drone spawned 25 m ahead';
}

/* ---------- Targets ---------- */
function buildTargets() {
  gen++;
  targets.length = 0;
  if (C.isPlaying() && !C.player.dead && C.getHealth() > 0) targets.push({ kind: 'player', ref: C.player, gen });
  try {
    const sl = C.getSoldiers() || [];
    for (const s of sl) if (!s.dead) targets.push({ kind: 'soldier', ref: s, gen });
  } catch (e) { /* ignore */ }
  try {
    const gl = getBaseGuards();
    if (Array.isArray(gl)) for (const g of gl) if (!g.dead) targets.push({ kind: 'guard', ref: g, gen });
  } catch (e) { /* ignore */ }
}

function tpos(t, out) {
  const r = t.ref;
  out.x = r.x; out.z = r.z;
  out.y = t.kind === 'player' ? camPos.y - 0.5 : groundHeight(r.x, r.z) + 1.2;
}

function sense(d) {
  let t = d.target;
  if (t) {
    if (t.gen !== gen) t = targets.find((x) => x.ref === t.ref) || null;
    if (t) {
      const dd = Math.hypot(t.ref.x - d.x, t.ref.z - d.z);
      if (dd > SIGHT * 1.5 || Math.hypot(t.ref.x - d.hx, t.ref.z - d.hz) > d.leash + 30) t = null;
    }
  }
  let fresh = false;
  if (!t) {
    let best = null, bd = SIGHT;
    for (const c of targets) {
      const r = c.ref;
      const dd = Math.hypot(r.x - d.x, r.z - d.z);
      if (dd < bd && Math.hypot(r.x - d.hx, r.z - d.hz) <= d.leash) { best = c; bd = dd; }
    }
    if (best) { t = best; fresh = true; }
  }
  const was = d.state;
  d.target = t;
  d.state = t ? 'fight' : 'patrol';
  if (t && (fresh || was !== 'fight')) {
    d.reactT = REACT; d.burstLeft = 0; d.pauseT = 0.3;
    if (t.kind === 'player') warn('⚠ ENEMY DRONE');
  }
  if (!t && was === 'fight') { d.wp = pickWp(d); d.burstLeft = 0; }
  if (t) {
    tpos(t, TP);
    d.clear = lineClear(d.x, d.z, TP.x, TP.z);
  }
}

/* ---------- Combat ---------- */
function damageTarget(t, dmg, d) {
  if (t.kind === 'player') {
    if (C.hurtPlayer) C.hurtPlayer(dmg, d.x, d.z);
    else if (!warnedHurt) { warnedHurt = true; console.warn('[drones] ctx.hurtPlayer missing: drones cannot hurt the player yet (main.js needs hurtPlayer in the extras context)'); }
  } else if (t.kind === 'soldier') {
    hurtSoldier(t.ref, dmg);
  } else if (t.ref.hurt) {
    t.ref.hurt(dmg);
  }
}

function fire(d, t) {
  tpos(t, TP);
  const ox = d.x, oy = d.y - 0.3, oz = d.z;
  const dist = Math.hypot(TP.x - ox, TP.z - oz);
  const hit = Math.random() < Math.max(HIT_MIN, HIT_BASE - HIT_FALL * dist);
  let ex = TP.x, ey = TP.y, ez = TP.z;
  if (!hit) {
    ex += (Math.random() - 0.5) * 3;
    ey += (Math.random() - 0.5) * 1.5;
    ez += (Math.random() - 0.5) * 3;
  }
  beam(ox, oy, oz, ex, ey, ez, 0x00f0ff);
  zap(ox, oy, oz);
  if (hit) damageTarget(t, DMG[difficultyName()] || DMG.normal, d);
}

function killDrone(d) {
  d.dead = true; d.deadT = 0; d.target = null; d.burstLeft = 0;
  d.g.visible = false;
  boom(d.x, d.y, d.z);
  boomSound(d.x, d.y, d.z);
}

function hurtDrone(d, amount, from) {
  if (d.dead) return false;
  d.hp -= amount;
  d.flash = 0.12;
  if (d.hp <= 0) { killDrone(d); return true; }
  look(d);
  if (from === 'player' && d.state !== 'fight' && C && C.isPlaying() &&
      Math.hypot(C.player.x - d.hx, C.player.z - d.hz) <= d.leash + 40) {
    d.target = { kind: 'player', ref: C.player, gen };
    d.state = 'fight'; d.reactT = REACT; d.burstLeft = 0; d.pauseT = 0.3;
    warn('⚠ ENEMY DRONE');
  }
  return false;
}

// soldiers and base guards shoot back
function allyFire(d) {
  let shots = 0;
  const list = [];
  for (const t of targets) if (t.kind !== 'player') list.push(t.ref);
  for (const a of list) {
    if (a.dead) continue;
    if (Math.hypot(a.x - d.x, a.z - d.z) > ALLY_RANGE) continue;
    if (!lineClear(a.x, a.z, d.x, d.z)) continue;
    if (ALLY_FIRE_ANIM && a.char && typeof a.char.fire === 'function') a.char.fire();
    beam(a.x, groundHeight(a.x, a.z) + 1.3, a.z, d.x, d.y, d.z, 0xffd27a);
    if (Math.random() < ALLY_HIT) {
      if (hurtDrone(d, ALLY_DMG, 'ally')) return;
    }
    if (++shots >= 3) break;
  }
}

/* ---------- Your bullets ---------- */
const _o = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _u = new THREE.Vector3(), _v = new THREE.Vector3();
function pelletDir(base, spread, out) {
  _u.set(0, 1, 0).cross(base);
  if (_u.lengthSq() < 1e-4) _u.set(1, 0, 0);
  _u.normalize();
  _v.copy(base).cross(_u).normalize();
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
  out.copy(base).addScaledVector(_u, Math.cos(a) * r).addScaledVector(_v, Math.sin(a) * r).normalize();
}

function playerShot(kind) {
  const s = SHOTS[kind] || SHOTS.rifle;
  C.camera.getWorldPosition(_o);
  C.camera.getWorldDirection(_b);
  const dmgMap = new Map();
  for (let p = 0; p < s.pellets; p++) {
    if (s.pellets === 1) _d.copy(_b); else pelletDir(_b, s.spread, _d);
    let best = null, bestT = Infinity;
    for (const d of drones) {
      if (d.dead || !d.g.visible) continue;
      const cx = d.x - _o.x, cy = d.y - _o.y, cz = d.z - _o.z;
      const t = cx * _d.x + cy * _d.y + cz * _d.z;
      if (t < 0.5 || t > s.range || t >= bestT) continue;
      const d2 = cx * cx + cy * cy + cz * cz - t * t;
      if (d2 <= HIT_R * HIT_R) { best = d; bestT = t; }
    }
    if (!best) continue;
    if (!lineClear(_o.x, _o.z, best.x, best.z)) continue;          // a wall or tree is in the way
    const fall = s.pellets > 1 ? 1 - 0.5 * (bestT / s.range) : 1;
    dmgMap.set(best, (dmgMap.get(best) || 0) + s.dmg * fall);
  }
  if (!dmgMap.size) return;
  let killed = false;
  for (const [d, dmg] of dmgMap) if (hurtDrone(d, dmg, 'player')) killed = true;
  try { extrasEvent('hit', { head: false }); if (killed) extrasEvent('kill', { head: false }); } catch (e) { /* ignore */ }
}

/* ---------- Flying ---------- */
function move(d, dx, dz) {
  const nx = d.x + dx, nz = d.z + dz;
  if (!blockedAt(nx, nz, BODY_R)) { d.x = nx; d.z = nz; return true; }
  if (!blockedAt(nx, d.z, BODY_R)) { d.x = nx; return true; }
  if (!blockedAt(d.x, nz, BODY_R)) { d.z = nz; return true; }
  return false;
}

function updateDrone(d, dt) {
  if (d.dead) {
    d.deadT += dt;
    if (!d.temp && d.deadT >= RESPAWN) respawn(d);
    return;
  }
  d.phase += dt;
  if (d.flash > 0) { d.flash -= dt; if (d.flash <= 0) look(d); }

  d.senseT -= dt;
  if (d.senseT <= 0) { d.senseT = 0.3 + Math.random() * 0.1; sense(d); }

  d.g.visible = Math.hypot(d.x - camPos.x, d.z - camPos.z) < SHOW_DIST;

  let mx = 0, mz = 0, faceYaw = d.yaw;
  const t = d.target;

  if (d.state === 'fight' && t) {
    tpos(t, TP);
    const dx = TP.x - d.x, dz = TP.z - d.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist, nz = dz / dist;
    faceYaw = Math.atan2(-dx, -dz);

    d.strafeT -= dt;
    if (d.strafeT <= 0) { d.strafeDir *= -1; d.strafeT = 0.8 + Math.random() * 1.6; }
    if (!d.clear || dist > KEEP_MAX) { mx += nx * APPROACH; mz += nz * APPROACH; }
    else if (dist < KEEP_MIN)        { mx -= nx * BACKOFF;  mz -= nz * BACKOFF; }
    mx += -nz * d.strafeDir * STRAFE;
    mz +=  nx * d.strafeDir * STRAFE;

    d.reactT -= dt;
    if (d.pauseT > 0) d.pauseT -= dt;
    else if (d.burstLeft > 0) {
      d.shotT -= dt;
      if (d.shotT <= 0) {
        fire(d, t);
        d.burstLeft--;
        d.shotT = GAP;
        if (d.burstLeft <= 0) d.pauseT = PAUSE * (0.8 + Math.random() * 0.5);
      }
    } else if (d.reactT <= 0 && d.clear && dist <= RANGE) {
      d.burstLeft = BURST; d.shotT = 0;
    }
  } else {
    const dx = d.wp.x - d.x, dz = d.wp.z - d.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 3 || Math.hypot(d.x - d.hx, d.z - d.hz) > d.leash) d.wp = pickWp(d);
    else { mx = dx / dist * PATROL_SPEED; mz = dz / dist * PATROL_SPEED; faceYaw = Math.atan2(-mx, -mz); }
  }

  // keep apart from other drones
  for (const o of drones) {
    if (o === d || o.dead) continue;
    const ox = d.x - o.x, oz = d.z - o.z, od = Math.hypot(ox, oz);
    if (od < 5 && od > 0.01) { mx += ox / od * 2; mz += oz / od * 2; }
  }

  const moved = move(d, mx * dt, mz * dt);
  if (!moved) {
    if (d.state === 'fight') d.strafeDir *= -1; else d.wp = pickWp(d);
  }
  d.vx += (mx - d.vx) * Math.min(1, dt * 4);
  d.vz += (mz - d.vz) * Math.min(1, dt * 4);

  // height: follows the ground, bobs gently
  const wantAlt = d.state === 'fight'
    ? COMBAT_ALT + Math.sin(d.phase * 3 + d.seed) * 1.2
    : PATROL_ALT + Math.sin(d.phase * 1.2 + d.seed) * 0.8;
  d.alt += (wantAlt - d.alt) * Math.min(1, dt * 2);
  const wantY = groundHeight(d.x, d.z) + Math.max(3, d.alt);
  d.y += (wantY - d.y) * Math.min(1, dt * 6);

  // turn and tilt
  d.yaw += angDiff(d.yaw, faceYaw) * Math.min(1, dt * 5);
  const fx0 = -Math.sin(d.yaw), fz0 = -Math.cos(d.yaw);
  const fwd = d.vx * fx0 + d.vz * fz0;
  const side = d.vx * fz0 * -1 + d.vz * fx0;
  d.tilt.rotation.x += (Math.max(-0.35, Math.min(0.35, -fwd * 0.04)) - d.tilt.rotation.x) * Math.min(1, dt * 5);
  d.tilt.rotation.z += (Math.max(-0.35, Math.min(0.35, side * 0.04)) - d.tilt.rotation.z) * Math.min(1, dt * 5);

  d.g.position.set(d.x, d.y, d.z);
  d.g.rotation.y = d.yaw;

  // allies shoot back
  d.allyT -= dt;
  if (d.allyT <= 0) { d.allyT = 0.6; if (d.g.visible) allyFire(d); }
}

/* ---------- extras.js hooks ---------- */
export function init(ctx) {
  C = ctx;
  scene = ctx.scene;
  makeBeams();
  loadModel();
  window.spawnDrone = spawnTestDrone;
  window.dronesInfo = () => {
    const alive = drones.filter((d) => !d.dead);
    console.log('[drones] alive ' + alive.length + '/' + drones.length +
      ' | fighting ' + alive.filter((d) => d.state === 'fight').length);
    return alive.map((d) => ({ x: Math.round(d.x), z: Math.round(d.z), hp: Math.round(d.hp), state: d.state }));
  };
}

export function update(dt, ctx) {
  C = ctx;
  if (!started) {
    if (loaded && ctx.isReady()) { started = true; spawnAll(); }
    else return;
  }
  dt = Math.min(dt, 0.1);
  ctx.camera.getWorldPosition(camPos);

  if (!ctx.isPlaying()) { setHum(0, 0); return; }          // paused: everything freezes

  ac();
  senseT -= dt;
  if (senseT <= 0) { senseT = 0.3; buildTargets(); }

  for (const d of drones) updateDrone(d, dt);
  updateBeams(dt);
  updateFx(dt);

  // rotor hum follows the nearest living drone
  let near = null, nd = Infinity;
  for (const d of drones) {
    if (d.dead || !d.g.visible) continue;
    const dd = Math.hypot(d.x - camPos.x, d.y - camPos.y, d.z - camPos.z);
    if (dd < nd) { nd = dd; near = d; }
  }
  if (near) {
    const s = spatial(near.x, near.y, near.z);
    setHum(HUM_VOL * Math.pow(Math.max(0, 1 - nd / 60), 1.5), s.pan);
  } else setHum(0, 0);
}

export function onEvent(name, data, ctx) {
  C = ctx || C;
  if (!started || !C) return;
  if (name === 'shot') playerShot((data && data.kind) || 'rifle');
  else if (name === 'restart') reset(C);
}

export function reset(ctx) {
  for (let i = drones.length - 1; i >= 0; i--) {
    const d = drones[i];
    if (d.temp) { scene.remove(d.g); drones.splice(i, 1); continue; }
    d.hp = d.maxHp = HP[difficultyName()] || HP.normal;
    d.dead = false; d.deadT = 0; d.flash = 0; d.target = null; d.state = 'patrol';
    d.burstLeft = 0; d.pauseT = 0; d.alt = PATROL_ALT;
    d.wp = pickWp(d);
    d.x = d.wp.x; d.z = d.wp.z; d.wp = pickWp(d);
    d.y = groundHeight(d.x, d.z) + d.alt;
    d.g.position.set(d.x, d.y, d.z);
    d.g.visible = true;
    look(d);
  }
  for (const b of beams) { b.life = 0; b.l.visible = false; }
  clearFx();
  setHum(0, 0);
}

// for the minimap and other files
export function getDrones() { return drones; }