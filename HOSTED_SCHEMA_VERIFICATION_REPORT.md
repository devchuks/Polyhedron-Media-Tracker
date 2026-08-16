# Hosted Schema Verification Report

Date: 2026-08-16

Hosted project inspected: Polyhedron

Inspection mode: Supabase CLI Management API, catalog and aggregate `SELECT` queries only

## Executive summary

The generated canonical-identity migration was structurally close to the actual
hosted database, but it was **not production-applicable as originally written**.
The hosted legacy tables and data types match the migration's main backfill
model, and the proposed canonical mapping produces no identity collision.
However, the migration would deliberately stop on seven existing data problems:
five completed movies have no completion date, and two diary logs have no
deterministically matching library row.

Hosted inspection also found three implementation gaps that were corrected in
the local migration:

1. Existing ownership foreign keys use `NO ACTION`, while the intended contract
   requires `ON DELETE CASCADE`.
2. Existing nullable/default definitions would have remained weaker than the
   remediated application contract.
3. `authenticated` currently has `TRUNCATE`, `REFERENCES`, and `TRIGGER` in
   addition to CRUD; RLS does not protect `TRUNCATE`.

The local disposable Supabase configuration also targeted PostgreSQL 15 while
the hosted project runs PostgreSQL 17. It now targets major version 17.

The local migration now replaces only an exact non-cascading owner FK, enforces
the verified required null/default semantics, revokes excess authenticated
table privileges before re-granting CRUD, and refuses to replace any unknown
RLS policy. It still stops on the seven data issues because choosing dates or
inventing missing parent media would not be preservation-safe.

**HOSTED PRODUCTION MIGRATION HAS NOT BEEN EXECUTED.** No hosted rows, schema,
policies, grants, functions, publications, Auth settings, secrets, or Edge
Functions were changed.

## Inspection method and retained artifacts

The linked project was identified through the authenticated CLI project list.
The repository's pinned Supabase CLI version, 2.105.0, was invoked with `npx`.
The Docker-dependent schema dump path was unavailable, so inspection used the
CLI's `db query --linked` Management API path. Each retained query is a single
read-only `SELECT`.

Credential-free artifacts are in `supabase/hosted-verification/`:

- `catalog_snapshot.sql`
- `core_contract_snapshot.sql`
- `data_preflight.sql`
- `blocker_characteristics.sql`
- `hosted_snapshot_summary.json`

No user IDs, emails, titles, reviews, provider IDs, log IDs, project reference,
or credentials are retained in those artifacts.

## Hosted schema discovered

### `public.media_library`

The table has 15 legacy columns:

| Column | Hosted type | Hosted constraint/default |
|---|---|---|
| `id` | `text` | not null |
| `user_id` | `uuid` | not null |
| `title` | `text` | not null |
| `type` | `text` | not null |
| `subtype` | `text` | nullable |
| `progress` | `text` | nullable |
| `status` | `text` | nullable, no default |
| `rating` | `numeric` | nullable, default `0` |
| `addedAt` | `bigint` | nullable |
| `dateStarted` | `bigint` | nullable |
| `dateCompleted` | `bigint` | nullable |
| `rewatchCount` | `integer` | nullable, default `0` |
| `readIssueIds` | `jsonb` | nullable, default `[]` |
| `image` | `text` | nullable |
| `apiData` | `jsonb` | nullable, default `{}` |

The primary key is `(id, user_id)`. The only additional index is on `user_id`.
The owner FK is `user_id -> auth.users.id` with the default `NO ACTION` delete
behavior. There are no check constraints or application triggers.

### `public.media_logs`

The table has 10 legacy columns:

| Column | Hosted type | Hosted constraint/default |
|---|---|---|
| `log_id` | `text` | not null, global primary key |
| `user_id` | `uuid` | not null |
| `media_id` | `text` | not null |
| `media_type` | `text` | nullable |
| `action_type` | `text` | nullable |
| `log_date` | `timestamptz` | nullable |
| `review_text` | `text` | nullable |
| `image` | `text` | nullable |
| `season_label` | `text` | nullable |
| `season_year` | `text` | nullable |

The only additional index is on `user_id`. The owner FK is
`user_id -> auth.users.id` with `NO ACTION`. There is no FK from a log to a
library item and no application trigger.

### Other relevant hosted objects

- PostgreSQL is 17.6.
- `pgcrypto` 1.3 is already installed; `plpgsql` and `uuid-ossp` are also
  available.
- The only public function is the platform `rls_auto_enable()` event-trigger
  function. None of the remediation RPC names exist, so there is no signature
  collision.
- No canonical columns, tombstone tables, rate-limit table, Telegram webhook
  tables, or equivalent structures exist.
- No public sequences are relevant to these tables.
- Both legacy tables are already members of `supabase_realtime`.
- Both use default replica identity, not `FULL`.

## Existing RLS state

### `media_library`

RLS is enabled but not forced. One permissive `ALL` policy, `Users can manage
their own library`, applies to `public` and uses `auth.uid() = user_id` for both
`USING` and `WITH CHECK`.

This predicate correctly owner-scopes ordinary SELECT/INSERT/UPDATE/DELETE, and
the non-null owner column prevents the anonymous `NULL = NULL` case. It is not
the final desired posture: it is not split into auditable CRUD policies, RLS is
not forced, and both `anon` and `authenticated` have every table privilege,
including `TRUNCATE`, which bypasses row policies.

### `media_logs`

RLS is likewise enabled but not forced. Its single `ALL` policy, `Users can
manage their own logs`, has the same owner predicate and the same grant concern.

### Migration interaction

The two existing policy names are known legacy policies and can be replaced by
the generated owner CRUD policies. The local migration no longer drops every
policy it finds. It allowlists the two verified legacy policies and its own
target policies, and aborts for review if any other library/log policy exists at
execution time. This preserves unrelated future policies instead of silently
removing them.

## Existing data preflight

Only aggregate results were collected.

| Check | Result |
|---|---:|
| `media_library` rows | 703 |
| `media_logs` rows | 658 |
| library owners | 1 |
| log owners | 1 |
| null or missing Auth owners | 0 |
| unsupported library types | 0 |
| unsupported/null log types | 0 |
| empty raw media IDs | 0 |
| candidate canonical collision groups | 0 |
| raw-ID cross-type collision groups currently present | 0 |
| owner-scoped duplicate `log_id` groups | 0 |
| global duplicate `log_id` groups | 0 |
| orphan logs under raw and canonical linkage | 2 |
| unsupported statuses | 0 |
| ratings outside 0–10 | 0 |
| completed rows without completion date | 5 |
| non-completed rows with completion date | 0 |
| invalid `readIssueIds` JSON shapes | 0 |
| invalid `apiData` JSON shapes | 0 |
| null required log fields | 0 |
| dates after 2100/non-positive stored epoch dates | 0 |
| same-day canonical diary duplicate groups | 1 |

The 703 media rows are 432 movies, 112 TV, 74 games, 38 comics, 22 manga,
11 anime, 11 visual novels, and 3 books. Statuses are 613 completed, 87 planned,
and 3 in progress.

Provider-ID inference is deterministic for every current row:

- all TMDB and AniList IDs are numeric;
- games contain 72 `igdb_`-prefixed IDs and 2 raw numeric IDs, both handled by
  the proposed prefix normalization;
- all 11 VNDB IDs have the expected `v<number>` shape;
- all 3 Open Library IDs have the expected work-ID shape;
- all 38 current comic IDs are `issue_<number>` and remain type-preserving.

### Blocking rows

Five completed movie rows lack `dateCompleted`. Two have an owner-matched
`WATCHED` log that could provide evidence for a date; three have no linked log.
All five have `addedAt`, and three have `dateStarted`, but neither value is
automatically equivalent to a true completion date. The migration therefore
must not invent these dates.

Two logs are orphaned: one manga `READ` log and one visual-novel `PLAYED` log.
Both contain review text and an image, and neither image matches another owned
library row. There is no deterministic parent to attach them to. Deleting them
would lose valid user history; attaching them heuristically could corrupt it.

One same-day canonical diary group contains more than one stable log. This does
not violate the proposed `(user_id, log_id)` identity and must be preserved
unless a separate product decision confirms that the entries are duplicates.

## Migration compatibility review

| Migration section | Classification | Hosted comparison / consequence |
|---|---|---|
| `pgcrypto` extension | Redundant but compatible | Version 1.3 already exists. |
| Legacy table creation guards | Compatible | Tables exist; `IF NOT EXISTS` does not replace them. |
| Canonical column expansion | Compatible and required | All new identity/revision columns are absent. |
| Ownership preflight | Compatible | No ownership gaps. |
| Status/rating/date preflight | **Would fail** | Five completed rows lack a date. This is an intentional preservation stop. |
| Provider inference | Compatible | Every hosted media/log type is supported; inspected identifier shapes match the mappings. |
| `media_key` backfill | Compatible after blocker resolution | Produces no duplicate `(user_id, media_key)`. |
| Orphan validation | **Would fail** | Two logs have no deterministic canonical parent. |
| Global-to-owner log PK transition | Compatible and required | No `log_id` duplicates; hosted PK is global. |
| Required null/default semantics | Required modification | Hosted legacy nullable columns would otherwise stay nullable. Corrected locally. |
| Raw library PK transition | Compatible, deliberately destructive to the old constraint | Actual PK is `(id, user_id)` and must be replaced by surrogate row identity plus owner/canonical uniqueness. No other hosted FK references it. |
| Canonical uniqueness/checks | Requires staged data repair | Identity/rating/status checks are safe; completion validation is blocked by five rows. |
| Auth owner FKs | Required modification | Actual FKs are `NO ACTION`; corrected migration replaces only exact non-cascading owner FKs with cascade semantics. |
| Log composite FK | Requires staged data repair | Safe only after the two orphan logs are explicitly reconciled or quarantined. |
| Indexes | Compatible and required | Generated names do not conflict with hosted indexes. |
| Replica identity `FULL` | Compatible and required | Both hosted tables currently use default identity. |
| RLS transition | Compatible after local correction | Known legacy policies are replaced; unknown policies now stop migration instead of being dropped. |
| Grants | Required modification | Hosted `authenticated` has excess privileges. Local migration now revokes all then grants CRUD only. |
| Tombstone tables/policies | Compatible and required | No conflicting hosted objects exist. |
| Authenticated RPCs | Compatible and required | No names/signatures currently exist; client call names and parameters match. |
| Realtime publication | Compatible | Core tables already published; tombstones will be added conditionally. |
| Durable quota objects/RPC | Compatible and required | No conflicting objects; Edge helper parameter names and boolean result match. |
| Telegram tables/RPCs | Compatible and required | No conflicting objects; Edge parameter names and result handling match. |
| Comments | Compatible | No behavioral impact. |

## Local migration corrections

The local migration was changed, but not executed:

- Expanded preflight checks cover non-null counters/JSON fields, JSON shape, and
  required diary fields before constraints are strengthened.
- Required legacy columns now receive the intended defaults and `NOT NULL`
  constraints after successful preflight.
- Existing exact `user_id -> auth.users.id` FKs with non-cascade delete behavior
  are discovered by catalog shape, dropped by their actual names, and replaced
  with `ON DELETE CASCADE`.
- The RLS transition recognizes only the two hosted legacy policy names and the
  target policy names. An unknown policy aborts migration for review.
- `anon` and `authenticated` privileges are revoked before CRUD is re-granted;
  this removes inherited legacy `TRUNCATE`, `REFERENCES`, and `TRIGGER` grants
  from the application role.
- Static migration assertions cover these corrections.
- `supabase/config.toml` now uses PostgreSQL major version 17 for parity with
  the hosted engine during disposable staging tests.

No automatic correction was added for the seven data blockers. That omission is
deliberate: their correct values cannot be inferred without a user-data decision.

## Edge Function and RPC contract verification

The remediated client and Edge Functions agree with the corrected migration:

- Client RPCs: `upsert_user_media`, `patch_user_media`, `delete_user_media`,
  `upsert_user_log`, `upsert_user_media_with_log`, `delete_user_log`,
  `delete_user_media_logs`, `replace_user_library`, and `reset_user_library`.
- Durable quota RPC: `consume_edge_quota(p_scope, p_subject_hash, p_limit)`
  returns boolean and is service-role only.
- Telegram RPCs: `prepare_telegram_batch(p_event_id, p_user_id, p_plan)` returns
  the stable JSON plan; `apply_telegram_media_event(p_event_id, p_user_id,
  p_media, p_log)` returns boolean.
- Telegram's public webhook function checks the configured secret-token header;
  the four credential proxies require JWT verification in `config.toml`.
- Canonical payload fields expected by the RPCs match client and Telegram
  payload construction.

The database migration must exist before the remediated frontend or Edge
Functions are deployed. No Edge Function was deployed during verification.

## Final proposed migration sequence

Production is blocked until steps 1–3 have passed in a disposable environment.
The exact intended order is:

1. Restore a schema-compatible, access-controlled copy of the hosted structure
   and representative data into a disposable Supabase project.
2. Prepare a separate, operator-reviewed data-reconciliation migration with a
   timestamp before `202608160001`. It must assign evidence-approved completion
   dates to the five identified rows and either restore the two missing parent
   media rows or move the complete orphan log records into an owner-protected
   quarantine table. It must assert exact affected counts and abort on drift.
   This migration is not yet authored because the choices are manual.
3. Apply the corrected
   `supabase/migrations/202608160001_canonical_identity_rls.sql`.
4. Run all staging SQL/RLS/Realtime/RPC tests below. Recreate staging from
   scratch and repeat the full sequence to prove reproducibility.
5. Only after approval, schedule one coordinated production database migration,
   then deploy compatible Edge Functions and frontend. This report does not
   authorize or perform that rollout.

The canonical migration should not be applied alone to production: its current
preflights will stop on the five completion inconsistencies after the opening
additive DDL statements, and its later orphan preflight would also stop if the
first blocker were resolved without reconciling the logs. Transaction/rollback
behavior must be proven in staging before relying on it.

## Staging requirements

### Migration and preservation

- Parse/apply against PostgreSQL 17 in disposable Supabase.
- Start from the exact hosted legacy column, PK, FK, policy, grant, publication,
  and replica-identity shape.
- Load a sanitized 703-media/658-log fixture preserving aggregate distributions
  and all seven blocker shapes.
- Prove the canonical migration fails and leaves no partial DDL before
  reconciliation; do not assume transaction wrapping without this staging test.
- Apply the reviewed reconciliation migration; prove exact row counts and full
  preservation, including quarantine contents when selected.
- Apply the canonical migration and verify all backfills, constraints, indexes,
  FKs, comments, grants, RLS, Realtime membership, tables, and function
  signatures.
- Verify 703 library records and 658 live-plus-quarantined log records remain
  accounted for.
- Rebuild staging from scratch and repeat. Test a second canonical-migration run
  only to document its supported idempotency expectation; do not assume arbitrary
  partial-DDL recovery.
- Inject unsupported type, ownership gap, canonical collision, duplicate log ID,
  unknown policy, malformed JSON, and orphan cases; each must stop without a
  silent merge or data loss.

### RLS with two users

For user A and user B, prove owner CRUD succeeds and prove A cannot select,
insert-as-B, update, or delete B's `media_library`, `media_logs`,
`media_tombstones`, or `log_tombstones` rows. Verify anonymous access and direct
`TRUNCATE`/`REFERENCES`/`TRIGGER` privileges are absent. Repeat through PostgREST,
not only a table-owner SQL session.

### Realtime

- Each owner receives only their own library/log/tombstone events.
- A canonical delete contains enough old-row identity to remove exactly one
  item and its logs.
- Disconnect, delete, reconnect, paginate, and hydrate; deleted media/logs must
  not resurrect.
- Exercise a primary-key-only delete fixture to confirm `REPLICA IDENTITY FULL`
  is actually active.

### Identity

- Coexist and independently mutate/delete TMDB movie 550, TMDB TV 550, AniList
  anime 550, AniList manga 550, and an equal raw ID from another provider.
- Verify routes/API calls retain raw `provider_id` while storage uses
  `media_key`.
- Verify game prefix normalization, Open Library work normalization, and Metron
  series/issue distinctions.

### Transactions, revisions, and RPCs

- Atomic media-plus-log upsert and rollback on injected log failure.
- Owner-scoped single log/media/log-set deletes and tombstone creation.
- Replace/restore and reset, including future tombstones.
- Stale revision rejection and immediate post-restore edits.
- Two-connection disjoint patches, advisory locking, concurrent replace/write,
  and deterministic final state.
- Telegram serial/concurrent replay idempotency, stale-event suppression,
  partial provider failure, and resumable batch behavior.
- Quota limit, window rollover, invalid scope/hash/limit, and cross-instance
  behavior.
- More than 1,000 rows plus concurrent insert/delete during pagination.

## Production rollout prerequisites

After staging approval, a coordinated rollout will eventually require:

1. reviewed data-reconciliation SQL and a verified backup/recovery point;
2. the corrected canonical database migration;
3. the remediated frontend built from the matching commit;
4. the matching Supabase Edge Functions;
5. server-side provider/service credentials configured only in Edge secrets;
6. `TELEGRAM_WEBHOOK_SECRET` configured server-side and the Telegram webhook
   secret token coordinated with the function rollout;
7. verification of Auth, RLS, grants, Realtime publication, replica identity,
   and monitoring in the target environment;
8. an explicit rollback/forward-fix plan that does not discard canonical data.

None of these production actions was performed.

## Remaining manual decisions

1. Approve the true completion date for each of the five completed movies.
   Two have watch-log evidence; three require user/domain confirmation rather
   than an automatic `addedAt`/`dateStarted` substitution.
2. Decide whether each of the two orphan logs should regain a specific parent
   media row or be preserved in an owner-protected quarantine. They must not be
   silently deleted or heuristically attached.
3. Select/provision the disposable Supabase staging environment and an approved
   sanitized-data transfer method. Production must not be used for migration
   rehearsal.

## Local verification results

- `npm test`: passed, 45/45 tests.
- `npm run lint`: passed with 0 errors and 34 existing warnings.
- `npm run build`: passed with Vite 8.0.10; the existing large-chunk advisory
  remains.
- `git diff --check`: passed.

Runtime SQL, RLS, PostgREST, Realtime, and two-connection concurrency behavior
remain intentionally unverified until the disposable staging phase because no
local Docker/PostgreSQL runtime was available and production cannot be used for
migration execution.

## Migration execution status

**HOSTED PRODUCTION MIGRATION HAS NOT BEEN EXECUTED.**
