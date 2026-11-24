// games/campaign/pathfinding.js
// Campaign Mode: finds a walkable route around buildings, fences, props, deep water.
// Method: A* on a 1.5 m grid (cells are checked on demand, so no big precompute),
// then the route is straightened so soldiers do not zig-zag.
// Uses collision.js (blockedAt, onPier) and terrain.js (heightAt, WORLD).
//
// API:
//   findPath(x1, z1, x2, z2)  -> array of {x, z} waypoints (start not included).
//                                [] = no route. Check pathInfo.partial for "got as close as possible".
//   walkableAt(x, z)          -> true if a soldier can stand there
//   pathInfo                  -> {nodes, ms, partial, found} of the last search (for the Console)


import { heightAt, WORLD } from './terrain.js';
import { blockedAt, onPier } from './collision.js';


/* ---------- Knobs ---------- */
const CELL = 1.5;            // grid size (m)
const RADIUS = 0.5;          // soldier body radius used for clearance (m)
const WATER_BLOCK = -1.4;    // same as main.js: deep water is not walkable
const MAX_NODES = 9000;      // search limit per path (keeps the game smooth)
const LINE_STEP = 0.6;       // sampling step for the straight-line check (m)
const HALF = WORLD.size / 2 - 6;


export const pathInfo = { nodes: 0, ms: 0, partial: false, found: false };


/* ---------- Walkable test ---------- */
export function walkableAt(x, z) {
  if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false;
  if (!(heightAt(x, z) > WATER_BLOCK || onPier(x, z))) return false;
  return !blockedAt(x, z, RADIUS);
}


const OFF = 2000, STRIDE = 4001;
const key = (i, j) => (i + OFF) * STRIDE + (j + OFF);
let cache = new Map();


function cellWalk(i, j) {
  const k = key(i, j);
  let v = cache.get(k);
  if (v === undefined) {
    v = walkableAt(i * CELL, j * CELL);
    cache.set(k, v);
  }
  return v;
}


// Nearest walkable cell around (i, j), searching outwards in rings.
function nearestWalkable(i, j, maxR) {
  if (cellWalk(i, j)) return { i, j };
  let best = null, bestD = Infinity;
  for (let r = 1; r <= maxR; r++) {
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (!cellWalk(i + di, j + dj)) continue;
        const d = di * di + dj * dj;
        if (d < bestD) { bestD = d; best = { i: i + di, j: j + dj }; }
      }
    }
    if (best) return best;
  }
  return null;
}


function clearLine(x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / LINE_STEP));
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    if (!walkableAt(x1 + dx * t, z1 + dz * t)) return false;
  }
  return true;
}


/* ---------- Small binary heap (lowest f first) ---------- */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(f, n) {
    const a = this.a;
    a.push({ f, n });
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (a[p].f <= a[c].f) break;
      [a[p], a[c]] = [a[c], a[p]];
      c = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1, r = l + 1;
        let m = p;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === p) break;
        [a[p], a[m]] = [a[m], a[p]];
        p = m;
      }
    }
    return top;
  }
}


const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]
];
const octile = (di, dj) => {
  const a = Math.abs(di), b = Math.abs(dj);
  return Math.max(a, b) + 0.4142 * Math.min(a, b);
};


/* ---------- Main search ---------- */
export function findPath(x1, z1, x2, z2) {
  const t0 = performance.now();
  pathInfo.nodes = 0; pathInfo.partial = false; pathInfo.found = false;
  if (cache.size > 250000) cache = new Map();


  const goalOK = walkableAt(x2, z2);


  // Fast path: nothing in the way
  if (goalOK && clearLine(x1, z1, x2, z2)) {
    pathInfo.found = true; pathInfo.ms = performance.now() - t0;
    return [{ x: x2, z: z2 }];
  }


  const s = nearestWalkable(Math.round(x1 / CELL), Math.round(z1 / CELL), 3);
  const g = nearestWalkable(Math.round(x2 / CELL), Math.round(z2 / CELL), 8);
  if (!s || !g) { pathInfo.ms = performance.now() - t0; return []; }


  const gi = g.i, gj = g.j;
  const open = new Heap();
  const gScore = new Map();
  const from = new Map();
  const closed = new Set();


  const sk = key(s.i, s.j);
  gScore.set(sk, 0);
  open.push(octile(gi - s.i, gj - s.j), { i: s.i, j: s.j });


  let reached = false;
  let bestNode = { i: s.i, j: s.j }, bestH = octile(gi - s.i, gj - s.j);
  let nodes = 0;


  while (open.size && nodes < MAX_NODES) {
    const cur = open.pop().n;
    const ck = key(cur.i, cur.j);
    if (closed.has(ck)) continue;
    closed.add(ck);
    nodes++;


    const h = octile(gi - cur.i, gj - cur.j);
    if (h < bestH) { bestH = h; bestNode = cur; }
    if (cur.i === gi && cur.j === gj) { reached = true; break; }


    const cg = gScore.get(ck);
    for (const [di, dj, cost] of DIRS) {
      const ni = cur.i + di, nj = cur.j + dj;
      if (!cellWalk(ni, nj)) continue;
      // no cutting corners on diagonal moves
      if (di !== 0 && dj !== 0 && (!cellWalk(cur.i + di, cur.j) || !cellWalk(cur.i, cur.j + dj))) continue;
      const nk = key(ni, nj);
      if (closed.has(nk)) continue;
      const ng = cg + cost;
      const old = gScore.get(nk);
      if (old !== undefined && old <= ng) continue;
      gScore.set(nk, ng);
      from.set(nk, ck);
      open.push(ng + octile(gi - ni, gj - nj), { i: ni, j: nj });
    }
  }


  pathInfo.nodes = nodes;
  pathInfo.found = reached;
  pathInfo.partial = !reached;


  // Rebuild the route from the goal (or the closest cell reached) back to the start
  const end = reached ? { i: gi, j: gj } : bestNode;
  const cells = [];
  let k = key(end.i, end.j);
  let guard = 0;
  while (k !== undefined && guard++ < 20000) {
    const i = Math.floor(k / STRIDE) - OFF;
    const j = (k % STRIDE) - OFF;
    cells.push({ x: i * CELL, z: j * CELL });
    if (k === sk) break;
    k = from.get(k);
  }
  cells.reverse();


  // Final point: the exact target when we reached it and it is walkable
  if (reached && goalOK) cells[cells.length - 1] = { x: x2, z: z2 };


  // Straighten: from each point jump to the farthest point we can walk to in a straight line
  const pts = [{ x: x1, z: z1 }, ...cells];
  const out = [];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !clearLine(pts[a].x, pts[a].z, pts[b].x, pts[b].z)) b--;
    out.push(pts[b]);
    a = b;
  }


  pathInfo.ms = performance.now() - t0;
  return out;
}