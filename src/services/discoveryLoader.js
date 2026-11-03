import { FunctionsHttpError } from '@supabase/supabase-js';
import { stripHtml } from '../components/UI';
import { supabase } from './supabase';
import { apiClient } from '../utils/apiClient';
import { isIntentionalAbort } from '../utils/requestErrors';
import { apiRegistry } from './apiRegistry';
import { useMediaStore } from '../store/useMediaStore';
import { createSingleFlight } from '../utils/singleFlight';
import { DISCOVERY_CACHE_VERSION, DISCOVERY_TYPES, isDiscoveryCacheFresh, tmdbDiscoveryRequest } from '../domain/discoveryCatalog';

export const invokeDiscoveryFunction = async (name, body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await supabase.functions.invoke(name, { body, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

// Helper to determine AniList Seasons dynamically
const getAniListSeason = (isNext = false) => {
  const month = new Date().getMonth(); // 0-11
  let year = new Date().getFullYear();
  let seasonIndex = Math.floor(month / 3); // 0=WINTER, 1=SPRING, 2=SUMMER, 3=FALL
  if (isNext) {
    seasonIndex += 1;
    if (seasonIndex > 3) {
      seasonIndex = 0;
      year += 1;
    }
  }
  const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  return { season: seasons[seasonIndex], seasonYear: year };
};

// Fetches all three sections of one Discovery tab. Section-level provider failures are
// reported in `errors`; a failure of the whole provider rejects.
const fetchDiscoveryTabUncached = async (tab) => {
  let errors = {};
  let data;
  if (tab === 'movies' || tab === 'tv') {
    const fetchTMDB = async (endpoint, query) => {
      try {
        const res = await invokeDiscoveryFunction('tmdb', { path: endpoint, query });
        if (res.error) throw res.error;
        return { results: res.data?.results || [], error: null };
      } catch (err) {
        if (err instanceof FunctionsHttpError) {
          const text = await err.context.text().catch(() => 'Unable to read error text');
          let errorData;
          try { errorData = JSON.parse(text); } catch { errorData = { error: text }; }
          console.error("TMDB Function HTTP Error:", errorData);
        } else if (!isIntentionalAbort(err)) {
          console.error("TMDB Fetch Error:", err);
        }
        return { results: [], error: 'TMDB could not load this section.' };
      }
    };

    const [trending, upcoming, popular] = await Promise.all(['trending', 'upcoming', 'popular'].map(section => {
      const request = tmdbDiscoveryRequest(tab, section, 1);
      return fetchTMDB(request.path, request.query);
    }));

    const normalize = (items) => (items || []).filter(i => i.poster_path).map(item => ({
      id: item.id,
      title: item.title || item.name,
      year: (item.release_date || item.first_air_date || 'TBA').substring(0, 4),
      apiRating: item.vote_average ? item.vote_average.toFixed(1) : '0.0',
      description: item.overview || 'No transmission data available.',
      image: `https://image.tmdb.org/t/p/w342${item.poster_path}`,
      backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
      type: tab,
      subtitle: null,
      apiData: { raw: item }
    }));

    data = { trending: normalize(trending.results), upcoming: normalize(upcoming.results), popular: normalize(popular.results) };
    errors = { trending: trending.error, upcoming: upcoming.error, popular: popular.error };
  } else if (tab === 'anime' || tab === 'manga') {
    const typeArg = tab === 'anime' ? 'ANIME' : 'MANGA';
    const fetchAniList = async (sort, status, useSeason = false, isNext = false) => {
      try {
        const query = `
          query ($type: MediaType, $sort: [MediaSort], $status: MediaStatus, $season: MediaSeason, $seasonYear: Int) {
            Page(page: 1, perPage: 40) {
              media(type: $type, sort: $sort, status: $status, season: $season, seasonYear: $seasonYear) {
                id
                title { english romaji }
                startDate { year }
                averageScore
                description(asHtml: false)
                coverImage { large medium }
                bannerImage
              }
            }
          }
        `;
        const variables = { type: typeArg, sort: [sort] };
        if (status) variables.status = status;
        if (useSeason) {
          const s = getAniListSeason(isNext);
          variables.season = s.season;
          variables.seasonYear = s.seasonYear;
        }
        
        const json = await apiClient('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query, variables })
        });
        if (json.errors) throw new Error(json.errors[0].message);
        return json.data?.Page?.media || [];
      } catch (err) {
        if (!isIntentionalAbort(err)) console.error("AniList Fetch Error:", err);
        throw err;
      }
    };

    const isAnime = tab === 'anime';
    const [trending, upcoming, popular] = await Promise.all([
      fetchAniList('TRENDING_DESC'),
      fetchAniList('POPULARITY_DESC', 'NOT_YET_RELEASED', isAnime, true),
      fetchAniList('POPULARITY_DESC')
    ]);

    const normalize = (items) => (items || []).map(item => ({
      id: item.id,
      title: item.title?.english || item.title?.romaji || 'Unknown',
      year: item.startDate?.year?.toString() || 'TBA',
      apiRating: item.averageScore ? (item.averageScore / 10).toFixed(1) : '0.0',
      description: stripHtml(item.description) || 'No descriptive data available.',
      image: item.coverImage?.large || item.coverImage?.medium,
      backdrop: item.bannerImage || null,
      type: tab,
      subtitle: item.season && item.seasonYear ? `${item.season} ${item.seasonYear}` : null,
      apiData: { raw: item }
    }));

    data = { trending: normalize(trending), upcoming: normalize(upcoming), popular: normalize(popular) };
  } else if (tab === 'books' || tab === 'vn') {
    const fetchSection = async (section) => {
      try {
        const items = tab === 'books'
          ? await apiRegistry.discoverBooks(section)
          : await apiRegistry.discoverVNs(section);
        return { items, error: null };
      } catch (error) {
        if (!isIntentionalAbort(error)) console.error(`${tab} Discovery error:`, error);
        return { items: [], error: `${tab === 'books' ? 'Open Library' : 'VNDB'} could not load this section.` };
      }
    };
    const [trending, upcoming, popular] = await Promise.all(['trending', 'upcoming', 'popular'].map(fetchSection));
    const normalize = items => (items || []).filter(item => item.image).map(item => ({
      ...item,
      apiRating: item.score ? Number(item.score).toFixed(1) : '0.0',
      apiData: item.apiData || { raw: item.raw || {} },
    }));
    data = { trending: normalize(trending.items), upcoming: normalize(upcoming.items), popular: normalize(popular.items) };
    errors = { trending: trending.error, upcoming: upcoming.error, popular: popular.error };
  } else if (tab === 'games') {
    const fetchIGDB = async (section) => {
      try {
        const { data, error } = await invokeDiscoveryFunction('igdb', {
          operation: 'discoverySection', params: { section },
        });
        if (error) throw error;
        if (data?.error || data?.message) throw new Error(data.error || data.message || JSON.stringify(data));
        return Array.isArray(data) ? data : data?.data || data?.results || [];
      } catch (err) {
        if (err instanceof FunctionsHttpError) {
          const text = await err.context.text().catch(() => 'Unable to read error text');
          let errorData;
          try { errorData = JSON.parse(text); } catch { errorData = { error: text }; }
          console.error("[IGDB Function HTTP Error]:", errorData);
        } else if (!isIntentionalAbort(err)) {
          console.error(`[IGDB Debug] CRITICAL FAILURE:`, err);
        }
        throw err;
      }
    };

    const [trending, upcoming, popular] = await Promise.all([
      fetchIGDB('trending'),
      fetchIGDB('upcoming'),
      fetchIGDB('popular'),
    ]);

    const normalize = (items) => (items || [])
      .filter(item => item.cover?.image_id)
      .map(item => ({
      id: `igdb_${item.id}`, title: item.name, year: item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear().toString() : 'TBA',
      apiRating: item.total_rating ? (item.total_rating / 10).toFixed(1) : (item.rating ? (item.rating / 10).toFixed(1) : '0.0'),
      description: item.summary || 'No descriptive data available.',
      image: `https://images.igdb.com/igdb/image/upload/t_cover_big/${item.cover.image_id}.jpg`,
      backdrop: item.artworks?.[0]?.image_id ? `https://images.igdb.com/igdb/image/upload/t_1080p/${item.artworks[0].image_id}.jpg` : null,
      type: tab, apiData: { raw: item }
    }));
    
    data = { trending: normalize(trending), upcoming: normalize(upcoming), popular: normalize(popular) };
} else if (tab === 'comics') {
    const fetchMetron = async (endpoint) => {
      try {
        const { data, error } = await invokeDiscoveryFunction('metron', {
          endpoint, path: endpoint, method: 'GET',
        });
        if (error) throw error;
        if (data?.error || data?.message) throw new Error(data.error || data.message || JSON.stringify(data));
        return Array.isArray(data) ? data : data?.results || data?.data || [];
      } catch (err) {
        if (err instanceof FunctionsHttpError) {
          const text = await err.context.text().catch(() => 'Unable to read error text');
          let errorData;
          try { errorData = JSON.parse(text); } catch { errorData = { error: text }; }
          console.error("[Metron Function HTTP Error]:", errorData);
        } else if (!isIntentionalAbort(err)) {
          console.error("[Metron Debug] CRITICAL FAILURE:", err);
        }
        throw err;
      }
    };

    const getMonday = (date = new Date()) => {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      d.setHours(0, 0, 0, 0);
      return d;
    };
    const addDays = (date, days) => {
      const result = new Date(date);
      result.setDate(result.getDate() + days);
      return result;
    };
    const formatYMD = (date) => date.toISOString().split('T')[0];

    const now = new Date();
    const thisMonday = getMonday(now);
    const thisSunday = addDays(thisMonday, 6);
    const nextMonday = addDays(thisMonday, 7);
    const nextSunday = addDays(nextMonday, 6);
    const futureMonday = addDays(nextMonday, 7);

    const thisWeekStart = formatYMD(thisMonday);
    const thisWeekEnd = formatYMD(thisSunday);
    const nextWeekStart = formatYMD(nextMonday);
    const nextWeekEnd = formatYMD(nextSunday);
    const futureStart = formatYMD(futureMonday);

    const trending = await fetchMetron(`/issue/?store_date_range_after=${thisWeekStart}&store_date_range_before=${thisWeekEnd}&page_size=50`);
    const upcoming = await fetchMetron(`/issue/?store_date_range_after=${nextWeekStart}&store_date_range_before=${nextWeekEnd}&page_size=50`);
    const popular = await fetchMetron(`/issue/?store_date_range_after=${futureStart}&page_size=50`);

    const normalizeIssues = (items) => {
      const valid = (items || []).filter(item => item.image && item.series);
      valid.sort((a, b) => String(a.store_date || '').localeCompare(String(b.store_date || '')));
      return valid.map(item => {
      const seriesObj = {
        id: `series_${item.series.id}`,
        name: item.series.name,
        volume: item.series.volume,
        year_began: item.series.year_began,
        desc: item.series.desc || item.desc,
        image: item.image,
        issue_count: item.series.issue_count || 0,
        issuesCount: item.series.issue_count || 0
      };
      
      return {
        uniqueKey: `issue_${item.id}`,
        id: item.series.id,
        title: item.series.name || 'Unknown',
        year: item.store_date ? new Date(item.store_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : (item.series.year_began?.toString() || 'TBA'),
        apiRating: '0.0', 
        description: stripHtml(item.series.desc || item.desc) || 'No descriptive data available.',
        image: `https://wsrv.nl/?url=${encodeURIComponent(item.image)}&w=300&output=webp`,
        backdrop: `https://wsrv.nl/?url=${encodeURIComponent(item.image)}&w=800&output=webp`,
        type: tab, 
        subtitle: `Issue #${item.number}`, 
        apiData: { image: item.image, raw: seriesObj } 
      };
      });
    };

    data = { trending: normalizeIssues(trending), upcoming: normalizeIssues(upcoming), popular: normalizeIssues(popular) };
  } else {
    data = { trending: [], upcoming: [], popular: [] };
  }
  // _fetchedAt identifies one provider snapshot; Load More appends to it without changing it.
  return { data: { ...data, _version: DISCOVERY_CACHE_VERSION, _fetchedAt: Date.now() }, errors };
};

const tabFlights = createSingleFlight();

// One in-flight request per tab, shared by the page and the background prefetch.
export const fetchDiscoveryTab = tab => tabFlights.run(tab, () => fetchDiscoveryTabUncached(tab));
export const isDiscoveryTabInFlight = tab => tabFlights.has(tab);

let prefetchStarted = false;

// Refreshes stale Discovery tabs in the background shortly after the app opens, so the
// page already holds current results when it is visited instead of swapping them in.
export const prefetchDiscovery = async ({ delayMs = 2_000, gapMs = 400 } = {}) => {
  if (prefetchStarted) return;
  prefetchStarted = true;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await wait(delayMs);
  const lastTab = (() => { try { return sessionStorage.getItem('discoveryTab'); } catch { return null; } })();
  const order = [...new Set([lastTab, ...DISCOVERY_TYPES].filter(tab => DISCOVERY_TYPES.includes(tab)))];
  for (const tab of order) {
    if (isDiscoveryCacheFresh(useMediaStore.getState().discoveryCache?.[tab])) continue;
    try {
      const { data, errors } = await fetchDiscoveryTab(tab);
      // Partial results are left for the page to fetch and report itself.
      if (!Object.values(errors).some(Boolean)) useMediaStore.getState().setDiscoveryCache(tab, data);
    } catch (error) {
      if (!isIntentionalAbort(error)) console.warn(`Discovery prefetch skipped ${tab}:`, error?.message || error);
    }
    await wait(gapMs);
  }
};
