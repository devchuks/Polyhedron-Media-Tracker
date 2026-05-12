import React, { useState, useRef } from 'react';
import { useMediaStore, useUIStore } from '../store/useMediaStore';
import { apiRegistry } from '../services/apiRegistry';
import { Loader2, Check, X, Edit3, Save, Terminal, Play, Upload, FileJson, ChevronUp, ChevronDown, Plus, ShieldAlert } from 'lucide-react';
import { ImageWithFallback, getSubtype } from '../components/UI';
import { useWindowVirtualizer } from '@tanstack/react-virtual';

const YOINKER_SCRIPT = `(async () => {
  console.log("🚀 Starting Twitter Yoinker...");
  const extracted = new Map();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const extractVisibleTweets = () => {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    tweets.forEach((tweet) => {
      try {
        const timeEl = tweet.querySelector("time");
        const timestamp = timeEl ? timeEl.getAttribute("datetime") : new Date().toISOString();
        const tweetLink = timeEl?.closest("a")?.href || "";
        const tweetId = tweetLink.split("/status/")[1]?.split("?")[0];
        const textEl = tweet.querySelector('div[data-testid="tweetText"]');
        if (!textEl) return;
        const lines = textEl.innerText.split("\\n").map(l => l.trim()).filter(Boolean);
        if (!lines.length) return;
        const regex = /^(?:\\d+\\.\\s*)?(.+?)\\s*\\((\\d{4})(?:-\\d{4})?\\)(.*)$/i;
        let currentItem = null;
        const itemsInTweet = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const match = line.match(regex);
          if (match) {
            if (currentItem) itemsInTweet.push(currentItem);
            currentItem = { rawText: line, rawTitle: match[1].trim(), parsedYear: parseInt(match[2], 10), parsedModifier: match[3].trim(), noteLines: [] };
          } else {
            if (currentItem) currentItem.noteLines.push(line);
          }
        }
        if (currentItem) itemsInTweet.push(currentItem);
        itemsInTweet.forEach((item, index) => {
          const uniqueKey = tweetId ? \`\${tweetId}_\${index}\` : \`\${item.rawTitle}_\${item.parsedYear}_\${timestamp}_\${index}\`;
          if (!extracted.has(uniqueKey)) {
            extracted.set(uniqueKey, { id: crypto.randomUUID(), raw_text: item.rawText, extracted_title: item.rawTitle, parsed_year: item.parsedYear, parsed_modifier: item.parsedModifier, extracted_note: item.noteLines.join("\\n\\n"), tweet_timestamp: timestamp, source_tweet_id: tweetId || null, source_url: tweetLink || null, selected_type: null, status: "PENDING", candidates: [] });
            console.log(\`✅ Extracted: \${item.rawTitle} (\${item.parsedYear})\`);
          }
        });
      } catch (err) { console.warn("Tweet parse failed:", err); }
    });
  };
  let sameCount = 0; let lastExtractedCount = 0;
  while (sameCount < 8) {
    extractVisibleTweets();
    const currentCount = extracted.size;
    console.log(\`📦 Current Extracted Count: \${currentCount}\`);
    if (currentCount === lastExtractedCount) sameCount++; else { sameCount = 0; lastExtractedCount = currentCount; }
    window.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" });
    await sleep(2500);
  }
  const finalArray = Array.from(extracted.values());
  const blob = new Blob([JSON.stringify(finalArray, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = \`twitter_media_extract_\${Date.now()}.json\`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
})();`;

const processCommit = (item, storeActions) => {
  const { addMediaItem, addDiaryLog, removeImportItem } = storeActions;
  const finalItemData = item.selected_candidate;
  const seasonOverride = item.selected_season;
  const selectedType = item.selected_type;
  
  const apiDataPayload = { ...finalItemData, raw: { ...(finalItemData.raw || finalItemData) } };
  let libraryPayload = {
    id: finalItemData.id, title: finalItemData.title, type: selectedType, subtype: getSubtype(selectedType),
    status: 'completed', addedAt: Date.now(), dateCompleted: new Date(item.tweet_timestamp).getTime(),
    rating: 0, image: apiDataPayload.image, apiData: apiDataPayload
  };

  if (selectedType === 'tv' && seasonOverride) {
    const pDetails = item.parent_details || finalItemData.raw;
    libraryPayload.id = finalItemData.id;
    libraryPayload.title = finalItemData.title;
    const poster = seasonOverride.poster_path ? `https://image.tmdb.org/t/p/w500${seasonOverride.poster_path}` : finalItemData.image;
    apiDataPayload.image = poster; libraryPayload.image = poster;
    
    // FIX: Ensure canonical series year dominates the DB
    apiDataPayload.year = pDetails.first_air_date ? pDetails.first_air_date.substring(0, 4) : finalItemData.year;
    
    apiDataPayload.raw = { ...pDetails, season_details: seasonOverride, deepFetched: true };
    libraryPayload.progress = `S${seasonOverride.season_number.toString().padStart(2, '0')} E${(seasonOverride.episode_count || 1).toString().padStart(2, '0')}`;
  } else {
    if (selectedType === 'tv' && finalItemData.raw) {
      libraryPayload.progress = `S${(finalItemData.raw.number_of_seasons || 1).toString().padStart(2, '0')} E${(finalItemData.raw.number_of_episodes || 1).toString().padStart(2, '0')}`;
    }
  }

  addMediaItem(libraryPayload, selectedType);
  
  addDiaryLog({
    log_id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2), media_id: libraryPayload.id, media_type: selectedType,
    action_type: 'LOGGED', log_date: item.tweet_timestamp, review_text: item.extracted_note || '',
    image: libraryPayload.image, 
    season_label: seasonOverride ? seasonOverride.name : undefined,
    season_year: seasonOverride?.air_date ? seasonOverride.air_date.substring(0, 4) : undefined
  });
  
  removeImportItem(item.id);
};

const QueueItem = ({ item, globalIndex, totalCount }) => {
  const { removeImportItem, updateImportItem, addMediaItem, addDiaryLog, autoSearchOnTypeSelect, moveItemToPosition } = useMediaStore();
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(item.extracted_note || '');
  const [isSearching, setIsSearching] = useState(false);
  const [selectedParent, setSelectedParent] = useState(null);
  const [parentDetails, setParentDetails] = useState(null);
  const [isDeepFetching, setIsDeepFetching] = useState(false);
  const [editQuery, setEditQuery] = useState(item.extracted_title || '');
  const [isEditingQuery, setIsEditingQuery] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(8);
  const [posInput, setPosInput] = useState(globalIndex);

  React.useEffect(() => { setPosInput(globalIndex); }, [globalIndex]);

  const handlePosSubmit = () => {
     const newPos = parseInt(posInput, 10);
     if (!isNaN(newPos) && newPos !== globalIndex) {
        // Convert 1-based human index to 0-based array index
        moveItemToPosition(item.id, newPos - 1);
     } else {
        setPosInput(globalIndex);
     }
  };

  const selectedType = item.selected_type || ''; 
  const searchResults = item.candidates || [];

  const handleSearch = async (typeOverride = selectedType, customQuery = editQuery) => {
    if (!typeOverride) return;
    setIsSearching(true); setSelectedParent(null); setVisibleLimit(8);
    const trimmedQuery = (customQuery || '').trim();
    if (trimmedQuery.length < 2) { setIsSearching(false); return; }
    updateImportItem(item.id, { selected_type: typeOverride, extracted_title: trimmedQuery, has_searched: false });
    try {
      let response = { results: [] };
      switch (typeOverride) {
        case 'movies': response = await apiRegistry.searchMovies(trimmedQuery, 1); break;
        case 'tv':     response = await apiRegistry.searchTV(trimmedQuery, 1); break;
        case 'games':  response = await apiRegistry.searchGames(trimmedQuery, 1); break;
        case 'anime':  response = await apiRegistry.searchAnime(trimmedQuery, 1); break;
        case 'manga':  response = await apiRegistry.searchManga(trimmedQuery, 1); break;
        case 'comics': response = await apiRegistry.searchComics(trimmedQuery, 1); break;
        case 'vn':     response = await apiRegistry.searchVNs(trimmedQuery, 1); break;
        case 'books':  response = await apiRegistry.searchBooks(trimmedQuery, 1); break;
      }
      updateImportItem(item.id, { candidates: Array.isArray(response) ? response : (response.results || []), has_searched: true });
    } catch (e) { console.error("Search failed:", e); updateImportItem(item.id, { has_searched: true }); }
    setIsSearching(false);
  };

  const handleSelectCandidate = async (candidate) => {
    if (selectedType === 'tv') {
      setSelectedParent(candidate);
      setIsDeepFetching(true);
      try {
        const details = await apiRegistry.getMediaDetails(candidate.id, selectedType);
        setParentDetails(details);
      } catch (e) { console.error(e); }
      setIsDeepFetching(false);
    } else {
      updateImportItem(item.id, { selected_candidate: candidate, ready_to_commit: true });
    }
  };

  if (item.ready_to_commit && item.selected_candidate) {
    return (
      <div className="bg-base-200/80 border-l-4 border-success p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-16 shrink-0 border border-base-300 bg-base-300 overflow-hidden">
             <ImageWithFallback src={item.selected_season?.poster_path ? `https://image.tmdb.org/t/p/w500${item.selected_season.poster_path}` : item.selected_candidate.image} className="w-full h-full object-cover" />
          </div>
          <div className="flex flex-col">
            <div className="text-[10px] font-mono font-bold text-success uppercase tracking-widest mb-1 flex items-center gap-1"><Check className="w-3 h-3" /> Ready for Library</div>
            <h3 className="text-lg font-bold font-sans flex flex-wrap items-center gap-2">
              {item.selected_candidate.title}
              {item.selected_season && <span className="badge badge-outline badge-sm text-[10px] font-mono">{item.selected_season.name}</span>}
            </h3>
          <p className="text-[10px] font-mono opacity-50 mt-1">Source: {item.extracted_title}{item.parsed_year ? ` (${item.parsed_year})` : ''}{item.parsed_modifier ? ` ${item.parsed_modifier}` : ''}</p>
          </div>
        </div>
          <div className="flex gap-2 shrink-0 flex-wrap sm:flex-nowrap items-center">
             <div className="flex items-center gap-1 bg-base-100 px-2 py-1 border border-base-300 h-8 shrink-0 tooltip tooltip-top" data-tip="Queue Position">
               <span className="text-[9px] font-mono text-base-content/50 uppercase">Pos</span>
               <input
                 type="number"
                 className="w-10 bg-transparent text-center font-mono text-[10px] font-bold focus:outline-none focus:text-primary p-0 m-0"
                 value={posInput}
                 onChange={e => setPosInput(e.target.value)}
                 onBlur={handlePosSubmit}
                 onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                 min="1"
                 max={totalCount}
               />
             </div>
           <button onClick={() => processCommit(item, { addMediaItem, addDiaryLog, removeImportItem })} className="btn btn-sm btn-success rounded-none font-mono uppercase tracking-widest text-[10px] shadow-md shadow-success/20">
             Add Now
           </button>
           <button onClick={() => updateImportItem(item.id, { ready_to_commit: false, selected_candidate: null, selected_season: null, parent_details: null })} className="btn btn-sm btn-outline border-base-300 rounded-none font-mono uppercase tracking-widest text-[10px]">
             Change
           </button>
           <button onClick={() => removeImportItem(item.id)} className="btn btn-sm btn-square btn-ghost text-error ml-2"><X className="w-4 h-4" /></button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-base-200/50 border border-base-300 p-4 flex flex-col gap-4">
      <div className="flex justify-between items-start gap-4">
        <div className="w-full">
          <div className="text-xs font-mono text-base-content/50 uppercase tracking-widest mb-1 flex justify-between items-center w-full">
            <span>Extracted Payload</span>
            <div className="flex items-center gap-1 bg-base-100 px-2 py-0.5 border border-base-300 tooltip tooltip-left" data-tip="Queue Position">
               <span className="text-[9px] font-mono text-base-content/50 uppercase">Pos</span>
               <input
                 type="number"
                 className="w-10 bg-transparent text-center font-mono text-[10px] font-bold focus:outline-none focus:text-primary m-0 p-0"
                 value={posInput}
                 onChange={e => setPosInput(e.target.value)}
                 onBlur={handlePosSubmit}
                 onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                 min="1"
                 max={totalCount}
               />
            </div>
          </div>
          {isEditingQuery ? (
            <div className="flex items-center gap-2 my-1">
              <input type="text" className="input input-sm input-bordered rounded-none font-bold font-sans w-full max-w-sm" value={editQuery} onChange={(e) => setEditQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setIsEditingQuery(false); handleSearch(selectedType, editQuery); } }} />
              <button onClick={() => { setIsEditingQuery(false); handleSearch(selectedType, editQuery); }} className="btn btn-sm btn-primary rounded-none uppercase text-[10px] tracking-widest">Search</button>
            </div>
          ) : (
            <h3 className="text-xl font-bold font-sans group flex items-center flex-wrap gap-2">
            <span>{item.extracted_title}{item.parsed_year ? <span className="text-primary opacity-80 ml-1">({item.parsed_year})</span> : null}{item.parsed_modifier && <span className="badge badge-outline badge-sm ml-1">{item.parsed_modifier}</span>}</span>
              <button onClick={() => setIsEditingQuery(true)} className="opacity-0 group-hover:opacity-100 transition-opacity btn btn-xs btn-ghost btn-square rounded-none"><Edit3 className="w-3 h-3 text-base-content/50" /></button>
            </h3>
          )}
          <p className="text-[10px] font-mono opacity-50 mt-1">{new Date(item.tweet_timestamp).toLocaleString()}</p>
        </div>
        <button onClick={() => removeImportItem(item.id)} className="btn btn-sm btn-square btn-ghost text-error"><X className="w-4 h-4" /></button>
      </div>

      {item.extracted_note && (
        <div className="bg-base-300/30 border border-base-300 p-3 relative group">
          {editingNote ? (
            <div className="flex flex-col gap-2">
              <textarea className="textarea textarea-bordered rounded-none w-full text-sm font-sans min-h-[100px]" value={noteText} onChange={e => setNoteText(e.target.value)} />
              <button onClick={() => { setEditingNote(false); updateImportItem(item.id, { extracted_note: noteText }); }} className="btn btn-sm btn-primary self-end rounded-none"><Save className="w-4 h-4 mr-1"/> Save Note</button>
            </div>
          ) : (
            <div>
              <p className="text-sm font-sans whitespace-pre-wrap pr-8 text-base-content/80">"{noteText}"</p>
              <button onClick={() => setEditingNote(true)} className="absolute top-2 right-2 btn btn-xs btn-square btn-ghost opacity-0 group-hover:opacity-100 transition-opacity rounded-none"><Edit3 className="w-3 h-3" /></button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center bg-base-300/50 p-2 border border-base-300">
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-base-content/50 mr-2">Identify As:</span>
        {['movies', 'tv', 'anime', 'manga', 'games', 'vn', 'books', 'comics'].map(t => (
          <button key={t} onClick={() => {
            if (autoSearchOnTypeSelect) handleSearch(t);
            else updateImportItem(item.id, { selected_type: t, candidates: [], has_searched: false });
          }} className={`btn btn-xs rounded-none font-mono uppercase tracking-widest ${selectedType === t ? 'btn-primary' : 'btn-outline border-base-300'}`}>
            {t}
          </button>
        ))}
      </div>

      {isSearching && <div className="p-4 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
      
      {searchResults.length > 0 && !selectedParent && (
        <div className="mt-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {searchResults.slice(0, visibleLimit).map(res => (
              <div key={res.id} onClick={() => handleSelectCandidate(res)} className={`flex flex-col gap-1 cursor-pointer group ${res.year === String(item.parsed_year) ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-200' : ''}`}>
                <div className="aspect-[2/3] w-full bg-base-300 overflow-hidden relative border border-base-300 group-hover:border-primary transition-colors">
                  <ImageWithFallback src={res.image} alt={res.title} className="w-full h-full object-cover" />
                  {res.year === String(item.parsed_year) && <div className="absolute top-1 right-1 bg-primary text-primary-content text-[9px] font-mono px-1 font-bold uppercase">Year Match</div>}
                </div>
                <span className="text-xs font-bold line-clamp-1">{res.title}</span>
                <span className="text-[10px] font-mono opacity-60">{res.year}</span>
              </div>
            ))}
          </div>
          {searchResults.length > visibleLimit && (
            <button onClick={() => setVisibleLimit(prev => prev + 8)} className="btn btn-sm btn-outline border-base-300 rounded-none font-mono uppercase tracking-widest text-[10px] mt-3 w-full">
              Show {searchResults.length - visibleLimit} More Results
            </button>
          )}
        </div>
      )}

      {selectedParent && (
        <div className="border border-primary bg-primary/5 p-4 mt-2 relative">
          <button onClick={() => setSelectedParent(null)} className="absolute top-2 right-2 btn btn-xs btn-ghost text-base-content/50 uppercase font-mono text-[9px]">Back to shows</button>
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-primary mb-3">Select Season for {selectedParent.title}</div>
          
          {isDeepFetching ? (
            <div className="p-4 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : parentDetails?.seasons?.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {parentDetails.seasons.map(season => {
                const seasonYear = season.air_date ? season.air_date.substring(0, 4) : '----';
                const isMatch = seasonYear === String(item.parsed_year) || (item.parsed_modifier && season.name.toLowerCase().includes(item.parsed_modifier.toLowerCase()));
                return (
                  <div key={season.id} onClick={() => updateImportItem(item.id, { selected_candidate: selectedParent, selected_season: season, parent_details: parentDetails, ready_to_commit: true })} className={`flex flex-col gap-1 cursor-pointer group ${isMatch ? 'ring-2 ring-success ring-offset-2 ring-offset-base-200' : ''}`}>
                    <div className="aspect-[2/3] w-full bg-base-300 overflow-hidden relative border border-base-300 group-hover:border-success transition-colors">
                      <ImageWithFallback src={season.poster_path ? `https://image.tmdb.org/t/p/w500${season.poster_path}` : selectedParent.image} className="w-full h-full object-cover" />
                      {isMatch && <div className="absolute top-1 right-1 bg-success text-success-content text-[9px] font-mono px-1 font-bold uppercase">Likely Match</div>}
                    </div>
                    <span className="text-xs font-bold line-clamp-1">{season.name}</span>
                    <span className="text-[10px] font-mono opacity-60">{seasonYear} • {season.episode_count} Eps</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm opacity-50">No season data found.</p>
          )}
        </div>
      )}
    </div>
  );
};

export const ImportTerminal = () => {
  const { authMode, importQueue, addImportBatch, addManualImportItem, updateImportItem, media, mediaLogs, restoreBackup, addMediaItem, addDiaryLog, removeImportItem, isAutoProcessing, setIsAutoProcessing, isBatchCommitting, setIsBatchCommitting, clearImportQueue, clearPendingImportQueue, autoSearchOnTypeSelect, setAutoSearchOnTypeSelect } = useMediaStore();
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState('');
  const [autoProgress, setAutoProgress] = useState({ current: 0, total: 0 });
  const [batchCommitProgress, setBatchCommitProgress] = useState({ current: 0, total: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isReadySectionOpen, setIsReadySectionOpen] = useState(true);
  const [isManualFormOpen, setIsManualFormOpen] = useState(false);
  const [manualEntry, setManualEntry] = useState({ title: '', year: '', timestamp: '', modifier: '', note: '', type: '', source_url: '', source_tweet_id: '', position: 'top' });
  const listRef = useRef(null);

  const yoinkFileRef = useRef(null);
  const restoreFileRef = useRef(null);

  if (authMode !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh] animate-in fade-in">
        <div className="text-center font-mono text-error uppercase tracking-widest flex flex-col items-center gap-4 border border-error/30 bg-error/5 p-10">
          <ShieldAlert className="w-12 h-12" />
          <h2 className="text-lg font-bold">403 - Restricted Access</h2>
          <p className="text-[10px] opacity-70">The Import Terminal is restricted to Administrator use only.</p>
        </div>
      </div>
    );
  }

  const handleExportLibrary = () => {
    const backup = { media, mediaLogs };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup, null, 2));
    const a = document.createElement('a');
    a.href = dataStr; a.download = `polyhedron_full_library_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  const handleExportQueue = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(importQueue, null, 2));
    const a = document.createElement('a');
    a.href = dataStr; a.download = `polyhedron_queue_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  const handleYoinkFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (Array.isArray(parsed)) {
          addImportBatch(parsed);
          setError('');
        } else {
          setError('Yoinked payload must be a JSON array.');
        }
      } catch (err) { setError('Invalid JSON formatting.'); }
      e.target.value = null; 
    };
    reader.readAsText(file);
  };

  const handleYoinkPaste = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      if (Array.isArray(parsed)) {
        addImportBatch(parsed);
        setJsonInput('');
        setError('');
      } else {
        setError('Yoinked payload must be a JSON array.');
      }
    } catch (e) { setError('Invalid JSON formatting.'); }
  };

  const handleYoinkDrop = (e) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type === "application/json" || file.name.endsWith(".json"))) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
           const parsed = JSON.parse(event.target.result);
           if (Array.isArray(parsed)) { 
             addImportBatch(parsed); 
             setError(''); 
           } else {
             setError('Dropped file must be a JSON array.');
           }
        } catch(err) { setError('Invalid JSON formatting.'); }
      };
      reader.readAsText(file);
    } else setError("Please drop a valid .json file.");
  };

  const handleAddManualEntry = () => {
    if (!manualEntry.title.trim()) return;
    const parsedYear = manualEntry.year ? parseInt(manualEntry.year) : null;
    const newItem = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2),
      raw_text: `MANUAL: ${manualEntry.title.trim()}${parsedYear ? ` (${parsedYear})` : ''}${manualEntry.modifier ? ` ${manualEntry.modifier.trim()}` : ''}`,
      extracted_title: manualEntry.title.trim(),
      parsed_year: parsedYear,
      parsed_modifier: manualEntry.modifier.trim(),
      extracted_note: manualEntry.note.trim(),
      tweet_timestamp: manualEntry.timestamp ? new Date(manualEntry.timestamp).toISOString() : new Date().toISOString(),
      source_tweet_id: manualEntry.source_tweet_id?.trim() || null,
      source_url: manualEntry.source_url?.trim() || null,
      selected_type: manualEntry.type || null,
      status: "PENDING",
      candidates: [],
      has_searched: false
    };
    addManualImportItem(newItem, manualEntry.position);
    setManualEntry({ title: '', year: '', timestamp: '', modifier: '', note: '', type: '', source_url: '', source_tweet_id: '', position: manualEntry.position });
    setIsManualFormOpen(false);
  };

  const handleRestoreFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      
      if (parsed.media && parsed.mediaLogs) {
        if (window.confirm("This will overwrite your current library with the backup. Proceed?")) {
          restoreBackup(parsed);
          alert("Library Restored Successfully!");
        }
      } else {
        alert('Invalid backup file. Missing media or mediaLogs.');
      }
    } catch (err) { 
      alert(`Import Failed: ${err.message}\n\nMake sure the file is fully downloaded to your phone's local storage.`); 
    }
    e.target.value = null;
  };

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };

  const handleAutoPopulate = async () => {
    setIsAutoProcessing(true);
    const itemsToProcess = importQueue.filter(item => item.selected_type && !item.ready_to_commit && !item.has_searched && (!item.candidates || item.candidates.length === 0));
    setAutoProgress({ current: 0, total: itemsToProcess.length });

    for (let i = 0; i < itemsToProcess.length; i++) {
      if (!useMediaStore.getState().isAutoProcessing) break;

      const item = itemsToProcess[i];
      
      // Ensure item hasn't been manually resolved while the loop was actively running
      const currentState = useMediaStore.getState().importQueue.find(q => q.id === item.id);
      if (!currentState || currentState.ready_to_commit || currentState.has_searched || (currentState.candidates && currentState.candidates.length > 0)) {
        continue;
      }
      
      try {
        let response = { results: [] };
        switch (item.selected_type) {
          case 'movies': response = await apiRegistry.searchMovies(item.extracted_title, 1); break;
          case 'tv': response = await apiRegistry.searchTV(item.extracted_title, 1); break;
          case 'games': response = await apiRegistry.searchGames(item.extracted_title, 1); break;
          case 'anime': response = await apiRegistry.searchAnime(item.extracted_title, 1); break;
          case 'manga': response = await apiRegistry.searchManga(item.extracted_title, 1); break;
          case 'comics': response = await apiRegistry.searchComics(item.extracted_title, 1); break;
          case 'vn': response = await apiRegistry.searchVNs(item.extracted_title, 1); break;
          case 'books': response = await apiRegistry.searchBooks(item.extracted_title, 1); break;
        }
        updateImportItem(item.id, { candidates: Array.isArray(response) ? response : (response.results || []), has_searched: true });
      } catch (error) { 
        console.error("Auto fetch failed for", item.extracted_title, error); 
        useUIStore.getState().addToast(`Auto-fetch failed for "${item.extracted_title}"`, 'error');
        updateImportItem(item.id, { has_searched: true }); // Prevent infinite retries on hard API failures
      }
      setAutoProgress({ current: i + 1, total: itemsToProcess.length });
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    setIsAutoProcessing(false);
  };

  const itemsReadyToProcess = importQueue.filter(item => item.selected_type && !item.ready_to_commit && !item.has_searched && (!item.candidates || item.candidates.length === 0)).length;
  
  const readyItems = importQueue.filter(item => item.ready_to_commit);
  const pendingItems = importQueue.filter(item => !item.ready_to_commit);
  const readyToCommitCount = readyItems.length;

  const rowVirtualizer = useWindowVirtualizer({
    count: pendingItems.length,
    estimateSize: () => 180,
    overscan: 5,
  });

  const handleBatchCommit = async () => {
    setIsBatchCommitting(true);
    setBatchCommitProgress({ current: 0, total: readyItems.length });

    for (let i = 0; i < readyItems.length; i++) {
      processCommit(readyItems[i], { addMediaItem, addDiaryLog, removeImportItem });
      setBatchCommitProgress({ current: i + 1, total: readyItems.length });
      await new Promise(resolve => setTimeout(resolve, 800)); // Increased trickle delay to prevent browser crashes
    }
    setIsBatchCommitting(false);
  };

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto flex flex-col gap-8 pb-32 animate-in fade-in duration-300">
      
      <input type="file" accept=".json,application/json,text/plain,text/json,*/*" className="hidden" ref={yoinkFileRef} onChange={handleYoinkFile} />
      <input type="file" accept=".json,application/json,text/plain,text/json,*/*" className="hidden" ref={restoreFileRef} onChange={handleRestoreFile} />

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-black uppercase tracking-tight font-sans flex items-center gap-3"><Terminal className="w-8 h-8"/> Terminal Purgatory</h1>
        <p className="font-mono text-xs opacity-60 uppercase tracking-widest">Resolution Queue • {importQueue.length} Pending</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="flex flex-col gap-2 bg-base-200 border border-base-300 p-4">
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-primary mb-2">How to Yoink from Twitter</div>
          <p className="text-xs font-sans opacity-80 mb-2">Open your timeline, scroll to the top, open the Dev Console (F12), paste this, and hit Enter. Don't touch the mouse while it auto-scrolls.</p>
          <div className="bg-black text-green-400 p-3 font-mono text-[10px] overflow-y-auto h-32 border border-base-300 custom-scrollbar whitespace-pre">
            {YOINKER_SCRIPT}
          </div>
          <button onClick={() => navigator.clipboard.writeText(YOINKER_SCRIPT)} className="btn btn-xs btn-outline mt-2 rounded-none font-mono tracking-widest uppercase">Copy Script</button>
        </div>

        <div 
          className={`flex flex-col gap-2 bg-base-200 border border-base-300 p-4 transition-all relative ${isDragging ? 'ring-2 ring-primary bg-primary/5' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleYoinkDrop}
        >
          {isDragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-base-100/90 backdrop-blur-sm border-2 border-primary border-dashed">
              <span className="font-mono text-sm font-bold uppercase tracking-widest text-primary">Drop Yoinked JSON Here</span>
            </div>
          )}
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-base-content/50">1. Select, Drop, or Paste Yoinked JSON</div>
          <textarea 
            placeholder="Paste array or Drag & Drop .json file here..." 
            className="textarea textarea-bordered font-mono text-xs h-32 rounded-none focus:outline-none focus:border-primary w-full"
            value={jsonInput}
            onChange={e => setJsonInput(e.target.value)}
          />
          <div className="flex justify-between items-center mt-1 gap-2">
            <span className="text-error text-xs font-mono">{error}</span>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => yoinkFileRef.current?.click()} className="btn btn-sm btn-outline border-base-300 rounded-none font-mono uppercase tracking-widest text-[10px]">
                <FileJson className="w-3 h-3 mr-1" /> Browse
              </button>
              <button onClick={handleYoinkPaste} disabled={!jsonInput.trim()} className="btn btn-sm btn-primary rounded-none font-mono uppercase tracking-widest text-[10px]">
                Ingest Payload
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-base-200 border border-base-300 p-4 transition-all">
        <button
          onClick={() => setIsManualFormOpen(!isManualFormOpen)}
          className="flex items-center justify-between w-full text-left font-mono font-bold uppercase tracking-widest text-[10px] text-base-content/70 hover:text-base-content"
        >
          <span className="flex items-center gap-2"><Plus className="w-4 h-4" /> Manually Add Entry To Queue</span>
          {isManualFormOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {isManualFormOpen && (
          <div className="mt-4 flex flex-col gap-4 animate-in slide-in-from-top-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" onKeyDown={(e) => { if (e.key === 'Enter') handleAddManualEntry(); }}>
              <input autoFocus type="text" placeholder="Title (Required)" className="input input-sm input-bordered rounded-none font-sans w-full" value={manualEntry.title} onChange={e => setManualEntry({...manualEntry, title: e.target.value})} />
              <input type="number" placeholder="Release Year" className="input input-sm input-bordered rounded-none font-sans w-full" value={manualEntry.year} onChange={e => setManualEntry({...manualEntry, year: e.target.value})} />
              <input type="text" placeholder="Modifier (e.g. Season 2)" className="input input-sm input-bordered rounded-none font-sans w-full" value={manualEntry.modifier} onChange={e => setManualEntry({...manualEntry, modifier: e.target.value})} />
              <select className="select select-sm select-bordered rounded-none font-mono text-[10px] uppercase w-full" value={manualEntry.type} onChange={e => setManualEntry({...manualEntry, type: e.target.value})}>
                <option value="">No Type</option>
                {['movies', 'tv', 'anime', 'manga', 'games', 'vn', 'books', 'comics'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="datetime-local" title="Log Timestamp" className="input input-sm input-bordered rounded-none font-sans w-full text-[10px] uppercase text-base-content/80" value={manualEntry.timestamp} onChange={e => setManualEntry({...manualEntry, timestamp: e.target.value})} />
              <input type="text" placeholder="Source URL" className="input input-sm input-bordered rounded-none font-sans w-full" value={manualEntry.source_url} onChange={e => setManualEntry({...manualEntry, source_url: e.target.value})} />
              <input type="text" placeholder="Source Tweet ID" className="input input-sm input-bordered rounded-none font-sans w-full" value={manualEntry.source_tweet_id} onChange={e => setManualEntry({...manualEntry, source_tweet_id: e.target.value})} />
            </div>
            <textarea placeholder="Note / Review (Ctrl+Enter to Add)" className="textarea textarea-bordered rounded-none font-sans w-full min-h-[80px]" value={manualEntry.note} onChange={e => setManualEntry({...manualEntry, note: e.target.value})} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAddManualEntry(); }} />
            <div className="flex justify-between items-center bg-base-300/50 p-2 border border-base-300">
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-60">Insert At:</span>
                <label className="flex items-center gap-2 cursor-pointer text-[10px] font-mono uppercase"><input type="radio" name="position" className="radio radio-xs radio-primary" checked={manualEntry.position === 'top'} onChange={() => setManualEntry({...manualEntry, position: 'top'})} /> Top</label>
                <label className="flex items-center gap-2 cursor-pointer text-[10px] font-mono uppercase"><input type="radio" name="position" className="radio radio-xs radio-primary" checked={manualEntry.position === 'bottom'} onChange={() => setManualEntry({...manualEntry, position: 'bottom'})} /> Bottom</label>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setManualEntry({ title: '', year: '', timestamp: '', modifier: '', note: '', type: '', source_url: '', source_tweet_id: '', position: manualEntry.position })} className="btn btn-sm btn-ghost text-base-content/50 hover:text-error rounded-none font-mono uppercase tracking-widest text-[10px]">Clear</button>
                <button onClick={handleAddManualEntry} disabled={!manualEntry.title.trim()} className="btn btn-sm btn-primary rounded-none font-mono uppercase tracking-widest text-[10px]">Add to Queue</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-6 mt-4">
        <div className="flex flex-wrap justify-between items-center border-b border-base-300 pb-2 gap-4">
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-base-content/50">2. Resolve Matches & System Backup</div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer label p-0 gap-2 mr-2 border-r border-base-300 pr-4 tooltip tooltip-bottom" data-tip="When disabled, selecting a category will only tag the item. Use Auto-Fetch to search them all at once.">
              <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={autoSearchOnTypeSelect} onChange={e => setAutoSearchOnTypeSelect(e.target.checked)} disabled={isAutoProcessing || isBatchCommitting} />
              <span className="label-text text-[10px] font-mono uppercase tracking-widest opacity-70 mt-0.5">Auto-Search Type</span>
            </label>
            {readyToCommitCount > 0 && (
              <button onClick={handleBatchCommit} disabled={isBatchCommitting || isAutoProcessing} className="btn btn-xs btn-success rounded-none font-mono uppercase tracking-widest text-[10px] text-success-content shadow-md shadow-success/20">
                {isBatchCommitting ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Committing {batchCommitProgress.current}/{batchCommitProgress.total}...</> : <><Check className="w-3 h-3 mr-1" /> Batch Add Ready Items ({readyToCommitCount})</>}
              </button>
            )}
            {isAutoProcessing ? (
              <button onClick={() => setIsAutoProcessing(false)} disabled={isBatchCommitting} className="btn btn-xs btn-error rounded-none font-mono uppercase tracking-widest text-[10px] text-error-content shadow-md shadow-error/20">
                <Loader2 className="w-3 h-3 animate-spin mr-1" /> Pause Fetching ({autoProgress.current}/{autoProgress.total})
              </button>
            ) : itemsReadyToProcess > 0 ? (
              <button onClick={handleAutoPopulate} disabled={isBatchCommitting || isAutoProcessing} className="btn btn-xs btn-primary rounded-none font-mono uppercase tracking-widest text-[10px]">
                <Play className="w-3 h-3 mr-1" /> Auto-Fetch API Results ({itemsReadyToProcess})
              </button>
            ) : null}
            
            <div className="h-4 w-px bg-base-300 mx-2 hidden sm:block"></div>
            
            <button onClick={() => restoreFileRef.current?.click()} disabled={isBatchCommitting || isAutoProcessing} className="btn btn-xs btn-outline rounded-none font-mono uppercase tracking-widest text-[10px]">
              <Upload className="w-3 h-3 mr-1" /> Restore Library
            </button>
            <button onClick={handleExportLibrary} disabled={isBatchCommitting || isAutoProcessing} className="btn btn-xs btn-outline rounded-none font-mono uppercase tracking-widest text-[10px]">
              <Save className="w-3 h-3 mr-1" /> Backup Library
            </button>
            {importQueue.length > 0 && (
              <button onClick={handleExportQueue} disabled={isBatchCommitting || isAutoProcessing} className="btn btn-xs btn-outline rounded-none font-mono uppercase tracking-widest text-[10px]">
                <Save className="w-3 h-3 mr-1" /> Backup Queue
              </button>
            )}
            {pendingItems.length > 0 && (
              <button onClick={() => { if (window.confirm("Are you sure you want to clear all pending items? Ready items will be kept.")) clearPendingImportQueue(); }} disabled={isBatchCommitting || isAutoProcessing} className="btn btn-xs btn-outline border-warning text-warning hover:bg-warning hover:text-warning-content rounded-none font-mono uppercase tracking-widest text-[10px]">
                <X className="w-3 h-3 mr-1" /> Clear Pending
              </button>
            )}
            {importQueue.length > 0 && (
              <button onClick={() => { if (window.confirm("Are you sure you want to permanently clear the entire queue?")) clearImportQueue(); }} disabled={isBatchCommitting || isAutoProcessing} className="btn btn-xs btn-outline border-error text-error hover:bg-error hover:text-error-content rounded-none font-mono uppercase tracking-widest text-[10px]">
                <X className="w-3 h-3 mr-1" /> Clear Queue
              </button>
            )}
          </div>
        </div>
        
        {importQueue.length === 0 ? (
          <div className="py-20 text-center flex flex-col items-center justify-center gap-4 opacity-50 bg-base-200/50 border border-base-300 border-dashed">
            <Check className="w-12 h-12" />
            <p className="font-mono text-sm uppercase tracking-widest">Queue is empty</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {readyItems.length > 0 && (
              <div className="bg-base-200/30 border border-success/30 flex flex-col">
                <button 
                  onClick={() => setIsReadySectionOpen(!isReadySectionOpen)}
                  className="w-full flex items-center justify-between p-3 bg-success/10 hover:bg-success/20 transition-colors cursor-pointer border-b border-success/20"
                >
                  <div className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-success" />
                    <span className="font-mono font-bold text-success uppercase tracking-widest text-xs">Ready to Add ({readyItems.length})</span>
                  </div>
                  {isReadySectionOpen ? <ChevronUp className="w-5 h-5 text-success" /> : <ChevronDown className="w-5 h-5 text-success" />}
                </button>
                {isReadySectionOpen && (
                  <div className="p-3 sm:p-4 flex flex-col gap-4 bg-base-100">
                    {readyItems.map(item => (
                      <div key={item.id} className="transition-all duration-200">
                        <QueueItem 
                          item={item} 
                          globalIndex={importQueue.findIndex(i => i.id === item.id) + 1}
                          totalCount={importQueue.length}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div ref={listRef} className="w-full relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const virtualItem = pendingItems[virtualRow.index];
                    return (
                      <div
                        key={virtualItem.id}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        className="absolute top-0 left-0 w-full"
                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                      >
                        <div className="pb-6 transition-all duration-200">
                          <QueueItem 
                            item={virtualItem} 
                            globalIndex={importQueue.findIndex(i => i.id === virtualItem.id) + 1}
                            totalCount={importQueue.length}
                          />
                        </div>
                      </div>
                    );
                  })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};