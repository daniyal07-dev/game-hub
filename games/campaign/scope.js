// scope.js — smart scope for Campaign (v4)
//  1) FIRE ZOOM (like Call of Duty): when you shoot at an enemy, the view zooms
//     in a little AND the gun leans toward the centre, as if aiming. The gun
//     keeps its normal size on screen (no growing, no late return).
//  2) BIG SCOPE: Right-click (or the Z key) opens the real scope. Z cycles 3x / 6x / off.
//  FIRE ZOOM on/off and both keys are set on the start card (saved on the device).
//  v4: the gun is hidden inside the big scope, so its muzzle flash was hidden too.
//      Now every shot draws a muzzle flash inside the scope lens (no line).
//      Console: scope({flash: 0..2})
//  Does not touch player.js or main.js. Goes through extras.js.


import * as THREE from 'three';


// ---------- knobs ----------
let FIRE_ZOOM = 1.3;          // small zoom while firing at an enemy (1.2 = tiny, 1.5 = strong)
let ZOOMS = [3, 6];           // big scope levels
let FIRE_MIN = 5;             // fire zoom only for enemies at least this far (metres)
let FIRE_MAX = 160;           // ...and not farther than this
let FIRE_HOLD = 0.4;          // seconds it stays after your last shot
let AFTER_KILL = 0.2;         // seconds it stays after a kill
let LEAN = { x: -0.09, y: 0.05, z: -0.06 };   // how far the gun moves when aiming (camera metres)
let LEAN_K = 1;               // 0 = gun does not lean, 1 = normal, 1.5 = more
let SCOPE_FLASH = 1;          // muzzle flash inside the big scope (0 = off, 1 = normal, 2 = very bright)
const FLASH_LIFE = 0.09;      // seconds one scope flash lasts
const AIM_ANGLE = 5;          // degrees: how close to the crosshair counts as "firing at"
const CHEST = 1.0;            // aim height above an enemy's feet
const OVERLAY_AT = 1.5;       // above this zoom the scope picture starts to show
const GUN_HIDE_AT = 1.9;      // above this zoom the gun model hides
const LENS = 0.44;            // lens radius = this x the smaller screen side
let SENS_SCALE = true;        // slower look speed while zoomed
const SAVE_ON = 'campaign_firezoom';
const SAVE_KEYS = 'campaign_scope_keys';
const DEFAULT_KEYS = { cycle: 'KeyZ', fire: 'KeyX' };
const BLOCKED = ['Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyE', 'KeyR', 'KeyQ', 'KeyM',
  'KeyN', 'KeyK', 'KeyG', 'KeyP', 'Digit1', 'Digit2', 'Digit3', 'ShiftLeft', 'ShiftRight',
  'ControlLeft', 'ControlRight', 'Tab', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];


// ---------- state ----------
let C = null;
let T = 0;
let manual = -1;              // -1 = off, otherwise index in ZOOMS
let fireUntil = 0;
let zoom = 1, target = 1, lean = 0;
let baseFov = null;
let rig = null, rigLogged = false;
let fireOn = true;
const keys = { cycle: DEFAULT_KEYS.cycle, fire: DEFAULT_KEYS.fire };
try { fireOn = localStorage.getItem(SAVE_ON) !== '0'; } catch (e) {}
try {
  const k = JSON.parse(localStorage.getItem(SAVE_KEYS) || 'null');
  if (k && typeof k.cycle === 'string' && typeof k.fire === 'string' && k.cycle !== k.fire) {
    keys.cycle = k.cycle; keys.fire = k.fire;
  }
} catch (e) {}
let ov = null, txtTop = null, txtRange = null, toastEl = null, toastTimer = 0;
let flashEl = null, flashV = 0, flashShown = -1;
let cardDone = false, cardBox = null, wrapped = false, scanT = 0, aim = null, logged = false, lastKey = 0;
let ax = 0, ay = 0, resending = false, capturing = null;


const P = { x: 0, y: 0, z: 0 };
const F = { x: 0, y: 0, z: -1 };
const _wp = new THREE.Vector3();
const _wd = new THREE.Vector3();


function isPlay() { return !!(C && C.isPlaying && C.isPlaying()); }


function keyName(code) {
  if (code.indexOf('Key') === 0) return code.slice(3);
  if (code.indexOf('Digit') === 0) return code.slice(5);
  return code.replace('Arrow', '').replace('Numpad', 'Num');
}


// ---------- DOM ----------
function ensureDom() {
  if (ov) return;
  const css = document.createElement('style');
  css.textContent = `
  #scope-ov{position:fixed;inset:0;z-index:35;pointer-events:none;display:none;opacity:0;--r:300px}
  #scope-ov .mask{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(0,0,0,0) calc(var(--r) - 3px),rgba(0,0,0,.97) calc(var(--r) + 2px))}
  #scope-ov .flash{position:absolute;left:50%;top:50%;width:calc(var(--r)*2);height:calc(var(--r)*2);margin:calc(var(--r)*-1) 0 0 calc(var(--r)*-1);border-radius:50%;opacity:0;mix-blend-mode:screen;background:radial-gradient(circle at var(--fx,80%) var(--fy,84%),rgba(255,252,225,1) 0,rgba(255,205,100,.78) 9%,rgba(255,130,35,.30) 24%,rgba(255,110,30,0) 52%),radial-gradient(circle at 50% 50%,rgba(255,230,170,0) 30%,rgba(255,200,120,.22) 100%)}
  #scope-ov .ring{position:absolute;left:50%;top:50%;width:calc(var(--r)*2);height:calc(var(--r)*2);margin:calc(var(--r)*-1) 0 0 calc(var(--r)*-1);border-radius:50%;box-shadow:inset 0 0 46px rgba(0,0,0,.65),0 0 0 2px rgba(120,190,255,.4)}
  #scope-ov svg{position:absolute;left:50%;top:50%;width:calc(var(--r)*2);height:calc(var(--r)*2);margin:calc(var(--r)*-1) 0 0 calc(var(--r)*-1)}
  #scope-ov .t{position:absolute;left:0;right:0;text-align:center;font:700 13px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:2px;color:#bfe3ff;text-shadow:0 0 6px #000,0 0 3px #000}
  #scope-ov .t1{top:calc(50% - var(--r) + 16px)}
  #scope-ov .t2{top:calc(50% + var(--r) - 30px);color:#ffd9d6}
  #scope-toast{position:fixed;left:50%;bottom:24%;transform:translateX(-50%);z-index:60;pointer-events:none;padding:7px 16px;border-radius:999px;background:rgba(10,24,48,.85);border:1px solid rgba(120,190,255,.6);color:#d6ecff;font:700 13px system-ui,Segoe UI,Arial,sans-serif;letter-spacing:1.5px;display:none}
  #scope-box{display:flex;flex-direction:column;align-items:center;gap:6px;margin:10px auto;font:700 12px system-ui,Segoe UI,Arial,sans-serif;letter-spacing:2px;color:#a9d4ff}
  #scope-box .row{display:flex;align-items:center;justify-content:center;gap:8px}
  #scope-box button{font:700 12px system-ui,Segoe UI,Arial,sans-serif;letter-spacing:1.5px;padding:7px 14px;border-radius:999px;border:1px solid rgba(120,190,255,.55);background:rgba(10,24,48,.6);color:#cfe7ff;cursor:pointer}
  #scope-box button.on{background:#1f6fe0;border-color:#8fc4ff;color:#fff}
  #scope-box button.wait{background:#c98a00;border-color:#ffd36b;color:#fff}
  #scope-box .hint{font-size:11px;letter-spacing:1px;color:#8fb6dc;font-weight:600}
  @media (hover:none) and (pointer:coarse){#scope-box{margin:4px auto;font-size:11px}#scope-box button{padding:5px 10px;font-size:11px}#scope-box .keys,#scope-box .hint{display:none}#scope-ov .t{font-size:11px}}
  `;
  document.head.appendChild(css);


  ov = document.createElement('div');
  ov.id = 'scope-ov';
  let ticks = '';
  for (let i = 1; i <= 5; i++) {
    const p = 8 + i * 9;
    ticks += `<line x1="${p}" y1="-1.6" x2="${p}" y2="1.6"/><line x1="${-p}" y1="-1.6" x2="${-p}" y2="1.6"/>` +
             `<line x1="-1.6" y1="${p}" x2="1.6" y2="${p}"/><line x1="-1.6" y1="${-p}" x2="1.6" y2="${-p}"/>`;
  }
  ov.innerHTML = `<div class="mask"></div><div class="flash"></div><div class="ring"></div>
  <svg viewBox="-100 -100 200 200">
    <g stroke="rgba(150,210,255,.9)" stroke-width=".5" fill="none">
      <line x1="-100" y1="0" x2="-7" y2="0"/><line x1="7" y1="0" x2="100" y2="0"/>
      <line x1="0" y1="-100" x2="0" y2="-7"/><line x1="0" y1="7" x2="0" y2="100"/>
      ${ticks}
    </g>
    <circle r="0.9" fill="#ff3b30"/>
  </svg>
  <div class="t t1"></div><div class="t t2"></div>`;
  document.body.appendChild(ov);
  txtTop = ov.querySelector('.t1');
  txtRange = ov.querySelector('.t2');
  flashEl = ov.querySelector('.flash');


  toastEl = document.createElement('div');
  toastEl.id = 'scope-toast';
  document.body.appendChild(toastEl);


  sizeLens();
  window.addEventListener('resize', sizeLens);
}


function sizeLens() {
  if (!ov) return;
  const r = Math.min(window.innerWidth, window.innerHeight) * LENS;
  ov.style.setProperty('--r', r.toFixed(0) + 'px');
}


function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 1500);
}


function ensureCard() {
  if (cardDone) return;
  const play = document.getElementById('play-btn');
  if (!play || !play.parentNode) return;
  cardDone = true;
  cardBox = document.createElement('div');
  cardBox.id = 'scope-box';
  cardBox.innerHTML =
    '<div class="row"><span>FIRE ZOOM</span><button data-v="1">ON</button><button data-v="0">OFF</button></div>' +
    '<div class="row keys"><span>KEYS</span><button data-k="cycle"></button><button data-k="fire"></button></div>' +
    '<div class="hint">Right-click = big scope</div>';
  play.parentNode.insertBefore(cardBox, play);
  cardBox.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.k) { capturing = b.dataset.k; paintCard(); return; }
    setFire(b.dataset.v === '1', false);
  });
  paintCard();
}


function paintCard() {
  if (!cardBox) return;
  cardBox.querySelectorAll('button[data-v]').forEach((b) => {
    b.classList.toggle('on', (b.dataset.v === '1') === fireOn);
  });
  const bc = cardBox.querySelector('button[data-k="cycle"]');
  const bf = cardBox.querySelector('button[data-k="fire"]');
  bc.textContent = capturing === 'cycle' ? 'PRESS A KEY...' : 'BIG SCOPE: ' + keyName(keys.cycle);
  bf.textContent = capturing === 'fire' ? 'PRESS A KEY...' : 'FIRE ZOOM: ' + keyName(keys.fire);
  bc.classList.toggle('wait', capturing === 'cycle');
  bf.classList.toggle('wait', capturing === 'fire');
}


function saveKeys() {
  try { localStorage.setItem(SAVE_KEYS, JSON.stringify(keys)); } catch (e) {}
}


// while a key button is waiting, the next key press is taken as the new key
document.addEventListener('keydown', (e) => {
  if (!capturing) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const which = capturing;
  const other = which === 'cycle' ? 'fire' : 'cycle';
  capturing = null;
  if (e.code === 'Escape') { paintCard(); return; }
  if (BLOCKED.indexOf(e.code) >= 0) { toast('That key is already used. Pick another.'); paintCard(); return; }
  if (e.code === keys[other]) { toast('That key is used by the other scope key.'); paintCard(); return; }
  keys[which] = e.code;
  saveKeys();
  paintCard();
  toast((which === 'cycle' ? 'BIG SCOPE' : 'FIRE ZOOM') + ' KEY: ' + keyName(e.code));
}, true);


// ---------- gun rig ----------
// Everything the camera carries (the gun) goes into one group. While the view
// zooms we shrink that group sideways by the same amount, so the gun stays the
// same size and place on screen. The lean pose moves the same group.
function adopt(cam) {
  if (!rig) {
    rig = new THREE.Group();
    rig.name = 'scope-rig';
    cam.add(rig);
  } else if (rig.parent !== cam) {
    cam.add(rig);
  }
  const list = cam.children.slice();
  const taken = [];
  for (const c of list) {
    if (c === rig || c.isLight || c.isPoints || c.isLine || c.isInstancedMesh) continue;
    if (c.userData && c.userData.keepInScope) continue;
    if (/rain/i.test(c.name || '')) continue;
    rig.add(c);
    taken.push((c.name || c.type) + (c.isMesh ? '(mesh)' : ''));
  }
  if (taken.length && !rigLogged) {
    rigLogged = true;
    console.log('[scope] gun parts moved into the scope rig: ' + taken.join(', '));
  }
}


function applyRig() {
  if (!rig) return;
  const s = 1 / Math.min(Math.max(zoom, 1), GUN_HIDE_AT);
  rig.scale.set(s, s, 1);
  rig.position.set(LEAN.x * lean * LEAN_K, LEAN.y * lean * LEAN_K, LEAN.z * lean * LEAN_K);
  rig.visible = zoom <= GUN_HIDE_AT;
}


// ---------- muzzle flash inside the scope ----------
// The gun is hidden in the big scope, so each shot lights the lens instead.
function scopeFlash() {
  if (!flashEl || SCOPE_FLASH <= 0) return;
  flashV = 1;
  flashEl.style.setProperty('--fx', (70 + Math.random() * 16).toFixed(0) + '%');
  flashEl.style.setProperty('--fy', (77 + Math.random() * 10).toFixed(0) + '%');
}


function paintFlash(dt, showing) {
  if (!flashEl) return;
  flashV = Math.max(0, flashV - dt / FLASH_LIFE);
  const v = showing ? Math.min(1, flashV * SCOPE_FLASH) : 0;
  const s = v.toFixed(2);
  if (s !== flashShown) { flashShown = s; flashEl.style.opacity = s; }
}


// ---------- logic ----------
function setFire(v, say) {
  fireOn = !!v;
  try { localStorage.setItem(SAVE_ON, fireOn ? '1' : '0'); } catch (e) {}
  if (!fireOn) fireUntil = 0;
  paintCard();
  if (say !== false) toast(fireOn ? 'FIRE ZOOM: ON' : 'FIRE ZOOM: OFF');
}


// big scope on/off (right-click, phone SCOPE button)
function toggle() {
  if (!isPlay()) return;
  manual = manual >= 0 ? -1 : 0;
  fireUntil = 0;
}


// Z: 3x -> 6x -> off
function cycle() {
  if (!isPlay()) return;
  if (manual < 0) manual = 0;
  else if (manual < ZOOMS.length - 1) manual++;
  else manual = -1;
  fireUntil = 0;
}


function epos(e) {
  const o = e.pos || e.position || (e.group && e.group.position) || (e.g && e.g.position) ||
            (e.obj && e.obj.position) || (e.mesh && e.mesh.position) || (e.model && e.model.position) ||
            (e.root && e.root.position) || (e.object && e.object.position) || e;
  if (o && typeof o.x === 'number' && typeof o.z === 'number') {
    return { x: o.x, y: typeof o.y === 'number' ? o.y : null, z: o.z };
  }
  return null;
}


// nearest living enemy that is under the crosshair
function scanAim(ctx) {
  const cam = ctx.camera;
  cam.getWorldPosition(_wp);
  P.x = _wp.x; P.y = _wp.y; P.z = _wp.z;
  cam.getWorldDirection(_wd);
  F.x = _wd.x; F.y = _wd.y; F.z = _wd.z;


  const list = ctx.getEnemies ? ctx.getEnemies() : [];
  const tolBase = AIM_ANGLE * Math.PI / 180;
  let best = null, seen = 0;
  for (const e of list) {
    if (!e || e.dead || (typeof e.hp === 'number' && e.hp <= 0)) continue;
    const p = epos(e);
    if (!p) continue;
    seen++;
    const y = p.y !== null ? p.y + CHEST : P.y - 0.5;
    const vx = p.x - P.x, vy = y - P.y, vz = p.z - P.z;
    const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (d < 2 || d > FIRE_MAX + 40) continue;
    const cos = (vx * F.x + vy * F.y + vz * F.z) / d;
    if (cos <= 0.9) continue;
    const ang = Math.acos(Math.min(1, cos));
    const tol = Math.max(tolBase, Math.atan(0.9 / d));
    if (ang <= tol && (!best || d < best.d)) best = { d, e };
  }
  if (!logged && list.length) {
    logged = true;
    console.log('[scope] aim test sees ' + seen + ' of ' + list.length + ' enemies (if 0, tell me)');
  }
  return best;
}


function tryFire(ctx) {
  const hit = scanAim(ctx);
  if (hit && hit.d >= FIRE_MIN && hit.d <= FIRE_MAX) fireUntil = T + FIRE_HOLD;
}


// ---------- extras interface ----------
export function init(ctx) {
  C = ctx;
  ensureDom();
  ensureCard();
  console.log('[scope] v4 ready: fire zoom ' + (fireOn ? 'on' : 'off') + ' x' + FIRE_ZOOM +
    ', big scope x' + ZOOMS.join(' x') + ', scope flash ' + SCOPE_FLASH +
    ', keys ' + keyName(keys.cycle) + ' / ' + keyName(keys.fire));
}


export function update(dt, ctx) {
  C = ctx;
  T += dt;
  ensureDom();
  ensureCard();
  wrapTouch();
  const cam = ctx.camera;
  adopt(cam);
  const playing = isPlay();


  if (!playing) { manual = -1; fireUntil = 0; }
  const fireActive = playing && manual < 0 && fireOn && T < fireUntil;
  target = 1;
  if (playing) {
    if (manual >= 0) target = ZOOMS[manual];
    else if (fireActive) target = FIRE_ZOOM;
  }


  // zoom: in fast, out quickly (a bit slower for the big scope)
  const rate = target > zoom ? 16 : (manual >= 0 ? 8 : 13);
  zoom += (target - zoom) * (1 - Math.exp(-dt * rate));
  if (Math.abs(zoom - target) < 0.005) zoom = target;


  // gun lean: aiming pose only during fire zoom
  const lt = fireActive ? 1 : 0;
  lean += (lt - lean) * (1 - Math.exp(-dt * (lt > lean ? 20 : 14)));
  if (Math.abs(lean - lt) < 0.005) lean = lt;


  // field of view
  if (zoom > 1.001) {
    if (baseFov === null) baseFov = cam.fov;
    const rad = baseFov * Math.PI / 180;
    const f = 2 * Math.atan(Math.tan(rad / 2) / zoom) * 180 / Math.PI;
    if (Math.abs(cam.fov - f) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
  } else if (baseFov !== null) {
    cam.fov = baseFov;
    cam.updateProjectionMatrix();
    baseFov = null;
  }


  applyRig();


  // scope picture (big scope only; the small fire zoom stays below OVERLAY_AT)
  const op = Math.max(0, Math.min(1, (zoom - OVERLAY_AT) / (GUN_HIDE_AT - OVERLAY_AT)));
  if (op > 0.01 && playing) {
    ov.style.display = 'block';
    ov.style.opacity = op.toFixed(2);
    scanT -= dt;
    if (scanT <= 0) {
      scanT = 0.1;
      aim = scanAim(ctx);
      txtTop.textContent = 'x' + (Math.round(zoom * 10) / 10);
      txtRange.textContent = aim ? Math.round(aim.d) + ' m' : '';
    }
    paintFlash(dt, true);
  } else {
    ov.style.display = 'none';
    paintFlash(dt, false);
  }
  const ch = document.getElementById('crosshair');
  if (ch) ch.style.visibility = (zoom > OVERLAY_AT && playing) ? 'hidden' : '';
}


export function onKey(code, ctx) {
  C = ctx || C;
  if (!isPlay()) return;
  if (code !== keys.cycle && code !== keys.fire) return;
  const n = performance.now();
  if (n - lastKey < 150) return;
  lastKey = n;
  if (code === keys.cycle) cycle();
  else setFire(!fireOn);
}


export function onEvent(name, data, ctx) {
  C = ctx || C;
  if (name === 'shot') {
    if (fireOn && manual < 0 && isPlay()) tryFire(C);
    if (isPlay() && (manual >= 0 || zoom > OVERLAY_AT)) scopeFlash();
  } else if (name === 'kill') {
    if (fireUntil > T) fireUntil = Math.min(fireUntil, T + AFTER_KILL);
  } else if (name === 'reload' || name === 'died' || name === 'restart') {
    fireUntil = 0;
    if (name !== 'reload') manual = -1;
  }
}


export function reset(ctx) {
  C = ctx || C;
  manual = -1;
  fireUntil = 0;
  flashV = 0;
}


// ---------- mouse: right-click scope + slower look while zoomed ----------
document.addEventListener('mousedown', (e) => {
  if (e.button !== 2 || !isPlay() || !document.pointerLockElement) return;
  toggle();
}, true);


document.addEventListener('contextmenu', (e) => {
  if (isPlay()) e.preventDefault();
}, true);


document.addEventListener('mousemove', (e) => {
  if (resending || !SENS_SCALE || zoom < 1.05 || !document.pointerLockElement) return;
  e.stopImmediatePropagation();
  const k = Math.pow(zoom, -0.9);
  ax += e.movementX * k;
  ay += e.movementY * k;
  const sx = Math.trunc(ax), sy = Math.trunc(ay);
  ax -= sx; ay -= sy;
  if (!sx && !sy) return;
  resending = true;
  try {
    (e.target || document).dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true, view: window,
      clientX: e.clientX, clientY: e.clientY, movementX: sx, movementY: sy
    }));
  } finally { resending = false; }
}, true);


// ---------- phone: slower look while zoomed ----------
function wrapTouch() {
  const t = window.campaignTouch;
  if (wrapped || !t || typeof t.look !== 'function') return;
  wrapped = true;
  const orig = t.look.bind(t);
  t.look = (dx, dy) => {
    const k = (SENS_SCALE && zoom > 1.05) ? Math.pow(zoom, -0.9) : 1;
    orig(dx * k, dy * k);
  };
}


// ---------- doors for touch.js and the console ----------
window.campaignScope = {
  toggle,
  isOn: () => zoom > OVERLAY_AT && target > 1,
  setAuto: (v) => setFire(v)
};


window.scope = function (o) {
  if (o && typeof o === 'object') {
    if ('on' in o) setFire(!!o.on);
    if (o.fire) FIRE_ZOOM = o.fire;
    if (Array.isArray(o.zooms) && o.zooms.length) ZOOMS = o.zooms;
    if (o.min != null) FIRE_MIN = o.min;
    if (o.max != null) FIRE_MAX = o.max;
    if (o.hold != null) FIRE_HOLD = o.hold;
    if ('sens' in o) SENS_SCALE = !!o.sens;
    if (typeof o.flash === 'number') SCOPE_FLASH = Math.max(0, Math.min(2.5, o.flash));
    if (typeof o.lean === 'number') LEAN_K = o.lean;
    else if (o.lean && typeof o.lean === 'object') LEAN = Object.assign({}, LEAN, o.lean);
    if (o.keys) {
      if (o.keys.cycle) keys.cycle = o.keys.cycle;
      if (o.keys.fire) keys.fire = o.keys.fire;
      saveKeys();
      paintCard();
    }
  }
  console.log('[scope] fire zoom ' + (fireOn ? 'on' : 'off') + ' x' + FIRE_ZOOM + ' | big scope x' + ZOOMS.join(' x') +
    ' | range ' + FIRE_MIN + '-' + FIRE_MAX + ' m | hold ' + FIRE_HOLD + ' s | slow look ' + (SENS_SCALE ? 'on' : 'off') +
    ' | scope flash ' + SCOPE_FLASH +
    ' | lean x' + LEAN_K + ' (' + LEAN.x + ', ' + LEAN.y + ', ' + LEAN.z + ')' +
    ' | keys ' + keys.cycle + ' / ' + keys.fire);
};