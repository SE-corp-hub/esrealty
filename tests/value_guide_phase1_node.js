"use strict";
/* Accuracy plan Phase 1 (2026-11-01): the house-size grade on the construction
 * rate, the measured range, the typical-barangay quick figure and the fit
 * script that proposes the first two from the monthly bank snapshot.
 *
 * Why each check exists: the cost approach at one rate missed 30-79 sqm homes
 * by about a quarter; the fixed 85%-130% band held 52% of bank house prices
 * and 9% of lot prices; the town-wide quick figure under-priced homes matched
 * only at town level by about 30%. tests/value_guide_phase0_node.js covers
 * the trust fixes that preceded this. */
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const ROOT = process.cwd();
global.fetch = (u) => {
  const p = path.join(ROOT, String(u).split("?")[0]);
  return Promise.resolve({ ok: fs.existsSync(p), json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, "utf8"))) });
};
const EST = require(path.join(ROOT, "js/estimator.js"));
const FLOW = require(path.join(ROOT, "js/value_guide_flow.js"));
const FIT = require(path.join(ROOT, "market-scan/comparables/fit-model.js"));
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const config = read("data/zonal-config.json"), CAL = read("data/calibration.json"), ACC = read("data/comparables/accuracy-latest.json");
const ESTSRC = fs.readFileSync(path.join(ROOT, "js/estimator.js"), "utf8");

let n = 0;
function ok(name, cond, detail) {
  if (!cond) { console.log("[FAIL] " + name + (detail != null ? " -- " + detail : "")); process.exit(1); }
  n++; console.log("[PASS] " + name);
}
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const HOUSE = { purpose: "Selling", type: "house_lot", municipality: "BAUAN", barangay: "POBLACION III", streetKey: "binay st ressurreccion st",
  classification: "RR", area: 100, landMethod: "factor", saleContext: "private-resale", floorArea: 43, floors: "1", ageBand: "6-10", construction: "mixed_chb", features: [] };

(async () => {
  /* ---- the fitted sections exist and are sane */
  const hs = CAL.houseSize, rg = CAL.range;
  ok("calibration.json carries five house-size bands", hs && Array.isArray(hs.bands) && hs.bands.length === 5);
  ok("...each inside the fit script's caps", hs.bands.every(b => b.factor >= FIT.RULES.CAP[0] && b.factor <= FIT.RULES.CAP[1]), JSON.stringify(hs.bands.map(b => b.factor)));
  ok("...with the band edges the estimator and the fit script agree on", hs.bands.map(b => b.to).join(",") === FIT.RULES.BANDS.map(b => b.to).join(","));
  ok("...each fitted band names its evidence", hs.bands.filter(b => b.factor !== 1).every(b => b.records >= FIT.RULES.MIN_RECORDS && b.projects >= FIT.RULES.MIN_PROJECTS));
  ok("the grade raises the rate for 30-79 sqm homes and lowers it under 30 and over 150", hs.bands[1].factor > 1 && hs.bands[2].factor > 1 && hs.bands[0].factor < 1 && hs.bands[4].factor < 1, JSON.stringify(hs.bands.map(b => b.factor)));
  ok("calibration.json carries a measured range for houses and lots", rg && rg.segments && rg.segments.house_lot && rg.segments.vacant_lot);
  ["house_lot", "vacant_lot"].forEach(k => {
    const s = rg.segments[k];
    ok("the " + k + " band brackets 1 and names its evidence", s.lowFactor < 1 && s.highFactor > 1 && s.records >= FIT.RULES.RANGE_MIN_RECORDS && s.projects >= FIT.RULES.RANGE_MIN_PROJECTS, JSON.stringify(s));
    ok("...and holds most of the individual prices", s.inBand >= 0.6, s.inBand);
  });

  /* ---- houseSizeGrade: lookup, blending, clamping */
  const cfg = Object.assign({}, config, { townCalibration: CAL });
  const grade = f => EST.core.houseSizeGrade(cfg, f);
  [[20, 0], [40, 1], [62, 2], [110, 3], [240, 4]].forEach(([floor, i]) => {
    const g = grade(floor);
    ok(floor + " sqm takes the " + hs.bands[i].label + " grade exactly", g && g.factor === hs.bands[i].factor && g.band === hs.bands[i].label && !g.blended, JSON.stringify(g));
  });
  let maxJump = 0, prev = grade(15).factor;
  for (let x = 15.5; x <= 400; x += 0.5) { const f = grade(x).factor; maxJump = Math.max(maxJump, Math.abs(f / prev - 1)); prev = f; }
  ok("across a band boundary the grade blends: no half square metre moves it more than 10%", maxJump < 0.10, "max jump " + (maxJump * 100).toFixed(1) + "%");
  ok("inside the blend window the grade is between the two bands", (() => { const g = grade(49); return g.blended && g.factor > Math.min(hs.bands[1].factor, hs.bands[2].factor) && g.factor < Math.max(hs.bands[1].factor, hs.bands[2].factor); })(), JSON.stringify(grade(49)));
  ok("no grade without a calibration file", EST.core.houseSizeGrade(config, 43) === null);
  ok("no grade for a zero floor area", grade(0) === null);
  const silly = EST.core.houseSizeGrade(Object.assign({}, config, { townCalibration: { houseSize: { bands: [{ to: null, label: "all", factor: 9 }] } } }), 50);
  ok("an absurd factor is clamped, not applied", silly.factor === 3, JSON.stringify(silly));

  /* ---- computeEstimate applies it to the building only */
  const D = await EST.loadData();
  const md = await EST.loadMunicipality("bauan");
  const graded = EST.core.computeEstimate(D.config, D.index, md, HOUSE);
  const plain = EST.core.computeEstimate(Object.assign({}, D.config, { townCalibration: Object.assign({}, D.config.townCalibration, { houseSize: null }) }), D.index, md, HOUSE);
  ok("the 43 sqm test house prices", graded.available === true, graded.reason);
  ok("the grade leaves the land alone", graded.landValue === plain.landValue, graded.landValue + " vs " + plain.landValue);
  ok("the 43 sqm house carries the 30-49 sqm grade", graded.houseSizeGrade && graded.houseSizeGrade.band === "30-49 sqm" && graded.houseSizeGrade.factor === hs.bands[1].factor);
  ok("config rate x grade = graded rate, whole pesos", graded.buildCostPerSqm === 16000 && graded.gradedBuildCostPerSqm === Math.round(16000 * hs.bands[1].factor), graded.gradedBuildCostPerSqm);
  ok("building = graded rate x floor x (1 - depreciation)", graded.improvement === Math.round(graded.gradedBuildCostPerSqm * 43 * (1 - graded.depreciatedPct / 100)), graded.improvement);
  ok("without the grade the building is the plain rate", plain.improvement === Math.round(16000 * 43 * (1 - plain.depreciatedPct / 100)) && plain.gradedBuildCostPerSqm === 16000 && plain.houseSizeGrade === null);
  ok("land + building still reconcile to the total", graded.total === graded.landValue + graded.improvement && EST.core.integrityCheck(graded).ok);
  ok("the report names the grade and its evidence", /House-size grade/.test(ESTSRC) && /size grade <b>/.test(ESTSRC));

  /* ---- the back office prices the same building, same band */
  const s = await EST.estimate(HOUSE), g = await FLOW.compute(Object.assign({}, HOUSE, FLOW.pickInputs({})), EST);
  ok("the back office takes the graded building", g.improvement === s.improvement && g.gradedBuildCostPerSqm === s.gradedBuildCostPerSqm && g.houseSizeGrade.factor === s.houseSizeGrade.factor);
  ok("...and the same range band", g.rangeLowFactor === s.rangeLowFactor && g.rangeHighFactor === s.rangeHighFactor && g.low === Math.round(g.total * g.rangeLowFactor) && EST.core.integrityCheck(g).ok);

  /* ---- the range: measured for residential, widened for derived matches, default elsewhere */
  const seg = rg.segments;
  ok("a street-matched residential house takes the measured house band", s.source.depth === 1 && s.rangeLowFactor === seg.house_lot.lowFactor && s.rangeHighFactor === seg.house_lot.highFactor && s.rangeBasis.measured && !s.rangeBasis.widened, JSON.stringify([s.rangeLowFactor, s.rangeHighFactor]));
  ok("...low and high follow it", s.low === Math.round(s.total * seg.house_lot.lowFactor) && s.high === Math.round(s.total * seg.house_lot.highFactor));
  ok("...and the method says it is measured", /^Measured: 68%/.test(s.rangeMethod) && s.rangeMethod.indexOf(String(seg.house_lot.records)) > 0, s.rangeMethod);
  const lot = await EST.estimate(Object.assign({}, HOUSE, { type: "vacant_lot", floorArea: 0 }));
  ok("a residential lot takes the measured lot band", lot.rangeLowFactor === seg.vacant_lot.lowFactor && lot.rangeHighFactor === seg.vacant_lot.highFactor && lot.rangeBasis.measured.kind === "vacant_lot");
  const com = EST.core.computeEstimate(D.config, D.index, md, Object.assign({}, HOUSE, { type: "vacant_lot", classification: "CR", floorArea: 0 }));
  ok("commercial land keeps the 85%-130% planning scenarios", com.available && com.use === "commercial" && com.rangeLowFactor === 0.85 && com.rangeHighFactor === 1.30 && com.rangeBasis.measured === null, JSON.stringify([com.use, com.rangeLowFactor, com.rangeHighFactor]));
  const town = EST.core.computeEstimate(D.config, D.index, md, Object.assign({}, HOUSE, { barangay: "", streetKey: "" }));
  const w = rg.derivedMatchWidening;
  ok("a town-level match widens the measured band by the stated factor", town.source.depth >= 3 && town.rangeBasis.widened
    && town.rangeLowFactor === Math.round((1 - (1 - seg.house_lot.lowFactor) * w) * 1000) / 1000
    && town.rangeHighFactor === Math.round((1 + (seg.house_lot.highFactor - 1) * w) * 1000) / 1000, JSON.stringify([town.source.depth, town.rangeLowFactor, town.rangeHighFactor]));
  ok("...and says so", /widened/.test(town.rangeMethod));
  const noCal = EST.core.computeEstimate(Object.assign({}, D.config, { townCalibration: null }), D.index, md, HOUSE);
  ok("without a calibration file the planning scenarios remain", noCal.rangeLowFactor === 0.85 && noCal.rangeHighFactor === 1.30 && /85%-130%/.test(noCal.rangeMethod));

  /* ---- the quick figure: a typical barangay and a 6-10-year-old house */
  const tb = EST.core.typicalBarangay(md, "RR");
  const rates = Object.keys(md.barangays).map(k => md.barangays[k].other && md.barangays[k].other.RR).filter(v => v > 0).sort((a, b) => a - b);
  ok("the typical barangay carries the median all-other RR rate", tb && md.barangays[tb.name] && tb.rate === rates[Math.floor((rates.length - 1) / 2)] && tb.barangays === rates.length, JSON.stringify(tb));
  const quick = await EST.estimate({ purpose: "Selling", type: "house_lot", municipality: "BAUAN", barangay: "", streetKey: "", typicalBarangay: true,
    classification: "RR", area: 150, landMethod: "factor", saleContext: "private-resale", floorArea: 0, floors: "1", ageBand: "6-10", construction: "mixed_chb", features: [] });
  ok("the quick figure prices at the typical barangay, matched at barangay level", quick.available && quick.typicalBarangay && quick.typicalBarangay.name === tb.name && quick.barangay === tb.name && quick.source.depth === 2, JSON.stringify([quick.barangay, quick.source && quick.source.depth]));
  ok("...with a 6-10-year-old house", quick.ageMidpoint === 8);
  const townWide = await EST.estimate({ purpose: "Selling", type: "house_lot", municipality: "BAUAN", barangay: "", streetKey: "",
    classification: "RR", area: 150, landMethod: "factor", saleContext: "private-resale", floorArea: 0, floors: "1", ageBand: "0-5", construction: "mixed_chb", features: [] });
  ok("a run without the flag still prices town-wide", townWide.source.depth === 3 && !townWide.typicalBarangay);
  ok("a given barangay wins over the flag", (await EST.estimate(Object.assign({}, HOUSE, { typicalBarangay: true }))).barangay === "POBLACION III");
  ok("the home page quick form and example both use it", (ESTSRC.match(/typicalBarangay: true/g) || []).length >= 2 && /ageBand: "6-10", construction: "mixed_chb", features: \[\]\n    \}\)\.then\(function \(r\) \{\n      if \(req !== quick\.request\)/.test(ESTSRC));
  ok("the quick note names the barangay and the house age", /about 6–10 years old/.test(ESTSRC) && /typical barangay for/.test(ESTSRC) && !/under 5 years old/.test(ESTSRC));

  /* ---- the fit script reproduces the committed sections from the committed snapshot */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vg-fit-"));
  fs.mkdirSync(path.join(tmp, "out"));
  fs.copyFileSync(path.join(ROOT, "data/comparables/batangas-latest.json"), path.join(tmp, "out/batangas-latest.json"));
  fs.copyFileSync(path.join(ROOT, "data/calibration.json"), path.join(tmp, "calibration.json"));
  const out = await FIT.fitModel({ root: ROOT, dir: path.join(tmp, "out"), calibrationFile: path.join(tmp, "calibration.json"), today: "2026-11-01" });
  ok("the fit script writes its proposals file", fs.existsSync(path.join(tmp, "out/model-fit-proposals.json")) && out.snapshotMonth === hs.month);
  out.houseSize.bands.forEach((b, i) => {
    ok("re-fitting the " + b.label + " band from the same snapshot returns the committed grade", Math.abs(b.factor - hs.bands[i].factor) <= 0.002 && b.records === hs.bands[i].records && b.projects === hs.bands[i].projects, JSON.stringify([b.factor, hs.bands[i].factor, b.records, b.projects]));
  });
  ok("...so nothing is proposed", out.proposals.length === 0 && out.houseSize.bands.every(b => b.status === "no change needed"), JSON.stringify(out.proposals));
  out.range.segments.forEach(sg => {
    ok("re-measuring the " + sg.kind + " band returns the committed one", sg.lowFactor === seg[sg.kind].lowFactor && sg.highFactor === seg[sg.kind].highFactor && sg.status === "no change needed", JSON.stringify(sg));
  });
  ok("the committed calibration file was not touched by a run without --write-calibration", JSON.stringify(read("data/calibration.json")) === JSON.stringify(CAL));
  ok("the fit script restores the live calibration after measuring", JSON.stringify((await EST.loadData()).config.townCalibration) === JSON.stringify(CAL));

  /* ---- the accuracy report carries the new measures */
  ok("the accuracy report is from this calculation version", ACC.calculationVersion === config.calculationVersion, ACC.calculationVersion);
  ok("...and reports the share of bank prices inside the guide's range", ACC.overall.house_lot.inBand > 0.6 && ACC.overall.vacant_lot.inBand > 0.6, JSON.stringify([ACC.overall.house_lot.inBand, ACC.overall.vacant_lot.inBand]));
  ok("...the error against the likely sale price", ACC.overall.house_lot.likelySale && typeof ACC.overall.house_lot.likelySale.medianAbs === "number");
  ok("...and houses by size band", Array.isArray(ACC.bySize) && ACC.bySize.length === 5 && ACC.bySize.every(b => b.n > 0));
  ok("houses now miss bank prices by well under the 21% of calculation 2026.10.7", ACC.overall.house_lot.medianAbs < 0.15, ACC.overall.house_lot.medianAbs);
  ok("every size band sits within 10% of bank prices, one development counted once", ACC.bySize.every(b => Math.abs(b.projectWeightedMedian) <= 0.10), JSON.stringify(ACC.bySize.map(b => b.projectWeightedMedian)));

  /* ---- versions move together */
  ok("the calculation version advanced for the model change", config.calculationVersion === "2026.11.2");
  ok("the monthly workflow runs the fit script and includes it in the calibration pull request", (() => { const y = fs.readFileSync(path.join(ROOT, ".github/workflows/comparables-monthly.yml"), "utf8"); return /fit-model\.js\n/.test(y) && /fit-model\.js --write-calibration/.test(y) && /model-fit-proposals\.json/.test(y); })());

  console.log("\nvalue_guide_phase1_node: " + n + " checks passed");
})().catch(e => { console.error("CRASH " + (e && e.stack || e)); process.exit(1); });
