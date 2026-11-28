// ============================================================
//  NOVA STRIKE 3D — Campaign: games/campaign/music.js  (v3)
//  "Operation Port Town" soundtrack, built live in code
//  (WebAudio): no audio files, 100% free.
//
//  Key: D minor (dark, military). 4-bar loop: Dm | Bb | Gm | A
//  The music has an INTENSITY from 0 to 1 and layers fade in by it:
//    0.00  at the base: dark pad, deep drone, slow heartbeat,
//          a faint radar ping now and then
//    0.15  marching snare joins
//    0.40  war drums + a steady kick
//    0.50  driving bass pulse
//    0.55  hi-hats
//    0.60  tense tremolo strings
//    0.75  fast arpeggio
//  Intensity comes from: how close you are to Port Town, how
//  close the enemies are, and fighting (shots, hits, kills,
//  getting hurt). After a fight it stays up about 10 s, then
//  slowly calms down. YOU DIED = low drone only.
//
//  K = turn the music off / on (remembered).
//  Console: testMusic(0.9) forces an intensity, testMusic() releases.
//
//  v2: follows the MUSIC volume saved in nova_settings (menu + Settings
//      screen), live: window event 'nova-volume' {detail:{music}}.
//      Door for the Settings screen: window.campaignMusic = { isOn(), set(on) }
//
//  v3: ENEMY DRONES and ROBOTS (mechs + turrets) now count as threats
//      for the mood, just like the human Space Gang. A drone overhead
//      or a mech walking at you makes the music tense up.
//      (They are read from drones.js getDrones() and robots.js getRobots().)
// ============================================================



// ---------- knobs ----------
const BASE_VOL = 0.5;            // overall music loudness (0 to 1)
const MENU_VOL = 0.35;           // loudness on the start / pause screen (x BASE_VOL)
const TOWN = { x: 120, z: 80 };  // Port Town square
const NEAR_TOWN = 210;           // closer than this (m): music gets a little darker
const IN_TOWN = 120;             // closer than this (m): darker still
const BPM_LOW = 76, BPM_HIGH = 102;
const RISE = 0.6;                // how fast the intensity goes up (per second)
const FALL = 0.07;               // how slowly it calms down (per second)
const HOLD_AFTER_FIGHT = 10;     // seconds the music stays tense after a fight
const AHEAD = 0.18;              // scheduling look-ahead (seconds)
const STINGER_COOLDOWN = 30;     // seconds between "contact" hits
const SAVE_KEY = 'campaign_music';
const SETTINGS_KEY = 'nova_settings';
const MUSIC_DEFAULT = 0.7;       // the menu's default music volume; at this value BASE_VOL is used as is



// D minor loop. root = bass note (MIDI), pad = chord tones, arp = arpeggio tones
const CHORDS = [
  { root: 38, pad: [50, 53, 57], arp: [57, 62, 65, 62] },   // Dm
  { root: 34, pad: [50, 53, 58], arp: [58, 62, 65, 62] },   // Bb
  { root: 31, pad: [50, 55, 58], arp: [55, 58, 62, 58] },   // Gm
  { root: 33, pad: [52, 57, 61], arp: [57, 61, 64, 61] },   // A (tense)
];
const TOMS = { 0: 1.0, 3: 0.7, 8: 0.9, 10: 0.7, 14: 0.8 };  // war-drum pattern (step: strength)



// ---------- state ----------
const AC = window.AudioContext || window.webkitAudioContext;
let ac = null, bus = null, filt = null, dIn = null, noiseBuf = null, timer = 0;
let step = 0, bar = 0, nextT = 0;
let inten = 0, target = 0, lastSense = 0, senseT = 0;
let holdT = 0, holdLevel = 0, stingT = 0;
let dead = false, playingNow = false, forced = null;
let muted = false;
let toast = null, toastT = 0;
let userMusic = MUSIC_DEFAULT;
let getDronesFn = null, getRobotsFn = null;     // v3: drones and robots
try { muted = localStorage.getItem(SAVE_KEY) === 'off'; } catch (e) { /* ignore */ }



// ---------- small helpers ----------
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const sm = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const stepDur = () => 60 / (BPM_LOW + (BPM_HIGH - BPM_LOW) * inten) / 4;   // one 16th note



// music volume saved by the menu / Settings screen (0 to 1)
function readMusic() {
  try {
    const o = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const m = parseFloat(o.music);
    return isNaN(m) ? MUSIC_DEFAULT : Math.max(0, Math.min(1, m));
  } catch (e) { return MUSIC_DEFAULT; }
}
userMusic = readMusic();



// ---------- building blocks ----------
// One musical tone with a smooth volume shape.
//  o: type, f (Hz), to (slide to Hz), det (cents), t (start), dur, a (attack), r (release),
//     v (volume), fq (low-pass Hz), decay (drum-like fade), send (echo amount), dest
function tone(o) {
  const t = o.t, a = o.a === undefined ? 0.01 : o.a, r = o.r === undefined ? 0.1 : o.r;
  const dur = Math.max(o.dur, a + 0.01);
  const osc = ac.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  if (o.det) osc.detune.value = o.det;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.v, t + a);
  if (o.decay) {
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + r);
  } else {
    g.gain.linearRampToValueAtTime(o.v, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + r);
  }
  let last = osc;
  if (o.fq) {
    const f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = o.fq;
    osc.connect(f); last = f;
  }
  last.connect(g);
  g.connect(o.dest || bus);
  if (o.send) { const s = ac.createGain(); s.gain.value = o.send; g.connect(s); s.connect(dIn); }
  osc.start(t);
  osc.stop(t + dur + r + 0.05);
  osc.onended = () => { try { g.disconnect(); } catch (e) { /* ignore */ } };
}



// A burst of noise (snare, hi-hat, crash)
function hit(o) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = o.ft || 'highpass'; f.frequency.value = o.fq;
  if (o.q) f.Q.value = o.q;
  const g = ac.createGain();
  g.gain.setValueAtTime(o.v, o.t);
  g.gain.exponentialRampToValueAtTime(0.001, o.t + o.dur);
  src.connect(f); f.connect(g); g.connect(o.dest || bus);
  src.start(o.t, Math.random() * 0.5);
  src.stop(o.t + o.dur + 0.05);
  src.onended = () => { try { g.disconnect(); } catch (e) { /* ignore */ } };
}



function kick(t, v, f0, f1, dur) {
  tone({ type: 'sine', f: f0, to: f1, t, dur, v, a: 0.003, r: 0.02, decay: true });
}
function snare(t, v) {
  hit({ t, dur: 0.15, v, ft: 'bandpass', fq: 2000, q: 0.8 });
  tone({ type: 'triangle', f: 200, to: 120, t, dur: 0.08, v: v * 0.6, a: 0.002, r: 0.02, decay: true });
}



// Big low "contact" hit when a fight starts
function stinger() {
  if (!ac || dead || !playingNow) return;
  const t = ac.currentTime + 0.02;
  kick(t, 0.6, 75, 28, 0.9);
  hit({ t, dur: 1.6, v: 0.22, ft: 'lowpass', fq: 900 });
  tone({ type: 'sawtooth', f: mtof(38), t, dur: 0.9, a: 0.02, r: 0.5, v: 0.12, fq: 500, decay: true });
}
function tryStinger(from, to) {
  if (!ac || dead || !playingNow) return;
  if (to >= 0.6 && from < 0.4 && stingT <= 0) { stinger(); stingT = STINGER_COOLDOWN; }
}



// ---------- the music itself: one 16th-note step ----------
function playStep(st, br, t) {
  const sd = stepDur(), barDur = sd * 16, I = inten, ch = CHORDS[br];



  // YOU DIED: only a low, slow drone
  if (dead) {
    if (st === 0) {
      tone({ type: 'sine', f: mtof(26), t, dur: barDur, a: 1.5, r: 2.0, v: 0.2 });
      tone({ type: 'sawtooth', f: mtof(38), t, dur: barDur, a: 1.5, r: 2.0, v: 0.04, fq: 180 });
    }
    return;
  }



  // -- once per bar: drone, pad, strings --
  if (st === 0) {
    tone({ type: 'sine', f: mtof(ch.root), t, dur: barDur, a: 0.8, r: 1.2, v: 0.17 });
    tone({ type: 'sawtooth', f: mtof(ch.root + 12), t, dur: barDur, a: 1.0, r: 1.2, v: 0.035, fq: 260 + I * 400 });
    const pv = 0.032 * (0.85 + 0.5 * I), pf = 450 + I * 1100;
    for (const m of ch.pad) {
      for (const d of [-9, 9]) {
        tone({ type: 'sawtooth', f: mtof(m), det: d, t, dur: barDur, a: 1.3, r: 1.6, v: pv, fq: pf });
      }
    }
    const fs = sm(I, 0.6, 0.8);
    if (fs > 0.02) {                                   // tense tremolo strings
      const trem = ac.createGain(); trem.gain.value = 0.7;
      const lfo = ac.createOscillator(); lfo.frequency.value = 5.5 + I * 2;
      const lg = ac.createGain(); lg.gain.value = 0.3;
      lfo.connect(lg); lg.connect(trem.gain);
      trem.connect(bus);
      lfo.start(t); lfo.stop(t + barDur + 2.2);
      lfo.onended = () => { try { trem.disconnect(); } catch (e) { /* ignore */ } };
      for (const m of ch.pad) {
        tone({ type: 'sawtooth', f: mtof(m + 12), t, dur: barDur, a: 0.5, r: 1.4, v: 0.03 * fs, fq: 2300, dest: trem });
      }
    }
  }



  // -- heartbeat at the base, steady kick when it gets serious --
  const kq = sm(I, 0.4, 0.55);
  if (st === 0) kick(t, 0.3 * (0.6 + 0.4 * I), 80, 38, 0.28);
  else if (st === 3 && kq < 0.6) { const v = 0.16 * (1 - kq); if (v > 0.01) kick(t, v, 70, 36, 0.22); }
  else if ((st === 4 || st === 8 || st === 12) && kq > 0.02) kick(t, 0.3 * kq, 80, 38, 0.26);



  // -- marching snare --
  const fs2 = sm(I, 0.15, 0.3);
  if (fs2 > 0.02) {
    if (st === 4 || st === 12) snare(t, 0.18 * fs2);
    else if (st === 7 || st === 15) snare(t, 0.07 * fs2);
  }



  // -- war drums --
  const ft = sm(I, 0.4, 0.55);
  if (ft > 0.02 && TOMS[st]) {
    kick(t, 0.28 * ft * TOMS[st], st % 2 ? 90 : 120, st % 2 ? 50 : 62, 0.3);
  }



  // -- driving bass pulse --
  const bp = sm(I, 0.5, 0.65);
  if (bp > 0.02 && st % 2 === 0) {
    const m = (st === 6 || st === 14) ? ch.root + 7 : ch.root;
    tone({ type: 'sawtooth', f: mtof(m), t, dur: sd * 1.7, a: 0.005, r: 0.05,
           v: 0.1 * bp * (st === 0 ? 1.3 : 1), fq: 220 + I * 600 });
  }



  // -- hi-hats --
  const hp = sm(I, 0.55, 0.7), h16 = sm(I, 0.8, 0.9);
  if (hp > 0.02 && st % 4 === 2) hit({ t, dur: 0.05, v: 0.05 * hp, fq: 7500 });
  if (h16 > 0.02 && st % 2 === 1) hit({ t, dur: 0.04, v: 0.03 * h16, fq: 7500 });



  // -- fast arpeggio --
  const ap = sm(I, 0.75, 0.9);
  if (ap > 0.02) {
    tone({ type: 'square', f: mtof(ch.arp[st % 4] + 12), t, dur: sd * 0.9, a: 0.005, r: 0.03, v: 0.02 * ap, fq: 2400 });
  }



  // -- faint radar ping when it is calm --
  if (I < 0.5 && st === 8 && br % 2 === 1 && Math.random() < 0.75) {
    const g = 1 - sm(I, 0.25, 0.5);
    tone({ type: 'sine', f: mtof(81), t, dur: 0.05, a: 0.004, r: 0.15, v: 0.035 * g, send: 0.6 });
    tone({ type: 'sine', f: mtof(86), t: t + 0.14, dur: 0.05, a: 0.004, r: 0.15, v: 0.03 * g, send: 0.6 });
  }
}



// ---------- scheduler (runs by timer, so it stays smooth) ----------
function tick() {
  if (!ac || ac.state !== 'running') { nextT = 0; return; }
  if (nextT === 0 || nextT < ac.currentTime - 0.2) nextT = ac.currentTime + 0.08;
  while (nextT < ac.currentTime + AHEAD) {
    playStep(step, bar, nextT);
    nextT += stepDur();
    step++;
    if (step >= 16) { step = 0; bar = (bar + 1) % 4; }
  }
}



// ---------- audio start (browsers need a click first) ----------
function build() {
  if (ac || !AC) return;
  ac = new AC();
  bus = ac.createGain(); bus.gain.value = 0.0001;
  filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 1500;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 5;
  bus.connect(filt); filt.connect(comp); comp.connect(ac.destination);



  // echo for the radar ping
  dIn = ac.createGain();
  const dl = ac.createDelay(1); dl.delayTime.value = 0.36;
  const fb = ac.createGain(); fb.gain.value = 0.38;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
  dIn.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(filt);



  // shared noise
  const n = ac.sampleRate;
  noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;



  timer = setInterval(tick, 25);
  console.log('[music] v3 ready (code-made, D minor), music volume ' + userMusic.toFixed(2) + '. K = music on/off. Console: testMusic(0.9)');
}
function unlock() {
  if (!AC) return;
  if (!ac) build();
  if (ac && ac.state === 'suspended') ac.resume();
}



// ---------- threats: humans + drones + robots (v3) ----------
function listOf(fn) {
  if (!fn) return [];
  try { return fn() || []; } catch (e) { return []; }
}
// calls fn(thing, isHuman) for every living threat
function eachThreat(c, fn) {
  for (const e of c.getEnemies()) if (e && !e.dead) fn(e, true);
  for (const e of listOf(getDronesFn)) if (e && !e.dead) fn(e, false);
  for (const e of listOf(getRobotsFn)) if (e && !e.dead) fn(e, false);
}



// ---------- intensity ----------
function nearestEnemy(c, limit) {
  const p = c.player;
  let best = 1e9;
  eachThreat(c, (e) => {
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d < best) best = d;
  });
  return best < limit ? best : 1e9;
}
function computeTarget(c, playing) {
  if (forced !== null) return forced;
  if (!playing || dead) return 0;
  const p = c.player;
  let t = 0;
  const dTown = Math.hypot(p.x - TOWN.x, p.z - TOWN.z);
  if (dTown < IN_TOWN) t = 0.34; else if (dTown < NEAR_TOWN) t = 0.22;



  let nearest = 1e9, fight = false, search = false;
  eachThreat(c, (e, human) => {
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d < nearest) nearest = d;
    if (d < 70 && e.state === 'fight') fight = true;
    if (human && d < 60 && e.state === 'search') search = true;
  });
  if (nearest < 110) t = Math.max(t, 0.42);
  if (nearest < 70) t = Math.max(t, 0.55);
  if (nearest < 40) t = Math.max(t, 0.7);
  if (search) t = Math.max(t, 0.7);
  if (fight) t = Math.max(t, 0.9);



  if (holdT > 0) t = Math.max(t, holdLevel);
  return t;
}
function hold(level, sec) {
  if (!ac) return;
  if (holdT <= 0) holdLevel = 0;
  holdLevel = Math.max(holdLevel, level);
  holdT = Math.max(holdT, sec);
  tryStinger(inten, level);
  inten = Math.max(inten, level - 0.2);
}



// ---------- small on/off message ----------
function showToast(text) {
  if (!toast) {
    toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;left:50%;bottom:130px;transform:translateX(-50%);padding:6px 16px;' +
      'background:rgba(8,14,22,.8);border:1px solid #2a4a5a;border-radius:6px;color:#bfeaff;' +
      'font:700 13px Consolas,monospace;letter-spacing:2px;pointer-events:none;z-index:50;opacity:0;';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toastT = 1.8;
}



// ---------- hooks used by extras.js ----------
export function init(c) {
  const events = ['pointerdown', 'keydown', 'click'];
  for (const ev of events) window.addEventListener(ev, unlock, true);
  document.addEventListener('pointerlockchange', unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) ac.suspend(); else ac.resume();
  });
  window.testMusic = function (v) {
    forced = (typeof v === 'number') ? Math.max(0, Math.min(1, v)) : null;
    console.log(forced === null ? '[music] intensity is automatic again' : '[music] intensity forced to ' + forced);
  };



  // the Settings screen tells us when the music volume changes
  window.addEventListener('nova-volume', (e) => {
    const m = e && e.detail ? parseFloat(e.detail.music) : NaN;
    if (!isNaN(m)) { userMusic = Math.max(0, Math.min(1, m)); senseT = 0; }
  });



  // door for the Settings screen (same switch as the K key)
  window.campaignMusic = {
    isOn: () => !muted,
    set: (on) => {
      muted = !on;
      try { localStorage.setItem(SAVE_KEY, muted ? 'off' : 'on'); } catch (e) { /* ignore */ }
      senseT = 0;
    }
  };



  // v3: find the drones and the robots (same files the radar and the HUD use)
  const pd = import('./drones.js').then(m => { getDronesFn = m.getDrones || null; }).catch(() => {});
  const pr = import('./robots.js').then(m => { getRobotsFn = m.getRobots || null; }).catch(() => {});
  Promise.all([pd, pr]).then(() => {
    console.log('[music] threats: humans yes, drones ' + (getDronesFn ? 'yes' : 'no') +
                ', robots ' + (getRobotsFn ? 'yes' : 'no'));
  });
}



export function update(dt, c) {
  if (toast) {
    toastT -= dt;
    toast.style.opacity = Math.max(0, Math.min(1, toastT / 0.4));
  }
  if (!ac) return;
  dt = Math.min(dt, 0.1);
  playingNow = !!c.isPlaying();
  holdT -= dt; stingT -= dt; senseT -= dt;
  if (!playingNow && forced === null) { holdT = 0; }



  if (senseT <= 0) {
    senseT = 0.25;
    target = computeTarget(c, playingNow);
    tryStinger(inten, target);
    lastSense = target;
    // loudness and brightness follow the mood
    const vol = muted ? 0 : BASE_VOL * (userMusic / MUSIC_DEFAULT) * (dead ? 0.7 : ((playingNow || forced !== null) ? 1 : MENU_VOL));
    const now = ac.currentTime;
    bus.gain.setTargetAtTime(Math.max(0.0001, vol), now, 0.4);
    filt.frequency.setTargetAtTime(dead ? 500 : 1500 + inten * 7500, now, 0.3);
  }



  const rate = target > inten ? RISE : FALL;
  const diff = target - inten;
  inten += Math.max(-rate * dt, Math.min(rate * dt, diff));
}



export function onKey(code) {
  if (code !== 'KeyK') return false;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return false;   // typing in NOVA
  muted = !muted;
  try { localStorage.setItem(SAVE_KEY, muted ? 'off' : 'on'); } catch (e) { /* ignore */ }
  showToast(muted ? '♪ MUSIC OFF  (K)' : '♪ MUSIC ON  (K)');
  return true;
}



export function onEvent(name, data, c) {
  switch (name) {
    case 'shot':
      if (c && nearestEnemy(c, 150) < 1e9) hold(0.7, HOLD_AFTER_FIGHT); else hold(0.4, 5);
      break;
    case 'hit':  hold(0.8, HOLD_AFTER_FIGHT); break;
    case 'kill': hold(0.85, HOLD_AFTER_FIGHT); break;
    case 'hurt': hold(0.95, HOLD_AFTER_FIGHT + 2); break;
    case 'order':
      if (data && data.type === 'go') hold(0.6, HOLD_AFTER_FIGHT + 2);
      break;
    case 'died':
      dead = true; holdT = 0; inten = 0; target = 0;
      if (ac) tone({ type: 'sine', f: 220, to: 55, t: ac.currentTime + 0.05, dur: 2.5, a: 0.05, r: 0.6, v: 0.25, decay: true });
      break;
    case 'restart':
      reset();
      break;
    default:
      break;
  }
}



export function reset() {
  dead = false; inten = 0; target = 0; holdT = 0; holdLevel = 0;
  step = 0; bar = 0; nextT = 0;
}