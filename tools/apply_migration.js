#!/usr/bin/env node
// Applies one numbered file from supabase/migrations/ to the live database,
// for .github/workflows/db-migrate.yml (run by hand).
//
//   node tools/apply_migration.js 0003_short_name.sql [--test]
//
// --test runs the file inside a transaction and rolls it back: it shows
// whether the file goes through, and changes nothing.
// The baseline (0000_baseline.sql) builds a fresh database, so it only runs on
// a project whose public schema has no tables yet (a new Supabase project).
"use strict";
const fs = require("fs");
const path = require("path");
const { runSql } = require("./supabase_sql.js");

const DIR = path.join(__dirname, "..", "supabase", "migrations");

function pick(name) {
  const file = String(name || "").trim().replace(/^supabase\/migrations\//, "");
  if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(file)) return { error: "Give a file name like 0003_short_name.sql (from supabase/migrations)." };
  const full = path.join(DIR, file);
  if (!fs.existsSync(full)) return { error: "No such file: supabase/migrations/" + file };
  return { file, sql: fs.readFileSync(full, "utf8"), baseline: /^0000_/.test(file) };
}

// In test mode the whole file runs in one transaction that is rolled back.
function wrap(sql, test) {
  return test ? "begin;\n" + sql.replace(/;\s*$/, "") + ";\nrollback;" : sql;
}

async function main(argv, opts = {}) {
  const test = argv.indexOf("--test") !== -1;
  const name = argv.find(a => !/^--/.test(a));
  const p = pick(name);
  if (p.error) { console.error("::error::" + p.error); return 1; }
  console.log((test ? "Testing (rolled back, nothing changes): " : "Applying: ") + p.file);
  try {
    if (p.baseline) {
      const n = await runSql("select count(*)::int as tables from pg_tables where schemaname = 'public';", opts);
      if (!n || !n[0] || n[0].tables !== 0) {
        console.error("::error::0000_baseline.sql only builds a fresh database, and this one already has tables. Apply the numbered files instead.");
        return 1;
      }
    }
    const rows = await runSql(wrap(p.sql, test), opts);
    if (test) console.log("The file ran without errors and was rolled back.");
    else console.log("Done. The file's check (last statement):\n" + JSON.stringify(rows, null, 2));
    return 0;
  } catch (e) {
    console.error("::error::" + (e && e.message || e));
    return 1;
  }
}

if (require.main === module) main(process.argv.slice(2)).then(code => process.exit(code));
module.exports = { pick, wrap, main };
