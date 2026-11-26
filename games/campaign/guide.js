// ============================================================
// guide.js  (REPLACEMENT, v2)  ->  games/campaign/guide.js
// Mission guide for Strike Command:
//   1. Briefing card on the start / pause screen
//   2. Glowing beam + floating arrow over the Barracks door
//   3. Flowing arrow trail on the ground along the real walking path
//      (A* from pathfinding.js) + the same route on the minimap
//   4. "OBJECTIVE: Go to the Barracks - 120 m" line (top centre)
//   5. Soft lock: the player stays inside the base fence until the
//      first soldier is training (set LOCK_UNTIL_TRAINED = false to test)
// Everything disappears after the first soldier is trained.
// Loaded by extras.js. Safe to delete (the game still runs).
// ============================================================
import * as THREE from 'three';
import { BUILDINGS, FENCES } from './layout.js';
import { heightAt, SPAWN } from './terrain.js';
import { findPath } from './pathfinding.js';
import { key, label, onChange } from './keybinds.js';

// ---------- knobs ----------
const LOCK_UNTIL_TRAINED = true;  // false = never lock the player in the base (for testing)
const LOCK_INSET = 1.6;           // metres kept between the player and the fence
const LOCK_MSG_TIME = 2.5;        // seconds the lock message stays

const NEAR = 7;                   // same distance training.js uses
const BEAM_H = 70;                // beam height (m)
const BEAM_COLOR = 0x40e0ff;      // cyan
const ARROW_COLOR = 0xffd24a;     // gold
const TOAST_TIME = 7;             // seconds the "soldier in training" message stays
const BRIEF_MIN_WIDTH = 1150;     // briefing card is hidden on narrower windows
const SWITCH_BONUS = 8;           // metres closer another barracks must be to switch

const TRAIL_COLOR = 0x40e0ff;
const TRAIL_Y = 0.3;              // height of the chevrons above the ground
const TRAIL_SPACING = 2.6;        // metres between chevrons
const TRAIL_SPEED = 3.5;          // how fast the chevrons flow (m/s)
const TRAIL_START = 1.8;          // first chevron is this far ahead of you
const TRAIL_END_GAP = 2.5;        // trail stops this far before the door
const MAX_CH = 48;                // maximum chevrons on screen
const REPATH_DIST = 2.0;          // recompute the path after moving this far
const REPATH_TIME = 0.25;         // ... but not more often than this (seconds)

// ---------- state ----------
let ctx = null;
let doors = [];
let target = null;
let group = null, beam = null, beamMat = null, ring = null, arrow = null;
let trail = null, trailMat = null;
let objEl = null, briefEl = null, lockEl = null;
let done = false;
let toastT = 0;
let armyT = 0, army = 0;
let lastObj = '', lastBrief = '';
let t = 0;
let base = null;                  // fence rectangle {x0,x1,z0,z1}
let lockT = 0;
let stored = null;                // last A* path [{x,z}, ...]
let storedFor = null;             // which door it was made for
let pathX = 0, pathZ = 0, pathT = 0;
const tmp = new THREE.Vector3();
const dummy = new THREE.Object3D();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- helpers ----------
function findDoors() {
  let list = BUILDINGS.filter(b => b.type === 'barracks');
  if (!list.length) list = BUILDINGS.filter(b => String(b.id).includes('barracks'));
  return list.map(b => {
    // front of a building = local +Z rotated by rot (same maths as training.js)
    const fx = Math.sin(b.rot), fz = Math.cos(b.rot);
    const x = b.x + fx * (b.d / 2 + 1.0);
    const z = b.z + fz * (b.d / 2 + 1.0);
    return { id: b.id, x, z, y: heightAt(x, z) };
  });
}

// the base fence = the smallest fence rectangle that contains the spawn point
function findBase() {
  let best = null, bestArea = Infinity;
  for (const f of FENCES) {
    if (!f.points || f.points.length < 3) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of f.points) {
      if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
      if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1];
    }
    if (SPAWN.x > x0 && SPAWN.x < x1 && SPAWN.z > z0 && SPAWN.z < z1) {
      const area = (x1 - x0) * (z1 - z0);
      if (area < bestArea) { bestArea = area; best = { x0, x1, z0, z1 }; }
    }
  }
  return best || { x0: -180, x1: -100, z0: -150, z1: -70 };
}

function pickTarget(px, pz) {
  if (!doors.length) return null;
  let best = null, bd = Infinity;
  for (const d of doors) {
    const dd = Math.hypot(d.x - px, d.z - pz);
    if (dd < bd) { bd = dd; best = d; }
  }
  if (target && best !== target) {
    const cur = Math.hypot(target.x - px, target.z - pz);
    if (cur - bd < SWITCH_BONUS) return target;   // hysteresis: no flicker
  }
  return best;
}

function readArmy() {
  const el = document.getElementById('train-supply');
  if (!el) return 0;
  const m = /ARMY\s*(\d+)/i.exec(el.textContent || '');
  return m ? parseInt(m[1], 10) : 0;
}

function keyLabel(id, fallback) {
  try { const k = key(id); return k ? label(k) : fallback; }
  catch (e) { return fallback; }
}

// ---------- 3D marker + trail ----------
function buildMarker(scene) {
  group = new THREE.Group();
  group.visible = false;

  // beam with a fading gradient (strong at the bottom, clear at the top)
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0.95)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(cv);

  beamMat = new THREE.MeshBasicMaterial({
    map: tex, color: BEAM_COLOR, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, fog: false
  });
  beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, BEAM_H, 16, 1, true), beamMat);
  beam.position.y = BEAM_H / 2;
  beam.frustumCulled = false;
  group.add(beam);

  // ground ring
  const ringGeo = new THREE.RingGeometry(1.6, 2.1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: BEAM_COLOR, transparent: true, opacity: 0.75,
    blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, fog: false
  }));
  ring.position.y = 0.3;
  group.add(ring);

  // floating arrow (tip pointing down)
  arrow = new THREE.Group();
  const aMat = new THREE.MeshBasicMaterial({ color: ARROW_COLOR, fog: false });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.6, 4), aMat);
  cone.rotation.x = Math.PI;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.2, 0.35), aMat);
  shaft.position.y = 1.4;
  arrow.add(cone, shaft);
  group.add(arrow);

  scene.add(group);

  // ground trail: flat chevrons (pointing along -Z after the flip, rotated per instance)
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.6);
  sh.lineTo(1.1, -0.5);
  sh.lineTo(1.1, -1.05);
  sh.lineTo(0, 0.05);
  sh.lineTo(-1.1, -1.05);
  sh.lineTo(-1.1, -0.5);
  sh.closePath();
  const geo = new THREE.ShapeGeometry(sh);
  geo.rotateX(-Math.PI / 2);                       // lie flat; tip now points to -Z
  trailMat = new THREE.MeshBasicMaterial({
    color: TRAIL_COLOR, transparent: true, opacity: 0.85, depthWrite: false,
    side: THREE.DoubleSide, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  trail = new THREE.InstancedMesh(geo, trailMat, MAX_CH);
  trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trail.frustumCulled = false;
  trail.count = 0;
  trail.visible = false;
  scene.add(trail);
}

// ---------- path (A*) ----------
function toPoints(path) {
  if (!path || !path.length) return null;
  const out = [];
  for (const q of path) {
    if (Array.isArray(q)) out.push({ x: q[0], z: q[1] });
    else if (q && typeof q.x === 'number') out.push({ x: q.x, z: (q.z !== undefined ? q.z : q.y) });
  }
  return out.length ? out : null;
}

function computePath(p, d) {
  let pts = null;
  try { pts = toPoints(findPath(p.x, p.z, d.x, d.z)); } catch (e) { pts = null; }
  if (!pts) pts = [{ x: p.x, z: p.z }, { x: d.x, z: d.z }];      // straight line fallback
  const last = pts[pts.length - 1];
  if (Math.hypot(last.x - d.x, last.z - d.z) > 0.5) pts.push({ x: d.x, z: d.z });
  stored = pts;
  storedFor = d;
  pathX = p.x; pathZ = p.z; pathT = 0;
}

// route from the player to the door: player + the stored nodes still ahead of him
function currentRoute(p) {
  const route = [{ x: p.x, z: p.z }];
  if (!stored) return route;
  let ci = 0, cd = Infinity;
  for (let i = 0; i < stored.length; i++) {
    const dd = Math.hypot(stored[i].x - p.x, stored[i].z - p.z);
    if (dd < cd) { cd = dd; ci = i; }
  }
  for (let i = ci + 1; i < stored.length; i++) route.push(stored[i]);
  if (route.length < 2) route.push(stored[stored.length - 1]);
  return route;
}

function layChevrons(pts) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    seg.push(l); total += l;
  }
  let spacing = TRAIL_SPACING;
  if (total / spacing > MAX_CH) spacing = total / MAX_CH;
  const phase = (t * TRAIL_SPEED) % spacing;
  let n = 0, i = 0, acc = 0;
  for (let d = TRAIL_START + phase; d < total - TRAIL_END_GAP && n < MAX_CH; d += spacing) {
    while (i < seg.length - 1 && acc + seg[i] < d) { acc += seg[i]; i++; }
    if (seg[i] < 0.001) continue;
    const f = clamp((d - acc) / seg[i], 0, 1);
    const ax = pts[i].x, az = pts[i].z, bx = pts[i + 1].x, bz = pts[i + 1].z;
    const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
    const dx = (bx - ax) / seg[i], dz = (bz - az) / seg[i];
    dummy.position.set(x, heightAt(x, z) + TRAIL_Y, z);
    dummy.rotation.set(0, Math.atan2(-dx, -dz), 0);
    dummy.updateMatrix();
    trail.setMatrixAt(n, dummy.matrix);
    n++;
  }
  trail.count = n;
  trail.instanceMatrix.needsUpdate = true;
  trail.visible = n > 0;
}

// ---------- on-screen texts ----------
function buildObjective() {
  objEl = document.createElement('div');
  objEl.id = 'guide-objective';
  objEl.style.cssText = [
    'position:fixed', 'top:18px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:17', 'display:none', 'pointer-events:none',
    'padding:8px 18px', 'border-radius:4px', 'white-space:nowrap',
    'background:rgba(8,14,22,0.72)', 'border:1px solid rgba(64,224,255,0.5)',
    'border-left:3px solid #40e0ff', 'color:#fff', 'font-size:14px',
    'letter-spacing:1px', 'text-shadow:0 1px 3px #000'
  ].join(';');
  document.body.appendChild(objEl);

  lockEl = document.createElement('div');
  lockEl.id = 'guide-lock';
  lockEl.style.cssText = [
    'position:fixed', 'top:64px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:17', 'display:none', 'pointer-events:none',
    'padding:7px 16px', 'border-radius:4px', 'white-space:nowrap',
    'background:rgba(40,20,6,0.82)', 'border:1px solid #ffb02e',
    'color:#ffd9a0', 'font-size:13px', 'font-weight:bold',
    'letter-spacing:1px', 'text-shadow:0 1px 3px #000'
  ].join(';');
  document.body.appendChild(lockEl);
}

function setObjective(html) {
  if (!objEl) return;
  if (html === null) {
    if (lastObj !== '') { objEl.style.display = 'none'; lastObj = ''; }
    return;
  }
  if (html !== lastObj) { objEl.innerHTML = html; lastObj = html; }
  objEl.style.display = 'block';
}

function showLock(msg) {
  if (!lockEl) return;
  lockEl.textContent = msg;
  lockEl.style.display = 'block';
  lockT = LOCK_MSG_TIME;
}

function hideLock() {
  lockT = 0;
  if (lockEl) lockEl.style.display = 'none';
}

const TAG = '<span style="color:#40e0ff;font-weight:bold;margin-right:8px">OBJECTIVE</span>';
const KEYBOX = k => '<b style="color:#ffd24a;border:1px solid #ffd24a;border-radius:3px;padding:0 5px">' + k + '</b>';

// ---------- briefing card (start / pause screen) ----------
function briefingHTML() {
  const E = keyLabel('interact', 'E');
  const F = keyLabel('follow', '1');
  const H = keyLabel('hold', '2');
  const A = keyLabel('attack', '3');
  const M = keyLabel('map', 'M');
  const b = s => '<b style="color:#ffd24a">' + s + '</b>';
  const first = LOCK_UNTIL_TRAINED
    ? '<li>Follow the ' + b('arrows') + ' to the ' + b('Barracks') + '. You stay inside the base until your first soldier is training.</li>'
    : '<li>Walk to the ' + b('Barracks') + ' (follow the arrows).</li>';
  return (
    '<div style="color:#40e0ff;font-size:11px;letter-spacing:3px">MISSION BRIEFING</div>' +
    '<div style="font-size:17px;font-weight:bold;letter-spacing:1px;margin:2px 0 8px">OPERATION PORT TOWN</div>' +
    '<div style="margin-bottom:8px;color:#b9c9d4">The <b style="color:#ff6b6b">Space Gang</b> has captured Port Town. ' +
    'The harbor is their supply line. You command Strike Command: train an army and take the town back.</div>' +
    '<div style="color:#40e0ff;font-size:11px;letter-spacing:2px;margin-bottom:4px">YOUR ORDERS</div>' +
    '<ol style="margin:0;padding-left:18px">' +
    first +
    '<li>Press ' + b(E) + ' at the door, then ' + b('1 / 2 / 3') + ' to train a pistol, rifle or shotgun soldier. Training costs supplies.</li>' +
    '<li>' + b(F) + ' soldiers follow you, ' + b(H) + ' hold position, ' + b(A) + ' send them to the town square.</li>' +
    '<li>Clear the enemies in Port Town. Stay behind cover.</li>' +
    '</ol>' +
    '<div style="margin-top:8px;color:#8fa3b0;font-size:12px">Army limit: 12 soldiers · ' + b(M) + ' opens the map · health slowly regenerates.</div>'
  );
}

function buildBriefing() {
  briefEl = document.createElement('div');
  briefEl.id = 'guide-briefing';
  briefEl.style.cssText = [
    'position:fixed', 'left:24px', 'top:50%', 'transform:translateY(-50%)',
    'width:310px', 'max-height:84vh', 'overflow:hidden', 'z-index:9999',
    'display:none', 'pointer-events:none', 'padding:14px 16px',
    'border-radius:6px', 'background:rgba(8,14,22,0.84)',
    'border:1px solid rgba(64,224,255,0.45)', 'border-left:3px solid #40e0ff',
    'color:#dbe8f0', 'font-size:13px', 'line-height:1.45'
  ].join(';');
  document.body.appendChild(briefEl);

  const tick = () => {
    const ss = document.getElementById('start-screen');
    let shown = false;
    if (ss) {
      const cs = getComputedStyle(ss);
      shown = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    }
    if (ctx && ctx.isPlaying()) shown = false;
    if (window.innerWidth < BRIEF_MIN_WIDTH) shown = false;
    if (shown) {
      const html = briefingHTML();
      if (html !== lastBrief) { briefEl.innerHTML = html; lastBrief = html; }
    }
    briefEl.style.display = shown ? 'block' : 'none';
  };
  setInterval(tick, 250);
  tick();
  try { onChange(() => { lastBrief = ''; }); } catch (e) { /* ignore */ }
}

// ---------- soft lock ----------
function applyLock(p, c) {
  if (p.fly) {                                   // no flying out of the base
    p.fly = false;
    showLock('FLY MODE IS OFF · TRAIN YOUR FIRST SOLDIER AT THE BARRACKS');
  }
  const x0 = base.x0 + LOCK_INSET, x1 = base.x1 - LOCK_INSET;
  const z0 = base.z0 + LOCK_INSET, z1 = base.z1 - LOCK_INSET;
  const nx = clamp(p.x, x0, x1), nz = clamp(p.z, z0, z1);
  if (nx !== p.x || nz !== p.z) {
    c.camera.position.x += nx - p.x;             // keep the camera in step (no one-frame jitter)
    c.camera.position.z += nz - p.z;
    if (nx !== p.x) p.vx = 0;
    if (nz !== p.z) p.vz = 0;
    p.x = nx; p.z = nz;
    showLock('TRAIN YOUR FIRST SOLDIER AT THE BARRACKS FIRST');
  }
}

function hideAll(c) {
  if (group) group.visible = false;
  if (trail) trail.visible = false;
  setObjective(null);
  hideLock();
  if (c) c.guideRoute = null;
}

// ============================================================
// extras.js hooks
// ============================================================
export function init(c) {
  ctx = c;
  doors = findDoors();
  base = findBase();
  buildObjective();
  buildBriefing();
  if (!doors.length) {
    console.warn('[guide] no barracks found in layout.js - beam, trail and lock off');
    return;
  }
  buildMarker(c.scene);
  console.log('[guide] ready. lock=' + LOCK_UNTIL_TRAINED + ' base=' + JSON.stringify(base));
}

export function update(dt, c) {
  t += dt;
  const p = c.player;
  const active = c.isPlaying() && !p.dead;

  if (!active || !doors.length) { hideAll(c); return; }

  // has the first soldier been trained (or started training)?
  armyT -= dt;
  if (armyT <= 0) { armyT = 0.25; army = readArmy(); }
  if (!done && (c.getSoldiers().length > 0 || army > 0)) {
    done = true;
    toastT = TOAST_TIME;
  }

  if (done) {
    if (group) group.visible = false;
    if (trail) trail.visible = false;
    c.guideRoute = null;
    hideLock();
    if (toastT > 0) {
      toastT -= dt;
      setObjective(
        '<span style="color:#7dff9a;font-weight:bold;margin-right:8px">✔ SOLDIER IN TRAINING</span>' +
        KEYBOX(keyLabel('follow', '1')) + ' Follow &nbsp; ' +
        KEYBOX(keyLabel('hold', '2')) + ' Hold &nbsp; ' +
        KEYBOX(keyLabel('attack', '3')) + ' Attack'
      );
    } else {
      setObjective(null);
    }
    return;
  }

  // ----- objective still active -----
  if (LOCK_UNTIL_TRAINED) applyLock(p, c);
  if (lockT > 0) { lockT -= dt; if (lockT <= 0) hideLock(); }

  target = pickTarget(p.x, p.z);
  const dx = target.x - p.x, dz = target.z - p.z;
  const dist = Math.hypot(dx, dz);

  // path: recompute when the door changed or the player moved far enough
  pathT += dt;
  const moved = Math.hypot(p.x - pathX, p.z - pathZ);
  if (!stored || storedFor !== target || (moved > REPATH_DIST && pathT > REPATH_TIME)) {
    computePath(p, target);
  }
  const route = currentRoute(p);
  c.guideRoute = route;                          // minimap.js draws this
  if (dist > NEAR + 3) layChevrons(route);
  else if (trail) trail.visible = false;
  if (trailMat) trailMat.opacity = 0.65 + 0.25 * Math.sin(t * 5);

  // marker
  group.visible = true;
  group.position.set(target.x, target.y, target.z);
  beamMat.opacity = clamp((dist - 4) / 12, 0.15, 1) * 0.9;
  const bs = clamp(dist / 70, 1, 3);
  beam.scale.set(bs, 1, bs);
  ring.scale.setScalar((1 + 0.15 * Math.sin(t * 4)) * clamp(dist / 60, 1, 2.5));
  arrow.position.y = 5 + Math.sin(t * 2.5) * 0.4;
  arrow.rotation.y = t * 1.6;
  arrow.scale.setScalar(clamp(dist / 30, 1, 4));

  // which side is the door on (when off screen)?
  tmp.set(target.x, target.y + 2, target.z).project(c.camera);
  const behind = tmp.z > 1;
  let side = 0;
  if (behind) side = tmp.x > 0 ? -1 : 1;
  else if (Math.abs(tmp.x) > 0.9) side = tmp.x > 0 ? 1 : -1;
  const left = side < 0 ? '<span style="color:#ffd24a;margin-right:8px">◀</span>' : '';
  const right = side > 0 ? '<span style="color:#ffd24a;margin-left:8px">▶</span>' : '';

  if (dist < NEAR) {
    setObjective(TAG + 'Press ' + KEYBOX(keyLabel('interact', 'E')) + ' to open the Barracks');
  } else {
    setObjective(left + TAG + 'Go to the Barracks · ' + Math.round(dist) + ' m' + right);
  }
}

export function onEvent(name) {
  if (name === 'died') hideAll(ctx);
  if (name === 'restart') reset();
}

export function reset() {
  done = false;
  toastT = 0;
  army = 0;
  armyT = 1.0;      // give training.js a moment to refresh its counter
  target = null;
  stored = null;
  storedFor = null;
  lastObj = '';
  if (group) group.visible = false;
  if (trail) trail.visible = false;
  if (objEl) objEl.style.display = 'none';
  hideLock();
  if (ctx) ctx.guideRoute = null;
}