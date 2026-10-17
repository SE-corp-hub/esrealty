// The location-report edge function deploys with copies of two front-end
// files, because the deploy bundles only supabase/functions. Fail if a copy
// drifts from its original.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const pairs = [
  ["js/value_guide_finance.js", "supabase/functions/_shared/value_guide_finance.js"],
  ["data/tax/ph-estate-tax-reference.json", "supabase/functions/_shared/ph-estate-tax-reference.json"],
];
let failed = 0;
for (const [src, copy] of pairs) {
  const a = fs.readFileSync(path.join(root, src));
  const b = fs.readFileSync(path.join(root, copy));
  if (a.equals(b)) {
    console.log("PASS " + copy + " matches " + src);
  } else {
    failed++;
    console.log("FAIL " + copy + " differs from " + src + ". Run: cp " + src + " " + copy);
  }
}
const fnDir = path.join(root, "supabase/functions");
for (const name of fs.readdirSync(fnDir)) {
  const file = path.join(fnDir, name, "index.ts");
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  if (/from\s+["']\.\.\/\.\.\/|import\s+["']\.\.\/\.\.\//.test(text)) {
    failed++;
    console.log("FAIL " + name + " imports a file outside supabase/functions; deploys can't bundle it");
  }
}
if (failed) process.exit(1);
console.log("edge shared copies OK");
