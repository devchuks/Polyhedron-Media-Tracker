import React, { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Menu, Search, User, Home, Tv, Film, Gamepad2, Eye, Star, BookOpen, Book, Image as ImageIcon, CalendarDays, X, Loader2 } from 'lucide-react';
import { SearchModal, ToastContainer, GlobalDiaryModal } from './UI'; // Added GlobalDiaryModal
import { apiRegistry } from '../services/apiRegistry';
import { useMediaStore } from '../store/useMediaStore';
import { Gate } from '../pages/Gate';
import { supabase } from '../services/supabase';

const THEMES = [
  'light', 'dark', 'cupcake', 'bumblebee', 'emerald', 'corporate', 'synthwave', 'retro',
  'cyberpunk', 'valentine', 'halloween', 'garden', 'forest', 'aqua', 'lofi', 'pastel',
  'fantasy', 'wireframe', 'black', 'luxury', 'dracula', 'cmyk', 'autumn', 'business',
  'acid', 'lemonade', 'night', 'coffee', 'winter', 'dim', 'nord', 'sunset', 'big_error'
];

const GlobalLightbox = () => {
  const { globalLightbox, globalLightboxIndex, setGlobalLightbox } = useMediaStore();

  useEffect(() => {
    if (globalLightbox) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [globalLightbox]);

  useEffect(() => {
    if (!globalLightbox) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') setGlobalLightbox(null);
      if (e.key === 'ArrowRight') setGlobalLightbox(globalLightbox, (globalLightboxIndex + 1) % globalLightbox.length);
      if (e.key === 'ArrowLeft') setGlobalLightbox(globalLightbox, (globalLightboxIndex - 1 + globalLightbox.length) % globalLightbox.length);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [globalLightbox, globalLightboxIndex, setGlobalLightbox]);

  if (!globalLightbox) return null;

  return (
    <div className="fixed inset-0 z-[99999] bg-black/95 flex flex-col items-center justify-center backdrop-blur-xl animate-in fade-in duration-200" onClick={() => setGlobalLightbox(null)}>
      <button onClick={() => setGlobalLightbox(null)} className="flex items-center justify-center w-11 h-11 sm:w-11 sm:h-11 bg-transparent hover:bg-white/20 text-white rounded-none appearance-none transition-colors z-[100001] absolute top-4 right-4 sm:top-6 sm:right-6">
        <X className="w-8 h-8" />
      </button>
      <div className="flex-1 w-full flex items-center justify-center p-4 lg:p-12 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <img key={globalLightboxIndex} src={globalLightbox[globalLightboxIndex]} alt="Gallery Full" className="max-w-full max-h-[85vh] object-contain shadow-2xl border border-white/10" />
      </div>
      {globalLightbox.length > 1 && (
        <div className="h-20 sm:h-24 w-full flex items-center justify-center gap-6 sm:gap-12 shrink-0 bg-black/60 border-t border-white/5 backdrop-blur-md" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setGlobalLightbox(globalLightbox, (globalLightboxIndex - 1 + globalLightbox.length) % globalLightbox.length)} className="flex items-center justify-center w-11 h-11 bg-transparent hover:bg-white/20 text-white rounded-full appearance-none transition-colors"><ChevronLeft className="w-8 h-8" /></button>
          <span className="font-mono text-xs sm:text-sm font-bold tracking-[0.2em] text-white/90 px-4 py-1.5 border border-white/20 bg-black/40">{globalLightboxIndex + 1} / {globalLightbox.length}</span>
          <button onClick={() => setGlobalLightbox(globalLightbox, (globalLightboxIndex + 1) % globalLightbox.length)} className="flex items-center justify-center w-11 h-11 bg-transparent hover:bg-white/20 text-white rounded-full appearance-none transition-colors"><ChevronRight className="w-8 h-8" /></button>
        </div>
      )}
    </div>
  );
};

export const Header = ({ onSearch, theme, setTheme }) => {
  const { authMode, isCloudSyncing } = useMediaStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('movies');
  const location = useLocation();
  const navigate = useNavigate();

  // NEW: Automatically sync search dropdown with sidebar navigation
  useEffect(() => {
    const currentType = location.pathname.split('/')[1]; 
    const validTypes = ['movies', 'tv', 'games', 'anime', 'manga', 'vn', 'books', 'comics'];
    if (validTypes.includes(currentType)) {
      setSearchType(currentType);
    }
  }, [location.pathname]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('global-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) onSearch(searchQuery, searchType, 1);
  };

  return (
    <header className="bg-base-100 border-b border-base-300 flex items-center justify-between sticky top-0 z-40 h-14 w-full">
      <div className="flex items-center h-full border-r border-base-300 shrink-0 lg:w-64">
        <label htmlFor="main-drawer" className="flex items-center justify-center px-4 h-full cursor-pointer hover:bg-base-200 transition-colors lg:hidden">
          <Menu className="w-5 h-5 text-base-content/70" />
        </label>
        <h1 className="text-lg font-bold text-primary uppercase tracking-widest font-['Space_Mono'] hidden lg:block px-6">Polyhedron</h1>
      </div>

      <div className="flex-1 flex h-full items-center justify-start pl-6 sm:pl-10 pr-2 sm:pr-4 min-w-0">
        <form onSubmit={handleSearch} className="flex h-9 w-full max-w-2xl items-center border border-base-300 bg-base-200 focus-within:border-primary transition-colors overflow-hidden">
          <input 
            id="global-search-input" type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="h-full px-3 w-full bg-transparent border-none focus:outline-none text-[10px] sm:text-xs font-mono uppercase tracking-wider text-base-content placeholder:text-base-content/40 min-w-0 appearance-none" 
          />
          <div className="h-full w-px bg-base-300 shrink-0"></div>
          <select 
            value={searchType} onChange={(e) => setSearchType(e.target.value)}
            className="h-full bg-transparent border-none focus:outline-none text-[10px] sm:text-[10px] font-mono uppercase font-bold tracking-widest px-2 cursor-pointer text-base-content/70 hover:text-base-content shrink-0 appearance-none"
          >
            <option value="movies">MOVIES</option>
            <option value="tv">TV</option>
            <option value="games">GAMES</option>
            <option value="anime">ANIME</option>
            <option value="manga">MANGA</option>
            <option value="vn">VN</option>
            <option value="books">BOOKS</option>
            <option value="comics">COMICS</option>
          </select>
          <button type="submit" className="h-full px-3 border-l border-base-300 hover:bg-primary hover:text-primary-content transition-colors flex items-center justify-center shrink-0">
            <Search className="w-4 h-4" />
          </button>
        </form>
        {isCloudSyncing && (
          <div className="ml-4 flex items-center gap-2 text-primary opacity-70 shrink-0" title="Synchronizing Databank"><Loader2 className="w-4 h-4 animate-spin" /></div>
        )}
      </div>

      <div className="dropdown dropdown-end h-full">
        <div tabIndex={0} role="button" className="h-full border-l border-base-300 flex items-center px-4 sm:px-6 cursor-pointer hover:bg-base-200 transition-colors shrink-0">
          <User className="w-5 h-5 text-base-content/70" />
        </div>
        <ul tabIndex={0} className="dropdown-content z-[60] menu p-2 shadow-2xl bg-base-100 border border-base-300 w-56 mt-0 rounded-none text-[10px] font-mono uppercase font-bold tracking-widest">
          <li className="menu-title text-[9px] opacity-50 px-4 py-2 border-b border-base-300 mb-1">Account</li>
          <li><a>Profile</a></li>
          <li><Link to="/settings" onClick={() => document.activeElement.blur()}>Settings</Link></li>
        {authMode === 'admin' && (
          <li><Link to="/import" onClick={() => document.activeElement.blur()} className="text-primary">Terminal (Import)</Link></li>
        )}
          <li><a onClick={async () => { await supabase.auth.signOut(); useMediaStore.getState().setAuthMode(null); navigate('/'); document.activeElement.blur(); }} className="text-error mt-2">Logout</a></li>
          <div className="divider my-0 opacity-50"></div>
          <li className="menu-title text-[9px] opacity-50 px-4 py-2 border-b border-base-300 mb-1">Theme</li>
          <div className="max-h-64 overflow-y-auto custom-scrollbar flex flex-col gap-0.5">
            {THEMES.map(t => (
              <li key={t}>
                <a onClick={() => { setTheme(t); document.activeElement.blur(); }} className={theme === t ? 'text-primary bg-base-200' : ''}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </a>
              </li>
            ))}
          </div>
        </ul>
      </div>
    </header>
  );
};

export const Sidebar = () => {
  const location = useLocation();

  const checkIsActive = (path) => {
    if (location.pathname === path) return true;
    if (path !== '/' && location.pathname.startsWith(`/media${path}`)) return true;
    return false;
  };

  const getNavClass = (path) => {
    const isActive = checkIsActive(path);
    return `flex items-center gap-3 px-6 py-3 w-full text-xs font-mono font-bold uppercase tracking-wider transition-none border-l-4 ${
      isActive ? 'bg-primary text-primary-content border-primary-content' : 'border-transparent text-base-content/60 hover:bg-base-200 hover:text-base-content'
    }`;
  };

  const closeDrawer = () => document.getElementById('main-drawer')?.click();

  return (
    <div className="drawer-side z-50">
      <label htmlFor="main-drawer" aria-label="close sidebar" className="drawer-overlay"></label>
      <div className="bg-base-100 h-full w-64 border-r border-base-300 flex flex-col pt-0">
        <div className="flex items-center h-14 border-b border-base-300 px-4 lg:hidden bg-base-100 shrink-0">
          <h2 className="text-lg font-bold text-primary uppercase tracking-wider font-['Space_Grotesk']">Polyhedron</h2>
        </div>
        
        <div className="flex-1 flex flex-col w-full overflow-y-auto custom-scrollbar" onClick={closeDrawer}>
          <div className="px-6 py-3 mt-2 text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-base-content/40 shrink-0">Library</div>
          <Link to="/" className={getNavClass('/')}><Home className="w-4 h-4 shrink-0" /> Dashboard</Link>
          <Link to="/tv" className={getNavClass('/tv')}><Tv className="w-4 h-4 shrink-0" /> TV Shows</Link>
          <Link to="/movies" className={getNavClass('/movies')}><Film className="w-4 h-4 shrink-0" /> Movies</Link>
          <Link to="/games" className={getNavClass('/games')}><Gamepad2 className="w-4 h-4 shrink-0" /> Games</Link>
          <Link to="/vn" className={getNavClass('/vn')}><Eye className="w-4 h-4 shrink-0" /> Visual Novels</Link>
          <Link to="/anime" className={getNavClass('/anime')}><Star className="w-4 h-4 shrink-0" /> Anime</Link>
          <Link to="/manga" className={getNavClass('/manga')}><BookOpen className="w-4 h-4 shrink-0" /> Manga</Link>
          <Link to="/books" className={getNavClass('/books')}><Book className="w-4 h-4 shrink-0" /> Books</Link>
          <Link to="/comics" className={getNavClass('/comics')}><ImageIcon className="w-4 h-4 shrink-0" /> Comics</Link>
          <div className="px-6 py-3 mt-4 text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-base-content/40 border-t border-base-300 shrink-0">Activity</div>
          <Link to="/diary" className={getNavClass('/diary')}><CalendarDays className="w-4 h-4 shrink-0" /> Diary</Link>
        </div>
      </div>
    </div>
  );
};

export const AppLayout = () => {
  const navigate = useNavigate();
  const { authMode, _hasHydrated } = useMediaStore();

  const [searchState, setSearchState] = useState({
    isOpen: false, isLoading: false, query: '', type: 'movies', results: [], page: 1, totalPages: 1
  });
  const searchRequestIdRef = useRef(0);

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved && THEMES.includes(saved) ? saved : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Prevent native pull-to-refresh on mobile browsers
  useEffect(() => {
    document.body.style.overscrollBehaviorY = 'none';
    return () => { document.body.style.overscrollBehaviorY = 'auto'; };
  }, []);

  const handleGlobalSearch = async (query, type, page = 1) => {
    setSearchState(prev => ({ ...prev, isOpen: true, isLoading: true, query, type, page }));
    const requestId = ++searchRequestIdRef.current;
    
    try {
      let response = { results: [], totalPages: 1 };
      switch (type) {
        case 'movies': response = await apiRegistry.searchMovies(query, page); break;
        case 'tv': response = await apiRegistry.searchTV(query, page); break;
        case 'games': response = await apiRegistry.searchGames(query, page); break;
        case 'anime': response = await apiRegistry.searchAnime(query, page); break;
        case 'manga': response = await apiRegistry.searchManga(query, page); break;
        case 'comics': response = await apiRegistry.searchComics(query, page); break;
        case 'vn': response = await apiRegistry.searchVNs(query, page); break;
        case 'books': response = await apiRegistry.searchBooks(query, page); break;
        default: break;
      }
      if (requestId === searchRequestIdRef.current) {
        setSearchState(prev => ({ ...prev, isLoading: false, results: response.results, totalPages: response.totalPages }));
      }
    } catch (error) {
      if (requestId === searchRequestIdRef.current) {
        setSearchState(prev => ({ ...prev, isLoading: false, results: [], totalPages: 1 }));
      }
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= searchState.totalPages) {
      handleGlobalSearch(searchState.query, searchState.type, newPage);
    }
  };

  const handleSelectItem = (apiItem) => {
    setSearchState(prev => ({ ...prev, isOpen: false }));
    navigate(`/media/${searchState.type}/${apiItem.id}`, { state: { previewData: apiItem } });
  };

  if (!_hasHydrated) return <div className="min-h-screen bg-base-200"></div>;
  if (!authMode) return <Gate />;

  return (
    <div className="drawer lg:drawer-open bg-base-200 min-h-screen font-sans">
      <input id="main-drawer" type="checkbox" className="drawer-toggle" />
      <div className="drawer-content flex flex-col min-h-screen relative">
        <Header onSearch={(q, t) => handleGlobalSearch(q, t, 1)} theme={theme} setTheme={setTheme} />
        <main className="flex-1 p-4 lg:p-6 w-full mx-auto relative">
          <Outlet />
        </main>

        <SearchModal
          isOpen={searchState.isOpen} isLoading={searchState.isLoading} query={searchState.query}
          type={searchState.type} results={searchState.results} page={searchState.page}
          totalPages={searchState.totalPages} onClose={() => setSearchState(prev => ({ ...prev, isOpen: false }))}
          onSelect={handleSelectItem} onPageChange={handlePageChange}
        />
        <ToastContainer />
        <GlobalLightbox />
        
        {/* NEW: Global Logging Modal Mounted Here */}
        <GlobalDiaryModal />
      </div>
      <Sidebar />
    </div>
  );
};