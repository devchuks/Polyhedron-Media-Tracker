import { useState } from 'react';
import { Loader2, Link2, RefreshCw, Unlink } from 'lucide-react';
import { confirmAction, useMediaStore, useUIStore } from '../store/useMediaStore';
import { linkLetterboxd, normalizeLetterboxdUsername, readLetterboxdLink, syncLetterboxdNow, unlinkLetterboxd } from '../services/letterboxdSync';

const buttonClass = 'flex items-center justify-center h-10 px-4 border rounded-none appearance-none font-mono text-xs uppercase tracking-widest gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-fit';

// Settings section: films logged on Letterboxd after linking are added to the library and diary
// (with rating and review) whenever the site is opened. Earlier Letterboxd entries are not imported.
export const LetterboxdLink = () => {
  const ownerId = useMediaStore(state => state.ownerId);
  const addToast = useUIStore(state => state.addToast);
  const [link, setLink] = useState(() => readLetterboxdLink(ownerId));
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const connect = async () => {
    const name = normalizeLetterboxdUsername(username);
    if (!name) return;
    setBusy('link');
    setError('');
    try {
      const count = await linkLetterboxd({ ownerId, username: name });
      setLink(readLetterboxdLink(ownerId));
      addToast(`Linked Letterboxd. ${count} existing entries skipped; new ones will sync when you open the site.`, 'success');
    } catch {
      setError('That Letterboxd profile could not be read. Check the username and retry.');
    } finally {
      setBusy('');
    }
  };

  const checkNow = async () => {
    setBusy('check');
    const result = await syncLetterboxdNow(ownerId);
    setLink(readLetterboxdLink(ownerId));
    if (result && !result.applied && !result.failed) addToast('Letterboxd is up to date.', 'success');
    if (!result) addToast('Letterboxd could not be reached. Please retry.', 'error');
    setBusy('');
  };

  const unlink = async () => {
    if (!await confirmAction({ title: 'Unlink Letterboxd?', message: 'Syncing stops. Your library and diary stay as they are.', confirmLabel: 'Unlink', danger: false })) return;
    unlinkLetterboxd(ownerId);
    setLink(null);
  };

  return (
    <div className="bg-base-100 border border-base-300 p-6 flex flex-col gap-4">
      <h2 className="text-sm font-black uppercase tracking-widest">Letterboxd Sync</h2>
      {link ? (
        <>
          <p className="text-xs font-mono text-base-content/70">
            Linked to <a href={`https://letterboxd.com/${encodeURIComponent(link.username)}/`} target="_blank" rel="noreferrer" className="text-primary underline">{link.username}</a>.
            Films you log on Letterboxd are added here, with rating and review, each time you open the site
            {link.lastSyncedAt ? ` (last update ${new Date(link.lastSyncedAt).toLocaleString()})` : ''}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={checkNow} disabled={Boolean(busy)} className={`${buttonClass} border-primary text-primary hover:bg-primary hover:text-primary-content`}>
              {busy === 'check' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Check now
            </button>
            <button type="button" onClick={unlink} disabled={Boolean(busy)} className={`${buttonClass} border-base-300 text-base-content/70 hover:bg-base-200`}>
              <Unlink className="w-4 h-4" /> Unlink
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs font-mono text-base-content/70">Link your Letterboxd profile. Entries already on Letterboxd are skipped; films you log there from now on sync to your library and diary.</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={username}
              onChange={event => setUsername(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void connect(); }}
              placeholder="Letterboxd username or profile link"
              aria-label="Letterboxd username"
              className="h-10 px-3 flex-1 min-w-[220px] font-mono text-xs rounded-none border border-base-300 bg-base-100 focus:outline-none focus:border-primary"
            />
            <button type="button" onClick={connect} disabled={Boolean(busy) || !username.trim()} className={`${buttonClass} border-primary text-primary hover:bg-primary hover:text-primary-content`}>
              {busy === 'link' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Link Letterboxd
            </button>
          </div>
        </>
      )}
      {error && <p role="alert" className="text-xs font-mono text-error">{error}</p>}
    </div>
  );
};
