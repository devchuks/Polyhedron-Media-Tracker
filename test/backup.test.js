import test from 'node:test';
import assert from 'node:assert/strict';

import { createBackup, normalizeBackup } from '../src/domain/backup.js';

test('legacy backups migrate canonical media/log identity and exports are versioned', () => {
  const legacy = normalizeBackup({
    media: { movies: [{ id: 550, title: 'Movie' }], tv: [{ id: 550, title: 'TV' }] },
    mediaLogs: [{ log_id: 'l1', media_id: 550, media_type: 'movies', log_date: '2026-01-01T00:00:00Z' }],
  });
  assert.equal(legacy.media.movies[0].media_key, 'tmdb:movies:550');
  assert.equal(legacy.media.tv[0].media_key, 'tmdb:tv:550');
  assert.equal(legacy.mediaLogs[0].media_key, 'tmdb:movies:550');
  assert.equal(createBackup(legacy.media, legacy.mediaLogs).schemaVersion, 2);
});

test('malformed backup shapes are rejected before state mutation', () => {
  assert.throws(() => normalizeBackup({ media: { movies: 'not-an-array' }, mediaLogs: [] }), /movies/i);
  assert.throws(() => normalizeBackup({ media: {}, mediaLogs: {} }), /mediaLogs/i);
  assert.throws(() => normalizeBackup({ media: { movies: [{ title: 'Missing ID' }] }, mediaLogs: [] }), /identifier/i);
  assert.throws(() => normalizeBackup({ media: { movies: [{ id: 1, status: 'completed' }] }, mediaLogs: [] }), /completion date/i);
  assert.throws(() => normalizeBackup({ media: { movies: [{ id: 1 }, { id: 1 }] }, mediaLogs: [] }), /duplicate media/i);
  assert.throws(() => normalizeBackup({ media: {}, mediaLogs: [{ log_id: 'orphan', media_id: 1, media_type: 'movies', log_date: '2026-01-01' }] }), /orphan/i);
  assert.throws(() => normalizeBackup({ media: { podcasts: [] }, mediaLogs: [] }), /unsupported media categories/i);
});
