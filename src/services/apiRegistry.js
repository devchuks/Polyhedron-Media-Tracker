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
  people: new Map(),
};

const enforceCacheLimit = (map, limit = 50) => {
  if (map.size >= limit) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }
};

const mergeSeriesAndIssues = (seriesList, issuesList) => {
  return seriesList.map(series => {
    const sName = String(series.name || '').trim().toLowerCase();
    const sYear = series.year_began;
    const issueMatch = issuesList.find(issue => {
      const iName = String(issue.series?.name || issue.series || '').trim().toLowerCase();
      if (iName !== sName) return false;
      if (issue.volume && series.volume && issue.volume === series.volume) return true;
      const iYear = issue.cover_date ? parseInt(issue.cover_date.substring(0, 4)) : null;
      if (iYear === sYear || Math.abs(iYear - sYear) <= 1) return true;
      return false;
    }) || issuesList.find(issue => String(issue.series?.name || issue.series || '').trim().toLowerCase() === sName);

    return {
      ...series,
      isGroupedSeries: true,
      grouped_issue_count: series.issue_count,
      image: issueMatch ? issueMatch.image : null,
      credits: issueMatch ? issueMatch.credits : null,
      publisher: series.publisher || (issueMatch ? (issueMatch.publisher || issueMatch.series?.publisher) : null),
    };
  });
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
      const data = await invokeFunction('igdb', { endpoint: 'games', query: `search "${query}"; fields name, slug, cover.image_id, genres.id, genres.name, themes.id, themes.name, first_release_date, summary, total_rating, url, websites.type, websites.url; limit ${limit}; offset ${offset};` });
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
            description(asHtml: true)
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

      const seriesParams = new URLSearchParams({ name: searchQuery, page, page_size: 20 });
      if (coverYear) seriesParams.append('year_began', coverYear);

      const issueParams = new URLSearchParams();
      issueParams.append('series_name', searchQuery);
      issueParams.append('number', '1');
      issueParams.append('page_size', '100');
      if (coverYear) issueParams.append('cover_year', coverYear);

      const [seriesRes, issueRes] = await Promise.all([
        fetchMetron(`/api/series/?${seriesParams.toString()}`),
        fetchMetron(`/api/issue/?${issueParams.toString()}`)
      ]);

      const merged = mergeSeriesAndIssues(seriesRes.results || [], issueRes.results || []);
      const totalPages = seriesRes.count ? Math.ceil(seriesRes.count / 20) : 1;

      return { results: merged.map(normalizeMetron), totalPages };
    } catch (err) {
      reportApiError(err, 'Metron (Comics)');
      return { results: [], totalPages: 1 };
    }
  },

  getMetronPublisherDetails: async (publisherId) => {
    try {
      return await fetchMetron(`/api/publisher/${publisherId}/`);
    } catch (err) { reportApiError(err, 'Metron (Publisher)'); return null; }
  },

  getMetronCreatorDetails: async (creatorId) => {
    try {
      return await fetchMetron(`/api/creator/${creatorId}/`);
    } catch (err) { reportApiError(err, 'Metron (Creator)'); return null; }
  },

  discoverMetron: async (filterType, filterId, page = 1) => {
    try {
      if (filterType === 'publisher') {
        const seriesParams = new URLSearchParams({ publisher_id: filterId, page, page_size: 24 });
        const issueParams = new URLSearchParams({ publisher_id: filterId, number: 1, page_size: 100 });
        
        const [seriesRes, issueRes] = await Promise.all([
          fetchMetron(`/api/series/?${seriesParams.toString()}`),
          fetchMetron(`/api/issue/?${issueParams.toString()}`)
        ]);

        const merged = mergeSeriesAndIssues(seriesRes.results || [], issueRes.results || []);
        const totalPages = seriesRes.count ? Math.ceil(seriesRes.count / 24) : 1;
        
        return { results: merged.map(normalizeMetron), totalPages };
      } else if (filterType === 'creator') {
        const endpoint = `/api/issue/?creator_id=${filterId}&page=${page}&page_size=50`;
        const data = await fetchMetron(endpoint);
        
        const seriesMap = new Map();
        (data.results || []).forEach(issue => {
          const sName = String(issue.series?.name || issue.series || '').trim();
          if (!sName) return;
          if (!seriesMap.has(sName)) {
            seriesMap.set(sName, { ...issue, isGroupedSeries: true, grouped_issue_count: 1, creator_issues: [issue] });
          } else {
            const entry = seriesMap.get(sName);
            entry.grouped_issue_count++;
            entry.creator_issues.push(issue);
          }
        });

        const results = Array.from(seriesMap.values()).map(normalizeMetron);
        const totalPages = data.count ? Math.ceil(data.count / 50) : 1;
        return { results, totalPages };
      }
      return { results: [], totalPages: 1 };
    } catch (err) { reportApiError(err, 'Metron Discover'); return { results: [], totalPages: 1 }; }
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

  getPersonDetails: async (personId) => {
    const cacheKey = `person_${personId}`;
    if (sessionCache.people.has(cacheKey)) return sessionCache.people.get(cacheKey);

    try {
      const result = await invokeFunction('tmdb', { path: `/person/${personId}`, query: { append_to_response: 'combined_credits,images' } });
      if (result) {
        enforceCacheLimit(sessionCache.people, 50);
        sessionCache.people.set(cacheKey, result);
      }
      return result;
    } catch (err) { reportApiError(err, 'TMDB (Person)'); return null; }
  },

  getCompanyDetails: async (companyId) => {
    try { return await invokeFunction('tmdb', { path: `/company/${companyId}` }); }
    catch (err) { return null; }
  },
  getNetworkDetails: async (networkId) => {
    try { return await invokeFunction('tmdb', { path: `/network/${networkId}` }); }
    catch (err) { return null; }
  },

  getIGDBCompanyDetails: async (companyId) => {
    try {
      const data = await invokeFunction('igdb', { endpoint: 'companies', query: `fields name, description, logo.image_id, start_date; where id = ${companyId};` });
      return data?.[0] || null;
    } catch (err) { return null; }
  },

  getAniListPersonDetails: async (personId) => {
    const query = `query($id:Int){ Staff(id:$id){ id name{full} image{large} description dateOfBirth{year month day} dateOfDeath{year month day} primaryOccupations characterMedia(sort:[POPULARITY_DESC], perPage:200){ edges{ characterRole characters{ name{full} } node{ id type title{romaji english native} coverImage{large} startDate{year} averageScore popularity } } } staffMedia(sort:[POPULARITY_DESC], perPage:200){ edges{ staffRole node{ id type title{romaji english native} coverImage{large} startDate{year} averageScore popularity } } } } }`;
    try {
      const res = await fetchAniListGraphQL(query, { id: parseInt(personId) });
      const staff = res?.Staff;
      if (!staff) return null;
      const formatAnidbDate = (d) => d?.year ? `${d.year}-${String(d.month||1).padStart(2,'0')}-${String(d.day||1).padStart(2,'0')}` : null;
      return {
        name: staff.name?.full,
        profile_path_custom: staff.image?.large,
        known_for_department: staff.primaryOccupations?.[0] || 'Staff',
        biography: staff.description,
        birthday: formatAnidbDate(staff.dateOfBirth),
        deathday: formatAnidbDate(staff.dateOfDeath),
        combined_credits: {
          cast: staff.characterMedia?.edges?.map(e => ({ id: e.node.id, title: e.node.title?.english || e.node.title?.romaji || 'Unknown', custom_type: e.node.type === 'ANIME' ? 'anime' : 'manga', custom_subtype: e.node.type === 'ANIME' ? 'Anime' : 'Manga', poster_path_custom: e.node.coverImage?.large, release_date: e.node.startDate?.year ? `${e.node.startDate.year}-01-01` : null, vote_average: e.node.averageScore ? e.node.averageScore / 10 : 0, popularity: e.node.popularity, character: e.characters?.[0]?.name?.full || e.characterRole })) || [],
          crew: staff.staffMedia?.edges?.map(e => ({ id: e.node.id, title: e.node.title?.english || e.node.title?.romaji || 'Unknown', custom_type: e.node.type === 'ANIME' ? 'anime' : 'manga', custom_subtype: e.node.type === 'ANIME' ? 'Anime' : 'Manga', poster_path_custom: e.node.coverImage?.large, release_date: e.node.startDate?.year ? `${e.node.startDate.year}-01-01` : null, vote_average: e.node.averageScore ? e.node.averageScore / 10 : 0, popularity: e.node.popularity, job: e.staffRole })) || []
        }
      };
    } catch(e) { reportApiError(e, 'AniList Person'); return null; }
  },

  discoverAniList: async (filterType, filterId, mediaType, page = 1, sortOrder = 'popularity') => {
    let sort = 'POPULARITY_DESC';
    if (sortOrder === 'rating') sort = 'SCORE_DESC';
    else if (sortOrder === 'new') sort = 'START_DATE_DESC';
    else if (sortOrder === 'old') sort = 'START_DATE_ASC';
    const typeArg = mediaType === 'anime' ? 'ANIME' : 'MANGA';
    try {
      if (filterType === 'studio') {
        const query = `query($page:Int, $sort:[MediaSort], $id:Int){ Studio(id:$id){ media(page:$page, sort:$sort){ pageInfo{ lastPage } nodes{ id title{romaji english native} description(asHtml:true) coverImage{extraLarge large medium} startDate{year} averageScore popularity siteUrl status genres episodes chapters volumes studios(isMain:true){nodes{id name}} } } } }`;
        const res = await fetchAniListGraphQL(query, { page, sort: [sort], id: parseInt(filterId) });
        return { 
          results: (res?.Studio?.media?.nodes || []).map(item => normalizeAniList(item, mediaType)), 
          totalPages: res?.Studio?.media?.pageInfo?.lastPage || 1 
        };
      } else if (filterType === 'genre') {
        const query = `query($page:Int, $type:MediaType, $sort:[MediaSort], $genre:String){ Page(page:$page, perPage:24){ pageInfo{ lastPage } media(type:$type, sort:$sort, genre:$genre){ id title{romaji english native} description(asHtml:true) coverImage{extraLarge large medium} startDate{year} averageScore popularity siteUrl status genres episodes chapters volumes studios(isMain:true){nodes{id name}} } } }`;
        const res = await fetchAniListGraphQL(query, { page, type: typeArg, sort: [sort], genre: filterId });
        return { 
          results: (res?.Page?.media || []).map(item => normalizeAniList(item, mediaType)), 
          totalPages: res?.Page?.pageInfo?.lastPage || 1 
        };
      }
      return { results: [], totalPages: 1 };
    } catch(e) { reportApiError(e, 'AniList Discover'); return { results: [], totalPages: 1 }; }
  },

  discoverIGDB: async (filterType, filterId, page = 1, sortOrder = 'popularity') => {
    try {
      let sortBy = 'id desc';
      if (sortOrder === 'rating') sortBy = 'total_rating desc';
      else if (sortOrder === 'new') sortBy = 'first_release_date desc';
      else if (sortOrder === 'old') sortBy = 'first_release_date asc';

      const limit = 24;
      const offset = (page - 1) * limit;

      let whereClause = '';
      if (filterType === 'company') {
        whereClause = `involved_companies.company = ${filterId}`;
      } else if (filterType === 'genre') {
        whereClause = `genres = ${filterId}`;
      } else if (filterType === 'theme') {
        whereClause = `themes = ${filterId}`;
      }

      if (sortOrder === 'new' || sortOrder === 'old') whereClause += (whereClause ? ' & ' : '') + `first_release_date != null`;
      if (!whereClause) whereClause = 'id != null';

      const data = await invokeFunction('igdb', { endpoint: 'games', query: `fields name, slug, cover.image_id, genres.id, genres.name, themes.id, themes.name, first_release_date, summary, total_rating, url; where ${whereClause}; sort ${sortBy}; limit ${limit}; offset ${offset};` });
      const results = (data || []).map(normalizeIGDB);
      return { results, totalPages: results.length === limit ? page + 1 : page };
    } catch (err) { reportApiError(err, 'IGDB Discover'); return { results: [], totalPages: 1 }; }
  },

  discoverTMDB: async (filterType, filterId, mediaType, page = 1, sortOrder = 'popularity') => {
    try {
      let sortBy = 'popularity.desc';
      if (sortOrder === 'rating') sortBy = 'vote_average.desc';
      else if (sortOrder === 'new') sortBy = mediaType === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc';
      else if (sortOrder === 'old') sortBy = mediaType === 'tv' ? 'first_air_date.asc' : 'primary_release_date.asc';

      const query = { page, sort_by: sortBy };
      if (sortOrder === 'rating') query['vote_count.gte'] = 50;

      if (filterType === 'genre') query.with_genres = filterId;
      else if (filterType === 'studio' || filterType === 'company') query.with_companies = filterId;
      else if (filterType === 'network') query.with_networks = filterId;

      const tmdbType = mediaType === 'movies' ? 'movie' : 'tv';
      const data = await invokeFunction('tmdb', { path: `/discover/${tmdbType}`, query });
      return {
        results: (data.results || []).map(item => normalizeTMDB(item, mediaType)),
        totalPages: data.total_pages || 1
      };
    } catch (err) { reportApiError(err, 'TMDB Discover'); return { results: [], totalPages: 1 }; }
  },

  getTVSeason: async (tvId, seasonNumber) => {
    const cacheKey = `${tvId}_${seasonNumber}`;
    if (sessionCache.seasons.has(cacheKey)) return sessionCache.seasons.get(cacheKey);

    try { 
      const result = await invokeFunction('tmdb', { path: `/tv/${tvId}/season/${seasonNumber}` }); 
      enforceCacheLimit(sessionCache.seasons, 50);
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
        const data = await invokeFunction('igdb', { endpoint: 'games', query: `fields name, slug, cover.image_id, genres.id, genres.name, themes.id, themes.name, first_release_date, summary, storyline, total_rating, url, websites.type, websites.url, platforms.name, artworks.image_id, screenshots.image_id, videos.video_id, involved_companies.company.id, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, collections.name, collections.games.name, collections.games.cover.image_id, collections.games.first_release_date, game_status; where id = ${realId};` });
        result = data?.[0] || null;
        if (result && result.game_status !== undefined) result.status = getGameStatusLabel(result.game_status);
      }
      else if (type === 'anime') result = (await fetchAniListGraphQL(`query ($id: Int) { Media(id: $id, type: ANIME) { id title { romaji english native } description(asHtml: true) trailer { id site } coverImage { extraLarge large medium } bannerImage startDate { year month day } episodes status averageScore siteUrl genres studios(isMain: true) { nodes { id name } } staff(perPage: 50, sort: RELEVANCE) { edges { role node { id name { full } } } } relations { edges { relationType node { id type title { romaji english } coverImage { large } } } } externalLinks { url site } } }`, { id: parseInt(cleanId) }))?.Media;
      else if (type === 'manga') result = (await fetchAniListGraphQL(`query ($id: Int) { Media(id: $id, type: MANGA) { id title { romaji english native } description(asHtml: true) coverImage { extraLarge large medium } bannerImage startDate { year month day } chapters volumes status averageScore siteUrl genres staff(perPage: 50) { edges { role node { id name { full } } } } relations { edges { relationType node { id type title { romaji english } coverImage { large } } } } externalLinks { url site } } }`, { id: parseInt(cleanId) }))?.Media;
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
        let seriesId = cleanId;
        if (typeof cleanId === 'string' && cleanId.startsWith('issue_')) {
          const issueData = await fetchMetron(`/api/issue/${cleanId.replace('issue_', '')}/`);
          if (issueData?.series?.id) seriesId = issueData.series.id;
          else throw new Error('Could not resolve series from issue');
        }
        if (typeof seriesId === 'string' && seriesId.startsWith('series_')) {
          seriesId = seriesId.replace('series_', '');
        }
        
        let seriesData;
        try {
          seriesData = await fetchMetron(`/api/series/${seriesId}/`);
        } catch (err) {
          // Backward compatibility & error recovery: 
          // If fetching as a series fails with 404, it might be an issue ID from legacy logs
          // or a cached invalid prefix. Try fetching it as an issue to resolve the real series ID.
          try {
            const legacyIssueData = await fetchMetron(`/api/issue/${seriesId}/`);
            if (legacyIssueData?.series?.id) {
              seriesId = legacyIssueData.series.id;
              seriesData = await fetchMetron(`/api/series/${seriesId}/`);
            } else {
              throw err;
            }
          } catch (fallbackErr) {
            throw err;
          }
        }
        if (seriesData && seriesData.id) {
          try {
            const issuesRes = await fetchMetron(`/api/series/${seriesData.id}/issue_list/`);
            if (issuesRes.results && issuesRes.results.length > 0) {
              seriesData.issue_details = issuesRes.results;
              const firstIssue = await fetchMetron(`/api/issue/${issuesRes.results[0].id}/`);
              if (firstIssue) {
                if (firstIssue.image) seriesData.image = firstIssue.image;
                if (firstIssue.credits) seriesData.credits = firstIssue.credits;
                if (!seriesData.publisher && firstIssue.publisher) seriesData.publisher = firstIssue.publisher;
                else if (!seriesData.publisher && firstIssue.series?.publisher) seriesData.publisher = firstIssue.series.publisher;
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

      if (result) {
        enforceCacheLimit(sessionCache.details, 100);
        sessionCache.details.set(cacheKey, result);
        if (type === 'comics' && typeof cleanId === 'string' && cleanId.startsWith('issue_') && result.id) {
           sessionCache.details.set(`${type}_series_${result.id}`, result);
        }
      }
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
      
      if (result.length > 0) {
        enforceCacheLimit(sessionCache.recs, 50);
        sessionCache.recs.set(cacheKey, result);
      }
      return result;
    } catch (err) { reportApiError(err, `${type.toUpperCase()} Recommendations`); return []; }
  },

  getComicIssueDetails: async (issueId) => {
    const cacheKey = `issue_${issueId}`;
    if (sessionCache.comicIssueDetails.has(cacheKey)) return sessionCache.comicIssueDetails.get(cacheKey);

    try {
      const data = await fetchMetron(`/api/issue/${issueId}/`);
      enforceCacheLimit(sessionCache.comicIssueDetails, 50);
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
      enforceCacheLimit(sessionCache.comicIssues, 50);
      sessionCache.comicIssues.set(cacheKey, result);
      return result;
    } catch (err) {
      reportApiError(err, 'Metron (Series Issues)');
      return { issues: [], totalCount: 0, page };
    }
  },
};