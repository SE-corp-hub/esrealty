#!/usr/bin/env node
// Daily saved-search alerts, for .github/workflows/saved-search-alerts.yml.
//
// A buyer who saved a search on the website gets one bell notification (and a phone alert, if they
// turned those on) when listings published since the last check match it. At most one a day per
// saved search.
//
//   node tools/saved_search_alerts.js           work it out only (nothing is sent)
//   node tools/saved_search_alerts.js --send    send the notifications
//
// Calls public.saved_search_sweep() (migration 0022). The repository is public, so the log shows
// counts only: no searches, no listings, no people.
"use strict";
const { runSql } = require("./supabase_sql.js");

async function main(argv, run = runSql, out = console.log) {
  const send = argv.indexOf("--send") !== -1;
  let rows;
  try {
    rows = await run("select * from public.saved_search_sweep(" + (send ? "false" : "true") + ")");
  } catch (e) {
    // Before migration 0022 is applied the function does not exist yet: say so, do not raise an alarm.
    if (/saved_search_sweep/.test(String(e && e.message)) && /does not exist|not exist/i.test(String(e && e.message))) {
      out("Not set up yet: apply migration 0022 (Actions > Apply database migration). Nothing was checked.");
      return { searches: 0, matched: 0, sent: 0, pending: true };
    }
    throw e;
  }
  const list = Array.isArray(rows) ? rows : [];
  const people = new Set(list.map(r => r.owner_id)).size;
  const matched = list.filter(r => Number(r.matches) > 0).length;
  out("Saved searches: " + list.length + " from " + people + " people; " + matched + " have new matching listings.");
  if (!send) { out("Worked out only: nothing was sent. (Turn alerts on with the repository variable SAVED_SEARCH_ALERTS = on.)"); return { searches: list.length, matched, sent: 0 }; }
  const sent = list.filter(r => r.alerted === true).length;
  out("Sent " + sent + " alerts (a search alerted in the last 20 hours waits for tomorrow).");
  return { searches: list.length, matched, sent };
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0), e => { console.error("::error::" + (e && e.message || e)); process.exit(1); });
}
module.exports = { main };
