// ============================================================
// Desktop Wizard — Main Process
// Electron main process: manages tray, windows, idle detection
// ============================================================
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, powerMonitor, nativeImage } = require('electron');
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
  ttsAutoSpeak: false          // Auto-speak all responses
};

let config = { ...DEFAULT_CONFIG };
let tray = null;
let buddyWindow = null;
let chatWindow = null;
let settingsWindow = null;
let idleCheckInterval = null;
let lastActivityTime = Date.now();

// ── Config persistence ──
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      config = { ...DEFAULT_CONFIG, ...data };
    }
  } catch (e) {
    console.error('Config load error:', e);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Config save error:', e);
  }
}

// ── Create Buddy Window (the wizard on screen) ──
function createBuddyWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  buddyWindow = new BrowserWindow({
    width: 180,
    height: 200,
    x: width - 220,
    y: height - 200,
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
      label: '🚪 Dismiss Wizard',
      click: () => app.quit()
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => createChatWindow());
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
  // Config
  ipcMain.handle('get-config', () => config);

  ipcMain.handle('save-config', (_, newConfig) => {
    config = { ...config, ...newConfig };
    saveConfig();
    if (buddyWindow) buddyWindow.webContents.send('config-update', config);
    return config;
  });

  // Chat with OpenRouter
  ipcMain.handle('chat-request', async (_, messages) => {
    if (!config.apiKey) {
      return { error: 'No API key configured. Open Arcane Settings to set your OpenRouter key.' };
    }

    // Check user message for sentiment triggers
    const lastUserMsg = messages[messages.length - 1]?.content?.toLowerCase() || '';
    const userLaughWords = ['haha', 'lol', 'lmao', 'rofl', 'hehe', '😂', '🤣'];
    const userSadWords = ['sad', 'died', 'death', 'depressed', 'terrible', 'awful', 'heartbroken'];

    if (userLaughWords.some(w => lastUserMsg.includes(w))) {
      if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'laughing');
      // Reset after 3 seconds
      setTimeout(() => {
        if (buddyWindow && !buddyWindow.isDestroyed()) {
          buddyWindow.webContents.send('wizard-state', 'researching');
        }
      }, 3000);
    } else if (userSadWords.some(w => lastUserMsg.includes(w))) {
      if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'sad');
      setTimeout(() => {
        if (buddyWindow && !buddyWindow.isDestroyed()) {
          buddyWindow.webContents.send('wizard-state', 'researching');
        }
      }, 3000);
    } else {
      // Notify buddy: thinking state
      if (buddyWindow) buddyWindow.webContents.send('wizard-state', 'researching');
    }

    const systemPrompt = `You are a helpful, slightly eccentric wizard living on the user's desktop. Your tone is knowledgeable but whimsical. You refer to the taskbar as 'The Arcane Ledge.' You are aware of your physical states: if the user is funny, you laugh; if they share bad news, you express somber empathy. Use your 'Researching' state to explain that you are currently consulting the vast libraries of the digital realm (the OpenRouter knowledge base). Keep your responses concise (2-4 sentences unless asked for detail).`;

    const body = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
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
        setTimeout(() => {
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
});

app.on('window-all-closed', (e) => {
  // Don't quit when all windows close — we live in the tray
  e.preventDefault?.();
});

app.on('before-quit', () => {
  if (idleCheckInterval) clearInterval(idleCheckInterval);
});
