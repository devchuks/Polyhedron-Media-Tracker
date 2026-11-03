// Incremental cloud hydration helpers.
//
// A returning browser already holds most of its library in IndexedDB. The bulky
// provider payload (`apiData`) only changes when the row's revision changes, so
// hydration fetches every row's lightweight columns, then downloads complete
// rows only for records that are new or whose revision differs locally.

// Every media_library column except the bulky "apiData" provider payload.
export const LIGHT_MEDIA_COLUMNS = [
  'library_row_id', 'user_id', 'id', 'provider', 'provider_id', 'media_type', 'media_key',
  'title', 'type', 'subtype', 'progress', 'status', 'rating', '"addedAt"', '"dateStarted"',
  '"dateCompleted"', '"rewatchCount"', '"readIssueIds"', 'image', 'updated_at',
].join(',');

const revisionMs = value => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasProviderPayload = item => Boolean(item?.apiData && typeof item.apiData === 'object' && Object.keys(item.apiData).length > 0);

// Returns the library_row_ids whose complete row must be downloaded. `needsFullRow` lets a
// caller re-download unchanged rows whose cached payload lacks something it now relies on.
export const rowsNeedingFullFetch = (lightRows = [], localByKey = new Map(), { needsFullRow = null } = {}) => lightRows
  .filter(row => {
    const local = localByKey.get(row.media_key);
    if (!local || !hasProviderPayload(local)) return true;
    if (needsFullRow?.(local)) return true;
    const cloudRevision = revisionMs(row.updated_at);
    return cloudRevision === null || revisionMs(local.updatedAt) !== cloudRevision;
  })
  .map(row => row.library_row_id);

// Combines lightweight rows with downloaded complete rows, reusing the local
// provider payload only where the revision proves it is unchanged.
export const assembleCloudRows = (lightRows = [], fullRows = [], localByKey = new Map()) => {
  const fullById = new Map(fullRows.map(row => [String(row.library_row_id), row]));
  return lightRows.map(row => {
    const full = fullById.get(String(row.library_row_id));
    if (full) return full;
    const local = localByKey.get(row.media_key);
    return { ...row, apiData: local?.apiData ?? {} };
  });
};

export const recordsEqual = (left, right) => {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!recordsEqual(left[key], right[key])) return false;
  }
  return true;
};

// Keeps the previous object (and array) identity for records that a sync left
// unchanged, so unchanged cards and detail views do not re-render or remount.
export const reuseUnchangedRecords = (previous = {}, next = {}) => {
  const media = {};
  for (const [category, items] of Object.entries(next.media || {})) {
    const previousItems = previous.media?.[category] || [];
    const previousByKey = new Map(previousItems.map(item => [item.media_key, item]));
    const reused = items.map(item => {
      const prior = previousByKey.get(item.media_key);
      return prior && recordsEqual(prior, item) ? prior : item;
    });
    const unchanged = reused.length === previousItems.length && reused.every((item, index) => item === previousItems[index]);
    media[category] = unchanged ? previousItems : reused;
  }
  const previousLogs = previous.mediaLogs || [];
  const previousLogsById = new Map(previousLogs.map(log => [String(log.log_id), log]));
  const logs = (next.mediaLogs || []).map(log => {
    const prior = previousLogsById.get(String(log.log_id));
    return prior && recordsEqual(prior, log) ? prior : log;
  });
  const logsUnchanged = logs.length === previousLogs.length && logs.every((log, index) => log === previousLogs[index]);
  return {
    ...next,
    media,
    mediaLogs: logsUnchanged ? previousLogs : logs,
    deletedMediaKeys: recordsEqual(previous.deletedMediaKeys, next.deletedMediaKeys) ? previous.deletedMediaKeys : next.deletedMediaKeys,
    deletedLogIds: recordsEqual(previous.deletedLogIds, next.deletedLogIds) ? previous.deletedLogIds : next.deletedLogIds,
  };
};
