import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowEnvironmentBadge } from '../src/config/environment.js';
import { isIntentionalAbort, isJwtIssuedAtFutureError, providerErrorMessage, retryAfterJwtRefresh } from '../src/utils/requestErrors.js';
import { createSingleFlight } from '../src/utils/singleFlight.js';

test('staging badge is development-only and never labels production', () => {
  assert.equal(shouldShowEnvironmentBadge('staging', true), true);
  assert.equal(shouldShowEnvironmentBadge('production', true), false);
  assert.equal(shouldShowEnvironmentBadge('staging', false), false);
});

test('intentional cancellation is distinguished from provider failure', () => {
  assert.equal(isIntentionalAbort(Object.assign(new Error('cancelled'), { name: 'AbortError' })), true);
  assert.equal(isIntentionalAbort(new Error('provider unavailable')), false);
});

test('provider errors are presented without raw upstream diagnostics', () => {
  assert.equal(providerErrorMessage({ status: 400, message: '{"error":"internal route detail"}' }, 'TMDB'), 'TMDB could not complete this request.');
  assert.equal(providerErrorMessage({ status: 503, message: 'upstream stack trace' }, 'IGDB'), 'IGDB server is currently unavailable.');
  assert.equal(providerErrorMessage({ message: 'Failed to fetch' }, 'Metron'), 'Network error. Unable to reach Metron.');
});

test('future-issued JWT recovery refreshes once and retries the failing operation once', async () => {
  let operationCalls = 0;
  let refreshCalls = 0;
  const result = await retryAfterJwtRefresh(async () => {
    operationCalls += 1;
    if (operationCalls === 1) throw { code: 'PGRST3003', message: 'JWT issued at future' };
    return 'ok';
  }, async () => {
    refreshCalls += 1;
    return { error: null };
  });
  assert.equal(result, 'ok');
  assert.equal(operationCalls, 2);
  assert.equal(refreshCalls, 1);
});

test('ordinary cloud failures are not misclassified or retried as JWT clock skew', async () => {
  const error = Object.assign(new Error('provider unavailable'), { code: '500' });
  assert.equal(isJwtIssuedAtFutureError(error), false);
  let operationCalls = 0;
  let refreshCalls = 0;
  await assert.rejects(retryAfterJwtRefresh(async () => {
    operationCalls += 1;
    throw error;
  }, async () => {
    refreshCalls += 1;
    return { error: null };
  }), /provider unavailable/);
  assert.equal(operationCalls, 1);
  assert.equal(refreshCalls, 0);
});

test('single-flight execution deduplicates overlap and permits a later refresh', async () => {
  const flights = createSingleFlight();
  let calls = 0;
  let release;
  const blocker = new Promise(resolve => { release = resolve; });
  const first = flights.run('owner-a', async () => {
    calls += 1;
    await blocker;
    return 1;
  });
  const duplicate = flights.run('owner-a', async () => {
    calls += 1;
    return 2;
  });
  assert.equal(first, duplicate);
  release();
  assert.equal(await duplicate, 1);
  assert.equal(await flights.run('owner-a', async () => {
    calls += 1;
    return 3;
  }), 3);
  assert.equal(calls, 2);
});
