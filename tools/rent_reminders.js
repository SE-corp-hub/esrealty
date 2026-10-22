#!/usr/bin/env node
// Daily rent reminders, for .github/workflows/rent-reminders.yml.
//
// Works out, with the app's own rent ledger (js/pms_ledger.js), which tenants
// should hear about their rent or a charge today, and puts a notification in
// their app (the bell): 3 days before the due date, on the due date, the day
// after, then once a week while it stays unpaid. Each manager (the broker for
// their own records, super-admins for the company's) gets one summary a day
// when something is due or overdue, including tenants who have no login.
//
//   node tools/rent_reminders.js           work it out only (nothing is sent)
//   node tools/rent_reminders.js --send    send the notifications
//
// Lease renewals (I3): 60, 30 and 7 days before a lease ends, the manager gets one "leases ending"
// summary and a tenant with a login gets a note to talk about renewing. A terminated lease, or one
// the same tenant already has a newer lease for on the same unit, is left alone.
//
// The repository is public, so the log shows counts only: no names, no amounts.
// Email or SMS copies come later from notify-dispatch, once a provider is set up.
"use strict";
const L = require("../js/pms_ledger.js");
const { runSql, dollarTag } = require("./supabase_sql.js");

const money = v => "₱" + Number(v || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 });
const DAY = 86400000;
const daysFrom = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
const shortDate = d => { const x = new Date(d + "T00:00:00Z"); return L.MONTHS[x.getUTCMonth()].slice(0, 3) + " " + x.getUTCDate(); };

// When to remind, by days from the due date (negative = before it).
function kindFor(daysAfterDue) {
  if (daysAfterDue === -3) return "soon";
  if (daysAfterDue === 0) return "today";
  if (daysAfterDue === 1 || (daysAfterDue > 1 && daysAfterDue % 7 === 0)) return "overdue";
  return "";
}

function rec(row) { return Object.assign({}, row.data || {}, { id: row.id, archived: !!row.archived }, row.book_id ? { book_id: row.book_id } : {}, row.auth_user_id ? { authUserId: row.auth_user_id } : {}); }

/* data: { leases, payments, tenants, properties, units } as app records.
 * Returns the tenant notifications and one summary per book. */
function plan(data, today) {
  const tenants = {}, props = {}, units = {};
  (data.tenants || []).forEach(t => { tenants[t.id] = t; });
  (data.properties || []).forEach(p => { props[p.id] = p; });
  (data.units || []).forEach(u => { units[u.id] = u; });
  const payments = (data.payments || []).filter(p => !p.archived);
  const toTenants = [], byBook = {};
  (data.leases || []).forEach(l => {
    if (!l || l.archived) return;
    const t = tenants[l.tenant_id] || {};
    const unitNo = units[l.unit_id] && (units[l.unit_id].unit_number || units[l.unit_id].name);
    const place = ((props[l.property_id] || {}).title || "your unit") + (unitNo ? " " + unitNo : "");
    const owed = [];
    L.ledger(l, payments, today).months.forEach(m => { if (m.balance > 0) owed.push({ what: "Rent", period: m.label, amount: m.balance, due: m.due }); });
    L.chargeStatus(l, payments, today).forEach(c => { if (c.balance > 0 && c.due) owed.push({ what: c.type || "Charge", period: c.label, amount: c.balance, due: c.due, charge: true }); });
    owed.forEach(o => {
      const d = daysFrom(o.due, today), kind = kindFor(d);
      if (d >= 0) {
        const b = byBook[l.book_id || ""] || (byBook[l.book_id || ""] = { overdue: [], today: [] });
        if (d === 0) b.today.push({ tenant: t.name || "A tenant", noLogin: !t.authUserId, o });
        else b.overdue.push({ tenant: t.name || "A tenant", noLogin: !t.authUserId, o, days: d });
      }
      if (!kind || !t.authUserId) return;
      const label = o.charge ? o.period : o.what + " · " + o.period;
      const title = (kind === "soon" ? "Due in 3 days: " : kind === "today" ? "Due today: " : "Overdue (" + d + (d === 1 ? " day" : " days") + "): ") + label;
      const body = money(o.amount) + " for " + (o.charge ? o.period : (o.what === "Rent" ? "rent, " + o.period : o.period)) + " at " + place +
        (kind === "overdue" ? " was due on " + shortDate(o.due) + " and is still unpaid." : " is due " + (kind === "today" ? "today" : "on " + shortDate(o.due)) + ".") +
        " If you have paid, send the proof in your portal so it can be confirmed.";
      toTenants.push({ user_id: t.authUserId, type: "system", title: title.slice(0, 200), body: body.slice(0, 1000), link_view: "pms" });
    });
  });
  // One line per tenant: what is due today, and what is overdue in total.
  const group = list => {
    const by = {};
    list.forEach(x => { const k = x.tenant + "|" + (x.noLogin ? 1 : 0); const g = by[k] || (by[k] = { tenant: x.tenant, noLogin: x.noLogin, amount: 0, items: 0, oldest: 0 }); g.amount += x.o.amount; g.items++; g.oldest = Math.max(g.oldest, x.days || 0); });
    return Object.keys(by).map(k => by[k]).sort((a, b) => b.oldest - a.oldest || b.amount - a.amount);
  };
  const summaries = Object.keys(byBook).map(book => {
    const b = byBook[book], over = group(b.overdue), due = group(b.today);
    const tag = g => g.noLogin ? " [no login: text them]" : "";
    const title = "Rent today (" + shortDate(today) + "): " + [over.length ? over.length + (over.length === 1 ? " tenant" : " tenants") + " overdue" : "", due.length ? due.length + " due today" : ""].filter(Boolean).join(", ");
    const body = (due.length ? "Due today: " + due.map(g => g.tenant + " " + money(g.amount) + tag(g)).join("; ") + ". " : "") +
      (over.length ? "Overdue: " + over.map(g => g.tenant + " " + money(g.amount) + " (" + g.items + (g.items === 1 ? " bill" : " bills") + ", oldest " + g.oldest + (g.oldest === 1 ? " day" : " days") + ")" + tag(g)).join("; ") + "." : "");
    return { book: book || null, title: title.slice(0, 200), body: body.slice(0, 1000) };
  }).filter(s => s.book);
  return { toTenants, summaries };
}

const RENEWAL_DAYS = [60, 30, 7];
function renewalPlan(data, today) {
  const tenants = {}, props = {}, units = {};
  (data.tenants || []).forEach(t => { tenants[t.id] = t; });
  (data.properties || []).forEach(p => { props[p.id] = p; });
  (data.units || []).forEach(u => { units[u.id] = u; });
  const leases = (data.leases || []).filter(l => l && !l.archived);
  const toTenants = [], byBook = {};
  leases.forEach(l => {
    const end = String(l.end || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || l.status === "terminated") return;
    const left = daysFrom(today, end);
    if (RENEWAL_DAYS.indexOf(left) < 0) return;
    const renewed = leases.some(o => o !== l && o.tenant_id === l.tenant_id && o.unit_id === l.unit_id && String(o.start || "").slice(0, 10) > String(l.start || "").slice(0, 10));
    if (renewed) return;
    const t = tenants[l.tenant_id] || {};
    const unitNo = units[l.unit_id] && (units[l.unit_id].unit_number || units[l.unit_id].name);
    const place = ((props[l.property_id] || {}).title || "the unit") + (unitNo ? " " + unitNo : "");
    const b = byBook[l.book_id || ""] || (byBook[l.book_id || ""] = []);
    b.push({ tenant: t.name || "A tenant", place, end, left });
    if (t.authUserId && left !== 7) {
      toTenants.push({ user_id: t.authUserId, type: "system", link_view: "pms",
        title: ("Your lease ends " + shortDate(end) + " (" + left + " days)").slice(0, 200),
        body: ("Your lease at " + place + " ends on " + shortDate(end) + ". If you want to stay, talk to your property manager about renewing.").slice(0, 1000) });
    }
  });
  const summaries = Object.keys(byBook).filter(Boolean).map(book => {
    const list = byBook[book].sort((a, b) => a.left - b.left);
    return { book, title: ("Leases ending (" + shortDate(today) + "): " + list.length + (list.length === 1 ? " lease" : " leases")).slice(0, 200),
      body: list.map(x => x.tenant + " at " + x.place + ": ends " + shortDate(x.end) + " (" + x.left + " days)").join("; ").slice(0, 1000) };
  });
  return { toTenants, summaries };
}

async function load(run) {
  const q = t => run("select id, archived, data" + (t === "pms_leases" ? ", book_id" : "") + (t === "pms_tenants" ? ", auth_user_id" : "") + " from public." + t + " where not archived");
  const [leases, payments, tenants, properties, units] = await Promise.all(["pms_leases", "pms_payments", "pms_tenants", "pms_properties", "pms_units"].map(q));
  return { leases: leases.map(rec), payments: payments.map(rec), tenants: tenants.map(rec), properties: properties.map(rec), units: units.map(rec) };
}

// One statement each; a notification already sent (same person, same title,
// last 45 days) is skipped, so a re-run the same day sends nothing new.
function insertSql(list) {
  const json = JSON.stringify(list), tag = dollarTag(json);
  return "with x as (select * from json_to_recordset(" + tag + json + tag + "::json) as x(user_id uuid, type text, title text, body text, link_view text)), " +
    "ins as (insert into public.notifications (user_id, type, title, body, link_view) select x.user_id, x.type, x.title, x.body, x.link_view from x " +
    "where exists (select 1 from auth.users u where u.id = x.user_id) " +
    "and not exists (select 1 from public.notifications n where n.user_id = x.user_id and n.title = x.title and n.created_at > now() - interval '45 days') returning 1) " +
    "select count(*)::int as sent from ins";
}
function summarySql(list) {
  const json = JSON.stringify(list), tag = dollarTag(json);
  return "with x as (select * from json_to_recordset(" + tag + json + tag + "::json) as x(book uuid, title text, body text)), " +
    "todo as (select * from x where not exists (select 1 from public.notifications n where n.title = x.title and n.created_at > now() - interval '20 hours')) " +
    "select count(*)::int as sent from todo, lateral (select public.pms_notify_book(todo.book, todo.title, todo.body)) s";
}

async function main(argv, run = runSql, out = console.log) {
  const send = argv.indexOf("--send") !== -1;
  // The workflow runs with TZ=Asia/Manila, so this is the Philippine date.
  const today = process.env.REMINDERS_TODAY || L.today();
  const data = await load(run);
  const p = plan(data, today);
  const r = renewalPlan(data, today);
  const counts = { soon: 0, today: 0, overdue: 0 };
  p.toTenants.forEach(n => { counts[/^Due in/.test(n.title) ? "soon" : /^Due today/.test(n.title) ? "today" : "overdue"]++; });
  out("Rent reminders for " + today + ": " + p.toTenants.length + " for tenants (" + counts.soon + " due in 3 days, " + counts.today + " due today, " + counts.overdue + " overdue), " + p.summaries.length + " manager summaries.");
  out("Lease renewals: " + r.toTenants.length + " tenant notes, " + r.summaries.length + " manager summaries (leases ending in 60, 30 or 7 days).");
  if (!send) { out("Worked out only: nothing was sent. (Turn sending on with the repository variable RENT_REMINDERS = on.)"); return { plan: p, sent: 0 }; }
  let sent = 0, sumSent = 0;
  if (p.toTenants.length) sent = ((await run(insertSql(p.toTenants)))[0] || {}).sent || 0;
  if (p.summaries.length) sumSent = ((await run(summarySql(p.summaries)))[0] || {}).sent || 0;
  let renSent = 0, renSum = 0;
  if (r.toTenants.length) renSent = ((await run(insertSql(r.toTenants)))[0] || {}).sent || 0;
  if (r.summaries.length) renSum = ((await run(summarySql(r.summaries)))[0] || {}).sent || 0;
  out("Sent " + sent + " tenant notifications (the rest were sent before) and " + sumSent + " manager summaries; renewals: " + renSent + " tenant notes, " + renSum + " manager summaries.");
  return { plan: p, renewals: r, sent, sumSent, renSent, renSum };
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0), e => { console.error("::error::" + (e && e.message || e)); process.exit(1); });
}
module.exports = { plan, renewalPlan, RENEWAL_DAYS, kindFor, insertSql, summarySql, main, load };
