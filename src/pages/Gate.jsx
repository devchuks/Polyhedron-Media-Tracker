import React, { useState, useEffect } from 'react';
import { User, LogIn, ArrowLeft, ShieldAlert, Loader2, Eye, EyeOff, Palette } from 'lucide-react';
import { useMediaStore } from '../store/useMediaStore';
import { supabase } from '../services/supabase';
import { THEMES } from '../components/Layout';

const PolyhedronLogo = () => (
  <div className="w-16 h-16 mb-4 relative z-10 flex items-center justify-center text-primary-content">
    {/* Outer slow-spinning geometric shell */}
    <svg viewBox="0 0 100 100" className="absolute w-full h-full stroke-current fill-transparent stroke-[1.5] animate-[spin_12s_linear_infinite]">
      <polygon points="50,5 93,25 93,75 50,95 7,75 7,25" />
      <line x1="50" y1="5" x2="50" y2="95" />
      <line x1="7" y1="25" x2="93" y2="75" />
      <line x1="7" y1="75" x2="93" y2="25" />
    </svg>
    {/* Inner fast-spinning reverse shape */}
    <svg viewBox="0 0 100 100" className="absolute w-full h-full stroke-current fill-current opacity-20 stroke-[2] animate-[spin_8s_linear_infinite_reverse]">
      <polygon points="50,15 80,50 50,85 20,50" />
      <line x1="20" y1="50" x2="80" y2="50" />
      <line x1="50" y1="15" x2="50" y2="85" />
    </svg>
    {/* Core pulsing diamond */}
    <div className="w-3 h-3 bg-current rotate-45 animate-pulse shadow-[0_0_15px_currentColor]"></div>
  </div>
);

export const Gate = () => {
  const { setAuthMode } = useMediaStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved && THEMES.includes(saved) ? saved : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(false);
    
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      
      if (authError) {
        setError(true);
        setIsLoading(false);
      } else if (data.user) {
        setAuthMode('admin');
      }
    } catch (err) {
      setError(true);
      setIsLoading(false);
    }
  };

  const handleGuestLogin = () => {
    setAuthMode('guest');
  };

  return (
    <div className="fixed inset-0 bg-base-200 flex flex-col items-center justify-center p-4 sm:p-8 font-sans overflow-y-auto z-50" style={{ overscrollBehavior: 'none' }}>
      <style>{`
        @keyframes slide-bg {
          0% { background-position: 0px 0px; }
          100% { background-position: 48px 48px; }
        }
      `}</style>
      
      {/* Subtle Circuit Board Background */}
      <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)', backgroundSize: '24px 24px', animation: 'slide-bg 6s linear infinite' }}></div>
      <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, currentColor 1.5px, transparent 0)', backgroundSize: '48px 48px', animation: 'slide-bg 8s linear infinite reverse' }}></div>
      
      <div className="max-w-md w-full bg-base-100 border border-base-300 rounded-none shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 fade-in duration-500 relative z-10">
        
        {!showLoginForm && (
          <div className="p-8 sm:p-10 bg-primary text-primary-content flex flex-col items-center text-center relative overflow-hidden">
            <PolyhedronLogo />
            <h1 className="text-3xl font-black uppercase tracking-widest mb-2 relative z-10 flex items-center gap-2">Polyhedron<span className="w-3 h-5 bg-primary-content animate-pulse"></span></h1>
            <p className="text-xs font-mono uppercase tracking-widest opacity-90 relative z-10 leading-relaxed">
Unified media tracker. Log and keep track of movies, TV shows, games, anime, manga, visual novels, books and comics *catches breath* all_in_one_place.
            </p>
          </div>
        )}

        {/* Body Section */}
        <div className="p-8 sm:p-10 flex flex-col gap-4">
          {!showLoginForm ? (
            <div className="flex flex-col gap-4 animate-in slide-in-from-left-4 fade-in duration-300">
              <button onClick={handleGuestLogin} className="flex items-center justify-center gap-2 w-full h-14 bg-primary hover:bg-primary/90 text-primary-content rounded-none appearance-none font-mono font-bold uppercase tracking-widest text-sm transition-colors">
                <User className="w-5 h-5" />
                Enter as Guest
              </button>
              <button onClick={() => setShowLoginForm(true)} className="flex items-center justify-center gap-2 w-full h-14 bg-transparent border border-base-300 hover:border-primary hover:text-primary rounded-none appearance-none font-mono font-bold uppercase tracking-widest text-sm transition-colors">
                <LogIn className="w-5 h-5" />
                Admin Login (no try am)
              </button>
              <p className="text-[10px] text-center text-base-content/50 mt-4 leading-relaxed font-mono uppercase tracking-widest">
                Guest mode stores data locally in your browser and will not sync. Purely for testing/showcase purposes
              </p>
            </div>
          ) : (
            <form onSubmit={handleAdminLogin} className="flex flex-col gap-4 animate-in slide-in-from-right-4 fade-in duration-300">
              <button type="button" onClick={() => setShowLoginForm(false)} className="flex items-center justify-center h-8 px-3 bg-transparent hover:bg-base-200 text-base-content/60 hover:text-base-content rounded-none appearance-none font-mono font-bold uppercase tracking-widest text-[10px] self-start -ml-2 mb-2 transition-colors">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </button>
              
              <div className="form-control w-full">
                <label className="label pt-0"><span className="label-text text-[10px] font-mono font-bold uppercase tracking-widest">Email Address</span></label>
                <input type="email" placeholder="admin@example.com" value={email} onChange={e => setEmail(e.target.value)} className={`w-full h-12 px-4 bg-base-200 focus:bg-base-100 border ${error ? 'border-error text-error bg-error/5' : 'border-base-300 focus:border-primary'} rounded-none appearance-none font-mono text-base sm:text-sm focus:outline-none transition-colors`} required />
              </div>

              <div className="form-control w-full relative">
                <label className="label"><span className="label-text text-[10px] font-mono font-bold uppercase tracking-widest">Password</span></label>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} className={`w-full h-12 pl-4 pr-12 bg-base-200 focus:bg-base-100 border ${error ? 'border-error text-error bg-error/5' : 'border-base-300 focus:border-primary'} rounded-none appearance-none font-mono text-base sm:text-sm focus:outline-none transition-colors`} required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content transition-colors focus:outline-none p-1">
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-error/10 text-error rounded-none border border-error/20 text-[10px] font-mono uppercase tracking-widest font-bold flex items-center gap-2 mt-1">
                  <ShieldAlert className="w-4 h-4 shrink-0" /> Invalid email or password
                </div>
              )}

              <button type="submit" disabled={isLoading || !email || !password} className="flex items-center justify-center w-full h-12 mt-4 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-content rounded-none appearance-none font-mono font-bold uppercase tracking-widest text-sm transition-colors">
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Sign In'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Theme Switcher */}
      <div className="absolute bottom-4 left-4 sm:bottom-6 sm:left-6 z-20">
        <div role="button" tabIndex={0} onClick={() => setIsThemeOpen(!isThemeOpen)} className="flex items-center justify-center w-10 h-10 bg-base-100 border border-base-300 hover:border-primary text-base-content/70 hover:text-primary rounded-none transition-colors appearance-none shadow-xl cursor-pointer relative z-[61]">
          <Palette className="w-4 h-4" />
        </div>
        {isThemeOpen && (
          <>
            <div className="fixed inset-0 z-[50]" onClick={() => setIsThemeOpen(false)}></div>
            <div className="absolute bottom-full left-0 mb-2 z-[60] shadow-2xl bg-base-100 border border-base-300 w-64 sm:w-80 rounded-none text-[10px] font-mono uppercase font-bold tracking-widest animate-in slide-in-from-bottom-2 duration-150 overflow-hidden flex flex-col">
              <div className="p-2 sm:p-3 flex flex-col max-h-[60vh] sm:max-h-[70vh]">
                <div className="text-[9px] opacity-50 px-1 mb-2 shrink-0">Theme</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 overflow-y-auto custom-scrollbar pr-1 pb-1">
                  {THEMES.map(t => (
                    <button type="button" key={t} onClick={() => { setTheme(t); setIsThemeOpen(false); }} className={`flex items-center justify-start px-2 py-1.5 min-h-0 text-[9px] font-mono uppercase tracking-wider text-left rounded-none border transition-colors ${theme === t ? 'bg-primary text-primary-content border-primary' : 'bg-base-200 border-base-300 text-base-content/70 hover:bg-base-300 hover:text-base-content hover:border-primary/50'}`}>
                      <span className="truncate">{t}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  );
};