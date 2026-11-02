#!/usr/bin/env node
"use strict";
/* Town price trend proposals (accuracy plan item 2.1) - suggestions for a
 * person to review, never applied by this script and never used to index a
 * price.
 *
 *   node market-scan/comparables/trend.js [--today YYYY-MM-DD] [--dir data/comparables]
 *
 * data/comparables/history.json keeps one summary per monthly run, with the
 * median bank/Pag-IBIG price per sqm by town and kind (built / vacant). Once a
 * town has at least MIN_MONTHS months with MIN_RECORDS prices each inside the
 * trailing WINDOW_MONTHS, this writes the change from the first of those
 * months to the latest, and the annualised rate, to
 * data/comparables/trend-latest.json as a "proposed" row.
 *
 * The site shows a town's trend only when a person has changed that row's
 * status to "reviewed" (and filled reviewedBy / reviewedOn) in the file. A
 * later run keeps a reviewed row reviewed while its change stays within
 * REREVIEW_SHIFT of the reviewed figure; when it moves more, the row goes to
 * "re-review" and disappears from the site until someone looks again.
 *
 * The BSP Residential Property Price Index is kept in the file as context for
 * the reviewer (a province-level check, not an input); it is copied from the
 * previous file so a reviewer's notes survive the monthly rewrite. */

const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };

const RULES = { MIN_MONTHS: 3, MIN_RECORDS: 5, WINDOW_MONTHS: 12, REREVIEW_SHIFT: 0.02 };

const BSP_CONTEXT = {
  index: "Residential Property Price Index (RPPI), Bangko Sentral ng Pilipinas",
  latest: "2026 Q2 (published 2026-09-25)",
  note: "Nationwide index barely rose year on year; Areas Outside NCR fell year on year for the first time in the series; NCR rose; condominium prices up, house prices down. Qualitative only - fill in the published percentages when reviewing.",
  where: "bsp.gov.ph > Statistics > Prices > Residential Property Price Index"
};

const r3 = x => Math.round(x * 1000) / 1000;
function monthsBetween(a, b) {
  const [ay, am] = String(a).split("-").map(Number), [by, bm] = String(b).split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

function trend(opts) {
  opts = opts || {};
  const dir = opts.dir || path.join(ROOT, "data/comparables");
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const file = path.join(dir, "trend-latest.json");
  const history = JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8"));
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { towns: [], context: null };
  const months = (history.months || []).slice().sort((a, b) => a.month.localeCompare(b.month));
  const latest = months.length ? months[months.length - 1].month : "";
  const window = months.filter(m => latest && monthsBetween(m.month, latest) < RULES.WINDOW_MONTHS);

  const series = {};
  window.forEach(m => (m.byTown || []).forEach(t => {
    if (!(t.n >= RULES.MIN_RECORDS) || !(t.medianPricePerSqm > 0)) return;
    const k = t.town + "|" + t.kind;
    (series[k] = series[k] || []).push({ month: m.month, n: t.n, median: t.medianPricePerSqm });
  }));

  const towns = [];
  Object.keys(series).sort().forEach(k => {
    const pts = series[k];
    if (pts.length < RULES.MIN_MONTHS) return;
    const [town, kind] = k.split("|");
    const first = pts[0], last = pts[pts.length - 1];
    const span = monthsBetween(first.month, last.month);
    if (span < 2) return;
    const changePct = r3(last.median / first.median - 1);
    const annualizedPct = r3(Math.pow(last.median / first.median, 12 / span) - 1);
    const prev = (previous.towns || []).find(t => t.town === town && t.kind === kind);
    let status = "proposed", reviewedBy = "", reviewedOn = "";
    if (prev && prev.status === "reviewed") {
      if (Math.abs(Number(prev.changePct) - changePct) <= RULES.REREVIEW_SHIFT) { status = "reviewed"; reviewedBy = prev.reviewedBy || ""; reviewedOn = prev.reviewedOn || ""; }
      else status = "re-review";
    }
    towns.push({ town, kind, months: span, points: pts.length, from: first.month, to: last.month, first: first.median, last: last.median, changePct, annualizedPct, status, reviewedBy, reviewedOn, series: pts });
  });

  const out = {
    note: "Town price trend proposals from the monthly bank and Pag-IBIG medians in history.json (market-scan/comparables/trend.js). A row is shown on the site only with status \"reviewed\"; nothing here indexes a price.",
    generatedOn: today,
    latestMonth: latest,
    monthsOfHistory: months.length,
    rules: RULES,
    status: towns.length ? "proposed" : "insufficient-history",
    statusNote: towns.length ? towns.length + " town row(s) with " + RULES.MIN_MONTHS + "+ months of " + RULES.MIN_RECORDS + "+ prices" : "needs " + RULES.MIN_MONTHS + " months with " + RULES.MIN_RECORDS + "+ prices for a town; " + months.length + " month(s) of history so far",
    towns,
    context: previous.context || BSP_CONTEXT
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  return out;
}

if (require.main === module) {
  const out = trend({ dir: arg("dir") ? path.resolve(arg("dir")) : undefined, today: arg("today") });
  out.towns.forEach(t => console.log((t.town + " " + t.kind).padEnd(28) + " " + t.from + " -> " + t.to + "  " + (t.changePct >= 0 ? "+" : "") + Math.round(t.changePct * 1000) / 10 + "% (" + t.points + " months)  " + t.status));
  console.log("TREND " + out.status + ": " + out.statusNote);
}

module.exports = { trend, RULES, BSP_CONTEXT };
