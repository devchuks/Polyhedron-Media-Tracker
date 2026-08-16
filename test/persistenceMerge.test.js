import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLibraryState, mergePersistedSnapshots } from '../src/domain/persistenceMerge.js';

test('concurrent tab snapshots preserve unrelated record updates', () => {
  const first = { media: { movies: [{ id: 550, type: 'movies', title: 'Movie', updatedAt: 20 }], tv: [] }, mediaLogs: [] };
  const second = { media: { movies: [], tv: [{ id: 550, type: 'tv', title: 'TV', updatedAt: 21 }] }, mediaLogs: [] };
  const merged = mergeLibraryState(first, second);
  assert.equal(merged.media.movies[0].media_key, 'tmdb:movies:550');
  assert.equal(merged.media.tv[0].media_key, 'tmdb:tv:550');

  const serialized = mergePersistedSnapshots(
    JSON.stringify({ state: first, version: 2 }),
    JSON.stringify({ state: second, version: 2 }),
  );
  assert.equal(JSON.parse(serialized).state.media.movies.length, 1);
});

test('newer tombstones prevent stale snapshots from resurrecting deleted media and logs', () => {
  const stale = {
    media: { movies: [{ id: 12, type: 'movies', updatedAt: 10 }] },
    mediaLogs: [{ log_id: 'l1', media_id: 12, media_type: 'movies', log_date: '2026-01-01T00:00:00Z', updatedAt: 10 }],
  };
  const deletion = { media: { movies: [] }, mediaLogs: [], deletedMediaKeys: { 'tmdb:movies:12': 30 }, deletedLogIds: { l1: 30 } };
  const merged = mergeLibraryState(stale, deletion);
  assert.equal(merged.media.movies.length, 0);
  assert.equal(merged.mediaLogs.length, 0);
});

test('owner changes and reset epochs replace private snapshots instead of merging them', () => {
  const admin = JSON.stringify({
    version: 4,
    state: { ownerId: 'admin-a', storageEpoch: 10, media: { movies: [{ id: 1, type: 'movies' }] }, mediaLogs: [] },
  });
  const guest = JSON.stringify({
    version: 4,
    state: { ownerId: 'guest', storageEpoch: 11, media: { movies: [] }, mediaLogs: [] },
  });
  assert.equal(mergePersistedSnapshots(admin, guest), guest);
  assert.equal(mergePersistedSnapshots(guest, admin), guest, 'a stale tab cannot overwrite a newer logout epoch');

  const accountB = JSON.stringify({
    version: 4,
    state: { ownerId: 'admin-b', storageEpoch: 12, media: { movies: [{ id: 2, type: 'movies' }] }, mediaLogs: [] },
  });
  const merged = JSON.parse(mergePersistedSnapshots(guest, accountB));
  assert.deepEqual(merged.state.media.movies.map(item => item.id), [2]);
});
