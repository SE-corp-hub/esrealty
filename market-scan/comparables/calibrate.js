#!/usr/bin/env node
"use strict";
/* Town calibration proposals (plan stage F) - suggestions for a person to
 * review, never applied by this script.
 *
 *   node market-scan/comparables/calibrate.js [--write-calibration] [--today YYYY-MM-DD]
 *
 * For every town with enough vacant residential lots in this month's snapshot:
 *
 *   ratio_i   = price_i x (1 + BANK_GAP) / guide_i
 *               bank and Pag-IBIG prices sit below resale; the guide aims at
 *               resale, so each record is lifted by BANK_GAP (10%) first
 *   project   = median ratio of its records      (one project counts once)
 *   town      = median of the project medians
 *   weight    = projects / (projects + 10)       (shrink toward "no change")
 *   proposed  = current x (1 + weight x (town - 1)), capped to 0.75-1.25
 *
 * A town qualifies with >= 10 lot records from >= 3 projects, and a proposal is
 * made only when it moves the factor by 3% or more.
 *
 * Writes data/comparables/calibration-proposals.json every run. With
 * --write-calibration it also writes the proposed factors into
 * data/calibration.json - the monthly workflow does that on a separate branch
 * and opens a pull request, so the change goes live only when someone merges
 * it. js/estimator.js applies data/calibration.json to residential land. */

const fs = require("fs"), path = require("path");
const { loadEstimator } = require("./accuracy.js");
const { projectKey, distinctive } = require("./match.js");
const ROOT = path.resolve(__dirname, "../..");
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };

const RULES = { BANK_GAP: 0.10, MIN_RECORDS: 10, MIN_PROJECTS: 3, PRIOR: 10, CAP: [0.75, 1.25], MIN_CHANGE: 0.03 };

const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r3 = x => Math.round(x * 1000) / 1000;

async function calibrate(opts) {
  const root = opts.root || ROOT;
  const dir = opts.dir || path.join(root, "data/comparables");
  const calFile = opts.calibrationFile || path.join(root, "data/calibration.json");
  const snap = JSON.parse(fs.readFileSync(path.join(dir, "batangas-latest.json"), "utf8"));
  const current = fs.existsSync(calFile) ? JSON.parse(fs.readFileSync(calFile, "utf8")) : { towns: {} };
  current.towns = current.towns || {};
  const EST = loadEstimator(root);

  const byTown = {};
  const known = [...new Set(snap.records.map(r => distinctive(r.project || "").join(" ")).filter(Boolean))];
  for (const r of snap.records) {
    if (r.kind !== "vacant_lot" || r.carriedOver || !(r.matchLevel === "barangay" || r.matchLevel === "street")) continue;
    const e = await EST.estimate({
      purpose: "selling", type: "vacant_lot", municipality: r.municipality, barangay: r.barangay,
      streetKey: r.streetKey || "", allOther: !r.streetKey, classification: "RR", area: r.lotArea,
      saleContext: "private-resale", landMethod: "factor", features: []
    });
    if (!e || e.available === false || !(e.landValue > 0)) continue;
    const t = (byTown[r.municipality] = byTown[r.municipality] || {});
    const project = projectKey(r, known);
    (t[project] = t[project] || []).push(r.price * (1 + RULES.BANK_GAP) / e.landValue);
  }

  const towns = Object.keys(byTown).sort().map(town => {
    const projects = Object.keys(byTown[town]).map(name => ({ name, n: byTown[town][name].length, ratio: r3(median(byTown[town][name])) }))
      .sort((a, b) => b.n - a.n);
    const records = projects.reduce((s, p) => s + p.n, 0);
    const now = current.towns[town] && Number(current.towns[town].residentialLandFactor) || 1;
    const qualifies = records >= RULES.MIN_RECORDS && projects.length >= RULES.MIN_PROJECTS;
    const townRatio = median(projects.map(p => p.ratio));
    const weight = projects.length / (projects.length + RULES.PRIOR);
    let proposed = now * (1 + weight * (townRatio - 1));
    proposed = r3(Math.min(RULES.CAP[1], Math.max(RULES.CAP[0], proposed)));
    const change = proposed / now - 1;
    return {
      town, records, projects: projects.length, current: now, townRatio: r3(townRatio), weight: r3(weight), proposed,
      change: r3(change), status: !qualifies ? "not enough records" : Math.abs(change) < RULES.MIN_CHANGE ? "no change needed" : "proposed",
      projectDetail: projects
    };
  });
  const proposals = towns.filter(t => t.status === "proposed");
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const out = {
    note: "Town land-factor proposals from bank and Pag-IBIG vacant-lot prices (market-scan/comparables/calibrate.js). Suggestions only: they reach data/calibration.json through a pull request that a person merges.",
    generatedOn: today, snapshotMonth: snap.month, rules: RULES, proposals: proposals.map(p => p.town), towns
  };
  fs.writeFileSync(path.join(dir, "calibration-proposals.json"), JSON.stringify(out, null, 1) + "\n");

  if (opts.writeCalibration && proposals.length) {
    const next = JSON.parse(JSON.stringify(current));
    next.note = next.note || "Reviewed town corrections to residential land (plan stage F). Applied by js/estimator.js. Changed only by merging a calibration pull request.";
    proposals.forEach(p => {
      next.towns[p.town] = {
        residentialLandFactor: p.proposed, month: snap.month, records: p.records, projects: p.projects,
        basis: "median of project medians of bank/Pag-IBIG lot price x " + (1 + RULES.BANK_GAP) + " / guide land, shrunk by " + p.weight + ", from " + p.current
      };
    });
    fs.writeFileSync(calFile, JSON.stringify(next, null, 1) + "\n");
  }
  return out;
}

if (require.main === module) {
  calibrate({ today: arg("today"), writeCalibration: args.indexOf("--write-calibration") >= 0 }).then(out => {
    out.towns.forEach(t => console.log(t.town.padEnd(16) + " lots " + String(t.records).padStart(3) + " projects " + String(t.projects).padStart(2) +
      "  ratio " + t.townRatio.toFixed(2) + "  factor " + t.current + " -> " + t.proposed + "  " + t.status));
    console.log("PROPOSALS " + (out.proposals.join(", ") || "none"));
  }).catch(e => { console.error(e.stack || e); process.exit(1); });
}

module.exports = { calibrate, RULES };
