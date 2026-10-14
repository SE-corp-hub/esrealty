"use strict";
/* Calibration: does the model land near the BIR zonal distribution?
 *
 * There is no market-price data in this repo or in the listings API (3 records,
 * all Caloocan, none with a lot area), so this cannot validate the estimate
 * against what properties actually sell for. What it can do is measure how far
 * the multipliers carry a value off the BIR base for that class and municipality,
 * which is the honest thing to calibrate. The threshold is recorded in the
 * fixture file from a measured run, never chosen in advance. */
const assert = require("assert"), fs = require("fs"), path = require("path");
const ROOT = process.cwd();
global.fetch = (u) => {
  const p = path.join(ROOT, String(u).split("?")[0]);
  return Promise.resolve({ ok: fs.existsSync(p), json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, "utf8"))) });
};
const EST = require(path.join(ROOT, "js/estimator.js"));
const F = require(path.join(ROOT, "js/value_guide_flow.js"));
const zonal = JSON.parse(fs.readFileSync(path.join(ROOT, "data/batangas-zonal.json"), "utf8").replace(/^\uFEFF/, ""));
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/value-guide-calibration.json"), "utf8"));

let count = 0;
async function check(name, fn) { await fn(); count++; console.log("[PASS] " + name); }

function mun(slug) { return zonal.municipalities.filter(m => m.slug === slug)[0]; }

(async () => {

await check("every fixture resolves against the BIR data", async () => {
  await EST.loadData();
  for (const f of FIX.fixtures) {
    const m = mun(f.municipality.toLowerCase().replace(/\s+/g, "-"));
    assert.ok(m, f.id + ": municipality " + f.municipality + " not in batangas-zonal.json");
    assert.ok(m.byClass[f.classification] && m.byClass[f.classification].p50 > 0,
      f.id + ": " + f.classification + " has no p50 in " + f.municipality);
    const r = await F.compute(Object.assign({}, baseFor(f), F.pickInputs({})), EST);
    assert.ok(r.available !== false, f.id + " unavailable: " + (r.reason || ""));
  }
});

await check("with no answers the guide is the public estimator's land plus the derived recency net", async () => {
  /* 2026-10-14: MARKET_IND (1.174) was retired in favour of one engine. The guide
     now takes the public estimator's land and applies only its question net
     (with no answers, just the derived zonal-recency row). */
  assert.strictEqual(F.MODEL.MARKET_IND, undefined, "MARKET_IND is back");
  const e = await EST.estimate(Object.assign({}, baseFor({ municipality: "BAUAN", classification: "RR" })));
  const r = await F.compute(Object.assign({}, baseFor({ municipality: "BAUAN", classification: "RR" }), F.pickInputs({})), EST);
  assert.strictEqual(r.landValue, Math.round(e.landValue * (1 + r.referenceModel.net)),
    "guide land is not estimator land x (1 + net)");
  assert.ok(/cannot|does not measure/i.test(FIX._what_this_does_not_prove),
    "the fixture file states what the harness cannot prove");
});

await check("the BIR-distance threshold is retired in favour of market evidence", () => {
  /* Distance from the BIR p50 measured the multiplier, not accuracy. Accuracy is
     now asserted against dated Batangas listings in
     tests/value_guide_market_accuracy_node.js. */
  assert.strictEqual(FIX.threshold, null, "threshold should be retired (null)");
  assert.ok(fs.existsSync(path.join(ROOT, "tests/value_guide_market_accuracy_node.js")), "the market accuracy test exists");
});

await check("the BIR-distance measurement still runs (context only)", async () => {
  const devs = [];
  let within = 0, n = 0;
  for (const f of FIX.fixtures) {
    const m = mun(f.municipality.toLowerCase().replace(/\s+/g, "-"));
    const dist = m.byClass[f.classification];
    for (const area of FIX.areas) {
      const r = await F.compute(Object.assign({}, baseFor(f, area), F.pickInputs({})), EST);
      const dev = Math.abs(r.perSqm - dist.p50) / dist.p50;
      devs.push(dev);
      n++;
      if (r.perSqm >= dist.p25 && r.perSqm <= dist.p75) within++;
    }
  }
  devs.sort((a, b) => a - b);
  const median = devs[Math.floor(devs.length / 2)];
  const share = within / n;
  console.log("    median |model - p50| = " + (median * 100).toFixed(1) + "%");
  console.log("    within p25-p75       = " + (share * 100).toFixed(1) + "%  (" + within + "/" + n + ")");
  /* Printed for context only; see the retired-threshold check above. */
  assert.ok(n > 0, "no fixture was measured");
});

await check("the fixtures span more than one price band", () => {
  /* A threshold measured on one band proves nothing. Balayan RR p50 3000 and
     Batangas City RR p50 6000 are the same class at two prices. */
  const rr = FIX.fixtures.filter(f => f.classification === "RR")
    .map(f => mun(f.municipality.toLowerCase().replace(/\s+/g, "-")).byClass.RR.p50);
  assert.ok(new Set(rr).size > 1, "RR fixtures do not all share a p50: " + rr.join(", "));
  assert.ok(new Set(FIX.fixtures.map(f => f.classification)).size >= 4, "all four classes exercised");
  assert.ok(FIX.areas.length >= 2, "more than one lot size");
});

console.log("ALL GREEN (" + count + " checks)");
})().catch(error => { console.error(error); process.exitCode = 1; });

function baseFor(f, area) {
  return { municipality: f.municipality, barangay: "POBLACION III", streetKey: "",
    allOther: true, classification: f.classification, type: "vacant_lot",
    area: area || FIX.areas[0], saleContext: "private-resale" };
}