import test from 'node:test';
import assert from 'node:assert/strict';
import { getCachedValue, mapWithConcurrency, setCachedValue } from '../src/utils/boundedAsync.js';

test('session cache entries expire and remain bounded', () => {
  const cache = new Map();
  setCachedValue(cache, 'a', 1, { now: 0, ttlMs: 10, limit: 2 });
  setCachedValue(cache, 'b', 2, { now: 0, ttlMs: 10, limit: 2 });
  setCachedValue(cache, 'c', 3, { now: 0, ttlMs: 10, limit: 2 });
  assert.equal(cache.has('a'), false);
  assert.equal(getCachedValue(cache, 'b', 5), 2);
  assert.equal(getCachedValue(cache, 'b', 11), undefined);
});

test('bounded mapper never exceeds its concurrency limit', async () => {
  let active = 0;
  let maximum = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async value => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.equal(maximum, 2);
});
