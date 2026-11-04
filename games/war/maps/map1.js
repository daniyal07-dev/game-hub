// games/war/maps/map1.js
// STAGE 1: City Outskirts. Clear the area. Teaches the controls.
// Layout: you start at the south (bottom) inside a sandbag camp, enemies come from the north (top).
// All positions are [x, z] on a 120 x 120 map. The centre is (0, 0).
// v2: spawn camp (def.camp) with cover, tent, crates and barrels.

export default {
  id: 1,
  name: 'City Outskirts',
  theme: 'neon',
  size: 120,

  // Shown on the stage card and in the objective box
  objective: 'Clear the area',
  briefing: [
    'Commander, welcome to the outskirts. Enemy units are holding the city.',
    'Use Z to make the squad follow you, X to hold, C to attack your target.',
    'Take cover behind the sandbags. Clear all hostiles to finish the stage.'
  ],

  playerStart: { x: 0, z: 48 },
  squad: [[-3, 50], [3, 50], [-6, 52], [6, 52]],

  /* ---------- Cover and walls ---------- */
  // style: 'wall' | 'container' | 'barrier' | 'pillar' | 'ruin'
  walls: [
    // Near the start: low barriers for early cover
    { x: -14, z: 32, w: 8,  d: 1.2, h: 1.5, style: 'barrier' },
    { x:  14, z: 32, w: 8,  d: 1.2, h: 1.5, style: 'barrier' },
    { x:   0, z: 28, w: 5,  d: 5,   h: 3,   style: 'container' },

    // Middle: containers and pillars
    { x: -28, z: 14, w: 10, d: 4,   h: 3.2, style: 'container' },
    { x:  28, z: 14, w: 10, d: 4,   h: 3.2, style: 'container' },
    { x:  -8, z: 8,  w: 4,  d: 4,   h: 4,   style: 'pillar' },
    { x:   8, z: 8,  w: 4,  d: 4,   h: 4,   style: 'pillar' },
    { x:   0, z: 0,  w: 14, d: 1.5, h: 3,   style: 'wall' },

    // Far side: long walls make lanes, enemies defend here
    { x: -20, z: -18, w: 12, d: 1.5, h: 4, style: 'wall' },
    { x:  20, z: -18, w: 12, d: 1.5, h: 4, style: 'wall' },
    { x: -38, z: -5,  w: 1.5, d: 14, h: 4, style: 'wall' },
    { x:  38, z: -5,  w: 1.5, d: 14, h: 4, style: 'wall' },
    { x:   0, z: -30, w: 6,  d: 6,   h: 5, style: 'ruin' },
    { x: -30, z: -38, w: 8,  d: 3,   h: 3, style: 'container' },
    { x:  30, z: -38, w: 8,  d: 3,   h: 3, style: 'container' }
  ],

  /* ---------- SPAWN CAMP ---------- */
  // piece: 'sandbags' | 'tent' | 'crates' | 'barrels'
  // size: longest side in metres.   yaw: turn in radians (Math.PI / 2 = quarter turn)
  // Collision is automatic. Sandbags are low (you can shoot over them), the rest blocks bullets.
  //
  // Layout (north is up, you are in the middle):
  //      [sandbag][sandbag]  [crate]  [sandbag][sandbag]     <- front line, gap in the middle
  //   [sb]                                               [sb]
  //   (gap)         YOU + SQUAD                         (gap)   <- side exits
  //   [barrel]  [tent]                       [crate][barrel]
  camp: [
    // Front line (north of you), with a gap in the middle that a crate half-covers
    { piece: 'sandbags', x: -11,  z: 42,   size: 5.5, yaw: 0 },
    { piece: 'sandbags', x: -5.5, z: 42,   size: 5.5, yaw: 0 },
    { piece: 'sandbags', x:  5.5, z: 42,   size: 5.5, yaw: 0 },
    { piece: 'sandbags', x:  11,  z: 42,   size: 5.5, yaw: 0 },
    { piece: 'crates',   x:  0,   z: 39.5, size: 2.6 },

    // Side walls (turned a quarter circle), with exits behind them
    { piece: 'sandbags', x: -15,  z: 46,   size: 5,   yaw: Math.PI / 2 },
    { piece: 'sandbags', x:  15,  z: 46,   size: 5,   yaw: Math.PI / 2 },

    // Back of the camp
    { piece: 'tent',     x: -11,  z: 55.5, size: 6 },
    { piece: 'crates',   x:  11,  z: 55.5, size: 3 },
    { piece: 'barrels',  x: -15,  z: 52,   size: 2 },
    { piece: 'barrels',  x:  15,  z: 52,   size: 2 }
  ],

  // 3D model props (solid: they block bullets and movement)
  props: [
    { x: -45, z: 30,  i: 0, size: 3.5 },
    { x:  45, z: 30,  i: 1, size: 4 },
    { x: -44, z: -20, i: 1, size: 4 },
    { x:  44, z: -20, i: 0, size: 3.5 },
    { x: -18, z: 20,  i: 0, size: 3 },
    { x:  18, z: 20,  i: 1, size: 3.5 }
  ],

  // Decoration only (you can walk over them)
  craters: [
    { x: -12, z: -8,  size: 7 },
    { x:  24, z: -4,  size: 8 },
    { x: -30, z: 22,  size: 7 },
    { x:  10, z: -42, size: 8 }
  ],

  /* ---------- Enemies ---------- */
  groundSpawns: [[-30, -45], [0, -48], [30, -45], [-45, -30], [45, -30], [-10, -40], [10, -40]],
  airSpawns:    [[-40, -50], [0, -55], [40, -50]],
  turrets:      [[-32, -28]],
  mechs:        [],

  /* ---------- Pickups ---------- */
  pickups: [
    // inside the camp
    { type: 'health', x: -6, z: 45 },
    { type: 'ammo',   x:  6, z: 45 },
    // out on the map
    { type: 'health', x: -24, z: 38 },
    { type: 'health', x:  24, z: 38 },
    { type: 'ammo',   x:   0, z: 34 },
    { type: 'ammo',   x: -33, z: 4 },
    { type: 'health', x:  33, z: 4 },
    { type: 'ammo',   x:  -8, z: -10 },
    { type: 'health', x:   8, z: -10 }
  ],

  points: {
    rally: { x: 0, z: 20 }
  }
};