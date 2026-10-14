> **2026-10-14:** the two surfaces were unified. The guide now uses the public estimator's land (ramped band) and building (CHB 16,000/sqm); MARKET_IND 1.174 is retired. The divergence described below is historical. See docs/plans/2026-10-14-value-guide-accuracy-plan.md.

# Value Guide — Calculation Contract

Date: 2026-10-07
Status: **current state measured, disagreement frozen**

Enforces `docs/plans/2026-10-07-upgraded-value-guide.md` Task 3.

## The contract

One calculation, one result shape, two consumers.

```js
estimate(opts)              -> Promise<Result>   // js/estimator.js, both surfaces
computeGuide(opts, evidence) -> Promise<Result>   // Task 3, not yet extracted
```

The plan proposes a single `computeGuide(input, evidence, options)` entry point. The
two surfaces do not yet share one: `EST.estimate()` is the storefront model and
`FLOW.compute()` wraps it with the guide's 1.174 factor. Both read the same BIR data
and both return the same field names, so a renderer can consume either without
knowing which produced it — verified in `tests/value_guide_contract_node.js`.

Fields a consumer may rely on, on both surfaces: `available`, `reason`,
`birZonalRatePerSqm`, `birZonalValue`, `birReferenceLabel`, `landValue`,
`landPerSqm`, `improvement`, `total`, `low`, `high`, `perSqm`, `buildCostPerSqm`,
`floorsMultiplier`, `depreciatedPct`, `saleContext`, `costOptions`, `marketGuide`,
`marketGuideEstimate`, `referenceVerification`, `factorSettingsVersion`,
`calculationVersion`, `dataVersion`, `integrity`, `type`, `area`.

## Invariants that hold today

Asserted, not aspirational.

1. **Customer and transaction metadata never moves the number.** `preparedFor`,
   `customerName`, `purpose`, `phone`, `email`, `salePrice` and `developerFees` all
   leave both totals identical. Verified across six variants on both surfaces.
2. **An unrecognised scenario is refused, not guessed.** `saleContext` is validated;
   an unknown value returns `available: false` with `reason: "invalid-sale-context"`
   and no `total`, so a bad transaction basis cannot leak into the tax panel.
3. **A vacant lot never inherits a building.** The `kind: "land"` flag gates the
   whole building block. Both surfaces return `improvement: 0` even when a floor
   area is passed in.
4. **Components sum to the total, and the total sits inside its own range**, on both
   surfaces, via the existing `integrity` check.
5. **Every result carries `calculationVersion`, `dataVersion` and
   `factorSettingsVersion`**, so any printed number can be traced to the model and
   data that produced it.
6. **Benchmark data stays non-numerical.** `data/market-benchmarks.json` records,
   including `_referenceBenchmark`, are all `numericalAllowed: false`.

## Where they disagree

Fixture: the purchased report's property — Binay St (Ressurreccion St), Poblacion
III, Bauan, RR, 100 sqm lot, 120 sqm floor, CHB, 2 storeys, age 6–10.

| | Reference report | Guide (`FLOW.compute`) | Storefront (`EST.estimate`) |
|---|---:|---:|---:|
| BIR rate | 11,500/sqm | 11,500/sqm | 11,500/sqm |
| Land | 1,350,000 | 1,336,599 | 2,875,000 |
| Building | 1,536,000 | 1,536,000 | 2,400,000 |
| **Total** | **2,886,000** | **2,872,599 (−0.5%)** | **5,275,000 (+82.8%)** |
| Range | 2,453,100–3,751,800 | 2,441,709–3,734,379 | 4,483,750–6,857,500 |

Storefront figures are post-Task-4 (no storeys multiplier). They agree on BIR to the
peso. The gap is now two factors:

### 1. Land: 1.174x vs 2.5x — the open decision

The guide applies `MARKET_IND = 1.174`, which is the multiplier the purchased report
implies: `1,350,000 / 1,150,000 = 1.173913`. The storefront applies the flat
residential band of 2.5.

This is Task 9's decision and it is not resolved. Two land-only records exist and they
disagree with each other: Splendido Taal at 1.26x–2.43x of its street's BIR rate,
Gavina Ville at 0.53x–0.68x of its own. Neither is a verified sale.

### 2. Building rate: 16,000 vs 25,000/sqm — different sources

The guide uses 16,000/sqm for CHB, matching the reference's PSA 2025 figure. The
storefront uses 25,000/sqm from a SEA ESTATES table dated 2026, described in
`data/zonal-config.json` as "appraisal RCN table (2026 PH mid-range)". On this
fixture that is **₱864,000** of the gap.

Neither is wrong on its face — they are different tables. But the storefront's is
roughly 56% above the reference's, and nothing in the repo explains the difference.

### 3. Storeys: x1.05 vs x1.00 — fixed in Task 4

`data/zonal-config.json` gave 2 floors a `multiplier` of 1.05, and 3+ floors 1.10.
`estimator.js:241` applied it:

```js
improvement = Math.round(buildCost * floorArea * floorsMult * (1 - depPct)) + featuresTotal;
```

But the floor area field is labelled **"Total built-up area (sqm) / Across all
storeys"**, and the reference labels its equivalent **"Total floor area across all
storeys"**. Area already spans every storey, so multiplying by a per-storey factor
charged the same square metres twice. It priced a 2-storey house 5% above the same
house described as 1-storey, at a fixed floor area.

**Removed.** Every `floors` multiplier is now 1. On the report fixture that lowers
the storefront total from ₱5,395,000 to ₱5,275,000 — a visible reduction, not a hidden
one, and the reader-facing copy no longer promises a storeys factor. Storeys is still
recorded, because knowing a house has two storeys is useful context; it just no longer
changes the price.

If a genuine multi-storey premium is ever justified, it belongs in the rate table as a
per-storey construction argument, not as a multiply over a total.

### Remaining decomposition

Exact, and asserted so a second cause cannot appear unnoticed:

| Factor | Gap |
|---|---:|
| CHB rate, 16,000 vs 25,000/sqm | ₱864,000 |
| Storeys multiplier (removed Task 4) | ₱0 |
| **Total building difference** | **₱864,000** |

`calculationVersion` bumped to `2026.10.4` so a cached report cannot be mistaken for
one produced by the old model.

## Why this is frozen rather than unified

The plan's intent is one calculator. That cannot be written until the land-multiplier
decision is made, because the decision *is* which of the two models survives.
Freezing the disagreement now means the decision shows up as a deliberate diff
instead of arriving as a surprise.

## Not yet done

- `computeGuide(input, evidence, options)` is not extracted. `EST.estimate()` remains
  the shared entry point and `FLOW.compute()` the guide wrapper.
- `js/value_guide_evidence.js` exists and screens comparables (minimum count, date
  window, deduplication, locality/type/context matching), but its `askingIndication`
  is not wired into either surface's total. It is context only today.
- The `js/storefront.js` mount still calls `ESREALTY_EST.cardSection()`, so the
  public guide is Task 11.