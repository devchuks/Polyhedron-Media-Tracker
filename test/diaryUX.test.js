import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  diarySeasonLabel,
  filterDiaryLogs,
  formatDiaryRating,
  groupDiaryLogsByDate,
} from '../src/domain/diary.js';
import { persistStateOrActivity, statusForStateActivityIntent } from '../src/domain/stateActivityModal.js';

const log = (overrides = {}) => ({
  log_id: 'log-1',
  media_id: '1',
  media_type: 'movies',
  action_type: 'WATCHED',
  log_date: '2026-08-29T12:00:00.000Z',
  mediaItem: { id: '1', title: 'Alpha', rating: 9 },
  ...overrides,
});

test('TV season history renders only the canonical stored season metadata', () => {
  assert.equal(diarySeasonLabel(log({ media_type: 'tv', season_label: 'Season 3', mediaItem: { title: 'Show', progress: 'S09 E02' } })), 'Season 3');
  assert.equal(diarySeasonLabel(log({ media_type: 'tv', season_label: 'Season 04' })), 'Season 04');
  assert.equal(diarySeasonLabel(log({ media_type: 'tv', season_label: null, mediaItem: { title: 'Show', progress: 'S03 E04' } })), null);
  assert.equal(diarySeasonLabel(log({ media_type: 'movies', season_label: 'Season 8' })), null);
});

test('non-TV Log Activity atomically creates one entry and completes Library state', async () => {
  const status = statusForStateActivityIntent({ intent: 'activity', type: 'books', selectedStatus: 'in progress' });
  const media = { id: 'book-1', status, rating: 8 };
  const activity = log({ log_id: 'book-log', media_id: 'book-1', media_type: 'books', action_type: 'READ' });
  let activityWrites = 0;
  const result = await persistStateOrActivity({
    intent: 'activity',
    media,
    type: 'books',
    log: activity,
    saveLibrary: async () => assert.fail('activity must use the atomic command'),
    saveWithLog: async (savedMedia, savedType, savedLog) => {
      activityWrites += 1;
      assert.equal(savedMedia.status, 'completed');
      assert.equal(savedType, 'books');
      return { media: savedMedia, log: savedLog };
    },
  });
  assert.equal(activityWrites, 1);
  assert.equal(result.log.log_id, 'book-log');
});

test('TV Log Activity creates one entry without automatically completing the whole show', async () => {
  const status = statusForStateActivityIntent({ intent: 'activity', type: 'tv', selectedStatus: 'in progress', currentStatus: 'in progress' });
  const media = { id: 'tv-1', status, progress: 'S03 E04' };
  const activity = log({ log_id: 'tv-log', media_id: 'tv-1', media_type: 'tv', season_label: 'Season 3' });
  let activityWrites = 0;
  await persistStateOrActivity({
    intent: 'activity',
    media,
    type: 'tv',
    log: activity,
    saveLibrary: async () => assert.fail('activity must use the atomic command'),
    saveWithLog: async savedMedia => {
      activityWrites += 1;
      assert.equal(savedMedia.status, 'in progress');
      assert.notEqual(savedMedia.status, 'completed');
    },
  });
  assert.equal(activityWrites, 1);
});

test('Save Changes remains Library-only and preserves the selected state', async () => {
  const status = statusForStateActivityIntent({ intent: 'library', type: 'anime', selectedStatus: 'in progress' });
  let libraryWrites = 0;
  let activityWrites = 0;
  await persistStateOrActivity({
    intent: 'library',
    media: { id: 'anime-1', status },
    type: 'anime',
    log: null,
    saveLibrary: async savedMedia => { libraryWrites += 1; assert.equal(savedMedia.status, 'in progress'); },
    saveWithLog: async () => { activityWrites += 1; },
  });
  assert.deepEqual({ libraryWrites, activityWrites }, { libraryWrites: 1, activityWrites: 0 });
});

test('Diary media, activity, and title filters compose correctly', () => {
  const logs = [
    log({ log_id: 'movie', media_type: 'movies', action_type: 'WATCHED', mediaItem: { title: 'Arrival' } }),
    log({ log_id: 'book', media_type: 'books', action_type: 'READ', mediaItem: { title: 'Arrival Stories' } }),
    log({ log_id: 'game', media_type: 'games', action_type: 'PLAYED', mediaItem: { title: 'Control' } }),
  ];
  assert.deepEqual(filterDiaryLogs(logs, { mediaType: 'books', activity: 'READ', query: 'arrival' }).map(item => item.log_id), ['book']);
  assert.deepEqual(filterDiaryLogs(logs, { activity: 'PLAYED' }).map(item => item.log_id), ['game']);
});

test('Diary date grouping is newest-first with deterministic same-day order', () => {
  const groups = groupDiaryLogsByDate([
    log({ log_id: 'older', log_date: '2026-08-28T12:00:00.000Z' }),
    log({ log_id: 'same-day-a', log_date: '2026-08-29T12:00:00.000Z' }),
    log({ log_id: 'same-day-b', log_date: '2026-08-29T12:00:00.000Z' }),
  ]);
  assert.deepEqual(groups.map(group => group.key), ['2026-08-29', '2026-08-28']);
  assert.deepEqual(groups[0].entries.map(item => item.log_id), ['same-day-b', 'same-day-a']);
});

test('Diary ratings use the compact five-star vocabulary', () => {
  assert.equal(formatDiaryRating(8), '★★★★');
  assert.equal(formatDiaryRating(9), '★★★★½');
  assert.equal(formatDiaryRating(0), '');
});

test('Diary UI wires canonical season display, filters, history-only editing, and responsive rows', async () => {
  const diarySource = await readFile(new URL('../src/pages/Diary.jsx', import.meta.url), 'utf8');
  const modalSource = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(diarySource, /diarySeasonLabel\(log\)/);
  assert.match(diarySource, /Search Diary titles/);
  assert.match(diarySource, /Filter by media type/);
  assert.match(diarySource, /Filter by activity/);
  assert.match(diarySource, /Editing Diary history · Library state stays unchanged/);
  assert.match(diarySource, /grid-cols-\[52px_minmax\(0,1fr\)\][\s\S]*sm:grid-cols-\[76px_minmax\(0,1fr\)\]/);
  assert.match(diarySource, /data-testid="diary-surface"/);
  assert.match(diarySource, /data-testid="diary-month-header"/);
  assert.doesNotMatch(diarySource, /Viewing history/);
  assert.doesNotMatch(diarySource, /A chronological record/);
  assert.doesNotMatch(diarySource, /\{actionLabel\}/);
  assert.doesNotMatch(diarySource, /monthEntryCount/);
  assert.doesNotMatch(diarySource, /sticky top-\[/);
  assert.match(diarySource, /aria-label="Search Diary titles"/);
  assert.match(diarySource, /aria-label="Filter Diary"/);
  assert.match(diarySource, /aria-label="Jump to Diary month"/);
  assert.match(diarySource, /formatDiaryRating\(rating\)/);
  assert.match(diarySource, /log\.mediaItem\.apiData\?\.year \|\| log\.mediaItem\.year/);
  assert.match(modalSource, /statusForStateActivityIntent\(/);
  assert.match(modalSource, /status: effectiveStatus/);
  assert.match(modalSource, /completesItem: effectiveStatus === 'completed'/);
});
