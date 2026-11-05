/* =====================================================
   NOVA - the T-key AI assistant (offline, rule-based)
   Works in Arena Mode, War Mode and on the Game Hub.
   Press T to open / close (on phones: tap the NOVA badge on menus / pause screen).
   v2: Solo / Duo / Squad, phone touch controls, phone-friendly badge.
   ===================================================== */

const BOT_NAME = 'NOVA';

/* ---------- which page are we on? ---------- */
const FILE = (location.pathname.split('/').pop() || '').toLowerCase();
const MODE = FILE.startsWith('war') ? 'war' : (FILE.startsWith('arena') ? 'arena' : 'hub');

/* ---------- phone / touch screen? ---------- */
const IS_TOUCH = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
  /[?&]touch=1/.test(location.search);

// where the small "T AI Assistant" badge sits on each page (change here if it overlaps something)
const BADGE_POS = {
  arena: 'top:16px;left:16px;',
  war: 'top:50%;left:16px;',
  hub: 'bottom:20px;right:20px;'
};
const BADGE_POS_TOUCH = {
  arena: 'top:8px;left:8px;',
  war: 'top:8px;left:8px;',
  hub: 'bottom:12px;right:12px;'
};

/* =====================================================
   1. STYLES (injected by JavaScript so no CSS file is needed)
   ===================================================== */
const CSS = `
#nova-badge {
  position: fixed; z-index: 1000;
  padding: 7px 12px; font: 600 12px 'Segoe UI', Arial, sans-serif; letter-spacing: 1px;
  color: #00f0ff; background: rgba(10, 10, 26, 0.75);
  border: 1px solid rgba(0, 240, 255, 0.45); border-radius: 8px;
  cursor: pointer; backdrop-filter: blur(4px); transition: background 0.2s;
}
#nova-badge:hover { background: rgba(0, 240, 255, 0.15); }
#nova-badge b {
  display: inline-block; padding: 1px 7px; margin-right: 7px; border-radius: 4px;
  background: #00f0ff; color: #0a0a1a;
}

#nova-panel {
  position: fixed; right: 24px; bottom: 24px; z-index: 1001;
  width: min(400px, 92vw); height: min(580px, 82vh);
  display: none; flex-direction: column; overflow: hidden;
  font-family: 'Segoe UI', Arial, sans-serif; color: #fff;
  background: rgba(12, 12, 34, 0.96);
  border: 1px solid rgba(0, 240, 255, 0.55); border-radius: 16px;
  box-shadow: 0 0 40px rgba(123, 47, 247, 0.5), inset 0 0 30px rgba(0, 240, 255, 0.05);
}
#nova-panel.open { display: flex; }

#nova-header {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  background: linear-gradient(90deg, rgba(0, 184, 212, 0.25), rgba(123, 47, 247, 0.3));
  border-bottom: 1px solid rgba(0, 240, 255, 0.3);
}
#nova-avatar {
  width: 38px; height: 38px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 900;
  background: linear-gradient(135deg, #00f0ff, #7b2ff7, #ff2d95);
  box-shadow: 0 0 14px rgba(0, 240, 255, 0.6);
}
#nova-title { flex: 1; display: flex; flex-direction: column; line-height: 1.25; }
#nova-title b { font-size: 17px; letter-spacing: 3px; }
#nova-title span { font-size: 11px; color: #9fe; letter-spacing: 0.5px; }
#nova-title span i {
  display: inline-block; width: 7px; height: 7px; margin-right: 6px;
  border-radius: 50%; background: #3dff9a; box-shadow: 0 0 8px #3dff9a;
}
#nova-close {
  width: 30px; height: 30px; border: none; border-radius: 8px; cursor: pointer;
  color: #fff; font-size: 14px; background: rgba(255, 255, 255, 0.1);
}
#nova-close:hover { background: rgba(255, 45, 149, 0.5); }

#nova-msgs {
  flex: 1; overflow-y: auto; padding: 14px;
  display: flex; flex-direction: column; gap: 10px;
}
#nova-msgs::-webkit-scrollbar { width: 6px; }
#nova-msgs::-webkit-scrollbar-thumb { background: rgba(0, 240, 255, 0.4); border-radius: 3px; }

.nova-msg {
  max-width: 88%; padding: 9px 13px; border-radius: 12px;
  font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word;
  user-select: text;
}
.nova-msg.bot {
  align-self: flex-start; color: #e6fbff;
  background: rgba(0, 240, 255, 0.1); border: 1px solid rgba(0, 240, 255, 0.3);
  border-top-left-radius: 3px;
}
.nova-msg.user {
  align-self: flex-end;
  background: linear-gradient(90deg, #00b8d4, #7b2ff7);
  border-top-right-radius: 3px;
}
.nova-typing { display: flex; gap: 5px; padding: 13px 15px; }
.nova-typing i {
  width: 7px; height: 7px; border-radius: 50%; background: #00f0ff;
  animation: novaDot 1s infinite;
}
.nova-typing i:nth-child(2) { animation-delay: 0.15s; }
.nova-typing i:nth-child(3) { animation-delay: 0.3s; }
@keyframes novaDot {
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-4px); }
}

#nova-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 10px; }
#nova-chips:empty { display: none; }
#nova-chips button {
  padding: 6px 11px; font-size: 12px; font-family: inherit; cursor: pointer;
  color: #00f0ff; background: transparent;
  border: 1px solid rgba(0, 240, 255, 0.5); border-radius: 14px;
  transition: background 0.15s;
}
#nova-chips button:hover { background: rgba(0, 240, 255, 0.18); }

#nova-form {
  display: flex; gap: 8px; padding: 12px 14px;
  border-top: 1px solid rgba(0, 240, 255, 0.25);
}
#nova-input {
  flex: 1; padding: 10px 12px; font-size: 14px; font-family: inherit; color: #fff;
  background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(0, 240, 255, 0.4);
  border-radius: 10px; outline: none; user-select: text;
}
#nova-input:focus { border-color: #00f0ff; box-shadow: 0 0 10px rgba(0, 240, 255, 0.4); }
#nova-send {
  width: 44px; border: none; border-radius: 10px; cursor: pointer;
  font-size: 16px; color: #fff; background: linear-gradient(90deg, #00b8d4, #7b2ff7);
}
#nova-hint { padding: 0 14px 10px; font-size: 11px; color: #789; text-align: center; }

/* phones: smaller badge and a panel that fits a landscape screen */
@media (pointer: coarse) {
  #nova-badge { padding: 5px 9px; font-size: 11px; }
  #nova-panel { right: 8px; bottom: 8px; width: min(440px, 96vw); height: min(520px, 94vh); border-radius: 12px; }
  #nova-header { padding: 8px 12px; }
  #nova-avatar { width: 30px; height: 30px; font-size: 16px; }
  #nova-title b { font-size: 14px; }
  .nova-msg { font-size: 13px; padding: 7px 10px; }
  #nova-form { padding: 8px 10px; }
  #nova-input { font-size: 16px; padding: 8px 10px; }
  #nova-hint { display: none; }
}
`;

const styleEl = document.createElement('style');
styleEl.textContent = CSS;
document.head.appendChild(styleEl);

/* =====================================================
   2. BUILD THE PANEL
   ===================================================== */
const SUBTITLE = { arena: 'Arena Mode', war: 'War Mode', hub: 'Game Hub' }[MODE];

const badge = document.createElement('div');
badge.id = 'nova-badge';
badge.style.cssText = (IS_TOUCH ? BADGE_POS_TOUCH : BADGE_POS)[MODE];
badge.innerHTML = IS_TOUCH ? '<b>N</b>NOVA' : '<b>T</b>AI Assistant';
document.body.appendChild(badge);

const panel = document.createElement('div');
panel.id = 'nova-panel';
panel.innerHTML = `
  <div id="nova-header">
    <div id="nova-avatar">N</div>
    <div id="nova-title"><b>${BOT_NAME}</b><span><i></i>AI Assistant · ${SUBTITLE} · offline</span></div>
    <button id="nova-close" title="Close">✕</button>
  </div>
  <div id="nova-msgs"></div>
  <div id="nova-chips"></div>
  <form id="nova-form" autocomplete="off">
    <input id="nova-input" type="text" maxlength="200" placeholder="Ask me anything about NOVA STRIKE 3D...">
    <button type="submit" id="nova-send">➤</button>
  </form>
  <div id="nova-hint">${IS_TOUCH ? 'Tap ✕ to close' : 'Press T to open / close · Esc to close'}</div>
`;
document.body.appendChild(panel);

const msgsEl = document.getElementById('nova-msgs');
const chipsEl = document.getElementById('nova-chips');
const inputEl = document.getElementById('nova-input');
const formEl = document.getElementById('nova-form');

/* =====================================================
   3. HELPERS + LIVE STATUS
   ===================================================== */
const txt = (id) => ((document.getElementById(id) || {}).textContent || '').trim();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// reply that depends on the page: byMode({ arena: '...', war: '...', hub: '...', all: '...' })
const byMode = (o) => () => (o[MODE] !== undefined ? o[MODE] : o.all);

function isHidden(id) {
  const el = document.getElementById(id);
  if (!el) return true;
  if (el.classList.contains('hidden')) return true;
  const cs = getComputedStyle(el);
  return cs.display === 'none' || cs.visibility === 'hidden';
}

function inMatch() {
  if (document.body.classList.contains('in-game')) return true;
  if (MODE === 'war') return ['start-screen', 'result-screen', 'gameover-screen'].every(isHidden);
  return false;
}

const DEFAULT_CHIPS_BY_MODE = {
  arena: ['How do I play?', 'Give me a tip', 'Enemy types', 'My status', 'Who made this?'],
  war: ['How do I play?', 'Squad orders', 'Solo, Duo or Squad?', 'The boss fight', 'My status'],
  hub: ['What is NOVA STRIKE 3D?', 'Game modes', 'Does it work on phones?', 'Who made this?']
};
const DEFAULT_CHIPS = DEFAULT_CHIPS_BY_MODE[MODE];

const TIPS_ARENA = [
  'Keep moving! Standing still makes you an easy target. Strafe left and right.',
  'Hide behind a pillar: they block drone bullets completely.',
  'Drones glow brighter just before they fire. That is your cue to dodge.',
  'Reload between squads, not during a fight. Reload when the field is clear.',
  'Sprint to dodge a volley, then stop and aim.',
  'Focus one drone at a time. Three hits and it is gone, so finish what you start.',
  'Clearing a wave heals you by 25, so survive to the end of the wave.',
  'Zoom in with the scope for far drones. Aim assist helps if you want it.',
  'Check the alert at the top: it tells you where the next squad is coming from.'
];

const TIPS_WAR = [
  'Use your squad! Make them hold a position (X), then fight from behind cover.',
  'Send the squad at the enemy you are aiming at (C). Focus fire wins fights.',
  'Hawk is a sniper. Keep him alive and he will clear far enemies for you.',
  'A red laser means an enemy sniper is aiming at you. Break line of sight or move now!',
  'Heavy troopers are tough but fight at close range. Keep your distance and use the rifle.',
  'Throw grenades (G, or the 💣 button on phones) at groups, not single enemies: they hit a wide area.',
  'Pistol for precision, rifle for most fights, shotgun up close.',
  'Between waves your health and ammo are restored, so spend everything you have.',
  'Take cover behind the sandbags and crates at your camp, then lean out to shoot.',
  'Scope in for far targets. You walk slower while scoped.',
  'The boss hits hard. Keep moving, use cover and let your team share the damage.',
  'In the Boss Fight, make your team shoot the boss and throw grenades at it.',
  'Playing Solo is hard. Try Duo: Alpha shoots and Doc heals you.',
  'Pick SOLO, DUO or SQUAD on the start screen before you press DEPLOY.'
];

const TIPS_HUB = TIPS_ARENA.concat(TIPS_WAR);
const TIP_LIST = { arena: TIPS_ARENA, war: TIPS_WAR, hub: TIPS_HUB }[MODE];

let lastTip = -1;
function nextTip() {
  let i;
  do { i = Math.floor(Math.random() * TIP_LIST.length); } while (i === lastTip && TIP_LIST.length > 1);
  lastTip = i;
  return TIP_LIST[i];
}

function statusReply() {
  if (MODE === 'hub') {
    return 'You are on the Game Hub. Pick Arena Mode or War Mode, start a match, then open me from the pause screen and ask for "My status" to see your live stats.';
  }
  if (!inMatch()) {
    return 'No match is running right now. Press PLAY and I will track your stats live!';
  }
  if (MODE === 'arena') {
    const hp = parseInt(txt('health-text'), 10) || 0;
    let advice;
    if (hp <= 30) advice = '⚠ Health is critical! Hide behind a pillar and clear the squad to heal.';
    else if (hp <= 60) advice = 'You are taking damage. Keep strafing and use cover.';
    else advice = 'You are in good shape. Keep it up!';
    return '📊 LIVE STATUS\n' +
      '• ' + txt('wave-label') + '\n' +
      '• ' + txt('enemy-label') + '\n' +
      '• Health: ' + hp + '\n' +
      '• Score: ' + txt('score') + '\n' +
      '• Ammo: ' + txt('ammo') + '\n\n' + advice;
  }
  // war mode: read whatever the HUD shows
  const line = (label, id) => (txt(id) ? '• ' + label + ': ' + txt(id) + '\n' : '');
  const solo = document.body.classList.contains('team-solo');
  return '📊 LIVE STATUS\n' +
    line('Wave', 'wave-label') +
    line('Enemies', 'enemy-label') +
    line('Health', 'health-text') +
    line('Weapon', 'weapon-name') +
    line('Ammo', 'ammo') +
    line('Grenades', 'grenade-count') +
    (solo ? '\nYou are playing SOLO. Grenades and cover are your best friends.'
          : '\nTip: give your team orders (Follow / Hold / Attack) and throw grenades at groups.');
}

function tipReply() {
  if ((MODE === 'arena' || MODE === 'war') && inMatch()) {
    const hp = parseInt(txt('health-text'), 10) || 100;
    if (hp <= 30 && MODE === 'arena') return '💡 Your health is low! Break line of sight behind a pillar, then pick off drones one by one to finish the wave and heal +25.';
    if (hp <= 30 && MODE === 'war') return '💡 Your health is low! Get behind cover and hold on. Health is fully restored between waves.';
  }
  return '💡 TIP\n' + nextTip();
}

function timeReply() {
  const now = new Date();
  return 'It is ' + now.toLocaleString([], {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) + '.';
}

const JOKES = [
  'Why did the drone fail the exam? It kept flying off topic. 😄',
  'I told a drone a joke. It did not laugh, it just strafed away. 😅',
  'Why do programmers love dark mode? Because light attracts bugs. 🐛',
  'Why was the sniper bad at parties? He kept getting straight to the point. 🎯',
  'There are 10 kinds of people: those who understand binary and those who do not.'
];

/* ===== END OF PART 1 — paste PART 2 directly below this line ===== */
/* =====================================================
   4. KNOWLEDGE BASE  (edit answers here)
   keys = words/phrases to match (a key ending in * matches any word starting with it)
   reply = text or function, more = extra detail for "tell me more", chips = quick buttons
   ===================================================== */
const chipsFor = (o) => () => (o[MODE] !== undefined ? o[MODE] : o.all);

const INTENTS = [
  { id: 'clear', keys: ['clear chat', 'reset chat', 'clear conversation', 'clear screen'], clear: true, reply: '' },

  /* ----- live status + tips ----- */
  { id: 'status',
    keys: ['my score', 'my health', 'my wave', 'my status', 'status', 'how am i doing', 'what wave', 'enemies left', 'drones left', 'how many drones left', 'my ammo', 'my stats'],
    reply: statusReply, chips: ['Give me a tip', 'How do waves work?'] },

  { id: 'boss',
    keys: ['boss', 'bosses', 'final boss', 'boss fight'],
    reply: byMode({
      war: '👹 THE BOSS\nThe boss is a giant armoured mech with a lot of HP and long-range fire. You meet it in two ways:\n• Stage 1, wave 4: it arrives with escorts\n• BOSS FIGHT button: unlocked after you clear Stage 1. Just you (and your team, if you picked Duo or Squad) against the boss.\n\nIt fights in 3 phases: rifle fire first, then artillery barrages, then it ENRAGES at low HP.\n• Keep moving and never stand in the open\n• Use cover, then lean out to shoot\n• Order your team to focus the boss\n• Grenades and the rifle do the most damage',
      arena: 'Arena Mode has no boss. It is an endless survival: waves just keep getting harder. The boss is in War Mode.',
      hub: '👹 THE BOSS\nThe boss is in War Mode: a giant mech that fights in 3 phases (rifle fire, artillery, enrage). It appears at the end of Stage 1, and clearing Stage 1 also unlocks a separate BOSS FIGHT button on the War Mode start screen.'
    }),
    more: byMode({
      war: 'Boss AI: it picks targets, keeps its range and changes behaviour by its remaining HP. Under 66% it starts artillery barrages ("ARTILLERY MODE"), and under 33% it becomes enraged. Each phase is a different tactic, so keep adapting.',
      all: 'The boss changes tactics by its remaining health: rifle fire, then artillery, then enrage.'
    }),
    chips: ['Tell me more', 'Give me a tip', 'Squad orders'] },

  { id: 'tips',
    keys: ['tip*', 'strateg*', 'advice', 'how to survive', 'survive', 'get better', 'improve', 'pro', 'trick*'],
    reply: tipReply, chips: ['Another tip', 'Enemy types', 'My status'] },

  /* ----- what is the game ----- */
  { id: 'game',
    keys: ['nova strike', 'nova strike 3d', 'what is nova strike 3d', 'what is nova strike', 'the game', 'this game', 'flagship', 'tactical ai combat'],
    reply: '🎮 NOVA STRIKE 3D\nTactical AI Combat: a real 3D shooter that runs in your browser, on PC and on phones. It is the flagship game of Game Hub and has three modes:\n• Arena Mode: survive waves of AI drones\n• War Mode: a campaign where you play Solo, Duo or with a full 4-man AI squad\n• Multiplayer: real online players (in development)',
    chips: ['Game modes', 'How do I play?', 'Who made this?'] },

  { id: 'modes',
    keys: ['game modes', 'modes', 'mode', 'three modes', 'arena mode', 'war mode', 'difference'],
    reply: '🗺 THE THREE MODES\n• ARENA MODE: a neon arena. Survive endless waves of AI drones and chase a high score.\n• WAR MODE: a realistic battlefield. Go in SOLO, as a DUO (Alpha + Doc) or lead the full SQUAD (Alpha, Bravo, Hawk, Doc) against ground and air enemies. Stage 1 has 4 waves and a boss, and a separate Boss Fight unlocks after it.\n• MULTIPLAYER: 1v1 up to 4v4 with real players. It is in development.\n\nArena and War both work on phones too.',
    chips: ['Solo, Duo or Squad?', 'Multiplayer?', 'Does it work on phones?'] },

  { id: 'multiplayer',
    keys: ['multiplayer', 'multi player', 'online', 'online players', '1v1', '2v2', '3v3', '4v4', 'real players', 'play with friends', 'friends'],
    reply: '🌐 MULTIPLAYER\nMultiplayer is in development. The plan is real online players instead of AI: 1v1, 2v2, 3v3 and 4v4 teams, using the same graphics and weapons as War Mode. We will try our best to finish it!',
    chips: ['Game modes', 'Who made this?'] },

  { id: 'nova',
    keys: ['nova', 'how does nova work', 'who is nova', 'assistant', 'chatbot', 'chat bot', 't key'],
    reply: '🤖 ABOUT NOVA\nI am NOVA, the AI assistant of NOVA STRIKE 3D. On PC press T to talk to me; on phones tap the NOVA badge on the menus or the pause screen.\nI am rule-based: I match your words against a knowledge base (and forgive small typos), so I work fully offline and answer instantly. In a match I can also read your live stats.',
    more: 'My matching works in 3 steps: (1) clean up your sentence, (2) score every topic by how many of its keywords appear, allowing small typos, (3) answer with the best-scoring topic. If nothing matches, I suggest topics instead of guessing. Because no server or paid API is used, I am free and private.',
    chips: ['Tell me more', 'What is NOVA STRIKE 3D?', 'Does it work offline?'] },

  /* ----- controls + aiming ----- */
  { id: 'controls',
    keys: ['controls', 'control', 'keys', 'keyboard', 'how to play', 'how do i play', 'move*', 'walk*', 'sprint*', 'run', 'shoot*', 'fire', 'reload*', 'aiming', 'how do i'],
    reply: byMode({
      arena: '🎮 CONTROLS (ARENA)\n• W A S D: move\n• Shift: sprint\n• Mouse: look around\n• Click or Space: shoot\n• R: reload\n• Right mouse / F: scope (zoom)\n• V: aim assist on / off\n• Arrow keys: turn the camera\n• Esc: pause\n• T: talk to me\n\n📱 ON A PHONE: left thumb = move (push far to sprint), swipe the right side = look, FIRE = shoot, ⏸ = pause.',
      war: '🎮 CONTROLS (WAR)\n• W A S D: move\n• Shift: sprint\n• Mouse: look around\n• Click or Space: shoot\n• R: reload\n• 1 2 3: switch weapon (pistol, rifle, shotgun)\n• G: throw a grenade\n• Z / X / C: team orders (Follow / Hold / Attack my target)\n• Right mouse / F: scope (zoom)\n• V: aim assist on / off\n• Arrow keys: turn the camera\n• [ and ]: sensitivity down / up\n• B: bloom on / off\n• Esc: pause\n• T: talk to me\n\n📱 ON A PHONE: left thumb = move (push far to sprint), swipe the right side = look, FIRE = shoot, GUN = change weapon, ORDER = team command, 💣 = grenade, ⏸ = pause. Reload and aim assist are automatic.',
      hub: '🎮 CONTROLS\nOn PC: W A S D to move, Shift to sprint, the mouse to look, click or Space to shoot, R to reload, right mouse or F to scope, V for aim assist and Esc to pause. War Mode adds 1 2 3 for weapons, G for grenades and Z / X / C team orders.\nOn a phone: touch controls appear automatically. Start a mode and open me from the pause screen for the full list!'
    }),
    chips: ['Scope and aim assist', 'What is the goal?', 'Give me a tip'] },

  { id: 'scope',
    keys: ['scope', 'zoom', 'aim assist', 'assist', 'auto aim', 'autoaim', 'right click', 'right mouse', 'sniper scope'],
    reply: '🎯 SCOPE + AIM ASSIST\n• SCOPE: hold the right mouse button (or F) to zoom in. The view narrows, your aim slows down for precision, and you walk slower.\n• AIM ASSIST: press V to turn it on or off (off by default on PC, on by default on phones). While you fire, it gently pulls your crosshair toward the nearest enemy. It is an optional accessibility feature, like in console shooters.',
    chips: ['How do I play?', 'Open settings?'] },

  { id: 'goal',
    keys: ['goal', 'objective', 'how to win', 'win', 'what do i do', 'purpose', 'what is the aim'],
    reply: byMode({
      arena: '🎯 GOAL\nSurvive as many waves of AI drones as you can. Shoot the drones, dodge their bullets and chase a new best score. There is no final level: the waves keep getting harder!',
      war: '🎯 GOAL\nClear every wave of Stage 1 and beat the boss. Choose SOLO, DUO or SQUAD, use cover and finish the stage to unlock the next one and the Boss Fight.',
      hub: '🎯 GOAL\nArena Mode: survive endless drone waves for a high score. War Mode: clear the waves and beat the boss, alone or with your team. Pick one and press PLAY!'
    }),
    chips: ['How do waves work?', 'Game modes'] },

  /* ----- enemies ----- */
  { id: 'enemies',
    keys: ['enemy types', 'enemy', 'enemies', 'drone*', 'bot', 'bots', 'bomber*', 'sniper*', 'turret*', 'heavy', 'heavies', 'mech*', 'how many hits', 'hits to kill', 'how many shots', 'color', 'colour', 'types'],
    reply: byMode({
      arena: '🤖 DRONES\nEach drone takes 3 hits. Its colour shows what is left: cyan (3) → purple (2) → pink (1). Every kill gives 100 points.\n\nThey strafe, keep their distance, and glow brighter right before they shoot. That is your cue to dodge!',
      war: '🪖 ENEMY TYPES (WAR)\n• Riflemen: the basic troops, medium range\n• Heavies: very tough, but only dangerous up close\n• Snipers: fire from far away. A red laser warns you before each shot!\n• Drones and bombers: attack from the air\n• Turrets: fixed guns with long range\n• Mechs and the boss: big, strong and deadly\nEach type has its own firing range, so use distance and cover.',
      hub: '🤖 ENEMIES\nArena Mode: AI drones that take 3 hits. War Mode: riflemen, heavies, snipers, drones, bombers, turrets, mechs and a boss. Start a mode and ask me again for details!'
    }),
    more: byMode({
      arena: 'Under the hood each drone runs a sense → decide → act loop on every frame:\n1. SENSE: where is the player?\n2. DECIDE: approach, back off, or strafe.\n3. ACT: move and shoot, with a little aim error so you can survive.\nThey also keep apart from each other (flocking), so they do not clump into one target.',
      war: 'War Mode enemies use role-based AI. Each role has a firing range and a speed, and an adaptive AI director adjusts the difficulty as you play. Enemies also check themselves and get moved out of walls if they get stuck. Snipers hold their distance and warn you with a laser, so the fight stays fair.',
      all: 'Every enemy runs a sense → decide → act loop, and the difficulty scales as you progress.'
    }),
    chips: ['Tell me more', 'Give me a tip', 'How do waves work?'] },

  { id: 'waves',
    keys: ['wave*', 'formation*', 'levels', 'level', 'rounds', 'round'],
    reply: byMode({
      arena: '🌊 WAVES\nEach wave arrives as squads of 3 to 5 drones that warp in ahead of you in a line, V or arc. Wave 1 has 3 drones and every wave adds 2 more (max 14).\n\nClear a wave for a bonus of wave × 250 points and +25 health. Later waves are faster and shoot more often.',
      war: '🌊 WAVES (WAR)\nStage 1 has 4 waves: Warm-Up, Push, Assault and the Boss. Each wave brings more and tougher enemies, including heavies, drones, turrets and bombers.\nBetween waves you get a short break, and your health and ammo are fully restored.',
      hub: '🌊 WAVES\nBoth modes are built from waves of enemies. Arena Mode waves never end. War Mode Stage 1 has 4 waves and a boss.'
    }),
    chips: chipsFor({ arena: ['How does scoring work?', 'Give me a tip'], war: ['Squad orders', 'The boss fight'], all: ['Game modes'] }) },

  { id: 'stages',
    keys: ['stage*', 'campaign', 'unlock', 'locked', 'next stage', 'stage 2', 'more stages'],
    reply: '🏁 STAGES\nWar Mode is a campaign of 5 stages. Stage 1 (City Outskirts) is open from the start. Clear it, boss included, to unlock the next stage and the separate BOSS FIGHT button. The later stages are in development.',
    chips: ['The boss fight', 'Game modes'] },

  { id: 'scoring',
    keys: ['scoring', 'score', 'points', 'high score', 'best score', 'record', 'leaderboard', 'stars', 'star'],
    reply: byMode({
      arena: '🏆 SCORING\n• +100 for every drone destroyed\n• +250 × wave number when you clear a wave\n\nYour best score is saved in this browser, so it is still here after a refresh.',
      war: '🏆 SCORING (WAR)\nYou earn 1 to 3 stars when you clear a stage.\n• SOLO: more stars for finishing with high health\n• DUO: keep Alpha and Doc alive\n• SQUAD: keep your squad alive\nKills and speed add to your score.',
      all: '🏆 SCORING\nArena Mode has a score: +100 per drone and +250 × wave for clearing a wave. Your best is saved in the browser. In War Mode the aim is to clear the stage and earn stars.'
    }),
    chips: ['My status', 'Give me a tip'] },

  /* ----- team (War Mode) ----- */
  { id: 'teamchoice',
    keys: ['solo', 'duo', 'alone', 'by myself', 'single player', 'singleplayer', 'one player', 'team mode', 'team size', 'solo duo squad', 'solo, duo or squad'],
    reply: byMode({
      war: '👥 TEAM MODE\nOn the War Mode start screen choose before you press DEPLOY:\n• SOLO: just you. No teammates, the hardest way to play.\n• DUO: you + Alpha (assault) and Doc (medic who heals you).\n• SQUAD: you + Alpha, Bravo, Hawk (sniper) and Doc.\nYour choice is saved. The ORDER button and the team panel are hidden in Solo.',
      all: '👥 TEAM MODE\nIn War Mode you choose SOLO (just you), DUO (Alpha + Doc) or SQUAD (Alpha, Bravo, Hawk and Doc) on the start screen. It works on PC and on phones.'
    }),
    chips: ['Squad orders', 'Give me a tip', 'Does it work on phones?'] },

  { id: 'squad',
    keys: ['squad*', 'team', 'teammate*', 'teammates', 'squadmate*', 'orders', 'order*', 'alpha', 'bravo', 'hawk', 'doc', 'medic', 'follow', 'command*'],
    reply: byMode({
      war: '🪖 YOUR TEAM\n• Alpha and Bravo: assault soldiers for medium range\n• Hawk: the sniper, shoots from very far away\n• Doc: the medic, heals you and the team\n\nSolo = nobody, Duo = Alpha + Doc, Squad = all four.\n\nORDERS (Duo and Squad):\n• Z / FOLLOW: stay with me\n• X / HOLD: hold position\n• C / ATTACK: attack my target (aim at an enemy first)\nOn a phone tap the ORDER button to cycle them. They only shoot what they can see, and each has a firing range.',
      arena: 'Arena Mode is a solo fight. In War Mode you can go Solo, Duo or with the full squad (Alpha, Bravo, Hawk and Doc), and give them orders.',
      hub: '🪖 THE TEAM\nIn War Mode you pick SOLO, DUO or SQUAD. The full squad has Alpha, Bravo, Hawk (sniper) and Doc (medic), and you give them orders: Follow, Hold or Attack.'
    }),
    more: 'Squad AI: each soldier has a role, a firing range and its own behaviour. Hawk the sniper stops to shoot from far away when an enemy is visible, while Alpha and Bravo close in to about 70% of their range when you order an attack. Doc runs to whoever is hurt and heals them. They also catch up with you if they fall behind.',
    chips: ['Tell me more', 'Solo, Duo or Squad?', 'Give me a tip'] },

  { id: 'weapons',
    keys: ['weapon*', 'gun*', 'pistol', 'rifle', 'shotgun', 'grenade*', 'ammo', 'magazine', 'explosive*', 'bomb*'],
    reply: byMode({
      war: '🔫 WEAPONS (WAR)\n• Pistol: strong single shots\n• Rifle: fast automatic fire (the best all-rounder)\n• Shotgun: heavy close-range damage\n• Grenade: big area damage, great against groups (you carry a few and get more between waves)\nPC: keys 1 2 3 and G. Phone: the GUN button cycles weapons and 💣 throws a grenade.\nAmmo and health are restored between waves, and reloading is automatic when you run dry.',
      arena: '🔫 WEAPON (ARENA)\nYou have one energy rifle with a 30-round magazine. Reload between squads, not during a fight.',
      hub: '🔫 WEAPONS\nArena Mode gives you one energy rifle. War Mode has a pistol, rifle, shotgun and grenades.'
    }),
    chips: ['How do I play?', 'Give me a tip'] },

  { id: 'health',
    keys: ['health', 'heal*', 'hp', 'damage', 'die', 'dying', 'dead', 'lives', 'life'],
    reply: byMode({
      arena: '❤ HEALTH\nYou start with 100 HP. Each drone bullet costs 10. Clearing a wave restores +25 (max 100). The bar turns red under 30, so hide behind a pillar and recover.',
      war: '❤ HEALTH (WAR)\nAvoid open ground and fight from cover. Your health and ammo are fully restored between waves. If Doc is on your team he heals you when you are hurt. In Solo there is no medic, so be careful.',
      hub: '❤ HEALTH\nArena Mode: 100 HP, +25 for every cleared wave. War Mode: health and ammo are restored between waves.'
    }),
    chips: ['Give me a tip', 'Where can I take cover?'] },

  { id: 'cover',
    keys: ['pillar*', 'cover', 'hide', 'hiding', 'wall*', 'column*', 'sandbag*', 'camp', 'where can i take cover'],
    reply: byMode({
      arena: '🏛 PILLARS\nThe 8 glowing pillars block bullets from both sides. Stand behind one to break the drones line of fire, then lean out to shoot.',
      war: '🏕 COVER\nYour spawn camp has sandbags and crates. Stand behind them to block enemy fire, then step out to shoot. Remember: snipers can still reach you from far away, so watch for the red laser.',
      hub: '🏛 COVER\nBoth modes reward smart cover: pillars in Arena Mode, and sandbags and crates at the War Mode camp.'
    }),
    chips: ['Give me a tip', 'Enemy types'] },

  /* ----- settings, audio, tech ----- */
  { id: 'settings',
    keys: ['settings', 'setting', 'volume', 'sensitivity', 'sens', 'mute', 'quiet', 'louder', 'options', 'graphics', 'quality', 'bloom', 'resolution'],
    reply: '⚙ SETTINGS\nOpen Settings from the Start screen or the Pause screen:\n• Master, Effects and Music volume\n• Sensitivity from 1 to 30 (10 is normal; on PC in War Mode you can also press [ and ])\n• Graphics Quality: High, Medium or Low for slower devices. Phones use Medium automatically.\nEverything is saved automatically.',
    chips: ['Is the game laggy?', 'Pause menu'] },

  { id: 'music',
    keys: ['music', 'sound*', 'audio', 'song*', 'soundtrack', 'beat'],
    reply: byMode({
      arena: '🎵 MUSIC & SOUND\nMost sounds and the synthwave music are generated live by code using the Web Audio API. The music builds up as you progress: bass and pads first, drums from wave 2, then a lead arpeggio from wave 3.',
      all: '🎵 SOUND\nSounds and music are generated live by code using the Web Audio API, with a free gunshot sample. You can change the volumes in Settings.'
    }),
    chips: ['How was this made?', 'Open settings?'] },

  { id: 'pause',
    keys: ['pause', 'paused', 'quit', 'exit', 'main menu', 'menu', 'leave', 'stop', 'resume'],
    reply: '⏸ PAUSE\nOn PC press Esc to pause. On a phone tap the ⏸ button. From the Pause screen you can Resume, open Settings, or Quit to the menu.',
    chips: ['How do I play?', 'Give me a tip'] },

  { id: 'hub',
    keys: ['hub', 'game hub', 'gamehub', 'website', 'site', 'other games', 'tic tac toe', 'tictactoe', 'snake', 'more games', 'whats next', 'coming soon', 'future', 'next update'],
    reply: '🕹 GAME HUB\nGame Hub is the website that holds everything:\n• NOVA STRIKE 3D, the flagship game, with Arena Mode, War Mode and Multiplayer (in development)\n• More Games: Tic Tac Toe against an AI and Snake, playable right on the site\nUse "Back to Hub" on the menus to return to the home page.',
    chips: ['Game modes', 'Who made this?', 'How was this made?'] },

  { id: 'tech',
    keys: ['how was this made', 'technology', 'technologies', 'tech', 'built with', 'made with', 'three', 'threejs', 'javascript', 'html', 'css', 'code', 'coding', 'framework*', 'engine', 'language', 'models', 'graphics engine'],
    reply: '🛠 HOW IT IS BUILT\n• Plain HTML, CSS and JavaScript, with no framework\n• Three.js for the 3D graphics (PBR materials, shadows, bloom)\n• Free 3D models and textures, loaded as glTF\n• Web Audio API for sounds and music\n• Raycasting for shooting, Pointer Lock for mouse look, and touch controls for phones\n• localStorage for your settings and progress\n\nEverything used is free.',
    chips: ['How does the AI work?', 'Does it work offline?'] },

  { id: 'ai',
    keys: ['ai', 'artificial intelligence', 'intelligen*', 'smart', 'brain', 'think*', 'machine learning', 'how does ai work', 'how does the ai work'],
    reply: '🧠 THE AI\n• Enemies: every frame they sense where you are, decide what to do (approach, retreat, take position, strafe or shoot) and act. In War Mode each type has its own role and range, and an adaptive director adjusts the difficulty.\n• Your team: soldiers with roles that obey your orders.\n• Me: a rule-based assistant that matches your words against a knowledge base, so I work fully offline.',
    chips: ['How does NOVA work?', 'Enemy types'] },

  { id: 'offline',
    keys: ['offline', 'internet', 'wifi', 'wi fi', 'connection', 'without internet'],
    reply: '📡 OFFLINE\nI work with no internet at all. The game loads the Three.js 3D library from a free CDN, so the first load needs internet. A local copy can be added so the whole site runs offline too.',
    chips: ['How was this made?'] },

  { id: 'mobile',
    keys: ['mobile', 'phone', 'phones', 'android', 'iphone', 'tablet', 'touch', 'touchscreen', 'touch controls', 'on phones', 'on phone'],
    reply: '📱 PHONES\nYes! Arena Mode and War Mode both work on phones with on-screen touch controls:\n• Left thumb: move (push far to sprint)\n• Swipe the right side: look around\n• FIRE: shoot\n• GUN: change weapon (War)\n• ORDER: team command (War, Duo and Squad)\n• 💣: grenade (War)\n• ⏸: pause\n\nPlay in landscape. Reload and aim assist are automatic, and graphics switch to Medium so it runs smoothly.',
    chips: ['How do I play?', 'Solo, Duo or Squad?'] },

  { id: 'mouse',
    keys: ['touchpad', 'trackpad', 'mouse', 'mouse not working', 'cant shoot', 'cannot shoot', 'cursor stuck', 'stuck'],
    reply: '🖱 MOUSE / TOUCHPAD\nA USB mouse is the best choice. On a touchpad you can tap to shoot, or press Space. If the cursor sticks while you shoot or walk, turn off "ignore touchpad while typing" in your touchpad settings, or turn with the arrow keys. You can also change the sensitivity (1 to 30) in Settings.',
    chips: ['Open settings?', 'How do I play?'] },

  { id: 'performance',
    keys: ['lag', 'laggy', 'is the game laggy', 'slow', 'fps', 'stutter*', 'performance', 'freeze', 'freezing', 'bug', 'glitch', 'broken', 'not working'],
    reply: '🔧 TROUBLESHOOTING\n• Open Settings and set Graphics Quality to Medium or Low\n• Close other browser tabs and heavy apps\n• On a laptop, plug in your charger and use the high-performance power mode\n• Use Chrome or Edge and refresh with Ctrl + Shift + R (on a phone, reload the page twice)\n• If the mouse is stuck, press Esc, then press Resume',
    chips: ['Open settings?', 'How do I play?'] },

  { id: 'difficulty',
    keys: ['hard', 'difficult*', 'easy', 'too hard', 'too easy', 'impossible'],
    reply: '📈 DIFFICULTY\nBoth modes get harder as you go. If it feels too hard, use cover, keep moving, scope in for far enemies, and in War Mode pick DUO or SQUAD so teammates help you. Aim assist also helps (automatic on phones, V on PC). Want a real challenge? Try SOLO!',
    chips: ['Give me a tip', 'Solo, Duo or Squad?'] },

  /* ----- about the project ----- */
  { id: 'creator',
    keys: ['who made', 'who created', 'who built', 'who developed', 'who designed', 'developer', 'creator', 'author', 'daniyal', 'made by', 'built by'],
    reply: '👨‍💻 CREATOR\nGame Hub and NOVA STRIKE 3D were designed and developed by Daniyal for the AI/IT Expo 2026 at Forte Colleges of Excellence, Sargodha. AI tools were used to help write the code.',
    chips: ['How was this made?', 'What is this project?'] },

  { id: 'expo',
    keys: ['expo', 'college', 'forte', 'sargodha', 'competition', 'project', 'what is this project', 'what is this'],
    reply: '🎓 THE PROJECT\nGame Hub is an entry for the AI/IT Expo 2026 at Forte Colleges of Excellence, Sargodha. Its flagship, NOVA STRIKE 3D, shows a 3D game with AI-controlled enemies and teammates, procedural audio, phone support and an in-game AI assistant (me!), all built with free, open web technology.',
    chips: ['Who made this?', 'How does the AI work?'] },

  { id: 'whoareyou',
    keys: ['who are you', 'your name', 'what are you', 'are you real', 'are you ai', 'introduce yourself', 'what can you do', 'help', 'help me'],
    reply: 'I am NOVA, the AI assistant of NOVA STRIKE 3D. 🤖\nAsk me about the controls, enemies, waves, your team, weapons, settings, phones, or how the game was built. In a match I can also read your live stats. Try "My status"!',
    chips: DEFAULT_CHIPS },

  { id: 'time', keys: ['what time', 'current time', 'time now', 'what day', 'todays date', 'what date', 'date today'], reply: timeReply },

  { id: 'joke', keys: ['joke', 'funny', 'make me laugh', 'laugh'], reply: () => pick(JOKES), chips: ['Another joke', 'Give me a tip'] },

  { id: 'thanks',
    keys: ['thanks', 'thank', 'thank you', 'thx', 'shukriya', 'great', 'awesome', 'cool', 'nice'],
    reply: () => pick(['You are welcome! Good luck out there! 🎯', 'Anytime! Now go clear that wave. 💪', 'Happy to help! Show those enemies who is boss.']),
    chips: ['Give me a tip'] },

  { id: 'bye', keys: ['bye', 'goodbye', 'see you', 'later', 'cya'], reply: 'Goodbye, pilot! Come back anytime you need me. 👋' },

  { id: 'howareyou', keys: ['how are you', 'how r u', 'whats up', 'sup'],
    reply: () => pick(['Running at 60 frames per second and feeling great! How about you?', 'All systems online! Ready to help you survive.']),
    chips: ['Give me a tip', 'How do I play?'] },

  { id: 'more', keys: ['tell me more', 'more', 'more details', 'elaborate', 'go on', 'continue'], reply: '' },

  { id: 'greet',
    keys: ['hi', 'hello', 'hey', 'hii', 'hiya', 'yo', 'salam', 'assalam*', 'aoa', 'good morning', 'good evening', 'good afternoon', 'greetings'],
    reply: () => pick(['Hello, pilot! 👋 How can I help?', 'Hey there! Ready for action?', 'Hi! Ask me anything about NOVA STRIKE 3D.']),
    chips: DEFAULT_CHIPS }
];

/* =====================================================
   5. MATCHING ENGINE
   ===================================================== */
function normalize(s) {
  return s.toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lev(a, b) {                                   // typo tolerance
  const m = a.length, n = b.length;
  const d = [];
  for (let i = 0; i <= m; i++) { d[i] = [i]; }
  for (let j = 0; j <= n; j++) { d[0][j] = j; }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

function keyMatches(key, tokens, padded) {
  if (key.endsWith('*')) {
    const p = key.slice(0, -1);
    return tokens.some((t) => t.startsWith(p));
  }
  if (key.includes(' ')) return padded.includes(' ' + key + ' ');
  if (tokens.includes(key)) return true;
  if (key.length >= 5) {
    return tokens.some((t) => t.length >= 5 && Math.abs(t.length - key.length) <= 1 && lev(t, key) <= 1);
  }
  return false;
}

function findIntent(text) {
  const norm = normalize(text);
  if (!norm) return null;
  const tokens = norm.split(' ');
  const padded = ' ' + norm + ' ';

  let best = null;
  let bestScore = 0;
  for (const intent of INTENTS) {
    if (intent.id === 'more' && tokens.length > 4) continue;
    let score = 0;
    for (const key of intent.keys) {
      if (keyMatches(key, tokens, padded)) score += key.split(' ').length * 2;
    }
    if (score > bestScore) { bestScore = score; best = intent; }
  }
  return best;
}

let lastIntent = null;

const resolve = (v) => (typeof v === 'function' ? v() : v);

function getReply(text) {
  const intent = findIntent(text);

  if (!intent) {
    lastIntent = null;
    return {
      text: pick([
        'Hmm, I am not sure about that one. 🤔',
        'I did not quite get that. 🤔'
      ]) + '\nI know about the controls, enemies, waves, weapons, settings, your team, phones and how the game was built. Try one of these:',
      chips: DEFAULT_CHIPS.slice(0, 4)
    };
  }

  if (intent.id === 'more') {
    if (lastIntent && lastIntent.more) {
      const out = { text: resolve(lastIntent.more), chips: resolve(lastIntent.chips) };
      lastIntent = Object.assign({}, lastIntent, { more: null });
      return out;
    }
    return { text: 'Ask me about something first, for example the enemies or the controls, and then I can tell you more.', chips: DEFAULT_CHIPS.slice(0, 3) };
  }

  lastIntent = intent;
  return { text: resolve(intent.reply), chips: resolve(intent.chips), clear: intent.clear };
}

/* =====================================================
   6. CHAT UI
   ===================================================== */
let replyToken = 0;

function scrollDown() { msgsEl.scrollTop = msgsEl.scrollHeight; }

function addMsg(who, text) {
  const el = document.createElement('div');
  el.className = 'nova-msg ' + who;
  el.textContent = text;                // textContent = safe, no HTML injection
  msgsEl.appendChild(el);
  scrollDown();
  return el;
}

function addTyping() {
  const el = document.createElement('div');
  el.className = 'nova-msg bot nova-typing';
  el.innerHTML = '<i></i><i></i><i></i>';
  msgsEl.appendChild(el);
  scrollDown();
  return el;
}

function clearChips() { chipsEl.innerHTML = ''; }

function showChips(list) {
  clearChips();
  (list || DEFAULT_CHIPS.slice(0, 3)).forEach((label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => send(label));
    chipsEl.appendChild(b);
  });
}

function botSay(text, chips, token) {
  const el = addMsg('bot', '');
  let i = 0;
  const step = () => {                  // typewriter effect
    i += 2;
    el.textContent = text.slice(0, i);
    scrollDown();
    if (i < text.length) setTimeout(step, 12);
    else if (token === replyToken) showChips(chips);
  };
  step();
}

const WELCOME = {
  arena: 'Hi, I am ' + BOT_NAME + ', the AI assistant of NOVA STRIKE 3D. 🤖\nYou are in Arena Mode. Ask me about the controls, drones, waves, scoring or how this game was built. I even know your live stats!',
  war: 'Hi, I am ' + BOT_NAME + ', the AI assistant of NOVA STRIKE 3D. 🤖\nYou are in War Mode, Commander. Ask me about Solo, Duo or Squad, enemy types, weapons, the boss or the controls. I can read your live stats too!',
  hub: 'Hi, I am ' + BOT_NAME + ', the AI assistant of NOVA STRIKE 3D. 🤖\nAsk me about the game modes, the controls, phones, how the game was built, or how I work. Tap my badge anytime to talk to me!'
};

function welcome() {
  const token = replyToken;
  botSay(WELCOME[MODE], DEFAULT_CHIPS, token);
}

function send(raw) {
  const text = raw.trim().slice(0, 200);
  if (!text) return;
  addMsg('user', text);
  clearChips();
  const token = ++replyToken;
  const typing = addTyping();
  const result = getReply(text);
  const delay = Math.min(1100, 450 + (result.text || '').length * 2);

  setTimeout(() => {
    typing.remove();
    if (result.clear) {
      msgsEl.innerHTML = '';
      welcome();
      return;
    }
    botSay(result.text, result.chips, token);
  }, delay);
}

formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = inputEl.value;
  inputEl.value = '';
  send(v);
});

/* =====================================================
   7. OPEN / CLOSE  (T key on PC, badge tap on phones)
   ===================================================== */
let isOpen = false;
let welcomed = false;

function openChat() {
  if (isOpen) return;
  isOpen = true;
  panel.classList.add('open');
  badge.style.display = 'none';
  if (document.pointerLockElement) document.exitPointerLock();   // frees the mouse + pauses the game
  if (!welcomed) { welcomed = true; welcome(); }
  setTimeout(() => inputEl.focus(), 60);
}

function closeChat() {
  if (!isOpen) return;
  isOpen = false;
  panel.classList.remove('open');
  badge.style.display = '';
  inputEl.blur();
}

badge.addEventListener('click', openChat);
document.getElementById('nova-close').addEventListener('click', closeChat);

// typing in the chat box must not trigger game keys
inputEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') closeChat();
});
inputEl.addEventListener('keyup', (e) => e.stopPropagation());

document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && isOpen) { closeChat(); return; }
  if (e.code !== 'KeyT' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = ((e.target && e.target.tagName) || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;      // do not steal T while typing elsewhere
  e.preventDefault();
  if (isOpen) closeChat(); else openChat();
});

// if the player clicks Resume and the mouse gets locked again, close the chat
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement && isOpen) closeChat();
});

/* =====================================================
   8. BADGE VISIBILITY
   PC:     the badge hides on menus and shows once the battle starts.
   Phones: the badge shows on menus and the pause screen, and hides during a match
           (so it never blocks the touch controls).
   ===================================================== */
const BADGE_ONLY_IN_MATCH = { arena: true, war: true, hub: false };

function updateBadge() {
  let show;
  if (IS_TOUCH) {
    const paused = MODE !== 'hub' && !isHidden('pause-screen');
    show = !isOpen && (MODE === 'hub' || !inMatch() || paused);
  } else {
    const needMatch = BADGE_ONLY_IN_MATCH[MODE];
    show = !isOpen && (!needMatch || inMatch());
  }
  badge.style.display = show ? '' : 'none';
}
updateBadge();
setInterval(updateBadge, 250);