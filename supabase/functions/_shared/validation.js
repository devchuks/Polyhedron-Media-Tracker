const clampInt = (value, { name, min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new TypeError(`Invalid ${name || 'integer'}`);
  return parsed;
};

const escapeIgdbString = value => String(value || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .trim()
  .slice(0, 200);

const TMDB_PATHS = [
  /^\/search\/(movie|tv)$/,
  /^\/discover\/(movie|tv)$/,
  /^\/trending\/(movie|tv)\/(day|week)$/,
  /^\/movie\/(upcoming|popular)$/,
  /^\/tv\/(on_the_air|popular)$/,
  /^\/(movie|tv)\/\d+$/,
  /^\/(movie|tv)\/\d+\/recommendations$/,
  /^\/tv\/\d+\/season\/\d+$/,
  /^\/person\/\d+$/,
  /^\/(company|network)\/\d+$/,
];

const TMDB_QUERY_KEYS = new Set([
  'query', 'page', 'append_to_response', 'include_image_language', 'sort_by', 'with_genres',
  'with_companies', 'with_networks', 'vote_count.gte', 'primary_release_date.gte',
  'primary_release_date.lte', 'first_air_date.gte', 'first_air_date.lte',
  'year', 'primary_release_year', 'first_air_date_year', 'include_adult', 'language', 'region',
]);

export const assertAllowedTmdbRequest = (path, query = {}) => {
  const cleanPath = String(path || '').trim();
  if (!TMDB_PATHS.some(pattern => pattern.test(cleanPath))) throw new TypeError('TMDB path is not allowed');
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new TypeError('Invalid TMDB query');
  const cleanQuery = {};
  for (const [key, value] of Object.entries(query)) {
    if (!TMDB_QUERY_KEYS.has(key)) throw new TypeError(`TMDB query field is not allowed: ${key}`);
    if (key === 'page') cleanQuery[key] = clampInt(value, { name: 'page', max: 500 });
    else cleanQuery[key] = String(value).slice(0, 500);
  }
  return { path: cleanPath, query: cleanQuery };
};

const METRON_PATH = /^\/(issue\/(?:\d+\/)?|series\/\d+\/(?:issue_list\/)?|publisher\/\d+\/|creator\/\d+\/)$/;
const METRON_QUERY_KEYS = new Set([
  'series_name', 'number', 'page', 'page_size', 'cover_year', 'publisher_id', 'creator_id',
  'store_date_range_after', 'store_date_range_before',
]);

export const assertAllowedMetronPath = endpoint => {
  const raw = String(endpoint || '').trim();
  if (raw.length > 1_000) throw new TypeError('Metron path is too long');
  const parsed = new URL(raw.replace(/^\/api/, '') || '/', 'https://metron.invalid');
  if (!METRON_PATH.test(parsed.pathname)) throw new TypeError('Metron path is not allowed');
  for (const [key, value] of parsed.searchParams) {
    if (!METRON_QUERY_KEYS.has(key)) throw new TypeError(`Metron query field is not allowed: ${key}`);
    if (key === 'page') clampInt(value, { name: 'page', max: 10_000 });
    if (key === 'page_size') clampInt(value, { name: 'page_size', max: 100 });
    if (['publisher_id', 'creator_id'].includes(key)) clampInt(value, { name: key });
    if (key === 'cover_year') clampInt(value, { name: 'cover_year', min: 1800, max: 2200 });
  }
  return `${parsed.pathname}${parsed.search}`;
};

const GAME_FIELDS = 'name, slug, cover.image_id, artworks.image_id, genres.id, genres.name, themes.id, themes.name, first_release_date, summary, rating, total_rating, url, websites.type, websites.url';

export const buildIgdbRequest = (operation, params = {}) => {
  if (operation === 'searchGames') {
    const page = clampInt(params.page ?? 1, { name: 'page', max: 500 });
    const query = escapeIgdbString(params.query);
    if (!query) throw new TypeError('Invalid search query');
    return { endpoint: 'games', query: `search "${query}"; fields ${GAME_FIELDS}; limit 20; offset ${(page - 1) * 20};` };
  }
  if (operation === 'gameDetails') {
    const id = clampInt(params.id, { name: 'identifier' });
    return { endpoint: 'games', query: `fields ${GAME_FIELDS}, storyline, platforms.name, artworks.image_id, screenshots.image_id, videos.video_id, involved_companies.company.id, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, collections.name, collections.games.name, collections.games.cover.image_id, collections.games.first_release_date, game_status; where id = ${id};` };
  }
  if (operation === 'gameRecommendations') {
    const id = clampInt(params.id, { name: 'identifier' });
    return { endpoint: 'games', query: `fields similar_games.name, similar_games.cover.image_id, similar_games.first_release_date, similar_games.genres.name, similar_games.slug, similar_games.summary, similar_games.total_rating, similar_games.url; where id = ${id};` };
  }
  if (operation === 'companyDetails') {
    const id = clampInt(params.id, { name: 'identifier' });
    return { endpoint: 'companies', query: `fields name, description, logo.image_id, start_date; where id = ${id};` };
  }
  if (operation === 'discoverGames') {
    const page = clampInt(params.page ?? 1, { name: 'page', max: 500 });
    const filterId = params.filterType ? clampInt(params.filterId, { name: 'identifier' }) : null;
    const filters = { company: 'involved_companies.company', genre: 'genres', theme: 'themes' };
    if (params.filterType && !filters[params.filterType]) throw new TypeError('Invalid IGDB filter');
    const sort = { popularity: 'id desc', rating: 'total_rating desc', new: 'first_release_date desc', old: 'first_release_date asc' }[params.sortOrder || 'popularity'];
    if (!sort) throw new TypeError('Invalid IGDB sort');
    let where = params.filterType ? `${filters[params.filterType]} = ${filterId}` : 'id != null';
    if (['new', 'old'].includes(params.sortOrder)) where += ' & first_release_date != null';
    return { endpoint: 'games', query: `fields ${GAME_FIELDS}; where ${where}; sort ${sort}; limit 24; offset ${(page - 1) * 24};` };
  }
  if (operation === 'discoverySection') {
    const section = String(params.section || '');
    const now = Math.floor(Date.now() / 1_000);
    const sixMonthsAgo = now - 15_552_000;
    const clauses = {
      trending: `where first_release_date >= ${sixMonthsAgo} & first_release_date <= ${now} & parent_game = null & total_rating_count > 0; sort total_rating_count desc;`,
      upcoming: `where first_release_date > ${now} & parent_game = null & hypes > 0; sort hypes desc;`,
      popular: 'where total_rating_count > 500 & parent_game = null; sort total_rating desc;',
    };
    if (!clauses[section]) throw new TypeError('Invalid IGDB discovery section');
    return { endpoint: 'games', query: `fields ${GAME_FIELDS}; ${clauses[section]} limit 40;` };
  }
  throw new TypeError('IGDB operation is not allowed');
};

export const buildVndbRequest = (operation, params = {}) => {
  if (operation === 'search') {
    const query = String(params.query || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    const page = clampInt(params.page ?? 1, { name: 'page', max: 500 });
    if (!query) throw new TypeError('Invalid search query');
    return {
      filters: ['search', '=', query],
      fields: 'id, title, titles.lang, titles.title, titles.latin, released, image.url, image.thumbnail, developers.id, developers.name, description',
      results: 10,
      page,
      count: true,
    };
  }
  if (operation === 'details') {
    const id = String(params.id || '').trim();
    if (!/^v\d+$/.test(id)) throw new TypeError('Invalid VNDB identifier');
    return {
      filters: ['id', '=', id],
      fields: 'id, title, titles.lang, titles.title, titles.latin, released, image.url, image.thumbnail, developers.id, developers.name, description, tags.name, length, relations.relation, relations.id, relations.title, relations.titles.lang, relations.titles.title, relations.titles.latin, relations.image.url, screenshots.url, extlinks.url, extlinks.label',
    };
  }
  throw new TypeError('VNDB operation is not allowed');
};

export const verifyTelegramWebhookSecret = (provided, expected) => {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected || provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < provided.length; index += 1) mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
};

export const escapeTelegramHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

export const safeHttpUrl = value => {
  try {
    const parsed = new URL(String(value || '').trim());
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
};

export const readBoundedJson = async (request, maxBytes = 32_000) => {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new TypeError('Request body is too large');
  const text = await request.text();
  if (text.length > maxBytes) throw new TypeError('Request body is too large');
  return text ? JSON.parse(text) : {};
};

const rateBuckets = new Map();

export const enforceRateLimit = (request, {
  limit = 60,
  windowMs = 60_000,
  keyPrefix = 'edge',
  now = Date.now(),
} = {}) => {
  const forwarded = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const key = `${keyPrefix}:${forwarded}`;
  const current = rateBuckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 2_000) {
    for (const [bucketKey, value] of rateBuckets) {
      if (value.resetAt <= now) rateBuckets.delete(bucketKey);
    }
    while (rateBuckets.size > 2_000) {
      rateBuckets.delete(rateBuckets.keys().next().value);
    }
  }
  if (bucket.count > limit) {
    const error = new Error('Rate limit exceeded');
    error.status = 429;
    error.retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
    throw error;
  }
};
