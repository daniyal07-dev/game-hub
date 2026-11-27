// games/campaign/gun-light.js   (v4)
// Campaign Mode: keeps YOUR weapon looking like the real model, in any weather.
//  1) The gun gets its own small reflection map (War has one; this scene did not),
//     so metal no longer renders black.
//  2) Metal is toned down a little, colour is a little brighter (same idea as War's prepareModel).
//  3) A small fill light that ignores the weather (uses the gun's own texture, so no grey wash).
//  Only things attached to the camera (your weapon) are changed. The world is untouched.
//  The pistol, rifle and shotgun are all handled, also after a weapon swap.
//
//  Console (try it live):
//     gunLight({fill:0.5})                     brighter
//     gunLight({fill:0.15, metal:0.3})         darker / shinier
//     gunLight({metal, rough, bright, env, fill})
//     gunLight(false)  -> original look of the model file      gunLight(true) -> on again
//     gunLight()       -> show the values
//
// Needs to be listed in extras.js MODULES (before 'intro').


import * as THREE from 'three';




/* ---------- Knobs ---------- */
let METAL = 0.15;             // highest metalness allowed (lower = less black)
let ROUGH = 0.50;             // lowest roughness allowed
let BRIGHT = 1.10;            // colour brightness (1 = as in the file)
let ENV = 0.9;                // reflection strength (War uses 0.9)
let FILL = 0.30;              // fixed light on the gun (0 = none, 0.6 = strong)
let ON = true;
const SCAN_EVERY = 0.8;       // seconds between looks for a new weapon




/* ---------- State ---------- */
let camera = null;
let t = 0;
let count = 0;
let envTex = null;
const FILL_U = { value: FILL };
const saved = new Map();      // material -> its original values (only a few materials)




// A small made-up "overcast studio" picture: bright sky, grey horizon, dark floor, a few soft lights.
function makeEnv() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0.00, '#dbe6f2');
  gr.addColorStop(0.48, '#9aa5b2');
  gr.addColorStop(0.52, '#66707b');
  gr.addColorStop(1.00, '#30353c');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(255,255,255,0.75)';                 // soft light panels (give the metal highlights)
  g.fillRect(30, 18, 46, 20);
  g.fillRect(120, 10, 60, 16);
  g.fillRect(205, 24, 36, 18);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}




function apply(m) {
  const s = saved.get(m);
  if (!s) return;
  if (ON) {
    m.color.copy(s.color).multiplyScalar(BRIGHT);
    m.metalness = Math.min(s.metal, METAL);
    m.roughness = Math.max(s.rough, ROUGH);
    m.envMap = envTex;
    m.envMapIntensity = ENV;
  } else {
    m.color.copy(s.color);
    m.metalness = s.metal;
    m.roughness = s.rough;
    m.envMap = s.envMap;
    m.envMapIntensity = s.env;
  }
  m.needsUpdate = true;
}




function scan(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (!m || saved.has(m)) continue;
      // only real lit materials (not flashes, sprites or unlit shapes)
      if (!(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) || !m.color) continue;
      saved.set(m, {
        color: m.color.clone(), metal: m.metalness, rough: m.roughness,
        env: m.envMapIntensity, envMap: m.envMap
      });
      // fixed fill light: the gun's own colour/texture x a constant, a bit stronger from above
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uFill = FILL_U;
        sh.fragmentShader = 'uniform float uFill;\n' + sh.fragmentShader.replace(
          '#include <opaque_fragment>',
          'outgoingLight += diffuseColor.rgb * uFill * (0.65 + 0.35 * normal.y);\n#include <opaque_fragment>'
        );
      };
      m.customProgramCacheKey = () => 'gunfill-v4';
      apply(m);
      count++;
    }
  });
}




window.gunLight = (o) => {
  if (o === false) ON = false;
  else if (o === true) ON = true;
  else if (o && typeof o === 'object') {
    if (typeof o.metal === 'number') METAL = Math.max(0, Math.min(1, o.metal));
    if (typeof o.rough === 'number') ROUGH = Math.max(0, Math.min(1, o.rough));
    if (typeof o.bright === 'number') BRIGHT = Math.max(0, o.bright);
    if (typeof o.env === 'number') ENV = Math.max(0, o.env);
    if (typeof o.fill === 'number') FILL = Math.max(0, o.fill);
    ON = true;
  }
  FILL_U.value = ON ? FILL : 0;
  for (const m of saved.keys()) apply(m);
  console.log('[gun-light] ' + (ON ? 'on' : 'off') + ': metal ' + METAL + ', rough ' + ROUGH +
              ', bright ' + BRIGHT + ', env ' + ENV + ', fill ' + FILL + ' (' + saved.size + ' materials)');
};




export function init(ctx) {
  camera = ctx && ctx.camera;
  if (!camera) { console.warn('[gun-light] no camera, off'); return; }
  envTex = makeEnv();
  FILL_U.value = FILL;
  scan(camera);
  console.log('[gun-light] v4 ready: ' + count + ' gun materials (own reflection map + fill light). ' +
              'Scene has its own environment map: ' + (ctx.scene && ctx.scene.environment ? 'yes' : 'no') +
              '. Console: gunLight({fill:0.5})');
}




export function update(dt) {
  if (!camera) return;
  t -= dt;
  if (t > 0) return;
  t = SCAN_EVERY;
  const before = count;
  scan(camera);
  if (count !== before) console.log('[gun-light] ' + (count - before) + ' more gun materials set');
}