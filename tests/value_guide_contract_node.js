"use strict";
/* One calculation contract for both surfaces.
 *
 * Unified 2026-10-14 (docs/plans/2026-10-14-value-guide-accuracy-plan.md, step 3):
 * the back-office guide now takes the public estimator's land and building, and
 * adds only its own question net on the land. The earlier three-way split this
 * file used to freeze is gone:
 *
 *   land        was reference 1.174x vs ramped band  -> both use the ramped band
 *   building    was 16,000 vs 25,000/sqm             -> both use 16,000 (CHB)
 *   storeys     was x1.00 vs x1.05                   -> removed earlier (Task 4)
 *
 * So the contract is now "they agree": same BIR rate, same building, and guide
 * land = estimator land x (1 + question net).
 */
const assert = require("assert"), fs = require("fs"), path = require("path");
const ROOT = process.cwd();
global.fetch = (u) => {
  const p = path.join(ROOT, String(u).split("?")[0]);
  return Promise.resolve({ ok: fs.existsSync(p), json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, "utf8"))) });
};
const EST = require(path.join(ROOT, "js/estimator.js"));
const FLOW = require(path.join(ROOT, "js/value_guide_flow.js"));
const cfg = require(path.join(ROOT, "data/zonal-config.json"));

let count = 0;
const pending = [];
function check(name, fn) { fn(); count++; console.log("[PASS] " + name); }
function checkAsync(name, fn) { pending.push(fn().then(() => { count++; console.log("[PASS] " + name); })); }

/* The property from the purchased report. One fixture, used by every check here, so
   a change that moves either surface moves it in a place this file names. */
const FORM = {
  municipality: "BAUAN", barangay: "POBLACION III",
  streetKey: "binay st ressurreccion st", classification: "RR",
  type: "house_lot", area: 100, floorArea: 120,
  construction: "mixed_chb", floors: "2", ageBand: "6-10",
  corner: false, features: [], landMethod: "factor",
  saleContext: "private-resale", effectivityDate: "2022-07-23",
  roadAccess: "50"
};

/* Builds model input the way js/app.js vgModelOpts() does. Kept as a copy rather
   than a require because vgModelOpts is a closure inside the app bundle and cannot
   be called from Node; if the two drift, this file's totals stop matching
   value_guide_flow_node.js's golden fixture, which is the signal we want. */
function modelOpts(f) {
  return Object.assign({}, FLOW.pickInputs(f), {
    purpose: f.purpose, type: f.type,
    municipality: f.municipality, barangay: f.barangay,
    streetKey: f.allOther ? "" : f.streetKey, allOther: !!f.allOther,
    effectivityDate: f.effectivityDate, classification: f.classification,
    area: Number(f.area) || 0,
    salePrice: f.salePrice === "" || f.salePrice == null ? null : Number(f.salePrice),
    saleContext: f.saleContext || "private-resale",
    developerFees: f.developerFees === "" || f.developerFees == null ? null : Number(f.developerFees),
    landMethod: f.landMethod || "factor",
    construction: f.construction, floorArea: Number(f.floorArea) || 0,
    floors: f.floors, ageBand: f.ageBand, features: f.features
  });
}

const REPORT = { birRate: 11500, birBase: 1150000, land: 1350000, building: 1536000, total: 2886000 };

/* ------------------------------------------------------- contract shape */

check("both surfaces expose the same result field names", () => {
  /* A shared contract means a renderer can read either result without asking which
     model produced it. The fields a consumer actually binds to are pinned here. */
  const required = ["available", "reason", "birZonalRatePerSqm", "birZonalValue", "birReferenceLabel",
    "landValue", "landPerSqm", "improvement", "total", "low", "high", "perSqm",
    "buildCostPerSqm", "floorsMultiplier", "depreciatedPct", "saleContext", "costOptions",
    "marketGuide", "marketGuideEstimate", "referenceVerification", "factorSettingsVersion",
    "calculationVersion", "dataVersion", "integrity", "type", "area"];
  return Promise.all([
    EST.estimate(modelOpts(FORM)),
    FLOW.compute(modelOpts(FORM), EST)
  ]).then(([storefront, guide]) => {
    [storefront, guide].forEach((r, i) => {
      const which = i ? "guide" : "storefront";
      required.forEach(k => assert.ok(Object.prototype.hasOwnProperty.call(r, k),
        which + " result is missing " + k));
    });
    /* floorsMultiplier exists on both precisely so the double count is visible on
       both surfaces rather than buried in one. */
    assert.strictEqual(guide.floorsMultiplier, 1, "the guide applies no storeys multiplier");
  });
});

check("customer and transaction metadata never moves the number", () => {
  /* The acceptance criterion, as an invariant. Name, purpose, contact details and
     asking-price scenarios shape the surrounding report and the transaction-cost
     panel. None of them may reach the valuation. */
  return Promise.all([
    EST.estimate(modelOpts(FORM)),
    FLOW.compute(modelOpts(FORM), EST)
  ]).then(([plainE, plainG]) => {
    const variants = [
      ["preparedFor", { preparedFor: "Ana Dela Cruz" }],
      ["customerName", { customerName: "Ana Dela Cruz" }],
      ["purpose", { purpose: "Buying" }],
      ["phone+email", { phone: "09171234567", email: "ana@example.com" }],
      ["salePrice", { salePrice: 3000000 }],
      ["developerFees", { developerFees: 250000 }]
    ];
    return Promise.all(variants.map(([name, extra]) => {
      const opts = modelOpts(Object.assign({}, FORM, extra));
      return Promise.all([EST.estimate(opts), FLOW.compute(opts, EST)]).then(([e, g]) => {
        assert.strictEqual(e.total, plainE.total, "storefront total moved with " + name);
        assert.strictEqual(g.total, plainG.total, "guide total moved with " + name);
      });
    }));
  });
});

check("a scenario that the model does not recognise is refused, not silently priced", () => {
  /* saleContext is validated. An unknown value returns unavailable rather than
     defaulting, which is correct: a guessed transaction basis would flow into the
     tax panel. But it must be a refusal with a reason, never a partial number. */
  return EST.estimate(modelOpts(Object.assign({}, FORM, { saleContext: "foreclosure" })))
    .then(r => {
      assert.strictEqual(r.available, false);
      assert.strictEqual(r.reason, "invalid-sale-context");
      assert.strictEqual(r.total, undefined, "a refused scenario must not carry a total");
    });
});

/* ------------------------------------------------- divergence, decomposed */

checkAsync("the two surfaces agree on BIR, land and building", () => {
  return Promise.all([
    EST.estimate(modelOpts(FORM)),
    FLOW.compute(modelOpts(FORM), EST)
  ]).then(async ([s, g]) => {
    /* They read the same BIR rate. If this ever fails the divergence below has a
       fourth cause and the decomposition is no longer complete. */
    assert.strictEqual(s.birZonalRatePerSqm, g.birZonalRatePerSqm, "BIR rate disagreement");
    assert.strictEqual(s.birZonalRatePerSqm, REPORT.birRate, "BIR rate differs from the report");

    /* Land: the storefront now applies the rate-ramped residential band
       (marketBand.rateRamp) instead of a flat 2.5. Binay St is 11,500/sqm, so the
       multiplier descends toward the 1.4 floor: mid - t*(mid-floor) with
       t = (11500-2000)/(25000-2000) = 0.4130 -> 2.0457. The ramp is what makes a
       beachfront street (25,000/sqm, already premium in the BIR rate) not get
       charged the location premium twice. */
    const rampMid = (mid, rate, lo, hi, floor) =>
      rate <= lo ? mid : rate >= hi ? floor : mid - ((rate - lo) / (hi - lo)) * (mid - floor);
    const expectedMult = rampMid(2.5, 11500, 2000, 25000, 1.4);
    assert.ok(Math.abs(s.appliedMultiple - expectedMult) < 1e-6,
      "storefront residential multiplier is not the ramped value (" + s.appliedMultiple + " vs " + expectedMult + ")");
    assert.strictEqual(s.landValue, Math.round(REPORT.birBase * s.appliedMultiple),
      "storefront land is not BIR x the ramped multiplier");
    assert.strictEqual(g.landValue, Math.round(s.landValue * (1 + g.referenceModel.net)),
      "guide land is not the storefront land x (1 + question net)");
    /* A high-BIR street must sit at the ramp floor, not the flat 2.5. */
    const beach = await EST.estimate(modelOpts(Object.assign({}, FORM, {
      municipality: "SAN JUAN", barangay: "LAIYA APLAYA",
      streetKey: "playa laiya phase 3f 4 near beachfront"
    })));
    assert.ok(Math.abs(beach.appliedMultiple - 1.4) < 1e-6,
      "a 25,000/sqm beachfront street is not at the ramp floor (" + beach.appliedMultiple + ")");

    /* Building: one rate table (CHB 16,000/sqm), identical result. */
    assert.strictEqual(s.buildCostPerSqm, 16000, "CHB rate moved");
    assert.strictEqual(g.buildCostPerSqm, s.buildCostPerSqm, "the two surfaces use different building rates");
    assert.strictEqual(g.improvement, s.improvement, "the building values disagree");
  });
});

check("no surface prices storeys twice on an area already measured across all of them", () => {
  /* Removed in Task 4. Floor area is entered once and labelled "Total built-up
     area (sqm) / Across all storeys"; the config then multiplied it by 1.05 for two
     storeys and 1.10 for three, charging the same square metres a second time. On
     the report fixture that was 120,000.

     The reference labels its field "Total floor area across all storeys" and applies
     no storeys factor, and our guide already set floorsMultiplier = 1.

     If a genuine multi-storey premium is ever justified, it belongs in the rate
     table as a per-storey construction argument, not as a multiply over a total. */
  assert.strictEqual(FLOW.MODEL.floorsMultiplier, undefined,
    "the guide model should not declare a storeys multiplier at all");
  assert.ok(cfg.floors.every(f => f.multiplier === 1),
    "storefront table still prices storeys: " +
      cfg.floors.map(f => f.key + "=" + f.multiplier).join(", "));
  /* It must also be gone from the reader-facing copy, not merely neutralised. A
     disclosed "x1.05" that no longer applies is worse than never printing it. */
  const src = fs.readFileSync(path.join(ROOT, "js/estimator.js"), "utf8");
  assert.ok(src.indexOf('"Storeys: <b>') < 0, "the report still prints a storeys multiplier line");
  assert.ok(src.indexOf("storeys also apply a cost factor") < 0, "the field hint still promises a storeys factor");
});

check("the report reconciliation is a separate table, never folded into a multiplier", () => {
  /* docs/plans/... Task 5 acceptance: the benchmark reports a difference, it does
     not tune a global constant to make it zero. The report's implied 1.174 exists in
     the guide as MARKET_IND, which is fine because the guide WAS the reference-aligned
     model until 2026-10-14. */
  /* 2026-10-14: the reference's 1.174 is no longer a constant anywhere. */
  assert.strictEqual(FLOW.MODEL.MARKET_IND, undefined, "the reference multiplier is back as a constant");
  /* And the benchmark data must remain non-numerical, in both its homes. */
  const BM = require(path.join(ROOT, "data/market-benchmarks.json"));
  assert.ok(BM.records.every(r => r.numericalAllowed === false));
  const FX = require(path.join(ROOT, "tests/fixtures/value-guide-reference-bauan.json"));
  assert.ok(FX._referenceIsNotMarketEvidence, "the reference fixture still records its non-market status");
});

check("a vacant lot never inherits a building value", () => {
  /* Plan review case #1. The kind flag gates the whole building block, so this must
     hold on both surfaces regardless of what floorArea is passed in. */
  const vacant = Object.assign({}, FORM, { type: "vacant_lot", floorArea: 120 });
  return Promise.all([
    EST.estimate(modelOpts(vacant)),
    FLOW.compute(modelOpts(vacant), EST)
  ]).then(([s, g]) => {
    assert.strictEqual(s.improvement, 0, "storefront gave a vacant lot a building");
    assert.strictEqual(g.improvement, 0, "the guide gave a vacant lot a building");
    assert.strictEqual(s.total, s.landValue, "storefront total is not land-only");
    assert.strictEqual(g.total, g.landValue, "guide total is not land-only");
  });
});

check("both surfaces reconcile internally: components sum to the total", () => {
  return Promise.all([
    EST.estimate(modelOpts(FORM)),
    FLOW.compute(modelOpts(FORM), EST)
  ]).then(([s, g]) => {
    [s, g].forEach((r, i) => {
      const which = i ? "guide" : "storefront";
      assert.ok(r.integrity && r.integrity.ok, which + " integrity check failed: " + JSON.stringify(r.integrity));
      /* The range is a disclosed scenario band, not a confidence interval. */
      assert.ok(r.low < r.total && r.total < r.high, which + " total is not inside its own range");
    });
  });
});

check("the model version is reported on every result, so a number can be traced back", () => {
  return EST.estimate(modelOpts(FORM)).then(r => {
    assert.ok(r.calculationVersion, "no calculation version");
    assert.ok(r.dataVersion, "no data version");
    assert.ok(r.factorSettingsVersion, "no factor-settings version");
  });
});

Promise.all(pending).then(function () {
  console.log("ALL GREEN (" + count + " checks)");
}).catch(function (err) {
  console.error("FAILED:", err && err.stack || err);
  process.exit(1);
});