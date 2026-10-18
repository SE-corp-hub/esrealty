# ES Realty Portfolio Feature Upgrade Prompt

## Role

Act as a senior product engineer, accounting-systems designer, Supabase/Postgres
engineer, and responsive UI engineer. Upgrade the ES Realty Portfolio without
breaking investment analysis, Transactions, Financing, Pre-Selling, Property
Management, Reports, authentication, or local/demo mode.

## Current State

The application is a no-build static SPA served at `http://localhost:8931/`, with
the market-scan worker at `http://localhost:8932/`.

Existing Portfolio work includes:

- `js/app.js` has `state.deals`, `portfolioStats()`, and a Portfolio view.
- Portfolio tabs exist: Overview, Assets, Cash Ledger, Construction, and Proofs.
- `js/portfolio_ledger.js` contains pure balance, posting, validation, reversal,
  construction summary, preselling rollup, and reconciliation rules.
- Local/demo state has `portfolioAccounts`, `cashEntries`,
  `constructionProjects`, `constructionPhases`, and `portfolioTab`.
- `supabase/archive/portfolio_a_investor.sql` defines Portfolio accounts, cash entries,
  construction projects, and construction phases with RLS and indexes.
- Construction project and phase modals exist and are responsive.
- Cash Ledger has modal entry/account forms, direction-aware purpose fields,
  dependent links, filters, running balances, reversal, and CSV export.
- Existing `presellProjects`, `presellUnits`, `presellPayments`, `transactions`,
  `docVault`, and `app_state` already exist and must be reused.

Last verified focused tests:

- `portfolio_investor_e2e`: 10/10 pass.
- `portfolio_construction_e2e`: 10/10 pass at desktop and mobile.
- `portfolio_ledger_ui_e2e`: 16/16 pass at desktop and mobile.
- Full suite: 30/31 pass; the remaining failure is the pre-existing strict
  `ui_readability_mobile_e2e` audit.

## Current Gaps To Fix

1. Portfolio data is mainly local/demo state. Cloud loading and saving for new
   Portfolio tables is not fully wired.
2. Cash Entry, Account, and Phase workflows need complete edit, delete/void,
   reversal, proof, loading, error, and empty states.
3. Posted entries must never be silently edited or deleted. Use reversal or an
   auditable adjustment. Draft entries may be edited.
4. Cash Entry supports only a partial link model. Links need valid selectable
   assets, construction projects, pre-selling projects, units/payments, and
   transactions without accepting stale or invalid IDs.
5. Construction lacks phase edit/delete, vendors, invoices, retention,
   change orders, approval history, forecast final cost, and allocation methods.
6. Proofs are displayed conceptually but image upload, validation, metadata,
   secure storage, preview, replacement, and removal are incomplete.
7. Existing transactions and pre-selling payments are not fully migrated or
   linked into the cash ledger without double counting.
8. Portfolio KPIs do not consistently distinguish actual cash, committed cost,
   projected revenue, receivables, payables, debt, and profit.
9. Filters, date ranges, account filters, status filters, and export need one
   shared query/state model and must work without losing focus or scroll position.
10. The Portfolio needs clear permission-denied and admin-only states. Do not
    assume a role named `admin` is identical to `super-admin` without documenting
    the mapping.

## Product Scope

Implement Scenario A: Investor Portfolio for ES Realty.

Business decisions already confirmed:

- Cash owner: ES Realty.
- First account type: Cash on Hand.
- Add, approve, post, and reverse permissions: admin/super-admin only.
- Cash is real on save and posted entries affect balances immediately.
- Cash Out requires one purpose: Project Selling, Construction Project, or Others.
- Project Selling link is optional.
- Construction flow: project, phase, vendor, invoice.
- Others subcategory is optional for the first UI, but an Others outflow must
  have a useful description.
- Construction granularity supports property, project, tower, unit type, and unit.
- Cost allocation supports equal, floor area, actual, and manual methods.
- Mandatory construction stages and cost categories are required.
- Accounting periods, tax/VAT, retention, and related fields are required.
- Transfers are represented as one user-facing transfer record with linked sides
  internally if two account balances must change.
- Proof files are images first.
- Existing transactions and pre-selling payments must be migrated or linked.
- The main dashboard must show cash, overrun, collections, profit, debt, and
  upcoming obligations without mixing projected and actual amounts.

## Required Portfolio Areas

### Overview

Show separate cards and explanations for:

- Portfolio market/projected value.
- Acquisition cost and invested capital.
- Posted cash balance by account.
- Receivables and payables.
- Committed and forecast construction cost.
- Debt and equity/net worth.
- Actual cash in, actual cash out, and net cash movement.
- Projected revenue and projected profit, clearly marked as projected.
- Upcoming due items and overdue items.

Add filters for account, asset, project, lifecycle status, date range, and
currency. Each number must say Actual, Posted, Committed, Projected, Estimated,
or Forecast.

### Assets

Link to existing `state.deals`/saved deals without duplicating them. Show:

- Lifecycle: planned, acquired, under construction, operational, listed, sold,
  archived.
- Ownership share and investment basis.
- Acquisition cost, paid cost, debt, posted cash movement, projected value,
  realized profit, and linked construction/preselling records.
- Clickable links to the source deal, ledger entries, documents, project, and
  transaction.

### Cash Ledger

Support:

- Account setup with explicit opening balance and as-of date.
- Cash In and Cash Out with positive amounts and explicit direction.
- Date, account, category, purpose, subcategory, description, counterparty,
  reference number, links, proof status, creator, status, and audit history.
- Draft, pending, posted, voided, and reversed states.
- Posted-only balance calculations.
- Running balance per account and a balance preview before saving.
- Overdraft warning and explicit authorized override if introduced.
- Reversal instead of silent modification of posted records.
- Search, account/direction/status/date filters, reset filters, pagination or
  virtualization for large datasets, and CSV export.
- Responsive desktop table and mobile card/table view with no page-level
  horizontal overflow.

### Construction

Support:

- Project create/edit/archive/delete policy.
- Phase create/edit/archive/delete policy.
- Vendor/contractor and invoice records.
- Planned, approved, committed, paid, forecast, retention, contingency, and
  variance values.
- Change orders separately from the original contract with approver and date.
- Progress percentage and earned-progress versus paid-progress warning.
- Allocation method: equal, floor area, actual, or manual.
- Optional link to one pre-selling project, tower, unit type, or unit.
- Construction cash outflow that creates or links one ledger entry, never two
  balance-affecting entries for the same payment.

### Proofs

Use private Supabase Storage patterns where authenticated cloud mode is active.
For local/demo mode use a clearly marked local adapter. Validate image MIME type,
extension, and byte size. Store filename, MIME type, byte size, checksum if
available, uploader, timestamp, storage path, and proof category. Never expose
private financial proofs through public URLs.

## Data and Security

Prefer normalized tables over an ever-growing `app_state` payload. Migration SQL
must be idempotent even when tables, columns, constraints, policies, indexes, or
triggers already exist. `CREATE TABLE IF NOT EXISTS` alone is insufficient for
existing tables; use guarded `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and
duplicate-object handling for named constraints.

Use owner/workspace foreign keys, non-negative numeric checks, explicit enum
checks, created/updated timestamps, created-by/approved-by fields, indexes, RLS,
and audit events for posting, voiding, reversing, uploads, replacements, and
deletions. Do not put service-role keys in browser code.

## UX Rules

- Replace browser `prompt()` for business records with responsive modal forms.
- Use clear labels, helper text, inline validation, focus management, Escape,
  click-outside close, loading state, and error state.
- Default the first available account only when safe and visibly show the choice.
- Make dependent fields disabled until their parent selection is made.
- Use readable 16px form text, minimum 44px actions, and full-width mobile fields.
- Preserve entered values after validation errors.
- Use a confirmation dialog for void, reverse, archive, delete, and unlink.
- Show source and status for every financial amount.

## Required Tests

Add deterministic tests for:

- Empty and populated overview.
- Account creation and opening balance.
- Cash In, Cash Out, purpose validation, Others description, and balance math.
- Transfer record and linked account-side balances.
- Draft, pending, posted, voided, reversed, permissions, and idempotency.
- Posted-entry reversal and prevention of silent edits.
- Search/filter/date reset/export.
- Construction project and phase CRUD, variance, contingency, retention,
  change order, allocation, and progress warnings.
- Pre-selling project/unit/payment linkage without double counting.
- Proof image validation and secure metadata behavior.
- Migration/backfill from existing transactions and pre-selling payments.
- Roles and permission-denied UI.
- Desktop and mobile rendering at 320, 375, 390, 414, 768, 1024, 1400, and
  1920 widths with no page-level horizontal overflow.

Run the full suite before and after implementation. Do not claim completion until
all core Portfolio tests pass and any remaining accessibility failure is listed
with exact scope and reason.
