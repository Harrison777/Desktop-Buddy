// ══════════════════════════════════════════════════
// Desktop Wizard — RPG Toolkit (rpg.js)
// Dice Roller · Character Sheet · Campaign Notes
// ══════════════════════════════════════════════════

// ─────────────────────────────────────────────────
// SECTION: Config & Storage Helpers
// ─────────────────────────────────────────────────

const RPG_STORAGE_KEY = 'wizard-rpg-data';

function loadRpgData() {
  try {
    const raw = localStorage.getItem(RPG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : { character: null, notes: {} };
  } catch { return { character: null, notes: {} }; }
}

function saveRpgData(data) {
  try { localStorage.setItem(RPG_STORAGE_KEY, JSON.stringify(data)); } catch {}
}

let rpgData = loadRpgData();

// ─────────────────────────────────────────────────
// SECTION: Tab Navigation
// ─────────────────────────────────────────────────

function initTabs() {
  const tabBtns = document.querySelectorAll('.rpg-tab');
  const tabPanes = document.querySelectorAll('.rpg-tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(`tab-${btn.dataset.tab}`);
      if (target) target.classList.add('active');
    });
  });
}

// ─────────────────────────────────────────────────
// SECTION: Dice Roller
// ─────────────────────────────────────────────────

let diceModifier = 0;
const rollHistory = [];
const MAX_HISTORY = 20;

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function getRollComment(roll, max, mod) {
  const total = roll + mod;
  if (roll === max)  return { text: '⚡ Critical!',  state: 'laughing' };
  if (roll === 1)    return { text: '💀 Nat 1!',      state: 'sad' };
  if (total >= max * 0.85) return { text: '🔥 Great roll!', state: 'laughing' };
  if (total <= max * 0.2)  return { text: '😬 Rough...',    state: 'sad' };
  return { text: '🎲 Rolled!', state: null };
}

function rollDiceSet(sides, count, modifier) {
  const rolls = Array.from({ length: count }, () => rollDie(sides));
  const rawTotal = rolls.reduce((a, b) => a + b, 0);
  const total    = rawTotal + modifier;
  return { rolls, rawTotal, total, sides, count, modifier };
}

function pushHistory(result) {
  rollHistory.unshift(result);
  if (rollHistory.length > MAX_HISTORY) rollHistory.length = MAX_HISTORY;
  renderHistory();
}

function renderHistory() {
  const el = document.getElementById('roll-history');
  if (!el) return;
  el.innerHTML = rollHistory.map(r => {
    const modStr = r.modifier !== 0 ? ` ${r.modifier > 0 ? '+' : ''}${r.modifier}` : '';
    const label  = r.expr ? r.expr : `${r.count}d${r.sides}${modStr}`;
    return `<div class="history-row">
      <span class="history-label">${label}</span>
      <span class="history-total ${r.isCrit ? 'crit' : r.isFumble ? 'fumble' : ''}">${r.total}</span>
    </div>`;
  }).join('');
}

function animateResult(total, sides, isCrit, isFumble) {
  const boxEl  = document.getElementById('dice-result-box');
  const mainEl = document.getElementById('dice-result-main');
  if (!mainEl) return;

  // Flash animation
  boxEl?.classList.remove('result-flash');
  void boxEl?.offsetWidth; // reflow
  boxEl?.classList.add('result-flash');

  if (isCrit) boxEl?.classList.add('result-crit');
  else if (isFumble) boxEl?.classList.add('result-fumble');
  else { boxEl?.classList.remove('result-crit', 'result-fumble'); }

  // Briefly scramble number
  let ticks = 0;
  const interval = setInterval(() => {
    mainEl.textContent = Math.floor(Math.random() * sides) + 1;
    if (++ticks > 6) {
      clearInterval(interval);
      mainEl.textContent = total;
    }
  }, 60);
}

function handleRoll(sides) {
  const count    = parseInt(document.getElementById('dice-count')?.value || '1', 10);
  const modifier = diceModifier;
  const result   = rollDiceSet(sides, count, modifier);

  const isCrit   = sides === 20 && result.rolls.includes(20);
  const isFumble = sides === 20 && result.rolls.includes(1);
  const comment  = getRollComment(result.rawTotal, sides * count, modifier);

  // Breakdown text
  const breakEl = document.getElementById('dice-result-breakdown');
  const modStr  = modifier !== 0 ? ` ${modifier > 0 ? '+' : ''}${modifier}` : '';
  if (breakEl) {
    breakEl.textContent = count > 1
      ? `[${result.rolls.join(' + ')}]${modStr} = ${result.total}`
      : (modifier !== 0 ? `${result.rawTotal}${modStr} = ${result.total}` : '');
  }

  animateResult(result.total, sides, isCrit, isFumble);

  // Wizard reaction
  if (comment.state) {
    // setState is defined in app.js, available globally
    if (typeof setState === 'function') setState(comment.state);
    setTimeout(() => { if (typeof setState === 'function') setState('idle'); }, 3000);
  }

  if (typeof showSpeechBubble === 'function') {
    const msgs = isCrit   ? ['⚡ A critical strike! The gods favor you!', '🔥 Natural 20! Glory!', '✨ Magnificent! The stars align!']
               : isFumble ? ['💀 A natural 1... unfortunate.', '😔 The dice have forsaken you.', '🌧️ Even the ancients cringe.']
               : [comment.text];
    const msg = msgs[Math.floor(Math.random() * msgs.length)];
    showSpeechBubble(msg, 3000);
  }

  // Save to history
  result.isCrit   = isCrit;
  result.isFumble = isFumble;
  pushHistory(result);
}

function parseExpr(expr) {
  // Supports: d20, 2d6, 2d6+3, d20-1, 3d8+2
  const m = expr.trim().toLowerCase().match(/^(\d+)?d(\d+)([+-]\d+)?$/);
  if (!m) return null;
  return {
    count:    parseInt(m[1] || '1', 10),
    sides:    parseInt(m[2], 10),
    modifier: parseInt(m[3] || '0', 10)
  };
}

function handleCustomRoll() {
  const input = document.getElementById('dice-expr');
  if (!input) return;
  const parsed = parseExpr(input.value);
  if (!parsed) {
    if (typeof showSpeechBubble === 'function') showSpeechBubble('🤔 Invalid dice expression. Try: 2d6+3', 2500);
    return;
  }

  const result   = rollDiceSet(parsed.sides, parsed.count, parsed.modifier);
  const isCrit   = parsed.sides === 20 && result.rolls.includes(20);
  const isFumble = parsed.sides === 20 && result.rolls.includes(1);

  const breakEl = document.getElementById('dice-result-breakdown');
  const modStr  = parsed.modifier !== 0 ? ` ${parsed.modifier > 0 ? '+' : ''}${parsed.modifier}` : '';
  if (breakEl) {
    breakEl.textContent = parsed.count > 1
      ? `[${result.rolls.join(' + ')}]${modStr} = ${result.total}`
      : (parsed.modifier !== 0 ? `${result.rawTotal}${modStr} = ${result.total}` : '');
  }

  animateResult(result.total, parsed.sides, isCrit, isFumble);
  result.expr = input.value.trim();
  result.isCrit   = isCrit;
  result.isFumble = isFumble;
  pushHistory(result);
}

function initDice() {
  // Modifier buttons
  document.getElementById('mod-minus')?.addEventListener('click', () => {
    diceModifier = Math.max(-10, diceModifier - 1);
    updateModDisplay();
  });
  document.getElementById('mod-plus')?.addEventListener('click', () => {
    diceModifier = Math.min(20, diceModifier + 1);
    updateModDisplay();
  });

  // Die buttons
  document.querySelectorAll('.die-btn').forEach(btn => {
    btn.addEventListener('click', () => handleRoll(parseInt(btn.dataset.sides, 10)));
  });

  // Custom expression
  document.getElementById('dice-expr-roll')?.addEventListener('click', handleCustomRoll);
  document.getElementById('dice-expr')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleCustomRoll();
  });
}

function updateModDisplay() {
  const el = document.getElementById('mod-display');
  if (el) el.textContent = diceModifier >= 0 ? `+${diceModifier}` : `${diceModifier}`;
}

// ─────────────────────────────────────────────────
// SECTION: Character Sheet
// ─────────────────────────────────────────────────

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const SKILLS = [
  { name: 'Acrobatics',      ability: 'dex' },
  { name: 'Animal Handling', ability: 'wis' },
  { name: 'Arcana',          ability: 'int' },
  { name: 'Athletics',       ability: 'str' },
  { name: 'Deception',       ability: 'cha' },
  { name: 'History',         ability: 'int' },
  { name: 'Insight',         ability: 'wis' },
  { name: 'Intimidation',    ability: 'cha' },
  { name: 'Investigation',   ability: 'int' },
  { name: 'Medicine',        ability: 'wis' },
  { name: 'Nature',          ability: 'int' },
  { name: 'Perception',      ability: 'wis' },
  { name: 'Performance',     ability: 'cha' },
  { name: 'Persuasion',      ability: 'cha' },
  { name: 'Religion',        ability: 'int' },
  { name: 'Sleight of Hand', ability: 'dex' },
  { name: 'Stealth',         ability: 'dex' },
  { name: 'Survival',        ability: 'wis' },
];

function abilityMod(score) {
  return Math.floor((score - 10) / 2);
}

function modStr(m) {
  return m >= 0 ? `+${m}` : `${m}`;
}

function profBonus(level) {
  return Math.ceil(level / 4) + 1;
}

function renderSheet(char) {
  if (!char) {
    document.getElementById('sheet-empty').style.display   = '';
    document.getElementById('sheet-display').style.display = 'none';
    document.getElementById('sheet-form').style.display    = 'none';
    return;
  }

  document.getElementById('sheet-empty').style.display   = 'none';
  document.getElementById('sheet-form').style.display    = 'none';
  document.getElementById('sheet-display').style.display = '';

  const lvl  = char.level || 1;
  const prof  = profBonus(lvl);

  // Identity
  document.getElementById('sh-name').textContent  = char.name    || 'Unknown Hero';
  document.getElementById('sh-race').textContent  = char.race    || '—';
  document.getElementById('sh-class').textContent = char.class   || '—';
  document.getElementById('sh-level').textContent = `Lv ${lvl}`;

  // Vitals
  document.getElementById('sh-hp-max').value     = char.hpMax   || '';
  document.getElementById('sh-hp-cur').value     = char.hpCur   != null ? char.hpCur : (char.hpMax || '');
  document.getElementById('sh-ac').value         = char.ac      || '';
  document.getElementById('sh-speed').textContent = char.speed != null ? `${char.speed} ft` : '—';

  // Ability scores
  ABILITY_KEYS.forEach(ab => {
    const score = char[ab] || 10;
    const mod   = abilityMod(score);
    document.getElementById(`sh-${ab}`).textContent     = score;
    document.getElementById(`sh-${ab}-mod`).textContent = modStr(mod);
  });

  // Prof bonus + initiative
  document.getElementById('sh-prof').textContent = modStr(prof);
  const initMod = abilityMod(char.dex || 10);
  document.getElementById('sh-init').textContent = modStr(initMod);

  // Inspiration badge
  const inspBtn = document.getElementById('sh-insp-btn');
  if (inspBtn) {
    inspBtn.textContent = char.inspiration ? '★' : '☆';
    inspBtn.classList.toggle('active', !!char.inspiration);
  }

  // Skills
  const skillsGrid = document.getElementById('sh-skills-grid');
  if (skillsGrid) {
    skillsGrid.innerHTML = SKILLS.map(s => {
      const baseM = abilityMod(char[s.ability] || 10);
      const isProficient = (char.skillProficiencies || []).includes(s.name);
      const total = baseM + (isProficient ? prof : 0);
      return `<div class="skill-row ${isProficient ? 'proficient' : ''}">
        <span class="skill-dot">${isProficient ? '●' : '○'}</span>
        <span class="skill-name">${s.name}</span>
        <span class="skill-bonus">${modStr(total)}</span>
      </div>`;
    }).join('');
  }

  // Saving throws
  const savesGrid = document.getElementById('sh-saves-grid');
  if (savesGrid) {
    savesGrid.innerHTML = ABILITY_KEYS.map(ab => {
      const baseM = abilityMod(char[ab] || 10);
      const isProficient = (char.saveProficiencies || []).includes(ab);
      const total = baseM + (isProficient ? prof : 0);
      return `<div class="skill-row ${isProficient ? 'proficient' : ''}">
        <span class="skill-dot">${isProficient ? '●' : '○'}</span>
        <span class="skill-name">${ab.toUpperCase()}</span>
        <span class="skill-bonus">${modStr(total)}</span>
      </div>`;
    }).join('');
  }

  // Features
  const featuresList = document.getElementById('sh-features');
  if (featuresList) {
    const features = char.features || [];
    featuresList.innerHTML = features.length
      ? features.map(f => `<div class="feature-item"><strong>${f.name || f}</strong>${f.desc ? `<p>${f.desc}</p>` : ''}</div>`).join('')
      : '<p class="muted-text">No features listed.</p>';
  }
}

/** Parse a Beyond20 / DnDBeyond exported JSON (common community format) */
function parseCharJson(raw) {
  // Try the DnDBeyond / Beyond20 export format
  if (raw.character) raw = raw.character;

  const abMap  = {};
  const statIds = { 1:'str', 2:'dex', 3:'con', 4:'int', 5:'wis', 6:'cha' };

  if (Array.isArray(raw.stats)) {
    raw.stats.forEach(s => {
      const key = statIds[s.id];
      if (key) abMap[key] = s.value;
    });
  }

  // Base stats already at top level (manual or simple format)
  ['str','dex','con','int','wis','cha'].forEach(ab => {
    if (!abMap[ab] && raw[ab]) abMap[ab] = raw[ab];
  });

  // Class
  let className = raw.class || '';
  if (Array.isArray(raw.classes) && raw.classes.length) {
    className = raw.classes.map(c => c.definition?.name || c.name || '').filter(Boolean).join(' / ');
  }

  // HP
  const hpMax = raw.baseHitPoints || raw.hpMax || (raw.hitPoints?.max) || null;
  const hpCur = raw.removedHitPoints != null ? hpMax - raw.removedHitPoints : (raw.hpCur || hpMax);

  // AC (simplified — just use base)
  const ac = raw.armorClass || raw.ac || null;

  // Race
  const race = raw.race?.fullName || raw.race?.baseName || raw.race || raw.species || null;

  // Level
  const level = raw.level || (Array.isArray(raw.classes) ? raw.classes.reduce((s, c) => s + (c.level || 0), 0) : 1) || 1;

  // Speed
  const speed = raw.speed?.walk || raw.walkSpeed || raw.speed || null;

  // Features
  const features = (raw.classFeatures || raw.racialFeatures || raw.features || [])
    .slice(0, 20)
    .map(f => ({ name: f.definition?.name || f.name || String(f), desc: f.definition?.description || f.desc || '' }));

  return {
    name:  raw.name || 'Unknown Hero',
    class: className,
    race:  typeof race === 'string' ? race : (race?.name || '—'),
    level,
    hpMax, hpCur, ac, speed,
    ...abMap,
    features,
    skillProficiencies: raw.skillProficiencies || [],
    saveProficiencies:  raw.saveProficiencies  || [],
    inspiration: raw.inspiration || false
  };
}

function loadSheetFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const raw  = JSON.parse(reader.result);
      const char = parseCharJson(raw);
      rpgData.character = char;
      saveRpgData(rpgData);
      renderSheet(char);

      if (typeof showSpeechBubble === 'function') {
        showSpeechBubble(`📋 ${char.name}, ${char.race} ${char.class} — Level ${char.level}. A worthy adventurer!`, 5000);
      }
      if (typeof setState === 'function') {
        setState('researching');
        setTimeout(() => setState('idle'), 3000);
      }
    } catch (e) {
      console.error('Sheet parse error:', e);
      if (typeof showSpeechBubble === 'function') {
        showSpeechBubble('❌ Could not read that JSON. Is it a valid character export?', 3000);
      }
    }
  };
  reader.readAsText(file);
}

function saveManualSheet() {
  const get = id => document.getElementById(id)?.value?.trim() || '';
  const getNum = (id, def = 10) => parseInt(document.getElementById(id)?.value || def, 10) || def;

  const char = {
    name:   get('fm-name') || 'Unnamed Hero',
    class:  get('fm-class'),
    race:   get('fm-race'),
    level:  getNum('fm-level', 1),
    hpMax:  getNum('fm-hp', 10),
    hpCur:  getNum('fm-hp', 10),
    ac:     getNum('fm-ac', 10),
    speed:  getNum('fm-speed', 30),
    str: getNum('fm-str', 10),
    dex: getNum('fm-dex', 10),
    con: getNum('fm-con', 10),
    int: getNum('fm-int', 10),
    wis: getNum('fm-wis', 10),
    cha: getNum('fm-cha', 10),
    features: [],
    skillProficiencies: [],
    saveProficiencies: []
  };

  rpgData.character = char;
  saveRpgData(rpgData);
  renderSheet(char);
}

function initCharSheet() {
  const importBtn   = document.getElementById('sheet-import-btn');
  const fileInput   = document.getElementById('sheet-file-input');
  const clearBtn    = document.getElementById('sheet-clear-btn');
  const manualBtn   = document.getElementById('sheet-manual-btn');
  const fmSaveBtn   = document.getElementById('fm-save-btn');
  const fmCancelBtn = document.getElementById('fm-cancel-btn');
  const inspBtn     = document.getElementById('sh-insp-btn');

  importBtn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    if (fileInput.files[0]) loadSheetFromFile(fileInput.files[0]);
    fileInput.value = '';
  });

  clearBtn?.addEventListener('click', () => {
    rpgData.character = null;
    saveRpgData(rpgData);
    renderSheet(null);
  });

  manualBtn?.addEventListener('click', () => {
    document.getElementById('sheet-empty').style.display   = 'none';
    document.getElementById('sheet-display').style.display = 'none';
    document.getElementById('sheet-form').style.display    = '';
  });

  fmCancelBtn?.addEventListener('click', () => {
    renderSheet(rpgData.character);
  });

  fmSaveBtn?.addEventListener('click', () => {
    saveManualSheet();
    if (typeof showSpeechBubble === 'function') {
      showSpeechBubble('📋 Character saved to the arcane records!', 3000);
    }
  });

  inspBtn?.addEventListener('click', () => {
    if (!rpgData.character) return;
    rpgData.character.inspiration = !rpgData.character.inspiration;
    saveRpgData(rpgData);
    inspBtn.textContent = rpgData.character.inspiration ? '★' : '☆';
    inspBtn.classList.toggle('active', rpgData.character.inspiration);
    if (typeof showSpeechBubble === 'function') {
      showSpeechBubble(
        rpgData.character.inspiration ? '⭐ Inspiration granted! The bards shall sing of this!' : '☆ Inspiration spent.',
        2500
      );
    }
  });

  // HP live-tracking — save changes as they're typed
  ['sh-hp-cur', 'sh-hp-max', 'sh-ac'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      if (!rpgData.character) return;
      const hpCur = parseInt(document.getElementById('sh-hp-cur')?.value || '0', 10);
      const hpMax = parseInt(document.getElementById('sh-hp-max')?.value || '0', 10);
      const ac    = parseInt(document.getElementById('sh-ac')?.value    || '0', 10);
      rpgData.character.hpCur = hpCur;
      rpgData.character.hpMax = hpMax;
      rpgData.character.ac    = ac;
      saveRpgData(rpgData);

      // Wizard reacts to low HP
      if (hpMax > 0 && hpCur / hpMax < 0.2 && hpCur > 0) {
        if (typeof showSpeechBubble === 'function') showSpeechBubble('⚠️ You are gravely wounded! Seek a healer!', 3000);
        if (typeof setState === 'function') { setState('sad'); setTimeout(() => setState('idle'), 3000); }
      } else if (hpCur <= 0) {
        if (typeof showSpeechBubble === 'function') showSpeechBubble('💀 You have fallen! Death approaches!', 3000);
        if (typeof setState === 'function') { setState('sad'); setTimeout(() => setState('idle'), 4000); }
      }
    });
  });

  // Render saved character on load
  renderSheet(rpgData.character);
}

// ─────────────────────────────────────────────────
// SECTION: Campaign Notes
// ─────────────────────────────────────────────────

let activeSessionKey = null;

function getNotesKeys() {
  return Object.keys(rpgData.notes || {}).sort((a, b) => {
    // Sort by timestamp embedded in key
    const ta = parseInt(a.split('_')[1] || 0, 10);
    const tb = parseInt(b.split('_')[1] || 0, 10);
    return tb - ta;
  });
}

function renderNotesList() {
  const list = document.getElementById('notes-session-list');
  if (!list) return;
  const keys = getNotesKeys();

  list.innerHTML = keys.map(key => {
    const session = rpgData.notes[key];
    const isActive = key === activeSessionKey;
    return `<div class="session-item ${isActive ? 'active' : ''}" data-key="${key}">
      <span class="session-item-name">${session.name || 'Unnamed Session'}</span>
      <button class="session-delete-btn" data-key="${key}" title="Delete">✕</button>
    </div>`;
  }).join('');

  // Click to load
  list.querySelectorAll('.session-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('session-delete-btn')) return;
      loadSession(item.dataset.key);
    });
  });

  // Delete buttons
  list.querySelectorAll('.session-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      delete rpgData.notes[key];
      saveRpgData(rpgData);
      if (activeSessionKey === key) {
        activeSessionKey = null;
        const area = document.getElementById('notes-area');
        if (area) area.value = '';
        updateNotesStatus('No session selected');
      }
      renderNotesList();
    });
  });
}

function loadSession(key) {
  activeSessionKey = key;
  const session = rpgData.notes[key];
  const area = document.getElementById('notes-area');
  if (area && session) area.value = session.content || '';
  updateNotesStatus(`Session: ${session?.name || key}`);
  renderNotesList();
}

function saveCurrentSession() {
  if (!activeSessionKey) return;
  const area = document.getElementById('notes-area');
  const content = area?.value || '';
  if (!rpgData.notes[activeSessionKey]) rpgData.notes[activeSessionKey] = {};
  rpgData.notes[activeSessionKey].content = content;
  saveRpgData(rpgData);
  updateNotesStatus(`Saved: ${rpgData.notes[activeSessionKey].name}`);
  setTimeout(() => updateNotesStatus(`Session: ${rpgData.notes[activeSessionKey].name}`), 2000);
}

function createNewSession() {
  const nameInput = document.getElementById('notes-session-name');
  const rawName   = nameInput?.value.trim() || '';
  const name      = rawName || `Session ${Object.keys(rpgData.notes || {}).length + 1}`;
  const key       = `session_${Date.now()}`;

  if (!rpgData.notes) rpgData.notes = {};
  rpgData.notes[key] = { name, content: '', createdAt: Date.now() };
  saveRpgData(rpgData);
  if (nameInput) nameInput.value = '';
  renderNotesList();
  loadSession(key);
}

function exportNotes() {
  const keys = getNotesKeys();
  if (!keys.length) {
    if (typeof showSpeechBubble === 'function') showSpeechBubble('📜 No notes to export yet!', 2000);
    return;
  }
  const lines = keys.map(k => {
    const s = rpgData.notes[k];
    return `# ${s.name}\n\n${s.content || '(empty)'}`;
  });
  const blob = new Blob([lines.join('\n\n---\n\n')], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'campaign-notes.md' });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function updateNotesStatus(text) {
  const el = document.getElementById('notes-status');
  if (el) el.textContent = text;
}

// Auto-save notes when user stops typing
let notesAutoSaveTimer = null;
function scheduleAutoSave() {
  clearTimeout(notesAutoSaveTimer);
  notesAutoSaveTimer = setTimeout(() => {
    if (activeSessionKey) saveCurrentSession();
  }, 1500);
}

function initNotes() {
  document.getElementById('notes-new-btn')?.addEventListener('click', createNewSession);
  document.getElementById('notes-save-btn')?.addEventListener('click', saveCurrentSession);
  document.getElementById('notes-export-btn')?.addEventListener('click', exportNotes);
  document.getElementById('notes-area')?.addEventListener('input', scheduleAutoSave);

  // Allow pressing Enter in session name to create
  document.getElementById('notes-session-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createNewSession();
  });

  renderNotesList();

  // Load the most recent session automatically
  const keys = getNotesKeys();
  if (keys.length) loadSession(keys[0]);
  else updateNotesStatus('Create a new session to start taking notes');
}

// ─────────────────────────────────────────────────
// SECTION: Adventure / Campaign Import
// ─────────────────────────────────────────────────

let adventure = null; // currently loaded adventure object

/** Load adventure from localStorage on boot */
function loadAdventureData() {
  try {
    const raw = localStorage.getItem('wizard-adventure');
    if (raw) adventure = JSON.parse(raw);
  } catch {}
}

function saveAdventureData() {
  try {
    if (adventure) localStorage.setItem('wizard-adventure', JSON.stringify(adventure));
    else localStorage.removeItem('wizard-adventure');
  } catch {}
}

// ── Parsers ──────────────────────────────────────

/** Parse a structured JSON campaign file.
 *  Expected shape (flexible):
 *  { title, author, system, overview, chapters: [{ title, content }] }
 *  OR array of chapters directly.
 */
function parseAdventureJson(raw) {
  const chapters = [];
  const src = Array.isArray(raw) ? { chapters: raw } : raw;

  (src.chapters || src.sections || src.acts || []).forEach((ch, i) => {
    chapters.push({
      index: i,
      title: ch.title || ch.name || `Chapter ${i + 1}`,
      content: ch.content || ch.description || ch.text || ch.body || ''
    });
  });

  // If flat JSON with text property — treat whole thing as single chapter
  if (!chapters.length && (src.content || src.text || src.body)) {
    chapters.push({ index: 0, title: 'Full Text', content: src.content || src.text || src.body });
  }

  return {
    title:    src.title    || src.name    || 'Unnamed Adventure',
    author:   src.author   || src.creator || '',
    system:   src.system   || src.game    || '',
    overview: src.overview || src.synopsis || src.description || src.intro || '',
    chapters
  };
}

/** Parse a Markdown file — H1 becomes title, H2/H3 become chapters */
function parseAdventureMarkdown(text) {
  const lines = text.split('\n');
  let title    = 'Unnamed Adventure';
  let overview = '';
  const chapters = [];
  let current  = null;

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)/);
    const h2 = line.match(/^#{2,3}\s+(.+)/);

    if (h1 && title === 'Unnamed Adventure') {
      title = h1[1].trim();
      continue;
    }
    if (h2) {
      if (current) chapters.push(current);
      current = { index: chapters.length, title: h2[1].trim(), content: '' };
      continue;
    }
    if (current) {
      current.content += line + '\n';
    } else {
      overview += line + '\n';
    }
  }
  if (current) chapters.push(current);

  return {
    title,
    author: '',
    system: '',
    overview: overview.trim(),
    chapters
  };
}

/** Parse plain text — split on double newlines into "entries" */
function parseAdventurePlainText(text) {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  // First paragraph → overview; rest → numbered entries
  const overview = paragraphs[0] || '';
  const chapters = paragraphs.slice(1).map((p, i) => ({
    index: i,
    title: `Entry ${i + 1}`,
    content: p
  }));

  // Try to extract a title from first line
  const firstLine = text.split('\n')[0].trim().replace(/^#+\s*/, '');
  return {
    title: firstLine || 'Unnamed Adventure',
    author: '',
    system: '',
    overview,
    chapters
  };
}

// ── Rendering ────────────────────────────────────

function renderAdventure() {
  const empty   = document.getElementById('adv-empty');
  const display = document.getElementById('adv-display');
  const viewer  = document.getElementById('adv-content-viewer');

  if (!adventure) {
    if (empty)   empty.style.display   = '';
    if (display) display.style.display = 'none';
    return;
  }

  if (empty)   empty.style.display   = 'none';
  if (display) display.style.display = '';
  if (viewer)  viewer.style.display  = 'none';

  // Title & meta
  const titleEl = document.getElementById('adv-title');
  const metaEl  = document.getElementById('adv-meta');
  if (titleEl) titleEl.textContent = adventure.title;
  if (metaEl) {
    const parts = [];
    if (adventure.system) parts.push(adventure.system);
    if (adventure.author) parts.push(`by ${adventure.author}`);
    parts.push(`${adventure.chapters.length} chapter${adventure.chapters.length !== 1 ? 's' : ''}`);
    metaEl.textContent = parts.join(' · ');
  }

  // Overview
  const overviewEl = document.getElementById('adv-overview');
  if (overviewEl) {
    overviewEl.textContent = adventure.overview || '';
    overviewEl.style.display = adventure.overview ? '' : 'none';
  }

  renderChapterList(adventure.chapters);
}

function renderChapterList(chapters) {
  const sectionsEl = document.getElementById('adv-sections');
  if (!sectionsEl) return;

  if (!chapters.length) {
    sectionsEl.innerHTML = '<p class="muted-text">No chapters found in this file.</p>';
    return;
  }

  sectionsEl.innerHTML = chapters.map((ch, i) => `
    <div class="adv-chapter-item" data-index="${i}">
      <span class="adv-chapter-num">${i + 1}</span>
      <span class="adv-chapter-title">${escHtml(ch.title)}</span>
      <span class="adv-chapter-arrow">›</span>
    </div>
  `).join('');

  sectionsEl.querySelectorAll('.adv-chapter-item').forEach(item => {
    item.addEventListener('click', () => openChapter(parseInt(item.dataset.index, 10)));
  });
}

function openChapter(index) {
  if (!adventure) return;
  const ch = adventure.chapters[index];
  if (!ch) return;

  document.getElementById('adv-sections').style.display           = 'none';
  document.getElementById('adv-overview').style.display           = 'none';
  document.getElementById('adv-search-row') && (document.querySelector('.adv-search-row').style.display = 'none');
  document.getElementById('adv-content-viewer').style.display     = '';
  document.getElementById('adv-content-title').textContent        = ch.title;
  document.getElementById('adv-content-body').innerHTML           = markdownToHtml(ch.content);

  if (typeof showSpeechBubble === 'function') {
    showSpeechBubble(`📖 "${ch.title}" — reading the scrolls...`, 3000);
  }
  if (typeof setState === 'function') {
    setState('reading');
    setTimeout(() => setState('idle'), 4000);
  }

  // Expose current chapter for chat context
  window._adventureChapter = { title: ch.title, content: ch.content.slice(0, 800) };
}

function closeChapterViewer() {
  document.getElementById('adv-content-viewer').style.display = 'none';
  document.getElementById('adv-sections').style.display       = '';
  document.querySelector('.adv-search-row').style.display     = '';
  if (adventure?.overview) document.getElementById('adv-overview').style.display = '';
  window._adventureChapter = null;
}

// ── Search ───────────────────────────────────────

function filterChapters(query) {
  if (!adventure) return;
  const q = query.toLowerCase().trim();
  const filtered = q
    ? adventure.chapters.filter(ch =>
        ch.title.toLowerCase().includes(q) ||
        ch.content.toLowerCase().includes(q)
      )
    : adventure.chapters;
  renderChapterList(filtered);
}

// ── Helpers ──────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Minimal Markdown → HTML for chapter content display */
function markdownToHtml(text) {
  if (!text) return '<p class="muted-text">No content for this chapter.</p>';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#{3}\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^#{2}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{1}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(.+)/, '<p>$1')
    .replace(/(.+)$/, '$1</p>');
}

// ── Init ─────────────────────────────────────────

function initAdventure() {
  loadAdventureData();

  const importBtn = document.getElementById('adv-import-btn');
  const fileInput = document.getElementById('adv-file-input');
  const clearBtn  = document.getElementById('adv-clear-btn');
  const searchEl  = document.getElementById('adv-search');
  const backBtn   = document.getElementById('adv-back-btn');

  importBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const ext  = file.name.split('.').pop().toLowerCase();
      try {
        if (ext === 'json') {
          adventure = parseAdventureJson(JSON.parse(text));
        } else if (ext === 'md' || ext === 'markdown') {
          adventure = parseAdventureMarkdown(text);
        } else {
          adventure = parseAdventurePlainText(text);
        }
        saveAdventureData();
        renderAdventure();

        if (typeof showSpeechBubble === 'function') {
          showSpeechBubble(`⚔️ "${adventure.title}" — ${adventure.chapters.length} chapters loaded! Adventure awaits!`, 5000);
        }
        if (typeof setState === 'function') {
          setState('researching');
          setTimeout(() => setState('idle'), 4000);
        }
      } catch (err) {
        console.error('Adventure parse error:', err);
        if (typeof showSpeechBubble === 'function') {
          showSpeechBubble('❌ Could not parse that file. Try a JSON, Markdown, or plain text adventure.', 3500);
        }
      }
    };
    reader.readAsText(file);
  });

  clearBtn?.addEventListener('click', () => {
    adventure = null;
    window._adventureChapter = null;
    saveAdventureData();
    renderAdventure();
  });

  searchEl?.addEventListener('input', () => filterChapters(searchEl.value));

  backBtn?.addEventListener('click', closeChapterViewer);

  // Render whatever was saved
  renderAdventure();
}

// ─────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initDice();
  initCharSheet();
  initNotes();
  initAdventure();
});
