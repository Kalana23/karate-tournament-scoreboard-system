/* Shared tournament rules and state: used by both Electron renderers and Node tests. */
(function (root) {
  'use strict';
  const modes = ['kumite', 'team_kumite', 'kata', 'team_kata'];
  const kataNames = ['Papuren', 'Chatanyara Kushanku', 'Suparinpei', 'Seipai', 'Kururunfa', 'Bassai Dai', 'Kanku Dai', 'Seienchin', 'Gojushiho'];
  const defaults = () => ({ mode: 'kumite', teamFormat: 3, teamBouts: [],
    kataScoring: 'flags', judgeCount: 5, judgeFlags: Array(5).fill(null),
    kataNames: { aka: '', ao: '' }, rosters: { aka: ['', '', ''], ao: ['', '', ''] },
    teamNames: { aka: '', ao: '' }, kataScores: { aka: Array(7).fill(''), ao: Array(7).fill('') },
    kataResults: null, bunkaiDurationMs: 300000, bunkaiMs: 300000, bunkaiRunning: false });
  const isKata = mode => mode === 'kata' || mode === 'team_kata';
  function points(scores, count) {
    if (![5, 7].includes(count) || scores.length < count) throw new Error('Select five or seven judges.');
    const values = scores.slice(0, count).map(value => value === '' || value === null ? NaN : Number(value));
    if (values.some(value => !Number.isFinite(value) || value < 7 || value > 10 || Math.abs(value * 10 - Math.round(value * 10)) > 0.00001)) {
      throw new Error('Enter every judge score from 7.0 to 10.0 in 0.1 steps.');
    }
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
    const dropped = [order[0].index, order.at(-1).index];
    const total = values.reduce((sum, value, index) => sum + (dropped.includes(index) ? 0 : Math.round(value * 10)), 0) / 10;
    return { values, dropped, total };
  }
  function kataResult(state) {
    if (state.kataScoring === 'points') {
      const r = state.kataResults;
      return { aka: r?.aka.total ?? 0, ao: r?.ao.total ?? 0,
        winner: !r || r.aka.total === r.ao.total ? null : r.aka.total > r.ao.total ? 'aka' : 'ao' };
    }
    const flags = state.judgeFlags || [];
    const aka = flags.filter(flag => flag === 'aka').length;
    const ao = flags.filter(flag => flag === 'ao').length;
    return { aka, ao, winner: aka >= 3 ? 'aka' : ao >= 3 ? 'ao' : null };
  }
  function teamSummary(bouts) {
    return bouts.reduce((r, bout) => {
      r.akaPoints += bout.akaScore; r.aoPoints += bout.aoScore;
      if (bout.winner === 'aka') r.akaWins++;
      if (bout.winner === 'ao') r.aoWins++;
      return r;
    }, { akaPoints: 0, aoPoints: 0, akaWins: 0, aoWins: 0 });
  }
  function teamStatus(state) {
    const n = state.teamFormat === 5 ? 5 : 3;
    const max = n === 5 ? 7 : 4;
    const bouts = state.teamBouts || [];
    const s = teamSummary(bouts);
    // Resolve the scheduled series by wins, then aggregate points; extras resolve remaining ties.
    let winner = null;
    if (bouts.length >= n) {
      if (s.akaWins !== s.aoWins) winner = s.akaWins > s.aoWins ? 'aka' : 'ao';
      else if (s.akaPoints !== s.aoPoints) winner = s.akaPoints > s.aoPoints ? 'aka' : 'ao';
    }
    return { ...s, winner, max, next: Math.min(bouts.length + 1, max),
      complete: !!winner || bouts.length >= max };
  }
  function viewState(state) {
    if (!isKata(state.mode)) return state;
    const result = kataResult(state);
    return { ...state, akaScore: state.kataScoring === 'points' ? result.aka.toFixed(1) : result.aka,
      aoScore: state.kataScoring === 'points' ? result.ao.toFixed(1) : result.ao,
      akaName: state.mode === 'team_kata' ? state.teamNames?.aka || 'AKA TEAM' : state.akaName,
      aoName: state.mode === 'team_kata' ? state.teamNames?.ao || 'AO TEAM' : state.aoName,
      winner: result.winner, winReason: null, hanteiMode: false, medicalActive: false,
      akaSenshu: false, aoSenshu: false, isRunning: false, timerMs: 120000 };
  }
  function modeState(state) {
    return Object.fromEntries(Object.keys(defaults()).map(key => [key, state[key]]));
  }
  const api = { modes, kataNames, defaults, isKata, points, kataResult, teamSummary, teamStatus, viewState, modeState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Tournament = api;
})(typeof window === 'undefined' ? globalThis : window);
