#!/usr/bin/env node
// Nightly database backup for the free Supabase plan (roadmap D1), for .github/workflows/backup.yml.
//
// The free plan has no backup you can download or restore. This copies every table in the public
// schema, plus the account list (auth.users) and the list of stored files (names and sizes, not the
// files), through the Management API, then compresses and ENCRYPTS it with a passphrase only the
// owner knows (repository secret BACKUP_PASSPHRASE). Without the passphrase nothing is written:
// the copy is never kept unencrypted. The repository is public, so the log shows counts only.
//
//   node tools/backup.js export  [--out FILE]          make an encrypted backup
//   node tools/backup.js restore FILE [--sql OUT.sql]  decrypt and write SQL that loads it into a
//                                                      database built from supabase/migrations
//   node tools/backup.js check   FILE                  decrypt and list the tables and row counts
//
// File format: "SEABK1" | salt(16) | iv(12) | tag(16) | AES-256-GCM(gzip(JSON)), key = scrypt(passphrase, salt).
// To open a backup by hand: download the artifact from the Actions run, then
//   BACKUP_PASSPHRASE='...' node tools/backup.js restore sea-backup-2026-10-22.bin --sql restore.sql
// and run restore.sql on a database made with supabase/migrations (see docs/runbook/README.md).
"use strict";
const fs = require("fs");
const zlib = require("zlib");
const crypto = require("crypto");

const MAGIC = Buffer.from("SEABK1");
const PAGE = 2000;
const MIN_PASSPHRASE = 12;

function passphrase(env) {
  const p = String((env || process.env).BACKUP_PASSPHRASE || "");
  if (p.length < MIN_PASSPHRASE) return "";
  return p;
}

function encrypt(plain, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(plain, { level: 9 })), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}

function decrypt(buf, pass) {
  if (!Buffer.isBuffer(buf) || buf.length < 50 || !buf.slice(0, 6).equals(MAGIC)) throw new Error("Not a SEA ESTATES backup file");
  const salt = buf.slice(6, 22), iv = buf.slice(22, 34), tag = buf.slice(34, 50), body = buf.slice(50);
  const key = crypto.scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  let out;
  try { out = Buffer.concat([d.update(body), d.final()]); } catch (e) { throw new Error("Wrong passphrase, or the file is damaged"); }
  return zlib.gunzipSync(out).toString("utf8");
}

// A quoted identifier. Table names come from the database itself (one leftover table is called
// "es realty", with a space), so quote them properly rather than trusting them.
const ident = name => {
  if (!name || /[\u0000-\u001f]/.test(name)) throw new Error("Unexpected table name");
  return '"' + String(name).replace(/"/g, '""') + '"';
};
const asRows = v => Array.isArray(v) ? v : (typeof v === "string" ? JSON.parse(v) : []);

// What is copied. auth.users keeps only the columns needed to sign in again after a restore.
const AUTH_USER_COLUMNS = ["id", "email", "encrypted_password", "email_confirmed_at", "raw_user_meta_data", "raw_app_meta_data", "created_at", "updated_at"];

async function exportAll(run, now) {
  const tables = (await run("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"))
    .map(r => r.table_name);
  const out = { format: 1, createdAt: (now || new Date()).toISOString(), tables: {}, counts: {} };
  for (const t of tables) {
    const rows = [];
    for (let off = 0; ; off += PAGE) {
      const r = await run("select coalesce(json_agg(x), '[]'::json) as rows from (select * from public." + ident(t) + " order by 1 limit " + PAGE + " offset " + off + ") x");
      const page = asRows(r[0] && r[0].rows);
      rows.push.apply(rows, page);
      if (page.length < PAGE) break;
    }
    out.tables["public." + t] = rows;
    out.counts["public." + t] = rows.length;
  }
  const users = await run("select coalesce(json_agg(x), '[]'::json) as rows from (select " + AUTH_USER_COLUMNS.join(", ") + " from auth.users order by created_at) x");
  out.tables["auth.users"] = asRows(users[0] && users[0].rows);
  out.counts["auth.users"] = out.tables["auth.users"].length;
  const files = await run("select coalesce(json_agg(x), '[]'::json) as rows from (select o.bucket_id, o.name, to_jsonb(o) -> 'metadata' ->> 'size' as size, to_jsonb(o) -> 'metadata' ->> 'mimetype' as mimetype, to_jsonb(o) ->> 'created_at' as created_at from storage.objects o order by o.bucket_id, o.name) x");
  out.storageFiles = asRows(files[0] && files[0].rows);
  return out;
}

// SQL that loads a backup into a database built from supabase/migrations (empty tables).
// Triggers and foreign-key checks are off while loading (session_replication_role = replica),
// so the order of tables does not matter and no alerts or change-log rows are made.
function restoreSql(data) {
  const tag = text => { let t = "b"; while (text.indexOf("$" + t + "$") !== -1) t += "x"; return "$" + t + "$"; };
  const lines = ["-- SEA ESTATES backup from " + data.createdAt + ". Load into a database built from supabase/migrations.", "begin;", "set local session_replication_role = replica;"];
  const order = Object.keys(data.tables).sort((a, b) => (a === "auth.users" ? -1 : b === "auth.users" ? 1 : a.localeCompare(b)));
  order.forEach(full => {
    const rows = data.tables[full];
    if (!rows.length) return;
    const dot = full.indexOf("."), schema = full.slice(0, dot), table = full.slice(dot + 1);
    const target = ident(schema) + "." + ident(table);
    for (let i = 0; i < rows.length; i += 500) {
      const json = JSON.stringify(rows.slice(i, i + 500)), t = tag(json);
      if (full === "auth.users") {
        lines.push("insert into auth.users (" + AUTH_USER_COLUMNS.join(", ") + ") select " + AUTH_USER_COLUMNS.join(", ") +
          " from json_populate_recordset(null::auth.users, " + t + json + t + "::json) on conflict (id) do nothing;");
      } else {
        lines.push("insert into " + target + " overriding system value select * from json_populate_recordset(null::" + target + ", " + t + json + t + "::json);");
      }
    }
  });
  // Identity counters continue after the highest restored number.
  lines.push("do $$ declare r record; begin for r in select table_schema, table_name, column_name from information_schema.columns where table_schema = 'public' and is_identity = 'YES' loop " +
    "execute format('select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(%I) from %I.%I), 0) + 1, false)', quote_ident(r.table_schema) || '.' || quote_ident(r.table_name), r.column_name, r.column_name, r.table_schema, r.table_name); end loop; end $$;");
  lines.push("commit;");
  return lines.join("\n") + "\n";
}

async function main(argv, deps) {
  const d = deps || {};
  const out = d.out || console.log, env = d.env || process.env;
  const cmd = argv[0];
  const opt = name => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : ""; };
  const pass = passphrase(env);
  if (cmd === "export") {
    if (!pass) { out("Not set up yet: add the repository secret BACKUP_PASSPHRASE (at least " + MIN_PASSPHRASE + " characters; keep a copy somewhere safe). Nothing was copied."); return { skipped: true }; }
    const run = d.run || require("./supabase_sql.js").runSql;
    const data = await exportAll(run, d.now);
    const file = opt("--out") || "sea-backup-" + data.createdAt.slice(0, 10) + ".bin";
    const enc = encrypt(JSON.stringify(data), pass);
    (d.write || fs.writeFileSync)(file, enc);
    const total = Object.values(data.counts).reduce((s, n) => s + n, 0);
    out("Backup written: " + Object.keys(data.counts).length + " tables, " + total + " rows, " + data.storageFiles.length + " stored files listed, " + Math.round(enc.length / 1024) + " KB encrypted.");
    return { file, data, size: enc.length };
  }
  if (cmd === "restore" || cmd === "check") {
    if (!pass) throw new Error("Set BACKUP_PASSPHRASE to the passphrase used for the backup");
    const file = argv[1];
    if (!file) throw new Error("Name the backup file");
    const data = JSON.parse(decrypt((d.read || fs.readFileSync)(file), pass));
    if (cmd === "check") {
      out("Backup from " + data.createdAt + ": " + Object.keys(data.counts).length + " tables.");
      Object.keys(data.counts).sort().forEach(k => out("  " + k + ": " + data.counts[k]));
      return { data };
    }
    const sql = restoreSql(data), dest = opt("--sql") || "restore.sql";
    (d.write || fs.writeFileSync)(dest, sql);
    out("Restore SQL written to " + dest + " (" + Object.keys(data.counts).length + " tables).");
    return { data, sql };
  }
  throw new Error("Use: export | restore FILE [--sql OUT] | check FILE");
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0), e => { console.error("::error::" + (e && e.message || e)); process.exit(1); });
}
module.exports = { main, encrypt, decrypt, exportAll, restoreSql, passphrase, MAGIC, AUTH_USER_COLUMNS };
