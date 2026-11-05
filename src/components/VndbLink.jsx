import { SyncLinkCard } from './SyncLinkCard';
import { normalizeVndbUsername } from '../services/vndbClient';
import { linkVndb, readVndbLink, syncVndbNow, unlinkVndb } from '../services/vndbSync';

// Visual novel list changes on VNDB (status labels, votes, start and finish dates).
export const VndbLink = () => (
  <SyncLinkCard
    service="VNDB"
    readLink={readVndbLink}
    linkAccount={linkVndb}
    syncNow={syncVndbNow}
    unlink={unlinkVndb}
    normalizeUsername={normalizeVndbUsername}
    // VNDB profile pages are addressed by user id (vndb.org/u250045), resolved when linking.
    profileUrl={link => `https://vndb.org/${encodeURIComponent(link.userId || link.username)}`}
    linkedSummary="Visual novel changes on your VNDB list sync here each time you open the site"
    intro="Link a public VNDB list. What is on it now is skipped; visual novels you add, finish, drop or vote on there from now on sync when you open the site. Nothing is ever written to VNDB."
    placeholder="VNDB username"
  />
);
