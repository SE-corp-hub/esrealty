// Phase 2, app side (2026-10-21): the compliance registry and website settings are copied to their
// tables, and the stale badge counts from the last save. The settings copy is run in a browser
// (tests/site_settings_mirror_e2e.js); the compliance copy needs a signed-in cloud account, so its
// pure parts are run here and the wiring is checked in the source.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
let passed = 0;
const ok = (name, cond, detail) => { assert.ok(cond, name + (detail ? "  " + detail : "")); passed++; console.log("[PASS] " + name); };

// ---- compliance row ----------------------------------------------------------------------------
const start = app.indexOf("const COMPLIANCE_DATE");
const end = app.indexOf("async function mirrorCompliance");
assert.ok(start > 0 && end > start, "cannot find complianceRow");
const { complianceRow } = new Function(app.slice(start, end) + "\nreturn { complianceRow };")();
let row = complianceRow({ id: "cmp-1", type: "mayors_permit", name: "Mayor's Permit", number: "MP-1", holder: "SEA", issuedAt: "2026-01-02", expiresAt: "2026-12-31", status: "active", notes: "n", agentSteps: [{ x: 1 }], updatedAt: "now" });
ok("a saved record becomes a table row with snake_case dates", row.id === "cmp-1" && row.issued_at === "2026-01-02" && row.expires_at === "2026-12-31" && row.type === "mayors_permit");
ok("only the table's columns are sent (no agent steps, no owner)", JSON.stringify(Object.keys(row).sort()) === JSON.stringify(["expires_at", "holder", "id", "issued_at", "name", "notes", "number", "status", "type"]), Object.keys(row).join(","));
row = complianceRow({ id: "cmp-2", name: "Perpetual", expiresAt: "", issuedAt: "" });
ok("a blank date is null (the registry allows 'perpetual')", row.expires_at === null && row.issued_at === null);
row = complianceRow({ id: "cmp-3", name: "Typed date", expiresAt: "next June", issuedAt: "6/1/2026" });
ok("a date typed as words is null, not a rejected row", row.expires_at === null && row.issued_at === null);
row = complianceRow({ id: "cmp-4", name: "x" });
ok("missing fields get the same defaults as the table", row.type === "broker_license" && row.status === "active" && row.number === "" && row.notes === "");

// ---- wiring ------------------------------------------------------------------------------------
ok("saving a record copies it after the screen is updated", /toast\("Compliance record saved", "ok"\);\s*mirrorCompliance\(rec\);/.test(app));
ok("deleting a record removes the copy", /toast\("Compliance record deleted", "ok"\);\s*unmirrorCompliance\(id\);/.test(app));
ok("sample rows (cmp-seed-...) are never copied", /filter\(r => r && r\.id && !\/\^cmp-seed-\/\.test\(String\(r\.id\)\)\)/.test(app));
ok("editing a sample row gives it its own id first", /if \(\/\^cmp-seed-\/\.test\(String\(rec\.id\)\)\) rec\.id = "cmp-" \+ Date\.now\(\)/.test(app));
ok("a sample row's delete is not sent to the table", /\|\| !id \|\| \/\^cmp-seed-\/\.test\(String\(id\)\)\) return false;/.test(app));
ok("after sign-in the missing records are copied once", /syncComplianceRecords\(\);\s*\}/.test(app) && /const missing = mine\.filter\(r => !have\[String\(r\.id\)\]\)/.test(app));
ok("the copy needs a cloud account and never throws", /async function mirrorCompliance\(r\) \{\s*if \(!SB \|\| !currentUser \|\| !currentUser\.id/.test(app) && /async function mirrorCompliance[\s\S]*?catch \(e\) \{ return false; \}/.test(app));
ok("the owner is not sent (the table's trigger sets it)", !/owner:/.test(/function complianceRow[\s\S]*?\n  \}\n/.exec(app)[0]));
ok("settings: Contact Us and Value Guide saves copy to site_settings", /publishSiteSetting\("siteContact", c\)/.test(app) && /publishSiteSetting\("valueGuide", v\)/.test(app));
ok("settings: only a super-admin writes them, as public rows", /async function publishSiteSetting[\s\S]*?!roleIs\("super-admin"\)[\s\S]*?is_public: true/.test(app));
ok("settings: after sign-in the table's value is adopted and a missing one is copied (run in site_settings_mirror_e2e)", /async function syncSiteSettings[\s\S]*?if \(have\.siteContact\)[\s\S]*?else await publishSiteSetting\("siteContact"[\s\S]*?if \(have\.valueGuide\)[\s\S]*?else await publishSiteSetting\("valueGuide"/.test(app));
ok("the public settings reader prefers the table, then the saved data", /table\.siteContact \?\? /.test(fs.readFileSync(path.join(root, "supabase/functions/listing-api/index.ts"), "utf8")) && /table\.valueGuide \?\? /.test(fs.readFileSync(path.join(root, "supabase/functions/listing-api/index.ts"), "utf8")));
ok("the reader ignores a missing table (before the migration)", /const readSettingsTable[\s\S]*?if \(error \|\| !Array\.isArray\(data\)\) return \{\};/.test(fs.readFileSync(path.join(root, "supabase/functions/listing-api/index.ts"), "utf8")));

// ---- stale badge -------------------------------------------------------------------------------
ok("stale counts days since the last save, from 75 days (same as the server reminder)", /const idleDays = Math\.floor\(\(Date\.now\(\) - new Date\(l\.updatedAt \|\| l\.createdAt \|\| Date\.now\(\)\)\.getTime\(\)\) \/ 86400000\);\s*const isStale = [^\n]*idleDays >= 75;/.test(app));
ok("the auto-draft keeps its 90-day rule and uses the same date", /const _cut = Date\.now\(\) - 90 \* 86400000;/.test(app) && /l\.updatedAt \|\| l\.createdAt \|\| 0/.test(app));

console.log("\nphase2_app_node: " + passed + " checks passed");
