// games/campaign/assets.js
// Campaign Mode: shared loaders for textures and GLB/GLTF models.
// - loadTexture(file, opts)   -> THREE.Texture (tiled, correct colour space, cached)
// - loadModel(name)           -> Promise<THREE.Group | null>  (null = file missing/blocked, use fallback)
//                                name may include an extension; it is ignored (.glb tried first, then .gltf)
// - cloneModel(root)          -> independent copy of a loaded model
// - getMeshParts(root)        -> [{ geometry, material }] with transforms baked in (for InstancedMesh)
// - modelSize(root)           -> THREE.Vector3 size in metres
// v3: pines are always recoloured: dark green leaves + brown trunk (read from the model's own colours).
//     tree_pineGround* are blocked (they look like a tan blob). Houses keep the colormap palette.


import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';


const TEX_BASE = new URL('./textures/', import.meta.url).href;
const MODEL_BASE = new URL('./models/', import.meta.url).href;


/* Models that are never used */
const BLOCKED = ['tree_pineGroundA', 'tree_pineGroundB'];


/* ---------------- Textures ---------------- */
const texLoader = new THREE.TextureLoader();
const texCache = new Map();


// file: e.g. 'asphalt_diff.jpg'
// opts: { repeat: [x, y], srgb: true (colour maps) / false (normal, roughness), aniso: 4 }
export function loadTexture(file, opts = {}) {
  const repeat = opts.repeat || [1, 1];
  const srgb = opts.srgb !== false;
  const aniso = opts.aniso || 4;
  const key = file + '|' + repeat[0] + 'x' + repeat[1] + '|' + srgb + '|' + aniso;
  if (texCache.has(key)) return texCache.get(key);


  const tex = texLoader.load(TEX_BASE + file, undefined, undefined, () => {
    console.warn('[assets] Texture not found: ' + TEX_BASE + file);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = aniso;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texCache.set(key, tex);
  return tex;
}


/* ---------------- Models ---------------- */
const gltfLoader = new GLTFLoader();
const modelCache = new Map();
let colormapTex = null;


// Kenney SUBURBAN palette texture (models/colormap.png). Houses only.
function getColormap() {
  if (!colormapTex) {
    colormapTex = texLoader.load(MODEL_BASE + 'colormap.png', undefined, undefined, () => {
      console.warn('[assets] colormap.png not found in models folder');
    });
    colormapTex.flipY = false;                      // glTF UV convention
    colormapTex.colorSpace = THREE.SRGBColorSpace;
    colormapTex.magFilter = THREE.NearestFilter;    // crisp palette colours, no bleeding
    colormapTex.minFilter = THREE.NearestFilter;
    colormapTex.generateMipmaps = false;
  }
  return colormapTex;
}


function isPlainWhite(m) {
  return m && m.color && m.color.r > 0.95 && m.color.g > 0.95 && m.color.b > 0.95;
}


function kindOf(base) {
  const n = base.toLowerCase();
  if (n.startsWith('building')) return 'house';
  if (n.startsWith('tree')) return 'tree';
  if (n.startsWith('rock')) return 'rock';
  return 'other';
}


/* Natural colours */
const TRUNK = new THREE.Color(0x4a3020);
const LEAF_LOW = new THREE.Color(0x123d17);
const LEAF_HIGH = new THREE.Color(0x2a6a24);
const STONE_LOW = new THREE.Color(0x55575a);
const STONE_HIGH = new THREE.Color(0x8a8c8e);


/* Read pixel colours from a model texture (to tell trunk from leaves) */
const samplerCache = new Map();
function getSampler(map) {
  if (samplerCache.has(map)) return samplerCache.get(map);
  let fn = null;
  try {
    const img = map.image;
    const w = img && (img.width || img.naturalWidth);
    const h = img && (img.height || img.naturalHeight);
    if (w && h) {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      fn = (u, v) => {
        const x = Math.min(w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * w)));
        const y = Math.min(h - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * h)));
        const k = (y * w + x) * 4;
        return [data[k] / 255, data[k + 1] / 255, data[k + 2] / 255];
      };
    }
  } catch (e) { fn = null; }
  samplerCache.set(map, fn);
  return fn;
}


/* Pines: brown trunk + dark green leaves, whatever colours the file came with */
function paintTree(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const minY = box.min.y;
  const H = Math.max(box.max.y - box.min.y, 0.0001);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });


  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    const pos = geo.attributes.position;
    const uvA = geo.attributes.uv;
    const colA = geo.attributes.color;
    const m = Array.isArray(o.material) ? null : o.material;
    const sampler = m && m.map ? getSampler(m.map) : null;
    const base = m && m.color ? m.color : null;
    const baseKnown = base && !isPlainWhite(m);
    const known = !!(sampler || colA || baseKnown);


    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const t = Math.min(1, Math.max(0, (v.y - minY) / H));


      let r = 1, g = 1, b = 1;
      if (base) { r = base.r; g = base.g; b = base.b; }
      if (colA) { r *= colA.getX(i); g *= colA.getY(i); b *= colA.getZ(i); }
      if (sampler && uvA) {
        const s = sampler(uvA.getX(i), uvA.getY(i));
        r *= s[0]; g *= s[1]; b *= s[2];
      }


      const isTrunk = known ? (r > g) : (t < 0.2);   // tan/brown = trunk, anything else = leaves
      if (isTrunk) c.copy(TRUNK);
      else c.copy(LEAF_LOW).lerp(LEAF_HIGH, t);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    o.material = mat;
    o.castShadow = true;
    o.receiveShadow = true;
  });
}


/* Rocks without usable colours: simple grey gradient */
function paintRock(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const minY = box.min.y;
  const H = Math.max(box.max.y - box.min.y, 0.0001);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });


  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const t = Math.min(1, Math.max(0, (v.y - minY) / H));
      c.copy(STONE_LOW).lerp(STONE_HIGH, t);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    o.material = mat;
    o.castShadow = true;
    o.receiveShadow = true;
  });
}


function fixMaterials(root, kind) {
  if (kind === 'tree') { paintTree(root); return; }


  // Houses: Kenney suburban palette for plain white materials
  if (kind === 'house') {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const fixed = mats.map((m) => {
        if (m && !m.map && isPlainWhite(m) && o.geometry.attributes.uv) {
          return new THREE.MeshStandardMaterial({ map: getColormap(), roughness: 0.9, metalness: 0 });
        }
        if (m) { m.roughness = Math.max(m.roughness ?? 0.9, 0.8); m.metalness = 0; }
        return m;
      });
      o.material = Array.isArray(o.material) ? fixed : fixed[0];
    });
    return;
  }


  // Rocks (and anything else): keep own colours, paint grey only if the model has nothing usable
  let needsPaint = false;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (o.geometry.attributes.color) m.vertexColors = true;
      else if (!m.map && isPlainWhite(m)) needsPaint = true;
      m.roughness = Math.max(m.roughness ?? 0.9, 0.8);
      m.metalness = 0;
      m.needsUpdate = true;
    }
  });
  if (needsPaint && kind === 'rock') paintRock(root);
}


function baseName(name) {
  return name.replace(/\.(glb|gltf)$/i, '');
}


// name: 'tree_pineDefaultA' or 'tree_pineDefaultA.glb' (extension is ignored)
export function loadModel(name) {
  const base = baseName(name);
  if (BLOCKED.includes(base)) return Promise.resolve(null);
  if (modelCache.has(base)) return modelCache.get(base);


  const kind = kindOf(base);
  const promise = (async () => {
    for (const ext of ['glb', 'gltf']) {
      const url = MODEL_BASE + base + '.' + ext;
      try {
        const gltf = await gltfLoader.loadAsync(url);
        fixMaterials(gltf.scene, kind);
        return gltf.scene;
      } catch (e) {
        // try the next extension
      }
    }
    console.warn('[assets] Model not loaded (using fallback): ' + base);
    return null;
  })();


  modelCache.set(base, promise);
  return promise;
}


export function cloneModel(root) {
  return root.clone(true);
}


export function modelSize(root) {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
}


// Flatten a model into plain geometry + material pairs (transforms baked in).
// Perfect for building InstancedMesh objects (trees, rocks).
export function getMeshParts(root) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone();
    geometry.applyMatrix4(o.matrixWorld);
    const material = Array.isArray(o.material) ? o.material[0] : o.material;
    parts.push({ geometry, material });
  });
  return parts;
}