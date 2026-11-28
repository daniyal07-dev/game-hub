// games/campaign/phone-ui.js  v1
// Phone-only extras for the Campaign. On a PC this file does nothing.
// - a small settings button next to pause (pauses, then opens Settings)
// - a SCOPE button, only if touch.js did not make one
// - while driving the truck: JUMP becomes BRAKE, a BOOST button appears,
//   SWAP / RELOAD / SCOPE / FIRE are hidden
// - the "AI Assistant" button hides while the start card is open (it covered the text)
// - the Settings panel fits the phone: scrolls, bigger tap targets, no Controls button
// Test on a PC: add ?phone=1 to the address (campaign.html?phone=1).

const FORCE = /[?&]phone=1/.test(location.search);
const PHONE = FORCE || matchMedia('(hover: none) and (pointer: coarse)').matches;

if (PHONE) boot();

function boot() {
  const css = document.createElement('style');
  css.textContent = `
    .ph-btn{position:fixed;z-index:45;border-radius:50%;border:2px solid rgba(70,200,255,.85);
      background:rgba(10,24,40,.62);color:#fff;font:700 12px system-ui,sans-serif;letter-spacing:.04em;
      touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;
      align-items:center;justify-content:center;padding:0}
    #ph-settings{top:8px;right:54px;width:36px;height:36px;font-size:18px}
    #ph-boost{left:24vw;bottom:9vh;width:56px;height:56px}
    #ph-scope{right:19vw;bottom:44vh;width:46px;height:46px;font-size:10px}
    [data-phone-fit]{max-height:90vh!important;max-height:90dvh!important;overflow-y:auto!important;
      -webkit-overflow-scrolling:touch;overscroll-behavior:contain;
      width:min(94vw,560px)!important;box-sizing:border-box}
    [data-phone-fit] button,[data-phone-fit] select{min-height:44px;font-size:15px}
    [data-phone-fit] input[type=range]{height:36px;width:100%}
    [data-phone-fit] input[type=checkbox]{width:26px;height:26px}
  `;
  document.head.appendChild(css);

  const mk = (id, html) => {
    const b = document.createElement('button');
    b.id = id; b.type = 'button'; b.className = 'ph-btn'; b.innerHTML = html;
    b.style.display = 'none';
    document.body.appendChild(b);
    return b;
  };
  const btnSet = mk('ph-settings', '⚙');
  const boost = mk('ph-boost', 'BOOST');
  const scopeBtn = mk('ph-scope', 'SCOPE');

  const T = () => window.campaignTouch || {};
  const flag = (v) => (typeof v === 'function' ? !!v() : !!v);

  // ---- buttons ----
  btnSet.addEventListener('click', () => {
    try { if (T().pause) T().pause(); } catch (e) { /* ignore */ }
    setTimeout(() => { if (window.openSettings) window.openSettings(); }, 150);
  });

  const press = (on) => (e) => {
    e.preventDefault();
    const s = T().sprint;
    if (s) s(on);
  };
  boost.addEventListener('pointerdown', press(true));
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => boost.addEventListener(n, press(false)));

  scopeBtn.addEventListener('click', () => {
    if (window.campaignScope && window.campaignScope.toggle) window.campaignScope.toggle();
  });

  // ---- find touch.js buttons by their text (cached) ----
  const cache = {};
  function findLeaf(re) {
    for (const e of document.querySelectorAll('button,div,span')) {
      if (e.children.length) continue;
      if (e.closest('#start-screen') || e.closest('.ph-btn') || e.closest('[data-phone-fit]')) continue;
      if (re.test((e.textContent || '').trim())) return e;
    }
    return null;
  }
  function get(key, re) {
    let e = cache[key];
    if (!e || !e.isConnected) { e = findLeaf(re); cache[key] = e; }
    return e;
  }
  const boxOf = (leaf) => (leaf ? (leaf.closest('button') || leaf) : null);

  // ---- assistant button (covers the start card text) ----
  let nova = null;
  function findNova() {
    if (nova && nova.isConnected) return nova;
    const re = /^N\s*AI Assistant$/;
    for (const e of document.querySelectorAll('button,div')) {
      if (!re.test((e.textContent || '').trim().replace(/\s+/g, ' '))) continue;
      let top = e;
      while (top.parentElement && re.test((top.parentElement.textContent || '').trim().replace(/\s+/g, ' '))) top = top.parentElement;
      nova = top;
      break;
    }
    return nova;
  }

  // ---- settings panel fit ----
  function fitSettings() {
    for (const c of document.body.children) {
      if (c.dataset && c.dataset.phoneFit) continue;
      if (c.classList.contains('ph-btn')) continue;
      const cs = getComputedStyle(c);
      if (cs.position !== 'fixed' || cs.zIndex !== '9999' || cs.display === 'none') continue;
      if (!/settings/i.test(c.textContent || '')) continue;
      let panel = c;
      const r = c.getBoundingClientRect();
      if (r.width >= innerWidth * 0.98 && r.height >= innerHeight * 0.98) {
        // this is the backdrop: use the panel inside it
        panel = [...c.children].find((k) => /settings/i.test(k.textContent || '') && k.getBoundingClientRect().width > 200) || null;
      }
      if (!panel || panel.getBoundingClientRect().width < 50) continue;
      panel.dataset.phoneFit = '1';
      for (const b of panel.querySelectorAll('button')) {
        const t = (b.textContent || '').trim();
        if (t.length < 30 && /controls/i.test(t)) b.style.display = 'none';
      }
    }
  }

  // ---- main loop (4 times a second) ----
  setInterval(() => {
    try {
      const t = T();
      const playing = flag(t.isPlaying) && !flag(t.isDead);
      const truck = window.campaignTruck;
      const driving = !!(truck && truck.isDriving && truck.isDriving());
      const card = document.getElementById('start-screen');
      const cardOpen = !!card && getComputedStyle(card).display !== 'none';

      btnSet.style.display = playing && typeof window.openSettings === 'function' ? 'flex' : 'none';
      boost.style.display = playing && driving ? 'flex' : 'none';

      const realScope = get('scope', /^SCOPE$/);
      const canScope = !!(window.campaignScope && window.campaignScope.toggle);
      scopeBtn.style.display = playing && !driving && !realScope && canScope ? 'flex' : 'none';

      const jump = get('jump', /^(JUMP|BRAKE)$/);
      if (jump) jump.textContent = driving ? 'BRAKE' : 'JUMP';

      const hideList = [get('swap', /^SWAP$/), get('reload', /^RELOAD$/), realScope, get('fire', /^FIRE$/)];
      for (const leaf of hideList) {
        const b = boxOf(leaf);
        if (b) b.style.visibility = driving ? 'hidden' : '';
      }

      const n = findNova();
      if (n) n.style.visibility = cardOpen ? 'hidden' : '';

      fitSettings();
    } catch (e) { /* never break the game */ }
  }, 250);

  console.log('[phone-ui] v1 ready: settings button, boost button, scope fallback, truck BRAKE, settings panel fit');
}