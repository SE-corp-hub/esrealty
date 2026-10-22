/* Storage use check (roadmap D2): supabase/check-usage.js and .github/workflows/usage-check.yml.
 * Read-only sizes against the plan's limits; the nightly run fails (and opens an issue) at 80%. */
const fs = require("fs");
const path = require("path");
const U = require("../supabase/check-usage.js");
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });
(async () => {
  const lim = U.limitsFrom({});
  c("free plan limits by default: 500 MB database, 1 GB files", lim.dbMb === 500 && lim.storageMb === 1024);
  c("limits follow the repository variables; a bad value keeps the default", U.limitsFrom({ USAGE_DB_LIMIT_MB: "8192", USAGE_STORAGE_LIMIT_MB: "x" }).dbMb === 8192 && U.limitsFrom({ USAGE_STORAGE_LIMIT_MB: "x" }).storageMb === 1024);
  const low = U.usageLines({ dbBytes: 100 * 1048576, storageBytes: 200 * 1048576, files: 3 }, lim);
  const high = U.usageLines({ dbBytes: 400 * 1048576, storageBytes: 0 }, lim);
  c("under 80% passes", !low.blocking && /OK   Database: 100\.0 MB of 500 MB \(20%\)/.test(low.lines.join("\n")));
  c("at 80% fails", high.blocking && /FAIL  Database: 400\.0 MB of 500 MB \(80%\)/.test(high.lines.join("\n")));
  c("bandwidth is said to be checked in the dashboard", /Bandwidth is not measured here/.test(low.lines.join("\n")));
  let sql = "";
  const r = await U.report("", async q => { sql = q; return [{ db_bytes: 1048576, storage_bytes: 0, files: 0 }]; });
  c("reads the database size and stored file sizes", /pg_database_size\(current_database\(\)\)/.test(sql) && /from storage\.objects/.test(sql));
  c("only reads: no insert, update, delete or alter", !/\b(insert|update|delete|alter|drop|truncate)\b/i.test(U.SIZE_SQL));
  c("the report runs through the SQL tool", !r.blocking && r.lines.length === 4);
  c("without the token it is skipped, not failed", (await U.report("")).skipped === true);
  let out = [];
  const m = await U.main({ run: async () => [{ db_bytes: 450 * 1048576, storage_bytes: 10 * 1048576, files: 2 }], out: l => out.push(l), env: {} });
  c("the numbers show on the run's page", out.some(l => /^::warning title=Storage use::Database: 450\.0 MB of 500 MB \(90%\)$/.test(l)) && out.some(l => /^::notice title=Storage use::Stored files: 10\.0 MB of 1024 MB \(1%\)$/.test(l)));
  c("over 80%: an error line says what to do", m.blocking && out.some(l => /^::error::Over 80%/.test(l)));
  const wf = read(".github/workflows/usage-check.yml");
  c("workflow: nightly and on demand", /cron: "23 21 \* \* \*"/.test(wf) && /workflow_dispatch:/.test(wf));
  c("workflow: passes the token and the plan limits", /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/.test(wf) && /USAGE_DB_LIMIT_MB: \$\{\{ vars\.USAGE_DB_LIMIT_MB \}\}/.test(wf) && /USAGE_STORAGE_LIMIT_MB: \$\{\{ vars\.USAGE_STORAGE_LIMIT_MB \}\}/.test(wf));
  c("workflow: runs the check and opens one issue on failure", /run: node supabase\/check-usage\.js/.test(wf) && /title="Scheduled job failed: Storage use check"/.test(wf) && /if: failure\(\)/.test(wf));

  const failed = checks.filter(x => !x.ok);
  checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : " :: " + x.detail)));
  console.log(failed.length ? failed.length + " FAILED" : "ALL PASS");
  process.exit(failed.length ? 1 : 0);
})();
