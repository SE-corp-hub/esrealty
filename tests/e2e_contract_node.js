// Every browser test must tell the CI driver (tests/cdp_driver_runner.js) how it
// went: window.__msOk (all checks passed) and window.__msDone (finished). A test
// that only sets __msDone passes in a local runner but fails on GitHub.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => /_e2e\.js$/.test(f));
let passed = 0;
const missing = files.filter(f => { const s = fs.readFileSync(path.join(dir, f), "utf8"); return !/window\.__msOk\s*=/.test(s) || !/window\.__msDone\s*=\s*true/.test(s); });
assert.deepStrictEqual(missing, [], "browser tests that don't report __msOk/__msDone: " + missing.join(", "));
passed++; console.log("[PASS] all " + files.length + " browser tests report __msOk and __msDone");
console.log("\ne2e_contract_node: " + passed + " checks passed");
