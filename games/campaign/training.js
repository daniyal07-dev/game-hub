// games/campaign/training.js
// Campaign Mode: train soldiers at the Barracks (Age of Empires style).
//  - Walk to a Barracks door and press the Use key (default E).
//  - A small menu opens: press 1 to queue a Pistol soldier.
//  - Supplies are spent, a progress bar runs, then the soldier appears at the door
//    and walks to his place in your squad.
//  - Press the Use key again to close the menu.
//
// PHONE: near a Barracks the box says "Tap here to train a soldier".
//        With one weapon, every tap trains one soldier (no menu, no keys).
//        With more weapons, a tap menu opens instead. PC behaviour is unchanged.
//
// API (main.js calls these):
//   initTraining(scene, isReady)       once, isReady() -> true when characters are loaded
//   updateTraining(dt, player, playing) every frame
//   handleTrainingKey(code, player)    on keydown; returns true if the key was used
//   trainingInfo()                     text for the console


import { addSoldier, aliveCount, WEAPON_STATS, MAX_UNITS } from './units.js';
import { matches, key, label } from './keybinds.js';


/* ---------- Knobs ---------- */
const SUPPLY_START = 100;     // supplies at the start
const SUPPLY_RATE = 0.7;      // supplies gained per second
const SUPPLY_MAX = 300;       // supplies cannot grow beyond this
const MAX_QUEUE = 3;          // soldiers waiting per Barracks
const NEAR = 7;               // how close to the door you must be (m)
const DOOR_OUT = 1.0;         // door point is this far outside the front wall (m)

// Which soldiers can be trained. Only the pistol soldier has a working model.
// To bring the others back: ['pistol', 'rifle', 'shotgun']
const TRAIN_WEAPONS = ['pistol'];

// Phone = touch screen without a mouse (same test as main.js and touch.js)
const PHONE = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);


// Barracks (front direction = the way the door faces; rot is the same value as in layout.js)
const BARRACKS = [
  { name: 'BARRACKS A', x: -162, z: -97, rot: Math.PI, depth: 10 },
  { name: 'BARRACKS B', x: -162, z: -82, rot: Math.PI, depth: 10 }
];


const WEAPON_KEYS = {
  Digit1: 'pistol', Numpad1: 'pistol',
  Digit2: 'rifle',  Numpad2: 'rifle',
  Digit3: 'shotgun', Numpad3: 'shotgun'
};
const MENU_ORDER = TRAIN_WEAPONS.filter((w) => WEAPON_STATS[w]);
const SINGLE = MENU_ORDER.length === 1;     // one weapon: phone taps train directly


/* ---------- State ---------- */
let scene = null;
let isReady = () => false;
let supplies = SUPPLY_START;
let menuOpen = false;
let menuB = null;
let toastText = '', toastT = 0;
let uiT = 0;
let ui = null;
let curPlayer = null;


for (const b of BARRACKS) {
  const fx = Math.sin(b.rot), fz = Math.cos(b.rot);
  b.fx = fx; b.fz = fz;
  b.doorX = b.x + fx * (b.depth / 2 + DOOR_OUT);
  b.doorZ = b.z + fz * (b.depth / 2 + DOOR_OUT);
  b.heading = Math.atan2(fx, fz);          // soldier faces out of the door
  b.queue = [];                            // jobs: { weapon, t, total }
}

const pending = () => BARRACKS.reduce((n, b) => n + b.queue.length, 0);


/* ---------- Setup ---------- */
export function initTraining(sceneRef, readyFn) {
  scene = sceneRef;
  if (readyFn) isReady = readyFn;
  buildUI();
  console.log('[training] ready: ' + BARRACKS.length + ' barracks, supplies ' + SUPPLY_START +
    ', can train: ' + MENU_ORDER.join('/') + (PHONE ? ' (tap)' : ''));
}


/* ---------- Helpers ---------- */
function nearest(player) {
  let best = null, bd = NEAR;
  for (const b of BARRACKS) {
    const d = Math.hypot(player.x - b.doorX, player.z - b.doorZ);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function toast(text) { toastText = text; toastT = 2; }

function queueTrain(b, weapon) {
  const st = WEAPON_STATS[weapon];
  if (!st || !MENU_ORDER.includes(weapon)) return;
  if (!isReady()) return toast('Soldiers are still loading...');
  if (aliveCount() + pending() >= MAX_UNITS) return toast('Army is full (' + MAX_UNITS + ')');
  if (b.queue.length >= MAX_QUEUE) return toast('Queue is full');
  if (supplies < st.cost) return toast('Not enough supplies (need ' + st.cost + ')');
  supplies -= st.cost;
  b.queue.push({ weapon, t: 0, total: st.time });
  toast('Training a ' + st.label.toLowerCase() + ' soldier...');
}


/* ---------- Keys ---------- */
export function handleTrainingKey(code, player) {
  if (player) curPlayer = player;
  if (matches('interact', code)) {
    if (menuOpen) { menuOpen = false; refreshUI(player, true); return true; }
    const b = nearest(player);
    if (b) { menuOpen = true; menuB = b; refreshUI(player, true); return true; }
    return false;
  }
  if (menuOpen && WEAPON_KEYS[code] && MENU_ORDER.includes(WEAPON_KEYS[code])) {
    queueTrain(menuB, WEAPON_KEYS[code]);
    refreshUI(player, true);
    return true;
  }
  return false;
}


/* ---------- Per-frame ---------- */
export function updateTraining(dt, player, playing) {
  curPlayer = player;
  supplies = Math.min(SUPPLY_MAX, supplies + SUPPLY_RATE * dt);
  if (toastT > 0) toastT -= dt;

  for (const b of BARRACKS) {
    const job = b.queue[0];
    if (!job) continue;
    job.t += dt;
    if (job.t >= job.total) {
      b.queue.shift();
      const s = addSoldier(scene, b.doorX, b.doorZ, b.heading, job.weapon);
      if (!s) {                                   // could not spawn: give the supplies back
        supplies = Math.min(SUPPLY_MAX, supplies + WEAPON_STATS[job.weapon].cost);
        toast('Could not train (army full or not loaded)');
      } else {
        toast('A ' + WEAPON_STATS[job.weapon].label.toLowerCase() + ' soldier is ready!');
      }
    }
  }

  if (menuOpen && (!playing || !nearest(player))) menuOpen = false;

  uiT += dt;
  if (uiT >= 0.1) { uiT = 0; refreshUI(player, playing); }
}


/* ---------- On-screen display ---------- */
function buildUI() {
  if (ui) return;
  const css = document.createElement('style');
  css.textContent = `
    #train-supply{position:fixed;left:14px;bottom:14px;z-index:20;padding:6px 12px;border-radius:8px;
      background:rgba(8,14,22,.72);border:1px solid rgba(0,240,255,.35);color:#cfefff;
      font:600 13px/1.3 system-ui,sans-serif;letter-spacing:.5px;pointer-events:none}
    #train-supply b{color:#ffd24a}
    #train-box{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:20;min-width:300px;max-width:92vw;
      padding:10px 14px;border-radius:10px;background:rgba(8,14,22,.8);border:1px solid rgba(0,240,255,.4);
      color:#e6f6ff;font:13px/1.45 system-ui,sans-serif;pointer-events:none;text-align:center}
    #train-box .t{font-weight:700;color:#00f0ff;letter-spacing:.6px;margin-bottom:4px}
    #train-box .row{text-align:left;padding:2px 0}
    #train-box .row.no{opacity:.45}
    #train-box .row b{color:#ffd24a}
    #train-box .hint{opacity:.7;font-size:12px;margin-top:4px}
    #train-box .bar{height:6px;border-radius:3px;background:rgba(255,255,255,.15);overflow:hidden;margin:2px 0 6px}
    #train-box .bar i{display:block;height:100%;background:linear-gradient(90deg,#00f0ff,#7bff9a)}
    #train-box .msg{color:#ffd24a;margin-top:4px}
    .hidden-train{display:none!important}`;
  document.head.appendChild(css);

  if (PHONE) {
    const pcss = document.createElement('style');
    pcss.textContent = `
      #train-box{bottom:58px;min-width:0;width:min(58vw,330px);padding:7px 10px;font-size:12px;line-height:1.35;
        touch-action:none;-webkit-tap-highlight-color:transparent;z-index:60}
      #train-box.tap{pointer-events:auto}
      #train-box .t{font-size:12px;margin-bottom:3px}
      #train-box .trow{display:block;text-align:left;margin:4px 0;padding:9px 10px;min-height:40px;border-radius:8px;
        background:rgba(0,240,255,.12);border:1px solid rgba(0,240,255,.45);color:#e6f6ff;box-sizing:border-box}
      #train-box .trow.no{opacity:.45}
      #train-box .trow b{color:#ffd24a}
      #train-box .trow small{display:block;opacity:.75;font-size:11px}
      #train-box .trow:active{background:rgba(0,240,255,.35)}
      #train-box .trow.close{text-align:center;font-weight:700;letter-spacing:.8px;
        background:rgba(255,80,80,.14);border-color:rgba(255,110,110,.55)}
      #train-box .open{display:block;padding:9px 6px;border-radius:8px;background:rgba(255,210,74,.14);
        border:1px solid rgba(255,210,74,.55);font-weight:700;text-align:center}
      #train-box .open:active{background:rgba(255,210,74,.35)}
      #train-box .open.no{opacity:.5}
      #train-box .open b{color:#ffd24a}
      #train-box .open small{display:block;font-weight:500;opacity:.8;font-size:11px;margin-top:1px}`;
    document.head.appendChild(pcss);
  }

  const sup = document.createElement('div');
  sup.id = 'train-supply';
  const box = document.createElement('div');
  box.id = 'train-box';
  document.body.append(sup, box);
  ui = { sup, box, last: '' };

  if (PHONE) {
    // taps on the box must not also move the camera or fire
    const stop = (e) => e.stopPropagation();
    box.addEventListener('touchstart', stop, { passive: true });
    box.addEventListener('touchmove', stop, { passive: true });
    box.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const el = e.target.closest ? e.target.closest('[data-w],[data-close],[data-open],[data-train]') : null;
      if (!el) return;
      e.preventDefault();
      if (el.hasAttribute('data-close')) {
        menuOpen = false;
      } else if (el.hasAttribute('data-train')) {
        const b = curPlayer ? nearest(curPlayer) : null;
        if (b) queueTrain(b, MENU_ORDER[0]);
      } else if (el.hasAttribute('data-open')) {
        const b = curPlayer ? nearest(curPlayer) : null;
        if (b) { menuOpen = true; menuB = b; }
      } else if (menuOpen && menuB) {
        queueTrain(menuB, el.getAttribute('data-w'));
      }
      if (curPlayer) refreshUI(curPlayer, true);
    });
  }
}


function refreshUI(player, playing) {
  if (!ui) return;
  const show = !!playing;
  ui.sup.classList.toggle('hidden-train', !show);
  if (!show) { ui.box.classList.add('hidden-train'); return; }

  ui.sup.innerHTML = 'SUPPLIES <b>' + Math.floor(supplies) + '</b>  ·  ARMY <b>' +
    aliveCount() + '/' + MAX_UNITS + '</b>';

  const near = nearest(player);
  const useKey = label(key('interact'));
  let html = '';
  let tappable = false;

  if (PHONE && SINGLE) {
    // one weapon: no menu, a tap trains one soldier
    if (near) {
      const st = WEAPON_STATS[MENU_ORDER[0]];
      const ok = supplies >= st.cost;
      tappable = true;
      html += '<div class="t">' + near.name + '</div>' +
        '<div class="open' + (ok ? '' : ' no') + '" data-train="1">Tap here to train a soldier' +
        '<small>' + st.cost + ' supplies · ' + st.time + ' s</small></div>';
    }
  } else if (menuOpen && menuB) {
    if (PHONE) {
      tappable = true;
      html += '<div class="t">' + menuB.name + ' — tap to train</div>';
      MENU_ORDER.forEach((w) => {
        const st = WEAPON_STATS[w];
        const ok = supplies >= st.cost;
        html += '<div class="trow' + (ok ? '' : ' no') + '" data-w="' + w + '"><b>' + st.label + '</b> · ' +
          st.cost + ' supplies · ' + st.time + ' s<small>' + st.info + '</small></div>';
      });
      html += '<div class="trow close" data-close="1">CLOSE</div>';
    } else {
      html += '<div class="t">' + menuB.name + ' — train a soldier</div>';
      MENU_ORDER.forEach((w, i) => {
        const st = WEAPON_STATS[w];
        const ok = supplies >= st.cost;
        html += '<div class="row' + (ok ? '' : ' no') + '"><b>[' + (i + 1) + '] ' + st.label + '</b> · ' +
          st.cost + ' supplies · ' + st.time + ' s\n<small>' + st.info + '</small></div>';
      });
      html += '<div class="hint">[' + useKey + '] close</div>';
    }
  } else if (near) {
    if (PHONE) {
      tappable = true;
      html += '<div class="t">' + near.name + '</div><div class="open" data-open="1">Tap here to open the <b>Barracks</b></div>';
    } else {
      html += '<div class="t">' + near.name + '</div><div>Press <b>[' + useKey + ']</b> to train soldiers</div>';
    }
  }

  // progress bars (shown while anything is training, near or far)
  for (const b of BARRACKS) {
    b.queue.forEach((job, i) => {
      const pct = i === 0 ? Math.min(100, Math.round(job.t / job.total * 100)) : 0;
      html += '<div class="row">' + b.name + ' · ' + WEAPON_STATS[job.weapon].label +
        (i === 0 ? ' · ' + pct + '%' : ' · waiting') +
        '</div><div class="bar"><i style="width:' + pct + '%"></i></div>';
    });
  }

  if (toastT > 0 && toastText) html += '<div class="msg">' + toastText + '</div>';

  ui.box.classList.toggle('hidden-train', html === '');
  ui.box.classList.toggle('tap', PHONE && tappable);
  if (html !== ui.last) { ui.box.innerHTML = html; ui.last = html; }
}


export function trainingInfo() {
  return 'supplies ' + Math.floor(supplies) + ', queued ' + pending() + ', army ' + aliveCount() + '/' + MAX_UNITS;
}