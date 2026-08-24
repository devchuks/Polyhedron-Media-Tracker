import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDetailEnrichmentPending,
  runSettlingDetailRequest,
  shouldShowMetadataSkeleton,
} from '../src/domain/detailEnrichment.js';

test('detail metadata skeleton appears only while pending without usable current values', () => {
  assert.equal(shouldShowMetadataSkeleton(true, []), true);
  assert.equal(shouldShowMetadataSkeleton(true, [{ name: 'Drama' }]), false);
  assert.equal(shouldShowMetadataSkeleton(false, []), false);
  assert.equal(isDetailEnrichmentPending({ routeKey: 'movies:1', phase: 'pending' }, 'movies:1'), true);
  assert.equal(isDetailEnrichmentPending({ routeKey: 'movies:1', phase: 'pending' }, 'movies:2'), false);
  assert.equal(isDetailEnrichmentPending({ routeKey: 'movies:1', phase: 'settled' }, 'movies:1'), false);
});

test('detail enrichment resolves values and resolved-empty requests settle without callbacks', async () => {
  const received = [];
  const resolved = await runSettlingDetailRequest({ load: async () => ({ genres: ['Drama'] }), isCurrent: () => true, onResolved: async value => received.push(value) });
  const empty = await runSettlingDetailRequest({ load: async () => null, isCurrent: () => true, onResolved: async value => received.push(value) });
  assert.equal(resolved.outcome, 'resolved');
  assert.equal(empty.outcome, 'empty');
  assert.deepEqual(received, [{ genres: ['Drama'] }]);
});

test('detail enrichment settles rejected and intentional AbortError requests', async () => {
  const rejected = await runSettlingDetailRequest({ load: async () => { throw new Error('provider failed'); }, isCurrent: () => true, onResolved: async () => {} });
  const aborted = await runSettlingDetailRequest({ load: async () => { throw new DOMException('navigation', 'AbortError'); }, isCurrent: () => true, onResolved: async () => {} });
  assert.equal(rejected.outcome, 'rejected');
  assert.equal(aborted.outcome, 'aborted');
});

test('a stale detail request cannot install metadata or remain current', async () => {
  let current = true;
  let installed = false;
  const result = await runSettlingDetailRequest({
    load: async () => { current = false; return { genres: ['Stale'] }; },
    isCurrent: () => current,
    onResolved: async () => { installed = true; },
  });
  assert.equal(result.outcome, 'stale');
  assert.equal(installed, false);
});
