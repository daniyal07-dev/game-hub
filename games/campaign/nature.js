// games/campaign/nature.js
// Campaign Mode: forest clusters + rocks using CC0 GLB models (Kenney Nature Kit),
// with the old procedural trees/rocks as a fallback if models fail to load.
// v5: seeded placement, roads/runway avoided using layout.js (pavedClearance),
//     base/town/airfield zones kept clear.
//     NEW: every trunk and rock is registered in treegrid.js so collision.js can make it solid.


import * as THREE from 'three';
import { heightAt, WORLD, ZONES } from './terrain.js';
import { MODELS, rng, pavedClearance } from './layout.js';
import { loadModel, getMeshParts } from './assets.js';
import { clearTrees, addTree, treeCount } from './treegrid.js';   // NEW


/* ---------- Knobs ---------- */
const TREE_HEIGHT_M = 9;     // tallest tree model ends up about this tall (before random scale)
const ROCK_WIDTH_M = 3.5;    // widest rock model ends up about this wide (before random scale)
const TREE_ROAD_CLEAR = 6;   // metres from road/runway edge
const ROCK_ROAD_CLEAR = 3.5;
const TRUNK_R = 0.4;         // NEW: trunk radius (m) at scale 1. Raise it if you can slip through trunks
const ROCK_R_FACTOR = 0.38;  // NEW: rock collision radius = this x ROCK_WIDTH_M x rock scale


function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}


function inAnyZone(x, z, extra) {
  for (const zn of ZONES) {
    if (distToSegment(x, z, zn.ax, zn.az, zn.bx, zn.bz) < zn.r + extra) return true;
  }
  return false;
}


function clusterNoise(x, z) {
  return Math.sin(x * 0.02) * Math.cos(z * 0.02) + Math.sin(x * 0.05 + z * 0.05) * 0.5;
}


/* Turn loaded models into normalised geometry sets (feet at y=0, centred, scaled together
   so the relative sizes between variants are kept). */
function makeVariants(roots, target, useHeight) {
  const sets = [];
  for (const root of roots) {
    if (!root) continue;
    root.updateMatrixWorld(true);
    const parts = getMeshParts(root);
    if (!parts || !parts.length) continue;
    const box = new THREE.Box3();
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox);
    }
    sets.push({ parts, box });
  }
  if (!sets.length) return [];


  const size = new THREE.Vector3();
  let ref = 0;
  for (const s of sets) {
    s.box.getSize(size);
    ref = Math.max(ref, useHeight ? size.y : Math.max(size.x, size.z));
  }
  const k = target / (ref || 1);


  for (const s of sets) {
    const cx = (s.box.min.x + s.box.max.x) * 0.5;
    const cz = (s.box.min.z + s.box.max.z) * 0.5;
    for (const p of s.parts) {
      p.geometry.translate(-cx, -s.box.min.y, -cz);
      p.geometry.scale(k, k, k);
    }
  }
  return sets.map((s) => s.parts);
}


function addInstanced(group, parts, matrices, cast) {
  if (!matrices.length) return;
  for (const p of parts) {
    const im = new THREE.InstancedMesh(p.geometry, p.material, matrices.length);
    for (let i = 0; i < matrices.length; i++) im.setMatrixAt(i, matrices[i]);
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = cast;
    im.receiveShadow = true;
    if (im.computeBoundingSphere) im.computeBoundingSphere();
    group.add(im);
  }
}


function distribute(items, variantCount) {
  const buckets = Array.from({ length: variantCount }, () => []);
  for (const it of items) {
    buckets[Math.min(variantCount - 1, Math.floor(it.pick * variantCount))].push(it.matrix);
  }
  return buckets;
}


/* ---------- Old procedural look (fallback) ---------- */
function proceduralTreeParts() {
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.45, 3.0, 6);
  trunkGeo.translate(0, 1.2, 0);
  const leaf1Geo = new THREE.ConeGeometry(1.8, 3.2, 6);
  leaf1Geo.translate(0, 3.2, 0);
  const leaf2Geo = new THREE.ConeGeometry(1.3, 2.6, 6);
  leaf2Geo.translate(0, 4.8, 0);
  return [
    { geometry: trunkGeo, material: new THREE.MeshStandardMaterial({ color: 0x3d2714, roughness: 0.9 }) },
    { geometry: leaf1Geo, material: new THREE.MeshStandardMaterial({ color: 0x1e3f1a, roughness: 0.8 }) },
    { geometry: leaf2Geo, material: new THREE.MeshStandardMaterial({ color: 0x275222, roughness: 0.8 }) }
  ];
}


function proceduralRockParts() {
  const g = new THREE.DodecahedronGeometry(1.2, 0);
  g.translate(0, 0.6, 0);
  return [{ geometry: g, material: new THREE.MeshStandardMaterial({ color: 0x5a5d60, roughness: 0.9 }) }];
}


export function createNature(group, quality) {
  // If quality changes while models are still loading, the older build is cancelled
  const token = (group.userData.natureBuild = (group.userData.natureBuild || 0) + 1);


  const counts = { low: 1000, medium: 2500, high: 5000 }[quality] || 2500;
  const castShadows = quality === 'high';   // shadows from thousands of trees cost FPS
  const rockLimit = Math.floor(counts * 0.35);
  const rand = rng(4242);


  clearTrees();                             // NEW: start a fresh list of solid trunks and rocks


  /* ---------- 1. Decide where everything goes (instant) ---------- */
  const trees = [];
  const rocks = [];
  const dummy = new THREE.Object3D();


  const maxAttempts = counts * 6;
  for (let i = 0; i < maxAttempts && trees.length < counts; i++) {
    const x = (rand() - 0.5) * WORLD.size * 0.82;
    const z = (rand() - 0.5) * WORLD.size * 0.82;


    // Draw all random numbers up front so the order never changes
    const rDensity = rand();
    const rScale = rand();
    const rStretch = rand();
    const rRot = rand();
    const rPick = rand();
    const rRockChance = rand();
    const rRockX = rand(), rRockZ = rand(), rRockS = rand(), rRockY = rand(), rRockRot = rand(), rRockPick = rand();


    const h = heightAt(x, z);
    if (h < 3.2 || h > 48) continue;                 // no water, beach or high peak
    if (inAnyZone(x, z, 10)) continue;               // base / town / airfield stay clear


    const density = clusterNoise(x, z);
    if (density < -0.15 && rDensity > 0.1) continue; // natural clusters


    if (pavedClearance(x, z) < TREE_ROAD_CLEAR) continue; // roads + runway


    const scale = 0.8 + rScale * 0.5;
    dummy.position.set(x, h - 0.1, z);
    dummy.rotation.set(0, rRot * Math.PI * 2, 0);
    dummy.scale.set(scale, scale * (0.9 + rStretch * 0.3), scale);
    dummy.updateMatrix();
    trees.push({ pick: rPick, matrix: dummy.matrix.clone() });
    addTree(x, z, TRUNK_R * scale);                  // NEW: the trunk is solid


    // Small rock next to some trees
    if (rRockChance < 0.22 && rocks.length < rockLimit) {
      const rx = x + (rRockX - 0.5) * 6;
      const rz = z + (rRockZ - 0.5) * 6;
      const rh = heightAt(rx, rz);
      if (rh > 2.5 && !inAnyZone(rx, rz, 4) && pavedClearance(rx, rz) >= ROCK_ROAD_CLEAR) {
        const rs = 0.5 + rRockS * 0.8;
        dummy.position.set(rx, rh - 0.25, rz);
        dummy.rotation.set(0, rRockRot * Math.PI * 2, 0);
        dummy.scale.set(rs, rs * (0.7 + rRockY * 0.3), rs);
        dummy.updateMatrix();
        rocks.push({ pick: rRockPick, matrix: dummy.matrix.clone() });
        addTree(rx, rz, ROCK_R_FACTOR * ROCK_WIDTH_M * rs);   // NEW: the rock is solid
      }
    }
  }
  console.log(`[nature] ${treeCount()} solid trunks and rocks registered (${quality})`);   // NEW


  /* ---------- 2. Load models, then build instanced meshes ---------- */
  const treeNames = MODELS.trees;
  const rockNames = MODELS.rocks;


  const ready = Promise.all([
    Promise.all(treeNames.map((n) => loadModel(n).catch(() => null))),
    Promise.all(rockNames.map((n) => loadModel(n).catch(() => null)))
  ])
    .then(([treeRoots, rockRoots]) => {
      if (group.userData.natureBuild !== token) return;   // a newer build replaced this one


      // Trees
      const treeSets = makeVariants(treeRoots, TREE_HEIGHT_M, true);
      if (treeSets.length) {
        const buckets = distribute(trees, treeSets.length);
        treeSets.forEach((parts, i) => addInstanced(group, parts, buckets[i], castShadows));
      } else {
        console.warn('[nature] no tree models loaded, using procedural trees');
        addInstanced(group, proceduralTreeParts(), trees.map((t) => t.matrix), castShadows);
      }


      // Rocks
      const rockSets = makeVariants(rockRoots, ROCK_WIDTH_M, false);
      if (rockSets.length) {
        const buckets = distribute(rocks, rockSets.length);
        rockSets.forEach((parts, i) => addInstanced(group, parts, buckets[i], castShadows));
      } else {
        console.warn('[nature] no rock models loaded, using procedural rocks');
        addInstanced(group, proceduralRockParts(), rocks.map((r) => r.matrix), castShadows);
      }


      console.log(`[nature] ${trees.length} trees, ${rocks.length} rocks (${quality})`);
    })
    .catch((err) => {
      console.warn('[nature] failed, using procedural fallback', err);
      if (group.userData.natureBuild !== token) return;
      addInstanced(group, proceduralTreeParts(), trees.map((t) => t.matrix), castShadows);
      addInstanced(group, proceduralRockParts(), rocks.map((r) => r.matrix), castShadows);
    });


  return { ready };
}