// games/campaign/layout.js
// Campaign Mode: ONE shared source of truth for the whole map.
// Places, gates (entry points), fences, named buildings, props, roads, runway, pier.
// structures.js builds the meshes from this, nature.js keeps trees away from it.
//
// Compass used everywhere:  north = -z,  south = +z,  east = +x,  west = -x.
// Building rule: w runs along the building's local X, d along local Z, and the FRONT
// (door + sign) is the local +Z side. rot = the direction the front faces (see FACE).

import * as THREE from 'three';
import { heightAt } from './terrain.js';

/* ---------- Model files (inside games/campaign/models/) ---------- */
// Extension is ignored by assets.js (.glb is tried first, then .gltf).
export const MODELS = {
  trees: ['tree_pineDefaultA.glb', 'tree_pineDefaultB.glb', 'tree_pineGroundA.glb', 'tree_pineGroundB.glb'],
  rocks: ['rock_largeA.glb', 'rock_largeB.glb', 'rock_largeC.glb', 'rock_largeD.glb'],
  houses: [
    'building-type-a.glb', 'building-type-b.glb', 'building-type-c.glb',
    'building-type-d.glb', 'building-type-e.glb', 'building-type-f.glb'
  ]
};

/* ---------- Facing directions (value for rot) ---------- */
export const FACE = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };

/* ======================================================================
   AIRFIELD FRAME: everything is placed along the runway (u = along it,
   v = distance to its north side), then converted to world x/z.
   ====================================================================== */
const RW_A = [-125, 138];
const RW_B = [25, 190];
const RW_LEN = Math.hypot(RW_B[0] - RW_A[0], RW_B[1] - RW_A[1]);
const EX = (RW_B[0] - RW_A[0]) / RW_LEN;   // runway direction
const EZ = (RW_B[1] - RW_A[1]) / RW_LEN;
const NX = EZ, NZ = -EX;                   // runway "north" side normal

export function airPoint(u, v) {
  return [RW_A[0] + EX * u + NX * v, RW_A[1] + EZ * u + NZ * v];
}
const ap = airPoint;
const AIR_ROT = -Math.atan2(EZ, EX);       // front of the building faces the runway
const AIR_ROAD_ROT = AIR_ROT + Math.PI / 2; // gate whose road runs along the runway

// Runway number from its compass heading (about 110 degrees -> "11" and "29")
const HDG = Math.round((((Math.atan2(EX, -EZ) * 180) / Math.PI + 360) % 360) / 10);
const pad2 = (n) => String(n).padStart(2, '0');

/* ---------- Runway (24 m wide, perfectly straight) ---------- */
export const RUNWAY = {
  id: 'runway',
  width: 24,
  length: RW_LEN,
  points: [RW_A, [(RW_A[0] + RW_B[0]) / 2, (RW_A[1] + RW_B[1]) / 2], RW_B],
  numbers: { start: pad2(HDG), end: pad2(((HDG + 18 - 1) % 36) + 1) }
};

/* ======================================================================
   HARBOR: find the real shoreline east of the town and place the pier there
   ====================================================================== */
const HARBOR_Q = [174, 83];                       // where the harbor road leaves Main Street
const HARBOR_ANGLE = Math.PI / 6;                 // 30 degrees (towards the sea)
const HDX = Math.cos(HARBOR_ANGLE), HDZ = Math.sin(HARBOR_ANGLE);
const alongHarbor = (t) => [HARBOR_Q[0] + HDX * t, HARBOR_Q[1] + HDZ * t];

function findPier() {
  for (let t = 30; t < 600; t += 2) {
    const [x, z] = alongHarbor(t);
    const [x2, z2] = alongHarbor(t + 10);
    if (heightAt(x, z) < 0.3 && heightAt(x2, z2) < 0.3) {
      const landT = t - 8;           // road ends here
      const startT = t - 6;          // pier starts 6 m on land
      const length = 36;
      const [cx, cz] = alongHarbor(startT + length / 2);
      const [lx, lz] = alongHarbor(landT);
      return {
        x: cx, z: cz, rot: Math.atan2(HDX, HDZ), length, width: 6,
        dir: [HDX, HDZ], landX: lx, landZ: lz, landT, shoreT: t
      };
    }
  }
  console.warn('[layout] shoreline not found, no pier / harbor road');
  return null;
}
export const PIER = findPier();
if (PIER) console.log(`[layout] pier at x=${PIER.x.toFixed(0)}, z=${PIER.z.toFixed(0)}, landing at x=${PIER.landX.toFixed(0)}, z=${PIER.landZ.toFixed(0)}`);

const harborPts = [];
if (PIER) {
  for (let t = 32; t < PIER.landT - 20; t += 30) harborPts.push(alongHarbor(t));
  harborPts.push([PIER.landX, PIER.landZ]);
}

/* ======================================================================
   ROADS (x, z control points). Side roads end 0.25 m inside the main road
   so there is no gap and no overlapping paint.
   ====================================================================== */
export const ROADS = [
  // Base Main Street -> Main Gate -> valley -> Port Town West Checkpoint
  // -> Town Main Street -> East Barricade -> Harbor Landing
  {
    id: 'base-town-harbor',
    width: 7.5,
    points: [
      [-176, -110], [-140, -110], [-100, -110], [-86, -106], [-60, -72],
      [-10, -15], [20, 12], [40, 40], [52, 66], [64, 78],
      [78, 80], [100, 80], [120, 80], [140, 80], [160, 80], [174, 83],
      ...harborPts
    ]
  },
  // Base Rear Gate -> Airfield West Gate
  {
    id: 'base-airfield',
    width: 7.5,
    points: [
      [-140, -106.5], [-140, -70], [-143, -40], [-146, -10], [-143, 35],
      [-141, 72], [-140, 96], ap(-14, 22), ap(0, 22), ap(22, 22)
    ]
  },
  // Airfield East Gate -> Port Town South Checkpoint -> Market Street
  {
    id: 'airfield-town',
    width: 7.5,
    points: [
      ap(138, 22), ap(160, 22), ap(176, 22), [78, 168], [100, 152],
      [113, 135], [119, 120], [120, 100], [120, 83.5]
    ]
  }
];

/* ======================================================================
   PLACES (for the HUD and for missions later)
   ====================================================================== */
export const PLACES = {
  base:     { id: 'base',     name: 'STRIKE COMMAND BASE', faction: 'friendly', cx: -140, cz: -110, entries: ['base-main', 'base-rear'] },
  airfield: { id: 'airfield', name: 'AIRFIELD',            faction: 'friendly', cx: ap(80, 10)[0], cz: ap(80, 10)[1], entries: ['air-west', 'air-east'] },
  town:     { id: 'town',     name: 'PORT TOWN',           faction: 'hostile',  cx: 120, cz: 80, entries: ['town-west', 'town-south', 'town-east', 'harbor-landing'] }
};

/* ======================================================================
   GATES = the entry points. width = opening in metres.
   rot = rotation so the road runs along the gate's local Z.
   ====================================================================== */
export const GATES = [
  // Base
  { id: 'base-main', place: 'base', name: 'MAIN GATE', kind: 'gate', x: -100, z: -110, rot: FACE.E, width: 10, fence: 'base-fence' },
  { id: 'base-rear', place: 'base', name: 'REAR GATE', kind: 'gate', x: -140, z: -70, rot: FACE.S, width: 10, fence: 'base-fence' },
  // Airfield
  { id: 'air-west', place: 'airfield', name: 'WEST GATE', kind: 'gate', x: ap(0, 22)[0], z: ap(0, 22)[1], rot: AIR_ROAD_ROT, width: 10, fence: 'airfield-fence' },
  { id: 'air-east', place: 'airfield', name: 'EAST GATE', kind: 'gate', x: ap(160, 22)[0], z: ap(160, 22)[1], rot: AIR_ROAD_ROT, width: 10, fence: 'airfield-fence' },
  // Port Town (enemy held)
  { id: 'town-west',  place: 'town', name: 'WEST CHECKPOINT',  kind: 'checkpoint', x: 80,  z: 80,  rot: FACE.E, width: 10 },
  { id: 'town-south', place: 'town', name: 'SOUTH CHECKPOINT', kind: 'checkpoint', x: 120, z: 116, rot: FACE.S, width: 10 },
  { id: 'town-east',  place: 'town', name: 'EAST BARRICADE',   kind: 'barricade',  x: 160, z: 80,  rot: FACE.E, width: 10 }
];
if (PIER) {
  GATES.push({
    id: 'harbor-landing', place: 'town', name: 'HARBOR LANDING', kind: 'landing',
    x: PIER.landX, z: PIER.landZ, rot: PIER.rot, width: 10
  });
}

/* ======================================================================
   FENCES (closed outlines). Gaps are cut at the gates listed.
   ====================================================================== */
export const FENCES = [
  {
    id: 'base-fence', place: 'base', height: 3,
    points: [[-180, -150], [-100, -150], [-100, -70], [-180, -70]],
    gates: ['base-main', 'base-rear']
  },
  {
    id: 'airfield-fence', place: 'airfield', height: 3,
    points: [ap(0, -26), ap(160, -26), ap(160, 56), ap(0, 56)],
    gates: ['air-west', 'air-east']
  }
];

/* ======================================================================
   PADS: flat concrete areas (below the road surface)
   ====================================================================== */
export const PADS = [
  { id: 'apron',      place: 'airfield', name: 'APRON',       shape: 'rect',   x: ap(80, 22)[0], z: ap(80, 22)[1], w: 120, d: 20, rot: AIR_ROT },
  { id: 'motorpool',  place: 'base',     name: 'MOTOR POOL',  shape: 'rect',   x: -122, z: -93, w: 18, d: 16, rot: 0 },
  { id: 'helipad',    place: 'base',     name: 'HELIPAD',     shape: 'circle', x: -106.5, z: -90, r: 5.5 },
  { id: 'town-square', place: 'town',    name: 'TOWN SQUARE', shape: 'rect',   x: 120, z: 80, w: 20, d: 20, rot: 0 }
];

/* ======================================================================
   BUILDINGS (named). type tells structures.js which shape to build.
   Houses (type 'house') use the Kenney models; w = target width in metres.
   ====================================================================== */
function B(id, place, name, type, x, z, rot, w, d, h, extra = {}) {
  return { id, place, name, type, x, z, rot, w, d, h, ...extra };
}
function BA(id, name, type, u, v, w, d, h, extra = {}) {
  const [x, z] = airPoint(u, v);
  return B(id, 'airfield', name, type, x, z, AIR_ROT, w, d, h, extra);
}
function HOUSE(n, x, z, rot, variant) {
  return B('house-' + n, 'town', 'RESIDENCE ' + n, 'house', x, z, rot, 11, 11, 7, { variant });
}

export const BUILDINGS = [
  /* ---- STRIKE COMMAND BASE (fence x -180..-100, z -150..-70, Main Street at z = -110) ---- */
  B('base-hq',        'base', 'COMMAND HQ',    'hq',       -140, -126, FACE.S, 30, 16, 8,  { color: 0x6f8460 }),
  B('base-mess',      'base', 'MESS HALL',     'mess',     -169, -124, FACE.S, 14, 12, 5,  { color: 0x8a8f78 }),
  B('base-armory',    'base', 'ARMORY',        'armory',   -112, -124, FACE.S, 14, 12, 5,  { color: 0x6b7078 }),
  B('base-radar',     'base', 'RADAR STATION', 'radar',    -168, -142, FACE.S, 6,  6,  16, { color: 0x58626d }),
  B('base-barracks-a','base', 'BARRACKS A',    'barracks', -162, -97,  FACE.N, 24, 10, 5,  { color: 0x7a8a6a }),
  B('base-barracks-b','base', 'BARRACKS B',    'barracks', -162, -82,  FACE.N, 24, 10, 5,  { color: 0x7a8a6a }),
  B('base-garage',    'base', 'MOTOR POOL',    'garage',   -122, -80,  FACE.N, 20, 8,  5,  { color: 0x6f7780 }),

  /* ---- AIRFIELD (north of the runway, all facing the runway) ---- */
  BA('air-hangar-1', 'HANGAR 1',      'hangar',    40,  45, 30, 18, 10, { color: 0x9aa3ab }),
  BA('air-hangar-2', 'HANGAR 2',      'hangar',    78,  45, 30, 18, 10, { color: 0x9aa3ab }),
  BA('air-tower',    'CONTROL TOWER', 'tower',     108, 40, 8,  8,  22, { color: 0xc9ccd0 }),
  BA('air-terminal', 'TERMINAL',      'terminal',  130, 42, 24, 12, 7,  { color: 0xcfd2d6 }),
  BA('air-fuel',     'FUEL DEPOT',    'fueldepot', 152, 42, 12, 12, 5,  { color: 0xb8c0c8 }),

  /* ---- PORT TOWN (enemy held). Main Street z = 80, Market Street x = 120, square at (120, 80) ---- */
  B('town-hall',    'town', 'TOWN HALL',       'townhall',    120, 58,  FACE.S, 26, 16, 11, { color: 0xd6c4a8 }),
  B('town-police',  'town', 'POLICE STATION',  'police',      98,  66,  FACE.S, 14, 12, 7,  { color: 0x9fb4c8 }),
  B('town-market',  'town', 'MARKET',          'market',      144, 66,  FACE.S, 20, 12, 6,  { color: 0xd9b98a }),
  B('town-clinic',  'town', 'CLINIC',          'clinic',      98,  94,  FACE.N, 14, 10, 7,  { color: 0xe6e6e0 }),
  B('town-fuel',    'town', 'FUEL STATION',    'fuelstation', 150, 94,  FACE.N, 16, 12, 5,  { color: 0xc9c3b8 }),
  B('town-warehouse','town','WAREHOUSE',       'warehouse',   148, 112, FACE.W, 16, 18, 7,  { color: 0x9a8f80 }),

  HOUSE(1, 96,  46,  FACE.S, 0),
  HOUSE(2, 142, 46,  FACE.S, 1),
  HOUSE(3, 156, 48,  FACE.S, 2),
  HOUSE(4, 106, 108, FACE.E, 3),
  HOUSE(5, 106, 121, FACE.E, 4),
  HOUSE(6, 82,  94,  FACE.N, 5),
  HOUSE(7, 82,  66,  FACE.S, 1),
  HOUSE(8, 164, 68,  FACE.S, 4)
];

// Harbor Master's Office next to the landing (only if a shoreline was found)
if (PIER) {
  const px = PIER.dir[1], pz = -PIER.dir[0];            // side of the road
  BUILDINGS.push(B(
    'harbor-office', 'town', "HARBOR MASTER'S OFFICE", 'harbor',
    PIER.landX + px * 14 - PIER.dir[0] * 2, PIER.landZ + pz * 14 - PIER.dir[1] * 2,
    Math.atan2(-PIER.dir[1], PIER.dir[0]), 10, 8, 5.5, { color: 0x8fb0c4 }
  ));
}

// Kept so older code still works: [x, z, rotationY, modelVariant 0-5]
export const HOUSES = BUILDINGS.filter((b) => b.type === 'house').map((b) => [b.x, b.z, b.rot, b.variant]);

/* ======================================================================
   PROPS: type = watchtower | sandbags | barrier | flagpole | windsock
   len = length in metres along the object's local X
   ====================================================================== */
export const PROPS = [
  // Base
  { type: 'watchtower', place: 'base', x: -177, z: -147, rot: 0 },
  { type: 'watchtower', place: 'base', x: -103, z: -147, rot: 0 },
  { type: 'watchtower', place: 'base', x: -177, z: -73,  rot: 0 },
  { type: 'watchtower', place: 'base', x: -103, z: -73,  rot: 0 },
  { type: 'flagpole', place: 'base', x: -150, z: -116, rot: 0, faction: 'friendly' },
  { type: 'flagpole', place: 'base', x: -130, z: -116, rot: 0, faction: 'friendly' },

  // Airfield
  { type: 'watchtower', place: 'airfield', x: ap(3, -23)[0],  z: ap(3, -23)[1],  rot: 0 },
  { type: 'watchtower', place: 'airfield', x: ap(157, -23)[0], z: ap(157, -23)[1], rot: 0 },
  { type: 'watchtower', place: 'airfield', x: ap(3, 53)[0],   z: ap(3, 53)[1],   rot: 0 },
  { type: 'watchtower', place: 'airfield', x: ap(157, 53)[0], z: ap(157, 53)[1], rot: 0 },
  { type: 'windsock',   place: 'airfield', x: ap(30, -16)[0], z: ap(30, -16)[1], rot: 0 },
  { type: 'flagpole',   place: 'airfield', x: ap(100, 34)[0], z: ap(100, 34)[1], rot: 0, faction: 'friendly' },

  // Port Town: West Checkpoint (road runs east-west, walls funnel the road)
  { type: 'watchtower', place: 'town', x: 74, z: 70, rot: 0 },
  { type: 'watchtower', place: 'town', x: 74, z: 90, rot: 0 },
  { type: 'sandbags', place: 'town', x: 82, z: 74, rot: 0, len: 8 },
  { type: 'sandbags', place: 'town', x: 82, z: 86, rot: 0, len: 8 },
  { type: 'barrier',  place: 'town', x: 80, z: 78.2, rot: FACE.E, len: 4 },
  { type: 'barrier',  place: 'town', x: 88, z: 81.8, rot: FACE.E, len: 4 },

  // Port Town: South Checkpoint (road runs north-south)
  { type: 'watchtower', place: 'town', x: 131, z: 124, rot: 0 },
  { type: 'watchtower', place: 'town', x: 108, z: 130, rot: 0 },
  { type: 'sandbags', place: 'town', x: 113.5, z: 116, rot: FACE.E, len: 6 },
  { type: 'sandbags', place: 'town', x: 126.5, z: 116, rot: FACE.E, len: 6 },
  { type: 'barrier',  place: 'town', x: 118, z: 118, rot: 0, len: 4 },
  { type: 'barrier',  place: 'town', x: 122, z: 122, rot: 0, len: 4 },

  // Port Town: East Barricade
  { type: 'watchtower', place: 'town', x: 166, z: 88, rot: 0 },
  { type: 'sandbags', place: 'town', x: 160, z: 74.5, rot: 0, len: 8 },
  { type: 'sandbags', place: 'town', x: 160, z: 85.5, rot: 0, len: 8 },
  { type: 'barrier',  place: 'town', x: 158, z: 78.2, rot: FACE.E, len: 4 },
  { type: 'barrier',  place: 'town', x: 164, z: 81.8, rot: FACE.E, len: 4 },

  // Port Town: enemy flags in front of the Town Hall
  { type: 'flagpole', place: 'town', x: 111, z: 68.5, rot: 0, faction: 'hostile' },
  { type: 'flagpole', place: 'town', x: 129, z: 68.5, rot: 0, faction: 'hostile' }
];

// Harbor Landing props
if (PIER) {
  const dx = PIER.dir[0], dz = PIER.dir[1];
  const px = dz, pz = -dx;                       // side vector
  const along = -Math.atan2(dz, dx);             // rot so local X runs along the road
  PROPS.push(
    { type: 'sandbags',   place: 'town', x: PIER.landX + px * 6,  z: PIER.landZ + pz * 6,  rot: along, len: 6 },
    { type: 'sandbags',   place: 'town', x: PIER.landX - px * 6,  z: PIER.landZ - pz * 6,  rot: along, len: 6 },
    { type: 'watchtower', place: 'town', x: PIER.landX - px * 11, z: PIER.landZ - pz * 11, rot: 0 }
  );
}

/* ======================================================================
   labelAt(x, z): name of the gate / building / pad you are next to (or null).
   Used later for the on-screen place name.
   ====================================================================== */
export function labelAt(x, z) {
  for (const g of GATES) {
    if (Math.hypot(x - g.x, z - g.z) < 9) return { name: g.name, kind: g.kind, place: g.place };
  }
  for (const b of BUILDINGS) {
    const dx = x - b.x, dz = z - b.z;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const lx = dx * c - dz * s;                  // along the building's width
    const lz = dx * s + dz * c;                  // along its depth
    if (Math.abs(lx) < b.w / 2 + 4 && Math.abs(lz) < b.d / 2 + 4) {
      return { name: b.name, kind: b.type, place: b.place };
    }
  }
  for (const p of PADS) {
    if (p.shape === 'circle') {
      if (Math.hypot(x - p.x, z - p.z) < p.r) return { name: p.name, kind: 'pad', place: p.place };
    } else {
      const dx = x - p.x, dz = z - p.z;
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      if (Math.abs(dx * c - dz * s) < p.w / 2 && Math.abs(dx * s + dz * c) < p.d / 2) {
        return { name: p.name, kind: 'pad', place: p.place };
      }
    }
  }
  return null;
}

/* ---------- Seeded random (same island on every reload) ---------- */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Shared road sampling ---------- */
const sampleCache = new WeakMap();

// Returns the dense list of centerline points (about 1.6 m apart).
// Do NOT modify the returned array or its points.
export function sampleRoad(points) {
  if (sampleCache.has(points)) return sampleCache.get(points);
  const curve = new THREE.CatmullRomCurve3(
    points.map(p => new THREE.Vector3(p[0], heightAt(p[0], p[1]), p[1]))
  );
  const count = Math.max(90, Math.ceil(curve.getLength() / 1.6));
  const pts = curve.getPoints(count);
  sampleCache.set(points, pts);
  return pts;
}

let pavedList = null;

// Distance from (x, z) to the nearest road/runway EDGE.
// Negative = you are standing on pavement.
export function pavedClearance(x, z) {
  if (!pavedList) {
    pavedList = [...ROADS, RUNWAY].map(r => ({ half: r.width / 2, pts: sampleRoad(r.points) }));
  }
  let best = Infinity;
  for (const r of pavedList) {
    let d2 = Infinity;
    for (const p of r.pts) {
      const dx = p.x - x, dz = p.z - z;
      const q = dx * dx + dz * dz;
      if (q < d2) d2 = q;
    }
    const c = Math.sqrt(d2) - r.half;
    if (c < best) best = c;
  }
  return best;
}