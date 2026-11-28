// games/campaign/collision.js
// Campaign Mode: solid world. Buildings, fences, towers, sandbags, barriers, poles and the
// pier (rails + cargo) become flat "footprint boxes". Anything on foot (player, soldiers,
// enemies) is a circle that gets pushed out of them, so you slide along walls.
// Tree trunks and rocks (registered by nature.js in treegrid.js) are solid too.
// The pier DECK is walkable: groundHeight() returns the deck height on the planks.
// v2: the concrete PADS (motor pool, helipad, apron, town square) are walkable too:
//     groundHeight() returns the slab top, so feet, soldiers and truck tyres stand ON them.
// Data only comes from layout.js. structures.js is not touched.
//
// API:
//   resolve(x, z, r)            -> {x, z}  corrected position (shared object, copy the values at once)
//   blockedAt(x, z, r)          -> true if a circle of radius r touches anything solid
//   lineClear(x1, z1, x2, z2)   -> false if a wall or trunk is between the two points (bullets / AI sight)
//   onPier(x, z)                -> true if (x, z) is over the pier deck
//   onPad(x, z)                 -> true if (x, z) is on a concrete pad
//   groundHeight(x, z)          -> terrain height, or the deck / pad top where those are higher
//   DECK_TOP                    -> height of the pier deck surface
//   createCollisionDebug(scene) -> {toggle(), setVisible(v)}  red outlines of every solid box



import * as THREE from 'three';
import { BUILDINGS, PROPS, FENCES, GATES, PIER, PADS } from './layout.js';
import { heightAt } from './terrain.js';
import { treePush, treeBlocked } from './treegrid.js';



/* ---------- Knobs (change here if something feels wrong) ---------- */
const BUILDING_GROW = 0.2;   // extra metres around every building
const TOWER_HALF = 2.0;      // watchtower footprint is (2 * this) metres square
const SANDBAG_THICK = 1.0;
const BARRIER_THICK = 0.8;
const FENCE_THICK = 0.6;
const POLE_HALF = 0.35;      // flagpole / windsock
const RAIL_HALF = 0.15;      // pier rail thickness / 2
const PAD_TOP = 0.3;         // slab top above the ground at its centre (matches structures.js)
const PAD_RAMP = 0.4;        // metres outside the slab edge where the ground rises smoothly (no hard pop)



// Must match the deck in structures.js (box centre 1.2, thickness 0.4 -> top = 1.4)
export const DECK_TOP = 1.4;



/* ---------- Build the boxes ---------- */
// Box: centre (x, z), local axes (c, s) = cos/sin of rot, half sizes hx / hz, rad = bounding radius.
const BOXES = [];



function addBoxCS(x, z, c, s, hx, hz, tag, baseY) {
  BOXES.push({ x, z, c, s, hx, hz, rad: Math.hypot(hx, hz), tag, baseY });
}
function addBox(x, z, rot, hx, hz, tag, baseY) {
  addBoxCS(x, z, Math.cos(rot), Math.sin(rot), hx, hz, tag, baseY);
}



// Buildings (same rotation rule as labelAt: local X = width, local Z = depth)
for (const b of BUILDINGS) {
  addBox(b.x, b.z, b.rot, b.w / 2 + BUILDING_GROW, b.d / 2 + BUILDING_GROW, b.name);
}



// Props
for (const p of PROPS) {
  switch (p.type) {
    case 'watchtower':
      addBox(p.x, p.z, p.rot, TOWER_HALF, TOWER_HALF, 'watchtower');
      break;
    case 'sandbags':
      addBox(p.x, p.z, p.rot, (p.len || 4) / 2, SANDBAG_THICK / 2, 'sandbags');
      break;
    case 'barrier':
      addBox(p.x, p.z, p.rot, (p.len || 4) / 2, BARRIER_THICK / 2, 'barrier');
      break;
    case 'flagpole':
    case 'windsock':
      addBox(p.x, p.z, 0, POLE_HALF, POLE_HALF, p.type);
      break;
  }
}



// Fences: each side of the outline is cut open where a gate sits
const gateById = new Map(GATES.map((g) => [g.id, g]));
for (const f of FENCES) {
  const pts = f.points;
  for (let i = 0; i < pts.length; i++) {
    const A = pts[i], B = pts[(i + 1) % pts.length];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (len < 0.01) continue;
    const ux = (B[0] - A[0]) / len, uz = (B[1] - A[1]) / len;



    // gaps (in metres along this side)
    const gaps = [];
    for (const id of f.gates || []) {
      const g = gateById.get(id);
      if (!g) continue;
      const gx = g.x - A[0], gz = g.z - A[1];
      const t = gx * ux + gz * uz;                 // along the side
      const off = Math.abs(gx * uz - gz * ux);     // distance from the side
      if (off < 3 && t > -g.width && t < len + g.width) {
        gaps.push([t - g.width / 2, t + g.width / 2]);
      }
    }
    gaps.sort((a, b) => a[0] - b[0]);



    // solid pieces between the gaps
    let cursor = 0;
    const pieces = [];
    for (const [g0, g1] of gaps) {
      if (g0 > cursor) pieces.push([cursor, Math.min(g0, len)]);
      cursor = Math.max(cursor, g1);
    }
    if (cursor < len) pieces.push([cursor, len]);



    for (const [t0, t1] of pieces) {
      if (t1 - t0 < 0.05) continue;
      const mid = (t0 + t1) / 2;
      // local X must run along the side: world of local X = (c, -s) = (ux, uz)
      addBoxCS(A[0] + ux * mid, A[1] + uz * mid, ux, -uz, (t1 - t0) / 2, FENCE_THICK / 2, 'fence');
    }
  }
}



/* ---------- Pier: walkable deck, solid rails and cargo ---------- */
const PIER_L = PIER ? (PIER.length ?? 36) : 0;
const PIER_W = PIER ? (PIER.width ?? 6) : 0;
const pierC = PIER ? Math.cos(PIER.rot ?? 0) : 1;
const pierS = PIER ? Math.sin(PIER.rot ?? 0) : 0;



if (PIER) {
  // local (lx across the deck, lz along it) -> world, same rule as makeFrame in structures.js
  const wx = (lx, lz) => PIER.x + lx * pierC + lz * pierS;
  const wz = (lx, lz) => PIER.z - lx * pierS + lz * pierC;
  const rot = PIER.rot ?? 0;



  // rails on both sides, the whole length
  for (const side of [-1, 1]) {
    const lx = side * (PIER_W / 2 - 0.1);
    addBox(wx(lx, 0), wz(lx, 0), rot, RAIL_HALF, PIER_L / 2, 'pier rail', DECK_TOP);
  }
  // cargo near the land end (crates left, barrels right)
  const z0 = -PIER_L / 2;
  const crateHalf = 0.65 + 0.1;
  for (const dz of [4, 5.4]) {
    addBox(wx(-1.4, z0 + dz), wz(-1.4, z0 + dz), rot, crateHalf, crateHalf, 'pier crate', DECK_TOP);
  }
  const barrelHalf = 0.45;
  for (const dz of [4, 5.2]) {
    addBox(wx(1.4, z0 + dz), wz(1.4, z0 + dz), rot, barrelHalf, barrelHalf, 'pier barrel', DECK_TOP);
  }
}



// True if (x, z) is over the pier deck planks
export function onPier(x, z) {
  if (!PIER) return false;
  const dx = x - PIER.x, dz = z - PIER.z;
  const lx = dx * pierC - dz * pierS;
  const lz = dx * pierS + dz * pierC;
  return Math.abs(lx) <= PIER_W / 2 && Math.abs(lz) <= PIER_L / 2;
}



/* ---------- Pads: the slab top is ground (at the pad centre) + PAD_TOP ---------- */
// Same maths as structures.js: pad frame rotated by p.rot, slab box w x d or a cylinder of radius r.
const PAD_LIST = (PADS || []).map((p) => {
  const circle = String(p.shape ?? '').toLowerCase().includes('circ') || (p.r != null && p.w == null);
  const rot = p.rot ?? 0;
  return {
    id: p.id, x: p.x, z: p.z,
    c: Math.cos(rot), s: Math.sin(rot),
    circle,
    r: p.r ?? 5,
    hw: (p.w ?? 10) / 2,
    hd: (p.d ?? 10) / 2,
    top: heightAt(p.x, p.z) + PAD_TOP
  };
});



// Distance from (x, z) to the slab edge: 0 or less = on it, bigger = outside
function padEdgeDist(p, x, z) {
  const dx = x - p.x, dz = z - p.z;
  if (p.circle) return Math.hypot(dx, dz) - p.r;
  const lx = dx * p.c - dz * p.s;
  const lz = dx * p.s + dz * p.c;
  const ox = Math.abs(lx) - p.hw, oz = Math.abs(lz) - p.hd;
  if (ox <= 0 && oz <= 0) return Math.max(ox, oz);
  return Math.hypot(Math.max(ox, 0), Math.max(oz, 0));
}



// True if (x, z) is on a concrete pad
export function onPad(x, z) {
  for (const p of PAD_LIST) if (padEdgeDist(p, x, z) <= 0) return true;
  return false;
}



// Height you stand at: terrain, the pier deck, or a pad slab (whichever is highest).
// Just outside a pad edge the ground rises over PAD_RAMP metres, so driving or walking up is smooth.
export function groundHeight(x, z) {
  const h = heightAt(x, z);
  let best = h;
  if (PIER && onPier(x, z)) best = Math.max(best, DECK_TOP);
  for (const p of PAD_LIST) {
    const d = padEdgeDist(p, x, z);
    if (d > PAD_RAMP) continue;
    if (d <= 0) {
      if (p.top > best) best = p.top;
    } else {
      const v = h + (p.top - h) * (1 - d / PAD_RAMP);
      if (v > best) best = v;
    }
  }
  return best;
}



/* ---------- Queries ---------- */
const out = { x: 0, z: 0 };
const treeTmp = { x: 0, z: 0 };



// Push a circle (x, z, r) out of every solid box and every trunk / rock. Returns a shared object.
export function resolve(x, z, r = 0.45) {
  for (let it = 0; it < 3; it++) {
    let moved = false;
    for (const b of BOXES) {
      const dx = x - b.x, dz = z - b.z;
      const reach = b.rad + r;
      if (dx * dx + dz * dz > reach * reach) continue;



      const lx = dx * b.c - dz * b.s;
      const lz = dx * b.s + dz * b.c;
      const cx = Math.max(-b.hx, Math.min(b.hx, lx));
      const cz = Math.max(-b.hz, Math.min(b.hz, lz));
      const nx = lx - cx, nz = lz - cz;
      const d2 = nx * nx + nz * nz;



      let px, pz;
      if (d2 > 1e-8) {
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2);
        const push = r - d;
        px = (nx / d) * push;
        pz = (nz / d) * push;
      } else {
        // centre is inside the box: leave through the nearest face
        const ox = b.hx - Math.abs(lx), oz = b.hz - Math.abs(lz);
        if (ox < oz) { px = (lx >= 0 ? 1 : -1) * (ox + r); pz = 0; }
        else { pz = (lz >= 0 ? 1 : -1) * (oz + r); px = 0; }
      }
      x += px * b.c + pz * b.s;
      z += -px * b.s + pz * b.c;
      moved = true;
    }



    // trunks and rocks
    treePush(x, z, r, treeTmp);
    if (treeTmp.x !== x || treeTmp.z !== z) {
      x = treeTmp.x; z = treeTmp.z;
      moved = true;
    }



    if (!moved) break;
  }
  out.x = x;
  out.z = z;
  return out;
}



export function blockedAt(x, z, r = 0.45) {
  for (const b of BOXES) {
    const dx = x - b.x, dz = z - b.z;
    const reach = b.rad + r;
    if (dx * dx + dz * dz > reach * reach) continue;
    const lx = dx * b.c - dz * b.s;
    const lz = dx * b.s + dz * b.c;
    const cx = Math.max(-b.hx, Math.min(b.hx, lx));
    const cz = Math.max(-b.hz, Math.min(b.hz, lz));
    const nx = lx - cx, nz = lz - cz;
    if (nx * nx + nz * nz < r * r) return true;
  }
  return treeBlocked(x, z, r);      // trunks and rocks
}



// True if nothing solid lies on the straight line (for shooting and AI sight)
export function lineClear(x1, z1, x2, z2) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const steps = Math.max(1, Math.ceil(len / 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (blockedAt(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, 0.05)) return false;
  }
  return true;
}



/* ---------- Debug outlines (press B in the game to see every solid box) ---------- */
// Shows buildings, fences and props. Trunks and rocks are not drawn (there are thousands).
export function createCollisionDebug(scene) {
  const verts = [];
  const seg = (a, b) => verts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  for (const b of BOXES) {
    const corners = [[-b.hx, -b.hz], [b.hx, -b.hz], [b.hx, b.hz], [-b.hx, b.hz]].map(([lx, lz]) => {
      const wx = b.x + lx * b.c + lz * b.s;
      const wz = b.z - lx * b.s + lz * b.c;
      return [wx, b.baseY !== undefined ? b.baseY : heightAt(wx, wz), wz];
    });
    for (let i = 0; i < 4; i++) {
      const p = corners[i], q = corners[(i + 1) % 4];
      seg([p[0], p[1] + 0.2, p[2]], [q[0], q[1] + 0.2, q[2]]);
      seg([p[0], p[1] + 2.2, p[2]], [q[0], q[1] + 2.2, q[2]]);
      seg([p[0], p[1] + 0.2, p[2]], [p[0], p[1] + 2.2, p[2]]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xff3030, depthTest: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = 999;
  lines.visible = false;
  lines.frustumCulled = false;
  scene.add(lines);
  return {
    setVisible(v) { lines.visible = !!v; },
    toggle() { lines.visible = !lines.visible; return lines.visible; }
  };
}



console.log(`[collision] v2: ${BOXES.length} solid boxes` + (PIER ? ' (pier included)' : ' (no pier found)') + ` + ${PAD_LIST.length} walkable pads + trunks and rocks from treegrid.js`);