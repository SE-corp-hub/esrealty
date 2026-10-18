#!/usr/bin/env node
// Nightly check of the hosted Market Scan (the Vercel function the app falls
// back to). Runs a couple of real scans and says whether listings still come
// back, source by source. Used by .github/workflows/market-scan-nightly.yml;
// it never blocks a push.
//
//   node tools/market_scan_check.js [--base URL] [--report file.json] [--markdown file.md]
//
// Exit code 0 = healthy, 1 = needs attention (the report says why).
"use strict";
const fs = require("fs");

const DEFAULT_BASE = "https://esrealty-market-scan.vercel.app";
// Batangas towns the business works in; two property types.
const QUERIES = [
  { city: "Batangas City", type: "house", mode: "sale" },
  { city: "Lipa", type: "lot", mode: "sale" },
];
// The two sites the scan reads directly; the rest come through web searches.
const CORE = ["dotproperty", "myproperty"];

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function getJson(url, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "esrealty-nightly-check" } });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: res.status, body, text: text.slice(0, 300) };
  } catch (e) {
    return { status: 0, body: null, text: String(e && e.name === "AbortError" ? "timed out after " + Math.round(timeoutMs / 1000) + "s" : (e && e.message) || e) };
  } finally { clearTimeout(t); }
}

// A different result count each day, so a cached answer from yesterday isn't
// mistaken for a scan that worked today.
function maxResultsFor(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start) / 86400000);
  return 20 + (day % 7);
}

async function check(base, opts = {}) {
  const now = opts.now || new Date();
  const timeoutMs = opts.timeoutMs || 90000;
  const report = { ok: true, checkedAt: now.toISOString(), base, problems: [], scans: [] };

  const ping = await getJson(base + "/api/ping", 20000);
  report.ping = { status: ping.status, ok: !!(ping.body && ping.body.ok) };
  if (!report.ping.ok) report.problems.push("the service doesn't answer (/api/ping: " + (ping.status || ping.text) + ")");

  const n = maxResultsFor(now);
  for (const q of QUERIES) {
    const qs = new URLSearchParams(Object.assign({}, q, { maxResults: String(n), live: "1" })).toString();
    const r = await getJson(base + "/api/market-scan?" + qs, timeoutMs);
    const scan = { query: q.city + " · " + q.type + " · " + q.mode, status: r.status, total: 0, cached: false, sources: [] };
    if (!r.body || r.body.ok !== true) {
      scan.error = r.body && r.body.error ? String(r.body.error) : (r.status ? "HTTP " + r.status : r.text);
      report.problems.push(scan.query + ": the scan failed (" + scan.error + ")");
    } else {
      scan.total = Number(r.body.total || 0);
      scan.cached = !!r.body.cached;
      scan.sources = (r.body.sources || []).map(s => ({ name: s.name, label: s.label, status: s.status, count: Number(s.count || 0), error: s.error || "" }));
      if (!scan.total) report.problems.push(scan.query + ": no listings came back from any source");
    }
    report.scans.push(scan);
  }

  // A core site that answers nothing in every scan usually means it changed its pages.
  for (const name of CORE) {
    const rows = report.scans.map(s => s.sources.find(x => x.name === name)).filter(Boolean);
    if (rows.length && rows.every(x => !x.count)) {
      const why = rows.map(x => x.status + (x.error ? " (" + x.error.slice(0, 120) + ")" : "")).join("; ");
      report.problems.push(name + " returned no listings in any scan: " + why);
    }
  }
  report.ok = report.problems.length === 0;
  return report;
}

function markdown(r) {
  const lines = [
    (r.ok ? "Market scan check passed" : "The nightly market scan check needs attention") + " (" + r.checkedAt.slice(0, 10) + ", " + r.base + ").", "",
  ];
  if (r.problems.length) { lines.push(...r.problems.map(p => "- " + p), ""); }
  for (const s of r.scans) {
    lines.push("**" + s.query + "**: " + (s.error ? "failed (" + s.error + ")" : s.total + " listings" + (s.cached ? " (cached answer)" : "")));
    if (s.sources.length) {
      lines.push("", "| Source | Status | Listings |", "|---|---|---|");
      for (const x of s.sources) lines.push("| " + x.label + " | " + x.status + (x.error ? ": " + x.error.slice(0, 80).replace(/\|/g, "/") : "") + " | " + x.count + " |");
    }
    lines.push("");
  }
  lines.push("Sources change their pages from time to time; a source with 0 listings for a few nights in a row usually needs its reader in market-scan/vercel/lib/_lib.js updated.");
  return lines.join("\n");
}

if (require.main === module) {
  (async () => {
    const base = arg("--base", process.env.MARKET_SCAN_BASE || DEFAULT_BASE).replace(/\/+$/, "");
    const r = await check(base);
    const md = markdown(r);
    const rep = arg("--report", ""), mdf = arg("--markdown", "");
    if (rep) fs.writeFileSync(rep, JSON.stringify(r, null, 2));
    if (mdf) fs.writeFileSync(mdf, md);
    console.log(md);
    process.exit(r.ok ? 0 : 1);
  })();
}

module.exports = { check, markdown, maxResultsFor, QUERIES, CORE };
