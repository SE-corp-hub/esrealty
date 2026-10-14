#!/usr/bin/env node
"use strict";
/* Downloads each comparables source once into a raw/ folder. Kept separate from
   parsing so a failed parse can be debugged from the exact bytes that were
   fetched (the monthly workflow keeps raw/ as a build artifact for 30 days). */
const fs = require("fs"), path = require("path");
const SOURCES = require("./sources.json");
const OUT = process.argv[2] || path.join(__dirname, "raw");
/* Sources that need more than one plain download (several JSON calls) bring
   their own fetcher; it gets the same polite get() and returns the text to save. */
const FETCHERS = { pagibig: require("./sources/pagibig.js").fetchPagibig };
const UA = "SEA-ESTATES-comparables/1.0 (+https://github.com/tradersgag6/esrealty; monthly, one request per page)";

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "*/*" }, redirect: "follow" });
  if (!res.ok) throw new Error(url + " -> HTTP " + res.status);
  return Buffer.from(await res.arrayBuffer());
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = [];
  for (const s of SOURCES) {
    if (s.fetch === false) { report.push({ source: s.id, ok: false, skipped: true, error: "not fetched: " + (s.note || "disabled") }); continue; }
    for (const page of s.urls) {
      const file = path.join(OUT, s.id + "--" + page.name);
      try {
        const buf = FETCHERS[s.id]
          ? Buffer.from(await FETCHERS[s.id](async u => (await get(u)).toString("utf8"), ms => new Promise(r => setTimeout(r, ms))))
          : await get(page.url);
        fs.writeFileSync(file, buf);
        report.push({ source: s.id, page: page.name, ok: true, bytes: buf.length });
      } catch (e) {
        report.push({ source: s.id, page: page.name, ok: false, error: String(e.message || e) });
      }
      await new Promise(r => setTimeout(r, 1500)); /* be polite */
    }
  }
  fs.writeFileSync(path.join(OUT, "fetch-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.some(r => r.ok)) process.exit(1);
})();
