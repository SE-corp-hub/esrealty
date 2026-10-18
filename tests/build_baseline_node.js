// tests/db/build_baseline.js: turns the schema export CSV into the baseline.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseCsv, build, splitMaintain } = require("./db/build_baseline.js");
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? " — " + detail : "")); passed++; console.log("[PASS] " + name); };

const rows = parseCsv('ord,name,ddl\n3,f(),"CREATE FUNCTION f()\n RETURNS int AS $$ select 1 $$;"\n5,t,"create table t (a text default \'\'\'\'::text, ""q"" int)"\n');
ok("CSV: quoted cells with line breaks stay whole", rows.length === 3 && rows[1][2].indexOf("\n RETURNS") > 0, JSON.stringify(rows));
ok("CSV: doubled quotes become one", rows[2][2].indexOf('"q"') > 0);

const sql = build([
  "ord,name,ddl",
  '5,b_table,create table if not exists public.b (id text)',
  '3,f(),"CREATE OR REPLACE FUNCTION public.f()\n RETURNS integer LANGUAGE sql AS $$ select 1 $$\n"',
  "1,pgcrypto,create extension if not exists pgcrypto with schema extensions",
  "13,public.b.p,create policy p on public.b as permissive for select to authenticated using (true)"
].join("\n"), "test.csv");
const at = s => sql.indexOf(s);
ok("statements come out in dependency order", at("pgcrypto") < at("FUNCTION public.f") && at("FUNCTION public.f") < at("create table") && at("create table") < at("create policy"));
ok("every statement ends with a semicolon", /\$\$;\n/.test(sql) && /\(id text\);\n/.test(sql));
ok("function bodies are not checked before their tables exist", /set check_function_bodies = off;/.test(sql));
ok("a missing extension doesn't stop the build", /do \$\$ begin execute 'create extension if not exists pgcrypto with schema extensions'; exception when others/.test(sql));
ok("Windows line endings inside a function body become plain ones", build('ord,name,ddl\n3,g(),"CREATE FUNCTION g()\r\n AS $$ select 1 $$"\n', "x").indexOf("\r") < 0);
ok("Postgres 17's MAINTAIN right goes in a step older versions skip",
  splitMaintain("grant DELETE, INSERT, MAINTAIN, SELECT on public.t to authenticated") === "grant DELETE, INSERT, SELECT on public.t to authenticated;\ndo $$ begin execute 'grant MAINTAIN on public.t to authenticated'; exception when others then null; end $$"
  && splitMaintain("grant MAINTAIN on public.t to anon") === "do $$ begin execute 'grant MAINTAIN on public.t to anon'; exception when others then null; end $$"
  && /in schema public grant INSERT on tables to anon;\ndo \$\$ begin execute 'alter default privileges for role postgres in schema public grant MAINTAIN on tables to anon'/.test(splitMaintain("alter default privileges for role postgres in schema public grant INSERT, MAINTAIN on tables to anon")));
assert.throws(() => build("a,b\n1,2", "x"), /ord, name, ddl/); passed++; console.log("[PASS] a wrong file is refused with a clear message");

const base = fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/0000_baseline.sql"), "utf8");
ok("the committed baseline holds no email addresses", !/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(base.replace(/onboarding@resend\.dev/g, "")));
ok("the committed baseline has no carriage returns", base.indexOf("\r") < 0);
ok("the committed baseline creates the PMS book rules", /create policy "pms_payments manager all"/.test(base) && /pms_same_book/.test(base));

console.log("\nbuild_baseline_node: " + passed + " checks passed");
