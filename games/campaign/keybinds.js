// games/campaign/keybinds.js
// Key customisation for Campaign. Saved in localStorage ('campaign_keys').
// main.js asks this file which key does what, so changing a key here changes the game.
// Adds a "Controls" button on the start screen. Does not touch War mode.
// Reserved keys: Esc (pause) and N (NOVA assistant).



const STORE = 'campaign_keys';



export const ACTIONS = [
  { id: 'forward',  label: 'Move forward',        def: 'KeyW',      group: 'Movement' },
  { id: 'back',     label: 'Move backward',       def: 'KeyS',      group: 'Movement' },
  { id: 'left',     label: 'Move left',           def: 'KeyA',      group: 'Movement' },
  { id: 'right',    label: 'Move right',          def: 'KeyD',      group: 'Movement' },
  { id: 'sprint',   label: 'Sprint',              def: 'ShiftLeft', group: 'Movement' },
  { id: 'jump',     label: 'Jump / fly up',       def: 'Space',     group: 'Movement' },
  { id: 'fly',      label: 'Fly mode (explore)',  def: 'KeyF',      group: 'Movement' },
  { id: 'descend',  label: 'Fly down',            def: 'KeyC',      group: 'Movement' },



  { id: 'spawn',    label: 'Spawn 4 soldiers (test)', def: 'KeyG',   group: 'Squad' },
  { id: 'clear',    label: 'Remove all soldiers',     def: 'KeyT',   group: 'Squad' },
  { id: 'follow',   label: 'Squad: Follow me',        def: 'Digit1', group: 'Squad' },
  { id: 'hold',     label: 'Squad: Hold position',    def: 'Digit2', group: 'Squad' },
  { id: 'attack',   label: 'Squad: Go to town (test)', def: 'Digit3', group: 'Squad' },



  { id: 'interact', label: 'Use / Train soldiers',    def: 'KeyE',   group: 'Actions' },
  { id: 'map',      label: 'Open / close map',        def: 'KeyM',   group: 'Actions' },



  { id: 'debug',    label: 'Show collision outlines', def: 'KeyB',   group: 'Debug' },
  { id: 'testsquad',label: 'Animation test squad',    def: 'KeyH',   group: 'Debug' },
  { id: 'info',     label: 'Print squad info',        def: 'KeyP',   group: 'Debug' }
];



const RESERVED = new Set(['Escape', 'KeyN']);   // Esc always pauses, N always opens NOVA
const RESERVED_NOTE = {
  KeyN: 'N is reserved for the NOVA assistant. Choose another key.',
  Escape: ''
};
const map = {};
const listeners = [];



function norm(code) { return code === 'ShiftRight' ? 'ShiftLeft' : code; }



function changed() {
  listeners.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
}



function load() {
  ACTIONS.forEach(a => { map[a.id] = a.def; });
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    ACTIONS.forEach(a => {
      const v = saved[a.id];
      if (typeof v === 'string' && v && !RESERVED.has(v)) map[a.id] = v;
    });
  } catch (e) { /* ignore a broken save */ }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(map)); } catch (e) { /* ignore */ }
}
load();



/* ---------- API used by main.js and the start screen ---------- */
export function key(id) { return map[id]; }



// run fn every time a key is changed or reset (used to refresh the start-screen key list)
export function onChange(fn) { listeners.push(fn); }



// does this pressed key (e.code) belong to the action?
export function matches(id, code) {
  const c = map[id];
  if (!c) return false;
  return norm(c) === norm(code);
}



// is the action's key held down right now? (keys = the {code: true} object in main.js)
export function isDown(keys, id) {
  const c = map[id];
  if (!c) return false;
  if (c === 'ShiftLeft') return !!(keys.ShiftLeft || keys.ShiftRight);
  return !!keys[c];
}



export function label(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const names = {
    Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
    AltLeft: 'Alt', AltRight: 'Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`'
  };
  return names[code] || code;
}



export function resetKeys() {
  ACTIONS.forEach(a => { map[a.id] = a.def; });
  save();
  changed();
}



/* ---------- Settings panel ---------- */
let panel = null, listening = null, noteEl = null;



function setNote(text) {
  if (noteEl) noteEl.textContent = text || '';
}



function rebind(id, code) {
  code = norm(code);
  const old = map[id];
  for (const a of ACTIONS) {                         // swap if another action uses this key
    if (a.id !== id && norm(map[a.id]) === code) map[a.id] = old;
  }
  map[id] = code;
  save();
  changed();
  console.log('[keys] ' + id + ' = ' + code);
}



function refresh() {
  if (!panel) return;
  panel.querySelectorAll('[data-act]').forEach(b => {
    const id = b.dataset.act;
    b.textContent = (listening && listening.id === id) ? 'press a key...' : label(map[id]);
    b.style.borderColor = (listening && listening.id === id) ? '#ffd84a' : 'rgba(255,255,255,.25)';
  });
}



function buildPanel() {
  panel = document.createElement('div');
  panel.id = 'keybinds-panel';
  panel.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(5,10,20,.88);display:none;' +
    'align-items:center;justify-content:center;font-family:inherit;color:#fff;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#101a2c;border:1px solid rgba(0,240,255,.4);border-radius:12px;' +
    'padding:18px 22px;width:min(520px,92vw);max-height:86vh;overflow:auto;';
  box.innerHTML = '<h2 style="margin:0 0 4px;font-size:20px;letter-spacing:2px">CONTROLS</h2>' +
    '<p style="margin:0 0 8px;font-size:13px;opacity:.75">Click a button, then press the key you want. ' +
    'If the key is already used, the two actions swap. Esc cancels. N is reserved for NOVA.</p>';



  noteEl = document.createElement('div');
  noteEl.style.cssText = 'min-height:18px;margin:0 0 4px;font-size:13px;font-weight:700;color:#ffd84a';
  box.appendChild(noteEl);



  let group = '';
  ACTIONS.forEach(a => {
    if (a.group !== group) {
      group = a.group;
      const h = document.createElement('div');
      h.textContent = group.toUpperCase();
      h.style.cssText = 'margin:12px 0 4px;font-size:12px;letter-spacing:2px;color:#00f0ff';
      box.appendChild(h);
    }
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:14px';
    const name = document.createElement('span');
    name.textContent = a.label;
    const b = document.createElement('button');
    b.dataset.act = a.id;
    b.style.cssText = 'min-width:120px;padding:6px 10px;background:#1b2a44;color:#fff;border:1px solid rgba(255,255,255,.25);' +
      'border-radius:6px;cursor:pointer;font:inherit;font-weight:700';
    b.addEventListener('click', () => { listening = { id: a.id }; setNote(''); refresh(); });
    row.append(name, b);
    box.appendChild(row);
  });



  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:10px;margin-top:16px;justify-content:flex-end';
  const reset = document.createElement('button');
  reset.textContent = 'Reset to defaults';
  const close = document.createElement('button');
  close.textContent = 'Done';
  [reset, close].forEach(b => {
    b.style.cssText = 'padding:8px 14px;background:#1b2a44;color:#fff;border:1px solid rgba(255,255,255,.3);' +
      'border-radius:6px;cursor:pointer;font:inherit;font-weight:700';
  });
  close.style.background = '#0a7ea4';
  reset.addEventListener('click', () => { resetKeys(); listening = null; setNote(''); refresh(); });
  close.addEventListener('click', () => { listening = null; setNote(''); panel.style.display = 'none'; });
  bar.append(reset, close);
  box.appendChild(bar);



  panel.appendChild(box);
  document.body.appendChild(panel);
  refresh();
}



function openPanel() {
  if (!panel) buildPanel();
  listening = null;
  setNote('');
  refresh();
  panel.style.display = 'flex';
}



// while a key is being chosen, this catches it before the game sees it
window.addEventListener('keydown', (e) => {
  if (!listening) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.code === 'Escape') { listening = null; setNote(''); refresh(); return; }
  if (RESERVED.has(e.code)) { setNote(RESERVED_NOTE[e.code] || ''); return; }
  rebind(listening.id, e.code);
  listening = null;
  setNote('');
  refresh();
}, true);



document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement && panel) { listening = null; panel.style.display = 'none'; }
});



// add the button next to "Quality"
(function addButton() {
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;   // phones: no keys
  const q = document.getElementById('quality-btn');
  const btn = document.createElement('button');
  btn.id = 'keys-btn';
  btn.textContent = '⌨ Controls';
  btn.type = 'button';
  if (q) {
    btn.className = q.className;
    q.parentNode.insertBefore(btn, q.nextSibling);
  } else {
    const s = document.getElementById('start-screen');
    if (!s) return;
    s.appendChild(btn);
  }
  btn.addEventListener('click', openPanel);
})();