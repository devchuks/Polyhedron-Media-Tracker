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
