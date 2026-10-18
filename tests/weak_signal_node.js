// Phase 5 on a weak signal (2026-10-18). Exercised against the local database
// with the connection cut and restored; this keeps the pieces in place.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const app = fs.readFileSync(path.join(__dirname, "..", "js/app.js"), "utf8");
let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log("[PASS] " + name); };

ok("settings record: the same data isn't sent twice", /if \(body === appStateSent\[ownerId\]\) \{ appStatePending = false; return; \}/.test(app));
ok("settings record: a failed send is retried when back online", /appStatePending = true;/.test(app) && /if \(appStatePending\) save\(\);/.test(app));
ok("leads wait for the signal instead of failing", /if \(error && isNetworkError\(error\)\) \{ cloudWaiting\.leads\[rec\.id\] = rec;/.test(app));
ok("deals wait for the signal instead of failing", /if \(error && isNetworkError\(error\)\) \{ cloudWaiting\.transactions\[rec\.id\] = rec;/.test(app));
ok("Property Management: a dropped connection leaves the record unsent", /if \(synced\[snapshot\.id\]\) synced\[snapshot\.id\]\.fp = null;/.test(app) && /pmsWaiting\[kind \+ ":" \+ rec\.id\] = true;/.test(app));
ok("everything waiting goes out when the connection is back", /window\.addEventListener\("online", \(\) => \{ showNetState\(\); toast\("Back online\.", "ok"\); sendWaiting\(\); \}\);/.test(app));
ok("the banner counts the changes waiting", /changes are" : " change is"|change is" : " changes are/.test(app) && /function showNetState\(\)/.test(app));

console.log("\nweak_signal_node: " + passed + " checks passed");
