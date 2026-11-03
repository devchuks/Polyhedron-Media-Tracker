// Runs the one-way AniList sync: linking (with an optional first import) and the check made
// each time the site is opened. Writes go through the store's normal owner-scoped save actions.
import { useMediaStore, useUIStore } from '../store/useMediaStore';
import { normalizeAniList } from '../utils/normalizers';
import { anilistMediaKey, anilistSnapshot, planAniListEntry, previewAniListImport } from '../domain/anilistSync';
import { fetchAniListChanges, fetchAniListLibrary } from './anilistClient';

const storageKey = ownerId => `polyhedron-anilist:${ownerId}`;

export const readAniListLink = ownerId => {
  if (!ownerId) return null;
  try { return JSON.parse(window.localStorage.getItem(storageKey(ownerId)) || 'null'); }
  catch { return null; }
};

const writeAniListLink = (ownerId, link) => {
  try { window.localStorage.setItem(storageKey(ownerId), JSON.stringify(link)); }
  catch (error) { console.warn('AniList link could not be saved in this browser:', error?.message || error); }
};

export const unlinkAniList = ownerId => {
  try { window.localStorage.removeItem(storageKey(ownerId)); } catch { /* nothing stored */ }
};

const libraryIndex = state => new Map(['anime', 'manga'].flatMap(type => (state.media[type] || []).map(item => [item.media_key, item])));

let running = null;
const exclusive = operation => {
  if (running) return running;
  running = Promise.resolve().then(operation).finally(() => { running = null; });
  return running;
};

// Applies entries oldest-first and returns the counts plus each type's safe "checked up to" time.
const applyEntries = async (ownerId, link, items, { createHistory }) => {
  let applied = 0;
  let failed = 0;
  const cursor = { ...(link.cursor || {}) };
  const firstFailure = {};
  for (const { type, entry } of items) {
    const state = useMediaStore.getState();
    if (state.ownerId !== ownerId || state.authMode !== 'admin') break;
    const key = anilistMediaKey(type, entry.mediaId ?? entry.media?.id);
    const localItem = state.media[type]?.find(item => item.media_key === key);
    const deletedAt = Number(state.deletedMediaKeys?.[key]) || 0;
    // A title deleted on Polyhedron stays deleted unless it changes on AniList afterwards.
    const skipDeleted = !localItem && deletedAt && Number(entry.updatedAt) * 1000 <= deletedAt;
    try {
      const plan = skipDeleted
        ? { media: null, log: null, logUpdate: null, snapshot: anilistSnapshot(entry) }
        : planAniListEntry({
          entry, type, localItem, previous: link.entries?.[entry.id], logs: state.mediaLogs, createHistory, normalize: normalizeAniList,
        });
      const store = useMediaStore.getState();
      if (plan.media && plan.log) await store.saveMediaWithLog(plan.media, type, plan.log);
      else if (plan.media) await store.saveMediaItem(plan.media, type);
      if (plan.logUpdate) store.updateDiaryLog(plan.logUpdate.log_id, plan.logUpdate.patch);
      if (plan.media || plan.log || plan.logUpdate) applied += 1;
      link.entries = { ...(link.entries || {}), [entry.id]: plan.snapshot };
      if (firstFailure[type] === undefined) cursor[type] = Math.max(Number(cursor[type]) || 0, Number(entry.updatedAt) || 0);
    } catch (error) {
      failed += 1;
      if (firstFailure[type] === undefined) firstFailure[type] = Number(entry.updatedAt) || 0;
      console.error(`AniList sync could not save ${entry.media?.title?.romaji || entry.mediaId}:`, error);
    }
  }
  link.cursor = cursor;
  return { applied, failed };
};

// Fetches the whole list once and summarises what an import would do.
export const previewAniListLink = async username => {
  const entries = await fetchAniListLibrary(username);
  const counts = previewAniListImport(entries, libraryIndex(useMediaStore.getState()), normalizeAniList);
  return { entries, counts };
};

/**
 * Links an AniList username. `mode` 'import' applies the whole list now; 'track' only records the
 * current list so later AniList changes sync. `createHistory` adds diary entries for past finishes.
 */
export const linkAniList = ({ ownerId, username, entries, mode, createHistory = false }) => exclusive(async () => {
  const link = { username, linkedAt: Date.now(), cursor: {}, entries: {} };
  let result = { applied: 0, failed: 0 };
  if (mode === 'import') {
    const ordered = [...entries].sort((a, b) => Number(a.entry.updatedAt) - Number(b.entry.updatedAt));
    result = await applyEntries(ownerId, link, ordered, { createHistory });
  } else {
    for (const { type, entry } of entries) {
      link.entries[entry.id] = anilistSnapshot(entry);
      link.cursor[type] = Math.max(Number(link.cursor[type]) || 0, Number(entry.updatedAt) || 0);
    }
  }
  writeAniListLink(ownerId, link);
  return result;
});

let checkedOwner = null;

// "Check now" from Settings: runs the same check again even if it already ran this visit.
export const syncAniListNow = ownerId => {
  checkedOwner = null;
  return syncAniListOnOpen(ownerId);
};

// The check made when the site opens: only entries changed on AniList since the last check.
export const syncAniListOnOpen = ownerId => {
  const link = readAniListLink(ownerId);
  if (!link?.username || checkedOwner === ownerId) return Promise.resolve(null);
  checkedOwner = ownerId;
  return exclusive(async () => {
    try {
      const changes = await fetchAniListChanges(link.username, link.cursor);
      if (!changes.length) return { applied: 0, failed: 0 };
      const result = await applyEntries(ownerId, link, changes, { createHistory: true });
      writeAniListLink(ownerId, { ...link, lastSyncedAt: Date.now() });
      if (result.applied) {
        useUIStore.getState().addToast(`Synced ${result.applied} update${result.applied === 1 ? '' : 's'} from AniList.`, 'success');
      }
      if (result.failed) useUIStore.getState().addToast('Some AniList updates could not be saved; they will retry next time.', 'error');
      return result;
    } catch (error) {
      console.warn('AniList check failed:', error?.message || error);
      checkedOwner = null;
      return null;
    }
  });
};
