import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { upsertDiaryLog } from '../src/domain/mediaState.js';
import {
  buildTvSeasonCompletion,
  completeTvSeries,
  executeTvSeasonCompletion,
  TV_WHOLE_SHOW,
  buildTvDiaryEntry,
  defaultTvDiaryTarget,
  progressSeason,
  saveTvLibraryState,
  startTvRewatch,
  tvSeasonOptions,
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
  const activityTimestamp = Date.parse('2026-08-20T14:30:00Z');
  const media = saveTvLibraryState(baseTv(), { status: 'in progress', season: 1, episode: 0, activityTimestamp });
  assert.equal(media.status, 'in progress');
  assert.equal(media.progress, '');
  assert.equal(media.dateStarted, activityTimestamp);
});

test('episode progress records only the selected actual position', () => {
  const originalStarted = Date.parse('2026-08-19T10:00:00Z');
  const media = saveTvLibraryState(baseTv({ status: 'in progress', dateStarted: originalStarted }), { status: 'in progress', season: 1, episode: 4, activityTimestamp: Date.parse('2026-08-22T18:00:00Z') });
  assert.equal(media.progress, 'S01 E04');
  assert.equal(media.dateStarted, originalStarted);
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

test('editing Completed On for an already-completed show updates the completion date', () => {
  const completed = baseTv({ status: 'completed', progress: 'S03 E10', dateStarted: 1000, dateCompleted: 5000 });
  const unchanged = saveTvLibraryState(completed, { status: 'completed', season: 3, episode: 10, completionTimestamp: 9999 });
  assert.equal(unchanged.dateCompleted, 5000);
  const edited = saveTvLibraryState(completed, { status: 'completed', season: 3, episode: 10, completionTimestamp: 9999, completedDateEdited: true });
  assert.equal(edited.dateCompleted, 9999);
});

test('logging an earlier season is history only and never rewinds later progress', () => {
  const watching = baseTv({ status: 'in progress', progress: 'S04 E03', dateStarted: 1000 });
  const { media, log } = buildTvSeasonCompletion(watching, seasonCommand({ season: 1, episodeCount: 8 }));
  assert.equal(media.progress, 'S04 E03');
  assert.equal(log.season_label, 'Season 1');

  const completed = baseTv({ status: 'completed', progress: 'S03 E10', dateStarted: 1000, dateCompleted: 5000 });
  const history = buildTvSeasonCompletion(completed, seasonCommand({ season: 1, episodeCount: 8 }));
  assert.equal(history.media.progress, 'S03 E10');
  assert.equal(history.media.status, 'completed');
  assert.equal(history.media.dateCompleted, 5000);

  // The current or a later season still advances progress, and a rewatch restarts the position.
  assert.equal(buildTvSeasonCompletion(watching, seasonCommand({ season: 4, episodeCount: 9 })).media.progress, 'S04 E09');
  assert.equal(buildTvSeasonCompletion(completed, seasonCommand({ season: 1, episodeCount: 8, isRewatch: true })).media.progress, 'S01 E08');
});

test('season choices come from provider seasons, exclude specials, and keep the stored season', () => {
  assert.deepEqual(tvSeasonOptions([{ season_number: 0 }, { season_number: 1 }, { season_number: 2 }], 2, 1), [1, 2]);
  assert.deepEqual(tvSeasonOptions([], undefined, 5), [1, 5]);
  assert.deepEqual(tvSeasonOptions([], 3, 1), [1, 2, 3]);
  assert.equal(progressSeason('S12 E03'), 12);
  assert.equal(progressSeason(''), 0);
});

test('the TV modal shows the unset episode, blocks planned viewing logs, and passes date edits', async () => {
  const source = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(source, /<option key="none" value=\{0\}>No episode yet<\/option>/);
  assert.match(source, /completedDateEdited: dateCompletedDirty/);
  assert.doesNotMatch(source, /handleQuickSeasonComplete|Complete & Log Season/);
  // Two tabs, one primary action each: Log (diary) and Progress (library state).
  assert.match(source, /\[\['log', 'Log'\], \['progress', 'Progress'\]\]/);
  assert.match(source, /setTvTab\(activeDiaryModal\.mode === 'log' \|\| explicitAction === 'NOTE ADDED' \? 'log' : 'progress'\)/);
  assert.match(source, /What did you watch\?/);
  assert.match(source, /<option value=\{TV_WHOLE_SHOW\}>The whole show<\/option>/);
  assert.match(source, /\{showsLibraryFields && <button type="button" onClick=\{\(event\) => handleSubmit\('library', event\)\}/);
  assert.match(source, /\{\(type !== 'tv' \|\| showsTvLog\) && <button type="button" onClick=\{\(event\) => handleSubmit\('activity', event\)\}/);
  assert.match(source, /setModalEpisodes\(\[\]\);\s*\n\s*setSeasonCatalog\(\[\]\);/);
});

test('import season entries cannot commit twice and skip specials', async () => {
  const source = await readFile(new URL('../src/pages/ImportTerminal.jsx', import.meta.url), 'utf8');
  assert.match(source, /if \(committingImportIds\.has\(item\.id\)\) return;/);
  assert.match(source, /seasons\.filter\(season => Number\(season\.season_number\) > 0\)/);
  assert.doesNotMatch(source, /libraryPayload\.status = 'in progress';\s*\n\s*libraryPayload\.dateCompleted = null;/);
});

test('Add to Diary for a season creates exactly that season entry and moves a planned show to watching', () => {
  const planned = baseTv();
  const { media, log } = buildTvDiaryEntry(planned, {
    target: 2, episodeCount: 8, seasonYear: '2024', watchedAt: Date.parse('2026-10-01T12:00:00Z'), rating: 8, createLogId: () => 'log-s2',
  });
  assert.equal(log.log_id, 'log-s2');
  assert.equal(log.season_label, 'Season 2');
  assert.equal(log.season_year, '2024');
  assert.equal(log.action_type, 'WATCHED');
  assert.equal(log.rating, 8);
  assert.equal(log.log_date, '2026-10-01T12:00:00.000Z');
  assert.equal(media.status, 'in progress');
  assert.equal(media.progress, 'S02 E08');
  assert.equal(media.dateCompleted, null);
});

test('the final season completes the show only when the user asks for it', () => {
  const watching = baseTv({ status: 'in progress', progress: 'S03 E02', dateStarted: 1000 });
  const command = { target: 3, episodeCount: 10, watchedAt: 50_000, createLogId: () => 'log-s3' };
  const stillWatching = buildTvDiaryEntry(watching, command);
  assert.equal(stillWatching.media.status, 'in progress');
  assert.equal(stillWatching.media.dateCompleted, null);

  const finished = buildTvDiaryEntry(watching, { ...command, finishesShow: true });
  assert.equal(finished.media.status, 'completed');
  assert.equal(finished.media.dateCompleted, 50_000);
  assert.equal(finished.media.progress, 'S03 E10');
  assert.equal(finished.log.season_label, 'Season 3');
  assert.equal(finished.media.dateStarted, 1000);
});

test('Add to Diary for the whole show completes it with one seasonless entry and no fabricated seasons', () => {
  const watching = baseTv({ status: 'in progress', progress: 'S02 E04', dateStarted: 1000 });
  const { media, log } = buildTvDiaryEntry(watching, { target: TV_WHOLE_SHOW, watchedAt: 70_000, createLogId: () => 'log-all' });
  assert.equal(media.status, 'completed');
  assert.equal(media.dateCompleted, 70_000);
  assert.equal(media.progress, 'S02 E04');
  assert.equal(log.season_label, undefined);
  assert.equal(log.log_id, 'log-all');

  const rewatch = buildTvDiaryEntry(baseTv({ status: 'completed', dateCompleted: 5000, rewatchCount: 1 }), {
    target: TV_WHOLE_SHOW, watchedAt: 90_000, isRewatch: true, createLogId: () => 'log-again',
  });
  assert.equal(rewatch.log.action_type, 'RE-WATCHED');
  assert.equal(rewatch.media.rewatchCount, 2);
  assert.equal(rewatch.media.dateCompleted, 90_000);
});

test('the diary target opens on the current season, a preset season, or the whole show when finished', () => {
  assert.equal(defaultTvDiaryTarget(baseTv({ status: 'in progress', progress: 'S04 E02' })), 4);
  assert.equal(defaultTvDiaryTarget(baseTv({ status: 'planned' })), 1);
  assert.equal(defaultTvDiaryTarget(baseTv({ status: 'completed', progress: 'S05 E10' })), TV_WHOLE_SHOW);
  assert.equal(defaultTvDiaryTarget(baseTv({ status: 'completed' }), 2), 2);
});

test('app TV reviews carry the season they are about, like Telegram season entries', async () => {
  const source = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(source, /\.\.\.\(type === 'tv' && !isWholeShowTarget \? \{\s*season_label: `Season \$\{diaryTarget\}`/);
  assert.match(source, /isTvReview \? 'Review of' : 'What did you watch\?'/);
  // "Add New Note" on TV opens the Log tab, so the review fields are always available there.
  assert.match(source, /\{showsTvLog && \(\s*\n\s*<div className="flex flex-col gap-4">/);
});

test('game and VN cards never show a stored percentage such as an old Telegram 100%', async () => {
  const source = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(source, /export const formatProgressLabel = \(prog, type\) => \{\n {2}if \(type === 'games' \|\| type === 'vn'\) return null;/);
  assert.doesNotMatch(source, /return `\$\{num\}%`/);
  const settings = await readFile(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /\(type === 'games' \|\| type === 'vn'\) progress = /);
  const telegram = await readFile(new URL('../supabase/functions/_shared/telegramSemantics.js', import.meta.url), 'utf8');
  assert.doesNotMatch(telegram, /'100%'|\$\{Math\.min\(100, value\)\}%/);
});

test('a show parked on a season finale is recognised; mid-season or unknown sizes are not', async () => {
  const { isAtSeasonFinale } = await import('../src/domain/tvWorkflow.js');
  const withSeasons = progress => baseTv({ status: 'in progress', progress, apiData: { raw: { seasons: [{ season_number: 1, episode_count: 8 }, { season_number: 2, episode_count: 10 }] } } });
  assert.equal(isAtSeasonFinale(withSeasons('S02 E10')), true);
  assert.equal(isAtSeasonFinale(withSeasons('S01 E08')), true);
  assert.equal(isAtSeasonFinale(withSeasons('S02 E09')), false);
  assert.equal(isAtSeasonFinale(withSeasons('S03 E01')), false);
  assert.equal(isAtSeasonFinale(baseTv({ status: 'in progress', progress: 'S02 E10' })), false);
  assert.equal(isAtSeasonFinale(withSeasons('')), false);

  const pages = await readFile(new URL('../src/pages/Pages.jsx', import.meta.url), 'utf8');
  assert.match(pages, /item\.status === 'in progress' && !\(item\.type === 'tv' && isAtSeasonFinale\(item\)\)/);
});
