// games/campaign/touch.js  (v3)
// Phone controls for Campaign. Loaded only on phones (see campaign.html).
// PC controls are never touched by this file.
//
// Buttons: FIRE (drag on it to aim), JUMP, RELOAD, SWAP, pause,
//          USE (only when needed), squad pills (only when you have soldiers),
//          SCOPE (only when window.campaignScope exists).
// Left thumb = move (push far = sprint). Right thumb = look.
// Tap the small minimap = full map.
// A scanner rewrites keyboard wording ("Press E", "Press Space") into touch wording.

/* ---------- Knobs ---------- */
const STICK_R = 52;        // stick radius (px)
const SPRINT_ON = 1.35;    // push this far (x radius) to start sprinting
const SPRINT_OFF = 1.1;    // come back under this to stop sprinting
const DEADZONE = 0.12;
const LOOK_MULT = 1.0;     // look speed multiplier (main.js has TOUCH_SENS too)
const LEFT_ZONE = 0.42;    // left 42% of the screen = move stick, rest = look
const SCAN_MS = 200;       // how often the wording scanner runs
const MINIMAP_SCALE = 0.6;
const TAP_MAX_MOVE = 14;   // px a finger may move and still count as a tap
const TAP_MAX_MS = 450;

const KEYS = { KeyE: 'e', KeyM: 'm', KeyR: 'r', KeyQ: 'q', Digit1: '1', Digit2: '2', Digit3: '3', Space: ' ' };

/* ---------- State ---------- */
let CT = null;             // window.campaignTouch (from main.js)
let GUN = null;            // player.js namespace (setFireHeld)
let root, look, ring, knob, mapClose, rotateEl, pills, btnUse, btnScope;
let playing = false, prevOn = false, introOn = false, mapOpen = false, portrait = false;
let sprinting = false, useNow = false;
let stickT = { id: null, ox: 0, oy: 0 };
let lookT = { id: null, x: 0, y: 0 };
let mmT = null, fireT = null;
let mmEl = null, aiEl = null, labelNode = null, labelMode = null;
let wakeLock = null;

/* ---------- Start: wait for main.js to publish campaignTouch ---------- */
import('./player.js').then((m) => { GUN = m; }).catch((e) => console.warn('[touch] could not load player.js', e));

let tries = 0;
const waiter = setInterval(() => {
  if (window.campaignTouch) { clearInterval(waiter); CT = window.campaignTouch; init(); }
  else if (++tries > 150) { clearInterval(waiter); console.warn('[touch] campaignTouch not found - is main.js the phone version?'); }
}, 100);


/* ---------- Helpers ---------- */
function tapKey(code) {
  const opts = { code, key: KEYS[code] || code, bubbles: true, cancelable: true };
  document.dispatchEvent(new KeyboardEvent('keydown', opts));
  setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', opts)), 70);
}

function setFire(on) { if (GUN && GUN.setFireHeld) GUN.setFireHeld(on); }

function desc(el) { return el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''); }

function shown(el) {
  if (!el || !el.getClientRects().length) return false;
  for (let e = el, i = 0; e && e !== document.body && i < 8; e = e.parentElement, i++) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.1) return false;
  }
  return true;
}

function fixedAncestor(el) {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (getComputedStyle(e).position === 'fixed') return e;
  }
  return null;
}


/* ---------- Build ---------- */
function mk(cls, text, parent) {
  const el = document.createElement('div');
  el.className = cls;
  if (text) el.textContent = text;
  (parent || root).appendChild(el);
  return el;
}

function bindTap(el, fn) {
  el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); fn(); }, { passive: false });
  const up = (e) => { e.preventDefault(); el.classList.remove('down'); };
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
}

function bindHold(el, on, off) {
  let id = null;
  el.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (id !== null) return;
    id = e.changedTouches[0].identifier; el.classList.add('down'); on();
  }, { passive: false });
  const up = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === id) { id = null; el.classList.remove('down'); off(); }
  };
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
}

function init() {
  const css = document.createElement('style');
  css.textContent = CSS;
  document.head.appendChild(css);
  document.body.classList.add('tc-phone');

  root = document.createElement('div');
  root.className = 'tc-root';
  document.body.appendChild(root);

  look = mk('tc-look');
  ring = mk('tc-ring');
  knob = mk('tc-knob', '', ring);

  // FIRE (drag on it to aim)
  const fireBtn = mk('tc-btn fire', 'FIRE');
  fireBtn.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (fireT) return;
    const t = e.changedTouches[0];
    fireT = { id: t.identifier, x: t.clientX, y: t.clientY };
    fireBtn.classList.add('down'); setFire(true);
  }, { passive: false });
  fireBtn.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!fireT) return;
    for (const t of e.changedTouches) if (t.identifier === fireT.id) {
      CT.look((t.clientX - fireT.x) * LOOK_MULT, (t.clientY - fireT.y) * LOOK_MULT);
      fireT.x = t.clientX; fireT.y = t.clientY;
    }
  }, { passive: false });
  const fireEnd = (e) => {
    e.preventDefault();
    if (!fireT) return;
    for (const t of e.changedTouches) if (t.identifier === fireT.id) { fireT = null; fireBtn.classList.remove('down'); setFire(false); }
  };
  fireBtn.addEventListener('touchend', fireEnd, { passive: false });
  fireBtn.addEventListener('touchcancel', fireEnd, { passive: false });

  bindHold(mk('tc-btn jump', 'JUMP'), () => CT.jump(true), () => CT.jump(false));
  bindTap(mk('tc-btn reload', 'RELOAD'), () => tapKey('KeyR'));
  bindTap(mk('tc-btn swap', 'SWAP'), () => tapKey('KeyQ'));
  bindTap(mk('tc-btn pause', '❚❚'), () => { releaseAll(); CT.pause(); });

  btnUse = mk('tc-btn use', 'USE');
  btnUse.style.display = 'none';
  bindTap(btnUse, () => tapKey('KeyE'));

  btnScope = mk('tc-btn scope', 'SCOPE');
  btnScope.style.display = 'none';
  bindTap(btnScope, () => { try { window.campaignScope.toggle(); } catch (e) {} });

  pills = mk('tc-pills');
  pills.style.display = 'none';
  [['FOLLOW', 'Digit1'], ['HOLD', 'Digit2'], ['ATTACK', 'Digit3']].forEach(([name, code]) => {
    bindTap(mk('tc-pill', name, pills), () => tapKey(code));
  });

  mapClose = mk('tc-mapclose');
  mapClose.innerHTML = '<span>TAP TO CLOSE MAP</span>';
  mapClose.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); closeMap(); }, { passive: false });

  rotateEl = mk('tc-rotate');
  rotateEl.innerHTML = '<div><b>ROTATE YOUR PHONE</b><br>Campaign plays in landscape</div>';

  // Look + move layer
  look.addEventListener('touchstart', onLookStart, { passive: false });
  look.addEventListener('touchmove', onLookMove, { passive: false });
  look.addEventListener('touchend', onLookEnd, { passive: false });
  look.addEventListener('touchcancel', onLookEnd, { passive: false });

  root.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  window.addEventListener('campaign:playing', (e) => {
    syncState();
    if (e.detail && e.detail.playing) { keepAwake(); lockLandscape(); }
  });
  window.addEventListener('resize', syncState);
  window.addEventListener('orientationchange', () => setTimeout(syncState, 200));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && playing) keepAwake(); });

  setInterval(scan, SCAN_MS);
  syncState();
  console.log('[touch] phone controls ready (v3)');
}


/* ---------- Stick / look / minimap taps ---------- */
function inMinimap(x, y) {
  let r;
  if (mmEl && shown(mmEl)) r = mmEl.getBoundingClientRect();
  else r = { left: innerWidth - 150, right: innerWidth, top: 48, bottom: 190 };   // fallback box
  const pad = 8;
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

function onLookStart(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (introOn) { tapKey('Space'); continue; }
    if (inMinimap(t.clientX, t.clientY)) {
      if (!mmT) mmT = { id: t.identifier, x: t.clientX, y: t.clientY, t: performance.now() };
      continue;
    }
    if (t.clientX < innerWidth * LEFT_ZONE && stickT.id === null) { stickStart(t); continue; }
    if (lookT.id === null) { lookT.id = t.identifier; lookT.x = t.clientX; lookT.y = t.clientY; }
  }
}

function onLookMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === stickT.id) stickMove(t);
    else if (t.identifier === lookT.id) {
      CT.look((t.clientX - lookT.x) * LOOK_MULT, (t.clientY - lookT.y) * LOOK_MULT);
      lookT.x = t.clientX; lookT.y = t.clientY;
    } else if (mmT && t.identifier === mmT.id) {
      if (Math.hypot(t.clientX - mmT.x, t.clientY - mmT.y) > TAP_MAX_MOVE) mmT = null;
    }
  }
}

function onLookEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === stickT.id) stickEnd();
    else if (t.identifier === lookT.id) lookT.id = null;
    else if (mmT && t.identifier === mmT.id) {
      const quick = performance.now() - mmT.t < TAP_MAX_MS;
      mmT = null;
      if (quick) openMap();
    }
  }
}

function stickStart(t) {
  stickT.id = t.identifier; stickT.ox = t.clientX; stickT.oy = t.clientY;
  ring.classList.add('act');
  ring.style.left = (t.clientX - STICK_R) + 'px';
  ring.style.top = (t.clientY - STICK_R) + 'px';
  ring.style.bottom = 'auto';
}

function stickMove(t) {
  const dx = t.clientX - stickT.ox, dy = t.clientY - stickT.oy;
  const dist = Math.hypot(dx, dy);
  const ratio = dist / STICK_R;
  let x = 0, y = 0;
  if (dist > 0) {
    const mag = Math.min(ratio, 1);
    if (mag >= DEADZONE) {
      const m = (mag - DEADZONE) / (1 - DEADZONE);
      x = dx / dist * m; y = -dy / dist * m;
    }
    const k = Math.min(dist, STICK_R);
    knob.style.transform = 'translate(' + (dx / dist * k) + 'px,' + (dy / dist * k) + 'px)';
  }
  CT.move(x, y);
  if (!sprinting && ratio > SPRINT_ON) { sprinting = true; CT.sprint(true); }
  else if (sprinting && ratio < SPRINT_OFF) { sprinting = false; CT.sprint(false); }
}

function stickEnd() {
  stickT.id = null;
  CT.move(0, 0);
  if (sprinting) { sprinting = false; CT.sprint(false); }
  resetRing();
}

function resetRing() {
  ring.classList.remove('act');
  ring.style.left = ''; ring.style.top = ''; ring.style.bottom = '';
  knob.style.transform = '';
}

function releaseAll() {
  CT.move(0, 0); CT.sprint(false); CT.jump(false);
  sprinting = false; stickT.id = null; lookT.id = null; mmT = null; fireT = null;
  setFire(false);
  resetRing();
  root.querySelectorAll('.down').forEach((b) => b.classList.remove('down'));
}


/* ---------- Map ---------- */
function openMap() {
  if (mapOpen) return;
  mapOpen = true;
  releaseAll();
  tapKey('KeyM');
  document.body.classList.add('tc-map');
}

function closeMap() {
  if (!mapOpen) return;
  mapOpen = false;
  tapKey('KeyM');
  document.body.classList.remove('tc-map');
}


/* ---------- State ---------- */
function syncState() {
  if (!CT) return;
  playing = !!CT.isPlaying();
  const on = playing && !CT.isDead();
  portrait = innerHeight > innerWidth;

  root.classList.toggle('on', on);
  root.classList.toggle('portrait', on && portrait);
  root.classList.toggle('tc-intro', on && introOn);

  if (prevOn && !on) {
    releaseAll();
    if (mapOpen) { mapOpen = false; document.body.classList.remove('tc-map'); }
  }
  prevOn = on;

  if (on && portrait) { releaseAll(); CT.pause(); }   // portrait: pause, the start card explains
}

async function keepAwake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}

function lockLandscape() {
  try {
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  } catch (e) {}
}


/* ---------- Scanner: wording + HUD pieces ---------- */
const HINT = /press|skip|enter|m\s*map|ai assistant|tap/i;

function scan() {
  if (!CT) return;
  syncState();
  if (!playing) return;

  let intro = false, use = false;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
      if (root.contains(n) || p.closest('#game-container')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const n of nodes) {
    let v = n.nodeValue;
    if (!v || !HINT.test(v)) continue;
    const before = v;

    // Barracks objective (before the generic rule)
    v = v.replace(/press\s*\[?\s*e\s*\]?\s*to\s+open\s+the\s+barracks/i, 'At the Barracks, tap the box to train');
    // intro
    v = v.replace(/press\s+space\s+to\s+skip/i, 'TAP TO SKIP');
    v = v.replace(/\s*[,·\-–]?\s*or\s+press\s+enter\b\.?/i, '');
    // generic "press [E]" in one text node
    v = v.replace(/press\s*\[\s*e\s*\]/i, 'Tap USE').replace(/\bpress\s+e\b/i, 'Tap USE');

    // "Press " + <b>[E]</b> + " to ..." (split nodes)
    if (/press\s*$/i.test(v)) {
      const s = n.nextSibling;
      if (s && s.nodeType === 1 && /^\s*\[?\s*e\s*\]?\s*$/i.test(s.textContent)) {
        const tail = (s.nextSibling && s.nextSibling.nodeType === 3) ? s.nextSibling : null;
        if (tail && /open the barracks/i.test(tail.nodeValue)) {
          v = v.replace(/press\s*$/i, 'At the Barracks, tap the box');
          s.textContent = '';
          tail.nodeValue = tail.nodeValue.replace(/\s*to\s+open\s+the\s+barracks/i, ' to train');
        } else {
          v = v.replace(/press\s*$/i, 'Tap ');
          s.textContent = 'USE';
        }
      }
    }

    // minimap label ("... M MAP")
    if (/m\s*map/i.test(v)) {
      if (labelMode === 'strip') v = v.replace(/\s*[·•\-–|]?\s*M\s*MAP/i, '');
      else if (labelMode === null) labelNode = n;
    }

    if (v !== before) n.nodeValue = v;

    const p = n.parentElement;
    if (/tap to skip/i.test(v) && shown(p)) intro = true;
    if (/tap use/i.test(v) && shown(p)) use = true;
    else if (/tap\s*$/i.test(v) && n.nextSibling && n.nextSibling.nodeType === 1 &&
             /^use$/i.test(n.nextSibling.textContent.trim()) && shown(p)) use = true;

    // AI assistant badge
    if (!aiEl && /ai assistant/i.test(v)) {
      const f = fixedAncestor(p);
      if (f) { aiEl = f; f.classList.add('tc-ai'); console.log('[touch] found assistant badge: ' + desc(f)); }
    }
  }

  // intro on/off
  if (intro !== introOn) {
    introOn = intro;
    root.classList.toggle('tc-intro', introOn);
    if (introOn) releaseAll();
  }
  useNow = use && !introOn;

  findMinimap();
  settleLabel();
  updateButtons();
}

function findMinimap() {
  if (mmEl) return;
  for (const c of document.querySelectorAll('canvas')) {
    if (c.closest('#game-container') || root.contains(c)) continue;
    if (!c.getClientRects().length) continue;
    const r = c.getBoundingClientRect();
    if (r.width > innerWidth * 0.8 && r.height > innerHeight * 0.8) continue;
    const el = fixedAncestor(c) || c;
    mmEl = el;
    el.classList.add('tc-mm');
    console.log('[touch] found minimap: ' + desc(el));
    return;
  }
}

function settleLabel() {
  if (labelMode || !labelNode || !mmEl) return;
  const lp = labelNode.parentElement;
  const lf = lp ? fixedAncestor(lp) : null;
  if (lf && lf !== mmEl && !mmEl.contains(lf)) {
    lf.classList.add('tc-hide');
    labelMode = 'hide';
    console.log('[touch] hid map label: ' + desc(lf));
  } else {
    labelMode = 'strip';
    console.log('[touch] map label text trimmed');
  }
}

function updateButtons() {
  const sup = document.getElementById('train-supply');
  const m = sup ? /ARMY\s*(\d+)/i.exec(sup.textContent) : null;
  const army = m ? parseInt(m[1], 10) : 0;
  pills.style.display = army > 0 ? 'flex' : 'none';
  btnUse.style.display = useNow ? 'flex' : 'none';
  btnScope.style.display = (window.campaignScope && typeof window.campaignScope.toggle === 'function') ? 'flex' : 'none';
}


/* ---------- Styles ---------- */
const CSS = `
:root{--tc-r:env(safe-area-inset-right,0px);--tc-l:env(safe-area-inset-left,0px)}
body.tc-phone{overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.tc-root *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.tc-root:not(.on) > *{display:none!important}

.tc-look{position:fixed;inset:0;z-index:12;touch-action:none}

.tc-ring{position:fixed;z-index:29;width:${STICK_R * 2}px;height:${STICK_R * 2}px;border-radius:50%;
  left:calc(34px + var(--tc-l));bottom:30px;pointer-events:none;opacity:.5;
  border:2px solid rgba(0,200,255,.5);background:rgba(10,24,44,.25)}
.tc-ring.act{opacity:1}
.tc-knob{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
  background:rgba(0,200,255,.4);border:2px solid rgba(180,240,255,.85)}

.tc-btn{position:fixed;z-index:30;display:flex;align-items:center;justify-content:center;border-radius:50%;
  background:rgba(10,24,44,.55);border:2px solid rgba(0,200,255,.75);color:#dff6ff;
  font:700 11px/1 system-ui,sans-serif;letter-spacing:.6px;touch-action:none;
  box-shadow:0 0 10px rgba(0,180,255,.25)}
.tc-btn.down{background:rgba(0,200,255,.45);transform:scale(.94)}
.tc-btn.fire{width:76px;height:76px;right:calc(20px + var(--tc-r));bottom:20px;font-size:13px;
  border-color:rgba(255,120,100,.85);background:rgba(60,16,16,.55)}
.tc-btn.fire.down{background:rgba(255,90,70,.5)}
.tc-btn.jump{width:54px;height:54px;right:calc(30px + var(--tc-r));bottom:108px}
.tc-btn.reload{width:52px;height:52px;right:calc(108px + var(--tc-r));bottom:24px;font-size:10px}
.tc-btn.swap{width:44px;height:44px;right:calc(116px + var(--tc-r));bottom:84px;font-size:10px}
.tc-btn.scope{width:44px;height:44px;right:calc(176px + var(--tc-r));bottom:84px;font-size:9px}
.tc-btn.use{width:60px;height:60px;right:calc(200px + var(--tc-r));bottom:130px;
  border-color:rgba(255,210,74,.9);background:rgba(60,46,8,.6);color:#ffe9a0;font-size:13px}
.tc-btn.pause{width:36px;height:36px;right:calc(8px + var(--tc-r));top:8px;font-size:11px}

.tc-pills{position:fixed;z-index:30;left:50%;transform:translateX(-50%);bottom:38px;gap:8px}
.tc-pill{min-width:68px;height:34px;padding:0 10px;border-radius:17px;display:flex;align-items:center;justify-content:center;
  background:rgba(10,24,44,.6);border:1.5px solid rgba(0,200,255,.7);color:#dff6ff;
  font:700 11px/1 system-ui,sans-serif;letter-spacing:.6px;touch-action:none}
.tc-pill.down{background:rgba(0,200,255,.45)}

/* intro: only the tap layer */
.tc-root.tc-intro > :not(.tc-look){display:none!important}

/* map open: only the close bar */
.tc-mapclose{position:fixed;inset:0;z-index:2147483000;display:none;align-items:flex-end;justify-content:center;
  padding-bottom:14px;touch-action:none}
.tc-mapclose span{padding:10px 20px;border-radius:20px;background:rgba(10,24,44,.85);
  border:1px solid rgba(0,200,255,.75);color:#dff6ff;font:700 13px/1 system-ui,sans-serif;letter-spacing:1px}
body.tc-map .tc-root.on > .tc-mapclose{display:flex}
body.tc-map .tc-root > :not(.tc-mapclose){display:none!important}

/* portrait: ask to rotate */
.tc-rotate{position:fixed;inset:0;z-index:2147483100;display:none;align-items:center;justify-content:center;
  background:#05101f;color:#dff6ff;text-align:center;font:600 15px/1.6 system-ui,sans-serif}
.tc-rotate b{font-size:20px;letter-spacing:1.5px;color:#00f0ff}
.tc-root.portrait > .tc-rotate{display:flex!important}
.tc-root.portrait > :not(.tc-rotate){display:none!important}

/* ---------- HUD tidy-up (phone only) ---------- */
body.tc-phone #hud-info{display:none!important}
body.tc-phone #hud-title,body.tc-phone #hud-mode{font-size:10px!important;opacity:.85}
body.tc-phone #gun-hud{transform:scale(.7)!important;transform-origin:bottom right!important;
  left:auto!important;top:auto!important;right:calc(170px + var(--tc-r))!important;bottom:16px!important}
body.tc-phone #gun-hud .gun-hint{display:none!important}
body.tc-phone #health-hud{width:150px!important}
body.tc-phone #guide-objective,body.tc-phone #mission-objective{zoom:.68}
body.tc-phone #mission-objective{top:9px!important}
body.tc-phone #mission-bar{zoom:.7;top:63px!important}
body.tc-phone #mission-radio{transform:scale(.66)!important;transform-origin:top left!important;
  left:calc(10px + var(--tc-l))!important;top:122px!important;max-width:340px}
body.tc-phone #train-supply{left:calc(10px + var(--tc-l))!important;top:58px!important;bottom:auto!important;
  transform:scale(.7);transform-origin:top left}
body.tc-phone #train-box{bottom:84px!important}
body.tc-phone .tc-ai{left:calc(10px + var(--tc-l))!important;top:92px!important;right:auto!important;bottom:auto!important;
  transform:scale(.62)!important;transform-origin:top left!important;z-index:35!important}
body.tc-phone:not(.tc-map) .tc-mm{position:fixed!important;transform:scale(${MINIMAP_SCALE})!important;transform-origin:top right!important;
  top:52px!important;right:calc(8px + var(--tc-r))!important;left:auto!important;bottom:auto!important}
body.tc-phone #mission-end button,body.tc-phone #restart-btn{min-height:48px;font-size:16px!important;padding:12px 22px!important}
.tc-hide{display:none!important}
`;