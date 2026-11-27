// ============================================================
//  NOVA STRIKE 3D — Campaign: games/campaign/aim-assist.js  (v1)
//  Soft aim assist (never a lock-on):
//    1) SLOWDOWN: turning gets slower while the crosshair is near
//       a living enemy (a fast flick passes through untouched).
//    2) PULL: while you are firing, the aim is nudged toward the
//       enemy's chest. It stops once you are on target and weakens
//       if you turn away.
//  Enemies behind walls / ground are ignored.
//  Works with mouse AND finger (phones get a stronger version).
//  Levels: off / low / medium / high   (saved: campaign_aim)
//  Console:  aimAssist('high')   aimAssist({slow,pull,cone})   aimAssist()
//  Door for the future settings screen: window.campaignAim
// ============================================================
import { groundHeight, blockedAt } from './collision.js';

const KEY = 'campaign_aim';
const DEFAULT = 'medium';

// slow = turning speed inside the zone (1 = unchanged, 0.5 = half)
// pull = pull speed while firing (bigger = stronger)
// cone = catch angle in degrees (bigger = easier to catch)
const LEVELS = {
  off:    { slow: 1.00, pull: 0.0, cone: 0.0 },
  low:    { slow: 0.70, pull: 1.8, cone: 3.0 },
  medium: { slow: 0.50, pull: 3.5, cone: 4.5 },
  high:   { slow: 0.32, pull: 6.0, cone: 6.5 },
};
const NAMES = ['off', 'low', 'medium', 'high'];
const PHONE_SLOW = 1.25;      // phone: slowdown is 25% deeper
const PHONE_PULL = 1.5;       // phone: pull is 1.5x stronger
const PHONE_CONE = 1.3;       // phone: catch angle is 1.3x wider

const MIN_D = 3, MAX_D = 140; // only enemies between these distances (m)
const ZONE_R = 0.9;           // enemy "size" in metres for close enemies
const CONE_MAX = 12;          // never wider than this (degrees)
const ZONE_K = 1.6;           // slowdown zone = catch angle x this
const CHEST = 1.1;            // aim point above the feet (m)
const FOOT = 0.15;            // same lift as player.js
const WALL_TOP = 14;          // shots fly over buildings above this height
const FLICK = 0.06;           // turning faster than this per frame = a flick, no slowdown
const DEAD_ANGLE = 0.004;     // closer than this (rad) the pull stops
const MAX_STEP = 0.02;        // biggest pull per frame (rad)
const AWAY_PULL = 0.15;       // pull strength while you turn away from the enemy
const FIRE_HOLD = 0.35;       // seconds after a shot the pull stays on
const SCAN_EVERY = 0.05;      // seconds between target searches

const PHONE = (typeof matchMedia === 'function' &&
               matchMedia('(hover: none) and (pointer: coarse)').matches);

let level = DEFAULT;
const custom = {};            // from aimAssist({slow,pull,cone})
try {
  const s = localStorage.getItem(KEY);
  if (NAMES.includes(s)) level = s;
} catch (e) { /* storage blocked: keep default */ }

let have = false, pyaw = 0, ppitch = 0;
let tgt = null, scanT = 0, shotT = 0, held = false;
let warned = false, seenLogged = false;
const P = { x: 0, z: 0 };
const R = { ey: 0, ep: 0, err: 0, lim: 0, zone: 0 };

// ---------- helpers ----------
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

function posOf(e) {
  if (typeof e.x === 'number' && typeof e.z === 'number') { P.x = e.x; P.z = e.z; return P; }
  const u = e.unit || e.u || e;
  const g = u.group || u.model || e.group || e.model;
  if (g && g.position) { P.x = g.position.x; P.z = g.position.z; return P; }
  return null;
}
function isDead(e) {
  return !!(e.dead || (e.unit && e.unit.dead) || e.state === 'dead' ||
            (typeof e.hp === 'number' && e.hp <= 0));
}

function values() {
  const b = LEVELS[level];
  let slow = b.slow, pull = b.pull, cone = b.cone;
  if (PHONE && level !== 'off') {
    slow = Math.max(0.2, 1 - (1 - slow) * PHONE_SLOW);
    pull *= PHONE_PULL;
    cone *= PHONE_CONE;
  }
  if (typeof custom.slow === 'number') slow = custom.slow;
  if (typeof custom.pull === 'number') pull = custom.pull;
  if (typeof custom.cone === 'number') cone = custom.cone;
  return { slow, pull, cone };
}

// angle from the crosshair to the chest of enemy e. Fills R, returns R or null.
function aimTo(p, cam, e, v) {
  const q = posOf(e);
  if (!q) return null;
  const dx = q.x - p.x, dz = q.z - p.z;
  const h = Math.hypot(dx, dz);
  if (h < MIN_D || h > MAX_D) return null;
  const ty = groundHeight(q.x, q.z) + FOOT + CHEST;
  R.ey = wrap(Math.atan2(-dx, -dz) - p.yaw);
  R.ep = Math.atan2(ty - p.y, h) - p.pitch;
  R.err = Math.hypot(R.ey, R.ep);
  const fovK = Math.max(0.4, (cam.fov || 70) / 70);        // zoomed in = smaller catch angle
  const cone = Math.min(CONE_MAX * Math.PI / 180,
                        Math.max(v.cone * Math.PI / 180, Math.atan(ZONE_R / h))) * fovK;
  R.lim = cone;
  R.zone = cone * ZONE_K;
  R.ty = ty;
  return R;
}

// is the straight line from the eye to the target free of walls and ground?
function visible(p, tx, ty, tz) {
  const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z;
  const d = Math.hypot(dx, dy, dz);
  for (let t = 1.5; t < d - 1.2; t += 1.5) {
    const f = t / d;
    const x = p.x + dx * f, y = p.y + dy * f, z = p.z + dz * f;
    if (y < groundHeight(x, z)) return false;
    if (y < WALL_TOP && blockedAt(x, z, 0.05)) return false;
  }
  return true;
}

function scan(p, cam, ctx, v) {
  tgt = null;
  const list = ctx.getEnemies ? ctx.getEnemies() : [];
  const cands = [];
  for (const e of list) {
    if (isDead(e)) continue;
    if (!posOf(e)) {
      if (!warned) { warned = true; console.warn('[aim-assist] cannot read enemy position. Fields:', Object.keys(e)); }
      continue;
    }
    const a = aimTo(p, cam, e, v);
    if (!a || a.err > a.zone) continue;
    cands.push({ e, score: a.err / a.zone });
  }
  if (!cands.length) return;
  cands.sort((a, b) => a.score - b.score);
  for (let i = 0; i < Math.min(3, cands.length); i++) {
    const e = cands[i].e;
    const q = posOf(e);
    const ty = groundHeight(q.x, q.z) + FOOT + CHEST;
    if (visible(p, q.x, ty, q.z)) {
      tgt = e;
      if (!seenLogged) {
        seenLogged = true;
        console.log('[aim-assist] first target caught at ' + Math.round(Math.hypot(q.x - p.x, q.z - p.z)) + ' m (works)');
      }
      return;
    }
  }
}

// ---------- input: is the fire button held? ----------
document.addEventListener('mousedown', (e) => { if (e.button === 0 && document.pointerLockElement) held = true; });
document.addEventListener('mouseup', (e) => { if (e.button === 0) held = false; });
window.addEventListener('blur', () => { held = false; });

// ---------- console / settings door ----------
function setLevel(l) {
  if (!NAMES.includes(l)) return false;
  level = l;
  try { localStorage.setItem(KEY, l); } catch (e) { /* ignore */ }
  tgt = null;
  return true;
}
window.campaignAim = {
  levels: NAMES.slice(),
  get: () => level,
  set: (l) => setLevel(l),
};
window.aimAssist = function (arg) {
  if (typeof arg === 'string') {
    if (!setLevel(arg)) console.log('aimAssist: use "off", "low", "medium" or "high"');
  } else if (arg && typeof arg === 'object') {
    for (const k of ['slow', 'pull', 'cone']) if (typeof arg[k] === 'number') custom[k] = arg[k];
    if (arg.reset) for (const k of ['slow', 'pull', 'cone']) delete custom[k];
  }
  const v = values();
  console.log('[aim-assist] level ' + level + ' · slow ' + v.slow.toFixed(2) + ' · pull ' + v.pull.toFixed(1) +
              ' · cone ' + v.cone.toFixed(1) + '°' + (PHONE ? ' (phone boost)' : '') +
              '  — aimAssist("off"|"low"|"medium"|"high"), aimAssist({slow, pull, cone}), aimAssist({reset:true})');
};

// ---------- extras.js module ----------
export function init(ctx) {
  console.log('[aim-assist] v1 ready: ' + level + (PHONE ? ' (phone boost)' : ''));
}

export function onEvent(name) {
  if (name === 'shot') shotT = FIRE_HOLD;
}

export function reset() {
  have = false; tgt = null; shotT = 0; held = false; scanT = 0;
}

export function update(dt, ctx) {
  const p = ctx.player, cam = ctx.camera;
  shotT = Math.max(0, shotT - dt);
  const v = values();
  const on = level !== 'off' && ctx.isPlaying() && !p.dead && v.cone > 0;
  if (!on) { have = false; tgt = null; return; }
  if (!have) { pyaw = p.yaw; ppitch = p.pitch; have = true; return; }

  const rawYaw = p.yaw, rawPitch = p.pitch;
  let dy = wrap(rawYaw - pyaw), dp = rawPitch - ppitch;
  const mag = Math.hypot(dy, dp);
  if (mag > 0.6) { pyaw = p.yaw; ppitch = p.pitch; return; }     // teleport / restart

  scanT -= dt;
  if (scanT <= 0) { scanT = SCAN_EVERY; scan(p, cam, ctx, v); }

  let a = null;
  if (tgt) {
    if (isDead(tgt)) tgt = null;
    else a = aimTo(p, cam, tgt, v);
  }

  if (a) {
    // 1) slowdown near the enemy (not for fast flicks)
    if (a.err < a.zone && mag < FLICK) {
      const f = v.slow + (1 - v.slow) * (a.err / a.zone);
      dy *= f; dp *= f;
      p.yaw = pyaw + dy;
      p.pitch = ppitch + dp;
      a = aimTo(p, cam, tgt, v);
    }
    // 2) pull toward the chest while firing
    const firing = held || shotT > 0;
    if (a && firing && v.pull > 0 && a.err < a.lim && a.err > DEAD_ANGLE) {
      let k = 1 - Math.exp(-v.pull * dt);
      if (mag > 0.002 && (dy * a.ey + dp * a.ep) < 0) k *= AWAY_PULL;
      const sy = Math.max(-MAX_STEP, Math.min(MAX_STEP, a.ey * k));
      const sp = Math.max(-MAX_STEP, Math.min(MAX_STEP, a.ep * k));
      p.yaw += sy;
      p.pitch += sp;
    }
  }

  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));

  // the camera was already placed this frame: add only the change we made
  // (adding keeps other effects, like hit shake, intact)
  cam.rotation.y += p.yaw - rawYaw;
  cam.rotation.x += p.pitch - rawPitch;

  pyaw = p.yaw; ppitch = p.pitch;
}