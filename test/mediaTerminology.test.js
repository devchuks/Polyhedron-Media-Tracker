import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diaryActionsForMediaType,
  formatSeasonNumber,
  mediaCompletionDateLabel,
  mediaStatusActionLabel,
  mediaStatusLabel,
  mediaTypeFromPathname,
  ratingForInteraction,
} from '../src/domain/mediaTerminology.js';

test('completed lifecycle values use media-appropriate display terminology', () => {
  assert.equal(mediaStatusLabel('completed', 'movies'), 'Watched');
  assert.equal(mediaStatusLabel('completed', 'tv'), 'Watched');
  assert.equal(mediaStatusLabel('completed', 'books'), 'Read');
  assert.equal(mediaStatusLabel('completed', 'comics'), 'Read');
  assert.equal(mediaStatusLabel('completed', 'games'), 'Played');
  assert.equal(mediaStatusActionLabel('completed', 'movies'), 'Mark as Watched');
  assert.equal(mediaCompletionDateLabel('books'), 'Read On');
});

test('Diary action options are scoped to the media activity domain', () => {
  assert.deepEqual(diaryActionsForMediaType('movies'), ['WATCHED', 'RE-WATCHED', 'LOGGED']);
  assert.deepEqual(diaryActionsForMediaType('books'), ['READ', 'RE-READ', 'LOGGED']);
  assert.deepEqual(diaryActionsForMediaType('games'), ['PLAYED', 'RE-PLAYED', 'LOGGED']);
  assert.equal(diaryActionsForMediaType('movies').includes('PLAYED'), false);
  assert.equal(diaryActionsForMediaType('books').includes('WATCHED'), false);
});

test('detail-route search media type uses the route type segment', () => {
  assert.equal(mediaTypeFromPathname('/media/tv/123'), 'tv');
  assert.equal(mediaTypeFromPathname('/books'), 'books');
  assert.equal(mediaTypeFromPathname('/diary'), null);
});

test('rating interactions derive values from the activated star for pointer and keyboard input', () => {
  assert.equal(ratingForInteraction({ starIndex: 2, clientX: 125, left: 100, width: 100 }), 5);
  assert.equal(ratingForInteraction({ starIndex: 2, clientX: 175, left: 100, width: 100 }), 6);
  assert.equal(ratingForInteraction({ starIndex: 2, clientX: 0, left: 100, width: 100, keyboard: true }), 6);
});

test('season numbers pad only single digits', () => {
  assert.equal(formatSeasonNumber(1), '01');
  assert.equal(formatSeasonNumber(9), '09');
  assert.equal(formatSeasonNumber(10), '10');
  assert.equal(formatSeasonNumber(11), '11');
});
