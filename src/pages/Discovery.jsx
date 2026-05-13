import React, { useState, useEffect, useRef } from 'react';
import { Compass, Flame, CalendarClock, Star, ArrowRight, LayoutTemplate, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ImageWithFallback, getMediaTypeColors, getSubtype, stripHtml } from '../components/UI';
import { supabase } from '../services/supabase';
import { useMediaStore } from '../store/useMediaStore';

const TABS = ['movies', 'tv', 'games', 'anime', 'manga', 'comics', 'books', 'vn'];

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

// Dummy data generator
const generateDummyData = (type) => Array.from({ length: 15 }).map((_, i) => {
  const isTall = Math.random() > 0.5;
  return {
    id: `dummy_${type}_${i}`,
    title: `Sample ${type.toUpperCase()} Title ${i + 1}`,
    year: 2024 + Math.floor(Math.random() * 2),
    apiRating: (Math.random() * 4 + 6).toFixed(1),
    description: "A thrilling adventure full of unexpected twists, deep character development, and breathtaking visuals. It will leave you completely speechless.",
    aspectClass: type === 'comics' ? 'aspect-[2/3]' : type === 'tv' && !isTall ? 'aspect-video' : 'aspect-[2/3]',
    image: null,
    type
  }
});

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

// Date helpers for Metron
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

export const Discovery = () => {
  const { discoveryCache, setDiscoveryCache } = useMediaStore();
  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem('discoveryTab') || 'movies');
  const [isLoading, setIsLoading] = useState(!discoveryCache[activeTab]);

  useEffect(() => {
    let isMounted = true;
    
    const loadData = async () => {
      // Check if cache exists and is less than 12 hours old
      const cached = useMediaStore.getState().discoveryCache[activeTab];
      
      // Force a re-fetch if the cache contains dummy data but the API is now implemented
      const isDummy = cached?.data?.trending?.length > 0 && String(cached.data.trending[0]?.id).startsWith('dummy_');
      const isEmpty = !cached?.data?.trending || cached.data.trending.length === 0;
      const isImplemented = ['movies', 'tv', 'anime', 'manga', 'games', 'vn', 'comics'].includes(activeTab);
      
      if (cached && (Date.now() - cached.timestamp < 43200000) && !(isImplemented && (isDummy || isEmpty))) {
        if (isMounted) setIsLoading(false);
        return;
      }
      
      if (isMounted) setIsLoading(true);
      try {
        let data;
        if (activeTab === 'movies' || activeTab === 'tv') {
          // ... TMDB code untouched ...
          const tmdbType = activeTab === 'movies' ? 'movie' : 'tv';
          const fetchTMDB = async (endpoint) => {
            const { data, error } = await supabase.functions.invoke('tmdb', { body: { path: endpoint } });
            return data || { results: [] };
          };

          const [trending, upcoming, topRated] = await Promise.all([
            fetchTMDB(`/trending/${tmdbType}/week`),
            fetchTMDB(activeTab === 'movies' ? `/movie/upcoming` : `/tv/on_the_air`),
            fetchTMDB(`/${tmdbType}/popular`)
          ]);

          const normalize = (items) => (items || []).filter(i => i.poster_path).slice(0, 15).map(item => ({
            id: item.id,
            title: item.title || item.name,
            year: (item.release_date || item.first_air_date || 'TBA').substring(0, 4),
            apiRating: item.vote_average ? item.vote_average.toFixed(1) : '0.0',
            description: item.overview || 'No transmission data available.',
            image: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
            backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : null,
            type: activeTab,
            subtitle: null,
            apiData: { raw: item }
          }));

          data = { trending: normalize(trending.results), upcoming: normalize(upcoming.results), topRated: normalize(topRated.results) };
        } else if (activeTab === 'anime' || activeTab === 'manga') {
          // ... AniList code untouched ...
          const typeArg = activeTab === 'anime' ? 'ANIME' : 'MANGA';
          const fetchAniList = async (sort, status, useSeason = false, isNext = false) => {
            const query = `
              query ($type: MediaType, $sort: [MediaSort], $status: MediaStatus, $season: MediaSeason, $seasonYear: Int) {
                Page(page: 1, perPage: 15) {
                  media(type: $type, sort: $sort, status: $status, season: $season, seasonYear: $seasonYear) {
                    id
                    title { english romaji }
                    startDate { year }
                    averageScore
                    description(asHtml: false)
                    coverImage { extraLarge large }
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
            return json.data?.Page?.media || [];
          };

          const isAnime = activeTab === 'anime';
          const [trending, upcoming, topRated] = await Promise.all([
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
            image: item.coverImage?.extraLarge || item.coverImage?.large,
            backdrop: item.bannerImage || null,
            type: activeTab,
            subtitle: item.season && item.seasonYear ? `${item.season} ${item.seasonYear}` : null,
            apiData: { raw: item }
          }));

          data = { trending: normalize(trending), upcoming: normalize(upcoming), topRated: normalize(topRated) };
        } else if (activeTab === 'games') {
          // ... IGDB code untouched ...
          const fetchIGDB = async (query) => {
            try {
              console.log(`[IGDB Debug] Sending Query:`, query);
              const { data, error } = await supabase.functions.invoke('igdb', { 
                body: { endpoint: 'games', query } 
              });
              
              console.log(`[IGDB Debug] Raw Response:`, { data, error });
              
              if (error) throw error;
              if (data?.error || data?.message) throw new Error(data.error || data.message || JSON.stringify(data));
              
              return Array.isArray(data) ? data : data?.data || data?.results || [];
            } catch (err) {
              console.error(`[IGDB Debug] CRITICAL FAILURE:`, err);
              return [];
            }
          };

          const now = Math.floor(Date.now() / 1000);
          const sixMonthsAgo = now - 15552000;
          const [trending, upcoming, topRated] = await Promise.all([
            fetchIGDB(`fields id, name, first_release_date, total_rating, rating, summary, cover.image_id, artworks.image_id; where first_release_date >= ${sixMonthsAgo} & first_release_date <= ${now} & parent_game = null & total_rating_count > 0; sort total_rating_count desc; limit 30;`),
            fetchIGDB(`fields id, name, first_release_date, total_rating, rating, summary, cover.image_id, artworks.image_id; where first_release_date > ${now} & parent_game = null & hypes > 0; sort hypes desc; limit 30;`),
            fetchIGDB(`fields id, name, first_release_date, total_rating, rating, summary, cover.image_id, artworks.image_id; where total_rating_count > 500 & parent_game = null; sort total_rating desc; limit 30;`)
          ]);

          const normalize = (items) => (items || [])
            .filter(item => item.cover?.image_id)
            .slice(0, 15)
            .map(item => ({
            id: `igdb_${item.id}`, title: item.name, year: item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear().toString() : 'TBA',
            apiRating: item.total_rating ? (item.total_rating / 10).toFixed(1) : (item.rating ? (item.rating / 10).toFixed(1) : '0.0'),
            description: item.summary || 'No descriptive data available.',
            image: `https://images.igdb.com/igdb/image/upload/t_720p/${item.cover.image_id}.jpg`,
            backdrop: item.artworks?.[0]?.image_id ? `https://images.igdb.com/igdb/image/upload/t_1080p/${item.artworks[0].image_id}.jpg` : null,
            type: activeTab, apiData: { raw: item }
          }));
          
          let finalTrending = normalize(trending);
          let finalUpcoming = normalize(upcoming);
          let finalTopRated = normalize(topRated);

          if (finalTrending.length === 0) finalTrending = generateDummyData(activeTab);
          if (finalUpcoming.length === 0) finalUpcoming = generateDummyData(activeTab);
          if (finalTopRated.length === 0) finalTopRated = generateDummyData(activeTab);
          
          data = { trending: finalTrending, upcoming: finalUpcoming, topRated: finalTopRated };
        } else if (activeTab === 'vn') {
  const fetchVNDB = async (sort, reverse, filters = []) => {
    try {
      const body = {
        filters: filters.length > 1 ? ["and", ...filters] : (filters.length === 1 ? filters[0] : ["id", ">=", "v1"]),
        fields: "id, title, released, rating, description, image.url, screenshots.url",
        sort, reverse, results: 20
      };
      const res = await fetch('https://api.vndb.org/kana/vn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      return json.results || [];
    } catch (err) {
      console.error("VNDB Fetch Error:", err);
      return [];
    }
  };

  // Correct date calculations without mutation
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(lastYear.getFullYear() - 1);
  const lastYearStr = lastYear.toISOString().split('T')[0];

  const [trending, upcoming, topRated] = await Promise.all([
    // Trending: popular VNs from the last year
    fetchVNDB('votecount', true, [["released", ">=", lastYearStr], ["released", "<=", todayStr]]),
    // Upcoming: future releases sorted by release date (ascending)
    fetchVNDB('released', false, [["released", ">=", todayStr]]),
    // Top Rated: highest rated with at least 500 votes
    fetchVNDB('rating', true, [["votecount", ">=", 500]])
  ]);

  const normalize = (items) => (items || [])
    .filter(item => item.image?.url || item.screenshots?.[0]?.url)
    .slice(0, 15)
    .map(item => ({
      id: `vndb_${item.id}`,
      title: item.title,
      year: item.released ? item.released.substring(0, 4) : 'TBA',
      apiRating: item.rating ? (item.rating / 10).toFixed(1) : '0.0',
      description: stripHtml(item.description) || 'No descriptive data available.',
      image: item.image?.url || item.screenshots?.[0]?.url,
      backdrop: item.screenshots?.[0]?.url || item.image?.url,
      type: activeTab,
      apiData: { raw: item }
    }));

  let finalTrending = normalize(trending);
  let finalUpcoming = normalize(upcoming);
  let finalTopRated = normalize(topRated);

  if (finalTrending.length === 0) finalTrending = generateDummyData(activeTab);
  if (finalUpcoming.length === 0) finalUpcoming = generateDummyData(activeTab);
  if (finalTopRated.length === 0) finalTopRated = generateDummyData(activeTab);

  data = { trending: finalTrending, upcoming: finalUpcoming, topRated: finalTopRated };
} else if (activeTab === 'comics') {
          const fetchMetron = async (endpoint) => {
            try {
              console.log(`[Metron Debug] Sending:`, endpoint);
              const { data, error } = await supabase.functions.invoke('metron', { 
                body: { endpoint, path: endpoint, method: 'GET' } 
              });
              
              console.log(`[Metron Debug] Raw Response:`, { data, error });
              
              if (error) throw error;
              if (data?.error || data?.message) throw new Error(data.error || data.message || JSON.stringify(data));
              
              return Array.isArray(data) ? data : data?.results || data?.data || [];
            } catch (err) {
              console.error("[Metron Debug] CRITICAL FAILURE:", err);
              return [];
            }
          };

          // Compute date ranges
          const now = new Date();
          const thisMonday = getMonday(now);
          const thisSunday = addDays(thisMonday, 6);
          const nextMonday = addDays(thisMonday, 7);
          const nextSunday = addDays(nextMonday, 6);
          const futureMonday = addDays(nextMonday, 7); // start of week after next

          const thisWeekStart = formatYMD(thisMonday);
          const thisWeekEnd = formatYMD(thisSunday);
          const nextWeekStart = formatYMD(nextMonday);
          const nextWeekEnd = formatYMD(nextSunday);
          const futureStart = formatYMD(futureMonday);

          // Fetch with date ranges
          const trending = await fetchMetron(
            `/issue/?store_date_range_after=${thisWeekStart}&store_date_range_before=${thisWeekEnd}&page_size=50`
          );
          const upcoming = await fetchMetron(
            `/issue/?store_date_range_after=${nextWeekStart}&store_date_range_before=${nextWeekEnd}&page_size=50`
          );
          const topRated = await fetchMetron(
            `/issue/?store_date_range_after=${futureStart}&page_size=50`
          );

          const normalizeIssues = (items) => (items || []).filter(item => item.image && item.series).slice(0, 15).map(item => ({
            id: item.series.id, // route to series page
            title: item.series.name || 'Unknown',
            year: item.store_date ? item.store_date.substring(0, 4) : 'TBA',
            apiRating: '0.0', 
            description: stripHtml(item.desc) || 'No descriptive data available.',
            image: `https://wsrv.nl/?url=${encodeURIComponent(item.image)}&w=400&output=webp`,
            backdrop: `https://wsrv.nl/?url=${encodeURIComponent(item.image)}&w=800&output=webp`,
            type: activeTab, subtitle: `Issue #${item.number}`,
            apiData: { raw: { ...item, id: item.series.id } } // mask ID to force detail view to fetch the series
          }));

          let finalTrending = normalizeIssues(trending);
          let finalUpcoming = normalizeIssues(upcoming);
          let finalTopRated = normalizeIssues(topRated);

          if (finalTrending.length === 0) finalTrending = generateDummyData(activeTab);
          if (finalUpcoming.length === 0) finalUpcoming = generateDummyData(activeTab);
          if (finalTopRated.length === 0) finalTopRated = generateDummyData(activeTab);

          data = { trending: finalTrending, upcoming: finalUpcoming, topRated: finalTopRated };
        } else {
          const dummy = generateDummyData(activeTab);
          data = { trending: dummy, upcoming: dummy, topRated: dummy };
        }
        
        if (isMounted) setDiscoveryCache(activeTab, data);
      } catch (err) {
        console.error('Discovery fetch error:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadData();
    return () => { isMounted = false; };
  }, [activeTab, setDiscoveryCache]);

  const currentData = discoveryCache[activeTab]?.data || { trending: [], upcoming: [], topRated: [] };

  const handleTabChange = (tab) => {
    if (!discoveryCache[tab] || (Date.now() - discoveryCache[tab].timestamp >= 43200000)) setIsLoading(true);
    setActiveTab(tab);
    sessionStorage.setItem('discoveryTab', tab);
  };

  // Dynamic section titles for comics
  const isComics = activeTab === 'comics';
  const section1Title = isComics ? 'This Week' : 'Trending Spotlight';
  const section2Title = isComics ? 'Next Week' : 'Anticipated Releases';
  const section3Title = isComics ? 'Future' : 'Popular';

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300 pb-10 min-h-screen text-base-content overflow-x-hidden">
      
      {/* Streamlined Header */}
      <header className="border-b border-base-300 pb-4">
        <h1 className="text-2xl font-black uppercase tracking-widest font-sans flex items-center gap-2">
          <Compass className="w-6 h-6 text-primary" /> Discovery
        </h1>
      </header>

      {/* Wrapping Tabs */}
      <div className="flex flex-wrap pb-2 border-b border-base-300 gap-1.5 sm:gap-2">
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
      </div>

      {isLoading ? <DiscoverySkeleton /> : (
      <div className="flex flex-col gap-6 sm:gap-8 animate-in fade-in duration-500">
        
        {/* 1. THIS WEEK / TRENDING */}
        <CarouselSection title={section1Title} icon={<Flame className="w-4 h-4 text-warning" />} items={currentData.trending} type={activeTab} showRank={!isComics} categoryKey="trending" />

        {/* 2. NEXT WEEK / ANTICIPATED */}
        <CarouselSection title={section2Title} icon={<CalendarClock className="w-4 h-4 text-info" />} items={currentData.upcoming} type={activeTab} categoryKey="upcoming" />

        {/* 3. FUTURE / POPULAR */}
        <CarouselSection title={section3Title} icon={<Star className="w-4 h-4 text-success" />} items={currentData.topRated} type={activeTab} showRank={!isComics} categoryKey="popular" />

      </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* TRENDING CAROUSEL SECTION (1:1 Hero + Standard 2:3 Items)                  */
/* -------------------------------------------------------------------------- */
const TrendingCarouselSection = ({ title, items, type }) => {
  const scrollRef = useRef(null);
  if (!items || items.length === 0) return null;
  const heroItem = items[0];
  const standardItems = items.slice(1, 15); 
  const colors = getMediaTypeColors(type);
  const heroRating = heroItem.apiRating || heroItem.rating;

  const scroll = (direction) => {
    if (scrollRef.current) {
      const { current } = scrollRef;
      const scrollAmount = direction === 'left' ? -current.offsetWidth * 0.75 : current.offsetWidth * 0.75;
      current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-base-300/50 pb-2">
        <h2 className="text-sm font-black uppercase tracking-widest font-sans flex items-center gap-2">
          <Flame className="w-4 h-4 text-warning" /> {title}
        </h2>
      </div>

      <div className="relative group/carousel">
        <button onClick={() => scroll('left')} className="absolute left-2 top-1/2 -translate-y-[calc(50%+8px)] z-40 bg-base-100/90 hover:bg-primary text-base-content hover:text-primary-content w-10 h-10 items-center justify-center hidden md:group-hover/carousel:flex backdrop-blur-md transition-all border border-base-300 shadow-2xl rounded-full">
          <ChevronLeft className="w-6 h-6" />
        </button>

        <div ref={scrollRef} className="flex items-stretch overflow-x-auto gap-2 sm:gap-4 snap-x pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {/* Hero Item */}
          <Link to={`/media/${type}/${heroItem.id}`} state={{ previewData: heroItem }} className={`group flex-shrink-0 w-[calc(66.666%-0.17rem)] sm:w-[22rem] md:w-[28rem] lg:w-[36rem] xl:w-[44rem] flex flex-col justify-end p-3 sm:p-5 cursor-pointer snap-start relative bg-black overflow-hidden transition-all duration-300 shadow-xl hover:ring-2 hover:ring-primary hover:ring-offset-2 hover:ring-offset-base-100`}>
            <div className="absolute inset-0 z-0"><ImageWithFallback src={heroItem.backdrop || heroItem.image} alt={heroItem.title} className="w-full h-full object-cover grayscale-[20%] group-hover:grayscale-0 transition-transform duration-700 group-hover:scale-105 opacity-60 group-hover:opacity-80" /></div>
            <div className={`absolute top-0 right-0 w-full h-1 ${colors.bg} opacity-50 group-hover:opacity-100 transition-opacity z-20`}></div>
            <div className={`absolute top-0 left-0 bg-base-100/90 text-base-content font-black font-mono px-2 py-0.5 text-[10px] sm:text-xs border-r border-b border-base-300 z-10 shadow-sm`}><span className="w-1.5 h-1.5 bg-black rounded-full animate-pulse"></span> #1</div>
            <div className="relative z-20 flex flex-col gap-1 sm:gap-2 mt-auto">
              <h3 className="text-lg sm:text-2xl md:text-3xl font-black font-sans uppercase tracking-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] group-hover:text-primary transition-colors line-clamp-2 leading-tight">{heroItem.title}</h3>
              <div className="flex items-center gap-3 text-[9px] sm:text-[10px] font-mono font-bold text-white/60 uppercase tracking-widest sm:mt-2 drop-shadow-md">
                <span className="flex items-center gap-1"><Star className="w-3 h-3 text-warning fill-warning" /> {heroItem.apiRating}</span>
                <span>{heroItem.year}</span>
              </div>
            </div>
          </Link>

          {/* Standard Items */}
          {standardItems.map((item, i) => (
            <CarouselCard key={item.id} item={item} type={type} rank={i + 2} />
          ))}
        </div>

        <button onClick={() => scroll('right')} className="absolute right-2 top-1/2 -translate-y-[calc(50%+8px)] z-40 bg-base-100/90 hover:bg-primary text-base-content hover:text-primary-content w-10 h-10 items-center justify-center hidden md:group-hover/carousel:flex backdrop-blur-md transition-all border border-base-300 shadow-2xl rounded-full">
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>
    </section>
  );
};

/* -------------------------------------------------------------------------- */
/* FUTURISTIC CAROUSEL SECTION (NO SCROLLBARS)                                */
/* -------------------------------------------------------------------------- */
const CarouselSection = ({ title, icon, items, type, showRank = false }) => {
  const scrollRef = useRef(null);
  if (!items || items.length === 0) return null;

  const scroll = (direction) => {
    if (scrollRef.current) {
      const { current } = scrollRef;
      const scrollAmount = direction === 'left' ? -current.offsetWidth * 0.75 : current.offsetWidth * 0.75;
      current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
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

        {/* Hide Scrollbar via Tailwind arbitrarily-injected CSS */}
        <div ref={scrollRef} className="flex overflow-x-auto gap-2 sm:gap-4 snap-x pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {items.map((item, i) => <CarouselCard key={item.id} item={item} type={type} rank={showRank ? i + 1 : null} />)}
        </div>

        <button onClick={() => scroll('right')} className="absolute right-2 top-1/2 -translate-y-[calc(50%+8px)] z-40 bg-base-100/90 hover:bg-primary text-base-content hover:text-primary-content w-10 h-10 items-center justify-center hidden md:group-hover/carousel:flex backdrop-blur-md transition-all border border-base-300 shadow-2xl rounded-full">
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>
    </section>
  );
};

const CarouselCard = ({ item, type, rank }) => {
  if (!item) return null; // Prevent render crashes if cache is corrupted
  const colors = getMediaTypeColors(type);
  const displayRating = item.apiRating || item.rating;
  
  return (
    <Link to={`/media/${type}/${item.id}`} state={{ previewData: item }} className={`group flex-shrink-0 w-[calc(33.333%-0.34rem)] sm:w-36 md:w-44 flex flex-col cursor-pointer snap-start relative bg-base-100 border-y border-r border-base-300 border-l-4 border-l-transparent ${colors.hoverBorder} transition-all duration-200 hover:shadow-md h-full`}>
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
    </Link>
  );
};