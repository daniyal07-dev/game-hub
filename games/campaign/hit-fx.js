// games/campaign/hit-fx.js   (v3: glowing blood)
// Campaign Mode: hit effects on enemies.
//  - HIT : a bright flash, a glowing mist and a spray of glowing droplets (mostly out the far side),
//          a small stagger and a flesh thump.
//  - KILL: a bigger spray, extra mist clouds, a blood pool under the body, a deeper thump.
//  - HEAD: extra spray from head height and a sharp crack.
//  - Droplets fall and leave dark splats on the ground that fade away.
//  - Works for every hit (you, your soldiers, base guards): it watches each enemy's hp.
//  - Does NOT edit enemies.js, player.js or any model material.
//
//  STYLE : 'blood' (red) | 'fire' (gold-orange) | 'green' | 'blue'
//  AMOUNT: 1 = normal, 0.5 = milder, 0 = none        GLOW: 1 = normal, 2 = very bright, 0.5 = subtle
//
// Needs to be listed in extras.js MODULES (already done in v8).

import * as THREE from 'three';
import { groundHeight, resolve as resolveCollision } from './collision.js';



/* ---------- Knobs ---------- */
const PHONE = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);

const STYLE = 'blood';                    // 'blood' | 'fire' | 'green' | 'blue'
const AMOUNT = 1.0;                       // 0.5 = less, 0 = none
const GLOW = 1.3;                         // brightness of the glowing parts

const P_COUNT = PHONE ? 220 : 480;        // droplets + mist puffs that can exist at once
const DECAL_COUNT = PHONE ? 24 : 60;      // ground splats that can exist at once
const MAX_DIST = 130;                     // no effects further than this from you

const HIT_DROPS = PHONE ? 5 : 8;
const KILL_DROPS = PHONE ? 18 : 34;
const DROP_MIN = PHONE ? 0.07 : 0.05;     // droplet size (m)
const DROP_MAX = PHONE ? 0.15 : 0.11;
const GRAVITY = 11;
const SPLAT_CHANCE = 0.45;                // chance that a landing droplet leaves a splat
const POOL_SIZE = 1.1;                    // blood pool under a body (m)
const POOL_DELAY = 0.7;                   // seconds after death before the pool starts
const POOL_GROW = 2.6;                    // seconds the pool takes to spread

const KNOCK_HIT = 1.2;                    // stagger speed on a hit (m/s). 0 = off
const KNOCK_KILL = 3.0;

const SOUND = true;
const IMPACT_VOLUME = 0.35;               // lower = quieter hit sounds



const PALETTE = {
  blood: { drop: [[0.85, 0.04, 0.03], [1.00, 0.12, 0.05], [1.00, 0.35, 0.10]], mist: [0.80, 0.04, 0.03], flash: [1.0, 0.45, 0.28], decal: 0x5a0808 },
  fire:  { drop: [[1.00, 0.45, 0.05], [1.00, 0.70, 0.15], [1.00, 0.90, 0.45]], mist: [1.00, 0.45, 0.06], flash: [1.0, 0.85, 0.50], decal: 0x5a2a08 },
  green: { drop: [[0.12, 0.70, 0.08], [0.25, 0.95, 0.12], [0.55, 1.00, 0.30]], mist: [0.20, 0.80, 0.10], flash: [0.6, 1.0, 0.4], decal: 0x1d4a0a },
  blue:  { drop: [[0.08, 0.35, 0.90], [0.15, 0.60, 1.00], [0.45, 0.85, 1.00]], mist: [0.10, 0.50, 1.00], flash: [0.5, 0.8, 1.0], decal: 0x0a2a5a }
};
const PAL = PALETTE[STYLE] || PALETTE.blood;



/* ---------- State ---------- */
let scene = null, api = {}, ready = false;
let seen = new WeakMap();                 // enemy -> { hp, max, dead, kx, kz }
let headNext = false;
let pts = null, pI = 0;
const P = {};
let decals = [], decI = 0;
let actx = null, noiseBuf = null, master = 0.8, masterT = 0, lastSnd = 0;



/* ---------- Textures ---------- */
function dropTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function splatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const blob = (x, y, r) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(64, 64, 34);
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2, d = 26 + Math.random() * 28;
    blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 5 + Math.random() * 11);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}



/* ---------- Build ---------- */
function build() {
  const N = P_COUNT;
  P.pos = new Float32Array(N * 3); P.vel = new Float32Array(N * 3); P.col = new Float32Array(N * 3);
  P.size = new Float32Array(N); P.alpha = new Float32Array(N);
  P.life = new Float32Array(N); P.max = new Float32Array(N);
  P.kind = new Uint8Array(N); P.size0 = new Float32Array(N); P.alpha0 = new Float32Array(N); P.grow = new Float32Array(N);
  for (let i = 0; i < N; i++) P.pos[i * 3 + 1] = -1000;

  const g = new THREE.BufferGeometry();
  const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', dyn(P.pos, 3));
  g.setAttribute('aColor', dyn(P.col, 3));
  g.setAttribute('aSize', dyn(P.size, 1));
  g.setAttribute('aAlpha', dyn(P.alpha, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: dropTexture() }, uScale: { value: 600 }, uGlow: { value: GLOW } },
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,                         // this is what makes it glow
    vertexShader: `
      attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
      uniform float uScale;
      varying vec3 vC; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / max(0.5, -mv.z);
        vC = aColor; vA = aAlpha;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform float uGlow;
      varying vec3 vC; varying float vA;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vC * uGlow, a);
      }`
  });
  pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 7;
  scene.add(pts);

  const tex = splatTexture();
  const geo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < DECAL_COUNT; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex, color: PAL.decal, transparent: true, opacity: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false
    }));
    m.rotation.set(-Math.PI / 2, 0, 0);
    m.visible = false;
    m.frustumCulled = false;
    m.renderOrder = 3;
    scene.add(m);
    decals.push({ m, active: false, age: 0, delay: 0, life: 1, s0: 1, s1: 1, grow: 1 });
  }
  ready = true;
}



/* ---------- Particles ---------- */
function addP(kind, x, y, z, vx, vy, vz, c, size, alpha, life, grow) {
  const i = pI++ % P_COUNT, j = i * 3;
  P.pos[j] = x; P.pos[j + 1] = y; P.pos[j + 2] = z;
  P.vel[j] = vx; P.vel[j + 1] = vy; P.vel[j + 2] = vz;
  P.col[j] = c[0]; P.col[j + 1] = c[1]; P.col[j + 2] = c[2];
  P.kind[i] = kind;
  P.size0[i] = size; P.size[i] = size;
  P.alpha0[i] = alpha; P.alpha[i] = alpha;
  P.life[i] = life; P.max[i] = life;
  P.grow[i] = grow || 0;
}

function hideP(i) {
  P.life[i] = 0; P.alpha[i] = 0; P.pos[i * 3 + 1] = -1000;
}

function updateParticles(dt) {
  let any = false;
  for (let i = 0; i < P_COUNT; i++) {
    if (P.life[i] <= 0) continue;
    any = true;
    P.life[i] -= dt;
    if (P.life[i] <= 0) { hideP(i); continue; }
    const k = P.life[i] / P.max[i];
    const j = i * 3;
    if (P.kind[i] === 0) {                                   // droplet
      P.vel[j + 1] -= GRAVITY * dt;
      P.pos[j] += P.vel[j] * dt;
      P.pos[j + 1] += P.vel[j + 1] * dt;
      P.pos[j + 2] += P.vel[j + 2] * dt;
      const gy = groundHeight(P.pos[j], P.pos[j + 2]);
      if (P.pos[j + 1] < gy + 0.03) {
        if (Math.random() < SPLAT_CHANCE) addSplat(P.pos[j], P.pos[j + 2], 0.12 + Math.random() * 0.22, false);
        hideP(i);
        continue;
      }
      P.alpha[i] = P.alpha0[i] * (k > 0.2 ? 1 : k / 0.2);
    } else if (P.kind[i] === 2) {                            // impact flash: grows fast, fades fast
      P.size[i] = P.size0[i] + P.grow[i] * (1 - k);
      P.alpha[i] = P.alpha0[i] * k * k;
    } else {                                                 // mist puff
      const drag = Math.exp(-dt * 3.2);
      P.vel[j] *= drag; P.vel[j + 1] = P.vel[j + 1] * drag + 0.5 * dt; P.vel[j + 2] *= drag;
      P.pos[j] += P.vel[j] * dt;
      P.pos[j + 1] += P.vel[j + 1] * dt;
      P.pos[j + 2] += P.vel[j + 2] * dt;
      P.size[i] = P.size0[i] + P.grow[i] * (1 - k);
      P.alpha[i] = P.alpha0[i] * k;
    }
  }
  if (any) {
    const a = pts.geometry.attributes;
    a.position.needsUpdate = true; a.aColor.needsUpdate = true;
    a.aSize.needsUpdate = true; a.aAlpha.needsUpdate = true;
  }
}



/* ---------- Ground splats ---------- */
function addSplat(x, z, size, pool) {
  const d = decals[decI++ % decals.length];
  d.m.position.set(x, groundHeight(x, z) + 0.04, z);
  d.m.rotation.z = Math.random() * Math.PI * 2;
  d.active = true;
  d.age = 0;
  d.delay = pool ? POOL_DELAY : 0;
  d.life = pool ? 26 : 14;
  d.s0 = pool ? 0.2 : size;
  d.s1 = size;
  d.grow = pool ? POOL_GROW : 0.001;
  d.m.visible = false;
}

function updateDecals(dt) {
  for (const d of decals) {
    if (!d.active) continue;
    d.age += dt;
    if (d.age >= d.life) { d.active = false; d.m.visible = false; continue; }
    if (d.age < d.delay) continue;
    const t = Math.min(1, (d.age - d.delay) / d.grow);
    d.m.scale.setScalar(d.s0 + (d.s1 - d.s0) * t * (2 - t));
    const rem = d.life - d.age;
    d.m.material.opacity = 0.88 * (rem < 4 ? rem / 4 : 1);
    d.m.visible = true;
  }
}



/* ---------- Sound (made by code) ---------- */
function ensureAudio() {
  if (!SOUND || actx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    const len = Math.floor(actx.sampleRate * 0.5);
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { actx = null; }
}

function readMaster() {
  try {
    const s = JSON.parse(localStorage.getItem('nova_settings') || '{}');
    if (typeof s.master === 'number') master = Math.max(0, Math.min(1, s.master));
  } catch (e) { /* ignore */ }
}

function impactSound(kind, dist) {
  if (!actx || !noiseBuf || actx.state !== 'running') return;
  const now = actx.currentTime;
  if (now - lastSnd < 0.045) return;                         // shotgun pellets: one sound
  lastSnd = now;
  const fall = Math.max(0, 1 - dist / MAX_DIST);
  const vol = IMPACT_VOLUME * master * fall * fall;
  if (vol < 0.003) return;

  // body thump
  const o = actx.createOscillator();
  o.type = 'sine';
  const low = kind === 'kill';
  o.frequency.setValueAtTime(low ? 95 : 150, now);
  o.frequency.exponentialRampToValueAtTime(low ? 38 : 55, now + (low ? 0.28 : 0.13));
  const og = actx.createGain();
  og.gain.setValueAtTime(0.0001, now);
  og.gain.exponentialRampToValueAtTime(vol * 0.9, now + 0.006);
  og.gain.exponentialRampToValueAtTime(0.0001, now + (low ? 0.32 : 0.15));
  o.connect(og); og.connect(actx.destination);
  o.start(now); o.stop(now + 0.34);

  // wet noise burst
  const n = actx.createBufferSource();
  n.buffer = noiseBuf;
  const lp = actx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1300;
  const ng = actx.createGain();
  ng.gain.setValueAtTime(0.0001, now);
  ng.gain.exponentialRampToValueAtTime(vol * 0.6, now + 0.004);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  n.connect(lp); lp.connect(ng); ng.connect(actx.destination);
  n.start(now); n.stop(now + 0.1);

  if (kind === 'head') {                                     // sharp crack
    const c = actx.createBufferSource();
    c.buffer = noiseBuf;
    const hp = actx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2400;
    const cg = actx.createGain();
    cg.gain.setValueAtTime(0.0001, now);
    cg.gain.exponentialRampToValueAtTime(vol * 0.55, now + 0.002);
    cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    c.connect(hp); hp.connect(cg); cg.connect(actx.destination);
    c.start(now); c.stop(now + 0.06);
  }
}



/* ---------- One impact ---------- */
function impact(e, rec, killed, head, dmg, px, pz) {
  const gy = groundHeight(e.x, e.z);
  const y = gy + (head ? 1.6 : 1.2);
  let ax = e.x - px, az = e.z - pz;                          // direction away from the shooter
  const d = Math.hypot(ax, az) || 1;
  ax /= d; az /= d;
  const rx = -az, rz = ax;                                   // sideways
  const A = AMOUNT;

  if (A > 0) {
    // bright flash at the entry point
    addP(2, e.x - ax * 0.25, y, e.z - az * 0.25, 0, 0, 0, PAL.flash, 0.2, 0.9, 0.13, killed ? 0.9 : 0.55);

    // glowing mist: small at the entry, bigger at the exit
    addP(1, e.x - ax * 0.2, y, e.z - az * 0.2, -ax * 0.8, 0.3, -az * 0.8, PAL.mist, 0.18, 0.26 * A, 0.35, 0.30);
    addP(1, e.x + ax * 0.2, y, e.z + az * 0.2, ax * 1.6, 0.4, az * 1.6, PAL.mist, 0.25, 0.32 * A, 0.55, 0.55);
    if (killed) {
      addP(2, e.x, y, e.z, 0, 0.2, 0, PAL.flash, 0.3, 0.8, 0.22, 1.4);
      addP(1, e.x, y - 0.1, e.z, ax * 0.8, 0.5, az * 0.8, PAL.mist, 0.35, 0.34 * A, 0.8, 0.9);
      addP(1, e.x + ax * 0.4, y + 0.1, e.z + az * 0.4, ax * 2.2, 0.6, az * 2.2, PAL.mist, 0.30, 0.30 * A, 0.7, 0.7);
    }
    if (head) addP(1, e.x, gy + 1.75, e.z, ax * 0.6, 1.0, az * 0.6, PAL.mist, 0.30, 0.34 * A, 0.7, 0.8);

    // droplets
    let n = killed ? KILL_DROPS : Math.min(22, HIT_DROPS + dmg * 0.2);
    n = Math.round(n * A * (head ? 1.4 : 1));
    for (let k = 0; k < n; k++) {
      const back = Math.random() < 0.28;                     // some splash back towards you
      const speed = (back ? 0.5 + Math.random() * 1.6 : 1.5 + Math.random() * (killed ? 6.5 : 4.5)) * (back ? -1 : 1);
      const side = (Math.random() - 0.5) * 1.6;
      const vx = ax * speed + rx * side * Math.abs(speed) * 0.5;
      const vz = az * speed + rz * side * Math.abs(speed) * 0.5;
      const vy = 0.6 + Math.random() * (killed ? 4.0 : 2.8);
      const c = PAL.drop[Math.floor(Math.random() * PAL.drop.length)];
      addP(0, e.x + ax * 0.1, y + (Math.random() - 0.5) * 0.2, e.z + az * 0.1, vx, vy, vz,
           c, DROP_MIN + Math.random() * (DROP_MAX - DROP_MIN), 0.95, 1.4, 0);
    }

    // splats on the ground near the body
    if (killed) {
      addSplat(e.x + ax * 0.3, e.z + az * 0.3, POOL_SIZE * (0.85 + Math.random() * 0.4), true);
      for (let k = 0; k < 3; k++) {
        const dd = 0.6 + Math.random() * 1.6, sd = (Math.random() - 0.5) * 1.2;
        addSplat(e.x + ax * dd + rx * sd, e.z + az * dd + rz * sd, 0.15 + Math.random() * 0.25, false);
      }
    }
  }

  // stagger
  const kb = killed ? KNOCK_KILL : KNOCK_HIT;
  rec.kx += ax * kb; rec.kz += az * kb;

  impactSound(killed ? 'kill' : (head ? 'head' : 'hit'), d);
}



/* ---------- Extras module API ---------- */
export function init(ctx) {
  api = ctx || {};
  scene = api.scene;
  if (!scene) { console.warn('[hit-fx] no scene, effects off'); return; }
  build();
  readMaster();
  const wake = () => { ensureAudio(); if (actx && actx.state === 'suspended') actx.resume(); };
  window.addEventListener('pointerdown', wake, { passive: true });
  window.addEventListener('keydown', wake);
  window.addEventListener('campaign:playing', wake);
  console.log('[hit-fx] v3 ready: glowing ' + STYLE + ' effects, stagger and impact sound' + (PHONE ? ' (phone: lighter)' : ''));
}

export function onEvent(name, data) {
  if (name === 'hit' || name === 'kill') headNext = !!(data && data.head);
}

export function update(dt, ctx) {
  if (!ready) return;
  const c = ctx || api;
  const list = (c.getEnemies ? c.getEnemies() : (api.getEnemies ? api.getEnemies() : [])) || [];
  const player = c.player || api.player || { x: 0, z: 0 };
  pts.material.uniforms.uScale.value = window.innerHeight / 1.4;

  for (const e of list) {
    if (!e || !e.char) continue;
    let rec = seen.get(e);
    if (!rec) { seen.set(e, { hp: e.hp, max: e.maxHp, dead: !!e.dead, kx: 0, kz: 0 }); continue; }
    if (rec.max !== e.maxHp) { rec.max = e.maxHp; rec.hp = e.hp; rec.dead = !!e.dead; continue; }   // difficulty changed

    // smooth stagger (collision keeps him out of walls)
    if (rec.kx * rec.kx + rec.kz * rec.kz > 0.0004) {
      const f = resolveCollision(e.x + rec.kx * dt, e.z + rec.kz * dt, 0.45);
      e.x = f.x; e.z = f.z;
      const dec = Math.exp(-dt * 8);
      rec.kx *= dec; rec.kz *= dec;
    } else { rec.kx = 0; rec.kz = 0; }

    const killed = !!e.dead && !rec.dead;
    const hurt = e.hp < rec.hp;
    if (killed || hurt) {
      const dist = Math.hypot(player.x - e.x, player.z - e.z);
      if (dist <= MAX_DIST) impact(e, rec, killed, headNext, rec.hp - e.hp, player.x, player.z);
    }
    rec.hp = e.hp;
    rec.dead = !!e.dead;
  }
  headNext = false;

  updateParticles(dt);
  updateDecals(dt);

  masterT -= dt;
  if (masterT <= 0) { masterT = 2; readMaster(); }
}

export function reset() {
  seen = new WeakMap();
  headNext = false;
  if (!ready) return;
  for (let i = 0; i < P_COUNT; i++) hideP(i);
  const a = pts.geometry.attributes;
  a.position.needsUpdate = true; a.aAlpha.needsUpdate = true;
  for (const d of decals) { d.active = false; d.m.visible = false; }
}