import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTelegramLifecycle,
  classifyTelegramIntent,
  progressForTelegramIntent,
  providerForMediaType,
  selectDeterministicProviderMatch,
  telegramConfirmation,
  telegramMediaTypeLabel,
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
  assert.equal(telegramMediaTypeLabel('tv'), 'TV show');
  assert.equal(telegramMediaTypeLabel('comics'), 'Comic');
  assert.equal(telegramMediaTypeLabel('vn'), 'Visual novel');
});

test('Telegram confirmations stay compact and omit empty Diary metadata', () => {
  const lifecycle = buildTelegramLifecycle({ intent: 'UPDATE_PROGRESS', type: 'tv', activityAt: 600, progress: 'S02 E04' });
  const confirmation = telegramConfirmation({ title: 'Foundation', intent: 'UPDATE_PROGRESS', lifecycle, activityAt: 600 });
  assert.deepEqual(confirmation.lines, ['Updated · 1970-01-01', 'Progress · S02 E04']);
  assert.doesNotMatch(confirmation.lines.join('\n'), /Diary|none/iu);
});

test('Telegram confirmations show a real activity only when one was persisted', () => {
  const lifecycle = buildTelegramLifecycle({ intent: 'COMPLETE_ITEM', type: 'movies', activityAt: 100, rating: 8 });
  const confirmation = telegramConfirmation({ title: 'The Matrix', intent: 'COMPLETE_ITEM', lifecycle, activityAt: 100 });
  assert.deepEqual(confirmation.lines, ['Watched · 1970-01-01']);
});
