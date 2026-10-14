"use strict";
/* Phase 6: Batangas Value Guide estimator — math fidelity + dataset integrity.
   Complementary to estimator_core_node.js: re-derives every figure with plain
   arithmetic, sweeps all 34 municipalities for regression, audits the approved
   band/proxy config, and reconciles against data-manifest.json.
   Run: node tests/estimator_math_node.js  (or tests\run_all.ps1) */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const api = require(path.join(ROOT, "js", "estimator.js"));
const core = api.core;

const config = JSON.parse(fs.readFileSync(path.join(ROOT, "data/zonal-config.json"), "utf8"));
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "data/batangas-zonal.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "data/data-manifest.json"), "utf8"));
const muniDir = path.join(ROOT, "data/bir-batangas/municipalities");

let checked = 0;
let failures = 0;
function eq(actual, expected, label) {
  checked++;
  const ok = actual === expected;
  if (!ok) failures++;
  process.stdout.write((ok ? "[PASS] " : "[FAIL] ") + label + (ok ? "" : "  expected=" + expected + " got=" + actual) + "\n");
}
function ok(cond, label, detail) {
  checked++;
  const good = !!cond;
  if (!good) failures++;
  process.stdout.write((good ? "[PASS] " : "[FAIL] ") + label + (good ? (detail ? "  " + detail : "") : "  " + (detail || "")) + "\n");
}

/* ---- dataset + manifest reconciliation ---- */
eq(index.municipalities.length, 34, "dataset municipality count 34");
eq(index.dataVersion, "bir-2022-rdo58-59", "dataset dataVersion");
eq(config.calculationVersion, "2026.10.6", "config calculationVersion 2026.10.6");
eq(manifest.status, "valid", "manifest status valid");
eq(manifest.counts.municipalities, 34, "manifest municipality count");
eq(manifest.counts.streets, 3710, "manifest street count 3710");
const distinctCodes = new Set(Object.keys(index.classifications || {}));
eq(distinctCodes.size, 38, "classification codes = 38");
const allCodes = new Set(distinctCodes);
index.municipalities.forEach(m => Object.keys(m.byClass || {}).forEach(c => allCodes.add(c)));
Object.keys(index.provinceByClass || {}).forEach(c => allCodes.add(c));
eq(allCodes.size, 38, "codes seen in aggregates match declared 38");

/* ---- use-group mapping ---- */
eq(core.useOfClassification(config, "A17"), "agricultural", "A17 agricultural");
eq(core.useOfClassification(config, "A40"), "agricultural", "A40 agricultural");
eq(core.useOfClassification(config, "CR"), "commercial", "CR commercial");
eq(core.useOfClassification(config, "CC"), "commercial", "CC commercial");
eq(core.useOfClassification(config, "I"), "industrial", "I industrial");
eq(core.useOfClassification(config, "RR"), "residential", "RR residential");
eq(core.useOfClassification(config, "GP"), "residential", "GP residential");
eq(core.useOfClassification(config, ""), "residential", "empty classification defaults residential");

/* ---- approved config integrity ---- */
const bands = config.marketBand.bands;
ok(config.marketBand.regionalAdj === 1.0, "regionalAdj = 1.0 (CALABARZON-wide default)");
["residential", "commercial", "agricultural", "industrial"].forEach(use => {
  const b = bands[use];
  ok(b && b.min > 0 && b.mid >= b.min && b.max >= b.mid, "bands " + use + " monotonic", JSON.stringify(b));
});
eq(bands.residential.mid, 2.5, "residential band mid 2.5");
eq(bands.commercial.mid, 2.5, "commercial band mid 2.5");
eq(bands.agricultural.mid, 1.5, "agricultural band mid 1.5");
eq(bands.industrial.mid, 2.0, "industrial band mid 2.0");
const proxies = config.proxyFactors;
eq(proxies.residential.factor, 1.0, "proxy residential 1.0");
eq(proxies.commercial.factor, 1.7, "proxy commercial 1.7");
eq(proxies.agricultural.factor, 0.5, "proxy agricultural 0.5");
eq(proxies.industrial.factor, 1.35, "proxy industrial 1.35");
eq(config.cornerLotPct, 0.025, "corner lot +2.5%");
const floorKeys = (config.floors || []).map(f => f.key);
eq(JSON.stringify(floorKeys), JSON.stringify(["1", "2", "3plus"]), "floors keys 1/2/3plus");
/* Every storeys multiplier is neutral. The floor-area field is entered once and
   labelled "Total built-up area (sqm) / Across all storeys", so a per-storey factor
   on top of it is a double count. The reference form labels its equivalent "Total
   floor area across all storeys" and applies no storeys factor either. */
ok(config.floors.every(f => f.multiplier === 1),
  "no storeys multiplier: " + config.floors.map(f => f.key + "=" + f.multiplier).join(", "));
const ageKeys = (config.ageBands || []).map(b => b.key);
eq(JSON.stringify(ageKeys), JSON.stringify(["0-5", "6-10", "11-20", "21-30", "31plus"]), "age band keys");
ok((config.ageBands || []).every(b => b.midpoint > 0 && b.label), "age bands have midpoint + label");
ok(config.depreciation.lifeYears === 40 && config.depreciation.maxPct === 0.95, "depreciation 40yr cap 95%");
ok(Object.keys(config.features || {}).every(k => Number(config.features[k].cost) > 0), "features all positive cost");
ok([config.tax.cgtPct, config.tax.dstPct, config.tax.transferPct, config.tax.registrationPct].every(n => n > 0), "tax rates positive");

/* ---- depth-1 land math re-derived by hand ---- */
const balayan = JSON.parse(fs.readFileSync(path.join(muniDir, "balayan.json"), "utf8"));
const d1 = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "all street", classification: "CR", area: 200
});
eq(d1.available, true, "d1 available");
eq(d1.reference.value, 3500, "d1 BIR base 3500");
eq(d1.factors.proxyFactor, 1.7, "d1 proxy factor drained");
eq(d1.factors.bandMid, 2.5, "d1 band drained");
eq(d1.factors.regionalAdj, 1.0, "d1 regional adj drained");
eq(d1.landPerSqm, 14875, "d1 landPerSqm equals BIR × use × market-band factors");
eq(d1.landValue, 200 * 14875, "d1 landValue 2,975,000");
eq(d1.total, 2975000, "d1 factor-based total remains available without comparables");
eq(d1.perSqm, Math.round(2975000 / 200), "d1 perSqm");
eq(d1.low, Math.round(2975000 * 0.85), "d1 low 85%");
eq(d1.high, Math.round(2975000 * 1.30), "d1 high 130%");
eq(d1.use, "commercial", "d1 use commercial");
ok(core.integrityCheck(d1).ok, "d1 reconciles");

const corner = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "all street", classification: "CR", area: 200, corner: true
});
eq(corner.landPerSqm, 15247, "corner multiplier applies to uncapped factor calculation");
eq(corner.total, 200 * 15247, "corner total 3,049,400");

/* ---- house & lot build-up re-derived ---- */
const hl = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "all street", classification: "RR", area: 200,
  type: "house_lot", floorArea: 160, floors: "2", ageBand: "21-30", construction: "mixed_chb",
  features: ["pool", "solar"]
});
eq(hl.kind, "built", "hl kind built");
eq(hl.floorArea, 160, "hl explicit floorArea 160");
eq(hl.floorsMultiplier, 1, "hl storeys multiplier neutral - total floor area spans all storeys");
eq(hl.ageMidpoint, 25, "hl age midpoint 25");
eq(hl.depreciatedPct, 62.5, "hl dep 25/40 = 62.5%");
eq(hl.improvement, Math.round(16000 * 160 * (1 - 0.625)) + 700000, "hl improvement = rate x total floor area x (1 - dep) + features");
eq(hl.featuresTotal, 700000, "hl features 500000 + 200000");
eq(hl.total, hl.landValue + hl.improvement, "hl total = land + improvement");
ok(core.integrityCheck(hl).ok, "hl reconciles");

const hd = core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "all street", classification: "RR", area: 200,
  type: "house_lot"
});
eq(hd.floorArea, 120, "hd floor defaults to 60% of lot");

/* ---- tax math re-derived ---- */
const t = core.taxMath(config, 1000000);
eq(t.cgt, 60000, "tax CGT 6% of 1,000,000");
eq(t.dst, 15000, "tax DST 1.5%");
eq(t.transfer, 5000, "tax transfer 0.5%");
eq(t.registration, 1000, "tax registration 0.1%");
eq(t.total, 81000, "tax total sum");

/* ---- full dataset sweep: every municipality loads, never throws, honest fail-closed ---- */
let withData = 0;
let withAnyEstimate = 0;
let checkedAll = 0;
index.municipalities.forEach(m => {
  const slug = m.slug;
  let md = null;
  try { md = JSON.parse(fs.readFileSync(path.join(muniDir, slug + ".json"), "utf8")); } catch (e) {}
  ok(!!(md && md.barangays), "muni " + m.name + " data file loads", slug);
  if (!(md && md.barangays)) return;
  withData++;
  const bkeys = Object.keys(md.barangays);
  ok(bkeys.length > 0, "muni " + m.name + " has barangays", "n=" + bkeys.length);
  let anyAvailable = false;
  bkeys.slice(0, 8).forEach(b => {
    const classes = md.barangays[b].classifications || [];
    classes.slice(0, 4).forEach(cls => {
      const r = core.computeEstimate(config, index, md, {
        municipality: m.name, barangay: b, streetKey: "all street", classification: cls, area: 120
      });
      checkedAll++;
      if (r.available) {
        anyAvailable = true;
        // street-level or all-other-streets must recur; both are provable
        if (!core.integrityCheck(r).ok) { failures++; process.stdout.write("[FAIL] sweep reconcile " + m.name + "/" + b + "/" + cls + "\n"); }
        if (!(r.source.depth === 2 || r.fallbackNote.length > 0)) { /* depth1 has no note; ok */ }
      } else {
        if (r.reason !== "no-data") { failures++; process.stdout.write("[FAIL] sweep honest fail " + m.name + "/" + b + "/" + cls + " reason=" + r.reason + "\n"); }
      }
    });
  });
  if (anyAvailable) withAnyEstimate++;
  // depth-3/4 fallback on a made-up barangay must never throw and must be honest
  const fb = core.computeEstimate(config, index, md, {
    municipality: m.name, barangay: "NO SUCH BARANGAY", streetKey: "x", classification: "RR", area: 100
  });
  ok(fb.available === false || fb.source.depth >= 3, "muni " + m.name + " province/muni fallback honest", fb.reason || fb.source.depth);
});
ok(withData >= 34, "all 34 municipalities have loadable data", "loaded=" + withData);
ok(withAnyEstimate >= 34, "every municipality produces an estimate", "n=" + withAnyEstimate);
eq(checkedAll > 0, true, "sweep executed " + checkedAll + " computations");

/* ---- building condition shifts the effective age (2026-10-14) ---- */
const cond = c => core.computeEstimate(config, index, balayan, {
  municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "all street", classification: "RR", area: 200,
  type: "house_lot", floorArea: 120, floors: "1", ageBand: "11-20", construction: "mixed_chb", condition: c
});
const cUnknown = cond("unknown"), cGood = cond("good"), cNew = cond("new"), cRepair = cond("repair");
eq(cUnknown.ageMidpoint, 15, "condition unknown keeps the band midpoint");
eq(cGood.improvement, cUnknown.improvement, "condition good = unknown");
eq(cNew.ageMidpoint, 10, "new finish reads 5 years younger");
eq(cRepair.ageMidpoint, 25, "repairs needed reads 10 years older");
eq(cRepair.improvement, Math.round(16000 * 120 * (1 - 25 / 40)), "repair building = rate x floor x (1 - 25/40)");
ok(cNew.improvement > cUnknown.improvement && cUnknown.improvement > cRepair.improvement, "new > unknown > repair on the building");
eq(cNew.landValue, cRepair.landValue, "condition never moves the land");
eq(cond("new").ageMidpoint >= 0 && core.computeEstimate(config, index, balayan, { municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "all street", classification: "RR", area: 200, type: "house_lot", floorArea: 120, ageBand: "0-5", condition: "new" }).ageMidpoint, 0, "effective age never goes below 0");

/* ---- determinism ---- */
const a = JSON.stringify(core.computeEstimate(config, index, balayan, { municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "all street", classification: "CR", area: 300, corner: true, type: "house_lot", floorArea: 150, floors: "3plus", ageBand: "11-20", construction: "rca_steel", features: ["cctv"] }));
const b = JSON.stringify(core.computeEstimate(config, index, balayan, { municipality: "BALAYAN", barangay: "BACLARAN", streetKey: "all street", classification: "CR", area: 300, corner: true, type: "house_lot", floorArea: 150, floors: "3plus", ageBand: "11-20", construction: "rca_steel", features: ["cctv"] }));
eq(a === b, true, "identical inputs -> identical outputs (deterministic)");

/* ---- manifest vs live recomputed snapshot ---- */
const liveBarangays = index.municipalities.reduce((s, m) => s + m.barangayCount, 0);
eq(manifest.counts.barangays, liveBarangays, "manifest barangay count matches dataset");

process.stdout.write(failures === 0 ? "ALL GREEN (" + checked + " checks)\n" : "FAILED (" + failures + "/" + checked + ")\n");
process.exit(failures === 0 ? 0 : 1);
