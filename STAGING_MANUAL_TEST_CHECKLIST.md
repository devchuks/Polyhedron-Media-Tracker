# Polyhedron staging manual acceptance checklist

Use `npm run dev:staging`. Confirm the header shows **STAGING** before entering or changing test data. Use only the two staging accounts stored locally in the ignored `.env.staging.local` file. Do not use production credentials.

## Session setup

- [x] Open the local URL printed by Vite and confirm the **STAGING** badge is visible. — Browser-verified pre-auth, guest, and authenticated on the actual Vite URL `http://localhost:5173`.
- [x] Confirm the browser network panel uses the staging Supabase host, never production. — Staging bundle/runtime identity and browser Auth/snapshot host verified; production ref absent.
- [x] Sign in as User A and confirm the imported library hydrates. — Fresh-cache browser hydration restored 706 media / 658 logs and recognizable titles/images.
- [x] Open Dashboard, Movies, TV, Anime, Manga, Comics, Games, VN, Books, Diary, Discovery, Explore, Search, and Settings. — Browser-verified across the discovery and final acceptance passes.
- [x] Confirm there are no uncaught console errors during initial hydration or navigation. — Final fresh-cache/navigation pass had no browser warnings/errors.

## TV

- [x] Add a multi-season TV show as `planned`. — Hosted User B disposable fixture; progress stored as unset.
- [x] Change it from `planned` to `in progress`; reload and verify persistence. — User B browser lifecycle plus hosted fresh-client verification.
- [x] Advance episode progress within season 1 and verify the exact episode persists after reload. — `S01 E03` browser/runtime persistence verified.
- [x] Complete season 1 and confirm the season is recorded complete. — Exactly one Season-1 activity and final actual episode persisted.
- [x] Confirm completing season 1 does **not** mark the whole series `completed` and does not set an overall completion date. — Browser and hosted assertions passed.
- [x] Continue into season 2 and verify season/episode progress is independent of season 1. — Explicit `S02 E01`; no automatic next-season claim.
- [x] Reload and confirm both season completion and current progress persist. — Hosted fresh-client lifecycle verification.
- [x] Complete the whole series and confirm an overall completion date is set. — Browser state plus hosted completion invariant passed; no bulk diary creation.
- [x] Change the series from `completed` back to `in progress` and confirm the overall completion date clears while diary history remains. — Browser rewatch start and hosted transition matrix passed.
- [x] Re-complete the series and confirm a fresh completion workflow succeeds. — Hosted transition matrix passed with history preserved.
- [x] Start and finish a rewatch; verify the rewatch counter and diary entry behavior. — Browser same-day season rewatch plus hosted full-series rewatch counter passed; personal visual counter spot-check remains recommended.
- [x] Confirm season diary fields (`season_label`, `season_year`) remain associated with the intended series. — Browser/runtime verified for selected seasons only.

## Movies

- [x] Add a movie as `planned` and reload. — User B Fight Club provider/detail add and later fresh hydration passed.
- [x] Mark it `completed`; confirm a completion date is present. — Browser Watched flow and hosted completion constraint passed.
- [x] Rate it from 0 through a valid non-zero value and reload. — Browser 8/10 save and cloud hydration passed.
- [x] Add a diary log and confirm it appears on both the movie and Diary views. — Browser Diary displayed Fight Club; atomic RPC verified.
- [ ] Edit status, rating, progress/review fields as applicable and verify persistence.
- [ ] Delete it and confirm it disappears without returning after reload/reconnect.
- [ ] Re-add the same movie and confirm the new revision is accepted after the tombstone.

## Anime and Manga

- [x] Add an anime, update progress, complete it, and verify its completion date. — User B Cowboy Bebop browser lifecycle and diary persistence.
- [x] Add a manga, update chapter/volume progress, complete it, and verify persistence. — User B Akira browser lifecycle and diary persistence.
- [x] Using the raw-ID `550` staging scenario if recreated, confirm TMDB movie, TMDB TV, AniList anime, AniList manga, and another provider can coexist. — Hosted runtime verification.
- [x] Update one colliding item and verify the others do not change. — Hosted runtime verification.
- [x] Delete one colliding item and verify the others and their diary records remain. — Hosted runtime verification and exact fixture cleanup.

## Comics

- [x] Add a comic with only a partial issue list loaded. — User B Absolute Batman loaded 12 of 24 before the authoritative expansion control.
- [ ] Mark individual issues read/unread and reload after each transition.
- [x] Confirm issue IDs compare consistently when provider data supplies number-like and string-like IDs. — Dedicated behavioral regression.
- [x] Confirm a partial issue list never marks the whole series complete. — Browser remained in progress at 0/24 and domain regression passed.
- [ ] Load/confirm the authoritative issue list, read every issue, and verify completion occurs only then.
- [ ] Unread one issue and verify completion status/date transition correctly.

## Games, visual novels, and books

- [x] Add a game, update progress/status, complete it, and verify its diary entry. — User B Hades browser lifecycle and Diary entry.
- [x] Add a visual novel, update progress/status, complete it, and verify its diary entry. — User B Steins;Gate browser lifecycle and Diary entry.
- [x] Add a book, update progress/status, complete it, and verify its diary entry. — User B Dune browser lifecycle and Diary entry.
- [ ] For each type, leave `completed` and confirm the overall completion date clears.
- [ ] Reload after each type and confirm status, progress, rating, and dates persist.

## Diary

- [x] Create a diary entry, edit it on the same day, and confirm its `log_id` remains stable. — Hosted User B D1 verification.
- [x] Create two legitimate same-day entries and confirm both remain distinct. — Hosted User B WATCHED/RE-WATCHED verification.
- [x] Clear review text and confirm the empty value persists after reload. — Exact Season-2 review cleared without changing four sibling entries; hosted log update persisted.
- [ ] Edit rating/action/date fields supported by the UI and confirm the correct media entry changes.
- [x] Delete one diary entry and confirm no sibling entry is removed. — Approved User B browser delete reduced 10 entries to 9 and retained other TV siblings.
- [x] Reload and reconnect; confirm the deleted entry does not return. — Tombstone/no-resurrection hosted replay passed before fixture cleanup.

## Search, Discovery, and Explore

- [x] Search each supported media category and open at least one result. — Actual TMDB, AniList, IGDB, VNDB, OpenLibrary, and Metron browser flows.
- [x] Confirm malformed/empty searches show a bounded error or empty state, not a crash. — Empty submission was a bounded no-op; timeout/error regressions terminate loading.
- [x] Exercise Discovery sections and pagination. — Browser Load More retained the existing 45 cards during refresh and settled at 50 without a blocking skeleton.
- [ ] Open Explore/provider detail pages for TMDB, IGDB, Metron, and VNDB-backed content.
- [x] Confirm provider errors are user-safe and do not reveal credentials or raw server diagnostics. — Staging Edge JWT/allowlist/bounds/error suite and browser console review passed.

## Account isolation

- [ ] Sign in as User A, add a clearly labeled private fixture, and leave it present.
- [ ] In a separate private window/session, sign in as User B.
- [x] Confirm User B cannot see User A media, diary entries, or tombstones. — Hosted owner-isolation verification.
- [x] Add User B fixtures and confirm User A cannot see them. — Hosted owner-isolation verification.
- [x] Log out and back in as each account; confirm each account restores only its own state. — Raw and browser A → B → A remained 706 → 0 → 706.
- [x] Enter guest mode, create guest media, then sign in; confirm the guest/private transition follows the intended import behavior. — Forty local demo records remained guest-scoped and did not merge into User A.
- [x] Log out again and confirm no prior authenticated user's private cache appears in guest mode. — Guest opened empty after User A logout; no recognizable private rows appeared.

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

## Final TV workflow and acceptance verification — 2026-08-24

The final pass supports **51 of 75** individual checkboxes with browser, behavioral, or hosted-runtime evidence. The TV workflow was exercised end to end on disposable User B data: planned without progress/diary, explicit progress, one-log season completion, independent season transitions, no fictional next-season episode, selected final-season logging without fabricated history, whole-series completion without bulk logs, rewatch, stable-ID edit, exact delete, and no resurrection. User B returned to 0 media / 0 logs.

The 24 unchecked lines collapse into five genuinely personal/visual acceptance groups rather than 24 independent engineering blockers:

1. exact original K3 title/click-path replay and a visual full-series rewatch-counter spot-check;
2. movie delete/re-add presentation plus per-type leave-completed/reload presentation;
3. authoritative all-issues comic completion/un-completion and supported Diary-field editing presentation;
4. Discovery/Explore pagination/entity pages and the Backup/Restore file-chooser workflows;
5. true separate-profile multi-browser Realtime presentation.

Underlying canonical identity, atomic backup validation, owner isolation, Realtime delivery, tombstones, reconnect, and no-resurrection contracts already pass automated/hosted verification. Unchecked UI lines remain unchecked because that wording requires a visible flow, not because those lower-level contracts failed.

## Final dates, Telegram, loading, and image verification — 2026-08-24

- [x] First genuine consumption initializes `dateStarted` once; later progress preserves it, and direct completion coherently supplies Started and Completed from the explicit activity time. — Behavioral transition suite plus hosted Telegram movie archetype.
- [x] An Activity Date remains distinct from provider release year and TV `season_year`. — TV/Telegram behavioral coverage and selected-season hosted persistence.
- [x] Telegram planned/start/progress/completion/season/rewatch/rating-only commands preserve the same library/diary semantics as the UI. — Staging synthetic webhook integration passed.
- [x] Replaying the same Telegram update is idempotent and one media-plus-log command is atomic. — Early batch replay and stable event-plan assertions passed; User B cleanup returned to 0/0.
- [x] Empty initial views use geometry-matched skeletons while cached/current results remain mounted during background refresh. — Dashboard/Diary/Discovery/Explore policy tests and actual Discovery pagination replay.
- [x] A valid stored top-level image survives sparse or failed provider enrichment before refresh and through route navigation. — Disposable User B browser fixture passed before refresh, after provider failure, after Movies → detail navigation, and after refresh.
- [x] Provider errors settle loading and display bounded messages without raw upstream JSON. — Browser sparse-provider fixture plus safe-error regression.

The original checklist now has **52 of 75** checked lines. Seven supplemental checks above capture the newly accepted date, Telegram, loading, and image contracts. Remaining personal checks are still the unchecked original lines: exact K3/full-series counter presentation, movie/per-type transition presentation, authoritative all-issue comic completion, combined Diary field editing, Metron/VNDB Explore pages, User B file-chooser Backup/Restore, and true separate-profile Realtime presentation.
