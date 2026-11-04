// games/war/maps/map5.js
// STAGE 5: Orbital Station. Boss fight.
// A big open arena with cover blocks. The boss mech stands in the north,
// supported by turrets and air units (drones and bombers).
// stages.js builds the boss from points.boss and ends the stage when it dies.

export default {
  id: 5,
  name: 'Orbital Station',
  theme: 'orbital',
  size: 120,

  objective: 'Destroy the boss mech',
  briefing: [
    'This is it, commander. The command mech is on the station deck.',
    'Air support is incoming. Watch the sky and the bombers.',
    'Keep Doc alive, use cover, and focus the boss with the whole squad.'
  ],

  playerStart: { x: 0, z: 50 },
  squad: [[-3, 52], [3, 52], [-6, 54], [6, 54]],

  points: {
    boss: { x: 0, z: -38, hp: 600 },
    rally: { x: 0, z: 30 }
  },

  walls: [
    // Front cover line: low barriers near the start
    { x: -24, z: 36, w: 10, d: 1.5, h: 2, style: 'barrier' },
    { x:   0, z: 38, w: 8,  d: 1.5, h: 2, style: 'barrier' },
    { x:  24, z: 36, w: 10, d: 1.5, h: 2, style: 'barrier' },

    // Mid-field pillars (block the boss's line of sight)
    { x: -30, z: 14, w: 6, d: 6, h: 6, style: 'pillar' },
    { x: -10, z: 18, w: 6, d: 6, h: 6, style: 'pillar' },
    { x:  10, z: 18, w: 6, d: 6, h: 6, style: 'pillar' },
    { x:  30, z: 14, w: 6, d: 6, h: 6, style: 'pillar' },
    { x: -20, z: 0,  w: 6, d: 6, h: 6, style: 'pillar' },
    { x:  20, z: 0,  w: 6, d: 6, h: 6, style: 'pillar' },

    // Containers for squad cover
    { x: -42, z: 26, w: 8, d: 4, h: 3.2, style: 'container' },
    { x:  42, z: 26, w: 8, d: 4, h: 3.2, style: 'container' },
    { x: -36, z: -2, w: 4, d: 8, h: 3.2, style: 'container' },
    { x:  36, z: -2, w: 4, d: 8, h: 3.2, style: 'container' },
    { x:   0, z: 6,  w: 10, d: 3, h: 3,  style: 'container' },

    // Boss platform walls (the boss stands in the middle with open sides)
    { x: -18, z: -26, w: 14, d: 1.5, h: 4, style: 'wall' },
    { x:  18, z: -26, w: 14, d: 1.5, h: 4, style: 'wall' },
    { x: -26, z: -40, w: 1.5, d: 18, h: 4, style: 'wall' },
    { x:  26, z: -40, w: 1.5, d: 18, h: 4, style: 'wall' },
    { x: -14, z: -54, w: 12, d: 1.5, h: 4, style: 'wall' },
    { x:  14, z: -54, w: 12, d: 1.5, h: 4, style: 'wall' },

    // Low cover for dodging the boss
    { x: -12, z: -14, w: 4, d: 4, h: 2.4, style: 'barrier' },
    { x:  12, z: -14, w: 4, d: 4, h: 2.4, style: 'barrier' },
    { x: -44, z: -30, w: 8, d: 3, h: 3,   style: 'container' },
    { x:  44, z: -30, w: 8, d: 3, h: 3,   style: 'container' }
  ],

  props: [
    { x: -50, z: 44,  i: 0, size: 3.6 },
    { x:  50, z: 44,  i: 1, size: 3.8 },
    { x: -52, z: 10,  i: 1, size: 4.2 },
    { x:  52, z: 10,  i: 0, size: 4.2 },
    { x:   0, z: -4,  i: 0, size: 3.4 },
    { x: -50, z: -46, i: 1, size: 4.4 },
    { x:  50, z: -46, i: 0, size: 4.4 }
  ],

  craters: [
    { x: -14, z: 30,  size: 8 },
    { x:  16, z: 10,  size: 9 },
    { x: -24, z: -16, size: 8 },
    { x:  26, z: -18, size: 8 }
  ],

  strips: [
    { x: 0, z: 0,   w: 3,  d: 110, color: 0xff2d4a },
    { x: 0, z: -38, w: 22, d: 22,  color: 0xff2d4a },
    { x: 0, z: 28,  w: 70, d: 1.2, color: 0x00f0ff }
  ],

  /* ---------- Enemies ---------- */
  groundSpawns: [
    [-20, -34], [20, -34], [0, -46],
    [-36, -12], [36, -12], [-6, -20], [6, -20],
    [-40, 8],   [40, 8]
  ],
  airSpawns: [[-50, -50], [-25, -56], [0, -58], [25, -56], [50, -50]],
  turrets: [
    [-22, -30], [22, -30],
    [-38, -8],  [38, -8],
    [-16, -50], [16, -50]
  ],
  mechs: [[0, -38]],

  pickups: [
    { type: 'health', x: -30, z: 44 },
    { type: 'health', x:  30, z: 44 },
    { type: 'ammo',   x:   0, z: 44 },
    { type: 'ammo',   x: -18, z: 24 },
    { type: 'health', x:  18, z: 24 },
    { type: 'health', x: -28, z: 4 },
    { type: 'ammo',   x:  28, z: 4 },
    { type: 'ammo',   x: -34, z: -16 },
    { type: 'health', x:  34, z: -16 },
    { type: 'health', x:   0, z: -12 }
  ]
};