import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTelegramAmbiguitySelection,
  buildTelegramLifecycle,
  classifyTelegramIntent,
  formatTelegramDate,
  progressForTelegramIntent,
  providerForMediaType,
  resolveTelegramAmbiguityReply,
  selectDeterministicProviderMatch,
  telegramConfirmation,
  telegramMediaTypeLabel,
  telegramStatusLabel,
} from '../supabase/functions/_shared/telegramSemantics.js';

test('Telegram intent classification distinguishes start, progress, completion, season, rewatch, and rating-only', () => {
  assert.equal(classifyTelegramIntent({ intent: 'START' }), 'START');
  assert.equal(classifyTelegramIntent({ action: 'in progress', progressNumber: 4 }), 'UPDATE_PROGRESS');
  assert.equal(classifyTelegramIntent({ action: 'completed', season: 2 }), 'COMPLETE_SEASON');
  assert.equal(classifyTelegramIntent({ isRewatch: true }), 'REWATCH_ITEM');
  assert.equal(classifyTelegramIntent({ rawRating: 8 }), 'RATE');
});

test('rating-only Telegram input preserves lifecycle and creates no diary activity', () => {
  const lifecycle = buildTelegramLifecycle({
    existing: { status: 'planned', addedAt: 1, dateStarted: null, dateCompleted: null, rating: 0 },
    intent: 'RATE', type: 'movies', activityAt: 50, rating: 8,
  });
  assert.equal(lifecycle.status, 'planned');
  assert.equal(lifecycle.dateStarted, null);
  assert.equal(lifecycle.shouldLog, false);
  assert.equal(lifecycle.rating, 8);
});

test('direct completed movie coherently sets Started, Completed, and one WATCHED activity', () => {
  const lifecycle = buildTelegramLifecycle({ intent: 'COMPLETE_ITEM', type: 'movies', activityAt: 100 });
  assert.equal(lifecycle.status, 'completed');
  assert.equal(lifecycle.dateStarted, 100);
  assert.equal(lifecycle.dateCompleted, 100);
  assert.equal(lifecycle.actionType, 'WATCHED');
  assert.equal(lifecycle.shouldLog, true);
});

test('progress-only TV initializes Started without diary or whole-series completion', () => {
  const progress = progressForTelegramIntent({ type: 'tv', intent: 'UPDATE_PROGRESS', season: 2, progressNumber: 4 });
  const lifecycle = buildTelegramLifecycle({ intent: 'UPDATE_PROGRESS', type: 'tv', activityAt: 200, progress });
  assert.equal(lifecycle.progress, 'S02 E04');
  assert.equal(lifecycle.dateStarted, 200);
  assert.equal(lifecycle.dateCompleted, null);
  assert.equal(lifecycle.shouldLog, false);
});

test('Telegram game and visual-novel updates do not create percentage progress', () => {
  assert.equal(progressForTelegramIntent({ type: 'games', intent: 'UPDATE_PROGRESS', progressNumber: 45 }), null);
  assert.equal(progressForTelegramIntent({ type: 'vn', intent: 'COMPLETE_ITEM', progressNumber: 100 }), null);
});

test('season completion creates exactly one selected-season activity and keeps release year metadata separate', () => {
  const progress = progressForTelegramIntent({ type: 'tv', intent: 'COMPLETE_SEASON', season: 2, episodeCount: 10 });
  const lifecycle = buildTelegramLifecycle({ intent: 'COMPLETE_SEASON', type: 'tv', activityAt: 300, progress, season: 2, seasonYear: 2024 });
  assert.equal(lifecycle.status, 'in progress');
  assert.equal(lifecycle.seasonLabel, 'Season 2');
  assert.equal(lifecycle.seasonYear, '2024');
  assert.equal(lifecycle.dateStarted, 300);
  assert.equal(lifecycle.dateCompleted, null);
});

test('whole-series completion creates no fabricated season identity', () => {
  const lifecycle = buildTelegramLifecycle({ intent: 'COMPLETE_ITEM', type: 'tv', activityAt: 400, season: null });
  assert.equal(lifecycle.status, 'completed');
  assert.equal(lifecycle.seasonLabel, null);
});

test('rewatch preserves Started, adds a distinct activity, and increments only full-item rewatch', () => {
  const existing = { status: 'completed', addedAt: 1, dateStarted: 2, dateCompleted: 3, rewatchCount: 1 };
  const item = buildTelegramLifecycle({ existing, intent: 'REWATCH_ITEM', type: 'movies', activityAt: 500 });
  const season = buildTelegramLifecycle({ existing, intent: 'REWATCH_SEASON', type: 'tv', activityAt: 500, season: 2 });
  assert.equal(item.dateStarted, 2);
  assert.equal(item.rewatchIncrement, 1);
  assert.equal(item.actionType, 'RE-WATCHED');
  assert.equal(season.rewatchIncrement, 0);
});

test('provider identity remains type-scoped and ambiguous remakes refuse unsafe selection', () => {
  assert.equal(providerForMediaType('movies'), 'tmdb');
  assert.equal(providerForMediaType('anime'), 'anilist');
  const ambiguous = selectDeterministicProviderMatch([
    { id: 1, title: 'The Odyssey', year: 1997 },
    { id: 2, title: 'The Odyssey', year: 2026 },
  ], 'The Odyssey', null);
  assert.equal(ambiguous.match, null);
  assert.equal(ambiguous.ambiguous, true);
  assert.equal(selectDeterministicProviderMatch(ambiguous.options, 'The Odyssey', 2026).match.id, 2);
  assert.equal(selectDeterministicProviderMatch(ambiguous.options, 'ignored', null, 1).match.id, 1);
});

test('Telegram resolves a dominant exact title without demanding a year', () => {
  const dominant = selectDeterministicProviderMatch([
    { id: 10, title: 'Dune', year: 2021, popularity: 160 },
    { id: 11, title: 'Dune', year: 1984, popularity: 35 },
  ], 'Dune', null);
  assert.equal(dominant.match.id, 10);
  assert.equal(dominant.ambiguous, false);

  const close = selectDeterministicProviderMatch([
    { id: 30, title: 'The Thing', year: 1982, popularity: 50 },
    { id: 31, title: 'The Thing', year: 2011, popularity: 45 },
  ], 'The Thing', null);
  assert.equal(close.match, null);
  assert.equal(close.ambiguous, true);
});

test('Telegram does not let Library preference override a genuinely ambiguous title', () => {
  const ambiguous = selectDeterministicProviderMatch([
    { id: 20, title: 'Suspiria', year: 1977, popularity: 40, preferred: true },
    { id: 21, title: 'Suspiria', year: 2018, popularity: 42 },
  ], 'Suspiria', null);
  assert.equal(ambiguous.match, null);
  assert.equal(ambiguous.ambiguous, true);
});

test('Telegram ambiguity labels use clear media categories', () => {
  assert.equal(telegramMediaTypeLabel('movies'), 'Movie');
  assert.equal(telegramMediaTypeLabel('tv'), 'TV Show');
  assert.equal(telegramMediaTypeLabel('comics'), 'Comic');
  assert.equal(telegramMediaTypeLabel('vn'), 'Visual novel');
});

test('ambiguity replies select identity while preserving the entire original activity command', () => {
  const options = [
    { id: 603, title: 'The Matrix', year: 1999, mediaType: 'movies' },
    { id: 604, title: 'The Matrix', year: 2026, mediaType: 'movies' },
  ];
  assert.equal(resolveTelegramAmbiguityReply(options, '1999').id, 603);
  assert.equal(resolveTelegramAmbiguityReply(options, '2').id, 604);
  assert.equal(resolveTelegramAmbiguityReply(options, 'ID: 604').id, 604);

  const original = {
    intent: 'COMPLETE_ITEM', action: 'completed', cleanTitle: 'The Matrix', type: 'movies',
    rawRating: 9, rawRatingScale: 10, reviewText: 'Still excellent.', confidence: 0.92,
  };
  const resolved = applyTelegramAmbiguitySelection({
    item: original,
    selection: options[0],
    activityTimestamp: 1787666400,
    pendingEventId: 'pending-resolution:123',
  });
  assert.deepEqual({
    intent: resolved.intent,
    action: resolved.action,
    rating: resolved.rawRating,
    review: resolved.reviewText,
    providerId: resolved.providerId,
    year: resolved.year,
    timestamp: resolved._activityTimestamp,
  }, {
    intent: 'COMPLETE_ITEM', action: 'completed', rating: 9, review: 'Still excellent.',
    providerId: '603', year: 1999, timestamp: 1787666400,
  });
});

const replyFor = ({ title, year, type, intent, existing = null, ...rest }) => {
  const activityAt = Date.parse('2026-11-03T20:00:00.000Z');
  const lifecycle = buildTelegramLifecycle({ existing, intent, type, activityAt, ...rest });
  return telegramConfirmation({ title, year, type, intent, lifecycle, activityAt });
};
const addedOct12 = (status, extra = {}) => ({
  status, addedAt: Date.parse('2026-10-12T18:00:00.000Z'), dateStarted: status === 'planned' ? null : 1, dateCompleted: null, rating: 0, ...extra,
});

test('Telegram replies show the diary date for logged entries and the added date otherwise', () => {
  const movie = replyFor({ title: 'The Matrix', year: 1999, type: 'movies', intent: 'COMPLETE_ITEM', rating: 9 });
  assert.equal(movie.headline, '✅ Watched The Matrix (1999)');
  assert.deepEqual(movie.lines, ['🎬 Movie · in your diary for Nov 3, 2026', '⭐ Your rating: 9/10', '📍 Watched']);

  const planned = replyFor({ title: 'Hollow Knight: Silksong', year: 2025, type: 'games', intent: 'ADD_PLANNED' });
  assert.equal(planned.headline, '📌 Added Hollow Knight: Silksong (2025) to your backlog');
  assert.deepEqual(planned.lines, ['🎮 Game · added Nov 3, 2026', '📍 Planned']);

  const progress = replyFor({ title: 'Severance', year: 2022, type: 'tv', intent: 'UPDATE_PROGRESS', existing: addedOct12('in progress'), progress: 'S02 E04' });
  assert.equal(progress.headline, '⏩ Updated progress on Severance (2022)');
  assert.deepEqual(progress.lines, ['📺 TV Show · added Oct 12, 2026', '📍 Watching · on S02 E04']);

  const all = [movie, planned, progress].flatMap(reply => [reply.headline, ...reply.lines]).join('\n');
  assert.doesNotMatch(all, /new in your library|Activity|Diary:|Now:|Currently:|up to/u);
  assert.equal(formatTelegramDate(Date.parse('2026-08-25T12:00:00.000Z')), 'August 25th, 2026');
  assert.equal(telegramStatusLabel('books', 'completed'), 'Read');
  assert.equal(telegramStatusLabel('games', 'in progress'), 'Playing');
});

test('a repeat shows when it was first added and when this viewing went into the diary', () => {
  const rewatch = replyFor({ title: 'Heat', year: 1995, type: 'movies', intent: 'REWATCH_ITEM', existing: addedOct12('completed', { rating: 10 }), rating: 10 });
  assert.equal(rewatch.headline, '🔁 Rewatched Heat (1995)');
  assert.deepEqual(rewatch.lines, ['🎬 Movie · added Oct 12, 2026 · in your diary for Nov 3, 2026', '⭐ Your rating: 10/10', '📍 Watched']);
  const reread = replyFor({ title: 'Saga', year: 2012, type: 'comics', intent: 'REWATCH_ITEM', existing: addedOct12('completed') });
  assert.equal(reread.headline, '🔁 Reread Saga (2012)');
  assert.equal(reread.lines[0], '💥 Comic · added Oct 12, 2026 · in your diary for Nov 3, 2026');
});

test('each media type has its own icon and progress reads as a position', () => {
  const season = replyFor({ title: 'Severance', year: 2022, type: 'tv', intent: 'COMPLETE_SEASON', existing: addedOct12('in progress'), season: 2, seasonYear: 2025, progress: 'S02 E10', rating: 9 });
  assert.equal(season.headline, '✅ Logged Season 2 of Severance (2022)');
  assert.deepEqual(season.lines, ['📺 TV Show · in your diary for Nov 3, 2026', '⭐ Your rating: 9/10', '📍 Watching · on S02 E10']);

  assert.deepEqual(replyFor({ title: 'Frieren', type: 'anime', intent: 'UPDATE_PROGRESS', existing: addedOct12('in progress'), progress: '12 Episodes' }).lines,
    ['🍥 Anime · added Oct 12, 2026', '📍 Watching · on Episode 12']);
  assert.deepEqual(replyFor({ title: 'Chainsaw Man', type: 'manga', intent: 'UPDATE_PROGRESS', existing: addedOct12('in progress'), progress: '140 Chapters' }).lines,
    ['📚 Manga · added Oct 12, 2026', '📍 Reading · on Chapter 140']);
  assert.equal(replyFor({ title: 'Steins;Gate', type: 'vn', intent: 'START' }).lines[0], '💬 Visual novel · added Nov 3, 2026');
  assert.equal(replyFor({ title: 'Dune', type: 'books', intent: 'COMPLETE_ITEM' }).lines[0], '📖 Book · in your diary for Nov 3, 2026');

  // A finished item shows only its status, never a stale position.
  const finished = replyFor({ title: 'Barry', year: 2018, type: 'tv', intent: 'COMPLETE_ITEM', existing: addedOct12('in progress', { progress: 'S04 E08' }) });
  assert.equal(finished.lines.at(-1), '📍 Watched');
  // Games and visual novels never show a position, even when one is stored.
  const game = replyFor({ title: 'Hades II', type: 'games', intent: 'UPDATE_PROGRESS', existing: addedOct12('in progress', { progress: '100%' }) });
  assert.equal(game.lines.at(-1), '📍 Playing');
});

test('Telegram percentage progress never becomes an episode or chapter count', () => {
  assert.equal(progressForTelegramIntent({ type: 'tv', intent: 'UPDATE_PROGRESS', season: 2, progressNumber: 50, progressUnit: 'percentage' }), null);
  assert.equal(progressForTelegramIntent({ type: 'anime', intent: 'UPDATE_PROGRESS', progressNumber: 40, progressUnit: 'percentage' }), null);
  assert.equal(progressForTelegramIntent({ type: 'tv', intent: 'UPDATE_PROGRESS', season: 2, progressNumber: 5, progressUnit: 'episode' }), 'S02 E05');
});

test('a year-resolved Telegram season can be reassigned without a const TypeError', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../supabase/functions/telegram-logger/index.ts', import.meta.url), 'utf8');
  assert.match(source, /let season = item\.season/);
  assert.match(source, /progressUnit: item\.progressUnit/);
});
