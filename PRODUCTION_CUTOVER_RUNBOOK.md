# Polyhedron production cutover runbook

Status: **NO-GO until the pre-mutation prerequisites below are satisfied**

Prepared from read-only production inspection: 2026-08-24 (Africa/Lagos)
Production project reference: `jckzshgnhxnhsnqqbaor`

This runbook is planning evidence, not authorization. No command in the mutation sections may run until the data owner explicitly authorizes a production cutover.

## A. Current production snapshot

Production remains on the verified legacy contract: PostgreSQL tables `media_library` and `media_logs`, legacy primary keys `(id, user_id)` and `(log_id)`, owner FKs without cascade, RLS enabled/not forced, two owner-scoped `ALL` policies, broad legacy table grants, both tables in `supabase_realtime`, and default replica identity. The only public function is the platform `rls_auto_enable` event trigger. There are no canonical columns/RPCs, tombstone, webhook, or quota tables yet. This matches the structure used for hosted staging migration proof; no schema drift is migration-impacting.

| Metric | Current value |
|---|---:|
| Media | 705 |
| Diary logs | 658 |
| Owners | 1 media / 1 logs |
| Canonical collision groups | 0 |
| Canonical orphan logs | 2 (the two approved bogus rows) |
| Completed without completion date | 5 (the five approved targets) |
| Other status/rating/date/JSON/ownership blockers | 0 |
| Same-day identity groups | 1 (valid stable-log-ID coexistence; not a migration blocker) |

Media by type: movies 432, TV 114, games 74, comics 38, manga 22, anime 11, VN 11, books 3. Statuses: completed 613, planned 87, in progress 5. Logs by action: LOGGED 639, WATCHED 15, PLAYED 3, READ 1.

The drift-guarded reconciliation still matches exactly:

| Target | Stable identity/guard | Current evidence |
|---|---|---|
| Backrooms | movies / TMDB 1083381 / completed / null completion | Started renders 2026-07-20 |
| Casino Royale | movies / TMDB 36557 / completed / null completion | exactly one WATCHED log on 2026-06-14 |
| Is God Is | movies / TMDB 1380316 / completed / null completion | Started renders 2026-06-23 |
| Quantum of Solace | movies / TMDB 10764 / completed / null completion | exactly one WATCHED log on 2026-06-14 |
| The Odyssey | movies / TMDB 1368337 / completed / null completion | Started renders 2026-07-20 |
| bogus Danganronpa/Zero log | log `08c943c8-cbf4-4462-b29e-780421751dbf`, manga/AniList 77917/READ | exists, exact guard matches, no parent |
| bogus Tegami log | log `922ad384-ce27-4daa-a5fc-591a30eb012e`, VN/VNDB v1298/PLAYED | exists, exact guard matches, no parent |

One deterministic obsolete sentinel remains: Chapelwaite, `tv` / TMDB `126118`, planned, exact progress `S01 E00`. The separately reviewable [cleanup script](supabase/production-cutover/cleanup_planned_tv_episode_zero.sql) targets only that row and was **not executed**.

Authoritative repeatable reads are [data_preflight.sql](supabase/hosted-verification/data_preflight.sql), [final_cutover_preflight.sql](supabase/hosted-verification/final_cutover_preflight.sql), [current_blocker_details.sql](supabase/hosted-verification/current_blocker_details.sql), and [core_contract_snapshot.sql](supabase/hosted-verification/core_contract_snapshot.sql).

## B. Expected pre/post accounting

| Stage | Media before → after | Logs before → after | Expected mutation | Required result |
|---|---:|---:|---|---|
| Initial | 705 → 705 | 658 → 658 | none | 5 completion blockers, 2 approved orphans, 0 collisions |
| Reconciliation `202608160000` | 705 → 705 | 658 → 656 | update exactly 5 media; delete exactly 2 logs | 0 completion blockers; 0 orphans |
| Canonical `202608160001` | 705 → 705 | 656 → 656 | structural/backfill only | 705 canonical media, 656 owner-scoped logs, 0 collisions/orphans |
| Exact Chapelwaite cleanup | 705 → 705 | 656 → 656 | update exactly 1 progress value to null | 0 planned-TV exact `S01 E00` rows |

Any other row count is an immediate STOP. No unexplained row may be lost.

## C. Backup checklist

The cutover requires both a platform restore point and independent logical evidence. Do not begin mutation until Supabase dashboard access confirms the project backup/PITR policy, records the latest usable restore timestamp, and confirms who can initiate a restore.

From the repository root, create an ignored local backup without Docker:

```powershell
$cutoverStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$cutoverDir = Join-Path (Resolve-Path '.supabase') "production-cutover/$cutoverStamp"
New-Item -ItemType Directory -Force -Path $cutoverDir | Out-Null
npx.cmd --yes supabase@2.105.0 db query --linked --file supabase/hosted-verification/production_cutover_backup.sql | Set-Content -Encoding utf8 (Join-Path $cutoverDir 'user-data.json')
npx.cmd --yes supabase@2.105.0 db query --linked --file supabase/hosted-verification/catalog_snapshot.sql | Set-Content -Encoding utf8 (Join-Path $cutoverDir 'catalog.json')
node scripts/verify-production-cutover-backup.mjs (Join-Path $cutoverDir 'user-data.json')
Get-FileHash -Algorithm SHA256 (Join-Path $cutoverDir 'user-data.json'), (Join-Path $cutoverDir 'catalog.json') | Format-Table
```

The data JSON preserves complete media/log rows and owner UUID relationships. The catalog JSON preserves definitions, constraints, indexes, triggers, functions, RLS/policies, grants, publication membership, and replica identity. Keep both ignored and encrypted at rest; never commit or print their row contents. Also record read-only Edge Function inventory, production secret **names**, the current Telegram webhook host/function and pending-update count, and the current Netlify deploy ID.

STOP if either JSON is absent/unreadable, its verifier fails, hashes are missing, or a platform restore path has not been confirmed.

## D. Cutover sequence

1. Obtain explicit production authorization and announce a short maintenance window.
2. Confirm Netlify deploy and rollback access; record the current production deploy ID.
3. Confirm Supabase physical restore/PITR access and create/record the restore point.
4. Create and verify the independent logical backup above.
5. Repeat all four production read-only preflight/catalog queries. STOP on any drift.
6. Disable Telegram delivery with `deleteWebhook` and `drop_pending_updates=false`; record that queued updates are retained. Prevent old-frontend writes during the maintenance interval.
7. Apply the two reviewed migrations using the Supabase migration runner so each migration receives its normal transaction boundary: reconciliation first, canonical second.
8. Immediately verify 705 media / 656 logs, five corrected dates, the two exact bogus logs absent, zero canonical collisions/orphans, owner consistency, new constraints/RLS/grants/publication/replica identity/RPCs/tombstones/webhook/quota structures.
9. Execute the exact Chapelwaite cleanup file as its own atomic statement, then verify exactly one row changed and accounting stayed 705/656.
10. Add/verify production Edge secret names and deploy `tmdb`, `igdb`, `metron`, `vn`, then `telegram-logger` from this checkpoint. Schema must precede these deployments because the provider functions require `consume_edge_quota` and Telegram requires canonical RPC/webhook tables.
11. Run authenticated provider/Edge smoke tests without creating production media.
12. Configure a new `TELEGRAM_WEBHOOK_SECRET`, deploy the logger, set the webhook to the production `telegram-logger` URL with the secret-token header, and verify `getWebhookInfo` before sending anything.
13. Deploy the verified production frontend immediately after database/Edge health is established.
14. Smoke test Auth, full library hydration/accounting, one reversible media workflow, TV progress/season semantics, Diary exact-log editing, delete/tombstone/no-resurrection, providers, and Realtime.
15. Only after all prior checks pass, authorize one deliberately disposable Telegram media action; inspect exact canonical media/log results and remove it through the normal application.
16. Re-run row/invariant accounting, monitor logs/errors, and end maintenance.

The old frontend must not remain writable against the canonical schema. It omits canonical identity and uses legacy direct upserts/deletes; inserts can fail against the new owner/media-key contract and raw-ID deletes are no longer an acceptable identity boundary. Keep maintenance in place and minimize the database-to-new-frontend interval.

## E. Verification and STOP conditions

- Before mutation: linked ref must be `jckzshgnhxnhsnqqbaor`, staging ref must differ, counts and seven target guards must match this snapshot.
- Reconciliation: exactly five updates/two deletes; any exception or count difference stops the cutover.
- Canonical: migration runner success plus 705/656, no collision/orphan, required RLS/grants/FKs/RPCs, Realtime membership and `REPLICA IDENTITY FULL`.
- Sentinel: only Chapelwaite `tv/planned/S01 E00`; `S01 E01`, in-progress rows, dates, diary, and provider data untouched.
- Edge: all required secret names present; JWT/allowlists/quota pass. Never substitute browser `VITE_*` secrets for Edge names.
- Telegram: webhook remains disabled until schema/function/secret verification passes; no production message before explicit smoke-test authorization.
- Frontend: production ref present, staging ref/test users/service role absent, no forced STAGING label, no secret material.
- Final: User A-visible production accounting 705/656 plus any explicitly approved disposable smoke fixture, with the fixture subsequently removed.

## F. Rollback and forward-fix reality

- If reconciliation fails, its single `DO` statement rolls back. Stop; do not weaken guards.
- If canonical migration fails inside the migration runner, stop and verify catalog/data residue before any retry. Use the physical restore point if atomicity is not proven in production.
- After successful canonical migration, a casual down migration is unsafe. Prefer a narrowly reviewed forward fix; use the platform restore point plus catalog/data artifacts for a full rollback if integrity/security cannot be restored quickly.
- The old frontend is not a safe post-canonical rollback target for writes. Keep maintenance active until either the new frontend is healthy or the database is physically restored.
- Edge rollback means redeploying the exact previous production source/version only if it remains compatible with the current database phase. The old Telegram logger is incompatible after canonical migration.
- Frontend rollback uses Netlify's recorded prior deploy only if database compatibility is confirmed. Otherwise use maintenance plus forward fix/DB restore.
- Telegram rollback before DB mutation may restore the recorded old webhook. After canonical migration, do not reactivate the old logger; keep the webhook disabled while correcting forward or restoring the DB.

## G. Edge and Telegram activation inventory

Current production functions: `tmdb` v29, `igdb` v6, `metron` v6, `vndb` v7, `vn` v5, `telegram-logger` v37. Current staging-tested functions: `tmdb`, `igdb`, `metron`, `vn` v4 and `telegram-logger` v6 (project-local version counters; compare source, not numbers). All five current source functions differ from the old production source. Legacy `vndb` is not required by the current frontend.

Required secret names:

- TMDB: `TMDB_API_KEY`.
- IGDB: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`.
- Metron: `METRON_USERNAME`, `METRON_PASSWORD`.
- Provider quota: platform `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `ADMIN_USER_ID`, platform Supabase URL/service-role/anon key.

Production currently lacks the exact new names `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `METRON_USERNAME`, `METRON_PASSWORD`, and `TELEGRAM_WEBHOOK_SECRET`; legacy browser-prefixed equivalents do not satisfy the new Edge source. The four underlying provider values were recovered from ignored Polyhedron-local configuration and mapped to the new server-only names in ignored `.env.production-cutover.local`. Historical Git source inspection found no browser-side `import.meta.env`/equivalent consumer for the IGDB secret or Metron password, and an in-memory comparison found neither value in the current production browser bundle; **rotation is not currently required by exposure evidence**. This is a “not found exposed” result, not proof about every unavailable historical deployment artifact.

The same ignored cutover file contains a newly generated 32-byte/64-hex-character `TELEGRAM_WEBHOOK_SECRET`. No value is committed or printed. `scripts/prepare-production-cutover-secrets.mjs` can recreate/validate the file without manual credential copying. Add the prepared names only in the separately authorized cutover; do not run `supabase secrets set` during preflight. The current webhook points to production `telegram-logger`, has zero pending updates/no reported error, and must not be repointed during preflight.

## H. Frontend deployment

Production site: `https://project-polyhedron.netlify.app` (public HEAD 200, Netlify). No tracked `netlify.toml` exists; `public/_redirects` supplies SPA routing. The production build requires only browser-public `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Build verification found the production ref, no staging ref/test credentials/service-role value, and no forced STAGING badge.

Before mutation, obtain Netlify dashboard/CLI access, record the current deploy ID and environment variable names, and prove the prior deploy can be restored. Deploy the locally verified `dist` or the authorized source commit according to the site's established mechanism. Do not use the disabled Git push URL unless a separate push/deployment authorization is given.

## I. Production smoke test

1. Sign in normally and hydrate all 705 media / 656 logs without `57014` or duplicate hydration.
2. Confirm recognizable titles, posters/backgrounds, Diary and eight category routes.
3. Add one disposable item using canonical provider/type/ID, edit it, create two distinct same-day logs, reload, then delete it and verify tombstone/no resurrection.
4. Test planned TV (no `S01 E00`), real episode progress, and one selected-season log only.
5. Verify provider searches/details and owner-only Realtime in a second session.
6. Run the separately authorized disposable Telegram test last and account for/remove it.

## J. Final acceptance criteria

- Backups readable and restore authority confirmed.
- Exact 705 media / 656 legitimate logs after reconciliation/canonical/sentinel cleanup.
- Zero canonical collisions, orphans, ownership mismatches, and invariant failures.
- Canonical RLS/grants/RPCs/tombstones/Revisions/Realtime verified.
- Required Edge secrets/functions and secured Telegram webhook verified.
- New production frontend healthy; old incompatible frontend no longer writable.
- No smoke fixture remains and error monitoring is quiet.

## Current verdict

**NO-GO** to begin production mutation today. Data and schema are migration-ready. The exact provider names are still absent from production by design, but their underlying values are locally recoverable without manual copying, the new Telegram webhook secret is securely prepared, and no browser-exposure evidence currently requires provider rotation. The focused staging application-path Realtime replay passed owner-visible INSERT, UPDATE, canonical DELETE/tombstone delivery, owner isolation, reconnect, and no resurrection; exact cleanup returned User A to 707/660 and User B to 0/0. An auxiliary service-role raw-DELETE subscription timed out in one diagnostic attempt, while the owner tombstone path passed and the unchanged migration suite's prior raw-delete identity proof remains valid; recheck that auxiliary payload during the cutover smoke window rather than treating it as an application blocker.

Production remains **NO-GO** because a physical Supabase restore/PITR path has not yet been confirmed and Netlify deploy/rollback access plus the current deploy ID are not available from this repository/public preflight. Resolve those two pre-mutation requirements, rerun the read-only guards, then request explicit cutover authorization. The lingering optional-metadata skeleton lifecycle is corrected and regression-tested: all eight curated Guest detail routes and read-only User A records spanning TMDB, IGDB, AniList, OpenLibrary, Metron, and VNDB settled without a lingering metadata pulse. Residual accepted engineering risks remain K3 (**NOT REPRODUCED / UNRESOLVED**, though all known callers are single-selected-season) and D4 (**NOT REPRODUCED / UNRESOLVED WITH BOUNDED RECOVERY**, without weakened JWT validation).

**STOPPED BEFORE PRODUCTION MUTATION — EXPLICIT AUTHORIZATION REQUIRED FOR CUTOVER.**
