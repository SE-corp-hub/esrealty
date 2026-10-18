# ES Realty Backend Design and Fixture Prompt

Use this prompt to audit, fixture-test, and safely extend the ES Realty backend.
The goal is a reliable backend contract that works with the current frontend,
local worker, Vercel functions, Supabase, private file storage, and any mobile
viewport.

## Current Backend Design

Verify the repository before changing it. The current architecture includes:

- `js/app.js` as the browser application and state coordinator.
- `supabase/app_state` as the current general user-state persistence layer.
- `supabase/pms_workspaces` as the Property Management workspace persistence
  layer for super-admin workflows.
- `market-scan/worker/server.js` as a local Node HTTP worker on port 8932.
- `market-scan/worker/store.js` for local JSON persistence, listing history, and
  benchmark data.
- `market-scan/vercel/api/_lib.js` as the shared Market Scan engine.
- `market-scan/vercel/api/store_chains.js` as the shared Store Locator engine.
- `market-scan/vercel/api/market-scan/stores.js` as the Vercel Store Locator
  mirror.
- `supabase/archive/broker_transactions.sql`, `preselling.sql`, PMS SQL, and related
  patches as normalized/shared backend capabilities.
- Supabase Storage for private document-vault files and listing photos.
- Browser fallback behavior: local/demo mode, cloud Supabase mode, local worker
  mode, and hosted Vercel mode must remain distinguishable.

## Audit Findings to Confirm

The fixture work must explicitly verify these architectural boundaries:

1. General application state is still a JSON payload and is not ideal for an
   ever-growing cash ledger, construction ledger, audit trail, or document
   index. New operational data should use normalized tables.
2. `broker_transactions` is a sales-workflow record and must not be reused as a
   general accounting ledger without a deliberate migration.
3. Pre-Selling projects, units, and payments already have relational tables and
   must remain compatible with new Portfolio and construction links.
4. The local worker has in-memory caches and local JSON persistence; cache
   semantics, error responses, stale data, and restart behavior need fixtures.
5. The Vercel Store Locator mirror has a 60-second execution limit and must use
   the same shared engine contract as the worker.
6. Private financial proofs must not use a public bucket or an unprotected URL.
7. Supabase RLS and application role checks must agree. A UI-hidden button is
   not a security boundary.
8. CORS, OPTIONS, method, status, JSON, cache, and error contracts must be
   explicit for every API route.

## Fixture Objective

Build a deterministic, network-free backend fixture suite that can verify the
design before live integration. It must run without Supabase credentials,
external scraping sites, Overpass, Nominatim, Facebook, or a real bank API.

The fixture should exercise the same logical contracts used by:

- Browser local/demo mode.
- Browser authenticated/cloud mode through mocked Supabase responses.
- Local Node worker HTTP routes.
- Vercel handler adapters.
- Storage upload, signed-download, replacement, and deletion adapters.
- Mobile UI tests calling the same API contract.

Do not replace production code with a fake-only implementation. Fixtures should
be adapters, stubs, or dependency seams around the real handlers and shared
business functions.

## Required Fixture Layers

### 1. Pure domain fixtures

Test business logic without HTTP or browser dependencies:

- Portfolio totals and asset links.
- Bank opening balance and account identity.
- Cash In and Cash Out balance math.
- Purpose-specific Cash Out validation:
  - `Project Selling` requires an approved project/deal/sales context.
  - `Construction Project` requires a construction project and optional phase.
  - `Others` requires a valid subcategory and useful description.
- Posted balance excludes drafts and pending entries.
- Reversal and adjustment preserve history.
- Duplicate linked Pre-Selling payment or construction bill cannot be posted
  twice.
- Construction planned, committed, paid, forecast, variance, and contingency
  calculations.
- Pre-Selling collection and construction cost rollups.
- Actual cash is never confused with projected revenue, portfolio value, or ROI.

### 2. HTTP contract fixtures

Exercise local worker handlers and Vercel handlers using the same cases:

- `GET /api/ping` returns a stable health payload.
- Valid Portfolio/account/ledger reads return JSON with consistent metadata.
- Create/update/list/detail operations return stable IDs and timestamps.
- Invalid amount, direction, category, date, account, or link returns 400.
- Missing authentication returns 401 where required.
- Authenticated but unauthorized role returns 403.
- Missing record returns 404.
- Unsupported method returns 405 and an allowed-method header where appropriate.
- Malformed JSON and unexpected internal errors return safe 400/500 JSON without
  stack traces or secrets.
- OPTIONS returns the documented CORS response.
- Cache headers are correct for read, refresh, private, and no-store routes.
- No endpoint trusts client-supplied owner IDs, approval IDs, or role claims.
- Pagination, date filtering, account filtering, project filtering, and stable
  sorting produce deterministic results.

### 3. Persistence and migration fixtures

Use an in-memory or temporary database adapter to verify:

- New records survive create, reload, update, and list operations.
- Existing `app_state`, `broker_transactions`, `presell_projects`,
  `presell_units`, and `presell_payments` records remain readable.
- Migration is idempotent and does not duplicate rows when run twice.
- Existing portfolio deals are not silently changed or deleted.
- Existing Pre-Selling payment statuses remain intact.
- IDs, foreign keys, timestamps, owner/workspace links, and status constraints
  are preserved.
- Failed writes roll back related records instead of creating half-linked data.
- A stale cache does not overwrite newer persisted data.
- Local/demo records do not accidentally appear in another authenticated user.

### 4. Supabase/RLS fixtures

Create SQL or policy tests for representative users:

- Super-admin can manage permitted Portfolio, cash, construction, and proof
  records.
- Broker can access only the permitted brokerage/project scope.
- Agent sees only records explicitly shared with the agent or team.
- Buyer, seller, owner, and tenant cannot read unrelated financial proofs.
- A user cannot change `owner_id`, `workspace_id`, `created_by`, `approved_by`,
  or audit ownership to bypass RLS.
- A user cannot approve or post their own record if maker/checker separation is
  required.
- Read permissions for linked records do not accidentally grant document access.
- Storage object policies match database ownership and entity links.
- Audit records are append-only to normal clients.

If a real Supabase test project is unavailable, provide a policy review fixture
and SQL inspection checklist. Never claim RLS is proven by frontend tests alone.

### 5. Storage and proof fixtures

Stub Supabase Storage and test:

- Accepted image/PDF types and configured size limit.
- Rejection of executable, double-extension, malformed, or oversized files.
- Safe filename normalization and owner/entity-scoped storage path.
- Metadata persistence: name, MIME type, size, uploader, timestamp, checksum
  when available, and storage path.
- Private bucket behavior and signed URL expiration.
- Preview only for safe file types.
- Replacement removes or supersedes the correct old object.
- Failed upload does not create a database record claiming success.
- Deleting a parent record follows the documented proof-retention policy.
- Unauthorized users cannot guess a storage path to read another user's proof.

### 6. Worker/serverless parity fixtures

For every shared feature, invoke both adapters with the same inputs and compare:

- HTTP status.
- JSON shape and field names.
- Success/error semantics.
- Auth and permission handling.
- Cache/stale metadata.
- Pagination and filters.
- Date/time and currency formatting at the API boundary.

The local worker may provide caching and fallback behavior, but it must not
return a materially different business result from the Vercel handler.

### 7. Resilience fixtures

Test:

- Upstream timeout, 429, 5xx, malformed payload, and empty response.
- Retry/backoff limits and no infinite retry loops.
- Single-flight behavior for concurrent identical requests.
- Last-known-good/stale response behavior where documented.
- Worker restart and empty local store recovery.
- Partial storage failure and retry-safe upload behavior.
- Duplicate request/replay behavior for create, post, and reversal operations.
- Request timeout and cancellation.
- Logging that omits passwords, access tokens, signed URLs, and proof contents.

## Mobile Access Requirements

Mobile access means the feature must be usable from a mobile browser, not that
the backend should make business decisions based on screen size.

- Keep API responses device-independent and JSON-based.
- Do not require hover, right-click, wide tables, or desktop-only controls.
- Test the primary flows at 320x568, 375x667, 390x844, 414x896, and 768x1024.
- Test both portrait and landscape where tables or construction timelines exist.
- Use responsive cards, stacked fields, horizontal scrolling only inside a
  deliberately bounded table, and accessible upload controls.
- Verify touch targets, keyboard focus, status announcements, validation errors,
  modal/drawer scrolling, and no page-level horizontal overflow.
- Verify slow mobile network behavior: loading, retry, cancellation, and saved
  draft states.
- Test image proof capture from a mobile camera/file picker where supported.
- Do not expose sensitive proof data in browser logs, query strings, or markup.

## Bootstrap-Ready Recommendation

Make the UI Bootstrap-ready without forcing an immediate rewrite:

- Use semantic HTML and stable component hooks such as
  `data-module="portfolio"`, `data-form="cash-entry"`, and
  `data-testid="cash-balance"`.
- Prefer Bootstrap-compatible class concepts (`container`, `row`, `col-*`,
  `d-flex`, `gap-*`, `btn`, `table-responsive`, `alert`, `modal`, `offcanvas`)
  only where they do not conflict with the existing design system.
- Keep custom business classes namespaced, for example `.es-portfolio-*`,
  `.es-cash-*`, and `.es-construction-*`.
- Do not mix Bootstrap resets, modal behavior, or CSS variables into the project
  accidentally. Choose one source of truth for spacing, colors, buttons, and
  modal behavior during the transition.
- If Bootstrap is added, pin the version, load it intentionally, document the
  load order, and test desktop/mobile layouts after the reset.
- Keep components functional without Bootstrap JavaScript where possible, so
  the app remains usable if the CDN is unavailable.
- Use CSS grid/flex fallbacks and avoid Bootstrap-only assumptions in backend or
  fixture code.
- Add a small compatibility layer rather than converting unrelated existing
  screens in the same change.

Recommended order: stabilize the backend/API fixture first, add semantic and
responsive hooks to Portfolio, then introduce Bootstrap-compatible layout
classes incrementally.

## Suggested Backend Improvements

- Use normalized tables for cash accounts, ledger entries, construction
  projects/phases, links, proofs, and audit events.
- Treat posted financial records as append-only with reversal/adjustment records.
- Add idempotency keys for posting, payment linking, uploads, and reversals.
- Add optimistic concurrency using `updated_at` or a version number.
- Add server-side pagination and filtering before large datasets reach mobile.
- Add request correlation IDs and structured error codes.
- Keep currency values numeric in storage and format only at the UI boundary.
- Keep actual, committed, forecast, and projected values as separate fields.
- Add reconciliation status against a bank statement.
- Add background processing for large files or slow upstream scans.
- Add contract/version metadata so local worker and Vercel drift is detectable.

## Test-First Procedure

Before editing:

1. Run the existing fixture and relevant e2e tests.
2. Probe `/api/ping` and the primary worker endpoints.
3. Record current local/demo, worker, and Vercel response shapes.
4. Record the current mobile viewport behavior.
5. Identify unrelated failures separately; do not hide them in new fixtures.

Then implement the smallest testable seam and add fixtures before broad UI work.
Run pure fixtures first, then handler parity, then storage/RLS review, then
desktop and mobile e2e tests, and finally the full regression suite.

## Required Deliverables

- Current backend architecture audit.
- Data-flow diagram from browser to worker/Vercel/Supabase/storage.
- API contract table with methods, auth, status codes, payloads, and caching.
- Deterministic pure-domain fixture suite.
- Worker/Vercel parity fixture suite.
- Persistence, migration, storage, and permission test plan.
- Mobile viewport e2e coverage.
- Bootstrap-readiness decision and compatibility notes.
- Full test output with known limitations.

Do not claim the backend is production-ready based only on a successful browser
screen. The fixture must prove calculations, persistence, permissions, storage,
parity, resilience, and mobile usability.
