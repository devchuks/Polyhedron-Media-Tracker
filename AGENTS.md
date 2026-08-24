# Polyhedron Engineering Guide

## Architecture

Polyhedron is a Vite/React 19 single-page application. React Router owns navigation, Zustand owns client state, IndexedDB persists guest state, and Supabase Auth/Postgres/Realtime persist authenticated state. Provider adapters and normalizers live under `src/services` and `src/utils`. Supabase Edge Functions under `supabase/functions` proxy selected third-party APIs. Database migrations belong under `supabase/migrations` and must be reviewable without contacting a hosted project.

## Current remediation phase

Foundational remediation and the hosted staging migration proof are complete. Production has not been migrated and remains read-only. Current work is application-level remediation of the unresolved issues in `MANUAL_ACCEPTANCE_ISSUES.md`, with the already-migrated Polyhedron Staging project as the only hosted runtime verification target.

Before making a substantial modification, every future coding agent must read, in order:

1. `ANTIGRAVITY_HANDOFF.md`
2. `MANUAL_ACCEPTANCE_ISSUES.md`
3. `STAGING_VERIFICATION_REPORT.md`
4. `STAGING_MANUAL_TEST_CHECKLIST.md`

Do not casually reconstruct staging, repeat the legacy migration proof, or reset User A's recognizable acceptance library. Prefer User B and disposable fixtures for destructive staging tests, then clean those fixtures up. Preserve the canonical identity, owner-scoped RLS, tombstone/no-resurrection, and revision-ordering guarantees already proven in staging. Explicit hosted runtime checks must be staging-only and separately invoked; the normal local test suite must remain mocked and must never contact production.

## Tooling and commands

- Package manager: npm (the authoritative lockfile is `package-lock.json`).
- Install dependencies: `npm ci`.
- Development server: `npm run dev`.
- Staging development server: `npm run dev:staging`.
- Tests: `npm test`.
- Lint: `npm run lint`.
- Production build: `npm run build`.
- Staging build: `npm run build:staging`.
- Typecheck: none is configured; this is a JavaScript codebase and must not be converted to TypeScript as incidental work.

## Domain invariants

- Raw third-party provider IDs are not globally unique. Canonical identity includes provider, media type, and provider ID; all identity-sensitive lookups, updates, deletes, logs, caches, routes, imports, and exports must preserve that context.
- Destructive operations must use proper ownership and canonical identity. A raw ID, UI category, or client-side mode alone is never a safe delete predicate.
- Provider metadata must not overwrite newer user-controlled state such as status, progress, rating, dates, review text, or read issue IDs.
- Diary entries have stable log identities. Updating a same-day entry must preserve its `log_id`, while distinct media types/providers with colliding raw IDs must remain independent.
- TV library state and TV diary history are distinct. Saving status or episode progress does not create historical diary rows.
- One explicit TV season action creates at most one log for the selected season. It never backfills earlier seasons, and completing a season does not imply starting the next season.
- Whole-series TV completion sets overall state/date without fabricating missing season logs. Separate watch/rewatch activities require separate stable log IDs.
- Editing or deleting TV diary history targets the exact `log_id` and does not implicitly recompute current library progress/status unless an explicitly designed workflow says otherwise.
- `addedAt`, `dateStarted`, and `dateCompleted` have distinct meanings. First genuine consumption initializes `dateStarted` once; completion uses the explicit activity time and must not silently rewrite an earlier start.
- An activity date is the diary event timestamp. It is not a provider release year or TV `season_year`, and callers must not infer one from the other.
- Telegram commands must preserve the same library/diary semantics as the UI, resolve canonical provider identity deterministically, persist media plus any diary event atomically, and remain idempotent for a repeated Telegram update.
- Completion dates and completion status move together: completed items have a completion date; leaving completed clears it unless a workflow explicitly preserves historical completion in a diary record.
- Issue IDs are compared canonically across string/number input, and partial issue lists must never imply that an entire series is complete.
- Untrusted HTML must never be rendered unsanitized. Prefer rendering text/React nodes; any exceptional HTML boundary requires an allowlist sanitizer and a regression test.
- External URLs require safe protocol validation. Only intended `http:` and `https:` links may open externally; reject active schemes such as `javascript:` and unsafe generated URLs.
- Stale async provider responses must not update state for a newer route, query, modal selection, or user edit.
- Sparse provider metadata must never erase a valid stored top-level image. Provider errors shown to users must be bounded and must not expose raw upstream diagnostics.
- Cached/current content remains mounted during background refreshes. Blocking skeletons are reserved for an initial state with no usable content, and loading/error paths must always settle.
- Curated Guest data seeds only a genuinely fresh local guest namespace. Reloads, edits, individual/all-item deletion, and an explicit Settings clear must never resurrect fixture rows; clearing the browser's entire local site storage may begin a new seed lifecycle.
- Guest state and authenticated owner state remain separate persisted namespaces. Guest fixtures never upload, merge into an authenticated owner, or expose authenticated cached rows after logout.

## Security and database invariants

- Client state must never be treated as an authorization boundary. In particular, `authMode` is presentation state, not permission evidence.
- Every cloud read/write must be scoped to the authenticated owner even when RLS is expected to provide defense in depth.
- RLS must enforce owner-only SELECT, INSERT, UPDATE, and DELETE for both `media_library` and `media_logs`; realtime visibility must follow the same ownership boundary.
- Edge Functions must authenticate callers where appropriate, use fixed upstream hosts, validate structured operations and identifiers, bound request sizes/pagination, and never accept unrestricted upstream paths or query languages.
- Service-role credentials and third-party secrets never belong in browser bundles, logs, tests, or committed files.
- Existing production user data must be preserved. Never reset or mutate the production Supabase project during remediation or testing.
- A production cutover requires a separately authorized change window, a verified readable backup, an immediately repeated read-only drift guard, and stage-by-stage STOP conditions. A successful preflight is not mutation authorization.
- Polyhedron Staging may be mutated only by an explicitly staging-targeted verification or remediation workflow.
- Preserve User A's recognizable staging acceptance dataset. Prefer User B and disposable fixtures for destructive staging tests.
- Migrations require backfill consideration. Every identity/schema change must document collision handling, legacy compatibility, existing-user-data impact, rollback constraints, and whether it has been executed.
- Multi-record destructive workflows should be atomic where practical, with ownership checked inside the database transaction or RPC.

## Testing conventions

- Every confirmed defect fix should have a regression test where practical. Tests should reproduce the failure mode, not merely exercise the happy path.
- Keep domain transitions and identity/security helpers in small pure modules so Node-based unit tests can validate them without browser automation.

### Normal local automated tests

- `npm test` and ordinary unit/component tests must mock Supabase and network boundaries.
- Normal local automated tests must never contact any hosted Supabase project.

### Explicit hosted staging verification

Polyhedron does not use Docker or a local Supabase stack. Separately invoked staging runtime/integration scripts may contact and mutate only the explicitly verified **Polyhedron Staging** project.

- Confirm the staging project identity before any destructive operation and never target production.
- Prefer User B and disposable fixtures, and clean disposable fixtures afterward.
- Preserve User A's recognizable acceptance baseline unless a task explicitly authorizes a narrowly scoped User A test.
- Do not reconstruct or reset staging without an explicit recovery requirement.
- Production remains strictly read-only.

- Relevant tests, linting, and the production build must be run before work is considered complete. Run typechecking too if a typecheck command is added later.
