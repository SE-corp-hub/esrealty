#!/usr/bin/env node
"use strict";
/* Monthly accuracy report: the Value Guide against this month's bank listings.
 *
 *   node market-scan/comparables/accuracy.js [--report /tmp/report.json] [--today YYYY-MM-DD]
 *
 * Runs every house-and-lot, townhouse and vacant-lot record in
 * data/comparables/batangas-latest.json through the public estimator (same
 * inputs a visitor would give: location, lot, floor; unknown age = 6-10 years)
 * and writes data/comparables/accuracy-latest.json, plus one summary line in
 * that month's history.json entry.
 *
 * How to read it. Bank prices are "as is, where is" and usually sit BELOW
 * resale asking prices, so a model aimed at resale should come out somewhat
 * above them: +0% to +25% is the expected place. The headline figure is the
 * PROJECT-WEIGHTED median - the median of each project's (or barangay's) median
 * error - because one subdivision can supply half the records (47 Plantacion
 * Meridienne lots in Oct 2026) and would otherwise decide the answer alone.
 *
 * Nothing here changes a price. Problems go to the run report, and the monthly
 * workflow raises them in its issue for a person to review (plan stage F). */

const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };

/* Alert bands for the project-weighted median error (model / bank price - 1),
   only checked when a kind has enough projects to mean something. */
const BANDS = { house_lot: [-0.15, 0.35], vacant_lot: [-0.15, 0.35] };
const MIN_CLUSTERS = 5;
const SHIFT_ALERT = 0.15; /* month-over-month move in a headline figure */

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r3 = x => x == null ? null : Math.round(x * 1000) / 1000;

function loadEstimator(root) {
  if (typeof global.fetch !== "function" || !global.__comparablesFetchShim) {
    global.fetch = u => {
      const p = path.join(root, String(u).split("?")[0]);
      return Promise.resolve({ ok: fs.existsSync(p), json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, "utf8"))) });
    };
    global.__comparablesFetchShim = true;
  }
  return require(path.join(root, "js/estimator.js"));
}

function summarise(rows) {
  const clusters = {};
  rows.forEach(x => { (clusters[x.cluster] = clusters[x.cluster] || []).push(x.err); });
  const cm = Object.values(clusters).map(median);
  return { n: rows.length, projects: cm.length, projectWeightedMedian: r3(median(cm)), median: r3(median(rows.map(x => x.err))), medianAbs: r3(median(rows.map(x => Math.abs(x.err)))) };
}

async function accuracy(opts) {
  const root = opts.root || ROOT;
  const dir = opts.dir || path.join(root, "data/comparables");
  const snap = JSON.parse(fs.readFileSync(path.join(dir, "batangas-latest.json"), "utf8"));
  const EST = loadEstimator(root);
  const rows = [], skipped = [];
  for (const r of snap.records) {
    if (["vacant_lot", "house_lot", "townhouse"].indexOf(r.kind) < 0) continue;
    const type = r.kind === "vacant_lot" ? "vacant_lot" : "house_lot";
    const e = await EST.estimate({
      purpose: "selling", type, municipality: r.municipality, barangay: r.barangay,
      streetKey: r.streetKey || "", allOther: !r.streetKey, classification: "RR", area: r.lotArea,
      saleContext: "private-resale", landMethod: "factor", features: [],
      floorArea: r.floorArea || 0, construction: "mixed_chb", floors: "1", ageBand: "6-10"
    });
    if (!e || e.available === false || !(e.total > 0)) { skipped.push({ id: r.id, reason: (e && e.reason) || "no estimate" }); continue; }
    rows.push({ r, kind: type, err: e.total / r.price - 1, model: e.total, cluster: type + "|" + r.municipality + "|" + (r.project || r.barangay) });
  }

  const byKind = {}, byTown = {}, bySource = {}, clusters = {};
  rows.forEach(x => {
    (byKind[x.kind] = byKind[x.kind] || []).push(x);
    (byTown[x.r.municipality + "|" + x.kind] = byTown[x.r.municipality + "|" + x.kind] || []).push(x);
    (bySource[x.r.source] = bySource[x.r.source] || []).push(x);
    (clusters[x.cluster] = clusters[x.cluster] || []).push(x);
  });
  const report = {
    note: "Value Guide vs this month's bank listings (market-scan/comparables/accuracy.js). error = guide / bank price - 1. Bank 'as is' prices usually sit below resale, so +0% to +25% is expected. Headline = project-weighted median. Report only: nothing here changes a price.",
    generatedOn: opts.today || new Date().toISOString().slice(0, 10),
    snapshotMonth: snap.month,
    calculationVersion: null,
    overall: Object.fromEntries(Object.keys(byKind).sort().map(k => [k, summarise(byKind[k])])),
    byTown: Object.keys(byTown).sort().map(k => { const [town, kind] = k.split("|"); return Object.assign({ town, kind }, summarise(byTown[k])); }),
    bySource: Object.fromEntries(Object.keys(bySource).sort().map(k => [k, summarise(bySource[k])])),
    projects: Object.keys(clusters).map(k => {
      const xs = clusters[k], [kind, town, name] = k.split("|");
      return { kind, town, name, n: xs.length, birRate: xs[0].r.birRate, matchLevel: xs[0].r.matchLevel, medianError: r3(median(xs.map(x => x.err))) };
    }).sort((a, b) => a.medianError - b.medianError),
    skipped
  };
  /* the estimator's own version, so a jump can be tied to a model change */
  try { report.calculationVersion = JSON.parse(fs.readFileSync(path.join(root, "data/zonal-config.json"), "utf8")).calculationVersion || null; } catch (e) { /* optional */ }

  /* problems: out of band, or a big move since last month */
  const problems = [];
  const historyFile = path.join(dir, "history.json");
  const history = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, "utf8")) : { months: [] };
  const prior = history.months.filter(m => m.month !== snap.month && m.accuracy).slice(-1)[0];
  Object.keys(report.overall).forEach(k => {
    const o = report.overall[k], band = BANDS[k];
    if (!band || o.projects < MIN_CLUSTERS) return;
    const pct = v => (v >= 0 ? "+" : "") + Math.round(v * 100) + "%";
    if (o.projectWeightedMedian < band[0] || o.projectWeightedMedian > band[1]) {
      problems.push("accuracy: " + k + " guide vs bank prices " + pct(o.projectWeightedMedian) + " (project-weighted, " + o.projects + " projects) is outside " + pct(band[0]) + " to " + pct(band[1]) + " - review the factors for this kind");
    }
    const was = prior && prior.accuracy[k];
    if (was != null && Math.abs(o.projectWeightedMedian - was) > SHIFT_ALERT) {
      problems.push("accuracy: " + k + " moved from " + pct(was) + " last month to " + pct(o.projectWeightedMedian) + " - check whether the data or the model changed (calculation " + (report.calculationVersion || "?") + ")");
    }
  });

  fs.writeFileSync(path.join(dir, "accuracy-latest.json"), JSON.stringify(report, null, 1) + "\n");
  const entry = history.months.find(m => m.month === snap.month);
  if (entry) {
    entry.accuracy = Object.fromEntries(Object.keys(report.overall).map(k => [k, report.overall[k].projectWeightedMedian]));
    entry.accuracyCalculationVersion = report.calculationVersion;
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 1) + "\n");
  }
  return { report, problems };
}

if (require.main === module) {
  accuracy({ today: arg("today") }).then(({ report, problems }) => {
    const pct = v => v == null ? "-" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
    Object.keys(report.overall).forEach(k => {
      const o = report.overall[k];
      console.log(k.padEnd(11) + " n=" + o.n + " projects=" + o.projects + "  project-weighted " + pct(o.projectWeightedMedian) + "  plain median " + pct(o.median) + "  median |error| " + pct(o.medianAbs));
    });
    problems.forEach(p => console.log("PROBLEM " + p));
    const reportFile = arg("report");
    if (reportFile) {
      let run = { ok: true, problems: [] };
      try { run = JSON.parse(fs.readFileSync(reportFile, "utf8")); } catch (e) { /* build report missing: start one */ }
      run.problems = (run.problems || []).concat(problems);
      run.accuracy = report.overall;
      fs.writeFileSync(reportFile, JSON.stringify(run, null, 2));
    }
  }).catch(e => { console.error(e.stack || e); process.exit(1); });
}

module.exports = { accuracy, loadEstimator, BANDS, MIN_CLUSTERS, SHIFT_ALERT };
