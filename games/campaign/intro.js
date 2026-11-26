// ============================================================
// intro.js  (NEW FILE)  ->  games/campaign/intro.js
// Opening cinematic of Operation Port Town (plays after ENTER ISLAND):
//   1. fade in, camera high above the island, descends onto Port Town
//      "PORT TOWN HAS FALLEN"
//   2. the camera glides over the island back to the base, lands exactly
//      in the player's eyes  "OPERATION PORT TOWN"
//  - Press SPACE or ENTER to skip.
//  - While it plays the player is parked far south of the town (so the
//    enemies are drawn but cannot see him) and put back at the end.
//  - HUD, gun and minimap are hidden, cinema bars slide in.
//  - Tells missions.js through extrasEvent('intro', {active}) so the
//    mission clock and radio wait until it is over.
// Loaded by extras.js (add 'intro' LAST in MODULES). Safe to delete.
// Console:  introPlay()   (play it again)
// ============================================================
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { extrasEvent } from './extras.js';


// ---------- knobs ----------
const ENABLED = true;             // false = no intro at all
const T_DESCENT = 7;              // seconds: descent over the town
const T_GLIDE = 6;                // seconds: flight back to the base
const FADE_IN = 1.2;              // seconds: black to picture at the start
const SKIP_MIN = 1.0;             // skip works after this many seconds
const BAR_H = '13vh';             // height of the cinema bars
const GLIDE_ARC = 55;             // extra height in the middle of the glide (m)

const PARK = { x: 120, z: 215 };  // where the player waits (south of the town, out of sight)
const CAM_A = { x: 150, y: 190, z: 200 };     // start: high up
const LOOK_A = { x: 120, z: 90, dy: 0 };
const CAM_B = { x: 122, y: 26, z: 128 };      // end of descent: just south of the town
const LOOK_B = { x: 120, z: 60, dy: 9 };      // the Town Hall and its flags

const HIDE = ['#hud', '#crosshair', '#train-supply', '#train-box',
              '#guide-objective', '#guide-lock', '#guide-briefing',
              '[id*="mini"]', '[id*="map"]'];

const TEXTS = {
  a: { t: 'PORT TOWN HAS FALLEN', s: 'The Space Gang has captured the harbor town', c: '#ff5a5a' },
  b: { t: 'OPERATION PORT TOWN', s: 'Train an army. Take the town back.', c: '#40e0ff' }
};


// ---------- state ----------
let ctx = null;
let state = ENABLED ? 'wait' : 'done';        // wait | run | out | done
let time = 0, save = null, skipping = false;
let root = null, topBar = null, botBar = null, titleEl = null, hintEl = null, fadeEl = null;
let fadeV = 1, fadeGoal = 0, fadeSpeed = 1;
let curText = null, boomed = false, swept = false;
let hidden = [], kids = [];
const dummy = new THREE.PerspectiveCamera();
const qMid = new THREE.Quaternion(), qEnd = new THREE.Quaternion();
const eul = new THREE.Euler(0, 0, 0, 'YXZ');


const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, f) => a + (b - a) * f;
const smooth = f => { f = clamp(f, 0, 1); return f * f * (3 - 2 * f); };
const lookY = L => heightAt(L.x, L.z) + L.dy;


// ---------- sound (own small audio) ----------
let ac = null;
function tone(f, start, dur, vol, type) {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.value = f;
    const t0 = ac.currentTime + start;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) { /* no audio */ }
}
function sweep(f0, f1, dur, vol) {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle';
    const t0 = ac.currentTime;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) { /* no audio */ }
}
const boom = () => { tone(55, 0, 2.8, 0.2, 'sine'); tone(82, 0, 2.2, 0.08, 'triangle'); tone(41, 0.05, 3, 0.12, 'sine'); };


// ---------- screen elements ----------
function ensureDom() {
  if (!root) {
    root = document.createElement('div');
    root.id = 'intro-root';
    root.style.cssText = 'position:fixed;inset:0;z-index:9000;pointer-events:none;display:none;overflow:hidden;';
    const bar = pos => {
      const b = document.createElement('div');
      b.style.cssText = 'position:absolute;left:0;right:0;' + pos + ':0;height:0;background:#000;transition:height 1.2s ease;';
      return b;
    };
    topBar = bar('top'); botBar = bar('bottom');
    titleEl = document.createElement('div');
    titleEl.style.cssText = 'position:absolute;left:0;right:0;top:22%;text-align:center;opacity:0;' +
      'transition:opacity 0.9s;text-shadow:0 2px 12px #000;padding:0 16px;';
    hintEl = document.createElement('div');
    hintEl.style.cssText = 'position:absolute;right:24px;bottom:4vh;color:#9fb2bf;font-size:12px;letter-spacing:2px;' +
      'opacity:0;transition:opacity 0.8s;';
    hintEl.textContent = 'PRESS SPACE TO SKIP';
    root.appendChild(topBar); root.appendChild(botBar); root.appendChild(titleEl); root.appendChild(hintEl);
    document.body.appendChild(root);
  }
  if (!fadeEl) {
    fadeEl = document.createElement('div');
    fadeEl.style.cssText = 'position:fixed;inset:0;z-index:9002;background:#000;opacity:1;pointer-events:none;';
    document.body.appendChild(fadeEl);
  }
}


function setText(key) {
  if (key === curText) return;
  curText = key;
  if (!key) { titleEl.style.opacity = '0'; return; }
  const x = TEXTS[key];
  titleEl.innerHTML =
    '<div style="font-size:42px;font-weight:bold;letter-spacing:8px;color:' + x.c + '">' + x.t + '</div>' +
    '<div style="font-size:16px;letter-spacing:4px;color:#e6eef3;margin-top:10px">' + x.s + '</div>';
  titleEl.style.opacity = '1';
}


function hideGameUi(c) {
  hidden = [];
  for (const sel of HIDE) {
    let list = [];
    try { list = document.querySelectorAll(sel); } catch (e) { list = []; }
    list.forEach(el => { hidden.push([el, el.style.visibility]); el.style.visibility = 'hidden'; });
  }
  kids = c.camera.children.map(k => [k, k.visible]);
}


function showGameUi() {
  for (const [el, v] of hidden) el.style.visibility = v;
  hidden = [];
  for (const [k, v] of kids) k.visible = v;
  kids = [];
  const lock = document.getElementById('guide-lock');
  if (lock) lock.style.display = 'none';         // no leftover "train first" message
}


// ---------- start and end ----------
function begin(c) {
  const p = c.player;
  save = { x: p.x, y: p.y, z: p.z };
  ensureDom();
  hideGameUi(c);
  root.style.display = 'block';
  fadeV = 1; fadeGoal = 0; fadeSpeed = 1 / FADE_IN;
  fadeEl.style.opacity = '1';
  requestAnimationFrame(() => { topBar.style.height = BAR_H; botBar.style.height = BAR_H; });
  dummy.position.set(CAM_B.x, CAM_B.y, CAM_B.z);
  dummy.lookAt(LOOK_B.x, lookY(LOOK_B), LOOK_B.z);
  qMid.copy(dummy.quaternion);
  time = 0; skipping = false; curText = null; boomed = false; swept = false;
  hintEl.style.opacity = '0';
  state = 'run';
  extrasEvent('intro', { active: true });
  console.log('[intro] playing. SPACE or ENTER skips it');
}


function finish(c) {
  const p = c.player;
  p.x = save.x; p.z = save.z; p.y = save.y;
  p.vx = p.vz = p.vy = 0; p.grounded = true; p.fly = false;
  c.camera.position.set(save.x, save.y, save.z);
  showGameUi();
  setText(null);
  root.style.display = 'none';
  topBar.style.height = '0'; botBar.style.height = '0';
  extrasEvent('intro', { active: false });
  if (fadeV > 0.01) { fadeGoal = 0; fadeSpeed = 2.2; state = 'out'; }
  else { removeFade(); state = 'done'; }
  console.log('[intro] finished');
}


function removeFade() {
  if (fadeEl) { fadeEl.remove(); fadeEl = null; }
}


function tickFade(dt) {
  if (!fadeEl) return;
  const d = fadeGoal - fadeV, s = fadeSpeed * dt;
  fadeV = Math.abs(d) <= s ? fadeGoal : fadeV + Math.sign(d) * s;
  fadeEl.style.opacity = String(fadeV);
}


// ---------- camera path ----------
function placeCamera(c) {
  const cam = c.camera, p = c.player;
  if (time < T_DESCENT) {
    const f = smooth(time / T_DESCENT);
    const x = lerp(CAM_A.x, CAM_B.x, f), z = lerp(CAM_A.z, CAM_B.z, f);
    const y = Math.max(lerp(CAM_A.y, CAM_B.y, f), heightAt(x, z) + 4);
    dummy.position.set(x, y, z);
    dummy.lookAt(lerp(LOOK_A.x, LOOK_B.x, f), lerp(lookY(LOOK_A), lookY(LOOK_B), f), lerp(LOOK_A.z, LOOK_B.z, f));
    cam.position.copy(dummy.position);
    cam.quaternion.copy(dummy.quaternion);
    return false;
  }
  const g = clamp((time - T_DESCENT) / T_GLIDE, 0, 1), f = smooth(g);
  const x = lerp(CAM_B.x, save.x, f), z = lerp(CAM_B.z, save.z, f);
  const minY = heightAt(x, z) + lerp(3, 1.2, f);
  const y = Math.max(lerp(CAM_B.y, save.y, f) + Math.sin(Math.PI * f) * GLIDE_ARC, minY);
  cam.position.set(x, y, z);
  eul.set(p.pitch, p.yaw, 0);
  qEnd.setFromEuler(eul);
  cam.quaternion.copy(qMid).slerp(qEnd, f);
  return g >= 1;
}


// ============================================================
// extras.js hooks
// ============================================================
export function init(c) {
  ctx = c;
  if (!ENABLED) return;
  console.log('[intro] ready (plays when you press ENTER ISLAND). Console: introPlay()');
}


export function update(dt, c) {
  ctx = c;
  if (state === 'done') return;
  dt = Math.min(dt, 0.1);
  const p = c.player;


  if (state === 'out') {
    tickFade(dt);
    if (fadeV <= 0) { removeFade(); state = 'done'; }
    return;
  }


  if (state === 'wait') {
    if (!c.isPlaying() || !c.isReady() || p.dead) return;
    begin(c);
  }


  // ----- state: run -----
  const playing = c.isPlaying();
  root.style.display = playing ? 'block' : 'none';
  if (fadeEl) fadeEl.style.display = playing ? 'block' : 'none';
  if (!playing) return;                         // paused: wait for RESUME


  time += dt;
  tickFade(dt);


  // park the player far from every enemy (they are still drawn, but cannot see him)
  p.x = PARK.x; p.z = PARK.z;
  p.y = Math.max(0, heightAt(PARK.x, PARK.z)) + 1.7;
  p.vx = p.vz = p.vy = 0; p.grounded = true; p.fly = false;
  for (const [k] of kids) k.visible = false;    // no gun in the cinematic
  for (const k of c.camera.children) k.visible = false;


  const ended = placeCamera(c);


  if (!boomed && time >= 1.0) { boomed = true; boom(); }
  if (!swept && time >= T_DESCENT) { swept = true; sweep(110, 460, 3.2, 0.06); }
  if (time >= 1.0 && time < T_DESCENT - 0.8) setText('a');
  else if (time >= T_DESCENT + 0.3 && time < T_DESCENT + T_GLIDE - 0.6) setText('b');
  else setText(null);
  hintEl.style.opacity = (time >= SKIP_MIN && !skipping) ? '1' : '0';


  if (skipping) {
    if (fadeV >= 1) finish(c);
  } else if (ended) {
    finish(c);
  }
}


export function onKey(code) {
  if (state !== 'run') return false;
  if (code !== 'Space' && code !== 'Enter') return false;
  if (time >= SKIP_MIN && !skipping) {
    skipping = true; fadeGoal = 1; fadeSpeed = 4;
  }
  return true;                                  // no jump while the intro plays
}


export function introActive() {
  return state === 'run';
}


// ---------- console helper ----------
window.introPlay = () => {
  if (state === 'done') { state = 'wait'; console.log('[intro] will play as soon as the game is running'); }
  else console.log('[intro] already playing');
};