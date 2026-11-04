// games/war/maps/map4.js
// STAGE 4: Toxic Foundry. Tight corridors and heavy cover.
// The player fights north through three lanes joined by gaps.
// Close-range fights: shotguns and grenades work best here.
// The exit zone in the far north ends the stage once the area is clear.

export default {
  id: 4,
  name: 'Toxic Foundry',
  theme: 'toxic',
  size: 120,

  objective: 'Fight through the foundry',
  briefing: [
    'The foundry is a maze of corridors. Expect close fights.',
    'Shotguns and grenades shine in tight spaces. Watch the corners.',
    'Heavy units are inside. Let Hawk cover you from the back.'
  ],

  playerStart: { x: 0, z: 50 },
  squad: [[-3, 52], [3, 52], [-6, 54], [6, 54]],

  points: {
    exit: { x: 0, z: -50, radius: 7 },
    rally: { x: 0, z: 34 }
  },

  walls: [
    /* ----- Row 1: first barrier with three gaps (z = 36) ----- */
    { x: -38, z: 36, w: 20, d: 2, h: 4, style: 'wall' },
    { x: -10, z: 36, w: 12, d: 2, h: 4, style: 'wall' },
    { x:  10, z: 36, w: 12, d: 2, h: 4, style: 'wall' },
    { x:  38, z: 36, w: 20, d: 2, h: 4, style: 'wall' },

    /* ----- Row 2: containers form a staggered line (z = 22) ----- */
    { x: -40, z: 22, w: 8, d: 4, h: 3.2, style: 'container' },
    { x: -22, z: 22, w: 8, d: 4, h: 3.2, style: 'container' },
    { x:  -2, z: 22, w: 8, d: 4, h: 3.2, style: 'container' },
    { x:  20, z: 22, w: 8, d: 4, h: 3.2, style: 'container' },
    { x:  40, z: 22, w: 8, d: 4, h: 3.2, style: 'container' },

    /* ----- Row 3: the corridor walls (z = 6 to -10) ----- */
    { x: -30, z: 4,   w: 2, d: 18, h: 4.5, style: 'wall' },
    { x: -10, z: 4,   w: 2, d: 18, h: 4.5, style: 'wall' },
    { x:  10, z: 4,   w: 2, d: 18, h: 4.5, style: 'wall' },
    { x:  30, z: 4,   w: 2, d: 18, h: 4.5, style: 'wall' },
    { x: -48, z: 4,   w: 2, d: 18, h: 4.5, style: 'wall' },
    { x:  48, z: 4,   w: 2, d: 18, h: 4.5, style: 'wall' },

    /* ----- Row 4: heavy cover in the middle (z = -14) ----- */
    { x: -34, z: -14, w: 6, d: 6, h: 4,   style: 'pillar' },
    { x: -16, z: -14, w: 6, d: 6, h: 4,   style: 'pillar' },
    { x:   0, z: -14, w: 10, d: 2, h: 2.4, style: 'barrier' },
    { x:  16, z: -14, w: 6, d: 6, h: 4,   style: 'pillar' },
    { x:  34, z: -14, w: 6, d: 6, h: 4,   style: 'pillar' },

    /* ----- Row 5: second barrier with two gaps (z = -28) ----- */
    { x: -40, z: -28, w: 22, d: 2, h: 4.5, style: 'wall' },
    { x: -14, z: -28, w: 14, d: 2, h: 4.5, style: 'wall' },
    { x:  14, z: -28, w: 14, d: 2, h: 4.5, style: 'wall' },
    { x:  40, z: -28, w: 22, d: 2, h: 4.5, style: 'wall' },

    /* ----- Row 6: final corridor leading to the exit (z = -40) ----- */
    { x: -14, z: -42, w: 2, d: 14, h: 4.5, style: 'wall' },
    { x:  14, z: -42, w: 2, d: 14, h: 4.5, style: 'wall' },
    { x: -30, z: -42, w: 8, d: 3, h: 3.2, style: 'container' },
    { x:  30, z: -42, w: 8, d: 3, h: 3.2, style: 'container' },
    { x:   0, z: -36, w: 6, d: 2, h: 2.2, style: 'barrier' }
  ],

  props: [
    { x: -52, z: 40,  i: 0, size: 3.5 },
    { x:  52, z: 40,  i: 1, size: 3.8 },
    { x: -20, z: 12,  i: 1, size: 3.2 },
    { x:  20, z: 12,  i: 0, size: 3.2 },
    { x:   0, z: -6,  i: 0, size: 3.4 },
    { x: -52, z: -20, i: 1, size: 4 },
    { x:  52, z: -20, i: 0, size: 4 },
    { x: -22, z: -50, i: 0, size: 3.6 },
    { x:  22, z: -50, i: 1, size: 3.6 }
  ],

  craters: [
    { x: -20, z: 44,  size: 7 },
    { x:  26, z: 30,  size: 7 },
    { x:   0, z: -20, size: 8 },
    { x: -26, z: -34, size: 7 }
  ],

  strips: [
    { x: 0, z: 0,   w: 3,   d: 110, color: 0x3dff9a },
    { x: 0, z: -50, w: 14,  d: 14,  color: 0xffd84a }
  ],

  /* ---------- Enemies ---------- */
  groundSpawns: [
    [-40, 14], [40, 14], [-20, 14], [20, 14],
    [-20, -6], [20, -6], [0, 0],
    [-38, -20], [38, -20], [0, -22],
    [-20, -36], [20, -36], [0, -46], [-8, -48], [8, -48]
  ],
  airSpawns: [[-45, -45], [0, -55], [45, -45]],
  turrets: [
    [-38, 16], [38, 16],
    [-20, -22], [20, -22],
    [-22, -48], [22, -48]
  ],
  mechs: [[0, -44]],

  pickups: [
    { type: 'health', x: -30, z: 44 },
    { type: 'health', x:  30, z: 44 },
    { type: 'ammo',   x:   0, z: 42 },
    { type: 'ammo',   x: -20, z: 28 },
    { type: 'health', x:  20, z: 28 },
    { type: 'ammo',   x:   0, z: 8 },
    { type: 'health', x: -20, z: -4 },
    { type: 'ammo',   x:  20, z: -4 },
    { type: 'health', x: -24, z: -22 },
    { type: 'health', x:  24, z: -22 },
    { type: 'ammo',   x:   0, z: -32 }
  ]
};