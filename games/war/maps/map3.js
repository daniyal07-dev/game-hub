// games/war/maps/map3.js
// STAGE 3: Frozen Base. Destroy 3 generators.
// The player starts in the south. Generators sit in the west, east and north,
// each guarded by turrets and soldiers. stages.js builds the generators from
// points.generators and ends the stage when all three are destroyed.

export default {
  id: 3,
  name: 'Frozen Base',
  theme: 'frozen',
  size: 120,

  objective: 'Destroy 3 generators',
  briefing: [
    'Three power generators feed the enemy base. Destroy them all.',
    'Each one is guarded by turrets. Use grenades on the generators.',
    'Split their attention: send the squad in with C while you flank.'
  ],

  playerStart: { x: 0, z: 50 },
  squad: [[-3, 52], [3, 52], [-6, 54], [6, 54]],

  points: {
    generators: [
      { x: -42, z: -8,  hp: 60 },
      { x:  42, z: -8,  hp: 60 },
      { x:   0, z: -44, hp: 80 }
    ],
    rally: { x: 0, z: 30 }
  },

  walls: [
    // Entrance gate near the start: two walls with a gap
    { x: -12, z: 36, w: 20, d: 2, h: 4, style: 'wall' },
    { x:  12, z: 36, w: 20, d: 2, h: 4, style: 'wall' },

    // Central ice blocks
    { x: -10, z: 18, w: 6, d: 6, h: 4, style: 'pillar' },
    { x:  10, z: 18, w: 6, d: 6, h: 4, style: 'pillar' },
    { x:   0, z: 8,  w: 10, d: 2, h: 3, style: 'barrier' },

    // West generator compound
    { x: -42, z: 6,   w: 20, d: 1.5, h: 3.5, style: 'wall' },
    { x: -54, z: -8,  w: 1.5, d: 22, h: 3.5, style: 'wall' },
    { x: -30, z: -2,  w: 1.5, d: 10, h: 3.5, style: 'wall' },
    { x: -42, z: -20, w: 14, d: 1.5, h: 3.5, style: 'wall' },

    // East generator compound (mirrors the west)
    { x:  42, z: 6,   w: 20, d: 1.5, h: 3.5, style: 'wall' },
    { x:  54, z: -8,  w: 1.5, d: 22, h: 3.5, style: 'wall' },
    { x:  30, z: -2,  w: 1.5, d: 10, h: 3.5, style: 'wall' },
    { x:  42, z: -20, w: 14, d: 1.5, h: 3.5, style: 'wall' },

    // North generator compound
    { x: -14, z: -36, w: 1.5, d: 14, h: 4, style: 'wall' },
    { x:  14, z: -36, w: 1.5, d: 14, h: 4, style: 'wall' },
    { x:  -7, z: -52, w: 12, d: 1.5, h: 4, style: 'wall' },
    { x:   7, z: -52, w: 12, d: 1.5, h: 4, style: 'wall' },

    // Cover between compounds
    { x: -20, z: -20, w: 5, d: 5, h: 3, style: 'container' },
    { x:  20, z: -20, w: 5, d: 5, h: 3, style: 'container' },
    { x:   0, z: -22, w: 8, d: 2, h: 2, style: 'barrier' },
    { x: -22, z: 40,  w: 6, d: 3, h: 3, style: 'container' },
    { x:  22, z: 40,  w: 6, d: 3, h: 3, style: 'container' }
  ],

  props: [
    { x: -48, z: 30, i: 0, size: 3.5 },
    { x:  48, z: 30, i: 1, size: 4 },
    { x: -26, z: 24, i: 1, size: 3.2 },
    { x:  26, z: 24, i: 0, size: 3.2 },
    { x:   0, z: -12, i: 0, size: 3.6 },
    { x: -30, z: -40, i: 1, size: 4 },
    { x:  30, z: -40, i: 0, size: 4 }
  ],

  craters: [
    { x: -16, z: 28,  size: 7 },
    { x:  16, z: -6,  size: 8 },
    { x: -22, z: -32, size: 7 },
    { x:  36, z: 22,  size: 8 }
  ],

  strips: [
    { x: 0,   z: 0,   w: 2,  d: 100, color: 0x8ae8ff },
    { x: -42, z: -8,  w: 16, d: 16,  color: 0x00f0ff },
    { x:  42, z: -8,  w: 16, d: 16,  color: 0x00f0ff },
    { x: 0,   z: -44, w: 16, d: 16,  color: 0xff2d95 }
  ],

  /* ---------- Enemies ---------- */
  groundSpawns: [
    [-42, -2], [-38, -12], [-46, -14],
    [42, -2],  [38, -12],  [46, -14],
    [-6, -42], [6, -42],   [0, -38],
    [-18, -26], [18, -26]
  ],
  airSpawns: [[-50, -40], [0, -56], [50, -40]],
  turrets: [
    [-48, -8], [-36, -14],
    [48, -8],  [36, -14],
    [-8, -46], [8, -46]
  ],
  mechs: [],

  pickups: [
    { type: 'health', x: -26, z: 44 },
    { type: 'health', x:  26, z: 44 },
    { type: 'ammo',   x:   0, z: 40 },
    { type: 'ammo',   x: -14, z: 6 },
    { type: 'health', x:  14, z: 6 },
    { type: 'ammo',   x: -26, z: -14 },
    { type: 'ammo',   x:  26, z: -14 },
    { type: 'health', x:   0, z: -28 }
  ]
};