// tools/apply_migration.js + tools/supabase_sql.js against a stand-in
// Management API: which files may be applied, test mode rolls back, the token
// and project go where they should, errors are reported.
"use strict";
const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { pick, wrap, main } = require("../tools/apply_migration.js");
const { checkToken, dollarTag, settings } = require("../tools/supabase_sql.js");
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? "  " + detail : "")); passed++; console.log("[PASS] " + name); };

(async () => {
  ok("a numbered file is accepted", !pick("0002_shared_records_updated_at.sql").error && /create trigger/.test(pick("0002_shared_records_updated_at.sql").sql));
  ok("the folder prefix may be typed too", pick("supabase/migrations/0001_pms_receipts_and_tenant_requests.sql").file === "0001_pms_receipts_and_tenant_requests.sql");
  ok("the baseline is never applied", /never applied/.test(pick("0000_baseline.sql").error || ""));
  ok("odd names are refused (no paths, no other folders)", !!pick("../archive/schema.sql").error && !!pick("0002_x.sql; drop table x").error && !!pick("").error);
  ok("a missing file is reported", /No such file/.test(pick("0099_nothing_here.sql").error || ""));
  ok("test mode wraps the file in a rolled-back transaction", wrap("select 1;", true) === "begin;\nselect 1;\nrollback;" && wrap("select 1;", false) === "select 1;");
  ok("token checks: missing and wrong kind", /Add the SUPABASE_ACCESS_TOKEN/.test(checkToken("")) && /personal access token/.test(checkToken("eyJabc")) && checkToken("sbp_123") === "");
  ok("a pasted token loses stray spaces and line breaks", settings({ SUPABASE_ACCESS_TOKEN: " sbp_abc \n" }).token === "sbp_abc");
  ok("dollar-quote tag never clashes with the text", dollarTag("x $j$ y") === "$jx$" && dollarTag("plain") === "$j$");

  const seen = [];
  let reply = { status: 201, body: [{ updated_at_triggers: 3 }] };
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", c => b += c); req.on("end", () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(b || "{}") });
      res.writeHead(reply.status, { "content-type": "application/json" }); res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const opts = { base: "http://127.0.0.1:" + srv.address().port, token: "sbp_test", ref: "abcdefghijklmnopqrst" };
  const logs = []; const keep = { log: console.log, error: console.error };
  console.log = (...a) => logs.push(a.join(" ")); console.error = (...a) => logs.push(a.join(" "));
  let code = await main(["0002_shared_records_updated_at.sql"], opts);
  const codeTest = await main(["0002_shared_records_updated_at.sql", "--test"], opts);
  reply = { status: 400, body: { message: "syntax error at or near \"tabel\"" } };
  const codeErr = await main(["0002_shared_records_updated_at.sql"], opts);
  const codeBase = await main(["0000_baseline.sql"], opts);
  console.log = keep.log; console.error = keep.error;
  srv.close();
  const sql = fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/0002_shared_records_updated_at.sql"), "utf8");
  ok("apply: posts the file to the project's query endpoint with the token", code === 0 && seen[0].method === "POST" && seen[0].url === "/v1/projects/abcdefghijklmnopqrst/database/query" && seen[0].auth === "Bearer sbp_test" && seen[0].body.query === sql);
  ok("apply: prints the file's check result", logs.some(l => /"updated_at_triggers": 3/.test(l)));
  ok("test: the same file, rolled back", codeTest === 0 && /^begin;\n/.test(seen[1].body.query) && /\nrollback;$/.test(seen[1].body.query));
  ok("an error from the database fails the run with its message", codeErr === 1 && logs.some(l => /::error::Database said \(400\): syntax error/.test(l)));
  ok("the baseline isn't even sent", codeBase === 1 && seen.length === 3);

  const wf = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/db-migrate.yml"), "utf8");
  ok("workflow: by hand only (no schedule, no push)", /workflow_dispatch:/.test(wf) && !/schedule:/.test(wf) && !/\n  push:/.test(wf));
  ok("workflow: test is the default, apply must be chosen", /default: test/.test(wf) && /options: \[test, apply\]/.test(wf));

  console.log("\ndb_migrate_node: " + passed + " checks passed");
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
