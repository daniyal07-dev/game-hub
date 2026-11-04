// games/war/core/input.js
// Keyboard, mouse look, shooting and pointer lock for War Mode.
// v4: SPACE also shoots (hold = keep firing, like the mouse button). Arrow keys still turn the camera.

export function createInput(domElement) {
  const down = new Set();
  const pressHandlers = {};
  const wheelHandlers = [];
  let lookX = 0, lookY = 0;
  let mouseHeld = false;
  let fireQueued = false;
  let locked = false;
  let lockCallback = null;
  let lastUnlock = 0;
  let retryTimer = null;
  let lastLookT = performance.now();

  /* ---------- Sensitivity (level 1..30, default 10) ---------- */
  const SENS_KEY = 'war_sens_level';
  const SENS_MIN = 1, SENS_MAX = 30, SENS_DEFAULT = 10;
  const levelToSens = (lv) => 0.0002 * lv + 0.0002;     // level 10 = 0.0022

  const KEY_TURN_SPEED = 2.0;      // radians per second at sensitivity 10 (arrow keys)

  let level = SENS_DEFAULT;
  try {
    const saved = parseInt(localStorage.getItem(SENS_KEY), 10);
    if (saved >= SENS_MIN && saved <= SENS_MAX) level = saved;
  } catch (e) { /* ignore */ }

  let toast = null, toastTimer = null;
  function showToast(text) {
    if (!toast) {
      toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;left:50%;top:14%;transform:translateX(-50%);' +
        'padding:8px 18px;background:rgba(0,0,0,0.65);color:#fff;font:600 16px sans-serif;' +
        'border-radius:6px;z-index:9999;pointer-events:none;transition:opacity 0.2s;';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 1100);
  }

  const api = {
    sensitivity: levelToSens(level),

    getSensitivityLevel() { return level; },
    setSensitivityLevel(lv, silent) {
      level = Math.max(SENS_MIN, Math.min(SENS_MAX, Math.round(lv)));
      api.sensitivity = levelToSens(level);
      try { localStorage.setItem(SENS_KEY, String(level)); } catch (e) { /* ignore */ }
      if (!silent) showToast('Sensitivity: ' + level);
    },

    /* ----- Keys ----- */
    isDown(code) { return down.has(code); },
    onPress(code, fn) { (pressHandlers[code] = pressHandlers[code] || []).push(fn); },
    onWheel(fn) { wheelHandlers.push(fn); },

    /* ----- Shooting (mouse button OR Space) ----- */
    get firing() { return mouseHeld; },
    consumeFire() {
      const f = fireQueued;
      fireQueued = false;
      return f;
    },

    /* ----- Look: mouse + arrow keys ----- */
    consumeLook() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastLookT) / 1000);
      lastLookT = now;

      let x = lookX * api.sensitivity;
      let y = lookY * api.sensitivity;

      // arrow keys turn the camera at a steady speed
      if (locked) {
        const k = KEY_TURN_SPEED * (level / SENS_DEFAULT) * dt;
        if (down.has('ArrowRight')) x += k;
        if (down.has('ArrowLeft'))  x -= k;
        if (down.has('ArrowDown'))  y += k * 0.7;
        if (down.has('ArrowUp'))    y -= k * 0.7;
      }

      lookX = 0;
      lookY = 0;
      return { x, y };
    },

    /* ----- Pointer lock ----- */
    get locked() { return locked; },
    lock() { requestLock(); },
    unlock() {
      clearTimeout(retryTimer);
      if (document.pointerLockElement) document.exitPointerLock();
    },
    onLockChange(fn) { lockCallback = fn; },

    clear() {
      down.clear();
      mouseHeld = false;
      fireQueued = false;
      lookX = 0;
      lookY = 0;
    },

    dispose() {
      clearTimeout(retryTimer);
      clearTimeout(toastTimer);
      if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', api.clear);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerlockchange', onLockChanged);
      document.removeEventListener('pointerlockerror', onLockError);
      domElement.removeEventListener('click', onCanvasClick);
      window.removeEventListener('wheel', onWheel);
    }
  };

  /* ---------- Safe pointer lock ---------- */
  function requestLock() {
    if (document.pointerLockElement === domElement) return;

    const wait = 1100 - (performance.now() - lastUnlock);
    if (wait > 0) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(requestLock, wait);
      return;
    }

    try {
      let p;
      try { p = domElement.requestPointerLock({ unadjustedMovement: true }); }
      catch (e) { p = domElement.requestPointerLock(); }
      if (p && p.catch) {
        p.catch(() => {
          try {
            const p2 = domElement.requestPointerLock();
            if (p2 && p2.catch) p2.catch(() => {});
          } catch (e) { /* ignore */ }
        });
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------- Event handlers ---------- */
  const BLOCKED = ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

  function onKeyDown(e) {
    if (BLOCKED.includes(e.code)) e.preventDefault();

    // SPACE = fire. Holding it keeps firing; the first press queues one shot.
    if (e.code === 'Space' && locked) {
      mouseHeld = true;
      if (!e.repeat) fireQueued = true;
    }

    if (e.repeat) return;
    down.add(e.code);
    if (!locked) return;

    if (e.code === 'BracketRight') { api.setSensitivityLevel(level + 1); return; }
    if (e.code === 'BracketLeft')  { api.setSensitivityLevel(level - 1); return; }

    const list = pressHandlers[e.code];
    if (list) list.forEach(fn => fn());
  }

  function onKeyUp(e) {
    down.delete(e.code);
    if (e.code === 'Space') mouseHeld = false;
  }

  function onMouseMove(e) {
    if (!locked) return;
    if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
    lookX += e.movementX;
    lookY += e.movementY;
  }

  function onMouseDown(e) {
    if (!locked || e.button !== 0) return;
    mouseHeld = true;
    fireQueued = true;
  }

  function onMouseUp(e) {
    if (e.button === 0) mouseHeld = false;
  }

  function onWheel(e) {
    if (!locked) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    wheelHandlers.forEach(fn => fn(dir));
  }

  function onLockChanged() {
    locked = document.pointerLockElement === domElement;
    if (!locked) {
      lastUnlock = performance.now();
      api.clear();
    }
    if (lockCallback) lockCallback(locked);
  }

  function onLockError() { /* the retry logic handles the next click */ }

  function onVisibility() { if (document.hidden) api.clear(); }

  function onCanvasClick() { if (!locked) requestLock(); }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', api.clear);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLockChanged);
  document.addEventListener('pointerlockerror', onLockError);
  domElement.addEventListener('click', onCanvasClick);
  window.addEventListener('wheel', onWheel, { passive: true });

  return api;
}