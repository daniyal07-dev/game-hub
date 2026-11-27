// games/campaign/weather.js   (v3)
// Campaign Mode: weather. The player picks it on the start card: Clear / Cloudy / Storm.
//   CLOUDY: grey dark sky, heavy fog, weak sun, moving clouds. No rain.
//   STORM : darker, rain, wind, lightning flashes with thunder, rain sound (made by code).
//   CLEAR : the normal bright day (exactly as before).
// Default is CLOUDY (change DEFAULT below). The choice is saved on the device.
// Console:  setWeather('storm')   setWeather('cloudy')   setWeather('clear')
//           weatherVolume(0.03, 0.4)   -> rain volume, thunder volume (try it live)
//
// v2: rain about 3x quieter and softer, thunder much lower.
// v3: rain 3x quieter again (0.09 -> 0.03), thunder 0.8 -> 0.4, softer hiss (2600 Hz).
//
// Does NOT edit main.js. It finds the sky, the lights and the fog in the scene by itself.
// Rain is drawn on the graphics card (cheap), with fewer drops on phones.
// Needs to be listed in extras.js MODULES (before 'intro').


import * as THREE from 'three';




/* ---------- Knobs ---------- */
const SAVE_KEY = 'campaign_weather';
const DEFAULT = 'cloudy';                 // 'clear' | 'cloudy' | 'storm'
const PHONE = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);


const FADE_SECONDS = 2.0;                 // how long a weather change takes
const RAIN_DROPS = PHONE ? 700 : 1800;
const RAIN_BOX_W = PHONE ? 46 : 60;       // rain box around you (m)
const RAIN_BOX_H = PHONE ? 30 : 38;
const RAIN_FALL = 26;                     // m/s
const RAIN_LEN = 0.9;                     // streak length (m)
const RAIN_ALPHA = 0.5;
const RAIN_COLOR = [0.78, 0.85, 0.93];


const SOUND = true;                       // rain and thunder sound
let RAIN_VOLUME = 0.03;                   // was 0.09, first version 0.28 (too loud)
let THUNDER_VOLUME = 0.4;                 // was 0.8, first version 2.2 (too loud)
const RAIN_HISS_MAX = 2600;               // lower = softer rain (was 3200, first version 7000)
const RAIN_HISS_MIN = 500;                // cuts the low rumble
const BOLT_MIN = 7, BOLT_MAX = 16;        // seconds between lightning strikes
const FLASH_AMBIENT = 1.6;                // how bright a lightning flash lights the world
const FLASH_SKY = 0.5;




/* ---------- The weathers ---------- */
// sunMul / hemiMul / ambMul = light strength x, fogMul = fog distance x, fogNear = fog start x
const WEATHER = {
  clear:  { label: '☀ Clear' },
  cloudy: {
    label: '☁ Cloudy',
    horizon: 0x7e8892, top: 0x4b535d, sunCol: 0xc9d2de, hemiSky: 0x9aa6b4, cloudCol: 0xb4bcc6,
    sunMul: 0.30, hemiMul: 0.65, ambMul: 1.0, fogMul: 0.55, fogNear: 0.5,
    cloud: 0.9, rain: 0, wind: 0, bolt: false
  },
  storm: {
    label: '⛈ Storm',
    horizon: 0x3b424b, top: 0x1d232b, sunCol: 0x95a3b8, hemiSky: 0x6f7c8c, cloudCol: 0x5c646e,
    sunMul: 0.10, hemiMul: 0.45, ambMul: 1.0, fogMul: 0.36, fogNear: 0.3,
    cloud: 0.97, rain: 1, wind: 6, bolt: true
  }
};
const ORDER = ['clear', 'cloudy', 'storm'];




/* ---------- State ---------- */
let scene = null, api = {};
let ready = false;
let name = DEFAULT;
let sky = null, skyU = null, sunLight = null, hemiLight = null, ambLight = null;
let base = null;                           // the CLEAR values, captured at start
let cur = null, tgt = null;
let sunOrig = new THREE.Vector3(-0.5, 0.7, -0.45).normalize();
const sunVec = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
let baseFar = 850, baseNear = 60, lastFar = 850;
let dome = null, domeTex = null;
let rain = null, rainU = null, rainTime = 0;
let flash = 0, boltT = 8, bolts = [], thunders = [];
let actx = null, noiseBuf = null, rainGain = null, master = 0.8, masterT = 0;




/* ---------- Helpers ---------- */
const NUM_KEYS = ['sunMul', 'hemiMul', 'ambMul', 'fogMul', 'fogNear', 'cloud', 'rain', 'wind'];
const COL_KEYS = ['horizon', 'top', 'sunCol', 'hemiSky', 'cloudCol'];


function makeSet() {
  const o = {};
  for (const k of NUM_KEYS) o[k] = 0;
  for (const k of COL_KEYS) o[k] = new THREE.Color();
  return o;
}


function fillTarget(out, w) {
  const W = WEATHER[w];
  if (!W || w === 'clear') {
    out.horizon.copy(base.horizon); out.top.copy(base.top);
    out.sunCol.copy(base.sunCol); out.hemiSky.copy(base.hemiSky);
    out.cloudCol.copy(cur ? cur.cloudCol : new THREE.Color(0xb4bcc6));
    out.sunMul = 1; out.hemiMul = 1; out.ambMul = 1; out.fogMul = 1; out.fogNear = 1;
    out.cloud = 0; out.rain = 0; out.wind = 0;
    return;
  }
  for (const k of COL_KEYS) out[k].set(W[k]);
  for (const k of NUM_KEYS) out[k] = W[k];
}


function readMaster() {
  try {
    const s = JSON.parse(localStorage.getItem('nova_settings') || '{}');
    if (typeof s.master === 'number') master = Math.max(0, Math.min(1, s.master));
  } catch (e) { /* ignore */ }
}




/* ---------- Clouds ---------- */
function makeCloudTexture() {
  const W = PHONE ? 512 : 1024, H = W / 2;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(215,222,230,0.82)';
  g.fillRect(0, 0, W, H);
  const n = PHONE ? 90 : 160;
  for (let i = 0; i < n; i++) {
    const x = Math.random() * W, y = Math.random() * H * 0.85;
    const r = W * (0.03 + Math.random() * 0.09);
    const light = Math.random() < 0.5;
    const rgb = light ? '255,255,255' : '110,120,134';
    const al = 0.12 + Math.random() * 0.18;
    for (const ox of [-W, 0, W]) {                       // wraps around the left/right edge
      const gr = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      gr.addColorStop(0, 'rgba(' + rgb + ',' + al + ')');
      gr.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = gr;
      g.fillRect(x + ox - r, y - r, r * 2, r * 2);
    }
  }
  g.globalCompositeOperation = 'destination-in';         // fade out near the horizon
  const f = g.createLinearGradient(0, 0, 0, H);
  f.addColorStop(0, 'rgba(0,0,0,1)');
  f.addColorStop(0.62, 'rgba(0,0,0,1)');
  f.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = f;
  g.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}


function buildDome() {
  domeTex = makeCloudTexture();
  const mat = new THREE.MeshBasicMaterial({
    map: domeTex, transparent: true, opacity: 0, side: THREE.BackSide,
    depthWrite: false, fog: false
  });
  dome = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  dome.frustumCulled = false;
  dome.visible = false;
  dome.renderOrder = -0.5;
  scene.add(dome);
}




/* ---------- Rain (moves on the graphics card) ---------- */
function buildRain() {
  const pos = new Float32Array(RAIN_DROPS * 2 * 3);
  const end = new Float32Array(RAIN_DROPS * 2);
  for (let i = 0; i < RAIN_DROPS; i++) {
    const x = Math.random() * RAIN_BOX_W, y = Math.random() * RAIN_BOX_H, z = Math.random() * RAIN_BOX_W;
    for (let k = 0; k < 2; k++) {
      const j = (i * 2 + k) * 3;
      pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
      end[i * 2 + k] = k;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  rainU = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(RAIN_BOX_W, RAIN_BOX_H, RAIN_BOX_W) },
    uFall: { value: RAIN_FALL },
    uWind: { value: new THREE.Vector2(0, 0) },
    uLen: { value: RAIN_LEN },
    uAlpha: { value: RAIN_ALPHA },
    uColor: { value: new THREE.Vector3(RAIN_COLOR[0], RAIN_COLOR[1], RAIN_COLOR[2]) }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: rainU, transparent: true, depthWrite: false, fog: false,
    vertexShader: `
      uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform float uFall;
      uniform vec2 uWind; uniform float uLen; uniform float uAlpha;
      attribute float aEnd;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y -= uTime * uFall;
        p.x += uTime * uWind.x;
        p.z += uTime * uWind.y;
        vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
        vec3 vel = vec3(uWind.x, -uFall, uWind.y);
        vec3 w = uCam + rel - normalize(vel) * uLen * aEnd;
        float edge = length(rel.xz) / (uBox.x * 0.5);
        vA = uAlpha * (1.0 - aEnd * 0.85) * (1.0 - smoothstep(0.55, 1.0, edge));
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vA;
      void main() { gl_FragColor = vec4(uColor, vA); }`
  });
  rain = new THREE.LineSegments(g, mat);
  rain.frustumCulled = false;
  rain.visible = false;
  rain.renderOrder = 4;
  scene.add(rain);
}




/* ---------- Sound (made by code) ---------- */
function ensureAudio() {
  if (!SOUND || actx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    const len = Math.floor(actx.sampleRate * 2);
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = RAIN_HISS_MIN;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = RAIN_HISS_MAX;
    rainGain = actx.createGain(); rainGain.gain.value = 0;
    src.connect(hp); hp.connect(lp); lp.connect(rainGain); rainGain.connect(actx.destination);
    src.start();
  } catch (e) { actx = null; console.info('[weather] sound off:', e.message); }
}


function thunderSound(strength) {
  if (!actx || !noiseBuf) return;
  const t = actx.currentTime;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(260, t);
  lp.frequency.exponentialRampToValueAtTime(70, t + 3);
  const g = actx.createGain();
  const v = Math.max(0.0002, THUNDER_VOLUME * master * strength);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.08);
  g.gain.exponentialRampToValueAtTime(v * 0.4, t + 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
  src.connect(lp); lp.connect(g); g.connect(actx.destination);
  src.start(t); src.stop(t + 3.4);
}




/* ---------- Start card: the weather buttons ---------- */
function buildCard() {
  const play = document.getElementById('play-btn');
  if (!play || !play.parentNode || document.getElementById('wx-box')) return;
  const st = document.createElement('style');
  st.textContent =
    '#wx-box{margin:12px auto;text-align:center;font-family:Consolas,monospace}' +
    '#wx-box .wx-t{font-size:11px;letter-spacing:3px;color:#8fc4ff;margin-bottom:6px}' +
    '#wx-box .wx-row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}' +
    '#wx-box button{min-width:92px;min-height:40px;padding:8px 12px;font:700 13px Consolas,monospace;letter-spacing:1px;' +
    'color:#cfe6ff;background:rgba(10,25,45,.65);border:1px solid rgba(90,170,255,.5);border-radius:6px;cursor:pointer}' +
    '#wx-box button.on{background:#2b7de0;border-color:#8fc4ff;color:#fff}';
  document.head.appendChild(st);
  const box = document.createElement('div');
  box.id = 'wx-box';
  box.innerHTML = '<div class="wx-t">WEATHER</div><div class="wx-row"></div>';
  const row = box.querySelector('.wx-row');
  for (const w of ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.wx = w;
    b.textContent = WEATHER[w].label;
    b.addEventListener('click', (e) => { e.stopPropagation(); setWeather(w); });
    row.appendChild(b);
  }
  play.parentNode.insertBefore(box, play);
  markButtons();
}


function markButtons() {
  document.querySelectorAll('#wx-box button').forEach((b) => b.classList.toggle('on', b.dataset.wx === name));
}




/* ---------- Choosing the weather ---------- */
export function setWeather(w, instant) {
  if (!WEATHER[w]) { console.log("setWeather: use 'clear', 'cloudy' or 'storm'"); return; }
  name = w;
  try { localStorage.setItem(SAVE_KEY, w); } catch (e) { /* ignore */ }
  if (!ready) return;
  fillTarget(tgt, w);
  if (instant) copySet(cur, tgt);
  boltT = 4 + Math.random() * 5;
  bolts.length = 0; thunders.length = 0;
  markButtons();
  console.log('[weather] ' + w);
}
window.setWeather = (w) => setWeather(w);


// Console: weatherVolume(0.03, 0.4)  -> rain, thunder.  No arguments = show the values.
window.weatherVolume = (r, t) => {
  if (typeof r === 'number') RAIN_VOLUME = Math.max(0, r);
  if (typeof t === 'number') THUNDER_VOLUME = Math.max(0, t);
  console.log('[weather] rain volume ' + RAIN_VOLUME + ', thunder volume ' + THUNDER_VOLUME);
};


function copySet(a, b) {
  for (const k of NUM_KEYS) a[k] = b[k];
  for (const k of COL_KEYS) a[k].copy(b[k]);
}




/* ---------- Extras module API ---------- */
export function init(ctx) {
  api = ctx || {};
  scene = api.scene;
  if (!scene) { console.warn('[weather] no scene, weather off'); return; }


  // find what main.js built (only direct children of the scene)
  const kids = scene.children;
  sky = kids.find((o) => o.isMesh && o.material && o.material.uniforms && o.material.uniforms.uTop) || null;
  sunLight = kids.find((o) => o.isDirectionalLight && o.castShadow) || kids.find((o) => o.isDirectionalLight) || null;
  hemiLight = kids.find((o) => o.isHemisphereLight) || null;
  ambLight = kids.find((o) => o.isAmbientLight) || null;


  base = {
    horizon: new THREE.Color(0xbfd9ec), top: new THREE.Color(0x2f7fd1),
    sunCol: new THREE.Color(0xfff6e5), hemiSky: new THREE.Color(0xdbeeff),
    sun: 2.2, hemi: 1.1, amb: 0.35
  };
  if (sky) {
    skyU = sky.material.uniforms;
    base.horizon.copy(skyU.uHorizon.value);
    base.top.copy(skyU.uTop.value);
    if (skyU.uSun) {
      sunOrig.copy(skyU.uSun.value);
      skyU.uSun = { value: sunVec.copy(sunOrig) };      // our own copy: we can hide the sun glow
    }
  } else if (scene.fog) {
    base.horizon.copy(scene.fog.color);
    base.top.copy(scene.fog.color);
  }
  if (sunLight) { base.sunCol.copy(sunLight.color); base.sun = sunLight.intensity; }
  if (hemiLight) { base.hemiSky.copy(hemiLight.color); base.hemi = hemiLight.intensity; }
  if (ambLight) base.amb = ambLight.intensity;
  if (scene.fog) { baseFar = scene.fog.far; baseNear = scene.fog.near; lastFar = baseFar; }


  cur = makeSet(); tgt = makeSet();
  cur.cloudCol.set(0xb4bcc6);
  ready = true;


  buildDome();
  buildRain();
  buildCard();
  readMaster();


  let saved = null;
  try { saved = localStorage.getItem(SAVE_KEY); } catch (e) { /* ignore */ }
  setWeather(WEATHER[saved] ? saved : DEFAULT, true);


  // sound can only start after a click or tap
  const wake = () => { ensureAudio(); if (actx && actx.state === 'suspended') actx.resume(); };
  window.addEventListener('pointerdown', wake, { passive: true });
  window.addEventListener('keydown', wake);
  window.addEventListener('campaign:playing', wake);


  console.log('[weather] v3 ready: ' + name + (sky ? '' : ' (sky not found: fog only)') +
              (PHONE ? ' (phone: fewer drops)' : '') + ". Console: setWeather('storm')");
}


export function update(dt, ctx) {
  if (!ready) return;
  const c = ctx || api;
  const playing = c.isPlaying ? !!c.isPlaying() : true;
  const cam = c.camera || api.camera;


  // 1) glide towards the chosen weather
  const a = 1 - Math.exp(-dt / (FADE_SECONDS / 3));
  for (const k of NUM_KEYS) {
    const d = tgt[k] - cur[k];
    cur[k] = Math.abs(d) < 0.0005 ? tgt[k] : cur[k] + d * a;
  }
  for (const k of COL_KEYS) cur[k].lerp(tgt[k], a);


  // 2) lightning and thunder (storm only, only while playing)
  const W = WEATHER[name];
  if (W && W.bolt && playing) {
    boltT -= dt;
    if (boltT <= 0) {
      boltT = BOLT_MIN + Math.random() * (BOLT_MAX - BOLT_MIN);
      bolts.push({ t: 0, s: 1 }, { t: 0.16, s: 0.7 });
      if (Math.random() < 0.5) bolts.push({ t: 0.34, s: 0.5 });
      thunders.push({ t: 0.4 + Math.random() * 1.8, s: 0.6 + Math.random() * 0.4 });
    }
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    bolts[i].t -= dt;
    if (bolts[i].t <= 0) { flash = Math.max(flash, bolts[i].s); bolts.splice(i, 1); }
  }
  for (let i = thunders.length - 1; i >= 0; i--) {
    thunders[i].t -= dt;
    if (thunders[i].t <= 0) { if (playing) thunderSound(thunders[i].s); thunders.splice(i, 1); }
  }
  flash *= Math.exp(-dt * 9);
  if (flash < 0.002) flash = 0;


  // 3) apply to the world
  if (skyU) {
    skyU.uHorizon.value.copy(cur.horizon).addScalar(flash * FLASH_SKY);
    skyU.uTop.value.copy(cur.top).addScalar(flash * FLASH_SKY * 0.8);
    if (skyU.uSun) sunVec.copy(sunOrig).lerp(DOWN, Math.min(1, cur.cloud * 1.15)).normalize();
  }
  if (scene.background && scene.background.isColor) scene.background.copy(cur.horizon).addScalar(flash * FLASH_SKY);
  if (sunLight) { sunLight.intensity = base.sun * cur.sunMul; sunLight.color.copy(cur.sunCol); }
  if (hemiLight) {
    hemiLight.intensity = base.hemi * cur.hemiMul + flash * FLASH_AMBIENT * 0.5;
    hemiLight.color.copy(cur.hemiSky);
  }
  if (ambLight) ambLight.intensity = base.amb * cur.ambMul + flash * FLASH_AMBIENT;
  if (scene.fog) {
    if (Math.abs(scene.fog.far - lastFar) > 0.01) baseFar = scene.fog.far;      // main.js changed the quality
    scene.fog.far = baseFar * cur.fogMul;
    scene.fog.near = baseNear * cur.fogNear;
    lastFar = scene.fog.far;
    scene.fog.color.copy(cur.horizon).addScalar(flash * FLASH_SKY);
  }


  // clouds
  if (dome) {
    dome.visible = cur.cloud > 0.01;
    if (dome.visible) {
      if (cam) dome.position.copy(cam.position);
      dome.rotation.y += dt * 0.004;
      dome.material.opacity = cur.cloud;
      dome.material.color.copy(cur.cloudCol).addScalar(flash * 0.6);
    }
  }


  // rain
  if (rain) {
    const n = Math.floor(cur.rain * RAIN_DROPS);
    rain.visible = n > 0;
    if (n > 0) {
      rainTime += dt;
      rain.geometry.setDrawRange(0, n * 2);
      rainU.uTime.value = rainTime;
      if (cam) rainU.uCam.value.copy(cam.position);
      rainU.uWind.value.set(cur.wind, cur.wind * 0.3);
    }
  }


  // rain sound
  if (actx) {
    masterT -= dt;
    if (masterT <= 0) { masterT = 2; readMaster(); }
    if (playing && actx.state === 'suspended') actx.resume();
    const v = playing ? cur.rain * RAIN_VOLUME * master : 0;
    rainGain.gain.setTargetAtTime(v, actx.currentTime, 0.3);
  }
}


export function reset() {
  flash = 0; bolts.length = 0; thunders.length = 0;
  boltT = 5 + Math.random() * 5;
}