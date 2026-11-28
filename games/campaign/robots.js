// games/campaign/robots.js  (v2)
// Space Gang ground robots for Port Town (look copied from War: code-built mech and sentry turret).
//  - 2 MECHS near the Town Hall / square: slow, tough, they walk (walls and trees block them, they use the A* paths when
//    they lose sight of you), keep 14-26 m away and fire red bursts from two arm guns.
//  - 4 SENTRY TURRETS at the checkpoints: fixed, the head turns, they "lock on" so their aim gets better the longer
//    they see you. Hide behind a wall to break the lock.
//  - Real health: your guns work (the 'shot' event is ray-tested here, no player.js edit). A small health bar shows
//    above a robot once it is damaged.
//  - Your soldiers and the base guards shoot back.  Own sounds, own explosions.
//  - The player cannot walk through a robot (gentle push-out).
//  v2: your shots now fly OVER low cover (sandbags, barriers) when you aim over it, and the robots' hit boxes
//      match their models (bigger), so far shots on turrets and mechs hit.
// Loaded by extras.js ('robots' is already in MODULES).
// Console: spawnMech(), spawnTurret(), robotsInfo()
// For other files: getRobots(), robotsAlive(), spawnRobot('mech'|'turret', x, z, {scale, hp, temp, leash})


import * as THREE from 'three';
import { blockedAt, lineClear, groundHeight } from './collision.js';
import { findPath } from './pathfinding.js';
import { hurtSoldier } from './units.js';
import { getBaseGuards } from './base-npcs.js';
import { difficultyName } from './enemies.js';
import { extrasEvent } from './extras.js';


/* ---------- Where they stand (x, z). A spot inside a wall is moved to the nearest free spot ---------- */
const TOWN    = { x: 120, z: 80 };
const MECHS   = [{ x: 106, z: 91 }, { x: 134, z: 91 }];
const TURRETS = [{ x: 96, z: 89 },      // West Checkpoint
                 { x: 150, z: 70 },     // East Barricade
                 { x: 129, z: 108 },    // South Checkpoint
                 { x: 106, z: 67 }];    // Town Hall front


/* ---------- Mech settings ---------- */
const MECH_SCALE   = 1.2;                              // same as War
const MECH_HP      = { easy: 300, normal: 450, hard: 600 };
const MECH_DMG     = { easy: 6,   normal: 8,   hard: 10 };
const MECH_SIGHT   = 60;           // sees you within this distance (needs a clear line)
const MECH_RANGE   = 40;           // shoots within this distance
const KEEP_MIN     = 14;           // backs off if you are closer
const KEEP_MAX     = 26;           // walks closer if you are further
const MECH_SPEED   = 2.4;
const MECH_TURN    = 2.2;          // body turn speed (rad/s)
const MECH_R       = 1.3;          // collision radius (walls and trees)
const MECH_HIT_R   = 1.9;          // your bullets: radius (x scale)  (v2: was 1.4)
const MECH_BODY_R  = 1.4;          // the solid body you cannot walk through (x scale)
const MECH_HEIGHT  = 4.6;          // your bullets: height (x scale)
const MECH_BURST   = 4;
const MECH_GAP     = 0.35;
const MECH_PAUSE   = 1.2;
const MECH_REACT   = 1.0;          // seconds before the first shot after it spots you
const MECH_HIT     = 0.55;         // base chance to hit, falls with distance
const MECH_HIT_FALL = 0.008;
const MECH_LEASH   = 75;           // never walks further than this from its post
const PATROL_R     = 8;            // idle patrol around its post


/* ---------- Turret settings ---------- */
const TURRET_HP    = { easy: 150, normal: 200, hard: 260 };
const TURRET_DMG   = { easy: 4,   normal: 5,   hard: 7 };
const TURRET_SIGHT = 50;
const TURRET_RANGE = 45;
const TURRET_TURN  = 3.0;          // head turn speed (rad/s)
const TURRET_BURST = 8;
const TURRET_GAP   = 0.14;
const TURRET_PAUSE = 1.4;
const TURRET_REACT = 0.6;
const LOCK_RISE    = 0.5;          // per second while it sees you
const LOCK_FALL    = 1.0;
const TURRET_HIT_R = 1.25;         // your bullets: radius  (v2: was 0.9)
const TURRET_HEIGHT = 1.8;         // your bullets: height  (v2: was 1.5)
const TURRET_SWEEP = 0.9;          // idle scan angle (rad)


/* ---------- Shared settings ---------- */
const HIT_MIN      = 0.12;
const ALLY_RANGE   = 35;           // soldiers / guards shoot robots within this distance
const ALLY_HIT     = 0.40;
const ALLY_DMG     = 7;
const ALLY_FIRE_ANIM = true;
const RESPAWN      = 0;            // seconds until a destroyed robot returns (0 = never)
const SHOW_DIST    = 300;
const SHADOWS      = true;
const VOLUME       = 0.8;
const MAX_DIST     = 140;          // sounds fade out at this distance
const MAX_TOTAL    = 12;           // with test robots
const LOW_COVER    = 1.3;          // your bullet flies over cover when it is higher than this above the ground (m)
const THICK_WALL   = 1.5;          // a wall thicker than this (m) always stops your bullet (buildings)


const SHOTS = {                    // same numbers as your guns in player.js
  pistol:  { dmg: 28, range: 70,  pellets: 1, spread: 0 },
  rifle:   { dmg: 18, range: 130, pellets: 1, spread: 0 },
  shotgun: { dmg: 14, range: 35,  pellets: 8, spread: 0.04 }
};


/* ---------- State ---------- */
let C = null, scene = null, started = false;
let senseT = 0, warnT = 0, clockT = 0;
const robots = [];
const targets = [];
const camPos = new THREE.Vector3();
const TP = { x: 0, y: 0, z: 0 };
const MP = new THREE.Vector3();


/* ---------- Helpers ---------- */
const pick = (tbl) => tbl[difficultyName()] || tbl.normal;
function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const mats = (o) => (Array.isArray(o.material) ? o.material : [o.material]);


/* ---------- Models (copied from War models.js) ---------- */
function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color, metalness: o.metal ?? 0.15, roughness: o.rough ?? 0.7,
    envMapIntensity: o.env ?? 0.6, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 0
  });
}
const neon = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  me.position.set(x, y, z);
  return me;
}
function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 16) {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  me.position.set(x, y, z);
  return me;
}


function buildMech(scale) {
  const g = new THREE.Group();
  const hull = mat(0x4d5148, { metal: 0.4, rough: 0.6 });
  const dark = mat(0x1e2024, { metal: 0.5, rough: 0.5 });
  const legL = new THREE.Group(); legL.position.set(-0.9, 2.2, 0);
  const legR = new THREE.Group(); legR.position.set(0.9, 2.2, 0);
  [legL, legR].forEach((l) => {
    l.add(box(0.7, 2.2, 0.8, dark, 0, -1.1, 0));
    l.add(box(0.9, 0.3, 1.3, hull, 0, -2.05, -0.2));
  });
  g.add(legL, legR);
  const torso = new THREE.Group();
  torso.position.y = 3.2;
  torso.add(box(2.6, 1.7, 1.6, hull));
  torso.add(box(1.0, 0.3, 0.1, neon(0xff2d4a), 0, 0.35, -0.82));
  const muzzles = [-1, 1].map((sx) => {
    torso.add(box(0.6, 0.7, 1.8, dark, sx * 1.6, 0, -0.5));
    const m = new THREE.Object3D();
    m.position.set(sx * 1.6, 0, -1.5);
    torso.add(m);
    return m;
  });
  g.add(torso);
  g.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS; });
  g.scale.setScalar(scale);
  g.userData = { legL, legR, torso, muzzles };
  return g;
}


function animateMech(g, phase, amount) {
  const u = g.userData;
  u.legL.rotation.x =  Math.sin(phase) * 0.45 * amount;
  u.legR.rotation.x = -Math.sin(phase) * 0.45 * amount;
  u.torso.position.y = 3.2 + Math.abs(Math.sin(phase)) * 0.08 * amount;
}


function buildTurret() {
  const g = new THREE.Group();
  const hull = mat(0x4d5148, { metal: 0.4, rough: 0.6 });
  const dark = mat(0x15171a, { metal: 0.6, rough: 0.4 });
  g.add(cyl(0.8, 1.0, 0.6, hull, 0, 0.3, 0));
  const head = new THREE.Group();
  head.position.y = 1.0;
  head.add(box(0.9, 0.55, 0.9, hull));
  const barrel = cyl(0.1, 0.12, 1.3, dark, 0, 0, -0.9);
  barrel.rotation.x = Math.PI / 2;
  head.add(barrel);
  head.add(box(0.5, 0.1, 0.06, neon(0xff2d4a), 0, 0.12, -0.46));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -1.6);
  head.add(muzzle);
  g.add(head);
  g.traverse((o) => { if (o.isMesh) o.castShadow = SHADOWS; });
  g.userData = { head, muzzle };
  return g;
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


/* ---------- Health bar above a damaged robot ---------- */
function makeBar(r) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 16;
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  const w = r.kind === 'mech' ? 4 * r.sc : 2.2;
  sp.scale.set(w, w / 8, 1);
  sp.renderOrder = 10;
  sp.visible = false;
  scene.add(sp);
  r.bar = sp; r.barCtx = c.getContext('2d'); r.barTex = tex;
}
function drawBar(r) {
  const c = r.barCtx;
  c.clearRect(0, 0, 128, 16);
  c.fillStyle = 'rgba(0,0,0,0.7)';
  c.fillRect(0, 0, 128, 16);
  const f = Math.max(0, r.hp / r.maxHp);
  c.fillStyle = f > 0.6 ? '#3ddc6b' : f > 0.3 ? '#ffb02e' : '#ff4a3d';
  c.fillRect(2, 2, 124 * f, 12);
  r.barTex.needsUpdate = true;
}


/* ---------- Beams (tracers) ---------- */
const beams = [];
let beamI = 0;
function makeBeams() {
  for (let i = 0; i < 20; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const m = new THREE.LineBasicMaterial({ color: 0xff2d4a, transparent: true, opacity: 1, toneMapped: false });
    const l = new THREE.Line(geo, m);
    l.visible = false;
    l.frustumCulled = false;
    scene.add(l);
    beams.push({ l, life: 0, max: 0.1 });
  }
}
function beam(x1, y1, z1, x2, y2, z2, color, life = 0.1) {
  const b = beams[beamI++ % beams.length];
  const p = b.l.geometry.attributes.position;
  p.setXYZ(0, x1, y1, z1);
  p.setXYZ(1, x2, y2, z2);
  p.needsUpdate = true;
  b.l.material.color.setHex(color);
  b.l.material.opacity = 1;
  b.l.visible = true;
  b.life = life; b.max = life;
}
function updateBeams(dt) {
  for (const b of beams) {
    if (b.life <= 0) continue;
    b.life -= dt;
    if (b.life <= 0) b.l.visible = false;
    else b.l.material.opacity = b.life / b.max;
  }
}


/* ---------- Explosion effect ---------- */
const fx = [];
const debrisGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
const debrisMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.5 });
function ball(x, y, z, color, life, grow) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false }));
  m.position.set(x, y, z);
  scene.add(m);
  fx.push({ kind: 'flash', o: m, t: 0, life, grow });
}
function boom(x, y, z, big) {
  const k = big ? 1 : 0.6;
  ball(x, y, z, 0xffb347, 0.7, 5 * k);
  ball(x, y, z, 0xff4a1a, 0.5, 3.2 * k);
  const n = big ? 16 : 9;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(debrisGeo, debrisMat);
    m.position.set(x, y, z);
    const a = Math.random() * Math.PI * 2;
    const sp = (3 + Math.random() * 6) * (big ? 1.3 : 1);
    scene.add(m);
    fx.push({ kind: 'debris', o: m, t: 0, life: 1.9,
      vx: Math.cos(a) * sp, vy: 4 + Math.random() * 7, vz: Math.sin(a) * sp,
      rx: Math.random() * 8, rz: Math.random() * 8 });
  }
}
function dropFx(f) {
  scene.remove(f.o);
  if (f.kind === 'flash') { f.o.geometry.dispose(); f.o.material.dispose(); }
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    const k = f.t / f.life;
    if (f.kind === 'flash') {
      f.o.scale.setScalar(0.5 + k * f.grow);
      f.o.material.opacity = Math.max(0, 0.95 * (1 - k));
    } else {
      f.vy -= 14 * dt;
      f.o.position.x += f.vx * dt;
      f.o.position.y += f.vy * dt;
      f.o.position.z += f.vz * dt;
      f.o.rotation.x += f.rx * dt;
      f.o.rotation.z += f.rz * dt;
      const gy = groundHeight(f.o.position.x, f.o.position.z);
      if (f.o.position.y < gy + 0.14) { f.o.position.y = gy + 0.14; f.vx *= 0.3; f.vz *= 0.3; f.vy = 0; }
      f.o.scale.setScalar(Math.max(0.01, 1 - Math.max(0, k - 0.7) / 0.3));
    }
    if (f.t >= f.life) { dropFx(f); fx.splice(i, 1); }
  }
}
function clearFx() {
  for (const f of fx) dropFx(f);
  fx.length = 0;
}


/* ---------- Sound (own small audio graph) ---------- */
let AC = null, master = null, noiseBuf = null;
function ac() {
  if (!AC) {
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain();
      master.gain.value = VOLUME;
      master.connect(AC.destination);
      noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
      const a = noiseBuf.getChannelData(0);
      for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
    } catch (e) { AC = null; return null; }
  }
  if (AC.state === 'suspended') AC.resume().catch(() => {});
  return AC;
}
function outNode(pan) {
  if (AC.createStereoPanner) {
    const p = AC.createStereoPanner();
    p.pan.value = pan;
    p.connect(master);
    return p;
  }
  return master;
}
function spatial(x, y, z) {
  const dx = x - camPos.x, dy = y - camPos.y, dz = z - camPos.z;
  const dist = Math.hypot(dx, dy, dz) || 0.001;
  const e = C.camera.matrixWorld.elements;
  const lateral = (dx * e[0] + dy * e[1] + dz * e[2]) / dist;
  return { vol: Math.pow(Math.max(0, 1 - dist / MAX_DIST), 1.4), pan: Math.max(-1, Math.min(1, lateral)) * 0.8 };
}
function noiseHit(t, dur, f0, f1, vol, o, type) {
  const src = AC.createBufferSource();
  src.buffer = noiseBuf;
  const f = AC.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(o);
  src.start(t, Math.random() * 0.15);
  src.stop(t + dur + 0.02);
}
function toneHit(t, dur, f0, f1, vol, o, type) {
  const os = AC.createOscillator();
  os.type = type;
  os.frequency.setValueAtTime(f0, t);
  os.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  os.connect(g); g.connect(o);
  os.start(t); os.stop(t + dur + 0.02);
}
function sound(kind, x, y, z) {
  if (!ac()) return;
  const s = spatial(x, y, z);
  if (s.vol < 0.03) return;
  const t = AC.currentTime, o = outNode(s.pan);
  if (kind === 'mech') {
    noiseHit(t, 0.22, 1400, 200, 0.5 * s.vol, o, 'lowpass');
    toneHit(t, 0.2, 160, 50, 0.5 * s.vol, o, 'sine');
  } else if (kind === 'turret') {
    noiseHit(t, 0.06, 3500, 1200, 0.32 * s.vol, o, 'bandpass');
  } else if (kind === 'step') {
    toneHit(t, 0.28, 72, 30, 0.9 * s.vol, o, 'sine');
    noiseHit(t, 0.1, 400, 100, 0.3 * s.vol, o, 'lowpass');
  } else if (kind === 'boom') {
    noiseHit(t, 0.9, 2200, 90, 1.0 * s.vol, o, 'lowpass');
    toneHit(t, 0.5, 100, 32, 0.9 * s.vol, o, 'sine');
  } else if (kind === 'boomSmall') {
    noiseHit(t, 0.6, 2000, 120, 0.8 * s.vol, o, 'lowpass');
    toneHit(t, 0.35, 120, 40, 0.7 * s.vol, o, 'sine');
  }
}


/* ---------- Warning text ---------- */
let warnEl = null;
function warn(text) {
  if (performance.now() - warnT < 12000) return;
  warnT = performance.now();
  if (!warnEl) {
    warnEl = document.createElement('div');
    warnEl.style.cssText = 'position:fixed;top:29%;left:50%;transform:translateX(-50%);z-index:60;' +
      'pointer-events:none;color:#ff4a3d;font:700 18px system-ui,sans-serif;letter-spacing:3px;' +
      'text-shadow:0 0 10px #ff2d2d,0 2px 4px #000;opacity:0;transition:opacity .3s';
    document.body.appendChild(warnEl);
  }
  warnEl.textContent = text;
  warnEl.style.opacity = '1';
  setTimeout(() => { if (warnEl) warnEl.style.opacity = '0'; }, 2500);
}


/* ---------- Finding a free spot ---------- */
function findFree(x, z, r) {
  if (!blockedAt(x, z, r)) return { x, z };
  for (let ring = 2; ring <= 16; ring += 2) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const px = x + Math.cos(a) * ring, pz = z + Math.sin(a) * ring;
      if (!blockedAt(px, pz, r)) return { x: px, z: pz };
    }
  }
  return null;
}


/* ---------- Creating robots ---------- */
function createRobot(kind, x, z, o = {}) {
  const mech = kind === 'mech';
  const sc = mech ? (o.scale || MECH_SCALE) : 1;
  const spot = findFree(x, z, mech ? MECH_R + 0.4 : 1.4);
  if (!spot) { console.warn('[robots] no free spot near ' + x + ',' + z + ', ' + kind + ' skipped'); return null; }
  const g = mech ? buildMech(sc) : buildTurret();
  scene.add(g);
  const maxHp = o.hp || pick(mech ? MECH_HP : TURRET_HP);
  const outward = Math.atan2(-(spot.x - TOWN.x), -(spot.z - TOWN.z));
  const toTown = Math.atan2(TOWN.x - spot.x, TOWN.z - spot.z) + Math.PI;
  const r = {
    kind, g, sc,
    x: spot.x, z: spot.z, y: groundHeight(spot.x, spot.z),
    hx: spot.x, hz: spot.z,
    yaw: mech ? toTown : 0, hy: outward, h0: outward,
    h: (mech ? MECH_HEIGHT : TURRET_HEIGHT) * sc, hr: (mech ? MECH_HIT_R : TURRET_HIT_R) * sc,
    leash: o.leash || MECH_LEASH, temp: !!o.temp,
    hp: maxHp, maxHp, dead: false, deadT: 0, flash: 0,
    state: 'idle', target: null, clear: false, lostT: 0,
    lock: 0, reactT: 0, burstLeft: 0, shotT: 0, pauseT: 0, muzzleI: 0,
    phase: Math.random() * 6, amt: 0, stepN: 0, seed: Math.random() * 10,
    path: null, pi: 0, pathT: 0, wp: null, idleT: 1 + Math.random() * 3, wpT: 0,
    stuckT: 0, sideT: 0, sideDir: 1,
    senseT: Math.random() * 0.3, allyT: Math.random() * 0.6
  };
  r.g.position.set(r.x, r.y, r.z);
  r.g.rotation.y = mech ? r.yaw : 0;
  if (!mech) r.g.userData.head.rotation.y = r.hy;
  makeBar(r);
  robots.push(r);
  return r;
}


function spawnAll() {
  let m = 0, t = 0;
  for (const p of MECHS) if (createRobot('mech', p.x, p.z)) m++;
  for (const p of TURRETS) if (createRobot('turret', p.x, p.z)) t++;
  console.log('[robots] ' + m + ' mechs and ' + t + ' turrets guard Port Town');
}


function testSpawn(kind, dist) {
  if (!started || !C) return 'robots are not ready yet';
  if (robots.length >= MAX_TOTAL) return 'too many robots';
  const dir = new THREE.Vector3();
  C.camera.getWorldDirection(dir);
  const r = createRobot(kind, camPos.x + dir.x * dist, camPos.z + dir.z * dist, { temp: true, leash: 90 });
  return r ? kind + ' spawned ' + dist + ' m ahead' : 'no free spot there, turn around and try again';
}


/* ---------- Targets ---------- */
function buildTargets() {
  targets.length = 0;
  if (C.isPlaying() && !C.player.dead && C.getHealth() > 0) targets.push({ kind: 'player', ref: C.player });
  try {
    const sl = C.getSoldiers() || [];
    for (const s of sl) if (!s.dead) targets.push({ kind: 'soldier', ref: s });
  } catch (e) { /* ignore */ }
  try {
    const gl = getBaseGuards();
    if (Array.isArray(gl)) for (const g of gl) if (!g.dead) targets.push({ kind: 'guard', ref: g });
  } catch (e) { /* ignore */ }
}


function tpos(t, out) {
  const r = t.ref;
  out.x = r.x; out.z = r.z;
  out.y = t.kind === 'player' ? camPos.y - 0.5 : groundHeight(r.x, r.z) + 1.2;
}


const cand = [];
function pickTarget(r, sight) {
  cand.length = 0;
  for (const c of targets) {
    const dd = Math.hypot(c.ref.x - r.x, c.ref.z - r.z);
    if (dd < sight && Math.hypot(c.ref.x - r.hx, c.ref.z - r.hz) <= r.leash) cand.push({ c, dd });
  }
  if (!cand.length) return null;
  cand.sort((a, b) => a.dd - b.dd);
  for (let i = 0; i < cand.length && i < 3; i++) {
    const c = cand[i].c;
    if (lineClear(r.x, r.z, c.ref.x, c.ref.z)) return c;
  }
  return null;
}


function sense(r) {
  const mech = r.kind === 'mech';
  const sight = mech ? MECH_SIGHT : TURRET_SIGHT;
  let t = r.target;
  if (t) t = targets.find((x) => x.ref === t.ref) || null;
  if (t) {
    const dd = Math.hypot(t.ref.x - r.x, t.ref.z - r.z);
    r.clear = lineClear(r.x, r.z, t.ref.x, t.ref.z);
    if (r.clear) r.lostT = 0; else r.lostT += 0.35;
    const lose = mech
      ? (dd > sight * 1.5 || r.lostT > 8 || Math.hypot(t.ref.x - r.hx, t.ref.z - r.hz) > r.leash + 25)
      : (dd > sight * 1.15 || r.lostT > 2.5);
    if (lose) t = null;
  }
  let fresh = false;
  if (!t) {
    const f = pickTarget(r, sight);
    if (f) { t = f; fresh = true; r.clear = true; r.lostT = 0; }
  }
  const was = r.state;
  r.target = t;
  r.state = t ? 'fight' : 'idle';
  if (t && (fresh || was !== 'fight')) {
    r.reactT = mech ? MECH_REACT : TURRET_REACT;
    r.burstLeft = 0; r.pauseT = 0.3; r.path = null;
    if (t.kind === 'player') warn(mech ? '⚠ HEAVY MECH' : '⚠ SENTRY TURRET');
  }
  if (!t && was === 'fight') { r.burstLeft = 0; r.lock = 0; r.path = null; r.wp = null; r.idleT = 2; }
}


/* ---------- Combat ---------- */
function damageTarget(t, dmg, r) {
  if (t.kind === 'player') { if (C.hurtPlayer) C.hurtPlayer(dmg, r.x, r.z); }
  else if (t.kind === 'soldier') hurtSoldier(t.ref, dmg);
  else if (t.ref.hurt) t.ref.hurt(dmg);
}


function shoot(r, t, chance, dmg, mx, my, mz) {
  tpos(t, TP);
  const hit = Math.random() < chance;
  let ex = TP.x, ey = TP.y, ez = TP.z;
  if (!hit) {
    ex += (Math.random() - 0.5) * 3.5;
    ey += (Math.random() - 0.5) * 1.6;
    ez += (Math.random() - 0.5) * 3.5;
  }
  beam(mx, my, mz, ex, ey, ez, 0xff2d4a, r.kind === 'mech' ? 0.12 : 0.06);
  sound(r.kind, mx, my, mz);
  if (hit) damageTarget(t, dmg, r);
}


function fireMech(r, t) {
  const u = r.g.userData;
  r.g.updateMatrixWorld(true);
  const m = u.muzzles[r.muzzleI++ % 2];
  m.getWorldPosition(MP);
  tpos(t, TP);
  const dist = Math.hypot(TP.x - r.x, TP.z - r.z);
  shoot(r, t, Math.max(HIT_MIN, MECH_HIT - MECH_HIT_FALL * dist), pick(MECH_DMG), MP.x, MP.y, MP.z);
}


function fireTurret(r, t) {
  const u = r.g.userData;
  r.g.updateMatrixWorld(true);
  u.muzzle.getWorldPosition(MP);
  tpos(t, TP);
  const dist = Math.hypot(TP.x - r.x, TP.z - r.z);
  const chance = Math.max(0.08, Math.min(0.7, 0.12 + 0.45 * r.lock - 0.004 * dist));
  shoot(r, t, chance, pick(TURRET_DMG), MP.x, MP.y, MP.z);
}


function updateBar(r) {
  if (!r.bar) return;
  const show = !r.dead && r.hp < r.maxHp && r.g.visible &&
    Math.hypot(r.x - camPos.x, r.z - camPos.z) < 90;
  r.bar.visible = show;
  if (show) r.bar.position.set(r.x, r.y + r.h + 0.9, r.z);
}


function killRobot(r) {
  r.dead = true; r.deadT = 0; r.target = null; r.burstLeft = 0; r.state = 'idle';
  r.g.visible = false;
  if (r.bar) r.bar.visible = false;
  const big = r.kind === 'mech';
  boom(r.x, r.y + r.h * 0.5, r.z, big);
  sound(big ? 'boom' : 'boomSmall', r.x, r.y + r.h * 0.5, r.z);
}


function hurtRobot(r, amount, from) {
  if (r.dead) return false;
  r.hp -= amount;
  r.flash = 0.08;
  glow(r.g, 0xffffff, 0.9);
  if (r.hp <= 0) { killRobot(r); return true; }
  drawBar(r);
  if (from === 'player' && r.state !== 'fight' && C && C.isPlaying() && !C.player.dead &&
      Math.hypot(C.player.x - r.hx, C.player.z - r.hz) <= r.leash + 40) {
    r.target = { kind: 'player', ref: C.player };
    r.state = 'fight'; r.clear = true; r.lostT = 0; r.burstLeft = 0; r.pauseT = 0.3;
    r.reactT = r.kind === 'mech' ? MECH_REACT : TURRET_REACT;
    warn(r.kind === 'mech' ? '⚠ HEAVY MECH' : '⚠ SENTRY TURRET');
  }
  return false;
}


// soldiers and base guards shoot back
function allyFire(r) {
  let shots = 0;
  for (const t of targets) {
    if (t.kind === 'player') continue;
    const a = t.ref;
    if (a.dead) continue;
    if (Math.hypot(a.x - r.x, a.z - r.z) > ALLY_RANGE) continue;
    if (!lineClear(a.x, a.z, r.x, r.z)) continue;
    if (ALLY_FIRE_ANIM && a.char && typeof a.char.fire === 'function') a.char.fire();
    beam(a.x, groundHeight(a.x, a.z) + 1.3, a.z, r.x, r.y + r.h * 0.5, r.z, 0xffd27a);
    if (Math.random() < ALLY_HIT && hurtRobot(r, ALLY_DMG, 'ally')) return;
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
  const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * spread;
  out.copy(base).addScaledVector(_u, Math.cos(a) * rr).addScaledVector(_v, Math.sin(a) * rr).normalize();
}


// ray against an upright cylinder; returns the distance along the ray, or -1
function rayCyl(o, d, cx, cz, rad, y0, y1, range) {
  const fx = o.x - cx, fz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  let t0, t1;
  if (a < 1e-8) {
    if (fx * fx + fz * fz > rad * rad) return -1;
    t0 = 0; t1 = range;
  } else {
    const b = fx * d.x + fz * d.z;
    const c = fx * fx + fz * fz - rad * rad;
    const disc = b * b - a * c;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    t0 = (-b - s) / a; t1 = (-b + s) / a;
  }
  if (t1 < 0) return -1;
  t0 = Math.max(t0, 0.3); t1 = Math.min(t1, range);
  if (t0 > t1) return -1;
  if (Math.abs(d.y) < 1e-6) {
    if (o.y < y0 || o.y > y1) return -1;
  } else {
    let ta = (y0 - o.y) / d.y, tb = (y1 - o.y) / d.y;
    if (ta > tb) { const q = ta; ta = tb; tb = q; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}


// v2: is a wall in the way of the bullet (_o, _d) before it reaches distance tEnd?
// lineClear() is flat and ignores height, so low sandbags/barriers used to stop shots that fly over them.
// Now: low cover blocks only a LOW shot, a thick wall (a building) always blocks.
// The last 2 m before the robot are ignored (its own sandbags).
function shotBlocked(tEnd) {
  let run = 0;
  for (let t = 1; t < tEnd - 2; t += 0.5) {
    const x = _o.x + _d.x * t, z = _o.z + _d.z * t;
    if (!blockedAt(x, z, 0.05)) { run = 0; continue; }
    run++;
    if (_o.y + _d.y * t - groundHeight(x, z) < LOW_COVER || run * 0.5 >= THICK_WALL) return true;
  }
  return false;
}


function playerShot(kind) {
  const s = SHOTS[kind] || SHOTS.rifle;
  C.camera.getWorldPosition(_o);
  C.camera.getWorldDirection(_b);
  const dmgMap = new Map();
  for (let p = 0; p < s.pellets; p++) {
    if (s.pellets === 1) _d.copy(_b); else pelletDir(_b, s.spread, _d);
    let best = null, bestT = Infinity;
    for (const r of robots) {
      if (r.dead || !r.g.visible) continue;
      const t = rayCyl(_o, _d, r.x, r.z, r.hr, r.y, r.y + r.h, s.range);
      if (t >= 0 && t < bestT) { best = r; bestT = t; }
    }
    if (!best) continue;
    if (shotBlocked(bestT)) continue;                                                  // a wall is in the way
    const fall = s.pellets > 1 ? 1 - 0.5 * (bestT / s.range) : 1;
    dmgMap.set(best, (dmgMap.get(best) || 0) + s.dmg * fall);
  }
  if (!dmgMap.size) return;
  let killed = false;
  for (const [r, dmg] of dmgMap) if (hurtRobot(r, dmg, 'player')) killed = true;
  try { extrasEvent('hit', { head: false }); if (killed) extrasEvent('kill', { head: false }); } catch (e) { /* ignore */ }
}


/* ---------- Walking (mechs) ---------- */
function stepMove(r, dx, dz) {
  const nx = r.x + dx, nz = r.z + dz;
  if (!blockedAt(nx, nz, MECH_R)) { r.x = nx; r.z = nz; return true; }
  if (!blockedAt(nx, r.z, MECH_R)) { r.x = nx; return true; }
  if (!blockedAt(r.x, nz, MECH_R)) { r.z = nz; return true; }
  return false;
}


function toPoints(p) {
  try {
    if (p && !Array.isArray(p) && Array.isArray(p.path)) p = p.path;
    if (!Array.isArray(p) || !p.length) return null;
    if (typeof p[0] === 'number') {
      const out = [];
      for (let i = 0; i + 1 < p.length; i += 2) out.push({ x: p[i], z: p[i + 1] });
      return out;
    }
    return p.map((q) => (Array.isArray(q) ? { x: q[0], z: q[1] } : q))
      .filter((q) => q && isFinite(q.x) && isFinite(q.z));
  } catch (e) { return null; }
}


// next point on an A* path to (tx, tz)
function pathStep(r, tx, tz, dt) {
  r.pathT -= dt;
  if (!r.path || r.pathT <= 0) {
    r.pathT = 1.5;
    try { r.path = toPoints(findPath(r.x, r.z, tx, tz)); } catch (e) { r.path = null; }
    r.pi = 0;
  }
  if (r.path && r.path.length) {
    while (r.pi < r.path.length - 1 && Math.hypot(r.path[r.pi].x - r.x, r.path[r.pi].z - r.z) < 1.6) r.pi++;
    return r.path[r.pi];
  }
  return { x: tx, z: tz };
}


function pickWp(r) {
  for (let k = 0; k < 12; k++) {
    const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * PATROL_R;
    const x = r.hx + Math.cos(a) * d, z = r.hz + Math.sin(a) * d;
    if (!blockedAt(x, z, MECH_R + 0.3)) return { x, z };
  }
  return { x: r.hx, z: r.hz };
}


function updateMech(r, dt) {
  let dirx = 0, dirz = 0, speed = 0;
  let faceYaw = r.yaw;
  const t = r.target;


  if (r.state === 'fight' && t) {
    tpos(t, TP);
    const dx = TP.x - r.x, dz = TP.z - r.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist, nz = dz / dist;
    faceYaw = Math.atan2(-dx, -dz);


    if (r.clear) {
      if (dist > KEEP_MAX) { dirx = nx; dirz = nz; speed = MECH_SPEED; }
      else if (dist < KEEP_MIN) { dirx = -nx; dirz = -nz; speed = MECH_SPEED * 0.8; }
    } else {
      const p = pathStep(r, TP.x, TP.z, dt);
      const px = p.x - r.x, pz = p.z - r.z, pd = Math.hypot(px, pz) || 0.001;
      dirx = px / pd; dirz = pz / pd; speed = MECH_SPEED;
    }


    r.reactT -= dt;
    if (r.pauseT > 0) r.pauseT -= dt;
    else if (r.burstLeft > 0) {
      r.shotT -= dt;
      if (r.shotT <= 0) {
        fireMech(r, t);
        r.burstLeft--;
        r.shotT = MECH_GAP;
        if (r.burstLeft <= 0) r.pauseT = MECH_PAUSE * (0.8 + Math.random() * 0.5);
      }
    } else if (r.reactT <= 0 && r.clear && dist <= MECH_RANGE) {
      r.burstLeft = MECH_BURST; r.shotT = 0;
    }
  } else {
    // idle: stand, look around, patrol a little around the post
    const homeD = Math.hypot(r.x - r.hx, r.z - r.hz);
    if (homeD > PATROL_R + 6) {
      const p = pathStep(r, r.hx, r.hz, dt);
      const px = p.x - r.x, pz = p.z - r.z, pd = Math.hypot(px, pz) || 0.001;
      dirx = px / pd; dirz = pz / pd; speed = MECH_SPEED * 0.7;
      faceYaw = Math.atan2(-dirx, -dirz);
    } else if (r.idleT > 0) {
      r.idleT -= dt;
      faceYaw = r.yaw + Math.sin(clockT * 0.5 + r.seed) * 0.02;
      if (r.idleT <= 0) { r.wp = pickWp(r); r.wpT = 12; }
    } else if (r.wp) {
      const px = r.wp.x - r.x, pz = r.wp.z - r.z, pd = Math.hypot(px, pz);
      r.wpT -= dt;
      if (pd < 1.5 || r.wpT <= 0) { r.wp = null; r.idleT = 2 + Math.random() * 4; }
      else { dirx = px / pd; dirz = pz / pd; speed = MECH_SPEED * 0.5; faceYaw = Math.atan2(-dirx, -dirz); }
    } else r.idleT = 2;
  }


  // sidestep when stuck behind something
  if (r.sideT > 0) {
    r.sideT -= dt;
    const px = -dirz * r.sideDir, pz = dirx * r.sideDir;
    dirx = px; dirz = pz; speed = Math.max(speed, MECH_SPEED * 0.6);
  }


  let moved = 0;
  if (speed > 0) {
    const ox = r.x, oz = r.z;
    stepMove(r, dirx * speed * dt, dirz * speed * dt);
    moved = Math.hypot(r.x - ox, r.z - oz);
    if (moved < speed * dt * 0.25) {
      r.stuckT += dt;
      if (r.stuckT > 0.8) {
        r.stuckT = 0; r.path = null; r.pathT = 0; r.wp = null;
        r.sideT = 0.8; r.sideDir = Math.random() < 0.5 ? -1 : 1;
      }
    } else r.stuckT = 0;
  } else r.stuckT = 0;


  // turn the body
  const diff = angDiff(r.yaw, faceYaw);
  r.yaw += Math.max(-MECH_TURN * dt, Math.min(MECH_TURN * dt, diff));


  // walk animation and footsteps
  r.amt += ((moved > 0.001 ? 1 : 0) - r.amt) * Math.min(1, dt * 6);
  r.phase += dt * (moved / Math.max(dt, 0.0001)) * 1.6;
  animateMech(r.g, r.phase, r.amt);
  const sn = Math.floor(r.phase / Math.PI);
  if (sn !== r.stepN) { r.stepN = sn; if (r.amt > 0.3) sound('step', r.x, r.y, r.z); }


  r.y += (groundHeight(r.x, r.z) - r.y) * Math.min(1, dt * 8);
  r.g.position.set(r.x, r.y, r.z);
  r.g.rotation.y = r.yaw;
}


/* ---------- Turrets ---------- */
function updateTurret(r, dt) {
  const t = r.target;
  const head = r.g.userData.head;


  if (r.state === 'fight' && t) {
    tpos(t, TP);
    const dx = TP.x - r.x, dz = TP.z - r.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const want = Math.atan2(-dx, -dz);
    const diff = angDiff(r.hy, want);
    r.hy += Math.max(-TURRET_TURN * dt, Math.min(TURRET_TURN * dt, diff));
    if (r.clear && Math.abs(diff) < 0.3) r.lock = Math.min(1, r.lock + LOCK_RISE * dt);
    else r.lock = Math.max(0, r.lock - LOCK_FALL * dt);


    r.reactT -= dt;
    if (r.pauseT > 0) r.pauseT -= dt;
    else if (r.burstLeft > 0) {
      r.shotT -= dt;
      if (r.shotT <= 0) {
        if (r.clear && dist <= TURRET_RANGE) fireTurret(r, t);
        r.burstLeft--;
        r.shotT = TURRET_GAP;
        if (r.burstLeft <= 0) r.pauseT = TURRET_PAUSE * (0.8 + Math.random() * 0.5);
      }
    } else if (r.reactT <= 0 && r.clear && dist <= TURRET_RANGE && Math.abs(diff) < 0.12) {
      r.burstLeft = TURRET_BURST; r.shotT = 0;
    }
  } else {
    r.lock = Math.max(0, r.lock - LOCK_FALL * dt);
    const want = r.h0 + Math.sin(clockT * 0.45 + r.seed) * TURRET_SWEEP;
    r.hy += Math.max(-1 * dt, Math.min(1 * dt, angDiff(r.hy, want)));
  }
  head.rotation.y = r.hy;
}


/* ---------- Per robot, every frame ---------- */
function updateRobot(r, dt) {
  if (r.dead) {
    r.deadT += dt;
    if (RESPAWN > 0 && !r.temp && r.deadT >= RESPAWN) resetRobot(r);
    return;
  }
  if (r.flash > 0) { r.flash -= dt; if (r.flash <= 0) unglow(r.g); }


  r.senseT -= dt;
  if (r.senseT <= 0) { r.senseT = 0.35; sense(r); }


  r.g.visible = Math.hypot(r.x - camPos.x, r.z - camPos.z) < SHOW_DIST;


  if (r.kind === 'mech') updateMech(r, dt); else updateTurret(r, dt);
  updateBar(r);


  r.allyT -= dt;
  if (r.allyT <= 0) { r.allyT = 0.6; if (r.g.visible) allyFire(r); }
}


// the player cannot walk through a robot
function pushPlayer() {
  const p = C.player;
  if (p.dead) return;
  for (const r of robots) {
    if (r.dead || !r.g.visible) continue;
    if (p.y > groundHeight(r.x, r.z) + r.h + 1.5) continue;       // flying above it
    const rad = (r.kind === 'mech' ? MECH_BODY_R * r.sc * 0.8 : 0.95) + 0.5;
    const dx = p.x - r.x, dz = p.z - r.z;
    const d = Math.hypot(dx, dz);
    if (d < rad) {
      const nx = d > 0.001 ? dx / d : 1, nz = d > 0.001 ? dz / d : 0;
      p.x = r.x + nx * rad;
      p.z = r.z + nz * rad;
    }
  }
}


function resetRobot(r) {
  r.hp = r.maxHp = r.maxHp || pick(r.kind === 'mech' ? MECH_HP : TURRET_HP);
  r.dead = false; r.deadT = 0; r.flash = 0; r.target = null; r.state = 'idle';
  r.lock = 0; r.burstLeft = 0; r.pauseT = 0; r.path = null; r.wp = null; r.idleT = 2;
  r.stuckT = 0; r.sideT = 0; r.lostT = 0;
  r.x = r.hx; r.z = r.hz; r.y = groundHeight(r.x, r.z);
  if (r.kind === 'mech') r.yaw = Math.atan2(TOWN.x - r.x, TOWN.z - r.z) + Math.PI;
  else r.hy = r.h0;
  unglow(r.g);
  r.g.position.set(r.x, r.y, r.z);
  r.g.visible = true;
  if (r.bar) r.bar.visible = false;
}


/* ---------- extras.js hooks ---------- */
export function init(ctx) {
  C = ctx;
  scene = ctx.scene;
  makeBeams();
  window.spawnMech = () => testSpawn('mech', 30);
  window.spawnTurret = () => testSpawn('turret', 22);
  window.robotsInfo = () => {
    const alive = robots.filter((r) => !r.dead);
    console.log('[robots] alive ' + alive.length + '/' + robots.length +
      ' | fighting ' + alive.filter((r) => r.state === 'fight').length);
    return robots.map((r) => ({ kind: r.kind, x: Math.round(r.x), z: Math.round(r.z),
      hp: Math.round(r.hp), state: r.dead ? 'destroyed' : r.state }));
  };
}


export function update(dt, ctx) {
  C = ctx;
  if (!started) {
    if (ctx.isReady()) { started = true; spawnAll(); }
    else return;
  }
  dt = Math.min(dt, 0.1);
  ctx.camera.getWorldPosition(camPos);
  if (!ctx.isPlaying()) return;                            // paused: everything freezes


  clockT += dt;
  ac();
  senseT -= dt;
  if (senseT <= 0) { senseT = 0.3; buildTargets(); }


  for (const r of robots) updateRobot(r, dt);
  pushPlayer();
  updateBeams(dt);
  updateFx(dt);
}


export function onEvent(name, data, ctx) {
  C = ctx || C;
  if (!started || !C) return;
  if (name === 'shot') playerShot((data && data.kind) || 'rifle');
  else if (name === 'restart') reset(C);
}


export function reset(ctx) {
  for (let i = robots.length - 1; i >= 0; i--) {
    const r = robots[i];
    if (r.temp) {
      scene.remove(r.g);
      if (r.bar) scene.remove(r.bar);
      robots.splice(i, 1);
      continue;
    }
    resetRobot(r);
  }
  for (const b of beams) { b.life = 0; b.l.visible = false; }
  clearFx();
}


/* ---------- for other files (missions, waves, minimap) ---------- */
export function getRobots() { return robots; }
export function robotsAlive() { return robots.filter((r) => !r.dead).length; }
export function spawnRobot(kind, x, z, opts) {
  if (!started || !C) return null;
  return createRobot(kind === 'turret' ? 'turret' : 'mech', x, z, opts || {});
}