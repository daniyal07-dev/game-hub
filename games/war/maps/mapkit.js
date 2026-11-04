// games/war/maps/mapkit.js
// Turns a simple map description into a real 3D map with collision and pathfinding grid.
// v5: camp pieces (def.camp) with automatic collision from the model's real size.
//     Realistic look: no neon lane, no neon outlines, no coloured paint.

import * as THREE from 'three';
import { getTheme, makeFloor, neonMaterial } from '../core/look.js';
import { makeProp, makeCrater, makeCampPiece } from '../core/models.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- SETTINGS (easy to tweak) ---------- */
const TEXTURES = true;                                            // false = plain colours
const TEX_BASE = new URL('../../../textures/', import.meta.url).href;
const FLOOR_TILE = 8;        // metres covered by one floor texture repeat
const WALL_TILE = 5;         // metres covered by one wall texture repeat
const PAINT_TILE = 3;        // same, for containers and barriers
const STRIP_OPACITY = 0;     // flat lane on the floor. 0 = completely removed
const PERIMETER_H = 7;       // height of the outer wall around the map
const CAMP_FIT = 0.85;       // collision box = this fraction of the model's real footprint

/* ---------- NEON EXTRAS (all OFF for the realistic look) ---------- */
const EDGE_OPACITY = 0;      // coloured outline on block edges
const TOP_STRIP = false;     // glowing strip on top of every block
const PERIMETER_CAP = false; // glowing strip on top of the outer wall

// floor = texture set, tint = colour mixed in, bright = brightness multiplier
const LOOKS = {
  neon:    { floor: 'ground', floorTint: 0xffffff, floorBright: 1.0, wallTint: 0xffffff, wallBright: 1.2 },
  desert:  { floor: 'sand',   floorTint: 0xffffff, floorBright: 1.0, wallTint: 0xd9b88e, wallBright: 1.4 },
  frozen:  { floor: 'snow',   floorTint: 0xffffff, floorBright: 0.8, wallTint: 0xb4cce6, wallBright: 1.3 },
  toxic:   { floor: 'ground', floorTint: 0xa8d090, floorBright: 1.0, wallTint: 0x9ec088, wallBright: 1.3 },
  orbital: { floor: 'ground', floorTint: 0xd8b8b0, floorBright: 1.0, wallTint: 0xc8a8a0, wallBright: 1.3 }
};

// natural tints for cover (multiplied with the concrete texture)
const CONTAINER_TINT = 0x8f9a8f;   // military grey-green
const BARRIER_TINT = 0xc8c4b8;     // light concrete

// each texture file is loaded only once, even across stages (tries .jpg then .png)
const texCache = {};
function loadTex(name, srgb) {
  if (!texCache[name]) {
    texCache[name] = new Promise((resolve) => {
      const loader = new THREE.TextureLoader();
      const attempt = (ext) => loader.load(
        TEX_BASE + name + ext,
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = 8;
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          resolve(t);
        },
        undefined,
        () => { if (ext === '.jpg') attempt('.png'); else resolve(null); }
      );
      attempt('.jpg');
    });
  }
  return texCache[name];
}

// give each face of a box texture coordinates in metres, so textures never look stretched
function worldUV(geo, w, h, d, tile) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // px, nx, py, ny, pz, nz
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  uv.needsUpdate = true;
}

function setMap(mat, key, tex, rx, ry) {
  if (!tex) return;
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  mat[key] = t;
}

export function createMap(def) {
  const T = getTheme(def.theme);
  const size = def.size || 120;
  const half = size / 2;
  const group = new THREE.Group();
  const obstacles = [];
  const blockers = [];
  const accentA = T.lights[0];
  const accentB = T.lights[1];
  const look = LOOKS[def.theme] || LOOKS.neon;

  // plain neutral materials (textures are added below once loaded).
  // emissive is black, so nothing glows by itself.
  const mk = (color, metal, rough) => new THREE.MeshStandardMaterial({
    color, metalness: metal, roughness: rough, envMapIntensity: 0.7,
    emissive: 0x000000, emissiveIntensity: 0
  });
  const base = new THREE.Color(T.floor).multiplyScalar(1.2);
  const mats = {
    wall:      mk(base, 0.05, 0.85),
    pillar:    mk(base, 0.05, 0.85),
    container: mk(new THREE.Color(CONTAINER_TINT), 0.25, 0.6),
    barrier:   mk(new THREE.Color(BARRIER_TINT), 0.05, 0.9),
    ruin:      mk(base, 0.05, 0.9)
  };
  const edgeColor = { wall: accentA, pillar: accentA, container: accentB, barrier: accentA, ruin: T.grid1 };
  const texturedStyles = ['wall', 'pillar', 'ruin', 'container', 'barrier'];
  const paintedStyles = ['container', 'barrier'];

  const floorObj = makeFloor(size, def.theme);
  group.add(floorObj);

  // hide the faint neon grid lines on the floor (realistic look)
  floorObj.traverse((o) => { if (o.isGridHelper || o.type === 'GridHelper') o.visible = false; });

  /* ---------- apply real textures when they finish loading ---------- */
  if (TEXTURES) {
    Promise.all([
      loadTex(look.floor + '_diff', true), loadTex(look.floor + '_nor', false), loadTex(look.floor + '_rough', false),
      loadTex('wall_diff', true), loadTex('wall_nor', false), loadTex('wall_rough', false)
    ]).then(([fd, fn, fr, wd, wn, wr]) => {
      // ----- floor -----
      if (fd) {
        floorObj.traverse((o) => {
          if (!o.isMesh || !o.geometry || o.geometry.type !== 'PlaneGeometry') return;
          const m = o.material;
          if (!m || Array.isArray(m) || !m.isMeshStandardMaterial || m.transparent) return;
          const w = (o.geometry.parameters && o.geometry.parameters.width) || size;
          const rep = w / FLOOR_TILE;

          if (m.map && !m.emissiveMap) {
            m.emissiveMap = m.map;
            m.emissive.set(0xffffff);
            m.emissiveIntensity = 0.8;
          } else {
            m.emissiveIntensity = Math.min(m.emissiveIntensity, 0.05);
          }
          m.map = null;
          setMap(m, 'map', fd, rep, rep);
          setMap(m, 'normalMap', fn, rep, rep);
          if (fr) { setMap(m, 'roughnessMap', fr, rep, rep); m.roughness = 1; }
          m.color.set(look.floorTint).multiplyScalar(look.floorBright);
          m.metalness = 0.0;
          m.envMapIntensity = 0.5;
          m.needsUpdate = true;
        });
      }

      // ----- walls, pillars, ruins, containers, barriers -----
      if (wd) {
        for (const style of texturedStyles) {
          const m = mats[style];
          m.map = wd;                     // shared, UVs are already in metres
          if (wn) m.normalMap = wn;
          if (wr) { m.roughnessMap = wr; m.roughness = 1; }
          if (style === 'container') m.color.set(CONTAINER_TINT).multiplyScalar(1.3);
          else if (style === 'barrier') m.color.set(BARRIER_TINT).multiplyScalar(1.3);
          else m.color.set(look.wallTint).multiplyScalar(look.wallBright);
          m.emissive.set(0x000000);
          m.emissiveIntensity = 0;
          m.metalness = paintedStyles.includes(style) ? 0.15 : 0.05;
          m.envMapIntensity = 0.6;
          m.needsUpdate = true;
        }
      }
      console.log('✅ War textures applied:', look.floor, wd ? '+ walls' : '(no wall texture)');
    }).catch((err) => console.warn('War textures skipped:', err));
  }

  // flat lane / road markings: removed (only drawn if STRIP_OPACITY is above 0)
  if (STRIP_OPACITY > 0) {
    (def.strips || []).forEach(s => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), neonMaterial(s.color ?? accentA, STRIP_OPACITY));
      m.rotation.x = -Math.PI / 2;
      m.position.set(s.x, 0.04, s.z);
      group.add(m);
    });
  }

  function addBlock(b) {
    const style = b.style || 'wall';
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    if (TEXTURES && texturedStyles.includes(style)) {
      worldUV(geo, b.w, b.h, b.d, paintedStyles.includes(style) ? PAINT_TILE : WALL_TILE);
    }
    const mesh = new THREE.Mesh(geo, mats[style] || mats.wall);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (EDGE_OPACITY > 0) {
      mesh.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: edgeColor[style] || accentA, transparent: true, opacity: EDGE_OPACITY, toneMapped: false })
      ));
    }
    group.add(mesh);
    blockers.push(mesh);

    if (TOP_STRIP) {
      const top = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.05, 0.1, b.d + 0.05), neonMaterial(edgeColor[style] || accentA));
      top.position.set(b.x, b.h + 0.02, b.z);
      group.add(top);
    }

    obstacles.push({
      minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
      minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
      h: b.h
    });
  }
  (def.walls || []).forEach(addBlock);

  (def.props || []).forEach(p => {
    const obj = makeProp(p.i || 0, p.size || 3.5);
    obj.position.set(p.x, 0, p.z);
    obj.rotation.y = p.rot || 0;
    group.add(obj);
    if (p.solid !== false) {
      const r = (p.size || 3.5) * 0.4;
      obstacles.push({ minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r, h: p.size || 3.5 });
      const hit = new THREE.Mesh(new THREE.BoxGeometry(r * 2, p.size || 3.5, r * 2), new THREE.MeshBasicMaterial());
      hit.position.set(p.x, (p.size || 3.5) / 2, p.z);
      hit.visible = false;
      group.add(hit);
      blockers.push(hit);
    }
  });

  /* ---------- camp pieces (tent, sandbags, crates, barrels) ---------- */
  // def.camp = [{ piece:'sandbags', x, z, size, yaw, solid }]
  // Collision is measured from the model itself, so you never type box sizes.
  (def.camp || []).forEach(c => {
    const obj = makeCampPiece(c.piece, c.size || 3, { yaw: c.yaw || 0 });
    obj.position.set(c.x, 0, c.z);
    group.add(obj);
    if (c.solid === false) return;

    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const w = Math.max(0.3, (bb.max.x - bb.min.x) * CAMP_FIT);
    const d = Math.max(0.3, (bb.max.z - bb.min.z) * CAMP_FIT);
    const h = Math.max(0.3, bb.max.y);

    obstacles.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
    const hit = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
    hit.position.set(cx, h / 2, cz);
    hit.visible = false;
    group.add(hit);
    blockers.push(hit);
  });

  (def.craters || []).forEach(c => {
    const obj = makeCrater(c.size || 8);
    obj.position.set(c.x, 0, c.z);
    group.add(obj);
  });

  /* ---------- perimeter wall ---------- */
  // [centreX, centreZ, width, depth]; inner face sits exactly on the map edge
  [
    [0, -(half + 0.5), size + 2, 1],
    [0,  (half + 0.5), size + 2, 1],
    [-(half + 0.5), 0, 1, size],
    [ (half + 0.5), 0, 1, size]
  ].forEach(([cx, cz, w, d]) => {
    const geo = new THREE.BoxGeometry(w, PERIMETER_H, d);
    if (TEXTURES) worldUV(geo, w, PERIMETER_H, d, WALL_TILE);
    const wallMesh = new THREE.Mesh(geo, mats.wall);
    wallMesh.position.set(cx, PERIMETER_H / 2, cz);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    group.add(wallMesh);
    blockers.push(wallMesh);

    if (PERIMETER_CAP) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.12, d + 0.05), neonMaterial(accentB));
      cap.position.set(cx, PERIMETER_H + 0.03, cz);
      group.add(cap);
    }
  });

  function hitsBox(x, z, r, b) {
    const dx = x - clamp(x, b.minX, b.maxX);
    const dz = z - clamp(z, b.minZ, b.maxZ);
    return dx * dx + dz * dz < r * r;
  }

  function isBlocked(x, z, r = 0.5) {
    if (Math.abs(x) > half - r || Math.abs(z) > half - r) return true;
    for (let i = 0; i < obstacles.length; i++) {
      if (hitsBox(x, z, r, obstacles[i])) return true;
    }
    return false;
  }

  function move(pos, dx, dz, r = 0.5) {
    if (!isBlocked(pos.x + dx, pos.z, r)) pos.x += dx;
    if (!isBlocked(pos.x, pos.z + dz, r)) pos.z += dz;
  }

  function segHitsBox(x1, z1, x2, z2, b) {
    let t0 = 0, t1 = 1;
    const axes = [[x1, x2 - x1, b.minX, b.maxX], [z1, z2 - z1, b.minZ, b.maxZ]];
    for (const [p, d, mn, mx] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (p < mn || p > mx) return false;
      } else {
        let a = (mn - p) / d, c = (mx - p) / d;
        if (a > c) { const t = a; a = c; c = t; }
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, c);
        if (t0 > t1) return false;
      }
    }
    return true;
  }

  function hasLineOfSight(x1, z1, x2, z2) {
    for (let i = 0; i < obstacles.length; i++) {
      if (segHitsBox(x1, z1, x2, z2, obstacles[i])) return false;
    }
    return true;
  }

  const ray = new THREE.Raycaster();
  function rayDistance(origin, dir, maxDist = 200) {
    ray.set(origin, dir);
    ray.far = maxDist;
    const hits = ray.intersectObjects(blockers, false);
    return hits.length ? hits[0].distance : maxDist;
  }

  function buildGrid(cell = 2, pad = 0.9) {
    const n = Math.round(size / cell);
    const blocked = new Uint8Array(n * n);
    for (let cz = 0; cz < n; cz++) {
      for (let cx = 0; cx < n; cx++) {
        const x = (cx + 0.5) * cell - half;
        const z = (cz + 0.5) * cell - half;
        if (isBlocked(x, z, pad)) blocked[cz * n + cx] = 1;
      }
    }
    return {
      n, cell, half, blocked,
      toCell(x, z) {
        return {
          cx: clamp(Math.floor((x + half) / cell), 0, n - 1),
          cz: clamp(Math.floor((z + half) / cell), 0, n - 1)
        };
      },
      toWorld(cx, cz) { return { x: (cx + 0.5) * cell - half, z: (cz + 0.5) * cell - half }; },
      walkable(cx, cz) { return cx >= 0 && cz >= 0 && cx < n && cz < n && !blocked[cz * n + cx]; }
    };
  }
  const grid = buildGrid();

  const ps = def.playerStart || { x: 0, z: half - 12 };
  return {
    id: def.id,
    name: def.name,
    theme: def.theme,
    size, half,
    group,
    obstacles, blockers, grid,
    playerStart: ps,
    squadStart: def.squad || [[ps.x - 3, ps.z + 2], [ps.x + 3, ps.z + 2], [ps.x - 5, ps.z + 4], [ps.x + 5, ps.z + 4]],
    spawns: {
      ground: def.groundSpawns || [],
      air: def.airSpawns || [],
      turrets: def.turrets || [],
      mechs: def.mechs || []
    },
    pickups: def.pickups || [],
    points: def.points || {},
    isBlocked, move, hasLineOfSight, rayDistance,

    dispose() {
      group.parent && group.parent.remove(group);
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
      });
    }
  };
}