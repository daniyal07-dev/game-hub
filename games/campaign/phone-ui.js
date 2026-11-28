// games/campaign/phone-ui.js  (v2)
// PHONE ONLY. Loaded by campaign.html on phones (or with ?phone=1 on a PC for testing).
// Adds: Settings button, SCOPE fallback button, driving pad (arrows, gas, reverse, brake, boost),
//       scope controls on top of the dark scope overlay, Settings panel fit, HUD text fit.
// The PC game never loads this file.

(() => {
  const PHONE = /[?&]phone=1/.test(location.search) ||
    (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  if (!PHONE) return;

  // ---------- keys (read the real bindings if possible) ----------
  let KB = null;
  import('./keybinds.js').then((m) => { KB = m; }).catch(() => {});
  const DEF = { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft' };
  const KEYCHAR = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', Space: ' ', ShiftLeft: 'Shift', ShiftRight: 'Shift' };
  function codeFor(action) {
    try {
      if (KB && KB.key) {
        const k = KB.key(action);
        const c = typeof k === 'string' ? k : (k && k.code);
        if (c) return c;
      }
    } catch (e) { /* use default */ }
    return DEF[action];
  }
  function fireKey(type, code) {
    if (!code) return;
    document.dispatchEvent(new KeyboardEvent(type, {
      code, key: KEYCHAR[code] || code, bubbles: true, cancelable: true,
      shiftKey: code.indexOf('Shift') === 0,
    }));
  }
  const held = new Map();                       // action -> code that is currently down
  function hold(action, on) {
    if (on && !held.has(action)) {
      const c = codeFor(action);
      held.set(action, c);
      fireKey('keydown', c);
    } else if (!on && held.has(action)) {
      fireKey('keyup', held.get(action));
      held.delete(action);
    }
  }
  function releaseAll() { Array.from(held.keys()).forEach((a) => hold(a, false)); }

  // ---------- helpers ----------
  function flag(o, k) {
    try {
      if (!o) return false;
      const v = o[k];
      return typeof v === 'function' ? !!o[k]() : !!v;
    } catch (e) { return false; }
  }
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // ---------- style ----------
  const css = document.createElement('style');
  css.textContent = `
    .ph-btn { position: fixed; z-index: 45; display: none; align-items: center; justify-content: center;
      flex-direction: column; border-radius: 50%; border: 2px solid #38b6ff; color: #fff;
      background: rgba(10,22,40,0.72); font: 800 12px system-ui, Arial, sans-serif; letter-spacing: 1px;
      touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
      box-shadow: 0 0 10px rgba(56,182,255,0.35); }
    .ph-btn small { font-size: 9px; letter-spacing: 1px; opacity: 0.85; }
    .ph-btn.on { background: rgba(56,182,255,0.55); }
    .ph-arrow { font-size: 28px; font-weight: 700; }

    #ph-settings { top: 8px; right: 54px; width: 36px; height: 36px; font-size: 18px; }
    #ph-scope { right: 19vw; bottom: 44vh; width: 46px; height: 46px; }

    /* driving pad */
    #ph-left  { left: calc(14px + env(safe-area-inset-left)); bottom: 18px; width: 66px; height: 66px; }
    #ph-right { left: calc(90px + env(safe-area-inset-left)); bottom: 18px; width: 66px; height: 66px; }
    #ph-gas   { right: calc(14px + env(safe-area-inset-right)); bottom: 18px; width: 76px; height: 76px;
      border-color: #5dff9a; }
    #ph-rev   { right: calc(100px + env(safe-area-inset-right)); bottom: 18px; width: 60px; height: 60px; }
    #ph-brake { right: calc(22px + env(safe-area-inset-right)); bottom: 102px; width: 54px; height: 54px;
      border-color: #ff6a6a; }
    #ph-boost { right: calc(100px + env(safe-area-inset-right)); bottom: 86px; width: 54px; height: 54px;
      border-color: #ffd24a; }
    body.ph-driving .ph-drive { display: flex; }

    /* truck info and VIEW / GET OUT move to the left while driving */
    body.ph-driving #veh-hud { left: 10px !important; right: auto !important; top: 112px !important;
      bottom: auto !important; text-align: left !important; transform: none !important; }
    body.ph-driving #veh-btns { position: fixed !important; left: 10px !important; right: auto !important;
      top: 188px !important; bottom: auto !important; transform: none !important;
      justify-content: flex-start !important; gap: 8px !important; }

    /* top-left status text: wrap so the objective bar does not cover it */
    #hud { max-width: 30vw; }
    #hud-mode { white-space: normal !important; font-size: 11px !important; line-height: 1.25; }
    #hud-info { font-size: 11px !important; }

    /* Settings panel on phones */
    [data-phone-fit] { max-height: 90vh !important; max-height: 90dvh !important; overflow-y: auto !important;
      width: min(94vw, 560px) !important; -webkit-overflow-scrolling: touch; }
    [data-phone-fit] button, [data-phone-fit] select { min-height: 44px; font-size: 15px; }
    [data-phone-fit] input[type=range] { height: 36px; }
    [data-phone-fit] input[type=checkbox] { width: 26px; height: 26px; }
  `;
  document.head.appendChild(css);

  // ---------- buttons ----------
  function mk(id, cls, html) {
    const b = document.createElement('div');
    b.id = id;
    b.className = 'ph-btn ' + cls;
    b.setAttribute('data-ph', '1');
    b.setAttribute('role', 'button');
    b.innerHTML = html;
    document.body.appendChild(b);
    return b;
  }
  function stop(e) { e.preventDefault(); e.stopPropagation(); }
  function holdBtn(el, action) {
    const down = (e) => {
      stop(e);
      try { if (e.pointerId !== undefined) el.setPointerCapture(e.pointerId); } catch (_) {}
      el.classList.add('on');
      hold(action, true);
    };
    const up = (e) => { stop(e); el.classList.remove('on'); hold(action, false); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('touchstart', stop, { passive: false });
    el.addEventListener('touchend', stop, { passive: false });
    el.addEventListener('contextmenu', stop);
  }

  const bSettings = mk('ph-settings', '', '⚙');
  const bScope = mk('ph-scope', '', 'SCOPE');
  const bLeft = mk('ph-left', 'ph-drive ph-arrow', '◀');
  const bRight = mk('ph-right', 'ph-drive ph-arrow', '▶');
  const bGas = mk('ph-gas', 'ph-drive', '<span class="ph-arrow">▲</span><small>GAS</small>');
  const bRev = mk('ph-rev', 'ph-drive', '<span class="ph-arrow">▼</span><small>REVERSE</small>');
  const bBrake = mk('ph-brake', 'ph-drive', 'BRAKE');
  const bBoost = mk('ph-boost', 'ph-drive', 'BOOST');

  holdBtn(bLeft, 'left');
  holdBtn(bRight, 'right');
  holdBtn(bGas, 'forward');
  holdBtn(bRev, 'back');
  holdBtn(bBrake, 'jump');
  holdBtn(bBoost, 'sprint');

  bSettings.addEventListener('click', (e) => {
    stop(e);
    const t = window.campaignTouch;
    try { if (t && t.pause) t.pause(); } catch (_) {}
    setTimeout(() => { if (window.openSettings) window.openSettings(); }, 150);
  });
  bScope.addEventListener('click', (e) => {
    stop(e);
    try { window.campaignScope && window.campaignScope.toggle(); } catch (_) {}
  });

  // ---------- find the touch.js buttons by their text ----------
  const LABELS = /^(FIRE|JUMP|BRAKE|SWAP|RELOAD|SCOPE|FOLLOW|HOLD|ATTACK)$/;
  function scan() {
    const out = { btns: [], names: {}, assistant: [] };
    document.body.querySelectorAll('button, div, span, a').forEach((el) => {
      if (el.closest('[data-ph]') || el.closest('#start-screen') || el.closest('[data-phone-fit]')) return;
      const t = norm(el.textContent);
      if (!t || t.length > 20) return;
      if (LABELS.test(t) && !el.children.length) {
        const target = el.closest('button') || el;
        out.btns.push(target);
        out.names[t] = true;
      } else if (/^N AI Assistant$/.test(t) &&
                 !Array.from(el.children).some((c) => norm(c.textContent) === t)) {
        out.assistant.push(el.closest('button') || el);
      }
    });
    return out;
  }

  // the touch.js joystick: a round box of about 70-170 px in the lower left
  let stickEl = null;
  function findStick() {
    if (stickEl && document.body.contains(stickEl)) return stickEl;
    const W = innerWidth, H = innerHeight;
    let best = null;
    document.body.querySelectorAll('div').forEach((el) => {
      if (best || el.closest('[data-ph]') || el.closest('#start-screen') || el.children.length > 3) return;
      const r = el.getBoundingClientRect();
      if (r.width < 70 || r.width > 170 || Math.abs(r.width - r.height) > 8) return;
      if (r.left > W * 0.35 || r.top < H * 0.35) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const br = cs.borderTopLeftRadius || '0';
      const round = br.indexOf('%') >= 0 ? parseFloat(br) >= 35 : parseFloat(br) >= r.width * 0.35;
      if (round) best = el;
    });
    stickEl = best;
    return best;
  }

  // hide things while driving, remember the old value
  const hid = new Map();
  function setHidden(drive, els) {
    if (drive) {
      els.forEach((el) => {
        if (el && !hid.has(el)) { hid.set(el, el.style.visibility); el.style.visibility = 'hidden'; }
      });
    } else {
      hid.forEach((old, el) => { el.style.visibility = old; });
      hid.clear();
    }
  }

  // lift touch controls above the dark scope overlay
  const lifted = new Map();
  function topChild(el) {
    while (el && el.parentElement && el.parentElement !== document.body) el = el.parentElement;
    return el;
  }
  function lift(on, els) {
    const roots = new Set();
    if (on) els.forEach((el) => { const r = topChild(el); if (r && r !== document.body) roots.add(r); });
    lifted.forEach((old, el) => { if (!roots.has(el)) { el.style.zIndex = old; lifted.delete(el); } });
    roots.forEach((el) => {
      if (!lifted.has(el)) lifted.set(el, el.style.zIndex);
      el.style.zIndex = '50';
    });
  }

  // Settings panel: fits the phone, no key rebinding
  function fitSettings() {
    Array.from(document.body.children).forEach((el) => {
      if (el.hasAttribute('data-phone-fit') || el.hasAttribute('data-ph')) return;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || (parseInt(cs.zIndex, 10) || 0) < 9000) return;
      if (!/settings/i.test(el.textContent || '')) return;
      // the backdrop may wrap the real panel
      let panel = el;
      const inner = Array.from(el.children).find((c) => /settings/i.test(c.textContent || '') && c.offsetHeight > 100);
      if (inner && el.offsetWidth > innerWidth * 0.95 && el.offsetHeight > innerHeight * 0.95) panel = inner;
      panel.setAttribute('data-phone-fit', '1');
    });
    document.querySelectorAll('[data-phone-fit] button').forEach((b) => {
      const t = norm(b.textContent);
      if (t.length < 30 && /controls/i.test(t)) b.style.display = 'none';
    });
  }

  // ---------- main loop ----------
  function startOpen() {
    const s = document.getElementById('start-screen');
    return !!s && !s.classList.contains('hidden') && getComputedStyle(s).display !== 'none';
  }
  function tick() {
    const t = window.campaignTouch;
    const open = startOpen();
    const loading = document.getElementById('loading');
    const loaded = !loading || getComputedStyle(loading).display === 'none';
    const playing = (t && typeof t.isPlaying !== 'undefined')
      ? (flag(t, 'isPlaying') && !flag(t, 'isDead'))
      : (!open && loaded);
    const drive = playing && flag(window.campaignTruck, 'isDriving');
    const scoped = playing && flag(window.campaignScope, 'isOn');
    const s = scan();
    const stick = drive || scoped ? findStick() : (findStick(), stickEl);

    document.body.classList.toggle('ph-driving', drive);
    if (!drive) releaseAll();

    bSettings.style.display = (playing && !open && window.openSettings) ? 'flex' : 'none';
    bScope.style.display = (playing && !drive && !s.names.SCOPE &&
                            window.campaignScope && window.campaignScope.toggle) ? 'flex' : 'none';

    // while driving: hide the walking controls and the joystick
    setHidden(drive, drive ? s.btns.concat(stick ? [stick] : []) : []);

    // while the scope is open: keep the controls on top
    lift(scoped && !drive, scoped && !drive ? s.btns.concat(stick ? [stick] : []) : []);

    // the assistant button must not cover the start card
    s.assistant.forEach((el) => { el.style.visibility = open ? 'hidden' : ''; });

    fitSettings();
  }
  setInterval(tick, 250);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  console.log('[phone-ui] v2 ready: settings button, scope fallback, driving pad (arrows, gas, reverse, brake, boost), scope controls on top, HUD text fit');
})();