# SEA ESTATES — Real Estate Investment Intelligence (Philippines)

Current visible identity: **SEA ESTATES**, monogram **S.E**. The public site retains its
original warm palette and the full Batangas Value Guide calculator on Home. See
[`docs/sea-estates-redesign-tracker.md`](docs/sea-estates-redesign-tracker.md) for the
approved scope and verification record, and
[`docs/sea-reference-indexing/README.md`](docs/sea-reference-indexing/README.md) for the
current calculation handoff.

Legacy `ESREALTY_*`, storage/API identifiers and existing contact domains remain
compatible; they are not new-brand naming instructions.

A client-side single-page application for Philippine real estate investment analysis and
brokerage operations: feasibility, financing, risk, scenario modelling, appraisal, portfolio
management, CRM, transactions, a BIR-referenced Batangas value guide, and a public
storefront with property listings and two-property comparison.

## Features

### Public storefront

- **Property listings** — map and list modes, live filters for location, budget, property
  type and sale/rent, mobile-first with native *More filters* disclosure.
- **Two-property comparison** — pick exactly two listings, compare them on a dedicated
  route, and the comparison survives a refresh back into your filtered search.
- **Batangas Value Guide** — a four-step calculator that matches a property to its BIR
  zonal reference, then shows a SEA ESTATES planning estimate *separately* from that
  reference. Never blend the two: one is a tax reference, the other is a planning guide.
  - Buying, Selling, "I received an offer", Estate and Loan purposes.
  - Optional land time-indexing scenario, always shown as an explicit assumption and never
    stacked with the factor guide or a corner multiplier.
  - Government schedule provenance with an honest verification status — see
    [`docs/batangas-value-guide-sources.md`](docs/batangas-value-guide-sources.md).
- Asking-price evidence is reported separately and labelled context, not a certified
  appraisal. Achieved-sale accuracy requires verified completed sales, which this project
  does not yet have.

### Back office

- **Investment Wizard** — guided steps through property, location, purchase and financing,
  development, sales and rental, comparables, then the analysis.
- **Deal Analysis** — overview, returns (IRR, ROI, cash flows), development budget,
  financing amortisation, scenarios, location scoring and risk flags.
- **Appraisal Suite** — comparables with suggested adjustments, sales/cost/income
  approaches, reconciliation, SVG charts, print-ready PDF, Excel exports and a
  certification workflow with an audit trail.
- **Value Guide (internal)** — the same BIR-referenced estimate as a four-stage wizard,
  with an integrity check and a PDF download.
- **Portfolio** — ledger, investor and construction tracking, proofs and permissions.
- **CRM / Leads** — pipeline, calendar, buyer qualification, PH lead sources, follow-up
  badges, duplicate warnings, CSV export and a printable call sheet.
- **Market Scan** — live listings from DotProperty/MyProperty with a web-search fallback,
  per-source health chips and observed median benchmarks.
- **Store Locator** — geocoded branch records for convenience and grocery chains with an
  honest per-chain coverage status.
- **Market Price Index** — a nightly GitHub Action snapshots median ₱/sqm per city into
  `data/market-index.json`; the City Price Index card charts the trend.

## Tech

- Plain HTML/CSS/JS (ES2017+). No front-end framework.
- Project CSS in `css/`; `reboot-shim.css` carries the base typography rules the
  design was built on (Bootstrap was removed from the eager payload).
- One build step, and it is enforced. `js/app.js` is the source; `index.html` loads the
  committed bundle `js/app.min.js`. `node build_app.js` regenerates it and
  `node build_app.js --check` fails when the two disagree, so a stale bundle cannot ship.
  `tests/build_sync_node.js` is the merge gate for this.
- [Supabase JS v2](https://supabase.com/docs/reference/javascript), [Leaflet 1.9.4](https://leafletjs.com/)
  and [pdf-lib](https://pdf-lib.js.org/) are all vendored under `vendor/`. There is no
  JavaScript CDN dependency.
- Google Fonts (Inter) loads from a CDN and falls back to system fonts.
- Live map tiles (CARTO), geocoding (OpenStreetMap Nominatim) and the OSM embed need an
  internet connection. Everything else works offline once cached.

## File structure

```
.
├── index.html              # App shell — loads the bundle, not app.js
├── sw.js                   # Service worker (shell + stale-while-revalidate assets)
├── robots.txt              # Crawl rules + sitemap pointer
├── manifest.webmanifest    # PWA manifest
├── _headers                # Response headers + CSP (Cloudflare Pages / Netlify only)
├── .nojekyll               # Serve paths as-is on GitHub Pages
├── google25a49039450dd2e9.html  # Google Search Console domain verification
├── build_app.js            # app.js -> app.min.js, with hash stamps
├── serve.js                # Local static server used by the test suite
├── assets/
│   ├── favicon.svg
│   └── listings/
├── css/
│   ├── styles.css          # Admin app styles
│   ├── styles.reduced.css  # (removed — see docs/sea-estates-baseline)
│   ├── storefront.css      # Public storefront
│   ├── storefront-legacy.css
│   ├── estimator.css       # Value Guide
│   └── reboot-shim.css     # Base typography (formerly supplied by Bootstrap)
├── js/
│   ├── app.js              # Admin app source: views, bindings, role access
│   ├── app.min.js          # Committed build of app.js (generated — do not edit)
│   ├── core.js             # Financial and valuation engine
│   ├── data.js             # PH geography, cost and amenity constants
│   ├── estimator.js        # Public Value Guide calculator
│   ├── storefront.js       # Public storefront pages, map, listings, comparison
│   ├── value_guide_finance.js    # Shared buyer/seller/developer cost arithmetic
│   ├── value_guide_tax.js        # CGT, DST, estate and transfer reference math
│   ├── value_guide_reference.js  # BIR schedule provenance + optional land indexing
│   ├── value_guide_evidence.js   # Asking-price evidence normalisation
│   ├── value_guide_pdf.js        # Internal Value Guide PDF renderer
│   ├── portfolio_ledger.js       # Ledger, construction, proofs
│   ├── portfolio_cloud.js
│   ├── playbook_seed.js
│   ├── agent_next.js  attribution.js  compliance_due.js
│   ├── listings-api.js  supabase-config.js  util.js
├── data/                   # BIR zonal import, config, register, evidence, market index
├── supabase/
│   ├── *.sql               # Migrations, patches and seeds (see Supabase Setup)
│   └── functions/          # Edge functions (see Cloud runbook)
├── market-scan/            # Market Scan engine + Vercel serverless API
├── tests/                  # CDP browser suites + Node suites
├── tools/                  # Review, capture and data-generation scripts
├── docs/                   # Design/verification evidence and specifications
└── vendor/                 # leaflet/ pdf-lib/ supabase/
```

## Run locally

`start_esrealty.cmd` (Windows) starts the static server on `:8931` and the Market Scan
worker on `:8932`. Any static server works for browsing:

```bash
npx serve .          # or: python -m http.server 8080
```

Then open `http://localhost:8080`. Opening `index.html` via `file://` works for most
features.

## Deploy

It is a static site, but it is **not** zero-configuration:

1. **Build** — run `npm install -D terser && node build_app.js` so `js/app.min.js`
   matches `js/app.js`. CI fails on a mismatch.
2. **Environment** — `.env.local` is git-ignored. The deployed build needs
   `AGENT_EDGE_URL` and `AGENT_EDGE_TOKEN` set as environment variables on the host
   (see `DEPLOY_GUIDE.md`), plus the publishable Supabase key in
   `js/supabase-config.js`.
3. **Host** — currently **GitHub Pages**, which is why `.nojekyll` is present.

> **Host migration is pending.** GitHub Pages' cached-egress quota is exhausted (the grace
> period ends **2026-10-04**, after which requests return `402`). `_headers` carries a
> content-security policy that GitHub Pages ignores, so the production site currently
> serves no security headers at all. The plan is Cloudflare Pages or Netlify, both of
> which honour `_headers` as-is. See
> [`docs/hosting/migration-github-pages-to-cdn.md`](docs/hosting/migration-github-pages-to-cdn.md).

Note the split: the Vercel project `esrealty-market-scan` is the Market Scan
micro-backend, **not** the static site.

## Supabase Setup

The browser client is configured in `js/supabase-config.js` using a publishable key only.
Before enabling server-backed auth and persistence, run `supabase/schema.sql` in
**Supabase Dashboard → SQL Editor**. It creates user profiles, owner-scoped state, audit
events, a private document bucket and row-level security policies.

Never put an `sb_secret_...` or service-role key in this project. Promote administrators
only through the SQL Editor, using the commented command at the bottom of
`supabase/schema.sql`.

Run `supabase/patch_registration_approval.sql` after the initial schema to enable
registration approval. New accounts are created as `pending`; an approved `super-admin`
can open **Users & Access**, assign a role, and approve or reject each registration.

Core scripts, in order: `schema.sql`, `patch_registration_approval.sql`, `crm_leads.sql`,
`shared_listings.sql`, `sales_playbooks.sql`, `seed_playbooks.sql`, `notifications.sql`,
`preselling.sql`, `team_performance.sql`, `cobroking.sql`, `pms_normalized.sql`,
`patch_presell_buyer_link.sql`, `patch_presell_financing.sql`, `security_hardening.sql`.
For the public listings REST API continue with `listing_platform_schema.sql` and
`listing_api.sql`, then deploy the `listing-api` Edge Function using its README. The Value
Guide additionally needs `compliance_registry.sql` and `ad_posts.sql`. Existing projects
must run these patches in the SQL Editor; updating the static files alone does not change
deployed database policies.

### SEO and PWA

**Search visibility** — deploy the meta/JSON-LD endpoint once:

```
supabase functions deploy seo
supabase secrets set SITE_URL=https://tradersgag6.github.io/esrealty
```

- Crawlable listing pages: `https://<ref>.supabase.co/functions/v1/seo/property/<id>`
  (full OG tags plus RealEstateListing JSON-LD, then redirect into the app).
- Sitemap for Search Console: `/functions/v1/seo/sitemap.xml`, also linked from
  `robots.txt`.

**Installable app (PWA)** — ships automatically: the manifest and service worker are
wired. Visitors get Add-to-Home-Screen; agents get offline map tiles and fonts after
first use.

### Facebook Lead Ads → CRM

Lead forms on Facebook can flow straight into the CRM:

1. Deploy the webhook function and set secrets:

   ```
   supabase functions deploy fb-leads
   supabase secrets set META_VERIFY_TOKEN=<random-string> \
     META_PAGE_TOKEN=<page-access-token> \
     META_APP_SECRET=<app-secret> \
     FB_LEADS_DEFAULT_BROKER_EMAIL=<broker-to-assign>
   ```

2. In Meta Events Manager → Webhooks, subscribe to the **leadgen** field with callback URL
   `https://<project-ref>.supabase.co/functions/v1/fb-leads` and the same verify token.
3. Leads arrive deduplicated (`fb-<leadgen_id>`), tagged source **facebook**,
   auto-assigned, and trigger a bell notification for the assigned broker.

### Email / SMS dispatch

Bell notifications can also go out by email (Resend) and SMS (Semaphore, PH):

1. Deploy and set keys:

   ```
   supabase functions deploy notify-dispatch
   supabase secrets set RESEND_API_KEY=<key> MAIL_FROM="SEA Estates <you@yourdomain.com>" \
     SEMAPHORE_API_KEY=<key> NOTIFY_DISPATCH_SECRET=<random-string>
   ```

2. Run `supabase/notify_dispatch.sql` (adds dispatch-tracking columns; contains a
   commented `pg_cron` block that auto-calls the function every 5 minutes).
3. Behaviour: emails go to every user with an address; SMS only for **approval** and
   assignment events.

Local demo mode stores test state in browser storage. Authenticated production modules use
Supabase with row-level security. Never use demo accounts or browser storage for production
credentials.

**Map view and geocoding:** the storefront Properties page has a **Map** mode (price pins,
popups). In the back office, Brokerage → Inventory → **Auto-locate** batch-geocodes
listings missing coordinates via OpenstreetMap Nominatim (max 8 per click, 1.1 s between
requests).

## Appraisal and tax basis

- Appraisal is **PVS/BSP-aligned**: TRAIN tax pack, collateral and forced value, LTV,
  adjustment elements, a 2026 RCN table with soft costs and entrepreneurial incentive,
  EA/EL depreciation, GRM and DCF income approaches, an approach-applicability matrix,
  comp QC (verification, distance, duplicates) and a RESA-format report.
- Tax math is a **planning illustration**, not a determination. CGT is applied to a
  qualifying capital-asset resale on the governing base; there is no blanket 6% CGT on
  developer or unclassified transactions, and a written quotation is required instead.
- The BIR zonal reference is always displayed separately from the planning estimate, and
  an imported schedule never asserts that it is the latest legally applicable one.

## Tests

Two suites. The Node suites are the merge gate; the browser suites drive headless Chrome
over the local server on `:8931`.

```powershell
node tests/build_sync_node.js       # bundle stamp, window seams, ratio
node tests/estimator_math_node.js   # calculation core
node tests/estimator_core_node.js   # estimator integration
node tests/value_guide_time_node.js # reference status + optional indexing arithmetic

powershell -File tests\run_all.ps1                 # every suite, desktop
powershell -File tests\run_all.ps1 -Mobile         # mobile viewport pass
powershell -File tests\run_all.ps1 -Test value_guide_simplify_e2e
```

`tests/run_all.ps1` discovers `*_node.js` and `*_e2e.js` automatically, so a new suite is
picked up locally with no registration. The browser suites named individually in
`.github/workflows/tests.yml` are **not** globbed — see that file for which ones run in CI
and why.

The Market Scan suites (`stores_*`, `market_scan_*`) also need the worker on `:8932`;
`start_esrealty.cmd` starts both.

## Cloud runbook

1. **SQL migrations** — run the files in `supabase/` in the order given under
   [Supabase Setup](#supabase-setup), inside the Supabase SQL Editor.
2. **Edge functions** — deploy `listing-api`, `seo`, `nearby-scan`, `notify-dispatch`,
   `location-report`, `fb-leads`, `agent-dispatch`, `admin-create-account` and
   `admin-delete-account` (sources under `supabase/functions/`). Secrets include
   `RESEND_API_KEY`, optional `MAIL_FROM`, `SEMAPHORE_API_KEY` and
   `NOTIFY_DISPATCH_SECRET`.
   - `notify-dispatch` supports a **self-send mode**: POST `{to, subject, html}` with a
     user JWT emails that same account. The Resend sandbox only allows your signup address
     until a domain is verified.
3. **Market Price Index** — `.github/workflows/market-index.yml` runs daily at 02:30 PHT
   and commits `data/market-index.json`. Local one-off: `node market-scan/build-index.js`.
   - **Required repo variable:** the workflow reads `vars.MS_API_URL` and **fails on purpose
     when it is unset**, rather than silently skipping the snapshot. Set it once under
     *Settings → Secrets and variables → Actions → Variables* as `MS_API_URL`, pointing at
     the deployed `market-scan` endpoint. It is a plain Actions variable, not a secret,
     because the index endpoint is public. Without it every scheduled run fails at the
     first step.

## Documentation map

| Path | What it holds |
| --- | --- |
| [`docs/sea-reference-indexing/README.md`](docs/sea-reference-indexing/README.md) | Current calculation handoff: BIR reference register, optional land indexing, the About-panel simplification |
| [`docs/sea-estates-redesign-tracker.md`](docs/sea-estates-redesign-tracker.md) | Approved design scope and the full verification record |
| [`docs/batangas-value-guide-sources.md`](docs/batangas-value-guide-sources.md) | Source and currency rules for the BIR schedules. **Read before changing any tax input.** |
| [`docs/specs/`](docs/specs) | Executed feature build specs |
| [`docs/audits/`](docs/audits) | Baseline audits and analysis reports |
| [`docs/hosting/`](docs/hosting) | Host migration plan |
| [`docs/sea-*/`](docs) | Per-batch verification evidence (screenshots and logs are git-ignored and regenerate via `tools/`) |
| [`DEPLOY_GUIDE.md`](DEPLOY_GUIDE.md) | Supabase and Market Scan deployment runbook, with dated gotchas |

## License

Private project. All rights reserved.