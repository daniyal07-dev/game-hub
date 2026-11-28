// ============================================================
//  NOVA STRIKE 3D — Campaign: games/campaign/vehicles.js  (v4)
//  The ARMY TRUCK (built from code, no model file).
//    E near the truck = get in / get out      V = first / third person
//    W A S D (or arrows) drive, SPACE handbrake, SHIFT boost
//  * First person: you sit in the cab with a dashboard and a
//    steering wheel that turns. Third person is the fallback.
//  * Up to 12 soldiers ride in the back (hidden while riding) and
//    jump out behind the truck when you get out.
//  * Walls, trees and deep water stop the truck (collision.js).
//  * Driving over an enemy at speed kills it (roadkill counter).
//  * Phones: arrows / gas / brake pad (phone-ui.js), VIEW / GET OUT buttons.
//  Does not touch main.js or player.js. Loaded by extras.js.
//  Exports buildTruck() so the enemy truck can reuse the model.
//  Console: vehicles()  vehicles({view:'tpp', fwd:22, here:true, require:false, solid:true})
//
//  v2: sharp-turn fixes. Gloves ride on the steering wheel and the
//      arms follow them, smaller wheel turn, limited turn rate (less
//      steering at speed), third person camera eases behind the truck,
//      the truck will not rotate into walls/trees, calmer slope tilt.
//      Hands are hidden while parked, crosshair comes back after
//      getting out.
//  v3: soldiers are really hidden while riding (body = s.char.group),
//      riders cannot shoot or walk off, they get out facing the truck's
//      direction, and the truck HUD / prompt / buttons are hidden while
//      the game is paused.
//  v4: SOLID TRUCK. The truck body is now a solid box for you and your
//      soldiers (you cannot walk through it, you slide along it).
//      Size knobs: BODY_HX, BODY_Z0, BODY_Z1, BODY_TOP. SOLID = false
//      switches it off.
// ============================================================
import * as THREE from 'three';
import { resolve, blockedAt, groundHeight, onPier } from './collision.js';
import { heightAt, SPAWN, WORLD } from './terrain.js';
import { hurtEnemy } from './enemies.js';
import { matches, isDown } from './keybinds.js';





// ---------- knobs ----------
const MAX_SOLDIERS = 12;          // seats in the back
const BOARD_R = 70;               // soldiers closer than this (m) climb in
const ENTER_R = 5.5;              // how close you must be to get in (m)
const EXIT_SPEED = 3.5;           // you can only get out slower than this (m/s)
let REQUIRE_SOLDIER = true;       // true = truck unlocks after your first trained soldier
let MAX_FWD = 17;                 // top speed (m/s, 17 = about 61 km/h)
const MAX_REV = 6;                // reverse speed
const BOOST = 1.3;                // SHIFT multiplies the top speed by this
let ACCEL = 7.5;                  // pick-up
const BRAKE = 16;                 // braking when you push the other way
const COAST = 3;                  // slowing down with no key
const HAND = 22;                  // handbrake (SPACE)
const WHEELBASE = 4.2;            // steering geometry
const MAX_STEER = 0.55;           // wheel angle (rad) at standstill
const STEER_FAST = 0.75;          // how much steering is taken away at top speed (0..1)
const MAX_YAW_RATE = 1.1;         // the truck never turns faster than this (rad/s)
const STEER_IN = 2.4, STEER_OUT = 3.2;   // how fast the wheels turn / come back
const WHEEL_R = 0.55;
const WHEEL_TURN = 2.4;           // steering wheel turns this much per wheel angle
const CR = 1.4;                   // collision circle radius
const CIRCLES = [-2.6, -0.9, 0.9, 2.6];  // collision circles along the truck (m)
const WATER_BLOCK = -1.4;         // same as main.js: deep water stops you
const EYE_LOCAL = new THREE.Vector3(-0.55, 1.98, -0.95);   // driver's eyes inside the cab
const LOOK_YAW = 1.9;             // how far you may look left / right in the cab (rad)
const TPP_DIST = 9.5;             // third person camera distance
const TPP_FOLLOW = 2.2;           // how fast the third person camera swings behind the truck
const TILT_FOLLOW = 5;            // how fast the truck follows slopes (smaller = calmer)
const MAX_PITCH = 0.35, MAX_ROLL = 0.3;   // largest tilt on slopes (rad)
let ROADKILL_SPEED = 5;           // m/s needed to hit an enemy
let ROADKILL_DMG = 250;
const ENGINE_VOL = 0.05;
const VIEW_KEY = 'campaign_truckview';
const PHONE = (typeof matchMedia === 'function' &&
               matchMedia('(hover: none) and (pointer: coarse)').matches);

// solid body (walking player and soldiers cannot enter it)
let SOLID = true;                 // false = walk through the truck again
const BODY_HX = 1.25;             // half width of the truck body (m)
const BODY_Z0 = -3.65;            // front end (local Z, the front points to -Z)
const BODY_Z1 = 3.95;             // rear end
const BODY_TOP = 2.8;             // above this height (m over the truck's ground) you could pass over it
const SOLID_R = 0.45;             // body radius of a person





// ---------- state ----------
let C = null, built = false, ui = null, beacon = null, rig = null, M = null;
const T = { x: 0, z: 0, y: 0, h: 0, speed: 0, steer: 0, pitch: 0, roll: 0, home: { x: 0, z: 0, h: 0 } };
let driving = false, view = 'fpp';
let cargo = [];
let roadkills = 0, shake = 0, bobT = 0, hudT = 0, hudLast = '';
const hitAt = new Map();
let tmx = 0, tmy = 0, tjump = false, tsprint = false, wrapped = false;
const down = {};
try { if (localStorage.getItem(VIEW_KEY) === 'tpp') view = 'tpp'; } catch (e) { /* ignore */ }
let ac = null, eng = null, master = 0.8, toastTimer = 0;
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
const PP = { x: 0, z: 0 };
const _o = { x: 0, z: 0, hit: false };





const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const isPlay = () => !!(C && C.isPlaying && C.isPlaying());
const walkOK = (x, z) => heightAt(x, z) > WATER_BLOCK || onPier(x, z);
function isUse(code) {
  try { return matches('use', code) || code === 'KeyE'; } catch (e) { return code === 'KeyE'; }
}





// ---------- reading / moving soldiers and enemies ----------
// A soldier from units.js is { char, x, z, heading, hp, ... }; his 3D body is s.char.group.
function groupOf(e) {
  if (e.char && e.char.group) return e.char.group;
  const u = e.unit || e.u || e;
  return u.group || u.model || e.group || e.model || u.mesh || e.mesh || u.obj || e.obj || null;
}
function posOf(e) {
  if (typeof e.x === 'number' && typeof e.z === 'number') { PP.x = e.x; PP.z = e.z; return PP; }
  const u = e.unit || e.u || e;
  if (u.pos && typeof u.pos.x === 'number' && typeof u.pos.z === 'number') { PP.x = u.pos.x; PP.z = u.pos.z; return PP; }
  const g = groupOf(e);
  if (g && g.position) { PP.x = g.position.x; PP.z = g.position.z; return PP; }
  if (e.position && typeof e.position.x === 'number') { PP.x = e.position.x; PP.z = e.position.z; return PP; }
  return null;
}
function isDead(e) {
  return !!(e.dead || (e.unit && e.unit.dead) || e.state === 'dead' ||
            (typeof e.hp === 'number' && e.hp <= 0));
}
function place(s, x, y, z) {
  const u = s.unit || s.u || s;
  for (const o of (u === s ? [s] : [s, u])) {
    if (typeof o.x === 'number' && typeof o.z === 'number') { o.x = x; o.z = z; if (typeof o.y === 'number') o.y = y; }
    if (o.pos && typeof o.pos.x === 'number') { o.pos.x = x; o.pos.z = z; if (typeof o.pos.y === 'number') o.pos.y = y; }
  }
  const g = groupOf(s);
  if (g && g.position) g.position.set(x, y, z);
}
// show / hide a soldier's body; returns true if a body was found
function setShown(s, on) {
  const g = groupOf(s);
  if (g) g.visible = on;
  return !!g;
}
// every frame a rider is inside: no target, no shooting, no walking off
function holdRider(s) {
  s.aim = null;
  s.fireT = 1;
  s.path = [];
  s.pi = 0;
  s.repathT = 1;
  s.moving = false;
  s.stuckT = 0;
}





// ============================================================
//  SOLID BODY: push people out of the truck's box
// ============================================================
// Returns { x, z, hit }. (x, z) is the nearest point outside the body (radius r around it).
// The result object is reused, read it straight away.
function pushOutOfTruck(x, z, r) {
  _o.hit = false; _o.x = x; _o.z = z;
  if (!SOLID || !built) return _o;
  const dx = x - T.x, dz = z - T.z;
  if (dx * dx + dz * dz > 64) return _o;              // farther than 8 m: nothing to do
  const ch = Math.cos(T.h), sh = Math.sin(T.h);
  let lx = dx * ch - dz * sh;                         // position in the truck's own frame
  let lz = dx * sh + dz * ch;
  const cz = (BODY_Z0 + BODY_Z1) / 2;
  const hx = BODY_HX + r, hz = (BODY_Z1 - BODY_Z0) / 2 + r;
  const ox = hx - Math.abs(lx), oz = hz - Math.abs(lz - cz);
  if (ox <= 0 || oz <= 0) return _o;                  // outside the box
  if (ox < oz) lx = lx >= 0 ? hx : -hx;               // leave by the nearest side
  else lz = cz + (lz - cz >= 0 ? hz : -hz);
  _o.x = T.x + lx * ch + lz * sh;
  _o.z = T.z - lx * sh + lz * ch;
  _o.hit = true;
  return _o;
}
// soldiers on foot (not riding) cannot stand inside the truck either
function pushSoldiers() {
  if (!SOLID || !built || !C || !C.getSoldiers) return;
  for (const s of C.getSoldiers()) {
    if (isDead(s) || cargo.includes(s)) continue;
    const q = posOf(s);
    if (!q) continue;
    const o = pushOutOfTruck(q.x, q.z, SOLID_R);
    if (!o.hit) continue;
    const g = groupOf(s);
    place(s, o.x, g && g.position ? g.position.y : (typeof s.y === 'number' ? s.y : 0), o.z);
    if (s.char && s.char.setPose) s.char.setPose(o.x, o.z, typeof s.heading === 'number' ? s.heading : 0);
  }
}
// the walking player slides along the truck
function pushPlayer(p) {
  if (!SOLID || p.dead) return;
  if (p.y - 1.7 > T.y + BODY_TOP) return;             // above the roof
  const o = pushOutOfTruck(p.x, p.z, SOLID_R);
  if (!o.hit) return;
  const cam = C.camera;
  if (cam) { cam.position.x += o.x - p.x; cam.position.z += o.z - p.z; }   // the camera was already placed this frame
  p.x = o.x; p.z = o.z;
}





// ============================================================
//  THE TRUCK MODEL  (exported: the enemy truck uses it too)
// ============================================================
function makeEmblem(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 8;
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 20 : 44;
    g.lineTo(64 + Math.cos(a) * r, 66 + Math.sin(a) * r);
  }
  g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}





// Truck origin = ground, middle of the truck. The front points to -Z (like the camera).
export function buildTruck(o = {}) {
  const std = (color, rough = 0.85, metal = 0.1, extra = {}) =>
    new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra));
  const mBody = std(o.body ?? 0x4a5a33);
  const mCanvas = std(o.canvas ?? 0x5b6a42, 0.95, 0, { side: THREE.DoubleSide });
  const mDark = std(0x1d2021, 0.8, 0.3);
  const mDash = std(0x2a2d29, 0.9, 0.1, { emissive: 0x15171a });
  const mSeat = std(0x3b3f33, 0.95, 0, { emissive: 0x15170f });
  const mFloor = std(0x25272a, 0.95, 0, { emissive: 0x101112 });
  const mTire = std(0x131313, 0.95, 0);
  const mTread = std(0x333333, 0.9, 0);
  const mHub = std(0x5a5f55, 0.6, 0.5);
  const mGlove = std(0x181a16, 0.9, 0);
  const mSleeve = std(o.body ?? 0x4a5a33, 0.9, 0);
  const mGlass = std(0x9fc8e6, 0.1, 0.3, { transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false });
  const mHead = new THREE.MeshBasicMaterial({ color: 0xfff0b8 });
  const mTail = new THREE.MeshBasicMaterial({ color: 0xc01818 });





  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const box = (w, h, d, mat, x, y, z, cast = true, parent = g) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    parent.add(m);
    return m;
  };





  // chassis, hood, bumper, grille, lights
  box(2.0, 0.3, 7.3, mDark, 0, 0.82, 0.15);
  box(2.2, 0.6, 1.45, mBody, 0, 1.35, -2.85);
  box(2.4, 0.32, 0.28, mDark, 0, 0.8, -3.62);
  box(1.4, 0.5, 0.05, mDark, 0, 1.38, -3.58, false);
  box(0.35, 0.22, 0.08, mHead, -0.8, 1.45, -3.6, false);
  box(0.35, 0.22, 0.08, mHead, 0.8, 1.45, -3.6, false);
  box(0.3, 0.2, 0.06, mTail, -0.9, 1.0, 3.9, false);
  box(0.3, 0.2, 0.06, mTail, 0.9, 1.0, 3.9, false);
  // fenders and mirrors, exhaust
  for (const sx of [-1, 1]) {
    box(0.5, 0.1, 1.4, mBody, sx * 1.15, 1.2, -2.2);
    box(0.5, 0.1, 2.6, mBody, sx * 1.15, 1.2, 2.1);
    box(0.06, 0.35, 0.2, mDark, sx * 1.42, 2.2, -2.0, false);
    box(0.28, 0.04, 0.04, mDark, sx * 1.29, 2.1, -2.0, false);
  }
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), mDark);
  ex.position.set(1.3, 1.9, -0.25); g.add(ex);





  // cab (thin panels, so you can look out of the windows from inside)
  box(2.3, 0.1, 1.75, mFloor, 0, 1.0, -1.3, false);
  box(2.4, 0.1, 2.0, mBody, 0, 2.72, -1.3, false);
  box(2.3, 1.7, 0.08, mBody, 0, 1.85, -0.42, true);
  for (const sx of [-1, 1]) {
    box(0.08, 0.85, 1.75, mBody, sx * 1.16, 1.45, -1.3);
    box(0.1, 1.0, 0.1, mBody, sx * 1.12, 2.2, -2.12);
    box(0.1, 1.0, 0.1, mBody, sx * 1.12, 2.2, -0.5);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.95), mGlass);
    gl.position.set(sx * 1.14, 2.2, -1.3); gl.rotation.y = Math.PI / 2; g.add(gl);
  }
  box(2.3, 0.12, 0.1, mBody, 0, 2.68, -2.12, false);
  box(2.2, 0.32, 0.5, mDash, 0, 1.42, -1.95, false);
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.0), mGlass);
  ws.position.set(0, 2.2, -2.14); g.add(ws);
  // seats
  for (const sx of [-0.55, 0.55]) {
    box(0.6, 0.18, 0.55, mSeat, sx, 1.25, -0.78, false);
    box(0.6, 0.75, 0.1, mSeat, sx, 1.7, -0.52, false);
  }





  // star on both doors
  const emb = makeEmblem(o.emblem || '#e8efe0');
  for (const sx of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7),
      new THREE.MeshBasicMaterial({ map: emb, transparent: true, alphaTest: 0.1, toneMapped: false }));
    pl.position.set(sx * 1.215, 1.45, -1.3);
    pl.rotation.y = sx * Math.PI / 2;
    g.add(pl);
  }





  // cargo bed and canvas cover
  box(2.4, 0.14, 4.2, mDark, 0, 1.02, 1.75);
  box(2.4, 1.0, 0.08, mBody, 0, 1.5, -0.33);
  box(2.4, 0.75, 0.08, mBody, 0, 1.45, 3.85);
  for (const sx of [-1, 1]) box(0.08, 0.75, 4.2, mBody, sx * 1.2, 1.45, 1.75);
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 4.1, 18, 1, true, Math.PI / 2, Math.PI), mCanvas);
  cover.rotation.x = Math.PI / 2;
  cover.scale.set(1, 1, 0.8);
  cover.position.set(0, 1.82, 1.75);
  cover.castShadow = true;
  g.add(cover);





  // wheels: 3 axles. The front pair steers. 'spin' turns when rolling.
  const spinners = [], fronts = [];
  for (const [z, front] of [[-2.2, true], [1.4, false], [2.8, false]]) {
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 1.15, WHEEL_R, z);
      const spin = new THREE.Group();
      pivot.add(spin);
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.4, 20), mTire);
      tire.rotation.z = Math.PI / 2; tire.castShadow = true; spin.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.42, 10), mHub);
      hub.rotation.z = Math.PI / 2; spin.add(hub);
      for (const yy of [WHEEL_R, -WHEEL_R]) {
        const tr = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.16), mTread);
        tr.position.y = yy; spin.add(tr);
      }
      g.add(pivot);
      spinners.push(spin);
      if (front) fronts.push(pivot);
    }
  }





  // steering wheel (tilted toward the driver) + the part that turns
  const tilt = new THREE.Group();
  tilt.position.set(-0.55, 1.62, -1.72);
  tilt.rotation.x = -0.95;
  g.add(tilt);
  const steer = new THREE.Group();
  tilt.add(steer);
  steer.add(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.024, 10, 28), mDark));
  const hubS = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 12), mDark);
  hubS.rotation.x = Math.PI / 2; steer.add(hubS);
  box(0.4, 0.026, 0.026, mDark, 0, 0, 0, false, steer);
  box(0.026, 0.2, 0.026, mDark, 0, -0.1, 0, false, steer);
  box(0.03, 0.06, 0.03, std(0xe6e08a, 0.6, 0), 0, 0.2, 0, false, steer);   // top marker so you can see it turn
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), mDark);
  col.rotation.x = Math.PI / 2; col.position.z = -0.25; tilt.add(col);





  // gloved hands: the gloves ride ON the wheel rim (they turn with it),
  // the arms are stretched every frame from a fixed elbow to each glove.
  g.updateMatrixWorld(true);
  const hands = new THREE.Group();
  g.add(hands);
  const gloves = [], arms = [];
  for (const sx of [-1, 1]) {
    const hp = tilt.localToWorld(new THREE.Vector3(sx * 0.2, 0.01, 0));
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), mGlove);
    glove.scale.set(1, 0.8, 1.25);
    glove.position.set(sx * 0.2, 0.01, 0);
    steer.add(glove);
    gloves.push(glove);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 1, 8), mSleeve);
    hands.add(arm);
    arms.push({ mesh: arm, glove, elbow: new THREE.Vector3(hp.x + sx * 0.14, hp.y - 0.34, hp.z + 0.8) });
  }
  const wp = new THREE.Vector3(), dv = new THREE.Vector3(), upV = new THREE.Vector3(0, 1, 0);
  const poseArms = () => {                 // call after the truck's matrices are updated
    for (const r of arms) {
      r.glove.getWorldPosition(wp);
      g.worldToLocal(wp);
      dv.subVectors(wp, r.elbow);
      const len = Math.max(0.01, dv.length());
      r.mesh.position.copy(r.elbow).addScaledVector(dv, 0.5);
      r.mesh.quaternion.setFromUnitVectors(upV, dv.divideScalar(len));
      r.mesh.scale.set(1, len, 1);
    }
  };
  const setHands = (show) => { hands.visible = show; for (const gl of gloves) gl.visible = show; };
  setHands(false);





  return { group: g, spinners, fronts, steer, hands, setHands, poseArms };
}





// ============================================================
//  PLACING THE TRUCK
// ============================================================
function spotOK(x, z, h) {
  const s = Math.sin(h), c = Math.cos(h);
  for (const o of CIRCLES) {
    const cx = x + s * o, cz = z + c * o;
    if (blockedAt(cx, cz, CR) || !walkOK(cx, cz)) return false;
  }
  return true;
}
// true if turning to heading h at (x, z) would push the truck into something
function turnBlocked(x, z, h) {
  const s = Math.sin(h), c = Math.cos(h);
  for (const o of CIRCLES) {
    if (blockedAt(x + s * o, z + c * o, CR * 0.85)) return true;
  }
  return false;
}
function findHome() {
  const bx = SPAWN.x + 9, bz = SPAWN.z + 7, h = -Math.PI / 2;     // beside the start, facing east (the gate)
  if (spotOK(bx, bz, h)) return { x: bx, z: bz, h };
  for (let r = 3; r <= 50; r += 3) {
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      const x = bx + Math.cos(a) * r, z = bz + Math.sin(a) * r;
      if (spotOK(x, z, h)) return { x, z, h };
    }
  }
  console.warn('[vehicles] no free spot found near the start, placing the truck anyway');
  return { x: bx, z: bz, h };
}
function applyTransform() {
  M.position.set(T.x, T.y, T.z);
  M.rotation.set(T.pitch, T.h, T.roll);
  for (const f of rig.fronts) f.rotation.y = T.steer;
  rig.steer.rotation.z = T.steer * WHEEL_TURN;
}
function goHome() {
  T.x = T.home.x; T.z = T.home.z; T.h = T.home.h;
  T.speed = 0; T.steer = 0; T.pitch = 0; T.roll = 0;
  T.y = groundHeight(T.x, T.z);
  applyTransform();
}
function build(ctx) {
  rig = buildTruck({});
  M = rig.group;
  ctx.scene.add(M);
  beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 40, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
  beacon.visible = false;
  ctx.scene.add(beacon);
  T.home = findHome();
  goHome();
  built = true;
  console.log('[vehicles] truck ready at X ' + Math.round(T.x) + ' Z ' + Math.round(T.z) +
              ' · ' + (REQUIRE_SOLDIER ? 'unlocks after your first soldier' : 'unlocked'));
}





// ============================================================
//  SCREEN PARTS
// ============================================================
function ensureUi() {
  if (ui) return;
  const css = document.createElement('style');
  css.textContent = `
  #veh-prompt{position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:30;display:none;padding:9px 18px;border-radius:999px;background:rgba(10,24,48,.82);border:1px solid rgba(120,190,255,.7);color:#d6ecff;font:700 14px system-ui,Segoe UI,Arial,sans-serif;letter-spacing:1.5px;pointer-events:none;text-shadow:0 0 6px #000;white-space:nowrap}
  #veh-prompt.tap{pointer-events:auto;cursor:pointer;padding:12px 22px}
  #veh-hud{position:fixed;right:22px;bottom:150px;z-index:20;display:none;text-align:right;color:#e8f4ff;font:700 13px Consolas,monospace;letter-spacing:1px;text-shadow:0 0 6px #000;pointer-events:none}
  #veh-hud .h{font-size:11px;opacity:.7}
  #veh-hud .b{font-size:28px;color:#7fe8ff}
  #veh-hud .s{font-size:12px;color:#cfe7ff}
  #veh-hud .k{font-size:10px;opacity:.55;margin-top:2px}
  #veh-btns{position:fixed;left:50%;bottom:58px;transform:translateX(-50%);z-index:31;display:none;gap:10px}
  #veh-btns button{font:700 12px system-ui,Segoe UI,Arial,sans-serif;letter-spacing:1.5px;padding:9px 16px;border-radius:999px;border:1px solid rgba(120,190,255,.7);background:rgba(10,24,48,.78);color:#d6ecff}
  #veh-toast{position:fixed;left:50%;bottom:30%;transform:translateX(-50%);z-index:60;pointer-events:none;padding:7px 16px;border-radius:999px;background:rgba(10,24,48,.85);border:1px solid rgba(120,190,255,.6);color:#d6ecff;font:700 13px system-ui,Segoe UI,Arial,sans-serif;letter-spacing:1.5px;display:none}
  @media (hover:none) and (pointer:coarse){#veh-hud{bottom:128px;right:14px}#veh-hud .b{font-size:20px}}
  `;
  document.head.appendChild(css);
  const mk = (id) => { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); return d; };
  ui = { prompt: mk('veh-prompt'), hud: mk('veh-hud'), btns: mk('veh-btns'), toast: mk('veh-toast') };
  if (PHONE) ui.prompt.classList.add('tap');
  ui.btns.innerHTML = '<button data-a="view">VIEW</button><button data-a="out">GET OUT</button>';





  const tap = (el, fn) => {
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    el.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  };
  tap(ui.prompt, () => { if (PHONE) enter(); });
  ui.btns.querySelectorAll('button').forEach((b) => {
    tap(b, () => { if (b.dataset.a === 'view') toggleView(); else leave(false); });
  });
}
function toast(msg) {
  if (!ui) return;
  ui.toast.textContent = msg;
  ui.toast.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.style.display = 'none'; }, 1800);
}





// ---------- engine sound (made in code) ----------
function startEngine() {
  try {
    const s = JSON.parse(localStorage.getItem('nova_settings') || 'null');
    if (s && typeof s.master === 'number') master = s.master;
  } catch (e) { /* ignore */ }
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const o1 = ac.createOscillator(); o1.type = 'sawtooth';
      const o2 = ac.createOscillator(); o2.type = 'square';
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
      const gn = ac.createGain(); gn.gain.value = 0;
      o1.connect(lp); o2.connect(lp); lp.connect(gn); gn.connect(ac.destination);
      o1.start(); o2.start();
      eng = { o1, o2, lp, gn };
    }
    if (ac.state === 'suspended') ac.resume();
  } catch (e) { ac = null; eng = null; }
}
function engineTick(on, sf, thr) {
  if (!ac || !eng) return;
  const t = ac.currentTime;
  const f = 36 + sf * 62 + Math.abs(thr) * 8;
  eng.o1.frequency.setTargetAtTime(f, t, 0.08);
  eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
  eng.lp.frequency.setTargetAtTime(240 + sf * 520, t, 0.1);
  eng.gn.gain.setTargetAtTime(on ? ENGINE_VOL * master * (0.55 + 0.45 * Math.abs(thr) + 0.3 * sf) : 0, t, 0.12);
}





// ============================================================
//  GETTING IN / OUT
// ============================================================
function nearTruck(p) { return Math.hypot(p.x - T.x, p.z - T.z) < ENTER_R; }
function unlocked() { return !REQUIRE_SOLDIER || (C.getSoldiers && C.getSoldiers().length > 0); }





function boardSoldiers() {
  cargo = [];
  const list = C.getSoldiers ? C.getSoldiers() : [];
  const cand = [];
  let unreadable = 0;
  for (const s of list) {
    if (isDead(s)) continue;
    const q = posOf(s);
    if (!q) { unreadable++; continue; }
    const d = Math.hypot(q.x - T.x, q.z - T.z);
    if (d <= BOARD_R) cand.push({ s, d });
  }
  cand.sort((a, b) => a.d - b.d);
  let hidden = 0;
  for (const c of cand.slice(0, MAX_SOLDIERS)) {
    cargo.push(c.s);
    holdRider(c.s);
    if (setShown(c.s, false)) hidden++;
  }
  console.log('[vehicles] ' + cargo.length + ' soldiers climbed in (' + hidden + ' hidden)' +
              (unreadable ? ' · ' + unreadable + ' soldiers have no readable position' : ''));
  if (list.length && !cargo.length && unreadable) console.warn('[vehicles] soldier fields:', Object.keys(list[0]));
}
function unloadSoldiers() {
  const sh = Math.sin(T.h), ch = Math.cos(T.h);
  cargo.forEach((s, i) => {
    if (isDead(s)) return;                       // a soldier who died inside stays hidden until units.js removes him
    const row = Math.floor(i / 4), col = (i % 4) - 1.5;
    let x = T.x + sh * (4.8 + row * 1.4) + ch * col * 1.4;
    let z = T.z + ch * (4.8 + row * 1.4) - sh * col * 1.4;
    const r = resolve(x, z, 0.45);
    x = r.x; z = r.z;
    place(s, x, groundHeight(x, z) + 0.15, z);
    s.heading = T.h;
    s.hold = { x, z, heading: T.h };             // 'hold' keeps them here, 'follow' walks them to their slots
    s.path = []; s.pi = 0; s.repathT = 0; s.moving = false;
    s.aim = null; s.fireT = 0.4;
    if (s.char && s.char.setPose) s.char.setPose(x, z, T.h);
    setShown(s, true);
  });
  cargo = [];
}





// gives the normal on-foot screen parts back after driving
function restoreView() {
  const ch = document.getElementById('crosshair');
  if (ch) ch.style.visibility = '';
  const gr = (C && C.camera) ? C.camera.getObjectByName('scope-rig') : null;
  if (gr) gr.visible = true;
}





function enter() {
  if (driving || !built || !C) return;
  const p = C.player;
  if (p.dead || !isPlay()) return;
  if (!unlocked()) { toast('Train your first soldier, then the truck is yours'); return; }
  try { if (window.campaignScope && window.campaignScope.isOn()) window.campaignScope.toggle(); } catch (e) { /* ignore */ }
  driving = true;
  boardSoldiers();
  startEngine();
  p.fly = false;
  p.yaw = T.h; p.pitch = 0;
  toast(PHONE ? 'Driving the army truck · ' + cargo.length + ' soldiers aboard'
              : 'ARMY TRUCK · ' + cargo.length + ' soldiers aboard · E to get out · V view');
}





function leave(force, silent) {
  if (!driving) return;
  if (!force && Math.abs(T.speed) > EXIT_SPEED) { toast('Slow down to get out'); return; }
  driving = false;
  T.speed = 0;
  unloadSoldiers();
  engineTick(false, 0, 0);
  restoreView();
  if (silent) return;
  const p = C.player, cam = C.camera;
  const rx = Math.cos(T.h), rz = -Math.sin(T.h);
  const spots = [[-2.6, 0], [2.6, 0], [-2.6, -2.5], [2.6, -2.5], [0, 5.5]];
  let sx = T.x, sz = T.z, found = false;
  for (const [lx, lz] of spots) {
    const fx = -Math.sin(T.h), fz = -Math.cos(T.h);
    const x = T.x + rx * lx + fx * (-lz), z = T.z + rz * lx + fz * (-lz);
    const r = resolve(x, z, 0.5);
    if (Math.hypot(r.x - x, r.z - z) < 0.05 && walkOK(x, z)) { sx = x; sz = z; found = true; break; }
  }
  if (!found) { sx = T.x + Math.sin(T.h) * 5.5; sz = T.z + Math.cos(T.h) * 5.5; }
  p.x = sx; p.z = sz;
  p.y = groundHeight(sx, sz) + 1.7;
  p.vx = p.vz = p.vy = 0; p.grounded = true;
  p.yaw = T.h; p.pitch = 0;
  cam.position.set(p.x, p.y, p.z);
  cam.rotation.set(p.pitch, p.yaw, 0);
  toast(PHONE ? 'Soldiers are out' : 'Out of the truck · E to get back in');
}





function toggleView() {
  view = view === 'fpp' ? 'tpp' : 'fpp';
  try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* ignore */ }
  toast(view === 'fpp' ? 'VIEW: DRIVER SEAT' : 'VIEW: BEHIND THE TRUCK');
}





// ============================================================
//  DRIVING
// ============================================================
function drive(dt, p, cam, playing) {
  let thr = 0;
  if (playing) {
    const kf = (isDown(down, 'forward') || down.ArrowUp) ? 1 : 0;
    const kb = (isDown(down, 'back') || down.ArrowDown) ? 1 : 0;
    const kl = (isDown(down, 'left') || down.ArrowLeft) ? 1 : 0;
    const kr = (isDown(down, 'right') || down.ArrowRight) ? 1 : 0;
    thr = clamp(kf - kb + tmy, -1, 1);
    const st = clamp(kl - kr - tmx, -1, 1);
    const brake = isDown(down, 'jump') || tjump;
    const boost = isDown(down, 'sprint') || tsprint;
    const before = T.speed;





    // speed
    const maxF = MAX_FWD * (boost ? BOOST : 1);
    let tgt = thr > 0 ? thr * maxF : thr < 0 ? thr * MAX_REV : 0, rate;
    if (brake) { tgt = 0; rate = HAND; }
    else if (Math.abs(thr) < 0.05) { tgt = 0; rate = COAST; }
    else if (tgt * T.speed < -0.1) rate = BRAKE;
    else rate = Math.abs(tgt) > Math.abs(T.speed) ? ACCEL : COAST * 1.5;
    T.speed += clamp(tgt - T.speed, -rate * dt, rate * dt);





    // steering (much less sharp when fast) and heading
    const maxSt = MAX_STEER * (1 - STEER_FAST * Math.min(1, Math.abs(T.speed) / MAX_FWD));
    const sr = Math.abs(st) > 0.02 ? STEER_IN : STEER_OUT;
    T.steer += clamp(st * maxSt - T.steer, -sr * dt, sr * dt);
    let dh = T.speed / WHEELBASE * Math.tan(T.steer) * dt;
    dh = clamp(dh, -MAX_YAW_RATE * dt, MAX_YAW_RATE * dt);
    // do not swing the truck's body into a wall or tree it was not touching
    if (Math.abs(dh) > 1e-5 && turnBlocked(T.x, T.z, T.h + dh) && !turnBlocked(T.x, T.z, T.h)) {
      dh = 0;
      T.speed *= 0.98;
    }
    T.h += dh;
    if (view === 'fpp') p.yaw += dh;                      // the cab view turns with the truck
    else if (Math.abs(T.speed) > 0.5) p.yaw += wrapA(T.h - p.yaw) * Math.min(1, dt * TPP_FOLLOW);   // chase camera swings behind





    // move, with water and collision checks
    const s = Math.sin(T.h), c = Math.cos(T.h), fx = -s, fz = -c;
    let nx = T.x + fx * T.speed * dt, nz = T.z + fz * T.speed * dt;
    if (!walkOK(nx, nz) || !walkOK(nx + fx * 3.4, nz + fz * 3.4) || !walkOK(nx - fx * 3.4, nz - fz * 3.4)) {
      nx = T.x; nz = T.z; T.speed *= 0.3;
    }
    let push = 0;
    for (let it = 0; it < 2; it++) {
      for (const o of CIRCLES) {
        const cx = nx + s * o, cz = nz + c * o;
        const r = resolve(cx, cz, CR);
        const ddx = r.x - cx, ddz = r.z - cz;
        nx += ddx; nz += ddz;
        push += Math.hypot(ddx, ddz);
      }
    }
    if (push > 1.2) { nx = T.x; nz = T.z; T.speed *= 0.2; }     // stuck in a corner: do not jump
    else if (push > 0.002) {
      T.speed *= Math.max(0.35, 1 - push * 5);
      if (Math.abs(before) > 6) shake = Math.min(1, Math.abs(before) / 14);
    }
    const half = WORLD.size / 2 - 5;
    T.x = clamp(nx, -half, half);
    T.z = clamp(nz, -half, half);





    // roadkill
    if (Math.abs(T.speed) > ROADKILL_SPEED && C.getEnemies) {
      const now = performance.now();
      for (const e of C.getEnemies()) {
        if (isDead(e)) continue;
        const q = posOf(e);
        if (!q) continue;
        const rx = q.x - T.x, rz = q.z - T.z;
        const fwd = rx * fx + rz * fz;
        const lat = rx * c + rz * -s;
        const front = T.speed > 0 ? fwd : -fwd;
        if (Math.abs(lat) < 1.7 && front > -1.5 && front < 4.0) {
          if (now - (hitAt.get(e) || 0) < 600) continue;
          hitAt.set(e, now);
          if (hurtEnemy(e, ROADKILL_DMG, { x: T.x, z: T.z })) roadkills++;
          T.speed *= 0.93;
        }
      }
    }
  }





  // follow the ground (calm: small tilt limits and slow follow)
  {
    const s = Math.sin(T.h), c = Math.cos(T.h), fx = -s, fz = -c;
    const hF = groundHeight(T.x + fx * 2.6, T.z + fz * 2.6);
    const hR = groundHeight(T.x - fx * 2.6, T.z - fz * 2.6);
    const hRt = groundHeight(T.x + c * 1.1, T.z - s * 1.1);
    const hL = groundHeight(T.x - c * 1.1, T.z + s * 1.1);
    const k = Math.min(1, dt * TILT_FOLLOW);
    T.pitch += (clamp(Math.atan2(hF - hR, 5.2), -MAX_PITCH, MAX_PITCH) - T.pitch) * k;
    T.roll += (clamp(Math.atan2(hRt - hL, 2.2), -MAX_ROLL, MAX_ROLL) - T.roll) * k;
    T.y += ((hF + hR) / 2 - T.y) * Math.min(1, dt * 14);
  }
  applyTransform();
  const rot = T.speed * dt / WHEEL_R;
  for (const sp of rig.spinners) sp.rotation.x -= rot;
  M.updateMatrixWorld(true);
  if (view === 'fpp') rig.poseArms();





  // the player goes where the truck goes
  p.x = T.x; p.z = T.z; p.y = T.y + 2.0;
  p.vx = p.vz = p.vy = 0; p.grounded = true; p.fly = false;





  // soldiers in the back: hidden, silent, and carried along
  for (let i = cargo.length - 1; i >= 0; i--) {
    const s = cargo[i];
    if (isDead(s)) { cargo.splice(i, 1); continue; }
    place(s, T.x, T.y + 1.2, T.z);
    holdRider(s);
    setShown(s, false);
  }





  placeCamera(dt, p, cam);





  // no gun while driving
  const gh = document.getElementById('gun-hud');
  if (gh) gh.style.display = 'none';
  const ch = document.getElementById('crosshair');
  if (ch) ch.style.visibility = 'hidden';
  const gr = cam.getObjectByName('scope-rig');
  if (gr) gr.visible = false;
  rig.setHands(view === 'fpp');





  engineTick(playing, Math.min(1, Math.abs(T.speed) / MAX_FWD), thr);
}





function placeCamera(dt, p, cam) {
  shake = Math.max(0, shake - dt * 2.5);
  bobT += dt * (6 + Math.abs(T.speed));
  if (view === 'fpp') {
    const rel = clamp(wrapA(p.yaw - T.h), -LOOK_YAW, LOOK_YAW);
    p.yaw = T.h + rel;
    p.pitch = clamp(p.pitch, -0.9, 0.7);
    const sf = Math.min(1, Math.abs(T.speed) / MAX_FWD);
    _v.copy(EYE_LOCAL);
    _v.y += Math.sin(bobT) * 0.006 * sf + (Math.random() - 0.5) * 0.05 * shake;
    _v.x += (Math.random() - 0.5) * 0.05 * shake;
    M.localToWorld(_v);
    cam.position.copy(_v);
    _q.setFromEuler(_e.set(p.pitch, rel, 0, 'YXZ'));
    cam.quaternion.copy(M.quaternion).multiply(_q);
  } else {
    p.pitch = clamp(p.pitch, -1.0, 0.25);
    const cp = Math.cos(p.pitch);
    const dx = -Math.sin(p.yaw) * cp, dy = Math.sin(p.pitch), dz = -Math.cos(p.yaw) * cp;
    const tx = T.x, ty = T.y + 2.4, tz = T.z;
    let cx = tx - dx * TPP_DIST, cy = ty - dy * TPP_DIST + 0.8, cz = tz - dz * TPP_DIST;
    cy = Math.max(cy, groundHeight(cx, cz) + 1.0);
    cam.position.set(cx + (Math.random() - 0.5) * 0.2 * shake, cy, cz);
    cam.lookAt(tx, ty, tz);
  }
}





function onFoot(dt, p, playing) {
  // a parked truck: keep it on the ground, and keep the walking player out of its body
  T.y += (groundHeight(T.x, T.z) - T.y) * Math.min(1, dt * 10);
  if (playing) pushPlayer(p);
}





function uiTick(dt, p, playing) {
  const dist = Math.hypot(p.x - T.x, p.z - T.z);
  const open = unlocked();
  const near = !driving && playing && !p.dead && dist < ENTER_R;
  if (near) {
    ui.prompt.textContent = !open ? 'TRAIN YOUR FIRST SOLDIER TO USE THE TRUCK'
      : (PHONE ? 'TAP TO DRIVE THE ARMY TRUCK' : 'PRESS E · DRIVE THE ARMY TRUCK');
    ui.prompt.style.display = 'block';
  } else ui.prompt.style.display = 'none';





  beacon.visible = !driving && playing && open && dist > 14;
  if (beacon.visible) {
    beacon.position.set(T.x, T.y + 20, T.z);
    beacon.material.opacity = 0.2 + 0.08 * Math.sin(performance.now() / 350);
  }





  // speed panel and phone buttons only while the game is really running (not on the pause card)
  ui.hud.style.display = (driving && playing) ? 'block' : 'none';
  ui.btns.style.display = (driving && playing && PHONE) ? 'flex' : 'none';
  hudT -= dt;
  if (driving && playing && hudT <= 0) {
    hudT = 0.1;
    const kmh = Math.round(Math.abs(T.speed) * 3.6);
    const html = '<div class="h">ARMY TRUCK</div><div class="b">' + kmh + ' km/h</div>' +
      '<div class="s">SOLDIERS ' + cargo.length + ' / ' + MAX_SOLDIERS + (roadkills ? ' · ROADKILLS ' + roadkills : '') + '</div>' +
      (PHONE ? '' : '<div class="k">W A S D drive · SPACE brake · SHIFT boost · V view · E get out</div>');
    if (html !== hudLast) { ui.hud.innerHTML = html; hudLast = html; }
  }
}





// ============================================================
//  INPUT
// ============================================================
window.addEventListener('keydown', (e) => { down[e.code] = true; });
window.addEventListener('keyup', (e) => { down[e.code] = false; });
window.addEventListener('blur', () => { for (const k in down) down[k] = false; });




// left mouse must not shoot while driving (capture phase: runs before player.js)
document.addEventListener('mousedown', (e) => {
  if (driving && e.button === 0) e.stopImmediatePropagation();
}, true);




// phone: read the joystick / brake / sprint values that touch.js sends to main.js
function wrapTouch() {
  const t = window.campaignTouch;
  if (wrapped || !t || typeof t.move !== 'function') return;
  wrapped = true;
  const m = t.move.bind(t), j = t.jump.bind(t), s = t.sprint.bind(t);
  t.move = (x, y) => { tmx = x; tmy = y; m(x, y); };
  t.jump = (on) => { tjump = !!on; j(on); };
  t.sprint = (on) => { tsprint = !!on; s(on); };
}





// ============================================================
//  EXTRAS INTERFACE
// ============================================================
export function init(ctx) {
  C = ctx;
  ensureUi();
  console.log('[vehicles] v4 ready: army truck (E to drive, V view, up to ' + MAX_SOLDIERS + ' soldiers) · solid body ' + (SOLID ? 'ON' : 'OFF'));
}




export function update(dt, ctx) {
  C = ctx;
  ensureUi();
  wrapTouch();
  if (!built) build(ctx);
  if (!built) return;
  const p = ctx.player, cam = ctx.camera;
  const playing = isPlay();
  if (driving && p.dead) leave(true);
  if (driving) drive(dt, p, cam, playing);
  else onFoot(dt, p, playing);
  if (playing) pushSoldiers();
  applyIdle();
  uiTick(dt, p, playing);
}
function applyIdle() {
  if (!driving && M) { applyTransform(); rig.setHands(false); }
}




export function onKey(code, ctx) {
  C = ctx || C;
  if (!built || !isPlay()) return false;
  if (isUse(code)) {
    if (driving) { leave(false); return true; }
    if (nearTruck(C.player)) { enter(); return true; }
    return false;
  }
  if (driving && code === 'KeyV') { toggleView(); return true; }
  return false;
}




export function onEvent(name, data, ctx) {
  C = ctx || C;
  if (name === 'died' && driving) leave(true);
}




export function reset(ctx) {
  C = ctx || C;
  if (!built) return;
  if (driving) leave(true, true);
  for (const s of cargo) setShown(s, true);
  cargo = [];
  roadkills = 0;
  hitAt.clear();
  goHome();
}





// ============================================================
//  DOORS AND CONSOLE
// ============================================================
window.campaignTruck = {
  isDriving: () => driving,
  state: () => ({ x: T.x, z: T.z, heading: T.h, speed: T.speed, cargo: cargo.length })
};




// vehicles({view:'tpp'|'fpp', fwd:22, accel:10, require:false, kill:250, here:true, solid:true})
window.vehicles = function (o) {
  if (o && typeof o === 'object') {
    if (o.view === 'fpp' || o.view === 'tpp') { view = o.view; try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* ignore */ } }
    if (typeof o.fwd === 'number') MAX_FWD = Math.max(6, o.fwd);
    if (typeof o.accel === 'number') ACCEL = Math.max(1, o.accel);
    if ('require' in o) REQUIRE_SOLDIER = !!o.require;
    if ('solid' in o) SOLID = !!o.solid;
    if (typeof o.kill === 'number') ROADKILL_DMG = o.kill;
    if (typeof o.kmh === 'number') ROADKILL_SPEED = o.kmh / 3.6;
    if (o.here && built && C && !driving) {            // put the truck 9 m in front of you (for testing)
      const p = C.player;
      T.x = p.x - Math.sin(p.yaw) * 9; T.z = p.z - Math.cos(p.yaw) * 9;
      T.h = p.yaw; T.speed = 0; T.y = groundHeight(T.x, T.z);
    }
  }
  console.log('[vehicles] view ' + view + ' · top speed ' + MAX_FWD + ' m/s · accel ' + ACCEL +
    ' · needs a soldier ' + REQUIRE_SOLDIER + ' · solid body ' + SOLID +
    ' · roadkill ' + ROADKILL_DMG + ' dmg above ' + Math.round(ROADKILL_SPEED * 3.6) + ' km/h' +
    ' · truck at X ' + Math.round(T.x) + ' Z ' + Math.round(T.z) + ' · roadkills ' + roadkills);
};