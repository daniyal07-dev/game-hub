// games/campaign/enemies.js   (v2: difficulty pass)
// Campaign Mode: the Space Gang (enemy soldiers) in Port Town.
//  - 10 guards stand at the checkpoints, the square and the Town Hall.
//    The 2 guards in front of the Town Hall are ELITE (more health, better aim).
//  - A guard sees in front of him up to SIGHT metres and hears you within HEAR metres.
//    Once alerted he sees all around. Walls, fences, trunks and rocks block sight (lineClear),
//    and a shot is only fired when the line is clear at that moment.
//  - States: guard -> fight (chase and shoot) -> search (go to last seen spot) -> return home.
//  - When one enemy spots a target, guards nearby are called to that spot (SHOUT).
//  - Hit chance drops with distance, so you can survive. Shots show as short tracer lines.
//  - Enemies walk with pathfinding.js and are kept out of walls by collision.js.
//  - Targets: the player, the trained soldiers, and anything given to registerTargets()
//    (the base guards). A target needs  x, z, dead, hurt(amount).
//
//  v2: DIFFICULTY. Change LEVEL below ('easy' | 'normal' | 'hard'),
//      or in the Console:  setDifficulty('hard')
//
// API:
//   initEnemies(scene, hooks)       hooks = { isReady, soldiers, hurtSoldier, hurtPlayer, equip }
//   updateEnemies(dt, player)       every frame (player = {x, z, dead})
//   hurtEnemy(e, amount, from?)     damage an enemy; returns true if he died. from = {x, z} (attacker)
//   getEnemies()  enemiesAlive()  killCount()  enemiesInfo()
//   spawnEnemy(x, z, heading, opts) one more enemy (opts = { elite: true }) (boat reinforcements later)
//   addTracer(x1,y1,z1, x2,y2,z2)   short bullet line (also used by soldiers and the player)
//   registerTargets(fn)             fn() returns extra things the enemies can shoot (base guards)
//   setDifficulty(name)  difficultyName()
//   resetEnemies(scene)             remove all, then respawn the town guards




import * as THREE from 'three';
import { findPath, walkableAt } from './pathfinding.js';
import { resolve as resolveCollision, lineClear, groundHeight } from './collision.js';
import { spawnCharacter, removeCharacter } from './characters.js';




/* ---------- DIFFICULTY ---------- */
const LEVEL = 'normal';       // 'easy' (the old values) | 'normal' | 'hard'

const PRESETS = {
  //          health  damage  sight  range  engage  hear  fov   rate  rand  react  hit   fall   min   alert  run   shout  elite
  easy:   { hp: 60,  damage: 8,  sight: 40, range: 30, engage: 20, hear: 10, fovCos: 0.26, rate: 1.10, rand: 0.40,
            react: 0.70, hitBase: 0.70, hitFall: 0.014, hitMin: 0.15, alert: 28, run: 5.2, shout: 0,  eliteHp: 90,  eliteAim: 0.05 },
  normal: { hp: 100, damage: 10, sight: 50, range: 38, engage: 18, hear: 13, fovCos: 0.15, rate: 0.85, rand: 0.30,
            react: 0.50, hitBase: 0.78, hitFall: 0.010, hitMin: 0.20, alert: 40, run: 5.6, shout: 30, eliteHp: 150, eliteAim: 0.08 },
  hard:   { hp: 140, damage: 12, sight: 60, range: 45, engage: 16, hear: 16, fovCos: 0.00, rate: 0.65, rand: 0.25,
            react: 0.35, hitBase: 0.85, hitFall: 0.008, hitMin: 0.25, alert: 55, run: 6.0, shout: 45, eliteHp: 200, eliteAim: 0.10 }
};
const D = Object.assign({}, PRESETS[LEVEL] || PRESETS.normal);
let levelName = PRESETS[LEVEL] ? LEVEL : 'normal';




/* ---------- Knobs (the same for every level) ---------- */
const AIM_TOL = 0.35;         // radians: must face the target this well to fire
const SENSE_EVERY = 0.35;     // seconds between sight checks per enemy (keeps the FPS up)
const WALK_SPEED = 2.0;
const TURN_RATE = 8;          // rad/s
const BODY_R = 0.45;
const ARRIVE = 0.7;
const REPATH_EVERY = 0.8;
const GOAL_MOVED = 2.5;
const STUCK_TIME = 1.2;
const SEP_R = 0.9;
const SEARCH_TIME = 8;        // seconds they look around the last seen spot
const LEASH = 90;             // they give up the chase this far from their post (m)
const DEAD_KEEP = 25;         // seconds a body stays before it is removed
const SHOW_DIST = 220;        // enemies further than this from you are not drawn (FPS)
const MAX_ENEMIES = 30;       // living enemies at once


// Town guards: x, z, heading (0 = facing south +Z, PI/2 = east, PI = north, -PI/2 = west)
const H = Math.PI;
const TOWN_GUARDS = [
  // West Checkpoint (inside the barriers, facing the road from the west)
  { x: 94, z: 77, h: -H / 2 }, { x: 94, z: 84, h: -H / 2 },
  // Town square
  { x: 114, z: 78, h: 0 }, { x: 126, z: 83, h: H },
  // In front of the Town Hall (elite)
  { x: 116, z: 70, h: 0, elite: true }, { x: 124, z: 70, h: 0, elite: true },
  // South Checkpoint (facing south)
  { x: 116, z: 108, h: 0 }, { x: 123, z: 105, h: 0 },
  // East Barricade (facing east)
  { x: 152, z: 77, h: H / 2 }, { x: 152, z: 84, h: H / 2 }
];




/* ---------- State ---------- */
const enemies = [];
let scene = null;
let hooks = { isReady: () => false, soldiers: () => [], hurtSoldier: () => {}, hurtPlayer: () => {}, equip: null };
let extraTargets = null;      // set by registerTargets (the base guards)
let spawned = false;
let kills = 0;
let pathBudget = 1;


export const getEnemies = () => enemies;
export const enemiesAlive = () => enemies.filter((e) => !e.dead).length;
export const killCount = () => kills;
export const difficultyName = () => levelName;


export function registerTargets(fn) {
  extraTargets = (typeof fn === 'function') ? fn : null;
}


const maxHpFor = (elite) => (elite ? D.eliteHp : D.hp);


// Change the level while playing. Living enemies keep the same share of health.
export function setDifficulty(name) {
  if (!PRESETS[name]) { console.log("setDifficulty: use 'easy', 'normal' or 'hard'"); return; }
  Object.assign(D, PRESETS[name]);
  levelName = name;
  for (const e of enemies) {
    if (e.dead) continue;
    const share = e.hp / e.maxHp;
    e.maxHp = maxHpFor(e.elite);
    e.hp = Math.max(1, Math.round(e.maxHp * share));
  }
  console.log('[enemies] difficulty is now ' + name);
}
window.setDifficulty = setDifficulty;




const wrapTurn = (cur, want, maxStep) => {
  let d = want - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  d = Math.max(-maxStep, Math.min(maxStep, d));
  return cur + d;
};




/* ---------- Tracers (bullet lines) ---------- */
const TR_N = 16;
const tracers = [];
let trI = 0;


function buildTracers() {
  for (let i = 0; i < TR_N; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const m = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
    const l = new THREE.Line(g, m);
    l.visible = false;
    l.frustumCulled = false;
    scene.add(l);
    tracers.push({ l, t: 0 });
  }
}


export function addTracer(x1, y1, z1, x2, y2, z2) {
  if (!tracers.length) return;
  const tr = tracers[trI++ % TR_N];
  const p = tr.l.geometry.attributes.position;
  p.setXYZ(0, x1, y1, z1);
  p.setXYZ(1, x2, y2, z2);
  p.needsUpdate = true;
  tr.l.visible = true;
  tr.t = 0.09;
}


function updateTracers(dt) {
  for (const tr of tracers) {
    if (tr.t > 0) { tr.t -= dt; if (tr.t <= 0) tr.l.visible = false; }
  }
}




/* ---------- Setup and spawning ---------- */
export function initEnemies(sceneRef, h) {
  scene = sceneRef;
  hooks = Object.assign(hooks, h || {});
  buildTracers();
  console.log('[enemies] ready: ' + TOWN_GUARDS.length + ' Space Gang guards will appear in Port Town. Difficulty: ' +
              levelName + ". Change it in the Console with setDifficulty('hard')");
}


function findSpot(x, z) {
  for (const r of [0, 1.5, 3, 4.5]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (walkableAt(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}


export function spawnEnemy(x, z, heading = 0, opts) {
  if (!scene || enemiesAlive() >= MAX_ENEMIES) return null;
  const spot = findSpot(x, z);
  if (!spot) { console.warn(`[enemies] no free ground near ${Math.round(x)}, ${Math.round(z)}`); return null; }
  const f = resolveCollision(spot.x, spot.z, BODY_R);
  const ch = spawnCharacter('enemy', scene);
  if (!ch) return null;
  if (hooks.equip) hooks.equip(ch);
  const elite = !!(opts && opts.elite);
  const hp = maxHpFor(elite);
  const e = {
    char: ch, x: f.x, z: f.z, heading,
    homeX: f.x, homeZ: f.z, homeH: heading,
    elite, hp, maxHp: hp, dead: false, deadT: 0,
    state: 'guard', target: null, isPlayerTarget: false, seen: false,
    lastX: 0, lastZ: 0, searchT: 0,
    senseT: Math.random() * SENSE_EVERY, fireT: 0,
    path: [], pi: 0, goalX: Infinity, goalZ: Infinity, repathT: 0, stuckT: 0,
    moving: false, runNow: false,
    lookT: 2 + Math.random() * 3, lookH: heading
  };
  ch.setPose(e.x, e.z, e.heading);
  enemies.push(e);
  return e;
}


function spawnTown() {
  let n = 0;
  for (const g of TOWN_GUARDS) if (spawnEnemy(g.x, g.z, g.h, { elite: !!g.elite })) n++;
  console.log('[enemies] Space Gang guards in town: ' + n);
}


export function resetEnemies(sceneRef) {
  for (const e of enemies) removeCharacter(e.char, sceneRef || scene);
  enemies.length = 0;
  kills = 0;
  spawned = false;
}




/* ---------- Damage ---------- */
export function hurtEnemy(e, amount, from) {
  if (!e || e.dead) return false;
  e.hp -= amount;
  if (e.hp <= 0) {
    e.hp = 0; e.dead = true; e.moving = false; e.deadT = 0;
    e.char.die();
    kills++;
    return true;
  }
  e.char.hit();
  wake(e, from);
  for (const o of enemies) {                          // friends nearby wake up
    if (o === e || o.dead || o.state !== 'guard') continue;
    if (Math.hypot(o.x - e.x, o.z - e.z) < D.alert) wake(o, from);
  }
  return false;
}


function wake(e, from) {
  if (e.state === 'fight') return;
  e.state = 'search';
  e.searchT = 0;
  if (from) { e.lastX = from.x; e.lastZ = from.z; }
  else { e.lastX = e.x; e.lastZ = e.z; }
}


// One enemy spotted something: guards nearby run to that spot
function shout(e, t) {
  if (D.shout <= 0) return;
  for (const o of enemies) {
    if (o === e || o.dead || o.state !== 'guard') continue;
    if (Math.hypot(o.x - e.x, o.z - e.z) < D.shout) wake(o, { x: t.x, z: t.z });
  }
}




/* ---------- Sight ---------- */
function sense(e, player) {
  const cands = [];
  if (player && !player.dead) cands.push({ t: player, p: true, d: Math.hypot(player.x - e.x, player.z - e.z) });
  for (const s of hooks.soldiers()) {
    if (s.dead) continue;
    cands.push({ t: s, p: false, d: Math.hypot(s.x - e.x, s.z - e.z) });
  }
  if (extraTargets) {                                   // the base guards
    const extra = extraTargets() || [];
    for (const s of extra) {
      if (s.dead) continue;
      cands.push({ t: s, p: false, d: Math.hypot(s.x - e.x, s.z - e.z) });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) {
    if (c.d > D.sight) break;
    if (e.state === 'guard' && c.d > D.hear) {         // a guard only sees in front of him
      const dx = (c.t.x - e.x) / c.d, dz = (c.t.z - e.z) / c.d;
      if (Math.sin(e.heading) * dx + Math.cos(e.heading) * dz < D.fovCos) continue;
    }
    if (lineClear(e.x, e.z, c.t.x, c.t.z)) return c;
  }
  return null;
}




/* ---------- Movement ---------- */
// Walk towards (tx, tz) along a path. Returns true when there (or when no route exists).
function goTo(e, tx, tz, dt, run) {
  const dist = Math.hypot(tx - e.x, tz - e.z);
  if (dist < ARRIVE) { e.moving = false; e.path = []; return true; }


  e.repathT -= dt;
  const exhausted = e.pi >= e.path.length;
  const goalMoved = Math.hypot(tx - e.goalX, tz - e.goalZ) > GOAL_MOVED;
  if (e.repathT <= 0 && pathBudget > 0 && (exhausted || goalMoved || e.stuckT > STUCK_TIME)) {
    pathBudget--;
    e.path = findPath(e.x, e.z, tx, tz);
    e.pi = 0; e.goalX = tx; e.goalZ = tz; e.stuckT = 0;
    e.repathT = REPATH_EVERY + Math.random() * 0.3;
    if (!e.path.length) { e.moving = false; e.repathT = 2; return true; }
  }


  let wp = e.path[e.pi];
  while (wp && Math.hypot(wp.x - e.x, wp.z - e.z) < 0.4) { e.pi++; wp = e.path[e.pi]; }
  if (!wp) { e.moving = false; return false; }


  e.moving = true;
  e.runNow = run;
  const speed = run ? D.run : WALK_SPEED;
  const dx = wp.x - e.x, dz = wp.z - e.z;
  const d = Math.hypot(dx, dz) || 1;
  const step = Math.min(speed * dt, d);
  const ox = e.x, oz = e.z;
  const f = resolveCollision(e.x + dx / d * step, e.z + dz / d * step, BODY_R);
  e.x = f.x; e.z = f.z;
  const progress = Math.hypot(e.x - ox, e.z - oz);
  if (progress < step * 0.25) e.stuckT += dt;
  else e.stuckT = Math.max(0, e.stuckT - dt);
  e.heading = wrapTurn(e.heading, Math.atan2(dx, dz), TURN_RATE * dt);
  return false;
}




/* ---------- Shooting ---------- */
function shoot(e, tgt, isPlayer) {
  // the line must be clear right now (never shoot through a wall)
  if (!lineClear(e.x, e.z, tgt.x, tgt.z)) { e.seen = false; return; }
  e.char.fire();
  const dist = Math.hypot(tgt.x - e.x, tgt.z - e.z);
  const chance = Math.max(D.hitMin, D.hitBase - dist * D.hitFall) + (e.elite ? D.eliteAim : 0);
  const hit = Math.random() < chance;


  const sx = e.x + Math.sin(e.heading) * 0.6, sz = e.z + Math.cos(e.heading) * 0.6;
  const sy = groundHeight(e.x, e.z) + 1.35;
  let tx = tgt.x, tz = tgt.z;
  if (!hit) {                                          // a miss flies past
    const side = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 1.2);
    tx += -Math.cos(e.heading) * side; tz += Math.sin(e.heading) * side;
  }
  const ty = groundHeight(tgt.x, tgt.z) + (isPlayer ? 1.3 : 1.2);
  addTracer(sx, sy, sz, tx, ty, tz);


  if (hit) {
    if (isPlayer) hooks.hurtPlayer(D.damage, e.x, e.z);
    else if (typeof tgt.hurt === 'function') tgt.hurt(D.damage);   // a base guard
    else hooks.hurtSoldier(tgt, D.damage);                          // a trained soldier
  }
}




/* ---------- Thinking ---------- */
function think(e, dt, player) {
  // 1) look around (staggered, never every frame)
  e.senseT -= dt;
  if (e.senseT <= 0) {
    e.senseT = SENSE_EVERY + Math.random() * 0.1;
    const c = sense(e, player);
    if (c) {
      e.target = c.t; e.isPlayerTarget = c.p; e.seen = true;
      e.lastX = c.t.x; e.lastZ = c.t.z;
      if (e.state !== 'fight') {
        e.state = 'fight';
        e.fireT = D.react + Math.random() * 0.4;
        shout(e, c.t);
      }
    } else {
      e.seen = false;
    }
  }


  // 2) act
  if (e.state === 'fight') {
    const tgt = e.target;
    if (!tgt || (tgt.dead) || (e.isPlayerTarget && player && player.dead)) e.seen = false;


    if (e.seen) {
      e.lastX = tgt.x; e.lastZ = tgt.z;
      const dist = Math.hypot(tgt.x - e.x, tgt.z - e.z);
      const away = Math.hypot(e.x - e.homeX, e.z - e.homeZ);
      if (away > LEASH) { e.state = 'return'; return; }
      if (dist > D.engage) goTo(e, tgt.x, tgt.z, dt, true);
      else e.moving = false;


      const want = Math.atan2(tgt.x - e.x, tgt.z - e.z);
      if (!e.moving) e.heading = wrapTurn(e.heading, want, TURN_RATE * dt);
      e.fireT -= dt;
      if (e.fireT <= 0 && dist <= D.range) {
        const err = Math.abs(Math.atan2(Math.sin(want - e.heading), Math.cos(want - e.heading)));
        if (err < AIM_TOL) {
          shoot(e, tgt, e.isPlayerTarget);
          e.fireT = D.rate + Math.random() * D.rand;
        }
      }
    } else {
      e.state = 'search'; e.searchT = 0;
    }
  } else if (e.state === 'search') {
    e.searchT += dt;
    const there = goTo(e, e.lastX, e.lastZ, dt, true);
    if (there || e.searchT > SEARCH_TIME) { e.state = 'return'; e.moving = false; }
  } else if (e.state === 'return') {
    const home = goTo(e, e.homeX, e.homeZ, dt, false);
    if (home) { e.state = 'guard'; e.moving = false; e.lookH = e.homeH; }
  } else {                                             // guard: stand and look around slowly
    e.moving = false;
    e.lookT -= dt;
    if (e.lookT <= 0) { e.lookT = 3 + Math.random() * 4; e.lookH = e.homeH + (Math.random() - 0.5) * 1.6; }
    e.heading = wrapTurn(e.heading, e.lookH, TURN_RATE * 0.25 * dt);
  }
}




/* ---------- Per-frame update ---------- */
export function updateEnemies(dt, player) {
  if (!scene) return;
  if (!spawned && hooks.isReady()) { spawned = true; spawnTown(); }
  updateTracers(dt);
  if (!enemies.length) return;
  pathBudget = 1;


  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dead) {
      e.deadT += dt;
      if (e.deadT > DEAD_KEEP) { removeCharacter(e.char, scene); enemies.splice(i, 1); }
      continue;
    }
    think(e, dt, player);
  }


  // keep enemies from standing inside each other
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    if (a.dead) continue;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
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


  for (const e of enemies) {
    if (!e.dead) {
      const f = resolveCollision(e.x, e.z, BODY_R);
      e.x = f.x; e.z = f.z;
    }
    e.char.setPose(e.x, e.z, e.heading);
    e.char.group.visible = !player || Math.hypot(player.x - e.x, player.z - e.z) < SHOW_DIST;
    if (!e.dead) e.char.play(e.moving ? (e.runNow ? 'run' : 'walk') : 'idle');
  }
}




export function enemiesInfo() {
  const alive = enemies.filter((e) => !e.dead);
  const st = {};
  for (const e of alive) st[e.state] = (st[e.state] || 0) + 1;
  return `${alive.length} alive, killed ${kills}, level ${levelName}, states ${JSON.stringify(st)}`;
}