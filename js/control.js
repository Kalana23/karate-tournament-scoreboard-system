/**
 * Control Console Logic for Karate Scoreboard
 */

// State variables
let akaScore = 0;
let aoScore = 0;

let matchDuration = 120; // 2 minutes in seconds
let currentTime = matchDuration;
let timerInterval = null;
let isTimerRunning = false;

// Penalty & Senshu States
let akaSenshu = false;
let aoSenshu = false;
let akaPenalties = { ch1: false, ch2: false, ch3: false, hc: false, h: false };
let aoPenalties = { ch1: false, ch2: false, ch3: false, hc: false, h: false };

// Action history stack for undo functionality
// Stores objects: { corner: 'aka' | 'ao', points: number }
let actionHistory = [];

// DOM Elements - Displays
const akaScoreDisplay = document.getElementById('aka-score-display');
const aoScoreDisplay = document.getElementById('ao-score-display');
const timerDisplayMain = document.getElementById('timer-display-main');

// DOM Elements - Timer Buttons
const btnTimerStart = document.getElementById('btn-timer-start');
const btnTimerStop = document.getElementById('btn-timer-stop');
const btnTimeMinus10 = document.getElementById('btn-time-minus-10');
const btnTimeMinus1 = document.getElementById('btn-time-minus-1');
const btnTimePlus1 = document.getElementById('btn-time-plus-1');
const btnTimePlus10 = document.getElementById('btn-time-plus-10');

// DOM Elements - AKA Buttons
const btnAkaYuko = document.getElementById('btn-aka-yuko');
const btnAkaWazaari = document.getElementById('btn-aka-wazaari');
const btnAkaIppon = document.getElementById('btn-aka-ippon');
const btnAkaUndo = document.getElementById('btn-aka-undo');

// DOM Elements - AO Buttons
const btnAoYuko = document.getElementById('btn-ao-yuko');
const btnAoWazaari = document.getElementById('btn-ao-wazaari');
const btnAoIppon = document.getElementById('btn-ao-ippon');
const btnAoUndo = document.getElementById('btn-ao-undo');

// DOM Elements - Senshu & Penalties
const btnAkaSenshu = document.getElementById('btn-aka-senshu');
const btnAoSenshu = document.getElementById('btn-ao-senshu');
const btnAkaClearPenalties = document.getElementById('btn-aka-clear-penalties');
const btnAoClearPenalties = document.getElementById('btn-ao-clear-penalties');

const akaPenaltyBtns = {
  ch1: document.getElementById('btn-aka-ch1'),
  ch2: document.getElementById('btn-aka-ch2'),
  ch3: document.getElementById('btn-aka-ch3'),
  hc: document.getElementById('btn-aka-hc'),
  h: document.getElementById('btn-aka-h')
};

const aoPenaltyBtns = {
  ch1: document.getElementById('btn-ao-ch1'),
  ch2: document.getElementById('btn-ao-ch2'),
  ch3: document.getElementById('btn-ao-ch3'),
  hc: document.getElementById('btn-ao-hc'),
  h: document.getElementById('btn-ao-h')
};

// DOM Elements - Competitor Info
const inputAkaName = document.getElementById('input-aka-name');
const inputAkaCountry = document.getElementById('input-aka-country-code');
const inputAoName = document.getElementById('input-ao-name');
const inputAoCountry = document.getElementById('input-ao-country-code');

// DOM Elements - Global Buttons
const btnResetMatch = document.getElementById('btn-reset-match');

/**
 * Broadcasts current state to localStorage for the Arena Display
 */
function broadcastState() {
  const stateObject = {
    akaScore,
    aoScore,
    currentTime,
    akaSenshu,
    aoSenshu,
    akaPenalties,
    aoPenalties,
    akaName: inputAkaName ? inputAkaName.value : 'PLAYER 1',
    akaCountry: inputAkaCountry ? inputAkaCountry.innerText : 'SRI',
    aoName: inputAoName ? inputAoName.value : 'PLAYER 2',
    aoCountry: inputAoCountry ? inputAoCountry.innerText : 'JPN',
  };
  localStorage.setItem('karateMatchState', JSON.stringify(stateObject));
}

/**
 * Updates the score displays for both corners.
 */
function updateDisplay() {
  if (akaScoreDisplay) {
    akaScoreDisplay.innerText = akaScore;
  }
  if (aoScoreDisplay) {
    aoScoreDisplay.innerText = aoScore;
  }
}

/**
 * Adds points to a specific corner and saves the action to history.
 * @param {string} corner - 'aka' or 'ao'
 * @param {number} points - Points to add (1, 2, or 3)
 */
function addPoints(corner, points) {
  // Save action to history stack
  actionHistory.push({ corner, points });

  // Update relevant score state
  if (corner === 'aka') {
    akaScore += points;
  } else if (corner === 'ao') {
    aoScore += points;
  }

  // Refresh UI
  updateDisplay();
  broadcastState();
}

/**
 * Reverts the last score action. Pops from the action history stack.
 */
function undoLastAction() {
  if (actionHistory.length === 0) {
    console.log("No actions to undo.");
    return;
  }

  // Pop the most recent action
  const lastAction = actionHistory.pop();

  // Revert the points
  if (lastAction.corner === 'aka') {
    akaScore = Math.max(0, akaScore - lastAction.points);
  } else if (lastAction.corner === 'ao') {
    aoScore = Math.max(0, aoScore - lastAction.points);
  }

  // Refresh UI
  updateDisplay();
  broadcastState();
}

/**
 * Formats seconds into M:SS string.
 */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Updates the timer display and handles Atoshi Baraku warning
 */
function updateTimerDisplay() {
  if (timerDisplayMain) {
    timerDisplayMain.innerText = formatTime(currentTime);
    
    if (currentTime <= 15 && currentTime > 0) {
      timerDisplayMain.classList.add('text-amber-400');
      timerDisplayMain.classList.remove('text-white', 'text-error');
    } else if (currentTime === 0) {
      timerDisplayMain.classList.add('text-error');
      timerDisplayMain.classList.remove('text-white', 'text-amber-400');
    } else {
      timerDisplayMain.classList.add('text-white');
      timerDisplayMain.classList.remove('text-amber-400', 'text-error');
    }
  }
}

/**
 * Starts the countdown timer
 */
function startTimer() {
  if (isTimerRunning || currentTime === 0) return;
  
  isTimerRunning = true;
  timerInterval = setInterval(() => {
    if (currentTime > 0) {
      currentTime--;
      updateTimerDisplay();
      broadcastState();
    }
    if (currentTime === 0) {
      stopTimer();
    }
  }, 1000);
}

/**
 * Stops the countdown timer
 */
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  isTimerRunning = false;
}

/**
 * Safely adjusts current time by adding/subtracting seconds
 */
function adjustTime(secondsToAdd) {
  currentTime = Math.max(0, currentTime + secondsToAdd);
  updateTimerDisplay();
  broadcastState();
  
  if (currentTime === 0 && isTimerRunning) {
    stopTimer();
  }
}

/**
 * Toggles Senshu advantage between corners
 */
function toggleSenshu(corner) {
  if (corner === 'aka') {
    akaSenshu = !akaSenshu;
    if (akaSenshu) aoSenshu = false;
  } else if (corner === 'ao') {
    aoSenshu = !aoSenshu;
    if (aoSenshu) akaSenshu = false;
  }
  updatePenaltiesDisplay();
  broadcastState();
}

/**
 * Toggles a specific penalty for a corner
 */
function togglePenalty(corner, type) {
  if (corner === 'aka') {
    akaPenalties[type] = !akaPenalties[type];
  } else if (corner === 'ao') {
    aoPenalties[type] = !aoPenalties[type];
  }
  updatePenaltiesDisplay();
  broadcastState();
}

/**
 * Clears all penalties for a specific corner
 */
function clearPenalties(corner) {
  if (corner === 'aka') {
    for (let key in akaPenalties) akaPenalties[key] = false;
  } else if (corner === 'ao') {
    for (let key in aoPenalties) aoPenalties[key] = false;
  }
  updatePenaltiesDisplay();
  broadcastState();
}

/**
 * Updates UI for Penalties and Senshu
 */
function updatePenaltiesDisplay() {
  // AKA Senshu
  if (btnAkaSenshu) {
    if (akaSenshu) {
      btnAkaSenshu.className = "w-full py-2.5 px-space-md bg-amber-500/10 border-2 border-amber-400 text-amber-300 font-label-tactical text-label-tactical uppercase tracking-wider rounded flex items-center justify-between tactile-bevel";
      btnAkaSenshu.innerHTML = `<div class="flex items-center gap-2"><span class="material-symbols-outlined text-amber-300" style="font-variation-settings: 'FILL' 1;">stars</span><span class="font-bold">★ SENSHU ACTIVE</span></div><span class="w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b] animate-ping"></span>`;
    } else {
      btnAkaSenshu.className = "w-full py-2.5 px-space-md bg-surface-container-lowest border-2 border-surface-container-highest hover:border-amber-400/60 text-outline hover:text-amber-200 font-label-tactical text-label-tactical uppercase tracking-wider rounded flex items-center justify-between tactile-bevel transition-colors";
      btnAkaSenshu.innerHTML = `<div class="flex items-center gap-2"><span class="material-symbols-outlined text-outline">stars</span><span class="">★ SENSHU READY</span></div><span class="w-2.5 h-2.5 rounded-full bg-surface-container-highest"></span>`;
    }
  }

  // AO Senshu
  if (btnAoSenshu) {
    if (aoSenshu) {
      btnAoSenshu.className = "w-full py-2.5 px-space-md bg-amber-500/10 border-2 border-amber-400 text-amber-300 font-label-tactical text-label-tactical uppercase tracking-wider rounded flex items-center justify-between tactile-bevel";
      btnAoSenshu.innerHTML = `<div class="flex items-center gap-2"><span class="material-symbols-outlined text-amber-300" style="font-variation-settings: 'FILL' 1;">stars</span><span class="font-bold">★ SENSHU ACTIVE</span></div><span class="w-3 h-3 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b] animate-ping"></span>`;
    } else {
      btnAoSenshu.className = "w-full py-2.5 px-space-md bg-surface-container-lowest border-2 border-surface-container-highest hover:border-amber-400/60 text-outline hover:text-amber-200 font-label-tactical text-label-tactical uppercase tracking-wider rounded flex items-center justify-between tactile-bevel transition-colors";
      btnAoSenshu.innerHTML = `<div class="flex items-center gap-2"><span class="material-symbols-outlined text-outline">stars</span><span class="">★ SENSHU READY</span></div><span class="w-2.5 h-2.5 rounded-full bg-surface-container-highest"></span>`;
    }
  }

  // AKA Penalties
  const akaActiveClasses = {
    warning: "penalty-btn tactile-bevel py-2.5 px-2 bg-amber-500/10 border-2 border-amber-400 text-amber-300 rounded font-label-tactical text-label-tactical uppercase text-center font-black hover:bg-amber-400 hover:text-surface-container-lowest transition-colors",
    danger: "penalty-btn tactile-bevel py-2.5 px-2 bg-error-container/40 border-2 border-primary-container text-primary-fixed hover:bg-error-container rounded font-label-tactical text-label-tactical uppercase text-center font-black transition-colors flex flex-col items-center justify-center leading-tight"
  };
  const akaInactiveClasses = {
    warning: "penalty-btn tactile-bevel py-2.5 px-2 bg-surface-container border-2 border-surface-container-highest hover:border-amber-400 text-on-surface-variant hover:text-amber-300 rounded font-label-tactical text-label-tactical uppercase text-center font-bold transition-colors",
    danger: "penalty-btn tactile-bevel py-2.5 px-2 bg-surface-container border-2 border-surface-container-highest hover:border-amber-400 text-on-surface-variant hover:text-amber-300 rounded font-label-tactical text-label-tactical uppercase text-center font-bold transition-colors flex flex-col items-center justify-center leading-tight"
  };

  if (akaPenaltyBtns.ch1) akaPenaltyBtns.ch1.className = akaPenalties.ch1 ? akaActiveClasses.warning : akaInactiveClasses.warning;
  if (akaPenaltyBtns.ch2) akaPenaltyBtns.ch2.className = akaPenalties.ch2 ? akaActiveClasses.warning : akaInactiveClasses.warning;
  if (akaPenaltyBtns.ch3) akaPenaltyBtns.ch3.className = akaPenalties.ch3 ? akaActiveClasses.warning : akaInactiveClasses.warning;
  if (akaPenaltyBtns.hc) akaPenaltyBtns.hc.className = akaPenalties.hc ? akaActiveClasses.danger : akaInactiveClasses.danger;
  if (akaPenaltyBtns.h) akaPenaltyBtns.h.className = akaPenalties.h ? akaActiveClasses.danger : akaInactiveClasses.danger;

  // AO Penalties
  const aoActiveClasses = {
    warning: "penalty-btn tactile-bevel py-2.5 px-2 bg-amber-500/10 border-2 border-amber-400 text-amber-300 rounded font-label-tactical text-label-tactical uppercase text-center font-black hover:bg-amber-400 hover:text-surface-container-lowest transition-colors",
    danger: "penalty-btn tactile-bevel py-2.5 px-2 bg-secondary-container/40 border-2 border-secondary-container text-secondary-fixed hover:bg-secondary-container rounded font-label-tactical text-label-tactical uppercase text-center font-black transition-colors flex flex-col items-center justify-center leading-tight"
  };
  const aoInactiveClasses = {
    warning: "penalty-btn tactile-bevel py-2.5 px-2 bg-surface-container border-2 border-surface-container-highest hover:border-secondary-container text-on-surface-variant hover:text-secondary rounded font-label-tactical text-label-tactical uppercase text-center font-bold transition-colors",
    danger: "penalty-btn tactile-bevel py-2.5 px-2 bg-surface-container border-2 border-surface-container-highest hover:border-secondary-container text-on-surface-variant hover:text-secondary rounded font-label-tactical text-label-tactical uppercase text-center font-bold transition-colors flex flex-col items-center justify-center leading-tight"
  };
  
  if (aoPenaltyBtns.ch1) aoPenaltyBtns.ch1.className = aoPenalties.ch1 ? aoActiveClasses.warning : aoInactiveClasses.warning;
  if (aoPenaltyBtns.ch2) aoPenaltyBtns.ch2.className = aoPenalties.ch2 ? aoActiveClasses.warning : aoInactiveClasses.warning;
  if (aoPenaltyBtns.ch3) aoPenaltyBtns.ch3.className = aoPenalties.ch3 ? aoActiveClasses.warning : aoInactiveClasses.warning;
  if (aoPenaltyBtns.hc) aoPenaltyBtns.hc.className = aoPenalties.hc ? aoActiveClasses.danger : aoInactiveClasses.danger;
  if (aoPenaltyBtns.h) aoPenaltyBtns.h.className = aoPenalties.h ? aoActiveClasses.danger : aoInactiveClasses.danger;
}

/**
 * Resets the match state entirely.
 */
function resetMatch() {
  stopTimer();

  // Reset state
  akaScore = 0;
  aoScore = 0;
  actionHistory = [];
  currentTime = matchDuration;

  akaSenshu = false;
  aoSenshu = false;
  for (let key in akaPenalties) akaPenalties[key] = false;
  for (let key in aoPenalties) aoPenalties[key] = false;

  // Refresh UI
  updateDisplay();
  updateTimerDisplay();
  updatePenaltiesDisplay();
  broadcastState();
}

// Ensure DOM is fully loaded before attaching events
document.addEventListener('DOMContentLoaded', () => {
  
  // Attach AKA click events
  if (btnAkaYuko) btnAkaYuko.addEventListener('click', () => addPoints('aka', 1));
  if (btnAkaWazaari) btnAkaWazaari.addEventListener('click', () => addPoints('aka', 2));
  if (btnAkaIppon) btnAkaIppon.addEventListener('click', () => addPoints('aka', 3));
  if (btnAkaUndo) btnAkaUndo.addEventListener('click', () => undoLastAction());

  // Attach AO click events
  if (btnAoYuko) btnAoYuko.addEventListener('click', () => addPoints('ao', 1));
  if (btnAoWazaari) btnAoWazaari.addEventListener('click', () => addPoints('ao', 2));
  if (btnAoIppon) btnAoIppon.addEventListener('click', () => addPoints('ao', 3));
  if (btnAoUndo) btnAoUndo.addEventListener('click', () => undoLastAction());

  // Attach Reset Match event
  if (btnResetMatch) btnResetMatch.addEventListener('click', () => {
    // Optional: Add a simple confirmation dialog for destructive actions
    if (confirm("Are you sure you want to reset the match scores and timer?")) {
      resetMatch();
    }
  });

  // Attach Timer events
  if (btnTimerStart) btnTimerStart.addEventListener('click', startTimer);
  if (btnTimerStop) btnTimerStop.addEventListener('click', stopTimer);
  if (btnTimeMinus10) btnTimeMinus10.addEventListener('click', () => adjustTime(-10));
  if (btnTimeMinus1) btnTimeMinus1.addEventListener('click', () => adjustTime(-1));
  if (btnTimePlus1) btnTimePlus1.addEventListener('click', () => adjustTime(1));
  if (btnTimePlus10) btnTimePlus10.addEventListener('click', () => adjustTime(10));

  // Initial display sync
  updateDisplay();
  updateTimerDisplay();
  updatePenaltiesDisplay();
  broadcastState();
  
  // Attach Name Input events for live sync
  if (inputAkaName) inputAkaName.addEventListener('input', broadcastState);
  if (inputAoName) inputAoName.addEventListener('input', broadcastState);

  // Attach Penalty & Senshu Events
  if (btnAkaSenshu) btnAkaSenshu.addEventListener('click', () => toggleSenshu('aka'));
  if (btnAoSenshu) btnAoSenshu.addEventListener('click', () => toggleSenshu('ao'));
  
  if (btnAkaClearPenalties) btnAkaClearPenalties.addEventListener('click', () => clearPenalties('aka'));
  if (btnAoClearPenalties) btnAoClearPenalties.addEventListener('click', () => clearPenalties('ao'));

  ['ch1', 'ch2', 'ch3', 'hc', 'h'].forEach(type => {
    if (akaPenaltyBtns[type]) akaPenaltyBtns[type].addEventListener('click', () => togglePenalty('aka', type));
    if (aoPenaltyBtns[type]) aoPenaltyBtns[type].addEventListener('click', () => togglePenalty('ao', type));
  });
});
