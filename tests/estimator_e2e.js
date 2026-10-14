"use strict";
/* Batangas Value Guide funnel end-to-end (guest storefront, Phase 4):
   1) funnel is a section in #/home; screen 1 = purpose/stage/type + Batangas-only location
   2) gating: estimate hidden until municipality+barangay+classification+area are set
   3) depth-1 flow (Balayan / BACLARAN / all street / CR) vs core.computeEstimate
   4) all-other-streets fallback (depth 2) via the "Street not listed" button
   5) house & lot flow: screen 2 inputs -> improvement included in report
   6) report sections (14), coverage honesty, lead block + submit status */
window.__msChecks = [];
window.__msLog = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(fn, tries, gap) {
  for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(gap); }
  return fn();
}
const ESP = 120;
const MONEY = n => "₱" + new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(Math.round(n || 0));
const estApi = () => window.ESREALTY_EST || null;
const q = s => document.querySelector(s);
const qa = s => Array.prototype.slice.call(document.querySelectorAll(s));
function stateOpts() {
  const st = estApi()._state();
  return {
    municipality: st.municipality, barangay: st.barangay,
    streetKey: st.allOther ? "" : st.streetKey,
    classification: st.classification, area: st.area,
    corner: st.corner, purpose: st.purpose, type: st.type,
    floorArea: Number(st.floorArea) > 0 ? Number(st.floorArea) : 0,
    floors: st.floors, ageBand: st.ageBand,
    construction: st.construction, features: st.features,
    occupancy: st.occupancy, titleStatus: st.titleStatus, inheritanceStatus: st.inheritanceStatus,
    /* Since 2026-10-14 the site answers (including the location-based
       suggestions) move the land value, so the expected figure must use them. */
    community: st.community, floodRisk: st.floodRisk, roadAccess: st.roadAccess, frontage: st.frontage,
    lotShape: st.lotShape, rightOfWay: st.rightOfWay, elevation: st.elevation, utilities: st.utilities,
    condition: st.condition
  };
}
async function estimateExpected(opts) {
  const api = estApi();
  const row = api._data().index.municipalities.find(m => m.name === opts.municipality);
  const md = await api.loadMunicipality(row.slug);
  return api.core.computeEstimate(api._data().config, api._data().index, md, opts);
}
function setValue(sel, v) { const e = q(sel); e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); }
function setInput(sel, v) { const e = q(sel); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }
(async () => {
  try {
    window.__msLog.push("funnel-e2e start");
    location.hash = "#/home";
    await wait(400);

    await waitFor(() => estApi() && q('[data-est-muni]') && q('[data-est-screen="1"]'), 60, ESP);
    const pt = q('[data-est-muni]') ? q('[data-est-muni]').options.length : 0;
    chk("sf-estimator-section-present", !!q('#sf-estimator') && !!q('[data-est-card]') && !!q('.sf-est'), "root ok");
    chk("funnel-brand-eyebrow", /BATANGAS VALUE GUIDE/.test(document.body.innerText), "");
    chk("homepage-primary-estimate-cta", !!q('.sf-est-hero-actions [data-est-services]') && /Start My Value Guide/.test(q('.sf-est-hero-actions [data-est-services]').textContent), "");
    /* Was: a[href*="state=Batangas"] on the hero. That link applied a filter the
       filter form did not expose, so it always rendered "No properties found"
       with no visible way to undo it. The secondary CTA now points at the
       unfiltered browse page; Batangas is still carried by the value guide,
       which is genuinely Batangas-specific (BIR zonal data), and the state
       filter remains available as a visible, removable chip. */
    chk("homepage-secondary-browse-cta", !!q('.sf-est-hero-actions a[href="#/search"]'), "hrefs=" + Array.prototype.map.call(document.querySelectorAll('.sf-est-hero-actions a'), function (a) { return a.getAttribute('href'); }).join(','));
    chk("homepage-secondary-cta-has-no-hidden-filter", !q('.sf-est-hero-actions a[href*="state="]'), "hero still ships an unexposed state filter");
    chk("homepage-guide-summary-heading", /What your guide includes/.test(document.body.innerText), "");
    chk("screen1-rendered", !!q('[data-est-screen="1"]'), "");
    /* Task 12: the progress bar matches the reference's three steps
       (Location -> Details -> Report), not a longer invented flow. */
    chk("three-step-progress-labels", (function () {
      const ol = q('.sf-est-progress');
      if (!ol) return false;
      const labels = Array.prototype.map.call(ol.querySelectorAll('span'), s => s.textContent.trim());
      return labels.length === 3 && labels[0] === "Location" && labels[1] === "Details" && labels[2] === "Report";
    })(), "progress=" + (q('.sf-est-progress') ? q('.sf-est-progress').textContent.replace(/\s+/g, " ").trim() : "none"));
    chk("screen1-guides-inputs", /LOCATION/.test(q('[data-est-screen="1"]').textContent) && /match the right BIR reference/.test(q('[data-est-screen="1"]').textContent), "");
    chk("region-fixed-batangas", !!q('.sf-est-loc-fixed') && /CALABARZON.*Batangas/.test(q('.sf-est-loc-fixed').textContent), "txt=" + (q('.sf-est-loc-fixed') && q('.sf-est-loc-fixed').textContent));
    chk("mn-options-gte34", pt >= 34, "mn=" + pt);
    chk("legacy-map-removed", !document.getElementById("est-map") && !q('[data-est-step]'), "");
    chk("street-search-input", !!q('[data-est-street-q]'), "");
    chk("classification-starts-residential", !!q('[data-est-class]') && q('[data-est-class]').value === "RR",
      "value=" + (q('[data-est-class]') && q('[data-est-class]').value) + " — Residential is the reference's default");

    q('[data-est-next]').click();
    await wait(60);
    const err0 = q('[data-est-next-hint]');
    chk("gating-error-on-empty", !!err0 && /municipality/.test(err0.textContent), "txt=" + (err0 && err0.textContent));
    chk("error-highlights-muni", !!q('[data-est-muni]') && q('[data-est-muni]').closest(".sf-est-field").classList.contains("sf-est-invalid"), "invalid-class");

    // --- depth 1: Balayan / BACLARAN / all street / CR / 200 / corner ---
    setValue('[data-est-muni]', "BALAYAN");
    await waitFor(() => qa('[data-est-barangay] option').some(o => o.value === "BACLARAN"), 60, ESP);
    chk("barangay-options-loaded", qa('[data-est-barangay] option').length >= 2, "n=" + qa('[data-est-barangay] option').length);
    setValue('[data-est-barangay]', "BACLARAN");
    setInput('[data-est-street-q]', "all street");
    await waitFor(() => qa('[data-est-street]').length > 0, 30, ESP);
    chk("street-list-populated", qa('[data-est-street]').length > 0, "n=" + qa('[data-est-street]').length);
    chk("street-not-listed-button", !!q('[data-est-screen="1"] [data-est-street-all]'), "");
    // Search-filtered street buttons are re-injected via innerHTML on each
    // keystroke; clicking them must still select the street (delegated handler).
    setInput('[data-est-street-q]', "all street");
    await wait(80);
    const filtered = qa('[data-est-street]').filter(b => !b.hasAttribute('data-est-street-all'));
    chk("street-search-filters-list", filtered.length > 0 && filtered.length <= 3 && filtered.some(b => /all street/i.test(b.textContent)), "n=" + filtered.length);
    const streetKey = (filtered.find(b => /all street/i.test(b.textContent)) || qa('[data-est-street]')[0]).getAttribute("data-est-street");
    (filtered.find(b => b.getAttribute("data-est-street") === streetKey) || qa('[data-est-street]')[0]).click();
    await wait(120);
    chk("street-clicked-from-search-selects", !!q('[data-est-street-q]') && String(q('[data-est-street-q]').value).toLowerCase() === "all street" && !!estApi()._state().streetKey && !estApi()._state().allOther, "value=" + ((q('[data-est-street-q]') || {}).value || ""));
    setInput('[data-est-street-q]', "all street");
    chk("street-list-has-combobox-semantics", q('[data-est-street-q]').getAttribute("aria-controls") === "sf-est-street-options", "");
    q('[data-est-street-q]').dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    chk("street-keyboard-highlight", !!q('.sf-est-street-opt.keyboard-focus') && !!q('[data-est-street-q]').getAttribute("aria-activedescendant"), "");
    q('[data-est-street-q]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wait(80);
    chk("street-keyboard-selects", !!estApi()._state().streetKey && !estApi()._state().allOther, "");
    setValue('[data-est-class]', "CR");
    chk("class-select-offers-commercial", Array.from(q('[data-est-class]').options).some(o => o.value === "CR"), "opts=" + q('[data-est-class]').options.length);
    setInput('[data-est-area]', "200");
    const corner = q('[data-est-corner]');
    if (corner && !corner.checked) { corner.checked = true; corner.dispatchEvent(new Event("change", { bubbles: true })); }

    q('[data-est-next]').click();
    await waitFor(() => q('[data-est-screen="2"]'), 30, ESP);
    chk("describe-property-screen-present", !!q('[data-est-screen="2"]') && /Describe your property/.test(q('[data-est-screen="2"] h3').textContent), "");
    chk("screen2-is-revealed", !!q('[data-est-screen="2"]') && q('[data-est-screen="2"]').getBoundingClientRect().top < window.innerHeight, "top=" + (q('[data-est-screen="2"]') && q('[data-est-screen="2"]').getBoundingClientRect().top));
    chk("ownership-title-questions-present", qa('[data-est-ownership]').length === 13, "options=" + qa('[data-est-ownership]').length);
    /* Task 13: the reference's site-review questions render visibly in the
       Details flow as chip groups, each with a "Not sure" skip chip. */
    chk("site-review-groups-visible", (function () {
      const groups = Array.from(document.querySelectorAll(".sf-est-review-group h4")).map(h => h.textContent.trim());
      return ["Surroundings", "Land & access", "The land itself", "Utilities"].every(g => groups.indexOf(g) >= 0);
    })(), "groups=" + Array.from(document.querySelectorAll(".sf-est-review-group h4")).map(h => h.textContent.trim()).join(","));
    chk("site-review-not-sure-chips", ["community", "floodRisk", "roadAccess", "frontage", "lotShape", "rightOfWay", "elevation", "utilities"].every(function (t) {
      const group = document.querySelector('[data-chip-group][data-t="' + t + '"]');
      return !!group && Array.from(group.querySelectorAll("button")).some(b => b.getAttribute("data-val") === "");
    }), "every site-review group offers a Not-sure skip");
    chk("ownership-answers-default-to-not-sure", ["occupancy", "titleStatus", "inheritanceStatus"].every(function (key) {
      const b = q('[data-est-ownership="' + key + '"][data-val="not_sure"]');
      return !!b && b.classList.contains("active") && b.getAttribute("aria-pressed") === "true";
    }), "ownership questions preselect Not sure");
    q('[data-est-next]').click();
    chk("details-advances-straight-to-calculation", !!q('[data-est-screen="3"]') && !q('[data-est-screen="5"]'), "no review screen");
    estApi().mount(); await wait(40);
    chk("same-home-rerender-keeps-calculating-stage", !!q('[data-est-screen="3"]') && /BACLARAN/.test(q('[data-est-screen="3"]').textContent), "");
    const screen3 = q('[data-est-screen="3"]');
    chk("screen3-no-rotating-indicator", !q('[data-est-screen="3"] [data-est-spin]') && !q('[data-est-screen="3"] [data-est-anim-mark]'), "");
    chk("screen3-progress-design", !!q('[data-est-screen="3"] .sf-est-anim-panel') && qa('[data-est-screen="3"] [data-est-stage]').length === 3 && /Calculating your property value/.test(q('[data-est-screen="3"] .sf-est-anim-title').textContent), "");
    await waitFor(() => !!screen3 && screen3.getBoundingClientRect().bottom > 0 && screen3.getBoundingClientRect().top < window.innerHeight, 120, ESP);
    const revealAncestors = [];
    for (let node = screen3; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      revealAncestors.push((node.id || node.className || node.tagName) + ":" + node.scrollTop + "/" + node.scrollHeight + "/" + style.overflowY);
    }
    chk("screen3-is-revealed", !!screen3 && screen3.getBoundingClientRect().bottom > 0 && screen3.getBoundingClientRect().top < window.innerHeight, "top=" + (screen3 && screen3.getBoundingClientRect().top) + " bottom=" + (screen3 && screen3.getBoundingClientRect().bottom) + " scrollY=" + window.scrollY + " h=" + (screen3 && screen3.getBoundingClientRect().height) + " ancestors=" + revealAncestors.join(" | "));
    await waitFor(() => q('[data-est-screen="4"]'), 90, ESP);
    chk("result-heading-is-clear", !!q('#sf-est-result-heading') && /Your guide is ready\./.test(q('#sf-est-result-heading').textContent), "");
    chk("selling-result-design", !!q('.sf-est-selling-result') && /YOUR PROPERTY VALUE GUIDE/.test(q('.sf-est-result-eyebrow').textContent) && !!q('.sf-est-nextstep') && /04/.test(q('.sf-est-step-no').textContent), "");
    chk("result-scroll-cue", !!q('[data-est-scroll-report]') && /Explore calculation details/.test(q('[data-est-scroll-report]').textContent), "");
    chk("result-data-strip", !!q('.sf-est-result-data') && /BIR source match/.test(q('.sf-est-result-data').textContent) && /BIR schedule in effect since/.test(q('.sf-est-result-data').textContent) && /2022-07-23/.test(q('.sf-est-result-data').textContent), "");
    chk("result-schedule-date-framed-as-ongoing", !!q('.sf-est-result-data-note') && /remain in force until a newer Department Order/.test(q('.sf-est-result-data-note').textContent) && /re-checked every 30 days/.test(q('.sf-est-result-data-note').textContent), (q('.sf-est-result-data-note') || { textContent: "" }).textContent);
    chk("analysis-summary", !!q('.sf-est-analysis-summary') && /Analysis complete/.test(q('.sf-est-analysis-summary').textContent) && /Vacant lot/i.test(q('.sf-est-analysis-summary').textContent), "");
    chk("next-step-card-above-report", !!q('.sf-est-nextstep') && !!q('[data-est-lead-open]') &&
        q('.sf-est-nextstep').compareDocumentPosition(q('.sf-est-report')) & Node.DOCUMENT_POSITION_FOLLOWING &&
        /no obligation/i.test(q('.sf-est-nextstep').textContent) &&
         /Your results are open/.test(q('.sf-est-nextstep').textContent) &&
        /one business day/i.test(q('.sf-est-nextstep').textContent), "");

    const rD1 = estApi()._state().result;
    chk("depth1-available", rD1 && rD1.available, "");
    chk("depth1-level", rD1 && rD1.source && rD1.source.depth === 1 && rD1.source.level === "street", "lvl=" + (rD1 && rD1.source && rD1.source.level));
    chk("depth1-reconciles", estApi().core.integrityCheck(rD1).ok, "");
    const e1 = await estimateExpected(stateOpts());
    chk("total-matches-core", MONEY(rD1.total) === MONEY(e1.total), "dom=" + MONEY(rD1.total) + " core=" + MONEY(e1.total));
    chk("corner-note-shown", /corner lot \(\+2.5%\)/.test(document.body.innerText), "");
    chk("bir-reference-still-shown", !!q('.sf-est-bir-primary') && /Official BIR zonal reference/.test(q('.sf-est-bir-primary').textContent) && /\/sqm/.test(q('.sf-est-bir-primary').textContent), "txt=" + ((q('.sf-est-bir-primary') || { textContent: "" }).textContent));
    chk("hidden-values-absent-everywhere", !/Indicative guide range/.test(document.body.innerText) && !/Factor-based guide estimate/.test(document.body.innerText), "");
    const provSec = Array.prototype.find.call(qa('.sf-est-rsec'), function (el) { return /How this number was built/.test(el.textContent); });
    const provTxt = provSec ? provSec.textContent : "";
    chk("provenance-section-rendered", !!provSec && !!q('.sf-est-prov-block'), "found=" + !!provSec + " blocks=" + qa('.sf-est-prov-block').length);
    chk("provenance-states-basis-of-value", /Basis of value/i.test(provTxt) && /planning/i.test(provTxt), "");
    chk("provenance-names-bir-instrument", /035-2022/.test(provTxt) && /RDO 05[89]|RDO 058|RDO 059/.test(provTxt), "do-ref=" + /035-2022/.test(provTxt));
    chk("provenance-has-valuation-date", /Valuation date/i.test(provTxt) && /2026/.test(provTxt), "");
    chk("provenance-lists-checks", /Checks applied to every result/i.test(provTxt) && /Determinism/i.test(provTxt) && /Reconciliation/i.test(provTxt), "");
    chk("provenance-lists-limitations", /does not cover/i.test(provTxt) && /No physical inspection/i.test(provTxt), "");
    chk("provenance-order-numbered", qa('.sf-est-prov-steps li').length >= 5, "steps=" + qa('.sf-est-prov-steps li').length);
    chk("provenance-avoids-pvs-claim", !/PVS\s*105/.test(provTxt) && !/PVS[- ]compliant/i.test(provTxt), "");
    chk("per-sqm-shown", !!q('.sf-est-per') && /sqm/.test(q('.sf-est-per').textContent), "");
    chk("bir-value-shown-separately", !!q('.sf-est-bir-primary') && /Official BIR zonal reference/.test(q('.sf-est-bir-primary').textContent) && /tax reference/.test(q('.sf-est-bir-primary').textContent), "");
chk("central-estimate-and-range-in-summary", !!q('.sf-est-result-summary') && !!q('.sf-est-result-value') && /Central planning estimate/.test(q('.sf-est-result-summary').textContent) && /85%–130%/.test(q('.sf-est-result-summary').textContent), "");
    chk("central-estimate-amount-matches-core", q('.sf-est-result-value').textContent === MONEY(rD1.marketGuideEstimate), q('.sf-est-result-value').textContent);
    chk("estimate-result-is-large", !!q('.sf-est-result-value') && parseFloat(getComputedStyle(q('.sf-est-result-value')).fontSize) >= 40, "font=" + (q('.sf-est-result-value') && getComputedStyle(q('.sf-est-result-value')).fontSize));
    chk("asking-price-amount-is-large", !!q('.sf-est-result-value') && parseFloat(getComputedStyle(q('.sf-est-result-value')).fontSize) >= 32, "font=" + (q('.sf-est-result-value') && getComputedStyle(q('.sf-est-result-value')).fontSize));
    const reportText = (q('.sf-est-report') || { textContent: "" }).textContent;
     chk("guide-section-label", /YOUR GUIDE, SECTION BY SECTION/.test(document.body.innerText), "");
     chk("pricing-strategy-has-no-duplicate-asking-card", qa('[data-est-pricing-body] .sf-est-recommended-ask').length === 0 && qa('.sf-est-result-summary .sf-est-recommended-ask').length === 0, "pricing-body cards=" + qa('[data-est-pricing-body] .sf-est-recommended-ask').length);
      chk("computed-cards-open-without-contact", qa('.sf-est-price-lock').length === 0 && /Transaction taxes/.test(q('[data-est-pricing-body]').textContent) && /₱/.test(q('[data-est-pricing-body]').textContent), "");
    chk("taxes-fees-commissions-shown", /Taxes, fees & commissions/.test(reportText) && /Broker commission/.test(reportText), "");
    chk("tax-base-disclosed", /Illustrative tax base/.test(reportText), "");
    chk("source-match-not-inferred-from-municipality-coverage", q('.sf-est-result-data').textContent.includes(rD1.source.label), "");
chk("report-six-groups", qa('.sf-est-rsec').length === 6, "n=" + qa('.sf-est-rsec').length);
      chk("report-sections-are-accessible", qa('.sf-est-rsec > summary').length === 6 && qa('.sf-est-project-context > summary').length === 1, "summaries=" + qa('.sf-est-rsec > summary').length);
    chk("report-summary-priority", qa('.sf-est-rsec[open]').length === 1 && /Summary/.test(q('.sf-est-rsec[open] summary').textContent), "open=" + qa('.sf-est-rsec[open]').length);
    q('[data-est-prev]').click();
    await wait(40);
    chk("report-adjust-inputs-returns-to-start", !!q('[data-est-screen="1"]'), "");
    estApi().debug.render(4);
    await wait(40);

     // lead block + submit (fallback to contact stub, no email -> "saved")
     chk("lead-block-present", !!q('[data-est-lead]'), "");
    /* The estimate must be visible with no contact required: the lead block sits
       after the result and opens only on click. "Request received" says the guide
       remains above. */
    chk("estimate-shown-before-any-contact-ask", (function () {
      const card = q('.sf-est-card');
      if (!card) return false;
      const html = card.innerHTML;
      const resultAt = html.indexOf('data-est-screen="4"');
      const leadAt = html.indexOf('data-est-lead');
      return resultAt >= 0 && leadAt > resultAt;
    })(), "the result renders before the lead block");
    chk("lead-form-hidden-until-click", !q('[data-est-lead-form]'), "no contact form before the user opts in");
     const leadButtons = qa('[data-est-lead-open]');
     chk("bottom-appraisal-cta-present", leadButtons.length >= 2 && /appraisal consultation/i.test(leadButtons[leadButtons.length - 1].textContent), "buttons=" + leadButtons.length);
     leadButtons[leadButtons.length - 1].click();
     await wait(40);
     chk("appraisal-lead-form-opens", !!q('[data-est-lead-form]') && /appraisal consultation/i.test(q('[data-est-lead-form] h3').textContent), "");
    chk("appraisal-lead-form-focuses", !!q('[data-est-lead-form] input:focus'), "");
    const form = q('[data-est-lead-form]');
    form.querySelector('[name=name]').value = "E2E Tester";
    form.querySelector('[name=email]').value = "e2e@example.com";
    form.querySelector('[name=phone]').value = "09171234567";
    form.querySelector('[name=consent]').checked = true;
    window.ESREALTY_LISTINGS_API = { contact: () => Promise.resolve({ id: "saved-inquiry-test", emailSent: false }) };
    form.querySelector('button[type=submit]').click();
     await waitFor(() => /saved/.test((q('[data-est-lead-status]') || { textContent: "" }).textContent), 40, ESP);
     chk("lead-submit-success-saved", /saved/.test((q('[data-est-lead-status]') || { textContent: "" }).textContent), (q('[data-est-lead-status]') || { textContent: "" }).textContent);
      chk("pricing-unlocks-after-submit", /Lower end of guide range/.test((q('[data-est-pricing-body]') || { textContent: "" }).textContent) && /₱/.test((q('[data-est-pricing-body]') || { textContent: "" }).textContent), "");
     chk("lead-confirmation-shown", !!q('.sf-est-lead-done') && /Request received/.test(q('.sf-est-lead-done').textContent) && !q('.sf-est-nextstep'), "");

    // --- depth 2: "Street not listed" (barangay all-other) ---
    /* Agoncillo / Bangin has an all-other-streets RR rate of 1500, so with
       the simple select's RR (Residential) the fallback resolves at depth 2. */
    estApi().debug.render(1);
    await wait(70);
    setValue('[data-est-muni]', "AGONCILLO");
    await waitFor(() => qa('[data-est-barangay] option').some(o => o.value === "BANGIN"), 60, ESP);
    setValue('[data-est-barangay]', "BANGIN");
    await wait(150);
    q('[data-est-screen="1"] [data-est-street-fallback]').click();
    await wait(90);
    const cs2 = q('[data-est-class]');
    chk("class-select-offers-residential", Array.from(cs2.options).some(o => o.value === "RR"), "opts=" + Array.from(cs2.options).map(o => o.value).join(","));
    setValue('[data-est-class]', "RR");
    setInput('[data-est-area]', "100");
    q('[data-est-next]').click();
    await waitFor(() => q('[data-est-screen="2"]'), 30, ESP);
    q('[data-est-next]').click();
    await waitFor(() => q('[data-est-screen="4"]'), 90, ESP);
    const rD2 = estApi()._state().result;
    chk("depth2-available", rD2 && rD2.available, "");
    chk("depth2-level", rD2 && rD2.source.depth === 2 && rD2.source.level === "barangay-other", "lvl=" + (rD2 && rD2.source && rD2.source.level));
    chk("depth2-other-value-1500", rD2 && rD2.reference && rD2.reference.value === 1500, "ref=" + (rD2 && rD2.reference && rD2.reference.value));

    // --- house & lot flow (screen 2 inputs) ---
    estApi().debug.render(1);
    await wait(70);
    const typeGroup = qa('[data-est-screen="1"] [data-chip-group]').find(g => g.getAttribute("data-t") === "type");
    typeGroup.querySelector('[data-val="house_lot"]').click();
    await wait(60);
    setInput('[data-est-sale-price]', "5000000");
    chk("house-next-goes-to-screen2", /Continue to the house/.test(q('[data-est-next]').textContent), "label=" + q('[data-est-next]').textContent);
    q('[data-est-next]').click();
    await waitFor(() => q('[data-est-screen="2"]'), 30, ESP);
    chk("screen2-house-inputs", !!q('[data-est-floor]') && qa('[data-est-feature]').length >= 6, "feat=" + qa('[data-est-feature]').length);
    setInput('[data-est-floor]', "160");
    const wg = qa('[data-est-feature]').find(cb => cb.getAttribute("data-est-feature") === "wall_gate");
    if (wg) { wg.checked = true; wg.dispatchEvent(new Event("change", { bubbles: true })); }
    q('[data-est-next]').click();
    await waitFor(() => q('[data-est-screen="4"]'), 90, ESP);
    const rH = estApi()._state().result;
    const eH = await estimateExpected(stateOpts());
    chk("house-available", rH && rH.available, "");
    chk("house-total-matches-core", MONEY(rH.total) === MONEY(eH.total), "dom=" + MONEY(rH.total) + " core=" + MONEY(eH.total));
    chk("house-improvement-included", rH && rH.improvement === eH.improvement && rH.improvement > 0, "imp=" + (rH && rH.improvement));
    qa('.sf-est-rsec')[1].open = true;
    chk("house-report-shows-house-value", /House value/.test(document.body.innerText), "");
    chk("seller-net-proceeds-shown", /estimated net proceeds/.test((q('.sf-est-report') || { textContent: "" }).textContent), "");

    /* --- Task 12: mobile fit (usable at 390px) ---
       The guide must not push the page wider than the viewport on any screen,
       because a horizontally-scrolling value guide on a phone is a broken value
       guide. Checked structurally: no element inside the estimator may have a
       scrollWidth that escapes the card, and the card itself must fit the body.
       Runs at whatever viewport the harness supplied; when run with
       run_all.ps1 -Mobile (390x844) this is the real acceptance. */
    const cardEl = q('.sf-est-card') || q('#sf-estimator');
    if (cardEl) {
      const bodyScroll = document.documentElement.scrollWidth;
      const cardScroll = cardEl.scrollWidth;
      const bodyWidth = document.documentElement.clientWidth;
      chk("no-horizontal-page-overflow", bodyScroll <= bodyWidth + 1,
        "body " + bodyScroll + " vs viewport " + bodyWidth);
      chk("estimator-card-fits-viewport", cardScroll <= bodyWidth + 1,
        "card " + cardScroll + " vs viewport " + bodyWidth);
      /* The result screen must also fit: render it and re-check. */
      if (estApi()._state().result) {
        estApi().debug.render(4);
        await wait(120);
        const card4 = q('.sf-est-card') || q('#sf-estimator');
        const fit4 = card4 && card4.scrollWidth <= document.documentElement.clientWidth + 1;
        chk("result-screen-fits-viewport", !!fit4, "result card " + (card4 && card4.scrollWidth));
        estApi().debug.render(1);
        await wait(80);
      }
    }

    window.__msOk = window.__msChecks.every(c => c.ok) && window.__msChecks.length > 0;
    window.__msDone = true;
  } catch (err) {
    window.__msLog.push("e2e error: " + (err && err.message || err));
    window.__msChecks.push({ name: "run-error", ok: false, detail: (err && err.message || String(err)) });
    window.__msOk = false;
    window.__msDone = true;
  }
})();
