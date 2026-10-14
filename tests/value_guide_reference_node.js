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
  const source = fs.readFileSync("supabase/functions/location-report/index.ts", "utf8").replace(/^import .*;\r?$/gm, "");
  const context = vm.createContext({ ESREALTY_FINANCE: FINANCE, TAX_REFERENCE: ref, Deno: { env: { get: () => "" }, serve: () => {} }, console, Response, Request, Headers, TextDecoder, setTimeout, crypto: require("crypto").webcrypto });
  // Run pdf-lib in the same realm: its Array type checks reject cross-realm
  // page-size literals, which is a harness issue rather than a renderer error.
  vm.runInContext(fs.readFileSync("vendor/pdf-lib/pdf-lib.min.js", "utf8"), context);
  Object.assign(context, context.PDFLib);
  const painted = [];
  const originalDraw = context.PDFLib.PDFPage.prototype.drawText;
  context.PDFLib.PDFPage.prototype.drawText = function (text, options) {
    const font = options.font, size = options.size;
    const ascent = font.heightAtSize(size, { descender: false });
    const height = font.heightAtSize(size);
    painted.push({ page: this, text, x: options.x, y: options.y, width: font.widthOfTextAtSize(text, size), top: options.y + ascent, bottom: options.y - (height - ascent) });
    return originalDraw.call(this, text, options);
  };
  vm.runInContext(stripTypeScriptTypes(source, { mode: "transform" }), context);
  const api = vm.runInContext("({ buildPdf, sanitizeReport, emailHtml })", context);
  const payload = { report: api.sanitizeReport({ property: { area: 100, kind: "land", typeLabel: "Vacant lot" }, location: { region: "Region IV-A (CALABARZON)", province: "Batangas", town: "Bauan", barangay: "Poblacion III", address: "BINAY ST (RESSURRECCION ST)" }, asOf: result.effectivityDate, disclaimer: result.disclaimer, estimate: { ...result, sourceLevel: result.source.level, proxyFactor: result.factors.proxyFactor, bandMid: result.factors.bandMid, regionalAdj: result.factors.regionalAdj, provenance } }) };
  const bytes = await api.buildPdf(payload), text = pdfText(bytes);
  check("emailed public PDF contains same valuation and cost fixtures", () => { for (const n of ["2,352,500", "1,999,625", "3,058,250", "1,150,000", "141,150", "35,288", "190,554", "2,161,946", "2,140,775"]) assert(text.includes("PHP " + n), n); });
  check("emailed report contains six ordered sections", () => { let last = -1; for (const title of ["01 Valuation Summary", "02 Detailed Computation", "03 Transaction Costs", "04 Market Evidence", "05 Documents", "06 Pricing Scenarios"]) { const at = text.indexOf(title); assert(at > last, title); last = at; } });
  check("emailed PDF discloses missing analysis, whole-estate assumption and source trust", () => { assert(/not assessed/.test(text)); assert(/property-only scenarios/i.test(text)); assert(/client-supplied/.test(text)); assert(!/50% of the BIR zonal value|excess of the price/.test(text)); });
  check("email summary uses central estimate and scenario range", () => { const email = api.emailHtml(payload); assert(email.includes("2,352,500") && email.includes("1,999,625") && email.includes("3,058,250")); });
  const timeResult = EST.core.computeEstimate({ ...config, governmentReferenceRegister: read("data/government-reference-register.json") }, index, md, { ...options, landMethod: "time-indexed", timeAnnualPct: 5, timeBaseDate: "2022-07-23", timeTargetDate: "2026-10-03" });
  const timePayload = { report: api.sanitizeReport({ ...payload.report, estimate: { ...timeResult, sourceLevel: timeResult.source.level, proxyFactor: timeResult.factors.proxyFactor, bandMid: timeResult.factors.bandMid, regionalAdj: timeResult.factors.regionalAdj } }) };
  const timeText = pdfText(await api.buildPdf(timePayload));
  check("public PDF preserves indexing trace without replacing original reference", () => { assert(timeText.includes("Indexed-reference planning scenario")); assert(timeText.includes("2022-07-23") && timeText.includes("2026-10-03")); assert(timeText.includes("PHP 1,150,000")); assert(/No stacked market, region, corner or property-use multipliers/.test(timeText)); assert(/Latest applicability unverified/.test(timeText)); });
  check("public PDF text fits page and columns without collisions", () => {
    assert(painted.length > 100);
    for (const run of painted) { assert(run.x >= 47 && run.x + run.width <= 548, run.text); assert(run.bottom >= 20 && run.top <= 820, run.text); }
    for (let i = 0; i < painted.length; i++) for (let j = i + 1; j < painted.length; j++) {
      const a = painted[i], b = painted[j]; if (a.page !== b.page) continue;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);
      assert(!(overlapX > .5 && overlapY > .5), a.text + " overlaps " + b.text);
    }
  });
  if (process.argv.includes("--capture")) {
    const dir = "docs/sea-guide-upgrade";
    assert(fs.existsSync(dir), "Capture folder must already exist");
    fs.writeFileSync(dir + "/bauan-public-report.pdf", bytes);
    const VG = require("../js/value_guide_pdf.js"), PDFLib = require("../vendor/pdf-lib/pdf-lib.min.js");
    const blob = await VG.toBlob(PDFLib, result, { preparedFor: "Bauan reference verification", preparedBy: "SEA ESTATES", generatedOn: "2026-10-02", tax: await TAX.full(result), provenance, muniRow: index.municipalities.find(m => m.name === "BAUAN") });
    fs.writeFileSync(dir + "/bauan-internal-report.pdf", Buffer.from(await blob.arrayBuffer()));
  }
  console.log("ALL GREEN (" + count + " checks)");
})().catch(error => { console.error(error); process.exitCode = 1; });
