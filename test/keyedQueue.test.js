import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedQueue } from '../src/utils/keyedQueue.js';

test('cloud mutations for one identity complete in call order and recover after failure', async () => {
  const queue = createKeyedQueue();
  const order = [];
  const first = queue.enqueue('tmdb:movies:550', async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    order.push('first');
    throw new Error('expected');
  });
  const second = queue.enqueue('tmdb:movies:550', async () => { order.push('second'); });
  await assert.rejects(first);
  await second;
  assert.deepEqual(order, ['first', 'second']);
});

test('different cloud identities can proceed independently', async () => {
  const queue = createKeyedQueue();
  let release;
  const blocked = queue.enqueue('movie', () => new Promise(resolve => { release = resolve; }));
  let tvCompleted = false;
  await queue.enqueue('tv', async () => { tvCompleted = true; });
  assert.equal(tvCompleted, true);
  release();
  await blocked;
});
