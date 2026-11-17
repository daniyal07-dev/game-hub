// games/war/core/touch_edit.js
// Touch-button editor for War Mode (phones only).
// Loaded by touch.js. Drag buttons to move them, sliders change size and transparency.
// SAVE keeps the layout on this phone (localStorage). RESET = default positions. CANCEL = discard.

let isOpen = false;
let styleAdded = false;

function addStyle() {
  if (styleAdded) return;
  styleAdded = true;
  const s = document.createElement('style');
  s.textContent = `
    #te-backdrop { position:fixed; inset:0; z-index:99980; background:rgba(8,12,20,0.88); }
    #te-panel { position:fixed; left:12px; top:50%; transform:translateY(-50%); z-index:99995; width:210px;
      box-sizing:border-box; padding:10px 12px; border-radius:12px; color:#fff;
      background:rgba(20,26,40,0.96); border:2px solid rgba(255,255,255,0.35);
      font-family:system-ui,Segoe UI,Arial,sans-serif; touch-action:manipulation;
      -webkit-user-select:none; user-select:none; }
    #te-panel .te-title { font-weight:800; font-size:13px; letter-spacing:1px; text-align:center; margin-bottom:2px; }
    #te-panel .te-hint { font-size:11px; opacity:0.8; text-align:center; margin-bottom:8px; line-height:1.3; }
    #te-panel label { display:block; font-size:11px; font-weight:700; margin-top:6px; }
    #te-panel input[type=range] { width:100%; margin:4px 0 0; }
    #te-panel .te-row { display:flex; gap:6px; margin-top:10px; }
    #te-panel button { flex:1; padding:8px 0; border-radius:8px; border:none; font-weight:800;
      font-size:12px; color:#fff; letter-spacing:1px; }
    #te-save { background:#1f9d55; }
    #te-reset { background:#c27a1a; }
    #te-cancel { background:#6b7280; }
    #touch-ui.editing .t-btn { outline:2px dashed #ffd24a; outline-offset:3px; }
    #touch-ui.editing .t-btn.te-sel { outline-color:#fff; background:rgba(255,255,255,0.3); }
  `;
  document.head.appendChild(s);
}

export function openEditor(api) {
  if (isOpen) return;
  isOpen = true;
  addStyle();

  const $ = (id) => document.getElementById(id);
  const dragged = new Set();            // buttons moved in this editing session
  const layout = api.getLayout();

  /* ---------- Backdrop + panel ---------- */
  const backdrop = document.createElement('div');
  backdrop.id = 'te-backdrop';

  const panel = document.createElement('div');
  panel.id = 'te-panel';
  panel.innerHTML = `
    <div class="te-title" id="te-title">EDIT BUTTONS</div>
    <div class="te-hint">Drag any button to move it</div>
    <label>SIZE</label>
    <input id="te-size" type="range" min="0.5" max="1.8" step="0.05">
    <label>TRANSPARENCY (left = faint)</label>
    <input id="te-op" type="range" min="0.2" max="1" step="0.05">
    <div class="te-row">
      <button id="te-save" type="button">SAVE</button>
      <button id="te-reset" type="button">RESET</button>
    </div>
    <div class="te-row" style="margin-top:6px">
      <button id="te-cancel" type="button">CANCEL</button>
    </div>
  `;

  // Keep touches/clicks on the panel away from the game
  ['touchstart', 'touchend', 'touchmove', 'click', 'mousedown', 'pointerdown'].forEach(ev => {
    panel.addEventListener(ev, e => e.stopPropagation());
    backdrop.addEventListener(ev, e => e.stopPropagation());
  });

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  const sizeEl = panel.querySelector('#te-size');
  const opEl = panel.querySelector('#te-op');
  function syncSliders() {
    const l = api.getLayout();
    sizeEl.value = l.scale;
    opEl.value = l.opacity;
  }
  syncSliders();

  // Show the buttons right away, then switch the editor mode on
  api.ui.style.display = 'block';
  api.setEditing(true);

  /* ---------- Sliders (keep unsaved moves while changing) ---------- */
  function keepMoves(change) {
    const snap = {};
    dragged.forEach(id => {
      const el = $(id);
      if (el) snap[id] = [el.offsetLeft, el.offsetTop];
    });
    change();
    Object.keys(snap).forEach(id => api.moveTo(id, snap[id][0], snap[id][1]));
  }
  sizeEl.addEventListener('input', () => keepMoves(() => api.setScale(parseFloat(sizeEl.value))));
  opEl.addEventListener('input', () => keepMoves(() => api.setOpacity(parseFloat(opEl.value))));

  /* ---------- Dragging the buttons ---------- */
  const handlers = [];
  api.ids.forEach(id => {
    const el = $(id);
    if (!el) return;
    let tid = null, sx = 0, sy = 0, startLeft = 0, startTop = 0;

    const onStart = (e) => {
      e.preventDefault();
      if (tid !== null) return;
      const t = e.changedTouches[0];
      tid = t.identifier;
      sx = t.clientX; sy = t.clientY;
      startLeft = el.offsetLeft; startTop = el.offsetTop;
      el.classList.add('te-sel');
    };
    const onMove = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === tid) {
          api.moveTo(id, startLeft + (t.clientX - sx), startTop + (t.clientY - sy));
          dragged.add(id);
        }
      }
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === tid) { tid = null; el.classList.remove('te-sel'); }
      }
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    handlers.push([el, onStart, onMove, onEnd]);
  });

  /* ---------- Close ---------- */
  function close() {
    handlers.forEach(([el, s, m, n]) => {
      el.removeEventListener('touchstart', s);
      el.removeEventListener('touchmove', m);
      el.removeEventListener('touchend', n);
      el.removeEventListener('touchcancel', n);
      el.classList.remove('te-sel');
    });
    api.setEditing(false);
    backdrop.remove();
    panel.remove();
    isOpen = false;
  }

  panel.querySelector('#te-save').addEventListener('click', () => {
    api.save();
    panel.querySelector('#te-title').textContent = 'SAVED ✔';
    setTimeout(close, 450);
  });

  panel.querySelector('#te-reset').addEventListener('click', () => {
    api.reset();
    dragged.clear();
    syncSliders();
  });

  panel.querySelector('#te-cancel').addEventListener('click', () => {
    api.cancel();
    close();
  });
}