#!/usr/bin/env node
// Prints the deploy flag for one edge function from supabase/config.toml:
// "--no-verify-jwt" when verify_jwt = false, nothing when true. Exits 2 when
// the function has no entry, so a new function can't be deployed by accident
// with the wrong setting. Usage: node tools/fn_verify_jwt.js listing-api
"use strict";
const fs = require("fs");
const path = require("path");
function verifyJwt(toml, name) {
  let current = null;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const sec = /^\[functions\.([A-Za-z0-9_-]+)\]$/.exec(line);
    if (sec) { current = sec[1]; continue; }
    if (/^\[/.test(line)) { current = null; continue; }
    const kv = /^verify_jwt\s*=\s*(true|false)$/.exec(line);
    if (kv && current === name) return kv[1] === "true";
  }
  return null;
}
if (require.main === module) {
  const name = process.argv[2] || "";
  const v = verifyJwt(fs.readFileSync(path.join(__dirname, "..", "supabase", "config.toml"), "utf8"), name);
  if (v === null) { console.error("No [functions." + name + "] verify_jwt in supabase/config.toml"); process.exit(2); }
  process.stdout.write(v ? "" : "--no-verify-jwt");
}
module.exports = { verifyJwt };
