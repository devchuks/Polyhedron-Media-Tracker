import { SyncLinkCard } from './SyncLinkCard';
import { linkLetterboxd, normalizeLetterboxdUsername, readLetterboxdLink, syncLetterboxdNow, unlinkLetterboxd } from '../services/letterboxdSync';

// Films logged on Letterboxd, with rating and review.
export const LetterboxdLink = () => (
  <SyncLinkCard
    service="Letterboxd"
    readLink={readLetterboxdLink}
    linkAccount={linkLetterboxd}
    syncNow={syncLetterboxdNow}
    unlink={unlinkLetterboxd}
    normalizeUsername={normalizeLetterboxdUsername}
    profileUrl={link => `https://letterboxd.com/${encodeURIComponent(link.username)}/`}
    linkedSummary="Films you log on Letterboxd are added here, with rating and review, each time you open the site"
    intro="Link your Letterboxd profile. Entries already on Letterboxd are skipped; films you log there from now on sync to your library and diary."
    placeholder="Letterboxd username or profile link"
  />
);
