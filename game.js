'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const W = 800, H = 600;

// ─── Game State ───────────────────────────────────────────────────────────────
const STATE = Object.freeze({ START: 'start', PLAYING: 'playing', GAME_OVER: 'gameover' });
let state = STATE.START;

// ─── Progress ─────────────────────────────────────────────────────────────────
let score     = 0;
let highScore = 0;
let lives     = 3;
let level     = 1;
let frame     = 0;

// ─── Audio (Web Audio API) ────────────────────────────────────────────────────
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function beep(freq, dur, type = 'square', vol = 0.12, freqEnd = null) {
  if (!audioCtx) return;
  try {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, audioCtx.currentTime + dur);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + dur + 0.01);
  } catch (_) {}
}

function sndShoot()     { beep(900, 0.07, 'square',   0.09, 500); }
function sndHit()       { beep(160, 0.22, 'triangle', 0.20, 60); }
function sndExplosion() {
  beep(220, 0.28, 'sawtooth', 0.22, 30);
  setTimeout(() => beep(110, 0.18, 'sawtooth', 0.12, 20), 60);
}
function sndLevelUp() {
  [523, 659, 784, 1047].forEach((f, i) =>
    setTimeout(() => beep(f, 0.14, 'square', 0.10), i * 90));
}

// ─── Stars ────────────────────────────────────────────────────────────────────
const stars = Array.from({ length: 130 }, () => ({
  x:   Math.random() * W,
  y:   Math.random() * H,
  r:   Math.random() * 1.4 + 0.3,
  spd: Math.random() * 1.1 + 0.3,
  a:   Math.random() * 0.5 + 0.4,
}));

// ─── Input ────────────────────────────────────────────────────────────────────
const keys      = {};
let mouseX      = W / 2;
let mouseY      = H - 80;
let mouseDown   = false;
let useMouse    = true;

// ─── Player ───────────────────────────────────────────────────────────────────
const PLAYER_SPEED = 5;
const SHOOT_DELAY  = 11;

const player = {
  x: W / 2,
  y: H - 80,
  w: 36, h: 36,
  invTimer:   0,
  shootTimer: 0,
};

// ─── Object Arrays ────────────────────────────────────────────────────────────
let bullets   = [];
let enemies   = [];
let particles = [];

// ─── Enemy Definitions ────────────────────────────────────────────────────────
const ENEMY_DEFS = [
  { w: 38, h: 20, maxHp: 1, baseSpd: 2.0, scoreVal: 10, color: '#ff3344' }, // Scout
  { w: 32, h: 34, maxHp: 2, baseSpd: 1.4, scoreVal: 25, color: '#ff8800' }, // Fighter
  { w: 50, h: 30, maxHp: 5, baseSpd: 0.8, scoreVal: 60, color: '#bb00ff' }, // Dreadnought
];

let spawnTimer    = 0;
let spawnInterval = 80;

// ─── DOM References ───────────────────────────────────────────────────────────
const scoreDom    = document.getElementById('scoreDisplay');
const levelDom    = document.getElementById('levelDisplay');
const livesDom    = document.getElementById('livesDisplay');
const gameOverDom = document.getElementById('gameOverScreen');
const finalScDom  = document.getElementById('finalScore');
const finalHsDom  = document.getElementById('finalHighScore');
const restartBtn  = document.getElementById('restartBtn');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rand(lo, hi) { return Math.random() * (hi - lo) + lo; }

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx &&
         ay < by + bh && ay + ah > by;
}

function updateLivesHUD() {
  livesDom.textContent = '♥'.repeat(Math.max(0, lives));
}

// ─── Spawn Enemy ──────────────────────────────────────────────────────────────
function spawnEnemy() {
  const maxType = Math.min(2, Math.floor((level - 1) / 2));
  const type    = Math.floor(rand(0, maxType + 0.999));
  const def     = ENEMY_DEFS[type];
  const spd     = def.baseSpd * (1 + (level - 1) * 0.12);

  enemies.push({
    type,
    x:     rand(def.w / 2 + 4, W - def.w / 2 - 4),
    y:    -def.h / 2,
    w:     def.w,
    h:     def.h,
    hp:    def.maxHp,
    maxHp: def.maxHp,
    spd,
    color:    def.color,
    scoreVal: def.scoreVal,
    tick: Math.random() * Math.PI * 2, // phase offset for wobble
  });
}

// ─── Shoot Bullet ─────────────────────────────────────────────────────────────
function shootBullet() {
  if (player.shootTimer > 0) return;
  bullets.push({
    x:   player.x,
    y:   player.y - player.h / 2 - 2,
    w:   4,
    h:   18,
    spd: 13,
  });
  player.shootTimer = SHOOT_DELAY;
  sndShoot();
}

// ─── Explosion Particles ──────────────────────────────────────────────────────
function createExplosion(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i / count) + rand(-0.4, 0.4);
    const spd   = rand(1.5, 5.5);
    particles.push({
      x, y,
      vx:      Math.cos(angle) * spd,
      vy:      Math.sin(angle) * spd,
      r:       rand(2, 5),
      life:    Math.floor(rand(22, 52)),
      maxLife: 52,
      color,
    });
  }
}

// ─── Drawing: Stars ───────────────────────────────────────────────────────────
function drawStars() {
  for (const s of stars) {
    ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(frame * 0.018 + s.x * 0.1));
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ─── Drawing: Player Ship ─────────────────────────────────────────────────────
function drawShip() {
  // Blink when invincible
  if (player.invTimer > 0 && Math.floor(frame / 4) % 2 === 0) return;

  const { x, y } = player;
  ctx.save();
  ctx.translate(x, y);

  // Engine flame (animated height)
  const flH = 12 + Math.sin(frame * 0.35) * 5;
  const fg  = ctx.createLinearGradient(0, 14, 0, 14 + flH);
  fg.addColorStop(0,   'rgba(255, 200,  40, 0.95)');
  fg.addColorStop(0.4, 'rgba(255,  80,   0, 0.75)');
  fg.addColorStop(1,   'rgba(255,   0,   0, 0)');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-7, 13); ctx.lineTo(7, 13);
  ctx.lineTo(2, 13 + flH); ctx.lineTo(-2, 13 + flH);
  ctx.closePath();
  ctx.fill();

  // Wings
  ctx.fillStyle = '#004d88';
  ctx.beginPath();
  ctx.moveTo(-12, 4); ctx.lineTo(-26, 19); ctx.lineTo(-8, 12);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(12, 4); ctx.lineTo(26, 19); ctx.lineTo(8, 12);
  ctx.closePath(); ctx.fill();

  // Hull
  ctx.fillStyle = '#00aadd';
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(13, 13);
  ctx.lineTo(5, 8);
  ctx.lineTo(0, 15);
  ctx.lineTo(-5, 8);
  ctx.lineTo(-13, 13);
  ctx.closePath();
  ctx.fill();

  // Cockpit glow
  ctx.shadowColor = '#00ffff';
  ctx.shadowBlur  = 8;
  ctx.fillStyle   = '#88eeff';
  ctx.beginPath();
  ctx.ellipse(0, -4, 5, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.restore();
}

// ─── Drawing: Enemy ───────────────────────────────────────────────────────────
function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.shadowColor = e.color;
  ctx.shadowBlur  = 10;

  if (e.type === 0) {
    // Scout – classic saucer
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 19, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8899';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(0, -3, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();

  } else if (e.type === 1) {
    // Fighter – delta wing
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.moveTo(0, -17); ctx.lineTo(16, 13); ctx.lineTo(0, 7); ctx.lineTo(-16, 13);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffaa44';
    ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();

  } else {
    // Dreadnought – heavy carrier
    ctx.fillStyle = e.color;
    ctx.fillRect(-23, -13, 46, 26);
    ctx.fillStyle = '#880099';
    ctx.fillRect(-15, -20, 30, 9);
    ctx.fillStyle = '#ee00ff';
    ctx.shadowColor = '#ee00ff';
    ctx.shadowBlur  = 14;
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
  }

  // HP bar for multi-hit enemies
  if (e.maxHp > 1) {
    const bw = e.w, bh = 4;
    ctx.shadowBlur = 0;
    ctx.fillStyle  = '#1a1a2e';
    ctx.fillRect(-bw / 2, -e.h / 2 - 9, bw, bh);
    const ratio = e.hp / e.maxHp;
    ctx.fillStyle = ratio > 0.5 ? '#00ff55' : ratio > 0.25 ? '#ffaa00' : '#ff2200';
    ctx.fillRect(-bw / 2, -e.h / 2 - 9, bw * ratio, bh);
  }

  ctx.restore();
}

// ─── Drawing: Bullet ──────────────────────────────────────────────────────────
function drawBullet(b) {
  ctx.save();
  ctx.shadowColor = '#00ffff';
  ctx.shadowBlur  = 12;
  const g = ctx.createLinearGradient(b.x, b.y - b.h, b.x, b.y);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, '#00ffff');
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fillRect(b.x - b.w / 2, b.y - b.h, b.w, b.h);
  ctx.restore();
}

// ─── Drawing: Particle ────────────────────────────────────────────────────────
function drawParticle(p) {
  ctx.save();
  ctx.globalAlpha = p.life / p.maxLife;
  ctx.shadowColor = p.color;
  ctx.shadowBlur  = 6;
  ctx.fillStyle   = p.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─── Drawing: Start Screen (on canvas) ───────────────────────────────────────
function drawStartScreen() {
  ctx.save();

  // Dim overlay
  ctx.fillStyle = 'rgba(0, 3, 25, 0.72)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  // Title
  ctx.font        = 'bold 54px "Courier New", monospace';
  ctx.shadowColor = '#00ffff';
  ctx.shadowBlur  = 36;
  ctx.fillStyle   = '#00ffff';
  ctx.fillText('SPACE', W / 2, 155);
  ctx.font        = 'bold 54px "Courier New", monospace';
  ctx.fillText('SHOOTER', W / 2, 215);

  // Decorative line
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#003355';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 160, 252); ctx.lineTo(W / 2 + 160, 252);
  ctx.stroke();

  // Controls
  ctx.font      = '15px "Courier New", monospace';
  ctx.fillStyle = '#5588aa';
  ctx.fillText('移動：滑鼠 ／ WASD ／ 方向鍵', W / 2, 290);
  ctx.fillText('射擊：滑鼠左鍵（按住）／ 空白鍵（按住）', W / 2, 318);

  // Enemy guide
  ctx.fillStyle = '#ff3344';
  ctx.fillText('● 紅色偵察機  +10', W / 2 - 80, 370);
  ctx.fillStyle = '#ff8800';
  ctx.fillText('● 橘色戰鬥機  +25', W / 2 + 10, 370);
  ctx.fillStyle = '#bb00ff';
  ctx.fillText('● 紫色巨艦    +60', W / 2 + 100, 395);

  // Blinking start prompt
  if (Math.floor(frame / 28) % 2 === 0) {
    ctx.font        = 'bold 21px "Courier New", monospace';
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur  = 14;
    ctx.fillStyle   = '#00ff88';
    ctx.fillText('── 按任意鍵 或 點擊畫面 開始 ──', W / 2, 454);
  }

  // High score
  if (highScore > 0) {
    ctx.shadowBlur = 0;
    ctx.font       = '15px "Courier New", monospace';
    ctx.fillStyle  = '#ffcc00';
    ctx.fillText(`最高分：${highScore}`, W / 2, 508);
  }

  ctx.restore();
}

// ─── Update ───────────────────────────────────────────────────────────────────
function update() {
  frame++;

  // Stars always scroll
  for (const s of stars) {
    s.y += s.spd;
    if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
  }

  // Particles continue even during game-over (so explosions finish)
  particles = particles.filter(p => {
    p.x  += p.vx; p.y += p.vy;
    p.vx *= 0.93; p.vy *= 0.93;
    return --p.life > 0;
  });

  if (state !== STATE.PLAYING) return;

  // ── Player movement ──
  if (useMouse) {
    player.x += (mouseX - player.x) * 0.18;
    player.y += (mouseY - player.y) * 0.18;
  } else {
    if (keys['ArrowLeft']  || keys['a'] || keys['A']) player.x -= PLAYER_SPEED;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) player.x += PLAYER_SPEED;
    if (keys['ArrowUp']    || keys['w'] || keys['W']) player.y -= PLAYER_SPEED;
    if (keys['ArrowDown']  || keys['s'] || keys['S']) player.y += PLAYER_SPEED;
  }
  player.x = Math.max(player.w / 2, Math.min(W - player.w / 2, player.x));
  player.y = Math.max(player.h / 2, Math.min(H - player.h / 2, player.y));

  // Auto-fire while held
  if (mouseDown || keys[' ']) shootBullet();
  if (player.shootTimer > 0) player.shootTimer--;
  if (player.invTimer    > 0) player.invTimer--;

  // ── Bullets ──
  bullets = bullets.filter(b => {
    b.y -= b.spd;
    return b.y + b.h > 0;
  });

  // ── Spawn enemies ──
  spawnTimer++;
  if (spawnTimer >= spawnInterval) {
    spawnEnemy();
    spawnTimer    = 0;
    spawnInterval = Math.max(25, 80 - level * 5);
  }

  // ── Enemy movement & player collision ──
  enemies = enemies.filter(e => {
    e.y    += e.spd;
    e.tick += 0.05;

    // Fighters weave sideways
    if (e.type === 1) e.x += Math.sin(e.tick) * 0.9;

    if (e.y > H + e.h) return false;

    // Enemy touches player (use slightly reduced hitbox for fairness)
    if (player.invTimer === 0 &&
        rectsOverlap(
          player.x - 13, player.y - 13, 26, 26,
          e.x - e.w / 2, e.y - e.h / 2, e.w, e.h
        )) {
      createExplosion(e.x, e.y, e.color, 14);
      takeDamage();
      return false;
    }

    return true;
  });

  // ── Bullet ↔ Enemy collision ──
  outer:
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      if (rectsOverlap(
            b.x - b.w / 2, b.y - b.h, b.w, b.h,
            e.x - e.w / 2, e.y - e.h / 2, e.w, e.h
          )) {
        e.hp--;
        createExplosion(b.x, b.y, '#ffff88', 5);
        bullets.splice(bi, 1);

        if (e.hp <= 0) {
          score += e.scoreVal * level;
          createExplosion(e.x, e.y, e.color, 24);
          enemies.splice(ei, 1);
          sndExplosion();
          updateScoreHUD();
        }
        continue outer;
      }
    }
  }
}

// ─── Damage / Death ───────────────────────────────────────────────────────────
function takeDamage() {
  lives--;
  player.invTimer = 110;
  sndHit();
  updateLivesHUD();

  if (lives <= 0) {
    createExplosion(player.x, player.y, '#00ccff', 40);
    endGame();
  }
}

// ─── Score + Level HUD ────────────────────────────────────────────────────────
function updateScoreHUD() {
  scoreDom.textContent = score;
  const newLevel = Math.floor(score / 300) + 1;
  if (newLevel > level) {
    level = newLevel;
    levelDom.textContent = level;
    sndLevelUp();
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  // Background
  ctx.fillStyle = '#000820';
  ctx.fillRect(0, 0, W, H);

  drawStars();

  if (state === STATE.START) {
    drawStartScreen();
    return;
  }

  for (const e of enemies)   drawEnemy(e);
  for (const b of bullets)   drawBullet(b);
  for (const p of particles) drawParticle(p);

  if (state === STATE.PLAYING) drawShip();
}

// ─── Game Flow ────────────────────────────────────────────────────────────────
function startGame() {
  score = 0; lives = 3; level = 1; frame = 0;
  bullets = []; enemies = []; particles = [];
  spawnTimer = 0; spawnInterval = 80;

  player.x          = W / 2;
  player.y          = H - 80;
  player.invTimer   = 0;
  player.shootTimer = 0;

  scoreDom.textContent = '0';
  levelDom.textContent = '1';
  updateLivesHUD();

  gameOverDom.style.display = 'none';
  state = STATE.PLAYING;
}

function endGame() {
  state = STATE.GAME_OVER;
  if (score > highScore) highScore = score;
  finalScDom.textContent = score;
  finalHsDom.textContent = highScore;
  // Small delay so the player explosion plays before the overlay appears
  setTimeout(() => { gameOverDom.style.display = 'flex'; }, 600);
}

// ─── Main Loop ────────────────────────────────────────────────────────────────
function loop() {
  update();
  render();
  requestAnimationFrame(loop);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

// Mouse position tracking
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const sx   = W / rect.width;
  const sy   = H / rect.height;
  mouseX = (e.clientX - rect.left) * sx;
  mouseY = (e.clientY - rect.top)  * sy;
  useMouse = true;

  if (state === STATE.START) { ensureAudio(); startGame(); }
});

// Mouse fire
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  ensureAudio();
  mouseDown = true;
  if (state === STATE.START) startGame();
});

canvas.addEventListener('mouseup', e => {
  if (e.button === 0) mouseDown = false;
});

// Prevent right-click menu on canvas
canvas.addEventListener('contextmenu', e => e.preventDefault());

// Keyboard
document.addEventListener('keydown', e => {
  if (keys[e.key]) return; // ignore held-key repeat for non-fire keys
  keys[e.key] = true;

  // Switch to keyboard movement mode when directional key pressed
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','a','s','d','w','A','S','D','W'].includes(e.key)) {
    useMouse = false;
  }

  // Prevent page scroll on space/arrows
  if ([' ', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();

  if (state === STATE.START) { ensureAudio(); startGame(); return; }
  if (state === STATE.GAME_OVER && e.key !== 'Tab') { ensureAudio(); startGame(); return; }
});

document.addEventListener('keyup', e => {
  keys[e.key] = false;
});

// Restart button
restartBtn.addEventListener('click', () => {
  ensureAudio();
  startGame();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
loop();
