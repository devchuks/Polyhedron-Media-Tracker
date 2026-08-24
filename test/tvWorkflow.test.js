import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertDiaryLog } from '../src/domain/mediaState.js';
import {
  buildTvSeasonCompletion,
  completeTvSeries,
  executeTvSeasonCompletion,
  saveTvLibraryState,
  startTvRewatch,
} from '../src/domain/tvWorkflow.js';

const baseTv = (overrides = {}) => ({
  id: '615',
  type: 'tv',
  provider: 'tmdb',
  provider_id: '615',
  media_key: 'tmdb:tv:615',
  title: 'Final Acceptance TV',
  status: 'planned',
  progress: '',
  rating: 0,
  dateStarted: null,
  dateCompleted: null,
  rewatchCount: 0,
  ...overrides,
});

const seasonCommand = (overrides = {}) => ({
  season: 3,
  episodeCount: 10,
  seasonYear: '2025',
  completedAt: Date.parse('2026-08-24T12:00:00Z'),
  createLogId: () => 'season-3',
  ...overrides,
});

const logFor = (log_id, season, review_text = '') => ({
  log_id,
  media_id: '615',
  media_type: 'tv',
  provider: 'tmdb',
  provider_id: '615',
  media_key: 'tmdb:tv:615',
  action_type: 'WATCHED',
  log_date: '2026-08-24T10:00:00.000Z',
  review_text,
  season_label: `Season ${season}`,
});

test('planned TV has no progress and creates no implicit diary activity', () => {
  const logs = [];
  const media = saveTvLibraryState(baseTv({ progress: 'S01 E00' }), { status: 'planned', season: 1, episode: 0 });
  assert.equal(media.status, 'planned');
  assert.equal(media.progress, '');
  assert.deepEqual(logs, []);
});

test('starting a planned TV changes status without claiming an episode or adding history', () => {
  const media = saveTvLibraryState(baseTv(), { status: 'in progress', season: 1, episode: 0 });
  assert.equal(media.status, 'in progress');
  assert.equal(media.progress, '');
});

test('episode progress records only the selected actual position', () => {
  const media = saveTvLibraryState(baseTv({ status: 'in progress' }), { status: 'in progress', season: 1, episode: 4 });
  assert.equal(media.progress, 'S01 E04');
});

test('completing season 1 creates one log, keeps the series open, and does not start season 2', () => {
  const { media, log } = buildTvSeasonCompletion(baseTv({ status: 'in progress' }), seasonCommand({ season: 1, episodeCount: 10, createLogId: () => 's1' }));
  assert.equal(media.status, 'in progress');
  assert.equal(media.dateCompleted, null);
  assert.equal(media.progress, 'S01 E10');
  assert.equal(log.season_label, 'Season 1');
  assert.equal(log.log_id, 's1');
});

test('starting season 2 is a separate explicit progress command', () => {
  const afterSeasonOne = baseTv({ status: 'in progress', progress: 'S01 E10' });
  const media = saveTvLibraryState(afterSeasonOne, { status: 'in progress', season: 2, episode: 1 });
  assert.equal(media.progress, 'S02 E01');
});

test('logging an intermediate season creates only that selected season', async () => {
  let logs = [logFor('s1', 1)];
  let calls = 0;
  await executeTvSeasonCompletion({
    item: baseTv({ status: 'in progress', progress: 'S01 E10' }),
    command: seasonCommand({ season: 2, createLogId: () => 's2' }),
    saveMediaWithLog: async (_media, _type, log) => { calls += 1; logs = upsertDiaryLog(logs, log); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(logs.map(log => log.season_label).sort(), ['Season 1', 'Season 2']);
});

test('logging a final season never fabricates missing prior-season history', async () => {
  let logs = [];
  await executeTvSeasonCompletion({
    item: baseTv({ status: 'in progress' }),
    command: seasonCommand({ createLogId: () => 's3' }),
    saveMediaWithLog: async (_media, _type, log) => { logs = upsertDiaryLog(logs, log); },
  });
  assert.deepEqual(logs.map(log => log.season_label), ['Season 3']);
});

test('whole-series completion sets overall state without generating diary history or fictional progress', () => {
  const logs = [logFor('s3', 3)];
  const media = completeTvSeries(baseTv({ status: 'in progress', progress: 'S03 E10' }), {
    completionTimestamp: Date.parse('2026-08-24T16:00:00Z'),
  });
  assert.equal(media.status, 'completed');
  assert.equal(media.progress, 'S03 E10');
  assert.equal(media.dateCompleted, Date.parse('2026-08-24T16:00:00Z'));
  assert.equal(logs.length, 1);
});

test('leaving completed clears overall completion while preserving diary history', () => {
  const logs = [logFor('s1', 1), logFor('s2', 2)];
  const media = saveTvLibraryState(baseTv({ status: 'completed', progress: 'S02 E10', dateCompleted: 123 }), {
    status: 'in progress', season: 2, episode: 10,
  });
  assert.equal(media.dateCompleted, null);
  assert.equal(logs.length, 2);
});

test('re-completing succeeds without removing historical logs', () => {
  const logs = [logFor('s1', 1)];
  const reopened = baseTv({ status: 'in progress', progress: 'S01 E10', dateCompleted: null });
  const media = completeTvSeries(reopened, { completionTimestamp: 456 });
  assert.equal(media.status, 'completed');
  assert.equal(media.dateCompleted, 456);
  assert.equal(logs[0].log_id, 's1');
});

test('a same-day season rewatch is a new activity and does not increment whole-series rewatch count', () => {
  const original = logFor('watch', 3);
  const { media, log } = buildTvSeasonCompletion(baseTv({ status: 'completed', dateCompleted: 123, rewatchCount: 2 }), seasonCommand({
    isRewatch: true,
    createLogId: () => 'rewatch',
  }));
  const logs = upsertDiaryLog([original], log);
  assert.equal(log.action_type, 'RE-WATCHED');
  assert.equal(logs.length, 2);
  assert.equal(media.rewatchCount, 2);
  assert.equal(media.status, 'in progress');
  assert.equal(media.dateCompleted, null);
});

test('only explicit full-series rewatch completion increments rewatchCount', () => {
  const started = startTvRewatch(baseTv({ status: 'completed', progress: 'S03 E10', dateCompleted: 123, rewatchCount: 2 }));
  assert.equal(started.progress, '');
  assert.equal(started.rewatchCount, 2);
  const completed = completeTvSeries(started, { completionTimestamp: 456, isRewatch: true });
  assert.equal(completed.rewatchCount, 3);
});

test('starting a rewatch clears the prior final-episode position even when the modal still supplies it', () => {
  const started = startTvRewatch({
    ...baseTv(),
    status: 'completed',
    progress: 'S05 E16',
    dateCompleted: Date.parse('2026-08-23T12:00:00.000Z'),
  }, { season: 5, episode: 16 });

  assert.equal(started.status, 'in progress');
  assert.equal(started.progress, '');
  assert.equal(started.dateCompleted, null);
});

test('editing Season 3 targets its stable ID and preserves Season 1 and Season 2 siblings', async () => {
  const original = [logFor('s1', 1), logFor('s2', 2), logFor('s3', 3, 'old')];
  let logs = original;
  let calls = 0;
  await executeTvSeasonCompletion({
    item: baseTv({ status: 'in progress' }),
    command: seasonCommand({ logId: 's3', reviewText: 'edited', createLogId: () => 'must-not-be-used' }),
    saveMediaWithLog: async (_media, _type, log) => { calls += 1; logs = upsertDiaryLog(logs, log); },
  });
  assert.equal(calls, 1);
  assert.equal(logs.find(log => log.log_id === 's3').review_text, 'edited');
  assert.deepEqual(logs.filter(log => log.log_id !== 's3'), original.filter(log => log.log_id !== 's3'));
});

test('creating a Season-3 rewatch beside existing Season 3 uses a new stable ID', async () => {
  let logs = [logFor('s3', 3)];
  await executeTvSeasonCompletion({
    item: baseTv({ status: 'completed', dateCompleted: 123 }),
    command: seasonCommand({ isRewatch: true, createLogId: () => 's3-rewatch' }),
    saveMediaWithLog: async (_media, _type, log) => { logs = upsertDiaryLog(logs, log); },
  });
  assert.deepEqual(new Set(logs.map(log => log.log_id)), new Set(['s3', 's3-rewatch']));
});

test('deleting one historical season leaves siblings and current library state untouched', () => {
  const media = baseTv({ status: 'in progress', progress: 'S03 E04' });
  const logs = [logFor('s1', 1), logFor('s2', 2), logFor('s3', 3)];
  const remaining = logs.filter(log => log.log_id !== 's2');
  assert.deepEqual(remaining.map(log => log.log_id), ['s1', 's3']);
  assert.equal(media.progress, 'S03 E04');
  assert.equal(media.status, 'in progress');
});
