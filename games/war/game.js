// games/war/game.js
// Handles HUD elements, Radar minimap, NOVA comms messages,
// stage objectives (beacon, generators, boss), wave manager and results/unlock tracking.
// v2: wave manager for Stage 1 (4 waves + boss), weapon-name label fix, wave banner.

import * as THREE from 'three';
import map1 from './maps/map1.js';
import map2 from './maps/map2.js';
import map3 from './maps/map3.js';
import map4 from './maps/map4.js';
import map5 from './maps/map5.js';
import { play } from './core/audio.js';

export const STAGE_DEFS = [map1, map2, map3, map4, map5];

/* ---------- Local Storage ---------- */
const UNLOCK_KEY = 'warUnlockedStage';
const STARS_KEY = 'warStageStars';

export function getUnlockedStage() {
  return parseInt(localStorage.getItem(UNLOCK_KEY) || '1', 10);
}

export function unlockAllStages() {
  localStorage.setItem(UNLOCK_KEY, '5');
}

export function saveStageStars(stageId, stars) {
  const current = JSON.parse(localStorage.getItem(STARS_KEY) || '{}');
  if ((current[stageId] || 0) < stars) {
    current[stageId] = stars;
    localStorage.setItem(STARS_KEY, JSON.stringify(current));
  }
}

export function getStageStars(stageId) {
  const current = JSON.parse(localStorage.getItem(STARS_KEY) || '{}');
  return current[stageId] || 0;
}

/* ---------- Radar Minimap ---------- */
export function createRadar(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const R = W / 2;

  return {
    draw(playerPos, yaw, map, enemies, squad, points = []) {
      ctx.clearRect(0, 0, W, H);

      // Outer circle frame
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, R - 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 10, 30, 0.75)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.clip();

      const scale = 1.4;             // meters to radar pixels

      const worldToRadar = (wx, wz) => {
        const dx = wx - playerPos.x;
        const dz = wz - playerPos.z;
        // Rotate according to player facing yaw
        const rx = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
        const ry = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);
        return { x: R + rx * scale, y: R + ry * scale };
      };

      // Draw map boundaries
      const half = map.half;
      const corners = [
        worldToRadar(-half, -half), worldToRadar(half, -half),
        worldToRadar(half, half), worldToRadar(-half, half)
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Special Objective Points (yellow / cyan)
      points.forEach(p => {
        const pos = worldToRadar(p.x, p.z);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = p.color || '#ffd84a';
        ctx.fill();
      });

      // Squad members (cyan dot)
      squad.forEach(tm => {
        if (!tm.alive) return;
        const pos = worldToRadar(tm.pos.x, tm.pos.z);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = tm.color ? '#' + tm.color.toString(16).padStart(6, '0') : '#00f0ff';
        ctx.fill();
      });

      // Enemies (red dots)
      enemies.forEach(e => {
        if (!e.alive) return;
        const pos = worldToRadar(e.pos.x, e.pos.z);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, e.type === 'mech' ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ff2d4a';
        ctx.fill();
      });

      // Player marker (center arrow)
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(R, R - 6);
      ctx.lineTo(R - 4, R + 5);
      ctx.lineTo(R + 4, R + 5);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  };
}

/* ---------- Comms / Objective / UI Handler ---------- */
export function createHud() {
  const elHealthFill = document.getElementById('health-fill');
  const elHealthText = document.getElementById('health-text');
  const elAmmo = document.getElementById('ammo');
  const elWeaponName = document.getElementById('weapon-name');
  const elReloadMsg = document.getElementById('reload-msg');
  const elOrderLabel = document.getElementById('order-label');
  const elObjTitle = document.getElementById('objective-title');
  const elObjText = document.getElementById('objective-text');
  const elComms = document.getElementById('comms');
  const elCommsText = document.getElementById('comms-text');
  const elGrenadeCount = document.getElementById('grenade-count');
  const elDamageFlash = document.getElementById('damage-flash');
  const elHitmarker = document.getElementById('hitmarker');
  const elWaveLabel = document.getElementById('wave-label');
  const elEnemyLabel = document.getElementById('enemy-label');
  const elBanner = document.getElementById('wave-banner');
  const elBannerTitle = document.getElementById('banner-title');
  const elBannerSub = document.getElementById('banner-sub');

  const WEAPON_NAMES = ['PISTOL', 'RIFLE', 'SHOTGUN'];

  let commsTimer = null;
  let bannerTimer = null;

  return {
    showComms(text, duration = 4000) {
      if (!elComms) return;
      elCommsText.textContent = text;
      elComms.classList.add('show');
      play('comms');
      if (commsTimer) clearTimeout(commsTimer);
      commsTimer = setTimeout(() => elComms.classList.remove('show'), duration);
    },

    // Big banner in the middle of the screen (e.g. "WAVE 2")
    showBanner(title, sub = '', duration = 3000) {
      if (!elBanner) return;
      if (elBannerTitle) elBannerTitle.textContent = title;
      if (elBannerSub) elBannerSub.textContent = sub;
      elBanner.classList.add('show');
      elBanner.style.display = 'block';
      elBanner.style.opacity = '1';
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        elBanner.classList.remove('show');
        elBanner.style.display = '';
        elBanner.style.opacity = '';
      }, duration);
    },

    // Top-centre box: first line = stage/wave, second line = enemies left or countdown
    setWaveInfo(line1, line2) {
      if (elWaveLabel && line1 != null) elWaveLabel.textContent = line1;
      if (elEnemyLabel && line2 != null) elEnemyLabel.textContent = line2;
    },

    setObjective(title, text) {
      if (elObjTitle) elObjTitle.textContent = title;
      if (elObjText) elObjText.textContent = text;
    },

    setOrder(orderName) {
      if (elOrderLabel) elOrderLabel.textContent = 'ORDER: ' + orderName.toUpperCase();
    },

    triggerHit(isKill = false) {
      if (!elHitmarker) return;
      elHitmarker.className = isKill ? 'show kill' : 'show';
      setTimeout(() => elHitmarker.className = '', 120);
    },

    flashDamage() {
      if (!elDamageFlash) return;
      elDamageFlash.style.opacity = '1';
      setTimeout(() => elDamageFlash.style.opacity = '0', 300);
    },

    update(player, items, squad) {
      // Health
      const hpFrac = Math.max(0, player.health / player.maxHealth);
      if (elHealthFill) {
        elHealthFill.style.width = (hpFrac * 100) + '%';
        if (hpFrac < 0.3) elHealthFill.classList.add('low');
        else elHealthFill.classList.remove('low');
      }
      if (elHealthText) elHealthText.textContent = Math.ceil(player.health) + ' HP';

      // Weapons & Ammo
      const hud = items.getHud();
      if (elAmmo) elAmmo.textContent = hud.mag + ' / ' + hud.reserve;
      if (elWeaponName) elWeaponName.textContent = WEAPON_NAMES[hud.slot] || 'WEAPON';
      if (elReloadMsg) elReloadMsg.className = hud.reloading ? 'show' : '';
      if (elGrenadeCount) elGrenadeCount.textContent = 'G: ' + hud.grenades;

      // Weapon slots active state
      for (let i = 0; i < 3; i++) {
        const slot = document.getElementById('slot' + (i + 1));
        if (slot) {
          if (i === hud.slot) slot.classList.add('active');
          else slot.classList.remove('active');
        }
      }

      // Squad Health Rows
      squad.list.forEach((tm, i) => {
        const row = document.getElementById('tm' + i);
        if (!row) return;
        const fill = row.querySelector('.team-fill');
        if (!fill) return;

        if (!tm.alive) {
          fill.style.width = '0%';
          row.className = 'team-row dead';
        } else {
          const frac = Math.max(0, tm.hp / tm.maxHp);
          fill.style.width = (frac * 100) + '%';
          row.className = frac < 0.3 ? 'team-row low' : 'team-row';
        }
      });
    }
  };
}

/* ---------- Wave Manager (used by Stage 1) ---------- */
const FIRST_BREAK = 8;        // seconds to prepare before wave 1
const BREAK_TIME = 10;        // seconds between waves
const SPAWN_GAP = 0.5;        // seconds between individual enemy spawns

export const WAVES = [
  { name: 'WARM-UP',  rifle: 4, heavy: 0, drones: 2, turrets: 0, bombers: 0, boss: false,
    line: 'Wave 1: a small patrol is coming. Use the barriers for cover.' },
  { name: 'PUSH',     rifle: 6, heavy: 1, drones: 2, turrets: 1, bombers: 0, boss: false,
    line: 'Wave 2: heavy infantry and a turret covering their advance. Flank the turret!' },
  { name: 'ASSAULT',  rifle: 6, heavy: 2, drones: 3, turrets: 0, bombers: 1, boss: false,
    line: 'Wave 3: a bomber is inbound. Do not stand still!' },
  { name: 'BOSS',     rifle: 4, heavy: 0, drones: 2, turrets: 0, bombers: 0, boss: true,
    line: 'Final wave: the war mech is here. Watch for artillery warnings!' }
];

export function createWaves(opts) {
  // opts: { enemies, getMap, getPlayer, hud, onWaveCleared(n), bossHp }
  const { enemies, hud } = opts;

  let state = 'idle';        // idle | break | active | finishing | done
  let index = 0;             // which wave comes next (0-based)
  let timer = 0;
  let queue = [];
  let spawnT = 0;
  let lastInfo = '';

  function say(line1, line2) {
    const key = line1 + '|' + line2;
    if (key === lastInfo) return;
    lastInfo = key;
    hud.setWaveInfo(line1, line2);
  }

  // A point 'minD'..'maxD' metres from the player, on the far side of the map
  function spawnPoint(minD, maxD, spread = 1.1) {
    const map = opts.getMap(), p = opts.getPlayer();
    const half = ((map && map.half) || 60) - 6;
    let bx = -p.pos.x, bz = -p.pos.z;
    const len = Math.hypot(bx, bz);
    if (len < 10) { bx = 0; bz = -1; } else { bx /= len; bz /= len; }

    let best = { x: 0, z: 0 };
    for (let tries = 0; tries < 8; tries++) {
      const a = (Math.random() - 0.5) * Math.PI * spread;
      const dx = bx * Math.cos(a) - bz * Math.sin(a);
      const dz = bx * Math.sin(a) + bz * Math.cos(a);
      const d = minD + Math.random() * (maxD - minD);
      const x = Math.max(-half, Math.min(half, p.pos.x + dx * d));
      const z = Math.max(-half, Math.min(half, p.pos.z + dz * d));
      best = { x, z };
      if (Math.hypot(x - p.pos.x, z - p.pos.z) >= 25) break;
    }
    return best;
  }

  function buildQueue(cfg) {
    const q = [];
    for (let i = 0; i < cfg.rifle; i++) q.push(() => { const s = spawnPoint(32, 55); enemies.spawnSoldier(s.x, s.z, 'rifle'); });
    for (let i = 0; i < cfg.heavy; i++) q.push(() => { const s = spawnPoint(35, 55); enemies.spawnSoldier(s.x, s.z, 'heavy'); });
    for (let i = 0; i < cfg.turrets; i++) q.push(() => { const s = spawnPoint(28, 38, 0.8); enemies.spawnTurret(s.x, s.z); });
    for (let i = 0; i < cfg.drones; i++) q.push(() => { const s = spawnPoint(25, 45, 1.4); enemies.spawnDrone(s.x, 5 + Math.random() * 2, s.z); });
    for (let i = 0; i < cfg.bombers; i++) q.push(() => { const s = spawnPoint(45, 55, 0.6); enemies.spawnBomber(s.x, 12, s.z); });
    if (cfg.boss) q.unshift(() => { const s = spawnPoint(48, 55, 0.3); enemies.spawnMech(s.x, s.z, opts.bossHp || 400, true); });
    return q;
  }

  function beginWave() {
    const cfg = WAVES[index];
    queue = buildQueue(cfg);
    spawnT = 0;
    state = 'active';
    hud.showBanner('WAVE ' + (index + 1) + ' / ' + WAVES.length, cfg.name, 3200);
    hud.showComms(cfg.line, 5500);
  }

  function aliveCount() {
    let n = 0;
    for (const e of enemies.list) if (e.alive) n++;
    return n;
  }

  return {
    start() {
      index = 0;
      queue = [];
      lastInfo = '';
      state = 'break';
      timer = FIRST_BREAK;
    },

    update(dt) {
      if (state === 'idle' || state === 'done') return;

      if (state === 'break') {
        timer -= dt;
        say('WAVE ' + (index + 1) + ' / ' + WAVES.length, 'Next wave in ' + Math.max(0, Math.ceil(timer)) + 's');
        if (timer <= 0) beginWave();
        return;
      }

      if (state === 'active') {
        // release enemies one by one
        spawnT -= dt;
        if (queue.length && spawnT <= 0) {
          spawnT = SPAWN_GAP;
          const fn = queue.shift();
          try { fn(); } catch (err) { console.warn('Spawn failed:', err); }
        }

        const alive = aliveCount();
        say('WAVE ' + (index + 1) + ' / ' + WAVES.length, 'Enemies left: ' + (alive + queue.length));

        if (!queue.length && alive === 0) {
          const finished = index >= WAVES.length - 1;
          if (finished) {
            state = 'finishing';
            timer = 2.5;
            hud.showBanner('FINAL WAVE CLEARED', 'The line holds!', 3000);
          } else {
            const cleared = index + 1;
            index++;
            state = 'break';
            timer = BREAK_TIME;
            hud.showBanner('WAVE ' + cleared + ' CLEARED', 'Resupply at camp. Next wave in ' + BREAK_TIME + 's', 3500);
            if (opts.onWaveCleared) opts.onWaveCleared(cleared);
          }
        }
        return;
      }

      if (state === 'finishing') {
        timer -= dt;
        if (timer <= 0) state = 'done';
      }
    },

    isDone() { return state === 'done'; },
    isActive() { return state !== 'idle'; },
    reset() { state = 'idle'; queue = []; index = 0; lastInfo = ''; }
  };
}

/* ---------- Objectives & Stage Manager ---------- */
export function createStageManager(scene, fx) {
  let activeObjects = [];

  function spawnGenerator(x, z, hp) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a3a5a, metalness: 0.8, roughness: 0.2, emissive: 0x00f0ff, emissiveIntensity: 0.5
    });
    const geo = new THREE.CylinderGeometry(1.4, 1.8, 3.5, 12);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 1.75, z);
    group.add(mesh);

    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.08, 8, 24), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.1, z);
    group.add(ring);

    scene.add(group);

    const obj = {
      type: 'generator',
      group, pos: new THREE.Vector3(x, 0, z),
      alive: true, hp, maxHp: hp,
      hit: { r: 1.8, y0: 0, y1: 3.5 },
      damage(dmg) {
        if (!obj.alive) return false;
        obj.hp -= dmg;
        fx.hitSpark(obj.pos.clone().setY(1.8), 0x00f0ff);
        if (obj.hp <= 0) {
          obj.alive = false;
          fx.explosion(obj.pos.clone().setY(1.5), 7, 0x00f0ff);
          scene.remove(group);
          return true;
        }
        return false;
      }
    };
    activeObjects.push(obj);
    return obj;
  }

  function spawnBeacon(x, z) {
    const group = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd84a, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8.0, 0.1, 8, 48), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.05, z);
    group.add(ring);
    scene.add(group);

    const obj = {
      type: 'beacon', group, pos: new THREE.Vector3(x, 0, z)
    };
    activeObjects.push(obj);
    return obj;
  }

  return {
    setupStage(mapDef) {
      this.clear();
      if (mapDef.points.generators) {
        mapDef.points.generators.forEach(g => spawnGenerator(g.x, g.z, g.hp));
      }
      if (mapDef.points.defend) {
        spawnBeacon(mapDef.points.defend.x, mapDef.points.defend.z);
      }
    },

    getObjectiveTargets() {
      return activeObjects.filter(o => o.alive);
    },

    checkCompletion(stageId, enemies, playerPos) {
      if (stageId === 1) {
        // Stage 1 now uses the wave manager (see main.js); this is only a fallback
        return enemies.length === 0;
      }
      if (stageId === 2) {
        return enemies.length === 0;
      }
      if (stageId === 3) {
        const gensLeft = activeObjects.filter(o => o.type === 'generator' && o.alive);
        return gensLeft.length === 0;
      }
      if (stageId === 4) {
        const exit = { x: 0, z: -50, radius: 7 };
        const d = Math.hypot(playerPos.x - exit.x, playerPos.z - exit.z);
        return d < exit.radius && enemies.length <= 2;
      }
      if (stageId === 5) {
        const bossAlive = enemies.some(e => e.isBoss && e.alive);
        return !bossAlive;
      }
      return enemies.length === 0;
    },

    clear() {
      activeObjects.forEach(o => { if (o.group) scene.remove(o.group); });
      activeObjects = [];
    }
  };
}