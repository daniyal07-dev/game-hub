// games/campaign/weapons.js  (v4: soldiers use the SWAT's built-in pistol)
// The two-handed rifle attempt was dropped (arms clipped through the gun).
// This file now does nothing visible. It keeps the same exported names so other files can
// import them safely. The enemy step will add a hand-held pistol for the Space Gang here.

export function equipUnit(unit, kind = 'pistol') {
  return false;            // soldiers keep the pistol that is part of their model
}

export function aimUnit(unit, seconds = 1, target = null) {
  /* not used: the model's own shoot animation is the aim pose */
}

export function weaponsInfo() {
  return { mode: 'built-in pistol' };
}

console.log('[weapons] soldiers use the built-in SWAT pistol');