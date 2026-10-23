/* Every request type the public pages send must be one the listing function accepts.
 *
 * The parked Project B.T form sent "project-bt-notify" while the listing function only knows
 * "project-bt", so every sign-up failed with "inquiry_type is invalid". This reads the
 * function's list and every inquiry_type literal in the public scripts, and compares them.
 *
 *   node tests/contact_types_node.js
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log("[PASS] " + name); }
  else { fail++; console.log("[FAIL] " + name + (detail ? " — " + detail : "")); }
};

const fn = read("supabase/functions/listing-api/index.ts");
const block = (fn.match(/const CONTACT_TYPES[^=]*=\s*\{([\s\S]*?)\n\s*\};/) || [])[1] || "";
const accepted = new Set([...block.matchAll(/^\s*"([a-z0-9-]+)"\s*:/gm)].map((m) => m[1]));
check("the listing function's request types were found", accepted.size >= 5, [...accepted].join(", "));

for (const file of ["js/storefront.js", "js/estimator.js"]) {
  const src = read(file);
  const sent = new Set();
  // inquiry_type: "a"  or  inquiry_type: cond ? "a" : cond ? "b" : "c",   (up to the next property)
  for (const m of src.matchAll(/inquiry_type:\s*([\s\S]*?)(?:,\s*\n\s*[a-z_]+:|\n\s*\})/g)) {
    const results = m[1].replace(/[!=]==?\s*"[^"]*"/g, "");  // leave out the conditions' own strings
    for (const q of results.matchAll(/"([a-z0-9-]+)"/g)) sent.add(q[1]);
  }
  check(file + " sends at least one request type", sent.size > 0);
  for (const type of sent) {
    check(file + ' sends "' + type + '", which the listing function accepts', accepted.has(type),
      "accepted: " + [...accepted].join(", "));
  }
}

console.log(fail ? fail + "/" + (pass + fail) + " FAILED" : "ALL GREEN (" + pass + " checks)");
process.exit(fail ? 1 : 0);
