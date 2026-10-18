// tools/rent_reminders.js: who hears about their rent today, and that the
// public log shows counts only.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { plan, kindFor, insertSql, summarySql, main } = require("../tools/rent_reminders.js");
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? "  " + detail : "")); passed++; console.log("[PASS] " + name); };

const BOOK = "00000000-0000-0000-0000-000000000000", BROKER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tenants = [
  { id: "t1", name: "Ana Cruz", authUserId: "11111111-1111-1111-1111-111111111111" },
  { id: "t2", name: "Ben Reyes", authUserId: "22222222-2222-2222-2222-222222222222" },
  { id: "t3", name: "Carla No-Login" },
  { id: "t4", name: "Dan Paid", authUserId: "44444444-4444-4444-4444-444444444444" },
];
const L = (id, tenant, dueDay, extra) => Object.assign({ id, tenant_id: tenant, property_id: "p1", unit_id: "u1", rent: 10000, rent_type: "monthly", due_day: String(dueDay), start: "2026-10-01", end: "2027-09-30", status: "active", book_id: BOOK }, extra || {});
const data = {
  tenants, properties: [{ id: "p1", title: "One Orchard" }], units: [{ id: "u1", unit_number: "3B" }],
  leases: [
    L("l1", "t1", 21),                     // today 18 Oct: due in 3 days
    L("l2", "t2", 11),                     // 7 days overdue
    L("l3", "t3", 18),                     // due today, no login
    L("l4", "t4", 15),                     // paid (with tax withheld)
    L("l5", "t2", 16, { book_id: BROKER, charges: [{ id: "c1", type: "Water", amount: 800, due: "2026-10-17", period: "2026-10" }] }), // rent 2 days overdue (no tenant note), water 1 day overdue
    L("l6", "t1", 21, { archived: true }),
  ],
  payments: [
    { lease_id: "l4", status: "paid", amount: 9500, withheld: 500, month: "2026-10", date: "2026-10-14" },
    { lease_id: "l5", status: "paid", amount: 10000, month: "2026-10", date: "2026-10-01", archived: true },
  ],
};
const p = plan(data, "2026-10-18");
const titles = p.toTenants.map(n => n.title);

ok("when to remind: 3 days before, on the day, the day after, then weekly", kindFor(-3) === "soon" && kindFor(0) === "today" && kindFor(1) === "overdue" && kindFor(7) === "overdue" && kindFor(14) === "overdue" && kindFor(2) === "" && kindFor(3) === "" && kindFor(-1) === "");
ok("due in 3 days", titles.indexOf("Due in 3 days: Rent · October 2026") !== -1);
ok("7 days overdue", titles.indexOf("Overdue (7 days): Rent · October 2026") !== -1);
ok("a charge 1 day overdue", titles.indexOf("Overdue (1 day): Water · October 2026") !== -1);
ok("2 days overdue: no tenant note that day", !titles.some(t => /Overdue \(2 days\)/.test(t)));
ok("paid with tax withheld: nothing", !p.toTenants.some(n => n.user_id === "44444444-4444-4444-4444-444444444444"));
ok("archived lease: nothing extra", p.toTenants.filter(n => n.user_id === "11111111-1111-1111-1111-111111111111").length === 1);
ok("a tenant with no login gets no app note", p.toTenants.length === 3, JSON.stringify(titles));
const soon = p.toTenants.find(n => /^Due in 3 days/.test(n.title));
ok("the note says how much, where and when, and opens Property Management", /^₱10,000 for rent, October 2026 at One Orchard 3B is due on Oct 21\./.test(soon.body) && soon.link_view === "pms" && soon.type === "system", soon.body);
const company = p.summaries.find(s => s.book === BOOK), broker = p.summaries.find(s => s.book === BROKER);
ok("one summary per book", p.summaries.length === 2 && !!company && !!broker);
ok("company summary: one line per tenant, with the tenant who has no login", company.title === "Rent today (Oct 18): 1 tenant overdue, 1 due today" && /Due today: Carla No-Login \u20B110,000 \[no login: text them\]\./.test(company.body) && /Overdue: Ben Reyes \u20B110,000 \(1 bill, oldest 7 days\)\./.test(company.body), company.title + " | " + company.body);
ok("broker summary: their own records only, rent and water together", broker.title === "Rent today (Oct 18): 1 tenant overdue" && /Ben Reyes \u20B110,800 \(2 bills, oldest 2 days\)/.test(broker.body) && !/Ana Cruz|Carla/.test(broker.body), broker.title + " | " + broker.body);

const ins = insertSql(p.toTenants), sum = summarySql(p.summaries);
ok("insert: skips a note already sent (same person and title, 45 days) and unknown users", /not exists \(select 1 from public\.notifications n where n\.user_id = x\.user_id and n\.title = x\.title and n\.created_at > now\(\) - interval '45 days'\)/.test(ins) && /exists \(select 1 from auth\.users u where u\.id = x\.user_id\)/.test(ins));
ok("summaries go through pms_notify_book, once a day", /public\.pms_notify_book\(todo\.book, todo\.title, todo\.body\)/.test(sum) && /interval '20 hours'/.test(sum));

(async () => {
  const rows = t => ({ pms_leases: data.leases.map(l => ({ id: l.id, archived: !!l.archived, book_id: l.book_id, data: l })), pms_payments: data.payments.map((x, i) => ({ id: "p" + i, archived: !!x.archived, data: x })), pms_tenants: tenants.map(x => ({ id: x.id, archived: false, auth_user_id: x.authUserId || null, data: x })), pms_properties: data.properties.map(x => ({ id: x.id, data: x })), pms_units: data.units.map(x => ({ id: x.id, data: x })) })[t];
  const sent = [];
  const run = async q => { const m = /from public\.(pms_\w+)/.exec(q); if (/^select id, archived, data/.test(q) && m) return rows(m[1]); sent.push(q); return [{ sent: 1 }]; };
  const logs = [];
  process.env.REMINDERS_TODAY = "2026-10-18";
  await main([], run, l => logs.push(l));
  ok("without --send nothing is written", sent.length === 0 && /nothing was sent/.test(logs.join(" ")));
  ok("the log has counts only: no names, no amounts", /3 for tenants \(1 due in 3 days, 0 due today, 2 overdue\), 2 manager summaries/.test(logs[0]) && !/Ana|Ben|Carla|Orchard|₱/.test(logs.join(" ")), logs[0]);
  logs.length = 0;
  await main(["--send"], run, l => logs.push(l));
  ok("with --send: one insert and one summary statement", sent.length === 2 && /insert into public\.notifications/.test(sent[0]) && /pms_notify_book/.test(sent[1]));
  ok("still counts only in the log", !/Ana|Ben|Carla|Orchard|₱/.test(logs.join(" ")));
  const wf = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/rent-reminders.yml"), "utf8");
  ok("workflow: daily, sending only when RENT_REMINDERS is on, Manila time", /cron: "7 0 \* \* \*"/.test(wf) && /SENDING: \$\{\{ vars\.RENT_REMINDERS \}\}/.test(wf) && /if \[ "\$SENDING" = "on" \]; then node tools\/rent_reminders\.js --send; else node tools\/rent_reminders\.js; fi/.test(wf) && /TZ: Asia\/Manila/.test(wf));
  console.log("\nrent_reminders_node: " + passed + " checks passed");
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
