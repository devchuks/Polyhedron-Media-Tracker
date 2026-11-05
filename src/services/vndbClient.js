// Read-only access to a public VNDB list (https://api.vndb.org/kana). No login is needed and
// nothing is ever written to VNDB.
import { apiClient } from '../utils/apiClient';

const VNDB_URL = 'https://api.vndb.org/kana';
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const ENTRY_FIELDS = 'id, added, lastmod, vote, started, finished, labels.id, '
  + 'vn.title, vn.titles.lang, vn.titles.title, vn.titles.latin, vn.image.url, vn.image.thumbnail, vn.released, vn.rating';

export const normalizeVndbUsername = value => String(value || '').trim()
  .replace(/^https?:\/\/(www\.)?vndb\.org\//iu, '')
  .replace(/\/.*$/u, '');

// Resolves a username (or a "u123" id) to the VNDB user id.
export const fetchVndbUserId = async username => {
  if (/^u\d+$/u.test(username)) return username;
  const data = await apiClient(`${VNDB_URL}/user?q=${encodeURIComponent(username)}`, { headers: { Accept: 'application/json' } });
  const user = Object.values(data || {})[0];
  if (!user?.id) throw new Error('VNDB user not found');
  return user.id;
};

const listPage = (userId, page, extra = {}) => apiClient(`${VNDB_URL}/ulist`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ user: userId, fields: ENTRY_FIELDS, results: PAGE_SIZE, page, ...extra }),
});

// Every entry on the list, for linking.
export const fetchVndbList = async userId => {
  const entries = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await listPage(userId, page);
    entries.push(...(data?.results || []));
    if (!data?.more) break;
  }
  return entries;
};

// Entries changed after `sinceSeconds`, returned oldest first so later changes win.
export const fetchVndbChanges = async (userId, sinceSeconds = 0) => {
  const entries = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await listPage(userId, page, { sort: 'lastmod', reverse: true });
    const results = data?.results || [];
    const fresh = results.filter(entry => Number(entry.lastmod) > Number(sinceSeconds));
    entries.push(...fresh);
    if (fresh.length < results.length || !data?.more) break;
  }
  return entries.sort((a, b) => Number(a.lastmod) - Number(b.lastmod));
};
