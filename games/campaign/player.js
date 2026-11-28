// ============================================================
//  NOVA STRIKE 3D — Campaign: games/campaign/player.js  (v11)
//  The player's own first-person weapon.
//     Left mouse = fire     Wheel / Q = switch     R = reload
//  Hitscan: a ray from the camera. Walls and the ground stop it,
//  enemies are tested as upright capsules (head = x2 damage).
//  Guns are the same free models War uses (root models/ folder).
//  v3: fire timer keeps leftover time, recoil recovers.
//  v4: gun look copied from War (items.js).
//  v5: no sound code here, only events to extras.js.
//  v6: phone hook setFireHeld(on).
//  v7: real muzzle tip of each gun model is measured on load.
//  v9: NO LINES AT ALL. The player's shots show only a bright
//      muzzle flash (white-hot core + orange glow) at the barrel
//      tip, a different size/rotation each shot, plus a quick warm
//      light pulse on PC. Damage, hits, recoil are unchanged.
//      Console: tuneFlash(bright, light)   tuneMuzzle(kind,dx,dy,dz)
//  v10: RECOIL IS NOW TINY. One knob (RECOIL) scales both the camera
//      kick and the gun's visual kick. 0 = none, 1 = the old v9 feel.
//      Saved on this device (campaign_recoil) so the settings screen
//      can use it later.   Console: tuneRecoil(0..1)
//  v11: no shooting, reloading or weapon swapping while you drive the
//      truck (vehicles.js). This also stops the phone FIRE button.
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { blockedAt, groundHeight } from './collision.js';
import { getEnemies, hurtEnemy } from './enemies.js';
import { extrasEvent } from './extras.js';



// ---------- knobs ----------
const ROOT = [0.24, -0.24, -0.42];     // gun root in front of the camera (same as War)
const ORDER = ['pistol', 'rifle', 'shotgun'];
const WEAPONS = {
  pistol:  { name: 'PISTOL',  mag: 12, dmg: 28, rate: 0.28, auto: false, pellets: 1, spread: 0.5, bloom: 0.0,
             range: 70,  falloff: 0.30, reloadTime: 1.0, kick: 0.5, camKick: 0.012, size: 0.38,
             file: '../models/pistol.glb',  pos: [0, 0, 0],           yaw: 0,   thick: 1,   len: 1 },
  rifle:   { name: 'RIFLE',   mag: 40, dmg: 18, rate: 0.11, auto: true,  pellets: 1, spread: 1.0, bloom: 0.2,
             range: 130, falloff: 0.35, reloadTime: 1.5, kick: 0.35, camKick: 0.006, size: 0.6,
             file: '../models/rifle.glb',   pos: [0.05, -0.03, 0.06], yaw: 2.3, thick: 1.8, len: 1 },
  shotgun: { name: 'SHOTGUN', mag: 6,  dmg: 14, rate: 0.85, auto: false, pellets: 8, spread: 4.5, bloom: 0.0,
             range: 35,  falloff: 0.90, reloadTime: 2.3, kick: 1.0, camKick: 0.030, size: 0.66,
             file: '../models/shotgun.glb', pos: [0.05, -0.03, 0.06], yaw: 2.3, thick: 1.8, len: 1 },
};
const START_WEAPON = 1;       // rifle
const HIT_R = 0.5;            // enemy body radius for shots
const BODY_H = 1.85;          // enemy height for shots
const HEAD_Y = 1.5;           // above this height = headshot
const HEAD_MULT = 2;
const FOOT = 0.15;            // same lift characters.js uses
const WALL_STEP = 0.75;       // wall check step along the ray
const WALL_TOP = 14;          // above this height shots fly over buildings
const SWAP_TIME = 0.14;
const HUD_BOTTOM = 78;        // px: ammo counter sits above the NOVA badge
const RECOIL_BACK = 7;        // how fast the aim settles after shooting (bigger = faster)
const RECOIL_KEY = 'campaign_recoil';
let RECOIL = 0.10;            // recoil strength: 0 = none, 1 = old feel (v9 = 1)



// muzzle flash
const MUZZLE_SLICE = 0.03;    // front 3 cm of the gun model = the muzzle
const FLASH_TIME = 0.06;      // seconds one flash lasts
const FLASH_MIN = 0.22, FLASH_MAX = 0.34;   // glow size range (random each shot)
const CORE_RATIO = 0.5;       // white core size compared to the glow
let FLASH_BRIGHT = 1.8;       // colour strength of the flash (1 = old look, 2.5 = very hot)
let LIGHT_POWER = 6;          // strength of the warm light pulse (PC only, 0 = off)


try {
  const saved = parseFloat(localStorage.getItem(RECOIL_KEY));
  if (isFinite(saved)) RECOIL = Math.max(0, Math.min(1.5, saved));
} catch (e) { /* storage blocked: keep the default */ }



// ---------- state ----------
let cam = null, holder = null, flash = null, flashCore = null, flashLight = null, ready = false, isActive = false;
const models = {};
const view = {};               // per-gun tweakable pose {pos, yaw, thick, len}
const tips = {};               // per-gun muzzle tip (in the model's own space)
const off = {};                // per-gun muzzle nudge (in gun-root space), for tuneMuzzle
const ammo = {};
let cur = START_WEAPON, pending = null, lower = 0;
let fireT = 0, reloading = false, reloadT = 0;
let holding = false, clickBuf = 0, wheelT = 0;
let kick = 0, bloom = 0, bobT = 0, bobK = 0, flashT = 0, recoil = 0;
let hitT = 0, hitKill = false, feedT = 0, feedText = '';
const stats = { shots: 0, hits: 0, kills: 0, heads: 0 };
let hud, hudLast = '', hitEl, feedEl, warned = false;



const O = new THREE.Vector3(), D = new THREE.Vector3(), T1 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const P = { x: 0, z: 0 };



for (const k of ORDER) {
  const w = WEAPONS[k];
  view[k] = { pos: w.pos.slice(), yaw: w.yaw * Math.PI / 180, thick: w.thick, len: w.len };
  off[k] = [0, 0, 0];
}



// ---------- helpers ----------
const W = () => WEAPONS[ORDER[cur]];



// true while the player is driving the army truck (vehicles.js)
function driving() {
  const t = window.campaignTruck;
  return !!(t && typeof t.isDriving === 'function' && t.isDriving());
}



function posOf(e) {
  if (typeof e.x === 'number' && typeof e.z === 'number') { P.x = e.x; P.z = e.z; return P; }
  const u = e.unit || e.u || e;
  const g = u.group || u.model || e.group || e.model;
  if (g && g.position) { P.x = g.position.x; P.z = g.position.z; return P; }
  return null;
}
function isDead(e) {
  return !!(e.dead || (e.unit && e.unit.dead) || e.state === 'dead' ||
            (typeof e.hp === 'number' && e.hp <= 0));
}



// ---------- sound events (sound.js plays them) ----------
function ev(name, data) {
  try { extrasEvent(name, data || {}); } catch (e) { /* sound is optional */ }
}



// ---------- HUD (made in code, no HTML edit needed) ----------
function mk(css) {
  const el = document.createElement('div');
  el.style.cssText = css;
  document.body.appendChild(el);
  return el;
}
function makeHud() {
  hud = mk('position:fixed;right:22px;bottom:' + HUD_BOTTOM + 'px;display:none;text-align:right;color:#e8f4ff;' +
           'font:700 13px Consolas,monospace;letter-spacing:1px;text-shadow:0 0 6px #000;' +
           'pointer-events:none;z-index:20;');
  hud.id = 'gun-hud';
  hitEl = mk('position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);font:700 28px sans-serif;' +
             'color:#fff;opacity:0;pointer-events:none;z-index:21;text-shadow:0 0 6px #000;');
  hitEl.textContent = '✕';
  feedEl = mk('position:fixed;left:50%;top:60%;transform:translateX(-50%);font:700 18px Consolas,monospace;' +
              'letter-spacing:2px;color:#ff5a4a;opacity:0;pointer-events:none;z-index:21;text-shadow:0 0 8px #000;');
}
function drawHud() {
  const w = W(), k = ORDER[cur];
  const line = reloading ? 'RELOADING…' : (ammo[k] + ' / ' + w.mag);
  const html = '<div style="font-size:11px;opacity:.7">' + w.name + '</div>' +
               '<div style="font-size:26px;color:' + (ammo[k] === 0 ? '#ff5a4a' : '#7fe8ff') + '">' + line + '</div>' +
               '<div class="gun-hint" style="font-size:10px;opacity:.55">Q / wheel switch · R reload</div>';
  if (html !== hudLast) { hud.innerHTML = html; hudLast = html; }
}



// ---------- loading the gun models ----------
// Same fitting as War's fitModel + makeGun: long side = size, centred left/right and up/down,
// back of the gun at z = 0.2, muzzle toward -z.
function fit(root, size) {
  const wrap = new THREE.Group();
  wrap.add(root);
  let box = new THREE.Box3().setFromObject(root);
  let s = box.getSize(new THREE.Vector3());
  if (s.x > s.z * 1.2 && s.x >= s.y) root.rotation.y = Math.PI / 2;   // long axis -> Z
  box.setFromObject(root); s = box.getSize(new THREE.Vector3());
  root.scale.setScalar(size / Math.max(s.x, s.y, s.z, 0.0001));
  box.setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.x -= c.x;
  root.position.y -= c.y;
  root.position.z += 0.2 - box.max.z;
  return wrap;
}
function placeholder(size) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, size),
                           new THREE.MeshStandardMaterial({ color: 0x222222 }));
  m.position.z = 0.2 - size / 2;
  g.add(m);
  return g;
}



// finds the front tip of a gun (average of the vertices in the front few cm).
// Called while the wrapper has no parent and no pose, so the numbers are model space.
function findTip(wrap) {
  wrap.updateMatrixWorld(true);
  const meshes = [];
  wrap.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes.position) meshes.push(o); });
  const v = new THREE.Vector3();
  let minZ = Infinity;
  for (const o of meshes) {
    const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
      if (v.z < minZ) minZ = v.z;
    }
  }
  if (!isFinite(minZ)) throw new Error('no vertices');
  let sx = 0, sy = 0, n = 0;
  for (const o of meshes) {
    const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
      if (v.z <= minZ + MUZZLE_SLICE) { sx += v.x; sy += v.y; n++; }
    }
  }
  return new THREE.Vector3(n ? sx / n : 0, n ? sy / n : 0, minZ);
}



// the muzzle of a gun in GUN-ROOT space (with the gun's own pose and tuneGun applied)
function muzzleLocal(kind, out) {
  const m = models[kind], t = tips[kind];
  if (!m || !t) return out.set(0.05, 0, -0.4);
  m.updateMatrix();
  out.copy(t).applyMatrix4(m.matrix);
  const o = off[kind];
  out.x += o[0]; out.y += o[1]; out.z += o[2];
  return out;
}



function applyView(kind) {
  const m = models[kind]; if (!m) return;
  const v = view[kind];
  m.position.set(v.pos[0], v.pos[1], v.pos[2]);
  m.rotation.y = v.yaw;
  m.scale.set(v.thick, v.thick, v.len);
}
function showCur() {
  for (const k of ORDER) if (models[k]) models[k].visible = (k === ORDER[cur]);
  const k = ORDER[cur];
  if (flash) {
    muzzleLocal(k, T1);
    T1.z -= 0.02;                         // a little in front of the tip
    flash.position.copy(T1);
    if (flashCore) flashCore.position.copy(T1);
    if (flashLight) flashLight.position.copy(T1);
  }
}
async function loadGun(kind, loader) {
  const w = WEAPONS[kind];
  let wrap, tip = null;
  try {
    const gltf = await loader.loadAsync(w.file);
    wrap = fit(gltf.scene, w.size);
    const b = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    console.log('[player] ' + kind + ' loaded, size ' + b.x.toFixed(2) + ' x ' + b.y.toFixed(2) + ' x ' + b.z.toFixed(2) + ' m');
  } catch (err) {
    console.warn('[player] could not load ' + w.file + ' - using a plain block instead', err);
    wrap = placeholder(w.size);
    tip = new THREE.Vector3(0, 0, 0.2 - w.size);
  }
  if (!tip) {
    try { tip = findTip(wrap); }
    catch (err) { tip = new THREE.Vector3(0, 0.02, 0.2 - w.size); console.warn('[player] muzzle tip guessed for ' + kind, err); }
  }
  tips[kind] = tip;
  console.log('[player] ' + kind + ' muzzle tip: x ' + tip.x.toFixed(3) + ' y ' + tip.y.toFixed(3) + ' z ' + tip.z.toFixed(3));
  wrap.traverse(o => { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; });
  models[kind] = wrap;
  holder.add(wrap);
  applyView(kind);
  showCur();
  if (ORDER.every(k => models[k])) ready = true;
}



// ---------- muzzle flash pictures (drawn in code) ----------
function makeFlashSprite(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (kind === 'glow') {
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 63);
    gr.addColorStop(0, 'rgba(255,248,205,1)');
    gr.addColorStop(0.25, 'rgba(255,195,85,0.85)');
    gr.addColorStop(0.60, 'rgba(255,125,30,0.30)');
    gr.addColorStop(1, 'rgba(255,90,10,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  } else {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 46);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,235,1)');
    gr.addColorStop(0.75, 'rgba(255,225,150,0.35)');
    gr.addColorStop(1, 'rgba(255,200,100,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    // short bright spikes around the core
    g.fillStyle = 'rgba(255,255,230,0.95)';
    const spikes = [60, 38, 54, 34, 58, 40];
    for (let i = 0; i < spikes.length; i++) {
      const a = i * Math.PI / spikes.length * 2 + 0.3;
      g.beginPath();
      g.moveTo(64 + Math.cos(a + 1.5708) * 4, 64 + Math.sin(a + 1.5708) * 4);
      g.lineTo(64 + Math.cos(a) * spikes[i], 64 + Math.sin(a) * spikes[i]);
      g.lineTo(64 + Math.cos(a - 1.5708) * 4, 64 + Math.sin(a - 1.5708) * 4);
      g.closePath();
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, blending: THREE.AdditiveBlending, transparent: true,
    depthTest: false, depthWrite: false, toneMapped: false }));
  s.visible = false;
  s.renderOrder = kind === 'glow' ? 998 : 999;
  return s;
}
function paintFlashColor() {
  const b = FLASH_BRIGHT;
  if (flash) flash.material.color.setRGB(b, b * 0.92, b * 0.75);
  if (flashCore) flashCore.material.color.setRGB(b, b, b * 0.95);
}



// ---------- tuning from the Console ----------
// tuneGun("rifle", x, y, z, yawDegrees, thickness, length)  (numbers are offsets from War's root)
window.tuneGun = function (kind, x, y, z, yawDeg = 0, thick = 1, len = 1) {
  if (!view[kind]) { console.log('tuneGun: kind must be pistol, rifle or shotgun'); return; }
  view[kind].pos = [x, y, z];
  view[kind].yaw = yawDeg * Math.PI / 180;
  view[kind].thick = thick;
  view[kind].len = len;
  applyView(kind); showCur();
  console.log('[player] ' + kind + ' view -> tuneGun("' + kind + '", ' + x + ', ' + y + ', ' + z + ', ' +
              yawDeg + ', ' + thick + ', ' + len + ')');
};


// tuneFlash(bright, light): flash colour strength (1.8 now) and light pulse (6 now, 0 = off).
window.tuneFlash = function (bright, light) {
  if (typeof bright === 'number') { FLASH_BRIGHT = Math.max(0.3, bright); paintFlashColor(); }
  if (typeof light === 'number') LIGHT_POWER = Math.max(0, light);
  console.log('[player] flash brightness ' + FLASH_BRIGHT + ', light pulse ' + LIGHT_POWER +
              (flashLight ? '' : ' (no light on phones)'));
};


// tuneRecoil(amount): 0 = no recoil at all, 0.1 = tiny (default), 1 = the old v9 feel.
// The number is saved on this device. No argument = show the current value.
window.tuneRecoil = function (amount) {
  if (typeof amount === 'number') {
    RECOIL = Math.max(0, Math.min(1.5, amount));
    try { localStorage.setItem(RECOIL_KEY, String(RECOIL)); } catch (e) { /* ignore */ }
  }
  console.log('[player] recoil strength ' + RECOIL + '  (0 = none, 1 = old feel)');
};


// old name kept so nothing breaks: the player no longer draws any line
window.tuneTracer = function () {
  console.log('[player] v11 has no player tracer line. Use tuneFlash(bright, light) for the flash.');
};


// tuneMuzzle("rifle", dx, dy, dz) nudges where the flash starts (metres, gun-root space).
//     dx + = right, dy + = up, dz - = further forward.  tuneMuzzle("rifle",0,0,0) resets.
window.tuneMuzzle = function (kind, dx, dy, dz) {
  if (!off[kind]) { console.log('tuneMuzzle: kind must be pistol, rifle or shotgun'); return; }
  if (typeof dx === 'number') off[kind] = [dx, dy || 0, dz || 0];
  showCur();
  console.log('[player] ' + kind + ' muzzle nudge: ' + off[kind].join(', '));
};



// ---------- init ----------
export function initPlayerGun(camera, scene) {
  cam = camera;
  if (!cam.parent) scene.add(cam);
  if (cam.near > 0.1) { cam.near = 0.1; cam.updateProjectionMatrix(); }


  holder = new THREE.Group();                     // = War's gunRoot
  holder.position.set(ROOT[0], ROOT[1], ROOT[2]);
  holder.visible = false;
  cam.add(holder);


  // muzzle flash: orange glow + white-hot core
  flash = makeFlashSprite('glow');
  flashCore = makeFlashSprite('core');
  flash.scale.set(0.26, 0.26, 1);
  flashCore.scale.set(0.13, 0.13, 1);
  holder.add(flash);
  holder.add(flashCore);
  paintFlashColor();


  // quick warm light pulse on each shot (PC only, to save fps on phones)
  const IS_PHONE = (typeof matchMedia === 'function' &&
                    matchMedia('(hover: none) and (pointer: coarse)').matches);
  if (!IS_PHONE) {
    flashLight = new THREE.PointLight(0xffc36b, 0, 5, 2);
    holder.add(flashLight);
  }
  showCur();


  makeHud();


  for (const k of ORDER) ammo[k] = WEAPONS[k].mag;
  const loader = new GLTFLoader();
  for (const k of ORDER) loadGun(k, loader);


  // mouse
  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || !document.pointerLockElement) return;
    if (driving()) return;
    holding = true; clickBuf = 0.18;
  });
  document.addEventListener('mouseup', e => { if (e.button === 0) holding = false; });
  window.addEventListener('blur', () => { holding = false; });
  document.addEventListener('wheel', e => {
    if (!document.pointerLockElement || !isActive) return;
    if (driving()) return;
    if (wheelT > 0) return;
    wheelT = 0.2;
    switchTo((cur + (e.deltaY > 0 ? 1 : ORDER.length - 1)) % ORDER.length);
  }, { passive: true });


  console.log('[player] v11 ready: recoil ' + RECOIL + ', bright muzzle flash, no lines' +
              (flashLight ? ', light pulse on' : ', light pulse off (phone)'));
}



// ---------- phone hook (touch.js calls this from the FIRE button) ----------
export function setFireHeld(on) {
  if (on && !driving()) { holding = true; clickBuf = 0.18; }
  else holding = false;
}



// ---------- actions ----------
function switchTo(i) {
  if (i === cur || pending !== null) return;
  pending = i;
  reloading = false;
  ev('swap', { kind: ORDER[i] });
}
function startReload() {
  const w = W(), k = ORDER[cur];
  if (reloading || ammo[k] >= w.mag || pending !== null) return;
  reloading = true; reloadT = w.reloadTime;
  ev('reload', { kind: k, time: w.reloadTime });
}



// cast one invisible ray: returns {t, enemy, head}
function castRay(dx, dy, dz, range, enemies) {
  let wall = range;
  for (let t = 0.5; t <= range; t += WALL_STEP) {
    const x = O.x + dx * t, y = O.y + dy * t, z = O.z + dz * t;
    if (y < groundHeight(x, z)) { wall = t; break; }
    if (y < WALL_TOP && blockedAt(x, z, 0.05)) { wall = t; break; }
  }
  const out = { t: wall, enemy: null, head: false };
  const h2 = dx * dx + dz * dz;
  if (h2 < 1e-6) return out;
  let best = wall;
  for (const e of enemies) {
    if (isDead(e)) continue;
    const p = posOf(e);
    if (!p) { if (!warned) { warned = true; console.warn('[player] cannot read enemy position. Enemy fields:', Object.keys(e)); } continue; }
    const rx = p.x - O.x, rz = p.z - O.z;
    const tc = (rx * dx + rz * dz) / h2;
    const perp2 = rx * rx + rz * rz - tc * tc * h2;
    if (perp2 > HIT_R * HIT_R) continue;
    const half = Math.sqrt((HIT_R * HIT_R - perp2) / h2);
    if (tc + half < 0) continue;
    const t0 = Math.max(0, tc - half);
    if (t0 > best) continue;
    const gy = groundHeight(p.x, p.z) + FOOT;
    for (const t of [t0, Math.max(t0, Math.min(tc, tc + half))]) {
      const y = O.y + dy * t;
      if (y >= gy && y <= gy + BODY_H) {
        best = t; out.t = t; out.enemy = e; out.head = (y - gy) > HEAD_Y;
        break;
      }
    }
  }
  return out;
}



function fire(player, dt) {
  const w = W(), k = ORDER[cur];
  ammo[k]--; stats.shots++;
  fireT = Math.max(fireT, -dt) + w.rate;             // keep the leftover time, so the true fire rate is kept
  kick = Math.min(1.2, kick + w.kick * RECOIL);      // gun's visual kick (scaled by RECOIL)


  // muzzle flash: new size and rotation every shot
  flashT = FLASH_TIME;
  const s = FLASH_MIN + Math.random() * (FLASH_MAX - FLASH_MIN);
  const grow = k === 'shotgun' ? 1.25 : 1;
  flash.scale.set(s * grow, s * grow, 1);
  flash.material.rotation = Math.random() * 6.28;
  flashCore.scale.set(s * CORE_RATIO * grow, s * CORE_RATIO * grow, 1);
  flashCore.material.rotation = Math.random() * 6.28;
  ev('shot', { kind: k });


  // camera kick (scaled by RECOIL), remembered so it can settle back later
  const nudge = w.camKick * RECOIL * (0.7 + Math.random() * 0.6);
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch + nudge));
  recoil += nudge;


  cam.getWorldPosition(O);
  cam.getWorldDirection(D);


  const speed = Math.hypot(player.vx || 0, player.vz || 0);
  const spread = (w.spread * (1 + speed * 0.12) + bloom) * Math.PI / 180;
  bloom = Math.min(2.5, bloom + w.bloom);


  const right = new THREE.Vector3().crossVectors(D, UP);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, D);


  const enemies = getEnemies();
  const dmgMap = new Map();
  const dir = new THREE.Vector3();


  for (let i = 0; i < w.pellets; i++) {
    const r = Math.tan(spread) * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    dir.copy(D).addScaledVector(right, r * Math.cos(a)).addScaledVector(up, r * Math.sin(a)).normalize();
    const hit = castRay(dir.x, dir.y, dir.z, w.range, enemies);
    if (hit.enemy) {
      const fall = 1 - w.falloff * Math.min(1, hit.t / w.range);
      const dmg = w.dmg * fall * (hit.head ? HEAD_MULT : 1);
      const rec = dmgMap.get(hit.enemy) || { dmg: 0, head: false };
      rec.dmg += dmg; rec.head = rec.head || hit.head;
      dmgMap.set(hit.enemy, rec);
    }
  }


  for (const [e, rec] of dmgMap) {
    const died = hurtEnemy(e, Math.max(1, Math.round(rec.dmg)), { x: O.x, z: O.z });
    stats.hits++;
    hitT = 0.25; hitKill = !!died;
    if (died) {
      stats.kills++; if (rec.head) stats.heads++;
      feedText = rec.head ? 'HEADSHOT · ENEMY DOWN' : 'ENEMY DOWN';
      feedT = 1.4;
      ev('kill', { head: !!rec.head });
    } else {
      ev('hit', { head: !!rec.head });
    }
  }
}



// ---------- keys (called from main.js) ----------
export function handleGunKey(code) {
  if (!isActive) return false;
  if (driving()) return false;
  if (code === 'KeyQ') { switchTo((cur + 1) % ORDER.length); return true; }
  if (code === 'KeyR') { startReload(); return true; }
  return false;
}



// ---------- per frame (call AFTER the camera has been positioned) ----------
export function updatePlayerGun(dt, player, playing) {
  if (!holder) return;
  isActive = !!playing && !player.dead;
  hud.style.display = isActive ? 'block' : 'none';
  holder.visible = isActive && ready;
  if (!isActive) {
    holding = false; recoil = 0; flashT = 0;
    hitEl.style.opacity = 0; feedEl.style.opacity = 0;
    flash.visible = false; flashCore.visible = false;
    if (flashLight) flashLight.intensity = 0;
    return;
  }


  fireT -= dt; clickBuf -= dt; wheelT -= dt; flashT -= dt;
  bloom = Math.max(0, bloom - dt * 3);
  kick *= Math.exp(-dt * 14);


  // driving the truck: no firing at all (covers the phone FIRE button too)
  if (driving()) { holding = false; clickBuf = 0; }


  // weapon swap: lower -> change -> raise
  if (pending !== null) {
    lower += dt / SWAP_TIME;
    if (lower >= 1) { lower = 1; cur = pending; pending = null; showCur(); }
  } else if (lower > 0) {
    lower = Math.max(0, lower - dt / SWAP_TIME);
  }


  // reload
  if (reloading) {
    reloadT -= dt;
    if (reloadT <= 0) { reloading = false; ammo[ORDER[cur]] = W().mag; }
  }


  // firing
  const w = W(), k = ORDER[cur];
  const want = w.auto ? holding : clickBuf > 0;
  if (want && fireT <= 0 && !reloading && pending === null && lower < 0.2) {
    if (ammo[k] > 0) { fire(player, dt); clickBuf = 0; }
    else { clickBuf = 0; ev('empty', { kind: k }); startReload(); }
  }
  if (ammo[k] === 0 && !reloading && fireT <= 0 && pending === null) startReload();


  // recoil settles back when you stop shooting
  if (fireT < -0.12 && recoil > 0.0001) {
    const back = recoil * Math.min(1, dt * RECOIL_BACK);
    player.pitch -= back;
    recoil -= back;
  }


  // pose (same idea as War): walking bob + recoil kick + reload dip + swap lowering,
  // all turning around the gun root
  const speed = player.grounded ? Math.hypot(player.vx || 0, player.vz || 0) : 0;
  bobK += (Math.min(speed / 6, 1.5) - bobK) * Math.min(1, dt * 8);
  bobT += dt * (4 + speed * 0.9);
  const bx = Math.sin(bobT) * 0.006 * bobK;
  const by = -Math.abs(Math.cos(bobT)) * 0.008 * bobK;
  const p = reloading ? 1 - reloadT / Math.max(0.01, w.reloadTime) : 0;
  const dip = reloading ? Math.sin(Math.min(1, p) * Math.PI) : 0;
  holder.position.set(ROOT[0] + bx, ROOT[1] + by - dip * 0.12 - lower * 0.3, ROOT[2] + kick * 0.05);
  holder.rotation.set(kick * 0.06 + dip * 0.5 + lower * 0.5, 0, -dip * 0.25);


  // flash: full strength for most of its life, then a quick fade
  const on = flashT > 0 && pending === null;
  flash.visible = on;
  flashCore.visible = on;
  if (on) {
    const f = Math.min(1, flashT / (FLASH_TIME * 0.6));
    flash.material.opacity = f;
    flashCore.material.opacity = f;
  }
  if (flashLight) flashLight.intensity = on ? LIGHT_POWER * Math.min(1, flashT / (FLASH_TIME * 0.6)) : 0;


  // hit marker + kill text
  if (hitT > 0) {
    hitT -= dt;
    hitEl.style.opacity = Math.max(0, hitT / 0.25);
    hitEl.style.color = hitKill ? '#ff3b3b' : '#ffffff';
    hitEl.style.fontSize = hitKill ? '38px' : '28px';
  } else hitEl.style.opacity = 0;
  if (feedT > 0) {
    feedT -= dt;
    feedEl.textContent = feedText + '  (' + stats.kills + ')';
    feedEl.style.opacity = Math.min(1, feedT / 0.4);
  } else feedEl.style.opacity = 0;


  drawHud();
}



// ---------- restart after death ----------
export function resetPlayerGun() {
  for (const k of ORDER) ammo[k] = WEAPONS[k].mag;
  reloading = false; pending = null; lower = 0; cur = START_WEAPON;
  fireT = 0; kick = 0; bloom = 0; recoil = 0; holding = false; clickBuf = 0; flashT = 0;
  if (flash) flash.visible = false;
  if (flashCore) flashCore.visible = false;
  if (flashLight) flashLight.intensity = 0;
  stats.shots = stats.hits = stats.kills = stats.heads = 0;
  showCur();
}



export function playerStats() {
  const acc = stats.shots ? Math.round(100 * stats.hits / stats.shots) : 0;
  return { ...stats, accuracy: acc };
}
export function gunInfo() {
  const k = ORDER[cur], s = playerStats();
  return 'gun: ' + k + ' ' + ammo[k] + '/' + WEAPONS[k].mag + ' · shots ' + s.shots +
         ' · hits ' + s.hits + ' · kills ' + s.kills + ' · headshots ' + s.heads + ' · accuracy ' + s.accuracy + '%';
}