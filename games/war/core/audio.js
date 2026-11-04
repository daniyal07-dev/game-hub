// games/war/core/audio.js
// All War Mode sound. Music and effects are made by code.
// Gunfire uses ONE real recording: sounds/gunshot.mp3 (in the project root).
// Each weapon plays it with a different pitch / length / volume.

let ctx = null;
let master, sfxGain, musicGain;
let noiseBuf = null;
const vols = { master: 0.7, sfx: 0.8, music: 0.5 };

/* ---------- Real gunshot settings (change numbers here) ---------- */
// Path is worked out from this file's location: games/war/core/ -> project root -> sounds/
const GUNSHOT_URL = new URL('../../../sounds/gunshot.mp3', import.meta.url).href;

// rate = pitch/speed (1 = original, lower = deeper)
// vol  = loudness
// len  = max seconds it plays (0 = whole file). Short = clean for fast automatic fire.
// layer= extra deeper copy played on top for more weight (0 = none)
const GUN = {
  pistol:    { rate: 1.00, vol: 0.85, len: 0,    layer: 0 },
  rifle:     { rate: 1.12, vol: 0.70, len: 0.30, layer: 0 },
  shotgun:   { rate: 0.80, vol: 1.00, len: 0,    layer: 0.58 },
  sniper:    { rate: 0.62, vol: 1.00, len: 0,    layer: 0.45 },
  enemyShot: { rate: 1.18, vol: 0.55, len: 0.28, layer: 0 },
  turret:    { rate: 1.30, vol: 0.60, len: 0.22, layer: 0 }
};
const GUN_VARIATION = 0.07;   // random pitch change per shot (0.07 = +-7%)
const MAX_GUN_VOICES = 12;    // most gun sounds allowed at the same time

let gunBuf = null;            // the decoded gunshot (null until loaded)
let gunVoices = 0;

async function loadGunshot() {
  try {
    const res = await fetch(GUNSHOT_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.arrayBuffer();
    gunBuf = await ctx.decodeAudioData(data);
  } catch (err) {
    console.warn('gunshot.mp3 not loaded, using code sounds instead:', err.message);
  }
}

/* ---------- Setup ---------- */
export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  // Compressor stops loud explosions from distorting
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  comp.connect(ctx.destination);

  master = ctx.createGain();
  sfxGain = ctx.createGain();
  musicGain = ctx.createGain();
  sfxGain.connect(master);
  musicGain.connect(master);
  master.connect(comp);

  // One shared buffer of random noise (used for explosions, hi-hats)
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  applyVolumes();
  loadGunshot();
  return ctx;
}

// Values from 0 to 1. Any key can be left out.
export function setVolumes(v) {
  Object.assign(vols, v);
  applyVolumes();
}

function applyVolumes() {
  if (!ctx) return;
  master.gain.value = vols.master;
  sfxGain.gain.value = vols.sfx;
  musicGain.gain.value = vols.music * 0.6;
}

export function pauseAudio()  { if (ctx && ctx.state === 'running') ctx.suspend(); }
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

/* ---------- Building blocks ---------- */
// A single beep. slide = frequency to glide towards.
function tone(freq, dur, type = 'sine', vol = 0.3, slide = null, delay = 0, dest = null) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest || sfxGain);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// A burst of filtered noise.
function noise(dur, vol = 0.3, filterFreq = 1200, filterType = 'lowpass', delay = 0, dest = null, sweepTo = null) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(filterFreq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(dest || sfxGain);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

/* ---------- Real gunshot player ---------- */
// One copy of the recording. v = 0..1 (1 = close, lower = far away)
function gunVoice(rate, vol, len, v, delay = 0) {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = gunBuf;
  // small random pitch change so repeated shots never sound identical
  src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * GUN_VARIATION);

  // distance: far shots lose their high frequencies (sound muffled)
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1200 + v * v * 16000;

  // small random loudness change, and quieter when far away
  const g = ctx.createGain();
  const level = vol * (0.35 + 0.65 * v) * (0.92 + Math.random() * 0.16);
  g.gain.setValueAtTime(level, t);
  let stopAt = t + gunBuf.duration / src.playbackRate.value;
  if (len > 0 && len < gunBuf.duration) {
    // fade out early so fast automatic fire stays clean
    g.gain.setValueAtTime(level, t + len * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    stopAt = t + len + 0.02;
  }

  src.connect(lp);
  lp.connect(g);
  g.connect(sfxGain);
  gunVoices++;
  src.onended = () => { gunVoices--; };
  src.start(t);
  src.stop(stopAt);
}

function gunShot(name, v) {
  if (gunVoices >= MAX_GUN_VOICES) return;                 // too many at once
  if (gunVoices >= MAX_GUN_VOICES - 4 && v < 0.5) return;  // when busy, skip quiet far shots
  const c = GUN[name];
  gunVoice(c.rate, c.vol, c.len, v);
  if (c.layer) gunVoice(c.layer, c.vol * 0.55, 0, v, 0.012);   // deeper copy for weight
}

/* ---------- Sound effects ---------- */
// play('rifle')            normal volume
// play('explosion', 0.4)   quieter, for far-away sounds
// Gun entries below are the old code sounds, used only if gunshot.mp3 fails to load.
const SOUNDS = {
  pistol(v)  { tone(520, 0.12, 'square', 0.22 * v, 140); noise(0.08, 0.25 * v, 3000, 'highpass'); },
  rifle(v)   { tone(300, 0.09, 'sawtooth', 0.2 * v, 90); noise(0.07, 0.3 * v, 2500, 'bandpass'); },
  shotgun(v) { noise(0.28, 0.6 * v, 2200, 'lowpass', 0, null, 300); tone(110, 0.25, 'sawtooth', 0.35 * v, 45); },
  sniper(v)  { noise(0.35, 0.5 * v, 3500, 'lowpass', 0, null, 200); tone(200, 0.4, 'sawtooth', 0.3 * v, 50); },
  enemyShot(v) { tone(700, 0.14, 'triangle', 0.14 * v, 220); },
  turret(v)  { tone(160, 0.08, 'square', 0.2 * v, 80); noise(0.05, 0.2 * v, 1800, 'bandpass'); },
  mechStep(v){ noise(0.25, 0.5 * v, 300, 'lowpass'); tone(60, 0.25, 'sine', 0.4 * v, 35); },
  hit(v)     { tone(900, 0.05, 'square', 0.12 * v, 500); },
  kill(v)    { tone(500, 0.1, 'square', 0.18 * v, 1100); tone(800, 0.14, 'square', 0.16 * v, 1500, 0.07); },
  hurt(v)    { tone(160, 0.25, 'sawtooth', 0.35 * v, 60); noise(0.15, 0.25 * v, 600, 'lowpass'); },
  reload(v)  {
    tone(300, 0.05, 'square', 0.12 * v);
    tone(450, 0.05, 'square', 0.12 * v, null, 0.55);
    tone(700, 0.07, 'square', 0.14 * v, null, 1.1);
  },
  empty(v)   { tone(200, 0.05, 'square', 0.15 * v); },
  swap(v)    { tone(400, 0.05, 'square', 0.1 * v, 700); },
  throw(v)   { noise(0.2, 0.2 * v, 800, 'bandpass', 0, null, 2500); },
  bounce(v)  { tone(900, 0.04, 'sine', 0.12 * v, 600); },
  explosion(v) {
    noise(0.9, 0.9 * v, 1800, 'lowpass', 0, null, 80);
    tone(90, 0.7, 'sawtooth', 0.5 * v, 25);
  },
  bigExplosion(v) {
    noise(1.6, 1.0 * v, 1500, 'lowpass', 0, null, 60);
    tone(70, 1.4, 'sawtooth', 0.6 * v, 20);
    noise(0.8, 0.6 * v, 600, 'lowpass', 0.3);
  },
  pickup(v)  { tone(600, 0.1, 'sine', 0.22 * v, 900); tone(900, 0.14, 'sine', 0.22 * v, 1400, 0.08); },
  heal(v)    { tone(520, 0.2, 'sine', 0.2 * v, 780); tone(780, 0.25, 'sine', 0.2 * v, 1040, 0.12); },
  order(v)   { tone(880, 0.07, 'square', 0.12 * v); tone(1320, 0.09, 'square', 0.12 * v, null, 0.08); },
  comms(v)   { tone(1000, 0.05, 'sine', 0.12 * v); tone(1500, 0.07, 'sine', 0.12 * v, null, 0.07); },
  alert(v)   { tone(440, 0.18, 'sawtooth', 0.22 * v); tone(330, 0.22, 'sawtooth', 0.22 * v, null, 0.2); },
  objective(v) { tone(523, 0.15, 'triangle', 0.25 * v); tone(659, 0.15, 'triangle', 0.25 * v, null, 0.15); tone(784, 0.3, 'triangle', 0.25 * v, null, 0.3); },
  win(v) {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.28 * v, null, i * 0.16));
  },
  lose(v) {
    [330, 262, 208, 165].forEach((f, i) => tone(f, 0.45, 'sawtooth', 0.25 * v, null, i * 0.24));
  },
  click(v)   { tone(700, 0.04, 'square', 0.1 * v); }
};

export function play(name, volume = 1) {
  if (!ctx || ctx.state !== 'running') return;
  const v = Math.max(0, Math.min(1, volume));
  if (v < 0.03) return;                 // too quiet to hear, skip

  // guns use the real recording when it is loaded
  if (gunBuf && GUN[name]) { gunShot(name, v); return; }

  const fn = SOUNDS[name];
  if (!fn) return;
  fn(v);
}

// Volume from distance: full when close, silent when far.
export function distVolume(distance, maxDist = 60) {
  return Math.max(0, 1 - distance / maxDist);
}

/* ---------- Music ---------- */
// Every stage has its own key. Layers are added as intensity rises (0 to 1).
const ROOTS = [57, 55, 52, 50, 53];       // MIDI notes for stages 1..5
const BPMS  = [110, 100, 104, 118, 124];
const PROG  = [0, -4, 3, -2];             // chord roots, like Am F C G
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

let musicOn = false;
let timer = null;
let nextTime = 0;
let step = 0;
let root = 57;
let stepLen = 0.14;
let intensity = 0.2;

export function setIntensity(x) { intensity = Math.max(0, Math.min(1, x)); }

export function startMusic(stageIndex = 0) {
  if (!ctx) return;
  stopMusic();
  const i = Math.max(0, Math.min(4, stageIndex));
  root = ROOTS[i];
  stepLen = 60 / BPMS[i] / 4;           // one 16th note
  step = 0;
  intensity = 0.2;
  nextTime = ctx.currentTime + 0.1;
  musicOn = true;
  timer = setInterval(scheduler, 50);
}

export function stopMusic() {
  musicOn = false;
  if (timer) clearInterval(timer);
  timer = null;
}

function scheduler() {
  if (!musicOn || !ctx) return;
  while (nextTime < ctx.currentTime + 0.25) {
    playStep(step, nextTime);
    nextTime += stepLen;
    step = (step + 1) % 64;             // 4 bars of 16 steps
  }
}

function mTone(freq, dur, type, vol, when) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g);
  g.connect(musicGain);
  o.start(when);
  o.stop(when + dur + 0.05);
}

function mNoise(dur, vol, freq, type, when) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  s.connect(f);
  f.connect(g);
  g.connect(musicGain);
  s.start(when, Math.random());
  s.stop(when + dur + 0.05);
}

function playStep(s, when) {
  const bar = Math.floor(s / 16) % 4;
  const st = s % 16;
  const chord = root + PROG[bar];

  // Pad: long soft chord at the start of each bar
  if (st === 0) {
    [0, 3, 7].forEach(n => mTone(midi(chord + 12 + n), stepLen * 15, 'sine', 0.05, when));
  }

  // Bass: always playing
  if (st % 4 === 0 || st === 6 || st === 14) {
    mTone(midi(chord - 12), stepLen * 2.2, 'sawtooth', 0.09, when);
  }

  // Drums: join when the fight gets busy
  if (intensity >= 0.3) {
    if (st % 4 === 0) {                           // kick
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(140, when);
      o.frequency.exponentialRampToValueAtTime(40, when + 0.12);
      g.gain.setValueAtTime(0.5, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
      o.connect(g);
      g.connect(musicGain);
      o.start(when);
      o.stop(when + 0.2);
    }
    if (st === 4 || st === 12) mNoise(0.14, 0.3, 1800, 'bandpass', when);   // snare
  }
  if (intensity >= 0.5 && st % 2 === 0) mNoise(0.04, 0.12, 7000, 'highpass', when);  // hi-hat

  // Arpeggio: only in the hottest moments
  if (intensity >= 0.7) {
    const notes = [0, 7, 12, 15, 12, 7, 3, 7];
    mTone(midi(chord + 12 + notes[st % 8]), stepLen * 0.9, 'sawtooth' === 'x' ? 'sawtooth' : 'square', 0.035, when);
  }
}