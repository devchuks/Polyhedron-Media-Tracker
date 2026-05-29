import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from '../services/supabase';

const initialMediaState = { tv: [], movies: [], games: [], vn: [], anime: [], manga: [], books: [], comics: [] };

// 1. Singleton Database Connection to stop I/O thrashing
let dbPromise = null;
const getDB = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const request = indexedDB.open('polyhedron-db', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keyval');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }
  return dbPromise;
};

const idbSyncChannel = typeof window !== 'undefined' && window.BroadcastChannel ? new BroadcastChannel('polyhedron-idb-sync') : null;
if (idbSyncChannel) {
  idbSyncChannel.onmessage = (e) => {
    // Only rehydrate the zustand store if another tab wrote to the database
    if (e.data === 'IDB_UPDATED') useMediaStore.persist.rehydrate();
  };
}

const idbStorage = {
  getItem: async (name) => {
    const db = await getDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction('keyval', 'readonly');
      const store = tx.objectStore('keyval');
      const getReq = store.get(name);
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => resolve(null);
    });
  },
  setItem: async (name, value) => {
    const db = await getDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction('keyval', 'readwrite');
      const store = tx.objectStore('keyval');
      store.put(value, name);
      tx.oncomplete = () => {
        if (idbSyncChannel) idbSyncChannel.postMessage('IDB_UPDATED');
        resolve();
      };
    });
  },
  removeItem: async (name) => {
    const db = await getDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction('keyval', 'readwrite');
      const store = tx.objectStore('keyval');
      store.delete(name);
      tx.oncomplete = () => {
        if (idbSyncChannel) idbSyncChannel.postMessage('IDB_UPDATED');
        resolve();
      };
    });
  },
};

export const useMediaStore = create(
  persist(
    (set, get) => ({
      _hasHydrated: false,
      setHasHydrated: (state) => set({ _hasHydrated: state }),

      authMode: null,
      setAuthMode: (mode) => {
        if (mode === 'admin') {
          set({ authMode: mode, isCloudSyncing: true });
          get().fetchCloudData().then(() => get().initRealtimeSubscription());
        } else {
          if (get().clearRealtimeSubscription) get().clearRealtimeSubscription();
          set({ 
            authMode: mode,
            media: { tv: [], movies: [], games: [], vn: [], anime: [], manga: [], books: [], comics: [] },
            mediaLogs: []
          });
        }
      },

      // --- CLOUD SYNC HELPERS ---
      isCloudSyncing: false,
      fetchCloudData: async () => {
        set({ isCloudSyncing: true });
        try {
          const { data: authData } = await supabase.auth.getUser();
          if (!authData?.user) return;
          const { data: libraryData, error: libErr } = await supabase.from('media_library').select('*');
          const { data: logsData, error: logErr } = await supabase.from('media_logs').select('*');
          
          if (libErr) console.error("Library Sync Error:", libErr);
          if (logErr) console.error("Logs Sync Error:", logErr);

          if (libraryData) {
            const newMedia = { tv: [], movies: [], games: [], vn: [], anime: [], manga: [], books: [], comics: [] };
            libraryData.forEach(item => { 
              const normalizedItem = {
                ...item,
                addedAt: item.addedAt ?? item.addedat,
                dateStarted: item.dateStarted ?? item.datestarted,
                dateCompleted: item.dateCompleted ?? item.datecompleted,
                rewatchCount: item.rewatchCount ?? item.rewatchcount,
                readIssueIds: item.readIssueIds ?? item.readissueids ?? [],
                apiData: item.apiData ?? item.apidata ?? {},
              };
              if (newMedia[normalizedItem.type]) newMedia[normalizedItem.type].push(normalizedItem); 
            });
            set({ media: newMedia });
          }
          if (logsData) {
            set({ mediaLogs: logsData.sort((a, b) => new Date(b.log_date) - new Date(a.log_date)) });
          }
        } finally {
          set({ isCloudSyncing: false });
        }
      },

      realtimeSubscription: null,
      initRealtimeSubscription: () => {
        if (get().realtimeSubscription) return; // Prevent duplicate connections
        
        const channel = supabase.channel('polyhedron-sync')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'media_library' }, (payload) => {
            const { eventType, new: rawRecord, old: oldRecord } = payload;
            set((state) => {
              const newMedia = { ...state.media };
              if (eventType === 'DELETE') {
                for (const key in newMedia) newMedia[key] = newMedia[key].filter(m => String(m.id) !== String(oldRecord.id));
              } else {
                const type = rawRecord.type || oldRecord?.type;
                if (!type) return state; // Ignore corrupted payloads
                
                const existingItem = state.media[type]?.find(m => String(m.id) === String(rawRecord.id));
                const newRecord = {
                  ...existingItem, // 2. Protect existing local fields (like TOAST columns) from being erased
                  ...rawRecord,
                  addedAt: rawRecord.addedAt ?? rawRecord.addedat ?? existingItem?.addedAt,
                  dateStarted: rawRecord.dateStarted ?? rawRecord.datestarted ?? existingItem?.dateStarted,
                  dateCompleted: rawRecord.dateCompleted ?? rawRecord.datecompleted ?? existingItem?.dateCompleted,
                  rewatchCount: rawRecord.rewatchCount ?? rawRecord.rewatchcount ?? existingItem?.rewatchCount,
                  readIssueIds: rawRecord.readIssueIds ?? rawRecord.readissueids ?? existingItem?.readIssueIds ?? [],
                  apiData: (rawRecord.apiData && Object.keys(rawRecord.apiData).length > 0) ? rawRecord.apiData : 
                           (rawRecord.apidata && Object.keys(rawRecord.apidata).length > 0) ? rawRecord.apidata : 
                           existingItem?.apiData ?? {},
                };
                if (newMedia[type]) {
                  newMedia[type] = [...newMedia[type]]; // 3. Fix Array Mutation Trap to force React to re-render
                  const index = newMedia[type].findIndex(m => String(m.id) === String(newRecord.id));
                  if (index !== -1) newMedia[type][index] = { ...newMedia[type][index], ...newRecord };
                  else newMedia[type] = [newRecord, ...newMedia[type]];
                }
              }
              return { media: newMedia };
            });
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'media_logs' }, (payload) => {
            const { eventType, new: newRecord, old: oldRecord } = payload;
            set((state) => {
              let newLogs = [...state.mediaLogs];
              if (eventType === 'DELETE') newLogs = newLogs.filter(l => String(l.log_id) !== String(oldRecord.log_id));
              else {
                const index = newLogs.findIndex(l => String(l.log_id) === String(newRecord.log_id));
                if (index !== -1) newLogs[index] = { ...newLogs[index], ...newRecord };
                else newLogs.push(newRecord);
                newLogs.sort((a, b) => new Date(b.log_date) - new Date(a.log_date));
              }
              return { mediaLogs: newLogs };
            });
          })
          .subscribe();
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
        const { error } = await supabase.from('media_library').upsert({
          id: String(item.id), user_id: data.user.id, title: item.title, type: category,
          subtype: item.subtype || null, progress: item.progress || null, status: item.status || 'planned',
          rating: item.rating || 0, "addedAt": item.addedAt || Date.now(), "dateStarted": item.dateStarted || null,
          "dateCompleted": item.dateCompleted || null, "rewatchCount": item.rewatchCount || 0,
          "readIssueIds": item.readIssueIds || [], image: item.image || null, "apiData": item.apiData || {}
        });
        if (error) console.error("Supabase Item Sync Error:", error);
      },
      patchItemInCloud: async (id, updates) => {
        if (get().authMode !== 'admin') return;
        const { data } = await supabase.auth.getUser();
        if (!data?.user || !id) return;
        const { error } = await supabase.from('media_library').update(updates).eq('id', String(id)).eq('user_id', data.user.id);
        if (error) console.error("Supabase Item Patch Error:", error);
      },
      deleteItemFromCloud: async (id) => {
        if (get().authMode === 'admin') await supabase.from('media_library').delete().eq('id', String(id));
      },
      syncLogToCloud: async (log) => {
        if (get().authMode !== 'admin') return;
        const { data } = await supabase.auth.getUser();
        if (!data?.user) return;
        const { error } = await supabase.from('media_logs').upsert({ ...log, user_id: data.user.id });
        if (error) console.error("Supabase Log Sync Error:", error);
      },
      deleteLogFromCloud: async (logId) => {
        if (get().authMode === 'admin') await supabase.from('media_logs').delete().eq('log_id', logId);
      },
      deleteLogsByMediaIdFromCloud: async (mediaId) => {
        if (get().authMode === 'admin') await supabase.from('media_logs').delete().eq('media_id', String(mediaId));
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
      importQueue: [], 
      mediaLogs: [],
      
      clearImportQueue: () => set({ importQueue: [] }),
      clearPendingImportQueue: () => set((state) => ({ importQueue: state.importQueue.filter(item => item.ready_to_commit) })),

      addMediaItem: (item, category) => {
        set((state) => {
          const exists = state.media[category]?.some((m) => String(m.id) === String(item.id));
          if (exists) return { media: { ...state.media, [category]: state.media[category].map(m => String(m.id) === String(item.id) ? item : m) } };
          return { media: { ...state.media, [category]: [item, ...state.media[category]] } };
        });
        const updated = get().media[category].find(m => String(m.id) === String(item.id));
        get().syncItemToCloud(updated, category);
      },

      removeMediaItem: (id, category) => {
        set((state) => ({
          media: {
            ...state.media,
            [category]: state.media[category].filter((item) => String(item.id) !== String(id)),
          },
          mediaLogs: state.mediaLogs.filter(log => String(log.media_id) !== String(id))
        }));
        get().deleteItemFromCloud(id);
        get().deleteLogsByMediaIdFromCloud(id);
      },

      updateMediaStatus: (id, category, newStatus) => {
        let patchPayload = {};
        set((state) => ({
          media: {
            ...state.media,
            [category]: state.media[category].map((item) => {
              if (String(item.id) === String(id)) {
                const now = Date.now();
                const newDateCompleted = newStatus === 'completed' ? now : null;
                patchPayload = { status: newStatus, "dateCompleted": newDateCompleted };
                return { ...item, status: newStatus, updatedAt: now, dateCompleted: newDateCompleted };
              }
              return item;
            }),
          },
        }));
        if (Object.keys(patchPayload).length > 0) get().patchItemInCloud(id, patchPayload);
      },

      updateMediaProgress: (id, type, newProgress) => {
        set(state => {
          const items = state.media[type] || [];
          const index = items.findIndex(item => String(item.id) === String(id));
          if (index === -1) return state;
          const updated = [...items];
          updated[index] = { ...updated[index], progress: newProgress };
          return { media: { ...state.media, [type]: updated } };
        });
        get().patchItemInCloud(id, { progress: newProgress });
      },

      updateMediaRating: (id, category, newRating) => {
        const ratingNum = parseInt(newRating) || 0;
        set((state) => ({
          media: {
            ...state.media,
            [category]: state.media[category].map((item) =>
              String(item.id) === String(id) ? { ...item, rating: ratingNum } : item
            ),
          },
        }));
        get().patchItemInCloud(id, { rating: ratingNum });
      },

      toggleIssueRead: (mediaId, type, issueId, allIssueIds) => {
        let patchPayload = {};
        set((state) => {
          const items = state.media[type] || [];
          const updated = items.map(item => {
            if (String(item.id) === String(mediaId)) {
              const currentRead = item.readIssueIds || [];
              const isRead = currentRead.includes(issueId);
              let newReadIds;
              if (!isRead) {
                const targetIndex = allIssueIds.indexOf(issueId);
                if (targetIndex === -1) newReadIds = [...currentRead, issueId];
                else newReadIds = Array.from(new Set([...currentRead, ...allIssueIds.slice(0, targetIndex + 1)]));
              } else newReadIds = currentRead.filter(id => id !== issueId);
              const totalIssues = item.raw?.issuesCount || item.raw?.issue_count || allIssueIds.length || 0;
              const allRead = totalIssues > 0 && newReadIds.length >= totalIssues;
              let newStatus = item.status, newDateCompleted = item.dateCompleted;
              if (allRead && newStatus !== 'completed') { newStatus = 'completed'; newDateCompleted = Date.now(); }
              else if (!allRead && newStatus === 'completed') { newStatus = 'in progress'; newDateCompleted = null; }
              else if (newReadIds.length > 0 && newStatus !== 'in progress' && newStatus !== 'completed') newStatus = 'in progress';
              
              patchPayload = { "readIssueIds": newReadIds, progress: `${newReadIds.length} Issues`, status: newStatus, "dateCompleted": newDateCompleted };
              return { ...item, readIssueIds: newReadIds, progress: `${newReadIds.length} Issues`, status: newStatus, dateCompleted: newDateCompleted };
            }
            return item;
          });
          return { media: { ...state.media, [type]: updated } };
        });
        if (Object.keys(patchPayload).length > 0) get().patchItemInCloud(mediaId, patchPayload);
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
        set((state) => ({
          media: backupData.media || state.media,
          mediaLogs: backupData.mediaLogs || state.mediaLogs
        }));
        if (get().authMode === 'admin') {
          const { data: authData } = await supabase.auth.getUser();
          if (!authData?.user) return;
          const allMedia = Object.entries(backupData.media || {}).flatMap(([type, items]) => items.map(item => ({ id: String(item.id), user_id: authData.user.id, title: item.title, type, subtype: item.subtype || null, progress: item.progress || null, status: item.status || 'planned', rating: item.rating || 0, "addedAt": item.addedAt || Date.now(), "dateStarted": item.dateStarted || null, "dateCompleted": item.dateCompleted || null, "rewatchCount": item.rewatchCount || 0, "readIssueIds": item.readIssueIds || [], image: item.image || null, "apiData": item.apiData || {} })));
          if (allMedia.length) {
            const { error: mediaErr } = await supabase.from('media_library').upsert(allMedia);
            if (mediaErr) console.error("Restore Media Error:", mediaErr);
          }
          
          const allLogs = (backupData.mediaLogs || []).map(log => ({
            log_id: String(log.log_id), user_id: authData.user.id, media_id: String(log.media_id),
            media_type: log.media_type, action_type: log.action_type || 'LOGGED',
            log_date: log.log_date, review_text: log.review_text || '',
            image: log.image || null, season_label: log.season_label || null, season_year: log.season_year || null
          }));
          
          if (allLogs.length) {
            const { error: logErr } = await supabase.from('media_logs').upsert(allLogs);
            if (logErr) console.error("Restore Logs Error:", logErr);
          }
        }
      },

      nukeCloudData: async () => {
        if (get().authMode === 'admin') {
          const { data: authData } = await supabase.auth.getUser();
          if (authData?.user) {
            await supabase.from('media_library').delete().eq('user_id', authData.user.id);
            await supabase.from('media_logs').delete().eq('user_id', authData.user.id);
          }
        }
        set({ media: { tv: [], movies: [], games: [], vn: [], anime: [], manga: [], books: [], comics: [] }, mediaLogs: [] });
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
        set((state) => {
          const logDateString = new Date(logEntry.log_date).toISOString().split('T')[0];
          const existingIndex = state.mediaLogs.findIndex(l => 
            String(l.media_id) === String(logEntry.media_id) && 
            new Date(l.log_date).toISOString().split('T')[0] === logDateString &&
            ((l.season_label || null) === (logEntry.season_label || null))
          );
          let newLogs = [...state.mediaLogs];
          if (existingIndex !== -1) {
            newLogs[existingIndex] = { ...newLogs[existingIndex], ...logEntry, review_text: logEntry.review_text || newLogs[existingIndex].review_text };
          } else {
            newLogs.push(logEntry);
          }
          return { mediaLogs: newLogs.sort((a, b) => new Date(b.log_date) - new Date(a.log_date)) };
        });
        const logDateString = new Date(logEntry.log_date).toISOString().split('T')[0];
        const syncedLog = get().mediaLogs.find(l => 
          String(l.media_id) === String(logEntry.media_id) && 
          new Date(l.log_date).toISOString().split('T')[0] === logDateString &&
          ((l.season_label || null) === (logEntry.season_label || null))
        );
        if (syncedLog) get().syncLogToCloud(syncedLog);
      },

      removeDiaryLog: (logId) => {
        set((state) => ({ mediaLogs: state.mediaLogs.filter(log => log.log_id !== logId) }));
        get().deleteLogFromCloud(logId);
      },

      updateDiaryLog: (logId, updates) => {
        set((state) => ({
          mediaLogs: state.mediaLogs.map(log => log.log_id === logId ? { ...log, ...updates } : log).sort((a, b) => new Date(b.log_date) - new Date(a.log_date))
        }));
        const updated = get().mediaLogs.find(l => l.log_id === logId);
        if (updated) get().syncLogToCloud(updated);
      },

      removeMediaLogsByMediaId: (mediaId) => {
        set((state) => ({
          mediaLogs: state.mediaLogs.filter(log => String(log.media_id) !== String(mediaId))
        }));
        get().deleteLogsByMediaIdFromCloud(mediaId);
      },

    }),
    {
      name: 'polyhedron-storage',
      storage: createJSONStorage(() => idbStorage),
      onRehydrateStorage: () => (state) => { 
        if (!state?._hasHydrated) {
          state?.setHasHydrated(true); 
          if (state?.authMode === 'admin') {
            state.fetchCloudData().then(() => state.initRealtimeSubscription());
          }
        }
      },
      partialize: (state) => {
        const { _hasHydrated, isAutoProcessing, isBatchCommitting, isCloudSyncing, realtimeSubscription, activeDiaryModal, exploreCache, ...stateToSave } = state;
        const slimMedia = {};
        for (const key in stateToSave.media) {
          slimMedia[key] = stateToSave.media[key].map(item => {
            if (!item.apiData?.raw) return item;
            const slimRaw = { ...item.apiData.raw };
            delete slimRaw.issue_details; 
            delete slimRaw.seasons;
            delete slimRaw.credits;
            delete slimRaw.staff;
            delete slimRaw.recommendations;
            delete slimRaw.similar_games;
            delete slimRaw.deepFetched; 
            return { ...item, apiData: { ...item.apiData, raw: slimRaw } };
          });
        }
        return {
          ...stateToSave,
          importQueue: stateToSave.importQueue,
          media: slimMedia
        };
      }
    }
  )
);

export const useUIStore = create((set) => ({
  toasts: [],
  addToast: (message, type = 'error') => {
    const id = Date.now() + Math.random();
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
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
    if (event.key === 'polyhedron-storage') {
      useMediaStore.persist.rehydrate();
    }
  });
}