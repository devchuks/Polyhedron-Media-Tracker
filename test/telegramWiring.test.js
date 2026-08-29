import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildTelegramLifecycle } from '../supabase/functions/_shared/telegramSemantics.js';

const telegramSource = await readFile(new URL('../supabase/functions/telegram-logger/index.ts', import.meta.url), 'utf8');
const migrationSource = await readFile(new URL('../supabase/migrations/202608160001_canonical_identity_rls.sql', import.meta.url), 'utf8');

test('Telegram retries are rejected before provider resolution and persistence remains one atomic RPC', () => {
  const existingBatchGuard = telegramSource.indexOf(".from('webhook_batches')");
  const parserCall = telegramSource.indexOf('Invoking Gemini Structured Output Parser');
  const duplicateGuard = telegramSource.indexOf('completedEventIds.has(eventId)');
  const providerResolution = telegramSource.indexOf('Phase 3 - Autonomous API Resolution');
  const atomicCall = telegramSource.indexOf("rpc('apply_telegram_media_event'");
  const lifecycleBoundary = telegramSource.indexOf('buildTelegramLifecycle({', providerResolution);
  const successReply = telegramSource.indexOf('const confirmation = telegramConfirmation', atomicCall);
  assert.ok(existingBatchGuard > 0 && existingBatchGuard < parserCall);
  assert.match(telegramSource, /let items = Array\.isArray\(existingBatch\?\.plan\)[\s\S]*if \(isNewBatch && !items\) \{[\s\S]*Invoking Gemini Structured Output Parser/iu);
  assert.ok(duplicateGuard > 0 && duplicateGuard < providerResolution);
  assert.ok(lifecycleBoundary > providerResolution && atomicCall > lifecycleBoundary && successReply > atomicCall);
  assert.match(migrationSource, /insert into public\.webhook_events[\s\S]*insert into public\.media_library[\s\S]*if p_log is not null[\s\S]*insert into public\.media_logs/iu);
});

test('Telegram persistence failure cannot send a success confirmation', () => {
  assert.match(telegramSource, /if \(transactionError\) throw new Error[\s\S]*if \(!applied\)[\s\S]*telegramConfirmation/iu);
});

test('Telegram uses provider confidence and labels only genuinely ambiguous alternatives', () => {
  assert.doesNotMatch(telegramSource, /preferredProviderId|\.ilike\('title', cleanTitle\)/u);
  assert.match(telegramSource, /telegramMediaTypeLabel\(option\.mediaType\)/u);
  assert.match(telegramSource, /I found a few genuinely close matches/);
  assert.doesNotMatch(telegramSource, /Choose a more specific title\/year/);
});

test('Telegram ambiguity follow-ups reuse the original activity instead of becoming planned items', () => {
  assert.match(telegramSource, /pending-resolution:\$\{chatId\}[\s\S]*resolveTelegramAmbiguityReply[\s\S]*applyTelegramAmbiguitySelection/iu);
  assert.match(telegramSource, /originalItem[\s\S]*activityTimestamp[\s\S]*Your original activity will be preserved/iu);
  assert.match(telegramSource, /I could not match that choice[\s\S]*Pending resolution remains open/iu);
  assert.match(telegramSource, /Number\(item\._activityTimestamp \?\? timestamp\)/u);
  assert.match(telegramSource, /apply_telegram_media_event[\s\S]*clearPendingResolution\(item\._pendingEventId\)/iu);
});

test('Telegram success feedback uses labelled meaningful fields and omits empty values and the unreliable deep link', () => {
  assert.match(telegramSource, /telegramConfirmation\(\{[\s\S]*year: canonicalYear[\s\S]*type,[\s\S]*lifecycle/iu);
  assert.doesNotMatch(telegramSource, /Diary: none|Rating:<\/b>.*None|View in Polyhedron|project-polyhedron\.netlify\.app\/media/iu);
});

test('Casino Royale, Quantum of Solace, and The Odyssey direct-completion archetypes remain coherent', () => {
  for (const title of ['Casino Royale', 'Quantum of Solace', 'The Odyssey']) {
    const eventTime = Date.parse('2026-08-24T12:34:56.000Z');
    const lifecycle = buildTelegramLifecycle({ intent: 'COMPLETE_ITEM', type: 'movies', activityAt: eventTime });
    assert.deepEqual({
      title,
      status: lifecycle.status,
      started: lifecycle.dateStarted,
      completed: lifecycle.dateCompleted,
      diary: lifecycle.actionType,
      shouldLog: lifecycle.shouldLog,
    }, {
      title,
      status: 'completed',
      started: eventTime,
      completed: eventTime,
      diary: 'WATCHED',
      shouldLog: true,
    });
  }
});
