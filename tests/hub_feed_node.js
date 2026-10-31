// Nightly totals for the SE Corp Hub (tools/hub_feed.js): ES Realty's commission from closed deals,
// what it pays out, and new inquiries, per Philippine day.
"use strict";
const assert = require("assert");
const path = require("path");
const root = path.join(__dirname, "..");
const { dailyTotals, main, sqlEmail, lastDays } = require(path.join(root, "tools/hub_feed.js"));
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? "  " + detail : "")); passed++; console.log("[PASS] " + name); };

(async () => {
  ok("last 3 days ends today", JSON.stringify(lastDays("2026-10-30", 3)) === JSON.stringify(["2026-10-28", "2026-10-29", "2026-10-30"]));

  const settings = { grossPct: 3, brokerShare: 40, agentShare: 50, referralShare: 10 };
  const deals = [
    // 5,000,000 x 3% = 150,000; agent 50% = 75,000; no referrer so the house keeps 75,000
    { payload: { stage: "done", price: 5000000, doasDate: "2026-10-29", agentName: "A" }, settings },
    // 2,000,000 x 3% = 60,000, co-broke 50% off the top = 30,000 pool; agent 15,000, referral 3,000
    { payload: { stage: "doas", price: 2000000, doasDate: "2026-10-29", agentName: "B", referralName: "R", commission: { cobrokeName: "P", cobrokePct: 50 } }, settings },
    // not closed yet: does not count
    { payload: { stage: "cts", price: 9000000, doasDate: "2026-10-29" }, settings },
    // closed outside the window: does not count
    { payload: { stage: "done", price: 1000000, doasDate: "2026-09-01" }, settings },
    // the broker never saved settings: the app's defaults apply (3%, agent 50%)
    { payload: { stage: "done", price: 1000000, doasDate: "2026-10-30" }, settings: null },
  ];
  const rows = dailyTotals(deals, [{ day: "2026-10-30", n: 4 }], ["2026-10-29", "2026-10-30"]);
  ok("one row per day, zeros included", rows.length === 2 && rows.every(r => r.business_id === "es-realty"));
  const d29 = rows[0], d30 = rows[1];
  ok("sales are ES Realty's commission after the co-broke share", d29.sales_centavos === (150000 + 30000) * 100, String(d29.sales_centavos));
  ok("expenses are what is paid to agents and referrers", d29.expenses_centavos === (75000 + 15000 + 3000) * 100, String(d29.expenses_centavos));
  ok("a day with no inquiries has 0 orders", d29.orders === 0);
  ok("default settings apply when the broker saved none", d30.sales_centavos === 30000 * 100 && d30.expenses_centavos === 15000 * 100);
  ok("orders count that day's inquiries", d30.orders === 4);
  ok("amounts are whole centavos", rows.every(r => Number.isSafeInteger(r.sales_centavos) && Number.isSafeInteger(r.expenses_centavos)));

  ok("a normal email is quoted for SQL", sqlEmail("Broker@Gmail.com") === "'broker@gmail.com'");
  ["", "x", "a'b@c.com", "a@b.com; drop table x", "a b@c.com"].forEach(v => ok("email " + JSON.stringify(v) + " is refused", (() => { try { sqlEmail(v); return false; } catch (e) { return true; } })()));

  // Not set up: says so and sends nothing.
  let lines = [];
  let r = await main({}, async () => { throw new Error("must not query"); }, async () => { throw new Error("must not send"); }, l => lines.push(l));
  ok("not set up: nothing is read or sent", r.sent === 0 && /Not set up/.test(lines.join("\n")));

  // Set up: queries, sends the rows with the token, logs counts only (the repository is public).
  const queries = [], sent = [];
  lines = [];
  const env = { HUB_FEED_URL: "https://hub.example/api/feed/daily-totals", HUB_FEED_TOKEN: "tok", HUB_BROKER_EMAIL: "broker@gmail.com" };
  const run = async q => { queries.push(q); return /listing_inquiries/.test(q) ? [{ day: "2026-10-30", n: 2 }] : deals; };
  const post = async (url, init) => { sent.push({ url, init }); return { ok: true, status: 200, text: async () => '{"saved":30}' }; };
  r = await main(env, run, post, l => lines.push(l), "2026-10-30");
  ok("deals are read for the broker's email only", queries.some(q => /broker_transactions/.test(q) && /'broker@gmail.com'/.test(q)));
  ok("30 days are sent to the hub with the token", sent.length === 1 && sent[0].url === env.HUB_FEED_URL && sent[0].init.headers.authorization === "Bearer tok" && JSON.parse(sent[0].init.body).days.length === 30);
  ok("the log has counts and no amounts", /Sent 30 days/.test(lines.join("\n")) && !/150|000/.test(lines.join("\n")), lines.join(" | "));

  // The hub refuses: the run fails so the workflow opens an issue.
  const refuse = async () => ({ ok: false, status: 401, text: async () => '{"error":"bad token"}' });
  let failed = false;
  try { await main(env, run, refuse, () => {}, "2026-10-30"); } catch (e) { failed = /401/.test(e.message); }
  ok("a refused send fails the run", failed);

  console.log("\nhub_feed: " + passed + " passed");
})().catch(e => { console.error(e); process.exit(1); });
