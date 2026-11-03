// Read-only access to a public AniList list (https://graphql.anilist.co). No login is needed for
// public lists, and nothing is ever written to AniList.
import { apiClient } from '../utils/apiClient';
import { ANILIST_TYPES } from '../domain/anilistSync';

const ANILIST_URL = 'https://graphql.anilist.co';
const MAX_CHANGE_PAGES = 10;

const ENTRY_FIELDS = `
  id mediaId status score(format: POINT_10_DECIMAL) progress repeat updatedAt createdAt
  startedAt { year month day } completedAt { year month day }
  media {
    id format episodes chapters averageScore siteUrl genres
    title { english romaji native }
    coverImage { extraLarge large }
    startDate { year month day }
  }`;

const query = async (graphql, variables) => {
  const json = await apiClient(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: graphql, variables }),
  });
  if (json?.errors?.length) throw new Error(json.errors[0]?.message || 'AniList request failed');
  return json?.data;
};

export const normalizeAniListUsername = value => String(value || '').trim()
  .replace(/^https?:\/\/(www\.)?anilist\.co\/user\//iu, '')
  .replace(/\/.*$/u, '');

export const fetchAniListUser = async username => {
  const data = await query('query ($name: String) { User(name: $name) { id name } }', { name: username });
  return data?.User || null;
};

// Every entry in the user's anime and manga lists, for linking and the first import.
export const fetchAniListLibrary = async username => {
  const results = [];
  for (const [type, aniType] of Object.entries(ANILIST_TYPES)) {
    const data = await query(`query ($name: String, $type: MediaType) {
      MediaListCollection(userName: $name, type: $type) { lists { entries { ${ENTRY_FIELDS} } } }
    }`, { name: username, type: aniType });
    const seen = new Set();
    for (const list of data?.MediaListCollection?.lists || []) {
      for (const entry of list.entries || []) {
        if (seen.has(entry.id)) continue; // custom lists repeat entries
        seen.add(entry.id);
        results.push({ type, entry });
      }
    }
  }
  return results;
};

// Entries changed after `sinceSeconds`, newest first, stopping at the first already-seen change.
export const fetchAniListChanges = async (username, sinceByType = {}) => {
  const results = [];
  for (const [type, aniType] of Object.entries(ANILIST_TYPES)) {
    const since = Number(sinceByType[type]) || 0;
    for (let page = 1; page <= MAX_CHANGE_PAGES; page += 1) {
      const data = await query(`query ($name: String, $type: MediaType, $page: Int) {
        Page(page: $page, perPage: 50) {
          pageInfo { hasNextPage }
          mediaList(userName: $name, type: $type, sort: UPDATED_TIME_DESC) { ${ENTRY_FIELDS} }
        }
      }`, { name: username, type: aniType, page });
      const entries = data?.Page?.mediaList || [];
      const fresh = entries.filter(entry => Number(entry.updatedAt) > since);
      results.push(...fresh.map(entry => ({ type, entry })));
      if (fresh.length < entries.length || !data?.Page?.pageInfo?.hasNextPage) break;
    }
  }
  // Apply oldest changes first so later changes win.
  return results.sort((a, b) => Number(a.entry.updatedAt) - Number(b.entry.updatedAt));
};
