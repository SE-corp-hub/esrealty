/* tools/backup.js without a database: encryption, refusal without a passphrase, restore SQL shape,
 * counts-only log. The full export/restore round trip runs in tests/db/backup_roundtrip.sh. */
const B = require("../tools/backup.js");
const fs = require("fs");
const path = require("path");
const checks = [];
const c = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });
(async () => {
  const pass = "correct horse battery";
  const enc = B.encrypt(JSON.stringify({ a: 1, name: "Maria Santos" }), pass);
  c("the file starts with its own marker", enc.slice(0, 6).toString() === "SEABK1");
  c("the content is not readable without the passphrase", !enc.includes(Buffer.from("Maria")) && !enc.includes(Buffer.from("name")));
  c("the right passphrase opens it", JSON.parse(B.decrypt(enc, pass)).name === "Maria Santos");
  let msg = ""; try { B.decrypt(enc, "wrong passphrase!!"); } catch (e) { msg = e.message; }
  c("a wrong passphrase is refused with a plain message", /Wrong passphrase/.test(msg), msg);
  const bad = Buffer.from(enc); bad[bad.length - 1] ^= 1;
  msg = ""; try { B.decrypt(bad, pass); } catch (e) { msg = e.message; }
  c("a damaged file is detected", /damaged/.test(msg), msg);
  c("two backups of the same data differ (fresh salt and IV)", !B.encrypt("x", pass).equals(B.encrypt("x", pass)));
  c("a short passphrase counts as none", B.passphrase({ BACKUP_PASSPHRASE: "short" }) === "" && B.passphrase({ BACKUP_PASSPHRASE: "long enough pass" }) === "long enough pass");

  const lines = []; let wrote = false;
  const r = await B.main(["export"], { env: {}, out: l => lines.push(l), write: () => { wrote = true; }, run: async () => { throw new Error("should not be called"); } });
  c("without the passphrase nothing is copied or written", r.skipped && !wrote && /add the repository secret BACKUP_PASSPHRASE/.test(lines.join(" ")), lines.join(" "));

  const fakeDb = async sql => {
    if (/information_schema\.tables/.test(sql)) return [{ table_name: "crm_leads" }, { table_name: "es realty" }];
    if (/from public\."crm_leads"/.test(sql)) return [{ rows: /offset 0/.test(sql) ? [{ id: "L1", name: "Maria Santos" }] : [] }];
    if (/from public\."es realty"/.test(sql)) return [{ rows: "[]" }];
    if (/from auth\.users/.test(sql)) return [{ rows: [{ id: "u1", email: "a@x.ph" }] }];
    if (/storage\.objects/.test(sql)) return [{ rows: [{ bucket_id: "listing-photos", name: "u1/a.jpg" }] }];
    return [];
  };
  let file = null; const out2 = [];
  const ex = await B.main(["export"], { env: { BACKUP_PASSPHRASE: pass }, out: l => out2.push(l), run: fakeDb, write: (f, b) => { file = b; }, now: new Date("2026-10-22T18:23:00Z") });
  c("export copies every table, the accounts and the file list", ex.data.counts["public.crm_leads"] === 1 && ex.data.counts["public.es realty"] === 0 && ex.data.counts["auth.users"] === 1 && ex.data.storageFiles.length === 1);
  c("file is named by date", ex.file === "sea-backup-2026-10-22.bin");
  c("the log shows counts only", /3 tables, 2 rows, 1 stored files listed/.test(out2.join(" ")) && !/Maria|a@x\.ph/.test(out2.join(" ")), out2.join(" "));
  c("what is written is encrypted", Buffer.isBuffer(file) && JSON.parse(B.decrypt(file, pass)).tables["public.crm_leads"][0].name === "Maria Santos");

  const sql = B.restoreSql(ex.data);
  c("restore loads with triggers and checks off, in one transaction", /^-- SEA ESTATES backup/.test(sql) && /begin;\nset local session_replication_role = replica;/.test(sql) && /commit;\n$/.test(sql));
  c("accounts are loaded first", sql.indexOf("insert into auth.users") < sql.indexOf('insert into "public"."crm_leads"'));
  c("numbered ids are kept and counters continue after them", /overriding system value/.test(sql) && /setval\(pg_get_serial_sequence/.test(sql));
  c("empty tables add no statement", !/"es realty" overriding/.test(sql));
  c("data is passed in a quoted block, not pasted into SQL", /json_populate_recordset\(null::"public"\."crm_leads", \$b\$\[\{"id":"L1"/.test(sql));

  const wf = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/backup.yml"), "utf8");
  c("workflow: nightly, passphrase from a secret, restore drill, 30-day encrypted artifact, issue on failure",
    /cron: "23 18 \* \* \*"/.test(wf) && /BACKUP_PASSPHRASE: \$\{\{ secrets\.BACKUP_PASSPHRASE \}\}/.test(wf) && /restore drill/i.test(wf) && /retention-days: 30/.test(wf) && /Scheduled job failed: Database backup/.test(wf));
  const ok = checks.every(x => x.ok) && checks.length >= 18;
  console.log("\n[backup_node] " + checks.length + " checks");
  checks.forEach(x => console.log("  [" + (x.ok ? "PASS" : "FAIL") + "] " + x.name + (x.ok ? "" : "  " + x.detail)));
  console.log(ok ? "ALL PASS" : "FAILURES PRESENT");
  process.exit(ok ? 0 : 1);
})();
