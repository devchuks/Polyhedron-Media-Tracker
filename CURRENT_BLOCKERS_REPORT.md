# Current Migration Blockers Report

Inspection date: 2026-08-23

Target: linked hosted Polyhedron production project (`ACTIVE_HEALTHY`)

Method: existing credential-free Supabase verification queries plus one focused
detail query, each containing a single `SELECT`. Official AniList and VNDB
read-only lookups were used only to resolve the two orphan provider IDs to
titles. No review text, user ID, email, Auth identifier, credential, or unrelated
API payload was retrieved into this report.

## Current production counts

| Check | Current result |
|---|---:|
| `media_library` rows | 705 |
| `media_logs` rows | 658 |
| library owners | 1 |
| log owners | 1 |
| null/missing Auth ownership rows | 0 |
| unsupported media rows | 0 |
| unsupported or null log-type rows | 0 |
| empty library media IDs | 0 |
| empty log media IDs | 0 |
| candidate canonical collision groups | 0 |
| candidate canonical collision rows | 0 |
| raw-ID cross-type collision groups | 0 |
| owner-scoped duplicate `log_id` groups | 0 |
| global duplicate `log_id` groups | 0 |
| canonical orphan logs | 2 |
| unsupported statuses | 0 |
| null statuses | 0 |
| ratings outside 0–10 | 0 |
| null ratings | 0 |
| completed rows without `dateCompleted` | 5 |
| non-completed rows with `dateCompleted` | 0 |
| null/invalid `readIssueIds` shapes | 0 |
| null/invalid `apiData` shapes | 0 |
| null required log fields | 0 |
| non-positive stored epoch values | 0 |
| media epoch values after 2100 | 0 |
| log dates after 2100 | 0 |
| same-day canonical diary duplicate groups | 1 |

Current media distribution is 432 movies, 114 TV entries, 74 games, 38 comics,
22 manga, 11 anime, 11 visual novels, and 3 books. Current status distribution
is 613 completed, 87 planned, and 5 in progress.

## Changes since previous hosted verification

The comparison baseline is the 2026-08-16 hosted verification snapshot.

| Measure | Previous | Current | Change |
|---|---:|---:|---:|
| Library rows | 703 | 705 | +2 |
| Log rows | 658 | 658 | 0 |
| TV rows | 112 | 114 | +2 |
| In-progress rows | 3 | 5 | +2 |
| Completed without date | 5 | 5 | 0 |
| Canonical orphan logs | 2 | 2 | 0 |
| Canonical collision groups | 0 | 0 | 0 |
| Same-day diary duplicate groups | 1 | 1 | 0 |

The net change is two valid in-progress TV rows. No additional current migration
blocker, collision, invalid field, or orphan log appeared. No previously observed
blocker class or count disappeared. The earlier privacy-minimized snapshot kept
aggregate blocker data rather than row identifiers, so exact row-for-row
continuity cannot be proven solely from that artifact; however, all current
blocker dates predate the earlier inspection and every blocker category/evidence
count is identical. All other media-type, status, log-type, and log-action counts
are unchanged.

The hosted table columns, types, nullability, defaults, PKs, FKs, indexes, RLS
state and policy names, grants, replica identity, public functions, triggers, and
Realtime publication membership are unchanged from the previous inspection.

## Current migration blocker summary

Seven current records still require preservation decisions:

- Five completed movies have no `dateCompleted`.
- Two diary logs have no deterministic library parent under the proposed
  canonical identity.

No additional blocker class was discovered.

## Completed items missing completion dates

Dates below are rendered in UTC. A diary entry is listed as evidence only when
its action is `WATCHED`, `READ`, or `PLAYED`. No completion date has been selected
or inferred.

| Title | Type | Status | Date started | Added | Completion diary evidence | Evidence date | Matching diary logs |
|---|---|---|---|---|---|---|---:|
| Backrooms | movies | completed | 2026-07-20 | 2026-07-20 | None | — | 0 |
| Casino Royale | movies | completed | — | 2026-06-14 | One `WATCHED` log | 2026-06-14 17:10:59 UTC | 1 |
| Is God Is | movies | completed | 2026-06-23 | 2026-06-23 | None | — | 0 |
| Quantum of Solace | movies | completed | — | 2026-06-14 | One `WATCHED` log | 2026-06-14 17:12:24 UTC | 1 |
| The Odyssey | movies | completed | 2026-07-20 | 2026-07-20 | None | — | 0 |

All five titles are unique within the current blocker set, so raw media IDs are
not included. Neither item with diary evidence has multiple plausible completion
logs. The other three have no matching diary log at all; `dateStarted` and
`addedAt` are identifying context only and are not automatically valid completion
dates.

## Orphan diary logs

Both provider IDs resolve deterministically to current official provider titles,
but neither log has an exact canonical, raw-ID, or image match in the owner's
library. Provider identification does not establish that a parent row should be
created or that the log should be attached heuristically.

| Provider-identified title | Type/action | Provider ID | Season | Log date | Stored image | Existing deterministic library match |
|---|---|---|---|---|---|---|
| Danganronpa/Zero | manga / `READ` | AniList `77917` | — | 2026-05-29 15:05:52 UTC | [AniList cover](https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx77917-vBUbEq4R1zyv.jpg) | None |
| Tegami (手紙) | vn / `PLAYED` | VNDB `v1298` | — | 2026-05-29 18:43:36 UTC | [VNDB cover](https://t.vndb.org/cv/99/1599.jpg) | None |

Titles were resolved by exact provider ID through the official read-only AniList
and VNDB APIs on 2026-08-23. No review excerpt was needed or retrieved for
identification. Neither log has a season label or season year.

## Other blockers

No other migration blockers were found. The one same-day canonical diary group
with multiple logs is unchanged and is not a blocker under the proposed stable
`(user_id, log_id)` identity; it should remain preserved unless a later product
decision establishes that the records are duplicates.

## Canonical identity status

Current canonical collision counts remain zero. Every current media and log type
maps to the proposed provider deterministically. Identifier-shape checks remain
compatible:

- TMDB and AniList IDs are numeric.
- Games contain 72 `igdb_`-prefixed IDs and 2 raw numeric IDs; both normalize to
  IGDB provider IDs without collision.
- All 11 VNDB IDs have the expected `v<number>` shape.
- All 3 Open Library IDs have the expected work-ID shape.
- All 38 Metron comic IDs retain their `issue_<number>` distinction.

The two newly added TV IDs are valid numeric TMDB identifiers and did not change
any collision count.

## Migration compatibility status

The corrected canonical migration remains structurally compatible with the
current hosted schema. Production schema, RLS, grants, functions, and Realtime
configuration have not drifted since the 2026-08-16 review.

The migration is **not ready to execute against production data** until the five
completion-date decisions and two orphan-log preservation decisions are made and
tested in disposable staging. The canonical migration was not changed during
this task, no reconciliation migration was created, and no migration was
executed.

## Production mutation status

Nothing was deployed or pushed to GitHub. No production record was repaired,
attached, deleted, quarantined, or assigned a completion date.

NO PRODUCTION DATA OR SCHEMA WAS MODIFIED DURING THIS CHECK.
