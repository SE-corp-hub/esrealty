// Phase 1 security, items 3 to 13 (2026-10-17). The rules themselves were run
// against Postgres with the real row rules; this keeps the pieces from
// drifting back.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const sql = read("supabase/archive/phase1_security_rest.sql");
let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log("[PASS] " + name); };

// 3
ok("compliance: the open write rule is replaced", /drop policy if exists "compliance_write_own_chain"/.test(sql));
ok("compliance: new rows belong to the approved user who adds them", /create policy "compliance insert own"[\s\S]*for insert to authenticated[\s\S]*owner = auth\.uid\(\)[\s\S]*registration_status = 'approved'/.test(sql));
ok("compliance: no rule checks 'true' any more", !/with check \(true\)/i.test(sql));
// 4
ok("password resets: no direct inserts", /drop policy if exists "password_resets insert pending"/.test(sql) && !/create policy[^;]*password_resets/.test(sql));
// 5
ok("licences: approved accounts can't change their own PRC/RESA", /create trigger profiles_protect_licence before update of prc, resa on public\.profiles/.test(sql) && /old\.registration_status = 'approved'/.test(sql) && /not public\.is_super_admin\(\)/.test(sql));
ok("audit rows: written by the server only", /drop policy if exists "audit owner insert" on public\.audit_events/.test(sql));
// 6
ok("old account function: nobody can call it", /revoke all on function public\.admin_create_account\(text, text, text, public\.app_role, text, text, text, uuid\) from public, anon, authenticated/.test(sql));
ok("old account script: stops before changing anything", /^-- SUPERSEDED/.test(read("supabase/archive/admin_create_account.sql")) && /raise exception 'admin_create_account\.sql is superseded/.test(read("supabase/archive/admin_create_account.sql")));
// 7
ok("listing photos: uploads by approved publishers and super-admins only", /create policy "listing photos insert own folder"[\s\S]*listing_current_user_can_publish\(\) or public\.is_super_admin\(\)/.test(sql));
// 8
ok("compliance renewals: approved brokers and super-admins only", /create or replace function public\.compliance_schedule_renewals[\s\S]*if not public\.compliance_can_schedule\(\)/.test(sql) && /revoke all on function public\.compliance_schedule_renewals\(integer\) from public, anon/.test(sql));
const api = read("supabase/functions/listing-api/index.ts");
ok("rate limits: inquiries, contacts and views have separate keys", /`inquiry:\$\{callerAddress\(req\)\}/.test(api) && /`contact:\$\{inquiryType\}:/.test(api) && /`view:\$\{id\}:/.test(api)
  && /p_request_key_hash: await sha256\(`\$\{pepper\}:\$\{key\}`\)/.test(api));
ok("views: counted once per visitor per listing per day", /withinLimit\(admin, pepper, `view:\$\{id\}:\$\{callerAddress\(req\)\}`, 1, 86400\)/.test(api) && /if \(firstToday\)/.test(api));
ok("report form: its own rate-limit key", /":location-report:"/.test(read("supabase/functions/location-report/index.ts")));
const notify = read("supabase/functions/notify-dispatch/index.ts");
ok("self-send email: approved accounts only, 20 an hour", /registration_status !== "approved"/.test(notify) && /p_limit: 20/.test(notify));
ok("dispatch secrets are compared safely", /sameSecret\(secretHeader, DISPATCH_SECRET\)/.test(notify));
// 9
ok("Vercel cron: refuses every call unless CRON_SECRET is set and matches", /!CRON_SECRET \|\| !sameSecret\(req\.headers\.authorization/.test(read("market-scan/vercel/api/agent-dispatch.js")));
ok("ad-perf: approved staff only", /if \(!role\) \{[\s\S]*401/.test(read("market-scan/vercel/api/ad-perf.js")));
ok("app: sends the sign-in token to ad-perf", /fetch\(MS_CLOUD \+ "\/api\/ad-perf", \{ headers: Object\.assign\(\{ "Content-Type": "application\/json" \}, token \? \{ Authorization: "Bearer " \+ token \}/.test(read("js/app.js")));
ok("local worker: listens on this computer only by default", /const HOST = process\.env\.HOST \|\| "127\.0\.0\.1";\s*server\.listen\(PORT, HOST/.test(read("market-scan/worker/server.js")));
// 11
const fb = read("supabase/functions/fb-leads/index.ts");
ok("fb-leads: signature compared safely", /return sameSecret\(hex, signature\.slice\(7\)\)/.test(fb));
ok("fb-leads: current Graph API version, token not in the URL", !/v19\.0\//.test(fb) && /\?\? "v25\.0"/.test(fb) && !/access_token=/.test(fb));
ok("fb-leads: no notice for a lead that wasn't saved", /if \(insert\.error\) \{[\s\S]*continue;/.test(fb));
// 12
const emails = fs.readdirSync(path.join(root, "supabase")).filter(f => f.endsWith(".sql")).map(f => read("supabase/" + f)).join("\n") + read("js/app.js");
ok("no personal or sample gmail addresses in SQL or the app", !/[A-Za-z0-9._%+-]+@gmail\.com/.test(emails.replace(/seaestate@gmail\.com/g, "")));
// 13
ok("visitors: no write rights on any table", /revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon/.test(sql));
ok("signed-in users: no TRUNCATE", /revoke truncate, references, trigger on all tables in schema public from authenticated/.test(sql));
ok("new tables start without visitor write rights", /alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon/.test(sql));
// app: licence fields
ok("app: verified licence numbers are read-only in Settings", /function settingsLicenceLocked\(\)/.test(read("js/app.js")) && /settingsLicenceLocked\(\) \? " readonly" : ""/.test(read("js/app.js")));

console.log("\nphase1_security_node: " + passed + " checks passed");
