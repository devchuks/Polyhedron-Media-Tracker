# Polyhedron staging manual-acceptance issue register

Audit date: 2026-08-23
Target: **Polyhedron Staging only**
Method: hosted staging Supabase clients/REST/SQL plans, existing runtime and unit suites, code-path inspection, the user's prior reproductions, and a second-pass interactive browser replay against `npm run dev:staging` on localhost. Browser claims below correspond only to flows actually exercised in Polyhedron Staging.

## Executive summary

The discovery baseline contained 75 checks and ended at **54 PASS, 8 FAIL, 1 BLOCKED, 12 MANUAL-ONLY, 0 NOT TESTED**. Those numbers describe the completed discovery pass, not the post-Antigravity remediation result. The checklist now distinguishes newly verified fixes from checks that still require visual/manual replay.

Eleven issues are now registered: **0 Critical, 3 High, 7 Medium, 1 Low**. Final Codex acceptance verification finds **9 FIXED and 2 NOT REPRODUCED / UNRESOLVED**. D1's persistent overwrite, K4's false progress writes, K5's hydration reliability, K1/K2 image paths, D5's detail-add failure, and D6's sparse-provider error/image boundary are fixed without rewriting User A history. K3 remains the unresolved persistent-data risk because the user's exact historical trigger has not been isolated. D4 retains bounded recovery but its single future-issued-JWT root cause remains unproven.

Staging remained usable and canonical after the audit. User A now has 707 media and 660 logs after legitimate manual acceptance activity; User B ended with no media or logs. Temporary runtime media/log fixtures were removed. Runtime testing added staging-only tombstones, but did not alter User A's recognizable live library. Production was not written or migrated.

| Metric | Count |
|---|---:|
| Historical checklist checks browser-tested in pass 2 | 28 |
| PASS | 54 |
| FAIL | 8 |
| BLOCKED | 1 |
| MANUAL-ONLY | 12 |
| NOT TESTED | 0 |
| Critical issues | 0 |
| High issues | 3 |
| Medium issues | 7 |
| Low issues | 1 |

| Current issue status | Count |
|---|---:|
| FIXED | 9 |
| PARTIALLY FIXED | 0 |
| NOT REPRODUCED / UNRESOLVED | 2 |
| DEFERRED | 0 |

## Known issues confirmed

### K1 — Poster blank until full refresh

**Current status: FIXED**

- **Historical reproduction:** The user observed a blank detail poster until refresh; pass 2 did not reproduce it on populated TMDB rows, but proved that sparse rows could lose a valid top-level `image` at the detail boundary.
- **Antigravity attempted fix:** Preferred the top-level image in one helper, but left some callers passing only nested `apiData`, so the deterministic representation defect was not fully addressed.
- **Post-Antigravity Codex verification:** Detail views now receive the complete stored row and image selection consistently prefers the top-level image before nested/provider fallbacks. Unit coverage includes a top-level-only row. A freshly created guest record opened immediately with a decoded poster; refresh and browser Back retained the same non-empty source.

- **Severity:** Medium
- **Area:** Images / detail navigation / state normalization
- **Reproduction steps:** Add or open a library entry and navigate immediately to its detail view. Observe the poster, then perform a full browser refresh.
- **Expected behavior:** A valid poster from the search/provider result remains visible immediately and after hydration.
- **Actual behavior:** The poster can be blank until a full refresh.
- **Frequency/reproducibility:** Reproduced manually before this audit; visual replay was unavailable in the audit browser.
- **Data corruption risk:** Low. The audit found a non-empty top-level `image` on all 706 rows.
- **Production risk:** Medium UX risk if the same frontend is deployed; no production deployment occurred.
- **Evidence:** Hosted staging has 706/706 top-level images, 703/706 nested `apiData.image` values, and three rows that have neither a nested image nor a provider-derived raw cover. `DetailView` reduces a stored row to `storeItem.apiData` before calling `resolveMediaImage`, so a valid top-level `storeItem.image` is unavailable at that boundary (`src/pages/Pages.jsx`, around lines 514–519).
- **Likely subsystem:** Detail-page view model and image normalization between provider result, library row, and `apiData`.
- **Root cause status:** **Probable.** The representation mismatch is proven; a browser trace must confirm it is the only trigger for the reported refresh behavior.
- **Suggested regression test:** Render `DetailView` for a stored item with a valid top-level image and missing `apiData.image`/raw cover; assert the initial image `src` is valid before any provider fetch or reload.
- **Suggested remediation direction:** Resolve detail images from the complete stored item or enforce one canonical image field at every normalization boundary, while retaining the existing provider-derived fallbacks.
- **Dependencies/interactions:** Closely related to K2, but do not assume a single cause until navigation/cache behavior is browser-traced.

#### Browser replay result — second pass

- **Result:** Not reproduced on two fully populated TMDB records; K1 remains registered from the user's prior reproduction.
- **UI paths:** Guest search → Fight Club detail → add as planned → immediate detail; User A TV list → Steal detail.
- **Evidence:** List and detail image elements retained non-empty TMDB URLs and were fully decoded before refresh (`naturalWidth` 342/500). A full refresh did not change the selected poster URL. No corresponding console error occurred.
- **Root-cause update:** The top-level `image` versus nested `apiData.image` mismatch remains **probable for the three sparse stored rows**, but it is not a universal detail-navigation failure.

### K2 — Images disappear or reload on application back/navigation

**Current status: FIXED**

- **Historical reproduction:** The user observed posters disappearing/reloading on application navigation; the exact original title/path did not fail in browser pass 2.
- **Antigravity attempted fix:** Reset image state by calling React state setters synchronously during render, an unsafe render-phase update that could itself produce warnings or loops.
- **Post-Antigravity Codex verification:** The render-phase setter was removed. Load/error state is keyed to the source without updating state during render. Disposable list → detail → route away → browser Back retained stable poster URLs with no React warning.
- **Final acceptance verification:** The user's renewed report made the remaining failure deterministic. Library → Fight Club detail produced a valid cached TMDB banner `src` whose class remained `opacity-0`; refresh changed the same source to `opacity-75`. The route-reset/onLoad race was removed, and Fight Club plus User A's Steal now render the background at `opacity-75` immediately after navigation. Poster, gallery, newly added item, and Back/reopen paths retained non-empty sources.

- **Severity:** Medium
- **Area:** Images / React navigation / lazy loading
- **Reproduction steps:** Open an image-bearing entry, navigate elsewhere, then use application/browser back navigation.
- **Expected behavior:** The valid poster remains available without an avoidable blank/reload phase.
- **Actual behavior:** Images disappear or visibly reload.
- **Frequency/reproducibility:** Reproduced manually before this audit; automated local-browser navigation was blocked.
- **Data corruption risk:** None found. Hosted image fields remain populated.
- **Production risk:** Medium repeated UX/network cost.
- **Evidence:** Media cards/detail views remount `ImageWithFallback`; every image is `loading="lazy"`, and non-native image hosts are routed through `wsrv.nl`. Navigation recreates image elements and their local `loaded/error` state. K1's top-level/nested mismatch can additionally produce a missing source on the detail route.
- **Likely subsystem:** Route remount behavior, image view-model consistency, lazy-loading/cache policy.
- **Root cause status:** **Confirmed for the harmful blank background state.** A cached image could complete before the route effect reset `loadedBannerSrc`, leaving the already-loaded element permanently transparent. Ordinary browser image remount/revalidation is not treated as a defect when the source remains visible.
- **Suggested regression test:** With a deterministic image URL, navigate list → detail → another route → back in a component/router test; assert the image source never becomes empty and the fallback is not rendered between stable states.
- **Suggested remediation direction:** First canonicalize image selection (K1), then preserve/preload stable URLs or use an image cache/state layer that survives route remounts. Avoid hiding genuine load failures.
- **Dependencies/interactions:** K1; K5 can force additional state replacement and network work during navigation/reconnect.

#### Browser replay result — second pass

- **Result:** Not reproduced on the guest Fight Club flow; K2 remains registered as potentially intermittent.
- **UI path:** Movies list → detail → TV route → browser Back.
- **Evidence:** The poster changed from the expected list rendition (`w342`) to detail rendition (`w500`) and remained non-empty/decoded after Back. No fallback or blank state appeared. Resource-cache revalidation could not be measured reliably by the controller.
- **Root-cause update:** Route remount remains confirmed by code, but a harmful blank state is still **probable/multi-causal**, not confirmed by this replay.

### K3 — Logging one TV season creates prior-season diary entries

**Current status: NOT REPRODUCED / UNRESOLVED**

- **Historical reproduction:** The user observed prior-season diary rows being fabricated when explicitly logging a later season. Two controlled Foundation browser cases did not reproduce it.
- **Antigravity attempted fix:** Added a pure-helper test that never exercised the reported UI caller and incorrectly treated the absence of a discovered loop as resolution evidence. No application change addressed K3.
- **Post-Antigravity Codex verification:** Hosted User B verification again proved the known-correct behavior: adding Season 3 changed only Season 3, both with and without legitimate Season 1/2 siblings. That protects the standard path but does not invalidate the user's report. No speculative broad fix was made.
- **Final acceptance verification:** Every current TV mutation caller now crosses a small TV workflow boundary. Episode saves are library-only; one explicit season command creates at most one selected-season log; whole-series completion creates no inferred season history. Browser and hosted User B lifecycles logged Seasons 1, 2, and 5 only, without fabricating Seasons 3/4, and exact edit/rewatch/delete paths preserved sibling IDs. The original user's exact title/click trigger still did not reproduce, so K3 truthfully remains unresolved despite the structural hardening.

- **Severity:** High
- **Area:** TV logging / diary persistence
- **Reproduction steps:** Case 1: use a multi-season show with no season logs and explicitly log season 3. Case 2: start with legitimate season-1/season-2 logs and explicitly log season 3.
- **Expected behavior:** Exactly one season-3 log mutation; existing season-1/season-2 rows remain unchanged.
- **Actual behavior:** Prior-season diary entries can be created when only the later season was requested.
- **Frequency/reproducibility:** Reproduced manually before this audit. The pure diary upsert helper did **not** reproduce it: both requested cases produced only the explicit season-3 mutation and preserved earlier rows.
- **Data corruption risk:** High. It creates persistent diary history the user did not record.
- **Production risk:** High if the affected frontend workflow reaches production.
- **Evidence:** The current explicit quick-season handler constructs one log, and the pure upsert case passes. Hosted data contains one exact-timestamp group with multiple TV season labels and four same-day multi-season groups; those aggregates are supporting forensic signals, not proof that every group is bogus.
- **Likely subsystem:** UI event path, alternate TV/import workflow, or repeated invocation around the season-completion action—not canonical media identity or the isolated diary upsert helper.
- **Root cause status:** **Unknown.** The audit narrowed the search but could not validly replay the click path.
- **Suggested regression test:** Render the season logging workflow with a spied `saveMediaWithLog`. For each required case, assert exactly one call, `season_label = Season 3`, and no mutation of prior log objects; follow with a hosted/disposable integration assertion on the final log set.
- **Suggested remediation direction:** Trace every TV season-completion entry point and event handler, deduplicate submission, and pass one explicit season identity through to the atomic RPC. Do not derive diary history from progress in the save path.
- **Dependencies/interactions:** K4 shares the TV modal but has a separate confirmed cause. D1's same-day matching may overwrite a season log but does not synthesize prior seasons.

#### Browser replay result — second pass

- **Result:** Not reproduced in either required browser case; the user's known failure remains registered.
- **Case A:** User B Foundation had no diary rows. The UI selected Season 3, used `Complete Season 3?`, and saved once. Diary changed from 0 to exactly 1 row, labelled Season 3.
- **Case B:** Legitimate Season 1 and Season 2 rows were added first. Re-saving Season 3 left the diary at exactly 3 rows; Seasons 1/2 were unchanged and no extra prior-season row appeared.
- **Evidence:** The UI displayed the three expected season labels and their provider years (2021, 2023, 2025). Disposable media/logs were deleted afterward.
- **Root-cause update:** The standard detail-modal completion path is not sufficient to trigger K3. The actual cause remains **unknown** and is more likely an alternate caller, repeated event path, or a data-specific workflow.

### K4 — Planned TV displays and persists `S01 E00`

**Current status: FIXED**

- **Historical reproduction:** Planned TV serialized and rendered the untouched season-1/episode-0 control defaults as real progress.
- **Antigravity attempted fix:** Added separate save/render conditions for the exact sentinel, but duplicated progress semantics in UI branches.
- **Post-Antigravity Codex verification:** Progress serialization is now one tested domain helper: planned/episode-zero yields no stored progress, while in-progress Episode 1 yields `S01 E01`. Hosted User B integration confirmed both states and cleanup; existing User A historical values were deliberately not rewritten.
- **Final acceptance verification:** A browser-created planned multi-season User B show displayed `Not Started`, persisted no progress, and created no diary row; Episode 1 then persisted as legitimate progress. The three deterministic User A historical sentinels remain Paradise, Steal, and Chapelwaite. They were not mutated; a future production reconciliation may safely target only TV + planned + exact `S01 E00` rows after a final read-only drift check.

- **Severity:** Medium
- **Area:** TV progress / planned state
- **Reproduction steps:** Add a TV show as planned without selecting or watching an episode; open its card/detail view and inspect persisted progress.
- **Expected behavior:** No episode progress is shown or persisted until actual viewing progress exists.
- **Actual behavior:** `S01 E00` is serialized and presented as genuine progress.
- **Frequency/reproducibility:** Deterministic in the current save branch; three current User A staging rows match planned + episode-zero progress.
- **Data corruption risk:** Medium. The false progress value is persisted and indistinguishable from intentional input later.
- **Production risk:** Medium workflow/data-quality risk.
- **Evidence:** The modal defaults to season 1/episode 0 and unconditionally formats non-completed TV progress as `Sxx Exx` (`src/components/UI.jsx`, around lines 174–182 and 321–330). The detail view prints any non-empty raw progress. Hosted aggregate: `planned_episode_zero=3`.
- **Likely subsystem:** TV modal serialization and progress presentation.
- **Root cause status:** **Confirmed.**
- **Suggested regression test:** Save a planned TV item with untouched progress controls; assert persisted progress is null/empty and `formatProgressLabel` renders nothing. Add a separate test proving episode 1 remains valid.
- **Suggested remediation direction:** Treat episode zero as an unset UI sentinel; only construct the TV progress string after actual progress or an in-progress transition.
- **Dependencies/interactions:** K3 uses the same modal but should be fixed/tested separately.

#### Browser replay result — second pass

- **Result:** Reproduced deterministically in the actual UI for both User A and disposable User B data.
- **UI paths:** User A dashboard/detail (Steal, Paradise, Lanterns); User B Foundation search → add to library → In Watchlist → Save Log without touching episode controls.
- **Evidence:** User B immediately displayed `S01 E00` after save; User A displayed the same value on multiple cards and on Steal's detail page. The value survived cloud hydration.
- **Root-cause update:** **Confirmed** end to end; the zero-value modal sentinel is serialized and rendered as real progress.

### K5 — Full cloud snapshot intermittently times out with `57014`

**Current status: FIXED**

- **Historical reproduction:** User A hydration transferred an approximately 10.4 MB `select=*` response in up to three overlapping waves, blocked usable login for more than 20 seconds, and had previously hit PostgreSQL `57014`.
- **Antigravity attempted fix:** Claimed a lightweight projection, but `fetchCloudTable` still hard-coded `.select('*')` and ignored the proposed projection argument. Its source-regex test passed without exercising that behavior, and its generic retry retried all page errors.
- **Post-Antigravity Codex verification:** Fresh clients still receive complete rows—avoiding missing detail metadata and N+1 fetches—but in one owner-scoped single-flight wave, split into 250-row media pages with a lightweight revision fingerprint before commit. Realtime `SUBSCRIBED` no longer starts another full snapshot. Only the actual PostgREST `JWT issued at future` class receives one session refresh and one retry; all failures terminate loading.
- **Final acceptance verification:** After the approved localhost IndexedDB/cache reset, staging User A reached an authenticated shell in about one second and completed its fresh 706-row hydration within six seconds. A separate hard refresh completed in 5.7 seconds. The library retained complete cards, detail metadata, posters, banners, and 658 diary rows; no `57014`, endless loading, duplicate Realtime subscription fetch, or stale-owner leak occurred. Repeated A → B → A accounting remained 706 → 0 → 706. The raw full payload is still approximately 10.45 MB, but it now travels once as three bounded pages and is revision-validated before installation.

- **Severity:** High
- **Area:** Cloud hydration / login / performance
- **Reproduction steps:** Authenticate as User A and hydrate `media_library` with `select=*`, owner filter, `library_row_id` order, and a 1,000-row page.
- **Expected behavior:** Hydration completes reliably and login/navigation loading terminates.
- **Actual behavior:** A staging request has returned HTTP 500 / PostgreSQL `57014 canceling statement due to statement timeout`; the frontend logs `Cloud snapshot failed`.
- **Frequency/reproducibility:** Intermittent. Three audit requests succeeded, so the known failure was not erased: observed full-response times ranged about 0.95–3.80 seconds.
- **Data corruption risk:** No direct write corruption found. Failure can leave a stale local snapshot visible because the cloud copy is intentionally not installed on error.
- **Production risk:** High reliability risk; login awaits the same hydration path.
- **Evidence:** User A has 706 media rows. Exact REST body: 10,446,531 bytes. Excluding `apiData`: 397,537 bytes and about 0.33–0.74 seconds. Identity-only: 134,226 bytes and about 0.27–0.54 seconds. Stored `apiData` text is about 3.09 MB, but full JSON expansion makes the response much larger. `EXPLAIN (ANALYZE, BUFFERS)` for the exact SQL completed in 1.939 ms, scanning 706 rows and sorting in 1,129 kB with cache hits. Eight 100-row REST ranges all returned HTTP 206 and accounted for all 706 rows. The client uses `select('*')`, page size 1,000; login awaits hydration; and subscribing to Realtime triggers a second full hydration on `SUBSCRIBED`.
- **Likely subsystem:** PostgREST JSON serialization/transfer of large nested `apiData`, large projection/page, and duplicate hydration; not PostgreSQL filtering/index access at the current scale.
- **Root cause status:** **Probable.** Payload/serialization dominates; the exact hosted cancellation stage is not directly observable from the client.
- **Suggested regression test:** Mock a slow/`57014` full snapshot and assert login/loading reaches a bounded retry/error state. Add an integration budget asserting the initial projection and page stay below an agreed byte/latency limit and all pages account for every row.
- **Suggested remediation direction (ranked):** (1) highest impact/moderate risk: use a lightweight initial projection and fetch large provider detail metadata on demand; (2) low-to-moderate risk: reduce page size and retry only the failed range while keeping exact accounting; (3) reliability guard: decouple successful Auth from the blocking full snapshot and add a bounded retry state; (4) remove the redundant full fetch on initial Realtime subscription; (5) higher-risk structural option: trim/version/split bulky raw provider payloads. A new index is low priority because SQL execution is already about 2 ms.
- **Dependencies/interactions:** Can exacerbate K1/K2 by delaying or repeating state replacement and image network work.

#### Browser replay result — second pass

- **Result:** Reproduced as severe duplicate hydration; `57014` itself did not recur in this browser pass.
- **UI paths:** User A login, hard refresh, logout/login, and A → B → A switching.
- **Evidence:** Initial User A login took about 7.4 seconds. A hard refresh stayed on `LOADING...` for more than 20 seconds and diagnostic instrumentation captured three full snapshot waves. Two `media_library` requests overlapped before the first completed (about 12.7 and 13.4 seconds); a third full wave followed at about 10.8 seconds. A later A re-login produced two waves (706 media/658 logs) rather than one.
- **Root-cause update:** Duplicate initiation is **confirmed**: at least one auth-restoration race starts overlapping hydration, and Realtime `SUBSCRIBED` starts another full refresh. Large `select=*` serialization remains the probable reason each wave is expensive and vulnerable to `57014`. The temporary timing logs were removed after collection.

## Newly discovered issues

### D1 — Legitimate same-day diary entries can overwrite each other

**Current status: FIXED**

- **Historical reproduction:** Creating a second same-media, same-day, same-season activity silently replaced the first persistent diary row.
- **Antigravity attempted fix:** Changed local/cloud matching to stable `log_id`, which was the correct conceptual direction.
- **Post-Antigravity Codex verification:** Pure tests and hosted User B integration prove distinct WATCHED/RE-WATCHED IDs coexist, editing one preserves its ID, and its sibling remains byte-for-byte unchanged. Same-day TV season siblings also remain distinct. Fixtures were removed and User B returned to 0/0.
- **Final acceptance verification:** Browser TV history contained separate same-day Season 1 WATCHED and RE-WATCHED IDs alongside Season 2/5 siblings. Editing and clearing the Season 2 review changed only that exact log. An approved browser deletion removed exactly one entry; the remaining siblings survived immediately and through hosted accounting. The focused staging RPC suite repeated create/edit/delete/no-resurrection and returned User B to 0/0.

- **Severity:** High
- **Area:** Diary identity / persistent state
- **Reproduction steps:** For the same media and calendar day, create a first activity, then a distinct second legitimate activity with a new `log_id` but the same/null `season_label` (for example WATCHED followed by RE-WATCHED).
- **Expected behavior:** Both legitimate entries remain distinct because they have distinct stable log identities.
- **Actual behavior:** The second call matches by media key + day + season only, reuses the first `log_id`, and replaces its action/review; final count is one.
- **Frequency/reproducibility:** Deterministic. The diagnostic produced `{count:1, log_id:"first", action_type:"RE-WATCHED", review_text:"second activity"}`.
- **Data corruption risk:** High. A real diary record is silently overwritten.
- **Production risk:** High if users record multiple activities for one title on a day.
- **Evidence:** `upsertDiaryLog`, `saveMediaWithLog`, and `addDiaryLog` all search on canonical media identity + calendar day + season label without considering the incoming stable `log_id` or whether the user intended a new entry (`src/domain/mediaState.js`, around lines 24–44; `src/store/useMediaStore.js`, around lines 567–612 and 864–889).
- **Likely subsystem:** Client diary upsert semantics.
- **Root cause status:** **Confirmed.**
- **Suggested regression test:** Insert two same-media, same-day, same-season/null-season logs with distinct IDs and explicit “create” intent; assert count two and both IDs/content survive. Separately assert editing an existing log by its ID preserves that ID and changes only that record.
- **Suggested remediation direction:** Separate create from edit. Match edits by stable `log_id`; only perform same-day coalescing when the UI explicitly chooses “update today's entry,” never as an implicit identity rule.
- **Dependencies/interactions:** K3 season labels avoid this match when labels differ, but repeated saves of one season can still overwrite history. Backup/export will faithfully preserve only what remains after the overwrite.

#### Browser replay result — second pass

- **Result:** Reproduced end to end in the actual UI.
- **UI path:** User B Fight Club → mark watched → open the completed item → check `Mark as REWATCH` on the same day → add a distinct review → Save Log.
- **Evidence:** Diary count remained 4 instead of increasing to 5, and the original Fight Club entry was replaced by the rewatch review. By contrast, the three same-day Foundation rows survived when their season labels differed.
- **Root-cause update:** **Confirmed** in the invoking UI and client upsert helper. This is not merely a synthetic-helper failure.

### D2 — Login gate omits the STAGING environment indicator

**Current status: FIXED**

- **Historical reproduction:** The unauthenticated gate omitted the environment indicator even though the authenticated shell displayed it.
- **Antigravity attempted fix:** Imported environment flags from `Layout.jsx`, creating a Gate ↔ Layout module cycle.
- **Post-Antigravity Codex verification:** Environment detection now lives in a dependency-neutral config module. The actual pre-auth page on Vite port 5174 visibly rendered `Polyhedron STAGING`; the production-build policy test confirms the badge is not forced in production.

- **Severity:** Medium
- **Area:** Environment safety / authentication gate
- **Reproduction steps:** Start `npm run dev:staging` and stop at the initial Guest/Admin Login gate before entering either mode.
- **Expected behavior:** The environment is visibly identified as STAGING before credentials are entered or data can be changed.
- **Actual behavior:** The STAGING badge is absent from the gate. It appears only after guest/authenticated entry when the main Header mounts.
- **Frequency/reproducibility:** Deterministic in this pass.
- **Data corruption risk:** None directly, but the missing cue increases wrong-environment operator risk.
- **Production risk:** Medium safety/acceptance risk if environment-specific builds share the same gate.
- **Evidence:** The initial gate rendered only the product description, Guest, and Admin Login controls. After entering Guest or User A/B, the Header displayed `Connected to the STAGING backend: STAGING`.
- **Likely subsystem:** Authentication gate/layout composition and environment-badge placement.
- **Root cause status:** **Confirmed.** The badge is owned by the post-login Header rather than a gate-level environment boundary.
- **Suggested regression test:** Render the staging build in the unauthenticated gate and assert a visible, accessible `STAGING` indicator exists before either entry action.
- **Suggested remediation direction:** Render one development/staging environment indicator at the application shell level so it survives the auth-mode branch.
- **Dependencies/interactions:** Independent of K5; K5 begins after authentication while D2 affects pre-auth safety.

### D3 — Expected request cancellation is surfaced as an application error

**Current status: FIXED**

- **Historical reproduction:** An intentional TMDB season request cancellation during navigation surfaced as a red application/provider error.
- **Antigravity attempted fix:** Added `AbortError` handling in the relevant provider/reporting paths.
- **Post-Antigravity Codex verification:** Cancellation classification is centralized and deliberately narrow: only an error named `AbortError` is silent; ordinary provider/network errors still reach reporting. Separate regression tests cover both branches. No broad error swallowing remains.

- **Severity:** Low
- **Area:** Provider request cancellation / navigation error handling
- **Reproduction steps:** Open a deep-fetched TV detail, delete the disposable item, and allow navigation back to the TV list while season metadata is still in flight.
- **Expected behavior:** Intentional unmount/navigation cancellation is ignored or classified as benign.
- **Actual behavior:** The list briefly displayed `THE USER ABORTED A REQUEST.` and the console logged a red TMDB Season Data `AbortError`.
- **Frequency/reproducibility:** Observed once on the disposable Foundation cleanup path; not reproduced on unrelated navigation.
- **Data corruption risk:** None found. The exact media/log cleanup completed and User B returned to 0/0.
- **Production risk:** Low; misleading error telemetry and a transient user-facing message.
- **Evidence:** The error appeared immediately after delete/navigation and disappeared within about one second; the console retained the matching cancellation entry.
- **Likely subsystem:** Provider detail/season fetch catch path and route-unmount cancellation classification.
- **Root cause status:** **Probable.** Timing and `AbortError` identify intentional cancellation, but the exact component catch branch still needs a focused unit trace.
- **Suggested regression test:** Abort a season-data request during detail unmount/delete navigation; assert no error toast/banner and no `console.error`, while non-abort failures still surface safely.
- **Suggested remediation direction:** Detect the platform/provider abort shape at the fetch boundary and return silently only for intentional cancellation.
- **Dependencies/interactions:** Related to K2 only through navigation timing; it does not explain poster state loss.

### D4 — Browser snapshot can use a token rejected as issued in the future

**Current status: NOT REPRODUCED / UNRESOLVED**

- **Historical reproduction:** One browser PostgREST snapshot failed with `PGRST3003` / `JWT issued at future` during account switching; raw Auth succeeded immediately afterward.
- **Antigravity attempted fix:** Added a DEV-only two-second retry to Edge-function invocation. That code does not construct PostgREST snapshot requests and could not affect the failing path; it also risked presenting an unrelated Edge 401 as clock skew.
- **Post-Antigravity Codex verification:** The unrelated Edge retry was removed. The actual snapshot path now has bounded recovery: only the exact future-issued-JWT class triggers one `refreshSession` and one retry; ordinary failures do not retry, loading always terminates, owner-generation guards reject stale results, and owner switches cannot install prior-owner data. The original nondeterministic failure has not recurred, so the root cause is not falsely labelled fixed and JWT validation was not weakened.
- **Final acceptance verification:** Fresh-cache login, hard refresh, logout/login, guest → authenticated, and repeated raw/browser account switching produced no `PGRST3003` or future-JWT rejection. Loading terminated, no stale User A rows appeared under User B or guest mode, and the browser logged no warnings/errors. Because the original clock/session cause remains unproven, D4 remains **NOT REPRODUCED / UNRESOLVED** with bounded recovery rather than being mislabelled fixed.

- **Severity:** Medium
- **Area:** Auth session / cloud hydration / account switching
- **Reproduction steps:** Exercise repeated browser logout/login and A → B → A switching while snapshot hydration and auth listeners are active.
- **Expected behavior:** The active frontend session supplies a currently valid staging JWT, or exits to a bounded re-auth state if token validation fails.
- **Actual behavior:** One browser snapshot failed with PostgREST `PGRST3003` / `JWT issued at future` and logged `Cloud snapshot failed`.
- **Frequency/reproducibility:** Observed once late in the second pass. A focused raw `signInWithPassword` using the same staging URL/key and User A credentials passed immediately afterward.
- **Data corruption risk:** None found. The request was rejected before data mutation and User A remained 706/658.
- **Production risk:** Medium reliability risk if clock/session skew can strand hydration or force confusing login retries.
- **Evidence:** Vite's browser-console relay captured the exact PostgREST error during account-switch testing; raw Auth independently succeeded, separating credential validity from the frontend session/snapshot path.
- **Likely subsystem:** Supabase browser session persistence/refresh ordering, local clock skew, or stale-token reuse during auth-listener races.
- **Root cause status:** **Unknown.** The single occurrence is insufficient to choose between clock skew and frontend session ordering.
- **Suggested regression test:** Inject a snapshot `PGRST3003` after auth restoration and assert loading terminates, the stale session is not reused indefinitely, and a clean re-login can recover without cross-owner state.
- **Suggested remediation direction:** First verify client/server clock behavior and trace session token issuance/refresh during account switching. Add bounded recovery/re-auth presentation; do not weaken JWT validation.
- **Dependencies/interactions:** Shares the hydration surface with K5 but has a distinct authentication/token error rather than a database statement timeout.

### D5 — Detail-page Add to Library opened an unsaveable blank status

**Current status: FIXED**

- **Historical reproduction:** During final acceptance, opening a provider result and selecting `Add to Library` produced a modal with no selected status. `Save Log` silently did nothing because blank states are rejected.
- **Final Codex verification:** Detail preview actions now pass an explicit `planned` target status. The failure reproduced before the change on the disposable Breaking Bad path; afterward the modal opened with `In Watchlist`, saved a planned row, and the same corrected path worked for movie, anime, manga, game, VN, book, and comic fixtures.
- **Severity:** Medium
- **Area:** Detail view / add workflow
- **Data corruption risk:** None; the failure prevented the intended insert.
- **Production risk:** Medium core-workflow failure.
- **Root cause status:** **Confirmed.** The detail preview caller omitted `targetStatus`, while the modal correctly rejected an empty status.
- **Regression test:** Source wiring asserts preview detail adds pass `planned`; browser acceptance exercised provider-backed adds across every supported category.

### D6 — Sparse provider enrichment could hide a valid stored image and expose raw diagnostics

**Current status: FIXED**

- **Historical reproduction:** During the final visual pass, the user again reported missing background and related detail images until refresh. A disposable User B row with a valid top-level image, sparse nested `apiData`, and unavailable provider enrichment reproduced the vulnerable boundary.
- **Final Codex verification:** Detail enrichment now preserves `rawDetails.image || preferredMediaImage(stored/preview row)` instead of replacing a valid stored image with an empty sparse-provider value. Before refresh, after failed enrichment, through Movies → detail navigation, and after refresh, the same valid poster remained visible. A second disposable fixture proved provider failures now render bounded category messages rather than raw upstream JSON. Both fixtures were removed and User B returned to 0/0.
- **Severity:** Medium
- **Area:** Provider enrichment / image state / error presentation
- **Data corruption risk:** Low; the vulnerable path could replace in-memory presentation data but no loss of the stored top-level image was found.
- **Production risk:** Medium visible reliability and diagnostics-disclosure risk.
- **Root cause status:** **Confirmed.** Provider detail enrichment treated sparse nested metadata as authoritative over a valid stored row, and the provider boundary forwarded raw upstream error text into UI toasts.
- **Regression tests:** Complete-row/top-level image precedence, detail enrichment fallback wiring, intentional-abort separation, and safe provider error presentation are covered in the local suite.

## Potentially related issue clusters

- **Image/navigation/state:** K1's complete-row image boundary, K2's cached-banner visibility race, and D6's sparse-enrichment fallback are fixed. Poster, banner, gallery, newly added, route-away, Back, failed enrichment, and reopen paths passed with stable non-empty sources.
- **TV progress/diary:** K4 serialization is fixed and hosted-verified. K3 remains an alternate-caller/data-specific investigation; do not infer a K3 fix from K4.
- **Hydration/cloud snapshot:** K5 now uses one complete, chunked, revision-validated flight instead of overlapping waves and passed fresh-cache authenticated timing. D4 is a distinct token-validity failure with bounded actual-path recovery, not a database-timeout symptom.
- **Diary identity/deletion:** D1 create/edit identity is fixed and hosted-verified. Canonical cross-provider identity, targeted deletion, tombstones, and no-resurrection continue to pass independently.
- **Account/cache:** No cross-owner exposure was found. Hosted RLS, raw and browser A → B → A switching, non-empty guest → authenticated switching, authenticated → empty guest entry, owner epochs, and Realtime isolation passed. D2 is an environment cue issue, not an isolation failure.
- **Navigation/error handling:** D3 now suppresses only intentional `AbortError`; ordinary failures remain reportable through D6's safe bounded messages. They are independent of K2.

## Historical checklist results — discovery baseline

The following 75-row matrix records the second discovery pass before remediation. Its FAIL labels are historical evidence and do not override the **Current status** on each issue above. Current checkbox support is maintained conservatively in `STAGING_MANUAL_TEST_CHECKLIST.md`.

Evidence labels: **runtime** = hosted staging client/RPC/Realtime suite; **unit** = existing Node regression suite; **static** = source-path inspection; **manual** = the user's known reproduction. A PASS can be an underlying contract test where the wording does not require a visual click. UI-specific claims remain MANUAL-ONLY.

| # | Checklist item (abridged) | Result | Reason/evidence |
|---:|---|---|---|
| 1 | Open Vite URL; STAGING badge visible | FAIL: D2 | Browser opened Vite on port 5173. The badge is visible after entry but absent from the login gate, before credentials/data actions. |
| 2 | Network uses staging host only | PASS | Same URL/key as frontend authenticated A/B; staging ref differs from local production ref; staging bundle isolation previously passed. |
| 3 | User A sign-in and library hydration | FAIL: K5 / D4 | Browser hydration is slow/duplicated and previously hit `57014`; this pass also captured one frontend snapshot rejected as `JWT issued at future`, while raw Auth still passed. |
| 4 | Open all main routes | PASS | Browser opened Dashboard, Discovery, TV, Movies, Games, VN, Anime, Manga, Books, Comics, Diary, Settings, and Import; each rendered its expected main surface. K2 remains separately registered. |
| 5 | No uncaught browser console errors | FAIL: D3 | A delete/navigation path surfaced an expected provider `AbortError`; an HMR-only Realtime callback error was excluded from product classification. |
| 6 | Add multi-season TV as planned | FAIL: K4 | Actual User B save displayed `S01 E00`; User A has the same UI/persisted shape. |
| 7 | Planned → in progress; reload | PASS | Browser changed disposable Foundation from planned to currently watching; subsequent route/hydration retained the progress. |
| 8 | Advance season-1 episode; reload | PASS | Narrow progress patches and cloud persistence pass. |
| 9 | Complete season 1 | FAIL: K3 | Browser replay created only Season 1 and advanced to `S02 E01`, but the user's prior end-to-end K3 reproduction remains unresolved and registered. |
| 10 | Season completion does not complete series/date | PASS | Browser completing Season 1 retained `currently watching` and advanced to Season 2; unit/database invariants also pass. |
| 11 | Continue into season 2 independently | PASS | Browser created Season 1, then Season 2, and advanced to `S03 E01`; no unrelated season row changed. |
| 12 | Reload season history/current progress | PASS | Subsequent detail/Diary hydration retained the expected Season 1/2/3 rows and current progress on the disposable fixture. |
| 13 | Complete whole series; completion date | PASS | Completion invariant, timestamp handling, and hosted constraint/RPC pass. |
| 14 | Completed → in progress clears date, keeps diary | PASS | Unit transition and hosted patch/log preservation pass. |
| 15 | Re-complete series | PASS | Newer revision and completion invariant pass. |
| 16 | Rewatch counter and diary behavior | FAIL: D1 | Actual movie rewatch UI overwrote the first same-day activity instead of creating a second stable entry. TV-specific counter presentation remains a manual follow-up. |
| 17 | Season label/year associated correctly | PASS | Browser Diary showed exactly Season 1/2021, Season 2/2023, and Season 3/2025 for the disposable show. |
| 18 | Add planned movie and reload | FAIL: K1 | Persistence succeeds, but the immediate poster acceptance path is known to fail until refresh. |
| 19 | Complete movie; date present | PASS | Completion invariant and hosted constraint pass. |
| 20 | Rate and reload | PASS | Rating constraints and fresh-client patch persistence pass. |
| 21 | Diary log on movie and Diary views | PASS | Atomic media+log RPC and canonical enrichment pass; visual placement remains a recommended manual spot-check. |
| 22 | Edit movie fields/review; persist | PASS | Narrow media patch and log update RPC paths pass. |
| 23 | Delete; no reload/reconnect resurrection | PASS | Exact delete, tombstone, Realtime, and hydration convergence pass. |
| 24 | Re-add after tombstone | PASS | Newer revision restore and immediate edit pass. |
| 25 | Anime progress/completion/date | MANUAL-ONLY | Identity/runtime foundations pass; type-specific UI flow not clicked. |
| 26 | Manga progress/completion/persistence | MANUAL-ONLY | Identity/runtime foundations pass; type-specific UI flow not clicked. |
| 27 | Five raw-ID 550 identities coexist | PASS | Hosted collision suite created all five with distinct keys. |
| 28 | Update one collision independently | PASS | Hosted suite verified only the target changed. |
| 29 | Delete one collision; siblings/logs remain | PASS | Hosted exact-identity delete/cascade checks pass. |
| 30 | Add comic with partial issue list | MANUAL-ONLY | Provider/UI load sequence not clicked. |
| 31 | Read/unread issue and reload | PASS | Issue-state unit tests plus generic cloud patch persistence pass. |
| 32 | Numeric/string issue IDs normalize | PASS | Dedicated unit regression passes. |
| 33 | Partial list never implies completion | PASS | Dedicated unit regression passes. |
| 34 | Authoritative total completes only at all read | PASS | Dedicated unit regression passes. |
| 35 | Unread transitions status/date | PASS | Dedicated unit regression passes. |
| 36 | Game full workflow | MANUAL-ONLY | Provider runtime passes; type-specific UI workflow not clicked. |
| 37 | VN full workflow | MANUAL-ONLY | Provider runtime passes; type-specific UI workflow not clicked. |
| 38 | Book full workflow | MANUAL-ONLY | Network/domain foundations pass; type-specific UI workflow not clicked. |
| 39 | Leave completed clears date for each | PASS | Generic status transition and hosted completion constraints apply to all media types. |
| 40 | Reload each type and inspect all fields | MANUAL-ONLY | Generic persistence passes; per-type visual values need manual inspection. |
| 41 | Same-day edit preserves `log_id` | PASS | Dedicated unit regression and owner-scoped log RPC pass. |
| 42 | Two legitimate same-day entries remain | FAIL: D1 | Deterministic diagnostic collapses two IDs to one. |
| 43 | Clear review persists | PASS | Dedicated unit regression verifies explicit empty review. Browser replay was inconclusive because the controller later proved unable to reliably clear controlled inputs; no new defect is claimed. |
| 44 | Edit supported diary fields, correct media | PASS | Canonical log identity and hosted update path pass. |
| 45 | Delete one log; siblings remain | PASS | Exact log-ID deletion and isolation pass. |
| 46 | Reload/reconnect; deleted log absent | PASS | Log tombstone and no-resurrection runtime checks pass. |
| 47 | Search every category; open result | MANUAL-ONLY | Browser opened movie and TV provider results/details and rendered Anime results; the remaining categories were not all clicked end to end. |
| 48 | Empty/malformed search bounded | PASS | Browser empty-submit was a bounded no-op (existing results remained); network timeout/error tests settle and clear loading. |
| 49 | Discovery and pagination UI | MANUAL-ONLY | Browser rendered live Discovery results and Anime pagination metadata, but actual Next/Prev interaction was not completed. |
| 50 | Explore TMDB/IGDB/Metron/VNDB pages | MANUAL-ONLY | All four live staging proxies pass; visual pages not opened. |
| 51 | Provider errors safe/no secrets | PASS | Edge JWT, allowlist, bounds, error, and secret-nondisclosure suite passes. |
| 52 | Leave User A private fixture present | BLOCKED | Deliberately not left behind to preserve the acceptance library; a temporary sentinel was used and removed. |
| 53 | Separate User B session | PASS | Independent raw client and actual browser session verified. |
| 54 | B cannot see A media/logs/tombstones | PASS | Hosted RLS isolation passes; the browser showed User B at 0 media/0 logs while User A retained 706/658. |
| 55 | B fixtures invisible to A | PASS | Hosted bidirectional fixture isolation passes; fixtures removed. |
| 56 | Logout/login each; own state only | PASS | Raw and browser A → B → A returned 706 → 0 → 706 with recognizable User A titles and no B fixture leakage. |
| 57 | Guest → authenticated transition | MANUAL-ONLY | Browser entered a clean guest state and later authenticated, but the expected handling of non-empty guest data still needs a personal acceptance decision. |
| 58 | Authenticated → guest has no private cache | MANUAL-ONLY | Owner reset code/unit isolation pass; browser IndexedDB observation still required. |
| 59 | Export User B; canonical identity | PASS | Versioned canonical backup unit test passes. |
| 60 | Re-import without duplicates | PASS | Duplicate canonical identity validation and hosted replace accounting pass. |
| 61 | Legacy import/provider mapping | PASS | Dedicated legacy canonicalization unit test passes. |
| 62 | Replace/restore/tombstones | PASS | Hosted replace-versus-write and no-resurrection checks pass. |
| 63 | Immediate edit after restore wins | PASS | Hosted 1 ms newer revision scenario passes. |
| 64 | Malformed backup rejected atomically | PASS | Normalize-before-mutation unit test passes. |
| 65 | Orphan log backup rejected atomically | PASS | Dedicated orphan rejection assertion passes. |
| 66 | Two A sessions + one B | PASS | Hosted Realtime suite used isolated A/B channels and service-side mutations. |
| 67 | A session 2 receives A update | PASS | Realtime insert/update delivery passes. |
| 68 | B receives no A event/data | PASS | Cross-owner Realtime/RLS isolation passes. |
| 69 | A delete/tombstone removes in session 2 | PASS | Exact surrogate delete and tombstone delivery pass. |
| 70 | Disconnect, mutate, reconnect | PASS | Reconnect/hydration scenario executed. |
| 71 | Hydration+tombstones converge/no resurrection | PASS | Hosted runtime and persistence-merge regression pass. |
| 72 | Repeat for diary deletion | PASS | Log deletion/tombstone convergence passes. |
| 73 | Remove disposable fixtures | PASS | Browser cleanup returned User B to 0 media/0 logs; User A remained 706/658. Staging-only tombstones intentionally remain. |
| 74 | Record failed checkboxes before planning | PASS | This register is the consolidated record; staging report links to it. |
| 75 | No production mutation/deploy/webhook change | PASS | No production command or write was performed during this audit. |

## Historical supplemental discovery results

- **Staging identity/configuration:** PASS. Frontend URL/key, User A, and User B all resolve to the staging project ref, which differs from the local production ref. Secrets were not printed.
- **Local browser access:** PASS on Vite port 5173. The site, provider results, authenticated app, and recognizable User A library rendered; D2 records the missing badge on the pre-auth gate.
- **User A / User B Auth:** PASS. `signInWithPassword`, `getSession`, `getUser`, sign-out, re-login, wrong-password bounded failure, and A → B → A all passed through raw clients; actual browser A → B → A also restored the correct owner snapshots.
- **User A data accounting:** PASS. 706 media / 658 logs, one owner, zero canonical collisions/orphans/ownership mismatches; all five approved completion dates remain correct; bogus orphan IDs remain absent.
- **Runtime mutation suite:** PASS. Thirteen groups covered RLS CRUD, constraints, canonical collisions, RPC atomicity/rollback/concurrency, pagination above 1,000, Realtime, tombstones, and cleanup.
- **Cloud performance:** FAIL: K5. SQL is fast; full REST serialization/transfer is disproportionately large and intermittently unreliable.
- **Image forensics:** FAIL: K1/K2. Data is present, but detail/navigation representations are inconsistent and route remounts reload images.
- **TV case 1 / case 2 replay:** PASS in the standard detail modal: exactly one Season 3 mutation in Case A and only the Season 3 update in Case B. K3 remains registered because the user's earlier UI reproduction has not been explained.
- **Planned TV episode zero:** FAIL: K4, including three current hosted rows.
- **Same-day distinct diary activities:** FAIL: D1.
- **Edge provider/search foundations:** PASS for TMDB, IGDB, Metron, VNDB. Browser replay rendered movie, TV, and AniList Anime results; D3 records incorrect presentation of one intentional TMDB cancellation.

## Recommended remaining remediation order

1. **K3 — prior-season diary creation (High):** obtain the exact original title/data/click sequence if the historical symptom returns. All known callers are now constrained to one selected-season command, so do not add speculative history-reconstruction logic.
2. **D4 — future-issued JWT (Medium):** preserve bounded one-refresh/one-retry recovery and capture session/clock evidence if it recurs. Do not weaken JWT validation.

## Manual-only tests remaining

The final pass reduced personal/manual work to five focused groups:

- If possible, provide/replay the exact original K3 title and click sequence; the standard and structurally hardened paths did not reproduce it.
- Visually inspect the full-series rewatch counter after a complete real rewatch; command, hosted, and diary semantics passed, but the counter has no dedicated acceptance surface.
- For comics, mark every issue in one authoritative 24-issue series read, then unread one, to visually confirm the automatic completion/un-completion presentation. Partial-list and individual read/unread safety already passed.
- Exercise the remaining provider presentation paths (Metron and VNDB Explore detail) and Backup/Restore through the UI file chooser with disposable User B data: current export/import, legacy import, malformed file, orphan-log rejection, and replace presentation. Discovery pagination itself now has browser evidence. Underlying provider/atomic/canonical contracts pass automated and hosted tests.
- Use truly separate browser profiles for visual Realtime update/delete/reconnect presentation. Hosted owner isolation, Realtime delivery, tombstones, reconnect, and no-resurrection already pass.

Staging is safe for continued manual exploration. User B's disposable media/logs were removed and User A remained intact at its current legitimate acceptance baseline of 707/660. Use disposable User B fixtures for destructive edge cases and avoid resetting User A. K3 remains the only unresolved persistent-data issue; use a disposable show if attempting its original path. K4 and D1 now have hosted regression evidence and should be spot-checked without rewriting User A history.

## Non-destructive validation

- `npm test`: PASS, 106/106.
- `npm run lint`: PASS with 0 errors and 34 existing warnings.
- `npm run build`: PASS; existing chunk-size advisory only.
- `npm run build:staging`: PASS; existing chunk-size advisory only.
- Hosted staging Edge verification: PASS for JWT gates, allowlists, payload bounds, live provider calls, quota, and secret-safe errors.
- Hosted staging runtime verification: PASS, 13/13 grouped checks plus the focused D1/K3/K4/collision/tombstone suite; User A/User B live rows returned to 707/660 and 0/0.
- `git diff --check`: PASS.

NO PRODUCTION DATA OR SCHEMA WAS MODIFIED DURING THIS DISCOVERY PASS.
