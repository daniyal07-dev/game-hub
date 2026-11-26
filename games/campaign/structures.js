// games/campaign/structures.js
// Campaign Mode: roads + runway, then everything from layout.js:
// fences + gates, named buildings with door signs, pads, props, runway numbers, pier.
// Static pieces are merged per material (few draw calls). Houses are Kenney GLB models.
// Flags: friendly flagpoles fly the flag of Pakistan, hostile ones the Space Gang flag (drawn in code).


import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt } from './terrain.js';
import {
  ROADS, RUNWAY, HOUSES, MODELS, PIER, GATES, FENCES, PADS, BUILDINGS, PROPS,
  rng, sampleRoad, pavedClearance
} from './layout.js';
import { loadTexture, loadModel, cloneModel, modelSize } from './assets.js';



/* ---------- Knobs ---------- */
const HOUSE_FRONT_OFFSET = 0;   // if the Kenney houses face the wrong way, try Math.PI, Math.PI/2 or -Math.PI/2
const SIGN_HEIGHT = 1.3;        // height of name signs in metres
const ROAD_LIFT = 0.14;         // road height above the ground (m). Too floaty: lower. Road sinking into ground in patches: raise (0.2)
const RUNWAY_LIFT = 0.16;       // same, for the runway
const FLAG_W = 3.0;             // flag width in metres (Pakistan's flag is 3:2)
const FLAG_H = 2.0;             // flag height in metres
const FLAG_Y = 11.1;            // height of the flag centre on the pole



export function createStructures(scene) {
  const group = new THREE.Group();
  const animators = [];
  const pending = [];
  const UP = new THREE.Vector3(0, 1, 0);
  const ONE = new THREE.Vector3(1, 1, 1);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));



  /* ========================================================
     1. ROAD MATERIALS
     ======================================================== */
  const asphaltMap = loadTexture('asphalt_diff.jpg', { repeat: [1, 1], srgb: true, aniso: 8 });
  const asphaltNor = loadTexture('asphalt_nor.jpg', { repeat: [1, 1], srgb: false, aniso: 8 });
  const asphaltRough = loadTexture('asphalt_rough.jpg', { repeat: [1, 1], srgb: false, aniso: 8 });



  function pavedMaterial(color, offset) {
    return new THREE.MeshStandardMaterial({
      color,
      map: asphaltMap,
      normalMap: asphaltNor,
      normalScale: new THREE.Vector2(1, 1),
      roughnessMap: asphaltRough,
      roughness: 1.0,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: offset,
      polygonOffsetUnits: offset
    });
  }



  const roadMat = pavedMaterial(0xbdbdbd, -3.0);
  const runwayMat = pavedMaterial(0x9a9a9a, -4.0);



  const lineMat = new THREE.MeshBasicMaterial({
    color: 0xebb434, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -8.0, polygonOffsetUnits: -8.0
  });
  const whiteMat = new THREE.MeshBasicMaterial({
    color: 0xf0f0f0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -10.0, polygonOffsetUnits: -10.0
  });



  /* ========================================================
     2. ROAD / RUNWAY GENERATOR
     ======================================================== */
  function buildRoad(points, width, material, tile, elevation, skirtDepth) {
    const pts = sampleRoad(points);
    const n = pts.length;
    const half = width * 0.5;
    const uMax = width / tile;


    const pos = [];
    const uvs = [];
    const indices = [];
    const rows = [];
    let dist = 0;


    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (i > 0) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);


      const nx = pts[Math.min(i + 1, n - 1)];
      const pv = pts[Math.max(i - 1, 0)];
      let fx = nx.x - pv.x;
      let fz = nx.z - pv.z;
      const len = Math.hypot(fx, fz) || 1;
      fx /= len; fz /= len;


      const rx = -fz * half;
      const rz = fx * half;
      const lx = p.x - rx, lz = p.z - rz;
      const qx = p.x + rx, qz = p.z + rz;


      const hL = heightAt(lx, lz);
      const hR = heightAt(qx, qz);
      const hC = heightAt(p.x, p.z);
      const hML = heightAt((lx + p.x) * 0.5, (lz + p.z) * 0.5);
      const hMR = heightAt((qx + p.x) * 0.5, (qz + p.z) * 0.5);


      // each edge follows the ground under it (road hugs slopes instead of floating)
      const yL = Math.max(hL, hML) + elevation;
      const yR = Math.max(hR, hMR) + elevation;
      const skirtY = Math.min(hL, hR, hC) - skirtDepth;


      pos.push(lx, yL, lz);
      pos.push(qx, yR, qz);
      pos.push(lx, skirtY, lz);
      pos.push(qx, skirtY, qz);


      const v = dist / tile;
      uvs.push(0, v, uMax, v, 0, v, uMax, v);


      rows.push({ x: p.x, z: p.z, fx, fz, dist, y: (yL + yR) * 0.5 });
    }


    for (let i = 0; i < n - 1; i++) {
      const a = i * 4;
      const b = (i + 1) * 4;
      indices.push(a, a + 1, b);
      indices.push(a + 1, b + 1, b);
      indices.push(a + 2, a, b + 2);
      indices.push(a, b, b + 2);
      indices.push(a + 1, a + 3, b + 1);
      indices.push(a + 3, b + 3, b + 1);
    }


    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();


    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    group.add(mesh);


    return rows;
  }



  function addStrip(rows, offset, stripW, dash, gap, lift, material) {
    const pos = [];
    const idx = [];
    const period = dash + gap;
    const dashed = dash > 0 && gap > 0;
    let prevOn = false;


    for (const r of rows) {
      const on = dashed ? (r.dist % period) < dash : true;
      if (on) {
        const cx = r.x + (-r.fz) * offset;
        const cz = r.z + (r.fx) * offset;
        const hx = (-r.fz) * stripW * 0.5;
        const hz = (r.fx) * stripW * 0.5;
        const base = pos.length / 3;
        pos.push(cx - hx, r.y + lift, cz - hz);
        pos.push(cx + hx, r.y + lift, cz + hz);
        if (prevOn) {
          idx.push(base - 2, base - 1, base);
          idx.push(base - 1, base + 1, base);
        }
      }
      prevOn = on;
    }


    if (idx.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    group.add(new THREE.Mesh(geo, material));
  }



  function rowAtDist(rows, d) {
    for (let i = 0; i < rows.length; i++) if (rows[i].dist >= d) return rows[i];
    return rows[rows.length - 1];
  }



  function numberTexture(text) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 192;
    const g = c.getContext('2d');
    g.translate(64, 96);
    g.scale(0.85, 1.5);
    g.fillStyle = '#f0f0f0';
    g.font = 'bold 90px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(text), 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }



  // --- Roads ---
  for (const road of ROADS) {
    const rows = buildRoad(road.points, road.width, roadMat, 5, ROAD_LIFT, 3.5);
    addStrip(rows, 0, 0.35, 4.8, 4.8, 0.06, lineMat);
  }



  // --- Runway ---
  {
    const rows = buildRoad(RUNWAY.points, RUNWAY.width, runwayMat, 8, RUNWAY_LIFT, 4.0);
    const total = rows[rows.length - 1].dist;
    const edge = RUNWAY.width * 0.5 - 1.2;


    addStrip(rows, 0, 0.9, 14, 10, 0.07, whiteMat);
    addStrip(rows, -edge, 0.5, 0, 0, 0.07, whiteMat);
    addStrip(rows, edge, 0.5, 0, 0, 0.07, whiteMat);


    const barGeo = new THREE.BoxGeometry(1.2, 0.08, 7);
    for (const d of [6.5, total - 6.5]) {
      const r = rowAtDist(rows, d);
      const yaw = Math.atan2(r.fx, r.fz);
      for (let k = 0; k < 8; k++) {
        const lat = (k - 3.5) * 2.6;
        const bar = new THREE.Mesh(barGeo, whiteMat);
        bar.position.set(r.x + (-r.fz) * lat, r.y + 0.05, r.z + r.fx * lat);
        bar.rotation.y = yaw;
        group.add(bar);
      }
    }


    // Runway numbers, readable from the landing direction
    if (RUNWAY.numbers) {
      const planeGeo = new THREE.PlaneGeometry(6.3, 9.5);
      const ends = [
        { text: RUNWAY.numbers.start, d: 28, sign: -1 },
        { text: RUNWAY.numbers.end, d: total - 28, sign: 1 }
      ];
      for (const e of ends) {
        if (!e.text) continue;
        const r = rowAtDist(rows, e.d);
        const mat = new THREE.MeshBasicMaterial({
          map: numberTexture(e.text), transparent: true, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -12
        });
        const m = new THREE.Mesh(planeGeo, mat);
        m.position.set(r.x, r.y + 0.09, r.z);
        m.rotation.set(-Math.PI / 2, Math.atan2(e.sign * r.fx, e.sign * r.fz), 0, 'YXZ');
        group.add(m);
      }
    }
  }



  /* ========================================================
     3. BATCHING (merge static pieces per material)
     ======================================================== */
  const batches = new Map();
  function addBatch(geo, mat) {
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat).push(geo);
  }


  function flushBatches() {
    for (const [mat, list] of batches) {
      const merged = mergeGeometries(list, false);
      if (!merged) { console.warn('[structures] could not merge one material group, skipped'); continue; }
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    batches.clear();
  }



  const groundAt = (x, z, r) => Math.max(
    heightAt(x, z),
    heightAt(x + r, z + r), heightAt(x - r, z + r),
    heightAt(x + r, z - r), heightAt(x - r, z - r)
  );



  function xzOf(o) {
    if (Array.isArray(o)) return o;
    if (o.x !== undefined) return [o.x, o.z];
    if (o.pos) return Array.isArray(o.pos) ? o.pos : [o.pos.x, o.pos.z];
    if (o.center) return Array.isArray(o.center) ? o.center : [o.center.x, o.center.z];
    return [0, 0];
  }



  /* ========================================================
     4. MATERIALS + GEOMETRY HELPERS
     ======================================================== */
  const concMap = loadTexture('concrete_diff.jpg', { repeat: [3, 3], srgb: true, aniso: 4 });
  const concNor = loadTexture('concrete_nor.jpg', { repeat: [3, 3], srgb: false, aniso: 4 });



  // Window wall texture: one tile = 4 m wide, 3.5 m tall (one floor)
  const winTex = (() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 224;
    const g = c.getContext('2d');
    g.fillStyle = '#ebe8e0';
    g.fillRect(0, 0, 256, 224);
    g.fillStyle = '#b9b6ae';
    g.fillRect(0, 214, 256, 10);                    // floor band
    for (const cx of [64, 192]) {
      g.fillStyle = '#d9d6ce';
      g.fillRect(cx - 44, 52, 88, 112);              // frame
      g.fillStyle = '#26384c';
      g.fillRect(cx - 38, 58, 76, 100);              // glass
      g.fillStyle = '#4a6a88';
      g.fillRect(cx - 38, 58, 76, 26);               // sky reflection
      g.fillStyle = '#d9d6ce';
      g.fillRect(cx - 2, 58, 4, 100);                // mullion
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  })();



  const matCache = new Map();
  const std = (key, make) => { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); };



  // W = walls with windows, P = textured concrete, S = plain colour, RF = roof (double sided)
  const W = (c) => std('w' + c, () => {
    const m = new THREE.MeshStandardMaterial({ color: c, map: winTex, roughness: 0.85, metalness: 0 });
    m.userData.tu = 4; m.userData.tv = 3.5;
    return m;
  });
  const P = (c) => std('p' + c, () => {
    const m = new THREE.MeshStandardMaterial({ color: c, map: concMap, normalMap: concNor, roughness: 0.88, metalness: 0.02 });
    m.userData.tu = 15; m.userData.tv = 15;
    return m;
  });
  const S = (c, rough = 0.75, metal = 0.05) => std(`s${c}_${rough}_${metal}`, () =>
    new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal }));
  const RF = (c) => std('r' + c, () =>
    new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));



  const METAL = S(0x58626d, 0.4, 0.4);
  const DARK = S(0x22262a, 0.9, 0);
  const GLASS = S(0x2a4a66, 0.2, 0.6);
  const YELLOW = S(0xebb434, 0.7, 0);
  const WHITE = S(0xe8e8e8, 0.8, 0);
  const RED = S(0xb02a2a, 0.8, 0);



  // Box whose UVs follow its real size, so textures keep a constant scale
  function boxGeo(w, h, d, mat) {
    const g = new THREE.BoxGeometry(w, h, d);
    const tu = mat.userData.tu, tv = mat.userData.tv;
    if (!tu) return g;
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // +x -x +y -y +z -z
    for (let f = 0; f < 6; f++) {
      const [a, b] = dims[f];
      const vt = (f === 2 || f === 3) ? tu : tv;
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, uv.getX(i) * a / tu, uv.getY(i) * b / vt);
      }
    }
    return g;
  }



  function scaleUV(g, k) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
    return g;
  }



  const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);



  // Triangular roof prism: ridge along local X, base at y = 0
  function gableGeo(w, d, rise) {
    const x0 = -w / 2, x1 = w / 2, zf = d / 2, zb = -d / 2;
    const FL = [x0, 0, zf], FR = [x1, 0, zf], BL = [x0, 0, zb], BR = [x1, 0, zb];
    const RL = [x0, rise, 0], RR = [x1, rise, 0];
    const tris = [FL, RL, BL, FR, BR, RR, FL, FR, RR, FL, RR, RL, BR, BL, RL, BR, RL, RR];
    const pos = [], uv = [];
    for (const v of tris) { pos.push(v[0], v[1], v[2]); uv.push(v[0] * 0.07, (v[2] + v[1]) * 0.07); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }



  // Half-ellipse arch extruded along Z (hangar body)
  function archGeo(w, h, d) {
    const shape = new THREE.Shape();
    const N = 18;
    shape.moveTo(w / 2, 0);
    for (let i = 1; i <= N; i++) {
      const a = (i / N) * Math.PI;
      shape.lineTo(Math.cos(a) * w / 2, Math.sin(a) * h);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -d / 2);
    return scaleUV(g, 1 / 15);
  }



  // A frame = a position + heading. put() adds a piece in local coordinates (front = local +Z).
  function makeFrame(x, y, z, rot) {
    const parent = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(UP, rot),
      ONE
    );
    const cos = Math.cos(rot), sin = Math.sin(rot);
    return {
      x, y, z, rot,
      toWorld(lx, ly, lz) { return [x + lx * cos + lz * sin, y + ly, z - lx * sin + lz * cos]; },
      put(geo, mat, lx, ly, lz, o = {}) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'));
        const local = new THREE.Matrix4().compose(
          new THREE.Vector3(lx, ly, lz), q,
          new THREE.Vector3(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1)
        );
        const g = geo.index ? geo.toNonIndexed() : geo.clone();
        g.applyMatrix4(parent.clone().multiply(local));
        addBatch(g, mat);
      },
      box(w, h, d, mat, lx, ly, lz, o) { this.put(boxGeo(w, h, d, mat), mat, lx, ly, lz, o); }
    };
  }



  /* ========================================================
     5. NAME SIGNS (canvas text)
     ======================================================== */
  const signStyles = {
    friendly: { bg: '#1d3a28', fg: '#ffffff', border: '#c8d6c0' },
    hostile:  { bg: '#2f3b47', fg: '#f2f2f2', border: '#d0a24a' },
    gate:     { bg: '#173b24', fg: '#ffffff', border: '#f2c200' },
    alert:    { bg: '#7a1b1b', fg: '#ffffff', border: '#f2c200' },
    landing:  { bg: '#14466b', fg: '#ffffff', border: '#ffffff' }
  };
  const styleFor = (place) => (place === 'town' ? signStyles.hostile : signStyles.friendly);



  const signMats = new Map();
  const unitPlane = new THREE.PlaneGeometry(1, 1);



  function signMaterial(text, style, wdt, hgt) {
    const key = `${text}|${style.bg}|${wdt.toFixed(1)}|${hgt}`;
    if (signMats.has(key)) return signMats.get(key);
    const cw = 512;
    const ch = Math.max(64, Math.round(cw * hgt / wdt));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    g.fillStyle = style.bg;
    g.fillRect(0, 0, cw, ch);
    g.strokeStyle = style.border;
    g.lineWidth = Math.max(4, ch * 0.07);
    g.strokeRect(g.lineWidth * 0.5, g.lineWidth * 0.5, cw - g.lineWidth, ch - g.lineWidth);
    let fs = ch * 0.54;
    g.font = `bold ${fs}px Arial, Helvetica, sans-serif`;
    while (g.measureText(text).width > cw * 0.86 && fs > 10) {
      fs -= 2;
      g.font = `bold ${fs}px Arial, Helvetica, sans-serif`;
    }
    g.fillStyle = style.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, cw / 2, ch / 2 + ch * 0.03);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    signMats.set(key, mat);
    return mat;
  }



  // o: { x, y, z, h, maxW, both, thick }  (front plane at z + thick, back plane at z - thick)
  function addSign(f, text, style, o) {
    const hgt = o.h ?? SIGN_HEIGHT;
    const wdt = clamp(text.length * hgt * 0.62 + hgt, hgt * 3, o.maxW ?? 10);
    const mat = signMaterial(text, style, wdt, hgt);
    const thick = o.thick ?? 0.07;
    const sides = o.both ? [1, -1] : [1];
    for (const s of sides) {
      const m = new THREE.Mesh(unitPlane, mat);
      const p = f.toWorld(o.x ?? 0, o.y, (o.z ?? 0) + s * thick);
      m.position.set(p[0], p[1], p[2]);
      m.rotation.y = f.rot + (s === 1 ? 0 : Math.PI);
      m.scale.set(wdt, hgt, 1);
      group.add(m);
    }
  }



  /* ========================================================
     6. PADS (helipad, motor pool, apron, town square)
     ======================================================== */
  const padColors = { apron: 0x8f9296, motorpool: 0x7b7f82, helipad: 0x6f7377, 'town-square': 0xa59b88 };


  for (const p of PADS || []) {
    const [px, pz] = xzOf(p);
    const gy = heightAt(px, pz);
    const f = makeFrame(px, gy, pz, p.rot ?? 0);
    const mat = P(padColors[p.id] ?? 0x84888b);
    const shape = String(p.shape ?? p.kind ?? p.type ?? '').toLowerCase();
    const isCircle = shape.includes('circ') || (p.r != null && p.w == null && p.width == null);


    if (isCircle) {
      const r = p.r ?? p.radius ?? 5;
      f.put(cyl(r, r, 1.0, 36), mat, 0, -0.2, 0);
      if (p.id === 'helipad' || !p.id) {
        f.put(new THREE.RingGeometry(r - 1.2, r - 0.7, 40), YELLOW, 0, 0.32, 0, { rx: -Math.PI / 2 });
        const bw = 0.8, bl = r * 1.2;
        f.box(bw, 0.06, bl, YELLOW, -r * 0.28, 0.33, 0);
        f.box(bw, 0.06, bl, YELLOW, r * 0.28, 0.33, 0);
        f.box(r * 0.56, 0.06, bw, YELLOW, 0, 0.33, 0);
      }
    } else {
      const pw = p.w ?? p.width ?? p.sx ?? (p.size ? p.size[0] : 10);
      const pd = p.d ?? p.depth ?? p.l ?? p.length ?? (p.size ? p.size[1] : 10);
      f.box(pw, 1.0, pd, mat, 0, -0.2, 0);
      if (p.id === 'motorpool') {
        const i = 0.7, t = 0.22;
        f.box(pw - 2 * i, 0.06, t, YELLOW, 0, 0.33, -pd / 2 + i);
        f.box(pw - 2 * i, 0.06, t, YELLOW, 0, 0.33, pd / 2 - i);
        f.box(t, 0.06, pd - 2 * i, YELLOW, -pw / 2 + i, 0.33, 0);
        f.box(t, 0.06, pd - 2 * i, YELLOW, pw / 2 - i, 0.33, 0);
      }
      if (p.id === 'town-square') {
        f.put(cyl(3.2, 3.6, 0.9, 20), P(0x8d8272), 0, 0.75, 0);
        f.put(cyl(0.7, 1.0, 5.5, 8), P(0xb7ad9b), 0, 3.6, 0);
        f.put(cyl(0.3, 0.7, 0.8, 8), P(0xb7ad9b), 0, 6.75, 0);
      }
    }
  }



  /* ========================================================
     7. FENCES (chain link, instanced) with gaps at the gates
     ======================================================== */
  function buildFences() {
    const chainTex = (() => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 96;
      const g = c.getContext('2d');
      g.strokeStyle = '#c4cacf';
      g.lineWidth = 2.5;
      const step = 14;
      for (let i = -96; i < 128; i += step) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 96, 96); g.stroke();
        g.beginPath(); g.moveTo(i, 96); g.lineTo(i + 96, 0); g.stroke();
      }
      g.fillStyle = '#9aa1a7';
      g.fillRect(0, 0, 128, 6);
      g.fillRect(0, 90, 128, 6);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    })();
    const chainMat = new THREE.MeshBasicMaterial({
      map: chainTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthWrite: true
    });


    const panelXf = [], postXf = [];
    const q = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
    let fenceH = 3;


    for (const fence of FENCES || []) {
      const H = fence.height ?? 3;
      fenceH = H;
      const pts = fence.points.slice();
      const a0 = pts[0], aN = pts[pts.length - 1];
      if (fence.closed !== false && (a0[0] !== aN[0] || a0[1] !== aN[1])) pts.push(a0);
      const gates = (GATES || []).filter((g) => (fence.gates || []).includes(g.id) || g.fence === fence.id);


      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.1) continue;
        const dx = (bx - ax) / L, dz = (bz - az) / L;


        const gaps = [];
        for (const g of gates) {
          const gx = g.x - ax, gz = g.z - az;
          const t = gx * dx + gz * dz;
          const off = Math.abs(gx * dz - gz * dx);
          const hw = (g.width ?? 10) / 2;
          if (off < 3 && t > -1 && t < L + 1) gaps.push([t - hw, t + hw]);
        }
        gaps.sort((a, b) => a[0] - b[0]);


        const free = [];
        let cursor = 0;
        for (const [g0, g1] of gaps) {
          if (g0 > cursor) free.push([cursor, Math.min(g0, L)]);
          cursor = Math.max(cursor, g1);
        }
        if (cursor < L) free.push([cursor, L]);


        for (const [t0, t1] of free) {
          const len = t1 - t0;
          if (len < 0.6) continue;
          const n = Math.max(1, Math.round(len / 4));
          const piece = len / n;
          const theta = Math.atan2(-dz, dx);
          for (let k = 0; k < n; k++) {
            const ta = t0 + k * piece, tb = ta + piece, tc = (ta + tb) / 2;
            const gyP = Math.max(heightAt(ax + dx * ta, az + dz * ta), heightAt(ax + dx * tb, az + dz * tb));
            pv.set(ax + dx * tc, gyP + H / 2 - 0.2, az + dz * tc);
            q.setFromAxisAngle(UP, theta);
            sv.set(piece, H, 1);
            panelXf.push(new THREE.Matrix4().compose(pv, q, sv));
          }
          for (let k = 0; k <= n; k++) {
            const t = t0 + k * piece;
            const px = ax + dx * t, pz = az + dz * t;
            pv.set(px, heightAt(px, pz) + (H + 0.5) / 2 - 0.2, pz);
            q.identity();
            sv.set(1, 1, 1);
            postXf.push(new THREE.Matrix4().compose(pv, q, sv));
          }
        }
      }
    }


    if (panelXf.length) {
      const im = new THREE.InstancedMesh(unitPlane, chainMat, panelXf.length);
      panelXf.forEach((m, i) => im.setMatrixAt(i, m));
      im.frustumCulled = false;
      group.add(im);
    }
    if (postXf.length) {
      const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, fenceH + 0.5, 0.22), S(0x6d7378, 0.5, 0.4), postXf.length);
      postXf.forEach((m, i) => pm.setMatrixAt(i, m));
      pm.frustumCulled = false;
      pm.castShadow = true;
      group.add(pm);
    }
  }
  buildFences();



  /* ========================================================
     8. GATES (pillars + beam + name sign)
     ======================================================== */
  function buildGate(g) {
    const gy = groundAt(g.x, g.z, 4);
    const f = makeFrame(g.x, gy, g.z, g.rot ?? 0);
    const half = (g.width ?? 10) / 2;
    const kind = g.kind || 'gate';


    if (kind === 'barricade' || kind === 'landing') {
      const x0 = half + 2.6;
      for (const s of [-1, 1]) f.put(cyl(0.13, 0.13, 4.4, 6), METAL, x0 + s * 1.9, 2.0, 0);
      addSign(f, g.name, kind === 'landing' ? signStyles.landing : signStyles.alert,
        { x: x0, y: 3.5, z: 0, maxW: 6, both: true, thick: 0.1 });
      return;
    }


    const checkpoint = kind === 'checkpoint';
    const pil = checkpoint ? P(0x8d8f86) : P(0xb9bcbf);
    for (const s of [-1, 1]) {
      f.box(1.3, 5.4, 1.3, pil, s * (half + 0.65), 2.7, 0);
      f.box(1.7, 0.4, 1.7, P(0x6e7276), s * (half + 0.65), 5.6, 0);
    }
    f.box(half * 2 + 2.6, 1.7, 1.0, checkpoint ? P(0x7a1b1b) : P(0x2f4a38), 0, 4.55, 0);
    addSign(f, g.name, checkpoint ? signStyles.alert : signStyles.gate,
      { y: 4.55, z: 0, maxW: half * 2 + 1.5, both: true, thick: 0.56 });


    if (!checkpoint) {
      // guard booth beside the gate
      const bx = half + 3.2;
      f.box(2.8, 0.3, 2.8, P(0x8a8d90), bx, 0.15, 1.2);
      f.box(2.4, 2.6, 2.4, P(0xc9c4b0), bx, 1.6, 1.2);
      f.box(2.6, 0.9, 2.5, GLASS, bx, 2.0, 1.2);
      f.box(3.2, 0.3, 3.2, S(0x4b535c), bx, 3.05, 1.2);
    }
  }
  for (const g of GATES || []) buildGate(g);



  /* ========================================================
     9. BUILDINGS
     ======================================================== */
  const roofColorFor = (b) => (b.place === 'town' ? 0x7a4636 : 0x4b535c);


  function bsign(f, b, y, maxW) {
    addSign(f, b.name, styleFor(b.place), {
      y, z: b.d / 2, h: SIGN_HEIGHT, maxW: maxW ?? Math.min(b.w - 1, 12), thick: 0.08
    });
  }


  function slab(f, b, w, d) {
    f.box(w + 0.5, 2.5, d + 0.5, P(0x7d8084), 0, -0.95, 0);   // plinth: hides slopes, top at +0.3
  }


  function door(f, b, dw, dh, z) {
    const zz = (z ?? b.d / 2) + 0.02;
    f.box(dw, dh, 0.4, DARK, 0, 0.3 + dh / 2, zz);
    f.box(dw + 0.6, 0.35, 0.5, P(0xa6aaae), 0, 0.3 + dh + 0.17, zz);
  }


  // Body + roof + door. Returns the door height.
  function shell(f, b, o = {}) {
    slab(f, b, b.w, b.d);
    f.box(b.w, b.h, b.d, o.windows === false ? P(b.color) : W(b.color), 0, b.h / 2, 0);
    if (o.roof === 'gable') {
      const rise = Math.min(b.d * 0.32, 3.2);
      f.put(gableGeo(b.w + 0.8, b.d + 0.8, rise), RF(o.roofColor ?? roofColorFor(b)), 0, b.h, 0);
    } else {
      f.box(b.w + 0.6, 0.4, b.d + 0.6, P(o.roofColor ?? 0x5f6368), 0, b.h + 0.2, 0);
    }
    const dh = o.dh ?? Math.min(2.7, b.h * 0.45);
    if (o.door !== false) door(f, b, o.dw ?? 2.4, dh);
    return dh;
  }
  const defSignY = (b, dh) => Math.min(dh + 1.55, b.h - 0.7);


  function columns(f, n, spanW, z, height, r = 0.3, mat = P(0xbfc2c4)) {
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : -spanW / 2 + (i * spanW) / (n - 1);
      f.put(cyl(r, r, height, 10), mat, x, 0.3 + height / 2, z);
    }
  }


  const BUILDERS = {
    hq(f, b) {
      shell(f, b, { dw: 3.2, dh: 2.9 });
      f.box(b.w * 0.4, 3.2, b.d * 0.6, P(0x6c7a66), 0, b.h + 0.4 + 1.6, -b.d * 0.05);
      f.put(cyl(0.12, 0.2, 12, 6), METAL, b.w * 0.3, b.h + 6.4, -b.d * 0.2);
      f.box(10, 0.4, 3.6, P(0xb0b4b8), 0, 4.0, b.d / 2 + 1.8);
      columns(f, 2, 9.2, b.d / 2 + 3.2, 3.7);
      bsign(f, b, Math.min(5.5, b.h - 0.7), 12);
    },
    mess(f, b) {
      const dh = shell(f, b);
      f.box(1.2, 3, 1.2, P(0x8a6a5a), b.w * 0.3, b.h + 1.9, -b.d * 0.2);
      f.box(5, 0.3, 2.4, P(0xb0b4b8), 0, dh + 0.9, b.d / 2 + 1.2);
      columns(f, 2, 4.4, b.d / 2 + 2.2, dh + 0.5, 0.15);
      bsign(f, b, Math.min(dh + 2.3, b.h - 0.7));
    },
    armory(f, b) {
      shell(f, b, { windows: false, door: false });
      f.box(3.6, 3.0, 0.4, S(0x3a4046, 0.5, 0.5), 0, 1.8, b.d / 2 + 0.02);
      f.box(4.2, 0.35, 0.5, P(0xa6aaae), 0, 3.47, b.d / 2 + 0.02);
      f.box(1.2, 0.6, 1.2, METAL, -b.w * 0.3, b.h + 0.7, 0);
      f.box(1.2, 0.6, 1.2, METAL, b.w * 0.3, b.h + 0.7, 0);
      bsign(f, b, Math.min(4.9, b.h - 0.7));
    },
    radar(f, b) {
      const base = { ...b, h: 4.2 };
      const dh = shell(f, base, { dh: 2.3, dw: 1.8 });
      f.put(cyl(1.0, 1.6, b.h - 4.2, 8), METAL, 0, 4.2 + (b.h - 4.2) / 2, 0);
      f.put(cyl(0.12, 0.12, 4, 6), METAL, 0, b.h + 2, 0);
      bsign(f, base, defSignY(base, dh), 5.4);
      // spinning dish
      const [wx, wy, wz] = f.toWorld(0, b.h, 0);
      const pivot = new THREE.Group();
      pivot.position.set(wx, wy, wz);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(3.6, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), METAL);
      dish.rotation.x = Math.PI * 0.65;
      dish.position.y = 0.8;
      dish.castShadow = true;
      pivot.add(dish);
      group.add(pivot);
      animators.push((dt) => { pivot.rotation.y += dt * 1.2; });
    },
    barracks(f, b) {
      const dh = shell(f, b, { roof: 'gable' });
      f.box(4.4, 0.3, 2.2, P(0xb0b4b8), 0, dh + 0.9, b.d / 2 + 1.1);
      columns(f, 2, 3.8, b.d / 2 + 2.0, dh + 0.5, 0.14);
      bsign(f, b, Math.min(dh + 2.3, b.h + 1.0), 9);
    },
    garage(f, b) {
      shell(f, b, { windows: false, door: false });
      const n = 3, dh = Math.min(3.4, b.h - 2.0);
      const dw = Math.min(5, b.w / n - 1);
      for (let i = 0; i < n; i++) {
        const x = (i - 1) * (b.w / n);
        f.box(dw, dh, 0.4, S(0x2b3138, 0.8, 0.3), x, 0.3 + dh / 2, b.d / 2 + 0.02);
        f.box(dw + 0.5, 0.3, 0.5, P(0xa6aaae), x, 0.3 + dh + 0.15, b.d / 2 + 0.02);
      }
      bsign(f, b, Math.min(dh + 1.35, b.h - 0.5));
    },
    hangar(f, b) {
      slab(f, b, b.w, b.d);
      f.put(archGeo(b.w, b.h, b.d), P(b.color), 0, 0.3, 0);
      const dh = b.h * 0.55;
      f.box(b.w * 0.72, dh, 0.4, S(0x2b3138, 0.8, 0.3), 0, 0.3 + dh / 2, b.d / 2 + 0.03);
      f.box(b.w * 0.72 + 0.6, 0.4, 0.5, P(0xa6aaae), 0, 0.3 + dh + 0.2, b.d / 2 + 0.03);
      bsign(f, b, 0.3 + dh + 1.4, b.w * 0.7);
    },
    tower(f, b) {
      const base = { ...b, h: 4.5 };
      const dh = shell(f, base, { dh: 2.3 });
      const cabinH = 3.2;
      f.put(cyl(1.5, 2.1, b.h - cabinH - 4.5, 8), P(0xbfc2c4), 0, 4.5 + (b.h - cabinH - 4.5) / 2, 0);
      f.box(b.w, cabinH, b.d, GLASS, 0, b.h - cabinH / 2, 0);
      f.box(b.w + 1.0, 0.4, b.d + 1.0, P(0x5f6368), 0, b.h + 0.2, 0);
      f.put(cyl(0.1, 0.16, 6, 6), METAL, 0, b.h + 3.4, 0);
      bsign(f, base, defSignY(base, dh), b.w);
    },
    terminal(f, b) {
      const dh = shell(f, b, { dw: 3.6 });
      f.box(b.w * 0.6, 0.4, 3.6, P(0x9aa0a5), 0, 4.3, b.d / 2 + 1.8);
      columns(f, 4, b.w * 0.55, b.d / 2 + 3.2, 4.0, 0.2);
      bsign(f, b, Math.min(5.6, b.h - 0.7), b.w * 0.6);
    },
    fueldepot(f, b) {
      slab(f, b, b.w, b.d);
      const r = Math.min(b.w / 7, 3.2);
      for (const s of [-1, 0, 1]) {
        f.put(cyl(r, r, 6, 20), P(0xd8d8d2), s * b.w * 0.3, 3.3, -b.d * 0.12);
        f.put(cyl(r * 0.9, r * 0.9, 0.4, 20), METAL, s * b.w * 0.3, 6.5, -b.d * 0.12);
      }
      f.box(6, 3.4, 4, W(b.color), 0, 2.0, b.d / 2 - 2.6);
      f.box(6.6, 0.4, 4.6, P(0x5f6368), 0, 3.9, b.d / 2 - 2.6);
      f.box(1.8, 2.2, 0.3, DARK, 1.6, 1.4, b.d / 2 - 0.58);
      addSign(f, b.name, styleFor(b.place), { y: 5.2, z: b.d / 2 - 2.6, h: SIGN_HEIGHT, maxW: 9, thick: 2.35 });
    },
    fuelstation(f, b) {
      slab(f, b, b.w, b.d);
      const cw = b.w * 0.8, cd = b.d * 0.5, cz = b.d * 0.2;
      f.box(cw, 0.5, cd, P(0xd0d0cc), 0, 4.8, cz);
      f.box(cw, 0.9, 0.2, RED, 0, 4.8, cz + cd / 2 + 0.1);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.put(cyl(0.25, 0.25, 4.5, 8), METAL, sx * (cw / 2 - 0.5), 2.55, cz + sz * (cd / 2 - 0.5));
      for (const sx of [-1, 1]) f.box(0.6, 1.5, 0.9, RED, sx * b.w * 0.15, 1.05, cz);
      f.box(b.w * 0.55, 3.4, b.d * 0.28, W(b.color), 0, 2.0, -b.d * 0.3);
      f.box(b.w * 0.55 + 0.5, 0.4, b.d * 0.28 + 0.5, P(0x5f6368), 0, 3.9, -b.d * 0.3);
      addSign(f, b.name, styleFor(b.place), { y: 4.8, z: cz + cd / 2 + 0.2, h: SIGN_HEIGHT, maxW: cw - 1, thick: 0.08 });
    },
    townhall(f, b) {
      shell(f, b, { dw: 3.6, dh: 3.4 });
      columns(f, 4, 12, b.d / 2 + 2.2, b.h - 1.7, 0.5);
      f.box(16, 0.5, 4.4, P(0xc9c4b4), 0, b.h - 1.2, b.d / 2 + 2.2);
      f.put(gableGeo(4.4, 16, 2.6), P(0xc9c4b4), 0, b.h - 0.95, b.d / 2 + 2.2, { ry: Math.PI / 2 });
      f.box(4.5, 5, 4.5, P(0xc9c4b4), 0, b.h + 0.4 + 2.5, -b.d * 0.1);
      f.put(cyl(0, 3.6, 2.6, 4), RF(0x4b535c), 0, b.h + 0.4 + 5 + 1.3, -b.d * 0.1, { ry: Math.PI / 4 });
      bsign(f, b, 5.6, 10);
    },
    police(f, b) {
      const dh = shell(f, b);
      f.box(b.w + 0.1, 0.5, b.d + 0.1, S(0x2a4f8a), 0, b.h - 0.55, 0);
      f.put(cyl(0.1, 0.15, 6, 6), METAL, b.w * 0.3, b.h + 3.4, 0);
      bsign(f, b, defSignY(b, dh));
    },
    market(f, b) {
      slab(f, b, b.w, b.d);
      for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) {
        f.put(cyl(0.2, 0.2, b.h, 8), P(0xbfc2c4), sx * (b.w / 2 - 0.6), 0.3 + b.h / 2, sz * (b.d / 2 - 0.6));
      }
      f.box(b.w, 0.4, b.d, S(0x8a4a38), 0, b.h + 0.1, 0);
      const n = 6;
      for (let i = 0; i < n; i++) {
        f.box(b.w / n, 0.9, 0.15, i % 2 ? WHITE : RED, -b.w / 2 + (i + 0.5) * b.w / n, b.h - 0.55, b.d / 2 + 0.05);
      }
      for (let i = 0; i < 4; i++) {
        const x = -b.w * 0.33 + i * (b.w * 0.22);
        f.box(2.4, 1.0, 1.2, S(0x6e4c2e, 0.9, 0), x, 0.8, -b.d * 0.12);
        f.box(0.7, 0.5, 0.7, i % 2 ? S(0xc0392b) : S(0xd8a62a), x - 0.6, 1.55, -b.d * 0.12);
        f.box(0.7, 0.5, 0.7, S(0x4f8a3c), x + 0.6, 1.55, -b.d * 0.12);
      }
      addSign(f, b.name, styleFor(b.place), { y: b.h + 1.3, z: b.d / 2 - 0.4, h: SIGN_HEIGHT, maxW: b.w * 0.8, thick: 0.08 });
    },
    clinic(f, b) {
      const dh = shell(f, b);
      const cx = b.w * 0.33, cy = Math.max(3.0, b.h - 1.6);
      f.box(1.9, 0.6, 0.1, RED, cx, cy, b.d / 2 + 0.04);
      f.box(0.6, 1.9, 0.1, RED, cx, cy, b.d / 2 + 0.04);
      bsign(f, b, defSignY(b, dh));
    },
    warehouse(f, b) {
      slab(f, b, b.w, b.d);
      f.box(b.w, b.h, b.d, P(b.color), 0, b.h / 2, 0);
      f.put(gableGeo(b.w + 0.8, b.d + 0.8, Math.min(b.d * 0.22, 3.2)), RF(0x5b5f63), 0, b.h, 0);
      const dh = Math.min(4.2, b.h - 1.5);
      for (const s of [-1, 1]) {
        f.box(4.2, dh, 0.4, S(0x39424a, 0.8, 0.3), s * b.w * 0.24, 0.3 + dh / 2, b.d / 2 + 0.02);
        f.box(4.8, 0.3, 0.5, P(0xa6aaae), s * b.w * 0.24, 0.3 + dh + 0.15, b.d / 2 + 0.02);
      }
      bsign(f, b, Math.min(dh + 1.4, b.h - 0.5), b.w * 0.4);
    },
    harbor(f, b) {
      const dh = shell(f, b, { roof: 'gable' });
      f.put(cyl(0.08, 0.1, 7, 6), METAL, b.w * 0.35, b.h + 3.8, 0);
      bsign(f, b, defSignY(b, dh), b.w);
    },
    generic(f, b) {
      const dh = shell(f, b);
      bsign(f, b, defSignY(b, dh));
    }
  };


  function kindOf(b) {
    const t = String(b.type || '').toLowerCase();
    if (t === 'house') return 'house';
    const key = t + ' ' + String(b.name || '').toLowerCase();
    const rules = [
      ['radar', /radar/], ['hangar', /hangar/], ['tower', /control|tower/], ['terminal', /terminal/],
      ['fuelstation', /fuel.*station|station.*fuel|gas/], ['fueldepot', /fuel|depot/],
      ['townhall', /town ?hall/], ['police', /police/], ['market', /market/], ['clinic', /clinic|hospital/],
      ['warehouse', /warehouse/], ['harbor', /harbor|harbour/], ['hq', /\bhq\b|command/],
      ['mess', /mess/], ['armory', /armory|armoury/], ['barracks', /barrack/], ['garage', /garage|motor/]
    ];
    for (const [k, re] of rules) if (re.test(key)) return k;
    console.warn(`[structures] unknown building type "${b.type}" (${b.name}), using generic block`);
    return 'generic';
  }



  /* ---------- Kenney houses (GLB) with procedural fallback ---------- */
  function placeModel(root, x, y, z, rot, targetW) {
    const wrap = new THREE.Group();
    const model = cloneModel(root);
    const size = modelSize(root);
    const s = targetW / Math.max(size.x, size.z, 0.001);
    model.position.set(0, 0, 0);
    model.scale.setScalar(s);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    model.position.set(
      -(box.min.x + box.max.x) * 0.5,
      -box.min.y - 0.1,
      -(box.min.z + box.max.z) * 0.5
    );
    wrap.add(model);
    wrap.position.set(x, y, z);
    wrap.rotation.y = rot;
    return wrap;
  }


  function fallbackHouse(x, y, z, rot, w, d, h, color) {
    const wrap = new THREE.Group();
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
    );
    wall.position.y = h * 0.5;
    wall.castShadow = true;
    wall.receiveShadow = true;
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(w, d) * 0.75, 3, 4),
      new THREE.MeshStandardMaterial({ color: 0xaa4532, roughness: 0.75 })
    );
    roof.position.y = h + 1.5;
    roof.rotation.y = Math.PI * 0.25;
    roof.castShadow = true;
    wrap.add(wall, roof);
    wrap.position.set(x, y, z);
    wrap.rotation.y = rot;
    return wrap;
  }


  function buildHouse(b, idx) {
    const gy = groundAt(b.x, b.z, b.w * 0.5);
    const hv = (HOUSES || []).find((h) => h[0] === b.x && h[1] === b.z);
    const variant = hv ? hv[3] : (b.variant ?? idx);
    const name = MODELS.houses[variant % MODELS.houses.length];
    if (pavedClearance(b.x, b.z) < 5) console.warn(`[structures] house at (${b.x}, ${b.z}) is close to a road`);


    const task = loadModel(name)
      .then((root) => {
        group.add(root
          ? placeModel(root, b.x, gy, b.z, b.rot + HOUSE_FRONT_OFFSET, b.w)
          : fallbackHouse(b.x, gy, b.z, b.rot, b.w * 0.8, b.d * 0.7, b.h, b.color));
      })
      .catch((err) => {
        console.warn('[structures] house model failed, using fallback', err);
        group.add(fallbackHouse(b.x, gy, b.z, b.rot, b.w * 0.8, b.d * 0.7, b.h, b.color));
      });
    pending.push(task);


    // name sign on two posts in front of the house
    const f = makeFrame(b.x, gy, b.z, b.rot);
    const sz = b.d / 2 + 1.8;
    for (const s of [-1, 1]) f.put(cyl(0.07, 0.07, 2.3, 6), S(0x4a3a2a, 0.9, 0), s * 1.3, 1.05, sz);
    addSign(f, b.name, styleFor(b.place), { y: 1.95, z: sz, h: 0.9, maxW: 4.2, both: true, thick: 0.08 });
  }


  (BUILDINGS || []).forEach((raw, idx) => {
    const b = {
      ...raw,
      w: raw.w ?? raw.width ?? 10,
      d: raw.d ?? raw.depth ?? 8,
      h: raw.h ?? raw.height ?? 6,
      rot: raw.rot ?? 0,
      color: raw.color ?? 0xb8b6ac
    };
    const kind = kindOf(b);
    if (kind === 'house') { buildHouse(b, idx); return; }
    const gy = groundAt(b.x, b.z, Math.max(b.w, b.d) * 0.5);
    const f = makeFrame(b.x, gy, b.z, b.rot);
    (BUILDERS[kind] || BUILDERS.generic)(f, b);
  });



  /* ========================================================
     10. PROPS (watchtowers, sandbags, barriers, flags, windsock)
     ======================================================== */
  const propRand = rng(777);
  const SAND = S(0xb09c6e, 0.95, 0);
  const CONC = P(0xa9acae);


  /* ---------- Flags (drawn in code, no image files) ---------- */
  // Pakistan: dark green field, white stripe at the pole (1/4 of the length),
  // white crescent and five-pointed star on the green. Ratio 3:2.
  function drawStar(g, cx, cy, r, tilt) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? r : r * 0.382;
      const a = tilt - Math.PI / 2 + i * Math.PI / 5;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  }


  function drawFlag(g, w, h, hostile) {
    if (!hostile) {
      const stripe = w / 4;
      g.fillStyle = '#01411c';                              // Pakistan green
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, stripe, h);                          // white stripe at the pole
      const gx = stripe + (w - stripe) / 2;                 // centre of the green part
      const gy = h / 2;
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(gx - 15, gy + 5, h * 0.275, 0, Math.PI * 2); g.fill();     // crescent: outer circle
      g.fillStyle = '#01411c';
      g.beginPath(); g.arc(gx + 17, gy - 10, h * 0.23, 0, Math.PI * 2); g.fill();     // cut-out opens to the fly side
      g.fillStyle = '#ffffff';
      drawStar(g, gx + 62, gy - 35, h * 0.105, 0.35);
    } else {
      // Space Gang: black flag, red ring with a red X
      g.fillStyle = '#0d0d0f';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#b01818';
      g.fillRect(0, 0, w, h * 0.07);
      g.fillRect(0, h * 0.93, w, h * 0.07);
      const cx = w / 2, cy = h / 2;
      g.strokeStyle = '#d42020';
      g.lineWidth = h * 0.07;
      g.beginPath(); g.arc(cx, cy, h * 0.27, 0, Math.PI * 2); g.stroke();
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx - h * 0.17, cy - h * 0.17); g.lineTo(cx + h * 0.17, cy + h * 0.17);
      g.moveTo(cx + h * 0.17, cy - h * 0.17); g.lineTo(cx - h * 0.17, cy + h * 0.17);
      g.stroke();
    }
  }


  const flagMats = new Map();
  // back = true: mirrored picture for the far side, so the stripe stays at the pole on both sides
  function flagMaterial(hostile, back) {
    const key = (hostile ? 'h' : 'f') + (back ? 'b' : 'f');
    if (flagMats.has(key)) return flagMats.get(key);
    const w = 600, h = 400;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (back) { g.translate(w, 0); g.scale(-1, 1); }
    drawFlag(g, w, h, hostile);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    flagMats.set(key, mat);
    return mat;
  }


  function addFlag(f, hostile) {
    for (const s of [1, -1]) {
      const m = new THREE.Mesh(unitPlane, flagMaterial(hostile, s === -1));
      const p = f.toWorld(0.12 + FLAG_W / 2, FLAG_Y, s * 0.02);
      m.position.set(p[0], p[1], p[2]);
      m.rotation.y = f.rot + (s === 1 ? 0 : Math.PI);
      m.scale.set(FLAG_W, FLAG_H, 1);
      group.add(m);
    }
  }


  function buildProp(p) {
    const gy = groundAt(p.x, p.z, 1.2);
    const f = makeFrame(p.x, gy, p.z, p.rot ?? 0);
    const len = p.len ?? 5;


    switch (p.type) {
      case 'watchtower': {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          f.box(0.3, 9, 0.3, S(0x4a3a2a, 0.9, 0), sx * 1.3, 3.5, sz * 1.3);
        }
        f.box(2.3, 0.15, 0.15, S(0x4a3a2a, 0.9, 0), 0, 3.0, 1.3);
        f.box(2.3, 0.15, 0.15, S(0x4a3a2a, 0.9, 0), 0, 3.0, -1.3);
        f.box(3.8, 0.3, 3.8, S(0x5b4630, 0.9, 0), 0, 8.0, 0);
        f.box(3.3, 1.8, 3.3, P(0x6f7a66), 0, 9.05, 0);
        f.box(3.4, 0.6, 3.4, DARK, 0, 9.35, 0);
        f.put(cyl(0, 3.0, 1.6, 4), RF(0x4b535c), 0, 10.75, 0, { ry: Math.PI / 4 });
        break;
      }
      case 'sandbags': {
        const rows = 3;
        for (let r = 0; r < rows; r++) {
          const shift = (r % 2) * 0.44;
          for (let x = -len / 2 + 0.45 + shift; x < len / 2 - 0.1; x += 0.88) {
            const j = (propRand() - 0.5) * 0.12;
            f.box(0.86, 0.36, 0.55, SAND, x, 0.18 + r * 0.34, j, { ry: j });
          }
        }
        break;
      }
      case 'barrier': {
        f.box(len, 0.5, 0.75, CONC, 0, 0.25, 0);
        f.box(len, 0.55, 0.42, CONC, 0, 0.77, 0);
        break;
      }
      case 'flagpole': {
        const hostile = String(p.faction || '').toLowerCase().startsWith('h');
        f.box(1.2, 0.4, 1.2, CONC, 0, 0.2, 0);
        f.put(cyl(0.1, 0.14, 12, 8), METAL, 0, 6.2, 0);
        f.put(new THREE.SphereGeometry(0.2, 8, 6), YELLOW, 0, 12.3, 0);
        addFlag(f, hostile);                       // Pakistan (friendly) or Space Gang (hostile)
        break;
      }
      case 'windsock': {
        f.put(cyl(0.08, 0.1, 6.5, 6), METAL, 0, 3.25, 0);
        f.put(cyl(0.15, 0.55, 2.4, 10), S(0xe8641b, 0.8, 0), 1.3, 6.2, 0, { rz: -Math.PI / 2 });
        break;
      }
      default:
        console.warn(`[structures] unknown prop type "${p.type}"`);
    }
  }
  for (const p of PROPS || []) buildProp(p);



  /* ========================================================
     11. PIER + HARBOR (from layout.js PIER)
     ======================================================== */
  if (PIER) {
    const woodMap = loadTexture('wood_diff.jpg', { repeat: [2, 12], srgb: true, aniso: 4 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xd2b79a, map: woodMap, roughness: 0.9, metalness: 0 });
    const L = PIER.length ?? 36, Wd = PIER.width ?? 6;
    const f = makeFrame(PIER.x, 0, PIER.z, PIER.rot ?? 0);


    f.box(Wd, 0.4, L, woodMat, 0, 1.2, 0);                            // deck (default UVs)
    for (let z = -L / 2 + 1; z <= L / 2; z += 6) {
      for (const side of [-1, 1]) {
        f.put(cyl(0.25, 0.3, 6, 8), woodMat, side * (Wd / 2 - 0.4), -1.6, z);   // posts
        f.put(cyl(0.08, 0.08, 1.0, 6), woodMat, side * (Wd / 2 - 0.1), 1.9, z); // rail posts
      }
    }
    for (const side of [-1, 1]) f.box(0.12, 0.1, L, woodMat, side * (Wd / 2 - 0.1), 2.35, 0);   // rails
    for (const z of [-L / 2 + 2, 0, L / 2 - 2]) {
      for (const side of [-1, 1]) f.put(cyl(0.22, 0.28, 0.7, 8), S(0x2b2d30, 0.6, 0.3), side * (Wd / 2 - 0.5), 1.75, z);
    }
    // a little cargo near the land end
    const crate = S(0x7a5a3a, 0.9, 0);
    f.box(1.3, 1.3, 1.3, crate, -1.4, 2.05, -L / 2 + 4);
    f.box(1.3, 1.3, 1.3, crate, -1.4, 2.05, -L / 2 + 5.4);
    f.box(1.1, 1.1, 1.1, crate, -1.4, 3.3, -L / 2 + 4.6, { ry: 0.4 });
    f.put(cyl(0.45, 0.45, 1.0, 10), S(0x2f5d8a, 0.6, 0.3), 1.4, 1.9, -L / 2 + 4);
    f.put(cyl(0.45, 0.45, 1.0, 10), S(0xa23a2a, 0.6, 0.3), 1.4, 1.9, -L / 2 + 5.2);
  }



  /* ========================================================
     12. FINISH
     ======================================================== */
  flushBatches();
  scene.add(group);
  console.log(`[structures] built ${(BUILDINGS || []).length} buildings, ${(GATES || []).length} gates, ${(FENCES || []).length} fences, ${(PROPS || []).length} props`);


  return {
    ready: Promise.all(pending),
    update(dt) {
      for (const fn of animators) fn(dt);
    }
  };
}