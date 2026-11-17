// games/arena_touch_edit.js
// Touch-button editor for Arena Mode (phones only).
// Adds an "EDIT BUTTONS" option to the Settings screen.
// Drag FIRE / SCOPE / RELOAD / PAUSE to move them; sliders change size and transparency.
// SAVE keeps the layout on this phone (localStorage). RESET = default. CANCEL = discard.
// PC never runs this (it only starts on touch screens). arena.js is not changed.

const KEY = 'arenaTouchLayout';
const IDS = ['t-fire', 't-scope', 't-reload', 't-pause'];
const IS_PHONE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

if (IS_PHONE) init();

function init() {
  const $ = (id) => document.getElementById(id);
  const ui = $('touch-ui');
  const settings = $('settings-screen');
  if (!ui || !settings) return;

  let editing = false;
  let layout = load();

  /* ---------- Saved layout ---------- */
  function empty() { return { scale: 1, opacity: 1, pos: {} }; }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      const l = JSON.parse(raw);
      return {
        scale: Math.min(1.8, Math.max(0.5, Number(l.scale) || 1)),
        opacity: Math.min(1, Math.max(0.2, Number(l.opacity) || 1)),
        pos: (l.pos && typeof l.pos === 'object') ? l.pos : {}
      };
    } catch (e) { return empty(); }
  }

  function placeEl(el, left, top) {
    const W = window.innerWidth, H = window.innerHeight;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w > 0 && h > 0) {                       // clamp only when visible
      left = Math.max(0, Math.min(W - w, left));
      top = Math.max(0, Math.min(H - h, top));
    }
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  function clearEl(el) {
    ['left', 'top', 'right', 'bottom', 'scale', 'opacity'].forEach(p => { el.style[p] = ''; });
  }

  function applyLook() {
    IDS.forEach(id => {
      const el = $(id);
      if (!el) return;
      el.style.scale = layout.scale !== 1 ? String(layout.scale) : '';
      el.style.opacity = layout.opacity < 1 ? String(layout.opacity) : '';
    });
  }

  function applyPos() {
    const W = window.innerWidth, H = window.innerHeight;
    IDS.forEach(id => {
      const el = $(id);
      const p = layout.pos[id];
      if (el && p && typeof p.x === 'number' && typeof p.y === 'number') placeEl(el, p.x * W, p.y * H);
    });
  }

  function applyLayout() { applyLook(); applyPos(); }

  applyLayout();
  window.addEventListener('resize', () => { if (!editing) applyLayout(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { if (!editing) applyLayout(); }, 300));

  // Re-apply when the touch controls become visible (sizes are known then),
  // and keep them visible while the editor is open.
  new MutationObserver(() => {
    if (editing) { ui.classList.remove('hidden'); return; }
    if (!ui.classList.contains('hidden')) applyPos();
  }).observe(ui, { attributes: true, attributeFilter: ['class'] });

  /* ---------- Styles ---------- */
  const st = document.createElement('style');
  st.textContent = `
    #ate-backdrop { position:fixed; inset:0; z-index:99980; background:rgba(8,12,20,0.88); }
    #ate-panel { position:fixed; left:12px; top:50%; transform:translateY(-50%); z-index:99995; width:210px;
      box-sizing:border-box; padding:10px 12px; border-radius:12px; color:#fff;
      background:rgba(20,26,40,0.96); border:2px solid rgba(255,255,255,0.35);
      font-family:system-ui,Segoe UI,Arial,sans-serif; touch-action:manipulation;
      -webkit-user-select:none; user-select:none; }
    #ate-panel .ate-title { font-weight:800; font-size:13px; letter-spacing:1px; text-align:center; margin-bottom:2px; }
    #ate-panel .ate-hint { font-size:11px; opacity:0.8; text-align:center; margin-bottom:8px; line-height:1.3; }
    #ate-panel label { display:block; font-size:11px; font-weight:700; margin-top:6px; }
    #ate-panel input[type=range] { width:100%; margin:4px 0 0; }
    #ate-panel .ate-row { display:flex; gap:6px; margin-top:10px; }
    #ate-panel button { flex:1; padding:8px 0; border-radius:8px; border:none; font-weight:800;
      font-size:12px; color:#fff; letter-spacing:1px; }
    #ate-save { background:#1f9d55; }
    #ate-reset { background:#c27a1a; }
    #ate-cancel { background:#6b7280; }
    #touch-ui.ate-editing { z-index:99990 !important; }
    #touch-ui.ate-editing .t-btn { outline:2px dashed #ffd24a; outline-offset:3px; }
    #touch-ui.ate-editing .t-btn.ate-sel { outline-color:#fff; }
  `;
  document.head.appendChild(st);

  /* ---------- Block the game's own touch handling while editing + drag logic ---------- */
  const drags = new Map();   // touch id -> { el, sx, sy, left, top }

  function onTouch(e) {
    if (!editing) return;
    e.stopPropagation();
    e.preventDefault();

    if (e.type === 'touchstart') {
      for (const t of e.changedTouches) {
        const el = e.target && e.target.closest ? e.target.closest('.t-btn') : null;
        if (!el || !IDS.includes(el.id)) continue;
        drags.set(t.identifier, { el, sx: t.clientX, sy: t.clientY, left: el.offsetLeft, top: el.offsetTop });
        el.classList.add('ate-sel');
      }
    } else if (e.type === 'touchmove') {
      for (const t of e.changedTouches) {
        const d = drags.get(t.identifier);
        if (d) placeEl(d.el, d.left + (t.clientX - d.sx), d.top + (t.clientY - d.sy));
      }
    } else {   // touchend / touchcancel
      for (const t of e.changedTouches) {
        const d = drags.get(t.identifier);
        if (d) { d.el.classList.remove('ate-sel'); drags.delete(t.identifier); }
      }
    }
  }
  function onOther(e) { if (editing) e.stopPropagation(); }

  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(ev =>
    ui.addEventListener(ev, onTouch, { capture: true, passive: false }));
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click'].forEach(ev =>
    ui.addEventListener(ev, onOther, true));

  /* ---------- The editor screen ---------- */
  function openEditor() {
    if (editing) return;
    if (window.innerHeight > window.innerWidth) {
      alert('Rotate your phone to landscape to edit the buttons.');
      return;
    }
    editing = true;
    drags.clear();

    const wasHidden = ui.classList.contains('hidden');
    settings.style.display = 'none';
    ui.classList.remove('hidden');
    ui.classList.add('ate-editing');
    applyLayout();

    const backdrop = document.createElement('div');
    backdrop.id = 'ate-backdrop';
    const panel = document.createElement('div');
    panel.id = 'ate-panel';
    panel.innerHTML = `
      <div class="ate-title" id="ate-title">EDIT BUTTONS</div>
      <div class="ate-hint">Drag any button to move it</div>
      <label>SIZE</label>
      <input id="ate-size" type="range" min="0.5" max="1.8" step="0.05">
      <label>TRANSPARENCY (left = faint)</label>
      <input id="ate-op" type="range" min="0.2" max="1" step="0.05">
      <div class="ate-row">
        <button id="ate-save" type="button">SAVE</button>
        <button id="ate-reset" type="button">RESET</button>
      </div>
      <div class="ate-row" style="margin-top:6px">
        <button id="ate-cancel" type="button">CANCEL</button>
      </div>
    `;
    ['touchstart', 'touchend', 'touchmove', 'click', 'mousedown', 'pointerdown'].forEach(ev => {
      panel.addEventListener(ev, e => e.stopPropagation());
      backdrop.addEventListener(ev, e => e.stopPropagation());
    });
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    const sizeEl = panel.querySelector('#ate-size');
    const opEl = panel.querySelector('#ate-op');
    function sync() { sizeEl.value = layout.scale; opEl.value = layout.opacity; }
    sync();

    sizeEl.addEventListener('input', () => { layout.scale = parseFloat(sizeEl.value); applyLook(); });
    opEl.addEventListener('input', () => { layout.opacity = parseFloat(opEl.value); applyLook(); });

    function close() {
      editing = false;
      drags.clear();
      IDS.forEach(id => { const el = $(id); if (el) el.classList.remove('ate-sel'); });
      ui.classList.remove('ate-editing');
      if (wasHidden) ui.classList.add('hidden');
      settings.style.display = '';
      backdrop.remove();
      panel.remove();
    }

    panel.querySelector('#ate-save').addEventListener('click', () => {
      const W = window.innerWidth, H = window.innerHeight;
      IDS.forEach(id => {
        const el = $(id);
        if (el && el.style.left && el.style.top) {
          layout.pos[id] = { x: parseFloat(el.style.left) / W, y: parseFloat(el.style.top) / H };
        }
      });
      try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch (e) { /* ignore */ }
      panel.querySelector('#ate-title').textContent = 'SAVED ✔';
      setTimeout(close, 450);
    });

    panel.querySelector('#ate-reset').addEventListener('click', () => {
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      layout = empty();
      IDS.forEach(id => { const el = $(id); if (el) clearEl(el); });
      sync();
    });

    panel.querySelector('#ate-cancel').addEventListener('click', () => {
      IDS.forEach(id => { const el = $(id); if (el) clearEl(el); });
      layout = load();
      editing = false;            // so applyLayout can clamp normally
      applyLayout();
      editing = true;
      close();
    });
  }

  /* ---------- EDIT BUTTONS option in Settings ---------- */
  const panelBox = settings.querySelector('.panel') || settings;
  if (!panelBox.querySelector('.edit-buttons-btn')) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ghost edit-buttons-btn';
    b.textContent = '🎮 EDIT BUTTONS';
    b.style.margin = '6px 0 12px';
    b.addEventListener('click', openEditor);
    const row = panelBox.querySelector('.btn-row');
    if (row) panelBox.insertBefore(b, row); else panelBox.appendChild(b);
  }
}