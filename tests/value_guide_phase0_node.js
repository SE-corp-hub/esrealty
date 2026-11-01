"use strict";
/* Phase 0 of the 2026-11 Value Guide accuracy plan (docs/plans/2026-11-01-value-guide-phase-0.md):
 *   - the asking box is labelled for what it shows (guide + premium), on both surfaces
 *   - the back-office factor panel and the listing API default to the LIVE calculator
 *     factors, so one "Approve and publish" can no longer republish the September 2026 set
 *   - the range is called a planning range everywhere
 *   - registration follows the LRA schedule of fees; city transfer tax is shown at 0.75%
 *   - the Estate scenario taxes the statutory basis (zonal land + house), with the market
 *     figure as the upper case
 * Each check names the regression it guards. */
const assert = require("assert"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
global.fetch = u => { const p = path.join(ROOT, String(u).split("?")[0]); return Promise.resolve({ ok: fs.existsSync(p), json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, "utf8"))) }); };
const EST = require(path.join(ROOT, "js/estimator.js"));
const FLOW = require(path.join(ROOT, "js/value_guide_flow.js"));
const FIN = require(path.join(ROOT, "js/value_guide_finance.js"));
const TAX = require(path.join(ROOT, "js/value_guide_tax.js"));
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const ZONAL = JSON.parse(read("data/zonal-config.json"));
const APP = read("js/app.js"), API = read("supabase/functions/listing-api/index.ts"), ESTSRC = read("js/estimator.js"), SF = read("js/storefront.js");

let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? " — " + detail : "")); passed++; console.log("[PASS] " + name); };
const eq = (name, a, b) => ok(name, a === b, "got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

/* ---------- registration fee: LRA schedule ---------- */
[[1, 21], [500, 21], [501, 30], [6000, 120], [6001, 144], [10000, 168], [30000, 408], [35000, 450], [100000, 996],
 [110000, 1056], [500000, 3396], [520000, 3486], [1000000, 5646], [1700000, 8796], [1700001, 8886], [1720000, 8886],
 [3888500, 18696], [5000000, 23646]].forEach(([v, fee]) => eq("LRA registration fee at " + v.toLocaleString("en-US"), FIN.lraRegistrationFee(v), fee));
eq("no value, no fee", FIN.lraRegistrationFee(0), 0);
let prev = 0, monotonic = true;
for (let v = 100; v <= 6000000; v += 100) { const f = FIN.lraRegistrationFee(v); if (f < prev) monotonic = false; prev = f; }
ok("the schedule never goes down as the value rises", monotonic);
eq("zonal-config selects the LRA schedule", ZONAL.tax.registrationMethod, "lra-schedule");
const t1m = FIN.transaction(ZONAL, 1000000);
eq("transaction() uses the schedule with the live config", t1m.registration, 5646);
eq("...and says so", t1m.registrationMethod, "lra-schedule");
eq("the flat 0.1% stays available as a fallback", FIN.transaction({ tax: { registrationPct: 0.001 } }, 1000000).registration, 1000);

/* ---------- transfer tax: city ceiling ---------- */
["BATANGAS CITY", "LIPA CITY", "TANAUAN CITY", "STO. TOMAS CITY", "CALACA"].forEach(c => ok("config lists " + c + " as a city", ZONAL.tax.cities.indexOf(c) >= 0));
const lipa = FIN.transaction(ZONAL, 4000000, { municipality: "Lipa City" });
eq("a city sale shows transfer tax at the 0.75% ceiling", lipa.transfer, 30000);
eq("...labelled as the city basis", lipa.transferBasis, "city");
const bauan = FIN.transaction(ZONAL, 4000000, { municipality: "BAUAN" });
eq("a municipality keeps 0.5%", bauan.transfer, 20000);
eq("...labelled as the provincial basis", bauan.transferBasis, "province");
eq("no municipality given: provincial rate", FIN.transaction(ZONAL, 4000000).transfer, 20000);

/* ---------- asking price: one premium, one label, both surfaces ---------- */
eq("the asking premium lives in the config", ZONAL.askingPrice.premiumPct, 7);
ok("the report no longer labels the +7% figure as the 130% scenario", !/Upper planning scenario/.test(ESTSRC));
ok("the asking box is labelled as a suggested asking price", /Suggested asking price/.test(ESTSRC));
ok("the quick estimate calls the band a planning range, not a likely range", !/Likely range/.test(ESTSRC) && !/likely range/.test(SF));
ok("the glossary calls it a planning band, not where a sale usually lands", /planning band, not a forecast/.test(ESTSRC) && !/Where a sale would usually land/.test(ESTSRC));

const BAUAN = { purpose: "Selling", type: "house_lot", municipality: "BAUAN", barangay: "POBLACION III", streetKey: "binay st ressurreccion st",
  classification: "RR", area: 100, floorArea: 120, construction: "mixed_chb", floors: "2", ageBand: "6-10", landMethod: "factor", saleContext: "private-resale", features: [] };
(async () => {
  const pub = await EST.estimate(BAUAN);
  ok("the reference property still prices", pub.available !== false, pub.reason);
  eq("public asking premium is the configured 7%", pub.askingPremiumPct, 7);
  eq("public asking = total x 1.07", pub.recommendedAskingPrice, Math.round(pub.total * 1.07));
  ok("...and is not the 130% top of the range", pub.recommendedAskingPrice !== pub.high);
  const bo = await FLOW.compute(Object.assign({}, FLOW.pickInputs(BAUAN), BAUAN), EST);
  ok("the back-office guide prices the same property", bo.available !== false, bo.reason);
  eq("back office asking premium matches", bo.askingPremiumPct, 7);
  eq("back office asking = its total x 1.07, no longer the 130% figure", bo.recommendedAskingPrice, Math.round(bo.total * 1.07));
  ok("...and differs from r.high", bo.recommendedAskingPrice !== bo.high);

  /* ---------- transaction panel inputs from the estimate ---------- */
  const costs = EST.core.costsFor(pub, ZONAL);
  eq("the public cost panel registers at the LRA schedule", costs.registration, FIN.lraRegistrationFee(costs.base));
  eq("Bauan is a municipality: 0.5% transfer", costs.transferBasis, "province");
  const lipaEst = await EST.estimate(Object.assign({}, BAUAN, { municipality: "LIPA CITY", barangay: "SABANG", streetKey: "", allOther: true }));
  if (lipaEst.available !== false) eq("a Lipa estimate feeds the city transfer rate", EST.core.costsFor(lipaEst, ZONAL).transferBasis, "city");

  /* ---------- estate: statutory basis first, market as the upper case ---------- */
  const ref = await TAX.reference();
  const inh = TAX.inheritance({ birZonalValue: 1200000, improvement: 3750000, marketGuideEstimate: 6831842 }, ref);
  eq("statutory gross = zonal land + house at depreciated cost", inh.grossOnStatutoryBasis, 4950000);
  eq("...which is below the 5M standard deduction: no tax on the statutory basis", inh.onStatutoryBasis.tax, 0);
  eq("the market basis is still shown as the upper case", inh.onMarketBasis.tax, 109911);
  eq("likelyPayable follows the statutory basis", inh.likelyPayable, false);
  eq("...and the market-basis exposure is flagged separately", inh.possiblyPayableOnMarketBasis, true);
  const sell = TAX.sellingCosts({ municipality: "LIPA CITY", marketGuideEstimate: 4000000, birZonalValue: 1000000 }, ref);
  const regItem = sell.items.find(i => i.key === "registration"), trItem = sell.items.find(i => i.key === "transfer");
  eq("the PDF's registration line follows the LRA schedule", regItem.amount, FIN.lraRegistrationFee(sell.taxBase));
  eq("...and says so", regItem.rateLabel, "LRA schedule");
  eq("the PDF's transfer line shows the city ceiling for Lipa", trItem.amount, Math.round(sell.taxBase * 0.0075));
  ok("...labelled as such", /up to 0\.75% \(city\)/.test(trItem.rateLabel), trItem.rateLabel);
  ok("the public Estate decision taxes the statutory basis and names the market case", /statutoryBase/.test(ESTSRC) && /On the market guide instead/.test(ESTSRC));

  /* ---------- back-office factor defaults = live calculator ---------- */
  const live = { proxy: {}, mid: {}, build: {} };
  ["residential", "commercial", "agricultural", "industrial"].forEach(k => { live.proxy[k] = ZONAL.proxyFactors[k].factor; live.mid[k] = ZONAL.marketBand.bands[k].mid; });
  ["wood_prefab", "mixed_chb", "rca_steel"].forEach(k => { live.build[k] = ZONAL.construction[k].costPerSqm; });
  const appLit = /function valueGuideLiveDefaults\(\) \{\s*return (\{[\s\S]*?\});\s*\}/.exec(APP);
  ok("js/app.js defines the live defaults in one place", !!appLit);
  const appDef = new Function("return " + appLit[1])();
  const apiLit = /const VALUE_GUIDE_LIVE_FACTORS = (\{[\s\S]*?\n\});/.exec(API);
  ok("the listing API defines the live defaults in one place", !!apiLit);
  const apiDef = new Function("return " + apiLit[1])();
  [["js/app.js", appDef], ["listing-api", apiDef]].forEach(([who, d]) => {
    eq(who + " default version is the calculation version", d.version, ZONAL.calculationVersion);
    ok(who + " defaults carry no approval", d.approvedBy === "" && d.approvedAt === "");
    Object.keys(live.proxy).forEach(k => eq(who + " " + k + " proxy factor = live", d.proxyFactors[k], live.proxy[k]));
    Object.keys(live.mid).forEach(k => eq(who + " " + k + " market midpoint = live", d.marketBandMid[k], live.mid[k]));
    Object.keys(live.build).forEach(k => eq(who + " " + k + " building rate = live", d.construction[k], live.build[k]));
  });
  ok("the September 2026 set (CHB 25,000, commercial 1.7x) is gone from both", !/mixed_chb: 25000/.test(APP) && !/commercial: 1\.7\b/.test(APP) && !/mixed_chb: 25000/.test(API) && !/commercial: 1\.7\b/.test(API));
  ok("the panel pre-fills from the approved override or the live values, never an unapproved row", /const fill = approved \? v : live;/.test(APP));
  ok("the panel offers a reset to the live values", /data-vg-reset/.test(APP) && /function adminValueGuideReset/.test(APP));
  ok("an unapproved set still never reaches the public calculator", EST.core.applyGuideSettings(ZONAL, { data: { valueGuide: { version: "x", approvedBy: "", approvedAt: "", construction: { mixed_chb: 25000 } } } }).construction.mixed_chb.costPerSqm === 16000);

  console.log("\nvalue_guide_phase0_node: " + passed + " checks passed");
})().catch(e => { console.error(e.stack || e); process.exit(1); });
