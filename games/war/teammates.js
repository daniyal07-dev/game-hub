// games/war/teammates.js
// The AI teammates: Alpha (Assault), Bravo (Assault), Hawk (Sniper), Doc (Medic).
// Handles squad movement, combat, Doc's healing, and Z/X/C squad orders.
// v2: TEAM MODES. Solo (no teammates), Duo (2) or Squad (4). Chosen when a stage starts.
//
// KNOBS (change these numbers to tune the squad):
//   SPEED       - teammate walking speed multiplier (lower = slower)
//   CATCH_UP    - extra speed when they fall far behind the player
//   MODES       - who is in each team mode (use the ids: alpha, bravo, hawk, doc)
//   Each role has its own firing "range" (metres) below.

import * as THREE from 'three';
import { makeTeammate, animateWalk, disposeObject } from './core/models.js';
import { play, distVolume } from './core/audio.js';
import { yawFor, turnToward, walkTo, makeNav, separation, findCover } from './ai.js';
import { castRay } from './items.js';

const SPEED = 0.8;          // 1.0 = original speed
const CATCH_UP = 1.4;       // speed boost when more than CATCH_DIST from the player
const CATCH_DIST = 14;      // metres
const STAND_OFF = 0.7;      // in "attack" order they stop at 70% of their range

// Team modes: which teammates join you
const MODES = {
  solo:  [],
  duo:   ['alpha', 'doc'],
  squad: ['alpha', 'bravo', 'hawk', 'doc']
};

// Roles definition (range = firing range in metres, spread = aim error)
const ROLES = [
  { id: 'alpha', name: 'ALPHA', role: 'Assault', hp: 120, spd: 4.8, range: 35, rate: 0.22, dmg: 16, spread: 0.04, color: 0x00f0ff },
  { id: 'bravo', name: 'BRAVO', role: 'Assault', hp: 120, spd: 4.8, range: 35, rate: 0.22, dmg: 16, spread: 0.04, color: 0x9b5cff },
  { id: 'hawk',  name: 'HAWK',  role: 'Sniper',  hp: 90,  spd: 4.2, range: 80, rate: 1.20, dmg: 70, spread: 0.01, color: 0xffd84a },
  { id: 'doc',   name: 'DOC',   role: 'Medic',   hp: 100, spd: 5.0, range: 25, rate: 0.35, dmg: 12, spread: 0.05, color: 0x3dff9a }
];

export function createSquad(ctx) {
  const { scene, fx, input } = ctx;
  const list = [];
  const group = new THREE.Group();
  scene.add(group);

  let order = 'follow';            // 'follow' (Z) | 'hold' (X) | 'attack' (C)
  let orderTarget = null;
  let healCooldown = 0;
  let teamSize = 4;                // how many teammates this mission started with
  let teamMode = 'squad';

  const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3();

  /* ---------- Create Teammate ---------- */
  function spawn(def, startPos) {
    const mesh = makeTeammate(def.id);
    mesh.position.set(startPos[0], 0, startPos[1]);
    group.add(mesh);

    const tm = {
      id: def.id, name: def.name, role: def.role, color: def.color,
      mesh, pos: mesh.position,
      alive: true, hp: def.hp, maxHp: def.hp,
      hit: { r: 0.5, y0: 0, y1: 1.8 },
      nav: makeNav(),
      cooldown: Math.random() * 0.5,
      walkPhase: Math.random() * 10,
      def,
      damage(dmg) {
        if (!tm.alive) return false;
        tm.hp -= dmg;
        fx.hitSpark(tm.pos.clone().setY(1.2), tm.color);
        if (tm.hp <= 0) {
          tm.alive = false;
          fx.deathBurst(tm.pos.clone().setY(1.0), 0x7b2ff7);
          play('hurt');
          group.remove(mesh);
          disposeObject(mesh);
          return true;
        }
        return false;
      }
    };
    list.push(tm);
    return tm;
  }

  /* ---------- Orders ---------- */
  function setOrder(newOrder, target = null) {
    if (teamSize === 0) return;      // Solo: nobody to give orders to
    order = newOrder;
    orderTarget = target;
    play('order');
    if (ctx.onOrder) ctx.onOrder(order, target);
  }

  input.onPress('KeyZ', () => setOrder('follow'));
  input.onPress('KeyX', () => setOrder('hold'));
  input.onPress('KeyC', () => {
    const tgt = ctx.getAimTarget ? ctx.getAimTarget() : null;
    setOrder('attack', tgt);
  });

  /* ---------- Update Loop ---------- */
  function update(dt) {
    const map = ctx.getMap();
    const player = ctx.getPlayer();
    const enemies = ctx.getEnemies();
    if (!map || !player) return;
    if (list.length === 0) return;   // Solo (or everyone is down): nothing to update

    healCooldown -= dt;

    // Doc's healing logic
    const doc = list.find(t => t.id === 'doc' && t.alive);
    if (doc && healCooldown <= 0) {
      let lowest = player.health < player.maxHealth ? player : null;
      let lowestFrac = lowest ? player.health / player.maxHealth : 1;

      for (const t of list) {
        if (!t.alive) continue;
        const frac = t.hp / t.maxHp;
        if (frac < lowestFrac) { lowestFrac = frac; lowest = t; }
      }

      if (lowest && lowestFrac < 0.85) {
        const d = doc.pos.distanceTo(lowest.pos);
        if (d < 3.5) {
          healCooldown = 2.5;
          if (lowest === player) player.health = Math.min(player.maxHealth, player.health + 30);
          else lowest.hp = Math.min(lowest.maxHp, lowest.hp + 35);
          fx.sphere(lowest.pos.clone().setY(1), 0x3dff9a, 0.4, 1.8, 0.4, 0.8);
          play('heal', distVolume(d, 40));
        }
      }
    }

    for (const tm of list) {
      if (!tm.alive) continue;

      tm.cooldown -= dt;
      const range = tm.def.range;

      // Pick enemy target
      let target = null, bd = 1e9;
      if (order === 'attack' && orderTarget && orderTarget.alive) {
        target = orderTarget;
        bd = tm.pos.distanceTo(target.pos);
      } else {
        for (const e of enemies) {
          if (!e.alive) continue;
          const d = tm.pos.distanceTo(e.pos);
          if (d < bd && d < range) { bd = d; target = e; }
        }
      }

      const canSee = target ? map.hasLineOfSight(tm.pos.x, tm.pos.z, target.pos.x, target.pos.z) : false;
      const inRange = target ? bd <= range : false;

      /* ----- Movement ----- */
      let tx = tm.pos.x, tz = tm.pos.z;
      let speed = tm.def.spd * SPEED;
      const playerDist = tm.pos.distanceTo(player.pos);

      if (tm.id === 'doc' && healCooldown <= 0 && needsHeal()) {
        // Doc prioritizes running to injured teammates/player
        const lowest = needsHeal();
        tx = lowest.pos.x; tz = lowest.pos.z;
      } else if (order === 'hold') {
        tx = tm.pos.x; tz = tm.pos.z;                // stay put
      } else if (order === 'attack' && target) {
        // Move until in a good firing position, then stop and shoot
        if (!canSee || bd > range * STAND_OFF) { tx = target.pos.x; tz = target.pos.z; }
      } else if (tm.id === 'hawk' && target && canSee && playerDist < 30) {
        tx = tm.pos.x; tz = tm.pos.z;                // sniper stops to take the shot
      } else {                                      // follow player
        const offX = tm.id === 'alpha' ? -3 : tm.id === 'bravo' ? 3 : tm.id === 'hawk' ? -5 : 5;
        const offZ = tm.id === 'hawk' ? 6 : 3;
        tx = player.pos.x + offX; tz = player.pos.z + offZ;
        if (playerDist > CATCH_DIST) speed *= CATCH_UP;   // catch up if left behind
      }

      const moved = walkTo(map, tm, tm.nav, tx, tz, speed, dt);
      const sep = separation(tm, list, 1.8);
      tm.pos.x += sep.x * dt * 2; tm.pos.z += sep.z * dt * 2;

      if (moved > 0.05) {
        tm.walkPhase += dt * speed * 2.2;
        animateWalk(tm.mesh, tm.walkPhase, 1);
      } else animateWalk(tm.mesh, 0, 0);

      /* ----- Aiming & Shooting (only inside firing range) ----- */
      if (target && canSee && inRange) {
        tm.mesh.rotation.y = turnToward(tm.mesh.rotation.y, yawFor(target.pos.x - tm.pos.x, target.pos.z - tm.pos.z), dt * 6);

        if (tm.cooldown <= 0) {
          tm.cooldown = tm.def.rate;
          const muzzle = tm.mesh.userData.muzzle.getWorldPosition(_m);

          _d.copy(target.pos).sub(tm.pos).normalize();
          _d.x += (Math.random() - 0.5) * tm.def.spread;
          _d.z += (Math.random() - 0.5) * tm.def.spread;

          const res = castRay(map, muzzle, _d, range, enemies, tm);
          _p.copy(muzzle).addScaledVector(_d, res.dist);

          fx.tracer(muzzle, _p, tm.color);
          fx.muzzle(muzzle, tm.color, 0.22);
          play(tm.id === 'hawk' ? 'sniper' : 'rifle', distVolume(bd, 50));

          if (res.ent && res.ent.damage) res.ent.damage(tm.def.dmg, 'squad');
        }
      } else if (moved > 0.05) {
        tm.mesh.rotation.y = yawFor(tm.nav.dx, tm.nav.dz);
      }
    }

    // Returns the most hurt one (player or teammate) below 85% health, or null
    function needsHeal() {
      let lowest = player.health < player.maxHealth ? player : null;
      let lowestFrac = lowest ? player.health / player.maxHealth : 1;
      for (const t of list) {
        if (!t.alive) continue;
        const frac = t.hp / t.maxHp;
        if (frac < lowestFrac) { lowestFrac = frac; lowest = t; }
      }
      return (lowest && lowestFrac < 0.85) ? lowest : null;
    }
  }

  // mode = 'solo' | 'duo' | 'squad'
  function reset(squadStart, mode = 'squad') {
    for (const tm of list) { group.remove(tm.mesh); disposeObject(tm.mesh); }
    list.length = 0;
    order = 'follow';
    orderTarget = null;
    healCooldown = 0;

    teamMode = MODES[mode] ? mode : 'squad';
    const members = MODES[teamMode];
    teamSize = members.length;

    // each teammate keeps their own start spot (index in ROLES)
    ROLES.forEach((def, i) => {
      if (members.includes(def.id)) spawn(def, (squadStart && squadStart[i]) || [0, 0]);
    });
  }

  function dispose() {
    for (const tm of list) { group.remove(tm.mesh); disposeObject(tm.mesh); }
    list.length = 0;
    scene.remove(group);
  }

  return {
    list,
    get order() { return order; },
    get size() { return teamSize; },     // teammates at the start of this mission (0, 2 or 4)
    get mode() { return teamMode; },
    setOrder,
    update, reset, dispose
  };
}