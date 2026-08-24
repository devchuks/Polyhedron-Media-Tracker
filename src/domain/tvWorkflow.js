import { serializeTvProgress } from './mediaState.js';

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

export const saveTvLibraryState = (item, {
  status,
  season,
  episode,
  dateStarted = item?.dateStarted ?? null,
  completionTimestamp,
  rating = item?.rating ?? 0,
  startingRewatch = false,
  completingRewatch = false,
} = {}) => {
  const nextStatus = startingRewatch ? 'in progress' : normalizedStatus(status || item?.status);
  if (!nextStatus) throw new TypeError('TV status is required');

  const selectedProgress = serializeTvProgress(nextStatus, season, episode);
  let progress = selectedProgress || item?.progress || '';
  if (nextStatus === 'planned' || startingRewatch) progress = '';
  if (item?.status === 'planned' && nextStatus === 'in progress' && !selectedProgress) progress = '';

  const dateCompleted = nextStatus === 'completed'
    ? finiteTimestamp(completionTimestamp ?? item?.dateCompleted ?? Date.now(), 'TV completion date')
    : null;

  return {
    ...item,
    status: nextStatus,
    progress,
    rating,
    dateStarted,
    dateCompleted,
    rewatchCount: (item?.rewatchCount || 0) + (nextStatus === 'completed' && completingRewatch ? 1 : 0),
  };
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
  rating = item?.rating ?? 0,
} = {}) => {
  const seasonNumber = positiveInteger(season, 'TV season');
  const finalEpisode = positiveInteger(episodeCount, 'TV episode count');
  const logDate = finiteTimestamp(completedAt ?? Date.now(), 'TV season activity date');
  const stableLogId = String(logId || createLogId?.() || '').trim();
  if (!stableLogId) throw new TypeError('TV season activity requires a stable log_id');

  const preservesCompletedSeries = item?.status === 'completed' && !isRewatch;
  const media = {
    ...item,
    status: preservesCompletedSeries ? 'completed' : 'in progress',
    progress: serializeTvProgress('in progress', seasonNumber, finalEpisode),
    rating,
    dateStarted,
    dateCompleted: preservesCompletedSeries ? item.dateCompleted : null,
    rewatchCount: item?.rewatchCount || 0,
  };

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
