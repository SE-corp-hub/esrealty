"use strict";
/* The purchased reference report, as a benchmark.
 *
 * Task 5 acceptance: "the benchmark reports the difference between each model and
 * the reference. It does not tune a universal multiplier to match this single
 * property."
 *
 * So this file compares, it does not reconcile. Both surfaces are computed from the
 * report's own inputs and printed against it, land and building separately. Nothing
 * here asserts a model is right.
 *
 * What this cannot do: measure accuracy. There is one report, it is a BIR-referenced
 * AVM that admits it has no comparables for Bauan, and its own text contradicts its
 * own arithmetic in five places (recorded in the fixture). Agreement with it is a
 * consistency check on our arithmetic, not evidence about the market.
 */
const assert = require("assert"), fs = require("fs"), path = require("path");
const ROOT = process.cwd();
global.fetch = (u) => {
  const p = path.join(ROOT, String(u).split("?")[0]);
  return Promise.resolve({ ok: fs.existsSync(p), json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, "utf8"))) });
};
const EST = require(path.join(ROOT, "js/estimator.js"));
const FLOW = require(path.join(ROOT, "js/value_guide_flow.js"));
const FX = require(path.join(ROOT, "tests/fixtures/value-guide-reference-bauan.json"));

let count = 0;
const pending = [];
function check(name, fn) { fn(); count++; console.log("[PASS] " + name); }
function checkAsync(name, fn) { pending.push(fn().then(() => { count++; console.log("[PASS] " + name); })); }

const money = n => "PHP " + Math.round(n).toLocaleString("en-PH");
const pct = n => (n > 0 ? "+" : "") + n.toFixed(1) + "%";

/* The guide's model input, matching js/app.js vgModelOpts(). */
function guideOpts(f) {
  return Object.assign({}, FLOW.pickInputs(f), {
    purpose: f.purpose, type: f.type,
    municipality: f.municipality, barangay: f.barangay,
    streetKey: f.allOther ? "" : f.streetKey, allOther: !!f.allOther,
    effectivityDate: f.effectivityDate, classification: f.classification,
    area: Number(f.area) || 0,
    salePrice: null, developerFees: null,
    saleContext: f.saleContext || "private-resale",
    landMethod: f.landMethod || "factor",
    construction: f.construction, floorArea: Number(f.floorArea) || 0,
    floors: f.floors, ageBand: f.ageBand, features: f.features
  });
}

/* ------------------------------------------------------- the report reconciles */

check("the fixture's own arithmetic holds", () => {
  const v = FX.reported;
  assert.strictEqual(v.birBase, v.birZonalRatePerSqm * v.lotArea, "BIR base = rate x lot area");
  assert.strictEqual(v.rcn, v.rcnPerSqm * FX.inputs.floorArea, "RCN = rate x floor area");
  assert.strictEqual(v.depreciationAmount, v.rcn * v.accumulatedDepreciationPct / 100);
  assert.strictEqual(v.buildingValue, v.rcn - v.depreciationAmount, "depreciated building");
  assert.strictEqual(v.total, v.landValue + v.buildingValue, "land + building = total");
  assert.strictEqual(v.rangeLow, Math.round(v.total * 0.85), "low = total x 85%");
  assert.strictEqual(v.rangeHigh, Math.round(v.total * 1.30), "high = total x 130%");
  assert.ok(Math.abs(FX.derived.landMultiplierImplied - v.landValue / v.birBase) < 1e-6,
    "the recorded implied multiplier does not match land / BIR base");
});

check("the report's own text is recorded as contradicting its own numbers", () => {
  /* Guards against someone tidying the fixture into a clean citation later. */
  assert.ok(FX._referenceIsNotMarketEvidence.length > 200, "the contradictions are still recorded");
  const listed = FX.derived.listedCategoryPctSum;
  assert.notStrictEqual(listed, FX.reported.claimedNetAdjustmentPct,
    "the claimed net adjustment is being recorded as equal to the sum of the printed rows, which it is not");
  assert.strictEqual(FX.derived.rangeIsTotalTimes085And130, true);
});

check("the guide no longer copies the report's implied multiplier", () => {
  /* 2026-10-14: MARKET_IND (1.174) was retired. The report's own vacant-lot twin
     valued the same lot at 2.5x, and 1.174x priced 2026-10 Batangas homes ~32%
     under asking. The guide now uses the public estimator's land and building. */
  assert.strictEqual(FLOW.MODEL.MARKET_IND, undefined, "MARKET_IND is back");
});

/* ------------------------------------------- the comparison, printed and pinned */

checkAsync("both surfaces are computed from the report's own inputs and differ from it", () => {
  const f = FX.inputs, v = FX.reported;
  return Promise.all([
    EST.estimate(guideOpts(f)),
    FLOW.compute(guideOpts(f), EST)
  ]).then(([storefront, guide]) => {
    const rows = [
      ["BIR rate /sqm", v.birZonalRatePerSqm, guide.birZonalRatePerSqm, storefront.birZonalRatePerSqm],
      ["Land", v.landValue, guide.landValue, storefront.landValue],
      ["Building", v.buildingValue, guide.improvement, storefront.improvement],
      ["Total", v.total, guide.total, storefront.total],
      ["Range low", v.rangeLow, guide.low, storefront.low],
      ["Range high", v.rangeHigh, guide.high, storefront.high]
    ];
    const out = rows.map(r => r[0].padEnd(11) +
      "report " + money(r[1]).padStart(13) +
      "   guide " + money(r[2]).padStart(13) + " " + pct((r[2] / r[1] - 1) * 100).padStart(7) +
      "   storefront " + money(r[3]).padStart(13) + " " + pct((r[3] / r[1] - 1) * 100).padStart(7)).join("\n");
    console.log("\n=== reference benchmark: " + FX._sourceLocation + " ===\n" + out + "\n");

    /* Both surfaces must read the report's BIR rate. This is the one agreement we
       can demand, because it is a lookup rather than a judgement. */
    assert.strictEqual(guide.birZonalRatePerSqm, v.birZonalRatePerSqm, "guide BIR rate");
    assert.strictEqual(storefront.birZonalRatePerSqm, v.birZonalRatePerSqm, "storefront BIR rate");

    /* One engine: the guide's land is the public calculator's land with the
       guide's question net applied, and the building is identical. */
    assert.strictEqual(guide.landValue, Math.round(storefront.landValue * (1 + guide.referenceModel.net)),
      "guide land is not storefront land x (1 + question net)");
    assert.strictEqual(guide.improvement, storefront.improvement, "guide building != storefront building");

    /* The building now uses the same 16,000/sqm rate and 20% depreciation the
       report printed, so the building lines agree exactly; the remaining gap is
       land only (the report's 1.174x vs our ramped band). */
    assert.strictEqual(storefront.improvement, v.buildingValue, "building no longer matches the report's 16,000 x 120 x 0.8");
  });
});

checkAsync("the land multiplier choice, and nothing else, explains the residual gap", () => {
  const f = FX.inputs, v = FX.reported;
  return EST.estimate(guideOpts(f)).then((storefront) => {
    /* Land: BIR base x the RAMPED residential band (Binay St is 11,500/sqm, so
       2.5 descends toward the 1.4 floor: 2.0457). */
    const rampMid = (mid, rate) => rate <= 2000 ? mid : rate >= 25000 ? 1.4 : mid - ((rate - 2000) / 23000) * (mid - 1.4);
    const expected = Math.round(FX.reported.birBase * rampMid(2.5, FX.reported.birZonalRatePerSqm));
    assert.strictEqual(expected, storefront.landValue,
      "the storefront land is not BIR base x the ramped band (" + expected + " vs " + storefront.landValue + ")");
    const dep = 1 - FX.reported.accumulatedDepreciationPct / 100;
    assert.strictEqual(storefront.improvement, Math.round(storefront.buildCostPerSqm * FX.inputs.floorArea * dep),
      "the building is not rate x floor area x (1 - dep)");
    /* So the whole total gap vs the report is the land line. */
    assert.strictEqual(storefront.total - v.total, storefront.landValue - v.landValue,
      "a second cause of difference has appeared besides land");
  });
});

check("no benchmark or reference figure reaches a formula", () => {
  /* estimator.js may LOAD market-benchmarks.json as display context (the result
     screen cites researched asking prices) - that is a read for the reader, not a
     formula input, and market_benchmarks_node.js asserts the compute path never
     touches it. The other files may not read it at all. The reference report
     fixture and the report block are never loaded by any of these. */
  ["js/value_guide_flow.js", "js/core.js", "js/storefront.js", "js/app.js"].forEach(f => {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(src.indexOf("market-benchmarks") < 0, f + " must not read the benchmark file");
    assert.ok(src.indexOf("value-guide-reference-bauan") < 0, f + " must not read the report fixture");
    assert.ok(src.indexOf("_referenceBenchmark") < 0, f + " must not read the report block");
  });
  /* estimator.js: the benchmark file exists only as a display feed; the report
     fixture never. */
  const est = fs.readFileSync(path.join(ROOT, "js/estimator.js"), "utf8");
  const loads = est.match(/loadJSON\("data\/market-benchmarks\.json"\)/g) || [];
  assert.strictEqual(loads.length, 1, "estimator loads the benchmark file exactly once, as display data");
  assert.ok(est.indexOf("value-guide-reference-bauan") < 0, "estimator must not read the report fixture");
  assert.ok(est.indexOf("_referenceBenchmark") < 0, "estimator must not read the report block");
});

Promise.all(pending).then(function () {
  console.log("ALL GREEN (" + count + " checks)");
}).catch(function (err) {
  console.error("FAILED:", err && err.stack || err);
  process.exit(1);
});