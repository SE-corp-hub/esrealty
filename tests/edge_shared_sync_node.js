// Edge functions deploy with only the files inside supabase/functions, so an
// import from outside that folder breaks the deploy. Fail if any function
// reaches outside it.
const fs = require("fs");
const path = require("path");
const fnDir = path.join(__dirname, "..", "supabase", "functions");
let failed = 0;
for (const name of fs.readdirSync(fnDir)) {
  const file = path.join(fnDir, name, "index.ts");
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  if (/from\s+["']\.\.\/\.\.\/|import\s+["']\.\.\/\.\.\//.test(text)) {
    failed++;
    console.log("FAIL " + name + " imports a file outside supabase/functions; deploys can't bundle it");
  } else {
    console.log("PASS " + name + " is self-contained");
  }
}
if (failed) process.exit(1);
