// ============================================================
//  NOVA STRIKE 3D — Campaign: games/campaign/settings.js  (v5)
//  A separate SETTINGS screen, opened from the start / pause card.
//  It only talks to doors that already exist, so nothing else changes:
//    master volume -> nova_settings.master (same value as the menu),
//                     sound.js listens to the 'nova-volume' event
//    music volume  -> nova_settings.music  (same value as the menu),
//                     music.js listens to the 'nova-volume' event
//    music on/off  -> window.campaignMusic (same switch as the K key)
//    aim assist  -> window.campaignAim      (saved as campaign_aim)
//    recoil      -> window.tuneRecoil       (saved as campaign_recoil)
//    truck view  -> window.vehicles({view}) (saved as campaign_truckview)
//    weather, scope (fire zoom, keys) and the CONTROLS button -> the real
//      rows / button made by weather.js / scope.js / keybinds.js are MOVED
//      from the start card into this panel, so they work exactly as before.
//  Esc closes the panel. Console: openSettings()
//  Loaded by extras.js. Does not touch any other file.
//
//  v2: Weather and Scope rows moved off the start card into Settings.
//  v3: the Controls button (key rebinding) moved into Settings too, and
//      the hint line on the start card now points to Settings.
//  v4: MASTER VOLUME slider (saved in nova_settings, shared with the menu).
//  v5: MUSIC VOLUME slider and MUSIC ON/OFF switch.
// ============================================================


const DEFAULTS = { music: 'on', aim: 'medium', recoil: '0.1', weather: 'cloudy', view: 'fpp' };
const SETTINGS_KEY = 'nova_settings';
const MASTER_DEFAULT = 0.8;
const MUSIC_DEFAULT = 0.7;
const RECOIL_OPTS = [['NONE', '0'], ['LEAST', '0.1'], ['LOW', '0.35'], ['NORMAL', '1']];


let panel = null, btn = null, open = false, tries = 0, adoptTries = 0;
let hintFixed = false, warned = false;
const adopted = { wx: false, scope: false, controls: false };
const cur = {};


const ls = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };


/* ---------- volume (saved in nova_settings, shared with the menu) ---------- */
function readSetting(key, def) {
  try {
    const o = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const n = parseFloat(o[key]);
    return isNaN(n) ? def : Math.max(0, Math.min(1, n));
  } catch (e) { return def; }
}


function writeSetting(key, val) {
  try {
    const o = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    o[key] = val;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(o));
  } catch (e) { /* ignore */ }
  try {
    const d = {}; d[key] = val;
    window.dispatchEvent(new CustomEvent('nova-volume', { detail: d }));
  } catch (e) { /* ignore */ }
}


const SLIDERS = [
  {
    id: 'master', title: 'MASTER VOLUME',
    note: 'Gunfire, hits, wind and sea. The same volume as the main menu.',
    def: MASTER_DEFAULT
  },
  {
    id: 'music', title: 'MUSIC VOLUME',
    note: 'The battle music. The same volume as the main menu. It plays quietly on this screen.',
    def: MUSIC_DEFAULT
  }
];


/* ---------- the settings made here ---------- */
const ROWS = [
  {
    id: 'music', title: 'MUSIC',
    note: 'Turn the battle music on or off. You can also press K in the game.',
    opts: [['ON', 'on'], ['OFF', 'off']],
    available: () => !!(window.campaignMusic && window.campaignMusic.set),
    read: () => (window.campaignMusic.isOn() ? 'on' : 'off'),
    write: (v) => window.campaignMusic.set(v === 'on')
  },
  {
    id: 'aim', title: 'AIM ASSIST',
    note: 'Slows your aim near enemies and helps it settle on them. It never locks on.',
    opts: [['OFF', 'off'], ['LOW', 'low'], ['MEDIUM', 'medium'], ['HIGH', 'high']],
    available: () => !!(window.campaignAim && window.campaignAim.set),
    read: () => (window.campaignAim && window.campaignAim.get && window.campaignAim.get()) || ls('campaign_aim') || DEFAULTS.aim,
    write: (v) => window.campaignAim.set(v)
  },
  {
    id: 'recoil', title: 'GUN RECOIL',
    note: 'How much the gun kicks when you fire. LEAST is the default.',
    opts: RECOIL_OPTS,
    available: () => typeof window.tuneRecoil === 'function',
    read: () => {
      const n = parseFloat(ls('campaign_recoil'));
      const v = isNaN(n) ? parseFloat(DEFAULTS.recoil) : n;
      let best = null, bd = 9;
      for (const o of RECOIL_OPTS) { const d = Math.abs(parseFloat(o[1]) - v); if (d < bd) { bd = d; best = o[1]; } }
      return best;
    },
    write: (v) => window.tuneRecoil(parseFloat(v))
  },
  {
    // only shown if the real weather row could not be moved into this panel
    id: 'weather', title: 'WEATHER',
    note: 'Cloudy is the default. Storm adds heavy rain and lightning.',
    opts: [['CLEAR', 'clear'], ['CLOUDY', 'cloudy'], ['STORM', 'storm']],
    available: () => !adopted.wx,
    read: () => ls('campaign_weather') || DEFAULTS.weather,
    write: (v) => setWeatherTo(v)
  },
  {
    id: 'view', title: 'TRUCK VIEW',
    note: 'The view you get when you start driving. Press V while driving to switch.',
    opts: [['DRIVER SEAT', 'fpp'], ['BEHIND THE TRUCK', 'tpp']],
    available: () => typeof window.vehicles === 'function',
    read: () => (ls('campaign_truckview') === 'tpp' ? 'tpp' : 'fpp'),
    write: (v) => window.vehicles({ view: v })
  }
];


function setWeatherTo(v) {
  const box = document.getElementById('wx-box');
  let clicked = false;
  if (box) {
    for (const b of box.querySelectorAll('button')) {
      if ((b.textContent || '').toLowerCase().includes(v)) { b.click(); clicked = true; break; }
    }
  }
  if (!clicked && typeof window.setWeather === 'function') window.setWeather(v);
}


/* ---------- screen parts ---------- */
function css() {
  const s = document.createElement('style');
  s.textContent = `
  #set-btn{cursor:pointer}
  #set-panel{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(2,8,18,.78);font-family:system-ui,Segoe UI,Arial,sans-serif;color:#d6ecff}
  #set-panel.on{display:flex}
  #set-card{width:min(560px,92vw);max-height:88vh;overflow:auto;padding:22px 26px;border-radius:16px;background:rgba(10,24,48,.97);border:1px solid rgba(120,190,255,.55);box-shadow:0 0 40px rgba(60,140,255,.25)}
  #set-card h2{margin:0 0 4px;font:800 22px system-ui,Segoe UI,Arial,sans-serif;letter-spacing:4px;text-align:center;color:#fff}
  #set-card .sub{text-align:center;font-size:12px;opacity:.65;margin-bottom:14px;letter-spacing:1px}
  .set-row{padding:11px 0;border-top:1px solid rgba(120,190,255,.18)}
  .set-row .t{font:700 12px system-ui,Segoe UI,Arial,sans-serif;letter-spacing:3px;color:#7fd0ff;margin-bottom:3px}
  .set-row .n{font-size:12px;opacity:.65;margin-bottom:8px}
  .set-moved{text-align:center}
  .set-moved .t{text-align:left}
  .set-moved .n{text-align:left}
  .set-opts{display:flex;flex-wrap:wrap;gap:8px}
  .set-opts button{font:700 12px system-ui,Segoe UI,Arial,sans-serif;letter-spacing:1.5px;padding:8px 16px;border-radius:999px;border:1px solid rgba(120,190,255,.5);background:rgba(20,44,84,.7);color:#cfe7ff;cursor:pointer}
  .set-opts button:hover{background:rgba(40,90,170,.8)}
  .set-opts button.on{background:linear-gradient(180deg,#2d8cff,#1466d8);border-color:#8fd0ff;color:#fff;box-shadow:0 0 10px rgba(80,160,255,.6)}
  .set-slide{display:flex;align-items:center;gap:12px}
  .set-slide input[type=range]{flex:1;height:6px;accent-color:#2d8cff;cursor:pointer}
  .set-slide .v{min-width:44px;text-align:right;font:800 13px system-ui,Segoe UI,Arial,sans-serif;color:#fff;letter-spacing:1px}
  .set-foot{display:flex;gap:10px;justify-content:center;margin-top:16px}
  .set-foot button{font:800 13px system-ui,Segoe UI,Arial,sans-serif;letter-spacing:2px;padding:10px 24px;border-radius:999px;border:1px solid rgba(120,190,255,.6);background:rgba(20,44,84,.8);color:#e8f4ff;cursor:pointer}
  .set-foot button.go{background:linear-gradient(180deg,#2d8cff,#1466d8);border-color:#8fd0ff}
  @media (max-width:700px){#set-card{padding:14px 16px}#set-card h2{font-size:18px}.set-opts button{padding:7px 12px;font-size:11px}}
  `;
  document.head.appendChild(s);
}


function buildPanel() {
  panel = document.createElement('div');
  panel.id = 'set-panel';
  panel.innerHTML = '<div id="set-card"><h2>SETTINGS</h2><div class="sub">Saved on this device</div>' +
    '<div id="set-rows"></div><div id="set-adopt"></div>' +
    '<div class="set-foot"><button id="set-reset">RESET</button><button id="set-done" class="go">DONE</button></div></div>';
  document.body.appendChild(panel);
  const stop = (e) => e.stopPropagation();
  panel.addEventListener('mousedown', stop);
  panel.addEventListener('click', stop);
  panel.addEventListener('touchstart', stop, { passive: true });
  panel.querySelector('#set-done').addEventListener('click', close);
  panel.querySelector('#set-reset').addEventListener('click', () => {
    for (const r of ROWS) {
      if (!r.available()) continue;
      try { r.write(DEFAULTS[r.id]); } catch (e) { /* ignore */ }
      cur[r.id] = DEFAULTS[r.id];
    }
    for (const s of SLIDERS) writeSetting(s.id, s.def);
    if (adopted.wx) setWeatherTo(DEFAULTS.weather);     // the moved weather row
    fill();                                             // redraw so the sliders jump back too
  });
  panel.addEventListener('click', (e) => { if (e.target === panel) close(); });
}


// find the real Controls button on the start card (by id, else by its text)
function findControlsButton() {
  for (const id of ['controls-btn', 'keys-btn', 'keybinds-btn', 'kb-btn', 'binds-btn']) {
    const el = document.getElementById(id);
    if (el && !(panel && panel.contains(el))) return el;
  }
  for (const b of document.querySelectorAll('button')) {
    if (panel && panel.contains(b)) continue;
    const t = (b.textContent || '').trim().toLowerCase();
    if (t.length < 30 && t.includes('controls')) return b;
  }
  return null;
}


// change "Want different keys? Click Controls below." so it points to Settings
function fixHint() {
  if (hintFixed) return;
  const hits = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (panel && panel.contains(el)) continue;
    if ((el.textContent || '').includes('Want different keys')) hits.push(el);
  }
  if (!hits.length) return;
  // the deepest element that holds the sentence
  let target = hits[hits.length - 1];
  for (const el of hits) {
    if (!Array.from(el.children).some((c) => hits.includes(c))) { target = el; break; }
  }
  target.textContent = 'Want different keys? Open \u2699 Settings \u2192 Controls.';
  hintFixed = true;
}


// move the real Weather row, Scope row and Controls button into this panel
function adoptBoxes() {
  if (!panel) return;
  const host = panel.querySelector('#set-adopt');
  const moved = [];
  for (const [key, id, name] of [['wx', 'wx-box', 'weather'], ['scope', 'scope-box', 'scope']]) {
    if (adopted[key]) continue;
    const el = document.getElementById(id);
    if (!el) continue;
    const row = document.createElement('div');
    row.className = 'set-row set-moved';
    row.appendChild(el);
    host.appendChild(row);
    adopted[key] = true;
    moved.push(name);
  }
  if (!adopted.controls) {
    const cb = findControlsButton();
    if (cb) {
      const row = document.createElement('div');
      row.className = 'set-row set-moved';
      row.innerHTML = '<div class="t">CONTROLS</div><div class="n">Change the keys for moving, shooting, squad orders and more.</div>';
      row.appendChild(cb);
      // the key screen must not hide behind this panel, so close the panel on click
      row.addEventListener('click', (e) => { if (e.target === cb || cb.contains(e.target)) setTimeout(close, 0); });
      host.appendChild(row);
      adopted.controls = true;
      moved.push('controls');
    }
  }
  if (adopted.controls) fixHint();
  if (moved.length) console.log('[settings] moved from the start card into Settings: ' + moved.join(', '));
}


function fill() {
  const host = panel.querySelector('#set-rows');
  host.innerHTML = '';


  // volume sliders first
  for (const s of SLIDERS) {
    const val = Math.round(readSetting(s.id, s.def) * 100);
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = '<div class="t">' + s.title + '</div><div class="n">' + s.note + '</div>' +
      '<div class="set-slide"><input type="range" min="0" max="100" step="1" value="' + val + '"><span class="v">' + val + '%</span></div>';
    const input = row.querySelector('input');
    const label = row.querySelector('.v');
    input.addEventListener('input', () => {
      const n = parseInt(input.value, 10) || 0;
      label.textContent = n + '%';
      writeSetting(s.id, n / 100);
    });
    host.appendChild(row);
  }


  for (const r of ROWS) {
    if (!r.available()) continue;
    cur[r.id] = String(r.read());
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = '<div class="t">' + r.title + '</div><div class="n">' + r.note + '</div><div class="set-opts"></div>';
    const box = row.querySelector('.set-opts');
    for (const [label, val] of r.opts) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.row = r.id;
      b.dataset.val = val;
      b.addEventListener('click', () => {
        try { r.write(val); } catch (e) { console.warn('[settings] could not set ' + r.id, e); }
        cur[r.id] = val;
        refresh();
      });
      box.appendChild(b);
    }
    host.appendChild(row);
  }
  refresh();
}


function refresh() {
  for (const b of panel.querySelectorAll('.set-opts button')) {
    b.classList.toggle('on', cur[b.dataset.row] === b.dataset.val);
  }
}


export function openSettings() {
  if (!panel) return;
  adoptBoxes();
  fill();
  panel.classList.add('on');
  open = true;
}
function close() {
  if (!panel) return;
  panel.classList.remove('on');
  open = false;
}


/* ---------- the button on the start / pause card ---------- */
function addButton() {
  if (btn) return true;
  const q = document.getElementById('quality-btn');
  if (!q || !q.parentNode) return false;
  btn = document.createElement('button');
  btn.id = 'set-btn';
  btn.className = q.className;
  btn.type = 'button';
  btn.textContent = '\u2699 Settings';
  btn.addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
  q.parentNode.insertBefore(btn, q.nextSibling);
  return true;
}


// Esc closes the panel first (capture phase, before the game sees it)
window.addEventListener('keydown', (e) => {
  if (open && e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
}, true);


/* ---------- extras.js interface ---------- */
export function init() {
  css();
  buildPanel();
  addButton();
  adoptBoxes();
  window.openSettings = openSettings;
  console.log('[settings] v5 ready: master + music volume, music on/off, aim assist, recoil, truck view here; weather, scope and controls moved in');
}


export function update() {
  if (!btn && tries < 600) { tries++; if (addButton() && tries > 1) console.log('[settings] button added'); }
  if ((!adopted.wx || !adopted.scope || !adopted.controls || !hintFixed) && adoptTries < 1200) {
    adoptTries++;
    if (adoptTries < 120 || adoptTries % 10 === 0) adoptBoxes();
    if (adoptTries >= 1200 && !adopted.controls && !warned) {
      warned = true;
      console.warn('[settings] could not find the Controls button to move');
    }
  }
}