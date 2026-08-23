# Polyhedron staging manual acceptance checklist

Use `npm run dev:staging`. Confirm the header shows **STAGING** before entering or changing test data. Use only the two staging accounts stored locally in the ignored `.env.staging.local` file. Do not use production credentials.

## Session setup

- [x] Open the local URL printed by Vite and confirm the **STAGING** badge is visible. — Browser-verified pre-auth and in guest mode on port 5174.
- [ ] Confirm the browser network panel uses the staging Supabase host, never production.
- [ ] Sign in as User A and confirm the imported library hydrates.
- [ ] Open Dashboard, Movies, TV, Anime, Manga, Comics, Games, VN, Books, Diary, Discovery, Explore, Search, and Settings.
- [ ] Confirm there are no uncaught console errors during initial hydration or navigation.

## TV

- [x] Add a multi-season TV show as `planned`. — Hosted User B disposable fixture; progress stored as unset.
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
- [x] Using the raw-ID `550` staging scenario if recreated, confirm TMDB movie, TMDB TV, AniList anime, AniList manga, and another provider can coexist. — Hosted runtime verification.
- [x] Update one colliding item and verify the others do not change. — Hosted runtime verification.
- [x] Delete one colliding item and verify the others and their diary records remain. — Hosted runtime verification and exact fixture cleanup.

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

- [x] Create a diary entry, edit it on the same day, and confirm its `log_id` remains stable. — Hosted User B D1 verification.
- [x] Create two legitimate same-day entries and confirm both remain distinct. — Hosted User B WATCHED/RE-WATCHED verification.
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
- [x] Confirm User B cannot see User A media, diary entries, or tombstones. — Hosted owner-isolation verification.
- [x] Add User B fixtures and confirm User A cannot see them. — Hosted owner-isolation verification.
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
- [x] Confirm User B receives no User A event or data. — Hosted Realtime isolation verification.
- [ ] Delete User A media and confirm the tombstone removes it from session 2.
- [ ] Disconnect session 2, modify/delete data in session 1, then reconnect session 2.
- [x] Confirm hydration plus tombstones converge correctly and deleted records do not resurrect. — Hosted stale/newer revision and Realtime verification.
- [x] Repeat for a diary-log deletion. — Hosted Realtime verification.

## Completion

- [x] Remove disposable staging fixtures or use the staging-only reset workflow. — Exact User B cleanup; final 0 media / 0 logs.
- [x] Record any failed checkbox in `STAGING_VERIFICATION_REPORT.md` before production planning.
- [x] Confirm no production migration, deployment, webhook change, or data write occurred.

## Discovery audit annotation — 2026-08-23

The original checkboxes above are intentionally preserved. The first discovery pass produced the complete per-item matrix in `MANUAL_ACCEPTANCE_ISSUES.md`.

### Second browser discovery pass

The localhost conflict was resolved and 28 checklist items received actual browser coverage on Vite port 5173 against Polyhedron Staging. The current matrix is **54 PASS, 8 FAIL, 1 BLOCKED, 12 MANUAL-ONLY, and 0 NOT TESTED**.

- **Reproduced:** K4 (planned TV `S01 E00`), K5 (duplicate/slow hydration), and D1 (same-day rewatch overwrites the original activity).
- **Not reproduced on the tested paths:** K1, K2, and K3. These remain registered because the user's earlier reproductions are valid and their triggering data/path has not been isolated.
- **New:** D2 (no STAGING badge on the pre-login gate), D3 (intentional provider abort briefly surfaced as an error), and D4 (one browser snapshot JWT rejected as issued in the future while raw Auth remained valid).
- **Passed in browser:** all main routes rendered; User A and User B authenticated and isolated; browser A → B → A restored the correct owner state; both required Foundation Season-3 cases produced only intended diary mutations; disposable User B media/logs were removed.
- **Still manual:** exact-title K1/K2/K3 replay, remaining type-specific add/edit/reload workflows, all-category search/explore pagination, non-empty guest transitions, UI backup/restore files, true multi-browser Realtime presentation, and one personal diary-review-clear check.

No remediation was applied during either discovery pass.

## Post-Antigravity Codex verification — 2026-08-23

Antigravity's unsupported blanket checkmarks were removed. A checkbox is checked above only where the current run supplied direct browser or hosted-runtime evidence, or where the original staging proof remains applicable to unchanged database behavior. Unchecked items are not failed by implication; they remain manual or require a later focused browser replay. Current issue truth is recorded in `MANUAL_ACCEPTANCE_ISSUES.md`.
