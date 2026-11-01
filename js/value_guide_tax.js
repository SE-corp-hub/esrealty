"use strict";
/* ============================================================
   SEA ESTATES - transaction and estate tax estimates
   ------------------------------------------------------------
   Separate from js/estimator.js on purpose. The estimate answers
   "what is the property worth"; this answers "what would it cost
   to sell it, roughly". They have different legal bases and
   different failure modes, so mixing them into one module would
   let a change to the valuation quietly alter the tax figures.

   WHAT THIS IS NOT
   A tax computation. No software outside the BIR, the LGU and the
   Registry of Deeds can produce a payable amount, and this does not
   pretend to. Every figure here is an orientation aid for a broker
   planning a conversation with a client.

   Shared arithmetic uses the highest supplied selling price, BIR zonal
   reference and assessor schedule FMV. Without a selling price, the guide
   value is an explicitly assumed transaction price, not statutory FMV.
   The 6% CGT scenario applies to qualifying capital-asset transactions.

   Rates and legal bases: data/tax/ph-estate-tax-reference.json
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ESREALTY_TAX = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var finance = typeof module === "object" && module.exports ? require("./value_guide_finance.js") : globalThis.ESREALTY_FINANCE;

  function loadJSON(url) {
    if (typeof module === "object" && module.exports && typeof window === "undefined") {
      return Promise.resolve(JSON.parse(require("fs").readFileSync(require("path").resolve(__dirname, "..", url), "utf8")));
    }
    if (typeof fetch === "function") {
      return fetch(url, { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error("tax reference unavailable (" + r.status + ")");
        return r.json();
      });
    }
    /* Node, for the test suites. */
    return Promise.resolve(JSON.parse(require("fs").readFileSync(url, "utf8")));
  }

  var refPromise = null;
  function reference() {
    if (!refPromise) refPromise = loadJSON("data/tax/ph-estate-tax-reference.json").catch(function (e) { refPromise = null; throw e; });
    return refPromise;
  }

  function num(v) { var n = Number(v || 0); return isFinite(n) ? n : 0; }
  function round2(n) { return Math.round(num(n) * 100) / 100; }

  /* Round to whole pesos for display. Sub-peso precision on a multi-million
     peso figure implies accuracy the estimate does not have. */
  function money(n) { return Math.round(num(n)); }

  /* ------------------------------------------------------------
     Selling costs
     ------------------------------------------------------------ */
  function sellingCosts(estimate, ref) {
    ref = ref || {};
    var txn = ref.transaction || [];

    estimate = estimate || {};
    var estimateValue = num(estimate.marketGuideEstimate || estimate.recommendedAskingPrice);
    var zonal = num(estimate.taxReferenceValue != null ? estimate.taxReferenceValue : estimate.birZonalValue);

    function byKey(k) {
      for (var i = 0; i < txn.length; i++) if (txn[i].key === k) return txn[i];
      return null;
    }

    var cgtDef = byKey("capital_gains");
    var dstDef = byKey("documentary_stamp");
    var transferDef = byKey("transfer");
    var regDef = byKey("registration");
    var notaryDef = byKey("notarial");
    var brokerDef = byKey("broker");
    var costs = finance.transaction({ tax: {
      cgtPct: num(cgtDef && cgtDef.ratePct) / 100, dstPct: num(dstDef && dstDef.ratePct) / 100,
      transferPct: num(transferDef && transferDef.ratePct) / 100,
      cityTransferPct: transferDef && transferDef.cityRatePct != null ? num(transferDef.cityRatePct) / 100 : undefined,
      cities: transferDef && transferDef.cities,
      registrationMethod: regDef && regDef.method, registrationPct: num(regDef && regDef.ratePct) / 100
    } }, estimateValue, Object.assign({}, estimate.costOptions || {}, {
      marketGuideEstimate: estimateValue, salePrice: estimate.salePrice, birZonalValue: zonal, municipality: estimate.municipality,
      fairMarketValue: estimate.fairMarketValue || (estimate.costOptions || {}).fairMarketValue, transactionPrice: estimateValue, notarial: estimate.notarialFee || (estimate.costOptions || {}).notarial
    }));
    if (costs.quotationRequired) return { quotationRequired: true, available: false, direction: costs.note, quotedDeveloperFees: costs.quotedDeveloperFees, buyerTotal: costs.buyerTotal, transactionPrice: costs.projectedTransactionPrice };
    var taxBase = costs.base, cgt = costs.cgt, dst = costs.dst, transfer = costs.transfer, registration = costs.registration, notarial = costs.notarial;
    var transactionPrice = costs.projectedTransactionPrice;
    var suppliedBroker = estimate.costOptions && estimate.costOptions.brokerPct != null ? Number(estimate.costOptions.brokerPct) : null;
    var brokerMin = money(transactionPrice * (suppliedBroker != null ? suppliedBroker : num(brokerDef && brokerDef.ratePctMin) / 100));
    var brokerMax = money(transactionPrice * (suppliedBroker != null ? suppliedBroker : num(brokerDef && brokerDef.ratePctMax) / 100));
    var statutory = costs.total;

    return {
      taxBase: money(taxBase),
      taxBaseBasis: "Highest of the entered/assumed selling price, BIR zonal reference and supplied assessor schedule FMV. Selected: " + costs.baseBasis + ". " + (costs.assessorValueSupplied ? "Assessor FMV supplied." : "Assessor FMV not supplied; confirm before filing."),
      estimateValue: money(estimateValue),
      zonalValue: money(zonal),
      transactionPrice: transactionPrice,
      sellerCosts: costs.sellerCosts,
      buyerCosts: costs.buyerCosts,

      items: [
        {
          key: "capital_gains", label: (cgtDef && cgtDef.label) || "Capital gains tax",
          amount: money(cgt),
          base: "higher of selling price or statutory fair market value (Sec. 24(D) NIRC)",
          baseAmount: money(taxBase),
          rateLabel: num(cgtDef && cgtDef.ratePct) + "%",
          billedBy: cgtDef && cgtDef.billedBy,
          legalBasis: cgtDef && cgtDef.legalBasis,
          deadlineDays: cgtDef && cgtDef.deadlineDays,
          deadlineFrom: cgtDef && cgtDef.deadlineFrom,
          penalty: cgtDef && cgtDef.penalty,
          note: cgtDef && cgtDef.note
        },
        {
          key: "documentary_stamp", label: (dstDef && dstDef.label) || "Documentary stamp tax",
          amount: money(dst), base: "higher of selling price or fair market value",
          baseAmount: money(taxBase), rateLabel: num(dstDef && dstDef.ratePct) + "%",
          billedBy: dstDef && dstDef.billedBy, legalBasis: dstDef && dstDef.legalBasis,
          deadlineDays: dstDef && dstDef.deadlineDays, deadlineFrom: dstDef && dstDef.deadlineFrom,
          penalty: dstDef && dstDef.penalty, note: dstDef && dstDef.note
        },
        {
          key: "transfer", label: (transferDef && transferDef.label) || "Local transfer tax",
          amount: money(transfer), base: "higher of original price, current value or fair market value",
          baseAmount: money(taxBase), rateLabel: costs.transferBasis === "city" ? "up to " + (Math.round(costs.transferPct * 10000) / 100) + "% (city)" : num(transferDef && transferDef.ratePct) + "%",
          billedBy: transferDef && transferDef.billedBy, legalBasis: transferDef && transferDef.legalBasis,
          deadlineDays: transferDef && transferDef.deadlineDays, deadlineFrom: transferDef && transferDef.deadlineFrom,
          penalty: transferDef && transferDef.penalty, note: transferDef && transferDef.note
        },
        {
          key: "registration", label: (regDef && regDef.label) || "Registration fee",
          amount: money(registration), base: "higher of selling price or fair market value",
          baseAmount: money(taxBase), rateLabel: costs.registrationMethod === "lra-schedule" ? "LRA schedule" : "about " + num(regDef && regDef.ratePct) + "%",
          billedBy: regDef && regDef.billedBy, legalBasis: regDef && regDef.legalBasis,
          deadlineDays: null, deadlineFrom: null, penalty: null, note: regDef && regDef.note
        },
        {
          key: "notarial", label: (notaryDef && notaryDef.label) || "Notarial fee",
          amount: money(notarial), base: "optional quoted notarial fee; excluded when not supplied",
          baseAmount: null, rateLabel: notarial ? "quoted" : "not supplied",
          billedBy: notaryDef && notaryDef.billedBy, legalBasis: notaryDef && notaryDef.legalBasis,
          deadlineDays: null, deadlineFrom: null, penalty: null, note: notaryDef && notaryDef.note
        }
      ],

      statutoryTotal: money(statutory),

      broker: {
        label: (brokerDef && brokerDef.label) || "Broker's commission",
        min: money(brokerMin), max: money(brokerMax),
        rateLabel: suppliedBroker != null ? (suppliedBroker * 100) + "% supplied" : num(brokerDef && brokerDef.ratePctMin) + "% to " + num(brokerDef && brokerDef.ratePctMax) + "%",
        note: brokerDef && brokerDef.note
      },

      netProceeds: {
        /* Both ends of the commission band, because commission is the one
           line the two parties actually negotiate. */
        atLowCommission: money(transactionPrice - cgt - brokerMin - notarial),
        atHighCommission: money(transactionPrice - cgt - brokerMax - notarial),
        beforeCommission: money(transactionPrice - statutory),
        sellerBeforeCommission: money(transactionPrice - cgt - notarial)
      },

      direction: "Assumes a capital-asset sale. CGT, broker and quoted notarial costs are seller-paid; DST, transfer and registration buyer-paid. Allocation is negotiable. A higher selling price can raise CGT and DST; verify assessor FMV, exemptions and local fees.",

      available: costs.available
    };
  }

  /* ------------------------------------------------------------
     Inheritance
     ------------------------------------------------------------ */
  function inheritance(estimate, ref) {
    ref = ref || {};
    var e = ref.estate || {};
    estimate = estimate || {};
    var gross = num(estimate.birZonalValue);
    /* Where the BIR accepts the market value instead, the exposure is larger.
       Both are shown rather than picking one, because which applies is the
       family's and the BIR's decision, not this tool's. */
    var grossMarket = num(estimate.marketGuideEstimate);
    var deduction = num(e.standardDeduction);
    var threshold = 0;
    var pct = num(e.taxPct);

    function assess(g) {
      return finance.estate(g, estimate.estateInputs || {});
    }

    /* The statutory basis for real property in an estate is the higher of the
       BIR zonal value and the assessor's fair market value (NIRC Sec. 88(B)).
       The guide has no assessor's value, so the house enters at its depreciated
       cost, usually above the assessor's figure. The land-only zonal figure is
       kept for vacant lots and for comparison; the market guide is the upper
       case, not the basis the BIR applies. */
    var grossStatutory = gross + num(estimate.improvement);
    var onZonal = assess(gross);
    var onStatutory = assess(grossStatutory);
    var onMarket = assess(grossMarket);

    return {
      grossOnZonalBasis: onZonal.gross,
      grossOnStatutoryBasis: onStatutory.gross,
      grossOnMarketBasis: onMarket.gross,
      standardDeduction: deduction,
      taxThreshold: threshold,
      taxPct: pct,
      onZonalBasis: onZonal,
      onStatutoryBasis: onStatutory,
      onMarketBasis: onMarket,
      scenarioOnly: !estimate.estateInputs || !(estimate.estateInputs.grossEstate > 0),
      wholeEstate: estimate.estateInputs && estimate.estateInputs.grossEstate > 0 ? assess(estimate.estateInputs.grossEstate) : null,
      likelyPayable: onStatutory.tax > 0,
      possiblyPayableOnMarketBasis: onMarket.tax > 0,
      basis: e.taxBasis,
      deductionBasis: e.standardDeductionBasis,
      note: e.note,
      penalty: e.penalty,
      deadlineDays: e.deadlineDays,
      deadlineFrom: e.deadlineFrom,
      available: true
    };
  }

  /* Deadlines, most urgent first. Days are relative to a stated trigger, so a
     concrete date cannot be given until the notarisation date is known. */
  function deadlines(ref) {
    ref = ref || {};
    var out = [];
    var txn = ref.transaction || [];
    for (var i = 0; i < txn.length; i++) {
      var t = txn[i];
      if (t.deadlineDays == null || t.deadlineFrom == null) continue;
      out.push({
        label: t.label, days: t.deadlineDays, from: t.deadlineFrom,
        penalty: t.penalty, billedBy: t.billedBy
      });
    }
    var e = ref.estate || {};
    if (e.deadlineDays != null) {
      out.push({
          label: "Estate tax return (filing may be required even with zero tax)", days: e.deadlineDays,
        from: e.deadlineFrom, penalty: e.penalty, billedBy: "BIR"
      });
    }
    out.sort(function (a, b) { return a.days - b.days; });
    return out;
  }

  function full(estimate) {
    return reference().then(function (ref) {
      return {
        reference: ref,
        selling: sellingCosts(estimate, ref),
        inheritance: inheritance(estimate, ref),
        deadlines: deadlines(ref),
        steps: ref.steps || [],
        sellerDocuments: ref.sellerDocuments || [],
        buyerDocuments: ref.buyerDocuments || [],
        available: true
      };
    });
  }

  return {
    reference: reference,
    sellingCosts: sellingCosts,
    inheritance: inheritance,
    deadlines: deadlines,
    full: full,
    _money: money,
    _round2: round2
  };
});
