#!/usr/bin/env node
// Monthly clean-up of old data (roadmap B3), for .github/workflows/retention.yml.
// Calls public.retention_sweep() (migration 0010). Counts only until RETENTION_CLEANUP = on.
// The periods are in the migration; confirm them with your privacy officer or lawyer first.
//   node tools/retention_cleanup.js          count only
//   node tools/retention_cleanup.js --delete delete
"use strict";
const { runSql } = require("./supabase_sql.js");

async function main(argv, run = runSql, out = console.log) {
  const del = argv.indexOf("--delete") !== -1;
  let rows;
  try {
    rows = await run("select * from public.retention_sweep(" + (del ? "false" : "true") + ")");
  } catch (e) {
    if (/retention_sweep/.test(String(e && e.message)) && /does not exist/i.test(String(e && e.message))) {
      out("Not set up yet: apply migration 0010 (Actions > Apply database migration). Nothing was checked.");
      return { pending: true };
    }
    throw e;
  }
  (rows || []).forEach(r => out("  " + r.what + ": " + r.rows_found + (r.deleted ? " (deleted)" : "")));
  if (!del) out("Counted only: nothing was deleted. (Turn clean-up on with the repository variable RETENTION_CLEANUP = on, after the periods are confirmed.)");
  return { rows };
}
if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0), e => { console.error("::error::" + (e && e.message || e)); process.exit(1); });
}
module.exports = { main };
