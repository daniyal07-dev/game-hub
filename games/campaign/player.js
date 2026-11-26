// ============================================================
//  NOVA STRIKE 3D — Campaign: games/campaign/player.js  (v5)
//  The player's own first-person weapon.
//    Left mouse = fire    Wheel / Q = switch    R = reload
//  Hitscan: a ray from the camera. Walls and the ground stop it,
//  enemies are tested as upright capsules (head = x2 damage).
//  Guns are the same free models War uses (root models/ folder).
//  v3: fire timer keeps leftover time, recoil recovers,
//      rifle mag 40 / reload 1.5 s.
//  v4: GUN LOOK COPIED FROM WAR (items.js): same root position,
//      same per-gun offsets, rifle/shotgun 1.8x thicker,
//      pistol at its War position. Bob/recoil turn around the gun.
//  v5: NO MORE SOUND CODE HERE. This file only sends events
//      (shot, reload, empty, swap, hit, kill) to extras.js, and
//      sound.js plays the real gunshot and the other sounds.
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { blockedAt, groundHeight } from './collision.js';
import { getEnemies, hurtEnemy, addTracer } from './enemies.js';
import { extrasEvent } from './extras.js';



// ---------- knobs ----------
// Gun view (copied from War's VIEW table):
//   pos   = [x, y, z] offset from the gun root  (x + = right, y + = up, z + = toward you)
//   yaw   = turn of the barrel toward the crosshair, in degrees
//   thick = thickness (side to side and up/down)   len = length
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
const TRACER_MAX = 45;
const HUD_BOTTOM = 78;        // px: ammo counter sits above the NOVA badge
const RECOIL_BACK = 4;        // how fast the aim settles after shooting (bigger = faster)



// ---------- state ----------
let cam = null, holder = null, flash = null, ready = false, isActive = false;
const models = {};
const view = {};              // per-gun tweakable pose {pos, yaw, thick, len}
const ammo = {};
let cur = START_WEAPON, pending = null, lower = 0;
let fireT = 0, reloading = false, reloadT = 0;
let holding = false, clickBuf = 0, wheelT = 0;
let kick = 0, bloom = 0, bobT = 0, bobK = 0, flashT = 0, recoil = 0;
let hitT = 0, hitKill = false, feedT = 0, feedText = '';
const stats = { shots: 0, hits: 0, kills: 0, heads: 0 };
let hud, hudLast = '', hitEl, feedEl, warned = false;



const O = new THREE.Vector3(), D = new THREE.Vector3(), M = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const P = { x: 0, z: 0 };



for (const k of ORDER) {
  const w = WEAPONS[k];
  view[k] = { pos: w.pos.slice(), yaw: w.yaw * Math.PI / 180, thick: w.thick, len: w.len };
}



// ---------- helpers ----------
const W = () => WEAPONS[ORDER[cur]];



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
               '<div style="font-size:10px;opacity:.55">Q / wheel switch · R reload</div>';
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
function applyView(kind) {
  const m = models[kind]; if (!m) return;
  const v = view[kind];
  m.position.set(v.pos[0], v.pos[1], v.pos[2]);
  m.rotation.y = v.yaw;
  m.scale.set(v.thick, v.thick, v.len);
}
function showCur() {
  for (const k of ORDER) if (models[k]) models[k].visible = (k === ORDER[cur]);
  const k = ORDER[cur], v = view[k], w = WEAPONS[k];
  if (flash) {
    flash.position.set(0, 0.02 * v.thick, 0.2 - w.size * v.len - 0.03)
         .applyAxisAngle(UP, v.yaw)
         .add(new THREE.Vector3(v.pos[0], v.pos[1], v.pos[2]));
  }
}
async function loadGun(kind, loader) {
  const w = WEAPONS[kind];
  let wrap;
  try {
    const gltf = await loader.loadAsync(w.file);
    wrap = fit(gltf.scene, w.size);
    const b = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    console.log('[player] ' + kind + ' loaded, size ' + b.x.toFixed(2) + ' x ' + b.y.toFixed(2) + ' x ' + b.z.toFixed(2) + ' m');
  } catch (err) {
    console.warn('[player] could not load ' + w.file + ' - using a plain block instead', err);
    wrap = placeholder(w.size);
  }
  wrap.traverse(o => { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; });
  models[kind] = wrap;
  holder.add(wrap);
  applyView(kind);
  showCur();
  if (ORDER.every(k => models[k])) ready = true;
}



// ---------- tuning from the Console ----------
// tuneGun("rifle", x, y, z, yawDegrees, thickness, length)   (numbers are offsets from War's root)
//   x bigger = more right, y smaller = lower, z bigger = closer to you (less gun shows)
//   thickness bigger = fatter gun, length bigger = longer gun
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



// ---------- init ----------
export function initPlayerGun(camera, scene) {
  cam = camera;
  if (!cam.parent) scene.add(cam);
  if (cam.near > 0.1) { cam.near = 0.1; cam.updateProjectionMatrix(); }



  holder = new THREE.Group();                     // = War's gunRoot
  holder.position.set(ROOT[0], ROOT[1], ROOT[2]);
  holder.visible = false;
  cam.add(holder);



  // muzzle flash sprite (soft yellow blob drawn in code)
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,250,200,1)');
  gr.addColorStop(0.4, 'rgba(255,170,60,0.8)');
  gr.addColorStop(1, 'rgba(255,100,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending,
    transparent: true, depthTest: false, depthWrite: false }));
  flash.scale.set(0.28, 0.28, 1);
  flash.visible = false;
  flash.renderOrder = 999;
  holder.add(flash);



  makeHud();



  for (const k of ORDER) ammo[k] = WEAPONS[k].mag;
  const loader = new GLTFLoader();
  for (const k of ORDER) loadGun(k, loader);



  // mouse
  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || !document.pointerLockElement) return;
    holding = true; clickBuf = 0.18;
  });
  document.addEventListener('mouseup', e => { if (e.button === 0) holding = false; });
  window.addEventListener('blur', () => { holding = false; });
  document.addEventListener('wheel', e => {
    if (!document.pointerLockElement || !isActive) return;
    if (wheelT > 0) return;
    wheelT = 0.2;
    switchTo((cur + (e.deltaY > 0 ? 1 : ORDER.length - 1)) % ORDER.length);
  }, { passive: true });



  console.log('[player] ready: left mouse fires, wheel/Q switches, R reloads');
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



// cast one ray: returns {t, enemy, head}
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
  kick = Math.min(1.2, kick + w.kick);
  flashT = 0.05;
  if (flash && flash.material) flash.material.rotation = Math.random() * 6.28;
  ev('shot', { kind: k });



  // small upward recoil, remembered so it can settle back later
  const nudge = w.camKick * (0.7 + Math.random() * 0.6);
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch + nudge));
  recoil += nudge;



  cam.getWorldPosition(O);
  cam.getWorldDirection(D);
  M.set(0.24, -0.22, -0.8); cam.localToWorld(M);      // tracer start near the muzzle



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
    if (w.pellets === 1 || i < 3) {
      const d = Math.min(hit.t, TRACER_MAX);
      addTracer(M.x, M.y, M.z, O.x + dir.x * d, O.y + dir.y * d, O.z + dir.z * d);
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
  if (!isActive) { holding = false; recoil = 0; hitEl.style.opacity = 0; feedEl.style.opacity = 0; return; }



  fireT -= dt; clickBuf -= dt; wheelT -= dt; flashT -= dt;
  bloom = Math.max(0, bloom - dt * 3);
  kick *= Math.exp(-dt * 14);



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



  flash.visible = flashT > 0 && pending === null;



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
  fireT = 0; kick = 0; bloom = 0; recoil = 0; holding = false; clickBuf = 0;
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