/* The Value Guide's reference calculation.
 *
 * Clean-room implementation of the LandValuePH published methodology: a BIR
 * zonal base, a market-indicator factor, one additive net of thirteen published
 * question factors, and a replacement-cost building component. It reuses the
 * storefront estimator for everything that is NOT pricing - the BIR lookup,
 * coverage metadata, ownership review, comparables and transaction options -
 * and overwrites only the arithmetic, so the two calculators cannot drift on
 * provenance while still disagreeing on the answer by design.
 *
 * Provenance of every constant below is recorded in
 * docs/specs/value-guide-3-step.md §2. Rate constants come from LandValuePH's
 * shipped client bundle and from the purchased report LVPH-D-9531904C; the
 * bundle's display chip and the report's own arithmetic disagree on CHB
 * (15,000 vs 16,000) and the report wins, because 16,000 x 120 sqm is the
 * figure that reconciles to the printed building value.
 *
 * There is deliberately no valuation year and no escalation factor. That was
 * proposed, tested against PSA construction statistics and rejected: PSA's
 * national residential average fell from 14,429 (Jan 2025) to 14,081.64 (May
 * 2026) while CMRPI materials grew 1.3%/yr, so no published source supports a
 * 2%/yr uplift, and the uplift was worth only 1.1% of the total. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ESREALTY_VG_FLOW = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Land and building now come from the public estimator (js/estimator.js), so
     the back-office guide and the public Value Guide give the same figure for
     the same inputs. The guide adds only its question net on the land. The old
     MARKET_IND (1.174) was copied from one LandValuePH report whose own vacant-lot
     report valued the same lot at 2.5x; tested against 2026-10 Batangas listings
     it priced homes ~32% under asking. See
     docs/plans/2026-10-14-value-guide-accuracy-plan.md. */
  var MODEL = {
    RANGE_LOW: 0.85,
    RANGE_HIGH: 1.30,
    DEP_CAP: 0.95, /* matches data/zonal-config.json depreciation.maxPct */
    /* Bound on the summed net. The published maxima across the land factors add
       up to -24.5%, so without a floor a user who answers every question at its
       worst would take a quarter off the BIR base and the report would have no
       way to say the answer had stopped being credible. */
    NET_FLOOR: -0.15,
    NET_CAP: 0.15
  };

  var SEC_LAND_TERRAIN = "Land & Terrain";
  var SEC_NEIGHBOURING = "Neighbouring";
  var SEC_LEGAL = "Legal & Environment";
  /* Everything outside SEC_LAND sections is applied to the improvement, which
     is what stops a house question from moving a vacant lot's value. */
  var LAND_SECTIONS = {};
  LAND_SECTIONS[SEC_LAND_TERRAIN] = 1;
  LAND_SECTIONS[SEC_NEIGHBOURING] = 1;
  LAND_SECTIONS[SEC_LEGAL] = 1;

  /* Thirteen published factors. `bp` is hundredths of a percent and every option
     sits inside the range published on /methodology; tests/value_guide_flow_node.js
     asserts that and fails if a future edit widens one. */
  var FACTORS = [
    { id: "lotShape", input: "lotShape", section: SEC_LAND_TERRAIN, label: "Lot shape", min: -500, max: 0, options: [
      { value: "0", label: "Regular / rectangular", bp: 0 },
      { value: "-150", label: "Slightly irregular", bp: -150 },
      { value: "-300", label: "Irregular", bp: -300 },
      { value: "-500", label: "Severely irregular or pie-cut", bp: -500 }] },
    { id: "terrain", input: "terrain", section: SEC_LAND_TERRAIN, label: "Terrain and slope", min: -700, max: 0, options: [
      { value: "0", label: "Level", bp: 0 },
      { value: "-700", label: "Sloping", bp: -700 }] },
    { id: "elevation", input: "elevation", section: SEC_LAND_TERRAIN, label: "Elevation vs road", min: -700, max: 0, options: [
      { value: "0", label: "At road level", bp: 0 },
      { value: "-700", label: "Below road", bp: -700 }] },
    { id: "cornerExposure", input: "corner", type: "bool", section: SEC_LAND_TERRAIN, label: "Corner exposure", min: 0, max: 500, options: [
      { value: "corner", label: "Frontage on two roads", bp: 250 }] },
    { id: "frontage", input: "frontage", section: SEC_LAND_TERRAIN, label: "Frontage", min: -100, max: 150, options: [
      { value: "-100", label: "Narrow, 6 m", bp: -100 },
      { value: "0", label: "About average, 12 m", bp: 0 },
      { value: "150", label: "Wide, 20 m", bp: 150 }] },
    { id: "roadAccess", input: "roadAccess", section: SEC_LAND_TERRAIN, label: "Road access", min: -200, max: 200, options: [
      { value: "-200", label: "Rough or unmade access", bp: -200 },
      { value: "0", label: "Ordinary access", bp: 0 },
      { value: "50", label: "Paved barangay road", bp: 50 },
      { value: "200", label: "Paved, wide, direct to the highway", bp: 200 }] },
    /* Title, estate and occupancy carry the reference's published deductions rather
     than the old conflated range, and keep the value vocabulary the rest of the
     app already uses (estimator.js records the same strings on result.ownership),
     so a saved draft that recorded titled_previous still resolves. */
    { id: "titleDoc", input: "titleDoc", section: SEC_LEGAL, label: "Title", min: -1500, max: 0, options: [
      { value: "titled_self", label: "Clean title in the owner's name", bp: 0 },
      { value: "titled_previous", label: "Title still in a previous owner's name", bp: -800 },
      { value: "tax_declaration", label: "Tax declaration only", bp: -1500 }] },
    { id: "inheritance", input: "inheritance", section: SEC_LEGAL, label: "Estate settled", min: -1000, max: 0, options: [
      { value: "settled", label: "Settled", bp: 0 },
      { value: "pending", label: "Inheritance pending", bp: -1000 }] },
    { id: "ownership", input: "ownership", section: SEC_LEGAL, label: "Occupancy", min: -2500, max: 0, options: [
      { value: "empty", label: "Owner-occupied", bp: 0 },
      { value: "caretaker", label: "Caretaker only", bp: -500 },
      { value: "tenants", label: "Tenants", bp: -1000 },
      { value: "informal_settlers", label: "Informal settlers", bp: -2500 }] },
    { id: "floodRisk", input: "floodRisk", section: SEC_LEGAL, label: "Flood exposure", min: -500, max: 0, options: [
      { value: "0", label: "Not known to flood", bp: 0 },
      { value: "-150", label: "Floods in heavy rain", bp: -150 },
      { value: "-300", label: "Floods seasonally", bp: -300 },
      { value: "-500", label: "Floods routinely", bp: -500 }] },
    { id: "infrastructure", input: "infrastructure", section: SEC_NEIGHBOURING, label: "Utilities", min: 0, max: 200, options: [
      { value: "0", label: "Existing services only", bp: 0 },
      { value: "50", label: "Paved approach and drainage", bp: 50 },
      { value: "200", label: "New road, utility or transit project", bp: 200 }] },
    { id: "zonalRecency", input: "zonalRecency", section: SEC_LEGAL, label: "Zonal schedule recency", min: -200, max: 0, options: [
      { value: "0", label: "Schedule current", bp: 0 },
      { value: "-100", label: "Schedule a few years old", bp: -100 },
      { value: "-200", label: "Schedule is materially stale", bp: -200 }] }
  ];

  /* The ten questions the reference asks, in its order, each bound to the
     factor that consumes it. `pickInputs` is the only route from form state
     into the model, so a question can never be collected without being
     scored, and a factor can never lack a question. The keys below are the
     draft field names the form writes, which is why they differ from the
     factor ids: the pre-2026-10 form wrote lotShape/terrain/roadAccess while
     the calculator read nothing that any control wrote, which is why every
     methodology row printed 0.00%. */
  var QUESTIONS = [
    { id: "lotShape",   label: "Lot shape",        input: "shape",        factorId: "lotShape" },
    { id: "terrain",    label: "Terrain and slope", input: "topography",  factorId: "terrain" },
    { id: "elevation",  label: "Elevation vs road", input: "elevation",    factorId: "elevation" },
    { id: "frontage",   label: "Frontage",         input: "frontage",     factorId: "frontage" },
    { id: "roadAccess", label: "Road access",      input: "access",       factorId: "roadAccess" },
    { id: "floodRisk",  label: "Flood risk",       input: "flood",        factorId: "floodRisk" },
    { id: "utilities",  label: "Utilities",        input: "utilities",    factorId: "infrastructure" },
    { id: "titleDoc",   label: "Title",            input: "titled",       factorId: "titleDoc" },
    { id: "inheritance", label: "Estate settled",  input: "estate_settled", factorId: "inheritance" },
    { id: "ownership",  label: "Occupancy",        input: "occupancy",    factorId: "ownership" }
  ];

  /* Copies only answered questions onto the input object, keyed by the field the
     matching factor reads. An unanswered key is omitted entirely rather than sent
     as "", so the factor layer can tell "not answered" from an option whose
     adjustment happens to be zero. */
  function pickInputs(draft) {
    var d = draft || {}, out = {};
    for (var i = 0; i < QUESTIONS.length; i++) {
      var q = QUESTIONS[i], v = d[q.input];
      if (v === undefined || v === null || v === "") continue;
      var f = factorById(q.factorId);
      out[f ? f.input : q.input] = v;
    }
    /* Corner is asked in step 1 rather than Details, and is a boolean, so it
       does not appear in QUESTIONS. */
    if (d.corner) out.corner = true;
    return out;
  }

  /* The four classifications the form offers. data/batangas-zonal.json still
     carries all 35 BIR codes and the estimator still resolves any of them, so a
     draft saved against the old picker keeps pricing; these are the codes a new
     answer maps to. Institutional (X), General Purposes (GP), Cemetery (CL) and
     the 28 narrower agricultural classes are therefore unreachable from the form,
     which is the accepted cost of matching the reference's four options. */
  var CLASSIFICATIONS = [
    { value: "RR", label: "Residential" },
    { value: "CR", label: "Commercial" },
    { value: "I", label: "Industrial" },
    { value: "A50", label: "Agricultural" }
  ];

  /* The BIR schedule is reissued periodically. A rate drawn from a schedule more
     than three years old is stale by the publisher's own cadence, and the
     published recency factor tops out at -200 bp for a materially stale one.
     effectivityDate comes from the matched rate, so this is a lookup rather than
     a question. Returns NaN when no date is available, which keeps the old
     "not assessed" behavior instead of assuming a current schedule. */
  var RECENCY_YEARS = 3;
  function zonalRecencyBp(input) {
    var raw = input && (input.effectivityDate || input.zonalEffectivityDate);
    if (!raw) return NaN;
    var d = new Date(raw);
    if (isNaN(d.getTime())) return NaN;
    var years = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years <= RECENCY_YEARS) return 0;
    if (years < RECENCY_YEARS * 2) return -100;
    return -200;
  }

  function factorById(id) {
    for (var i = 0; i < FACTORS.length; i++) if (FACTORS[i].id === id) return FACTORS[i];
    return null;
  }

  /* NaN, never 0, for a factor that was not answered. The old code returned 0,
     which made "the user skipped this" indistinguishable from "the user picked
     the option whose adjustment is zero" and let a row print 0.00% on the report
     without saying anything was assessed at all. An unmatched answer is equally
     unassessed: a stale value from an older form is not evidence. */
  function factorBp(f, input) {
    var raw = input ? input[f.input] : null;
    /* A boolean factor is different from a choice. An unticked corner box is an
       answer - the property is not on a corner - not a skipped question, so it
       scores its own zero rather than NaN. Treating it as NaN put "Corner
       exposure" in the report's list of things nobody checked, which is false:
       the user was asked and answered. */
    if (f.type === "bool") return raw ? f.options[0].bp : 0;
    /* zonalRecency is derived from the matched rate's schedule date rather than
       answered, so its input is the date and not a stored choice. Resolving it
       here rather than in netOf keeps the printed table and the applied net
       reading from the same value. */
    if (f.id === "zonalRecency") return zonalRecencyBp(input);
    if (raw == null || raw === "") return NaN;
    for (var i = 0; i < f.options.length; i++) {
      if (String(f.options[i].value) === String(raw)) return f.options[i].bp;
    }
    return NaN;
  }

  /* Additive: every bp is summed once and the total applied once. Compounding
     two +50 bp answers would give +100.25 bp, which is not what the published
     ranges describe. */
  /* Returns the net and whether the limit bound. The clamp used to be silent, so
     a property whose adverse answers summed past the floor reported a net the
     reader could not reconcile with the table above it. Callers that print the
     net must disclose the limit when netClamped is set. */
  function netOf(input, landOnly) {
    var bp = 0;
    for (var i = 0; i < FACTORS.length; i++) {
      var f = FACTORS[i];
      if (landOnly && !LAND_SECTIONS[f.section]) continue;
      /* A skipped factor contributes nothing. It is not the same as a factor
         scored zero, but it cannot move the number either way, so summing it as
         0 is arithmetically right; the difference is recorded in assumptions[] so
         the report can say which rows went unassessed. */
      var b = factorBp(f, input);
      if (b === b) bp += clampBp(f, b);
    }
    var net = bp / 10000;
    var clamped = net < MODEL.NET_FLOOR || net > MODEL.NET_CAP;
    return {
      net: clamped ? (net < MODEL.NET_FLOOR ? MODEL.NET_FLOOR : MODEL.NET_CAP) : net,
      clamped: clamped,
      /* The unclamped sum, so a report can show what the answers came to before
         the limit bound. */
      raw: net
    };
  }

  /* An option's bp never leaves the range its factor declares. The old code
     declared min/max for documentation and never checked them. */
  function clampBp(f, bp) {
    if (typeof f.min === "number" && bp < f.min) return f.min;
    if (typeof f.max === "number" && bp > f.max) return f.max;
    return bp;
  }

  /* All of them, answered or not. The report and the PDF both print the whole
     published table, so the row is never missing; `assessed` and a null bp carry
     the distinction that the old unconditional 0% threw away. */
  function sectionsOf(input) {
    var out = [];
    for (var i = 0; i < FACTORS.length; i++) {
      var f = FACTORS[i];
      var bp = factorBp(f, input), assessed = bp === bp;
      out.push({ id: f.id, label: f.label, section: f.section, min: f.min, max: f.max,
        bp: assessed ? bp : null, assessed: assessed,
        appliedTo: LAND_SECTIONS[f.section] ? "land" : "improvement" });
    }
    return out;
  }

  function applyModel(base, opts) {
    /* Review Focus 3: a failed lookup has no pricing fields to overwrite, and
       inventing them would turn "no BIR rate for this classification" into a
       number. */
    if (!base || base.available === false) return base;

    var r = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) r[k] = base[k];
    opts = opts || {};

    /* Every surviving factor is a land or ownership characteristic, so there is one
       net and it applies to the land. There is no building-section net: the ten
       questions describe the lot and the paperwork, and the building is priced by
       cost approach alone. This replaced a bldgNet that became permanently zero
       when its only factor (demand) was retired. */
    var net = netOf(opts, true);
    var landNet = net.net;
    /* zonalRecency is derived, not asked (spec decision 6): the BIR schedule date
       for the matched rate is a fact about the source, so asking the user would be
       asking them something we can look up. An old schedule is a real reason to
       discount; leaving it permanently unassessed put a row in every report's
       "what we didn't check" and made skippedCount always at least 1. */
    var recency = zonalRecencyBp(opts);

    /* The public estimator's land (BIR base x the SEA ESTATES factor stack) and
       building (rate x floor area x (1 - depreciation) + features), unchanged.
       The guide's own question net adjusts the land only. */
    var marketInd = Number(base.appliedMultiple) || (base.birZonalValue ? (Number(base.landValue) || 0) / base.birZonalValue : 1);
    /* The guide scores corner exposure in its own net (cornerExposure), so the
       estimator's corner premium is taken back out first - otherwise a corner
       lot would be charged twice. Site/ownership answers never reach the
       estimator's own tables from here: the guide's values ("-700", "titleDoc")
       use a different vocabulary, asserted in tests. */
    var cornerPct = base.corner && base.corner.applied ? Number(base.corner.pct) || 0 : 0;
    r.landValue = Math.round((Number(base.landValue) || 0) / (1 + cornerPct) * (1 + landNet));
    r.landPerSqm = r.area ? Math.round(r.landValue / r.area) : 0;

    var rcn = Number(base.buildCostPerSqm) || 0;
    var life = 40;
    var age = Number(r.ageMidpoint) || 0;
    var dep = (Number(base.depreciatedPct) || 0) / 100;

    if ((opts.type || r.type) === "vacant_lot") {
      r.improvement = 0;
    } else {
      r.improvement = Number(base.improvement) || 0;
    }

    r.total = r.landValue + r.improvement;
    r.rangeLowFactor = MODEL.RANGE_LOW;
    r.rangeHighFactor = MODEL.RANGE_HIGH;
    r.low = Math.round(r.total * MODEL.RANGE_LOW);
    r.high = Math.round(r.total * MODEL.RANGE_HIGH);
    r.perSqm = r.area ? Math.round(r.total / r.area) : 0;

    /* Public-model fields the report, the tax engine and the PDF read. `value` and
       `unadjustedTotal` are written here as well: the estimator set them from its
       own superseded calculation and applyModel only overwrote `total`, so any
       panel reading r.value reported a different figure from the one on screen.
       applyModel is now the only writer of a pricing field. */
    r.value = r.total;
    r.unadjustedTotal = r.total;
    r.marketGuideEstimate = r.total;
    r.marketGuideRatePerSqm = r.perSqm;
    r.recommendedAskingPrice = r.high;
    r.ownershipAdjustmentPct = 0;
    r.floorsMultiplier = 1;
    r.buildCostPerSqm = rcn;
    r.ageMidpoint = age;
    r.depreciatedPct = Math.round(dep * 10000) / 100;
    r.landMethod = "factor";
    r.timeIndex = null;
    r.factorBaseline = null;
    /* Null rather than this model's factor: the shared disclosure builder in
       js/value_guide_reference.js would otherwise print "SEA ESTATES market
       band factor" on a guide that no longer uses it. The model is named in
       referenceModel and in the report copy instead. */
    r.factors = null;
    r.factorStack = null;
    r.appliedMultiple = null;
    r.marketGuide = Object.assign({}, r.marketGuide, {
      value: r.total,
      landValue: r.landValue,
      comparablePricesUsed: false,
      sourceType: "SEA ESTATES factor model"
    });
    var sections = sectionsOf(opts);
    /* Every question the user skipped, named. A report that silently omitted them
       would read as though the guide had checked and found nothing. */
    r.assumptions = sections.filter(function (s) { return !s.assessed; })
      .map(function (s) { return { id: s.id, label: s.label }; });
    r.referenceModel = {
      name: "SEA ESTATES factor model",
      marketInd: marketInd,
      net: landNet,
      netClamped: net.clamped,
      netLimit: MODEL.NET_FLOOR,
      netSumBeforeLimit: net.raw,
      buildingNet: null,
      sections: sections,
      questionCount: QUESTIONS.length,
      skippedCount: r.assumptions.length,
      rcnRate: rcn,
      usefulLife: life,
      depCap: MODEL.DEP_CAP,
      depreciatedPct: r.depreciatedPct,
      flat: true
    };
    return r;
  }

  function compute(opts, est) {
    if (!est || typeof est.estimate !== "function") throw new Error("FLOW.compute requires the estimator module");
    /* Promise.resolve keeps this correct whether estimate() is async today or
       becomes sync tomorrow. */
    return Promise.resolve(est.estimate(opts)).then(function (base) {
      var r = applyModel(base, opts);
      r.integrity = est.core.integrityCheck(r);
      return r;
    });
  }

  /* The model callout is fixed copy: it names our model, names the other one,
     and states the measured divergence so the reader cannot mistake one figure
     for the other. It is the first thing reportSections returns, so the report
     cannot open without it. */
  var MODEL_CALLOUT =
"Derived from published BIR zonal values, adjusted for documented property factors. "
      + "Land and building use the same SEA ESTATES factor model as the public site calculator, "
      + "so both give the same base figure; this guide also applies the answers below to the land. "
      + "Both are planning figures, not a real estate appraisal under RA 9646.";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function peso(n) {
    return "₱" + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function pct(n) { return ((Number(n) || 0) * 100).toFixed(2) + "%"; }

  function summaryOpts(result) {
    var r = result || {};
    return { municipality: r.municipality, barangay: r.barangay, propertyType: r.type,
      area: r.area, floorArea: r.floorArea, corner: !!r.cornerApplied,
      saleContext: r.saleContext, useGroup: r.useGroup || r.classification };
  }

  function summarize(result, rows, est) {
    if (!rows.length || !est || !est.core || typeof est.core.comparableSummary !== "function") return null;
    return est.core.comparableSummary(rows, summaryOpts(result));
  }

  /* Our own catalog, filtered the way the storefront already filters it. The
     estimator's own loader is private to that read-only file, so the filter set
     is restated here; cost if the two drift is a listing that should have been
     offered as context not being offered. */
  function loadComparables(opts, est) {
    var api = typeof window !== "undefined" && window.ESREALTY_LISTINGS_API;
    if (!api || typeof api.list !== "function") return Promise.resolve([]);
    opts = opts || {};
    var filters = {
      state: "Batangas",
      city: opts.municipality,
      offer_type: "sale",
      status: "available",
      property_type: opts.type === "house_lot" ? "house-and-lot" : "lot-only",
      per_page: 50,
      sort: "date_desc"
    };
    var request = api.list(filters).then(function (payload) {
      var rows = payload && Array.isArray(payload.data) ? payload.data : [];
      return rows.map(function (row) {
        return est.core.normalizeComparable(row, "SEA ESTATES listing");
      }).filter(Boolean);
    }).catch(function () { return []; });
    /* A hung request must not hold the report hostage. */
    var timeout = new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve([]); }, 2500);
      if (timer && timer.unref) timer.unref();
    });
    return Promise.race([request, timeout]);
  }

  /* Context only. Nothing in this function writes to a pricing field, and
     tests/value_guide_flow_node.js freezes the golden totals across it. */
  function applyComparables(result, list, est) {
    if (!result) return result;
    var rows = Array.isArray(list) ? list : [];
    result.comparableListingCount = rows.length;
    result.comparableSummary = rows.length ? summarize(result, rows, est) : null;
    return result;
  }

  function comparablesSection(summary, rows) {
    var head = '<div data-vg-comparables class="mt-16"><h3>Our own listings, for context</h3>'
      + "<p>Asking advertisements from our own catalog, not completed sales. "
      + "Shown for context only; no listing price enters the calculation above.</p>";
    /* No Batangas listings exist in the catalog yet, so this branch is the normal
     case rather than an edge. Say which is true, or a blank block reads as
     "we checked and found nothing to compare". */
    if (!rows.length) return head + "<p>No Batangas listings in our catalog for this municipality yet, "
      + "so there is nothing to compare this figure against. Nothing here has been checked "
      + "against completed sales.</p></div>";
    var s = summary || {};
    var items = (s.records || rows).slice(0, 8).map(function (rec) {
      return "<li>" + esc(rec.title || rec.id || "Listing") + " · " + peso(rec.price) + "</li>";
    }).join("");
    return head + "<p>" + rows.length + " listing(s)"
      + (s.medianPricePerSqm ? "; median " + peso(s.medianPricePerSqm) + "/sqm" : "")
      + (s.askingIndication ? "; indication " + peso(s.askingIndication.value) : "") + ".</p>"
      + (items ? "<ul>" + items + "</ul>" : "")
      + '<p class="dim tiny">' + esc(s.policy || "") + "</p></div>";
  }

  function methodologySection(result) {
    var model = (result && result.referenceModel) || {};
    var applied = {};
    (model.sections || []).forEach(function (s) { applied[s.id] = s; });
    /* Every row prints, answered or not, so the table always shows the full
       model. A row that was never answered reads "Not assessed" rather than
       0.00%: the old rendering could not tell those apart, so a skipped question
       looked like a checked one that found nothing. */
    var rows = FACTORS.map(function (f) {
      var hit = applied[f.id];
      var assessed = !!(hit && hit.assessed);
      var cell = assessed
        ? (hit.bp > 0 ? "+" : "") + (hit.bp / 100).toFixed(2) + "%"
        : "Not assessed";
      return '<tr data-vf="' + esc(f.id) + '"' + (assessed ? "" : ' data-vf-unassessed')
        + '><th scope="row">' + esc(f.label) + "</th><td>" + esc(f.section)
        + "</td><td>" + cell + "</td></tr>";
    }).join("");
    var skipped = Array.isArray(result && result.assumptions) ? result.assumptions : [];
    var skipList = skipped.length
      ? "<p><b>What we didn't check:</b> " + skipped.map(function (a) { return esc(a.label); }).join(", ") + ".</p>"
      : "<p>Every question was answered.</p>";
    /* Without this the table and the total contradict each other: adverse
       answers can sum past the limit, the excess is dropped, and the printed
       "Applied net" would not reconcile with the printed rows. */
    var clampLine = model.netClamped
      ? "<p><b>Limit reached:</b> the adverse answers above sum to "
        + pct(model.netSumBeforeLimit) + ", past the " + pct(model.netLimit)
        + " limit this model applies to land. The figure above uses "
        + pct(model.net) + ", so some of the stated conditions did not affect it.</p>"
      : "";
    /* The count is read off the question list rather than typed. The reference
       prints its own count from a runtime table, so a hard-coded "nine" here
       would drift the moment the list changed. */
    return '<div data-vg-methodology class="mt-16"><h3>Methodology</h3>'
      + "<p>BIR zonal base × market-indicator factor " + (Math.round((Number(model.marketInd) || 0) * 1000) / 1000)
      + ", then one additive net of the " + QUESTIONS.length + " published answers below. Every answer is added once and "
      + "the total is applied once; nothing is compounded.</p>"
      + '<table><thead><tr><th>Question</th><th>Section</th><th>Applied</th></tr></thead><tbody>'
      + rows + "</tbody></table>"
      + '<p><b>Applied net:</b> ' + pct(model.net) + " on land.</p>"
      + clampLine
      + skipList
      + '<p class="dim small">Construction rates are flat and never escalated: '
      + peso(model.rcnRate) + " per sqm for this build type, depreciated straight-line to a "
      + MODEL.DEP_CAP * 100 + "% cap over " + (model.usefulLife || 40) + " years.</p></div>";
  }

  /* The report body after the figures: model callout first, then comparables,
     then the methodology that produced the number. */
  function reportSections(result, est, list) {
    var rows = Array.isArray(list) ? list : [];
    var summary = (result && result.comparableSummary) || summarize(result, rows, est);
    return [MODEL_CALLOUT, comparablesSection(summary, rows), methodologySection(result)].join("\n");
  }

  return { MODEL: MODEL, FACTORS: FACTORS, QUESTIONS: QUESTIONS, pickInputs: pickInputs,
           CLASSIFICATIONS: CLASSIFICATIONS,
           SEC_LAND_TERRAIN: SEC_LAND_TERRAIN,
           SEC_NEIGHBOURING: SEC_NEIGHBOURING, SEC_LEGAL: SEC_LEGAL,
           netOf: netOf, sectionsOf: sectionsOf, factorBp: factorBp, clampBp: clampBp,
           compute: compute,
           MODEL_CALLOUT: MODEL_CALLOUT, loadComparables: loadComparables,
           applyComparables: applyComparables, reportSections: reportSections };
});
