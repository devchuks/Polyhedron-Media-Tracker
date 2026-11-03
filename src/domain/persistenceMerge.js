import { canonicalizeLog, canonicalizeMediaItem } from './mediaIdentity.js';
import { preserveUsableMediaImage } from './mediaImages.js';

const recordTime = (record, fallbackField) => {
  const value = record?.updatedAt ?? record?.updated_at ?? record?.[fallbackField] ?? 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const mergeTombstones = (left = {}, right = {}) => {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right || {})) {
    merged[key] = Math.max(Number(merged[key]) || 0, Number(value) || 0);
  }
  return merged;
};

export const nextRecordRevision = (...values) => {
  let revision = Date.now();
  for (const value of values) {
    const numeric = Number(value);
    const parsed = Number.isFinite(numeric) ? numeric : Date.parse(value);
    if (Number.isFinite(parsed)) revision = Math.max(revision, parsed + 1);
  }
  return revision;
};

export const mergeLibraryState = (current = {}, incoming = {}) => {
  const deletedMediaKeys = mergeTombstones(current.deletedMediaKeys, incoming.deletedMediaKeys);
  const deletedLogIds = mergeTombstones(current.deletedLogIds, incoming.deletedLogIds);
  const mediaByKey = new Map();

  const addMedia = media => {
    for (const [category, items] of Object.entries(media || {})) {
      for (const rawItem of Array.isArray(items) ? items : []) {
        try {
          const item = canonicalizeMediaItem(rawItem, category);
          const previous = mediaByKey.get(item.media_key);
          if (!previous) {
            mediaByKey.set(item.media_key, item);
          } else if (recordTime(item, 'addedAt') >= recordTime(previous, 'addedAt')) {
            mediaByKey.set(item.media_key, preserveUsableMediaImage(item, previous));
          } else {
            mediaByKey.set(item.media_key, preserveUsableMediaImage(previous, item));
          }
        } catch {
          // Malformed persisted rows are quarantined by omission instead of colliding with valid records.
        }
      }
    }
  };
  addMedia(current.media);
  addMedia(incoming.media);

  // A live record newer than its tombstone was deliberately restored; drop the tombstone, as the
  // in-memory restore paths do, so persisted and in-memory state converge instead of differing forever.
  for (const item of mediaByKey.values()) {
    if (deletedMediaKeys[item.media_key] && deletedMediaKeys[item.media_key] < recordTime(item, 'addedAt')) delete deletedMediaKeys[item.media_key];
  }

  const categories = new Set([...Object.keys(current.media || {}), ...Object.keys(incoming.media || {})]);
  const media = Object.fromEntries([...categories].map(category => [category, []]));
  const liveMediaKeys = new Set();
  for (const item of mediaByKey.values()) {
    if ((deletedMediaKeys[item.media_key] || 0) >= recordTime(item, 'addedAt')) continue;
    liveMediaKeys.add(item.media_key);
    (media[item.type] ||= []).push(item);
  }

  const logsById = new Map();
  for (const rawLog of [...(current.mediaLogs || []), ...(incoming.mediaLogs || [])]) {
    try {
      const log = canonicalizeLog(rawLog);
      const previous = logsById.get(String(log.log_id));
      if (!previous || recordTime(log, 'log_date') >= recordTime(previous, 'log_date')) logsById.set(String(log.log_id), log);
    } catch {
      // Ignore malformed rows; backup import performs explicit validation and reporting.
    }
  }
  for (const log of logsById.values()) {
    const logId = String(log.log_id);
    if (deletedLogIds[logId] && deletedLogIds[logId] < recordTime(log, 'log_date')) delete deletedLogIds[logId];
  }
  const mediaLogs = [...logsById.values()]
    .filter(log => (deletedLogIds[String(log.log_id)] || 0) < recordTime(log, 'log_date'))
    .filter(log => liveMediaKeys.has(log.media_key)
      || !deletedMediaKeys[log.media_key]
      || deletedMediaKeys[log.media_key] < recordTime(log, 'log_date'))
    .sort((a, b) => new Date(b.log_date) - new Date(a.log_date));

  return { media, mediaLogs, deletedMediaKeys, deletedLogIds };
};

export const mergePersistedSnapshots = (currentValue, incomingValue) => {
  if (!currentValue) return incomingValue;
  try {
    const current = JSON.parse(currentValue);
    const incoming = JSON.parse(incomingValue);
    const currentEpoch = Number(current.state?.storageEpoch) || 0;
    const incomingEpoch = Number(incoming.state?.storageEpoch) || 0;
    const currentOwner = current.state?.ownerId ?? null;
    const incomingOwner = incoming.state?.ownerId ?? null;
    if (currentEpoch > incomingEpoch) return currentValue;
    if (incomingEpoch > currentEpoch || currentOwner !== incomingOwner) return incomingValue;
    const mergedLibrary = mergeLibraryState(current.state, incoming.state);
    return JSON.stringify({
      ...incoming,
      version: Math.max(Number(current.version) || 0, Number(incoming.version) || 0),
      state: { ...incoming.state, ...mergedLibrary },
    });
  } catch {
    return incomingValue;
  }
};

// Persistence slims bulky provider fields, so a rehydrated record can be a reduced copy of the
// in-memory one at the same revision. Keep the in-memory object in that case: replacing it
// would drop enrichment flags, re-run provider requests, and visibly swap content.
export const preferInMemoryRevisions = (current = {}, persisted = {}) => {
  const sameRevision = (left, right, fallbackField) => recordTime(left, fallbackField) === recordTime(right, fallbackField);
  const media = {};
  for (const [category, items] of Object.entries(persisted.media || {})) {
    const currentItems = current.media?.[category] || [];
    const currentByKey = new Map(currentItems.map(item => [item?.media_key, item]));
    media[category] = (items || []).map(item => {
      const live = item?.media_key ? currentByKey.get(item.media_key) : undefined;
      return live && sameRevision(live, item, 'addedAt') ? live : item;
    });
    if (media[category].length === currentItems.length && media[category].every((item, index) => item === currentItems[index])) {
      media[category] = currentItems;
    }
  }
  const currentLogs = current.mediaLogs || [];
  const currentLogsById = new Map(currentLogs.map(log => [String(log?.log_id), log]));
  let mediaLogs = (persisted.mediaLogs || []).map(log => {
    const live = currentLogsById.get(String(log?.log_id));
    return live && sameRevision(live, log, 'log_date') ? live : log;
  });
  if (mediaLogs.length === currentLogs.length && mediaLogs.every((log, index) => log === currentLogs[index])) mediaLogs = currentLogs;
  return { media, mediaLogs };
};
