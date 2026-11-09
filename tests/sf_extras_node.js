// Public-site helpers (js/sf_extras.js) and how the storefront, the listing function, the database
// migration and the daily job fit together for the 2026-11-09 website upgrades.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const X = require(path.join(root, "js/sf_extras.js"));
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? "  " + detail : "")); passed++; console.log("[PASS] " + name); };

(async () => {
  // 1. Monthly payment
  ok("payment: P1,000,000 at 6% for 20 years is about P7,164 a month", Math.round(X.monthlyPayment(1000000, 6, 20)) === 7164);
  ok("payment: 0% interest divides evenly", X.monthlyPayment(1200000, 0, 10) === 10000);
  ok("payment: nonsense gives 0, never NaN", X.monthlyPayment(-5, 6, 20) === 0 && X.monthlyPayment(1000, 6, 0) === 0 && X.monthlyPayment("x", 6, 20) === 0);
  let r = X.payment(5000000, 10, 6.25, 30, "pagibig");
  ok("payment: P5M, 10% down -> P4.5M loan, P500K down", r.loan === 4500000 && r.downPayment === 500000 && !r.capped);
  ok("payment: income needed is the payment / 35%", r.incomeNeeded === Math.round(r.monthly / 0.35));
  r = X.payment(8000000, 10, 6.25, 30, "pagibig");
  ok("payment: Pag-IBIG loan stops at P6,000,000 and the rest is down payment", r.loan === 6000000 && r.downPayment === 2000000 && r.capped);
  ok("payment: a bank loan has no P6M cap", X.payment(8000000, 10, 7.5, 20, "bank").loan === 7200000);
  ok("payment: three lenders with example rates", X.LENDERS.map((l) => l.id).join() === "pagibig,bank,inhouse" && X.LENDERS.every((l) => l.rate > 0 && l.years > 0));

  // 2. Chat links
  ok("Viber: a PH mobile number becomes +63", X.viberLink("0905 307 9119") === "viber://chat?number=%2B639053079119" && X.viberLink("+63 905 307 9119") === "viber://chat?number=%2B639053079119");
  ok("Viber: no link for a landline or nothing", X.viberLink("(043) 123 4567") === "" && X.viberLink("") === "");
  ok("Messenger: a page username or Facebook address becomes m.me", X.messengerLink("seaestates.ph") === "https://m.me/seaestates.ph" && X.messengerLink("https://www.facebook.com/seaestates.ph/") === "https://m.me/seaestates.ph");
  ok("Messenger: anything else gives no link", X.messengerLink("javascript:alert(1)") === "" && X.messengerLink("https://evil.example/x") === "" && X.messengerLink("https://www.facebook.com/profile.php?id=1") === "");

  // 3. Plain-language search
  let q = X.parseQuery("3 bedroom house in Lipa under 5M");
  ok("parse: 3 bedroom house in Lipa under 5M", JSON.stringify(q.filters) === JSON.stringify({ max_price: "5000000", beds: "3", property_type: "house-and-lot", city: "Lipa" }), JSON.stringify(q));
  q = X.parseQuery("condo for rent Batangas City 15k");
  ok("parse: rent, condo, Batangas City, 15k", q.filters.offer_type === "rent" && q.filters.property_type === "condominium" && q.filters.city === "Batangas" && q.filters.max_price === "15000" && !q.filters.q, JSON.stringify(q));
  q = X.parseQuery("lot in Sto. Tomas 2-4 million");
  ok("parse: a price range and Sto. Tomas", q.filters.min_price === "2000000" && q.filters.max_price === "4000000" && q.filters.property_type === "lot-only" && q.filters.city === "Tomas", JSON.stringify(q));
  q = X.parseQuery("bahay sa Tanauan hanggang 3M 2 kwarto");
  ok("parse: Filipino words", q.filters.property_type === "house-and-lot" && q.filters.city === "Tanauan" && q.filters.max_price === "3000000" && q.filters.beds === "2", JSON.stringify(q));
  q = X.parseQuery("corner pool");
  ok("parse: plain keywords stay keywords", !q.understood.length && q.filters.q === "corner pool");
  q = X.parseQuery("farm lot Rosario over 10M checked");
  ok("parse: farm, minimum price, checked", q.filters.property_type === "agricultural" && q.filters.min_price === "10000000" && q.filters.checked === "true" && q.filters.city === "Rosario");
  ok("parse: a long or odd input never throws", (() => { X.parseQuery("(".repeat(500)); X.parseQuery(null); X.parseQuery("₱₱₱ 999999999999999 m"); return true; })());

  // 4. Travel time
  const t = X.travel(13.9411, 121.1631, 14.5547, 121.0244);
  ok("travel: Lipa to Makati is about 70 km straight, 2 hr 15 min", t.km > 65 && t.km < 75 && t.minutes === 135, JSON.stringify(t));
  ok("travel: never under 5 minutes, null for missing points", X.travel(14, 121, 14, 121).minutes === 5 && X.travel("x", 1, 2, 3) === null);
  ok("travel: labels in hours", X.minutesLabel(135) === "2 hr 15 min" && X.minutesLabel(45) === "45 min" && X.minutesLabel(60, true) === "1 oras");

  // 5. Price trends from the real history file
  const tr = X.trends(JSON.parse(read("data/comparables/history.json")), 10);
  ok("trends: latest month and the one before", /^\d{4}-\d{2}$/.test(tr.month) && /^\d{4}-\d{2}$/.test(tr.previous) && tr.month > tr.previous);
  ok("trends: busiest town first, with house & lot and vacant lot medians", tr.rows[0].n >= tr.rows[1].n && tr.rows.some((x) => x.built && x.built.median > 0) && tr.rows.some((x) => x.vacant && x.vacant.median > 0));
  ok("trends: a change only when both months have 10+ prices", tr.rows.every((x) => ["built", "vacant"].every((k) => !x[k] || x[k].change == null || x[k].n >= 10)));
  ok("trends: an empty file gives no rows", X.trends({}).rows.length === 0 && X.trends(null).rows.length === 0);
  ok("trends: town names read normally", X.titleTown("STO. TOMAS CITY") === "Sto. Tomas City" && X.titleTown("LIPA CITY") === "Lipa City");

  // 6. Drawn area
  const square = [[14, 121], [14, 122], [13, 122], [13, 121]];
  ok("area: inside and outside a drawn square", X.inPolygon(13.5, 121.5, square) && !X.inPolygon(14.5, 121.5, square) && !X.inPolygon(13.5, 121.5, square.slice(0, 2)));

  // 7. Filipino
  ok("language: English by default, every Filipino string is filled", X.lang() === "en" && X.t("Properties") === "Properties" && Object.values(X.FIL).every((v) => typeof v === "string" && v.trim()));
  X.setLang("fil");
  ok("language: Filipino when chosen; unknown text stays as it is", X.t("Properties") === "Mga Property" && X.t("Something new") === "Something new");
  X.setLang("en");

  // 8. Wiring
  const html = read("index.html"), sw = read("sw.js"), sf = read("js/storefront.js");
  ok("the helpers load before the storefront and are precached", html.indexOf("js/sf_extras.js") > 0 && html.indexOf("js/sf_extras.js") < html.indexOf("js/storefront.js") && sw.includes('"./js/sf_extras.js"'));
  ok("storefront: payment box, chat, save search, area, travel, media, history, prices page, language", ["paymentBox(listing)", "chatButtons()", "saveSearchBox(params)", "drawBar()", "travelSection(listing)", "mediaSection(listing)", "priceHistory(listing)", "pricesPage()", "langToggle()", "X.parseQuery(typed)"].every((s) => sf.includes(s)));
  ok("storefront: a YouTube video plays from youtube-nocookie, allowed by the CSP", sf.includes("https://www.youtube-nocookie.com/embed/") && /frame-src[^;]*https:\/\/www\.youtube-nocookie\.com/.test(read("_headers")));
  const fn = read("supabase/functions/listing-api/index.ts");
  ok("listing function: saved searches routes, up to 10 each", fn.includes('"users/me/searches"') && fn.includes("MAX_SAVED_SEARCHES = 10") && fn.includes("deleteSavedSearch"));
  ok("listing function: only a broker or Super Admin sets Checked by SEA ESTATES", /const officeRoles = new Set\(\["super-admin", "broker"\]\)/.test(fn) && /canCheck && details\.office_checked !== undefined/.test(fn));
  ok("listing function: the 360 tour link must be HTTPS", /details\.tour_url must be a valid HTTPS URL/.test(fn));
  ok("listing function: checked and reduced filters, and the new catalog columns", fn.includes('"office_checked", "previous_price"') && fn.includes('searchParams.get("checked") === "true"') && fn.includes('searchParams.get("reduced") === "true"'));
  const mig = read("supabase/migrations/0022_site_upgrades.sql");
  ok("migration 0022: new tables closed to visitors", /revoke all on public\.listing_price_changes from public, anon, authenticated/.test(mig) && /revoke all on public\.saved_searches from public, anon, authenticated/.test(mig));
  ok("migration 0022: the daily job is for the server only", /grant execute on function public\.saved_search_sweep\(boolean\) to service_role/.test(mig));

  // 9. Daily job
  const { main } = require(path.join(root, "tools/saved_search_alerts.js"));
  const calls = [], lines = [];
  const rows = [{ search_id: "s-secret", owner_id: "u1", matches: 2, alerted: false }, { search_id: "s2", owner_id: "u1", matches: 0, alerted: false }, { search_id: "s3", owner_id: "u2", matches: 1, alerted: false }];
  let res = await main([], async (sql) => { calls.push(sql); return rows; }, (l) => lines.push(l));
  ok("job: a dry run by default, counts only", /saved_search_sweep\(true\)/.test(calls[0]) && res.sent === 0 && res.matched === 2 && /3 from 2 people; 2 have new/.test(lines[0]) && !/secret|u1/.test(lines.join("\n")));
  lines.length = 0;
  res = await main(["--send"], async () => rows.map((x) => Object.assign({}, x, { alerted: x.matches > 0 })), (l) => lines.push(l));
  ok("job: --send sends and reports how many", res.sent === 2 && /Sent 2 alerts/.test(lines.join("\n")));
  res = await main(["--send"], async () => { throw new Error("function public.saved_search_sweep(boolean) does not exist"); }, (l) => lines.push(l));
  ok("job: before migration 0022 it says so and does not fail", res.pending === true);
  const wf = read(".github/workflows/saved-search-alerts.yml");
  ok("workflow: off until SAVED_SEARCH_ALERTS is on", wf.includes("vars.SAVED_SEARCH_ALERTS") && wf.includes('if [ "$SENDING" = "on" ]; then node tools/saved_search_alerts.js --send; else node tools/saved_search_alerts.js; fi'));

  console.log(passed + " passed");
})().catch((e) => { console.error(e.message); process.exit(1); });
