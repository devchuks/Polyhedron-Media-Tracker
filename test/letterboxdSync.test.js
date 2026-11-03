import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertLetterboxdUsername, letterboxdReviewText, parseLetterboxdFeed } from '../supabase/functions/_shared/letterboxdFeed.js';
import { letterboxdMediaKey, planLetterboxdEntry } from '../src/domain/letterboxdSync.js';
import { timestampFromDateInput } from '../src/utils/calendarDate.js';

const item = ({ guid = 'letterboxd-review-1569332109', watched = '2026-11-02', rewatch = 'No', rating = '4.0', tmdb = '1423191', body = '<p>&quot;VIDEOGAMES&quot;</p>' } = {}) => `
  <item>
    <title>Resident Evil, 2026 - ★★★★</title>
    <link>https://letterboxd.com/weirdjason/film/resident-evil-2026/</link>
    <guid isPermaLink="false">${guid}</guid>
    <pubDate>Tue, 3 Nov 2026 07:48:23 +1300</pubDate>
    <letterboxd:watchedDate>${watched}</letterboxd:watchedDate>
    <letterboxd:rewatch>${rewatch}</letterboxd:rewatch>
    <letterboxd:filmTitle>Resident Evil</letterboxd:filmTitle>
    <letterboxd:filmYear>2026</letterboxd:filmYear>
    ${rating ? `<letterboxd:memberRating>${rating}</letterboxd:memberRating>` : ''}
    <tmdb:movieId>${tmdb}</tmdb:movieId>
    <description><![CDATA[ <p><img src="https://a.ltrbxd.com/poster.jpg"/></p> ${body} ]]></description>
  </item>`;

test('the Letterboxd feed parses into diary entries with rating, review, rewatch and TMDB id', () => {
  const xml = `<rss><channel>${item()}${item({ guid: 'letterboxd-watch-2', rewatch: 'Yes', rating: '', body: '<p>Watched on Sunday October 12, 2026.</p>' })}
    <item><title>A list</title><guid>letterboxd-list-9</guid><description>list</description></item></channel></rss>`;
  const entries = parseLetterboxdFeed(xml);
  assert.equal(entries.length, 2);
  assert.deepEqual({ ...entries[0], publishedAt: undefined }, {
    guid: 'letterboxd-review-1569332109', tmdbId: '1423191', watchedDate: '2026-11-02', rewatch: false, rating: 8,
    title: 'Resident Evil', year: '2026', review: '"VIDEOGAMES"', poster: 'https://a.ltrbxd.com/poster.jpg',
    link: 'https://letterboxd.com/weirdjason/film/resident-evil-2026/', publishedAt: undefined,
  });
  assert.equal(entries[1].rewatch, true);
  assert.equal(entries[1].rating, 0);
  assert.equal(entries[1].review, '');
  assert.equal(letterboxdReviewText('<p><em>This review may contain spoilers.</em></p><p>Line one<br/>line two</p><p>Para &amp; two</p>'), 'Line one\nline two\n\nPara & two');
});

test('only plain Letterboxd usernames reach the fixed upstream host', async () => {
  assert.equal(assertLetterboxdUsername('https://letterboxd.com/weirdjason/'), 'weirdjason');
  assert.equal(assertLetterboxdUsername('weird_jason'), 'weird_jason');
  for (const bad of ['', '../admin', 'a b', 'evil.com/x?y', 'x'.repeat(41)]) assert.throws(() => assertLetterboxdUsername(bad), TypeError);
  const fn = await readFile(new URL('../supabase/functions/letterboxd/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /fetch\(`https:\/\/letterboxd\.com\/\$\{safeUsername\}\/rss\/`/);
  assert.match(fn, /enforceRateLimit\(req/);
  assert.match(fn, /MAX_FEED_BYTES/);
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /\[functions\.letterboxd\]\s*\nverify_jwt = true/);
});

const entry = (overrides = {}) => ({
  guid: 'letterboxd-review-1569332109', tmdbId: '1423191', watchedDate: '2026-11-02', rewatch: false, rating: 8,
  title: 'Resident Evil', year: '2026', review: 'VIDEOGAMES', poster: 'https://a.ltrbxd.com/poster.jpg', publishedAt: Date.parse('2026-11-02T18:48:23Z'), ...overrides,
});
const key = letterboxdMediaKey('1423191');
const watchedAt = timestampFromDateInput('2026-11-02');

test('a new Letterboxd watch adds the film as watched with one diary entry carrying rating and review', () => {
  const { media, log, logUpdate } = planLetterboxdEntry({ entry: entry(), localItem: undefined, logs: [] });
  assert.equal(media.media_key ?? key, key);
  assert.equal(media.status, 'completed');
  assert.equal(media.rating, 8);
  assert.equal(media.dateCompleted, watchedAt);
  assert.equal(media.dateStarted, watchedAt);
  assert.deepEqual({ ...log, image: undefined }, {
    log_id: 'letterboxd-review-1569332109', media_type: 'movies', action_type: 'WATCHED', log_date: new Date(watchedAt).toISOString(),
    review_text: 'VIDEOGAMES', image: undefined, rating: 8,
  });
  assert.equal(logUpdate, null);
});

test('a Letterboxd watch already logged on Polyhedron only fills in a missing review', () => {
  const manual = { log_id: 'manual', media_key: key, action_type: 'WATCHED', log_date: new Date(watchedAt + 3 * 60 * 60 * 1000).toISOString(), review_text: '' };
  const watched = { id: '1423191', type: 'movies', provider: 'tmdb', provider_id: '1423191', media_key: key, status: 'completed', rating: 8, rewatchCount: 0, dateStarted: watchedAt, dateCompleted: watchedAt, addedAt: 1 };
  const result = planLetterboxdEntry({ entry: entry(), localItem: watched, logs: [manual] });
  assert.equal(result.log, null);
  assert.deepEqual(result.logUpdate, { log_id: 'manual', patch: { review_text: 'VIDEOGAMES', rating: 8 } });
  assert.equal(result.media, null);
  // An existing Polyhedron review is never overwritten.
  assert.equal(planLetterboxdEntry({ entry: entry(), localItem: watched, logs: [{ ...manual, review_text: 'mine' }] }).logUpdate, null);
});

test('a review written on Polyhedron before the Letterboxd watch is upgraded into the watch entry', () => {
  const review = { log_id: 'telegram:1:0', media_key: key, action_type: 'LOGGED', log_date: new Date(watchedAt + 2 * 24 * 60 * 60 * 1000).toISOString(), review_text: 'Loved it' };
  const result = planLetterboxdEntry({ entry: entry({ review: '' }), localItem: undefined, logs: [review] });
  assert.equal(result.log, null);
  assert.deepEqual(result.logUpdate, { log_id: 'telegram:1:0', patch: { action_type: 'WATCHED', log_date: new Date(watchedAt).toISOString(), rating: 8 } });
});

test('a Letterboxd rewatch of a watched film adds a Rewatched entry and counts the rewatch', () => {
  const watched = { id: '1423191', type: 'movies', provider: 'tmdb', provider_id: '1423191', media_key: key, status: 'completed', rating: 7, rewatchCount: 0, dateStarted: 1, dateCompleted: 1, addedAt: 1 };
  const result = planLetterboxdEntry({ entry: entry({ rewatch: true, guid: 'letterboxd-review-2' }), localItem: watched, logs: [] });
  assert.equal(result.log.action_type, 'RE-WATCHED');
  assert.equal(result.media.rewatchCount, 1);
  assert.equal(result.media.dateCompleted, watchedAt);
});
