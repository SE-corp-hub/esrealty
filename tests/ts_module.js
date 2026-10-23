/* TypeScript from the repo, run in Node. Node strips the types itself (module.stripTypeScriptTypes,
 * Node 22.13 and later), so tests no longer remove annotations with hand-written patterns.
 *
 *   const { stripTs, importTs } = require("./ts_module");
 *   stripTs(source)            -> the same code without types (a fragment is fine)
 *   await importTs("path.ts")  -> the module's exports (relative imports must be type-only)
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { stripTypeScriptTypes } = require("module");

const ROOT = path.join(__dirname, "..");
// Quiet the one-line "experimental feature" notice; any other warning still prints.
process.removeAllListeners("warning");
process.on("warning", (w) => { if (!/stripTypeScriptTypes|Type Stripping/.test(String(w && w.message))) console.warn(String(w)); });

const stripTs = (source) => stripTypeScriptTypes(source);

async function importTs(rel) {
  const js = stripTs(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-module-"));
  const file = path.join(dir, path.basename(rel).replace(/\.ts$/, ".mjs"));
  fs.writeFileSync(file, js);
  return import(pathToFileURL(file).href);
}

module.exports = { stripTs, importTs };
