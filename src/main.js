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

    const body = {
      model: config.model,
      messages: hasSystemMsg
        ? messages
        : [{ role: 'system', content: systemPrompt }, ...messages],
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
    // Broadcast to all relevant windows
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send('player-mode-change', config.playerMode);
    }
    if (buddyWindow && !buddyWindow.isDestroyed()) {
      buddyWindow.webContents.send('player-mode-change', config.playerMode);
    }
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
