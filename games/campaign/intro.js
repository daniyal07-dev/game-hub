// ============================================================
// intro.js  (v2)  ->  games/campaign/intro.js
// Opening cinematic of Operation Port Town (plays after ENTER ISLAND):
//   1. fade in, camera high above the island, descends onto Port Town
//      "PORT TOWN HAS FALLEN"
//   2. flies to the base:            "STRIKE COMMAND BASE"
//   3. the Barracks (gold beacon):   "STEP 1 - BARRACKS"  train soldiers
//   4. the Army Truck (cyan beacon): "STEP 2 - ARMY TRUCK" carry 12 soldiers
//   5. a dotted route draws itself from the truck to Port Town: "STEP 3 - PORT TOWN"
//   6. the camera lands exactly in the player's eyes: "OPERATION PORT TOWN"
//  - Press SPACE or ENTER (phone: tap) to skip.
//  - While it plays the player is parked far south of the town (enemies cannot see him)
//    and put back at the end.
//  - HUD, gun and minimap are hidden, cinema bars slide in.
//  - Tells missions.js through extrasEvent('intro', {active}) so the mission clock and radio
//    wait until it is over.
//
// v2: RAIN FIX. The rain follows the player, who is parked away from the cinema camera.
//     The intro now moves the rain box to the cinema camera every frame (and makes it bigger
//     when the camera is high), so the whole flight is rainy. Needs weather.js v4.
//     New story shots, beacons with labels, route line. Text size adapts to small screens.
//
// Loaded by extras.js (add 'intro' LAST in MODULES). Safe to delete.
// Console:  introPlay()   (play it again)
// ============================================================
import * as THREE from 'three';
import { heightAt, SPAWN } from './terrain.js';
import { extrasEvent } from './extras.js';



// ---------- knobs ----------
const ENABLED = true;             // false = no intro at all
const T_DESCENT = 6;              // seconds: descent over the town
const T_BASE = 5;                 // seconds: flight to the base
const T_BARRACKS = 4.5;           // seconds: the Barracks
const T_TRUCK = 4.5;              // seconds: the Army Truck
const T_ROUTE = 5.5;              // seconds: the route to Port Town
const T_LAND = 3.5;               // seconds: landing in the player's eyes
const FADE_IN = 1.2;              // seconds: black to picture at the start
const SKIP_MIN = 1.0;             // skip works after this many seconds
const BAR_H = '13vh';             // height of the cinema bars
const LAND_ARC = 12;              // extra height in the middle of the landing (m)
const MIN_AGL = 2.5;              // the camera never goes lower than this above the ground (m)

// rain in the intro
const RAIN_SCALE_MAX = 3.5;       // biggest rain box (x) when the camera is high
const RAIN_HIGH_START = 8;        // metres above ground where the box starts to grow
const RAIN_HIGH_STEP = 10;        // every this many metres more = +1x
const RAIN_AHEAD = 0.5;           // how far the big box moves ahead of the view
const RAIN_ALPHA_BOOST = 0.8;     // extra rain visibility when high (0 = none)

// places (x, z)
const PARK = { x: 120, z: 215 };              // where the player waits (south of the town, out of sight)
const BARRACKS = { x: -162, z: -89.5 };       // between Barracks A and B
const TRUCK = { x: SPAWN.x + 9, z: SPAWN.z + 7 };
const TOWN = { x: 120, z: 80 };

const CAM_A = { x: 150, y: 190, z: 200 };     // start: high up
const LOOK_A = { x: 120, z: 90, dy: 0 };
const CAM_B = { x: 122, y: 26, z: 128 };      // end of descent: just south of the town
const LOOK_B = { x: 120, z: 60, dy: 9 };      // the Town Hall and its flags


const HIDE = ['#hud', '#crosshair', '#train-supply', '#train-box',
              '#guide-objective', '#guide-lock', '#guide-briefing',
              '[id*="mini"]', '[id*="map"]'];


const TEXTS = {
  a:        { t: 'PORT TOWN HAS FALLEN', s: 'The Space Gang has captured the harbor town', c: '#ff5a5a' },
  base:     { t: 'STRIKE COMMAND BASE', s: 'Your base. Your army starts here', c: '#40e0ff' },
  barracks: { t: 'STEP 1 · BARRACKS', s: 'Train soldiers here to build your army', c: '#ffd24a' },
  truck:    { t: 'STEP 2 · ARMY TRUCK', s: 'Carry up to 12 soldiers to Port Town', c: '#40e0ff' },
  route:    { t: 'STEP 3 · PORT TOWN', s: 'Follow the route. Clear the town and capture the square', c: '#ff5a5a' },
  b:        { t: 'OPERATION PORT TOWN', s: 'Train an army. Take the town back.', c: '#40e0ff' }
};

// the story legs after the descent: pose i -> pose i+1, the last leg is the landing
const LEGS = [
  { dur: T_BASE, text: 'base' },
  { dur: T_BARRACKS, text: 'barracks' },
  { dur: T_TRUCK, text: 'truck' },
  { dur: T_ROUTE, text: 'route' },
  { dur: T_LAND, text: 'b' }
];



// ---------- state ----------
let ctx = null;
let state = ENABLED ? 'wait' : 'done';        // wait | run | out | done
let time = 0, save = null, skipping = false;
let root = null, topBar = null, botBar = null, titleEl = null, hintEl = null, fadeEl = null;
let fadeV = 1, fadeGoal = 0, fadeSpeed = 1;
let curText = null, boomed = false, swept = false;
let hidden = [], kids = [];
let leg = -1, legF = 0, lastLeg = -1;
let POSES = [], markers = [], route = null, routeCount = 0, routeTex = null;
let rainObj = null, rainAlpha0 = null;
const dummy = new THREE.PerspectiveCamera();
const qLand = new THREE.Quaternion(), qEnd = new THREE.Quaternion();
const eul = new THREE.Euler(0, 0, 0, 'YXZ');
const tmpV = new THREE.Vector3(), tmpD = new THREE.Vector3();



const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, f) => a + (b - a) * f;
const smooth = f => { f = clamp(f, 0, 1); return f * f * (3 - 2 * f); };
const lookY = L => heightAt(L.x, L.z) + L.dy;



// ---------- sound (own small audio) ----------
let ac = null;
function tone(f, start, dur, vol, type) {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.value = f;
    const t0 = ac.currentTime + start;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) { /* no audio */ }
}
function sweep(f0, f1, dur, vol) {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle';
    const t0 = ac.currentTime;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) { /* no audio */ }
}
const boom = () => { tone(55, 0, 2.8, 0.2, 'sine'); tone(82, 0, 2.2, 0.08, 'triangle'); tone(41, 0.05, 3, 0.12, 'sine'); };
const ping = () => { tone(740, 0, 0.25, 0.05, 'sine'); tone(988, 0.12, 0.3, 0.04, 'sine'); };



// ---------- screen elements ----------
function ensureDom() {
  if (!root) {
    root = document.createElement('div');
    root.id = 'intro-root';
    root.style.cssText = 'position:fixed;inset:0;z-index:9000;pointer-events:none;display:none;overflow:hidden;';
    const bar = pos => {
      const b = document.createElement('div');
      b.style.cssText = 'position:absolute;left:0;right:0;' + pos + ':0;height:0;background:#000;transition:height 1.2s ease;';
      return b;
    };
    topBar = bar('top'); botBar = bar('bottom');
    titleEl = document.createElement('div');
    titleEl.style.cssText = 'position:absolute;left:0;right:0;top:22%;text-align:center;opacity:0;' +
      'transition:opacity 0.9s;text-shadow:0 2px 12px #000;padding:0 16px;';
    hintEl = document.createElement('div');
    hintEl.style.cssText = 'position:absolute;right:24px;bottom:4vh;color:#9fb2bf;font-size:12px;letter-spacing:2px;' +
      'opacity:0;transition:opacity 0.8s;';
    hintEl.textContent = 'PRESS SPACE TO SKIP';
    root.appendChild(topBar); root.appendChild(botBar); root.appendChild(titleEl); root.appendChild(hintEl);
    document.body.appendChild(root);
  }
  if (!fadeEl) {
    fadeEl = document.createElement('div');
    fadeEl.style.cssText = 'position:fixed;inset:0;z-index:9002;background:#000;opacity:1;pointer-events:none;';
    document.body.appendChild(fadeEl);
  }
}



function setText(key) {
  if (key === curText) return;
  curText = key;
  if (!key) { titleEl.style.opacity = '0'; return; }
  const x = TEXTS[key];
  titleEl.innerHTML =
    '<div style="font-size:clamp(18px,min(5vw,8vh),42px);font-weight:bold;letter-spacing:clamp(2px,min(1vw,1.6vh),8px);color:' +
      x.c + '">' + x.t + '</div>' +
    '<div style="font-size:clamp(11px,min(2vw,3.4vh),16px);letter-spacing:clamp(1px,0.5vw,4px);color:#e6eef3;margin-top:10px">' +
      x.s + '</div>';
  titleEl.style.opacity = '1';
}



function hideGameUi(c) {
  hidden = [];
  for (const sel of HIDE) {
    let list = [];
    try { list = document.querySelectorAll(sel); } catch (e) { list = []; }
    list.forEach(el => { hidden.push([el, el.style.visibility]); el.style.visibility = 'hidden'; });
  }
  kids = c.camera.children.map(k => [k, k.visible]);
}



function showGameUi() {
  for (const [el, v] of hidden) el.style.visibility = v;
  hidden = [];
  for (const [k, v] of kids) k.visible = v;
  kids = [];
  const lock = document.getElementById('guide-lock');
  if (lock) lock.style.display = 'none';         // no leftover "train first" message
}



// ---------- camera poses ----------
function pose(x, h, z, lx, ldy, lz) {
  return {
    pos: new THREE.Vector3(x, heightAt(x, z) + h, z),
    look: new THREE.Vector3(lx, heightAt(lx, lz) + ldy, lz)
  };
}

function buildPoses() {
  const dx = TOWN.x - TRUCK.x, dz = TOWN.z - TRUCK.z, d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;                              // direction truck -> town
  POSES = [
    { pos: new THREE.Vector3(CAM_B.x, CAM_B.y, CAM_B.z),       // end of the descent
      look: new THREE.Vector3(LOOK_B.x, lookY(LOOK_B), LOOK_B.z) },
    pose(-70, 42, -55, -150, 0, -98),                          // over the base, from the east
    pose(-130, 14, -70, BARRACKS.x, 3, BARRACKS.z),            // looking at the Barracks
    pose(TRUCK.x + 26, 7, TRUCK.z - 14, TRUCK.x, 1.5, TRUCK.z),// looking at the truck from the main gate
    pose(TRUCK.x - ux * 26, 32, TRUCK.z - uz * 26,             // behind the truck, looking to the town
         TRUCK.x + ux * 70, 0, TRUCK.z + uz * 70)
  ];
  const last = POSES[4];
  dummy.position.copy(last.pos);
  dummy.lookAt(last.look);
  qLand.copy(dummy.quaternion);
}



// ---------- beacons, labels and the route line ----------
function makeMarker(id, x, z, color, radius, labelText, labelH, show) {
  const scene = ctx.scene;
  const gy = heightAt(x, z);
  const g = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 70, 16, 1, true), beamMat);
  beam.position.set(x, gy + 35, z);
  const ringMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false
  });
  const ringGeo = new THREE.RingGeometry(radius * 0.8, radius, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(x, gy + 0.6, z);
  g.add(beam); g.add(ring);
  g.visible = false;
  scene.add(g);

  const hex = '#' + new THREE.Color(color).getHexString();
  const el = document.createElement('div');
  el.textContent = labelText;
  el.style.cssText = 'position:absolute;left:0;top:0;display:none;white-space:nowrap;padding:4px 12px;' +
    'border-radius:16px;font:800 clamp(10px,min(1.8vw,3vh),14px) system-ui,Arial,sans-serif;letter-spacing:2px;' +
    'color:#fff;background:rgba(6,12,22,0.78);border:2px solid ' + hex + ';text-shadow:0 1px 3px #000;' +
    'transform:translate(-50%,-100%);';
  root.appendChild(el);

  markers.push({ id, g, beam, ring, beamMat, ringMat, el, show, wx: x, wy: gy + labelH, wz: z });
}

function makeRoute() {
  const dx = TOWN.x - TRUCK.x, dz = TOWN.z - TRUCK.z, d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  const from = 9, to = d - 14, step = 5;
  const n = Math.max(2, Math.floor((to - from) / step));
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = from + i * step;
    const x = TRUCK.x + ux * s, z = TRUCK.z + uz * s;
    pos[i * 3] = x; pos[i * 3 + 1] = heightAt(x, z) + 1.4; pos[i * 3 + 2] = z;
  }
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  routeTex = new THREE.CanvasTexture(c);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x40e0ff, size: 3.4, sizeAttenuation: true, map: routeTex, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  });
  route = new THREE.Points(geo, mat);
  route.frustumCulled = false;
  route.visible = false;
  routeCount = n;
  geo.setDrawRange(0, 0);
  ctx.scene.add(route);
}

function buildEffects() {
  removeEffects();
  makeMarker('barracks', BARRACKS.x, BARRACKS.z, 0xffd24a, 9, 'BARRACKS · TRAIN SOLDIERS', 16,
    () => leg === 1 || (leg === 0 && legF > 0.5));
  makeMarker('truck', TRUCK.x, TRUCK.z, 0x40e0ff, 5, 'ARMY TRUCK · 12 SOLDIERS', 10,
    () => leg === 2 || leg === 3);
  makeMarker('town', TOWN.x, TOWN.z, 0xff5a5a, 12, 'PORT TOWN', 16,
    () => (leg === 3 && legF > 0.5) || (leg === 4 && legF < 0.6));
  makeRoute();
}

function removeEffects() {
  for (const m of markers) {
    if (m.g.parent) m.g.parent.remove(m.g);
    m.beam.geometry.dispose(); m.ring.geometry.dispose();
    m.beamMat.dispose(); m.ringMat.dispose();
    m.el.remove();
  }
  markers = [];
  if (route) {
    if (route.parent) route.parent.remove(route);
    route.geometry.dispose(); route.material.dispose();
    route = null;
  }
  if (routeTex) { routeTex.dispose(); routeTex = null; }
}

function hideEffects() {
  for (const m of markers) { m.g.visible = false; m.el.style.display = 'none'; }
  if (route) route.visible = false;
}

function updateEffects(c) {
  const cam = c.camera;
  cam.updateMatrixWorld(true);
  const pulse = 0.3 + 0.12 * Math.sin(time * 4);
  for (const m of markers) {
    const on = !!m.show();
    m.g.visible = on;
    if (!on) { m.el.style.display = 'none'; continue; }
    m.beamMat.opacity = pulse;
    m.ringMat.opacity = 0.55 + 0.25 * Math.sin(time * 4);
    tmpV.set(m.wx, m.wy, m.wz).project(cam);
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.1 || Math.abs(tmpV.y) > 1.1) { m.el.style.display = 'none'; continue; }
    m.el.style.display = 'block';
    m.el.style.left = ((tmpV.x * 0.5 + 0.5) * innerWidth) + 'px';
    m.el.style.top = ((-tmpV.y * 0.5 + 0.5) * innerHeight) + 'px';
  }
  if (route) {
    let reveal = 0;
    if (leg === 3) reveal = smooth(legF / 0.8);
    else if (leg === 4) reveal = 1;
    route.visible = reveal > 0;
    route.geometry.setDrawRange(0, Math.floor(routeCount * reveal));
    route.material.opacity = 0.75 + 0.2 * Math.sin(time * 5);
  }
}



// ---------- rain follows the cinema camera ----------
function fixRain(c) {
  const scene = c.scene;
  if (!scene) return;
  if (!rainObj || !rainObj.parent) {
    rainObj = scene.children.find(o => o.isLineSegments && o.material && o.material.uniforms &&
                                       o.material.uniforms.uCam) || null;
    rainAlpha0 = null;
  }
  if (!rainObj || !rainObj.visible) return;      // no rain now (Clear / Cloudy)
  const u = rainObj.material.uniforms, cam = c.camera;
  if (rainAlpha0 === null && u.uAlpha) rainAlpha0 = u.uAlpha.value;

  u.uCam.value.copy(cam.position);
  if (!u.uScale || !u.uBox || !u.uLen) return;   // old weather.js: only the position is fixed

  const alt = cam.position.y - (heightAt(cam.position.x, cam.position.z) || 0);
  const s = clamp(1 + (alt - RAIN_HIGH_START) / RAIN_HIGH_STEP, 1, RAIN_SCALE_MAX);
  const t = (s - 1) / (RAIN_SCALE_MAX - 1);
  u.uScale.value = s;
  u.uBox.value.multiplyScalar(s);                // weather.js writes the normal size again every frame
  u.uLen.value *= s;
  if (u.uAlpha && rainAlpha0 !== null) u.uAlpha.value = rainAlpha0 * (1 + RAIN_ALPHA_BOOST * t);
  if (s > 1.01) {
    cam.getWorldDirection(tmpD);
    tmpD.y = 0;
    if (tmpD.lengthSq() > 0.0001) {
      tmpD.normalize();
      const ahead = t * (u.uBox.value.x * 0.5) * RAIN_AHEAD;
      u.uCam.value.x += tmpD.x * ahead;
      u.uCam.value.z += tmpD.z * ahead;
    }
  }
}

function restoreRain() {
  if (rainObj && rainObj.material && rainObj.material.uniforms && rainObj.material.uniforms.uAlpha && rainAlpha0 !== null) {
    rainObj.material.uniforms.uAlpha.value = rainAlpha0;
  }
}



// ---------- start and end ----------
function begin(c) {
  const p = c.player;
  save = { x: p.x, y: p.y, z: p.z };
  ensureDom();
  hideGameUi(c);
  root.style.display = 'block';
  fadeV = 1; fadeGoal = 0; fadeSpeed = 1 / FADE_IN;
  fadeEl.style.opacity = '1';
  requestAnimationFrame(() => { topBar.style.height = BAR_H; botBar.style.height = BAR_H; });
  buildPoses();
  buildEffects();
  time = 0; skipping = false; curText = null; boomed = false; swept = false;
  leg = -1; legF = 0; lastLeg = -1;
  hintEl.style.opacity = '0';
  state = 'run';
  extrasEvent('intro', { active: true });
  console.log('[intro] v2 playing. SPACE or ENTER skips it');
}



function finish(c) {
  const p = c.player;
  p.x = save.x; p.z = save.z; p.y = save.y;
  p.vx = p.vz = p.vy = 0; p.grounded = true; p.fly = false;
  c.camera.position.set(save.x, save.y, save.z);
  showGameUi();
  setText(null);
  removeEffects();
  restoreRain();
  root.style.display = 'none';
  topBar.style.height = '0'; botBar.style.height = '0';
  extrasEvent('intro', { active: false });
  if (fadeV > 0.01) { fadeGoal = 0; fadeSpeed = 2.2; state = 'out'; }
  else { removeFade(); state = 'done'; }
  console.log('[intro] finished');
}



function removeFade() {
  if (fadeEl) { fadeEl.remove(); fadeEl = null; }
}



function tickFade(dt) {
  if (!fadeEl) return;
  const d = fadeGoal - fadeV, s = fadeSpeed * dt;
  fadeV = Math.abs(d) <= s ? fadeGoal : fadeV + Math.sign(d) * s;
  fadeEl.style.opacity = String(fadeV);
}



// ---------- camera path ----------
function placeCamera(c) {
  const cam = c.camera, p = c.player;

  // 0) descent over Port Town
  if (time < T_DESCENT) {
    const f = smooth(time / T_DESCENT);
    const x = lerp(CAM_A.x, CAM_B.x, f), z = lerp(CAM_A.z, CAM_B.z, f);
    const y = Math.max(lerp(CAM_A.y, CAM_B.y, f), heightAt(x, z) + 4);
    dummy.position.set(x, y, z);
    dummy.lookAt(lerp(LOOK_A.x, LOOK_B.x, f), lerp(lookY(LOOK_A), lookY(LOOK_B), f), lerp(LOOK_A.z, LOOK_B.z, f));
    cam.position.copy(dummy.position);
    cam.quaternion.copy(dummy.quaternion);
    leg = -1; legF = 0;
    return false;
  }

  // which story leg are we in?
  let t = time - T_DESCENT, i = 0;
  while (i < LEGS.length - 1 && t >= LEGS[i].dur) { t -= LEGS[i].dur; i++; }
  const g = clamp(t / LEGS[i].dur, 0, 1);
  leg = i; legF = g;

  // 1..4) pose i -> pose i+1
  if (i < LEGS.length - 1) {
    const e = g * 0.35 + smooth(g) * 0.65;               // soft ease, no hard stop between legs
    const A = POSES[i], B = POSES[i + 1];
    const x = lerp(A.pos.x, B.pos.x, e), z = lerp(A.pos.z, B.pos.z, e);
    const y = Math.max(lerp(A.pos.y, B.pos.y, e), heightAt(x, z) + MIN_AGL);
    dummy.position.set(x, y, z);
    dummy.lookAt(lerp(A.look.x, B.look.x, e), lerp(A.look.y, B.look.y, e), lerp(A.look.z, B.look.z, e));
    cam.position.copy(dummy.position);
    cam.quaternion.copy(dummy.quaternion);
    return false;
  }

  // 5) landing in the player's eyes
  const f = smooth(g);
  const from = POSES[POSES.length - 1].pos;
  const x = lerp(from.x, save.x, f), z = lerp(from.z, save.z, f);
  const minY = heightAt(x, z) + lerp(3, 1.2, f);
  const y = Math.max(lerp(from.y, save.y, f) + Math.sin(Math.PI * f) * LAND_ARC, minY);
  cam.position.set(x, y, z);
  eul.set(p.pitch, p.yaw, 0);
  qEnd.setFromEuler(eul);
  cam.quaternion.copy(qLand).slerp(qEnd, f);
  return g >= 1;
}



// ============================================================
// extras.js hooks
// ============================================================
export function init(c) {
  ctx = c;
  if (!ENABLED) return;
  console.log('[intro] v2 ready (plays when you press ENTER ISLAND). Console: introPlay()');
}



export function update(dt, c) {
  ctx = c;
  if (state === 'done') return;
  dt = Math.min(dt, 0.1);
  const p = c.player;



  if (state === 'out') {
    tickFade(dt);
    if (fadeV <= 0) { removeFade(); state = 'done'; }
    return;
  }



  if (state === 'wait') {
    if (!c.isPlaying() || !c.isReady() || p.dead) return;
    begin(c);
  }



  // ----- state: run -----
  const playing = c.isPlaying();
  root.style.display = playing ? 'block' : 'none';
  if (fadeEl) fadeEl.style.display = playing ? 'block' : 'none';
  if (!playing) { hideEffects(); return; }      // paused: wait for RESUME



  time += dt;
  tickFade(dt);



  // park the player far from every enemy (they are still drawn, but cannot see him)
  p.x = PARK.x; p.z = PARK.z;
  p.y = Math.max(0, heightAt(PARK.x, PARK.z)) + 1.7;
  p.vx = p.vz = p.vy = 0; p.grounded = true; p.fly = false;
  for (const [k] of kids) k.visible = false;    // no gun in the cinematic
  for (const k of c.camera.children) k.visible = false;



  const ended = placeCamera(c);
  updateEffects(c);
  fixRain(c);                                   // rain around the cinema camera, not around the parked player



  if (!boomed && time >= 1.0) { boomed = true; boom(); }
  if (!swept && time >= T_DESCENT) { swept = true; sweep(110, 460, 3.2, 0.06); }
  if (leg !== lastLeg) { lastLeg = leg; if (leg >= 1) ping(); }

  if (time >= 1.0 && time < T_DESCENT - 0.8) setText('a');
  else if (leg >= 0 && legF > 0.1 && legF < 0.9) setText(LEGS[leg].text);
  else setText(null);
  hintEl.style.opacity = (time >= SKIP_MIN && !skipping) ? '1' : '0';



  if (skipping) {
    if (fadeV >= 1) finish(c);
  } else if (ended) {
    finish(c);
  }
}



export function onKey(code) {
  if (state !== 'run') return false;
  if (code !== 'Space' && code !== 'Enter') return false;
  if (time >= SKIP_MIN && !skipping) {
    skipping = true; fadeGoal = 1; fadeSpeed = 4;
  }
  return true;                                  // no jump while the intro plays
}



export function introActive() {
  return state === 'run';
}



// ---------- console helper ----------
window.introPlay = () => {
  if (state === 'done') { state = 'wait'; console.log('[intro] will play as soon as the game is running'); }
  else console.log('[intro] already playing');
};