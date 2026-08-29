import { diaryActionsForMediaType } from './mediaTerminology.js';

export const DIARY_MEDIA_TYPES = Object.freeze([
  'movies',
  'tv',
  'anime',
  'manga',
  'books',
  'comics',
  'games',
  'vn',
]);

const pad = value => String(value).padStart(2, '0');

const dateValue = value => {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export const diaryDateKey = value => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'undated';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const sortDiaryLogs = logs => [...(Array.isArray(logs) ? logs : [])].sort((left, right) => {
  const dateDifference = dateValue(right.log_date) - dateValue(left.log_date);
  if (dateDifference !== 0) return dateDifference;
  return String(right.log_id || '').localeCompare(String(left.log_id || ''));
});

export const diarySeasonLabel = log => {
  if (log?.media_type !== 'tv') return null;
  const storedLabel = log.season_label ?? log.season_name;
  const normalized = String(storedLabel || '').trim();
  return normalized || null;
};

export const diaryEntryRating = log => {
  const rating = Number(log?.rating ?? log?.mediaItem?.rating);
  return Number.isFinite(rating) && rating > 0 && rating <= 10 ? rating : 0;
};

export const formatDiaryRating = value => {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0) return '';
  const bounded = Math.min(10, Math.max(0, Math.round(rating)));
  return `${'★'.repeat(Math.floor(bounded / 2))}${bounded % 2 ? '½' : ''}`;
};

export const diaryActivityOptions = logs => {
  const canonical = DIARY_MEDIA_TYPES.flatMap(diaryActionsForMediaType);
  const observed = (Array.isArray(logs) ? logs : []).map(log => String(log.action_type || 'LOGGED').toUpperCase());
  return [...new Set([...canonical, ...observed])];
};

export const filterDiaryLogs = (logs, {
  mediaType = 'all',
  activity = 'all',
  query = '',
} = {}) => {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const normalizedActivity = String(activity || 'all').toUpperCase();
  return sortDiaryLogs(logs).filter(log => {
    if (mediaType !== 'all' && log.media_type !== mediaType) return false;
    if (normalizedActivity !== 'ALL' && String(log.action_type || 'LOGGED').toUpperCase() !== normalizedActivity) return false;
    if (!normalizedQuery) return true;
    return String(log.mediaItem?.title || log.title || '').toLowerCase().includes(normalizedQuery);
  });
};

export const groupDiaryLogsByDate = logs => {
  const groups = [];
  for (const log of sortDiaryLogs(logs)) {
    const key = diaryDateKey(log.log_date);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      const date = new Date(log.log_date);
      const valid = Number.isFinite(date.getTime());
      group = {
        key,
        monthKey: valid ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}` : 'undated',
        monthLabel: valid ? date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Undated',
        month: valid ? date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() : '---',
        day: valid ? pad(date.getDate()) : '--',
        weekday: valid ? date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() : '',
        year: valid ? String(date.getFullYear()) : '',
        entries: [],
      };
      groups.push(group);
    }
    group.entries.push(log);
  }
  return groups;
};
