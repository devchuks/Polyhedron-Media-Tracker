import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from '../services/supabase';
import { canonicalizeLog, canonicalizeMediaItem, mediaKeyFor } from '../domain/mediaIdentity';
import { applyStatusTransition, canonicalizeMediaCollection, mergeProviderMetadata, toggleIssueState, upsertDiaryLog } from '../domain/mediaState';
import { applyActivityLifecycle, isMeaningfulProgress } from '../domain/activityLifecycle';
import { normalizeBackup } from '../domain/backup';
import { mergeLibraryState, mergePersistedSnapshots, nextRecordRevision } from '../domain/persistenceMerge';
import { createKeyedQueue } from '../utils/keyedQueue';
import { fetchPaginatedRows } from '../services/cloudPagination';
import { retryAfterJwtRefresh } from '../utils/requestErrors';
import { createSingleFlight } from '../utils/singleFlight';
import {
  GUEST_SHOWCASE_VERSION,
  createIsolatedAuthenticatedSnapshot,
  markGuestShowcaseInitialized,
  readGuestShowcaseVersion,
  resolveGuestInitialization,
  snapshotGuestState,
} from '../domain/guestShowcase';

const initialMediaState = { tv: [], movies: [], games: [], vn: [], anime: [], manga: [], books: [], comics: [] };
const freshMediaState = () => Object.fromEntries(Object.keys(initialMediaState).map(key => [key, []]));
let authGeneration = 0;
const cloudMutationQueue = createKeyedQueue();
const hydrationFlights = createSingleFlight();
const queueMediaMutation = (mediaKey, operation) => cloudMutationQueue.enqueue(`media:${mediaKey}`, operation);
const queueLogMutation = (log, operation) => cloudMutationQueue.enqueue(
  log?.media_key ? `media:${log.media_key}` : `log:${String(log?.log_id ?? log)}`,
  operation,
);
const nextStorageEpoch = current => Math.max(Date.now(), (Number(current) || 0) + 1);
const browserLocalStorage = () => typeof window !== 'undefined' ? window.localStorage : null;

const fetchCloudTable = (table, userId, orderColumn, maxRows, {
  columns = '*',
  pageSize = 500,
  revisionColumn = 'updated_at',
} = {}) => {
  const fetchPage = (selectColumns, from, to, includeCount) => {
    const query = supabase.from(table).select(selectColumns, includeCount ? { count: 'exact' } : {})
      .eq('user_id', userId)
      .order(orderColumn, { ascending: true })
      .range(from, to);
    return query;
  };
  const rowFingerprint = row => `${String(row[orderColumn])}:${String(row[revisionColumn] || '')}`;
  return fetchPaginatedRows(
    (from, to, includeCount) => fetchPage(columns, from, to, includeCount),
    {
      pageSize,
      maxRows,
      getRowKey: row => row[orderColumn],
      getRowRevision: row => row[revisionColumn],
      validateRows: async rows => {
        const validationRows = await fetchPaginatedRows(
          (from, to, includeCount) => fetchPage(`${orderColumn},${revisionColumn}`, from, to, includeCount),
          {
            pageSize: 1_000,
            maxRows,
            maxAttempts: 2,
            getRowKey: row => row[orderColumn],
            getRowRevision: row => row[revisionColumn],
          },
        );
        return rows.length === validationRows.length
          && rows.every((row, index) => rowFingerprint(row) === rowFingerprint(validationRows[index]));
      },
    },
  );
};
const hasLocalSnapshot = state => Object.values(state.media || {}).some(items => items?.length)
  || Boolean(state.mediaLogs?.length);
const reportLocalPersistenceError = error => {
  console.error('Local persistence failed:', error);
  queueMicrotask(() => useUIStore.getState().addToast('Local storage failed. This change may not survive a reload.', 'error'));
};

// 1. Singleton Database Connection to stop I/O thrashing
let dbPromise = null;
const getDB = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('polyhedron-db', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('keyval')) request.result.createObjectStore('keyval');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        const error = request.error || new Error('Unable to open local database');
        reportLocalPersistenceError(error);
        reject(error);
      };
    });
  }
  return dbPromise;
};

const idbSyncChannel = typeof window !== 'undefined' && window.BroadcastChannel ? new BroadcastChannel('polyhedron-idb-sync') : null;
if (idbSyncChannel) {
  idbSyncChannel.onmessage = (e) => {
    // Rehydrate a record-merged snapshot written by another tab.
    if (e.data === 'IDB_UPDATED') useMediaStore.persist.rehydrate();
  };
}

const idbStorage = {
  getItem: async (name) => {
    const db = await getDB();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readonly');
      const store = tx.objectStore('keyval');
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        reportLocalPersistenceError(error);
        reject(error);
      };
      const getReq = store.get(name);
      getReq.onsuccess = () => { settled = true; resolve(getReq.result || null); };
      getReq.onerror = () => fail(getReq.error || new Error('Unable to read local state'));
      tx.onerror = () => fail(tx.error || new Error('Unable to read local state'));
      tx.onabort = () => fail(tx.error || new Error('Local read transaction was aborted'));
    });
  },
  setItem: async (name, value) => {
    const db = await getDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readwrite');
      const store = tx.objectStore('keyval');
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        reportLocalPersistenceError(error);
        reject(error);
      };
      const readRequest = store.get(name);
      let mergedValue = value;
      readRequest.onsuccess = () => {
        mergedValue = mergePersistedSnapshots(readRequest.result, value);
        store.put(mergedValue, name);
      };
      readRequest.onerror = () => tx.abort();
      tx.oncomplete = () => {
        settled = true;
        if (idbSyncChannel) idbSyncChannel.postMessage('IDB_UPDATED');
        else {
          try { localStorage.setItem('polyhedron-idb-pulse', `${Date.now()}:${Math.random()}`); }
          catch { console.warn('Cross-tab synchronization is unavailable in this browser.'); }
        }
        if (mergedValue !== value) queueMicrotask(() => useMediaStore.persist.rehydrate());
        resolve();
      };
      tx.onerror = () => fail(tx.error || new Error('Unable to persist local state'));
      tx.onabort = () => fail(tx.error || new Error('Local persistence transaction was aborted'));
    });
  },
  removeItem: async (name) => {
    const db = await getDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readwrite');
      const store = tx.objectStore('keyval');
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        reportLocalPersistenceError(error);
        reject(error);
      };
      store.delete(name);
      tx.oncomplete = () => {
        settled = true;
        if (idbSyncChannel) idbSyncChannel.postMessage('IDB_UPDATED');
        resolve();
      };
      tx.onerror = () => fail(tx.error || new Error('Unable to clear local state'));
      tx.onabort = () => fail(tx.error || new Error('Local clear transaction was aborted'));
    });
  },
};

const normalizeCloudItem = item => canonicalizeMediaItem({
  ...item,
  addedAt: item.addedAt ?? item.addedat,
  dateStarted: item.dateStarted ?? item.datestarted,
  dateCompleted: item.dateCompleted ?? item.datecompleted,
  rewatchCount: item.rewatchCount ?? item.rewatchcount,
      readIssueIds: item.readIssueIds ?? item.readissueids ?? [],
      apiData: item.apiData ?? item.apidata ?? {},
      updatedAt: Number.isFinite(Date.parse(item.updated_at)) ? Date.parse(item.updated_at) : (item.updatedAt || 0),
}, item.media_type || item.type);

const mediaCloudRow = (item, category, userId) => {
  const canonical = canonicalizeMediaItem(item, category);
  return {
    id: String(canonical.id),
    user_id: userId,
    provider: canonical.provider,
    provider_id: canonical.provider_id,
    media_type: canonical.type,
    media_key: canonical.media_key,
    title: canonical.title,
    type: canonical.type,
    subtype: canonical.subtype || null,
    progress: canonical.progress || null,
    status: canonical.status || 'planned',
    rating: canonical.rating || 0,
    addedAt: canonical.addedAt || Date.now(),
    dateStarted: canonical.dateStarted || null,
    dateCompleted: canonical.dateCompleted || null,
    rewatchCount: canonical.rewatchCount || 0,
    readIssueIds: canonical.readIssueIds || [],
    image: canonical.image || null,
    apiData: canonical.apiData || {},
    updated_at: new Date(canonical.updatedAt || Date.now()).toISOString(),
  };
};

export const useMediaStore = create(
  persist(
    (set, get) => ({
      _hasHydrated: false,
      setHasHydrated: (state) => set({ _hasHydrated: state }),

      authMode: null,
      ownerId: null,
      storageEpoch: 0,
      guestSnapshot: null,
      guestSeedVersion: 0,
      authSubscription: null,
      isLoading: true,
      setAuthMode: async (mode, knownUser = null) => {
        const generation = ++authGeneration;
        if (mode === 'admin') {
          const guestSnapshot = get().ownerId === 'guest' ? snapshotGuestState(get()) : get().guestSnapshot;
          const authResult = knownUser ? { data: { user: knownUser }, error: null } : await supabase.auth.getUser();
          const { data, error } = authResult;
          if (error || !data?.user || generation !== authGeneration) {
            if (get().clearRealtimeSubscription) get().clearRealtimeSubscription();
            set({ authMode: null, ownerId: null, guestSnapshot, storageEpoch: nextStorageEpoch(get().storageEpoch), isCloudSyncing: false, isLoading: false, media: freshMediaState(), mediaLogs: [], deletedMediaKeys: {}, deletedLogIds: {} });
            return false;
          }
          const ownerChanged = get().ownerId !== data.user.id;
          const canUseCachedSnapshot = !ownerChanged && hasLocalSnapshot(get());
          const isolatedOwnerSnapshot = createIsolatedAuthenticatedSnapshot();
          if (ownerChanged && get().clearRealtimeSubscription) get().clearRealtimeSubscription();
          set({
            authMode: mode,
            ownerId: data.user.id,
            guestSnapshot,
            storageEpoch: ownerChanged ? nextStorageEpoch(get().storageEpoch) : get().storageEpoch,
            ...(ownerChanged ? isolatedOwnerSnapshot : {}),
            isCloudSyncing: true,
            isLoading: !canUseCachedSnapshot,
          });
          get().fetchCloudData(data.user, generation).then(synced => {
            if (generation === authGeneration) {
              if (synced) get().initRealtimeSubscription(data.user);
              else set({ isCloudSyncing: false, isLoading: false });
            }
          });
          return true;
        } else {
          if (get().clearRealtimeSubscription) get().clearRealtimeSubscription();
          const nextOwner = mode === 'guest' ? 'guest' : null;
          const ownerChanged = get().ownerId !== nextOwner || mode === null;
          const previousGuestSnapshot = get().ownerId === 'guest' ? snapshotGuestState(get()) : get().guestSnapshot;
          const seededVersion = Math.max(get().guestSeedVersion || 0, readGuestShowcaseVersion(browserLocalStorage()));
          const guestResolution = mode === 'guest' ? resolveGuestInitialization({
            currentOwnerId: get().ownerId,
            currentState: get(),
            savedGuestSnapshot: previousGuestSnapshot,
            seededVersion,
          }) : null;
          if (mode === 'guest') markGuestShowcaseInitialized(browserLocalStorage());
          set({
            authMode: mode,
            ownerId: nextOwner,
            guestSnapshot: mode === 'guest' ? guestResolution.snapshot : previousGuestSnapshot,
            guestSeedVersion: mode === 'guest' ? GUEST_SHOWCASE_VERSION : get().guestSeedVersion,
            storageEpoch: ownerChanged ? nextStorageEpoch(get().storageEpoch) : get().storageEpoch,
            media: mode === 'guest' ? guestResolution.snapshot.media : freshMediaState(),
            mediaLogs: mode === 'guest' ? guestResolution.snapshot.mediaLogs : [],
            deletedMediaKeys: mode === 'guest' ? guestResolution.snapshot.deletedMediaKeys : {},
            deletedLogIds: mode === 'guest' ? guestResolution.snapshot.deletedLogIds : {},
            isCloudSyncing: false,
            isLoading: false,
          });
          return true;
        }
      },
      restoreSession: async () => {
        const { data, error } = await supabase.auth.getUser();
        if (!error && data?.user) {
          if (get().authMode === 'admin' && get().ownerId === data.user.id) return true;
          return get().setAuthMode('admin', data.user);
        }
        if (get().ownerId === 'guest') {
          set({ authMode: 'guest', isCloudSyncing: false, isLoading: false });
          return true;
        }
        await get().setAuthMode(null);
        return false;
      },
      initAuthSubscription: () => {
        if (get().authSubscription) return;
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          if ((event === 'SIGNED_OUT' || !session?.user) && get().authMode === 'admin') {
            void get().setAuthMode(null);
          }
          if (session?.user && ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) {
            const listenerGeneration = authGeneration;
            setTimeout(() => {
              if (listenerGeneration !== authGeneration) return;
              if (session.user.id !== get().ownerId) void get().setAuthMode('admin', session.user);
            }, 0);
          }
        });
        set({ authSubscription: data.subscription });
      },

      // --- CLOUD SYNC HELPERS ---
      isCloudSyncing: false,
      fetchCloudData: async (knownUser, expectedGeneration = authGeneration, replaceLocal = false) => {
        const user = knownUser || (await supabase.auth.getUser()).data?.user;
        if (!user) return false;
        const flightKey = `${expectedGeneration}:${user.id}:${replaceLocal ? 'replace' : 'merge'}`;
        return hydrationFlights.run(flightKey, async () => {
          set({
            isCloudSyncing: true,
            isLoading: replaceLocal || !hasLocalSnapshot(get()),
          });
          try {
            if (!user || expectedGeneration !== authGeneration || get().authMode !== 'admin' || get().ownerId !== user.id) return false;

            const loadSnapshot = () => Promise.all([
              // Keep the complete application row so a fresh browser does not need N+1 detail requests.
              // Chunking bounds each response while the lightweight revision pass validates consistency.
              fetchCloudTable('media_library', user.id, 'library_row_id', 160_000, { pageSize: 250 }),
              fetchCloudTable('media_logs', user.id, 'log_id', 500_000, { pageSize: 500 }),
              fetchCloudTable('media_tombstones', user.id, 'media_key', 160_000, { pageSize: 1_000, revisionColumn: 'deleted_at' }),
              fetchCloudTable('log_tombstones', user.id, 'log_id', 500_000, { pageSize: 1_000, revisionColumn: 'deleted_at' }),
            ]);
            const [libraryData, logsData, mediaTombstones, logTombstones] = await retryAfterJwtRefresh(
              loadSnapshot,
              () => supabase.auth.refreshSession(),
            );
            if (expectedGeneration !== authGeneration || get().authMode !== 'admin' || get().ownerId !== user.id) return false;

            const cloudMedia = freshMediaState();
            (libraryData || []).forEach(item => {
              const normalizedItem = normalizeCloudItem(item);
              if (cloudMedia[normalizedItem.type]) cloudMedia[normalizedItem.type].push(normalizedItem);
            });
            const cloudState = {
              media: cloudMedia,
              mediaLogs: (logsData || []).map(log => canonicalizeLog({
                ...log,
                updatedAt: Number.isFinite(Date.parse(log.updated_at)) ? Date.parse(log.updated_at) : 0,
              })),
              deletedMediaKeys: Object.fromEntries((mediaTombstones || []).map(row => [row.media_key, Date.parse(row.deleted_at) || 0])),
              deletedLogIds: Object.fromEntries((logTombstones || []).map(row => [String(row.log_id), Date.parse(row.deleted_at) || 0])),
            };
            const mergeBase = replaceLocal
              ? { media: freshMediaState(), mediaLogs: [], deletedMediaKeys: {}, deletedLogIds: {} }
              : get();
            set(mergeLibraryState(mergeBase, cloudState));
            return true;
          } catch (error) {
            console.error('Cloud snapshot failed:', error);
            useUIStore.getState().addToast('Cloud synchronization failed. Local data was not replaced.', 'error');
            return false;
          } finally {
            if (expectedGeneration === authGeneration) set({ isCloudSyncing: false, isLoading: false });
          }
        });
      },

      realtimeSubscription: null,
      initRealtimeSubscription: async (knownUser) => {
        if (get().realtimeSubscription) return; // Prevent duplicate connections
        const user = knownUser || (await supabase.auth.getUser()).data?.user;
        if (!user || get().authMode !== 'admin') return;
        const channel = supabase.channel(`polyhedron-sync-${user.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'media_library', filter: `user_id=eq.${user.id}` }, (payload) => {
            const { eventType, new: rawRecord, old: oldRecord } = payload;
            let targetKey;
            try { targetKey = mediaKeyFor(eventType === 'DELETE' ? oldRecord : rawRecord, rawRecord?.type || oldRecord?.type); }
            catch {
              const deletedRowId = oldRecord?.library_row_id;
              if (eventType === 'DELETE' && deletedRowId) {
                for (const items of Object.values(get().media)) {
                  const match = items.find(item => item.library_row_id === deletedRowId);
                  if (match) { targetKey = match.media_key; break; }
                }
              }
              if (!targetKey) { void get().fetchCloudData(user); return; }
            }
            set((state) => {
              const newMedia = { ...state.media };
              if (eventType === 'DELETE') {
                for (const key in newMedia) newMedia[key] = newMedia[key].filter(m => mediaKeyFor(m, key) !== targetKey);
                return {
                  media: newMedia,
                  mediaLogs: state.mediaLogs.filter(log => log.media_key !== targetKey),
                };
              } else {
                const type = rawRecord.type || oldRecord?.type;
                if (!type) return state; // Ignore corrupted payloads
                const normalizedRecord = normalizeCloudItem(rawRecord);
                const existingItem = state.media[type]?.find(m => mediaKeyFor(m, type) === targetKey);
                if ((state.deletedMediaKeys[targetKey] || 0) >= (normalizedRecord.updatedAt || 0)) return state;
                if ((existingItem?.updatedAt || 0) > (normalizedRecord.updatedAt || 0)) return state;
                const deletedMediaKeys = { ...state.deletedMediaKeys };
                delete deletedMediaKeys[targetKey];
                const newRecord = {
                  ...existingItem, // 2. Protect existing local fields (like TOAST columns) from being erased
                  ...normalizedRecord,
                  apiData: (normalizedRecord.apiData && Object.keys(normalizedRecord.apiData).length > 0) ? normalizedRecord.apiData :
                           existingItem?.apiData ?? {},
                };
                if (newMedia[type]) {
                  newMedia[type] = [...newMedia[type]]; // 3. Fix Array Mutation Trap to force React to re-render
                  const index = newMedia[type].findIndex(m => mediaKeyFor(m, type) === targetKey);
                  if (index !== -1) newMedia[type][index] = { ...newMedia[type][index], ...newRecord };
                  else newMedia[type] = [newRecord, ...newMedia[type]];
                }
                return { media: newMedia, deletedMediaKeys };
              }
            });
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'media_logs', filter: `user_id=eq.${user.id}` }, (payload) => {
            const { eventType, new: newRecord, old: oldRecord } = payload;
            set((state) => {
              let newLogs = [...state.mediaLogs];
              if (eventType === 'DELETE') {
                const logId = String(oldRecord.log_id);
                return {
                  mediaLogs: newLogs.filter(l => String(l.log_id) !== logId),
                };
              }
              else {
                const canonicalRecord = canonicalizeLog({
                  ...newRecord,
                  updatedAt: Number.isFinite(Date.parse(newRecord.updated_at)) ? Date.parse(newRecord.updated_at) : 0,
                });
                const index = newLogs.findIndex(l => String(l.log_id) === String(canonicalRecord.log_id));
                if ((state.deletedLogIds[String(canonicalRecord.log_id)] || 0) >= (canonicalRecord.updatedAt || 0)) return state;
                if (index !== -1 && (newLogs[index].updatedAt || 0) > (canonicalRecord.updatedAt || 0)) return state;
                if (index !== -1) newLogs[index] = { ...newLogs[index], ...canonicalRecord };
                else newLogs.push(canonicalRecord);
                newLogs.sort((a, b) => new Date(b.log_date) - new Date(a.log_date));
                const deletedLogIds = { ...state.deletedLogIds };
                delete deletedLogIds[String(canonicalRecord.log_id)];
                return { mediaLogs: newLogs, deletedLogIds };
              }
            });
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'media_tombstones', filter: `user_id=eq.${user.id}` }, (payload) => {
            const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
            const targetKey = row?.media_key;
            if (!targetKey) { void get().fetchCloudData(user); return; }
            set(state => {
              const deletedMediaKeys = { ...state.deletedMediaKeys };
              if (payload.eventType === 'DELETE') {
                delete deletedMediaKeys[targetKey];
                return { deletedMediaKeys };
              }
              const deletedAt = Date.parse(row.deleted_at) || Date.now();
              deletedMediaKeys[targetKey] = Math.max(deletedMediaKeys[targetKey] || 0, deletedAt);
              const media = Object.fromEntries(Object.entries(state.media).map(([category, items]) => [
                category,
                items.filter(item => item.media_key !== targetKey),
              ]));
              return { media, mediaLogs: state.mediaLogs.filter(log => log.media_key !== targetKey), deletedMediaKeys };
            });
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'log_tombstones', filter: `user_id=eq.${user.id}` }, (payload) => {
            const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
            const logId = row?.log_id && String(row.log_id);
            if (!logId) { void get().fetchCloudData(user); return; }
            set(state => {
              const deletedLogIds = { ...state.deletedLogIds };
              if (payload.eventType === 'DELETE') {
                delete deletedLogIds[logId];
                return { deletedLogIds };
              }
              deletedLogIds[logId] = Math.max(deletedLogIds[logId] || 0, Date.parse(row.deleted_at) || Date.now());
              return { mediaLogs: state.mediaLogs.filter(log => String(log.log_id) !== logId), deletedLogIds };
            });
          })
          .subscribe(status => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              useUIStore.getState().addToast('Realtime synchronization was interrupted; refreshing cloud data.', 'error');
              void get().fetchCloudData(user);
            }
          });
        set({ realtimeSubscription: channel });
      },
      clearRealtimeSubscription: () => {
        const { realtimeSubscription } = get();
        if (realtimeSubscription) {
          supabase.removeChannel(realtimeSubscription);
          set({ realtimeSubscription: null });
        }
      },

      syncItemToCloud: async (item, category) => {
        if (get().authMode !== 'admin') return;
        const { data } = await supabase.auth.getUser();
        if (!data?.user || !item) return;
        const { error } = await supabase.rpc('upsert_user_media', {
          p_media: mediaCloudRow(item, category, data.user.id),
        });
        if (error) throw error;
      },
      patchItemInCloud: async (identity, category, updates) => {
        if (get().authMode !== 'admin') return;
        const { data } = await supabase.auth.getUser();
        if (!data?.user || identity === null || identity === undefined) return;
        const { error } = await supabase.rpc('patch_user_media', {
          p_media_key: mediaKeyFor(identity, category),
          p_updates: updates,
          p_revision: new Date(Number(identity.updatedAt) || Date.now()).toISOString(),
        });
        if (error) throw error;
      },
      deleteItemFromCloud: async (identity, category) => {
        if (get().authMode !== 'admin') return;
        const { data } = await supabase.auth.getUser();
        if (!data?.user) throw new Error('No authenticated user');
        const deletedAt = new Date(Number(identity?.deletedAt) || Date.now()).toISOString();
        const { error } = await supabase.rpc('delete_user_media', {
          p_media_key: mediaKeyFor(identity, category),
          p_deleted_at: deletedAt,
        });
        if (error) throw error;
      },
      syncLogToCloud: async (log) => {
        if (get().authMode !== 'admin') return;
        const { data } = await supabase.auth.getUser();
        if (!data?.user) return;
        const canonical = canonicalizeLog(log);
        const { error } = await supabase.rpc('upsert_user_log', {
          p_log: { ...canonical, user_id: data.user.id, updated_at: new Date(canonical.updatedAt || Date.now()).toISOString() },
        });
        if (error) throw error;
      },
      syncMediaAndLogToCloud: async (item, category, log) => {
        if (get().authMode !== 'admin') return;
        const { data } = await supabase.auth.getUser();
        if (!data?.user) throw new Error('No authenticated user');
        const canonicalLog = canonicalizeLog(log);
        const { error } = await supabase.rpc('upsert_user_media_with_log', {
          p_media: mediaCloudRow(item, category, data.user.id),
          p_log: { ...canonicalLog, user_id: data.user.id, updated_at: new Date(canonicalLog.updatedAt || Date.now()).toISOString() },
        });
        if (error) throw error;
      },
      deleteLogFromCloud: async (logId, deletedAt = Date.now()) => {
        if (get().authMode !== 'admin') return;
        const { data } = await supabase.auth.getUser();
        if (!data?.user) throw new Error('No authenticated user');
        const { error } = await supabase.rpc('delete_user_log', {
          p_log_id: String(logId),
          p_deleted_at: new Date(deletedAt).toISOString(),
        });
        if (error) throw error;
      },
      deleteLogsByMediaIdFromCloud: async (identity, category, deletedAt = Date.now()) => {
        if (get().authMode !== 'admin') return;
        const { data } = await supabase.auth.getUser();
        if (!data?.user) throw new Error('No authenticated user');
        const { error } = await supabase.rpc('delete_user_media_logs', {
          p_media_key: mediaKeyFor(identity, category),
          p_deleted_at: new Date(deletedAt).toISOString(),
        });
        if (error) throw error;
      },
      // --------------------------

      globalLightbox: null,
      globalLightboxIndex: 0,
      setGlobalLightbox: (images, index = 0) => set({
        globalLightbox: Array.isArray(images) ? images : (images ? [images] : null),
        globalLightboxIndex: index
      }),

      // TERMINAL PROCESSING LOCKS
      isAutoProcessing: false,
      setIsAutoProcessing: (val) => set({ isAutoProcessing: val }),
      isBatchCommitting: false,
      setIsBatchCommitting: (val) => set({ isBatchCommitting: val }),

      // UNIFIED MODAL CONTROLLER
      activeDiaryModal: null,
      openDiaryModal: (payload) => set({ activeDiaryModal: payload }),
      closeDiaryModal: () => set({ activeDiaryModal: null }),

      autoSearchOnTypeSelect: true,
      setAutoSearchOnTypeSelect: (val) => set({ autoSearchOnTypeSelect: val }),

      discoveryCache: {},
      setDiscoveryCache: (type, data) => set(state => ({
        discoveryCache: { ...state.discoveryCache, [type]: { data, timestamp: Date.now() } }
      })),

      exploreCache: {},
      setExploreCache: (key, data) => set(state => {
        const newCache = { ...state.exploreCache, [key]: { data, timestamp: Date.now() } };
        const keys = Object.keys(newCache);
        if (keys.length > 50) delete newCache[keys[0]];
        return { exploreCache: newCache };
      }),

      media: initialMediaState,
      deletedMediaKeys: {},
      deletedLogIds: {},
      importQueue: [],
      mediaLogs: [],

      clearImportQueue: () => set({ importQueue: [] }),
      clearPendingImportQueue: () => set((state) => ({ importQueue: state.importQueue.filter(item => item.ready_to_commit) })),

      addMediaItem: (item, category) => {
        const baseItem = canonicalizeMediaItem(item, category);
        const existingItem = get().media[category]?.find(mediaItem => mediaKeyFor(mediaItem, category) === baseItem.media_key);
        const revision = nextRecordRevision(baseItem.updatedAt, existingItem?.updatedAt, get().deletedMediaKeys[baseItem.media_key]);
        const canonicalItem = canonicalizeMediaItem({ ...item, updatedAt: revision }, category);
        set((state) => {
          const exists = state.media[category]?.some((mediaItem) => mediaKeyFor(mediaItem, category) === canonicalItem.media_key);
          const deletedMediaKeys = { ...state.deletedMediaKeys };
          delete deletedMediaKeys[canonicalItem.media_key];
          if (exists) return { deletedMediaKeys, media: { ...state.media, [category]: state.media[category].map(mediaItem => mediaKeyFor(mediaItem, category) === canonicalItem.media_key ? canonicalItem : mediaItem) } };
          return { deletedMediaKeys, media: { ...state.media, [category]: [canonicalItem, ...state.media[category]] } };
        });
        const updated = get().media[category].find(mediaItem => mediaKeyFor(mediaItem, category) === canonicalItem.media_key);
        void queueMediaMutation(canonicalItem.media_key, () => get().syncItemToCloud(updated, category)).catch(error => {
          console.error('Supabase item sync error:', error);
          useUIStore.getState().addToast(`Saved locally, but cloud sync failed for “${canonicalItem.title}”.`, 'error');
        });
      },

      saveMediaWithLog: async (item, category, log) => {
        const baseItem = canonicalizeMediaItem(item, category);
        const existingItem = get().media[category]?.find(mediaItem => mediaKeyFor(mediaItem, category) === baseItem.media_key);
        const mediaRevision = nextRecordRevision(baseItem.updatedAt, existingItem?.updatedAt, get().deletedMediaKeys[baseItem.media_key]);
        const canonicalItem = canonicalizeMediaItem({ ...item, updatedAt: mediaRevision }, category);
        const baseEntry = canonicalizeLog({
          ...log,
          media_id: canonicalItem.id,
          media_type: category,
          provider: canonicalItem.provider,
          provider_id: canonicalItem.provider_id,
          media_key: canonicalItem.media_key,
        });
        const existingLog = get().mediaLogs.find(entry => String(entry.log_id) === String(baseEntry.log_id));
        const effectiveLogId = String(baseEntry.log_id);
        const logRevision = nextRecordRevision(baseEntry.updatedAt, existingLog?.updatedAt, get().deletedLogIds[effectiveLogId]);
        const canonicalEntry = canonicalizeLog({
          ...baseEntry,
          updatedAt: logRevision,
        });
        let syncedLog;
        set(state => {
          const categoryItems = state.media[category] || [];
          const media = {
            ...state.media,
            [category]: categoryItems.some(existing => existing.media_key === canonicalItem.media_key)
              ? categoryItems.map(existing => existing.media_key === canonicalItem.media_key ? canonicalItem : existing)
              : [canonicalItem, ...categoryItems],
          };
          const mediaLogs = upsertDiaryLog(state.mediaLogs, canonicalEntry);
          syncedLog = mediaLogs.find(entry => String(entry.log_id) === String(canonicalEntry.log_id));
          const deletedMediaKeys = { ...state.deletedMediaKeys };
          const deletedLogIds = { ...state.deletedLogIds };
          delete deletedMediaKeys[canonicalItem.media_key];
          delete deletedLogIds[String(syncedLog?.log_id || canonicalEntry.log_id)];
          return { media, mediaLogs, deletedMediaKeys, deletedLogIds };
        });
        await queueMediaMutation(canonicalItem.media_key, () => get().syncMediaAndLogToCloud(canonicalItem, category, syncedLog || canonicalEntry));
        return { media: canonicalItem, log: syncedLog || canonicalEntry };
      },

      patchProviderMetadata: (identity, category, metadataPatch) => {
        let updatedItem;
        set(state => ({
          media: {
            ...state.media,
            [category]: (state.media[category] || []).map(item => {
              if (mediaKeyFor(item, category) !== mediaKeyFor(identity, category)) return item;
              updatedItem = canonicalizeMediaItem({
                ...mergeProviderMetadata(item, metadataPatch),
                updatedAt: nextRecordRevision(item.updatedAt, state.deletedMediaKeys[item.media_key]),
              }, category);
              return updatedItem;
            }),
          },
        }));
        if (updatedItem) {
          const patch = { title: updatedItem.title, image: updatedItem.image, apiData: updatedItem.apiData };
          void queueMediaMutation(updatedItem.media_key, () => get().patchItemInCloud(updatedItem, category, patch)).catch(error => {
            console.error('Supabase provider metadata sync error:', error);
            useUIStore.getState().addToast('Provider details updated locally but did not sync to the cloud.', 'error');
          });
        }
      },

      removeMediaItem: (id, category) => {
        const existing = get().media[category]?.find(item => mediaKeyFor(item, category) === mediaKeyFor(id, category));
        if (!existing) return;
        const targetKey = mediaKeyFor(existing, category);
        const relatedLogs = get().mediaLogs.filter(log => mediaKeyFor(log) === targetKey);
        let deletedAt = nextRecordRevision(existing.updatedAt, get().deletedMediaKeys[targetKey]);
        for (const log of relatedLogs) deletedAt = nextRecordRevision(deletedAt, log.updatedAt, get().deletedLogIds[String(log.log_id)]);
        set((state) => ({
          media: {
            ...state.media,
            [category]: state.media[category].filter((item) => mediaKeyFor(item, category) !== targetKey),
          },
          mediaLogs: state.mediaLogs.filter(log => mediaKeyFor(log) !== targetKey),
          deletedMediaKeys: { ...state.deletedMediaKeys, [targetKey]: deletedAt },
          deletedLogIds: Object.fromEntries([
            ...Object.entries(state.deletedLogIds),
            ...state.mediaLogs.filter(log => mediaKeyFor(log) === targetKey).map(log => [String(log.log_id), deletedAt]),
          ]),
        }));
        void queueMediaMutation(targetKey, () => get().deleteItemFromCloud({ ...existing, deletedAt }, category)).catch(error => {
          console.error('Supabase media delete error:', error);
          useUIStore.getState().addToast(`Cloud deletion failed for “${existing.title}”; refreshing authoritative data.`, 'error');
          void get().fetchCloudData();
        });
      },

      updateMediaStatus: (id, category, newStatus) => {
        let patchPayload = {};
        let targetItem;
        set((state) => ({
          media: {
            ...state.media,
            [category]: state.media[category].map((item) => {
              if (mediaKeyFor(item, category) === mediaKeyFor(id, category)) {
                const now = nextRecordRevision(item.updatedAt, state.deletedMediaKeys[item.media_key]);
                targetItem = { ...applyStatusTransition(item, newStatus, now), updatedAt: now };
                patchPayload = {
                  status: targetItem.status,
                  dateStarted: targetItem.dateStarted,
                  dateCompleted: targetItem.dateCompleted,
                };
                return targetItem;
              }
              return item;
            }),
          },
        }));
        if (targetItem) void queueMediaMutation(targetItem.media_key, () => get().patchItemInCloud(targetItem, category, patchPayload)).catch(error => {
          console.error('Supabase status patch error:', error);
          useUIStore.getState().addToast('Status changed locally but cloud sync failed.', 'error');
        });
      },

      updateMediaProgress: (id, type, newProgress) => {
        let targetItem;
        let patchPayload = {};
        set(state => {
          const items = state.media[type] || [];
          const index = items.findIndex(item => mediaKeyFor(item, type) === mediaKeyFor(id, type));
          if (index === -1) return state;
          const updated = [...items];
          const now = nextRecordRevision(updated[index].updatedAt, state.deletedMediaKeys[updated[index].media_key]);
          const lifecycle = applyActivityLifecycle(updated[index], {
            status: updated[index].status,
            activityAt: now,
            provesConsumption: isMeaningfulProgress(newProgress),
          });
          updated[index] = {
            ...updated[index],
            progress: newProgress,
            dateStarted: lifecycle.dateStarted,
            updatedAt: now,
          };
          targetItem = updated[index];
          patchPayload = { progress: newProgress, dateStarted: targetItem.dateStarted };
          return { media: { ...state.media, [type]: updated } };
        });
        if (targetItem) void queueMediaMutation(targetItem.media_key, () => get().patchItemInCloud(targetItem, type, patchPayload)).catch(error => {
          console.error('Supabase progress patch error:', error);
          useUIStore.getState().addToast('Progress changed locally but cloud sync failed.', 'error');
        });
      },

      updateMediaRating: (id, category, newRating) => {
        const ratingNum = Math.min(10, Math.max(0, parseInt(newRating, 10) || 0));
        let targetItem;
        set((state) => ({
          media: {
            ...state.media,
            [category]: state.media[category].map((item) =>
              mediaKeyFor(item, category) === mediaKeyFor(id, category)
                ? (targetItem = { ...item, rating: ratingNum, updatedAt: nextRecordRevision(item.updatedAt, state.deletedMediaKeys[item.media_key]) })
                : item
            ),
          },
        }));
        if (targetItem) void queueMediaMutation(targetItem.media_key, () => get().patchItemInCloud(targetItem, category, { rating: ratingNum })).catch(error => {
          console.error('Supabase rating patch error:', error);
          useUIStore.getState().addToast('Rating changed locally but cloud sync failed.', 'error');
        });
      },

      toggleIssueRead: (mediaId, type, issueId, allIssueIds) => {
        let patchPayload = {};
        let targetItem;
        set((state) => {
          const items = state.media[type] || [];
          const updated = items.map(item => {
            if (mediaKeyFor(item, type) === mediaKeyFor(mediaId, type)) {
              targetItem = {
                ...toggleIssueState(item, issueId, allIssueIds),
                updatedAt: nextRecordRevision(item.updatedAt, state.deletedMediaKeys[item.media_key]),
              };
              patchPayload = {
                readIssueIds: targetItem.readIssueIds,
                progress: targetItem.progress,
                status: targetItem.status,
                dateStarted: targetItem.dateStarted,
                dateCompleted: targetItem.dateCompleted,
              };
              return targetItem;
            }
            return item;
          });
          return { media: { ...state.media, [type]: updated } };
        });
        if (targetItem) void queueMediaMutation(targetItem.media_key, () => get().patchItemInCloud(targetItem, type, patchPayload)).catch(error => {
          console.error('Supabase issue patch error:', error);
          useUIStore.getState().addToast('Issue progress changed locally but cloud sync failed.', 'error');
        });
      },

      addImportBatch: (items) => set((state) => {
        const existingIds = new Set(state.importQueue.map(i => i.id));
        const newItems = items.filter(i => !existingIds.has(i.id));
        return { importQueue: [...state.importQueue, ...newItems] };
      }),

      addManualImportItem: (item, position = 'bottom') => {
        set((state) => {
          const newQueue = position === 'top' ? [item, ...state.importQueue] : [...state.importQueue, item];
          return { importQueue: newQueue };
        });
      },

      moveItemToPosition: (itemId, newIndex) => set((state) => {
        const currentIndex = state.importQueue.findIndex(i => i.id === itemId);
        if (currentIndex === -1 || currentIndex === newIndex) return state;
        const newQueue = [...state.importQueue];
        const [removed] = newQueue.splice(currentIndex, 1);
        // Clamp the target index securely between 0 and the max queue length
        const clampedIndex = Math.max(0, Math.min(newIndex, newQueue.length));
        newQueue.splice(clampedIndex, 0, removed);
        return { importQueue: newQueue };
      }),

      restoreBackup: async (backupData) => {
        const normalized = normalizeBackup(backupData);
        await cloudMutationQueue.drain();
        if (get().authMode === 'admin') {
          const { data: authData } = await supabase.auth.getUser();
          if (!authData?.user) throw new Error('No authenticated user');
          const cloudMedia = Object.entries(normalized.media).flatMap(([category, items]) => items.map(item => mediaCloudRow(item, category, authData.user.id)));
          const cloudLogs = normalized.mediaLogs.map(log => ({ ...canonicalizeLog(log), user_id: authData.user.id }));
          const { error } = await supabase.rpc('replace_user_library', {
            p_media: cloudMedia,
            p_logs: cloudLogs,
          });
          if (error) throw error;
          const refreshed = await get().fetchCloudData(authData.user, authGeneration, true);
          if (!refreshed) throw new Error('Backup was restored but the authoritative cloud snapshot could not be loaded');
          return true;
        }
        const restoredMediaKeys = new Set(Object.values(normalized.media).flat().map(item => mediaKeyFor(item, item.type)));
        const restoredLogIds = new Set(normalized.mediaLogs.map(log => String(log.log_id)));
        const deletedMediaKeys = { ...get().deletedMediaKeys };
        const deletedLogIds = { ...get().deletedLogIds };
        for (const [category, items] of Object.entries(get().media)) {
          for (const item of items) {
            const key = mediaKeyFor(item, category);
            if (!restoredMediaKeys.has(key)) deletedMediaKeys[key] = nextRecordRevision(item.updatedAt, deletedMediaKeys[key]);
          }
        }
        for (const log of get().mediaLogs) {
          const logId = String(log.log_id);
          if (!restoredLogIds.has(logId)) deletedLogIds[logId] = nextRecordRevision(log.updatedAt, deletedLogIds[logId]);
        }
        const existingMedia = new Map(Object.entries(get().media).flatMap(([category, items]) => items.map(item => [mediaKeyFor(item, category), item])));
        const existingLogs = new Map(get().mediaLogs.map(log => [String(log.log_id), log]));
        set({
          media: canonicalizeMediaCollection(Object.fromEntries(Object.entries(normalized.media).map(([category, items]) => [category, items.map(item => {
            const key = mediaKeyFor(item, category);
            return { ...item, updatedAt: nextRecordRevision(existingMedia.get(key)?.updatedAt, deletedMediaKeys[key]) };
          })]))),
          mediaLogs: normalized.mediaLogs.map(log => canonicalizeLog({
            ...log,
            updatedAt: nextRecordRevision(existingLogs.get(String(log.log_id))?.updatedAt, deletedLogIds[String(log.log_id)]),
          })),
          deletedMediaKeys,
          deletedLogIds,
        });
        return true;
      },

      nukeCloudData: async () => {
        await cloudMutationQueue.drain();
        if (get().authMode === 'admin') {
          const { data: authData } = await supabase.auth.getUser();
          if (authData?.user) {
            const { error } = await supabase.rpc('reset_user_library');
            if (error) throw error;
          }
        }
        const deletedMediaKeys = { ...get().deletedMediaKeys };
        const deletedLogIds = { ...get().deletedLogIds };
        for (const [category, items] of Object.entries(get().media)) {
          for (const item of items) {
            const key = mediaKeyFor(item, category);
            deletedMediaKeys[key] = nextRecordRevision(item.updatedAt, deletedMediaKeys[key]);
          }
        }
        for (const log of get().mediaLogs) {
          const logId = String(log.log_id);
          deletedLogIds[logId] = nextRecordRevision(log.updatedAt, deletedLogIds[logId]);
        }
        set({ media: freshMediaState(), mediaLogs: [], deletedMediaKeys, deletedLogIds });
        return true;
      },

      updateImportItem: (id, updates) => set((state) => ({
        importQueue: state.importQueue.map(item =>
          item.id === id ? { ...item, ...updates } : item
        )
      })),

      removeImportItem: (id) => set((state) => ({
        importQueue: state.importQueue.filter(item => item.id !== id)
      })),

      // STRICT UPSERT LOGIC (Prevents same-day stacking)
      addDiaryLog: (logEntry) => {
        const baseEntry = canonicalizeLog(logEntry);
        const existingLog = get().mediaLogs.find(log => String(log.log_id) === String(baseEntry.log_id));
        const effectiveLogId = String(baseEntry.log_id);
        const canonicalEntry = canonicalizeLog({
          ...baseEntry,
          updatedAt: nextRecordRevision(baseEntry.updatedAt, existingLog?.updatedAt, get().deletedLogIds[effectiveLogId]),
        });
        set(state => {
          const deletedLogIds = { ...state.deletedLogIds };
          delete deletedLogIds[String(canonicalEntry.log_id)];
          return { mediaLogs: upsertDiaryLog(state.mediaLogs, canonicalEntry), deletedLogIds };
        });
        const syncedLog = get().mediaLogs.find(log => String(log.log_id) === String(canonicalEntry.log_id));
        if (syncedLog) void queueLogMutation(syncedLog, () => get().syncLogToCloud(syncedLog)).catch(error => {
          console.error('Supabase diary sync error:', error);
          useUIStore.getState().addToast('Diary entry saved locally but cloud sync failed.', 'error');
        });
      },

      removeDiaryLog: (logId) => {
        const existingLog = get().mediaLogs.find(log => String(log.log_id) === String(logId));
        const deletedAt = nextRecordRevision(existingLog?.updatedAt, get().deletedLogIds[String(logId)]);
        set((state) => ({
          mediaLogs: state.mediaLogs.filter(log => String(log.log_id) !== String(logId)),
          deletedLogIds: { ...state.deletedLogIds, [String(logId)]: deletedAt },
        }));
        void queueLogMutation(existingLog || logId, () => get().deleteLogFromCloud(logId, deletedAt)).catch(error => {
          console.error('Supabase diary delete error:', error);
          useUIStore.getState().addToast('Diary deletion failed in the cloud; refreshing data.', 'error');
          void get().fetchCloudData();
        });
      },

      updateDiaryLog: (logId, updates) => {
        set((state) => ({
          mediaLogs: state.mediaLogs.map(log => log.log_id === logId ? {
            ...log,
            ...updates,
            updatedAt: nextRecordRevision(log.updatedAt, state.deletedLogIds[String(logId)]),
          } : log).sort((a, b) => new Date(b.log_date) - new Date(a.log_date))
        }));
        const updated = get().mediaLogs.find(l => l.log_id === logId);
        if (updated) void queueLogMutation(updated, () => get().syncLogToCloud(updated)).catch(error => {
          console.error('Supabase diary update error:', error);
          useUIStore.getState().addToast('Diary edit saved locally but cloud sync failed.', 'error');
        });
      },

      removeMediaLogsByMediaId: (mediaId, category) => {
        const targetKey = mediaKeyFor(mediaId, category);
        const matchingLogs = get().mediaLogs.filter(log => mediaKeyFor(log) === targetKey);
        let deletedAt = Date.now();
        for (const log of matchingLogs) deletedAt = nextRecordRevision(deletedAt, log.updatedAt, get().deletedLogIds[String(log.log_id)]);
        set((state) => ({
          mediaLogs: state.mediaLogs.filter(log => mediaKeyFor(log) !== targetKey),
          deletedLogIds: Object.fromEntries([
            ...Object.entries(state.deletedLogIds),
            ...state.mediaLogs.filter(log => mediaKeyFor(log) === targetKey).map(log => [String(log.log_id), deletedAt]),
          ]),
        }));
        void get().deleteLogsByMediaIdFromCloud(mediaId, category, deletedAt).catch(error => {
          console.error('Supabase diary cascade delete error:', error);
          useUIStore.getState().addToast('Cloud diary cleanup failed.', 'error');
        });
      },

    }),
    {
      name: 'polyhedron-storage',
      storage: createJSONStorage(() => idbStorage),
      version: 5,
      migrate: persistedState => {
        const ownerId = persistedState?.ownerId ?? (persistedState?.authMode === 'guest' ? 'guest' : null);
        const migrated = {
          ...persistedState,
          ownerId,
          storageEpoch: Number(persistedState?.storageEpoch) || 0,
          authMode: null,
          media: canonicalizeMediaCollection(persistedState?.media || freshMediaState()),
          mediaLogs: (persistedState?.mediaLogs || []).map(canonicalizeLog),
          deletedMediaKeys: persistedState?.deletedMediaKeys || {},
          deletedLogIds: persistedState?.deletedLogIds || {},
        };
        const legacyGuest = ownerId === 'guest' ? snapshotGuestState(migrated) : null;
        return {
          ...migrated,
          guestSnapshot: persistedState?.guestSnapshot || legacyGuest,
          guestSeedVersion: Number(persistedState?.guestSeedVersion) || (legacyGuest ? GUEST_SHOWCASE_VERSION : 0),
        };
      },
      merge: (persistedState, currentState) => {
        const activeOwner = currentState.authMode ? currentState.ownerId : null;
        if (activeOwner && persistedState?.ownerId !== activeOwner) {
          return {
            ...currentState,
            storageEpoch: nextStorageEpoch(Math.max(currentState.storageEpoch || 0, persistedState?.storageEpoch || 0)),
          };
        }
        return { ...currentState, ...persistedState, authMode: currentState.authMode };
      },
      onRehydrateStorage: () => (state) => {
        if (!state?._hasHydrated) {
          state?.setHasHydrated(true);
          void state?.restoreSession();
        }
      },
      partialize: (state) => {
        const stateToSave = { ...state };
        if (state.ownerId === 'guest') {
          stateToSave.guestSnapshot = snapshotGuestState(state);
          stateToSave.guestSeedVersion = GUEST_SHOWCASE_VERSION;
        }
        for (const transientKey of [
          '_hasHydrated', 'isAutoProcessing', 'isBatchCommitting', 'isCloudSyncing', 'isLoading',
          'authMode', 'realtimeSubscription', 'authSubscription', 'activeDiaryModal', 'exploreCache',
        ]) delete stateToSave[transientKey];
        const slimMedia = (sourceMedia) => {
          const result = {};
          for (const key in sourceMedia) result[key] = sourceMedia[key].map(item => {
            if (!item.apiData?.raw) return item;
            const slimRaw = { ...item.apiData.raw };
            if (!item.isGuestShowcase) {
              delete slimRaw.issue_details;
              delete slimRaw.seasons;
            }
            delete slimRaw.credits;
            delete slimRaw.staff;
            delete slimRaw.recommendations;
            delete slimRaw.similar_games;
            delete slimRaw.deepFetched;
            return { ...item, apiData: { ...item.apiData, raw: slimRaw } };
          });
          return result;
        };
        return {
          ...stateToSave,
          importQueue: stateToSave.importQueue,
          media: slimMedia(stateToSave.media),
          guestSnapshot: stateToSave.guestSnapshot ? {
            ...stateToSave.guestSnapshot,
            media: slimMedia(stateToSave.guestSnapshot.media),
          } : null,
        };
      }
    }
  )
);

export const useUIStore = create((set) => ({
  toasts: [],
  addToast: (message, type = 'error') => {
    const id = Date.now() + Math.random();
    set((state) => state.toasts.some(toast => toast.message === message && toast.type === type)
      ? state
      : { toasts: [...state.toasts, { id, message, type }] });
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id)
  })),
  viewMode: 'grid',
  setViewMode: (mode) => set({ viewMode: mode }),
}));

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === 'polyhedron-idb-pulse') {
      useMediaStore.persist.rehydrate();
    }
  });
}
