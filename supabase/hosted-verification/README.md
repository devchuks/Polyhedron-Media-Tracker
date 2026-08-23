# Hosted verification artifacts

These files support the 2026-08-16 read-only verification of the linked hosted
Polyhedron Supabase project.

- `core_contract_snapshot.sql` captures the relevant public columns,
  constraints, indexes, RLS state, policies, grants, functions, triggers, and
  Realtime publication membership.
- `catalog_snapshot.sql` is the broader catalog query used to check all public
  relations/functions and the `auth.users` reference shape.
- `data_preflight.sql` returns aggregate-only migration safety counts. It does
  not return titles, reviews, provider IDs, user IDs, or row contents.
- `blocker_characteristics.sql` characterizes the discovered blockers and
  legacy provider-ID shapes using aggregate counts only.
- `current_blocker_details.sql` returns only the minimum approved identifying
  fields for current completion-date blockers and orphan logs; it omits owner,
  Auth, review, and unrelated provider payload data.
- `hosted_snapshot_summary.json` is the credential-free result summary retained
  with the repository.

Every query file contains one `SELECT` statement. They were executed with the
pinned CLI via `supabase db query --linked --file ... --output json`. No hosted
DDL or DML was executed. A conventional `supabase db dump` was attempted but
could not run because Docker Desktop was unavailable; the catalog query path
was used instead.

These artifacts contain no project reference, access token, database password,
service-role key, user identifier, email, title, review text, or raw media/log
identifier.
