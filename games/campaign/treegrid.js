// games/campaign/treegrid.js
// Campaign Mode: a small lookup of tree trunks and rocks so they can be solid.
// nature.js fills it (addTree), collision.js asks it (treePush / treeBlocked).
// Space is split into 8 m cells, so a check only looks at a few nearby trunks.
//
// API:
//   clearTrees()                 empty the list (nature.js calls it before rebuilding)
//   addTree(x, z, r)             register a round obstacle of radius r (m)
//   treePush(x, z, r, out)       push a body of radius r out of any trunk; writes out.x, out.z
//   treeBlocked(x, z, r)         true if a body at (x, z) touches a trunk
//   treeCount()


const CELL = 8;
let cells = new Map();
let count = 0;

const key = (i, j) => i * 100003 + j;


export function clearTrees() {
  cells = new Map();
  count = 0;
}


export function addTree(x, z, r) {
  const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
  let list = cells.get(k);
  if (!list) { list = []; cells.set(k, list); }
  list.push({ x, z, r });
  count++;
}


export const treeCount = () => count;


export function treePush(x, z, r, out) {
  out.x = x; out.z = z;
  if (!count) return out;
  const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const list = cells.get(key(i, j));
      if (!list) continue;
      for (const t of list) {
        const dx = out.x - t.x, dz = out.z - t.z;
        const min = r + t.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        if (d < 0.0001) { out.x = t.x + min; continue; }
        out.x = t.x + dx / d * min;
        out.z = t.z + dz / d * min;
      }
    }
  }
  return out;
}


export function treeBlocked(x, z, r) {
  if (!count) return false;
  const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const list = cells.get(key(i, j));
      if (!list) continue;
      for (const t of list) {
        const dx = x - t.x, dz = z - t.z;
        const min = r + t.r;
        if (dx * dx + dz * dz < min * min) return true;
      }
    }
  }
  return false;
}