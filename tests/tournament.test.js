const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/tournament.js');
test('five and seven judge totals drop exactly two marks, including ties', () => {
  assert.deepEqual(T.points([8, 8.1, 8.2, 8.3, 9], 5), { values: [8, 8.1, 8.2, 8.3, 9], dropped: [0, 4], total: 24.6 });
  assert.equal(T.points(Array(7).fill(8.1), 7).total, 40.5);
  assert.deepEqual(T.points(Array(5).fill(8), 5).dropped, [0, 4]);
  for (const value of ['', 6.9, 10.1, 8.15, NaN]) assert.throws(() => T.points([value, 8, 8, 8, 8], 5));
});
test('flags require a majority; points ties never declare a winner', () => {
  const state = T.defaults();
  state.judgeFlags = ['aka', 'ao', null, null, null];
  assert.equal(T.kataResult(state).winner, null);
  state.judgeFlags = ['ao', 'ao', 'ao', 'aka', 'aka'];
  assert.equal(T.kataResult(state).winner, 'ao');
  state.kataScoring = 'points';
  state.kataResults = { aka: T.points(Array(5).fill(8), 5), ao: T.points(Array(5).fill(8), 5) };
  assert.equal(T.kataResult(state).winner, null);
});
test('team series resolve wins then cumulative points and permit bounded extra bouts', () => {
  const state = T.defaults();
  const bout = (akaScore, aoScore, winner) => ({ akaScore, aoScore, winner });
  state.teamBouts = [bout(2, 0, 'aka'), bout(0, 2, 'ao'), bout(0, 0, null)];
  assert.equal(T.teamStatus(state).complete, false);
  assert.equal(T.teamStatus(state).next, 4);
  state.teamBouts.push(bout(1, 0, 'aka'));
  assert.equal(T.teamStatus(state).winner, 'aka');
  assert.equal(T.teamStatus(state).akaPoints, 3);
  state.teamFormat = 5; state.teamBouts = Array.from({ length: 7 }, () => bout(0, 0, null));
  assert.equal(T.teamStatus(state).max, 7);
  assert.equal(T.teamStatus(state).complete, true);
  assert.equal(T.teamStatus(state).winner, null);
});
test('kata view does not mutate retained Kumite results and hides its overlays', () => {
  const state = { ...T.defaults(), mode: 'team_kata', winner: 'aka', akaScore: 8, aoScore: 0, teamNames: { aka: 'A dojo', ao: 'B dojo' } };
  const view = T.viewState(state);
  assert.equal(view.akaName, 'A dojo'); assert.equal(view.akaScore, 0);
  assert.equal(view.winner, null); assert.equal(view.medicalActive, false);
  assert.equal(state.akaScore, 8); assert.equal(state.winner, 'aka');
});
