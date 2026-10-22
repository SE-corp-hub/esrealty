"use strict";
// Database and file storage use against the plan's limits (roadmap D2), for
// .github/workflows/usage-check.yml (nightly). Read-only: it only reads sizes.
//
//   node supabase/check-usage.js
//
// The free plan allows 500 MB of database and 1 GB of stored files. At 80% the run fails, so an
// issue opens while there is still room to act (delete old files, or upgrade).
// Other plans: set the repository variables USAGE_DB_LIMIT_MB and USAGE_STORAGE_LIMIT_MB.
// Bandwidth (egress) cannot be read with SQL: look at the Usage page in the Supabase dashboard.
// Needs the SUPABASE_ACCESS_TOKEN secret (the one the deploy and migration workflows use).

const DEFAULT_LIMITS = { dbMb: 500, storageMb: 1024 };
const WARN_AT = 0.8;
const MB = 1024 * 1024;

function limitsFrom(env) {
  const e = env || process.env;
  const pick = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  return { dbMb: pick(e.USAGE_DB_LIMIT_MB, DEFAULT_LIMITS.dbMb), storageMb: pick(e.USAGE_STORAGE_LIMIT_MB, DEFAULT_LIMITS.storageMb) };
}

// sizes: { dbBytes, storageBytes, files }. Returns the lines to print, one short line per
// measure for the run's summary, and whether to fail.
function usageLines(sizes, limits) {
  const lim = limits || DEFAULT_LIMITS;
  const rows = [
    ["Database", Number(sizes.dbBytes) || 0, lim.dbMb],
    ["Stored files", Number(sizes.storageBytes) || 0, lim.storageMb],
  ];
  let blocking = false;
  const summary = [];
  const lines = rows.map(([label, bytes, limitMb]) => {
    const usedMb = bytes / MB, share = usedMb / limitMb;
    const high = share >= WARN_AT;
    if (high) blocking = true;
    const text = label + ": " + usedMb.toFixed(1) + " MB of " + limitMb + " MB (" + Math.round(share * 100) + "%)";
    summary.push({ high, text });
    return "  " + (high ? "FAIL" : "OK ") + "  " + text +
      (high ? "  <-- over " + Math.round(WARN_AT * 100) + "%: delete what is not needed, or move to a bigger plan" : "");
  });
  if (sizes.files != null) lines.push("  INFO  " + sizes.files + " stored files");
  lines.push("  INFO  Bandwidth is not measured here: see Usage in the Supabase dashboard.");
  return { lines, blocking, summary };
}

const SIZE_SQL = "select pg_database_size(current_database())::bigint as db_bytes, " +
  "(select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o)::bigint as storage_bytes, " +
  "(select count(*) from storage.objects)::bigint as files";

async function report(token, run) {
  if (!token && !run) return { lines: ["  INFO  skipped (needs the SUPABASE_ACCESS_TOKEN secret)"], blocking: false, summary: [], skipped: true };
  const exec = run || (q => require("../tools/supabase_sql.js").runSql(q));
  const r = (await exec(SIZE_SQL))[0] || {};
  return usageLines({ dbBytes: r.db_bytes, storageBytes: r.storage_bytes, files: r.files }, limitsFrom());
}

async function main(deps) {
  const d = deps || {};
  const out = d.out || console.log, env = d.env || process.env;
  const token = String(env.SUPABASE_ACCESS_TOKEN || "").trim();
  const res = await report(d.run ? "" : token, d.run);
  out("=== DATABASE AND FILE STORAGE USE ===");
  res.lines.forEach(l => out(l));
  // Shown on the run's page (and readable without opening the log).
  res.summary.forEach(s => out((s.high ? "::warning title=Storage use::" : "::notice title=Storage use::") + s.text));
  if (res.blocking) out("::error::Over 80% of the plan's limit. Delete what is not needed (old photos, files), or move to a bigger plan.");
  return res;
}

if (require.main === module) {
  main().then(r => process.exit(r.blocking ? 1 : 0), e => { console.error("::error::" + (e && e.message || e)); process.exit(1); });
}
module.exports = { main, report, usageLines, limitsFrom, DEFAULT_LIMITS, WARN_AT, SIZE_SQL };
