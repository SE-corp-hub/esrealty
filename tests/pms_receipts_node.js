// PMS receipt photos in private storage (supabase/pms_v2_receipts.sql).
// The app and the SQL must agree on the bucket and the file layout, or every
// upload silently falls back to keeping the photo inside the record.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "supabase/pms_v2_receipts.sql"), "utf8");
const tables = fs.readFileSync(path.join(root, "supabase/pms_v2_tables.sql"), "utf8");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log("[PASS] " + name); };

const bucket = (/const PMS_RECEIPTS = "([^"]+)"/.exec(app) || [])[1];
ok("the app names one receipts bucket", !!bucket);
ok("the SQL creates that bucket", sql.indexOf("'" + bucket + "', '" + bucket + "', false") >= 0);
ok("the bucket is private, also when it already exists", /on conflict \(id\) do update\s+set public = false/.test(sql));
ok("only pictures are accepted", /allowed_mime_types[\s\S]*image\/jpeg/.test(sql) && !/application\/pdf/.test(sql));
ok("staff can upload, replace and delete", /create policy "pms receipts staff all"[\s\S]*for all to authenticated[\s\S]*pms_is_staff\(\)[\s\S]*with check[\s\S]*pms_is_staff\(\)/.test(sql));
ok("others read a receipt only if they can read its payment", /create policy "pms receipts linked read"[\s\S]*for select[\s\S]*foldername\(name\)\)\[1\] = 'payments'[\s\S]*from public\.pms_payments p[\s\S]*p\.id = \(storage\.foldername\(name\)\)\[2\]/.test(sql));
ok("an archived payment's receipt is not shared", /and not p\.archived/.test(sql));
ok("no one else gets an insert rule", (sql.match(/create policy/g) || []).length === 2);
ok("the staff check it relies on comes from pms_v2_tables.sql", /create or replace function public\.pms_is_staff\(\)/.test(tables) && /Run AFTER supabase\/pms_v2_tables\.sql/.test(sql));
ok("the app stores files at payments/<payment id>/", /const path = "payments\/" \+ paymentId \+ "\/"/.test(app));
ok("the app opens files through a link that expires", /createSignedUrl\(p\.proofPath, 300\)/.test(app));
ok("a missing bucket stops further tries this session", /bucket not found/i.test(app) && /pmsReceiptsOk = false/.test(app));
ok("the SQL can be run twice", /drop policy if exists "pms receipts staff all"/.test(sql) && /drop policy if exists "pms receipts linked read"/.test(sql));

console.log("\npms_receipts_node: " + passed + " checks passed");
