/* =====================================================
   TIC TAC TOE vs AI  (Minimax + alpha-beta pruning)
   ===================================================== */

const $ = (id) => document.getElementById(id);
const cells = Array.from(document.querySelectorAll('.cell'));

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],      // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8],      // columns
  [0, 4, 8], [2, 4, 6]                  // diagonals
];

/* =====================================================
   1. STATE
   ===================================================== */
let board = Array(9).fill('');
let human = 'X';
let ai = 'O';
let level = 'hard';                     // 'easy' | 'medium' | 'hard'
let turn = 'X';                         // X always moves first
let gameOver = false;
let gameId = 0;                         // lets us ignore an old AI move after "New Game"
let nodes = 0;                          // positions analysed by the AI

let scores = loadScores();
let soundOn = localStorage.getItem('tttSound') !== 'off';

function loadScores() {
  try {
    const s = JSON.parse(localStorage.getItem('tttScores'));
    if (s && typeof s.player === 'number') return s;
  } catch (e) { /* ignore */ }
  return { player: 0, draw: 0, ai: 0 };
}
function saveScores() {
  localStorage.setItem('tttScores', JSON.stringify(scores));
}

/* =====================================================
   2. SOUND (code-generated)
   ===================================================== */
let audioCtx = null;

function tone(freq, dur, type, vol, delay) {
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
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol || 0.15, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const sndX = () => tone(660, 0.12, 'square', 0.12);
const sndO = () => tone(440, 0.12, 'square', 0.12);
const sndWin = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.18, i * 0.12));
const sndLose = () => [330, 262, 196].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.15, i * 0.2));
const sndDraw = () => { tone(392, 0.2, 'triangle', 0.15); tone(392, 0.25, 'triangle', 0.15, 0.22); };

function updateSoundButton() {
  $('sound-btn').textContent = soundOn ? '🔊' : '🔇';
}

/* =====================================================
   3. GAME RULES
   ===================================================== */
function winnerOf(b) {
  for (const line of LINES) {
    const [a, c, d] = line;
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return { mark: b[a], line };
  }
  return null;
}

function isFull(b) { return b.every((c) => c !== ''); }

function emptyCells(b) {
  const out = [];
  for (let i = 0; i < 9; i++) if (b[i] === '') out.push(i);
  return out;
}

/* =====================================================
   4. THE AI: MINIMAX with ALPHA-BETA PRUNING
   ===================================================== */
// Returns a score for the position:
//   AI wins  = +10 minus depth  (faster wins are better)
//   AI loses = depth minus 10   (slower losses are better)
//   draw     = 0
function minimax(b, depth, aiTurn, alpha, beta) {
  nodes++;
  const w = winnerOf(b);
  if (w) return w.mark === ai ? 10 - depth : depth - 10;
  if (isFull(b)) return 0;

  if (aiTurn) {
    let best = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (b[i] !== '') continue;
      b[i] = ai;
      best = Math.max(best, minimax(b, depth + 1, false, alpha, beta));
      b[i] = '';
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;                 // pruning: this branch cannot matter
    }
    return best;
  }

  let best = Infinity;
  for (let i = 0; i < 9; i++) {
    if (b[i] !== '') continue;
    b[i] = human;
    best = Math.min(best, minimax(b, depth + 1, true, alpha, beta));
    b[i] = '';
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

// Tries every possible move and keeps the best one(s).
function bestMove() {
  nodes = 0;
  let bestScore = -Infinity;
  let moves = [];
  for (const i of emptyCells(board)) {
    board[i] = ai;
    const score = minimax(board, 1, false, -Infinity, Infinity);
    board[i] = '';
    if (score > bestScore) { bestScore = score; moves = [i]; }
    else if (score === bestScore) moves.push(i);
  }
  return moves[Math.floor(Math.random() * moves.length)];   // random among equal moves = variety
}

function randomMove() {
  const free = emptyCells(board);
  return free[Math.floor(Math.random() * free.length)];
}

function chooseAIMove() {
  const start = performance.now();
  let move;
  let note;

  if (level === 'easy') {
    move = randomMove();
    note = '🎲 Easy AI picked a random cell. No planning at all.';
  } else if (level === 'medium') {
    if (Math.random() < 0.6) {
      move = bestMove();
      note = '🧠 Medium AI played smart this time (analysed ' + nodes.toLocaleString() + ' positions).';
    } else {
      move = randomMove();
      note = '🎲 Medium AI made a careless random move.';
    }
  } else {
    move = bestMove();
    const ms = Math.max(0.1, performance.now() - start).toFixed(1);
    note = '🧠 Minimax analysed ' + nodes.toLocaleString() + ' positions in ' + ms + ' ms and chose cell ' + (move + 1) + '.';
  }
  return { move, note };
}

/* =====================================================
   5. DRAWING THE BOARD
   ===================================================== */
function render(lastIndex, winLine) {
  cells.forEach((cell, i) => {
    const mark = board[i];
    cell.textContent = mark;
    cell.classList.toggle('x', mark === 'X');
    cell.classList.toggle('o', mark === 'O');
    cell.classList.toggle('last', i === lastIndex && !winLine);
    cell.classList.toggle('win', !!winLine && winLine.includes(i));
  });
}

function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

function updateScores() {
  $('score-player').textContent = scores.player;
  $('score-draw').textContent = scores.draw;
  $('score-ai').textContent = scores.ai;
  $('you-mark').textContent = human;
  $('ai-mark').textContent = ai;
}

function lockBoard(on) { $('board').classList.toggle('locked', on); }

/* =====================================================
   6. GAME FLOW
   ===================================================== */
function newGame() {
  gameId++;
  board = Array(9).fill('');
  turn = 'X';
  gameOver = false;
  render(-1, null);
  updateScores();

  if (human === 'X') {
    lockBoard(false);
    setStatus('Your turn (' + human + ')');
    $('ai-info').textContent = '🧠 AI brain: waiting for your move...';
  } else {
    lockBoard(true);
    setStatus('AI is thinking...');
    $('ai-info').textContent = '🧠 AI brain: I move first this time...';
    scheduleAI();
  }
}

function placeMark(i, mark) {
  board[i] = mark;
  if (mark === 'X') sndX(); else sndO();

  const w = winnerOf(board);
  if (w) {
    render(i, w.line);
    finish(w.mark === human ? 'win' : 'lose');
    return;
  }
  if (isFull(board)) {
    render(i, null);
    finish('draw');
    return;
  }
  render(i, null);
  turn = mark === 'X' ? 'O' : 'X';
}

function finish(result) {
  gameOver = true;
  lockBoard(true);
  if (result === 'win') {
    scores.player++;
    setStatus('You win! 🎉', 'win');
    sndWin();
    if (level === 'hard') $('ai-info').textContent = '🧠 That should be impossible... check the code! 😅';
  } else if (result === 'lose') {
    scores.ai++;
    setStatus('AI wins! 🤖', 'lose');
    sndLose();
  } else {
    scores.draw++;
    setStatus("It's a draw!", 'draw');
    sndDraw();
  }
  saveScores();
  updateScores();
}

function scheduleAI() {
  const myGame = gameId;
  setTimeout(() => {
    if (myGame !== gameId || gameOver) return;       // game was reset meanwhile
    const { move, note } = chooseAIMove();
    $('ai-info').textContent = note;
    placeMark(move, ai);
    if (!gameOver) {
      lockBoard(false);
      setStatus('Your turn (' + human + ')');
    }
  }, 500);
}

function humanMove(i) {
  if (gameOver || turn !== human || board[i] !== '') return;
  placeMark(i, human);
  if (!gameOver) {
    lockBoard(true);
    setStatus('AI is thinking...');
    scheduleAI();
  }
}

/* =====================================================
   7. BUTTONS
   ===================================================== */
cells.forEach((cell) => {
  cell.addEventListener('click', () => humanMove(parseInt(cell.dataset.i, 10)));
});

$('new-btn').addEventListener('click', newGame);

$('reset-btn').addEventListener('click', () => {
  scores = { player: 0, draw: 0, ai: 0 };
  saveScores();
  updateScores();
});

$('sound-btn').addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('tttSound', soundOn ? 'on' : 'off');
  updateSoundButton();
  if (soundOn) sndX();
});

document.querySelectorAll('#level-group button').forEach((btn) => {
  btn.addEventListener('click', () => {
    level = btn.dataset.level;
    document.querySelectorAll('#level-group button').forEach((b) => b.classList.toggle('active', b === btn));
    newGame();
  });
});

document.querySelectorAll('#side-group button').forEach((btn) => {
  btn.addEventListener('click', () => {
    human = btn.dataset.side;
    ai = human === 'X' ? 'O' : 'X';
    document.querySelectorAll('#side-group button').forEach((b) => b.classList.toggle('active', b === btn));
    newGame();
  });
});

/* =====================================================
   8. START UP
   ===================================================== */
updateSoundButton();
newGame();