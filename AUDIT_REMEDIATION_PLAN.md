# Audit Remediation Plan

This plan records the source audit performed on the isolated local copy. No remote repository or hosted Supabase project was contacted. Line references describe the pre-remediation baseline and may move as fixes are applied.

## Baseline

- Package manager: npm (`package-lock.json`).
- Tests/typecheck: no scripts or test files existed.
- `npm run lint`: failed with 115 errors and 5 warnings across 14 files.
- `npm run build`: passed; Vite reported one large client chunk.
- Database verification: runtime-dependent and not performed. The repository contains no schema/migrations/RLS definitions and no safe local Supabase configuration.

## Confirmed issues and work order

### AR-01 — Canonical media identity collisions

- Severity/status: High — confirmed.
- Locations: `src/utils/normalizers.js:15-74`; `src/store/useMediaStore.js:190-225,269-289,390-415`; `supabase/functions/telegram-logger/index.ts:588-603,747-770`.
- Root cause/affected workflow: raw provider IDs are durable keys even though TMDB movie/TV and AniList anime/manga ID spaces overlap. Cloud upserts, patches, deletes, restore, Telegram writes, and diary linkage cannot distinguish collisions.
- Required fix/dependencies: introduce `provider`, `media_type`, `provider_id`, and deterministic `media_key`; retain raw route/provider IDs for API calls; dual-read legacy data; update every identity-sensitive selector/mutation before relying on the new DB constraint. This is the prerequisite for AR-02 through AR-06.
- Database/migration/existing data: add/backfill columns and unique `(user_id, media_key)` without discarding rows. The ignored May 12 backup sample has 599 media/648 logs and no existing collisions, but hosted data is unknown. Already-overwritten hosted collisions cannot be reconstructed automatically.
- Regression tests: TMDB movie 550 and TV 550, plus cross-provider/type ID 550, coexist and can be independently changed/deleted; legacy records/backups migrate deterministically.

### AR-02 — Broad destructive and realtime predicates

- Severity/status: High — confirmed.
- Locations: `src/store/useMediaStore.js:127-179,203-225,279-289,478-483`.
- Root cause/affected workflow: deletes/log cascades/realtime reconciliation key only by raw ID; several cloud deletes omit explicit ownership. One collision can remove unrelated items/logs locally and in cloud.
- Required fix/dependencies: after AR-01, scope by authenticated owner and canonical key; filter Realtime by owner; use an atomic owner-scoped delete RPC with FK cascade.
- Database/migration/existing data: create composite identity/FK and transactional RPC; preserve data. Migration is generated locally only and is not executed.
- Regression tests: deleting/realtime-deleting movie 550 leaves TV 550 and its logs intact; cloud mock predicates include owner plus canonical identity.

### AR-03 — Diary identity instability and wrong enrichment

- Severity/status: High — confirmed.
- Locations: `src/store/useMediaStore.js:439-483`; `src/pages/Diary.jsx:44-56`; `src/pages/Pages.jsx:158-161,544-549`.
- Root cause/affected workflow: same-day matching ignores provider/type, replaces stable `log_id`, uses `||` so review text cannot be cleared on merge, and UI enrichment uses raw-ID maps/`startsWith`.
- Required fix/dependencies: canonical log linkage from AR-01; preserve an existing `log_id`; distinguish absence from empty review text; exact activity matching.
- Database/migration/existing data: backfill `media_key` on logs and add a canonical FK/idempotency index. Legacy `media_type + media_id` supports deterministic backfill for known provider/type mappings.
- Regression tests: colliding same-day logs stay distinct; same-target update keeps its original UUID and clears an empty review; ID 12 never includes ID 123.

### AR-04 — Stale provider metadata overwrites user state

- Severity/status: High — confirmed.
- Locations: `src/pages/Pages.jsx:555-599`; `src/store/useMediaStore.js:190-200,269-276`.
- Root cause/affected workflow: an async detail request captures an old whole library item and later replaces/upserts status, progress, rating, dates, and read issue IDs.
- Required fix/dependencies: add a metadata-only patch against the latest canonical item; provider fields and user-controlled fields are updated independently; guard route/request generation.
- Database/migration/existing data: add/update timestamps/revision support where available; no destructive backfill.
- Regression tests: update rating/status while a deferred detail request is pending; resolving it changes metadata only.

### AR-05 — Stored/reflected XSS and unsafe links

- Severity/status: High — confirmed.
- Locations: `src/components/UI.jsx:94-167,1182-1192`; `src/pages/Pages.jsx:634-635,766,773-777`; `src/pages/Explore.jsx:470-479,483-513`; `src/pages/ImportTerminal.jsx:453-470`.
- Root cause/affected workflow: raw provider/backup HTML is string-transformed without escaping, then injected with `dangerouslySetInnerHTML`; external hrefs accept active protocols.
- Required fix/dependencies: escape input before allowlisted markup generation (or render an AST), centralize protocol validation, validate restored DTOs, and add a CSP.
- Database/migration/existing data: no schema change; existing stored descriptions remain safe at render time.
- Regression tests: script/event handlers, attribute breaking, and `javascript:`/`data:` URLs remain inert; valid HTTPS and intended VNDB-relative links remain usable.

### AR-06 — Reproducible database integrity and RLS are absent

- Severity/status: High — confirmed repository gap; hosted runtime state unknown.
- Locations: no `supabase/migrations`, schema, grants, policies, constraints, or `config.toml`; claims at `README.md:25-29`; unscoped reads/realtime at `src/store/useMediaStore.js:92-179`.
- Root cause/affected workflow: source control cannot prove tenant isolation, keys, FKs, upsert targets, or Realtime visibility.
- Required fix/dependencies: create a preservation-first migration after AR-01 defining ownership, keys, checks, FKs, RLS policies for all four CRUD operations on both tables, owner-scoped RPCs, and Realtime-compatible identity.
- Database/migration/existing data: migration contains backfill and collision preflight. It will not be applied anywhere during this remediation. Live policy verification remains a manual/local-environment action.
- Regression tests: static migration assertions now; two-user and pgTAP/local Supabase tests only if a disposable local stack becomes available.

### AR-07 — Forgable/non-idempotent Telegram service-role workflow

- Severity/status: High — confirmed.
- Locations: `supabase/functions/telegram-logger/index.ts:18-38,277-283,599-604,747-860`.
- Root cause/affected workflow: caller-controlled chat ID is the only webhook gate; service-role writes are separate, error-ignoring, and use random log IDs, so forged/retried requests can mutate data, duplicate logs, and consume quota.
- Required fix/dependencies: verify Telegram secret header before parsing; bound body/item count; redact message logs; HTML-escape replies; use canonical identity; add `update_id` idempotency and one narrow transactional RPC.
- Database/migration/existing data: add webhook event identity/RPC in the migration without executing it. Deployment later requires configuring a Telegram webhook secret.
- Regression tests: missing/wrong secret is rejected before downstream calls; deterministic event identity; reply escaping and canonical payload helpers.

### AR-08 — Unrestricted Edge provider operations and unreliable network client

- Severity/status: Medium (security/reliability) — confirmed.
- Locations: `supabase/functions/igdb/index.ts:8-26`; `metron/index.ts:15-50`; `tmdb/index.ts:9-25`; `vn/index.ts:15-25`; `src/utils/apiClient.js:1-23`; `src/services/apiRegistry.js:14-54,130-135,214-231,331-343`.
- Root cause/affected workflow: callers control upstream paths/query languages/bodies; requests lack timeouts; all failures are retried; `Retry-After`, empty/non-JSON success, request size, pagination, and concurrency are mishandled.
- Required fix/dependencies: structured allowlisted operations/paths, numeric and pagination validation, fixed hosts, body limits, escaped IGDB strings, request timeout/cancel, transient-only retry with bounded backoff, sane page sizes/concurrency, and structured errors.
- Database/migration/existing data: none.
- Regression tests: injection strings, invalid endpoints/IDs/pages, timeout/abort, 400 no retry, 429/503 retry, empty response, short-page pagination.

### AR-09 — Persisted auth mode and auth-transition races

- Severity/status: Medium — confirmed.
- Locations: `src/pages/Gate.jsx:47-69`; `src/store/useMediaStore.js:75-125,486-519`; `src/components/Layout.jsx:277-279`; client-only gates in Import/Settings.
- Root cause/affected workflow: persisted `authMode` is trusted after session expiry; no auth listener exists; late admin fetches can repopulate private state after logout/guest transition.
- Required fix/dependencies: verify live Supabase user before admin mode, subscribe to auth changes, generation-guard snapshot commits, clear private state on invalidation, and retain RLS as the actual authorization boundary.
- Database/migration/existing data: server role/claim enforcement remains runtime-dependent; no data backfill.
- Regression tests: expired restored session, cross-tab sign-out, token refresh, logout during deferred fetch, and guest transition.

### AR-10 — Persistence, restore, and destructive workflows can diverge

- Severity/status: Medium — confirmed.
- Locations: `src/store/useMediaStore.js:9-67,190-225,269-332,390-426`; `src/pages/Settings.jsx:208-215,284-293`; `src/pages/ImportTerminal.jsx:363-375,453-470`.
- Root cause/affected workflow: IndexedDB transactions can hang/silently no-op; optimistic cloud failures are console-only; backup format is unversioned/unvalidated; “overwrite” only merges cloud; nuke/restore report success before atomic completion.
- Required fix/dependencies: settle/reject IDB failures; surface cloud failures; version and validate backups; migrate legacy identity; await outcomes; use atomic owner-scoped reset/replace RPC semantics. Multi-tab updates receive revisioned merge protection where practical.
- Database/migration/existing data: local persist schema version/backfill plus database RPC; legacy backup compatibility retained.
- Regression tests: IDB abort/error settlement, malformed/malicious backup rejection, legacy/versioned restore, failed cloud writes, true replace semantics, and concurrent tab revisions.

### AR-11 — Status/date/season and comic progress invariants

- Severity/status: Medium — confirmed.
- Locations: `src/components/UI.jsx:311-418,1416-1508`; `src/store/useMediaStore.js:291-363`; `src/pages/Diary.jsx:117-125`.
- Root cause/affected workflow: non-final season completion sets series completion date while leaving in-progress; leaving completed retains the date; completed can save with no date; issue IDs are type-unstable and partial pages can imply whole-series completion; calendar dates are handled through UTC conversions.
- Required fix/dependencies: pure transition/date helpers, canonical issue IDs, authoritative total counts only, and valid local calendar-date handling.
- Database/migration/existing data: migration checks valid status/rating and date consistency without deleting legacy rows; questionable legacy values are preserved/reported before constraints.
- Regression tests: all status transitions, season milestone vs whole-series completion, string/numeric issue IDs, partial issue lists, cloud-loaded comic shape, and empty/date-boundary edits.

### AR-12 — Route/modal stale state, hooks, and missing loading state

- Severity/status: Medium — confirmed.
- Locations: `src/pages/Pages.jsx:316-321,472-625`; `src/components/UI.jsx:1416-1447`; `src/pages/Explore.jsx:379-388,641-646`; missing store field read by Pages/Diary.
- Root cause/affected workflow: guards precede hooks; detail reset keys only on ID and mutates during render; comic modal responses lack latest-request guards; old series issue state persists; pages read nonexistent `isLoading`.
- Required fix/dependencies: unconditional hooks or validated wrappers; route key includes type+ID and effect cleanup; request tokens/cancellation; series-keyed reset; explicit initial-load state.
- Database/migration/existing data: none.
- Regression tests: valid-to-invalid route, movie 550 to TV 550, A-to-B modal resolution order, series with issues to empty series, delayed cloud load.

### AR-13 — Dashboard/provider correctness defects

- Severity/status: Medium — confirmed.
- Locations: `src/pages/Pages.jsx:142-149,676-768`; `src/pages/Discovery.jsx:146-150,375-383,500-509`; `src/components/UI.jsx:714-729`; `vite.config.js:10-17`.
- Root cause/affected workflow: search restarts from unfiltered items; IGDB rating fallback multiplies a 0–100 score; “All Time Popular” applies a season; comic discovery is disabled; image failure sticks across sources; dev host checks are disabled.
- Required fix/dependencies: narrow UI/data corrections and config hardening.
- Database/migration/existing data: none.
- Regression tests: combined dashboard filter/search; provider score scales; discovery query variables/navigation; failed-to-valid image source; config assertion.

### AR-14 — Lint/test infrastructure gap

- Severity/status: Medium engineering risk — confirmed.
- Locations: `package.json:6-10`, `eslint.config.js`; repository-wide baseline.
- Root cause/affected workflow: no executable regression suite; lint contains true hook defects mixed with legacy unused/export warnings.
- Required fix/dependencies: add the smallest Node-compatible test command and pure domain modules; repair semantic lint errors; tune non-behavioural lint rules only where the current module layout intentionally conflicts.
- Database/migration/existing data: none.
- Regression tests: the regression suite itself, followed by lint and production build.

## False positives, already-protected behavior, and runtime limits

- Global search already has a latest-request token; transport cancellation is still missing.
- Category-page search and status filtering already combine correctly; only Dashboard is defective.
- Diary note JSX is escaped, and direct diary editing can clear text; the defect is same-day merge behavior.
- API caches have entry-count bounds; the remaining issue is stale lifetime/TTL, not unbounded entry count.
- New-tab links generally already use opener isolation; protocol validation is the missing control.
- Wildcard CORS alone is not an authorization bypass, and provider hosts are fixed, so no arbitrary-host SSRF was found.
- Supabase URL/anon keys are intentionally public; no committed service-role key was found. Server-only variables using `VITE_` names remain an accidental-exposure risk.
- Settings’ “globally” destructive copy is inaccurate: current code attempts to filter the authenticated user. Atomicity/error handling and canonical scoping are the defects.
- Hosted Supabase RLS, grants, Auth settings, Realtime publication, Edge JWT flags, live data, and backup/PITR cannot be claimed as verified. No remote contact is authorized.

## Checkpoint sequence

1. Security containment/UI correctness and regression-test foundation.
2. Canonical identity/local migration/store linkage.
3. Database migration/RLS/RPC and Edge boundary hardening.
4. Persistence/network/auth reliability and full validation.
5. Independent review fixes and final report.
