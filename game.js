'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const W = 800, H = 600;

// ─── State ────────────────────────────────────────────────────────────────────
const S = Object.freeze({ START: 0, PLAYING: 1, GAME_OVER: 2, LEADERBOARD: 3 });
let state = S.START;

// ─── Progress ─────────────────────────────────────────────────────────────────
let score = 0, highScore = 0, lives = 3, level = 1;
let frame = 0, survivalFrames = 0;

// ─── Leaderboard (localStorage) ───────────────────────────────────────────────
const LS_KEY = 'spaceShooterScores_v3';

function loadScores() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch (_) { return []; }
}

function saveScore(name, s, lv, sf) {
  const list = loadScores();
  list.push({
    name: (name || 'ANON').slice(0, 12).toUpperCase(),
    score: s,
    level: lv,
    time:  toTimeStr(sf),
    date:  new Date().toLocaleDateString('zh-TW'),
  });
  list.sort((a, b) => b.score - a.score);
  list.splice(10);
  localStorage.setItem(LS_KEY, JSON.stringify(list));
  return list;
}

function toTimeStr(f) {
  const sec = Math.floor(f / 60);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// ─── Audio ────────────────────────────────────────────────────────────────────
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function beep(freq, dur, type = 'square', vol = 0.1, freqEnd = null) {
  if (!audioCtx) return;
  try {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, audioCtx.currentTime + dur);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur + 0.01);
  } catch (_) {}
}

const sndShoot      = () => beep(900, 0.07, 'square',   0.08, 500);
const sndHit        = () => beep(150, 0.22, 'triangle', 0.20, 60);
const sndExplosion  = () => {
  beep(220, 0.28, 'sawtooth', 0.18, 30);
  setTimeout(() => beep(110, 0.18, 'sawtooth', 0.10, 20), 65);
};
const sndPowerup    = () => [440, 550, 660, 880].forEach((f, i) =>
  setTimeout(() => beep(f, 0.1, 'sine', 0.09), i * 60));
const sndLevelUp    = () => [523, 659, 784, 1047].forEach((f, i) =>
  setTimeout(() => beep(f, 0.13, 'square', 0.09), i * 90));
const sndMonsterHit = () => beep(80, 0.14, 'sawtooth', 0.14, 40);

// ─── Stars ────────────────────────────────────────────────────────────────────
const stars = Array.from({ length: 150 }, () => ({
  x:   Math.random() * W,
  y:   Math.random() * H,
  r:   Math.random() * 1.5 + 0.2,
  spd: Math.random() * 1.2 + 0.2,
  a:   Math.random() * 0.5 + 0.4,
}));

// ─── Input ────────────────────────────────────────────────────────────────────
const keys     = {};
let mouseX     = W / 2, mouseY = H - 80;
let mouseDown  = false;
let useMouse   = true;   // false = keyboard
let inputFocused = false; // true while any text input has focus

// Touch state
let touchActive   = false;
let touchTargetX  = W / 2;
let touchTargetY  = H - 80;

// ─── Player ───────────────────────────────────────────────────────────────────
const PLAYER_SPEED      = 5;
const SHOOT_DELAY_BASE  = 11;
const POWER_DUR         = 480; // 8 sec @ 60fps

const player = {
  x: W / 2, y: H - 80,
  w: 36, h: 36,
  invTimer:    0,
  shootTimer:  0,
  shield:      0,
  rapidFire:   0,
  tripleShot:  0,
};

const shootDelay = () => player.rapidFire > 0 ? 4 : SHOOT_DELAY_BASE;

// ─── Object Arrays ────────────────────────────────────────────────────────────
let bullets      = [];
let enemies      = [];
let enemyBullets = [];
let particles    = [];
let powerups     = [];

// ─── Enemy Definitions ────────────────────────────────────────────────────────
// type 0  Scout         – straight down, fast, 1 HP
// type 1  Fighter       – straight down, 2 HP, shoots
// type 2  Dreadnought   – straight down slow, 5 HP, shoots
// type 3  Space Monster – straight down, HP=level, shoots; crossing bottom → lose life
// type 4  Jellyfish     – left/right + vertical oscillation ±3 cells; homeY drifts down
const EDEFS = [
  { w: 38, h: 20, hp: 1, spd: 2.0, score: 10,  color: '#ff3344', shoot: false              },
  { w: 32, h: 34, hp: 2, spd: 1.4, score: 25,  color: '#ff8800', shoot: true,  sInt: 180   },
  { w: 50, h: 30, hp: 5, spd: 0.8, score: 60,  color: '#bb00ff', shoot: true,  sInt: 130   },
  { w: 54, h: 40, hp: 3, spd: 0.9, score: 120, color: '#ff00aa', shoot: true,  sInt: 90    },
  { w: 50, h: 36, hp: 1, spd: 1.8, score: 80,  color: '#00ddff', shoot: true,  sInt: 110   },
];

let spawnTimer = 0, spawnInterval = 80;
const MAX_MONSTERS  = 1; // max type-3 on screen
const MAX_JELLYFISH = 1; // max type-4 on screen

// ─── Power-up config ──────────────────────────────────────────────────────────
const PW_TYPES   = ['shield', 'rapid', 'triple'];
const PW_COLORS  = { shield: '#00ccff', rapid: '#ff8800', triple: '#00ff88' };
const PW_LABELS  = { shield: '⚡', rapid: '🔥', triple: '✦' };

// ─── Spawn enemy ──────────────────────────────────────────────────────────────
function spawnEnemy() {
  const monCount   = enemies.filter(e => e.type === 3).length;
  const jellyCount = enemies.filter(e => e.type === 4).length;
  const r = Math.random();
  let type = 0;

  if (jellyCount < MAX_JELLYFISH && level >= 2 && r < 0.12)   type = 4; // jellyfish from level 2
  else if (monCount < MAX_MONSTERS && r < 0.18)                type = 3; // space monster
  else if (level >= 3 && r < 0.32)                             type = 2;
  else if (level >= 2 && r < 0.58)                             type = 1;

  const def     = EDEFS[type];
  const spdMult = 1 + (level - 1) * 0.10;

  const e = {
    type,
    x:        rand(def.w / 2 + 4, W - def.w / 2 - 4),
    y:       -def.h / 2,
    w:        def.w, h: def.h,
    hp:       def.hp, maxHp: def.hp,
    spd:      def.spd * spdMult,
    color:    def.color,
    scoreVal: def.score,
    canShoot: !!def.shoot,
    sTimer:   randInt(0, def.sInt || 120),
    sInterval:def.sInt || 120,
    tick:     Math.random() * Math.PI * 2,
    dir:      Math.random() < 0.5 ? 1 : -1,
  };

  if (type === 3) {
    // Space Monster: straight down from top; HP scales with level
    e.hp    = level;
    e.maxHp = level;
  }

  if (type === 4) {
    // Jellyfish: spawns mid-upper area, moves left-right + vertical oscillation
    const startY = rand(60, 130);
    e.y      = startY;
    e.homeY  = startY;           // homeY drifts down slowly
    e.vy     = 0.22 + level * 0.03; // drift speed grows per level
    e.hp     = level;
    e.maxHp  = level;
  }

  enemies.push(e);
}

// ─── Shoot (player) ───────────────────────────────────────────────────────────
function shootBullet() {
  if (player.shootTimer > 0) return;

  const angles = player.tripleShot > 0 ? [-0.22, 0, 0.22] : [0];
  for (const a of angles) {
    bullets.push({
      x: player.x + Math.sin(a) * 8,
      y: player.y - player.h / 2 - 2,
      vx: Math.sin(a) * 4.5,
      vy: -13,
      w: 4, h: 18,
    });
  }
  player.shootTimer = shootDelay();
  sndShoot();
}

// ─── Enemy shoot ──────────────────────────────────────────────────────────────
function enemyShoot(e) {
  const dx = player.x - e.x, dy = player.y - e.y;
  const d  = Math.hypot(dx, dy) || 1;
  const spd = 4 + level * 0.25;
  const spread = 0.1;
  enemyBullets.push({
    x: e.x, y: e.y + e.h / 2,
    vx: (dx / d) * spd + (Math.random() - 0.5) * spread * spd,
    vy: (dy / d) * spd,
    r: 5,
    color: e.type === 3 ? '#ff00cc' : '#ff4400',
  });
}

// ─── Explosion ────────────────────────────────────────────────────────────────
function explode(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i / n) + rand(-0.4, 0.4);
    const s = rand(1.5, 5.5);
    particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, r: rand(2,5), life: randInt(22,52), maxLife:52, color });
  }
}

// ─── Power-up drop ────────────────────────────────────────────────────────────
function maybeDrop(x, y) {
  if (Math.random() > 0.28) return;
  const type = PW_TYPES[randInt(0, 2)];
  powerups.push({ x, y, vy: 1.1, r: 15, type, color: PW_COLORS[type], label: PW_LABELS[type], bob: Math.random() * Math.PI * 2 });
}

function collectPW(p) {
  const key = p.type === 'shield' ? 'shield' : p.type === 'rapid' ? 'rapidFire' : 'tripleShot';
  player[key] = POWER_DUR;
  sndPowerup();
  explode(p.x, p.y, p.color, 10);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function rand(lo, hi) { return Math.random() * (hi - lo) + lo; }
function randInt(lo, hi) { return Math.floor(rand(lo, hi + 1)); }

function aabbHit(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ─── DOM references ───────────────────────────────────────────────────────────
const scoreDom  = document.getElementById('scoreDisplay');
const levelDom  = document.getElementById('levelDisplay');
const livesDom  = document.getElementById('livesDisplay');
const timerDom  = document.getElementById('timerDisplay');
const pwrDom    = document.getElementById('powerupDisplay');

function updateLivesHUD()  { livesDom.textContent = '♥'.repeat(Math.max(0, lives)); }
function updateTimerHUD()  {
  timerDom.textContent = toTimeStr(survivalFrames);
  // Level advances every 30 seconds (1800 frames)
  const nl = Math.floor(survivalFrames / 1800) + 1;
  if (nl > level) { level = nl; levelDom.textContent = nl; sndLevelUp(); }
}
function updatePowerHUD()  {
  const parts = [];
  if (player.shield    > 0) parts.push(`<span class="pw-tag pw-shield">⚡ ${Math.ceil(player.shield/60)}s</span>`);
  if (player.rapidFire > 0) parts.push(`<span class="pw-tag pw-rapid">🔥 ${Math.ceil(player.rapidFire/60)}s</span>`);
  if (player.tripleShot > 0) parts.push(`<span class="pw-tag pw-triple">✦ ${Math.ceil(player.tripleShot/60)}s</span>`);
  pwrDom.innerHTML = parts.join('');
}
function updateScoreHUD()  {
  scoreDom.textContent = score;
}

// ─── Drawing ──────────────────────────────────────────────────────────────────
function drawStars() {
  for (const s of stars) {
    ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(frame * 0.015 + s.x * 0.1));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawShip() {
  if (player.invTimer > 0 && Math.floor(frame / 4) % 2 === 0) return;
  const { x, y } = player;
  ctx.save();
  ctx.translate(x, y);

  // Shield ring
  if (player.shield > 0) {
    const a = Math.min(1, player.shield / 60) * (0.4 + 0.2 * Math.sin(frame * 0.2));
    ctx.strokeStyle = `rgba(0,200,255,${a})`;
    ctx.shadowColor = '#00ccff'; ctx.shadowBlur = 14; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Engine flame
  const flH = 11 + Math.sin(frame * 0.35) * 5;
  const fg = ctx.createLinearGradient(0, 13, 0, 13 + flH);
  fg.addColorStop(0, player.rapidFire > 0 ? 'rgba(255,120,0,.95)' : 'rgba(255,200,40,.95)');
  fg.addColorStop(0.5, 'rgba(255,60,0,.7)');
  fg.addColorStop(1, 'rgba(255,0,0,0)');
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.moveTo(-7,13); ctx.lineTo(7,13); ctx.lineTo(2,13+flH); ctx.lineTo(-2,13+flH); ctx.closePath(); ctx.fill();

  // Wings
  ctx.fillStyle = '#004d88';
  ctx.beginPath(); ctx.moveTo(-12,4); ctx.lineTo(-26,19); ctx.lineTo(-8,12); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(12,4);  ctx.lineTo(26,19);  ctx.lineTo(8,12);  ctx.closePath(); ctx.fill();

  // Hull
  ctx.fillStyle = player.tripleShot > 0 ? '#00bb99' : '#00aadd';
  ctx.beginPath(); ctx.moveTo(0,-18); ctx.lineTo(13,13); ctx.lineTo(5,8); ctx.lineTo(0,15); ctx.lineTo(-5,8); ctx.lineTo(-13,13); ctx.closePath(); ctx.fill();

  // Cockpit
  ctx.shadowColor = '#00ffff'; ctx.shadowBlur = 8;
  ctx.fillStyle = '#88eeff';
  ctx.beginPath(); ctx.ellipse(0, -4, 5, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawScout(e) {
  ctx.fillStyle = e.color;
  ctx.beginPath(); ctx.ellipse(0, 0, 19, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff8899'; ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.ellipse(0, -3, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
}

function drawFighter(e) {
  ctx.fillStyle = e.color;
  ctx.beginPath(); ctx.moveTo(0,-17); ctx.lineTo(16,12); ctx.lineTo(0,7); ctx.lineTo(-16,12); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffaa44'; ctx.shadowBlur = 5;
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
}

function drawDreadnought(e) {
  ctx.fillStyle = e.color;
  ctx.fillRect(-23, -13, 46, 26);
  ctx.fillStyle = '#880099'; ctx.fillRect(-15, -20, 30, 9);
  ctx.fillStyle = '#ee00ff'; ctx.shadowColor = '#ee00ff'; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
}

function drawMonster(e) {
  const pulse = 0.5 + 0.5 * Math.sin(e.tick * 0.12);

  // Aura
  ctx.shadowColor = '#ff00cc'; ctx.shadowBlur = 18 + pulse * 10;

  // Body
  ctx.fillStyle = '#1e0030';
  ctx.beginPath(); ctx.ellipse(0, -2, 27, 19, 0, 0, Math.PI * 2); ctx.fill();

  // Pulsing border
  ctx.strokeStyle = `rgba(255,0,200,${0.3 + 0.4 * pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, -2, 31, 23, 0, 0, Math.PI * 2); ctx.stroke();

  // 3 Eyes
  ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 8;
  [-12, 0, 12].forEach(ex => {
    ctx.fillStyle = '#cc0000';
    ctx.beginPath(); ctx.ellipse(ex, -5, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffff00';
    ctx.beginPath(); ctx.arc(ex + Math.sin(e.tick * 0.05) * 2, -5, 2.2, 0, Math.PI * 2); ctx.fill();
  });

  // Tentacles (4)
  ctx.shadowBlur = 5; ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const tx   = (i - 1.5) * 13;
    const wave = Math.sin(e.tick * 0.1 + i * 1.3) * 9;
    ctx.strokeStyle = `rgba(200, 0, 130, 0.9)`;
    ctx.beginPath(); ctx.moveTo(tx, 16);
    ctx.quadraticCurveTo(tx + wave, 27, tx + wave * 1.4, 38); ctx.stroke();
    ctx.fillStyle = '#ff00aa';
    ctx.beginPath(); ctx.arc(tx + wave * 1.4, 38, 3, 0, Math.PI * 2); ctx.fill();
  }

  // HP bar (below monster, above tentacle tips)
  const ratio = e.hp / e.maxHp;
  const bw = e.w;
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#150020'; ctx.fillRect(-bw/2, 45, bw, 5);
  const hpCol = ratio > 0.5 ? '#ff00cc' : ratio > 0.25 ? '#ff8800' : '#ff2200';
  ctx.fillStyle = hpCol; ctx.shadowColor = hpCol; ctx.shadowBlur = 4;
  ctx.fillRect(-bw/2, 45, bw * ratio, 5);
}

function drawJellyfish(e) {
  const pulse = 0.5 + 0.5 * Math.sin(e.tick * 0.1);

  // Outer aura
  ctx.shadowColor = '#00eeff'; ctx.shadowBlur = 14 + pulse * 8;

  // Translucent dome body
  ctx.fillStyle = `rgba(0, 160, 230, ${0.22 + pulse * 0.14})`;
  ctx.beginPath(); ctx.arc(0, -6, 23, Math.PI, 0, false); ctx.closePath(); ctx.fill();

  // Dome rim
  ctx.strokeStyle = `rgba(0, 230, 255, ${0.55 + pulse * 0.35})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, -6, 23, Math.PI, 0, false); ctx.closePath(); ctx.stroke();

  // Inner shimmer
  ctx.fillStyle = `rgba(140, 240, 255, ${0.08 + pulse * 0.1})`;
  ctx.beginPath(); ctx.arc(0, -10, 14, Math.PI, 0, false); ctx.closePath(); ctx.fill();

  // Bell frills (bottom edge)
  ctx.lineWidth = 1.5;
  for (let i = -3; i <= 3; i++) {
    const bx = i * 6;
    ctx.strokeStyle = `rgba(0, 210, 255, ${0.5 + pulse * 0.3})`;
    ctx.beginPath(); ctx.moveTo(bx, 17); ctx.quadraticCurveTo(bx + 3, 23, bx, 27); ctx.stroke();
  }

  // Tentacles (5)
  for (let i = 0; i < 5; i++) {
    const tx   = (i - 2) * 9;
    const wave = Math.sin(e.tick * 0.08 + i * 0.9) * 10;
    ctx.strokeStyle = `rgba(0, 200, 255, ${0.4 + 0.3 * Math.sin(e.tick * 0.06 + i)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(tx, 27);
    ctx.quadraticCurveTo(tx + wave, 38, tx + wave * 0.8, 50); ctx.stroke();
    ctx.fillStyle = '#00ddff';
    ctx.beginPath(); ctx.arc(tx + wave * 0.8, 50, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  // Eyes (2)
  ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 5;
  [-7, 7].forEach(ex => {
    ctx.fillStyle = 'rgba(200, 245, 255, 0.9)';
    ctx.beginPath(); ctx.arc(ex, -9, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#001a2e';
    ctx.beginPath(); ctx.arc(ex, -9, 1.5, 0, Math.PI * 2); ctx.fill();
  });

  // HP bar
  const ratio = e.hp / e.maxHp;
  const bw = e.w;
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#001520'; ctx.fillRect(-bw/2, -e.h/2 - 9, bw, 4);
  const hc = ratio > 0.5 ? '#00ddff' : ratio > 0.25 ? '#ffaa00' : '#ff2200';
  ctx.fillStyle = hc; ctx.shadowColor = hc; ctx.shadowBlur = 4;
  ctx.fillRect(-bw/2, -e.h/2 - 9, bw * ratio, 4);
}

function drawEnemy(e) {
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.shadowColor = e.color; ctx.shadowBlur = 10;

  if      (e.type === 0) drawScout(e);
  else if (e.type === 1) drawFighter(e);
  else if (e.type === 2) drawDreadnought(e);
  else if (e.type === 3) drawMonster(e);
  else                   drawJellyfish(e);

  // HP bar for multi-hit regular enemies (type 1-2)
  if (e.maxHp > 1 && e.type !== 3 && e.type !== 4) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(-e.w/2, -e.h/2 - 8, e.w, 4);
    const r = e.hp / e.maxHp;
    ctx.fillStyle = r > 0.5 ? '#00ff55' : r > 0.25 ? '#ffaa00' : '#ff2200';
    ctx.fillRect(-e.w/2, -e.h/2 - 8, e.w * r, 4);
  }
  ctx.restore();
}

function drawBullet(b) {
  ctx.save();
  const col = player.tripleShot > 0 ? '#00ff88' : '#00ffff';
  ctx.shadowColor = col; ctx.shadowBlur = 12;
  const g = ctx.createLinearGradient(b.x, b.y - b.h, b.x, b.y);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, col); g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.fillRect(b.x - b.w/2, b.y - b.h, b.w, b.h);
  ctx.restore();
}

function drawEnemyBullet(b) {
  ctx.save();
  ctx.shadowColor = b.color; ctx.shadowBlur = 10;
  ctx.fillStyle = b.color;
  ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.beginPath(); ctx.arc(b.x - b.vx*2, b.y - b.vy*2, b.r * 0.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawParticle(p) {
  ctx.save();
  ctx.globalAlpha = p.life / p.maxLife;
  ctx.shadowColor = p.color; ctx.shadowBlur = 6;
  ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawPowerup(p) {
  ctx.save();
  ctx.translate(p.x, p.y + Math.sin(p.bob + frame * 0.06) * 4);
  ctx.shadowColor = p.color; ctx.shadowBlur = 16;
  ctx.strokeStyle = p.color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.stroke();
  ctx.save(); ctx.rotate(frame * 0.05);
  ctx.strokeStyle = p.color + '66'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, p.r - 4, 0, Math.PI * 2 * 0.7); ctx.stroke();
  ctx.restore();
  ctx.shadowBlur = 0; ctx.fillStyle = p.color;
  ctx.font = `bold ${p.r}px monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(p.label, 0, 1);
  ctx.restore();
}

// ─── Update ───────────────────────────────────────────────────────────────────
function update() {
  frame++;

  for (const s of stars) { s.y += s.spd; if (s.y > H) { s.y = 0; s.x = Math.random() * W; } }

  particles = particles.filter(p => {
    p.x += p.vx; p.y += p.vy; p.vx *= 0.93; p.vy *= 0.93;
    return --p.life > 0;
  });

  if (state !== S.PLAYING) return;

  survivalFrames++;
  updateTimerHUD();

  // ── Player movement ──
  if (touchActive) {
    // Touch: follow finger horizontally, smooth
    player.x += (touchTargetX - player.x) * 0.18;
    player.y += (touchTargetY - player.y) * 0.18;
  } else if (useMouse) {
    player.x += (mouseX - player.x) * 0.18;
    player.y += (mouseY - player.y) * 0.18;
  } else {
    if (keys['ArrowLeft']  || keys['a'] || keys['A']) player.x -= PLAYER_SPEED;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) player.x += PLAYER_SPEED;
    if (keys['ArrowUp']    || keys['w'] || keys['W']) player.y -= PLAYER_SPEED;
    if (keys['ArrowDown']  || keys['s'] || keys['S']) player.y += PLAYER_SPEED;
  }
  player.x = Math.max(player.w/2, Math.min(W - player.w/2, player.x));
  player.y = Math.max(player.h/2, Math.min(H - player.h/2, player.y));

  // Auto-fire while mouse/touch held or space held
  if (mouseDown || touchActive || keys[' ']) shootBullet();
  if (player.shootTimer  > 0) player.shootTimer--;
  if (player.invTimer    > 0) player.invTimer--;
  if (player.shield      > 0) player.shield--;
  if (player.rapidFire   > 0) player.rapidFire--;
  if (player.tripleShot  > 0) player.tripleShot--;
  updatePowerHUD();

  // ── Player bullets ──
  bullets = bullets.filter(b => {
    b.x += b.vx; b.y += b.vy;
    return b.y + b.h > 0 && b.x > -20 && b.x < W + 20;
  });

  // ── Enemy bullets ──
  enemyBullets = enemyBullets.filter(b => {
    b.x += b.vx; b.y += b.vy;
    if (b.y > H + 10 || b.x < -10 || b.x > W + 10) return false;
    if (player.shield === 0 && player.invTimer === 0 &&
        Math.hypot(b.x - player.x, b.y - player.y) < b.r + 14) {
      explode(b.x, b.y, b.color, 6);
      takeDamage();
      return false;
    }
    return true;
  });

  // ── Power-up items ──
  powerups = powerups.filter(p => {
    p.y += p.vy;
    if (p.y > H + 20) return false;
    if (Math.hypot(p.x - player.x, p.y - player.y) < p.r + 22) { collectPW(p); return false; }
    return true;
  });

  // ── Spawn ──
  spawnTimer++;
  if (spawnTimer >= spawnInterval) {
    spawnEnemy();
    spawnTimer    = 0;
    spawnInterval = Math.max(20, 80 - level * 4);
  }

  // ── Enemy movement + collisions ──
  enemies = enemies.filter(e => {
    e.tick++;

    if (e.type === 4) {
      // Jellyfish: left-right bounce + vertical oscillation within ±3 cells (90px)
      e.x += e.dir * e.spd;
      if (e.x + e.w/2 >= W - 4) { e.dir = -1; e.x = W - 4 - e.w/2; }
      if (e.x - e.w/2 <= 4)     { e.dir =  1; e.x = 4 + e.w/2; }
      e.homeY += e.vy;
      e.y = e.homeY + Math.sin(e.tick * 0.04) * 90;
      // When homeY + oscillation amplitude crosses the floor → lose a life
      if (e.homeY + 90 > H) {
        explode(e.x, H - 20, e.color, 24);
        takeDamage();
        return false;
      }
    } else {
      // All others (0,1,2,3): straight down, no horizontal drift
      e.y += e.spd;
      if (e.y > H + e.h) {
        // Space Monster escaping the bottom → lose a life
        if (e.type === 3) { explode(e.x, H - 10, e.color, 18); takeDamage(); }
        return false;
      }
    }

    // Enemy shooting
    if (e.canShoot) {
      e.sTimer++;
      const si = Math.max(35, e.sInterval - level * 5);
      if (e.sTimer >= si) { enemyShoot(e); e.sTimer = 0; }
    }

    // Player collision
    const phx = player.x - 13, phy = player.y - 13;
    const isBoss = (e.type === 3 || e.type === 4);
    if (player.invTimer === 0 &&
        aabbHit(phx, phy, 26, 26, e.x - e.w/2, e.y - e.h/2, e.w, e.h)) {
      explode(e.x, e.y, e.color, isBoss ? 18 : 14);
      if (player.shield > 0) {
        player.shield = 0; sndExplosion();
        if (!isBoss) return false;
      } else {
        takeDamage();
        if (!isBoss) return false;
      }
    }
    return true;
  });

  // ── Bullet ↔ Enemy ──
  outer:
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    const b = bullets[bi];
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      if (b.x > e.x - e.w/2 && b.x < e.x + e.w/2 &&
          b.y - b.h < e.y + e.h/2 && b.y > e.y - e.h/2) {
        e.hp--;
        explode(b.x, b.y, '#ffff88', 5);
        bullets.splice(bi, 1);
        if (e.hp <= 0) {
          score += e.scoreVal * level;
          const isBoss = (e.type === 3 || e.type === 4);
          explode(e.x, e.y, e.color, isBoss ? 32 : 22);
          sndExplosion();
          if (isBoss) sndMonsterHit();
          maybeDrop(e.x, e.y);
          enemies.splice(ei, 1);
          updateScoreHUD();
        } else if (e.type === 3 || e.type === 4) {
          sndMonsterHit();
        }
        continue outer;
      }
    }
  }
}

function takeDamage() {
  lives--;
  player.invTimer = 110;
  sndHit();
  updateLivesHUD();
  if (lives <= 0) {
    explode(player.x, player.y, '#00ccff', 40);
    endGame();
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  ctx.fillStyle = '#000820';
  ctx.fillRect(0, 0, W, H);
  drawStars();

  if (state === S.START) return;

  for (const e of enemies)       drawEnemy(e);
  for (const b of bullets)       drawBullet(b);
  for (const b of enemyBullets)  drawEnemyBullet(b);
  for (const p of powerups)      drawPowerup(p);
  for (const p of particles)     drawParticle(p);
  if (state === S.PLAYING)       drawShip();
}

// ─── Main Loop ────────────────────────────────────────────────────────────────
function loop() { update(); render(); requestAnimationFrame(loop); }

// ─── Game Flow ────────────────────────────────────────────────────────────────
function startGame() {
  score = 0; lives = 3; level = 1; frame = 0; survivalFrames = 0;
  bullets = []; enemies = []; enemyBullets = []; particles = []; powerups = [];
  spawnTimer = 0; spawnInterval = 80;
  player.x = W/2; player.y = H - 80;
  player.invTimer = 0; player.shootTimer = 0;
  player.shield = 0; player.rapidFire = 0; player.tripleShot = 0;

  scoreDom.textContent = '0'; levelDom.textContent = '1'; timerDom.textContent = '0:00';
  pwrDom.innerHTML = ''; updateLivesHUD();

  hideAll(); state = S.PLAYING;
}

function endGame() {
  state = S.GAME_OVER;
  if (score > highScore) highScore = score;
  document.getElementById('goScore').textContent     = score;
  document.getElementById('goHighScore').textContent = highScore;
  document.getElementById('goLevel').textContent     = level;
  document.getElementById('goTime').textContent      = toTimeStr(survivalFrames);

  const savedName = document.getElementById('playerName').value.trim();
  document.getElementById('nameInput').value = savedName;
  document.getElementById('goSaveBtn').disabled = false;
  document.getElementById('goSaveBtn').textContent = '儲 存';

  setTimeout(() => { document.getElementById('gameOverScreen').style.display = 'flex'; }, 700);
}

function showLeaderboard() {
  const list = loadScores();
  const tbody = document.getElementById('lbBody');
  tbody.innerHTML = list.length ? '' :
    '<tr><td colspan="6" style="text-align:center;padding:20px;color:#334">── 尚無紀錄 ──</td></tr>';
  list.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${['🥇','🥈','🥉'][i] || (i+1)}</td><td>${s.name}</td><td>${s.score.toLocaleString()}</td><td>${s.level}</td><td>${s.time}</td><td>${s.date}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('leaderboardScreen').style.display = 'flex';
}

function hideAll() {
  ['startScreen','gameOverScreen','leaderboardScreen'].forEach(id =>
    document.getElementById(id).style.display = 'none');
}

// ─── Touch helpers ────────────────────────────────────────────────────────────
function touchPos(t) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (t.clientX - rect.left) * (W / rect.width),
    y: (t.clientY - rect.top)  * (H / rect.height),
  };
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

// Mouse
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouseX = (e.clientX - r.left) * (W / r.width);
  mouseY = (e.clientY - r.top)  * (H / r.height);
  useMouse = true;
});
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  ensureAudio(); mouseDown = true;
});
canvas.addEventListener('mouseup',      e => { if (e.button === 0) mouseDown = false; });
canvas.addEventListener('contextmenu',  e => e.preventDefault());

// Touch – drag to move, hold = auto-fire, tap = single shot
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  ensureAudio();
  if (state === S.START) { startGame(); return; }
  if (state === S.GAME_OVER) return;

  touchActive = true;
  const pos = touchPos(e.touches[0]);
  touchTargetX = pos.x;
  touchTargetY = pos.y;
  useMouse = false;
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!touchActive) return;
  const pos = touchPos(e.touches[0]);
  touchTargetX = pos.x;
  touchTargetY = pos.y;
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  touchActive = false;
}, { passive: false });

// Keyboard
document.addEventListener('keydown', e => {
  if (inputFocused) return; // let text inputs handle their own keys

  if (keys[e.key]) return;
  keys[e.key] = true;
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','a','s','d','w','A','S','D','W'].includes(e.key)) useMouse = false;
  if ([' ','ArrowUp','ArrowDown'].includes(e.key)) e.preventDefault();
  if (state === S.START)     { ensureAudio(); startGame(); return; }
  if (state === S.GAME_OVER) { ensureAudio(); startGame(); }
});
document.addEventListener('keyup', e => { keys[e.key] = false; });

// Buttons
document.getElementById('startBtn').addEventListener('click', () => { ensureAudio(); startGame(); });
document.getElementById('scoresBtn').addEventListener('click', () => { hideAll(); showLeaderboard(); });

document.getElementById('goSaveBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim() || 'ANON';
  saveScore(name, score, level, survivalFrames);
  const btn = document.getElementById('goSaveBtn');
  btn.disabled = true; btn.textContent = '✓ 已儲存';
});
document.getElementById('goRestartBtn').addEventListener('click', () => { ensureAudio(); startGame(); });
document.getElementById('goScoresBtn').addEventListener('click',  () => { hideAll(); showLeaderboard(); });

document.getElementById('lbBackBtn').addEventListener('click', () => {
  document.getElementById('leaderboardScreen').style.display = 'none';
  if (state === S.GAME_OVER) document.getElementById('gameOverScreen').style.display = 'flex';
  else document.getElementById('startScreen').style.display = 'flex';
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
// Track focus on all name inputs so keydown doesn't interrupt typing
document.querySelectorAll('.name-input').forEach(inp => {
  inp.addEventListener('focus', () => { inputFocused = true; });
  inp.addEventListener('blur',  () => { inputFocused = false; });
});

document.getElementById('startScreen').style.display = 'flex';
loop();
