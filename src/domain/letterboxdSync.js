// One-way Letterboxd -> Polyhedron sync for films. Each new Letterboxd diary entry becomes one
// Polyhedron diary entry (with its rating and review), merged with a matching entry if one exists.
import { createMediaKey } from './mediaIdentity.js';
import { applyActivityLifecycle, diaryActionForType } from './activityLifecycle.js';
import { timestampFromDateInput } from '../utils/calendarDate.js';
import { existingFinishNear, reviewEntryForFinish } from '../../supabase/functions/_shared/diaryMerge.js';

export const letterboxdMediaKey = tmdbId => createMediaKey('tmdb', 'movies', String(tmdbId));

// A film not yet in the library, shaped like a provider search result (details fill in on open).
export const movieFromLetterboxd = (entry, addedAt) => {
  const year = /^\d{4}$/u.test(String(entry.year)) ? String(entry.year) : '----';
  const apiData = { id: Number(entry.tmdbId), title: entry.title, year, image: entry.poster, url: `https://www.themoviedb.org/movie/${entry.tmdbId}`, raw: { id: Number(entry.tmdbId), title: entry.title } };
  return {
    id: String(entry.tmdbId), type: 'movies', subtype: 'Movies', title: entry.title, year, image: entry.poster,
    status: 'planned', progress: '', rating: 0, rewatchCount: 0, addedAt, dateStarted: null, dateCompleted: null, apiData,
  };
};

/** Returns { media, log, logUpdate } for one Letterboxd diary entry; each is null when nothing changes. */
export const planLetterboxdEntry = ({ entry, localItem, logs = [], now = Date.now() }) => {
  const watchedAt = timestampFromDateInput(entry.watchedDate) ?? now;
  const mediaKey = letterboxdMediaKey(entry.tmdbId);
  const base = localItem || movieFromLetterboxd(entry, entry.publishedAt || now);
  const wasCompleted = base.status === 'completed';
  const repeatViewing = Boolean(entry.rewatch) && wasCompleted;

  const media = applyActivityLifecycle({
    ...base,
    status: 'completed',
    rating: entry.rating > 0 ? entry.rating : base.rating,
    rewatchCount: (Number(base.rewatchCount) || 0) + (repeatViewing ? 1 : 0),
  }, {
    status: 'completed',
    activityAt: watchedAt,
    // A first watch or a rewatch is a new completion; an older non-rewatch log keeps the current date.
    completesItem: !wasCompleted || repeatViewing,
    provesConsumption: true,
  });
  const fields = ['status', 'rating', 'rewatchCount', 'dateStarted', 'dateCompleted'];
  const mediaChanged = !localItem || fields.some(field => (media[field] ?? null) !== (localItem[field] ?? null));

  const logId = `letterboxd-${String(entry.guid || `${entry.tmdbId}-${entry.watchedDate}`).replace(/^letterboxd-/u, '')}`;
  const titleLogs = logs.filter(log => log?.media_key === mediaKey);
  const action = diaryActionForType('movies', Boolean(entry.rewatch));
  const ratingField = entry.rating > 0 ? { rating: entry.rating } : {};
  const review = String(entry.review || '').trim();
  let log = null;
  let logUpdate = null;

  const own = titleLogs.find(item => String(item.log_id) === logId);
  const sameWatch = !own && existingFinishNear(titleLogs, { mediaKey, finishAt: watchedAt, rewatch: Boolean(entry.rewatch) });
  const reviewOnly = !own && !sameWatch && reviewEntryForFinish(titleLogs, { mediaKey, finishAt: watchedAt });
  const target = own || sameWatch;
  if (target) {
    // Already in the diary: only fill in a review that Polyhedron does not have yet.
    if (review && !String(target.review_text || '').trim()) logUpdate = { log_id: target.log_id, patch: { review_text: review, ...ratingField } };
  } else if (reviewOnly) {
    logUpdate = { log_id: reviewOnly.log_id, patch: { action_type: action, log_date: new Date(watchedAt).toISOString(), ...ratingField } };
  } else {
    log = {
      log_id: logId, media_type: 'movies', action_type: action, log_date: new Date(watchedAt).toISOString(),
      review_text: review, image: media.image || media.apiData?.image || null, ...ratingField,
    };
  }

  return { media: mediaChanged || log ? media : null, log, logUpdate };
};
