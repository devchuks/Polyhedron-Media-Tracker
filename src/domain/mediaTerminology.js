const WATCH_TYPES = new Set(['movies', 'tv', 'anime']);
const READ_TYPES = new Set(['manga', 'books', 'comics']);
const PLAY_TYPES = new Set(['games', 'vn']);

export const mediaCompletionTerm = (type) => {
  if (READ_TYPES.has(type)) return 'Read';
  if (PLAY_TYPES.has(type)) return 'Played';
  if (WATCH_TYPES.has(type)) return 'Watched';
  return 'Completed';
};

export const mediaActiveTerm = (type) => {
  if (READ_TYPES.has(type)) return 'Reading';
  if (PLAY_TYPES.has(type)) return 'Playing';
  if (WATCH_TYPES.has(type)) return 'Watching';
  return 'In Progress';
};

export const mediaPlanTerm = (type) => {
  if (READ_TYPES.has(type)) return 'Reading List';
  if (PLAY_TYPES.has(type)) return 'Backlog';
  if (WATCH_TYPES.has(type)) return 'Watchlist';
  return 'Planned';
};

export const mediaStatusLabel = (status, type, context = 'badge') => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'planned') return context === 'detail' ? `In ${mediaPlanTerm(type)}` : context === 'option' ? mediaPlanTerm(type) : 'Planned';
  if (normalized === 'in progress') return context === 'detail' ? `Currently ${mediaActiveTerm(type)}` : mediaActiveTerm(type);
  if (normalized === 'completed') return mediaCompletionTerm(type);
  if (normalized === 'dropped') return 'Dropped';
  return status || '';
};

export const mediaStatusActionLabel = (status, type) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'planned') return `Add to ${mediaPlanTerm(type)}`;
  if (normalized === 'in progress') return `Start ${mediaActiveTerm(type)}`;
  if (normalized === 'completed') return `Mark as ${mediaCompletionTerm(type)}`;
  if (normalized === 'dropped') return 'Mark as Dropped';
  return status || '';
};

export const mediaCompletionDateLabel = (type) => type === 'movies' ? 'Watched On' : 'Completed On';

const DIARY_ACTIONS = Object.freeze({
  movies: ['WATCHED', 'RE-WATCHED', 'LOGGED'],
  tv: ['WATCHED', 'RE-WATCHED', 'LOGGED'],
  anime: ['WATCHED', 'RE-WATCHED', 'LOGGED'],
  manga: ['READ', 'RE-READ', 'LOGGED'],
  books: ['READ', 'RE-READ', 'LOGGED'],
  comics: ['READ', 'RE-READ', 'LOGGED'],
  games: ['PLAYED', 'RE-PLAYED', 'LOGGED'],
  vn: ['PLAYED', 'RE-PLAYED', 'LOGGED'],
});

export const diaryActionsForMediaType = (type) => [...(DIARY_ACTIONS[type] || ['LOGGED'])];

export const formatSeasonNumber = (value) => String(Math.max(0, Number.parseInt(value, 10) || 0)).padStart(2, '0');

export const mediaTypeFromPathname = (pathname) => {
  const parts = String(pathname || '').split('/').filter(Boolean);
  const directType = parts[0] === 'media' ? parts[1] : parts[0];
  return WATCH_TYPES.has(directType) || READ_TYPES.has(directType) || PLAY_TYPES.has(directType) ? directType : null;
};

export const ratingForInteraction = ({ starIndex, clientX, left, width, keyboard = false }) => {
  const fullRating = (Number(starIndex) + 1) * 2;
  if (keyboard || !Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0) return fullRating;
  return fullRating - ((clientX - left) / width < 0.5 ? 1 : 0);
};
