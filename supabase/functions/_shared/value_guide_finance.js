/* Shared browser / Node / Deno planning-cost arithmetic. This does not infer
   asset classification, an assessor's FMV, exemptions or actual payable fees. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  // Publish the same API for Deno side-effect imports, including bundlers that
  // classify this universal file as CommonJS and wrap module.exports.
  root.ESREALTY_FINANCE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function positive(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
  function rate(value, fallback) { return value != null && isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback; }
  function transaction(config, total, opts) {
    opts = opts || {}; var t = config && config.tax || {};
    var guide = Object.prototype.hasOwnProperty.call(opts, "marketGuideEstimate") ? positive(opts.marketGuideEstimate) : positive(total);
    var sale = positive(opts.salePrice), zonal = positive(opts.birZonalValue), fair = positive(opts.fairMarketValue);
    var projected = sale || positive(opts.transactionPrice);
    // An actual entered price replaces the assumed guide price; the estimate
    // itself is not a statutory FMV and must not override a supplied sale price.
    var price = sale || projected || guide;
    if (opts.saleContext === "developer" || opts.saleContext === "unknown") {
      var quoted = opts.developerFees != null && isFinite(Number(opts.developerFees)) && Number(opts.developerFees) >= 0 ? Math.round(Number(opts.developerFees)) : null;
      return { base: null, baseBasis: "Developer/ordinary-asset or unclassified transaction: use the applicable quotation and tax treatment", cgt: null, dst: null, transfer: null, registration: null, broker: null,
        total: quoted, sellerCosts: null, buyerCosts: quoted, sellerNetProceeds: null, projectedNetProceeds: null,
        projectedTransactionPrice: projected || price, buyerTotal: quoted != null ? Math.round(projected || price) + quoted : null,
        netAfterAllTransactionCosts: null, available: false, quotationRequired: true, quotedDeveloperFees: quoted,
        note: "No blanket 6% CGT or separate transfer charges added. Quoted developer fees may already include taxes, registration and administration; verify inclusions and avoid double-counting." };
    }
    var candidates = [{ value: price, basis: sale ? "Selling price" : "SEA ESTATES market guide estimate (illustrative)" }, { value: zonal, basis: "BIR zonal value" }, { value: fair, basis: "Assessor schedule fair market value (supplied)" }];
    var selected = candidates.reduce(function (a, b) { return b.value > a.value ? b : a; });
    var base = Math.round(selected.value);
    var cgt = Math.round(base * rate(t.cgtPct, .06)), dst = Math.round(base * rate(t.dstPct, .015));
    var transfer = Math.round(base * rate(t.transferPct, .005)), registration = Math.round(base * rate(t.registrationPct, .001));
    var brokerPct = rate(opts.brokerPct, rate(t.brokerPct, .03)), broker = Math.round(projected * brokerPct);
    var notarial = Math.round(positive(opts.notarial));
    var allocation = Object.assign({ cgt: "seller", dst: "buyer", transfer: "buyer", registration: "buyer", broker: "seller", notarial: "seller" }, opts.costAllocation || {});
    var items = { cgt: cgt, dst: dst, transfer: transfer, registration: registration, broker: broker, notarial: notarial };
    var sellerCosts = 0, buyerCosts = 0;
    Object.keys(items).forEach(function (key) { if (allocation[key] === "buyer") buyerCosts += items[key]; else sellerCosts += items[key]; });
    var totalCosts = cgt + dst + transfer + registration;
    return { base: base, baseBasis: selected.value ? selected.basis : "No tax base available", cgt: cgt, dst: dst, transfer: transfer, registration: registration,
      broker: broker, brokerPct: brokerPct, notarial: notarial, sellerCosts: sellerCosts, buyerCosts: buyerCosts,
      sellerNetProceeds: sale ? Math.round(sale) - sellerCosts : null, projectedTransactionPrice: projected,
      projectedNetProceeds: projected ? Math.round(projected) - sellerCosts : null,
      total: totalCosts, netAfterAllTransactionCosts: price ? Math.round(price) - totalCosts : null,
      buyerTotal: projected ? Math.round(projected) + buyerCosts : null, costAllocation: allocation,
      assumedPrice: !sale, assessorValueSupplied: fair > 0, available: base > 0 };
  }
  function estate(gross, opts) {
    opts = opts || {};
    var standard = opts.nonresidentNoncitizen ? 500000 : 5000000;
    var familyHome = !opts.nonresidentNoncitizen && opts.familyHomeEligible === true ? Math.min(positive(opts.familyHomeValue), 10000000) : 0;
    var deductions = standard + familyHome + positive(opts.otherAllowableDeductions);
    var net = Math.max(0, Math.round(positive(gross)) - Math.round(deductions));
    return { gross: Math.round(positive(gross)), standardDeduction: standard, familyHomeDeduction: Math.round(familyHome), afterDeduction: net, taxable: net, tax: Math.round(net * .06) };
  }
  return { transaction: transaction, estate: estate };
});
