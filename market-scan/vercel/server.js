"use strict";

// Local dev server for the Market Scan engine (replaces the PowerShell
// HttpListener for testing). Run:  node server.js
// Serves http://localhost:8932/api/ping and /api/market-scan
// /api/market-scan uses the same two-tier cache handler as the Vercel function
// (lib/handler.js); without KV env vars it degrades to the in-memory fallback.

const http = require("http");
const { handleMarketScan } = require("./lib/handler");
const { findStores } = require("./lib/store_chains");

const PORT = parseInt(process.env.PORT || "8932", 10);

const storesCache = new Map();
const storesInflight = new Map();
const storesLastRefresh = new Map();
const STORES_TTL_MS = 24 * 3600 * 1000;
const STORES_RATE_LIMIT_MS = 60 * 1000;

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  const url = new URL(req.url, "http://localhost:" + PORT);
  const send = (status, obj) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method !== "GET") {
      send(405, { ok: false, error: "Method not allowed" });
      return;
    }
    if (url.pathname === "/api/ping") {
      send(200, { ok: true, server: "market-scan", time: new Date().toISOString().slice(0, 19) });
      return;
    }
    if (url.pathname === "/api/market-scan") {
      const query = {};
      for (const [k, v] of url.searchParams.entries()) query[k] = v;
      const { payload, cacheControl } = await handleMarketScan(query);
      res.setHeader("Cache-Control", cacheControl);
      send(200, payload);
      return;
    }
    if (url.pathname === "/api/market-scan/stores") {
      const cat = url.searchParams.get("cat") || "";
      const minBranches = url.searchParams.get("minBranches") || "3";
      const region = url.searchParams.get("region") || "";
      const province = url.searchParams.get("province") || "";
      const city = url.searchParams.get("city") || "";
      const forced = url.searchParams.get("refresh") === "1";
      const key = [region, province, city, cat, minBranches].join("|");
      const now = Date.now();
      const hit = storesCache.get(key);
      const fresh = !!(hit && now - hit.at < STORES_TTL_MS);
      const serve = (entry, meta) => {
        const warnings = (entry.data.warnings || []).slice();
        (meta.warnings || []).forEach(w => warnings.push(w));
        send(200, Object.assign({}, entry.data, {
          cached: !!meta.cached,
          refreshed: !!meta.refreshed,
          stale: !!meta.stale,
          cachedAt: new Date(now).toISOString(),
          warnings: warnings
        }));
      };
      const scan = () => {
        if (storesInflight.has(key)) return storesInflight.get(key);
        const p = findStores({ cat, minBranches, region, province, city })
          .then(data => { storesCache.set(key, { at: Date.now(), data: data }); return data; })
          .finally(() => storesInflight.delete(key));
        storesInflight.set(key, p);
        return p;
      };
      if (!forced && fresh) { serve(hit, { cached: true }); return; }
      if (forced) {
        const last = storesLastRefresh.get(key) || 0;
        if (now - last < STORES_RATE_LIMIT_MS) {
          if (fresh) { serve(hit, { cached: true, warnings: ["Refresh rate limit: wait about a minute before refreshing this location again."] }); return; }
          send(429, { ok: false, error: "Refresh rate limit — retry in about a minute", cachedAt: new Date().toISOString() });
          return;
        }
        storesLastRefresh.set(key, now);
      }
      scan().then(data => serve({ data: data }, { refreshed: !!forced }))
        .catch(err => {
          if (fresh) { serve(hit, { cached: true, stale: true, warnings: ["Refresh failed: " + String((err && err.message) || err) + " — showing last known good data instead."] }); return; }
          send(500, { ok: false, error: String((err && err.message) || err) });
        });
      return;
    }
    send(404, { ok: false, error: "Not found: " + url.pathname });
  } catch (err) {
    send(err && err.status === 400 ? 400 : 500, { ok: false, error: String(err && err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log("Market Scan server listening on http://localhost:" + PORT);
});