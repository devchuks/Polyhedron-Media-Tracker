# Antigravity remediation handoff

Prepared: 2026-08-23

## 1. Handoff purpose

Codex completed the major repository audit and foundational remediation, proved the reconciliation and canonical migrations on hosted staging, and completed two acceptance-discovery passes including a browser replay. The next phase is focused application remediation of the issue register, not another broad audit. This document is not authorization to migrate or deploy production.

## 2. Current Git baseline

- Branch: `codex/audit-remediation`
- Completed-discovery checkpoint: `f1809c53ced3c369535de5bd8f155082c5efa25c`
- The working tree was clean immediately after that checkpoint; this handoff is the only subsequent documentation change.
- No push occurred. The `origin` fetch URL remains configured, while its push URL is `DISABLED` so this disposable workspace cannot accidentally push.
- Ignored credential files were checked against tracked content. No staging password, service-role value, test-user email, token, or secret value is tracked.

## 3. Repository architecture

Polyhedron is a React 19/Vite SPA using React Router, Zustand state, IndexedDB guest persistence, and Supabase Auth/Postgres/Realtime for authenticated persistence. Provider adapters and normalizers live under `src/services` and `src/utils`; selected providers are proxied by Supabase Edge Functions. Cloud identity is canonicalized as provider + media type + normalized provider ID. The canonical database contract adds owner-scoped identities and RLS, RPC-based atomic mutations, revisions, and media/log tombstones.

## 4. Environment model

### Production

- The real deployed application and real production Supabase project.
- Read-only for development agents.
- The reconciliation and canonical migrations have **not** been applied.
- No production data, schema, Auth, Realtime, Edge Function, frontend, secret, or Telegram change is authorized.

### Staging

- A separate hosted **Polyhedron Staging** project, already reconciled and canonically migrated.
- Required remediated Edge Functions are already deployed there.
- User A owns a recognizable production-like acceptance library; preserve it.
- User B is the isolated/disposable account for destructive and RLS fixtures.
- Run the frontend with `npm run dev:staging`.
- URL, publishable key, service credentials, and test-user credentials live only in ignored local files. Never copy them into reports, source, logs, or commits.

### Local

- `polyhedron-tester` is the disposable working copy.
- Docker and a local Supabase stack are not part of this workflow.
- Do not push this workspace to GitHub.

## 5. What has already been proven

Do not rerun these proofs merely for confidence. `STAGING_VERIFICATION_REPORT.md` records the evidence for:

- exact seven-record reconciliation and the canonical identity/RLS migration;
- clean preservation failure and atomic rollback behavior;
- owner isolation through RLS and PostgREST client semantics;
- Realtime owner isolation, deletion identity, tombstones, reconnect hydration, and no resurrection;
- coexistence and independent mutation of colliding raw IDs across providers/types;
- RPC atomicity, stale revisions, advisory-lock concurrency, replace/reset ordering, and immediate restore/edit behavior;
- pagination above 1,000 rows;
- Edge JWT enforcement, operation allowlists, payload bounds, provider proxy behavior, quota enforcement, and safe errors;
- explicit staging frontend separation from production.

The browser-discovery evidence and remaining gaps are in `MANUAL_ACCEPTANCE_ISSUES.md` and `STAGING_MANUAL_TEST_CHECKLIST.md`.

## 6. Do NOT redo

Do not repeat the original repository-wide audit, redesign canonical identity, recreate either migration, rebuild staging from the legacy state without a proven recovery need, reset User A, or repeat destructive migration proof by default. Do not weaken RLS, bypass Auth, remove tombstones or revisions, push Git, deploy production, or modify production data/configuration. Preserve historical reports rather than rewriting old findings.

## 7. Current unresolved issues

`MANUAL_ACCEPTANCE_ISSUES.md` is authoritative. Its classification is **0 Critical, 3 High, 5 Medium, and 1 Low**; no issue is resolved at handoff.

| ID | Severity | Short title | Root-cause status | Browser pass 2 | Persistent-data risk |
|---|---|---|---|---|---|
| K1 | Medium | Poster blank until refresh | Probable image view-model inconsistency | Not reproduced on Fight Club/Steal | No direct corruption |
| K2 | Medium | Images disappear/reload on navigation | Probable/multi-causal | Not reproduced on tested paths | No direct corruption |
| K3 | High | Prior-season TV diary entries fabricated | Unknown | Not reproduced in either standard Foundation Season-3 case; previously user-reproduced | **Yes** |
| K4 | Medium | Planned TV persists/displays `S01 E00` | Confirmed end-to-end | Reproduced | **Yes** |
| K5 | High | Duplicate/oversized cloud hydration | Confirmed duplicate initiation; payload/serialization contribution probable | Reproduced duplicate slow waves; `57014` did not recur | Reliability, not direct corruption |
| D1 | High | Legitimate same-day diary activity overwrites another | Confirmed | Reproduced | **Yes** |
| D2 | Medium | Pre-auth gate lacks STAGING indicator | Confirmed | Reproduced | No |
| D3 | Low | Intentional provider `AbortError` shown as app error | Probable | Reproduced once | No |
| D4 | Medium | Snapshot rejected with `JWT issued at future` | Unknown | Reproduced once | No direct corruption |

### D1

Two legitimate same-day activities with distinct log IDs can collapse into one. The required conceptual direction is to separate **CREATE** semantics from **EDIT** semantics; a creation must not use date/media/season matching as permission to overwrite an existing stable log.

### K5

The full User A media snapshot is approximately 10.4 MB. SQL execution itself is fast, but the client requests `select=*` with a 1,000-row page, overlapping auth hydration occurs, Realtime `SUBSCRIBED` launches another full hydration, and hard refresh produced multiple snapshot waves. Do not “fix” this solely by raising a database statement timeout.

### K4

This is confirmed through UI and persistence: planned TV serializes the episode-zero sentinel as real progress and then displays `S01 E00`.

### K3

Keep this High because the user reproduced persistent fabricated diary history. The browser replay could not reproduce it in the standard no-prior-log or legitimate-prior-log Foundation cases. Do not invent a broad fix: trace alternate callers and data-specific paths, obtain the exact original reproduction if possible, and preserve it in a regression test.

### K1 and K2

Keep both registered even though the second pass did not reproduce them on Fight Club/Steal. K1 has a deterministic top-level `image` versus nested `apiData.image` representation inconsistency that remains a plausible sparse-record trigger. Correct the representation boundary first, then reassess whether K2 has any independent navigation/cache cause.

### D4

Do not weaken JWT validation. Trace browser clock/session restoration/token refresh ordering and provide bounded recovery when an invalid/restored session is rejected.

## 8. Recommended remediation order

1. **D1** — stop persistent same-day diary overwrites by separating create/edit semantics.
2. **K5** — deduplicate hydration and reduce snapshot cost without weakening completeness.
3. **K4** — stop persisting/rendering false episode-zero progress.
4. **K1** — establish one deterministic image view-model representation.
5. **K2** — reassess and fix any remaining navigation image defect after K1.
6. **D2** — show STAGING before authentication.
7. **D4** — add JWT/session tracing and bounded recovery without weakening validation.
8. **D3** — suppress benign intentional abort presentation while preserving real errors.
9. **K3** — targeted exact-path investigation, not a speculative rewrite.

Move K3 earlier only if a deterministic reproduction is obtained; its High severity remains unchanged.

## 9. Required non-regression invariants

- Canonical identity is provider + media type + normalized provider ID; raw IDs alone are never authoritative cloud identity.
- Every destructive/read/write operation is scoped to the exact owner and canonical identity.
- Provider metadata must not overwrite newer user-owned status, progress, rating, dates, reviews, or issue state.
- Diary entries retain stable `log_id` identities. A second legitimate event must not be merged merely because date/media/season match.
- Owner-only RLS and Realtime visibility remain enforced; authenticated client state is not a security boundary.
- Tombstones prevent resurrection, stale revisions are rejected, and immediate newer restores/edits remain possible.
- Season completion does not complete an entire TV series.
- Planned TV does not persist an episode-zero sentinel as actual progress.
- Partial comic issue lists never imply series completion; issue identity stays normalized.
- Untrusted HTML stays sanitized and unsafe URL schemes remain rejected.
- Successful Auth must not require multiple overlapping full-cloud hydrations.
- Production remains read-only.

## 10. Testing strategy for the next agent

For each issue: reproduce first; add a regression test that captures the failure; implement the smallest correct fix; run targeted tests; run the full local validation; verify runtime-sensitive behavior against hosted staging; and update issue status only with evidence.

Prefer User B and disposable records for destructive staging checks. Do not reset User A, and clean up disposable User B fixtures. Never write to production. Use existing browser capability when available; do not install a large browser automation framework merely for these issues. Normal `npm test` remains mocked/local and must not contact a hosted project.

## 11. Validation commands

Run from the repository root:

```text
npm test
npm run lint
npm run build
npm run build:staging
git diff --check
npm run dev:staging
```

There is no typecheck script. Lint currently exits successfully with 34 known warnings and zero errors; do not disguise issue remediation as warning cleanup.

Existing explicitly invoked staging tools:

- `node scripts/staging-discovery-diagnostics.mjs` — ongoing staging Auth/snapshot/image/TV diagnostics; read-only application data checks.
- `node scripts/staging-runtime-verification.mjs` — hosted staging RLS/RPC/Realtime/collision verification using temporary fixtures and cleanup; mutates staging only.
- `node scripts/staging-edge-verification.mjs` — live staging Edge contract verification.
- `scripts/staging-actual-library-refresh.mjs`, `supabase/staging-verification/manual_acceptance_reset.sql`, and the legacy/reconciliation/canonical SQL chain are **recovery-only reproducibility infrastructure**. They destructively rebuild staging and must not be run during normal remediation.
- `supabase/hosted-verification/production_actual_fixture_export.sql` is a production **SELECT-only** recovery input whose result must remain in memory and never be printed or committed.
- `supabase/staging-verification/cloud_snapshot_plan.sql` and `manual_discovery_metrics.sql` are useful ongoing read-only staging diagnostics.
- No obsolete diagnostic was removed during handoff because each retained file holds reproducibility or current evidence. Sensitive local artifacts (`.env`, `.env.staging.local`, `.env.staging.functions.local`, `.supabase/`) remain ignored.

## 12. Manual acceptance remaining

The principal personal/browser-only groups still needing coverage are:

1. exact original K1 title and click path;
2. exact original K2 title and browser/application Back path;
3. exact original K3 show, data shape, and logging click path;
4. TV whole-series completion and rewatch visual workflows;
5. anime/manga type-specific add, progress, completion, and reload;
6. game/VN/book type-specific progress, completion, diary, and reload;
7. comic partial-issue, authoritative-completion, and reload flows;
8. all-category Search plus Discovery/Explore pagination and stale-result presentation;
9. non-empty guest → authenticated → guest account/cache transitions;
10. backup/export/current import/legacy import/replace/malformed UI flows;
11. true multi-browser Realtime update/delete/reconnect presentation;
12. manual review clearing and sibling-entry preservation.

Use the detailed matrix in `STAGING_MANUAL_TEST_CHECKLIST.md`; do not convert a browser-required item to PASS from static inference alone.

## 13. What constitutes readiness for production planning

The application is not ready for production planning yet. Planning begins only after High persistent-data bugs are fixed, K5 hydration is reliable, Medium correctness issues are resolved or explicitly accepted, the manual checklist is materially complete, and staging verification passes after the fixes. Then rerun a final production read-only drift preflight and separately review backup, rollback, and cutover procedures.

## 14. Key source documents

Read in this order:

1. `AGENTS.md` — architecture, safety, current phase, and non-regression rules.
2. `ANTIGRAVITY_HANDOFF.md` — immediate baseline, issue order, and working constraints.
3. `MANUAL_ACCEPTANCE_ISSUES.md` — authoritative unresolved issue evidence and checklist matrix.
4. `STAGING_VERIFICATION_REPORT.md` — hosted migration, RLS, RPC, Realtime, Edge, and acceptance proof.
5. `STAGING_MANUAL_TEST_CHECKLIST.md` — authoritative manual flows and current annotations.
6. `REMEDIATION_REPORT.md` — historical repository-wide audit and foundational remediation.
7. `HOSTED_SCHEMA_VERIFICATION_REPORT.md` — historical read-only hosted schema/data verification.
8. `CURRENT_BLOCKERS_REPORT.md` — refreshed historical production blocker snapshot.
9. `supabase/migrations/202608160000_reconcile_legacy_blockers.sql` and `supabase/migrations/202608160001_canonical_identity_rls.sql` — reviewed migration source; do not apply to production.

`AUDIT_REMEDIATION_PLAN.md` is the historical execution plan and should be consulted only when provenance is needed.

## 15. Explicit safety statement

**Polyhedron Production has not been migrated or deployed with this remediation. Treat production as READ-ONLY until an explicit production-rollout task is authorized.**
