// tools/market_scan_check.js against a stand-in market scan server: healthy,
// no listings, a broken core source, a dead service.
"use strict";
const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { check, markdown, maxResultsFor } = require("../tools/market_scan_check.js");
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? "  " + detail : "")); passed++; console.log("[PASS] " + name); };

function serve(handler) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => { const out = handler(new URL(req.url, "http://x")); res.writeHead(out.status || 200, { "content-type": "application/json" }); res.end(typeof out.body === "string" ? out.body : JSON.stringify(out.body)); });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, base: "http://127.0.0.1:" + srv.address().port }));
  });
}
const src = (name, count, status = count ? "ok" : "empty", error = "") => ({ name, label: name, status, count, error });

(async () => {
  ok("the result count changes every day (no stale cached answer)", maxResultsFor(new Date("2026-10-18T00:00:00Z")) !== maxResultsFor(new Date("2026-10-19T00:00:00Z")));

  let seen = [];
  let s = await serve(u => { seen.push(u.pathname + u.search); if (u.pathname === "/api/ping") return { body: { ok: true } }; return { body: { ok: true, total: 7, sources: [src("dotproperty", 5), src("myproperty", 2), src("websearch", 0)] } }; });
  let r = await check(s.base, { now: new Date("2026-10-18T19:00:00Z") });
  ok("healthy: passes", r.ok && r.problems.length === 0, JSON.stringify(r.problems));
  ok("healthy: scans two Batangas towns live", seen.filter(x => /^\/api\/market-scan\?/.test(x)).length === 2 && seen.some(x => /city=Batangas\+City/.test(x) && /live=1/.test(x)) && seen.some(x => /city=Lipa/.test(x)));
  ok("healthy: the summary lists each source", /\| dotproperty \| ok \| 5 \|/.test(markdown(r)));
  s.srv.close();

  s = await serve(u => u.pathname === "/api/ping" ? { body: { ok: true } } : { body: { ok: true, total: 0, sources: [src("dotproperty", 0, "error", "HTTP 403"), src("myproperty", 0)] } });
  r = await check(s.base);
  ok("no listings: needs attention", !r.ok && r.problems.some(p => /no listings came back/.test(p)));
  ok("a core site with nothing in every scan is named, with its error", r.problems.some(p => /^dotproperty returned no listings in any scan: error \(HTTP 403\)/.test(p)), JSON.stringify(r.problems));
  s.srv.close();

  s = await serve(u => u.pathname === "/api/ping" ? { body: { ok: true } } : { body: { ok: true, total: 3, sources: [src("dotproperty", 0, "error", "blocked"), src("myproperty", 3)] } });
  r = await check(s.base);
  ok("one core site down while others work: still flagged", !r.ok && r.problems.length === 1 && /dotproperty/.test(r.problems[0]));
  s.srv.close();

  s = await serve(u => u.pathname === "/api/ping" ? { status: 500, body: "oops" } : { status: 500, body: { ok: false, error: "Function crashed" } });
  r = await check(s.base);
  ok("service broken: the ping and both scans are reported", !r.ok && r.problems.some(p => /doesn't answer/.test(p)) && r.problems.filter(p => /the scan failed \(Function crashed\)/.test(p)).length === 2);
  s.srv.close();

  r = await check("http://127.0.0.1:9", { timeoutMs: 2000 });
  ok("service unreachable: reported, no crash", !r.ok && r.problems.length >= 3);

  const wf = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/market-scan-nightly.yml"), "utf8");
  ok("workflow: runs nightly and by hand, never on push", /schedule:[\s\S]*cron:/.test(wf) && /workflow_dispatch/.test(wf) && !/\n  push:/.test(wf));
  ok("workflow: opens or updates one issue, and closes it when healthy", /gh issue create/.test(wf) && /gh issue comment/.test(wf) && /gh issue close/.test(wf));

  console.log("\nmarket_scan_check_node: " + passed + " checks passed");
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
