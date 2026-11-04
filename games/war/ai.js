// games/war/ai.js
// The "brain tools" shared by enemies and teammates:
//   findPath()        A* pathfinding on the map grid
//   walkTo()          walks a unit along a path, around walls
//   findCover()       finds a spot where a threat cannot see you
//   flankPoint()      finds a spot to the side of a target
//   createDirector()  the adaptive-difficulty "AI director"

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Small angle helpers ---------- */
// Models face -Z, so this gives the yaw (rotation.y) that faces direction (dx, dz).
export function yawFor(dx, dz) { return Math.atan2(-dx, -dz); }

export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Turns an angle towards a target angle, at most maxStep radians.
export function turnToward(cur, target, maxStep) {
  return cur + clamp(angleDiff(cur, target), -maxStep, maxStep);
}

/* ---------- Grid helpers ---------- */
function cellOf(grid, v) {
  return clamp(Math.floor((v + grid.half) / grid.cell), 0, grid.n - 1);
}

// Can you walk in a straight line between two points without touching a blocked square?
export function gridLineClear(grid, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.max(1, Math.ceil(dist / (grid.cell * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (grid.blocked[cellOf(grid, z1 + dz * t) * grid.n + cellOf(grid, x1 + dx * t)]) return false;
  }
  return true;
}

function nearestWalkable(grid, cx, cz, maxR = 10) {
  if (grid.walkable(cx, cz)) return [cx, cz];
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = 1e9;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!grid.walkable(cx + dx, cz + dz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = [cx + dx, cz + dz]; }
      }
    }
    if (best) return best;
  }
  return null;
}

function spotIsValid(map, x, z) {
  if (Math.abs(x) > map.half - 2 || Math.abs(z) > map.half - 2) return false;
  return !map.grid.blocked[cellOf(map.grid, z) * map.grid.n + cellOf(map.grid, x)];
}

/* ---------- A* pathfinding ---------- */
// A* explores the grid square by square, always trying the square that looks closest
// to the goal (cost so far + straight-line guess). It finds the shortest way around walls.
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]
];
const scratchByGrid = new WeakMap();

function getScratch(grid) {
  let s = scratchByGrid.get(grid);
  if (!s) {
    const N = grid.n * grid.n;
    s = {
      g: new Float32Array(N), parent: new Int32Array(N),
      stamp: new Uint32Array(N), closed: new Uint32Array(N),
      run: 0, hn: [], hf: []
    };
    scratchByGrid.set(grid, s);
  }
  return s;
}

function heapPush(s, node, f) {
  const hn = s.hn, hf = s.hf;
  let i = hn.length;
  hn.push(node); hf.push(f);
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (hf[p] <= hf[i]) break;
    [hn[p], hn[i]] = [hn[i], hn[p]];
    [hf[p], hf[i]] = [hf[i], hf[p]];
    i = p;
  }
}

function heapPop(s) {
  const hn = s.hn, hf = s.hf;
  const top = hn[0];
  const ln = hn.pop(), lf = hf.pop();
  if (hn.length > 0) {
    hn[0] = ln; hf[0] = lf;
    const n = hn.length;
    let i = 0;
    while (true) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < n && hf[l] < hf[m]) m = l;
      if (r < n && hf[r] < hf[m]) m = r;
      if (m === i) break;
      [hn[m], hn[i]] = [hn[i], hn[m]];
      [hf[m], hf[i]] = [hf[i], hf[m]];
      i = m;
    }
  }
  return top;
}

// Returns a list of { x, z } points to walk through, or null if there is no route.
export function findPath(grid, sx, sz, tx, tz, maxNodes = 4000) {
  const s = getScratch(grid);
  const n = grid.n;
  const a = nearestWalkable(grid, cellOf(grid, sx), cellOf(grid, sz));
  const goalWanted = { cx: cellOf(grid, tx), cz: cellOf(grid, tz) };
  const b = nearestWalkable(grid, goalWanted.cx, goalWanted.cz);
  if (!a || !b) return null;

  const startI = a[1] * n + a[0];
  const goalI = b[1] * n + b[0];
  const finalPoint = grid.walkable(goalWanted.cx, goalWanted.cz)
    ? { x: tx, z: tz } : grid.toWorld(b[0], b[1]);
  if (startI === goalI) return [finalPoint];

  const octile = (x, z) => {
    const dx = Math.abs(x - b[0]), dz = Math.abs(z - b[1]);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
  };

  s.run++;
  const run = s.run;
  s.hn.length = 0; s.hf.length = 0;
  s.g[startI] = 0; s.stamp[startI] = run; s.parent[startI] = -1;
  heapPush(s, startI, octile(a[0], a[1]));

  let found = false, expanded = 0;
  while (s.hn.length) {
    const cur = heapPop(s);
    if (s.closed[cur] === run) continue;
    s.closed[cur] = run;
    if (cur === goalI) { found = true; break; }
    if (++expanded > maxNodes) break;

    const cx = cur % n, cz = (cur / n) | 0;
    for (const d of DIRS) {
      const nx = cx + d[0], nz = cz + d[1];
      if (!grid.walkable(nx, nz)) continue;
      // no cutting corners through the edge of a wall
      if (d[0] !== 0 && d[1] !== 0 && (!grid.walkable(cx + d[0], cz) || !grid.walkable(cx, cz + d[1]))) continue;
      const ni = nz * n + nx;
      if (s.closed[ni] === run) continue;
      const ng = s.g[cur] + d[2];
      if (s.stamp[ni] !== run || ng < s.g[ni]) {
        s.stamp[ni] = run;
        s.g[ni] = ng;
        s.parent[ni] = cur;
        heapPush(s, ni, ng + octile(nx, nz));
      }
    }
  }
  if (!found) return null;

  // Walk back from the goal to the start
  const cells = [];
  for (let i = goalI; i !== -1 && i !== startI; i = s.parent[i]) cells.push(i);
  cells.reverse();
  const pts = cells.map(i => grid.toWorld(i % n, (i / n) | 0));
  pts[pts.length - 1] = finalPoint;

  // Smoothing: skip any point you can already see from further back
  const out = [];
  let ax = sx, az = sz, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !gridLineClear(grid, ax, az, pts[j].x, pts[j].z)) j--;
    out.push(pts[j]);
    ax = pts[j].x; az = pts[j].z;
    i = j + 1;
  }
  return out;
}

/* ---------- Walking ---------- */
// Every walking unit keeps one of these as its memory.
export function makeNav() {
  return { path: null, idx: 0, repathT: Math.random() * 0.5, gx: 1e9, gz: 1e9, dx: 0, dz: -1 };
}

// Walks unit u (needs u.pos) towards (tx, tz). Goes straight if the way is clear,
// otherwise follows an A* path. Returns the distance actually moved this frame.
export function walkTo(map, u, nav, tx, tz, speed, dt, radius = 0.5) {
  const grid = map.grid;
  const p = u.pos;
  nav.repathT -= dt;

  let wx = tx, wz = tz;
  if (gridLineClear(grid, p.x, p.z, tx, tz)) {
    nav.path = null;
  } else {
    const goalMoved = Math.abs(tx - nav.gx) + Math.abs(tz - nav.gz) > 4;
    if (!nav.path || nav.repathT <= 0 || goalMoved) {
      nav.path = findPath(grid, p.x, p.z, tx, tz);
      nav.idx = 0;
      nav.repathT = 0.6 + Math.random() * 0.4;
      nav.gx = tx; nav.gz = tz;
    }
    if (!nav.path) return 0;                          // no route: stand still
    while (nav.idx < nav.path.length - 1) {
      const w = nav.path[nav.idx];
      if (Math.abs(w.x - p.x) + Math.abs(w.z - p.z) < 1.2) nav.idx++; else break;
    }
    const w = nav.path[nav.idx];
    wx = w.x; wz = w.z;
  }

  const dx = wx - p.x, dz = wz - p.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.15) return 0;
  const step = Math.min(speed * dt, d);
  nav.dx = dx / d; nav.dz = dz / d;

  const bx = p.x, bz = p.z;
  map.move(p, nav.dx * step, nav.dz * step, radius);
  const moved = Math.sqrt((p.x - bx) ** 2 + (p.z - bz) ** 2);
  if (moved < step * 0.3) nav.repathT = 0;            // stuck: find a new route soon
  return moved;
}

// Pushes units apart so they don't stack on one spot. Returns { x, z }.
export function separation(u, list, minDist = 1.6) {
  let sx = 0, sz = 0;
  for (const o of list) {
    if (o === u || !o.alive) continue;
    const dx = u.pos.x - o.pos.x, dz = u.pos.z - o.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 0.0001 && d2 < minDist * minDist) {
      const d = Math.sqrt(d2);
      const f = (minDist - d) / minDist;
      sx += (dx / d) * f; sz += (dz / d) * f;
    }
  }
  return { x: sx, z: sz };
}

/* ---------- Tactics ---------- */
// Nearest spot (within maxDist) that the threat cannot see. Returns { x, z } or null.
export function findCover(map, from, threat, maxDist = 16) {
  let best = null, bestScore = 1e9;
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * Math.PI * 2;
    for (let r = 3; r <= maxDist; r += 3) {
      const x = from.x + Math.cos(ang) * r, z = from.z + Math.sin(ang) * r;
      if (!spotIsValid(map, x, z)) continue;
      if (map.hasLineOfSight(threat.x, threat.z, x, z)) continue;
      // prefer close spots that are not closer to the threat than we are now
      const closer = Math.hypot(x - threat.x, z - threat.z) < Math.hypot(from.x - threat.x, from.z - threat.z) ? 4 : 0;
      const score = r + closer;
      if (score < bestScore) { bestScore = score; best = { x, z }; }
      break;
    }
  }
  return best;
}

// A point to the side of the target, so a soldier can attack from a new angle.
export function flankPoint(map, from, target, dist = 14) {
  const base = Math.atan2(from.z - target.z, from.x - target.x);
  const side = Math.random() < 0.5 ? 1 : -1;
  for (const sd of [side, -side]) {
    for (const off of [1.1, 0.8, 1.4]) {
      const a = base + sd * off;
      const x = target.x + Math.cos(a) * dist, z = target.z + Math.sin(a) * dist;
      if (spotIsValid(map, x, z)) return { x, z };
    }
  }
  return null;
}

/* ---------- The AI director ---------- */
// Watches how the player is doing and quietly adjusts the enemies.
// level: 0.7 (easier) ... 1.0 (normal) ... 1.4 (harder).
// Enemies use level for accuracy and fire rate. tension (0 to 1) drives the music.
export function createDirector() {
  let level = 1, recentDamage = 0, recentKills = 0, timer = 0, tension = 0;

  return {
    get level() { return level; },
    get tension() { return tension; },
    get label() { return level < 0.85 ? 'EASY' : level < 1.15 ? 'NORMAL' : 'HARD'; },

    playerHurt(n) { recentDamage += n; },
    enemyKilled() { recentKills++; },

    // s = { healthFrac: 0..1, enemiesNear: how many enemies are close }
    update(dt, s) {
      recentDamage *= Math.exp(-dt / 8);
      timer += dt;
      if (timer >= 5) {
        timer = 0;
        if (s.healthFrac > 0.75 && recentDamage < 15 && recentKills >= 2) level += 0.06;       // doing great: harder
        else if (s.healthFrac < 0.35 || recentDamage > 45) level -= 0.1;                       // struggling: easier
        level = clamp(level, 0.7, 1.4);
        recentKills = 0;
      }
      const target = Math.min(1, recentDamage / 40 + Math.min(1, s.enemiesNear / 6) * 0.6);
      tension += (target - tension) * Math.min(1, dt * 1.5);
    },

    reset() { level = 1; recentDamage = 0; recentKills = 0; timer = 0; tension = 0; }
  };
}