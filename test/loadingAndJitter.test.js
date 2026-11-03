import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assembleCloudRows, recordsEqual, reuseUnchangedRecords, rowsNeedingFullFetch } from '../src/domain/cloudDelta.js';
import { mergeLibraryState, mergePersistedSnapshots, preferInMemoryRevisions } from '../src/domain/persistenceMerge.js';
import { isDiscoveryCacheFresh, DISCOVERY_CACHE_VERSION, DISCOVERY_CACHE_TTL_MS } from '../src/domain/discoveryCatalog.js';
import { isRetryableAuthError } from '../src/utils/requestErrors.js';

const vn = (overrides = {}) => ({
  id: 'v17', type: 'vn', provider: 'vndb', provider_id: 'v17', media_key: 'vndb:vn:v17',
  title: 'Ever17', status: 'completed', image: 'https://t.vndb.org/cv.t/1.jpg', updatedAt: 1000,
  apiData: { image: 'https://t.vndb.org/cv.t/1.jpg', raw: { id: 'v17', deepFetched: true, staff: [{ id: 's1' }] } },
  ...overrides,
});

test('incremental hydration downloads complete rows only for new or changed revisions', () => {
  const local = new Map([
    ['vndb:vn:v1', { media_key: 'vndb:vn:v1', updatedAt: Date.parse('2026-01-01T00:00:00.000Z'), apiData: { raw: { id: 'v1' } } }],
    ['vndb:vn:v2', { media_key: 'vndb:vn:v2', updatedAt: Date.parse('2026-01-01T00:00:00.000Z'), apiData: { raw: { id: 'v2' } } }],
    ['vndb:vn:v3', { media_key: 'vndb:vn:v3', updatedAt: 5, apiData: {} }],
  ]);
  const light = [
    { library_row_id: 'a', media_key: 'vndb:vn:v1', updated_at: '2026-01-01T00:00:00+00:00' },
    { library_row_id: 'b', media_key: 'vndb:vn:v2', updated_at: '2026-02-01T00:00:00+00:00' },
    { library_row_id: 'c', media_key: 'vndb:vn:v3', updated_at: '1970-01-01T00:00:00.005Z' },
    { library_row_id: 'd', media_key: 'vndb:vn:v4', updated_at: '2026-01-01T00:00:00Z' },
  ];
  // Changed revision, empty local payload, and unknown row all need the full row; the unchanged one does not.
  assert.deepEqual(rowsNeedingFullFetch(light, local), ['b', 'c', 'd']);

  const assembled = assembleCloudRows(light, [{ library_row_id: 'b', media_key: 'vndb:vn:v2', apiData: { raw: { id: 'v2', fresh: true } } }], local);
  assert.deepEqual(assembled[0].apiData, { raw: { id: 'v1' } });
  assert.equal(assembled[1].apiData.raw.fresh, true);
  assert.deepEqual(assembled[3].apiData, {});
});

test('an unchanged sync keeps record and array identity so nothing re-renders', () => {
  const previous = { media: { vn: [vn()] }, mediaLogs: [{ log_id: 'l1', log_date: '2026-01-01T00:00:00Z' }], deletedMediaKeys: {}, deletedLogIds: {} };
  const next = { media: { vn: [structuredClone(vn())] }, mediaLogs: [{ log_id: 'l1', log_date: '2026-01-01T00:00:00Z' }], deletedMediaKeys: {}, deletedLogIds: {} };
  const result = reuseUnchangedRecords(previous, next);
  assert.equal(result.media.vn, previous.media.vn);
  assert.equal(result.mediaLogs, previous.mediaLogs);

  const changed = reuseUnchangedRecords(previous, { ...next, media: { vn: [vn({ status: 'in progress' })] } });
  assert.notEqual(changed.media.vn[0], previous.media.vn[0]);
  assert.equal(changed.media.vn[0].status, 'in progress');
  assert.equal(recordsEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(recordsEqual({ a: 1 }, { a: 1, b: undefined }), false);
});

test('rehydrating a slimmed copy at the same revision keeps the enriched in-memory record', () => {
  const live = vn();
  const slim = { ...vn(), apiData: { ...vn().apiData, raw: { id: 'v17' } } };
  const result = preferInMemoryRevisions({ media: { vn: [live] }, mediaLogs: [] }, { media: { vn: [slim] }, mediaLogs: [] });
  assert.equal(result.media.vn[0], live);
  assert.equal(result.media.vn[0].apiData.raw.deepFetched, true);

  const newer = { ...slim, updatedAt: 2000, title: 'Ever17 (other tab)' };
  const fromOtherTab = preferInMemoryRevisions({ media: { vn: [live] }, mediaLogs: [] }, { media: { vn: [newer] }, mediaLogs: [] });
  assert.equal(fromOtherTab.media.vn[0].title, 'Ever17 (other tab)');
});

test('a restored record clears its older tombstone so persisted and in-memory state converge', () => {
  // In memory, re-adding an item removes its tombstone; the merge used to keep it, so the persisted
  // snapshot never matched and every save triggered another rehydrate (the VN detail jitter loop).
  const stored = { media: { vn: [] }, mediaLogs: [], deletedMediaKeys: { 'vndb:vn:v17': 500 }, deletedLogIds: {} };
  const incoming = { media: { vn: [vn()] }, mediaLogs: [], deletedMediaKeys: {}, deletedLogIds: {} };
  const merged = mergeLibraryState(stored, incoming);
  assert.equal(merged.media.vn.length, 1);
  assert.equal(merged.deletedMediaKeys['vndb:vn:v17'], undefined);

  const value = JSON.stringify({ state: { ownerId: 'u', storageEpoch: 1, ...merged }, version: 5 });
  assert.equal(mergePersistedSnapshots(value, value), value);

  // A tombstone newer than the record still deletes it.
  const deleted = mergeLibraryState({ ...incoming, deletedMediaKeys: { 'vndb:vn:v17': 5000 } }, incoming);
  assert.equal(deleted.media.vn.length, 0);
  assert.equal(deleted.deletedMediaKeys['vndb:vn:v17'], 5000);
});

test('Discovery freshness requires a current-version, non-empty snapshot inside the TTL', () => {
  const now = 10 * DISCOVERY_CACHE_TTL_MS;
  const data = { _version: DISCOVERY_CACHE_VERSION, trending: [{ id: 1 }], upcoming: [], popular: [] };
  assert.equal(isDiscoveryCacheFresh({ data, timestamp: now - 1000 }, now), true);
  assert.equal(isDiscoveryCacheFresh({ data, timestamp: now - DISCOVERY_CACHE_TTL_MS }, now), false);
  assert.equal(isDiscoveryCacheFresh({ data: { ...data, _version: 0 }, timestamp: now }, now), false);
  assert.equal(isDiscoveryCacheFresh({ data: { ...data, trending: [] }, timestamp: now }, now), false);
});

test('only an unreachable auth service keeps the cached session; a rejected session does not', () => {
  assert.equal(isRetryableAuthError({ name: 'AuthRetryableFetchError', status: 0 }), true);
  assert.equal(isRetryableAuthError({ message: 'Failed to fetch' }), true);
  assert.equal(isRetryableAuthError({ status: 503, message: 'unavailable' }), true);
  assert.equal(isRetryableAuthError({ name: 'AuthApiError', status: 401, message: 'invalid JWT' }), false);
  assert.equal(isRetryableAuthError({ status: 403, message: 'Failed to fetch' }), false);
  assert.equal(isRetryableAuthError(null), false);
});

test('startup shows the cached owner library before network verification and syncs incrementally', async () => {
  const store = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  assert.match(store, /supabase\.auth\.getSession\(\)/);
  assert.match(store, /sessionData\?\.session\?\.user\?\.id === cachedOwnerId/);
  assert.match(store, /columns: LIGHT_MEDIA_COLUMNS/);
  assert.match(store, /\.eq\('user_id', user\.id\)\s*\n\s*\.in\('library_row_id'/);
  assert.match(store, /preferInMemoryRevisions\(currentState, persistedState\)/);

  const layout = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
  assert.match(layout, /prefetchDiscovery\(\)/);
  const discovery = await readFile(new URL('../src/pages/Discovery.jsx', import.meta.url), 'utf8');
  assert.match(discovery, /fetchDiscoveryTab\(activeTab\)/);
  assert.match(discovery, /key=\{`\$\{activeTab\}:\$\{currentData\._fetchedAt \|\| 0\}`\}/);
});

test('diary entries match their titles through one library index with the same results as a scan', async () => {
  const { findMediaForLog, findMediaInIndex, indexMediaByKey } = await import('../src/domain/mediaState.js');
  const media = {
    tv: [{ id: '550', type: 'tv', provider: 'tmdb', provider_id: '550', title: 'TV 550' }],
    movies: [{ id: '550', type: 'movies', provider: 'tmdb', provider_id: '550', title: 'Movie 550' }],
    vn: [{ id: 'v17', type: 'vn', provider: 'vndb', provider_id: 'v17', title: 'Ever17' }],
  };
  const logs = [
    { log_id: 'a', media_type: 'tv', media_id: '550', provider: 'tmdb' },
    { log_id: 'b', media_type: 'movies', media_id: '550', provider: 'tmdb' },
    { log_id: 'c', media_type: 'vn', media_id: 'v17', provider: 'vndb' },
    { log_id: 'd', media_type: 'vn', media_id: 'v99', provider: 'vndb' },
    { log_id: 'e' },
  ];
  const index = indexMediaByKey(media);
  for (const log of logs) assert.equal(findMediaInIndex(index, log), findMediaForLog(media, log));
  assert.equal(findMediaInIndex(index, logs[0]).title, 'TV 550');
  assert.equal(findMediaInIndex(index, logs[1]).title, 'Movie 550');

  const diary = await readFile(new URL('../src/pages/Diary.jsx', import.meta.url), 'utf8');
  assert.match(diary, /indexMediaByKey\(media\)/);
  assert.doesNotMatch(diary, /findMediaForLog\(media, log\)/);
  const pages = await readFile(new URL('../src/pages/Pages.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(pages, /findMediaForLog\(media, log\)/);
});

test('a one-time catch-up re-downloads unchanged TV rows whose cache lost the season list', () => {
  const stamp = '2026-01-01T00:00:00.000Z';
  const local = new Map([
    ['tmdb:tv:1', { media_key: 'tmdb:tv:1', type: 'tv', updatedAt: Date.parse(stamp), apiData: { raw: { id: 1 } } }],
    ['tmdb:tv:2', { media_key: 'tmdb:tv:2', type: 'tv', updatedAt: Date.parse(stamp), apiData: { raw: { id: 2, seasons: [] } } }],
    ['tmdb:movies:3', { media_key: 'tmdb:movies:3', type: 'movies', updatedAt: Date.parse(stamp), apiData: { raw: { id: 3 } } }],
  ]);
  const light = [...local.keys()].map((media_key, i) => ({ library_row_id: `r${i}`, media_key, updated_at: stamp }));
  assert.deepEqual(rowsNeedingFullFetch(light, local), []);
  const needsFullRow = item => item.type === 'tv' && !Array.isArray(item.apiData?.raw?.seasons);
  assert.deepEqual(rowsNeedingFullFetch(light, local, { needsFullRow }), ['r0']);
});
