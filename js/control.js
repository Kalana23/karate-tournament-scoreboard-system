/**
 * ============================================================
 * CONTROL CONSOLE — PRODUCTION LOGIC v2
 * WKF Karate Kumite Scoreboard System  |  js/control.js
 * ============================================================
 */

'use strict';

// Detect Electron IPC safely
let ipc = null;
try {
  if (typeof window !== 'undefined' && window.require) {
    const electron = window.require('electron');
    ipc = electron.ipcRenderer;
  }
} catch (e) {
  ipc = null;
}

/* ============================================================
   SECTION 1: STATE
   ============================================================ */
const STATE = {
  ...Tournament.defaults(),
  logos: { mainHeader: '', titleSponsor: '', platinumPartner: '', goldPartner: '', silverSponsor: '', associationPartner: '' },
  akaScore:          0,
  aoScore:           0,
  akaSenshu:         false,
  aoSenshu:          false,
  akaPenalties:      { ch1: false, ch2: false, ch3: false, hc: false, h: false },
  aoPenalties:       { ch1: false, ch2: false, ch3: false, hc: false, h: false },
  akaTeamWins:       0,
  aoTeamWins:        0,
  winner:            null,         // null | 'aka' | 'ao'
  winReason:         null,         // e.g. "8-POINT GAP", "HANTEI DECISION", "AKA KIKEN", etc.
  hanteiMode:        false,
  hanteiWinner:      null,
  medicalActive:     false,
  medicalMs:         10000,
  timerMs:           120000,       // remaining match time in milliseconds
  isRunning:         false,
  matchDurationMs:   120000,       // default 2:00
  tatamiName:        'TATAMI 1',
  categoryText:      'Cadet | -52kg',
  tournamentName:    '2028 10TH JAPAN KARATE-DO HAYASHI HA SHITORYU KAI WORLD KARATE TOURNAMENT — SRI LANKA',
  boutNumber:        '14',
  roundLabel:        'R1 ELIM',
  pointGapLimit:     8,
  customTimeS:       120,
  streamLive:        true,
  audioMuted:        false,
  atoshiBarakuFired: false,
};

// Independent action history stacks for undo
const akaHistory = [];
const aoHistory  = [];

// Loaded CSV bouts directory: { [boutNumber]: { akaName, akaCountry, aoName, aoCountry, category } }
let loadedBouts = {};

// Audit log
const auditEntries = [];

/* ============================================================
   SECTION 2: DURATION PRESETS & CYCLER
   ============================================================ */
const DURATION_CYCLE = [60, 90, 120, 180]; // seconds
let durationCycleIdx = 2; // 120s

const PRESETS = {
  u21:    { label: 'Under 21', timeS: 180 },
  senior: { label: '21 & Over', timeS: 180 },
  ages67: { label: 'Ages 6-7 | -22kg', timeS: 90  },
  cadet:  { label: 'Cadet | -52kg',    timeS: 120 },
  junior: { label: 'Junior | -61kg',   timeS: 120 },
  snrF:   { label: 'Senior Female | -61kg', timeS: 180 },
  snrM:   { label: 'Senior Male | -75kg',   timeS: 180 },
  custom: { label: null,                timeS: null },
};

/* ============================================================
   SECTION 3: TIMER (HIGH-PRECISION, performance.now())
   ============================================================ */
let rafId = null;
let lastTimestamp = null;

function timerTick(ts) {
  if (!STATE.isRunning) return;

  if (lastTimestamp === null) {
    lastTimestamp = ts;
    rafId = requestAnimationFrame(timerTick);
    return;
  }

  const delta = ts - lastTimestamp;
  lastTimestamp = ts;

  STATE.timerMs -= delta;
  if (STATE.timerMs < 0) STATE.timerMs = 0;

  // Atoshi Baraku — 15s warning (fire once per bout)
  if (!STATE.atoshiBarakuFired && STATE.timerMs <= 15000 && STATE.timerMs > 0) {
    STATE.atoshiBarakuFired = true;
    playAtoshiBeep();
  }

  updateTimerDisplay();
  broadcastState();

  if (STATE.timerMs <= 0) {
    stopTimer(false);
    onMatchTimeExpired();
    return;
  }

  rafId = requestAnimationFrame(timerTick);
}

function startTimer() {
  if (Tournament.isKata(STATE.mode)) return;
  if (STATE.isRunning || STATE.timerMs <= 0 || STATE.winner || STATE.medicalActive) return;
  STATE.isRunning = true;
  lastTimestamp = null;
  rafId = requestAnimationFrame(timerTick);
  updateStatusRibbon();
  broadcastState();
}

function stopTimer(manual = true) {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  STATE.isRunning = false;
  lastTimestamp = null;
  if (manual) updateStatusRibbon();
  broadcastState();
}

function resetTimerOnly() {
  stopTimer(false);
  STATE.timerMs = STATE.matchDurationMs;
  STATE.atoshiBarakuFired = false;
  updateTimerDisplay();
  updateStatusRibbon();
  broadcastState();
  addAudit(nowHHMMSS(), 'Clock reset to preset duration', 'RST');
}

/** Handles time up logic including Hantei check */
function onMatchTimeExpired() {
  playVictoryBuzzer();
  updateTimerDisplay();

  // WKF Rule: Check for tie without Senshu
  if (STATE.akaScore === STATE.aoScore && !STATE.akaSenshu && !STATE.aoSenshu) {
    // Tied without Senshu -> trigger Hantei Mode
    STATE.hanteiMode = true;
    STATE.winner = null;
    STATE.winReason = 'HANTEI REQUIRED';
    showHanteiBanner(true);
    addAudit(nowHHMMSS(), 'TIED MATCH (0-0 or equal, no Senshu) — HANTEI TRIGGERED', '⚖️');
  } else if (STATE.akaScore !== STATE.aoScore) {
    // Normal score decision
    const winCorner = STATE.akaScore > STATE.aoScore ? 'aka' : 'ao';
    declareWinner(winCorner, 'POINTS DECISION');
  } else if (STATE.akaSenshu || STATE.aoSenshu) {
    // Tie on score, but one player has Senshu
    const winCorner = STATE.akaSenshu ? 'aka' : 'ao';
    declareWinner(winCorner, 'SENSHU ADVANTAGE');
  }

  updateStatusRibbon();
  broadcastState();
}

function adjustTime(deltaS) {
  if (STATE.isRunning) return;
  STATE.timerMs = Math.max(0, Math.min(STATE.timerMs + deltaS * 1000, 3600000));
  updateTimerDisplay();
  broadcastState();
}

/* ============================================================
   SECTION 4: 10-SECOND MEDICAL TIMER
   ============================================================ */
let medicalRafId = null;
let medicalLastTs = null;

function startMedicalTimer() {
  // 1. Immediately halt match timer
  stopTimer();

  // 2. Set medical active state
  STATE.medicalActive = true;
  STATE.medicalMs = 10000;
  medicalLastTs = null;

  // 3. Show overlay on control console
  const overlayCtrl = document.getElementById('medical-overlay-ctrl');
  if (overlayCtrl) {
    overlayCtrl.classList.remove('urgent');
    overlayCtrl.classList.add('open');
  }

  renderMedicalCountdownCtrl();
  broadcastState();
  addAudit(nowHHMMSS(), '10s Medical Stoppage Initiated', '⚕️');

  // 4. Start RAF loop
  if (medicalRafId) cancelAnimationFrame(medicalRafId);
  medicalRafId = requestAnimationFrame(medicalTick);
}

function stopMedicalTimer() {
  if (medicalRafId) {
    cancelAnimationFrame(medicalRafId);
    medicalRafId = null;
  }
  STATE.medicalActive = false;
  STATE.medicalMs = 10000;

  const overlayCtrl = document.getElementById('medical-overlay-ctrl');
  if (overlayCtrl) {
    overlayCtrl.classList.remove('open', 'urgent');
  }

  broadcastState();
  updateStatusRibbon();
  addAudit(nowHHMMSS(), 'Medical Stoppage Concluded', 'OK');
}

function medicalTick(ts) {
  if (!STATE.medicalActive) return;

  if (!medicalLastTs) {
    medicalLastTs = ts;
    medicalRafId = requestAnimationFrame(medicalTick);
    return;
  }

  const delta = ts - medicalLastTs;
  medicalLastTs = ts;
  STATE.medicalMs -= delta;

  if (STATE.medicalMs < 0) STATE.medicalMs = 0;

  renderMedicalCountdownCtrl();
  broadcastState();

  if (STATE.medicalMs <= 0) {
    // Medical time expired: play beep and dismiss
    playMedicalBeep();
    stopMedicalTimer();
    return;
  }

  const overlayCtrl = document.getElementById('medical-overlay-ctrl');
  if (STATE.medicalMs <= 3000 && overlayCtrl) {
    overlayCtrl.classList.add('urgent');
  }

  medicalRafId = requestAnimationFrame(medicalTick);
}

function renderMedicalCountdownCtrl() {
  const cd = document.getElementById('medical-countdown-ctrl');
  if (cd) {
    cd.textContent = Math.ceil(STATE.medicalMs / 1000);
  }
}

/* ============================================================
   SECTION 5: HANTEI (DECISION) ENGINE
   ============================================================ */
function showHanteiBanner(show) {
  const banner = document.getElementById('hantei-banner');
  if (!banner) return;
  if (show) banner.classList.add('open');
  else banner.classList.remove('open');
}

function awardHantei(corner) {
  STATE.hanteiMode = true;
  STATE.hanteiWinner = corner;
  showHanteiBanner(false);
  declareWinner(corner, `HANTEI (${corner.toUpperCase()} REFEREE DECISION)`);
  addAudit(nowHHMMSS(), `HANTEI DECISION AWARDED TO ${corner.toUpperCase()}`, '🏆');
}

/* ============================================================
   SECTION 6: SCORING & UNDO
   ============================================================ */
function addPoints(corner, points) {
  if (Tournament.isKata(STATE.mode)) return;
  if (STATE.winner) return;

  if (corner === 'aka') {
    STATE.akaScore += points;
    akaHistory.push({ corner, points });
    addAudit(nowHHMMSS(), `AKA: +${points} ${pointsLabel(points)}`, 'OK');
  } else {
    STATE.aoScore += points;
    aoHistory.push({ corner, points });
    addAudit(nowHHMMSS(), `AO: +${points} ${pointsLabel(points)}`, 'OK');
  }

  checkGapRule();
  updateScoreDisplay();
  broadcastState();
}

function pointsLabel(p) {
  return p === 1 ? 'YUKO (+1)' : p === 2 ? 'WAZA-ARI (+2)' : 'IPPON (+3)';
}

function undoAka() {
  if (STATE.winner) {
    STATE.winner = null;
    STATE.winReason = null;
    lockScoringButtons(false);
  }
  if (!akaHistory.length) return;
  const last = akaHistory.pop();
  STATE.akaScore = Math.max(0, STATE.akaScore - last.points);
  addAudit(nowHHMMSS(), `AKA UNDO: -${last.points} ${pointsLabel(last.points)}`, 'UND');
  updateScoreDisplay();
  broadcastState();
}

function undoAo() {
  if (STATE.winner) {
    STATE.winner = null;
    STATE.winReason = null;
    lockScoringButtons(false);
  }
  if (!aoHistory.length) return;
  const last = aoHistory.pop();
  STATE.aoScore = Math.max(0, STATE.aoScore - last.points);
  addAudit(nowHHMMSS(), `AO UNDO: -${last.points} ${pointsLabel(last.points)}`, 'UND');
  updateScoreDisplay();
  broadcastState();
}

function undoLast() {
  if (akaHistory.length === 0 && aoHistory.length === 0) return;
  if (akaHistory.length > 0 && aoHistory.length === 0) { undoAka(); return; }
  if (aoHistory.length > 0 && akaHistory.length === 0) { undoAo(); return; }
  undoAka();
}

/* ============================================================
   SECTION 7: 8-POINT GAP & VICTORY LOGIC
   ============================================================ */
function checkGapRule() {
  const gap = Math.abs(STATE.akaScore - STATE.aoScore);
  if (gap >= STATE.pointGapLimit && !STATE.winner) {
    const winCorner = STATE.akaScore > STATE.aoScore ? 'aka' : 'ao';
    declareWinner(winCorner, `${STATE.pointGapLimit}-POINT GAP (MERCY RULE)`);
  }
}

function declareWinner(corner, reason) {
  STATE.winner = corner;
  STATE.winReason = reason;
  stopTimer();
  playVictoryBuzzer();
  lockScoringButtons(true);
  updateScoreDisplay();
  updateStatusRibbon();
  broadcastState();
  addAudit(nowHHMMSS(), `WINNER DECLARED: ${corner.toUpperCase()} — ${reason}`, '🏆');
}

function lockScoringButtons(lock) {
  ['aka-score-btns', 'ao-score-btns'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (lock) el.classList.add('scoring-locked');
      else el.classList.remove('scoring-locked');
    }
  });
}

/* ============================================================
   SECTION 8: WKF PENALTIES, KIKEN & SHIKKAKU
   ============================================================ */
function togglePenalty(corner, type) {
  const penObj = corner === 'aka' ? STATE.akaPenalties : STATE.aoPenalties;
  penObj[type] = !penObj[type];

  // Hansoku (H) = disqualification from bout -> opponent wins
  if (type === 'h' && penObj[type]) {
    const winCorner = corner === 'aka' ? 'ao' : 'aka';
    declareWinner(winCorner, `${corner.toUpperCase()} HANSOKU (DISQUALIFIED)`);
  }

  renderPenalties();
  broadcastState();
}

function clearPenalties(corner) {
  const penObj = corner === 'aka' ? STATE.akaPenalties : STATE.aoPenalties;
  Object.keys(penObj).forEach(k => penObj[k] = false);
  renderPenalties();
  broadcastState();
  addAudit(nowHHMMSS(), `${corner.toUpperCase()} Penalties Cleared`, 'CLR');
}

function handleKiken(corner) {
  const winCorner = corner === 'aka' ? 'ao' : 'aka';
  if (!confirm(`CONFIRM KIKEN (Withdrawal) for ${corner.toUpperCase()}?\n${winCorner.toUpperCase()} will be declared the winner.`)) return;
  declareWinner(winCorner, `${corner.toUpperCase()} KIKEN (WITHDRAWAL) — ${winCorner.toUpperCase()} WINS`);
  addAudit(nowHHMMSS(), `${corner.toUpperCase()} KIKEN — ${winCorner.toUpperCase()} WINS`, '⛔');
}

function handleShikkaku(corner) {
  const winCorner = corner === 'aka' ? 'ao' : 'aka';
  if (!confirm(`CONFIRM SHIKKAKU (Disqualification from Tournament) for ${corner.toUpperCase()}?\n${winCorner.toUpperCase()} will be declared the winner.`)) return;
  if (corner === 'aka') STATE.akaPenalties.h = true;
  else STATE.aoPenalties.h = true;
  declareWinner(winCorner, `${corner.toUpperCase()} SHIKKAKU (DISQUALIFIED) — ${winCorner.toUpperCase()} WINS`);
  renderPenalties();
  addAudit(nowHHMMSS(), `${corner.toUpperCase()} SHIKKAKU — ${winCorner.toUpperCase()} WINS`, '⛔');
}

function toggleSenshu(corner) {
  if (corner === 'aka') {
    STATE.akaSenshu = !STATE.akaSenshu;
    if (STATE.akaSenshu) STATE.aoSenshu = false;
  } else {
    STATE.aoSenshu = !STATE.aoSenshu;
    if (STATE.aoSenshu) STATE.akaSenshu = false;
  }
  renderSenshu();
  broadcastState();
}

/* ============================================================
   SECTION 9: TEAM KUMITE MODE COUNTERS
   ============================================================ */
function adjustTeamWins(corner, delta) {
  if (corner === 'aka') {
    STATE.akaTeamWins = Math.max(0, STATE.akaTeamWins + delta);
    const label = document.getElementById('aka-team-wins-label');
    if (label) label.textContent = STATE.akaTeamWins;
  } else {
    STATE.aoTeamWins = Math.max(0, STATE.aoTeamWins + delta);
    const label = document.getElementById('ao-team-wins-label');
    if (label) label.textContent = STATE.aoTeamWins;
  }
  broadcastState();
  addAudit(nowHHMMSS(), `Team Kumite Score: AKA ${STATE.akaTeamWins} - ${STATE.aoTeamWins} AO`, 'TEAM');
}

/* ============================================================
   SECTION 10: RESET MATCH
   ============================================================ */
function resetMatch() {
  if (!confirm('RESET MATCH?\nScores, match clock, and penalties will be reset to zero.')) return;

  stopTimer(false);

  STATE.akaScore          = 0;
  STATE.aoScore           = 0;
  STATE.akaSenshu         = false;
  STATE.aoSenshu          = false;
  STATE.winner            = null;
  STATE.winReason         = null;
  STATE.hanteiMode        = false;
  STATE.hanteiWinner      = null;
  STATE.isRunning         = false;
  STATE.timerMs           = STATE.matchDurationMs;
  STATE.atoshiBarakuFired = false;
  STATE.medicalActive     = false;

  Object.keys(STATE.akaPenalties).forEach(k => STATE.akaPenalties[k] = false);
  Object.keys(STATE.aoPenalties).forEach(k  => STATE.aoPenalties[k]  = false);

  akaHistory.length = 0;
  aoHistory.length  = 0;

  showHanteiBanner(false);
  lockScoringButtons(false);
  updateScoreDisplay();
  updateTimerDisplay();
  renderPenalties();
  renderSenshu();
  updateStatusRibbon();
  broadcastState();
  addAudit(nowHHMMSS(), 'Match scores & timer reset', 'RST');
}

/* ============================================================
   SECTION 11: AUDIO ENGINE (Custom Audio + Web Audio Synth)
   ============================================================ */
let audioCtx = null;
let customAudioBuffer = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

document.addEventListener('click',   () => initAudio(), { once: true });
document.addEventListener('keydown', () => initAudio(), { once: true });

function playTone(freq, type, duration, startGain, endGain, delay = 0) {
  if (STATE.audioMuted || !audioCtx) return;
  const t = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(startGain, t);
  g.gain.exponentialRampToValueAtTime(Math.max(endGain, 0.0001), t + duration);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

function playCustomBuzzerSound() {
  if (STATE.audioMuted || !audioCtx || !customAudioBuffer) return false;
  try {
    const src = audioCtx.createBufferSource();
    src.buffer = customAudioBuffer;
    src.connect(audioCtx.destination);
    src.start();
    return true;
  } catch (e) {
    return false;
  }
}

function playVictoryBuzzer() {
  initAudio();
  if (!playCustomBuzzerSound()) {
    playTone(220, 'sawtooth', 0.6, 1.0, 0.01, 0.0);
    playTone(260, 'square',   0.6, 0.8, 0.01, 0.0);
    playTone(220, 'sawtooth', 0.6, 1.0, 0.01, 0.8);
    playTone(260, 'square',   0.6, 0.8, 0.01, 0.8);
    playTone(220, 'sawtooth', 0.9, 1.0, 0.01, 1.6);
  }
  broadcastBuzzer('victory');
}

function playManualHorn() {
  initAudio();
  if (!playCustomBuzzerSound()) {
    playTone(300, 'sawtooth', 0.5, 1.0, 0.01, 0.0);
    playTone(400, 'square',   0.5, 0.8, 0.01, 0.0);
  }
  broadcastBuzzer('manual');
}

function playAtoshiBeep() {
  initAudio();
  playTone(880, 'sine', 0.18, 0.7, 0.01, 0.00);
  playTone(880, 'sine', 0.18, 0.7, 0.01, 0.25);
  broadcastBuzzer('atoshi');
}

function playMedicalBeep() {
  initAudio();
  playTone(1000, 'sine', 0.15, 0.8, 0.01, 0.0);
  playTone(1200, 'sine', 0.25, 0.6, 0.01, 0.2);
  broadcastBuzzer('medical');
}

function playEmergencyAlarm() {
  initAudio();
  stopTimer();
  for (let i = 0; i < 6; i++) {
    const f = i % 2 === 0 ? 440 : 660;
    playTone(f, 'square', 0.25, 1.0, 0.1, i * 0.3);
  }
  broadcastBuzzer('emergency');
  addAudit(nowHHMMSS(), 'EMERGENCY ALARM ACTIVATED', '⚠️');
}

function broadcastBuzzer(type) {
  const ev = { ts: Date.now(), type };
  // 1. Direct Electron IPC
  if (ipc) ipc.send('broadcast-buzzer-instant', ev);
  // 2. localStorage fallback
  try {
    localStorage.setItem('karateBuzzerEvent', JSON.stringify(ev));
  } catch (e) {}
}

async function loadCustomBuzzerOnStartup() {
  // Check Electron IPC first
  if (ipc) {
    try {
      const b64 = await ipc.invoke('load-buzzer');
      if (b64) {
        decodeAndSetBuzzerBuffer(b64);
        updateBuzzerUI('Custom Horn Loaded (Local File)');
        return;
      }
    } catch (e) {}
  }
  // Check localStorage base64 fallback
  try {
    const b64 = localStorage.getItem('customBuzzerAudio');
    if (b64) {
      decodeAndSetBuzzerBuffer(b64);
      updateBuzzerUI('Custom Horn Loaded (Cached)');
    }
  } catch (e) {}
}

async function decodeAndSetBuzzerBuffer(base64Str) {
  try {
    initAudio();
    const binary = atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    customAudioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
  } catch (e) {
    console.warn('Could not decode buzzer buffer:', e);
  }
}

function updateBuzzerUI(label) {
  const badge = document.getElementById('buzzer-status-badge');
  const filename = document.getElementById('buzzer-filename');
  if (badge) {
    badge.textContent = customAudioBuffer ? 'CUSTOM HORN ACTIVE' : 'SYNTHESIZED HORN ACTIVE';
    badge.className = customAudioBuffer
      ? 'text-[10px] font-mono font-bold text-amber-300 uppercase px-2 py-0.5 rounded bg-amber-950/60 border border-amber-500/40'
      : 'text-[10px] font-mono font-bold text-tertiary uppercase px-2 py-0.5 rounded bg-surface-container-lowest';
  }
  if (filename && label) filename.textContent = label;
}

/* ============================================================
   SECTION 12: CSV MATCH DATA AUTO-FILL & RESULTS EXPORT
   ============================================================ */

/** Parses CSV text into dictionary of bouts */
function parseMatchCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return {};

  const bouts = {};
  let headerIndex = -1;

  // Detect header row
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    if (/bout/i.test(lines[i])) {
      headerIndex = i;
      break;
    }
  }

  const startLine = headerIndex >= 0 ? headerIndex + 1 : 0;

  for (let i = startLine; i < lines.length; i++) {
    // Basic CSV cell extraction respecting quotes
    const cells = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',').map(s => s.trim());
    const cleanCells = cells.map(c => c.replace(/^["']|["']$/g, '').trim());

    if (cleanCells.length >= 4) {
      // Structure: BoutNumber, AkaName, AkaCountry, AoName, AoCountry
      const boutNum = cleanCells[0].replace(/^#/, '');
      bouts[boutNum] = {
        boutNumber: boutNum,
        akaName:    cleanCells[1] || 'AKA',
        akaCountry: cleanCells[2] || 'SRI',
        aoName:     cleanCells[3] || 'AO',
        aoCountry:  cleanCells[4] || 'JPN',
        category:   cleanCells[5] || ''
      };
    }
  }

  return bouts;
}

function loadBoutFromCsv(boutNum) {
  const norm = String(boutNum).trim().replace(/^#/, '');
  if (!loadedBouts[norm]) return false;

  const match = loadedBouts[norm];
  const akaNameInput = document.getElementById('input-aka-name');
  const akaCountryInput = document.getElementById('input-aka-country-code');
  const aoNameInput = document.getElementById('input-ao-name');
  const aoCountryInput = document.getElementById('input-ao-country-code');

  if (akaNameInput) akaNameInput.value = match.akaName;
  if (akaCountryInput) akaCountryInput.value = match.akaCountry;
  if (aoNameInput) aoNameInput.value = match.aoName;
  if (aoCountryInput) aoCountryInput.value = match.aoCountry;

  if (match.category) {
    STATE.categoryText = match.category;
    const catInput = document.getElementById('edit-category');
    if (catInput) catInput.value = `Category: ${match.category}`;
  }

  broadcastState();
  addAudit(nowHHMMSS(), `Bout #${norm} auto-populated: ${match.akaName} vs ${match.aoName}`, 'CSV');
  return true;
}

async function handleLoadCsvButton() {
  // If in Electron, use native dialog
  if (ipc) {
    try {
      const res = await ipc.invoke('open-csv-dialog');
      if (res && !res.canceled && res.content) {
        processCsvContent(res.content, res.path);
        return;
      }
    } catch (e) {}
  }
  // Browser fallback
  document.getElementById('csv-file-input')?.click();
}

function processCsvContent(content, filename) {
  loadedBouts = parseMatchCsv(content);
  const count = Object.keys(loadedBouts).length;
  const badge = document.getElementById('csv-status-badge');
  const fname = document.getElementById('csv-filename');

  if (badge) {
    badge.textContent = `${count} BOUTS LOADED`;
    badge.className = 'text-[10px] font-mono font-bold text-emerald-400 uppercase px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40';
  }
  if (fname) fname.textContent = filename || 'Uploaded CSV';

  addAudit(nowHHMMSS(), `Tournament CSV Loaded: ${count} bouts ready`, 'CSV');

  // If current bout exists in loaded CSV, populate it immediately
  const curBout = document.getElementById('bout-number')?.value;
  if (curBout) loadBoutFromCsv(curBout);
}

async function exportMatchResult() {
  const resultState = Tournament.viewState(createStatePayload());
  const akaName = document.getElementById('input-aka-name')?.value || 'AKA';
  const akaCountry = document.getElementById('input-aka-country-code')?.value || 'SRI';
  const aoName = document.getElementById('input-ao-name')?.value || 'AO';
  const aoCountry = document.getElementById('input-ao-country-code')?.value || 'JPN';
  const winnerStr = resultState.winner ? resultState.winner.toUpperCase() : 'DRAW / ONGOING';
  const reasonStr = Tournament.isKata(STATE.mode) ? `${STATE.mode.toUpperCase()} ${STATE.kataScoring.toUpperCase()}` : STATE.winReason || (STATE.winner ? 'POINTS' : 'NONE');
  const timestamp = new Date().toISOString();

  const csvRow = [STATE.boutNumber, resultState.akaName || akaName, akaCountry, resultState.aoName || aoName, aoCountry,
    resultState.akaScore, resultState.aoScore, winnerStr, reasonStr, timestamp]
    .map(value => '"' + String(value).replace(/"/g, '""') + '"').join(',');

  // 1. Electron Native FS write
  if (ipc) {
    try {
      const res = await ipc.invoke('export-result', csvRow);
      if (res.success) {
        alert(`Match result saved successfully!\nFile: ${res.path}`);
        addAudit(nowHHMMSS(), `Result exported to ${res.path}`, 'CSV');
        return;
      }
    } catch (e) {}
  }

  // 2. Browser download fallback
  try {
    const blob = new Blob([
      'Bout,AKA Name,AKA Country,AO Name,AO Country,AKA Score,AO Score,Winner,Win Reason,Timestamp\n' + csvRow + '\n'
    ], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bout_${STATE.boutNumber}_result.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addAudit(nowHHMMSS(), `Result exported (Downloaded CSV)`, 'CSV');
  } catch (e) {
    alert('Export failed: ' + e.message);
  }
}

/* ============================================================
   SECTION 13: STATE BROADCAST (DIRECT IPC + LOCALSTORAGE)
   ============================================================ */
function createStatePayload() {
  return {
    ...Tournament.modeState(STATE),
    logos:            { ...STATE.logos },
    akaScore:          STATE.akaScore,
    aoScore:           STATE.aoScore,
    akaSenshu:         STATE.akaSenshu,
    aoSenshu:          STATE.aoSenshu,
    akaPenalties:      STATE.akaPenalties,
    aoPenalties:       STATE.aoPenalties,
    akaTeamWins:       STATE.akaTeamWins,
    aoTeamWins:        STATE.aoTeamWins,
    winner:            STATE.winner,
    winReason:         STATE.winReason,
    hanteiMode:        STATE.hanteiMode,
    hanteiWinner:      STATE.hanteiWinner,
    medicalActive:     STATE.medicalActive,
    medicalMs:         STATE.medicalMs,
    timerMs:           STATE.timerMs,
    isRunning:         STATE.isRunning,
    akaName:           document.getElementById('input-aka-name')?.value     || 'AKA',
    akaCountry:        document.getElementById('input-aka-country-code')?.value || 'SRI',
    aoName:            document.getElementById('input-ao-name')?.value      || 'AO',
    aoCountry:         document.getElementById('input-ao-country-code')?.value  || 'JPN',
    categoryText:      STATE.categoryText,
    tournamentName:    STATE.tournamentName,
    tatamiName:        STATE.tatamiName,
    boutNumber:        STATE.boutNumber,
    roundLabel:        STATE.roundLabel,
    ts:                Date.now(),
  };
}

function broadcastState(force = false) {
  if (!STATE.streamLive && force !== true) return false;
  const payload = createStatePayload();

  // Save first so Settings can report quota failures without publishing a partial save.
  let stored = false;
  try {
    localStorage.setItem('karateMatchState', JSON.stringify(payload));
    stored = true;
  } catch (e) {
    if (force === true) return false;
  }

  if (ipc) ipc.send('broadcast-state-instant', payload);
  return stored;
}

function forceSync() {
  broadcastState();
  const btn = document.getElementById('btn-arena-sync');
  if (btn) {
    btn.classList.add('sync-flash');
    setTimeout(() => btn.classList.remove('sync-flash'), 1200);
  }
}

/* ============================================================
   SECTION 14: DOM UPDATERS
   ============================================================ */
function formatMs(ms) {
  if (ms < 0) ms = 0;
  const totalS = Math.floor(ms / 1000);
  const m  = Math.floor(totalS / 60);
  const s  = totalS % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return {
    main: `${m}:${s < 10 ? '0' : ''}${s}`,
    ms:   cs < 10 ? `0${cs}` : `${cs}`
  };
}

function formatDurationLabel(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}:00 MIN` : `${m}:${r < 10 ? '0' : ''}${r} MIN`;
}

function nowHHMMSS() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function updateScoreDisplay() {
  const akaEl = document.getElementById('aka-score-display');
  const aoEl  = document.getElementById('ao-score-display');
  if (akaEl) akaEl.textContent = STATE.akaScore;
  if (aoEl)  aoEl.textContent  = STATE.aoScore;

  // Winner blink
  akaEl?.classList.remove('winner-blink-ctrl');
  aoEl?.classList.remove('winner-blink-ctrl');
  if (STATE.winner === 'aka') akaEl?.classList.add('winner-blink-ctrl');
  if (STATE.winner === 'ao')  aoEl?.classList.add('winner-blink-ctrl');

  // Lead telemetry
  const diff = STATE.akaScore - STATE.aoScore;
  const akaLead = document.getElementById('aka-lead-text');
  const aoLead  = document.getElementById('ao-lead-text');

  if (diff > 0) {
    if (akaLead) { akaLead.textContent = `Lead by +${diff} pts`; akaLead.className = 'font-label-micro text-label-micro lead-positive'; }
    if (aoLead)  { aoLead.textContent  = `Deficit by -${diff} pts`; aoLead.className  = 'font-label-micro text-label-micro lead-negative'; }
  } else if (diff < 0) {
    if (akaLead) { akaLead.textContent = `Deficit by ${diff} pts`; akaLead.className = 'font-label-micro text-label-micro lead-negative'; }
    if (aoLead)  { aoLead.textContent  = `Lead by +${-diff} pts`; aoLead.className = 'font-label-micro text-label-micro lead-positive'; }
  } else {
    if (akaLead) { akaLead.textContent = 'Even'; akaLead.className = 'font-label-micro text-label-micro lead-even'; }
    if (aoLead)  { aoLead.textContent  = 'Even'; aoLead.className  = 'font-label-micro text-label-micro lead-even'; }
  }
}

function updateTimerDisplay() {
  const mainEl = document.getElementById('timer-display-main');
  const msEl   = document.getElementById('timer-ms');
  if (!mainEl) return;

  const { main, ms } = formatMs(STATE.timerMs);

  if (mainEl.firstChild) mainEl.firstChild.textContent = main;
  if (msEl) msEl.textContent = '.' + ms;

  mainEl.classList.remove('atoshi-baraku', 'timer-ended');
  if (msEl) msEl.style.color = '';

  if (STATE.timerMs <= 0) {
    mainEl.classList.add('timer-ended');
    if (msEl) msEl.style.color = '#ef4444';
  } else if (STATE.timerMs <= 15000) {
    mainEl.classList.add('atoshi-baraku');
    if (msEl) msEl.style.color = '#f59e0b';
  }
}

function updateStatusRibbon() {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('match-status-text');
  const sub  = document.getElementById('match-status-sub');
  if (!text) return;

  if (STATE.hanteiMode) {
    text.textContent = 'STATUS: HANTEI (REFEREE DECISION)';
    text.className = 'font-label-tactical text-label-tactical uppercase font-extrabold tracking-wider text-amber-400';
    if (sub) sub.textContent = 'Awaiting Arbiter Vote';
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping';
  } else if (STATE.winner) {
    text.textContent = `${STATE.winner.toUpperCase()} WINS! 🏆`;
    text.className = 'font-label-tactical text-label-tactical uppercase font-extrabold tracking-wider text-amber-400';
    if (sub) sub.textContent = STATE.winReason || 'Match Concluded';
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400';
  } else if (STATE.medicalActive) {
    text.textContent = 'STATUS: 10s MEDICAL STOPPAGE';
    text.className = 'font-label-tactical text-label-tactical uppercase font-extrabold tracking-wider text-emerald-400';
    if (sub) sub.textContent = 'Match Clock Paused';
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping';
  } else if (STATE.isRunning) {
    text.textContent = 'STATUS: BOUT IN PROGRESS';
    text.className = 'font-label-tactical text-label-tactical uppercase font-extrabold tracking-wider text-tertiary';
    if (sub) sub.textContent = STATE.timerMs <= 15000 ? '⚡ ATOSHI BARAKU (15s FINAL)' : 'Timer Running';
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-tertiary animate-ping';
  } else {
    text.textContent = 'STATUS: TIMER STOPPED';
    text.className = 'font-label-tactical text-label-tactical uppercase font-extrabold tracking-wider text-on-surface-variant';
    if (sub) sub.textContent = 'Timer Paused';
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-surface-container-highest';
  }
}

function renderPenalties() {
  const apply = (id, active, isDanger) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('penalty-btn-active-warn', 'penalty-btn-active-danger');
    if (active) {
      el.classList.add(isDanger ? 'penalty-btn-active-danger' : 'penalty-btn-active-warn');
    }
  };

  const ap = STATE.akaPenalties;
  apply('btn-aka-ch1', ap.ch1, false);
  apply('btn-aka-ch2', ap.ch2, false);
  apply('btn-aka-ch3', ap.ch3, false);
  apply('btn-aka-hc',  ap.hc,  true);
  apply('btn-aka-h',   ap.h,   true);

  const bp = STATE.aoPenalties;
  apply('btn-ao-ch1', bp.ch1, false);
  apply('btn-ao-ch2', bp.ch2, false);
  apply('btn-ao-ch3', bp.ch3, false);
  apply('btn-ao-hc',  bp.hc,  true);
  apply('btn-ao-h',   bp.h,   true);
}

function renderSenshu() {
  const setBtn = (id, dotId, labelId, active) => {
    const btn   = document.getElementById(id);
    const dot   = document.getElementById(dotId);
    const label = document.getElementById(labelId);
    if (!btn) return;
    if (active) {
      btn.classList.add('senshu-active');
      if (dot)   dot.className = 'w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b] animate-ping';
      if (label) label.textContent = '★ SENSHU ACTIVE';
    } else {
      btn.classList.remove('senshu-active');
      if (dot)   dot.className = 'w-2.5 h-2.5 rounded-full bg-surface-container-highest';
      if (label) label.textContent = '★ SENSHU READY (Click to Award)';
    }
  };
  setBtn('btn-aka-senshu', 'aka-senshu-dot', 'aka-senshu-label', STATE.akaSenshu);
  setBtn('btn-ao-senshu',  'ao-senshu-dot',  'ao-senshu-label',  STATE.aoSenshu);
}

function addAudit(time, msg, status) {
  auditEntries.unshift({ time, msg, status });
  if (auditEntries.length > 25) auditEntries.pop();
  renderAuditLog();
}

function renderAuditLog() {
  const log = document.getElementById('audit-log');
  if (!log) return;
  log.innerHTML = '';
  auditEntries.slice(0, 5).forEach(e => {
    const row = document.createElement('div');
    row.className = 'audit-entry';
    row.innerHTML = `<span>${e.time}</span><span class="flex-1 mx-2 truncate">${e.msg}</span><span class="text-tertiary">${e.status}</span>`;
    log.appendChild(row);
  });
}

/* ============================================================
   SECTION 15: PRESETS & INLINE EDITORS
   ============================================================ */
function applyPreset(val) {
  const opt = PRESETS[val];
  if (!opt) return;

  if (val === 'custom') {
    const catInput = document.getElementById('edit-category');
    if (catInput) { catInput.readOnly = false; catInput.focus(); }
    STATE.matchDurationMs = STATE.customTimeS * 1000;
  } else {
    STATE.categoryText    = opt.label;
    STATE.matchDurationMs = opt.timeS * 1000;
    const catInput = document.getElementById('edit-category');
    if (catInput) { catInput.value = `Category: ${opt.label}`; catInput.readOnly = true; }
  }

  if (!STATE.isRunning) {
    STATE.timerMs = STATE.matchDurationMs;
    STATE.atoshiBarakuFired = false;
  }

  const matchIdx = DURATION_CYCLE.findIndex(s => s * 1000 === STATE.matchDurationMs);
  if (matchIdx >= 0) durationCycleIdx = matchIdx;

  updateDurationLabel();
  updateTimerDisplay();
  broadcastState();
}

function updateDurationLabel() {
  const el = document.getElementById('duration-label');
  if (el) el.textContent = formatDurationLabel(STATE.matchDurationMs);
  const pEl = document.getElementById('preset-duration-label');
  if (pEl) pEl.textContent = 'OFFICIAL DURATION ' + formatDurationLabel(STATE.matchDurationMs).replace(' MIN', '');
}

function cycleDuration() {
  if (STATE.isRunning) return;
  durationCycleIdx = (durationCycleIdx + 1) % DURATION_CYCLE.length;
  const newS = DURATION_CYCLE[durationCycleIdx];
  STATE.matchDurationMs = newS * 1000;
  STATE.timerMs = STATE.matchDurationMs;
  STATE.atoshiBarakuFired = false;
  updateDurationLabel();
  updateTimerDisplay();
  broadcastState();
}

function initTatamiEdit() {
  const display = document.getElementById('tatami-title-display');
  const input   = document.getElementById('tatami-title-input');
  if (!display || !input) return;

  display.addEventListener('click', () => {
    display.style.display = 'none';
    input.classList.add('active');
    input.value = STATE.tatamiName;
    input.focus();
    input.select();
  });

  const commit = () => {
    const v = input.value.trim() || 'TATAMI 1';
    STATE.tatamiName = v;
    display.textContent = v;
    input.classList.remove('active');
    display.style.display = '';
    document.title = `${v} — Control Console`;
    broadcastState();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
  });
}

function toggleStream() {
  STATE.streamLive = !STATE.streamLive;
  const btn  = document.getElementById('btn-stream-toggle');
  const text = document.getElementById('stream-status-text');
  const badge = document.getElementById('publish-status-badge');

  if (STATE.streamLive) {
    btn?.classList.replace('stream-paused', 'stream-live');
    if (text) text.textContent = 'Arena Stream: LIVE';
    if (badge) { badge.textContent = '● LIVE SYNC ACTIVE'; badge.style.color = ''; }
    broadcastState();
  } else {
    btn?.classList.replace('stream-live', 'stream-paused');
    if (text) text.textContent = 'Arena Stream: PAUSED';
    if (badge) { badge.textContent = '◼ STREAM PAUSED'; badge.style.color = '#f59e0b'; }
  }
}

function toggleTheme() {
  const html  = document.documentElement;
  const icon  = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (html.classList.contains('dark')) {
    html.classList.replace('dark', 'light');
    document.body.classList.add('light-mode');
    if (icon) { icon.textContent = 'light_mode'; icon.style.color = '#fbbf24'; }
    if (label) label.textContent = 'LIGHT';
  } else {
    html.classList.replace('light', 'dark');
    document.body.classList.remove('light-mode');
    if (icon) { icon.textContent = 'dark_mode'; icon.style.color = '#fbbf24'; }
    if (label) label.textContent = 'DARK';
  }
}

function toggleAudio() {
  STATE.audioMuted = !STATE.audioMuted;
  const icon = document.getElementById('audio-icon');
  if (icon) icon.textContent = STATE.audioMuted ? 'volume_off' : 'volume_up';
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

document.addEventListener('fullscreenchange', () => {
  const icon = document.getElementById('fullscreen-icon');
  if (icon) icon.textContent = document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen';
});

/* ============================================================
   SECTION 16: SETTINGS MODAL
   ============================================================ */
const LOGO_FIELDS = {
  mainHeader: 'main-header',
  titleSponsor: 'title-sponsor',
  platinumPartner: 'platinum-partner',
  goldPartner: 'gold-partner',
  silverSponsor: 'silver-sponsor',
  associationPartner: 'association-partner',
};
const LOGO_DATA_URL = /^data:image\/(?:png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_LOGO_BYTES = 200 * 1024;
let draftLogos = null;
const pendingLogos = new Map();

function logoMessage(message = '') {
  const el = document.getElementById('logo-settings-status');
  if (el) el.textContent = message;
}

function updateLogoSaveButton() {
  const button = document.getElementById('btn-modal-save');
  if (button) button.disabled = pendingLogos.size > 0;
}

function updateLogoPreview(key, filename) {
  const suffix = LOGO_FIELDS[key];
  const preview = document.getElementById(`preview-logo-${suffix}`);
  const label = document.getElementById(`filename-logo-${suffix}`);
  const source = draftLogos?.[key] || '';
  if (preview) {
    preview.classList.toggle('hidden', !source);
    if (source) preview.src = source;
    else preview.removeAttribute('src');
  }
  if (label) label.textContent = filename || (source ? 'Saved logo' : 'No logo selected');
}

function restoreLogos() {
  try {
    const saved = JSON.parse(localStorage.getItem('karateMatchState'))?.logos;
    for (const key of Object.keys(LOGO_FIELDS)) {
      const source = saved?.[key];
      if (typeof source === 'string' && source.length <= 280000 && LOGO_DATA_URL.test(source)) {
        STATE.logos[key] = source;
      }
    }
  } catch (e) {
    // Older installations may not have saved logos yet.
  }
}

function readLogo(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this file. Please try again.'));
    reader.onabort = () => reject(new Error('Image upload was cancelled.'));
    reader.onload = () => {
      const source = reader.result;
      if (typeof source !== 'string' || !LOGO_DATA_URL.test(source)) {
        reject(new Error('Choose a PNG, JPEG, or SVG image.'));
        return;
      }
      const image = new Image();
      image.onload = () => resolve(source);
      image.onerror = () => reject(new Error('This image could not be displayed. Choose another file.'));
      image.src = source;
    };
    reader.readAsDataURL(file);
  });
}

async function handleLogoUpload(key, input) {
  const file = input.files?.[0];
  if (!file || !draftLogos) return;
  // The token also invalidates earlier reads when replacing/removing a logo or closing the modal.
  const token = {};
  pendingLogos.set(key, token);
  updateLogoSaveButton();
  logoMessage('');
  try {
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) {
      throw new Error('Choose a PNG, JPEG, or SVG image.');
    }
    if (file.size > MAX_LOGO_BYTES) throw new Error('Each logo must be 200 KB or smaller.');
    const source = await readLogo(file);
    if (pendingLogos.get(key) !== token || !draftLogos) return;
    draftLogos[key] = source;
    updateLogoPreview(key, file.name);
  } catch (error) {
    if (pendingLogos.get(key) === token) logoMessage(error.message);
  } finally {
    if (pendingLogos.get(key) === token) {
      pendingLogos.delete(key);
      input.value = '';
      updateLogoSaveButton();
    }
  }
}

function initLogoInputs() {
  for (const [key, suffix] of Object.entries(LOGO_FIELDS)) {
    const input = document.getElementById(`input-logo-${suffix}`);
    input?.addEventListener('change', () => handleLogoUpload(key, input));
    document.getElementById(`remove-logo-${suffix}`)?.addEventListener('click', () => {
      if (!draftLogos) return;
      pendingLogos.delete(key);
      draftLogos[key] = '';
      if (input) input.value = '';
      updateLogoPreview(key);
      updateLogoSaveButton();
      logoMessage('');
    });
  }
}

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  const tField = document.getElementById('modal-tournament-name');
  const gField = document.getElementById('modal-point-gap');
  const cField = document.getElementById('modal-custom-time');
  if (tField) tField.value = STATE.tournamentName;
  if (gField) gField.value = STATE.pointGapLimit;
  if (cField) cField.value = STATE.customTimeS;
  pendingLogos.clear();
  draftLogos = { ...STATE.logos };
  for (const [key, suffix] of Object.entries(LOGO_FIELDS)) {
    const input = document.getElementById(`input-logo-${suffix}`);
    if (input) input.value = '';
    updateLogoPreview(key);
  }
  logoMessage('');
  updateLogoSaveButton();
  updateBuzzerUI();
  modal.classList.add('open');
}

function closeSettingsModal() {
  draftLogos = null;
  pendingLogos.clear();
  updateLogoSaveButton();
  document.getElementById('settings-modal')?.classList.remove('open');
}

function saveSettings() {
  if (!draftLogos || pendingLogos.size) return;
  const previous = {
    logos: STATE.logos,
    tournamentName: STATE.tournamentName,
    pointGapLimit: STATE.pointGapLimit,
    customTimeS: STATE.customTimeS,
  };
  const tField = document.getElementById('modal-tournament-name');
  const gField = document.getElementById('modal-point-gap');
  const cField = document.getElementById('modal-custom-time');

  if (tField) {
    STATE.tournamentName = tField.value.trim() || STATE.tournamentName;
  }
  if (gField) {
    const v = parseInt(gField.value);
    if (v >= 1 && v <= 20) STATE.pointGapLimit = v;
  }
  if (cField) {
    const v = parseInt(cField.value);
    if (v >= 30 && v <= 600) STATE.customTimeS = v;
  }

  STATE.logos = { ...draftLogos };
  // Explicit Save & Sync publishes even while the automatic arena stream is paused.
  if (!broadcastState(true)) {
    Object.assign(STATE, previous);
    logoMessage('Settings could not be saved. Storage may be full or unavailable. Remove a logo or choose smaller images, then try again.');
    return;
  }
  const tnInput = document.getElementById('edit-tournament-name');
  if (tnInput) tnInput.value = STATE.tournamentName;
  closeSettingsModal();
  addAudit(nowHHMMSS(), 'Settings Updated', 'SET');
}

/* ============================================================
   SECTION 17: KEYBOARD SHORTCUTS
   ============================================================ */
function attachKeyboard() {
  document.addEventListener('keydown', e => {
    const t = e.target;
    if (document.getElementById('settings-modal')?.classList.contains('open')) {
      if (e.code === 'Escape') closeSettingsModal();
      return;
    }
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
    if (Tournament.isKata(STATE.mode)) {
      if (e.code === 'Space' && STATE.mode === 'team_kata') {
        e.preventDefault(); window.TournamentControl?.bunkaiAction(STATE.bunkaiRunning ? 'stop' : 'start');
      } else if (e.code === 'KeyB') playManualHorn();
      return;
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        STATE.isRunning ? stopTimer() : startTimer();
        break;
      case 'KeyB':
        e.preventDefault();
        playManualHorn();
        break;
      case 'KeyM':
        e.preventDefault();
        STATE.medicalActive ? stopMedicalTimer() : startMedicalTimer();
        break;
      case 'KeyR':
        e.preventDefault();
        resetMatch();
        break;
      case 'KeyQ': e.preventDefault(); addPoints('aka', 1); break;
      case 'KeyW': e.preventDefault(); addPoints('aka', 2); break;
      case 'KeyE': e.preventDefault(); addPoints('aka', 3); break;
      case 'KeyI': e.preventDefault(); addPoints('ao', 1); break;
      case 'KeyO': e.preventDefault(); addPoints('ao', 2); break;
      case 'KeyP': e.preventDefault(); addPoints('ao', 3); break;
      case 'KeyZ': e.preventDefault(); undoLast(); break;
      case 'Escape':
        closeSettingsModal();
        if (STATE.medicalActive) stopMedicalTimer();
        break;
    }
  });
}

/* ============================================================
   SECTION 18: INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  // Restore logos before the first broadcast overwrites the saved match payload.
  restoreLogos();
  initLogoInputs();
  // Rebuild timer display node cleanly
  const mainTimerSpan = document.getElementById('timer-display-main');
  if (mainTimerSpan) {
    const msSpan = document.getElementById('timer-ms');
    mainTimerSpan.innerHTML = '';
    mainTimerSpan.appendChild(document.createTextNode('2:00'));
    if (msSpan) {
      mainTimerSpan.appendChild(msSpan);
      msSpan.className = 'text-amber-400 font-bold';
      msSpan.style.fontSize = '32px';
      msSpan.textContent = '.00';
    }
  }

  // Load custom buzzer if saved
  await loadCustomBuzzerOnStartup();

  // Initial renders
  updateScoreDisplay();
  updateTimerDisplay();
  renderPenalties();
  renderSenshu();
  updateStatusRibbon();
  updateDurationLabel();
  broadcastState();
  addAudit(nowHHMMSS(), 'System Initialized (WKF Kumite v2)', 'READY');

  // --- TIMER BUTTONS ---
  document.getElementById('btn-timer-start')?.addEventListener('click', startTimer);
  document.getElementById('btn-timer-stop')?.addEventListener('click', () => stopTimer(true));
  document.getElementById('btn-time-minus-10')?.addEventListener('click', () => adjustTime(-10));
  document.getElementById('btn-time-minus-1')?.addEventListener('click',  () => adjustTime(-1));
  document.getElementById('btn-time-plus-1')?.addEventListener('click',   () => adjustTime(1));
  document.getElementById('btn-time-plus-10')?.addEventListener('click',  () => adjustTime(10));
  document.getElementById('btn-timer-reset-icon')?.addEventListener('click', resetTimerOnly);
  document.getElementById('btn-manual-buzzer')?.addEventListener('click', playManualHorn);
  document.getElementById('btn-duration-cycle')?.addEventListener('click', cycleDuration);

  // --- MEDICAL TIMER ---
  document.getElementById('btn-medical-timer')?.addEventListener('click', startMedicalTimer);
  document.getElementById('btn-medical-dismiss')?.addEventListener('click', stopMedicalTimer);

  // --- HANTEI BUTTONS ---
  document.getElementById('btn-hantei')?.addEventListener('click', () => {
    STATE.hanteiMode = true;
    showHanteiBanner(true);
    broadcastState();
  });
  document.getElementById('btn-hantei-aka')?.addEventListener('click', () => awardHantei('aka'));
  document.getElementById('btn-hantei-ao')?.addEventListener('click',  () => awardHantei('ao'));
  document.getElementById('btn-hantei-cancel')?.addEventListener('click', () => {
    STATE.hanteiMode = false;
    showHanteiBanner(false);
    broadcastState();
  });

  // --- SCORING & UNDO ---
  document.getElementById('btn-aka-yuko')?.addEventListener('click',    () => addPoints('aka', 1));
  document.getElementById('btn-aka-wazaari')?.addEventListener('click', () => addPoints('aka', 2));
  document.getElementById('btn-aka-ippon')?.addEventListener('click',   () => addPoints('aka', 3));
  document.getElementById('btn-aka-undo')?.addEventListener('click',    undoAka);

  document.getElementById('btn-ao-yuko')?.addEventListener('click',    () => addPoints('ao', 1));
  document.getElementById('btn-ao-wazaari')?.addEventListener('click', () => addPoints('ao', 2));
  document.getElementById('btn-ao-ippon')?.addEventListener('click',   () => addPoints('ao', 3));
  document.getElementById('btn-ao-undo')?.addEventListener('click',    undoAo);

  // --- SENSHU ---
  document.getElementById('btn-aka-senshu')?.addEventListener('click', () => toggleSenshu('aka'));
  document.getElementById('btn-ao-senshu')?.addEventListener('click',  () => toggleSenshu('ao'));

  // --- PENALTIES ---
  ['ch1','ch2','ch3','hc','h'].forEach(type => {
    document.getElementById(`btn-aka-${type}`)?.addEventListener('click', () => togglePenalty('aka', type));
    document.getElementById(`btn-ao-${type}`)?.addEventListener('click',  () => togglePenalty('ao',  type));
  });
  document.getElementById('btn-aka-clear-penalties')?.addEventListener('click', () => clearPenalties('aka'));
  document.getElementById('btn-ao-clear-penalties')?.addEventListener('click',  () => clearPenalties('ao'));

  // --- KIKEN & SHIKKAKU EXPLICIT BUTTONS ---
  document.getElementById('btn-aka-kiken')?.addEventListener('click',    () => handleKiken('aka'));
  document.getElementById('btn-aka-shikkaku')?.addEventListener('click', () => handleShikkaku('aka'));
  document.getElementById('btn-ao-kiken')?.addEventListener('click',    () => handleKiken('ao'));
  document.getElementById('btn-ao-shikkaku')?.addEventListener('click', () => handleShikkaku('ao'));

  // --- TEAM KUMITE MODE COUNTERS ---
  document.getElementById('btn-aka-team-inc')?.addEventListener('click', () => adjustTeamWins('aka', 1));
  document.getElementById('btn-aka-team-dec')?.addEventListener('click', () => adjustTeamWins('aka', -1));
  document.getElementById('btn-ao-team-inc')?.addEventListener('click',  () => adjustTeamWins('ao', 1));
  document.getElementById('btn-ao-team-dec')?.addEventListener('click',  () => adjustTeamWins('ao', -1));

  // --- MATCH CONTROL & FOOTER ---
  document.getElementById('btn-reset-match')?.addEventListener('click', resetMatch);
  document.getElementById('btn-export-result')?.addEventListener('click', exportMatchResult);
  document.getElementById('btn-doctor-time')?.addEventListener('click', () => {
    stopTimer();
    STATE.timerMs = Math.min(STATE.timerMs + 60000, 3600000);
    updateTimerDisplay();
    broadcastState();
    addAudit(nowHHMMSS(), 'Doctor Time: +1:00 Added to match clock', 'MED');
  });
  document.getElementById('btn-publish')?.addEventListener('click', () => {
    if (!STATE.streamLive) toggleStream();
    forceSync();
    addAudit(nowHHMMSS(), 'Manual state published to Arena Display', 'PUB');
  });
  document.getElementById('btn-emergency-buzzer')?.addEventListener('click', playEmergencyAlarm);

  // --- NAVBAR ---
  document.getElementById('btn-arena-sync')?.addEventListener('click', forceSync);
  document.getElementById('btn-stream-toggle')?.addEventListener('click', toggleStream);
  document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);
  document.getElementById('btn-audio-toggle')?.addEventListener('click', toggleAudio);
  document.getElementById('btn-settings')?.addEventListener('click', openSettingsModal);
  document.getElementById('btn-fullscreen')?.addEventListener('click', toggleFullscreen);

  // --- SETTINGS MODAL ---
  document.getElementById('btn-modal-close')?.addEventListener('click', closeSettingsModal);
  document.getElementById('btn-modal-cancel')?.addEventListener('click', closeSettingsModal);
  document.getElementById('btn-modal-save')?.addEventListener('click', saveSettings);

  // --- CSV LOAD ---
  document.getElementById('btn-load-csv')?.addEventListener('click', handleLoadCsvButton);
  document.getElementById('csv-file-input')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => processCsvContent(ev.target.result, file.name);
    reader.readAsText(file);
  });

  // --- CUSTOM BUZZER UPLOAD & TEST ---
  document.getElementById('custom-buzzer-input')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async ev => {
      const buffer = ev.target.result;
      initAudio();
      customAudioBuffer = await audioCtx.decodeAudioData(buffer.slice(0));

      // Save via Electron IPC if available
      if (ipc) {
        await ipc.invoke('save-buzzer', { name: file.name, buffer });
      }

      // Convert to base64 for localStorage fallback
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);
      try {
        localStorage.setItem('customBuzzerAudio', b64);
      } catch (err) {}

      updateBuzzerUI(file.name);
      addAudit(nowHHMMSS(), `Custom Horn Loaded: ${file.name}`, 'AUDIO');
    };
    reader.readAsArrayBuffer(file);
  });

  document.getElementById('btn-test-buzzer')?.addEventListener('click', () => {
    initAudio();
    playManualHorn();
  });

  document.getElementById('btn-reset-buzzer')?.addEventListener('click', () => {
    customAudioBuffer = null;
    try {
      localStorage.removeItem('customBuzzerAudio');
    } catch (e) {}
    updateBuzzerUI('Synthesized Horn Active');
    addAudit(nowHHMMSS(), 'Buzzer sound reset to standard synth', 'AUDIO');
  });

  // --- BOUT NUMBER AUTO-FILL ON TYPE ---
  const boutInput = document.getElementById('bout-number');
  if (boutInput) {
    const handleBoutChange = () => {
      STATE.boutNumber = boutInput.value.trim();
      loadBoutFromCsv(STATE.boutNumber);
      broadcastState();
    };
    boutInput.addEventListener('input', handleBoutChange);
    boutInput.addEventListener('change', handleBoutChange);
  }

  document.getElementById('round-label')?.addEventListener('input', e => {
    STATE.roundLabel = e.target.value;
    broadcastState();
  });

  // --- LIVE SYNC FOR OTHER INPUTS ---
  document.getElementById('input-aka-name')?.addEventListener('input', broadcastState);
  document.getElementById('input-aka-country-code')?.addEventListener('input', broadcastState);
  document.getElementById('input-ao-name')?.addEventListener('input', broadcastState);
  document.getElementById('input-ao-country-code')?.addEventListener('input', broadcastState);
  document.getElementById('edit-category')?.addEventListener('input', e => {
    STATE.categoryText = e.target.value;
    broadcastState();
  });
  document.getElementById('edit-tournament-name')?.addEventListener('input', e => {
    STATE.tournamentName = e.target.value;
    broadcastState();
  });

  // Preset select
  document.getElementById('preset-select')?.addEventListener('change', e => {
    applyPreset(e.target.value);
  });

  // Tatami inline edit
  initTatamiEdit();

  // Keyboard
  attachKeyboard();
});
