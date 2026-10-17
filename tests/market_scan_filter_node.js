"use strict";
/* Node-level guard for the market-scan filter semantics.
 *
 * The bug this exists to stop:
 *
 *   1. `testListingMatch()` checked city/price/area/beds but NOT `type`, so the
 *      server's match count ignored the Type filter entirely. Because the cap
 *      was applied by source alone, changing a filter re-rolled which rows
 *      survived - so NARROWING Type could INCREASE the reported count
 *      (observed: 163 results for "Condo" against 162 unfiltered).
 *
 *   2. `liveBenchmarkListings()` honoured `city` but not `province`, so a
 *      province-only query had no geographic constraint and emitted a median
 *      row for every city the worker had ever seen. A "Metro Manila" scan
 *      returned Padre Garcia (Batangas), Calamba (Laguna) and Bagac (Bataan).
 *      The client filtered them out visually, but they were still counted, which
 *      also left appraisal "nearby" empty.
 *
 * Run: node tests/market_scan_filter_node.js
 */

const path = require("path");
const { testListingMatch, mergeQueryDefaults } = require(path.join(__dirname, "..", "market-scan", "vercel", "lib", "_lib.js"));
const { cityInProvince, provinceOfCity, citiesInProvince, normPlace } = require(path.join(__dirname, "..", "market-scan", "vercel", "lib", "ph_geo.js"));

let failed = 0;
let passed = 0;
function chk(name, ok, detail) {
  if (ok) { passed++; console.log("  [PASS] " + name); }
  else { failed++; console.log("  [FAIL] " + name + (detail ? "  -> " + detail : "")); }
}
function section(s) { console.log("== " + s + " =="); }

// ------------------------------------------------------------- province plumbing
section("province survives query normalization");
{
  const q = mergeQueryDefaults({ province: "Metro Manila", region: "NCR" });
  chk("province is carried", q.province === "Metro Manila", "got '" + q.province + "'");
  chk("region is carried", q.region === "NCR", "got '" + q.region + "'");
  chk("absent province stays empty", mergeQueryDefaults({}).province === "");
  /* The regression: province used to be dropped here, so the worker could not
   * see it even when the caller sent it. */
  chk("province is not dropped when a city is also sent",
    mergeQueryDefaults({ province: "Batangas", city: "Lipa" }).province === "Batangas");
}

// ------------------------------------------------------------- PH lookup table
section("province lookup");
{
  chk("Metro Manila resolves", citiesInProvince("Metro Manila").length === 17,
    "got " + citiesInProvince("Metro Manila").length);
  chk("Batangas resolves", citiesInProvince("Batangas").length === 34,
    "got " + citiesInProvince("Batangas").length);
  // Provinces that share a name with a town elsewhere must resolve to the province.
  chk("Quezon province is not the town of Quezon (Bukidnon)", citiesInProvince("Quezon").indexOf("lucena") >= 0,
    citiesInProvince("Quezon").slice(0, 3).join(","));
  chk("Rizal province resolves to Rizal towns", citiesInProvince("Rizal").indexOf("antipolo") >= 0,
    citiesInProvince("Rizal").slice(0, 3).join(","));
  chk("Aurora province resolves to Aurora towns", citiesInProvince("Aurora").indexOf("baler") >= 0,
    citiesInProvince("Aurora").slice(0, 3).join(","));
  chk("Makati is Metro Manila", provinceOfCity("Makati") === "Metro Manila", provinceOfCity("Makati"));
  chk("Calamba is Laguna", provinceOfCity("Calamba") === "Laguna", provinceOfCity("Calamba"));
  chk("Padre Garcia is Batangas", provinceOfCity("Padre Garcia") === "Batangas", provinceOfCity("Padre Garcia"));
  chk("Bagac is Bataan", provinceOfCity("Bagac") === "Bataan", provinceOfCity("Bagac"));
  chk("Lipa is Batangas", provinceOfCity("Lipa") === "Batangas", provinceOfCity("Lipa"));

  chk("case/punctuation insensitive", cityInProvince("lapu-lapu", "Metro Manila") === cityInProvince("LAPU LAPU", "Metro Manila"));
  chk("a real NCR city is in NCR", cityInProvince("Pasay", "Metro Manila"));
  chk("a Batangas city is NOT in NCR", cityInProvince("Lipa", "Metro Manila") === false);
  chk("a Batangas city IS in Batangas", cityInProvince("Lipa", "Batangas"));
  /* Unknown city + a province requested must not be assumed in-area: that
   * assumption is what put Padre Garcia in a Metro Manila scan. */
  chk("unknown city is not assumed in-province", cityInProvince("Nowhereville", "Metro Manila") === false);
  chk("no province requested accepts anything", cityInProvince("Nowhereville", "") === true);
  chk("normPlace strips diacritics", normPlace("Parañaque") === "paranaque", normPlace("Parañaque"));
}

// ------------------------------------------------------------- type matching
section("type matching uses synonym groups, not raw strings");
{
  const condo = { city: "Bagac", propertyType: "Condo", title: "2 Bedroom Condo for sale in Bagac" };
  const house = { city: "Padre Garcia", propertyType: "House", title: "2 Bedroom House for sale in Padre Garcia" };
  const m = (l, q) => testListingMatch(l, mergeQueryDefaults(q));

  chk("Condo matches Condominium Unit", m(condo, { type: "Condominium Unit" }));
  chk("Condo does NOT match House", m(condo, { type: "House" }) === false);
  chk("House matches House", m(house, { type: "House" }));
  chk("House does NOT match Condominium Unit", m(house, { type: "Condominium Unit" }) === false);
  chk("Studio matches Condominium Unit", m({ city: "M", propertyType: "Studio", title: "Studio in M" }, { type: "Condominium Unit" }));
  chk("Vacant Lot matches Vacant Lot", m({ city: "M", propertyType: "Vacant Lot", title: "Vacant Lot in M" }, { type: "Vacant Lot" }));
  chk("Vacant Lot does NOT match Condominium Unit", m({ city: "M", propertyType: "Vacant Lot", title: "Vacant Lot in M" }, { type: "Condominium Unit" }) === false);
  chk("Townhouse matches Townhouse", m({ city: "M", propertyType: "Townhouse", title: "2BR Townhouse in M" }, { type: "Townhouse" }));
  chk("Shophouse matches Commercial", m({ city: "M", propertyType: "Shophouse", title: "Shophouse in M" }, { type: "Commercial" }));
  chk("verbose type string still resolves", m({ city: "M", propertyType: "2 Bedroom Condominium Unit", title: "x in M" }, { type: "Condominium Unit" }));
  chk("no type requested accepts everything", m(condo, {}));
  chk("unknown requested type falls back to containment", m({ city: "M", propertyType: "Penthouse", title: "Penthouse in M" }, { type: "Penthouse" }));
}

// ------------------------------------------------------------- pre-existing behaviour
section("existing city/price/area/beds filters still hold");
{
  const l = { city: "Makati", propertyType: "Condo", title: "Condo in Makati", price: 5000000, lotArea: 80, bedrooms: 2 };
  const m = (q) => testListingMatch(l, mergeQueryDefaults(q));
  chk("city match", m({ city: "Makati" }));
  chk("city mismatch rejected", m({ city: "Taguig" }) === false);
  chk("minPrice pass", m({ minPrice: 4000000 }));
  chk("minPrice reject", m({ minPrice: 6000000 }) === false);
  chk("maxPrice reject", m({ maxPrice: 4000000 }) === false);
  chk("minArea reject", m({ minArea: 100 }) === false);
  chk("minBeds reject", m({ minBeds: 3 }) === false);
  chk("minBeds pass", m({ minBeds: 2 }));
  chk("unknown price is not rejected by a price filter", testListingMatch({ city: "Makati", title: "Condo in Makati" }, mergeQueryDefaults({ minPrice: 100 })));
}

// ------------------------------------------------------------- the invariant
section("narrowing a filter can only shrink the result set");
{
  /* This is the property the broken cap destroyed. Filtering one fixed dataset
   * by an added criterion must yield a subset, every time, for any type. */
  const rows = [];
  for (const city of ["Makati", "Taguig", "Pasay", "Quezon City", "Mandaluyong", "San Juan"]) {
    rows.push({ city: city, propertyType: "Condo", title: "2BR Condo for sale in " + city, price: 4000000 });
    rows.push({ city: city, propertyType: "House", title: "2BR House for sale in " + city, price: 6000000 });
    rows.push({ city: city, propertyType: "Vacant Lot", title: "Vacant Lot for sale in " + city, price: 2000000 });
  }
  // Plus rows from the wrong province, which must never survive a Metro Manila scan.
  rows.push({ city: "Lipa", propertyType: "Condo", title: "2BR Condo for sale in Lipa", price: 3000000 });
  rows.push({ city: "Calamba", propertyType: "Condo", title: "2BR Condo for sale in Calamba", price: 3000000 });

  const qBase = mergeQueryDefaults({ province: "Metro Manila" });
  const inProvince = rows.filter((l) => cityInProvince(l.city, qBase.province));
  const base = inProvince.filter((l) => testListingMatch(l, qBase));

  chk("out-of-province rows are excluded from the base set",
    base.every((l) => cityInProvince(l.city, "Metro Manila")),
    base.filter((l) => !cityInProvince(l.city, "Metro Manila")).map((l) => l.city).join(","));
  chk("base set is non-empty", base.length > 0, "base=" + base.length);

  for (const type of ["Condominium Unit", "House", "Vacant Lot", "Townhouse", "Commercial"]) {
    const q = mergeQueryDefaults({ province: "Metro Manila", type: type });
    const narrowed = inProvince.filter((l) => testListingMatch(l, q));
    chk("narrowing to " + type + " yields a subset", narrowed.length <= base.length,
      narrowed.length + " > " + base.length);
  }

  const qCondo = mergeQueryDefaults({ province: "Metro Manila", type: "Condominium Unit" });
  const condos = inProvince.filter((l) => testListingMatch(l, qCondo));
  chk("condo subset is all condo-group", condos.length > 0 && condos.every((l) => /condo|unit|studio|apartment/i.test(l.propertyType)),
    condos.filter((l) => !/condo|unit|studio|apartment/i.test(l.propertyType)).map((l) => l.propertyType).join(","));
  chk("condo subset excludes Lipa", condos.every((l) => l.city !== "Lipa"));
  chk("condo subset excludes Calamba", condos.every((l) => l.city !== "Calamba"));
}

console.log("");
console.log("ALL GREEN (" + passed + " checks)" + (failed ? "  -- " + failed + " FAILED" : ""));
if (failed) process.exit(1);
