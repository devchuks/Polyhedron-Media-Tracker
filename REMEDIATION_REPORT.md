# Remediation Report

## Executive summary

The application was audited and remediated on the isolated local branch `codex/audit-remediation`. No code was pushed, no deployment was performed, and no migration or data mutation was run against a hosted Supabase project. The origin push URL is locally disabled as `DISABLED`.

All confirmed locally repairable High-severity defects and the covered Medium-severity defects were addressed in source. The work introduces canonical provider/type identity, stable diary linkage, owner-partitioned persistence, revision/tombstone synchronization, versioned backup migration, owner-only RLS artifacts, transactional database workflows, authenticated/idempotent Telegram handling, provider allowlists and quotas, safe markup/URL handling, and focused regression tests.

The final independent read-only review found no remaining actionable High- or Medium-severity defects in the local source. That conclusion is limited to static/local verification; the unapplied database and Edge artifacts still require the staging work listed below.

Final local results are: 44/44 Node tests pass, ESLint exits successfully with zero errors and 34 documented legacy warnings, the Vite production build succeeds, and an isolated browser smoke test passes for startup and core routes. Database, RLS, Realtime, and Edge runtime behavior could not be executed because this copy initially contained no reproducible schema and the machine has no Supabase CLI, PostgreSQL client/server, or Deno runtime. The generated migration therefore remains intentionally unapplied and requires staging verification before any production use.

## Confirmed audit issues fixed

### Canonical media identity and destructive scoping

- Previous behavior: TMDB movie/TV IDs and AniList anime/manga IDs were stored as bare durable IDs. Equal numeric IDs could collide, and updates, deletes, diary cascades, enrichment, restore, Telegram writes, and Realtime deletes could cross media-type boundaries.
- Root cause: raw third-party identifiers were incorrectly treated as globally unique.
- Implementation: `provider`, `media_type`, normalized `provider_id`, and deterministic `media_key` are now produced by one identity module. Raw route/provider IDs remain separately available for API compatibility. Store selectors, diary linkage, detail activity, cloud mutations, Realtime, imports, backups, normalizers, Telegram, unique constraints, and FKs use canonical identity and explicit owner scoping.
- Proof: identity and media-state tests coexistently model TMDB movie 550, TMDB TV 550, and cross-provider/type collisions; deletion/enrichment use exact canonical keys.

### Diary stability and enrichment

- Previous behavior: same-day updates ignored provider/type, replaced stable `log_id`, could not intentionally clear an empty review, and raw/prefix matching attached activity to unrelated media.
- Root cause: the diary used raw media IDs as linkage and generated a replacement UUID during merge.
- Implementation: diary entries carry canonical provider/type linkage; same-day idempotency preserves the original log ID and distinguishes an omitted review from an intentionally empty review. Diary, dashboard, and detail enrichment use exact keys.
- Proof: regression tests cover stable same-day IDs, review clearing, colliding media, and exact enrichment.

### Stale provider hydration and route/modal races

- Previous behavior: a late details response re-upserted a captured whole item and could revert a newer rating, status, progress, dates, rewatch count, or comic issue state. Same numeric IDs on type changes shared route state; comic modal responses could land out of order.
- Root cause: provider metadata and user-controlled state shared whole-object replacement paths without request generation guards.
- Implementation: provider metadata is patched against the latest canonical item, user fields are excluded from metadata patches, route reset keys include type and ID, and stale route/modal requests are ignored.
- Proof: metadata tests resolve a deferred provider response after newer user edits and confirm user fields survive. Local browser navigation also exercised the corrected Explore route.

### Stored/reflected XSS and unsafe links

- Previous behavior: provider/backup markup was transformed without first escaping raw HTML, then rendered through `dangerouslySetInnerHTML`; external links could retain active schemes.
- Root cause: string replacement was treated as sanitization and URL protocols were not centralized.
- Implementation: raw markup is escaped before a strict BBCode/Markdown allowlist is applied; generated attributes are escaped; external/provider URLs accept intended HTTP(S) protocols and optional host restrictions only. Backup normalization rejects/sanitizes unsafe DTO fields. A CSP is supplied through HTML and Netlify-compatible headers, and inline theme initialization moved to a static script.
- Proof: malicious tags, event handlers, quote breaking, `javascript:` and `data:` tests remain inert while valid HTTPS and intended VNDB-relative links remain usable.

### Auth/session transitions and cross-account cache isolation

- Previous behavior: persisted `authMode` could outlive a Supabase session. Whole IndexedDB snapshots were unioned without an owner, so logout/account switch could rehydrate one administrator's private library into guest mode or another account; failed hydration left the admin layout enabled.
- Root cause: client presentation state was trusted as authorization and persistence had no owner/reset generation.
- Implementation: admin mode is derived from a live Supabase user, auth events are subscribed, late snapshots are generation/owner guarded, and `authMode` is no longer persisted. Persisted state carries `ownerId` and a monotonic reset epoch; account changes replace rather than union data, stale-tab epochs cannot win, and running sessions reject rehydration from a different owner.
- Proof: persistence tests exercise admin A to guest, stale A after logout, and account B replacement. RLS remains the actual server authorization boundary.

### Missed deletions, multi-tab persistence, and cloud hydration

- Previous behavior: snapshot hydration unioned server rows without reading deletion state; offline/missed Realtime deletes could resurrect. Realtime DELETE often lacked the non-PK canonical key. Log deletion had no durable marker. Unpaginated reads silently truncated above PostgREST's 1,000-row cap. IndexedDB failure paths could remain unsettled, and the localStorage fallback watched a key that IndexedDB never wrote.
- Root cause: synchronization had no durable deletion protocol, revision/owner partition, verified pagination, or complete transaction error handling.
- Implementation: media and log tombstones are retained as durable deletion history locally and in the database, fetched during hydration, published to Realtime, and applied by revision. Parent deletion records child log tombstones before FK cascade; a newer live parent neutralizes only its media tombstone for log visibility, while log-specific tombstones still suppress deleted diary rows. Realtime tables use full replica identity. Cloud hydration uses deterministic range pagination with exact-count/identity verification, bounded retry of inconsistent attempts, and two identical multi-page fingerprints before replacement. Records carry revisions, client mutations are serialized by canonical identity, every database library mutation/replace/Telegram transaction shares a per-owner advisory lock, and narrow edits use a locked allowlisted patch RPC so stale snapshots cannot overwrite unrelated fields. Stale server writes are rejected, IndexedDB transactions settle on complete/error/abort, and BroadcastChannel has an actual localStorage pulse fallback. Whole-snapshot multi-tab writes merge by record/revision within the same owner only.
- Proof: tests cover tombstone resurrection prevention, unrelated concurrent-tab updates, owner/reset epochs, mutation ordering/recovery, >1,000-row pagination, rejection of incomplete snapshots, and balanced/insertion/deletion mutations between pages.

### Parent media/diary transaction ordering

- Previous behavior: UI and import could send a diary row before its newly required parent FK existed; imports discarded their queue item without awaiting cloud persistence.
- Root cause: media and log writes used independent queue keys and were not transactional.
- Implementation: both paired diary UI saves and import use an awaited `upsert_user_media_with_log` transaction. Failed batch imports stay queued and pause the batch; UI errors are surfaced instead of attempting an orphan log write.
- Proof: keyed-queue tests cover delayed/failing predecessor ordering, source-wiring tests require the atomic UI path, and migration assertions require the atomic RPC and composite FK.

### Backup/restore and destructive workflows

- Previous behavior: exports had no schema version, restore validation was shallow, “overwrite” only upserted cloud rows, and restore/nuke reported success before related operations completed.
- Root cause: raw state was treated as a trusted merge payload and multi-table operations were not atomic.
- Implementation: exports are versioned; legacy backups are canonically migrated; unsupported categories, future versions, invalid status/rating/date invariants, duplicate IDs, unsafe URLs, and orphan logs are rejected before state/cloud mutation. Restore and reset are awaited owner-scoped RPCs. Replace creates per-record tombstones newer than omitted rows, restores each included row newer than its own row/tombstone history, and then authoritatively reloads admin state. Local mutations allocate a revision newer than the affected record/tombstone, so a future-dated clock-skew marker stays identity-scoped and does not prevent an immediate edit.
- Proof: backup tests cover legacy migration, malformed/invariant-breaking input, duplicate media, unsupported categories, and orphan logs; persistence/migration/wiring tests cover future-dated per-record restore, immediate next revisions, and authoritative reload.

### Status, calendar, discovery, and comic correctness

- Previous behavior: completion dates and status diverged, season completion could complete a series, calendar inputs drifted through UTC, mixed-type comic issue IDs duplicated, partial issue pages could complete a whole series, dashboard search discarded its status filter, and several provider/discovery calculations or navigation paths were incorrect.
- Root cause: business transitions were distributed across UI event handlers with implicit provider-shape assumptions.
- Implementation: pure state/date helpers enforce completion invariants, local calendar conversion, canonical issue IDs, and authoritative totals. Dashboard filtering composes. IGDB score normalization, comic discovery/navigation, All-Time Anime variables, image fallback reset, bounded creator concurrency, and provider pagination were corrected.
- Proof: media-state and calendar tests cover status/date, season, mixed issue IDs, partial lists, filter composition, and extreme time-zone offsets.

### Network clients and provider Edge boundaries

- Previous behavior: browser requests had no reliable timeout/cancel semantics, retries included permanent failures, `Retry-After`/empty/non-JSON responses were mishandled, and Edge callers could supply broad provider paths/query languages with excessive page sizes.
- Root cause: provider proxies exposed transport-level upstream contracts instead of narrow application operations.
- Implementation: the client has structured errors, caller cancellation, timeouts, transient-only bounded retry, and `Retry-After`. Edge functions accept bounded JSON and allowlisted paths/operations/IDs/pages; IGDB/VNDB use typed operations; Metron pages/concurrency are bounded; upstream hosts remain fixed. An in-isolate limiter is backed by a durable database quota keyed by a one-way IP hash. Guest provider access remains intentional but quota-limited.
- Proof: network and Edge tests cover timeout/cancel, empty/non-JSON success, permanent versus transient retry, request allowlists, IGDB escaping, page bounds, webhook secret verification, escaping, and rate-limit metadata.

### Telegram webhook and service-role workflow

- Previous behavior: caller-supplied chat ID was the only webhook identity check; service-role media/log writes were separate, non-idempotent, and error-ignoring; private messages were logged; generated HTML was unsafe; a failed batch tail returned HTTP 200 and was lost; concurrent read-modify-write updates overwrote each other.
- Root cause: the public webhook trusted request content and orchestrated state transitions outside a transaction.
- Implementation: `X-Telegram-Bot-Api-Secret-Token` is verified before body parsing and the chat check remains secondary. Bodies/item counts are bounded, raw content is not logged, output is escaped, URLs are validated, IDs are canonical/deterministic, and each event is transactionally idempotent. The parsed batch plan is persisted once for stable retries; provider timeouts, non-success responses, and GraphQL error payloads remain retryable while genuine empty results use no-match feedback. Per-item failures return retryable status and feedback is best effort. The media RPC uses an advisory transaction lock, event revision ordering against retained deletion history, rewatch increments, and set-union issue updates.
- Proof: Edge tests cover fail-closed secret comparison, HTML/URL safety, and HTTP-200 GraphQL errors; source/migration assertions cover provider failure wiring, batch preparation, idempotency, transactional RPCs, deletion ordering, and locking structures.

### Reproducible database integrity and RLS

- Previous behavior: the repository claimed RLS but contained no schema, policies, constraints, grants, migration, or local configuration that could be reviewed.
- Root cause: hosted database state was not represented in source control.
- Implementation: a preservation-first migration defines canonical backfill/preflight, owner FKs, tenant-scoped keys, composite diary FK, status/rating/completion checks, owner-only CRUD policies, anon revocation, authenticated grants, Realtime publication/replica identity, tombstones, atomic reset/replace/upsert/delete workflows, webhook idempotency/batches, and durable quota state.
- Proof: static migration tests assert canonical uniqueness, FK cascade, every owner CRUD policy, transaction functions, tombstones, composite log identity, replica identity, webhook preparation, and quota RPC. Runtime RLS proof remains a manual staging action, not a claimed result.

## Audit claims that were false positives or already fixed

- Global search already had a latest-request token; transport timeout/cancellation was the missing layer.
- Category-page search already composed with status filtering; only Dashboard discarded the filter.
- Diary review JSX was already escaped, and direct diary editing could clear text; the defect was the same-day merge path.
- Provider cache entry counts were already bounded; TTL and stale-value behavior were the remaining concerns.
- Most new-tab links already used opener isolation; protocol validation was the exploitable omission.
- Fixed upstream hosts meant no arbitrary-host SSRF was present. Caller-controlled operations/paths were still an abuse and quota problem.
- The Supabase URL and anonymous key are intentionally public; no checked-in service-role key was found.
- Settings copy said “globally,” but the existing reset attempted to filter the current user. Canonical scoping, atomicity, and truthful completion were the actual defects.

## Newly discovered defects

The independent review found and drove fixes for issues not fully captured in the initial audit:

- Cross-account IndexedDB leakage caused by ownerless snapshot union.
- Server deletion resurrection because tombstones were not hydrated and DELETE payloads lacked canonical identity.
- Media/log FK races and import queue loss.
- Silent cloud snapshot truncation above 1,000 rows.
- Telegram batch-tail loss and concurrent rewatch/issue lost updates.
- Globally unique diary IDs preventing two owners from importing the same backup.
- Explore route failure due to a missing `useRef` import.
- Durable rather than per-isolate-only provider quota enforcement.
- Stricter backup invariant, duplicate, orphan, future-version, and unsupported-category validation.
- Child-log tombstones before parent cascade, atomic paired UI logging, and provider-error retry semantics.
- Stable pagination across balanced/insertion/deletion mutations and restore past future-dated tombstones.

## Security changes

- Strict escaped markup and safe HTTP(S) URL boundaries; CSP defense in depth.
- Live-session-derived UI auth and owner-partitioned local private data.
- Explicit user filtering plus owner-only RLS/grants and narrow RPC authorization.
- Telegram secret-header authentication, bounded/redacted payload handling, deterministic idempotency, transactional service-role scope, and safe feedback HTML.
- Fixed provider hosts, typed allowlisted Edge contracts, bounded bodies/pages/concurrency, transient retry policy, timeouts, and durable quota enforcement.
- Server credentials use non-`VITE_` names in source/example configuration. No credential values were added.
- Origin push is disabled locally; no remote write or deployment occurred.

## Data-model changes

- Canonical media identity: `provider + media_type + provider_id -> media_key`.
- Raw `id` remains for provider requests and legacy routes, but is never a destructive or ownership key.
- Library rows have a surrogate `library_row_id`, per-owner canonical uniqueness, and revision timestamp.
- Diary identity is `(user_id, log_id)` and diary rows link to `(user_id, media_key)`.
- Media and log tombstones prevent offline/stale resurrection.
- Persisted browser state schema is version 4 and contains an owner/reset epoch; backup schema is version 2.
- Provider metadata and user-controlled library state use separate patch semantics.

## Database migrations

### `supabase/migrations/202608160001_canonical_identity_rls.sql`

- Purpose: make identity, ownership, integrity, Realtime, deletion, restore, Telegram, and quota behavior reproducible.
- Affected tables: alters/creates `media_library` and `media_logs`; creates `media_tombstones`, `log_tombstones`, `webhook_events`, `webhook_batches`, and `edge_rate_limits`.
- Backfill: infers current providers by type, normalizes legacy game/book IDs, constructs canonical media keys, and links logs through legacy `media_type + media_id`. It stops with explicit exceptions for null owners, unsupported mappings, duplicate canonical rows/logs, invalid status/rating/completion invariants, or orphan logs rather than silently merging/discarding data.
- Integrity/security: adds owner FKs, canonical unique/composite keys, media/log FK cascade, check constraints, owner CRUD RLS, grants/revocations, Realtime publication/replica identity, tombstones, transactional user RPCs, idempotent Telegram functions, and durable provider quota state.
- Compatibility implications: legacy raw `id` is retained, but clients that still write without canonical columns will fail safely after `NOT NULL` enforcement. Migration, new client, and new Edge functions require a coordinated staged rollout. Existing cloud collisions that were previously overwritten cannot be reconstructed without another data source.
- Rollback considerations: this is not safely reversible by simply dropping columns because the new model permits raw-ID collisions and tenant-scoped log IDs that the legacy model cannot represent. Take a verified backup/PITR checkpoint and rehearse an explicit rollback/forward-fix plan in staging. Preflight failures require manual preservation-aware repair, not constraint removal.
- Execution status: generated and statically reviewed locally only. It has not been executed against any database.

## Tests added

The 44-test Node suite covers:

- Canonical movie/TV/cross-provider identity and legacy ID migration.
- Stable diary IDs, exact enrichment, same-day idempotency, and review clearing.
- Status/completion/season transitions, local calendar dates, mixed comic issue IDs, and partial issue lists.
- Provider metadata/user-state race protection and dashboard search/filter composition.
- XSS, BBCode/Markdown injection, active URL schemes, and valid safe links.
- API timeouts/cancellation, empty/non-JSON success, structured errors, `Retry-After`, and retry classification.
- Edge operation/path/page validation, IGDB escaping, Telegram secret/HTML checks, GraphQL error payloads, and rate limiting.
- Keyed mutation ordering/recovery, atomic paired UI workflow wiring, owner-lock/static RPC wiring, bounded concurrency/cache behavior, multi-tab record merges, deletion tombstones, owner/reset epoch replacement, future-tombstone restore/live-parent log linkage, and stable >1,000-row pagination across concurrent insertion/deletion.
- Versioned/legacy backups plus malformed shape, status/date invariant, duplicate, unsupported-category, and orphan rejection.
- Static database assertions for canonical keys/FKs/RLS/RPCs/tombstones/Realtime identity/composite diary IDs/webhook plans/quotas.

## Validation results

- `npm test`: PASS — 44 tests, 44 passed, 0 failed.
- `npm run lint`: PASS (exit 0) — zero errors; 34 remaining warnings are documented legacy unused-symbol/hook-dependency warnings and are not release-blocking.
- Typecheck: not applicable — no typecheck configuration exists and the JavaScript application was not converted to TypeScript.
- `npm run build`: PASS — Vite production build succeeds; Vite still reports the existing large-client-chunk warning.
- `git diff --check`: PASS — only Git line-ending notices were emitted; no whitespace errors.
- Database/RLS integration: NOT RUN — no disposable Supabase/PostgreSQL runtime or CLI is installed, and contacting the hosted database was prohibited.
- Edge/Deno runtime check: NOT RUN — Deno/Supabase CLI is not installed. Edge contracts are covered by Node-compatible helpers and static review.
- Dependency vulnerability audit: NOT RUN — it would require registry contact; no remote access was needed for this remediation.

## Optional browser verification

An in-app browser smoke test ran against a temporary Vite server with Supabase redirected to an unused localhost endpoint and no hosted credentials. It verified:

- Application startup and guest dashboard rendering.
- Movies category route.
- Diary route.
- Explore route, including the corrected `useRef` path.
- No browser console errors or warnings in those flows.

No provider search, deployment, hosted authentication, or hosted database action was performed. The temporary browser tabs and development server were closed afterward.

## Remaining manual actions

1. Review the hosted schema and take a verified database backup/PITR checkpoint before attempting the migration.
2. Apply the migration first to a disposable/staging Supabase project, then execute SQL parser/migration tests, two-user RLS CRUD tests, Realtime delete/reconnect tests, RPC concurrency/idempotency tests, and restore/reset tests.
3. Rehearse the coordinated migration/client/Edge rollout and rollback/forward-fix procedure. Do not apply the generated migration blindly if a preflight exception is raised.
4. Configure non-`VITE_` server secrets, including `TELEGRAM_WEBHOOK_SECRET`, and register the same secret with Telegram's `setWebhook` before deploying the logger.
5. Verify actual Supabase Auth settings, Edge `verify_jwt`, Realtime publication, grants, backups/PITR, CSP headers, and provider quotas in staging/production.
6. If any provider/server secret was ever exposed through a historical `VITE_` browser build, rotate it through the appropriate provider console; no rotation was performed locally.
7. Run a dependency vulnerability audit in an approved networked environment and assess the Vite bundle-size warning/code splitting separately.

## Remaining risks

- The migration is substantial and only statically tested. Unknown hosted constraints, indexes, column types, policies, triggers, data volume, or malformed legacy rows may stop its preservation-first preflight.
- Live RLS, Realtime, transaction locking, database quota, and Edge behavior are not claimed verified until the staging tests above pass.
- Already-overwritten raw-ID collisions cannot be reconstructed automatically.
- IndexedDB abort/quota handling was repaired by explicit transaction error/abort settlement, but a real browser quota-failure injection was not available in the local test stack.
- Guest provider access is intentional. Durable per-IP quota limits abuse but shared NATs can share a bucket, and production thresholds/observability need operational tuning.
- The client bundle remains large and should be code-split separately; this is a performance risk, not a remediation blocker.
- ESLint still reports legacy non-fatal warnings. They were not mechanically rewritten because unrelated cleanup could obscure the security/correctness changes.

## Files changed

- Repository guidance/config: `.env.example`, `AGENTS.md`, `AUDIT_REMEDIATION_PLAN.md`, `README.md`, `eslint.config.js`, `index.html`, `package.json`, `vite.config.js`, `public/_headers`, `public/theme-init.js`.
- UI/pages: `src/components/Layout.jsx`, `src/components/UI.jsx`, `src/pages/Diary.jsx`, `src/pages/Discovery.jsx`, `src/pages/Explore.jsx`, `src/pages/Gate.jsx`, `src/pages/ImportTerminal.jsx`, `src/pages/Pages.jsx`, `src/pages/Settings.jsx`.
- Domain/persistence/network: `src/domain/backup.js`, `src/domain/mediaIdentity.js`, `src/domain/mediaState.js`, `src/domain/persistenceMerge.js`, `src/services/apiRegistry.js`, `src/services/cloudPagination.js`, `src/store/useMediaStore.js`, `src/utils/apiClient.js`, `src/utils/boundedAsync.js`, `src/utils/calendarDate.js`, `src/utils/keyedQueue.js`, `src/utils/normalizers.js`, `src/utils/retry.js`, `src/utils/safeMarkup.js`, `src/utils/urlSafety.js`.
- Supabase: `supabase/config.toml`, `supabase/functions/_shared/durableQuota.ts`, `supabase/functions/_shared/validation.js`, provider/Telegram Edge handlers, and `supabase/migrations/202608160001_canonical_identity_rls.sql`.
- Tests: `test/backup.test.js`, `test/boundedAsync.test.js`, `test/calendarDate.test.js`, `test/cloudPagination.test.js`, `test/edgeValidation.test.js`, `test/keyedQueue.test.js`, `test/mediaIdentity.test.js`, `test/mediaState.test.js`, `test/migration.test.js`, `test/network.test.js`, `test/persistenceMerge.test.js`, `test/security.test.js`, `test/workflowWiring.test.js`.

## Local Git checkpoints

- `83f0a39` — `chore: remediation baseline checkpoint`
- `749f64e` — `fix: harden identity persistence and provider boundaries`
- `4ff8657` — `fix: close final synchronization and security gaps`
- `b41bf32` — `fix: resolve final independent review findings`

The final report itself is committed separately after the last verification/review pass.
