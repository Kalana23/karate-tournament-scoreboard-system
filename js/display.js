/**
 * ============================================================
 * ARENA DISPLAY — RECEIVER LOGIC
 * WKF Karate Kumite Scoreboard System  |  js/display.js
 * Listens to localStorage cross-window events from control.js
 * ============================================================
 */

'use strict';

(function () {

  /* ============================================================
     DOM REFS
     ============================================================ */
  const $ = id => document.getElementById(id);

  const EL = {
    akaScore:        $('display-aka-score'),
    aoScore:         $('display-ao-score'),
    timer:           $('display-timer'),
    timerMs:         $('display-timer-ms'),
    akaName:         $('display-aka-name'),
    akaCountry:      $('display-aka-country'),
    aoName:          $('display-ao-name'),
    aoCountry:       $('display-ao-country'),
    tournamentName:  $('display-tournament-name'),
    category:        $('display-category'),
    tatamiName:      $('display-tatami-name'),
    matchStatus:     $('display-match-status'),
    boutNum:         $('display-bout-num'),
    roundLabel:      $('display-round'),
    akaSenshu:       $('display-aka-senshu'),
    aoSenshu:        $('display-ao-senshu'),
    // Penalties — AKA
    akaCh1: $('display-aka-ch1'),
    akaCh2: $('display-aka-ch2'),
    akaCh3: $('display-aka-ch3'),
    akaHc:  $('display-aka-hc'),
    akaH:   $('display-aka-h'),
    // Penalties — AO
    aoCh1: $('display-ao-ch1'),
    aoCh2: $('display-ao-ch2'),
    aoCh3: $('display-ao-ch3'),
    aoHc:  $('display-ao-hc'),
    aoH:   $('display-ao-h'),
  };

  /* ============================================================
     AUDIO ENGINE (mirror of control.js)
     ============================================================ */
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  document.addEventListener('click',   () => initAudio(), { once: true });
  document.addEventListener('keydown', () => initAudio(), { once: true });

  function playTone(freq, type, duration, startGain, endGain, delay = 0) {
    if (!audioCtx) return;
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

  function playVictoryBuzzer() {
    initAudio();
    playTone(220, 'sawtooth', 0.6, 1.0, 0.01, 0.0);
    playTone(260, 'square',   0.6, 0.8, 0.01, 0.0);
    playTone(220, 'sawtooth', 0.6, 1.0, 0.01, 0.8);
    playTone(260, 'square',   0.6, 0.8, 0.01, 0.8);
    playTone(220, 'sawtooth', 0.9, 1.0, 0.01, 1.6);
    playTone(290, 'square',   0.9, 0.9, 0.01, 1.6);
  }

  function playManualHorn() {
    initAudio();
    playTone(300, 'sawtooth', 0.5, 1.0, 0.01, 0.0);
    playTone(400, 'square',   0.5, 0.8, 0.01, 0.0);
  }

  function playEmergencyAlarm() {
    initAudio();
    for (let i = 0; i < 6; i++) {
      const f = i % 2 === 0 ? 440 : 660;
      playTone(f, 'square', 0.25, 1.0, 0.1, i * 0.3);
    }
  }

  let lastBuzzerTs = 0;
  function handleBuzzerEvent(raw) {
    try {
      const ev = JSON.parse(raw);
      if (!ev || ev.ts <= lastBuzzerTs) return;
      lastBuzzerTs = ev.ts;
      if (ev.type === 'victory' || ev.type === 'manual') playVictoryBuzzer();
      else if (ev.type === 'emergency') playEmergencyAlarm();
      else playManualHorn();
    } catch (e) { playManualHorn(); }
  }

  /* ============================================================
     TIMER DISPLAY FORMATTER
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

  /* ============================================================
     PENALTY HELPER
     ============================================================ */
  function applyPenalty(el, active, type) {
    if (!el) return;
    el.classList.remove('penalty-warn', 'penalty-danger');
    if (active) {
      if (type === 'h' || type === 'hc') el.classList.add('penalty-danger');
      else                                el.classList.add('penalty-warn');
    }
  }

  /* ============================================================
     MAIN DISPLAY UPDATER
     ============================================================ */
  function updateArenaDisplay(state) {
    if (!state) return;

    /* ---- Scores ---- */
    if (EL.akaScore) EL.akaScore.textContent = state.akaScore ?? 0;
    if (EL.aoScore)  EL.aoScore.textContent  = state.aoScore  ?? 0;

    /* ---- Winner blink ---- */
    EL.akaScore?.classList.remove('winner-blink');
    EL.aoScore?.classList.remove('winner-blink');
    if (state.winner === 'aka') EL.akaScore?.classList.add('winner-blink');
    if (state.winner === 'ao')  EL.aoScore?.classList.add('winner-blink');

    /* ---- Names & Countries ---- */
    if (EL.akaName)    EL.akaName.textContent    = state.akaName    || 'PLAYER 1 NAME';
    if (EL.akaCountry) EL.akaCountry.textContent = state.akaCountry || 'SRI';
    if (EL.aoName)     EL.aoName.textContent     = state.aoName     || 'PLAYER 2 NAME';
    if (EL.aoCountry)  EL.aoCountry.textContent  = state.aoCountry  || 'JPN';

    /* ---- Tournament Name ---- */
    if (EL.tournamentName && state.tournamentName)
      EL.tournamentName.textContent = state.tournamentName;

    /* ---- Category ---- */
    if (EL.category && state.categoryText) {
      EL.category.textContent = state.categoryText.replace(/^Category:\s*/i, '');
    }

    /* ---- Tatami Name ---- */
    if (EL.tatamiName && state.tatamiName)
      EL.tatamiName.textContent = state.tatamiName;

    /* ---- Bout / Round ---- */
    if (EL.boutNum    && state.boutNumber)  EL.boutNum.textContent   = `BOUT #${state.boutNumber}`;
    if (EL.roundLabel && state.roundLabel)  EL.roundLabel.textContent = state.roundLabel;

    /* ---- Timer ---- */
    if (EL.timer) {
      const ms  = state.timerMs ?? 0;
      const fmt = formatMs(ms);

      // Rebuild text node + ms span
      EL.timer.firstChild.textContent = fmt.main;
      if (EL.timerMs) EL.timerMs.textContent = '.' + fmt.ms;

      EL.timer.classList.remove('atoshi-baraku', 'timer-ended');
      if (EL.timerMs) EL.timerMs.className = 'ms-digits';

      if (ms <= 0) {
        EL.timer.classList.add('timer-ended');
        if (EL.timerMs) { EL.timerMs.style.color = '#ef4444'; }
      } else if (ms <= 15000) {
        EL.timer.classList.add('atoshi-baraku');
        if (EL.timerMs) { EL.timerMs.style.color = '#f59e0b'; }
      } else {
        if (EL.timerMs) { EL.timerMs.style.color = '#fde047'; }
      }
    }

    /* ---- Match Status ---- */
    if (EL.matchStatus) {
      if (state.winner) {
        EL.matchStatus.textContent = `${state.winner.toUpperCase()} WINS! 🏆`;
        EL.matchStatus.style.color = '#fde047';
      } else if (state.isRunning && state.timerMs <= 15000 && state.timerMs > 0) {
        EL.matchStatus.textContent = '⚡ ATOSHI BARAKU — FINAL 15 SECONDS';
        EL.matchStatus.style.color = '#f59e0b';
      } else if (state.isRunning) {
        EL.matchStatus.textContent = 'MATCH IN PROGRESS';
        EL.matchStatus.style.color = '';
      } else if (state.timerMs <= 0) {
        EL.matchStatus.textContent = 'TIME UP — MATCH ENDED';
        EL.matchStatus.style.color = '#ef4444';
      } else {
        EL.matchStatus.textContent = 'MATCH READY';
        EL.matchStatus.style.color = '';
      }
    }

    /* ---- Senshu ---- */
    if (EL.akaSenshu) {
      EL.akaSenshu.classList.toggle('opacity-0',   !state.akaSenshu);
      EL.akaSenshu.classList.toggle('opacity-100',  !!state.akaSenshu);
    }
    if (EL.aoSenshu) {
      EL.aoSenshu.classList.toggle('opacity-0',   !state.aoSenshu);
      EL.aoSenshu.classList.toggle('opacity-100',  !!state.aoSenshu);
    }

    /* ---- Penalties ---- */
    if (state.akaPenalties) {
      applyPenalty(EL.akaCh1, state.akaPenalties.ch1, 'ch1');
      applyPenalty(EL.akaCh2, state.akaPenalties.ch2, 'ch2');
      applyPenalty(EL.akaCh3, state.akaPenalties.ch3, 'ch3');
      applyPenalty(EL.akaHc,  state.akaPenalties.hc,  'hc');
      applyPenalty(EL.akaH,   state.akaPenalties.h,   'h');
    }
    if (state.aoPenalties) {
      applyPenalty(EL.aoCh1, state.aoPenalties.ch1, 'ch1');
      applyPenalty(EL.aoCh2, state.aoPenalties.ch2, 'ch2');
      applyPenalty(EL.aoCh3, state.aoPenalties.ch3, 'ch3');
      applyPenalty(EL.aoHc,  state.aoPenalties.hc,  'hc');
      applyPenalty(EL.aoH,   state.aoPenalties.h,   'h');
    }
  }

  /* ============================================================
     TIMER NODE SETUP (ensure firstChild is a text node)
     ============================================================ */
  function setupTimerNode() {
    const timerEl = EL.timer;
    const msEl    = EL.timerMs;
    if (!timerEl) return;
    // Clear and rebuild: textNode + msSpan
    timerEl.innerHTML = '';
    const textNode = document.createTextNode('2:00');
    timerEl.appendChild(textNode);
    if (msEl) {
      timerEl.appendChild(msEl);
      msEl.className = 'ms-digits';
      msEl.textContent = '.00';
    }
  }

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    setupTimerNode();

    // Load any existing state from previous session
    try {
      const stored = localStorage.getItem('karateMatchState');
      if (stored) updateArenaDisplay(JSON.parse(stored));
    } catch (e) { /* ignore */ }

    // Listen for cross-window storage events (control.html → index.html)
    window.addEventListener('storage', e => {
      if (e.key === 'karateBuzzerEvent' && e.newValue) {
        handleBuzzerEvent(e.newValue);
      }
      if (e.key === 'karateMatchState' && e.newValue) {
        try { updateArenaDisplay(JSON.parse(e.newValue)); }
        catch (err) { console.error('Display parse error:', err); }
      }
    });

    // Poll fallback for same-window Electron contexts (every 100ms)
    // Some Electron builds don't fire cross-window storage events
    let lastKnownTs = 0;
    setInterval(() => {
      try {
        const raw = localStorage.getItem('karateMatchState');
        if (!raw) return;
        const st = JSON.parse(raw);
        if (st.ts && st.ts !== lastKnownTs) {
          lastKnownTs = st.ts;
          updateArenaDisplay(st);
        }
      } catch (e) { /* ignore */ }
    }, 100);

    // Also poll buzzer event
    let lastBuzzerTsPoll = 0;
    setInterval(() => {
      try {
        const raw = localStorage.getItem('karateBuzzerEvent');
        if (!raw) return;
        const ev = JSON.parse(raw);
        if (ev.ts && ev.ts > lastBuzzerTsPoll) {
          lastBuzzerTsPoll = ev.ts;
          handleBuzzerEvent(raw);
        }
      } catch (e) { /* ignore */ }
    }, 150);
  });

})();
