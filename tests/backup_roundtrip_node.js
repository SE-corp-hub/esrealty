/* Helper for tests/db/backup_roundtrip.sh: runs tools/backup.js against a local Postgres the way the
 * Management API would (each query's rows as JSON), and compares two databases table by table. */
const { execFileSync } = require("child_process");
const B = require("../tools/backup.js");
const [cmd, db, other] = process.argv.slice(2);
const psql = (database, sql) => execFileSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", sql], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const runOn = database => async sql => JSON.parse(psql(database, "select coalesce(json_agg(q), '[]'::json) from (" + sql + ") q").trim() || "[]");
(async () => {
  if (cmd === "export") {
    const r = await B.main(["export", "--out", other], { run: runOn(db), out: () => {} });
    console.log("exported " + Object.keys(r.data.counts).length + " tables");
    return;
  }
  if (cmd === "compare") {
    const tables = psql(db, "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1").trim().split("\n").filter(Boolean);
    const diff = [];
    let rows = 0;
    for (const t of tables.concat(["auth.users"])) {
      const name = t.includes(".") ? t : "public." + t;
      const q = name === "auth.users"
        ? "select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) || ':' || count(*) from (select id, email, created_at from auth.users) x"
        : "select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) || ':' || count(*) from public.\"" + t.replace(/"/g, '""') + "\" x";
      const a = psql(db, q).trim(), b = psql(other, q).trim();
      rows += Number(a.split(":")[1]);
      if (a !== b) diff.push(name + " " + a + " vs " + b);
    }
    console.log("[backup round trip] " + tables.length + " tables + accounts, " + rows + " rows compared");
    if (diff.length) { console.log("FAIL rows differ:\n  " + diff.join("\n  ")); process.exit(1); }
    console.log("PASS every table restored with the same rows");
    return;
  }
  throw new Error("export DB FILE | compare DB OTHER");
})().catch(e => { console.error(e.message || e); process.exit(1); });
