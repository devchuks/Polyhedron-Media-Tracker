import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLibraryContext, readLibrarySort, readLibraryViewMode, updateLibraryContext, writeLibrarySort, writeLibraryViewMode } from '../src/domain/libraryContext.js';
import { DISCOVERY_TYPES, sectionState, tmdbDiscoveryRequest } from '../src/domain/discoveryCatalog.js';
import { buildIgdbRequest } from '../supabase/functions/_shared/validation.js';
import { readFile } from 'node:fs/promises';

const memoryStorage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

test('Library presentation preferences persist only valid view and sort values', () => {
  const storage = memoryStorage();
  assert.equal(readLibraryViewMode(storage), 'grid');
  assert.equal(writeLibraryViewMode(storage, 'list'), true);
  assert.equal(readLibraryViewMode(storage), 'list');
  assert.equal(writeLibrarySort(storage, 'movies', 'rating'), true);
  assert.equal(readLibrarySort(storage, 'movies'), 'rating');
  assert.equal(writeLibraryViewMode(storage, 'tiles'), false);
});

test('Library URL context is validated and default values stay out of the URL', () => {
  const parsed = parseLibraryContext('q=alien&status=in%20progress&sort=title&page=3');
  assert.deepEqual(parsed, { search: 'alien', status: 'in progress', sort: 'title', page: 3 });
  assert.equal(updateLibraryContext(new URLSearchParams('q=alien&page=2'), { search: '', status: 'all', sort: 'dateAdded', page: 1 }).toString(), '');
  assert.deepEqual(parseLibraryContext('status=watched&sort=bad&page=-4'), { search: '', status: 'all', sort: 'dateAdded', page: 1 });
});

test('Discovery includes all supported media and constructs defensible date/rating queries', () => {
  assert.deepEqual(DISCOVERY_TYPES, ['movies', 'tv', 'anime', 'manga', 'books', 'vn', 'games', 'comics']);
  const request = tmdbDiscoveryRequest('movies', 'upcoming', 2, new Date('2026-08-28T12:00:00Z'));
  assert.equal(request.path, '/discover/movie');
  assert.equal(request.query['primary_release_date.gte'], '2026-08-28');
  assert.equal(request.query['primary_release_date.lte'], '2028-02-28');
  assert.equal(request.query.sort_by, 'popularity.desc');
  assert.match(buildIgdbRequest('discoverySection', { section: 'trending' }).query, /first_release_date <= \d+.*sort first_release_date desc/);
  assert.match(buildIgdbRequest('discoverySection', { section: 'upcoming' }).query, /first_release_date > \d+.*hypes > 0.*sort hypes desc/);
  assert.match(buildIgdbRequest('discoverySection', { section: 'popular' }).query, /total_rating_count >= 500.*sort total_rating desc/);
});

test('Discovery states distinguish provider failure from a genuine empty result', () => {
  assert.equal(sectionState({ loading: false, items: [], error: null }), 'empty');
  assert.equal(sectionState({ loading: false, items: [], error: 'Provider failed' }), 'error');
  assert.equal(sectionState({ loading: true, items: [{ id: 1 }], error: null }), 'updating');
});

test('Auth observation starts only after persisted owner state is hydrated', async () => {
  const source = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
  assert.match(source, /if \(_hasHydrated\) initAuthSubscription\(\)/);
});

test('Library card actions are independent, keyboard-accessible commands', async () => {
  const source = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(source, /aria-label=\{`Quick actions for \$\{item\.title\}`\}/);
  assert.match(source, /updateMediaStatus\(item, item\.type, status\)/);
  assert.match(source, /mode: 'library'/);
  assert.match(source, /mode: 'log'/);
  assert.match(source, /event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)/);
  assert.doesNotMatch(source, /Library State & Diary/);
});

test('TV quick progress retains state-only semantics and explicit season logging', async () => {
  const sourceStore = await readFile(new URL('../src/store/useMediaStore.js', import.meta.url), 'utf8');
  const sourceUI = await readFile(new URL('../src/components/UI.jsx', import.meta.url), 'utf8');
  assert.match(sourceStore, /updateMediaProgress:[\s\S]*patchItemInCloud\(targetItem, type, patchPayload\)/);
  assert.doesNotMatch(sourceStore.match(/updateMediaProgress:[\s\S]*?toggleIssueRead:/)?.[0] || '', /addDiaryLog|saveMediaWithLog/);
  assert.match(sourceUI, /Complete & Log Season/);
});
