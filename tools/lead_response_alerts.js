#!/usr/bin/env node
// Hourly "Not contacted yet" alerts, for .github/workflows/lead-response.yml (roadmap F3).
//
// A lead still marked New after HOURS (default 24) puts a note in the assigned person's bell
// (the Super Admins' when nobody is assigned); after twice that, the agent's broker hears too.
// Each message goes once per lead. Leads older than 14 days are left alone.
//
//   node tools/lead_response_alerts.js            work it out only (nothing is sent)
//   node tools/lead_response_alerts.js --send     send
//   --hours N                                     hours before the first alert (default 24)
//
// Calls public.lead_response_sweep() (migration 0008). The repository is public, so the log
// shows counts only: no names, no people.
"use strict";
const { runSql } = require("./supabase_sql.js");

const DEFAULT_HOURS = 24;

function hoursFrom(argv, env) {
  const i = argv.indexOf("--hours");
  const raw = i !== -1 ? argv[i + 1] : (env && env.LEAD_RESPONSE_HOURS) || "";
  if (raw === "" || raw == null) return DEFAULT_HOURS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 720) throw new Error("hours must be a whole number between 1 and 720");
  return n;
}

async function main(argv, run = runSql, out = console.log, env = process.env) {
  const send = argv.indexOf("--send") !== -1;
  const hours = hoursFrom(argv, env);
  let rows;
  try {
    // `hours` is a checked integer, so it is safe to place in the statement.
    rows = await run("select * from public.lead_response_sweep(" + hours + ", " + (send ? "false" : "true") + ")");
  } catch (e) {
    const msg = String(e && e.message);
    if (/lead_response_sweep/.test(msg) && /does not exist|not exist/i.test(msg)) {
      out("Not set up yet: apply migration 0008 (Actions > Apply database migration). Nothing was checked.");
      return { found: 0, sent: 0, pending: true };
    }
    throw e;
  }
  const list = Array.isArray(rows) ? rows : [];
  const leads = new Set(list.map(r => r.lead_id)).size;
  const first = list.filter(r => r.step === "assignee").length, esc = list.filter(r => r.step === "escalation").length;
  out("Leads still New after " + hours + " hours: " + leads + " (" + first + " first alerts, " + esc + " escalations due).");
  if (!send) { out("Worked out only: nothing was sent. (Turn alerts on with the repository variable LEAD_RESPONSE_ALERTS = on.)"); return { found: list.length, sent: 0 }; }
  const sent = list.filter(r => r.alerted === true).length;
  out("Sent " + sent + " alerts.");
  return { found: list.length, sent };
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0), e => { console.error("::error::" + (e && e.message || e)); process.exit(1); });
}
module.exports = { main, hoursFrom, DEFAULT_HOURS };
