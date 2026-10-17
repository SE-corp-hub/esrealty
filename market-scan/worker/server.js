"use strict";

// =====================================================================
//  Market Scan worker (SEA ESTATES) — runs on http://localhost:8932.
//  Zero required deps: plain Node http wrapper around the shared engine
//  (../vercel/lib/_lib.js), plus:
//    * listing history / price-drop tracking + live-median benchmarks (store.js)
//    * Facebook Marketplace scraping via optional Playwright (scan-browser.js)
//  The frontend uses this worker when the app runs on localhost and falls
//  back to the hosted Vercel function when this worker is down.
// =====================================================================

const http = require("http");
const path = require("path");
const { runMarketScan, mergeQueryDefaults, testListingMatch, htmlDecode } = require("../vercel/lib/_lib.js");
const { findStores } = require("../vercel/lib/store_chains.js");
const { cityInProvince } = require("../vercel/lib/ph_geo.js");

const storesCache = new Map();
const inflight = new Map();
const lastRefresh = new Map();
const STORES_TTL_MS = 24 * 3600 * 1000;
const { Store } = require("./store.js");
const fb = require("./scan-browser.js");

const PORT = Number(process.env.MS_PORT || 8932);
const store = new Store(path.join(__dirname, "store", "data.json"));

// ------------------------------------------------------------ helpers

function send(res, code, obj, extra) {
  const body = JSON.stringify(obj);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  };
  if (extra) { for (const k in extra) headers[k] = extra[k]; }
  res.writeHead(code, headers);
  res.end(body);
}

// Routes that only support GET/OPTIONS. Any other method on a known data
// route gets a proper 405 (with Allow) instead of a misleading 404.
const KNOWN_GET_ROUTES = new Set([
  "/api/market-scan",
  "/api/market-scan/bench",
  "/api/market-scan/stores",
  "/api/fb/status",
  "/api/fb/login"
]);

function storeKey(l) {
  let k = String(l.url || "").replace(/[?#].*$/, "");
  if (!k) k = "t|" + String(l.title || "").toLowerCase().slice(0, 90) + "|" + String(l.city || "").toLowerCase();
  return k;
}

// Price history enrichment: compare each listing to its previous observation.
function enrichWithHistory(listings) {
  const now = Date.now();
  const seenUrls = new Set();
  return listings.map(l => {
    if (!l) return l;
    let u = String(l.url || "").replace(/[?#].*$/, "");
    if (!u) u = "t|" + String(l.title || "").toLowerCase().slice(0, 90) + "|" + String(l.city || "").toLowerCase();
    if (!u || seenUrls.has(u)) return l;
    seenUrls.add(u);
    const prev = store.get(u);
    let priceChange = null;
    if (prev && prev.latestPrice > 0 && l.price > 0 && l.price !== prev.latestPrice) {
      const pct = Math.round(((l.price - prev.latestPrice) / prev.latestPrice) * 100);
      priceChange = { pct: Math.abs(pct), dir: pct < 0 ? "down" : "up" };
    }
    store.upsert(u, {
      url: l.url || "", title: l.title || "", city: l.city || "", price: l.price || 0,
      propertyType: l.propertyType || "", mode: l.mode || "",
      firstSeen: prev ? prev.firstSeen : now,
      latestPrice: (l.price > 0 && l.price !== (prev && prev.latestPrice)) ? l.price : (prev ? prev.latestPrice : 0),
      lastPrice: prev ? prev.latestPrice : 0,
      sourceId: l.sourceId || "", hash: u
    });
    return Object.assign({}, l, {
      scrapedAt: now, hash: u, priceChange: priceChange,
      firstSeenAt: prev ? prev.firstSeen : null
    });
  });
}

function collectBench(listings, mode) {
  for (const l of listings) {
    if (!l || l.source === "localbenchmark") continue;
    if (!(l.price > 0) || !(l.lotArea > 0 || l.floorArea > 0)) continue;
    if (!l.propertyType) continue;
    const area = l.lotArea > 0 ? l.lotArea : l.floorArea;
    const pps = Math.round(l.price / area);
    if (pps > 0) store.addBench(htmlDecode(l.city || ""), htmlDecode(l.propertyType), mode, pps, Date.now());
  }
}

// Normalize a property type to a canonical key so "House & Lot" matches the
// "House" labels DotProperty emits, "Condominium Unit" matches "Condo", etc.
function benchTypeKey(t) {
  const s = String(t || "").toLowerCase();
  if (s.indexOf("vacant lot") >= 0 || s.indexOf("land") >= 0) return "vacantlot";
  if (s.indexOf("condo") >= 0) return "condo";
  if (s.indexOf("townhouse") >= 0) return "townhouse";
  if (s.indexOf("apartment") >= 0) return "apartment";
  if (s.indexOf("house") >= 0 || s.indexOf("residential") >= 0) return "house";
  return s.replace(/[^a-z]/g, "");
}

// Live Benchmark source: one indicative row per city/type/mode, derived ONLY
// from real listings this worker has observed (store.js bench feed medians).
// Nothing is synthesized when there is no live data for the requested area.
function liveBenchmarkListings(q) {
  const mode = q.mode === "rent" ? "rent" : "sale";
  const wantCity = String(q.city || "").trim().toLowerCase();
  const wantProvince = String(q.province || "").trim();
  const wantType = String(q.type || "").trim();
  const wantKey = wantType ? benchTypeKey(wantType) : "";
  const pool = store.bench(0).slice().reverse();
  const out = [];
  for (const b of pool) {
    if (b.mode !== mode) continue;
    if (wantKey && benchTypeKey(b.type) !== wantKey) continue;
    const rawCity = htmlDecode(String(b.city || "").split(",")[0].trim());
    /* Province was never consulted, only city. A province-only query therefore
     * had no geographic constraint at all and emitted a median row for every
     * city the worker had ever seen. Each row does carry a real city, so
     * resolving that city against the PH region table is what makes a
     * province-scoped scan actually scoped. */
    if (wantProvince && !cityInProvince(rawCity, wantProvince)) continue;
    if (wantCity) {
      const head = rawCity.toLowerCase();
      if (head !== wantCity && head !== "city of " + wantCity) continue;
    }
    if (!(b.samples > 0) || !(b.medianPps > 0)) continue;
    const city = htmlDecode(String(b.city || "").split(",")[0].trim() || b.city);
    const type = htmlDecode(b.type || "");
    const isLot = benchTypeKey(type) === "vacantlot";
    const area = isLot ? 120 : benchTypeKey(type) === "condo" || benchTypeKey(type) === "apartment" ? 42 : 120;
    const price = mode === "rent"
      ? Math.round(b.medianPps * area * (0.0006 + 0.0000))
      : Math.ceil((b.medianPps * area) / 10000) * 10000;
    out.push({
      url: "",
      title: (isLot ? area + " sqm " : "2 Bedroom ") + type + " " + (mode === "rent" ? "for rent" : "for sale") + " in " + city,
      city: city, price: price, pricePerSqm: b.medianPps,
      lotArea: isLot ? area : 0, floorArea: isLot ? 0 : area,
      bedrooms: isLot ? 0 : 2, bathrooms: isLot ? 0 : 2,
      propertyType: type, verified: false,
      description: "Live median benchmark built from " + b.samples + " real " + type + " listing(s) observed in " + city + " (₱" + b.medianPps.toLocaleString() + "/sqm) — reference row derived from actual scanned data, not a specific listing.",
      image: "", sourceId: "", postedAt: "", scrapedAt: Date.now(), hash: "",
      source: "localbenchmark", sourceLabel: "Live Benchmark"
    });
  }
  return out;
}

// ------------------------------------------------------------ handlers

// Scan results are cached per *base* query - every criterion except `type`.
//
// The reason `type` is excluded from the cache key is that narrowing a filter
// has to be able to only ever shrink the result set. Previously each filter
// change re-ran the whole scan, so "Metro Manila" and "Metro Manila + Condo"
// were two independent live fetches of two different underlying datasets, and
// the condo scan could legitimately return MORE rows than the unfiltered one.
// Fetching type-agnostically and applying `type` locally makes the typed result
// a strict subset by construction, and makes toggling Type instant.
const scanCache = new Map();
const SCAN_TTL_MS = 90 * 1000;
const SCAN_CACHE_MAX = 24;

function scanCacheKey(q) {
  return JSON.stringify([
    q.region || "", q.province || "", q.city || "", q.mode,
    q.minPrice, q.maxPrice, q.minArea, q.minBeds, q.maxResults, !!q.live
  ]);
}

function clonePayload(p) {
  return JSON.parse(JSON.stringify(p));
}

async function fetchBaseScan(raw, q) {
  const key = scanCacheKey(q);
  const hit = scanCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < SCAN_TTL_MS) return clonePayload(hit.payload);

  // Strip `type` so one fetch serves every type variant of this query.
  const rawAll = Object.assign({}, raw);
  delete rawAll.type;
  const payload = await runMarketScan(rawAll);

  if (scanCache.size >= SCAN_CACHE_MAX) {
    // Drop the oldest insertion; Map preserves insertion order.
    const oldest = scanCache.keys().next().value;
    if (oldest !== undefined) scanCache.delete(oldest);
  }
  scanCache.set(key, { at: now, payload });
  return clonePayload(payload);
}

async function handleMarketScan(res, query) {
  const raw = {};
  for (const [k, v] of query) raw[k] = v;
  const q = mergeQueryDefaults(raw);
  const start = Date.now();

  const payload = await fetchBaseScan(raw, q);
  // The engine saw no `type`; report the type the caller actually asked for.
  if (payload.query) payload.query.type = q.type;

  payload.listings = enrichWithHistory(payload.listings || []);
  collectBench(payload.listings, q.mode);

  // Live Facebook Marketplace (optional Playwright) — merge in with the same
  // post-filtering the engine applies to its own sources. FB is asked without a
  // type for the same reason as the cached fetch: `type` is applied locally.
  const fbSrc = (payload.sources || []).find(s => s.name === "facebook");
  if (q.live && fb.available) {
    try {
      const r = await fb.search(Object.assign({}, q, { type: "" }));
      if (r.status === "ok" && r.listings.length) {
        const existing = new Set(payload.listings.map(l => String(l.url || "").replace(/[?#].*$/, "")));
        let added = 0;
        for (const l of r.listings) {
          const k = String(l.url || "").replace(/[?#].*$/, "");
          if (!k || existing.has(k)) continue;
          if (!testListingMatch(l, q)) continue;
          existing.add(k);
          l.source = "facebook";
          l.sourceLabel = "Facebook Marketplace · Live";
          payload.listings.push(Object.assign({}, l, { scrapedAt: Date.now() }));
          added++;
        }
        if (added) {
          if (fbSrc) { fbSrc.status = "ok"; fbSrc.count = added; fbSrc.error = ""; }
          collectBench(payload.listings.filter(x => x.source === "facebook"), q.mode);
        }
      } else if (fbSrc) {
        fbSrc.status = r.status || "blocked";
        fbSrc.error = r.error || "";
      }
    } catch (e) {
      if (fbSrc) { fbSrc.status = "error"; fbSrc.error = String((e && e.message) || e); }
    }
  }

  // Live Benchmark source (replaces the retired offline static table): rows
  // derived only from listings actually observed by this worker. Province
  // scoping is applied inside liveBenchmarkListings(), so a province-only query
  // no longer falls back to "every city the worker has ever seen". Type is
  // requested empty for the same reason as the cached fetch: the shared filter
  // at the end of this function is the single place `type` is applied.
  const benchRows = liveBenchmarkListings(Object.assign({}, q, { type: "" }));
  const lbSrc = (payload.sources || []).find(s => s.name === "localbenchmark");
  if (benchRows.length) {
    payload.listings = payload.listings.concat(benchRows);
    if (lbSrc) { lbSrc.status = "ok"; lbSrc.count = benchRows.length; lbSrc.label = "Live Benchmark"; lbSrc.error = ""; }
    else payload.sources.push({ name: "localbenchmark", label: "Live Benchmark", status: "ok", count: benchRows.length, error: "" });
  } else if (lbSrc) {
    payload.sources = payload.sources.filter(s => s.name !== "localbenchmark");
  }

  /* Filter BEFORE capping, which is the order the hosted Vercel function already
   * uses (_lib.js: uniq.filter(testListingMatch) then slice). The worker used to
   * cap first and never re-filter, so the rows that survived were chosen by
   * source alone: narrowing a filter re-rolled a different set rather than
   * returning a subset. Facebook and benchmark rows are merged in above the
   * cap, so the union has to be re-filtered here, once, at the end. */
  payload.listings = (payload.listings || []).filter(l => testListingMatch(l, q));
  payload.listings = interleaveBySource(payload.listings, Math.max(1, q.maxResults));

  // Reconcile per-source counts to the rows actually sent (a source's found
  // count is pre-dedupe and can exceed its unique rows after cross-source
  // collapse). Keeps chips/dropdown true to what the user can filter.
  const sentSrc = {};
  for (const l of payload.listings) { const k = (l && l.source) || "?"; sentSrc[k] = (sentSrc[k] || 0) + 1; }
  for (const s of payload.sources || []) s.count = sentSrc[s.name] || 0;

  payload.total = payload.listings.length;
  payload.shown = payload.listings.length;
  payload.elapsedMs = Date.now() - start;
  payload.worker = { version: "1.0.0", fb: fb.availableInfo() };
  send(res, 200, payload);
}

// Evenly mix sources so low-yield sources (web search, benches) still appear
// within the maxResults cap — otherwise the client-side Source filter could
// never show them (the first N rows are usually all DotProperty).
function interleaveBySource(rows, cap) {
  const groups = new Map();
  for (const l of rows) {
    const k = (l && l.source) || "?";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(l);
  }
  const keys = [...groups.keys()];
  const out = [];
  const idx = new Map(keys.map(k => [k, 0]));
  while (out.length < cap) {
    let added = false;
    for (const k of keys) {
      const arr = groups.get(k), i = idx.get(k);
      if (i < arr.length && out.length < cap) { out.push(arr[i]); idx.set(k, i + 1); added = true; }
    }
    if (!added) break;
  }
  return out;
}

// ------------------------------------------------------------ main

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost:" + PORT);
  const pathSegments = url.pathname.split("/").filter(Boolean);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/ping") {
    send(res, 200, { ok: true, server: "market-scan-worker", time: new Date().toISOString().slice(0, 19), fb: fb.availableInfo() });
    return;
  }
  if (url.pathname === "/api/market-scan" && req.method === "GET") {
    handleMarketScan(res, url.searchParams).catch(e => send(res, 500, { ok: false, error: String((e && e.message) || e) }));
    return;
  }
  if (url.pathname === "/api/market-scan/bench" && req.method === "GET") {
    const n = parseInt(url.searchParams.get("n") || "30", 10);
    send(res, 200, { ok: true, benches: store.bench(Math.max(1, Math.min(200, n))) });
    return;
  }
  if (url.pathname === "/api/market-scan/stores" && req.method === "GET") {
    const cat = url.searchParams.get("cat") || "";
    const minBranches = url.searchParams.get("minBranches") || "3";
    const region = url.searchParams.get("region") || "";
    const province = url.searchParams.get("province") || "";
    const city = url.searchParams.get("city") || "";
    const forced = url.searchParams.get("refresh") === "1";
    const key = [region, province, city, cat, minBranches].join("|");
    const now = Date.now();
    const hit = storesCache.get(key);
    const fresh = !!(hit && now - hit.at < 24 * 3600 * 1000);
    const serve = (entry, meta) => {
      const warnings = (entry.data.warnings || []).slice();
      (meta.warnings || []).forEach(w => warnings.push(w));
      send(res, 200, Object.assign({}, entry.data, {
        cached: !!meta.cached,
        refreshed: !!meta.refreshed,
        stale: !!meta.stale,
        cachedAt: new Date(now).toISOString(),
        warnings: warnings
      }));
    };
    const scan = () => {
      if (inflight.has(key)) return inflight.get(key);
      const p = findStores({ cat, minBranches, region, province, city })
        .then(data => { storesCache.set(key, { at: Date.now(), data: data }); return data; })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    };
    if (!forced && fresh) { serve(hit, { cached: true }); return; }
    if (forced) {
      const last = lastRefresh.get(key) || 0;
      if (now - last < 60 * 1000) {
        if (fresh) { serve(hit, { cached: true, warnings: ["Refresh rate limit: wait about a minute before refreshing this location again."] }); return; }
        send(res, 429, { ok: false, error: "Refresh rate limit — retry in about a minute", cachedAt: new Date().toISOString() });
        return;
      }
      lastRefresh.set(key, now);
    }
    scan().then(data => serve({ data: data }, { refreshed: !!forced }))
      .catch(e => {
        if (fresh) { serve(hit, { cached: true, stale: true, warnings: ["Refresh failed: " + String((e && e.message) || e) + " — showing last known good data instead."] }); return; }
        send(res, 500, { ok: false, error: String((e && e.message) || e) });
      });
    return;
  }
  if (url.pathname === "/api/fb/status" && req.method === "GET") {
    send(res, 200, { ok: true, fb: fb.availableInfo() });
    return;
  }
  if (url.pathname === "/api/fb/login" && req.method === "GET") {
    if (!fb.available) { send(res, 200, { ok: false, error: "playwright not installed — run: cd market-scan\\worker && npm i playwright && npx playwright install chromium" }); return; }
    fb.login().then(ok => {
      if (res.writableEnded) return;
      send(res, 200, { ok: ok, note: ok ? "session saved — scan Facebook Marketplace now" : "timed out — press Run Search after finishing the login" });
    }).catch(e => send(res, 500, { ok: false, error: String((e && e.message) || e) }));
    return;
  }

  if (KNOWN_GET_ROUTES.has(url.pathname)) {
    send(res, 405, { ok: false, error: "Method not allowed" }, { Allow: "GET, OPTIONS" });
    return;
  }

  send(res, 404, { ok: false, error: "Not found: " + url.pathname });
});

// Local tool: listen on this computer only unless HOST says otherwise.
const HOST = process.env.HOST || "127.0.0.1";
server.listen(PORT, HOST, () => {
  console.log("Market Scan worker listening on http://" + (HOST === "127.0.0.1" ? "localhost" : HOST) + ":" + PORT);
  console.log("  /api/ping");
  console.log("  /api/market-scan?city=&type=&mode=&maxResults=&live=");
  console.log("  /api/market-scan/bench");
  console.log("  /api/fb/login           (one-time Facebook login, needs Playwright)");
  console.log("  playwright: " + (fb.available ? "installed" : "NOT installed (" + fb.bootError + ")"));
});

// Save any pending store writes on shutdown.
process.on("SIGINT", () => { store.saveNow(); process.exit(0); });
process.on("SIGTERM", () => { store.saveNow(); process.exit(0); });

module.exports = { server, store };