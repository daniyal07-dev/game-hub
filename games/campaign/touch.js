// ============================================================
//  NOVA STRIKE 3D — Campaign: games/campaign/touch.js  (v1, NEW FILE)
//  Phone controls. Loaded ONLY on phones (campaign.html decides).
//  PC never loads this file, so PC controls stay exactly as they are.
//
//  Left thumb : floating joystick (push far = sprint)
//  Right thumb: drag anywhere to look
//  Buttons    : FIRE (drag on it to aim too), JUMP, RELOAD, SWAP (Q),
//               USE (E), MAP (M), NOVA (N), PAUSE, squad orders 1/2/3
//  Talks to the game through window.campaignTouch (main.js)
//  and setFireHeld (player.js). Button taps send the same key
//  events as the keyboard, so every game rule stays the same.
// ============================================================
import * as GUN from './player.js';     // namespace import: never crashes if an old player.js is cached

// ---------- knobs ----------
const STICK_R = 52;            // joystick radius in pixels
const SPRINT_ON = 1.35;        // drag this far (x radius) = sprint
const SPRINT_OFF = 1.1;        // come back under this = walk again
const DEADZONE = 0.12;         // tiny pushes are ignored
const LOOK_MULT = 1.0;         // bigger = faster turning (main.js TOUCH_SENS is the base speed)
const INTRO_SECONDS = 14;      // controls stay hidden this long at the first start (tap = skip intro)
const KEY = {
  use:    ['KeyE', 'e'],
  map:    ['KeyM', 'm'],
  nova:   ['KeyN', 'n'],
  reload: ['KeyR', 'r'],
  swap:   ['KeyQ', 'q'],
  s1:     ['Digit1', '1'],
  s2:     ['Digit2', '2'],
  s3:     ['Digit3', '3'],
  enter:  ['Enter', 'Enter'],
};

const CSS = `
html,body{overscroll-behavior:none;}
.tc-phone,.tc-phone *{-webkit-tap-highlight-color:transparent;}
.tc-root{position:fixed;left:0;top:0;right:0;bottom:0;z-index:30;display:none;pointer-events:none;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none;}
.tc-root.on{display:block;}
.tc-zone{position:absolute;pointer-events:auto;touch-action:none;}
.tc-look{left:0;top:0;right:0;bottom:0;}
.tc-move{left:0;bottom:0;width:42%;height:68%;}

.tc-idle{position:absolute;left:78px;bottom:70px;width:104px;height:104px;margin:0;border-radius:50%;
  border:2px dashed rgba(56,182,255,.35);pointer-events:none;transition:opacity .15s;}
.tc-idle.hide{opacity:0;}
.tc-base{position:absolute;width:104px;height:104px;margin:-52px 0 0 -52px;border-radius:50%;display:none;
  background:rgba(10,30,60,.35);border:2px solid rgba(56,182,255,.7);pointer-events:none;
  box-shadow:0 0 14px rgba(56,182,255,.3);}
.tc-base.on{display:block;}
.tc-base.run{border-color:#ffd24a;box-shadow:0 0 16px rgba(255,210,74,.55);}
.tc-knob{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
  background:rgba(120,205,255,.75);border:2px solid #bfe4ff;}
.tc-base.run .tc-knob{background:rgba(255,215,100,.85);border-color:#fff1c0;}

.tc-btn{position:absolute;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;
  border-radius:50%;color:#e8f4ff;font:800 11px/1 system-ui,Segoe UI,sans-serif;letter-spacing:.5px;text-align:center;
  background:rgba(10,30,60,.55);border:2px solid rgba(56,182,255,.75);box-shadow:0 0 10px rgba(56,182,255,.3);
  transition:transform .05s,background .05s;}
.tc-btn.down{background:rgba(56,182,255,.6);transform:scale(.92);}
.tc-fire{right:24px;bottom:24px;width:96px;height:96px;font-size:15px;letter-spacing:1px;
  background:rgba(120,15,15,.6);border-color:rgba(255,100,90,.9);box-shadow:0 0 14px rgba(255,80,70,.4);}
.tc-fire.down{background:rgba(255,80,70,.65);}
.tc-jump{right:132px;bottom:30px;width:60px;height:60px;}
.tc-reload{right:30px;bottom:130px;width:52px;height:52px;font-size:10px;}
.tc-swap{right:92px;bottom:118px;width:52px;height:52px;}
.tc-use{right:154px;bottom:100px;width:52px;height:52px;}
.tc-sys{right:12px;width:42px;height:42px;font-size:10px;}
.tc-pause{top:10px;font-size:14px;}
.tc-map{top:60px;}
.tc-nova{top:110px;}
.tc-squad{position:absolute;left:50%;bottom:54px;transform:translateX(-50%);display:flex;gap:6px;pointer-events:none;}
.tc-pill{position:static;pointer-events:auto;border-radius:10px;width:66px;height:34px;font-size:10px;}
.tc-root.tc-intro .tc-btn,.tc-root.tc-intro .tc-squad,.tc-root.tc-intro .tc-idle{visibility:hidden;}

/* phone-only tweaks to the existing HUD (these only apply on phones) */
.tc-phone #gun-hud{right:214px !important;bottom:150px !important;}
.tc-phone #gun-hud .gun-hint{display:none;}
.tc-phone #health-hud{width:170px !important;bottom:12px !important;}

.tc-rotate{position:fixed;left:0;top:0;right:0;bottom:0;z-index:300;display:none;flex-direction:column;
  align-items:center;justify-content:center;gap:14px;background:#06101f;color:#e8f4ff;text-align:center;
  font:700 18px/1.4 system-ui,Segoe UI,sans-serif;letter-spacing:1px;padding:24px;}
.tc-rotate .ico{font-size:64px;color:#38b6ff;animation:tcSpin 2.4s ease-in-out infinite;}
.tc-rotate small{font-weight:500;font-size:13px;opacity:.7;letter-spacing:.5px;}
@keyframes tcSpin{0%,20%{transform:rotate(0)}60%,100%{transform:rotate(-90deg)}}
@media (orientation: portrait){ .tc-phone .tc-rotate{display:flex;} }
`;

let started = false;

function init() {
  if (started) return;
  started = true;
  let tries = 0;
  const wait = setInterval(() => {
    const door = window.campaignTouch;
    if (door) {
      clearInterval(wait);
      if (door.isPhone) build(door);
      else console.log('[touch] this is not a phone, touch controls stay off');
    } else if (++tries > 100) {
      clearInterval(wait);
      console.warn('[touch] the game did not start, touch controls are off');
    }
  }, 100);
}

function build(door) {
  // ---------- page setup ----------
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.body.classList.add('tc-phone');

  const rot = document.createElement('div');
  rot.className = 'tc-rotate';
  rot.innerHTML = '<div class="ico">⟳</div><div>ROTATE YOUR PHONE</div><small>NOVA STRIKE 3D plays in landscape</small>';
  document.body.appendChild(rot);

  const root = document.createElement('div');
  root.className = 'tc-root';
  document.body.appendChild(root);

  const add = (cls, parent) => {
    const d = document.createElement('div');
    d.className = cls;
    (parent || root).appendChild(d);
    return d;
  };

  const releasers = [];

  // ---------- key taps (same events as the keyboard) ----------
  function tapKey(pair) {
    const make = (type) => new KeyboardEvent(type, { code: pair[0], key: pair[1], bubbles: true, cancelable: true });
    document.dispatchEvent(make('keydown'));
    setTimeout(() => document.dispatchEvent(make('keyup')), 70);
  }

  // ---------- generic hold / tap button (one finger per button) ----------
  function button(cls, label, onDown, onUp, aimToo, parent) {
    const b = add('tc-btn ' + cls, parent);
    b.textContent = label;
    let id = null, lx = 0, ly = 0;
    b.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (id !== null) return;
      const t = e.changedTouches[0];
      id = t.identifier; lx = t.clientX; ly = t.clientY;
      b.classList.add('down');
      if (onDown) onDown();
    }, { passive: false });
    b.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        e.preventDefault();
        if (aimToo) door.look((t.clientX - lx) * LOOK_MULT, (t.clientY - ly) * LOOK_MULT);
        lx = t.clientX; ly = t.clientY;
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        id = null; b.classList.remove('down');
        if (onUp) onUp();
      }
    };
    b.addEventListener('touchend', end);
    b.addEventListener('touchcancel', end);
    releasers.push(() => { if (id !== null) { id = null; b.classList.remove('down'); if (onUp) onUp(); } });
    return b;
  }
  const tapBtn = (cls, label, pair, parent) => button(cls, label, () => tapKey(pair), null, false, parent);

  // ---------- intro: controls stay hidden, any tap skips it ----------
  let introHide = false, introTimer = 0, introShown = false;
  function revealControls() {
    introHide = false;
    clearTimeout(introTimer);
    root.classList.remove('tc-intro');
  }
  function skipIntro() {
    revealControls();
    tapKey(KEY.enter);
  }

  // ---------- look zone (whole screen, below everything else) ----------
  const lookZone = add('tc-zone tc-look');
  let lid = null, llx = 0, lly = 0;
  lookZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (introHide) { skipIntro(); return; }
    if (lid !== null) return;
    const t = e.changedTouches[0];
    lid = t.identifier; llx = t.clientX; lly = t.clientY;
  }, { passive: false });
  lookZone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lid) continue;
      e.preventDefault();
      door.look((t.clientX - llx) * LOOK_MULT, (t.clientY - lly) * LOOK_MULT);
      llx = t.clientX; lly = t.clientY;
    }
  }, { passive: false });
  const lookEnd = (e) => { for (const t of e.changedTouches) if (t.identifier === lid) lid = null; };
  lookZone.addEventListener('touchend', lookEnd);
  lookZone.addEventListener('touchcancel', lookEnd);
  releasers.push(() => { lid = null; });

  // ---------- joystick (left, floating under the thumb) ----------
  const idle = add('tc-idle');
  const moveZone = add('tc-zone tc-move');
  const base = add('tc-base');
  const knob = add('tc-knob', base);
  let sid = null, ox = 0, oy = 0, sprinting = false;

  function stickUpdate(t) {
    const dx = t.clientX - ox, dy = t.clientY - oy;
    const dist = Math.hypot(dx, dy);
    const k = dist > STICK_R ? STICK_R / dist : 1;
    knob.style.transform = 'translate(' + (dx * k) + 'px,' + (dy * k) + 'px)';
    let vx = dx / STICK_R, vy = -dy / STICK_R;
    const len = Math.hypot(vx, vy);
    if (len > 1) { vx /= len; vy /= len; }
    if (len < DEADZONE) { vx = 0; vy = 0; }
    door.move(vx, vy);
    const ratio = dist / STICK_R;
    if (!sprinting && ratio > SPRINT_ON) sprinting = true;
    else if (sprinting && ratio < SPRINT_OFF) sprinting = false;
    door.sprint(sprinting);
    base.classList.toggle('run', sprinting);
  }
  function stickStop() {
    sid = null; sprinting = false;
    base.classList.remove('on', 'run');
    idle.classList.remove('hide');
    knob.style.transform = '';
    door.move(0, 0);
    door.sprint(false);
  }
  moveZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (introHide) { skipIntro(); return; }
    if (sid !== null) return;
    const t = e.changedTouches[0];
    sid = t.identifier; ox = t.clientX; oy = t.clientY;
    base.style.left = ox + 'px'; base.style.top = oy + 'px';
    base.classList.add('on');
    idle.classList.add('hide');
    stickUpdate(t);
  }, { passive: false });
  moveZone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== sid) continue;
      e.preventDefault();
      stickUpdate(t);
    }
  }, { passive: false });
  const stickEnd = (e) => { for (const t of e.changedTouches) if (t.identifier === sid) stickStop(); };
  moveZone.addEventListener('touchend', stickEnd);
  moveZone.addEventListener('touchcancel', stickEnd);
  releasers.push(stickStop);

  // ---------- buttons ----------
  const fireOn = () => { if (GUN.setFireHeld) GUN.setFireHeld(true); };
  const fireOff = () => { if (GUN.setFireHeld) GUN.setFireHeld(false); };
  button('tc-fire', 'FIRE', fireOn, fireOff, true);
  button('tc-jump', 'JUMP', () => door.jump(true), () => door.jump(false));
  tapBtn('tc-reload', 'RELOAD', KEY.reload);
  tapBtn('tc-swap', 'SWAP', KEY.swap);
  tapBtn('tc-use', 'USE', KEY.use);
  button('tc-sys tc-pause', '❚❚', () => door.pause());
  tapBtn('tc-sys tc-map', 'MAP', KEY.map);
  tapBtn('tc-sys tc-nova', 'NOVA', KEY.nova);

  const squad = add('tc-squad');
  tapBtn('tc-pill', 'FOLLOW', KEY.s1, squad);
  tapBtn('tc-pill', 'HOLD', KEY.s2, squad);
  tapBtn('tc-pill', 'ATTACK', KEY.s3, squad);

  // ---------- show / hide with the game ----------
  function releaseAll() {
    releasers.forEach((f) => f());
    door.move(0, 0); door.sprint(false); door.jump(false);
    fireOff();
  }

  let wakeLock = null;
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* optional */ }
  }
  function lockLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        const p = screen.orientation.lock('landscape');
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { /* optional */ }
  }

  window.addEventListener('campaign:playing', (e) => {
    const on = !!(e.detail && e.detail.playing);
    if (on) {
      if (!introShown) {                       // first start only: hide the controls during the intro
        introShown = true;
        if (INTRO_SECONDS > 0) {
          introHide = true;
          root.classList.add('tc-intro');
          introTimer = setTimeout(revealControls, INTRO_SECONDS * 1000);
        }
      }
      keepAwake();
      lockLandscape();
      root.classList.add('on');
    } else {
      root.classList.remove('on');
      releaseAll();
    }
  });

  // turning to portrait pauses the game (the rotate message covers the screen)
  const portrait = window.matchMedia('(orientation: portrait)');
  const onTurn = () => { if (portrait.matches && door.isPlaying()) door.pause(); };
  if (portrait.addEventListener) portrait.addEventListener('change', onTurn);
  else if (portrait.addListener) portrait.addListener(onTurn);

  // keep the controls from showing if the game is already running
  if (door.isPlaying()) root.classList.add('on');

  console.log('[touch] phone controls ready');
}

init();