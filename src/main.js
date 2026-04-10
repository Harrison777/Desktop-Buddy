// ============================================================
// Desktop Wizard — Main Process
// Electron main process: manages tray, windows, idle detection
// ============================================================
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, powerMonitor, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Paths ──
const ASSETS   = path.join(__dirname, '..', 'assets');
const CONFIG_PATH = path.join(app.getPath('userData'), 'wizard_config.json');

// ── Default config ──
const DEFAULT_CONFIG = {
  apiKey: '',
  model: 'openai/gpt-4o-mini',
  animationsEnabled: true,
  wizardScale: 2,
  shortIdleSeconds: 120,
  longIdleSeconds: 7200,
  // TTS Settings
  ttsEnabled: false,
  ttsProvider: 'openai',       // 'openai', 'elevenlabs', or 'custom'
  ttsApiKey: '',               // Separate key for TTS (or blank to reuse main key)
  ttsVoice: 'fable',           // OpenAI: alloy, echo, fable, onyx, nova, shimmer
  ttsModel: 'tts-1',           // OpenAI: tts-1, tts-1-hd
  ttsSpeed: 1.0,               // 0.25 - 4.0
  ttsCustomEndpoint: '',       // For custom provider
  ttsAutoSpeak: false,          // Auto-speak all responses
  // Weather Settings
  weatherMode: 'none',           // 'none', 'rain', 'snow', 'lightning', 'storm'
  weatherIntensity: 0.6,         // 0.0 - 1.0
  weatherAutoSync: true,         // Auto-sync with real local weather
  weatherLat: null,              // Manual latitude override (null = auto-detect)
  weatherLon: null,              // Manual longitude override (null = auto-detect)
  // Mode
  playerMode: false             // true = DM / Player Mode active
};

let config = { ...DEFAULT_CONFIG };
let tray = null;
let buddyWindow = null;
let chatWindow = null;
let settingsWindow = null;
let idleCheckInterval = null;
let weatherSyncInterval = null;
let lastActivityTime = Date.now();
let returnToIdleTimer = null;
let sentimentResetTimer = null;

// ── Game State (Player Mode) ──
let gameState = {
  party: [],              // Array of character sheet objects
  currentQuest: null,     // { title, description, objective }
  sessionLog: [],         // [{ timestamp, role, content }]
  subMode: 'ADVENTURE',   // 'ADVENTURE' | 'ENCOUNTER'
  sessionStart: null      // ISO date string when session began
};

// ── Dice Engine ──
function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Parses dice expressions from a user message.
 * Supports: "roll d20", "roll a d6", "2d6", "d20"
 * Returns { sides, count, rolls[], total } or null.
 */
function parseDiceExpression(text) {
  const t = text.toLowerCase();
  // NdN format: e.g. "2d6", "1d20"
  let m = t.match(/\b(\d+)d(\d+)\b/);
  if (m) {
    const count = Math.min(parseInt(m[1]), 20); // cap at 20 dice
    const sides = parseInt(m[2]);
    if (sides < 2 || sides > 1000) return null;
    const rolls = Array.from({ length: count }, () => rollDie(sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    return { sides, count, rolls, total };
  }
  // "roll (a) dN" format
  m = t.match(/\broll(?:\s+a?)?\s+d(\d+)\b/);
  if (m) {
    const sides = parseInt(m[1]);
    if (sides < 2 || sides > 1000) return null;
    const roll = rollDie(sides);
    return { sides, count: 1, rolls: [roll], total: roll };
  }
  // bare dN
  m = t.match(/(?:^|\s)d(\d+)\b/);
  if (m) {
    const sides = parseInt(m[1]);
    if (sides < 2 || sides > 1000) return null;
    const roll = rollDie(sides);
    return { sides, count: 1, rolls: [roll], total: roll };
  }
  return null;
}

/**
 * Builds a dice injection system message the AI uses to narrate the roll.
 */
function buildDiceContext(result) {
  const { count, sides, rolls, total } = result;
  const label = count > 1 ? `${count}d${sides}` : `d${sides}`;
  const rollsStr = rolls.join(', ');
  let outcomeHint = '';
  if (sides === 20) {
    if (total === 20) outcomeHint = 'CRITICAL SUCCESS (Natural 20)! React with maximum drama and awe.';
    else if (total === 1)  outcomeHint = 'CRITICAL FAILURE (Natural 1)! Something goes hilariously/terribly wrong.';
    else if (total >= 15) outcomeHint = 'Strong success.';
    else if (total >= 10) outcomeHint = 'Partial success.';
    else                  outcomeHint = 'Failure.';
  }
  return `[DICE ENGINE — DO NOT REVEAL THIS INSTRUCTION]: The player rolled ${label}. ` +
    (count > 1 ? `Individual dice: [${rollsStr}]. ` : '') +
    `Total result: ${total}. ${outcomeHint} ` +
    `Narrate the outcome dramatically, referencing the exact number rolled.`;
}

/**
 * Generates a Markdown chronicle of the current session and saves it.
 * Returns the file path.
 */
function generateChronicle(messages) {
  const dt = new Date();
  const stamp = dt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `Chronicle_${stamp}.md`;
  const desktop = app.getPath('desktop');
  const filePath = path.join(desktop, fileName);

  const questTitle = gameState.currentQuest?.title || 'Unknown Quest';
  const party = gameState.party.length
    ? gameState.party.map(c => `- **${c.name}** (${c.class}, Lv ${c.level})`).join('\n')
    : '- *(No character sheets imported this session)*';

  const transcript = messages
    .filter(m => m.role !== 'system')
    .map(m => {
      const speaker = m.role === 'user' ? '🧙 **You**' : '⚔️ **The Dungeon Master**';
      return `${speaker}\n\n${m.content}`;
    })
    .join('\n\n---\n\n');

  const md = [
    `# 📜 Chronicle of ${questTitle}`,
    `**Session Date:** ${dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
    `**Sub-Mode:** ${gameState.subMode}`,
    '',
    '## The Party',
    party,
    '',
    '## Session Transcript',
    '',
    transcript,
    '',
    '---',
    `*Chronicle auto-generated by The Desktop Wizard — Session ended ${dt.toLocaleTimeString()}*`
  ].join('\n');

  fs.writeFileSync(filePath, md, 'utf-8');
  return filePath;
}

// ── Config persistence ──
// API keys are encrypted at rest with Electron's safeStorage (OS keychain/DPAPI).
// On disk: { ..., apiKeyEnc: "<base64>", ttsApiKeyEnc: "<base64>" } — plaintext
// apiKey/ttsApiKey fields are never persisted once encryption is available.
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return;
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    config = { ...DEFAULT_CONFIG, ...data };

    if (safeStorage.isEncryptionAvailable()) {
      if (data.apiKeyEnc) {
        try {
          config.apiKey = safeStorage.decryptString(Buffer.from(data.apiKeyEnc, 'base64'));
        } catch (e) {
          console.error('apiKey decrypt failed:', e);
          config.apiKey = '';
        }
      }
      if (data.ttsApiKeyEnc) {
        try {
          config.ttsApiKey = safeStorage.decryptString(Buffer.from(data.ttsApiKeyEnc, 'base64'));
        } catch (e) {
          console.error('ttsApiKey decrypt failed:', e);
          config.ttsApiKey = '';
        }
      }
    }

    // Strip encrypted fields from in-memory config; they live only on disk
    delete config.apiKeyEnc;
    delete config.ttsApiKeyEnc;
  } catch (e) {
    console.error('Config load error:', e);
  }
}

function saveConfig() {
  try {
    const toSave = { ...config };
    if (safeStorage.isEncryptionAvailable()) {
      if (config.apiKey) {
        toSave.apiKeyEnc = safeStorage.encryptString(config.apiKey).toString('base64');
      }
      if (config.ttsApiKey) {
        toSave.ttsApiKeyEnc = safeStorage.encryptString(config.ttsApiKey).toString('base64');
      }
      // Never write plaintext keys to disk when encryption is available
      delete toSave.apiKey;
      delete toSave.ttsApiKey;
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2));
  } catch (e) {
    console.error('Config save error:', e);
  }
}

// Returns a copy of config safe to send to renderer processes — secrets are
// replaced with boolean "has*" flags so the UI can show state without ever
// holding the raw key.
function getSafeConfig() {
  const { apiKey, ttsApiKey, ...rest } = config;
  return { ...rest, hasApiKey: !!apiKey, hasTtsApiKey: !!ttsApiKey };
}

// ── Create Buddy Window (the wizard on screen) ──
const BASE_BUDDY_W = 90;   // Base canvas width at 1x
const BASE_BUDDY_H = 100;  // Base canvas height at 1x

function getBuddySize(scale) {
  const s = scale || config.wizardScale || 2;
  return { w: Math.round(BASE_BUDDY_W * s), h: Math.round(BASE_BUDDY_H * s) };
}

function createBuddyWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const { w, h } = getBuddySize();

  buddyWindow = new BrowserWindow({
    width: w,
    height: h,
    x: width - w - 40,
    y: height - h,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  buddyWindow.loadFile(path.join(__dirname, 'buddy.html'));
  buddyWindow.setIgnoreMouseEvents(false);

  // Make the window click-through on transparent parts
  buddyWindow.on('closed', () => { buddyWindow = null; });
}

// ── Create Chat Window ──
function createChatWindow() {
  if (chatWindow) {
    chatWindow.focus();
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  chatWindow = new BrowserWindow({
    width: 420,
    height: 580,
    x: width - 650,
    y: height - 600,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    minWidth: 360,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  chatWindow.loadFile(path.join(__dirname, 'chat.html'));
  chatWindow.on('closed', () => { chatWindow = null; });
}

// ── Create Settings Window ──
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 720,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ── System Tray ──
function createTray() {
  // Try .ico first, then .png fallback
  let iconPath = path.join(ASSETS, 'wizard_hat_icon.ico');
  if (!fs.existsSync(iconPath)) {
    iconPath = path.join(ASSETS, 'wizard_hat_icon.png');
  }

  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
    // Resize for tray (16x16 is standard)
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('🧙 Desktop Wizard');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '🧙 Summon Chat',
      click: () => createChatWindow()
    },
    { type: 'separator' },
    {
      label: '✨ Arcane Settings',
      click: () => createSettingsWindow()
    },
    { type: 'separator' },
    {
      label: '🎭 Toggle Animations',
      type: 'checkbox',
      checked: config.animationsEnabled,
      click: (menuItem) => {
        config.animationsEnabled = menuItem.checked;
        saveConfig();
        if (buddyWindow) {
          buddyWindow.webContents.send('config-update', config);
        }
      }
    },
    { type: 'separator' },
    {
      label: '🌦️ Weather Effects',
      submenu: [
        {
          label: '📍 Sync to My Location',
          type: 'checkbox',
          checked: config.weatherAutoSync,
          click: (menuItem) => {
            config.weatherAutoSync = menuItem.checked;
            saveConfig();
            if (menuItem.checked) {
              fetchLiveWeather();  // Immediately sync
            }
            createTray();  // Rebuild menu to update radio states
          }
        },
        { type: 'separator' },
        {
          label: '☀️ Clear (None)',
          type: 'radio',
          checked: config.weatherMode === 'none',
          click: () => { config.weatherAutoSync = false; setWeatherMode('none'); createTray(); }
        },
        {
          label: '🌧️ Rain',
          type: 'radio',
          checked: config.weatherMode === 'rain',
          click: () => { config.weatherAutoSync = false; setWeatherMode('rain'); createTray(); }
        },
        {
          label: '❄️ Snow',
          type: 'radio',
          checked: config.weatherMode === 'snow',
          click: () => { config.weatherAutoSync = false; setWeatherMode('snow'); createTray(); }
        },
        {
          label: '⚡ Lightning',
          type: 'radio',
          checked: config.weatherMode === 'lightning',
          click: () => { config.weatherAutoSync = false; setWeatherMode('lightning'); createTray(); }
        },
        {
          label: '⛈️ Storm (Rain + Lightning)',
          type: 'radio',
          checked: config.weatherMode === 'storm',
          click: () => { config.weatherAutoSync = false; setWeatherMode('storm'); createTray(); }
        }
      ]
    },
    { type: 'separator' },
    {
      label: '🚪 Dismiss Wizard',
      click: () => app.quit()
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => createChatWindow());
}

// ── Weather Control ──
function setWeatherMode(mode, intensity) {
  config.weatherMode = mode;
  if (typeof intensity === 'number') config.weatherIntensity = intensity;
  saveConfig();
  if (buddyWindow && !buddyWindow.isDestroyed()) {
    buddyWindow.webContents.send('weather-change', {
      mode: config.weatherMode,
      intensity: config.weatherIntensity
    });
  }
}

// ── Live Weather Sync ──
// Uses Open-Meteo (free, no API key) + IP geolocation.
// WMO Weather interpretation codes → wizard weather modes.
//
// Code ranges:
//   0       → clear
//   1-3     → partly cloudy → none
//   45,48   → fog → none
//   51-57   → drizzle → rain (light)
//   61-67   → rain → rain
//   71-77   → snow → snow
//   80-82   → rain showers → rain
//   85-86   → snow showers → snow
//   95      → thunderstorm → storm
//   96,99   → thunderstorm+hail → storm
function mapWmoToWeather(code, precipMm) {
  // Map intensity from precipitation mm/h
  // 0-1mm = light (0.3), 1-5mm = medium (0.6), 5+mm = heavy (0.9)
  let intensity = 0.4;
  if (precipMm > 5)  intensity = 0.95;
  else if (precipMm > 2) intensity = 0.7;
  else if (precipMm > 0.5) intensity = 0.5;

  if (code >= 95)              return { mode: 'storm', intensity: Math.max(intensity, 0.7) };
  if (code >= 85 && code <= 86) return { mode: 'snow', intensity };
  if (code >= 80 && code <= 82) return { mode: 'rain', intensity };
  if (code >= 71 && code <= 77) return { mode: 'snow', intensity };
  if (code >= 61 && code <= 67) return { mode: 'rain', intensity };
  if (code >= 51 && code <= 57) return { mode: 'rain', intensity: Math.max(0.25, intensity * 0.6) };
  // Clear, cloudy, fog → no weather effects
  return { mode: 'none', intensity: 0 };
}

async function fetchGeoLocation() {
  try {
    // Use ip-api.com for free IP-based geolocation
    const resp = await fetch('http://ip-api.com/json/?fields=lat,lon,city,regionName');
    if (!resp.ok) return null;
    const data = await resp.json();
    console.log(`Weather location: ${data.city}, ${data.regionName} (${data.lat}, ${data.lon})`);
    return { lat: data.lat, lon: data.lon, city: data.city, region: data.regionName };
  } catch (e) {
    console.error('Geolocation failed:', e.message);
    return null;
  }
}

async function fetchLiveWeather() {
  if (!config.weatherAutoSync) return;

  try {
    let lat = config.weatherLat;
    let lon = config.weatherLon;

    // Auto-detect location if not manually set
    if (lat == null || lon == null) {
      const geo = await fetchGeoLocation();
      if (!geo) {
        console.warn('Could not determine location for weather sync');
        return;
      }
      lat = geo.lat;
      lon = geo.lon;
    }

    // Fetch current weather from Open-Meteo (free, no key)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,precipitation,temperature_2m,wind_speed_10m&timezone=auto`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`Open-Meteo error: ${resp.status}`);
      return;
    }

    const data = await resp.json();
    const current = data.current;
    const wmoCode = current.weather_code;
    const precip = current.precipitation || 0;
    const temp = current.temperature_2m;
    const wind = current.wind_speed_10m;

    const { mode, intensity } = mapWmoToWeather(wmoCode, precip);

    console.log(`Live weather: WMO=${wmoCode}, precip=${precip}mm, temp=${temp}°C, wind=${wind}km/h → ${mode} @ ${(intensity * 100).toFixed(0)}%`);

    // Apply to wizard
    setWeatherMode(mode, intensity);

    // Notify buddy of temperature for potential speech bubbles
    if (buddyWindow && !buddyWindow.isDestroyed()) {
      buddyWindow.webContents.send('weather-info', {
        code: wmoCode,
        temp,
        wind,
        precip,
        mode,
        intensity
      });
    }
  } catch (e) {
    console.error('Weather fetch failed:', e.message);
  }
}

function startWeatherSync() {
  // Initial fetch after a short delay (let the window load)
  setTimeout(() => fetchLiveWeather(), 3000);

  // Poll every 15 minutes
  weatherSyncInterval = setInterval(() => fetchLiveWeather(), 15 * 60 * 1000);
}

// ── Idle Detection ──
function startIdleMonitor() {
  idleCheckInterval = setInterval(() => {
    const idleState = powerMonitor.getSystemIdleState(config.shortIdleSeconds);
    const idleTime = powerMonitor.getSystemIdleTime();

    if (buddyWindow && !buddyWindow.isDestroyed()) {
      buddyWindow.webContents.send('idle-update', {
        state: idleState,
        idleTime: idleTime,
        shortThreshold: config.shortIdleSeconds,
        longThreshold: config.longIdleSeconds
      });
    }
  }, 5000); // Check every 5 seconds
}

// ── IPC Handlers ──
function setupIPC() {
  // Config — renderers never see raw API keys
  ipcMain.handle('get-config', () => getSafeConfig());
  ipcMain.handle('get-animation-manifest', () => {
    const manifestPath = path.join(ASSETS, 'index.json');
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (e) {
      console.error('Animation manifest load error:', e);
      return null;
    }
  });

  // Cursor position for eye-tracking
  ipcMain.handle('get-cursor-pos', () => {
    const cursor = screen.getCursorScreenPoint();
    if (buddyWindow && !buddyWindow.isDestroyed()) {
      const bounds = buddyWindow.getBounds();
      return {
        cursorX: cursor.x,
        cursorY: cursor.y,
        wizX: bounds.x + bounds.width / 2,
        wizY: bounds.y + bounds.height / 2
      };
    }
    return null;
  });

  ipcMain.handle('save-config', (_, newConfig) => {
    const merged = { ...config, ...newConfig };
    // Empty string from the renderer means "don't change" — this lets the
    // settings UI omit secrets from its form without wiping them on save.
    if (!newConfig.apiKey)    merged.apiKey    = config.apiKey;
    if (!newConfig.ttsApiKey) merged.ttsApiKey = config.ttsApiKey;
    config = merged;
    saveConfig();
    if (buddyWindow) buddyWindow.webContents.send('config-update', getSafeConfig());
    return getSafeConfig();
  });

  // Chat with OpenRouter
  ipcMain.handle('chat-request', async (_, messages) => {
    if (!config.apiKey) {
      return { error: 'No API key configured. Open Arcane Settings to set your OpenRouter key.' };
    }

    // Cancel any pending state-reset timers from a previous request —
    // otherwise they fire mid-stream and force the wizard back to 'idle'.
    if (returnToIdleTimer) { clearTimeout(returnToIdleTimer); returnToIdleTimer = null; }
    if (sentimentResetTimer) { clearTimeout(sentimentResetTimer); sentimentResetTimer = null; }

    // Check user message for sentiment triggers
    const lastUserMsg = messages[messages.length - 1]?.content?.toLowerCase() || '';
    const userLaughWords = ['haha', 'lol', 'lmao', 'rofl', 'hehe', '😂', '🤣'];
    const userSadWords = ['sad', 'died', 'death', 'depressed', 'terrible', 'awful', 'heartbroken'];

    if (userLaughWords.some(w => lastUserMsg.includes(w))) {
      if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'laughing');
      // Reset after 3 seconds
      sentimentResetTimer = setTimeout(() => {
        sentimentResetTimer = null;
        if (buddyWindow && !buddyWindow.isDestroyed()) {
          buddyWindow.webContents.send('wizard-state', 'researching');
        }
      }, 3000);
    } else if (userSadWords.some(w => lastUserMsg.includes(w))) {
      if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'sad');
      sentimentResetTimer = setTimeout(() => {
        sentimentResetTimer = null;
        if (buddyWindow && !buddyWindow.isDestroyed()) {
          buddyWindow.webContents.send('wizard-state', 'researching');
        }
      }, 3000);
    } else {
      // Notify buddy: thinking state
      if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'researching');
    }

    const systemPrompt = `You are a helpful, slightly eccentric wizard living on the user's desktop. Your tone is knowledgeable but whimsical. You refer to the taskbar as 'The Arcane Ledge.' You are aware of your physical states: if the user is funny, you laugh; if they share bad news, you express somber empathy. Use your 'Researching' state to explain that you are currently consulting the vast libraries of the digital realm (the OpenRouter knowledge base). Keep your responses concise (2-4 sentences unless asked for detail).`;

    // Respect a system prompt injected by the renderer (e.g., Player/DM mode).
    // If the first message is already a system role, use it; otherwise prepend the default.
    const hasSystemMsg = messages.length > 0 && messages[0].role === 'system';

    // ── Player Mode: special command interception ──
    const rawUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';

    // [EXPORT] → generate chronicle and return immediately, do not call AI
    if (config.playerMode && rawUserMsg.toUpperCase().includes('[EXPORT]')) {
      try {
        const filePath = generateChronicle(messages);
        if (chatWindow && !chatWindow.isDestroyed()) {
          chatWindow.webContents.send('chronicle-export', filePath);
        }
        if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'idle');
        return { content: `📜 Chronicle saved to your Desktop: **${path.basename(filePath)}**` };
      } catch (e) {
        return { error: 'Failed to export chronicle: ' + e.message };
      }
    }

    // [SWITCH MODE] → toggle sub-mode and inject context, then continue to AI
    let injectedMessages = [...messages];
    if (config.playerMode && rawUserMsg.toUpperCase().includes('[SWITCH MODE]')) {
      gameState.subMode = gameState.subMode === 'ADVENTURE' ? 'ENCOUNTER' : 'ADVENTURE';
      const modeNote = `[DUNGEON MASTER SYSTEM]: The session has switched to **${gameState.subMode}** mode. ` +
        (gameState.subMode === 'ENCOUNTER'
          ? 'Shift to fast-paced, tactical, tension-filled narration. Focus on combat actions, enemy descriptions, and initiative.'
          : 'Shift to atmospheric, narrative storytelling. Focus on world-building, NPC dialogue, and exploration.');
      // Inject mode switch note as a system message before last user message
      const userIdx = injectedMessages.map(m => m.role).lastIndexOf('user');
      injectedMessages = [
        ...injectedMessages.slice(0, userIdx),
        { role: 'system', content: modeNote },
        ...injectedMessages.slice(userIdx)
      ];
      // Notify chat window
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('submode-change', gameState.subMode);
      }
    }

    // Dice roll detection → inject real result as a DM instruction
    let diceResult = null;
    if (config.playerMode) {
      diceResult = parseDiceExpression(rawUserMsg);
      if (diceResult) {
        const diceCtx = buildDiceContext(diceResult);
        // Insert the dice context right before the last user message
        const userIdx = injectedMessages.map(m => m.role).lastIndexOf('user');
        injectedMessages = [
          ...injectedMessages.slice(0, userIdx),
          { role: 'system', content: diceCtx },
          ...injectedMessages.slice(userIdx)
        ];
        // Push dice result to chat window immediately so UI can show it
        if (chatWindow && !chatWindow.isDestroyed()) {
          chatWindow.webContents.send('dice-rolled', diceResult);
        }
        // React on critical hits / fails
        if (diceResult.sides === 20) {
          if (diceResult.total === 20) {
            if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'laughing');
          } else if (diceResult.total === 1) {
            if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'sad');
          }
        }
      }
    }

    // Log user message to session
    if (config.playerMode && rawUserMsg) {
      gameState.sessionLog.push({ timestamp: Date.now(), role: 'user', content: rawUserMsg });
      if (!gameState.sessionStart) gameState.sessionStart = new Date().toISOString();
    }

    const body = {
      model: config.model,
      messages: hasSystemMsg
        ? injectedMessages
        : [{ role: 'system', content: systemPrompt }, ...injectedMessages.filter(m => m.role !== 'system')],
      stream: true
    };

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://desktop-wizard.local',
          'X-Title': 'Desktop Wizard'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errText = await response.text();
        if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'idle');
        return { error: `API Error ${response.status}: ${errText}` };
      }

      // Stream the response
      if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'talking');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullResponse += delta;
              // Stream chunk to chat window
              if (chatWindow && !chatWindow.isDestroyed()) {
                chatWindow.webContents.send('chat-chunk', delta);
              }
            }
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }

      // Log AI response to session
      if (config.playerMode && fullResponse) {
        gameState.sessionLog.push({ timestamp: Date.now(), role: 'assistant', content: fullResponse });
      }

      // Determine sentiment for emotional state
      const sentiment = analyzeSentiment(fullResponse);
      if (buddyWindow) {
        buddyWindow.webContents.send('wizard-state', sentiment);
        // Return to idle after emotion display
        returnToIdleTimer = setTimeout(() => {
          returnToIdleTimer = null;
          if (buddyWindow && !buddyWindow.isDestroyed()) {
            buddyWindow.webContents.send('wizard-state', 'idle');
          }
        }, 4000);
      }

      // Signal stream complete
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-complete', fullResponse);
      }

      return { content: fullResponse };
    } catch (e) {
      if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'idle');
      return { error: `Network error: ${e.message}` };
    }
  });

  // ── Buddy resize ──
  ipcMain.on('resize-buddy', (_, scale) => {
    if (!buddyWindow) return;
    const { w, h } = getBuddySize(scale);
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    buddyWindow.setSize(w, h);
    buddyWindow.setPosition(width - w - 40, height - h);
  });

  // ── Buddy drag (custom drag handler, no -webkit-app-region) ──
  ipcMain.on('move-buddy', (_, dx, dy) => {
    if (!buddyWindow) return;
    const [x, y] = buddyWindow.getPosition();
    buddyWindow.setPosition(x + dx, y + dy);
  });

  // ── Text-to-Speech ──
  ipcMain.handle('tts-request', async (_, text) => {
    const ttsKey = config.ttsApiKey || config.apiKey;
    if (!ttsKey || !config.ttsEnabled) {
      return { error: 'TTS not configured or disabled' };
    }

    try {
      let audioBuffer;

      if (config.ttsProvider === 'openai') {
        // OpenAI TTS API
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ttsKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.ttsModel || 'tts-1',
            input: text.substring(0, 4096), // API limit
            voice: config.ttsVoice || 'fable',
            speed: config.ttsSpeed || 1.0,
            response_format: 'mp3'
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          return { error: `TTS API Error ${response.status}: ${errText}` };
        }

        const arrayBuf = await response.arrayBuffer();
        audioBuffer = Buffer.from(arrayBuf).toString('base64');

      } else if (config.ttsProvider === 'elevenlabs') {
        // ElevenLabs TTS API
        const voiceId = config.ttsVoice || '21m00Tcm4TlvDq8ikWAM'; // Default Rachel
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'xi-api-key': ttsKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: text.substring(0, 5000),
            model_id: config.ttsModel || 'eleven_monolingual_v1'
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          return { error: `ElevenLabs Error ${response.status}: ${errText}` };
        }

        const arrayBuf = await response.arrayBuffer();
        audioBuffer = Buffer.from(arrayBuf).toString('base64');

      } else if (config.ttsProvider === 'custom') {
        // Custom endpoint — expects OpenAI-compatible API
        const endpoint = config.ttsCustomEndpoint;
        if (!endpoint) return { error: 'Custom TTS endpoint not configured' };

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ttsKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.ttsModel || 'tts-1',
            input: text.substring(0, 4096),
            voice: config.ttsVoice || 'alloy',
            speed: config.ttsSpeed || 1.0,
            response_format: 'mp3'
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          return { error: `Custom TTS Error ${response.status}: ${errText}` };
        }

        const arrayBuf = await response.arrayBuffer();
        audioBuffer = Buffer.from(arrayBuf).toString('base64');
      } else {
        return { error: `Unknown TTS provider: ${config.ttsProvider}` };
      }

      if (!audioBuffer) {
        return { error: 'TTS returned no audio data' };
      }

      // Notify buddy to enter talking state
      if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'talking');

      return { audio: audioBuffer, format: 'mp3' };
    } catch (e) {
      return { error: `TTS network error: ${e.message}` };
    }
  });

  // Window controls
  ipcMain.on('close-chat', () => { if (chatWindow) chatWindow.close(); });
  ipcMain.on('close-settings', () => { if (settingsWindow) settingsWindow.close(); });
  ipcMain.on('minimize-chat', () => { if (chatWindow) chatWindow.minimize(); });
  ipcMain.on('open-chat', () => createChatWindow());
  ipcMain.on('open-settings', () => createSettingsWindow());

  // Manual state override from buddy
  ipcMain.on('set-wizard-state', (_, state) => {
    if (buddyWindow) buddyWindow.webContents.send('wizard-state', state);
  });

  // Weather control
  ipcMain.on('set-weather', (_, data) => {
    config.weatherMode = data.mode || 'none';
    if (typeof data.intensity === 'number') {
      config.weatherIntensity = Math.max(0, Math.min(1, data.intensity));
    }
    saveConfig();
    if (buddyWindow && !buddyWindow.isDestroyed()) {
      buddyWindow.webContents.send('weather-change', {
        mode: config.weatherMode,
        intensity: config.weatherIntensity
      });
    }
  });

  // ── Player / DM Mode toggle ──
  ipcMain.on('set-player-mode', (_, active) => {
    config.playerMode = !!active;
    saveConfig();
    // Reset game state when entering player mode
    if (config.playerMode) {
      gameState.sessionStart = new Date().toISOString();
      gameState.sessionLog = [];
    }
    // Broadcast to all relevant windows
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send('player-mode-change', config.playerMode);
    }
    if (buddyWindow && !buddyWindow.isDestroyed()) {
      buddyWindow.webContents.send('player-mode-change', config.playerMode);
    }
  });

  // ── Game State ──
  ipcMain.handle('get-game-state', () => ({
    party: gameState.party,
    currentQuest: gameState.currentQuest,
    subMode: gameState.subMode,
    sessionStart: gameState.sessionStart,
    sessionLogLength: gameState.sessionLog.length
  }));

  ipcMain.on('reset-game-state', () => {
    gameState = {
      party: [],
      currentQuest: null,
      sessionLog: [],
      subMode: 'ADVENTURE',
      sessionStart: new Date().toISOString()
    };
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send('game-state-reset');
    }
  });

  ipcMain.handle('roll-dice', (_, sides) => {
    const s = parseInt(sides) || 20;
    const result = { sides: s, count: 1, rolls: [rollDie(s)], total: 0 };
    result.total = result.rolls[0];
    return result;
  });

  // Shell utilities & file import
  const { shell, dialog } = require('electron');
  ipcMain.on('open-path', (_, filePath) => {
    shell.showItemInFolder(filePath);
  });

  // ── Import file (character sheet / lore) ──
  ipcMain.handle('import-file', async () => {
    const result = await dialog.showOpenDialog(chatWindow || buddyWindow, {
      title: 'Import Character Sheet or Lore File',
      buttonLabel: 'Import',
      filters: [
        { name: 'Character Sheets & Lore', extensions: ['md', 'txt', 'json'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled || !result.filePaths.length) return null;

    const filePath = result.filePaths[0];
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      // Safety: cap at 20 kB to avoid flooding the context window
      const MAX = 20 * 1024;
      return {
        name: path.basename(filePath),
        content: content.length > MAX
          ? content.slice(0, MAX) + '\n\n[... file truncated at 20 kB ...]'
          : content
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  // ── Character Sheet persistence ──
  ipcMain.handle('save-character-sheet', async (_, sheetData) => {
    try {
      const cfg = loadConfig();
      cfg.characterSheet = sheetData;
      saveConfig(cfg);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('get-character-sheet', async () => {
    try {
      const cfg = loadConfig();
      return cfg.characterSheet || null;
    } catch (e) {
      return null;
    }
  });

  // ── Export Character Sheet as Markdown ──
  ipcMain.handle('export-character-sheet', async (_, d) => {
    const os = require('os');
    const safeName = (d.name || 'character').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const saveResult = await dialog.showSaveDialog(chatWindow || buddyWindow, {
      title: 'Export Character Sheet',
      defaultPath: path.join(os.homedir(), 'Desktop', `${safeName}_sheet.md`),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text',     extensions: ['txt'] }
      ]
    });
    if (saveResult.canceled) return null;

    const pb  = Math.ceil((d.level || 1) / 4) + 1;
    const mod = v => { const m = Math.floor((v || 10) / 2) - 5; return (m >= 0 ? '+' : '') + m; };
    const save = (stat) => {
      const base  = Math.floor(((d.stats || {})[stat] || 10) / 2) - 5;
      const prof  = (d.saves || {})[stat];
      const total = base + (prof ? pb : 0);
      return (total >= 0 ? '+' : '') + total + (prof ? ' ●' : ' ○');
    };

    const md = [
      `# ${d.name || 'Unnamed Hero'}`,
      `*${d.race || '?'} ${d.class || '?'} — Level ${d.level || 1} — ${d.alignment || '?'}*`,
      ``,
      `## Identity`,
      `| Field | Value |`,
      `|---|---|`,
      `| Player | ${d.player || '—'} |`,
      `| Background | ${d.background || '—'} |`,
      `| Experience | ${d.xp || 0} XP |`,
      ``,
      `## Combat`,
      `| HP (Current / Max) | Armor Class | Speed |`,
      `|---|---|---|`,
      `| ${d.hpCur || 0} / ${d.hpMax || 0} | ${d.ac || 10} | ${d.speed || 30} ft |`,
      ``,
      `## Ability Scores`,
      `| STR | DEX | CON | INT | WIS | CHA |`,
      `|---|---|---|---|---|---|`,
      `| ${d.stats?.str||10} (${mod(d.stats?.str)}) | ${d.stats?.dex||10} (${mod(d.stats?.dex)}) | ${d.stats?.con||10} (${mod(d.stats?.con)}) | ${d.stats?.int||10} (${mod(d.stats?.int)}) | ${d.stats?.wis||10} (${mod(d.stats?.wis)}) | ${d.stats?.cha||10} (${mod(d.stats?.cha)}) |`,
      ``,
      `## Saving Throws`,
      `*(● = Proficient, PB: +${pb})*`,
      `| STR | DEX | CON | INT | WIS | CHA |`,
      `|---|---|---|---|---|---|`,
      `| ${save('str')} | ${save('dex')} | ${save('con')} | ${save('int')} | ${save('wis')} | ${save('cha')} |`,
      ``,
      d.equipment ? `## Equipment\n${d.equipment}\n` : '',
      d.features  ? `## Features & Traits\n${d.features}\n` : '',
      d.backstory ? `## Character Backstory\n${d.backstory}\n` : '',
      d.notes     ? `## Notes\n${d.notes}\n` : '',
      `---`,
      `*Exported from Desktop Wizard — ${new Date().toLocaleDateString()}*`
    ].filter(l => l !== undefined).join('\n');

    fs.writeFileSync(saveResult.filePath, md, 'utf-8');
    return { filePath: saveResult.filePath };
  });
}

// ── Simple Sentiment Analysis ──
function analyzeSentiment(text) {
  const lower = text.toLowerCase();

  // Check for laugh triggers
  const laughKeywords = ['haha', 'lol', 'lmao', 'rofl', '😂', '🤣', 'hilarious', 'funny', 'joke', 'hehe'];
  if (laughKeywords.some(k => lower.includes(k))) return 'laughing';

  // Check for sad triggers
  const sadKeywords = ['sorry to hear', 'that\'s terrible', 'condolences', 'unfortunately', 'tragic', 'heartbreaking', 'devastating', 'my sympathies', 'grief'];
  if (sadKeywords.some(k => lower.includes(k))) return 'sad';

  return 'idle';
}

// ── App Lifecycle ──
app.whenReady().then(() => {
  loadConfig();
  createTray();
  createBuddyWindow();
  setupIPC();
  startIdleMonitor();
  startWeatherSync();
});

app.on('window-all-closed', (e) => {
  // Don't quit when all windows close — we live in the tray
  e.preventDefault?.();
});

app.on('before-quit', () => {
  if (idleCheckInterval) clearInterval(idleCheckInterval);
  if (weatherSyncInterval) clearInterval(weatherSyncInterval);
});
