#!/usr/bin/env node
"use strict";

// =====================================================================
// SEA ESTATES — Market Price Index builder
// Pulls live scans from the Market Scan API, keeps only REAL portal
// listings (DotProperty / MyProperty), computes the median ₱/sqm per
// city for today, and merges it into data/market-index.json.
//
// Usage:
//   MS_API_URL=https://esrealty-market-scan.vercel.app node build-index.js
//   (defaults to http://localhost:8932 for local runs)
//
// Designed to run daily from a GitHub Action; commits are made by the
// workflow, not this script.
// =====================================================================

const fs = require("fs");
const path = require("path");

const API = process.env.MS_API_URL || "http://localhost:8932";
const OUT = path.join(__dirname, "..", "data", "market-index.json");
const MAX_DAYS = 540;

// Cities tracked by the index (PH primary + growth corridors)
const CITIES = [
  "Manila", "Makati", "Taguig", "Pasig", "Quezon City", "Mandaluyong",
  "Parañaque", "Pasay", "Muntinlupa",
  "Cebu City", "Mandaue", "Lapu-Lapu",
  "Davao City", "Iloilo City", "Bacolod", "Cagayan de Oro",
  "Baguio", "Angeles", "San Fernando",
  "Imus", "Bacoor", "Dasmariñas", "General Trias", "Santa Rosa",
  "Biñan", "Calamba", "Antipolo", "Tagaytay", "Lipa", "Batangas City"
];

const REAL_SOURCES = new Set(["dotproperty", "myproperty"]);

function median(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  if (!n) return 0;
  return n % 2 ? a[(n - 1) / 2] : Math.round((a[n / 2 - 1] + a[n / 2]) / 2);
}

async function scanCity(city) {
  const qs = new URLSearchParams({ city, mode: "sale", live: "1", maxResults: "60" });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(API + "/api/market-scan?" + qs.toString(), { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const psms = [];
    for (const l of data.listings || []) {
      if (!REAL_SOURCES.has(l.source)) continue;
      const area = l.lotArea > 0 ? l.lotArea : (l.floorArea > 0 ? l.floorArea : 0);
      if (!area || area < 10) continue;
      const psm = Number(l.pricePerSqm) || (l.price > 0 ? l.price / area : 0);
      if (psm > 5000 && psm < 2000000) psms.push(Math.round(psm)); // sanity band
    }
    return { city, psm: median(psms), n: psms.length };
  } catch (err) {
    console.error("  " + city + ": " + String(err && err.message || err));
    return { city, psm: 0, n: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  // Sequential to stay polite with portals through the scan API
  const results = [];
  for (const city of CITIES) {
    process.stdout.write("Scanning " + city + "… ");
    const r = await scanCity(city);
    console.log(r.n >= 3 ? ("₱" + r.psm.toLocaleString() + "/sqm (" + r.n + " samples)") : "insufficient samples");
    if (r.n >= 3) results.push(r);
  }

  if (!results.length) {
    // Leave the file exactly as it is: rewriting it here used to blank
    // `updated` and drop an earlier run's entry for today.
    console.log("No city produced enough samples today — keeping previous file unchanged.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  let doc = { updated: "", days: [] };
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
    if (prev && Array.isArray(prev.days)) doc.days = prev.days;
  } catch (e) { /* first run */ }

  // Replace today's entry if rerun, drop any older-than-MAX_DAYS
  const cutoff = new Date(Date.now() - MAX_DAYS * 86400000).toISOString().slice(0, 10);
  doc.days = doc.days.filter(d => d.d >= cutoff && d.d !== today);

  doc.days.push({
    d: today,
    cities: results.map(r => ({ c: r.city, p: r.psm, n: r.n }))
  });
  doc.updated = today;
  doc.days.sort((a, b) => a.d.localeCompare(b.d));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1));
  console.log("Wrote " + OUT + " (" + doc.days.length + " days, latest " + (doc.updated || "n/a") + ")");
}

main().catch(e => { console.error(e); process.exit(1); });
