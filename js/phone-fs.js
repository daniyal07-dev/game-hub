// js/phone-fs.js
// Phones only: the first tap on the front door (play.html) opens fullscreen
// and locks the screen to landscape. PC is never touched.
//  - Android Chrome: fullscreen + landscape lock.
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

  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  let done = false;       // fullscreen reached
  let gaveUp = false;     // the player left fullscreen on purpose
  let busy = false;

  function lockLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (e) {}
  }

  function goFull() {
    if (done || gaveUp || busy || STANDALONE) return;
    if (isFull()) { done = true; lockLandscape(); return; }
    const req = de.requestFullscreen || de.webkitRequestFullscreen;
    if (!req) return;                       // iPhone: no fullscreen for pages
    busy = true;
    let p;
    try { p = req.call(de, { navigationUI: 'hide' }); } catch (e) { p = null; }
    const ok = () => { busy = false; done = true; lockLandscape(); console.log('[phone-fs] fullscreen + landscape'); };
    const fail = () => { busy = false; };   // try again on the next tap
    if (p && p.then) p.then(ok, fail); else setTimeout(() => (isFull() ? ok() : fail()), 300);
  }

  function onFsChange() {
    if (isFull()) { done = true; lockLandscape(); }
    else if (done) { done = false; gaveUp = true; }   // the player exited: do not nag
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  // first real taps (capture, so nothing can stop them before us)
  const gesture = () => {
    goFull();
    if (done || gaveUp || !(de.requestFullscreen || de.webkitRequestFullscreen)) {
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