/* Mode-specific UI and workflows. Existing Kumite engines remain in control.js. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let lastBunkaiTick = performance.now();
  let kumiteSnapshot = null;
  const button = (id, text) => `<button type="button" id="${id}">${text}</button>`;
  function message(text = '') { $('platform-message').textContent = text; }
  function publish() { render(); broadcastState(true); }
  function resetFighter() {
    stopTimer(false);
    stopMedicalTimer();
    Object.assign(STATE, { akaScore: 0, aoScore: 0, akaSenshu: false, aoSenshu: false,
      winner: null, winReason: null, hanteiMode: false, hanteiWinner: null,
      timerMs: STATE.matchDurationMs, atoshiBarakuFired: false, medicalActive: false, medicalMs: 10000 });
    for (const side of ['aka', 'ao']) Object.keys(STATE[side + 'Penalties']).forEach(key => STATE[side + 'Penalties'][key] = false);
    akaHistory.length = 0; aoHistory.length = 0;
    showHanteiBanner(false); lockScoringButtons(false);
    updateScoreDisplay(); updateTimerDisplay(); renderPenalties(); renderSenshu(); updateStatusRibbon();
  }
  function setMode(mode) {
    if (!Tournament.modes.includes(mode) || mode === STATE.mode) return;
    stopTimer(false); stopMedicalTimer(); STATE.bunkaiRunning = false;
    if (!Tournament.isKata(STATE.mode)) {
      kumiteSnapshot = Object.fromEntries(['winner', 'winReason', 'hanteiMode', 'hanteiWinner'].map(key => [key, STATE[key]]));
    }
    STATE.mode = mode;
    if (Tournament.isKata(mode)) {
      STATE.winner = null; STATE.winReason = null; STATE.hanteiMode = false;
      showHanteiBanner(false);
    } else if (kumiteSnapshot) Object.assign(STATE, kumiteSnapshot);
    updateStatusRibbon(); message(); publish();
  }
  function recordBout() {
    if (STATE.mode !== 'team_kumite') return;
    const status = Tournament.teamStatus(STATE);
    if (status.complete) return message('Series complete. Reset the team match to start another series.');
    if (STATE.isRunning || STATE.medicalActive) return message('Stop the match clock and medical timer before recording.');
    let winner = STATE.winner;
    if (!winner && STATE.timerMs > 0) return message('Finish the bout before recording it. Use Hantei for a decision.');
    if (!winner && STATE.akaScore !== STATE.aoScore) winner = STATE.akaScore > STATE.aoScore ? 'aka' : 'ao';
    STATE.teamBouts.push({ akaScore: STATE.akaScore, aoScore: STATE.aoScore, winner,
      akaName: $('input-aka-name').value, aoName: $('input-ao-name').value, reason: STATE.winReason || 'DRAW', ts: Date.now() });
    const result = Tournament.teamStatus(STATE);
    STATE.akaTeamWins = result.akaWins; STATE.aoTeamWins = result.aoWins;
    resetFighter();
    if (!result.complete) {
      $('input-aka-name').value = ''; $('input-ao-name').value = '';
    }
    message(result.complete ? (result.winner ? `${result.winner.toUpperCase()} wins the team match.` : 'Series tied. A referee decision is required.') : 'Next fighter ready.');
    publish();
  }
  function resetTeam() {
    if (!confirm('Reset the entire team series and current bout?')) return;
    STATE.teamBouts = []; STATE.akaTeamWins = 0; STATE.aoTeamWins = 0;
    resetFighter(); message(); publish();
  }
  function bunkaiAction(action) {
    if (STATE.mode !== 'team_kata') return;
    if (action === 'start' && STATE.bunkaiMs > 0) { STATE.bunkaiRunning = true; lastBunkaiTick = performance.now(); }
    if (action === 'stop') STATE.bunkaiRunning = false;
    if (action === 'reset') { STATE.bunkaiRunning = false; STATE.bunkaiMs = STATE.bunkaiDurationMs; }
    publish();
  }
  function clock(ms) {
    return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000 / 10)).padStart(2, '0')}`;
  }
  function render() {
    document.body.dataset.mode = STATE.mode;
    document.querySelectorAll('[data-set-mode]').forEach(el => el.setAttribute('aria-pressed', el.dataset.setMode === STATE.mode));
    const kata = Tournament.isKata(STATE.mode);
    for (const side of ['aka', 'ao']) {
      const input = $('input-' + side + '-name');
      input.parentElement.querySelector('label').textContent = STATE.mode === 'team_kata' ? 'Individual name (retained)' : 'Competitor Name';
      input.parentElement.parentElement.hidden = STATE.mode === 'team_kata';
      $('kata-judge-inputs-' + side).hidden = STATE.kataScoring !== 'points';
    }
    if (kata) {
      const r = Tournament.kataResult(STATE);
      for (const side of ['aka', 'ao']) $('kata-total-' + side).textContent = STATE.kataScoring === 'points' ? r[side].toFixed(1) : r[side];
    }
    document.querySelectorAll('[data-scoring]').forEach(el => el.setAttribute('aria-pressed', el.dataset.scoring === STATE.kataScoring));
    $('flag-controls').hidden = STATE.kataScoring !== 'flags';
    $('point-controls').hidden = STATE.kataScoring !== 'points';
    document.querySelectorAll('[data-judge-count]').forEach(el => el.setAttribute('aria-pressed', Number(el.dataset.judgeCount) === STATE.judgeCount));
    document.querySelectorAll('[data-judge-input]').forEach(el => { el.parentElement.hidden = Number(el.dataset.index) >= STATE.judgeCount; });
    document.querySelectorAll('[data-flag-index]').forEach(el => {
      const flag = STATE.judgeFlags[Number(el.dataset.flagIndex)];
      el.dataset.flag = flag || '';
      el.textContent = `J${Number(el.dataset.flagIndex) + 1}: ${flag ? flag.toUpperCase() : 'Neutral'}`;
      el.setAttribute('aria-label', `${el.textContent}. Click to cycle Neutral, AKA, AO.`);
    });
    const s = Tournament.teamStatus(STATE);
    $('team-status').textContent = `AKA ${s.akaWins} wins / ${s.akaPoints} pts — AO ${s.aoWins} wins / ${s.aoPoints} pts`;
    $('team-active-bout').textContent = s.complete ? 'SERIES COMPLETE' : `Next: ${s.next > STATE.teamFormat ? 'Extra Bout ' + (s.next - STATE.teamFormat) : 'Bout ' + s.next}`;
    $('record-team-bout').disabled = s.complete;
    $('team-format').value = STATE.teamFormat;
    $('team-format').disabled = STATE.teamBouts.length > 0;
    $('bunkai-control-clock').textContent = clock(STATE.bunkaiMs);
    $('bunkai-duration').disabled = STATE.bunkaiRunning;
    $('aka-team-wins-label').textContent = STATE.akaTeamWins;
    $('ao-team-wins-label').textContent = STATE.aoTeamWins;
  }
  function init() {
    const center = $('center-panel');
    // Tag existing blocks rather than replacing their working event handlers.
    Array.from(center.children).forEach(el => { if (!el.contains($('btn-manual-buzzer'))) el.dataset.kumite = ''; });
    for (const side of ['aka', 'ao']) {
      const panel = $(side + '-panel');
      const penaltyRow = document.createElement('div');
      penaltyRow.style.cssText = 'display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px';
      const oldRows = new Set();
      const firstPenalty = $('btn-' + side + '-ch1');
      firstPenalty.parentElement.parentElement.insertBefore(penaltyRow, firstPenalty.parentElement);
      for (const kind of ['ch1', 'ch2', 'ch3', 'hc', 'h']) {
        const penalty = $('btn-' + side + '-' + kind);
        oldRows.add(penalty.parentElement); penaltyRow.appendChild(penalty);
      }
      oldRows.forEach(el => el.remove());
      $(side + '-team-wins-label').parentElement.dataset.teamKumite = '';
      // Series wins are derived exclusively from recorded bouts.
      $('btn-' + side + '-team-inc').hidden = true; $('btn-' + side + '-team-dec').hidden = true;
      const score = $(side + '-score-display').parentElement;
      let afterIdentity = false;
      Array.from(panel.children).forEach(el => {
        if (el === score) afterIdentity = true;
        if (afterIdentity) el.dataset.kumite = '';
      });
      panel.insertAdjacentHTML('beforeend', `<div data-kata class="platform-stack">
        <div data-team-kata class="platform-box"><h3>Team / Dojo / Country Name</h3><input id="team-name-${side}" aria-label="${side} team name">
          <div class="athlete-grid grid grid-cols-3 gap-1.5">${[0, 1, 2].map(i => `<label>Athlete ${i + 1}<input id="athlete-${side}-${i}" aria-label="${side} athlete ${i + 1}"></label>`).join('')}</div></div>
        <div class="platform-box"><label>Kata Name<input id="kata-name-${side}" list="kata-options" placeholder="Search or enter a kata"></label></div>
        <div class="platform-box published-total"><h3>Published total</h3><div id="kata-total-${side}" class="text-4xl font-black text-center">0</div></div>
        <div id="kata-judge-inputs-${side}" class="platform-box"><h3>${side.toUpperCase()} judge scores</h3><div class="judge-grid">${Array.from({ length: 7 }, (_, i) => `<label>J${i + 1}<input data-judge-input data-side="${side}" data-index="${i}" type="number" min="7" max="10" step="0.1" aria-label="${side} judge ${i + 1} score"></label>`).join('')}</div></div>
      </div>`);
      $('kata-name-' + side).addEventListener('input', e => { STATE.kataNames[side] = e.target.value; publish(); });
      $('team-name-' + side).addEventListener('input', e => { STATE.teamNames[side] = e.target.value; publish(); });
      for (let i = 0; i < 3; i++) $('athlete-' + side + '-' + i).addEventListener('input', e => { STATE.rosters[side][i] = e.target.value; publish(); });
    }
    center.insertAdjacentHTML('afterbegin', `<div data-team-kumite class="platform-box team-series"><h3>Team Kumite Series</h3>
      <div class="team-series-row"><label class="sr-only" for="team-format">Team format</label><select id="team-format"><option value="3">3+1 Mode</option><option value="5">5+2 Mode</option></select>
      <strong id="team-active-bout"></strong>${button('record-team-bout', 'Record Bout')}${button('reset-team-match', 'Reset Team')}</div><p id="team-status"></p></div>
      <div data-kata class="platform-stack"><div class="scoring-switch"><button data-scoring="flags">🚩 FLAG SYSTEM (HANTEI)</button><button data-scoring="points">🔢 POINT SYSTEM</button></div>
      <div id="flag-controls" class="platform-box"><h3>Five judge flags</h3><div class="judge-flags">${Array.from({ length: 5 }, (_, i) => `<button data-flag-index="${i}" class="judge-flag">J${i + 1}</button>`).join('')}</div>
      <div class="bout-pills">${[5, 4, 3, 2, 1, 0].map(n => `<button data-quick-flags="${n}">${n >= 3 ? n + '-' + (5 - n) + ' AKA' : (5 - n) + '-' + n + ' AO'}</button>`).join('')}${button('clear-flags', 'Clear Flags')}</div></div>
      <div id="point-controls" class="platform-box platform-stack"><div class="scoring-switch"><button data-judge-count="5">5 Judges</button><button data-judge-count="7">7 Judges</button></div>${button('calculate-kata', 'CALCULATE &amp; PUBLISH SCORE')}<p>One highest and one lowest mark are dropped. Equal totals remain tied for a referee decision.</p></div>
      <div data-team-kata class="platform-box"><h3>Kata &amp; Bunkai Timer</h3><label>Duration<select id="bunkai-duration"><option value="300000">5:00</option><option value="360000">6:00</option></select></label><div id="bunkai-control-clock" class="bunkai-clock"></div><div class="bunkai-actions">${button('bunkai-start', 'Start')}${button('bunkai-stop', 'Stop')}${button('bunkai-reset', 'Reset')}</div></div></div>
      <p id="platform-message" role="status" class="mode-message"></p>
      <datalist id="kata-options">${Tournament.kataNames.map(name => `<option value="${name}"></option>`).join('')}</datalist>`);
    for (const id of ['btn-medical-timer', 'btn-hantei', 'btn-doctor-time', 'btn-duration-cycle', 'btn-timer-reset-icon', 'btn-reset-match']) $(id).dataset.kumite = '';
    $('preset-select').parentElement.dataset.kumite = '';
    document.querySelectorAll('[data-set-mode]').forEach(el => el.addEventListener('click', () => setMode(el.dataset.setMode)));
    document.querySelectorAll('[data-scoring]').forEach(el => el.addEventListener('click', () => { STATE.kataScoring = el.dataset.scoring; message(); publish(); }));
    document.querySelectorAll('[data-flag-index]').forEach(el => el.addEventListener('click', () => {
      const i = Number(el.dataset.flagIndex); STATE.judgeFlags[i] = [null, 'aka', 'ao'][([null, 'aka', 'ao'].indexOf(STATE.judgeFlags[i]) + 1) % 3]; publish();
    }));
    document.querySelectorAll('[data-quick-flags]').forEach(el => el.addEventListener('click', () => { STATE.judgeFlags = Array.from({ length: 5 }, (_, i) => i < Number(el.dataset.quickFlags) ? 'aka' : 'ao'); publish(); }));
    $('clear-flags').addEventListener('click', () => { STATE.judgeFlags.fill(null); publish(); });
    document.querySelectorAll('[data-judge-count]').forEach(el => el.addEventListener('click', () => { STATE.judgeCount = Number(el.dataset.judgeCount); STATE.kataResults = null; publish(); }));
    document.querySelectorAll('[data-judge-input]').forEach(el => el.addEventListener('input', () => { STATE.kataScores[el.dataset.side][Number(el.dataset.index)] = el.value; }));
    $('calculate-kata').addEventListener('click', () => {
      try {
        const aka = Tournament.points(STATE.kataScores.aka, STATE.judgeCount);
        const ao = Tournament.points(STATE.kataScores.ao, STATE.judgeCount);
        STATE.kataResults = { aka, ao }; message(); publish();
      } catch (e) { message(e.message); }
    });
    $('team-format').addEventListener('change', e => { STATE.teamFormat = Number(e.target.value); publish(); });
    $('record-team-bout').addEventListener('click', recordBout);
    $('reset-team-match').addEventListener('click', resetTeam);
    $('bunkai-duration').addEventListener('change', e => { STATE.bunkaiDurationMs = Number(e.target.value); bunkaiAction('reset'); });
    for (const action of ['start', 'stop', 'reset']) $('bunkai-' + action).addEventListener('click', () => bunkaiAction(action));
    if (ipc) ipc.on('bunkai-action', (_, action) => bunkaiAction(action));
    window.addEventListener('storage', e => {
      if (e.key === 'karateBunkaiAction' && e.newValue) {
        try { bunkaiAction(JSON.parse(e.newValue).action); } catch (error) { console.warn(error); }
      }
    });
    setInterval(() => {
      const now = performance.now();
      if (!STATE.bunkaiRunning || STATE.mode !== 'team_kata') return;
      STATE.bunkaiMs = Math.max(0, STATE.bunkaiMs - (now - lastBunkaiTick)); lastBunkaiTick = now;
      if (!STATE.bunkaiMs) { STATE.bunkaiRunning = false; playVictoryBuzzer(); }
      publish();
    }, 50);
    render();
  }
  window.TournamentControl = { setMode, recordBout, bunkaiAction, resetFighter };
  document.addEventListener('DOMContentLoaded', init);
})();
