import * as THREE from 'three';
import './arena_realism.js';
/* =====================================================
   1. CONSTANTS + SETTINGS
   ===================================================== */
const LIMIT = 55;                 // arena half-size
const WALK_SPEED = 8;
const SPRINT_SPEED = 14;
const MAG_SIZE = 30;
const RELOAD_TIME = 1.5;
const FIRE_DELAY = 0.15;
const PILLAR_R = 1.5;
const PILLAR_H = 10;
const PILLAR_RING = 18;
const DRONE_HP = 3;
const ENEMY_DMG = 10;
const BASE_SENS = 0.0022;

/* ---------- WAR MODE FEATURES (scope, aim assist, keys, quality) ---------- */
const FOV_NORMAL = 75;            // normal field of view
const FOV_SCOPE = 30;             // zoomed-in field of view
const SCOPE_KEY = 'KeyF';         // hold F (or right mouse button) to zoom
const SCOPE_MOVE = 0.6;           // walking speed while scoped (0.6 = 60%)
const AIM_KEY = 'KeyV';           // V turns aim assist on / off
const AIM_CONE = 0.14;            // how close to a drone the crosshair must be (radians)
const AIM_PULL = 4.0;             // how strongly aim assist pulls toward the drone
const AIM_MAX_DIST = 90;          // aim assist only works within this distance
const KEY_TURN_SPEED = 2.0;       // arrow-key turning speed
const QUALITY = { High: 2, Medium: 1, Low: 0.75 };   // pixel ratio of each graphics preset

/* ---------- 3D MODEL SETTINGS (easy to tweak) ---------- */
const MODEL_DRONE_URL = '../models/drone.glb';
const MODEL_GUN_URL = '../models/gun.glb';
const DRONE_SIZE = 2.2;           // drone model is resized so its biggest side = this
const GUN_SIZE = 0.6;             // gun model is resized so its biggest side = this
const DRONE_YAW_FIX = 0;          // turn the drone model: 0, Math.PI (180°), Math.PI / 2 ...
const GUN_FLIP = false;           // set to true if the gun points BACKWARDS
const DRONE_RING = true;          // true = spinning HP ring around the drone model, false = no ring

/* ---------- SCENERY SETTINGS (decoration only) ---------- */
const SHOW_PROPS = true;          // false = no props around the walls
const PROP_URLS = ['../models/props/prop1.glb', '../models/props/prop2.glb'];
const PROP_SIZES = [3.2, 5];      // biggest side of each prop (prop1, prop2)
const PROP_EDGE = 58.5;           // distance from the centre (just outside the wall)
const SHOW_CRATERS = true;        // false = no craters on the floor
const CRATER_URL = '../models/crater.glb';
const CRATER_SIZE = 9;

/* ---------- LOOK / COLOUR SETTINGS (easy to tweak) ---------- */
const EXPOSURE = 1.15;            // overall brightness: 0.9 = darker, 1.5 = brighter
const FOG_COLOR = 0x4a1670;       // colour the far distance fades into
const GUN_EDGES = true;           // true = thin neon outline on the gun / props, false = off

// How each 3D model is colour-graded (the textures stay, lighting + tint improve)
// bright = brightness multiplier, tint = colour multiplied on top,
// metal = max metalness, rough = min roughness, env = reflection strength,
// emissive / emissiveI = soft self-glow that lifts pure black, edge = outline colour
const STYLE_DRONE = { bright: 1.3, metal: 0.5, rough: 0.35, env: 1.2, emissive: 0x102040, emissiveI: 0.5 };
const STYLE_GUN = { bright: 1.5, metal: 0.45, rough: 0.4, env: 1.3, emissive: 0x0a3040, emissiveI: 0.5, edge: 0x00f0ff };
const STYLE_PROP = { tint: 0xb0a0ff, bright: 1.2, metal: 0.4, rough: 0.5, env: 1.2, emissive: 0x3a0a60, emissiveI: 0.6, edge: 0xff2d95 };
const STYLE_CRATER = { tint: 0x9090b0, bright: 1.0, metal: 0.2, rough: 0.8, env: 0.6, emissive: 0x601810, emissiveI: 0.5 };

const DEFAULT_SETTINGS = { master: 0.8, sfx: 0.8, music: 0.5, sensLevel: 10 };
let settings = loadSettings();

function loadSettings() {
  let s;
  try {
    const saved = JSON.parse(localStorage.getItem('arenaSettings'));
    s = Object.assign({}, DEFAULT_SETTINGS, saved);
  } catch (e) {
    s = Object.assign({}, DEFAULT_SETTINGS);
  }
  s.sensLevel = Math.max(1, Math.min(30, Math.round(Number(s.sensLevel) || 10)));
  return s;
}
function saveSettings() {
  localStorage.setItem('arenaSettings', JSON.stringify(settings));
}

const $ = (id) => document.getElementById(id);

/* =====================================================
   2. GAME STATE
   ===================================================== */
let gameState = 'idle';          // 'idle' | 'running' | 'over'
let pointerLocked = false;

let score = 0;
let health = 100;
let ammo = MAG_SIZE;
let reloading = false;
let reloadTimer = 0;
let fireCooldown = 0;
let best = parseInt(localStorage.getItem('arenaBest') || '0', 10);

let wave = 0;
let waveActive = false;
let squadsPlan = [];
let squadTimer = 0;
let squadsSpawned = 0;
let nextWaveTimer = 0;

let yaw = 0;
let pitch = 0;

const keys = {};
let mouseHeld = false;
let fireQueued = false;
let fireQueueTime = 0;

let rightHeld = false;           // right mouse button (scope)
let scopeAmt = 0;                // 0 = normal view, 1 = fully zoomed (smoothed)
let aimAssist = false;           // aim assist is OFF by default

const drones = [];
const enemyBullets = [];
const particles = [];
const tracers = [];

function setState(s) {
  gameState = s;
  document.body.classList.toggle('in-game', s === 'running');
}
function isPlaying() { return gameState === 'running' && pointerLocked; }
function isPaused() { return gameState === 'running' && !pointerLocked; }

/* =====================================================
   3. SCENE, CAMERA, RENDERER
   ===================================================== */
const container = $('game-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a0f50);
scene.fog = new THREE.Fog(FOG_COLOR, 50, 160);

const camera = new THREE.PerspectiveCamera(FOV_NORMAL, window.innerWidth / window.innerHeight, 0.1, 300);
camera.rotation.order = 'YXZ';
camera.position.set(0, 1.7, 30);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;       // cinematic colours
renderer.toneMappingExposure = EXPOSURE;
container.appendChild(renderer.domElement);
const canvas = renderer.domElement;

// graphics quality preset (High / Medium / Low) = sharpness of the picture
let quality = (() => {
  const q = localStorage.getItem('arena_quality');
  return QUALITY[q] !== undefined ? q : 'High';
})();
function applyQuality() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[quality]));
  renderer.setSize(window.innerWidth, window.innerHeight);
}
applyQuality();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* =====================================================
   3b. SKY, STARS + NEON REFLECTION ENVIRONMENT
   ===================================================== */
// Sky gradient: deep indigo at the top, glowing magenta-purple at the horizon
const SKY_TOP = new THREE.Color(0x060320);
const SKY_MID = new THREE.Color(0x2c1068);
const SKY_HOR = new THREE.Color(0x7a2090);
const SKY_LOW = new THREE.Color(0x0a0420);

function skyColor(t, out) {                      // t = height from -1 (down) to 1 (up)
  if (t < 0) return out.copy(SKY_HOR).lerp(SKY_LOW, Math.min(1, -t * 25));
  if (t < 0.12) return out.copy(SKY_HOR).lerp(SKY_MID, t / 0.12);
  return out.copy(SKY_MID).lerp(SKY_TOP, Math.min(1, (t - 0.12) / 0.6));
}

(function buildSky() {
  const R = 200;
  const geo = new THREE.SphereGeometry(R, 48, 64);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    skyColor(pos.getY(i) / R, tmp);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false
  }));
  sky.renderOrder = -10;
  scene.add(sky);

  // stars
  const n = 350;
  const sp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const h = 0.12 + Math.random() * 0.88;       // only in the upper sky
    const r = Math.sqrt(1 - h * h);
    sp[i * 3] = Math.cos(a) * r * 190;
    sp[i * 3 + 1] = h * 190;
    sp[i * 3 + 2] = Math.sin(a) * r * 190;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 1.8, sizeAttenuation: false, fog: false, toneMapped: false, transparent: true, opacity: 0.8
  }));
  scene.add(stars);
})();

// Neon "studio" used only for reflections: metal now reflects cyan, pink and purple instead of black
(function buildEnvironment() {
  const envScene = new THREE.Scene();
  const R = 50;
  const geo = new THREE.SphereGeometry(R, 32, 24);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x3a2aa0);
  const hor = new THREE.Color(0xff3aa0);
  const bot = new THREE.Color(0x22104a);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / R;
    if (t >= 0) tmp.copy(hor).lerp(top, Math.pow(t, 0.5));
    else tmp.copy(hor).lerp(bot, Math.min(1, -t * 2));
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  // bright coloured light panels (these become the reflections)
  const panel = (color, strength, x, y, z, w, h) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide })
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  panel(0x00f0ff, 4, -30, 15, -10, 30, 12);      // cyan
  panel(0xff2d95, 4, 30, 10, 10, 30, 12);        // pink
  panel(0xcfd8ff, 2.5, 0, 40, 0, 40, 40);        // cool white from above
  panel(0x7b2ff7, 2.5, 0, 10, 35, 30, 14);       // purple from behind

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  console.log('✅ Neon environment ready');
})();

/* =====================================================
   4. LIGHTS
   ===================================================== */
scene.add(new THREE.AmbientLight(0x6a6aaa, 0.9));
scene.add(new THREE.HemisphereLight(0x9a9aff, 0x3a1060, 1.0));

const sunLight = new THREE.DirectionalLight(0xdde6ff, 2.2);   // cool white main light
sunLight.position.set(25, 45, 20);
scene.add(sunLight);

const cornerLights = [
  [0x00f0ff, -35, -30],     // cyan
  [0xff2d95, 35, 30],       // pink
  [0x7b2ff7, 35, -30],      // purple
  [0x3a7bff, -35, 30]       // electric blue
];
for (const c of cornerLights) {
  const l = new THREE.PointLight(c[0], 500, 120);
  l.position.set(c[1], 12, c[2]);
  scene.add(l);
}
const coreLight = new THREE.PointLight(0xff2d95, 300, 50);
coreLight.position.set(0, 6, 0);
scene.add(coreLight);

// small light that travels with the camera so the gun is always visible
const gunLight = new THREE.PointLight(0xbfd8ff, 1.2, 4);
gunLight.position.set(0.1, 0.25, 0.3);
camera.add(gunLight);

/* =====================================================
   5. ARENA: floor, walls, core, pillars
   ===================================================== */
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(LIMIT * 2 + 10, LIMIT * 2 + 10),
  new THREE.MeshStandardMaterial({ color: 0x14183a, metalness: 0.5, roughness: 0.35, envMapIntensity: 0.6 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const grid = new THREE.GridHelper(LIMIT * 2 + 10, 55, 0x00f0ff, 0x4a3ac0);
grid.position.y = 0.02;
scene.add(grid);

// glowing wall frame: pink top edge, cyan floor edge, purple corner posts
(function buildWalls() {
  const L = LIMIT + 2;
  const H = 14;
  const box = (color, x, y, z, w, h, d) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ color, toneMapped: false })
    );
    m.position.set(x, y, z);
    scene.add(m);
  };
  const frame = (y, color, th) => {
    const len = L * 2 + th;
    box(color, 0, y, -L, len, th, th);
    box(color, 0, y, L, len, th, th);
    box(color, -L, y, 0, th, th, len);
    box(color, L, y, 0, th, th, len);
  };
  frame(H, 0xff2d95, 0.3);
  frame(0.12, 0x00f0ff, 0.25);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0x9b5cff, sx * L, H / 2, sz * L, 0.3, H, 0.3);

  // soft purple energy field: bright at the bottom, fading out toward the top
  const wallGeo = new THREE.PlaneGeometry(L * 2, H);
  const wp = wallGeo.attributes.position;
  const wc = new Float32Array(wp.count * 3);
  const bottom = new THREE.Color(0xa060ff);
  for (let i = 0; i < wp.count; i++) {
    const k = wp.getY(i) > 0 ? 0 : 1;            // top = black (invisible), bottom = purple
    wc[i * 3] = bottom.r * k;
    wc[i * 3 + 1] = bottom.g * k;
    wc[i * 3 + 2] = bottom.b * k;
  }
  wallGeo.setAttribute('color', new THREE.BufferAttribute(wc, 3));
  const wallMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, depthWrite: false, fog: false, toneMapped: false
  });
  const walls = [[0, -L, 0], [0, L, 0], [-L, 0, Math.PI / 2], [L, 0, Math.PI / 2]];
  for (const w of walls) {
    const m = new THREE.Mesh(wallGeo, wallMat);
    m.position.set(w[0], H / 2, w[1]);
    m.rotation.y = w[2];
    scene.add(m);
  }
})();

const core = new THREE.Mesh(
  new THREE.IcosahedronGeometry(3, 1),
  new THREE.MeshBasicMaterial({ color: 0xff2d95, wireframe: true, toneMapped: false })
);
core.position.set(0, 6, 0);
scene.add(core);

const coreInner = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.6, 0),
  new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true, toneMapped: false })
);
coreInner.position.set(0, 6, 0);
scene.add(coreInner);

const pillars = [];
const pillarMeshes = [];
const pillarGeo = new THREE.CylinderGeometry(PILLAR_R, PILLAR_R, PILLAR_H, 16);
const pillarMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a4a, emissive: 0x3a1a9a, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.35, envMapIntensity: 1.0
});
const pillarGlowGeo = new THREE.TorusGeometry(PILLAR_R + 0.05, 0.09, 8, 24);
const pillarGlowMats = [
  new THREE.MeshBasicMaterial({ color: 0x00f0ff, toneMapped: false }),   // bottom ring: cyan
  new THREE.MeshBasicMaterial({ color: 0xff2d95, toneMapped: false })    // top ring: pink
];
for (let k = 0; k < 8; k++) {
  const a = (k / 8) * Math.PI * 2;
  const x = Math.cos(a) * PILLAR_RING;
  const z = Math.sin(a) * PILLAR_RING;
  const m = new THREE.Mesh(pillarGeo, pillarMat);
  m.position.set(x, PILLAR_H / 2, z);
  scene.add(m);
  [1, PILLAR_H - 1].forEach((yy, idx) => {
    const ring = new THREE.Mesh(pillarGlowGeo, pillarGlowMats[idx]);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, yy, z);
    scene.add(ring);
  });
  pillars.push({ x, z });
  pillarMeshes.push(m);
}

/* =====================================================
   6. GUN (built-in shapes; replaced by gun.glb if it loads)
   ===================================================== */
const gun = new THREE.Group();
const gunMat = new THREE.MeshStandardMaterial({ color: 0x2a3550, metalness: 0.8, roughness: 0.35 });
const gunGlow = new THREE.MeshBasicMaterial({ color: 0x00f0ff, toneMapped: false });

const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.5), gunMat);
const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.4), gunMat);
gunBarrel.position.set(0, 0.03, -0.4);
const gunStrip = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.02, 0.3), gunGlow);
gunStrip.position.set(0, 0.075, -0.05);
const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), gunMat);
gunGrip.position.set(0, -0.15, 0.15);
gunGrip.rotation.x = 0.2;
gun.add(gunBody, gunBarrel, gunStrip, gunGrip);

const muzzle = new THREE.Object3D();
muzzle.position.set(0, 0.03, -0.62);
gun.add(muzzle);

const muzzleFlash = new THREE.Mesh(
  new THREE.SphereGeometry(0.08, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xaaffff, toneMapped: false })
);
muzzleFlash.position.copy(muzzle.position);
muzzleFlash.visible = false;
gun.add(muzzleFlash);

const GUN_REST = new THREE.Vector3(0.3, -0.28, -0.55);
gun.position.copy(GUN_REST);
camera.add(gun);

let gunKick = 0;
let flashTimer = 0;

/* =====================================================
   6b. 3D MODELS (loaded from the models folder, with fallback)
   ===================================================== */
let droneTemplate = null;          // stays null if drone.glb fails: built-in shapes are used

// Colour-grade a loaded model: keeps its textures, fixes the "black" look.
function prepareModel(root, style) {
  const tintColor = style.tint !== undefined ? new THREE.Color(style.tint) : null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const fix = (m) => {
      const c = m.clone();
      if (c.isMeshStandardMaterial) {
        if (tintColor) c.color.multiply(tintColor);
        if (style.bright) c.color.multiplyScalar(style.bright);
        if (style.metal !== undefined) c.metalness = Math.min(c.metalness, style.metal);
        if (style.rough !== undefined) c.roughness = Math.max(c.roughness, style.rough);
        if (style.env !== undefined) c.envMapIntensity = style.env;
        if (style.emissive !== undefined && !c.emissiveMap) {
          c.emissive.setHex(style.emissive);
          c.emissiveIntensity = style.emissiveI || 0.5;
        }
        if (style.edge !== undefined && GUN_EDGES) {
          c.polygonOffset = true;                  // keeps the outline from flickering
          c.polygonOffsetFactor = 1;
          c.polygonOffsetUnits = 1;
        }
      }
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);

    if (style.edge !== undefined && GUN_EDGES) {
      o.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(o.geometry, 35),
        new THREE.LineBasicMaterial({ color: style.edge, transparent: true, opacity: 0.7, toneMapped: false })
      ));
    }
  });
  return root;
}

// Resize a model so its biggest side = targetSize, and centre it.
// alignToZ: turn it so its longest horizontal side points forward (used for the gun).
function fitModel(root, targetSize, alignToZ, extraYaw) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const biggest = Math.max(size.x, size.y, size.z) || 1;
  root.scale.multiplyScalar(targetSize / biggest);

  box.setFromObject(root);
  const centre = box.getCenter(new THREE.Vector3());
  root.position.sub(centre);

  const wrapper = new THREE.Group();
  wrapper.add(root);
  wrapper.rotation.y = extraYaw + ((alignToZ && size.x > size.z) ? Math.PI / 2 : 0);
  return wrapper;
}

function useGunModel(root) {
  const wrapper = fitModel(root, GUN_SIZE, true, GUN_FLIP ? Math.PI : 0);

  const box = new THREE.Box3().setFromObject(wrapper);
  const c = box.getCenter(new THREE.Vector3());
  const length = box.max.z - box.min.z;
  wrapper.position.set(-c.x, -c.y, 0.2 - box.max.z);      // back of gun at z = 0.2

  for (const m of [gunBody, gunBarrel, gunStrip, gunGrip]) m.visible = false;
  gun.add(wrapper);

  muzzle.position.set(0, 0.02, 0.2 - length);               // front tip of the gun
  muzzleFlash.position.copy(muzzle.position);
}

/* ---------- scenery: props around the walls + craters on the floor ---------- */

// Put one copy of a model into the scene. The model's bottom sits on the floor.
function placeCopy(item, x, z, rotY) {
  const holder = new THREE.Group();
  const inst = item.tpl.clone(true);
  inst.position.y = item.floorY;
  holder.add(inst);
  holder.position.set(x, 0, z);
  holder.rotation.y = rotY;
  scene.add(holder);
}

// Load one scenery model and work out how high to lift it so it sits on the floor.
async function loadScenery(load, url, size, style) {
  const root = await load(url);
  prepareModel(root, style);
  const tpl = fitModel(root, size, false, 0);
  const box = new THREE.Box3().setFromObject(tpl);
  return { tpl, floorY: 0.03 - box.min.y };
}

async function buildScenery(load) {
  // ----- props just outside the arena walls (decoration only) -----
  if (SHOW_PROPS) {
    const items = [];
    for (let i = 0; i < PROP_URLS.length; i++) {
      try {
        items.push(await loadScenery(load, PROP_URLS[i], PROP_SIZES[i] || 3, STYLE_PROP));
      } catch (e) {
        console.warn('Prop failed, skipping: ' + PROP_URLS[i], e);
      }
    }
    if (items.length > 0) {
      const spots = [-45, -30, -15, 0, 15, 30, 45];
      let n = 0;
      for (let side = 0; side < 4; side++) {
        for (const s of spots) {
          let x, z;
          if (side === 0) { x = s; z = -PROP_EDGE; }
          else if (side === 1) { x = s; z = PROP_EDGE; }
          else if (side === 2) { x = -PROP_EDGE; z = s; }
          else { x = PROP_EDGE; z = s; }
          const item = items[n % items.length];
          n++;
          placeCopy(item, x, z, Math.atan2(-x, -z));      // face the middle of the arena
        }
      }
      console.log('✅ Props placed: ' + n);
    }
  }

  // ----- craters lying flat on the floor (decoration only) -----
  if (SHOW_CRATERS) {
    try {
      const crater = await loadScenery(load, CRATER_URL, CRATER_SIZE, STYLE_CRATER);
      const spots = [[-34, 8], [36, -12], [-14, -38], [16, 38], [40, 32], [-40, -30]];
      spots.forEach((p, i) => placeCopy(crater, p[0], p[1], i * 1.7));
      console.log('✅ Craters placed');
    } catch (e) {
      console.warn('Crater failed, skipping.', e);
    }
  }
}

async function loadModels() {
  let GLTFLoader;
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js');
    GLTFLoader = mod.GLTFLoader;
  } catch (e) {
    console.warn('Model loader unavailable, using built-in shapes.', e);
    return;
  }
  const loader = new GLTFLoader();
  const load = (url) => new Promise((resolve, reject) => loader.load(url, (g) => resolve(g.scene), undefined, reject));

  try {
    const root = await load(MODEL_DRONE_URL);
    prepareModel(root, STYLE_DRONE);
    droneTemplate = fitModel(root, DRONE_SIZE, false, DRONE_YAW_FIX);
    console.log('✅ Drone model loaded');
  } catch (e) {
    console.warn('Drone model failed, using built-in drone shape.', e);
  }

  try {
    const root = await load(MODEL_GUN_URL);
    prepareModel(root, STYLE_GUN);
    useGunModel(root);
    console.log('✅ Gun model loaded');
  } catch (e) {
    console.warn('Gun model failed, using built-in gun shape.', e);
  }

  try {
    await buildScenery(load);
  } catch (e) {
    console.warn('Scenery failed, arena stays as it is.', e);
  }
}

/* =====================================================
   7. AUDIO: sound effects (real gunshot + code-generated)
   ===================================================== */
// The real recording lives in the project root: sounds/gunshot.mp3
const GUNSHOT_URL = new URL('../sounds/gunshot.mp3', import.meta.url).href;

// ---- gunshot tuning knobs ----
const GUN_VARIATION = 0.07;       // random pitch change per shot (0.07 = +-7%) so it never sounds robotic
const MAX_GUN_VOICES = 10;        // most gunshots allowed at the same moment
const SHOT_PLAYER = { rate: 1.08, vol: 0.75, len: 0.28 };   // your gun (len = max seconds, early fade-out)
const SHOT_DRONE = { rate: 1.28, vol: 0.45, len: 0.22 };    // drone shots (higher pitch, quieter)
const DRONE_HEAR_DIST = 80;       // drone shots farther than this are silent

let audioCtx = null;
let masterGain, sfxGain, musicGain, noiseBuf;
let gunBuf = null;                // the decoded gunshot recording (stays null if it fails to load)
let gunVoices = 0;                // how many gunshots are playing right now

async function loadGunshot() {
  try {
    const res = await fetch(GUNSHOT_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.arrayBuffer();
    gunBuf = await audioCtx.decodeAudioData(data);
    console.log('✅ gunshot.mp3 loaded (' + gunBuf.duration.toFixed(2) + ' s)');
  } catch (e) {
    gunBuf = null;
    console.warn('gunshot.mp3 not loaded, using code sounds instead:', e);
  }
}

// Plays the real recording. v = loudness/closeness from 0 (far) to 1 (close).
// Returns false if the recording is not available (so the caller can use the code sound).
function playGunshot(cfg, v) {
  if (!audioCtx || !gunBuf) return false;
  if (gunVoices >= MAX_GUN_VOICES) return true;                 // too busy: skip quietly
  if (gunVoices >= MAX_GUN_VOICES - 3 && v < 0.5) return true;  // busy: drop far shots first

  const t = audioCtx.currentTime;
  const rate = cfg.rate * (1 + (Math.random() * 2 - 1) * GUN_VARIATION);
  const level = cfg.vol * (0.35 + 0.65 * v) * (0.92 + Math.random() * 0.16);

  const src = audioCtx.createBufferSource();
  src.buffer = gunBuf;
  src.playbackRate.value = rate;

  const lp = audioCtx.createBiquadFilter();                     // far shots sound muffled
  lp.type = 'lowpass';
  lp.frequency.value = 1200 + v * v * 16000;

  const g = audioCtx.createGain();
  const natural = gunBuf.duration / rate;
  const dur = cfg.len > 0 ? Math.min(cfg.len, natural) : natural;
  g.gain.setValueAtTime(level, t);
  if (cfg.len > 0 && cfg.len < natural) {                       // early fade-out keeps rapid fire clean
    g.gain.setValueAtTime(level, t + dur * 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
  }

  src.connect(lp);
  lp.connect(g);
  g.connect(sfxGain);
  src.start(t);
  src.stop(t + dur + 0.02);
  gunVoices++;
  src.onended = () => { gunVoices = Math.max(0, gunVoices - 1); };
  return true;
}

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    sfxGain = audioCtx.createGain();
    musicGain = audioCtx.createGain();
    sfxGain.connect(masterGain);
    musicGain.connect(masterGain);

    // gentle compressor: keeps big firefights from clipping
    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    masterGain.connect(comp);
    comp.connect(audioCtx.destination);

    // one shared buffer of white noise, reused by explosions, drums, etc.
    noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    applyVolumes(true);
    startMusic();
    loadGunshot();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function applyVolumes(immediate) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const duck = isPlaying() ? 1 : 0.4;   // music gets quieter in menus / pause
  const set = (g, v) => {
    if (immediate) g.gain.value = v;
    else g.gain.setTargetAtTime(v, t, 0.08);
  };
  set(masterGain, settings.master);
  set(sfxGain, settings.sfx);
  set(musicGain, settings.music * 0.6 * duck);
}

function tone(freq, type, dur, vol, slideTo, delay) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime + (delay || 0);
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(sfxGain);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, vol, filterFreq, delay) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime + (delay || 0);
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuf;
  const f = audioCtx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = filterFreq;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(sfxGain);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// your gun: real recording, or the old code sound if the file is missing
const sfxShoot = () => {
  if (playGunshot(SHOT_PLAYER, 1)) return;
  tone(900, 'sawtooth', 0.12, 0.22, 150);
  noise(0.08, 0.18, 3500);
};
const sfxHit = () => tone(1300, 'square', 0.06, 0.18, 600);
const sfxExplosion = () => { noise(0.55, 0.5, 900); tone(130, 'sawtooth', 0.45, 0.3, 30); };
const sfxEmpty = () => tone(200, 'square', 0.05, 0.15);
const sfxReload = () => { tone(380, 'square', 0.06, 0.15); tone(560, 'square', 0.06, 0.15, null, RELOAD_TIME - 0.15); };
// drone shots: quieter and more muffled the farther away they are
const sfxEnemyShoot = (dist) => {
  const v = Math.max(0, 1 - dist / DRONE_HEAR_DIST);
  if (v < 0.05) return;
  if (playGunshot(SHOT_DRONE, v)) return;
  tone(520, 'triangle', 0.16, Math.max(0.04, 0.2 - dist * 0.004), 200);
};
const sfxDamage = () => { tone(150, 'sawtooth', 0.25, 0.35, 60); noise(0.15, 0.3, 1200); };
const sfxWaveStart = () => { tone(330, 'square', 0.14, 0.15); tone(440, 'square', 0.14, 0.15, null, 0.15); tone(660, 'square', 0.25, 0.15, null, 0.3); };
const sfxWaveClear = () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 'triangle', 0.25, 0.2, null, i * 0.12)); };
const sfxSpawn = () => tone(200, 'sine', 0.5, 0.15, 900);
const sfxGameOver = () => { [440, 349, 262, 175].forEach((f, i) => tone(f, 'sawtooth', 0.4, 0.22, f * 0.8, i * 0.25)); };

/* =====================================================
   8. AUDIO: procedural music (synthwave)
   ===================================================== */
const BPM = 112;
const STEP = 60 / BPM / 2;                // one 8th note
const PROG = [
  { root: 33, iv: [0, 3, 7] },            // A minor
  { root: 29, iv: [0, 4, 7] },            // F major
  { root: 36, iv: [0, 4, 7] },            // C major
  { root: 31, iv: [0, 4, 7] }             // G major
];
const BASS_PAT = [0, 0, 12, 0, 0, 12, 0, 7];
const ARP_PAT = [0, 1, 2, 1, 2, 1, 0, 1];

let musicStep = 0;
let nextNoteTime = 0;
let musicTimer = null;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function musicNote(freq, type, dur, vol, t, filterFreq, attack) {
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  let node = o;
  if (filterFreq) {
    const f = audioCtx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    o.connect(f);
    node = f;
  }
  if (attack) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
  } else {
    g.gain.setValueAtTime(vol, t);
  }
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  node.connect(g);
  g.connect(musicGain);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function musicNoise(dur, vol, hpFreq, t) {
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuf;
  const f = audioCtx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hpFreq;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(musicGain);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function playStep(step, t) {
  const chord = PROG[Math.floor(step / 8)];
  const s = step % 8;

  // bass (always)
  musicNote(mtof(chord.root + BASS_PAT[s]), 'sawtooth', STEP * 0.9, 0.5, t, 380);

  // pad (always) - one long chord per bar
  if (s === 0) {
    chord.iv.forEach((iv) => musicNote(mtof(chord.root + 24 + iv), 'triangle', STEP * 8, 0.09, t, 1800, 0.4));
  }

  // kick on every beat (always)
  if (s % 2 === 0) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g);
    g.connect(musicGain);
    o.start(t);
    o.stop(t + 0.2);
  }

  // drums join from wave 2
  if (wave >= 2) {
    if (s === 2 || s === 6) musicNoise(0.14, 0.35, 1500, t);   // snare
    if (s % 2 === 1) musicNoise(0.04, 0.14, 7000, t);          // hi-hat
  }

  // lead arpeggio joins from wave 3
  if (wave >= 3) {
    const oct = wave >= 5 ? 36 : 24;
    musicNote(mtof(chord.root + oct + chord.iv[ARP_PAT[s]]), 'square', STEP * 0.8, 0.07, t, 2500);
  }
}

function scheduleMusic() {
  if (!audioCtx) return;
  if (nextNoteTime < audioCtx.currentTime - 0.5) nextNoteTime = audioCtx.currentTime + 0.1;
  while (nextNoteTime < audioCtx.currentTime + 0.3) {
    playStep(musicStep, nextNoteTime);
    nextNoteTime += STEP;
    musicStep = (musicStep + 1) % 32;
  }
}

function startMusic() {
  nextNoteTime = audioCtx.currentTime + 0.1;
  musicTimer = setInterval(scheduleMusic, 100);
}

/* =====================================================
   9. HUD, BANNER, ALERTS
   ===================================================== */
function updateHUD() {
  const h = Math.max(0, Math.round(health));
  $('health-fill').style.width = h + '%';
  $('health-fill').classList.toggle('low', h <= 30);
  $('health-text').textContent = h;
  $('score').textContent = score;
  $('ammo').textContent = reloading ? 'RELOADING...' : ammo + ' / ' + MAG_SIZE;
  $('reload-msg').classList.toggle('show', reloading);
}

function updateWaveHUD() {
  const planned = squadsPlan.reduce((a, b) => a + b, 0);
  $('wave-label').textContent = 'WAVE ' + Math.max(wave, 1);
  $('enemy-label').textContent = 'DRONES: ' + (drones.length + planned);
}

let bannerTimeout = null;
function showBanner(title, sub, seconds) {
  $('banner-title').textContent = title;
  $('banner-sub').textContent = sub;
  $('wave-banner').classList.add('show');
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => $('wave-banner').classList.remove('show'), seconds * 1000);
}
function hideBanner() {
  clearTimeout(bannerTimeout);
  $('wave-banner').classList.remove('show');
}

let alertTimeout = null;
function showAlert(text) {
  $('squad-alert').textContent = text;
  $('squad-alert').classList.add('show');
  clearTimeout(alertTimeout);
  alertTimeout = setTimeout(() => $('squad-alert').classList.remove('show'), 2600);
}

let hitTimeout = null;
function showHitmarker(kill) {
  const hm = $('hitmarker');
  hm.classList.add('show');
  hm.classList.toggle('kill', kill);
  clearTimeout(hitTimeout);
  hitTimeout = setTimeout(() => hm.classList.remove('show'), 120);
}

function flashDamage() {
  const f = $('damage-flash');
  f.style.transition = 'none';
  f.style.opacity = '1';
  void f.offsetWidth;                       // restart the CSS transition
  f.style.transition = 'opacity 0.45s';
  f.style.opacity = '0';
}

/* ===== END OF PART 1 — paste PART 2 directly below this line ===== */

/* =====================================================
   10. PARTICLES + TRACERS
   ===================================================== */
const particleGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);

function spawnBurst(pos, color, count, speed) {
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, toneMapped: false });
    const mesh = new THREE.Mesh(particleGeo, mat);
    mesh.position.copy(pos);
    scene.add(mesh);
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    particles.push({ mesh, vel: dir.multiplyScalar(speed * (0.4 + Math.random())), life: 0.7, max: 0.7 });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.vel.y -= 6 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.material.opacity = Math.max(0, p.life / p.max);
    p.mesh.scale.setScalar(Math.max(0.1, p.life / p.max));
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
      particles.splice(i, 1);
    }
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    const tr = tracers[i];
    tr.life -= dt;
    tr.line.material.opacity = Math.max(0, tr.life / 0.08);
    if (tr.life <= 0) {
      scene.remove(tr.line);
      tr.line.geometry.dispose();
      tr.line.material.dispose();
      tracers.splice(i, 1);
    }
  }
}

function addTracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color: 0x66ffff, transparent: true, opacity: 1, toneMapped: false });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  tracers.push({ line, life: 0.08 });
}

/* =====================================================
   11. DRONES
   ===================================================== */
const droneBodyGeo = new THREE.IcosahedronGeometry(1.0, 0);
const droneRingGeo = new THREE.TorusGeometry(1.5, 0.07, 8, 32);
const droneEyeGeo = new THREE.SphereGeometry(0.28, 12, 12);
const droneEyeMat = new THREE.MeshBasicMaterial({ color: 0xff2d95, toneMapped: false });

// invisible sphere used for hit detection when a 3D model is used
const droneHitGeo = new THREE.SphereGeometry(DRONE_SIZE * 0.5, 10, 10);
const droneHitMat = new THREE.MeshBasicMaterial({ visible: false });

// colour shows remaining health: 3 = cyan, 2 = purple, 1 = pink
const HP_COLORS = { 3: 0x00f0ff, 2: 0x7b2ff7, 1: 0xff2d95 };

/*
  One function decides how a drone looks.
  - Built-in shape drone: glows in its HP colour all the time.
  - 3D model drone: keeps its ORIGINAL look at full health.
    After a hit it gets tinted (purple, then pink).
    It also glows brighter just before firing and when it is hit.
*/
function refreshDroneLook(d) {
  const hp = d.health;
  const c = HP_COLORS[hp] !== undefined ? HP_COLORS[hp] : HP_COLORS[1];
  d.ringMat.color.setHex(c);

  const boost = d.flashT > 0 ? 2 : (d.fireTimer < 0.4 ? 1 : 0);   // 2 = just hit, 1 = about to fire

  for (const m of d.mats) {
    if (!m.emissive) continue;
    if (d.isModel) {
      if (boost === 2) {
        m.emissive.setHex(c);
        m.emissiveIntensity = 3;
      } else if (boost === 1) {
        m.emissive.setHex(c);
        m.emissiveIntensity = 1.6;
      } else if (hp === DRONE_HP) {
        m.emissive.copy(m.userData.origEmissive);                  // untouched original look
        m.emissiveIntensity = m.userData.origIntensity;
      } else {
        m.emissive.setHex(c);                                      // damaged: soft tint
        m.emissiveIntensity = 0.6;
      }
    } else {
      m.emissive.setHex(c);
      m.emissiveIntensity = boost === 2 ? 4 : (boost === 1 ? 2.6 : 1.2);
    }
  }
}

function createDrone(pos) {
  const group = new THREE.Group();
  const pivot = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: HP_COLORS[DRONE_HP], toneMapped: false });
  const ring = new THREE.Mesh(droneRingGeo, ringMat);
  ring.rotation.x = 1.2;

  let body;
  const mats = [];
  const isModel = !!droneTemplate;

  if (isModel) {
    // ----- 3D model version -----
    const model = droneTemplate.clone(true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      const own = (m) => {
        const c = m.clone();
        c.userData.origEmissive = c.emissive ? c.emissive.clone() : null;   // remember original look
        c.userData.origIntensity = c.emissiveIntensity;
        mats.push(c);
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    });
    body = new THREE.Mesh(droneHitGeo, droneHitMat);     // invisible hit-box
    if (DRONE_RING) pivot.add(ring);
    group.add(body, model, pivot);
  } else {
    // ----- built-in shape version (fallback) -----
    const mat = new THREE.MeshStandardMaterial({
      color: 0x111122, emissive: HP_COLORS[DRONE_HP], emissiveIntensity: 1.2, metalness: 0.6, roughness: 0.3
    });
    mats.push(mat);
    body = new THREE.Mesh(droneBodyGeo, mat);
    const eye = new THREE.Mesh(droneEyeGeo, droneEyeMat);
    eye.position.z = 0.85;
    pivot.add(ring);
    group.add(body, pivot, eye);
  }

  group.position.copy(pos);
  group.scale.setScalar(0.2);
  scene.add(group);

  const d = {
    group, body, mats, ringMat, pivot, isModel,
    health: DRONE_HP,
    speed: Math.min(3.5 + wave * 0.5, 8),
    range: 14 + (Math.random() - 0.5) * 8,
    strafeDir: Math.random() < 0.5 ? 1 : -1,
    strafeTimer: 1 + Math.random() * 2,
    fireTimer: 2 + Math.random() * 2,
    baseY: pos.y,
    phase: Math.random() * 6.28,
    spawnT: 0,
    flashT: 0
  };
  body.userData.drone = d;
  refreshDroneLook(d);
  drones.push(d);
  return d;
}

function removeDrone(d) {
  scene.remove(d.group);
  for (const m of d.mats) m.dispose();
  d.ringMat.dispose();
  const i = drones.indexOf(d);
  if (i >= 0) drones.splice(i, 1);
}

function damageDrone(d, point) {
  d.health -= 1;
  d.flashT = 0.1;
  sfxHit();
  if (d.health <= 0) {
    spawnBurst(d.group.position, 0xff2d95, 22, 9);
    spawnBurst(d.group.position, 0x00f0ff, 14, 6);
    removeDrone(d);
    score += 100;
    sfxExplosion();
    showHitmarker(true);
    updateHUD();
    updateWaveHUD();
  } else {
    refreshDroneLook(d);
    spawnBurst(point, 0xffffff, 5, 4);
    showHitmarker(false);
  }
}

function fireInterval() { return Math.max(1.2, 3.2 - wave * 0.2); }

const enemyBulletGeo = new THREE.SphereGeometry(0.22, 8, 8);
const enemyBulletMat = new THREE.MeshBasicMaterial({ color: 0xff2d95, toneMapped: false });

function droneShoot(d) {
  const from = d.group.position.clone();
  const target = camera.position.clone();
  const err = Math.max(1.0, 2.4 - wave * 0.1);       // aim error so they can miss
  target.x += (Math.random() - 0.5) * 2 * err;
  target.z += (Math.random() - 0.5) * 2 * err;
  target.y += (Math.random() - 0.5) * err * 0.8;
  const dist = from.distanceTo(camera.position);
  const dir = target.sub(from).normalize();
  const speed = Math.min(16 + wave * 0.6, 24);

  const mesh = new THREE.Mesh(enemyBulletGeo, enemyBulletMat);
  mesh.position.copy(from);
  scene.add(mesh);
  enemyBullets.push({ mesh, vel: dir.multiplyScalar(speed), life: 4 });
  sfxEnemyShoot(dist);
}

function updateDrones(dt, t) {
  const pp = camera.position;

  for (const d of drones) {
    const g = d.group;
    const pos = g.position;

    if (d.spawnT < 1) {                               // warp-in animation
      d.spawnT = Math.min(1, d.spawnT + dt * 2);
      g.scale.setScalar(0.2 + 0.8 * d.spawnT);
    }

    // SENSE: where is the player?
    const dx = pp.x - pos.x;
    const dz = pp.z - pos.z;
    const dist = Math.max(Math.hypot(dx, dz), 0.001);
    const nx = dx / dist;
    const nz = dz / dist;

    // DECIDE: approach, back off, or hold range - and strafe
    let mx = 0, mz = 0;
    if (dist > d.range + 3) { mx += nx; mz += nz; }
    else if (dist < d.range - 3) { mx -= nx * 0.9; mz -= nz * 0.9; }

    d.strafeTimer -= dt;
    if (d.strafeTimer <= 0) {                         // flip direction often = no orbiting
      d.strafeDir *= -1;
      d.strafeTimer = 1.2 + Math.random() * 2;
    }
    mx += -nz * d.strafeDir * 0.55;
    mz += nx * d.strafeDir * 0.55;

    // keep away from other drones (flocking separation)
    for (const o of drones) {
      if (o === d) continue;
      const sx = pos.x - o.group.position.x;
      const sz = pos.z - o.group.position.z;
      const sd = Math.hypot(sx, sz);
      if (sd < 3.5 && sd > 0.001) {
        mx += (sx / sd) * (3.5 - sd) * 0.5;
        mz += (sz / sd) * (3.5 - sd) * 0.5;
      }
    }

    // ACT: move
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    pos.x += mx * d.speed * dt;
    pos.z += mz * d.speed * dt;

    // don't fly through pillars
    for (const p of pillars) {
      const px = pos.x - p.x;
      const pz = pos.z - p.z;
      const pd = Math.hypot(px, pz);
      const min = PILLAR_R + 1.6;
      if (pd < min && pd > 0.001 && pos.y < PILLAR_H + 1.5) {
        pos.x += (px / pd) * (min - pd);
        pos.z += (pz / pd) * (min - pd);
      }
    }

    pos.x = Math.max(-LIMIT + 3, Math.min(LIMIT - 3, pos.x));
    pos.z = Math.max(-LIMIT + 3, Math.min(LIMIT - 3, pos.z));
    pos.y = d.baseY + Math.sin(t * 2 + d.phase) * 0.5;

    g.lookAt(pp.x, pos.y, pp.z);
    d.pivot.rotation.y += dt * 3;

    // ACT: shoot
    d.fireTimer -= dt;
    if (d.flashT > 0) d.flashT -= dt;
    if (d.fireTimer <= 0 && dist < 38 && d.spawnT >= 1) {
      droneShoot(d);
      d.fireTimer = fireInterval() + Math.random() * 1.5;
    }
    // look: original colours, tint when damaged, brighter just before firing
    refreshDroneLook(d);
  }
}

function damagePlayer() {
  if (gameState !== 'running') return;
  health -= ENEMY_DMG;
  sfxDamage();
  flashDamage();
  updateHUD();
  if (health <= 0) endGame();
}

function updateEnemyBullets(dt) {
  const pp = camera.position;
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const b = enemyBullets[i];
    b.mesh.position.addScaledVector(b.vel, dt);
    b.life -= dt;
    const p = b.mesh.position;
    let remove = b.life <= 0;

    if (!remove && (Math.abs(p.x) > LIMIT + 5 || Math.abs(p.z) > LIMIT + 5 || p.y < 0)) remove = true;

    if (!remove) {
      for (const pl of pillars) {
        if (p.y < PILLAR_H && Math.hypot(p.x - pl.x, p.z - pl.z) < PILLAR_R + 0.2) { remove = true; break; }
      }
    }

    if (!remove) {
      if (Math.hypot(p.x - pp.x, p.z - pp.z) < 0.75 && p.y > 0.3 && p.y < 2.3) {
        remove = true;
        damagePlayer();
      }
    }

    if (remove) {
      scene.remove(b.mesh);
      enemyBullets.splice(i, 1);
    }
  }
}

/* =====================================================
   12. WAVES + SQUAD SPAWNING (drones come from the front)
   ===================================================== */
const TIPS = [
  'Each drone takes 3 hits to destroy. Watch its color change: cyan → purple → pink!',
  'Drones shoot back! Keep moving, and sprint with Shift to dodge their bullets.',
  'Squads fly in from the front. Hide behind pillars: they block bullets.',
  'Clearing a wave restores +25 health. Stay alive!',
  'Watch your ammo! Press R to reload before the next squad arrives.',
  'A drone glows brighter right before it fires. Dodge!',
  'Drones get faster and shoot quicker every wave.',
  'Hold the right mouse button (or F) to zoom in. Press V to turn aim assist on or off.'
];

function planSquads(total, n) {
  const maxSquad = Math.min(5, 3 + Math.floor((n - 1) / 3));
  const count = Math.ceil(total / maxSquad);
  const plan = [];
  let left = total;
  for (let i = 0; i < count; i++) {
    const size = Math.ceil(left / (count - i));
    plan.push(size);
    left -= size;
  }
  return plan;
}

function distToBoundary(p, dir) {
  let t = Infinity;
  if (dir.x > 0.0001) t = Math.min(t, (LIMIT - p.x) / dir.x);
  else if (dir.x < -0.0001) t = Math.min(t, (-LIMIT - p.x) / dir.x);
  if (dir.z > 0.0001) t = Math.min(t, (LIMIT - p.z) / dir.z);
  else if (dir.z < -0.0001) t = Math.min(t, (-LIMIT - p.z) / dir.z);
  return t;
}

function spawnSquad(count) {
  const pp = camera.position;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  let behind = false;

  // facing a wall? then spawn from the arena side instead
  if (distToBoundary(pp, fwd) < 24) {
    behind = true;
    fwd.set(-pp.x, 0, -pp.z);
    if (fwd.lengthSq() < 1) fwd.set(0, 0, -1);
    fwd.normalize();
  }
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const D = Math.min(34, distToBoundary(pp, fwd) - 4);

  const formations = ['line', 'v', 'arc'];
  const formation = formations[(wave + squadsSpawned) % 3];

  for (let i = 0; i < count; i++) {
    const k = i - (count - 1) / 2;
    const p = new THREE.Vector3();
    if (formation === 'line') {
      p.copy(pp).addScaledVector(fwd, D).addScaledVector(right, k * 6);
    } else if (formation === 'v') {
      p.copy(pp).addScaledVector(fwd, D + Math.abs(k) * 4).addScaledVector(right, k * 5);
    } else {
      const a = k * 0.3;
      p.copy(pp).addScaledVector(fwd, Math.cos(a) * D).addScaledVector(right, Math.sin(a) * D);
    }
    p.x = Math.max(-LIMIT + 3, Math.min(LIMIT - 3, p.x));
    p.z = Math.max(-LIMIT + 3, Math.min(LIMIT - 3, p.z));
    p.y = 4 + Math.random() * 2.5;
    createDrone(p);
    spawnBurst(p, 0x00f0ff, 8, 5);
  }

  squadsSpawned++;
  sfxSpawn();
  showAlert(behind
    ? '⚠ SQUAD OF ' + count + ' INCOMING — TURN AROUND!'
    : '⚠ SQUAD OF ' + count + ' INCOMING — STRAIGHT AHEAD!');
  updateWaveHUD();
}

function startWave(n) {
  wave = n;
  waveActive = true;
  squadsSpawned = 0;
  const total = Math.min(3 + (n - 1) * 2, 14);
  squadsPlan = planSquads(total, n);

  const intro = n === 1 ? 5 : 3.5;                  // time to read the tip
  squadTimer = intro;
  showBanner('WAVE ' + n, TIPS[(n - 1) % TIPS.length], intro);
  sfxWaveStart();
  updateWaveHUD();
}

function waveClear() {
  waveActive = false;
  const bonus = wave * 250;
  score += bonus;
  health = Math.min(100, health + 25);
  nextWaveTimer = 4.5;
  showBanner('WAVE ' + wave + ' CLEARED', '+' + bonus + ' points   ·   +25 health', 2.8);
  sfxWaveClear();
  updateHUD();
}

function updateWaves(dt) {
  if (!waveActive) {
    nextWaveTimer -= dt;
    if (nextWaveTimer <= 0) startWave(wave + 1);
    return;
  }
  if (squadsPlan.length > 0) {
    // if the field is empty, bring the next squad in sooner
    if (squadsSpawned > 0 && drones.length === 0 && squadTimer > 1.5) squadTimer = 1.5;
    squadTimer -= dt;
    if (squadTimer <= 0) {
      spawnSquad(squadsPlan.shift());
      squadTimer = 7;
    }
  } else if (drones.length === 0) {
    waveClear();
  }
}

/* =====================================================
   13. SHOOTING
   ===================================================== */
const raycaster = new THREE.Raycaster();
raycaster.far = 150;
const screenCenter = new THREE.Vector2(0, 0);

function startReload() {
  if (reloading || ammo === MAG_SIZE || !isPlaying()) return;
  reloading = true;
  reloadTimer = RELOAD_TIME;
  sfxReload();
  updateHUD();
}

// returns true if the shot request was handled (fired, empty, or reloading)
function tryShoot() {
  if (reloading) return true;
  if (fireCooldown > 0) return false;
  if (ammo <= 0) { sfxEmpty(); startReload(); return true; }

  ammo--;
  fireCooldown = FIRE_DELAY;
  gunKick = 1;
  muzzleFlash.visible = true;
  flashTimer = 0.05;
  sfxShoot();

  camera.updateMatrixWorld();
  raycaster.setFromCamera(screenCenter, camera);
  const targets = drones.map((d) => d.body).concat(pillarMeshes);
  const hits = raycaster.intersectObjects(targets, false);

  const from = new THREE.Vector3();
  muzzle.getWorldPosition(from);
  let end;

  if (hits.length > 0) {
    const h = hits[0];
    end = h.point.clone();
    if (h.object.userData.drone) {
      damageDrone(h.object.userData.drone, h.point);
    } else {
      spawnBurst(h.point, 0x00f0ff, 6, 4);
    }
  } else {
    end = raycaster.ray.at(100, new THREE.Vector3());
  }
  addTracer(from, end);

  if (ammo === 0) startReload();
  updateHUD();
  return true;
}

function updateShooting(dt) {
  if (fireCooldown > 0) fireCooldown -= dt;

  if (reloading) {
    reloadTimer -= dt;
    if (reloadTimer <= 0) {
      reloading = false;
      ammo = MAG_SIZE;
      updateHUD();
    }
  }

  if (fireQueued && performance.now() - fireQueueTime > 250) fireQueued = false;
  if (mouseHeld || keys['Space'] || fireQueued) {
    if (tryShoot()) fireQueued = false;
  }

  // gun animation
  gunKick = Math.max(0, gunKick - dt * 8);
  gun.position.z = GUN_REST.z + gunKick * 0.1;
  gun.rotation.x = gunKick * 0.12;
  if (flashTimer > 0) {
    flashTimer -= dt;
    if (flashTimer <= 0) muzzleFlash.visible = false;
  }
}

/* =====================================================
   13b. LOOK CONTROL: arrow keys, scope, aim assist
   ===================================================== */
function applyLook() {
  pitch = Math.max(-1.45, Math.min(1.45, pitch));
  camera.rotation.set(pitch, yaw, 0);
}

// Arrow keys turn the camera (useful if the touchpad is awkward)
function updateKeyLook(dt) {
  const zoomK = camera.fov / FOV_NORMAL;
  const step = KEY_TURN_SPEED * (settings.sensLevel / 10) * zoomK * dt;
  let changed = false;
  if (keys['ArrowLeft']) { yaw += step; changed = true; }
  if (keys['ArrowRight']) { yaw -= step; changed = true; }
  if (keys['ArrowUp']) { pitch += step; changed = true; }
  if (keys['ArrowDown']) { pitch -= step; changed = true; }
  if (changed) applyLook();
}

// Scope: hold right mouse button or F. Smooth zoom + dark edges.
const scopeOverlay = document.createElement('div');
scopeOverlay.style.cssText =
  'position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;' +
  'background:radial-gradient(circle at center, rgba(0,0,0,0) 28%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.92) 80%);';
document.body.appendChild(scopeOverlay);

function updateScope(dt) {
  const want = isPlaying() && (rightHeld || keys[SCOPE_KEY]);
  scopeAmt += ((want ? 1 : 0) - scopeAmt) * Math.min(1, dt * 12);
  if (!want && scopeAmt < 0.005) scopeAmt = 0;
  const fov = FOV_NORMAL + (FOV_SCOPE - FOV_NORMAL) * scopeAmt;
  if (Math.abs(fov - camera.fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  scopeOverlay.style.opacity = String(scopeAmt);
  gun.visible = scopeAmt < 0.5;
}

// Aim assist label (bottom of the screen, only while playing)
const aimLabel = document.createElement('div');
aimLabel.style.cssText =
  'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:6;pointer-events:none;' +
  'font:700 12px "Segoe UI",Arial,sans-serif;letter-spacing:2px;padding:4px 12px;border-radius:12px;' +
  'background:rgba(0,0,0,0.45);display:none;';
document.body.appendChild(aimLabel);
function refreshAimLabel() {
  aimLabel.textContent = 'AIM ASSIST: ' + (aimAssist ? 'ON' : 'OFF') + '  (V)';
  aimLabel.style.color = aimAssist ? '#00f0ff' : '#9aa0c0';
}
refreshAimLabel();

// Is there a pillar between two points?
function blockedByPillar(a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const l2 = abx * abx + abz * abz || 0.0001;
  for (const p of pillars) {
    let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + abx * t, cz = a.z + abz * t;
    const y = a.y + (b.y - a.y) * t;
    if (Math.hypot(cx - p.x, cz - p.z) < PILLAR_R && y < PILLAR_H) return true;
  }
  return false;
}

// Aim assist: while firing, gently pull the crosshair toward the closest drone
function applyAimAssist(dt) {
  if (!aimAssist) return;
  if (!(mouseHeld || keys['Space'])) return;

  const fwd = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  let best = null, bestAngle = AIM_CONE;
  for (const d of drones) {
    if (d.spawnT < 1) continue;
    const to = d.group.position.clone().sub(camera.position);
    const dist = to.length();
    if (dist > AIM_MAX_DIST || dist < 0.5) continue;
    const ang = fwd.angleTo(to);
    if (ang < bestAngle && !blockedByPillar(camera.position, d.group.position)) {
      bestAngle = ang;
      best = to;
    }
  }
  if (!best) return;

  const wantYaw = Math.atan2(-best.x, -best.z);
  const wantPitch = Math.atan2(best.y, Math.hypot(best.x, best.z));
  let dyaw = wantYaw - yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const k = Math.min(1, AIM_PULL * dt);
  yaw += dyaw * k;
  pitch += (wantPitch - pitch) * k;
  applyLook();
}

/* =====================================================
   14. PLAYER MOVEMENT
   ===================================================== */
let bobTime = 0;

function updatePlayer(dt) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);

  let mx = 0, mz = 0;
  if (keys['KeyW']) { mx += fx; mz += fz; }
  if (keys['KeyS']) { mx -= fx; mz -= fz; }
  if (keys['KeyD']) { mx += rx; mz += rz; }
  if (keys['KeyA']) { mx -= rx; mz -= rz; }

  const len = Math.hypot(mx, mz);
  const moving = len > 0;
  if (moving) {
    let speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? SPRINT_SPEED : WALK_SPEED;
    speed *= 1 - (1 - SCOPE_MOVE) * scopeAmt;          // slower while scoped
    camera.position.x += (mx / len) * speed * dt;
    camera.position.z += (mz / len) * speed * dt;
  }

  camera.position.x = Math.max(-LIMIT, Math.min(LIMIT, camera.position.x));
  camera.position.z = Math.max(-LIMIT, Math.min(LIMIT, camera.position.z));

  // pillar collision (distance based)
  for (const p of pillars) {
    const dx = camera.position.x - p.x;
    const dz = camera.position.z - p.z;
    const d = Math.hypot(dx, dz);
    const min = PILLAR_R + 0.6;
    if (d < min && d > 0.001) {
      camera.position.x += (dx / d) * (min - d);
      camera.position.z += (dz / d) * (min - d);
    }
  }

  // head bob + gun sway
  if (moving) bobTime += dt * 10;
  camera.position.y = 1.7 + (moving ? Math.sin(bobTime) * 0.04 : 0);
  gun.position.x = GUN_REST.x + (moving ? Math.sin(bobTime * 0.5) * 0.01 : 0);
  gun.position.y = GUN_REST.y + (moving ? Math.abs(Math.sin(bobTime)) * 0.01 : 0);
}

/* =====================================================
   15. GAME FLOW: reset, end, quit
   ===================================================== */
function clearWorld() {
  while (drones.length) removeDrone(drones[0]);
  for (const b of enemyBullets) scene.remove(b.mesh);
  enemyBullets.length = 0;
  for (const p of particles) { scene.remove(p.mesh); p.mesh.material.dispose(); }
  particles.length = 0;
  for (const tr of tracers) { scene.remove(tr.line); tr.line.geometry.dispose(); tr.line.material.dispose(); }
  tracers.length = 0;
}

function resetGame() {
  clearWorld();
  score = 0;
  health = 100;
  ammo = MAG_SIZE;
  reloading = false;
  reloadTimer = 0;
  fireCooldown = 0;
  fireQueued = false;
  rightHeld = false;
  scopeAmt = 0;
  wave = 0;
  waveActive = false;
  squadsPlan = [];
  squadsSpawned = 0;
  nextWaveTimer = 1.0;
  yaw = 0;
  pitch = 0;
  camera.position.set(0, 1.7, 30);
  camera.rotation.set(0, 0, 0);
  camera.fov = FOV_NORMAL;
  camera.updateProjectionMatrix();
  hideBanner();
  $('squad-alert').classList.remove('show');
  updateHUD();
  updateWaveHUD();
}

function endGame() {
  setState('over');
  document.exitPointerLock();
  hideBanner();
  $('squad-alert').classList.remove('show');
  mouseHeld = false;
  rightHeld = false;

  const isRecord = score > best;
  if (isRecord) {
    best = score;
    localStorage.setItem('arenaBest', String(best));
  }
  $('final-score').textContent = score;
  $('final-wave').textContent = Math.max(wave, 1);
  $('final-best').textContent = best;
  $('new-record').classList.toggle('hidden', !isRecord);
  $('best-start').textContent = best;

  sfxGameOver();
  applyVolumes(false);
  showOverlay('gameover-screen');
}

function quitToMenu() {
  clearWorld();
  setState('idle');
  hideBanner();
  rightHeld = false;
  $('best-start').textContent = best;
  applyVolumes(false);
  showOverlay('start-screen');
}

function beginRun() {
  ensureAudio();
  resetGame();
  setState('running');
  hideOverlays();
  canvas.requestPointerLock();
}

/* =====================================================
   16. OVERLAYS + BUTTONS
   ===================================================== */
const overlayIds = ['start-screen', 'pause-screen', 'settings-screen', 'gameover-screen'];
function showOverlay(id) { overlayIds.forEach((o) => $(o).classList.toggle('hidden', o !== id)); }
function hideOverlays() { overlayIds.forEach((o) => $(o).classList.add('hidden')); }

let settingsReturn = 'start-screen';

$('play-btn').addEventListener('click', beginRun);
$('restart-btn').addEventListener('click', beginRun);

$('resume-btn').addEventListener('click', () => {
  ensureAudio();
  hideOverlays();
  canvas.requestPointerLock();
});

$('quit-btn').addEventListener('click', quitToMenu);
$('menu-btn').addEventListener('click', quitToMenu);

$('start-settings-btn').addEventListener('click', () => { settingsReturn = 'start-screen'; showOverlay('settings-screen'); });
$('pause-settings-btn').addEventListener('click', () => { settingsReturn = 'pause-screen'; showOverlay('settings-screen'); });
$('settings-back-btn').addEventListener('click', () => showOverlay(settingsReturn));

/* ---------- settings sliders ---------- */
const sliders = [
  { id: 'vol-master', key: 'master', pct: true },
  { id: 'vol-sfx', key: 'sfx', pct: true },
  { id: 'vol-music', key: 'music', pct: true },
  { id: 'sens', key: 'sensLevel', pct: false }        // sensitivity: whole levels 1 to 30
];

function syncSettingsUI() {
  for (const s of sliders) {
    const el = $(s.id);
    if (s.pct) {
      el.value = Math.round(settings[s.key] * 100);
      $(s.id + '-val').textContent = Math.round(settings[s.key] * 100) + '%';
    } else {
      el.min = 1; el.max = 30; el.step = 1;
      el.value = settings[s.key];
      $(s.id + '-val').textContent = String(settings[s.key]);
    }
  }
  refreshQualityButton();
}

for (const s of sliders) {
  const el = $(s.id);
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    if (s.pct) {
      settings[s.key] = v / 100;
      $(s.id + '-val').textContent = Math.round(v) + '%';
    } else {
      settings[s.key] = Math.max(1, Math.min(30, Math.round(v)));
      $(s.id + '-val').textContent = String(settings[s.key]);
    }
    applyVolumes(false);
    saveSettings();
  });
}
// let the player hear the effect volume when they let go of the slider
$('vol-sfx').addEventListener('change', () => { ensureAudio(); sfxHit(); });
$('vol-master').addEventListener('change', () => { ensureAudio(); sfxHit(); });
$('vol-music').addEventListener('change', () => { ensureAudio(); });

/* ---------- Graphics Quality row (built from JS, placed under Sensitivity) ---------- */
const qualityBtn = document.createElement('button');
(function buildQualityRow() {
  const sensRow = $('sens').parentElement;
  const row = document.createElement('div');
  row.className = sensRow.className;
  const oldLabel = sensRow.querySelector('label');
  const label = document.createElement('label');
  if (oldLabel) label.className = oldLabel.className;
  label.textContent = 'Graphics Quality';
  qualityBtn.type = 'button';
  qualityBtn.style.cssText =
    'padding:6px 18px;border-radius:8px;border:1px solid #00f0ff;background:rgba(0,240,255,0.12);' +
    'color:#fff;font-weight:700;cursor:pointer;min-width:110px;';
  row.appendChild(label);
  row.appendChild(qualityBtn);
  sensRow.parentElement.insertBefore(row, sensRow.nextSibling);
  qualityBtn.addEventListener('click', () => {
    const names = Object.keys(QUALITY);
    quality = names[(names.indexOf(quality) + 1) % names.length];
    localStorage.setItem('arena_quality', quality);
    applyQuality();
    refreshQualityButton();
  });
})();
function refreshQualityButton() { qualityBtn.textContent = quality; }

$('reset-settings-btn').addEventListener('click', () => {
  settings = Object.assign({}, DEFAULT_SETTINGS);
  quality = 'High';
  localStorage.setItem('arena_quality', quality);
  applyQuality();
  syncSettingsUI();
  applyVolumes(false);
  saveSettings();
});

/* ---------- extra control lines on the start screen ---------- */
(function addControlLines() {
  const list = document.querySelector('.controls');
  if (!list || !list.lastElementChild) return;
  const add = (key, text) => {
    const clone = list.lastElementChild.cloneNode(true);
    const els = clone.children;
    if (els.length >= 2) {
      els[0].textContent = key;
      els[1].textContent = text;
      while (clone.children.length > 2) clone.removeChild(clone.lastElementChild);
    } else if (els.length === 1) {
      els[0].textContent = key;
      [...clone.childNodes].forEach((n) => { if (n.nodeType === 3) clone.removeChild(n); });
      clone.appendChild(document.createTextNode(' ' + text));
    } else {
      clone.textContent = key + ' — ' + text;
    }
    list.appendChild(clone);
  };
  add('Right Mouse / F', 'Scope (zoom)');
  add('V', 'Aim Assist on / off');
  add('Arrow Keys', 'Turn the camera');
})();

/* =====================================================
   17. INPUT: pointer lock, mouse, keyboard
   ===================================================== */
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (pointerLocked) {
    hideOverlays();
  } else if (gameState === 'running') {
    mouseHeld = false;
    rightHeld = false;
    if ($('settings-screen').classList.contains('hidden')) showOverlay('pause-screen');
  }
  applyVolumes(false);
});

document.addEventListener('mousemove', (e) => {
  if (!isPlaying()) return;
  // sensitivity level 1 to 30 (10 = normal), smaller steps while zoomed in
  const s = BASE_SENS * (settings.sensLevel / 10) * (camera.fov / FOV_NORMAL);
  yaw -= e.movementX * s;
  pitch -= e.movementY * s;
  applyLook();
});

document.addEventListener('mousedown', (e) => {
  if (!isPlaying()) return;
  if (e.button === 2) { rightHeld = true; return; }
  if (e.button !== 0) return;
  mouseHeld = true;
  fireQueued = true;                    // guarantees a shot even for a very quick tap
  fireQueueTime = performance.now();
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseHeld = false;
  if (e.button === 2) rightHeld = false;
});

// no right-click menu while playing (right button = scope)
document.addEventListener('contextmenu', (e) => {
  if (gameState === 'running') e.preventDefault();
});

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (isPlaying()) {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) { fireQueued = true; fireQueueTime = performance.now(); }
    }
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyR') startReload();
    if (e.code === AIM_KEY && !e.repeat) {
      aimAssist = !aimAssist;
      refreshAimLabel();
    }
  }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  mouseHeld = false;
  rightHeld = false;
});

/* =====================================================
   18. MAIN LOOP
   ===================================================== */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  core.rotation.y += dt * 0.5;
  core.rotation.x += dt * 0.3;
  coreInner.rotation.y -= dt * 0.8;
  coreInner.rotation.x -= dt * 0.5;

  updateScope(dt);
  aimLabel.style.display = gameState === 'running' ? 'block' : 'none';

  if (isPlaying()) {
    updateKeyLook(dt);
    applyAimAssist(dt);
    updatePlayer(dt);
    updateShooting(dt);
    updateWaves(dt);
    updateDrones(dt, t);
    updateEnemyBullets(dt);
  }
  if (!isPaused()) updateParticles(dt);

  renderer.render(scene, camera);
}

/* =====================================================
   19. START UP
   ===================================================== */
syncSettingsUI();
$('best-start').textContent = best;
updateHUD();
updateWaveHUD();
showOverlay('start-screen');
loadModels();                       // loads drone, gun, props and craters in the background
animate();