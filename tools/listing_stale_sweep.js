#!/usr/bin/env node
// Daily "Still available?" reminders, for .github/workflows/listing-stale.yml.
//
// A published listing that its agent has not saved for 75 days gets one bell
// notification ("Still available? ..."), then again every 14 days while it
// stays untouched. Nothing is unpublished: a listing that is really gone is
// closed by its agent (sold, rented, off market), which also clears the reminder.
//
//   node tools/listing_stale_sweep.js           work it out only (nothing is sent)
//   node tools/listing_stale_sweep.js --send    send the notifications
//   --days N                                    idle days before the first reminder (default 75)
//
// Calls public.listing_stale_sweep() (migration 0005). The repository is public,
// so the log shows counts only: no listing names, no people.
"use strict";
const { runSql } = require("./supabase_sql.js");

const DEFAULT_DAYS = 75;

function daysFrom(argv) {
  const i = argv.indexOf("--days");
  if (i === -1) return DEFAULT_DAYS;
  const n = Number(argv[i + 1]);
  if (!Number.isInteger(n) || n < 1 || n > 3650) throw new Error("--days must be a whole number between 1 and 3650");
  return n;
}

async function main(argv, run = runSql, out = console.log) {
  const send = argv.indexOf("--send") !== -1;
  const days = daysFrom(argv);
  // `days` is a checked integer, so it is safe to place in the statement.
  let rows;
  try {
    rows = await run("select * from public.listing_stale_sweep(" + days + ", " + (send ? "false" : "true") + ")");
  } catch (e) {
    // Before migration 0005 is applied the function does not exist yet: say so, do not raise an alarm.
    if (/listing_stale_sweep/.test(String(e && e.message)) && /does not exist|not exist/i.test(String(e && e.message))) {
      out("Not set up yet: apply migration 0005 (Actions > Apply database migration). Nothing was checked.");
      return { found: 0, sent: 0, pending: true };
    }
    throw e;
  }
  const list = Array.isArray(rows) ? rows : [];
  const owners = new Set(list.map(r => r.owner_id)).size;
  const oldest = list.reduce((m, r) => Math.max(m, Number(r.idle_days) || 0), 0);
  out("Stale listings (idle " + days + "+ days): " + list.length + " listings across " + owners + " agents" + (list.length ? ", longest idle " + oldest + " days" : "") + ".");
  if (!send) { out("Worked out only: nothing was sent. (Turn reminders on with the repository variable LISTING_STALE_ALERTS = on.)"); return { found: list.length, sent: 0 }; }
  const sent = list.filter(r => r.alerted === true).length;
  out("Sent " + sent + " reminders (listings reminded in the last 14 days are skipped).");
  return { found: list.length, sent };
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0), e => { console.error("::error::" + (e && e.message || e)); process.exit(1); });
}
module.exports = { main, daysFrom, DEFAULT_DAYS };
