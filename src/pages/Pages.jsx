import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useMediaStore, useUIStore } from '../store/useMediaStore';
import { MediaCard, MediaListRow, StarRating, getMediaTypeColors, SectionWrapper, TextBlockSkeleton, PillSkeleton, MetaItem, EpisodeCard, ImageWithFallback, getSubtype, CreativeTeamSection, UserActivitySection, GalleryAndLinks, ComicIssuesSection, formatFancyDate, getDynamicStatusLabel, getStatusColor, stripHtml, resolveMediaImage } from '../components/UI';
import { Star, ArrowLeft, Loader2, Filter, PlayCircle, X, ExternalLink, ChevronLeft, ChevronRight, Edit3, Plus, ChevronDown, ChevronUp, Download, LayoutGrid, List } from 'lucide-react';
import { apiRegistry } from '../services/apiRegistry';
import { processDetailRaw } from '../utils/normalizers';
import { NotFound } from './NotFound';
import { populateDemoData } from './Settings';

const VALID_CATEGORIES = ['tv', 'movies', 'games', 'vn', 'anime', 'manga', 'books', 'comics'];

const getStatusBorderClass = (status) => {
  const map = { planned: 'border-info', 'in progress': 'border-warning', completed: 'border-success', dropped: 'border-error' };
  return map[status?.toLowerCase()] || 'border-primary';
};

const isFutureRelease = (item) => {
  const raw = item.apiData?.raw || {};
  if (['UPCOMING', 'NOT YET RELEASED', 'NOT_YET_RELEASED'].includes(raw.status?.toUpperCase())) return true;
  const rDate = new Date(raw.release_date || raw.first_air_date || raw.released || (raw.first_release_date ? raw.first_release_date * 1000 : null));
  if (!isNaN(rDate) && rDate > new Date()) return true;
  const yearNum = parseInt(raw.start_year || raw.first_publish_year || item.apiData?.year);
  return !isNaN(yearNum) && yearNum > new Date().getFullYear();
};

const DashSection = ({ title, items }) => (
  <section className="mb-4">
    <div className="flex items-center justify-between border-b border-base-300 pb-2 mb-4">
      <h2 className="text-sm font-black uppercase tracking-widest font-sans text-base-content">{title}</h2>
    </div>
    {items.length > 0 ? (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">{items.map(item => <MediaCard key={item.id} item={item} />)}</div>
    ) : (
      <div className="w-full bg-base-100 border border-base-300 p-8 flex items-center justify-center text-[10px] font-mono text-base-content/40 uppercase tracking-widest">No records found.</div>
    )}
  </section>
);

export const Dashboard = () => {
  const authMode = useMediaStore((state) => state.authMode);
  const media = useMediaStore((state) => state.media);
  
  const { upcomingItems, recentlyAddedItems, allItemsLength } = React.useMemo(() => {
    const allItems = Object.values(media).flat();
    const getAddedTime = (item) => item.addedAt || item.dateAdded || 0;
    const upcoming = allItems.filter(item => item.status === 'planned' && isFutureRelease(item)).sort((a, b) => getAddedTime(b) - getAddedTime(a)).slice(0, 5);
    const recent = allItems.filter(item => !upcoming.includes(item)).sort((a, b) => getAddedTime(b) - getAddedTime(a)).slice(0, 10);
    return { upcomingItems: upcoming, recentlyAddedItems: recent, allItemsLength: allItems.length };
  }, [media]);
  
  const [isPopulating, setIsPopulating] = useState(false);
  const [popLog, setPopLog] = useState('');

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300 min-h-screen">
      {authMode === 'guest' && (allItemsLength === 0 || isPopulating) && (
        <div className="bg-info/5 border border-info/20 p-6 flex flex-col gap-4 items-start">
          <div>
            <h2 className="text-sm font-black uppercase tracking-widest text-info mb-1">Guest Mode Playground</h2>
            <p className="text-xs font-mono text-base-content/70">Your local volatile library is empty. You can populate it with 40 random demo entries to safely test the dashboard, library filters, and diary logs. To clear this data later, go to Settings in the top right menu.</p>
          </div>
          <button
            onClick={() => populateDemoData(useMediaStore.getState(), setPopLog, setIsPopulating)}
            disabled={isPopulating}
            className="flex items-center justify-center h-8 px-3 bg-transparent border border-info text-info hover:bg-info hover:text-info-content rounded-none appearance-none font-mono text-xs uppercase tracking-widest gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPopulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Populate Demo Data
          </button>
          {popLog && (
            <pre className="text-[10px] font-mono bg-base-300 p-3 max-h-40 overflow-y-auto whitespace-pre-wrap w-full text-left">
              {popLog}
            </pre>
          )}
        </div>
      )}
      <DashSection title="Upcoming Releases" items={upcomingItems} />
      <DashSection title="Recently Added" items={recentlyAddedItems} />
    </div>
  );
};

export const MediaCategory = () => {
  const { category } = useParams();
  
  if (!VALID_CATEGORIES.includes(category)) return <NotFound />;
  
  const items = useMediaStore((state) => state.media[category]) || [];
  const viewMode = useUIStore((state) => state.viewMode);
  const setViewMode = useUIStore((state) => state.setViewMode);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('dateAdded');
  
  const ITEMS_PER_PAGE = 40;
  const [currentPage, setCurrentPage] = useState(1);
  
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [currentPage]);
  useEffect(() => { setCurrentPage(1); }, [category, filter, sort]);

  let displayItems = items.filter(item => filter === 'all' || item.status === filter);
  if (sort === 'dateAdded') displayItems.sort((a,b) => (b.addedAt || b.dateAdded || 0) - (a.addedAt || a.dateAdded || 0));
  else if (sort === 'dateStarted') displayItems.sort((a,b) => (b.dateStarted || 0) - (a.dateStarted || 0));
  else if (sort === 'dateFinished') displayItems.sort((a,b) => (b.dateCompleted || 0) - (a.dateCompleted || 0));
  else if (sort === 'rating') displayItems.sort((a,b) => b.rating - a.rating);
  else if (sort === 'title') displayItems.sort((a,b) => a.title.localeCompare(b.title));

  const totalPages = Math.ceil(displayItems.length / ITEMS_PER_PAGE) || 1;
  const paginatedItems = displayItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  return (
    <div className="flex flex-col gap-4 animate-in fade-in duration-300 pb-10 min-h-screen text-base-content">
      <header className="border-b border-base-300 pb-3 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div><h1 className="text-2xl font-black uppercase tracking-widest font-sans">{getSubtype(category)}</h1><p className="text-[10px] font-mono text-base-content/50 uppercase tracking-widest mt-1">{displayItems.length} found</p></div>
        <div className="flex flex-row items-center gap-2 w-full sm:w-auto mt-3 sm:mt-0">
          <div className="flex bg-base-100 border border-base-300 rounded-none h-8">
            <button onClick={() => setViewMode('grid')} className={`flex-1 px-3 ${viewMode === 'grid' ? 'bg-primary text-primary-content' : 'text-base-content/50 hover:bg-base-200'}`}><LayoutGrid className="w-4 h-4"/></button>
            <button onClick={() => setViewMode('list')} className={`flex-1 px-3 ${viewMode === 'list' ? 'bg-primary text-primary-content' : 'text-base-content/50 hover:bg-base-200'}`}><List className="w-4 h-4"/></button>
          </div>
          <div className="dropdown dropdown-bottom sm:dropdown-end flex-1 sm:flex-none min-w-0">
            <div role="button" tabIndex={0} className="w-full h-8 rounded-none border border-base-300 bg-base-100 hover:bg-base-200 hover:border-primary text-[10px] font-mono uppercase font-bold tracking-widest flex px-2 sm:px-3 justify-between items-center cursor-pointer appearance-none transition-colors"><div className="flex items-center min-w-0"><Filter className="w-3 h-3 mr-1 shrink-0" /> <span className="truncate">{filter === 'all' ? 'Filter' : 'Filtered'}</span></div></div>
            <ul tabIndex={0} className="dropdown-content z-50 menu p-2 shadow-xl bg-base-100 border border-base-300 w-52 mt-1 rounded-none text-[10px] font-mono uppercase font-bold tracking-widest"><li><a onClick={() => { setFilter('all'); document.activeElement.blur(); }}>All Entries</a></li>{['planned', 'in progress', 'completed', 'dropped'].map(s => (<li key={s}><a onClick={() => { setFilter(s); document.activeElement.blur(); }}>{s}</a></li>))}</ul>
          </div>
          <div className="dropdown dropdown-bottom sm:dropdown-end flex-1 sm:flex-none min-w-0">
            <div role="button" tabIndex={0} className="w-full h-8 rounded-none border border-base-300 bg-base-100 hover:bg-base-200 hover:border-primary text-[10px] font-mono uppercase font-bold tracking-widest flex px-2 sm:px-3 justify-between items-center cursor-pointer appearance-none transition-colors"><span className="truncate">Sort: {sort}</span></div>
            <ul tabIndex={0} className="dropdown-content z-50 menu p-2 shadow-xl bg-base-100 border border-base-300 w-52 mt-1 rounded-none text-[10px] font-mono uppercase font-bold tracking-widest"><li><a onClick={() => { setSort('dateAdded'); document.activeElement.blur(); }}>Date Added</a></li><li><a onClick={() => { setSort('rating'); document.activeElement.blur(); }}>Rating</a></li><li><a onClick={() => { setSort('title'); document.activeElement.blur(); }}>Title (A-Z)</a></li></ul>
          </div>
        </div>
      </header>

      {displayItems.length > 0 ? (
        <>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3" style={{ gridAutoRows: 'min-content' }}>
              {paginatedItems.map(item => <MediaCard key={item.id} item={item} />)}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {paginatedItems.map(item => <MediaListRow key={item.id} item={item} />)}
            </div>
          )}
          
          {totalPages > 1 && (
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-base-300">
              <button disabled={currentPage === 1} onClick={() => { setCurrentPage(p => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex items-center justify-center h-11 sm:h-8 px-3 bg-transparent hover:bg-base-300 text-base-content hover:text-base-content rounded-none appearance-none font-mono text-[10px] uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ChevronLeft className="w-4 h-4 mr-1" /> Prev</button>
              <span className="text-[10px] font-mono font-bold text-base-content/50 uppercase tracking-widest">Page {currentPage} of {totalPages}</span>
              <button disabled={currentPage === totalPages} onClick={() => { setCurrentPage(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex items-center justify-center h-11 sm:h-8 px-3 bg-transparent hover:bg-base-300 text-base-content hover:text-base-content rounded-none appearance-none font-mono text-[10px] uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed transition-colors">Next <ChevronRight className="w-4 h-4 ml-1" /></button>
            </div>
          )}
        </>
      ) : (
        <div className="w-full min-h-[40vh] bg-base-100 flex items-center justify-center border border-base-300">
          <div className="text-[10px] font-mono font-bold text-base-content/20 tracking-[0.3em] uppercase">No Matches</div>
        </div>
      )}
    </div>
  );
};

export const DetailView = () => {
  const { type, id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  
  if (!VALID_CATEGORIES.includes(type)) return <NotFound />;
  
  const storeItem = useMediaStore((state) => state.media[type]?.find(m => String(m.id) === String(id)));
  const addMediaItem = useMediaStore((state) => state.addMediaItem);
  const toggleIssueRead = useMediaStore((state) => state.toggleIssueRead);
  const setGlobalLightbox = useMediaStore((state) => state.setGlobalLightbox);
  const mediaLogs = useMediaStore((state) => state.mediaLogs);
  const openDiaryModal = useMediaStore((state) => state.openDiaryModal);
  const isPreview = !storeItem;

  const [previewItem, setPreviewItem] = useState(location.state?.previewData || null);
  const [isDeepFetching, setIsDeepFetching] = useState(false);
  const [recs, setRecs] = useState([]);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const [season, setSeason] = useState(1);
  const [episodes, setEpisodes] = useState([]);
  const [loadingEps, setLoadingEps] = useState(false);
  
  const [showAllSeries, setShowAllSeries] = useState(false);
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const [loadedBannerSrc, setLoadedBannerSrc] = useState(null);
  const activeFetchIdRef = useRef(null);
  const [currentId, setCurrentId] = useState(id);

  // STRICT SYNCHRONOUS STATE RESET: Prevents UI flashing and sticky loading states between route changes
  if (id !== currentId) {
    setCurrentId(id);
    setPreviewItem(location.state?.previewData || null);
    setIsDeepFetching(false);
    setRecs([]);
    setLoadingRecs(true);
    setSeason(1);
    setEpisodes([]);
    setLoadingEps(false);
    setShowAllSeries(false);
    setShowEpisodes(false);
    setShowTrailer(false);
    setLoadedBannerSrc(null);
    activeFetchIdRef.current = null;
  }

  const apiData = storeItem ? storeItem.apiData : previewItem;
  const raw = apiData?.raw || {};

  const originalPosterUrl = resolveMediaImage(apiData, type, 'original');
  const bannerSrc = resolveMediaImage(apiData, type, 'banner');
  const posterImage = resolveMediaImage(apiData, type, 'lg');

  const mediaAssets = (() => {
    if (type === 'comics') return { thumbnails: [], originals: [] };
    if (type === 'games') {
      const originals = (raw.screenshots || []).map(s => `https://images.igdb.com/igdb/image/upload/t_1080p/${s.image_id}.jpg`);
      const thumbnails = (raw.screenshots || []).map(s => `https://images.igdb.com/igdb/image/upload/t_screenshot_med/${s.image_id}.jpg`);
      return { thumbnails, originals };
    }
    if (type === 'vn') { const fullUrls = (raw.screenshots || []).map(s => s.url); return { thumbnails: fullUrls, originals: fullUrls }; }
    if (type === 'movies' || type === 'tv') {
      const fullUrls = raw.images?.backdrops?.length ? raw.images.backdrops.map(b => `https://image.tmdb.org/t/p/w1280${b.file_path}`) : raw.backdrop_path ? [`https://image.tmdb.org/t/p/w1280${raw.backdrop_path}`] : [];
      return { thumbnails: fullUrls.map(u => u.replace('/w1280', '/w300')), originals: fullUrls };
    }
    return { thumbnails: [], originals: [] };
  })();

  const cleanId = String(id).split('_season_')[0].split('_issue_')[0];
  const itemLogs = React.useMemo(() => {
    if (!mediaLogs) return [];
    return mediaLogs
      .filter(log => String(log.media_id).startsWith(cleanId))
      .sort((a, b) => new Date(b.log_date) - new Date(a.log_date));
  }, [mediaLogs, cleanId]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [id]);

  useEffect(() => {
    const targetItem = storeItem ? storeItem.apiData : previewItem;
    if (!targetItem || targetItem.raw?.deepFetched) return;
    if (activeFetchIdRef.current === id) return; // STRICT LOCK: Prevent concurrent duplicate fetches
    
    let isMounted = true; setIsDeepFetching(true);
    activeFetchIdRef.current = id;
    
    apiRegistry.getMediaDetails(id, type).then(rawDetails => {
        if (!isMounted || !rawDetails) return;
        const processed = processDetailRaw(rawDetails, type);
        const updatedRaw = { ...targetItem.raw, ...rawDetails, ...processed, deepFetched: true };
        const updatedYear = rawDetails.release_date?.substring(0, 4) || rawDetails.first_air_date?.substring(0, 4) || rawDetails.released?.substring(0, 4) || rawDetails.startDate?.year || rawDetails.year_began || (rawDetails.first_release_date ? new Date(rawDetails.first_release_date * 1000).getFullYear().toString() : targetItem?.year);
        let updatedTitle = targetItem.title || previewItem?.title;
        if (type === 'vn' && rawDetails.titles) {
          const engTitleObj = rawDetails.titles.find(t => t.lang === 'en' || t.lang === 'eng');
          const displayTitle = engTitleObj?.latin || engTitleObj?.title || rawDetails.title;
          if (displayTitle) updatedTitle = displayTitle;
        }
        
        let updatedUrl = null;
        if (type === 'movies' && rawDetails.id) updatedUrl = `https://www.themoviedb.org/movie/${rawDetails.id}`;
        else if (type === 'tv' && rawDetails.id) updatedUrl = `https://www.themoviedb.org/tv/${rawDetails.id}`;
        else if (type === 'games') updatedUrl = rawDetails.url;
        else if (type === 'anime' && rawDetails.id) updatedUrl = `https://anilist.co/anime/${rawDetails.id}`;
        else if (type === 'manga' && rawDetails.id) updatedUrl = `https://anilist.co/manga/${rawDetails.id}`;
        else if (type === 'vn' && rawDetails.id) updatedUrl = `https://vndb.org/${rawDetails.id}`;
        else if (type === 'books' && rawDetails.workId) updatedUrl = `https://openlibrary.org${rawDetails.workId}`;
        else if (type === 'comics' && rawDetails.id) updatedUrl = `https://metron.cloud/series/${rawDetails.id}/`;

        if (isPreview) setPreviewItem(prev => ({ ...prev, title: updatedTitle, raw: updatedRaw, year: updatedYear, url: updatedUrl || prev.url }));
        else addMediaItem({ ...storeItem, title: updatedTitle, apiData: { ...storeItem.apiData, raw: updatedRaw, year: updatedYear, url: updatedUrl || storeItem.apiData.url } }, type);
    }).catch(err => { 
      // Error caught by apiRegistry, let it fail silently
    }).finally(() => {
      if (isMounted) {
        setIsDeepFetching(false);
        activeFetchIdRef.current = null;
      }
    });
    return () => { isMounted = false; activeFetchIdRef.current = null; };
  }, [id, type]); // REMOVED volatile dependencies to prevent looping

  useEffect(() => {
    if (!apiData?.id) return;
    let isMounted = true;
    setLoadingRecs(true);
    apiRegistry.getRecommendations(apiData.id, type).then(res => { 
      if (isMounted) { setRecs(res); setLoadingRecs(false); }
    });
    if (type === 'tv' && (raw.number_of_seasons > 0 || apiData.raw?.number_of_seasons > 0)) {
      setLoadingEps(true);
      apiRegistry.getTVSeason(apiData.id, 1).then(res => {
        if (isMounted) { setEpisodes(res.episodes || []); setLoadingEps(false); }
      }).catch(() => { if (isMounted) { setEpisodes([]); setLoadingEps(false); } });
    }
    return () => { isMounted = false; };
  }, [apiData?.id, type, raw.number_of_seasons]);

  const fetchSeason = async (tvId, seasonNum) => {
    setLoadingEps(true);
    try { setEpisodes((await apiRegistry.getTVSeason(tvId, seasonNum)).episodes || []); } catch (err) { setEpisodes([]); }
    setLoadingEps(false);
  };

  const titleText = storeItem ? storeItem.title : previewItem?.title || apiData?.title || "Unknown Title";

  if (!apiData) return <div className="p-10 font-mono text-base-content/50 font-bold animate-pulse">Loading details...</div>;

  const trailerUrl = (() => {
    if (type === 'movies' || type === 'tv') { const vid = raw.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer') || raw.videos?.results?.[0]; return vid ? `https://www.youtube.com/embed/${vid.key}?autoplay=1` : null; }
    if (type === 'anime' && raw.trailer?.site === 'youtube') return `https://www.youtube.com/embed/${raw.trailer.id}?autoplay=1`;
    if (type === 'games' && raw.videos?.[0]?.video_id) return `https://www.youtube.com/embed/${raw.videos[0].video_id}?autoplay=1`;
    return null;
  })();

  const rawDesc = raw.summary || raw.overview || raw.storyline || raw.description_raw || (typeof raw.description === 'string' ? raw.description : raw.description?.value) || raw.desc || apiData?.description || '';
  const overviewText = stripHtml(rawDesc);
  
  let genres = raw.genres || previewItem?.raw?.genres || apiData.genres || [];
  if (!genres.length && type === 'vn' && raw.tags) genres = raw.tags.slice(0, 5).map(t => ({ name: t.name }));
  
  const validBookAuthors = (type === 'books' ? (apiData.raw?.authors || apiData.authors || raw.authors || []) : []).map(a => typeof a === 'string' ? a : (a?.name || a?.author?.name)).filter(Boolean);
  const comicFormat = type === 'comics' ? (raw.series?.series_type?.name || raw.series_type?.name || (typeof raw.series_type === 'string' ? raw.series_type : null)) : null;
  const collections = (raw.collections && raw.collections.length > 0) ? raw.collections : (raw.collection ? [raw.collection] : []);
  const seriesGames = type === 'games' && collections.length > 0 ? collections[0].games?.filter(g => String(g.id) !== String(raw.id)).sort((a, b) => (a.first_release_date || 0) - (b.first_release_date || 0)) : [];
  const displayedSeriesGames = showAllSeries ? seriesGames : seriesGames.slice(0, 10);
  
  const getDevs = () => { if (raw.involved_companies) return raw.involved_companies.filter(c => c.developer).map(c => c.company?.name).filter(Boolean).join(', '); return (raw.developers || []).length > 0 ? raw.developers.map(d => d.name).join(', ') : null; };
  const getPubs = () => { if (raw.involved_companies) return raw.involved_companies.filter(c => c.publisher).map(c => c.company?.name).filter(Boolean).join(', '); return (raw.publishers || []).length > 0 ? raw.publishers.map(p => typeof p === 'string' ? p : p.name).join(', ') : null; };

  const validRels = raw.relations?.edges?.filter(e => ['ADAPTATION', 'SOURCE'].includes(e.relationType)) || [];
  const platforms = type === 'games' && raw.platforms ? raw.platforms.map(p => p.name || p.platform?.name).filter(Boolean) : raw.platforms?.map(p => p.platform?.name || p).filter(Boolean) || [];
  const typeColors = getMediaTypeColors(type);
  const unifiedScore = raw.total_rating || raw.vote_average || raw.averageScore || (raw.rating && type === 'games' ? raw.rating * 20 : raw.rating ? raw.rating / 10 : 0) || apiData.score;
  const vnLengthMap = ['', 'Very Short (< 2h)', 'Short (2 - 10h)', 'Medium (10 - 30h)', 'Long (30 - 50h)', 'Very Long (> 50h)'];
  const comicReadIssueIds = storeItem?.readIssueIds || [];


  return (
    <div className="flex flex-col animate-in fade-in duration-300 pb-4 lg:pb-6 relative">
      {bannerSrc && (
        <div className="absolute z-0 -top-4 lg:-top-6 -left-4 lg:-left-6 -right-4 lg:-right-6 h-56 lg:h-72 overflow-hidden pointer-events-none" style={{ WebkitMaskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)', maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)' }}>
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-transparent z-10" />
          <img key={bannerSrc} src={bannerSrc} onLoad={() => setLoadedBannerSrc(bannerSrc)} ref={(el) => { if (el?.complete) setLoadedBannerSrc(bannerSrc); }} className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-in-out ${loadedBannerSrc === bannerSrc ? 'opacity-75' : 'opacity-0'}`} alt="" />
        </div>
      )}
      <div className="relative z-10 mb-3 lg:mb-4">
        <button onClick={() => navigate(-1)} className={`flex items-center justify-center h-11 sm:h-8 px-3 -ml-2 rounded-none appearance-none font-mono text-[10px] uppercase tracking-widest transition-colors ${bannerSrc ? 'bg-transparent text-white hover:bg-white/10' : 'bg-transparent hover:bg-base-200 text-base-content/60 hover:text-base-content'}`}><ArrowLeft className="w-4 h-4 mr-2" /> Back</button>
      </div>

      <div className={`flex flex-col lg:flex-row gap-0 items-stretch relative z-10 ${bannerSrc ? 'bg-gradient-to-b from-transparent via-base-100/70 to-base-100 mt-8 lg:mt-12 shadow-xl' : 'bg-base-100 border border-base-300 shadow-xl'}`}>
        <div className={`w-full lg:w-56 xl:w-64 shrink-0 ${bannerSrc ? 'bg-transparent' : 'bg-base-200/30 border-b lg:border-b-0 lg:border-r border-base-300'}`}>
          <div className="p-3 lg:p-5 flex flex-col gap-3 lg:gap-5 lg:sticky lg:top-16 z-10">
            <div className="w-48 sm:w-56 lg:w-full mx-auto lg:mx-0 flex flex-col gap-2">
              <figure className="aspect-[2/3] w-full bg-base-300 border border-base-300 overflow-hidden shadow-xl cursor-pointer" onClick={() => { if (originalPosterUrl) setGlobalLightbox(originalPosterUrl); }}>
                <ImageWithFallback src={posterImage} alt={titleText} />
              </figure>
              {trailerUrl && <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowTrailer(true); }} className="flex items-center justify-center w-full h-11 sm:h-8 bg-base-200 border border-base-300 hover:border-primary hover:text-primary rounded-none appearance-none font-mono text-[9px] uppercase tracking-widest text-base-content/70 gap-1.5 transition-colors"><PlayCircle className="w-3.5 h-3.5" /> [ PLAY TRAILER ]</button>}
            </div>
            
            {/* UNIFIED LOGGING AREA */}
            <div className="w-full flex flex-col gap-3 lg:pt-2 lg:border-t border-base-300">
              <button 
                onClick={() => openDiaryModal({ targetItem: storeItem || previewItem, type, isPreview, apiData, titleToSave: titleText })}
                className={`flex items-center justify-between w-full h-12 px-4 rounded-none appearance-none font-bold font-mono uppercase tracking-widest text-[10px] sm:text-[11px] shadow-sm overflow-hidden transition-colors ${isPreview ? 'bg-primary hover:bg-primary/90 text-primary-content shadow-lg hover:shadow-primary/20' : 'border ' + getStatusBorderClass(storeItem?.status) + ' ' + getStatusColor(storeItem?.status) + ' bg-base-100 hover:bg-base-200'}`}
              >
                <span className="truncate block flex-1 text-left">
                  {isPreview ? (isDeepFetching ? <Loader2 className="w-4 h-4 animate-spin inline" /> : <><Plus className="w-4 h-4 mr-1 inline-block" /> Add to Library</>) : `✓ ${getDynamicStatusLabel(storeItem.status, type, false)}`}
                </span>
                {!isPreview && <Edit3 className="w-4 h-4 shrink-0 opacity-60" />}
              </button>

              {/* Read-Only Progress & Rating */}
              {storeItem && (
                <div className={`flex ${type === 'tv' ? 'justify-between items-center bg-base-200/50 p-1.5 px-3 border border-base-300 mt-2 lg:mt-0' : 'justify-center items-center mt-3 lg:mt-0'}`}>
                   {type === 'tv' && (
                     <div className="flex flex-col">
                       <span className="text-[8px] font-mono text-base-content/50 uppercase">Progress</span>
                       <span className={`text-[9px] font-bold uppercase tracking-widest text-base-content`}>{storeItem.progress || 'Not Started'}</span>
                     </div>
                   )}
                   <div className={`flex flex-col ${type === 'tv' ? 'items-end' : 'items-center'}`}>
                     {type === 'tv' && <span className="text-[8px] font-mono text-base-content/50 uppercase mb-0.5">Rating</span>}
                     <div className={`${type === 'tv' ? 'scale-[0.65] origin-right' : 'scale-90'} -my-1.5`}>
                       <StarRating rating={storeItem.rating} readOnly />
                     </div>
                   </div>
                </div>
              )}
            </div>

          </div>
        </div>

        <div className={`flex-1 flex flex-col gap-4 lg:gap-5 min-w-0 w-full p-3 lg:p-5 ${bannerSrc ? 'bg-transparent' : 'bg-base-100'}`}>
          <div>
            <div className="flex flex-row items-start justify-between gap-3 w-full">
              <h1 className="text-3xl lg:text-4xl xl:text-5xl font-black uppercase tracking-tight font-sans leading-none flex items-baseline gap-2 flex-wrap">
                {titleText} <span className="text-xl lg:text-2xl xl:text-3xl font-medium text-base-content/60 tracking-normal">{apiData.year || raw.release_date?.substring(0,4) || raw.first_air_date?.substring(0,4) || raw.year_began || (raw.first_release_date ? new Date(raw.first_release_date * 1000).getFullYear() : '')}</span>
              </h1>
              <div className={`w-fit shrink-0 inline-flex items-center px-2 py-0.5 mt-1 text-[10px] font-mono font-bold tracking-[0.15em] uppercase border border-base-300 ${typeColors.bg} ${typeColors.textContent}`}>{getSubtype(type)}</div>
            </div>
            {isDeepFetching && !raw.deepFetched ? (
              <div className="flex flex-wrap items-center gap-4 border-b border-base-300 pb-3 mt-3"><div className="h-3 w-24 bg-base-300 animate-pulse"></div><div className="h-3 w-32 bg-base-300 animate-pulse"></div><div className="h-3 w-20 bg-base-300 animate-pulse"></div><div className="h-3 w-28 bg-base-300 animate-pulse"></div></div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] font-mono uppercase tracking-widest text-base-content/60 border-b border-base-300 pb-3 mt-3">
                <MetaItem label="Released" value={formatFancyDate(raw.release_date || (raw.first_release_date ? new Date(raw.first_release_date * 1000).toISOString().split('T')[0] : null))} />
                <MetaItem label="Aired" value={type === 'anime' && raw.startDate?.year ? formatFancyDate(`${raw.startDate.year}-${String(raw.startDate.month || 1).padStart(2, '0')}-${String(raw.startDate.day || 1).padStart(2, '0')}`) : null} />
                {type === 'books' && validBookAuthors.length > 0 && <MetaItem label="Author" value={validBookAuthors.join(', ')} />}
                {type === 'anime' && <MetaItem label="Studio" value={raw.studios?.nodes?.map(s => s.name).join(', ')} />}
                <MetaItem label="Runtime" value={raw.runtime > 0 ? `${raw.runtime}m` : null} />
                <MetaItem label="Length" value={type === 'vn' && raw.length > 0 ? vnLengthMap[raw.length] : null} />
                <MetaItem label="Seasons" value={type === 'tv' && raw.number_of_seasons} />
                <MetaItem label="Episodes" value={type === 'tv' ? raw.number_of_episodes : type === 'anime' ? raw.episodes : null} />
                <MetaItem label="Chapters" value={['manga', 'comics'].includes(type) && raw.chapters} />
                <MetaItem label="Volumes" value={type === 'manga' && raw.volumes} />
                <MetaItem label="Developer" value={getDevs()} />
                <MetaItem label="Publisher" value={getPubs() || raw.publisherName} />
                {type === 'comics' && comicFormat && <MetaItem label="Format" value={comicFormat} />}
                {type === 'comics' && <MetaItem label="Issues" value={raw.issuesCount} />}
                <MetaItem label="Status" value={type === 'comics' && raw.status?.toLowerCase() === 'cancelled' ? null : raw.status?.replace(/_/g, ' ')} />
                {type === 'comics' && genres?.length > 0 && (<MetaItem label="Genres" value={genres.map(g => typeof g === 'object' ? g.name : g).join(', ')} />)}
                {type === 'comics' && apiData?.url && (<span><span className="font-bold text-base-content">Source:</span>{' '}<a href={apiData.url} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors inline-flex items-center gap-1">Metron <ExternalLink className="w-3 h-3" /></a></span>)}
                {/* Check that rating actually has a value before trying to render stars to prevent undefined crashes */}
                {unifiedScore > 0 && <span className="flex items-center gap-1 text-warning ml-auto sm:ml-0 font-bold"><Star className="w-3 h-3 fill-warning" /> {type === 'anime' || type === 'manga' ? `${unifiedScore}%` : type === 'games' ? `${Math.round(unifiedScore)}/100` : Number(unifiedScore).toFixed(1)}</span>}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-widest">Description</span>
            {isDeepFetching && (!overviewText || overviewText.startsWith('First published in') || overviewText === 'No description available.') ? <TextBlockSkeleton /> : (
               <p className="text-sm leading-relaxed text-base-content/80 font-sans whitespace-pre-wrap">{overviewText?.startsWith('First published in') ? 'No descriptive data logged.' : (overviewText || 'No descriptive data logged.')}</p>
            )}
          </div>

          <CreativeTeamSection type={type} raw={raw} isDeepFetching={isDeepFetching} genres={genres} platforms={platforms} />
          <UserActivitySection logs={itemLogs} />

          {validRels.length > 0 && (
            <SectionWrapper>
              <div className="flex flex-col gap-3">
                <span className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-widest pb-0.5">Adaptations & Related Sources</span>
                <div className="flex flex-wrap gap-3">
                  {validRels.map(rel => {
                    const node = rel.node;
                    const navType = node.type?.toLowerCase() === 'anime' ? 'anime' : 'manga';
                    return (
                      <div key={node.id} onClick={() => navigate(`/media/${navType}/${node.id}`, { state: { previewData: { id: node.id, title: node.title?.english || node.title?.romaji || 'Unknown', type: navType, image: node.coverImage?.large || null, raw: {} } }})} className="flex items-center gap-3 bg-base-200 border border-base-300 p-2 pr-4 cursor-pointer hover:border-primary transition-colors">
                        <div className="w-10 h-14 bg-base-300 flex-shrink-0"><ImageWithFallback src={node.coverImage?.large} alt={node.title?.english || node.title?.romaji} className="w-full h-full object-cover" /></div>
                        <div className="flex flex-col"><span className="text-[9px] font-mono font-bold text-primary uppercase tracking-widest">{rel.relationType === 'ADAPTATION' ? 'Adaptation' : 'Source'}</span><span className="text-xs font-bold font-sans line-clamp-1">{node.title?.english || node.title?.romaji || 'Unknown'}</span></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </SectionWrapper>
          )}

          {type === 'comics' ? (
            <ComicIssuesSection seriesId={raw.id || id} storeItem={storeItem} isPreview={isPreview} rawIssues={raw.issue_details} totalIssuesCount={raw.issue_count || raw.issuesCount} readIssueIds={comicReadIssueIds} onToggleRead={(issueId, allIds) => { if (storeItem) toggleIssueRead(storeItem.id, type, issueId, allIds); }} />
          ) : (
            <GalleryAndLinks type={type} title={titleText} raw={raw} apiData={apiData} isDeepFetching={isDeepFetching} thumbnails={mediaAssets.thumbnails} originals={mediaAssets.originals} navigate={navigate} />
          )}

          {type === 'games' && seriesGames.length > 0 && (
            <SectionWrapper>
              <div className="flex flex-col gap-3">
                <span className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-widest pb-0.5">{collections[0]?.name || 'More in Series'}</span>
                {isDeepFetching && !displayedSeriesGames.length ? <PillSkeleton /> : (
                  <div className="flex flex-wrap gap-3">
                    {displayedSeriesGames.map(game => (
                      <div key={game.id} className="flex items-center gap-3 bg-base-200 border border-base-300 p-2 pr-4 cursor-pointer hover:border-primary transition-colors" onClick={() => navigate(`/media/games/igdb_${game.id}`, { state: { previewData: { id: `igdb_${game.id}`, title: game.name, type: 'games', image: game.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_thumb/${game.cover.image_id}.jpg` : null, raw: game } }})}>
                        <div className="w-8 h-12 bg-base-300 flex-shrink-0">{game.cover?.image_id ? <img src={`https://images.igdb.com/igdb/image/upload/t_thumb/${game.cover.image_id}.jpg`} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[6px] font-mono text-base-content/30 uppercase text-center">NO IMG</div>}</div>
                        <div className="flex flex-col"><span className="text-[9px] font-mono font-bold text-primary uppercase tracking-widest">{game.first_release_date ? new Date(game.first_release_date * 1000).getFullYear() : 'Series'}</span><span className="text-xs font-bold font-sans line-clamp-1">{game.name}</span></div>
                      </div>
                    ))}
                    {seriesGames.length > 10 && <button onClick={() => setShowAllSeries(!showAllSeries)} className="flex items-center justify-center gap-2 h-11 sm:h-8 bg-base-200 border border-base-300 px-4 cursor-pointer hover:border-primary hover:text-primary transition-colors text-[10px] font-mono font-bold uppercase tracking-widest text-base-content/70 rounded-none appearance-none">{showAllSeries ? 'Show Less' : `+${seriesGames.length - 10} More`}</button>}
                  </div>
                )}
              </div>
            </SectionWrapper>
          )}

          {type === 'tv' && (raw.number_of_seasons > 0 || apiData.raw?.number_of_seasons > 0) && (
            <SectionWrapper>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <button onClick={() => setShowEpisodes(!showEpisodes)} className="flex items-center gap-2 hover:text-primary transition-colors text-lg font-black uppercase tracking-widest font-sans focus:outline-none">
                    Episodes {showEpisodes ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </button>
                  {showEpisodes && (
                    <select value={season} onChange={(e) => { setSeason(e.target.value); fetchSeason(raw.id || apiData.id, e.target.value); }} className="w-full sm:w-auto h-11 sm:h-8 px-2 bg-base-100 border border-base-300 hover:border-primary focus:outline-none focus:border-primary text-base sm:text-xs font-mono font-bold uppercase tracking-widest rounded-none appearance-none cursor-pointer transition-colors">
                      {Array.from({ length: raw.number_of_seasons || apiData.raw?.number_of_seasons }, (_, i) => <option key={i+1} value={i+1}>Season 0{i+1}</option>)}
                    </select>
                  )}
                </div>
                {showEpisodes && (
                  loadingEps ? <div className="text-center py-10 font-mono text-xs uppercase text-base-content/50 animate-pulse">Loading episodes...</div> : (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar pb-2 mt-2">
                    {episodes.map(ep => {
                      const match = storeItem?.progress?.match(/S(\d+)\s*E(\d+)/i);
                      const currentS = match ? parseInt(match[1]) : 0;
                      const currentE = match ? parseInt(match[2]) : 0;
                      const viewSeason = parseInt(season);
                      const isWatched = viewSeason < currentS || (viewSeason === currentS && ep.episode_number <= currentE);
                      const isNext = (viewSeason === currentS && ep.episode_number === currentE + 1) || (viewSeason === currentS + 1 && currentE >= (raw.seasons?.find(s => s.season_number === currentS)?.episode_count || 999) && ep.episode_number === 1);
                      
                      return <EpisodeCard key={ep.id} episode={ep} isWatched={!isPreview && isWatched} isNext={!isPreview && isNext} />;
                    })}
                  </div>
                ))}
              </div>
            </SectionWrapper>
          )}

          {(loadingRecs || recs.length > 0) && (
            <SectionWrapper>
              <div className="flex flex-col gap-3">
                <h3 className="text-lg font-black uppercase tracking-widest font-sans">{type === 'games' ? 'Suggested' : 'Recommended'}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 gap-3" style={{ gridAutoRows: 'min-content' }}>
                  {loadingRecs ? Array.from({ length: 5 }).map((_, idx) => <div key={idx} className="aspect-[2/3] w-full bg-base-300 animate-pulse border border-base-300"></div>) : (
                    recs.map(rec => (
                      <div key={rec.id} onClick={() => navigate(`/media/${type}/${rec.id}`, { state: { previewData: rec } })} className="border border-base-300 bg-base-100 hover:border-primary transition-colors flex flex-col group cursor-pointer h-full">
                        <figure className="aspect-[2/3] w-full bg-base-200 overflow-hidden relative shrink-0"><ImageWithFallback src={rec.image} alt={rec.title} className="grayscale-[20%] group-hover:grayscale-0 w-full h-full object-cover" /></figure>
                        <div className="p-2 flex-grow bg-base-200/30"><h4 className="text-[10px] font-bold uppercase tracking-wide line-clamp-2" title={rec.title}>{rec.title}</h4></div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </SectionWrapper>
          )}
        </div>
      </div>

      {showTrailer && trailerUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 lg:p-10 animate-in fade-in duration-300">
          <div className="w-full max-w-5xl aspect-video bg-black border border-base-content/20 shadow-2xl relative flex flex-col">
            <button onClick={() => setShowTrailer(false)} className="absolute -top-10 right-0 flex items-center justify-center h-11 w-11 sm:h-8 sm:w-8 bg-transparent text-white hover:bg-white/20 rounded-none appearance-none transition-colors"><X className="w-5 h-5 sm:w-4 sm:h-4" /></button>
            <iframe src={trailerUrl} className="w-full h-full border-none" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
          </div>
        </div>
      )}

    </div>
  );
};