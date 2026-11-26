/* =========================================================
   NOVA STRIKE 3D: "STAGE 1" badge for the menu (js/badge.js) v2
   Adds a glowing pill above the menu title and a line in the
   menu footer. menu.js is NOT changed.
   To change the text, edit LABEL and FOOT.
   ========================================================= */
(function () {
  'use strict';

  var LABEL = 'STAGE 1';
  var FOOT  = 'NOVA STRIKE 3D · Stage 1';

  var st = document.createElement('style');
  st.textContent =
    '.nm-stage{display:flex;align-items:center;gap:8px;width:max-content;max-width:100%;margin:0 auto 12px;padding:6px 16px;border-radius:999px;' +
      'border:1px solid rgba(56,182,255,.7);background:rgba(56,182,255,.14);color:#d8ecff;position:relative;z-index:5;' +
      'font:800 11px/1 "Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.3em;animation:nmStg 3s ease-in-out infinite}' +
    '.nm-stage i{display:block;width:7px;height:7px;border-radius:50%;background:#38b6ff;box-shadow:0 0 9px #38b6ff}' +
    '@keyframes nmStg{0%,100%{box-shadow:0 0 8px rgba(56,182,255,.3)}50%{box-shadow:0 0 22px rgba(56,182,255,.85)}}' +
    '.nm-stage-foot{margin-bottom:4px;text-align:center;font:700 12px/1.4 "Segoe UI",system-ui,Arial,sans-serif;letter-spacing:.14em;color:#7fc6ff}' +
    '@media(prefers-reduced-motion:reduce){.nm-stage{animation:none}}';
  document.head.appendChild(st);

  var doneHead = false, doneFoot = false, obs = null, told = false;

  function addBadge() {
    var menu = document.getElementById('nm-menu');
    if (!menu) return;
    if (!told) { told = true; console.log('[badge] menu found, adding badge'); }

    if (!doneHead && !menu.querySelector('.nm-stage')) {
      var pill = document.createElement('div');
      pill.className = 'nm-stage';
      pill.innerHTML = '<i></i>' + LABEL;
      var head = menu.querySelector('.nm-head');
      if (head) head.insertBefore(pill, head.firstChild);
      else menu.insertBefore(pill, menu.firstChild);
      doneHead = true;
    }
    if (!doneFoot && !menu.querySelector('.nm-stage-foot')) {
      var line = document.createElement('div');
      line.className = 'nm-stage-foot';
      line.textContent = FOOT;
      var foot = menu.querySelector('.nm-foot');
      if (foot) foot.insertBefore(line, foot.firstChild);
      else menu.appendChild(line);
      doneFoot = true;
    }
    if (doneHead && doneFoot) {
      if (obs) obs.disconnect();
      console.log('[badge] STAGE 1 badge added');
    }
  }

  function begin() {
    addBadge();
    if (doneHead && doneFoot) return;
    obs = new MutationObserver(addBadge);
    obs.observe(document.body, { childList: true, subtree: true });
    console.log('[badge] waiting for the menu...');
  }

  if (document.body) begin();
  else document.addEventListener('DOMContentLoaded', begin);
})();