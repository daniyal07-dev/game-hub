// ============================================================
// waves.js  (NEW FILE)  ->  games/campaign/waves.js
// DEFEND PHASE of Operation Port Town: the Space Gang attacks from the sea.
//  - After the town is captured, 3 boats sail in from the sea to the harbor pier.
//  - Each boat drops soldiers one by one; they run to the town square
//    (pathfinding + sight + shooting come from enemies.js).
//  - Wave 3 also sends elite soldiers and a heavy mech (robots.js).
//  - Radio messages and banners come from missions.js.
// Loaded by extras.js (add 'waves' to MODULES). Safe to delete.
// Console:  wavesTest(1|2|3)   wavesInfo()
// ============================================================
import * as THREE from 'three';
import { getEnemies, spawnEnemy, difficultyName } from './enemies.js';
import { WATER_LEVEL } from './terrain.js';
import { getMission, radio, banner, reportWaves } from './missions.js';


// ---------- knobs ----------
const WARN_AT = 6;                         // seconds after capture: "ENEMY BOATS APPROACHING"
const WAVES = [
  { at: 12,  soldiers: 4, elite: 0, mech: false },
  { at: 70,  soldiers: 5, elite: 1, mech: false },
  { at: 125, soldiers: 6, elite: 2, mech: true  }
];
const MULT = { easy: 0.75, normal: 1, hard: 1.3 };   // wave size per difficulty
const SQUARE = { x: 120, z: 80 };          // where the attackers run to
const SQ_SPREAD = 6;                       // they aim at random points within this (m)

// where the soldiers appear (first free spot is used)
const SPOTS = [{ x: 306, z: 159 }, { x: 312, z: 162 }, { x: 300, z: 155 }, { x: 290, z: 148 }];
const MECH_SPOT = { x: 172, z: 83 };       // the mech comes down the harbor road
const DROP_GAP = 0.55;                     // seconds between soldiers jumping off

// boat
const DOCK = { x: 329, z: 173 };           // where the boat stops (next to the pier)
const BOAT_DIR = { x: 0.863, z: 0.508 };   // direction from the dock out to the sea
const BOAT_FAR = 130;                      // start distance in the sea (m)
const BOAT_SPEED = 11;                     // m/s
const BOAT_STAY = 14;                      // seconds at the pier before it leaves


// ---------- state ----------
let ctx = null;
let robotsMod = null;
let t = 0;
let started = false, warned = false, testMode = false;
let driveT = 0, watchT = 0, infoT = 0, dropT = 0, warnedFail = false;
const waves = WAVES.map(w => Object.assign({ launched: false, landed: false, cleared: false, enemies: [] }, w));
const boats = [];
const spawnQ = [];                         // { wave, elite }
const aim = new WeakMap();                 // enemy -> { x, z }
const START = { x: DOCK.x + BOAT_DIR.x * BOAT_FAR, z: DOCK.z + BOAT_DIR.z * BOAT_FAR };
const SEA_Y = (typeof WATER_LEVEL === 'number' ? WATER_LEVEL : 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));


import('./robots.js').then(m => { robotsMod = m; }).catch(() => {});


const turn = (cur, want, step) => {
  let d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
  d = clamp(d, -step, step);
  return cur + d;
};


// ---------- sounds (own small audio, like missions.js) ----------
let ac = null;
function tone(f, start, dur, vol, type) {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.value = f;
    const t0 = ac.currentTime + start;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) { /* no audio */ }
}
const siren = () => [0, 0.5, 1.0, 1.5].forEach((s, i) => tone(i % 2 ? 820 : 560, s, 0.45, 0.04, 'sawtooth'));
const horn = () => { tone(110, 0, 1.3, 0.06, 'sawtooth'); tone(165, 0, 1.3, 0.03, 'sawtooth'); };


// ---------- the boat (built in code) ----------
function buildBoat() {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x3b4249, roughness: 0.7, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x242a30, roughness: 0.8, metalness: 0.2 });


  const shape = new THREE.Shape();
  shape.moveTo(-1.8, -5); shape.lineTo(1.8, -5); shape.lineTo(1.8, 2.5);
  shape.lineTo(0, 6.5); shape.lineTo(-1.8, 2.5); shape.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.3, bevelEnabled: false });
  hullGeo.rotateX(Math.PI / 2);            // lie flat, bow towards +Z, hull below y = 0
  g.add(new THREE.Mesh(hullGeo, hullMat));


  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 3), darkMat);
  cabin.position.set(0, 0.8, -2);
  g.add(cabin);


  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6), darkMat);
  mast.position.set(0, 3.2, -2);
  g.add(mast);


  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.1),
    new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.DoubleSide }));
  flag.rotation.y = Math.PI / 2;
  flag.position.set(0, 4.3, -2.9);
  g.add(flag);
  const mark = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.32, 20),
    new THREE.MeshBasicMaterial({ color: 0xff2d2d, side: THREE.DoubleSide }));
  mark.rotation.y = Math.PI / 2;
  mark.position.set(0.02, 4.3, -2.9);
  g.add(mark);


  const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3030 }));
  light.position.set(0, 1.75, -2);
  g.add(light);


  return g;
}


function removeBoat(b) {
  if (ctx && ctx.scene) ctx.scene.remove(b.g);
  b.g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}


// ---------- launching a wave ----------
const TEXTS = [
  'Radar shows a boat heading for the harbor, east of town. Infantry on board. Hold the square!',
  'A second boat is inbound. Heavier force this time. Keep your soldiers close.',
  'Final wave! A landing craft with elite troops, and a heavy mech is coming down the harbor road.'
];


function launch(i) {
  const w = waves[i];
  if (w.launched) return;
  w.launched = true;
  const g = buildBoat();
  g.position.set(START.x, SEA_Y, START.z);
  const yaw = Math.atan2(DOCK.x - START.x, DOCK.z - START.z);
  g.rotation.set(0, yaw, 0);
  ctx.scene.add(g);
  boats.push({ g, mode: 'in', t: 0, bob: Math.random() * 6, yaw, wave: i });
  radio(TEXTS[i] || 'Another boat is approaching.');
  banner('WAVE ' + (i + 1) + ' / ' + waves.length, 'Enemy boat approaching the harbor', '#ff8a5a');
  siren();
  console.log('[waves] wave ' + (i + 1) + ' launched');
}


function landed(i) {
  const w = waves[i];
  w.landed = true;
  horn();
  const mult = MULT[difficultyName()] || 1;
  const total = Math.max(2, Math.round(w.soldiers * mult));
  const elite = Math.round(w.elite * mult);
  for (let k = 0; k < total; k++) spawnQ.push({ wave: i, elite: k < elite });
  if (i === 0) radio('They have landed at the harbor pier! They are coming for the square.');
  if (w.mech) {
    if (!spawnMechWave()) {
      console.warn('[waves] mech spawn failed, adding 2 elite soldiers instead');
      spawnQ.push({ wave: i, elite: true }, { wave: i, elite: true });
    }
  }
}


function robotCount() {
  try {
    if (robotsMod && typeof robotsMod.robotsAlive === 'function') {
      const r = robotsMod.robotsAlive();
      if (typeof r === 'number') return r;
      if (Array.isArray(r)) return r.length;
    }
    if (robotsMod && typeof robotsMod.getRobots === 'function') return robotsMod.getRobots().length;
  } catch (e) { /* ignore */ }
  return 0;
}


function spawnMechWave() {
  if (!robotsMod || typeof robotsMod.spawnMech !== 'function') return false;
  const before = robotCount();
  try { robotsMod.spawnMech(MECH_SPOT.x, MECH_SPOT.z); }
  catch (e) { console.warn('[waves] spawnMech error:', e); return false; }
  if (robotCount() > before) { radio('Heavy mech on the harbor road, east of town! Watch the east side!'); return true; }
  return false;
}


function dropOne(item) {
  for (const s of SPOTS) {
    const x = s.x + (Math.random() - 0.5) * 3, z = s.z + (Math.random() - 0.5) * 3;
    const h = Math.atan2(SQUARE.x - x, SQUARE.z - z);
    const e = spawnEnemy(x, z, h, { elite: item.elite });
    if (e) {
      waves[item.wave].enemies.push(e);
      aim.set(e, { x: SQUARE.x + (Math.random() - 0.5) * 2 * SQ_SPREAD, z: SQUARE.z + (Math.random() - 0.5) * 2 * SQ_SPREAD });
      e.state = 'search'; e.searchT = 0;
      return true;
    }
  }
  if (!warnedFail) { warnedFail = true; console.warn('[waves] no free ground at the harbor landing - edit SPOTS at the top of waves.js'); }
  return false;
}


// ---------- per frame pieces ----------
function updateBoats(dt) {
  for (let i = boats.length - 1; i >= 0; i--) {
    const b = boats[i], g = b.g;
    b.bob += dt;
    if (b.mode === 'in') {
      const dx = DOCK.x - g.position.x, dz = DOCK.z - g.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const step = Math.min(BOAT_SPEED * clamp(d / 25, 0.25, 1) * dt, d);
      g.position.x += dx / d * step; g.position.z += dz / d * step;
      b.yaw = turn(b.yaw, Math.atan2(dx, dz), 1.5 * dt);
      if (d < 1.2) { b.mode = 'wait'; b.t = 0; landed(b.wave); }
    } else if (b.mode === 'wait') {
      b.t += dt;
      if (b.t > BOAT_STAY) b.mode = 'out';
    } else {
      const dx = START.x - g.position.x, dz = START.z - g.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const step = Math.min(BOAT_SPEED * 0.8 * dt * clamp((BOAT_STAY + 6 - 0) / 20, 0.5, 1), d);
      g.position.x += dx / d * step; g.position.z += dz / d * step;
      b.yaw = turn(b.yaw, Math.atan2(dx, dz), 1.0 * dt);
      if (d < 3) { removeBoat(b); boats.splice(i, 1); continue; }
    }
    g.position.y = SEA_Y + 0.55 + Math.sin(b.bob * 1.6) * 0.12;
    g.rotation.set(Math.sin(b.bob * 1.1) * 0.03, b.yaw, Math.sin(b.bob * 1.3) * 0.045);
  }
}


function tickSpawns(dt) {
  if (!spawnQ.length) return;
  dropT -= dt;
  if (dropT > 0) return;
  dropT = DROP_GAP;
  dropOne(spawnQ.shift());
}


// keep the attackers marching on the square (enemies.js would send them home)
function drive(dt) {
  driveT -= dt;
  if (driveT > 0) return;
  driveT = 0.5;
  for (const w of waves) {
    for (const e of w.enemies) {
      if (e.dead) continue;
      e.homeX = e.x; e.homeZ = e.z;                       // no leash: their "home" is where they stand
      const a = aim.get(e) || SQUARE;
      if (e.state === 'guard' || e.state === 'return') { e.state = 'search'; e.searchT = 0; e.lastX = a.x; e.lastZ = a.z; }
      else if (e.state === 'search') { e.searchT = 0; e.lastX = a.x; e.lastZ = a.z; }
    }
  }
}


const aliveOf = w => w.enemies.filter(e => !e.dead).length;
const pendingOf = i => spawnQ.filter(q => q.wave === i).length;


function watch(dt) {
  watchT -= dt;
  if (watchT > 0) return;
  watchT = 1;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    if (w.landed && !w.cleared && pendingOf(i) === 0 && w.enemies.length > 0 && aliveOf(w) === 0) {
      w.cleared = true;
      radio(i === waves.length - 1 ? 'Last wave repelled! Finish any stragglers.' : 'Wave ' + (i + 1) + ' repelled. Well done. Reload and get ready.');
    }
  }
}


function waveText() {
  if (!started && !testMode) return '';
  const launched = waves.filter(w => w.launched).length;
  const alive = waves.reduce((n, w) => n + aliveOf(w), 0) + spawnQ.length;
  if (launched === 0) return 'Wave 1 incoming';
  let s = 'Wave ' + launched + '/' + waves.length;
  if (alive > 0) s += ' · ' + alive + ' attackers';
  else if (launched < waves.length) s += ' · next boat soon';
  return s;
}


function resetWaves() {
  for (const b of boats) removeBoat(b);
  boats.length = 0;
  spawnQ.length = 0;
  for (const w of waves) { w.launched = false; w.landed = false; w.cleared = false; w.enemies = []; }
  started = false; warned = false; testMode = false; warnedFail = false;
  driveT = 0; watchT = 0; infoT = 0; dropT = 0;
  reportWaves({ text: '' });
}


// ============================================================
// extras.js hooks
// ============================================================
export function init(c) {
  ctx = c;
  console.log('[waves] ready: ' + WAVES.length + ' waves after the town is captured. Console: wavesTest(1), wavesInfo()');
}


export function update(dt, c) {
  ctx = c;
  if (!c.isPlaying()) return;
  dt = Math.min(dt, 0.1);
  t += dt;
  const m = getMission();


  if (!testMode && started && m.phase !== 'defend' && m.phase !== 'won' && m.phase !== 'lost') resetWaves();


  if (m.phase === 'defend' && !testMode) {
    started = true;
    if (!warned && m.defendT >= WARN_AT) {
      warned = true;
      banner('ENEMY BOATS APPROACHING', 'They attack from the sea, east of the town', '#ff6b6b');
      radio('Command to all units: the Space Gang is sending boats from the harbor. Hold the town square, Commander!');
      siren();
    }
    for (let i = 0; i < waves.length; i++) {
      if (!waves[i].launched && m.defendT >= waves[i].at) launch(i);
    }
  }


  updateBoats(dt);
  tickSpawns(dt);
  drive(dt);
  watch(dt);


  infoT -= dt;
  if (infoT <= 0) { infoT = 0.5; reportWaves({ text: waveText() }); }
}


export function onEvent(name) {
  if (name === 'restart') resetWaves();
}


export function reset() {
  resetWaves();
}


export function getWaves() {
  return waves.map((w, i) => ({ n: i + 1, launched: w.launched, landed: w.landed, alive: aliveOf(w), cleared: w.cleared }));
}


// ---------- console helpers (testing only) ----------
window.wavesTest = (n) => {
  const i = clamp((parseInt(n, 10) || 1) - 1, 0, waves.length - 1);
  if (!ctx) { console.log('[waves] not ready yet'); return; }
  testMode = true;
  waves[i].launched = false; waves[i].landed = false; waves[i].cleared = false; waves[i].enemies = [];
  launch(i);
  console.log('[waves] test: wave ' + (i + 1) + ' launched. The boat sails to ' + DOCK.x + ', ' + DOCK.z);
};


window.wavesInfo = () => {
  const s = 'started ' + started + ' · test ' + testMode + ' · boats ' + boats.length +
    ' · queue ' + spawnQ.length + ' · ' + JSON.stringify(getWaves());
  console.log('[waves] ' + s);
  return s;
};