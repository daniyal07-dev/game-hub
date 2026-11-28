// ============================================================
//  NOVA STRIKE 3D — Campaign: games/campaign/extras.js  (v13)
//  The hub for the extra features. main.js talks to THIS file only.
//  It loads these optional files from the same folder:
//     sound.js   music.js   minimap.js   guide.js   base-npcs.js
//     drones.js  robots.js  missions.js  waves.js   hit-fx.js
//     weather.js gun-light.js  enemy-glow.js  scope.js
//     aim-assist.js  vehicles.js  settings.js  intro.js
//  A file that is missing (or crashes) is switched off by itself,
//  the game keeps running. A red "404" line in the Console for a
//  file not written yet is normal.
//
//  Each feature file may export any of these (all optional):
//     init(ctx)            once, when the game starts
//     update(dt, ctx)      every frame
//     onKey(code, ctx)     a key was pressed (return true if you used it)
//     onEvent(name, data, ctx)   something happened (shot, hurt, kill, ...)
//     reset(ctx)           mission restarted
//
//  ctx (given by main.js):
//     scene, camera, player,
//     getSoldiers(), getEnemies(),
//     isReady()    -> characters finished loading
//     isPlaying()  -> pointer locked and not paused
//
//  v2: added music.js to the list.
//  v3: added drones.js and robots.js to the list.
//  v4: added missions.js to the list.
//  v5: added waves.js to the list.
//  v6: added intro.js to the list (must stay last).
//  v7: added hit-fx.js (flash and sparks on enemy hits), before intro.
//  v8: added weather.js (Clear / Cloudy / Storm) and gun-light.js
//      (keeps your weapon readable), before intro.
//  v9: added enemy-glow.js (red outline + soft halo on enemies),
//      before intro.
//  v10: added scope.js (smart scope: auto / manual), before intro.
//  v11: added aim-assist.js (soft slowdown + pull toward enemies),
//      after scope, before intro.
//  v12: added vehicles.js (army truck you can drive), after
//      aim-assist, before intro.
//  v13: added settings.js (Settings screen: aim assist, recoil,
//      weather, truck view), after vehicles, before intro.
// ============================================================




const MODULES = ['sound', 'music', 'minimap', 'guide', 'base-npcs', 'drones', 'robots', 'missions', 'waves', 'hit-fx', 'weather', 'gun-light', 'enemy-glow', 'scope', 'aim-assist', 'vehicles', 'settings', 'intro'];




const mods = [];          // { name, api, broken, missing }
let ctx = null;
let ready = false;




function call(m, fn, ...args) {
  if (m.broken || !m.api || typeof m.api[fn] !== 'function') return undefined;
  try {
    return m.api[fn](...args, ctx);
  } catch (err) {
    m.broken = true;
    console.warn('[extras] ' + m.name + '.' + fn + ' crashed, switched off:', err);
    return undefined;
  }
}




// Call once from main.js (after the scene, camera and player exist)
export async function initExtras(context) {
  ctx = context;
  const loaded = await Promise.all(MODULES.map(async name => {
    const m = { name, api: null, broken: false, missing: false };
    try {
      m.api = await import('./' + name + '.js');
    } catch (err) {
      m.missing = true;
      console.info('[extras] ' + name + '.js not loaded (not written yet, or it has an error):', err.message);
    }
    return m;
  }));
  mods.length = 0;
  loaded.forEach(m => mods.push(m));
  mods.forEach(m => { if (m.api) call(m, 'init'); });
  ready = true;
  const on = mods.filter(m => m.api).map(m => m.name);
  console.log('[extras] active: ' + (on.length ? on.join(', ') : 'none yet'));
}




// Every frame, after the camera is placed
export function updateExtras(dt) {
  if (!ready) return;
  for (const m of mods) call(m, 'update', dt);
}




// A key was pressed. Returns true if an extra used it.
export function handleExtrasKey(code) {
  if (!ready) return false;
  let used = false;
  for (const m of mods) if (call(m, 'onKey', code) === true) used = true;
  return used;
}




// Tell the extras something happened: extrasEvent('shot', {kind:'rifle'})
export function extrasEvent(name, data) {
  if (!ready) return;
  for (const m of mods) call(m, 'onEvent', name, data);
}




// Mission restarted
export function resetExtras() {
  if (!ready) return;
  for (const m of mods) call(m, 'reset');
}




// For the P key
export function extrasInfo() {
  return 'extras: ' + (mods.filter(m => m.api && !m.broken).map(m => m.name).join(', ') || 'none') +
         (mods.some(m => m.broken) ? ' · OFF: ' + mods.filter(m => m.broken).map(m => m.name).join(', ') : '');
}