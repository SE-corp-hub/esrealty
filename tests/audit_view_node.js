/* Change log wording (roadmap K3): the shipped js/audit_view.js turns audit_events rows into
 * plain sentences and CSV. Also checks that every event type the database and the listing
 * function write is known to the screen, so a new event cannot silently show as raw text. */
const fs = require("fs");
const path = require("path");
const A = require("../js/audit_view.js");

const ROOT = path.join(__dirname, "..");
const names = { u1: "Ana Cruz", u2: "Ben Reyes", u3: "Carla Dizon" };
const ctx = { name: id => names[id] || "" };
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });
const d = (row) => A.describe(row, ctx);

// 1. Wording per event type
let x = d({ id: 1, owner_id: "u1", event_type: "lead_created", entity_id: "abcdef123456", detail: { source: "facebook_ad", assigned_to_id: "u2" }, created_at: "2026-10-20T01:02:03Z" });
c("lead created names the assignee and source", x.text === "Created a lead from facebook ad, assigned to Ben Reyes" && x.who === "Ana Cruz" && x.group === "leads", x.text);
c("record is the first 8 characters of the id", x.record === "abcdef12", x.record);
x = d({ owner_id: "u1", event_type: "lead_created", entity_id: "L1", detail: {} });
c("lead created with nobody assigned", x.text === "Created a lead, not assigned", x.text);
x = d({ owner_id: "u1", event_type: "lead_assigned", entity_id: "L1", detail: { from: "u2", to: "u3" } });
c("lead moved between two people", x.text === "Moved a lead from Ben Reyes to Carla Dizon", x.text);
x = d({ owner_id: "u1", event_type: "lead_assigned", entity_id: "L1", detail: { from: null, to: "u3" } });
c("lead taken from nobody", x.text === "Moved a lead from nobody to Carla Dizon", x.text);
x = d({ owner_id: "u1", event_type: "lead_status", entity_id: "L1", detail: { from: "new", to: "in_progress" } });
c("lead status change", x.text === "Changed a lead from new to in progress", x.text);
x = d({ owner_id: "u1", event_type: "lead_deleted", entity_id: "L1", detail: { status: "lost" } });
c("lead deleted keeps its last status", x.text === "Deleted a lead (it was lost)", x.text);

x = d({ owner_id: "u1", event_type: "cash_posted", entity_id: "e1", detail: { direction: "in", amount: 12500 } });
c("cash posted shows pesos and direction", x.text === "Posted ₱12,500 money in" && x.group === "money", x.text);
x = d({ owner_id: "u1", event_type: "cash_posted", entity_id: "e2", detail: { direction: "out", amount: 12500, reversal_of: "e1" } });
c("a reversal says so", /money out as a reversal of an earlier entry$/.test(x.text), x.text);
x = d({ owner_id: "u1", event_type: "cash_voided", entity_id: "e1", detail: { direction: "in", amount: 100 } });
c("cash voided", x.text === "Voided a ₱100 money in entry", x.text);
x = d({ owner_id: "u1", event_type: "cash_status", entity_id: "e1", detail: { direction: "in", amount: 100, from: "draft", to: "posted" } });
c("cash status change", x.text === "Changed a ₱100 money in entry from draft to posted", x.text);
x = d({ owner_id: "u1", event_type: "cash_deleted", entity_id: "e1", detail: { direction: "out", amount: 50.5, status: "voided" } });
c("cash deleted shows cents when present", x.text === "Deleted a ₱50.5 money out entry (voided)", x.text);

x = d({ owner_id: "u1", event_type: "listing_created", entity_id: "S1", detail: { price: 5000000, published: true, status: "available" } });
c("listing created", x.text === "Created a listing at ₱5,000,000, published, available" && x.group === "listings", x.text);
x = d({ owner_id: "u1", event_type: "listing_price", entity_id: "S1", detail: { from: 5000000, to: 4800000 } });
c("listing price change shows both prices", x.text === "Changed a listing price from ₱5,000,000 to ₱4,800,000", x.text);
x = d({ owner_id: "u1", event_type: "listing_published", entity_id: "S1", detail: { from: false, to: true } });
c("listing published", x.text === "Published a listing", x.text);
x = d({ owner_id: "u1", event_type: "listing_published", entity_id: "S1", detail: { from: true, to: false } });
c("listing unpublished is plain", x.text === "Took a listing off the public site", x.text);
x = d({ owner_id: "u1", event_type: "listing_status", entity_id: "S1", detail: { from: "available", to: "sold" } });
c("listing status change", x.text === "Changed a listing from available to sold", x.text);
x = d({ owner_id: "u1", event_type: "listing_deleted", entity_id: "S1", detail: { price: 900000, status: "rented" } });
c("listing deleted", x.text === "Deleted a listing priced ₱900,000 (rented)", x.text);

x = d({ owner_id: "u1", event_type: "role_changed", entity_id: "u2", detail: { from: "broker", to: "agent" } });
c("role change names the person whose role changed", x.text === "Changed Ben Reyes's role from broker to agent" && x.group === "people", x.text);
x = d({ owner_id: "u1", event_type: "registration_approved", entity_id: "u3", detail: { role: "agent" } });
c("registration approved", x.text === "Approved Carla Dizon as agent", x.text);
x = d({ owner_id: "u1", event_type: "registration_rejected", entity_id: "u3", detail: {} });
c("registration rejected", x.text === "Rejected the registration of Carla Dizon", x.text);
x = d({ owner_id: "u1", event_type: "assign_broker", entity_id: "u3", detail: { broker: "u2" } });
c("broker assigned", x.text === "Set the supervising broker of Carla Dizon to Ben Reyes", x.text);
x = d({ owner_id: "u1", event_type: "assign_broker", entity_id: "u3", detail: { broker: null } });
c("broker cleared", x.text === "Set the supervising broker of Carla Dizon to none", x.text);
x = d({ owner_id: "u1", event_type: "manual_create", entity_id: "u3", detail: { role: "owner" } });
c("account created by hand", x.text === "Created an account for Carla Dizon (owner)", x.text);
x = d({ owner_id: "u1", event_type: "reset_password", entity_id: "u3", detail: {} });
c("password reset", x.text === "Reset the password of Carla Dizon", x.text);
x = d({ owner_id: "u1", event_type: "cancel_password_reset", entity_id: "u3", detail: {} });
c("password reset cancelled", x.text === "Cancelled the password reset request of Carla Dizon", x.text);
x = d({ owner_id: "u1", event_type: "pms_find_login", entity_id: "", detail: { role: "tenant", found: false } });
c("login lookup", x.text === "Looked up a tenant login (none found)", x.text);
x = d({ owner_id: "u1", event_type: "pms_transfer_book", entity_id: "u2", detail: { to: "u3", moved: {} } });
c("book transfer", x.text === "Moved a property management book from Ben Reyes to Carla Dizon", x.text);

x = d({ owner_id: "u1", event_type: "deal_stage", entity_id: "tx-1", detail: { from: "reservation", to: "cts", price: "5000000" } });
c("deal stage uses the screen's stage names", x.text === "Moved a deal from Reservation to Contract to Sell (\u20B15,000,000)" && x.group === "money" && x.record === "tx-1", x.text);
x = d({ owner_id: "u1", event_type: "pms_payment_changed", entity_id: "pay-1", detail: { from_amount: "10000", to_amount: "10000", from_status: "submitted", to_status: "paid", month: "Oct 2026" } });
c("payment change", x.text === "Changed a rent payment for Oct 2026 from \u20B110,000 submitted to \u20B110,000 paid", x.text);
x = d({ owner_id: "u1", event_type: "cobroke_proposed", entity_id: "c1", detail: { listing_id: "S1", split_selling_pct: 40 } });
c("co-broke proposal", x.text === "Proposed a co-broke with 40% to the selling broker" && x.group === "listings", x.text);
x = d({ owner_id: "u1", event_type: "cobroke_status", entity_id: "c1", detail: { from: "proposed", to: "accepted" } });
c("co-broke decision", x.text === "Changed a co-broke from proposed to accepted", x.text);

// 2. Unknown people and unknown events
x = d({ owner_id: "ffffffff-1111-2222", event_type: "lead_status", entity_id: "L", detail: { from: "a", to: "b" } });
c("an unknown actor shows a short account id", x.who === "account ffffffff", x.who);
x = d({ owner_id: "u1", event_type: "something_new", entity_id: "L", detail: {} });
c("an unknown event still reads as words, group other", x.text === "Something new" && x.group === "other", x.text + " / " + x.group);
x = d({ owner_id: "u1", event_type: "lead_status", entity_id: "L", detail: null });
c("a missing detail does not throw", /^Changed a lead from no status to no status$/.test(x.text), x.text);
x = d(null);
c("a missing row does not throw", typeof x.text === "string", x.text);

// 3. Groups
c("groups: everything, leads, money, listings, people", A.GROUPS.map(g => g.key).join() === "all,leads,money,listings,people", A.GROUPS.map(g => g.key).join());
c("everything means no filter", A.typesInGroup("all").length === 0);
c("leads group has the four lead events", A.typesInGroup("leads").sort().join() === "lead_assigned,lead_created,lead_deleted,lead_status", A.typesInGroup("leads").join());
c("money group has cash, deal and rent payment events", A.typesInGroup("money").length === 9, String(A.typesInGroup("money").length));
c("every known event belongs to a listed group", Object.keys(A.EVENT_GROUP).every(t => A.GROUPS.some(g => g.key === A.EVENT_GROUP[t])));

// 4. Coverage: every event type written by the database or the listing function is known here
const sql = ["0000_baseline.sql", "0004_alerts_and_access_fixes.sql", "0005_broker_access_audit_ledger_settings.sql", "0006_storage_rules_more_audit_cobroke.sql"]
  .map(f => fs.readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8")).join("\n");
const written = new Set();
let m;
const re1 = /audit_events \(owner_id, event_type, entity_type, entity_id, detail\)\s*values \(auth\.uid\(\), '([a-z_]+)'/g;
while ((m = re1.exec(sql))) written.add(m[1]);
const re2 = /audit_log\('([a-z_]+)'/g;
while ((m = re2.exec(sql))) written.add(m[1]);
const re3 = /when 'posted' then '(cash_[a-z]+)' when 'voided' then '(cash_[a-z]+)' else '(cash_[a-z]+)'/;
if ((m = re3.exec(sql))) { written.add(m[1]); written.add(m[2]); written.add(m[3]); }
const fn = fs.readFileSync(path.join(ROOT, "supabase/functions/listing-api/index.ts"), "utf8");
const re4 = /logListingChange\(admin, auth\.id, "([a-z_]+)"/g;
while ((m = re4.exec(fn))) written.add(m[1]);
written.add("registration_approved"); written.add("registration_rejected"); // built as 'registration_' || status
written.delete("registration_");
const missing = [...written].filter(t => !A.EVENT_GROUP[t]);
c("every event written by the backend is known to the screen (" + written.size + ")", written.size >= 20 && missing.length === 0, "missing: " + missing.join());

// 5. CSV
const csv = A.toCsv([
  { id: 1, owner_id: "u1", event_type: "lead_status", entity_id: "abc", detail: { from: "new", to: "won" }, created_at: "2026-10-20T01:02:03Z" },
  { id: 2, owner_id: "u2", event_type: "something_new", entity_id: "=cmd", detail: {}, created_at: "2026-10-20T02:00:00Z" }
], ctx);
const lines = csv.split("\r\n");
c("csv has a header, a row per entry and a trailing newline", lines.length === 4 && lines[3] === "" && /^"When \(UTC\)","Who","Area","What happened","Record"$/.test(lines[0]), lines[0]);
c("csv quotes every cell", lines[1] === '"2026-10-20T01:02:03Z","Ana Cruz","leads","Changed a lead from new to won","abc"', lines[1]);
const evil = A.toCsv([{ owner_id: "u1", event_type: "lead_status", entity_id: "L", detail: { from: "=HYPERLINK(\"x\")", to: "b" }, created_at: "2026-10-20T01:02:03Z" }], { name: () => "=SUM(A1)" }).split("\r\n")[1];
c("csv does not start a cell with a formula character", /^"2026[^"]*","'=SUM\(A1\)"/.test(evil), evil);
c("csv doubles quotes inside a cell", /""x""/.test(evil) || !/"x"/.test(evil.replace(/""/g, "")), evil);

// 6. The read the screen makes
function fakeClient() {
  const calls = [];
  const q = { then: undefined };
  ["select", "order", "limit", "in", "lt"].forEach(m => { q[m] = (...a) => { calls.push([m, ...a]); return q; }; });
  return { calls, from: t => { calls.push(["from", t]); return q; } };
}
let fc = fakeClient();
A.query(fc, "all", null, 50);
c("first page: newest first, 50 rows, no filter, no cursor", JSON.stringify(fc.calls.map(x => x[0])) === JSON.stringify(["from", "select", "order", "limit"]) && fc.calls[0][1] === "audit_events" && fc.calls[2][1] === "id" && fc.calls[2][2].ascending === false && fc.calls[3][1] === 50, JSON.stringify(fc.calls.map(x => x[0])));
fc = fakeClient();
A.query(fc, "money", 120, 50);
c("an area filter and a cursor are applied", fc.calls.some(x => x[0] === "in" && x[1] === "event_type" && x[2].length === A.typesInGroup("money").length) && fc.calls.some(x => x[0] === "lt" && x[1] === "id" && x[2] === 120), JSON.stringify(fc.calls.map(x => x[0])));
c("the columns read are exactly the ones the wording uses", A.COLUMNS === "id, owner_id, event_type, entity_type, entity_id, detail, created_at");
fc = fakeClient();
A.query(fc, "leads", 0, 10);
c("a cursor of 0 is still a cursor", fc.calls.some(x => x[0] === "lt" && x[2] === 0) && fc.calls.some(x => x[0] === "limit" && x[1] === 10));

const ok = checks.every(x => x.ok) && checks.length >= 49;
console.log("\n[audit_view_node] " + checks.length + " checks");
checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : "  " + x.detail)));
console.log(ok ? "ALL PASS" : "FAILURES PRESENT");
process.exit(ok ? 0 : 1);
