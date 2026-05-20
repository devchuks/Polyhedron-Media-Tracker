import React, { useMemo, useState, useEffect } from 'react';
import { useMediaStore } from '../store/useMediaStore';
import { ImageWithFallback, getMediaTypeColors, formatFancyDate, resolveMediaImage } from '../components/UI';
import { Link } from 'react-router-dom';
import { Clock, Trash2, Edit3, Save, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

const ExpandableReview = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  
  const charLimit = 200;
  const isLong = text.length > charLimit;
  
  return (
    <div className="mt-2 text-xs sm:text-[13px] lg:text-sm font-sans italic font-light text-base-content/70 leading-relaxed whitespace-pre-wrap">
      “{expanded || !isLong ? text : text.substring(0, charLimit).trim() + '...'}”
      {isLong && (
        <button 
          onClick={(e) => { e.preventDefault(); setExpanded(!expanded); }} 
          className="ml-2 font-sans text-[10px] font-bold uppercase tracking-widest text-primary hover:opacity-70 inline-block not-italic"
        >
          {expanded ? 'Show Less' : 'See More'}
        </button>
      )}
    </div>
  );
};

export const Diary = () => {
  const { mediaLogs, media, removeDiaryLog, removeMediaItem, updateDiaryLog } = useMediaStore();
  const isLoading = useMediaStore((state) => state.isLoading);
  const [editingId, setEditingId] = useState(null);
  const [editDate, setEditDate] = useState('');
  const [editNote, setEditNote] = useState('');

  const ITEMS_PER_PAGE = 30;
  const [currentPage, setCurrentPage] = useState(1);
  const [isJumping, setIsJumping] = useState(false);

  useEffect(() => {
    if (!isJumping) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPage, isJumping]);

  const enrichedLogs = useMemo(() => {
    const allMedia = Object.values(media).flat();
    return mediaLogs.map(log => {
      const mediaItem = allMedia.find(m => String(m.id) === String(log.media_id));
      return { ...log, mediaItem };
    }).filter(log => log.mediaItem);
  }, [mediaLogs, media]);

  const totalPages = Math.ceil(enrichedLogs.length / ITEMS_PER_PAGE) || 1;

  const monthOptions = useMemo(() => {
    const options = [];
    const seen = new Set();
    enrichedLogs.forEach((log, index) => {
      const d = new Date(log.log_date);
      const m = d.toLocaleString('default', { month: 'long', year: 'numeric' });
      if (!seen.has(m)) {
        seen.add(m);
        options.push({ label: m, targetPage: Math.floor(index / ITEMS_PER_PAGE) + 1, id: m.replace(/\s+/g, '-') });
      }
    });
    return options;
  }, [enrichedLogs]);

  const paginatedLogs = enrichedLogs.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const groupedLogs = useMemo(() => {
    const groups = {};
    paginatedLogs.forEach(log => {
      const date = new Date(log.log_date);
      const monthYear = date.toLocaleString('default', { month: 'long', year: 'numeric' });
      if (!groups[monthYear]) groups[monthYear] = [];
      groups[monthYear].push(log);
    });
    return groups;
  }, [paginatedLogs]);

  const groupKeys = Object.keys(groupedLogs);

  const handleJump = (e) => {
    if (!e.target.value) return;
    const [targetPage, targetId] = e.target.value.split('|');
    setIsJumping(true); 
    setCurrentPage(parseInt(targetPage, 10));
    
    // Wait for React to render the new page's DOM before calculating the jump
    setTimeout(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(targetId);
        if (el) {
          const y = el.getBoundingClientRect().top + window.scrollY - 80; 
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
        setTimeout(() => setIsJumping(false), 500);
      });
    }, 100);
    e.target.value = ''; 
  };

  const handleDeleteLog = (log) => {
    if (window.confirm(`Permanently delete ${log.mediaItem.title} from your diary and library?`)) {
      removeMediaItem(log.media_id, log.media_type);
      if (paginatedLogs.length === 1 && currentPage > 1) setCurrentPage(prev => prev - 1);
    }
  };

  const startEdit = (log) => {
    setEditingId(log.log_id);
    setEditDate(new Date(log.log_date).toISOString().split('T')[0]);
    setEditNote(log.review_text || '');
  };

  const saveEdit = () => {
    updateDiaryLog(editingId, { log_date: new Date(editDate).toISOString(), review_text: editNote });
    setEditingId(null);
  };

  const getLogLabel = (log) => {
    if (log.media_type === 'tv' && (log.season_label || log.season_name)) return log.season_label || log.season_name;
    return null;
  };

  return (
    <div className="flex flex-col gap-2 sm:gap-4 animate-in fade-in duration-300 pb-10 min-h-screen">
      {monthOptions.length > 0 && (
        <div className="sticky top-[72px] z-30 w-full flex justify-end h-0 pointer-events-none">
          <select onChange={handleJump} className="select select-sm h-8 min-h-[2rem] w-full max-w-[160px] sm:max-w-xs rounded-none border border-base-300 bg-base-100 hover:bg-base-200 hover:border-primary text-[10px] font-mono uppercase font-bold tracking-widest m-0 px-2 sm:px-3 pointer-events-auto shadow-sm mt-1 sm:mt-2 focus:outline-none">
            <option value="">Jump to Month...</option>
            {monthOptions.map(o => (<option key={o.label} value={`${o.targetPage}|${o.id}`}>{o.label}</option>))}
          </select>
        </div>
      )}
      <header className="border-b border-base-300 pb-3 flex flex-row items-center sm:items-end justify-between gap-3 relative z-20">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-widest font-sans truncate">Diary</h1>
          <p className="text-[10px] font-mono text-base-content/50 uppercase tracking-widest mt-0.5 truncate">
            {mediaLogs.length} entries
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="w-full bg-base-100 border border-base-300 p-8 flex items-center justify-center text-[10px] font-mono text-base-content/50 uppercase tracking-widest gap-2 rounded-none">
          <Loader2 className="w-4 h-4 animate-spin text-primary" /> Loading...
        </div>
      ) : groupKeys.length === 0 ? (
        <div className="w-full bg-base-100 border border-base-300 p-8 flex items-center justify-center text-[10px] font-mono text-base-content/40 uppercase tracking-widest rounded-none">No records found.</div>
      ) : (
        <div className="flex flex-col">
          {groupKeys.map((month, mIdx) => (
            <section key={month} id={month.replace(/\s+/g, '-')} className="relative z-10 flex flex-col">
              
              <div className="flex items-center group/month py-2 sm:py-2.5 border-b border-base-300 bg-base-300/20">
                <div className="flex w-8 sm:w-12 shrink-0 relative h-8 sm:h-10 justify-center">
                  <div className={`absolute left-1/2 -translate-x-1/2 w-[2px] bg-base-300 ${mIdx === 0 ? 'top-1/2 bottom-0' : 'top-0 bottom-0'}`}></div>
                  <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 flex justify-center z-10">
                    <div className="absolute top-1/2 left-1/2 right-0 h-[2px] bg-base-300 -translate-y-1/2"></div>
                    <div className="w-3 h-3 sm:w-3.5 sm:h-3.5 bg-base-100 border-[3px] border-primary shadow-[0_0_12px_rgba(var(--p),0.2)] relative z-20"></div>
                  </div>
                </div>
                <div className="flex-1 pr-4 sm:pr-0">
                  <h2 className="inline-block text-[10px] sm:text-xs font-black uppercase tracking-[0.2em] font-sans text-primary bg-base-100 px-2 py-1 sm:px-3 sm:py-1.5 border border-base-300 shadow-sm">
                    {month}
                  </h2>
                </div>
              </div>

              <div className="flex flex-col">
                {groupedLogs[month].map((log, lIdx) => {
                  const isLastInMonth = lIdx === groupedLogs[month].length - 1;
                  const isLastOverall = isLastInMonth && mIdx === groupKeys.length - 1;
                  const optimizedImage = resolveMediaImage(log.mediaItem, log.media_type, 'md');
                  const typeColors = getMediaTypeColors(log.media_type);
                  
                  // FIX: Prioritize season year for diary, fallback to canonical series year
                  const year = log.season_year || log.mediaItem.apiData?.year || log.mediaItem.year || '----';

                  return (
                    <div key={log.log_id} className={`group flex items-stretch relative border-b border-base-300 bg-base-100 hover:bg-base-200 transition-colors ${isLastOverall ? 'border-none' : ''}`}>
                      
                      <div className="flex w-8 sm:w-12 shrink-0 relative justify-center">
                        <div className={`absolute left-1/2 -translate-x-1/2 top-0 w-[2px] bg-base-300 group-hover:bg-primary/50 transition-colors duration-300 ${isLastOverall ? 'h-[22px] sm:h-[24px]' : 'bottom-[-1px]'}`}></div>
                        <div className="absolute top-[22px] sm:top-[24px] left-0 right-0 flex justify-center z-10 -translate-y-1/2">
                          <div className="absolute top-1/2 left-1/2 right-0 h-[2px] bg-base-300 group-hover:bg-primary/50 transition-colors duration-300 -translate-y-1/2"></div>
                          <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-base-200 border-[2px] border-base-content/40 group-hover:border-primary group-hover:bg-base-100 group-hover:shadow-[0_0_8px_rgba(var(--p),0.3)] transition-all duration-300 relative z-20"></div>
                        </div>
                      </div>

                      <div className="flex-1 pr-2 sm:pr-4 min-w-0 py-2.5 sm:py-3">
                        <div className="flex items-stretch relative z-10 group/card w-full gap-3 sm:gap-4">
                          
                          <div className="w-16 sm:w-20 shrink-0 flex flex-col pt-0.5 sm:pt-0">
                            <Link to={`/media/${log.media_type}/${log.mediaItem.id}`} className="w-full aspect-[2/3] bg-base-300 overflow-hidden relative block border border-base-300 shadow-sm group-hover/card:border-primary/50 transition-colors">
                              <ImageWithFallback src={optimizedImage} alt={log.mediaItem.title} className="w-full h-full object-cover transition-transform duration-300 group-hover/card:scale-105" />
                            </Link>
                          </div>

                          <div className="flex flex-col flex-1 min-w-0 relative justify-center sm:justify-start">
                            {editingId === log.log_id ? (
                               <div className="flex flex-col gap-2 w-full z-10 bg-base-100 border border-primary/20 shadow-xl p-2 -mx-2 -my-2">
                                 <input type="date" className="input input-xs input-bordered rounded-none font-mono text-[10px] focus:outline-none focus:border-primary w-full bg-base-100" value={editDate} onChange={e => setEditDate(e.target.value)} />
                                 <textarea className="textarea textarea-bordered textarea-sm rounded-none font-sans min-h-[80px] focus:outline-none focus:border-primary bg-base-100" value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Add a note..."></textarea>
                                 <div className="flex gap-2 justify-end mt-1">
                                   <button onClick={() => setEditingId(null)} className="btn btn-xs btn-ghost rounded-none font-mono uppercase tracking-widest text-[9px]">Cancel</button>
                                   <button onClick={saveEdit} className="btn btn-xs btn-primary rounded-none font-mono uppercase tracking-widest text-[9px]"><Save className="w-3 h-3 mr-1"/> Save</button>
                                 </div>
                               </div>
                            ) : (
                              <>
                                <div className="flex items-start justify-between gap-1 sm:gap-2">
                                  <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-1 sm:gap-x-2">
                                    <Link to={`/media/${log.media_type}/${log.mediaItem.id}`} className="text-sm sm:text-base font-bold uppercase tracking-wide group-hover/card:text-primary transition-colors font-sans leading-tight">
                                      {log.mediaItem.title}
                                    </Link>
                                    <span className="font-mono text-[10px] text-base-content/50 tracking-widest font-bold">({year})</span>
                                  </div>
                                  
                                  <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover/card:opacity-100 transition-opacity shrink-0">
                                    <button onClick={() => startEdit(log)} className="btn btn-xs btn-ghost btn-square text-base-content/50 hover:text-primary rounded-none shrink-0"><Edit3 className="w-3.5 h-3.5" /></button>
                                    <button onClick={() => handleDeleteLog(log)} className="btn btn-xs btn-ghost btn-square text-error rounded-none shrink-0 ml-1"><Trash2 className="w-3.5 h-3.5" /></button>
                                  </div>
                                </div>
                                
                                {getLogLabel(log) && (
                                  <div className="text-[9px] sm:text-[10px] font-mono font-bold text-primary/80 uppercase tracking-widest mt-0.5 truncate">
                                    {getLogLabel(log)}
                                  </div>
                                )}

                                <div className="flex items-center gap-2 mt-1.5 text-[9px] sm:text-[10px] font-mono text-base-content/50 uppercase tracking-widest flex-wrap">
                                  <span className={`inline-flex items-center px-1.5 py-0.5 font-bold border border-transparent ${typeColors.bg} ${typeColors.textContent}`}>
                                    {log.media_type}
                                  </span>
                                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatFancyDate(log.log_date)}</span>
                                </div>

                                {log.review_text && <ExpandableReview text={log.review_text} />}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {!isLoading && totalPages > 1 && (
        <div className="flex justify-between items-center mt-4 pt-4 border-t border-base-300 relative z-20">
          <button disabled={currentPage === 1} onClick={() => { setCurrentPage(p => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="btn btn-sm btn-ghost rounded-none font-mono uppercase tracking-widest text-[10px]"><ChevronLeft className="w-4 h-4 mr-1" /> Prev</button>
          <span className="text-[10px] font-mono font-bold text-base-content/50 uppercase tracking-widest">Page {currentPage} of {totalPages}</span>
          <button disabled={currentPage === totalPages} onClick={() => { setCurrentPage(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="btn btn-sm btn-ghost rounded-none font-mono uppercase tracking-widest text-[10px]">Next <ChevronRight className="w-4 h-4 ml-1" /></button>
        </div>
      )}
    </div>
  );
};