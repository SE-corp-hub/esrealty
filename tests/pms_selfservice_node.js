// PMS receipts and tenant self-service (2026-10-17). The rules run against
// Postgres in tests/db/test_pms_tenant_requests.sql and in the browser in
// tests/pms_selfservice_e2e.js; this keeps the pieces from drifting apart.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const sql = read("supabase/migrations/0001_pms_receipts_and_tenant_requests.sql");
const app = read("js/app.js");
let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log("[PASS] " + name); };

// receipt numbers
ok("receipts: numbered by a trigger on every insert and update", /create trigger pms_payments_receipt_no before insert or update on public\.pms_payments/.test(sql));
ok("receipts: a number once given is kept", /old\.data ->> 'receipt_no', ''\) <> ''/.test(sql) && /jsonb_strip_nulls\(jsonb_build_object\('receipt_no', old\.data -> 'receipt_no'/.test(sql));
ok("receipts: numbers the phone sends are dropped", /new\.data := new\.data - 'receipt_no' - 'receipt_issued'/.test(sql));
ok("receipts: one series per book and year, AR-YYYY-0001", /primary key \(book_id, year\)/.test(sql) && /'AR-' \|\| y \|\| '-' \|\| lpad\(n::text, 4, '0'\)/.test(sql));
ok("receipts: nobody reads the counters", /revoke all on public\.pms_receipt_counters from anon, authenticated/.test(sql));
ok("receipts: paid payments already there are numbered, oldest first", /order by book_id, coalesce\(data ->> 'date', ''\), created_at, id/.test(sql));
// tenant functions
ok("tenant: payments and repairs go through checked functions", /function public\.pms_tenant_send_payment\(/.test(sql) && /function public\.pms_tenant_request_repair\(/.test(sql) && (sql.match(/public\.pms_tenant_lease\(p_lease\)/g) || []).length === 2);
ok("tenant: only their own open lease", /id = p_lease and not archived and id in \(select public\.pms_my_lease_ids\(\)\)/.test(sql));
ok("tenant: limited per day", /interval '1 day'\) >= 10/.test(sql) && /interval '1 day'\) >= 5/.test(sql));
ok("tenant: a sent payment waits as 'submitted'", /'status', 'submitted'/.test(sql));
ok("tenant: requests show no staff notes or costs", /function public\.pms_my_repair_requests\(\)[\s\S]*?\$\$;/.test(sql) && !/'notes'|'cost'|'vendor'/.test(sql.match(/function public\.pms_my_repair_requests\(\)[\s\S]*?\$\$;/)[0]));
ok("tenant: visitors can't call the functions", /revoke all on function public\.pms_tenant_send_payment\(text, numeric, date, text, text, text, text\) from public, anon/.test(sql));
ok("tenant: photo upload only into a payment they sent, insert only", /create policy "pms receipts tenant upload" on storage\.objects\s+for insert to authenticated/.test(sql) && /p\.data ->> 'sent_by' = auth\.uid\(\)::text/.test(sql));
ok("managers are told, and a failed notice never stops a request", /perform public\.notify_user\(r\.id, 'info', p_title, p_body, 'pms'\);\s*exception when others then null;/.test(sql));
// the app
ok("app: the database numbers receipts in the cloud, the app only in the demo", /function pmsServerReceipts\(\) \{ return pmsStore === "tables" && pmsCloudAccounts\(\); \}/.test(app) && /!existing\.receipt_no && !pmsServerReceipts\(\)/.test(app));
ok("app: payment saves read the number back", /const back = kind === "payments" \? "updated_at,data" : "updated_at";/.test(app));
ok("app: the tenant calls the same functions", /SB\.rpc\("pms_tenant_send_payment"/.test(app) && /SB\.rpc\("pms_tenant_attach_proof"/.test(app) && /SB\.rpc\("pms_tenant_request_repair"/.test(app) && /SB\.rpc\("pms_my_repair_requests"\)/.test(app));
ok("app: B14 owed rows are worked out as overdue or due", /status: u\.due < today \? "overdue" : "due"/.test(app));
ok("app: the payment form offers Paid and Not cleared yet only", /const PAYMENT_FORM_STATUSES = \["paid", "pending"\];/.test(app));
ok("app: reminders by Viber too", /viber:\/\/chat\?number=%2B' \+ d \+ '&draft=/.test(app));
ok("app: the receipt says it is not a BIR official receipt", /This is not a BIR official receipt\./.test(app));
ok("CI: the self-service browser test runs on desktop and phone", /run_all\.ps1 -Test pms_selfservice_e2e \|\|/.test(read(".github/workflows/tests.yml")) && /-Test pms_selfservice_e2e -Mobile/.test(read(".github/workflows/tests.yml")));

console.log("\npms_selfservice_node: " + passed + " checks passed");
