#!/usr/bin/env node
// Reminders every 15 minutes, for .github/workflows/reminders.yml (roadmap A4 / F9 and J4).
//
//  - Viewings and other calendar entries on a lead: the reminder the agent picked (1 hour,
//    3 hours or 1 day before) arrives in the bell, and on the phone if phone alerts are on.
//  - Licences and permits in the compliance registry: 60, 30 and 7 days before they expire,
//    and on the day, the account that saved the record (and an agent's broker) is told.
//
//   node tools/reminders.js           work it out only (nothing is sent)
//   node tools/reminders.js --send    send
//
// Calls public.viewing_reminder_sweep() and public.compliance_expiry_sweep() (migration 0011).
// The repository is public, so the log shows counts only: no names, no people.
"use strict";
const { runSql } = require("./supabase_sql.js");

function missing(e, fn) {
  const msg = String(e && e.message);
  return msg.indexOf(fn) !== -1 && /does not exist|not exist/i.test(msg);
}

async function main(argv, run = runSql, out = console.log) {
  const send = argv.indexOf("--send") !== -1;
  const dry = send ? "false" : "true";
  let views, licences;
  try {
    views = await run("select * from public.viewing_reminder_sweep(" + dry + ")");
    licences = await run("select * from public.compliance_expiry_sweep(" + dry + ")");
  } catch (e) {
    if (missing(e, "viewing_reminder_sweep") || missing(e, "compliance_expiry_sweep")) {
      out("Not set up yet: apply migration 0011 (Actions > Apply database migration). Nothing was checked.");
      return { viewings: 0, licences: 0, sent: 0, pending: true };
    }
    throw e;
  }
  views = Array.isArray(views) ? views : [];
  licences = Array.isArray(licences) ? licences : [];
  const stages = {};
  licences.forEach(r => { stages[r.stage] = (stages[r.stage] || 0) + 1; });
  out("Viewing reminders due: " + views.length + ".");
  out("Licence reminders due: " + licences.length + (licences.length ? " (" + Object.keys(stages).sort().map(k => (k === "expired" ? "expired" : k + " days") + ": " + stages[k]).join(", ") + ")" : "") + ".");
  if (!send) { out("Worked out only: nothing was sent. (Turn reminders on with the repository variable REMINDER_ALERTS = on.)"); return { viewings: views.length, licences: licences.length, sent: 0 }; }
  const sent = views.concat(licences).filter(r => r.alerted === true).length;
  out("Sent " + sent + " reminders.");
  return { viewings: views.length, licences: licences.length, sent };
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0), e => { console.error("::error::" + (e && e.message || e)); process.exit(1); });
}
module.exports = { main };
