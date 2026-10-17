// Property Management cloud mapping (js/pms_cloud.js) against the v2 tables
// in supabase/pms_v2_tables.sql: every kind has a table, the link columns the
// row rules need are filled from the record, and only changed records are sent.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const PC = require("../js/pms_cloud.js");
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? " — " + detail : "")); passed++; console.log("[PASS] " + name); };

const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "pms_v2_tables.sql"), "utf8");
const APP_KINDS = ["properties", "units", "owners", "tenants", "leases", "payments", "maintenance", "expenses", "documents"];

ok("every PMS list in the app has a table", APP_KINDS.every(k => PC.KINDS[k]) && PC.ORDER.length === APP_KINDS.length);
for (const kind of PC.ORDER) {
  const table = PC.KINDS[kind].table;
  const m = new RegExp("create table if not exists public\\." + table + " \\(([\\s\\S]*?)\\);").exec(sql);
  ok(table + " is created by the v2 SQL", !!m);
  const row = PC.toRow(kind, { id: "x-1", owner_id: "o", property_id: "p", unit_id: "u", tenant_id: "t", lease_id: "l", authUserId: "11111111-1111-1111-1111-111111111111" });
  const missing = Object.keys(row).filter(c => !new RegExp("\\b" + c + "\\b").test(m[1]));
  ok(table + " has every column the app writes", missing.length === 0, missing.join(","));
}

const lease = { id: "l-1", unit_id: "u-1", property_id: "p-1", tenant_id: "t-1", owner_id: "o-1", rent: 10000, archived: false };
const row = PC.toRow("leases", lease);
ok("lease links come from the record", row.property_id === "p-1" && row.unit_id === "u-1" && row.tenant_id === "t-1" && row.owner_id === "o-1");
ok("the whole record travels in data", row.data.rent === 10000 && row.data === lease);
ok("blank links are stored as null", PC.toRow("payments", { id: "p", lease_id: "", property_id: undefined }).lease_id === null);
ok("only a real account id links a login", PC.toRow("tenants", { id: "t", authUserId: "pms-tenant-t" }).auth_user_id === null
  && PC.toRow("owners", { id: "o", authUserId: "55555555-5555-5555-5555-555555555555" }).auth_user_id === "55555555-5555-5555-5555-555555555555");
ok("archived is its own column", PC.toRow("units", { id: "u", archived: true }).archived === true);

const back = PC.fromRow({ id: "l-1", data: { rent: 5, id: "stale" }, archived: true });
ok("loading takes id and archived from the row", back.id === "l-1" && back.archived === true && back.rent === 5);

const a = { id: "a", n: 1 }, b = { id: "b", n: 2 };
const synced = { a: { fp: PC.fingerprint(a) }, b: { fp: PC.fingerprint(b) } };
ok("nothing to send when nothing changed", PC.changed([a, b], synced).length === 0);
b.n = 3;
const c = { id: "c" };
const out = PC.changed([a, b, c, { id: "" }], synced);
ok("only edited and new records are sent", out.length === 2 && out[0] === b && out[1] === c);
ok("a failed save (fp cleared) is sent again", PC.changed([a], { a: { fp: null } }).length === 1);

// Books (supabase/pms_v3_books.sql): the row names its book once that script has run.
ok("a row names its book when one is given", PC.toRow("units", { id: "u1", property_id: "p1" }, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").book_id === "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
ok("without books the row has no book column", !("book_id" in PC.toRow("units", { id: "u1" })));
ok("the book is a column, not part of the saved record", !("book_id" in PC.toRow("units", { id: "u1" }, PC.COMPANY_BOOK).data));
ok("the company book is the all-zero id", PC.COMPANY_BOOK === "00000000-0000-0000-0000-000000000000");

console.log("\npms_cloud_node: " + passed + " checks passed");
