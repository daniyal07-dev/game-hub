// games/campaign/terrain.js
// Campaign Mode, Phase 1: the island ground.
// - heightAt(x, z): ground height anywhere (the player walks on this)
// - createTerrain(quality): builds the ground mesh + the sea
// - ZONES: flat areas reserved for the base, town and airfield
// - zoneAt(x, z): name of the place you are standing in (for the small HUD)
// The island is the same every time (fixed seed). World is 1300 x 1300 m, island about 800 m wide.
// Visual upgrade: a tiling grass texture adds fine detail on top of the vertex colours.
// Map upgrade: base and airfield flat zones are bigger so the fences, gates and buildings sit on flat ground.



import * as THREE from 'three';
import { loadTexture } from './assets.js';



/* ---------- Knobs ---------- */
export const WORLD = { size: 1300, islandR: 440 };
export const WATER_LEVEL = 0;
const SEED = 90210;
const SEG = { low: 120, medium: 200, high: 300 };   // ground detail per quality
const DETAIL_TILE_M = 6;       // one grass texture tile covers about this many metres
const DETAIL_STRENGTH = 0.85;  // 0 = no texture detail, 1 = full



/* Airfield frame (same numbers as layout.js): u runs along the runway from its start,
   v is the distance to the north side of the runway. Kept here so terrain.js
   does not import layout.js (layout.js imports terrain.js). */
const RW_A = [-125, 138], RW_B = [25, 190];
const RW_LEN = Math.hypot(RW_B[0] - RW_A[0], RW_B[1] - RW_A[1]);
const EX = (RW_B[0] - RW_A[0]) / RW_LEN, EZ = (RW_B[1] - RW_A[1]) / RW_LEN;
const NX = EZ, NZ = -EX;
const airPt = (u, v) => [RW_A[0] + EX * u + NX * v, RW_A[1] + EZ * u + NZ * v];
const AF1 = airPt(20, 15), AF2 = airPt(140, 15);



/* Flat areas. A zone is a "capsule": a line from (ax,az) to (bx,bz) with radius r.
   Inside r the ground is perfectly flat at height h; it blends into the hills outside. */
export const ZONES = [
  { id: 'base',    name: 'STRIKE COMMAND BASE', ax: -155, az: -110, bx: -125, bz: -110, r: 58, h: 9, tint: [0.36, 0.38, 0.40] },
  { id: 'town',    name: 'PORT TOWN',           ax: 120,  az: 80,   bx: 120,  bz: 80,   r: 65, h: 6, tint: [0.42, 0.38, 0.33] },
  { id: 'airfield',name: 'AIRFIELD',            ax: AF1[0], az: AF1[1], bx: AF2[0], bz: AF2[1], r: 56, h: 5, tint: [0.34, 0.35, 0.36] }
];
const PEAK = { x: 150, z: -170, r: 70, height: 75 };



/* Player start: inside the base, just north of the Motor Pool, next to Main Street */
export const SPAWN = { x: -122, z: -103 };



/* ---------- Small helpers ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
const lerp = (a, b, t) => a + (b - a) * t;



function hash(ix, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ SEED;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, z * f); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}



function segDist(x, z, zn) {
  const dx = zn.bx - zn.ax, dz = zn.bz - zn.az;
  const len2 = dx * dx + dz * dz;
  let t = len2 ? ((x - zn.ax) * dx + (z - zn.az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(x - (zn.ax + dx * t), z - (zn.az + dz * t));
}



/* ---------- The height of the ground ---------- */
export function heightAt(x, z) {
  // island outline (a circle with a wobbly coast)
  const d = Math.hypot(x, z) / WORLD.islandR;
  const shape = d + (fbm(x * 0.004 + 10, z * 0.004 + 10, 3) - 0.5) * 0.3;
  const mask = 1 - smooth(0.66, 0.95, shape);          // 1 = land, 0 = open sea
  const inland = smooth(0.7, 1.0, mask);               // hills only well inside the coast



  // hills + small bumps + one mountain
  const hills = Math.max(0, fbm(x * 0.0055, z * 0.0055, 4) - 0.35) * 55;
  const bumps = (fbm(x * 0.03, z * 0.03, 3) - 0.5) * 3;
  const pd = Math.hypot(x - PEAK.x, z - PEAK.z);
  const peak = PEAK.height * Math.exp(-(pd * pd) / (2 * PEAK.r * PEAK.r));
  const land = 4 + (hills + bumps + peak) * inland;



  let h = lerp(-7, land, mask);                        // sea floor -> beach -> land



  // flat zones for base / town / airfield
  for (const zn of ZONES) {
    const w = 1 - smooth(zn.r, zn.r * 1.7, segDist(x, z, zn));
    if (w > 0) h = lerp(h, zn.h, w);
  }
  return h;
}



/* Name of the place for the small on-screen label */
export function zoneAt(x, z) {
  for (const zn of ZONES) if (segDist(x, z, zn) <= zn.r * 1.2) return zn.name;
  const h = heightAt(x, z);
  if (h < -0.3) return 'SEA';
  if (h < 2.5) return 'BEACH';
  if (h > 30) return 'MOUNTAIN PEAK';
  if (h > 14) return 'HILLS';
  return 'GRASSLAND';
}



/* ---------- Build the ground and the sea ---------- */
const SAND = [0.76, 0.70, 0.50], WETSAND = [0.55, 0.50, 0.38], SEABED = [0.25, 0.32, 0.34];
const GRASS_A = [0.27, 0.46, 0.20], GRASS_B = [0.20, 0.36, 0.15], ROCK = [0.46, 0.43, 0.40];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];



/* Ground material: vertex colours stay in charge of the colour,
   the grass texture only adds light/dark detail (brightness), at two scales to hide tiling. */
function createGroundMaterial() {
  const tiles = WORLD.size / DETAIL_TILE_M;
  const grassMap = loadTexture('grass_diff.jpg', { repeat: [tiles, tiles], srgb: true, aniso: 8 });


  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: grassMap,
    roughness: 1,
    metalness: 0
  });


  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: DETAIL_STRENGTH };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uDetail;\nvoid main() {')
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
          // heavy mip bias gives the texture's average colour
          float avgL = dot(texture2D(map, vMapUv, 16.0).rgb, LUM) + 0.0001;
          float l1 = dot(texture2D(map, vMapUv).rgb, LUM) / avgL;
          float l2 = dot(texture2D(map, vMapUv * 0.173 + vec2(0.37, 0.11)).rgb, LUM) / avgL;
          float detail = clamp(l1 * mix(1.0, l2, 0.6), 0.35, 1.9);
          diffuseColor.rgb *= mix(1.0, detail, uDetail);
        #endif
      `);
  };
  mat.customProgramCacheKey = () => 'campaign-ground-detail-v1';
  return mat;
}



export function createTerrain(quality) {
  const seg = SEG[quality] || SEG.medium;
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, seg, seg);
  geo.rotateX(-Math.PI / 2);



  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();



  const nor = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), h = pos.getY(i), z = pos.getZ(i);
    const ny = nor.getY(i);                                  // 1 = flat, small = steep



    let c;
    if (h < -0.4) c = mix(WETSAND, SEABED, smooth(-0.4, -4, h));
    else if (h < 2.5) c = mix(WETSAND, SAND, smooth(-0.4, 1.2, h));
    else {
      const grass = mix(GRASS_A, GRASS_B, vnoise(x * 0.02 + 5, z * 0.02 + 5));
      c = mix(SAND, grass, smooth(2.5, 4.5, h));
    }
    // rock on steep slopes and high up
    const rockAmt = Math.max(smooth(0.86, 0.68, ny), smooth(26, 40, h));
    if (rockAmt > 0 && h > 1) c = mix(c, ROCK, rockAmt);



    // flat zones get a concrete / dirt tint
    for (const zn of ZONES) {
      const w = 1 - smooth(zn.r * 0.9, zn.r * 1.2, segDist(x, z, zn));
      if (w > 0) c = mix(c, zn.tint, w * 0.9);
    }



    // small colour variation so it is not flat-looking
    const v = 0.9 + 0.2 * vnoise(x * 0.15, z * 0.15);
    colors[i * 3] = c[0] * v; colors[i * 3 + 1] = c[1] * v; colors[i * 3 + 2] = c[2] * v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));



  const mesh = new THREE.Mesh(geo, createGroundMaterial());
  mesh.receiveShadow = true;



  // the sea
  const wgeo = new THREE.PlaneGeometry(8000, 8000);
  wgeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(wgeo, new THREE.MeshStandardMaterial({
    color: 0x1c6f8c, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.88
  }));
  water.position.y = WATER_LEVEL;



  return {
    mesh,
    water,
    update(t) { water.position.y = WATER_LEVEL + Math.sin(t * 0.7) * 0.06; }   // gentle waves
  };
}