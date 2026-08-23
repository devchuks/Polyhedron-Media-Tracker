import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStatusTransition,
  filterDashboardItems,
  findMediaForLog,
  mergeProviderMetadata,
  toggleIssueState,
  upsertDiaryLog,
} from '../src/domain/mediaState.js';

test('dashboard search composes with the active status filter', () => {
  const items = [
    { title: 'Dune', status: 'completed' },
    { title: 'Dune: Prophecy', status: 'in progress' },
    { title: 'Arrival', status: 'completed' },
  ];
  assert.deepEqual(filterDashboardItems(items, 'completed', 'dune').map(item => item.title), ['Dune']);
});

test('same-day diary creates with distinct log IDs remain distinct', () => {
  const original = {
    log_id: 'stable-log-1', media_id: '550', media_type: 'movies', media_key: 'tmdb:movies:550',
    log_date: '2026-08-16T09:00:00.000Z', season_label: null, review_text: 'first',
  };
  const update = {
    log_id: 'stable-log-2', media_id: '550', media_type: 'movies', media_key: 'tmdb:movies:550',
    log_date: '2026-08-16T18:00:00.000Z', season_label: null, review_text: 'second',
  };
  const merged = upsertDiaryLog([original], update);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].log_id, 'stable-log-2');
  assert.equal(merged[1].log_id, 'stable-log-1');
});

test('editing an existing diary entry by log_id modifies only that entry', () => {
  const original = {
    log_id: 'stable-log', media_id: '550', media_type: 'movies', media_key: 'tmdb:movies:550',
    log_date: '2026-08-16T09:00:00.000Z', season_label: null, review_text: 'old note',
  };
  const update = {
    log_id: 'stable-log', media_id: '550', media_type: 'movies', media_key: 'tmdb:movies:550',
    log_date: '2026-08-16T18:00:00.000Z', season_label: null, review_text: '',
  };
  const [merged] = upsertDiaryLog([original], update);
  assert.equal(merged.log_id, 'stable-log');
  assert.equal(merged.review_text, '');
});

test('distinct TV season-labelled records continue to coexist on the same day', () => {
  const s1 = { log_id: '1', media_key: 'tmdb:tv:1', log_date: '2026-08-16T09:00:00Z', season_label: 'Season 1' };
  const s2 = { log_id: '2', media_key: 'tmdb:tv:1', log_date: '2026-08-16T10:00:00Z', season_label: 'Season 2' };
  assert.equal(upsertDiaryLog([s1], s2).length, 2);
});

test('same raw ID in another media type produces a distinct diary entry', () => {
  const movie = { log_id: 'm', media_id: 550, media_type: 'movies', log_date: '2026-08-16T09:00:00Z' };
  const tv = { log_id: 't', media_id: 550, media_type: 'tv', log_date: '2026-08-16T10:00:00Z' };
  assert.equal(upsertDiaryLog([movie], tv).length, 2);
});

test('diary enrichment matches canonical identity instead of raw ID or prefix', () => {
  const media = {
    movies: [{ id: 12, media_key: 'tmdb:movies:12', title: 'Movie 12' }, { id: 123, media_key: 'tmdb:movies:123', title: 'Movie 123' }],
    tv: [{ id: 12, media_key: 'tmdb:tv:12', title: 'TV 12' }],
  };
  assert.equal(findMediaForLog(media, { media_id: 12, media_type: 'movies' }).title, 'Movie 12');
});

test('completion date follows status and season milestones do not complete a series', () => {
  const now = 1_700_000_000_000;
  const completed = applyStatusTransition({ status: 'in progress', dateCompleted: null }, 'completed', now);
  const reopened = applyStatusTransition(completed, 'in progress', now + 1);
  const seasonMilestone = applyStatusTransition({ status: 'in progress' }, 'in progress', now, { milestoneOnly: true });
  assert.equal(completed.dateCompleted, now);
  assert.equal(reopened.dateCompleted, null);
  assert.equal(seasonMilestone.dateCompleted, null);
});

test('provider metadata patches cannot overwrite newer user-controlled state', () => {
  const current = { id: 1, status: 'completed', rating: 9, progress: '100%', dateCompleted: 42, title: 'Old' };
  const stale = { status: 'planned', rating: 1, progress: '0%', dateCompleted: null, title: 'Hydrated', image: 'https://img.test/x.jpg' };
  const merged = mergeProviderMetadata(current, stale);
  assert.deepEqual(
    { status: merged.status, rating: merged.rating, progress: merged.progress, dateCompleted: merged.dateCompleted },
    { status: 'completed', rating: 9, progress: '100%', dateCompleted: 42 },
  );
  assert.equal(merged.title, 'Hydrated');
});

test('comic issue IDs normalize across string/number and partial lists never imply completion', () => {
  const item = { status: 'in progress', readIssueIds: [42], apiData: { raw: { issue_count: 100 } } };
  const toggledOff = toggleIssueState(item, '42', ['42']);
  assert.deepEqual(toggledOff.readIssueIds, []);

  const partial = toggleIssueState({ ...item, readIssueIds: [] }, '42', ['42']);
  assert.equal(partial.status, 'in progress');
  assert.equal(partial.dateCompleted ?? null, null);
});

test('bulk-marking a TV series completed preserves historical completion dates of prior seasons and does not fabricate new ones', () => {
  const initialState = [
    { log_id: '1', media_key: 'tmdb:tv:999', log_date: '2020-01-01T00:00:00Z', season_label: 'Season 1' },
    { log_id: '2', media_key: 'tmdb:tv:999', log_date: '2021-01-01T00:00:00Z', season_label: 'Season 2' }
  ];
  const newLog = { log_id: '3', media_key: 'tmdb:tv:999', log_date: '2022-01-01T00:00:00Z', season_label: 'Season 3' };
  
  const result = upsertDiaryLog(initialState, newLog);
  
  assert.equal(result.length, 3);
  assert.equal(result.find(l => l.log_id === '1').log_date, '2020-01-01T00:00:00Z');
  assert.equal(result.find(l => l.log_id === '2').log_date, '2021-01-01T00:00:00Z');
});
