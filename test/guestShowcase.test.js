import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GUEST_SHOWCASE_VERSION,
  createEmptyGuestSnapshot,
  createGuestShowcaseSnapshot,
  createIsolatedAuthenticatedSnapshot,
  guestShowcaseLogs,
  guestShowcaseMedia,
  resolveGuestInitialization,
  snapshotGuestState,
} from '../src/domain/guestShowcase.js';
import { MEDIA_TYPES, mediaKeyFor } from '../src/domain/mediaIdentity.js';
import { findMediaForLog } from '../src/domain/mediaState.js';

const fresh = () => resolveGuestInitialization({ currentOwnerId: null, seededVersion: 0 });
const items = snapshot => Object.values(snapshot.media).flat();
const byTitle = (snapshot, title) => items(snapshot).find(item => item.title === title);

test('fresh guest storage seeds the curated showcase', () => {
  const result = fresh();
  assert.equal(result.seeded, true);
  assert.equal(items(result.snapshot).length, 8);
});

test('showcase has exactly eight primary entries', () => assert.equal(guestShowcaseMedia().length, 8));
test('showcase represents all eight media categories', () => assert.deepEqual([...new Set(guestShowcaseMedia().map(item => item.type))].sort(), [...MEDIA_TYPES].sort()));
test('showcase contains every required title', () => assert.deepEqual(guestShowcaseMedia().map(item => item.title).sort(), ['Alan Wake 2', 'Barry', 'Fire Punch', 'House of Leaves', 'Interstellar', 'Neon Genesis Evangelion', 'The Hundred Line: Last Defense Academy', 'The Power Fantasy'].sort()));

test('canonical provider, type, and provider identifiers match the resolved entries', () => {
  const expected = {
    Interstellar: 'tmdb:movies:157336', Barry: 'tmdb:tv:73107', 'Neon Genesis Evangelion': 'anilist:anime:30',
    'Fire Punch': 'anilist:manga:87170', 'House of Leaves': 'openlibrary:books:OL32195W',
    'The Hundred Line: Last Defense Academy': 'vndb:vn:v54897', 'Alan Wake 2': 'igdb:games:185246',
    'The Power Fantasy': 'metron:comics:series_8082',
  };
  for (const item of guestShowcaseMedia()) assert.equal(item.media_key, expected[item.title]);
});

test('showcase has no canonical key duplicates', () => {
  const keys = guestShowcaseMedia().map(mediaKeyFor);
  assert.equal(new Set(keys).size, keys.length);
});

test('showcase lifecycle dates are possible and ordered', () => {
  for (const item of guestShowcaseMedia()) {
    assert.ok(item.addedAt <= item.dateStarted);
    if (item.dateCompleted) assert.ok(item.dateStarted <= item.dateCompleted);
  }
});

test('completed entries have completion dates', () => {
  for (const item of guestShowcaseMedia().filter(item => item.status === 'completed')) assert.ok(item.dateCompleted);
});

test('in-progress entries have no completion date', () => {
  for (const item of guestShowcaseMedia().filter(item => item.status === 'in progress')) assert.equal(item.dateCompleted, null);
});

test('every showcase item has a deterministic Started value', () => {
  for (const item of guestShowcaseMedia()) assert.ok(Number.isFinite(item.dateStarted));
});

test('showcase dates are deterministic across fresh snapshots', () => {
  const first = guestShowcaseMedia().map(({ title, addedAt, dateStarted, dateCompleted }) => ({ title, addedAt, dateStarted, dateCompleted }));
  const second = guestShowcaseMedia().map(({ title, addedAt, dateStarted, dateCompleted }) => ({ title, addedAt, dateStarted, dateCompleted }));
  assert.deepEqual(first, second);
});

test('diary log IDs are unique and stable', () => {
  const first = guestShowcaseLogs().map(log => log.log_id);
  assert.equal(new Set(first).size, first.length);
  assert.deepEqual(first, guestShowcaseLogs().map(log => log.log_id));
});

test('showcase diary contains no orphan logs', () => {
  const snapshot = createGuestShowcaseSnapshot();
  for (const log of snapshot.mediaLogs) assert.ok(findMediaForLog(snapshot.media, log));
});

test('Barry is currently in Season 3 at a real positive episode', () => assert.equal(byTitle(createGuestShowcaseSnapshot(), 'Barry').progress, 'S03 E04'));
test('Barry is not whole-series completed', () => {
  const barry = byTitle(createGuestShowcaseSnapshot(), 'Barry');
  assert.equal(barry.status, 'in progress');
  assert.equal(barry.dateCompleted, null);
});

test('Barry contains only explicitly authored Season 1 and Season 2 history', () => {
  const snapshot = createGuestShowcaseSnapshot();
  const labels = snapshot.mediaLogs.filter(log => log.media_key === byTitle(snapshot, 'Barry').media_key).map(log => log.season_label);
  assert.deepEqual(labels, ['Season 1', 'Season 2']);
});

test('Barry season years remain provider metadata, not activity dates', () => {
  const logs = guestShowcaseLogs().filter(log => log.media_key === 'tmdb:tv:73107');
  assert.deepEqual(logs.map(log => log.season_year), ['2018', '2019']);
  assert.ok(logs.every(log => new Date(log.log_date).getUTCFullYear() === 2025));
});

test('Barry fixture does not claim fictional next-season progress from its season logs', () => {
  const snapshot = createGuestShowcaseSnapshot();
  assert.equal(byTitle(snapshot, 'Barry').progress, 'S03 E04');
  assert.equal(snapshot.mediaLogs.some(log => log.season_label === 'Season 3'), false);
});

test('Fire Punch remains in progress and does not claim completion', () => {
  const item = byTitle(createGuestShowcaseSnapshot(), 'Fire Punch');
  assert.equal(item.status, 'in progress'); assert.equal(item.dateCompleted, null);
  assert.equal(guestShowcaseLogs().find(log => log.media_key === item.media_key).action_type, 'LOGGED');
});

test('Hundred Line remains in progress', () => {
  const item = byTitle(createGuestShowcaseSnapshot(), 'The Hundred Line: Last Defense Academy');
  assert.equal(item.status, 'in progress'); assert.equal(item.progress, '42%');
});

test('Power Fantasy remains incomplete with a partial issue set', () => {
  const item = byTitle(createGuestShowcaseSnapshot(), 'The Power Fantasy');
  assert.equal(item.status, 'in progress'); assert.equal(item.readIssueIds.length, 5); assert.equal(item.apiData.raw.issue_count, 16);
});

test('Power Fantasy issue IDs normalize as stable strings', () => {
  const item = byTitle(createGuestShowcaseSnapshot(), 'The Power Fantasy');
  assert.deepEqual(item.readIssueIds, item.readIssueIds.map(String));
  assert.ok(item.readIssueIds.every(id => item.apiData.raw.issue_details.some(issue => String(issue.id) === id)));
});

test('Interstellar presents a completed movie with one WATCHED activity', () => {
  const snapshot = createGuestShowcaseSnapshot(); const item = byTitle(snapshot, 'Interstellar');
  assert.equal(item.status, 'completed'); assert.equal(snapshot.mediaLogs.filter(log => log.media_key === item.media_key && log.action_type === 'WATCHED').length, 1);
});

test('Evangelion presents a completed 26-episode anime', () => {
  const item = byTitle(createGuestShowcaseSnapshot(), 'Neon Genesis Evangelion');
  assert.equal(item.status, 'completed'); assert.equal(item.progress, '26 Episodes');
});

test('House of Leaves presents a completed work-level OpenLibrary book', () => {
  const item = byTitle(createGuestShowcaseSnapshot(), 'House of Leaves');
  assert.equal(item.status, 'completed'); assert.equal(item.media_key, 'openlibrary:books:OL32195W');
});

test('Alan Wake 2 presents a completed IGDB game', () => {
  const item = byTitle(createGuestShowcaseSnapshot(), 'Alan Wake 2');
  assert.equal(item.status, 'completed'); assert.equal(item.progress, '100%');
});

test('normal guest reload reuses current state instead of reseeding', () => {
  const snapshot = createGuestShowcaseSnapshot(); snapshot.media.movies[0].rating = 4;
  const result = resolveGuestInitialization({ currentOwnerId: 'guest', currentState: snapshot, seededVersion: GUEST_SHOWCASE_VERSION });
  assert.equal(result.seeded, false); assert.equal(result.snapshot.media.movies[0].rating, 4);
});

test('guest edit survives a saved-snapshot restoration', () => {
  const snapshot = createGuestShowcaseSnapshot(); byTitle(snapshot, 'Barry').progress = 'S03 E05';
  const result = resolveGuestInitialization({ currentOwnerId: 'user-a', currentState: createEmptyGuestSnapshot(), savedGuestSnapshot: snapshot, seededVersion: GUEST_SHOWCASE_VERSION });
  assert.equal(byTitle(result.snapshot, 'Barry').progress, 'S03 E05');
});

test('deleting one showcase item does not resurrect it', () => {
  const snapshot = createGuestShowcaseSnapshot(); snapshot.media.movies = [];
  const result = resolveGuestInitialization({ currentOwnerId: 'guest', currentState: snapshot, seededVersion: GUEST_SHOWCASE_VERSION });
  assert.equal(byTitle(result.snapshot, 'Interstellar'), undefined);
});

test('deleting all showcase items does not reseed', () => {
  const empty = createEmptyGuestSnapshot();
  const result = resolveGuestInitialization({ currentOwnerId: 'guest', currentState: empty, seededVersion: GUEST_SHOWCASE_VERSION });
  assert.equal(items(result.snapshot).length, 0); assert.equal(result.seeded, false);
});

test('explicit guest clear marker suppresses immediate reseeding', () => {
  const result = resolveGuestInitialization({ currentOwnerId: null, savedGuestSnapshot: null, seededVersion: GUEST_SHOWCASE_VERSION });
  assert.equal(items(result.snapshot).length, 0); assert.equal(result.seeded, false);
});

test('genuinely fresh local storage permits seeding again', () => {
  const cleared = resolveGuestInitialization({ currentOwnerId: null, savedGuestSnapshot: null, seededVersion: 0 });
  assert.equal(cleared.seeded, true); assert.equal(items(cleared.snapshot).length, 8);
});

test('guest showcase data is locally marked and contains no cloud owner identity', () => {
  const snapshot = createGuestShowcaseSnapshot();
  assert.ok(items(snapshot).every(item => item.isGuestShowcase));
  assert.ok(items(snapshot).every(item => !item.user_id));
  assert.ok(snapshot.mediaLogs.every(log => !log.user_id));
});

test('guest to authenticated transition begins from an isolated empty owner snapshot', () => {
  const guest = createGuestShowcaseSnapshot(); const authenticated = createIsolatedAuthenticatedSnapshot();
  assert.equal(items(guest).length, 8); assert.equal(items(authenticated).length, 0); assert.equal(authenticated.mediaLogs.length, 0);
});

test('authenticated to guest transition restores guest state without exposing private media', () => {
  const guest = createGuestShowcaseSnapshot();
  guest.importQueue.push({ id: 'guest-import', extracted_title: 'Guest Queue Item' });
  const privateState = createEmptyGuestSnapshot(); privateState.media.movies.push({ title: 'PRIVATE', type: 'movies' });
  const result = resolveGuestInitialization({ currentOwnerId: 'user-a', currentState: privateState, savedGuestSnapshot: snapshotGuestState(guest), seededVersion: GUEST_SHOWCASE_VERSION });
  assert.equal(byTitle(result.snapshot, 'PRIVATE'), undefined); assert.equal(items(result.snapshot).length, 8);
  assert.deepEqual(result.snapshot.importQueue.map(item => item.id), ['guest-import']);
});
