import { useState } from 'react';
import { Loader2, Link2, RefreshCw, Unlink } from 'lucide-react';
import { confirmAction, useMediaStore, useUIStore } from '../store/useMediaStore';

const buttonClass = 'flex items-center justify-center h-10 px-4 border rounded-none appearance-none font-mono text-xs uppercase tracking-widest gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-fit';

/**
 * Settings card for a one-way sync from another site (AniList, Letterboxd, VNDB). Linking records
 * what is already there as seen; later changes sync each time the site is opened. Owner-only:
 * Settings renders these cards for signed-in accounts, never for guest mode.
 */
export const SyncLinkCard = ({
  service, readLink, linkAccount, syncNow, unlink, normalizeUsername, profileUrl, linkedSummary, intro, placeholder,
}) => {
  const ownerId = useMediaStore(state => state.ownerId);
  const addToast = useUIStore(state => state.addToast);
  const [link, setLink] = useState(() => readLink(ownerId));
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const connect = async () => {
    const name = normalizeUsername(username);
    if (!name) return;
    setBusy('link');
    setError('');
    try {
      const count = await linkAccount({ ownerId, username: name });
      setLink(readLink(ownerId));
      addToast(`Linked ${service}. ${count} existing entries skipped; new changes will sync when you open the site.`, 'success');
    } catch {
      setError(`That ${service} profile could not be read. Check the username and that it is public.`);
    } finally {
      setBusy('');
    }
  };

  const checkNow = async () => {
    setBusy('check');
    const result = await syncNow(ownerId);
    setLink(readLink(ownerId));
    if (result && !result.applied && !result.failed) addToast(`${service} is up to date.`, 'success');
    if (!result) addToast(`${service} could not be reached. Please retry.`, 'error');
    setBusy('');
  };

  const disconnect = async () => {
    if (!await confirmAction({ title: `Unlink ${service}?`, message: 'Syncing stops. Your library and diary stay as they are.', confirmLabel: 'Unlink', danger: false })) return;
    unlink(ownerId);
    setLink(null);
  };

  return (
    <div className="bg-base-100 border border-base-300 p-6 flex flex-col gap-4">
      <h2 className="text-sm font-black uppercase tracking-widest">{service} Sync</h2>
      {link ? (
        <>
          <p className="text-xs font-mono text-base-content/70">
            Linked to <a href={profileUrl(link)} target="_blank" rel="noreferrer" className="text-primary underline">{link.username}</a>.
            {' '}{linkedSummary}
            {link.lastSyncedAt ? ` (last update ${new Date(link.lastSyncedAt).toLocaleString()})` : ''}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={checkNow} disabled={Boolean(busy)} className={`${buttonClass} border-primary text-primary hover:bg-primary hover:text-primary-content`}>
              {busy === 'check' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Check now
            </button>
            <button type="button" onClick={disconnect} disabled={Boolean(busy)} className={`${buttonClass} border-base-300 text-base-content/70 hover:bg-base-200`}>
              <Unlink className="w-4 h-4" /> Unlink
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs font-mono text-base-content/70">{intro}</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={username}
              onChange={event => setUsername(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void connect(); }}
              placeholder={placeholder}
              aria-label={`${service} username`}
              className="h-10 px-3 flex-1 min-w-[220px] font-mono text-xs rounded-none border border-base-300 bg-base-100 focus:outline-none focus:border-primary"
            />
            <button type="button" onClick={connect} disabled={Boolean(busy) || !username.trim()} className={`${buttonClass} border-primary text-primary hover:bg-primary hover:text-primary-content`}>
              {busy === 'link' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Link {service}
            </button>
          </div>
        </>
      )}
      {error && <p role="alert" className="text-xs font-mono text-error">{error}</p>}
    </div>
  );
};
