/**
 * ============================================================
 * ARENA DISPLAY — PRODUCTION RECEIVER v2
 * WKF Karate Kumite Scoreboard System  |  js/display.js
 * ============================================================
 */

'use strict';

(function () {

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
     DOM REFS
     ============================================================ */
  const $ = id => document.getElementById(id);

  const EL = {
    akaScore:         $('display-aka-score'),
    aoScore:          $('display-ao-score'),
    timer:            $('display-timer'),
    timerMs:          $('display-timer-ms'),
    akaName:          $('display-aka-name'),
    akaCountry:       $('display-aka-country'),
    aoName:           $('display-ao-name'),
    aoCountry:        $('display-ao-country'),
    tournamentName:   $('display-tournament-name'),
    category:         $('display-category'),
    tatamiName:       $('display-tatami-name'),
    matchStatus:      $('display-match-status'),
    boutNum:          $('display-bout-num'),
    roundLabel:       $('display-round'),
    akaSenshu:        $('display-aka-senshu'),
    aoSenshu:         $('display-ao-senshu'),
    akaTeamWins:      $('aka-team-wins-count'),
    aoTeamWins:       $('ao-team-wins-count'),
    // Penalties — AKA
    akaCh1: $('display-aka-ch1'),
    akaCh2: $('display-aka-ch2'),
    akaCh3: $('display-aka-ch3'),
    akaHc:  $('display-aka-hc'),
    akaH:   $('display-aka-h'),
    // Penalties — AO
    aoCh1:  $('display-ao-ch1'),
    aoCh2:  $('display-ao-ch2'),
    aoCh3:  $('display-ao-ch3'),
    aoHc:   $('display-ao-hc'),
    aoH:    $('display-ao-h'),
    // Overlays
    medicalOverlay:   $('medical-overlay'),
    medicalCountdown: $('medical-countdown'),
    hanteiOverlay:    $('hantei-overlay'),
    hanteiWinner:     $('hantei-winner-display'),
    winReasonBanner:  $('win-reason-banner'),
  };

  /* ============================================================
     AUDIO ENGINE (Custom Buffer + Web Audio Synth)
     ============================================================ */
  let audioCtx = null;
  let customAudioBuffer = null;

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

  function playCustomSound() {
    if (!audioCtx || !customAudioBuffer) return false;
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
    if (!playCustomSound()) {
      playTone(220, 'sawtooth', 0.6, 1.0, 0.01, 0.0);
      playTone(260, 'square',   0.6, 0.8, 0.01, 0.0);
      playTone(220, 'sawtooth', 0.6, 1.0, 0.01, 0.8);
      playTone(260, 'square',   0.6, 0.8, 0.01, 0.8);
      playTone(220, 'sawtooth', 0.9, 1.0, 0.01, 1.6);
    }
  }

  function playManualHorn() {
    initAudio();
    if (!playCustomSound()) {
      playTone(300, 'sawtooth', 0.5, 1.0, 0.01, 0.0);
      playTone(400, 'square',   0.5, 0.8, 0.01, 0.0);
    }
  }

  function playAtoshiBeep() {
    initAudio();
    playTone(880, 'sine', 0.18, 0.7, 0.01, 0.00);
    playTone(880, 'sine', 0.18, 0.7, 0.01, 0.25);
  }

  function playMedicalBeep() {
    initAudio();
    playTone(1000, 'sine', 0.15, 0.8, 0.01, 0.0);
    playTone(1200, 'sine', 0.25, 0.6, 0.01, 0.2);
  }

  function playEmergencyAlarm() {
    initAudio();
    for (let i = 0; i < 6; i++) {
      playTone(i % 2 === 0 ? 440 : 660, 'square', 0.25, 1.0, 0.1, i * 0.3);
    }
  }

  async function loadCustomBuzzer() {
    // 1. Try Electron IPC
    if (ipc) {
      try {
        const b64 = await ipc.invoke('load-buzzer');
        if (b64) {
          await decodeBuzzer(b64);
          return;
        }
      } catch (e) {}
    }
    // 2. Try localStorage
    try {
      const b64 = localStorage.getItem('customBuzzerAudio');
      if (b64) await decodeBuzzer(b64);
    } catch (e) {}
  }

  async function decodeBuzzer(base64Str) {
    try {
      initAudio();
      const binary = atob(base64Str);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      customAudioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
    } catch (e) {}
  }

  let lastBuzzerTs = 0;
  function handleBuzzerEvent(ev) {
    if (!ev || ev.ts <= lastBuzzerTs) return;
    lastBuzzerTs = ev.ts;

    switch (ev.type) {
      case 'victory':   playVictoryBuzzer(); break;
      case 'manual':    playManualHorn(); break;
      case 'atoshi':    playAtoshiBeep(); break;
      case 'medical':   playMedicalBeep(); break;
      case 'emergency': playEmergencyAlarm(); break;
      default:          playManualHorn(); break;
    }
  }

  /* ============================================================
     TIME FORMATTING
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

  function applyPenalty(el, active, type) {
    if (!el) return;
    el.classList.remove('penalty-warn', 'penalty-danger');
    if (active) {
      el.classList.add(type === 'h' || type === 'hc' ? 'penalty-danger' : 'penalty-warn');
    }
  }

  /* ============================================================
     MAIN ARENA DISPLAY UPDATER
     ============================================================ */
  function updateArenaDisplay(state) {
    if (!state) return;

    /* ---- 1. Scores ---- */
    if (EL.akaScore) EL.akaScore.textContent = state.akaScore ?? 0;
    if (EL.aoScore)  EL.aoScore.textContent  = state.aoScore  ?? 0;

    /* ---- 2. Winner Blink Animation ---- */
    EL.akaScore?.classList.remove('winner-blink');
    EL.aoScore?.classList.remove('winner-blink');
    if (state.winner === 'aka') EL.akaScore?.classList.add('winner-blink');
    if (state.winner === 'ao')  EL.aoScore?.classList.add('winner-blink');

    /* ---- 3. Names & Countries ---- */
    if (EL.akaName)    EL.akaName.textContent    = state.akaName    || 'PLAYER 1 NAME';
    if (EL.akaCountry) EL.akaCountry.textContent = state.akaCountry || 'SRI';
    if (EL.aoName)     EL.aoName.textContent     = state.aoName     || 'PLAYER 2 NAME';
    if (EL.aoCountry)  EL.aoCountry.textContent  = state.aoCountry  || 'JPN';

    /* ---- 4. Team Kumite Mode Wins ---- */
    if (EL.akaTeamWins && state.akaTeamWins !== undefined) EL.akaTeamWins.textContent = state.akaTeamWins;
    if (EL.aoTeamWins  && state.aoTeamWins  !== undefined) EL.aoTeamWins.textContent  = state.aoTeamWins;

    /* ---- 5. Tournament & Tatami Info ---- */
    if (EL.tournamentName && state.tournamentName) EL.tournamentName.textContent = state.tournamentName;
    if (EL.category && state.categoryText) {
      EL.category.textContent = state.categoryText.replace(/^Category:\s*/i, '');
    }
    if (EL.tatamiName && state.tatamiName) EL.tatamiName.textContent = state.tatamiName;
    if (EL.boutNum    && state.boutNumber) EL.boutNum.textContent   = `BOUT #${state.boutNumber}`;
    if (EL.roundLabel && state.roundLabel) EL.roundLabel.textContent = state.roundLabel;

    /* ---- 6. Timer with Yellow Milliseconds ---- */
    if (EL.timer) {
      const ms  = state.timerMs ?? 0;
      const fmt = formatMs(ms);

      if (EL.timer.firstChild) EL.timer.firstChild.textContent = fmt.main;
      if (EL.timerMs) EL.timerMs.textContent = '.' + fmt.ms;

      EL.timer.classList.remove('atoshi-baraku', 'timer-ended');
      if (EL.timerMs) EL.timerMs.className = 'ms-digits';

      if (ms <= 0) {
        EL.timer.classList.add('timer-ended');
        if (EL.timerMs) EL.timerMs.style.color = '#ef4444';
      } else if (ms <= 15000) {
        EL.timer.classList.add('atoshi-baraku');
        if (EL.timerMs) EL.timerMs.style.color = '#f59e0b';
      } else {
        if (EL.timerMs) EL.timerMs.style.color = '#fde047';
      }
    }

    /* ---- 7. Match Status ---- */
    if (EL.matchStatus) {
      if (state.hanteiMode) {
        EL.matchStatus.textContent = 'HANTEI — REFEREE DECISION';
        EL.matchStatus.style.color = '#f59e0b';
      } else if (state.winner) {
        EL.matchStatus.textContent = `${state.winner.toUpperCase()} WINS! 🏆`;
        EL.matchStatus.style.color = '#fde047';
      } else if (state.medicalActive) {
        EL.matchStatus.textContent = '⚕ 10s MEDICAL STOPPAGE';
        EL.matchStatus.style.color = '#4ade80';
      } else if (state.isRunning && state.timerMs <= 15000 && state.timerMs > 0) {
        EL.matchStatus.textContent = '⚡ ATOSHI BARAKU — FINAL 15s';
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

    /* ---- 8. 10s Medical Timer Overlay ---- */
    if (EL.medicalOverlay) {
      if (state.medicalActive) {
        EL.medicalOverlay.classList.add('open');
        const secondsRemaining = Math.max(0, Math.ceil((state.medicalMs || 10000) / 1000));
        if (EL.medicalCountdown) EL.medicalCountdown.textContent = secondsRemaining;
        if (state.medicalMs <= 3000) EL.medicalOverlay.classList.add('urgent');
        else EL.medicalOverlay.classList.remove('urgent');
      } else {
        EL.medicalOverlay.classList.remove('open', 'urgent');
      }
    }

    /* ---- 9. Hantei Overlay ---- */
    if (EL.hanteiOverlay) {
      if (state.hanteiMode) {
        EL.hanteiOverlay.classList.add('open');
        if (EL.hanteiWinner) {
          if (state.hanteiWinner) {
            EL.hanteiWinner.textContent = `${state.hanteiWinner.toUpperCase()} DECLARED WINNER`;
            EL.hanteiWinner.classList.remove('hidden');
          } else {
            EL.hanteiWinner.classList.add('hidden');
          }
        }
      } else {
        EL.hanteiOverlay.classList.remove('open');
      }
    }

    /* ---- 10. Win Reason Banner ---- */
    if (EL.winReasonBanner) {
      if (state.winReason) {
        EL.winReasonBanner.textContent = state.winReason;
        EL.winReasonBanner.classList.add('open');
      } else {
        EL.winReasonBanner.classList.remove('open');
      }
    }

    /* ---- 11. Senshu Advantage ---- */
    if (EL.akaSenshu) {
      EL.akaSenshu.classList.toggle('opacity-0',   !state.akaSenshu);
      EL.akaSenshu.classList.toggle('opacity-100',  !!state.akaSenshu);
    }
    if (EL.aoSenshu) {
      EL.aoSenshu.classList.toggle('opacity-0',   !state.aoSenshu);
      EL.aoSenshu.classList.toggle('opacity-100',  !!state.aoSenshu);
    }

    /* ---- 12. Penalties ---- */
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
     INIT & MULTI-CHANNEL LISTENERS
     ============================================================ */
  function setupTimerNode() {
    const timerEl = EL.timer;
    const msEl    = EL.timerMs;
    if (!timerEl) return;
    timerEl.innerHTML = '';
    timerEl.appendChild(document.createTextNode('2:00'));
    if (msEl) {
      timerEl.appendChild(msEl);
      msEl.className = 'ms-digits';
      msEl.textContent = '.00';
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    setupTimerNode();
    await loadCustomBuzzer();

    // 1. Initial State from localStorage
    try {
      const stored = localStorage.getItem('karateMatchState');
      if (stored) updateArenaDisplay(JSON.parse(stored));
    } catch (e) {}

    // 2. Direct Electron IPC Listeners (Instant zero-lag sync)
    if (ipc) {
      ipc.on('arena-state-update', (event, state) => {
        updateArenaDisplay(state);
      });
      ipc.on('arena-buzzer-trigger', (event, buzzerData) => {
        handleBuzzerEvent(buzzerData);
      });
    }

    // 3. Cross-Window Storage Event Listener (Browser or Electron fallback)
    window.addEventListener('storage', e => {
      if (e.key === 'karateBuzzerEvent' && e.newValue) {
        try { handleBuzzerEvent(JSON.parse(e.newValue)); } catch (err) {}
      }
      if (e.key === 'karateMatchState' && e.newValue) {
        try { updateArenaDisplay(JSON.parse(e.newValue)); } catch (err) {}
      }
    });

    // 4. Polling Fallback for Electron same-process contexts
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
      } catch (e) {}
    }, 80);

    // 5. Buzzer Event Polling Fallback
    let lastBuzzerTsPoll = 0;
    setInterval(() => {
      try {
        const raw = localStorage.getItem('karateBuzzerEvent');
        if (!raw) return;
        const ev = JSON.parse(raw);
        if (ev.ts && ev.ts > lastBuzzerTsPoll) {
          lastBuzzerTsPoll = ev.ts;
          handleBuzzerEvent(ev);
        }
      } catch (e) {}
    }, 100);
  });

})();
