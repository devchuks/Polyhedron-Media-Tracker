import React, { useState, useEffect, useRef } from 'react';
import { Flame, CalendarClock, Star, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ImageWithFallback, getMediaTypeColors, getSubtype, stripHtml } from '../components/UI';
import { supabase } from '../services/supabase';
import { useMediaStore } from '../store/useMediaStore';
import { FunctionsHttpError } from '@supabase/supabase-js';

const TABS = ['movies', 'tv', 'games', 'anime', 'manga', 'comics'];

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

const DiscoverySkeleton = () => (
  <div className="flex flex-col gap-6 sm:gap-8 w-full animate-pulse mt-2">
    {[1, 2, 3].map(section => (
      <section key={section} className="flex flex-col gap-3">
        <div className="h-5 w-40 bg-base-300 mb-2"></div>
        <div className="flex overflow-x-hidden gap-2 sm:gap-4">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="w-[calc(33.333%-0.34rem)] sm:w-36 md:w-44 aspect-[2/3] bg-base-300 flex-shrink-0 border border-base-300"></div>)}
        </div>
      </section>
    ))}
  </div>
);

export const Discovery = () => {
  const { discoveryCache, setDiscoveryCache } = useMediaStore();
  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem('discoveryTab') || 'movies');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isLoading, setIsLoading] = useState(!discoveryCache?.[activeTab]);

  useEffect(() => {
    let isMounted = true;
    
    const loadData = async () => {
      const cached = useMediaStore.getState().discoveryCache?.[activeTab];
      const isEmpty = !cached?.data?.trending || cached.data.trending.length === 0;
      const isImplemented = ['movies', 'tv', 'anime', 'manga', 'games', 'comics'].includes(activeTab);
      
      const cacheTTL = 43200000; // 12 hours
      const isStale = !cached || (Date.now() - cached.timestamp >= cacheTTL) || cached.data?._version !== 1;
      
      if (!isStale && !(isImplemented && isEmpty)) {
        if (isMounted) setIsLoading(false);
        return;
      }
      
      if (isMounted) setIsLoading(true);
      try {
        let data;
        if (activeTab === 'movies' || activeTab === 'tv') {
          const tmdbType = activeTab === 'movies' ? 'movie' : 'tv';
          const fetchTMDB = async (endpoint, page = 1) => {
            try {
              const res = await supabase.functions.invoke('tmdb', { body: { path: endpoint, query: { page } } });
              if (res.error) throw res.error;
              return { results: res.data?.results || [] };
            } catch (err) {
              if (err instanceof FunctionsHttpError) {
                const text = await err.context.text().catch(() => 'Unable to read error text');
                let errorData;
                try { errorData = JSON.parse(text); } catch { errorData = { error: text }; }
                console.error("TMDB Function HTTP Error:", errorData);
              } else {
                console.error("TMDB Fetch Error:", err);
              }
              return { results: [] };
            }
          };

          const [trending, upcoming, popular] = await Promise.all([
            fetchTMDB(`/trending/${tmdbType}/week`, 1),
            fetchTMDB(activeTab === 'movies' ? `/movie/upcoming` : `/tv/on_the_air`, 1),
            fetchTMDB(`/${tmdbType}/popular`, 1)
          ]);

          const normalize = (items) => (items || []).filter(i => i.poster_path).map(item => ({
            id: item.id,
            title: item.title || item.name,
            year: (item.release_date || item.first_air_date || 'TBA').substring(0, 4),
            apiRating: item.vote_average ? item.vote_average.toFixed(1) : '0.0',
            description: item.overview || 'No transmission data available.',
            image: `https://image.tmdb.org/t/p/w342${item.poster_path}`,
            backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
            type: activeTab,
            subtitle: null,
            apiData: { raw: item }
          }));

          data = { trending: normalize(trending.results), upcoming: normalize(upcoming.results), popular: normalize(popular.results) };
        } else if (activeTab === 'anime' || activeTab === 'manga') {
          const typeArg = activeTab === 'anime' ? 'ANIME' : 'MANGA';
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
              
              const res = await fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ query, variables })
              });
              const json = await res.json();
              if (json.errors) throw new Error(json.errors[0].message);
              return json.data?.Page?.media || [];
            } catch (err) {
              console.error("AniList Fetch Error:", err);
              return [];
            }
          };

          const isAnime = activeTab === 'anime';
          const [trending, upcoming, popular] = await Promise.all([
            fetchAniList('TRENDING_DESC'),
            fetchAniList('POPULARITY_DESC', 'NOT_YET_RELEASED', isAnime, true),
            isAnime ? fetchAniList('POPULARITY_DESC', null, true, false) : fetchAniList('POPULARITY_DESC')
          ]);

          const normalize = (items) => (items || []).map(item => ({
            id: item.id,
            title: item.title?.english || item.title?.romaji || 'Unknown',
            year: item.startDate?.year?.toString() || 'TBA',
            apiRating: item.averageScore ? (item.averageScore / 10).toFixed(1) : '0.0',
            description: stripHtml(item.description) || 'No descriptive data available.',
            image: item.coverImage?.large || item.coverImage?.medium,
            backdrop: item.bannerImage || null,
            type: activeTab,
            subtitle: item.season && item.seasonYear ? `${item.season} ${item.seasonYear}` : null,
            apiData: { raw: item }
          }));

          data = { trending: normalize(trending), upcoming: normalize(upcoming), popular: normalize(popular) };
        } else if (activeTab === 'games') {
          const fetchIGDB = async (query) => {
            try {
              const { data, error } = await supabase.functions.invoke('igdb', { 
                body: { endpoint: 'games', query } 
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
              } else {
                console.error(`[IGDB Debug] CRITICAL FAILURE:`, err);
              }
              return [];
            }
          };

          const now = Math.floor(Date.now() / 1000);
          const sixMonthsAgo = now - 15552000;
          const [trending, upcoming, popular] = await Promise.all([
            fetchIGDB(`fields id, name, first_release_date, total_rating, rating, summary, cover.image_id, artworks.image_id; where first_release_date >= ${sixMonthsAgo} & first_release_date <= ${now} & parent_game = null & total_rating_count > 0; sort total_rating_count desc; limit 40;`),
            fetchIGDB(`fields id, name, first_release_date, total_rating, rating, summary, cover.image_id, artworks.image_id; where first_release_date > ${now} & parent_game = null & hypes > 0; sort hypes desc; limit 40;`),
            fetchIGDB(`fields id, name, first_release_date, total_rating, rating, summary, cover.image_id, artworks.image_id; where total_rating_count > 500 & parent_game = null; sort total_rating desc; limit 40;`)
          ]);

          const normalize = (items) => (items || [])
            .filter(item => item.cover?.image_id)
            .map(item => ({
            id: `igdb_${item.id}`, title: item.name, year: item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear().toString() : 'TBA',
            apiRating: item.total_rating ? (item.total_rating / 10).toFixed(1) : (item.rating ? (item.rating / 10).toFixed(1) : '0.0'),
            description: item.summary || 'No descriptive data available.',
            image: `https://images.igdb.com/igdb/image/upload/t_cover_big/${item.cover.image_id}.jpg`,
            backdrop: item.artworks?.[0]?.image_id ? `https://images.igdb.com/igdb/image/upload/t_1080p/${item.artworks[0].image_id}.jpg` : null,
            type: activeTab, apiData: { raw: item }
          }));
          
          data = { trending: normalize(trending), upcoming: normalize(upcoming), popular: normalize(popular) };
} else if (activeTab === 'comics') {
          const fetchMetron = async (endpoint) => {
            try {
              const { data, error } = await supabase.functions.invoke('metron', { 
                body: { endpoint, path: endpoint, method: 'GET' } 
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
              } else {
                console.error("[Metron Debug] CRITICAL FAILURE:", err);
              }
              return [];
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
            valid.sort((a, b) => (b.series?.issue_count || 0) - (a.series?.issue_count || 0)); // Sort by popularity
            return valid.map(item => {
            const seriesObj = {
              id: item.series.id,
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
              type: activeTab, 
              subtitle: `Issue #${item.number}`, 
              apiData: { image: item.image, raw: seriesObj } 
            };
            });
          };

          data = { trending: normalizeIssues(trending), upcoming: normalizeIssues(upcoming), popular: normalizeIssues(popular) };
        } else {
          data = { trending: [], upcoming: [], popular: [] };
        }
        
        if (isMounted) setDiscoveryCache(activeTab, { ...data, _version: 1 });
      } catch (err) {
        console.error('Discovery fetch error:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadData();
    return () => { isMounted = false; };
  }, [activeTab, setDiscoveryCache, refreshTrigger]);

  const handleLoadMoreItems = async (categoryKey, page) => {
    if (activeTab !== 'movies' && activeTab !== 'tv') return;

    const tmdbType = activeTab === 'movies' ? 'movie' : 'tv';
    let endpoint = '';
    if (categoryKey === 'trending') endpoint = `/trending/${tmdbType}/week`;
    else if (categoryKey === 'upcoming') endpoint = activeTab === 'movies' ? `/movie/upcoming` : `/tv/on_the_air`;
    else if (categoryKey === 'popular') endpoint = `/${tmdbType}/popular`;

    try {
      const res = await supabase.functions.invoke('tmdb', { body: { path: endpoint, query: { page } } });
      if (res.error) throw res.error;
      const results = res.data?.results || [];

      const newItems = results.filter(i => i.poster_path).map(item => ({
        id: item.id,
        title: item.title || item.name,
        year: (item.release_date || item.first_air_date || 'TBA').substring(0, 4),
        apiRating: item.vote_average ? item.vote_average.toFixed(1) : '0.0',
        description: item.overview || 'No transmission data available.',
        image: `https://image.tmdb.org/t/p/w342${item.poster_path}`,
        backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
        type: activeTab,
        subtitle: null,
        apiData: { raw: item }
      }));

      if (newItems.length > 0) {
        const currentCache = useMediaStore.getState().discoveryCache?.[activeTab];
        if (!currentCache || !currentCache.data) return;
        
        const existingIds = new Set(currentCache.data[categoryKey].map(i => i.id));
        const uniqueNewItems = newItems.filter(i => !existingIds.has(i.id));

        setDiscoveryCache(activeTab, { ...currentCache.data, [categoryKey]: [...currentCache.data[categoryKey], ...uniqueNewItems], _version: 1 });
      }
    } catch (err) { console.error("TMDB Load More Error:", err); }
  };

  const currentData = discoveryCache?.[activeTab]?.data || { trending: [], upcoming: [], popular: [] };

  const handleTabChange = (tab) => {
    const cached = discoveryCache?.[tab];
    const isEmpty = !cached?.data?.trending || cached.data.trending.length === 0;
    const isImplemented = ['movies', 'tv', 'anime', 'manga', 'games', 'comics'].includes(tab);
    
    const cacheTTL = 43200000; // 12 hours
    const isStale = !cached || (Date.now() - cached.timestamp >= cacheTTL) || cached.data?._version !== 1;
    
    if (isStale || (isImplemented && isEmpty)) setIsLoading(true);
    setActiveTab(tab);
    sessionStorage.setItem('discoveryTab', tab);
  };

  const handleForceRefresh = () => {
    useMediaStore.setState(state => {
      const newCache = { ...state.discoveryCache };
      delete newCache[activeTab];
      return { discoveryCache: newCache };
    });
    setIsLoading(true);
    setRefreshTrigger(prev => prev + 1);
  };

  const getTitles = (tab) => {
    switch (tab) {
      case 'movies': return ['Trending this Week', 'Upcoming', 'Popular'];
      case 'tv': return ['Trending this Week', 'On The Air', 'Popular'];
      case 'anime': return ['Trending', 'Upcoming Next Season', 'All Time Popular'];
      case 'manga': return ['Trending', 'Upcoming', 'All Time Popular'];
      case 'games': return ['Recently Released', 'Most Anticipated', 'Top Rated'];
      case 'comics': return ['This Week', 'Next Week', 'Future'];
      default: return ['Trending', 'Upcoming', 'Popular'];
    }
  };
  
  const isComics = activeTab === 'comics';
  const [section1Title, section2Title, section3Title] = getTitles(activeTab);

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300 pb-10 min-h-screen text-base-content overflow-x-hidden">
      {/* Wrapping Tabs */}
      <div className="flex flex-wrap pt-2 pb-2 border-b border-base-300 gap-1.5 sm:gap-2 items-center">
        {TABS.map(tab => (
          <button 
            key={tab} 
            onClick={() => handleTabChange(tab)} 
            className={`px-3 sm:px-4 py-2 sm:py-1.5 text-[10px] font-mono font-bold uppercase tracking-widest rounded-none appearance-none transition-colors border shrink-0 ${
              activeTab === tab 
                ? 'bg-primary text-primary-content border-primary shadow-[0_0_10px_rgba(var(--p),0.2)]' 
                : 'bg-base-100 text-base-content/70 border-base-300 hover:bg-base-200 hover:text-base-content'
            }`}
          >
            {tab}
          </button>
        ))}
        
        <button onClick={handleForceRefresh} disabled={isLoading} className="btn btn-ghost btn-square btn-sm ml-auto" title="Force Refresh">
          <RefreshCw className={`w-4 h-4 text-base-content/50 ${isLoading ? 'animate-spin text-primary' : ''}`} />
        </button>
      </div>

      {isLoading ? <DiscoverySkeleton /> : (
      <div className="flex flex-col gap-6 sm:gap-8 animate-in fade-in duration-500">
        <CarouselSection key={`${activeTab}-trending`} title={section1Title} icon={<Flame className="w-4 h-4 text-warning" />} items={currentData.trending} type={activeTab} showRank={!isComics} categoryKey="trending" onLoadMore={handleLoadMoreItems} />
        <CarouselSection key={`${activeTab}-upcoming`} title={section2Title} icon={<CalendarClock className="w-4 h-4 text-info" />} items={currentData.upcoming} type={activeTab} categoryKey="upcoming" onLoadMore={handleLoadMoreItems} />
        <CarouselSection key={`${activeTab}-popular`} title={section3Title} icon={<Star className="w-4 h-4 text-success" />} items={currentData.popular} type={activeTab} showRank={!isComics} categoryKey="popular" onLoadMore={handleLoadMoreItems} />
      </div>
      )}
    </div>
  );
};

const CarouselSection = ({ title, icon, items, type, showRank = false, categoryKey, onLoadMore }) => {
  const scrollRef = useRef(null);
  const [limit, setLimit] = useState(15);
  const [apiPage, setApiPage] = useState(1);
  const [isFetching, setIsFetching] = useState(false);

  if (!items || items.length === 0) return null;

  const visibleItems = items.slice(0, limit);
  const hasMoreLocal = limit < items.length;
  const canFetchMore = (type === 'movies' || type === 'tv') && apiPage < 5 && onLoadMore;
  const hasMore = hasMoreLocal || canFetchMore;

  const scroll = (direction) => {
    if (scrollRef.current) {
      const { current } = scrollRef;
      const scrollAmount = direction === 'left' ? -current.offsetWidth * 0.75 : current.offsetWidth * 0.75;
      current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handleLoadMore = async () => {
    if (isFetching) return;
    if (hasMoreLocal) {
      setLimit(l => l + 15);
      setTimeout(() => scroll('right'), 100);
    } else if (canFetchMore) {
      setIsFetching(true);
      const nextApiPage = apiPage + 1;
      await onLoadMore(categoryKey, nextApiPage);
      setApiPage(nextApiPage);
      setLimit(l => l + 15);
      setIsFetching(false);
      setTimeout(() => scroll('right'), 100);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-base-300/50 pb-2">
        <h2 className="text-sm font-black uppercase tracking-widest font-sans flex items-center gap-2">
          {icon} {title}
        </h2>
      </div>

      <div className="relative group/carousel">
        <button onClick={() => scroll('left')} className="absolute left-2 top-1/2 -translate-y-[calc(50%+8px)] z-40 bg-base-100/90 hover:bg-primary text-base-content hover:text-primary-content w-10 h-10 items-center justify-center hidden md:group-hover/carousel:flex backdrop-blur-md transition-all border border-base-300 shadow-2xl rounded-full">
          <ChevronLeft className="w-6 h-6" />
        </button>

        <div ref={scrollRef} className="flex overflow-x-auto gap-2 sm:gap-4 snap-x pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {visibleItems.map((item, i) => <CarouselCard key={item.uniqueKey || item.id || i} item={item} type={type} rank={showRank ? i + 1 : null} />)}
          
          {hasMore && (
            <div 
              onClick={handleLoadMore}
              className="group flex-shrink-0 w-[calc(33.333%-0.34rem)] sm:w-36 md:w-44 flex flex-col cursor-pointer snap-start relative bg-base-200/50 hover:bg-base-200 border-y border-r border-base-300 border-l-4 border-l-transparent hover:border-l-primary transition-all duration-200"
            >
              <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 text-base-content/50 group-hover:text-primary transition-colors">
                <div className="w-10 h-10 rounded-full bg-base-100 border border-base-300 flex items-center justify-center shadow-sm group-hover:shadow-md transition-all">
                  {isFetching ? <RefreshCw className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
                </div>
                <span className="font-mono font-bold text-[10px] uppercase tracking-widest">{isFetching ? 'Loading...' : 'Load More'}</span>
              </div>
            </div>
          )}
        </div>

        <button onClick={() => scroll('right')} className="absolute right-2 top-1/2 -translate-y-[calc(50%+8px)] z-40 bg-base-100/90 hover:bg-primary text-base-content hover:text-primary-content w-10 h-10 items-center justify-center hidden md:group-hover/carousel:flex backdrop-blur-md transition-all border border-base-300 shadow-2xl rounded-full">
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>
    </section>
  );
};

const CarouselCard = ({ item, type, rank }) => {
  if (!item) return null;
  const colors = getMediaTypeColors(type);
  const displayRating = item.apiRating || item.rating;
  const isClickable = type !== 'comics';
  const Wrapper = isClickable ? Link : 'div';
  const wrapperProps = isClickable ? { to: `/media/${type}/${item.id}`, state: { previewData: item } } : {};
  
  return (
    <Wrapper {...wrapperProps} className={`group flex-shrink-0 w-[calc(33.333%-0.34rem)] sm:w-36 md:w-44 flex flex-col ${isClickable ? 'cursor-pointer' : 'cursor-default'} snap-start relative bg-base-100 border-y border-r border-base-300 border-l-4 border-l-transparent ${colors.hoverBorder} transition-all duration-200 hover:shadow-md h-full`}>
      <figure className="relative aspect-[2/3] w-full overflow-hidden bg-base-200 border-b border-base-300">
         <ImageWithFallback src={item.image} alt={item.title} className="grayscale-[20%] group-hover:grayscale-0 object-cover w-full h-full" />
         {rank && (
           <div className="absolute top-0 left-0 bg-base-100/90 text-base-content font-black font-mono px-2 py-0.5 text-[10px] sm:text-xs border-r border-b border-base-300 z-10 shadow-sm">
             #{rank}
           </div>
         )}
      </figure>
      <div className="p-2.5 sm:p-3 flex flex-col flex-grow min-w-0 bg-base-100">
        <h3 className="font-bold font-sans text-[10px] sm:text-[11px] uppercase tracking-wide leading-snug mb-0.5 group-hover:text-primary transition-colors line-clamp-2 min-h-[28px] sm:min-h-[32px]">{item.title}</h3>
        {item.subtitle && <p className="text-[8px] sm:text-[9px] font-mono text-primary font-bold uppercase tracking-widest mb-1.5 truncate">{item.subtitle}</p>}
        <div className="flex items-center justify-between mt-auto font-mono border-t border-base-200 pt-2">
          <span className="text-[9px] sm:text-[10px] font-bold text-base-content/60 uppercase tracking-widest">{item.year || 'TBA'}</span>
          {Number(displayRating) > 0 && <div className="flex items-center gap-1 text-[9px] sm:text-[10px] font-bold text-base-content shrink-0 ml-2"><Star className="w-3 h-3 text-warning fill-warning" /><span>{displayRating}</span></div>}
        </div>
      </div>
    </Wrapper>
  );
};
