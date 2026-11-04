// games/war/items.js
// Everything the player holds or picks up:
// weapons (pistol, rifle, shotgun), grenades, ammo and health pickups.
// v6: refillAmmo() for the wave system, rifle and shotgun sit a bit higher on screen.

import * as THREE from 'three';
import { makeGun, makeGrenade, makePickup, disposeObject } from './core/models.js';
import { play, distVolume } from './core/audio.js';

/* ---------- Settings you can change ---------- */
export const WEAPONS = [
  { id: 'pistol',  name: 'PISTOL',  damage: 30, pellets: 1, delay: 0.28, mag: 12, reserveStart: 48,  reserveMax: 120,
    auto: false, spread: 0.004, reload: 1.1, recoil: 0.012, kick: 0.6,  range: 140, flash: 0x00f0ff },
  { id: 'rifle',   name: 'RIFLE',   damage: 14, pellets: 1, delay: 0.10, mag: 30, reserveStart: 120, reserveMax: 240,
    auto: true,  spread: 0.012, reload: 1.6, recoil: 0.006, kick: 0.35, range: 140, flash: 0xffd84a },
  { id: 'shotgun', name: 'SHOTGUN', damage: 11, pellets: 8, delay: 0.85, mag: 6,  reserveStart: 24,  reserveMax: 48,
    auto: false, spread: 0.055, reload: 2.2, recoil: 0.035, kick: 1.2,  range: 45,  flash: 0xff2d95, falloff: true }
];
const START_WEAPON = 1;                       // rifle
const START_GRENADES = 3;
const MAX_GRENADES = 5;
const REFILL_GRENADES = 2;                    // grenades given between waves
const AMMO_GIVE = { pistol: 24, rifle: 60, shotgun: 12 };   // per ammo pickup
const HEAL_GIVE = 35;
const GRENADE_RADIUS = 9;
const GRENADE_DAMAGE = 150;
const SELF_DAMAGE_FACTOR = 0.25;              // your own grenade hurts you a little

/* ---------- FIRST-PERSON VIEW (tweak these numbers) ----------
   x: + moves the gun right      y: + moves it up      z: + moves it back toward you
   sx: thickness side to side    sy: height (thickness seen from the side)    sz: length
   yaw: + turns the barrel to the left (towards the crosshair)
   Gun too low?        -> make y bigger (for example -0.01)
   Gun too high?       -> make y more negative (for example -0.06)
   Still looks thin?   -> make sx and sy bigger (for example 2.2)
   Looks too fat?      -> make sx and sy smaller (for example 1.4)
   Too long on screen? -> make sz smaller (for example 0.8) */
const VIEW = {
  pistol:  { x: 0,     y: 0,     z: 0,    sx: 1,   sy: 1,   sz: 1,    yaw: 0 },
  rifle:   { x: 0.05,  y: -0.03, z: 0.06, sx: 1.8, sy: 1.8, sz: 1.0,  yaw: 0.04 },
  shotgun: { x: 0.05,  y: -0.03, z: 0.06, sx: 1.8, sy: 1.8, sz: 1.0,  yaw: 0.04 }
};

/* ---------- Ray tests (also used by teammates and enemies) ---------- */
let warnedNoHit = false;

// Ray against a vertical cylinder. Returns distance or null.
function rayCylinder(o, d, e) {
  const h = e.hit;
  // Safety: a target without a hit-box (or position) is skipped instead of crashing the game
  if (!h || !e.pos) {
    if (!warnedNoHit) {
      warnedNoHit = true;
      console.warn('⚠️ A shootable target has no hit-box (hit/pos). Its keys:', Object.keys(e || {}), e);
    }
    return null;
  }
  const y0 = e.pos.y + h.y0, y1 = e.pos.y + h.y1;
  const ox = o.x - e.pos.x, oz = o.z - e.pos.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return null;
  const b = ox * d.x + oz * d.z;
  const c = ox * ox + oz * oz - h.r * h.r;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b + sq) / a;
  if (t1 < 0) return null;
  const t = Math.max(0, (-b - sq) / a);
  const y = o.y + d.y * t;
  if (y < y0 || y > y1) return null;
  return t;
}

// Shoots an invisible ray. Returns { ent, dist }.
// ent = the first target hit before any wall, or null if a wall (or nothing) came first.
export function castRay(map, origin, dir, range, targets, ignore = null) {
  let bestT = map.rayDistance(origin, dir, range);
  let best = null;
  for (const e of targets) {
    if (!e || !e.alive || e === ignore) continue;
    const t = rayCylinder(origin, dir, e);
    if (t !== null && t < bestT) { bestT = t; best = e; }
  }
  return { ent: best, dist: bestT };
}

/* ---------- The item system ---------- */
// ctx = { scene, camera, input, fx, player:{health,maxHealth},
//         getTargets(), getSquad(), hurtPlayer(n, fromPos),
//         onHit(ent, killed, point), onPickup(type) }
export function createItems(ctx) {
  const { scene, camera, input, fx, player } = ctx;
  const getTargets = ctx.getTargets || (() => []);
  const getSquad = ctx.getSquad || (() => []);
  let map = null;
  if (!camera.parent) scene.add(camera);

  const state = {
    current: START_WEAPON,
    ammo: WEAPONS.map(w => ({ mag: w.mag, reserve: w.reserveStart })),
    grenades: START_GRENADES,
    reloading: false, reloadT: 0,
    cooldown: 0, swapT: 0
  };

  let time = 0, kick = 0, moveAmt = 0, recoilAcc = 0;
  let aimTarget = null, aimTimer = 0, lastAim = null, lastAimAt = -99;

  const _o = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
  const _u = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3();
  const _e = new THREE.Vector3();

  /* ----- First-person guns ----- */
  const gunRoot = new THREE.Group();
  gunRoot.position.set(0.24, -0.24, -0.42);
  camera.add(gunRoot);
  const guns = WEAPONS.map(w => {
    const g = makeGun(w.id);
    g.group.visible = false;
    // Each gun sits inside its own holder, so we can move / scale / turn it without touching the model
    const v = VIEW[w.id] || { x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, yaw: 0 };
    const holder = new THREE.Group();
    holder.position.set(v.x, v.y, v.z);
    holder.rotation.y = v.yaw;
    holder.scale.set(v.sx, v.sy, v.sz);
    holder.add(g.group);
    gunRoot.add(holder);
    return g;
  });
  function showGun() { guns.forEach((g, i) => { g.group.visible = (i === state.current); }); }
  showGun();

  function select(i) {
    if (i === state.current) return;
    state.current = i;
    state.reloading = false;
    state.swapT = 0.25;
    showGun();
    play('swap');
  }

  /* ----- Shooting ----- */
  function fire(w) {
    const a = state.ammo[state.current];
    a.mag--;
    state.cooldown = w.delay;
    kick = Math.min(1.2, w.kick);
    recoilAcc += w.recoil * (0.7 + Math.random() * 0.6);

    camera.getWorldPosition(_o);
    camera.getWorldDirection(_f);
    _r.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const spread = w.spread * (1 + moveAmt * 0.8);
    const muzzle = guns[state.current].muzzle.getWorldPosition(_m);
    const targets = getTargets();

    let anyHit = false, anyKill = false, lastEnt = null;
    const hitPoint = new THREE.Vector3();

    for (let p = 0; p < w.pellets; p++) {
      _d.copy(_f)
        .addScaledVector(_r, (Math.random() * 2 - 1) * spread)
        .addScaledVector(_u, (Math.random() * 2 - 1) * spread)
        .normalize();
      const res = castRay(map, _o, _d, w.range, targets);
      _e.copy(_o).addScaledVector(_d, res.dist);
      fx.tracer(muzzle, _e, w.flash);

      if (res.ent) {
        const f = w.falloff ? Math.max(0.25, 1 - res.dist / w.range) : 1;
        const killed = res.ent.damage(w.damage * f, 'player');
        fx.hitSpark(_e, 0xff2d4a);
        anyHit = true;
        if (killed) anyKill = true;
        lastEnt = res.ent;
        hitPoint.copy(_e);
        lastAim = res.ent;
        lastAimAt = time;
      } else if (res.dist < w.range - 0.1) {
        fx.hitSpark(_e, 0xffd84a);
      }
    }

    fx.muzzle(muzzle, w.flash, w.id === 'shotgun' ? 0.45 : 0.28);
    play(w.id, 1);
    if (anyHit) {
      play(anyKill ? 'kill' : 'hit');
      if (ctx.onHit) ctx.onHit(lastEnt, anyKill, hitPoint);
    }
    if (ctx.onShot) ctx.onShot();
  }

  function startReload() {
    const w = WEAPONS[state.current], a = state.ammo[state.current];
    if (state.reloading || a.mag >= w.mag || a.reserve <= 0) return;
    state.reloading = true;
    state.reloadT = w.reload;
    play('reload');
  }

  function finishReload() {
    const w = WEAPONS[state.current], a = state.ammo[state.current];
    const take = Math.min(w.mag - a.mag, a.reserve);
    a.mag += take;
    a.reserve -= take;
    state.reloading = false;
  }

  /* ----- Supplies between waves ----- */
  // Every magazine full, every reserve topped up to at least its starting amount,
  // and a couple of extra grenades.
  function refillAmmo() {
    WEAPONS.forEach((w, i) => {
      const a = state.ammo[i];
      a.mag = w.mag;
      a.reserve = Math.max(a.reserve, w.reserveStart);
    });
    state.grenades = Math.min(MAX_GRENADES, Math.max(state.grenades, START_GRENADES) + REFILL_GRENADES);
    state.reloading = false;
  }

  /* ----- Explosions (grenades, bombs, mech blasts) ----- */
  // team 'player': hurts enemies, and you a little.   team 'enemy': hurts you and your squad.
  function blast(point, radius, maxDmg, team = 'player') {
    fx.explosion(point, radius * 0.75);
    play('explosion', Math.max(0.35, distVolume(camera.position.distanceTo(point), 90)));

    const falloffAt = (ent) => {
      const midY = ent.pos.y + (ent.hit ? (ent.hit.y0 + ent.hit.y1) / 2 : 0);
      const dx = ent.pos.x - point.x, dy = midY - point.y, dz = ent.pos.z - point.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - (ent.hit ? ent.hit.r : 0);
      return d > radius ? 0 : 1 - (Math.max(0, d) / radius) * 0.8;
    };

    let anyHit = false, anyKill = false, lastEnt = null;
    const list = team === 'player' ? getTargets() : getSquad();
    for (const e of list) {
      if (!e || !e.alive || !e.pos) continue;
      const f = falloffAt(e);
      if (f <= 0) continue;
      const killed = e.damage(maxDmg * f, team);
      anyHit = true;
      lastEnt = e;
      if (killed) anyKill = true;
    }

    // The player
    const dp = camera.position.distanceTo(point);
    if (dp < radius && ctx.hurtPlayer) {
      const f = 1 - (dp / radius) * 0.8;
      ctx.hurtPlayer(maxDmg * f * (team === 'player' ? SELF_DAMAGE_FACTOR : 1), point);
    }

    if (team === 'player' && anyHit && ctx.onHit) ctx.onHit(lastEnt, anyKill, point);
  }

  /* ----- Grenades ----- */
  const nades = [];

  function throwGrenade() {
    if (!map) return;
    if (state.grenades <= 0) { play('empty'); return; }
    state.grenades--;
    const obj = makeGrenade();
    camera.getWorldPosition(obj.position);
    camera.getWorldDirection(_f);
    obj.position.addScaledVector(_f, 0.7);
    obj.position.y -= 0.15;
    scene.add(obj);
    nades.push({
      obj,
      vel: new THREE.Vector3().copy(_f).multiplyScalar(17).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: 2.1
    });
    play('throw');
  }

  function updateGrenades(dt) {
    for (let i = nades.length - 1; i >= 0; i--) {
      const n = nades[i];
      const p = n.obj.position;
      n.fuse -= dt;
      n.vel.y -= 22 * dt;

      const nx = p.x + n.vel.x * dt, nz = p.z + n.vel.z * dt;
      if (map.isBlocked(nx, p.z, 0.15)) n.vel.x *= -0.5; else p.x = nx;
      if (map.isBlocked(p.x, nz, 0.15)) n.vel.z *= -0.5; else p.z = nz;
      p.y += n.vel.y * dt;

      if (p.y < 0.13) {
        p.y = 0.13;
        if (Math.abs(n.vel.y) > 2) play('bounce', 0.6);
        n.vel.y *= -0.45;
        n.vel.x *= 0.7;
        n.vel.z *= 0.7;
      }
      n.obj.rotation.x += dt * 6;

      if (n.fuse <= 0) {
        const at = p.clone();
        scene.remove(n.obj);
        disposeObject(n.obj);
        nades.splice(i, 1);
        blast(at, GRENADE_RADIUS, GRENADE_DAMAGE, 'player');
      }
    }
  }

  /* ----- Pickups ----- */
  const pickGroup = new THREE.Group();
  scene.add(pickGroup);
  const pickups = [];

  function dropPickup(type, x, z) {
    const obj = makePickup(type);
    obj.position.set(x, obj.userData.baseY, z);
    pickGroup.add(obj);
    pickups.push({ obj, type, x, z, t: Math.random() * 6 });
  }

  function tryCollect(type) {
    if (type === 'health') {
      if (player.health >= player.maxHealth) return false;
      player.health = Math.min(player.maxHealth, player.health + HEAL_GIVE);
      return true;
    }
    let gave = false;
    WEAPONS.forEach((w, i) => {
      const a = state.ammo[i];
      const add = Math.min(AMMO_GIVE[w.id], w.reserveMax - a.reserve);
      if (add > 0) { a.reserve += add; gave = true; }
    });
    if (state.grenades < MAX_GRENADES) { state.grenades++; gave = true; }
    return gave;
  }

  function updatePickups(dt) {
    const cp = camera.position;
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.t += dt;
      p.obj.position.y = p.obj.userData.baseY + Math.sin(p.t * 2.2) * 0.15;
      p.obj.userData.core.rotation.y += dt * 2;

      const dx = cp.x - p.x, dz = cp.z - p.z;
      if (dx * dx + dz * dz < 1.7 * 1.7 && tryCollect(p.type)) {
        play(p.type === 'health' ? 'heal' : 'pickup');
        if (ctx.onPickup) ctx.onPickup(p.type);
        pickGroup.remove(p.obj);
        disposeObject(p.obj);
        pickups.splice(i, 1);
      }
    }
  }

  /* ----- What is under the crosshair? (for the squad's "C" order) ----- */
  function getAimTarget() {
    if (aimTarget && aimTarget.alive) return aimTarget;
    if (lastAim && lastAim.alive && time - lastAimAt < 4) return lastAim;
    return null;
  }

  function updateAim(dt) {
    aimTimer -= dt;
    if (aimTimer > 0) return;
    aimTimer = 0.1;
    camera.getWorldPosition(_o);
    camera.getWorldDirection(_f);
    const res = castRay(map, _o, _f, 120, getTargets());
    aimTarget = res.ent;
    if (res.ent) { lastAim = res.ent; lastAimAt = time; }
  }

  /* ----- Main update (call every frame while playing) ----- */
  // info: { moving: true/false, sprint: true/false }
  function update(dt, info = {}) {
    if (!map) return;
    time += dt;
    moveAmt = info.moving ? (info.sprint ? 1 : 0.5) : 0;
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.swapT = Math.max(0, state.swapT - dt);

    const w = WEAPONS[state.current];
    const a = state.ammo[state.current];
    const click = input.consumeFire();            // always clear the click
    const wantFire = w.auto ? (input.firing || click) : click;

    if (state.reloading) {
      state.reloadT -= dt;
      if (state.reloadT <= 0) finishReload();
    } else if (wantFire && state.swapT <= 0 && state.cooldown <= 0) {
      if (a.mag > 0) fire(w);
      else if (a.reserve > 0) startReload();
      else if (click) play('empty');
    }

    updateGrenades(dt);
    updatePickups(dt);
    updateAim(dt);

    // Gun animation: sway, recoil kick, swap and reload dip
    kick = Math.max(0, kick - dt * 6);
    const swap = state.swapT > 0 ? state.swapT / 0.25 : 0;
    const dip = state.reloading
      ? Math.sin(Math.min(1, 1 - state.reloadT / w.reload) * Math.PI)
      : 0;
    gunRoot.position.set(
      0.24 + Math.sin(time * 7) * 0.006 * moveAmt,
      -0.24 - Math.abs(Math.sin(time * 7)) * 0.008 * moveAmt - swap * 0.3 - dip * 0.12,
      -0.42 + kick * 0.05
    );
    gunRoot.rotation.x = kick * 0.06 + dip * 0.5;
  }

  // How much the camera should tilt up from recoil this frame (add to your pitch)
  function takeRecoil() {
    const r = recoilAcc;
    recoilAcc = 0;
    return r;
  }

  function getHud() {
    const w = WEAPONS[state.current], a = state.ammo[state.current];
    return {
      slot: state.current, name: w.name,
      mag: a.mag, magMax: w.mag, reserve: a.reserve,
      grenades: state.grenades, reloading: state.reloading
    };
  }

  /* ----- Start / restart a stage ----- */
  function clearPickups() {
    pickups.forEach(p => { pickGroup.remove(p.obj); disposeObject(p.obj); });
    pickups.length = 0;
  }
  function clearGrenades() {
    nades.forEach(n => { scene.remove(n.obj); disposeObject(n.obj); });
    nades.length = 0;
  }

  function reset(newMap) {
    map = newMap;
    clearGrenades();
    clearPickups();
    state.ammo = WEAPONS.map(w => ({ mag: w.mag, reserve: w.reserveStart }));
    state.grenades = START_GRENADES;
    state.current = START_WEAPON;
    state.reloading = false;
    state.cooldown = 0;
    state.swapT = 0;
    kick = 0;
    recoilAcc = 0;
    aimTarget = lastAim = null;
    showGun();
    (map.pickups || []).forEach(p => dropPickup(p.type, p.x, p.z));
  }

  function dispose() {
    clearGrenades();
    clearPickups();
    scene.remove(pickGroup);
    camera.remove(gunRoot);
  }

  /* ----- Keys ----- */
  input.onPress('Digit1', () => select(0));
  input.onPress('Digit2', () => select(1));
  input.onPress('Digit3', () => select(2));
  input.onPress('KeyR', startReload);
  input.onPress('KeyG', throwGrenade);
  input.onWheel(dir => select((state.current + dir + WEAPONS.length) % WEAPONS.length));

  return {
    state, select, reload: startReload, throwGrenade,
    update, takeRecoil, getHud, getAimTarget,
    blast, dropPickup, refillAmmo, reset, dispose
  };
}