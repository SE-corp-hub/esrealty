# LandValuePH — Reverse-Engineering Reference

Date: 2026-10-08
Status: **client-side findings recorded; server-side computation NOT extracted**

## How this was done

The LandValuePH calculator is a Vite/React single-page app served at
`https://www.landvalueph.com/`. Its calculation engine ships in the public JS
bundles every visitor downloads — there is no access control on the client code.
This reference records the *facts* those bundles reveal (multiplier bands, blend
weights, city median data). It does not copy their source, and it does not touch
their private/paid endpoints.

Method: loaded the site in a controlled browser, enumerated the JS chunks, and
read the three calculation chunks:

| Chunk | Contents |
|---|---|
| `calculations-*.js` | the full valuation engine (zoning/market/accessibility adjustments, cost approach, weighted blend) |
| `marketMultiplierConfig-*.js` | the region/use multiplier table and the city median blend |
| `ResidentialHouseCalculator-*.js` | the public form, calling the above |

The detailed-report computation that produced the purchased PDFs' 1.174x land
multiplier is **NOT in the client**. Their backend is a Supabase project
(`htnbwlofpmfpkvkvhflw.supabase.co`, `zonal_values` table) and the detailed report
runs in a server-side edge function. That part was not probed and is not recorded
here.

## 1. The market multiplier table (their published ranges)

Residential:

| Region | Low | High |
|---|---:|---:|
| NCR | 1.8 | 3.0 |
| Metro (CAV, LAG, BUL, RIZ, PAM, CEB, DAV) | 1.8 | 3.2 |
| Provincial (other regions) | 2.5 | 4.5 |
| **Rural (Bauan, most of Batangas)** | **1.5** | **2.5** |

Agricultural: NCR 1.0–1.5 | Metro 1.2–2.0 | Provincial 1.0–1.8 | Rural 1.0–1.5
Industrial: NCR 1.5–2.5 | Metro 1.5–2.5 | Provincial 1.2–2.0 | Rural 1.0–1.5

**Bauan resolves to "Rural" → residential range 1.5×–2.5×.**

## 2. The "LVIS blend + regional formula"

For cities with >= 10 listings in their baked-in `CITY_MARKET_DATA`, the market
range blends a city median asking rate (60–70% weight) with the regional
multiplier range (30–40%):

```text
low  = 0.7 * (cityMedian * 0.9) + 0.3 * (zonal * regionLow)
high = 0.7 * (cityMedian * 1.1) + 0.3 * (zonal * regionHigh)
```

Baking for the cities closest to the subject:

| City | Median per sqm (x0.85 recorded) | Listings |
|---|---:|---:|
| Lipa City | 21,620 (rec. 18,377) | 312 |
| Dasmarinas | 21,635 | 293 |
| Sta. Rosa | 39,500 | 406 |

**No Bauan row exists in their city data** — consistent with both purchased
reports saying "no comparables for Bauan". So the LVIS blend cannot fire for the
subject municipality; it would fall back to the regional multiplier alone.

## 3. What their two purchased reports were using

- **Oct 1 report (LVPH-EC33B069, vacant lot):** ₱2,875,000 = 11,500 x 100 x **2.5x**
  — the TOP of their own Rural band, presented as "LVIS blend + regional formula".
- **Oct 5 report (LVPH-D-9531904C, house & lot):** land ₱1,350,000 = **1.174x** —
  *below their own Rural floor of 1.5x*. Computed server-side; the client gives no
  formula for it.

The two reports disagree with each other, and the Oct 5 number sits outside their
own published range. That is the reference's own inconsistency, recorded here so it
is not mistaken for a stable "true" multiplier.

## 4. What this means for the SEA ESTATES model

Three independent confirmations, all pointing the same way:

1. **Their Rural residential band is 1.5×–2.5×.** Our flat 2.5× (pre-ramp) was the
   top of it, not an inflated guess.
2. **Their beachfront/premium logic is a *descent*, not an addition.** The high-BIR
   street already prices the location; a flat multiplier on top double-counts it.
   Our 2026.10.5 rate ramp encodes exactly this: 2.5× at low BIR descending to
   1.4× at 25,000/sqm — inside their Rural band at the low end and at the
   high-end beachfront reality.
3. **No Bauan city-median data exists** anywhere in their client or their reports,
   which is the same gap we hit: Bauan cannot be calibrated to achieved sales from
   any public source.

## Boundary

- What was examined: publicly served client bundles, the free calculator flow, and
  the two reports the user already owns.
- What was NOT done: no Supabase edge-function probing, no paid-report bypass, no
  credential use, no data scraping beyond the free public page. The 1.174x detailed
  engine remains their proprietary server-side computation.
- Licensing: the multiplier *facts* and band ranges are recorded here; their code
  is not reproduced in the repository.

## File provenance

- Extracted chunks were examined from the live site and NOT committed to the repo.
  This markdown is the permanent record.
---

## 2026-10-14 update (site-teardown pass)

Method: the site-teardown skill, run in a real browser on `/check`. Only publicly
served bundles and the free flow were read; no edge function was called directly
and no paid result was unlocked.

### What changed since 2026-10-08

- **The `/check` flow no longer computes in the browser.** Results come from Supabase
  edge functions on `htnbwlofpmfpkvkvhflw.supabase.co` (`create-session`, an
  "adjustment ledger" call taking city, classification, lot area, site and
  building details). The free result shows only the BIR value; everything else is
  behind a PHP 1,299 paywall.
- `marketMultiplierConfig-*.js` still ships the same table (Rural 1.5–2.5, Metro
  1.8–3.2, NCR 1.8–3.0, Provincial 2.5–4.5, cap 6x, agricultural cap 2x) and the
  same city-median blend (Lipa 21,620 x 0.85, 312 listings; no Bauan row).
- **Region-type mismatch:** the client's `q()` maps any region string containing
  "region iv" or "calabarzon" to **Metro (1.8–3.2)**, yet the purchased house & lot
  report prints **Rural (1.5–2.5)** for Bauan. Client and server disagree.
- `calculations-*.js` is now the legacy "Appraise" tool (construction tiers
  low 15,000 / medium 25,000 / high 40,000 per sqm; 40-year age-life; weighted
  zonal 30 / market 50 / cost 15 / income 5). It is not what `/check` uses.
- `propertyFactors-*.js` (multiplicative, capped 0.60–1.25) uses different
  percentages from the ones `/check` displays (e.g. landlocked x0.60 vs -35%,
  informal settlers x0.75 vs -25%, right of way x0.85 vs -12%). Three factor sets
  coexist on one site.
- `buildingValuation-*.js` holds only the features table — identical to ours
  (wall/gate 180k, patio 80k, garden 50k, dirty kitchen 40k, water tank 30k,
  CCTV 50k, solar 200k, pool 500k).

### The free flow, as of today

Purpose (Selling adds "where are you in the sale?") -> vacant lot or house & lot ->
region/province/city/barangay/street -> classification (it auto-switched Binay St
to Commercial with "Most properties in BINAY ST are classified Commercial"; the BIR
schedule lists both a CR and an RR rate for that street and says nothing about
which parcels are which) -> lot-area chips -> nine questions with printed impacts:
caretaker -5%, tenants -10%, informal settlers -25%, title in previous owner's
name -8%, tax declaration only -15%, settlement pending -10%, irregular -5%,
sloping -7%, right of way -12%, landlocked -35%, below road -7%, utilities partial
-5% / none -10%. The loading screen claims "Comparing 161 recent sales nearby";
the result then says "0 comparable listings analyzed".

### The two purchased reports, read together

| | Vacant lot (LVPH-EC33B069, Oct 1) | House & lot (LVPH-D-9531904C, Oct 5) |
|---|---|---|
| Same lot | Binay St, Poblacion III, 100 sqm RR @ 11,500 | same |
| Land | **2,875,000 (2.5x)** | **1,350,000 (1.174x)** |
| Building | — | 16,000 x 120 x (1 - 20%) = 1,536,000 |
| Total | 2,875,000 | 2,886,000 |
| Range | 85% / 130% | 85% / 130% |

The same lot is valued at 2.5x on its own and 1.174x under a house, so the house
adds only PHP 11,000 over the empty lot. The house report also prints "market value
23,000/sqm" (2x) on page 19 while using 13,500/sqm. **Neither report should be used
to calibrate a multiplier.** Calibration belongs to market evidence: see
`docs/plans/2026-10-14-value-guide-accuracy-plan.md`.
