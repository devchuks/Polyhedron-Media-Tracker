import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, Edit3, ListFilter, MoreHorizontal, Save, Search, Trash2, X } from 'lucide-react';
import { ImageWithFallback, UpdatingIndicator, getMediaTypeColors, resolveMediaImage } from '../components/UI';
import {
  DIARY_MEDIA_TYPES,
  diaryActivityOptions,
  diaryEntryRating,
  diarySeasonLabel,
  filterDiaryLogs,
  formatDiaryRating,
  groupDiaryLogsByDate,
} from '../domain/diary';
import { findMediaForLog } from '../domain/mediaState';
import { shouldShowBlockingSkeleton, shouldShowUpdatingIndicator } from '../domain/loadingState';
import { diaryActionsForMediaType } from '../domain/mediaTerminology';
import { useMediaStore } from '../store/useMediaStore';
import { dateInputFromTimestamp, timestampFromDateInput } from '../utils/calendarDate';

const ITEMS_PER_PAGE = 30;

const MEDIA_TYPE_LABELS = Object.freeze({
  movies: 'Movies',
  tv: 'TV',
  anime: 'Anime',
  manga: 'Manga',
  books: 'Books',
  comics: 'Comics',
  games: 'Games',
  vn: 'Visual Novels',
});

const ExpandableReview = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const charLimit = 220;
  const isLong = text.length > charLimit;
  const visibleText = expanded || !isLong ? text : `${text.substring(0, charLimit).trim()}…`;

  return (
    <div className="mt-2 max-w-3xl text-xs leading-relaxed text-base-content/65 sm:text-[13px]">
      <p className="whitespace-pre-wrap">{visibleText}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="mt-1 min-h-8 font-mono text-[9px] font-bold uppercase tracking-widest text-primary"
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
};

const DiaryEntryActions = ({ log, onEdit, onDelete }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = React.useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeFromOutside = event => {
      if (!menuRef.current?.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeFromOutside);
    return () => document.removeEventListener('pointerdown', closeFromOutside);
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen(open => !open)}
        onKeyDown={event => { if (event.key === 'Escape') setIsOpen(false); }}
        aria-label={`Actions for Diary entry ${log.mediaItem.title}`}
        aria-expanded={isOpen}
        className="flex h-9 w-9 items-center justify-center text-base-content/40 transition-colors hover:bg-base-200 hover:text-primary focus:bg-base-200 focus:text-primary"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {isOpen && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-36 border border-base-300 bg-base-100 p-1 shadow-xl">
          <button type="button" role="menuitem" onClick={() => { setIsOpen(false); onEdit(log); }} className="flex h-9 w-full items-center gap-2 px-2 font-mono text-[9px] font-bold uppercase tracking-widest hover:bg-base-200 hover:text-primary"><Edit3 className="h-3.5 w-3.5" /> Edit entry</button>
          <button type="button" role="menuitem" onClick={() => { setIsOpen(false); onDelete(log); }} className="flex h-9 w-full items-center gap-2 px-2 font-mono text-[9px] font-bold uppercase tracking-widest text-error hover:bg-error/10"><Trash2 className="h-3.5 w-3.5" /> Delete entry</button>
        </div>
      )}
    </div>
  );
};

const DiarySkeleton = () => (
  <div aria-label="Loading diary" className="animate-pulse">
    {Array.from({ length: 3 }, (_, dayIndex) => (
      <div key={dayIndex} className="grid grid-cols-[52px_minmax(0,1fr)] gap-3 border-b border-base-300 py-4 sm:grid-cols-[76px_minmax(0,1fr)] sm:gap-6">
        <div className="space-y-2 pt-1"><div className="h-3 w-9 bg-base-300" /><div className="h-8 w-10 bg-base-300" /></div>
        <div className="space-y-3">
          {Array.from({ length: 2 }, (_, rowIndex) => (
            <div key={rowIndex} className="flex gap-3 py-1">
              <div className="h-[72px] w-12 shrink-0 bg-base-300 sm:h-24 sm:w-16" />
              <div className="flex-1 space-y-2 pt-1"><div className="h-4 w-2/3 bg-base-300" /><div className="h-3 w-1/2 bg-base-300" /><div className="h-3 w-5/6 bg-base-300" /></div>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

export const Diary = () => {
  const { mediaLogs, media, removeDiaryLog, updateDiaryLog } = useMediaStore();
  const isLoading = useMediaStore(state => state.isLoading);
  const [mediaType, setMediaType] = useState('all');
  const [activity, setActivity] = useState('all');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDate, setEditDate] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editAction, setEditAction] = useState('LOGGED');
  const [currentPage, setCurrentPage] = useState(1);
  const [isJumping, setIsJumping] = useState(false);
  const [activeControl, setActiveControl] = useState(null);

  const enrichedLogs = useMemo(() => mediaLogs.map(log => ({
    ...log,
    mediaItem: findMediaForLog(media, log),
  })).filter(log => log.mediaItem), [mediaLogs, media]);

  const activityOptions = useMemo(() => diaryActivityOptions(enrichedLogs), [enrichedLogs]);
  const filteredLogs = useMemo(() => filterDiaryLogs(enrichedLogs, {
    mediaType,
    activity,
    query,
  }), [activity, enrichedLogs, mediaType, query]);

  const totalPages = Math.ceil(filteredLogs.length / ITEMS_PER_PAGE) || 1;
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const dateGroups = useMemo(() => groupDiaryLogsByDate(paginatedLogs), [paginatedLogs]);

  const monthOptions = useMemo(() => {
    const options = [];
    const seen = new Set();
    filteredLogs.forEach((log, index) => {
      const [group] = groupDiaryLogsByDate([log]);
      if (!group || seen.has(group.monthKey)) return;
      seen.add(group.monthKey);
      options.push({ key: group.monthKey, label: group.monthLabel, targetPage: Math.floor(index / ITEMS_PER_PAGE) + 1 });
    });
    return options;
  }, [filteredLogs]);

  const filtersActive = mediaType !== 'all' || activity !== 'all' || query.trim() !== '';

  useEffect(() => {
    setCurrentPage(1);
  }, [activity, mediaType, query]);

  useEffect(() => {
    if (!isJumping) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPage, isJumping]);

  const clearFilters = () => {
    setMediaType('all');
    setActivity('all');
    setQuery('');
  };

  const handleJump = event => {
    if (!event.target.value) return;
    const [targetPage, targetId] = event.target.value.split('|');
    setIsJumping(true);
    setCurrentPage(Number.parseInt(targetPage, 10));
    setTimeout(() => {
      requestAnimationFrame(() => {
        document.getElementById(`diary-month-${targetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => setIsJumping(false), 500);
      });
    }, 100);
    setActiveControl(null);
    event.target.value = '';
  };

  const toggleControl = control => setActiveControl(current => current === control ? null : control);

  const handleDeleteLog = log => {
    if (window.confirm(`Delete this diary entry for ${log.mediaItem.title}? This will not change current Library state.`)) {
      removeDiaryLog(log.log_id);
      if (paginatedLogs.length === 1 && currentPage > 1) setCurrentPage(page => page - 1);
    }
  };

  const startEdit = log => {
    setEditingId(log.log_id);
    setEditDate(dateInputFromTimestamp(log.log_date));
    setEditNote(log.review_text || '');
    setEditAction(log.action_type || 'LOGGED');
  };

  const saveEdit = () => {
    const timestamp = timestampFromDateInput(editDate);
    if (timestamp === null) return;
    updateDiaryLog(editingId, { action_type: editAction, log_date: new Date(timestamp).toISOString(), review_text: editNote });
    setEditingId(null);
  };

  const changePage = nextPage => {
    setCurrentPage(nextPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen pb-10 animate-in fade-in duration-300">
      <header className="relative flex items-end justify-between gap-4 border-b border-base-300 pb-3">
        <div className="min-w-0">
          <h1 className="text-xl font-black uppercase tracking-widest sm:text-2xl">Diary</h1>
          <p className="mt-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-base-content/45 sm:text-[10px]">
            {filteredLogs.length}{filtersActive ? ` of ${enrichedLogs.length}` : ''} entries{' '}
            {shouldShowUpdatingIndicator(isLoading, enrichedLogs) && <UpdatingIndicator label="Syncing" />}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => toggleControl('search')} aria-label="Search Diary titles" aria-expanded={activeControl === 'search'} className={`flex h-9 w-9 items-center justify-center border transition-colors ${activeControl === 'search' || query ? 'border-primary bg-primary text-primary-content' : 'border-base-300 bg-base-100 text-base-content/55 hover:border-primary hover:text-primary'}`}><Search className="h-4 w-4" /></button>
          <button type="button" onClick={() => toggleControl('filters')} aria-label="Filter Diary" aria-expanded={activeControl === 'filters'} className={`flex h-9 w-9 items-center justify-center border transition-colors ${activeControl === 'filters' || mediaType !== 'all' || activity !== 'all' ? 'border-primary bg-primary text-primary-content' : 'border-base-300 bg-base-100 text-base-content/55 hover:border-primary hover:text-primary'}`}><ListFilter className="h-4 w-4" /></button>
          <button type="button" onClick={() => toggleControl('month')} aria-label="Jump to Diary month" aria-expanded={activeControl === 'month'} className={`flex h-9 w-9 items-center justify-center border transition-colors ${activeControl === 'month' ? 'border-primary bg-primary text-primary-content' : 'border-base-300 bg-base-100 text-base-content/55 hover:border-primary hover:text-primary'}`}><CalendarDays className="h-4 w-4" /></button>
          {filtersActive && <button type="button" onClick={clearFilters} aria-label="Clear Diary filters" className="flex h-9 w-9 items-center justify-center text-base-content/45 transition-colors hover:text-primary"><X className="h-4 w-4" /></button>}
        </div>

        {activeControl && (
          <div className="absolute right-0 top-full z-40 mt-2 w-full border border-base-300 bg-base-100 p-2 shadow-xl sm:w-auto">
            {activeControl === 'search' && (
              <label className="relative block w-full sm:w-72">
                <span className="sr-only">Search Diary titles</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-content/40" />
                <input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search titles" className="h-10 w-full rounded-none border border-base-300 bg-base-100 pl-9 pr-3 font-sans text-sm outline-none transition-colors focus:border-primary" />
              </label>
            )}
            {activeControl === 'filters' && (
              <div className="grid grid-cols-2 gap-2 sm:w-[332px]">
                <label>
                  <span className="sr-only">Filter by media type</span>
                  <select value={mediaType} onChange={event => setMediaType(event.target.value)} className="h-10 w-full rounded-none border border-base-300 bg-base-100 px-3 font-mono text-[9px] font-bold uppercase tracking-widest outline-none focus:border-primary">
                    <option value="all">All media</option>
                    {DIARY_MEDIA_TYPES.map(type => <option key={type} value={type}>{MEDIA_TYPE_LABELS[type]}</option>)}
                  </select>
                </label>
                <label>
                  <span className="sr-only">Filter by activity</span>
                  <select value={activity} onChange={event => setActivity(event.target.value)} className="h-10 w-full rounded-none border border-base-300 bg-base-100 px-3 font-mono text-[9px] font-bold uppercase tracking-widest outline-none focus:border-primary">
                    <option value="all">All activity</option>
                    {activityOptions.map(action => <option key={action} value={action}>{action}</option>)}
                  </select>
                </label>
              </div>
            )}
            {activeControl === 'month' && (
              <label className="block w-full sm:w-56">
                <span className="sr-only">Jump to month</span>
                <select defaultValue="" onChange={handleJump} className="h-10 w-full rounded-none border border-base-300 bg-base-100 px-3 font-mono text-[9px] font-bold uppercase tracking-widest outline-none focus:border-primary">
                  <option value="">Jump to month</option>
                  {monthOptions.map(option => <option key={option.key} value={`${option.targetPage}|${option.key}`}>{option.label}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
      </header>

      <div data-testid="diary-surface" className="mt-3 border border-base-300 bg-base-200/35 shadow-sm">
      {shouldShowBlockingSkeleton(isLoading, enrichedLogs) ? (
        <div className="bg-base-100 px-3"><DiarySkeleton /></div>
      ) : dateGroups.length === 0 ? (
        <div className="bg-base-100 py-16 text-center">
          <p className="font-sans text-lg font-bold">{filtersActive ? 'No matching history' : 'Your Diary is empty'}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-base-content/55">{filtersActive ? 'Try another title, media type, or activity.' : 'Use Log Activity to add your first historical entry.'}</p>
          {filtersActive && <button type="button" onClick={clearFilters} className="mt-5 h-10 border border-primary px-4 font-mono text-[10px] font-bold uppercase tracking-widest text-primary">Clear filters</button>}
        </div>
      ) : (
        <div className="bg-base-100">
          {dateGroups.map((group, groupIndex) => {
            const startsMonth = groupIndex === 0 || dateGroups[groupIndex - 1].monthKey !== group.monthKey;
            return (
              <React.Fragment key={group.key}>
                {startsMonth && (
                  <div id={`diary-month-${group.monthKey}`} data-testid="diary-month-header" className="scroll-mt-32 grid grid-cols-[52px_minmax(0,1fr)] items-center border-b border-base-300 bg-base-200/80 sm:grid-cols-[76px_minmax(0,1fr)]">
                    <div aria-hidden="true" className="relative h-11 sm:h-12">
                      <span className={`absolute left-1/2 w-px -translate-x-1/2 bg-base-300 ${groupIndex === 0 ? 'bottom-0 top-1/2' : 'inset-y-0'}`} />
                      <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-[3px] border-primary bg-base-100 shadow-sm sm:h-3.5 sm:w-3.5" />
                      <span className="absolute left-1/2 right-0 top-1/2 h-px -translate-y-1/2 bg-base-300" />
                    </div>
                    <div className="flex min-w-0 items-center pr-3 sm:pr-4">
                      <h2 className="border border-base-300 bg-base-100 px-2.5 py-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-primary shadow-sm sm:px-3 sm:text-xs">{group.monthLabel}</h2>
                    </div>
                  </div>
                )}
                <section aria-label={group.key} className="grid grid-cols-[52px_minmax(0,1fr)] border-b border-base-300 sm:grid-cols-[76px_minmax(0,1fr)]">
                  <time dateTime={group.key} className="relative bg-base-200/25 px-1 py-3 text-center sm:py-4">
                    <span aria-hidden="true" className="absolute inset-y-0 right-0 w-px bg-base-300" />
                    <span className="block font-mono text-[8px] font-black tracking-[0.18em] text-primary sm:text-[9px]">{group.month}</span>
                    <span className="block text-2xl font-black leading-none tracking-tight sm:text-3xl">{group.day}</span>
                    <span className="mt-1 block font-mono text-[7px] font-bold uppercase tracking-wider text-base-content/45 sm:text-[8px]">{group.weekday}</span>
                  </time>

                  <div className="min-w-0 divide-y divide-base-300/70">
                    {group.entries.map(log => {
                      const poster = resolveMediaImage(log.mediaItem, log.media_type, 'thumb');
                      const typeColors = getMediaTypeColors(log.media_type);
                      const seasonLabel = diarySeasonLabel(log);
                      const rating = diaryEntryRating(log);
                      const ratingLabel = formatDiaryRating(rating);
                      const year = log.mediaItem.apiData?.year || log.mediaItem.year;

                      return (
                        <article key={log.log_id} className="group bg-base-100 px-2.5 py-3 transition-colors hover:bg-base-200/45 sm:px-4 sm:py-3.5">
                          <div className="flex min-w-0 gap-3 sm:gap-4">
                            <Link to={`/media/${log.media_type}/${log.mediaItem.id}`} state={{ previewData: log.mediaItem }} className="h-[72px] w-12 shrink-0 overflow-hidden border border-base-300 bg-base-200 shadow-sm transition-colors group-hover:border-primary/50 sm:h-[90px] sm:w-[60px]" aria-label={`Open ${log.mediaItem.title}`}>
                              <ImageWithFallback src={poster} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                            </Link>

                            <div className="min-w-0 flex-1">
                              {editingId === log.log_id ? (
                                <div className="border-l-2 border-primary pl-3">
                                  <p className="mb-3 font-mono text-[9px] font-black uppercase tracking-widest text-primary">Editing Diary history · Library state stays unchanged</p>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="flex flex-col gap-1 font-mono text-[9px] font-bold uppercase tracking-widest text-base-content/50">Activity date
                                      <input type="date" value={editDate} onChange={event => setEditDate(event.target.value)} className="h-11 rounded-none border border-base-300 bg-base-100 px-3 font-mono text-xs text-base-content outline-none focus:border-primary" />
                                    </label>
                                    <label className="flex flex-col gap-1 font-mono text-[9px] font-bold uppercase tracking-widest text-base-content/50">Activity
                                      <select value={editAction} onChange={event => setEditAction(event.target.value)} className="h-11 rounded-none border border-base-300 bg-base-100 px-3 font-mono text-xs text-base-content outline-none focus:border-primary">
                                        {!diaryActionsForMediaType(log.media_type).includes(editAction) && <option value={editAction}>{editAction} (Legacy)</option>}
                                        {diaryActionsForMediaType(log.media_type).map(option => <option key={option} value={option}>{option}</option>)}
                                      </select>
                                    </label>
                                  </div>
                                  <label className="mt-3 flex flex-col gap-1 font-mono text-[9px] font-bold uppercase tracking-widest text-base-content/50">Diary note
                                    <textarea value={editNote} onChange={event => setEditNote(event.target.value)} className="min-h-24 rounded-none border border-base-300 bg-base-100 p-3 font-sans text-sm font-normal normal-case tracking-normal text-base-content outline-none focus:border-primary" />
                                  </label>
                                  <div className="mt-3 flex justify-end gap-2">
                                    <button type="button" onClick={() => setEditingId(null)} className="h-10 border border-base-300 px-3 font-mono text-[9px] font-bold uppercase tracking-widest">Cancel</button>
                                    <button type="button" disabled={!editDate} onClick={saveEdit} className="flex h-10 items-center gap-2 border border-primary bg-primary px-3 font-mono text-[9px] font-bold uppercase tracking-widest text-primary-content disabled:opacity-40"><Save className="h-3.5 w-3.5" /> Save entry</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                        <Link to={`/media/${log.media_type}/${log.mediaItem.id}`} state={{ previewData: log.mediaItem }} className="text-base font-bold leading-tight transition-colors hover:text-primary sm:text-lg">{log.mediaItem.title}</Link>
                                        {year && year !== '----' && <span className="font-mono text-[10px] font-bold tracking-widest text-base-content/50 sm:text-xs">{year}</span>}
                                      </div>
                                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9px] font-bold uppercase tracking-widest">
                                        <span className={`border border-current/15 px-1.5 py-0.5 ${typeColors.text}`}>{MEDIA_TYPE_LABELS[log.media_type] || log.media_type}</span>
                                        {ratingLabel && <span className="text-warning" aria-label={`Rated ${rating} out of 10`} title={`${rating}/10`}>{ratingLabel}</span>}
                                        {seasonLabel && <span className="border-l border-base-300 pl-2 text-primary">{seasonLabel}{log.season_year ? ` · ${log.season_year}` : ''}</span>}
                                      </div>
                                    </div>

                                    <DiaryEntryActions log={log} onEdit={startEdit} onDelete={handleDeleteLog} />
                                  </div>
                                  <ExpandableReview text={log.review_text} />
                                </>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {!isLoading && totalPages > 1 && (
        <nav aria-label="Diary pages" className="flex items-center justify-between border-t border-base-300 bg-base-100 p-3">
          <button type="button" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)} className="flex h-11 items-center gap-1 px-2 font-mono text-[10px] font-bold uppercase tracking-widest disabled:opacity-30"><ChevronLeft className="h-4 w-4" /> Newer</button>
          <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-base-content/45">Page {currentPage} of {totalPages}</span>
          <button type="button" disabled={currentPage === totalPages} onClick={() => changePage(currentPage + 1)} className="flex h-11 items-center gap-1 px-2 font-mono text-[10px] font-bold uppercase tracking-widest disabled:opacity-30">Older <ChevronRight className="h-4 w-4" /></button>
        </nav>
      )}
      </div>
    </div>
  );
};
