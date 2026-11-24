// games/campaign/main.js
// Campaign Mode: Roads, Military Base, Airfield, Port Town, & Nature.
// - Named buildings, gates and fences (built by structures.js from layout.js)
// - HUD shows the name of the building / gate you are near
// - Instanced trees & rocks (60 FPS optimized)
// - WASD walking, Shift sprint, Space jump, F fly mode (all keys can be changed: keybinds.js)
// - Collision with buildings/fences/pier rails (collision.js), B shows red outlines
// - The pier deck is walkable (groundHeight / onPier from collision.js)
// - Human characters (characters.js): H spawns a test squad 7 m ahead
// - Soldiers (units.js + pathfinding.js): G spawn 4, T remove all,
//   1 follow, 2 hold, 3 go to the town square, P print info
// - Soldiers use the SWAT's built-in pistol (weapons.js v4)
// - Training (training.js): walk to a Barracks door, press E, then 1 / 2 / 3 to train




import * as THREE from 'three';
import { createTerrain, heightAt, zoneAt, ZONES, SPAWN, WORLD } from './terrain.js';
import { createNature } from './nature.js';
import { createStructures } from './structures.js';
import { labelAt } from './layout.js';
import { resolve as resolveCollision, createCollisionDebug, groundHeight, onPier } from './collision.js';
import { loadCharacters, updateCharacters, toggleDebugSquad } from './characters.js';
import { spawnSquad, updateUnits, setOrder, clearUnits, getSoldiers, unitsInfo } from './units.js';
import { matches, isDown } from './keybinds.js';
import { initTraining, updateTraining, handleTrainingKey, trainingInfo } from './training.js';   // NEW
import './weapons.js';




/* ---------- Knobs (change these numbers to tune) ---------- */
const EYE = 1.7;              // eye height above ground (m)
const WALK = 5.0;             // walking speed (m/s)
const SPRINT = 9.0;           // sprinting speed
const JUMP = 7.5;             // jump power
const GRAVITY = 22;
const FLY_SPEED = 40;         // fly mode speed
const FLY_FAST = 120;         // fly mode with sprint key
const MOUSE_SENS = 0.0022;
const WATER_BLOCK = -1.4;     // cannot walk into deep water
const QUALITY_KEY = 'campaign_quality';
const LABEL_MAX_ALT = 40;     // in fly mode, hide building names above this altitude
const PLAYER_R = 0.45;        // body radius for collision (m)
const STEP_UP = 12;           // how fast you climb a step, e.g. onto the pier (m/s)
const TOWN_SQUARE = { x: 120, z: 80 };   // where the "go to town" key sends the soldiers




const QUALITY = {
  low:    { ratio: 0.75, fogFar: 520 },
  medium: { ratio: 1.0,  fogFar: 850 },
  high:   { ratio: Math.min(window.devicePixelRatio || 1, 1.5), fogFar: 1250 }
};
const ORDER = ['low', 'medium', 'high'];




const $ = (id) => document.getElementById(id);
const loadingEl = $('loading');




try {
  start();
} catch (err) {
  console.error(err);
  loadingEl.textContent = 'Error: ' + err.message;
}




function start() {
  /* ---------- Renderer, scene, camera ---------- */
  const container = $('game-container');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;




  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2500);
  camera.rotation.order = 'YXZ';
  scene.add(camera);




  const HORIZON = new THREE.Color(0xbfd9ec);
  const TOP = new THREE.Color(0x2f7fd1);
  scene.background = HORIZON.clone();
  scene.fog = new THREE.Fog(HORIZON.clone(), 60, 850);




  /* ---------- Sun and light ---------- */
  const sunDir = new THREE.Vector3(-0.5, 0.7, -0.45).normalize();
  const sun = new THREE.DirectionalLight(0xfff6e5, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 600;
  const d = 250;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.0003;
  scene.add(sun, sun.target);




  // Balanced hemisphere & ambient light to prevent pitch-black shadows
  const hemi = new THREE.HemisphereLight(0xdbeeff, 0x6e7855, 1.1);
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(hemi, ambient);




  /* ---------- Sky dome ---------- */
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: TOP }, uHorizon: { value: HORIZON }, uSun: { value: sunDir }
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
        float s = max(dot(normalize(vDir), normalize(uSun)), 0.0);
        col += vec3(1.0, 0.9, 0.7) * (pow(s, 900.0) * 3.0 + pow(s, 14.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);




  /* ---------- Quality & World Building ---------- */
  let quality = localStorage.getItem(QUALITY_KEY);
  if (!QUALITY[quality]) quality = 'medium';
  let terrain = null;
  let structures = null;
  const natureGroup = new THREE.Group();
  scene.add(natureGroup);




  function buildWorld() {
    if (terrain) {
      scene.remove(terrain.mesh, terrain.water);
      terrain.mesh.geometry.dispose();
      terrain.mesh.material.dispose();
      terrain.water.geometry.dispose();
      terrain.water.material.dispose();
    }
    terrain = createTerrain(quality);
    scene.add(terrain.mesh, terrain.water);




    // Rebuild nature (trees & rocks)
    natureGroup.clear();
    createNature(natureGroup, quality);




    // Build roads, base, airfield and town once
    if (!structures) {
      structures = createStructures(scene);
    }
  }




  function applyQuality() {
    const q = QUALITY[quality];
    renderer.setPixelRatio(q.ratio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    scene.fog.far = q.fogFar;
    $('quality-btn').textContent = 'Quality: ' + quality.charAt(0).toUpperCase() + quality.slice(1);
  }




  buildWorld();
  applyQuality();




  const colDebug = createCollisionDebug(scene);




  /* ---------- Human characters ---------- */
  let charsReady = false;
  loadCharacters()
    .then(() => {
      charsReady = true;
      console.log('[characters] ready. Squad keys: see Controls on the start screen');
    })
    .catch((err) => {
      console.error('[characters] failed to load', err);
    });




  /* ---------- Training (Barracks) ---------- */
  initTraining(scene, () => charsReady);                                               // NEW




  /* ---------- Player ---------- */
  const player = {
    x: SPAWN.x, z: SPAWN.z, y: groundHeight(SPAWN.x, SPAWN.z) + EYE,
    vx: 0, vz: 0, vy: 0, yaw: Math.PI, pitch: 0, grounded: true, fly: false
  };
  {
    const s = resolveCollision(player.x, player.z, PLAYER_R);
    player.x = s.x; player.z = s.z;
    player.y = groundHeight(player.x, player.z) + EYE;
  }
  const keys = {};
  let playing = false;
  let firstPlay = true;




  /* ---------- Input (keys come from keybinds.js) ---------- */
  window.addEventListener('keydown', (e) => {
    if (!playing) return;
    keys[e.code] = true;
    if (e.code === 'Space' || matches('jump', e.code)) e.preventDefault();
    if (e.repeat) return;


    // Barracks: Use key opens the menu, 1 / 2 / 3 train while it is open
    if (handleTrainingKey(e.code, player)) return;                                     // NEW


    if (matches('fly', e.code)) {
      player.fly = !player.fly;
      player.vy = 0;
    }
    if (matches('debug', e.code)) {
      const on = colDebug.toggle();
      console.log('[collision] debug outlines ' + (on ? 'ON' : 'OFF'));
    }
    if (matches('testsquad', e.code)) {              // test squad (animation check)
      if (!charsReady) {
        console.log('[characters] still loading, try again in a moment');
      } else {
        const res = toggleDebugSquad(scene, player.x, player.z, player.yaw);
        console.log('[characters] test squad:', res);
      }
    }


    // soldier keys
    if (matches('spawn', e.code)) {
      if (!charsReady) console.log('[units] characters still loading, try again in a moment');
      else spawnSquad(scene, player.x, player.z, player.yaw, 4);
    }
    if (matches('clear', e.code)) clearUnits(scene);
    if (matches('follow', e.code)) setOrder('follow');
    if (matches('hold', e.code)) setOrder('hold');
    if (matches('attack', e.code)) setOrder('go', TOWN_SQUARE.x, TOWN_SQUARE.z);
    if (matches('info', e.code)) console.log('[units] ' + unitsInfo() + ' | [training] ' + trainingInfo());
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });




  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
    player.yaw -= e.movementX * MOUSE_SENS;
    player.pitch -= e.movementY * MOUSE_SENS;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
  });




  /* ---------- Menus & UI ---------- */
  const startScreen = $('start-screen'), hud = $('hud'), cross = $('crosshair');




  function lockPointer() {
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  }




  document.addEventListener('pointerlockchange', () => {
    playing = document.pointerLockElement === canvas;
    startScreen.classList.toggle('hidden', playing);
    hud.classList.toggle('hidden', !playing);
    cross.classList.toggle('hidden', !playing);
    if (!playing) for (const k in keys) keys[k] = false;
    else firstPlay = false;
    $('play-btn').textContent = firstPlay ? '▶ ENTER ISLAND' : '▶ RESUME';
  });




  $('play-btn').addEventListener('click', lockPointer);




  $('quality-btn').addEventListener('click', () => {
    quality = ORDER[(ORDER.indexOf(quality) + 1) % ORDER.length];
    localStorage.setItem(QUALITY_KEY, quality);
    $('quality-btn').textContent = 'Building...';
    setTimeout(() => { buildWorld(); applyQuality(); }, 30);
  });




  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    $('touch-note').classList.remove('hidden');
    $('play-btn').classList.add('hidden');
  }




  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });




  /* ---------- Movement Simulation ---------- */
  const HALF = WORLD.size / 2 - 5;




  // Can you stand here? Land above deep water, or the pier deck.
  const walkable = (x, z) => heightAt(x, z) > WATER_BLOCK || onPier(x, z);




  function update(dt) {
    const fwd = (isDown(keys, 'forward') ? 1 : 0) - (isDown(keys, 'back') ? 1 : 0);
    const side = (isDown(keys, 'right') ? 1 : 0) - (isDown(keys, 'left') ? 1 : 0);
    const sprinting = isDown(keys, 'sprint');
    const jumping = isDown(keys, 'jump');
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);




    if (player.fly) {
      const sp = sprinting ? FLY_FAST : FLY_SPEED;
      const cp = Math.cos(player.pitch), sp2 = Math.sin(player.pitch);
      const dx = -sin * cp * fwd + cos * side;
      const dz = -cos * cp * fwd - sin * side;
      const dy = sp2 * fwd + (jumping ? 1 : 0) - (isDown(keys, 'descend') ? 1 : 0);
      player.x += dx * sp * dt;
      player.z += dz * sp * dt;
      player.y += dy * sp * dt;
      player.vx = player.vz = player.vy = 0;
      const minY = Math.max(groundHeight(player.x, player.z), 0) + 1;
      if (player.y < minY) player.y = minY;
    } else {
      const speed = sprinting ? SPRINT : WALK;
      let tx = -sin * fwd + cos * side;
      let tz = -cos * fwd - sin * side;
      const len = Math.hypot(tx, tz);
      if (len > 0) { tx = tx / len * speed; tz = tz / len * speed; }
      const k = Math.min(1, 10 * dt);
      player.vx += (tx - player.vx) * k;
      player.vz += (tz - player.vz) * k;




      const nx = player.x + player.vx * dt, nz = player.z + player.vz * dt;
      let px = player.x, pz = player.z;
      if (walkable(nx, nz)) { px = nx; pz = nz; }
      else if (walkable(nx, player.z)) px = nx;
      else if (walkable(player.x, nz)) pz = nz;
      const fixed = resolveCollision(px, pz, PLAYER_R);
      player.x = fixed.x; player.z = fixed.z;




      if (jumping && player.grounded) { player.vy = JUMP; player.grounded = false; }
      player.vy -= GRAVITY * dt;
      player.y += player.vy * dt;
      const ground = groundHeight(player.x, player.z) + EYE;
      if (player.y <= ground || (player.grounded && player.vy <= 0 && player.y - ground < 0.5)) {
        if (player.grounded && ground - player.y > 0.02) {
          // stepping up (onto the pier): climb smoothly instead of snapping
          player.y = Math.min(ground, player.y + STEP_UP * dt);
        } else {
          player.y = ground;
        }
        player.vy = 0; player.grounded = true;
      } else {
        player.grounded = false;
      }
    }




    player.x = Math.max(-HALF, Math.min(HALF, player.x));
    player.z = Math.max(-HALF, Math.min(HALF, player.z));
  }




  /* ---------- HUD text (zone + nearby building / gate name) ---------- */
  const infoEl = $('hud-info'), modeEl = $('hud-mode');




  function updateModeText() {
    let text = zoneAt(player.x, player.z);
    const lowEnough = !player.fly || (player.y - EYE) < LABEL_MAX_ALT;
    if (lowEnough) {
      const l = labelAt(player.x, player.z);
      if (l && l.name) text += '  ·  ' + l.name;
    }
    if (player.fly) text += '  ·  FLY MODE';
    const n = getSoldiers().length;                  // soldier count on the HUD
    if (n) text += '  ·  SQUAD ' + n;
    modeEl.textContent = text;
  }




  /* ---------- Main Loop ---------- */
  const clock = new THREE.Clock();
  let fpsTimer = 0, fpsFrames = 0, time = 0, hudTimer = 0;




  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;




    if (playing) update(dt);
    updateTraining(dt, player, playing);             // supplies, queues, on-screen menu (NEW)
    if (charsReady) {                                // units first, then animation
      updateUnits(dt, player);
      updateCharacters(dt);
    }




    camera.position.set(player.x, player.y, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    sky.position.copy(camera.position);
    sun.position.set(player.x + sunDir.x * 200, player.y + sunDir.y * 200, player.z + sunDir.z * 200);
    sun.target.position.set(player.x, player.y, player.z);
    terrain.update(time);
    if (structures && structures.update) structures.update(dt);




    renderer.render(scene, camera);




    if (playing) {
      hudTimer += dt;
      if (hudTimer >= 0.2) {
        hudTimer = 0;
        updateModeText();
      }
    }




    fpsFrames++; fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      const fps = Math.round(fpsFrames / fpsTimer);
      fpsFrames = 0; fpsTimer = 0;
      if (playing) {
        infoEl.textContent = 'FPS ' + fps + '  ·  X ' + Math.round(player.x) + '  Z ' + Math.round(player.z) +
          '  ·  ALT ' + Math.round(player.y - EYE);
      }
    }
  }




  // Done
  loadingEl.classList.add('hidden');
  startScreen.classList.remove('hidden');
  frame();
  console.log('✅ Campaign ready');
}