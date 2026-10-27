#!/usr/bin/env node
/* Point the whole repository at another Supabase project (a new free project after the old one
 * was restricted). Rewrites every place that names the project: the site's config, the Worker,
 * the GitHub workflows, the backend check, the seo function, robots.txt and the market-scan API.
 *
 *   node tools/switch_supabase_project.js <new project ref> <new publishable (anon) key> [new site URL]
 *
 * With a new site URL (a new Cloudflare account), the old workers.dev address is also replaced in
 * every tracked file except docs/ and vendor/.
 *
 * Then commit, merge, and follow docs/hosting/new-supabase-project.md (migrations, functions,
 * secrets). The old ref and key are read from js/supabase-config.js, so it can be run again later.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

const [ref, key, site] = process.argv.slice(2);
if (!/^[a-z0-9]{20}$/.test(ref || "") || !/^(sb_publishable_[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9._-]{40,})$/.test(key || "")) {
  console.error("Usage: node tools/switch_supabase_project.js <project ref, 20 letters/digits> <publishable key> [new site URL]");
  process.exit(1);
}

const config = fs.readFileSync(path.join(ROOT, "js/supabase-config.js"), "utf8");
const oldRef = (config.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/) || [])[1];
const oldKey = (config.match(/const publishableKey = "([^"]+)"/) || [])[1];
if (!oldRef || !oldKey) { console.error("Could not read the current ref and key from js/supabase-config.js"); process.exit(1); }
if (site !== undefined && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/.test(site)) {
  console.error("The site URL must look like https://esrealty.example.workers.dev (no trailing slash)");
  process.exit(1);
}

const FILES = [
  "js/supabase-config.js", "index.html", "services-3d.html", "robots.txt", "wrangler.jsonc", "worker/index.js",
  "supabase/check-backend.js", "supabase/functions/seo/index.ts", "tools/supabase_sql.js",
  "market-scan/vercel/api/ad-perf.js", "DEPLOY_GUIDE.md",
  ...fs.readdirSync(path.join(ROOT, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f)).map((f) => ".github/workflows/" + f),
];

let changed = 0;
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, "utf8");
  const after = before.split(oldRef).join(ref).split(oldKey).join(key);
  if (after !== before) { fs.writeFileSync(file, after); changed++; console.log("updated " + rel); }
}
if (oldRef !== ref) console.log(changed + " files now point at " + ref + " (was " + oldRef + ").");
else console.log("Already on " + ref);

if (site) {
  const wr = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  const oldSite = (wr.match(/"SITE_URL": "(https:\/\/[^"]+)"/) || [])[1];
  if (!oldSite) { console.error("Could not read the current SITE_URL from wrangler.jsonc"); process.exit(1); }
  if (oldSite === site) { console.log("Site already at " + site); process.exit(0); }
  const oldHost = oldSite.replace(/^https:\/\//, ""), newHost = site.replace(/^https:\/\//, "");
  const tracked = require("child_process").execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter((f) => f && !/^(docs|vendor)\//.test(f) && f !== "js/app.min.js"); // the bundle is rebuilt below
  const esc = (h) => h.replace(/\./g, "\\."); // the same host inside a test's regular expression
  let moved = 0;
  for (const rel of tracked) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) continue; // binary
    const before = buf.toString("utf8");
    if (before.indexOf(oldHost) === -1 && before.indexOf(esc(oldHost)) === -1) continue;
    fs.writeFileSync(file, before.split(oldHost).join(newHost).split(esc(oldHost)).join(esc(newHost))); moved++; console.log("site " + rel);
  }
  console.log(moved + " files now use " + newHost + " (was " + oldHost + ").");
  require("child_process").execFileSync("node", ["build_app.js"], { cwd: ROOT, stdio: "inherit" });
}
