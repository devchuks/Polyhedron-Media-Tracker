import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTelegramLifecycle,
  classifyTelegramIntent,
  progressForTelegramIntent,
  providerForMediaType,
  selectDeterministicProviderMatch,
  telegramConfirmation,
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

test('Telegram confirmations describe actual persistence and never claim a diary row for progress', () => {
  const lifecycle = buildTelegramLifecycle({ intent: 'UPDATE_PROGRESS', type: 'tv', activityAt: 600, progress: 'S02 E04' });
  const confirmation = telegramConfirmation({ title: 'Foundation', intent: 'UPDATE_PROGRESS', lifecycle, activityAt: 600 });
  assert.ok(confirmation.lines.includes('Diary: none'));
});
