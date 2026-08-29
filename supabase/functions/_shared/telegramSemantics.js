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
  tv: 'TV show',
  comics: 'Comic',
  games: 'Game',
  anime: 'Anime',
  manga: 'Manga',
  vn: 'Visual novel',
  books: 'Book',
}[type] || 'Media');

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

export const progressForTelegramIntent = ({ type, intent, season, progressNumber, episodeCount, total }) => {
  const value = finiteNumber(progressNumber);
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
    if (type === 'games' || type === 'vn') return `${Math.min(100, value)}%`;
  }
  if ((intent === 'COMPLETE_ITEM' || intent === 'REWATCH_ITEM') && Number(total) > 0) {
    if (type === 'anime') return `${Math.floor(total)} Episodes`;
    if (type === 'manga' || type === 'books') return `${Math.floor(total)} Chapters`;
    if (type === 'comics') return `${Math.floor(total)} Issues`;
  }
  if ((intent === 'COMPLETE_ITEM' || intent === 'REWATCH_ITEM') && ['games', 'vn'].includes(type)) return '100%';
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

export const telegramConfirmation = ({ title, intent, lifecycle, activityAt }) => {
  const verb = ({
    ADD_PLANNED: 'Added', START: 'Started', UPDATE_PROGRESS: 'Updated', COMPLETE_ITEM: 'Completed',
    COMPLETE_SEASON: 'Completed & logged', REWATCH_ITEM: 'Rewatched', REWATCH_SEASON: 'Rewatched & logged',
    RATE: 'Rated', NOTE: 'Logged',
  })[intent] || 'Updated';
  const date = new Date(activityAt).toISOString().slice(0, 10);
  const activity = lifecycle.actionType
    ? lifecycle.actionType.toLowerCase().replace(/(^|-)\w/gu, value => value.toUpperCase())
    : null;
  const stateEvent = ({ ADD_PLANNED: 'Added', START: 'Started', UPDATE_PROGRESS: 'Updated', RATE: 'Rated' })[intent] || null;
  const event = lifecycle.shouldLog
    ? `${activity} · ${date}`
    : stateEvent
      ? `${stateEvent} · ${date}`
      : null;
  return {
    headline: `${verb} ${title}${lifecycle.seasonLabel ? ` — ${lifecycle.seasonLabel}` : ''}`,
    lines: [
      event,
      lifecycle.progress ? `Progress · ${lifecycle.progress}` : null,
    ].filter(Boolean),
  };
};
