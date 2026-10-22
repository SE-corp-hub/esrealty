// The Backend Health Check (supabase/check-backend.js) covers what this update
// added. Its expectations were confirmed against the live project on 2026-10-18
// (visitors get 401 on every PMS table and function; a missing function is 404).
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "supabase/check-backend.js"), "utf8");
let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log("[PASS] " + name); };

const pms = ["pms_owners", "pms_tenants", "pms_properties", "pms_units", "pms_leases", "pms_payments", "pms_maintenance", "pms_expenses", "pms_documents", "pms_receipt_counters"];
ok("every PMS table is checked, and must refuse visitors", pms.every(t => new RegExp('\\{ table: "' + t + '", note: "[^"]*", anonDenied: true \\}').test(src)));
ok("a PMS table that answers visitors fails the check", /const ok = entry\.anonDenied \? \(got === 401 \|\| got === 403\)/.test(src));
ok("the tenant and broker functions are checked", ["pms_books", "pms_find_login", "pms_tenant_send_payment", "pms_tenant_request_repair", "pms_my_repair_requests"].every(f => src.indexOf('fn: "' + f + '"') !== -1));
ok("a function visitors can call fails the check", /const ok = got === 401 \|\| got === 403;\s*(?:if \(entry\.pending && got === 404\)[^\n]*\n\s*)?const extra = got === 404/.test(src));
ok("the Vercel endpoints must refuse callers without a secret or sign-in", /\/api\/agent-dispatch/.test(src) && /\/api\/ad-perf/.test(src) && /vercelOpen\.length\) \{ process\.exit\(1\); \}/.test(src));

console.log("\ncheck_backend_node: " + passed + " checks passed");
