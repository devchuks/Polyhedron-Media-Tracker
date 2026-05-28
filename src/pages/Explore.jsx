import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRegistry } from '../services/apiRegistry';
import { MediaCard } from '../components/UI';
import { ArrowLeft, Loader2, User, Clapperboard, Gamepad2, ChevronLeft, ChevronDown, ChevronRight, Tv, Image as ImageIcon } from 'lucide-react';

export const Explore = () => {
  const { api, type, id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const entityName = searchParams.get('name') || 'Unknown';
  const sourceParam = searchParams.get('source');

  const [data, setData] = useState(null);
  const [entityData, setEntityData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGridLoading, setIsGridLoading] = useState(false);

  const [mediaFilter, setMediaFilter] = useState(() => {
    if (type === 'person' || type === 'creator') return 'all';
    if (type === 'network') return 'tv';
    if (api === 'igdb') return 'games';
    if (api === 'metron') return 'comics';
    if (api === 'anilist') {
      if (type === 'studio') return 'anime';
      return sourceParam === 'anime' || sourceParam === 'manga' ? sourceParam : 'anime';
    }
    if (sourceParam === 'movies' || sourceParam === 'tv') return sourceParam;
    return 'movies';
  });
  const [roleFilter, setRoleFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('popularity');

  const [bioExpanded, setBioExpanded] = useState(false);

  // Discover specific state
  const [discoverResults, setDiscoverResults] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  // Person specific pagination
  const ITEMS_PER_PAGE = 24;
  const [personPage, setPersonPage] = useState(1);

  useEffect(() => {
    window.scrollTo(0, 0);
    let isMounted = true;
    setIsLoading(true);
    setData(null);
    setEntityData(null);
    setDiscoverResults([]);

    if (api === 'tmdb') {
      if (type === 'person') {
      apiRegistry.getPersonDetails(id).then(res => {
        if (isMounted) {
          setData(res);
          if (res?.known_for_department === 'Acting') setRoleFilter('cast');
          else setRoleFilter('crew');
          setIsLoading(false);
        }
      });
      } else if (type === 'studio' || type === 'company') {
        apiRegistry.getCompanyDetails(id).then(res => { if (isMounted) { setEntityData(res); setIsLoading(false); } });
      } else if (type === 'network') {
        apiRegistry.getNetworkDetails(id).then(res => { if (isMounted) { setEntityData(res); setIsLoading(false); } });
      } else {
        setIsLoading(false);
      }
    } else if (api === 'igdb') {
      if (type === 'company') {
        apiRegistry.getIGDBCompanyDetails(id).then(res => { if (isMounted) { setEntityData(res); setIsLoading(false); } });
      } else {
        setIsLoading(false);
      }
    } else if (api === 'anilist') {
      if (type === 'person') {
        apiRegistry.getAniListPersonDetails(id).then(res => {
          if (isMounted) { setData(res); setRoleFilter('all'); setIsLoading(false); }
        });
      } else {
        setIsLoading(false);
      }
    } else if (api === 'metron') {
      if (type === 'creator') {
        apiRegistry.getMetronCreatorDetails(id).then(res => {
          if (isMounted) {
            setData({ name: res?.name, profile_path_custom: res?.image, biography: res?.desc, known_for_department: 'Comic Creator' });
            setIsLoading(false);
          }
        });
      } else if (type === 'publisher') {
        apiRegistry.getMetronPublisherDetails(id).then(res => {
          if (isMounted) {
            setData({ 
              name: res?.name, 
              profile_path_custom: res?.image, 
              biography: res?.desc, 
              known_for_department: 'Comic Publisher',
              birthday: res?.founded ? new Date(res.founded, 0, 1).getFullYear().toString() : null
            });
            setIsLoading(false);
          }
        });
      } else {
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
    return () => { isMounted = false; };
  }, [api, type, id]);

  useEffect(() => {
    if (type === 'person') return;
    
    let isMounted = true;
    setIsGridLoading(true);
    setPage(1);
    
    if (api === 'tmdb' && ['genre', 'studio', 'network'].includes(type)) {
      apiRegistry.discoverTMDB(type, id, mediaFilter, 1, sortOrder).then(res => {
        if (isMounted) {
          setDiscoverResults(res.results);
          setTotalPages(res.totalPages);
          setIsGridLoading(false);
        }
      });
    } else if (api === 'igdb') {
      apiRegistry.discoverIGDB(type, id, 1, sortOrder).then(res => {
        if (isMounted) {
          setDiscoverResults(res.results);
          setTotalPages(res.totalPages);
          setIsGridLoading(false);
        }
      });
    } else if (api === 'anilist') {
      apiRegistry.discoverAniList(type, id, mediaFilter, 1, sortOrder).then(res => {
        if (isMounted) {
          setDiscoverResults(res.results);
          setTotalPages(res.totalPages);
          setIsGridLoading(false);
        }
      });
    } else if (api === 'metron') {
      apiRegistry.discoverMetron(type, id, 1).then(res => {
        if (isMounted) {
          setDiscoverResults(res.results);
          setTotalPages(res.totalPages);
          setIsGridLoading(false);
        }
      });
    } else {
      setIsGridLoading(false);
    }
    return () => { isMounted = false; };
  }, [api, type, id, mediaFilter, sortOrder]);

  const handleDiscoverPageChange = async (newPage) => {
    if (isFetchingMore || newPage < 1 || newPage > totalPages) return;
    setIsFetchingMore(true);
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (api === 'tmdb') {
      const res = await apiRegistry.discoverTMDB(type, id, mediaFilter, newPage, sortOrder);
      setDiscoverResults(res.results);
      setTotalPages(res.totalPages);
    } else if (api === 'igdb') {
      const res = await apiRegistry.discoverIGDB(type, id, newPage, sortOrder);
      setDiscoverResults(res.results);
      setTotalPages(res.totalPages);
    } else if (api === 'anilist') {
      const res = await apiRegistry.discoverAniList(type, id, mediaFilter, newPage, sortOrder);
      setDiscoverResults(res.results);
      setTotalPages(res.totalPages);
    } else if (api === 'metron') {
      const res = await apiRegistry.discoverMetron(type, id, newPage);
      setDiscoverResults(res.results);
      setTotalPages(res.totalPages);
    }
    setIsFetchingMore(false);
  };

  const credits = useMemo(() => {
    if (!data || !data.combined_credits) return [];
    const cast = data.combined_credits.cast || [];
    const crew = data.combined_credits.crew || [];

    const map = new Map();

    const processList = (list, department) => {
      list.forEach(c => {
        const uid = `${c.media_type}_${c.id}`;
        if (!map.has(uid)) {
          const yearStr = (c.release_date || c.first_air_date || 'TBA').substring(0, 4);
          map.set(uid, {
            id: c.id,
            title: c.title || c.name,
            type: c.custom_type || (c.media_type === 'movie' ? 'movies' : 'tv'),
            subtype: c.custom_subtype || (c.media_type === 'movie' ? 'Movies' : 'TV Shows'),
            image: c.poster_path_custom || (c.poster_path ? `https://image.tmdb.org/t/p/w342${c.poster_path}` : null),
            year: yearStr,
            rawDate: c.release_date || c.first_air_date || '9999-12-31',
            _apiRating: c.vote_average ? parseFloat(c.vote_average).toFixed(1) : 0,
            popularity: c.popularity || 0,
            isCast: false,
            isCrew: false,
            jobs: [],
            apiData: { raw: c, year: yearStr }
          });
        }
        const item = map.get(uid);
        if (department === 'cast') { item.isCast = true; if(c.character) item.jobs.push(c.character); }
        if (department === 'crew') { item.isCrew = true; if(c.job) item.jobs.push(c.job); }
      });
    };

    processList(cast, 'cast');
    processList(crew, 'crew');

    return Array.from(map.values()).map(item => {
      const uniqueJobs = Array.from(new Set(item.jobs));
      return { ...item, roleLabel: uniqueJobs.slice(0, 2).join(', ') };
    });
  }, [data]);

  const filteredCredits = useMemo(() => {
    let res = credits;
    if (mediaFilter !== 'all') res = res.filter(c => c.type === mediaFilter);
    if (roleFilter === 'cast') res = res.filter(c => c.isCast);
    if (roleFilter === 'crew') res = res.filter(c => c.isCrew);

    res.sort((a, b) => {
      if (sortOrder === 'popularity') return b.popularity - a.popularity;
      if (sortOrder === 'rating') return b._apiRating - a._apiRating;
      if (sortOrder === 'new') return b.rawDate.localeCompare(a.rawDate);
      if (sortOrder === 'old') return a.rawDate.localeCompare(b.rawDate);
      return 0;
    });

    return res;
  }, [credits, mediaFilter, roleFilter, sortOrder]);

  useEffect(() => { setPersonPage(1); }, [mediaFilter, roleFilter, sortOrder]);
  const totalPersonPages = Math.ceil(filteredCredits.length / ITEMS_PER_PAGE) || 1;
  const paginatedCredits = filteredCredits.slice((personPage - 1) * ITEMS_PER_PAGE, personPage * ITEMS_PER_PAGE);

  const enrichedDiscoverResults = useMemo(() => {
    return discoverResults.map(item => {
      const { apiRating, ...rest } = item;
      return { 
        ...rest, 
        apiData: { ...rest.apiData, year: rest.year } 
      };
    });
  }, [discoverResults]);

  if (isLoading) return <div className="flex items-center justify-center min-h-[60vh] animate-in fade-in"><Loader2 className="w-8 h-8 animate-spin text-primary opacity-50" /></div>;
  if ((type === 'person' || type === 'creator' || type === 'publisher') && !data) return <div className="p-8 text-center font-mono uppercase tracking-widest text-xs opacity-50">Entity not found.</div>;

  const profileUrl = data?.profile_path ? `https://image.tmdb.org/t/p/h632${data.profile_path}` : data?.profile_path_custom || null;
  const isPersonLayout = type === 'person' || type === 'creator' || type === 'publisher';
  const isCompany = ['company', 'studio', 'network'].includes(type);

  const renderItems = type === 'person' ? paginatedCredits : enrichedDiscoverResults;
  const currentPage = type === 'person' ? personPage : page;
  const maxPages = type === 'person' ? totalPersonPages : totalPages;

  const hasDescription = entityData?.description && entityData.description.trim() !== '';
  const logoUrl = entityData?.logo_path ? `https://image.tmdb.org/t/p/w500${entityData.logo_path}` : entityData?.logo?.image_id ? `https://images.igdb.com/igdb/image/upload/t_logo_med/${entityData.logo.image_id}.png` : api === 'metron' && entityData?.image ? entityData.image : null;

  const isLongBio = data?.biography && data.biography.length > 400;
  const isLongDesc = entityData?.description && entityData.description.length > 400;

  const formatMarkdownLinks = (text) => {
    if (!text) return '';
    return text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  };

  const BgIcon = api === 'igdb' ? Gamepad2 : api === 'anilist' ? Tv : api === 'metron' ? ImageIcon : Clapperboard;

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300 pb-10 min-h-screen text-base-content">

      {isPersonLayout ? (
        <div className="flex flex-row gap-4 sm:gap-6 bg-base-100 border border-base-300 p-4 sm:p-6 pt-12 sm:pt-14 shadow-xl items-start relative">
          <button onClick={() => navigate(-1)} className="absolute top-2 left-2 sm:top-4 sm:left-4 flex items-center justify-center h-8 px-2 sm:px-3 rounded-none appearance-none font-mono text-[10px] uppercase tracking-widest bg-transparent hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors z-20"><ArrowLeft className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Back</span></button>
          <div className="w-24 sm:w-32 md:w-48 shrink-0 bg-base-200 border border-base-300 overflow-hidden relative aspect-[2/3] shadow-sm">
            {profileUrl ? <img src={profileUrl} alt={data?.name || entityName} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-base-content/20"><User className="w-8 h-8 md:w-12 md:h-12" /></div>}
          </div>
          
          <div className="flex flex-col flex-1 min-w-0 justify-center text-left">
            <div className="inline-flex items-center justify-start gap-2 mb-2 flex-wrap">
              <span className="text-[10px] font-mono font-bold tracking-[0.15em] uppercase bg-primary text-primary-content px-2 py-1">{data?.known_for_department}</span>
              {data?.birthday && <span className="text-[10px] font-mono opacity-60 tracking-widest">{data.birthday.substring(0,4)} {data.deathday ? `- ${data.deathday.substring(0,4)}` : '- Present'}</span>}
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tight font-sans leading-none mb-2 md:mb-4 text-primary">{data?.name || entityName}</h1>
            
            {data.biography && (
              <div className="relative group mt-1 md:mt-2">
                <div 
                  className={`text-xs md:text-sm font-sans leading-relaxed text-base-content/80 whitespace-pre-wrap [&_a]:text-primary [&_a]:hover:text-primary/70 [&_a]:underline [&_a]:transition-colors max-w-none ${!bioExpanded && isLongBio ? 'line-clamp-4 md:line-clamp-6' : ''}`} 
                  dangerouslySetInnerHTML={{ __html: formatMarkdownLinks(data.biography) }} 
                />
                {isLongBio && <button onClick={() => setBioExpanded(!bioExpanded)} className="text-[10px] font-mono font-bold uppercase tracking-widest text-primary hover:text-primary/70 mt-2">{bioExpanded ? 'Read Less' : 'Read Full Biography'}</button>}
              </div>
            )}
          </div>
        </div>
      ) : isCompany && hasDescription ? (
        <div className="flex flex-col gap-4 sm:gap-6 bg-base-100 border border-base-300 p-4 sm:p-6 pt-12 sm:pt-14 shadow-xl items-start relative overflow-hidden">
          <div className="absolute -right-10 -bottom-10 opacity-10 pointer-events-none"><BgIcon className="w-64 h-64" /></div>
          <button onClick={() => navigate(-1)} className="absolute top-2 left-2 sm:top-4 sm:left-4 flex items-center justify-center h-8 px-2 sm:px-3 rounded-none appearance-none font-mono text-[10px] uppercase tracking-widest bg-transparent hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors z-20"><ArrowLeft className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Back</span></button>
          
          <div className="w-full shrink-0 flex items-center justify-center min-h-[80px] relative">
            {logoUrl ? <img src={logoUrl} alt={entityData?.name || entityName} className="max-h-28 sm:max-h-32 w-auto max-w-full object-contain drop-shadow-[0_0_12px_rgba(150,150,150,0.3)]" /> : <div className="text-xs font-mono font-bold opacity-50 uppercase text-center p-4">{entityData?.name || entityName}</div>}
          </div>
          
          <div className="flex flex-col flex-1 min-w-0 justify-center text-left w-full mt-2 relative z-10">
            {!logoUrl && <h1 className="text-2xl sm:text-3xl md:text-4xl font-black uppercase tracking-tight font-sans leading-none mb-1 text-primary">{entityData?.name || entityName}</h1>}
            {entityData?.start_date && <span className="text-[10px] font-mono opacity-60 tracking-widest uppercase mb-2">Founded: {new Date(entityData.start_date * 1000).getFullYear()}</span>}
            
            <div className="relative group mt-1">
              <div 
                className={`text-xs md:text-sm font-sans leading-relaxed text-base-content/80 whitespace-pre-wrap [&_a]:text-primary [&_a]:hover:text-primary/70 [&_a]:underline [&_a]:transition-colors max-w-none ${!bioExpanded && isLongDesc ? 'line-clamp-4 md:line-clamp-6' : ''}`} 
                dangerouslySetInnerHTML={{ __html: formatMarkdownLinks(entityData.description) }} 
              />
              {isLongDesc && <button onClick={() => setBioExpanded(!bioExpanded)} className="text-[10px] font-mono font-bold uppercase tracking-widest text-primary hover:text-primary/70 mt-2">{bioExpanded ? 'Read Less' : 'Read Full Description'}</button>}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col bg-base-100 border border-base-300 p-6 pt-12 sm:pt-14 shadow-xl relative overflow-hidden items-center justify-center min-h-[160px]">
          <button onClick={() => navigate(-1)} className="absolute top-2 left-2 sm:top-4 sm:left-4 flex items-center justify-center h-8 px-2 sm:px-3 rounded-none appearance-none font-mono text-[10px] uppercase tracking-widest bg-transparent hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors z-20"><ArrowLeft className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Back</span></button>
          <div className="absolute -right-10 -bottom-10 opacity-10 pointer-events-none"><BgIcon className="w-64 h-64" /></div>
          
          <div className="flex flex-col items-center justify-center relative z-10 mb-2 gap-4">
            {logoUrl ? (
              <img src={logoUrl} alt={entityName} className="max-h-16 max-w-[200px] sm:max-h-20 sm:max-w-[300px] object-contain drop-shadow-[0_0_12px_rgba(150,150,150,0.3)]" />
            ) : (
              <h1 className="text-3xl md:text-4xl font-black uppercase tracking-tight font-sans leading-none text-primary text-center">{entityData?.name || entityName}</h1>
            )}
          </div>
          <p className="text-[10px] font-mono opacity-50 uppercase tracking-widest relative z-10 text-center mt-2">{type === 'genre' ? 'Genre' : type === 'studio' ? 'Production Studio' : 'Television Network'} Explorer</p>
        </div>
      )}

      <div className="flex flex-row items-center justify-between gap-2 sm:gap-3 border-b border-base-300 pb-4">
        <h2 className="text-sm sm:text-lg font-black uppercase tracking-widest font-sans flex items-center gap-1 sm:gap-2 shrink-0">
          {isPersonLayout ? (type === 'publisher' ? 'Published Series' : api === 'tmdb' ? 'Filmography' : 'Credits') : 'Library'} 
          <span className="text-[9px] sm:text-xs font-mono opacity-50">({type === 'person' ? filteredCredits.length : `Page ${currentPage}`})</span>
        </h2>
        
        <div className="flex flex-row items-center justify-end gap-1.5 sm:gap-2 overflow-x-auto custom-scrollbar pb-1 min-w-0">
          {api === 'tmdb' && (
            <div className="relative shrink-0">
              <select value={mediaFilter} onChange={e => setMediaFilter(e.target.value)} className="h-7 sm:h-8 pl-2 pr-6 bg-base-100 border border-base-300 focus:outline-none focus:border-primary text-[9px] sm:text-[10px] font-mono uppercase tracking-widest cursor-pointer appearance-none rounded-none transition-colors">
                {type === 'person' && <option value="all">All Media</option>}
                {type !== 'network' && <option value="movies">Movies</option>}
                <option value="tv">TV Shows</option>
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none opacity-50" />
            </div>
          )}
          {api === 'anilist' && (
            <div className="relative shrink-0">
              <select value={mediaFilter} onChange={e => setMediaFilter(e.target.value)} className="h-7 sm:h-8 pl-2 pr-6 bg-base-100 border border-base-300 focus:outline-none focus:border-primary text-[9px] sm:text-[10px] font-mono uppercase tracking-widest cursor-pointer appearance-none rounded-none transition-colors">
                {type === 'person' && <option value="all">All Media</option>}
                <option value="anime">Anime</option>
                {type !== 'studio' && <option value="manga">Manga</option>}
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none opacity-50" />
            </div>
          )}

          {isPersonLayout && api !== 'metron' && (
            <div className="relative shrink-0">
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="h-7 sm:h-8 pl-2 pr-6 bg-base-100 border border-base-300 focus:outline-none focus:border-primary text-[9px] sm:text-[10px] font-mono uppercase tracking-widest cursor-pointer appearance-none rounded-none transition-colors">
                <option value="all">All Roles</option>
                <option value="cast">{api === 'anilist' ? 'Voice / Cast' : 'Acting'}</option>
                <option value="crew">{api === 'anilist' ? 'Staff / Creator' : 'Production'}</option>
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none opacity-50" />
            </div>
          )}

          {api !== 'igdb' && api !== 'metron' && (
            <div className="relative shrink-0">
              <select value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="h-7 sm:h-8 pl-2 pr-6 bg-base-100 border border-base-300 focus:outline-none focus:border-primary text-[9px] sm:text-[10px] font-mono uppercase tracking-widest cursor-pointer appearance-none rounded-none transition-colors">
                <option value="popularity">Most Popular</option>
                <option value="rating">Highest Rated</option>
                <option value="new">Newest First</option>
                <option value="old">Oldest First</option>
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none opacity-50" />
            </div>
          )}
        </div>
      </div>

      {isGridLoading && renderItems.length === 0 ? (
        <div className="py-20 flex items-center justify-center w-full animate-in fade-in">
          <Loader2 className="w-8 h-8 animate-spin text-primary opacity-50" />
        </div>
      ) : renderItems.length > 0 ? (
        <>
          <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7 min-[2000px]:grid-cols-8 gap-3 ${isGridLoading ? 'pointer-events-none' : ''}`} style={{ gridAutoRows: 'min-content' }}>
            {renderItems.map((item, idx) => <MediaCard key={`${item.type}_${item.id}_${idx}`} item={item} />)}
          </div>
          {maxPages > 1 && (
            <div className="flex justify-between items-center mt-6 pt-4 border-t border-base-300">
              <button disabled={currentPage === 1 || isFetchingMore} onClick={() => { if (type === 'person') { setPersonPage(p => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); } else { handleDiscoverPageChange(page - 1); } }} className="flex items-center justify-center h-8 px-3 bg-transparent hover:bg-base-300 text-base-content hover:text-base-content rounded-none appearance-none font-mono text-[10px] uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ChevronLeft className="w-4 h-4 mr-1" /> Prev</button>
              <span className="text-[10px] font-mono font-bold text-base-content/50 uppercase tracking-widest">Page {currentPage} of {maxPages}</span>
              <button disabled={currentPage === maxPages || isFetchingMore} onClick={() => { if (type === 'person') { setPersonPage(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); } else { handleDiscoverPageChange(page + 1); } }} className="flex items-center justify-center h-8 px-3 bg-transparent hover:bg-base-300 text-base-content hover:text-base-content rounded-none appearance-none font-mono text-[10px] uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed transition-colors">Next <ChevronRight className="w-4 h-4 ml-1" /></button>
            </div>
          )}
        </>
      ) : (
        <div className="w-full py-16 bg-base-200/50 border border-base-300 flex items-center justify-center text-[10px] font-mono text-base-content/40 uppercase tracking-widest">No credits found for these filters.</div>
      )}
    </div>
  );
};