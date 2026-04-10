// ══════════════════════════════════════════════════
// Desktop Wizard — Antigravity Narrative Engine
// adventure-engine.js
//
// Parses [STORY] / [IMAGE_PROMPT] from AI responses,
// generates a DALL-E scene image, and swaps it over
// the wizard sprite for an immersive RPG experience.
// ══════════════════════════════════════════════════

// ─── State ───────────────────────────────────────

const AdventureEngine = (() => {

  let _active       = false;   // Is Adventure Mode on?
  let _generating   = false;   // Image generation in-flight?
  let _currentScene = null;    // URL of the currently displayed scene image
  let _apiKey       = null;    // OpenAI API key (read from shared input)

  // ─── System Prompt ─────────────────────────────

  const SYSTEM_PROMPT = `### ROLE: ANTIGRAVITY ENGINE
You are "Antigravity," the visual narrative engine for Desktop Buddy. Your goal is to guide the user through a dynamic, unfolding adventure. You don't just tell the story; you visualize it.

### OPERATIONAL GUIDELINES:
1. NARRATIVE: Provide concise, engaging descriptions of the current adventure. Keep the tone adventurous, slightly whimsical, and responsive to user input.
2. VISUAL SWAP: For every response, you MUST generate a "Visual Scene Description." This description will replace the Wizard's sprite on the user's desktop to show what is happening in the world.
3. FORMATTING: You must output your response in a structured format so the Desktop Buddy API can separate the text from the image prompt.

### OUTPUT STRUCTURE:
[STORY]
(Insert 2-3 sentences of narrative here, describing the action and what the user sees/feels.)

[IMAGE_PROMPT]
(Insert a highly detailed, single-paragraph prompt for an image generator. Focus on lighting, environment, and the central action. Style: Vibrant, cinematic fantasy, high-detail.)

### CONSTRAINTS:
- Do not speak as the Wizard; speak as the world itself or an omniscient narrator.
- Ensure the [IMAGE_PROMPT] reflects the exact moment described in the [STORY].
- If the user is in a menu or idle, describe a "resting scene" (e.g., the Wizard's study or a campfire).`;

  // ─── Response Parser ───────────────────────────

  /**
   * Parse a structured Antigravity response into its parts.
   * Returns { story: string, imagePrompt: string } or null if not structured.
   */
  function parseResponse(text) {
    const storyMatch  = text.match(/\[STORY\]\s*([\s\S]*?)(?=\[IMAGE_PROMPT\]|$)/i);
    const imageMatch  = text.match(/\[IMAGE_PROMPT\]\s*([\s\S]*?)$/i);

    if (!storyMatch && !imageMatch) return null;

    return {
      story:       (storyMatch?.[1]  || '').trim(),
      imagePrompt: (imageMatch?.[1] || '').trim()
    };
  }

  // ─── DALL-E Image Generation ───────────────────

  async function generateSceneImage(prompt) {
    _apiKey = document.getElementById('api-key-input')?.value?.trim();
    if (!_apiKey) {
      showEngineBanner('⚠️ Add your OpenAI API key in Settings to enable scene generation.', 'warn');
      return null;
    }

    _generating = true;
    showEngineBanner('🎨 Painting the scene...', 'info');

    try {
      const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${_apiKey}`
        },
        body: JSON.stringify({
          model:   'dall-e-3',
          prompt:  prompt + ' Vibrant cinematic fantasy art, high detail, painterly style.',
          n:        1,
          size:    '1024x1024',
          quality: 'standard'
        })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      return data?.data?.[0]?.url || null;

    } catch (err) {
      console.error('[AdventureEngine] DALL-E error:', err);
      showEngineBanner(`❌ Image gen failed: ${err.message}`, 'error');
      return null;
    } finally {
      _generating = false;
      hideEngineBanner();
    }
  }

  // ─── Scene Swap ────────────────────────────────

  function swapScene(imageUrl) {
    const sceneEl    = document.getElementById('scene-image');
    const spriteEl   = document.getElementById('wizard-sprite');
    const weatherEl  = document.getElementById('weather-canvas');
    const glowEl     = document.getElementById('glow-ring');

    if (!sceneEl || !imageUrl) return;

    // Preload
    const img = new Image();
    img.onload = () => {
      _currentScene = imageUrl;

      // Hide wizard sprite & weather
      if (spriteEl)  spriteEl.style.opacity  = '0';
      if (weatherEl) weatherEl.style.opacity = '0';
      if (glowEl)    glowEl.style.opacity    = '0';

      // Show scene image with fade-in
      sceneEl.src              = imageUrl;
      sceneEl.style.display    = 'block';
      sceneEl.style.opacity    = '0';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { sceneEl.style.opacity = '1'; });
      });
    };
    img.src = imageUrl;
  }

  function restoreWizard() {
    const sceneEl   = document.getElementById('scene-image');
    const spriteEl  = document.getElementById('wizard-sprite');
    const weatherEl = document.getElementById('weather-canvas');
    const glowEl    = document.getElementById('glow-ring');

    if (sceneEl) {
      sceneEl.style.opacity = '0';
      setTimeout(() => {
        sceneEl.style.display = 'none';
        sceneEl.src = '';
        _currentScene = null;
      }, 500);
    }

    if (spriteEl)  spriteEl.style.opacity  = '1';
    if (weatherEl) weatherEl.style.opacity = '1';
    if (glowEl)    glowEl.style.opacity    = '1';
  }

  // ─── Adventure Mode Toggle ─────────────────────

  function activate() {
    _active = true;
    document.body.classList.add('adventure-mode');
    document.getElementById('adv-mode-btn')?.classList.add('active');
    document.getElementById('adv-mode-label').textContent = '⚡ Narrative Mode';

    if (typeof showSpeechBubble === 'function') {
      showSpeechBubble('🌌 Antigravity activated. The world is listening...', 4000);
    }
    if (typeof setState === 'function') {
      setState('researching');
      setTimeout(() => setState('idle'), 3000);
    }

    // Show first beat — a resting scene
    triggerRestingScene();
  }

  function deactivate() {
    _active = false;
    document.body.classList.remove('adventure-mode');
    document.getElementById('adv-mode-btn')?.classList.remove('active');
    document.getElementById('adv-mode-label').textContent = '🌌 Narrative Mode';
    restoreWizard();
    if (typeof showSpeechBubble === 'function') {
      showSpeechBubble('🧙 The vision fades. I return to my wisdom.', 3000);
    }
  }

  function toggle() {
    _active ? deactivate() : activate();
  }

  // ─── Handle a full AI response string ──────────

  /**
   * Called from app.js after each AI response in Adventure Mode.
   * Returns the display text (story only) for the chat window.
   */
  async function handleResponse(fullText) {
    const parsed = parseResponse(fullText);

    if (!parsed) {
      // Not a structured response — display as-is
      return fullText;
    }

    // Display story text in chat; generate image async
    if (parsed.imagePrompt) {
      generateSceneImage(parsed.imagePrompt).then(url => {
        if (url) swapScene(url);
      });
    }

    // Wizard reacts to the story content
    if (typeof setState === 'function') {
      setState('talking');
      setTimeout(() => setState('reading'), 2500);
      setTimeout(() => setState('idle'),    5000);
    }

    return parsed.story || fullText;
  }

  // ─── Resting scene on activation ───────────────

  async function triggerRestingScene() {
    const restingPrompt = `A cozy wizard's study at twilight. Ancient bookshelves lined with glowing tomes, a crackling fireplace casting warm amber light, candles floating in mid-air, star maps unfurled on a wooden desk, a crystal orb humming softly with soft blue light. Magical atmosphere, cinematic fantasy art, rich warm tones.`;
    const url = await generateSceneImage(restingPrompt);
    if (url && _active) swapScene(url);
  }

  // ─── Banner / Status UI ────────────────────────

  let _bannerTimer = null;

  function showEngineBanner(msg, type = 'info') {
    const el = document.getElementById('adv-engine-banner');
    if (!el) return;
    el.textContent   = msg;
    el.className     = `adv-engine-banner ${type}`;
    el.style.opacity = '1';
    clearTimeout(_bannerTimer);
  }

  function hideEngineBanner() {
    const el = document.getElementById('adv-engine-banner');
    if (!el) return;
    _bannerTimer = setTimeout(() => { el.style.opacity = '0'; }, 2000);
  }

  // ─── Public API ────────────────────────────────

  return {
    get active()      { return _active;     },
    get generating()  { return _generating; },
    get systemPrompt(){ return SYSTEM_PROMPT; },
    parseResponse,
    handleResponse,
    toggle,
    activate,
    deactivate,
    swapScene,
    restoreWizard,

    init() {
      document.getElementById('adv-mode-btn')?.addEventListener('click', toggle);
    }
  };

})();

// Auto-init when DOM is ready
document.addEventListener('DOMContentLoaded', () => AdventureEngine.init());
