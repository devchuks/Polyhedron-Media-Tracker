import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatestRequestGate } from '../src/utils/latestRequest.js';

test('only the latest season request remains eligible to commit', () => {
  const gate = createLatestRequestGate();
  const seasonOne = gate.begin();
  const seasonTwo = gate.begin();
  assert.equal(gate.isCurrent(seasonTwo), true);
  assert.equal(gate.isCurrent(seasonOne), false);
  gate.invalidate();
  assert.equal(gate.isCurrent(seasonTwo), false);
});

test('a late Season 1 response cannot overwrite the selected Season 2 response', async () => {
  const gate = createLatestRequestGate();
  const displayed = [];
  let resolveSeasonOne;
  let resolveSeasonTwo;
  const seasonOneResponse = new Promise(resolve => { resolveSeasonOne = resolve; });
  const seasonTwoResponse = new Promise(resolve => { resolveSeasonTwo = resolve; });

  const loadSeason = async response => {
    const token = gate.begin();
    const value = await response;
    if (gate.isCurrent(token)) displayed.push(value);
  };

  const seasonOne = loadSeason(seasonOneResponse);
  const seasonTwo = loadSeason(seasonTwoResponse);
  resolveSeasonTwo('Season 2');
  await seasonTwo;
  resolveSeasonOne('Season 1');
  await seasonOne;

  assert.deepEqual(displayed, ['Season 2']);
});
