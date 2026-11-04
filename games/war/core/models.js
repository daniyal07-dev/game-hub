// games/war/core/models.js
// Loads the .glb / .gltf models and builds every character, enemy and pickup in War Mode.
// If a model file is missing, a code-built shape is used instead.
// IMPORTANT: every model faces -Z (the same direction the camera looks).
// v6: character height is measured correctly (skeleton updated first, every vertex measured,
//     then re-checked), average human heights, camp pieces have a size multiplier (CAMP_SCALE).
// v7: BOSS model (models/characters/boss.glb). makeBoss() + makeMech(scale, true) use it.

import * as THREE from 'three';

/* ---------- Settings you can change ---------- */
const NEON_EDGES = false;        // true = bring back the glowing outlines on models

const PATHS = {
  drone:  '../models/drone.glb',
  gun:    '../models/gun.glb',                       // fallback if a weapon file is missing
  guns:   { pistol: '../models/pistol.glb', rifle: '../models/rifle.glb', shotgun: '../models/shotgun.glb' },
  props:  ['../models/props/prop1.glb', '../models/props/prop2.glb'],
  crater: '../models/crater.glb',
  // characters (no extension here: .glb is tried first, then .gltf)
  chars:  {
    enemy:    '../models/characters/enemy',
    teammate: '../models/characters/teammate',
    boss:     '../models/characters/boss'
  },
  // camp pieces (file = models/camp/<name>.glb or .gltf). Add more names here if you download more.
  camp:   ['tent', 'sandbags', 'crates', 'barrels', 'campfire']
};
const DRONE_SIZE = 2.2;
const DRONE_YAW  = 0;            // if the drone flies sideways, try Math.PI / 2
// if a weapon points backwards in your hand, set ITS value to true
const GUN_FLIP   = { pistol: false, rifle: false, shotgun: false };
const GUN_SIZES  = { pistol: 0.38, rifle: 0.6, shotgun: 0.66 };

// Characters. If a model walks BACKWARDS, change its value (Math.PI <-> 0).
const CHAR_YAW    = { enemy: Math.PI, teammate: Math.PI, boss: Math.PI };
// Height of each character in metres. Smaller number = smaller model. (average person = 1.7)
// boss = 3.2 means almost twice as tall as a soldier. Change it if you want a bigger / smaller boss.
const CHAR_HEIGHT = { enemy: 1.75, teammate: 1.7, boss: 4.5 };
const HEAVY_SCALE = 1.1;         // heavy enemy is a bit taller than a normal one
const TEAM_MARKER = true;        // small coloured arrow above teammates so you never shoot them
const MARKER_SIZE = 0.8;         // 1 = normal, 0.5 = half size

// Size multiplier for camp pieces (1 = the size written in map1.js). Smaller number = smaller piece.
const CAMP_SCALE = { tent: 0.8, sandbags: 0.8, crates: 0.5, barrels: 0.5, campfire: 0.7 };

/* ---------- Look of each model type (realistic) ---------- */
const STYLE_DRONE  = { bright: 1.15, metal: 0.6, rough: 0.4, env: 0.8, shadows: true };
const STYLE_GUN    = { bright: 1.1,  metal: 0.55, rough: 0.45, env: 0.9 };
const STYLE_PROP   = { bright: 1.15, metal: 0.3, rough: 0.6, env: 0.7, shadows: true };
const STYLE_CRATER = { bright: 1.0,  metal: 0.1, rough: 0.9, env: 0.4, shadows: true };
const STYLE_CHAR   = { bright: 1.0,  metal: 0.5, rough: 0.4, env: 0.8, shadows: true };
const STYLE_CAMP   = { bright: 1.1,  metal: 0.2, rough: 0.7, env: 0.6, shadows: true };

export const DRONE_COLORS = { 3: 0x00f0ff, 2: 0x7b2ff7, 1: 0xff2d95 };

/* ---------- Loading ---------- */
const cache = { drone: null, gun: null, guns: {}, props: [], crater: null, chars: {}, camp: {} };
let cloneSkinned = null;         // SkeletonUtils.clone (needed to copy animated characters)
const loggedSize = {};           // so the size is printed only once per character

// Returns which files loaded
export async function loadAssets() {
  let loader = null;
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js');
    loader = new mod.GLTFLoader();
  } catch (e) {
    console.warn('GLTFLoader not available, using built-in shapes.', e);
    return { drone: false, gun: false, guns: 0, props: 0, crater: false, chars: 0, camp: 0 };
  }

  try {
    const su = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/SkeletonUtils.js');
    cloneSkinned = su.clone;
  } catch (e) {
    console.warn('SkeletonUtils not available, characters may not animate.', e);
  }

  const one = async (path) => {
    try { return (await loader.loadAsync(path)).scene; }
    catch (e) { console.warn('Could not load', path); return null; }
  };
  // tries .glb first, then .gltf. Returns the scene and the animation clips.
  const oneFull = async (base) => {
    for (const ext of ['.glb', '.gltf']) {
      try {
        const g = await loader.loadAsync(base + ext);
        return { scene: g.scene, anims: g.animations || [], file: base + ext };
      } catch (e) { /* try the next extension */ }
    }
    console.warn('Could not load', base + '.glb / .gltf');
    return null;
  };

  const kinds = Object.keys(PATHS.guns);
  const charKeys = Object.keys(PATHS.chars);
  const [drone, gun, crater, gunList, propList, charList, campList] = await Promise.all([
    one(PATHS.drone),
    one(PATHS.gun),
    one(PATHS.crater),
    Promise.all(kinds.map(k => one(PATHS.guns[k]))),
    Promise.all(PATHS.props.map(p => one(p))),
    Promise.all(charKeys.map(k => oneFull(PATHS.chars[k]))),
    Promise.all(PATHS.camp.map(n => oneFull('../models/camp/' + n)))
  ]);

  cache.drone = drone;
  cache.gun = gun;
  cache.crater = crater;
  cache.guns = {};
  kinds.forEach((k, i) => { if (gunList[i]) cache.guns[k] = gunList[i]; });
  cache.props = propList.filter(Boolean);
  cache.chars = {};
  charKeys.forEach((k, i) => {
    if (charList[i]) {
      cache.chars[k] = charList[i];
      console.log('🎞 ' + k + ' animation clips:', charList[i].anims.map(a => a.name));
    }
  });
  cache.camp = {};
  PATHS.camp.forEach((n, i) => { if (campList[i]) cache.camp[n] = campList[i].scene; });

  const gunCount = Object.keys(cache.guns).length;
  console.log('✅ War models loaded:', {
    drone: !!drone, guns: gunCount, fallbackGun: !!gun, props: cache.props.length, crater: !!crater,
    chars: Object.keys(cache.chars), camp: Object.keys(cache.camp)
  });
  return {
    drone: !!cache.drone, gun: !!cache.gun || gunCount > 0, guns: gunCount,
    props: cache.props.length, crater: !!cache.crater,
    chars: Object.keys(cache.chars).length, camp: Object.keys(cache.camp).length
  };
}

/* ---------- Model tools ---------- */

// Keeps the original textures, then adjusts brightness and shine.
// Clones materials (safe to reuse). Colour tint / glow / outline are optional.
export function prepareModel(root, style = {}) {
  const s = { bright: 1, tint: null, tintAmt: 0.15, metal: 0.5, rough: 0.35, env: 1,
              emissive: null, emissiveI: 0.3, edge: null, shadows: false, ...style };
  const meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });

  meshes.forEach(o => {
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = list.map(m => {
      const n = m.clone();
      if (n.color) {
        n.color.multiplyScalar(s.bright);
        if (s.tint && s.tintAmt > 0) n.color.lerp(new THREE.Color(s.tint), s.tintAmt);
      }
      if (n.metalness !== undefined) {
        n.metalness = Math.min(n.metalness, s.metal);
        n.roughness = Math.max(n.roughness, s.rough);
        n.envMapIntensity = s.env;
      }
      if (n.emissive && s.emissive !== null && !n.emissiveMap) {
        n.emissive.set(s.emissive);
        n.emissiveIntensity = s.emissiveI;
      }
      return n;
    });
    o.material = Array.isArray(o.material) ? cloned : cloned[0];

    if (s.shadows) { o.castShadow = true; o.receiveShadow = true; }

    if (NEON_EDGES && s.edge !== null) {
      const lines = new THREE.LineSegments(
        new THREE.EdgesGeometry(o.geometry, 30),
        new THREE.LineBasicMaterial({ color: s.edge, transparent: true, opacity: 0.6, toneMapped: false })
      );
      o.add(lines);
    }
  });
  return root;
}

// Scales a model so its biggest side = targetSize and centres it.
// opt: { alignToZ, yaw, ground }  (ground: true puts the bottom at y = 0)
export function fitModel(root, targetSize, opt = {}) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);

  const holder = new THREE.Group();
  holder.add(root);
  holder.scale.setScalar(targetSize / Math.max(size.x, size.y, size.z, 0.0001));
  holder.rotation.y = ((opt.alignToZ && size.x > size.z) ? Math.PI / 2 : 0) + (opt.yaw || 0);

  const outer = new THREE.Group();
  outer.add(holder);
  if (opt.ground) {
    const b = new THREE.Box3().setFromObject(outer);
    holder.position.y -= b.min.y;
  }
  return outer;
}

// Lets a raycast hit find the game object that owns a mesh.
export function tagOwner(group, owner) {
  group.traverse(o => { o.userData.owner = owner; });
  return group;
}

// Free memory when something is removed from the scene.
export function disposeObject(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    }
  });
}

// Makes a model glow a colour (used for hit flashes and HP colours).
export function setGlow(obj, color, intensity) {
  const c = new THREE.Color(color);
  obj.traverse(o => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (!m.emissive) return;
      if (!m.userData.base) m.userData.base = { c: m.emissive.clone(), i: m.emissiveIntensity };
      m.emissive.copy(c);
      m.emissiveIntensity = intensity;
    });
  });
}

// Puts the original glow back.
export function resetGlow(obj) {
  obj.traverse(o => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (m.userData.base) {
        m.emissive.copy(m.userData.base.c);
        m.emissiveIntensity = m.userData.base.i;
      }
    });
  });
}

/* ---------- Small helpers for code-built shapes ---------- */
function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color, metalness: o.metal ?? 0.15, roughness: o.rough ?? 0.7,
    envMapIntensity: o.env ?? 0.6, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 0
  });
}
// small lights only (eyes, visors, engines): unlit bright colour
function neon(color) {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false });
}
function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  me.position.set(x, y, z);
  return me;
}
function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 16) {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  me.position.set(x, y, z);
  return me;
}
function edgesOn(mesh, color, opacity = 0.7) {
  if (!NEON_EDGES) return;
  mesh.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false })
  ));
}

/* ---------- First-person gun ---------- */
// kind: 'pistol' | 'rifle' | 'shotgun'.  Returns { group, muzzle }.
export function makeGun(kind = 'rifle') {
  const size = GUN_SIZES[kind] || 0.6;
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  const src = cache.guns[kind] || cache.gun;

  if (src) {
    const m = src.clone(true);
    prepareModel(m, STYLE_GUN);
    const flip = !!GUN_FLIP[kind];
    const fitted = fitModel(m, size, { alignToZ: true, yaw: flip ? Math.PI : 0 });
    g.add(fitted);
    const b = new THREE.Box3().setFromObject(g);
    fitted.position.z += 0.2 - b.max.z;                // back of gun at z = 0.2
    const b2 = new THREE.Box3().setFromObject(g);
    muzzle.position.set(0, (b2.min.y + b2.max.y) / 2 + 0.02, b2.min.z);
  } else {
    const dark = mat(0x23262b, { metal: 0.5, rough: 0.5 });
    g.add(box(0.08, 0.12, size, dark, 0, 0, 0.2 - size / 2));
    g.add(box(0.07, 0.16, 0.1, dark, 0, -0.13, 0.1));
    muzzle.position.set(0, 0, 0.2 - size);
  }
  g.add(muzzle);
  return { group: g, muzzle };
}

/* ---------- Air enemies ---------- */
export function makeDrone() {
  const g = new THREE.Group();
  if (cache.drone) {
    const m = cache.drone.clone(true);
    prepareModel(m, STYLE_DRONE);
    g.add(fitModel(m, DRONE_SIZE, { alignToZ: true, yaw: DRONE_YAW }));
  } else {
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(DRONE_SIZE * 0.45), mat(0x3a3f48, { metal: 0.6, rough: 0.4 }));
    g.add(core);
  }
  // Ring under the drone shows its health colour (gameplay info, so it stays coloured)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(DRONE_SIZE * 0.55, 0.03, 8, 32),
    new THREE.MeshBasicMaterial({ color: DRONE_COLORS[3], toneMapped: false })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -DRONE_SIZE * 0.25;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}

// Updates ring colour, and glows the body only after it was hit.
export function refreshDroneLook(d, hp, maxHp = 3, flash = 0) {
  const col = DRONE_COLORS[Math.max(1, Math.min(3, hp))] || DRONE_COLORS[3];
  d.userData.ring.material.color.setHex(col);
  if (flash > 0)          setGlow(d, 0xffffff, 1.6);
  else if (hp < maxHp)    setGlow(d, col, 0.5);
  else                    resetGlow(d);
}

export function makeBomber() {
  const g = new THREE.Group();
  const hull = mat(0x3d4048, { metal: 0.5, rough: 0.5 });
  const body = box(1.4, 0.5, 4, hull);
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 4), hull);
  nose.rotation.x = -Math.PI / 2;
  nose.rotation.z = Math.PI / 4;
  nose.position.z = -2.7;
  g.add(nose);
  [-1, 1].forEach(s => {
    const wing = box(3, 0.12, 1.8, hull, s * 2.1, 0, 0.6);
    wing.rotation.y = s * -0.35;
    g.add(wing);
  });
  const engines = [-0.5, 0.5].map(x => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), neon(0xff7a2a));
    e.position.set(x, 0, 2.1);
    g.add(e);
    return e;
  });
  g.userData.engines = engines;
  g.userData.bombPoint = new THREE.Object3D();
  g.userData.bombPoint.position.set(0, -0.4, 0);
  g.add(g.userData.bombPoint);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/* ---------- Ground characters ---------- */

// Finds the best clip for a job by name (case-insensitive). Returns null if none matches.
function findClip(clips, patterns) {
  for (const p of patterns) {
    const c = clips.find(x => p.test(x.name));
    if (c) return c;
  }
  return null;
}

// Measures a model exactly (every vertex, with the skeleton applied).
function measure(root) {
  root.traverse(o => {
    if (o.isSkinnedMesh) { o.boundingBox = null; o.boundingSphere = null; }
  });
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root, true);
}

// Builds a character from a loaded model. Returns null if that file is not loaded.
// It gives back the SAME userData shape as the code-built soldier,
// so enemies.js and teammates.js work without any change.
function buildCharacter(key, opts) {
  const src = cache.chars[key];
  if (!src) return null;

  const s = opts.scale || 1;
  const H = CHAR_HEIGHT[key] ?? 1.7;          // wanted height in metres (before opts.scale)
  const model = cloneSkinned ? cloneSkinned(src.scene) : src.scene.clone(true);
  prepareModel(model, { ...STYLE_CHAR, tint: opts.tint || null, tintAmt: opts.tintAmt ?? 0 });
  model.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false; });

  // scale by HEIGHT, stand on the floor, centre left/right
  const box3 = measure(model);
  const size = box3.getSize(new THREE.Vector3());
  const center = box3.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box3.min.y, -center.z);

  const holder = new THREE.Group();
  holder.add(model);
  holder.scale.setScalar(H / Math.max(size.y, 0.0001));
  holder.rotation.y = CHAR_YAW[key] ?? 0;

  // double-check: measure the final height and correct it if it is off
  holder.updateMatrixWorld(true);
  const fin = new THREE.Box3().setFromObject(holder, true);
  const realH = fin.max.y - fin.min.y;
  if (realH > 0.01 && Math.abs(realH - H) / H > 0.05) holder.scale.multiplyScalar(H / realH);

  if (!loggedSize[key]) {
    loggedSize[key] = true;
    console.log('📏 ' + key + ': original height', size.y.toFixed(2),
      '| first check', realH.toFixed(2), '| wanted', H);
  }

  const g = new THREE.Group();
  const body = new THREE.Group();
  body.add(holder);
  g.add(body);

  // Same hooks as the code-built soldier (the limbs are empty, only used so nothing crashes)
  const legL = new THREE.Group(), legR = new THREE.Group();
  const armL = new THREE.Group(), armR = new THREE.Group();
  const head = new THREE.Object3D();
  head.position.set(0, H * 0.9, 0);
  body.add(head);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.2, H * 0.68, -0.7);
  body.add(muzzle);

  // Animation: look for walk / run and idle clips by name
  let mixer = null, walkAct = null, idleAct = null;
  const clips = src.anims || [];
  if (clips.length) {
    mixer = new THREE.AnimationMixer(model);
    const walk = findClip(clips, [/walk/i, /run/i, /move/i, /jog/i]);
    const idle = findClip(clips, [/idle/i, /stand/i, /breath/i, /wait/i]);
    if (walk) { walkAct = mixer.clipAction(walk); walkAct.play(); }
    if (idle && idle !== walk) { idleAct = mixer.clipAction(idle); idleAct.play(); }
    if (!walkAct && !idleAct) { idleAct = mixer.clipAction(clips[0]); idleAct.play(); }
    if (walkAct && idleAct) { walkAct.setEffectiveWeight(0); idleAct.setEffectiveWeight(1); }
  }

  // Teammate marker (small arrow above the head)
  if (opts.marker !== undefined && TEAM_MARKER) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.13 * MARKER_SIZE, 0.28 * MARKER_SIZE, 4),
      new THREE.MeshBasicMaterial({ color: opts.marker, toneMapped: false })
    );
    cone.rotation.x = Math.PI;
    cone.position.y = H + 0.3;
    g.add(cone);
  }

  g.scale.setScalar(s);
  g.userData = {
    body, legL, legR, armL, armR, head, muzzle, height: H * s,
    mixer, walkAct, idleAct, blend: 0, lastT: 0, isGlb: true
  };
  return g;
}

// opts: { armor, accent, weapon: 'rifle'|'sniper'|'medic'|'heavy', scale, glb, tint, tintAmt, marker }
export function makeSoldier(opts = {}) {
  if (opts.glb) {
    const c = buildCharacter(opts.glb, opts);
    if (c) return c;
  }

  const armorColor = opts.armor ?? 0x4a5a48;
  const accent = opts.accent ?? 0x00f0ff;
  const weapon = opts.weapon || 'rifle';
  const s = opts.scale || 1;

  const armor = mat(armorColor, { metal: 0.1, rough: 0.8 });
  const pants = mat(new THREE.Color(armorColor).multiplyScalar(0.7), { metal: 0.05, rough: 0.9 });
  const gear  = mat(0x23262b, { metal: 0.3, rough: 0.65 });
  const trim  = mat(accent, { emissive: accent, ei: 0.45, metal: 0.1, rough: 0.5 });
  const glass = mat(0x0a0c10, { emissive: accent, ei: 0.8, metal: 0.4, rough: 0.2 });

  const g = new THREE.Group();
  const body = new THREE.Group();     // everything that bobs while walking
  g.add(body);

  // Legs with boots (pivot at the hip so they can swing)
  const legL = new THREE.Group(); legL.position.set(-0.17, 0.9, 0);
  const legR = new THREE.Group(); legR.position.set(0.17, 0.9, 0);
  [legL, legR].forEach(l => {
    l.add(box(0.22, 0.9, 0.26, pants, 0, -0.45, 0));
    l.add(box(0.25, 0.2, 0.36, gear, 0, -0.82, -0.04));        // boot
    l.add(box(0.24, 0.14, 0.28, gear, 0, -0.4, -0.01));        // knee pad
  });
  g.add(legL, legR);

  // Torso, tactical vest, backpack
  body.add(box(0.62, 0.7, 0.36, armor, 0, 1.25, 0));
  body.add(box(0.5, 0.44, 0.1, gear, 0, 1.3, -0.22));          // chest plate
  body.add(box(0.2, 0.05, 0.02, trim, 0, 1.45, -0.28));        // team tag
  body.add(box(0.42, 0.5, 0.2, gear, 0, 1.3, 0.28));           // backpack
  body.add(box(0.66, 0.1, 0.4, gear, 0, 0.93, 0));             // belt

  // Head, helmet, visor
  const head = box(0.3, 0.3, 0.3, gear, 0, 1.78, 0);
  body.add(head);
  body.add(box(0.36, 0.12, 0.36, armor, 0, 1.94, 0));          // helmet top
  body.add(box(0.26, 0.09, 0.05, glass, 0, 1.8, -0.16));       // visor

  // Arms: right arm holds the weapon forward
  const armL = new THREE.Group(); armL.position.set(-0.4, 1.5, 0);
  const armR = new THREE.Group(); armR.position.set(0.4, 1.5, 0);
  [armL, armR].forEach(a => {
    a.add(box(0.18, 0.6, 0.18, armor, 0, -0.3, 0));
    a.add(box(0.2, 0.08, 0.2, trim, 0, -0.12, 0));             // armband
    a.add(box(0.16, 0.14, 0.16, gear, 0, -0.62, 0));           // glove
  });
  armL.rotation.x = -1.0;
  armR.rotation.x = -1.25;
  body.add(armL, armR);

  // Weapon
  const len = weapon === 'sniper' ? 1.2 : weapon === 'heavy' ? 0.9 : weapon === 'medic' ? 0.45 : 0.75;
  const gunMat = mat(0x15171a, { metal: 0.5, rough: 0.5 });
  body.add(box(0.1, 0.13, len, gunMat, 0.3, 1.3, -0.1 - len / 2));
  body.add(box(0.07, 0.2, 0.09, gunMat, 0.3, 1.16, -0.1 - len / 2 + 0.05));   // magazine
  body.add(box(0.09, 0.16, 0.2, gunMat, 0.3, 1.3, 0.05));                     // stock

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.3, 1.3, -0.1 - len);
  body.add(muzzle);

  // Role details
  if (weapon === 'sniper') {
    body.add(cyl(0.05, 0.05, 0.3, mat(0x101216, { metal: 0.6, rough: 0.4 }), 0.3, 1.42, -0.35).rotateX(Math.PI / 2));
  }
  if (weapon === 'medic') {
    const white = mat(0xe8ece8, { rough: 0.6 });
    const cross = mat(0x3dff9a, { emissive: 0x3dff9a, ei: 0.5 });
    body.add(box(0.3, 0.3, 0.03, white, 0, 1.3, -0.285));
    body.add(box(0.18, 0.06, 0.04, cross, 0, 1.3, -0.29));
    body.add(box(0.06, 0.18, 0.04, cross, 0, 1.3, -0.29));
    body.add(box(0.3, 0.3, 0.03, white, 0, 1.3, 0.39));
  }
  if (weapon === 'heavy') {
    body.add(box(0.9, 0.2, 0.4, armor, 0, 1.6, 0));         // wide shoulders
    body.add(box(0.5, 0.5, 0.06, gear, 0.3, 1.0, -0.25));   // ammo box
  }

  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(s);
  g.userData = { body, legL, legR, armL, armR, head, muzzle, height: 1.95 * s };
  return g;
}

// Squad member look by name: 'alpha' | 'bravo' | 'hawk' | 'doc'
// With a real model the textures stay natural (tiny tint only). The arrow colour tells them apart.
export function makeTeammate(role) {
  const looks = {
    alpha: { armor: 0x3d5a78, accent: 0x00f0ff, weapon: 'rifle',  tint: 0x3d7aff },
    bravo: { armor: 0x4a4a6e, accent: 0x9b5cff, weapon: 'rifle',  tint: 0x9b5cff },
    hawk:  { armor: 0x4a5a3a, accent: 0xffd84a, weapon: 'sniper', tint: 0xffd84a },
    doc:   { armor: 0x3f6a5c, accent: 0x3dff9a, weapon: 'medic',  tint: 0x3dff9a }
  };
  const l = looks[role] || looks.alpha;
  return makeSoldier({ ...l, glb: 'teammate', tintAmt: 0.06, marker: l.accent });
}

// Enemy soldier. kind: 'rifle' | 'heavy'
export function makeEnemySoldier(kind = 'rifle') {
  return makeSoldier({
    armor: kind === 'heavy' ? 0x5a2a2a : 0x4a3a36,
    accent: 0xff2d4a,
    weapon: kind === 'heavy' ? 'heavy' : 'rifle',
    scale: kind === 'heavy' ? HEAVY_SCALE : 1,
    glb: 'enemy',
    tint: 0xff3030,
    tintAmt: kind === 'heavy' ? 0.15 : 0.05
  });
}

/* ---------- BOSS (uses models/characters/boss.glb) ---------- */
// true when boss.glb was loaded
export function hasBoss() {
  return !!cache.chars.boss;
}

// Builds the boss from boss.glb. Returns null if the file is not loaded.
// It has the same userData names as the mech (legL, legR, torso, muzzles, body, height),
// so enemies.js can treat it like a mech. Its size is set by CHAR_HEIGHT.boss (ignores any scale).
export function makeBoss() {
  const g = buildCharacter('boss', { scale: 1, tint: 0xff2020, tintAmt: 0.04 });
  if (!g) return null;
  const u = g.userData;
  const H = u.height;

  // two gun points on the chest (left and right)
  const muzzles = [-1, 1].map(sx => {
    const m = new THREE.Object3D();
    m.position.set(sx * H * 0.18, H * 0.68, -H * 0.3);
    u.body.add(m);
    return m;
  });
  u.torso = u.body;
  u.muzzles = muzzles;
  u.isBoss = true;
  return g;
}

// Walking animation. phase grows over time; amount 0 = standing still.
export function animateWalk(g, phase, amount = 1) {
  const u = g.userData;

  // Real 3D character with animation clips
  if (u.mixer) {
    const now = performance.now();
    const dt = u.lastT ? Math.min(0.1, (now - u.lastT) / 1000) : 0.016;
    u.lastT = now;
    const moving = amount > 0.05;
    if (u.walkAct && u.idleAct) {
      u.blend += ((moving ? 1 : 0) - u.blend) * Math.min(1, dt * 8);
      u.walkAct.setEffectiveWeight(u.blend);
      u.idleAct.setEffectiveWeight(1 - u.blend);
    } else if (u.walkAct) {
      u.walkAct.paused = !moving;            // no idle clip: freeze the walk when standing
    }
    u.mixer.update(dt);
    return;
  }

  // Real 3D character without animation: small bob only
  if (u.isGlb) {
    u.body.position.y = Math.abs(Math.sin(phase)) * 0.05 * amount;
    return;
  }

  // Code-built soldier
  u.legL.rotation.x =  Math.sin(phase) * 0.7 * amount;
  u.legR.rotation.x = -Math.sin(phase) * 0.7 * amount;
  u.body.position.y = Math.abs(Math.sin(phase)) * 0.06 * amount;
}

export function makeTurret() {
  const g = new THREE.Group();
  const hull = mat(0x4d5148, { metal: 0.4, rough: 0.6 });
  const dark = mat(0x15171a, { metal: 0.6, rough: 0.4 });
  const base = cyl(0.8, 1.0, 0.6, hull, 0, 0.3, 0);
  g.add(base);
  const head = new THREE.Group();
  head.position.y = 1.0;
  head.add(box(0.9, 0.55, 0.9, hull));
  const barrel = cyl(0.1, 0.12, 1.3, dark, 0, 0, -0.9);
  barrel.rotation.x = Math.PI / 2;
  head.add(barrel);
  head.add(box(0.5, 0.1, 0.06, neon(0xff2d4a), 0, 0.12, -0.46));   // small red sensor
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -1.6);
  head.add(muzzle);
  g.add(head);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData = { head, muzzle, height: 1.5 };
  return g;
}

// isBoss = true: use boss.glb when it is loaded (otherwise the code-built mech is used)
export function makeMech(scale = 1, isBoss = false) {
  if (isBoss) {
    const b = makeBoss();
    if (b) return b;
  }

  const g = new THREE.Group();
  const hull = mat(0x4d5148, { metal: 0.4, rough: 0.6 });
  const dark = mat(0x1e2024, { metal: 0.5, rough: 0.5 });

  const legL = new THREE.Group(); legL.position.set(-0.9, 2.2, 0);
  const legR = new THREE.Group(); legR.position.set(0.9, 2.2, 0);
  [legL, legR].forEach(l => {
    l.add(box(0.7, 2.2, 0.8, dark, 0, -1.1, 0));
    l.add(box(0.9, 0.3, 1.3, hull, 0, -2.05, -0.2));
  });
  g.add(legL, legR);

  const torso = new THREE.Group();
  torso.position.y = 3.2;
  torso.add(box(2.6, 1.7, 1.6, hull));
  torso.add(box(1.0, 0.3, 0.1, neon(0xff2d4a), 0, 0.35, -0.82));      // red eye
  const muzzles = [-1, 1].map(sx => {
    const arm = box(0.6, 0.7, 1.8, dark, sx * 1.6, 0, -0.5);
    torso.add(arm);
    const m = new THREE.Object3D();
    m.position.set(sx * 1.6, 0, -1.5);
    torso.add(m);
    return m;
  });
  g.add(torso);

  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(scale);
  g.userData = { legL, legR, torso, muzzles, body: torso, height: 4.6 * scale };
  return g;
}

export function animateMech(g, phase, amount = 1) {
  const u = g.userData;
  // boss.glb model: use its own animation
  if (u.isGlb) {
    animateWalk(g, phase, amount);
    return;
  }
  u.legL.rotation.x =  Math.sin(phase) * 0.45 * amount;
  u.legR.rotation.x = -Math.sin(phase) * 0.45 * amount;
  u.torso.position.y = 3.2 + Math.abs(Math.sin(phase)) * 0.08 * amount;
}

/* ---------- Scenery ---------- */
export function makeProp(index = 0, size = 3.5) {
  if (cache.props.length) {
    const src = cache.props[index % cache.props.length];
    const m = src.clone(true);
    prepareModel(m, STYLE_PROP);
    return fitModel(m, size, { ground: true });
  }
  const b = box(size, size * 0.8, size, mat(0x6a6e72, { metal: 0.1, rough: 0.9 }), 0, size * 0.4, 0);
  b.castShadow = true; b.receiveShadow = true;
  const g = new THREE.Group();
  g.add(b);
  return g;
}

/* ---------- Camp pieces ---------- */
// name: 'tent' | 'sandbags' | 'crates' | 'barrels' | 'campfire' (or any name you added to PATHS.camp)
// size: length of the longest side in metres (multiplied by CAMP_SCALE above).   opt: { yaw }
export function hasCampPiece(name) {
  return !!cache.camp[name];
}

export function makeCampPiece(name, size = 3, opt = {}) {
  size = size * (CAMP_SCALE[name] ?? 1);
  const src = cache.camp[name];
  if (src) {
    const m = src.clone(true);
    prepareModel(m, STYLE_CAMP);
    return fitModel(m, size, { ground: true, yaw: opt.yaw || 0 });
  }

  // Code-built stand-ins (used only if the model file is missing)
  const g = new THREE.Group();
  let mesh;
  if (name === 'tent') {
    mesh = new THREE.Mesh(new THREE.ConeGeometry(size * 0.6, size * 0.6, 4), mat(0x5a6046, { rough: 0.9 }));
    mesh.rotation.y = Math.PI / 4;
    mesh.position.y = size * 0.3;
  } else if (name === 'sandbags') {
    mesh = box(size, size * 0.3, size * 0.25, mat(0xa89870, { rough: 0.95 }), 0, size * 0.15, 0);
  } else if (name === 'barrels') {
    mesh = cyl(size * 0.3, size * 0.3, size * 0.55, mat(0x3f4a38, { metal: 0.4, rough: 0.6 }), 0, size * 0.275, 0);
  } else if (name === 'campfire') {
    mesh = cyl(size * 0.4, size * 0.45, size * 0.2, mat(0x2a2622, { rough: 0.95 }), 0, size * 0.1, 0);
  } else {
    mesh = box(size * 0.6, size * 0.6, size * 0.6, mat(0x7a6240, { rough: 0.85 }), 0, size * 0.3, 0);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return g;
}

export function makeCrater(size = 8) {
  if (cache.crater) {
    const m = cache.crater.clone(true);
    prepareModel(m, STYLE_CRATER);
    return fitModel(m, size, { ground: true });
  }
  const r = new THREE.Mesh(
    new THREE.RingGeometry(size * 0.25, size * 0.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
  );
  r.rotation.x = -Math.PI / 2;
  r.position.y = 0.03;
  const g = new THREE.Group();
  g.add(r);
  return g;
}

/* ---------- Pickups and grenade ---------- */
// type: 'ammo' | 'health'
export function makePickup(type = 'health') {
  const g = new THREE.Group();
  const color = type === 'ammo' ? 0xffd84a : 0x3dff9a;
  const shell = type === 'ammo' ? 0x5a5a3a : 0xe8ece8;
  const core = box(0.6, 0.6, 0.6, mat(shell, { metal: 0.2, rough: 0.6, emissive: color, ei: 0.15 }));
  core.castShadow = true;
  g.add(core);
  if (type === 'health') {
    const red = mat(0x2ec27e, { emissive: color, ei: 0.5 });
    g.add(box(0.5, 0.14, 0.64, red));
    g.add(box(0.14, 0.5, 0.64, red));
  } else {
    const brass = mat(0xc9a24a, { metal: 0.7, rough: 0.35 });
    g.add(box(0.16, 0.34, 0.64, brass, -0.14, 0, 0));
    g.add(box(0.16, 0.34, 0.64, brass,  0.14, 0, 0));
  }
  // thin ring on the floor so pickups are easy to spot
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.6, 0.02, 8, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, toneMapped: false })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.5;
  g.add(ring);
  g.userData = { type, core, ring, baseY: 0.9 };
  return g;
}

export function makeGrenade() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), mat(0x3a4a30, { metal: 0.3, rough: 0.6 })));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), neon(0xff2d4a));
  dot.position.y = 0.13;
  g.add(dot);
  return g;
}