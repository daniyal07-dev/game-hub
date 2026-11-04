// games/war/enemies.js
// Ground and air enemies: rifle soldiers, heavy soldiers, snipers, turrets, mechs, drones and bombers.
// v8: the BOSS uses models/characters/boss.glb (hit box fitted to the model, idle animation).
//     (v7: firing ranges per enemy type, snipers with a laser warning. v6: speed knobs. v5: anti-stuck.)

import * as THREE from 'three';
import { makeEnemySoldier, makeTurret, makeMech, makeDrone, makeBomber, refreshDroneLook, animateWalk, animateMech, disposeObject } from './core/models.js';
import { play, distVolume } from './core/audio.js';
import { yawFor, turnToward, walkTo, makeNav, separation, findCover, flankPoint } from './ai.js';
import { castRay } from './items.js';

/* ================= DIFFICULTY: change only this number =================
   1.0 = original hard    0.55 = comfortable    0.3 = very easy            */
const EASE = 0.55;

const DMG    = EASE;                       // damage multiplier
const SPREAD = 1 + (1 - EASE) * 3;         // aim error multiplier (bigger = misses more)
const PAUSE  = 1 + (1 - EASE) * 2;         // longer rests between bursts
const RATE   = 1 + (1 - EASE) * 0.8;       // slower shots inside a burst
const REACT  = 0.4 + (1 - EASE) * 1.2;     // seconds before an enemy fires after spotting you
const LEVEL_CAP = 1.5;                     // director level can't speed enemies up more than this

/* ---------- MOVEMENT SPEED KNOBS ---------- */
const SPEED     = 0.6;    // soldiers, drones, bombers: 1.0 = original speed, 0.6 = 60% (slower)
const BIG_SPEED = 0.85;   // mech and boss: 1.0 = original speed

/* ---------- FIRING RANGE (metres). Beyond this distance the enemy does not shoot ---------- */
const RANGE_RIFLE  = 28;
const RANGE_HEAVY  = 20;
const RANGE_DRONE  = 30;
const RANGE_TURRET = 45;
const RANGE_MECH   = 45;
const RANGE_BOSS   = 55;
const RANGE_SNIPER = 80;

/* ---------- SNIPER KNOBS ---------- */
const SNIPER_CHANCE = 0.25;   // chance that a new rifleman becomes a sniper
const MAX_SNIPERS   = 2;      // never more than this many alive at once
const SNIPER_AFTER  = 6;      // the first 6 enemies are never snipers (easy start)
const SNIPER_AIM    = 1.6;    // seconds of red laser warning before the shot
const SNIPER_GAP    = 3.2;    // seconds between shots
const SNIPER_DMG    = 45;     // damage before EASE
const HP_SNIPER     = 60;

/* ---------- HP KNOBS ---------- */
const HP_RIFLE = 80;
const HP_HEAVY = 200;
const HP_TURRET = 200;
const HP_DRONE = 5;
const HP_BOMBER = 120;
const MECH_HP_MULT = 1.5;

// ctx = { scene, fx, director, items, announce, getMap(), getPlayer(), getSquad(), onKill(e, from) }
export function createEnemies(ctx) {
  const { scene, fx, director } = ctx;
  const list = [];
  const group = new THREE.Group();
  scene.add(group);
  let spawnedSoldiers = 0;      // counts soldiers spawned (used to keep snipers out of the first wave)

  const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3();

  /* ---------- small timer system (boss shells and bombs) ---------- */
  const delayed = [];
  function later(t, fn) { delayed.push({ t, fn }); }

  /* ---------- Spawn safety: never appear inside a block ---------- */
  function freeSpot(x, z, r) {
    const map = ctx.getMap && ctx.getMap();
    if (!map || !map.isBlocked) return { x, z };
    const rr = r + 0.4;                                   // extra room so nobody spawns touching a wall
    const lim = ((map.half || 60) - 3);
    x = Math.max(-lim, Math.min(lim, x));
    z = Math.max(-lim, Math.min(lim, z));
    if (!map.isBlocked(x, z, rr)) return { x, z };
    for (let ring = 1; ring <= 30; ring++) {
      const rad = ring * 1.2;
      const steps = 8 + ring * 4;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const px = Math.max(-lim, Math.min(lim, x + Math.cos(a) * rad));
        const pz = Math.max(-lim, Math.min(lim, z + Math.sin(a) * rad));
        if (!map.isBlocked(px, pz, rr)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  // Safety net: if a ground enemy ends up inside a block, move it to open ground
  function unstick(map, e, r, dt) {
    e.stuckT = (e.stuckT || 0) - dt;
    if (e.stuckT > 0) return;
    e.stuckT = 0.3;
    if (map.isBlocked && map.isBlocked(e.pos.x, e.pos.z, r)) {
      const s = freeSpot(e.pos.x, e.pos.z, r + 0.3);
      e.pos.x = s.x;
      e.pos.z = s.z;
    }
  }

  /* ---------- Aiming: chest, with error that grows with distance ---------- */
  function aimAt(out, from, target) {
    const isPlayer = target === ctx.getPlayer();
    out.set(target.pos.x, target.pos.y + (isPlayer ? -0.5 : 1.2), target.pos.z).sub(from).normalize();
    return out;
  }
  function addSpread(out, s, dist = 20) {
    const k = s * SPREAD * (0.6 + dist / 25);
    out.x += (Math.random() - 0.5) * k;
    out.y += (Math.random() - 0.5) * k * 0.5;
    out.z += (Math.random() - 0.5) * k;
    out.normalize();
  }
  function strike(ent, player, dmg, fromPos) {
    if (!ent) return;
    const d = Math.max(1, Math.round(dmg * DMG));
    if (ent === player) player.damage(d, fromPos);
    else if (ent.damage) ent.damage(d, 'enemy');
  }
  function blastDmg(d) { return Math.max(5, Math.round(d * DMG)); }

  function pickTarget(pos, player, squad) {
    let best = player, bd = pos.distanceTo(player.pos);
    for (const sq of squad) {
      if (!sq.alive) continue;
      const d = pos.distanceTo(sq.pos);
      if (d < bd * 0.8) { bd = d; best = sq; }
    }
    return best;
  }

  /* ---------- SMART MOVEMENT: keep range, strafe, flank ---------- */
  function engage(map, e, target, dist, canSee, lo, hi, spd, dt, strafeAmt) {
    const dx = target.pos.x - e.pos.x, dz = target.pos.z - e.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len, nz = dz / len;

    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafeDir *= -1; e.strafeT = 1.2 + Math.random() * 2; }

    let tx, tz;
    if (!canSee || dist > hi) {
      tx = target.pos.x; tz = target.pos.z;
      if (e.role === 'flanker' && dist > 20) {
        tx += -nz * e.flankSide * 14;
        tz += nx * e.flankSide * 14;
      }
    } else if (dist < lo) {
      tx = e.pos.x - nx * 8; tz = e.pos.z - nz * 8;
    } else {
      tx = e.pos.x + (-nz) * e.strafeDir * strafeAmt;
      tz = e.pos.z + nx * e.strafeDir * strafeAmt;
    }
    return walkTo(map, e, e.nav, tx, tz, spd, dt);
  }

  /* ---------- Sniper laser (red warning line) ---------- */
  function makeLaser() {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    const m = new THREE.LineBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.3, toneMapped: false });
    const line = new THREE.Line(geo, m);
    line.frustumCulled = false;
    line.visible = false;
    group.add(line);
    return line;
  }
  function setLaser(e, from, to, strength) {
    if (!e.laser) return;
    const a = e.laser.geometry.attributes.position;
    a.setXYZ(0, from.x, from.y, from.z);
    a.setXYZ(1, to.x, to.y, to.z);
    a.needsUpdate = true;
    e.laser.material.opacity = 0.25 + 0.7 * strength;
    e.laser.visible = true;
  }
  function hideLaser(e) { if (e.laser) e.laser.visible = false; }
  function removeLaser(e) {
    if (!e.laser) return;
    group.remove(e.laser);
    e.laser.geometry.dispose();
    e.laser.material.dispose();
    e.laser = null;
  }

  /* ---------- Ground Soldier (rifle / heavy / sniper) ---------- */
  function spawnSoldier(x, z, kindWanted = 'rifle') {
    let kind = kindWanted;
    if (kind === 'rifle' && spawnedSoldiers >= SNIPER_AFTER &&
        list.filter(o => o.alive && o.kind === 'sniper').length < MAX_SNIPERS &&
        Math.random() < SNIPER_CHANCE) {
      kind = 'sniper';
    }
    spawnedSoldiers++;

    const isHeavy = kind === 'heavy';
    const isSniper = kind === 'sniper';
    const spot = freeSpot(x, z, isHeavy ? 1.0 : 0.8);
    const mesh = makeEnemySoldier(isHeavy ? 'heavy' : 'rifle');
    mesh.position.set(spot.x, 0, spot.z);
    group.add(mesh);

    const maxHp = isHeavy ? HP_HEAVY : (isSniper ? HP_SNIPER : HP_RIFLE);
    const hs = isHeavy ? 1.1 : 1;               // same as HEAVY_SCALE in models.js
    const e = {
      type: 'soldier', kind,
      mesh, pos: mesh.position,
      alive: true, hp: maxHp, maxHp,
      hit: { r: 0.55 * hs, y0: 0, y1: 1.85 * hs },
      nav: makeNav(),
      cooldown: Math.random() * 0.8,
      walkPhase: Math.random() * 10,
      coverSpot: null, coverT: 0, usedCover: false,
      burst: 0, seen: 0, stuckT: 0,
      aimT: 0,
      laser: isSniper ? makeLaser() : null,
      strafeT: Math.random() * 2, strafeDir: Math.random() < 0.5 ? 1 : -1,
      role: (!isHeavy && !isSniper && Math.random() < 0.35) ? 'flanker' : 'rusher',
      flankSide: Math.random() < 0.5 ? 1 : -1,
      damage(dmg, from) {
        if (!e.alive) return false;
        e.hp -= dmg;
        fx.hitSpark(e.pos.clone().setY(1.2), 0xff2d4a);
        if (isSniper && e.aimT > 0) e.aimT = Math.max(e.aimT, SNIPER_AIM * 0.5);   // a hit does not cancel the aim, only delays it a little
        if (e.hp <= 0) {
          e.alive = false;
          removeLaser(e);
          fx.deathBurst(e.pos.clone().setY(1.0), 0xff2d4a);
          play('kill');
          group.remove(mesh);
          disposeObject(mesh);
          if (ctx.onKill) ctx.onKill(e, from);
          return true;
        }
        return false;
      }
    };
    list.push(e);
    return e;
  }

  // Sniper: stops, shows a laser that gets brighter, then fires one strong shot.
  function updateSniper(e, map, player, squadTargets, target, dist, canSee, ready, lvl, dt) {
    if (canSee) {
      e.mesh.rotation.y = turnToward(e.mesh.rotation.y, yawFor(target.pos.x - e.pos.x, target.pos.z - e.pos.z), dt * 6);
    }
    if (!canSee || dist > RANGE_SNIPER) {
      e.aimT = 0;
      hideLaser(e);
      return;
    }

    const muzzle = e.mesh.userData.muzzle.getWorldPosition(_m);

    if (e.aimT > 0) {
      e.aimT -= dt;
      aimAt(_d, muzzle, target);
      const res = castRay(map, muzzle, _d, RANGE_SNIPER + 10, squadTargets, e);
      _p.copy(muzzle).addScaledVector(_d, res.dist);
      setLaser(e, muzzle, _p, 1 - Math.max(0, e.aimT) / SNIPER_AIM);

      if (e.aimT <= 0) {
        aimAt(_d, muzzle, target);
        addSpread(_d, 0.01, dist);
        const shot = castRay(map, muzzle, _d, RANGE_SNIPER + 10, squadTargets, e);
        _p.copy(muzzle).addScaledVector(_d, shot.dist);
        fx.tracer(muzzle, _p, 0xff2020, 0.1);
        fx.muzzle(muzzle, 0xff2020, 0.3);
        play('enemyShot', distVolume(dist, 90));
        strike(shot.ent, player, SNIPER_DMG, e.pos);
        e.cooldown = SNIPER_GAP / lvl;
        hideLaser(e);
      }
    } else if (ready && e.cooldown <= 0) {
      e.aimT = SNIPER_AIM;
    } else {
      hideLaser(e);
    }
  }

  /* ---------- Turret ---------- */
  function spawnTurret(x, z) {
    const spot = freeSpot(x, z, 1.1);
    const mesh = makeTurret();
    mesh.position.set(spot.x, 0, spot.z);
    group.add(mesh);

    const e = {
      type: 'turret',
      mesh, pos: mesh.position,
      alive: true, hp: HP_TURRET, maxHp: HP_TURRET,
      hit: { r: 0.9, y0: 0, y1: 1.5 },
      cooldown: Math.random() * 1.0,
      lock: 0, seen: 0,
      damage(dmg, from) {
        if (!e.alive) return false;
        e.hp -= dmg;
        fx.hitSpark(e.pos.clone().setY(1.0), 0xff2d4a);
        if (e.hp <= 0) {
          e.alive = false;
          fx.explosion(e.pos.clone().setY(0.8), 4);
          group.remove(mesh);
          disposeObject(mesh);
          if (ctx.onKill) ctx.onKill(e, from);
          return true;
        }
        return false;
      }
    };
    list.push(e);
    return e;
  }

  /* ---------- Mech (Heavy / Boss) ---------- */
  function spawnMech(x, z, maxHp = 300, isBoss = false) {
    maxHp = Math.round(maxHp * MECH_HP_MULT);
    const spot = freeSpot(x, z, isBoss ? 2.4 : 1.8);
    const sc = isBoss ? 1.6 : 1.2;
    const mesh = makeMech(sc, isBoss);              // v8: the boss uses boss.glb when it is loaded
    mesh.position.set(spot.x, 0, spot.z);
    group.add(mesh);

    // hit box: fitted to the boss model, or to the code-built mech
    const glb = !!mesh.userData.isGlb;
    const bodyH = glb ? mesh.userData.height : 4.6 * sc;
    const bodyR = glb ? Math.max(0.9, bodyH * 0.3) : 1.4 * sc;

    const e = {
      type: 'mech', isBoss,
      mesh, pos: mesh.position,
      alive: true, hp: maxHp, maxHp,
      hit: { r: bodyR, y0: 0, y1: bodyH },
      nav: makeNav(),
      cooldown: 1.0,
      walkPhase: 0,
      burst: 0, seen: 0, stuckT: 0,
      phase: 1, barrageT: 6,
      strafeT: 1, strafeDir: Math.random() < 0.5 ? 1 : -1,
      role: 'rusher', flankSide: 1,
      damage(dmg, from) {
        if (!e.alive) return false;
        e.hp -= dmg;
        fx.hitSpark(e.pos.clone().setY(Math.min(2.5, bodyH * 0.55)), 0xff2d4a);
        if (e.hp <= 0) {
          e.alive = false;
          fx.explosion(e.pos.clone().setY(2.0), isBoss ? 12 : 7, 0xff2d4a);
          group.remove(mesh);
          disposeObject(mesh);
          if (ctx.onKill) ctx.onKill(e, from);
          return true;
        }
        return false;
      }
    };
    list.push(e);
    return e;
  }

  /* ---------- Drone ---------- */
  function spawnDrone(x, y, z) {
    const mesh = makeDrone();
    mesh.position.set(x, y, z);
    group.add(mesh);

    const look = (e, boost) => refreshDroneLook(mesh, Math.max(1, Math.ceil((e.hp / e.maxHp) * 3)), 3, boost);

    const e = {
      type: 'drone',
      mesh, pos: mesh.position,
      alive: true, hp: HP_DRONE, maxHp: HP_DRONE,
      hit: { r: 1.1, y0: -0.6, y1: 0.6 },
      cooldown: 0.5 + Math.random() * 0.8,
      strafe: Math.random() < 0.5 ? 1 : -1,
      strafeT: Math.random() * 1.5,
      phase: Math.random() * 10,
      burst: 0, seen: 0,
      flashT: 0,
      look,
      damage(dmg, from) {
        if (!e.alive) return false;
        e.hp -= 1;
        e.flashT = 0.2;
        look(e, 1);
        if (e.hp <= 0) {
          e.alive = false;
          fx.explosion(e.pos, 3, 0x00f0ff);
          group.remove(mesh);
          disposeObject(mesh);
          if (ctx.onKill) ctx.onKill(e, from);
          return true;
        }
        return false;
      }
    };
    list.push(e);
    return e;
  }

  /* ---------- Bomber ---------- */
  function spawnBomber(x, y, z) {
    const mesh = makeBomber();
    mesh.position.set(x, y, z);
    group.add(mesh);

    const e = {
      type: 'bomber',
      mesh, pos: mesh.position,
      alive: true, hp: HP_BOMBER, maxHp: HP_BOMBER,
      hit: { r: 1.8, y0: -0.5, y1: 0.5 },
      cooldown: 2.0,
      vel: new THREE.Vector3(0, 0, 8 * SPEED),
      damage(dmg, from) {
        if (!e.alive) return false;
        e.hp -= dmg;
        fx.hitSpark(e.pos, 0xff7a2a);
        if (e.hp <= 0) {
          e.alive = false;
          fx.explosion(e.pos, 6, 0xff7a2a);
          group.remove(mesh);
          disposeObject(mesh);
          if (ctx.onKill) ctx.onKill(e, from);
          return true;
        }
        return false;
      }
    };
    list.push(e);
    return e;
  }

  /* ---------- Boss artillery: warning flashes, then explosions ---------- */
  function barrage(center, count) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = k === 0 ? 0 : 3 + Math.random() * 6;
      const p = new THREE.Vector3(center.x + Math.cos(a) * r, 0.3, center.z + Math.sin(a) * r);
      const delay = 1.3 + k * 0.18;
      for (const w of [0, 0.45, 0.9]) later(w, () => fx.muzzle(p.clone().setY(0.5), 0xffcc00, 1.2));
      later(delay, () => {
        fx.explosion(p.clone(), 5, 0xff7a2a);
        play('turret');
        if (ctx.items && ctx.items.blast) ctx.items.blast(p.clone(), 5, blastDmg(40), 'enemy');
      });
    }
  }

  /* ---------- Update loop ---------- */
  function update(dt) {
    const map = ctx.getMap();
    const player = ctx.getPlayer();
    const squad = ctx.getSquad();
    if (!map || !player) return;

    if (!player.hit) player.hit = { r: 0.45, y0: -1.7, y1: 0.25 };

    for (let i = delayed.length - 1; i >= 0; i--) {
      delayed[i].t -= dt;
      if (delayed[i].t <= 0) {
        const fn = delayed[i].fn;
        delayed.splice(i, 1);
        try { fn(); } catch (err) { /* ignore */ }
      }
    }

    const lvl = Math.min(LEVEL_CAP, director ? director.level : 1);
    const squadTargets = [player, ...squad.filter(s => s.alive)];

    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e.alive) { list.splice(i, 1); continue; }

      const target = pickTarget(e.pos, player, squad);
      const dist = e.pos.distanceTo(target.pos);
      const canSee = map.hasLineOfSight(e.pos.x, e.pos.z, target.pos.x, target.pos.z);

      e.seen = canSee ? (e.seen || 0) + dt : 0;
      const ready = e.seen > REACT;

      /* ----- Soldier (rifle / heavy / sniper) ----- */
      if (e.type === 'soldier') {
        e.cooldown -= dt;
        e.coverT -= dt;
        const heavy = e.kind === 'heavy';
        const sniper = e.kind === 'sniper';
        const spd = (heavy ? 3.0 : (sniper ? 3.0 : 4.5)) * SPEED;
        const range = heavy ? RANGE_HEAVY : RANGE_RIFLE;

        if (!e.usedCover && e.hp < e.maxHp * 0.35) {
          e.usedCover = true;
          const cv = findCover(map, e.pos, target.pos, 14);
          if (cv) { e.coverSpot = cv; e.coverT = 4.5; }
        }

        let moved = 0;
        if (sniper && e.aimT > 0) {
          moved = 0;                                    // a sniper stands still while aiming
        } else if (e.coverSpot && e.coverT > 0) {
          moved = walkTo(map, e, e.nav, e.coverSpot.x, e.coverSpot.z, spd * 1.2, dt);
        } else if (sniper) {
          moved = engage(map, e, target, dist, canSee, 35, 65, spd, dt, 3);
        } else {
          moved = engage(map, e, target, dist, canSee, heavy ? 6 : 9, heavy ? 15 : 22, spd, dt, 6);
        }

        // keep apart from other enemies, but never get pushed into a wall
        const sep = separation(e, list, 1.8);
        const sx = e.pos.x + sep.x * dt * 2 * SPEED, sz = e.pos.z + sep.z * dt * 2 * SPEED;
        if (!map.isBlocked || !map.isBlocked(sx, sz, 0.5)) { e.pos.x = sx; e.pos.z = sz; }

        unstick(map, e, 0.3, dt);

        if (moved > 0.05) {
          e.walkPhase += dt * spd * 2.2;
          animateWalk(e.mesh, e.walkPhase, 1);
        } else animateWalk(e.mesh, 0, 0);

        if (sniper) {
          updateSniper(e, map, player, squadTargets, target, dist, canSee, ready, lvl, dt);
        } else if (canSee) {
          e.mesh.rotation.y = turnToward(e.mesh.rotation.y, yawFor(target.pos.x - e.pos.x, target.pos.z - e.pos.z), dt * 6);
          if (ready && e.cooldown <= 0 && dist < range) {
            if (e.burst <= 0) e.burst = heavy ? 10 : 3;
            e.burst--;
            e.cooldown = (e.burst > 0 ? (heavy ? 0.09 : 0.16) * RATE : (heavy ? 0.45 : 0.7) * PAUSE) / lvl;

            const muzzle = e.mesh.userData.muzzle.getWorldPosition(_m);
            const dmg = heavy ? 8 : 10;

            aimAt(_d, muzzle, target);
            addSpread(_d, 0.09 / lvl, dist);

            const res = castRay(map, muzzle, _d, 60, squadTargets, e);
            _p.copy(muzzle).addScaledVector(_d, res.dist);
            fx.tracer(muzzle, _p, 0xff2d4a);
            fx.muzzle(muzzle, 0xff2d4a, 0.22);
            play('enemyShot', distVolume(dist, 50));

            strike(res.ent, player, dmg, e.pos);
          }
        }
      }

      /* ----- Turret ----- */
      else if (e.type === 'turret') {
        e.cooldown -= dt;
        if (canSee && dist < RANGE_TURRET) {
          e.lock = Math.min(1, e.lock + dt * 0.5);
          const head = e.mesh.userData.head;
          head.rotation.y = turnToward(head.rotation.y, yawFor(target.pos.x - e.pos.x, target.pos.z - e.pos.z), dt * 5);

          if (ready && e.cooldown <= 0) {
            e.cooldown = 0.2 * RATE / lvl;
            const muzzle = e.mesh.userData.muzzle.getWorldPosition(_m);
            aimAt(_d, muzzle, target);
            addSpread(_d, 0.02 + 0.14 * (1 - e.lock), dist);
            const res = castRay(map, muzzle, _d, 55, squadTargets, e);
            _p.copy(muzzle).addScaledVector(_d, res.dist);
            fx.tracer(muzzle, _p, 0xff2d4a, 0.05);
            fx.muzzle(muzzle, 0xff2d4a, 0.3);
            play('turret', distVolume(dist, 50));

            strike(res.ent, player, 14, e.pos);
          }
        } else {
          e.lock = Math.max(0, e.lock - dt);
        }
      }

      /* ----- Mech / BOSS ----- */
      else if (e.type === 'mech') {
        e.cooldown -= dt;
        const boss = e.isBoss;
        const mechRange = boss ? RANGE_BOSS : RANGE_MECH;

        let phase = 1;
        if (boss) {
          const f = e.hp / e.maxHp;
          phase = f > 0.66 ? 1 : (f > 0.33 ? 2 : 3);
          if (phase !== e.phase) {
            e.phase = phase;
            e.cooldown = 1.0;
            e.barrageT = 1.5;
            fx.explosion(e.pos.clone().setY(3), 8, 0xff2d4a);
            if (ctx.announce) ctx.announce(phase === 2 ? '⚠ BOSS: ARTILLERY MODE' : '☠ BOSS ENRAGED');
          }
        }

        const base = boss ? 2.4 : 2.8;
        const spd = (boss ? base * (phase === 1 ? 1 : (phase === 2 ? 1.25 : 1.7)) : base) * BIG_SPEED;
        const moved = engage(map, e, target, dist, canSee, boss ? 16 : 14, boss ? 28 : 26, spd, dt, 5);

        unstick(map, e, 0.8, dt);

        if (moved > 0.02) {
          e.walkPhase += dt * 4;
          animateMech(e.mesh, e.walkPhase, 1);
          if (Math.sin(e.walkPhase) > 0.9) play('mechStep', distVolume(dist, 40) * 0.4);
        } else if (e.mesh.userData.isGlb) {
          animateMech(e.mesh, 0, 0);                 // boss model: idle animation when standing
        }

        if (boss && phase >= 2 && dist < 70) {
          e.barrageT -= dt;
          if (e.barrageT <= 0) {
            e.barrageT = (phase === 2 ? 9 : 6) * (1 + (1 - EASE));
            barrage(player.pos, phase === 2 ? 4 : 7);
            showWarning();
          }
        }

        if (canSee) {
          e.mesh.rotation.y = turnToward(e.mesh.rotation.y, yawFor(target.pos.x - e.pos.x, target.pos.z - e.pos.z), dt * (boss ? 3.5 : 3));
          if (ready && e.cooldown <= 0 && dist < mechRange) {
            if (e.burst <= 0) e.burst = boss ? (phase === 1 ? 5 : (phase === 2 ? 6 : 8)) : 4;
            e.burst--;
            const gap = boss ? (phase === 1 ? 0.3 : (phase === 2 ? 0.24 : 0.18)) : 0.35;
            const pause = boss ? (phase === 1 ? 1.2 : (phase === 2 ? 0.9 : 0.6)) : 1.0;
            e.cooldown = (e.burst > 0 ? gap * RATE : pause * PAUSE) / lvl;

            const dmg = boss ? (phase === 3 ? 20 : 18) : 16;
            const spread = boss ? (phase === 3 ? 0.04 : 0.06) : 0.07;
            e.mesh.userData.muzzles.forEach(mObj => {
              const muzzle = mObj.getWorldPosition(_m);
              aimAt(_d, muzzle, target);
              addSpread(_d, spread, dist);
              const res = castRay(map, muzzle, _d, 60, squadTargets, e);
              _p.copy(muzzle).addScaledVector(_d, res.dist);
              fx.tracer(muzzle, _p, 0xff2d4a, 0.08);
              fx.muzzle(muzzle, 0xff2d4a, 0.5);

              strike(res.ent, player, dmg, e.pos);
            });
            play('turret', distVolume(dist, 60));
          }
        }
      }

      /* ----- Drone ----- */
      else if (e.type === 'drone') {
        e.cooldown -= dt;
        if (e.flashT > 0) {
          e.flashT -= dt;
          if (e.flashT <= 0) e.look(e, 0);
        }

        _d.copy(target.pos).sub(e.pos);
        _d.y = 0;
        const dFlat = _d.length();
        _d.normalize();

        e.strafeT -= dt;
        if (e.strafe === 0) e.strafe = 1;
        if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = 0.8 + Math.random() * 1.6; }

        const desiredY = 4.5 + Math.sin(Date.now() * 0.003 + e.phase) * 1.2;
        e.pos.y += (desiredY - e.pos.y) * dt * 2 * SPEED;

        let vx = 0, vz = 0;
        if (dFlat > 16) { vx = _d.x * 7; vz = _d.z * 7; }
        else if (dFlat < 9) { vx = -_d.x * 6; vz = -_d.z * 6; }
        vx += -_d.z * e.strafe * 5;
        vz += _d.x * e.strafe * 5;
        const sep = separation(e, list, 3);
        vx += sep.x * 2; vz += sep.z * 2;
        vx *= SPEED; vz *= SPEED;

        e.pos.x += vx * dt;
        e.pos.z += vz * dt;
        const lim = (map.half || 60) - 2;
        e.pos.x = Math.max(-lim, Math.min(lim, e.pos.x));
        e.pos.z = Math.max(-lim, Math.min(lim, e.pos.z));

        e.mesh.rotation.y = yawFor(_d.x, _d.z);

        if (canSee && ready && e.cooldown <= 0 && dist < RANGE_DRONE) {
          if (e.burst <= 0) e.burst = 2;
          e.burst--;
          e.cooldown = (e.burst > 0 ? 0.18 * RATE : 0.9 * PAUSE) / lvl;
          aimAt(_d, e.pos, target);
          addSpread(_d, 0.05, dist);
          const res = castRay(map, e.pos, _d, 50, squadTargets, e);
          _p.copy(e.pos).addScaledVector(_d, res.dist);
          fx.tracer(e.pos, _p, 0x00f0ff);
          fx.muzzle(e.pos, 0x00f0ff, 0.3);
          play('enemyShot', distVolume(dist, 50));

          strike(res.ent, player, 10, e.pos);
        }
      }

      /* ----- Bomber ----- */
      else if (e.type === 'bomber') {
        e.cooldown -= dt;
        e.pos.addScaledVector(e.vel, dt);
        e.pos.y = 12;

        _d.copy(target.pos).sub(e.pos);
        e.vel.x += _d.x * dt * 0.4 * SPEED;
        e.vel.z += _d.z * dt * 0.4 * SPEED;
        e.vel.clampLength(6 * SPEED, 12 * SPEED);
        e.mesh.rotation.y = yawFor(e.vel.x, e.vel.z);

        const flat = Math.hypot(target.pos.x - e.pos.x, target.pos.z - e.pos.z);
        if (flat < 9 && e.cooldown <= 0) {
          e.cooldown = 3.0 * PAUSE;
          const dropAt = new THREE.Vector3(e.pos.x, 0.2, e.pos.z);
          fx.muzzle(dropAt.clone().setY(0.5), 0xffcc00, 1.0);
          later(0.7, () => {
            fx.explosion(dropAt.clone(), 5, 0xff7a2a);
            if (ctx.items && ctx.items.blast) ctx.items.blast(dropAt.clone(), 5, blastDmg(45), 'enemy');
          });
        }

        if (Math.abs(e.pos.x) > map.half + 20 || Math.abs(e.pos.z) > map.half + 20) {
          e.pos.set(target.pos.x + (Math.random() - 0.5) * 40, 12, target.pos.z + (Math.random() - 0.5) * 40);
        }
      }
    }
  }

  function showWarning() {
    if (ctx.announce) ctx.announce('⚠ INCOMING ARTILLERY — MOVE!');
  }

  function clear() {
    for (const e of list) { removeLaser(e); group.remove(e.mesh); disposeObject(e.mesh); }
    list.length = 0;
    delayed.length = 0;
    spawnedSoldiers = 0;
  }

  function dispose() {
    clear();
    scene.remove(group);
  }

  return {
    list,
    spawnSoldier, spawnTurret, spawnMech, spawnDrone, spawnBomber,
    update, clear, dispose
  };
}