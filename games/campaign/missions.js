// ============================================================
// missions.js  (NEW FILE)  ->  games/campaign/missions.js
// The mission of Strike Command: OPERATION PORT TOWN
//   train -> clear -> capture -> defend -> won / lost
//  - Objective line, enemy counter, capture bar, radio from COMMAND
//  - Big banners, victory / defeat screen with time, kills, losses, rank
//  - Marks the town square with a ring + beam and on the minimap
//  - waves.js (next file) reads getMission() and calls radio/banner/reportWaves
//  - intro.js (later) can send extrasEvent('intro', {active:true/false})
// Loaded by extras.js. Safe to delete (the game still runs).
// Console:  missionInfo()    missionTest('clear'|'capture'|'defend'|'won')
// ============================================================
import * as THREE from 'three';
import { getEnemies, killCount } from './enemies.js';
import { extrasEvent } from './extras.js';
import { heightAt } from './terrain.js';
import { findPath } from './pathfinding.js';


// ---------- knobs ----------
const SQ = { x: 120, z: 80, half: 10 };   // town square (same as layout.js PADS)
const REQUIRE_ROBOTS = true;      // false = only the human guards must be killed (mechs/turrets optional)
const CLEAR_LEFT_OK = 0;          // clear phase ends when this many (or fewer) enemies are left
const CAPTURE_TIME = 12;          // seconds standing in the square to capture it
const CAPTURE_DECAY = 0.5;        // the bar falls at this share of the fill speed when you leave
const SOLDIER_BONUS = 0.15;       // each soldier in the square speeds up the capture by this
const CONTEST_R = 28;             // an enemy this close to the square stops the capture (m)
const DEFEND_TIME = 180;          // seconds you must hold the town after capturing it
const OVERTIME = 75;              // after this many extra seconds the enemy retreats (victory)
const ENEMY_SQ_R = 13;            // enemy counts as "in the square" within this distance
const FRIEND_SQ_R = 14;           // you or a soldier within this keeps the square yours
const RETAKE_TIME = 15;           // seconds of enemy control to lose the town
const PAR_MINUTES = 12;           // rank: every minute over this costs points
const RADIO_VOICE = false;        // true = the browser speaks the radio messages (free, built in)
const RADIO_NAME = 'COMMAND';


// ---------- state ----------
let ctx = null;
let phase = 'wait';               // wait | train | clear | capture | defend | won | lost
let time = 0;                     // mission clock (seconds, only while playing)
let introActive = false;
let seenEnemies = false, clearTotal = 0, halfSaid = false, lowSaid = false;
let cap = 0, contested = false;
let defendT = 0, retake = 0, defHalfSaid = false, def30Said = false, attackSaid = 0;
let machineKills = 0, soldiersLost = 0;
let army = 0, armyT = 0;
let waveText = '';
let dronesMod = null, robotsMod = null;
let stored = null, routeT = 0;
let t = 0;


const seenAlive = new WeakMap();
const lostSeen = new WeakSet();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };


import('./drones.js').then(m => { dronesMod = m; }).catch(() => {});
import('./robots.js').then(m => { robotsMod = m; }).catch(() => {});


// ---------- counting enemies ----------
const isDead = o => !o || o.dead === true || o.alive === false || (typeof o.hp === 'number' && o.hp <= 0);


function listOf(mod, fn) {
  try {
    const r = mod && typeof mod[fn] === 'function' ? mod[fn]() : null;
    return Array.isArray(r) ? r : [];
  } catch (e) { return []; }
}


const humansAlive = () => getEnemies().filter(e => !e.dead);
const dronesLeft = () => listOf(dronesMod, 'getDrones').filter(d => !isDead(d)).length;


function robotsLeft() {
  try {
    if (robotsMod && typeof robotsMod.robotsAlive === 'function') {
      const r = robotsMod.robotsAlive();
      if (typeof r === 'number') return r;
      if (Array.isArray(r)) return r.length;
    }
  } catch (e) { /* fall through */ }
  return listOf(robotsMod, 'getRobots').filter(r => !isDead(r)).length;
}


const requiredLeft = () => humansAlive().length + (REQUIRE_ROBOTS ? robotsLeft() : 0);


function enemiesNear(x, z, r) {
  let n = 0;
  for (const e of getEnemies()) if (!e.dead && Math.hypot(e.x - x, e.z - z) < r) n++;
  return n;
}


function soldiersNear(x, z, r) {
  let n = 0;
  if (!ctx) return 0;
  for (const s of ctx.getSoldiers()) if (!s.dead && Math.hypot(s.x - x, s.z - z) < r) n++;
  return n;
}


function trackDeaths() {
  const objs = listOf(dronesMod, 'getDrones').concat(listOf(robotsMod, 'getRobots'));
  for (const o of objs) {
    const alive = !isDead(o);
    if (seenAlive.get(o) === true && !alive) machineKills++;
    seenAlive.set(o, alive);
  }
  if (ctx) {
    for (const s of ctx.getSoldiers()) {
      if (s.dead && !lostSeen.has(s)) { lostSeen.add(s); soldiersLost++; }
    }
  }
}


function readArmy() {
  const el = document.getElementById('train-supply');
  if (!el) return 0;
  const m = /ARMY\s*(\d+)/i.exec(el.textContent || '');
  return m ? parseInt(m[1], 10) : 0;
}


function soldierTrained(c, dt) {
  armyT -= dt;
  if (armyT <= 0) { armyT = 0.25; army = readArmy(); }
  return c.getSoldiers().length > 0 || army > 0;
}


// ---------- small HTML helpers ----------
const BASE_CSS = 'position:fixed;z-index:17;pointer-events:none;display:none;';
function box(id, css) {
  const d = document.createElement('div');
  d.id = id; d.style.cssText = BASE_CSS + css;
  document.body.appendChild(d);
  return d;
}


let objEl, barEl, barLabel, barFill, radioEl, radioHead, radioMsg, bannerEl, endEl;
let lastObj = '', curObj = null, curBar = null;
let radioCur = 0, radioGap = 0;
const radioQ = [];
let bannerT = 0;


function buildHud() {
  objEl = box('mission-objective',
    'top:56px;left:50%;transform:translateX(-50%);padding:8px 18px;border-radius:4px;white-space:nowrap;' +
    'background:rgba(8,14,22,0.72);border:1px solid rgba(64,224,255,0.5);border-left:3px solid #40e0ff;' +
    'color:#fff;font-size:14px;letter-spacing:1px;text-shadow:0 1px 3px #000;');


  barEl = box('mission-bar',
    'top:98px;left:50%;transform:translateX(-50%);width:340px;padding:6px 10px;border-radius:4px;' +
    'background:rgba(8,14,22,0.72);border:1px solid rgba(255,255,255,0.18);');
  barLabel = document.createElement('div');
  barLabel.style.cssText = 'color:#fff;font-size:12px;letter-spacing:2px;text-align:center;margin-bottom:5px;text-shadow:0 1px 3px #000;';
  const track = document.createElement('div');
  track.style.cssText = 'height:8px;border-radius:4px;background:rgba(255,255,255,0.15);overflow:hidden;';
  barFill = document.createElement('div');
  barFill.style.cssText = 'height:100%;width:0%;background:#ffd24a;';
  track.appendChild(barFill);
  barEl.appendChild(barLabel); barEl.appendChild(track);


  radioEl = box('mission-radio',
    'left:24px;top:30%;width:290px;padding:10px 12px;border-radius:5px;' +
    'background:rgba(8,14,22,0.82);border:1px solid rgba(255,210,74,0.45);border-left:3px solid #ffd24a;');
  radioHead = document.createElement('div');
  radioHead.style.cssText = 'color:#ffd24a;font-size:11px;letter-spacing:3px;margin-bottom:4px;';
  radioMsg = document.createElement('div');
  radioMsg.style.cssText = 'color:#e6eef3;font-size:13px;line-height:1.4;';
  radioEl.appendChild(radioHead); radioEl.appendChild(radioMsg);


  bannerEl = box('mission-banner',
    'z-index:18;top:20%;left:50%;transform:translateX(-50%);text-align:center;white-space:nowrap;' +
    'transition:opacity 0.6s;opacity:0;text-shadow:0 2px 8px #000;');
  bannerEl.style.display = 'block';
}


function render(active) {
  const showObj = active && curObj;
  if (showObj) {
    if (curObj !== lastObj) { objEl.innerHTML = curObj; lastObj = curObj; }
    objEl.style.display = 'block';
  } else objEl.style.display = 'none';


  if (active && curBar) {
    barEl.style.display = 'block';
    barLabel.textContent = curBar.label;
    barFill.style.width = Math.round(clamp(curBar.pct, 0, 1) * 100) + '%';
    barFill.style.background = curBar.color;
  } else barEl.style.display = 'none';


  radioEl.style.display = active && radioCur > 0 ? 'block' : 'none';
}


const TAG = '<span style="color:#40e0ff;font-weight:bold;margin-right:8px">OBJECTIVE</span>';
const B = s => '<b style="color:#ffd24a">' + s + '</b>';


// ---------- radio ----------
let ac = null;
function tone(f, start, dur, vol, type) {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.value = f;
    const t0 = ac.currentTime + start;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) { /* no audio */ }
}
const squelch = () => { tone(1250, 0, 0.07, 0.035, 'square'); tone(900, 0.09, 0.09, 0.03, 'square'); };
const fanfare = () => [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.16, 0.5, 0.07, 'triangle'));
const sadTone = () => [330, 262, 196].forEach((f, i) => tone(f, i * 0.28, 0.6, 0.07, 'triangle'));


export function radio(text, from) {
  if (radioQ.length >= 4) radioQ.shift();
  radioQ.push({ text, from: from || RADIO_NAME });
}


function tickRadio(dt) {
  if (radioCur > 0) {
    radioCur -= dt;
    if (radioCur <= 0) radioGap = 0.5;
    return;
  }
  if (radioGap > 0) { radioGap -= dt; return; }
  if (!radioQ.length) return;
  const m = radioQ.shift();
  radioHead.textContent = '▌' + m.from + ' · RADIO';
  radioMsg.textContent = m.text;
  radioCur = Math.max(4.5, m.text.length * 0.06);
  squelch();
  if (RADIO_VOICE && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(m.text);
      u.rate = 1.05; u.pitch = 0.8; u.volume = 0.8;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }
}


// ---------- banner ----------
export function banner(title, sub, color) {
  if (!bannerEl) return;
  bannerEl.innerHTML =
    '<div style="font-size:34px;font-weight:bold;letter-spacing:6px;color:' + (color || '#fff') + '">' + title + '</div>' +
    (sub ? '<div style="font-size:15px;letter-spacing:3px;color:#e6eef3;margin-top:6px">' + sub + '</div>' : '');
  bannerEl.style.opacity = '1';
  bannerT = 4.5;
}


function tickBanner(dt) {
  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0 && bannerEl) bannerEl.style.opacity = '0';
  }
}


// ---------- the town square marker (ring + beam) ----------
let zone = null, ringMat = null, beamMat = null, beam = null, ring = null;


function buildZone(scene) {
  zone = new THREE.Group();
  zone.visible = false;


  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0.95)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(cv);


  beamMat = new THREE.MeshBasicMaterial({
    map: tex, color: 0xffd24a, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
  });
  beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 80, 16, 1, true), beamMat);
  beam.position.y = 40;
  beam.frustumCulled = false;
  zone.add(beam);


  // square outline: a 4-sided ring turned 45 degrees (half side about 10 m)
  const ringGeo = new THREE.RingGeometry(13.6, 14.2, 4, 1);
  ringGeo.rotateZ(Math.PI / 4);
  ringGeo.rotateX(-Math.PI / 2);
  ringMat = new THREE.MeshBasicMaterial({
    color: 0xffd24a, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.45;
  ring.frustumCulled = false;
  zone.add(ring);


  zone.position.set(SQ.x, heightAt(SQ.x, SQ.z), SQ.z);
  scene.add(zone);
}


function zoneColor() {
  if (phase === 'clear') return 0xff5a5a;
  if (phase === 'capture') return contested ? 0xff5a5a : 0xffd24a;
  if (phase === 'defend') return retake > 0 ? 0xff3a3a : 0x6dff9a;
  return 0xffd24a;
}


function updateZone(active, dist) {
  if (!zone) return;
  const show = active && (phase === 'clear' || phase === 'capture' || phase === 'defend');
  zone.visible = show;
  if (!show) return;
  const c = zoneColor();
  ringMat.color.setHex(c);
  beamMat.color.setHex(c);
  ringMat.opacity = 0.55 + 0.25 * Math.sin(t * 4);
  beamMat.opacity = clamp((dist - 10) / 25, 0.12, 0.6);
  const bs = clamp(dist / 80, 1, 3);
  beam.scale.set(bs, 1, bs);
}


// ---------- minimap route to the square ----------
function toPoints(path) {
  if (!path || !path.length) return null;
  const out = [];
  for (const q of path) {
    if (Array.isArray(q)) out.push({ x: q[0], z: q[1] });
    else if (q && typeof q.x === 'number') out.push({ x: q.x, z: (q.z !== undefined ? q.z : q.y) });
  }
  return out.length ? out : null;
}


function updateRoute(c, dt, dist) {
  const p = c.player;
  if (dist < 14) { c.guideRoute = null; return; }
  routeT -= dt;
  if (routeT <= 0 || !stored) {
    routeT = 0.8;
    let pts = null;
    try { pts = toPoints(findPath(p.x, p.z, SQ.x, SQ.z)); } catch (e) { pts = null; }
    if (!pts) pts = [{ x: p.x, z: p.z }, { x: SQ.x, z: SQ.z }];
    stored = pts;
  }
  const route = [{ x: p.x, z: p.z }];
  let ci = 0, cd = Infinity;
  for (let i = 0; i < stored.length; i++) {
    const dd = Math.hypot(stored[i].x - p.x, stored[i].z - p.z);
    if (dd < cd) { cd = dd; ci = i; }
  }
  for (let i = ci + 1; i < stored.length; i++) route.push(stored[i]);
  if (route.length < 2) route.push({ x: SQ.x, z: SQ.z });
  c.guideRoute = route;
}


// ---------- end screen ----------
function rankData() {
  let score = 100 - soldiersLost * 6;
  const mins = time / 60;
  if (mins > PAR_MINUTES) score -= (mins - PAR_MINUTES) * 6;
  score = clamp(Math.round(score), 0, 100);
  const name = score >= 80 ? 'GOLD' : score >= 50 ? 'SILVER' : 'BRONZE';
  return { score, name };
}


const totalKills = () => killCount() + machineKills;


function removeEnd() {
  if (endEl) { endEl.remove(); endEl = null; }
}


function showEnd(won, title, sub) {
  removeEnd();
  const r = rankData();
  const col = won ? '#7dff9a' : '#ff6b6b';
  const rankCol = { GOLD: '#ffd24a', SILVER: '#d6e2ea', BRONZE: '#d98b4a' }[r.name];
  const row = (a, b) =>
    '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.1)">' +
    '<span style="color:#9fb2bf">' + a + '</span><b style="color:#fff">' + b + '</b></div>';
  endEl = document.createElement('div');
  endEl.id = 'mission-end';
  endEl.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(3,7,12,0.88);color:#dbe8f0;';
  endEl.innerHTML =
    '<div style="width:380px;max-width:92vw;padding:26px 28px;border-radius:8px;background:rgba(10,18,28,0.96);' +
    'border:1px solid ' + col + ';box-shadow:0 0 40px rgba(0,0,0,0.6);text-align:center">' +
    '<div style="font-size:11px;letter-spacing:4px;color:#40e0ff">OPERATION PORT TOWN</div>' +
    '<div style="font-size:28px;font-weight:bold;letter-spacing:4px;color:' + col + ';margin:8px 0 4px">' + title + '</div>' +
    '<div style="font-size:13px;color:#b9c9d4;margin-bottom:16px">' + sub + '</div>' +
    '<div style="text-align:left;font-size:14px;margin-bottom:16px">' +
    row('Time', fmt(time)) +
    row('Enemies defeated', totalKills()) +
    row('Soldiers lost', soldiersLost) +
    (won ? row('Rank', '<span style="color:' + rankCol + ';letter-spacing:2px">' + r.name + ' · ' + r.score + '</span>') : '') +
    '</div>' +
    '<button id="mission-again" style="cursor:pointer;padding:10px 20px;margin:4px;border-radius:4px;border:1px solid ' + col +
    ';background:rgba(255,255,255,0.06);color:#fff;font-size:14px;letter-spacing:2px">↻ ' + (won ? 'PLAY AGAIN' : 'TRY AGAIN') + '</button>' +
    (won ? '<button id="mission-free" style="cursor:pointer;padding:10px 20px;margin:4px;border-radius:4px;border:1px solid #40e0ff;' +
      'background:rgba(255,255,255,0.06);color:#fff;font-size:14px;letter-spacing:2px">EXPLORE THE ISLAND</button>' : '') +
    '</div>';
  document.body.appendChild(endEl);
  const again = endEl.querySelector('#mission-again');
  if (again) again.addEventListener('click', () => location.reload());
  const free = endEl.querySelector('#mission-free');
  if (free) free.addEventListener('click', removeEnd);
  try { document.exitPointerLock(); } catch (e) { /* ignore */ }
}


// ---------- phases ----------
function setPhase(p) {
  phase = p;
  if (p === 'train') {
    radio('Commander, Command here. The Space Gang holds Port Town. Go to the Barracks and train your first soldier.');
  } else if (p === 'clear') {
    seenEnemies = false; clearTotal = 0; halfSaid = false; lowSaid = false;
    radio('Good. Your army is growing. Now take the town back: clear the guards, and watch for drones and mechs.');
  } else if (p === 'capture') {
    cap = 0; contested = false;
    banner('TOWN CLEARED', 'Move to the town square and hold it', '#ffd24a');
    radio('Port Town is clear! Move to the town square and hold it to capture the town.');
  } else if (p === 'defend') {
    defendT = 0; retake = 0; defHalfSaid = false; def30Said = false; attackSaid = 0;
    banner('PORT TOWN CAPTURED', 'Hold the town!', '#7dff9a');
    radio('Port Town is ours! Warning: the Space Gang is sending reinforcements from the sea. Hold the square at all costs.');
  }
  console.log('[missions] phase: ' + p);
  extrasEvent('mission', { phase: p });
}


function win(reason) {
  if (phase === 'won' || phase === 'lost') return;
  phase = 'won';
  banner('MISSION COMPLETE', '', '#7dff9a');
  radio(reason || 'Outstanding work, Commander. Port Town is secure. Command out.');
  fanfare();
  extrasEvent('mission', { phase: 'won' });
  setTimeout(() => { if (phase === 'won') showEnd(true, 'MISSION COMPLETE', 'Port Town is secure. The Space Gang is defeated.'); }, 2500);
}


function lose(why) {
  if (phase === 'won' || phase === 'lost') return;
  phase = 'lost';
  sadTone();
  extrasEvent('mission', { phase: 'lost' });
  if (why === 'retaken') {
    banner('PORT TOWN LOST', '', '#ff6b6b');
    setTimeout(() => { if (phase === 'lost') showEnd(false, 'MISSION FAILED', 'The Space Gang retook the town square.'); }, 2000);
  }
  // when the player dies, main.js shows its own YOU DIED screen
}


function stepClear(c) {
  const hum = humansAlive().length, mach = robotsLeft(), dr = dronesLeft();
  const rem = hum + (REQUIRE_ROBOTS ? mach : 0);
  if (hum > 0 || mach > 0) seenEnemies = true;
  if (!seenEnemies) { curObj = null; return; }
  clearTotal = Math.max(clearTotal, rem);
  if (!halfSaid && clearTotal >= 4 && rem <= clearTotal / 2) {
    halfSaid = true; radio('Half of them are down. Keep up the pressure!');
  }
  if (!lowSaid && clearTotal >= 4 && rem <= 2 && rem > CLEAR_LEFT_OK) {
    lowSaid = true; radio('Only a few left, Commander. Finish them!');
  }
  const extra = (dr > 0 ? '  <span style="color:#9fb2bf;font-size:12px">Drones ' + dr + '</span>' : '');
  curObj = TAG + 'Clear Port Town · Enemies left ' + B(rem) + '/' + clearTotal + extra;
  if (rem <= CLEAR_LEFT_OK) setPhase('capture');
}


function stepCapture(c, dt) {
  const p = c.player;
  const dist = Math.hypot(SQ.x - p.x, SQ.z - p.z);
  const inSq = Math.abs(p.x - SQ.x) <= SQ.half && Math.abs(p.z - SQ.z) <= SQ.half;
  contested = enemiesNear(SQ.x, SQ.z, CONTEST_R) > 0;
  const soldiersIn = soldiersNear(SQ.x, SQ.z, SQ.half + 2);
  let label;
  if (inSq && !contested) {
    cap += dt / CAPTURE_TIME * (1 + Math.min(soldiersIn, 6) * SOLDIER_BONUS);
    label = 'CAPTURING THE SQUARE';
  } else if (inSq) {
    label = 'CONTESTED · KILL THE ENEMIES NEARBY';
  } else {
    cap -= dt / CAPTURE_TIME * CAPTURE_DECAY;
    label = contested ? 'ENEMIES NEAR THE SQUARE' : 'RETURN TO THE SQUARE';
  }
  cap = clamp(cap, 0, 1);
  curBar = { label, pct: cap, color: contested ? '#ff6b6b' : '#ffd24a' };
  curObj = inSq
    ? TAG + 'Hold the town square · ' + B(Math.round(cap * 100) + '%')
    : TAG + 'Go to the town square · ' + B(Math.round(dist) + ' m');
  if (cap >= 1) setPhase('defend');
}


function stepDefend(c, dt) {
  const p = c.player;
  defendT += dt;
  // who holds the square?
  const enemies = enemiesNear(SQ.x, SQ.z, ENEMY_SQ_R);
  const playerIn = !p.dead && Math.hypot(p.x - SQ.x, p.z - SQ.z) < FRIEND_SQ_R;
  const friends = (playerIn ? 1 : 0) + soldiersNear(SQ.x, SQ.z, FRIEND_SQ_R - 2);
  if (enemies > 0 && friends === 0) {
    retake += dt * (1 + 0.2 * (enemies - 1));
    if (attackSaid <= 0) { radio('They are taking the square! Get back there!'); attackSaid = 25; }
  } else {
    retake = Math.max(0, retake - dt * 1.5);
  }
  if (attackSaid > 0) attackSaid -= dt;
  contested = retake > 0;


  const left = DEFEND_TIME - defendT;
  const rem = requiredLeft();
  if (retake > 0) {
    curBar = { label: 'TOWN SQUARE UNDER ATTACK · RETURN!', pct: retake / RETAKE_TIME, color: '#ff4a4a' };
  } else {
    curBar = { label: left > 0 ? 'HOLD THE LINE · ' + fmt(left) : 'DESTROY THE LAST ENEMIES · ' + rem + ' LEFT',
               pct: defendT / DEFEND_TIME, color: '#6dff9a' };
  }
  const wave = waveText ? '  <span style="color:#9fb2bf;font-size:12px">' + waveText + '</span>' : '';
  curObj = left > 0
    ? TAG + 'Defend Port Town · ' + B(fmt(left)) + ' left' + wave
    : TAG + 'Destroy the last enemies · ' + B(rem) + ' left' + wave;


  if (!defHalfSaid && defendT >= DEFEND_TIME / 2) { defHalfSaid = true; radio('Halfway there, Commander. Stay in the square and keep your soldiers close.'); }
  if (!def30Said && left <= 30 && left > 0) { def30Said = true; radio('Thirty seconds. Hold on!'); }


  if (retake >= RETAKE_TIME) { lose('retaken'); return; }
  if (defendT >= DEFEND_TIME && rem <= 0) win();
  else if (defendT >= DEFEND_TIME + OVERTIME) win('The enemy is retreating. Port Town is secure. Well done, Commander.');
}


function startMission() {
  time = 0;
  setPhase('train');
}


function clearAll() {
  removeEnd();
  radioQ.length = 0; radioCur = 0; radioGap = 0;
  bannerT = 0;
  if (bannerEl) bannerEl.style.opacity = '0';
  curObj = null; curBar = null; lastObj = '';
  if (zone) zone.visible = false;
  if (ctx) ctx.guideRoute = null;
}


// ============================================================
// extras.js hooks
// ============================================================
export function init(c) {
  ctx = c;
  buildHud();
  buildZone(c.scene);
  console.log('[missions] ready. Phases: train > clear > capture > defend. Console: missionInfo(), missionTest("capture")');
}


export function update(dt, c) {
  ctx = c;
  dt = Math.min(dt, 0.1);
  t += dt;
  if (!c.isReady()) return;
  trackDeaths();


  const p = c.player;
  const playing = c.isPlaying() && !introActive;
  const active = playing && !p.dead;
  tickBanner(dt);
  tickRadio(playing ? dt : 0);
  curObj = null; curBar = null;


  if (phase === 'wait') {
    if (active) startMission();
    render(false);
    return;
  }
  if (phase === 'won' || phase === 'lost') { updateZone(false, 0); render(false); return; }


  if (active) {
    time += dt;
    if (phase === 'train') { if (soldierTrained(c, dt)) setPhase('clear'); }
    else if (phase === 'clear') stepClear(c);
    else if (phase === 'capture') stepCapture(c, dt);
    else if (phase === 'defend') stepDefend(c, dt);
  }


  const dist = Math.hypot(SQ.x - p.x, SQ.z - p.z);
  updateZone(active, dist);
  if (active && (phase === 'clear' || phase === 'capture')) updateRoute(c, dt, dist);
  render(active);
}


export function onEvent(name, data) {
  if (name === 'died') {
    if (phase === 'clear' || phase === 'capture' || phase === 'defend' || phase === 'train') lose('died');
  } else if (name === 'restart') {
    reset();
  } else if (name === 'intro') {
    introActive = !!(data && data.active);
  }
}


export function reset() {
  phase = 'wait'; time = 0; introActive = false;
  seenEnemies = false; clearTotal = 0; halfSaid = false; lowSaid = false;
  cap = 0; contested = false;
  defendT = 0; retake = 0; defHalfSaid = false; def30Said = false; attackSaid = 0;
  machineKills = 0; soldiersLost = 0;
  army = 0; armyT = 1.0; waveText = '';
  stored = null; routeT = 0;
  clearAll();
}


// ---------- for waves.js and intro.js ----------
export function getMission() {
  return {
    phase, time, defendT, defendTime: DEFEND_TIME, retake,
    square: { x: SQ.x, z: SQ.z, half: SQ.half },
    kills: totalKills(), soldiersLost
  };
}


// waves.js tells us what to show next to the timer, e.g. reportWaves({ text: 'Wave 2/3' })
export function reportWaves(info) {
  waveText = (info && info.text) ? String(info.text) : '';
}


// ---------- console helpers (testing only) ----------
window.missionInfo = () => {
  const s = 'phase ' + phase + ' · time ' + fmt(time) + ' · humans ' + humansAlive().length +
    ' · robots ' + robotsLeft() + ' · drones ' + dronesLeft() +
    ' · kills ' + totalKills() + ' · soldiers lost ' + soldiersLost +
    ' · capture ' + Math.round(cap * 100) + '% · defend ' + fmt(defendT) + ' · retake ' + retake.toFixed(1);
  console.log('[missions] ' + s);
  return s;
};


window.missionTest = name => {
  const ok = ['train', 'clear', 'capture', 'defend', 'won'];
  if (!ok.includes(name)) { console.log("missionTest: use one of " + ok.join(', ')); return; }
  removeEnd();
  if (phase === 'wait' || phase === 'won' || phase === 'lost') { time = Math.max(time, 1); }
  if (name === 'won') { phase = 'defend'; win(); return; }
  setPhase(name);
};