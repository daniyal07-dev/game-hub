import * as THREE from 'three';

/* ===== ARENA REALISM ADD-ON (separate file) =====
   REALISTIC = false  -> the old neon look comes back
   Press B in the game to turn bloom on/off */
const REALISTIC = true;

const TEX_DIR = '../textures/';
const HDR_URL = '../textures/sky.hdr';
const ADDONS = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/';
const LIMIT = 55;
const WALL_H = 5;
const GROUND_REPEAT = 12;
const WALL_TILE = 8;
const FOG_COLOR = 0xcfdbe4;
const GLOW_BOOST = 4;

if (REALISTIC) {
  const origOBR = THREE.Object3D.prototype.onBeforeRender;
  let hooked = false;
  THREE.Object3D.prototype.onBeforeRender = function (renderer, scene, camera) {
    if (hooked || !scene || !camera || camera.parent !== scene) return;
    hooked = true;
    THREE.Object3D.prototype.onBeforeRender = origOBR;
    takeOver(renderer);
  };
}

function takeOver(renderer) {
  const orig = renderer.render;
  let ready = false, busy = false, composer = null, bloomOn = true, lastScan = 0, skyMat = null;

  function walk(o, skip, fn) {
    if (o === skip) return;
    fn(o);
    for (const c of o.children) walk(c, skip, fn);
  }

  renderer.render = function (scene, camera) {
    if (busy || !scene.isScene || camera.parent !== scene) return orig.call(renderer, scene, camera);

    if (!ready) {
      ready = true;
      busy = true;
      try { setup(scene, camera); } catch (e) { console.warn('Realism setup problem:', e); }
      busy = false;
    }
    try { frameUpdate(scene, camera); } catch (e) { /* ignore */ }

    if (composer && bloomOn) {
      busy = true;
      try {
        composer.render();
        busy = false;
        return;
      } catch (e) {
        busy = false;
        console.warn('Bloom failed, turned off.', e);
        composer = null;
      }
    }
    return orig.call(renderer, scene, camera);
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyB' && composer) {
      bloomOn = !bloomOn;
      console.log('Bloom ' + (bloomOn ? 'ON' : 'OFF'));
    }
  });

  /* ---------- every frame ---------- */
  function frameUpdate(scene, camera) {
    // make neon things (bullets, tracers, sparks) bright enough to glow
    scene.traverse((o) => {
      const m = o.material;
      if (!m || Array.isArray(m) || m === skyMat) return;
      if ((m.isMeshBasicMaterial || m.isLineBasicMaterial) && m.toneMapped === false && !m.userData.glowed) {
        m.color.multiplyScalar(GLOW_BOOST);
        m.userData.glowed = true;
      }
    });

    // shadows for props and drones (they load later)
    const now = performance.now();
    if (now - lastScan > 500) {
      lastScan = now;
      walk(scene, camera, (o) => {
        if (!o.isMesh || o.userData.sh || !o.visible) return;
        const m = o.material;
        if (!m || Array.isArray(m) || !m.isMeshStandardMaterial || m.transparent) return;
        if (o.geometry.type === 'PlaneGeometry') return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.userData.sh = true;
      });
    }
  }

  /* ---------- textures ---------- */
  function loadTexture(name) {
    const loader = new THREE.TextureLoader();
    const attempt = (ext) => new Promise((res) => loader.load(TEX_DIR + name + ext, (t) => res(t), undefined, () => res(null)));
    return attempt('.jpg').then((t) => t || attempt('.png'));
  }

  /* ---------- daytime reflection environment ---------- */
  function buildEnvScene() {
    const s = new THREE.Scene();
    const R = 50;
    const geo = new THREE.SphereGeometry(R, 32, 24);
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x5a90d8);
    const hor = new THREE.Color(0xdfe8ee);
    const bot = new THREE.Color(0x555550);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / R;
      if (t >= 0) tmp.copy(hor).lerp(top, Math.pow(t, 0.6));
      else tmp.copy(hor).lerp(bot, Math.min(1, -t * 3));
      cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const sun = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 26),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1d6).multiplyScalar(4), side: THREE.DoubleSide })
    );
    sun.position.set(18, 33, 15);
    sun.lookAt(0, 0, 0);
    s.add(sun);
    return s;
  }

  /* ---------- main setup ---------- */
  function setup(scene, camera) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMappingExposure = 1.0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    scene.background = new THREE.Color(FOG_COLOR);
    scene.fog = new THREE.Fog(FOG_COLOR, 70, 240);

    let sky = null, floor = null;
    const pillarList = [];

    walk(scene, camera, (o) => {
      if (o.type === 'GridHelper' || o.isPoints) { o.visible = false; return; }

      if (o.isPointLight) { o.visible = false; return; }
      if (o.isAmbientLight) { o.color.set(0xffffff); o.intensity = 0.25; return; }
      if (o.isHemisphereLight) { o.color.set(0xcfe3ff); o.groundColor.set(0x6b6b60); o.intensity = 0.9; return; }
      if (o.isDirectionalLight) {
        o.color.set(0xfff1d6);
        o.intensity = 3.0;
        o.castShadow = true;
        o.shadow.mapSize.set(2048, 2048);
        const c = o.shadow.camera;
        c.left = -75; c.right = 75; c.top = 75; c.bottom = -75; c.near = 1; c.far = 200;
        c.updateProjectionMatrix();
        o.shadow.bias = -0.0005;
        o.shadow.normalBias = 0.05;
        return;
      }

      if (!o.isMesh) return;
      const g = o.geometry.type;
      const m = o.material;
      if (g === 'SphereGeometry' && o.geometry.parameters.radius === 200) sky = o;
      else if (g === 'PlaneGeometry') {
        if (m && m.isMeshStandardMaterial) floor = o;
        else o.visible = false;
      }
      else if (g === 'BoxGeometry' || g === 'TorusGeometry') o.visible = false;
      else if (g === 'CylinderGeometry') pillarList.push(o);
    });

    // daytime sky gradient
    if (sky) {
      const geo = sky.geometry;
      const pos = geo.attributes.position;
      const col = geo.attributes.color;
      const TOP = new THREE.Color(0x3f7fd0);
      const MID = new THREE.Color(0x8fbbe8);
      const HOR = new THREE.Color(FOG_COLOR);
      const LOW = new THREE.Color(0x9aa0a3);
      const tmp = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getY(i) / 200;
        if (t < 0) tmp.copy(HOR).lerp(LOW, Math.min(1, -t * 25));
        else if (t < 0.15) tmp.copy(HOR).lerp(MID, t / 0.15);
        else tmp.copy(MID).lerp(TOP, Math.min(1, (t - 0.15) / 0.6));
        col.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      col.needsUpdate = true;
      sky.material.toneMapped = true;
      sky.material.needsUpdate = true;
      skyMat = sky.material;
    }

    // environment light
    const pm = new THREE.PMREMGenerator(renderer);
    if (scene.environment) scene.environment.dispose();
    scene.environment = pm.fromScene(buildEnvScene(), 0.02).texture;
    pm.dispose();

    // floor
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x5a5e62, roughness: 0.9, metalness: 0, envMapIntensity: 0.6 });
    if (floor) { floor.material = floorMat; floor.receiveShadow = true; }

    // concrete walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8d9094, roughness: 0.95, metalness: 0, envMapIntensity: 0.6 });
    const L = LIMIT + 2, th = 1.6, len = L * 2 + th;
    const mk = (x, z, w, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
      m.position.set(x, WALL_H / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.sh = true;
      scene.add(m);
    };
    mk(0, -L, len, th); mk(0, L, len, th); mk(-L, 0, th, len); mk(L, 0, th, len);

    // concrete pillars
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x8d9094, roughness: 0.9, metalness: 0, envMapIntensity: 0.6 });
    for (const p of pillarList) { p.material = pillarMat; p.castShadow = true; p.receiveShadow = true; p.userData.sh = true; }

    // load textures, then apply them
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const put = (mat, key, tex, rx, ry) => {
      const t = tex.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx, ry);
      t.anisotropy = aniso;
      t.needsUpdate = true;
      mat[key] = t;
    };
    Promise.all(['ground_diff', 'ground_nor', 'ground_rough', 'wall_diff', 'wall_nor', 'wall_rough'].map(loadTexture))
      .then(([gd, gn, gr, wd, wn, wr]) => {
        if (gd) gd.colorSpace = THREE.SRGBColorSpace;
        if (wd) wd.colorSpace = THREE.SRGBColorSpace;

        if (gd) { put(floorMat, 'map', gd, GROUND_REPEAT, GROUND_REPEAT); floorMat.color.set(0xffffff); }
        if (gn) put(floorMat, 'normalMap', gn, GROUND_REPEAT, GROUND_REPEAT);
        if (gr) { put(floorMat, 'roughnessMap', gr, GROUND_REPEAT, GROUND_REPEAT); floorMat.roughness = 1; }
        floorMat.needsUpdate = true;
        console.log('✅ Ground textures: ' + [gd && 'colour', gn && 'normal', gr && 'roughness'].filter(Boolean).join(' '));

        const d = wd || gd, n = wd ? wn : (wn || gn), r = wd ? wr : (wr || gr);
        const lift = wd ? 1 : 1.7;
        const rx = len / WALL_TILE, ry = WALL_H / WALL_TILE;
        for (const [mat, ax, ay] of [[wallMat, rx, ry], [pillarMat, 2, 2]]) {
          if (d) { put(mat, 'map', d, ax, ay); mat.color.setScalar(lift); }
          if (n) put(mat, 'normalMap', n, ax, ay);
          if (r) { put(mat, 'roughnessMap', r, ax, ay); mat.roughness = 1; }
          mat.needsUpdate = true;
        }
        console.log(d ? '✅ Wall / pillar textures applied' : 'ℹ No textures found, plain colours used');
      });

    loadHDRI(scene, sky);
    initBloom(scene, camera);
  }

  /* ---------- optional HDRI sky ---------- */
  async function loadHDRI(scene, sky) {
    try {
      const { RGBELoader } = await import(ADDONS + 'loaders/RGBELoader.js');
      const tex = await new Promise((res, rej) => new RGBELoader().load(HDR_URL, res, undefined, rej));
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(renderer);
      const env = pm.fromEquirectangular(tex).texture;
      pm.dispose();
      scene.environment = env;
      scene.background = tex;
      if (sky) sky.visible = false;
      console.log('✅ HDRI sky loaded');
    } catch (e) {
      console.log('ℹ No sky.hdr, using the gradient sky');
    }
  }

  /* ---------- bloom ---------- */
  async function initBloom(scene, camera) {
    try {
      const [a, b, c, d] = await Promise.all([
        import(ADDONS + 'postprocessing/EffectComposer.js'),
        import(ADDONS + 'postprocessing/RenderPass.js'),
        import(ADDONS + 'postprocessing/UnrealBloomPass.js'),
        import(ADDONS + 'postprocessing/OutputPass.js')
      ]);
      const pr = renderer.getPixelRatio();
      const w = window.innerWidth, h = window.innerHeight;
      const rt = new THREE.WebGLRenderTarget(Math.round(w * pr), Math.round(h * pr), { type: THREE.HalfFloatType, samples: 4 });
      const comp = new a.EffectComposer(renderer, rt);
      comp.setPixelRatio(pr);
      comp.setSize(w, h);
      comp.addPass(new b.RenderPass(scene, camera));
      comp.addPass(new c.UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.5, 1.0));
      comp.addPass(new d.OutputPass());
      window.addEventListener('resize', () => comp.setSize(window.innerWidth, window.innerHeight));
      composer = comp;
      console.log('✅ Bloom enabled (press B to toggle)');
    } catch (e) {
      console.warn('Bloom unavailable, continuing without it.', e);
    }
  }
}