// ══════════════════════════════════════════════════
// Desktop Wizard — Web App Engine
// ══════════════════════════════════════════════════
// Extracted from Electron buddy.html.
// All IPC calls replaced with browser-native equivalents.
// ══════════════════════════════════════════════════

// ── DOM References ──
const canvas = document.getElementById('wizard-sprite');
const ctx = canvas.getContext('2d');
const weatherCanvas = document.getElementById('weather-canvas');
const wCtx = weatherCanvas.getContext('2d');
const speechBubble = document.getElementById('speech-bubble');
const glowRing = document.getElementById('glow-ring');
const stateLabel = document.getElementById('state-label');
const wizardViewport = document.querySelector('.wizard-viewport');

// ── Configuration (replaces IPC getConfig) ──
const DEFAULT_CONFIG = {
  wizardScale: 2,
  weatherMode: 'none',
  weatherIntensity: 0.6,
  apiKey: '',
  apiProvider: 'openai'
};

function loadConfig() {
  try {
    const saved = localStorage.getItem('wizard-config');
    return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : { ...DEFAULT_CONFIG };
  } catch { return { ...DEFAULT_CONFIG }; }
}

function saveConfig(cfg) {
  try { localStorage.setItem('wizard-config', JSON.stringify(cfg)); } catch {}
}

let config = loadConfig();

// ══════════════════════════════════════════════════
// SPRITE SHEET LAYOUT
// ══════════════════════════════════════════════════

const DEFAULT_MANIFEST = {
  spriteSheet: 'wizard_spritesheet.png',
  layout: { type: 'grid', columns: 4, rows: 3 },
  states: {
    idle:        { frames: [0], fps: 1 },
    talking:     { frames: [1, 2, 3, 4], fps: 6 },
    reading:     { frames: [5], fps: 1 },
    sleeping:    { frames: [6], fps: 0.5 },
    laughing:    { frames: [7], fps: 2 },
    sad:         { frames: [8], fps: 1 },
    researching: { frames: [9], fps: 2 }
  },
  frames: {
    0: { grid: [0, 0] },
    1: { grid: [1, 0] },
    2: { grid: [2, 0] },
    3: { grid: [3, 0] },
    4: { grid: [0, 1] },
    5: { grid: [2, 1] },
    6: { grid: [3, 1] },
    7: { grid: [0, 2] },
    8: { grid: [2, 2] },
    9: { grid: [3, 2] }
  }
};

let spriteSheet = new Image();
let processedFrames = {};
let currentState = 'idle';
let frameIndex = 0;
let animTick = 0;
let lastTime = 0;
let breathOffset = 0;
let zBubbleTimer = 0;
let sheetReady = false;
let actualCellW = 256;
let actualCellH = 341;
let wizardScale = 2;
let animationManifest = DEFAULT_MANIFEST;
let frameGrid = {};
let frameMap = DEFAULT_MANIFEST.states;
let driftOffsetX = 0;
let hoverOffsetY = 0;
let tiltRadians = 0;
let squashX = 1;
let squashY = 1;
let blinkAmount = 0;
let blinkClock = 0;
let nextBlinkAt = 0;

// ── Cursor / Eye-Tracking ──
let gazeX = 0;
let gazeY = 0;
let gazeSmoothedX = 0;
let gazeSmoothedY = 0;
let cursorDistance = 0;

// ── Idle Timer (replaces IPC onIdleUpdate) ──
let lastInteraction = Date.now();
const SHORT_IDLE = 60;   // seconds → reading
const LONG_IDLE = 180;   // seconds → sleeping
let idleCheckInterval = null;

// ══════════════════════════════════════════════════
// WEATHER PARTICLE SYSTEM
// ══════════════════════════════════════════════════

let weatherMode = 'none';
let weatherParticles = [];
let weatherIntensity = 0.6;
let lightningTimer = 0;
let lightningFlash = 0;
let lightningBolts = [];
let windAngle = 0.15;

function spawnRainDrop() {
  return {
    type: 'rain',
    x: Math.random() * weatherCanvas.width * 1.4 - weatherCanvas.width * 0.2,
    y: -Math.random() * weatherCanvas.height * 0.5,
    vx: 0.6 + Math.random() * 0.8,
    vy: 5 + Math.random() * 7,
    length: 6 + Math.random() * 10,
    alpha: 0.35 + Math.random() * 0.55,
    width: 0.6 + Math.random() * 0.8
  };
}

function spawnSnowflake() {
  const size = 1.5 + Math.random() * 3.5;
  return {
    type: 'snow',
    x: Math.random() * weatherCanvas.width * 1.3 - weatherCanvas.width * 0.15,
    y: -Math.random() * weatherCanvas.height * 0.3,
    vx: -0.15 + Math.random() * 0.3,
    vy: 0.5 + Math.random() * 1.5,
    size: size,
    alpha: 0.5 + Math.random() * 0.45,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 1.5 + Math.random() * 2,
    wobbleAmp: 0.4 + Math.random() * 0.6,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (-0.5 + Math.random()) * 0.03
  };
}

function generateLightningBolt() {
  const startX = weatherCanvas.width * 0.2 + Math.random() * weatherCanvas.width * 0.6;
  const points = [{ x: startX, y: 0 }];
  let cx = startX;
  let cy = 0;
  const segments = 6 + Math.floor(Math.random() * 8);
  const segH = weatherCanvas.height / segments;
  const forks = [];

  for (let i = 0; i < segments; i++) {
    cx += (-1 + Math.random() * 2) * (8 + Math.random() * 14);
    cy += segH * (0.7 + Math.random() * 0.5);
    points.push({ x: cx, y: cy });

    if (Math.random() < 0.3 && i > 1 && i < segments - 1) {
      const forkPoints = [{ x: cx, y: cy }];
      let fx = cx;
      let fy = cy;
      const forkLen = 2 + Math.floor(Math.random() * 3);
      const forkDir = Math.random() < 0.5 ? -1 : 1;
      for (let j = 0; j < forkLen; j++) {
        fx += forkDir * (4 + Math.random() * 10);
        fy += segH * (0.4 + Math.random() * 0.35);
        forkPoints.push({ x: fx, y: fy });
      }
      forks.push(forkPoints);
    }
  }

  return {
    points, forks,
    life: 0.12 + Math.random() * 0.15,
    maxLife: 0.12 + Math.random() * 0.15,
    thickness: 1.2 + Math.random() * 1.5
  };
}

function updateWeather(dt) {
  if (weatherMode === 'none') {
    weatherParticles = [];
    lightningBolts = [];
    lightningFlash = 0;
    return;
  }

  const isRain = weatherMode === 'rain' || weatherMode === 'storm';
  const isSnow = weatherMode === 'snow';
  const isLightning = weatherMode === 'lightning' || weatherMode === 'storm';

  if (isRain) {
    const targetCount = Math.floor(30 * weatherIntensity);
    const rainCount = weatherParticles.filter(p => p.type === 'rain').length;
    for (let i = rainCount; i < targetCount; i++) {
      weatherParticles.push(spawnRainDrop());
    }
  }
  if (isSnow) {
    const targetCount = Math.floor(25 * weatherIntensity);
    const snowCount = weatherParticles.filter(p => p.type === 'snow').length;
    for (let i = snowCount; i < targetCount; i++) {
      weatherParticles.push(spawnSnowflake());
    }
  }

  for (let i = weatherParticles.length - 1; i >= 0; i--) {
    const p = weatherParticles[i];
    if (p.type === 'rain') {
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      if (p.y > weatherCanvas.height + 10 || p.x > weatherCanvas.width + 20) {
        weatherParticles[i] = spawnRainDrop();
      }
    }
    if (p.type === 'snow') {
      p.wobble += p.wobbleSpeed * dt;
      p.x += (p.vx + Math.sin(p.wobble) * p.wobbleAmp) * dt * 60;
      p.y += p.vy * dt * 60;
      p.rotation += p.rotSpeed;
      if (p.y > weatherCanvas.height + 10) {
        weatherParticles[i] = spawnSnowflake();
      }
    }
  }

  if (isLightning) {
    lightningTimer -= dt;
    if (lightningTimer <= 0) {
      lightningBolts.push(generateLightningBolt());
      lightningFlash = 0.7 + Math.random() * 0.3;
      lightningTimer = 1.5 + Math.random() * 4.0 / Math.max(0.1, weatherIntensity);
    }
  }

  for (let i = lightningBolts.length - 1; i >= 0; i--) {
    lightningBolts[i].life -= dt;
    if (lightningBolts[i].life <= 0) lightningBolts.splice(i, 1);
  }

  if (lightningFlash > 0) {
    lightningFlash -= dt * 4;
    if (lightningFlash < 0) lightningFlash = 0;
  }
}

function drawWeather() {
  wCtx.clearRect(0, 0, weatherCanvas.width, weatherCanvas.height);
  if (weatherMode === 'none') return;

  if (lightningFlash > 0) {
    wCtx.fillStyle = `rgba(220, 180, 255, ${lightningFlash * 0.25})`;
    wCtx.fillRect(0, 0, weatherCanvas.width, weatherCanvas.height);
  }

  for (const p of weatherParticles) {
    if (p.type === 'rain') {
      wCtx.save();
      wCtx.strokeStyle = `rgba(0, 255, 255, ${p.alpha})`;
      wCtx.lineWidth = p.width;
      wCtx.lineCap = 'round';
      wCtx.shadowColor = '#00FFFF';
      wCtx.shadowBlur = 3;
      wCtx.beginPath();
      wCtx.moveTo(p.x, p.y);
      wCtx.lineTo(p.x + p.vx * 0.5, p.y + p.length);
      wCtx.stroke();
      wCtx.restore();
    }
  }

  for (const p of weatherParticles) {
    if (p.type === 'snow') {
      wCtx.save();
      wCtx.translate(p.x, p.y);
      wCtx.rotate(p.rotation);
      const r = p.size;

      wCtx.strokeStyle = `rgba(0, 0, 0, ${p.alpha * 0.6})`;
      wCtx.lineWidth = 1.2;
      for (let arm = 0; arm < 6; arm++) {
        const angle = (arm / 6) * Math.PI * 2;
        const ex = Math.cos(angle) * r;
        const ey = Math.sin(angle) * r;
        wCtx.beginPath();
        wCtx.moveTo(0, 0);
        wCtx.lineTo(ex, ey);
        wCtx.stroke();
      }

      wCtx.strokeStyle = `rgba(210, 230, 255, ${p.alpha})`;
      wCtx.lineWidth = 0.7;
      wCtx.shadowColor = '#D2E6FF';
      wCtx.shadowBlur = 2;
      for (let arm = 0; arm < 6; arm++) {
        const angle = (arm / 6) * Math.PI * 2;
        const ex = Math.cos(angle) * r;
        const ey = Math.sin(angle) * r;
        wCtx.beginPath();
        wCtx.moveTo(0, 0);
        wCtx.lineTo(ex, ey);
        wCtx.stroke();
        if (r > 2.5) {
          const branchLen = r * 0.35;
          const mid = 0.6;
          const mx = Math.cos(angle) * r * mid;
          const my = Math.sin(angle) * r * mid;
          for (const side of [-1, 1]) {
            const bAngle = angle + side * 0.5;
            wCtx.beginPath();
            wCtx.moveTo(mx, my);
            wCtx.lineTo(mx + Math.cos(bAngle) * branchLen, my + Math.sin(bAngle) * branchLen);
            wCtx.stroke();
          }
        }
      }

      wCtx.fillStyle = `rgba(210, 230, 255, ${p.alpha * 0.9})`;
      wCtx.beginPath();
      wCtx.arc(0, 0, 0.5, 0, Math.PI * 2);
      wCtx.fill();
      wCtx.restore();
    }
  }

  for (const bolt of lightningBolts) {
    const lifeRatio = bolt.life / bolt.maxLife;
    drawBoltPath(bolt.points, bolt.thickness, lifeRatio);
    for (const fork of bolt.forks) {
      drawBoltPath(fork, bolt.thickness * 0.5, lifeRatio * 0.7);
    }
  }
}

function drawBoltPath(points, thickness, alpha) {
  if (points.length < 2) return;

  wCtx.save();
  wCtx.strokeStyle = `rgba(255, 0, 255, ${alpha * 0.4})`;
  wCtx.lineWidth = thickness * 4;
  wCtx.lineCap = 'round';
  wCtx.lineJoin = 'round';
  wCtx.shadowColor = '#FF00FF';
  wCtx.shadowBlur = 12;
  wCtx.beginPath();
  wCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    wCtx.lineTo(points[i].x, points[i].y);
  }
  wCtx.stroke();
  wCtx.restore();

  wCtx.save();
  wCtx.strokeStyle = `rgba(255, 200, 255, ${alpha * 0.9})`;
  wCtx.lineWidth = thickness;
  wCtx.lineCap = 'round';
  wCtx.lineJoin = 'round';
  wCtx.shadowColor = '#FFC8FF';
  wCtx.shadowBlur = 4;
  wCtx.beginPath();
  wCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    wCtx.lineTo(points[i].x, points[i].y);
  }
  wCtx.stroke();
  wCtx.restore();
}

// ══════════════════════════════════════════════════
// WEATHER CONTROL
// ══════════════════════════════════════════════════

function setWeather(mode, intensity) {
  weatherMode = mode || 'none';
  if (typeof intensity === 'number') weatherIntensity = Math.max(0, Math.min(1, intensity));
  weatherParticles = [];
  lightningBolts = [];
  lightningFlash = 0;
  lightningTimer = 0.5 + Math.random() * 2;
  weatherCanvas.width = canvas.width;
  weatherCanvas.height = canvas.height;
  console.log(`Weather: ${weatherMode} @ ${(weatherIntensity * 100).toFixed(0)}%`);
}

// ══════════════════════════════════════════════════
// SCALE MANAGEMENT
// ══════════════════════════════════════════════════

const BASE_W = 90;
const BASE_H = 100;

function applyScale(scale) {
  wizardScale = scale || 2;
  const w = Math.round(BASE_W * wizardScale);
  const h = Math.round(BASE_H * wizardScale);
  canvas.width = w;
  canvas.height = h;
  weatherCanvas.width = w;
  weatherCanvas.height = h;
  // Update glow ring width
  if (glowRing) {
    glowRing.style.width = `${w * 0.55}px`;
    glowRing.style.height = `${h * 0.09}px`;
  }
}

// ══════════════════════════════════════════════════
// MICRO-MOTION & BLINK
// ══════════════════════════════════════════════════

function isCalmState(state) {
  return state === 'idle' || state === 'reading' || state === 'researching';
}

function scheduleNextBlink(timestamp) {
  nextBlinkAt = timestamp + 1800 + Math.random() * 3200;
}

function updateMicroMotion(timestamp, dt) {
  if (!lastTime) scheduleNextBlink(timestamp);

  if (currentState === 'idle') {
    breathOffset = Math.sin(timestamp / 1400) * 0.85;
    driftOffsetX = Math.sin(timestamp / 2400) * 0.45 + Math.sin(timestamp / 5100) * 0.2;
    hoverOffsetY = Math.cos(timestamp / 3000) * 0.22;
    tiltRadians = Math.sin(timestamp / 4200) * 0.008;
    squashX = 1 + Math.sin(timestamp / 1400) * 0.003;
    squashY = 1 - Math.sin(timestamp / 1400) * 0.004;
  } else if (currentState === 'reading') {
    breathOffset = Math.sin(timestamp / 1700) * 0.45;
    driftOffsetX = Math.sin(timestamp / 3200) * 0.2;
    hoverOffsetY = Math.cos(timestamp / 2800) * 0.12;
    tiltRadians = Math.sin(timestamp / 3600) * 0.005;
    squashX = 1;
    squashY = 1;
  } else if (currentState === 'researching') {
    breathOffset = Math.sin(timestamp / 1100) * 0.35;
    driftOffsetX = Math.sin(timestamp / 1500) * 0.18;
    hoverOffsetY = Math.cos(timestamp / 1300) * 0.18;
    tiltRadians = Math.sin(timestamp / 1900) * 0.006;
    squashX = 1;
    squashY = 1;
  } else if (currentState === 'sleeping') {
    breathOffset = Math.sin(timestamp / 1650) * 1.2;
    driftOffsetX = Math.sin(timestamp / 3600) * 0.12;
    hoverOffsetY = 0;
    tiltRadians = Math.sin(timestamp / 4200) * 0.004;
    squashX = 1 + Math.sin(timestamp / 1650) * 0.003;
    squashY = 1 - Math.sin(timestamp / 1650) * 0.005;
  } else {
    breathOffset = 0;
    driftOffsetX = 0;
    hoverOffsetY = 0;
    tiltRadians = 0;
    squashX = 1;
    squashY = 1;
  }

  if (!isCalmState(currentState)) {
    blinkAmount = 0;
    blinkClock = 0;
    nextBlinkAt = timestamp + 1200;
    return;
  }

  if (!nextBlinkAt) scheduleNextBlink(timestamp);

  if (timestamp >= nextBlinkAt) {
    blinkClock += dt * 7.5;
    const blinkPhase = Math.min(blinkClock, 1);
    blinkAmount = Math.sin(blinkPhase * Math.PI) ** 1.6;
    if (blinkClock >= 1) {
      blinkClock = 0;
      blinkAmount = 0;
      scheduleNextBlink(timestamp);
    }
  } else {
    blinkAmount = 0;
  }
}

function drawBlinkOverlay() {
  if (blinkAmount <= 0.01) return;
  const uprightStates = ['idle', 'walking', 'talking', 'laughing', 'sad', 'happy', 'thinking'];
  if (!uprightStates.includes(currentState)) return;

  const eyeWidth = canvas.width * 0.038;
  const eyeGap = canvas.width * 0.10;
  const eyeY = canvas.height * 0.38 + hoverOffsetY * 0.08;
  const eyeCenterX = canvas.width * 0.5 + canvas.width * 0.03;
  const leftCenterX = eyeCenterX - eyeGap * 0.5;
  const rightCenterX = eyeCenterX + eyeGap * 0.5;
  const lidHeight = canvas.height * 0.015 * blinkAmount;

  ctx.save();
  ctx.fillStyle = `rgba(198, 156, 109, ${0.7 + blinkAmount * 0.3})`;
  for (const centerX of [leftCenterX, rightCenterX]) {
    ctx.beginPath();
    ctx.ellipse(centerX, eyeY - lidHeight * 0.2, eyeWidth * 0.8, lidHeight, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ══════════════════════════════════════════════════
// EYE-TRACKING (Browser-native mousemove)
// ══════════════════════════════════════════════════

function startCursorTracking() {
  // Replace IPC getCursorPos with browser mousemove
  function handlePointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const wizX = rect.left + rect.width / 2;
    const wizY = rect.top + rect.height / 2;

    const dx = clientX - wizX;
    const dy = clientY - wizY;
    cursorDistance = Math.sqrt(dx * dx + dy * dy);

    const maxDist = 300;
    const norm = Math.min(cursorDistance / maxDist, 1);
    const angle = Math.atan2(dy, dx);

    gazeX = Math.cos(angle) * norm;
    gazeY = Math.sin(angle) * norm;
  }

  document.addEventListener('mousemove', (e) => {
    handlePointer(e.clientX, e.clientY);
    resetIdleTimer(); // Any mouse movement resets idle
  });

  // Touch support for mobile
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      handlePointer(e.touches[0].clientX, e.touches[0].clientY);
      resetIdleTimer();
    }
  }, { passive: true });

  document.addEventListener('keydown', () => resetIdleTimer());
  document.addEventListener('click', () => resetIdleTimer());
}

function updateGaze(dt) {
  const lerpSpeed = 8;
  const t = 1 - Math.exp(-lerpSpeed * dt);
  gazeSmoothedX += (gazeX - gazeSmoothedX) * t;
  gazeSmoothedY += (gazeY - gazeSmoothedY) * t;
}

function drawGazePupils() {
  const uprightStates = ['idle', 'walking', 'talking', 'laughing', 'sad', 'happy', 'thinking'];
  if (!uprightStates.includes(currentState)) return;
  if (blinkAmount > 0.7) return;

  const eyeGap = canvas.width * 0.10;
  const eyeY = canvas.height * 0.38 + hoverOffsetY * 0.08;
  const eyeCenterX = canvas.width * 0.5 + canvas.width * 0.03;
  const leftCenterX = eyeCenterX - eyeGap * 0.5;
  const rightCenterX = eyeCenterX + eyeGap * 0.5;
  const maxShiftX = canvas.width * 0.018;
  const maxShiftY = canvas.height * 0.012;
  const pupilRadius = Math.max(1, canvas.width * 0.012);

  ctx.save();
  for (const centerX of [leftCenterX, rightCenterX]) {
    const px = centerX + gazeSmoothedX * maxShiftX;
    const py = eyeY + gazeSmoothedY * maxShiftY;

    ctx.fillStyle = 'rgba(15, 5, 30, 0.85)';
    ctx.beginPath();
    ctx.arc(px, py, pupilRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(px - pupilRadius * 0.3, py - pupilRadius * 0.3, pupilRadius * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ══════════════════════════════════════════════════
// IDLE TIMER (replaces IPC onIdleUpdate)
// ══════════════════════════════════════════════════

function resetIdleTimer() {
  lastInteraction = Date.now();
  // Wake up from idle states
  if (currentState === 'sleeping' || currentState === 'reading') {
    setState('idle');
    showSpeechBubble('✨ Back to the Arcane Ledge!', 2000);
  }
}

function startIdleTimer() {
  idleCheckInterval = setInterval(() => {
    if (['talking', 'researching', 'laughing', 'sad'].includes(currentState)) return;

    const idleSeconds = (Date.now() - lastInteraction) / 1000;

    if (idleSeconds >= LONG_IDLE && currentState !== 'sleeping') {
      setState('sleeping');
    } else if (idleSeconds >= SHORT_IDLE && currentState !== 'sleeping' && currentState !== 'reading') {
      setState('reading');
    }
  }, 2000);
}

// ══════════════════════════════════════════════════
// SPRITE PROCESSING
// ══════════════════════════════════════════════════

function extractFrame(img, col, row) {
  const fc = document.createElement('canvas');
  fc.width = actualCellW;
  fc.height = actualCellH;
  const fCtx = fc.getContext('2d');
  const sx = col * actualCellW;
  const sy = row * actualCellH;
  fCtx.drawImage(img, sx, sy, actualCellW, actualCellH, 0, 0, actualCellW, actualCellH);
  return fc;
}

function processSheet(img) {
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const layout = animationManifest.layout || DEFAULT_MANIFEST.layout;
  const columns = layout.columns || DEFAULT_MANIFEST.layout.columns;
  const rows = layout.rows || DEFAULT_MANIFEST.layout.rows;

  actualCellW = Math.floor(sw / columns);
  actualCellH = Math.floor(sh / rows);
  console.log(`Sheet: ${sw}x${sh}, cell: ${actualCellW}x${actualCellH}`);

  processedFrames = {};
  for (const [frameIdx, [col, row]] of Object.entries(frameGrid)) {
    processedFrames[frameIdx] = extractFrame(img, col, row);
  }
  sheetReady = true;
  console.log(`Processed ${Object.keys(processedFrames).length} frames`);
}

function normalizeManifest(manifest) {
  const safeManifest = manifest || DEFAULT_MANIFEST;
  frameMap = safeManifest.states || DEFAULT_MANIFEST.states;
  frameGrid = Object.fromEntries(
    Object.entries(safeManifest.frames || DEFAULT_MANIFEST.frames)
      .map(([frameIdx, frameData]) => [frameIdx, frameData.grid])
  );
  animationManifest = {
    ...DEFAULT_MANIFEST,
    ...safeManifest,
    layout: {
      ...DEFAULT_MANIFEST.layout,
      ...(safeManifest.layout || {})
    }
  };
}

// ══════════════════════════════════════════════════
// STATE MANAGEMENT
// ══════════════════════════════════════════════════

function setState(newState) {
  if (newState === currentState) return;
  currentState = newState;
  frameIndex = 0;
  animTick = 0;

  glowRing.className = 'glow-ring';
  if (newState === 'researching') glowRing.classList.add('researching');
  if (newState === 'sleeping') glowRing.classList.add('sleeping');

  const labels = {
    idle: 'idle',
    talking: 'speaking',
    reading: 'reading',
    sleeping: 'asleep',
    laughing: 'amused',
    sad: 'somber',
    researching: 'researching'
  };
  stateLabel.textContent = labels[newState] || newState;

  // Update the state selector in UI
  const sel = document.getElementById('state-select');
  if (sel && sel.value !== newState) sel.value = newState;

  // Bubble messages
  const bubbleMessages = {
    researching: '📚 Consulting the vast libraries...',
    talking: '💬 Ah, let me share my wisdom...',
    laughing: '😄 Ha ha! Most amusing!',
    sad: '😔 The stars weep...',
    sleeping: '💤 Zzz...',
    reading: '📖 Fascinating text...'
  };
  if (bubbleMessages[newState]) {
    showSpeechBubble(bubbleMessages[newState], newState === 'sleeping' ? 5000 : 3000);
  }
}

function showSpeechBubble(text, duration) {
  speechBubble.textContent = text;
  speechBubble.classList.add('visible');
  setTimeout(() => speechBubble.classList.remove('visible'), duration || 3000);
}

// ══════════════════════════════════════════════════
// Z BUBBLES
// ══════════════════════════════════════════════════

function spawnZBubble() {
  const z = document.createElement('div');
  z.className = 'z-bubble';
  z.textContent = 'Z';
  z.style.right = `${30 + Math.random() * 20}px`;
  z.style.top = `${20 + Math.random() * 15}px`;
  z.style.fontSize = `${16 + Math.random() * 10}px`;
  wizardViewport.appendChild(z);
  setTimeout(() => z.remove(), 2000);
}

// ══════════════════════════════════════════════════
// PLACEHOLDER
// ══════════════════════════════════════════════════

function drawPlaceholder() {
  ctx.fillStyle = '#1a0a30';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#a855f7';
  ctx.font = '60px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🧙', canvas.width / 2, canvas.height / 2);
}

// ══════════════════════════════════════════════════
// MAIN ANIMATION LOOP
// ══════════════════════════════════════════════════

function animate(timestamp) {
  const dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  const stateConfig = frameMap[currentState] || frameMap.idle || DEFAULT_MANIFEST.states.idle;
  const fps = stateConfig.fps || 1;

  updateMicroMotion(timestamp, Math.max(0, dt || 0));
  updateGaze(Math.max(0, dt || 0));

  animTick += dt;
  if (animTick >= 1 / fps) {
    animTick = 0;
    frameIndex = (frameIndex + 1) % stateConfig.frames.length;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (sheetReady) {
    const srcFrameIdx = stateConfig.frames[frameIndex];
    const frameCanvas = processedFrames[srcFrameIdx];

    if (frameCanvas) {
      ctx.save();
      const leanX = gazeSmoothedX * canvas.width * 0.008;
      const leanTilt = gazeSmoothedX * 0.009;
      ctx.translate(
        canvas.width / 2 + driftOffsetX + leanX,
        canvas.height / 2 + breathOffset + hoverOffsetY
      );
      ctx.rotate(tiltRadians + leanTilt);
      ctx.scale(squashX, squashY);
      ctx.drawImage(frameCanvas, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);
      ctx.scale(1 / squashX, 1 / squashY);
      drawBlinkOverlay();
      drawGazePupils();
      ctx.restore();
    } else {
      drawPlaceholder();
    }
  } else {
    drawPlaceholder();
  }

  if (currentState === 'sleeping') {
    zBubbleTimer += dt;
    if (zBubbleTimer > 2) {
      zBubbleTimer = 0;
      spawnZBubble();
    }
  }

  const safeDt = Math.max(0, Math.min(dt || 0, 0.1));
  updateWeather(safeDt);
  drawWeather();

  requestAnimationFrame(animate);
}

// ══════════════════════════════════════════════════
// CHAT SYSTEM (Browser-native fetch to OpenAI)
// ══════════════════════════════════════════════════

let chatHistory = [];

async function sendChat(userMessage) {
  const apiKey = config.apiKey;
  if (!apiKey) {
    appendChatMessage('wizard', '🔮 Please set your OpenAI API key in the settings panel to enable chat.');
    return;
  }

  appendChatMessage('user', userMessage);

  setState('researching');
  showSpeechBubble('📚 Consulting the vast libraries...', 5000);

  chatHistory.push({ role: 'user', content: userMessage });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a wise and whimsical wizard named Vortex. You speak in a mystical, slightly dramatic tone with occasional humor. Keep responses concise (2-3 sentences). Use occasional magic-themed language.'
          },
          ...chatHistory.slice(-10) // Keep last 10 messages for context
        ],
        max_tokens: 150,
        temperature: 0.8
      })
    });

    const data = await response.json();

    if (data.error) {
      appendChatMessage('wizard', `🔮 The arcane energies falter: ${data.error.message}`);
      setState('sad');
      return;
    }

    const reply = data.choices?.[0]?.message?.content || 'The crystal ball is cloudy...';
    chatHistory.push({ role: 'assistant', content: reply });

    setState('talking');
    appendChatMessage('wizard', reply);
    showSpeechBubble(reply.substring(0, 50) + (reply.length > 50 ? '...' : ''), 4000);

    // Use browser TTS
    speakText(reply);

    // Return to idle after speaking
    setTimeout(() => {
      if (currentState === 'talking') setState('idle');
    }, 4000);

  } catch (err) {
    appendChatMessage('wizard', `🔮 A disturbance in the aether: ${err.message}`);
    setState('sad');
    setTimeout(() => setState('idle'), 3000);
  }
}

function appendChatMessage(role, text) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ── Browser TTS ──
function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.pitch = 0.8;
  // Try to find a deeper voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.name.includes('Male') || v.name.includes('Daniel') || v.name.includes('James'));
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
}

// ══════════════════════════════════════════════════
// AUTO WEATHER (Open-Meteo — free, no API key)
// ══════════════════════════════════════════════════

async function fetchLiveWeather() {
  try {
    // Get user's geolocation
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
    });

    const lat = pos.coords.latitude.toFixed(2);
    const lon = pos.coords.longitude.toFixed(2);

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
    );
    const data = await res.json();

    if (data.current_weather) {
      const code = data.current_weather.weathercode;
      const temp = data.current_weather.temperature;
      const windSpeed = data.current_weather.windspeed;

      // Map WMO weather codes to our modes
      let mode = 'none';
      let intensity = 0.5;

      if ([61, 63, 65, 80, 81, 82].includes(code)) {
        mode = 'rain';
        intensity = code >= 65 ? 0.9 : code >= 63 ? 0.6 : 0.4;
      } else if ([71, 73, 75, 77, 85, 86].includes(code)) {
        mode = 'snow';
        intensity = code >= 75 ? 0.8 : 0.5;
      } else if ([95, 96, 99].includes(code)) {
        mode = 'storm';
        intensity = 0.8;
      }

      // Update UI
      const weatherInfo = document.getElementById('weather-info');
      if (weatherInfo) {
        weatherInfo.innerHTML = `
          <span class="location">📍 ${lat}°, ${lon}°</span><br>
          <span class="temp">🌡️ ${temp}°C</span> · 💨 ${windSpeed} km/h<br>
          ☁️ WMO Code ${code}
        `;
      }

      if (mode !== 'none') {
        setWeather(mode, intensity);
        const weatherSelect = document.getElementById('weather-select');
        if (weatherSelect) weatherSelect.value = mode;
        const intensitySlider = document.getElementById('intensity-slider');
        if (intensitySlider) intensitySlider.value = intensity;
      }

      return { mode, intensity, temp, code };
    }
  } catch (err) {
    console.log('Weather fetch failed (location denied or network error):', err.message);
  }
  return null;
}

// ══════════════════════════════════════════════════
// AMBIENT PARTICLES (background stars)
// ══════════════════════════════════════════════════

function createAmbientParticles() {
  const container = document.querySelector('.ambient-particles');
  if (!container) return;
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'ambient-particle';
    p.style.left = `${Math.random() * 100}%`;
    p.style.animationDelay = `${Math.random() * 8}s`;
    p.style.animationDuration = `${6 + Math.random() * 6}s`;
    p.style.width = p.style.height = `${1 + Math.random() * 2}px`;
    container.appendChild(p);
  }
}

// ══════════════════════════════════════════════════
// UI CONTROL WIRING
// ══════════════════════════════════════════════════

function wireControls() {
  // Weather select
  const weatherSelect = document.getElementById('weather-select');
  weatherSelect?.addEventListener('change', () => {
    setWeather(weatherSelect.value, weatherIntensity);
    config.weatherMode = weatherSelect.value;
    saveConfig(config);
  });

  // Intensity slider
  const intensitySlider = document.getElementById('intensity-slider');
  const intensityValue = document.getElementById('intensity-value');
  intensitySlider?.addEventListener('input', () => {
    const val = parseFloat(intensitySlider.value);
    weatherIntensity = val;
    if (intensityValue) intensityValue.textContent = `${Math.round(val * 100)}%`;
    config.weatherIntensity = val;
    saveConfig(config);
  });

  // Scale slider
  const scaleSlider = document.getElementById('scale-slider');
  const scaleValue = document.getElementById('scale-value');
  scaleSlider?.addEventListener('input', () => {
    const val = parseFloat(scaleSlider.value);
    applyScale(val);
    if (scaleValue) scaleValue.textContent = `${val.toFixed(1)}x`;
    config.wizardScale = val;
    saveConfig(config);
  });

  // State select
  const stateSelect = document.getElementById('state-select');
  stateSelect?.addEventListener('change', () => {
    setState(stateSelect.value);
    resetIdleTimer();
  });

  // API Key
  const apiKeyInput = document.getElementById('api-key-input');
  apiKeyInput?.addEventListener('change', () => {
    config.apiKey = apiKeyInput.value.trim();
    saveConfig(config);
  });
  // Pre-fill if saved
  if (apiKeyInput && config.apiKey) {
    apiKeyInput.value = config.apiKey;
  }

  // Chat input
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');

  function submitChat() {
    const text = chatInput?.value.trim();
    if (!text) return;
    chatInput.value = '';
    sendChat(text);
  }

  chatSend?.addEventListener('click', submitChat);
  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitChat();
  });

  // Auto weather button
  const autoWeatherBtn = document.getElementById('auto-weather-btn');
  autoWeatherBtn?.addEventListener('click', async () => {
    autoWeatherBtn.textContent = '🔍 Detecting...';
    autoWeatherBtn.disabled = true;
    const result = await fetchLiveWeather();
    autoWeatherBtn.textContent = result ? '✅ Weather synced!' : '❌ Could not detect';
    autoWeatherBtn.disabled = false;
    setTimeout(() => { autoWeatherBtn.textContent = '🌍 Auto-detect Weather'; }, 3000);
  });

  // Set initial slider values from config
  if (scaleSlider) scaleSlider.value = config.wizardScale;
  if (scaleValue) scaleValue.textContent = `${config.wizardScale.toFixed(1)}x`;
  if (intensitySlider) intensitySlider.value = config.weatherIntensity;
  if (intensityValue) intensityValue.textContent = `${Math.round(config.weatherIntensity * 100)}%`;
  if (weatherSelect && config.weatherMode) weatherSelect.value = config.weatherMode;
}

// ══════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════

async function initBuddy() {
  // Load manifest via fetch (replaces IPC)
  try {
    const res = await fetch('./assets/index.json');
    const manifest = await res.json();
    normalizeManifest(manifest);
  } catch {
    console.warn('Could not fetch manifest, using defaults');
    normalizeManifest(DEFAULT_MANIFEST);
  }

  spriteSheet.onload = () => {
    processSheet(spriteSheet);
    applyScale(config.wizardScale);
    if (config.weatherMode && config.weatherMode !== 'none') {
      setWeather(config.weatherMode, config.weatherIntensity);
    }
    startCursorTracking();
    startIdleTimer();
    requestAnimationFrame(animate);
  };

  spriteSheet.onerror = () => {
    console.warn('Sprite sheet not found, using placeholder');
    applyScale(config.wizardScale);
    startCursorTracking();
    startIdleTimer();
    requestAnimationFrame(animate);
  };

  // Try transparent version first, fall back to regular
  spriteSheet.src = `./assets/${animationManifest.spriteSheet || DEFAULT_MANIFEST.spriteSheet}`;
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  createAmbientParticles();
  wireControls();
  initBuddy();

  // Initial greeting
  setTimeout(() => {
    showSpeechBubble('🧙 Greetings, traveler! Move your mouse to guide my gaze.', 5000);
  }, 1500);

  // Try auto weather on load
  setTimeout(() => fetchLiveWeather(), 3000);
});
