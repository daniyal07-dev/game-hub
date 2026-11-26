// ============================================================
//  NOVA STRIKE 3D — Game Hub: js/menu.js   (v5)
//  The front door of the game:
//    splash picture (click to start) -> heroic theme music ->
//    animated blue background -> main menu
//    (Campaign, War, Arena, Settings, How to play, Credits, Exit)
//  It builds everything by itself, so play.html only needs:
//    <script type="module" src="js/menu.js"></script>
//  It does not touch js/main.js or any game file.
//  Coming back from a mode: link to  play.html#menu  (skips the splash).
//
//  v3: your picture is the splash screen (it already contains the
//      title and "CLICK TO START", so no text is drawn over it).
//  v4: the splash is alive: speed streaks, sparks, smoke, light sweep,
//      star flare, glowing button, mouse depth, zoom-in on click.
//  v5: BLUE theme everywhere, blurred picture fills the empty space
//      around the splash (no black bars), phone-friendly fit,
//      "rotate your phone" hint, editable artwork credit.
// ============================================================



// ---------- knobs ----------
const MODES = {
  campaign: 'games/campaign.html',
  war:      'games/war.html',
  arena:    'games/arena.html'
};
const MORE_GAMES_URL = 'more-games.html';
const SKIP_HASH      = '#menu';        // play.html#menu = no splash
const SETTINGS_KEY   = 'nova_settings';
const DEFAULTS       = { master: 0.8, music: 0.7, musicOn: true };

// the line shown in Credits for the title picture (write the truth here)
const ARTWORK_CREDIT = 'AI-generated image, chosen and edited by M. Daniyal';


// splash picture (path is relative to play.html)
const SPLASH_IMAGE    = 'games/campaign/menu.jpeg';
const SPLASH_FIT      = 'contain';     // 'contain' = whole picture always visible, 'cover' = fills the screen but may crop the edges
const SPLASH_BLUR     = true;          // blurred copy of the picture fills the empty space
const SPLASH_ZOOM     = true;          // very slow zoom-in, zoom-out
const SPLASH_FX       = true;          // streaks, sparks, smoke
const SPLASH_FLARE    = true;          // twinkling star on the logo
const SPLASH_SWEEP    = true;          // light sweep over the logo
const SPLASH_PARALLAX = true;          // picture moves a little with the mouse
const SWEEP_SECONDS   = 6;             // time between light sweeps
const FLARE_X         = 0.77;          // star position (fraction of the picture width)
const FLARE_Y         = 0.17;          // (fraction of the picture height)


const MUSIC_BPM      = 80;             // theme speed
const MUSIC_LEVEL    = 0.9;            // overall theme loudness
const MUSIC_FADE_IN  = 3;              // seconds
const LEAVE_FADE     = 0.8;            // seconds of black before a mode opens



// ---------- settings (saved on this device) ----------
function clamp01(v, d) {
  return (typeof v === 'number' && isFinite(v)) ? Math.min(1, Math.max(0, v)) : d;
}
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) {}
  return {
    master:  clamp01(s.master, DEFAULTS.master),
    music:   clamp01(s.music, DEFAULTS.music),
    musicOn: typeof s.musicOn === 'boolean' ? s.musicOn : DEFAULTS.musicOn
  };
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}
const settings = loadSettings();



// ============================================================
//  AUDIO  (everything is generated in code, no files)
// ============================================================
let ac = null, masterBus = null, fadeBus = null, musicBus = null, sfxBus = null;
let reverbIn = null, noiseBuf = null;
let musicRunning = false, wantMusic = false, schedTimer = 0, stopId = 0;
let nextStepTime = 0, step = 0, gestureArmed = false;


const mtof = m => 440 * Math.pow(2, (m - 69) / 12);


function ensureAudio() {
  if (ac) return ac;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ac = new AC(); } catch (e) { ac = null; return null; }


  masterBus = ac.createGain();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 24;
  comp.ratio.value = 4;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  masterBus.connect(comp);
  comp.connect(ac.destination);


  fadeBus = ac.createGain();
  fadeBus.gain.value = 0;
  fadeBus.connect(masterBus);


  musicBus = ac.createGain();
  musicBus.connect(fadeBus);


  sfxBus = ac.createGain();
  sfxBus.gain.value = 0.9;
  sfxBus.connect(masterBus);


  // reverb made from decaying noise
  const conv = ac.createConvolver();
  conv.buffer = makeImpulse(2.4, 2.6);
  reverbIn = ac.createGain();
  const wet = ac.createGain();
  wet.gain.value = 0.38;
  reverbIn.connect(conv);
  conv.connect(wet);
  wet.connect(musicBus);


  // one second of white noise, reused for drums
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;


  ac.addEventListener('statechange', onAudioState);
  applyVolumes();
  return ac;
}


function makeImpulse(sec, decay) {
  const rate = ac.sampleRate, len = Math.floor(rate * sec);
  const buf = ac.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}


function applyVolumes() {
  if (!ac) return;
  const t = ac.currentTime;
  masterBus.gain.setTargetAtTime(settings.master, t, 0.05);
  musicBus.gain.setTargetAtTime((settings.musicOn ? settings.music : 0) * MUSIC_LEVEL, t, 0.08);
}


function onAudioState() {
  if (ac && ac.state === 'running' && wantMusic && !musicRunning && !leaving) startMusic();
}


// ---------- one note ----------
function tone(type, freq, t, dur, vol, o) {
  o = o || {};
  const a = o.attack != null ? o.attack : 0.02;
  const r = o.release != null ? o.release : 0.2;
  const hold = Math.max(dur, a + 0.01);
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  if (o.detune) osc.detune.value = o.detune;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 0.7;
  const cut = o.cutoff || 2000;
  f.frequency.setValueAtTime(cut * (o.sweep ? 0.45 : 1), t);
  if (o.sweep) f.frequency.exponentialRampToValueAtTime(cut, t + a + 0.15);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  g.gain.setValueAtTime(vol, t + hold);
  g.gain.linearRampToValueAtTime(0.0001, t + hold + r);
  osc.connect(f); f.connect(g); g.connect(musicBus);
  if (o.rev) {
    const s = ac.createGain();
    s.gain.value = o.rev;
    g.connect(s); s.connect(reverbIn);
  }
  osc.start(t);
  osc.stop(t + hold + r + 0.05);
}


function noise(t, dur, vol, hp, rev) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(musicBus);
  if (rev) {
    const s = ac.createGain();
    s.gain.value = rev;
    g.connect(s); s.connect(reverbIn);
  }
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}


function boom(t, vol) {
  const o = ac.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.4);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  o.connect(g); g.connect(musicBus);
  const s = ac.createGain();
  s.gain.value = 0.5;
  g.connect(s); s.connect(reverbIn);
  o.start(t);
  o.stop(t + 1.2);
  noise(t, 0.12, vol * 0.35, 800, 0.3);
}


function tom(t, vol, f0) {
  const o = ac.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(f0 || 170, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.25);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  o.connect(g); g.connect(musicBus);
  const s = ac.createGain();
  s.gain.value = 0.35;
  g.connect(s); s.connect(reverbIn);
  o.start(t);
  o.stop(t + 0.55);
}


function snare(t, vol) {
  noise(t, 0.14, vol, 1800, 0.25);
  tone('triangle', 190, t, 0.05, vol * 0.5, { release: 0.08, cutoff: 3000 });
}


// ---------- the theme: D minor, 8 bars, loops ----------
//  Dm | Bb | F | C | Dm | Bb | Gm | A
const CHORDS = [
  { bass: 38, pad: [50, 53, 57] },
  { bass: 34, pad: [53, 58, 62] },
  { bass: 41, pad: [53, 57, 60] },
  { bass: 36, pad: [52, 55, 60] },
  { bass: 38, pad: [50, 53, 57] },
  { bass: 34, pad: [53, 58, 62] },
  { bass: 43, pad: [55, 58, 62] },
  { bass: 45, pad: [57, 61, 64] }
];
// [startBeat, midiNote, lengthInBeats]
const MELODY = [
  [0, 62, 1.5], [1.5, 69, 0.5], [2, 74, 2],
  [4, 72, 1.5], [5.5, 70, 0.5], [6, 74, 2],
  [8, 72, 1.5], [9.5, 69, 0.5], [10, 77, 2],
  [12, 76, 1],  [13, 74, 1],    [14, 72, 2],
  [16, 74, 1.5], [17.5, 76, 0.5], [18, 77, 1], [19, 81, 1],
  [20, 77, 1.5], [21.5, 74, 0.5], [22, 70, 2],
  [24, 70, 1],  [25, 74, 1],    [26, 79, 2],
  [28, 76, 1],  [29, 73, 1],    [30, 69, 2]
];
const MELODY_AT = {};
for (const [beat, midi, dur] of MELODY) MELODY_AT[Math.round(beat * 2)] = [midi, dur];


const STEPS = 64;                              // 8 bars x 8 eighth-notes
const stepDur = () => 60 / MUSIC_BPM / 2;


function scheduleStep(i, t) {
  const bar = Math.floor(i / 8), inBar = i % 8;
  const second = bar >= 4;                     // bars 5-8 are bigger
  const c = CHORDS[bar];
  const barLen = 8 * stepDur();


  if (i === 0) noise(t, 1.8, 0.07, 5000, 0.5); // crash at the loop start


  if (inBar === 0) {
    for (const m of c.pad) {
      tone('sawtooth', mtof(m), t, barLen + 0.3, 0.026, { attack: 0.9, release: 1.0, cutoff: 1000, detune: -8, rev: 0.5 });
      tone('sawtooth', mtof(m), t, barLen + 0.3, 0.026, { attack: 0.9, release: 1.0, cutoff: 1000, detune: 8, rev: 0.5 });
    }
    if (!second) tone('sawtooth', mtof(c.bass), t, barLen * 0.95, 0.10, { attack: 0.03, release: 0.3, cutoff: 420 });
    boom(t, second ? 0.5 : 0.4);
  }


  if (second) {
    tone('sawtooth', mtof(c.bass), t, stepDur() * 0.8, 0.08, { attack: 0.01, release: 0.08, cutoff: 450 });
    if (inBar === 2 || inBar === 6) snare(t, 0.15);
    if (inBar === 4) tom(t, 0.3, 170);
  } else {
    if (inBar === 4) tom(t, 0.22, 170);
  }


  const n = MELODY_AT[i];
  if (n) {
    const d = n[1] * 60 / MUSIC_BPM * 0.95;
    const f = mtof(n[0]);
    const o = { attack: 0.07, release: 0.4, cutoff: 2400, sweep: true, rev: 0.45 };
    tone('sawtooth', f, t, d, 0.055, Object.assign({ detune: -6 }, o));
    tone('sawtooth', f, t, d, 0.055, Object.assign({ detune: 6 }, o));
    if (second) tone('sawtooth', mtof(n[0] - 12), t, d, 0.045, { attack: 0.07, release: 0.4, cutoff: 1400, rev: 0.4 });
  }
}


function schedulerTick() {
  if (!ac || !musicRunning) return;
  if (nextStepTime < ac.currentTime - 0.1) nextStepTime = ac.currentTime + 0.05;  // after a hidden tab
  while (nextStepTime < ac.currentTime + 0.25) {
    scheduleStep(step, nextStepTime);
    nextStepTime += stepDur();
    step = (step + 1) % STEPS;
  }
}


function startMusic() {
  if (!ensureAudio()) return;
  wantMusic = true;
  stopId++;                                    // cancels a pending stop
  ac.resume().catch(() => {});
  if (!musicRunning) {
    musicRunning = true;
    step = 0;
    nextStepTime = ac.currentTime + 0.15;
    schedTimer = setInterval(schedulerTick, 25);
  }
  const t = ac.currentTime;
  fadeBus.gain.cancelScheduledValues(t);
  fadeBus.gain.setValueAtTime(fadeBus.gain.value, t);
  fadeBus.gain.linearRampToValueAtTime(1, t + MUSIC_FADE_IN);
}


function stopMusic(sec) {
  wantMusic = false;
  if (!ac || !musicRunning) return;
  const t = ac.currentTime;
  fadeBus.gain.cancelScheduledValues(t);
  fadeBus.gain.setValueAtTime(fadeBus.gain.value, t);
  fadeBus.gain.linearRampToValueAtTime(0, t + sec);
  const id = ++stopId;
  setTimeout(() => {
    if (id !== stopId) return;
    clearInterval(schedTimer);
    musicRunning = false;
  }, sec * 1000 + 150);
}


function hardStopMusic() {
  wantMusic = false;
  clearInterval(schedTimer);
  musicRunning = false;
  if (ac) fadeBus.gain.value = 0;
}


// Try to start the music without a click (coming back from a mode).
// If the browser refuses, the first click or key press starts it.
function tryAutoStart() {
  wantMusic = true;
  if (!ensureAudio()) return;
  if (ac.state === 'running') { startMusic(); return; }
  armGesture();
}
function armGesture() {
  if (gestureArmed) return;
  gestureArmed = true;
  const evs = ['pointerdown', 'keydown', 'touchstart'];
  const go = () => {
    evs.forEach(ev => window.removeEventListener(ev, go, true));
    gestureArmed = false;
    if (wantMusic && !leaving) startMusic();
  };
  evs.forEach(ev => window.addEventListener(ev, go, true));
}


document.addEventListener('visibilitychange', () => {
  if (!ac) return;
  if (document.hidden) ac.suspend().catch(() => {});
  else if (wantMusic) ac.resume().catch(() => {});
});


// ---------- small interface sounds ----------
function blip(freq, dur, vol, type, slideTo) {
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.type = type || 'triangle';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(sfxBus);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const sfxHover  = () => blip(720, 0.05, 0.035, 'triangle');
const sfxClick  = () => blip(520, 0.09, 0.08, 'square', 900);
const sfxLaunch = () => { blip(110, 0.75, 0.12, 'sawtooth', 720); blip(55, 0.9, 0.16, 'triangle', 40); };
const sfxStart  = () => { blip(160, 0.7, 0.10, 'sawtooth', 1200); blip(80, 0.9, 0.14, 'triangle', 30); };



// ============================================================
//  ANIMATED BACKGROUND OF THE MENU
//  (deep blue night sky, searchlights, mountains, embers)
// ============================================================
let bg = null;


function startBackground(cv) {
  if (bg) return;
  const g = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, stars = [], embers = [], skyG = null;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const COLS = ['56,182,255', '90,160,255', '160,220,255'];


  const newEmber = init => ({
    x: rnd(0, W), y: init ? rnd(0, H) : H + 10,
    r: rnd(0.8, 2.4), vy: rnd(14, 46), sw: rnd(0.5, 2), ph: rnd(0, 6.28),
    col: COLS[Math.floor(Math.random() * COLS.length)]
  });


  const MOUNT = [
    { color: '#050e1f', base: 0.80, amp: 0.12, speed: 5,  a: 1.3, b: 4.1, c: 2.2, k: [2, 5, 13] },
    { color: '#02060d', base: 0.90, amp: 0.08, speed: 12, a: 0.4, b: 2.7, c: 5.1, k: [3, 7, 19] }
  ];
  function mountainY(L, x, off) {
    const u = (x + off) / (W * 2) * Math.PI * 2;
    const h = 0.5 * Math.sin(u * L.k[0] + L.a) + 0.3 * Math.sin(u * L.k[1] + L.b) + 0.2 * Math.sin(u * L.k[2] + L.c);
    return H * (L.base - L.amp * h);
  }


  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.floor(W * dpr);
    cv.height = Math.floor(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    skyG = g.createLinearGradient(0, 0, 0, H);
    skyG.addColorStop(0, '#01030a');
    skyG.addColorStop(0.55, '#030b1e');
    skyG.addColorStop(0.85, '#06193d');
    skyG.addColorStop(1, '#0a2a66');
    stars = [];
    const ns = Math.round(W * H / 9000);
    for (let i = 0; i < ns; i++) stars.push({ x: rnd(0, W), y: rnd(0, H * 0.7), r: rnd(0.6, 1.8), p: rnd(0, 6.28), s: rnd(0.5, 2) });
    embers = [];
    const ne = Math.round(Math.min(90, W / 14));
    for (let i = 0; i < ne; i++) embers.push(newEmber(true));
  }


  function beam(x, y, ang, col) {
    const len = H * 1.1, w = 0.07;
    const gr = g.createLinearGradient(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    gr.addColorStop(0, 'rgba(' + col + ',.22)');
    gr.addColorStop(1, 'rgba(' + col + ',0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(ang - w) * len, y + Math.sin(ang - w) * len);
    g.lineTo(x + Math.cos(ang + w) * len, y + Math.sin(ang + w) * len);
    g.closePath();
    g.fill();
  }


  let last = 0, raf = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const t = ts / 1000;
    const dt = Math.min(0.05, Math.max(0, t - last));
    last = t;


    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = skyG;
    g.fillRect(0, 0, W, H);


    // glow of a far planet
    const px = W * 0.72, py = H * 0.34, pr = Math.min(W, H) * 0.42;
    const pg = g.createRadialGradient(px, py, 0, px, py, pr);
    pg.addColorStop(0, 'rgba(56,182,255,.20)');
    pg.addColorStop(0.5, 'rgba(20,70,170,.12)');
    pg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = pg;
    g.fillRect(0, 0, W, H);


    // stars
    g.fillStyle = '#fff';
    for (const s of stars) {
      g.globalAlpha = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
      g.fillRect(s.x, s.y, s.r, s.r);
    }
    g.globalAlpha = 1;


    // searchlights
    g.globalCompositeOperation = 'lighter';
    beam(W * 0.15, H * 0.95, -Math.PI / 2 + Math.sin(t * 0.35) * 0.55, '56,182,255');
    beam(W * 0.85, H * 0.95, -Math.PI / 2 + Math.sin(t * 0.28 + 2) * 0.55, '90,140,255');


    // mountains
    g.globalCompositeOperation = 'source-over';
    for (const L of MOUNT) {
      const off = t * L.speed;
      g.fillStyle = L.color;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W + 8; x += 8) g.lineTo(x, mountainY(L, x, off));
      g.lineTo(W + 8, H);
      g.closePath();
      g.fill();
    }


    // rising embers
    g.globalCompositeOperation = 'lighter';
    for (const e of embers) {
      e.y -= e.vy * dt;
      e.x += Math.sin(t * e.sw + e.ph) * 14 * dt;
      if (e.y < -10) Object.assign(e, newEmber(false));
      let a = (0.35 + 0.35 * Math.sin(t * 3 + e.ph));
      a *= Math.min(1, (H - e.y) / (H * 0.15));
      a *= Math.min(1, Math.max(0, e.y) / (H * 0.3));
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = 'rgb(' + e.col + ')';
      g.beginPath();
      g.arc(e.x, e.y, e.r, 0, 6.283);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }


  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(frame);
  bg = { stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); bg = null; } };
}



// ============================================================
//  THE SPLASH PICTURE AND ITS MOVEMENT
// ============================================================
let imgAR = 16 / 9;            // picture shape (updated when it loads)
let imgLoaded = false;
let stageBox = null;           // where the picture sits on the screen
let sfx = null;


// size and center the picture stage like background-size contain / cover
function layoutStage() {
  if (!el.sstage) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  let w = SPLASH_FIT === 'cover' ? Math.max(vw, vh * imgAR) : Math.min(vw, vh * imgAR);
  const h = w / imgAR;
  el.sstage.style.width = w + 'px';
  el.sstage.style.height = h + 'px';
  stageBox = { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}


// load the splash picture; if it is missing, show the plain text splash instead
function loadSplash() {
  if (!SPLASH_IMAGE) { el.sfall.classList.add('show'); return; }
  const im = new Image();
  im.onload = () => {
    imgAR = im.naturalWidth / im.naturalHeight;
    imgLoaded = true;
    layoutStage();
    const url = 'url("' + SPLASH_IMAGE + '")';
    el.simg.style.backgroundImage = url;
    el.simg.classList.add('on');
    if (SPLASH_BLUR) {
      el.sblur.style.backgroundImage = url;
      el.sblur.classList.add('on');
    }
    el.sstage.classList.add('on');
    if (SPLASH_SWEEP) el.sstage.classList.add('sweep');
    if (SPLASH_ZOOM) el.sinner.classList.add('zoom');
    console.log('[menu] splash picture loaded: ' + SPLASH_IMAGE + ' (' + im.naturalWidth + 'x' + im.naturalHeight + ')');
  };
  im.onerror = () => {
    el.sfall.classList.add('show');
    console.info('[menu] picture not found: ' + SPLASH_IMAGE + ' , showing the plain splash. Check the folder and the exact name.');
  };
  im.src = SPLASH_IMAGE;
}


// blue speed streaks, rising sparks, drifting smoke and a twinkling star
function startSplashFx() {
  if (!SPLASH_FX || sfx) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = el.sfx;
  const g = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, streaks = [], sparks = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const DX = Math.cos(-0.38), DY = Math.sin(-0.38);     // streaks fly up and to the right


  const newStreak = init => {
    const len = rnd(70, 220);
    return {
      x: init ? rnd(-len, W) : -len,
      y: init ? rnd(0, H) : rnd(H * 0.15, H * 1.15),
      len, spd: rnd(450, 1000), a: rnd(0.25, 0.7), w: rnd(1, 2.2)
    };
  };
  const newSpark = init => ({
    x: rnd(0, W), y: init ? rnd(0, H) : H + 10,
    r: rnd(0.8, 2.2), vy: rnd(18, 60), sw: rnd(0.5, 2), ph: rnd(0, 6.28)
  });


  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.floor(W * dpr);
    cv.height = Math.floor(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    streaks = [];
    const ns = Math.round(Math.min(26, Math.max(10, W / 70)));
    for (let i = 0; i < ns; i++) streaks.push(newStreak(true));
    sparks = [];
    const nk = Math.round(Math.min(70, W / 22));
    for (let i = 0; i < nk; i++) sparks.push(newSpark(true));
  }


  let last = 0, raf = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const t = ts / 1000;
    const dt = Math.min(0.05, Math.max(0, t - last));
    last = t;


    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 1;


    // drifting smoke along the bottom
    const sr = Math.max(W, H) * 0.22;
    for (let i = 0; i < 6; i++) {
      const cx = W * ((i + 0.5) / 6) + Math.sin(t * 0.12 + i * 1.7) * W * 0.04;
      const cy = H * (0.95 - 0.03 * Math.sin(t * 0.2 + i));
      const a = 0.10 + 0.04 * Math.sin(t * 0.5 + i * 2);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, sr);
      gr.addColorStop(0, 'rgba(30,110,255,' + a.toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(30,110,255,0)');
      g.fillStyle = gr;
      g.fillRect(cx - sr, cy - sr, sr * 2, sr * 2);
    }


    // speed streaks
    g.lineCap = 'round';
    for (const s of streaks) {
      s.x += DX * s.spd * dt;
      s.y += DY * s.spd * dt;
      if (s.x > W + s.len || s.y < -s.len) Object.assign(s, newStreak(false));
      const tx = s.x - DX * s.len, ty = s.y - DY * s.len;
      const gr = g.createLinearGradient(tx, ty, s.x, s.y);
      gr.addColorStop(0, 'rgba(120,200,255,0)');
      gr.addColorStop(1, 'rgba(120,200,255,' + s.a.toFixed(2) + ')');
      g.strokeStyle = gr;
      g.lineWidth = s.w;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(s.x, s.y);
      g.stroke();
    }


    // rising sparks
    for (const e of sparks) {
      e.y -= e.vy * dt;
      e.x += Math.sin(t * e.sw + e.ph) * 14 * dt;
      if (e.y < -10) Object.assign(e, newSpark(false));
      let a = 0.35 + 0.35 * Math.sin(t * 3 + e.ph);
      a *= Math.min(1, (H - e.y) / (H * 0.15));
      a *= Math.min(1, Math.max(0, e.y) / (H * 0.3));
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = 'rgb(140,210,255)';
      g.beginPath();
      g.arc(e.x, e.y, e.r, 0, 6.283);
      g.fill();
    }
    g.globalAlpha = 1;


    // twinkling star on the logo
    if (SPLASH_FLARE && imgLoaded && stageBox) {
      const sx = stageBox.x + stageBox.w * FLARE_X;
      const sy = stageBox.y + stageBox.h * FLARE_Y;
      const k = Math.pow(0.5 + 0.5 * Math.sin(t * 2.1), 2);
      const R = Math.min(stageBox.w, stageBox.h) * 0.09 * (0.5 + k);
      const fg = g.createRadialGradient(sx, sy, 0, sx, sy, R);
      fg.addColorStop(0, 'rgba(215,238,255,' + (0.12 + 0.5 * k).toFixed(2) + ')');
      fg.addColorStop(1, 'rgba(215,238,255,0)');
      g.fillStyle = fg;
      g.fillRect(sx - R, sy - R, R * 2, R * 2);
      g.strokeStyle = 'rgba(205,232,255,' + (0.15 + 0.5 * k).toFixed(2) + ')';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(sx - R * 2.2, sy); g.lineTo(sx + R * 2.2, sy);
      g.moveTo(sx, sy - R * 1.6); g.lineTo(sx, sy + R * 1.6);
      g.stroke();
    }


    g.globalCompositeOperation = 'source-over';
  }


  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(frame);
  sfx = { stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); g.clearRect(0, 0, W, H); sfx = null; } };
}



// ============================================================
//  THE MENU
// ============================================================
let root = null, el = {};
let started = false, menuVisible = false, leaving = false;
let panelOpen = false, exitOpen = false, lastHover = null;


const CSS = `
#nm-root{--ac:#38b6ff;--acr:56,182,255;position:fixed;inset:0;z-index:2147483000;background:#000;color:#eaf3ff;font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;overflow:hidden;-webkit-user-select:none;user-select:none}
#nm-root *{box-sizing:border-box}
#nm-bg{position:absolute;inset:0;width:100%;height:100%;display:block}
#nm-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 45%,rgba(0,0,0,.65) 100%)}


#nm-splash{position:absolute;inset:0;z-index:5;background:#000;cursor:pointer;overflow:hidden;transition:opacity .9s ease}
#nm-splash.out{opacity:0;pointer-events:none}
#nm-sblur{position:absolute;inset:-6%;background-size:cover;background-position:center center;background-repeat:no-repeat;filter:blur(26px) brightness(.55) saturate(1.2);opacity:0;transition:opacity 1s ease}
#nm-sblur.on{opacity:1}
#nm-sstage{position:absolute;left:50%;top:50%;transform:translate(calc(-50% + var(--mx,0px)),calc(-50% + var(--my,0px)));transition:transform .25s ease-out;box-shadow:0 0 70px rgba(56,182,255,.35)}
#nm-splash.out #nm-sstage{transform:translate(-50%,-50%) scale(1.2);transition:transform .9s ease-in}
#nm-sinner{position:absolute;inset:0;isolation:isolate}
#nm-sinner.zoom{animation:nmBreath 14s ease-in-out infinite alternate}
@keyframes nmBreath{from{transform:scale(1)}to{transform:scale(1.035)}}
#nm-simg{position:absolute;inset:0;background-size:100% 100%;background-position:center center;background-repeat:no-repeat;opacity:0;transition:opacity 1s ease,filter .3s ease}
#nm-simg.on{opacity:1}
#nm-splash:hover #nm-simg{filter:brightness(1.1)}
#nm-sweep,#nm-spulse{display:none;position:absolute;pointer-events:none}
#nm-sstage.on.sweep #nm-sweep{display:block;inset:0;mix-blend-mode:overlay;background:linear-gradient(105deg,transparent 42%,rgba(255,255,255,.9) 50%,transparent 58%);background-size:250% 100%;background-position:150% 0;animation:nmSweep ${SWEEP_SECONDS}s ease-in-out infinite}
@keyframes nmSweep{0%{background-position:150% 0}45%,100%{background-position:-50% 0}}
#nm-sstage.on #nm-spulse{display:block;left:31%;top:66%;width:38%;height:11%;mix-blend-mode:screen;background:radial-gradient(ellipse at center,rgba(70,180,255,.5),rgba(70,180,255,0) 70%);animation:nmGlow 1.8s ease-in-out infinite}
@keyframes nmGlow{0%,100%{opacity:.12}50%{opacity:1}}
#nm-sfx{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
#nm-rotate{display:none;position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:3;max-width:90vw;padding:8px 14px;border-radius:999px;background:rgba(0,10,28,.72);border:1px solid rgba(var(--acr),.45);color:#cfe8ff;font-size:13px;text-align:center;pointer-events:none;animation:nmPulse 2s ease-in-out infinite}
@media (orientation:portrait) and (pointer:coarse){#nm-rotate{display:block}}
@media (prefers-reduced-motion:reduce){#nm-sinner.zoom,#nm-sweep,#nm-spulse{animation:none}}
#nm-sfall{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px}
#nm-sfall.show{display:flex}
.nm-s-title{font-size:clamp(34px,7vw,84px);font-weight:900;letter-spacing:.14em;color:#fff;text-shadow:0 0 24px var(--ac),0 0 60px rgba(var(--acr),.5)}
.nm-s-click{margin-top:34px;letter-spacing:.4em;font-size:clamp(12px,1.6vw,16px);color:var(--ac);animation:nmPulse 1.6s ease-in-out infinite}
@keyframes nmPulse{0%,100%{opacity:.35}50%{opacity:1}}


#nm-menu{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;overflow-y:auto;opacity:0;pointer-events:none;transition:opacity 1s ease .2s}
#nm-menu.show{opacity:1;pointer-events:auto}
.nm-inner{margin:auto;display:flex;flex-direction:column;align-items:center;gap:clamp(14px,3vh,28px);padding:20px 16px 24px;width:100%}
.nm-head{text-align:center}
.nm-kicker{letter-spacing:.5em;font-size:clamp(11px,1.4vw,15px);color:#9fb6cf;text-transform:uppercase}
.nm-title{margin:6px 0 0;font-size:clamp(32px,min(8vw,12vh),92px);line-height:1;font-weight:900;letter-spacing:.08em;background:linear-gradient(180deg,#fff 30%,#9fdcff 70%,#1e90ff);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 22px rgba(var(--acr),.45));animation:nmTitle 3.5s ease-in-out infinite}
@keyframes nmTitle{0%,100%{filter:drop-shadow(0 0 16px rgba(var(--acr),.3))}50%{filter:drop-shadow(0 0 34px rgba(var(--acr),.8))}}
.nm-sub{margin-top:10px;color:#b9cfe6;font-size:clamp(12px,1.5vw,16px);letter-spacing:.2em}


#nm-menu.show .nm-head{animation:nmIn .8s ease-out .3s backwards}
#nm-menu.show .nm-list>*{animation:nmIn .6s ease-out backwards}
#nm-menu.show .nm-list>*:nth-child(1){animation-delay:.5s}
#nm-menu.show .nm-list>*:nth-child(2){animation-delay:.62s}
#nm-menu.show .nm-list>*:nth-child(3){animation-delay:.74s}
#nm-menu.show .nm-list>*:nth-child(4){animation-delay:.86s}
#nm-menu.show .nm-list>*:nth-child(5){animation-delay:.98s}
#nm-menu.show .nm-foot{animation:nmIn .8s ease-out 1.2s backwards}
@keyframes nmIn{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.nm-title,#nm-menu.show .nm-head,#nm-menu.show .nm-list>*,#nm-menu.show .nm-foot{animation:none}}


.nm-list{display:flex;flex-direction:column;gap:10px;width:min(480px,92vw)}
.nm-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.nm-btn{appearance:none;-webkit-appearance:none;border:1px solid rgba(var(--acr),.28);background:rgba(6,14,28,.74);color:#eaf3ff;font:inherit;text-align:left;padding:13px 20px;border-radius:12px;cursor:pointer;display:flex;align-items:baseline;justify-content:space-between;gap:12px;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:transform .15s,border-color .15s,box-shadow .15s,background .15s}
.nm-btn:hover,.nm-btn:focus-visible{transform:translateX(6px);border-color:var(--ac);box-shadow:0 0 22px rgba(var(--acr),.35);background:rgba(14,44,88,.82);outline:none}
.nm-btn b{font-size:clamp(15px,1.7vw,19px);letter-spacing:.2em;font-weight:800}
.nm-btn small{color:#8fa9c6;font-size:12px;letter-spacing:.05em;text-align:right}
.nm-btn.war{border-left:4px solid #7a8cff}
.nm-btn.arena{border-left:4px solid #19e0ff}
.nm-btn.main{background:linear-gradient(90deg,rgba(20,90,210,.95),rgba(56,182,255,.92));color:#021226;border-color:transparent;padding:17px 22px}
.nm-btn.main small{color:#0a2d57}
.nm-btn.main:hover,.nm-btn.main:focus-visible{box-shadow:0 0 32px rgba(var(--acr),.65);background:linear-gradient(90deg,#1a6fe0,#4cc4ff)}
.nm-btn.sm{justify-content:center;padding:11px 14px}
.nm-btn.sm:hover,.nm-btn.sm:focus-visible{transform:translateY(-2px)}
.nm-btn[disabled]{opacity:.4;cursor:not-allowed;transform:none!important;box-shadow:none!important}


.nm-foot{display:flex;flex-wrap:wrap;gap:6px 18px;justify-content:center;text-align:center;font-size:12px;color:#9fb6cf;letter-spacing:.05em;text-shadow:0 1px 6px rgba(0,0,0,.9)}
.nm-foot a{color:var(--ac);text-decoration:none;font-weight:700}
.nm-foot a:hover{text-decoration:underline}
.nm-touch{display:none;max-width:92vw;text-align:center;font-size:12px;color:#a8c0dc;line-height:1.5}
@media (pointer:coarse){.nm-touch{display:block}}


#nm-panel{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(1,4,12,.74);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);opacity:0;pointer-events:none;transition:opacity .25s}
#nm-panel.show{opacity:1;pointer-events:auto}
.nm-card{width:min(560px,94vw);max-height:90vh;overflow:auto;background:linear-gradient(180deg,#0c1a2e,#060d18);border:1px solid rgba(var(--acr),.35);border-radius:16px;padding:24px 26px;box-shadow:0 0 50px rgba(var(--acr),.2);-webkit-user-select:text;user-select:text}
.nm-card h2{margin:0 0 14px;letter-spacing:.2em;font-size:20px;color:var(--ac)}
.nm-card p{margin:0 0 10px;line-height:1.55;color:#d3e3f3;font-size:14px}
.nm-card ul{margin:0 0 12px;padding-left:18px;color:#d3e3f3;font-size:14px;line-height:1.7}
.nm-card b{color:#fff}
.nm-note{font-size:12px!important;color:#8fa9c6!important}
.nm-set{display:grid;grid-template-columns:130px 1fr 48px;align-items:center;gap:12px;margin:14px 0}
.nm-set label{font-size:14px;color:#d3e3f3}
.nm-set input[type=range]{width:100%;accent-color:var(--ac)}
.nm-set span{font-size:13px;color:var(--ac);text-align:right}
.nm-sw{display:flex;align-items:center;gap:8px;grid-column:2 / 4;cursor:pointer}
.nm-sw input{width:18px;height:18px;accent-color:var(--ac)}
.nm-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}
.nm-actions .nm-btn{min-width:120px}
.nm-bye{text-align:center}
.nm-bye h2{font-size:clamp(18px,3vw,26px)}
.nm-bye .nm-actions{justify-content:center}


#nm-fade{position:absolute;inset:0;z-index:10;background:#000;opacity:0;pointer-events:none;transition:opacity .8s ease}
#nm-fade.on{opacity:1;pointer-events:auto}
`;


function build() {
  const st = document.createElement('style');
  st.id = 'nm-style';
  st.textContent = CSS;
  document.head.appendChild(st);


  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;


  root = document.createElement('div');
  root.id = 'nm-root';
  root.innerHTML = `
    <canvas id="nm-bg"></canvas>
    <div id="nm-vig"></div>


    <div id="nm-menu">
      <div class="nm-inner">
        <div class="nm-head">
          <div class="nm-kicker">Tactical AI Combat</div>
          <h1 class="nm-title">NOVA STRIKE 3D</h1>
          <div class="nm-sub">ONE GAME · THREE BATTLEFIELDS</div>
        </div>


        <div class="nm-list">
          <button class="nm-btn main" data-act="campaign"><b>CAMPAIGN</b><small>Strike Command · open-world RTS</small></button>
          <button class="nm-btn war" data-act="war"><b>WAR MODE</b><small>Squad combat · drones &amp; mechs</small></button>
          <button class="nm-btn arena" data-act="arena"><b>ARENA MODE</b><small>Survive the AI waves</small></button>
          <button class="nm-btn" disabled><b>MULTIPLAYER</b><small>coming soon</small></button>
          <div class="nm-grid">
            <button class="nm-btn sm" data-act="settings"><b>SETTINGS</b></button>
            <button class="nm-btn sm" data-act="how"><b>HOW TO PLAY</b></button>
            <button class="nm-btn sm" data-act="credits"><b>CREDITS</b></button>
            <button class="nm-btn sm" data-act="exit"><b>EXIT</b></button>
          </div>
        </div>


        <div class="nm-touch">📱 Arena and War work with touch controls (play in landscape). Campaign is best on a PC with keyboard and mouse.</div>


        <div class="nm-foot">
          <span>AI/IT Expo 2026 · Forte Colleges of Excellence, Sargodha</span>
          <a href="${MORE_GAMES_URL}">More Games</a>
          <span>Designed and tuned by M. Daniyal · AI-assisted development</span>
        </div>
      </div>
    </div>


    <div id="nm-splash" role="button" aria-label="${touch ? 'Tap to start' : 'Click to start'}">
      <div id="nm-sblur"></div>
      <div id="nm-sstage">
        <div id="nm-sinner">
          <div id="nm-simg"></div>
          <div id="nm-sweep"></div>
          <div id="nm-spulse"></div>
        </div>
      </div>
      <canvas id="nm-sfx"></canvas>
      <div id="nm-rotate">📱 Rotate your phone sideways for the best view</div>
      <div id="nm-sfall">
        <div class="nm-s-title">NOVA STRIKE 3D</div>
        <div class="nm-s-click">${touch ? 'TAP TO START' : 'CLICK TO START'}</div>
      </div>
    </div>


    <div id="nm-panel"><div class="nm-card" id="nm-card"></div></div>
    <div id="nm-fade"></div>
  `;
  document.body.appendChild(root);


  el = {
    bg: root.querySelector('#nm-bg'),
    menu: root.querySelector('#nm-menu'),
    splash: root.querySelector('#nm-splash'),
    sblur: root.querySelector('#nm-sblur'),
    sstage: root.querySelector('#nm-sstage'),
    sinner: root.querySelector('#nm-sinner'),
    simg: root.querySelector('#nm-simg'),
    sfx: root.querySelector('#nm-sfx'),
    sfall: root.querySelector('#nm-sfall'),
    panel: root.querySelector('#nm-panel'),
    card: root.querySelector('#nm-card'),
    fade: root.querySelector('#nm-fade')
  };


  // keep keyboard focus off the page underneath
  Array.from(document.body.children).forEach(c => {
    if (c !== root && c.tagName !== 'SCRIPT') { try { c.inert = true; } catch (e) {} }
  });
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
}


// ---------- panels ----------
function openPanel(html, wire) {
  el.card.innerHTML = html;
  el.panel.classList.add('show');
  panelOpen = true;
  if (wire) wire(el.card);
  const b = el.card.querySelector('button');
  if (b) b.focus({ preventScroll: true });
}
function closePanel() {
  el.panel.classList.remove('show');
  panelOpen = false;
  exitOpen = false;
}


function settingsHTML() {
  const pc = v => Math.round(v * 100);
  return `
    <h2>SETTINGS</h2>
    <div class="nm-set"><label for="nm-master">Master volume</label>
      <input id="nm-master" type="range" min="0" max="100" value="${pc(settings.master)}"><span id="nm-master-v">${pc(settings.master)}%</span></div>
    <div class="nm-set"><label for="nm-music">Music volume</label>
      <input id="nm-music" type="range" min="0" max="100" value="${pc(settings.music)}"><span id="nm-music-v">${pc(settings.music)}%</span></div>
    <div class="nm-set"><label for="nm-musicon">Menu music</label>
      <label class="nm-sw"><input id="nm-musicon" type="checkbox" ${settings.musicOn ? 'checked' : ''}><span id="nm-musicon-v" style="text-align:left">${settings.musicOn ? 'On' : 'Off'}</span></label></div>
    <p class="nm-note">Saved on this device.<br>Key bindings: open Campaign and use its <b>Controls</b> button.</p>
    <div class="nm-actions">
      <button class="nm-btn sm" data-act="reset"><b>RESET</b></button>
      <button class="nm-btn sm main" data-act="close"><b>DONE</b></button>
    </div>`;
}


function openSettings() {
  sfxClick();
  openPanel(settingsHTML(), card => {
    const m = card.querySelector('#nm-master'), mv = card.querySelector('#nm-master-v');
    const u = card.querySelector('#nm-music'), uv = card.querySelector('#nm-music-v');
    const k = card.querySelector('#nm-musicon'), kv = card.querySelector('#nm-musicon-v');
    m.addEventListener('input', () => {
      settings.master = m.value / 100; mv.textContent = m.value + '%';
      applyVolumes(); saveSettings();
    });
    u.addEventListener('input', () => {
      settings.music = u.value / 100; uv.textContent = u.value + '%';
      applyVolumes(); saveSettings();
    });
    m.addEventListener('change', sfxClick);
    u.addEventListener('change', sfxClick);
    k.addEventListener('change', () => {
      settings.musicOn = k.checked; kv.textContent = k.checked ? 'On' : 'Off';
      applyVolumes(); saveSettings(); sfxClick();
    });
  });
}


function resetSettings() {
  Object.assign(settings, DEFAULTS);
  applyVolumes(); saveSettings();
  openSettings();
}


function openHow() {
  sfxClick();
  openPanel(`
    <h2>HOW TO PLAY</h2>
    <p><b>Campaign · Strike Command</b></p>
    <ul>
      <li>Click <b>ENTER ISLAND</b>, then move the mouse to look around</li>
      <li><b>W A S D</b> move · <b>Shift</b> sprint · <b>Space</b> jump · click to shoot</li>
      <li><b>E</b> opens the Barracks menu · <b>1 / 2 / 3</b> train soldiers, then give orders: Follow, Hold, Attack</li>
      <li><b>M</b> big map · <b>N</b> AI assistant · <b>K</b> music · <b>Esc</b> pause</li>
      <li>Mission: train a soldier, clear Port Town, capture the square, then defend it from the sea</li>
    </ul>
    <p class="nm-note">War and Arena: follow the instructions on their own screens.</p>
    <div class="nm-actions"><button class="nm-btn sm main" data-act="close"><b>CLOSE</b></button></div>`);
}


function openCredits() {
  sfxClick();
  openPanel(`
    <h2>CREDITS</h2>
    <p><b>NOVA STRIKE 3D</b><br>AI/IT Expo 2026 · Forte Colleges of Excellence, Sargodha</p>
    <ul>
      <li>Design, testing and tuning: <b>M. Daniyal</b></li>
      <li>Title screen artwork: <b>${ARTWORK_CREDIT}</b></li>
      <li>AI-assisted development: <b>Claude</b> (free plan)</li>
      <li>3D models: <b>Kenney</b> and <b>Quaternius</b> (CC0)</li>
      <li>Textures and sky: <b>Poly Haven</b> (CC0)</li>
      <li>Engine: <b>Three.js</b></li>
      <li>Music and most sound effects: generated in code (Web Audio)</li>
      <li>Runs on GitHub Pages: no servers, no accounts, 100% free</li>
    </ul>
    <div class="nm-actions"><button class="nm-btn sm main" data-act="close"><b>CLOSE</b></button></div>`);
}


function openExit() {
  sfxClick();
  stopMusic(2.5);
  exitOpen = true;
  openPanel(`
    <div class="nm-bye">
      <h2>THANK YOU FOR PLAYING</h2>
      <p><b>NOVA STRIKE 3D</b><br>AI/IT Expo 2026 · Forte Colleges of Excellence, Sargodha</p>
      <p class="nm-note">You can close this tab now.</p>
      <div class="nm-actions"><button class="nm-btn sm main" data-act="again"><b>PLAY AGAIN</b></button></div>
    </div>`);
  exitOpen = true;
}


function playAgain() {
  sfxClick();
  closePanel();
  startMusic();
}


// ---------- going into a mode ----------
function launch(url) {
  if (leaving) return;
  leaving = true;
  sfxLaunch();
  stopMusic(LEAVE_FADE);
  el.fade.classList.add('on');
  setTimeout(() => { location.href = url; }, LEAVE_FADE * 1000 + 150);
}


function act(name) {
  if (leaving) return;
  switch (name) {
    case 'campaign': case 'war': case 'arena': sfxClick(); launch(MODES[name]); break;
    case 'settings': openSettings(); break;
    case 'how':      openHow(); break;
    case 'credits':  openCredits(); break;
    case 'exit':     openExit(); break;
    case 'close':    sfxClick(); closePanel(); break;
    case 'reset':    resetSettings(); break;
    case 'again':    playAgain(); break;
  }
}


// ---------- start ----------
function showMenu() {
  menuVisible = true;
  el.menu.classList.add('show');
  startBackground(el.bg);
}


function begin() {
  if (started) return;
  started = true;
  startMusic();                                  // inside the click, so the browser allows sound
  if (ac) ac.resume().then(sfxStart).catch(() => {});
  el.splash.classList.add('out');
  showMenu();
  setTimeout(() => {
    el.splash.style.display = 'none';
    if (sfx) sfx.stop();
  }, 1000);
}


function wire() {
  el.splash.addEventListener('click', begin);


  window.addEventListener('resize', layoutStage);
  window.addEventListener('orientationchange', () => setTimeout(layoutStage, 250));


  // the picture moves a little against the mouse (depth effect)
  if (SPLASH_PARALLAX) {
    window.addEventListener('pointermove', e => {
      if (started || !el.sstage || e.pointerType === 'touch') return;
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      el.sstage.style.setProperty('--mx', (-nx * 18).toFixed(1) + 'px');
      el.sstage.style.setProperty('--my', (-ny * 10).toFixed(1) + 'px');
    });
  }


  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) act(b.dataset.act);
  });


  root.addEventListener('mouseover', e => {
    const b = e.target.closest('.nm-btn');
    if (b === lastHover) return;
    lastHover = b;
    if (b && !b.disabled) sfxHover();
  });


  window.addEventListener('keydown', e => {
    if (!started) {
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); begin(); }
      return;
    }
    if (leaving) return;
    if (panelOpen) {
      if (e.code === 'Escape' && !exitOpen) closePanel();
      return;
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      const btns = Array.from(root.querySelectorAll('#nm-menu .nm-btn:not([disabled])'));
      if (!btns.length) return;
      const down = e.code === 'ArrowDown';
      let i = btns.indexOf(document.activeElement);
      if (i < 0) i = down ? 0 : btns.length - 1;
      else i = (i + (down ? 1 : -1) + btns.length) % btns.length;
      btns[i].focus();
      e.preventDefault();
    }
  });


  // browser Back button can restore this page from memory
  window.addEventListener('pageshow', e => {
    if (!e.persisted) return;
    leaving = false;
    el.fade.classList.remove('on');
    hardStopMusic();
    if (started) tryAutoStart();
  });
}


function init() {
  build();
  layoutStage();
  wire();
  loadSplash();
  if (location.hash === SKIP_HASH) {
    started = true;
    el.splash.style.display = 'none';
    showMenu();
    tryAutoStart();
  } else {
    startSplashFx();
  }
  console.log('[menu] ready');
}


init();