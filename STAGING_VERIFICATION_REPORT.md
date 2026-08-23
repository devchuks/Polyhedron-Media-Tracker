# Polyhedron staging verification report

Date: 2026-08-23

## Executive summary

The preservation-safe reconciliation and canonical identity/RLS migrations were tested successfully on a separate hosted Supabase staging project. Staging was built from the verified pre-remediation production contract and a sanitized 705-media/658-log fixture containing all seven approved blocker shapes. The reconciliation corrected exactly five completion timestamps and deleted exactly two confirmed bogus orphan logs. The canonical migration then preserved all 705 media and all 656 legitimate logs while producing the intended canonical identity, ownership, constraint, RLS, Realtime, RPC, webhook, and quota contracts.

The entire staging database was subsequently reconstructed to the legacy state and the clean-failure, reconciliation, canonical transformation, catalog accounting, Edge, and two-user runtime checks were repeated successfully. Docker and a local Supabase stack were not used.

## Staging project identity

- Project name: **Polyhedron Staging**
- Project reference: `tyhbowelwkkprxharzmt`
- Region: `eu-west-1`
- Database behavior: hosted PostgreSQL 17 contract
- Status during verification: active and healthy
- Relationship to production: a separate project reference, verified before every staging write

The generated staging database password, publishable key, service-role key, and two staging-only test-user credentials are stored only in ignored local `*.local` environment files. They are not included in this report or tracked by Git.

## Production safety statement

Production was used only for the minimum approved read-only `SELECT`/catalog preflight and sanitized fixture export. No production row, schema, policy, grant, Auth setting, Realtime setting, secret, Edge Function, Telegram webhook, or frontend deployment was changed. No database push or migration was run against production. Nothing was pushed to GitHub.

## Legacy staging reconstruction

The initial staging contract reproduced:

- the legacy `media_library` and `media_logs` columns, types, defaults, and nullability;
- legacy primary keys `(id, user_id)` and global `log_id`;
- legacy owner foreign keys with default `NO ACTION` behavior;
- RLS enabled but not forced;
- the two legacy public `ALL` ownership policies;
- the legacy broad `anon`, `authenticated`, and `service_role` grants;
- membership of both source tables in `supabase_realtime`;
- default replica identity.

The legacy catalog matched the previously captured production contract. The unrelated platform helper function present in production was not needed by either migration; all required tables are explicitly secured by the canonical migration.

The staging fixture retained the actual provider/raw IDs, types, statuses, ratings, progress, dates, issue-ID shapes, relationships, diary identities/actions/dates, and aggregate distributions required for migration proof. Production owners were remapped to staging User A. Non-blocker titles were replaced with deterministic fixture labels, reviews were replaced with safe shape-preserving placeholders, images were removed, and API payloads were replaced with empty objects. No production email address, Auth credential, review content, token, secret, or Telegram configuration was copied.

## Reconciliation migration

Migration: `supabase/migrations/202608160000_reconcile_legacy_blockers.sql`

The migration is a single atomic `DO` statement and aborts on aggregate drift, identity drift, target-count drift, newly deterministic orphan parents, or any unexpected row accounting.

### Five movie corrections

| Title | Approved source | Verified UTC calendar date | Result |
|---|---|---:|---|
| Backrooms | exact existing `dateStarted` timestamp | 2026-07-20 | corrected |
| Casino Royale | exact unique WATCHED diary timestamp | 2026-06-14 | corrected |
| Is God Is | exact existing `dateStarted` timestamp | 2026-06-23 | corrected |
| Quantum of Solace | exact unique WATCHED diary timestamp | 2026-06-14 | corrected |
| The Odyssey | exact existing `dateStarted` timestamp | 2026-07-20 | corrected |

Every stored completion timestamp exactly matched its approved source; no arbitrary time or `addedAt` fallback was used.

### Two deleted bogus orphan logs

- exact log `08c943c8-cbf4-4462-b29e-780421751dbf`: manga / AniList `77917` / READ;
- exact log `922ad384-ce27-4daa-a5fc-591a30eb012e`: VN / VNDB `v1298` / PLAYED.

Each deletion required its stable log ID plus expected legacy media type, raw provider ID, action, timestamp, null season fields, and continued absence of a deterministic parent.

### Staging result

- media: 705 before, 705 after;
- logs: 658 before, 656 after;
- completion blockers: 5 before, 0 after;
- canonical orphan logs: 2 before, 0 after;
- exact approved timestamp matches: 5 of 5;
- exact bogus log IDs remaining: 0;
- all other preflight invariant failures: 0.

The same result was reproduced after the staging-only destructive reconstruction.

## Canonical migration result

Migration: `supabase/migrations/202608160001_canonical_identity_rls.sql`

Hosted catalog/data checks verified:

- 705 populated, distinct surrogate `library_row_id` values;
- deterministic `provider`, `provider_id`, `media_type`, and `media_key` for every source row;
- zero library/log mapping mismatches, null canonical fields, identity collisions, duplicate owner log IDs, or orphan logs;
- surrogate library primary key, owner-scoped `(user_id, media_key)` uniqueness, owner-scoped diary primary key, and validated composite media/log foreign key;
- actual child-log cascade behavior and cascading owner foreign keys;
- validated status, rating, and status/completion-date constraints;
- required defaults and nullability;
- media/log tombstone tables;
- all seven application/supporting tables with RLS enabled and forced;
- ten expected ownership policies;
- sixteen intended authenticated CRUD table grants, zero anonymous private-table grants, and zero authenticated `TRUNCATE`, `REFERENCES`, or `TRIGGER` grants;
- explicit runtime denial of authenticated `TRUNCATE` on both source tables with row counts unchanged;
- four Realtime publication memberships and `REPLICA IDENTITY FULL` on both source tables;
- all twelve required user, quota, and webhook functions;
- Edge quota and Telegram webhook tables/structures.

## Migration failure/rollback behavior

The canonical migration was executed against unreconciled staging twice: once after the initial legacy fixture load and once after a destructive legacy reconstruction. Both attempts stopped at the expected completion invariant before identity backfill.

After each failed execution, hosted catalog and row checks showed:

- zero canonical columns remaining on either source table;
- zero canonical supporting tables remaining;
- media still 705;
- logs still 658;
- all five completion blockers still present.

This proves that the actual hosted SQL runner used for this verification rolled back the failed migration file atomically in both trials. The reconciliation migration additionally provides statement-level atomicity through its single `DO` block.

## Data preservation

Every source row was accounted for:

| Stage | Media | Logs | Explanation |
|---|---:|---:|---|
| Legacy staging fixture | 705 | 658 | sanitized production-shaped legacy fixture |
| After reconciliation | 705 | 656 | exactly two user-approved bogus orphans deleted |
| After canonical migration | 705 | 656 | all legitimate rows transformed and linked |
| After runtime fixture cleanup | 705 | 656 | imported baseline restored |

The legitimate same-day canonical diary grouping remained represented. No legitimate diary row was deleted. No source row was silently dropped, merged, or reassigned to another owner.

## RLS results

Actual PostgREST/Supabase-client tests used staging User A and User B:

- User A saw all 705 of its imported rows; User B saw zero; anonymous `SELECT` was denied.
- Each user could create and manage its own media and diary fixtures.
- Cross-owner media/log reads returned no rows.
- Forged inserts owned by the other user failed.
- Cross-owner updates and deletes affected no rows.
- Equal `log_id` values coexisted for different owners.
- Tombstones were owner-isolated in both directions.
- User B was reset to zero fixtures; User A returned to exactly 705 imported rows.
- Authenticated `TRUNCATE` was denied for both source tables in an explicit staging SQL role probe.

## Realtime results

- User A received its own canonical INSERT and owner tombstone event.
- User B received neither User A's source event nor tombstone.
- A staging service-role subscription observed the corresponding raw DELETE with the exact surrogate row identity.
- The raw source tables have catalog-confirmed `REPLICA IDENTITY FULL`; the owner tombstone carries the canonical media key used by the application deletion path.
- Reconnect hydration found the deleted fixture absent; it did not resurrect.
- One immediate Realtime attempt directly after dropping/re-adding the publication during reproducibility timed out while the hosted replication worker refreshed. After propagation, the complete Realtime suite passed again.

## Canonical collision results

User B created five deliberate raw-ID `550` records:

- TMDB movie;
- TMDB TV;
- AniList anime;
- AniList manga;
- Open Library book.

All five had distinct canonical keys and coexisted. One was updated independently. Deleting the TMDB movie left the other four and the diary entry attached to the AniList manga untouched. The collision fixtures were subsequently removed by the staging reset/cleanup workflow.

## RPC/concurrency results

The hosted runtime suite exercised:

- `upsert_user_media`;
- `patch_user_media`;
- `delete_user_media`;
- `upsert_user_log`;
- `upsert_user_media_with_log`;
- `delete_user_log`;
- `delete_user_media_logs`;
- `replace_user_library`;
- `reset_user_library`.

Verified behaviors included atomic media+log save, injected child-FK failure rolling back the parent, stale revision rejection, same-base disjoint concurrent patches, advisory-lock serialization, replace versus concurrent upsert without duplicates/orphans, reset, owner-scoped tombstone ordering, stale restore rejection, immediate restore with a revision 1 ms newer than the tombstone, and explicit pagination of 1,005 rows as pages of 1,000 and 5.

## Edge Function results

The remediated `tmdb`, `igdb`, `metron`, `vn`, and `telegram-logger` functions were deployed to **staging only**. Docker was not running and was not used by deployment.

Runtime checks passed for:

- JWT required on all four provider proxies;
- fixed structured operation/path allowlists;
- rejection of request bodies above 32,000 bytes;
- successful live staging calls to TMDB, IGDB, Metron, and VNDB;
- durable quota RPC allowing the first request, denying the second at a limit of one, and rejecting an invalid scope;
- bounded, credential-free error responses;
- Telegram POST-only and webhook-secret gates.

Provider credentials were configured as staging Edge secrets, not browser variables. The production Telegram webhook was not changed. Real Telegram bot/chat credentials were deliberately not copied; a generated staging webhook secret was used to prove the authentication gate, and the accepted-secret path stopped at the expected configuration error. Live Telegram delivery remains a separate-test-bot manual action.

## Frontend staging connection

- `.env.staging.local` contains the staging URL and publishable key and is ignored by Git.
- `npm run dev:staging` and `npm run build:staging` select Vite's staging mode explicitly.
- Development mode displays a visible **STAGING** badge.
- The staging bundle contains the staging project reference and contains no production project reference.
- Staging User A/User B authentication succeeded through the actual hosted client, and owner hydration returned 705/0 rows respectively.
- Vite served `/`, Movies, TV, Diary, Discovery, Explore, and Settings routes with HTTP 200.

The in-app browser controller blocked local-network navigation before page load, so no browser UI automation or credential entry was attempted. Interactive UI acceptance remains documented in `STAGING_MANUAL_TEST_CHECKLIST.md`; the server and ignored staging configuration are ready for manual use.

## Automated validation results

- `npm test`: 46 of 46 passing, including reconciliation ordering/static assertions.
- `npm run lint`: exit 0, zero errors; 34 existing warnings remain.
- `npm run build`: passing, with the existing bundle-size advisory.
- `npm run build:staging`: passing; target-reference isolation check passed.
- hosted staging runtime suite: 13 of 13 grouped checks passing after the reproducibility rebuild.
- hosted staging Edge suite: passing before and after the reproducibility rebuild.
- `git diff --check`: recorded in the final local validation/checkpoint step.

## Manual testing still required

Complete [STAGING_MANUAL_TEST_CHECKLIST.md](./STAGING_MANUAL_TEST_CHECKLIST.md), especially multi-season TV transitions, comics with partial/authoritative issue lists, account/cache transitions in real browser sessions, backup UI flows, and multi-session Realtime behavior.

Live Telegram delivery requires a separate test bot and was intentionally not attempted with the production bot.

## Issues discovered and fixes made

- Added the deterministic, drift-guarded seven-record reconciliation migration and its static regression assertions.
- Added reproducible staging legacy schema, sanitized fixture, accounting, clean-failure, contract, TRUNCATE, cleanup, and reconstruction SQL artifacts.
- Added repeatable staging runtime and Edge verification scripts that read secrets only from ignored local files.
- Added explicit staging frontend scripts and a development-only STAGING badge.
- Confirmed that RLS-protected clients use canonical tombstones for reliable deletion propagation; the raw DELETE's surrogate identity is retained as a fallback and replica identity is FULL.
- No defect requiring a change to the corrected canonical migration was found in hosted execution.

## Remaining blockers before production

- Complete and review the manual staging checklist.
- If live Telegram behavior is required, configure a separate staging test bot; never repoint the production bot during staging.
- Rerun the minimum read-only production blocker/drift preflight immediately before any production change window.
- Review/approve the final production backup, maintenance, monitoring, and rollback procedure.
- Production migration authorization remains a separate explicit decision.

## Production migration status

No reconciliation or canonical migration has been executed in production. No production Edge Function or frontend deployment occurred.

HOSTED PRODUCTION MIGRATION HAS NOT BEEN EXECUTED.
