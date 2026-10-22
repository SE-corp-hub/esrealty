// Vercel endpoints (market-scan/vercel/api), Phase 1 security item 9:
// - agent-dispatch only starts a run for the Vercel scheduler (CRON_SECRET);
// - ad-perf only answers approved back-office staff.
"use strict";
const assert = require("assert");
const path = require("path");
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? " — " + detail : "")); passed++; console.log("[PASS] " + name); };

function fakeRes() {
  const res = { statusCode: 0, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { res.body = obj; return res; };
  res.end = text => { res.body = text === undefined ? res.body : text; return res; };
  return res;
}
function load(file, env) {
  const full = path.join(__dirname, "..", "market-scan/vercel/api", file);
  delete require.cache[require.resolve(full)];
  const saved = {};
  Object.keys(env).forEach(k => { saved[k] = process.env[k]; if (env[k] === null) delete process.env[k]; else process.env[k] = env[k]; });
  const mod = require(full);
  Object.keys(saved).forEach(k => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  return mod;
}

(async () => {
  // agent-dispatch
  let dispatch = load("agent-dispatch.js", { CRON_SECRET: "cron-123", AGENT_EDGE_URL: null, AGENT_EDGE_TOKEN: null });
  let res = fakeRes();
  await dispatch({ method: "GET", headers: {} }, res);
  ok("dispatch: a call without the cron secret is refused", res.statusCode === 401);
  res = fakeRes();
  await dispatch({ method: "GET", headers: { authorization: "Bearer cron-12" } }, res);
  ok("dispatch: a wrong secret is refused", res.statusCode === 401);
  res = fakeRes();
  await dispatch({ method: "GET", headers: { authorization: "Bearer cron-123" } }, res);
  ok("dispatch: the Vercel scheduler (right secret) gets through", res.statusCode === 200 && res.body && res.body.skipped, JSON.stringify(res.body));
  ok("dispatch: no browser access headers", !res.headers["access-control-allow-origin"]);
  dispatch = load("agent-dispatch.js", { CRON_SECRET: null, AGENT_EDGE_URL: null, AGENT_EDGE_TOKEN: null });
  res = fakeRes();
  await dispatch({ method: "GET", headers: {} }, res);
  ok("dispatch: without CRON_SECRET set it refuses everyone (fails closed)", res.statusCode === 401);
  res = fakeRes();
  await dispatch({ method: "GET", headers: { authorization: "Bearer " } }, res);
  ok("dispatch: an empty bearer is not a secret", res.statusCode === 401);

  // ad-perf
  const adPerf = load("ad-perf.js", { AD_PERF_SOURCE_URL: null });
  const people = {
    "a.b.agent": { id: "u1", profile: { role: "agent", registration_status: "approved" } },
    "a.b.pending": { id: "u2", profile: { role: "broker", registration_status: "pending" } },
    "a.b.buyer": { id: "u3", profile: { role: "buyer", registration_status: "approved" } },
  };
  const fakeFetch = async (url, init) => {
    const token = String(init.headers.Authorization || "").replace("Bearer ", "");
    const p = people[token];
    if (/\/auth\/v1\/user$/.test(url)) return { ok: !!p, json: async () => (p ? { id: p.id } : {}) };
    if (/\/rest\/v1\/profiles/.test(url)) return { ok: !!p, json: async () => (p && url.indexOf("eq." + p.id) >= 0 ? [p.profile] : []) };
    return { ok: false, json: async () => ({}) };
  };
  ok("ad-perf: an approved agent counts as staff", (await adPerf.staffRole("Bearer a.b.agent", fakeFetch)) === "agent");
  ok("ad-perf: a broker still waiting for approval does not", (await adPerf.staffRole("Bearer a.b.pending", fakeFetch)) === "");
  ok("ad-perf: a buyer does not", (await adPerf.staffRole("Bearer a.b.buyer", fakeFetch)) === "");
  ok("ad-perf: a made-up token does not", (await adPerf.staffRole("Bearer nonsense", fakeFetch)) === "");
  ok("ad-perf: no token at all does not", (await adPerf.staffRole("", fakeFetch)) === "");
  res = fakeRes();
  await adPerf({ method: "GET", headers: {} }, res);
  ok("ad-perf: a call without sign-in is refused", res.statusCode === 401, JSON.stringify(res.body));
  ok("ad-perf: the browser may send its sign-in token", /Authorization/.test(res.headers["access-control-allow-headers"] || ""));

  console.log("\nvercel_endpoints_node: " + passed + " checks passed");
})().catch(e => { console.error(e); process.exit(1); });
