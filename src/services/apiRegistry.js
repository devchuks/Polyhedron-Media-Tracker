import { apiClient } from '../utils/apiClient';
import { useUIStore } from '../store/useMediaStore';
import {
  normalizeTMDB,
  normalizeAniList,
  normalizeMetron,
  normalizeVNDB,
  normalizeOpenLibrary,
  normalizeIGDB,
} from '../utils/normalizers';
import { supabase } from './supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';

const withRetry = async (fn, retries = 1, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay);
    }
    throw error;
  }
};

const invokeFunction = async (name, body) => {
  return withRetry(async () => {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const text = await error.context.text().catch(() => 'Unknown Edge Function Error');
        let errorMessage;
        try {
          errorMessage = JSON.parse(text);
        } catch {
          errorMessage = { error: text };
        }
        console.error(`🔴 [${name} Edge Function] HTTP Error:`, errorMessage);
        throw new Error(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
      }
      throw error;
    }
    if (data?.error) throw new Error(data.error);
    return data;
  });
};

const fetchMetron = async (endpoint) => {
  return await invokeFunction('metron', { endpoint });
};

const safeApiClient = async (...args) => {
  return withRetry(() => apiClient(...args));
};

const getOpenLibraryUrl = (endpoint) => {
  if (import.meta.env.DEV) return `/openlibrary-api${endpoint}`;
  return `https://openlibrary.org${endpoint}`;
};

const reportApiError = (err, serviceName) => {
  console.error(`🔴 [${serviceName}] Error Detail:`, err);
  
  let msg = `Failed to fetch data from ${serviceName}.`;
  
  if (err.status === 429) msg = `Rate limit exceeded for ${serviceName}. Please wait a moment.`;
  else if (err.status === 401 || err.status === 403) msg = `Access denied by ${serviceName}. API key may be invalid.`;
  else if (err.status >= 500) msg = `${serviceName} server is currently unavailable.`;
  else if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('CORS'))) {
    msg = `Network or CORS block. Unable to reach ${serviceName}.`;
  } else if (err.message) {
    msg = err.message;
  }
  
  useUIStore.getState().addToast(msg, 'error');
};

const fetchAniListGraphQL = async (query, variables = {}) => {
  return withRetry(async () => {
    try {
      const data = await apiClient('https://graphql.anilist.co', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, 
        body: JSON.stringify({ query, variables }) 
      });
      if (data.errors) {
        console.error("❌ [AniList] GraphQL Errors:", data.errors);
        throw new Error(data.errors[0].message);
      }
      return data.data;
    } catch (err) {
      console.error("❌ [AniList] Fetch Error:", err);
      throw err;
    }
  });
};

const GAME_STATUS_MAP = { 0: 'Released', 1: 'Alpha', 2: 'Beta', 3: 'Early Access', 4: 'Offline', 5: 'Cancelled' };
const getGameStatusLabel = (num) => GAME_STATUS_MAP[num] ?? 'Unknown';

const sessionCache = {
  details: new Map(),
  recs: new Map(),
  seasons: new Map(),
  comicIssues: new Map(),
  comicIssueDetails: new Map(),
};

export const apiRegistry = {
  searchMovies: async (query, page = 1) => {
    try {
      const data = await invokeFunction('tmdb', { path: '/search/movie', query: { query, page } });
      return { results: data.results.map((item) => normalizeTMDB(item, 'movies')), totalPages: data.total_pages || 1 };
    } catch (err) { reportApiError(err, 'TMDB (Movies)'); return { results: [], totalPages: 1 }; }
  },
  searchTV: async (query, page = 1) => {
    try {
      const data = await invokeFunction('tmdb', { path: '/search/tv', query: { query, page } });
      return { results: data.results.map((item) => normalizeTMDB(item, 'tv')), totalPages: data.total_pages || 1 };
    } catch (err) { reportApiError(err, 'TMDB (TV)'); return { results: [], totalPages: 1 }; }
  },
  searchGames: async (query, page = 1) => {
    try {
      const limit = 20; const offset = (page - 1) * limit;
      const data = await invokeFunction('igdb', { endpoint: 'games', query: `search "${query}"; fields name, slug, cover.image_id, genres.name, first_release_date, summary, total_rating, url, websites.type, websites.url; limit ${limit}; offset ${offset};` });
      return { results: (data || []).map(normalizeIGDB), totalPages: 10 };
    } catch (err) { reportApiError(err, 'IGDB'); return { results: [], totalPages: 1 }; }
  },
  searchAnime: async (query, page = 1) => {
    try {
      const safeQuery = query ? String(query).trim() : '';
      if (!safeQuery) return { results: [], totalPages: 1 };
      
      const safePage = Number(page) || 1;
      
      // ✅ Fixed: Added array brackets [SEARCH_MATCH]
      const gql = `query ($search: String, $page: Int) {
        Page(page: $page, perPage: 10) {
          pageInfo { lastPage }
          media(search: $search, type: ANIME, sort: [SEARCH_MATCH]) {
            id
            title { romaji english native }
            description(asHtml: false)
            coverImage { extraLarge large medium }
            startDate { year }
            episodes
            status
            averageScore
            siteUrl
            genres
            studios(isMain: true) { nodes { name } }
          }
        }
      }`;
      
      const res = await fetchAniListGraphQL(gql, { search: safeQuery, page: safePage });
      return {
        results: (res?.Page?.media || []).map(item => normalizeAniList(item, 'anime')),
        totalPages: res?.Page?.pageInfo?.lastPage || 1
      };
    } catch (err) { 
      reportApiError(err, 'AniList (Anime)'); 
      return { results: [], totalPages: 1 }; 
    }
  },

  searchManga: async (query, page = 1) => {
    try {
      const safeQuery = query ? String(query).trim() : '';
      if (!safeQuery) return { results: [], totalPages: 1 };
      
      const safePage = Number(page) || 1;
      
      // ✅ Fixed: Added array brackets [SEARCH_MATCH]
      const gql = `query ($search: String, $page: Int) {
        Page(page: $page, perPage: 10) {
          pageInfo { lastPage }
          media(search: $search, type: MANGA, sort: [SEARCH_MATCH]) {
            id
            title { romaji english native }
            description(asHtml: false)
            coverImage { extraLarge large medium }
            startDate { year }
            chapters
            volumes
            status
            averageScore
            siteUrl
            genres
            staff { edges { role node { name { full } } } }
          }
        }
      }`;
      
      const res = await fetchAniListGraphQL(gql, { search: safeQuery, page: safePage });
      return {
        results: (res?.Page?.media || []).map(item => normalizeAniList(item, 'manga')),
        totalPages: res?.Page?.pageInfo?.lastPage || 1
      };
    } catch (err) { 
      reportApiError(err, 'AniList (Manga)'); 
      return { results: [], totalPages: 1 }; 
    }
  },
  
  searchComics: async (query, page = 1) => {
    try {
      let searchQuery = query.trim();
      let coverYear = null;

      const yearMatch = searchQuery.match(/\b(19[5-9]\d|20[0-4]\d|2050)\b/);
      if (yearMatch) {
        coverYear = yearMatch[0];
        searchQuery = searchQuery.replace(yearMatch[0], '').replace(/\s{2,}/g, ' ').trim();
      }

      const params = new URLSearchParams();
      params.append('series_name', searchQuery);
      params.append('number', '1');
      params.append('page_size', '500');
      if (coverYear) {
        params.append('cover_year', coverYear);
      }

      const endpoint = `/api/issue/?${params.toString()}`;
      const data = await fetchMetron(endpoint);

      const allResults = (data.results || []).map(normalizeMetron);
      const perPage = 20;
      const totalPages = Math.ceil(allResults.length / perPage) || 1;
      const start = (page - 1) * perPage;
      const paginatedResults = allResults.slice(start, start + perPage);

      return { results: paginatedResults, totalPages };
    } catch (err) {
      reportApiError(err, 'Metron (Comics)');
      return { results: [], totalPages: 1 };
    }
  },

  searchVNs: async (query, page = 1) => {
    try {
      const data = await safeApiClient('https://api.vndb.org/kana/vn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: ['search', '=', query], fields: 'id, title, titles.lang, titles.title, titles.latin, released, image.url, image.thumbnail, developers.name, description', results: 10, page, count: true }) });
      return { results: (data.results || []).map(normalizeVNDB), totalPages: Math.ceil(data.count / 10) || 1 };
    } catch (err) { reportApiError(err, 'VNDB'); return { results: [], totalPages: 1 }; }
  },
  searchBooks: async (query, page = 1) => {
    try {
      const endpoint = `/search.json?q=${encodeURIComponent(query)}&limit=10&page=${page}`;
      const data = await safeApiClient(getOpenLibraryUrl(endpoint));
      return { results: (data.docs || []).map(normalizeOpenLibrary), totalPages: Math.ceil(data.numFound / 10) || 1 };
    } catch (err) { reportApiError(err, 'OpenLibrary'); return { results: [], totalPages: 1 }; }
  },

  getTVSeason: async (tvId, seasonNumber) => {
    const cacheKey = `${tvId}_${seasonNumber}`;
    if (sessionCache.seasons.has(cacheKey)) return sessionCache.seasons.get(cacheKey);

    try { 
      const result = await invokeFunction('tmdb', { path: `/tv/${tvId}/season/${seasonNumber}` }); 
      sessionCache.seasons.set(cacheKey, result);
      return result;
    } catch (err) { reportApiError(err, 'TMDB (Season Data)'); return { episodes: [] }; }
  },

  getMediaDetails: async (id, type) => {
    const cleanId = String(id).split('_season_')[0];
    const cacheKey = `${type}_${cleanId}`;
    if (sessionCache.details.has(cacheKey)) return sessionCache.details.get(cacheKey);

    try {
      let result = null;
      const queryParams = { append_to_response: 'credits,watch/providers,images,videos', include_image_language: 'en,null' };
      if (type === 'movies') result = await invokeFunction('tmdb', { path: `/movie/${cleanId}`, query: queryParams });
      else if (type === 'tv') result = await invokeFunction('tmdb', { path: `/tv/${cleanId}`, query: queryParams });
      else if (type === 'games') {
        const realId = String(cleanId).replace('igdb_', '');
        const data = await invokeFunction('igdb', { endpoint: 'games', query: `fields name, slug, cover.image_id, genres.name, first_release_date, summary, storyline, total_rating, url, websites.type, websites.url, platforms.name, artworks.image_id, screenshots.image_id, videos.video_id, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, collections.name, collections.games.name, collections.games.cover.image_id, collections.games.first_release_date, game_status; where id = ${realId};` });
        result = data?.[0] || null;
        if (result && result.game_status !== undefined) result.status = getGameStatusLabel(result.game_status);
      }
      else if (type === 'anime') result = (await fetchAniListGraphQL(`query ($id: Int) { Media(id: $id, type: ANIME) { id title { romaji english native } description(asHtml: false) trailer { id site } coverImage { extraLarge large medium } bannerImage startDate { year month day } episodes status averageScore siteUrl genres studios(isMain: true) { nodes { name } } staff(perPage: 50, sort: RELEVANCE) { edges { role node { name { full } } } } relations { edges { relationType node { id type title { romaji english } coverImage { large } } } } externalLinks { url site } } }`, { id: parseInt(cleanId) }))?.Media;
      else if (type === 'manga') result = (await fetchAniListGraphQL(`query ($id: Int) { Media(id: $id, type: MANGA) { id title { romaji english native } description(asHtml: false) coverImage { extraLarge large medium } bannerImage startDate { year month day } chapters volumes status averageScore siteUrl genres staff(perPage: 50) { edges { role node { name { full } } } } relations { edges { relationType node { id type title { romaji english } coverImage { large } } } } externalLinks { url site } } }`, { id: parseInt(cleanId) }))?.Media;
      else if (type === 'vn') result = (await safeApiClient('https://api.vndb.org/kana/vn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: ['id', '=', cleanId], fields: 'id, title, titles.lang, titles.title, titles.latin, released, image.url, image.thumbnail, developers.name, description, length, tags.name, relations.relation, relations.id, relations.title, relations.image.url, screenshots.url, extlinks.url, extlinks.label' }) })).results?.[0];
      else if (type === 'books') {
        const workPath = String(cleanId).includes('/works/') ? cleanId : `/works/${cleanId}`;
        const [work, editions] = await Promise.all([
          safeApiClient(getOpenLibraryUrl(`${workPath}.json`)),
          safeApiClient(getOpenLibraryUrl(`${workPath}/editions.json?limit=5`))
        ]);
        result = { ...work, editions: editions?.entries, workId: workPath };
      }
      else if (type === 'comics') {
        let seriesId = id;
        if (typeof id === 'string' && id.startsWith('issue_')) {
          const issueData = await fetchMetron(`/api/issue/${id.replace('issue_', '')}/`);
          if (issueData?.series?.id) seriesId = issueData.series.id;
          else throw new Error('Could not resolve series from issue');
        }
        if (typeof seriesId === 'string' && seriesId.startsWith('series_')) {
          seriesId = seriesId.replace('series_', '');
        }
        const seriesData = await fetchMetron(`/api/series/${seriesId}/`);
        if (seriesData && seriesData.id) {
          try {
            const issuesRes = await fetchMetron(`/api/series/${seriesData.id}/issue_list/`);
            if (issuesRes.results && issuesRes.results.length > 0) {
              seriesData.issue_details = issuesRes.results;
              const firstIssue = await fetchMetron(`/api/issue/${issuesRes.results[0].id}/`);
              if (firstIssue) {
                if (firstIssue.image) seriesData.image = firstIssue.image;
                if (firstIssue.credits) seriesData.credits = firstIssue.credits;
                if (!seriesData.publisher && firstIssue.series?.publisher) seriesData.publisher = firstIssue.series.publisher;
                if (firstIssue.desc) seriesData.desc = firstIssue.desc;
                if (!seriesData.year_began && firstIssue.cover_date) {
                  const year = firstIssue.cover_date.substring(0, 4);
                  if (year && !isNaN(parseInt(year))) seriesData.year_began = parseInt(year);
                }
              }
            }
          } catch (e) { console.error('Failed to fetch Metron issue details', e); }
        }
        result = seriesData;
      }

      if (result) sessionCache.details.set(cacheKey, result);
      return result;
    } catch (err) { reportApiError(err, `${type.toUpperCase()} Details`); return null; }
  },

  getRecommendations: async (id, type) => {
    const cacheKey = `${type}_${id}`;
    if (sessionCache.recs.has(cacheKey)) return sessionCache.recs.get(cacheKey);

    try {
      let result = [];
      if (type === 'movies') result = (await invokeFunction('tmdb', { path: `/movie/${id}/recommendations`, query: { page: 1 } })).results.slice(0, 6).map(i => normalizeTMDB(i, 'movies'));
      else if (type === 'tv') result = (await invokeFunction('tmdb', { path: `/tv/${id}/recommendations`, query: { page: 1 } })).results.slice(0, 6).map(i => normalizeTMDB(i, 'tv'));
      else if (type === 'games') {
        const realId = String(id).replace('igdb_', '');
        const data = await invokeFunction('igdb', { endpoint: 'games', query: `fields similar_games.name, similar_games.cover.image_id, similar_games.first_release_date, similar_games.genres.name, similar_games.slug, similar_games.summary, similar_games.total_rating, similar_games.url; where id = ${realId};` });
        result = (data?.[0]?.similar_games || []).slice(0, 6).map(normalizeIGDB);
      }
      else if (type === 'anime' || type === 'manga') {
        const res = await fetchAniListGraphQL(`query ($id: Int) { Media(id: $id, type: ${type === 'anime' ? 'ANIME' : 'MANGA'}) { recommendations(perPage: 6, sort: RATING_DESC) { nodes { mediaRecommendation { id title { english romaji native } description(asHtml: false) genres coverImage { large medium } averageScore startDate { year month day } } } } } }`, { id: parseInt(id) });
        result = (res?.Media?.recommendations?.nodes?.map(n => n.mediaRecommendation).filter(Boolean) || []).map(i => normalizeAniList(i, type));
      }
      else if (type === 'vn') {
        const data = (await safeApiClient('https://api.vndb.org/kana/vn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: ['id', '=', id], fields: 'relations.relation, relations.id, relations.title, relations.titles.lang, relations.titles.title, relations.titles.latin, relations.image.url' }) })).results?.[0];
        result = (data?.relations || []).filter(r => r.id).slice(0, 6).map(r => {
          const engTitleObj = r.titles?.find(t => t.lang === 'en' || t.lang === 'eng');
          const displayTitle = engTitleObj?.latin || engTitleObj?.title || r.title || 'Unknown VN';
          return {
            id: r.id,
            title: displayTitle,
            image: r.image?.url || "data:image/svg+xml;base64,...",
            type: 'vn',
            raw: r,
          };
        });
      }
      
      if (result.length > 0) sessionCache.recs.set(cacheKey, result);
      return result;
    } catch (err) { reportApiError(err, `${type.toUpperCase()} Recommendations`); return []; }
  },

  getComicIssueDetails: async (issueId) => {
    const cacheKey = `issue_${issueId}`;
    if (sessionCache.comicIssueDetails.has(cacheKey)) return sessionCache.comicIssueDetails.get(cacheKey);

    try {
      const data = await fetchMetron(`/api/issue/${issueId}/`);
      sessionCache.comicIssueDetails.set(cacheKey, data);
      return data;
    } catch (err) {
      reportApiError(err, 'Metron (Issue Detail)');
      return null;
    }
  },

  getComicSeriesIssues: async (seriesId, page = 1) => {
    const cacheKey = `series_${seriesId}_page_${page}`;
    if (sessionCache.comicIssues.has(cacheKey)) return sessionCache.comicIssues.get(cacheKey);

    try {
      const data = await fetchMetron(`/api/series/${seriesId}/issue_list/?page=${page}`);
      const result = {
        issues: data.results,
        totalCount: data.count,
        page,
      };
      sessionCache.comicIssues.set(cacheKey, result);
      return result;
    } catch (err) {
      reportApiError(err, 'Metron (Series Issues)');
      return { issues: [], totalCount: 0, page };
    }
  },
};