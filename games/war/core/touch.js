// games/war/core/touch.js
// On-screen touch controls for War Mode on phones.
// Left side: floating joystick (push to the edge = sprint).
// Right side: swipe anywhere to look, FIRE, GUN (cycles guns), ORDER (cycles Follow/Hold/Attack),
//             GRENADE (small), and a PAUSE button.
// Automatic on phones: aim assist ON, Medium graphics (no bloom), fullscreen + landscape lock.
// v2: bloom is forced off on phones every match, and the HUD is smaller (less text).
// v3: customizable buttons. Saved layout is loaded here; the editor itself lives in
//     core/touch_edit.js (loaded only on phones; if that file is missing, nothing breaks).
// It talks to the game only through input.touchKey / touchFire / touchLook / touchWheel.
// PC never loads this file.

/* ---------- Knobs (change these numbers to tune) ---------- */
const JOY_R = 60;            // joystick radius in pixels
const JOY_DEAD = 0.25;       // ignore tiny movements (0..1)
const JOY_SPRINT = 0.97;     // push the stick this far (0..1) to sprint (lower = easier sprint)
const FIRE_SIZE = 96;        // px
const WEAPON_NAMES = ['PISTOL', 'RIFLE', 'SHOTGUN'];   // same order as items.js
const ORDER_NAMES = ['FOLLOW', 'HOLD', 'ATTACK'];      // Z, X, C
const ORDER_KEYS = ['KeyZ', 'KeyX', 'KeyC'];

/* HUD knobs for phones */
const SHOW_COMMS = true;     // false = hide all command messages on phones
const SHOW_SQUAD = true;     // false = hide the squad health panel on phones

/* Layout save (phone only) */
const LAYOUT_KEY = 'warTouchLayout';
const BTN_IDS = ['t-fire', 't-weapon', 't-order', 't-grenade', 't-pause'];

let started = false;

export function initTouch(input) {
  if (started) return;
  started = true;

  /* ---------- Styles ---------- */
  const style = document.createElement('style');
  style.textContent = `
    #touch-ui { position:fixed; inset:0; z-index:6; display:none; pointer-events:none;
      -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; touch-action:none;
      font-family:system-ui,Segoe UI,Arial,sans-serif; }
    #touch-ui * { -webkit-tap-highlight-color:transparent; touch-action:none; }
    #touch-ui.editing { z-index:99990; }
    #touch-ui.editing .t-zone { pointer-events:none; }
    #touch-ui.editing #t-order { display:flex !important; }
    .t-zone { position:absolute; top:0; bottom:0; pointer-events:auto; }
    #t-joy-zone { left:0; width:42%; }
    #t-look-zone { left:42%; right:0; }
    .t-joy-base { position:absolute; width:${JOY_R * 2}px; height:${JOY_R * 2}px; margin:-${JOY_R}px 0 0 -${JOY_R}px;
      border:2px solid rgba(255,255,255,0.45); background:rgba(255,255,255,0.08); border-radius:50%;
      display:none; pointer-events:none; }
    .t-joy-knob { position:absolute; width:52px; height:52px; margin:-26px 0 0 -26px; border-radius:50%;
      background:rgba(255,255,255,0.4); border:2px solid rgba(255,255,255,0.7); display:none; pointer-events:none; }
    .t-btn { position:absolute; pointer-events:auto; display:flex; align-items:center; justify-content:center;
      flex-direction:column; text-align:center; color:#fff; font-weight:800; letter-spacing:1px;
      background:rgba(20,24,32,0.55); border:2px solid rgba(255,255,255,0.55); border-radius:50%;
      text-shadow:0 1px 3px #000; }
    .t-btn.down { background:rgba(255,255,255,0.35); transform:scale(0.94); }
    .t-btn small { font-size:10px; font-weight:600; opacity:0.85; letter-spacing:0; }
    #t-fire { right:30px; bottom:26px; width:${FIRE_SIZE}px; height:${FIRE_SIZE}px; font-size:16px;
      background:rgba(255,60,60,0.45); border-color:rgba(255,160,160,0.9); }
    #t-grenade { right:146px; bottom:36px; width:56px; height:56px; font-size:22px; }
    #t-weapon { right:36px; bottom:140px; width:64px; height:64px; font-size:10px; }
    #t-order { right:122px; bottom:104px; width:92px; height:50px; border-radius:26px; font-size:12px; }
    #t-pause { right:12px; top:10px; width:42px; height:42px; font-size:16px; background:rgba(0,0,0,0.45); }
    #t-rotate { position:fixed; inset:0; z-index:99999; display:none; align-items:center; justify-content:center;
      background:#000; color:#fff; font:700 20px system-ui,Arial,sans-serif; text-align:center; padding:30px;
      pointer-events:none; }
    @media (orientation: portrait) { #t-rotate.on { display:flex; } }

    /* ===== PHONE HUD: smaller, less text ===== */
    #hud { background:none !important; border:none !important; box-shadow:none !important; padding:0 !important; }
    #score-box { display:none !important; }

    /* health: small bar in the bottom-left corner */
    #health-box { position:fixed !important; left:10px !important; bottom:6px !important; top:auto !important;
      transform:none !important; display:flex !important; align-items:center !important; gap:6px !important;
      width:auto !important; margin:0 !important; padding:3px 8px !important;
      background:rgba(10,10,30,0.5) !important; border-radius:8px !important; }
    #health-box .hud-label { display:none !important; }
    #health-bar { width:90px !important; height:7px !important; margin:0 !important; }
    #health-text { font-size:12px !important; min-width:22px !important; margin:0 !important; line-height:1 !important; }

    /* ammo: small, under the radar (the GUN button already shows the weapon name) */
    #ammo-box { padding:3px 7px !important; }
    #weapon-name { display:none !important; }
    #ammo { font-size:14px !important; }
    #grenade-count { font-size:11px !important; margin-top:1px !important; }

    /* top-centre stage/objective label */
    #wave-label { font-size:12px !important; letter-spacing:1px !important; }
    #enemy-label { font-size:10px !important; }

    /* messages */
    #order-label { display:none !important; }
    #squad-alert { font-size:11px !important; }
    #banner-title { font-size:20px !important; letter-spacing:2px !important; }
    #banner-sub { font-size:11px !important; }
    #comms { width:38vw !important; padding:4px 8px !important; ${SHOW_COMMS ? '' : 'display:none !important;'} }
    #comms-name { display:none !important; }
    #comms-text { font-size:10px !important; line-height:1.25 !important; }
    #reload-msg { font-size:12px !important; }
    ${SHOW_SQUAD ? '' : '#team-panel { display:none !important; }'}
  `;
  document.head.appendChild(style);

  /* ---------- Layout ---------- */
  const ui = document.createElement('div');
  ui.id = 'touch-ui';
  ui.innerHTML = `
    <div id="t-joy-zone" class="t-zone"></div>
    <div id="t-look-zone" class="t-zone"></div>
    <div id="t-joy-base" class="t-joy-base"></div>
    <div id="t-joy-knob" class="t-joy-knob"></div>
    <div id="t-order" class="t-btn"></div>
    <div id="t-weapon" class="t-btn"></div>
    <div id="t-grenade" class="t-btn">💣</div>
    <div id="t-fire" class="t-btn">FIRE</div>
    <div id="t-pause" class="t-btn">⏸</div>
  `;
  document.body.appendChild(ui);

  const rotate = document.createElement('div');
  rotate.id = 't-rotate';
  rotate.textContent = '↻ Rotate your phone to landscape';
  document.body.appendChild(rotate);

  const $ = (id) => document.getElementById(id);
  const joyZone = $('t-joy-zone'), lookZone = $('t-look-zone');
  const joyBase = $('t-joy-base'), joyKnob = $('t-joy-knob');
  const btnOrder = $('t-order'), btnWeapon = $('t-weapon');
  const btnGrenade = $('t-grenade'), btnFire = $('t-fire'), btnPause = $('t-pause');

  /* ---------- Saved button layout (v3) ---------- */
  let editing = false;
  let layout = loadLayout();
  const moved = new Set(Object.keys(layout.pos));

  function emptyLayout() { return { scale: 1, opacity: 1, pos: {} }; }

  function loadLayout() {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return emptyLayout();
      const l = JSON.parse(raw);
      return {
        scale: Math.min(1.8, Math.max(0.5, Number(l.scale) || 1)),
        opacity: Math.min(1, Math.max(0.2, Number(l.opacity) || 1)),
        pos: (l.pos && typeof l.pos === 'object') ? l.pos : {}
      };
    } catch (e) { return emptyLayout(); }
  }

  function clearPos(el) {
    el.style.left = ''; el.style.top = ''; el.style.right = ''; el.style.bottom = '';
  }

  function placeEl(el, left, top) {
    const W = window.innerWidth, H = window.innerHeight;
    const w = el.offsetWidth || 0, h = el.offsetHeight || 0;
    el.style.left = Math.max(0, Math.min(W - w, left)) + 'px';
    el.style.top = Math.max(0, Math.min(H - h, top)) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  function applyLayout() {
    const W = window.innerWidth, H = window.innerHeight;
    BTN_IDS.forEach(id => {
      const el = $(id);
      if (!el) return;
      el.style.scale = layout.scale !== 1 ? String(layout.scale) : '';
      el.style.opacity = layout.opacity < 1 ? String(layout.opacity) : '';
      const p = layout.pos[id];
      if (p && typeof p.x === 'number' && typeof p.y === 'number') placeEl(el, p.x * W, p.y * H);
      else clearPos(el);
    });
  }
  applyLayout();
  window.addEventListener('resize', applyLayout);
  window.addEventListener('orientationchange', () => setTimeout(applyLayout, 300));

  // Used by touch_edit.js
  const editApi = {
    ids: BTN_IDS,
    ui,
    getLayout: () => layout,
    setEditing(on) {
      editing = !!on;
      ui.classList.toggle('editing', editing);
      if (editing) { releaseAll(); applyLayout(); }
    },
    setScale(s) { layout.scale = Math.min(1.8, Math.max(0.5, s)); applyLayout(); },
    setOpacity(o) { layout.opacity = Math.min(1, Math.max(0.2, o)); applyLayout(); },
    moveTo(id, left, top) {
      const el = $(id);
      if (!el) return;
      placeEl(el, left, top);
      moved.add(id);
    },
    save() {
      const W = window.innerWidth, H = window.innerHeight;
      moved.forEach(id => {
        const el = $(id);
        if (el && el.offsetWidth) layout.pos[id] = { x: el.offsetLeft / W, y: el.offsetTop / H };
      });
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch (e) { /* ignore */ }
    },
    cancel() {                       // go back to the last saved layout
      layout = loadLayout();
      moved.clear(); Object.keys(layout.pos).forEach(k => moved.add(k));
      applyLayout();
    },
    reset() {                        // default positions
      try { localStorage.removeItem(LAYOUT_KEY); } catch (e) { /* ignore */ }
      layout = emptyLayout();
      moved.clear();
      applyLayout();
    }
  };

  /* ---------- State ---------- */
  let orderIdx = 0;      // follow
  let weaponIdx = 1;     // rifle (the game starts with the rifle)

  function updateLabels() {
    btnOrder.innerHTML = '<small>ORDER</small>' + ORDER_NAMES[orderIdx];
    btnWeapon.innerHTML = '<small>GUN</small>' + WEAPON_NAMES[weaponIdx];
  }
  updateLabels();

  function tap(code) {
    input.touchKey(code, true);
    setTimeout(() => input.touchKey(code, false), 60);
  }

  /* ---------- Floating joystick ---------- */
  let joyId = null, joyX = 0, joyY = 0;
  const heldMove = { KeyW: false, KeyS: false, KeyA: false, KeyD: false, ShiftLeft: false };

  function setMove(code, on) {
    if (heldMove[code] === on) return;
    heldMove[code] = on;
    input.touchKey(code, on);
  }
  function stopMove() { Object.keys(heldMove).forEach(k => setMove(k, false)); }

  function joyUpdate(t) {
    let dx = t.clientX - joyX, dy = t.clientY - joyY;
    const len = Math.hypot(dx, dy);
    const mag = len / JOY_R;
    const cl = len > JOY_R ? JOY_R / len : 1;
    joyKnob.style.left = (joyX + dx * cl) + 'px';
    joyKnob.style.top = (joyY + dy * cl) + 'px';

    if (mag < JOY_DEAD) { stopMove(); return; }
    const ux = dx / len, uy = dy / len;
    setMove('KeyW', uy < -0.38);
    setMove('KeyS', uy > 0.38);
    setMove('KeyA', ux < -0.38);
    setMove('KeyD', ux > 0.38);
    setMove('ShiftLeft', mag >= JOY_SPRINT);
  }

  joyZone.addEventListener('touchstart', e => {
    e.preventDefault();
    if (editing || joyId !== null) return;
    const t = e.changedTouches[0];
    joyId = t.identifier; joyX = t.clientX; joyY = t.clientY;
    joyBase.style.left = joyX + 'px'; joyBase.style.top = joyY + 'px'; joyBase.style.display = 'block';
    joyKnob.style.left = joyX + 'px'; joyKnob.style.top = joyY + 'px'; joyKnob.style.display = 'block';
  }, { passive: false });

  joyZone.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === joyId) joyUpdate(t);
  }, { passive: false });

  function joyEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        joyId = null;
        joyBase.style.display = 'none'; joyKnob.style.display = 'none';
        stopMove();
      }
    }
  }
  joyZone.addEventListener('touchend', joyEnd);
  joyZone.addEventListener('touchcancel', joyEnd);

  /* ---------- Swipe to look ---------- */
  let lookId = null, lx = 0, ly = 0;
  lookZone.addEventListener('touchstart', e => {
    e.preventDefault();
    if (editing || lookId !== null) return;
    const t = e.changedTouches[0];
    lookId = t.identifier; lx = t.clientX; ly = t.clientY;
  }, { passive: false });

  lookZone.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === lookId) {
        input.touchLook(t.clientX - lx, t.clientY - ly);
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: false });

  function lookEnd(e) {
    for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
  }
  lookZone.addEventListener('touchend', lookEnd);
  lookZone.addEventListener('touchcancel', lookEnd);

  /* ---------- Buttons ---------- */
  function bindBtn(el, onDown, onUp) {
    el.addEventListener('touchstart', e => {
      e.preventDefault();
      if (editing) return;                 // in the editor, buttons only move
      el.classList.add('down');
      onDown();
    }, { passive: false });
    const up = (e) => {
      e.preventDefault();
      el.classList.remove('down');
      if (editing) return;
      if (onUp) onUp();
    };
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
  }

  bindBtn(btnFire, () => input.touchFire(true), () => input.touchFire(false));

  bindBtn(btnGrenade, () => tap('KeyG'));

  bindBtn(btnWeapon, () => {
    input.touchWheel(1);                                   // next gun
    weaponIdx = (weaponIdx + 1) % WEAPON_NAMES.length;
    updateLabels();
  });

  bindBtn(btnOrder, () => {
    orderIdx = (orderIdx + 1) % ORDER_NAMES.length;        // Follow -> Hold -> Attack -> Follow
    tap(ORDER_KEYS[orderIdx]);
    updateLabels();
  });

  bindBtn(btnPause, () => { releaseAll(); input.unlock(); });

  function releaseAll() {
    stopMove();
    input.touchFire(false);
    joyId = null; lookId = null;
    joyBase.style.display = 'none'; joyKnob.style.display = 'none';
  }

  /* ---------- Fullscreen + landscape (first touch, where the browser allows it) ---------- */
  let fsTried = false;
  document.addEventListener('touchend', () => {
    if (fsTried || ui.style.display !== 'block') return;
    fsTried = true;
    try {
      const el = document.documentElement;
      const p = el.requestFullscreen ? el.requestFullscreen() : (el.webkitRequestFullscreen && el.webkitRequestFullscreen());
      const lockLandscape = () => {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      };
      if (p && p.then) p.then(lockLandscape).catch(() => {}); else lockLandscape();
    } catch (e) { /* iPhones can't do this, ignore */ }
  }, { passive: true });

  /* ---------- Show / hide with the game, and one-time phone setup ---------- */
  let wasInGame = false, aimDone = false, wasShown = false;

  // Bloom is part of the "High" quality. On phones, never stay on High.
  function forceNoBloom() {
    const qb = document.getElementById('quality-btn');
    if (qb && qb.textContent.trim() === 'High') qb.click();    // High -> Medium (no bloom)
  }

  function onGameStart() {
    orderIdx = 0;            // the squad starts on FOLLOW
    weaponIdx = 1;           // and you start with the rifle
    updateLabels();

    // Aim assist ON for phones (once). main.js toggles it when it sees the V key.
    if (!aimDone) {
      aimDone = true;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyV' }));
    }

    forceNoBloom();
  }

  // Also switch bloom off as soon as the page is ready (before Deploy is pressed)
  setTimeout(forceNoBloom, 800);

  setInterval(() => {
    const inGame = document.body.classList.contains('in-game');
    const overlayOpen = !!document.querySelector('.overlay:not(.hidden)');
    const show = editing || (inGame && !overlayOpen);

    ui.style.display = show ? 'block' : 'none';
    rotate.classList.toggle('on', show);
    if (!show) releaseAll();
    if (show && !wasShown) applyLayout();      // sizes are known once visible
    wasShown = show;

    if (inGame && !wasInGame) onGameStart();
    wasInGame = inGame;
  }, 150);

  /* ---------- Button editor (separate file, phones only) ---------- */
  // Adds an "EDIT BUTTONS" button to the Pause and Settings screens,
  // but only if touch_edit.js loads fine. If the file is missing, nothing happens.
  import('./touch_edit.js').then(mod => {
    if (!mod || typeof mod.openEditor !== 'function') return;
    ['pause-screen', 'settings-screen'].forEach(id => {
      const screen = document.getElementById(id);
      if (!screen || screen.querySelector('.edit-buttons-btn')) return;
      const panel = screen.querySelector('.panel') || screen;
      const sample = panel.querySelector('button');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = (sample ? sample.className : 'btn') + ' edit-buttons-btn';
      b.textContent = 'EDIT BUTTONS';
      b.addEventListener('click', () => mod.openEditor(editApi));
      const row = panel.querySelector('.btn-row');
      if (row) panel.insertBefore(b, row); else panel.appendChild(b);
    });
  }).catch(() => { /* touch_edit.js not found: no editor, game works as before */ });

  console.log('✅ Touch controls ready');
}