import test from 'node:test';
import assert from 'node:assert/strict';
import { apiClient, ApiError } from '../src/utils/apiClient.js';
import { isTransientError, parseRetryAfter, withRetry } from '../src/utils/retry.js';

test('API client accepts empty and non-JSON successful responses', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await apiClient('https://example.test/empty'), null);
  global.fetch = async () => new Response('plain response', { status: 200, headers: { 'content-type': 'text/plain' } });
  assert.equal(await apiClient('https://example.test/text'), 'plain response');
});

test('API errors preserve status and Retry-After while permanent errors are not retried', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(JSON.stringify({ error: 'slow down' }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': '2' },
  });
  await assert.rejects(() => apiClient('https://example.test/limited'), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 2_000);
    return true;
  });
  assert.equal(isTransientError({ status: 400 }), false);
  assert.equal(isTransientError({ status: 503 }), true);
  assert.equal(parseRetryAfter('invalid'), null);

  let attempts = 0;
  await assert.rejects(() => withRetry(async () => {
    attempts += 1;
    throw Object.assign(new Error('bad request'), { status: 400 });
  }, { retries: 3, wait: async () => {} }));
  assert.equal(attempts, 1);
});

test('API timeout and caller cancellation settle predictably', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  await assert.rejects(() => apiClient('https://example.test/slow', { timeoutMs: 5 }), error => error.isTimeout === true);

  const controller = new AbortController();
  const pending = apiClient('https://example.test/cancel', { signal: controller.signal, timeoutMs: 1_000 });
  controller.abort();
  await assert.rejects(() => pending, error => error?.name === 'AbortError');
});
