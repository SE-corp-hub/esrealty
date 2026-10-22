"use strict";

// Two-tier Market Scan handler (docs/audits/backend-ux-flow.md P1). Shared by the Vercel
// function (api/market-scan.js) and the local dev server (server.js) so the
// cache behavior is tested offline too.
//
// Flow:
//   live=1 + fresh KV snapshot -> respond instantly, schedule background refresh
//   live=1 + stale/missing     -> synchronous scan, write through to cache
//   live=0 + snapshot          -> respond instantly (KV only, no scrape)
//   live=0 + miss              -> fast empty result (runMarketScan with live=0
//                                  skips scraping; see mergeQueryDefaults)

const { runMarketScan } = require("./_lib");
const {
  cacheKey,
  readScan,
  writeScan,
  touchRefreshing,
  REFRESH_AFTER_MS,
  COALESCE_MS,
  TTL_SECONDS,
} = require("./cache");

let afterImpl = null;
try { afterImpl = require("@vercel/functions").after; } catch (e) { afterImpl = null; }

function isLive(q) {
  return !(String(q.live).trim() === "0" || String(q.live).trim() === "false");
}

// What a scan request may contain. City, province, region and type are typed by people, and
// the city is part of the cache key: each new string would start a scrape of up to 5 minutes.
// Place names are letters, digits, spaces and . , ' - only, at most 60 characters.
class QueryError extends Error {
  constructor(message) { super(message); this.name = "QueryError"; this.status = 400; }
}
const PLACE_OK = /^[\p{L}\p{N} .,'\u2019-]*$/u;
const SHORT_OK = /^[a-z0-9 &_-]*$/i;
const FIELD_LIMITS = [["city", 60, PLACE_OK], ["province", 60, PLACE_OK], ["region", 80, PLACE_OK], ["type", 30, SHORT_OK], ["mode", 10, SHORT_OK]];

function cleanQuery(query) {
  const q = Object.assign({}, query || {});
  for (const [name, max, ok] of FIELD_LIMITS) {
    if (Array.isArray(q[name])) throw new QueryError(name + " is invalid");
    const v = String(q[name] == null ? "" : q[name]).replace(/\s+/g, " ").trim();
    if (v.length > max || !ok.test(v)) throw new QueryError(name + " is invalid");
    q[name] = v;
  }
  for (const name of ["minPrice", "maxPrice", "minArea", "minBeds", "maxResults"]) {
    if (Array.isArray(q[name]) || String(q[name] == null ? "" : q[name]).length > 20) throw new QueryError(name + " is invalid");
  }
  return q;
}

const nowIso = () => new Date().toISOString();
const isoForHeader = iso => String(iso || "").slice(0, 19).replace("T", " ");

async function refreshScan(key, q) {
  // Background re-scrape: recompute, write through, clear the in-flight flag.
  // Best-effort — a failure leaves the previous snapshot in place.
  try {
    const fresh = await runMarketScan(q);
    await writeScan(key, { payload: fresh, fetchedAt: nowIso(), fetchingSince: null });
  } catch (e) { /* best-effort background refresh */ }
}

async function handleMarketScan(query) {
  const q = cleanQuery(query);
  const live = isLive(q);
  const key = cacheKey(q);

  const cached = await readScan(key);
  if (cached && cached.payload) {
    const fetchedMs = cached.fetchedAt ? new Date(cached.fetchedAt).getTime() : 0;
    if (live && fetchedMs && (Date.now() - fetchedMs) >= REFRESH_AFTER_MS) {
      const go = await touchRefreshing(key, COALESCE_MS);
      if (go) {
        const refresh = () => refreshScan(key, q);
        if (afterImpl) afterImpl(refresh);
        else refresh();
      }
    }
    return {
      payload: Object.assign({}, cached.payload, {
        cached: true,
        cachedAt: cached.fetchedAt || new Date().toISOString(),
        serverTime: nowIso().slice(0, 19),
      }),
      // TTL kept below the scan TTL so edge caches do not outlive the KV snapshot.
      cacheControl: "public, s-maxage=300, stale-while-revalidate=600",
    };
  }

  const fresh = await runMarketScan(q);
  try {
    await writeScan(key, { payload: fresh, fetchedAt: nowIso(), fetchingSince: null });
  } catch (e) { /* cache write failure is non-fatal */ }
  return {
    payload: Object.assign({}, fresh, {
      cached: false,
      fetchedAt: nowIso().slice(0, 19),
      serverTime: nowIso().slice(0, 19),
    }),
    cacheControl: "public, s-maxage=" + TTL_SECONDS + ", stale-while-revalidate=300",
  };
}

module.exports = { handleMarketScan, isLive, isoForHeader, cleanQuery, QueryError };