#!/usr/bin/env node
"use strict";
/* Model fit proposals (accuracy plan items 1.1, 1.3 and 1.5): the house-size
 * grade on the construction rate and the measured range, from this month's bank
 * and Pag-IBIG prices. Suggestions for a person to review, never applied here.
 *
 *   node market-scan/comparables/fit-model.js [--write-calibration] [--today YYYY-MM-DD]
 *
 * Basis. The guide aims at a LIKELY SALE PRICE. Bank and Pag-IBIG "as is"
 * prices sit below it, so every price is lifted by BANK_GAP (10%) first, as the
 * town calibration (calibrate.js) already does.
 *
 * House-size grade. For each house and townhouse matched to a BIR street or
 * barangay, with the floor area known:
 *
 *   building_i = (price_i x 1.10 - guide land_i) / guide building_i
 *                (guide building before any grade already in force)
 *   band       = floor-area band (under 30, 30-49, 50-79, 80-149, 150+ sqm)
 *   project    = median building_i of its records     (one development counts once)
 *   band ratio = median of the project medians
 *   weight     = projects / (projects + PRIOR)         (shrink toward "no grade")
 *   grade      = 1 + weight x (band ratio - 1), capped to CAP
 *
 * PRIOR is 5 developments, not the town calibration's 10: a size band pools
 * evidence from every town (10 to 41 developments per band in Oct 2026), so
 * five developments is already a broad base. A band with fewer than
 * MIN_RECORDS records or MIN_PROJECTS developments keeps a grade of 1.
 *
 * Measured range. With the proposed grades applied, ratio_i = price_i x 1.10 /
 * guide_i for every house (and, with the live model, every vacant lot); the
 * median per development, then the 16th and 84th percentiles across
 * developments are the band's low and high factors, so the band holds the
 * middle 68% of developments. inBand reports the share of individual prices
 * inside it. A location matched only at town or province level widens the band
 * by WIDEN_DERIVED (applied by js/estimator.js, not here).
 *
 * Writes data/comparables/model-fit-proposals.json every run. With
 * --write-calibration it also writes the houseSize and range sections of
 * data/calibration.json; the monthly workflow does that on a branch and opens a
 * pull request, so nothing changes on the site until someone merges it. */

const fs = require("fs"), path = require("path");
const { loadEstimator } = require("./accuracy.js");
const { projectKey, distinctive } = require("./match.js");
const ROOT = path.resolve(__dirname, "../..");
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };

const RULES = {
  BANK_GAP: 0.10, PRIOR: 5, MIN_RECORDS: 10, MIN_PROJECTS: 5, CAP: [0.3, 2.5], MIN_CHANGE: 0.03,
  RANGE_MIN_RECORDS: 30, RANGE_MIN_PROJECTS: 10, RANGE_MIN_CHANGE: 0.02, WIDEN_DERIVED: 1.25,
  BANDS: [
    { to: 30, label: "under 30 sqm" }, { to: 50, label: "30-49 sqm" }, { to: 80, label: "50-79 sqm" },
    { to: 150, label: "80-149 sqm" }, { to: null, label: "150 sqm and up" }
  ]
};

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const r3 = x => x == null ? null : Math.round(x * 1000) / 1000;
const r2 = x => x == null ? null : Math.round(x * 100) / 100;
const bandOf = floor => { let i = 0; while (i < RULES.BANDS.length - 1 && !(RULES.BANDS[i].to > floor)) i++; return i; };

function inputsFor(r) {
  const type = r.kind === "vacant_lot" ? "vacant_lot" : "house_lot";
  return {
    purpose: "selling", type, municipality: r.municipality, barangay: r.barangay,
    streetKey: r.streetKey || "", allOther: !r.streetKey, classification: "RR", area: r.lotArea,
    saleContext: "private-resale", landMethod: "factor", features: [],
    floorArea: r.floorArea || 0, construction: "mixed_chb", floors: "1", ageBand: "6-10"
  };
}

/* project medians -> one value per development */
function byProject(rows, value) {
  const g = {};
  rows.forEach(x => { (g[x.project] = g[x.project] || []).push(value(x)); });
  return Object.keys(g).map(k => ({ project: k, n: g[k].length, value: median(g[k]) }));
}

async function fitModel(opts) {
  const root = opts.root || ROOT;
  const dir = opts.dir || path.join(root, "data/comparables");
  const calFile = opts.calibrationFile || path.join(root, "data/calibration.json");
  const snap = JSON.parse(fs.readFileSync(path.join(dir, "batangas-latest.json"), "utf8"));
  const current = fs.existsSync(calFile) ? JSON.parse(fs.readFileSync(calFile, "utf8")) : {};
  const EST = loadEstimator(root);
  const D = await EST.loadData();
  /* price against the calibration file under test (the live one by default) */
  const liveCal = D.config.townCalibration;
  D.config.townCalibration = Object.assign({}, current, { towns: current.towns || (liveCal && liveCal.towns) || {} });
  const known = [...new Set(snap.records.map(r => distinctive(r.project || "").join(" ")).filter(Boolean))];
  const usable = snap.records.filter(r => !r.carriedOver && ["house_lot", "townhouse", "vacant_lot"].indexOf(r.kind) >= 0 && r.price > 0 && r.lotArea > 0);

  async function run(records) {
    const out = [];
    for (const r of records) {
      const e = await EST.estimate(inputsFor(r));
      if (!e || e.available === false || !(e.total > 0)) continue;
      out.push({ r, e, project: projectKey(r, known), kind: r.kind === "vacant_lot" ? "vacant_lot" : "house_lot", derived: !(r.matchLevel === "street" || r.matchLevel === "barangay") });
    }
    return out;
  }

  /* ---- house-size grade ---- */
  const houses = await run(usable.filter(r => r.kind !== "vacant_lot" && r.floorArea > 0 && (r.matchLevel === "street" || r.matchLevel === "barangay")));
  const gap = 1 + RULES.BANK_GAP;
  houses.forEach(x => {
    const grade = x.e.houseSizeGrade ? x.e.houseSizeGrade.factor : 1;
    const building = (x.e.improvement - (x.e.featuresTotal || 0)) / grade;
    x.building = building;
    x.ratio = building > 0 ? Math.max(0.2, (x.r.price * gap - x.e.landValue) / building) : null;
    x.band = bandOf(x.r.floorArea);
  });
  const currentBands = (current.houseSize && current.houseSize.bands) || [];
  const bands = RULES.BANDS.map((def, i) => {
    const rows = houses.filter(x => x.band === i && x.ratio != null);
    const projects = byProject(rows, x => x.ratio);
    const ratio = projects.length ? median(projects.map(p => p.value)) : null;
    const qualifies = rows.length >= RULES.MIN_RECORDS && projects.length >= RULES.MIN_PROJECTS;
    const weight = projects.length / (projects.length + RULES.PRIOR);
    const factor = qualifies ? r3(Math.min(RULES.CAP[1], Math.max(RULES.CAP[0], 1 + weight * (ratio - 1)))) : 1;
    const now = currentBands[i] && Number(currentBands[i].factor) || 1;
    return { label: def.label, to: def.to, factor, ratio: r3(ratio), records: rows.length, projects: projects.length, weight: r3(weight), current: now,
      change: r3(factor / now - 1), status: !qualifies ? "not enough records" : Math.abs(factor / now - 1) < RULES.MIN_CHANGE ? "no change needed" : "proposed",
      projectDetail: projects.sort((a, b) => b.n - a.n).slice(0, 12).map(p => ({ name: p.project, n: p.n, ratio: r3(p.value) })) };
  });
  const houseSizeProposed = bands.some(b => b.status === "proposed");
  const houseSize = {
    note: "House-size grade on the construction rate, from bank and Pag-IBIG house prices (market-scan/comparables/fit-model.js). Applied by js/estimator.js houseSizeGrade: the rate for a floor-area band is the config rate x factor, blended across band boundaries. Changed only by merging a pull request opened by the monthly comparables workflow.",
    month: snap.month, bankGap: RULES.BANK_GAP, prior: RULES.PRIOR,
    basis: "median per development of (price x " + gap.toFixed(2) + " - guide land) / guide building, then the median across developments, shrunk by developments / (developments + " + RULES.PRIOR + ") toward 1, capped " + RULES.CAP[0] + "-" + RULES.CAP[1],
    bands: bands.map(b => ({ label: b.label, to: b.to, factor: b.factor, ratio: b.ratio, records: b.records, projects: b.projects, weight: b.weight }))
  };

  /* ---- measured range, with the proposed grades in force ---- */
  D.config.townCalibration = Object.assign({}, D.config.townCalibration, { houseSize });
  const all = await run(usable);
  all.forEach(x => { x.ratio = x.r.price * gap / x.e.total; });
  const currentSeg = (current.range && current.range.segments) || {};
  const segments = {}, segmentReport = [];
  ["house_lot", "vacant_lot"].forEach(kind => {
    const rows = all.filter(x => x.kind === kind && !x.derived);
    const projects = byProject(rows, x => x.ratio);
    const qualifies = rows.length >= RULES.RANGE_MIN_RECORDS && projects.length >= RULES.RANGE_MIN_PROJECTS;
    const low = qualifies ? r2(quantile(projects.map(p => p.value), 0.16)) : null;
    const high = qualifies ? r2(quantile(projects.map(p => p.value), 0.84)) : null;
    const inBand = qualifies ? r3(rows.filter(x => x.ratio >= low && x.ratio <= high).length / rows.length) : null;
    const now = currentSeg[kind] || null;
    const changed = !now || Math.abs((now.lowFactor || 0) - low) >= RULES.RANGE_MIN_CHANGE || Math.abs((now.highFactor || 0) - high) >= RULES.RANGE_MIN_CHANGE;
    const derived = all.filter(x => x.kind === kind && x.derived);
    const report = { kind, records: rows.length, projects: projects.length, lowFactor: low, highFactor: high, inBand,
      medianRatio: r3(median(rows.map(x => x.ratio))), projectWeightedRatio: r3(median(projects.map(p => p.value))),
      inPlanningBand: r3(rows.filter(x => x.ratio >= 0.85 && x.ratio <= 1.30).length / (rows.length || 1)),
      derivedMatches: { records: derived.length, p16: r2(quantile(derived.map(x => x.ratio), 0.16)), p84: r2(quantile(derived.map(x => x.ratio), 0.84)) },
      current: now && { lowFactor: now.lowFactor, highFactor: now.highFactor },
      status: !qualifies ? "not enough records" : !changed ? "no change needed" : "proposed" };
    segmentReport.push(report);
    if (qualifies) segments[kind] = { lowFactor: low, highFactor: high, records: rows.length, projects: projects.length, inBand };
  });
  const rangeProposed = segmentReport.some(s => s.status === "proposed");
  const range = {
    note: "Measured range by segment, from bank and Pag-IBIG prices (market-scan/comparables/fit-model.js). Applied by js/estimator.js rangeFactors to houses and lots on residential land; everything else keeps the 85%-130% planning scenarios. Changed only by merging a pull request opened by the monthly comparables workflow.",
    month: snap.month, bankGap: RULES.BANK_GAP,
    basis: "16th to 84th percentile across developments of the median (price x " + gap.toFixed(2) + " / guide) per development, with the house-size grade in force; one development counts once",
    derivedMatchWidening: RULES.WIDEN_DERIVED,
    segments
  };
  D.config.townCalibration = liveCal;

  const today = opts.today || new Date().toISOString().slice(0, 10);
  const out = {
    note: "Model fit proposals from bank and Pag-IBIG prices (market-scan/comparables/fit-model.js): house-size grades and the measured range. Suggestions only: they reach data/calibration.json through a pull request that a person merges.",
    generatedOn: today, snapshotMonth: snap.month, rules: RULES,
    proposals: [].concat(houseSizeProposed ? ["houseSize"] : [], rangeProposed ? ["range"] : []),
    houseSize: { status: houseSizeProposed ? "proposed" : "no change needed", bands },
    range: { status: rangeProposed ? "proposed" : "no change needed", segments: segmentReport }
  };
  fs.writeFileSync(path.join(dir, "model-fit-proposals.json"), JSON.stringify(out, null, 1) + "\n");

  if (opts.writeCalibration && out.proposals.length) {
    const next = JSON.parse(JSON.stringify(current));
    next.note = next.note || "Reviewed corrections to the Value Guide model. Applied by js/estimator.js. Changed only by merging a pull request.";
    next.towns = next.towns || {};
    if (houseSizeProposed) next.houseSize = houseSize;
    if (rangeProposed) next.range = Object.assign({}, next.range || {}, range, { segments: Object.assign({}, (next.range && next.range.segments) || {}, segments) });
    fs.writeFileSync(calFile, JSON.stringify(next, null, 1) + "\n");
  }
  return out;
}

if (require.main === module) {
  fitModel({ today: arg("today"), writeCalibration: args.indexOf("--write-calibration") >= 0 }).then(out => {
    out.houseSize.bands.forEach(b => console.log("house-size " + b.label.padEnd(16) + " records " + String(b.records).padStart(3) + " developments " + String(b.projects).padStart(2) +
      "  ratio " + (b.ratio == null ? "   -" : b.ratio.toFixed(2)) + "  grade " + b.current + " -> " + b.factor + "  " + b.status));
    out.range.segments.forEach(s => console.log("range      " + s.kind.padEnd(16) + " records " + String(s.records).padStart(3) + " developments " + String(s.projects).padStart(2) +
      "  band " + (s.lowFactor == null ? "-" : s.lowFactor + "-" + s.highFactor) + "  inside " + (s.inBand == null ? "-" : Math.round(s.inBand * 100) + "%") + "  " + s.status));
    console.log("PROPOSALS " + (out.proposals.join(", ") || "none"));
  }).catch(e => { console.error(e.stack || e); process.exit(1); });
}

module.exports = { fitModel, RULES };
