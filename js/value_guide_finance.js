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

  /* Registry of Deeds registration fee from the LRA schedule of fees (PD 1529
     Sec. 111 as adjusted; the LRA's published table, retrieved 2026-11-01 via
     foreclosurephilippines.com, table dated 2021-11-22). The schedule is a
     staircase: a fixed fee for each bracket of consideration "or fraction
     thereof", so every step rounds up. PHP 21 up to 500, then +9 per 500 to
     6,000; +24 per 2,000 to 30,000; +42 per 5,000 to 100,000; +60 per 10,000 to
     500,000; +90 per 20,000 above that, which gives the published PHP 8,796 at
     1,700,000. Entry, IT and certification fees (a few hundred pesos each) are
     not included; the Registry's own assessment governs. */
  var LRA_STEPS = [
    { upTo: 6000, from: 500, step: 500, per: 9, base: 21 },
    { upTo: 30000, from: 6000, step: 2000, per: 24, base: 120 },
    { upTo: 100000, from: 30000, step: 5000, per: 42, base: 408 },
    { upTo: 500000, from: 100000, step: 10000, per: 60, base: 996 },
    { upTo: Infinity, from: 500000, step: 20000, per: 90, base: 3396 }
  ];
  function lraRegistrationFee(value) {
    var v = positive(value);
    if (!v) return 0;
    if (v <= 500) return 21;
    for (var i = 0; i < LRA_STEPS.length; i++) {
      var s = LRA_STEPS[i];
      if (v <= s.upTo) return s.base + s.per * Math.ceil((v - s.from) / s.step);
    }
    return 0;
  }
  /* Cities may charge up to 0.75% transfer tax against 0.5% for provinces
     (RA 7160 Secs. 135 and 151); config.tax.cities names the ones to treat as
     cities and config.tax.cityTransferPct the rate to show for them. */
  function isCity(t, municipality) {
    var list = t && Array.isArray(t.cities) ? t.cities : [];
    var name = String(municipality || "").trim().toUpperCase();
    if (!name) return false;
    for (var i = 0; i < list.length; i++) if (String(list[i]).trim().toUpperCase() === name) return true;
    return false;
  }
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
    var transferPct = rate(t.transferPct, .005), transferBasis = "province";
    if (t.cityTransferPct != null && isCity(t, opts.municipality)) { transferPct = rate(t.cityTransferPct, transferPct); transferBasis = "city"; }
    var transfer = Math.round(base * transferPct);
    var registrationMethod = t.registrationMethod === "lra-schedule" ? "lra-schedule" : "percent";
    var registration = registrationMethod === "lra-schedule" ? lraRegistrationFee(base) : Math.round(base * rate(t.registrationPct, .001));
    var brokerPct = rate(opts.brokerPct, rate(t.brokerPct, .03)), broker = Math.round(projected * brokerPct);
    var notarial = Math.round(positive(opts.notarial));
    var allocation = Object.assign({ cgt: "seller", dst: "buyer", transfer: "buyer", registration: "buyer", broker: "seller", notarial: "seller" }, opts.costAllocation || {});
    var items = { cgt: cgt, dst: dst, transfer: transfer, registration: registration, broker: broker, notarial: notarial };
    var sellerCosts = 0, buyerCosts = 0;
    Object.keys(items).forEach(function (key) { if (allocation[key] === "buyer") buyerCosts += items[key]; else sellerCosts += items[key]; });
    var totalCosts = cgt + dst + transfer + registration;
    return { base: base, baseBasis: selected.value ? selected.basis : "No tax base available", cgt: cgt, dst: dst, transfer: transfer, registration: registration,
      transferPct: transferPct, transferBasis: transferBasis, registrationMethod: registrationMethod,
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
  return { transaction: transaction, estate: estate, lraRegistrationFee: lraRegistrationFee, isCity: isCity };
});
