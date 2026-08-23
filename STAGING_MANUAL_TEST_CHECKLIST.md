# Polyhedron staging manual acceptance checklist

Use `npm run dev:staging`. Confirm the header shows **STAGING** before entering or changing test data. Use only the two staging accounts stored locally in the ignored `.env.staging.local` file. Do not use production credentials.

## Session setup

- [ ] Open the local URL printed by Vite and confirm the **STAGING** badge is visible.
- [ ] Confirm the browser network panel uses the staging Supabase host, never production.
- [ ] Sign in as User A and confirm the imported library hydrates.
- [ ] Open Dashboard, Movies, TV, Anime, Manga, Comics, Games, VN, Books, Diary, Discovery, Explore, Search, and Settings.
- [ ] Confirm there are no uncaught console errors during initial hydration or navigation.

## TV

- [ ] Add a multi-season TV show as `planned`.
- [ ] Change it from `planned` to `in progress`; reload and verify persistence.
- [ ] Advance episode progress within season 1 and verify the exact episode persists after reload.
- [ ] Complete season 1 and confirm the season is recorded complete.
- [ ] Confirm completing season 1 does **not** mark the whole series `completed` and does not set an overall completion date.
- [ ] Continue into season 2 and verify season/episode progress is independent of season 1.
- [ ] Reload and confirm both season completion and current progress persist.
- [ ] Complete the whole series and confirm an overall completion date is set.
- [ ] Change the series from `completed` back to `in progress` and confirm the overall completion date clears while diary history remains.
- [ ] Re-complete the series and confirm a fresh completion workflow succeeds.
- [ ] Start and finish a rewatch; verify the rewatch counter and diary entry behavior.
- [ ] Confirm season diary fields (`season_label`, `season_year`) remain associated with the intended series.

## Movies

- [ ] Add a movie as `planned` and reload.
- [ ] Mark it `completed`; confirm a completion date is present.
- [ ] Rate it from 0 through a valid non-zero value and reload.
- [ ] Add a diary log and confirm it appears on both the movie and Diary views.
- [ ] Edit status, rating, progress/review fields as applicable and verify persistence.
- [ ] Delete it and confirm it disappears without returning after reload/reconnect.
- [ ] Re-add the same movie and confirm the new revision is accepted after the tombstone.

## Anime and Manga

- [ ] Add an anime, update progress, complete it, and verify its completion date.
- [ ] Add a manga, update chapter/volume progress, complete it, and verify persistence.
- [ ] Using the raw-ID `550` staging scenario if recreated, confirm TMDB movie, TMDB TV, AniList anime, AniList manga, and another provider can coexist.
- [ ] Update one colliding item and verify the others do not change.
- [ ] Delete one colliding item and verify the others and their diary records remain.

## Comics

- [ ] Add a comic with only a partial issue list loaded.
- [ ] Mark individual issues read/unread and reload after each transition.
- [ ] Confirm issue IDs compare consistently when provider data supplies number-like and string-like IDs.
- [ ] Confirm a partial issue list never marks the whole series complete.
- [ ] Load/confirm the authoritative issue list, read every issue, and verify completion occurs only then.
- [ ] Unread one issue and verify completion status/date transition correctly.

## Games, visual novels, and books

- [ ] Add a game, update progress/status, complete it, and verify its diary entry.
- [ ] Add a visual novel, update progress/status, complete it, and verify its diary entry.
- [ ] Add a book, update progress/status, complete it, and verify its diary entry.
- [ ] For each type, leave `completed` and confirm the overall completion date clears.
- [ ] Reload after each type and confirm status, progress, rating, and dates persist.

## Diary

- [ ] Create a diary entry, edit it on the same day, and confirm its `log_id` remains stable.
- [ ] Create two legitimate same-day entries and confirm both remain distinct.
- [ ] Clear review text and confirm the empty value persists after reload.
- [ ] Edit rating/action/date fields supported by the UI and confirm the correct media entry changes.
- [ ] Delete one diary entry and confirm no sibling entry is removed.
- [ ] Reload and reconnect; confirm the deleted entry does not return.

## Search, Discovery, and Explore

- [ ] Search each supported media category and open at least one result.
- [ ] Confirm malformed/empty searches show a bounded error or empty state, not a crash.
- [ ] Exercise Discovery sections and pagination.
- [ ] Open Explore/provider detail pages for TMDB, IGDB, Metron, and VNDB-backed content.
- [ ] Confirm provider errors are user-safe and do not reveal credentials or raw server diagnostics.

## Account isolation

- [ ] Sign in as User A, add a clearly labeled private fixture, and leave it present.
- [ ] In a separate private window/session, sign in as User B.
- [ ] Confirm User B cannot see User A media, diary entries, or tombstones.
- [ ] Add User B fixtures and confirm User A cannot see them.
- [ ] Log out and back in as each account; confirm each account restores only its own state.
- [ ] Enter guest mode, create guest media, then sign in; confirm the guest/private transition follows the intended import behavior.
- [ ] Log out again and confirm no prior authenticated user's private cache appears in guest mode.

## Backup and restore

- [ ] Export User B's small staging library and inspect that canonical provider/type identity is present.
- [ ] Import the export into the same staging user and confirm no duplicates/collisions.
- [ ] Import a supported legacy backup and verify deterministic provider mappings.
- [ ] Exercise replace/restore and confirm rows omitted by the backup are tombstoned rather than resurrected.
- [ ] Immediately edit a restored record and confirm the newer revision wins.
- [ ] Attempt a malformed backup and confirm the entire operation is rejected atomically.
- [ ] Attempt a backup containing an orphan diary log and confirm it is rejected atomically.

## Realtime

- [ ] Open two sessions as User A and one as User B if practical.
- [ ] Update User A media in session 1 and confirm session 2 receives the update.
- [ ] Confirm User B receives no User A event or data.
- [ ] Delete User A media and confirm the tombstone removes it from session 2.
- [ ] Disconnect session 2, modify/delete data in session 1, then reconnect session 2.
- [ ] Confirm hydration plus tombstones converge correctly and deleted records do not resurrect.
- [ ] Repeat for a diary-log deletion.

## Completion

- [ ] Remove disposable staging fixtures or use the staging-only reset workflow.
- [ ] Record any failed checkbox in `STAGING_VERIFICATION_REPORT.md` before production planning.
- [ ] Confirm no production migration, deployment, webhook change, or data write occurred.
