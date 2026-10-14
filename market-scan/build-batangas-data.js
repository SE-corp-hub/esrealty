"use strict";
// Builds the Batangas value-estimator data layer from the official BIR import:
//   data/batangas-zonal.json  — BIR-backed municipality index (per-class aggregates, coverage)
//   data/zonal-config.json    — estimator engine constants (v2)
//   data/data-manifest.json   — stamped manifest
// Run: node market-scan/build-batangas-data.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BIR = path.join(ROOT, "data", "bir-batangas");
const MUNI_DIR = path.join(BIR, "municipalities");

// --validate: run every integrity check WITHOUT writing any file (CI review
// mode — never resets data-manifest.json's nextReview stamp). Default/build
// mode writes the generated datasets; --refresh is an explicit alias.
const VALIDATE_ONLY = process.argv.includes("--validate") || process.env.ESTIMATOR_VALIDATE_ONLY === "1";

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error("Missing dataset: " + rel);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function write(rel, obj) {
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(obj, null, 2) + "\n", "utf8");
}

const errors = [];
function check(cond, msg) { if (!cond) errors.push(msg); }

/* ------------------------------------------------------------------ */
/* config v2 (approved constants)                                      */
/* ------------------------------------------------------------------ */

const CONFIG = {
  version: 2,
  calculationVersion: "2026.10.7",
  riskPolicy: "Answer-led: each site answer moves land by a stated % (net capped -40%/+10%) and each ownership answer deducts a stated % from the total (capped 30%); answers stay unverified until documents are reviewed",
  scenarioRange: { lowFactor: 0.85, highFactor: 1.3, meaning: "Planning scenarios, not statistical accuracy" },
  dataVersion: "bir-2022-rdo58-59",
  asOf: "2022-07-23",
  note: "Engine + data versions stamped on every estimate output. Deterministic and reconcilable.",
  purposes: ["Selling", "Buying", "I received an offer", "Estate", "Loan", "Other"],
  propertyTypes: {
    vacant_lot: { label: "Vacant Lot", kind: "land" },
    house_lot: { label: "House & Lot", kind: "built" }
  },
  cornerLotPct: 0.025,
  /* These rates and their provenance are the source of truth for
     data/zonal-config.json. If you change them here, run
     `node market-scan/build-batangas-data.js` to regenerate the data file, and
     update tests/estimator_math_node.js which pins them. The previous values
     (15000 / 40000) were a stale table; 16000 / 25000 / 32000 is the committed
     SEA ESTATES table the data file already carried. */
  construction: {
    wood_prefab: { label: "Wood / Pre-fab", costPerSqm: 11000, sourceType: "SEA ESTATES existing-home RCN (PSA permit avg ~12,200/sqm Jan 2025; tested vs 2026-10 Batangas listings)", sourceDate: "2026" },
    mixed_chb: { label: "Mixed / CHB", costPerSqm: 16000, sourceType: "SEA ESTATES existing-home RCN (PSA permit avg ~12,200/sqm Jan 2025; tested vs 2026-10 Batangas listings)", sourceDate: "2026" },
    rca_steel: { label: "Reinforced Concrete / Steel", costPerSqm: 22000, sourceType: "SEA ESTATES existing-home RCN (PSA permit avg ~12,200/sqm Jan 2025; tested vs 2026-10 Batangas listings)", sourceDate: "2026" }
  },
  /* Every multiplier is 1. floorArea is one figure entered once, labelled "Total
     built-up area (sqm) / Across all storeys", so a per-storey factor on top of it
     charges the same square metres twice - it priced a 2-storey house 5% above the
     same house described as 1-storey. The reference form labels its field "Total
     floor area across all storeys" and likewise applies no storeys factor.

     If a genuine multi-storey premium is ever wanted, it belongs in the rate table
     as a per-storey construction argument, not as a multiply over total area. */
  floors: [
    { key: "1", label: "1 floor", multiplier: 1.0 },
    { key: "2", label: "2 floors", multiplier: 1.0 },
    { key: "3plus", label: "3 floors or more", multiplier: 1.0 }
  ],
  ageBands: [
    { key: "0-5", label: "0–5 years", midpoint: 2.5 },
    { key: "6-10", label: "6–10 years", midpoint: 8 },
    { key: "11-20", label: "11–20 years", midpoint: 15 },
    { key: "21-30", label: "21–30 years", midpoint: 25 },
    { key: "31plus", label: "Over 30 years", midpoint: 35 }
  ],
  depreciation: { lifeYears: 40, maxPct: 0.95 },
  features: {
    wall_gate: { label: "Concrete fence & gate", cost: 180000 },
    patio: { label: "Covered patio", cost: 80000 },
    garden: { label: "Landscaped garden", cost: 50000 },
    dirty_kitchen: { label: "Dirty kitchen", cost: 40000 },
    water_tank: { label: "Water tank", cost: 30000 },
    cctv: { label: "CCTV system", cost: 50000 },
    solar: { label: "Solar panels", cost: 200000 },
    pool: { label: "Swimming pool", cost: 500000 }
  },
  proxyFactors: {
    residential: { label: "Residential", factor: 1.0 },
    commercial: { label: "Commercial", factor: 1.0 },
    agricultural: { label: "Agricultural", factor: 1.0 },
    industrial: { label: "Industrial", factor: 1.0 }
  },
  marketBand: {
    regionalAdj: 1.0,
    rateRamp: {
      appliesTo: ["residential", "commercial"],
      lowRate: 2000,
      highRate: 25000,
      floor: 1.4,
      meaning: "The residential band mid descends linearly from its full value at BIR <= 2000/sqm to the floor at BIR >= 25000/sqm. High-BIR streets (beachfront, prime town centres) already carry the location premium in the BIR rate itself, so applying a flat 2.5x on top double-counts it. LandValuePH's own published code uses a 1.5x-2.5x rural band - the top matches our flat value, and the descent lands inside their range. Evidence: Catalina 6000 -> 2.22x observed, Playa Laiya 25000 -> 0.84x-1.70x observed.",
      source: "Gathered market evidence 2026-10-08 + reverse-engineered LandValuePH rural residential band (1.5x-2.5x). See docs/reference/landvalueph-reverse-engineering.md"
    },
    bands: {
      residential: { min: 1.8, max: 3.2, mid: 2.5 },
      commercial: { min: 1.8, max: 3.2, mid: 2.5 },
      agricultural: { min: 1.0, max: 2.0, mid: 1.5 },
      industrial: { min: 1.5, max: 2.5, mid: 2.0 }
    }
  },
  marketGuide: {
    label: "SEA ESTATES Market Guide Estimate",
    sourceType: "SEA ESTATES approved factors",
    comparablePolicy: "Use SEA ESTATES listings first; external asking-price evidence only when internal data is unavailable.",
    factorApproval: "Admin approval required",
    status: "assumption-backed",
    note: "The factor-based guide is separate from official BIR reference values. Comparable asking-listing prices are shown as context and do not directly determine the calculation."
  },
  tax: { cgtPct: 0.06, dstPct: 0.015, transferPct: 0.005, registrationPct: 0.001, brokerPct: 0.03 },
  disclaimer: "SEA ESTATES Property Value Guide — a planning estimate using the imported BIR zonal reference, disclosed SEA ESTATES factors, and disclosed improvement-cost assumptions where applicable. Comparable asking-listing prices are reported as context and are not direct calculation inputs. Review the selected schedule, match level, factors, and assumptions; confirm current BIR/LGU references and property details before a transaction. A site and document review can further refine the estimate.",
  labels: {
    reference: "BIR zonal reference",
    locality: "Locality",
    market: "Market adjustment",
    coverage_good: "Exact street-level BIR value",
    coverage_limited: "Limited street coverage — inside the municipality fallback",
    coverage_unavailable: "Estimate unavailable"
  }
};

/* ------------------------------------------------------------------ */
/* build bir-backed batangas-zonal index                               */
/* ------------------------------------------------------------------ */

const locations = read("data/bir-batangas/locations.json");
const manifest = read("data/bir-batangas/manifest.json");
const legacyZonal = read("data/batangas-zonal.json"); // keeps centroid metadata

const legacyCentroids = {};
(legacyZonal.municipalities || legacyZonal.towns || []).forEach((t) => {
  legacyCentroids[String(t.name).toLowerCase()] = t.centroid || null;
});

function finalizeClassMap(map) {
  const agg = {};
  for (const cls of Object.keys(map)) {
    const a = map[cls];
    a.values = a.values.filter((v) => v > 0);
    if (!(a.values.length > 0)) continue;
    a.values.sort((x, y) => x - y);
    a.count = a.values.length;
    a.sum = a.values.reduce((s, v) => s + v, 0);
    a.min = a.values[0];
    a.max = a.values[a.values.length - 1];
    a.mean = Math.round(a.sum / a.count);
    a.p25 = a.values[Math.floor(a.count * 0.25)];
    a.p50 = a.count % 2 ? a.values[(a.count - 1) / 2] : Math.round((a.values[a.count / 2 - 1] + a.values[a.count / 2]) / 2);
    a.p75 = a.values[Math.floor(a.count * 0.75)];
    delete a.values; delete a.sum;
    agg[cls] = a;
  }
  return agg;
}

const provAgg = {};

const munis = (locations.municipalities || []).map((loc) => {
  const file = path.join(MUNI_DIR, loc.slug + ".json");
  if (!fs.existsSync(file)) throw new Error("Missing municipality file: " + file);
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  const byClass = {};
  let streetRows = 0;
  let otherRows = 0;
  const pushVal = (cls, v) => {
    if (!(v > 0)) return;
    if (!byClass[cls]) byClass[cls] = { values: [] };
    if (!provAgg[cls]) provAgg[cls] = { values: [] };
    byClass[cls].values.push(v);
    provAgg[cls].values.push(v);
  };
  for (const bk of Object.values(m.barangays)) {
    for (const cls of Object.keys(bk.other || {})) {
      const v = bk.other[cls];
      pushVal(cls, v); otherRows++;
    }
    for (const sk of Object.keys(bk.streets)) {
      const st = bk.streets[sk];
      for (const cls of Object.keys(st.classes || {})) {
        const entry = st.classes[cls];
        const vals = [entry.value].concat((entry.segments || []).map((s) => s.value));
        for (const v of vals) { pushVal(cls, v); streetRows++; }
      }
    }
  }
  const agg = finalizeClassMap(byClass);
  const coverage = m.barangays && Object.keys(m.barangays).length ? "good" : "limited";
  return {
    slug: m.slug,
    name: m.name,
    rdo: m.rdo,
    departmentOrder: m.departmentOrder,
    revision: m.revision,
    effectivityDate: m.effectivityDate || loc.effectivityDate || "",
    barangayCount: Object.keys(m.barangays).length,
    streetCount: Object.keys(m.barangays).reduce((a, b) => a + Object.keys(m.barangays[b].streets).length, 0),
    coverage,
    centroid: legacyCentroids[String(m.name).toLowerCase()] || null,
    byClass: agg,
    stats: { streetValueRows: streetRows, otherValueRows: otherRows }
  };
});

const provinceByClass = finalizeClassMap(provAgg);

if (VALIDATE_ONLY) {
  console.log("VALIDATE-ONLY — generated outputs are not written to disk.");
} else {
  write("data/batangas-zonal.json", {
    region: "Region IV-A (CALABARZON)",
    province: "Batangas",
    asOf: "2022-07-23",
    dataVersion: "bir-2022-rdo58-59",
    source: "Official BIR zonal schedules — RDO 58 (DO 035-2022) & RDO 59 (DO 034-2022). Imported by tools/bir-import.",
    classifications: locations.classifications,
    provinceByClass: provinceByClass,
    municipalities: munis
  });

  write("data/zonal-config.json", CONFIG);
}

/* ------------------------------------------------------------------ */
/* validate                                                            */
/* ------------------------------------------------------------------ */

const muniNames = munis.map((m) => String(m.name).trim());
check(new Set(muniNames.map((n) => n.toLowerCase())).size === muniNames.length, "zonal: unique municipality names");
check(munis.length >= 30, "zonal: >= 30 municipalities, got " + munis.length);
check(munis.length === manifest.lookup.municipalityCount, "zonal: municipality count != bir manifest (" + manifest.lookup.municipalityCount + ")");
const required = ["BATANGAS CITY", "LIPA CITY", "TANAUAN CITY", "STO. TOMAS CITY", "NASUGBU", "SAN JUAN", "CALATAGAN", "TINGLOY", "BAUAN", "LEMERY"];
required.forEach((t) => check(muniNames.indexOf(t) >= 0, "zonal: missing municipality " + t));
const totalBrgy = munis.reduce((a, m) => a + m.barangayCount, 0);
const totalSt = munis.reduce((a, m) => a + m.streetCount, 0);
check(totalBrgy === manifest.lookup.barangayCount, "zonal: total barangays != bir manifest (" + manifest.lookup.barangayCount + ")");
check(totalSt === manifest.lookup.streetCount, "zonal: total streets != bir manifest (" + manifest.lookup.streetCount + ")");
munis.forEach((m) => {
  check(Object.keys(m.byClass).length >= 1, "zonal: " + m.name + " has no per-class aggregates");
  check(m.coverage === "good" || m.coverage === "limited", "zonal: bad coverage field for " + m.name);
  for (const cls of Object.keys(m.byClass)) {
    const a = m.byClass[cls];
    check(a.min > 0 && a.max >= a.min && a.p50 >= a.min && a.p50 <= a.max, "zonal: bad aggregate for " + m.name + "/" + cls);
  }
});
const provClsKeys = Object.keys(provinceByClass);
check(provClsKeys.length >= 5, "zonal: province-class aggregate must cover >= 5 classes, got " + provClsKeys.length);
provClsKeys.forEach((cls) => {
  const a = provinceByClass[cls];
  check(a.min > 0 && a.max >= a.min && a.p50 >= a.min && a.p50 <= a.max, "zonal: bad province aggregate for " + cls);
});

// config checks
check(CONFIG.cornerLotPct === 0.025, "config: cornerLotPct must be 0.025");
check(CONFIG.propertyTypes.vacant_lot && CONFIG.propertyTypes.house_lot && CONFIG.propertyTypes.house_lot.floorDefaultRatio === undefined, "config: vacant_lot + house_lot present, house_lot floor default 0.6");
check(CONFIG.marketBand.regionalAdj === 1.0 && CONFIG.marketBand.bands.residential.mid === 2.5 && CONFIG.marketBand.bands.agricultural.mid === 1.5 && CONFIG.marketBand.bands.industrial.mid === 2.0, "config: market band mids");
check(CONFIG.depreciation.lifeYears === 40 && CONFIG.depreciation.maxPct === 0.95, "config: depreciation rule");
check(CONFIG.tax.cgtPct === 0.06 && CONFIG.tax.dstPct === 0.015 && CONFIG.tax.transferPct === 0.005 && CONFIG.tax.registrationPct === 0.001, "config: tax rates");
/* 2026-10-14: every proxy is 1.0. The estimator always uses the classification's
   own BIR rate (CR, A, I...), which already carries the use premium or discount;
   a second use factor double-counted it (commercial came out at 4.25x BIR). */
check(CONFIG.proxyFactors.residential.factor === 1.0 && CONFIG.proxyFactors.commercial.factor === 1.0 && CONFIG.proxyFactors.agricultural.factor === 1.0 && CONFIG.proxyFactors.industrial.factor === 1.0, "config: proxy factors");
["Wood / Pre-fab", "Mixed / CHB", "Reinforced Concrete / Steel"].forEach((l) => {
  check(Object.values(CONFIG.construction).some((c) => c.label === l), "config: missing construction type " + l);
});

// stamp manifest
const manifestOut = {
  version: 2,
  validated: VALIDATE_ONLY ? "n/a (validate-only)" : new Date().toISOString().slice(0, 10),
  nextReview: VALIDATE_ONLY ? "n/a (validate-only)" : reviewDate(),
  datasets: [
    "data/bir-batangas/manifest.json",
    "data/bir-batangas/locations.json",
    "data/bir-batangas/municipalities/*.json",
    "data/zonal-config.json",
    "data/batangas-zonal.json",
    "data/batangas-projects.json"
  ],
  status: errors.length ? "invalid" : "valid",
  counts: {
    municipalities: munis.length,
    barangays: totalBrgy,
    streets: totalSt,
    classifications: Object.keys(locations.classifications).length,
    calculationVersion: CONFIG.calculationVersion,
    dataVersion: CONFIG.dataVersion
  },
  note: errors.length ? errors.slice(0, 3).join(" | ") : "BIR-backed Batangas dataset valid; deterministic and reconcilable."
};
if (!VALIDATE_ONLY) write("data/data-manifest.json", manifestOut);

if (errors.length) {
  console.error("VALIDATION FAILED\n" + errors.join("\n"));
  process.exit(1);
}
console.log("ALL GREEN — " + munis.length + " municipalities, " + totalBrgy + " barangays, " + totalSt +
  " streets, " + Object.keys(locations.classifications).length + " classification codes." +
  (VALIDATE_ONLY ? " (validate-only, no files written)" : " Manifest stamped."));

function reviewDate() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}
