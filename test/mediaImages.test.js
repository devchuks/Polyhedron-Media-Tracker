import test from 'node:test';
import assert from 'node:assert/strict';
import { firstUsableImageUrl, normalizeImageUrl, normalizeMediaImageFields, preserveUsableMediaImage } from '../src/domain/mediaImages.js';
import { canonicalizeLog, canonicalizeMediaItem } from '../src/domain/mediaIdentity.js';

test('provider image objects normalize to one scalar URL', () => {
  assert.equal(normalizeImageUrl({ url: 'https://images.example/poster.jpg', thumbnail: 'https://images.example/thumb.jpg' }), 'https://images.example/poster.jpg');
  assert.equal(normalizeMediaImageFields({ image: { thumbnail: 'https://images.example/thumb.jpg' } }).image, 'https://images.example/thumb.jpg');
  assert.equal(normalizeImageUrl({ extraLarge: 'https://images.example/anilist.jpg' }), 'https://images.example/anilist.jpg');
});

test('historical JSON-string images recover a usable URL', () => {
  const legacy = JSON.stringify({ url: 'https://images.example/recovered.jpg' });
  assert.equal(normalizeImageUrl(legacy), 'https://images.example/recovered.jpg');
  assert.equal(normalizeImageUrl('{not-valid-json'), null);
});

test('valid current images survive empty or invalid enrichment', () => {
  assert.equal(firstUsableImageUrl(null, '', { nope: true }, 'https://images.example/current.jpg'), 'https://images.example/current.jpg');
  assert.equal(normalizeMediaImageFields({ image: '', apiData: { image: 'https://images.example/nested.jpg' } }).image, 'https://images.example/nested.jpg');
});

test('newer sparse records preserve a valid prior image across hydration merges', () => {
  const preserved = preserveUsableMediaImage(
    { image: null, apiData: { image: '' }, updatedAt: 2 },
    { image: 'https://images.example/stable.jpg', apiData: {}, updatedAt: 1 },
  );
  assert.equal(preserved.image, 'https://images.example/stable.jpg');
  assert.equal(preserved.apiData.image, 'https://images.example/stable.jpg');
});

test('diary image persistence also uses the scalar boundary', () => {
  const log = canonicalizeLog({
    log_id: 'log-1',
    media_id: 'v1',
    media_type: 'vn',
    image: JSON.stringify({ thumbnail: 'https://images.example/log.jpg' }),
  });
  assert.equal(log.image, 'https://images.example/log.jpg');
});

test('unsafe and non-URL image values never reach the scalar boundary', () => {
  for (const value of [null, undefined, '', {}, 'javascript:alert(1)', 'data:text/html,test']) {
    assert.equal(normalizeImageUrl(value), null);
  }
});

test('the canonical image boundary applies to every supported media type', () => {
  for (const type of ['movies', 'tv', 'anime', 'manga', 'books', 'vn', 'games', 'comics']) {
    const item = canonicalizeMediaItem({ id: `${type}-1`, type, image: { url: `https://images.example/${type}.jpg` } }, type);
    assert.equal(item.image, `https://images.example/${type}.jpg`);
  }
});
