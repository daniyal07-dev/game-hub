// games/campaign/enemy-glow.js   (v1)
// Campaign Mode: every enemy gets a RED OUTLINE (and on PC a soft red halo around it).
//  - Drawn behind the body, so it never shows through walls.
//  - Width is in screen pixels, so it looks the same on any model scale.
//  - Only enemies (getEnemies). Your soldiers and base guards are NOT outlined.
//  - Dead enemies lose the glow. Enemies further than MAX_DIST have no glow (FPS).
//  - Does NOT edit enemies.js, characters.js or any model material.
//
// Console tuning:  enemyGlow({ px: 3, halo: 9, alpha: 0.4, color: [1, 0.1, 0.05] })
//                  enemyGlow(false)  off     enemyGlow(true)  on
//
// Needs to be listed in extras.js MODULES (next message).

import * as THREE from 'three';



/* ---------- Knobs ---------- */
const PHONE = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);

const COLOR = [1.0, 0.07, 0.05];          // red
const OUTLINE_PX = PHONE ? 2.6 : 2.2;     // sharp outline width (screen pixels)
const HALO = !PHONE;                      // soft glow around the outline (PC only)
const HALO_PX = 7;                        // halo width (screen pixels)
const HALO_ALPHA = 0.32;                  // halo strength
const PULSE = 0.12;                       // halo slowly breathes (0 = steady)
const MAX_DIST = 150;                     // no glow further than this (m)



/* ---------- State ---------- */
let scene = null, api = {}, ready = false;
let enabled = true;
let t = 0;
const rigs = new WeakMap();               // enemy -> [outline meshes]
const uRes = { value: new THREE.Vector2(1280, 720) };
const uPxO = { value: OUTLINE_PX };
const uPxH = { value: HALO_PX };
let matO = null, matH = null;
let logged = false;



/* ---------- Materials ---------- */
// Same trick for both: push every vertex outwards along its normal on the SCREEN,
// and draw only the back faces. What sticks out around the body is the outline.
function makeMat(px, halo) {
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color(COLOR[0], COLOR[1], COLOR[2]),
    side: THREE.BackSide, fog: false, toneMapped: false,
    transparent: halo, opacity: halo ? HALO_ALPHA : 1,
    depthWrite: !halo,
    blending: halo ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPx = px;
    shader.uniforms.uRes = uRes;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uPx; uniform vec2 uRes;\nvoid main() {')
      .replace('#include <project_vertex>', `
        #include <project_vertex>
        {
          #ifdef USE_SKINNING
            vec3 gN = objectNormal;
          #else
            vec3 gN = normal;
          #endif
          if (length(gN) > 0.0001) {
            vec3 vn = normalize(normalMatrix * normalize(gN));
            vec2 dir = (projectionMatrix * vec4(vn, 0.0)).xy;
            float l = length(dir);
            if (l > 0.0001) {
              dir /= l;
              gl_Position.xy += dir * uPx * 2.0 / uRes * gl_Position.w;
            }
          }
        }
      `);
  };
  m.customProgramCacheKey = () => 'enemy-glow-v1';
  return m;
}



/* ---------- Put outlines on one enemy ---------- */
function attach(e) {
  const group = e.char && e.char.group;
  if (!group) return [];
  const sources = [];
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.userData.nsGlow || !o.visible) return;
    const mt = o.material;
    if (mt && !Array.isArray(mt) && mt.transparent && mt.opacity < 0.6) return;   // skip glass / flashes
    sources.push(o);
  });
  const made = [];
  const mats = matH ? [matO, matH] : [matO];
  for (const src of sources) {
    if (!src.parent) continue;
    for (const mat of mats) {
      let o;
      if (src.isSkinnedMesh && src.skeleton) {
        o = new THREE.SkinnedMesh(src.geometry, mat);
        o.bindMode = src.bindMode;
        o.bind(src.skeleton, src.bindMatrix);              // same bones = it animates with the enemy
      } else {
        o = new THREE.Mesh(src.geometry, mat);
      }
      o.position.copy(src.position);
      o.quaternion.copy(src.quaternion);
      o.scale.copy(src.scale);
      o.userData.nsGlow = true;
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = false;
      o.renderOrder = halo(mat) ? 3 : 2;
      src.parent.add(o);
      made.push(o);
    }
  }
  return made;
}
const halo = (mat) => mat === matH;



/* ---------- Extras module API ---------- */
export function init(ctx) {
  api = ctx || {};
  scene = api.scene;
  if (!scene) { console.warn('[enemy-glow] no scene, glow off'); return; }
  matO = makeMat(uPxO, false);
  matH = HALO ? makeMat(uPxH, true) : null;
  ready = true;

  window.enemyGlow = (o) => {
    if (o === false) { enabled = false; console.log('[enemy-glow] off'); return; }
    if (o === true) { enabled = true; console.log('[enemy-glow] on'); return; }
    if (o && typeof o === 'object') {
      if (typeof o.px === 'number') uPxO.value = o.px;
      if (typeof o.halo === 'number') uPxH.value = o.halo;
      if (typeof o.alpha === 'number' && matH) matH.opacity = o.alpha;
      if (Array.isArray(o.color)) {
        matO.color.setRGB(o.color[0], o.color[1], o.color[2]);
        if (matH) matH.color.setRGB(o.color[0], o.color[1], o.color[2]);
      }
    }
    console.log('[enemy-glow] outline ' + uPxO.value + ' px' + (matH ? ', halo ' + uPxH.value + ' px, alpha ' + matH.opacity : ''));
  };
  console.log('[enemy-glow] ready: red outline' + (HALO ? ' + halo' : ' (phone: outline only)') + ". Console: enemyGlow({px:3})");
}

export function update(dt, ctx) {
  if (!ready) return;
  const c = ctx || api;
  const list = (c.getEnemies ? c.getEnemies() : (api.getEnemies ? api.getEnemies() : [])) || [];
  const player = c.player || api.player || { x: 0, z: 0 };
  t += dt;
  uRes.value.set(window.innerWidth, window.innerHeight);
  if (matH) matH.opacity = Math.max(0, HALO_ALPHA * (1 + PULSE * Math.sin(t * 3.2)));

  for (const e of list) {
    if (!e || !e.char) continue;
    let rig = rigs.get(e);
    if (!rig) {
      rig = attach(e);
      rigs.set(e, rig);
      if (!logged) {
        logged = true;
        console.log('[enemy-glow] first enemy: ' + rig.length + ' outline meshes added' +
                    (rig.length ? '' : ' (none found: tell me)'));
      }
    }
    const vis = enabled && !e.dead && Math.hypot(player.x - e.x, player.z - e.z) < MAX_DIST;
    for (const o of rig) if (o.visible !== vis) o.visible = vis;
  }
}

export function reset() { /* enemies are rebuilt after a restart, new outlines are added automatically */ }