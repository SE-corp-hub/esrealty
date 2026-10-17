"use strict";
const assert = require("assert"), fs = require("fs"), vm = require("vm"), zlib = require("zlib");
const { stripTypeScriptTypes } = require("module");
const EST = require("../js/estimator.js"), FINANCE = require("../js/value_guide_finance.js"), TAX = require("../js/value_guide_tax.js");
const read = path => JSON.parse(fs.readFileSync(path, "utf8"));
const config = read("data/zonal-config.json"), index = read("data/batangas-zonal.json"), md = read("data/bir-batangas/municipalities/bauan.json"), ref = read("data/tax/ph-estate-tax-reference.json");
const manifest = read("data/data-manifest.json");
const provenance = { basisOfValue: manifest.valuation.basisOfValue, basisNote: manifest.valuation.basisNote, order: manifest.adjustmentFramework.order, sources: manifest.provenance.records, currencyCheckedOn: manifest.provenance.currencyCheckedOn, nextCurrencyReview: manifest.provenance.nextCurrencyReview, rangeMeaning: manifest.range.meaning, limitations: manifest.limitations };
let count = 0;
function check(name, fn) { fn(); count++; console.log("[PASS] " + name); }
function pdfText(bytes) {
  const buffer = Buffer.from(bytes), text = [];
  for (let at = 0; (at = buffer.indexOf("stream", at)) >= 0;) {
    let start = at + 6; if (buffer[start] === 13) start++; if (buffer[start] === 10) start++;
    const end = buffer.indexOf("endstream", start); if (end < 0) break;
    try { const ops = zlib.inflateSync(buffer.subarray(start, end)).toString("latin1"); for (const match of ops.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) text.push(Buffer.from(match[1], "hex").toString("latin1")); } catch (_) {}
    at = end + 9;
  }
  return text.join(" ");
}
(async () => {
  const options = { municipality: "BAUAN", barangay: "POBLACION III", streetKey: "binay st ressurreccion st", classification: "RR", area: 100, type: "vacant_lot" };
  const result = EST.core.computeEstimate(config, index, md, options);
  check("Bauan source fixture matches official residential rate", () => { assert.equal(result.birZonalRatePerSqm, 11500); assert.equal(result.departmentOrder, "035-2022"); });
  check("reference valuation figures match independently supplied PDF example", () => { assert.equal(result.birZonalValue, 1150000); /* Binay St 11,500/sqm with the ramped residential band: 2.5 - (9500/23000)*1.1 = 2.0457 -> 100 x 11,500 x 2.0457 = 2,352,500. */ assert.equal(result.total, 2352500); assert.equal(result.low, 1999625); assert.equal(result.high, 3058250); assert.equal(result.perSqm, 23525); });
  const costs = EST.core.taxMath(config, result.total, { birZonalValue: result.birZonalValue, marketGuideEstimate: result.total, transactionPrice: result.total });
  check("reference cost lines and total reconcile", () => { assert.equal(costs.cgt, 141150); assert.equal(costs.dst, 35288); assert.equal(costs.transfer, 11763); assert.equal(costs.registration, 2353); assert.equal(costs.total, 190554); assert.equal(costs.netAfterAllTransactionCosts, 2161946); });
  check("actual seller proceeds use distinct allocation", () => { assert.equal(costs.broker, 70575); assert.equal(costs.sellerCosts, 211725); assert.equal(costs.projectedNetProceeds, 2140775); });
  const internal = TAX.sellingCosts(result, ref);
  check("internal PDF adapter shares public cost totals", () => { assert.equal(internal.taxBase, costs.base); assert.equal(internal.statutoryTotal, costs.total); assert.equal(internal.netProceeds.beforeCommission, 2161946); assert.equal(internal.netProceeds.atLowCommission, 2140775); });
  check("sale price below guide uses full zonal basis, not guide or excess", () => { const c = FINANCE.transaction({}, 2875000, { salePrice: 1000000, birZonalValue: 1150000 }); assert.equal(c.base, 1150000); assert.equal(c.cgt, 69000); });
  check("supplied assessor schedule FMV raises statutory basis", () => { const c = FINANCE.transaction({}, 2875000, { salePrice: 3000000, birZonalValue: 1150000, fairMarketValue: 3500000 }); assert.equal(c.base, 3500000); assert.equal(c.cgt, 210000); });
  check("comparable evidence does not alter value or transaction costs", () => { const withComps = EST.core.computeEstimate(config, index, md, { ...options, comparables: [{ price: 3000000, lot_area_sqm: 100, city: "BAUAN", barangay: "POBLACION III", property_type: "lot-only", offer_type: "sale" }] }); assert.equal(withComps.total, result.total); assert.equal(TAX.sellingCosts(withComps, ref).statutoryTotal, internal.statutoryTotal); });
  check("rounded scenario endpoints reconcile for fractional areas", () => { const r = EST.core.computeEstimate(config, index, md, { ...options, area: 123.47, corner: true }); assert(EST.core.integrityCheck(r).ok); assert(!EST.core.integrityCheck({ ...r, high: r.high + 1 }).ok); });
  check("estate deduction is standard, family home conditional", () => { assert.equal(FINANCE.estate(15000000).tax, 600000); assert.equal(FINANCE.estate(15000000, { familyHomeEligible: true, familyHomeValue: 10000000 }).tax, 0); assert.equal(FINANCE.estate(15000000, { familyHomeValue: 10000000 }).tax, 600000); });
  check("estate property-only scenario cannot certify whole-estate liability", () => { const i = TAX.inheritance(result, ref); assert(i.scenarioOnly); assert.equal(i.onMarketBasis.tax, 0); assert.equal(i.wholeEstate, null); assert(/entire.*estate/.test(i.note)); });
  check("DST deadline trigger comes from EOPT month-end rule", () => { const deadline = TAX.deadlines(ref).find(r => /Documentary/.test(r.label)); assert.equal(deadline.days, 10); assert(/close of the month/.test(deadline.from)); });
  check("unapproved settings (the endpoint's built-in defaults) never change the factors", () => { const same = EST.core.applyGuideSettings(config, { data: { valueGuide: { version: "2026.09.4", approvedBy: "", approvedAt: "", proxyFactors: { commercial: 1.7 }, construction: { mixed_chb: 25000 } } } }); assert.equal(same.proxyFactors.commercial.factor, config.proxyFactors.commercial.factor); assert.equal(same.construction.mixed_chb.costPerSqm, config.construction.mixed_chb.costPerSqm); });
  check("real settings envelope applies factors without replacing formula version", () => { const updated = EST.core.applyGuideSettings(config, { data: { valueGuide: { version: "approved-fixture", approvedBy: "admin@example.com", approvedAt: "2026-10-14T00:00:00Z", proxyFactors: { residential: 1.2 } } } }); assert.equal(updated.proxyFactors.residential.factor, 1.2); assert.equal(updated.factorSettingsVersion, "approved-fixture"); assert.equal(updated.calculationVersion, "2026.10.7"); assert.equal(config.proxyFactors.residential.factor, 1); });
  /* The emailed server PDF was retired on 2026-10-17: the team calls the
     customer first, then builds the report in the back office with
     js/value_guide_pdf.js (tested in value_guide_pdf_*_node.js). */
  check("location-report sends no email and builds no PDF", () => { const lr = fs.readFileSync("supabase/functions/location-report/index.ts", "utf8"); assert(!/resend|buildPdf|pdf-lib/i.test(lr)); });
  if (process.argv.includes("--capture")) {
    const dir = "docs/sea-guide-upgrade";
    assert(fs.existsSync(dir), "Capture folder must already exist");
    const VG = require("../js/value_guide_pdf.js"), PDFLib = require("../vendor/pdf-lib/pdf-lib.min.js");
    const blob = await VG.toBlob(PDFLib, result, { preparedFor: "Bauan reference verification", preparedBy: "SEA ESTATES", generatedOn: "2026-10-02", tax: await TAX.full(result), provenance, muniRow: index.municipalities.find(m => m.name === "BAUAN") });
    fs.writeFileSync(dir + "/bauan-internal-report.pdf", Buffer.from(await blob.arrayBuffer()));
  }
  console.log("ALL GREEN (" + count + " checks)");
})().catch(error => { console.error(error); process.exitCode = 1; });
