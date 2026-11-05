// One-way VNDB -> Polyhedron sync for visual novels. Like the AniList sync, each list entry is
// compared with the VNDB values seen last time and only fields that changed there are applied.
import { createMediaKey } from './mediaIdentity.js';
import { applyActivityLifecycle, diaryActionForType } from './activityLifecycle.js';
import { timestampFromDateInput } from '../utils/calendarDate.js';
import { existingFinishNear, reviewEntryForFinish } from '../../supabase/functions/_shared/diaryMerge.js';

// VNDB's built-in list labels, most decisive first (an entry can carry several).
const LABEL_STATUS = [[2, 'completed'], [4, 'dropped'], [1, 'in progress'], [3, 'in progress'], [5, 'planned']];

export const vndbStatus = labels => {
  const ids = new Set((labels || []).map(label => Number(label?.id)));
  return LABEL_STATUS.find(([id]) => ids.has(id))?.[1] || null;
};

// VNDB votes are 10-100; Polyhedron ratings are whole 1-10 values.
export const vndbRating = vote => {
  const value = Number(vote);
  return Number.isFinite(value) && value > 0 ? Math.min(10, Math.max(1, Math.round(value / 10))) : 0;
};

export const vndbDate = value => (/^\d{4}-\d{2}-\d{2}$/u.test(String(value || '')) ? timestampFromDateInput(value) : null);

export const vndbMediaKey = vnId => createMediaKey('vndb', 'vn', String(vnId));

export const vndbSnapshot = entry => ({
  status: vndbStatus(entry?.labels),
  vote: Number(entry?.vote) || 0,
  started: vndbDate(entry?.started),
  finished: vndbDate(entry?.finished),
  lastmod: Number(entry?.lastmod) || 0,
});

const sameValue = (left, right) => (left ?? null) === (right ?? null);

/**
 * Plans the library and diary changes for one VNDB list entry ({ media, log, logUpdate, snapshot }).
 * A title not yet in the library takes every VNDB value; one already there only takes fields that
 * changed on VNDB since `previous`, so edits made on Polyhedron are kept.
 */
export const planVndbEntry = ({ entry, localItem, previous, logs = [], now = Date.now(), createHistory = true, normalize }) => {
  const snapshot = vndbSnapshot(entry);
  const empty = { media: null, log: null, logUpdate: null, snapshot };
  if (!snapshot.status && !localItem) return empty; // Blacklisted or vote-only entries are not imported.

  const changed = field => !localItem || !previous || !sameValue(previous[field], snapshot[field]);
  const normalized = localItem ? null : normalize({ ...entry.vn, id: entry.id });
  const base = localItem || {
    ...normalized,
    apiData: normalized,
    status: 'planned', progress: '', rating: 0, rewatchCount: 0, dateStarted: null, dateCompleted: null,
    addedAt: Number(entry.added) > 0 ? Number(entry.added) * 1000 : undefined,
  };
  const next = { ...base };
  if (snapshot.status && changed('status')) next.status = snapshot.status;
  if (changed('vote') && (snapshot.vote > 0 || previous)) next.rating = vndbRating(snapshot.vote);

  const finished = next.status === 'completed';
  const finishChanged = finished && (changed('status') || changed('finished'));
  const finishAt = snapshot.finished ?? (finishChanged ? now : base.dateCompleted ?? now);
  const startedEdited = snapshot.started !== null && changed('started');
  const media = applyActivityLifecycle(next, {
    status: next.status,
    activityAt: finished ? finishAt : now,
    explicitStartedAt: startedEdited ? snapshot.started : undefined,
    allowStartedEdit: startedEdited,
    provesConsumption: next.status === 'in progress',
    completesItem: finishChanged,
  });
  const mediaChanged = !localItem || ['status', 'rating', 'dateStarted', 'dateCompleted']
    .some(field => !sameValue(media[field], localItem[field]));

  // Diary: one Played entry per VN (VNDB has no replay count), merged with a nearby review.
  let log = null;
  let logUpdate = null;
  const isNewFinish = snapshot.status === 'completed' && (previous
    ? previous.status !== 'completed' || !sameValue(previous.finished, snapshot.finished)
    : createHistory);
  if (isNewFinish) {
    const mediaKey = vndbMediaKey(entry.id);
    const logId = `vndb-${entry.id}`;
    const logDate = new Date(finishAt).toISOString();
    const rating = vndbRating(snapshot.vote) || Number(media.rating) || 0;
    const titleLogs = logs.filter(item => item?.media_key === mediaKey);
    const own = titleLogs.find(item => String(item.log_id) === logId);
    const review = !own && reviewEntryForFinish(titleLogs, { mediaKey, finishAt });
    if (own) {
      if (!sameValue(Date.parse(own.log_date), finishAt)) logUpdate = { log_id: own.log_id, patch: { log_date: logDate } };
    } else if (review) {
      logUpdate = { log_id: review.log_id, patch: { action_type: diaryActionForType('vn'), log_date: logDate, ...(rating ? { rating } : {}) } };
    } else if (!existingFinishNear(titleLogs, { mediaKey, finishAt })) {
      log = {
        log_id: logId, media_type: 'vn', action_type: diaryActionForType('vn'), log_date: logDate, review_text: '',
        image: media.image || media.apiData?.image || null, ...(rating ? { rating } : {}),
      };
    }
  }

  return { media: mediaChanged || log ? media : null, log, logUpdate, snapshot };
};
