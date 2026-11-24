// games/campaign/units.js
// Campaign Mode: the soldier brain (team soldiers for now).
// Orders: 'follow' (formation behind the player), 'hold' (stay put), 'go' (walk to a point).
// Soldiers walk with pathfinding.js, are kept out of walls by collision.js, and
// are drawn by characters.js (SWAT model, walk / run / idle clips).
//
// API:
//   spawnSquad(scene, x, z, yaw, n=4)      -> how many soldiers were created
//   addSoldier(scene, x, z, heading, weapon) -> one new soldier (training), or null if at the cap
//   aliveCount()  canAddSoldier()  MAX_UNITS
//   WEAPON_STATS                           stats for pistol / rifle / shotgun (cost, time, damage...)
//   updateUnits(dt, player)                call once per frame (player = {x, z, yaw})
//   setOrder('follow'|'hold'|'go', x?, z?)
//   getOrder()  getSoldiers()  unitsInfo()
//   hurtSoldier(soldier, amount)           damage: hit reaction, or death at 0 hp
//   clearUnits(scene)



import { findPath, walkableAt, pathInfo } from './pathfinding.js';
import { resolve as resolveCollision } from './collision.js';
import { spawnCharacter, removeCharacter } from './characters.js';



/* ---------- Knobs ---------- */
export const MAX_UNITS = 12; // soldier cap (alive soldiers)
const WALK_SPEED = 2.4;      // m/s when close to the target
const RUN_SPEED = 6.2;       // m/s when far from the target
const RUN_DIST = 6;          // run if farther than this from the target (m)
const CATCHUP = 1.5;         // speed multiplier when the player is far away
const CATCHUP_DIST = 18;     // m
const TELEPORT_DIST = 70;    // soldiers further than this from the player jump to him (m)
const BODY_R = 0.45;         // collision radius (m)
const START_MOVE = 1.8;      // start walking when farther than this from the slot (m)
const ARRIVE = 0.6;          // stop when closer than this (m)
const TURN_RATE = 9;         // rad/s
const REPATH_EVERY = 0.8;    // seconds between path searches per soldier
const GOAL_MOVED = 2.5;      // repath only if the target moved more than this (m)
const STUCK_TIME = 1.2;      // seconds of no progress before a new path
const SEP_R = 0.9;           // soldiers keep this distance from each other (m)
const PLAYER_KEEP = 1.3;     // soldiers keep this distance from the player (m)
const FORM_BACK = 2.6;       // distance between formation rows (m)
const FORM_SIDE = 1.9;       // distance of the two columns from the centre (m)
const FORM_TURN_DIST = 2;    // formation direction updates after the player moves this far (m)



/* ---------- Weapon stats (used by training now, by combat later) ----------
   cost    = supplies spent        time  = seconds to train
   damage  = per shot (shotgun: per blast, close range)
   range   = metres                rate  = seconds between shots            */
export const WEAPON_STATS = {
  pistol:  { label: 'Pistol',  info: 'Fast and cheap. Short range.',            cost: 20, time: 4, damage: 12, range: 25, rate: 0.45 },
  rifle:   { label: 'Rifle',   info: 'Long range, steady fire.',                cost: 40, time: 6, damage: 9,  range: 55, rate: 0.18 },
  shotgun: { label: 'Shotgun', info: 'Hits very hard up close. Weak at range.', cost: 35, time: 5, damage: 40, range: 14, rate: 1.0 }
};



/* ---------- State ---------- */
const soldiers = [];
let order = 'follow';
let goal = { x: 0, z: 0 };
let pathBudget = 1;                       // path searches allowed this frame
let fdx = 0, fdz = -1, lastPX = 0, lastPZ = 0, formInit = false;



export const getOrder = () => order;
export const getSoldiers = () => soldiers;
export const aliveCount = () => soldiers.filter((s) => !s.dead).length;
export const canAddSoldier = () => aliveCount() < MAX_UNITS;



function makeSoldier(char, x, z, heading, weapon = 'rifle') {
  return {
    char, x, z, heading,
    hp: 100, maxHp: 100, weapon, dead: false,
    path: [], pi: 0, goalX: Infinity, goalZ: Infinity,
    repathT: 0, moving: false, stuckT: 0,
    hold: { x, z, heading }
  };
}



const wrapTurn = (cur, want, maxStep) => {
  let d = want - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  d = Math.max(-maxStep, Math.min(maxStep, d));
  return cur + d;
};



/* ---------- Spawning ---------- */
export function spawnSquad(scene, x, z, yaw, n = 4) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  let made = 0;
  for (let i = 0; i < n && canAddSoldier(); i++) {
    const row = Math.floor(i / 2) + 1, side = i % 2 ? 1 : -1;
    let px = x - fx * (1.5 + row * 1.3) + rx * side * 1.5;
    let pz = z - fz * (1.5 + row * 1.3) + rz * side * 1.5;
    if (!walkableAt(px, pz)) { px = x; pz = z; }
    const f = resolveCollision(px, pz, BODY_R);
    const ch = spawnCharacter('team', scene);
    if (!ch) { console.warn('[units] characters are not loaded yet'); break; }
    const s = makeSoldier(ch, f.x, f.z, Math.atan2(fx, fz));
    ch.setPose(s.x, s.z, s.heading);
    soldiers.push(s);
    made++;
  }
  console.log(`[units] spawned ${made}, total ${soldiers.length}`);
  return made;
}



// One new soldier at a chosen spot (the Barracks door). He then walks to his
// formation slot like everybody else (follow) or stays where he is (hold / go).
export function addSoldier(scene, x, z, heading, weapon = 'pistol') {
  if (!canAddSoldier()) return null;
  if (!WEAPON_STATS[weapon]) weapon = 'pistol';
  let px = x, pz = z;
  if (!walkableAt(px, pz)) { px = x; pz = z; }
  const f = resolveCollision(px, pz, BODY_R);
  const ch = spawnCharacter('team', scene);
  if (!ch) { console.warn('[units] characters are not loaded yet'); return null; }
  const s = makeSoldier(ch, f.x, f.z, heading, weapon);
  ch.setPose(s.x, s.z, s.heading);
  soldiers.push(s);
  console.log(`[units] trained a ${weapon} soldier, alive ${aliveCount()}/${MAX_UNITS}`);
  return s;
}



export function clearUnits(scene) {
  for (const s of soldiers) removeCharacter(s.char, scene);
  soldiers.length = 0;
  console.log('[units] all soldiers removed');
}



/* ---------- Orders ---------- */
export function setOrder(name, x, z) {
  if (name === 'hold') {
    for (const s of soldiers) { s.hold = { x: s.x, z: s.z, heading: s.heading }; s.path = []; s.moving = false; }
  } else if (name === 'go') {
    goal = { x, z };
    for (const s of soldiers) { s.path = []; s.repathT = 0; }
  } else if (name === 'follow') {
    for (const s of soldiers) { s.path = []; s.repathT = 0; }
  } else {
    return order;
  }
  order = name;
  console.log('[units] order: ' + order + (name === 'go' ? ` (${Math.round(x)}, ${Math.round(z)})` : ''));
  return order;
}



export function hurtSoldier(s, amount) {
  if (!s || s.dead) return;
  s.hp -= amount;
  if (s.hp <= 0) { s.hp = 0; s.dead = true; s.moving = false; s.char.die(); }
  else s.char.hit();
}



export function unitsInfo() {
  const alive = aliveCount();
  return `${alive}/${soldiers.length} alive, order ${order}, last path: ${pathInfo.nodes} nodes, ` +
         `${pathInfo.ms.toFixed(1)} ms, ${pathInfo.found ? 'found' : (pathInfo.partial ? 'PARTIAL' : 'none')}`;
}



/* ---------- Per-frame update ---------- */
function slotTarget(i) {
  const row = Math.floor(i / 2) + 1, side = i % 2 ? 1 : -1;
  const rx = -fdz, rz = fdx;                         // right of the formation direction
  return { x: lastPX - fdx * FORM_BACK * row + rx * FORM_SIDE * side,
           z: lastPZ - fdz * FORM_BACK * row + rz * FORM_SIDE * side };
}



export function updateUnits(dt, player) {
  if (!soldiers.length) return;
  pathBudget = 1;



  // formation direction: set once from the view, then follows the way the player travels
  if (!formInit) {
    fdx = -Math.sin(player.yaw); fdz = -Math.cos(player.yaw);
    lastPX = player.x; lastPZ = player.z; formInit = true;
  }
  const moved = Math.hypot(player.x - lastPX, player.z - lastPZ);
  if (moved > FORM_TURN_DIST) {
    const nx = (player.x - lastPX) / moved, nz = (player.z - lastPZ) / moved;
    fdx += (nx - fdx) * 0.6; fdz += (nz - fdz) * 0.6;
    const l = Math.hypot(fdx, fdz) || 1; fdx /= l; fdz /= l;
    lastPX = player.x; lastPZ = player.z;
  }
  const formHeading = Math.atan2(fdx, fdz);



  let slot = 0;
  for (const s of soldiers) {
    if (s.dead) continue;
    let tx, tz, idleHeading;
    if (order === 'follow') {
      const t = slotTarget(slot++);
      tx = t.x; tz = t.z; idleHeading = formHeading;
    } else if (order === 'hold') {
      tx = s.hold.x; tz = s.hold.z; idleHeading = s.hold.heading;
    } else {
      tx = goal.x; tz = goal.z; idleHeading = s.heading;
    }
    stepSoldier(s, tx, tz, idleHeading, dt, player);
  }



  separate();



  for (const s of soldiers) {
    s.char.setPose(s.x, s.z, s.heading);
    if (!s.dead) s.char.play(s.moving ? (s.runNow ? 'run' : 'walk') : 'idle');
  }
}



function stepSoldier(s, tx, tz, idleHeading, dt, player) {
  const pdist = Math.hypot(player.x - s.x, player.z - s.z);



  // too far behind the player: jump to him
  if (order === 'follow' && pdist > TELEPORT_DIST) {
    let px = tx, pz = tz;
    if (!walkableAt(px, pz)) { px = player.x; pz = player.z; }
    const f = resolveCollision(px, pz, BODY_R);
    s.x = f.x; s.z = f.z; s.path = []; s.moving = false;
    return;
  }



  const dist = Math.hypot(tx - s.x, tz - s.z);
  if (!s.moving && dist > START_MOVE) s.moving = true;
  if (s.moving && dist < ARRIVE) { s.moving = false; s.path = []; }



  if (!s.moving) {
    s.heading = wrapTurn(s.heading, idleHeading, TURN_RATE * dt);
    s.runNow = false;
    return;
  }



  // find / refresh the route (one search per frame for the whole squad)
  s.repathT -= dt;
  const exhausted = s.pi >= s.path.length;
  const goalMoved = Math.hypot(tx - s.goalX, tz - s.goalZ) > GOAL_MOVED;
  if (s.repathT <= 0 && pathBudget > 0 && (exhausted || goalMoved || s.stuckT > STUCK_TIME)) {
    pathBudget--;
    s.path = findPath(s.x, s.z, tx, tz);
    s.pi = 0;
    s.goalX = tx; s.goalZ = tz;
    s.stuckT = 0;
    s.repathT = REPATH_EVERY + Math.random() * 0.3;
    if (!s.path.length) { s.moving = false; s.repathT = 2; return; }
  }



  // walk along the route
  let wp = s.path[s.pi];
  while (wp && Math.hypot(wp.x - s.x, wp.z - s.z) < 0.4) { s.pi++; wp = s.path[s.pi]; }
  if (!wp) return;



  s.runNow = dist > RUN_DIST;
  let speed = s.runNow ? RUN_SPEED : WALK_SPEED;
  if (order === 'follow' && pdist > CATCHUP_DIST) speed *= CATCHUP;



  const dx = wp.x - s.x, dz = wp.z - s.z;
  const d = Math.hypot(dx, dz) || 1;
  const step = Math.min(speed * dt, d);
  const ox = s.x, oz = s.z;
  const f = resolveCollision(s.x + dx / d * step, s.z + dz / d * step, BODY_R);
  s.x = f.x; s.z = f.z;



  const progress = Math.hypot(s.x - ox, s.z - oz);
  if (progress < step * 0.25) s.stuckT += dt;
  else s.stuckT = Math.max(0, s.stuckT - dt);



  s.heading = wrapTurn(s.heading, Math.atan2(dx, dz), TURN_RATE * dt);
}



// Keep soldiers from standing inside each other or inside the player
function separate() {
  const n = soldiers.length;
  for (let i = 0; i < n; i++) {
    const a = soldiers[i];
    if (a.dead) continue;
    for (let j = i + 1; j < n; j++) {
      const b = soldiers[j];
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
  for (const s of soldiers) {
    if (s.dead) continue;
    const f = resolveCollision(s.x, s.z, BODY_R);
    s.x = f.x; s.z = f.z;
  }
}