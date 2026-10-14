"use strict";
/* Phase 3 core engine regression — pure Node, no server needed.
   Uses the committed BIR-backed datasets. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const est = require(path.join(ROOT, "js", "estimator.js"));
const core = est.core;

const config = JSON.parse(fs.readFileSync(path.join(ROOT, "data/zonal-config.json"), "utf8"));
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "data/batangas-zonal.json"), "utf8"));
const balayan = JSON.parse(fs.readFileSync(path.join(ROOT, "data/bir-batangas/municipalities/balayan.json"), "utf8"));

let checked = 0;
let failures = 0;
function eq(actual, expected, label) {
  checked++;
  const ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? "[PASS] " : "[FAIL] ") + label + (ok ? "" : "  expected=" + expected + " got=" + actual));
}

/* ---- exact street value, commercial CR (depth 1) ---- */
let r = core.computeEstimate(config, index, balayan, {
  municipality: "Balayan", barangay: "BACLARAN", streetKey: "ALL STREET", classification: "CR", area: 200
});
eq(r.available, true, "cr available");
eq(core.normKey(r.municipality), "BALAYAN", "cr municipality");
eq(r.streetName, "ALL STREET", "cr street name");
eq(r.use, "commercial", "cr use group");
eq(r.source.depth, 1, "cr depth 1");
eq(r.source.level, "street", "cr level street");
eq(r.reference.value, 3500, "cr reference 3500");
eq(r.birZonalRatePerSqm, 3500, "cr BIR zonal rate remains official base");
eq(r.birZonalValue, 700000, "cr BIR zonal value stays separate");
const crRate = Math.round(3500 * (2.5 - ((3500 - 2000) / 23000) * 1.1)); /* proxy 1, ramped band (2026-10-14) */
eq(r.landPerSqm, crRate, "cr landPerSqm uses restored uncapped factor calculation");
eq(r.landValue, crRate * 200, "cr landValue uses BIR × disclosed factors");
eq(r.low, Math.round(crRate * 200 * 0.85), "cr lower planning scenario 85%");
eq(r.high, Math.round(crRate * 200 * 1.30), "cr upper planning scenario 130%");
eq(r.perSqm, crRate, "cr perSqm");
eq(r.marketGuideEstimate, r.total, "factor-based estimate remains available without comparables");
eq(r.marketGuideAvailable, false, "market guide availability requires comparables");
eq(r.recommendedAskingPrice, Math.round(r.total * 1.07), "recommended asking price is estimate + 7%, not the 130% scenario");
eq(r.marketGuide.status, "factor-based-no-comparable-data", "no-comparable basis is explicit");
eq(r.marketGuide.comparablePricesUsed, false, "comparable asking prices do not feed the factor calculation");
eq(core.integrityCheck(r).ok, true, "cr reconciles");
eq(r.calculationVersion, config.calculationVersion, "cr calc version stamped");
eq(r.dataVersion, index.dataVersion, "cr data version stamped");

const comp = core.normalizeComparable({
  id: "internal-1", city: "Balayan", barangay: "BACLARAN", property_type: "House & Lot",
  offer_type: "sale", display_price: 4000000, lot_size_sqm: 200, source_url: "https://example.test/internal-1"
}, "SEA ESTATES listing");
eq(comp.propertyType, "HOUSE_LOT", "comparable property type normalized");
eq(comp.pricePerSqm, 20000, "comparable price per lot sqm");
eq(comp.isAskingPrice, true, "listing comparable marked asking price");
eq(core.normalizeComparable({ offer_type: "sale", display_price: 4000000, lot_size_sqm: 200 }, "ES Realty transaction").isAskingPrice, true, "historic label does not verify actual sale");
eq(core.normalizeComparable({ offer_type: "sale", display_price: 4000000, lot_size_sqm: 200, evidenceKind: "verified-sale", verified: true, saleDate: "2026-10-01", verificationReference: "fixture-document" }, "SEA ESTATES transaction").isAskingPrice, false, "explicit documented sale remains separate from asking data");
eq(core.normalizeComparable({ offer_type: "rent", display_price: 100000, lot_size_sqm: 100 }, "SEA ESTATES listing"), null, "rental is not a sale comparable");
const comps = core.comparableSummary([comp, {
  city: "Balayan", barangay: "BACLARAN", property_type: "House & Lot", offer_type: "sale",
  price: 6000000, lotArea: 200, sourceUrl: "https://example.test/internal-2"
}], { municipality: "BALAYAN", barangay: "BACLARAN", propertyType: "house_lot", sourceType: "SEA ESTATES listing" });
eq(comps.count, 2, "comparable summary keeps matching internal records");
eq(comps.medianPricePerSqm, 25000, "even median averages middle rates");
eq(comps.status, "context-only-insufficient-evidence", "insufficient evidence not represented as qualified market indication");
const compEstimate = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "ALL STREET", classification: "CR", area: 100,
  comparables: [{ city: "BALAYAN", barangay: "BACLARAN", property_type: "lot-only", offer_type: "sale", price: 1500000, lotArea: 100 }],
  comparableSource: "SEA ESTATES listing"
});
eq(compEstimate.marketGuideAvailable, true, "market guide available with comparable evidence");
eq(compEstimate.recommendedAskingPrice, Math.round(compEstimate.total * 1.07), "recommended asking price is estimate + 7%");

/* ---- corner lot toggle ---- */
let rc = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "ALL STREET", classification: "CR", area: 200, corner: true
});
eq(rc.corner.applied, true, "corner applied");
eq(rc.landPerSqm, Math.round(3500 * 1.025 * (2.5 - ((3500 - 2000) / 23000) * 1.1)), "corner factor applies to the restored factor calculation");

/* ---- residential RR (proxy 1.0, band 2.5) ---- */
let rr = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "ALL STREET", classification: "RR", area: 200
});
eq(rr.use, "residential", "rr use group");
eq(rr.landPerSqm, 5000, "rr landPerSqm = 2000 x 1.0 x 2.5");
eq(rr.landValue, 1000000, "rr landValue");

/* ---- barangay all-other-streets fallback (depth 2) ---- */
let d2 = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "DOES NOT EXIST", classification: "A40", area: 100
});
eq(d2.source.depth, 2, "d2 depth 2");
eq(d2.source.level, "barangay-other", "d2 level");
eq(d2.reference.value, 2500, "d2 other value 2500");

/* ---- municipality aggregate fallback (depth 3) ---- */
let d3 = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "NO SUCH BRGY", streetKey: "X", classification: "GP", area: 100
});
eq(d3.source.depth, 3, "d3 depth 3");
eq(d3.source.level, "municipality", "d3 level");
eq(d3.source.count >= 1, true, "d3 has count");

/* ---- province aggregate fallback (depth 4) ---- */
let d4 = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "NO SUCH BRGY", streetKey: "X", classification: "RC", area: 100
});
eq(d4.source.depth, 4, "d4 depth 4");
eq(d4.source.level, "province", "d4 level");
eq(index.provinceByClass.RC.p50 > 0, true, "d4 province RC agg exists");

/* ---- fail closed ---- */
let nu = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "NO SUCH BRGY", streetKey: "X", classification: "ZZ", area: 100
});
eq(nu.available, false, "unavailable for unknown class");
eq(nu.reason, "no-data", "reason no-data");
let na = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "ALL STREET", classification: "CR"
});
eq(na.available, false, "no-area unavailable");
eq(na.reason, "no-area", "no-area reason");
let nm = core.computeEstimate(config, index, balayan, {
  municipality: "NOWHERE", barangay: "X", streetKey: "X", classification: "RR", area: 100
});
eq(nm.available, false, "missing municipality unavailable");
eq(nm.reason, "municipality-not-found", "missing municipality reason");

/* ---- house & lot improvement ---- */
let hl = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "ALL STREET", classification: "RR", area: 200,
  type: "house_lot", floorArea: 120, floors: "2", ageBand: "11-20", construction: "rca_steel",
  features: ["wall_gate", "solar"]
});
eq(hl.type, "house_lot", "hl type");
eq(hl.floorArea, 120, "hl floorArea");
/* No storeys multiplier. floorArea is entered once and labelled "Across all
   storeys", so a per-storey factor would charge the same square metres twice. */
eq(hl.floorsMultiplier, 1, "hl storeys multiplier is neutral");
eq(hl.ageMidpoint, 15, "hl age midpoint 15");
eq(hl.depreciatedPct, 37.5, "hl dep 15/40 = 37.5%");
eq(hl.buildCostPerSqm, 22000, "hl RCA 22000");
eq(hl.featuresTotal, 380000, "hl features 180000 + 200000");
eq(hl.improvement, 2030000, "hl improvement = rate x total floor area x (1 - dep) + features");
eq(hl.total, hl.landValue + hl.improvement, "hl total = land + improvement");
eq(core.integrityCheck(hl).ok, true, "hl reconciles");

/* ---- house & lot floor default ratio ---- */
let hd = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "ALL STREET", classification: "RR", area: 200,
  type: "house_lot"
});
eq(hd.floorArea, 150, "hd blank floor = typical size for a 200 sqm lot (0.75x)");

/* ---- taxes incl. registration ---- */
let tax = core.taxMath(config, 1000000);
eq(tax.cgt, 60000, "tax cgt");
eq(tax.dst, 15000, "tax dst");
eq(tax.transfer, 5000, "tax transfer");
eq(tax.registration, 1000, "tax registration 0.1%");
eq(tax.total, 81000, "tax total");
eq(tax.base, 1000000, "tax fallback base uses guide total");
eq(tax.baseBasis, "SEA ESTATES market guide estimate (illustrative)", "tax fallback basis is disclosed");
eq(tax.sellerCosts, 60000, "seller costs default to CGT");
eq(tax.sellerNetProceeds, null, "seller net requires selling price");

let saleTax = core.taxMath(config, 1000000, {
  salePrice: 2000000,
  birZonalValue: 700000,
  marketGuideEstimate: 1000000
});
eq(saleTax.base, 2000000, "tax base uses highest selling price");
eq(saleTax.baseBasis, "Selling price", "tax basis identifies selling price");
eq(saleTax.cgt, 120000, "selling-price CGT");
eq(saleTax.broker, 60000, "illustrative broker commission");
eq(saleTax.sellerNetProceeds, 1820000, "seller net proceeds after CGT and broker");

/* ---- determinism ---- */
let r2 = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "ALL STREET", classification: "CR", area: 200
});
eq(JSON.stringify(r) === JSON.stringify(r2), true, "deterministic same inputs");

let risk = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "ALL STREET", classification: "CR", area: 200,
  occupancy: "informal_settlers", titleStatus: "tax_declaration", inheritanceStatus: "pending"
});
eq(risk.ownershipAdjustmentPct, 30, "ownership answers applied: 25 + 15 + 10 = 50, capped at 30");
eq(risk.total, Math.round((risk.landValue + risk.improvement) * 0.70), "total = (land + building) x (1 - 30%)");
eq(core.integrityCheck(risk).ok, true, "risk-adjusted estimate reconciles");

if (failures) { console.log(failures + " FAILURES"); process.exit(1); }
console.log("ALL GREEN (" + checked + " checks)");
