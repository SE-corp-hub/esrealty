"use strict";
/* "Street not listed" (ALL OTHER STREETS) on a house & lot: the land estimate
   uses the barangay's median listed-street rate when that is higher, while the
   BIR tax reference keeps the all-other rate. Vacant lots are unchanged.
   Evidence: market-scan/comparables accuracy, Oct 2026 (houses on no listed
   street: -12% with all-other, +6% with the median street). */
const assert = require("assert"), fs = require("fs");
const EST = require("../js/estimator.js");
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
const config = read("data/zonal-config.json"), index = read("data/batangas-zonal.json");
const md = read("data/bir-batangas/municipalities/lipa-city.json");
let count = 0;
const check = (name, fn) => { fn(); count++; console.log("[PASS] " + name); };

/* Antipolo del Norte, Lipa: all other streets 4,000/sqm; 8 listed streets, median 5,500. */
const base = { municipality: "LIPA CITY", barangay: "ANTIPOLO DEL NORTE", streetKey: "", classification: "RR", area: 150, landMethod: "factor", saleContext: "private-resale" };
const house = EST.core.computeEstimate(config, index, md, Object.assign({ type: "house_lot", floorArea: 90 }, base));
const lot = EST.core.computeEstimate(config, index, md, Object.assign({ type: "vacant_lot" }, base));

check("BIR tax reference stays the all-other-streets rate", () => {
  assert.equal(house.birZonalRatePerSqm, 4000);
  assert.equal(lot.birZonalRatePerSqm, 4000);
});
check("house & lot land uses the median listed street", () => {
  assert.ok(house.planningReference, "planningReference missing");
  assert.equal(house.planningReference.ratePerSqm, 5500);
  assert.equal(house.planningReference.streets, 8);
  assert.equal(house.landPerSqm, Math.round(5500 * house.factorStack));
});
check("vacant lot keeps the all-other rate", () => {
  assert.equal(lot.planningReference, null);
  assert.equal(lot.landPerSqm, Math.round(4000 * lot.factorStack));
});
check("disclosed multiple still reconciles land with the BIR reference", () => {
  assert.ok(Math.abs(house.birZonalRatePerSqm * house.appliedMultiple - house.landPerSqm) <= 1);
});
check("a listed street is untouched", () => {
  const key = Object.keys(md.barangays["ANTIPOLO DEL NORTE"].streets).find(k => k !== "all streets");
  const r = EST.core.computeEstimate(config, index, md, Object.assign({ type: "house_lot", floorArea: 90 }, base, { streetKey: key }));
  assert.equal(r.planningReference, null);
});
check("result still passes the integrity check", () => assert.ok(EST.core.integrityCheck(house).ok));
console.log(count + " checks passed");
