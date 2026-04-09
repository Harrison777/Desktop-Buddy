// ============================================================
// Desktop Wizard — Preload Script
// Exposes safe IPC bridge to renderer processes
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wizard', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),

  // Chat
  sendChat: (messages) => ipcRenderer.invoke('chat-request', messages),

  // Events from main
  onConfigUpdate: (cb) => ipcRenderer.on('config-update', (_, data) => cb(data)),
  onWizardState: (cb) => ipcRenderer.on('wizard-state', (_, state) => cb(state)),
  onIdleUpdate: (cb) => ipcRenderer.on('idle-update', (_, data) => cb(data)),
  onChatChunk: (cb) => ipcRenderer.on('chat-chunk', (_, chunk) => cb(chunk)),
  onChatComplete: (cb) => ipcRenderer.on('chat-complete', (_, full) => cb(full)),

  // TTS
  requestTTS: (text) => ipcRenderer.invoke('tts-request', text),
  ttsStopped: () => ipcRenderer.send('set-wizard-state', 'idle'),

  // Window controls
  resizeBuddy: (scale) => ipcRenderer.send('resize-buddy', scale),
  moveBuddy: (dx, dy) => ipcRenderer.send('move-buddy', dx, dy),
  closeChat: () => ipcRenderer.send('close-chat'),
  closeSettings: () => ipcRenderer.send('close-settings'),
  minimizeChat: () => ipcRenderer.send('minimize-chat'),
  openChat: () => ipcRenderer.send('open-chat'),
  openSettings: () => ipcRenderer.send('open-settings'),
  setWizardState: (state) => ipcRenderer.send('set-wizard-state', state),
});
