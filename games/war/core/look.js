// games/war/core/look.js
// Realistic daytime lighting, sky, fog, sun and shadows for every War stage.
// Same engine as the Arena, but each stage has its own weather / time of day.
// Exports are unchanged: THEMES, getTheme, setupLook, makeFloor, neonMaterial.

import * as THREE from 'three';

/* ---------- Settings you can tweak ---------- */
const USE_HDRI = true;     // real photo sky on stage 1 (needs textures/sky.hdr)
const HDR_MAX  = 1.6;      // caps the sun brightness in the HDRI (stops white-out)
const HDRI_URL = new URL('../../../textures/sky.hdr', import.meta.url).href;

/* ---------- One theme per stage ---------- */
export const THEMES = {
  // Stage 1: clear blue day (real HDRI sky)
  neon: {
    name: 'Neon City', hdri: true,
    exposure: 1.0,
    skyTop: 0x2f6fc0, skyMid: 0x6fa8dc, skyHor: 0xcfdbe4, skyLow: 0x9aa8b4,
    fog: 0xcfdbe4, fogNear: 60, fogFar: 170,
    stars: 0, sunDir: [25, 45, 20], sun: 0xfff2dd, sunI: 2.8, glow: 0.9,
    ambient: 0xbcc8e0, ambientI: 0.25,
    hemiSky: 0xbfd8ff, hemiGround: 0x59606a, hemiI: 0.9,
    accent: 0.12,
    envTop: 0x6fa8dc, envHor: 0xcfdbe4, envBottom: 0x59606a,
    panels: [0x00f0ff, 0xff2d95, 0xcfd8ff, 0x7b2ff7],
    lights: [0x00f0ff, 0xff2d95, 0x7b2ff7, 0x3a7bff],
    core: 0xff2d95,
    floor: 0x5a5e66, grid1: 0x00f0ff, grid2: 0x4a3ac0, gridOpacity: 0.10
  },
  // Stage 2: hot hazy desert noon
  desert: {
    name: 'Desert Ruins',
    exposure: 1.05,
    skyTop: 0x3f7fc4, skyMid: 0x9cc0d8, skyHor: 0xf2dcb4, skyLow: 0xc9ab7a,
    fog: 0xe9d2a6, fogNear: 45, fogFar: 150,
    stars: 0, sunDir: [35, 40, 15], sun: 0xffe2b0, sunI: 3.0, glow: 1.0,
    ambient: 0xe0c8a0, ambientI: 0.3,
    hemiSky: 0xffe0b0, hemiGround: 0x8a6a40, hemiI: 0.9,
    accent: 0.10,
    envTop: 0x9cc0d8, envHor: 0xf2dcb4, envBottom: 0x8a6a40,
    panels: [0xffa040, 0xff2d95, 0xfff0d8, 0x00f0ff],
    lights: [0xff8a2a, 0xff2d95, 0xffd84a, 0x00f0ff],
    core: 0xffd84a,
    floor: 0xb59a6a, grid1: 0xff9a3a, grid2: 0x7a4a2a, gridOpacity: 0.08
  },
  // Stage 3: cold overcast snow
  frozen: {
    name: 'Frozen Base',
    exposure: 1.05,
    skyTop: 0x7d98b4, skyMid: 0xaabccb, skyHor: 0xdde7ee, skyLow: 0xb8c6d0,
    fog: 0xd6e1ea, fogNear: 35, fogFar: 140,
    stars: 0, sunDir: [20, 35, 25], sun: 0xeef4ff, sunI: 1.6, glow: 0.35,
    ambient: 0xc8d8ea, ambientI: 0.5,
    hemiSky: 0xdfeeff, hemiGround: 0x8a9bb0, hemiI: 1.2,
    accent: 0.12,
    envTop: 0xaabccb, envHor: 0xdde7ee, envBottom: 0x8a9bb0,
    panels: [0x00f0ff, 0xcfe8ff, 0xffffff, 0x7b2ff7],
    lights: [0x00f0ff, 0xbfe4ff, 0x3a7bff, 0x7b2ff7],
    core: 0x00f0ff,
    floor: 0xdfe8f0, grid1: 0x8ae8ff, grid2: 0x3a6ab0, gridOpacity: 0.10
  },
  // Stage 4: sickly green toxic haze
  toxic: {
    name: 'Toxic Foundry',
    exposure: 1.0,
    skyTop: 0x25402a, skyMid: 0x5f8035, skyHor: 0xb2c45e, skyLow: 0x7a8a3a,
    fog: 0x93a64c, fogNear: 25, fogFar: 115,
    stars: 0, sunDir: [-25, 32, 20], sun: 0xe8f5a0, sunI: 1.7, glow: 0.5,
    ambient: 0x90b080, ambientI: 0.35,
    hemiSky: 0xc0e090, hemiGround: 0x2a4020, hemiI: 0.9,
    accent: 0.35,
    envTop: 0x5f8035, envHor: 0xb2c45e, envBottom: 0x2a4020,
    panels: [0x3dff9a, 0xffd84a, 0xd8ffd0, 0x7b2ff7],
    lights: [0x3dff9a, 0xffd84a, 0x7b2ff7, 0x00f0ff],
    core: 0x3dff9a,
    floor: 0x55603a, grid1: 0x3dff9a, grid2: 0x2a7a3a, gridOpacity: 0.12
  },
  // Stage 5: dramatic red sunset with stars (boss fight)
  orbital: {
    name: 'Orbital Station',
    exposure: 1.0,
    skyTop: 0x14123a, skyMid: 0x6a2a60, skyHor: 0xe0704a, skyLow: 0x6a2a2a,
    fog: 0xb8584a, fogNear: 40, fogFar: 150,
    stars: 350, sunDir: [70, 18, 30], sun: 0xffa868, sunI: 3.2, glow: 1.0,
    ambient: 0xa07890, ambientI: 0.3,
    hemiSky: 0xff9a80, hemiGround: 0x3a2040, hemiI: 0.8,
    accent: 0.5,
    envTop: 0x6a2a60, envHor: 0xe0704a, envBottom: 0x3a2040,
    panels: [0xff2d4a, 0x00f0ff, 0xcfd8ff, 0x7b2ff7],
    lights: [0xff2d4a, 0x00f0ff, 0x7b2ff7, 0xff2d95],
    core: 0xff2d4a,
    floor: 0x4a3f48, grid1: 0xff2d4a, grid2: 0x4a3ac0, gridOpacity: 0.15
  }
};

export function getTheme(name) {
  return THEMES[name] || THEMES.neon;
}

const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

/* ---------- Main setup ---------- */
// Call once per map. Returns { update(), remove(), theme, envMap }.
export function setupLook(renderer, scene, camera, themeName = 'neon', opts = {}) {
  const T = getTheme(themeName);
  const half = opts.half || 60;
  const added = [];
  const add = (o) => { scene.add(o); added.push(o); return o; };
  let removed = false;
  let hdriTex = null;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = T.exposure;

  const cTop = new THREE.Color(T.skyTop);
  const cMid = new THREE.Color(T.skyMid);
  const cHor = new THREE.Color(T.skyHor);
  const cLow = new THREE.Color(T.skyLow);

  scene.background = cHor.clone();
  scene.fog = new THREE.Fog(T.fog, T.fogNear, T.fogFar);

  /* --- Gradient sky dome --- */
  const SKY_R = 200;
  function skyColor(t) {
    const c = new THREE.Color();
    if (t < 0) return c.copy(cHor).lerp(cLow, Math.min(1, -t * 8));
    if (t < 0.18) return c.copy(cHor).lerp(cMid, smooth(t / 0.18));
    return c.copy(cMid).lerp(cTop, Math.min(1, (t - 0.18) / 0.7));
  }
  const skyGeo = new THREE.SphereGeometry(SKY_R, 32, 24);
  const pos = skyGeo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = skyColor(pos.getY(i) / SKY_R);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const skyMat = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false,
    depthWrite: false, toneMapped: false
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -10;

  const skyGroup = new THREE.Group();
  skyGroup.add(sky);

  /* --- Sun direction (used for the light, the glow and shadows) --- */
  const sunDir = new THREE.Vector3(...T.sunDir).normalize();

  /* --- Soft sun glow in the sky --- */
  let glowSprite = null, glowTex = null;
  if (T.glow > 0) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.15, 'rgba(255,255,255,0.7)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(cv);
    glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: T.sun, transparent: true, opacity: T.glow,
      blending: THREE.AdditiveBlending, depthWrite: false,
      fog: false, toneMapped: false
    }));
    glowSprite.scale.set(80, 80, 1);
    glowSprite.position.copy(sunDir).multiplyScalar(170);
    skyGroup.add(glowSprite);
  }

  /* --- Stars (only on the night / dusk stage) --- */
  let starGeo = null;
  if (T.stars > 0) {
    const starPos = new Float32Array(T.stars * 3);
    for (let i = 0; i < T.stars; i++) {
      const h = 0.25 + Math.random() * 0.75;
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(1 - h * h) * 190;
      starPos[i * 3] = Math.cos(a) * rr;
      starPos[i * 3 + 1] = h * 190;
      starPos[i * 3 + 2] = Math.sin(a) * rr;
    }
    starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    skyGroup.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 1.8, sizeAttenuation: false,
      transparent: true, opacity: 0.85, fog: false,
      depthWrite: false, toneMapped: false
    })));
  }
  add(skyGroup);

  /* --- Optional HDRI photo sky (stage 1). Falls back to the gradient. --- */
  if (USE_HDRI && T.hdri) {
    import('three/addons/loaders/RGBELoader.js').then(({ RGBELoader }) => {
      new RGBELoader().load(HDRI_URL, (tex) => {
        if (removed) { tex.dispose(); return; }
        try {
          const data = tex.image.data;           // half-float RGBA
          const maxH = THREE.DataUtils.toHalfFloat(HDR_MAX);
          for (let i = 0; i < data.length; i++) {
            if ((i & 3) === 3) continue;         // skip alpha
            if (THREE.DataUtils.fromHalfFloat(data[i]) > HDR_MAX) data[i] = maxH;
          }
        } catch (e) { /* if the data type differs, keep it uncapped */ }
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.needsUpdate = true;
        hdriTex = tex;
        scene.background = tex;
        sky.visible = false;                     // hide gradient dome
        if (glowSprite) glowSprite.visible = false;
        console.log('✅ War HDRI sky loaded');
      }, undefined, () => console.warn('War HDRI missing, using gradient sky'));
    }).catch(() => console.warn('RGBELoader not available, using gradient sky'));
  }

  /* --- Reflection environment (so metal and glass reflect the sky) --- */
  const envScene = new THREE.Scene();
  const envGeo = new THREE.SphereGeometry(50, 32, 24);
  const ep = envGeo.attributes.position;
  const ecols = new Float32Array(ep.count * 3);
  const eTop = new THREE.Color(T.envTop);
  const eHor = new THREE.Color(T.envHor);
  const eBot = new THREE.Color(T.envBottom);
  for (let i = 0; i < ep.count; i++) {
    const y = ep.getY(i) / 50;
    const c = y >= 0 ? eHor.clone().lerp(eTop, Math.min(1, y * 1.5))
                     : eHor.clone().lerp(eBot, Math.min(1, -y * 2));
    ecols[i * 3] = c.r; ecols[i * 3 + 1] = c.g; ecols[i * 3 + 2] = c.b;
  }
  envGeo.setAttribute('color', new THREE.BufferAttribute(ecols, 3));
  envScene.add(new THREE.Mesh(envGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide
  })));

  function panel(color, strength, x, y, z, w, h) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(strength),
        side: THREE.DoubleSide, toneMapped: false
      })
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  }
  // bright "sun" panel + two faint neon accents for the metal edges
  panel(T.sun, 5, sunDir.x * 40, sunDir.y * 40, sunDir.z * 40, 26, 26);
  panel(T.panels[0], 1.2, -30, 12, -10, 24, 10);
  panel(T.panels[1], 1.2,  30, 10,  10, 24, 10);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = envMap;
  pmrem.dispose();

  /* --- Lights --- */
  add(new THREE.AmbientLight(T.ambient, T.ambientI));
  add(new THREE.HemisphereLight(T.hemiSky, T.hemiGround, T.hemiI));

  const sun = new THREE.DirectionalLight(T.sun, T.sunI);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 260;
  const d = half + 20;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  add(sun);

  // Coloured neon accent lights (kept soft in daylight, stronger at dusk)
  const k = half * 0.6;
  const dist = Math.max(120, half * 2.4);
  const corners = [[-k, -k], [k, k], [k, -k], [-k, k]];
  corners.forEach((p, i) => {
    const l = new THREE.PointLight(T.lights[i], 500 * T.accent, dist);
    l.position.set(p[0], 12, p[1]);
    add(l);
  });
  const coreLight = new THREE.PointLight(T.core, 300 * T.accent, 50);
  coreLight.position.set(0, 6, 0);
  add(coreLight);

  // Small light on the camera so the gun never goes dark
  const gunLight = new THREE.PointLight(0xbfd8ff, 1.2, 4);
  gunLight.position.set(0.1, 0.25, 0.3);
  camera.add(gunLight);
  if (!camera.parent) scene.add(camera);

  return {
    theme: T,
    envMap,
    // Call every frame: keeps the sky centred on the player
    update() {
      skyGroup.position.copy(camera.position);
    },
    // Call when leaving the map
    remove() {
      removed = true;
      added.forEach(o => scene.remove(o));
      camera.remove(gunLight);
      if (hdriTex) { hdriTex.dispose(); hdriTex = null; }
      scene.background = null;
      envMap.dispose();
      skyGeo.dispose();
      skyMat.dispose();
      if (starGeo) starGeo.dispose();
      if (glowSprite) { glowSprite.material.dispose(); glowTex.dispose(); }
    }
  };
}

/* ---------- Helpers for map files ---------- */

// Ground plane (plus a faint neon grid). size = full width of the map.
export function makeFloor(size, themeName = 'neon') {
  const T = getTheme(themeName);
  const g = new THREE.Group();

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({
      color: T.floor, metalness: 0.0, roughness: 0.9, envMapIntensity: 0.4
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  const grid = new THREE.GridHelper(size, Math.round(size / 5), T.grid1, T.grid2);
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = T.gridOpacity;
  grid.material.depthWrite = false;
  g.add(grid);

  g.userData.floor = floor;
  return g;
}

// Bright glowing material for neon strips, rings and bullets
export function neonMaterial(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    toneMapped: false
  });
}