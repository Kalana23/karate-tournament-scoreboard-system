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

// DOM Elements - Global Buttons
const btnResetMatch = document.getElementById('btn-reset-match');

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
  
  if (currentTime === 0 && isTimerRunning) {
    stopTimer();
  }
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

  // Refresh UI
  updateDisplay();
  updateTimerDisplay();
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
});
