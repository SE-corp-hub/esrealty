"use strict";
/* Home hero quick estimate (2026-10-15).
   1) the hero has ONE primary action and the quick-estimate card
   2) the counts in the proof strip come from the data files, not copy
   3) choosing a town shows the figure the full estimator gives for the same
      inputs with the barangay left blank (municipality median reference)
   4) type and lot area update it; a bad area explains itself
   5) "Start My Value Guide" carries town, type and area into the calculator
   6) the example report is a real run of the estimator, and the old duplicate
      "How it works" section is gone */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 80) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(150); } return !!fn(); }
const q = s => document.querySelector(s);
const money = n => "₱" + new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(Number(n || 0));
const round10k = n => Math.round((Number(n) || 0) / 1e4) * 1e4;
const compact = n => n >= 1e6 ? "₱" + (Math.round(n / 1e4) / 100).toFixed(2) + "M" : "₱" + new Intl.NumberFormat("en-PH").format(Math.round(n / 1e3)) + "K";
const quickOpts = (municipality, type, area) => ({
  purpose: "Selling", type, municipality, barangay: "", streetKey: "", classification: "RR", area,
  landMethod: "factor", saleContext: "private-resale", floorArea: 0, floors: "1", ageBand: "0-5", construction: "mixed_chb", features: []
});
function pick(sel, value) { const e = q(sel); e.value = value; e.dispatchEvent(new Event("change", { bubbles: true })); }
function type(sel, value) { const e = q(sel); e.value = value; e.dispatchEvent(new Event("input", { bubbles: true })); }
const figure = () => (q("[data-quick-figure]") || {}).textContent || "";

(async () => {
  try {
    location.hash = "#/home";
    await until(() => q("[data-est-quick] [data-quick-muni]") && q("[data-quick-muni]").options.length >= 35 && window.ESREALTY_EST && ESREALTY_EST._data());
    const api = window.ESREALTY_EST, data = api._data();

    /* 1) one primary action in the hero */
    const heroButtons = document.querySelectorAll(".sf-est-hero-grid .sf-hero-btn");
    check("hero has one primary button", heroButtons.length === 1 && /Start My Value Guide/.test(heroButtons[0].textContent), "buttons=" + heroButtons.length);
    check("primary button lives in the quick-estimate card", !!q("[data-est-quick] [data-est-services][data-quick-go]"));
    check("browsing is a quiet text link", !!q('.sf-est-hero-browse a[href="#/search"]') && !q('.sf-est-hero-browse .sf-hero-btn'));
    check("quick estimate starts idle", /Choose your town/.test(q("[data-quick-result]").textContent) && !q("[data-quick-figure]"));
    check("quick fields are labelled", !!q("[data-quick-muni]").closest("label") && !!q("[data-quick-area]").closest("label") && !!q(".sf-quick-seg").closest("fieldset").querySelector("legend"));

    /* 2) live counts */
    const counts = (data.manifest && data.manifest.counts) || {};
    const stat = k => ((q('[data-est-stat="' + k + '"]') || {}).textContent || "").replace(/,/g, "");
    check("towns count is live", stat("towns") === String(counts.municipalities || data.index.municipalities.length), stat("towns"));
    check("street-rate count is live", stat("streets") === String(counts.streets), stat("streets") + " vs " + counts.streets);
    const bank = data.bankComparables || {};
    if (bank.records && bank.records.length && !bank.unavailable) {
      check("listing count is live", stat("listings") === String(bank.records.length), stat("listings") + " vs " + bank.records.length);
    }

    /* 3) a town gives the estimator's own figure */
    pick("[data-quick-muni]", "LIPA CITY");
    await until(() => q("[data-quick-figure]"));
    await wait(900); /* count-up */
    const e1 = await api.estimate(quickOpts("LIPA CITY", "house_lot", 150));
    check("figure equals the estimator (house & lot, 150 sqm)", figure() === money(round10k(e1.marketGuideEstimate)), figure() + " vs " + money(round10k(e1.marketGuideEstimate)));
    const rangeText = q(".sf-quick-range-text").textContent;
    check("range equals the estimator", rangeText.indexOf(money(round10k(e1.low))) >= 0 && rangeText.indexOf(money(round10k(e1.high))) >= 0, rangeText);
    check("note states the house assumption", /135 sqm house|sqm house under 5 years/.test(q(".sf-quick-note").textContent), q(".sf-quick-note").textContent);
    check("result announced once to screen readers", /Starting figure for Lipa City/.test(q("[data-quick-say]").textContent), q("[data-quick-say]").textContent);

    /* 4) type and area */
    q('[data-quick-type][value="vacant_lot"]').click();
    await wait(1100);
    const e2 = await api.estimate(quickOpts("LIPA CITY", "vacant_lot", 150));
    check("lot only updates the figure", figure() === money(round10k(e2.marketGuideEstimate)) && !/sqm house/.test(q(".sf-quick-note").textContent), figure());
    type("[data-quick-area]", "300");
    await wait(1300);
    const e3 = await api.estimate(quickOpts("LIPA CITY", "vacant_lot", 300));
    check("lot area updates the figure", figure() === money(round10k(e3.marketGuideEstimate)), figure() + " vs " + money(round10k(e3.marketGuideEstimate)));
    type("[data-quick-area]", "5");
    await wait(600);
    check("too-small area explains itself", /between 20 and 100,000/.test(q("[data-quick-result]").textContent) && !q("[data-quick-figure]"));
    type("[data-quick-area]", "200");
    await wait(1200);

    /* 5) carried into the calculator */
    q("[data-quick-go]").click();
    await until(() => { const s = api._state(); return s.municipality === "LIPA CITY" && s.muniData && q('[data-est-barangay] option[value]:not([value=""])'); }, 60);
    const st = api._state();
    check("calculator receives the town", st.municipality === "LIPA CITY", st.municipality);
    check("calculator receives the type", st.type === "vacant_lot", st.type);
    check("calculator receives the lot area", st.area === 200, st.area);
    const carried = q("[data-est-carried]");
    check("carried answers show as one summary line, not asked again", !!carried && /Lipa City/.test(carried.textContent) && /Vacant lot/.test(carried.textContent) && /200 sqm/.test(carried.textContent) && !q("[data-est-muni]") && !q("[data-est-area]"), carried ? carried.textContent : "none");
    check("calculator opens at the barangay question", st.screen === 1 && document.querySelectorAll("[data-est-barangay] option").length > 2);
    q("[data-est-quick-edit]").click();
    await wait(300);
    check("Change brings the fields back with the carried values", q("[data-est-muni]") && q("[data-est-muni]").value === "LIPA CITY" && q("[data-est-area]").value === "200" && !q("[data-est-carried]"));
    check("step 1 keeps only the essentials visible (classification with them, corner lot under More options)", !!q(".sf-est-more") && !q(".sf-est-more").open && !!q("[data-est-class]") && !q(".sf-est-more [data-est-class]") && !!q(".sf-est-more [data-est-corner]"));

    /* 6) example report and one summary section */
    await until(() => !/—/.test((q('[data-sample="value"]') || {}).textContent || "—"));
    const s = await api.estimate(quickOpts("LIPA CITY", "house_lot", 150));
    check("example report is a real estimator run", q('[data-sample="value"]').textContent === money(round10k(s.marketGuideEstimate)), q('[data-sample="value"]').textContent);
    check("example report is labelled as an example", /Example only/.test(q(".sf-guide-sample figcaption").textContent) && /Example report/.test(q(".sf-sample-tag").textContent));
    check("guide summary kept, duplicate steps section removed", !!q(".sf-guide-summary") && !q(".sf-process"));
  } catch (e) { check("runner", false, e && e.stack || e); }
  window.__msOk = window.__msChecks.every(c => c.ok); window.__msDone = true;
})();
