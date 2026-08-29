import { mediaCompletionDateLabel } from './mediaTerminology.js';

const LONG_FORM_TYPES = new Set(['tv', 'anime', 'manga', 'books', 'comics', 'games', 'vn']);

export const statusForStateActivityIntent = ({
  intent,
  type,
  selectedStatus,
  currentStatus,
}) => {
  if (intent === 'activity' && type !== 'tv') return 'completed';
  return String(selectedStatus || currentStatus || '').trim().toLowerCase();
};

export const lifecycleDateFields = (type, status) => {
  const normalizedStatus = String(status || '').toLowerCase();
  if (normalizedStatus === 'planned' || !normalizedStatus) return [];
  if (type === 'movies') return [{ key: 'dateStarted', label: mediaCompletionDateLabel(type) }];
  if (!LONG_FORM_TYPES.has(type)) return [];
  return [
    { key: 'dateStarted', label: 'Started On' },
    ...(normalizedStatus === 'completed' ? [{ key: 'dateCompleted', label: mediaCompletionDateLabel(type) }] : []),
  ];
};

export const persistStateOrActivity = async ({
  intent,
  media,
  type,
  log,
  saveLibrary,
  saveWithLog,
}) => {
  if (intent === 'library') {
    if (typeof saveLibrary !== 'function') throw new TypeError('Library save command is required');
    await saveLibrary(media, type);
    return { media, log: null };
  }
  if (intent === 'activity') {
    if (!log?.log_id) throw new TypeError('Activity logging requires a stable log_id');
    if (typeof saveWithLog !== 'function') throw new TypeError('Atomic media/activity save command is required');
    return saveWithLog(media, type, log);
  }
  throw new TypeError('Unknown state/activity intent');
};
