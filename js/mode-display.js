(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let mounted = false;
  const text = (tag, value, className) => {
    const el = document.createElement(tag); el.textContent = value;
    if (className) el.className = className;
    return el;
  };
  function mount() {
    const main = document.querySelector('main');
    const timer = $('display-timer');
    timer.parentElement.parentElement.querySelectorAll(':scope > div').forEach((el, i) => { if (i !== 0) el.dataset.kumite = ''; });
    for (const side of ['aka', 'ao']) {
      $('display-' + side + '-senshu').dataset.kumite = '';
      $('display-' + side + '-ch1').parentElement.parentElement.dataset.kumite = '';
      const name = $('display-' + side + '-name');
      const roster = text('div', '', 'kata-roster'); roster.id = 'arena-roster-' + side; roster.dataset.teamKata = '';
      name.parentElement.parentElement.appendChild(roster);
      const cards = text('div', '', 'kata-scorecards'); cards.id = 'arena-judges-' + side; cards.dataset.kata = '';
      main.querySelectorAll(':scope > section')[side === 'aka' ? 0 : 1].appendChild(cards);
    }
    main.insertAdjacentHTML('beforeend', `<div data-kata class="kata-center"><div class="kata-banner"><div id="arena-kata-aka"></div><div id="arena-kata-ao"></div></div><div id="arena-flags" class="judge-flags"></div><div data-team-kata class="platform-box"><div>KATA &amp; BUNKAI</div><div id="arena-bunkai-clock" class="bunkai-clock"></div><div class="bunkai-actions"><button data-bunkai-action="start">Start</button><button data-bunkai-action="stop">Stop</button><button data-bunkai-action="reset">Reset</button></div></div></div>`);
    document.querySelectorAll('[data-bunkai-action]').forEach(el => el.addEventListener('click', () => {
      const action = el.dataset.bunkaiAction;
      try {
        if (window.require) window.require('electron').ipcRenderer.send('bunkai-action', action);
        else localStorage.setItem('karateBunkaiAction', JSON.stringify({ action, ts: Date.now() }));
      } catch (e) { console.warn('Timer action could not be sent', e); }
    }));
    mounted = true;
  }
  let lastKataSignature = '';
  let lastTeamSignature = '';
  function render(state) {
    if (!mounted) mount();
    document.body.dataset.mode = state.mode || 'kumite';
    const kata = Tournament.isKata(state.mode);
    if (state.mode === 'team_kumite') {
      const signature = JSON.stringify([state.teamFormat, state.teamBouts]);
      if (signature !== lastTeamSignature) {
        lastTeamSignature = signature;
        const s = Tournament.teamStatus(state);
        const tracker = $('arena-team-tracker'); tracker.replaceChildren();
        const summary = text('div', '', 'team-summary');
        summary.append(text('strong', `AKA TEAM WINS ${s.akaWins}`), text('span', `TOTAL POINTS: AKA ${s.akaPoints} - ${s.aoPoints} AO`), text('strong', `AO TEAM WINS ${s.aoWins}`));
        tracker.append(summary);
        const pills = text('div', '', 'bout-pills');
        for (let i = 0; i < s.max; i++) {
          const bout = state.teamBouts?.[i];
          const label = i < state.teamFormat ? `BOUT ${i + 1}` : `EXTRA BOUT ${i - state.teamFormat + 1}`;
          const pill = text('span', bout ? `${label}: ${bout.akaScore}-${bout.aoScore} (${bout.winner?.toUpperCase() || 'DRAW'})` : label, 'bout-pill');
          pill.dataset.winner = bout?.winner || ''; pills.append(pill);
        }
        tracker.append(pills);
        if (s.complete) tracker.append(text('div', s.winner ? `${s.winner.toUpperCase()} WINS THE SERIES` : 'SERIES TIED — REFEREE DECISION REQUIRED'));
      }
    }
    if (!kata) return;
    const signature = JSON.stringify([state.mode, state.kataScoring, state.kataNames, state.judgeFlags, state.kataResults, state.rosters]);
    if (signature !== lastKataSignature) {
      lastKataSignature = signature;
      for (const side of ['aka', 'ao']) {
        $('arena-kata-' + side).textContent = `${side.toUpperCase()}: ${state.kataNames?.[side] || 'Kata not selected'}`;
        $('arena-roster-' + side).textContent = (state.rosters?.[side] || []).filter(Boolean).join(' • ');
        const cards = $('arena-judges-' + side); cards.replaceChildren();
        const result = state.kataScoring === 'points' ? state.kataResults?.[side] : null;
        if (result) result.values.forEach((value, i) => {
          const card = text('div', value.toFixed(1), 'kata-scorecard' + (result.dropped.includes(i) ? ' dropped' : ''));
          card.prepend(text('small', `J${i + 1}${result.dropped.includes(i) ? ' DROPPED' : ''}`)); cards.append(card);
        });
      }
      const flags = $('arena-flags'); flags.replaceChildren();
      flags.hidden = state.kataScoring !== 'flags';
      if (!flags.hidden) (state.judgeFlags || Array(5).fill(null)).forEach((flag, i) => {
        const el = text('div', `J${i + 1} ${flag ? (flag === 'aka' ? '🚩' : '⚑') : '—'}`, 'judge-flag');
        el.dataset.flag = flag || ''; el.setAttribute('aria-label', `Judge ${i + 1}: ${flag || 'neutral'}`); flags.append(el);
      });
    }
    const ms = state.bunkaiMs ?? 300000;
    $('arena-bunkai-clock').textContent = `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000 / 10)).padStart(2, '0')}`;
  }
  window.TournamentDisplay = { render };
})();
