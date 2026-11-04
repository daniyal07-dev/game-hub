// games/war/main.js
// Main entry point for War Mode. Connects 3D rendering, player movement,
// weapons, squad AI, enemies, HUD, audio and UI overlays.
// v4: Stage 1 now runs as a wave mission (4 waves + boss) using createWaves.
//     Health refills between waves. Stages 2-5 are unchanged.
// v5: SCOPE (hold right mouse button or F) and AIM ASSIST (press V to switch on/off).
// v6: BOSS FIGHT button (unlocks after Stage 1 is cleared). Starts only the boss.

import * as THREE from 'three';
import { setupLook } from './core/look.js';
import { ensureAudio, play, setVolumes, startMusic, stopMusic, setIntensity } from './core/audio.js';
import { loadAssets } from './core/models.js';
import { createInput } from './core/input.js';
import { createEffects } from './effects.js';
import { createItems } from './items.js';
import { createDirector } from './ai.js';
import { createEnemies } from './enemies.js';
import { createSquad } from './teammates.js';
import {
  STAGE_DEFS, getUnlockedStage, unlockAllStages, saveStageStars,
  getStageStars, createRadar, createHud, createStageManager, createWaves
} from './game.js';
import { createMap } from './maps/mapkit.js';

/* ---------- Scope & Aim Assist knobs (change these numbers to tune) ---------- */
const FOV_NORMAL = 75;     // normal field of view
const FOV_SCOPE = 30;      // zoomed field of view (smaller = more zoom)
const SCOPE_KEY = 'KeyF';  // hold this key to scope (same as holding the right mouse button)
const SCOPE_MOVE = 0.6;    // walking speed while scoped (1.0 = no slowdown)
const AIM_KEY = 'KeyV';    // press to switch aim assist on/off
const AIM_CONE = 0.14;     // how close to the crosshair an enemy must be (radians, 0.14 = about 8 degrees)
const AIM_PULL = 4.0;      // how strongly the crosshair is pulled (higher = stronger)
const AIM_MAX_DIST = 90;   // metres

/* ---------- Boss Fight knobs ---------- */
const BOSS_FIGHT_HP = 600;       // boss health in the Boss Fight (the real HP is this x1.5 inside enemies.js)
const BOSS_SPAWN = { x: 0, z: -20 };   // where the boss appears (it is moved if that spot is blocked)
const BOSS_KEY = 'warBossUnlocked';    // saved in the browser (localStorage)

/* ---------- Graphics Quality presets ---------- */
const QUALITY = {
  High:   { ratio: 1.5,  bloom: true,  shadows: true  },
  Medium: { ratio: 1.0,  bloom: false, shadows: true  },
  Low:    { ratio: 0.75, bloom: false, shadows: false }
};
const QUALITY_ORDER = ['High', 'Medium', 'Low'];
let quality = 'High';
try {
  const saved = localStorage.getItem('war_quality');
  if (QUALITY[saved]) quality = saved;
} catch (e) { /* ignore */ }

let pixelRatio = Math.min(window.devicePixelRatio || 1, QUALITY[quality].ratio);

/* ---------- Scene & Renderer ---------- */
const container = document.getElementById('game-container');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV_NORMAL, window.innerWidth / window.innerHeight, 0.1, 300);
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(pixelRatio);
if (container) container.appendChild(renderer.domElement);

// Real-time soft shadows (switched off by Low quality)
renderer.shadowMap.enabled = QUALITY[quality].shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

/* ---------- Bloom (post-processing) ---------- */
let composer = null;
let bloomPass = null;
let bloomOn = QUALITY[quality].bloom;

async function initBloom() {
  try {
    const [ecMod, rpMod, ubMod, opMod] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js')
    ]);

    composer = new ecMod.EffectComposer(renderer);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(window.innerWidth, window.innerHeight);

    composer.addPass(new rpMod.RenderPass(scene, camera));

    // strength, radius, threshold
    bloomPass = new ubMod.UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.55,
      0.45,
      0.9
    );
    composer.addPass(bloomPass);

    composer.addPass(new opMod.OutputPass());
    console.log('Bloom enabled');
  } catch (err) {
    console.warn('Bloom could not load, using normal rendering:', err);
    composer = null;
  }
}
initBloom();

// Press B to turn bloom on/off
window.addEventListener('keydown', e => {
  if (e.code === 'KeyB') bloomOn = !bloomOn;
});

/* ---------- Apply a quality preset ---------- */
function applyQuality(name) {
  if (!QUALITY[name]) name = 'High';
  quality = name;
  const q = QUALITY[name];

  pixelRatio = Math.min(window.devicePixelRatio || 1, q.ratio);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) {
    composer.setPixelRatio(pixelRatio);
    composer.setSize(window.innerWidth, window.innerHeight);
  }
  if (bloomPass) bloomPass.setSize(window.innerWidth, window.innerHeight);

  bloomOn = q.bloom;

  // switching shadows on/off needs the materials to be rebuilt once
  if (renderer.shadowMap.enabled !== q.shadows) {
    renderer.shadowMap.enabled = q.shadows;
    scene.traverse(o => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => { m.needsUpdate = true; });
    });
  }

  try { localStorage.setItem('war_quality', name); } catch (e) { /* ignore */ }
  const btn = document.getElementById('quality-btn');
  if (btn) btn.textContent = name;
}

/* ---------- Shadows: mark meshes to cast / receive shadows ---------- */
function applyShadows() {
  scene.traverse(o => {
    if (!o.isMesh || o.userData._shadowDone) return;
    o.userData._shadowDone = true;

    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.isMeshBasicMaterial || m.transparent) return;

    if (o.geometry && o.geometry.type === 'PlaneGeometry') {
      o.receiveShadow = true;
      return;
    }
    o.castShadow = true;
    o.receiveShadow = true;
  });
}
let shadowTimer = 0;

/* ---------- LOAD THE 3D MODELS FIRST ---------- */
try {
  await loadAssets();
} catch (err) {
  console.warn('Model load warning:', err);
}

/* ---------- Systems ---------- */
const input = createInput(renderer.domElement);
const fx = createEffects(scene);
const director = createDirector();
const radar = createRadar(document.getElementById('radar'));
const hud = createHud();
const stageMgr = createStageManager(scene, fx);

/* ---------- Scope overlay + Aim Assist label (built from JS) ---------- */
const scopeOverlay = document.createElement('div');
scopeOverlay.style.cssText =
  'position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;display:none;' +
  'background:radial-gradient(circle at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 26%, ' +
  'rgba(0,0,0,0.55) 48%, rgba(0,0,0,0.93) 72%);';
scopeOverlay.innerHTML =
  '<div style="position:absolute;left:50%;top:50%;width:46vmin;height:2px;' +
  'transform:translate(-50%,-50%);background:rgba(0,0,0,0.65)"></div>' +
  '<div style="position:absolute;left:50%;top:50%;width:2px;height:46vmin;' +
  'transform:translate(-50%,-50%);background:rgba(0,0,0,0.65)"></div>';
document.body.appendChild(scopeOverlay);

const aimTag = document.createElement('div');
aimTag.style.cssText =
  'position:fixed;left:50%;bottom:92px;transform:translateX(-50%);pointer-events:none;z-index:4;' +
  'font:700 13px system-ui,Segoe UI,Arial,sans-serif;letter-spacing:2px;color:#fff;' +
  'text-shadow:0 1px 4px #000;opacity:0;display:none;transition:opacity 0.3s;';
document.body.appendChild(aimTag);

/* ---------- Scope + Aim Assist state ---------- */
let rightHeld = false;     // right mouse button held
let scopeAmt = 0;          // 0 = not scoped, 1 = fully scoped (smooth)
let aimAssist = false;     // OFF by default
let aimTagTimer = 0;

window.addEventListener('mousedown', e => { if (e.button === 2) rightHeld = true; });
window.addEventListener('mouseup', e => { if (e.button === 2) rightHeld = false; });
window.addEventListener('blur', () => { rightHeld = false; });
window.addEventListener('contextmenu', e => e.preventDefault());

function updateAimTag(flash) {
  aimTag.textContent = 'AIM ASSIST: ' + (aimAssist ? 'ON' : 'OFF');
  aimTag.style.opacity = flash ? '1' : (aimAssist ? '0.55' : '0');
  if (flash) {
    clearTimeout(aimTagTimer);
    aimTagTimer = setTimeout(() => updateAimTag(false), 1500);
  }
}

window.addEventListener('keydown', e => {
  if (e.code === AIM_KEY && !e.repeat && isPlaying && !isPaused) {
    aimAssist = !aimAssist;
    updateAimTag(true);
    play('click');
  }
});

/* ---------- State ---------- */
let currentStageId = 1;
let currentMap = null;
let currentLook = null;
let isPlaying = false;
let isPaused = false;
let stageTime = 0;
let totalKills = 0;
let hudTimer = 0;

// Boss Fight state
let bossMode = false;        // true while playing the Boss Fight
let bossSpawned = false;
let bossWinT = 0;            // small delay after the boss dies, before the win screen

const player = {
  pos: new THREE.Vector3(0, 0, 0),
  pitch: 0, yaw: 0,
  health: 100, maxHealth: 100,
  speed: 8, sprint: 14,
  alive: true,
  damage(dmg, fromPos) {
    if (!player.alive || !isPlaying) return;
    player.health -= dmg;
    hud.flashDamage();
    director.playerHurt(dmg);
    play('hurt');
    if (player.health <= 0) {
      player.health = 0;
      player.alive = false;
      onGameOver();
    }
  }
};

/* ---------- Forward Declarations for Callbacks ---------- */
let enemiesSys = null;
let squadSys = null;
let itemsSys = null;
let waves = null;

itemsSys = createItems({
  scene, camera, input, fx, player,
  getTargets: () => [
    ...(enemiesSys ? enemiesSys.list : []),
    ...stageMgr.getObjectiveTargets()
  ],
  getSquad: () => squadSys ? squadSys.list : [],
  hurtPlayer: (dmg, pt) => player.damage(dmg, pt),
  onHit: (ent, killed) => {
    hud.triggerHit(killed);
    if (killed) {
      totalKills++;
      director.enemyKilled();
    }
  },
  getAimTarget: () => itemsSys ? itemsSys.getAimTarget() : null
});

enemiesSys = createEnemies({
  scene, fx, director,
  items: itemsSys,
  announce: (text) => hud.showComms(text, 3000),
  getMap: () => currentMap,
  getPlayer: () => player,
  getSquad: () => squadSys ? squadSys.list : [],
  onKill: () => {
    totalKills++;
    director.enemyKilled();
  }
});

squadSys = createSquad({
  scene, fx, input,
  getMap: () => currentMap,
  getPlayer: () => player,
  getEnemies: () => enemiesSys ? enemiesSys.list : [],
  getAimTarget: () => itemsSys ? itemsSys.getAimTarget() : null,
  onOrder: (ordName) => hud.setOrder(ordName)
});

/* ---------- Wave manager (Stage 1) ---------- */
waves = createWaves({
  enemies: enemiesSys,
  getMap: () => currentMap,
  getPlayer: () => player,
  hud,
  bossHp: 450,
  onWaveCleared: (n) => {
    // Reward for clearing a wave: full health
    if (player.alive) player.health = player.maxHealth;
    // Ammo refill (only if items.js supports it - added in a later step)
    if (itemsSys && typeof itemsSys.refillAmmo === 'function') itemsSys.refillAmmo();
    hud.showComms('Wave ' + n + ' cleared. Supplies restocked.', 3500);
    play('click');
  }
});

/* ---------- Boss Fight unlock (saved in the browser) ---------- */
function isBossUnlocked() {
  try {
    if (localStorage.getItem(BOSS_KEY) === '1') return true;
  } catch (e) { /* ignore */ }
  return getUnlockedStage() >= 2;       // Stage 1 already cleared (or Unlock All was used)
}

function renderBossButton() {
  const btn = document.getElementById('boss-btn');
  const hint = document.getElementById('boss-hint');
  if (!btn) return;
  const ok = isBossUnlocked();
  btn.disabled = !ok;
  btn.classList.toggle('locked', !ok);
  btn.textContent = ok ? '☠ BOSS FIGHT' : '🔒 BOSS FIGHT';
  if (hint) hint.textContent = ok
    ? 'Face the boss with your squad. No waves, just the boss.'
    : 'Clear Stage 1 to unlock the Boss Fight';
}

function bossIsDead() {
  return bossSpawned && !enemiesSys.list.some(e => e.alive && e.isBoss);
}

/* ---------- Aim Assist: gently pulls the crosshair toward the enemy nearest to it ---------- */
function applyAimAssist(dt) {
  if (!aimAssist || !input.firing || !currentMap) return;

  const cx = player.pos.x, cy = player.pos.y, cz = player.pos.z;
  let bestOff = AIM_CONE, bestYaw = 0, bestPitch = 0, found = false;

  for (const e of enemiesSys.list) {
    if (!e.alive) continue;

    // aim at the upper body of the enemy
    const h = e.hit;
    const ay = e.pos.y + (h ? h.y0 + (h.y1 - h.y0) * 0.7 : 1);
    const dx = e.pos.x - cx, dz = e.pos.z - cz, dy = ay - cy;
    const hd = Math.hypot(dx, dz);
    if (hd < 1 || hd > AIM_MAX_DIST) continue;

    let dYaw = Math.atan2(-dx, -dz) - player.yaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));      // wrap to -PI..PI
    const dPitch = Math.atan2(dy, hd) - player.pitch;
    const off = Math.hypot(dYaw, dPitch);

    if (off >= bestOff) continue;
    if (!currentMap.hasLineOfSight(cx, cz, e.pos.x, e.pos.z)) continue;

    bestOff = off; bestYaw = dYaw; bestPitch = dPitch; found = true;
  }

  if (found) {
    const k = Math.min(1, AIM_PULL * dt);
    player.yaw += bestYaw * k;
    player.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, player.pitch + bestPitch * k));
  }
}

/* ---------- Stage Loading ---------- */
function loadStage(stageId) {
  currentStageId = stageId;
  const def = STAGE_DEFS.find(s => s.id === stageId) || STAGE_DEFS[0];

  if (currentMap) currentMap.dispose();
  if (currentLook) currentLook.remove();

  currentMap = createMap(def);
  scene.add(currentMap.group);
  currentLook = setupLook(renderer, scene, camera, def.theme, { half: currentMap.half });

  stageMgr.setupStage(def);

  player.pos.set(currentMap.playerStart.x, 1.7, currentMap.playerStart.z);
  player.pitch = 0;
  player.yaw = 0;
  player.health = player.maxHealth = 100;
  player.alive = true;

  camera.position.copy(player.pos);
  camera.rotation.set(0, player.yaw, 0);

  itemsSys.reset(currentMap);
  squadSys.reset(currentMap.squadStart);
  enemiesSys.clear();
  waves.reset();

  bossSpawned = false;
  bossWinT = 0;

  if (bossMode) {
    // BOSS FIGHT: no waves, only the boss
    enemiesSys.spawnMech(BOSS_SPAWN.x, BOSS_SPAWN.z, BOSS_FIGHT_HP, true);
    bossSpawned = true;
    if (typeof hud.setWaveInfo === 'function') hud.setWaveInfo('BOSS FIGHT', 'Destroy the boss');
  } else if (def.id === 1) {
    // Stage 1: nothing spawns now. The wave manager sends the enemies in.
    waves.start();
  } else {
    if (typeof hud.setWaveInfo === 'function') hud.setWaveInfo('', '');

    (def.groundSpawns || []).forEach(p => {
      enemiesSys.spawnSoldier(p[0], p[1], Math.random() < 0.3 ? 'heavy' : 'rifle');
      enemiesSys.spawnSoldier(p[0] + 2.5, p[1] + (Math.random() * 4), 'rifle');
      enemiesSys.spawnSoldier(p[0] - 2.5, p[1] - (Math.random() * 4), 'rifle');
    });

    (def.airSpawns || []).forEach(p => {
      enemiesSys.spawnDrone(p[0], 5 + Math.random() * 2, p[1]);
      enemiesSys.spawnDrone(p[0] + 3, 5 + Math.random() * 2, p[1] - 3);
    });

    (def.turrets || []).forEach(p => enemiesSys.spawnTurret(p[0], p[1]));
    (def.mechs || []).forEach(p => enemiesSys.spawnMech(p[0], p[1], def.id === 5 ? 600 : 250, def.id === 5));
  }

  if (bossMode) hud.setObjective('BOSS FIGHT', 'Destroy the boss');
  else hud.setObjective(def.objective, def.briefing ? def.briefing[0] : 'Clear hostiles');
  hud.setOrder('follow');

  stageTime = 0;
  totalKills = 0;
  director.reset();

  rightHeld = false;
  scopeAmt = 0;

  applyShadows();
}

/* ---------- Start & End Game Flow ---------- */
// boss = true starts the Boss Fight (Stage 1 map, only the boss)
function startStage(stageId, boss = false) {
  ensureAudio();
  bossMode = !!boss;
  loadStage(boss ? 1 : stageId);
  const realId = boss ? 1 : stageId;
  isPlaying = true;
  isPaused = false;
  document.body.classList.add('in-game');

  document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
  input.lock();
  startMusic(realId - 1);

  updateAimTag(false);

  if (boss) {
    hud.showComms('The enemy commander is here. Take him down, squad!', 5000);
  } else {
    const def = STAGE_DEFS.find(s => s.id === realId);
    if (def && def.briefing) hud.showComms(def.briefing[0], 5000);
  }
}

function onStageWin() {
  isPlaying = false;
  document.body.classList.remove('in-game');
  input.unlock();
  stopMusic();
  play('win');

  const squadSurvisors = squadSys.list.filter(t => t.alive).length;
  let stars = 1;
  if (squadSurvisors >= 2) stars++;
  if (squadSurvisors === 4 && player.health > 50) stars++;

  if (!bossMode) {
    // normal stage: save progress
    saveStageStars(currentStageId, stars);

    if (currentStageId === 1) {
      try { localStorage.setItem(BOSS_KEY, '1'); } catch (e) { /* ignore */ }   // unlock the Boss Fight
    }
    if (currentStageId < 5 && getUnlockedStage() < currentStageId + 1) {
      localStorage.setItem('warUnlockedStage', (currentStageId + 1).toString());
    }
  }

  const resTitle = document.getElementById('result-title');
  if (resTitle) resTitle.textContent = bossMode ? 'BOSS DEFEATED' : 'STAGE ' + currentStageId + ' CLEARED';

  const nextBtn = document.getElementById('next-btn');
  if (nextBtn) nextBtn.style.display = bossMode ? 'none' : '';

  const resStars = document.getElementById('result-stars');
  if (resStars) resStars.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);

  const resTime = document.getElementById('result-time');
  if (resTime) resTime.textContent = Math.floor(stageTime) + 's';

  const resKills = document.getElementById('result-kills');
  if (resKills) resKills.textContent = totalKills;

  const resSquad = document.getElementById('result-squad');
  if (resSquad) resSquad.textContent = squadSurvisors + ' / 4';

  const resScore = document.getElementById('result-score');
  if (resScore) resScore.textContent = (stars * 1000 + totalKills * 100 - Math.floor(stageTime) * 5);

  document.getElementById('result-screen')?.classList.remove('hidden');
  renderStageCards();
  renderBossButton();
}

function onGameOver() {
  isPlaying = false;
  document.body.classList.remove('in-game');
  input.unlock();
  stopMusic();
  play('lose');

  const finStage = document.getElementById('final-stage');
  if (finStage) finStage.textContent = bossMode ? 'Boss Fight' : currentStageId;

  const finKills = document.getElementById('final-kills');
  if (finKills) finKills.textContent = totalKills;

  const finScore = document.getElementById('final-score');
  if (finScore) finScore.textContent = (totalKills * 100 + Math.floor(stageTime) * 10);

  document.getElementById('gameover-screen')?.classList.remove('hidden');
}

/* ---------- Main Game Loop ---------- */
let lastT = performance.now();

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

  /* Scope: smooth zoom in/out (works even while the game is ending) */
  const wantScope = isPlaying && !isPaused && player.alive &&
    (rightHeld || input.isDown(SCOPE_KEY));
  scopeAmt += ((wantScope ? 1 : 0) - scopeAmt) * Math.min(1, dt * 12);
  if (!wantScope && scopeAmt < 0.01) scopeAmt = 0;

  const fovNow = FOV_NORMAL + (FOV_SCOPE - FOV_NORMAL) * scopeAmt;
  if (Math.abs(camera.fov - fovNow) > 0.01) {
    camera.fov = fovNow;
    camera.updateProjectionMatrix();
  }
  scopeOverlay.style.display = (isPlaying && scopeAmt > 0) ? 'block' : 'none';
  scopeOverlay.style.opacity = scopeAmt.toFixed(2);
  aimTag.style.display = isPlaying ? 'block' : 'none';

  if (isPlaying && !isPaused) {
    stageTime += dt;

    // 1. Mouse Look (turns slower while zoomed, like Call of Duty)
    const sensMul = camera.fov / FOV_NORMAL;
    const look = input.consumeLook();
    player.yaw -= look.x * sensMul;
    player.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, player.pitch - look.y * sensMul - itemsSys.takeRecoil()));

    // Aim assist (only when switched on with V, and only while firing)
    applyAimAssist(dt);

    // 2. Player Movement
    const isSprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const baseSpd = isSprint ? player.sprint : player.speed;
    const curSpd = baseSpd * (1 - (1 - SCOPE_MOVE) * scopeAmt);

    let moveX = 0, moveZ = 0;
    if (input.isDown('KeyW')) moveZ -= 1;
    if (input.isDown('KeyS')) moveZ += 1;
    if (input.isDown('KeyA')) moveX -= 1;
    if (input.isDown('KeyD')) moveX += 1;

    const moving = moveX !== 0 || moveZ !== 0;
    if (moving) {
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      moveX /= len; moveZ /= len;

      const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
      const dx = (moveX * cos + moveZ * sin) * curSpd * dt;
      const dz = (-moveX * sin + moveZ * cos) * curSpd * dt;

      currentMap.move(player.pos, dx, dz, 0.5);
    }

    camera.position.copy(player.pos);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

    if (fx.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * fx.shake * 0.12;
      camera.position.y += (Math.random() - 0.5) * fx.shake * 0.12;
    }

    itemsSys.update(dt, { moving, sprint: isSprint });
    squadSys.update(dt);
    enemiesSys.update(dt);
    if (currentStageId === 1 && !bossMode) waves.update(dt);
    fx.update(dt);
    if (currentLook) currentLook.update();

    // Twice per second, give newly spawned enemies their shadows
    shadowTimer += dt;
    if (shadowTimer > 0.5) {
      shadowTimer = 0;
      applyShadows();
    }

    let near = 0;
    const el = enemiesSys.list;
    for (let i = 0; i < el.length; i++) {
      if (el[i].pos.distanceTo(player.pos) < 25) near++;
    }
    director.update(dt, {
      healthFrac: player.health / player.maxHealth,
      enemiesNear: near
    });
    setIntensity(director.tension);

    // Radar and HUD only need ~30 updates per second
    hudTimer += dt;
    if (hudTimer > 0.033) {
      hudTimer = 0;
      radar.draw(player.pos, player.yaw, currentMap, enemiesSys.list, squadSys.list);
      hud.update(player, itemsSys, squadSys);
    }

    // Win check
    let won = false;
    if (bossMode) {
      // Boss Fight: win 1.5 s after the boss dies
      if (bossIsDead()) {
        bossWinT += dt;
        won = bossWinT > 1.5;
      }
    } else if (currentStageId === 1) {
      won = waves.isDone();                    // Stage 1 = all waves done (boss dead)
    } else {
      won = stageMgr.checkCompletion(currentStageId, enemiesSys.list, player.pos);
    }
    if (won) onStageWin();
  }

  // Draw the frame (with Bloom if it loaded and is switched on)
  if (composer && bloomOn) composer.render();
  else renderer.render(scene, camera);
}

/* ---------- UI Stage Select Cards ---------- */
function renderStageCards() {
  const container = document.getElementById('stage-list');
  if (!container) return;
  container.innerHTML = '';

  const unlocked = getUnlockedStage();

  STAGE_DEFS.forEach(def => {
    const isUnlocked = def.id <= unlocked;
    const stars = getStageStars(def.id);

    const card = document.createElement('button');
    card.className = 'stage-card' + (def.id === currentStageId ? ' selected' : '') + (!isUnlocked ? ' locked' : '');

    card.innerHTML = `
      <div class="stage-num">STAGE ${def.id}</div>
      <div class="stage-name">${def.name}</div>
      <div class="stage-desc">${def.objective}</div>
      <div class="stage-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
    `;

    if (isUnlocked) {
      card.addEventListener('click', () => {
        currentStageId = def.id;
        document.querySelectorAll('.stage-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const selLabel = document.getElementById('selected-stage');
        if (selLabel) selLabel.textContent = 'Selected: Stage ' + def.id;
        play('click');
      });
    }

    container.appendChild(card);
  });
}

/* ---------- Settings: sensitivity slider + quality button ---------- */
function syncSensSlider() {
  const sens = document.getElementById('sens');
  const val = document.getElementById('sens-val');
  const lv = input.getSensitivityLevel();
  if (sens) sens.value = lv;
  if (val) val.textContent = String(lv);
}

function setupSettingsExtras() {
  // Sensitivity: change the slider to the 1..30 scale used by input.js
  const sens = document.getElementById('sens');
  if (sens) {
    sens.min = 1;
    sens.max = 30;
    sens.step = 1;
    syncSensSlider();
    sens.addEventListener('input', e => {
      input.setSensitivityLevel(parseInt(e.target.value, 10), true);
      const val = document.getElementById('sens-val');
      if (val) val.textContent = String(input.getSensitivityLevel());
    });
  }

  // Quality: add a new row to the Settings panel
  const panel = document.querySelector('#settings-screen .panel');
  const btnRow = panel ? panel.querySelector('.btn-row') : null;
  if (panel && btnRow && !document.getElementById('quality-btn')) {
    const row = document.createElement('div');
    row.className = 'setting-row';
    row.innerHTML = '<label>Graphics Quality</label>' +
      '<button id="quality-btn" class="btn ghost" type="button"></button><span></span>';
    panel.insertBefore(row, btnRow);
    const qbtn = row.querySelector('#quality-btn');
    qbtn.textContent = quality;
    qbtn.addEventListener('click', () => {
      const next = QUALITY_ORDER[(QUALITY_ORDER.indexOf(quality) + 1) % QUALITY_ORDER.length];
      applyQuality(next);
      play('click');
    });
  }

  // Reset button
  document.getElementById('reset-settings-btn')?.addEventListener('click', () => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      const lab = document.getElementById(id + '-val');
      if (el) el.value = v;
      if (lab) lab.textContent = v + '%';
    };
    set('vol-master', 80); set('vol-sfx', 80); set('vol-music', 50);
    setVolumes({ master: 0.8, sfx: 0.8, music: 0.5 });
    input.setSensitivityLevel(10, true);
    syncSensSlider();
    play('click');
  });
}

/* ---------- UI Event Binding ---------- */
function setupUI() {
  renderStageCards();
  renderBossButton();

  document.getElementById('play-btn')?.addEventListener('click', () => startStage(currentStageId, false));

  document.getElementById('boss-btn')?.addEventListener('click', () => {
    if (!isBossUnlocked()) return;
    startStage(1, true);
  });

  document.getElementById('unlock-btn')?.addEventListener('click', () => {
    unlockAllStages();
    renderStageCards();
    renderBossButton();
    play('click');
  });

  input.onLockChange(isLocked => {
    if (isPlaying) {
      isPaused = !isLocked;
      const pauseScr = document.getElementById('pause-screen');
      if (isPaused) { pauseScr?.classList.remove('hidden'); rightHeld = false; }
      else pauseScr?.classList.add('hidden');
    }
  });

  document.getElementById('resume-btn')?.addEventListener('click', () => input.lock());
  // Try Again / Replay keep the current mode (normal stage or Boss Fight)
  document.getElementById('restart-btn')?.addEventListener('click', () => startStage(currentStageId, bossMode));
  document.getElementById('quit-btn')?.addEventListener('click', () => {
    isPlaying = false;
    document.body.classList.remove('in-game');
    document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
    document.getElementById('start-screen')?.classList.remove('hidden');
    stopMusic();
  });

  document.getElementById('next-btn')?.addEventListener('click', () => {
    document.getElementById('result-screen')?.classList.add('hidden');
    startStage(Math.min(5, currentStageId + 1), false);
  });
  document.getElementById('retry-btn')?.addEventListener('click', () => {
    document.getElementById('result-screen')?.classList.add('hidden');
    startStage(currentStageId, bossMode);
  });
  document.getElementById('result-menu-btn')?.addEventListener('click', () => {
    document.getElementById('result-screen')?.classList.add('hidden');
    document.getElementById('start-screen')?.classList.remove('hidden');
    renderBossButton();
  });
  document.getElementById('menu-btn')?.addEventListener('click', () => {
    document.getElementById('gameover-screen')?.classList.add('hidden');
    document.getElementById('start-screen')?.classList.remove('hidden');
    renderBossButton();
  });

  const bindVal = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', e => {
      const valSpan = document.getElementById(id + '-val');
      if (valSpan) valSpan.textContent = e.target.value + '%';
      fn(parseFloat(e.target.value));
    });
  };

  bindVal('vol-master', v => setVolumes({ master: v / 100 }));
  bindVal('vol-sfx', v => setVolumes({ sfx: v / 100 }));
  bindVal('vol-music', v => setVolumes({ music: v / 100 }));

  setupSettingsExtras();

  const settingsScr = document.getElementById('settings-screen');
  const openSettings = () => { syncSensSlider(); settingsScr?.classList.remove('hidden'); };
  document.getElementById('start-settings-btn')?.addEventListener('click', openSettings);
  document.getElementById('pause-settings-btn')?.addEventListener('click', openSettings);
  document.getElementById('settings-back-btn')?.addEventListener('click', () => settingsScr?.classList.add('hidden'));
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  if (bloomPass) bloomPass.setSize(window.innerWidth, window.innerHeight);
});

setupUI();
requestAnimationFrame(tick);