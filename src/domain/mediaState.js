import { canonicalizeLog, canonicalizeMediaItem, mediaKeyFor } from './mediaIdentity.js';

const USER_FIELDS = new Set([
  'status', 'progress', 'rating', 'addedAt', 'dateStarted', 'dateCompleted', 'rewatchCount',
  'readIssueIds', 'updatedAt', 'user_id',
]);

const validTime = (value, fallback = 0) => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : fallback;
};

export const filterDashboardItems = (items, status = 'all', query = '') => {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  return (Array.isArray(items) ? items : [])
    .filter(item => status === 'all' || item.status === status)
    .filter(item => !normalizedQuery || String(item.title || '').toLowerCase().includes(normalizedQuery));
};

export const upsertDiaryLog = (logs, incomingLog) => {
  const incoming = canonicalizeLog(incomingLog);
  const incomingLogId = String(incoming.log_id || '').trim();
  if (!incomingLogId) throw new TypeError('Diary log requires a stable log_id');
  const index = logs.findIndex(existing => String(existing.log_id) === incomingLogId);
  const next = [...logs];
  if (index >= 0) {
    const existing = canonicalizeLog(next[index]);
    next[index] = {
      ...existing,
      ...incoming,
      log_id: existing.log_id,
      review_text: Object.hasOwn(incomingLog, 'review_text') ? incomingLog.review_text : existing.review_text,
    };
  } else {
    next.push(incoming);
  }
  return next.sort((a, b) => validTime(b.log_date) - validTime(a.log_date));
};

export const serializeTvProgress = (status, season, episode) => {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode);
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1) return '';
  if (!Number.isInteger(episodeNumber) || episodeNumber < 1) return '';
  if (normalizedStatus === 'planned') return '';
  return `S${String(seasonNumber).padStart(2, '0')} E${String(episodeNumber).padStart(2, '0')}`;
};

export const preferredMediaImage = item => item?.image || item?.apiData?.image || null;

export const findMediaForLog = (media, log) => {
  let targetKey;
  try {
    targetKey = mediaKeyFor(log);
  } catch {
    return undefined;
  }
  for (const [category, items] of Object.entries(media || {})) {
    for (const item of items || []) {
      try {
        if (mediaKeyFor(item, category) === targetKey) return item;
      } catch {
        // Ignore malformed legacy rows instead of attaching a log to the wrong media.
      }
    }
  }
  return undefined;
};

export const applyStatusTransition = (item, status, completionTime = Date.now(), options = {}) => {
  const nextStatus = String(status || '').toLowerCase();
  const isCompleted = nextStatus === 'completed' && !options.milestoneOnly;
  const parsedCompletion = Number(completionTime);
  return {
    ...item,
    status: nextStatus,
    dateCompleted: isCompleted
      ? (Number.isFinite(parsedCompletion) ? parsedCompletion : Date.now())
      : null,
  };
};

export const mergeProviderMetadata = (currentItem, providerPatch) => {
  const next = { ...currentItem };
  for (const [key, value] of Object.entries(providerPatch || {})) {
    if (!USER_FIELDS.has(key)) next[key] = value;
  }
  if (providerPatch?.apiData) {
    next.apiData = {
      ...(currentItem?.apiData || {}),
      ...providerPatch.apiData,
      raw: {
        ...(currentItem?.apiData?.raw || {}),
        ...(providerPatch.apiData.raw || {}),
      },
    };
  }
  return next;
};

const authoritativeIssueTotal = (item, explicitTotal) => {
  const raw = item?.apiData?.raw || item?.raw || {};
  const value = explicitTotal ?? raw.issue_count ?? raw.issuesCount;
  const total = Number(value);
  return Number.isInteger(total) && total > 0 ? total : null;
};

export const toggleIssueState = (item, issueId, orderedIssueIds = [], explicitTotal) => {
  const target = String(issueId);
  const current = [...new Set((item?.readIssueIds || []).map(String))];
  const isRead = current.includes(target);
  let nextRead;
  if (isRead) {
    nextRead = current.filter(id => id !== target);
  } else {
    const ordered = [...new Set((orderedIssueIds || []).map(String))];
    const targetIndex = ordered.indexOf(target);
    nextRead = [...new Set([...current, ...(targetIndex >= 0 ? ordered.slice(0, targetIndex + 1) : [target])])];
  }

  const total = authoritativeIssueTotal(item, explicitTotal);
  const allRead = total !== null && nextRead.length >= total;
  let status = item?.status || 'planned';
  let dateCompleted = item?.dateCompleted ?? null;
  if (allRead) {
    status = 'completed';
    dateCompleted ||= Date.now();
  } else if (status === 'completed') {
    status = nextRead.length ? 'in progress' : 'planned';
    dateCompleted = null;
  } else if (nextRead.length && status === 'planned') {
    status = 'in progress';
  }

  return {
    ...item,
    readIssueIds: nextRead,
    progress: `${nextRead.length} Issues`,
    status,
    dateCompleted,
  };
};

export const normalizeProviderScore = (type, raw = {}, fallback = 0) => {
  if (type === 'anime' || type === 'manga') return Number(raw.averageScore ?? fallback) || 0;
  if (type === 'games') return Number(raw.total_rating ?? raw.rating ?? fallback) || 0;
  if (type === 'vn') return Number(raw.rating ?? fallback) / (raw.rating != null ? 10 : 1) || 0;
  return Number(raw.vote_average ?? fallback) || 0;
};

export const canonicalizeMediaCollection = (media = {}) => Object.fromEntries(
  Object.entries(media).map(([category, items]) => [
    category,
    (Array.isArray(items) ? items : []).map(item => canonicalizeMediaItem(item, category)),
  ]),
);
