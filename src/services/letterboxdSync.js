// Runs the one-way Letterboxd sync. Linking records the entries already in the feed as seen, so
// only diary entries logged on Letterboxd afterwards are added, each time the site is opened.
import { supabase } from './supabase';
import { useMediaStore, useUIStore } from '../store/useMediaStore';
import { letterboxdMediaKey, planLetterboxdEntry } from '../domain/letterboxdSync';

const storageKey = ownerId => `polyhedron-letterboxd:${ownerId}`;
const MAX_SEEN = 400;

export const readLetterboxdLink = ownerId => {
  if (!ownerId) return null;
  try { return JSON.parse(window.localStorage.getItem(storageKey(ownerId)) || 'null'); }
  catch { return null; }
};

const writeLetterboxdLink = (ownerId, link) => {
  try { window.localStorage.setItem(storageKey(ownerId), JSON.stringify({ ...link, seen: (link.seen || []).slice(-MAX_SEEN) })); }
  catch (error) { console.warn('Letterboxd link could not be saved in this browser:', error?.message || error); }
};

export const unlinkLetterboxd = ownerId => {
  try { window.localStorage.removeItem(storageKey(ownerId)); } catch { /* nothing stored */ }
};

export const normalizeLetterboxdUsername = value => String(value || '').trim()
  .replace(/^https?:\/\/(www\.)?letterboxd\.com\//iu, '')
  .replace(/\/.*$/u, '');

export const fetchLetterboxdEntries = async username => {
  const { data, error } = await supabase.functions.invoke('letterboxd', { body: { username } });
  if (error) throw error;
  if (!Array.isArray(data?.entries)) throw new Error('Letterboxd feed could not be read');
  return data.entries;
};

// Links a username and marks everything currently in its feed as already seen.
export const linkLetterboxd = async ({ ownerId, username }) => {
  const entries = await fetchLetterboxdEntries(username);
  writeLetterboxdLink(ownerId, { username, linkedAt: Date.now(), seen: entries.map(entry => entry.guid) });
  return entries.length;
};

let checkedOwner = null;
let running = null;

export const syncLetterboxdNow = ownerId => {
  checkedOwner = null;
  return syncLetterboxdOnOpen(ownerId);
};

export const syncLetterboxdOnOpen = ownerId => {
  const link = readLetterboxdLink(ownerId);
  if (!link?.username || checkedOwner === ownerId) return running || Promise.resolve(null);
  checkedOwner = ownerId;
  running = (async () => {
    try {
      const entries = await fetchLetterboxdEntries(link.username);
      const seen = new Set(link.seen || []);
      const fresh = entries.filter(entry => entry.guid && !seen.has(entry.guid)).reverse(); // oldest first
      let applied = 0;
      let failed = 0;
      for (const entry of fresh) {
        const state = useMediaStore.getState();
        if (state.ownerId !== ownerId || state.authMode !== 'admin') break;
        const key = letterboxdMediaKey(entry.tmdbId);
        const localItem = state.media.movies?.find(item => item.media_key === key);
        const deletedAt = Number(state.deletedMediaKeys?.[key]) || 0;
        // A film deleted on Polyhedron after this entry was logged on Letterboxd stays deleted.
        if (!localItem && deletedAt && (entry.publishedAt || 0) <= deletedAt) { seen.add(entry.guid); continue; }
        try {
          const plan = planLetterboxdEntry({ entry, localItem, logs: state.mediaLogs });
          const store = useMediaStore.getState();
          if (plan.media && plan.log) await store.saveMediaWithLog(plan.media, 'movies', plan.log);
          else if (plan.media) await store.saveMediaItem(plan.media, 'movies');
          if (plan.logUpdate) store.updateDiaryLog(plan.logUpdate.log_id, plan.logUpdate.patch);
          if (plan.media || plan.log || plan.logUpdate) applied += 1;
          seen.add(entry.guid);
        } catch (error) {
          failed += 1;
          console.error(`Letterboxd sync could not save ${entry.title}:`, error);
        }
      }
      writeLetterboxdLink(ownerId, { ...link, seen: [...seen], ...(applied ? { lastSyncedAt: Date.now() } : {}) });
      if (applied) useUIStore.getState().addToast(`Synced ${applied} film${applied === 1 ? '' : 's'} from Letterboxd.`, 'success');
      if (failed) useUIStore.getState().addToast('Some Letterboxd entries could not be saved; they will retry next time.', 'error');
      return { applied, failed };
    } catch (error) {
      console.warn('Letterboxd check failed:', error?.message || error);
      checkedOwner = null;
      return null;
    } finally {
      running = null;
    }
  })();
  return running;
};
