import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeLog,
  canonicalizeMediaItem,
  createMediaKey,
  mediaKeyFor,
} from '../src/domain/mediaIdentity.js';

test('raw numeric IDs are namespaced by provider and media type', () => {
  const movie = canonicalizeMediaItem({ id: 550, apiSource: 'tmdb' }, 'movies');
  const tv = canonicalizeMediaItem({ id: 550, apiSource: 'tmdb' }, 'tv');
  const anime = canonicalizeMediaItem({ id: 550, apiSource: 'anilist' }, 'anime');

  assert.equal(movie.media_key, 'tmdb:movies:550');
  assert.equal(tv.media_key, 'tmdb:tv:550');
  assert.equal(anime.media_key, 'anilist:anime:550');
  assert.equal(new Set([movie.media_key, tv.media_key, anime.media_key]).size, 3);
});

test('legacy prefixed IDs keep route compatibility while provider IDs normalize', () => {
  const game = canonicalizeMediaItem({ id: 'igdb_42' }, 'games');
  const comic = canonicalizeMediaItem({ id: 'series_42' }, 'comics');

  assert.equal(game.id, 'igdb_42');
  assert.equal(game.provider_id, '42');
  assert.equal(game.media_key, 'igdb:games:42');
  assert.equal(comic.provider_id, 'series_42');
  assert.equal(comic.media_key, 'metron:comics:series_42');
});

test('legacy diary rows backfill canonical linkage from media type', () => {
  const movieLog = canonicalizeLog({ media_id: '550', media_type: 'movies' });
  const tvLog = canonicalizeLog({ media_id: '550', media_type: 'tv' });

  assert.equal(movieLog.media_key, createMediaKey('tmdb', 'movies', '550'));
  assert.equal(tvLog.media_key, createMediaKey('tmdb', 'tv', '550'));
  assert.notEqual(mediaKeyFor(movieLog), mediaKeyFor(tvLog));
});
