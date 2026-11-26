// games/campaign/weapons.js  (v5: soldiers keep the SWAT's built-in pistol, the Space Gang gets one too)
// - Team soldiers: nothing to do (the pistol is part of the SWAT model).
// - Space Gang: the spacesuit model has no gun, so equipEnemy(unit) gives him one.
//     1) preferred: a copy of the SWAT's own pistol, placed exactly like the SWAT holds it
//        (both models share the same Quaternius rig, so the hand fit is the same);
//     2) fallback: models/pistol.glb on the right wrist bone. Tune it in the Console with
//        tuneEnemyGun(x, y, z, rotX, rotY, rotZ)  (metres and degrees, relative to the wrist).
// Same exports as v4 so other files keep working.



import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { spawnCharacter, removeCharacter } from './characters.js';



/* ---------- Knobs ---------- */
const HAND_BONE = 'WristR';                  // right hand bone (used by the fallback)
const SOURCE_NAME = /^pistol$/i;             // the SWAT's built-in pistol node
const FB = {                                 // fallback gun (pistol.glb)
  file: '../models/pistol.glb',
  size: 0.3,                                 // length in metres
  pos: [0, 0.05, 0.05],                      // metres from the wrist
  rot: [0, 0, 0]                             // degrees
};



let mode = 'none';
const tmpV = new THREE.Vector3();



/* ---------- Team soldiers: nothing to do ---------- */
export function equipUnit(unit, kind = 'pistol') {
  return false;            // soldiers keep the pistol that is part of their model
}

export function aimUnit(unit, seconds = 1, target = null) {
  /* not used: the model's own shoot animation is the aim pose */
}



/* ---------- Preferred: copy the SWAT's own pistol ---------- */
let source = null;
let sourceTried = false;

function findSource() {
  if (sourceTried) return source;
  const tmp = spawnCharacter('team', null);          // temporary SWAT, only to read the pistol
  if (!tmp) return null;                             // models not loaded yet: try again later
  sourceTried = true;
  try {
    tmp.model.updateMatrixWorld(true);

    let node = null;
    tmp.model.traverse((o) => { if (!node && !o.isMesh && !o.isBone && SOURCE_NAME.test(o.name)) node = o; });
    if (!node) tmp.model.traverse((o) => { if (!node && SOURCE_NAME.test(o.name)) node = o; });

    let bone = node ? node.parent : null;
    while (bone && !bone.isBone) bone = bone.parent;

    let skinned = false;
    if (node) node.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });

    if (!node) console.log('[weapons] no "Pistol" node found in the SWAT, using the fallback');
    else if (!bone) console.log('[weapons] the SWAT pistol is not attached to a bone, using the fallback');
    else if (skinned) console.log('[weapons] the SWAT pistol is a skinned mesh, using the fallback');
    else {
      const rel = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(node.matrixWorld);
      source = {
        proto: node.clone(true),
        boneName: bone.name,
        rel,
        scale: tmp.model.getWorldScale(new THREE.Vector3()).x
      };
      console.log('[weapons] enemy gun: copy of the SWAT pistol on bone ' + bone.name);
    }
  } catch (e) {
    console.warn('[weapons] could not copy the SWAT pistol', e);
    source = null;
  }
  removeCharacter(tmp, null);
  return source;
}



/* ---------- Fallback: pistol.glb ---------- */
let fbGun = null, fbLoading = false;
const fbWaiting = [];                         // { unit, bone } waiting for the file
const fbAttached = [];                        // { wrap, ws } for live tuning

function loadFallback() {
  if (fbGun || fbLoading) return;
  fbLoading = true;
  new GLTFLoader().load(FB.file, (gltf) => {
    fbGun = gltf.scene;
    fbGun.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    for (const w of fbWaiting.splice(0)) attachFallback(w.unit, w.bone);
  }, undefined, (err) => console.warn('[weapons] could not load ' + FB.file, err));
}

function attachFallback(unit, bone) {
  if (!fbGun) { fbWaiting.push({ unit, bone }); loadFallback(); return; }
  if (unit.gun) return;
  const wrap = new THREE.Group();
  const gun = fbGun.clone(true);
  const box = new THREE.Box3().setFromObject(fbGun);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const centre = box.getCenter(new THREE.Vector3());
  gun.position.sub(centre);                          // centre the model inside the wrapper
  wrap.add(gun);
  bone.add(wrap);
  const ws = bone.getWorldScale(tmpV).x || 1;        // bones inherit the character's scale
  wrap.userData.fit = FB.size / longest;
  fbAttached.push({ wrap, ws });
  applyFallback({ wrap, ws });
  unit.gun = wrap;
  mode = 'pistol.glb on ' + HAND_BONE;
}

function applyFallback(a) {
  const d = Math.PI / 180;
  a.wrap.scale.setScalar(a.wrap.userData.fit / a.ws);
  a.wrap.position.set(FB.pos[0] / a.ws, FB.pos[1] / a.ws, FB.pos[2] / a.ws);
  a.wrap.rotation.set(FB.rot[0] * d, FB.rot[1] * d, FB.rot[2] * d);
}

// Console: tuneEnemyGun(0, 0.05, 0.05, 0, 90, 0)  moves / turns every fallback gun at once
window.tuneEnemyGun = (x = FB.pos[0], y = FB.pos[1], z = FB.pos[2], rx = FB.rot[0], ry = FB.rot[1], rz = FB.rot[2]) => {
  FB.pos = [x, y, z]; FB.rot = [rx, ry, rz];
  for (const a of fbAttached) applyFallback(a);
  console.log('[weapons] enemy gun (fallback) pos', FB.pos, 'rot', FB.rot);
};



/* ---------- Space Gang: give him a pistol ---------- */
export function equipEnemy(unit) {
  if (!unit || unit.gun) return true;
  const src = findSource();
  const bone = unit.model.getObjectByName(src ? src.boneName : HAND_BONE);
  if (!bone) { console.warn('[weapons] bone ' + (src ? src.boneName : HAND_BONE) + ' not found on the enemy'); return false; }

  if (src) {
    const k = src.scale / (unit.model.getWorldScale(tmpV).x || 1);   // same size in the world
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    src.rel.decompose(p, q, s);
    const gun = src.proto.clone(true);
    gun.position.copy(p).multiplyScalar(k);
    gun.quaternion.copy(q);
    gun.scale.copy(s).multiplyScalar(k);
    gun.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    bone.add(gun);
    unit.gun = gun;
    mode = 'copy of the SWAT pistol';
    return true;
  }
  attachFallback(unit, bone);
  return true;
}



export function weaponsInfo() {
  return { mode: 'soldiers: built-in pistol', enemyGun: mode };
}



console.log('[weapons] soldiers use the built-in SWAT pistol; the Space Gang gets one in equipEnemy()');