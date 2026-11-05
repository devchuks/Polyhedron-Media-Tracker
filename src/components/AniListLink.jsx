import { SyncLinkCard } from './SyncLinkCard';
import { normalizeAniListUsername } from '../services/anilistClient';
import { linkAniList, readAniListLink, syncAniListNow, unlinkAniList } from '../services/anilistSync';

// Anime and manga changes on AniList (including those from apps such as Tachiyomi).
export const AniListLink = () => (
  <SyncLinkCard
    service="AniList"
    readLink={readAniListLink}
    linkAccount={linkAniList}
    syncNow={syncAniListNow}
    unlink={unlinkAniList}
    normalizeUsername={normalizeAniListUsername}
    profileUrl={link => `https://anilist.co/user/${encodeURIComponent(link.username)}/`}
    linkedSummary="Anime and manga changes on AniList sync here each time you open the site"
    intro="Link a public AniList list. What is on it now is skipped; anime and manga changes made there from now on (including from apps like Tachiyomi) sync when you open the site. Nothing is ever written to AniList."
    placeholder="AniList username or profile link"
  />
);
