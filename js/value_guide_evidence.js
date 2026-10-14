/* Asking evidence is not a completed-sale valuation. Screening settings are
   provisional engineering rules, not PVS-prescribed accuracy thresholds. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ESREALTY_EVIDENCE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function norm(v) { return String(v == null ? "" : v).toUpperCase().replace(/\s+/g, " ").trim(); }
  function place(v) {
    var key = norm(v).replace(/\./g, "");
    if (key === "LIPA") return "LIPA CITY";
    if (/^(STO|SANTO) TOMAS( CITY)?$/.test(key)) return "SANTO TOMAS";
    return key;
  }
  function type(v) {
    var key = norm(v).replace(/[-&]/g, " ").replace(/\s+/g, " ");
    if (/HOUSE|HOME|TOWNHOUSE/.test(key)) return "HOUSE_LOT";
    if (/LOT|LAND/.test(key)) return "VACANT_LOT";
    return key;
  }
  function positive(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
  function median(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; }), n = sorted.length;
    return n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : 0;
  }
  function date(v) {
    if (!v || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(String(v))) return null;
    var day = String(v).slice(0, 10), calendar = Date.parse(day);
    if (!isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== day) return null;
    var n = Date.parse(v); return isFinite(n) ? n : null;
  }
  function normalize(raw, sourceType) {
    raw = raw || {};
    var price = positive(raw.price != null ? raw.price : raw.display_price != null ? raw.display_price : raw.askingPrice);
    var lot = positive(raw.lotArea != null ? raw.lotArea : raw.lot_area_sqm != null ? raw.lot_area_sqm : raw.lot_size_sqm != null ? raw.lot_size_sqm : raw.lot_size);
    var floor = positive(raw.floorArea != null ? raw.floorArea : raw.floor_area_sqm != null ? raw.floor_area_sqm : raw.floor_area);
    var offer = norm(raw.offerType != null ? raw.offerType : raw.offer_type);
    if (!price || !lot || (offer && offer !== "SALE" && offer !== "FOR SALE")) return null;
    var source = sourceType || raw.sourceType || raw.source || "unknown";
    var id = String(raw.id || raw.listingId || "").slice(0, 160);
    var internal = /^(SEA ESTATES|ES Realty) listing$/i.test(source);
    var identity = String(raw.propertyIdentity || raw.canonicalPropertyId || (internal ? "catalog:" + id : "")).trim();
    var url = String(raw.sourceUrl || raw.source_url || raw.url || (internal && id ? "#/listing/" + encodeURIComponent(id) : "")).slice(0, 500);
    var verifiedSale = raw.evidenceKind === "verified-sale" && raw.verified === true && date(raw.saleDate) != null && !!raw.verificationReference;
    return { id: id, title: String(raw.title || "").slice(0, 160), source: source, sourceUrl: url,
      retrievedAt: String(raw.retrievedAt || raw.retrieved_at || "").slice(0, 40),
      priceAsOf: String(raw.priceAsOf || raw.priceDate || raw.published_at || raw.listedAt || "").slice(0, 40),
      municipality: place(raw.municipality || raw.city || raw.town), barangay: norm(raw.barangay), province: norm(raw.province || raw.state),
      propertyType: type(raw.propertyType || raw.property_type), price: Math.round(price), lotArea: lot, floorArea: floor,
      pricePerSqm: Math.round(price / lot), isAskingPrice: !verifiedSale, evidenceKind: verifiedSale ? "verified-sale" : "asking",
      verified: verifiedSale, verificationReference: verifiedSale ? raw.verificationReference : "", saleDate: verifiedSale ? raw.saleDate : "",
      propertyIdentity: identity, saleContext: raw.saleContext || raw.sale_context || "unknown", condition: raw.condition || "unknown",
      useGroup: norm(raw.useGroup || raw.landUse || raw.classificationUse).toLowerCase(),
      areaBasis: raw.areaBasis || "unspecified", locationInferred: raw.locationInferred === true,
      synthetic: raw.synthetic === true || raw.isBenchmark === true,
      numericalAllowed: raw.numericalAllowed !== false && !raw.priceConflict && !raw.priceRange && !raw.priceFrom,
      includesMembership: raw.includesMembership === true, corner: raw.corner === true ? true : raw.corner === false ? false : null };
  }
  function summary(records, opts) {
    opts = opts || {};
    var normalized = (Array.isArray(records) ? records : []).map(function (r) { return normalize(r, r && r.sourceType || opts.sourceType); }).filter(Boolean);
    var seen = Object.create(null), eligible = [], rejected = [], context = [];
    var now = date(opts.valuationDate) || Date.now();
    var min = 3, maxAge = 180;
    normalized.forEach(function (r) {
      if (r.municipality !== place(opts.municipality)) return;
      if (opts.barangay && r.barangay && r.barangay !== norm(opts.barangay)) return;
      if (opts.propertyType && r.propertyType && r.propertyType !== type(opts.propertyType)) return;
      var key = r.propertyIdentity || r.sourceUrl || r.source + ":" + r.id;
      if (key && seen[key]) return;
      if (key) seen[key] = true;
      context.push(r);
      var reasons = [], stamp = date(r.priceAsOf), lotRatio = positive(opts.area) ? r.lotArea / opts.area : 0;
      if (!r.isAskingPrice) reasons.push("completed-sale records are separate from asking evidence");
      if (!r.numericalAllowed || r.synthetic) reasons.push("range, sample, conflict or synthetic record");
      if (!r.sourceUrl || !r.propertyIdentity) reasons.push("source or property identity missing");
      if (!r.barangay || !opts.barangay || r.locationInferred || (r.province && r.province !== "BATANGAS")) reasons.push("precise locality not established");
      if (!r.propertyType) reasons.push("property type missing");
      if (!r.useGroup || !opts.useGroup || r.useGroup !== opts.useGroup) reasons.push("land-use segment not established");
      if (stamp == null || stamp > now || (now - stamp) / 86400000 > maxAge) reasons.push("price date missing, future or older than 180 days");
      if (lotRatio < .5 || lotRatio > 2) reasons.push("lot size outside provisional similarity band");
      if (r.includesMembership) reasons.push("membership value not separated from property price");
      if (r.saleContext === "unknown" || !opts.saleContext || r.saleContext !== opts.saleContext) reasons.push("developer/resale context not matched");
      if (r.corner == null || !!opts.corner !== r.corner) reasons.push("corner status not matched");
      if (type(opts.propertyType) === "HOUSE_LOT") {
        var floorRatio = positive(opts.floorArea) ? r.floorArea / opts.floorArea : 0;
        if (floorRatio < .5 || floorRatio > 2) reasons.push("built-up area not comparable");
        if (r.condition === "unknown" || r.condition !== opts.condition) reasons.push("building condition not matched");
        if (r.areaBasis !== "total-built-up" && r.areaBasis !== "gross-floor") reasons.push("floor-area definition missing");
      }
      if (reasons.length) rejected.push({ id: r.id, sourceUrl: r.sourceUrl, reasons: reasons }); else eligible.push(r);
    });
    // There is no outlier deletion: show the observed spread and warn if wide.
    var indication = null;
    if (eligible.length >= min) {
      var totals = eligible.map(function (r) { return type(opts.propertyType) === "VACANT_LOT" ? r.price / r.lotArea * opts.area : r.price; });
      indication = { value: Math.round(median(totals)), low: Math.round(Math.min.apply(Math, totals)), high: Math.round(Math.max.apply(Math, totals)), count: eligible.length,
        method: type(opts.propertyType) === "VACANT_LOT" ? "Median eligible asking rate × subject lot area" : "Median eligible whole house-and-lot asking prices; buildings not added again",
        spreadWarning: Math.max.apply(Math, totals) / Math.min.apply(Math, totals) > 2,
        basis: "Advertised asking prices, not achieved sales or a statistical confidence interval" };
    }
    return { count: context.length, medianPricePerSqm: Math.round(median(context.map(function (r) { return r.pricePerSqm; }))),
      sourceType: context.map(function (r) { return r.source; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(", "), records: context.slice(0, 8),
      eligibleCount: eligible.length, rejected: rejected, askingIndication: indication,
      policy: "Provisional: at least 3 identified listings, matching locality/type/context/corner, prices within 180 days and 0.5–2× area similarity",
      status: indication ? "asking-indication-available" : context.length ? "context-only-insufficient-evidence" : "no-comparable-data" };
  }
  /* Bank listings near the subject, from data/comparables/batangas-latest.json
     (refreshed monthly by .github/workflows/comparables-monthly.yml). DISPLAY
     ONLY: bank "as is, where is" prices are not resale prices, so they are shown
     beside the estimate and never enter computeEstimate().
     subject: { municipality, barangay, type: "vacant_lot"|"house_lot", area,
                landPerSqm, total, valuationDate }
     Ranking: same barangay first, then the same kind (vacant / built), then the
     closest lot size. "Tightly aligned" is LandValuePH's measure: the smallest
     band around the median (5-40%) that holds at least 60% of the records. */
  function bankNearby(snapshot, subject, limit) {
    var all = (snapshot && Array.isArray(snapshot.records)) ? snapshot.records : [];
    var town = norm(subject && subject.municipality), brgy = norm(subject && subject.barangay);
    var vacantSubject = subject && subject.type === "vacant_lot";
    var isVacant = function (r) { return r.kind === "vacant_lot" || r.kind === "industrial_lot"; };
    var pool = all.filter(function (r) { return norm(r.municipality) === town && r.pricePerSqmLot > 0; });
    var sameKind = pool.filter(function (r) { return isVacant(r) === vacantSubject && r.kind !== "industrial_lot"; });
    var area = positive(subject && subject.area);
    var ranked = pool.slice().sort(function (a, b) {
      var ka = (norm(a.barangay) === brgy ? 0 : 2) + (isVacant(a) === vacantSubject ? 0 : 1);
      var kb = (norm(b.barangay) === brgy ? 0 : 2) + (isVacant(b) === vacantSubject ? 0 : 1);
      if (ka !== kb) return ka - kb;
      if (area) return Math.abs(Math.log(a.lotArea / area)) - Math.abs(Math.log(b.lotArea / area));
      return a.price - b.price;
    });
    var rates = sameKind.map(function (r) { return r.pricePerSqmLot; });
    var med = rates.length >= 3 ? Math.round(median(rates)) : null;
    var cluster = null;
    if (med) {
      for (var pct = 5; pct <= 40; pct += 5) {
        var inBand = rates.filter(function (v) { return Math.abs(v / med - 1) <= pct / 100; }).length;
        if (inBand / rates.length >= 0.6) { cluster = { pct: pct, count: inBand }; break; }
      }
    }
    var newest = pool.reduce(function (m, r) { return r.observedOn > m ? r.observedOn : m; }, "");
    var subjectRate = vacantSubject ? positive(subject && subject.landPerSqm) : (area ? positive(subject && subject.total) / area : 0);
    return {
      municipality: town, total: pool.length, sameKind: sameKind.length,
      inBarangay: pool.filter(function (r) { return norm(r.barangay) === brgy; }).length,
      medianPricePerSqm: med, cluster: cluster, newest: newest || null,
      generatedOn: (snapshot && snapshot.generatedOn) || null,
      sources: pool.map(function (r) { return r.source; }).filter(function (v, i, a) { return a.indexOf(v) === i; }),
      subjectPricePerSqm: subjectRate ? Math.round(subjectRate) : null,
      subjectVsMedian: med && subjectRate ? Math.round((subjectRate / med - 1) * 1000) / 1000 : null,
      records: ranked.slice(0, limit || 6)
    };
  }

  return { normalize: normalize, summary: summary, median: median, place: place, bankNearby: bankNearby };
});
