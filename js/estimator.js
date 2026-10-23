/* ============================================================
   SEA ESTATES — Batangas Value Guide (v3)
   Pure Node-testable math core over the official BIR import
   + 4-screen funnel UI (Phase 4).

   Data contract:
     config   = data/zonal-config.json        (engine constants)
     index    = data/batangas-zonal.json       (lightweight muni index + province aggregates)
     muniData = data/bir-batangas/municipalities/<slug>.json  (barangay / street / class values)
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ESREALTY_EST = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var servicesBound = false;
  var guideEntryUrl = "";
  var mountedHome = false, calculationRequest = 0, calculationStartedAt = 0;
  var lastRenderedScreen = 0;
  /* Minimum time the calculating screen stays up so its three stages are
     readable even when the data comes back in a few milliseconds. It never
     delays a slow calculation: the result is shown as soon as both the work
     and the cadence are done. */
  var CALCULATING_MIN_MS = 1500, STAGE_STEP_MS = 500;
  /* Years added to the age-band midpoint for the "Building condition" answer. */
  var CONDITION_AGE_SHIFT = { "new": -5, good: 0, unknown: 0, repair: 10 };

  /* Site answers -> % change on LAND value (2026-10-14). Aligned with the
     ranges LandValuePH shows on /check, moderated where they had no basis
     (tenants, subdivision). "Not sure" / unanswered = 0. The net is clamped so a
     stack of bad answers cannot erase the land. See
     docs/plans/2026-10-14-value-guide-accuracy-plan.md. */
  var SITE_ADJ = {
    community: { "Open area": 0, "Subdivision": 2, "Gated community": 4 },
    floodRisk: { "No flooding": 0, "Occasional flooding": -5, "Flood-prone": -15 },
    roadAccess: { "Footpath": -10, "Barangay road": 0, "Municipal road": 2, "Highway": 4 },
    frontage: { "Narrow (under 8m)": -3, "About average (8–20m)": 0, "Wide (20m+)": 3 },
    lotShape: { "Regular": 0, "Irregular": -5 },
    rightOfWay: { "Direct road access": 0, "Shared right of way": -12, "Landlocked": -35 },
    elevation: { "At road level": 0, "Below road level": -7 },
    utilities: { "Full power & water": 0, "Partial": -5, "None": -10 }
  };
  var SITE_NET_MIN = -40, SITE_NET_MAX = 10;
  /* Ownership answers -> % deducted from the TOTAL (they affect who can buy and
     how fast, not the land alone). LandValuePH's published figures, tenants
     moderated to 5. */
  var OWNERSHIP_ADJ = {
    occupancy: { caretaker: 5, tenants: 5, informal_settlers: 25 },
    titleStatus: { titled_previous: 8, tax_declaration: 15 },
    inheritanceStatus: { pending: 10 }
  };
  var OWNERSHIP_MAX = 30;
  /* Price per sqm falls as lots get bigger. Above LOT_SIZE_REF sqm the land rate
     is scaled by (ref / area)^LOT_SIZE_EXP, floored at LOT_SIZE_MIN: 500 sqm
     x0.88, 1,000 sqm x0.74, 2,000 sqm x0.62. Tested against 2026-10 listings
     (a 1,120 sqm open lot priced +84% without it). */
  var LOT_SIZE_REF = 300, LOT_SIZE_EXP = 0.25, LOT_SIZE_MIN = 0.6;
  function lotSizeFactor(area) {
    if (!(area > LOT_SIZE_REF)) return 1;
    return Math.max(LOT_SIZE_MIN, Math.pow(LOT_SIZE_REF / area, LOT_SIZE_EXP));
  }
  /* A BIR street row that is itself a subdivision already prices the
     subdivision; adding the community premium on top would count it twice. */
  function streetIsSubdivision(name) {
    return /\b(SUBD|SUBDIVISION|VILLAGE|VILLAS?|HOMES|HEIGHTS|RESIDENCES?|ESTATES?|VILLE|PHASE|PARK|HILLS)\b/i.test(String(name || ""));
  }
  function siteAdjustments(opts, streetName) {
    var rows = [], net = 0;
    Object.keys(SITE_ADJ).forEach(function (key) {
      var v = opts[key];
      if (!v || !Object.prototype.hasOwnProperty.call(SITE_ADJ[key], v)) return;
      var pct = SITE_ADJ[key][v];
      if (key === "community" && pct > 0 && streetIsSubdivision(streetName)) pct = 0;
      rows.push({ key: key, answer: v, pct: pct });
      net += pct;
    });
    var clamped = Math.max(SITE_NET_MIN, Math.min(SITE_NET_MAX, net));
    return { rows: rows, rawPct: net, pct: clamped, clamped: clamped !== net };
  }
  function ownershipAdjustments(opts) {
    var rows = [], net = 0;
    Object.keys(OWNERSHIP_ADJ).forEach(function (key) {
      var pct = OWNERSHIP_ADJ[key][opts[key]] || 0;
      if (pct) { rows.push({ key: key, answer: opts[key], pct: -pct }); net += pct; }
    });
    return { rows: rows, rawPct: net, pct: Math.min(OWNERSHIP_MAX, net), clamped: net > OWNERSHIP_MAX };
  }
  var finance = typeof module === "object" && module.exports ? require("./value_guide_finance.js") : window.ESREALTY_FINANCE;
  var evidence = typeof module === "object" && module.exports ? require("./value_guide_evidence.js") : window.ESREALTY_EVIDENCE;
  var referenceTools = typeof module === "object" && module.exports ? require("./value_guide_reference.js") : window.ESREALTY_REFERENCE;

  /* ---------------------------------------------------------- */
  /*  normalization / classification mapping                     */
  /* ---------------------------------------------------------- */

  function normKey(s) {
    return String(s == null ? "" : s).toUpperCase().replace(/\s+/g, " ").trim();
  }

  function useOfClassification(config, cls) {
    var u = (config && config.classificationUses) || {};
    var agri = u.agricultural != null ? String(u.agricultural) : "A";
    var comm = (u.commercial) || ["CR", "CC"];
    var ind = (u.industrial) || ["I"];
    var code = String(cls || "").toUpperCase();
    if (!code) return "residential";
    if (agri && code.indexOf(agri) === 0) return "agricultural";
    if (comm.indexOf(code) !== -1) return "commercial";
    if (ind.indexOf(code) !== -1) return "industrial";
    return "residential";
  }

  function bandMid(config, use) {
    var b = config && config.marketBand && config.marketBand.bands && config.marketBand.bands[use];
    return (b && b.mid != null) ? b.mid : 2.5;
  }

  /* Rate-ramped residential band (marketBand.rateRamp, data/zonal-config.json).
     The flat mid is right for low-BIR land (2.5x at <= 2000/sqm matches the
     gathered evidence and the top of LandValuePH's own rural band). As the BIR
     rate rises, the multiplier descends linearly to a floor at highRate: a street
     at 25,000/sqm is already a beachfront/prime rate - the premium is in the BIR
     figure itself, and multiplying it by 2.5 again would charge for the location
     twice. Catalina (6,000 -> 2.22x observed) and Playa Laiya (25,000 -> 0.84x-
     1.70x observed) bracket the descent. Commercial, agricultural and industrial
     keep their flat bands: the evidence is all residential. */
  function rampBandMid(config, use, base) {
    var mid = bandMid(config, use);
    var ramp = config && config.marketBand && config.marketBand.rateRamp;
    if (!ramp) return mid;
    /* appliesTo: residential and (since 2026-10-14) commercial. A high CR rate is
       a prime-street rate exactly like a high RR rate, so the same descent
       applies. Older configs carried a single string. */
    var applies = [].concat(ramp.appliesTo || "residential");
    if (applies.indexOf(use) === -1) return mid;
    var lo = Number(ramp.lowRate || 2000), hi = Number(ramp.highRate || 25000), floor = Number(ramp.floor || 1.4);
    if (!(lo > 0) || !(hi > lo) || !(floor < mid)) return mid;
    if (!(base > lo)) return mid;
    if (base >= hi) return floor;
    return mid - ((base - lo) / (hi - lo)) * (mid - floor);
  }

  function proxyFactor(config, use) {
    var f = config && config.proxyFactors && config.proxyFactors[use];
    return (f && f.factor != null) ? f.factor : 1;
  }

  function regionalAdj(config) {
    var a = config && config.marketBand && config.marketBand.regionalAdj;
    return (a == null) ? 1 : a;
  }

  function normalizeComparable(raw, sourceType) {
    return evidence.normalize(raw, sourceType);
  }

  function comparableSummary(records, opts) {
    return evidence.summary(records, opts);
  }

  var DEPTH_META = {
    1: { level: "street", pct: 0.95, rangePct: 0.05, label: "Exact BIR street value" },
    2: { level: "barangay-other", pct: 0.85, rangePct: 0.10, label: "Barangay all-other-streets value" },
    3: { level: "municipality", pct: 0.70, rangePct: 0.20, label: "Municipality median" },
    4: { level: "province", pct: 0.55, rangePct: 0.30, label: "Batangas province median" }
  };

  function metaFor(depth) {
    return DEPTH_META[depth] ? DEPTH_META[depth] : DEPTH_META[4];
  }

  /* ---------------------------------------------------------- */
  /*  fallback chain                                            */
  /* ---------------------------------------------------------- */

  function resolveBase(ctx, sel) {
    if (!ctx || !sel) return null;
    var cls = normKey(sel.classification);
    var qBr = normKey(sel.barangay);
    var qSt = normKey(sel.streetKey);
    var br = null;
    if (ctx.byBarangay) {
      var bkeys = Object.keys(ctx.byBarangay);
      for (var bi = 0; bi < bkeys.length; bi++) {
        if (normKey(bkeys[bi]) === qBr) { br = ctx.byBarangay[bkeys[bi]]; break; }
      }
    }
    if (br) {
      var st = null;
      var skeys = br.streets ? Object.keys(br.streets) : [];
      for (var si = 0; si < skeys.length; si++) {
        if (normKey(skeys[si]) === qSt) { st = br.streets[skeys[si]]; break; }
      }
      if (st && st.classes && st.classes[cls]) {
        var v = Number(st.classes[cls].value);
        if (v > 0) return { value: v, depth: 1, count: 1, streetName: st.name || qSt };
      }
      if (br.other && br.other[cls]) {
        var ov = Number(br.other[cls]);
        if (ov > 0) return { value: ov, depth: 2, count: 1 };
      }
    }
    var ma = ctx.muniByClass ? ctx.muniByClass[cls] : null;
    if (ma && ma.p50 > 0) return { value: ma.p50, depth: 3, count: ma.count };
    var pa = ctx.provinceByClass ? ctx.provinceByClass[cls] : null;
    if (pa && pa.p50 > 0) return { value: pa.p50, depth: 4, count: pa.count };
    return null;
  }

  /* ---------------------------------------------------------- */
  /*  estimator core                                             */
  /* ---------------------------------------------------------- */

  function isFiniteNum(n) { return typeof n === "number" && isFinite(n); }

  /* Reviewed town correction (data/calibration.json, plan stage F). Proposed
     each month by market-scan/comparables/calibrate.js from bank and Pag-IBIG
     vacant-lot prices and applied ONLY after a person merges the proposal -
     the merge is the approval. Residential land on the factor method only;
     a factor outside 0.75-1.25 is ignored as a bad file, not clamped. */
  function townCalibrationFor(cfg, municipality, use, landMethod) {
    var towns = cfg && cfg.townCalibration && cfg.townCalibration.towns;
    var t = towns && towns[normKey(municipality)];
    if (!t || landMethod !== "factor" || use !== "residential") return null;
    var f = Number(t.residentialLandFactor);
    if (!(f >= 0.75 && f <= 1.25) || f === 1) return null;
    return { factor: f, month: t.month || "", records: t.records || 0, projects: t.projects || 0 };
  }

  /* Module scope, not scoped to computeEstimate. These are needed by the
     unavailable-results path, which the internal Value Guide also builds, and
     a helper nested inside computeEstimate was unreachable from there. */
  function cfgVersion(c) { return (c && c.calculationVersion) || "unknown"; }
  function dataVersionOf(i) { return (i && i.dataVersion) || "unknown"; }
  function unavailableResult(reason, config, index) {
    return { available: false, reason: reason, calculationVersion: cfgVersion(config), dataVersion: dataVersionOf(index) };
  }

  function computeEstimate(config, index, muniData, opts) {
    var unavailable = function (reason) {
      return unavailableResult(reason, config, index);
    };

    var area = Number(opts && opts.area);
    if (!(area > 0)) return unavailable("no-area");
    if (!isFinite(area) || area < 20 || area > 100000) return unavailable("invalid-area");
    if (!config || !index || !muniData || !muniData.barangays) return unavailable("data-integrity");
    opts = opts || {};
    if (opts.type && ["house_lot", "vacant_lot"].indexOf(opts.type) === -1) return unavailable("invalid-type");
    if (opts.salePrice != null && (!isFinite(Number(opts.salePrice)) || Number(opts.salePrice) < 0 || Number(opts.salePrice) > 1000000000)) return unavailable("invalid-price");
    if (opts.saleContext && ["private-resale", "developer", "unknown"].indexOf(opts.saleContext) === -1) return unavailable("invalid-sale-context");
    if ((opts.developerFees != null && (!isFinite(Number(opts.developerFees)) || Number(opts.developerFees) < 0)) || (opts.brokerPct != null && (!isFinite(Number(opts.brokerPct)) || Number(opts.brokerPct) < 0 || Number(opts.brokerPct) > 1))) return unavailable("invalid-costs");
    var ownershipOptions = { occupancy: ["empty", "caretaker", "tenants", "informal_settlers", "not_sure"], titleStatus: ["titled_self", "titled_previous", "tax_declaration", "not_sure"], inheritanceStatus: ["not_inherited", "settled", "pending", "not_sure"] };
    if (Object.keys(ownershipOptions).some(function (key) { return opts[key] && ownershipOptions[key].indexOf(opts[key]) === -1; })) return unavailable("invalid-ownership");

    var muniRow = null;
    var wanted = normKey(opts.municipality);
    var munis = (index.municipalities || []);
    for (var i = 0; i < munis.length; i++) {
      if (normKey(munis[i].name) === wanted) { muniRow = munis[i]; break; }
    }
    if (!muniRow) return unavailable("municipality-not-found");
    var landMethod = opts.landMethod || "factor";
    if (["factor", "time-indexed"].indexOf(landMethod) === -1 || (opts.timeSource && ["manual", "evidence"].indexOf(opts.timeSource) === -1)) return unavailable("invalid-land-method");

    var cls = normKey(opts.classification);
    var sel = { barangay: opts.barangay, streetKey: opts.streetKey, classification: cls };
    var hit = resolveBase(
      { byBarangay: muniData.barangays, muniByClass: muniRow.byClass, provinceByClass: index.provinceByClass },
      sel
    );
    if (!hit) return unavailable("no-data");

    var cfg = config;
    var meta = metaFor(hit.depth);
    var use = useOfClassification(cfg, cls);
    var cornerPct = opts.corner ? Number(cfg.cornerLotPct || 0) : 0;
    var proxy = proxyFactor(cfg, use);
    var base = hit.value;
    /* "Street not listed" on a house & lot. The barangay's ALL OTHER STREETS
       rate stays the BIR tax reference, but as the planning base it ran low:
       against bank and Pag-IBIG house prices for homes on no listed street (Oct
       2026: 93 listings, 28 developments) it put the guide 12% below them, while
       the barangay's MEDIAN listed street put it 6% above (expected +0 to +25%).
       The lowest listed street was worse (-24%): it is often below all-other.
       Vacant lots keep all-other - too few developments to judge. Never lowers
       the base. */
    var planningReference = null;
    var typeKeyEarly = opts.type === "house_lot" ? "house_lot" : "vacant_lot";
    if (hit.depth === 2 && typeKeyEarly === "house_lot" && landMethod === "factor") {
      var brRow = null;
      Object.keys(muniData.barangays || {}).forEach(function (k) { if (!brRow && normKey(k) === normKey(opts.barangay)) brRow = muniData.barangays[k]; });
      var named = [];
      Object.keys((brRow && brRow.streets) || {}).forEach(function (k) {
        if (normKey(k) === "ALL STREETS") return;
        var c = brRow.streets[k].classes && brRow.streets[k].classes[cls];
        var v = c ? Number(c.value) : 0;
        if (v > 0) named.push(v);
      });
      named.sort(function (a, b) { return a - b; });
      if (named.length) {
        var mid = named.length >> 1;
        var medianStreet = named.length % 2 ? named[mid] : (named[mid - 1] + named[mid]) / 2;
        if (medianStreet > base) planningReference = { kind: "barangay-median-street", ratePerSqm: medianStreet, birRatePerSqm: base, streets: named.length,
          note: "Street not listed: the land estimate uses the barangay's median listed-street rate (" + named.length + " streets), not the lower all-other-streets rate. The BIR reference above still shows the all-other rate." };
      }
    }
    var planningBase = planningReference ? planningReference.ratePerSqm : base;
    var band = rampBandMid(cfg, use, planningBase);
    var adj = regionalAdj(cfg);
    var referenceVerification = referenceTools.lookup(config.governmentReferenceRegister, muniRow.rdo, muniRow.name, opts.valuationDate || new Date().toISOString().slice(0, 10));
    var birZonalRatePerSqm = Math.round(base);
    var birZonalValue = Math.round(birZonalRatePerSqm * area);
    var typeKey = opts.type === "house_lot" ? "house_lot" : "vacant_lot";
    var comps = comparableSummary(opts && opts.comparables, {
      municipality: opts && opts.municipality,
      barangay: opts && opts.barangay,
      propertyType: typeKey,
      sourceType: opts && opts.comparableSource,
      useGroup: useOfClassification(config, cls),
      area: area, floorArea: Number(opts.floorArea) || 0, corner: !!opts.corner,
      saleContext: opts.saleContext || "private-resale", condition: opts.condition || "unknown", valuationDate: opts.valuationDate
    });
    // Restore the original preview calculation. Comparable listings are
    // reported as supporting context, but are not direct inputs to this
    // factor-based estimate. Without comparables, the result remains visible
    // with an explicit factor-only evidence status rather than being hidden or
    // silently capped to an arbitrary BIR multiple.
    /* Named, not inlined: this is the multiple between the BIR zonal reference
       and the market estimate. A later disclosure shows it to the reader, and an
       unreviewed planning assumption should be stated as one number rather than
       left for someone to reverse-engineer from the two rates. Full precision is
       kept here; presentation rounding belongs to the formatter.
       Grouping the product re-associates the floating-point multiply: across
       every rate in data/bir-batangas the whole-peso result is unchanged for
       non-corner parcels, and moves by at most 1 peso on some corner lots. The
       stack stays the single source for the rate so the disclosed multiple and
       the applied one cannot drift apart. */
    var factorStack = (1 + cornerPct) * proxy * band * adj;
    var landPerSqm = Math.round(planningBase * factorStack);
    var sizeFactor = lotSizeFactor(area);
    var site = siteAdjustments(opts, hit.streetName || opts.streetKey);
    var landBeforeAdjustments = Math.round(landPerSqm * area);
    var townCal = townCalibrationFor(cfg, muniRow.name, use, landMethod);
    var landValue = Math.round(landBeforeAdjustments * sizeFactor * (1 + site.pct / 100) * (townCal ? townCal.factor : 1));
    var factorLandValue = landValue;
    var timeIndex = null;
    if (landMethod === "time-indexed") {
      timeIndex = referenceTools.timeScenario(base, area, { baseDate: opts.timeBaseDate || muniRow.effectivityDate, targetDate: opts.timeTargetDate, annualPct: opts.timeAnnualPct, source: opts.timeSource || "manual", evidenceId: opts.timeEvidenceId }, config.governmentReferenceRegister, { municipality: muniRow.name, useGroup: use });
      if (!timeIndex.available) return unavailable(timeIndex.reason);
      landPerSqm = timeIndex.rawRate; landValue = timeIndex.landAmount;
    }

    var typeDef = (cfg.propertyTypes && cfg.propertyTypes[typeKey]) || { label: typeKey, kind: "land" };
    var kind = typeDef.kind === "built" ? "built" : "land";

    var floorArea = 0, floorsMult = 1, ageMid = 0, depPct = 0, buildCost = 0, improvement = 0, featuresTotal = 0, featuresUsed = [];
    if (kind === "built") {
      if (!isFinite(Number(opts.floorArea || 0)) || Number(opts.floorArea) < 0 || Number(opts.floorArea) > 100000) return unavailable("invalid-floor-area");
      if (opts.construction && !cfg.construction[opts.construction]) return unavailable("invalid-construction");
      if (opts.floors != null && !(cfg.floors || []).some(function (f) { return f.key === String(opts.floors); })) return unavailable("invalid-storeys");
      if (opts.ageBand && !(cfg.ageBands || []).some(function (b) { return b.key === opts.ageBand; })) return unavailable("invalid-age");
      if (opts.features && (!Array.isArray(opts.features) || opts.features.some(function (key) { return !Object.prototype.hasOwnProperty.call(cfg.features || {}, key); }))) return unavailable("invalid-features");
      var fDef = Number(typeDef.floorDefaultRatio) > 0 ? typeDef.floorDefaultRatio : 0.6;
      /* Blank floor area: a typical size for the lot (suggestedFloorArea), not a
         flat 60%; config floorDefaultRatio still wins when set. */
      floorArea = Math.round((Number(opts.floorArea) > 0 ? Number(opts.floorArea) : (Number(typeDef.floorDefaultRatio) > 0 ? area * fDef : suggestedFloorArea(area))) * 100) / 100;
      var floors = (cfg.floors || []).filter(function (f) { return f.key === String(opts.floors || "1"); })[0];
      floorsMult = (floors && floors.multiplier) || 1;
      var ab = (cfg.ageBands || []).filter(function (b) { return b.key === (opts.ageBand || "0-5"); })[0];
      ageMid = (ab && ab.midpoint) || 2.5;
      /* The building-condition answer shifts the effective age before
         depreciation: a new finish reads younger, a house needing repairs reads
         older. "unknown" and "good" leave the age band as stated. */
      ageMid = Math.max(0, ageMid + (CONDITION_AGE_SHIFT[opts.condition] || 0));
      var life = (cfg.depreciation && cfg.depreciation.lifeYears) || 40;
      var maxDep = (cfg.depreciation && cfg.depreciation.maxPct) || 0.95;
      depPct = Math.min(ageMid / life, maxDep);
      var cons = cfg.construction ? cfg.construction[(opts.construction || "mixed_chb")] : null;
      buildCost = (cons && cons.costPerSqm) || 16000;
      featuresTotal = 0;
      featuresUsed = [];
      var feats = cfg.features || {};
      (opts.features || []).forEach(function (fk) {
        var fdef = feats[fk];
        if (fdef && isFiniteNum(fdef.cost) && featuresUsed.indexOf(fk) === -1) { featuresTotal += fdef.cost; featuresUsed.push(fk); }
      });
      improvement = Math.round(buildCost * floorArea * floorsMult * (1 - depPct)) + featuresTotal;
    }

    var ownershipAdj = ownershipAdjustments(opts);
    var ownershipAdjustmentPct = ownershipAdj.pct;
    var legacyOwnershipScenarioPct = ownershipRiskPct(opts);
    var knownRisk = legacyOwnershipScenarioPct > 0 || opts.floodRisk === "High" || opts.roadAccess === "No direct road access";
    if (knownRisk && comps.askingIndication) {
      comps.askingIndication = null;
      comps.status = "context-only-unmatched-property-risk";
      comps.rejected.push({ id: "Subject property", reasons: ["Known possession/title/hazard/access differences require supported matching or professional review"] });
    }
    var unadjustedTotal = landValue + improvement;
    var total = Math.round(unadjustedTotal * (1 - ownershipAdjustmentPct / 100));
    var rangeLowFactor = 0.85, rangeHighFactor = 1.30;
    var rangePct = 0.30; // compatibility field; new range is asymmetric
    var low = Math.round(total * rangeLowFactor);
    var high = Math.round(total * rangeHighFactor);
    var perSqm = Math.round(total / area);

    if (!isFiniteNum(landValue) || !isFiniteNum(total) || !isFiniteNum(perSqm)) {
      return unavailable("integrity-fail");
    }

    var clsLabel = "";
    if (index.classifications && index.classifications[cls] != null) clsLabel = index.classifications[cls];

    var salePrice = Number(opts && opts.salePrice);
    salePrice = salePrice > 0 ? Math.round(salePrice) : 0;
    return {
      available: true,
      reason: "",
      municipality: muniRow.name,
      municipalitySlug: muniRow.slug,
      rdo: muniRow.rdo,
      departmentOrder: muniRow.departmentOrder,
      revision: muniRow.revision,
      effectivityDate: muniRow.effectivityDate,
      coverage: muniRow.coverage,
      barangay: normKey(opts.barangay),
      streetKey: normKey(opts.streetKey),
      streetName: hit.streetName || normKey(opts.streetKey),
      classification: cls,
      classificationLabel: clsLabel,
      purpose: opts.purpose || "",
      stage: opts.stage || "",
      type: typeKey,
      typeLabel: typeDef.label,
      kind: kind,
      use: use,
      corner: { applied: landMethod === "factor" && !!opts.corner, pct: landMethod === "factor" ? cornerPct : 0, recorded: !!opts.corner },
      landMethod: landMethod,
      planningMethodLabel: landMethod === "time-indexed" ? "Indexed-reference planning scenario" : "Factor-based planning estimate",
      timeIndex: timeIndex,
      factorBaseline: { landValue: factorLandValue, total: factorLandValue + improvement, selected: landMethod === "factor" },
      referenceVerification: referenceVerification,
      source: { level: meta.level, depth: hit.depth, pct: meta.pct, label: meta.label, count: hit.count, referencable: hit.streetName || "" },
      birReferenceConfirmed: hit.depth <= 2,
      birReferenceLabel: hit.depth <= 2 ? "Official BIR zonal reference" : "Derived " + meta.level + " median reference (parcel rate unconfirmed)",
      taxReferenceValue: hit.depth <= 2 ? birZonalValue : 0,
      reference: {
        value: base,
        verification: referenceVerification,
        schedule: hit.depth === 4 ? "Derived province median across RDO 58 and 59; parcel schedule unconfirmed" : (hit.depth === 3 ? "Derived municipality median; underlying " : "") + muniRow.departmentOrder + " (" + (muniRow.revision || "") + "), effective " + muniRow.effectivityDate,
        rdo: muniRow.rdo
      },
      factors: { proxyFactor: proxy, bandMid: band, regionalAdj: adj },
      /* The one number linking the BIR zonal reference to the market estimate:
         (1 + corner) x property-use proxy x market band x regional adjustment.
         Null under the indexed land method: factorStack is computed above
         unconditionally, before the branch, which replaces the rate with the
         time scenario, so the product is never APPLIED to it and null is
         published rather than the product. factorBaseline above still carries
         the factor-method landValue and total, which the web report and the PDF
         print as a not-selected comparison. */
      factorStack: landMethod === "factor" ? factorStack : null,
      /* the multiple of the BIR reference actually applied to land, so the
         disclosure still reconciles when the planning base is the median street */
      appliedMultiple: landMethod === "factor" ? factorStack * planningBase / base : null,
      planningReference: planningReference,
      factorSettingsVersion: cfg.factorSettingsVersion || cfg.calculationVersion,
      marketGuide: {
        value: total,
        landValue: landValue,
        ratePerSqm: landPerSqm,
        sourceType: comps.count ? comps.sourceType : ((config.marketGuide && config.marketGuide.sourceType) || "SEA ESTATES approved factors"),
        comparableCount: comps.count,
        comparableMedianPricePerSqm: comps.medianPricePerSqm,
        status: comps.count ? "factor-based-with-listing-context" : "factor-based-no-comparable-data",
        comparablePricesUsed: false
      },
      ownershipAdjustmentPct: ownershipAdjustmentPct,
      ownershipAdjustment: ownershipAdj,
      siteAdjustment: site,
      lotSizeFactor: sizeFactor,
      landBeforeAdjustments: landBeforeAdjustments,
      townCalibration: townCal,
      legacyOwnershipScenario: { pct: legacyOwnershipScenarioPct, value: Math.round(unadjustedTotal * (1 - legacyOwnershipScenarioPct / 100)), applied: false, basis: "Superseded 2026-10-14: ownership answers are now applied (ownershipAdjustment)" },
      ownership: { occupancy: opts.occupancy || "not_sure", titleStatus: opts.titleStatus || "not_sure", inheritanceStatus: opts.inheritanceStatus || "not_sure" },
      siteReview: { community: opts.community || "not stated", floodRisk: opts.floodRisk || "not stated", roadAccess: opts.roadAccess || "not stated", frontage: opts.frontage || "not stated", lotShape: opts.lotShape || "not stated", rightOfWay: opts.rightOfWay || "not stated", elevation: opts.elevation || "not stated", utilities: opts.utilities || "not stated" },
      reviewFlags: [opts.occupancy || "not_sure", opts.titleStatus || "not_sure", opts.inheritanceStatus || "not_sure"].filter(function (v) { return ["empty", "titled_self", "not_inherited", "settled"].indexOf(v) === -1; }),
      conditions: "Conditional planning figure based on your answers; title, possession, condition and legal access remain unverified until documents are reviewed.",
      saleContext: opts.saleContext || "private-resale",
      condition: opts.condition || "unknown",
      costOptions: { saleContext: opts.saleContext || "private-resale", developerFees: opts.developerFees, brokerPct: opts.brokerPct, notarial: opts.notarial, fairMarketValue: opts.fairMarketValue, costAllocation: opts.costAllocation },
      askingIndication: comps.askingIndication,
      unadjustedTotal: unadjustedTotal,
      birZonalRatePerSqm: birZonalRatePerSqm,
      birZonalValue: birZonalValue,
      marketGuideEstimate: total,
      marketGuideAvailable: comps.count > 0,
      /* A realistic listing price: resale asking prices in the 2026-10 Batangas
         listings sit roughly 5-10% above where deals close. The 130% figure is
         the top of the uncertainty range, not a price to list at. */
      recommendedAskingPrice: Math.round(total * 1.07),
      marketGuideRatePerSqm: perSqm,
      landPerSqm: landPerSqm,
      landValue: landValue,
      area: area,
      floorArea: floorArea,
      floorsMultiplier: floorsMult,
      ageMidpoint: ageMid,
      depreciatedPct: Math.round(depPct * 10000) / 100,
      buildCostPerSqm: buildCost,
      construction: opts.construction || "mixed_chb",
      constructionLabel: labelFor(cfg, "construction", opts.construction || "mixed_chb"),
      improvement: improvement,
      featuresUsed: featuresUsed,
      featuresTotal: featuresTotal,
      total: total,
      perSqm: perSqm,
      rangePct: rangePct,
      rangeLowFactor: rangeLowFactor,
      rangeHighFactor: rangeHighFactor,
      rangeMethod: "85%-130% planning scenarios; not a statistical confidence interval",
      low: low,
      high: high,
      salePrice: salePrice,
      comparableSummary: comps,
      calculationVersion: cfgVersion(cfg),
      dataVersion: dataVersionOf(index),
      disclaimer: (cfg && cfg.disclaimer) || "",
      fallbackNote: hit.depth > 1
        ? "No exact BIR street rate for this classification here — used " + meta.label.toLowerCase() + (hit.depth > 2 ? " (median of " + hit.count + " values)" : "") + "."
        : ""
    };
  }

  function ownershipRiskPct(opts) {
    opts = opts || {};
    var occupancy = { caretaker: 5, tenants: 10, informal_settlers: 25 };
    var title = { titled_previous: 8, tax_declaration: 15 };
    var inheritance = { pending: 10 };
    return (occupancy[opts.occupancy] || 0) + (title[opts.titleStatus] || 0) + (inheritance[opts.inheritanceStatus] || 0);
  }

  function ownershipLabel(key, value) {
    var labels = {
      occupancy: { empty: "No, it's empty", caretaker: "A caretaker or family member", tenants: "Tenants paying rent", informal_settlers: "Informal settlers", not_sure: "Not sure" },
      titleStatus: { titled_self: "Yes, title is in my name", titled_previous: "Yes, title is in the previous owner's name", tax_declaration: "Tax declaration only", not_sure: "Not sure" },
      inheritanceStatus: { not_inherited: "Not inherited", settled: "Inherited, settlement finished", pending: "Inherited, settlement pending", not_sure: "Not sure" }
    };
    return labels[key] && labels[key][value] ? labels[key][value] : "Not answered";
  }

  function taxMath(config, total, opts) {
    return finance.transaction(config, total, opts);
  }
  function costsFor(result, config) {
    return finance.transaction(config, result.total, Object.assign({}, result.costOptions || {}, {
      salePrice: result.salePrice, transactionPrice: result.marketGuideEstimate, marketGuideEstimate: result.marketGuideEstimate,
      birZonalValue: result.taxReferenceValue != null ? result.taxReferenceValue : result.birZonalValue
    }));
  }

  function integrityCheck(result) {
    if (!result || !result.available) return { ok: false, reason: "unavailable" };
    var adjustedBase = result.landValue + result.improvement;
    var expectedTotal = Math.round(adjustedBase * (1 - Number(result.ownershipAdjustmentPct || 0) / 100));
    var sums = expectedTotal === result.total;
    var range = Math.round(result.total * (result.rangeLowFactor || .85)) === result.low &&
        Math.round(result.total * (result.rangeHighFactor || 1.30)) === result.high;
    var finite = isFiniteNum(result.total) && isFiniteNum(result.low) && isFiniteNum(result.high);
    var perSqm = Math.round(result.total / result.area) === result.perSqm;
    return {
      ok: sums && range && finite && perSqm,
      sumsMatch: sums,
      rangeMatch: range,
      finite: finite,
      perSqmMatches: perSqm
    };
  }

  var core = {
    normKey: normKey,
    useOfClassification: useOfClassification,
    bandMid: bandMid,
    proxyFactor: proxyFactor,
    regionalAdj: regionalAdj,
    metaFor: metaFor,
    resolveBase: resolveBase,
    computeEstimate: computeEstimate,
    applyGuideSettings: applyGuideSettings,
    taxMath: taxMath,
    costsFor: costsFor,
    referenceTools: referenceTools,
    normalizeComparable: normalizeComparable,
    comparableSummary: comparableSummary,
    integrityCheck: integrityCheck
  };

  /* ---------------------------------------------------------- */
  /*  format helpers                                             */
  /* ---------------------------------------------------------- */

  /* Shared implementation from js/util.js, with a byte-identical local
   * fallback so this module can be require()d directly by the Node tests. */
  var esc = (typeof window !== "undefined" && window.ESREALTY_UTIL && window.ESREALTY_UTIL.esc)
    ? window.ESREALTY_UTIL.esc
    : function (value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
        });
      };

  function fmt(n) {
    return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(Number(n || 0));
  }

  function money(n) {
    return "₱" + fmt(n);
  }

  function labelFor(config, kind, key) {
    var m = (config && config[kind]) || {};
    var it = Array.isArray(m) ? m.filter(function (item) { return item.key === key; })[0] : m[key];
    return (it && it.label) ? it.label : String(key || "");
  }

  var COMMUNITIES = ["Open area", "Subdivision", "Gated community"];
  var FLOOD_RISKS = ["No flooding", "Occasional flooding", "Flood-prone"];
  var ROAD_ACCESS = ["Footpath", "Barangay road", "Municipal road", "Highway"];
  var FRONTAGE = ["Narrow (under 8m)", "About average (8–20m)", "Wide (20m+)"];
  var LOT_SHAPES = ["Regular", "Irregular"];
  var RIGHT_OF_WAY = ["Direct road access", "Shared right of way", "Landlocked"];
  var ELEVATIONS = ["At road level", "Below road level"];
  var UTILITIES = ["Full power & water", "Partial", "None"];

  /* ---------------------------------------------------------- */
  /*  loaders                                                     */
  /* ---------------------------------------------------------- */

  var DATA = null;
  var dataPromise = null;
  var muniCache = {};
  var streetDelegationBound = false;

  function loadJSON(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("Could not load " + url);
      return r.json();
    });
  }

  function loadOptionalGuideSettings() {
    if (typeof window === "undefined" || !window.ESREALTY_API_BASE) return Promise.resolve(null);
    var request = fetch(String(window.ESREALTY_API_BASE).replace(/\/$/, "") + "/site-settings", { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 1500); });
    return Promise.race([request, timeout]);
  }

  function applyGuideSettings(config, payload) {
    var guide = payload && (payload.data || payload).valueGuide;
    /* Only an approved settings set may change the public factors. The
       site-settings endpoint answers with built-in defaults (older 25,000/sqm
       building cost, 1.7 commercial proxy) and an empty approvedBy when no
       super-admin has approved anything; applying those would silently undo
       the calibrated zonal-config values. */
    if (!guide || !guide.approvedBy || !guide.approvedAt) return config;
    var out = JSON.parse(JSON.stringify(config));
    var proxy = guide.proxyFactors || {};
    var mid = guide.marketBandMid || {};
    var construction = guide.construction || {};
    ["residential", "commercial", "agricultural", "industrial"].forEach(function (use) {
      if (out.proxyFactors && out.proxyFactors[use] && Number(proxy[use]) > 0) out.proxyFactors[use].factor = Number(proxy[use]);
      if (out.marketBand && out.marketBand.bands && out.marketBand.bands[use] && Number(mid[use]) > 0) out.marketBand.bands[use].mid = Number(mid[use]);
    });
    Object.keys(construction).forEach(function (key) {
      if (out.construction && out.construction[key] && Number(construction[key]) > 0) out.construction[key].costPerSqm = Number(construction[key]);
    });
    if (guide.version) out.factorSettingsVersion = String(guide.version);
    return out;
  }

  function updateGuideSettings(guide) {
    if (!DATA || !guide || !guide.approvedBy || !guide.approvedAt) return;
    DATA = Object.assign({}, DATA, { config: applyGuideSettings(DATA.config, { valueGuide: guide }) });
    dataPromise = Promise.resolve(DATA);
  }

  function loadData(force) {
    if (dataPromise && !force) return dataPromise;
    dataPromise = Promise.all([
      loadJSON("data/zonal-config.json"),
      loadJSON("data/batangas-zonal.json"),
      loadOptionalGuideSettings(),
      loadJSON("data/data-manifest.json").catch(function () { return null; }),
      loadJSON("data/value-guide-project-evidence.json").catch(function () { return { records: [], unavailable: true }; }),
      loadJSON("data/government-reference-register.json").catch(function () { return { records: [], unavailable: true }; }),
      /* Researched asking prices, loaded for DISPLAY ONLY. They are context the
         result screen cites next to the estimate - the reader sees what asking
         evidence exists and how it compares to the street's BIR rate. They never
         enter computeEstimate(), exactly as market_benchmarks_node.js asserts. */
      loadJSON("data/market-benchmarks.json").catch(function () { return { records: [], unavailable: true }; }),
      /* Bank-acquired listings, refreshed monthly (market-scan/comparables).
         DISPLAY ONLY, like the benchmarks above: bankListingsHtml() shows them
         beside the estimate; they never enter computeEstimate(). */
      loadJSON("data/comparables/batangas-latest.json").catch(function () { return { records: [], unavailable: true }; }),
      /* Reviewed town corrections; a missing file simply means none. */
      loadJSON("data/calibration.json").catch(function () { return null; })
    ]).then(function (parts) {
      DATA = { config: applyGuideSettings(parts[0], parts[2]), index: parts[1], manifest: parts[3], projectEvidence: parts[4] };
      DATA.config.governmentReferenceRegister = parts[5];
      DATA.marketBenchmarks = parts[6];
      DATA.bankComparables = parts[7];
      DATA.config.townCalibration = parts[8];
      return DATA;
    });
    return dataPromise;
  }

  function loadMunicipality(slug) {
    slug = String(slug || "").toLowerCase();
    if (!slug) return Promise.reject(new Error("no municipality"));
    if (muniCache[slug]) return muniCache[slug];
    muniCache[slug] = loadJSON("data/bir-batangas/municipalities/" + slug + ".json").catch(function (error) { delete muniCache[slug]; throw error; });
    return muniCache[slug];
  }

  function loadComparableListings(opts) {
    if (typeof window === "undefined" || !window.ESREALTY_LISTINGS_API || !window.ESREALTY_LISTINGS_API.list) return Promise.resolve([]);
    var filters = {
      state: "Batangas",
      city: opts.municipality,
      offer_type: "sale",
      status: "available",
      property_type: opts.type === "house_lot" ? "house-and-lot" : "lot-only",
      per_page: 50,
      sort: "date_desc"
    };
    var request = window.ESREALTY_LISTINGS_API.list(filters).then(function (result) {
      var rows = result && Array.isArray(result.data) ? result.data.slice() : [];
      rows.retrievalStatus = { source: "SEA ESTATES catalog", status: rows.length ? "returned" : "no-records" }; return rows;
    }).catch(function () { var rows = []; rows.retrievalStatus = { source: "SEA ESTATES catalog", status: "unavailable" }; return rows; });
    var timeout = new Promise(function (resolve) { setTimeout(function () { var rows = []; rows.retrievalStatus = { source: "SEA ESTATES catalog", status: "timeout" }; resolve(rows); }, 2500); });
    return Promise.race([request, timeout]);
  }

  function loadExternalComparables(opts) {
    if (typeof window === "undefined" || !window.ESREALTY_MARKET_SCAN_BASE) return Promise.resolve([]);
    var base = String(window.ESREALTY_MARKET_SCAN_BASE).replace(/\/$/, "");
    var query = new URLSearchParams({
      city: opts.municipality,
      /* The scan's own type names: they pick the DotProperty/MyProperty search
         pages. "house-and-lot"/"lot-only" matched no page and fell back to
         every property type. */
      type: opts.type === "house_lot" ? "House & Lot" : "Vacant Lot",
      mode: "sale",
      maxResults: "20",
      live: "true"
    });
    /* The result screen waits on this, so the wait stays short (7.5 s). A
       slow first scan still finishes on the server and is cached for the
       next visitor. */
    var request = fetch(base + "/api/market-scan?" + query.toString(), { credentials: "omit" })
      .then(function (r) { if (!r.ok) throw new Error("Evidence source unavailable"); return r.json(); })
      .then(function (result) {
        var rows = result && Array.isArray(result.listings) ? result.listings.map(function (item) {
          return Object.assign({}, item, { sourceType: "External web evidence · " + (item.sourceLabel || item.source || "market scan") });
        }) : [];
        rows.retrievalStatus = { source: "External asking search", status: rows.length ? "returned" : "no-records" }; return rows;
      }).catch(function () { var rows = []; rows.retrievalStatus = { source: "External asking search", status: "unavailable" }; return rows; });
    var timeout = new Promise(function (resolve) { setTimeout(function () { var rows = []; rows.retrievalStatus = { source: "External asking search", status: "timeout" }; resolve(rows); }, 7500); });
    return Promise.race([request, timeout]);
  }

  /* ---------------------------------------------------------- */
  /*  funnel state                                               */
  /* ---------------------------------------------------------- */

  var est = {
    screen: 1,
    validationIssue: null,
    purpose: "Selling",
    stage: "",
    type: "vacant_lot",
    municipality: "",
    municipalitySlug: "",
    barangay: "",
    streetKey: "",
    streetLabel: "",
    allOther: false,
    /* Defaults to Residential (RR), matching the reference form's default. */
    classification: "RR",
    classificationUse: "residential",
    /* "Not sure" is the default answer for all three: they are flags recorded
       for the specialist, not pricing inputs, and the reference's own pattern
       is that an unknown answer is safe to skip. A reader who does know can
       still correct them. */
    occupancy: "not_sure",
    titleStatus: "not_sure",
    inheritanceStatus: "not_sure",
    area: null,
    salePrice: null,
    landMethod: "factor", timeSource: "manual", timeAnnualPct: null, timeBaseDate: "", timeTargetDate: new Date().toISOString().slice(0, 10), timeEvidenceId: "",
    saleContext: "private-resale",
    developerFees: null,
    brokerPct: .03,
    notarial: null,
    fairMarketValue: null,
    condition: "unknown",
    corner: false,
    floorArea: "",
    construction: "mixed_chb",
    floors: "1",
    ageBand: "0-5",
    features: [],
    community: "",
    floodRisk: "",
    roadAccess: "",
    frontage: "",
    lotShape: "",
    rightOfWay: "",
    elevation: "",
    utilities: "",
    result: null,
    /* Which professional service the user asked for: "appraisal", "broker",
       or "" for the plain email-my-guide path. Drives the lead's
       serviceRequested label end to end. appraisalRequested below is kept as
       the boolean alias the existing form logic reads. */
    leadKind: "",
    appraisalRequested: false,
    pricingUnlocked: false,
    leadSubmitted: false,
    muniData: null,
    muniLoading: false,
    /* Which "about this estimate" disclosures the reader opened. Screen 1 is
       re-rendered on every purpose/type/municipality/street/classification
       change, and a re-render rebuilds the markup from this map. Without it a
       reader who opened the reference panel and then changed barangay lost the
       panel mid-read and had to hunt for it again. */
    openPanels: {},
    /* Answers pre-selected from the location (suggestAssumptions) vs answers the
       reader picked. A suggestion is refreshed when the location changes; a
       reader's own answer never is. */
    assumed: {},
    userSet: {}
  };

  /* ---------------------------------------------------------- */
  /*  UI building                                                */
  /* ---------------------------------------------------------- */

  function getCard() {
    return typeof document !== "undefined" ? document.querySelector("[data-est-card]") : null;
  }

  function chip(label, value, active, attr) {
    return '<button type="button" class="sf-est-chip' + (active ? " active" : "") + '"' +
      (attr ? " " + attr : "") + ' data-val="' + esc(value) + '" aria-pressed="' + (active ? "true" : "false") + '"><span>' + esc(label) + '</span><i aria-hidden="true">✓</i></button>';
  }

  function chipRow(opts, dataT) {
    return '<div class="sf-est-chips" data-chip-group' + (dataT ? ' data-t="' + esc(dataT) + '"' : "") + ">" + opts.map(function (o) {
      return chip(o.label, o.value, !!o.active, o.attr || "");
    }).join("") + "</div>";
  }

  function muniOptions() {
    if (!DATA) return "";
    return DATA.index.municipalities.slice().sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    }).map(function (m) {
      var sel = m.name === est.municipality ? " selected" : "";
      return '<option value="' + esc(m.name) + '"' + sel + ">" + esc(titleCase(m.name)) + "</option>";
    }).join("");
  }

  function barangayOptions() {
    if (!est.muniData) return '<option value="">— choose a municipality first —</option>';
    var keys = Object.keys(est.muniData.barangays).sort(function (a, b) {
      return String(a).localeCompare(String(b));
    });
    if (!keys.length) return '<option value="">— no barangay data —</option>';
    /* A leading placeholder, selected while nothing is chosen.
     *
     * Without one the browser highlights the FIRST option all by itself,
     * because an option with no `selected` attribute is still displayed as
     * current. The dropdown therefore looked like a barangay had been
     * auto-selected - it showed "ADYA" in Lipa City - while est.barangay was
     * still "". Every other select here already carries a placeholder; this
     * one was the only exception, and it made the control disagree with the
     * model driving the estimate. */
    var placeholder = est.barangay ? "" : " selected";
    return '<option value=""' + placeholder + ">— choose a barangay —</option>" + keys.map(function (b) {
      var sel = b === est.barangay ? " selected" : "";
      return '<option value="' + esc(b) + '"' + sel + ">" + esc(titleCase(b)) + "</option>";
    }).join("");
  }

  function currentBarangay() {
    return est.muniData && est.muniData.barangays ? est.muniData.barangays[est.barangay] : null;
  }

  function streetTitles() {
    var br = currentBarangay();
    if (!br || !br.streets) return [];
    return Object.keys(br.streets).map(function (key) {
      return { key: key, name: br.streets[key].name || key };
    }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }

  function classCandidates() {
    var br = currentBarangay();
    var muniByClass = est.muniRow ? est.muniRow.byClass : {};
    var list = [];
    var push = function (codes) {
      (codes || []).forEach(function (c) {
        if (list.indexOf(c) === -1) list.push(c);
      });
    };
    if (br) {
      if (!est.allOther) {
        var st = br.streets ? br.streets[est.streetKey] : null;
        if (st && st.classes) push(Object.keys(st.classes));
      }
      if (br.other) push(Object.keys(br.other));
    }
    push(Object.keys(muniByClass));
    return list;
  }

  function classificationUses() {
    return ["residential", "commercial", "agricultural", "industrial"];
  }

  function selectedClassificationUse() {
    return est.classificationUse || (est.classification ? useOfClassification(DATA && DATA.config, est.classification) : "");
  }

  function classUseOptions() {
    var selected = selectedClassificationUse();
    return '<option value="">— choose a category —</option>' + classificationUses().map(function (use) {
      return '<option value="' + use + '"' + (use === selected ? " selected" : "") + '>' + use.charAt(0).toUpperCase() + use.slice(1) + "</option>";
    }).join("");
  }

  function classificationLabelShort() {
    var map = { RR: "Residential", CR: "Commercial", I: "Industrial", A50: "Agricultural" };
    return map[est.classification] || String(est.classification || "");
  }

  function simpleClassOptions() {
    /* The reference offers exactly four options with Residential as the
       default. The internal codes RR / CR / I / A50 map to those four; a saved
       legacy draft with a narrower code still resolves at estimate time via the
       use-of-classification mapping. */
    var codes = [
      { code: "RR", label: "Residential" },
      { code: "CR", label: "Commercial" },
      { code: "I", label: "Industrial" },
      { code: "A50", label: "Agricultural" }
    ];
    var current = est.classification || "RR";
    return codes.map(function (c) {
      return '<option value="' + c.code + '"' + (c.code === current ? " selected" : "") + ">" + c.label + "</option>";
    }).join("");
  }

  function classOptions() {
    var list = classCandidates();
    var use = selectedClassificationUse();
    if (!use) return '<option value="">— choose a category first —</option>';
    list = list.filter(function (c) { return useOfClassification(DATA && DATA.config, c) === use; });
    if (!list.length) return '<option value="">— no codes available for this category —</option>';
    var labels = (DATA && DATA.index.classifications) || {};
    return '<option value="">— choose a BIR classification —</option>' + list.map(function (c) {
      var l = labels[c] ? " — " + labels[c] : "";
      return '<option value="' + esc(c) + '"' + (c === est.classification ? " selected" : "") + ">" + esc(c + l) + "</option>";
    }).join("");
  }

  function locSummary() {
    var bits = ['<span class="sf-est-loc-fixed">Region IV-A (CALABARZON) · Batangas province only</span>'];
    if (est.municipality) bits.push("<b>" + esc(titleCase(est.municipality)) + "</b>");
    if (est.barangay) bits.push(esc(titleCase(est.barangay)));
    if (est.streetLabel && !est.allOther) bits.push("<span>" + esc(est.streetLabel) + "</span>");
    else if (est.allOther) bits.push("<span>Street not listed</span>");
    return '<div class="sf-est-locator"><span>' + bits.join(" · ") + "</span></div>";
  }

/* Opening a disclosure that lives inside another closed <details> changes
     nothing on screen: the element reports .open === true but stays hidden and
     keeps a zero bounding box. Validation therefore walks the whole ancestor
     chain, otherwise the field it just focused is invisible to the reader. */
  function openDisclosureChain(el) {
    for (var node = el; node; node = node.parentElement) {
      if (String(node.tagName).toLowerCase() === "details") node.open = true;
    }
  }

  /* Renders " open" when the reader asked for it, and when the current state
     requires it to be visible (an invalid indexed scenario whose rate field is
     inside the panel would otherwise be hidden behind a collapsed control). */
  function panelOpenAttr(name, forceOpen) {
    var open = forceOpen === true || est.openPanels[name] === true;
    return " data-est-panel=\"" + esc(name) + "\"" + (open ? " open" : "");
  }

  function currentVerification(result) {
    if (result && result.referenceVerification) return result.referenceVerification;
    var row = est.muniRow;
    if (!row) return null;
    return referenceTools.lookup(DATA.config.governmentReferenceRegister, row.rdo, row.name, new Date().toISOString().slice(0, 10));
  }

  /* Reviewed land-price history is the only thing permitted to drive an
     automatic index. It is empty today, so the control stays disabled and says
     why instead of quietly inventing an annual rate. */
  function reviewedTrend() {
    var list = (DATA.config.governmentReferenceRegister || {}).landTimeEvidence || [];
    if (!Array.isArray(list) || !list.length) return null;
    var useGroup = useOfClassification(DATA.config, est.classification);
    return list.filter(function (record) {
      return record && record.status === "reviewed" && record.metric === "matched-vacant-land-asking-rate"
        && String(record.municipality || "").toUpperCase() === String(est.municipality || "").toUpperCase()
        && record.useGroup === useGroup;
    })[0] || null;
  }

  function referencePlainFact() {
    var verification = currentVerification();
    if (!verification) return "Choose a municipality to match its BIR schedule.";
    return verification.label + (verification.scheduleEffectiveDate ? " · schedule effective " + verification.scheduleEffectiveDate : "");
  }

  /* Lower-case variant for running prose. */
  function referenceStatusShort() {
    var verification = currentVerification();
    if (!verification) return "no municipality selected";
    return String(verification.label || "").charAt(0).toLowerCase() + String(verification.label || "").slice(1);
  }

  function methodPlainFact() {
    if (est.landMethod !== "time-indexed") return "Factor-based guide · no annual change assumed";
    var rateValue = est.timeAnnualPct == null || est.timeAnnualPct === "" ? null : Number(est.timeAnnualPct);
    if (rateValue == null) return "Indexed land scenario · annual change not set yet";
    var source = est.timeSource === "evidence" ? "reviewed local history" : "your own assumption";
    return "Indexed land scenario · " + (rateValue > 0 ? "+" : "") + fmt(rateValue) + "% a year, " + source + " · separate from the factor guide";
  }

  function costPlainFact() {
    if (est.saleContext === "developer") return "Developer purchase · uses your quoted charges, no blanket CGT";
    if (est.saleContext === "unknown") return "Not determined · a written quotation is required";
    return "Standard resale illustration · CGT, DST, transfer and registration";
  }

  function referenceStatusHtml(r) {
    var verification = currentVerification(r);
    if (!verification) return '<p class="sf-est-rdp">Select a municipality to see its imported schedule and verification status.</p>';
    var fields = [["Published schedule effective date", verification.scheduleEffectiveDate || r && r.effectivityDate || "Not recorded"], ["Dataset generated", verification.datasetGeneratedAt || "Not recorded"], ["Import/download date", verification.importDate || "Not established separately"], ["Latest verification attempt", verification.lastAttemptedCheck || "Not recorded"], ["Successful applicability verification", verification.successfullyVerifiedOn || "Not verified"]];
    return '<section class="sf-est-reference-status" data-est-reference-status><h5>Government reference status</h5><p><b>' + esc(verification.label) + '</b>. An imported match does not establish latest legal applicability.</p><dl>' + fields.map(function (field) { return '<div><dt>' + esc(field[0]) + '</dt><dd>' + esc(field[1]) + '</dd></div>'; }).join('') + '</dl><p>' + esc(verification.verificationNote) + '</p>' + (verification.relatedSchedules || []).map(function (schedule) { return '<p>' + esc(schedule.id + ': ' + schedule.label + (schedule.proposedPeriod ? ' (' + schedule.proposedPeriod + ')' : '')) + '. ' + esc(schedule.note || '') + (/^https:\/\//.test(schedule.sourceUrl || "") ? ' <a href="' + esc(schedule.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Official source</a>' : '') + '</p>'; }).join('') + '</section>';
  }
  function timeInputsHtml() {
    var histories = (DATA.config.governmentReferenceRegister || {}).landTimeEvidence || [];
    var trend = reviewedTrend();
    return '<details class="sf-est-time-inputs"' + panelOpenAttr("time", est.landMethod === "time-indexed") + '><summary>Land method and optional time scenario</summary><p>No annual growth is assumed. Indexed references are separate planning scenarios; existing market and corner factors are not stacked.</p><div class="sf-est-fields"><label class="sf-est-field sf-est-span2">Land method<select data-est-time="landMethod"><option value="factor"' + (est.landMethod === "factor" ? " selected" : "") + '>Existing factor-based guide</option><option value="time-indexed"' + (est.landMethod === "time-indexed" ? " selected" : "") + '>Indexed land-reference scenario</option></select></label><label class="sf-est-field">Adjustment source<select data-est-time="timeSource"><option value="manual"' + (est.timeSource === "manual" ? " selected" : "") + '>Manual assumption</option><option value="evidence"' + (est.timeSource === "evidence" ? " selected" : "") + '>Reviewed local land-price history</option></select></label><label class="sf-est-field">Assumed annual change (%)<span>Increase or decrease; greater than -100%, at most 100%</span><input type="number" min="-99.99" max="100" step="0.01" data-est-time="timeAnnualPct" value="' + esc(est.timeAnnualPct == null ? "" : est.timeAnnualPct) + '"></label><label class="sf-est-field">Reference/base date<input type="date" data-est-time="timeBaseDate" value="' + esc(est.timeBaseDate || est.muniRow && est.muniRow.effectivityDate || "") + '"></label><label class="sf-est-field">Target date<input type="date" data-est-time="timeTargetDate" value="' + esc(est.timeTargetDate) + '"></label><label class="sf-est-field sf-est-span2">Reviewed local history<select data-est-time="timeEvidenceId"><option value="">' + (histories.length ? 'Choose reviewed evidence' : 'No reviewed local land-price history available') + '</option>' + histories.map(function (record) { return '<option value="' + esc(record.id) + '"' + (est.timeEvidenceId === record.id ? " selected" : "") + '>' + esc(record.id + ' — ' + record.municipality) + '</option>'; }).join('') + '</select></label></div><p>No official BIR/SMV update or market appreciation is implied. Buildings are computed separately from their construction-cost assumptions.</p>'
      + '<div class="sf-est-time-auto"><p>' + (trend
        ? 'A reviewed local land-price history is registered for ' + esc(trend.municipality) + ' (' + esc(trend.id) + '). It can fill the annual change automatically.'
        : 'Automatic annual change is unavailable. No reviewed local land-price history is registered for this property, so the calculator will not assume a growth rate for you.') + '</p>'
      + '<button type="button" class="sf-est-time-apply" data-est-time-apply-evidence' + (trend ? "" : " disabled") + '>Use the reviewed local trend</button></div></details>';
  }
  /* The three technical panels used to sit at the top level of step 1, so a
     first-time reader met government schedule provenance, an optional land index
     and four cost inputs before anything about their property. They now sit
     behind one "About this estimate" disclosure that states the three decisions
     in plain language first; the full inputs stay one click away and every
     data-est-* hook is unchanged, so validation, saving and PDF output are
     unaffected. */
  function aboutPanelHtml(costFields) {
    return '<details class="sf-est-about"' + panelOpenAttr("about") + '>'
      + '<summary><span class="sf-est-about-title">About this estimate</span>'
      + '<span class="sf-est-about-sub">Reference status, land method and costs</span></summary>'
      + '<ul class="sf-est-about-facts">'
      + '<li><b>Government reference</b><span>' + esc(referencePlainFact()) + '</span></li>'
      + '<li><b>Land method</b><span>' + esc(methodPlainFact()) + '</span></li>'
      + '<li><b>Transaction costs</b><span>' + esc(costPlainFact()) + '</span></li>'
      + '</ul>'
      + '<p class="sf-est-about-note">These are planning inputs, not a certified appraisal. Opening a section below never changes an official government schedule.</p>'
      + '<details class="sf-est-reference-disclosure"' + panelOpenAttr("reference") + '><summary>Government schedule and verification status</summary>' + referenceStatusHtml() + '</details>'
      + timeInputsHtml()
      + '<details class="sf-est-cost-inputs"' + panelOpenAttr("cost") + '><summary>Transaction type and optional costs</summary>' + costFields + '</details>'
      + '</details>';
  }

  function timeResultHtml(r) {
    if (!r.timeIndex) return '';
    var t = r.timeIndex, fields = [["Original reference rate", money(t.originalRate) + '/sqm'], ["Indexed rate (display rounded)", money(t.rawRate) + '/sqm'], ["Elapsed period", fmt(t.elapsedYears) + ' years; ' + t.baseDate + ' to ' + t.targetDate], ["Annual change", fmt(t.annualPct) + '% — ' + t.source], ["Indexed land amount", money(t.landAmount)], ["Existing factor guide comparison", money(r.factorBaseline.total) + ' (not stacked or selected)']];
    return '<section class="sf-est-time-result" data-est-time-result><h5>Indexed land-reference scenario</h5><dl>' + fields.map(function (field) { return '<div><dt>' + esc(field[0]) + '</dt><dd>' + esc(field[1]) + '</dd></div>'; }).join('') + '</dl><p>' + esc(t.formula) + '. Full precision is used before rounding the final land amount.</p><p>' + esc(t.note) + '</p></section>';
  }

  function screen1Html() {
    var out = '<div class="sf-est-step" data-est-screen="1">';
    out += locSummary();
    out += '<div class="sf-est-step-head"><div><h3>Tell us about your property</h3><p class="sf-est-step-subtitle">Location and lot area match the right BIR reference.</p></div></div>';
    out += '<div class="sf-est-fields">';

    /* 2026-10-15 simplification: the visible questions are the ones that set
       the value - type, town, barangay, street, classification (default
       Residential; moved out of "More options" on 2026-10-18), lot area.
       Purpose, sale stage, expected price and corner lot sit under "More
       options". Answers carried from the home quick estimate show as one
       summary line with a Change button instead of being asked again. */
    var carried = est.fromQuick && !est.quickEdit && est.municipality && est.area > 0;
    if (carried) {
      out += '<div class="sf-est-carried sf-est-span2" data-est-carried><span><b>' + esc(titleCase(est.municipality)) + '</b> · ' + (est.type === "house_lot" ? "House &amp; lot" : "Vacant lot") + ' · ' + esc(fmt(est.area)) + ' sqm</span>' +
        '<button type="button" class="sf-est-carried-edit" data-est-quick-edit aria-label="Change town, property type or lot area">Change</button></div>';
    } else {
      out += '<label class="sf-est-field sf-est-span2"><span class="sf-est-label">Property type</span>' +
        chipRow([
          { label: "Vacant lot", value: "vacant_lot", active: est.type === "vacant_lot" },
          { label: "House & lot", value: "house_lot", active: est.type === "house_lot" }
        ], "type") + "</label>";
      out += '<label class="sf-est-field"><span class="sf-est-label">Municipality</span>' +
        '<select data-est-muni><option value="">— choose —</option>' + muniOptions() + "</select></label>";
    }
    out += '<label class="sf-est-field' + (carried ? ' sf-est-span2' : '') + '"><span class="sf-est-label">Barangay</span><span>' + (carried ? 'Choose the barangay in ' + esc(titleCase(est.municipality)) : 'Choose after selecting the municipality') + '</span>' +
      '<select data-est-barangay>' + barangayOptions() + "</select></label>";

    out += '<div class="sf-est-field sf-est-span2 sf-est-street-field"><span class="sf-est-label">Street <em>(optional)</em></span><span>Skip to use the barangay rate.</span>' +
      '<div class="sf-est-street-input-wrap"><input data-est-street-q type="search" placeholder="' + (est.allOther ? "Street not listed — choose another street" : "Type to search streets…") + '" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="sf-est-street-options" aria-expanded="false" aria-label="Search the BIR street list" value="' + esc(est.allOther ? "" : est.streetLabel) + '">' +
      (est.allOther ? '<span class="sf-est-street-selected"><i aria-hidden="true">✓</i>Using all-other-streets rate</span>' : '') + '</div>' +
      '<div id="sf-est-street-options" class="sf-est-street-list" data-est-street-list role="listbox" aria-label="BIR streets"></div></div>';
    out += '<button type="button" class="sf-est-street-fallback sf-est-span2" data-est-street-fallback' + (!est.barangay ? " disabled" : "") + '>My street is not listed — use the best available BIR reference</button>';
    /* Classification sits with the location (2026-10-18): it sets the BIR rate
       as much as the street does, so a commercial or agricultural lot no longer
       looks "too high" or "too low" because the answer was hidden. */
    out += '<label class="sf-est-field sf-est-span2"><span class="sf-est-label">Classification</span><span>Residential is the default. Commercial, agricultural and industrial land have their own BIR rates, so the value changes with it.</span>' +
      '<select data-est-class aria-label="BIR classification">' + simpleClassOptions() + "</select></label>";
    out += '<details class="sf-est-help sf-est-span2"><summary>What does BIR classification mean?</summary><p>The BIR schedule groups land by use: residential, commercial, agricultural or industrial. Choose the one that matches the property. If you are unsure, confirm the classification with the relevant Revenue District Office before relying on the guide.</p></details>';
    if (!carried) {
      out += '<label class="sf-est-field sf-est-span2"><span class="sf-est-label">Lot area (sqm)</span>' +
        '<input data-est-area type="number" min="20" max="100000" step="1" inputmode="decimal" placeholder="e.g. 200" value="' + esc(est.area != null ? est.area : "") + '"></label>';
    }

    var moreSummary = [est.purpose, est.corner ? "Corner lot" : "", est.salePrice ? "Price entered" : ""].filter(Boolean).join(" · ");
    out += '<details class="sf-est-more sf-est-span2"' + panelOpenAttr("more") + '><summary><span class="sf-est-more-title">More options</span><span class="sf-est-more-sub">' + esc(moreSummary || "Purpose, price, corner lot") + '</span></summary><div class="sf-est-fields">';
    out += '<label class="sf-est-field sf-est-span2"><span class="sf-est-label">What do you need this valuation for?</span>' +
      chipRow((DATA.config.purposes || []).map(function (p) {
        return { label: p, value: p, active: est.purpose === p };
      }), "purpose") + "</label>";
    if (est.purpose === "Selling") {
      /* The reference's four selling-stage options, verbatim values shared with
         the internal guide (js/app.js saleStage) so a saved answer keeps meaning
         across surfaces. */
      out += '<label class="sf-est-field sf-est-span2"><span class="sf-est-label">Where are you in the sale?</span><span>Optional</span>' +
        chipRow([
          { label: "I'm just checking my property's value", value: "just_checking", active: est.stage === "just_checking" },
          { label: "I'm getting ready to sell", value: "ready_to_sell", active: est.stage === "ready_to_sell" },
          { label: "My property is already listed", value: "already_listed", active: est.stage === "already_listed" },
          { label: "I already have a buyer", value: "have_a_buyer", active: est.stage === "have_a_buyer" }
        ], "stage") + "</label>";
    }
    out += '<label class="sf-est-field sf-est-span2"><span class="sf-est-label">' + (est.purpose === "Buying" ? "Asking price or your offer" : est.purpose === "I received an offer" ? "Offer received" : "Expected selling price") + '</span><span>Optional — affects costs, not the estimate</span>' +
      '<input data-est-sale-price type="number" min="0" max="1000000000" step="1000" inputmode="decimal" placeholder="e.g. 5000000" value="' + esc(est.salePrice != null ? est.salePrice : "") + '"></label>';
    /* With the lot questions, not stranded under the technical panels. */
    out += '<label class="sf-est-field sf-est-span2 sf-est-corner"><input type="checkbox" data-est-corner' + (est.corner ? " checked" : "") + ">" +
      '<span><b>Corner lot</b> <small>Frontage on two roads adds 2.5% to the land value</small></span></label>';
    out += '</div></details>';
out += "</div>";
    /* Built after the main field grid closes so the technical panels never
       interrupt the property questions above them. */
    var costFields = "<div class=\"sf-est-fields\">" +
      '<label class="sf-est-field sf-est-span2">Transaction type<select data-est-sale-context>' + [["private-resale", "Qualifying capital-asset resale (illustrative)"], ["developer", "Developer purchase / ordinary-asset sale"], ["unknown", "Not sure — quotation required"]].map(function (pair) { return '<option value="' + pair[0] + '"' + (est.saleContext === pair[0] ? " selected" : "") + '>' + esc(pair[1]) + '</option>'; }).join("") + '</select></label>' +
      '<label class="sf-est-field">Quoted developer charges (PHP)<span>Optional total outside price; do not repeat taxes already included</span><input type="number" min="0" step="1" data-est-cost="developerFees" value="' + esc(est.developerFees == null ? "" : est.developerFees) + '"></label>' +
      '<label class="sf-est-field">Broker commission (%)<span>Negotiable; resale scenario only</span><input type="number" min="0" max="100" step="0.1" data-est-cost="brokerPct" value="' + esc(est.brokerPct * 100) + '"></label>' +
      '<label class="sf-est-field">Quoted notarial fee (PHP)<span>Optional, seller-paid in this illustration</span><input type="number" min="0" data-est-cost="notarial" value="' + esc(est.notarial == null ? "" : est.notarial) + '"></label>' +
      '<label class="sf-est-field">Assessor schedule FMV (PHP)<span>Optional confirmed value; not assessed/taxable value</span><input type="number" min="0" data-est-cost="fairMarketValue" value="' + esc(est.fairMarketValue == null ? "" : est.fairMarketValue) + '"></label></div><p>Developer charges require a quote; no universal 6% CGT is applied to developer or unclassified transactions. Local transfer and registration rates remain illustrations.</p>';
    out += aboutPanelHtml(costFields);

    out += '<div class="sf-est-actions">' +
      /* The reference status is deliberately repeated on the always-visible path.
       "We use the official BIR zonal schedule" read as a claim of legal currency
       the register does not support, and the honest version was hidden inside a
       collapsed disclosure. */
      '<span class="sf-est-next-hint">' + (est.municipality
        ? "We match the BIR zonal schedule imported for " + esc(titleCase(est.municipality)) + " (" + esc(referenceStatusShort()) + ")."
        : "Choose a municipality to match its BIR schedule.") + "</span>" +
      '<button type="button" class="sf-est-next" data-est-next>' + (est.type === "house_lot" ? "Continue to the house" : "Continue to property details") + "</button></div>";
    return out + "</div>";
  }

  /* Location-based pre-selection (2026-10-14). Typical answers for the chosen
     street/barangay, shown as "Suggested" and editable. Only fields the reader
     has not answered are filled, so a suggestion never overwrites a choice. */
  var HIGHWAY_RE = /\b(HI-?WAY|HIGHWAY|NATIONAL|DIVERSION|PROVINCIAL)\b/i;
  function suggestedFloorArea(area) {
    var a = Number(area) || 0;
    /* Floor/lot ratio of the 2026-10 Batangas house listings: small town lots are
       usually two storeys (~0.9x the lot), large lots are mostly yard. */
    var ratio = a <= 150 ? 0.9 : (a <= 300 ? 0.75 : 0.5);
    return Math.round(a * ratio);
  }
  function locationSuggestions() {
    var street = String(est.streetLabel || est.streetKey || "");
    var brgy = String(est.barangay || "");
    var subd = streetIsSubdivision(street);
    var agri = String(est.classification || "").toUpperCase().indexOf("A") === 0;
    var road;
    if (HIGHWAY_RE.test(street)) road = "Highway";
    else if (subd) road = "Barangay road";
    else if (street && !est.allOther && (/POBLACION/i.test(brgy) || /\b(ST|STREET|AVE|AVENUE|ROAD|RD|BLVD)\b/i.test(street))) road = "Municipal road";
    else road = "Barangay road";
    var out = {
      community: subd ? "Subdivision" : "Open area",
      floodRisk: "No flooding",
      roadAccess: road,
      frontage: "About average (8–20m)",
      lotShape: "Regular",
      rightOfWay: "Direct road access",
      elevation: "At road level",
      utilities: agri ? "Partial" : "Full power & water"
    };
    if (est.type === "house_lot") {
      out.ageBand = "6-10";
      if (est.area) out.floorArea = String(suggestedFloorArea(est.area));
    }
    return out;
  }
  function suggestAssumptions() {
    var sug = locationSuggestions();
    Object.keys(sug).forEach(function (key) {
      if (est.userSet[key]) return;
      est[key] = sug[key];
      est.assumed[key] = true;
    });
  }
  function markUserSet(key) {
    est.userSet[key] = true;
    delete est.assumed[key];
  }
  function siteImpactLabel(key, value) {
    var pct = SITE_ADJ[key] && SITE_ADJ[key][value];
    if (!pct) return "";
    return (pct > 0 ? "+" : "−") + Math.abs(pct) + "% land";
  }

  var SITE_LABELS = { community: "Community", floodRisk: "Flood risk", roadAccess: "Road access", frontage: "Frontage", lotShape: "Lot shape", rightOfWay: "Right of way", elevation: "Elevation", utilities: "Utilities" };
  var OWNERSHIP_LABELS = { occupancy: "Occupancy", titleStatus: "Title", inheritanceStatus: "Inheritance" };
  function adjustmentsHtml(r) {
    var pct = function (n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n) + "%"; };
    var sa = r.siteAdjustment || { rows: [], pct: 0 }, oa = r.ownershipAdjustment || { rows: [], pct: 0 };
    var siteRows = Object.keys(SITE_LABELS).map(function (k) {
      var row = (sa.rows || []).filter(function (x) { return x.key === k; })[0];
      var v = r.siteReview && r.siteReview[k];
      return "<li>" + SITE_LABELS[k] + ": <b>" + esc(v || "not stated") + "</b>" +
        (est.assumed && est.assumed[k] ? " <em>(suggested)</em>" : "") +
        " · " + (row ? pct(row.pct) + " land" : "no change") + "</li>";
    }).join("");
    var ownRows = (oa.rows || []).map(function (x) {
      return "<li>" + OWNERSHIP_LABELS[x.key] + ": <b>" + esc(ownershipLabel(x.key, x.answer)) + "</b> · " + pct(x.pct) + " total</li>";
    }).join("");
    var size = Number(r.lotSizeFactor) || 1;
    return "<ul class=\"sf-est-rdl\">" + siteRows + "</ul>" +
      "<p class=\"sf-est-rdp\">Site answers net <b>" + pct(sa.pct || 0) + "</b> on land" +
      (sa.clamped ? " (limited from " + pct(sa.rawPct) + ")" : "") + "." +
      (size < 1 ? " Large-lot adjustment: land rate × <b>" + size.toFixed(3) + "</b> for " + fmt(r.area) + " sqm (price per sqm falls on bigger lots)." : "") +
      (r.townCalibration ? " Town correction for " + esc(titleCase(r.municipality)) + ": land × <b>" + r.townCalibration.factor.toFixed(3) + "</b>, reviewed and approved from " + r.townCalibration.records + " bank and Pag-IBIG lot prices across " + r.townCalibration.projects + " developments (" + esc(r.townCalibration.month) + ")." : "") + "</p>" +
      (ownRows ? "<ul class=\"sf-est-rdl\">" + ownRows + "</ul><p class=\"sf-est-rdp\">Ownership answers net <b>−" + (oa.pct || 0) + "%</b> on the total" + (oa.clamped ? " (capped at 30%)" : "") + ".</p>"
        : "<p class=\"sf-est-rdp\">No ownership deductions: title, occupancy and inheritance answers were clean or skipped.</p>") +
      "<p class=\"sf-est-rdp\">Suggested answers are typical for the location; correct any that don't match your property.</p>";
  }

  function reviewFactorBlock() {
    /* The reference's remaining questions, as collapsed accordions whose
       headers show the picked values, with a "Not sure" skip on each.
       Since 2026-10-14 each answer moves the land value (SITE_ADJ). */
    var skip = function (key) {
      return { label: "Not sure", value: "", active: !est[key], skip: true };
    };
    var summary = function (keys) {
      var picked = keys.map(function (k) { return est[k]; }).filter(Boolean);
      var anyAssumed = keys.some(function (k) { return est[k] && est.assumed[k]; });
      return picked.length ? picked.join(" · ") + (anyAssumed ? " (suggested)" : "") : "Not set";
    };
    var group = function (title, keys, fields) {
      return '<details class="sf-est-review-group"><summary><h4>' + esc(title) + '</h4><span class="sf-est-review-picked">' + esc(summary(keys)) + "</span></summary>" +
        '<div class="sf-est-fields">' + fields.join("") + "</div></details>";
    };
    var tile = function (label, opts, key) {
      return '<label class="sf-est-field sf-est-span2"><span class="sf-est-label">' + esc(label) +
        (est[key] && est.assumed[key] ? ' <em class="sf-est-suggested" data-est-suggested="' + esc(key) + '">Suggested</em>' : "") + '</span>' + chipRow(
        opts.map(function (o) {
          var v = o.value || o.label, impact = o.skip ? "" : siteImpactLabel(key, v);
          return { label: o.label + (impact ? " (" + impact + ")" : ""), value: o.skip ? "" : v, active: o.skip ? !est[key] : est[key] === v, skip: o.skip };
        }), key) + "</label>";
    };
    var anySuggested = Object.keys(SITE_ADJ).some(function (k) { return est[k] && est.assumed[k]; });
    return (anySuggested ? '<p class="sf-est-suggest-note" data-est-suggest-note>We pre-selected typical answers for ' +
        esc([est.streetLabel && !est.allOther ? est.streetLabel : "", est.barangay, est.municipality].filter(Boolean).join(", ")) +
        '. Change anything that doesn\'t match your property — each answer shows how it moves the land value.</p>' : "") +
      group("Surroundings", ["community", "floodRisk", "roadAccess"],
      [
        tile("Community", COMMUNITIES.map(function (c) { return { label: c }; }).concat([skip("community")]), "community"),
        tile("Flood risk", FLOOD_RISKS.map(function (c) { return { label: c }; }).concat([skip("floodRisk")]), "floodRisk"),
        tile("Road access", ROAD_ACCESS.map(function (c) { return { label: c }; }).concat([skip("roadAccess")]), "roadAccess")
      ]) +
    group("Land & access", ["frontage", "lotShape", "rightOfWay"],
      [
        tile("Frontage", FRONTAGE.map(function (c) { return { label: c }; }).concat([skip("frontage")]), "frontage"),
        tile("Lot shape", LOT_SHAPES.map(function (c) { return { label: c }; }).concat([skip("lotShape")]), "lotShape"),
        tile("Right of way", RIGHT_OF_WAY.map(function (c) { return { label: c }; }).concat([skip("rightOfWay")]), "rightOfWay")
      ]) +
    group("The land itself", ["elevation"],
      [tile("Elevation vs the road", ELEVATIONS.map(function (c) { return { label: c }; }).concat([skip("elevation")]), "elevation")]) +
    group("Utilities", ["utilities"],
      [tile("Power & water", UTILITIES.map(function (c) { return { label: c }; }).concat([skip("utilities")]), "utilities")]);
  }

  function ownershipQuestion(key, title, description, options) {
    return '<fieldset class="sf-est-ownership-question"><legend>' + esc(title) + '</legend><p>' + esc(description) + '</p><div class="sf-est-ownership-options">' + options.map(function (o) {
      var active = est[key] === o.value;
      return '<button type="button" class="sf-est-ownership-option' + (active ? " active" : "") + (o.value === "not_sure" ? " sf-est-ownership-skip" : "") + '" data-est-ownership="' + key + '" data-val="' + esc(o.value) + '" aria-pressed="' + (active ? "true" : "false") + '"><b>' + esc(o.label) + '</b><small>' + esc(o.note) + '</small>' + (o.impact ? '<strong>' + esc(o.impact) + '</strong>' : "") + '</button>';
    }).join("") + '</div></fieldset>';
  }

  function ownershipQuestions() {
    return '<div class="sf-est-ownership-intro"><span class="sf-est-icon sf-est-icon-large" aria-hidden="true">▤</span><div><h4>Ownership &amp; title</h4><b>Important for a confident sale</b><p>Title status, occupancy, and inheritance can affect marketability and how quickly you can sell. Buyers will discover these during due diligence.</p></div></div>' +
      ownershipQuestion("occupancy", "Is anyone living on the property?", "This affects how quickly and easily you can sell.", [
        { value: "empty", label: "No, it's empty", note: "Ready for viewing", impact: "" },
        { value: "caretaker", label: "A caretaker or family member", note: "There with permission; confirm possession", impact: "−5%" },
        { value: "tenants", label: "Tenants paying rent", note: "Buyer takes on the lease; review income", impact: "−5%" },
        { value: "informal_settlers", label: "Informal settlers", note: "Possession unresolved; review needed", impact: "−25%" },
        { value: "not_sure", label: "Not sure", note: "We'll skip this", impact: "" }
      ]) +
      ownershipQuestion("titleStatus", "Do you have a certificate of title?", "A Transfer Certificate of Title (TCT) or Condominium Certificate of Title (CCT).", [
        { value: "titled_self", label: "Yes, and it's in my name", note: "Title matches the owner", impact: "" },
        { value: "titled_previous", label: "Yes, but still in the previous owner's name", note: "Verify authority and transfer requirements", impact: "−8%" },
        { value: "tax_declaration", label: "No, only a tax declaration", note: "Registered ownership unconfirmed", impact: "−15%" },
        { value: "not_sure", label: "Not sure", note: "We'll skip this", impact: "" }
      ]) +
      ownershipQuestion("inheritanceStatus", "Was this property inherited?", "Inherited properties need an Extrajudicial Settlement before they can be sold.", [
        { value: "not_inherited", label: "No, I bought it or it's always been mine", note: "No inheritance process", impact: "" },
        { value: "settled", label: "Yes, and the settlement is finished", note: "Annotated on the title", impact: "" },
        { value: "pending", label: "Yes, but the settlement isn't done", note: "Settlement must finish before transfer", impact: "−10%" },
        { value: "not_sure", label: "Not sure", note: "We'll skip this", impact: "" }
      ]);
  }

  function screen2Html() {
    var out = '<div class="sf-est-step" data-est-screen="2">';
    out += locSummary();
    out += '<div class="sf-est-step-head"><div><h3>Describe your property</h3><p class="sf-est-step-subtitle">Answer what you know — tap “Not sure” to skip anything you don’t.</p></div></div>';
    if (est.type === "house_lot") {
      out += '<div class="sf-est-fields">' +
        '<label class="sf-est-field sf-est-span2">Building condition<select data-est-condition>' + [["unknown", "Not inspected / unknown"], ["new", "New / completed finish"], ["good", "Good condition"], ["repair", "Repairs needed"]].map(function (pair) { return '<option value="' + pair[0] + '"' + (est.condition === pair[0] ? " selected" : "") + '>' + pair[1] + '</option>'; }).join("") + '</select><span>Best guess is fine</span></label>' +
        '<label class="sf-est-field sf-est-span2">Construction style<span>Main build type</span>' + chipRow(
          ["wood_prefab", "mixed_chb", "rca_steel"].map(function (k) {
            return { label: labelFor(DATA.config, "construction", k), value: k, active: est.construction === k };
          }), "construction") + "</label>" +
        '<label class="sf-est-field">Total built-up area (sqm)' + (est.assumed.floorArea ? ' <em class="sf-est-suggested" data-est-suggested="floorArea">Suggested</em>' : "") +
        '<span>Across all storeys. ' + (est.assumed.floorArea ? "Typical for a " + fmt(est.area || 0) + " sqm lot here — enter yours if you know it." : "Blank uses a typical size for the lot.") + '</span>' +
        '<input data-est-floor type="number" min="0" max="100000" step="0.01" inputmode="decimal" placeholder="auto — ' + fmt(suggestedFloorArea(est.area)) + ' sqm" value="' + esc(est.floorArea) + '"></label>' +
        '<label class="sf-est-field">Storeys<span>Recorded; the figure above already covers every storey</span>' + chipRow(
          (DATA.config.floors || []).map(function (f) {
            return { label: f.label, value: f.key, active: est.floors === f.key };
          }), "floors") + "</label>" +
        '<label class="sf-est-field sf-est-span2">Age band' + (est.assumed.ageBand ? ' <em class="sf-est-suggested" data-est-suggested="ageBand">Suggested</em>' : "") + '<span>Straight-line depreciation, capped</span>' + chipRow(
          (DATA.config.ageBands || []).map(function (b) {
            return { label: b.label, value: b.key, active: est.ageBand === b.key };
          }), "ageBand") + "</label>" +
        '<div class="sf-est-field sf-est-span2">Improvements<span>Things that add real, itemised value</span><div class="sf-est-feat-grid">' +
        Object.keys(DATA.config.features || {}).map(function (fk) {
          var f = DATA.config.features[fk];
          var on = est.features.indexOf(fk) !== -1;
          return '<label class="sf-est-feat' + (on ? " on" : "") + '"><input type="checkbox" data-est-feature="' + esc(fk) + '"' + (on ? " checked" : "") + ">" +
            "<span><b>" + esc(f.label) + "</b><small>+" + money(f.cost) + "</small></span></label>";
        }).join("") + "</div></div>" +
        "</div>";
    } else {
      out += '<p class="sf-est-hint">As a vacant lot there is no house to value — we only look at the land.</p>';
    }
    out += ownershipQuestions();
    /* The reference asks these questions visibly, each with a "Not sure" skip,
       so they sit in the main flow rather than a collapsed corner. Each answer
       moves the estimate by the % shown on its button. */
    out += '<div class="sf-est-site-review" data-est-site-review>' + reviewFactorBlock() + '</div>';
    out += '<div class="sf-est-actions"><button type="button" class="sf-est-next sf-est-prev" data-est-prev>Back to location</button>' +
      '<button type="button" class="sf-est-next" data-est-next>Calculate my estimate</button></div>';
    return out + "</div>";
  }

  function screen3Html() {
    return '<div class="sf-est-step sf-est-anim" data-est-screen="3" role="status" aria-live="polite" aria-busy="true">' +
      locSummary() +
      '<div class="sf-est-anim-head"><span class="sf-est-step-no">03</span><div><p>YOUR PROPERTY VALUE GUIDE</p><h3 class="sf-est-anim-title">Calculating your property value</h3></div></div>' +
      '<div class="sf-est-anim-panel"><div class="sf-est-anim-bar" aria-hidden="true"><b></b></div><div class="sf-est-anim-stages" aria-label="Calculation progress">' +
      '<div class="sf-est-anim-stage active" data-est-stage="0"><i>1</i><span>Reading the BIR schedule</span></div>' +
      '<div class="sf-est-anim-stage" data-est-stage="1"><i>2</i><span>Checking the property details</span></div>' +
      '<div class="sf-est-anim-stage" data-est-stage="2"><i>3</i><span>Preparing your value guide</span></div>' +
      '</div></div>' +
      '<p class="sf-est-anim-note" data-est-anim-note>Matching your barangay, street and BIR classification…</p>' +
      '<p class="sf-est-anim-reassure">Your official BIR reference and indicative market guidance are kept separate.</p></div>';
  }

  /* ---- Provenance surface -------------------------------------------------
   * The manifest is the same record the CI staleness check and the math suite
   * read, so the wording shown to a user cannot drift from the data actually
   * loaded. Every block degrades to an empty string if the manifest is absent
   * rather than rendering a half-populated panel.
   */
  function manifest() {
    return (DATA && DATA.manifest) || null;
  }

  function currencyCheckedOn() {
    var m = manifest();
    return (m && m.provenance && m.provenance.currencyCheckedOn) || "";
  }

  function todayLabel() {
    var d = new Date();
    if (isNaN(d.getTime())) return "";
    var months = ["January", "February", "March", "April", "May", "June", "July",
      "August", "September", "October", "November", "December"];
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }

  function provenanceHtml(r) {
    var m = manifest();
    if (!m) {
      /* Manifest unavailable: fall back to what the result object itself carries,
       * so the section is never empty for the reader. */
      return '<p class="sf-est-rdp">This guide is a market-oriented planning figure built from the official BIR zonal rate for your street and classification, adjusted by disclosed market factors. Reference schedule <b>' +
        esc(r.reference.schedule) + "</b> (RDO " + esc(r.rdo) + ", DO " + esc(r.departmentOrder) + ", " + esc(r.revision) +
        '). Data version <b>' + esc(r.dataVersion) + "</b>, calculation <b>" + esc(r.calculationVersion) + "</b>. Every peso below traces to that rate or to a factor shown on this page.</p>";
    }

    var out = "";

    if (m.valuation) {
      out += '<div class="sf-est-prov-block"><p class="sf-est-prov-label">Basis of value</p><p class="sf-est-rdp"><b>' +
        esc(m.valuation.basisOfValue) + "</b>. " + esc(m.valuation.basisNote) + "</p>";
      if (m.valuation.valuationDateRule) {
        out += '<p class="sf-est-rdp">Valuation date <b>' + esc(todayLabel()) + "</b> — the day this guide was generated. The reference-rate effectivity is tracked separately as provenance and is not the valuation date.</p>";
      }
      if (m.valuation.standardOfCare) {
        out += '<p class="sf-est-rdp">' + esc(m.valuation.standardOfCare) + "</p>";
      }
      out += "</div>";
    }

    if (m.approach) {
      out += '<div class="sf-est-prov-block"><p class="sf-est-prov-label">Valuation approach</p><ul class="sf-est-rdl">';
      ["market", "cost", "evidence"].forEach(function (k) {
        var a = m.approach[k];
        if (!a) return;
        out += "<li><b>" + esc(a.label) + "</b><br>" + esc(a.description) +
          (a.usedFor ? '<br><span class="sf-est-prov-muted">Applies to: ' + esc(a.usedFor) + "</span>" : "") + "</li>";
      });
      out += "</ul></div>";
    }

    if (m.adjustmentFramework && m.adjustmentFramework.factors) {
      out += '<div class="sf-est-prov-block"><p class="sf-est-prov-label">Order of adjustments</p><ol class="sf-est-rdl sf-est-prov-steps">';
      m.adjustmentFramework.order.forEach(function (step) {
        out += "<li>" + esc(step) + "</li>";
      });
      out += "</ol>";
      if (m.adjustmentFramework.note) {
        out += '<p class="sf-est-rdp">' + esc(m.adjustmentFramework.note) + "</p>";
      }
      out += "</div>";
    }

    if (m.provenance && m.provenance.records && m.provenance.records.length) {
      out += '<div class="sf-est-prov-block"><p class="sf-est-prov-label">' +
        esc(m.provenance.recordLabel || "Source of record") + "</p>" +
        '<ul class="sf-est-rdl">' + m.provenance.records.map(function (rec) {
          return "<li><b>" + esc(rec.instrument) + "</b> — " + esc(rec.authority) +
            "<br>" + esc(rec.coverage) +
            '<br><span class="sf-est-prov-muted">Effectivity ' + esc(rec.effectiveDate) +
            " · " + esc(rec.revision || "") + " · " + esc(rec.status) + "</span>" +
            (rec.currencyNote ? "<br>" + esc(rec.currencyNote) : "") + "</li>";
        }).join("") + "</ul>";
      if (m.provenance.nextCurrencyReview) {
        out += '<p class="sf-est-rdp">Reference schedules are re-checked for supersession on a 30-day cycle; next check <b>' +
          esc(m.provenance.nextCurrencyReview) + "</b>.</p>";
      }
      out += "</div>";
    }

    if (m.assurance && m.assurance.length) {
      out += '<div class="sf-est-prov-block"><p class="sf-est-prov-label">Checks applied to every result</p><ul class="sf-est-rdl">';
      m.assurance.forEach(function (a) {
        out += "<li><b>" + esc(a.check) + "</b> — " + esc(a.statement) + "</li>";
      });
      out += "</ul></div>";
    }

    if (m.range) {
      out += '<div class="sf-est-prov-block"><p class="sf-est-prov-label">Reading the range</p><p class="sf-est-rdp">' +
        esc(m.range.method) + ". " + esc(m.range.meaning) + "</p>";
      if (m.range.guidance) out += "<p class=\"sf-est-rdp\">" + esc(m.range.guidance) + "</p>";
      out += "</div>";
    }

    if (m.limitations && m.limitations.length) {
      out += '<div class="sf-est-prov-block"><p class="sf-est-prov-label">What this guide does not cover</p><ul class="sf-est-rdl">';
      m.limitations.forEach(function (l) { out += "<li>" + esc(l) + "</li>"; });
      out += "</ul></div>";
    }

    return out;
  }

  function askingPriceHtml(r) {
    var label = "Upper planning scenario (130%)";
    var note = r.marketGuideAvailable
      ? "A guide-based starting point. Comparable asking listings are context only and do not feed this calculation."
      : "A factor-based starting point. No comparable listings were available for this calculation.";
    return '<div class="sf-est-asking" data-est-asking-block><span>' + label + '</span><b>' + money(r.recommendedAskingPrice) + '</b><small>' + note + '</small></div>';
  }

  function amountOrUnknown(value) { return value == null || !isFinite(Number(value)) ? "Not determined" : money(value); }
  function transactionHtml(r, tax) {
    if (tax.quotationRequired) return '<p class="sf-est-rdp"><b>Developer / unclassified transaction.</b> ' + esc(tax.note) + '</p><p class="sf-est-rdp">Quoted charges outside price: <b>' + amountOrUnknown(tax.quotedDeveloperFees) + '</b> · acquisition budget: <b>' + amountOrUnknown(tax.buyerTotal) + '</b>. Other unquoted costs and financing are not included.</p>';
    return '<div class="sf-est-tax"><span>Illustrative tax base: <b>' + money(tax.base) + '</b> · ' + esc(tax.baseBasis) + '</span><b>CGT 6% ≈ ' + money(tax.cgt) + '</b><b>DST 1.5% ≈ ' + money(tax.dst) + '</b><b>Broker commission ' + fmt(tax.brokerPct * 100) + '% ≈ ' + money(tax.broker) + '</b><b>Transfer ~0.5% ≈ ' + money(tax.transfer) + '</b><b>Registration ~0.1% ≈ ' + money(tax.registration) + '</b></div><p class="sf-est-rdp"><b>Estimated seller costs:</b> ' + money(tax.sellerCosts) + ' · <b>estimated net proceeds:</b> ' + amountOrUnknown(tax.projectedNetProceeds) + ' · <b>Buyer acquisition budget:</b> ' + amountOrUnknown(tax.buyerTotal) + '</p><p class="sf-est-rdp">Qualifying capital-asset resale assumed. CGT, commission and quoted notary are seller-paid; DST, transfer and registration buyer-paid in this illustration. Costs and allocation are negotiable; local rates and exemptions require confirmation. Derived locality medians are not confirmed parcel tax-floor inputs.</p>';
  }
  function decisionHtml(r) {
    var tax = costsFor(r, DATA.config), buying = r.purpose === "Buying", offered = r.salePrice > 0;
    var comparison = offered && r.total > 0 ? '<p>' + (r.purpose === "I received an offer" ? "Offer received" : buying ? "Asking price / offer" : "Price scenario") + ': <b>' + money(r.salePrice) + '</b> · ' + fmt((r.salePrice / r.total - 1) * 100) + '% relative to the factor guide. This difference does not establish a fair transaction price.</p>' : '<p>No transaction price entered; costs use the central guide as an assumed price.</p>';
    var title = buying ? "Your buying decision" : r.purpose === "I received an offer" ? "Review the offer" : r.purpose === "Selling" ? "Your selling decision" : "Planning for " + r.purpose;
    if (r.askingIndication) comparison += '<p>Qualified asking median: <b>' + money(r.askingIndication.value) + '</b>' + (offered ? ' · price is ' + fmt((r.salePrice / r.askingIndication.value - 1) * 100) + '% relative to this asking indication.' : '.') + ' Advertised prices are not achieved sales.</p>';
    var primaryLabel = buying ? "Total acquisition budget" : "Seller net proceeds", primaryAmount = buying ? tax.buyerTotal : tax.projectedNetProceeds;
    var note = buying ? (tax.quotationRequired ? "Price plus quoted charges outside price; unquoted costs and financing excluded." : "Price plus assumed buyer-paid costs; financing excluded.") : "Price less assumed seller-paid costs; not a guaranteed sale outcome.";
    if (r.purpose === "Estate") { primaryLabel = "Property-only estate tax scenario"; primaryAmount = finance.estate(r.total).tax; note = "Assumes this property were the entire citizen/resident estate. Actual tax requires all assets, death-date values and deductions; zero does not establish no filing duty."; }
    if (r.purpose === "Loan") { primaryLabel = "Financing reference only"; primaryAmount = null; note = "Bank acceptance, loan-to-value, interest and approval are not determined by this guide."; }
    return '<section class="sf-est-decision" data-est-decision><h4>' + esc(title) + '</h4>' + comparison + '<div class="sf-est-decision-grid"><div><span>' + primaryLabel + '</span><b>' + amountOrUnknown(primaryAmount) + '</b><small>' + note + '</small></div><div><span>Underlying property guide</span><b>' + money(r.total) + '</b><small>Same property facts give the same value for Buying and Selling.</small></div></div><p>' + esc(r.conditions) + '</p>' + (r.stage === "ready" ? '<p>Before listing: confirm current price, authority to sell and document readiness.</p>' : '') + '</section>';
  }
  function projectContextHtml(municipality) {
    var registry = DATA && DATA.projectEvidence;
    if (!registry || registry.unavailable) return '<p>Project-source register unavailable; no project prices used.</p>';
    var records = (registry.records || []).filter(function (record) { return evidence.place(record.municipality) === evidence.place(municipality); });
    if (!records.length) return '<p>No researched project records for this municipality. This does not mean the area has no properties for sale.</p>';
    return '<p>Observed ' + esc(registry.observedOn) + '; price-effective dates unconfirmed. Specifications and broad ranges are context only, not numerical comparables.</p>' + records.map(function (record) {
      var area = record.lotArea ? fmt(record.lotArea) + ' sqm lot' : record.lotAreaMinimum ? 'minimum ' + fmt(record.lotAreaMinimum) + ' sqm lot' : 'exact lot area unconfirmed';
      var floor = record.floorArea ? ' · ' + fmt(record.floorArea) + ' sqm ' + (record.areaBasis === "gross-floor" ? 'gross floor' : 'floor; definition unconfirmed') : '';
      var price = record.priceRange ? money(record.priceRange[0]) + ' – ' + money(record.priceRange[1]) + ' model range' : record.priceFrom ? 'from ' + money(record.priceFrom) : record.price ? money(record.price) + ' advertised' : 'price not published';
      return '<article class="sf-est-project-record"><h5>' + esc(record.project + ' — ' + record.model) + '</h5><p>' + esc(area + floor) + '</p><p>' + esc(price) + ' · ' + esc(record.sourceTier) + '</p>' + (record.notes ? '<p>' + esc(record.notes) + '</p>' : '') + (/^https:\/\//.test(record.sourceUrl || "") ? '<a href="' + esc(record.sourceUrl) + '" target="_blank" rel="noopener noreferrer">View source</a>' : '') + '</article>';
    }).join("");
  }
  /* Researched asking prices near the subject, read from data/market-benchmarks.json
     as DISPLAY CONTEXT ONLY. Each record already carries its own street-level BIR
     multiple, so the panel explains what the asking evidence implies in the same
     vocabulary as the estimate (x the BIR rate) without ever feeding the price into
     computeEstimate(). The summary sentence is generated from the records - a
     deterministic analysis of the gathered evidence, not a model call. */
  function benchmarkContextHtml(r) {
    var rows = (DATA.marketBenchmarks && DATA.marketBenchmarks.records) || [];
    if (!rows.length) return '<p class="sf-est-rdp">No researched asking-price records are loaded. This does not mean the area has no properties for sale.</p>';
    var here = rows.filter(function (rec) { return evidence.place(rec.municipality) === evidence.place(r.municipality); });
    var near = rows.filter(function (rec) { return evidence.place(rec.municipality) !== evidence.place(r.municipality); }).slice(0, 3);
    var list = here.concat(near);
    if (!list.length) return '<p class="sf-est-rdp">No researched asking-price records near ' + esc(titleCase(r.municipality)) + ' yet. Researched records exist for: ' + esc(rows.map(function (rec) { return rec.municipality; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(", ")) + '.</p>';
    var cards = list.map(function (rec) {
      var perSqm = rec.askingPricePerSqmMin ? fmt(rec.askingPricePerSqmMin) + (rec.askingPricePerSqmMax ? "–" + fmt(rec.askingPricePerSqmMax) : "") + "/sqm"
        : (rec.askingPrice && rec.lotArea) ? fmt(Math.round(rec.askingPrice / rec.lotArea)) + "/sqm"
        : rec.askingPriceMin && rec.lotAreaMin ? "from " + fmt(Math.round(rec.askingPriceMin / rec.lotAreaMin)) + "/sqm"
        : null;
      var multiple = rec.birStreetCheck && rec.birStreetCheck.impliedMultiple;
      var project = rec.project || rec.model || rec.id;
      var source = rec.sourceUrl ? ' <a href="' + esc(rec.sourceUrl) + '" target="_blank" rel="noopener noreferrer">source</a>' : "";
      return '<article class="sf-est-benchmark-record"><h5>' + esc(project + (rec.municipality !== r.municipality ? " · " + rec.municipality : "")) + '</h5>'
        + '<p>' + (perSqm ? '<b>' + esc(perSqm) + '</b>' : '') + (multiple ? ' · ' + esc(multiple) : '') + '</p>'
        + '<p class="sf-est-rdp">' + esc((rec.notes || rec.priceBasis || "").slice(0, 160)) + '</p>' + source + '</article>';
    }).join("");
    var sameMuni = here.length ? " This municipality has " + here.length + " researched asking record(s)." : " This municipality has no researched asking record yet; nearby records are shown for context.";
    return '<div class="sf-est-benchmark-context" data-est-benchmark-context><h5>Researched asking prices' + (here.length ? " in " + esc(titleCase(r.municipality)) : " nearby") + '</h5>' + cards + '<p class="sf-est-rdp">Researched asking prices are advertised prices, not achieved sales, and they are context only - they never change the estimate above.' + sameMuni + '</p></div>';
  }
  /* Bank listings in the subject's town: the evidence LandValuePH puts behind a
     paywall, shown here with source, price type, date and link. Context only -
     see ESREALTY_EVIDENCE.bankNearby. */
  var BANK_LABEL = { bdo: "BDO", bpi: "BPI Buena Mano", securitybank: "Security Bank", pagibig: "Pag-IBIG Fund", sss: "SSS" };
  var PRICE_LABEL = { advertised: "advertised price", selling: "selling price", suggested: "suggested price", minimum_bid: "minimum bid", fair_market_value: "fair market value" };
  function titleCase(v) {
    return String(v || "").toLowerCase().replace(/(^|[\s(\-\/])([a-zñ])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }
  function shortDate(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
    return m ? Number(m[3]) + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1] + " " + m[1] : "";
  }
  /* One line next to the estimate, so the bank and Pag-IBIG evidence is seen
     without opening "Market evidence"; the full section stays there. */
  function bankSummaryLineHtml(r) {
    var snap = DATA && DATA.bankComparables;
    if (!snap || snap.unavailable || !r || !r.municipality) return "";
    var n = evidence.bankNearby(snap, { municipality: r.municipality, barangay: r.barangay, type: r.type, area: r.area, landPerSqm: r.landPerSqm, total: r.total });
    if (!n.total) return "";
    var what = r.type === "vacant_lot" ? "vacant lots" : "houses";
    return '<p class="sf-est-result-bank" data-est-bank-line><b>' + n.total + ' bank and Pag-IBIG propert' + (n.total === 1 ? 'y' : 'ies') + '</b> for sale in ' + esc(titleCase(r.municipality)) +
      (n.medianPricePerSqm ? ' · median ' + money(n.medianPricePerSqm) + '/sqm of lot for ' + what : '') +
      (n.subjectVsMedian != null ? ' · this guide ' + (n.subjectVsMedian >= 0 ? '+' : '') + fmt(Math.round(n.subjectVsMedian * 100)) + '%' : '') +
      '. <span>As-is asking prices and minimum bids; details under Market evidence.</span></p>';
  }

  function bankListingsHtml(r) {
    var snap = DATA && DATA.bankComparables;
    if (!snap || snap.unavailable) return '<p class="sf-est-rdp">The bank listing snapshot could not be loaded.</p>';
    var n = evidence.bankNearby(snap, { municipality: r.municipality, barangay: r.barangay, type: r.type, area: r.area, landPerSqm: r.landPerSqm, total: r.total });
    var vacant = r.type === "vacant_lot", town = esc(titleCase(r.municipality));
    if (!n.total) return '<div class="sf-est-bank" data-est-bank><p class="sf-est-rdp">No bank or Pag-IBIG acquired properties are listed for sale in ' + town + ' this month. The list is refreshed monthly from BDO, BPI Buena Mano and Pag-IBIG.</p></div>';
    var head = '<p class="sf-est-bank-lead"><b>' + n.total + ' bank and Pag-IBIG acquired propert' + (n.total === 1 ? 'y' : 'ies') + '</b> for sale in ' + town + (n.inBarangay ? ' · <b>' + n.inBarangay + '</b> in ' + esc(r.barangay) : '') + '.</p>';
    if (n.medianPricePerSqm) {
      head += '<p class="sf-est-rdp">Median ' + money(n.medianPricePerSqm) + ' per sqm of lot across ' + n.sameKind + ' ' + (vacant ? 'vacant lots' : 'house-and-lot properties (house included)') +
        (n.cluster ? '; ' + n.cluster.count + ' of ' + n.sameKind + ' are within ±' + n.cluster.pct + '% of it' : '; prices are widely spread') + '.';
      if (n.subjectVsMedian != null) head += ' This guide works out to ' + money(n.subjectPricePerSqm) + ' per sqm' + (vacant ? ' of land' : ' of lot, house included') + ' (' + (n.subjectVsMedian >= 0 ? '+' : '') + fmt(Math.round(n.subjectVsMedian * 100)) + '% against that median).';
      head += '</p>';
    } else head += '<p class="sf-est-rdp">Fewer than 3 ' + (vacant ? 'vacant lots' : 'houses') + ' here, so no median is shown.</p>';
    var cards = n.records.map(function (rec) {
      var place = rec.barangay ? "Brgy. " + rec.barangay : rec.municipality;
      var size = fmt(rec.lotArea) + " sqm lot" + (rec.floorArea > 0 ? " · " + fmt(rec.floorArea) + " sqm floor" : "");
      var rate = money(rec.pricePerSqmLot) + "/sqm" + (rec.ratioToBir ? " · " + fmt(rec.ratioToBir) + "× BIR" : "");
      var src = (BANK_LABEL[rec.source] || rec.source) + " · " + (PRICE_LABEL[rec.priceType] || rec.priceType) + " · " + shortDate(rec.observedOn) + (rec.tag ? " · " + rec.tag + (rec.source === "bpi" ? " tag" : "") : "") + (rec.note ? " · " + rec.note : "") + (rec.carriedOver ? " · from last month" : "");
      var title = rec.project || String(rec.address || "").split(/,?\s+(?:Barangay|Brgy\.?)\s/i)[0].slice(0, 70) || rec.propertyType;
      return '<article class="sf-est-bank-record"><h5>' + esc(title) + '</h5>' +
        '<p class="sf-est-bank-price"><b>' + money(rec.price) + '</b> <span>' + esc(rate) + '</span></p>' +
        '<p class="sf-est-rdp">' + esc(place + " · " + size + " · " + rec.propertyType) + '</p>' +
        '<p class="sf-est-bank-src">' + esc(src) + (/^https:\/\//.test(rec.url || "") ? ' · <a href="' + esc(rec.url) + '" target="_blank" rel="noopener noreferrer">source list</a>' : '') + '</p></article>';
    }).join("");
    return '<div class="sf-est-bank" data-est-bank>' + head + '<div class="sf-est-bank-list">' + cards + '</div>' +
      '<p class="sf-est-rdp">Bank and Pag-IBIG prices are "as is, where is": title, possession or repair issues are common. Bank figures are advertised prices and Pag-IBIG figures are minimum bids (2nd-auction and negotiated-sale properties can go up to 30% or 45% below them) - none are completed sales. They are shown for context and do not change the estimate. Refreshed monthly' + (n.generatedOn ? ' (last ' + esc(shortDate(n.generatedOn)) + ')' : '') + '; sold or withdrawn properties are removed.</p></div>';
  }

  function evidenceHtml(r) {
    var c = r.comparableSummary || {}, indication = r.askingIndication;
    var out = '<p class="sf-est-rdp">' + Number(c.count || 0) + ' context record(s); ' + Number(c.eligibleCount || 0) + ' passed the provisional asking screen. ' + esc(c.policy || "") + '</p>';
    if (indication) out += '<div class="sf-est-asking-indication"><h5>Local asking-price indication</h5><b>' + money(indication.value) + '</b><p>Observed asking spread ' + money(indication.low) + ' – ' + money(indication.high) + '. ' + esc(indication.method) + '. ' + esc(indication.basis) + '.</p>' + (indication.spreadWarning ? '<p>Wide observed spread: review property differences before using this indication.</p>' : '') + '</div>';
    else out += '<p class="sf-est-rdp">Insufficient qualified asking evidence for a numerical indication. The factor guide is not calibrated to achieved sales.</p>';
    if (c.rejected && c.rejected.length) out += '<ul class="sf-est-rdl">' + c.rejected.slice(0, 8).map(function (row) { return '<li>' + esc((row.id || "Record") + ': ' + row.reasons.join('; ')) + '</li>'; }).join("") + '</ul>';
    out += '<p class="sf-est-rdp">Search status: ' + esc((r.evidenceRetrieval || []).map(function (status) { return status.source + ': ' + status.status; }).join(' · ') || "No live asking search supplied") + '. Failed or limited searches do not establish market scarcity.</p>';
    return out + '<details class="sf-est-project-context"><summary>Published project specifications and price context</summary>' + projectContextHtml(r.municipality) + '</details>' + benchmarkContextHtml(r);
  }

  function pricingStrategyHtml(r, suppliedTax) {
    var tax = suppliedTax || costsFor(r, DATA.config);
    var qualifier = '<p class="sf-est-rdp"><b>How to read these figures:</b> the lower end and midpoint are guide calculations, not guaranteed buyer offers. ' +
      (r.marketGuideAvailable ? "Comparable asking listings are shown as context; their prices are not direct calculation inputs." : "No comparable listings were available for this estimate; it uses the disclosed BIR-based factors.") + '</p>';
    {
      return '<div class="sf-est-pricing-grid">' +
        '<div class="sf-est-price-card sf-est-price-floor"><span>Lower end of guide range</span><b>' + money(r.low) + '</b><small>A reference point for reviewing offers—not a guaranteed minimum.</small></div>' +
        '<div class="sf-est-price-card sf-est-price-sweet"><span>Central planning estimate</span><b>' + money(r.marketGuideEstimate) + '</b><small>The disclosed factor-based estimate (100%).</small></div>' +
        '<div class="sf-est-price-card sf-est-price-tax"><span>Transaction taxes &amp; fees</span><b>' + (tax.total == null ? "Quotation required" : money(tax.total)) + '</b><small>' + (tax.quotationRequired ? "Quoted developer charges only; taxes not added twice." : "CGT, DST, transfer and estimated registration; broker/notary excluded.") + '</small></div>' +
        '<div class="sf-est-price-card sf-est-price-cash"><span>After all transaction costs</span><b>' + (tax.netAfterAllTransactionCosts == null ? "Not determined" : money(tax.netAfterAllTransactionCosts)) + '</b><small>Private-resale illustration assumes all four costs are paid from price; before broker/notary.</small></div>' +
        '</div>' + qualifier;
    }
  }

  function unlockPricing() {
    var root = typeof document !== "undefined" ? document.querySelector("[data-est-screen=\"4\"]") : null;
    if (!root || !est.result) return;
    var pricing = root.querySelector("[data-est-pricing-body]");
    if (pricing) pricing.innerHTML = pricingStrategyHtml(est.result);
    var asking = root.querySelector("[data-est-asking-block]");
    if (asking) asking.outerHTML = askingPriceHtml(est.result);
  }

  /* Replace the lead block in place once the request is accepted. A full
   * re-render here would discard the form and its status line, so the swap is
   * done on the existing node. Also removes the "next step" card, which has
   * nothing left to ask for.
   *
   * The status message is carried INTO the confirmation rather than dropped:
   * it tells the user what happens next (a call, then the report). */
  function showLeadConfirmation(message) {
    var root = typeof document !== "undefined" ? document.querySelector("[data-est-screen=\"4\"]") : null;
    if (!root) return;
    var nextStep = root.querySelector(".sf-est-nextstep");
    if (nextStep && nextStep.parentNode) nextStep.parentNode.removeChild(nextStep);
    var lead = root.querySelector("[data-est-lead]");
    if (!lead) return;
    lead.innerHTML = '<div class="sf-est-lead-done" data-est-lead-status role="status">' +
      '<span class="sf-est-lead-done-icon" aria-hidden="true">✓</span>' +
      "<div><b>Request received &mdash; thank you.</b>" +
      "<p>" + esc(message || "A specialist will verify your inputs against the current BIR schedule and contact you within one business day.") + "</p>" +
       "<p class=\"sf-est-lead-done-next\">Your guide remains available above. A request is not confirmation of a professional review.</p>" +
      "</div></div>";
  }

  function reportSections(r) {
    var tax = costsFor(r, DATA.config);
    /* Resolved once per render for the same reason as the result summary: the
     * build-up below is one concatenation, and the copy is owned by
     * js/value_guide_reference.js so it cannot drift between surfaces. A null
     * disclosure (time-indexed, or no usable multiple) emits no paragraphs at
     * all - see the note on resultSummaryHtml. */
    var multipleDisclosure = referenceTools.appliedMultipleDisclosure(r);
    var multipleNoteHtml = multipleDisclosure
      ? '<p class="sf-est-multiple-note">' + esc(multipleDisclosure.multipleLabel) + " — <b>" + esc(multipleDisclosure.text) + "</b>. " + esc(multipleDisclosure.assumption) + "</p>" +
        '<p class="sf-est-multiple-limit">' + esc(multipleDisclosure.limitation) + "</p>"
      : "";
    var comparableNote = r.marketGuide && r.marketGuide.comparableCount
      ? " " + r.marketGuide.comparableCount + " comparable asking listing(s) from " + r.marketGuide.sourceType + " were found for context. Their asking prices are not direct inputs to this factor-based calculation."
      : " No comparable asking listings were available. This estimate uses the displayed BIR reference and SEA ESTATES factors only.";
    var s = [];

var displayRange = '';
    var displayPerSqm = r.perSqm;
    var askingPriceBlock = askingPriceHtml(r);
    s.push({ t: "Estimate at a glance", h:
      '<div class="sf-est-bir-primary"><span>' + esc(r.birReferenceLabel) + '</span><b>' + money(r.birZonalValue) + '</b><small>' + money(r.birZonalRatePerSqm) + '/sqm · ' + (r.birReferenceConfirmed ? "tax reference, not a buyer price" : "derived fallback; excluded from confirmed tax-floor inputs") + '</small></div>' +
      displayRange +
      '<p class="sf-est-per">≈ ' + money(displayPerSqm) + " /sqm of lot on " + fmt(r.area) + " sqm" + (r.kind && r.type === "house_lot" ? " · " + fmt(r.floorArea) + " sqm floor area" : "") + "</p>" +
       askingPriceBlock +
       '<p class="sf-est-rdp">SEA ESTATES is independent of the BIR. BIR schedule values are shown as a tax reference; the estimate is a guide-based starting point. A site and document review can refine it using the property condition and local market evidence.</p>' });

    s.push({ t: "Pricing strategy", h: '<div data-est-pricing-body>' + pricingStrategyHtml(r, tax) + '</div>' });

    s.push({ t: "The property", h:
      "<ul class=\"sf-est-rdl\">" +
      "<li>Purpose: <b>" + esc(r.purpose || "—") + "</b></li>" +
      "<li>Type: <b>" + esc(r.typeLabel) + "</b></li>" +
      "<li>Municipality: <b>" + esc(titleCase(r.municipality)) + "</b></li>" +
      "<li>Barangay: <b>" + esc(r.barangay) + "</b></li>" +
      "<li>Street: <b>" + esc(r.streetName ? r.streetName : "Street not listed") + "</b></li>" +
      "<li>Lot area: <b>" + fmt(r.area) + " sqm</b>" + (r.corner.applied ? " · corner lot (+2.5%)" : "") + "</li>" +
       "</ul>" });

    s.push({ t: "Ownership & title review", h:
      '<ul class="sf-est-rdl"><li>Occupancy: <b>' + esc(ownershipLabel("occupancy", r.ownership.occupancy)) + '</b></li>' +
      '<li>Title status: <b>' + esc(ownershipLabel("titleStatus", r.ownership.titleStatus)) + '</b></li>' +
      '<li>Inheritance: <b>' + esc(ownershipLabel("inheritanceStatus", r.ownership.inheritanceStatus)) + '</b></li>' +
      '<li>Deduction applied: <b>' + (r.ownershipAdjustmentPct ? "−" + r.ownershipAdjustmentPct + "% of the total" : "none") + '</b></li></ul>' +
      '<p class="sf-est-rdp">' + esc(r.conditions) + ' Verify documents, possession and any actual remediation costs before relying on a transaction figure.</p>' });

    s.push({ t: "How this number was built", h: provenanceHtml(r) });
    if (r.timeIndex) s[s.length - 1].h = timeResultHtml(r) + '<p class="sf-est-rdp">Building allowances and depreciation remain separate.</p>';

    s.push({ t: "Source of land rates", h:
      "<p class=\"sf-est-rdp\">Official BIR zonal schedule <b>" + esc(r.reference.schedule) + "</b>, RDO " + esc(r.rdo) +
      " (DO " + esc(r.departmentOrder) + ", " + esc(r.revision) + "). Data version <b>" + esc(r.dataVersion) + "</b>, calculation " + esc(r.calculationVersion) + ".</p>" +
      referenceStatusHtml(r) + '<p class="sf-est-rdp">Guide generated on <b>' + esc(todayLabel()) + '</b>. Generation date is not successful applicability verification.</p>' });

    s.push({ t: "BIR classification used", h:
      "<p class=\"sf-est-rdp\"><b>" + esc(r.classification + (r.classificationLabel ? " — " + r.classificationLabel : "")) + "</b>. Use group: " + esc(r.use) + ". Coverage: " + esc(r.coverage) + ".</p>" });

    s.push({ t: "How precise is this match?", h:
      "<ul class=\"sf-est-rdl\"><li>Source match: <b>" + esc(r.source.label) + "</b>; match depth is not a valuation accuracy score.</li>" +
      (r.fallbackNote ? "<li>" + esc(r.fallbackNote) + "</li>" : "") +
      (r.planningReference ? "<li>" + esc(r.planningReference.note) + "</li>" : "") + "</ul>" });

    s.push({ t: "Land value build-up", h:
      '<div class="sf-est-breakdown">' +
      "<span>" + money(r.reference.value) + "/sqm BIR base</span><i>×</i>" +
      "<span>Corner " + (r.corner.applied ? "+" + String(Math.round(r.corner.pct * 1000) / 10) + "%" : "no") + "</span><i>×</i>" +
      "<span>" + r.use + " " + r.factors.proxyFactor.toFixed(2) + "</span><i>×</i>" +
      "<span>Market band " + r.factors.bandMid.toFixed(2) + "</span><i>×</i>" +
      "<span>Region " + r.factors.regionalAdj.toFixed(2) + "</span>" +
      "</div>" +
      '<p class="sf-est-coverage">Effective land rate <b>' + money(r.landPerSqm) + " /sqm</b> × " + fmt(r.area) +
      " sqm = <b>" + money(r.landBeforeAdjustments != null ? r.landBeforeAdjustments : r.landValue) + "</b>" +
      ((r.landBeforeAdjustments != null && r.landBeforeAdjustments !== r.landValue)
        ? ", then " + ((Number(r.lotSizeFactor) || 1) < 1 ? "large-lot × " + Number(r.lotSizeFactor).toFixed(3) + " and " : "") +
          "site answers " + (((r.siteAdjustment && r.siteAdjustment.pct) || 0) >= 0 ? "+" : "−") + Math.abs((r.siteAdjustment && r.siteAdjustment.pct) || 0) + "%" +
          (r.townCalibration ? " and town correction × " + r.townCalibration.factor.toFixed(3) : "") + " = <b>" + money(r.landValue) + "</b>"
        : "") + " land value.</p>" +
      multipleNoteHtml });
    if (r.timeIndex) s[s.length - 1].h = timeResultHtml(r);

    if (r.type === "house_lot") {
      s.push({ t: "House value (replacement cost approach)", h:
        "<ul class=\"sf-est-rdl\">" +
        "<li>Construction: <b>≈ " + money(r.buildCostPerSqm) + "/sqm</b> on " + fmt(r.floorArea) + " sqm floor area</li>" +
        /* No storeys multiplier is printed. It used to read "Storeys: ×1.05", which
           invited the reader to believe storeys were counted a second time on top of
           an area already measured across all of them. They are not: floorArea is a
           single total, so the factor has been removed rather than hidden. */
        "<li>Age band midpoint <b>" + r.ageMidpoint + " yrs</b>, depreciation <b>" + r.depreciatedPct + "%</b></li>" +
        "<li>Improvements itemised: <b>" + (r.featuresTotal > 0 ? money(r.featuresTotal) : "none") + "</b></li>" +
        "<li>House value: <b>" + money(r.improvement) + "</b></li>" +
        "</ul>" });
    } else {
      s.push({ t: "House value", h: "<p class=\"sf-est-rdp\">Vacant lot — valued on land only; no improvement included in this estimate.</p>" });
    }

    s.push({ t: "Total estimate and range", h:
      "<p class=\"sf-est-rdp\"><b>" + money(r.marketGuideEstimate) + "</b> · guide range <b>" + money(r.low) + " – " + money(r.high) +
        "</b> (85%–130% planning scenarios, not a statistical confidence interval). ≈ <b>" + money(r.perSqm) + "</b>/sqm.</p>" });

    s.push({ t: "Coverage and limitations", h:
      "<p class=\"sf-est-rdp\">The BIR figure is matched street-by-street; where a street has no listed rate for a classification the engine falls back to the barangay all-other-streets rate, then municipality and province medians. The numerical estimate uses the BIR base, selected property-use and market-band factors, optional corner adjustment, and— for house-and-lot—replacement-cost and age-depreciation inputs. Comparable listing prices are shown as context and are not currently fed into the formula." + comparableNote + " Rows the BIR masked as “same as above” were resolved only when a municipality-wide rate existed — never guessed.</p>" });

    s.push({ t: "Taxes, fees & commissions", h: transactionHtml(r, tax) });

    s.push({ t: "Adjustments from your answers", h: adjustmentsHtml(r) });

    s.push({ t: "Methodology", h:
      "<p class=\"sf-est-rdp\">The same inputs and data version produce the same calculation. The report shows the BIR reference, applied factors, building-cost/depreciation calculation when relevant, and the resulting range. Listing prices provide context only; they do not directly determine this estimate.</p>" });

    s.push({ t: "Legal", h: '<p class="sf-est-disclaimer">' + esc(r.disclaimer) + "</p>" });

    s.push({ t: "Professional review", h:
      "<p class=\"sf-est-rdp\"><b>Request a site and document review.</b> A licensed real estate appraiser can review property condition, title, and current local evidence for a formal valuation assignment. The guide itself is a planning estimate.</p>" });
    s.push({ t: "Asking evidence and project sources", h: evidenceHtml(r) });
    s.push({ t: "Bank & Pag-IBIG listings near you", h: bankListingsHtml(r) });

    var groups = [
      { t: "Summary", titles: ["Estimate at a glance", "Pricing strategy", "The property"] },
      { t: "Calculation", titles: ["How this number was built", "Land value build-up", "House value (replacement cost approach)", "House value", "Ownership & title review", "Adjustments from your answers", "Total estimate and range"] },
      { t: "Transaction costs", titles: ["Taxes, fees & commissions"] },
      { t: "Market evidence", titles: ["Bank & Pag-IBIG listings near you", "Source of land rates", "BIR classification used", "How precise is this match?", "Asking evidence and project sources"] },
      { t: "Documents and next steps", titles: ["Professional review"] },
      { t: "Methodology and limitations", titles: ["Methodology", "Coverage and limitations", "Legal"] }
    ];
    return groups.map(function (group) {
      var html = s.filter(function (section) { return group.titles.indexOf(section.t) >= 0; }).map(function (section) { return '<section class="sf-est-report-group"><h5>' + esc(section.t) + '</h5>' + section.h + '</section>'; }).join("");
      if (group.t === "Documents and next steps") html += '<p class="sf-est-rdp">Prepare the title (TCT/OCT), current tax declaration, real-property tax clearance, valid IDs and TIN. Confirm any authority to sell, spousal consent, inheritance settlement and financing documents that apply.</p><p class="sf-est-rdp">General sequence: execute the deed, settle applicable BIR taxes, obtain CAR, pay local transfer tax, register the title and update the tax declaration. CGT: generally 30 days from the transaction; DST: generally 10 days after the close of the document month; transfer: generally 60 days. Confirm the applicable rules with the receiving office.</p>';
      return { t: group.t, h: html };
    });
  }

  /* What the figure assumed, beside the figure, each with a way to change it
     (review item 25). */
  function assumptionsHtml(r) {
    var rows = [];
    var where = r.planningReference ? "Street not listed: the barangay's typical listed-street rate is used"
      : est.allOther ? "Street not listed: the barangay's all-other-streets rate is used"
      : r.streetName ? "On " + titleCase(r.streetName)
      : "Barangay rate (no street chosen)";
    rows.push({ text: where, screen: 1, label: "Change location" });
    if (r.improvement > 0) {
      var typical = !(Number(est.floorArea) > 0);
      rows.push({ text: "House of " + fmt(r.floorArea) + " sqm" + (typical ? " (typical for this lot size)" : "") + ", " + String(labelFor(DATA.config, "ageBands", est.ageBand)).toLowerCase() + " old", screen: 2, label: "Change house details" });
    }
    if (est.classification && est.classification !== "RR") rows.push({ text: classificationLabelShort() + " land", screen: 1, label: "Change classification" });
    return '<div class="sf-est-assume"><p class="sf-est-assume-title">This figure assumes</p><ul>' + rows.map(function (row) {
      return '<li><span>' + esc(row.text) + '</span><button type="button" class="sf-est-assume-edit" data-est-edit="' + row.screen + '" aria-label="' + esc(row.label) + '">Change</button></li>';
    }).join("") + '</ul></div>';
  }

  /* Plain meanings for the words the result uses (review item 24). */
  function termsHtml() {
    return '<details class="sf-est-terms"><summary>What do these terms mean?</summary><dl>' +
      '<div><dt>BIR zonal value</dt><dd>The government\'s published land rate per sqm, used to compute taxes. It is a reference, not a selling price.</dd></div>' +
      '<div><dt>Planning range</dt><dd>Where a sale would usually land: 85% to 130% of the central figure. It is not a guaranteed offer.</dd></div>' +
      '<div><dt>Classification</dt><dd>How the BIR groups land by use: residential, commercial, agricultural or industrial.</dd></div>' +
      '<div><dt>All other streets</dt><dd>The BIR rate for streets in a barangay that its list does not name.</dd></div>' +
      '</dl></details>';
  }

  function resultSummaryHtml(r) {
    var bankN = (DATA && DATA.bankComparables && !DATA.bankComparables.unavailable && r.municipality)
      ? evidence.bankNearby(DATA.bankComparables, { municipality: r.municipality, barangay: r.barangay, type: r.type, area: r.area, landPerSqm: r.landPerSqm, total: r.total }).total : 0;
    var badge = r.marketGuideAvailable ? "Local listing context found" : bankN ? "Factor-based · bank listings for context" : "Factor-based · no comparable listings";
    var context = r.marketGuideAvailable
      ? (r.marketGuide.comparableCount || 0) + " comparable asking listing(s) found for context; listing prices are not direct inputs to this calculation."
      : (bankN ? "No resale asking listings were found to compare; this estimate uses the disclosed BIR-based factors, with bank and Pag-IBIG prices shown for context."
        : "No comparable asking listings were available; this estimate uses the disclosed BIR-based factors.");
    /* The BIR zonal reference and the market estimate are printed one after the
     * other with nothing connecting them, so the factor that connects them is
     * named here. Every word comes from referenceTools.appliedMultipleDisclosure;
     * this module never restates the assumption or the limitation, so the result
     * screen and the report build-up cannot word it two different ways.
     *
     * Resolved ONCE, above the concatenation. This screen is assembled by string
     * concatenation, so calling the builder per interpolated field would rebuild
     * the disclosure once per field.
     *
     * The guard is the honest part: appliedMultipleDisclosure refuses every land
     * method other than "factor" (time-indexed applies no factor stack at all),
     * so a null disclosure must leave nothing behind - not an empty element, not
     * "0x the BIR reference". */
    var multipleDisclosure = referenceTools.appliedMultipleDisclosure(r);
    var multipleHtml = multipleDisclosure
      ? '<div class="sf-est-result-multiple"><b>' + esc(multipleDisclosure.multipleLabel) + '</b><span>' + esc(multipleDisclosure.text) + '</span><small>' + esc(multipleDisclosure.assumption) + '</small></div>'
      : "";
return '<section class="sf-est-result-summary" aria-label="Estimated property value">' +
      '<div class="sf-est-result-summary-head"><div><p class="sf-est-result-summary-label">ESTIMATED PROPERTY VALUE</p><h4>' + (r.landMethod === "time-indexed" ? 'Indexed-reference planning scenario' : 'Central planning estimate') + '</h4></div>' +
      '<span class="sf-est-result-evidence">' + badge + '</span></div>' +
      '<strong class="sf-est-result-value">' + money(r.marketGuideEstimate) + '</strong>' +
      '<p class="sf-est-scenario-range">Planning range <b>' + money(r.low) + ' – ' + money(r.high) + '</b><span>85%–130% scenarios, not guaranteed offers or statistical confidence.</span></p>' +
      /* The two numbers that make the estimate, then the bank line; the method
         notes (BIR card, multiple, context, reference status, independence) sit
         under one disclosure so the card reads as an answer, not a document. */
      '<dl class="sf-est-result-split"><div><dt>Land</dt><dd>' + money(r.landValue) + '</dd></div>' +
        (r.improvement > 0 ? '<div><dt>House</dt><dd>' + money(r.improvement) + '</dd></div>' : '') +
        '<div><dt>Per sqm of lot</dt><dd>' + money(r.perSqm) + '</dd></div></dl>' +
      assumptionsHtml(r) +
      bankSummaryLineHtml(r) +
      termsHtml() +
      '<details class="sf-est-result-more"><summary>How this number is worked out</summary>' +
      '<div class="sf-est-result-bir"><span>' + esc(r.birReferenceLabel) + '</span><b>' + money(r.birZonalValue) + '</b><small>' + money(r.birZonalRatePerSqm) + '/sqm · ' + (r.birReferenceConfirmed ? "tax-reference figure, separate from the estimate" : "derived fallback, not confirmed parcel tax FMV") + '</small></div>' +
      multipleHtml +
      (r.planningReference ? '<p class="sf-est-result-context" data-est-planning-ref>' + esc(r.planningReference.note) + '</p>' : '') +
      '<p class="sf-est-result-context">' + context + '</p>' +
      '<p class="sf-est-result-reference-label"><b>' + esc(r.referenceVerification.label) + '</b> — published values unchanged; indexing is a separate scenario.</p>' +
      '<p class="sf-est-result-bir-note">SEA ESTATES is independent of the BIR. Confirm the applicable schedule with the relevant Revenue District Office.</p>' +
      '</details>' +
      '</section>';
  }

  function screen4Html() {
    var r = est.result;
    if (!r || !r.available) return unavailableHtml();
    var selling = r.purpose === "Selling";
    var out = '<div class="sf-est-step sf-est-result-screen' + (selling ? " sf-est-selling-result" : "") + '" data-est-screen="4" data-est-purpose="' + esc(r.purpose || "") + '">';
    out += locSummary();
    /* Answer first: one heading line naming the property, then the price.
       The data provenance that used to sit above the price (source tiles,
       schedule note, "analysis complete") is folded into one disclosure
       below it - the same facts, no longer between the reader and the number. */
    var typeWord = r.type === "vacant_lot" ? "vacant lot" : (r.typeLabel || "property").toLowerCase();
    out += '<div class="sf-est-result-head"><h3 id="sf-est-result-heading" tabindex="-1">Your Value Guide</h3>' +
      '<p class="sf-est-result-for">For a ' + fmt(r.area) + ' sqm ' + esc(typeWord) + ' in ' + esc(titleCase(r.barangay)) + ', ' + esc(titleCase(r.municipality)) + ' · ' + esc(r.classificationLabel || r.classification) + '</p></div>';
    out += resultSummaryHtml(r);
    var nextScheduleCheck = manifest() && manifest().provenance && manifest().provenance.nextCurrencyReview;
    var lastScheduleCheck = manifest() && manifest().provenance && manifest().provenance.lastAttemptedCheck;
    /* The schedule date is years old by design: zonal values stay in force
       until a newer Department Order supersedes them, so the date is framed as
       the start of an ongoing effectivity and the active re-check cycle is
       stated beside it. Without this the raw 2022 date reads as stale data. */
    out += '<details class="sf-est-result-sources"><summary>Where the numbers come from</summary>' +
      '<div class="sf-est-result-data"><div><b>BIR source match</b><small>' + esc(r.source.label) + '</small></div><div><b>BIR schedule in effect since</b><small>' + esc(r.effectivityDate) + '</small></div><div><b>Dataset version</b><small>' + esc(r.dataVersion) + '</small></div></div>' +
      '<p class="sf-est-result-data-note">BIR zonal values remain in force until a newer Department Order supersedes them.' +
      (lastScheduleCheck ? ' This is the latest schedule we could find (checked ' + esc(lastScheduleCheck) + ') but it is not yet confirmed with BIR.' : '') + (nextScheduleCheck ? ' Batangas schedules are re-checked every 30 days; next review ' + esc(nextScheduleCheck) + '.' : '') + '</p></details>';
    /* Placed here, not at the foot of the page: the user has just seen their
     * number and the evidence behind it, which is when the next-step question
     * forms. The bottom CTA still exists for people who read to the end.
     * The decision card (net proceeds / budget) follows it (review item 22). */
    out += nextStepCard();
    out += decisionHtml(r);
    out += '<p class="sf-est-report-label">Full report <span>Every figure, source and limitation behind the estimate</span></p>';
    out += '<div class="sf-est-report">';
    reportSections(r).forEach(function (sec, i) {
      out += '<details class="sf-est-rsec"' + (i === 0 ? " open" : "") + '>' +
        '<summary class="sf-est-rsec-head"><h4>' + esc(sec.t) + "</h4><span class=\"sf-est-rsec-toggle\" aria-hidden=\"true\"></span></summary>" +
        '<div class="sf-est-rsec-body">' + sec.h + "</div></details>";
    });
    out += "</div>";
    out += '<div class="sf-est-actions"><button type="button" class="sf-est-next sf-est-prev" data-est-prev>Adjust my answers</button></div>';
    out += leadBlock(r);
    return out + "</div>";
  }

  function unavailableHtml() {
    var r = est.result || {};
    return '<div class="sf-est-unavail sf-est-step" data-est-screen="4">' +
      '<span class="sf-est-tag sf-est-tag-unavailable">Unavailable</span>' +
      "<h3>No estimate available yet" + (est.municipality ? " for " + esc(titleCase(est.municipality)) : "") + "</h3>" +
      "<p>" + esc(unavailableReason(r.reason)) + "</p>" +
      '<div class="sf-est-actions"><button type="button" class="sf-est-next sf-est-prev" data-est-prev>← Back to property details</button>' + (r.reason === "connection" ? '<button type="button" class="sf-est-next" data-est-calc-retry>Retry calculation</button>' : "") + '</div>' +
      "</div>";
  }

  function unavailableReason(reason) {
    if (reason === "no-data") return "The official BIR schedule for this municipality does not publish a rate for the classification you chose, and no municipality or province median exists for it either. We don't guess — pick another classification, or ask us for an on-ground check.";
    if (reason === "municipality-not-found") return "That municipality is not in the imported BIR set.";
    if (reason === "integrity-fail") return "The calculation could not be reconciled and was stopped.";
    if (reason === "connection") return "The reference data could not be loaded. Your inputs are retained; check your connection and retry.";
    if (reason === "time-evidence-unavailable") return "No applicable reviewed local land-price history is available. Choose an explicit manual assumption or return to the factor guide.";
    if (reason === "time-integrity-fail") return "The time scenario exceeded supported numeric precision and was stopped.";
    if (/^invalid-/.test(reason || "")) return "One or more inputs are invalid or unsupported (" + reason + "). Review areas, categories, price and quoted costs before calculating.";
    return "Make sure you chose a municipality, barangay, classification and a lot area above.";
  }


  function coverageTag(coverage) {
    var label = coverage === "limited" ? "Limited data" : coverage === "unavailable" ? "Unavailable" : "BIR street data";
    return '<span class="sf-est-tag sf-est-tag-' + esc(coverage || "good") + '">' + label + "</span>";
  }

  /* The primary conversion block.
   *
   * It used to live at the very bottom of the screen, below sixteen report
   * sections, so the only ways to reach it were a button buried inside a
   * collapsed accordion or a long scroll. The persuasive panel near the top had
   * no button at all. This block sits directly under the analysis summary —
   * after the user has seen their number and the evidence, which is the moment
   * a "what do I do next" question actually forms.
   *
   * The consultation request carries no obligation to list, and a specialist
   * replies within one business day. Nothing about
   * response volume, ratings, or client counts is invented. */
  function nextStepCard() {
    if (est.leadSubmitted) return "";
    /* Inline outline icons on one 24px grid with a single stroke weight. Each
       sits beside its own visible label, so it is decorative and hidden from
       the accessibility tree. */
    function icon(body) {
      return '<svg class="sf-est-nextstep-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + "</svg>";
    }
    return '<div class="sf-est-nextstep">' +
      '<div class="sf-est-nextstep-head">' +
      '<span class="sf-est-nextstep-badge">No obligation to list</span>' +
      "<h4>What would you like to do next?</h4>" +
      '<p>Talk it through with our team, or keep a copy. Neither commits you to anything.</p>' +
      "</div>" +
      '<div class="sf-est-nextstep-grid">' +
      '<button type="button" class="sf-est-nextstep-tile" data-est-broker-open>' + icon('<path d="M4 7a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 7v6.5a2.5 2.5 0 0 1-2.5 2.5H12l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5V7Z"/><path d="M8.5 10.5h7"/>') + "<span><b>Talk to a licensed broker</b><small>Discuss selling, buying or marketing this property.</small></span><i class=\"sf-est-nextstep-go\" aria-hidden=\"true\">→</i></button>" +
      '<button type="button" class="sf-est-nextstep-tile" data-est-email-open>' + icon('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/>') + "<span><b>Get my full report</b><small>We call to confirm your details, then email the report.</small></span><i class=\"sf-est-nextstep-go\" aria-hidden=\"true\">→</i></button>" +
      "</div>" +
      '<button type="button" class="sf-est-nextstep-more" data-est-lead-open>Need a formal valuation? Request an appraisal consultation</button>' +
      '<p class="sf-est-nextstep-reassure">Your results are open above. A specialist replies within one business day.</p>' +
      "</div>";
  }

  function leadBlock(r) {
    var out = '<div class="sf-est-lead" data-est-lead>';
    var leadValue = "factor-based estimate " + money(r.marketGuideEstimate) + (r.marketGuideAvailable ? " · local asking listings shown as context" : " · no comparable listings available");
    if (est.leadSubmitted) {
      return out + '<div class="sf-est-lead-done">' +
        '<span class="sf-est-lead-done-icon" aria-hidden="true">✓</span>' +
        "<div><b>Request received &mdash; thank you.</b>" +
        "<p>Your request has been received. Your guide remains available above.</p>" +
        "</div></div></div>";
    }
    out += '<div class="sf-est-lead-ctas">' +
      '<button type="button" class="sf-est-lead-cta alt" data-est-lead-open><span class="sf-est-cta-icon" aria-hidden="true">✓</span>Request an appraisal consultation →</button>' +
      '<button type="button" class="sf-est-lead-cta alt" data-est-broker-open><span class="sf-est-cta-icon" aria-hidden="true">✓</span>Talk to a licensed broker →</button></div>';
    if (est.leadOpen) {
      var leadTitle = est.leadKind === "broker" ? "Talk to a licensed broker" : est.leadKind === "appraisal" ? "Request an appraisal consultation" : "Get my full report";
      var leadReassure = est.leadKind === "broker"
        ? "A licensed broker will contact you about selling, buying, or marketing this property. No obligation."
        : est.leadKind === "appraisal"
          ? "No obligation to list. A specialist replies within one business day."
          : "We'll call you to confirm your details, then email your report. No other follow-up unless you ask.";
      out += '<form class="sf-est-lead-form" data-est-lead-form>' +
        "<h3>" + leadTitle + "</h3>" +
        '<p class="sf-est-lead-ctx">For: <b>' + esc(titleCase(est.municipality) + " · " + titleCase(est.barangay) + (est.streetLabel && !est.allOther ? " · " + est.streetLabel : "")) + "</b> · " + leadValue + ".</p>" +
        '<p class="sf-est-lead-reassure">' + leadReassure + '</p>' +
        '<div class="sf-est-lead-grid">' +
        '<label>Full name<input name="name" autocomplete="name" required maxlength="160" placeholder="Your name"></label>' +
        '<label>Email<input type="email" name="email" autocomplete="email" required maxlength="254" placeholder="you@email.com"></label>' +
        /* Required on every path: the team calls to confirm details before
           any report is sent. */
        '<label>Phone<input name="phone" type="tel" autocomplete="tel" required maxlength="50" placeholder="Mobile number"></label>' +
        '<label>Message<textarea name="message" maxlength="600" rows="3">' + (est.leadKind === "broker" ? "I’m interested in buying or selling this Batangas property." : est.leadKind === "appraisal" ? "I’m interested in an appraisal consultation for this property." : "I’m interested in this Batangas property estimate.") + '</textarea></label>' +
        "</div>" +
        '<label class="sf-consent"><input type="checkbox" name="consent" required><span>I consent to SEA ESTATES calling me to confirm these details, emailing my report, and contacting me about this request. See our <a href="#/privacy">Privacy Notice</a>.</span></label>' +
        '<button type="submit">' + (est.leadKind === "broker" ? "Request broker contact →" : est.leadKind === "appraisal" ? "Send my consultation request →" : "Request my report →") + '</button>' +
        '<p class="sf-form-status" data-est-lead-status aria-live="polite"></p></form>';
    }
    return out + "</div>";
  }

  /* ---------------------------------------------------------- */
  /*  render + bind                                              */
  /* ---------------------------------------------------------- */

  function renderLayout() {
    var out = "";
    if (est.screen === 1) out = screen1Html();
    else if (est.screen === 2) out = screen2Html();
    else if (est.screen === 3) out = screen3Html();
    else out = screen4Html();
    var card = getCard();
    if (card) {
      /* The whole card is re-rendered on many in-screen interactions, so the
         entrance class is only added when the SCREEN changes - a fade on every
         chip tap would flicker. */
      var screenChanged = est.screen !== lastRenderedScreen;
      lastRenderedScreen = est.screen;
      var stage = est.screen === 3 ? 3 : est.screen;
      /* Three steps, matching the reference's Location -> Details -> Report
         progression. There is no review screen and the calculating screen is
         not a step: Details advances straight to the calculation. */
      var progress = '<ol class="sf-est-progress" aria-label="Value guide progress">' + ["Location", "Details", "Report"].map(function (label, i) { return '<li' + (stage === i + 1 ? ' aria-current="step"' : stage > i + 1 ? ' class="done"' : "") + '><b aria-hidden="true"></b><span>' + label + '</span></li>'; }).join("") + '</ol>';
      card.innerHTML = progress + out; bindCard(card);
      if (screenChanged) {
        var step = card.querySelector(".sf-est-step");
        if (step) step.classList.add("sf-est-enter");
      }
      if (est.validationIssue && (est.screen === 1 || est.screen === 2)) showErr(card, est.validationIssue);
    }
  }

  function revealEstimatorScreen() {
    var card = getCard();
    if (!card || !card.scrollIntoView) return;
    var screen = card.querySelector('[data-est-screen="' + est.screen + '"]') || card;
    // Align the step heading at the top of the viewport. Centering a long
    // details screen on mobile can leave the shorter calculating screen fully
    // above the viewport when renderLayout replaces the screen content.
    screen.scrollIntoView({ behavior: "instant", block: "start" });
    var bounds = screen.getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) {
      window.scrollTo(window.scrollX || 0, Math.max(0, window.scrollY + bounds.top - 16));
    }
    /* renderLayout() replaces the card's innerHTML, which destroys whichever
     * control had focus and drops document.activeElement to <body>. A keyboard
     * or screen-reader user then gets no indication that the step changed, and
     * Tab restarts from the top of the document. Move focus to the new step's
     * heading so the transition is announced — the same pattern the result
     * screen already uses for #sf-est-result-heading. */
    var heading = screen.querySelector("h3");
    if (heading) {
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      try { heading.focus({ preventScroll: true }); } catch (e) { heading.focus(); }
    }
  }

  function revealLeadForm() {
    var card = getCard();
    var form = card && card.querySelector("[data-est-lead-form]");
    if (!form) return;
    form.scrollIntoView({ behavior: "auto", block: "center" });
    var first = form.querySelector("input, textarea, select");
    if (first && first.focus) first.focus();
  }

  function $q(card, sel) { return card ? card.querySelector(sel) : null; }
  function $qa(card, sel) { return card ? Array.prototype.slice.call(card.querySelectorAll(sel)) : []; }

  function streetListHtml(filter) {
    var br = currentBarangay();
    var titles = streetTitles();
    var f = String(filter || "").toLowerCase().trim();
    var out = "";
    if (!br) return '<p class="sf-est-street-empty">Choose a barangay first.</p>';
    titles.filter(function (t) {
      if (!f) return true;
      return String(t.name).toLowerCase().indexOf(f) !== -1;
    }).slice(0, 50).forEach(function (t) {
      var active = t.key === est.streetKey && !est.allOther;
       out += '<button id="sf-est-street-option-' + esc(t.key).replace(/[^A-Za-z0-9_-]/g, "-") + '" type="button" role="option" class="sf-est-street-opt' + (active ? " active" : "") + '" aria-selected="' + (active ? "true" : "false") + '" data-est-street="' + esc(t.key) + '">' + esc(t.name) + "</button>";
    });
    out += '<button id="sf-est-street-option-all-other" type="button" role="option" class="sf-est-street-opt sf-est-street-all' + (est.allOther ? " active" : "") + '" aria-selected="' + (est.allOther ? "true" : "false") + '" data-est-street-all>Street not listed — use ALL OTHER STREETS rate →</button>';
    return out;
  }

function bindCard(card) {
    var self = this;
    /* Remember which "about this estimate" sections the reader opened. The
       toggle event does not fire for the `open` attribute present at parse
       time, so this records reader intent only - a panel that renderLayout
       force-opens (an invalid indexed scenario) is not silently pinned open. */
    $qa(card, "[data-est-panel]").forEach(function (panel) {
      panel.addEventListener("toggle", function () {
        est.openPanels[panel.getAttribute("data-est-panel")] = panel.open;
      });
    });
    $qa(card, "[data-est-time]").forEach(function (input) {
      input.addEventListener(input.tagName === "SELECT" ? "change" : "input", function () {
        var key = input.getAttribute("data-est-time"); est[key] = key === "timeAnnualPct" ? (input.value === "" ? null : Number(input.value)) : input.value; est.result = null;
        if (input.tagName === "SELECT" && key !== "timeEvidenceId") { renderLayout(); var next = getCard().querySelector('[data-est-time="' + key + '"]'); if (next) next.focus({ preventScroll: true }); }
      });
    });
var saleContext = $q(card, "[data-est-sale-context]");
    if (saleContext) saleContext.addEventListener("change", function () { est.saleContext = saleContext.value; est.result = null; renderLayout(); });
    var applyTrend = $q(card, "[data-est-time-apply-evidence]");
    if (applyTrend) applyTrend.addEventListener("click", function () {
      var trend = reviewedTrend();
      if (!trend) return;
      est.timeSource = "evidence";
      est.timeEvidenceId = trend.id;
      est.landMethod = "time-indexed";
      est.result = null;
      renderLayout();
      var base = $q(getCard(), '[data-est-time="timeBaseDate"]');
      if (base) base.focus({ preventScroll: true });
    });
    var condition = $q(card, "[data-est-condition]");
    if (condition) condition.addEventListener("change", function () { est.condition = condition.value; });
    $qa(card, "[data-est-cost]").forEach(function (input) { input.addEventListener("input", function () { var key = input.getAttribute("data-est-cost"), value = input.value === "" ? null : Number(input.value); est[key] = key === "brokerPct" ? (value == null ? .03 : value / 100) : value; est.result = null; }); });
    var fallback = $q(card, "[data-est-street-fallback]");
    if (fallback) fallback.addEventListener("click", function () {
      /* The classification (default Residential) survives: it is a property
         fact, not a location fact, so a street fallback must not clear it. */
      est.allOther = true; est.streetKey = ""; est.streetLabel = "";
      renderLayout(); var classification = getCard().querySelector("[data-est-class]"); if (classification) classification.focus();
    });
    var retryCalculation = $q(card, "[data-est-calc-retry]");
    if (retryCalculation) retryCalculation.addEventListener("click", runEstimate);
    $qa(card, "[data-est-email-open]").forEach(function (button) { button.addEventListener("click", function () { est.leadOpen = true; est.appraisalRequested = false; renderLayout(); revealLeadForm(); }); });
    $qa(card, "[data-chip-group]").forEach(function (group) {
      group.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-val]");
        if (!btn) return;
         $qa(group, "[data-val]").forEach(function (b) { b.classList.toggle("active", b === btn); b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });
      });
    });

    $qa(card, '[data-est-screen="1"] .sf-est-chips').forEach(function (group) {
      group.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-val]");
        if (!btn) return;
        var t = group.getAttribute("data-t");
        if (t === "purpose") est.purpose = btn.getAttribute("data-val");
        else if (t === "stage") est.stage = btn.getAttribute("data-val");
        else if (t === "type") est.type = btn.getAttribute("data-val");
        renderLayout();
      });
    });

    var quickEdit = $q(card, "[data-est-quick-edit]");
    if (quickEdit) quickEdit.addEventListener("click", function () {
      est.quickEdit = true;
      renderLayout();
      var m = getCard() && getCard().querySelector("[data-est-muni]");
      if (m) m.focus();
    });

    var muniSel = $q(card, "[data-est-muni]");
    if (muniSel) muniSel.addEventListener("change", function () {
      var v = muniSel.value;
      est.municipality = v;
      est.barangay = "";
      est.streetKey = "";
      est.streetLabel = "";
      est.allOther = false;
      est.result = null;
      var row = null;
      (DATA.index.municipalities || []).forEach(function (m) { if (m.name === v) row = m; });
      est.muniRow = row;
      if (!v) { est.muniData = null; est.municipalitySlug = ""; renderLayout(); return; }
      est.municipalitySlug = row ? row.slug : "";
      est.muniData = null;
      renderLayout();
      var slug = est.municipalitySlug;
      loadMunicipality(slug).then(function (md) {
        if (est.municipalitySlug !== slug) return;
        est.muniData = md;
        renderLayout();
      }).catch(function () {
        if (est.municipalitySlug !== slug) return;
        est.muniData = null;
        renderLayout();
        var currentCard = getCard();
        if (currentCard) {
          var problem = document.createElement("p"); problem.setAttribute("role", "alert"); problem.className = "sf-est-err"; problem.textContent = "Could not load municipality data. Your other inputs are retained.";
          var retry = document.createElement("button"); retry.type = "button"; retry.className = "sf-est-next"; retry.textContent = "Retry municipality data";
          retry.addEventListener("click", function () { var select = getCard().querySelector("[data-est-muni]"); if (select) select.dispatchEvent(new Event("change", { bubbles: true })); });
          currentCard.prepend(problem, retry);
        }
      });
    });

    var brSel = $q(card, "[data-est-barangay]");
    if (brSel) brSel.addEventListener("change", function () {
      est.barangay = brSel.value;
      est.streetKey = "";
      est.streetLabel = "";
      est.allOther = false;
      est.result = null;
      renderLayout();
    });

    var sq = $q(card, "[data-est-street-q]");
    if (sq) {
      var listEl = $q(card, "[data-est-street-list]");
      var refreshList = function () {
        if ((est.streetKey && normKey(sq.value) !== normKey(est.streetLabel)) || (est.allOther && sq.value.trim())) {
          est.streetKey = ""; est.streetLabel = ""; est.allOther = false; est.result = null;
          var codes = $q(card, "[data-est-class]"); if (codes) codes.innerHTML = simpleClassOptions();
        }
        if (listEl) {
          listEl.innerHTML = streetListHtml(sq.value);
          sq.setAttribute("aria-expanded", "true");
        }
      };
      sq.addEventListener("input", refreshList);
      sq.addEventListener("focus", function () {
        if (sq.hasAttribute("data-street-selection-focus")) {
          sq.removeAttribute("data-street-selection-focus");
          return;
        }
        refreshList();
      });
      sq.addEventListener("blur", function () {
        setTimeout(function () {
          if (listEl) listEl.innerHTML = "";
          sq.setAttribute("aria-expanded", "false");
          sq.removeAttribute("aria-activedescendant");
        }, 150);
      });
      sq.addEventListener("keydown", function (e) {
        var options = listEl ? $qa(listEl, '[role="option"]') : [];
        if (e.key === "Escape") {
          if (listEl) listEl.innerHTML = "";
          sq.setAttribute("aria-expanded", "false");
          sq.removeAttribute("aria-activedescendant");
          return;
        }
        if (!options.length || (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter")) return;
        var active = options.findIndex(function (option) { return option.classList.contains("keyboard-focus"); });
        if (e.key === "Enter") {
          if (active < 0 && options.length === 1) active = 0;
          if (active >= 0) { e.preventDefault(); options[active].click(); }
          return;
        }
        e.preventDefault();
        active = e.key === "ArrowDown" ? active + 1 : active - 1;
        if (active < 0) active = options.length - 1;
        if (active >= options.length) active = 0;
        options.forEach(function (option, index) { option.classList.toggle("keyboard-focus", index === active); });
        sq.setAttribute("aria-activedescendant", options[active].id);
        try { options[active].scrollIntoView({ block: "nearest" }); } catch (err) {}
      });
      // Keep the street picker closed until the user focuses or searches it.
      if (listEl) listEl.innerHTML = "";
    }

    // Keep the delegated handler on the estimator card. Search results are
    // replaced while typing, so per-button handlers would be lost.
    if (!card.dataset.estStreetDelegationBound) {
      card.dataset.estStreetDelegationBound = "1";
      var keepClassAfterStreetChange = function () {
        // A street switch changes which classifications apply. Keep the user's
        // selection only if it is still offered — silently wiping it was the
        // main reason "click estimate again" kept re-failing the gate.
        var keep = est.classification;
        var br = currentBarangay();
        var source = est.allOther ? (br && br.other) : (br && br.streets && br.streets[est.streetKey] && br.streets[est.streetKey].classes);
        var list = source ? Object.keys(source) : [];
        est.classification = list.indexOf(keep) !== -1 ? keep : "";
        est.classificationUse = est.classification ? useOfClassification(DATA && DATA.config, est.classification) : "";
      };
      card.addEventListener("click", function (e) {
        var st = e.target.closest ? e.target.closest("[data-est-street]") : null;
        if (st && !card.contains(st)) st = null;
        if (st) {
          est.streetKey = st.getAttribute("data-est-street");
          var t = currentBarangay();
          est.streetLabel = t && t.streets && t.streets[est.streetKey] ? (t.streets[est.streetKey].name || est.streetKey) : est.streetKey;
          est.allOther = false;
          keepClassAfterStreetChange();
          est.result = null;
           renderLayout();
           var selectedInput = $q(getCard(), "[data-est-street-q]");
           if (selectedInput) { selectedInput.setAttribute("data-street-selection-focus", ""); selectedInput.focus(); selectedInput.select(); }
          return;
        }
        var all = e.target.closest ? e.target.closest("[data-est-street-all]") : null;
        if (all && !card.contains(all)) all = null;
        if (all) {
          est.allOther = true;
          est.streetKey = "";
          est.streetLabel = "Street not listed";
          keepClassAfterStreetChange();
          est.result = null;
           renderLayout();
           var allInput = $q(getCard(), "[data-est-street-q]");
           if (allInput) { allInput.setAttribute("data-street-selection-focus", ""); allInput.focus(); allInput.select(); }
        }
      });
    }

    if (!card.dataset.estInvalidBound) {
      card.dataset.estInvalidBound = "1";
      var clearInvalid = function () {
        est.validationIssue = null;
        $qa(card, ".sf-est-invalid").forEach(function (el) { el.classList.remove("sf-est-invalid"); });
        $qa(card, "[aria-invalid]").forEach(function (el) { el.removeAttribute("aria-invalid"); });
      };
      card.addEventListener("change", clearInvalid, true);
      card.addEventListener("input", clearInvalid, true);
    }

    var classUseSel = $q(card, "[data-est-class-use]");
    if (classUseSel) classUseSel.addEventListener("change", function () {
      est.classificationUse = classUseSel.value;
      var codes = classCandidates().filter(function (c) { return useOfClassification(DATA && DATA.config, c) === est.classificationUse; });
      if (codes.indexOf(est.classification) === -1) est.classification = "";
      est.result = null;
      renderLayout();
    });

    var classSel = $q(card, "[data-est-class]");
    if (classSel) classSel.addEventListener("change", function () {
      est.classification = classSel.value;
      est.classificationUse = est.classification ? useOfClassification(DATA && DATA.config, est.classification) : selectedClassificationUse();
      est.result = null;
    });

    var areaIn = $q(card, "[data-est-area]");
    if (areaIn) areaIn.addEventListener("input", function () {
      est.area = Number(areaIn.value) > 0 ? Number(areaIn.value) : null;
      est.result = null;
    });
    var salePriceIn = $q(card, "[data-est-sale-price]");
    if (salePriceIn) salePriceIn.addEventListener("input", function () {
      est.salePrice = salePriceIn.value === "" ? null : Number(salePriceIn.value);
      est.result = null;
    });

    var corner = $q(card, "[data-est-corner]");
    if (corner) corner.addEventListener("change", function () {
      est.corner = corner.checked;
      est.result = null;
    });

    var floorIn = $q(card, "[data-est-floor]");
    if (floorIn) floorIn.addEventListener("input", function () { est.floorArea = floorIn.value; markUserSet("floorArea"); });

    $qa(card, "[data-est-feature]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var k = cb.getAttribute("data-est-feature");
        var idx = est.features.indexOf(k);
        if (cb.checked && idx === -1) est.features.push(k);
        if (!cb.checked && idx !== -1) est.features.splice(idx, 1);
      });
    });

    var floodGroup = {};
    $qa(card, '[data-est-screen="2"] .sf-est-chips').forEach(function (group) {
      group.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-val]");
        if (!btn) return;
        var t = group.getAttribute("data-t");
        /* The "Not sure" chip carries value "" so it clears the answer —
           unset, not "checked and found nothing". The screen re-renders so the
           active chip state (including the skip chip) matches the state. */
        var review = false;
        if (t) markUserSet(t);
        if (t === "floodRisk") { est.floodRisk = btn.getAttribute("data-val"); review = true; }
        else if (t === "community") { est.community = btn.getAttribute("data-val"); review = true; }
        else if (t === "roadAccess") { est.roadAccess = btn.getAttribute("data-val"); review = true; }
        else if (t === "frontage") { est.frontage = btn.getAttribute("data-val"); review = true; }
        else if (t === "lotShape") { est.lotShape = btn.getAttribute("data-val"); review = true; }
        else if (t === "rightOfWay") { est.rightOfWay = btn.getAttribute("data-val"); review = true; }
        else if (t === "elevation") { est.elevation = btn.getAttribute("data-val"); review = true; }
        else if (t === "utilities") { est.utilities = btn.getAttribute("data-val"); review = true; }
        else if (t === "construction") est.construction = btn.getAttribute("data-val");
        else if (t === "floors") est.floors = btn.getAttribute("data-val");
        else if (t === "ageBand") { est.ageBand = btn.getAttribute("data-val"); review = true; }
        if (review) renderLayout();
      });
    });

    $qa(card, "[data-est-ownership]").forEach(function (button) {
      button.addEventListener("click", function () {
        var key = button.getAttribute("data-est-ownership");
        est[key] = button.getAttribute("data-val");
        $qa(card, '[data-est-ownership="' + key + '"]').forEach(function (b) {
          var active = b === button;
          b.classList.toggle("active", active);
          b.setAttribute("aria-pressed", active ? "true" : "false");
        });
      });
    });

    $qa(card, "[data-est-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = Number(btn.getAttribute("data-est-edit")) || 1;
        est.screen = target === 2 ? 2 : 1;
        renderLayout();
        revealEstimatorScreen();
      });
    });

    var prev = $q(card, "[data-est-prev]");
    if (prev) prev.addEventListener("click", function () {
      est.screen = 1;
      renderLayout();
      revealEstimatorScreen();
    });

    var next = $q(card, "[data-est-next]");
    if (next) {
      next.addEventListener("click", function () {
        if (est.screen === 1) {
            if (validScreen1()) {
              est.validationIssue = null;
              suggestAssumptions();
              est.screen = 2;
              renderLayout();
              revealEstimatorScreen();
           } else showErr(card);
        } else if (est.screen === 2) {
          var missingDetails = missingScreen2Field();
          if (missingDetails) showErr(card, missingDetails);
          else runEstimate();
        }
      });
    }

     $qa(card, "[data-est-lead-open]").forEach(function (leadBtn) {
       leadBtn.addEventListener("click", function () {
         est.leadOpen = true;
         est.leadKind = "appraisal";
         est.appraisalRequested = true;
         renderLayout();
         revealLeadForm();
       });
     });
    $qa(card, "[data-est-broker-open]").forEach(function (brokerBtn) {
      brokerBtn.addEventListener("click", function () {
        est.leadOpen = true;
        est.leadKind = "broker";
        est.appraisalRequested = true;
        renderLayout();
        revealLeadForm();
      });
    });
    var appraisalBtn = $q(card, "[data-est-appraisal-open]");
    if (appraisalBtn) appraisalBtn.addEventListener("click", function () {
      est.leadOpen = true;
      est.leadKind = "appraisal";
      est.appraisalRequested = true;
      renderLayout();
      revealLeadForm();
    });
    var scrollGuide = $q(card, "[data-est-scroll-report]");
    if (scrollGuide) scrollGuide.addEventListener("click", function () {
      var report = $q(card, ".sf-est-report");
      var first = report && report.querySelector(".sf-est-rsec");
      if (first && !first.open) first.open = true;
      if (report) report.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    var leadForm = $q(card, "[data-est-lead-form]");
    if (leadForm) leadForm.addEventListener("submit", function (e) {
      e.preventDefault();
      submitLead(leadForm);
    });
  }

function missingScreen1Field() {
    if (!est.municipality) return { field: "[data-est-muni]", msg: "Choose a municipality to continue." };
    if (!est.barangay) return { field: "[data-est-barangay]", msg: "Choose a barangay to continue." };
    /* Street is optional, matching the reference form which labels it
       "(Optional)". A street-less parcel resolves to the barangay's
       all-other-streets rate, so the guide stays honest without forcing a
       non-technical user through a street search they cannot answer. */
    if (!est.classification) return { field: "[data-est-class]", msg: "Choose a BIR classification to continue." };
    if (!(est.area > 0)) return { field: "[data-est-area]", msg: "Enter the lot area in sqm to continue." };
    if (!isFinite(Number(est.area)) || est.area < 20 || est.area > 100000) return { field: "[data-est-area]", msg: "Enter a lot area between 20 and 100,000 sqm." };
    if (est.salePrice != null && (!isFinite(Number(est.salePrice)) || Number(est.salePrice) < 0 || Number(est.salePrice) > 1000000000)) return { field: "[data-est-sale-price]", msg: "Enter a non-negative selling price up to PHP 1 billion, or leave it blank." };
    if (est.landMethod === "time-indexed") {
      var indexCheck = referenceTools.timeScenario(1, 1, { baseDate: est.timeBaseDate || est.muniRow.effectivityDate, targetDate: est.timeTargetDate, annualPct: est.timeAnnualPct, source: est.timeSource, evidenceId: est.timeEvidenceId }, DATA.config.governmentReferenceRegister, { municipality: est.municipality, useGroup: useOfClassification(DATA.config, est.classification) });
      if (!indexCheck.available) return { field: indexCheck.reason === "invalid-time-rate" ? '[data-est-time="timeAnnualPct"]' : indexCheck.reason === "time-evidence-unavailable" ? '[data-est-time="timeSource"]' : '[data-est-time="timeTargetDate"]', msg: indexCheck.reason === "time-evidence-unavailable" ? "No applicable reviewed land-price history. Choose manual assumption or the factor guide." : indexCheck.reason === "invalid-time-rate" ? "Enter an explicit annual change greater than -100% and at most 100%; no default rate is assumed." : "Choose valid base and target dates; target cannot precede base or be more than 100 years later." };
    }
    if (!isFinite(est.brokerPct) || est.brokerPct < 0 || est.brokerPct > 1) return { field: '[data-est-cost="brokerPct"]', msg: "Enter a commission from 0% to 100%." };
    var invalidCost = ["developerFees", "notarial", "fairMarketValue"].filter(function (key) { return est[key] != null && (!isFinite(Number(est[key])) || Number(est[key]) < 0); })[0];
    if (invalidCost) return { field: '[data-est-cost="' + invalidCost + '"]', msg: "Enter a non-negative quoted amount, or leave it blank." };
    return null;
  }

  /* Ownership answers default to "Not sure", so the only Details input that can
     be invalid on submit is the optional built-up area. */
  function missingScreen2Field() {
    if (est.type === "house_lot" && (!isFinite(Number(est.floorArea || 0)) || Number(est.floorArea) < 0 || Number(est.floorArea) > 100000)) return { field: "[data-est-floor]", msg: "Enter a built-up area up to 100,000 sqm, or leave it blank for the stated assumption." };
    return null;
  }

  function validScreen1() {
    return !missingScreen1Field();
  }

  function showErr(card, suppliedMissing) {
    var btn = $q(card, "[data-est-next]");
    if (!btn) return;
    var missing = suppliedMissing || missingScreen1Field();
    est.validationIssue = missing ? { field: missing.field, msg: missing.msg } : null;
    var msg = $q(card, "[data-est-next-hint]");
    if (!msg) {
      var p = document.createElement("p");
      p.className = "sf-est-next-hint sf-est-err";
      p.setAttribute("data-est-next-hint", "");
      btn.parentNode.insertBefore(p, btn);
      msg = p;
    }
    msg.textContent = missing ? missing.msg : "Complete all fields to continue.";
    msg.classList.add("sf-est-err");
    /* The message is injected on demand, so it needs role="alert" to be
     * announced — previously it appeared silently for screen-reader users. */
    msg.setAttribute("role", "alert");
    msg.setAttribute("aria-live", "assertive");
    $qa(card, ".sf-est-invalid").forEach(function (el) { el.classList.remove("sf-est-invalid"); });
    $qa(card, "[aria-invalid]").forEach(function (el) { el.removeAttribute("aria-invalid"); });
    if (missing) {
      var field = $q(card, missing.field);
      /* The cost and time panels now live inside the collapsed "About this
         estimate" disclosure, so opening only the nearest <details> left the
         focused field inside a closed ancestor and therefore invisible. Walk
         the whole chain. */
      if (field) openDisclosureChain(field);
      var wrap = field ? field.closest(".sf-est-field, fieldset") : null;
      if (wrap) {
        wrap.classList.add("sf-est-invalid");
        if (field) {
          field.setAttribute("aria-invalid", "true");
          /* Tie the message to the control so the error is discoverable when
           * focus lands on the field, and move focus there. Focus previously
           * stayed on the Continue button, so keyboard users had to hunt. */
          if (!field.id) field.id = "sf-est-invalid-" + String(missing.field).replace(/[^A-Za-z0-9_-]/g, "-");
          if (!msg.id) msg.id = "sf-est-err-msg";
          field.setAttribute("aria-describedby", msg.id);
        }
        try { if (wrap.scrollIntoView) wrap.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
        try { if (field && field.focus) field.focus({ preventScroll: true }); } catch (e) { if (field && field.focus) field.focus(); }
      }
    }
  }

  function runEstimate() {
    if (!validScreen1()) return;
    var currentCalculation = ++calculationRequest;
    calculationStartedAt = Date.now();
    est.result = null;
    est.pricingUnlocked = true;
    est.leadSubmitted = false;
    est.screen = 3;
    renderLayout();
    revealEstimatorScreen();
    startStageMotion();
    var config = DATA.config;
    var index = DATA.index;
    var opts = {
      municipality: est.municipality, barangay: est.barangay,
      streetKey: est.allOther ? "" : est.streetKey,
      classification: est.classification, area: est.area,
      salePrice: est.salePrice, saleContext: est.saleContext, developerFees: est.developerFees, brokerPct: est.brokerPct,
      landMethod: est.landMethod, timeSource: est.timeSource, timeAnnualPct: est.timeAnnualPct, timeBaseDate: est.timeBaseDate, timeTargetDate: est.timeTargetDate, timeEvidenceId: est.timeEvidenceId,
      notarial: est.notarial, fairMarketValue: est.fairMarketValue, condition: est.condition,
      corner: est.corner, purpose: est.purpose, stage: est.stage,
      type: est.type,
      floorArea: est.type === "house_lot" ? (Number(est.floorArea) > 0 ? Number(est.floorArea) : 0) : 0,
      floors: est.type === "house_lot" ? est.floors : "1",
      ageBand: est.type === "house_lot" ? est.ageBand : "0-5",
      construction: est.type === "house_lot" ? est.construction : "mixed_chb",
      features: est.type === "house_lot" ? est.features : [],
      occupancy: est.occupancy,
      titleStatus: est.titleStatus,
      inheritanceStatus: est.inheritanceStatus,
      community: est.community, floodRisk: est.floodRisk, roadAccess: est.roadAccess, frontage: est.frontage,
      lotShape: est.lotShape, rightOfWay: est.rightOfWay, elevation: est.elevation, utilities: est.utilities
    };
    Promise.all([loadMunicipality(est.municipalitySlug), loadComparableListings(opts)]).then(function (parts) {
      if (currentCalculation !== calculationRequest || !getCard()) return;
      var md = parts[0];
      var internal = parts[1];
      var usefulInternal = comparableSummary(internal, { municipality: opts.municipality, barangay: opts.barangay, propertyType: opts.type, area: opts.area, floorArea: opts.floorArea, corner: opts.corner, saleContext: opts.saleContext, condition: opts.condition }).eligibleCount >= 3;
      var catalogRows = internal.map(function (row) { return Object.assign({}, row, { sourceType: "SEA ESTATES listing" }); });
      var pendingEvidence = usefulInternal ? Promise.resolve({ records: catalogRows, source: "SEA ESTATES listing", externalStatus: { source: "External", status: "not-needed" } }) : loadExternalComparables(opts).then(function (external) {
        return { records: catalogRows.concat(external), source: "Asking evidence", externalStatus: external.retrievalStatus || { source: "External", status: "not-configured" } };
      });
      return pendingEvidence.then(function (evidenceSet) {
        if (currentCalculation !== calculationRequest || !getCard()) return;
        opts.comparables = evidenceSet.records;
        opts.comparableSource = evidenceSet.source;
        var r = core.computeEstimate(config, index, md, opts);
        if (r.available) { r.integrity = core.integrityCheck(r); if (!r.integrity.ok) r = unavailableResult("integrity-fail", config, index); }
        r.evidenceRetrieval = [internal.retrievalStatus || { source: "Catalog", status: "not-configured" }, evidenceSet.externalStatus];
        r.projectContext = ((DATA.projectEvidence || {}).records || []).filter(function (record) { return evidence.place(record.municipality) === evidence.place(opts.municipality); });
        est.result = r;
        animateThenReport(currentCalculation);
      });
    }).catch(function () {
      if (currentCalculation !== calculationRequest || !getCard()) return;
      est.result = { available: false, reason: "connection" };
      animateThenReport(currentCalculation);
    });
  }

  /* The three stages advance on a fixed cadence while the real data work runs.
     The result waits for both the data (resolved by the caller) and the
     cadence: on a cached local run the calculation returns in a few
     milliseconds and the progress screen read as a flicker, so the fastest run
     is padded to the cadence while a slow run is never padded at all — the
     result appears as soon as its data exists, and never before. */
  function startStageMotion() {
    var stages = $qa(getCard(), '[data-est-screen="3"] [data-est-stage]');
    if (stages.length < 2) return;
    stages.forEach(function (el, i) { el.classList.toggle("active", i === 0); el.classList.remove("complete"); });
    stages.slice(1).forEach(function (el, i) {
      setTimeout(function () {
        if (!el.parentNode || !stages[i].parentNode) return;
        stages[i].classList.remove("active");
        stages[i].classList.add("complete");
        el.classList.add("active");
      }, (i + 1) * STAGE_STEP_MS);
    });
  }

  function animateThenReport(requestId) {
    function report() {
      if (requestId !== calculationRequest || !getCard()) return;
      est.screen = 4; renderLayout(); revealEstimatorScreen();
    }
    var waitMs = Math.max(0, CALCULATING_MIN_MS - (Date.now() - calculationStartedAt));
    if (!waitMs) { report(); return; }
    setTimeout(report, waitMs);
  }

  /* ---------------------------------------------------------- */
  /*  lead submit (Phase 5 wires the Supabase pipeline)          */
  /* ---------------------------------------------------------- */

  function snapshotFor(r) {
    return r && r.available ? {
      municipality: r.municipality, barangay: r.barangay, street: r.streetName || "Street not listed",
      classification: r.classification, classificationLabel: r.classificationLabel,
      use: r.use, coverage: r.coverage, sourceLevel: r.source.level, dataCoveragePct: r.source.pct,
      total: r.total, marketGuideEstimate: r.marketGuideEstimate, marketGuideAvailable: r.marketGuideAvailable, recommendedAskingPrice: r.recommendedAskingPrice, low: r.low, high: r.high, perSqm: r.perSqm,
      birReferenceConfirmed: r.birReferenceConfirmed, birReferenceLabel: r.birReferenceLabel, taxReferenceValue: r.taxReferenceValue,
      saleContext: r.saleContext, costOptions: r.costOptions, conditions: r.conditions, factorSettingsVersion: r.factorSettingsVersion,
      askingIndication: r.askingIndication,
      landMethod: r.landMethod, planningMethodLabel: r.planningMethodLabel, timeIndex: r.timeIndex, factorBaseline: r.factorBaseline, referenceVerification: r.referenceVerification,
      birZonalRatePerSqm: r.birZonalRatePerSqm, birZonalValue: r.birZonalValue,
      landValue: r.landValue, improvement: r.improvement, area: r.area, floorArea: r.floorArea, salePrice: r.salePrice,
      ownershipAdjustmentPct: r.ownershipAdjustmentPct, occupancy: est.occupancy,
      titleStatus: est.titleStatus, inheritanceStatus: est.inheritanceStatus,
      marketGuide: r.marketGuide,
      purpose: r.purpose, type: r.type, typeLabel: r.typeLabel,
      calculationVersion: r.calculationVersion, dataVersion: r.dataVersion,
      asOf: r.effectivityDate, schedule: r.reference.schedule,
      /* Audit trail: without these the emailed/PDF report can only state a
       * number, so a reader cannot check how it was reached. */
      landPerSqm: r.landPerSqm,
      cornerApplied: !!(r.corner && r.corner.applied), cornerPct: r.corner ? r.corner.pct : 0,
      proxyFactor: r.factors.proxyFactor, bandMid: r.factors.bandMid, regionalAdj: r.factors.regionalAdj,
      buildCostPerSqm: r.buildCostPerSqm, floorsMultiplier: r.floorsMultiplier,
      ageMidpoint: r.ageMidpoint, depreciatedPct: r.depreciatedPct, featuresTotal: r.featuresTotal,
      provenance: provenancePayload(r)
    } : null;
  }

  /* Compact provenance for the emailed/PDF report. Sends only the short
   * disclosure strings, not the whole manifest, so the report stays small and
   * the wording still comes from the single manifest the site reads. */
  function provenancePayload(r) {
    var m = manifest();
    if (!m) return null;
    return {
      basisOfValue: r && r.timeIndex ? "Indexed-reference planning scenario" : (m.valuation && m.valuation.basisOfValue) || "",
      basisNote: (m.valuation && m.valuation.basisNote) || "",
      order: r && r.timeIndex ? ["Unchanged imported reference rate", "Explicit annual change over stated dates", "Lot area; full precision before final rounding", "Separate building/depreciation component"] : (m.adjustmentFramework && m.adjustmentFramework.order) || [],
      sources: (m.provenance && m.provenance.records || []).map(function (rec) {
return {
            instrument: rec.instrument, authority: rec.authority, coverage: rec.coverage,
            effectiveDate: rec.effectiveDate, status: rec.status, revision: rec.revision || "",
            /* currencyNote carries the statutory basis for the rate (RA 12001 and
             * the "no superseding DO identified" reasoning). It is part of the
             * source of record, so it is exposed here rather than only being
             * rendered by the HTML guide. */
            currencyNote: rec.currencyNote || ""
          };
      }),
      currencyCheckedOn: (m.provenance && m.provenance.currencyCheckedOn) || "",
      referenceStatus: "Latest applicability unverified unless the government register has successful verification and legal effectivity evidence",
      nextCurrencyReview: (m.provenance && m.provenance.nextCurrencyReview) || "",
      rangeMeaning: (m.range && m.range.meaning) || "",
      limitations: m.limitations || []
    };
  }

  function locationReportUrl() {
    if (typeof window === "undefined" || !window.ESREALTY_API_BASE) return "";
    return String(window.ESREALTY_API_BASE).replace(/\/listing-api\/api$/, "/location-report");
  }

  /* The agent whose page started this Value Guide (#/home?agent=<slug>): the server sends the
     request to them. The agent's page names them (setAgent, kept for this browser tab); the home
     page confirms the address (useAgent), which is the authority; the request reads vgAgent(). */
  var VG_AGENT_KEY = "esrealty_vg_agent_v1";
  var vgAgentNow = { slug: "", name: "" };
  function setAgent(a) {
    var saved = { slug: a && a.slug ? String(a.slug) : "", name: a && a.name ? String(a.name) : "" };
    try { sessionStorage.setItem(VG_AGENT_KEY, JSON.stringify(saved)); } catch (e) {}
    return saved;
  }
  function useAgent(slug) {
    slug = String(slug || "").toLowerCase();
    if (slug.length > 70 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) { vgAgentNow = { slug: "", name: "" }; return vgAgentNow; }
    var name = "";
    try { var saved = JSON.parse(sessionStorage.getItem(VG_AGENT_KEY) || "null"); if (saved && saved.slug === slug) name = String(saved.name || ""); } catch (e) {}
    vgAgentNow = { slug: slug, name: name };
    return vgAgentNow;
  }
  function vgAgent() { return vgAgentNow; }

  function submitLead(form) {
    var status = form.querySelector("[data-est-lead-status]");
    var button = form.querySelector("button[type=submit]");
    var data = new FormData(form);
    var api = typeof window !== "undefined" && window.ESREALTY_LISTINGS_API;
    var r = est.result;
    var snap = snapshotFor(r);
    var message = ["Official BIR schedule estimate request"];
    message.push("Location: " + est.municipality + (est.barangay ? " · " + est.barangay : ""));
    message.push("Street: " + (est.streetLabel && !est.allOther ? est.streetLabel : "Street not listed"));
    if (snap) message.push("Factor-based estimate: " + money(snap.marketGuideEstimate) + " (" + money(snap.low) + "–" + money(snap.high) + ") · " + (snap.marketGuideAvailable ? "comparable asking listings shown as context" : "no comparable asking listings available") + " · BIR zonal reference " + money(snap.birZonalValue) + " · " + (snap.typeLabel || snap.type) + " · " + fmt(snap.area) + " sqm · BIR data coverage " + Math.round(snap.dataCoveragePct * 100) + "%");
    var notes = data.get("message");
    if (notes) message.push("Notes: " + notes);
    var payload = {
      /* The lead's requested service, labeled on the CRM record:
         appraisal -> professional-appraisal-request,
         broker -> broker-consultation,
         email path -> location-analysis. */
      inquiry_type: est.leadKind === "appraisal" ? "professional-appraisal-request"
        : est.leadKind === "broker" ? "broker-consultation"
        : "location-analysis",
      full_name: data.get("name"),
      email: data.get("email"),
      phone: data.get("phone"),
      consent: data.get("consent") === "on",
      purpose: est.purpose,
      service_requested: est.leadKind === "appraisal" ? "professional-appraisal-consultation"
        : est.leadKind === "broker" ? "broker-consultation"
        : "valuation-report",
      message: message.join(" | "),
      notes: notes ? String(notes) : "",
      /* Started from an agent's page (useAgent, from #/home?agent=<slug>): the server sends
         the request to that agent. */
      agent_slug: vgAgent().slug,
      report: {
        property: {
          purpose: est.purpose, type: snap ? snap.type : est.type,
          typeLabel: snap ? snap.typeLabel : "", kind: est.type === "house_lot" ? "built" : "land",
          area: snap ? snap.area : (est.area || 0), corner: est.corner,
          floorArea: snap ? snap.floorArea : 0,
          floors: est.floors, ageBand: est.ageBand, construction: est.construction, features: est.features
        },
        location: {
          region: "Region IV-A (CALABARZON)", province: "Batangas",
          town: est.municipality, barangay: est.barangay,
          address: est.streetLabel && !est.allOther ? est.streetLabel : "",
          streetListed: !est.allOther, lat: null, lng: null
        },
        estimate: snap,
        /* The estimator's own inputs, so the team can reopen this request in
           the back-office Value Guide and build the report after the call. */
        inputs: {
          purpose: est.purpose, type: est.type, municipality: est.municipality, barangay: est.barangay,
          streetKey: est.allOther ? "" : est.streetKey, allOther: !!est.allOther, classification: est.classification,
          area: est.area || 0, corner: !!est.corner, construction: est.construction, floorArea: est.floorArea || 0,
          floors: est.floors, ageBand: est.ageBand, features: est.features || [],
          salePrice: est.salePrice == null ? null : est.salePrice, saleContext: est.saleContext
        },
        asOf: snap ? snap.asOf : "",
        disclaimer: r && r.disclaimer ? r.disclaimer : (DATA && DATA.config.disclaimer)
      }
    };
    if (button) { button.disabled = true; button.textContent = "Sending…"; }
    if (status) { status.textContent = "Sending…"; status.className = "sf-form-status"; }
    function fallback() {
      if (!api || !api.contact) throw new Error("Contact service unavailable");
      var inquiry = {
        inquiry_type: payload.inquiry_type,
        full_name: payload.full_name,
        email: payload.email,
        phone: payload.phone,
        message: payload.message,
        consent: payload.consent
      };
      /* An older listing-api only knows consult/guide/project-bt/location-analysis.
         If it rejects the appraisal or broker type, save the lead as a
         consultation with the requested service named in the message. */
      return api.contact(inquiry).catch(function (err) {
        if (!err || err.status !== 400 || !/inquiry_type/.test(err.message || "")) throw err;
        return api.contact(Object.assign({}, inquiry, {
          inquiry_type: "consult",
          message: "Requested: " + payload.service_requested + " | " + payload.message
        }));
      });
    }
    var url = locationReportUrl();
    var key = form.dataset.estIdempotencyKey ||
      ("loc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));
    form.dataset.estIdempotencyKey = key;
    var headers = { "Content-Type": "application/json", "Accept": "application/json", "Idempotency-Key": key };
    var receivedHttp = false;
    var send = url
      ? window.fetch(url, { method: "POST", headers: headers, body: JSON.stringify(payload) })
        .then(function (res) {
          receivedHttp = true;
          // Degraded fallback to listing-api ONLY on transport failure (this
          // endpoint never received/acknowledged the request, so no duplicate).
          // Any HTTP answer — including 500s — is surfaced to the user instead:
          // a retry keeps the same Idempotency-Key and is deduped server-side.
          return res.json().then(function (j) {
            if (!res.ok) throw new Error((j && j.error) || "location-report " + res.status);
            return j;
          });
        })
        .catch(function (err) {
          var isHttp = receivedHttp || /^location-report /.test(err && err.message);
          if (isHttp) throw err;
          return fallback();
        })
      : fallback();
    send.then(function (res) {
      form.reset();
      delete form.dataset.estIdempotencyKey;
      // Saving is all the website does: the team calls, then sends the report.
      // Named only when the server says the request went to that agent (the page may have come down).
      var agentName = res && res.agent ? String(res.agent) : "";
      var agentFirst = agentName.split(/\s+/)[0];
      var confirmMsg = agentFirst
        ? "Your request has been saved and sent to " + agentName + ". " + agentFirst + " will call you to confirm your details."
        : est.leadKind === "broker"
        ? "Your request has been saved. A licensed SEA ESTATES broker will call you."
        : est.leadKind === "appraisal"
          ? "Your request has been saved. The SEA ESTATES team will call you to confirm your details and arrange the consultation."
          : "Your request has been saved. The SEA ESTATES team will call you to confirm your details, then email your report.";
      if (status) {
        status.textContent = confirmMsg;
        status.className = "sf-form-status success";
      }
      est.pricingUnlocked = true;
      est.leadSubmitted = true;
      unlockPricing();
      /* Carries confirmMsg through so the swap keeps the "we'll call you" note. */
      showLeadConfirmation(confirmMsg);
    }).catch(function (err) {
      if (status) {
        status.textContent = err.message || "Could not send. Please try again.";
        status.className = "sf-form-status error";
      }
    }).finally(function () {
       if (button) { button.disabled = false; button.textContent = est.leadKind === "broker" ? "Request broker contact →" : est.leadKind === "appraisal" ? "Send my consultation request →" : "Request my report →"; }
    });
  }

  /* ---------------------------------------------------------- */
  /*  mount                                                      */
  /* ---------------------------------------------------------- */

  function cardSection() {
    return '<section class="sf-section sf-est" id="sf-estimator" data-est-root>' +
      '<div class="sf-est-card" data-est-card><p class="sf-est-empty">Loading the Batangas Value Guide…</p></div></section>';
  }

  function markup() {
    return '<section class="sf-section sf-est" id="sf-estimator" data-est-root>' +
      '<div class="sf-section-head sf-reveal"><div><p class="sf-eyebrow">BATANGAS VALUE GUIDE</p><h2>What is your <em>property worth?</em></h2></div>' +
      '<p>Official BIR zonal values for Batangas (RDO 58 &amp; 59), shown separately from a SEA ESTATES market guide estimate.</p></div>' +
      '<div class="sf-est-card" data-est-card></div></section>';
  }

  function mount() {
    if (typeof document === "undefined") return;
    if (!servicesBound) {
      servicesBound = true;
      window.addEventListener("hashchange", function () {
        if (!/^#\/?(home(?:\?|$)|$)/.test(location.hash)) { mountedHome = false; est.validationIssue = null; ++calculationRequest; }
      });
      /* Back from the guide jump returns to where the visitor tapped (the
         browser restores that entry's scroll). No scripted scroll here: hash
         navigations fire popstate too, and a smooth scroll-to-top racing the
         visitor's own scrolling made the page feel like it fought back. */
      window.addEventListener("popstate", function (event) {
        /* the browser restores the spot the visitor tapped from */
        if (guideEntryUrl && location.href === guideEntryUrl && !(event.state && event.state.sfGuide)) guideEntryUrl = "";
      });
      document.addEventListener("click", function (event) {
        if (event.target.closest("[data-est-data-retry]")) { dataPromise = null; mount(); return; }
        var link = event.target.closest("[data-est-services]");
        if (!link) return;
        event.preventDefault();
        var goHome = typeof location !== "undefined" && String(location.hash).indexOf("home") === -1;
        /* Home renders after the route change, so the guide is reached once it
           exists. One follow-up pass corrects for late layout, but only if the
           visitor has not started scrolling themselves - a second jump after
           they scroll up felt like the page would not let them reach the top. */
        if (goHome) {
          location.hash = "#/home";
          var touched = false, mark = function () { touched = true; };
          ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (ev) { window.addEventListener(ev, mark, { once: true, passive: true }); });
          setTimeout(function () { if (!touched) scrollToEstimator(); }, 450);
          setTimeout(function () {
            ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (ev) { window.removeEventListener(ev, mark); });
            var t = document.getElementById("sf-estimator");
            if (!touched && t && Math.abs(t.getBoundingClientRect().top) > 120) scrollToEstimator();
          }, 1200);
        }
        else {
          if (link.hasAttribute("data-quick-go")) applyQuickToGuide();
          /* An entry for the jump, so the phone's Back button returns to the
             top of the page instead of leaving the site (review item 29). */
          try { if (!(history.state && history.state.sfGuide)) { history.pushState({ sfGuide: true }, "", location.href); guideEntryUrl = location.href; } } catch (e) { /* noop */ }
          scrollToEstimator();
        }
      });
    }
    if (!document.querySelector("[data-est-root]")) return;
    loadData().then(function () {
      if (!getCard()) return;
      if (!mountedHome) { est.screen = 1; mountedHome = true; }
      renderLayout();
      mountQuick();
    }).catch(function () {
      var card = getCard();
      dataPromise = null;
      if (card) card.innerHTML = '<p class="sf-est-empty" role="alert">Could not load reference data. Check your connection and try again.</p><button class="sf-est-next" data-est-data-retry>Retry loading data</button>';
    });
  }

  function scrollToEstimator() {
    var target = document.getElementById("sf-estimator");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------------------------------------------------------- */
  /*  Home hero quick estimate                                   */
  /*                                                          */
  /*  Town, property type and lot area give a town-wide starting */
  /*  figure the moment a town is chosen. It runs the SAME       */
  /*  estimate() the full guide uses, with the barangay left     */
  /*  blank so the BIR reference falls back to the municipality  */
  /*  median, and the full guide's defaults for everything else. */
  /*  "Start My Value Guide" then carries the three answers into */
  /*  the calculator, which opens at the barangay question.      */
  /* ---------------------------------------------------------- */
  var quick = { municipality: "", type: "house_lot", area: 150, request: 0, result: null, loading: false, shown: 0 };
  /* Shown before the data files arrive; replaced by the live counts. */
  var QUICK_STATS_FALLBACK = { towns: 34, streets: 3710 };

  function quickMuniOptions() {
    if (!DATA || !DATA.index) return "";
    return DATA.index.municipalities.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }).map(function (m) {
      return '<option value="' + esc(m.name) + '"' + (m.name === quick.municipality ? " selected" : "") + ">" + esc(titleCase(m.name)) + "</option>";
    }).join("");
  }

  function quickStats() {
    var counts = DATA && DATA.manifest && DATA.manifest.counts || {};
    var bank = DATA && DATA.bankComparables;
    var listings = bank && bank.records && !bank.unavailable ? bank.records.length : 0;
    var month = bank && /^\d{4}-\d{2}$/.test(bank.month || "") ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(bank.month.slice(5)) - 1] + " " + bank.month.slice(0, 4) : "";
    return {
      towns: counts.municipalities || (DATA && DATA.index && DATA.index.municipalities ? DATA.index.municipalities.length : QUICK_STATS_FALLBACK.towns),
      streets: counts.streets || QUICK_STATS_FALLBACK.streets,
      listings: listings,
      month: month
    };
  }

  function quickStatsHtml() {
    var s = quickStats();
    return '<li><b data-est-stat="towns">' + fmt(s.towns) + '</b><span>towns and cities covered</span></li>' +
      '<li><b data-est-stat="streets">' + fmt(s.streets) + '</b><span>BIR street rates</span></li>' +
      '<li><b data-est-stat="listings">' + (s.listings ? fmt(s.listings) : "Monthly") + '</b><span data-est-stat="listings-label">' + (s.listings ? "bank &amp; Pag‑IBIG listings" + (s.month ? ", " + esc(s.month) : "") : "bank &amp; Pag‑IBIG listings") + '</span></li>';
  }


  function quickRound(n) { return Math.round((Number(n) || 0) / 1e4) * 1e4; }

  function quickResultHtml() {
    var r = quick.result;
    if (!quick.municipality || !r) {
      return '<span class="sf-quick-caption">Your starting figure</span>' +
        '<strong class="sf-quick-figure is-idle" aria-hidden="true">₱ —</strong>' +
        '<div class="sf-quick-range is-idle" aria-hidden="true"><span></span></div>' +
        '<p class="sf-quick-range-text is-idle" aria-hidden="true"><span>₱ —</span><span class="sf-quick-range-mid">Likely range</span><span>₱ —</span></p>' +
        '<p class="sf-quick-note">' + (quick.municipality && !(quick.area >= 20 && quick.area <= 100000) ? "Enter a lot area between 20 and 100,000 sqm." : "Choose your town to see a starting figure for your property.") + '</p>';
    }
    if (r.available === false || !(r.marketGuideEstimate > 0)) {
      return '<span class="sf-quick-caption">' + esc(titleCase(quick.municipality)) + '</span>' +
        '<p class="sf-quick-note">A quick figure is not available for this town. The full guide shows what the BIR schedule covers there.</p>';
    }
    var span = r.high - r.low, pos = span > 0 ? Math.max(4, Math.min(96, (r.marketGuideEstimate - r.low) / span * 100)) : 50;
    return '<span class="sf-quick-caption">Starting figure · ' + esc(titleCase(r.municipality)) + '</span>' +
      '<strong class="sf-quick-figure" data-quick-figure data-value="' + quickRound(r.marketGuideEstimate) + '">' + money(quickRound(r.marketGuideEstimate)) + '</strong>' +
      '<div class="sf-quick-range" aria-hidden="true"><span style="left:' + pos.toFixed(1) + '%"></span></div>' +
      '<p class="sf-quick-range-text"><span>' + money(quickRound(r.low)) + '</span><span class="sf-quick-range-mid">Likely range</span><span>' + money(quickRound(r.high)) + '</span></p>' +
      '<p class="sf-quick-note">Town-wide figure for a ' + fmt(r.area) + ' sqm lot' + (r.improvement > 0 ? ' with a ' + fmt(r.floorArea) + ' sqm house under 5 years old' : '') + '. Your barangay, street and house details sharpen it.</p>';
  }

  function quickSay() {
    var r = quick.result;
    if (!quick.municipality || !r || r.available === false || !(r.marketGuideEstimate > 0)) return "";
    return "Starting figure for " + titleCase(r.municipality) + ": " + money(quickRound(r.marketGuideEstimate)) + ". Likely range " + money(quickRound(r.low)) + " to " + money(quickRound(r.high)) + ".";
  }

  function quickMarkup() {
    return '<form class="sf-quick" data-est-quick novalidate aria-labelledby="sf-quick-title">' +
      '<div class="sf-quick-head"><h2 id="sf-quick-title">Free Value Guide</h2><span class="sf-quick-tag">10-second preview</span></div>' +
      '<label class="sf-quick-field"><span class="sf-quick-label">Town or city</span>' +
        '<select data-quick-muni><option value="">Choose your town</option>' + quickMuniOptions() + '</select></label>' +
      '<div class="sf-quick-row">' +
        '<fieldset class="sf-quick-field"><legend class="sf-quick-label">Property</legend><div class="sf-quick-seg">' +
          '<label><input type="radio" name="sf-quick-type" value="house_lot" data-quick-type' + (quick.type === "house_lot" ? " checked" : "") + '><span>House &amp; lot</span></label>' +
          '<label><input type="radio" name="sf-quick-type" value="vacant_lot" data-quick-type' + (quick.type === "vacant_lot" ? " checked" : "") + '><span>Lot only</span></label>' +
        '</div></fieldset>' +
        '<label class="sf-quick-field"><span class="sf-quick-label">Lot area</span><span class="sf-quick-unit">' +
          '<input data-quick-area type="number" inputmode="numeric" min="20" max="100000" step="1" value="' + esc(quick.area || "") + '" aria-describedby="sf-quick-unit"><i id="sf-quick-unit">sqm</i></span></label>' +
      '</div>' +
      '<div class="sf-quick-result" data-quick-result>' + quickResultHtml() + '</div>' +
      '<p class="sf-visually-hidden" aria-live="polite" data-quick-say></p>' +
      '<div class="sf-hero-actions sf-est-hero-actions"><a class="sf-hero-btn sf-quick-go" href="#sf-estimator" data-est-services data-quick-go>Start My Value Guide</a></div>' +
      '<p class="sf-quick-meta">Free · No account · About 2 minutes</p>' +
      '</form>';
  }

  function quickReducedMotion() {
    try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return true; }
  }

  function renderQuick(animate) {
    var form = document.querySelector("[data-est-quick]");
    if (!form) return;
    var box = form.querySelector("[data-quick-result]");
    if (!box) return;
    box.innerHTML = quickResultHtml();
    box.classList.toggle("is-loading", !!quick.loading);
    var say = form.querySelector("[data-quick-say]");
    if (say && !quick.loading) say.textContent = quickSay();
    var fig = box.querySelector("[data-quick-figure]");
    if (!fig) { quick.shown = 0; return; }
    var to = Number(fig.getAttribute("data-value")) || 0, from = quick.shown || to * 0.7;
    quick.shown = to;
    if (!animate || quickReducedMotion() || !window.requestAnimationFrame || from === to) return;
    var start = 0, duration = 700;
    fig.textContent = money(quickRound(from));
    window.requestAnimationFrame(function step(t) {
      if (!start) start = t;
      var k = Math.min(1, (t - start) / duration), eased = 1 - Math.pow(1 - k, 3);
      if (!fig.isConnected) return;
      fig.textContent = money(k < 1 ? Math.round((from + (to - from) * eased) / 1e3) * 1e3 : to);
      if (k < 1) window.requestAnimationFrame(step);
    });
  }

  function runQuick() {
    var req = ++quick.request;
    if (!quick.municipality || !(quick.area >= 20 && quick.area <= 100000)) {
      quick.result = null; quick.loading = false; renderQuick(false); return;
    }
    quick.loading = true;
    var box = document.querySelector("[data-est-quick] [data-quick-result]");
    if (box) box.classList.add("is-loading");
    estimate({
      purpose: "Selling", type: quick.type, municipality: quick.municipality, barangay: "", streetKey: "",
      classification: "RR", area: quick.area, landMethod: "factor", saleContext: "private-resale",
      floorArea: 0, floors: "1", ageBand: "0-5", construction: "mixed_chb", features: []
    }).then(function (r) {
      if (req !== quick.request) return;
      quick.loading = false; quick.result = r; renderQuick(true);
    }).catch(function () {
      if (req !== quick.request) return;
      quick.loading = false; quick.result = { available: false }; renderQuick(false);
    });
  }

  /* The home page's example report: a real run of the estimator for a fixed,
     labelled example (150 sqm house and lot, Lipa City, town-wide reference). */
  var SAMPLE = { municipality: "LIPA CITY", type: "house_lot", area: 150 };
  var sampleResult = null;
  function fillSample() {
    var box = document.querySelector(".sf-guide-sample");
    if (!box) return;
    var paint = function (r) {
      if (!r || r.available === false || !(r.marketGuideEstimate > 0)) { box.hidden = true; return; }
      var set = function (k, v) { var el = box.querySelector('[data-sample="' + k + '"]'); if (el) el.textContent = v; };
      set("value", money(quickRound(r.marketGuideEstimate)));
      set("low", money(quickRound(r.low))); set("high", money(quickRound(r.high)));
      set("land", money(quickRound(r.landValue))); set("house", money(quickRound(r.improvement)));
      set("bir", r.birZonalRatePerSqm > 0 ? money(r.birZonalRatePerSqm) + "/sqm" : "—");
      var recs = DATA && DATA.bankComparables && DATA.bankComparables.records || [];
      set("listings", fmt(recs.filter(function (x) { return x.municipality === SAMPLE.municipality; }).length));
      var pos = box.querySelector('[data-sample="pos"]'), span = r.high - r.low;
      if (pos && span > 0) pos.style.left = Math.max(4, Math.min(96, (r.marketGuideEstimate - r.low) / span * 100)).toFixed(1) + "%";
    };
    if (sampleResult) { paint(sampleResult); return; }
    estimate({
      purpose: "Selling", type: SAMPLE.type, municipality: SAMPLE.municipality, barangay: "", streetKey: "",
      classification: "RR", area: SAMPLE.area, landMethod: "factor", saleContext: "private-resale",
      floorArea: 0, floors: "1", ageBand: "0-5", construction: "mixed_chb", features: []
    }).then(function (r) { sampleResult = r; paint(r); }).catch(function () { box.hidden = true; });
  }

  function mountQuick() {
    fillSample();
    var s = quickStats(), set = function (k, v) { var el = document.querySelector('[data-est-stat="' + k + '"]'); if (el) el.innerHTML = v; };
    set("towns", fmt(s.towns)); set("streets", fmt(s.streets));
    if (s.listings) { set("listings", fmt(s.listings)); set("listings-label", "bank &amp; Pag‑IBIG listings" + (s.month ? ", " + esc(s.month) : "")); }
    var form = document.querySelector("[data-est-quick]");
    if (!form || form.getAttribute("data-bound") === "1") return;
    form.setAttribute("data-bound", "1");
    var sel = form.querySelector("[data-quick-muni]");
    if (sel && sel.options.length < 2) sel.insertAdjacentHTML("beforeend", quickMuniOptions());
    if (sel) sel.addEventListener("change", function () { quick.municipality = sel.value; runQuick(); });
    form.querySelectorAll("[data-quick-type]").forEach(function (radio) {
      radio.addEventListener("change", function () { if (radio.checked) { quick.type = radio.value; runQuick(); } });
    });
    var area = form.querySelector("[data-quick-area]"), timer = 0;
    if (area) area.addEventListener("input", function () {
      quick.area = Number(area.value) > 0 ? Math.round(Number(area.value)) : null;
      clearTimeout(timer); timer = setTimeout(runQuick, 250);
    });
    form.addEventListener("submit", function (event) { event.preventDefault(); });
    /* the page re-rendered (route change) while a town was already chosen */
    if (quick.municipality) runQuick();
  }

  /* Carries the hero answers into the full guide. Returns false when there is
     nothing to carry (no town chosen), so the link simply scrolls. */
  function applyQuickToGuide() {
    if (!quick.municipality || !DATA || !getCard()) return false;
    var row = municipalityRow(quick.municipality);
    if (!row) return false;
    est.screen = 1;
    est.validationIssue = null;
    est.type = quick.type;
    if (quick.area >= 20 && quick.area <= 100000) est.area = quick.area;
    est.municipality = row.name;
    est.municipalitySlug = row.slug;
    est.muniRow = row;
    est.barangay = ""; est.streetKey = ""; est.streetLabel = ""; est.allOther = false;
    est.fromQuick = est.area > 0; est.quickEdit = false;
    est.result = null;
    var slug = row.slug, ready = muniCache[slug] ? muniCache[slug] : null;
    est.muniData = null;
    renderLayout();
    loadMunicipality(slug).then(function (md) {
      if (est.municipalitySlug !== slug || est.screen !== 1) return;
      est.muniData = md;
      renderLayout();
      var brgy = getCard() && getCard().querySelector("[data-est-barangay]");
      if (brgy && brgy.focus) setTimeout(function () { try { brgy.focus({ preventScroll: true }); } catch (e) { brgy.focus(); } }, ready ? 450 : 50);
    }).catch(function () {});
    return true;
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { mount(); });
    } else {
      mount();
    }
  }

  /* ---------------------------------------------------------- */
  /*  reference-data accessors                                    */
  /*                                                          */
  /*  The internal Value Guide view builds its own four-stage    */
  /*  flow instead of reusing the storefront's DOM, but it must  */
  /*  read the SAME dataset or the two tools can disagree about  */
  /*  the same property. These expose the reference tables        */
  /*  read-only; they do not touch the public `est` state.        */
  /* ---------------------------------------------------------- */

  function reference() {
    var d = DATA;
    if (!d || !d.index) return null;
    return {
      config: d.config,
      index: d.index,
      manifest: d.manifest,
      municipalities: d.index.municipalities || [],
      classifications: d.index.classifications || {}
    };
  }

  function municipalityRow(name) {
    var d = DATA;
    if (!d || !d.index) return null;
    var key = normKey(name), found = null;
    (d.index.municipalities || []).forEach(function (m) {
      if (!found && normKey(m.name) === key) found = m;
    });
    return found;
  }

  /* Barangays come from the per-municipality file, not the index. The index
     record only carries a COUNT (barangayCount), which is why this returns a
     promise; the caller must await it before rendering the select. */
  function barangays(municipalitySlug) {
    return loadMunicipality(municipalitySlug).then(function (md) {
      if (!md || !md.barangays) return [];
      return Object.keys(md.barangays).sort(function (a, b) {
        return String(a).localeCompare(String(b));
      });
    });
  }

  /* Streets for one barangay of one municipality.
     The per-municipality files nest streets under barangays[barangay].streets,
     so there is no municipality-level street list to read - getting this shape
     wrong returns an empty list and the wizard looks like it has no BIR coverage
     at all, which is what happened the first time this was written.
     `other` carries the all-other-streets rate the estimator falls back to. */
  function streets(municipalitySlug, barangay) {
    var want = normKey(barangay);
    if (!want) return Promise.resolve({ other: false, streets: [] });
    return loadMunicipality(municipalitySlug).then(function (md) {
      if (!md || !md.barangays) return { other: false, streets: [] };
      var found = null;
      Object.keys(md.barangays).forEach(function (b) {
        if (!found && normKey(b) === want) found = md.barangays[b];
      });
      if (!found) return { other: false, streets: [] };
      var out = Object.keys(found.streets || {}).map(function (k) {
        return { key: k, name: (found.streets[k] && found.streets[k].name) || k };
      });
      out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      return { other: !!found.other, streets: out };
    });
  }

  /* Classification codes offered for a municipality, with their labels. */
  function classificationsFor(municipalitySlug) {
    return loadMunicipality(municipalitySlug).then(function (md) {
      if (!md || !md.classifications) return [];
      return md.classifications.map(function (c) {
        return { code: c.code || c, label: c.label || (DATA.index.classifications || {})[c.code || c] || (c.code || c) };
      });
    });
  }

  /* The one entry point an internal tool needs: given the wizard's inputs,
   * run the same core the storefront runs. Returns the result plus the
   * integrity verdict, so a guide can never be published from a figure that
   * failed to reconcile. */
  function estimate(opts) {
    return loadData().then(function (d) {
      var row = municipalityRow(opts && opts.municipality);
      if (!row) {
        return {
          available: false,
          reason: "municipality-not-found",
          calculationVersion: cfgVersion(d.config),
          dataVersion: dataVersionOf(d.index)
        };
      }
      return loadMunicipality(row.slug).then(function (md) {
        var result = core.computeEstimate(d.config, d.index, md, opts);
        result.integrity = core.integrityCheck(result);
        result.projectContext = ((d.projectEvidence || {}).records || []).filter(function (record) { return evidence.place(record.municipality) === evidence.place(opts.municipality); });
        return result;
      });
    });
  }

  /* Short disclosure strings for the PDF, same source as the emailed report. */
  function provenance() {
    return provenancePayload();
  }

  var debug = null;
  if (typeof window !== "undefined" && typeof module !== "object") {
    debug = {
      state: function () { return est; },
      render: function (screen) { est.screen = screen || est.screen; renderLayout(); },
      estimate: estimate
    };
  }

  return {
    markup: markup,
    cardSection: cardSection,
    quickMarkup: quickMarkup,
    quickStatsHtml: quickStatsHtml,
    mount: mount,
    core: core,
    loadData: loadData,
    updateGuideSettings: updateGuideSettings,
    loadMunicipality: loadMunicipality,
    estimate: estimate,
    reference: reference,
    municipalityRow: municipalityRow,
    barangays: barangays,
    streets: streets,
    classificationsFor: classificationsFor,
    provenance: provenance,
    setAgent: setAgent,
    useAgent: useAgent,
    agent: vgAgent,
    _data: function () { return DATA; },
    _state: function () { return est; },
    debug: debug
  };
});
