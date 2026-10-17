// Leads and deals saved on top of the version a phone last saw (2026-10-18).
// Run against Postgres in tests/db/test_shared_records.sql; this keeps the app
// and the migration from drifting apart.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const app = read("js/app.js");
const sql = read("supabase/migrations/0002_shared_records_updated_at.sql");
let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log("[PASS] " + name); };

ok("migration: the database sets updated_at on leads, deals and ads", /array\['crm_leads', 'broker_transactions', 'ad_posts'\]/.test(sql) && /before update on public\.%I for each row execute function public\.set_updated_at\(\)/.test(sql));
ok("migration: ad_posts is skipped where it doesn't exist", /if to_regclass\('public\.' \|\| t\) is null then continue; end if;/.test(sql));
ok("app: a save only applies to the version this phone saw", /\.update\(row\)\.eq\("id", row\.id\)\.eq\("updated_at", known\)/.test(app));
ok("app: leads save through the guard, merging activity", /guardedSave\("crm_leads", row, mergeLeadPayload\)/.test(app) && /merged\.activity = mergeList\(theirs && theirs\.activity, mine && mine\.activity, actKey\)/.test(app));
ok("app: deals save through the guard, merging documents", /guardedSave\("broker_transactions", \{/.test(app) && /merged\.documents = mergeList\(theirs && theirs\.documents/.test(app));
ok("app: loads remember the version of each row", /rememberSeen\("crm_leads", data\)/.test(app) && /rememberSeen\("broker_transactions", data\)/.test(app));
ok("app: no plain upsert left for leads or deals", !/SB\.from\("crm_leads"\)\.upsert\(row/.test(app) && !/SB\.from\("broker_transactions"\)\.upsert\(\{/.test(app));

console.log("\nshared_records_node: " + passed + " checks passed");
