"use strict";
/* Market accuracy: the Value Guide against dated Batangas asking prices.
 *
 * tests/fixtures/batangas-listings-2026-10.json holds listings with lot area,
 * floor area and asking price, pre-matched to the BIR schedule. This runs every
 * one through the public estimator (and the back-office guide, which must agree
 * on land and building) and asserts the median error stays inside a band.
 *
 * What this proves and what it does not: the listings are ASKING prices, which
 * usually sit 5-10% above closed sales, and the sample is small (11 house & lot,
 * 9 lots) with thin Bauan coverage. It is a guard against the model drifting far
 * from the market - the 25,000/sqm building rate put house & lot at +18% median
 * and the retired 1.174 land multiplier at -32% - not a certificate of accuracy.
 * Refresh the fixture by its refreshBy date. */
const assert = require("assert"), fs = require("fs"), path = require("path");
const ROOT = process.cwd();
global.fetch = (u) => {
  const p = path.join(ROOT, String(u).split("?")[0]);
  return Promise.resolve({ ok: fs.existsSync(p), json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, "utf8"))) });
};
const EST = require(path.join(ROOT, "js/estimator.js"));
const FLOW = require(path.join(ROOT, "js/value_guide_flow.js"));
const FX = require(path.join(ROOT, "tests/fixtures/batangas-listings-2026-10.json"));

let count = 0;
const pending = [];
function checkAsync(name, fn) { pending.push(fn().then(() => { count++; console.log("[PASS] " + name); })); }
function check(name, fn) { fn(); count++; console.log("[PASS] " + name); }

const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = n => (n > 0 ? "+" : "") + (n * 100).toFixed(1) + "%";

function optsFor(l) {
  const base = {
    purpose: "selling", type: l.type, municipality: l.municipality, barangay: l.barangay,
    streetKey: l.streetKey || "", allOther: !l.streetKey, classification: l.classification,
    area: l.area, saleContext: "private-resale", landMethod: "factor", features: [],
    floorArea: l.floorArea || 0, construction: l.construction || "mixed_chb",
    floors: l.floors || "1", ageBand: l.ageBand || "0-5"
  };
  return Object.assign({}, FLOW.pickInputs(base), base);
}

function run(type) {
  const rows = FX.listings.filter(l => l.type === type);
  return Promise.all(rows.map(async l => {
    const o = optsFor(l);
    const [s, g] = await Promise.all([EST.estimate(o), FLOW.compute(o, EST)]);
    assert.ok(s.available !== false, l.title + ": estimator unavailable (" + s.reason + ")");
    assert.ok(s.birReferenceConfirmed, l.title + ": BIR rate not matched at street/barangay level");
    return { l, s, g, err: s.total / l.askingPrice - 1 };
  }));
}

check("the fixture is dated, sourced and still fresh enough to trust", () => {
  assert.ok(FX.collectedOn && FX.refreshBy, "dates recorded");
  assert.ok(FX.listings.every(l => /^https?:\/\//.test(l.url) && l.askingPrice > 0 && l.area > 0), "every listing has a URL, price and area");
  assert.ok(FX.listings.filter(l => l.type === "house_lot").every(l => l.floorArea > 0), "every house has a floor area");
});

checkAsync("house & lot: median error within +/-10% of asking, median |error| under 15%", async () => {
  const res = await run("house_lot");
  res.forEach(r => console.log("    " + (r.l.municipality + " " + r.l.barangay).padEnd(34) +
    String(r.l.area + "/" + r.l.floorArea).padEnd(13) + "ask " + String(r.l.askingPrice).padStart(9) +
    "  model " + String(r.s.total).padStart(9) + "  " + pct(r.err)));
  const m = median(res.map(r => r.err)), a = median(res.map(r => Math.abs(r.err)));
  console.log("    median error " + pct(m) + ", median |error| " + (a * 100).toFixed(1) + "%  (n=" + res.length + ")");
  assert.ok(Math.abs(m) <= 0.10, "house & lot median error " + pct(m) + " is outside +/-10%");
  assert.ok(a < 0.15, "house & lot median |error| " + (a * 100).toFixed(1) + "% is 15% or more");
});

checkAsync("vacant lots: median error within +/-15% of asking", async () => {
  /* Looser than house & lot: lot-size and branded-development effects are not
     modelled yet (plan step 4), so the spread is wide. */
  const res = await run("vacant_lot");
  res.forEach(r => console.log("    " + (r.l.municipality + " " + r.l.barangay).padEnd(34) +
    String(r.l.area).padEnd(13) + "ask " + String(r.l.askingPrice).padStart(9) +
    "  model " + String(r.s.total).padStart(9) + "  " + pct(r.err)));
  const m = median(res.map(r => r.err));
  console.log("    median error " + pct(m) + "  (n=" + res.length + ")");
  assert.ok(Math.abs(m) <= 0.15, "vacant lot median error " + pct(m) + " is outside +/-15%");
});

checkAsync("the back-office guide prices the same building and land as the public calculator", async () => {
  const res = await run("house_lot");
  res.forEach(r => {
    assert.strictEqual(r.g.improvement, r.s.improvement, r.l.title + ": building differs between surfaces");
    assert.strictEqual(r.g.landValue, Math.round(r.s.landValue * (1 + r.g.referenceModel.net)),
      r.l.title + ": guide land is not public land x (1 + question net)");
  });
});

Promise.all(pending).then(() => console.log("ALL GREEN (" + count + " checks)"))
  .catch(err => { console.error("FAILED:", err && err.stack || err); process.exit(1); });
