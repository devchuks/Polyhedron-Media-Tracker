export const TELEGRAM_INTENTS = Object.freeze([
  'ADD_PLANNED', 'START', 'UPDATE_PROGRESS', 'COMPLETE_ITEM', 'COMPLETE_SEASON',
  'REWATCH_ITEM', 'REWATCH_SEASON', 'RATE', 'NOTE',
]);

const normalizedText = value => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/gu, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/gu, ' ')
  .trim();

const finiteNumber = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const classifyTelegramIntent = (item = {}) => {
  const explicit = String(item.intent || '').trim().toUpperCase();
  if (TELEGRAM_INTENTS.includes(explicit)) return explicit;
  const action = String(item.action || '').trim().toLowerCase();
  const hasProgress = finiteNumber(item.progressNumber) !== null;
  const hasSeason = Number.isInteger(Number(item.season)) && Number(item.season) > 0;
  if (item.isRewatch === true) return hasSeason ? 'REWATCH_SEASON' : 'REWATCH_ITEM';
  if (action === 'completed') return hasSeason ? 'COMPLETE_SEASON' : 'COMPLETE_ITEM';
  if (action === 'in progress') return hasProgress ? 'UPDATE_PROGRESS' : 'START';
  if (action === 'planned') return 'ADD_PLANNED';
  if (action === 'dropped') return 'NOTE';
  if (hasProgress) return 'UPDATE_PROGRESS';
  if (finiteNumber(item.rawRating) !== null) return 'RATE';
  if (String(item.reviewText || '').trim()) return 'NOTE';
  return 'ADD_PLANNED';
};

export const providerForMediaType = type => ({
  movies: 'tmdb', tv: 'tmdb', comics: 'metron', games: 'igdb', anime: 'anilist',
  manga: 'anilist', vn: 'vndb', books: 'openlibrary',
}[type] || null);

export const telegramMediaTypeLabel = type => ({
  movies: 'Movie',
  tv: 'TV Show',
  comics: 'Comic',
  games: 'Game',
  anime: 'Anime',
  manga: 'Manga',
  vn: 'Visual novel',
  books: 'Book',
}[type] || 'Media');

export const telegramStatusLabel = (type, status) => {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (normalizedStatus === 'completed') {
    if (['books', 'manga', 'comics'].includes(type)) return 'Read';
    if (['games', 'vn'].includes(type)) return 'Played';
    return 'Watched';
  }
  if (normalizedStatus === 'in progress') {
    if (['books', 'manga', 'comics'].includes(type)) return 'Reading';
    if (['games', 'vn'].includes(type)) return 'Playing';
    return 'Watching';
  }
  if (normalizedStatus === 'planned') return 'Planned';
  if (normalizedStatus === 'dropped') return 'Dropped';
  return normalizedStatus.replace(/\b\w/gu, letter => letter.toUpperCase()) || 'Unknown';
};

export const formatTelegramDate = value => {
  const timestamp = finiteNumber(value);
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getUTCDate();
  const remainder = day % 100;
  const suffix = remainder >= 11 && remainder <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' })[day % 10] || 'th';
  const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${month} ${day}${suffix}, ${date.getUTCFullYear()}`;
};

export const resolveTelegramAmbiguityReply = (options, reply) => {
  const rows = (Array.isArray(options) ? options : []).filter(option => option?.id != null && option?.title);
  const rawReply = String(reply || '').trim();
  if (!rows.length || !rawReply) return null;

  if (/^[1-9]\d*$/u.test(rawReply)) {
    const optionNumber = Number(rawReply);
    if (optionNumber <= rows.length) return rows[optionNumber - 1];
  }

  const explicitIdReply = /^id\s*[:#-]?\s*(.+)$/iu.exec(rawReply);
  if (explicitIdReply) {
    const byExplicitId = rows.filter(option => String(option.id) === explicitIdReply[1].trim());
    return byExplicitId.length === 1 ? byExplicitId[0] : null;
  }

  const replyKey = normalizedText(rawReply);
  const mentionedYears = rows.filter(option => option.year && new RegExp(`(^|\\D)${String(option.year).replace(/[^0-9]/gu, '')}(\\D|$)`, 'u').test(rawReply));
  if (mentionedYears.length === 1) return mentionedYears[0];

  const byId = rows.filter(option => String(option.id) === rawReply);
  if (byId.length === 1) return byId[0];

  const byTitle = rows.filter(option => normalizedText(option.title) === replyKey);
  return byTitle.length === 1 ? byTitle[0] : null;
};

export const applyTelegramAmbiguitySelection = ({ item, selection, activityTimestamp, pendingEventId } = {}) => {
  if (!item || !selection) return null;
  return {
    ...item,
    cleanTitle: selection.title || item.cleanTitle,
    year: selection.year ?? item.year ?? null,
    providerId: String(selection.id),
    type: selection.mediaType || item.type,
    confidence: 1,
    _activityTimestamp: activityTimestamp,
    _pendingEventId: pendingEventId,
  };
};

const decisiveRankedCandidate = (candidates, allRows) => {
  if (candidates.length < 2) return candidates[0] || null;
  const withPopularity = candidates
    .map(row => ({ row, popularity: finiteNumber(row.popularity) }))
    .filter(entry => entry.popularity !== null)
    .sort((left, right) => right.popularity - left.popularity);
  if (withPopularity.length > 0) {
    const [first, second] = withPopularity;
    const runnerUp = second?.popularity || 0;
    if (first.popularity >= Math.max(runnerUp * 1.75, runnerUp + 10)) return first.row;
  }

  const providerOrdered = candidates
    .map(row => ({ row, index: allRows.indexOf(row) }))
    .sort((left, right) => left.index - right.index);
  if (providerOrdered[0]?.index === 0 && providerOrdered[1]?.index >= 3) return providerOrdered[0].row;
  return null;
};

export const selectDeterministicProviderMatch = (candidates, requestedTitle, requestedYear, requestedId = null) => {
  const rows = (Array.isArray(candidates) ? candidates : []).filter(row => row?.id != null && row?.title);
  if (!rows.length) return { match: null, ambiguous: false, options: [] };
  if (requestedId !== null && requestedId !== undefined && String(requestedId).trim()) {
    const byId = rows.filter(row => String(row.id) === String(requestedId).trim());
    if (byId.length === 1) return { match: byId[0], ambiguous: false, options: [] };
    return { match: null, ambiguous: byId.length > 1, options: byId.slice(0, 5) };
  }
  const titleKey = normalizedText(requestedTitle);
  const exactTitle = rows.filter(row => normalizedText(row.title) === titleKey);
  const year = finiteNumber(requestedYear);
  if (year !== null) {
    const exactYear = exactTitle.filter(row => Number(row.year) === year);
    if (exactYear.length === 1) return { match: exactYear[0], ambiguous: false, options: [] };
    if (exactYear.length > 1) return { match: null, ambiguous: true, options: exactYear.slice(0, 5) };
    if (exactTitle.length > 0) return { match: null, ambiguous: true, options: exactTitle.slice(0, 5) };
  }
  if (exactTitle.length === 1) return { match: exactTitle[0], ambiguous: false, options: [] };
  if (exactTitle.length > 1) {
    const decisive = decisiveRankedCandidate(exactTitle, rows);
    if (decisive) return { match: decisive, ambiguous: false, options: [] };
    return { match: null, ambiguous: true, options: exactTitle.slice(0, 5) };
  }
  const requestedTokens = new Set(titleKey.split(' ').filter(Boolean));
  const scored = rows.map(row => {
    const candidateTokens = new Set(normalizedText(row.title).split(' ').filter(Boolean));
    const overlap = [...requestedTokens].filter(token => candidateTokens.has(token)).length;
    const denominator = Math.max(requestedTokens.size, candidateTokens.size, 1);
    return { row, score: overlap / denominator };
  }).sort((a, b) => b.score - a.score);
  if (scored[0]?.score >= 0.8 && scored[0].score - (scored[1]?.score || 0) >= 0.25) {
    return { match: scored[0].row, ambiguous: false, options: [] };
  }
  const plausible = scored.filter(entry => entry.score >= 0.45).slice(0, 5).map(entry => entry.row);
  return { match: null, ambiguous: plausible.length > 0, options: plausible };
};

export const progressForTelegramIntent = ({ type, intent, season, progressNumber, progressUnit, episodeCount, total }) => {
  // A percentage is not an episode/chapter/issue count; it must never become `E50` or `50 Episodes`.
  const value = String(progressUnit || '').toLowerCase() === 'percentage' ? null : finiteNumber(progressNumber);
  const seasonNumber = finiteNumber(season);
  if (type === 'tv') {
    if (intent === 'UPDATE_PROGRESS' && seasonNumber && value && value > 0) {
      return `S${String(seasonNumber).padStart(2, '0')} E${String(Math.floor(value)).padStart(2, '0')}`;
    }
    if ((intent === 'COMPLETE_SEASON' || intent === 'REWATCH_SEASON') && seasonNumber && Number(episodeCount) > 0) {
      return `S${String(seasonNumber).padStart(2, '0')} E${String(Math.floor(episodeCount)).padStart(2, '0')}`;
    }
    return null;
  }
  if (intent === 'UPDATE_PROGRESS' && value !== null && value > 0) {
    if (type === 'anime') return `${Math.floor(value)} Episodes`;
    if (type === 'manga' || type === 'books') return `${Math.floor(value)} Chapters`;
    if (type === 'comics') return `${Math.floor(value)} Issues`;
  }
  if ((intent === 'COMPLETE_ITEM' || intent === 'REWATCH_ITEM') && Number(total) > 0) {
    if (type === 'anime') return `${Math.floor(total)} Episodes`;
    if (type === 'manga' || type === 'books') return `${Math.floor(total)} Chapters`;
    if (type === 'comics') return `${Math.floor(total)} Issues`;
  }
  return null;
};

export const diaryActionForTelegramType = (type, rewatch = false) => {
  const base = ['games', 'vn'].includes(type)
    ? 'PLAYED'
    : ['manga', 'books', 'comics'].includes(type)
      ? 'READ'
      : 'WATCHED';
  return rewatch ? `RE-${base}` : base;
};

export const buildTelegramLifecycle = ({
  existing = null,
  intent,
  type,
  activityAt,
  rating = null,
  progress = null,
  season = null,
  seasonYear = null,
} = {}) => {
  const eventTime = finiteNumber(activityAt);
  if (eventTime === null) throw new TypeError('Telegram activity timestamp is required');
  const currentStatus = existing?.status || 'planned';
  const consumptionIntent = ['START', 'UPDATE_PROGRESS', 'COMPLETE_ITEM', 'COMPLETE_SEASON', 'REWATCH_ITEM', 'REWATCH_SEASON'].includes(intent);
  const completesItem = intent === 'COMPLETE_ITEM' || intent === 'REWATCH_ITEM';
  const leavesCompleted = ['START', 'UPDATE_PROGRESS', 'REWATCH_SEASON'].includes(intent);
  let status = currentStatus;
  if (intent === 'ADD_PLANNED' && !existing) status = 'planned';
  if (intent === 'START' || intent === 'UPDATE_PROGRESS' || intent === 'REWATCH_SEASON') status = 'in progress';
  if (intent === 'COMPLETE_SEASON' && currentStatus !== 'completed') status = 'in progress';
  if (completesItem) status = 'completed';

  const dateStarted = existing?.dateStarted ?? (consumptionIntent ? eventTime : null);
  const dateCompleted = completesItem
    ? eventTime
    : leavesCompleted || status !== 'completed'
      ? null
      : (existing?.dateCompleted ?? null);
  const shouldLog = ['COMPLETE_ITEM', 'COMPLETE_SEASON', 'REWATCH_ITEM', 'REWATCH_SEASON', 'NOTE'].includes(intent);
  const isRewatch = intent === 'REWATCH_ITEM' || intent === 'REWATCH_SEASON';

  return {
    status,
    progress: progress ?? existing?.progress ?? null,
    rating: rating ?? existing?.rating ?? 0,
    addedAt: existing?.addedAt ?? eventTime,
    dateStarted,
    dateCompleted,
    rewatchCount: existing?.rewatchCount || 0,
    rewatchIncrement: intent === 'REWATCH_ITEM' ? 1 : 0,
    shouldLog,
    actionType: intent === 'NOTE' ? 'LOGGED' : diaryActionForTelegramType(type, isRewatch),
    seasonLabel: ['COMPLETE_SEASON', 'REWATCH_SEASON'].includes(intent) && Number(season) > 0
      ? `Season ${Math.floor(Number(season))}`
      : null,
    seasonYear: ['COMPLETE_SEASON', 'REWATCH_SEASON'].includes(intent) && seasonYear
      ? String(seasonYear)
      : null,
  };
};

const READ_MEDIA = new Set(['books', 'manga', 'comics']);
const PLAY_MEDIA = new Set(['games', 'vn']);
const consumedVerb = type => (READ_MEDIA.has(type) ? 'Read' : PLAY_MEDIA.has(type) ? 'Played' : 'Watched');
const activeVerb = type => (READ_MEDIA.has(type) ? 'reading' : PLAY_MEDIA.has(type) ? 'playing' : 'watching');
const repeatVerb = type => (READ_MEDIA.has(type) ? 'Reread' : PLAY_MEDIA.has(type) ? 'Replayed' : 'Rewatched');
const planList = type => (READ_MEDIA.has(type) ? 'reading list' : PLAY_MEDIA.has(type) ? 'backlog' : 'watchlist');
const MEDIA_ICON = { tv: '📺', anime: '🍥', movies: '🎬', games: '🎮', vn: '💬', books: '📖', manga: '📚', comics: '💥' };
const REPEAT_INTENTS = new Set(['REWATCH_ITEM', 'REWATCH_SEASON']);

// Short date for chat replies, e.g. "Oct 30, 2026".
export const formatTelegramShortDate = value => {
  const timestamp = finiteNumber(value);
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

// "12 Episodes" -> "Episode 12"; "S02 E10" stays as it is.
export const telegramPositionLabel = progress => {
  const text = String(progress || '').trim();
  const count = text.match(/^(\d+)\s*(episode|chapter|issue)s?$/iu);
  if (count) return `${count[2].charAt(0).toUpperCase()}${count[2].slice(1).toLowerCase()} ${count[1]}`;
  return text || null;
};

// A chat-style reply: what happened, then the type with its library/diary dates, the rating,
// and where the item stands (with the current position only while it is still under way).
export const telegramConfirmation = ({ title, year, type, intent, lifecycle, activityAt }) => {
  const name = `${title}${year ? ` (${year})` : ''}`;
  const season = lifecycle.seasonLabel;
  const headline = ({
    ADD_PLANNED: `📌 Added ${name} to your ${planList(type)}`,
    START: `▶️ Started ${activeVerb(type)} ${name}`,
    UPDATE_PROGRESS: `⏩ Updated progress on ${name}`,
    COMPLETE_ITEM: `✅ ${consumedVerb(type)} ${name}`,
    COMPLETE_SEASON: season ? `✅ Logged ${season} of ${name}` : `✅ ${consumedVerb(type)} ${name}`,
    REWATCH_ITEM: `🔁 ${repeatVerb(type)} ${name}`,
    REWATCH_SEASON: season ? `🔁 ${repeatVerb(type)} ${season} of ${name}` : `🔁 ${repeatVerb(type)} ${name}`,
    RATE: `⭐ Rated ${name}`,
    NOTE: `📝 Added a review of ${name}${season ? ` (${season})` : ''}`,
  })[intent] || `✏️ Updated ${name}`;

  // A diary entry shows its diary date; a repeat also shows when the item was first added.
  // Without a diary entry, the line shows when the item was added to the library.
  const addedOn = formatTelegramShortDate(lifecycle.addedAt);
  const diaryOn = lifecycle.shouldLog ? formatTelegramShortDate(activityAt) : null;
  const dates = diaryOn
    ? [REPEAT_INTENTS.has(intent) && addedOn ? `added ${addedOn}` : null, `in your diary for ${diaryOn}`]
    : [addedOn ? `added ${addedOn}` : null];
  const typeLine = [`${MEDIA_ICON[type] || '🗂️'} ${telegramMediaTypeLabel(type)}`, ...dates].filter(Boolean).join(' · ');

  const status = String(lifecycle.status || '').toLowerCase();
  const position = ['in progress', 'dropped'].includes(status) && !PLAY_MEDIA.has(type)
    ? telegramPositionLabel(lifecycle.progress)
    : null;
  const standing = `📍 ${telegramStatusLabel(type, lifecycle.status)}${position ? ` · on ${position}` : ''}`;

  return {
    headline,
    lines: [
      typeLine,
      lifecycle.rating ? `⭐ Your rating: ${lifecycle.rating}/10` : null,
      standing,
    ].filter(Boolean),
  };
};
