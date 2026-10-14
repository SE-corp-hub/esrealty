# Value Guide accuracy plan (house & lot first)

Date: 2026-10-14
Status: steps 1, 2, 3 and 6 implemented 2026-10-14 (calculationVersion 2026.10.6).
Steps 4, 5 and 7 are still open.

Result on the listing fixture after the change (tests/value_guide_market_accuracy_node.js):
house & lot median error -2.5%, median absolute error 10.5% (was +18% / 28%);
vacant lots median error -2.3% (unchanged model, n=9). The back-office guide now
matches the public calculator's land and building exactly, plus its own question
net on the land.

## 1. What was tested

Three sources for the same kinds of property, compared like for like.

- **Our calculator.** Both surfaces, run headless through the exact production code
  (`js/estimator.js` = public Value Guide, `js/value_guide_flow.js` = back-office
  guide): `/tmp` harness, inputs below.
- **LandValuePH.** The free `/check` flow run on 2026-10-14 for Binay St, Poblacion
  III, Bauan; the two purchased reports; and their public bundles (see
  `docs/reference/landvalueph-reverse-engineering.md`, 2026-10-14 update).
- **The market.** 117 Batangas listings collected 2026-10-14 (65 house & lot, 52 lots;
  100 usable after removing resorts, estates, duplicates and stale lists). Mostly
  DotProperty; Lamudi/MyProperty/Carousell could not be fetched. These are
  **asking prices**: resale deals usually close 5–10% lower.

## 2. How LandValuePH gets its values

1. BIR zonal rate for the street and classification, x lot area.
2. Land = BIR base x a regional multiplier (Rural 1.5–2.5; city-median blend only
   where they hold 10+ listings; there is no Bauan row). Their vacant-lot report used
   **2.5x**; their house & lot report used **1.174x** for the same lot.
3. Building (house & lot) = **16,000/sqm** ("PSA 2025") x floor area x (1 - age/40).
4. Small factor nudges (+0.5% municipal road, +1% subdivision, -1% limited amenities).
5. Range = total x 85% (walk-away) and x 130% (aspirational "list at" price).
6. Negotiation tiers: quick sale 85%, market 100%, premium 110%, plus net proceeds
   after CGT 6%, DST 1.5%, transfer tax 0.5–0.75% and registration.

Their numbers are not internally consistent (see the reference doc), and the `/check`
result is now computed server-side, so its current formula cannot be confirmed.
**Your PDFs are 9–13 days old; the method they show still matches what the public
code ships, but neither is fit to calibrate against.**

## 3. Results

### House & lot, 11 listings with lot, floor area and price (PHP millions)

| Listing | Lot / floor sqm | Asking | Public guide (today) | Back-office guide (today) | LandValuePH house formula | Proposed (16k building) |
|---|---|---|---|---|---|---|
| Bauan Mangoville (bank) | 146 / 219.5 | 4.00 | 5.60 (+40%) | 3.30 (-18%) | 3.31 (-17%) | 4.36 (+9%) |
| Bauan Grand Villas (new) | 100 / 80 | 2.54 | 2.84 (+12%) | 1.66 (-34%) | 1.67 (-34%) | 2.16 (-15%) |
| San Pascual Cristina Homes | 200 / 167.78 | 3.82 | 5.19 (+36%) | 2.96 (-23%) | 2.97 (-22%) | 4.24 (+11%) |
| San Pascual Sambat (bank) | 92 / 84 | 1.86 | 2.20 (+18%) | 1.27 (-32%) | 1.27 (-32%) | 1.72 (-7%) |
| San Pascual Villa Tereza (bank) | 263 / 419.56 | 5.93 | 9.08 (+53%) | 5.42 (-9%) | 5.43 (-8%) | 6.72 (+13%) |
| San Pascual San Antonio (renovated) | 360 / 450 | 12.80 | 14.70 (+15%) | 8.69 (-32%) | 8.72 (-32%) | 11.46 (-10%) |
| Btg City Kumintang Ilaya (bank) | 300 / 56 | 2.10 | 5.27 (+151%) | 2.78 (+32%) | 2.80 (+33%) | 5.08 (+142%) |
| Btg City Sta Rita Karsada | 281.5 / 159.8 | 4.98 | 6.40 (+28%) | 3.56 (-29%) | 3.58 (-28%) | 5.50 (+10%) |
| Btg City Nueva Villa (furnished) | 246 / 400 | 18.00 | 12.36 (-31%) | 7.41 (-59%) | 7.43 (-59%) | 9.48 (-47%) |
| Btg City Sterling Heights | 107 / 85.7 | 2.40 | 2.82 (+18%) | 1.60 (-33%) | 1.61 (-33%) | 2.34 (-3%) |
| Taal Villas del Pueblo (bank) | 72 / 85 | 2.68 | 3.04 (+13%) | 1.80 (-33%) | 1.81 (-33%) | 2.43 (-9%) |
| **Median error vs asking** | | | **+18%** | **-32%** | **-32%** | **-3%** |
| **Median absolute error** | | | **28%** | **32%** | **32%** | **10%** |

Assumptions: residential (RR) class, mixed/CHB, age band guessed from the listing
(not stated in most), street-level BIR rate where the subdivision is listed, else the
barangay "all other streets" rate. Kumintang Ilaya (300 sqm lot, 56 sqm old house,
bank as-is) and Nueva Villa (furnished, luxury) are outliers no formula fits.

The reference subject (100 sqm lot, 120 sqm 2-storey CHB, 6–10 years, Binay St):
public guide PHP 4.75M, back-office guide 2.87M, LandValuePH 2.89M, proposed
**3.89M**. The market cross-check — Bauan non-developer houses ask a median
~31,400 per floor sqm (thin, n=3), i.e. ~3.8M for 120 sqm — sits next to the
proposed figure, not next to either current one.

### Vacant lots, 13 listings

| | Median error vs asking | Median absolute error |
|---|---|---|
| Public guide (ramped band, today) | +9% | 35% |
| Back-office guide (1.174x) | -48% | 48% |
| LandValuePH 2.5x | +12% | 46% |

The market's asking / BIR multiple has a median of **2.24x** (range 1.2x–4.0x) —
right where the public guide's ramp sits. The misses are structural: large lots
(San Roque 1,120 sqm: +84%) and bank-sale subdivision lots are overvalued; branded
developments (Avida, Portville) are undervalued.

## 4. What makes a value calculator accurate — checklist

1. **Correct BIR rate**: street + classification + barangay, newest DO. ✅ have it.
2. **Help users choose the classification** that is on their tax declaration (show
   both RR and CR rates for the street). ❌ missing.
3. **Land multiplier calibrated to local market evidence**, not to a competitor's
   report. ⚠️ public guide OK on median; back-office guide wrong.
4. **Lot-size adjustment**: price per sqm falls as lots get bigger. ❌ missing.
5. **Building cost at a realistic replacement rate** for ordinary existing homes.
   ❌ public guide uses 25,000/sqm; evidence supports ~16,000.
6. **Depreciation from age and condition**. ⚠️ age yes; condition is collected and
   ignored.
7. **One engine for every surface** (public and back office must agree). ❌ they
   differ by 65% on the same inputs.
8. **Sale-type context**: bank-acquired/as-is and new developer units price
   differently from resales. ❌ not modelled.
9. **Asking vs sale gap stated honestly**, with a realistic asking-price suggestion.
   ❌ "recommended asking price" is estimate x 1.30.
10. **A standing accuracy test** against a dated set of local listings, re-run on
    every change. ❌ only the single competitor report is pinned.
11. **Transparency**: show the BIR base, land, building and every adjustment. ✅ have it.
12. **Free and clear about limits** (not an appraisal). ✅ have it.

## 5. The plan

Order is by impact on the house & lot result. Each step ships with a test.

### Step 1 — Fix the building rate (biggest single error)

- `data/zonal-config.json` construction table: mixed/CHB 25,000 -> **16,000**,
  wood/prefab 16,000 -> **11,000**, RC/steel 32,000 -> **22,000** (keep the ratio;
  cite PSA building-permit cost ~12,200/sqm Jan 2025 as the floor and 16,000 as the
  ordinary-house valuation RCN).
- Expected effect: house & lot median error +18% -> about -3%; absolute error 28% ->
  about 10% on the listing set.
- Test: new `tests/value_guide_market_accuracy_node.js` (Step 6) asserts the median
  error sits within ±10% and the median absolute error under 15%.

### Step 2 — Use the building condition the form already asks for

- New finish / good / unknown / repairs needed -> effective-age shift of -5 / 0 / 0 /
  +10 years before depreciation (same idea LandValuePH's legacy engine uses).
- Test: same inputs, "repairs needed" < "unknown" < "new" for the building line only.

### Step 3 — One engine for both surfaces

- Retire the back-office `MARKET_IND = 1.174`; make `value_guide_flow.js` call the
  same land and building functions as `estimator.js`.
- Replace the tripwires in `tests/value_guide_reference_benchmark_node.js` that pin
  the guide to the report (<2%) and the storefront to "more than 50% above" — they
  pin today's disagreement in place. Keep the report as a printed comparison only.
- Test: both surfaces return the same total for the same inputs.

### Step 4 — Lot-size adjustment (land, both property types)

- Reference size 150 sqm; above it, land rate x (150 / area)^0.15, floor at 0.70.
  Example: 300 sqm x0.90, 1,000 sqm x0.75.
- Test: San Roque 1,120 sqm moves from +84% toward the band; small lots unchanged.

### Step 5 — Realistic pricing tiers (replaces "list at +30%")

- Suggested asking price = estimate x 1.07; buyer sweet spot = estimate x 0.97–1.03;
  negotiation floor = estimate x 0.92; keep the 85–130% band as the *uncertainty*
  range, labelled as such.
- Show net proceeds at each tier (the tax module already computes them).
- This is the feature LandValuePH sells for PHP 1,299 — shipped free.

### Step 6 — Standing market accuracy test

- Commit the cleaned listing set as `tests/fixtures/batangas-listings-2026-10.json`
  (asking prices, source, date, sale type), with a "refresh by" date 6 months out.
- `tests/value_guide_market_accuracy_node.js` prints per-listing error and asserts
  the medians from Step 1. Run in CI with the other node tests.

### Step 7 — Classification help and sale type (form changes)

- When a street is picked, show both rates: "Binay St: Residential 11,500 /
  Commercial 19,500 per sqm — use the one on your tax declaration."
- Add "Type of sale": resale / bank-acquired (as-is) / brand-new developer unit, used
  to label the result, and to widen the range for as-is sales. Do not apply a fixed
  discount until there is evidence for one.

### Not doing

- Copying LandValuePH's printed percentage discounts — no published basis.
- Calibrating to either purchased report.
- A fake "comparing N recent sales" loader.

## 6. Caveats

- 11 house & lot and 13 lot listings is a small, asking-price-only sample, with
  thin Bauan coverage (no Poblacion comparables at all). The proposed rate is
  "better supported than today", not "proven accurate". Re-test when more resale
  listings, or any closed-sale prices, are available.
- Most listings did not state age or construction; age bands were estimated.
- A licensed appraiser's opinion on a few Bauan homes would be the single best
  calibration upgrade.

---

## 7. Full input audit and fixes (2026-10-14, calculationVersion 2026.10.7)

Every input was changed one at a time on the Binay St house (100 sqm lot, 120 sqm
CHB, 6–10 yrs) to see what it does to the total.

| Input | Before | After |
|---|---|---|
| Purpose, sale stage, expected price | no effect (by design) | unchanged |
| Classification CR | +152% (4.25× BIR: CR rate × 1.7 proxy × 2.5 band) | +23% (CR rate × ramped band) |
| Agricultural / industrial | 0.75× BIR / 2.7× BIR | 1.5× / 2.0× |
| Lot area 1,000 sqm | linear (+544%) | large-lot factor × 0.74 |
| Corner | +2.5% land | unchanged |
| Condition, construction, floor area, age, features | applied | unchanged |
| Blank floor area | 60% of lot | typical for the lot (0.9× ≤150 sqm, 0.75× ≤300, 0.5× above) |
| Storeys | no effect (floor area covers it) | unchanged |
| Occupancy / title / inheritance | **no effect** | −5 / −5 / −25%, −8 / −15%, −10% of total, capped 30% |
| 8 site questions | **no effect** | % on land (landlocked −35%, flood-prone −15%, …), net capped −40% / +10% |
| Recommended asking price | estimate × 1.30 | estimate × 1.07 |

Also: the details step now pre-selects typical answers from the location
(subdivision streets -> Subdivision + barangay road; highway/national/diversion
streets -> Highway; named poblacion streets -> Municipal road; agricultural class ->
partial utilities; house: age 6–10 and a typical floor area), marked "Suggested",
never overwriting a reader's own answer. Each button shows its % effect. The
back-office guide's corner premium was being counted twice after this morning's
unification; fixed.

Market test after all changes: house & lot median −2.5%, median |error| 11.2%;
vacant lots median −2.3% (1,120 sqm open lot +84% -> +32%).

Still open: the 85–130% range is wide; one page shows two different "net
proceeds" figures (seller-paid costs vs all four taxes); flood risk has no hazard
data behind its suggestion (defaults to "No flooding"); the listing sample is
small and asking-price only.

---

## 8. Monthly comparables feed (proposed, 2026-10-14)

### How LandValuePH does it (read from their public bundle)

- The "tested against 859 bank & government property records · Oct 2026" line is
  hard-coded in `siteStats-*.js` (`R="859"`, `S="Oct 2026"`,
  `["BPI Buena Mano","SSS","Public listings"]`). It is a marketing constant, not a
  live count.
- Their result page labels each comparable by source and price type:
  sources `myproperty`, `property24`, `lamudi` (public listings), `bpi_buenamano`,
  `sss_haa`, `metrobank`, `pagibig`; price types `asking`, `minimum_bid`,
  `appraised_value`, `winning_bid`, `completed_sale`.
- Quality filters, in their client code: reject a record below 0.5x or above 5x
  the BIR value, below 0.35x or above 4x the pool median, lot more than 5x
  different from the subject; flag property-type mismatch, duplicates
  (barangay + lot + price/sqm) and parse errors; need 3+ records for a median.
  They then show "N of M tightly aligned (within ±X%)", the newest record date,
  how many are in the subject's barangay, and how many are bank/government.
- The records themselves are collected server-side (their Supabase); the
  collection code is not public. Nothing here should copy their data.

### Sources we can collect ourselves (checked 2026-10-14)

| Source | Batangas records now | Fields | Price type | Format / cadence | Crawl rules |
|---|---|---|---|---|---|
| **BDO** asset-for-sale `Luzon_Batangas.pdf` | **96** (as of 10 Oct 2026) | address, project, lot, floor, type | advertised price | one PDF per province, refreshed by BDO | PDF on bdo.com.ph |
| **BPI Buena Mano** properties for sale (Luzon page) | **12** | BM code, address, lot / floor, tag (green/yellow/red) | selling price | HTML table, monthly sealed bidding | robots.txt allows |
| **Security Bank** repossessed properties | **5** | address, title no., lot, floor, notes | suggested price (+ sale price) | HTML, "updated monthly" | — |
| **SSS** "List of SSS HAA for Sale" | ~1 | address, lot, floor, dwelling type | **fair market value** (appraisal) | monthly PDF in wp-content/uploads | robots.txt allows |
| **Pag-IBIG** acquired assets | unknown (site in maintenance today) | region/province/city filters, lot, floor | **minimum bid**; separate **winning bids** list (completed prices) | web app + lists | check when back up |
| Metrobank, Landbank | not yet counted | — | selling price | PDF / pages | check |
| DotProperty / MyProperty | ~100 (Oct sample) | as listed | asking | existing market-scan worker | already in use |
| Lamudi, Property24 | — | — | asking | blocked crawlers in testing | **do not circumvent** |

So ~110+ Batangas bank records a month from BDO, BPI and Security Bank alone, plus
portal listings: more Batangas evidence than LandValuePH's whole 859-record test
set is likely to hold for this province. Pag-IBIG winning bids are the only source
of *completed* prices and are the priority once their site is reachable.

Caveats: bank prices are "as is, where is" and tag-dependent (a red/yellow tag
means title or possession issues). Bank appraisals usually sit near market, but
these are not resale prices, so every record keeps its `source`, `priceType` and
`saleCategory` and is never silently mixed with resale asking prices.

### Pipeline (built 2026-10-14 - see `market-scan/comparables/README.md`)

1. **Collectors**: `market-scan/comparables/sources/bdo.js` (reads the PDF's
   positioned text and rebuilds the table, no poppler) and `sources/bpi.js`
   (HTML table; the Sales Officer column is never read). One request per page
   per month, identifying user agent. Security Bank answers 403 to robots, so it
   is not fetched; a person may enter its table as `inbox/securitybank.rows.json`.
   BDO refuses GitHub's servers: its PDF (or a rows file) is dropped into
   `market-scan/comparables/inbox/`, and the run issue says how.
2. **Build** (`build-comparables.js`): one record shape `{source, priceType,
   saleCategory, kind, price, lotArea, floorArea, pricePerSqmLot, address,
   project, municipality, barangay, streetKey, matchLevel, birRate, ratioToBir,
   tag, observedOn, url}`; address matched to `data/bir-batangas` (`match.js`);
   duplicates removed within and across sources (same barangay, lot within 1 sqm,
   price within 2%, no conflicting lot/block numbers - so two different lots at
   one price in a subdivision are both kept); LandValuePH-style filters (0.5-5x
   BIR for lots, 0.5-15x for built, 0.35-4x the town median).
3. **Output**: `data/comparables/batangas-latest.json` is **replaced in full**
   each month - delisted properties disappear. Only a source that failed keeps
   last month's records, once, flagged `carriedOver`. `data/comparables/history.json`
   keeps one summary per month (counts, median price/sqm by town and kind), so
   trends survive without keeping old listings.
4. **Workflow** `.github/workflows/comparables-monthly.yml`: 1st of the month,
   10:17 PHT, plus manual runs and any upload to the inbox. Fetch -> build ->
   tests -> commit. Opens/updates one issue when a source fails, drops 40%+,
   matches under 80%, or its data is over 40 days old (refused after 62).

First snapshot (2026-10-14): 108 parsed (BDO 96 as of 10 Oct, BPI 12),
107 kept, 100% matched to a BIR barangay (42 to the exact street/subdivision).

### How the records improve accuracy

1. **Standing accuracy check, refreshed monthly.** `value_guide_market_accuracy_node.js`
   reads the latest snapshot instead of the fixed October fixture, and reports
   median error by town, type and source. An issue is opened when the overall
   median leaves ±10%, or any town with 8+ records leaves ±20%.
2. **Evidence on the result page.** "12 comparable properties near you", with
   how tightly they agree, the newest date, the source mix and links — the
   section LandValuePH charges for, free. Uses the existing comparables engine
   (`js/value_guide_evidence.js`) with a new institutional source type.
3. **Town-level calibration, reviewed by a person.** For towns with enough
   vacant-lot records, compute the median ratio of record price to our land
   estimate, shrink it toward 1 by n/(n+10), cap at ±25%, and propose it as a
   pull request to `data/calibration.json`. Never applied automatically:
   `zonal-config.json` already says factor changes need admin approval, and a bad
   scrape must not move live prices.
4. **Building-rate check.** For house records, price minus our land estimate gives
   an implied building value per sqm; a drifting median flags the 16,000/sqm rate
   for review.

### Stages and acceptance

| Stage | Done when |
|---|---|
| A. BDO + BPI collectors, build script, manual run | **done 2026-10-14**: 107 records, 100% barangay match, no personal data. Security Bank: manual rows only (403) |
| B. Monthly workflow + failure issues | built 2026-10-14; done when two monthly runs have committed snapshots |
| C. Accuracy test on live snapshot | replaces the fixed fixture; per-town report committed each month |
| D. Evidence card on the result page | **done 2026-10-14**: "Bank listings near you" in the Market evidence group - town count, barangay count, median per sqm with the ±% cluster, this guide's per-sqm against it, and up to 6 nearest records with source, price type, date, tag and link. Display only (`ESREALTY_EVIDENCE.bankNearby`); a test asserts computeEstimate never reads it |
| E. SSS + Pag-IBIG (incl. winning bids) | completed-price records tracked separately |
| F. Calibration PRs | first reviewed calibration merged for a town with ≥10 lot records |

Before stage A goes live: read BDO's, BPI's and Security Bank's website terms
(BPI's terms page could not be fetched from here) and keep attribution to each
source on the evidence card.
