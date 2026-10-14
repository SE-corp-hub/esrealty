#!/usr/bin/env node
"use strict";
/* Monthly comparables snapshot for Batangas.
 *
 *   node market-scan/comparables/build-comparables.js --raw <dir> [--inbox <dir>]
 *        [--out data/comparables] [--report <file>] [--today YYYY-MM-DD]
 *
 * Reads what fetch-raw.js downloaded (<raw>/<source>--<name>) plus any file a
 * person dropped in the inbox (BDO blocks data-centre addresses, so its PDF may
 * arrive that way), parses each source, matches addresses to the BIR schedule,
 * removes duplicates and outliers, and writes:
 *
 *   data/comparables/batangas-latest.json  REPLACED every run. Last month's
 *       records are deleted: a property that was sold or withdrawn simply stops
 *       appearing. The one exception is a source that failed this month - its
 *       previous records are carried over once (marked carriedOver) so a site
 *       outage is not mistaken for every listing selling at once. A second
 *       failed month drops them.
 *   data/comparables/history.json  one small summary per month (counts and
 *       median price per sqm by town and kind) - trends without keeping rows.
 *
 * The report (JSON) lists problems for the workflow to raise as an issue.
 * Exit code 1 only when nothing usable was produced; the old snapshot is then
 * left untouched. */

const fs = require("fs"), path = require("path"), zlib = require("zlib");
const { parseBdoPdf } = require("./sources/bdo.js");
const { parseBpiHtml } = require("./sources/bpi.js");
const { loadBir, matchAddress } = require("./match.js");
const SOURCES = require("./sources.json");

const ROOT = path.resolve(__dirname, "../..");
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };

/* LandValuePH-style limits (their client code), plus a looser zonal ceiling for
   built properties whose price includes the house. */
const LIMITS = {
  vacant: { lowVsZonal: 0.5, highVsZonal: 5 },
  built: { lowVsZonal: 0.5, highVsZonal: 15 },
  lowVsPool: 0.35, highVsPool: 4, minPool: 3,
  oldWarn: 40,         /* days: still used, but the issue asks for a fresher file */
  stale: 62,           /* days: refused - this is no longer current data */
  dropWarn: 0.4,       /* warn when a source returns 40%+ fewer rows than last month */
  minMatchRate: 0.8    /* acceptance: >= 80% matched to a BIR barangay */
};

function kindOf(type) {
  const t = String(type || "").toLowerCase();
  if (/industrial/.test(t)) return "industrial_lot";
  if (/commercial|warehouse|building/.test(t)) return "commercial";
  if (/condo/.test(t)) return "condo";
  if (/town ?house|row ?house/.test(t)) return "townhouse";
  if (/vacant|lot only|^lot$|- lot$/.test(t)) return "vacant_lot";
  if (/house/.test(t)) return "house_lot";
  return "other";
}
const isVacant = k => k === "vacant_lot" || k === "industrial_lot";
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
/* Lot/block numbers, so two different lots at the same price are never merged. */
function lotBlockKey(address) {
  const a = String(address).toUpperCase();
  const lots = (a.match(/\bLOTS?\s+(\d[\dA-Z-]*(?:\s*(?:,|AND|&)\s*\d[\dA-Z-]*)*)/) || [])[1] || "";
  const blk = (a.match(/\b(?:BLOCK|BLK\.?)\s+(\d[\dA-Z-]*)/) || [])[1] || "";
  const key = (lots.replace(/\s+/g, "") + "/" + blk).replace(/^\/$/, "");
  return key || null;
}

async function inflate(buf) { return zlib.inflateSync(Buffer.from(buf)); }

/* ---- per-source readers: each file -> { observedOn, rows } or throws ---- */
const READERS = {
  bdo: {
    ext: /\.pdf$/i,
    inbox: n => /^bdo.*\.pdf$|batangas.*\.pdf$/i.test(n),
    read: async (file, today) => {
      const r = await parseBdoPdf(new Uint8Array(fs.readFileSync(file)), inflate);
      return { observedOn: r.asOf || today, rows: r.rows.map(x => ({ address: x.address, project: x.project, propertyType: x.propertyType, price: x.price, lotArea: x.lotArea, floorArea: x.floorArea })) };
    }
  },
  bpi: {
    ext: /\.html?$/i,
    inbox: n => /^bpi.*\.html?$/i.test(n),
    read: async (file, today) => ({ observedOn: today, rows: parseBpiHtml(fs.readFileSync(file, "utf8"), "Batangas").rows })
  }
};

/* Manual rows: inbox/<source>.rows.json = { observedOn, rows: [{ address,
   propertyType, price, lotArea, floorArea, project?, tag?, code? }] }. For a
   source no robot can read (Security Bank answers 403) or a month the fetch
   failed, a person can enter the table by hand; it goes through the same
   matching, filters and staleness rule as everything else. */
function readManual(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!/^\d{4}-\d\d-\d\d$/.test(j.observedOn || "") || !Array.isArray(j.rows)) throw new Error(path.basename(file) + ": needs observedOn (YYYY-MM-DD) and rows[]");
  j.rows.forEach((r, i) => { if (!r.address || !(r.price > 0) || !(r.lotArea > 0)) throw new Error(path.basename(file) + ": row " + i + " needs address, price and lotArea"); });
  return { observedOn: j.observedOn, rows: j.rows };
}

/* All candidates for a source (fetched files, inbox files, manual rows); the
   newest that parses wins, and it must be from the last ~2 months. */
async function readSource(s, opts, today) {
  const reader = READERS[s.id];
  const list = dir => (dir && fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  const files = [];
  if (reader) {
    list(opts.raw).filter(n => n.indexOf(s.id + "--") === 0 && reader.ext.test(n)).forEach(n => files.push([path.join(opts.raw, n), reader.read, "fetched " + n]));
    list(opts.inbox).filter(reader.inbox).forEach(n => files.push([path.join(opts.inbox, n), reader.read, "inbox/" + n]));
  }
  list(opts.inbox).filter(n => n === s.id + ".rows.json").forEach(n => files.push([path.join(opts.inbox, n), async f => readManual(f), "inbox/" + n]));
  if (!files.length) {
    if (!reader) return null; /* nothing to read and no robot for it: skipped, not failed */
    throw new Error(s.id + ": nothing fetched and nothing in the inbox");
  }
  let best = null, lastErr = null;
  for (const [f, read, from] of files) {
    try {
      const r = await read(f, today);
      if (!best || r.observedOn > best.observedOn) best = Object.assign(r, { file: f, from });
    } catch (e) { lastErr = e; }
  }
  if (!best) throw lastErr;
  const age = daysBetween(best.observedOn, today);
  if (age > LIMITS.stale) throw new Error(s.id + ": newest data is as of " + best.observedOn + " (" + age + " days old) - put a fresh file in market-scan/comparables/inbox/");
  return best;
}

function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } }

async function build(opts) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const outDir = opts.out;
  const latestFile = path.join(outDir, "batangas-latest.json");
  const historyFile = path.join(outDir, "history.json");
  const prev = readJson(latestFile, null);
  const bir = loadBir(opts.root || ROOT);
  const problems = [];
  const sourceStatus = [];
  let records = [];

  for (const s of SOURCES) {
    const status = { id: s.id, label: s.label, priceType: s.priceType, url: s.urls[0].url, status: "ok", observedOn: null, parsed: 0, kept: 0 };
    sourceStatus.push(status);
    try {
      const got = await readSource(s, opts, today);
      if (!got) { status.status = "skipped"; status.note = s.note || "no automatic reader and nothing in the inbox"; continue; }
      status.observedOn = got.observedOn;
      status.parsed = got.rows.length;
      status.from = got.from;
      const age = daysBetween(got.observedOn, today);
      if (age > LIMITS.oldWarn) problems.push(s.id + ": newest data is as of " + got.observedOn + " (" + age + " days old, still used) - put a fresher file in market-scan/comparables/inbox/");
      got.rows.forEach((r, i) => {
        const kind = kindOf(r.propertyType);
        const m = matchAddress(bir, r.address, kind);
        const ppsqm = r.lotArea > 0 ? Math.round(r.price / r.lotArea) : null;
        records.push({
          id: s.id + ":" + (r.code || (m.barangay || "x") + ":" + (lotBlockKey(r.address) || i) + ":" + r.price),
          source: s.id, priceType: s.priceType, saleCategory: "bank-acquired",
          kind, propertyType: r.propertyType, tag: r.tag || null,
          price: r.price, lotArea: r.lotArea, floorArea: r.floorArea || 0, pricePerSqmLot: ppsqm,
          address: r.address, project: r.project || "",
          municipality: m.municipality, barangay: m.barangay, streetKey: m.streetKey, matchLevel: m.matchLevel,
          birClass: m.birClass, birRate: m.birRate, ratioToBir: m.birRate && ppsqm ? +(ppsqm / m.birRate).toFixed(2) : null,
          observedOn: got.observedOn, url: s.urls[0].url
        });
      });
      /* A sharp drop usually means the page changed, not that the bank sold out. */
      const prevCount = prev && (prev.sources || []).find(x => x.id === s.id);
      if (prevCount && prevCount.parsed >= 10 && got.rows.length < prevCount.parsed * (1 - LIMITS.dropWarn)) {
        problems.push(s.id + ": " + got.rows.length + " rows this month vs " + prevCount.parsed + " last month - check the page/parser");
      }
    } catch (e) {
      status.status = "failed";
      status.error = String(e.message || e);
      problems.push(s.id + ": " + status.error);
      /* Carry last month's records over once. */
      const old = ((prev && prev.records) || []).filter(r => r.source === s.id && !r.carriedOver);
      if (old.length) {
        records = records.concat(old.map(r => Object.assign({}, r, { carriedOver: true })));
        status.status = "failed-carried-over";
        status.carriedOver = old.length;
      }
    }
  }

  /* ---- clean: outside Batangas, duplicates, outliers ---- */
  const rejected = [];
  const reject = (r, reason) => rejected.push({ id: r.id, source: r.source, reason, address: r.address, price: r.price, lotArea: r.lotArea });

  let kept = records.filter(r => {
    if (!r.municipality) { reject(r, "address not matched to a Batangas town"); return false; }
    if (!(r.lotArea > 0) || !(r.price > 0)) { reject(r, "missing price or lot area"); return false; }
    return true;
  });

  /* Duplicates: the same address twice in one source, or the same property on
     two sources (same barangay, lot area within 1 sqm, price within 2%, and no
     conflicting lot/block numbers). The first source in sources.json wins. */
  const seen = [];
  kept = kept.filter(r => {
    const lb = lotBlockKey(r.address);
    const dup = seen.find(o =>
      (o.source === r.source && o.address === r.address && o.price === r.price) ||
      (o.source !== r.source && o.barangay && o.barangay === r.barangay && Math.abs(o.lotArea - r.lotArea) <= 1 &&
        Math.abs(o.price - r.price) <= 0.02 * o.price && !(lb && lotBlockKey(o.address) && lb !== lotBlockKey(o.address))));
    if (dup) { reject(r, "duplicate of " + dup.id); return false; }
    seen.push(r);
    return true;
  });

  kept = kept.filter(r => {
    if (!r.ratioToBir) return true;
    const lim = isVacant(r.kind) ? LIMITS.vacant : LIMITS.built;
    if (r.ratioToBir < lim.lowVsZonal) { reject(r, "price/sqm " + r.ratioToBir + "x BIR, below " + lim.lowVsZonal + "x"); return false; }
    if (r.ratioToBir > lim.highVsZonal) { reject(r, "price/sqm " + r.ratioToBir + "x BIR, above " + lim.highVsZonal + "x"); return false; }
    return true;
  });

  const poolKey = r => r.municipality + "|" + (isVacant(r.kind) ? "vacant" : "built");
  const pools = {};
  kept.forEach(r => { (pools[poolKey(r)] = pools[poolKey(r)] || []).push(r.pricePerSqmLot); });
  kept = kept.filter(r => {
    const pool = pools[poolKey(r)];
    if (pool.length < LIMITS.minPool) return true;
    const ratio = r.pricePerSqmLot / median(pool);
    if (ratio < LIMITS.lowVsPool || ratio > LIMITS.highVsPool) { reject(r, "price/sqm " + ratio.toFixed(2) + "x the town median"); return false; }
    return true;
  });

  sourceStatus.forEach(st => { st.kept = kept.filter(r => r.source === st.id).length; });
  const fresh = kept.filter(r => !r.carriedOver);
  if (!kept.length) {
    problems.push("no usable records - snapshot NOT updated");
    return { ok: false, problems, sourceStatus };
  }
  const matched = fresh.filter(r => r.matchLevel === "barangay" || r.matchLevel === "street").length;
  const matchRate = fresh.length ? matched / fresh.length : 0;
  if (fresh.length && matchRate < LIMITS.minMatchRate) problems.push("only " + Math.round(matchRate * 100) + "% of records matched to a BIR barangay (target 80%)");

  kept.sort((a, b) => (a.municipality + a.barangay + a.address).localeCompare(b.municipality + b.barangay + b.address));
  const latest = {
    note: "Bank-acquired properties for sale in Batangas, refreshed monthly by .github/workflows/comparables-monthly.yml. Replaced in full each run: properties no longer listed are removed. Prices are the bank's advertised/selling prices ('as is, where is'), not closed sales. Personal data (sales officers) is never collected.",
    generatedOn: today, month,
    sources: sourceStatus,
    summary: { records: kept.length, carriedOver: kept.length - fresh.length, matchedToBarangay: matched, matchRate: +matchRate.toFixed(3), rejected: rejected.length },
    records: kept,
    rejected
  };

  /* history: one entry per month, replaced if the month is re-run */
  const history = readJson(historyFile, { note: "One summary per monthly comparables run. No individual listings are kept here.", months: [] });
  const byTown = {};
  kept.forEach(r => {
    const k = r.municipality + "|" + (isVacant(r.kind) ? "vacant" : "built");
    (byTown[k] = byTown[k] || []).push(r.pricePerSqmLot);
  });
  const entry = {
    month, generatedOn: today, records: kept.length, matchRate: latest.summary.matchRate,
    bySource: Object.fromEntries(sourceStatus.map(s => [s.id, { status: s.status, observedOn: s.observedOn, kept: s.kept }])),
    byTown: Object.keys(byTown).sort().map(k => { const [town, kind] = k.split("|"); return { town, kind, n: byTown[k].length, medianPricePerSqm: Math.round(median(byTown[k])) }; })
  };
  history.months = history.months.filter(m => m.month !== month).concat([entry]).sort((a, b) => a.month.localeCompare(b.month));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(latestFile, JSON.stringify(latest, null, 1) + "\n");
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 1) + "\n");
  return { ok: true, problems, sourceStatus, summary: latest.summary };
}

if (require.main === module) {
  build({
    root: ROOT,
    raw: arg("raw", path.join(__dirname, "raw")),
    inbox: arg("inbox", path.join(__dirname, "inbox")),
    out: arg("out", path.join(ROOT, "data/comparables")),
    today: arg("today")
  }).then(res => {
    const report = arg("report");
    if (report) fs.writeFileSync(report, JSON.stringify(res, null, 2));
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok) process.exit(1);
  }).catch(e => { console.error(e.stack || e); process.exit(1); });
}

module.exports = { build, kindOf, lotBlockKey, LIMITS };
