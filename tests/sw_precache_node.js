// Every script and stylesheet index.html loads from this site must be in the
// service worker's precache, or a cold offline visit breaks.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const shell = sw.slice(sw.indexOf("const SHELL = ["), sw.indexOf("];", sw.indexOf("const SHELL = [")));
const local = [];
html.replace(/<script[^>]+src="([^"]+)"/g, (m, src) => { local.push(src); return m; });
html.replace(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g, (m, href) => { local.push(href); return m; });
html.replace(/<link[^>]+href="([^"]+)"[^>]*rel="stylesheet"/g, (m, href) => { local.push(href); return m; });
let failed = 0;
const seen = new Set();
for (const ref of local) {
  if (/^(https?:)?\/\//.test(ref) || seen.has(ref)) continue;
  seen.add(ref);
  const clean = ref.split("?")[0].replace(/^\.\//, "");
  if (shell.indexOf('"./' + clean + '"') >= 0) console.log("PASS precached: " + clean);
  else { failed++; console.log("FAIL not in sw.js SHELL: " + clean); }
}
if (!/SCOPE_PATH \+ "data\/"/.test(sw)) { failed++; console.log("FAIL the data/ rule must be relative to the worker scope (GitHub Pages serves under /esrealty/)"); }
if (failed) process.exit(1);
console.log("sw precache OK (" + seen.size + " local assets)");
