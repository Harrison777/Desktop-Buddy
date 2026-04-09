# 🧙 Desktop Wizard — AI Desktop Buddy

An interactive, AI-driven desktop companion built with Electron. The wizard lives on your taskbar, reacts to system idle states, and chats with you via OpenRouter AI.

## Quick Start

```bash
npm install
npm start
```

## Setup

1. **Right-click** the wizard hat icon in the system tray
2. Open **✨ Arcane Settings**
3. Enter your **OpenRouter API Key** (get one at [openrouter.ai/keys](https://openrouter.ai/keys))
4. Select your preferred AI model
5. **Click the wizard** or use **🧙 Summon Chat** from the tray menu

## Features

### 🎭 Behavioral States

| State | Trigger | Animation |
|-------|---------|-----------|
| **Active/Talking** | API streaming response | Mouth movement cycle (frames 1-4) |
| **Thinking** | API request pending | Researching pose |
| **Idle (Short)** | System idle > 2 min | Reading pose |
| **Idle (Long)** | System idle > 2 hours | Sleeping pose + Z bubbles |
| **Happy/Laugh** | Keywords: "haha", "lol" | Laughing frame (3 seconds) |
| **Sad** | Sad keywords detected | Droopy hat pose |

### 🗂 Sprite Sheet Layout

The sprite sheet (`assets/wizard_spritesheet.png`) is a horizontal strip with 128×128 frames:

```
Frame 0: Neutral Idle
Frames 1-4: Talking Loop
Frame 5: Reading
Frame 6: Sleeping
Frame 7: Laughing
Frame 8: Sad
Frame 9: Researching
```

### 🔧 Architecture

- **Main Process** (`src/main.js`): Tray, windows, idle detection, OpenRouter API
- **Buddy Window** (`src/buddy.html`): Canvas sprite renderer with state machine
- **Chat Window** (`src/chat.html`): Streaming chat UI with glassmorphism design
- **Settings** (`src/settings.html`): API key, model selection, behavior tweaks
- **Preload** (`src/preload.js`): Secure IPC bridge

### 🖼 Custom Sprite Sheet

Replace `assets/wizard_spritesheet.png` with your own 1280×128 horizontal strip (10 frames of 128×128 each). Update `assets/index.json` if frame mapping changes.

## Tray Icon

Place your custom `wizard_hat_icon.ico` in the `assets/` folder for the system tray. Falls back to `.png` if `.ico` is not found.
