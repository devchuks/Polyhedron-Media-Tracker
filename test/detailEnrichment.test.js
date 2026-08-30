import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isDetailEnrichmentPending,
  previewItemForRoute,
  resolveDetailTitle,
  runSettlingDetailRequest,
  shouldReserveDetailBannerSpace,
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

test('every backdrop-capable provider reserves a neutral banner while it is still enriching', () => {
  for (const type of ['movies', 'tv', 'anime', 'manga', 'games', 'vn']) {
    assert.equal(shouldReserveDetailBannerSpace({ type, banner: null, raw: {}, enrichmentPhase: 'idle' }), true, `${type} should reserve its initial backdrop`);
    assert.equal(shouldReserveDetailBannerSpace({ type, banner: null, raw: {}, enrichmentPhase: 'pending' }), true, `${type} should retain its loading backdrop`);
  }
  assert.equal(shouldReserveDetailBannerSpace({ type: 'anime', banner: null, raw: {}, enrichmentPhase: 'settled' }), false);
  assert.equal(shouldReserveDetailBannerSpace({ type: 'books', banner: null, raw: {}, enrichmentPhase: 'pending' }), false);
  assert.equal(shouldReserveDetailBannerSpace({ type: 'comics', banner: null, raw: {}, enrichmentPhase: 'pending' }), false);
  assert.equal(shouldReserveDetailBannerSpace({ type: 'anime', banner: 'https://images.example/banner.jpg', raw: { deepFetched: true }, enrichmentPhase: 'settled' }), true);
});

test('detail previews and provider titles are bound to the selected route identity', () => {
  const preview = { id: 2, type: 'movies', title: 'Second' };
  assert.equal(previewItemForRoute(preview, 'movies', '2'), preview);
  assert.equal(previewItemForRoute({ ...preview, id: 1 }, 'movies', '2'), null);
  assert.equal(resolveDetailTitle({ title: 'Provider Second' }, 'movies', 'Stale First'), 'Provider Second');
  assert.equal(resolveDetailTitle({ name: 'Provider TV' }, 'tv', 'Stale First'), 'Provider TV');
});

test('late metadata for route A cannot replace route B', async () => {
  let currentRoute = 'movies:A';
  const installed = [];
  let resolveA;
  const aValue = new Promise(resolve => { resolveA = resolve; });
  const requestA = runSettlingDetailRequest({
    load: () => aValue,
    isCurrent: () => currentRoute === 'movies:A',
    onResolved: async value => installed.push(value.title),
  });

  currentRoute = 'movies:B';
  const requestB = runSettlingDetailRequest({
    load: async () => ({ title: 'B' }),
    isCurrent: () => currentRoute === 'movies:B',
    onResolved: async value => installed.push(value.title),
  });
  await requestB;
  resolveA({ title: 'A' });
  const staleResult = await requestA;

  assert.deepEqual(installed, ['B']);
  assert.equal(staleResult.outcome, 'stale');
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
