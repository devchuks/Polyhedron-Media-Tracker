// Shared by the web app, AniList sync, and the Telegram bot so a review and the finish it
// belongs to become one diary entry, whichever of the two arrives first.

export const DIARY_MERGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// A finish already logged within this distance of another source's finish date is the same finish.
export const SAME_FINISH_WINDOW_MS = 36 * 60 * 60 * 1000;

const FINISH_ACTIONS = new Set(['WATCHED', 'RE-WATCHED', 'READ', 'RE-READ', 'PLAYED', 'RE-PLAYED']);

const timeOf = value => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const actionOf = log => String(log?.action_type || '').trim().toUpperCase();
const reviewOf = log => String(log?.review_text || '').trim();
const seasonOf = log => String(log?.season_label || '').trim();

export const isFinishEntry = log => FINISH_ACTIONS.has(actionOf(log));
export const isReviewOnlyEntry = log => actionOf(log) === 'LOGGED' && reviewOf(log) !== '';

const nearest = (logs, at, windowMs, accept) => {
  const target = timeOf(at);
  if (target === null) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const log of logs || []) {
    if (!accept(log)) continue;
    const when = timeOf(log.log_date);
    if (when === null) continue;
    const distance = Math.abs(when - target);
    if (distance <= windowMs && distance < bestDistance) {
      best = log;
      bestDistance = distance;
    }
  }
  return best;
};

// A review arriving: the finish entry of the same title (and season, when either names one)
// that it should be added to. Never one that already has a different review.
export const finishEntryForReview = (logs, { mediaKey, reviewAt, seasonLabel = '', reviewText = '' }, windowMs = DIARY_MERGE_WINDOW_MS) => {
  const text = String(reviewText || '').trim();
  return nearest(logs, reviewAt, windowMs, log => log?.media_key === mediaKey
    && isFinishEntry(log)
    && seasonOf(log) === String(seasonLabel || '').trim()
    && (reviewOf(log) === '' || (text !== '' && reviewOf(log) === text)));
};

// A finish arriving: a review-only entry of the same title (and season) to upgrade into the finish.
export const reviewEntryForFinish = (logs, { mediaKey, finishAt, seasonLabel = '' }, windowMs = DIARY_MERGE_WINDOW_MS) => (
  nearest(logs, finishAt, windowMs, log => log?.media_key === mediaKey
    && isReviewOnlyEntry(log)
    && seasonOf(log) === String(seasonLabel || '').trim())
);

// A finish arriving: an existing finish of the same title (and season) close enough to be the same one.
export const existingFinishNear = (logs, { mediaKey, finishAt, seasonLabel = '', rewatch = false }, windowMs = SAME_FINISH_WINDOW_MS) => (
  nearest(logs, finishAt, windowMs, log => log?.media_key === mediaKey
    && isFinishEntry(log)
    && actionOf(log).startsWith('RE-') === Boolean(rewatch)
    && seasonOf(log) === String(seasonLabel || '').trim())
);
