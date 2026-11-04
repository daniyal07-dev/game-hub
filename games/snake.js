/* =====================================================
   NEON SNAKE  (with BFS AI autopilot)
   ===================================================== */

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

const N = 22;                                   // grid is N x N
const CELL = canvas.width / N;                  // pixel size of one cell
const SPEEDS = { slow: 140, normal: 100, fast: 65 };   // ms per move
const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

/* =====================================================
   1. STATE
   ===================================================== */
let state = 'ready';                            // 'ready' | 'running' | 'paused' | 'over'
let mode = 'walls';                             // 'walls' | 'wrap'
let speed = 'normal';
let aiOn = false;

let snake = [];
let dir = DIRS.right;
let queue = [];                                 // buffered key presses (max 2)
let food = null;
let score = 0;
let particles = [];

let aiNodes = 0;                                // cells explored by BFS this move
let lastAiNote = '';

let bests = loadBests();
let soundOn = localStorage.getItem('snakeSound') !== 'off';

function loadBests() {
  try {
    const b = JSON.parse(localStorage.getItem('snakeBests'));
    if (b && typeof b === 'object') return b;
  } catch (e) { /* ignore */ }
  return {};
}
function bestKey() { return (aiOn ? 'ai-' : '') + mode + '-' + speed; }
function getBest() { return bests[bestKey()] || 0; }

/* =====================================================
   2. SOUND (code-generated)
   ===================================================== */
let audioCtx = null;

function tone(freq, dur, type, vol, slideTo, delay) {
  if (!soundOn) return;
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime + (delay || 0);
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol || 0.15, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const sndEat = () => { tone(520, 0.08, 'square', 0.12); tone(780, 0.1, 'square', 0.12, null, 0.07); };
const sndDie = () => [330, 262, 196, 130].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.15, f * 0.8, i * 0.15));
const sndWin = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.18, null, i * 0.12));
const sndClick = () => tone(440, 0.05, 'square', 0.08);

function updateSoundButton() { $('sound-btn').textContent = soundOn ? '🔊' : '🔇'; }

/* =====================================================
   3. GAME SETUP
   ===================================================== */
function spawnFood() {
  const taken = new Set(snake.map((s) => s.y * N + s.x));
  const free = [];
  for (let i = 0; i < N * N; i++) if (!taken.has(i)) free.push(i);
  if (free.length === 0) return null;
  const k = free[Math.floor(Math.random() * free.length)];
  return { x: k % N, y: Math.floor(k / N) };
}

function updateHUD() {
  $('score').textContent = score;
  $('best').textContent = getBest();
  $('length').textContent = snake.length;
}

function reset() {
  const c = Math.floor(N / 2);
  snake = [{ x: c, y: c }, { x: c - 1, y: c }, { x: c - 2, y: c }];
  dir = DIRS.right;
  queue = [];
  score = 0;
  particles = [];
  food = spawnFood();
  state = 'ready';
  lastAiNote = '';
  updateHUD();
  updateInfo();
  showOverlay('READY?', aiOn ? 'Press START and watch the AI play!' : 'Arrow keys or WASD to steer\nSpace pauses', '▶ START', false);
}

function updateInfo() {
  if (aiOn) {
    if (!lastAiNote) $('ai-info').textContent = '🤖 AI Autopilot is ON. Press START and watch it think!';
  } else {
    $('ai-info').textContent = '🎮 You are in control. Turn on AI Autopilot to watch the AI play!';
  }
}

/* =====================================================
   4. OVERLAY + STATE CHANGES
   ===================================================== */
function showOverlay(title, sub, btnText, isOver) {
  $('overlay-title').textContent = title;
  $('overlay-title').classList.toggle('over', !!isOver);
  $('overlay-sub').textContent = sub;
  $('start-btn').textContent = btnText;
  $('overlay').classList.remove('hidden');
}
function hideOverlay() { $('overlay').classList.add('hidden'); }

function startGame() {
  if (state === 'over') reset();
  state = 'running';
  hideOverlay();
}

function togglePause() {
  if (state === 'running') {
    state = 'paused';
    showOverlay('PAUSED', 'Press Space to resume', '▶ RESUME', false);
  } else if (state === 'paused') {
    state = 'running';
    hideOverlay();
  }
}

function primaryAction() {
  sndClick();
  if (state === 'paused') togglePause();
  else startGame();
}

function finishGame(won) {
  state = 'over';
  const k = bestKey();
  const isBest = score > (bests[k] || 0);
  if (isBest) {
    bests[k] = score;
    localStorage.setItem('snakeBests', JSON.stringify(bests));
  }
  updateHUD();
  const h = snake[0];
  burst(h.x, h.y, won ? '#3dff9a' : '#ff2d95', 30);
  if (won) sndWin(); else sndDie();

  const who = aiOn ? 'AI score' : 'Score';
  showOverlay(
    won ? 'YOU WIN!' : 'GAME OVER',
    who + ': ' + score + '\nBest: ' + getBest() + (isBest && score > 0 ? '  🏆 NEW BEST!' : ''),
    '↻ PLAY AGAIN',
    !won
  );
}

/* =====================================================
   5. INPUT
   ===================================================== */
function queueDir(d) {
  const last = queue.length ? queue[queue.length - 1] : dir;
  if (d.x === last.x && d.y === last.y) return false;        // same direction
  if (d.x === -last.x && d.y === -last.y) return false;      // cannot reverse
  if (queue.length >= 2) return false;
  queue.push(d);
  return true;
}

function input(name) {
  if (aiOn) return;
  if (state !== 'ready' && state !== 'running') return;
  const accepted = queueDir(DIRS[name]);
  if (accepted && state === 'ready') startGame();
}

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right'
};

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space' || e.code === 'KeyP') {
    e.preventDefault();
    if (e.repeat) return;
    if (state === 'running' || state === 'paused') togglePause();
    else primaryAction();
    return;
  }
  const d = KEYMAP[e.code];
  if (d) {
    e.preventDefault();
    input(d);
  }
});

// swipe on phones
let touchStart = null;
$('stage').addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });
$('stage').addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
  if (Math.abs(dx) > Math.abs(dy)) input(dx > 0 ? 'right' : 'left');
  else input(dy > 0 ? 'down' : 'up');
}, { passive: true });

// on-screen D-pad
document.querySelectorAll('#pad button').forEach((b) => {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    input(b.dataset.dir);
  });
});

// pause automatically if the player switches tab or window
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'running') togglePause();
});
window.addEventListener('blur', () => {
  if (state === 'running') togglePause();
});

/* =====================================================
   6. AI AUTOPILOT: BFS PATHFINDING
   ===================================================== */
const keyOf = (c) => c.y * N + c.x;
const cellOf = (k) => ({ x: k % N, y: Math.floor(k / N) });

function neighbors(c) {
  const out = [];
  for (const name in DIRS) {
    let nx = c.x + DIRS[name].x;
    let ny = c.y + DIRS[name].y;
    if (mode === 'wrap') {
      nx = (nx + N) % N;
      ny = (ny + N) % N;
    } else if (nx < 0 || ny < 0 || nx >= N || ny >= N) {
      continue;
    }
    out.push({ x: nx, y: ny });
  }
  return out;
}

function blockedSet(cells) {
  const s = new Set();
  for (const c of cells) s.add(keyOf(c));
  return s;
}

// Breadth-first search: spreads outwards one step at a time,
// so the first time it reaches the goal is the SHORTEST path.
function bfs(from, to, blocked) {
  const startK = keyOf(from);
  const goalK = keyOf(to);
  const prev = new Map();
  prev.set(startK, null);
  const q = [from];
  let qi = 0;

  while (qi < q.length) {
    const c = q[qi++];
    aiNodes++;
    if (keyOf(c) === goalK) break;
    for (const n of neighbors(c)) {
      const k = keyOf(n);
      if (prev.has(k)) continue;
      if (blocked.has(k) && k !== goalK) continue;
      prev.set(k, keyOf(c));
      q.push(n);
    }
  }
  if (!prev.has(goalK)) return null;

  const path = [];
  let k = goalK;
  while (k !== startK) {
    path.push(cellOf(k));
    k = prev.get(k);
  }
  return path.reverse();
}

// how many free cells can be reached from here?
function floodCount(from, blocked) {
  const seen = new Set([keyOf(from)]);
  const q = [from];
  let qi = 0;
  while (qi < q.length) {
    const c = q[qi++];
    aiNodes++;
    for (const n of neighbors(c)) {
      const k = keyOf(n);
      if (seen.has(k) || blocked.has(k)) continue;
      seen.add(k);
      q.push(n);
    }
  }
  return seen.size;
}

// Safety check: pretend the snake follows the path and eats the food.
// Can its head still reach its own tail afterwards? If yes, it is not trapping itself.
function isSafeAfter(path) {
  const virtual = path.slice().reverse().concat(snake).slice(0, snake.length + 1);
  const vHead = virtual[0];
  const vTail = virtual[virtual.length - 1];
  const blocked = blockedSet(virtual.slice(0, -1));
  return bfs(vHead, vTail, blocked) !== null;
}

function dirTo(from, to) {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (dx > 1) dx = -1;
  if (dx < -1) dx = 1;
  if (dy > 1) dy = -1;
  if (dy < -1) dy = 1;
  return { x: dx, y: dy };
}

function aiChooseDir() {
  aiNodes = 0;
  const head = snake[0];
  const tail = snake[snake.length - 1];
  const blocked = blockedSet(snake.slice(0, -1));      // the tail will move away, so it is free

  // PLAN A: shortest path to the food, if it is safe
  if (food) {
    const path = bfs(head, food, blocked);
    if (path && path.length > 0 && isSafeAfter(path)) {
      setAiNote('🤖 BFS explored ' + aiNodes + ' cells and found a safe path of ' + path.length + ' steps to the food.');
      return dirTo(head, path[0]);
    }
  }

  // PLAN B: no safe path to food, so follow the tail (always leaves room)
  const tp = bfs(head, tail, blocked);
  if (tp && tp.length > 0) {
    setAiNote('🌀 No safe path to the food. Following my own tail until a path opens up.');
    return dirTo(head, tp[0]);
  }

  // PLAN C: pick the neighbour with the most open space
  let bestDir = dir;
  let bestSpace = -1;
  for (const n of neighbors(head)) {
    if (blocked.has(keyOf(n))) continue;
    const b2 = new Set(blocked);
    b2.add(keyOf(n));
    const space = floodCount(n, b2);
    if (space > bestSpace) { bestSpace = space; bestDir = dirTo(head, n); }
  }
  setAiNote('🆘 Tight spot! Choosing the move with the most open space (' + Math.max(bestSpace, 0) + ' cells).');
  return bestDir;
}

function setAiNote(text) {
  if (text !== lastAiNote) {
    lastAiNote = text;
    $('ai-info').textContent = text;
  }
}

/* =====================================================
   7. GAME STEP
   ===================================================== */
function tick() {
  if (aiOn) {
    dir = aiChooseDir();
    queue.length = 0;
  } else if (queue.length) {
    dir = queue.shift();
  }

  const head = snake[0];
  let nx = head.x + dir.x;
  let ny = head.y + dir.y;

  if (mode === 'wrap') {
    nx = (nx + N) % N;
    ny = (ny + N) % N;
  } else if (nx < 0 || ny < 0 || nx >= N || ny >= N) {
    finishGame(false);
    return;
  }

  // hitting yourself (the tail cell is free because it moves away)
  for (let i = 0; i < snake.length - 1; i++) {
    if (snake[i].x === nx && snake[i].y === ny) {
      finishGame(false);
      return;
    }
  }

  snake.unshift({ x: nx, y: ny });

  if (food && nx === food.x && ny === food.y) {
    score += 10;
    sndEat();
    burst(nx, ny, '#ff2d95', 14);
    food = spawnFood();
    updateHUD();
    if (!food) { finishGame(true); return; }
  } else {
    snake.pop();
  }
  updateHUD();
}

/* =====================================================
   8. PARTICLES + DRAWING
   ===================================================== */
function burst(cx, cy, color, count) {
  const px = cx * CELL + CELL / 2;
  const py = cy * CELL + CELL / 2;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 40 + Math.random() * 140;
    particles.push({ x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6, max: 0.6, color });
  }
}

function updateParticles(dt) {
  const s = dt / 1000;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= s;
    p.x += p.vx * s;
    p.y += p.vy * s;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw(ts) {
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#070716';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // faint grid
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < N; i++) {
    ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, canvas.height);
    ctx.moveTo(0, i * CELL); ctx.lineTo(canvas.width, i * CELL);
  }
  ctx.stroke();

  // food (pulsing)
  if (food) {
    const r = CELL * 0.32 + Math.sin(ts / 150) * 1.8;
    ctx.shadowColor = '#ff2d95';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ff2d95';
    ctx.beginPath();
    ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // snake (tail to head so the head is drawn on top)
  const len = snake.length;
  for (let i = len - 1; i >= 0; i--) {
    const s = snake[i];
    const t = i / Math.max(1, len - 1);                       // 0 at head, 1 at tail
    const hue = aiOn ? 320 - t * 50 : 150 + t * 35;           // AI = pink/purple, you = green/cyan
    const col = 'hsl(' + hue + ', 100%, ' + (i === 0 ? 62 : 52 - t * 10) + '%)';
    ctx.shadowColor = col;
    ctx.shadowBlur = i === 0 ? 16 : 9;
    ctx.fillStyle = col;
    const pad = i === 0 ? 1 : 2;
    roundRect(s.x * CELL + pad, s.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 6);
    ctx.fill();
  }

  // eyes
  if (len > 0) {
    const h = snake[0];
    const cx = h.x * CELL + CELL / 2;
    const cy = h.y * CELL + CELL / 2;
    const px = -dir.y, py = dir.x;                            // sideways direction
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + dir.x * 3 + px * side * 4, cy + dir.y * 3 + py * side * 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#0a0a1a';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + dir.x * 4 + px * side * 4, cy + dir.y * 4 + py * side * 4, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // particles
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

/* =====================================================
   9. MAIN LOOP (fixed time steps, smooth on any screen)
   ===================================================== */
let lastTs = performance.now();
let acc = 0;

function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(ts - lastTs, 100);
  lastTs = ts;

  if (state === 'running') {
    acc += dt;
    const step = SPEEDS[speed];
    while (acc >= step) {
      acc -= step;
      tick();
      if (state !== 'running') break;
    }
  } else {
    acc = 0;
  }

  updateParticles(dt);
  draw(ts);
}

/* =====================================================
   10. BUTTONS
   ===================================================== */
$('start-btn').addEventListener('click', primaryAction);

$('pause-btn').addEventListener('click', () => {
  if (state === 'running' || state === 'paused') togglePause();
});

$('restart-btn').addEventListener('click', () => {
  reset();
  startGame();
});

$('sound-btn').addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('snakeSound', soundOn ? 'on' : 'off');
  updateSoundButton();
  if (soundOn) sndClick();
});

document.querySelectorAll('#mode-group button').forEach((btn) => {
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    document.querySelectorAll('#mode-group button').forEach((b) => b.classList.toggle('active', b === btn));
    $('stage').classList.toggle('wrap-mode', mode === 'wrap');
    reset();
  });
});

document.querySelectorAll('#speed-group button').forEach((btn) => {
  btn.addEventListener('click', () => {
    speed = btn.dataset.speed;
    document.querySelectorAll('#speed-group button').forEach((b) => b.classList.toggle('active', b === btn));
    reset();
  });
});

$('ai-btn').addEventListener('click', () => {
  aiOn = !aiOn;
  $('ai-btn').classList.toggle('active', aiOn);
  $('ai-btn').textContent = '🤖 AI Autopilot: ' + (aiOn ? 'ON' : 'OFF');
  reset();
});

// release focus after a click so Space never "presses" a button twice
document.querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => b.blur());
});

/* =====================================================
   11. START UP
   ===================================================== */
updateSoundButton();
reset();
requestAnimationFrame(frame);