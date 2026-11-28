/* =====================================================
   NOVA for Strike Command (Campaign) - offline, rule-based   v2
   Separate from games/assistant.js (War / Arena / Hub use that one).
   Press N to open / close (T is "Clear squad" in the Campaign).
   Reads the player's real key choices from keybinds.js.

   v2: answers for the truck, scope, aim assist, weather, settings,
       volume/music, drones, robots, training, tutorial, base guards,
       capture, waves, results, intro, minimap, health, difficulty,
       hit effects, recoil, phones and menu. Live status reads the HUD.
   ===================================================== */


const BOT = 'NOVA';
const OPEN_CODE = 'KeyN';
const PHONE = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);


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
  <div id="nova-hint">${PHONE ? 'Tap ✕ to close' : 'Press N to open / close · Esc to close'}</div>
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


/* reads the visible lines of the game HUD (objective, enemies, squad...) */
function liveLines() {
  const out = [];
  try {
    const seen = new Set();
    const add = (t) => {
      t = (t || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 90 || seen.has(t)) return;
      seen.add(t);
      out.push(t);
    };
    add(txt('hud-info'));
    const hud = document.getElementById('hud');
    if (hud) {
      hud.querySelectorAll('*').forEach((el) => {
        if (el.children.length) return;
        if (!el.getClientRects().length) return;
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/(enem|squad|army|capture|defend|clear|train|supply|health|drone|wave|objective|soldier)/i.test(t)) add(t);
      });
    }
  } catch (e) { /* ignore */ }
  return out.slice(0, 6);
}


const DEFAULT_CHIPS = ['The mission', 'Squad orders', 'Controls', 'Drive the truck', 'Settings'];


/* ---------- answers that read the real keys ---------- */
const mobileText = () =>
  '📱 TOUCH CONTROLS\n' +
  '• Left stick: move (push it far to sprint)\n' +
  '• Drag the right side of the screen: look around\n' +
  '• FIRE, JUMP, RELOAD, SWAP (weapon) and SCOPE buttons\n' +
  '• USE appears when you can do something (Barracks, truck)\n' +
  '• Squad buttons appear once you have soldiers\n' +
  '• Tap the small map to open the full map\n' +
  '• In the truck: the stick drives, JUMP brakes, VIEW changes the camera, GET OUT leaves\n\n' +
  'Landscape works best. The first tap takes the game fullscreen.';


const controlsText = () => {
  if (PHONE) return mobileText();
  return '🎮 CONTROLS (STRIKE COMMAND)\n' +
    '• ' + K('forward', 'W') + ' ' + K('left', 'A') + ' ' + K('back', 'S') + ' ' + K('right', 'D') + ': move\n' +
    '• ' + K('sprint', 'Shift') + ': sprint     • ' + K('jump', 'Space') + ': jump\n' +
    '• Mouse: look around, Left click: fire, R: reload, Mouse wheel: swap weapon\n' +
    '• Right-click: big scope, ' + 'Z / X: scope zoom / fire zoom (Settings can change them)\n' +
    '• ' + K('follow', '1') + ' Follow, ' + K('hold', '2') + ' Hold, ' + K('attack', '3') + ' Attack the town square\n' +
    '• ' + K('interact', 'E') + ': use / train at the Barracks / drive the truck\n' +
    '• V: truck view (while driving)\n' +
    '• ' + K('map', 'M') + ': full map     • K: music on / off\n' +
    '• ' + K('fly', 'F') + ': fly mode (scout), ' + K('descend', 'C') + ': go down\n' +
    '• ' + K('spawn', 'G') + ' / ' + K('clear', 'T') + ': test keys (spawn / clear soldiers)\n' +
    '• Esc: pause     • N: talk to me\n\n' +
    '⌨ Want different keys? Open ⚙ Settings, then Controls.';
};


const squadText = () =>
  '🪖 YOUR SQUAD\nTrain soldiers at the Barracks (up to 12) and give them orders:\n\n' +
  '• ' + K('follow', '1') + ': Follow me (formation behind you)\n• ' + K('hold', '2') + ': Hold this position\n• ' +
  K('attack', '3') + ': Attack, go to the town square\n\n' +
  'They plan routes around buildings, trees and fences, shoot enemies they see, run when you are far away, and teleport back only if they get really lost. You can also carry them in the army truck.';


const trainingText = () => {
  if (PHONE) {
    return '🏕 TRAINING (BARRACKS)\n• Walk to a Barracks in your base\n• Tap the training box that appears\n• A bar fills for a few seconds, then a new soldier walks out\n• Training makes pistol soldiers\n• Supplies grow slowly over time\n• The army is capped at 12';
  }
  return '🏕 TRAINING (BARRACKS)\n' +
    '• Walk to a Barracks in your base (there are two) and press ' + K('interact', 'E') + '\n' +
    '• Each soldier costs supplies, which start at 100 and grow slowly\n' +
    '• A bar fills for about 4 seconds, then the new soldier walks out of the door\n' +
    '• You can queue up to 3 at once\n' +
    '• Training makes pistol soldiers (fast and cheap)\n' +
    '• The army is capped at 12 soldiers\n\n' +
    'Your first trained soldier also unlocks the base gates and the army truck.';
};


const keysText = () =>
  '⌨ KEY CUSTOMIZATION\n1. On the start screen click ⚙ Settings.\n2. Click Controls.\n3. Click the action you want to change and press the new key.\n' +
  'If that key is already used, the two actions swap, so nothing is left without a key. Reset to defaults puts everything back.\n\n' +
  'Your choices are saved in this browser. Esc always pauses and cannot be changed.' +
  (PHONE ? '\n\nKey changing is for keyboards, so phones use touch buttons instead.' : '');


const statusText = () => {
  if (!inMission()) return 'No mission is running. Click ENTER ISLAND and I will read your live status!';
  const lines = liveLines();
  return '📊 LIVE STATUS\n' + (lines.length ? lines.map((l) => '• ' + l).join('\n') : '• Strike Command') +
    '\n\nOrders: ' + K('follow', '1') + ' = Follow, ' + K('hold', '2') + ' = Hold, ' + K('attack', '3') + ' = Attack.';
};


const TIPS = [
  () => 'Press ' + K('follow', '1') + ' to call your squad to you and ' + K('hold', '2') + ' to make them hold position.',
  'Your soldiers walk around buildings, trees and fences. They cannot walk through walls, and neither can you.',
  'The town is south-east of your base, near the harbor. Follow the road from the Main Gate.',
  () => 'Press ' + K('fly', 'F') + ' to toggle fly mode and scout the whole island from above.',
  'Enemy reinforcements arrive by boat at the Harbor Landing during the defend phase, so keep some soldiers near the harbor side.',
  'If the FPS is low, lower the Quality on the start screen and keep fewer soldiers.',
  'You can change every key in ⚙ Settings, then Controls. Choices are saved.',
  'Keep your squad together. Soldiers that fall far behind run to catch up.',
  'Drive the army truck to carry up to 12 soldiers to the town quickly. Anyone you run over will not get up again.',
  'Right-click for the big scope, then press Z to switch between 3x and 6x.',
  'Aim assist is on Medium by default. Turn it up or off in ⚙ Settings.',
  'Drones fly, so check the sky as well as the ground. Robots take more shots to bring down.',
  'Enemies glow red, so you can spot them even in rain and storms.'
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
   (order matters: when two answers score the same, the first one wins)
   ===================================================== */
const INTENTS = [
  { id: 'clear', keys: ['clear chat', 'reset chat', 'clear conversation', 'clear screen'], clear: true, reply: '' },


  { id: 'status', keys: ['my status', 'status', 'how am i doing', 'my stats', 'live status'],
    reply: statusText, chips: ['Give me a tip', 'The mission'] },


  { id: 'tips', keys: ['tip*', 'strateg*', 'advice', 'get better', 'improve', 'trick*'],
    reply: tipText, chips: ['Another tip', 'Squad orders', 'Controls'] },


  /* ----- vehicles ----- */
  { id: 'truck', keys: ['truck*', 'vehicle*', 'driv*', 'car', 'jeep', 'steering', 'roadkill', 'run over', 'army truck', 'handbrake', 'transport'],
    reply: () => PHONE
      ? '🚚 THE ARMY TRUCK\n• It is parked near your spawn in the base, with a blue beacon above it\n• Walk up and tap the prompt to drive it\n• It unlocks after you train your first soldier\n• The left stick drives, JUMP brakes, VIEW switches between cab and outside camera, GET OUT leaves\n• It carries up to 12 soldiers, who are dropped behind it when you get out\n• Running enemies over kills them'
      : '🚚 THE ARMY TRUCK\n• It is parked near your spawn in the base, with a blue beacon above it\n• Walk up and press ' + K('interact', 'E') + ' to get in (you must have trained your first soldier)\n• ' + K('forward', 'W') + ' ' + K('left', 'A') + ' ' + K('back', 'S') + ' ' + K('right', 'D') + ' drive, Space is the handbrake, Shift is boost\n• V switches between the driver seat (steering wheel and hands) and an outside camera\n• Soldiers within 70 m climb in automatically, up to 12, and are dropped behind the truck when you get out\n• Slow down below walking speed to get out\n• Running enemies over kills them\n• Walls, trees and deep water stop it',
    more: 'The truck is built from code with no model file: six wheels, a canvas-covered bed, headlights and a star on the doors. Four collision circles along its length keep it from driving through walls.',
    chips: ['Tell me more', 'Squad orders', 'Settings'] },


  /* ----- scope / aim ----- */
  { id: 'scope', keys: ['scope*', 'zoom*', 'sniper', 'right click', 'big scope', 'fire zoom', 'magnif*', 'optic*'],
    reply: () => PHONE
      ? '🔭 SCOPE\nTap the SCOPE button to look through the big scope. While you shoot, the view zooms in slightly and the gun leans toward the enemy.'
      : '🔭 SCOPE\n• Fire zoom: when you shoot, the view zooms in slightly and the gun leans toward the enemy, then returns with no delay\n• Big scope: right-click to look through it (3x), press Z to switch to 6x and back off\n• X turns the fire zoom on or off\n• You can change these keys or turn them off in ⚙ Settings\n• Look sensitivity slows down while you zoom, for steady aim',
    chips: ['Aim assist', 'Settings', 'Weapons'] },


  { id: 'aimassist', keys: ['aim assist', 'auto aim', 'aim*', 'lock on', 'autoaim'],
    reply: '🎯 AIM ASSIST\nA gentle help that pulls your crosshair toward an enemy when you aim close to one. It has four levels: Off, Low, Medium (default) and High.\n\nChange it in ⚙ Settings. It never fires for you, it only nudges your aim.',
    chips: ['Scope', 'Recoil', 'Settings'] },


  /* ----- world / effects ----- */
  { id: 'weather', keys: ['weather', 'rain*', 'storm*', 'lightning', 'thunder', 'cloud*', 'sunny', 'fog', 'clear sky'],
    reply: '🌦 WEATHER\nThree choices: Clear, Cloudy (default) and Storm.\n• Cloudy: grey sky and a gentle mood\n• Storm: heavy rain, lightning flashes and thunder\n• Clear: bright sun\n\nChange it in ⚙ Settings. Storm looks great but costs a little speed, so choose Clear or Cloudy on a slow device.',
    chips: ['Settings', 'Is the game laggy?'] },


  { id: 'fx', keys: ['blood*', 'hit effect*', 'effects', 'effect', 'glow*', 'outline', 'red outline', 'muzzle*', 'stagger*'],
    reply: '✨ EFFECTS\n• Hits make glowing blood that splashes and fades\n• Enemies stagger when hit and you hear an impact sound\n• Every enemy has a red outline, so you can see them in rain or storm\n• Your gun has a bright muzzle flash and no tracer line, so full auto stays clean\n• The gun is lit by its own fill light, so it stays readable in the dark',
    chips: ['Weather', 'Recoil', 'Weapons'] },


  { id: 'recoil', keys: ['recoil', 'kick', 'gun kick', 'shake'],
    reply: '🔫 RECOIL\nThe recoil is kept very low on purpose, so your aim stays steady even on full auto. The pistol, rifle and shotgun each kick a little differently, the shotgun most.\n\nYou can change the amount in ⚙ Settings under Gun recoil.',
    chips: ['Aim assist', 'Settings', 'Weapons'] },


  { id: 'audio', keys: ['volume*', 'sound*', 'audio', 'loud*', 'quiet', 'mute', 'master', 'sfx', 'music', 'song', 'soundtrack', 'k key'],
    reply: '🔊 SOUND AND MUSIC\n• Master volume and Music volume sliders are in ⚙ Settings (saved on this device)\n• Music on / off switch is there too, or press K any time\n• Wind, sea, gunfire, rain and the truck engine are all made by code\n• The music is made by code and changes with the action\n\nThe menu uses the same saved volume.',
    chips: ['Settings', 'Weather'] },


  { id: 'keys', keys: ['rebind*', 'remap*', 'keybind*', 'key bindings', 'key settings', 'change keys', 'change key', 'change controls', 'custom controls', 'customize*', 'customise*'],
    reply: keysText, chips: ['Controls', 'Settings'] },


  { id: 'settings', keys: ['settings', 'setting', 'quality', 'graphics', 'options', 'resolution'],
    reply: '⚙ SETTINGS\nClick ⚙ Settings on the start screen. It has:\n• Master volume and Music volume\n• Music on / off\n• Aim assist (Off, Low, Medium, High)\n• Gun recoil\n• Weather (Clear, Cloudy, Storm)\n• Scope keys and fire zoom\n• Truck view (first or third person)\n• Controls: choose your own keys\n• Reset, to put everything back\n\nQuality (Low, Medium, High) sits right next to it. Lower it if the game is slow. Everything is saved in this browser.',
    chips: ['Change keys', 'Aim assist', 'Weather'] },


  /* ----- mission flow ----- */
  { id: 'training', keys: ['train*', 'barracks', 'recruit*', 'supplies', 'army', 'queue'],
    reply: trainingText, chips: ['Squad orders', 'Drive the truck', 'The tutorial'] },


  { id: 'squad', keys: ['squad*', 'team', 'teammate*', 'orders', 'order*', 'follow', 'command*', 'soldier*', 'swat'],
    reply: squadText,
    more: 'Squad AI: every soldier follows a formation slot behind you, plans a route with A* pathfinding, avoids bumping into friends, and walks, runs or catches up depending on distance. Only one path search runs per frame for the whole squad, so the game stays smooth.',
    chips: ['Tell me more', 'Training soldiers', 'Drive the truck'] },


  { id: 'capture', keys: ['capture*', 'square', 'town square', 'town hall', 'hold the square'],
    reply: '🏛 CAPTURING THE TOWN\nOnce the town is clear of enemies, stand in the town square (the open area in the middle of town). A bar fills while you hold it for about 12 seconds. If enemies come back in, push them out first.\n\nPress ' + K('attack', '3') + ' to send your squad there.',
    chips: ['Sea waves', 'The mission', 'Squad orders'] },


  { id: 'waves', keys: ['wave*', 'defend', 'defence', 'defense', 'sea attack', 'reinforcement*', 'boat', 'boats', 'harbor landing'],
    reply: '🌊 DEFENDING THE TOWN\nAfter you capture the square you must hold it for about 3 minutes. Three attack waves arrive from the sea, landing at the Harbor Landing about 12, 70 and 125 seconds into the defence. Waves include soldiers, and later ones bring robots.\n\nPlace your squad near the town square and use the buildings as cover.',
    chips: ['Capture the town', 'Results and rank', 'Squad orders'] },


  { id: 'result', keys: ['result*', 'victory', 'rank*', 'gold', 'silver', 'bronze', 'score', 'defeat', 'game over'],
    reply: '🏆 RESULTS\nWhen the mission ends you see a victory or defeat screen with your time, kills and soldiers lost, plus a rank: GOLD, SILVER or BRONZE. A fast win with few soldiers lost gives the best rank.\n\nIf you fall, you can restart and try again.',
    chips: ['Sea waves', 'Give me a tip'] },


  { id: 'intro', keys: ['intro', 'flyover', 'fly over', 'cutscene', 'cinematic', 'opening'],
    reply: '🎬 INTRO\nWhen you start, a short flyover (about 13 seconds) shows the base, the town and the harbor, then you start at your base. It plays once each time the page loads.',
    chips: ['The mission', 'The tutorial'] },


  { id: 'tutorial', keys: ['tutorial', 'guide', 'where do i start', 'how to start', 'first step', 'lock*', 'cant leave', 'cannot leave', 'gates closed', 'beginner*'],
    reply: () => '🧭 THE TUTORIAL\nAt the start a guide leads you along a path to the Barracks. Train your first soldier there (' + (PHONE ? 'tap the training box' : 'press ' + K('interact', 'E')) + '). Until then the base gates stay locked, so you learn the key feature first. After that the whole island opens up, and the army truck unlocks too.',
    chips: ['Training soldiers', 'Drive the truck'] },


  { id: 'guards', keys: ['guard*', 'base guards', 'sentries', 'sentry', 'gate*'],
    reply: '💂 BASE GUARDS\nYour base has real SWAT guards at the posts and outside both gates. They attack anything hostile they see and then return to their posts. They are not part of your army and do not count toward the cap of 12.',
    chips: ['Squad orders', 'The Space Gang'] },


  { id: 'drones', keys: ['drone*'],
    reply: '🚁 DRONES\nSpace Gang drones fly around the town, hunt for targets and shoot. Four of them guard the town at the start. They are airborne, so look up, and they move fast. Rifles are best at long range, the pistol is fine when they come close.',
    chips: ['Robots', 'The Space Gang', 'Weapons'] },


  { id: 'robots', keys: ['robot*', 'mech', 'mechs', 'turret*'],
    reply: '🤖 ROBOTS\nThe Space Gang also uses two walking mechs and four fixed turrets. They take far more shots than a soldier, so focus fire with your squad and use cover. Turrets cannot move, so you can go around them.',
    chips: ['Drones', 'The Space Gang', 'Weapons'] },


  { id: 'gang', keys: ['space gang', 'gang', 'terrorist*', 'enemy', 'enemies', 'humans', 'bad guys'],
    reply: '👾 THE SPACE GANG\nThe terrorists who captured the town. They wear spacesuits, so you can tell them apart from your SWAT soldiers, and each has a red outline.\n\n• Enemy soldiers hold the town and see you from about 50 m\n• 4 drones and 2 robot mechs with 4 turrets guard it too\n• More arrive by sea at the Harbor Landing in three waves after you capture the square\n\nThey use the same pathfinding and collision as your soldiers, so they walk around walls and trees.',
    more: 'Enemy AI is a state machine: idle, chase, attack and retreat, driven by what they can see and hear. Drones and robots have their own behaviour on top of that.',
    chips: ['Tell me more', 'Drones', 'Robots', 'Difficulty'] },


  { id: 'difficulty', keys: ['difficulty', 'easy', 'hard', 'harder', 'easier', 'too hard', 'too easy', 'normal'],
    reply: '⚖ DIFFICULTY\nStrike Command runs on Normal difficulty: enemies see you from about 50 m, shoot back with moderate damage, and take a fair number of shots. Your own soldiers are balanced so they help but cannot win the mission for you.',
    chips: ['Weapons', 'Give me a tip'] },


  { id: 'mission',
    keys: ['mission', 'goal', 'objective', 'how to win', 'win', 'what do i do', 'strike command', 'campaign', 'rts', 'real time strategy', 'island', 'town', 'harbor', 'harbour', 'age of empires', 'base', 'hq'],
    reply: '🏝 STRIKE COMMAND\nA realistic mini RTS played in first person, like Age of Empires seen through your own eyes.\n\n1. Intro flyover\n2. TRAIN: train your first soldier at the Barracks\n3. CLEAR: take your squad into Port Town and defeat the Space Gang\n4. CAPTURE: hold the town square for about 12 seconds\n5. DEFEND: survive 3 attack waves from the sea\n6. RESULT: time, kills, soldiers lost and a rank\n\nAlong the way you can drive the army truck, use the scope and command up to 12 soldiers.',
    more: 'Everything is built from free CC0 assets: Kenney (pines, rocks, houses), Quaternius (characters) and Poly Haven (ground textures). Soldiers use A* pathfinding and a shared collision system, so nobody walks through walls or trees.',
    chips: ['Tell me more', 'Training soldiers', 'The Space Gang', 'Controls'] },


  /* ----- combat ----- */
  { id: 'weapons', keys: ['weapon*', 'gun*', 'pistol', 'rifle', 'shotgun', 'ammo', 'reload*', 'shoot*', 'fire', 'firing', 'headshot*', 'grenade*', 'swap', 'magazine'],
    reply: () => '🔫 WEAPONS\nYou carry three guns:\n• Pistol: accurate, 12 rounds\n• Rifle: automatic, long range, 40 rounds (you start with it)\n• Shotgun: 8 pellets, hits hard up close, 6 shells\n\n' +
      (PHONE ? 'Tap FIRE to shoot, RELOAD to reload and SWAP to change weapon.' : 'Left click to fire, R to reload and the mouse wheel to swap.') +
      ' Headshots do double damage.\n\nYour trained soldiers use the pistol built into their model.',
    chips: ['Scope', 'Recoil', 'Aim assist'] },


  { id: 'health', keys: ['health', 'hp', 'heal*', 'die', 'died', 'dead', 'death', 'respawn', 'restart', 'hurt'],
    reply: '❤ HEALTH\nYour health bar is on the HUD. The screen flashes when you are hit. If it reaches zero you are down and can restart the mission from the screen that appears.\n\nUse walls and buildings as cover, and let your squad take the front.',
    chips: ['Give me a tip', 'Results and rank'] },


  { id: 'minimap', keys: ['minimap', 'mini map', 'map', 'radar', 'full map'],
    reply: () => '🗺 MAP\nThe small map on the screen shows you, your soldiers and the enemies nearby. ' +
      (PHONE ? 'Tap it to open the full map.' : 'Press ' + K('map', 'M') + ' to open the full map of the island.'),
    chips: ['Controls', 'The mission'] },


  { id: 'cover', keys: ['cover', 'wall*', 'hide', 'sandbag*', 'solid', 'collision', 'trees', 'tree'],
    reply: '🧱 SOLID WORLD\nBuildings, fences, sandbags, barriers, the pier, trees and rocks are all solid. You, your soldiers, the enemies and even the truck cannot pass through them, so use them as cover and choke points.',
    chips: ['Squad orders', 'Give me a tip'] },


  { id: 'controls', keys: ['controls', 'control', 'keys', 'keyboard', 'how to play', 'how do i play', 'move*', 'walk*', 'sprint*', 'run'],
    reply: controlsText, chips: ['Change keys', 'Squad orders', 'Give me a tip'] },


  { id: 'performance', keys: ['lag', 'laggy', 'is the game laggy', 'slow', 'fps', 'stutter*', 'performance', 'freeze', 'freezing', 'bug', 'glitch', 'broken', 'not working', 'stuck'],
    reply: '🔧 TROUBLESHOOTING\n• Lower the Quality on the start screen (Medium or Low)\n• Choose Clear or Cloudy weather instead of Storm\n• Keep fewer soldiers: every character is a detailed 3D model\n• Close browser DevTools: they cut the FPS a lot, especially in phone view\n• On a laptop, plug in the charger and use high-performance power mode\n• Use Chrome or Edge and refresh with Ctrl + Shift + R\n• If the mouse is stuck, press Esc, then press Resume\n• Close any second copy of the game: two tabs double the rain sound and halve the speed',
    chips: ['Settings', 'Weather'] },


  { id: 'pause', keys: ['pause', 'paused', 'resume', 'esc', 'escape'],
    reply: '⏸ PAUSE\nPress Esc to pause. From the pause screen click RESUME to go back in. Esc always pauses and cannot be rebound.',
    chips: ['Controls', 'Give me a tip'] },


  { id: 'menu', keys: ['menu', 'main menu', 'back to menu', 'home', 'quit', 'exit', 'leave', 'website'],
    reply: '🏠 LEAVING THE MISSION\nPress Esc to pause. The screen that appears has Back to Menu (the game menu with Campaign, War and Arena) and Home (the website). Your settings stay saved either way.',
    chips: ['Controls', 'What is NOVA STRIKE 3D?'] },


  { id: 'mobile', keys: ['mobile', 'phone', 'phones', 'android', 'iphone', 'tablet', 'touch*', 'joystick', 'fullscreen', 'full screen', 'landscape', 'rotate'],
    reply: () => mobileText() + '\n\nOn iPhone, use Share → Add to Home Screen for a true fullscreen app. Arena and War work on phones as well.',
    chips: ['Controls', 'The mission'] },


  /* ----- the project ----- */
  { id: 'game', keys: ['nova strike', 'nova strike 3d', 'what is nova strike 3d', 'what is nova strike', 'the game', 'this game', 'game modes', 'modes', 'arena', 'war'],
    reply: '🎮 NOVA STRIKE 3D\nA 3D game that runs in your browser, with no download. It has:\n• Arena Mode: survive waves of AI enemies\n• War Mode: missions with a Solo, Duo or Squad team\n• Campaign (Strike Command): this first-person mini RTS\n• Multiplayer: real online players (coming later)\n\nIt works on PC and on phones.',
    chips: ['The mission', 'Who made this?'] },


  { id: 'tech', keys: ['how was this made', 'technology', 'tech', 'built with', 'made with', 'three', 'threejs', 'javascript', 'code', 'coding', 'engine', 'models'],
    reply: '🛠 HOW IT IS BUILT\n• Plain HTML, CSS and JavaScript, with no framework\n• Three.js for the 3D graphics\n• Free CC0 3D models and textures, loaded as glTF\n• A* pathfinding and a shared collision system for soldiers, enemies and the truck\n• Web Audio: the music and most sounds are generated by code\n• Pointer Lock for mouse look, localStorage for your settings and key choices\n\nEverything used is free.',
    chips: ['How does the AI work?', 'Does it work offline?'] },


  { id: 'ai', keys: ['ai', 'artificial intelligence', 'intelligen*', 'smart', 'brain', 'think*', 'how does the ai work', 'how does ai work'],
    reply: '🧠 THE AI\n• Your soldiers: follow a formation, find their own route with A* pathfinding, obey your orders and fight what they see.\n• Enemies: a state machine that senses, chases, attacks and retreats. Drones and robots have their own behaviour.\n• The wave director sends sea attacks during the defend phase.\n• Me: a rule-based assistant that matches your words against a knowledge base, so I work fully offline.',
    chips: ['Squad orders', 'The Space Gang'] },


  { id: 'offline', keys: ['offline', 'internet', 'wifi', 'wi fi', 'connection', 'without internet'],
    reply: '📡 OFFLINE\nI work with no internet at all. The game loads the Three.js library from a free CDN, so the first load needs internet.',
    chips: ['How was this made?'] },


  { id: 'nova', keys: ['nova', 'how does nova work', 'who is nova', 'assistant', 'chatbot', 'chat bot', 'n key'],
    reply: '🤖 ABOUT NOVA\nI am NOVA, the AI assistant of NOVA STRIKE 3D. In Strike Command ' + (PHONE ? 'tap the N badge' : 'press N') + ' to talk to me.\nI am rule-based: I match your words against a knowledge base (and forgive small typos), so I work offline and answer instantly. No server and no paid API are used, so I am free and private.',
    chips: ['What is NOVA STRIKE 3D?', 'Does it work offline?'] },


  { id: 'creator', keys: ['who made', 'who created', 'who built', 'who developed', 'who designed', 'developer', 'creator', 'author', 'daniyal', 'made by', 'built by'],
    reply: '👨‍💻 CREATOR\nGame Hub and NOVA STRIKE 3D were designed and developed by Daniyal for the AI/IT Expo 2026 at Forte Colleges of Excellence, Sargodha. AI tools (Claude) were used to help write the code, and everything was tested and tuned by him.',
    chips: ['How was this made?', 'What is this project?'] },


  { id: 'expo', keys: ['expo', 'college', 'forte', 'sargodha', 'competition', 'project', 'what is this project', 'what is this'],
    reply: '🎓 THE PROJECT\nGame Hub is an entry for the AI/IT Expo 2026 at Forte Colleges of Excellence, Sargodha. Its flagship, NOVA STRIKE 3D, shows a 3D game with AI-controlled enemies and teammates, phone support and an in-game AI assistant (me!), all built with free, open web technology.',
    chips: ['Who made this?', 'How does the AI work?'] },


  { id: 'whoareyou', keys: ['who are you', 'your name', 'what are you', 'are you ai', 'introduce yourself', 'what can you do', 'help', 'help me'],
    reply: 'I am NOVA, the AI assistant of NOVA STRIKE 3D. 🤖\nAsk me about the mission, squad orders, the army truck, the scope, training, the Space Gang, settings, controls or how to change your keys. In the mission I can also read your live status.',
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
        '\nI know about the mission, squad orders, the army truck, the scope, training, the Space Gang, settings, controls and how the game was built. Try one of these:',
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
  const stepSize = text.length > 500 ? 6 : 3;
  let i = 0;
  const step = () => {
    i += stepSize;
    el.textContent = text.slice(0, i);
    scrollDown();
    if (i < text.length) setTimeout(step, 12);
    else if (token === replyToken) showChips(chips);
  };
  step();
}


const WELCOME = 'Hi Commander, I am ' + BOT + ', the AI assistant of NOVA STRIKE 3D. 🤖\nYou are in Strike Command. Ask me about the mission, your squad, the army truck, the scope, training, the Space Gang, settings or how to change your keys.';


function welcome() { botSay(WELCOME, DEFAULT_CHIPS, replyToken); }


function send(raw) {
  const text = raw.trim().slice(0, 200);
  if (!text) return;
  addMsg('user', text);
  chipsEl.innerHTML = '';
  const token = ++replyToken;
  const typing = addTyping();
  const result = getReply(text);
  const delay = Math.min(900, 400 + (result.text || '').length * 1.5);
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


console.log('[nova] v2 ready (press N): truck, scope, aim assist, weather, settings, training, waves, drones, robots, phones');