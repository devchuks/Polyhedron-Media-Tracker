// Runs the one-way VNDB sync: linking (which records the current list as already seen) and the
// check made each time the site is opened. Writes go through the store's owner-scoped save actions.
import { useMediaStore, useUIStore } from '../store/useMediaStore';
import { normalizeVNDB } from '../utils/normalizers';
import { planVndbEntry, vndbMediaKey, vndbSnapshot } from '../domain/vndbSync';
import { fetchVndbChanges, fetchVndbList, fetchVndbUserId } from './vndbClient';

const storageKey = ownerId => `polyhedron-vndb:${ownerId}`;

export const readVndbLink = ownerId => {
  if (!ownerId) return null;
  try { return JSON.parse(window.localStorage.getItem(storageKey(ownerId)) || 'null'); }
  catch { return null; }
};

const writeVndbLink = (ownerId, link) => {
  try { window.localStorage.setItem(storageKey(ownerId), JSON.stringify(link)); }
  catch (error) { console.warn('VNDB link could not be saved in this browser:', error?.message || error); }
};

export const unlinkVndb = ownerId => {
  try { window.localStorage.removeItem(storageKey(ownerId)); } catch { /* nothing stored */ }
};

let running = null;
const exclusive = operation => {
  if (running) return running;
  running = Promise.resolve().then(operation).finally(() => { running = null; });
  return running;
};

// Links a VNDB user: everything on the list now is recorded as already seen. Returns the entry count.
export const linkVndb = ({ ownerId, username }) => exclusive(async () => {
  const userId = await fetchVndbUserId(username);
  const entries = await fetchVndbList(userId);
  const link = { username, userId, linkedAt: Date.now(), cursor: 0, entries: {} };
  for (const entry of entries) {
    link.entries[entry.id] = vndbSnapshot(entry);
    link.cursor = Math.max(link.cursor, Number(entry.lastmod) || 0);
  }
  writeVndbLink(ownerId, link);
  return entries.length;
});

let checkedOwner = null;

export const syncVndbNow = ownerId => {
  checkedOwner = null;
  return syncVndbOnOpen(ownerId);
};

// The check made when the site opens: only entries changed on VNDB since the last check.
export const syncVndbOnOpen = ownerId => {
  const link = readVndbLink(ownerId);
  if (!link?.userId || checkedOwner === ownerId) return Promise.resolve(null);
  checkedOwner = ownerId;
  return exclusive(async () => {
    try {
      const changes = await fetchVndbChanges(link.userId, link.cursor);
      let applied = 0;
      let failed = 0;
      let cursor = Number(link.cursor) || 0;
      let blocked = false;
      for (const entry of changes) {
        const state = useMediaStore.getState();
        if (state.ownerId !== ownerId || state.authMode !== 'admin') break;
        const key = vndbMediaKey(entry.id);
        const localItem = state.media.vn?.find(item => item.media_key === key);
        const deletedAt = Number(state.deletedMediaKeys?.[key]) || 0;
        try {
          // A VN deleted on Polyhedron stays deleted unless it changes on VNDB afterwards.
          const plan = !localItem && deletedAt && Number(entry.lastmod) * 1000 <= deletedAt
            ? { media: null, log: null, logUpdate: null, snapshot: vndbSnapshot(entry) }
            : planVndbEntry({ entry, localItem, previous: link.entries?.[entry.id], logs: state.mediaLogs, normalize: normalizeVNDB });
          const store = useMediaStore.getState();
          if (plan.media && plan.log) await store.saveMediaWithLog(plan.media, 'vn', plan.log);
          else if (plan.media) await store.saveMediaItem(plan.media, 'vn');
          if (plan.logUpdate) store.updateDiaryLog(plan.logUpdate.log_id, plan.logUpdate.patch);
          if (plan.media || plan.log || plan.logUpdate) applied += 1;
          link.entries = { ...(link.entries || {}), [entry.id]: plan.snapshot };
          if (!blocked) cursor = Math.max(cursor, Number(entry.lastmod) || 0);
        } catch (error) {
          failed += 1;
          blocked = true; // Do not move the cursor past a change that has not been saved.
          console.error(`VNDB sync could not save ${entry.vn?.title || entry.id}:`, error);
        }
      }
      writeVndbLink(ownerId, { ...link, cursor, ...(applied ? { lastSyncedAt: Date.now() } : {}) });
      if (applied) useUIStore.getState().addToast(`Synced ${applied} update${applied === 1 ? '' : 's'} from VNDB.`, 'success');
      if (failed) useUIStore.getState().addToast('Some VNDB updates could not be saved; they will retry next time.', 'error');
      return { applied, failed };
    } catch (error) {
      console.warn('VNDB check failed:', error?.message || error);
      checkedOwner = null;
      return null;
    }
  });
};
