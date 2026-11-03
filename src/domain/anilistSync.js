// One-way AniList -> Polyhedron sync for anime and manga.
//
// Each AniList list entry is compared with the snapshot of AniList values seen last time, so
// only fields that actually changed on AniList are applied. Edits made only on Polyhedron (a
// review, a newer status) are never overwritten by unchanged AniList values.
import { createMediaKey } from './mediaIdentity.js';
import { applyActivityLifecycle, diaryActionForType } from './activityLifecycle.js';
import { timestampFromDateInput } from '../utils/calendarDate.js';
import { existingFinishNear, reviewEntryForFinish } from '../../supabase/functions/_shared/diaryMerge.js';

export const ANILIST_TYPES = Object.freeze({ anime: 'ANIME', manga: 'MANGA' });

const STATUS = Object.freeze({
  CURRENT: 'in progress',
  REPEATING: 'in progress',
  PAUSED: 'in progress', // Polyhedron has no paused status.
  PLANNING: 'planned',
  COMPLETED: 'completed',
  DROPPED: 'dropped',
});

export const anilistStatus = value => STATUS[String(value || '').toUpperCase()] || null;

// AniList scores arrive in the 10-point decimal format; Polyhedron ratings are whole 1-10 values.
export const anilistRating = score => {
  const value = Number(score);
  return Number.isFinite(value) && value > 0 ? Math.min(10, Math.max(1, Math.round(value))) : 0;
};

export const anilistProgress = (type, count) => {
  const value = Number.parseInt(count, 10);
  if (!Number.isInteger(value) || value <= 0) return '';
  return `${value} ${type === 'anime' ? 'Episodes' : 'Chapters'}`;
};

// AniList dates are calendar days; store them as that day (midday local) like the date pickers do.
export const anilistDate = fuzzy => {
  if (!fuzzy?.year || !fuzzy?.month || !fuzzy?.day) return null;
  const pad = value => String(value).padStart(2, '0');
  return timestampFromDateInput(`${fuzzy.year}-${pad(fuzzy.month)}-${pad(fuzzy.day)}`);
};

export const anilistMediaKey = (type, mediaId) => createMediaKey('anilist', type, String(mediaId));

// The AniList values the sync compares against next time.
export const anilistSnapshot = entry => ({
  status: String(entry?.status || '').toUpperCase(),
  progress: Number(entry?.progress) || 0,
  score: Number(entry?.score) || 0,
  repeat: Number(entry?.repeat) || 0,
  startedAt: anilistDate(entry?.startedAt),
  completedAt: anilistDate(entry?.completedAt),
  updatedAt: Number(entry?.updatedAt) || 0,
});

const sameValue = (left, right) => (left ?? null) === (right ?? null);

// A library item for an AniList title not yet in the library, shaped like a search-result add.
export const libraryItemFromAniList = (entry, type, normalize) => {
  const normalized = normalize(entry.media, type);
  return {
    ...normalized,
    apiData: normalized,
    image: normalized.image,
    addedAt: Number(entry.createdAt) > 0 ? Number(entry.createdAt) * 1000 : undefined,
    status: 'planned',
    progress: '',
    rating: 0,
    rewatchCount: 0,
    dateStarted: null,
    dateCompleted: null,
  };
};

/**
 * Plans the library and diary changes for one AniList entry.
 * Returns { media, log, logUpdate, snapshot }; `media`/`log`/`logUpdate` are null when nothing changes.
 * `previous` is the snapshot from the last sync (undefined the first time an entry is seen).
 * `createHistory` controls whether a first-seen completed entry gets a diary entry.
 */
export const planAniListEntry = ({
  entry, type, localItem, previous, logs = [], now = Date.now(), createHistory = true, normalize,
}) => {
  const snapshot = anilistSnapshot(entry);
  const status = anilistStatus(snapshot.status);
  if (!status || !ANILIST_TYPES[type]) return { media: null, log: null, logUpdate: null, snapshot };

  // Applying only what changed protects edits made on Polyhedron. A title not yet in the library has
  // none, so it takes every AniList value (a tracked-but-unadded title must not arrive as Planned).
  const changed = field => !localItem || !previous || !sameValue(previous[field], snapshot[field]);
  const base = localItem || libraryItemFromAniList(entry, type, normalize);
  const next = { ...base };

  if (changed('status')) next.status = status;
  if (changed('progress') && snapshot.progress > 0) next.progress = anilistProgress(type, snapshot.progress);
  // An unrated AniList entry never clears a rating given on Polyhedron, unless the score was removed on AniList.
  if (changed('score') && (snapshot.score > 0 || previous)) next.rating = anilistRating(snapshot.score);
  if (changed('repeat')) next.rewatchCount = Math.max(snapshot.repeat, Number(base.rewatchCount) || 0);

  const finished = next.status === 'completed';
  const finishChanged = finished && (changed('status') || changed('completedAt') || changed('repeat'));
  const finishAt = snapshot.completedAt ?? (finishChanged ? now : base.dateCompleted ?? now);
  const startedEdited = snapshot.startedAt !== null && changed('startedAt');

  const media = applyActivityLifecycle(next, {
    status: next.status,
    activityAt: finished ? finishAt : now,
    explicitStartedAt: startedEdited ? snapshot.startedAt : undefined,
    allowStartedEdit: startedEdited,
    provesConsumption: next.status === 'in progress' || snapshot.progress > 0,
    completesItem: finishChanged,
  });

  const fields = ['status', 'progress', 'rating', 'rewatchCount', 'dateStarted', 'dateCompleted'];
  const mediaChanged = !localItem || fields.some(field => !sameValue(media[field], localItem[field]));

  // Diary: one entry per finished viewing (first watch, each rewatch), merged with a nearby review.
  let log = null;
  let logUpdate = null;
  const isNewFinish = snapshot.status === 'COMPLETED' && (previous
    ? previous.status !== 'COMPLETED' || snapshot.repeat > previous.repeat || !sameValue(previous.completedAt, snapshot.completedAt)
    : createHistory);
  if (isNewFinish) {
    const mediaKey = anilistMediaKey(type, entry.mediaId ?? entry.media?.id);
    const rewatch = snapshot.repeat > 0;
    const logId = `anilist-${entry.id}-${snapshot.repeat}`;
    const logDate = new Date(finishAt).toISOString();
    const rating = anilistRating(snapshot.score) || Number(media.rating) || 0;
    const titleLogs = logs.filter(item => item?.media_key === mediaKey);
    const own = titleLogs.find(item => String(item.log_id) === logId);
    const review = !own && reviewEntryForFinish(titleLogs, { mediaKey, finishAt });
    if (own) {
      if (!sameValue(Date.parse(own.log_date), finishAt)) logUpdate = { log_id: own.log_id, patch: { log_date: logDate } };
    } else if (review) {
      logUpdate = {
        log_id: review.log_id,
        patch: { action_type: diaryActionForType(type, rewatch), log_date: logDate, ...(rating ? { rating } : {}) },
      };
    } else if (!existingFinishNear(titleLogs, { mediaKey, finishAt, rewatch })) {
      log = {
        log_id: logId,
        media_type: type,
        action_type: diaryActionForType(type, rewatch),
        log_date: logDate,
        review_text: '',
        image: media.image || media.apiData?.image || null,
        ...(rating ? { rating } : {}),
      };
    }
  }

  return { media: mediaChanged || log ? media : null, log, logUpdate, snapshot };
};

// Summary shown before the first sync: what importing the whole list would do.
export const previewAniListImport = (entries, libraryByKey, normalize) => {
  const counts = { total: 0, inLibrary: 0, newTitles: 0, differ: 0 };
  for (const { entry, type } of entries) {
    counts.total += 1;
    const local = libraryByKey.get(anilistMediaKey(type, entry.mediaId ?? entry.media?.id));
    if (!local) { counts.newTitles += 1; continue; }
    counts.inLibrary += 1;
    const plan = planAniListEntry({ entry, type, localItem: local, previous: undefined, createHistory: false, normalize });
    if (plan.media) counts.differ += 1;
  }
  return counts;
};
