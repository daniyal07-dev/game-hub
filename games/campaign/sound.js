// ============================================================
// sound.js  (v2)  ->  games/campaign/sound.js
// Campaign audio, all free:
//   - ONE real gunshot recording (game-hub/sounds/gunshot.mp3, the same file War uses),
//     pitched per weapon, quieter + muffled + panned with distance
//   - hurt, death, reload, empty, swap, hit, kill, radio and "ready" sounds made in code
//   - quiet wind and sea ambience made in code
// Enemy, soldier and base-guard gunfire is detected here (no edits to other files).
// Your own gun: player.js can fire extrasEvent('shot', {kind}), 'reload', 'empty',
// 'swap', 'hit', 'kill' and this file plays the sounds.
// Loaded by extras.js. Safe to delete (the game still runs, just silent).
//
// v2: follows the MASTER volume saved in nova_settings (menu + Settings screen),
//     live: window event 'nova-volume' {detail:{master}}; default 0.8 sounds as before.
//     Soldiers hidden inside the truck no longer make gunshot sounds.
// ============================================================
import { heightAt, WATER_LEVEL } from './terrain.js';
import { getEnemies } from './enemies.js';
import { getSoldiers } from './units.js';


// ---------- knobs ----------
const GUN_URL = new URL('../../sounds/gunshot.mp3', import.meta.url).href;
const VOL = { master: 0.7, sfx: 0.8, amb: 0.45 };
const SETTINGS_KEY = 'nova_settings';
const MASTER_DEFAULT = 0.8;     // the menu's default; at this value VOL.master is used as is
const MAX_VOICES = 12;          // gunshots playing at once
const MAX_DIST = 120;           // a gunshot fades to silence at this distance (m)
const AUDIBLE = 160;            // beyond this nothing is played (m)
const GUN_VARIATION = 0.07;     // random pitch change per shot


// rate = pitch, vol = loudness, len = fade-out time (0 = whole sample), layer = deeper copy level
const GUN = {
  pistol:    { rate: 1.00, vol: 0.85, len: 0,    layer: 0 },
  rifle:     { rate: 1.12, vol: 0.70, len: 0.30, layer: 0 },
  shotgun:   { rate: 0.80, vol: 1.00, len: 0,    layer: 0.58 },
  enemyShot: { rate: 1.18, vol: 0.55, len: 0.28, layer: 0 },
  guardShot: { rate: 1.05, vol: 0.65, len: 0.28, layer: 0 }
};


// ---------- state ----------
let ctx = null;
let ac = null;
let master = null, sfxBus = null, ambBus = null;
let gunBuf = null, noiseBuf = null;
let voices = 0;
let seaGain = null, windGain = null;
let seaT = 0, sea = 0;
let guardsFn = null;
let initDone = false;
let userMaster = MASTER_DEFAULT;


const clamp = (v, a, b) => Math.max(a, Math.min(b, v));


// ---------- master volume (shared with the menu and the Settings screen) ----------
function readMaster() {
  try {
    const o = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const m = parseFloat(o.master);
    return isNaN(m) ? MASTER_DEFAULT : clamp(m, 0, 1);
  } catch (e) { return MASTER_DEFAULT; }
}


function masterGain() { return VOL.master * (userMaster / MASTER_DEFAULT); }


function applyMaster(smooth) {
  if (!master) return;
  if (smooth) master.gain.setTargetAtTime(masterGain(), ac.currentTime, 0.04);
  else master.gain.value = masterGain();
}


// ---------- audio graph ----------
function buildAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('no WebAudio');
  ac = new AC();


  userMaster = readMaster();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 6;
  master = ac.createGain(); master.gain.value = masterGain();
  sfxBus = ac.createGain(); sfxBus.gain.value = VOL.sfx;
  ambBus = ac.createGain(); ambBus.gain.value = 0;
  sfxBus.connect(master); ambBus.connect(master);
  master.connect(comp); comp.connect(ac.destination);


  // 2 s of white noise, used by most code-made sounds
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;


  buildAmbient();
}


function buildAmbient() {
  const len = Math.floor(ac.sampleRate * 6);
  // brown-ish noise for wind
  const wb = ac.createBuffer(1, len, ac.sampleRate);
  const wd = wb.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; wd[i] = last * 3.5; }
  const wind = ac.createBufferSource(); wind.buffer = wb; wind.loop = true;
  const wlp = ac.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 650;
  windGain = ac.createGain(); windGain.gain.value = 0.05;
  const wl = ac.createOscillator(); wl.frequency.value = 0.13;
  const wlg = ac.createGain(); wlg.gain.value = 0.02;
  wl.connect(wlg); wlg.connect(windGain.gain);
  wind.connect(wlp); wlp.connect(windGain); windGain.connect(ambBus);
  wind.start(); wl.start();


  // sea waves: noise with a slow swell
  const sb = ac.createBuffer(1, len, ac.sampleRate);
  const sd = sb.getChannelData(0);
  for (let i = 0; i < len; i++) sd[i] = (Math.random() * 2 - 1) * 0.8;
  const sr = ac.createBufferSource(); sr.buffer = sb; sr.loop = true;
  const slp = ac.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = 900;
  seaGain = ac.createGain(); seaGain.gain.value = 0.03;
  const sl = ac.createOscillator(); sl.frequency.value = 0.09;
  const slg = ac.createGain(); slg.gain.value = 0.012;
  sl.connect(slg); slg.connect(seaGain.gain);
  sr.connect(slp); slp.connect(seaGain); seaGain.connect(ambBus);
  sr.start(); sl.start();
}


function loadGun() {
  fetch(GUN_URL)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(b => ac.decodeAudioData(b))
    .then(buf => { gunBuf = buf; console.log('[sound] real gunshot loaded'); })
    .catch(e => console.warn('[sound] gunshot.mp3 not loaded, using a made sound instead:', e.message || e));
}


// ---------- small building blocks ----------
function panDest(pan) {
  if (!pan || !ac.createStereoPanner) return sfxBus;
  const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
  p.connect(sfxBus);
  return p;
}


function noise(dur, freq, gain, type, delay, dest) {
  const t = ac.currentTime + (delay || 0);
  const s = ac.createBufferSource(); s.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest || sfxBus);
  s.start(t, Math.random() * 1.4); s.stop(t + dur + 0.03);
}


function tone(freq, dur, gain, type, slideTo, delay, dest) {
  const t = ac.currentTime + (delay || 0);
  const o = ac.createOscillator(); o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(dest || sfxBus);
  o.start(t); o.stop(t + dur + 0.03);
}


// where is a world point, relative to the player? returns { d, pan }
function where(x, z) {
  const p = ctx.player;
  const dx = x - p.x, dz = z - p.z;
  const d = Math.hypot(dx, dz);
  let pan = 0;
  if (d > 0.5) {
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);        // right of the view direction
    pan = clamp((dx * rx + dz * rz) / d * 0.8, -0.8, 0.8);
  }
  return { d, pan };
}


// ---------- gunshots ----------
function playGun(kind, x, z) {
  if (!ac || ac.state !== 'running') return;
  const g = GUN[kind] || GUN.pistol;
  let d = 0, pan = 0;
  if (x !== undefined) {
    const w = where(x, z);
    d = w.d; pan = w.pan;
    if (d > AUDIBLE) return;
  }
  if (voices >= MAX_VOICES) return;


  const v = Math.max(0, 1 - d / MAX_DIST);
  const level = g.vol * (0.3 + 0.7 * v) * (0.92 + Math.random() * 0.16);
  const cutoff = 1200 + v * v * 16000;                          // far = muffled


  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
  lp.connect(panDest(pan));


  if (!gunBuf) {                                                // fallback if the file is missing
    noise(0.14, cutoff, level, 'lowpass', 0, lp);
    tone(140, 0.12, level * 0.6, 'sine', 50, 0, lp);
    return;
  }


  const t = ac.currentTime;
  const rate = g.rate * (1 + (Math.random() * 2 - 1) * GUN_VARIATION);
  const play = (r, lvl, delay) => {
    const s = ac.createBufferSource(); s.buffer = gunBuf; s.playbackRate.value = r;
    const gn = ac.createGain();
    gn.gain.setValueAtTime(lvl, t + delay);
    let stopAt = null;
    if (g.len > 0) { gn.gain.linearRampToValueAtTime(0, t + delay + g.len); stopAt = t + delay + g.len + 0.02; }
    s.connect(gn); gn.connect(lp);
    voices++;
    s.onended = () => { voices = Math.max(0, voices - 1); };
    s.start(t + delay);
    if (stopAt) s.stop(stopAt);
  };
  play(rate, level, 0);
  if (g.layer > 0) play(rate * 0.7, level * g.layer, 0.012);
}


// ---------- code-made sounds ----------
const SOUNDS = {
  hurt(o) {
    const dest = panDest(o.pan || 0);
    noise(0.18, 500, 0.5, 'lowpass', 0, dest);
    tone(110, 0.25, 0.35, 'sine', 60, 0, dest);
  },
  died() {
    tone(300, 1.2, 0.28, 'sawtooth', 50);
    noise(0.8, 300, 0.4, 'lowpass');
  },
  reload() {
    noise(0.04, 3500, 0.4, 'highpass', 0);
    tone(180, 0.05, 0.2, 'square', null, 0);
    noise(0.05, 2500, 0.5, 'highpass', 0.45);
    noise(0.06, 3000, 0.5, 'highpass', 0.9);
    tone(140, 0.08, 0.25, 'square', null, 0.9);
  },
  empty() {
    noise(0.03, 4000, 0.35, 'highpass');
    tone(900, 0.03, 0.15, 'square');
  },
  swap() {
    noise(0.06, 2000, 0.3, 'bandpass');
    tone(300, 0.08, 0.15, 'square', 200);
  },
  hit() {
    tone(1800, 0.05, 0.22, 'square');
    tone(1200, 0.04, 0.16, 'square', null, 0.04);
  },
  kill() {
    tone(900, 0.08, 0.22, 'square', 500);
    tone(600, 0.12, 0.2, 'triangle', 300, 0.06);
  },
  order() {
    tone(880, 0.06, 0.16, 'square');
    tone(1175, 0.07, 0.16, 'square', null, 0.08);
    noise(0.12, 3000, 0.06, 'bandpass');
  },
  ready() {
    tone(523, 0.12, 0.22, 'sine');
    tone(659, 0.12, 0.22, 'sine', null, 0.1);
    tone(784, 0.2, 0.25, 'sine', null, 0.2);
  },
  pickup() {
    tone(660, 0.08, 0.2, 'triangle', 990);
    tone(990, 0.1, 0.2, 'triangle', null, 0.08);
  }
};


function sfx(name, o) {
  if (!ac || ac.state !== 'running') return;
  const f = SOUNDS[name];
  if (f) f(o || {});
}


// ---------- gunfire of other people (no edits to their files) ----------
// enemies and base guards: wrap their char.fire() so every shot makes a sound
function hookFire(o, kind) {
  const ch = o && o.char;
  if (!ch || ch.__snd) return;
  const orig = ch.fire;
  ch.__snd = true;
  if (typeof orig !== 'function') return;
  try {
    ch.fire = function () {
      orig.apply(ch, arguments);
      playGun(kind, o.x, o.z);
    };
  } catch (e) { /* ignore */ }
}


// soldiers: char.fire() only restarts the animation every 0.5 s, so watch fireT instead.
// (fireT jumps up to the weapon rate after a shot; REACT sets exactly 0.35, which is skipped)
// Soldiers hidden inside the truck are skipped (the truck holds their fireT at 1).
function watchSoldiers() {
  let fresh = 0;
  for (const s of getSoldiers()) {
    if (!s._snd) { s._snd = true; fresh++; }
    const ft = s.fireT;
    const grp = s.char && s.char.group;
    const riding = !!(grp && grp.visible === false);
    if (!riding && !s.dead && s._sf !== undefined && ft > s._sf + 0.05 && Math.abs(ft - 0.35) > 1e-6) {
      playGun(s.weapon === 'shotgun' ? 'shotgun' : (s.weapon === 'rifle' ? 'rifle' : 'pistol'), s.x, s.z);
    }
    s._sf = ft;
  }
  if (fresh > 0 && fresh <= 2) sfx('ready');     // a trained soldier appeared
}


// ---------- ambience ----------
function updateSea(p) {
  let water = 0, total = 0;
  for (const r of [20, 45, 80]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      total++;
      if (heightAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r) < WATER_LEVEL) water++;
    }
  }
  sea = water / total;
}


// ============================================================
// extras.js hooks
// ============================================================
export function init(c) {
  ctx = c;
  try { buildAudio(); } catch (e) { console.warn('[sound] audio not available:', e.message || e); return; }
  loadGun();
  import('./base-npcs.js').then(m => { guardsFn = m.getBaseGuards; }).catch(() => { /* no crew file: fine */ });


  const wake = () => { if (ac && ac.state === 'suspended') ac.resume().catch(() => {}); };
  ['pointerdown', 'keydown', 'click'].forEach(ev => window.addEventListener(ev, wake, true));
  document.addEventListener('pointerlockchange', wake);


  // the Settings screen tells us when the master volume changes
  window.addEventListener('nova-volume', (e) => {
    const m = e && e.detail ? parseFloat(e.detail.master) : NaN;
    userMaster = isNaN(m) ? readMaster() : clamp(m, 0, 1);
    applyMaster(true);
  });


  // Console test:  testSound('hurt')  testSound('gun','rifle')
  window.testSound = (name, kind) => {
    if (name === 'gun') playGun(kind || 'rifle'); else sfx(name);
  };
  initDone = true;
  console.log('[sound] v2 ready (wind, sea, gunfire), master volume ' + userMaster.toFixed(2) + '. Try testSound("hurt") in the Console.');
}


export function update(dt, c) {
  if (!initDone) return;
  const p = c.player;
  const active = c.isPlaying() && !p.dead;
  if (active && ac.state === 'suspended') ac.resume().catch(() => {});
  ambBus.gain.setTargetAtTime(active ? VOL.amb : 0, ac.currentTime, 0.4);
  if (!active || ac.state !== 'running') return;


  // other people's gunfire
  for (const e of getEnemies()) hookFire(e, 'enemyShot');
  if (guardsFn) { try { for (const n of guardsFn()) hookFire(n, 'guardShot'); } catch (e) { guardsFn = null; } }
  watchSoldiers();


  // ambience follows where you are
  seaT -= dt;
  if (seaT <= 0) { seaT = 0.5; updateSea(p); }
  const t = ac.currentTime;
  const high = clamp(((p.y || 0) - 5) / 60, 0, 1);
  windGain.gain.setTargetAtTime(0.05 + high * 0.14, t, 0.6);
  seaGain.gain.setTargetAtTime(0.03 + sea * 0.26, t, 0.8);
}


export function onEvent(name, data) {
  if (!initDone) return;
  data = data || {};
  switch (name) {
    case 'hurt': {
      const w = data.fromX !== undefined ? where(data.fromX, data.fromZ) : { pan: 0 };
      sfx('hurt', { pan: w.pan });
      break;
    }
    case 'died':   sfx('died'); break;
    case 'order':  sfx('order'); break;
    case 'shot':   playGun(data.kind || 'rifle'); break;      // your own gun (from player.js)
    case 'reload': sfx('reload'); break;
    case 'empty':  sfx('empty'); break;
    case 'swap':   sfx('swap'); break;
    case 'hit':    sfx('hit'); break;
    case 'kill':   sfx('kill'); break;
    case 'pickup': sfx('pickup'); break;
    default: break;
  }
}


export function reset() {
  voices = 0;
}