"use strict";
/* Value Guide: location-based pre-selected answers (2026-10-14).
   1) a subdivision street pre-selects Subdivision / Barangay road, a typical
      floor area for the lot, and age 6-10, each marked "Suggested"
   2) every site answer shows how it moves the land value on its button
   3) a reader's own answer is never overwritten when the location changes;
      the remaining suggestions follow the new location
   4) the result applies the answers and lists them, matching the core engine */
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
const estApi = () => window.ESREALTY_EST || null;
const q = s => document.querySelector(s);
const qa = s => Array.prototype.slice.call(document.querySelectorAll(s));
function setValue(sel, v) { const e = q(sel); e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); }
function setInput(sel, v) { const e = q(sel); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }
async function pickStreet(text, key) {
  setInput('[data-est-street-q]', text);
  await waitFor(() => qa('[data-est-street]').some(b => b.getAttribute("data-est-street") === key), 30, ESP);
  const b = qa('[data-est-street]').find(x => x.getAttribute("data-est-street") === key);
  if (b) b.click();
  await wait(200);
  return !!b;
}
(async () => {
  try {
    location.hash = "#/home";
    await waitFor(() => estApi() && q('[data-est-muni]') && q('[data-est-screen="1"]'), 60, ESP);
    const typeBtn = q('[data-t="type"] [data-val="house_lot"]');
    if (typeBtn) typeBtn.click();
    await wait(200);
    setValue('[data-est-muni]', "BAUAN");
    await waitFor(() => qa('[data-est-barangay] option').some(o => o.value === "MANGHINAO PROPER"), 60, ESP);
    setValue('[data-est-barangay]', "MANGHINAO PROPER");
    await wait(300);
    chk("subdivision-street-picked", await pickStreet("mangoville", "mangoville subd"), "");
    setInput('[data-est-area]', "146");
    await wait(150);
    q('[data-est-next]').click();
    await waitFor(() => q('[data-est-screen="2"]'), 40, ESP);
    let st = estApi()._state();
    chk("community-suggested-subdivision", st.community === "Subdivision" && st.assumed.community === true, "community=" + st.community);
    chk("road-suggested-barangay", st.roadAccess === "Barangay road" && st.assumed.roadAccess === true, "road=" + st.roadAccess);
    chk("defaults-for-the-rest", st.floodRisk === "No flooding" && st.rightOfWay === "Direct road access" && st.utilities === "Full power & water", "");
    chk("floor-area-suggested-for-lot", st.floorArea === "131" && st.assumed.floorArea === true && q('[data-est-floor]').value === "131", "floor=" + st.floorArea);
    chk("age-suggested-6-10", st.ageBand === "6-10" && st.assumed.ageBand === true, "age=" + st.ageBand);
    chk("suggested-badges-shown", qa('[data-est-suggested]').length >= 4 && !!q('[data-est-suggest-note]'), "badges=" + qa('[data-est-suggested]').length);
    chk("impact-on-buttons", qa('[data-t="rightOfWay"] [data-val="Landlocked"]').some(b => /−35% land/.test(b.textContent)) &&
      qa('[data-t="floodRisk"] [data-val="Flood-prone"]').some(b => /−15% land/.test(b.textContent)), "");
    chk("ownership-impact-shown", qa('[data-est-ownership="occupancy"][data-val="informal_settlers"]').some(b => /−25%/.test(b.textContent)), "");

    /* The reader overrides one answer, then changes the street. */
    const gated = q('[data-t="community"] [data-val="Gated community"]');
    if (gated) gated.click();
    await wait(300);
    st = estApi()._state();
    chk("reader-answer-clears-suggested", st.community === "Gated community" && !st.assumed.community && st.userSet.community === true, "");
    q('[data-est-prev]').click();
    await waitFor(() => q('[data-est-screen="1"]'), 30, ESP);
    setValue('[data-est-barangay]', "POBLACION III");
    await wait(300);
    chk("poblacion-street-picked", await pickStreet("binay", "binay st ressurreccion st"), "");
    setInput('[data-est-area]', "100");
    await wait(150);
    q('[data-est-next]').click();
    await waitFor(() => q('[data-est-screen="2"]'), 40, ESP);
    st = estApi()._state();
    chk("reader-answer-kept-after-location-change", st.community === "Gated community", "community=" + st.community);
    chk("suggestions-follow-new-location", st.roadAccess === "Municipal road" && st.floorArea === "90", "road=" + st.roadAccess + " floor=" + st.floorArea);

    /* Calculate: the result applies and lists the answers. */
    q('[data-est-next]').click();
    await waitFor(() => q('[data-est-screen="4"]'), 90, ESP);
    const r = estApi()._state().result;
    const api = estApi();
    const row = api._data().index.municipalities.find(m => m.name === "BAUAN");
    const md = await api.loadMunicipality(row.slug);
    const e = api.core.computeEstimate(api._data().config, api._data().index, md, {
      municipality: "BAUAN", barangay: "POBLACION III", streetKey: "binay st ressurreccion st", classification: st.classification,
      area: 100, type: "house_lot", floorArea: 90, floors: st.floors, ageBand: "6-10", construction: st.construction, features: st.features,
      condition: st.condition, community: "Gated community", floodRisk: "No flooding", roadAccess: "Municipal road",
      frontage: st.frontage, lotShape: "Regular", rightOfWay: "Direct road access", elevation: "At road level", utilities: "Full power & water"
    });
    chk("result-matches-core-with-answers", r && e && r.total === e.total, "dom=" + (r && r.total) + " core=" + (e && e.total));
    chk("site-net-applied", r && r.siteAdjustment && r.siteAdjustment.pct === 6, "site=" + (r && r.siteAdjustment && r.siteAdjustment.pct));
    chk("asking-price-is-estimate-plus-7", r && r.recommendedAskingPrice === Math.round(r.total * 1.07), "");
    chk("report-lists-adjustments", /Adjustments from your answers/.test(document.body.textContent) && /\(suggested\)/.test(document.body.textContent), "");

    window.__msOk = window.__msChecks.every(c => c.ok) && window.__msChecks.length > 0;
    window.__msDone = true;
  } catch (err) {
    window.__msChecks.push({ name: "run-error", ok: false, detail: (err && err.message || String(err)) });
    window.__msOk = false;
    window.__msDone = true;
  }
})();
