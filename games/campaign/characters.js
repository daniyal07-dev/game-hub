// games/campaign/characters.js
// Campaign Mode: real human characters for the RTS.
//   team  = swat.glb       (our soldiers)
//   enemy = spacesuit.glb  (the "Space Gang" terrorists)
// Each .glb is loaded ONCE and cloned for every soldier (SkeletonUtils), so memory stays small.
// Both models share the same 24 clips (Quaternius rig). Clips are picked by exact name first,
// then by name pattern. The Console prints every clip, the chosen clip per role, mesh sizes and hand bones.
// War mode is not touched: the files are loaded from the shared root models/ folder.
//
// API:
//   loadCharacters()                       -> Promise (loads both models once)
//   spawnCharacter('team'|'enemy', scene)  -> unit or null (null if not loaded yet)
//   unit.setPose(x, z, heading, y?)        heading 0 = facing +Z (south). y defaults to the ground + FOOT_LIFT.
//   unit.play('idle'|'walk'|'run')         looping movement state
//   unit.fire()  unit.hit()                one-shot (shoot / run-shoot, hit reaction)
//   unit.die()   unit.revive()
//   removeCharacter(unit, scene)
//   updateCharacters(dt)                   call once per frame (also drives the debug squad)
//   toggleDebugSquad(scene, px, pz, yaw)   shows/hides 3 team + 3 enemy cycling through the clips


import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { groundHeight } from './collision.js';


/* ---------- Knobs ---------- */
const FILES = { swat: '../models/swat.glb', spacesuit: '../models/spacesuit.glb' };
const KIND_KEY = { team: 'swat', enemy: 'spacesuit' };
const HEIGHT = { swat: 1.8, spacesuit: 1.8 };       // standing height in metres
const FACING_FIX = { swat: 0, spacesuit: 0 };       // if a model walks backwards, set it to Math.PI
const TINT = { swat: null, spacesuit: null };       // e.g. 0xb8c4a0 multiplies the colour, null = original
const HIDE_MESHES = { swat: null, spacesuit: null };// e.g. /^Cube023(_\d+)?$/ hides a built-in weapon (name from the 🔫 log)
const FOOT_LIFT = 0.15;                             // metres above the terrain (roads are paved slightly above it)
const SHADOWS = true;                               // false = soldiers cast no shadow (test for FPS)
const FADE = 0.2;                                   // seconds to blend between clips
const SHOT_TIME = 0.6;                              // longest one-shot shoot animation
const HIT_TIME = 0.5;                               // longest hit reaction


/* ---------- Clip finding ---------- */
// Exact names first (case-insensitive). Change the order here to swap a clip.
const EXACT = {
  idle:     ['Idle_Gun', 'Idle'],
  walk:     ['Walk'],
  run:      ['Run'],
  shoot:    ['Idle_Gun_Shoot', 'Gun_Shoot'],
  runshoot: ['Run_Shoot'],
  death:    ['Death'],
  hit:      ['HitRecieve', 'HitReceive', 'HitRecieve_2']
};


// Pattern fallback if an exact name is missing in another model
const NOT_BASE = /shoot|fire|attack|punch|kick|sword|death|die|dead|hit|react|duck|roll|wave|interact|carry|back|left|right/i;
const FREE_ROLES = new Set(['shoot', 'runshoot', 'death', 'hit']);   // these may match NOT_BASE words
const PREFS = {
  idle:     [/idle.*gun|gun.*idle/i, /^idle$/i, /idle/i, /stand|breath|wait/i],
  walk:     [/walk/i],
  run:      [/run|sprint|jog/i],
  shoot:    [/idle.*(shoot|fire)|(shoot|fire).*idle/i, /^(?!.*(run|walk)).*(shoot|fire)/i, /shoot|fire/i, /attack|punch/i],
  runshoot: [/run.*(shoot|fire)/i],
  death:    [/death|die|dead|dying/i],
  hit:      [/hit|react|damage/i]
};


function pick(clips, role) {
  const named = clips.filter((c) => c.name);               // skip unnamed clips
  for (const nm of EXACT[role] || []) {
    const c = named.find((k) => k.name.toLowerCase() === nm.toLowerCase());
    if (c) return c;
  }
  for (const re of PREFS[role]) {
    const list = named.filter((c) => re.test(c.name) && (FREE_ROLES.has(role) || !NOT_BASE.test(c.name)));
    if (list.length) return list.sort((a, b) => a.name.length - b.name.length)[0];
  }
  return null;
}


/* ---------- Loading (once per model) ---------- */
const templates = {};
let loadPromise = null;
const loader = new GLTFLoader();


function loadOne(key) {
  return new Promise((resolve) => {
    loader.load(
      FILES[key],
      (gltf) => {
        const root = gltf.scene;
        const meshNames = [];
        root.traverse((o) => {
          if (o.isMesh || o.isSkinnedMesh) {
            meshNames.push(o.name || '(unnamed)');
            if (HIDE_MESHES[key] && HIDE_MESHES[key].test(o.name || '')) o.visible = false;
          }
        });


        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const h = box.max.y - box.min.y;
        let scale = 1;
        if (h > 0.001) scale = HEIGHT[key] / h;
        else console.warn(`[characters] ${key}: could not measure height, using scale 1`);


        root.traverse((o) => {
          if (o.isMesh || o.isSkinnedMesh) {
            o.castShadow = SHADOWS;
            o.frustumCulled = false;     // skinned meshes can vanish at screen edges otherwise
            if (TINT[key] != null && o.material) {
              const mats = Array.isArray(o.material) ? o.material : [o.material];
              for (const m of mats) if (m.color) m.color.multiply(new THREE.Color(TINT[key]));
            }
          }
        });


        const clips = gltf.animations || [];
        const picks = {};
        for (const role of Object.keys(PREFS)) picks[role] = pick(clips, role);


        templates[key] = {
          root, scale, clips, picks,
          offX: -((box.min.x + box.max.x) / 2) * scale,
          offY: -box.min.y * scale,
          offZ: -((box.min.z + box.max.z) / 2) * scale
        };


        console.log(`🧍 [characters] ${key}: raw height ${h.toFixed(2)} m, scale ${scale.toFixed(3)}, ${clips.length} clips`);
        console.log(`🎞 [characters] ${key} clips: ` + (clips.map((c) => `${c.name || '(no name)'} (${c.duration.toFixed(2)}s)`).join(', ') || 'NONE'));
        console.log(`🎯 [characters] ${key} chosen: ` + Object.entries(picks).map(([r, c]) => `${r}=${c ? c.name : '-'}`).join('  '));
        console.log(`🧩 [characters] ${key} meshes: ` + meshNames.join(', '));
        logMeshInfo(key, root, scale);
        resolve(true);
      },
      undefined,
      (err) => {
        console.error(`[characters] could not load ${FILES[key]}`, err);
        resolve(false);
      }
    );
  });
}


// Prints every mesh with its size in metres (smallest first) and the hand bones.
// A built-in weapon is a very small mesh. Use its name in HIDE_MESHES to hide it.
function logMeshInfo(key, root, scale) {
  try {
    root.updateMatrixWorld(true);
    const rows = [];
    const bones = [];
    root.traverse((o) => {
      if (o.isBone) bones.push(o.name);
      if (o.isMesh || o.isSkinnedMesh) {
        const b = new THREE.Box3().setFromObject(o);
        const s = b.getSize(new THREE.Vector3()).multiplyScalar(scale);
        rows.push({
          name: o.name || '(unnamed)',
          vol: s.x * s.y * s.z,
          text: `${o.name || '(unnamed)'} ${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)}m` +
                ` parent=${o.parent ? o.parent.name || '(none)' : '-'}${o.isSkinnedMesh ? ' skinned' : ''}`
        });
      }
    });
    rows.sort((a, b) => a.vol - b.vol);
    console.log(`🔫 [characters] ${key} meshes by size (smallest first):\n` + rows.map((r) => '  ' + r.text).join('\n'));
    const hands = bones.filter((n) => /hand|wrist|palm|finger|weapon|hold|grip|gun/i.test(n));
    console.log(`🦴 [characters] ${key}: ${bones.length} bones. Hand-like bones: ${hands.join(', ') || 'none found'}`);
  } catch (e) {
    console.warn('[characters] mesh info failed', e);
  }
}


export function loadCharacters() {
  if (!loadPromise) loadPromise = Promise.all(Object.keys(FILES).map(loadOne));
  return loadPromise;
}


/* ---------- Units ---------- */
const ALL = new Set();
const FALLBACK = {
  idle: [], walk: ['run', 'idle'], run: ['walk', 'idle'],
  shoot: ['idle'], runshoot: ['shoot', 'run'], hit: ['idle'], death: []
};


class Unit {
  constructor(kind, key, t) {
    this.kind = kind;
    this.key = key;
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    const holder = new THREE.Group();
    holder.scale.setScalar(t.scale);
    holder.position.set(t.offX, t.offY, t.offZ);
    this.model = SkeletonUtils.clone(t.root);
    holder.add(this.model);
    this.body.add(holder);
    this.group.add(this.body);


    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const role of Object.keys(t.picks)) {
      const clip = t.picks[role];
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      if (role === 'death') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[role] = a;
    }
    this.current = null;
    this.state = 'idle';
    this.dead = false;
    this.lockT = 0;                 // > 0 while a one-shot (shoot / hit) is playing
    this.fall = 0;
    this.x = 0; this.z = 0; this.heading = 0;
    this.play('idle');
  }


  setPose(x, z, heading, y) {
    this.x = x; this.z = z; this.heading = heading;
    this.group.position.set(x, y !== undefined ? y : groundHeight(x, z) + FOOT_LIFT, z);
    this.group.rotation.y = heading + FACING_FIX[this.key];
  }


  _apply(name, force = false) {
    let act = this.actions[name];
    if (!act) {
      for (const f of FALLBACK[name] || []) if (this.actions[f]) { act = this.actions[f]; break; }
    }
    if (!act) return;
    if (act === this.current && !force) return;
    act.reset().fadeIn(FADE).play();
    if (this.current && this.current !== act) this.current.fadeOut(FADE);
    this.current = act;
  }


  play(name) {
    this.state = name;
    if (this.dead || this.lockT > 0) return;
    this._apply(name);
  }


  _oneShot(role, maxT) {
    const a = this.actions[role] || (FALLBACK[role] || []).map((r) => this.actions[r]).find(Boolean);
    if (!a) return false;
    this.lockT = Math.min(a.getClip().duration, maxT);
    this._apply(role, true);
    return true;
  }


  fire() {
    if (this.dead) return false;
    const moving = this.state === 'run' || this.state === 'walk';
    return this._oneShot(moving && this.actions.runshoot ? 'runshoot' : 'shoot', SHOT_TIME);
  }


  hit() {
    if (this.dead) return false;
    return this._oneShot('hit', HIT_TIME);
  }


  die() {
    if (this.dead) return;
    this.dead = true;
    this.lockT = 0;
    if (this.actions.death) this._apply('death', true);
    else {
      this.fall = 0;
      if (this.current) { this.current.fadeOut(FADE); this.current = null; }
    }
  }


  revive() {
    if (!this.dead) return;
    this.dead = false;
    this.fall = 0;
    this.body.rotation.x = 0;
    this.body.position.y = 0;
    if (this.current) { this.current.fadeOut(FADE); this.current = null; }
    this._apply(this.state, true);
  }


  update(dt) {
    this.mixer.update(dt);
    if (this.lockT > 0) {
      this.lockT -= dt;
      if (this.lockT <= 0) { this.lockT = 0; if (!this.dead) this._apply(this.state, true); }
    }
    // only if a model had no death clip: fall over backwards
    if (this.dead && !this.actions.death && this.fall < 1) {
      this.fall = Math.min(1, this.fall + dt / 0.6);
      const e = this.fall * this.fall;
      this.body.rotation.x = -e * Math.PI / 2;
      this.body.position.y = 0.12 * e;
    }
  }
}


export function spawnCharacter(kind, scene) {
  const key = KIND_KEY[kind] || kind;
  const t = templates[key];
  if (!t) return null;
  const u = new Unit(kind, key, t);
  ALL.add(u);
  if (scene) scene.add(u.group);
  return u;
}


export function removeCharacter(unit, scene) {
  if (!unit) return;
  ALL.delete(unit);
  unit.mixer.stopAllAction();
  unit.mixer.uncacheRoot(unit.model);
  if (unit.group.parent) unit.group.parent.remove(unit.group);
  else if (scene) scene.remove(unit.group);
}


export function updateCharacters(dt) {
  for (const u of ALL) u.update(dt);
  updateDebugSquad(dt);
}


/* ---------- Debug squad (key from main.js) ---------- */
const SEQ = ['idle', 'walk', 'run', 'shoot', 'hit', 'death'];
let dbg = null;


export function toggleDebugSquad(scene, px, pz, yaw) {
  if (dbg) {
    for (const u of dbg.units) removeCharacter(u, scene);
    dbg = null;
    console.log('[characters] debug squad OFF');
    return false;
  }
  if (!templates.swat && !templates.spacesuit) {
    console.warn('[characters] models are not loaded yet (or failed). Wait a moment and try again.');
    return false;
  }
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);     // where the player looks
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);      // player's right
  const units = [];
  let n = 0;
  for (const [kind, side] of [['team', -1], ['enemy', 1]]) {
    for (let row = 0; row < 3; row++) {
      const u = spawnCharacter(kind, scene);
      if (!u) continue;
      const x = px + fx * (7 + row * 2.2) + rx * side * 2;
      const z = pz + fz * (7 + row * 2.2) + rz * side * 2;
      u.setPose(x, z, Math.atan2(px - x, pz - z));    // face the player
      u.dbgIndex = n++;
      units.push(u);
    }
  }
  dbg = { units, step: 0, t: 0, fresh: true };
  console.log('[characters] debug squad ON: left = team (swat), right = enemy (spacesuit). Cycle: ' + SEQ.join(', '));
  return true;
}


function updateDebugSquad(dt) {
  if (!dbg) return;
  if (!dbg.fresh) {
    dbg.t += dt;
    if (dbg.t < 2.5) return;
    dbg.t = 0;
    dbg.step++;
  }
  dbg.fresh = false;
  for (const u of dbg.units) {
    const name = SEQ[(dbg.step + u.dbgIndex) % SEQ.length];
    if (name === 'death') { u.die(); continue; }
    if (u.dead) u.revive();
    if (name === 'shoot') { u.play('idle'); u.fire(); }
    else if (name === 'hit') { u.play('idle'); u.hit(); }
    else u.play(name);
  }
}