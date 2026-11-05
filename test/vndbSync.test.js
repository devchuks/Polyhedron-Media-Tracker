import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planVndbEntry, vndbDate, vndbMediaKey, vndbRating, vndbSnapshot, vndbStatus } from '../src/domain/vndbSync.js';
import { normalizeVNDB } from '../src/utils/normalizers.js';

const vn = { title: 'AI: Somnium Files - nirvanA Initiative', titles: [{ lang: 'en', title: 'AI: THE SOMNIUM FILES - nirvanA Initiative' }], image: { url: 'https://t.vndb.org/cv/62/75862.jpg', thumbnail: 'https://t.vndb.org/cv.t/62/75862.jpg' }, released: '2022-06-23', rating: 72.3 };
const entry = (overrides = {}) => ({
  id: 'v31469', added: 1_700_000_000, lastmod: 1_791_674_839, vote: null, started: '2022-08-28', finished: null, labels: [{ id: 1 }], vn, ...overrides,
});
const key = vndbMediaKey('v31469');
const plan = options => planVndbEntry({ normalize: normalizeVNDB, now: Date.parse('2026-11-05T12:00:00Z'), ...options });

test('VNDB labels, votes and dates map onto the site\'s statuses, ratings and calendar dates', () => {
  assert.equal(vndbStatus([{ id: 2 }, { id: 7 }]), 'completed');
  assert.equal(vndbStatus([{ id: 1 }]), 'in progress');
  assert.equal(vndbStatus([{ id: 3 }]), 'in progress');
  assert.equal(vndbStatus([{ id: 4 }]), 'dropped');
  assert.equal(vndbStatus([{ id: 5 }]), 'planned');
  assert.equal(vndbStatus([{ id: 6 }]), null);
  assert.equal(vndbRating(85), 9);
  assert.equal(vndbRating(null), 0);
  assert.equal(vndbDate('2022-09-02'), new Date(2022, 8, 2, 12).getTime());
  assert.equal(vndbDate('2022'), null);
  assert.equal(key, 'vndb:vn:v31469');
});

test('finishing on VNDB completes the VN with its dates and adds one Played diary entry', () => {
  const finished = entry({ labels: [{ id: 2 }, { id: 7 }], finished: '2022-09-02', vote: 85, lastmod: 1_791_700_000 });
  const local = { id: 'v31469', type: 'vn', provider: 'vndb', provider_id: 'v31469', media_key: key, status: 'in progress', rating: 0, dateStarted: vndbDate('2022-08-28'), dateCompleted: null, addedAt: 1 };
  const result = plan({ entry: finished, localItem: local, previous: vndbSnapshot(entry()), logs: [] });
  assert.equal(result.media.status, 'completed');
  assert.equal(result.media.dateCompleted, vndbDate('2022-09-02'));
  assert.equal(result.media.rating, 9);
  assert.equal(result.log.log_id, 'vndb-v31469');
  assert.equal(result.log.action_type, 'PLAYED');
  // The same finish seen again changes nothing.
  const again = plan({ entry: finished, localItem: result.media, previous: result.snapshot, logs: [{ ...result.log, media_key: key }] });
  assert.equal(again.media, null);
  assert.equal(again.log, null);
});

test('a VN not yet in the library arrives with its real status; blacklisted entries are skipped', () => {
  const playing = plan({ entry: entry(), localItem: undefined, previous: vndbSnapshot(entry()), logs: [] });
  assert.equal(playing.media.status, 'in progress');
  assert.equal(playing.media.dateStarted, vndbDate('2022-08-28'));
  assert.equal(playing.media.apiData.title, 'AI: THE SOMNIUM FILES - nirvanA Initiative');
  assert.equal(playing.media.addedAt, 1_700_000_000 * 1000);
  assert.equal(plan({ entry: entry({ labels: [{ id: 6 }] }), localItem: undefined, previous: undefined }).media, null);
});

test('only changes made on VNDB apply to a VN already in the library', () => {
  const local = { id: 'v31469', type: 'vn', provider: 'vndb', provider_id: 'v31469', media_key: key, status: 'in progress', rating: 9, dateStarted: vndbDate('2022-08-28'), dateCompleted: null, addedAt: 1 };
  assert.equal(plan({ entry: entry({ lastmod: 1_791_700_100 }), localItem: local, previous: vndbSnapshot(entry()), logs: [] }).media, null);
});

test('sync sections and the on-open sync are for the signed-in owner only, never guest mode', async () => {
  const settings = await readFile(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8');
  for (const card of ['AniListLink', 'LetterboxdLink', 'VndbLink']) assert.match(settings, new RegExp(`\\{store\\.authMode === 'admin' && <${card} />\\}`));
  const layout = await readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8');
  assert.match(layout, /if \(authMode !== 'admin' \|\| !ownerId \|\| isCloudSyncing\) return;/);
  for (const service of ['anilistSync', 'letterboxdSync', 'vndbSync']) {
    const source = await readFile(new URL(`../src/services/${service}.js`, import.meta.url), 'utf8');
    assert.match(source, /state\.authMode !== 'admin'/);
  }
});
