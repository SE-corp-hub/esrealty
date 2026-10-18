// CRM (2026-10-18): a super-admin assigns leads to real brokers. On the live
// site the "Assign to" list comes from the account list (approved brokers, by
// login id), loaded before the form opens; the demo keeps its local users.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const app = fs.readFileSync(path.join(__dirname, "..", "js/app.js"), "utf8");
let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log("[PASS] " + name); };
ok("live: approved brokers from the account list, by login id", /\(remoteProfiles \|\| \[\]\)\.filter\(p => String\(p\.role \|\| ""\) === "broker" && String\(p\.registration_status \|\| ""\) === "approved"\)/.test(app) && /id: String\(p\.id\)/.test(app));
ok("demo: the local users as before", /return \(state\.users \|\| \[\]\)\.filter\(u => u\.role === "broker" && u\.active !== false\)/.test(app));
ok("the super-admin's list uses it", /if \(roleIs\("super-admin"\)\) \{\s*agentPool = leadBrokerPool\(\);/.test(app));
ok("the account list is loaded before the form opens", /if \(roleIs\("super-admin"\) && leadLiveAccounts\(\) && !remoteProfilesLoaded\) \{\s*try \{ await loadCloudProfiles\(true\); \}/.test(app));
console.log("\nlead_assign_node: " + passed + " checks passed");
