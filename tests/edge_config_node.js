// Edge functions: one place says which ones the gateway leaves open
// (supabase/config.toml), the deploy workflow reads it, and every function uses
// the same pinned supabase-js.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const { verifyJwt } = require("../tools/fn_verify_jwt.js");
const toml = read("supabase/config.toml");
const wf = read(".github/workflows/deploy-functions.yml");
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? " — " + detail : "")); passed++; console.log("[PASS] " + name); };

const open = ["listing-api", "location-report", "seo", "fb-leads", "agent-dispatch", "admin-create-account"];
ok("public functions check their own secrets or roles (verify_jwt = false)", open.every(f => verifyJwt(toml, f) === false), open.filter(f => verifyJwt(toml, f) !== false).join(","));
ok("notify-dispatch and nearby-scan stay behind a login", verifyJwt(toml, "notify-dispatch") === true && verifyJwt(toml, "nearby-scan") === true);
const entries = (toml.match(/^\[functions\.([A-Za-z0-9_-]+)\]/gm) || []).map(s => s.slice(11, -1));
ok("every entry has a function folder", entries.every(f => fs.existsSync(path.join(root, "supabase/functions", f, "index.ts"))), entries.join(","));
ok("a function without an entry can't be deployed", verifyJwt(toml, "admin-delete-account") === null);
ok("the deploy workflow reads the setting from config.toml", /node tools\/fn_verify_jwt\.js "\$fn"/.test(wf) && !/listing-api\|location-report\|seo/.test(wf));
const versions = new Set();
fs.readdirSync(path.join(root, "supabase/functions")).forEach(f => {
  const p = path.join(root, "supabase/functions", f, "index.ts");
  if (!fs.existsSync(p)) return;
  (fs.readFileSync(p, "utf8").match(/supabase-js@[^"'/]+/g) || []).forEach(v => versions.add(v));
});
ok("every function uses one exact supabase-js version", versions.size === 1 && /@\d+\.\d+\.\d+$/.test([...versions][0]), [...versions].join(","));

console.log("\nedge_config_node: " + passed + " checks passed");
