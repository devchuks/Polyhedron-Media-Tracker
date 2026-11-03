import { serializeTvProgress } from './mediaState.js';
import { applyActivityLifecycle, isMeaningfulProgress } from './activityLifecycle.js';

const positiveInteger = (value, label) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new TypeError(`${label} must be a positive integer`);
  return parsed;
};

const finiteTimestamp = (value, label) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a finite timestamp`);
  return parsed;
};

const normalizedStatus = status => String(status || '').trim().toLowerCase();

// The season number of stored `Sxx Exx` progress, or 0 when there is none.
export const progressSeason = progress => {
  const match = String(progress || '').match(/S(\d+)\s*E\d+/iu);
  return match ? Number.parseInt(match[1], 10) : 0;
};

export const saveTvLibraryState = (item, {
  status,
  season,
  episode,
  dateStarted = item?.dateStarted ?? null,
  allowStartedEdit = false,
  activityTimestamp,
  completionTimestamp,
  rating = item?.rating ?? 0,
  startingRewatch = false,
  completingRewatch = false,
  completedDateEdited = false,
} = {}) => {
  const nextStatus = startingRewatch ? 'in progress' : normalizedStatus(status || item?.status);
  if (!nextStatus) throw new TypeError('TV status is required');

  const selectedProgress = serializeTvProgress(nextStatus, season, episode);
  let progress = selectedProgress || item?.progress || '';
  if (nextStatus === 'planned' || startingRewatch) progress = '';
  if (item?.status === 'planned' && nextStatus === 'in progress' && !selectedProgress) progress = '';

  const activityTime = finiteTimestamp(activityTimestamp ?? completionTimestamp ?? Date.now(), 'TV activity date');
  const completionTime = nextStatus === 'completed'
    ? finiteTimestamp(completionTimestamp ?? activityTime, 'TV completion date')
    : activityTime;
  const next = {
    ...item,
    status: nextStatus,
    progress,
    rating,
    rewatchCount: (item?.rewatchCount || 0) + (nextStatus === 'completed' && completingRewatch ? 1 : 0),
  };
  return applyActivityLifecycle(next, {
    status: nextStatus,
    activityAt: completionTime,
    explicitStartedAt: dateStarted,
    allowStartedEdit,
    provesConsumption: nextStatus === 'in progress' || isMeaningfulProgress(selectedProgress),
    completesItem: nextStatus === 'completed' && (item?.status !== 'completed' || completingRewatch || completedDateEdited),
  });
};

export const completeTvSeries = (item, command = {}) => saveTvLibraryState(item, {
  ...command,
  status: 'completed',
  completingRewatch: Boolean(command.isRewatch),
});

export const startTvRewatch = (item, command = {}) => saveTvLibraryState(item, {
  ...command,
  status: 'in progress',
  startingRewatch: true,
});

export const buildTvSeasonCompletion = (item, {
  season,
  episodeCount,
  seasonYear,
  completedAt,
  reviewText = '',
  image,
  isRewatch = false,
  logId,
  createLogId,
  dateStarted = item?.dateStarted ?? null,
  allowStartedEdit = false,
  rating = item?.rating ?? 0,
} = {}) => {
  const seasonNumber = positiveInteger(season, 'TV season');
  const finalEpisode = positiveInteger(episodeCount, 'TV episode count');
  const logDate = finiteTimestamp(completedAt ?? Date.now(), 'TV season activity date');
  const stableLogId = String(logId || createLogId?.() || '').trim();
  if (!stableLogId) throw new TypeError('TV season activity requires a stable log_id');

  const preservesCompletedSeries = item?.status === 'completed' && !isRewatch;
  // Logging an earlier season is history only; it never rewinds later current progress
  // (a rewatch deliberately restarts the viewing position).
  const keepsLaterProgress = !isRewatch && progressSeason(item?.progress) > seasonNumber;
  const media = applyActivityLifecycle({
    ...item,
    status: preservesCompletedSeries ? 'completed' : 'in progress',
    progress: keepsLaterProgress ? item.progress : serializeTvProgress('in progress', seasonNumber, finalEpisode),
    rating,
    dateCompleted: preservesCompletedSeries ? item.dateCompleted : null,
    rewatchCount: item?.rewatchCount || 0,
  }, {
    status: preservesCompletedSeries ? 'completed' : 'in progress',
    activityAt: logDate,
    explicitStartedAt: dateStarted,
    allowStartedEdit,
    provesConsumption: true,
    completesItem: false,
  });

  const log = {
    log_id: stableLogId,
    media_id: media.id,
    media_type: 'tv',
    action_type: isRewatch ? 'RE-WATCHED' : 'WATCHED',
    log_date: new Date(logDate).toISOString(),
    review_text: String(reviewText || '').trim(),
    image: image || media.image || media.apiData?.image || null,
    season_label: `Season ${seasonNumber}`,
    season_year: seasonYear ? String(seasonYear) : undefined,
  };

  return { media, log };
};

export const executeTvSeasonCompletion = async ({
  item,
  command,
  saveMediaWithLog,
  createLogId,
}) => {
  if (typeof saveMediaWithLog !== 'function') throw new TypeError('TV season save command is required');
  const transition = buildTvSeasonCompletion(item, {
    ...command,
    ...(createLogId ? { createLogId } : {}),
  });
  await saveMediaWithLog(transition.media, 'tv', transition.log);
  return transition;
};

// Selectable seasons: the provider's numbered seasons (specials excluded), or 1..count,
// always including the season already stored in progress.
export const tvSeasonOptions = (seasons = [], numberOfSeasons = 0, currentSeason = 1) => {
  const numbers = new Set((seasons || []).map(season => Number(season?.season_number)).filter(n => Number.isInteger(n) && n > 0));
  if (!numbers.size) {
    const count = Math.max(1, Number.parseInt(numberOfSeasons, 10) || 0);
    for (let n = 1; n <= count; n += 1) numbers.add(n);
  }
  const current = Number(currentSeason);
  if (Number.isInteger(current) && current > 0) numbers.add(current);
  return [...numbers].sort((a, b) => a - b);
};

export const TV_WHOLE_SHOW = 'series';

// The diary target a TV log window opens with: the whole show for a finished show,
// otherwise the season the user is currently up to.
export const defaultTvDiaryTarget = (item, presetSeason) => {
  const preset = Number(presetSeason);
  if (Number.isInteger(preset) && preset > 0) return preset;
  if (normalizedStatus(item?.status) === 'completed') return TV_WHOLE_SHOW;
  return progressSeason(item?.progress) || 1;
};

// One explicit "Add to diary" command for a TV show. It always creates exactly one diary
// entry: either for the selected season (never backfilling others) or for the whole show.
// Finishing the final season may also mark the show watched, but only when asked to.
export const buildTvDiaryEntry = (item, {
  target,
  episodeCount,
  seasonYear,
  watchedAt,
  reviewText = '',
  image,
  isRewatch = false,
  finishesShow = false,
  rating = item?.rating ?? 0,
  dateStarted = item?.dateStarted ?? null,
  allowStartedEdit = false,
  createLogId,
} = {}) => {
  const loggedAt = finiteTimestamp(watchedAt ?? Date.now(), 'TV diary date');
  const ratingField = Number(rating) > 0 ? { rating } : {};

  if (target === TV_WHOLE_SHOW) {
    const logId = String(createLogId?.() || '').trim();
    if (!logId) throw new TypeError('TV diary entry requires a stable log_id');
    const media = completeTvSeries(item, {
      completionTimestamp: loggedAt,
      activityTimestamp: loggedAt,
      dateStarted,
      allowStartedEdit,
      rating,
      isRewatch,
      completedDateEdited: true,
    });
    return {
      media,
      log: {
        log_id: logId,
        media_id: media.id,
        media_type: 'tv',
        action_type: isRewatch ? 'RE-WATCHED' : 'WATCHED',
        log_date: new Date(loggedAt).toISOString(),
        review_text: String(reviewText || '').trim(),
        image: image || media.image || media.apiData?.image || null,
        ...ratingField,
      },
    };
  }

  const season = buildTvSeasonCompletion(item, {
    season: target,
    episodeCount,
    seasonYear,
    completedAt: loggedAt,
    reviewText,
    image,
    isRewatch,
    createLogId,
    dateStarted,
    allowStartedEdit,
    rating,
  });
  const media = finishesShow
    ? completeTvSeries(season.media, {
      completionTimestamp: loggedAt,
      activityTimestamp: loggedAt,
      dateStarted: season.media.dateStarted,
      rating,
      isRewatch,
    })
    : season.media;
  return { media, log: { ...season.log, ...ratingField } };
};

// True when stored progress sits on the last episode of a season (`S02 E10` of a 10-episode
// season): the viewer has caught up and is waiting for the next season, not mid-way through it.
// Unknown season sizes return false, so a show is never hidden on a guess.
export const isAtSeasonFinale = item => {
  const match = String(item?.progress || '').match(/S(\d+)\s*E(\d+)/iu);
  if (!match) return false;
  const seasonNumber = Number.parseInt(match[1], 10);
  const episodeNumber = Number.parseInt(match[2], 10);
  const seasons = item?.apiData?.raw?.seasons || item?.raw?.seasons || [];
  const season = seasons.find(entry => Number(entry?.season_number) === seasonNumber);
  const episodeCount = Number(season?.episode_count);
  return Number.isInteger(episodeCount) && episodeCount > 0 && episodeNumber >= episodeCount;
};
