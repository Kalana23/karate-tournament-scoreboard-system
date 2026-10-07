/**
 * Control Console Logic for Karate Scoreboard
 */

// State variables
let akaScore = 0;
let aoScore = 0;

// Action history stack for undo functionality
// Stores objects: { corner: 'aka' | 'ao', points: number }
let actionHistory = [];

// DOM Elements - Displays
const akaScoreDisplay = document.getElementById('aka-score-display');
const aoScoreDisplay = document.getElementById('ao-score-display');

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
 * Resets the match state entirely.
 */
function resetMatch() {
  // Reset state
  akaScore = 0;
  aoScore = 0;
  actionHistory = [];

  // Refresh UI
  updateDisplay();
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
    if (confirm("Are you sure you want to reset the match scores?")) {
      resetMatch();
    }
  });

  // Initial display sync
  updateDisplay();
});
