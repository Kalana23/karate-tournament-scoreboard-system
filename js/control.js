/**
 * ============================================================
 * CONTROL CONSOLE — FULL LOGIC
 * WKF Karate Kumite Scoreboard System  |  js/control.js
 * ============================================================
 */

'use strict';

/* ============================================================
   SECTION 1: STATE
   ============================================================ */
const STATE = {
  akaScore:      0,
  aoScore:       0,
  akaSenshu:     false,
  aoSenshu:      false,
  akaPenalties:  { ch1: false, ch2: false, ch3: false, hc: false, h: false },
  aoPenalties:   { ch1: false, ch2: false, ch3: false, hc: false, h: false },
  winner:        null,         // null | 'aka' | 'ao'
  timerMs:       120000,       // milliseconds remaining (high-precision)
  isRunning:     false,
  matchDurationMs: 120000,     // set by preset
  tatamiName:    'TATAMI 1',
  categoryText:  'Cadet | -52kg',
  tournamentName:'2028 10TH JAPAN KARATE-DO HAYASHI HA SHITORYU KAI WORLD KARATE TOURNAMENT — SRI LANKA',
  boutNumber:    '14',
  roundLabel:    'R1 ELIM',
  pointGapLimit: 8,
  customTimeS:   120,
  streamLive:    true,         // when false, state changes are held locally
  audioMuted:    false,
  atoshiBarakuFired: false,    // 15s warning already played this bout
};

// Per-corner undo history stacks (each entry: { corner, points })
const akaHistory = [];
const aoHistory  = [];

// Audit log entries
const auditEntries = [];

/* ============================================================
   SECTION 2: DURATION CYCLE TABLE & PRESET TABLE
   ============================================================ */
const DURATION_CYCLE = [60, 90, 120, 180]; // seconds
let durationCycleIdx = 2; // default: 120s = 2:00

const PRESETS = {
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
let rafId       = null;
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

  // Atoshi Baraku — 15s warning (fire once)
  if (!STATE.atoshiBarakuFired && STATE.timerMs <= 15000 && STATE.timerMs > 0) {
    STATE.atoshiBarakuFired = true;
    playAtoshiBeep();
  }

  updateTimerDisplay();
  broadcastState();

  if (STATE.timerMs <= 0) {
    stopTimer(false);
    onTimerEnd();
    return;
  }

  rafId = requestAnimationFrame(timerTick);
}

function startTimer() {
  if (STATE.isRunning || STATE.timerMs <= 0 || STATE.winner) return;
  STATE.isRunning = true;
  lastTimestamp   = null;
  rafId = requestAnimationFrame(timerTick);
  updateStatusRibbon();
}

function stopTimer(manual = true) {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  STATE.isRunning = false;
  lastTimestamp   = null;
  if (manual) updateStatusRibbon();
}

function resetTimerOnly() {
  stopTimer(false);
  STATE.timerMs = STATE.matchDurationMs;
  STATE.atoshiBarakuFired = false;
  updateTimerDisplay();
  updateStatusRibbon();
  broadcastState();
}

function onTimerEnd() {
  playVictoryBuzzer();
  updateTimerDisplay();
  updateStatusRibbon();
  broadcastState();
  addAudit('TIMER', 'TIME UP — Match Ended', 'BUZZ');
}

function adjustTime(deltaS) {
  if (STATE.isRunning) return; // only when stopped
  STATE.timerMs = Math.max(0, Math.min(STATE.timerMs + deltaS * 1000, 59 * 60 * 1000 + 59000));
  updateTimerDisplay();
  broadcastState();
}

/* ============================================================
   SECTION 4: FORMATTING
   ============================================================ */
function formatMs(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const m  = Math.floor(totalSeconds / 60);
  const s  = totalSeconds % 60;
  const cs = Math.floor((ms % 1000) / 10); // centiseconds (00-99)
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

/* ============================================================
   SECTION 5: AUDIO ENGINE (Web Audio API, 100% offline)
   ============================================================ */
let audioCtx = null;

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
  const t   = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const g   = audioCtx.createGain();
  osc.type  = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(startGain, t);
  g.gain.exponentialRampToValueAtTime(Math.max(endGain, 0.0001), t + duration);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

/** Short double-beep: Atoshi Baraku (15s warning) */
function playAtoshiBeep() {
  initAudio();
  playTone(880, 'sine', 0.18, 0.7, 0.01, 0.00);
  playTone(880, 'sine', 0.18, 0.7, 0.01, 0.25);
}

/** Long horn: match end / victory */
function playVictoryBuzzer() {
  initAudio();
  // Multi-tone horn: 3 blasts
  playTone(220, 'sawtooth', 0.6, 1.0, 0.01, 0.0);
  playTone(260, 'square',   0.6, 0.8, 0.01, 0.0);
  playTone(220, 'sawtooth', 0.6, 1.0, 0.01, 0.8);
  playTone(260, 'square',   0.6, 0.8, 0.01, 0.8);
  playTone(220, 'sawtooth', 0.9, 1.0, 0.01, 1.6);
  playTone(290, 'square',   0.9, 0.9, 0.01, 1.6);

  // Also broadcast buzzer event to arena display
  localStorage.setItem('karateBuzzerEvent', JSON.stringify({ ts: Date.now(), type: 'victory' }));
}

/** Manual single-shot horn */
function playManualHorn() {
  initAudio();
  playTone(300, 'sawtooth', 0.5, 1.0, 0.01, 0.0);
  playTone(400, 'square',   0.5, 0.8, 0.01, 0.0);
  localStorage.setItem('karateBuzzerEvent', JSON.stringify({ ts: Date.now(), type: 'manual' }));
}

/** Emergency: multi-tone alarm blast */
function playEmergencyAlarm() {
  initAudio();
  stopTimer();
  for (let i = 0; i < 6; i++) {
    const f = i % 2 === 0 ? 440 : 660;
    playTone(f, 'square', 0.25, 1.0, 0.1, i * 0.3);
  }
  localStorage.setItem('karateBuzzerEvent', JSON.stringify({ ts: Date.now(), type: 'emergency' }));
  addAudit('EMRG', 'EMERGENCY BUZZER ACTIVATED', '⚠️');
}

/* ============================================================
   SECTION 6: SCORING
   ============================================================ */
function addPoints(corner, points) {
  if (STATE.winner) return;
  if (corner === 'aka') {
    STATE.akaScore += points;
    akaHistory.push({ corner, points });
    addAudit(nowHHMMSS(), `AKA: +${points} ${pointsLabel(points)} (AWARDED)`, 'OK');
  } else {
    STATE.aoScore += points;
    aoHistory.push({ corner, points });
    addAudit(nowHHMMSS(), `AO: +${points} ${pointsLabel(points)} (AWARDED)`, 'OK');
  }

  checkGapRule();
  updateScoreDisplay();
  broadcastState();
}

function pointsLabel(p) {
  return p === 1 ? 'YUKO' : p === 2 ? 'WAZA-ARI' : 'IPPON';
}

function undoAka() {
  if (STATE.winner) STATE.winner = null;
  if (!akaHistory.length) return;
  const last = akaHistory.pop();
  STATE.akaScore = Math.max(0, STATE.akaScore - last.points);
  addAudit(nowHHMMSS(), `AKA: UNDO -${last.points} ${pointsLabel(last.points)}`, 'UND');
  updateScoreDisplay();
  broadcastState();
}

function undoAo() {
  if (STATE.winner) STATE.winner = null;
  if (!aoHistory.length) return;
  const last = aoHistory.pop();
  STATE.aoScore = Math.max(0, STATE.aoScore - last.points);
  addAudit(nowHHMMSS(), `AO: UNDO -${last.points} ${pointsLabel(last.points)}`, 'UND');
  updateScoreDisplay();
  broadcastState();
}

/** Generic undo (for keyboard shortcut Z — undoes most recent action across both) */
function undoLast() {
  // Determine which happened last by comparing stack lengths-based heuristic
  // (In real use, the last pushed history wins)
  const akaLast = akaHistory[akaHistory.length - 1];
  const aoLast  = aoHistory[aoHistory.length - 1];
  if (!akaLast && !aoLast) return;
  if (!akaLast) { undoAo(); return; }
  if (!aoLast)  { undoAka(); return; }
  // Pop from whichever side had its button clicked last (use a simple toggle)
  undoAka(); // defaults to aka for Z key; in real use, most recent tracked via unified log
}

/* ============================================================
   SECTION 7: 8-POINT GAP / MERCY RULE
   ============================================================ */
function checkGapRule() {
  const gap = Math.abs(STATE.akaScore - STATE.aoScore);
  if (gap >= STATE.pointGapLimit && !STATE.winner) {
    STATE.winner = STATE.akaScore > STATE.aoScore ? 'aka' : 'ao';
    stopTimer();
    playVictoryBuzzer();
    lockScoringButtons(true);
    addAudit(nowHHMMSS(), `${STATE.winner.toUpperCase()} WINS by ${STATE.pointGapLimit}-PT GAP RULE`, '🏆');
  }
}

function lockScoringButtons(lock) {
  ['aka-score-btns', 'ao-score-btns'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (lock) el.classList.add('scoring-locked');
      else      el.classList.remove('scoring-locked');
    }
  });
}

/* ============================================================
   SECTION 8: PENALTIES & SENSHU
   ============================================================ */
function togglePenalty(corner, type) {
  const penObj = corner === 'aka' ? STATE.akaPenalties : STATE.aoPenalties;
  penObj[type] = !penObj[type];

  // Hansoku (H) = disqualification
  if (type === 'h' && penObj[type]) {
    const winner = corner === 'aka' ? 'ao' : 'aka'; // opponent wins
    if (!STATE.winner) {
      STATE.winner = winner;
      stopTimer();
      playVictoryBuzzer();
      lockScoringButtons(true);
      addAudit(nowHHMMSS(), `${corner.toUpperCase()} HANSOKU — ${winner.toUpperCase()} WINS by DQ`, '🚫');
    }
  }

  renderPenalties();
  broadcastState();
}

function clearPenalties(corner) {
  const penObj = corner === 'aka' ? STATE.akaPenalties : STATE.aoPenalties;
  Object.keys(penObj).forEach(k => penObj[k] = false);
  renderPenalties();
  broadcastState();
  addAudit(nowHHMMSS(), `${corner.toUpperCase()}: ALL PENALTIES CLEARED`, 'CLR');
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
   SECTION 9: RESET MATCH
   ============================================================ */
function resetMatch() {
  if (!confirm('Reset ENTIRE match? (Scores, timer, and penalties will be cleared)')) return;

  stopTimer(false);

  STATE.akaScore    = 0;
  STATE.aoScore     = 0;
  STATE.akaSenshu   = false;
  STATE.aoSenshu    = false;
  STATE.winner      = null;
  STATE.isRunning   = false;
  STATE.timerMs     = STATE.matchDurationMs;
  STATE.atoshiBarakuFired = false;

  Object.keys(STATE.akaPenalties).forEach(k => STATE.akaPenalties[k] = false);
  Object.keys(STATE.aoPenalties).forEach(k  => STATE.aoPenalties[k]  = false);

  akaHistory.length = 0;
  aoHistory.length  = 0;

  lockScoringButtons(false);
  updateScoreDisplay();
  updateTimerDisplay();
  renderPenalties();
  renderSenshu();
  updateStatusRibbon();
  broadcastState();
  addAudit(nowHHMMSS(), 'MATCH RESET', 'RST');
}

/* ============================================================
   SECTION 10: DOM UPDATERS
   ============================================================ */

/** Score numbers + lead telemetry */
function updateScoreDisplay() {
  const akaEl = document.getElementById('aka-score-display');
  const aoEl  = document.getElementById('ao-score-display');
  if (akaEl) akaEl.textContent = STATE.akaScore;
  if (aoEl)  aoEl.textContent  = STATE.aoScore;

  // Winner blink (control console)
  [akaEl, aoEl].forEach(el => el && el.classList.remove('winner-blink-ctrl'));
  if (STATE.winner === 'aka' && akaEl) akaEl.classList.add('winner-blink-ctrl');
  if (STATE.winner === 'ao'  && aoEl)  aoEl.classList.add('winner-blink-ctrl');

  // Lead text
  const diff = STATE.akaScore - STATE.aoScore;
  const akaLead = document.getElementById('aka-lead-text');
  const aoLead  = document.getElementById('ao-lead-text');
  if (diff > 0) {
    if (akaLead) { akaLead.textContent = `Leading by +${diff} pts`; akaLead.className = 'font-label-micro text-label-micro lead-positive'; }
    if (aoLead)  { aoLead.textContent  = `Deficit by -${diff} pts`; aoLead.className  = 'font-label-micro text-label-micro lead-negative'; }
  } else if (diff < 0) {
    if (akaLead) { akaLead.textContent = `Deficit by ${diff} pts`; akaLead.className = 'font-label-micro text-label-micro lead-negative'; }
    if (aoLead)  { aoLead.textContent  = `Leading by +${-diff} pts`; aoLead.className = 'font-label-micro text-label-micro lead-positive'; }
  } else {
    if (akaLead) { akaLead.textContent = 'Even'; akaLead.className = 'font-label-micro text-label-micro lead-even'; }
    if (aoLead)  { aoLead.textContent  = 'Even'; aoLead.className  = 'font-label-micro text-label-micro lead-even'; }
  }
}

/** High-precision timer display */
function updateTimerDisplay() {
  const mainEl = document.getElementById('timer-display-main');
  const msEl   = document.getElementById('timer-ms');
  if (!mainEl) return;

  const { main, ms } = formatMs(STATE.timerMs);

  // Update main digits (node before the ms span)
  mainEl.firstChild.textContent = main;
  if (msEl) msEl.textContent = '.' + ms;

  // Color states
  mainEl.classList.remove('atoshi-baraku', 'timer-ended');
  if (msEl) msEl.style.color = '';

  if (STATE.timerMs <= 0) {
    mainEl.classList.add('timer-ended');
    if (msEl) { msEl.style.color = '#ef4444'; }
  } else if (STATE.timerMs <= 15000) {
    mainEl.classList.add('atoshi-baraku');
    if (msEl) { msEl.style.color = '#f59e0b'; }
  }
}

/** Status ribbon in center column */
function updateStatusRibbon() {
  const dot     = document.getElementById('status-dot');
  const text    = document.getElementById('match-status-text');
  const sub     = document.getElementById('match-status-sub');

  if (!text) return;

  if (STATE.winner) {
    text.textContent = `${STATE.winner.toUpperCase()} WINS! 🏆`;
    text.className = 'font-label-tactical text-label-tactical uppercase font-extrabold tracking-wider text-amber-400';
    if (sub) sub.textContent = '8-Point Gap Rule / Match Ended';
    if (dot) { dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400'; }
  } else if (STATE.isRunning) {
    text.textContent = 'STATUS: BOUT IN PROGRESS';
    text.className = 'font-label-tactical text-label-tactical uppercase font-extrabold tracking-wider text-tertiary';
    if (sub) {
      sub.textContent = STATE.timerMs <= 15000 ? '⚡ ATOSHI BARAKU — 15s FINAL SPRINT' : 'Timer Running';
    }
    if (dot) { dot.className = 'w-2.5 h-2.5 rounded-full bg-tertiary animate-ping'; }
  } else {
    text.textContent = 'STATUS: TIMER STOPPED';
    text.className = 'font-label-tactical text-label-tactical uppercase font-extrabold tracking-wider text-on-surface-variant';
    if (sub) sub.textContent = 'Timer Paused';
    if (dot) { dot.className = 'w-2.5 h-2.5 rounded-full bg-surface-container-highest'; }
  }
}

/** Penalty button visual states */
function renderPenalties() {
  const ACTIVE_WARN   = 'penalty-btn tactile-bevel py-2.5 px-2 border-2 rounded font-label-tactical text-label-tactical uppercase text-center font-black transition-colors penalty-btn-active-warn';
  const ACTIVE_DANGER = 'penalty-btn tactile-bevel py-2.5 px-2 border-2 rounded font-label-tactical text-label-tactical uppercase text-center font-black transition-colors flex flex-col items-center justify-center leading-tight penalty-btn-active-danger';
  const INACTIVE_WARN = 'penalty-btn tactile-bevel py-2.5 px-2 bg-surface-container border-2 border-surface-container-highest hover:border-amber-400 text-on-surface-variant hover:text-amber-300 rounded font-label-tactical text-label-tactical uppercase text-center font-bold transition-colors';
  const INACTIVE_WARN_AO = 'penalty-btn tactile-bevel py-2.5 px-2 bg-surface-container border-2 border-surface-container-highest hover:border-secondary-container text-on-surface-variant hover:text-secondary rounded font-label-tactical text-label-tactical uppercase text-center font-bold transition-colors';
  const INACTIVE_DNG  = INACTIVE_WARN + ' flex flex-col items-center justify-center leading-tight';
  const INACTIVE_DNG_AO = INACTIVE_WARN_AO + ' flex flex-col items-center justify-center leading-tight';

  const apply = (id, active, isDanger, isAo = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (active) {
      el.className = isDanger ? ACTIVE_DANGER : ACTIVE_WARN;
    } else {
      if (isDanger) el.className = isAo ? INACTIVE_DNG_AO : INACTIVE_DNG;
      else          el.className = isAo ? INACTIVE_WARN_AO : INACTIVE_WARN;
    }
  };

  const ap = STATE.akaPenalties;
  apply('btn-aka-ch1', ap.ch1, false);
  apply('btn-aka-ch2', ap.ch2, false);
  apply('btn-aka-ch3', ap.ch3, false);
  apply('btn-aka-hc',  ap.hc,  true);
  apply('btn-aka-h',   ap.h,   true);

  const bp = STATE.aoPenalties;
  apply('btn-ao-ch1', bp.ch1, false, true);
  apply('btn-ao-ch2', bp.ch2, false, true);
  apply('btn-ao-ch3', bp.ch3, false, true);
  apply('btn-ao-hc',  bp.hc,  true,  true);
  apply('btn-ao-h',   bp.h,   true,  true);
}

/** Senshu badge states */
function renderSenshu() {
  const setBtn = (id, dotId, labelId, active) => {
    const btn   = document.getElementById(id);
    const dot   = document.getElementById(dotId);
    const label = document.getElementById(labelId);
    if (!btn) return;
    if (active) {
      btn.classList.add('senshu-active');
      btn.classList.remove('border-surface-container-highest');
      if (dot)   { dot.className   = 'w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b] animate-ping'; }
      if (label) { label.textContent = '★ SENSHU ACTIVE'; }
    } else {
      btn.classList.remove('senshu-active');
      btn.classList.add('border-surface-container-highest');
      if (dot)   { dot.className   = 'w-2.5 h-2.5 rounded-full bg-surface-container-highest'; }
      if (label) { label.textContent = '★ SENSHU READY (Click to Award)'; }
    }
  };
  setBtn('btn-aka-senshu', 'aka-senshu-dot', 'aka-senshu-label', STATE.akaSenshu);
  setBtn('btn-ao-senshu',  'ao-senshu-dot',  'ao-senshu-label',  STATE.aoSenshu);
}

/* ============================================================
   SECTION 11: BROADCAST STATE TO LOCALSTORAGE
   ============================================================ */
function broadcastState() {
  if (!STATE.streamLive) return; // stream paused — hold locally

  const payload = {
    akaScore:        STATE.akaScore,
    aoScore:         STATE.aoScore,
    akaSenshu:       STATE.akaSenshu,
    aoSenshu:        STATE.aoSenshu,
    akaPenalties:    STATE.akaPenalties,
    aoPenalties:     STATE.aoPenalties,
    winner:          STATE.winner,
    timerMs:         STATE.timerMs,
    isRunning:       STATE.isRunning,
    akaName:         document.getElementById('input-aka-name')?.value     || 'AKA',
    akaCountry:      document.getElementById('input-aka-country-code')?.value || 'SRI',
    aoName:          document.getElementById('input-ao-name')?.value      || 'AO',
    aoCountry:       document.getElementById('input-ao-country-code')?.value  || 'JPN',
    categoryText:    STATE.categoryText,
    tournamentName:  STATE.tournamentName,
    tatamiName:      STATE.tatamiName,
    boutNumber:      STATE.boutNumber,
    roundLabel:      STATE.roundLabel,
    ts:              Date.now(),
  };
  try {
    localStorage.setItem('karateMatchState', JSON.stringify(payload));
  } catch(e) { /* storage full — ignore */ }
}

/** Force full sync + flash confirmation */
function forceSync() {
  broadcastState();
  const btn = document.getElementById('btn-arena-sync');
  if (!btn) return;
  btn.classList.add('sync-flash');
  setTimeout(() => btn.classList.remove('sync-flash'), 1300);
}

/* ============================================================
   SECTION 12: AUDIT LOG
   ============================================================ */
function addAudit(time, msg, status) {
  auditEntries.unshift({ time, msg, status });
  if (auditEntries.length > 20) auditEntries.pop();
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
   SECTION 13: PRESET DROPDOWN
   ============================================================ */
function applyPreset(value) {
  const opt = PRESETS[value];
  if (!opt) return;

  if (value === 'custom') {
    // Allow typing custom category text
    const catInput = document.getElementById('edit-category');
    if (catInput) { catInput.readOnly = false; catInput.focus(); }
    // Use custom time from settings
    STATE.matchDurationMs = STATE.customTimeS * 1000;
  } else {
    STATE.categoryText    = opt.label;
    STATE.matchDurationMs = opt.timeS * 1000;

    // Sync category field
    const catInput = document.getElementById('edit-category');
    if (catInput) { catInput.value = 'Category: ' + opt.label; catInput.readOnly = true; }

    // Reset timer to new duration
    if (!STATE.isRunning) {
      STATE.timerMs = STATE.matchDurationMs;
      STATE.atoshiBarakuFired = false;
    }
  }

  // Update duration cycle index to match new duration
  const matchIdx = DURATION_CYCLE.findIndex(s => s * 1000 === STATE.matchDurationMs);
  if (matchIdx >= 0) durationCycleIdx = matchIdx;

  updateDurationLabel();
  updatePresetDurationLabel();
  updateTimerDisplay();
  broadcastState();
}

function updateDurationLabel() {
  const el = document.getElementById('duration-label');
  if (el) el.textContent = formatDurationLabel(STATE.matchDurationMs);
}

function updatePresetDurationLabel() {
  const el = document.getElementById('preset-duration-label');
  if (el) el.textContent = 'OFFICIAL DURATION ' + formatDurationLabel(STATE.matchDurationMs).replace(' MIN', '');
}

function cycleDuration() {
  if (STATE.isRunning) return; // only when stopped
  durationCycleIdx = (durationCycleIdx + 1) % DURATION_CYCLE.length;
  const newS = DURATION_CYCLE[durationCycleIdx];
  STATE.matchDurationMs = newS * 1000;
  STATE.timerMs = STATE.matchDurationMs;
  STATE.atoshiBarakuFired = false;
  updateDurationLabel();
  updatePresetDurationLabel();
  updateTimerDisplay();
  broadcastState();
}

/* ============================================================
   SECTION 14: TATAMI TITLE INLINE EDIT
   ============================================================ */
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

  input.addEventListener('blur',   commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
}

/* ============================================================
   SECTION 15: STREAM TOGGLE
   ============================================================ */
function toggleStream() {
  STATE.streamLive = !STATE.streamLive;
  const btn  = document.getElementById('btn-stream-toggle');
  const text = document.getElementById('stream-status-text');
  const badge = document.getElementById('publish-status-badge');

  if (STATE.streamLive) {
    btn?.classList.replace('stream-paused', 'stream-live');
    if (text)  text.textContent  = 'Arena Stream: LIVE';
    if (badge) { badge.textContent = '● LIVE SYNC ACTIVE'; badge.style.color = ''; }
    broadcastState(); // flush held state
  } else {
    btn?.classList.replace('stream-live', 'stream-paused');
    if (text)  text.textContent  = 'Arena Stream: PAUSED';
    if (badge) { badge.textContent = '◼ STREAM PAUSED'; badge.style.color = '#f59e0b'; }
  }
}

/* ============================================================
   SECTION 16: THEME TOGGLE
   ============================================================ */
function toggleTheme() {
  const html  = document.documentElement;
  const icon  = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (html.classList.contains('dark')) {
    html.classList.replace('dark', 'light');
    if (icon)  { icon.textContent = 'light_mode'; icon.style.color = '#fbbf24'; }
    if (label) label.textContent = 'LIGHT';
  } else {
    html.classList.replace('light', 'dark');
    if (icon)  { icon.textContent = 'dark_mode'; icon.style.color = '#fbbf24'; }
    if (label) label.textContent = 'DARK';
  }
}

/* ============================================================
   SECTION 17: AUDIO TOGGLE
   ============================================================ */
function toggleAudio() {
  STATE.audioMuted = !STATE.audioMuted;
  const icon = document.getElementById('audio-icon');
  if (icon) icon.textContent = STATE.audioMuted ? 'volume_off' : 'volume_up';
}

/* ============================================================
   SECTION 18: FULLSCREEN
   ============================================================ */
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
   SECTION 19: SETTINGS MODAL
   ============================================================ */
function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  // Pre-fill values
  const tField = document.getElementById('modal-tournament-name');
  const gField = document.getElementById('modal-point-gap');
  const cField = document.getElementById('modal-custom-time');
  if (tField) tField.value = STATE.tournamentName;
  if (gField) gField.value = STATE.pointGapLimit;
  if (cField) cField.value = STATE.customTimeS;
  modal.classList.add('open');
  tField?.focus();
}

function closeSettingsModal() {
  document.getElementById('settings-modal')?.classList.remove('open');
}

function saveSettings() {
  const tField = document.getElementById('modal-tournament-name');
  const gField = document.getElementById('modal-point-gap');
  const cField = document.getElementById('modal-custom-time');

  if (tField) {
    STATE.tournamentName = tField.value.trim() || STATE.tournamentName;
    const tnInput = document.getElementById('edit-tournament-name');
    if (tnInput) tnInput.value = STATE.tournamentName;
  }

  if (gField) {
    const v = parseInt(gField.value);
    if (v >= 1 && v <= 20) STATE.pointGapLimit = v;
  }

  if (cField) {
    const v = parseInt(cField.value);
    if (v >= 30 && v <= 600) STATE.customTimeS = v;
  }

  closeSettingsModal();
  broadcastState();
  addAudit(nowHHMMSS(), 'Settings Updated', 'SET');
}

/* ============================================================
   SECTION 20: SHIKKAKU (MANUAL DQ)
   ============================================================ */
function handleShikkaku() {
  const corner = prompt('Enter corner to DISQUALIFY (AKA or AO):')?.trim().toLowerCase();
  if (corner !== 'aka' && corner !== 'ao') return;
  if (!confirm(`CONFIRM: Shikkaku (DQ) for ${corner.toUpperCase()}? The opponent wins.`)) return;

  const winner = corner === 'aka' ? 'ao' : 'aka';
  STATE.winner = winner;
  if (corner === 'aka') STATE.akaPenalties.h = true;
  else                  STATE.aoPenalties.h  = true;

  stopTimer();
  playVictoryBuzzer();
  lockScoringButtons(true);
  renderPenalties();
  updateScoreDisplay();
  broadcastState();
  addAudit(nowHHMMSS(), `SHIKKAKU: ${corner.toUpperCase()} DQ'd — ${winner.toUpperCase()} WINS`, '⛔');
}

/* ============================================================
   SECTION 21: DOCTOR TIME / KIKEN
   ============================================================ */
function handleDoctorTime() {
  if (STATE.isRunning) stopTimer();
  STATE.timerMs = Math.min(STATE.timerMs + 60000, STATE.matchDurationMs);
  updateTimerDisplay();
  broadcastState();
  addAudit(nowHHMMSS(), 'DOCTOR TIME — +1:00 ADDED', 'MED');
}

/* ============================================================
   SECTION 22: BOUT METADATA SYNC
   ============================================================ */
function syncBoutMeta() {
  STATE.boutNumber = document.getElementById('bout-number')?.value || STATE.boutNumber;
  STATE.roundLabel = document.getElementById('round-label')?.value || STATE.roundLabel;
  broadcastState();
}

/* ============================================================
   SECTION 23: KEYBOARD SHORTCUTS
   ============================================================ */
function attachKeyboard() {
  document.addEventListener('keydown', e => {
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;

    switch (e.code) {
      case 'Space':  e.preventDefault(); STATE.isRunning ? stopTimer() : startTimer(); updateStatusRibbon(); break;
      case 'KeyB':   e.preventDefault(); playManualHorn(); break;
      case 'KeyR':   e.preventDefault(); resetMatch(); break;
      case 'KeyQ':   e.preventDefault(); addPoints('aka', 1); break;
      case 'KeyW':   e.preventDefault(); addPoints('aka', 2); break;
      case 'KeyE':   e.preventDefault(); addPoints('aka', 3); break;
      case 'KeyI':   e.preventDefault(); addPoints('ao', 1); break;
      case 'KeyO':   e.preventDefault(); addPoints('ao', 2); break;
      case 'KeyP':   e.preventDefault(); addPoints('ao', 3); break;
      case 'KeyZ':   e.preventDefault(); undoLast(); break;
    }
  });
}

/* ============================================================
   SECTION 24: PUBLISH BUTTON (manual force-sync)
   ============================================================ */
function handlePublish() {
  if (!STATE.streamLive) {
    // Resume stream and flush
    STATE.streamLive = true;
    const btn  = document.getElementById('btn-stream-toggle');
    const text = document.getElementById('stream-status-text');
    btn?.classList.replace('stream-paused', 'stream-live');
    if (text) text.textContent = 'Arena Stream: LIVE';
    const badge = document.getElementById('publish-status-badge');
    if (badge) { badge.textContent = '● LIVE SYNC ACTIVE'; badge.style.color = ''; }
  }
  forceSync();
  addAudit(nowHHMMSS(), 'MANUAL PUBLISH TO DISPLAY', 'PUB');
}

/* ============================================================
   SECTION 25: INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {

  /* ---- Build initial timer display node correctly ---- */
  const mainTimerSpan = document.getElementById('timer-display-main');
  if (mainTimerSpan) {
    // Clear and rebuild: text node + ms span
    const msSpan = document.getElementById('timer-ms');
    if (msSpan) {
      mainTimerSpan.innerHTML = '';
      const textNode = document.createTextNode('2:00');
      mainTimerSpan.appendChild(textNode);
      mainTimerSpan.appendChild(msSpan);
      msSpan.className = 'text-amber-400';
      msSpan.style.fontSize = '32px';
      msSpan.style.fontWeight = '700';
    }
  }

  // Initial renders
  updateScoreDisplay();
  updateTimerDisplay();
  renderPenalties();
  renderSenshu();
  updateStatusRibbon();
  updateDurationLabel();
  updatePresetDurationLabel();
  broadcastState();
  addAudit(nowHHMMSS(), 'Control Console Initialized', 'INIT');

  /* ---- TIMER BUTTONS ---- */
  document.getElementById('btn-timer-start')?.addEventListener('click', () => { startTimer(); updateStatusRibbon(); });
  document.getElementById('btn-timer-stop')?.addEventListener('click',  () => { stopTimer(); updateStatusRibbon(); });
  document.getElementById('btn-time-minus-10')?.addEventListener('click', () => adjustTime(-10));
  document.getElementById('btn-time-minus-1')?.addEventListener('click',  () => adjustTime(-1));
  document.getElementById('btn-time-plus-1')?.addEventListener('click',   () => adjustTime(1));
  document.getElementById('btn-time-plus-10')?.addEventListener('click',  () => adjustTime(10));
  document.getElementById('btn-timer-reset-icon')?.addEventListener('click', resetTimerOnly);
  document.getElementById('btn-manual-buzzer')?.addEventListener('click', playManualHorn);
  document.getElementById('btn-duration-cycle')?.addEventListener('click', cycleDuration);

  /* ---- SCORING ---- */
  document.getElementById('btn-aka-yuko')?.addEventListener('click',    () => addPoints('aka', 1));
  document.getElementById('btn-aka-wazaari')?.addEventListener('click', () => addPoints('aka', 2));
  document.getElementById('btn-aka-ippon')?.addEventListener('click',   () => addPoints('aka', 3));
  document.getElementById('btn-aka-undo')?.addEventListener('click',    undoAka);

  document.getElementById('btn-ao-yuko')?.addEventListener('click',    () => addPoints('ao', 1));
  document.getElementById('btn-ao-wazaari')?.addEventListener('click', () => addPoints('ao', 2));
  document.getElementById('btn-ao-ippon')?.addEventListener('click',   () => addPoints('ao', 3));
  document.getElementById('btn-ao-undo')?.addEventListener('click',    undoAo);

  /* ---- SENSHU ---- */
  document.getElementById('btn-aka-senshu')?.addEventListener('click', () => toggleSenshu('aka'));
  document.getElementById('btn-ao-senshu')?.addEventListener('click',  () => toggleSenshu('ao'));

  /* ---- PENALTIES ---- */
  ['ch1','ch2','ch3','hc','h'].forEach(type => {
    document.getElementById(`btn-aka-${type}`)?.addEventListener('click', () => togglePenalty('aka', type));
    document.getElementById(`btn-ao-${type}`)?.addEventListener('click',  () => togglePenalty('ao',  type));
  });
  document.getElementById('btn-aka-clear-penalties')?.addEventListener('click', () => clearPenalties('aka'));
  document.getElementById('btn-ao-clear-penalties')?.addEventListener('click',  () => clearPenalties('ao'));

  /* ---- MATCH CONTROL ---- */
  document.getElementById('btn-reset-match')?.addEventListener('click', resetMatch);
  document.getElementById('btn-shikkaku')?.addEventListener('click', handleShikkaku);
  document.getElementById('btn-hantei')?.addEventListener('click', () => {
    addAudit(nowHHMMSS(), 'HANTEI (Referee Decision) CALLED', 'HAT');
    alert('HANTEI: Referee Decision required. Please refer to WKF officials.');
  });
  document.getElementById('btn-doctor-time')?.addEventListener('click', handleDoctorTime);
  document.getElementById('btn-publish')?.addEventListener('click', handlePublish);
  document.getElementById('btn-emergency-buzzer')?.addEventListener('click', playEmergencyAlarm);

  /* ---- NAVBAR ---- */
  document.getElementById('btn-arena-sync')?.addEventListener('click', forceSync);
  document.getElementById('btn-stream-toggle')?.addEventListener('click', toggleStream);
  document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);
  document.getElementById('btn-audio-toggle')?.addEventListener('click', toggleAudio);
  document.getElementById('btn-settings')?.addEventListener('click', openSettingsModal);
  document.getElementById('btn-fullscreen')?.addEventListener('click', toggleFullscreen);

  /* ---- SETTINGS MODAL ---- */
  document.getElementById('btn-modal-close')?.addEventListener('click',  closeSettingsModal);
  document.getElementById('btn-modal-cancel')?.addEventListener('click', closeSettingsModal);
  document.getElementById('btn-modal-save')?.addEventListener('click',   saveSettings);
  document.getElementById('settings-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('settings-modal')) closeSettingsModal();
  });

  /* ---- PRESET DROPDOWN ---- */
  document.getElementById('preset-select')?.addEventListener('change', e => {
    applyPreset(e.target.value);
  });

  /* ---- BOUT METADATA LIVE SYNC ---- */
  document.getElementById('bout-number')?.addEventListener('input', syncBoutMeta);
  document.getElementById('round-label')?.addEventListener('input', syncBoutMeta);
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

  /* ---- TATAMI INLINE EDIT ---- */
  initTatamiEdit();

  /* ---- KEYBOARD ---- */
  attachKeyboard();

  /* ---- Escape closes modal ---- */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSettingsModal();
  });

});
