import { useState } from 'react';
import { Loader2, Link2, RefreshCw, Unlink } from 'lucide-react';
import { confirmAction, useMediaStore, useUIStore } from '../store/useMediaStore';
import { normalizeAniListUsername } from '../services/anilistClient';
import { linkAniList, previewAniListLink, readAniListLink, syncAniListNow, unlinkAniList } from '../services/anilistSync';

const buttonClass = 'flex items-center justify-center h-10 px-4 border rounded-none appearance-none font-mono text-xs uppercase tracking-widest gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-fit';

// Settings section: link a public AniList list so anime/manga changes made there (including by
// apps such as Tachiyomi) sync into the library and diary whenever the site is opened.
export const AniListLink = () => {
  const ownerId = useMediaStore(state => state.ownerId);
  const addToast = useUIStore(state => state.addToast);
  const [link, setLink] = useState(() => readAniListLink(ownerId));
  const [username, setUsername] = useState('');
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState('track');
  const [createHistory, setCreateHistory] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const findList = async () => {
    const name = normalizeAniListUsername(username);
    if (!name) return;
    setBusy('preview');
    setError('');
    try {
      setPreview({ username: name, ...(await previewAniListLink(name)) });
    } catch {
      setError('That AniList list could not be read. Check the username and that the list is public.');
    } finally {
      setBusy('');
    }
  };

  const confirmLink = async () => {
    setBusy('link');
    try {
      const result = await linkAniList({ ownerId, username: preview.username, entries: preview.entries, mode, createHistory });
      setLink(readAniListLink(ownerId));
      setPreview(null);
      addToast(mode === 'import'
        ? `Linked AniList and imported ${result.applied} change${result.applied === 1 ? '' : 's'}.`
        : 'Linked AniList. New changes there will sync when you open the site.', 'success');
    } catch {
      setError('Linking failed. Nothing was changed; please retry.');
    } finally {
      setBusy('');
    }
  };

  const checkNow = async () => {
    setBusy('check');
    const result = await syncAniListNow(ownerId);
    setLink(readAniListLink(ownerId));
    if (result && !result.applied && !result.failed) addToast('AniList is up to date.', 'success');
    if (!result) addToast('AniList could not be reached. Please retry.', 'error');
    setBusy('');
  };

  const unlink = async () => {
    if (!await confirmAction({ title: 'Unlink AniList?', message: 'Syncing stops. Your library and diary stay as they are.', confirmLabel: 'Unlink', danger: false })) return;
    unlinkAniList(ownerId);
    setLink(null);
  };

  return (
    <div className="bg-base-100 border border-base-300 p-6 flex flex-col gap-4">
      <h2 className="text-sm font-black uppercase tracking-widest">AniList Sync</h2>
      {link ? (
        <>
          <p className="text-xs font-mono text-base-content/70">
            Linked to <a href={`https://anilist.co/user/${encodeURIComponent(link.username)}/`} target="_blank" rel="noreferrer" className="text-primary underline">{link.username}</a>.
            Anime and manga changes on AniList sync here each time you open the site
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
      ) : preview ? (
        <>
          <p className="text-xs font-mono text-base-content/70">
            Found <b>{preview.username}</b>: {preview.counts.total} entries. {preview.counts.inLibrary} already in your library
            ({preview.counts.differ} differ), {preview.counts.newTitles} new.
          </p>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="radio" name="anilist-mode" className="radio radio-sm radio-primary mt-0.5" checked={mode === 'track'} onChange={() => setMode('track')} />
            <span className="text-xs font-mono"><b className="uppercase tracking-widest">Only track from now on</b><br />Nothing is imported now; future AniList changes sync.</span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="radio" name="anilist-mode" className="radio radio-sm radio-primary mt-0.5" checked={mode === 'import'} onChange={() => setMode('import')} />
            <span className="text-xs font-mono"><b className="uppercase tracking-widest">Import everything</b><br />Adds the new titles and updates the ones that differ.</span>
          </label>
          {mode === 'import' && (
            <label className="flex items-center gap-3 cursor-pointer pl-7">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary rounded-none" checked={createHistory} onChange={event => setCreateHistory(event.target.checked)} />
              <span className="text-xs font-mono">Also add diary entries for titles already finished (only those with a finish date)</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirmLink} disabled={Boolean(busy)} className={`${buttonClass} bg-primary border-primary text-primary-content hover:bg-primary/90`}>
              {busy === 'link' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Link AniList
            </button>
            <button type="button" onClick={() => setPreview(null)} disabled={Boolean(busy)} className={`${buttonClass} border-base-300 text-base-content/70 hover:bg-base-200`}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs font-mono text-base-content/70">Link a public AniList list. Changes there (including from apps like Tachiyomi) sync to your anime and manga when you open the site. Nothing is ever written to AniList.</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={username}
              onChange={event => setUsername(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void findList(); }}
              placeholder="AniList username or profile link"
              aria-label="AniList username"
              className="h-10 px-3 flex-1 min-w-[220px] font-mono text-xs rounded-none border border-base-300 bg-base-100 focus:outline-none focus:border-primary"
            />
            <button type="button" onClick={findList} disabled={Boolean(busy) || !username.trim()} className={`${buttonClass} border-primary text-primary hover:bg-primary hover:text-primary-content`}>
              {busy === 'preview' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Find list
            </button>
          </div>
        </>
      )}
      {error && <p role="alert" className="text-xs font-mono text-error">{error}</p>}
    </div>
  );
};
