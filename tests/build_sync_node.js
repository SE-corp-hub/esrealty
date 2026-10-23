"use strict";
/* Build-sync gate: verifies the artifact index.html actually loads matches the
 * source it was built from.
 *
 * Why this exists: index.html loads js/app.min.js, not js/app.js. The browser
 * suite therefore validates the BUNDLE. When the bundle drifts, every e2e test
 * can stay green while the app runs old code — which is exactly what happened
 * for three commits. This test turns that silent failure into a red build.
 *
 * Run: node tests/build_sync_node.js   (or via tests/run_all.ps1)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "js", "app.js");
const BUNDLE = path.join(ROOT, "js", "app.min.js");
const INDEX = path.join(ROOT, "index.html");
const TESTS = path.join(ROOT, "tests");
const STAMP_GLOBAL = "__ESREALTY_APP_HASH__";
const CODE_STAMP_GLOBAL = "__ESREALTY_CODE_HASH__";

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("[PASS] " + name + (detail ? " — " + detail : "")); }
  else { fail++; console.log("[FAIL] " + name + (detail ? " — " + detail : "")); }
  return ok;
}
function readOr(p) { try { return fs.readFileSync(p, "utf8"); } catch (e) { return null; } }
/* Normalize line endings before hashing, exactly like build_app.js. The repo is
 * developed on Windows with core.autocrlf=true, so the working copy is CRLF while
 * git/CI check out the LF blob. A raw byte hash would only ever match on the
 * machine that built it and fail everywhere else. */
function normalizeEol(text) { return String(text).replace(/\r\n/g, "\n"); }
function sourceHash() { return crypto.createHash("sha256").update(normalizeEol(fs.readFileSync(SRC, "utf8"))).digest("hex").slice(0, 16); }
function codeHash(code) { return crypto.createHash("sha256").update(normalizeEol(code)).digest("hex").slice(0, 16); }
function stampIn(code, global) {
  const m = new RegExp("window\\." + global + '\\s*=\\s*"([0-9a-f]+)"').exec(code || "");
  return m ? m[1] : "";
}

const src = readOr(SRC);
const bundle = readOr(BUNDLE);
const index = readOr(INDEX);

/* 1. the files the whole gate depends on must exist */
check("js/app.js present", src !== null);
check("js/app.min.js present", bundle !== null);
check("index.html present", index !== null);

/* 2. index.html must load the bundle — if this ever flips, the gate is wrong */
check("index.html loads the bundle", !!index && /js\/app\.min\.js/.test(index),
  index && /js\/app\.min\.js/.test(index) ? "js/app.min.js" : "index.html does not reference js/app.min.js");

if (src !== null && bundle !== null) {
  /* 3. the bundle must be stamped with the hash of the current source */
  const want = sourceHash();
  const have = stampIn(bundle, STAMP_GLOBAL);
  check("bundle carries a build stamp", !!have, have || "no stamp found — run: node build_app.js");
  check("bundle matches source", have === want,
    have === want ? want : "bundle=" + (have || "none") + " source=" + want +
      " — index.html runs the bundle, so the browser suite is testing stale code. Run: node build_app.js");

  /* 3b. the shipped bytes must be exactly what the build produced, so a
   *     hand-edited bundle cannot pass as a fresh build */
  const wantCode = stampIn(bundle, CODE_STAMP_GLOBAL);
  const body = bundle.slice(bundle.indexOf("\n") + 1);
  const haveCode = codeHash(body);
  check("bundle is unmodified since it was built", !!wantCode && wantCode === haveCode,
    !wantCode ? "no content stamp — run: node build_app.js"
      : wantCode === haveCode ? haveCode
        : "built=" + wantCode + " onDisk=" + haveCode + " — js/app.min.js was edited by hand. Run: node build_app.js");

  /* 4. the bundle must still be syntactically valid JS */
  let parses = true;
  let parseErr = "";
  try { new vm.Script(bundle, { filename: "app.min.js" }); } catch (e) { parses = false; parseErr = e.message; }
  check("bundle parses as valid JS", parses, parseErr);

  /* 5. minification must actually be minifying. Whitespace-stripping only
   *    (compress:false, mangle:false) means the build is silently misconfigured. */
  const ratio = bundle.length / src.length;
  check("bundle is minified, not just whitespace-stripped", ratio < 0.85,
    (ratio * 100).toFixed(1) + "% of source (expect < 85%)");

  /* 6. Every window global app.js defines must survive into the bundle.
   *    Derived from the source rather than a hand-kept list, so it stays
   *    correct as the app grows. Terser does not rename window properties,
   *    so a mismatch here means the bundle lost or mangled a real seam. */
  const defined = Array.from(new Set(
    (src.match(/window\.(_?[A-Za-z][A-Za-z0-9_]*)\s*=/g) || [])
      .map(s => s.replace(/^window\./, "").replace(/\s*=$/, ""))
  ));
  const lostGlobals = defined.filter(g => bundle.indexOf(g) === -1);
  check("bundle preserves every window seam app.js defines", lostGlobals.length === 0,
    lostGlobals.length ? "missing from bundle: " + lostGlobals.join(", ") : defined.length + " seams");
}

/* 7. Dropped-UI guard: every data-* hook a browser test positively drives must
 *    still be rendered by the shipped source. This is the general form — it
 *    catches any future rename, not just the one that bit us.
 *
 *    Two kinds of token are deliberately excluded, because they are not
 *    "the app must render this":
 *      a) negative assertions (`!q('[data-est-spin]')`) — these assert a hook
 *         is ABSENT, so its absence is the passing condition.
 *      b) documented fallback aliases below — selectors a test tries first and
 *         abandons when they miss.
 */
const FALLBACK_ALIASES = {
  "data-lead-q": "crm_core_e2e.js tries this then falls back to #lead-q",
  "data-pms-tab": "pms tests try this then fall back to button-text match; tabs are data-pmtab in app.js:8357"
};
// Explicitly removed features may still be queried by absence assertions or
// optional compatibility checks. Require that these hooks stay absent instead
// of treating their test references as instructions to restore deleted UI.
const RETIRED_HOOKS = ["data-sf-sticky", "data-sf-sticky-call"];

if (src !== null) {
  const shipped = ["index.html", "js/app.js", "js/storefront.js", "js/agent_page.js", "js/agent_directory.js", "js/agent_share.js", "js/estimator.js", "js/agent_next.js",
    "js/portfolio_ledger.js", "js/portfolio_cloud.js", "js/pms_cloud.js", "js/pms_ledger.js", "js/compliance_due.js", "js/data.js", "js/core.js",
    "js/value_guide_flow.js"]
    .map(f => readOr(path.join(ROOT, f))).filter(Boolean).join("\n");
  check("removed bottom-bar hooks stay absent", RETIRED_HOOKS.every(h => !shipped.includes(h)), "explicit removal contract");

  const hooks = new Set();
  for (const f of fs.readdirSync(TESTS)) {
    if (!/_e2e\.js$/.test(f)) continue;
    const text = readOr(path.join(TESTS, f)) || "";

    // (a) tokens asserted to be ABSENT: the whole selector of a negated query.
    //     Their absence is the passing condition, so they are not "must exist".
    const negative = new Set();
    // Each quote style may contain the other style in an attribute selector,
    // e.g. !q('[data-est-screen="3"] [data-est-spin]').
    const negRe = /!\s*[\w.]*\(\s*(?:"([^"]*)"|'([^']*)')\s*\)/g;
    let nm;
    while ((nm = negRe.exec(text))) {
      const tokRe = /\b(data-[a-z0-9]+(?:-[a-z0-9]+)*)\b/g;
      let t2;
      while ((t2 = tokRe.exec(nm[1] === undefined ? nm[2] : nm[1]))) negative.add(t2[1]);
    }

    // (b) tokens positively driven: must appear as an attribute selector, i.e.
    //     immediately after '[' — this excludes substrings of check NAMES
    //     such as the "data-strip" inside "result-data-strip".
    const posRe = /\[(data-[a-z0-9]+(?:-[a-z0-9]+)*)/g;
    let pm;
    while ((pm = posRe.exec(text))) {
      if (!negative.has(pm[1]) && !RETIRED_HOOKS.includes(pm[1])) hooks.add(pm[1]);
    }
  }

  const skipped = Array.from(hooks).filter(h => FALLBACK_ALIASES[h]);
  const missing = Array.from(hooks)
    .filter(h => !FALLBACK_ALIASES[h])
    .filter(h => shipped.indexOf(h) === -1)
    .sort();

  check("every data-* hook used by e2e tests is still rendered", missing.length === 0,
    missing.length
      ? "not found in shipped source: " + missing.join(", ")
      : (hooks.size - skipped.length) + " hooks verified" +
        (skipped.length ? " (" + skipped.length + " known fallback alias(es) skipped)" : ""));
}

/* 8. build_app.js must not hardcode a machine-specific path. The old absolute
 *    require() is why the bundle went stale in the first place. */
const builder = readOr(path.join(ROOT, "build_app.js")) || "";
check("build_app.js is portable (no absolute require path)",
  !/require\(["'][A-Za-z]:[\\/]/.test(builder),
  /require\(["'][A-Za-z]:[\\/]/.test(builder) ? "hardcoded absolute path found" : "no absolute path");

console.log(fail === 0
  ? "ALL GREEN (" + (pass + fail) + " checks)"
  : (fail + "/" + (pass + fail)) + " FAILED");
process.exit(fail === 0 ? 0 : 1);
