// games/war/maps/map2.js
// STAGE 2: Desert Ruins. Defend the beacon against waves.
// The player starts at the defend point in the centre. Enemies attack from
// three sides. Wave logic (sending enemies in groups) lives in stages.js.

export default {
  id: 2,
  name: 'Desert Ruins',
  theme: 'desert',
  size: 120,

  objective: 'Hold the beacon',
  briefing: [
    'The relay beacon is under attack. Hold your position, commander.',
    'Enemies will come in waves from three directions.',
    'Keep the squad close. If the beacon falls, the mission fails.'
  ],

  playerStart: { x: 0, z: 10 },
  squad: [[-4, 12], [4, 12], [-7, 14], [7, 14]],

  /* ---------- The beacon (built by stages.js using these coordinates) ---------- */
  points: {
    defend: { x: 0, z: 0, radius: 8 },          // circle shown on the ground + radar
    waveGates: [
      { x: 0,   z: -52 },
      { x: -50, z: 20 },
      { x: 50,  z: 20 }
    ]
  },

  /* ---------- Ruins: broken walls around the centre ---------- */
  walls: [
    // Inner ring: cover around the defend point
    { x: -14, z: -8,  w: 9,  d: 1.5, h: 2.2, style: 'ruin' },
    { x:  14, z: -8,  w: 9,  d: 1.5, h: 2.6, style: 'ruin' },
    { x: -13, z: 16,  w: 8,  d: 1.5, h: 2.4, style: 'ruin' },
    { x:  13, z: 16,  w: 8,  d: 1.5, h: 2.0, style: 'ruin' },
    { x: -22, z: 4,   w: 1.5, d: 10, h: 2.8, style: 'ruin' },
    { x:  22, z: 4,   w: 1.5, d: 10, h: 2.2, style: 'ruin' },

    // Broken outer ruins (gaps let enemies through - that's on purpose)
    { x: -38, z: -24, w: 14, d: 1.5, h: 3.5, style: 'ruin' },
    { x:  38, z: -24, w: 14, d: 1.5, h: 3.0, style: 'ruin' },
    { x: -30, z: -40, w: 1.5, d: 12, h: 2.5, style: 'ruin' },
    { x:  30, z: -40, w: 1.5, d: 12, h: 3.5, style: 'ruin' },
    { x: -44, z: 32,  w: 12, d: 1.5, h: 3.0, style: 'ruin' },
    { x:  44, z: 32,  w: 12, d: 1.5, h: 2.4, style: 'ruin' },

    // A few stone blocks as hard cover
    { x: 0,   z: -20, w: 5,  d: 5,  h: 3.5, style: 'pillar' },
    { x: -20, z: 28,  w: 4,  d: 4,  h: 3.0, style: 'pillar' },
    { x:  20, z: 28,  w: 4,  d: 4,  h: 3.0, style: 'pillar' }
  ],

  props: [
    { x: -12, z: 0,   i: 0, size: 3.2 },
    { x:  12, z: 0,   i: 1, size: 3.6 },
    { x:  0,  z: 26,  i: 0, size: 3.4 },
    { x: -34, z: 6,   i: 1, size: 4.2 },
    { x:  34, z: 6,   i: 0, size: 4.2 },
    { x: -10, z: -32, i: 0, size: 3.8 },
    { x:  10, z: -32, i: 1, size: 3.8 }
  ],

  craters: [
    { x: -8,  z: 12,  size: 7 },
    { x:  18, z: -14, size: 9 },
    { x: -26, z: -20, size: 8 },
    { x:  28, z: 14,  size: 7 },
    { x:  0,  z: 34,  size: 8 }
  ],

  strips: [
    { x: 0, z: 0,  w: 3,   d: 100, color: 0xffd84a },
    { x: 0, z: 0,  w: 100, d: 3,   color: 0xffd84a }
  ],

  /* ---------- Enemies ---------- */
  // Waves are built from these spawn spots. waveGates above are where they enter.
  groundSpawns: [
    [0, -52], [-12, -50], [12, -50],
    [-50, 20], [-48, 32], [-46, 8],
    [50, 20], [48, 32], [46, 8]
  ],
  airSpawns:    [[-40, -50], [0, -55], [40, -50], [55, 0]],
  turrets:      [[0, -34], [-40, 26], [40, 26]],
  mechs:        [[0, -52]],

  pickups: [
    { type: 'ammo',   x: -10, z: 8 },
    { type: 'ammo',   x:  10, z: 8 },
    { type: 'health', x:   0, z: -12 },
    { type: 'health', x: -24, z: 20 },
    { type: 'health', x:  24, z: 20 },
    { type: 'ammo',   x: -36, z: -6 },
    { type: 'ammo',   x:  36, z: -6 }
  ]
};