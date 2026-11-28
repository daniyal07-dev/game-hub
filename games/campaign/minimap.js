// games/campaign/minimap.js  (REPLACEMENT)   v2
// GTA-style round minimap (top-right) + big island map (map key, default M).
// Everything is drawn from the real island data: terrain height, roads, runway,
// pads, fences, buildings, gates, pier. Loaded by extras.js (no changes needed elsewhere).
//
// v2: drones (red diamonds) and robots (big red squares) now show on the radar too,
//     with the same range rule as the soldiers.
//
// Realism: the radar shows enemies only within RADAR_RANGE of you or of one of your
// soldiers. The big map never shows enemies, only places and your own people.
//
// The map key comes from keybinds.js (action 'map').
// If ctx.guideRoute is set (by guide.js), a cyan route line is drawn on both maps.



import { heightAt, zoneAt, WORLD } from './terrain.js';
import {
  ROADS, RUNWAY, PADS, BUILDINGS, FENCES, GATES, PIER, PLACES,
  sampleRoad, airPoint
} from './layout.js';
import { key, label } from './keybinds.js';




/* ---------- Knobs ---------- */
const MINI_SIZE = 200;          // minimap diameter in pixels
const MINI_SCALE = 1.4;         // pixels per metre (bigger = more zoomed in)
const RADAR_RANGE = 70;         // enemies are shown within this many metres
const CORNER = { top: 16, right: 16 };   // minimap position on the screen
const MINI_FPS = 30;
const BIG_FPS = 20;
const TERRAIN_N = 384;          // terrain picture resolution
const ROWS_PER_FRAME = 24;      // how many rows are painted per frame (keeps the game smooth)



const MARGIN = 35;              // extra metres around the island on the big map



const SHORT = {                 // names shown on the big map
  'base-hq': 'HQ', 'base-mess': 'MESS', 'base-armory': 'ARMORY', 'base-radar': 'RADAR',
  'base-barracks-a': 'BARRACKS A', 'base-barracks-b': 'BARRACKS B', 'base-garage': 'MOTOR POOL',
  'air-hangar-1': 'HANGAR 1', 'air-hangar-2': 'HANGAR 2', 'air-tower': 'TOWER',
  'air-terminal': 'TERMINAL', 'air-fuel': 'FUEL',
  'town-hall': 'TOWN HALL', 'town-police': 'POLICE', 'town-market': 'MARKET',
  'town-clinic': 'CLINIC', 'town-fuel': 'FUEL', 'town-warehouse': 'WAREHOUSE',
  'harbor-office': 'HARBOR OFFICE'
};




/* ---------- Map key (read from keybinds.js, default M) ---------- */
function mapKey() {
  try { return key('map') || 'KeyM'; } catch (e) { return 'KeyM'; }
}
function mapLabel() {
  try { return label(mapKey()); } catch (e) { return 'M'; }
}




/* ---------- State ---------- */
let mini = null, mctx = null, big = null, bctx = null;
let wrap = null, zoneEl = null, overlay = null, footEl = null;
let bigOpen = false;
let miniT = 0, bigT = 0, zoneT = 0;



let terrainCv = null, tctx = null, timg = null;
let rowsDone = 0, terrainDone = false;



let roadPaths = null;           // [{ path, width }]
let fencePath = null;
let bounds = null;



/* drones and robots (found when the game starts) */
let droneFn = null;             // getDrones()
let robotFns = [];              // any getRobots / getMechs / getTurrets functions found




/* ======================================================================
   DRONES AND ROBOTS (looked up safely, a missing file never breaks the map)
   ====================================================================== */
function findAir() {
  import('./drones.js').then((m) => {
    if (typeof m.getDrones === 'function') droneFn = m.getDrones;
    console.log('[minimap] drones on the radar: ' + (droneFn ? 'yes' : 'no (getDrones not found)'));
  }).catch(() => { droneFn = null; });

  import('./robots.js').then((m) => {
    robotFns = [];
    for (const name of Object.keys(m)) {
      if (typeof m[name] === 'function' && /^get.*(robot|mech|turret)/i.test(name)) robotFns.push(m[name]);
    }
    console.log('[minimap] robots on the radar: ' + (robotFns.length ? 'yes (' + robotFns.length + ' list)' : 'no (no getRobots / getMechs / getTurrets found)'));
  }).catch(() => { robotFns = []; });
}

function posOf(e) {
  if (typeof e.x === 'number' && typeof e.z === 'number') return { x: e.x, z: e.z };
  const o = e.group || e.g || e.mesh || e.root || e.obj;
  if (o && o.position) return { x: o.position.x, z: o.position.z };
  return null;
}

function isGone(e) {
  if (e.dead || e.destroyed || e.removed) return true;
  if (typeof e.hp === 'number' && e.hp <= 0) return true;
  return false;
}

// every living drone and robot as { x, z, big }
function machines() {
  const out = [];
  try {
    if (droneFn) {
      const list = droneFn();
      if (Array.isArray(list)) {
        for (const d of list) {
          if (!d || isGone(d)) continue;
          const p = posOf(d);
          if (p) out.push({ x: p.x, z: p.z, big: false });
        }
      }
    }
  } catch (e) { /* ignore */ }
  try {
    for (const fn of robotFns) {
      const list = fn();
      if (!Array.isArray(list)) continue;
      for (const r of list) {
        if (!r || isGone(r)) continue;
        const p = posOf(r);
        if (p) out.push({ x: p.x, z: p.z, big: true });
      }
    }
  } catch (e) { /* ignore */ }
  return out;
}




/* ======================================================================
   TERRAIN PICTURE (painted a few rows per frame)
   ====================================================================== */
const STOPS = [
  [-30, 18, 58, 98], [-8, 28, 84, 128], [-1.4, 52, 128, 168], [0.15, 104, 176, 200],
  [0.3, 222, 208, 160], [1.4, 214, 200, 150], [3, 128, 166, 92], [15, 92, 134, 70],
  [40, 112, 112, 98], [75, 186, 186, 182]
];



function colorFor(h, out) {
  if (h <= STOPS[0][0]) { out[0] = STOPS[0][1]; out[1] = STOPS[0][2]; out[2] = STOPS[0][3]; return; }
  for (let i = 1; i < STOPS.length; i++) {
    const b = STOPS[i];
    if (h <= b[0]) {
      const a = STOPS[i - 1];
      const t = (h - a[0]) / (b[0] - a[0]);
      out[0] = a[1] + (b[1] - a[1]) * t;
      out[1] = a[2] + (b[2] - a[2]) * t;
      out[2] = a[3] + (b[3] - a[3]) * t;
      return;
    }
  }
  const l = STOPS[STOPS.length - 1];
  out[0] = l[1]; out[1] = l[2]; out[2] = l[3];
}



const rgb = [0, 0, 0];



function genTerrain() {
  if (terrainDone) return;
  const N = TERRAIN_N;
  if (!terrainCv) {
    terrainCv = document.createElement('canvas');
    terrainCv.width = N; terrainCv.height = N;
    tctx = terrainCv.getContext('2d');
    timg = tctx.createImageData(N, N);
    rowsDone = 0;
  }
  const size = WORLD.size, half = size / 2, step = size / N;
  const end = Math.min(N, rowsDone + ROWS_PER_FRAME);
  const data = timg.data;
  for (let j = rowsDone; j < end; j++) {
    const z = -half + (j + 0.5) * step;
    for (let i = 0; i < N; i++) {
      const x = -half + (i + 0.5) * step;
      const h = heightAt(x, z);
      colorFor(h, rgb);
      let shade = 1;
      if (h > -1) {                                    // soft hill shading on land
        const dx = heightAt(x + step, z) - h;
        const dz = heightAt(x, z + step) - h;
        shade = 1 + ((dx + dz) / step) * 0.4;
        if (shade < 0.7) shade = 0.7; else if (shade > 1.3) shade = 1.3;
      }
      const k = (j * N + i) * 4;
      data[k] = rgb[0] * shade;
      data[k + 1] = rgb[1] * shade;
      data[k + 2] = rgb[2] * shade;
      data[k + 3] = 255;
    }
  }
  tctx.putImageData(timg, 0, 0, 0, rowsDone, N, end - rowsDone);
  rowsDone = end;
  if (rowsDone >= N) {
    terrainDone = true;
    console.log('[minimap] terrain picture ready');
  }
}




/* ======================================================================
   STATIC SHAPES (built once from layout.js)
   ====================================================================== */
function buildShapes() {
  roadPaths = [];
  const addLine = (pts, width) => {
    const p = new Path2D();
    p.moveTo(pts[0].x, pts[0].z);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].z);
    roadPaths.push({ path: p, width });
  };
  for (const r of ROADS) addLine(sampleRoad(r.points), r.width);
  addLine(RUNWAY.points.map((q) => ({ x: q[0], z: q[1] })), RUNWAY.width);



  fencePath = new Path2D();
  for (const f of FENCES) {
    fencePath.moveTo(f.points[0][0], f.points[0][1]);
    for (let i = 1; i < f.points.length; i++) fencePath.lineTo(f.points[i][0], f.points[i][1]);
    fencePath.closePath();
  }



  // island bounds for the big map
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const grow = (x, z, r) => {
    if (x - r < x0) x0 = x - r; if (x + r > x1) x1 = x + r;
    if (z - r < z0) z0 = z - r; if (z + r > z1) z1 = z + r;
  };
  for (const b of BUILDINGS) grow(b.x, b.z, Math.max(b.w, b.d) / 2);
  for (const g of GATES) grow(g.x, g.z, 6);
  for (const f of FENCES) for (const q of f.points) grow(q[0], q[1], 2);
  for (const q of RUNWAY.points) grow(q[0], q[1], RUNWAY.width / 2);
  for (const r of ROADS) for (const q of r.points) grow(q[0], q[1], 4);
  if (PIER) grow(PIER.x + PIER.dir[0] * PIER.length / 2, PIER.z + PIER.dir[1] * PIER.length / 2, 6);
  bounds = { x0: x0 - MARGIN, x1: x1 + MARGIN, z0: z0 - MARGIN, z1: z1 + MARGIN };
}




/* ======================================================================
   DRAWING
   v = view { cx, cy, s, px, pz, a }: the world point (px, pz) is shown at pixel
   (cx, cy), s = pixels per metre, a = rotation (yaw on the minimap, 0 on the big map)
   ====================================================================== */
function w2s(v, x, z) {
  const dx = (x - v.px) * v.s, dz = (z - v.pz) * v.s;
  const c = Math.cos(v.a), s = Math.sin(v.a);
  return [v.cx + dx * c - dz * s, v.cy + dx * s + dz * c];
}



function placeColor(b) {
  if (b.type === 'house') return '#cfa97c';
  if (b.place === 'base') return '#6fbf73';
  if (b.place === 'airfield') return '#9db4c9';
  return '#d98a6a';
}



function drawWorld(c, v) {
  c.save();
  c.translate(v.cx, v.cy);
  c.rotate(v.a);
  c.scale(v.s, v.s);
  c.translate(-v.px, -v.pz);
  const px1 = 1 / v.s;                          // one screen pixel in metres



  // terrain
  if (terrainCv) {
    const half = WORLD.size / 2;
    c.imageSmoothingEnabled = true;
    c.drawImage(terrainCv, -half, -half, WORLD.size, WORLD.size);
  }



  // roads and runway
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (roadPaths) {
    for (const r of roadPaths) { c.lineWidth = r.width + 2 * px1; c.strokeStyle = '#23272d'; c.stroke(r.path); }
    for (const r of roadPaths) { c.lineWidth = r.width; c.strokeStyle = r.width > 20 ? '#666b73' : '#4d535b'; c.stroke(r.path); }
  }



  // pads
  c.fillStyle = '#8a8f96';
  for (const p of PADS) {
    c.save();
    c.translate(p.x, p.z);
    if (p.shape === 'circle') {
      c.beginPath(); c.arc(0, 0, p.r, 0, Math.PI * 2); c.fill();
    } else {
      c.rotate(-p.rot);
      c.fillRect(-p.w / 2, -p.d / 2, p.w, p.d);
    }
    c.restore();
  }



  // fences
  if (fencePath) {
    c.setLineDash([4, 3]);
    c.lineWidth = 1.4 * px1;
    c.strokeStyle = 'rgba(20,20,20,0.75)';
    c.stroke(fencePath);
    c.setLineDash([]);
  }



  // pier
  if (PIER) {
    c.save();
    c.translate(PIER.x, PIER.z);
    c.rotate(-PIER.rot);
    c.fillStyle = '#8a6a44';
    c.fillRect(-PIER.width / 2, -PIER.length / 2, PIER.width, PIER.length);
    c.restore();
  }



  // buildings (the small mark is the door side)
  for (const b of BUILDINGS) {
    c.save();
    c.translate(b.x, b.z);
    c.rotate(-b.rot);
    c.fillStyle = placeColor(b);
    c.fillRect(-b.w / 2, -b.d / 2, b.w, b.d);
    c.lineWidth = 1.2 * px1;
    c.strokeStyle = b.place === 'town' ? '#7a1f1f' : '#1d2a1d';
    c.strokeRect(-b.w / 2, -b.d / 2, b.w, b.d);
    if (b.type !== 'house') {
      c.fillStyle = '#ffffff';
      c.fillRect(-2, b.d / 2 - 0.4, 4, Math.max(1.2, 2 * px1));
    }
    c.restore();
  }



  // gates
  c.fillStyle = '#ffd84a';
  for (const g of GATES) c.fillRect(g.x - 1.6, g.z - 1.6, 3.2, 3.2);



  c.restore();
}



// cyan route line (GPS style). route = [{x, z}, ...] set by guide.js
function drawRoute(c, v, route, width) {
  if (!route || route.length < 2) return;
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  for (let i = 0; i < route.length; i++) {
    const q = w2s(v, route[i].x, route[i].z);
    if (i === 0) c.moveTo(q[0], q[1]); else c.lineTo(q[0], q[1]);
  }
  c.lineWidth = width + 3; c.strokeStyle = 'rgba(0,0,0,0.65)'; c.stroke();
  c.lineWidth = width; c.strokeStyle = '#38e1ff'; c.stroke();
  c.restore();
}



function starPath(c, x, y, r) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
}



function icon(c, kind, x, y, size, alpha) {
  c.save();
  c.globalAlpha = alpha;
  if (kind === 'barracks') {
    c.fillStyle = '#1f6fe0'; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    c.beginPath(); c.rect(x - size, y - size, size * 2, size * 2); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.font = '700 ' + Math.round(size * 1.5) + 'px Consolas,monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('B', x, y + 1);
  } else if (kind === 'townhall') {
    c.fillStyle = '#ffcc33'; c.strokeStyle = '#6b1010'; c.lineWidth = 1.5;
    starPath(c, x, y, size * 1.5); c.fill(); c.stroke();
  }
  c.restore();
}



function drawArrow(c, x, y, scale, rot) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.scale(scale, scale);
  c.beginPath();
  c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3); c.lineTo(-6, 7); c.closePath();
  c.fillStyle = '#38e1ff'; c.fill();
  c.lineWidth = 1.6 / scale; c.strokeStyle = '#ffffff'; c.stroke();
  c.restore();
}



function dot(c, x, y, r, fill, alpha) {
  c.globalAlpha = alpha;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = fill; c.fill();
  c.lineWidth = 1.2; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.stroke();
  c.globalAlpha = 1;
}

// drone = diamond, robot = square (both red, so they read as enemies)
function machineMark(c, x, y, big, alpha) {
  c.globalAlpha = alpha;
  c.beginPath();
  if (big) {
    c.rect(x - 5, y - 5, 10, 10);
  } else {
    c.moveTo(x, y - 5.5); c.lineTo(x + 5.5, y); c.lineTo(x, y + 5.5); c.lineTo(x - 5.5, y);
    c.closePath();
  }
  c.fillStyle = big ? '#ff1f1f' : '#ff5a2d';
  c.fill();
  c.lineWidth = 1.2; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.stroke();
  c.globalAlpha = 1;
}



function enemySeen(e, p, soldiers) {
  const r2 = RADAR_RANGE * RADAR_RANGE;
  let dx = e.x - p.x, dz = e.z - p.z;
  if (dx * dx + dz * dz < r2) return true;
  for (const s of soldiers) {
    if (s.dead) continue;
    dx = e.x - s.x; dz = e.z - s.z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}




/* ---------- Minimap ---------- */
function drawMini(ctx) {
  const p = ctx.player;
  const S = MINI_SIZE, R = S / 2;
  const v = { cx: R, cy: R, s: MINI_SCALE, px: p.x, pz: p.z, a: p.yaw };



  mctx.clearRect(0, 0, S, S);
  mctx.save();
  mctx.beginPath(); mctx.arc(R, R, R - 2, 0, Math.PI * 2); mctx.clip();
  mctx.fillStyle = '#1c4f78';
  mctx.fillRect(0, 0, S, S);
  drawWorld(mctx, v);



  // guide route (cyan line), if guide.js has set one
  drawRoute(mctx, v, ctx.guideRoute, 3);



  // your view cone
  mctx.beginPath();
  mctx.moveTo(R, R);
  mctx.arc(R, R, R, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
  mctx.closePath();
  mctx.fillStyle = 'rgba(255,255,255,0.12)';
  mctx.fill();



  // objective icons (stick to the rim when far away)
  const objs = [];
  for (const b of BUILDINGS) {
    if (b.id === 'base-barracks-a' || b.id === 'base-barracks-b') objs.push(['barracks', b.x, b.z]);
    else if (b.id === 'town-hall') objs.push(['townhall', b.x, b.z]);
  }
  for (const o of objs) {
    let [sx, sy] = w2s(v, o[1], o[2]);
    let dx = sx - R, dy = sy - R;
    const d = Math.hypot(dx, dy);
    const lim = R - 12;
    if (d > lim) { dx = dx / d * lim; dy = dy / d * lim; icon(mctx, o[0], R + dx, R + dy, 6, 0.75); }
    else icon(mctx, o[0], sx, sy, 6, 1);
  }



  // your soldiers (blue)
  const soldiers = ctx.getSoldiers() || [];
  for (const s of soldiers) {
    if (s.dead) continue;
    const [sx, sy] = w2s(v, s.x, s.z);
    if (Math.hypot(sx - R, sy - R) < R - 4) dot(mctx, sx, sy, 3.6, '#2f7bff', 1);
  }



  // enemies (red), radar style
  const enemies = ctx.getEnemies() || [];
  const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 160);
  for (const e of enemies) {
    if (e.dead || !enemySeen(e, p, soldiers)) continue;
    const [sx, sy] = w2s(v, e.x, e.z);
    if (Math.hypot(sx - R, sy - R) < R - 4) dot(mctx, sx, sy, 3.8, '#ff2d2d', pulse);
  }

  // drones (diamonds) and robots (squares), same radar range
  for (const m of machines()) {
    if (!enemySeen(m, p, soldiers)) continue;
    const [sx, sy] = w2s(v, m.x, m.z);
    if (Math.hypot(sx - R, sy - R) < R - 5) machineMark(mctx, sx, sy, m.big, pulse);
  }



  // you
  drawArrow(mctx, R, R, 1, 0);
  mctx.restore();



  // rim + north marker
  mctx.beginPath(); mctx.arc(R, R, R - 1.5, 0, Math.PI * 2);
  mctx.lineWidth = 3; mctx.strokeStyle = 'rgba(255,255,255,0.65)'; mctx.stroke();
  const nx = R + Math.sin(p.yaw) * (R - 11), ny = R - Math.cos(p.yaw) * (R - 11);
  mctx.beginPath(); mctx.arc(nx, ny, 8, 0, Math.PI * 2);
  mctx.fillStyle = 'rgba(0,0,0,0.7)'; mctx.fill();
  mctx.fillStyle = '#ff5050'; mctx.font = '700 11px Consolas,monospace';
  mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
  mctx.fillText('N', nx, ny + 1);
}




/* ---------- Big map ---------- */
function outlineText(c, text, x, y, font, fill) {
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.strokeText(text, x, y);
  c.fillStyle = fill; c.fillText(text, x, y);
}



function drawBig(ctx) {
  const W = big.width, H = big.height;
  const p = ctx.player;
  const bw = bounds.x1 - bounds.x0, bh = bounds.z1 - bounds.z0;
  const s = Math.min(W / bw, H / bh);
  const v = { cx: W / 2, cy: H / 2, s, px: (bounds.x0 + bounds.x1) / 2, pz: (bounds.z0 + bounds.z1) / 2, a: 0 };



  bctx.fillStyle = '#1c4f78';
  bctx.fillRect(0, 0, W, H);
  drawWorld(bctx, v);



  // guide route (cyan line), if guide.js has set one
  drawRoute(bctx, v, ctx.guideRoute, 3);



  // place names
  const pl = (x, z, text, col) => {
    const [sx, sy] = w2s(v, x, z);
    outlineText(bctx, text, sx, sy, '700 15px Consolas,monospace', col);
  };
  pl(-140, -160, PLACES.base.name, '#9dff9d');
  const a = airPoint(80, -38);
  pl(a[0], a[1], PLACES.airfield.name, '#cfe6ff');
  pl(120, 28, PLACES.town.name + '  (ENEMY HELD)', '#ff8f8f');
  if (PIER) {
    const [sx, sy] = w2s(v, PIER.x + 10, PIER.z - 14);
    outlineText(bctx, 'HARBOR', sx, sy, '700 12px Consolas,monospace', '#ffe9a8');
  }



  // building names
  for (const b of BUILDINGS) {
    const t = SHORT[b.id];
    if (!t) continue;
    const [sx, sy] = w2s(v, b.x, b.z);
    outlineText(bctx, t, sx, sy + (b.d * s) / 2 + 8, '600 9px Consolas,monospace', '#ffffff');
  }



  // icons
  for (const b of BUILDINGS) {
    if (b.id === 'base-barracks-a' || b.id === 'base-barracks-b') {
      const [sx, sy] = w2s(v, b.x, b.z); icon(bctx, 'barracks', sx, sy, 7, 1);
    } else if (b.id === 'town-hall') {
      const [sx, sy] = w2s(v, b.x, b.z); icon(bctx, 'townhall', sx, sy, 7, 1);
    }
  }



  // your soldiers, then you
  for (const sd of (ctx.getSoldiers() || [])) {
    if (sd.dead) continue;
    const [sx, sy] = w2s(v, sd.x, sd.z);
    dot(bctx, sx, sy, 4.5, '#2f7bff', 1);
  }
  const [ux, uy] = w2s(v, p.x, p.z);
  drawArrow(bctx, ux, uy, 1.3, -p.yaw);



  // legend
  bctx.fillStyle = 'rgba(0,0,0,0.6)';
  bctx.fillRect(10, H - 34, 440, 24);
  bctx.font = '600 11px Consolas,monospace'; bctx.textAlign = 'left'; bctx.textBaseline = 'middle';
  bctx.fillStyle = '#38e1ff'; bctx.fillText('▲ YOU', 18, H - 22);
  bctx.fillStyle = '#6fa8ff'; bctx.fillText('● SQUAD', 88, H - 22);
  bctx.fillStyle = '#ffd84a'; bctx.fillText('■ GATE', 168, H - 22);
  bctx.fillStyle = '#7fb0ff'; bctx.fillText('B BARRACKS', 238, H - 22);
  bctx.fillStyle = '#ffcc33'; bctx.fillText('★ TOWN HALL', 342, H - 22);
}



function setBig(on) {
  if (on === bigOpen) return;
  bigOpen = on;
  if (on) {
    big.width = Math.max(480, Math.min(window.innerWidth - 60, 1100));
    big.height = Math.max(320, Math.min(window.innerHeight - 130, 700));
    footEl.textContent = 'Press ' + mapLabel() + ' to close  ·  enemies are not shown here: use the radar in the corner for nearby threats';
    overlay.style.display = 'flex';
    bigT = 99;                               // draw at once
  } else {
    overlay.style.display = 'none';
  }
}




/* ======================================================================
   Feature-file interface (called by extras.js)
   ====================================================================== */
export function init(ctx) {
  // minimap (top-right)
  wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;top:' + CORNER.top + 'px;right:' + CORNER.right + 'px;z-index:18;' +
    'display:none;pointer-events:none;width:' + MINI_SIZE + 'px;text-align:center;';
  mini = document.createElement('canvas');
  mini.width = MINI_SIZE; mini.height = MINI_SIZE;
  mini.style.cssText = 'display:block;border-radius:50%;box-shadow:0 0 14px rgba(0,0,0,0.7);' +
    'background:rgba(0,0,0,0.35);';
  mctx = mini.getContext('2d');
  zoneEl = document.createElement('div');
  zoneEl.style.cssText = 'margin-top:5px;font:700 11px Consolas,monospace;letter-spacing:1px;color:#e8f4ff;' +
    'text-shadow:0 0 5px #000,0 0 5px #000;';
  wrap.appendChild(mini);
  wrap.appendChild(zoneEl);
  document.body.appendChild(wrap);



  // big map overlay
  overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:40;display:none;' +
    'flex-direction:column;align-items:center;justify-content:center;pointer-events:none;' +
    'background:rgba(0,0,0,0.55);font-family:Consolas,monospace;color:#e8f4ff;';
  const title = document.createElement('div');
  title.textContent = 'ISLAND MAP';
  title.style.cssText = 'font:900 20px Consolas,monospace;letter-spacing:6px;margin-bottom:8px;';
  big = document.createElement('canvas');
  big.style.cssText = 'border:2px solid rgba(255,255,255,0.6);border-radius:6px;box-shadow:0 0 30px #000;';
  bctx = big.getContext('2d');
  footEl = document.createElement('div');
  footEl.style.cssText = 'margin-top:8px;font-size:12px;opacity:0.8;letter-spacing:1px;';
  overlay.appendChild(title); overlay.appendChild(big); overlay.appendChild(footEl);
  document.body.appendChild(overlay);



  buildShapes();
  findAir();
  console.log('[minimap] v2 ready. ' + mapLabel() + ' = big map');
}



export function update(dt, ctx) {
  genTerrain();                                   // keeps painting until the picture is complete



  const show = ctx.isPlaying() && !ctx.player.dead;
  wrap.style.display = show ? 'block' : 'none';
  if (!show) { if (bigOpen) setBig(false); return; }



  miniT += dt;
  if (miniT >= 1 / MINI_FPS) { miniT = 0; drawMini(ctx); }



  zoneT += dt;
  if (zoneT >= 0.25) {
    zoneT = 0;
    zoneEl.textContent = zoneAt(ctx.player.x, ctx.player.z) + '  ·  ' + mapLabel() + ' MAP';
  }



  if (bigOpen) {
    bigT += dt;
    if (bigT >= 1 / BIG_FPS) { bigT = 0; drawBig(ctx); }
  }
}



export function onKey(code, ctx) {
  if (code === mapKey()) { setBig(!bigOpen); return true; }
  return false;
}



export function onEvent(name) {
  if ((name === 'died' || name === 'restart') && bigOpen) setBig(false);
}



export function reset() {
  if (bigOpen) setBig(false);
}