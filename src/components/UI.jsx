import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Star, StarHalf, X, Loader2, ChevronLeft, ChevronRight, ChevronDown, Trash2, PlayCircle, CheckCircle, EyeOff, AlertCircle, Info, ExternalLink, Save, Edit3, Calendar, Plus } from 'lucide-react';
import { useMediaStore, useUIStore } from '../store/useMediaStore';
import { apiRegistry } from '../services/apiRegistry';

// --- Restored Helpers ---
export const formatFancyDate = (dateInput) => {
  if (!dateInput || dateInput === '----') return dateInput;
  if (typeof dateInput === 'string' && /^\d{4}$/.test(dateInput)) return dateInput;
  let d = new Date(dateInput);
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
     const parts = dateInput.split('-');
     d = new Date(parts[0], parts[1] - 1, parts[2]);
  }
  if (isNaN(d.getTime())) return dateInput;
  const day = d.getDate();
  const suffix = ["th", "st", "nd", "rd"][day % 10 > 3 ? 0 : (day % 100 - day % 10 != 10) * day % 10] || "th";
  return `${day}${suffix} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`;
};

export const getDynamicStatusLabel = (status, type, isMenu = false) => {
  const isList = status === 'planned';
  const listName = ['games', 'vn'].includes(type) ? 'Backlog' : ['manga', 'books', 'comics'].includes(type) ? 'Reading List' : 'Watchlist';
  const activeName = ['games', 'vn'].includes(type) ? 'Playing' : ['manga', 'books', 'comics'].includes(type) ? 'Reading' : 'Watching';
  const completeName = ['games', 'vn'].includes(type) ? 'Played' : ['manga', 'books', 'comics'].includes(type) ? 'Read' : type === 'movies' ? 'Watched' : 'Completed';
  if (isList) return isMenu ? `Add to ${listName}` : `In ${listName}`;
  if (status === 'in progress') return `Currently ${activeName}`;
  if (status === 'completed') return completeName;
  if (status === 'dropped') return 'Dropped';
  return status;
};

export const getRewatchTerm = (type) => ['games', 'vn'].includes(type) ? 'REPLAY' : ['manga', 'books', 'comics'].includes(type) ? 'REREAD' : 'REWATCH';
export const getStatusColor = (status) => ({ planned: 'text-info', 'in progress': 'text-warning', completed: 'text-success', dropped: 'text-error' }[status] || 'text-primary');
export const getSubtype = (type) => ({ tv: 'TV Shows', movies: 'Movies', games: 'Games', vn: 'Visual Novels', anime: 'Anime', manga: 'Manga', books: 'Books', comics: 'Comics' }[type] || 'Media');
export const getStatusColorCard = (status) => {
  const map = { planned: 'text-info', 'in progress': 'text-warning', completed: 'text-success', dropped: 'text-error' };
  return map[status?.toLowerCase()] || 'text-base-content/50';
};

export const getMediaTypeColors = (type) => {
  const map = {
    tv: { border: 'border-l-blue-500', text: 'text-blue-500', bg: 'bg-blue-500', textContent: 'text-white' },
    movies: { border: 'border-l-purple-500', text: 'text-purple-500', bg: 'bg-purple-500', textContent: 'text-white' },
    games: { border: 'border-l-red-500', text: 'text-red-500', bg: 'bg-red-500', textContent: 'text-white' },
    vn: { border: 'border-l-orange-500', text: 'text-orange-500', bg: 'bg-orange-500', textContent: 'text-white' },
    anime: { border: 'border-l-pink-500', text: 'text-pink-500', bg: 'bg-pink-500', textContent: 'text-white' },
    manga: { border: 'border-l-yellow-500', text: 'text-yellow-500', bg: 'bg-yellow-500', textContent: 'text-black' },
    books: { border: 'border-l-green-500', text: 'text-green-500', bg: 'bg-green-500', textContent: 'text-white' },
    comics: { border: 'border-l-indigo-500', text: 'text-indigo-500', bg: 'bg-indigo-500', textContent: 'text-white' },
  };
  return map[type?.toLowerCase()] || { border: 'border-l-primary', text: 'text-primary', bg: 'bg-primary', textContent: 'text-primary-content' };
};

export const formatProgressLabel = (prog, type) => {
  if (!prog || prog === 'Not Started' || prog === 'COMPLETED') return null;
  if (prog.includes('S') && prog.includes('E')) return prog; 
  const num = parseInt(prog);
  if (!isNaN(num)) {
    if (type === 'tv' || type === 'anime') return `Ep. ${num}`;
    if (type === 'manga' || type === 'books') return `Ch. ${num}`;
    if (type === 'comics') return `Iss. ${num}`;
    if (type === 'games' || type === 'vn') return `${num}%`;
  }
  return prog;
};

export const stripHtml = (html) => {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  } catch (e) {
    return html.replace(/<[^>]*>?/gm, '');
  }
};

export const getOptimizedImage = (url, w = 342) => {
  if (!url) return null;
  if (url.includes('vndb.org') || url.includes('image.tmdb.org') || url.includes('images.igdb.com') || url.includes('wsrv.nl')) return url;
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&output=webp`;
};

export const resolveMediaImage = (item, type, size = 'md') => {
  const raw = item?.apiData?.raw || item?.raw || item || {};
  const image = item?.apiData?.image || item?.image || null;

  if (type === 'movies' || type === 'tv') {
    if (size === 'banner' && raw.backdrop_path) return `https://image.tmdb.org/t/p/w1280${raw.backdrop_path}`;
    const path = raw.poster_path;
    if (path) return `https://image.tmdb.org/t/p/${size === 'thumb' ? 'w154' : size === 'lg' ? 'w500' : size === 'original' ? 'original' : 'w342'}${path}`;
  } else if (type === 'games') {
    const imgId = raw.cover?.image_id;
    if (size === 'banner') return raw.artworks?.[0]?.image_id ? `https://images.igdb.com/igdb/image/upload/t_1080p/${raw.artworks[0].image_id}.jpg` : (raw.screenshots?.[0]?.image_id ? `https://images.igdb.com/igdb/image/upload/t_1080p/${raw.screenshots[0].image_id}.jpg` : null);
    if (imgId) return `https://images.igdb.com/igdb/image/upload/${size === 'thumb' ? 't_cover_small' : size === 'original' ? 't_original' : 't_720p'}/${imgId}.jpg`;
  } else if (type === 'vn') {
    if (size === 'banner') return raw.screenshots?.[0]?.url || null;
    // Uses fallback image below
  } else if (type === 'anime' || type === 'manga') {
    if (size === 'banner') return raw.bannerImage || null;
    if (size === 'thumb') return raw.coverImage?.large || raw.coverImage?.medium || image;
    if (size === 'md') return raw.coverImage?.extraLarge || raw.coverImage?.large || image;
    if (size === 'lg' || size === 'original') return raw.coverImage?.extraLarge || raw.coverImage?.large || image;
  } else if (type === 'books' && raw.cover_i) {
    return `https://covers.openlibrary.org/b/id/${raw.cover_i}-${size === 'thumb' ? 'S' : size === 'md' ? 'M' : 'L'}.jpg`;
  }
  return size === 'banner' ? null : getOptimizedImage(image, size === 'thumb' ? 154 : size === 'lg' ? 500 : 342);
};

// --- UNIFIED GLOBAL LOGGING MODAL ---
export const GlobalDiaryModal = () => {
  const activeDiaryModal = useMediaStore((state) => state.activeDiaryModal);
  const closeDiaryModal = useMediaStore((state) => state.closeDiaryModal);
  const addMediaItem = useMediaStore((state) => state.addMediaItem);
  const addDiaryLog = useMediaStore((state) => state.addDiaryLog);
  const removeMediaItem = useMediaStore((state) => state.removeMediaItem);
  const navigate = useNavigate();

  const [status, setStatus] = useState('');
  const [rating, setRating] = useState(0);
  const [progress, setProgress] = useState('');
  const [inputSeason, setInputSeason] = useState(1);
  const [inputEpisode, setInputEpisode] = useState(0);
  const [dateStarted, setDateStarted] = useState('');
  const [dateCompleted, setDateCompleted] = useState('');
  const [reviewText, setReviewText] = useState('');
  const [isRewatch, setIsRewatch] = useState(false);
  const [modalEpisodes, setModalEpisodes] = useState([]);
  const [loadingModalEps, setLoadingModalEps] = useState(false);
  const [isRatingDropdownOpen, setIsRatingDropdownOpen] = useState(false);

  useEffect(() => {
    if (activeDiaryModal) {
      const { targetItem, newProgressOverride, explicitAction } = activeDiaryModal;
      
      let initialStatus = targetItem?.status || ''; 
      if (explicitAction === 'SEASON FINISHED') initialStatus = 'in progress';
      if (activeDiaryModal.targetStatus) initialStatus = activeDiaryModal.targetStatus;
      
      setStatus(initialStatus);
      setRating(isPreview ? 0 : (targetItem?.rating || 0));

      let initProgress = newProgressOverride || targetItem?.progress || '';
      setProgress(initProgress);

      if (activeDiaryModal.type === 'tv') {
        const match = initProgress.match(/S(\d+)\s*E(\d+)/i);
        if (match) {
          setInputSeason(parseInt(match[1], 10));
          setInputEpisode(parseInt(match[2], 10));
        } else {
          setInputSeason(1);
          setInputEpisode(0);
        }
      }

      setDateStarted(targetItem?.dateStarted ? new Date(targetItem.dateStarted).toISOString().split('T')[0] : '');
      setDateCompleted(targetItem?.dateCompleted ? new Date(targetItem.dateCompleted).toISOString().split('T')[0] : '');
      setReviewText('');
      setIsRewatch(false);
      setIsRatingDropdownOpen(false);

      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [activeDiaryModal]);

  useEffect(() => {
    if (activeDiaryModal && activeDiaryModal.type === 'tv' && activeDiaryModal.apiData?.id) {
      let isMounted = true;
      setLoadingModalEps(true);
      apiRegistry.getTVSeason(activeDiaryModal.apiData.id, inputSeason)
        .then(res => {
          if (isMounted) {
            setModalEpisodes(res.episodes || []);
            setLoadingModalEps(false);
          }
        })
        .catch(() => {
          if (isMounted) {
            setModalEpisodes([]);
            setLoadingModalEps(false);
          }
        });
      return () => { isMounted = false; };
    }
  }, [inputSeason, activeDiaryModal?.apiData?.id, activeDiaryModal?.type, activeDiaryModal]);

  if (!activeDiaryModal) return null;

  const { targetItem, type, isPreview, seasonOverride, explicitAction, apiData, titleToSave } = activeDiaryModal;
  const raw = apiData?.raw || targetItem?.raw || targetItem?.apiData?.raw || {};
  const maxProgress = type === 'tv' ? raw.number_of_episodes : type === 'anime' ? raw.episodes : type === 'manga' || type === 'comics' ? (raw.chapters || raw.issuesCount) : null;
  const progressUnit = type === 'tv' || type === 'anime' ? 'Episodes' : type === 'manga' || type === 'comics' ? (type === 'comics' ? 'Issues' : 'Chapters') : '';

  // TV Selector Logic
  const maxSeasons = raw.number_of_seasons || 1;
  const currentSeasonObj = raw.seasons?.find(s => s.season_number === inputSeason) || {};
  const maxEpisodesInSeason = currentSeasonObj.episode_count || 999;

  const handleClose = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsRatingDropdownOpen(false);
    setTimeout(() => closeDiaryModal(), 10);
  };

  const handleQuickSeasonComplete = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!window.confirm(`Mark Season ${inputSeason} as completed and log it to your diary?`)) return;

    const s = dateStarted ? new Date(dateStarted).getTime() : null;
    const c = dateCompleted ? new Date(dateCompleted).getTime() : Date.now();

    const finalProgress = `S${inputSeason.toString().padStart(2, '0')} E${maxEpisodesInSeason.toString().padStart(2, '0')}`;
    const newStatus = (!status || status === 'planned') ? 'in progress' : status;

    const libraryPayload = {
      ...targetItem,
      id: apiData?.id || targetItem?.id,
      title: titleToSave || targetItem?.title,
      type,
      subtype: getSubtype(type),
      progress: finalProgress,
      status: newStatus,
      rating: rating,
      addedAt: isPreview ? (c || Date.now()) : (targetItem?.addedAt || Date.now()),
      dateStarted: s,
      dateCompleted: c,
      rewatchCount: targetItem?.rewatchCount || 0,
      apiData: apiData || targetItem?.apiData
    };

    addMediaItem(libraryPayload, type);

    const isolatedSeasonYear = currentSeasonObj?.air_date ? currentSeasonObj.air_date.substring(0, 4) : undefined;
    
    addDiaryLog({
      log_id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2),
      media_id: libraryPayload.id,
      media_type: type,
      action_type: 'WATCHED',
      log_date: new Date(c).toISOString(),
      review_text: '',
      image: apiData?.image || targetItem?.image,
      season_label: `Season ${inputSeason}`,
      season_year: isolatedSeasonYear
    });

    const nextSeason = inputSeason + 1;
    if (nextSeason <= maxSeasons) {
      setInputSeason(nextSeason);
      setInputEpisode(1);
    } else {
      setInputEpisode(maxEpisodesInSeason);
    }
  };

  const handleStatusClick = (s) => {
    setStatus(s);
    if (s === 'completed' && !dateCompleted) {
      setDateCompleted(new Date().toISOString().split('T')[0]);
    }
  };

  const handleSave = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!status) return; // Prevent saving purely blank states
    const s = (type !== 'movies' && dateStarted) ? new Date(dateStarted).getTime() : null;
    const c = dateCompleted ? new Date(dateCompleted).getTime() : null;
    
    let r = targetItem?.rewatchCount || 0;
    if (isRewatch) r += 1;

    let finalProgress = progress;
    let targetLogSeason = inputSeason;
    let logSeasonObj = seasonOverride;
    let isManualSeasonFinale = false;
    let finalActionType = isRewatch ? `RE-${['games', 'vn'].includes(type) ? 'PLAYED' : ['manga', 'books', 'comics'].includes(type) ? 'READ' : 'WATCHED'}` : (status === 'completed' ? (['games', 'vn'].includes(type) ? 'PLAYED' : ['manga', 'books', 'comics'].includes(type) ? 'READ' : 'WATCHED') : 'LOGGED');

    if (type === 'tv') {
      if (status === 'completed') {
        const lastS = raw.number_of_seasons || 1;
        logSeasonObj = raw.seasons?.find(se => se.season_number === lastS);
        targetLogSeason = lastS;
        finalProgress = `S${lastS.toString().padStart(2, '0')} E${(logSeasonObj?.episode_count || 1).toString().padStart(2, '0')}`;
      } else {
        finalProgress = `S${inputSeason.toString().padStart(2, '0')} E${inputEpisode.toString().padStart(2, '0')}`;
        isManualSeasonFinale = inputEpisode > 0 && inputEpisode === maxEpisodesInSeason;
      }
      if (!logSeasonObj && (status === 'completed' || explicitAction === 'SEASON FINISHED' || (isManualSeasonFinale && finalProgress !== targetItem?.progress) || reviewText.trim() !== '')) {
        logSeasonObj = raw.seasons?.find(se => se.season_number === targetLogSeason);
      }
    } else if (status === 'completed' && maxProgress && !String(finalProgress).includes('S')) {
      finalProgress = `${maxProgress} ${progressUnit}`;
    }

    const libraryPayload = {
      ...(isPreview ? targetItem : targetItem),
      id: apiData?.id || targetItem?.id,
      title: titleToSave || targetItem?.title,
      type,
      subtype: getSubtype(type),
      progress: finalProgress,
      status: status,
      rating: rating,
      addedAt: targetItem?.addedAt || Date.now(),
      dateStarted: s,
      dateCompleted: c,
      rewatchCount: r,
      apiData: apiData || targetItem?.apiData
    };

    addMediaItem(libraryPayload, type);

    const noteExists = reviewText.trim() !== '';
    
    const prevProgress = targetItem?.progress || '';
    const newlyFinishedSeason = isManualSeasonFinale && finalProgress !== prevProgress;

    const isMilestone = status === 'completed' || explicitAction === 'SEASON FINISHED' || newlyFinishedSeason;

    if (isMilestone || noteExists || isRewatch || explicitAction === 'NOTE ADDED') {
      if (explicitAction === 'SEASON FINISHED' || newlyFinishedSeason) finalActionType = 'WATCHED';

      const isolatedSeasonYear = logSeasonObj?.air_date ? logSeasonObj.air_date.substring(0, 4) : undefined;
      const finalSeasonLabel = logSeasonObj ? `Season ${logSeasonObj.season_number}` : undefined;

      const getLogDate = () => {
        const now = new Date();
        if (!dateCompleted) return now.toISOString();
        const todayStr = now.toISOString().split('T')[0];
        if (dateCompleted === todayStr) return now.toISOString();
        return `${dateCompleted}T${now.toISOString().split('T')[1]}`;
      };

      addDiaryLog({
        log_id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2),
        media_id: libraryPayload.id,
        media_type: type,
        action_type: finalActionType,
        log_date: getLogDate(),
        review_text: reviewText.trim(), // Empty string is fine, UI ignores it
        image: apiData?.image || targetItem?.image,
        season_label: finalSeasonLabel,
        season_year: isolatedSeasonYear
      });
    }

    setTimeout(() => {
      closeDiaryModal();
    }, 10);
  };

  const handleDelete = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (window.confirm(`Permanently delete ${titleToSave || targetItem.title} from your library and diary?`)) {
      removeMediaItem(targetItem.id, type);
      setTimeout(() => {
        closeDiaryModal();
        navigate(-1);
      }, 10);
    }
  };

  const title = titleToSave || targetItem?.title || 'Unknown Title';
  const displayImage = apiData?.image || targetItem?.image;
  const showReviewSection = status !== 'planned' && status !== '';

  return createPortal(
    <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-sm flex flex-col justify-center items-center p-4 animate-in fade-in duration-200 touch-manipulation" style={{ overscrollBehavior: 'none' }} onClick={handleClose}>
      <div className="bg-base-100 shadow-2xl border border-base-300 w-full max-w-3xl flex flex-col sm:flex-row overflow-hidden rounded-none max-h-[95dvh] sm:max-h-[85vh] animate-in zoom-in-95 duration-200 relative" onClick={e => e.stopPropagation()}>
        
        {/* Header/Poster Area - Unified for Mobile and Desktop */}
        <div className="w-full sm:w-[40%] sm:p-8 bg-base-200 relative shrink-0 flex flex-row sm:flex-col items-start sm:items-center sm:justify-center border-b sm:border-b-0 sm:border-r border-base-300">
          {/* Poster Thumbnail Mobile / Full Desktop */}
          <div className="w-20 sm:w-full sm:max-w-[220px] aspect-[2/3] relative shrink-0 border-r border-b sm:border-r-0 sm:border-b-0 sm:border border-base-300 bg-base-300 m-3 sm:m-0 shadow-sm overflow-hidden rounded-none">
            <ImageWithFallback src={displayImage} alt={title} className="w-full h-full object-cover" />
            <div className="hidden sm:block absolute inset-0 bg-gradient-to-t from-base-100/40 to-transparent pointer-events-none"></div>
          </div>
          
          {/* Title Area */}
          <div className="py-3 pr-3 sm:p-0 sm:mt-6 flex flex-col justify-center sm:items-center w-full min-w-0 flex-1 sm:flex-none">
             <h2 className="text-base sm:text-2xl font-black uppercase tracking-tight font-sans leading-tight text-primary line-clamp-3 sm:text-center sm:px-4">{title}</h2>
             <span className="text-[10px] sm:text-xs font-mono font-bold text-base-content/60 uppercase tracking-widest mt-0.5 sm:mt-2 truncate sm:whitespace-normal sm:text-center sm:max-h-16 sm:overflow-hidden">
               {apiData?.year || targetItem?.year || '----'} {seasonOverride ? `• Season ${seasonOverride.season_number}` : ''}
             </span>

             {/* Mobile Actions */}
             <div className="flex sm:hidden items-center gap-2 mt-4 w-full">
               <button type="button" onClick={handleSave} className="flex items-center justify-center bg-primary hover:bg-primary/90 text-primary-content border-none rounded-none appearance-none font-black font-mono uppercase tracking-widest text-[11px] shadow-none flex-1 touch-manipulation h-12 transition-colors">
                 Save Log
               </button>
               {!isPreview && (
                 <button type="button" onClick={handleDelete} className="flex items-center justify-center border border-base-300 bg-base-100 text-error hover:bg-error/10 rounded-none appearance-none px-4 shrink-0 touch-manipulation h-12 transition-colors">
                   <Trash2 className="w-4 h-4" />
                 </button>
               )}
             </div>
          </div>

          {/* Mobile Close Button */}
          <button type="button" onClick={handleClose} className="absolute top-0 right-0 btn btn-square btn-sm btn-ghost bg-base-100 hover:bg-base-200 sm:hidden z-20 touch-manipulation rounded-none border-b border-l border-base-300"><X className="w-4 h-4 text-base-content" /></button>
        </div>

        {/* Right Form Pane */}
        <div className="flex-1 flex flex-col overflow-hidden relative bg-base-100">
          <button type="button" onClick={handleClose} className="absolute top-4 right-4 btn btn-square btn-sm btn-ghost border border-base-300 hover:bg-base-200 rounded-none z-30 hidden sm:flex touch-manipulation"><X className="w-4 h-4" /></button>

          <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar p-4 sm:p-8 flex flex-col gap-5 sm:gap-6">
          {/* Status Selection */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-mono font-bold text-base-content/50 uppercase tracking-widest">Status</label>
            <div className="grid grid-cols-2 gap-2">
              {['planned', 'in progress', 'completed', 'dropped'].map(s => (
                <button type="button" key={s} onClick={() => handleStatusClick(s)} className={`flex items-center justify-center rounded-none appearance-none font-bold font-mono uppercase tracking-widest text-[10px] sm:text-[9px] h-10 min-h-[40px] touch-manipulation transition-all border ${status === s ? 'bg-primary border-primary text-primary-content shadow-none' : 'bg-base-100 text-base-content/70 border-base-300 hover:bg-base-200'}`}>
                  {getDynamicStatusLabel(s, type, false)}
                </button>
              ))}
            </div>
          </div>

          {/* Rating Engine */}
          <div className={`flex flex-col gap-1.5 ${type === 'tv' ? 'border-t border-base-200 pt-5 sm:border-0 sm:pt-0' : 'items-center justify-center pt-2 sm:items-start sm:justify-start sm:pt-0'}`}>
            {type === 'tv' && (
              <div className="flex justify-between items-center w-full sm:mb-1">
                 <label className="text-[10px] font-mono font-bold text-base-content/50 uppercase tracking-widest">Rating</label>
                 {rating > 0 && <button onClick={() => setRating(0)} className="hidden sm:block text-[9px] font-mono text-base-content/40 hover:text-error uppercase tracking-widest px-2 py-1 transition-colors">Clear</button>}
              </div>
            )}
            {type !== 'tv' && rating > 0 && (
               <button onClick={() => setRating(0)} className="hidden sm:block text-[9px] font-mono text-base-content/40 hover:text-error uppercase tracking-widest py-1 transition-colors sm:self-start">Clear Rating</button>
            )}
            <div className={`bg-base-100 ${type === 'tv' ? 'border border-base-300 p-2 sm:border-0 sm:p-0 sm:bg-transparent' : 'sm:bg-transparent'} flex justify-center rounded-none w-full sm:w-auto mt-1 sm:mt-0`}>
              
              {/* Mobile Custom Dropdown */}
              <div className="relative w-full sm:hidden">
                <button type="button" onClick={() => setIsRatingDropdownOpen(!isRatingDropdownOpen)} className="flex justify-between items-center w-full h-10 px-3 bg-base-100 border border-base-300 focus:border-primary rounded-none appearance-none font-mono text-xs transition-colors">
                  <span className="font-bold">{rating ? `${rating} / 10 Stars` : 'Unrated'}</span>
                  <div className="flex items-center gap-1">
                    {rating > 0 && <Star className="w-3.5 h-3.5 text-warning fill-warning" />}
                    <ChevronDown className="w-4 h-4 opacity-50" />
                  </div>
                </button>
                {isRatingDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-[190]" onClick={(e) => { e.stopPropagation(); setIsRatingDropdownOpen(false); }}></div>
                    <div className="absolute top-full mt-1 left-0 z-[200] shadow-2xl bg-base-100 w-full border border-base-300 flex flex-col animate-in slide-in-from-top-2 duration-150">
                      <div className="grid grid-cols-2 divide-x divide-base-200">
                        <ul className="menu p-0 flex flex-col">
                          {[1,2,3,4,5].map((i) => (
                            <li key={i}><a onClick={() => { setRating(i); setIsRatingDropdownOpen(false); }} className="rounded-none py-1.5 px-3 min-h-0 flex justify-between items-center border-b border-base-200">
                              <span className="font-mono text-[10px] font-bold">{i}/10</span>
                              <div className="flex gap-[1px] text-warning">
                                 {[...Array(Math.floor(i/2))].map((_, j) => <Star key={j} className="w-3 h-3 fill-warning" />)}
                                 {i%2 !== 0 && <StarHalf className="w-3 h-3 fill-warning" />}
                              </div>
                            </a></li>
                          ))}
                        </ul>
                        <ul className="menu p-0 flex flex-col">
                          {[6,7,8,9,10].map((i) => (
                            <li key={i}><a onClick={() => { setRating(i); setIsRatingDropdownOpen(false); }} className="rounded-none py-1.5 px-3 min-h-0 flex justify-between items-center border-b border-base-200">
                              <span className="font-mono text-[10px] font-bold">{i}/10</span>
                              <div className="flex gap-[1px] text-warning">
                                 {[...Array(Math.floor(i/2))].map((_, j) => <Star key={j} className="w-3 h-3 fill-warning" />)}
                                 {i%2 !== 0 && <StarHalf className="w-3 h-3 fill-warning" />}
                              </div>
                            </a></li>
                          ))}
                        </ul>
                      </div>
                      <button type="button" onClick={() => { setRating(0); setIsRatingDropdownOpen(false); }} className="flex items-center justify-center w-full min-h-[36px] bg-transparent hover:bg-error text-error hover:text-error-content rounded-none appearance-none font-mono font-bold uppercase tracking-widest text-[10px] transition-colors">Clear Rating</button>
                    </div>
                  </>
                )}
              </div>

              <div className="hidden sm:flex">
                <StarRating rating={rating} onChange={setRating} readOnly={false} />
              </div>
            </div>
          </div>

          {/* Progress Tracker */}
          {progressUnit && (
             <div className="flex flex-col gap-1.5 border-t border-base-200 pt-5 sm:border-0 sm:pt-0">
               <label className="text-[10px] font-mono font-bold text-base-content/50 uppercase tracking-widest">Progress</label>
               {type === 'tv' ? (
                 <div className="flex flex-col gap-2">
                   <div className="flex gap-2">
                    <div className="flex flex-col flex-1 gap-1">
                      <span className="text-[9px] font-mono text-base-content/40 uppercase pl-1">Season</span>
                      <select value={inputSeason} onChange={(e) => { setInputSeason(parseInt(e.target.value)); setInputEpisode(0); if (!status || status === 'planned') setStatus('in progress'); }} className="w-full font-mono text-xs rounded-none border border-base-300 bg-base-100 h-10 min-h-[40px] focus:outline-none focus:border-primary px-2 appearance-none cursor-pointer">
                         {Array.from({ length: maxSeasons }, (_, i) => <option key={i+1} value={i+1}>Season {i+1}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col flex-1 gap-1">
                      <span className="text-[9px] font-mono text-base-content/40 uppercase pl-1">Episode</span>
                      <select value={inputEpisode} onChange={(e) => { setInputEpisode(parseInt(e.target.value)); if (!status || status === 'planned') setStatus('in progress'); }} className="w-full font-mono text-xs rounded-none border border-base-300 bg-base-100 h-10 min-h-[40px] focus:outline-none focus:border-primary px-2 appearance-none cursor-pointer">
                         {loadingModalEps ? (
                           <option value={inputEpisode}>Loading...</option>
                         ) : modalEpisodes.length > 0 ? (
                           modalEpisodes.map(ep => (
                             <option key={ep.id} value={ep.episode_number}>
                               {ep.episode_number}: {ep.name}
                             </option>
                           ))
                         ) : (
                           Array.from({ length: maxEpisodesInSeason + 1 }, (_, i) => <option key={i} value={i}>Episode {i}</option>)
                         )}
                      </select>
                    </div>
                   </div>
                   <button type="button" onClick={handleQuickSeasonComplete} className="flex items-center justify-center w-full h-8 mt-1 bg-transparent border border-base-300 hover:border-primary hover:bg-primary text-primary hover:text-primary-content rounded-none appearance-none font-mono uppercase tracking-widest text-[10px] transition-colors shadow-sm">
                     Complete Season {inputSeason}?
                   </button>
                 </div>
               ) : (
                 <div className="flex items-center gap-2">
                   <input type="number" min="0" max={maxProgress || undefined} value={progress} onChange={e => { setProgress(e.target.value); if (!status || status === 'planned') setStatus('in progress'); }} placeholder={`e.g. 12`} className="w-full font-mono text-xs rounded-none border border-base-300 bg-base-100 h-10 min-h-[40px] focus:outline-none focus:border-primary px-3" />
                   <span className="text-[10px] font-mono font-bold text-base-content/50 uppercase tracking-widest shrink-0">{progressUnit} {maxProgress ? `/ ${maxProgress}` : ''}</span>
                 </div>
               )}
             </div>
          )}

          {/* Review & Dates Area */}
          {showReviewSection && (
            <div className="flex flex-col gap-4 border-t border-base-200 pt-5 sm:border-0 sm:pt-0">
              <div className={`grid ${type === 'movies' ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                 {type !== 'movies' && (
                   <div className="flex flex-col gap-1">
                     <label className="text-[10px] font-mono font-bold text-base-content/50 uppercase tracking-widest flex items-center gap-1 pl-1"><Calendar className="w-3 h-3"/> Started</label>
                     <input type="date" value={dateStarted} onChange={e => setDateStarted(e.target.value)} className="w-full font-mono text-xs rounded-none border border-base-300 bg-base-100 h-10 min-h-[40px] focus:outline-none focus:border-primary px-2 cursor-pointer" />
                   </div>
                 )}
                 <div className="flex flex-col gap-1">
                   <label className="text-[10px] font-mono font-bold text-base-content/50 uppercase tracking-widest flex items-center gap-1 pl-1"><Calendar className="w-3 h-3"/> {type === 'movies' ? 'Watched' : 'Finished'}</label>
                   <input type="date" value={dateCompleted} onChange={e => setDateCompleted(e.target.value)} className="w-full font-mono text-xs rounded-none border border-base-300 bg-base-100 h-10 min-h-[40px] focus:outline-none focus:border-primary px-2 cursor-pointer" />
                 </div>
              </div>

              {!isPreview && status === 'completed' && (
                 <div className="flex items-center gap-3 bg-base-100 border border-base-300 p-3 rounded-none">
                   <input type="checkbox" id="rewatch-check" checked={isRewatch} onChange={e => setIsRewatch(e.target.checked)} className="appearance-none w-4 h-4 border border-base-300 bg-base-100 checked:bg-primary checked:border-primary rounded-none cursor-pointer flex items-center justify-center transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-primary-content checked:after:text-[10px] checked:after:font-bold" />
                   <label htmlFor="rewatch-check" className="text-[10px] font-mono font-bold uppercase tracking-widest cursor-pointer select-none">Mark as {getRewatchTerm(type)}</label>
                 </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono font-bold text-base-content/50 uppercase tracking-widest pl-1">Review / Notes</label>
                <textarea placeholder="" className="w-full min-h-[100px] p-3 sm:p-4 bg-base-100 border border-base-300 focus:outline-none focus:border-primary rounded-none appearance-none font-sans text-[16px] sm:text-sm leading-relaxed transition-colors" value={reviewText} onChange={e => setReviewText(e.target.value)} />
              </div>
            </div>
          )}
          </div>

          {/* Desktop Actions */}
          <div className="hidden sm:flex flex-row items-center justify-between gap-3 shrink-0 border-t border-base-300 p-4 sm:px-8 sm:py-4 bg-base-100 z-20">
             {!isPreview ? (
                <button type="button" onClick={handleDelete} className="flex items-center justify-center text-error hover:bg-error/10 border border-transparent hover:border-error/20 rounded-none appearance-none font-bold font-mono uppercase tracking-widest text-[10px] h-10 px-4 touch-manipulation transition-colors">
                  <Trash2 className="w-4 h-4 mr-2" /> <span>Delete</span>
                </button>
             ) : <div></div>}
             <div className="flex flex-row gap-3">
               <button type="button" onClick={handleClose} className="flex items-center justify-center border border-base-300 bg-base-100 hover:bg-base-200 hover:border-primary hover:text-primary rounded-none appearance-none font-bold font-mono uppercase tracking-widest text-[10px] h-10 px-4 touch-manipulation transition-colors">
                  Cancel
               </button>
               <button type="button" onClick={handleSave} className="flex items-center justify-center bg-primary hover:bg-primary/90 text-primary-content border-none rounded-none appearance-none font-black font-mono uppercase tracking-widest text-xs h-10 px-8 touch-manipulation transition-all">
                 Save Log
               </button>
             </div>
          </div>

        </div>
      </div>
    </div>,
    document.body
  );
};


export const ToastContainer = () => {
  const toasts = useUIStore(state => state.toasts);
  const removeToast = useUIStore(state => state.removeToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toast toast-top toast-center z-[200] pt-16 w-full max-w-md pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`flex items-center justify-between gap-4 w-full p-3 rounded-none shadow-2xl border-0 font-mono text-[9px] sm:text-xs uppercase tracking-widest animate-in slide-in-from-top-4 fade-in duration-300 pointer-events-auto text-white ${t.type === 'error' ? 'bg-error' : t.type === 'success' ? 'bg-success' : 'bg-info'}`}>
          <div className="flex items-center gap-2">
            {t.type === 'error' && <AlertCircle className="w-5 h-5 shrink-0" />}
            {t.type === 'success' && <CheckCircle className="w-5 h-5 shrink-0" />}
            {t.type === 'info' && <Info className="w-5 h-5 shrink-0" />}
            <span className="leading-tight">{t.message}</span>
          </div>
          <button onClick={() => removeToast(t.id)} className="flex items-center justify-center w-6 h-6 bg-transparent hover:bg-transparent opacity-70 hover:opacity-100 rounded-none appearance-none transition-colors shrink-0"><X className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
};

export const ImageWithFallback = ({ src, alt, className, fallbackText = "NO IMG" }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  if (!src || error) {
    return (
      <div className={`flex flex-col items-center justify-center bg-base-200 text-base-content/20 w-full h-full ${className} border border-base-300`}>
         <div className="w-1/3 aspect-square mb-2 opacity-20"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg></div>
         <span className="font-mono text-[8px] uppercase tracking-[0.2em]">{fallbackText}</span>
      </div>
    );
  }
  return (
    <div className={`relative bg-base-300 w-full h-full ${className} overflow-hidden`}>
      {!loaded && <div className="absolute inset-0 bg-base-300 animate-pulse z-0"></div>}
      <img src={src} alt={alt} onLoad={() => setLoaded(true)} onError={() => setError(true)} className={`w-full h-full object-cover transition-opacity duration-500 ease-in-out ${loaded ? 'opacity-100' : 'opacity-0'} relative z-10 ${className}`} loading="lazy" />
    </div>
  );
};

export const StarRating = ({ rating = 0, onChange, readOnly = false }) => {
  const [hoverRating, setHoverRating] = useState(0);
  const handleMouseMove = (e, index) => {
    if (readOnly) return;
    const { left, width } = e.currentTarget.getBoundingClientRect();
    const isHalf = (e.clientX - left) / width < 0.5;
    setHoverRating(index * 2 + (isHalf ? 1 : 2));
  };
  return (
    <div className={`flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 w-full ${readOnly ? 'pointer-events-none' : ''}`} onMouseLeave={() => !readOnly && setHoverRating(0)}>
      <div className="flex justify-center items-center">
        {[...Array(5)].map((_, i) => {
          const displayValue = hoverRating || rating;
          const starValue = (i + 1) * 2;
          let StarComponent = Star;
          let fillClass = "text-base-content/20 fill-transparent";
          if (displayValue >= starValue) fillClass = "text-info fill-info";
          else if (displayValue === starValue - 1) { StarComponent = StarHalf; fillClass = "text-info fill-info"; }
          return (
            <div key={i} className={readOnly ? 'p-0.5' : 'cursor-pointer transition-transform hover:scale-110 p-3 sm:p-1'} onMouseMove={(e) => handleMouseMove(e, i)} onClick={() => !readOnly && onChange(hoverRating)}>
              <StarComponent className={`w-5 h-5 sm:w-6 sm:h-6 ${fillClass}`} />
            </div>
          );
        })}
      </div>
      {!readOnly && (
         <div className="font-mono text-[10px] font-bold text-base-content/50 uppercase tracking-widest text-center mt-2 sm:mt-0 ml-2">
           {hoverRating ? `Set: ${hoverRating}/10` : rating ? `${rating}/10` : 'Unrated'}
         </div>
      )}
    </div>
  );
};

export const MediaCard = ({ item }) => {
  const image = resolveMediaImage(item, item.type, 'md');
  const colors = getMediaTypeColors(item.type);

  return (
    <Link to={`/media/${item.type}/${item.id}`} className={`group relative bg-base-100 border-y border-r border-base-300 border-l-4 border-l-transparent ${colors.hoverBorder} transition-all duration-200 hover:shadow-md cursor-pointer flex flex-col h-full`}>
      <figure className="relative aspect-[2/3] w-full overflow-hidden bg-base-200 border-b border-base-300">
        <ImageWithFallback src={image} alt={item.title} className="grayscale-[15%] group-hover:grayscale-0" />
        <div className="absolute top-0 right-0 z-10"><div className={`px-2 py-1 text-[9px] font-mono font-bold tracking-[0.15em] uppercase border-b border-l border-base-300 ${colors.bg} ${colors.textContent}`}>{item.subtype}</div></div>
      </figure>
      <div className="p-3 flex flex-col flex-grow min-w-0 bg-base-100">
        <div className="flex flex-col mb-auto">
          <h2 className="text-xs font-bold leading-tight line-clamp-2 uppercase tracking-wide font-sans" title={item.title}>{item.title}</h2>
          {item.apiData?.year && item.apiData.year !== '----' && <span className="text-[9px] font-mono font-bold text-base-content/40 tracking-widest mt-1">{item.apiData.year}</span>}
        </div>
        
        <div className="flex items-end justify-between mt-3 font-mono border-t border-base-200 pt-3">
          <div className="flex flex-col text-left min-w-0 flex-1">
            <span className={`text-[10px] font-black uppercase tracking-widest text-left truncate flex items-center gap-1 ${getStatusColorCard(item.status)}`}>
              {item.status}
            </span>
            {formatProgressLabel(item.progress, item.type) && <span className="text-[8px] font-bold text-base-content/60 uppercase tracking-widest truncate mt-0.5">{formatProgressLabel(item.progress, item.type)}</span>}
          </div>
          
          {item.rating > 0 && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-base-content shrink-0 ml-2 bg-base-200 px-1.5 py-0.5">
              <Star className="w-3 h-3 text-info fill-info" /><span>{item.rating}.0</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
};

export const MediaListRow = ({ item }) => {
  const image = resolveMediaImage(item, item.type, 'thumb');
  const colors = getMediaTypeColors(item.type);

  return (
    <Link to={`/media/${item.type}/${item.id}`} className={`group flex flex-row items-center gap-3 sm:gap-4 bg-base-100 border border-base-300 border-l-4 border-l-transparent ${colors.hoverBorder} transition-all duration-200 hover:shadow-md cursor-pointer p-2 sm:p-3`}>
      <div className="w-12 h-16 sm:w-16 sm:h-24 flex-shrink-0 bg-base-200 border border-base-300 overflow-hidden relative">
        <ImageWithFallback src={image} alt={item.title} className="grayscale-[15%] group-hover:grayscale-0 object-cover w-full h-full" />
      </div>
      <div className="flex flex-col flex-1 min-w-0 justify-center">
        <h2 className="text-sm sm:text-base font-bold leading-tight truncate uppercase tracking-wide font-sans">{item.title}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 sm:mt-2 text-[10px] font-mono text-base-content/60 uppercase tracking-widest">
          <span>{item.apiData?.year || '----'}</span>
          <span className={`font-black ${getStatusColorCard(item.status)}`}>{item.status}</span>
          {formatProgressLabel(item.progress, item.type) && <span className="hidden sm:inline-block">{formatProgressLabel(item.progress, item.type)}</span>}
          {item.rating > 0 && <span className="flex items-center gap-0.5 text-info bg-base-200 px-1.5 py-0.5"><Star className="w-3 h-3 fill-info"/>{item.rating}.0</span>}
        </div>
      </div>
      <div className="hidden sm:flex px-4 items-center justify-center">
        <div className={`px-2 py-1 text-[9px] font-mono font-bold tracking-[0.15em] uppercase border border-base-300 ${colors.bg} ${colors.textContent}`}>{getSubtype(item.type)}</div>
      </div>
    </Link>
  );
};

const SearchModalItem = ({ item, type, onSelect, handleQuickAdd }) => {
  const [isOpen, setIsOpen] = useState(false);
  const thumbImage = resolveMediaImage(item, type, 'thumb') || item.image;
  
  return (
    <div onClick={() => onSelect(item)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(item); }} className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 hover:bg-base-200 focus:bg-base-200 focus:outline-none transition-colors group cursor-pointer border-b border-base-300 last:border-b-0 relative">
      <div className="w-10 h-14 sm:w-12 sm:h-16 flex-shrink-0 bg-base-300 border border-base-300 overflow-hidden relative">
        <ImageWithFallback src={thumbImage} alt={item.title} className="grayscale-[20%] group-hover:grayscale-0 object-cover" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <h3 className="text-sm font-bold uppercase tracking-wide truncate group-hover:text-primary transition-colors font-sans">{item.title}</h3>
        <div className="flex items-center gap-2 mt-1"><span className="text-[9px] font-mono font-bold bg-base-100 border border-base-300 text-base-content px-1.5 py-0.5 uppercase tracking-widest">{item.year || 'UNKNOWN'}</span><span className="text-[9px] font-mono font-bold text-base-content/50 uppercase tracking-widest truncate">{item.subtitle || item.description?.substring(0, 50) + '...'}</span></div>
      </div>
      <div className="relative" onClick={e => e.stopPropagation()}>
        <div role="button" tabIndex={0} onClick={() => setIsOpen(!isOpen)} className="flex items-center justify-center w-8 h-8 bg-transparent border border-base-300 text-primary hover:bg-base-300 rounded-none appearance-none opacity-100 sm:opacity-50 sm:group-hover:opacity-100 transition-all shrink-0 cursor-pointer relative z-10"><Plus className="w-4 h-4" /></div>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-[190]" onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}></div>
            <div className="absolute top-full right-0 mt-2 z-[200] shadow-2xl bg-base-100 border border-base-300 w-44 rounded-none text-[9px] sm:text-[10px] font-mono uppercase font-bold tracking-widest animate-in slide-in-from-top-2 duration-150">
              <div className="p-1.5 flex flex-col gap-0.5">
                <div className="text-[8px] sm:text-[9px] opacity-50 px-2 py-1 pb-1.5">Quick Add</div>
                <button type="button" className="text-left px-2 py-1.5 bg-transparent hover:bg-base-200 hover:text-primary transition-colors min-h-0 appearance-none" onClick={(e) => { setIsOpen(false); handleQuickAdd(e, item, 'planned'); }}>To {['games', 'vn'].includes(type) ? 'Backlog' : ['movies', 'tv', 'anime'].includes(type) ? 'Watchlist' : 'Reading List'}</button>
                <button type="button" className="text-left px-2 py-1.5 bg-transparent hover:bg-base-200 hover:text-primary transition-colors min-h-0 appearance-none" onClick={(e) => { setIsOpen(false); handleQuickAdd(e, item, 'in progress'); }}>Currently {['games', 'vn'].includes(type) ? 'Playing' : ['movies', 'tv', 'anime'].includes(type) ? 'Watching' : 'Reading'}</button>
                <button type="button" className="text-left px-2 py-1.5 bg-transparent hover:bg-base-200 hover:text-primary transition-colors min-h-0 appearance-none" onClick={(e) => { setIsOpen(false); handleQuickAdd(e, item, 'completed'); }}>Mark as {['games', 'vn'].includes(type) ? 'Played' : ['movies', 'tv', 'anime'].includes(type) ? 'Watched' : 'Read'}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const SearchModal = ({ isOpen, onClose, results, isLoading, query, type, onSelect, page, totalPages, onPageChange }) => {
  const { openDiaryModal } = useMediaStore();

  if (!isOpen) return null;

  const handleQuickAdd = (e, item, status) => {
    e.stopPropagation();
    onClose();
    openDiaryModal({ targetItem: item, type, isPreview: true, targetStatus: status, apiData: item, titleToSave: item.title });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] bg-base-200/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl bg-base-100 border border-base-300 shadow-2xl flex flex-col max-h-[80vh] relative animate-in fade-in slide-in-from-top-4 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-base-300 bg-base-200">
          <div><h2 className="text-lg font-black uppercase tracking-widest font-sans text-primary">Search Results</h2><p className="text-[10px] font-mono font-bold text-base-content/50 uppercase tracking-widest mt-1">Results for "{query}" in {type}</p></div>
          <button onClick={onClose} className="flex items-center justify-center w-8 h-8 bg-transparent hover:bg-error text-base-content/70 hover:text-error-content rounded-none appearance-none transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-16 text-primary"><Loader2 className="w-8 h-8 animate-spin mb-4" /><span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] animate-pulse">Searching...</span></div>
          ) : results.length > 0 ? (
            <div className="flex flex-col divide-y divide-base-300 pb-32">
              {results.map((item, idx) => (
                <SearchModalItem key={item.id || idx} item={item} type={type} onSelect={onSelect} handleQuickAdd={handleQuickAdd} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-16"><span className="text-[10px] font-mono font-bold text-base-content/30 uppercase tracking-[0.2em]">No records found</span></div>
          )}
        </div>
        <div className="p-3 border-t border-base-300 bg-base-200 flex justify-between items-center">
          <button disabled={page <= 1 || isLoading} onClick={() => onPageChange(page - 1)} className="flex items-center justify-center h-8 px-2 sm:px-4 bg-transparent hover:bg-base-300 text-base-content hover:text-base-content rounded-none appearance-none font-mono text-[10px] uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ChevronLeft className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Prev</span></button>
          <span className="text-[10px] font-mono font-bold text-base-content/50 uppercase tracking-widest">PAGE {page} OF {totalPages}</span>
          <button disabled={page >= totalPages || isLoading} onClick={() => onPageChange(page + 1)} className="flex items-center justify-center h-8 px-2 sm:px-4 bg-transparent hover:bg-base-300 text-base-content hover:text-base-content rounded-none appearance-none font-mono text-[10px] uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><span className="hidden sm:inline">Next</span> <ChevronRight className="w-4 h-4 sm:ml-1" /></button>
        </div>
      </div>
    </div>
  );
};

export const EpisodeCard = ({ episode, isWatched, isNext }) => {
  const [revealSpoiler, setRevealSpoiler] = useState(false);
  const image = episode.still_path ? `https://image.tmdb.org/t/p/w300${episode.still_path}` : null;
  const isSpoilery = !isWatched && !isNext && episode.overview;
  const isAired = new Date(episode.air_date) <= new Date();

  return (
    <div className={`flex flex-col md:flex-row gap-4 p-4 border transition-all group ${isWatched ? 'border-base-300 bg-base-200/50 opacity-60' : isNext ? 'border-primary bg-primary/5 shadow-md shadow-primary/10' : isAired ? 'border-base-300 bg-base-200' : 'border-base-300 bg-base-100 opacity-50'}`}>
      <div className="w-full md:w-48 aspect-video flex-shrink-0 border border-base-300 overflow-hidden relative bg-base-300">
        <ImageWithFallback src={image} alt={episode.name} className={`transition-all duration-300 ${isWatched ? 'grayscale opacity-70' : 'grayscale-[20%] group-hover:grayscale-0'}`} />
        <div className="absolute top-0 left-0 bg-base-100 px-2 py-0.5 border-b border-r border-base-300 text-primary">{isWatched ? <CheckCircle className="w-3 h-3" /> : isNext ? <PlayCircle className="w-3 h-3 animate-pulse" /> : null}</div>
        <div className={`absolute bottom-0 right-0 px-2 py-0.5 text-[9px] font-mono font-bold border-t border-l border-base-300 ${isNext ? 'bg-primary text-primary-content' : 'bg-base-100 text-base-content'}`}>E{episode.episode_number.toString().padStart(2, '0')}</div>
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex justify-between items-start gap-2">
          <h4 className={`font-bold uppercase tracking-wide text-sm truncate ${isNext ? 'text-primary' : ''}`}>{episode.name}</h4>
          {isNext && <span className="text-[8px] font-mono font-black tracking-widest uppercase bg-primary/20 text-primary px-1.5 py-0.5 border border-primary/30 shrink-0">Up Next</span>}
        </div>
        <div className="flex gap-3 mt-1 text-[10px] font-mono text-base-content/50 uppercase tracking-widest">
          <span>{formatFancyDate(episode.air_date) || 'TBA'}</span>
          <span>{episode.runtime ? `${episode.runtime}m` : ''}</span>
        </div>
        <div className="relative mt-2 flex-1" onMouseEnter={() => setRevealSpoiler(true)} onMouseLeave={() => setRevealSpoiler(false)}>
          <p className={`text-xs leading-relaxed text-base-content/70 line-clamp-3 transition-all duration-300 ${isSpoilery && !revealSpoiler ? 'blur-sm select-none' : ''}`}>{episode.overview || 'No transmission data.'}</p>
          {isSpoilery && !revealSpoiler && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><span className="bg-base-300/80 backdrop-blur-md px-2 py-1 text-[9px] font-mono font-bold uppercase tracking-widest text-base-content/80 flex items-center gap-1 border border-base-content/10 shadow-lg"><EyeOff className="w-3 h-3" /> Hover to Reveal</span></div>}
        </div>
      </div>
    </div>
  );
};

export const SectionWrapper = ({ children, className = "" }) => <div className={`mt-3 border-t border-base-300 pt-3 ${className}`}>{children}</div>;
export const MediaCardSkeleton = () => <div className="flex flex-col gap-2 animate-pulse h-full border border-base-300 bg-base-100 p-3"><div className="aspect-[2/3] w-full bg-base-300 border border-base-300"></div><div className="h-3 bg-base-300 w-3/4 mt-2"></div><div className="h-2 bg-base-300 w-1/2 mt-1"></div></div>;
export const TextBlockSkeleton = () => <div className="flex flex-col gap-2 animate-pulse w-full mt-2"><div className="h-3 bg-base-300 w-full"></div><div className="h-3 bg-base-300 w-11/12"></div><div className="h-3 bg-base-300 w-4/5"></div><div className="h-3 bg-base-300 w-full"></div><div className="h-3 bg-base-300 w-3/4"></div></div>;
export const PillSkeleton = () => <div className="flex flex-wrap gap-2 animate-pulse mt-2"><div className="h-6 w-16 bg-base-300"></div><div className="h-6 w-24 bg-base-300"></div><div className="h-6 w-20 bg-base-300"></div></div>;
export const IssueCardSkeleton = () => <div className="flex flex-col border border-base-300 bg-base-100 animate-pulse h-full"><div className="aspect-[2/3] w-full bg-base-300"></div><div className="p-2 flex flex-col items-center justify-center gap-2 mt-1"><div className="h-3 bg-base-300 w-1/2"></div><div className="h-2 bg-base-300 w-1/3"></div></div></div>;
export const GallerySkeleton = ({ type }) => <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-2 w-full animate-pulse">{[1, 2, 3, 4].map(i => <div key={i} className={`${type === 'comics' ? 'aspect-[2/3]' : 'aspect-video'} bg-base-300 border border-base-300 w-full`}></div>)}</div>;
export const Section = ({ title, children, isLoading }) => {
  if (isLoading) return <div className="flex flex-col gap-2 mt-1"><div className="h-3 w-20 bg-base-300 animate-pulse border-b border-base-300 pb-0.5 mb-1"></div><PillSkeleton /></div>;
  if (!children || (Array.isArray(children) && children.every(c => !c)) || children.length === 0) return null;
  return <div className="flex flex-col gap-2 mt-1"><span className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-widest border-b border-base-300 pb-0.5">{title}</span><div className="flex flex-wrap gap-2">{children}</div></div>;
};

export const Pill = ({ main, sub, normalText = false }) => (
  <div className="text-[10px] font-mono bg-base-200 px-2 py-1 border border-base-300 inline-flex items-center">
    <span className={`${normalText ? 'font-normal text-base-content/80' : 'font-bold text-base-content/90'}`}>{main}</span>
    {sub && <span className="text-base-content/50 ml-1">({sub})</span>}
  </div>
);
export const Tag = ({ text, isBg }) => (
  <div className={`text-[10px] font-mono px-2 py-1 border border-base-300 inline-flex ${isBg ? 'bg-base-200' : ''}`}>
    <span className="font-bold text-base-content/90 uppercase tracking-widest">{text}</span>
  </div>
);
export const MetaItem = ({ label, value }) => value ? <span><span className="font-bold text-base-content">{label}:</span> {value}</span> : null;

export const CreativeTeamSection = ({ type, raw, isDeepFetching, genres, platforms }) => {
  const crew = raw.credits?.crew || [];
  const directors = crew.filter(c => c.job === 'Director').slice(0, 3);
  const writers = crew.filter(c => ['Writer', 'Screenplay', 'Story', 'Author'].includes(c.job)).slice(0, 4);
  const creators = type === 'tv' ? (raw.created_by || []).slice(0, 3) : crew.filter(c => c.job === 'Creator').slice(0, 2);
  const cast = raw.credits?.cast || [];

  const animeStaff = raw.staff?.edges || [];
  const animeDirectors = Array.from(new Set(animeStaff.filter(e => ['director', 'chief director', 'series director'].includes(e.role?.toLowerCase().trim())).map(e => e.node.name.full)));
  const animeOriginalCreators = Array.from(new Set(animeStaff.filter(e => ['original creator', 'original story', 'original concept', 'story'].some(r => e.role?.toLowerCase().trim().includes(r))).map(e => e.node.name.full)));

  const mangaStaff = raw.staff?.edges || [];
  const mangakaStory = mangaStaff.filter(e => e.role === 'Story' || e.role === 'Original Story').map(e => e.node.name.full);
  const mangakaArt = mangaStaff.filter(e => e.role === 'Art' || e.role === 'Illustration').map(e => e.node.name.full);
  const combinedRoles = mangaStaff.filter(e => e.role === 'Story & Art').map(e => e.node.name.full);

  return (
    <SectionWrapper>
      <div className="flex flex-col gap-3">
        {(type === 'movies' || type === 'tv') && (
          <>
            <div className="flex flex-row flex-wrap gap-x-8 gap-y-2">
              <Section isLoading={isDeepFetching && !directors.length} title="Director">{directors.map(c => <Pill key={c.id} main={c.name} />)}</Section>
              <Section isLoading={isDeepFetching && !creators.length} title="Creator">{creators.map(c => <Pill key={c.id} main={c.name} />)}</Section>
              <Section isLoading={isDeepFetching && !writers.length} title="Writer">{writers.map(c => <Pill key={c.id} main={c.name} />)}</Section>
            </div>
            <Section isLoading={isDeepFetching && !cast.length} title="Primary Cast">{cast.slice(0, 12).map(c => <Pill key={c.id} main={c.name} sub={c.character} />)}</Section>
          </>
        )}
        {type === 'anime' && (
          <div className="flex flex-row flex-wrap gap-x-8 gap-y-2">
            <Section isLoading={isDeepFetching && !animeDirectors.length} title="Director">{animeDirectors.map((n) => <Pill key={n} main={n} />)}</Section>
            <Section isLoading={isDeepFetching && !animeOriginalCreators.length} title="Original Creator">{animeOriginalCreators.map((n) => <Pill key={n} main={n} />)}</Section>
          </div>
        )}
        {type === 'manga' && mangaStaff.length > 0 && (
          <Section isLoading={isDeepFetching && !combinedRoles.length && !mangakaStory.length && !mangakaArt.length} title="Mangaka">
            {combinedRoles.map((n) => <Pill key={`c-${n}`} main={n} sub="Story & Art" />)}
            {mangakaStory.map((n) => <Pill key={`s-${n}`} main={n} sub="Story" />)}
            {mangakaArt.map((n) => <Pill key={`a-${n}`} main={n} sub="Art" />)}
          </Section>
        )}
        {type === 'comics' && (
          <div className="flex flex-row flex-wrap gap-x-8 gap-y-2">
            <Section isLoading={isDeepFetching && !(raw.staff?.Writer?.length)} title="Writer">{(raw.staff?.Writer || []).map((name) => <Pill key={`w-${name}`} main={name} normalText />)}</Section>
            <Section isLoading={isDeepFetching && !(raw.staff?.Penciller?.length)} title="Penciller">{(raw.staff?.Penciller || []).map((name) => <Pill key={`p-${name}`} main={name} normalText />)}</Section>
            <Section isLoading={isDeepFetching && !(raw.staff?.Artist?.length)} title="Artist">{(raw.staff?.Artist || []).map((name) => <Pill key={`a-${name}`} main={name} normalText />)}</Section>
            <Section isLoading={isDeepFetching && !(raw.staff?.Inker?.length)} title="Inker">{(raw.staff?.Inker || []).map((name) => <Pill key={`ink-${name}`} main={name} normalText />)}</Section>
            <Section isLoading={isDeepFetching && !(raw.staff?.Colorist?.length)} title="Colorist">{(raw.staff?.Colorist || []).map((name) => <Pill key={`col-${name}`} main={name} normalText />)}</Section>
            <Section isLoading={isDeepFetching && !(raw.staff?.Letterer?.length)} title="Letterer">{(raw.staff?.Letterer || []).map((name) => <Pill key={`let-${name}`} main={name} normalText />)}</Section>
            <Section isLoading={isDeepFetching && !(raw.staff?.Editor?.length)} title="Editor">{(raw.staff?.Editor || []).map((name) => <Pill key={`ed-${name}`} main={name} normalText />)}</Section>
            <Section isLoading={isDeepFetching && !(raw.staff?.["Cover Artist"]?.length)} title="Cover Artist">{(raw.staff?.["Cover Artist"] || []).map((name) => <Pill key={`cov-${name}`} main={name} normalText />)}</Section>
          </div>
        )}
        {type === 'books' && <Section isLoading={isDeepFetching && !(raw.subjects?.length)} title="Subjects">{(raw.subjects || []).map((g) => <Tag key={`subj-${g}`} text={g} />)}</Section>}
        {type !== 'books' && type !== 'comics' && <Section isLoading={isDeepFetching && !genres.length} title="Genres & Categories">{genres.map((g) => <Tag key={g.name || g} text={g.name || g} />)}</Section>}
        <Section isLoading={isDeepFetching && !platforms.length} title="Available Platforms">{platforms.map((p) => <Tag key={p} text={p} isBg />)}</Section>
      </div>
    </SectionWrapper>
  );
};

export const UserActivitySection = ({ logs }) => {
  const { openDiaryModal } = useMediaStore();

  // STRICT FILTER: SCRUB EMPTY LOGS FROM VIEW
  const logsWithNotes = logs?.filter(log => log.review_text && log.review_text.trim() !== '') || [];

  if (logsWithNotes.length === 0) return null;

  const getLogLabel = (log) => {
    if (log.media_type === 'tv' && (log.season_label || log.season_name)) return log.season_label || log.season_name;
    return null;
  };

  return (
    <SectionWrapper>
      <div className="flex flex-col gap-3">
        <span className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-widest border-b border-base-300 pb-0.5 mb-1">
          Review Notes
        </span>
        <div className="flex flex-col gap-3">
          {logsWithNotes.map((log) => (
            <div key={log.log_id} className="flex flex-col bg-base-200/50 border border-base-300 p-3 rounded-none relative group">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="badge badge-primary badge-outline text-[9px] font-mono font-bold uppercase rounded-none tracking-widest bg-primary/5">
                    {log.action_type || 'LOGGED'}
                  </span>
                  {getLogLabel(log) && (
                    <span className="text-[9px] font-mono font-bold text-base-content/70 uppercase border border-base-300 px-1.5 py-0.5 bg-base-100">
                      {getLogLabel(log)}
                    </span>
                  )}
                  <span className="text-[9px] font-mono font-bold text-base-content/40 uppercase tracking-widest">
                    {formatFancyDate(log.log_date)}
                  </span>
                </div>
                {/* Clicking Edit opens modal safely */}
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openDiaryModal({ targetItem: log.mediaItem, type: log.media_type, targetStatus: log.mediaItem?.status, isPreview: false, explicitAction: 'NOTE ADDED', apiData: log.mediaItem?.apiData })} className="btn btn-xs btn-square btn-ghost rounded-none shrink-0 text-base-content/50 hover:text-primary"><Edit3 className="w-4 h-4 sm:w-3 sm:h-3" /></button>
                </div>
              </div>
              <p className="text-xs font-sans leading-relaxed text-base-content/80 whitespace-pre-wrap border-l border-primary/20 pl-3">
                {log.review_text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </SectionWrapper>
  );
};

export const GalleryAndLinks = ({ type, title, raw, apiData, isDeepFetching, thumbnails, originals, navigate }) => {
  const { setGlobalLightbox } = useMediaStore();
  const [galleryCount, setGalleryCount] = useState(4);
  const displayedThumbnails = thumbnails.slice(0, galleryCount);

  const renderExternalLinks = () => {
    const links = [];
    if (raw.homepage) links.push({ name: 'Official Website', url: raw.homepage });
    if (raw.website) links.push({ name: 'Official Website', url: raw.website });
    if (type === 'anime' || type === 'manga') raw.externalLinks?.forEach(link => { if (!['Twitter', 'Reddit', 'Instagram'].includes(link.site)) links.push({ name: link.site, url: link.url }); });
    if (type === 'movies' || type === 'tv') { const providers = raw['watch/providers']?.results?.US || raw['watch/providers']?.results?.GB || Object.values(raw['watch/providers']?.results || {})[0]; if (providers?.link) links.push({ name: 'Where to Watch', url: providers.link }); }
    if (type === 'games' && raw.websites) { const catMap = { 1: 'Official Website', 4: 'Facebook', 5: 'Twitter', 6: 'Twitch', 8: 'Instagram', 9: 'YouTube', 10: 'App Store', 12: 'Google Play', 13: 'Steam', 14: 'Subreddit', 15: 'Itch.io', 16: 'Epic Games', 17: 'GOG', 18: 'Discord' }; raw.websites.forEach(w => { const siteType = w.type ?? w.category; if (siteType && catMap[siteType]) links.push({ name: catMap[siteType], url: w.url }); }); }
    if (type === 'vn') raw.extlinks?.forEach(l => { if (l.url && l.label) links.push({ name: l.label, url: l.url }); });
    if (apiData?.url) { const dbNames = { tv: 'TMDB', movies: 'TMDB', games: 'IGDB', anime: 'AniList', manga: 'AniList', vn: 'VNDB', books: 'OpenLibrary', comics: 'Metron' }; links.push({ name: `${dbNames[type] || 'Database'} Link`, url: apiData.url }); }
    if (type === 'books') { if (raw.amazon) links.push({ name: 'Amazon', url: `https://www.amazon.com/dp/${raw.amazon}` }); if (raw.goodreads) links.push({ name: 'Goodreads', url: `https://www.goodreads.com/book/show/${raw.goodreads}` }); if (raw.librarything) links.push({ name: 'LibraryThing', url: `https://www.librarything.com/work/${raw.librarything}` }); if (raw.links && Array.isArray(raw.links)) raw.links.forEach(link => links.push({ name: link.title || link.name || 'View/Buy', url: link.url })); }
    if (links.length === 0 && type !== 'books') { const action = ['movies','tv','anime'].includes(type) ? 'Watch' : ['manga','comics','books'].includes(type) ? 'Read' : 'Play / Buy'; links.push({ name: `Search Where to ${action}`, url: `https://www.google.com/search?q=where+to+${action.split(' ')[0].toLowerCase()}+${encodeURIComponent(title)}` }); }
    return Array.from(new Map(links.map(l => [l.url, l])).values()).slice(0, 10).map((l, i) => (<a key={i} href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-base-200 border border-base-300 px-3 py-1.5 text-[9px] font-mono font-bold uppercase tracking-widest text-base-content/80 hover:border-primary hover:text-primary transition-colors">{l.name} <ExternalLink className="w-3 h-3" /></a>));
  };

  return (
    <>
      {thumbnails.length > 0 && (
        <SectionWrapper>
          <div className="flex flex-col gap-3">
            <span className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-widest pb-0.5">Media Gallery</span>
            {isDeepFetching && thumbnails.length === 0 ? <GallerySkeleton type={type} /> : (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {displayedThumbnails.map((thumb, i) => (
                    <div key={i} onClick={() => setGlobalLightbox(originals, i)} className={`overflow-hidden border border-base-300 group cursor-pointer relative bg-base-300 ${type === 'comics' ? 'aspect-[2/3]' : 'aspect-video'}`}>
                       <ImageWithFallback src={thumb} alt="Gallery item" className="grayscale-[20%] group-hover:grayscale-0 object-cover w-full h-full" />
                       <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><span className="bg-base-100/80 px-2 py-1 text-[8px] font-mono font-bold uppercase tracking-widest text-primary border border-primary/20">Expand</span></div>
                    </div>
                  ))}
                </div>
                {thumbnails.length > 4 && (
                  <div className="flex gap-2">
                    {galleryCount < thumbnails.length && (<button onClick={() => setGalleryCount(prev => Math.min(prev + 8, thumbnails.length))} className="btn btn-xs rounded-none bg-base-200 border-base-300 hover:border-primary hover:text-primary font-mono text-[9px] uppercase tracking-widest text-base-content/70 min-h-[44px] sm:min-h-0">+{thumbnails.length - galleryCount} More</button>)}
                    {galleryCount > 4 && (<button onClick={() => setGalleryCount(4)} className="btn btn-xs rounded-none bg-base-200 border-base-300 hover:border-primary hover:text-primary font-mono text-[9px] uppercase tracking-widest text-base-content/70 min-h-[44px] sm:min-h-0">Show Less</button>)}
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionWrapper>
      )}
      <SectionWrapper>
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-widest pb-0.5">Availability & Links</span>
          {isDeepFetching && renderExternalLinks().length === 0 ? <PillSkeleton /> : (<div className="flex flex-wrap gap-2">{renderExternalLinks()}</div>)}
        </div>
      </SectionWrapper>
    </>
  );
};

export const ComicIssueModal = ({ isOpen, onClose, issue, details, isLoading, isRead, isPreview, onToggleRead, allIssues, onNavigatePrev, onNavigateNext, hasPrev, hasNext }) => {
  const { setGlobalLightbox } = useMediaStore();
  if (!isOpen || !issue) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[99999] bg-black/80 flex flex-col items-center justify-center p-0 sm:p-4 backdrop-blur-sm transition-opacity" onClick={onClose}>
        <div className="bg-base-100 sm:border border-base-300 sm:shadow-2xl max-w-5xl w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200 overflow-hidden" onClick={e => e.stopPropagation()}>
          
          <div className="flex justify-between items-center p-3 border-b border-base-300 bg-base-200/50 shrink-0 z-20">
            <div className="w-8 shrink-0"></div>

            <div className="flex-1 flex flex-row items-center justify-center gap-4 min-w-0">
              <button onClick={onNavigatePrev} disabled={!hasPrev} className="flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 rounded-full bg-transparent hover:bg-base-300 text-base-content/70 disabled:opacity-20 disabled:cursor-not-allowed appearance-none transition-colors shrink-0">
                <ChevronLeft className="w-5 h-5 text-base-content/70" />
              </button>
              
              <div className="flex flex-col items-center justify-center text-center min-w-0 px-2">
                <h3 className="text-sm sm:text-base font-black uppercase tracking-widest font-sans text-primary truncate">Issue #{issue.number}</h3>
                <p className="text-[10px] font-mono text-base-content/50 uppercase tracking-widest mt-0.5 truncate">{formatFancyDate(issue.cover_date)}</p>
              </div>

              <button onClick={onNavigateNext} disabled={!hasNext} className="flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 rounded-full bg-transparent hover:bg-base-300 text-base-content/70 disabled:opacity-20 disabled:cursor-not-allowed appearance-none transition-colors shrink-0">
                <ChevronRight className="w-5 h-5 text-base-content/70" />
              </button>
            </div>

            <button onClick={onClose} className="flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 ml-2 rounded-none bg-transparent hover:bg-error/10 text-base-content/50 hover:text-error appearance-none transition-colors shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row flex-1 overflow-y-auto sm:overflow-hidden relative">
            <div className="w-full sm:w-1/3 sm:border-r border-base-300 bg-base-200/30 p-4 sm:p-6 shrink-0 relative flex flex-col gap-4">
              <div className="flex flex-row sm:flex-col gap-4 sm:sticky sm:top-0 w-full xl:w-4/5 sm:mx-auto">
                <div className="w-1/3 sm:w-full shrink-0 flex flex-col gap-4">
                  {issue.image ? (
                    <div className="aspect-[2/3] w-full border border-base-300 overflow-hidden bg-base-300 shadow-xl">
                      <img key={issue.id} src={`https://wsrv.nl/?url=${encodeURIComponent(issue.image)}&w=400&output=webp`} alt={`Issue ${issue.number}`} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="aspect-[2/3] w-full border border-base-300 bg-base-300 flex items-center justify-center text-[10px] font-mono text-base-content/30 shadow-xl">NO IMG</div>
                  )}
                  <button
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      const trackableIds = allIssues.filter(i => {
                        const num = parseFloat(i.number);
                        return i.id === issue.id || (!isNaN(num) && num > 0);
                      }).map(i => i.id);
                      onToggleRead(issue.id, trackableIds); 
                    }}
                    disabled={isPreview}
                    className={`hidden sm:flex items-center justify-center w-full h-12 rounded-none appearance-none font-mono text-xs uppercase tracking-widest shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isRead ? 'bg-success hover:bg-success/90 text-success-content' : 'bg-primary hover:bg-primary/90 text-primary-content'}`}
                  >
                    {isRead ? '✓ Marked as Read' : 'Mark as Read'}
                  </button>
                </div>

                <div className="flex-1 flex flex-col sm:hidden min-w-0">
                  {details?.credits?.length > 0 && (
                    <div className="flex flex-col min-w-0">
                      <h4 className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-widest mb-2 border-b border-base-300 pb-1">Creative Team</h4>
                      <div className="flex flex-wrap gap-1.5 max-h-[200px] overflow-y-auto custom-scrollbar">
                        {details.credits.map((c, i) => (
                          <div key={i} className="text-[9px] font-mono bg-base-100 px-1.5 py-1 border border-base-300 w-full truncate">
                            <span className="font-bold text-base-content/90">{c.creator?.name || c.creator}</span>
                            <span className="text-base-content/50 ml-1">({Array.isArray(c.role) ? c.role.map(r => r.name || r).join(', ') : c.role?.name || c.role})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={(e) => { 
                  e.stopPropagation(); 
                  const trackableIds = allIssues.filter(i => {
                    const num = parseFloat(i.number);
                    return i.id === issue.id || (!isNaN(num) && num > 0);
                  }).map(i => i.id);
                  onToggleRead(issue.id, trackableIds); 
                }}
                disabled={isPreview}
                className={`flex sm:hidden items-center justify-center w-full h-12 rounded-none appearance-none font-mono text-xs uppercase tracking-widest shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isRead ? 'bg-success hover:bg-success/90 text-success-content' : 'bg-primary hover:bg-primary/90 text-primary-content'}`}
              >
                {isRead ? '✓ Marked as Read' : 'Mark as Read'}
              </button>
            </div>

            <div className="w-full sm:w-2/3 p-4 sm:p-6 flex-1 sm:overflow-y-auto custom-scrollbar flex flex-col gap-6">
              {isLoading ? (
                <div className="flex flex-col gap-6 w-full animate-pulse mt-2">
                  <div><div className="h-3 w-24 bg-base-300 mb-3"></div><div className="flex gap-2"><div className="h-6 w-20 bg-base-300"></div><div className="h-6 w-24 bg-base-300"></div><div className="h-6 w-16 bg-base-300"></div></div></div>
                  <div><div className="h-3 w-24 bg-base-300 mb-3 mt-2"></div><div className="flex flex-col gap-2"><div className="h-3 w-full bg-base-300"></div><div className="h-3 w-5/6 bg-base-300"></div><div className="h-3 w-4/5 bg-base-300"></div><div className="h-3 w-full bg-base-300"></div></div></div>
                </div>
              ) : details ? (
                <>
                  {details.credits?.length > 0 && (
                    <div className="hidden sm:block">
                      <h4 className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-widest mb-3 border-b border-base-300 pb-1">Creative Team</h4>
                      <div className="flex flex-wrap gap-2">
                        {details.credits.map((c, i) => (
                          <div key={i} className="text-[10px] font-mono bg-base-200 px-2 py-1 border border-base-300">
                            <span className="font-bold text-base-content/90">{c.creator?.name || c.creator}</span>
                            <span className="text-base-content/50 ml-1">({Array.isArray(c.role) ? c.role.map(r => r.name || r).join(', ') : c.role?.name || c.role})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {details.desc && (
                    <div>
                      <h4 className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-widest mb-3 border-b border-base-300 pb-1">Description</h4>
                      <p className="text-sm leading-relaxed text-base-content/80 whitespace-pre-wrap font-sans">{details.desc}</p>
                    </div>
                  )}

                  {details.variants?.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-widest mb-3 border-b border-base-300 pb-1">Variant Covers ({details.variants.length})</h4>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                        {details.variants.map((v, i) => (
                          <div key={i} onClick={(e) => { e.stopPropagation(); setGlobalLightbox(details.variants.map(va => va.image), i); }} className="aspect-[2/3] border border-base-300 overflow-hidden hover:border-primary transition-colors cursor-pointer bg-base-300 relative group">
                            {v.image ? (
                              <><img src={`https://wsrv.nl/?url=${encodeURIComponent(v.image)}&w=150&output=webp`} className="w-full h-full object-cover" /><div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" /></>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[8px] font-mono text-base-content/30">NO IMG</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center text-base-content/50 font-mono text-xs uppercase p-6">No details available</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};

export const ComicIssuesSection = ({ seriesId, storeItem, isPreview, rawIssues, totalIssuesCount, readIssueIds, onToggleRead }) => {
  const [allIssues, setAllIssues] = useState(rawIssues || []);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [issueDetailData, setIssueDetailData] = useState(null);
  const [loadingIssueDetail, setLoadingIssueDetail] = useState(false);
  const [showAllLocal, setShowAllLocal] = useState(false);

  useEffect(() => {
    if (rawIssues?.length) { setAllIssues(rawIssues); setCurrentPage(1); setTotalCount(totalIssuesCount || rawIssues.length); }
  }, [rawIssues, totalIssuesCount]);

  const loadMore = async () => {
    if (loadingMore) return; setLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const result = await apiRegistry.getComicSeriesIssues(seriesId, nextPage);
      if (result.issues.length) { setAllIssues(prev => [...prev, ...result.issues]); setCurrentPage(nextPage); setTotalCount(result.totalCount || totalCount); }
    } catch (e) { console.error('Failed to load more issues', e); }
    setLoadingMore(false);
  };

  const handleIssueClick = async (issue) => {
    const drawer = document.getElementById('main-drawer');
    if (drawer && drawer.checked) drawer.checked = false;
    
    setSelectedIssue(issue); setLoadingIssueDetail(true); setIssueDetailData(null);
    try { setIssueDetailData(await apiRegistry.getComicIssueDetails(issue.id)); } catch (e) { console.error(e); }
    setLoadingIssueDetail(false);
  };

  if (!allIssues.length) return null;
  const readIds = readIssueIds || [];
  const sortedIssues = [...allIssues].sort((a, b) => {
    const aNum = parseFloat(a.number); const bNum = parseFloat(b.number);
    const aVal = isNaN(aNum) ? 9999 : aNum; const bVal = isNaN(bNum) ? 9999 : bNum;
    if (aVal !== bVal) return aVal - bVal;
    return (a.cover_date || '').localeCompare(b.cover_date || '');
  });

  const DISPLAY_LIMIT = 12;
  const displayedIssues = showAllLocal ? sortedIssues : sortedIssues.slice(0, DISPLAY_LIMIT);

  const currentModalIndex = sortedIssues.findIndex(i => i.id === selectedIssue?.id);
  const hasPrev = currentModalIndex > 0;
  const hasNext = currentModalIndex !== -1 && currentModalIndex < sortedIssues.length - 1;

  return (
    <>
      <SectionWrapper>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between"><span className="text-[10px] font-mono font-bold text-base-content/40 uppercase tracking-widest border-b border-base-300 pb-0.5 mb-1 w-full">Issues ({readIds.length}/{totalCount > 0 ? totalCount : allIssues.length} read)</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 content-start" style={{ gridAutoRows: 'min-content' }}>
            {displayedIssues.map(issue => {
              const isRead = readIds.includes(issue.id);
              return (
                <div key={issue.id} onClick={() => handleIssueClick(issue)} className="bg-base-100 border border-base-300 hover:border-primary transition-colors cursor-pointer group overflow-hidden flex flex-col">
                  <div className={`aspect-[2/3] w-full bg-base-200 overflow-hidden relative ${isRead ? 'grayscale opacity-70' : ''}`}>
                    {issue.image ? <img src={`https://wsrv.nl/?url=${encodeURIComponent(issue.image)}&w=200&output=webp`} alt={`Issue ${issue.number}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" /> : <div className="w-full h-full flex items-center justify-center text-[8px] font-mono text-base-content/30 uppercase">NO IMG</div>}
                    {isRead && <div className="absolute top-0 right-0 bg-success text-success-content px-1 py-0.5 text-[8px] font-mono font-bold">READ</div>}
                  </div>
                  <div className="p-2 text-center"><span className="text-xs font-bold uppercase tracking-wider font-sans">#{issue.number}</span><p className="text-[9px] font-mono text-base-content/50 mt-0.5 truncate">{formatFancyDate(issue.cover_date)}</p></div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mt-2">
            {!showAllLocal && sortedIssues.length > DISPLAY_LIMIT && (
              <button onClick={() => setShowAllLocal(true)} className="flex items-center justify-center h-11 sm:h-8 px-3 w-full bg-base-200 border border-base-300 hover:border-primary hover:text-primary text-base-content/70 rounded-none appearance-none font-mono text-[9px] uppercase tracking-widest transition-colors">
                Show All {sortedIssues.length} Fetched Issues
              </button>
            )}
            {(showAllLocal || sortedIssues.length <= DISPLAY_LIMIT) && allIssues.length < totalCount && (
              <button onClick={loadMore} disabled={loadingMore} className="flex items-center justify-center h-11 sm:h-8 px-3 w-full bg-base-200 border border-base-300 hover:border-primary hover:text-primary text-base-content/70 rounded-none appearance-none font-mono text-[9px] uppercase tracking-widest transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {loadingMore ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null} Load Remaining {totalCount - allIssues.length} Issues from Database
              </button>
            )}
          </div>
        </div>
      </SectionWrapper>
      <ComicIssueModal 
        isOpen={!!selectedIssue} issue={selectedIssue} details={issueDetailData} isLoading={loadingIssueDetail}
        isRead={readIds.includes(selectedIssue?.id)} isPreview={isPreview} onToggleRead={onToggleRead} allIssues={sortedIssues}
        onClose={() => { setSelectedIssue(null); setIssueDetailData(null); }}
        onNavigatePrev={() => hasPrev && handleIssueClick(sortedIssues[currentModalIndex - 1])}
        onNavigateNext={() => hasNext && handleIssueClick(sortedIssues[currentModalIndex + 1])}
        hasPrev={hasPrev} hasNext={hasNext}
      />
    </>
  );
};