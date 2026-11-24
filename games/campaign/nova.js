/* =====================================================
   NOVA for Strike Command (Campaign) - offline, rule-based
   Separate from games/assistant.js (War / Arena / Hub use that one).
   Press N to open / close (T is "Clear squad" in the Campaign).
   Reads the player's real key choices from keybinds.js.
   ===================================================== */

const BOT = 'NOVA';
const OPEN_CODE = 'KeyN';

/* ---------- live key names ---------- */
let KB = null;
import('./keybinds.js').then((m) => { KB = m; }).catch(() => { KB = null; });

function K(id, fallback) {
  try {
    if (KB && KB.key && KB.label) {
      const code = KB.key(id);
      if (code) return KB.label(code);
    }
  } catch (e) { /* use fallback */ }
  return fallback;
}

/* ---------- styles ---------- */
const CSS = `
#nova-badge{position:fixed;bottom:16px;right:16px;z-index:1000;padding:7px 12px;font:600 12px 'Segoe UI',Arial,sans-serif;letter-spacing:1px;color:#00f0ff;background:rgba(10,10,26,.75);border:1px solid rgba(0,240,255,.45);border-radius:8px;cursor:pointer;backdrop-filter:blur(4px)}
#nova-badge:hover{background:rgba(0,240,255,.15)}
#nova-badge b{display:inline-block;padding:1px 7px;margin-right:7px;border-radius:4px;background:#00f0ff;color:#0a0a1a}
#nova-panel{position:fixed;right:24px;bottom:24px;z-index:1001;width:min(400px,92vw);height:min(580px,82vh);display:none;flex-direction:column;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;color:#fff;background:rgba(12,12,34,.96);border:1px solid rgba(0,240,255,.55);border-radius:16px;box-shadow:0 0 40px rgba(123,47,247,.5)}
#nova-panel.open{display:flex}
#nova-header{display:flex;align-items:center;gap:12px;padding:14px 16px;background:linear-gradient(90deg,rgba(0,184,212,.25),rgba(123,47,247,.3));border-bottom:1px solid rgba(0,240,255,.3)}
#nova-avatar{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;background:linear-gradient(135deg,#00f0ff,#7b2ff7,#ff2d95)}
#nova-title{flex:1;display:flex;flex-direction:column;line-height:1.25}
#nova-title b{font-size:17px;letter-spacing:3px}
#nova-title span{font-size:11px;color:#9fe}
#nova-close{width:30px;height:30px;border:none;border-radius:8px;cursor:pointer;color:#fff;background:rgba(255,255,255,.1)}
#nova-close:hover{background:rgba(255,45,149,.5)}
#nova-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.nova-msg{max-width:88%;padding:9px 13px;border-radius:12px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;user-select:text}
.nova-msg.bot{align-self:flex-start;color:#e6fbff;background:rgba(0,240,255,.1);border:1px solid rgba(0,240,255,.3);border-top-left-radius:3px}
.nova-msg.user{align-self:flex-end;background:linear-gradient(90deg,#00b8d4,#7b2ff7);border-top-right-radius:3px}
.nova-typing{display:flex;gap:5px;padding:13px 15px}
.nova-typing i{width:7px;height:7px;border-radius:50%;background:#00f0ff;animation:novaDot 1s infinite}
.nova-typing i:nth-child(2){animation-delay:.15s}
.nova-typing i:nth-child(3){animation-delay:.3s}
@keyframes novaDot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-4px)}}
#nova-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}
#nova-chips:empty{display:none}
#nova-chips button{padding:6px 11px;font-size:12px;font-family:inherit;cursor:pointer;color:#00f0ff;background:transparent;border:1px solid rgba(0,240,255,.5);border-radius:14px}
#nova-chips button:hover{background:rgba(0,240,255,.18)}
#nova-form{display:flex;gap:8px;padding:12px 14px;border-top:1px solid rgba(0,240,255,.25)}
#nova-input{flex:1;padding:10px 12px;font-size:14px;font-family:inherit;color:#fff;background:rgba(0,0,0,.4);border:1px solid rgba(0,240,255,.4);border-radius:10px;outline:none;user-select:text}
#nova-input:focus{border-color:#00f0ff}
#nova-send{width:44px;border:none;border-radius:10px;cursor:pointer;font-size:16px;color:#fff;background:linear-gradient(90deg,#00b8d4,#7b2ff7)}
#nova-hint{padding:0 14px 10px;font-size:11px;color:#789;text-align:center}
`;
const styleEl = document.createElement('style');
styleEl.textContent = CSS;
document.head.appendChild(styleEl);

/* ---------- build panel ---------- */
const badge = document.createElement('div');
badge.id = 'nova-badge';
badge.innerHTML = '<b>N</b>AI Assistant';
document.body.appendChild(badge);

const panel = document.createElement('div');
panel.id = 'nova-panel';
panel.innerHTML = `
  <div id="nova-header">
    <div id="nova-avatar">N</div>
    <div id="nova-title"><b>${BOT}</b><span>AI Assistant · Strike Command · offline</span></div>
    <button id="nova-close" title="Close">✕</button>
  </div>
  <div id="nova-msgs"></div>
  <div id="nova-chips"></div>
  <form id="nova-form" autocomplete="off">
    <input id="nova-input" type="text" maxlength="200" placeholder="Ask me about Strike Command...">
    <button type="submit" id="nova-send">➤</button>
  </form>
  <div id="nova-hint">Press N to open / close · Esc to close</div>
`;
document.body.appendChild(panel);

const msgsEl = document.getElementById('nova-msgs');
const chipsEl = document.getElementById('nova-chips');
const inputEl = document.getElementById('nova-input');
const formEl = document.getElementById('nova-form');

/* ---------- helpers ---------- */
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const txt = (id) => ((document.getElementById(id) || {}).textContent || '').trim();

function isHidden(id) {
  const el = document.getElementById(id);
  if (!el) return true;
  if (el.classList.contains('hidden')) return true;
  const cs = getComputedStyle(el);
  return cs.display === 'none' || cs.visibility === 'hidden';
}
const inMission = () => isHidden('start-screen');

const DEFAULT_CHIPS = ['The mission', 'Squad orders', 'Controls', 'Training soldiers', 'Change keys'];

/* ---------- answers that read the real keys ---------- */
const controlsText = () =>
  '🎮 CONTROLS (STRIKE COMMAND)\n' +
  '• ' + K('forward', 'W') + ' ' + K('left', 'A') + ' ' + K('back', 'S') + ' ' + K('right', 'D') + ': move\n' +
  '• ' + K('sprint', 'Shift') + ': sprint\n' +
  '• ' + K('jump', 'Space') + ': jump\n' +
  '• Mouse: look around\n' +
  '• ' + K('fly', 'F') + ': fly mode (scout the island), ' + K('descend', 'C') + ': go down\n' +
  '• ' + K('follow', '1') + ': squad follow me\n' +
  '• ' + K('hold', '2') + ': squad hold position\n' +
  '• ' + K('attack', '3') + ': squad go to the town square (test, will become Attack the town)\n' +
  '• ' + K('interact', 'E') + ': use / train at the Barracks (coming soon)\n' +
  '• ' + K('spawn', 'G') + ': spawn a soldier (test), ' + K('clear', 'T') + ': clear the squad (test)\n' +
  '• ' + K('info', 'P') + ': info, ' + K('debug', 'B') + ': collision outlines (debug)\n' +
  '• Esc: pause\n• N: talk to me\n\n' +
  '⌨ Want different keys? Click the Controls button on the start screen.';

const squadText = () =>
  '🪖 YOUR SQUAD\nYou start with 4 SWAT soldiers. Training at the Barracks will let you grow the army (up to 12).\n\n' +
  'ORDERS:\n• ' + K('follow', '1') + ': Follow me (formation behind you)\n• ' + K('hold', '2') + ': Hold this position\n• ' +
  K('attack', '3') + ': Go to the town square (test now, will become Attack the town)\n\n' +
  'They plan routes around buildings, trees and fences, run when you are far away, and teleport back only if they get really lost.';

const trainingText = () =>
  '🏕 TRAINING (BARRACKS)\nThis is the next feature being built. The plan:\n' +
  '• Walk to a Barracks in your base and press ' + K('interact', 'E') + '\n' +
  '• Spend supplies (they grow slowly over time)\n' +
  '• A progress bar fills for about 5 seconds, then the new soldier walks out of the door\n' +
  '• Choose a weapon type: pistol (fast, cheap), rifle (long range) or shotgun (hits hard up close)\n' +
  '• The army is capped at 12 soldiers\n\n' +
  'For testing now: ' + K('spawn', 'G') + ' spawns a soldier and ' + K('clear', 'T') + ' clears the squad.';

const keysText = () =>
  '⌨ KEY CUSTOMIZATION\n1. On the start screen click the Controls button.\n2. Click the action you want to change.\n3. Press the new key.\n' +
  'If that key is already used, the two actions swap, so nothing is left without a key. Reset to defaults puts everything back.\n\n' +
  'Your choices are saved in this browser. Esc always pauses and cannot be changed.';

const statusText = () => {
  if (!inMission()) return 'No mission is running. Click ENTER ISLAND and I will read your live status!';
  return '📊 LIVE STATUS\n• ' + (txt('hud-info') || 'Strike Command') + '\n\n' +
    'Orders: ' + K('follow', '1') + ' = Follow, ' + K('hold', '2') + ' = Hold.\n' +
    'Missions and objectives are still being built, so for now you can explore, command your squad and test the world.';
};

const TIPS = [
  () => 'Press ' + K('follow', '1') + ' to call your squad to you and ' + K('hold', '2') + ' to make them hold position.',
  'Your soldiers walk around buildings, trees and fences. They cannot walk through walls, and neither can you.',
  'The town is south-east of your base, near the harbor. Follow the road from the Main Gate.',
  () => 'Press ' + K('fly', 'F') + ' to toggle fly mode and scout the whole island from above.',
  'The pier and Harbor Landing are where enemy reinforcements will arrive by boat.',
  'If the FPS is low, lower the Quality on the start screen and keep fewer soldiers.',
  'You can change every key with the Controls button on the start screen. Choices are saved.',
  'Keep your squad together. Soldiers that fall far behind run to catch up.'
];
let lastTip = -1;
function tipText() {
  let i;
  do { i = Math.floor(Math.random() * TIPS.length); } while (i === lastTip && TIPS.length > 1);
  lastTip = i;
  const t = TIPS[i];
  return '💡 TIP\n' + (typeof t === 'function' ? t() : t);
}

const JOKES = [
  'Why did the drone fail the exam? It kept flying off topic. 😄',
  'Why do programmers love dark mode? Because light attracts bugs. 🐛',
  'Why was the sniper bad at parties? He kept getting straight to the point. 🎯',
  'There are 10 kinds of people: those who understand binary and those who do not.'
];

/* =====================================================
   KNOWLEDGE BASE
   ===================================================== */
const INTENTS = [
  { id: 'clear', keys: ['clear chat', 'reset chat', 'clear conversation', 'clear screen'], clear: true, reply: '' },

  { id: 'status', keys: ['my status', 'status', 'how am i doing', 'my stats', 'my health', 'my score'],
    reply: statusText, chips: ['Give me a tip', 'The mission'] },

  { id: 'tips', keys: ['tip*', 'strateg*', 'advice', 'get better', 'improve', 'trick*'],
    reply: tipText, chips: ['Another tip', 'Squad orders', 'Controls'] },

  { id: 'mission',
    keys: ['mission', 'goal', 'objective', 'how to win', 'win', 'what do i do', 'strike command', 'campaign', 'rts', 'real time strategy', 'island', 'town', 'harbor', 'harbour', 'town hall', 'age of empires', 'base', 'hq'],
    reply: '🏝 STRIKE COMMAND\nA realistic mini RTS played in first person, like Age of Empires seen through your own eyes.\n\n• You spawn at your base with 4 SWAT soldiers\n• The Space Gang has captured the town, which lies near the harbor\n• Train more soldiers at the Barracks\n• Clear the town and capture the Town Hall (stand in the square with no enemies left)\n• You lose if the Command HQ falls or you die\n\nWorld, collision, pathfinding and squad orders work now. Training, enemies, drones and missions are being added step by step.',
    more: 'Everything is built from free CC0 assets: Kenney (pines, rocks, houses), Quaternius (characters) and Poly Haven (ground textures). Soldiers use A* pathfinding and a shared collision system, so nobody walks through walls or trees.',
    chips: ['Squad orders', 'Training soldiers', 'The Space Gang', 'Controls'] },

  { id: 'training', keys: ['train*', 'barracks', 'recruit*', 'supplies', 'reinforcement*', 'army', 'boat', 'boats'],
    reply: trainingText, chips: ['Squad orders', 'The Space Gang', 'Change keys'] },

  { id: 'squad', keys: ['squad*', 'team', 'teammate*', 'orders', 'order*', 'follow', 'command*', 'soldier*', 'swat'],
    reply: squadText,
    more: 'Squad AI: every soldier follows a formation slot behind you, plans a route with A* pathfinding, avoids bumping into friends, and walks, runs or catches up depending on distance. Only one path search runs per frame for the whole squad, so the game stays smooth.',
    chips: ['Tell me more', 'Training soldiers', 'Change keys'] },

  { id: 'keys', keys: ['rebind*', 'remap*', 'keybind*', 'key bindings', 'key settings', 'change keys', 'change key', 'change controls', 'custom controls', 'customize*', 'customise*'],
    reply: keysText, chips: ['Controls', 'Open settings?'] },

  { id: 'controls', keys: ['controls', 'control', 'keys', 'keyboard', 'how to play', 'how do i play', 'move*', 'walk*', 'sprint*', 'run', 'how do i'],
    reply: controlsText, chips: ['Change keys', 'Squad orders', 'Give me a tip'] },

  { id: 'gang', keys: ['space gang', 'gang', 'terrorist*', 'enemy', 'enemies', 'drone*', 'drones', 'bot', 'bots'],
    reply: '👾 THE SPACE GANG\nThe terrorists who captured the town. They wear spacesuits so you can tell them apart from your SWAT soldiers.\n\n• They hold the town, close to the harbor\n• Drones guard the town\n• More of them can arrive by sea at the Harbor Landing, roughly every 60 to 90 seconds\n\nEnemy soldiers, drones and boat reinforcements are being built now, so the island is still quiet for the moment.',
    more: 'Enemies will use the same pathfinding and collision as your soldiers, so they walk around walls and trees instead of through them.',
    chips: ['Tell me more', 'The mission', 'Squad orders'] },

  { id: 'weapons', keys: ['weapon*', 'gun*', 'pistol', 'rifle', 'shotgun', 'ammo', 'grenade*'],
    reply: '🔫 WEAPONS\nYour SWAT soldiers carry the pistol built into their model.\n\nWhen training arrives you will choose a weapon type for each new soldier:\n• Pistol: fast and cheap\n• Rifle: long range\n• Shotgun: hits hard up close\n\nCombat for the player and the enemies is the next big step.',
    chips: ['Training soldiers', 'The Space Gang'] },

  { id: 'cover', keys: ['cover', 'wall*', 'hide', 'sandbag*', 'solid', 'collision', 'trees', 'tree'],
    reply: '🧱 SOLID WORLD\nBuildings, fences, sandbags, barriers, the pier, trees and rocks are all solid. You and your soldiers cannot walk through them, so use them as cover and choke points when the fighting starts.',
    chips: ['Squad orders', 'Give me a tip'] },

  { id: 'settings', keys: ['settings', 'setting', 'quality', 'graphics', 'options', 'resolution'],
    reply: '⚙ SETTINGS\nOn the start screen:\n• Quality: Low, Medium or High. Lower it if the game is slow.\n• Controls: choose your own keys\nYour choices are saved in this browser.',
    chips: ['Change keys', 'Is the game laggy?'] },

  { id: 'performance', keys: ['lag', 'laggy', 'is the game laggy', 'slow', 'fps', 'stutter*', 'performance', 'freeze', 'freezing', 'bug', 'glitch', 'broken', 'not working', 'stuck'],
    reply: '🔧 TROUBLESHOOTING\n• Lower the Quality on the start screen (Medium or Low)\n• Keep fewer soldiers: every character is a detailed 3D model\n• Close browser DevTools: they cut the FPS a lot, especially in phone view\n• On a laptop, plug in the charger and use high-performance power mode\n• Use Chrome or Edge and refresh with Ctrl + Shift + R\n• If the mouse is stuck, press Esc, then press Resume',
    chips: ['Open settings?', 'Controls'] },

  { id: 'pause', keys: ['pause', 'paused', 'quit', 'exit', 'menu', 'resume'],
    reply: '⏸ PAUSE\nPress Esc to pause. From the pause screen click RESUME to go back in. Esc always pauses and cannot be rebound.',
    chips: ['Controls', 'Give me a tip'] },

  { id: 'mobile', keys: ['mobile', 'phone', 'phones', 'android', 'iphone', 'tablet', 'touch'],
    reply: '📱 PHONES\nStrike Command is designed for a keyboard and mouse on PC. Arena Mode and War Mode both work on phones with touch controls.',
    chips: ['Controls', 'The mission'] },

  { id: 'game', keys: ['nova strike', 'nova strike 3d', 'what is nova strike 3d', 'what is nova strike', 'the game', 'this game', 'game modes', 'modes', 'arena', 'war'],
    reply: '🎮 NOVA STRIKE 3D\nTactical AI Combat: a 3D game that runs in your browser. It has:\n• Arena Mode: survive waves of AI drones\n• War Mode: a campaign with a Solo, Duo or Squad team\n• Campaign (Strike Command): this first-person mini RTS, in development\n• Multiplayer: real online players (in development)',
    chips: ['The mission', 'Who made this?'] },

  { id: 'tech', keys: ['how was this made', 'technology', 'tech', 'built with', 'made with', 'three', 'threejs', 'javascript', 'code', 'coding', 'engine', 'models'],
    reply: '🛠 HOW IT IS BUILT\n• Plain HTML, CSS and JavaScript, with no framework\n• Three.js for the 3D graphics\n• Free CC0 3D models and textures, loaded as glTF\n• A* pathfinding and a shared collision system for soldiers and enemies\n• Pointer Lock for mouse look, localStorage for your settings and key choices\n\nEverything used is free.',
    chips: ['How does the AI work?', 'Does it work offline?'] },

  { id: 'ai', keys: ['ai', 'artificial intelligence', 'intelligen*', 'smart', 'brain', 'think*', 'how does the ai work', 'how does ai work'],
    reply: '🧠 THE AI\n• Your soldiers: follow a formation, find their own route with A* pathfinding and obey your orders.\n• Enemies (coming): the same movement system, plus sensing and deciding when to attack.\n• Me: a rule-based assistant that matches your words against a knowledge base, so I work fully offline.',
    chips: ['Squad orders', 'The Space Gang'] },

  { id: 'offline', keys: ['offline', 'internet', 'wifi', 'wi fi', 'connection', 'without internet'],
    reply: '📡 OFFLINE\nI work with no internet at all. The game loads the Three.js library from a free CDN, so the first load needs internet.',
    chips: ['How was this made?'] },

  { id: 'nova', keys: ['nova', 'how does nova work', 'who is nova', 'assistant', 'chatbot', 'chat bot', 'n key'],
    reply: '🤖 ABOUT NOVA\nI am NOVA, the AI assistant of NOVA STRIKE 3D. In Strike Command press N to talk to me.\nI am rule-based: I match your words against a knowledge base (and forgive small typos), so I work offline and answer instantly. No server and no paid API are used, so I am free and private.',
    chips: ['What is NOVA STRIKE 3D?', 'Does it work offline?'] },

  { id: 'creator', keys: ['who made', 'who created', 'who built', 'who developed', 'who designed', 'developer', 'creator', 'author', 'daniyal', 'made by', 'built by'],
    reply: '👨‍💻 CREATOR\nGame Hub and NOVA STRIKE 3D were designed and developed by Daniyal for the AI/IT Expo 2026 at Forte Colleges of Excellence, Sargodha. AI tools (Claude) were used to help write the code, and everything was tested and tuned by him.',
    chips: ['How was this made?', 'What is this project?'] },

  { id: 'expo', keys: ['expo', 'college', 'forte', 'sargodha', 'competition', 'project', 'what is this project', 'what is this'],
    reply: '🎓 THE PROJECT\nGame Hub is an entry for the AI/IT Expo 2026 at Forte Colleges of Excellence, Sargodha. Its flagship, NOVA STRIKE 3D, shows a 3D game with AI-controlled enemies and teammates, phone support and an in-game AI assistant (me!), all built with free, open web technology.',
    chips: ['Who made this?', 'How does the AI work?'] },

  { id: 'whoareyou', keys: ['who are you', 'your name', 'what are you', 'are you ai', 'introduce yourself', 'what can you do', 'help', 'help me'],
    reply: 'I am NOVA, the AI assistant of NOVA STRIKE 3D. 🤖\nAsk me about the mission, squad orders, training, the Space Gang, controls or how to change your keys. In the mission I can also read your live status.',
    chips: DEFAULT_CHIPS },

  { id: 'joke', keys: ['joke', 'funny', 'make me laugh', 'laugh'], reply: () => pick(JOKES), chips: ['Another joke', 'Give me a tip'] },

  { id: 'thanks', keys: ['thanks', 'thank', 'thank you', 'thx', 'shukriya', 'great', 'awesome', 'cool', 'nice'],
    reply: () => pick(['You are welcome, Commander! 🎯', 'Anytime! Now go lead your squad. 💪', 'Happy to help!']), chips: ['Give me a tip'] },

  { id: 'bye', keys: ['bye', 'goodbye', 'see you', 'later', 'cya'], reply: 'Goodbye, Commander! Come back anytime. 👋' },

  { id: 'howareyou', keys: ['how are you', 'how r u', 'whats up', 'sup'],
    reply: () => pick(['All systems online! Ready to help you command.', 'Running smoothly and ready for orders!']), chips: ['Give me a tip', 'Controls'] },

  { id: 'more', keys: ['tell me more', 'more', 'more details', 'elaborate', 'go on', 'continue'], reply: '' },

  { id: 'greet', keys: ['hi', 'hello', 'hey', 'hii', 'hiya', 'yo', 'salam', 'assalam*', 'aoa', 'good morning', 'good evening', 'good afternoon', 'greetings'],
    reply: () => pick(['Hello, Commander! 👋 How can I help?', 'Hey there! Ready for action?', 'Hi! Ask me anything about Strike Command.']),
    chips: DEFAULT_CHIPS }
];

/* =====================================================
   MATCHING ENGINE
   ===================================================== */
function normalize(s) {
  return s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function lev(a, b) {
  const m = a.length, n = b.length, d = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
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
  let best = null, bestScore = 0;
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
      text: pick(['Hmm, I am not sure about that one. 🤔', 'I did not quite get that. 🤔']) +
        '\nI know about the mission, squad orders, training, the Space Gang, controls, settings and how the game was built. Try one of these:',
      chips: DEFAULT_CHIPS.slice(0, 4)
    };
  }
  if (intent.id === 'more') {
    if (lastIntent && lastIntent.more) {
      const out = { text: resolve(lastIntent.more), chips: resolve(lastIntent.chips) };
      lastIntent = Object.assign({}, lastIntent, { more: null });
      return out;
    }
    return { text: 'Ask me about something first, for example the mission or the squad, and then I can tell you more.', chips: DEFAULT_CHIPS.slice(0, 3) };
  }
  lastIntent = intent;
  return { text: resolve(intent.reply), chips: resolve(intent.chips), clear: intent.clear };
}

/* =====================================================
   CHAT UI
   ===================================================== */
let replyToken = 0;
const scrollDown = () => { msgsEl.scrollTop = msgsEl.scrollHeight; };

function addMsg(who, text) {
  const el = document.createElement('div');
  el.className = 'nova-msg ' + who;
  el.textContent = text;
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

function showChips(list) {
  chipsEl.innerHTML = '';
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
  const step = () => {
    i += 2;
    el.textContent = text.slice(0, i);
    scrollDown();
    if (i < text.length) setTimeout(step, 12);
    else if (token === replyToken) showChips(chips);
  };
  step();
}

const WELCOME = 'Hi Commander, I am ' + BOT + ', the AI assistant of NOVA STRIKE 3D. 🤖\nYou are in Strike Command. Ask me about the mission, your squad orders, training, the Space Gang or how to change your keys.';

function welcome() { botSay(WELCOME, DEFAULT_CHIPS, replyToken); }

function send(raw) {
  const text = raw.trim().slice(0, 200);
  if (!text) return;
  addMsg('user', text);
  chipsEl.innerHTML = '';
  const token = ++replyToken;
  const typing = addTyping();
  const result = getReply(text);
  const delay = Math.min(1100, 450 + (result.text || '').length * 2);
  setTimeout(() => {
    typing.remove();
    if (result.clear) { msgsEl.innerHTML = ''; welcome(); return; }
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
   OPEN / CLOSE  (N key)
   ===================================================== */
let isOpen = false;
let welcomed = false;

function openChat() {
  if (isOpen) return;
  isOpen = true;
  panel.classList.add('open');
  badge.style.display = 'none';
  if (document.pointerLockElement) document.exitPointerLock();
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
  if (e.code !== OPEN_CODE || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = ((e.target && e.target.tagName) || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  e.preventDefault();
  if (isOpen) closeChat(); else openChat();
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement && isOpen) closeChat();
});

console.log('[nova] Strike Command assistant ready (press N)');