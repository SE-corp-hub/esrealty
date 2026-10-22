"use strict";
// Database and file storage use against the plan's limits (roadmap D2). Used by check-backend.js
// when SUPABASE_ACCESS_TOKEN is available (the nightly Backend Health Check passes it).
//
// The free plan allows 500 MB of database and 1 GB of stored files. At 80% the check fails, so the
// nightly run opens an issue while there is still room to act (delete old files, or upgrade).
// Other plans: set the repository variables USAGE_DB_LIMIT_MB and USAGE_STORAGE_LIMIT_MB.
// Bandwidth (egress) cannot be read with SQL: look at the Usage page in the Supabase dashboard.

const DEFAULT_LIMITS = { dbMb: 500, storageMb: 1024 };
const WARN_AT = 0.8;
const MB = 1024 * 1024;

function limitsFrom(env) {
  const e = env || process.env;
  const pick = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  return { dbMb: pick(e.USAGE_DB_LIMIT_MB, DEFAULT_LIMITS.dbMb), storageMb: pick(e.USAGE_STORAGE_LIMIT_MB, DEFAULT_LIMITS.storageMb) };
}

// sizes: { dbBytes, storageBytes, files }. Returns the lines to print and whether to fail.
function usageLines(sizes, limits) {
  const lim = limits || DEFAULT_LIMITS;
  const rows = [
    ["Database", Number(sizes.dbBytes) || 0, lim.dbMb],
    ["Stored files", Number(sizes.storageBytes) || 0, lim.storageMb],
  ];
  let blocking = false;
  const lines = rows.map(([label, bytes, limitMb]) => {
    const usedMb = bytes / MB, share = usedMb / limitMb;
    const high = share >= WARN_AT;
    if (high) blocking = true;
    return "  " + (high ? "FAIL" : "OK ") + "  " + label + ": " + usedMb.toFixed(1) + " MB of " + limitMb + " MB (" + Math.round(share * 100) + "%)" +
      (high ? "  <-- over " + Math.round(WARN_AT * 100) + "%: delete what is not needed, or move to a bigger plan" : "");
  });
  if (sizes.files != null) lines.push("  INFO  " + sizes.files + " stored files");
  lines.push("  INFO  Bandwidth is not measured here: see Usage in the Supabase dashboard.");
  return { lines, blocking };
}

const SIZE_SQL = "select pg_database_size(current_database())::bigint as db_bytes, " +
  "(select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o)::bigint as storage_bytes, " +
  "(select count(*) from storage.objects)::bigint as files";

async function report(token, run) {
  if (!token && !run) return { lines: ["  INFO  skipped (needs the SUPABASE_ACCESS_TOKEN secret)"], blocking: false };
  const exec = run || (q => require("../tools/supabase_sql.js").runSql(q));
  const r = (await exec(SIZE_SQL))[0] || {};
  return usageLines({ dbBytes: r.db_bytes, storageBytes: r.storage_bytes, files: r.files }, limitsFrom());
}

module.exports = { report, usageLines, limitsFrom, DEFAULT_LIMITS, WARN_AT, SIZE_SQL };
