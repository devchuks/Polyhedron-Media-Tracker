import React, { useState, useEffect, useRef } from 'react';
import { Flame, CalendarClock, Star, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ImageWithFallback, getMediaTypeColors } from '../components/UI';
import { useMediaStore } from '../store/useMediaStore';
import { isIntentionalAbort } from '../utils/requestErrors';
import { fetchDiscoveryTab, invokeDiscoveryFunction } from '../services/discoveryLoader';
import { DISCOVERY_CACHE_VERSION, DISCOVERY_SECTIONS, DISCOVERY_TYPES, isDiscoveryCacheFresh, tmdbDiscoveryRequest } from '../domain/discoveryCatalog';

const TABS = DISCOVERY_TYPES;

const DiscoverySkeleton = () => (
  <div className="flex flex-col gap-6 sm:gap-8 w-full animate-pulse mt-2">
    {[1, 2, 3].map(section => (
      <section key={section} className="flex flex-col gap-3">
        <div className="h-5 w-40 bg-base-300 mb-2"></div>
        <div className="flex overflow-x-hidden gap-2 sm:gap-4">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="w-[calc((100%_-_1rem)/3)] sm:w-36 md:w-44 aspect-[2/3] bg-base-300 flex-shrink-0 border border-base-300"></div>)}
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
  const [sectionErrors, setSectionErrors] = useState({});

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      if (isDiscoveryCacheFresh(useMediaStore.getState().discoveryCache?.[activeTab])) {
        if (isMounted) setIsLoading(false);
        return;
      }

      if (isMounted) {
        setIsLoading(true);
        setSectionErrors({});
      }
      try {
        // Shares a background prefetch that is already loading this tab.
        const { data, errors } = await fetchDiscoveryTab(activeTab);
        if (isMounted) {
          setSectionErrors(errors);
          setDiscoveryCache(activeTab, data);
        }
      } catch (err) {
        if (!isIntentionalAbort(err)) {
          console.error('Discovery fetch error:', err);
          if (isMounted) setSectionErrors(Object.fromEntries(DISCOVERY_SECTIONS[activeTab].map(section => [section.key, 'The provider could not load this section.'])));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadData();
    return () => { isMounted = false; };
  }, [activeTab, setDiscoveryCache, refreshTrigger]);

  const handleLoadMoreItems = async (categoryKey, page) => {
    if (activeTab !== 'movies' && activeTab !== 'tv') return;

    const request = tmdbDiscoveryRequest(activeTab, categoryKey, page);

    try {
      const res = await invokeDiscoveryFunction('tmdb', { path: request.path, query: request.query });
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

        setDiscoveryCache(activeTab, { ...currentCache.data, [categoryKey]: [...currentCache.data[categoryKey], ...uniqueNewItems], _version: DISCOVERY_CACHE_VERSION });
      }
      return true;
    } catch (err) {
      if (!isIntentionalAbort(err)) console.error("TMDB Load More Error:", err);
      setSectionErrors(errors => ({ ...errors, [categoryKey]: 'More results could not be loaded. Please retry.' }));
      return false;
    }
  };

  const currentData = discoveryCache?.[activeTab]?.data || { trending: [], upcoming: [], popular: [] };
  const hasCurrentContent = ['trending', 'upcoming', 'popular'].some(key => currentData[key]?.length > 0);

  const handleTabChange = (tab) => {
    const cached = discoveryCache?.[tab];
    const isEmpty = !cached?.data || ['trending', 'upcoming', 'popular'].every(key => !(cached.data[key]?.length));
    const isImplemented = DISCOVERY_TYPES.includes(tab);
    
    const isStale = !cached || cached.data?._version !== DISCOVERY_CACHE_VERSION;
    
    if (isStale || (isImplemented && isEmpty)) setIsLoading(true);
    setActiveTab(tab);
    sessionStorage.setItem('discoveryTab', tab);
  };

  const handleForceRefresh = () => {
    useMediaStore.setState(state => {
      const cached = state.discoveryCache?.[activeTab];
      return cached ? {
        discoveryCache: { ...state.discoveryCache, [activeTab]: { ...cached, timestamp: 0 } },
      } : state;
    });
    setIsLoading(true);
    setRefreshTrigger(prev => prev + 1);
  };

  const isComics = activeTab === 'comics';
  const [section1, section2, section3] = DISCOVERY_SECTIONS[activeTab];

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
        {isLoading && hasCurrentContent && <span role="status" className="font-mono text-[9px] uppercase tracking-widest text-base-content/50">Updating</span>}
      </div>

      {isLoading && !hasCurrentContent ? <DiscoverySkeleton /> : (
      // A newly fetched snapshot fades in as a whole instead of swapping cards in place.
      <div key={`${activeTab}:${currentData._fetchedAt || 0}`} className="flex flex-col gap-6 sm:gap-8 animate-in fade-in duration-500">
        <CarouselSection key={`${activeTab}-trending`} title={section1.name} provider={section1.provider} error={sectionErrors.trending} onRetry={handleForceRefresh} icon={<Flame className="w-4 h-4 text-warning" />} items={currentData.trending} type={activeTab} showRank={!isComics} categoryKey="trending" onLoadMore={handleLoadMoreItems} />
        <CarouselSection key={`${activeTab}-upcoming`} title={section2.name} provider={section2.provider} error={sectionErrors.upcoming} onRetry={handleForceRefresh} icon={<CalendarClock className="w-4 h-4 text-info" />} items={currentData.upcoming} type={activeTab} categoryKey="upcoming" onLoadMore={handleLoadMoreItems} />
        <CarouselSection key={`${activeTab}-popular`} title={section3.name} provider={section3.provider} error={sectionErrors.popular} onRetry={handleForceRefresh} icon={<Star className="w-4 h-4 text-success" />} items={currentData.popular} type={activeTab} showRank={!isComics} categoryKey="popular" onLoadMore={handleLoadMoreItems} />
      </div>
      )}
    </div>
  );
};

const CarouselSection = ({ title, provider, icon, items, error, onRetry, type, showRank = false, categoryKey, onLoadMore }) => {
  const scrollRef = useRef(null);
  const [limit, setLimit] = useState(15);
  const [apiPage, setApiPage] = useState(1);
  const [isFetching, setIsFetching] = useState(false);

  const visibleItems = (items || []).slice(0, limit);
  const hasMoreLocal = limit < (items?.length || 0);
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
      try {
        const succeeded = await onLoadMore(categoryKey, nextApiPage);
        if (succeeded) {
          setApiPage(nextApiPage);
          setLimit(l => l + 15);
          setTimeout(() => scroll('right'), 100);
        }
      } finally {
        setIsFetching(false);
      }
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-base-300/50 pb-2">
        <h2 className="text-sm font-black uppercase tracking-widest font-sans flex items-center gap-2">
          {icon} {title}
        </h2>
      </div>

      {error && visibleItems.length === 0 ? (
        <div role="alert" className="min-h-32 border border-error/40 bg-error/5 p-5 flex flex-col items-center justify-center gap-3 text-center">
          <p className="font-mono text-[10px] uppercase tracking-widest text-error">{error}</p>
          <button type="button" onClick={onRetry} className="h-9 px-4 border border-error text-error hover:bg-error hover:text-error-content font-mono text-[10px] font-bold uppercase tracking-widest">Retry {provider}</button>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="min-h-32 border border-base-300 bg-base-100 p-5 flex items-center justify-center text-center font-mono text-[10px] uppercase tracking-widest text-base-content/50">No titles are currently available in this section.</div>
      ) : (
      <>
      {error && <div role="alert" className="flex items-center justify-between gap-3 border border-error/40 bg-error/5 px-3 py-2"><span className="font-mono text-[9px] uppercase tracking-widest text-error">{error}</span><button type="button" onClick={onRetry} className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-widest text-error underline">Retry</button></div>}
      <div className="relative group/carousel">
        <button onClick={() => scroll('left')} className="absolute left-2 top-1/2 -translate-y-[calc(50%+8px)] z-40 bg-base-100/90 hover:bg-primary text-base-content hover:text-primary-content w-10 h-10 items-center justify-center hidden md:group-hover/carousel:flex backdrop-blur-md transition-all border border-base-300 shadow-2xl rounded-full">
          <ChevronLeft className="w-6 h-6" />
        </button>

        <div ref={scrollRef} className="flex overflow-x-auto gap-2 sm:gap-4 snap-x pb-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {visibleItems.map((item, i) => <CarouselCard key={item.uniqueKey || item.id || i} item={item} type={type} rank={showRank ? i + 1 : null} />)}
          
          {hasMore && (
            <button type="button"
              onClick={handleLoadMore}
              className="group flex-shrink-0 w-[calc(33.333%-0.34rem)] sm:w-36 md:w-44 flex flex-col cursor-pointer snap-start relative bg-base-200/50 hover:bg-base-200 border-y border-r border-base-300 border-l-4 border-l-transparent hover:border-l-primary transition-all duration-200"
            >
              <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 text-base-content/50 group-hover:text-primary transition-colors">
                <div className="w-10 h-10 rounded-full bg-base-100 border border-base-300 flex items-center justify-center shadow-sm group-hover:shadow-md transition-all">
                  {isFetching ? <RefreshCw className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
                </div>
                <span className="font-mono font-bold text-[10px] uppercase tracking-widest">{isFetching ? 'Loading...' : 'Load More'}</span>
              </div>
            </button>
          )}
        </div>

        <button onClick={() => scroll('right')} className="absolute right-2 top-1/2 -translate-y-[calc(50%+8px)] z-40 bg-base-100/90 hover:bg-primary text-base-content hover:text-primary-content w-10 h-10 items-center justify-center hidden md:group-hover/carousel:flex backdrop-blur-md transition-all border border-base-300 shadow-2xl rounded-full">
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>
      </>
      )}
    </section>
  );
};

const CarouselCard = ({ item, type, rank }) => {
  if (!item) return null;
  const colors = getMediaTypeColors(type);
  const displayRating = item.apiRating || item.rating;
  const isClickable = Boolean(item.id);
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
