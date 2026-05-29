import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRegistry } from '../services/apiRegistry';
import { MediaCard, ComicIssueModal, formatMarkdownLinks } from '../components/UI';
import { useMediaStore } from '../store/useMediaStore';
import { ArrowLeft, Loader2, User, Clapperboard, Gamepad2, ChevronLeft, ChevronDown, ChevronRight, Tv, Image as ImageIcon, X, Eye } from 'lucide-react';

export const Explore = () => {
  const { api, type, id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const entityName = searchParams.get('name') || 'Unknown';
  const sourceParam = searchParams.get('source');

  const exploreCache = useMediaStore((state) => state.exploreCache) || {};
  const setExploreCache = useMediaStore((state) => state.setExploreCache);
  
  const entityCacheKey = `entity_${api}_${type}_${id}`;

  const [data, setData] = useState(() => exploreCache[entityCacheKey]?.data?.personData || null);
  const [entityData, setEntityData] = useState(() => exploreCache[entityCacheKey]?.data?.companyData || null);
  const [isLoading, setIsLoading] = useState(() => !exploreCache[entityCacheKey]);

  const [mediaFilter, setMediaFilter] = useState(() => {
    if (type === 'person' || type === 'creator' || type === 'staff') return 'all';
    if (type === 'network') return 'tv';
    if (api === 'igdb') return 'games';
    if (api === 'metron') return 'comics';
    if (api === 'vndb') return 'vn';
    if (api === 'anilist') {
      if (type === 'studio') return 'anime';
      return sourceParam === 'anime' || sourceParam === 'manga' ? sourceParam : 'anime';
    }
    if (sourceParam === 'movies' || sourceParam === 'tv') return sourceParam;
    return 'movies';
  });
  const [roleFilter, setRoleFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState(() => type === 'person' ? 'known_for' : 'popularity');

  const [bioExpanded, setBioExpanded] = useState(false);

  // Discover specific state
  const [page, setPage] = useState(1);
  
  const activeGridCacheKey = `grid_${api}_${type}_${id}_${mediaFilter}_${sortOrder}_${roleFilter}_1`;
  const [discoverResults, setDiscoverResults] = useState(() => exploreCache[activeGridCacheKey]?.data?.results || []);
  const [totalPages, setTotalPages] = useState(() => exploreCache[activeGridCacheKey]?.data?.totalPages || 1);
  const [isGridLoading, setIsGridLoading] = useState(() => type !== 'person' && !exploreCache[activeGridCacheKey]);
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  // Person specific pagination
  const ITEMS_PER_PAGE = 24;
  const [personPage, setPersonPage] = useState(1);

  // Modal specific state
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [selectedCreatorSeries, setSelectedCreatorSeries] = useState(null);
  const [modalDetails, setModalDetails] = useState(null);
  const [modalIssues, setModalIssues] = useState([]);
  const [isModalLoading, setIsModalLoading] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
    
    if (exploreCache[entityCacheKey]) {
      const pData = exploreCache[entityCacheKey].data.personData;
      setData(pData);
      setEntityData(exploreCache[entityCacheKey].data.companyData);
      setIsLoading(false);
      
      if (pData && type === 'person') {
        if (pData.known_for_department === 'Acting') setRoleFilter('cast');
        else setRoleFilter('crew');
      }
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setData(null);
    setEntityData(null);

    setSortOrder(prev => type === 'person' ? 'known_for' : (prev === 'known_for' ? 'popularity' : prev));

    if (api === 'tmdb') {
      if (type === 'person') {
      apiRegistry.getPersonDetails(id).then(res => {
        if (isMounted) {
          setData(res);
          setExploreCache(entityCacheKey, { personData: res, companyData: null });
          if (res?.known_for_department === 'Acting') setRoleFilter('cast');
          else setRoleFilter('crew');
          setIsLoading(false);
        }
      });
      } else if (type === 'studio' || type === 'company') {
        apiRegistry.getCompanyDetails(id).then(res => { if (isMounted) { setEntityData(res); setExploreCache(entityCacheKey, { personData: null, companyData: res }); setIsLoading(false); } });
      } else if (type === 'network') {
        apiRegistry.getNetworkDetails(id).then(res => { if (isMounted) { setEntityData(res); setExploreCache(entityCacheKey, { personData: null, companyData: res }); setIsLoading(false); } });
      } else {
        setIsLoading(false);
      }
    } else if (api === 'igdb') {
      if (type === 'company') {
        apiRegistry.getIGDBCompanyDetails(id).then(res => { if (isMounted) { setEntityData(res); setExploreCache(entityCacheKey, { personData: null, companyData: res }); setIsLoading(false); } });
      } else {
        setIsLoading(false);
      }
    } else if (api === 'anilist') {
      if (type === 'person') {
        apiRegistry.getAniListPersonDetails(id).then(res => {
          if (isMounted) { setData(res); setExploreCache(entityCacheKey, { personData: res, companyData: null }); setRoleFilter('all'); setIsLoading(false); }
        });
      } else {
        setIsLoading(false);
      }
    } else if (api === 'metron') {
      if (type === 'creator') {
        apiRegistry.getMetronCreatorDetails(id).then(res => {
          if (isMounted) {
            const creatorData = { name: res?.name, profile_path_custom: res?.image, biography: res?.desc, known_for_department: 'Comic Creator' };
            setData(creatorData);
            setExploreCache(entityCacheKey, { personData: creatorData, companyData: null });
            setIsLoading(false);
          }
        });
      } else if (type === 'publisher') {
        apiRegistry.getMetronPublisherDetails(id).then(res => {
          if (isMounted) {
            const pubData = { 
              name: res?.name, 
              profile_path_custom: res?.image, 
              biography: res?.desc, 
              known_for_department: 'Comic Publisher',
              birthday: res?.founded ? new Date(res.founded, 0, 1).getFullYear().toString() : null
            };
            setData(pubData);
            setExploreCache(entityCacheKey, { personData: pubData, companyData: null });
            setIsLoading(false);
          }
        });
      } else {
        setIsLoading(false);
      }
    } else if (api === 'vndb') {
      if (type === 'developer') {
        apiRegistry.getVNDBDeveloperDetails(id).then(res => {
          if (isMounted) {
            const devData = {
              name: res?.original ? `${res.name} (${res.original})` : res?.name,
              description: res?.description
            };
            setEntityData(devData);
            setExploreCache(entityCacheKey, { personData: null, companyData: devData });
            setIsLoading(false);
          }
        });
      } else if (type === 'staff') {
        apiRegistry.getVNDBStaffDetails(id).then(res => {
          if (isMounted) {
            const staffData = {
              name: res?.original ? `${res.name} (${res.original})` : res?.name,
              biography: res?.description,
              known_for_department: 'Visual Novel Staff',
              extlinks: res?.extlinks || []
            };
            setData(staffData);
            setExploreCache(entityCacheKey, { personData: staffData, companyData: null });
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
    
    const gridKey = `grid_${api}_${type}_${id}_${mediaFilter}_${sortOrder}_${roleFilter}_1`;
    if (exploreCache[gridKey]) {
      setDiscoverResults(exploreCache[gridKey].data.results);
      setTotalPages(exploreCache[gridKey].data.totalPages);
      setIsGridLoading(false);
      setPage(1);
      return;
    }

    let isMounted = true;
    setIsGridLoading(true);
    setPage(1);
    setDiscoverResults([]);
    
    if (api === 'tmdb' && ['genre', 'studio', 'network'].includes(type)) {
      apiRegistry.discoverTMDB(type, id, mediaFilter, 1, sortOrder).then(res => {
        if (isMounted) {
          setDiscoverResults(res.results);
          setTotalPages(res.totalPages);
          setExploreCache(gridKey, { results: res.results, totalPages: res.totalPages });
          setIsGridLoading(false);
        }
      });
    } else if (api === 'igdb') {
      apiRegistry.discoverIGDB(type, id, 1, sortOrder).then(res => {
        if (isMounted) {
          setDiscoverResults(res.results);
          setTotalPages(res.totalPages);
          setExploreCache(gridKey, { results: res.results, totalPages: res.totalPages });
          setIsGridLoading(false);
        }
      });
    } else if (api === 'anilist') {
      apiRegistry.discoverAniList(type, id, mediaFilter, 1, sortOrder).then(res => {
        if (isMounted) {
          setDiscoverResults(res.results);
          setTotalPages(res.totalPages);
          setExploreCache(gridKey, { results: res.results, totalPages: res.totalPages });
          setIsGridLoading(false);
        }
      });
    } else if (api === 'metron') {
      apiRegistry.discoverMetron(type, id, 1).then(res => {
        if (isMounted) {
          setDiscoverResults(res.results);
          setTotalPages(res.totalPages);
          setExploreCache(gridKey, { results: res.results, totalPages: res.totalPages });
          setIsGridLoading(false);
        }
      });
    } else if (api === 'vndb') {
      apiRegistry.discoverVNDB(type, id, 1, sortOrder, roleFilter).then(res => {
        if (isMounted) {
          setDiscoverResults(res.results);
          setTotalPages(res.totalPages);
          setExploreCache(gridKey, { results: res.results, totalPages: res.totalPages });
          setIsGridLoading(false);
        }
      });
    } else {
      setIsGridLoading(false);
    }
    return () => { isMounted = false; };
  }, [api, type, id, mediaFilter, sortOrder, roleFilter]);

  const handleDiscoverPageChange = async (newPage) => {
    if (isFetchingMore || newPage < 1 || newPage > totalPages) return;
    setIsFetchingMore(true);
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const newGridCacheKey = `grid_${api}_${type}_${id}_${mediaFilter}_${sortOrder}_${roleFilter}_${newPage}`;
    if (exploreCache[newGridCacheKey]) {
      setDiscoverResults(exploreCache[newGridCacheKey].data.results);
      setTotalPages(exploreCache[newGridCacheKey].data.totalPages);
      setIsFetchingMore(false);
      return;
    }

    if (api === 'tmdb') {
      const res = await apiRegistry.discoverTMDB(type, id, mediaFilter, newPage, sortOrder);
      setDiscoverResults(res.results);
      setTotalPages(res.totalPages);
      setExploreCache(newGridCacheKey, { results: res.results, totalPages: res.totalPages });
    } else if (api === 'igdb') {
      const res = await apiRegistry.discoverIGDB(type, id, newPage, sortOrder);
      setDiscoverResults(res.results);
      setTotalPages(res.totalPages);
      setExploreCache(newGridCacheKey, { results: res.results, totalPages: res.totalPages });
    } else if (api === 'anilist') {
      const res = await apiRegistry.discoverAniList(type, id, mediaFilter, newPage, sortOrder);
      setDiscoverResults(res.results);
      setTotalPages(res.totalPages);
      setExploreCache(newGridCacheKey, { results: res.results, totalPages: res.totalPages });
    } else if (api === 'metron') {
      const res = await apiRegistry.discoverMetron(type, id, newPage);
      setDiscoverResults(res.results);
      setTotalPages(res.totalPages);
      setExploreCache(newGridCacheKey, { results: res.results, totalPages: res.totalPages });
    } else if (api === 'vndb') {
      const res = await apiRegistry.discoverVNDB(type, id, newPage, sortOrder, roleFilter);
      setDiscoverResults(res.results);
      setTotalPages(res.totalPages);
      setExploreCache(newGridCacheKey, { results: res.results, totalPages: res.totalPages });
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
            voteCount: c.vote_count || c.popularity || 0,
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
      if (sortOrder === 'known_for') return b.voteCount - a.voteCount;
      if (sortOrder === 'popularity') return b.popularity - a.popularity;
      if (sortOrder === 'rating') return b._apiRating - a._apiRating;
      if (sortOrder === 'new') return b.rawDate.localeCompare(a.rawDate);
      if (sortOrder === 'old') return a.rawDate.localeCompare(b.rawDate);
      return 0;
    });

    return res;
  }, [credits, mediaFilter, roleFilter, sortOrder]);

  const handleComicCardClick = async (item) => {
    let targetId = item.id;
    if (api === 'metron' && type === 'publisher' && typeof targetId === 'string' && targetId.startsWith('issue_')) {
      setIsGridLoading(true);
      try {
        const issueId = targetId.replace('issue_', '');
        const issueData = await apiRegistry.getComicIssueDetails(issueId);
        if (issueData?.series?.id) {
          targetId = `series_${issueData.series.id}`;
          item.id = targetId;
          item.title = issueData.series.name || item.title;
        }
      } catch (e) { console.error(e); }
      setIsGridLoading(false);
    }
    navigate(`/media/comics/${targetId}`, { state: { previewData: item } });
  };

  const handleComicCardHover = (item) => {
    if (api === 'metron' && type === 'publisher' && typeof item.id === 'string' && item.id.startsWith('issue_')) {
      const issueId = item.id.replace('issue_', '');
      apiRegistry.getComicIssueDetails(issueId).catch(() => {});
    }
  };

  const handleModalNavigate = async (issue) => {
    setSelectedIssue(issue);
    setIsModalLoading(true);
    try {
      const details = await apiRegistry.getComicIssueDetails(issue.id);
      setModalDetails(details);
    } catch (e) {
      console.error(e);
    }
    setIsModalLoading(false);
  };

  useEffect(() => { setPersonPage(1); }, [mediaFilter, roleFilter, sortOrder]);
  const totalPersonPages = Math.ceil(filteredCredits.length / ITEMS_PER_PAGE) || 1;
  const paginatedCredits = filteredCredits.slice((personPage - 1) * ITEMS_PER_PAGE, personPage * ITEMS_PER_PAGE);

  const enrichedDiscoverResults = useMemo(() => {
    return discoverResults.map(item => {
      const { apiRating, ...rest } = item;
      
      let roleLabel = rest.roleLabel;
      if (api === 'vndb' && type === 'staff' && item.raw?.staff) {
        const roles = item.raw.staff
          .filter(s => String(s.id) === String(id))
          .map(s => {
            const r = String(s.role || '').toLowerCase();
            if (r === 'art') return 'Art';
            if (r === 'chardesign') return 'Character Design';
            if (r === 'scenario') return 'Scenario';
            if (r === 'director') return 'Director';
            if (r === 'music') return 'Music';
            if (r === 'songs') return 'Songs';
            return s.role ? s.role.charAt(0).toUpperCase() + s.role.slice(1) : '';
          })
          .filter(Boolean);
        if (roles.length > 0) {
          roleLabel = Array.from(new Set(roles)).slice(0, 2).join(', ');
        }
      }

      return { 
        ...rest, 
        roleLabel,
        apiData: { ...rest.apiData, year: rest.year, raw: item.raw } 
      };
    });
  }, [discoverResults, api, type, id]);

  if (isLoading) return <div className="flex items-center justify-center min-h-[60vh] animate-in fade-in"><Loader2 className="w-8 h-8 animate-spin text-primary opacity-50" /></div>;
  if ((type === 'person' || type === 'creator' || type === 'publisher' || type === 'staff') && !data) return <div className="p-8 text-center font-mono uppercase tracking-widest text-xs opacity-50">Entity not found.</div>;

  const profileUrl = data?.profile_path ? `https://image.tmdb.org/t/p/h632${data.profile_path}` : data?.profile_path_custom || null;
  const isPersonLayout = type === 'person' || type === 'creator' || type === 'publisher' || type === 'staff';
  const isCompany = ['company', 'studio', 'network', 'developer'].includes(type);

  const renderItems = type === 'person' ? paginatedCredits : enrichedDiscoverResults;
  const currentPage = type === 'person' ? personPage : page;
  const maxPages = type === 'person' ? totalPersonPages : totalPages;

  const hasDescription = entityData?.description && entityData.description.trim() !== '';
  const logoUrl = entityData?.logo_path ? `https://image.tmdb.org/t/p/w500${entityData.logo_path}` : entityData?.logo?.image_id ? `https://images.igdb.com/igdb/image/upload/t_logo_med/${entityData.logo.image_id}.png` : api === 'metron' && entityData?.image ? entityData.image : null;

  const isLongBio = data?.biography?.length > 400;
  const isLongDesc = entityData?.description?.length > 400;

  const BgIcon = api === 'igdb' ? Gamepad2 : api === 'anilist' ? Tv : api === 'metron' ? ImageIcon : api === 'vndb' ? Eye : Clapperboard;

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-300 pb-10 min-h-screen text-base-content">

      {isPersonLayout ? (
        <div className="flex flex-row gap-4 sm:gap-6 bg-base-100 border border-base-300 p-4 sm:p-6 pt-12 sm:pt-14 shadow-xl items-start relative">
          <button onClick={() => navigate(-1)} className="absolute top-2 left-2 sm:top-4 sm:left-4 flex items-center justify-center h-8 px-2 sm:px-3 rounded-none appearance-none font-mono text-[10px] uppercase tracking-widest bg-transparent hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors z-20"><ArrowLeft className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Back</span></button>
          
          {!(api === 'vndb' && type === 'staff') && (
            <div className={`w-24 sm:w-32 md:w-48 shrink-0 relative shadow-sm ${type === 'publisher' ? 'bg-transparent border-none shadow-none' : 'bg-base-200 border border-base-300 overflow-hidden aspect-[2/3]'}`}>
              {profileUrl ? (
                <img src={profileUrl} alt={data?.name || entityName} className={`w-full ${type === 'publisher' ? 'h-auto object-contain' : 'h-full object-cover'}`} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-base-content/20">{type === 'publisher' ? <ImageIcon className="w-8 h-8 md:w-12 md:h-12" /> : <User className="w-8 h-8 md:w-12 md:h-12" />}</div>
              )}
            </div>
          )}
          
          <div className="flex flex-col flex-1 min-w-0 justify-center text-left">
            <div className="inline-flex items-center justify-start gap-2 mb-2 flex-wrap">
              <span className="text-[10px] font-mono font-bold tracking-[0.15em] uppercase bg-primary text-primary-content px-2 py-1">{data?.known_for_department}</span>
              {data?.birthday && <span className="text-[10px] font-mono opacity-60 tracking-widest">{data.birthday.substring(0,4)} {data.deathday ? `- ${data.deathday.substring(0,4)}` : '- Present'}</span>}
            </div>
            <h1 className={`text-2xl sm:text-3xl md:text-5xl font-black uppercase tracking-tight font-sans leading-none ${api === 'vndb' && type === 'staff' && data?.extlinks?.length > 0 ? 'mb-1 md:mb-2' : 'mb-2 md:mb-4'} text-primary`}>{data?.name || entityName}</h1>
            
            {api === 'vndb' && type === 'staff' && data?.extlinks?.length > 0 && (
              <div className="mb-3 md:mb-4 text-[10px] font-mono font-bold uppercase tracking-widest text-base-content/60 truncate w-full">
                {data.extlinks.map((link, idx) => (
                  <span key={idx}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/70 transition-colors">
                      {link.label}
                    </a>
                    {idx < data.extlinks.length - 1 && <span className="opacity-30 mx-2">|</span>}
                  </span>
                ))}
              </div>
            )}
            
            {data?.biography && (
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
          
          {logoUrl && (
            <div className="w-full shrink-0 flex items-center justify-center min-h-[80px] relative">
              <img src={logoUrl} alt={entityData?.name || entityName} className="max-h-28 sm:max-h-32 w-auto max-w-full object-contain drop-shadow-[0_0_12px_rgba(150,150,150,0.3)]" />
            </div>
          )}
          
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

          {isPersonLayout && api !== 'metron' && api !== 'vndb' && (
            <div className="relative shrink-0">
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="h-7 sm:h-8 pl-2 pr-6 bg-base-100 border border-base-300 focus:outline-none focus:border-primary text-[9px] sm:text-[10px] font-mono uppercase tracking-widest cursor-pointer appearance-none rounded-none transition-colors">
                <option value="all">All Roles</option>
                <option value="cast">{api === 'anilist' ? 'Voice / Cast' : 'Acting'}</option>
                <option value="crew">{api === 'anilist' ? 'Staff / Creator' : 'Production'}</option>
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none opacity-50" />
            </div>
          )}

          {isPersonLayout && api === 'vndb' && (
            <div className="relative shrink-0">
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="h-7 sm:h-8 pl-2 pr-6 bg-base-100 border border-base-300 focus:outline-none focus:border-primary text-[9px] sm:text-[10px] font-mono uppercase tracking-widest cursor-pointer appearance-none rounded-none transition-colors">
                <option value="all">All Roles</option>
                <option value="scenario">Scenario</option>
                <option value="director">Director</option>
                <option value="chardesign">Character Design</option>
                <option value="art">Art</option>
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none opacity-50" />
            </div>
          )}

          {api !== 'igdb' && api !== 'metron' && (
            <div className="relative shrink-0">
              <select value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="h-7 sm:h-8 pl-2 pr-6 bg-base-100 border border-base-300 focus:outline-none focus:border-primary text-[9px] sm:text-[10px] font-mono uppercase tracking-widest cursor-pointer appearance-none rounded-none transition-colors">
                {type === 'person' && <option value="known_for">Known For</option>}
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
            {renderItems.map((item, idx) => (
              <MediaCard 
                key={`${item.type}_${item.id}_${idx}`} 
                item={item} 
                onClickOverride={api === 'metron' && (type === 'creator' || type === 'publisher') ? (type === 'creator' ? () => setSelectedCreatorSeries(item) : handleComicCardClick) : undefined}
                onMouseEnterOverride={api === 'metron' && type === 'publisher' ? () => handleComicCardHover(item) : undefined}
              />
            ))}
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

      {selectedCreatorSeries && (
        <div className="fixed inset-0 z-[90000] bg-black/80 flex flex-col items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setSelectedCreatorSeries(null)}>
          <div className="bg-base-100 border border-base-300 w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 sm:p-6 border-b border-base-300 bg-base-200/50">
               <div className="min-w-0 pr-4">
                 <h3 className="text-xl sm:text-2xl font-black uppercase tracking-widest text-primary truncate">{selectedCreatorSeries.title}</h3>
                 <p className="text-xs font-mono text-base-content/50 uppercase tracking-widest mt-1">Worked on {selectedCreatorSeries.raw.creator_issues?.length || 0} issues in this series</p>
               </div>
               <button onClick={() => setSelectedCreatorSeries(null)} className="btn btn-square btn-ghost rounded-none border border-base-300 hover:bg-error hover:text-error-content hover:border-error transition-colors shrink-0"><X className="w-5 h-5"/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar bg-base-100">
               <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                 {(selectedCreatorSeries.raw.creator_issues || []).sort((a,b) => parseFloat(a.number) - parseFloat(b.number)).map(issue => (
                     <div key={issue.id} onClick={() => {
                       setSelectedIssue(issue);
                       setIsModalLoading(true);
                       setModalIssues(selectedCreatorSeries.raw.creator_issues);
                       apiRegistry.getComicIssueDetails(issue.id).then(details => { setModalDetails(details); setIsModalLoading(false); });
                     }} className="cursor-pointer group border border-base-300 bg-base-200 hover:border-primary transition-colors flex flex-col h-full shadow-sm hover:shadow-md">
                       <div className="aspect-[2/3] w-full bg-base-300 overflow-hidden relative border-b border-base-300">
                         {issue.image ? <img src={`https://wsrv.nl/?url=${encodeURIComponent(issue.image)}&w=300&output=webp`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 grayscale-[15%] group-hover:grayscale-0" /> : <div className="w-full h-full flex items-center justify-center text-[10px] font-mono text-base-content/30 uppercase tracking-widest">No Img</div>}
                       </div>
                       <div className="p-3 text-center bg-base-100 flex-1 flex flex-col justify-center">
                         <span className="text-sm font-bold uppercase tracking-wider font-sans block truncate text-base-content group-hover:text-primary transition-colors">Issue #{issue.number}</span>
                         <span className="text-[9px] font-mono text-base-content/50 mt-1 uppercase tracking-widest block">{issue.cover_date ? issue.cover_date.substring(0, 4) : 'Unknown Year'}</span>
                       </div>
                     </div>
                   )
                 )}
               </div>
            </div>
          </div>
        </div>
      )}

      {api === 'metron' && type === 'creator' && (
        <ComicIssueModal 
          isOpen={!!selectedIssue} 
          issue={selectedIssue} 
          details={modalDetails} 
          isLoading={isModalLoading}
          isRead={false} 
          isPreview={true}
          onToggleRead={() => {}} 
          allIssues={modalIssues}
          onClose={() => { setSelectedIssue(null); setModalDetails(null); }}
          onNavigatePrev={() => {
             const idx = modalIssues.findIndex(i => i.id === selectedIssue?.id);
             if (idx > 0) handleModalNavigate(modalIssues[idx - 1]);
          }}
          onNavigateNext={() => {
             const idx = modalIssues.findIndex(i => i.id === selectedIssue?.id);
             if (idx !== -1 && idx < modalIssues.length - 1) handleModalNavigate(modalIssues[idx + 1]);
          }}
          hasPrev={modalIssues.findIndex(i => i.id === selectedIssue?.id) > 0}
          hasNext={modalIssues.findIndex(i => i.id === selectedIssue?.id) < modalIssues.length - 1}
        />
      )}
    </div>
  );
};