// js/phone-fs.js  (v2)
// Phones only: the first tap on a page opens fullscreen and locks landscape.
// Linked in play.html and every game page. PC is never touched.
//  - Android Chrome: fullscreen + landscape lock (browsers drop fullscreen on every
//    page change, so each game page re-enters it on its first tap).
//  - iPhone: not possible in Safari, so a one-time "Add to Home Screen" tip is shown.

(function () {
  const PHONE = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  if (!PHONE) return;

  const de = document.documentElement;
  const IOS = /iphone|ipod|ipad/i.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const STANDALONE = (window.matchMedia && window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) ||
                     window.navigator.standalone === true;
  const TIP_KEY = 'nova_ios_tip';
  const OFF_KEY = 'nova_fs_off';        // sessionStorage: the player left fullscreen on purpose

  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const canFull = !!(de.requestFullscreen || de.webkitRequestFullscreen);

  let done = false;       // fullscreen reached on this page
  let leaving = false;    // this page is closing (a page change also ends fullscreen)
  let busy = false;
  let gaveUp = false;
  try { gaveUp = sessionStorage.getItem(OFF_KEY) === '1'; } catch (e) {}

  function lockLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (e) {}
  }

  function goFull() {
    if (done || gaveUp || busy || STANDALONE || !canFull) return;
    if (isFull()) { done = true; lockLandscape(); return; }
    const req = de.requestFullscreen || de.webkitRequestFullscreen;
    busy = true;
    let p;
    try { p = req.call(de, { navigationUI: 'hide' }); } catch (e) { p = null; }
    const ok = () => { busy = false; done = true; lockLandscape(); console.log('[phone-fs] fullscreen + landscape'); };
    const fail = () => { busy = false; };   // try again on the next tap
    if (p && p.then) p.then(ok, fail); else setTimeout(() => (isFull() ? ok() : fail()), 300);
  }

  window.addEventListener('pagehide', () => { leaving = true; });
  window.addEventListener('beforeunload', () => { leaving = true; });

  function onFsChange() {
    if (isFull()) { done = true; lockLandscape(); return; }
    if (done && !leaving) {                 // the player exited on purpose: do not nag
      done = false; gaveUp = true;
      try { sessionStorage.setItem(OFF_KEY, '1'); } catch (e) {}
    }
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  // taps (capture, so nothing can stop them before us)
  const gesture = () => {
    goFull();
    if (done || gaveUp || !canFull) {
      window.removeEventListener('pointerup', gesture, true);
      window.removeEventListener('click', gesture, true);
    }
  };
  window.addEventListener('pointerup', gesture, true);
  window.addEventListener('click', gesture, true);

  // iPhone: a short tip, shown once
  function iosTip() {
    if (!IOS || STANDALONE) return;
    try { if (localStorage.getItem(TIP_KEY)) return; } catch (e) {}
    const tip = document.createElement('div');
    tip.textContent = 'For fullscreen: Share → Add to Home Screen. Then turn your phone sideways.';
    tip.style.cssText = 'position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));' +
      'transform:translateX(-50%);z-index:2147483200;max-width:86vw;padding:9px 14px;border-radius:12px;' +
      'background:rgba(8,18,34,.92);border:1px solid rgba(0,200,255,.6);color:#dff6ff;' +
      'font:600 12px/1.4 system-ui,sans-serif;text-align:center';
    const close = () => { tip.remove(); try { localStorage.setItem(TIP_KEY, '1'); } catch (e) {} };
    tip.addEventListener('click', close);
    setTimeout(close, 9000);
    (document.body || de).appendChild(tip);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(iosTip, 1500));
  else setTimeout(iosTip, 1500);

  console.log('[phone-fs] ready' + (IOS ? ' (iPhone tip)' : ''));
})();