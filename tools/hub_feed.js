#!/usr/bin/env node
// Nightly totals for the SE Corp Hub, for .github/workflows/hub-feed.yml.
//
// For each of the last 30 Philippine days it sends ES Realty's:
//   sales    = commission on deals closed that day (stage DOAS or done, by closing date), after a
//              co-broke partner's share: what ES Realty itself earns;
//   expenses = what that commission pays out to agents and referrers;
//   orders   = new buyer inquiries that day.
// Commission is worked out by js/commission.js with the broker's own settings, like the app does.
// Only deals of the broker whose login email is HUB_BROKER_EMAIL count.
//
// Off until HUB_FEED_URL (variable), HUB_FEED_TOKEN (secret) and HUB_BROKER_EMAIL (variable) are set.
// Re-sending a day replaces it on the hub, so the 30-day window also picks up late edits.
// The repository is public, so the log shows counts only: no amounts, no names.
"use strict";
const path = require("path");
const { runSql } = require("./supabase_sql.js");
const COMX = require(path.join(__dirname, "..", "js", "commission.js"));

const DAYS = 30;
const BUSINESS_ID = "es-realty";
const centavos = pesos => Math.round(pesos * 100);

function manilaToday(now = Date.now()) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }

function lastDays(today, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// deals: [{ payload, settings }]; inquiries: [{ day, n }]; days: ["YYYY-MM-DD", ...]
function dailyTotals(deals, inquiries, days) {
  const byDay = new Map(days.map(d => [d, { business_id: BUSINESS_ID, day: d, sales_centavos: 0, expenses_centavos: 0, orders: 0 }]));
  for (const { payload: t, settings } of deals) {
    if (!t || (t.stage !== "doas" && t.stage !== "done")) continue;
    const row = byDay.get(COMX.closedOn(t));
    if (!row) continue;
    const sp = COMX.splitFor(t, settings || undefined);
    row.sales_centavos += centavos(sp.pool);
    row.expenses_centavos += centavos(sp.agent + sp.referral);
  }
  for (const { day, n } of inquiries) {
    const row = byDay.get(day);
    if (row) row.orders += Number(n) || 0;
  }
  return [...byDay.values()];
}

// The email goes into SQL, so only a plain address is accepted.
function sqlEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) throw new Error("HUB_BROKER_EMAIL is not a plain email address.");
  return "'" + e + "'";
}

async function main(env = process.env, run = runSql, post = fetch, out = console.log, today = manilaToday()) {
  const url = String(env.HUB_FEED_URL || "").trim();
  const token = String(env.HUB_FEED_TOKEN || "").replace(/\s+/g, "");
  if (!url || !token || !env.HUB_BROKER_EMAIL) {
    out("Not set up yet: add HUB_FEED_URL and HUB_BROKER_EMAIL (variables) and HUB_FEED_TOKEN (secret). Nothing was sent.");
    return { sent: 0 };
  }
  const days = lastDays(today, DAYS);
  const deals = await run(
    "select t.payload, s.payload->'commission'->'settings' as settings from public.broker_transactions t " +
    "join public.profiles p on p.id = t.broker_id left join public.app_state s on s.owner_id = t.broker_id " +
    "where lower(p.email) = " + sqlEmail(env.HUB_BROKER_EMAIL) + " and t.payload->>'stage' in ('doas', 'done')",
  );
  const inquiries = await run(
    "select to_char((created_at at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') as day, count(*)::int as n " +
    "from public.listing_inquiries where created_at >= now() - interval '" + (DAYS + 1) + " days' group by 1",
  );
  const rows = dailyTotals(deals || [], inquiries || [], days);
  const res = await post(url, {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ days: rows }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error("The hub refused the totals (HTTP " + res.status + "): " + (await res.text()).slice(0, 200));
  const closed = rows.filter(r => r.sales_centavos > 0).length;
  out("Sent " + rows.length + " days (" + days[0] + " to " + days[days.length - 1] + "); " + closed + " of them had closed deals.");
  return { sent: rows.length };
}

if (require.main === module) {
  main().then(() => process.exit(0), e => { console.error("::error::" + (e && e.message || e)); process.exit(1); });
}
module.exports = { main, dailyTotals, sqlEmail, lastDays, manilaToday };
