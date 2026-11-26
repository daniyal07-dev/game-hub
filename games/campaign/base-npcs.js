// ============================================================
// base-npcs.js  (v2)  ->  games/campaign/base-npcs.js
// The base crew of Strike Command: real SWAT soldiers who
//   - guard the gates (OUTSIDE the fence), stand at the Mess and Armory, and patrol
//   - shoot any Space Gang soldier they see, then walk back to their post
//   - are NOT part of the player's army (no cap, no orders)
// Walls and trees block their sight and movement (collision.js, pathfinding.js).
// Loaded by extras.js. Safe to delete (the game still runs).
//
// Enemies shoot back at the guards through EN.registerTargets(fn)
// (offered by enemies.js v2). A target needs: x, z, dead, hurt(amount).
//
// v2: gate guards stand OUTSIDE the gates (GATE_OUT, GATE_SIDE).
// ============================================================
import { BUILDINGS, GATES, FENCES } from './layout.js';
import { SPAWN } from './terrain.js';
import { findPath, walkableAt } from './pathfinding.js';
import { resolve as resolveCollision, lineClear, groundHeight } from './collision.js';
import { spawnCharacter, removeCharacter } from './characters.js';
import * as EN from './enemies.js';


// ---------- knobs ----------
const LIMIT = 12;                    // most crew members (lower it if the FPS drops)
const TEST_ENEMY_AT_GATE = false;    // true = one Space Gang soldier appears outside the main gate (test)
const GATE_OUT = 4;                  // gate guards stand this far OUTSIDE the gate (m)
const GATE_SIDE = 3.5;               // and this far to each side of the road (m)


const HP = 100;
const SIGHT = 45;                    // how far they see an enemy (m)
const SHOOT_RANGE = 42;
const ENGAGE = 22;                   // they walk closer until this near (m)
const LEASH = 40;                    // never chase further than this from the post (m)
const LOSE_TIME = 5;                 // seconds without a target before going back
const DAMAGE = 10;
const RATE = 0.35;                   // seconds between shots
const RATE_RAND = 0.15;
const REACT = 0.4;
const HIT_BASE = 0.8, HIT_FALL = 0.012, HIT_MIN = 0.2;
const AIM_TOL = 0.35;                // radians


const WALK = 1.8, RUN = 5.5, TURN = 8;
const BODY_R = 0.45, ARRIVE = 0.7, SEP_R = 0.9;
const SENSE_EVERY = 0.35;
const REPATH_EVERY = 0.8, GOAL_MOVED = 2.5, STUCK_TIME = 1.2;
const WAIT_MIN = 3, WAIT_MAX = 7;    // pause at each patrol stop (s)
const DEAD_KEEP = 20;                // seconds a body stays
const RESPAWN = 75;                  // seconds until a replacement arrives
const SHOW_DIST = 180;               // crew further than this from you is not drawn (FPS)


// ---------- state ----------
let ctx = null;
let npcs = [];
let pending = [];                    // [{def, t}] replacements waiting
let defs = [];
let spawned = false;
let testPos = null, testDone = false;
let pathBudget = 1;


const wrapTurn = (cur, want, maxStep) => {
  let d = want - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  d = Math.max(-maxStep, Math.min(maxStep, d));
  return cur + d;
};


export const getBaseGuards = () => npcs;


// ---------- helpers ----------
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


function findSpot(x, z) {
  for (const r of [0, 1.5, 3, 4.5, 6]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (walkableAt(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}


// a point in front of a building's door: out = metres from the wall, side = metres sideways
function doorPt(id, out, side) {
  const b = BUILDINGS.find(q => q.id === id);
  if (!b) return null;
  const fx = Math.sin(b.rot), fz = Math.cos(b.rot);      // front direction
  const px = Math.cos(b.rot), pz = -Math.sin(b.rot);     // sideways
  const o = b.d / 2 + out;
  return { x: b.x + fx * o + px * side, z: b.z + fz * o + pz * side, rot: b.rot, px, pz };
}


// ---------- the crew list ----------
function buildDefs() {
  const base = findBase();
  const cx = (base.x0 + base.x1) / 2, cz = (base.z0 + base.z1) / 2;
  const list = [];
  const gateIn = [];
  let firstGate = null;


  // gate guards: two per gate, OUTSIDE the fence, facing outward
  for (const g of GATES) {
    if (g.place !== 'base' && !String(g.id).startsWith('base-')) continue;
    let ix = cx - g.x, iz = cz - g.z;                    // direction from the gate into the base
    const l = Math.hypot(ix, iz) || 1; ix /= l; iz /= l;
    const px = -iz, pz = ix;                             // sideways (along the fence)
    for (const s of [-1, 1]) {
      list.push({ role: 'gate',
                  x: g.x - ix * GATE_OUT + px * GATE_SIDE * s,
                  z: g.z - iz * GATE_OUT + pz * GATE_SIDE * s,
                  h: Math.atan2(-ix, -iz) });            // facing away from the base
    }
    gateIn.push({ x: g.x + ix * 6, z: g.z + iz * 6 });
    if (!firstGate) firstGate = { g, ix, iz };
  }


  // two chatting at the Mess (facing each other)
  const mess = doorPt('base-mess', 2.5, 0);
  if (mess) {
    list.push({ role: 'post', x: mess.x + mess.px * 0.9, z: mess.z + mess.pz * 0.9, h: Math.atan2(-mess.px, -mess.pz) });
    list.push({ role: 'post', x: mess.x - mess.px * 0.9, z: mess.z - mess.pz * 0.9, h: Math.atan2(mess.px, mess.pz) });
  }


  // two at the Armory door
  for (const s of [-1, 1]) {
    const a = doorPt('base-armory', 2.5, 2.2 * s);
    if (a) list.push({ role: 'post', x: a.x, z: a.z, h: a.rot });
  }


  // patrols between building doors
  const routes = [
    ['base-hq', 'base-armory', 'base-garage'],
    ['base-barracks-a', 'base-mess', 'base-hq'],
    ['base-barracks-b', 'base-garage', 'base-barracks-a']
  ];
  routes.forEach((r, k) => {
    const wps = r.map(id => doorPt(id, 4, 0)).filter(Boolean).map(p => findSpot(p.x, p.z));
    if (wps.length >= 2) list.push({ role: 'patrol', x: wps[0].x, z: wps[0].z, h: 0, wps, start: k % wps.length });
  });


  // one patrol between the two gates (inside the fence)
  if (gateIn.length >= 2) {
    const wps = gateIn.map(p => findSpot(p.x, p.z));
    list.push({ role: 'patrol', x: wps[0].x, z: wps[0].z, h: 0, wps, start: 0 });
  }


  // where the test enemy appears (further outside the first gate, behind the guards)
  if (firstGate) {
    testPos = { x: firstGate.g.x - firstGate.ix * 22, z: firstGate.g.z - firstGate.iz * 22,
                h: Math.atan2(firstGate.ix, firstGate.iz) };
  }
  return list.slice(0, LIMIT);
}


// ---------- spawning ----------
function spawnNpc(def) {
  const ch = spawnCharacter('team', ctx.scene);
  if (!ch) return null;
  const spot = findSpot(def.x, def.z);
  const f = resolveCollision(spot.x, spot.z, BODY_R);
  const n = {
    def, char: ch, x: f.x, z: f.z, heading: def.h,
    homeX: f.x, homeZ: f.z, homeH: def.h,
    wps: def.wps || null, wi: def.start || 0, wait: Math.random() * 3,
    state: def.role === 'patrol' ? 'patrol' : 'idle',
    hp: HP, dead: false, deadT: 0,
    aim: null, seen: false, lostT: 0, lastX: f.x, lastZ: f.z,
    senseT: Math.random() * SENSE_EVERY, fireT: 0,
    path: [], pi: 0, goalX: Infinity, goalZ: Infinity, repathT: 0, stuckT: 0,
    moving: false, runNow: false,
    lookT: 2 + Math.random() * 3, lookH: def.h,
    hurt: null
  };
  n.hurt = (amount) => hurtNpc(n, amount);
  ch.setPose(n.x, n.z, n.heading);
  npcs.push(n);
  return n;
}


function removeAll() {
  for (const n of npcs) removeCharacter(n.char, ctx ? ctx.scene : null);
  npcs = [];
  pending = [];
}


function hurtNpc(n, amount) {
  if (!n || n.dead) return;
  n.hp -= amount;
  if (n.hp <= 0) {
    n.hp = 0; n.dead = true; n.deadT = 0; n.moving = false; n.aim = null;
    n.char.die();
  } else {
    n.char.hit();
    n.senseT = 0;                       // look for the shooter at once
  }
}


// ---------- seeing and shooting ----------
function findEnemy(n) {
  const near = [];
  for (const e of EN.getEnemies()) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - n.x, e.z - n.z);
    if (d <= SIGHT) near.push({ e, d });
  }
  if (!near.length) return null;
  near.sort((a, b) => a.d - b.d);
  for (let i = 0; i < Math.min(3, near.length); i++) {
    if (lineClear(n.x, n.z, near[i].e.x, near[i].e.z)) return near[i].e;
  }
  return null;
}


function shoot(n, e) {
  if (!lineClear(n.x, n.z, e.x, e.z)) { n.seen = false; return; }
  n.char.fire();
  const dist = Math.hypot(e.x - n.x, e.z - n.z);
  const hit = Math.random() < Math.max(HIT_MIN, HIT_BASE - dist * HIT_FALL);
  const sx = n.x + Math.sin(n.heading) * 0.6, sz = n.z + Math.cos(n.heading) * 0.6;
  const sy = groundHeight(n.x, n.z) + 1.35;
  let tx = e.x, tz = e.z;
  if (!hit) {
    const side = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 1.0);
    tx += -Math.cos(n.heading) * side; tz += Math.sin(n.heading) * side;
  }
  EN.addTracer(sx, sy, sz, tx, groundHeight(e.x, e.z) + 1.2, tz);
  if (hit) EN.hurtEnemy(e, DAMAGE, { x: n.x, z: n.z });
}


// ---------- walking ----------
// walk towards (tx, tz); returns true when there (or when no route exists)
function goTo(n, tx, tz, dt, run) {
  const dist = Math.hypot(tx - n.x, tz - n.z);
  if (dist < ARRIVE) { n.moving = false; n.path = []; return true; }


  n.repathT -= dt;
  const exhausted = n.pi >= n.path.length;
  const goalMoved = Math.hypot(tx - n.goalX, tz - n.goalZ) > GOAL_MOVED;
  if (n.repathT <= 0 && pathBudget > 0 && (exhausted || goalMoved || n.stuckT > STUCK_TIME)) {
    pathBudget--;
    n.path = findPath(n.x, n.z, tx, tz) || [];
    n.pi = 0; n.goalX = tx; n.goalZ = tz; n.stuckT = 0;
    n.repathT = REPATH_EVERY + Math.random() * 0.3;
    if (!n.path.length) { n.moving = false; n.repathT = 2; return true; }
  }


  let wp = n.path[n.pi];
  while (wp && Math.hypot(wp.x - n.x, wp.z - n.z) < 0.4) { n.pi++; wp = n.path[n.pi]; }
  if (!wp) { n.moving = false; return false; }


  n.moving = true;
  n.runNow = run;
  const speed = run ? RUN : WALK;
  const dx = wp.x - n.x, dz = wp.z - n.z;
  const d = Math.hypot(dx, dz) || 1;
  const step = Math.min(speed * dt, d);
  const ox = n.x, oz = n.z;
  const f = resolveCollision(n.x + dx / d * step, n.z + dz / d * step, BODY_R);
  n.x = f.x; n.z = f.z;
  const progress = Math.hypot(n.x - ox, n.z - oz);
  if (progress < step * 0.25) n.stuckT += dt;
  else n.stuckT = Math.max(0, n.stuckT - dt);
  n.heading = wrapTurn(n.heading, Math.atan2(dx, dz), TURN * dt);
  return false;
}


// ---------- thinking ----------
function think(n, dt) {
  // 1) look for enemies now and then
  n.senseT -= dt;
  if (n.senseT <= 0) {
    n.senseT = SENSE_EVERY + Math.random() * 0.1;
    const e = findEnemy(n);
    if (e) {
      n.aim = e; n.seen = true; n.lastX = e.x; n.lastZ = e.z; n.lostT = 0;
      if (n.state !== 'fight') { n.state = 'fight'; n.fireT = REACT + Math.random() * 0.3; }
    } else {
      n.seen = false;
    }
  }


  // 2) act
  const away = Math.hypot(n.x - n.homeX, n.z - n.homeZ);


  if (n.state === 'fight') {
    const e = n.aim;
    if (n.seen && e && !e.dead) {
      n.lastX = e.x; n.lastZ = e.z;
      const dist = Math.hypot(e.x - n.x, e.z - n.z);
      if (dist > ENGAGE && away < LEASH) goTo(n, e.x, e.z, dt, true);
      else n.moving = false;


      const want = Math.atan2(e.x - n.x, e.z - n.z);
      if (!n.moving) n.heading = wrapTurn(n.heading, want, TURN * dt);
      n.fireT -= dt;
      if (n.fireT <= 0 && dist <= SHOOT_RANGE) {
        const err = Math.abs(Math.atan2(Math.sin(want - n.heading), Math.cos(want - n.heading)));
        if (err < AIM_TOL) {
          shoot(n, e);
          n.fireT = RATE + Math.random() * RATE_RAND;
        }
      }
    } else {
      n.lostT += dt;
      const there = away < LEASH ? goTo(n, n.lastX, n.lastZ, dt, true) : true;
      if (there || n.lostT > LOSE_TIME) { n.state = 'return'; n.moving = false; n.aim = null; }
    }
  } else if (n.state === 'return') {
    const tx = n.wps ? n.wps[n.wi].x : n.homeX;
    const tz = n.wps ? n.wps[n.wi].z : n.homeZ;
    if (goTo(n, tx, tz, dt, false)) {
      n.moving = false;
      n.state = n.wps ? 'patrol' : 'idle';
      n.wait = 0;
    }
  } else if (n.state === 'patrol') {
    if (n.wait > 0) {
      n.wait -= dt; n.moving = false;
    } else {
      const w = n.wps[n.wi];
      if (goTo(n, w.x, w.z, dt, false)) {
        n.moving = false;
        n.wait = WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN);
        n.wi = (n.wi + 1) % n.wps.length;
      }
    }
  } else {                                // idle at the post: glance around a little
    n.moving = false;
    n.lookT -= dt;
    if (n.lookT <= 0) { n.lookT = 3 + Math.random() * 4; n.lookH = n.homeH + (Math.random() - 0.5) * 1.0; }
    n.heading = wrapTurn(n.heading, n.lookH, TURN * 0.25 * dt);
  }
}


function separate() {
  for (let i = 0; i < npcs.length; i++) {
    const a = npcs[i];
    if (a.dead) continue;
    for (let j = i + 1; j < npcs.length; j++) {
      const b = npcs[j];
      if (b.dead) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < SEP_R) {
        const push = (SEP_R - d) / 2;
        const ux = d > 0.001 ? dx / d : 1, uz = d > 0.001 ? dz / d : 0;
        a.x -= ux * push; a.z -= uz * push;
        b.x += ux * push; b.z += uz * push;
      }
    }
  }
  for (const n of npcs) {
    if (n.dead) continue;
    const f = resolveCollision(n.x, n.z, BODY_R);
    n.x = f.x; n.z = f.z;
  }
}


// ============================================================
// extras.js hooks
// ============================================================
export function init(c) {
  ctx = c;
  console.log('[base-npcs] ready (crew spawns when the characters are loaded)');
}


export function update(dt, c) {
  if (!c.isReady()) return;
  dt = Math.min(dt, 0.1);


  if (!spawned) {
    spawned = true;
    defs = buildDefs();
    let made = 0;
    for (const d of defs) if (spawnNpc(d)) made++;
    if (typeof EN.registerTargets === 'function') EN.registerTargets(() => npcs);
    console.log('[base-npcs] base crew: ' + made + ' soldiers');
  }


  if (TEST_ENEMY_AT_GATE && !testDone && testPos && EN.getEnemies().length > 0) {
    testDone = true;
    EN.spawnEnemy(testPos.x, testPos.z, testPos.h);
    console.log('[base-npcs] TEST: one enemy placed outside the main gate');
  }


  pathBudget = 1;


  // replacements
  for (let i = pending.length - 1; i >= 0; i--) {
    pending[i].t -= dt;
    if (pending[i].t <= 0) { spawnNpc(pending[i].def); pending.splice(i, 1); }
  }


  for (let i = npcs.length - 1; i >= 0; i--) {
    const n = npcs[i];
    if (n.dead) {
      n.deadT += dt;
      if (n.deadT > DEAD_KEEP) {
        removeCharacter(n.char, c.scene);
        pending.push({ def: n.def, t: RESPAWN });
        npcs.splice(i, 1);
      }
      continue;
    }
    think(n, dt);
  }


  separate();


  const p = c.player;
  for (const n of npcs) {
    n.char.setPose(n.x, n.z, n.heading);
    n.char.group.visible = Math.hypot(p.x - n.x, p.z - n.z) < SHOW_DIST;
    if (!n.dead) n.char.play(n.moving ? (n.runNow ? 'run' : 'walk') : 'idle');
  }
}


export function reset() {
  removeAll();
  spawned = false;
  testDone = false;
}