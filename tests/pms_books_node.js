// PMS books (supabase/archive/pms_v3_books.sql, admin-create-account, js/app.js).
// Owner's decision 2026-10-17: only brokers and super-admins manage PMS, each
// their own records; super-admins can look at broker books read-only; logins a
// broker makes for owners and tenants work straight away. The full behaviour is
// tested against Postgres with the real row rules; this guards the pieces from
// drifting apart.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "supabase/archive/pms_v3_books.sql"), "utf8");
const fn = fs.readFileSync(path.join(root, "supabase/functions/admin-create-account/index.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const cloud = require("../js/pms_cloud.js");
let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log("[PASS] " + name); };

const TABLES = ["pms_owners", "pms_tenants", "pms_properties", "pms_units", "pms_leases", "pms_payments", "pms_maintenance", "pms_expenses", "pms_documents"];
const loops = sql.match(/foreach t in array array\[([^\]]+)\]/g) || [];
ok("every change runs over all nine PMS tables", loops.length >= 4 && loops.every(l => TABLES.every(t => l.indexOf("'" + t + "'") >= 0)));
ok("the company book is the all-zero id, in the SQL and the app", /'00000000-0000-0000-0000-000000000000'::uuid/.test(sql) && cloud.COMPANY_BOOK === "00000000-0000-0000-0000-000000000000");
ok("existing rows go to the company book", /set book_id = public\.pms_company_book\(\) where book_id is null/.test(sql));
ok("rows always have a book", /alter column book_id set not null/.test(sql));
ok("an older app version still saves into the right book", /alter column book_id set default public\.pms_my_book\(\)/.test(sql));
ok("only approved super-admins and brokers have a book", /when 'super-admin' then public\.pms_company_book\(\)[\s\S]*when 'broker' then p\.id[\s\S]*registration_status = 'approved'/.test(sql));
ok("the old staff-only rule is removed", /drop policy if exists %I on public\.%I', t \|\| ' staff all'/.test(sql));
ok("managers do everything, in their own book only", /for all using \(public\.pms_can_manage\(book_id\)\) with check \(public\.pms_can_manage\(book_id\)\)/.test(sql));
ok("super-admins read every book, and only read", /' super-admin read'[\s\S]*for select using \(public\.is_super_admin\(\)\)/.test(sql) && !/super-admin read[^;]*for (all|update|insert|delete)/.test(sql));
ok("links between books are refused", /create trigger %I before insert or update on public\.%I for each row execute function public\.pms_same_book\(\)/.test(sql) && /PMS records from different books cannot be linked/.test(sql));
ok("records never change book except through a transfer", /A PMS record cannot move to another book/.test(sql) && /current_setting\('pms\.transfer', true\)/.test(sql));
ok("the link check covers every link column", ["owner_id:pms_owners", "property_id:pms_properties", "unit_id:pms_units", "tenant_id:pms_tenants", "lease_id:pms_leases"].every(l => sql.indexOf("'" + l + "'") >= 0));
ok("moving a book is for super-admins, to the company or an approved broker, and is logged", /function public\.pms_transfer_book[\s\S]*if not public\.is_super_admin\(\)[\s\S]*role::text = 'broker' and registration_status = 'approved'[\s\S]*'pms_transfer_book'/.test(sql));
ok("the email lookup answers only managers, only for owner and tenant logins, and is logged", /function public\.pms_find_login[\s\S]*if public\.pms_my_book\(\) is null[\s\S]*p_role not in \('owner', 'tenant'\)[\s\S]*'pms_find_login'/.test(sql));
ok("the book list is for super-admins", /function public\.pms_books\(\)[\s\S]*if not public\.is_super_admin\(\)/.test(sql));
ok("new functions are not open to anonymous visitors", ["pms_my_book()", "pms_can_manage(uuid)", "pms_login_status()", "pms_find_login(text, text)", "pms_books()", "pms_transfer_book(uuid, uuid)"].every(f => sql.indexOf("revoke all on function public." + f + " from public, anon") >= 0));
ok("the user list keeps every field it had live", ["'requested_role'", "'prc'", "'resa'", "'agency'", "'broker'", "'email'", "'registration_status'"].every(k => sql.indexOf(k) >= 0));
ok("the user list says which broker added a login", /'added_by', coalesce\(u\.raw_user_meta_data ->> 'created_by'/.test(sql) && /'added_by_role'/.test(sql));

ok("function: approved brokers may call it", /const callerIsBroker = callerApproved && caller\?\.role === "broker"/.test(fn));
ok("function: brokers make owner and tenant logins only", /callerIsBroker && role !== "owner" && role !== "tenant"/.test(fn));
ok("function: broker-made logins work straight away; super-admin ones stay pending", /const status = callerIsBroker \? "approved" : "pending"/.test(fn));
ok("function: it records who made the login", /created_by: authData\.user\.id/.test(fn) && /created_by_role: caller\?\.role/.test(fn));

const capBlock = app.slice(app.indexOf("const ROLE_CAPABILITIES"), app.indexOf("};", app.indexOf("const ROLE_CAPABILITIES")));
const caps = role => { const m = new RegExp("\\n\\s*" + role + ": \\[([^\\]]*)\\]").exec(capBlock); return m ? m[1] : ""; };
ok("app: brokers can view and manage PMS", /"pms\.view"/.test(caps("broker")) && /"pms\.manage"/.test(caps("broker")));
ok("app: agents, buyers and sellers cannot", ["agent", "buyer", "seller"].every(r => !/"pms\./.test(caps(r))));
ok("app: a super-admin looking at a broker book cannot change it", /if \(pmsViewBook\) return false;/.test(app) && /function pmsCanWrite\(\) \{ return pmsIsManager\(\) && !pmsViewBook; \}/.test(app));
ok("app: saves name the manager's book", /PC\.toRow\(kind, rec, pmsBooks \? pmsMyBook\(\) : null\)/.test(app));
ok("app: managers load one book", /if \(book\) q = q\.eq\("book_id", book\)/.test(app));
ok("app: brokers unlink owners instead of deleting logins", /const unlinkOnly = kind === "owner" && !canManageUsers\(\);/.test(app));

console.log("\npms_books_node: " + passed + " checks passed");
