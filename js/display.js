/**
 * Main Arena Display Receiver Logic
 * Listens for localStorage updates from the Control Console.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const displayAkaScore = document.getElementById('display-aka-score');
  const displayAoScore = document.getElementById('display-ao-score');
  const displayTimer = document.getElementById('display-timer');
  
  const displayAkaName = document.getElementById('display-aka-name');
  const displayAkaCountry = document.getElementById('display-aka-country');
  const displayAoName = document.getElementById('display-ao-name');
  const displayAoCountry = document.getElementById('display-ao-country');
  
  const displayAkaSenshu = document.getElementById('display-aka-senshu');
  const displayAoSenshu = document.getElementById('display-ao-senshu');

  const akaPenalties = {
    ch1: document.getElementById('display-aka-ch1'),
    ch2: document.getElementById('display-aka-ch2'),
    ch3: document.getElementById('display-aka-ch3'),
    hc: document.getElementById('display-aka-hc'),
    h: document.getElementById('display-aka-h')
  };

  const aoPenalties = {
    ch1: document.getElementById('display-ao-ch1'),
    ch2: document.getElementById('display-ao-ch2'),
    ch3: document.getElementById('display-ao-ch3'),
    hc: document.getElementById('display-ao-hc'),
    h: document.getElementById('display-ao-h')
  };

  // Helper to format time
  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // Update UI function
  function updateArenaDisplay(state) {
    if (!state) return;

    // Scores
    if (displayAkaScore) displayAkaScore.innerText = state.akaScore;
    if (displayAoScore) displayAoScore.innerText = state.aoScore;

    // Names and Countries
    if (displayAkaName) displayAkaName.innerText = state.akaName || 'PLAYER 1 NAME';
    if (displayAkaCountry) displayAkaCountry.innerText = state.akaCountry || 'SRI';
    if (displayAoName) displayAoName.innerText = state.aoName || 'PLAYER 2 NAME';
    if (displayAoCountry) displayAoCountry.innerText = state.aoCountry || 'JPN';

    // Timer
    if (displayTimer) {
      displayTimer.innerText = formatTime(state.currentTime);
      if (state.currentTime <= 15 && state.currentTime > 0) {
        displayTimer.classList.add('text-yellow-400');
        displayTimer.classList.remove('text-white', 'text-red-500');
      } else if (state.currentTime === 0) {
        displayTimer.classList.add('text-red-500');
        displayTimer.classList.remove('text-white', 'text-yellow-400');
      } else {
        displayTimer.classList.add('text-white');
        displayTimer.classList.remove('text-yellow-400', 'text-red-500');
      }
    }

    // Senshu
    if (displayAkaSenshu) {
      if (state.akaSenshu) {
        displayAkaSenshu.classList.remove('opacity-0');
        displayAkaSenshu.classList.add('opacity-100');
      } else {
        displayAkaSenshu.classList.add('opacity-0');
        displayAkaSenshu.classList.remove('opacity-100');
      }
    }

    if (displayAoSenshu) {
      if (state.aoSenshu) {
        displayAoSenshu.classList.remove('opacity-0');
        displayAoSenshu.classList.add('opacity-100');
      } else {
        displayAoSenshu.classList.add('opacity-0');
        displayAoSenshu.classList.remove('opacity-100');
      }
    }

    // Penalties Styling helper
    const applyPenaltyStyles = (element, isActive, type) => {
      if (!element) return;
      // Base styles (always present in HTML, but we swap specific colors)
      // Defaults: bg-black/40 text-white border-white/30
      if (isActive) {
        if (type === 'h' || type === 'hc') {
          // Danger
          element.classList.remove('bg-black/40', 'border-white/30');
          element.classList.add('bg-red-600', 'border-red-500', 'shadow-[0_0_20px_rgba(220,38,38,0.7)]');
        } else {
          // Warning
          element.classList.remove('bg-black/40', 'border-white/30', 'text-white');
          element.classList.add('bg-yellow-400', 'border-yellow-400', 'text-neutral-950', 'shadow-[0_0_15px_rgba(250,204,21,0.6)]');
        }
      } else {
        // Reset to Default
        if (type === 'h' || type === 'hc') {
          element.classList.add('bg-black/40', 'border-white/30');
          element.classList.remove('bg-red-600', 'border-red-500', 'shadow-[0_0_20px_rgba(220,38,38,0.7)]');
        } else {
          element.classList.add('bg-black/40', 'border-white/30', 'text-white');
          element.classList.remove('bg-yellow-400', 'border-yellow-400', 'text-neutral-950', 'shadow-[0_0_15px_rgba(250,204,21,0.6)]');
        }
      }
    };

    if (state.akaPenalties) {
      applyPenaltyStyles(akaPenalties.ch1, state.akaPenalties.ch1, 'ch1');
      applyPenaltyStyles(akaPenalties.ch2, state.akaPenalties.ch2, 'ch2');
      applyPenaltyStyles(akaPenalties.ch3, state.akaPenalties.ch3, 'ch3');
      applyPenaltyStyles(akaPenalties.hc, state.akaPenalties.hc, 'hc');
      applyPenaltyStyles(akaPenalties.h, state.akaPenalties.h, 'h');
    }

    if (state.aoPenalties) {
      applyPenaltyStyles(aoPenalties.ch1, state.aoPenalties.ch1, 'ch1');
      applyPenaltyStyles(aoPenalties.ch2, state.aoPenalties.ch2, 'ch2');
      applyPenaltyStyles(aoPenalties.ch3, state.aoPenalties.ch3, 'ch3');
      applyPenaltyStyles(aoPenalties.hc, state.aoPenalties.hc, 'hc');
      applyPenaltyStyles(aoPenalties.h, state.aoPenalties.h, 'h');
    }
  }

  // Initial load
  const storedState = localStorage.getItem('karateMatchState');
  if (storedState) {
    try {
      updateArenaDisplay(JSON.parse(storedState));
    } catch (e) {
      console.error('Failed to parse initial state:', e);
    }
  }

  // Listen to cross-window storage events
  window.addEventListener('storage', (event) => {
    if (event.key === 'karateMatchState') {
      try {
        const state = JSON.parse(event.newValue);
        updateArenaDisplay(state);
      } catch (e) {
        console.error('Failed to parse state update:', e);
      }
    }
  });
});
