// Daily "Still available?" job (tools/listing_stale_sweep.js, backend roadmap A6). The SQL itself
// is run against Postgres in tests/db/test_broker_audit_ledger.sql; this checks the job around it.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const { main, daysFrom, DEFAULT_DAYS } = require(path.join(root, "tools/listing_stale_sweep.js"));
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? "  " + detail : "")); passed++; console.log("[PASS] " + name); };

(async () => {
  ok("75 idle days by default", DEFAULT_DAYS === 75 && daysFrom([]) === 75);
  ok("--days N changes it", daysFrom(["--days", "30"]) === 30);
  ["0", "-5", "abc", "1.5", "99999", ""].forEach(v => ok("--days " + JSON.stringify(v) + " is refused", (() => { try { daysFrom(["--days", v]); return false; } catch (e) { return /whole number/.test(e.message); } })()));
  ok("--days with no value is refused", (() => { try { daysFrom(["--days"]); return false; } catch (e) { return true; } })());

  // Dry run: asks for a dry run, sends nothing, logs counts only.
  const calls = [], lines = [];
  const rows = [
    { listing_id: "L-secret-1", owner_id: "u1", idle_days: 80, alerted: false },
    { listing_id: "L-secret-2", owner_id: "u1", idle_days: 120, alerted: false },
    { listing_id: "L-secret-3", owner_id: "u2", idle_days: 76, alerted: false },
  ];
  let r = await main([], async q => { calls.push(q); return rows; }, l => lines.push(l));
  ok("dry run calls the sweep with p_dry_run = true", calls.length === 1 && /listing_stale_sweep\(75, true\)/.test(calls[0]), calls[0]);
  ok("dry run reports what it found and sends nothing", r.found === 3 && r.sent === 0);
  ok("the log has counts (3 listings, 2 agents, longest 120) and no ids", /3 listings across 2 agents, longest idle 120 days/.test(lines.join("\n")) && !/secret|u1|u2/.test(lines.join("\n")));
  ok("the log says nothing was sent and how to turn it on", /nothing was sent/.test(lines.join("\n")) && /LISTING_STALE_ALERTS = on/.test(lines.join("\n")));

  // Send: asks for a real run, counts the ones that were alerted.
  calls.length = 0; lines.length = 0;
  r = await main(["--send", "--days", "60"], async q => { calls.push(q); return rows.map((x, i) => Object.assign({}, x, { alerted: i < 2 })); }, l => lines.push(l));
  ok("--send calls the sweep with p_dry_run = false and the chosen days", /listing_stale_sweep\(60, false\)/.test(calls[0]), calls[0]);
  ok("--send counts the reminders that went out", r.sent === 2 && /Sent 2 reminders/.test(lines.join("\n")));

  // Nothing stale.
  lines.length = 0;
  r = await main([], async () => [], l => lines.push(l));
  ok("an empty result is a normal run", r.found === 0 && /0 listings across 0 agents\./.test(lines.join("\n")));

  // Migration 0005 not applied yet: say so, no alarm. Anything else is a real failure.
  lines.length = 0;
  r = await main([], async () => { throw new Error('Database said (400): function public.listing_stale_sweep(integer, boolean) does not exist'); }, l => lines.push(l));
  ok("before migration 0005 the job says so and stops quietly", r.pending === true && /apply migration 0005/.test(lines.join("\n")));
  let thrown = null;
  try { await main([], async () => { throw new Error("Database said (500): connection refused"); }, () => {}); } catch (e) { thrown = e; }
  ok("any other database error still fails the run", thrown && /connection refused/.test(thrown.message));
  thrown = null;
  try { await main([], async () => { throw new Error("Database said (400): relation public.shared_listings does not exist"); }, () => {}); } catch (e) { thrown = e; }
  ok("a different missing object is not hidden", thrown && /shared_listings/.test(thrown.message));

  // The workflow.
  const wf = fs.readFileSync(path.join(root, ".github/workflows/listing-stale.yml"), "utf8");
  ok("workflow: daily and on demand", /cron: "37 0 \* \* \*"/.test(wf) && /workflow_dispatch/.test(wf));
  ok("workflow: sends only when LISTING_STALE_ALERTS is on", /SENDING: \$\{\{ vars\.LISTING_STALE_ALERTS \}\}/.test(wf) && /\[ "\$SENDING" = "on" \]; then node tools\/listing_stale_sweep\.js --send; else node tools\/listing_stale_sweep\.js; fi/.test(wf));
  ok("workflow: uses the database token secret and never prints it", /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/.test(wf) && !/echo .*TOKEN/.test(wf));
  ok("workflow: two runs never overlap", /concurrency:\s*\n\s*group: listing-stale/.test(wf));

  console.log("\nlisting_stale_sweep_node: " + passed + " checks passed");
})().catch(e => { console.error(e); process.exit(1); });
