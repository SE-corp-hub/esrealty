"use strict";
/* Regenerates market-scan/vercel/lib/ph_geo.js from the PH_GEO table in js/app.js.
 *
 * The worker needs to answer "which province is this city in?", and that table
 * already existed - but only inside the 1.2MB admin bundle, which the
 * market-scan worker has no reason to load. Rather than hand-maintain a second
 * copy (and let the two drift), the lookup module is generated from the single
 * source of truth and committed alongside it.
 *
 *   node tools/gen_ph_geo.js          # writes the module
 *   node tools/gen_ph_geo.js --check  # fails if the committed copy is stale
 *
 * --check exists so a change to PH_GEO cannot silently leave the worker resolving
 * provinces against an outdated table.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP_JS = path.join(ROOT, "js", "app.js");
const OUT = path.join(ROOT, "market-scan", "vercel", "lib", "ph_geo.js");

// Pull the object literal out of the bundle without executing the bundle.
function extractPHGeo(src) {
  const i = src.indexOf("const PH_GEO = {");
  if (i < 0) throw new Error("PH_GEO not found in " + APP_JS);
  const start = src.indexOf("{", i);
  let depth = 0, end = -1, quote = null, esc = false;
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if (quote) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = k; break; } }
  }
  if (end < 0) throw new Error("unbalanced PH_GEO literal");
  // eslint-disable-next-line no-eval
  return eval("(" + src.slice(start, end + 1) + ")");
}

const PH_GEO = extractPHGeo(fs.readFileSync(APP_JS, "utf8"));

const provCities = {};
const cityProv = {};
for (const region of Object.keys(PH_GEO)) {
  for (const prov of Object.keys(PH_GEO[region])) {
    if (!provCities[prov]) provCities[prov] = [];
    for (const city of PH_GEO[region][prov]) {
      provCities[prov].push(city);
      // First writer wins: official tables list a few names under two regions
      // (there are two Minglanillas), and either answer is defensible.
      if (!cityProv[city]) cityProv[city] = prov;
    }
  }
}

const moduleSource = `"use strict";
/* Philippines region -> province -> city/municipality lookup.
 *
 * GENERATED from the PH_GEO table in js/app.js by tools/gen_ph_geo.js - do not
 * edit by hand. Run \`node tools/gen_ph_geo.js --check\` to confirm it is current.
 *
 * This exists because liveBenchmarkListings() could only filter on \`city\`. For a
 * province-only query it had nothing to match on and emitted a median row for
 * every city the worker had ever seen, so a "Metro Manila" scan came back with
 * Padre Garcia (Batangas), Calamba (Laguna) and Bagac (Bataan) in it. The rows
 * carried a real city; nothing was ever checking which province it was in.
 *
 * Lookups are case- and punctuation-insensitive, so "lapu-lapu" and
 * "Lapu-Lapu" agree.
 */

const PROVINCE_CITIES = ${JSON.stringify(provCities, null, 2)};

const CITY_PROVINCE = ${JSON.stringify(cityProv, null, 2)};

function normPlace(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

const _CITY_INDEX = new Map();
for (const city of Object.keys(CITY_PROVINCE)) _CITY_INDEX.set(normPlace(city), CITY_PROVINCE[city]);

// Province names are indexed last so they win over same-named towns: the
// town of Quezon (Bukidnon) used to overwrite Quezon province, and Rizal and
// Aurora had the same problem.
const _PROV_INDEX = new Map();
for (const prov of Object.keys(PROVINCE_CITIES)) {
  for (const city of PROVINCE_CITIES[prov]) _PROV_INDEX.set(normPlace(city), prov);
}
for (const prov of Object.keys(PROVINCE_CITIES)) _PROV_INDEX.set(normPlace(prov), prov);

// The province a city/municipality belongs to, or "" when the table has no
// entry (highly urbanised cities such as Lapu-Lapu and Cebu City are listed
// separately from their province in official tables, so they legitimately miss).
function provinceOfCity(city) {
  return _CITY_INDEX.get(normPlace(city)) || "";
}

function citiesInProvince(province) {
  const real = _PROV_INDEX.get(normPlace(province)) || province;
  const list = PROVINCE_CITIES[real];
  if (!list) return [];
  return list.map(normPlace);
}

// True when \`city\` is inside \`province\`. An unknown city returns false: with a
// province requested, an unrecognised location is more likely to be outside the
// area, and assuming it is inside is what produced the wrong-area rows.
function cityInProvince(city, province) {
  if (!province) return true;
  const c = normPlace(city);
  if (!c) return false;
  return citiesInProvince(province).indexOf(c) >= 0;
}

module.exports = { PROVINCE_CITIES, CITY_PROVINCE, normPlace, provinceOfCity, citiesInProvince, cityInProvince };
`;

if (process.argv.indexOf("--check") >= 0) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== moduleSource) {
    console.error("ph_geo.js is STALE - it no longer matches PH_GEO in js/app.js.");
    console.error("Regenerate with:  node tools/gen_ph_geo.js");
    process.exit(1);
  }
  console.log("ph_geo.js is current (" + Object.keys(provCities).length + " provinces, " + Object.keys(cityProv).length + " cities)");
} else {
  fs.writeFileSync(OUT, moduleSource, "utf8");
  console.log("wrote " + path.relative(ROOT, OUT));
  console.log("  " + Object.keys(PH_GEO).length + " regions, " + Object.keys(provCities).length + " provinces, " + Object.keys(cityProv).length + " cities");
}
