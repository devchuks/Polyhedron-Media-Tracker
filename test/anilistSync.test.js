import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  anilistDate,
  anilistMediaKey,
  anilistProgress,
  anilistRating,
  anilistSnapshot,
  anilistStatus,
  planAniListEntry,
} from '../src/domain/anilistSync.js';
import { existingFinishNear, finishEntryForReview, reviewEntryForFinish } from '../supabase/functions/_shared/diaryMerge.js';
import { normalizeAniList } from '../src/utils/normalizers.js';

const DAY = 24 * 60 * 60 * 1000;
const media = { id: 86719, title: { romaji: 'Shounen Shoujo' }, chapters: 16, format: 'MANGA', coverImage: { large: 'https://img.anili.st/cover.jpg' } };
const entry = (overrides = {}) => ({
  id: 140773467, mediaId: 86719, status: 'CURRENT', score: 0, progress: 4, repeat: 0,
  startedAt: { year: 2026, month: 10, day: 1 }, completedAt: { year: null, month: null, day: null },
  updatedAt: 1_790_000_000, createdAt: 1_780_000_000, media, ...overrides,
});
const key = anilistMediaKey('manga', 86719);
const libraryItem = (overrides = {}) => ({
  id: '86719', type: 'manga', provider: 'anilist', provider_id: '86719', media_key: key, title: 'Shounen Shoujo',
  status: 'in progress', progress: '4 Chapters', rating: 0, rewatchCount: 0, addedAt: 1, dateStarted: anilistDate({ year: 2026, month: 10, day: 1 }), dateCompleted: null,
  ...overrides,
});
const plan = options => planAniListEntry({ type: 'manga', normalize: normalizeAniList, now: Date.parse('2026-11-03T12:00:00Z'), ...options });

test('AniList values map onto the site\'s statuses, ratings, progress and calendar dates', () => {
  assert.equal(anilistStatus('CURRENT'), 'in progress');
  assert.equal(anilistStatus('PAUSED'), 'in progress');
  assert.equal(anilistStatus('PLANNING'), 'planned');
  assert.equal(anilistStatus('COMPLETED'), 'completed');
  assert.equal(anilistStatus('REPEATING'), 'in progress');
  assert.equal(anilistRating(6.5), 7);
  assert.equal(anilistRating(0), 0);
  assert.equal(anilistProgress('anime', 12), '12 Episodes');
  assert.equal(anilistProgress('manga', 140), '140 Chapters');
  assert.equal(anilistDate({ year: 2026, month: 10, day: null }), null);
  assert.equal(new Date(anilistDate({ year: 2026, month: 10, day: 23 })).getDate(), 23);
  assert.equal(key, 'anilist:manga:86719');
});

test('only fields that changed on AniList are applied; unchanged entries write nothing', () => {
  const previous = anilistSnapshot(entry());
  assert.equal(plan({ entry: entry(), localItem: libraryItem(), previous }).media, null);

  // Progress moved on AniList; a newer Polyhedron rating is left alone because AniList's score did not change.
  const moved = plan({ entry: entry({ progress: 8, updatedAt: 1_790_000_100 }), localItem: libraryItem({ rating: 9 }), previous });
  assert.equal(moved.media.progress, '8 Chapters');
  assert.equal(moved.media.rating, 9);
  assert.equal(moved.log, null);
});

test('finishing on AniList completes the title and adds one diary entry dated on the finish day', () => {
  const previous = anilistSnapshot(entry());
  const finished = entry({ status: 'COMPLETED', progress: 16, score: 8.5, completedAt: { year: 2026, month: 11, day: 2 }, updatedAt: 1_790_000_500 });
  const result = plan({ entry: finished, localItem: libraryItem(), previous, logs: [] });
  assert.equal(result.media.status, 'completed');
  assert.equal(result.media.dateCompleted, anilistDate({ year: 2026, month: 11, day: 2 }));
  assert.equal(result.media.rating, 9);
  assert.equal(result.log.log_id, 'anilist-140773467-0');
  assert.equal(result.log.action_type, 'READ');
  assert.equal(Date.parse(result.log.log_date), anilistDate({ year: 2026, month: 11, day: 2 }));

  // Seeing the same finish again (another open of the site) changes nothing.
  const again = plan({ entry: finished, localItem: result.media, previous: result.snapshot, logs: [{ ...result.log, media_key: key }] });
  assert.equal(again.media, null);
  assert.equal(again.log, null);
  assert.equal(again.logUpdate, null);
});

test('a review written before the AniList finish is upgraded into the finish entry instead of duplicated', () => {
  const finishAt = anilistDate({ year: 2026, month: 11, day: 2 });
  const review = { log_id: 'telegram:9:0', media_key: key, action_type: 'LOGGED', log_date: new Date(finishAt + 2 * DAY).toISOString(), review_text: 'That ending was insane' };
  const result = plan({
    entry: entry({ status: 'COMPLETED', score: 9, completedAt: { year: 2026, month: 11, day: 2 }, updatedAt: 1_790_000_900 }),
    localItem: libraryItem(), previous: anilistSnapshot(entry()), logs: [review],
  });
  assert.equal(result.log, null);
  assert.deepEqual(result.logUpdate, { log_id: 'telegram:9:0', patch: { action_type: 'READ', log_date: new Date(finishAt).toISOString(), rating: 9 } });
});

test('reviews merge only within 7 days, for the same title and season, never over an existing review', () => {
  const finishAt = Date.parse('2026-11-02T12:00:00Z');
  const finish = { log_id: 'f', media_key: key, action_type: 'READ', log_date: new Date(finishAt).toISOString(), review_text: '' };
  assert.equal(finishEntryForReview([finish], { mediaKey: key, reviewAt: finishAt + 6 * DAY })?.log_id, 'f');
  assert.equal(finishEntryForReview([finish], { mediaKey: key, reviewAt: finishAt + 8 * DAY }), null);
  assert.equal(finishEntryForReview([finish], { mediaKey: 'anilist:manga:1', reviewAt: finishAt }), null);
  assert.equal(finishEntryForReview([{ ...finish, review_text: 'already reviewed' }], { mediaKey: key, reviewAt: finishAt, reviewText: 'new' }), null);
  // A repeated delivery of the same review still resolves to the same entry (safe to retry).
  assert.equal(finishEntryForReview([{ ...finish, review_text: 'same' }], { mediaKey: key, reviewAt: finishAt, reviewText: 'same' })?.log_id, 'f');
  assert.equal(finishEntryForReview([{ ...finish, season_label: 'Season 2' }], { mediaKey: key, reviewAt: finishAt, seasonLabel: 'Season 1' }), null);

  const review = { log_id: 'r', media_key: key, action_type: 'LOGGED', log_date: new Date(finishAt - 3 * DAY).toISOString(), review_text: 'Great' };
  assert.equal(reviewEntryForFinish([review], { mediaKey: key, finishAt })?.log_id, 'r');
  assert.equal(reviewEntryForFinish([{ ...review, review_text: '' }], { mediaKey: key, finishAt }), null);
  assert.equal(existingFinishNear([finish], { mediaKey: key, finishAt: finishAt + 12 * 60 * 60 * 1000 })?.log_id, 'f');
  assert.equal(existingFinishNear([finish], { mediaKey: key, finishAt: finishAt + 3 * DAY }), null);
});

test('a finish already logged on Polyhedron is not logged a second time by AniList', () => {
  const finishAt = anilistDate({ year: 2026, month: 11, day: 2 });
  const manual = { log_id: 'manual', media_key: key, action_type: 'READ', log_date: new Date(finishAt - 6 * 60 * 60 * 1000).toISOString(), review_text: '' };
  const result = plan({
    entry: entry({ status: 'COMPLETED', completedAt: { year: 2026, month: 11, day: 2 }, updatedAt: 1_790_001_000 }),
    localItem: libraryItem(), previous: anilistSnapshot(entry()), logs: [manual],
  });
  assert.equal(result.log, null);
  assert.equal(result.logUpdate, null);
  assert.equal(result.media.status, 'completed');
});

test('a rewatch on AniList adds a separate Reread entry with its own stable id', () => {
  const firstFinish = entry({ status: 'COMPLETED', completedAt: { year: 2025, month: 1, day: 5 }, updatedAt: 1 });
  const rewatched = entry({ status: 'COMPLETED', repeat: 1, completedAt: { year: 2026, month: 11, day: 1 }, updatedAt: 2 });
  const result = plan({
    entry: rewatched, localItem: libraryItem({ status: 'completed', dateCompleted: anilistDate({ year: 2025, month: 1, day: 5 }) }),
    previous: anilistSnapshot(firstFinish), logs: [{ log_id: 'anilist-140773467-0', media_key: key, action_type: 'READ', log_date: new Date(anilistDate({ year: 2025, month: 1, day: 5 })).toISOString() }],
  });
  assert.equal(result.log.log_id, 'anilist-140773467-1');
  assert.equal(result.log.action_type, 'RE-READ');
  assert.equal(result.media.rewatchCount, 1);
});

test('a new AniList title becomes a library item; the first import adds history only when asked', () => {
  const finished = entry({ status: 'COMPLETED', score: 6.5, progress: 16, completedAt: { year: 2020, month: 10, day: 2 } });
  const withoutHistory = plan({ entry: finished, localItem: undefined, previous: undefined, createHistory: false });
  assert.equal(withoutHistory.media.media_key, key);
  assert.equal(withoutHistory.media.status, 'completed');
  assert.equal(withoutHistory.media.rating, 7);
  assert.equal(withoutHistory.media.addedAt, 1_780_000_000 * 1000);
  assert.equal(withoutHistory.log, null);
  assert.equal(plan({ entry: finished, localItem: undefined, previous: undefined, createHistory: true }).log.action_type, 'READ');
});

test('reviews from the app and Telegram are merged into a recent finish instead of a separate entry', async () => {
  const ui = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(ui, /finishEntryForReview\(useMediaStore\.getState\(\)\.mediaLogs/);
  assert.match(ui, /updateDiaryLog\(mergeTarget\.log_id, \{ review_text: log\.review_text \}\)/);
  const telegram = await readFile(new URL('../supabase/functions/telegram-logger/index.ts', import.meta.url), 'utf8');
  assert.match(telegram, /if \(shouldLogToDiary && !reviewMergeTarget\)/);
  assert.match(telegram, /\.eq\('user_id', userId\)\s*\n\s*\.eq\('log_id', reviewMergeTarget\.log_id\)/);
  const layout = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
  assert.match(layout, /if \(authMode !== 'admin' \|\| !ownerId \|\| isCloudSyncing\) return;\s*\n\s*void syncAniListOnOpen\(ownerId\)\.then\(\(\) => syncLetterboxdOnOpen\(ownerId\)\)\.then\(\(\) => syncVndbOnOpen\(ownerId\)\)/);
});

test('a tracked AniList title that is not yet in the library arrives with its real status, not Planned', () => {
  // "Only track from now on" recorded this reading entry while it was missing from Polyhedron.
  const tracked = entry({ progress: 2, score: 7.5 });
  const moved = entry({ progress: 5, score: 7.5, updatedAt: 1_790_000_200 });
  const result = plan({ entry: moved, localItem: undefined, previous: anilistSnapshot(tracked), logs: [] });
  assert.equal(result.media.status, 'in progress');
  assert.equal(result.media.progress, '5 Chapters');
  assert.equal(result.media.rating, 8);
  assert.equal(result.media.dateStarted, anilistDate({ year: 2026, month: 10, day: 1 }));
  // Its finish was already known when tracking began, so it is not logged again as new.
  const finishedBefore = entry({ status: 'COMPLETED', completedAt: { year: 2026, month: 9, day: 1 } });
  const later = plan({ entry: { ...finishedBefore, score: 9, updatedAt: 1_790_000_300 }, localItem: undefined, previous: anilistSnapshot(finishedBefore), logs: [] });
  assert.equal(later.media.status, 'completed');
  assert.equal(later.media.dateCompleted, anilistDate({ year: 2026, month: 9, day: 1 }));
  assert.equal(later.log, null);
});
