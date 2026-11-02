"use strict";
window.__msChecks = []; window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail });
const q = selector => document.querySelector(selector), wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  try {
    location.hash = "#/home"; await wait(2600);
    const api = window.ESREALTY_EST;
    await api.loadData();
    const opts = { municipality: "BAUAN", barangay: "POBLACION III", streetKey: "binay st ressurreccion st", classification: "RR", area: 100, type: "vacant_lot", purpose: "Selling", salePrice: 3000000 };
    async function result(changes) { const r = await api.estimate({ ...opts, ...changes }); Object.assign(api._state(), { result: r, purpose: r.purpose, saleContext: r.saleContext }); api.debug.render(4); return r; }
    const selling = await result({});
    check("seller guidance and net proceeds", /Your selling decision/.test(q("[data-est-decision]").textContent) && /2,730,000/.test(q("[data-est-decision]").textContent));
    const buying = await result({ purpose: "Buying" });
    check("buyer shares underlying valuation", buying.total === selling.total && q(".sf-est-result-value").textContent === "₱2,352,500");
    /* 3,000,000 + DST 45,000 + transfer 15,000 + LRA registration 14,646 (the
       fee schedule since 2026-11, not the old flat 0.1%). */
    check("buyer acquisition budget is distinct", /Your buying decision/.test(q("[data-est-decision]").textContent) && /3,074,646/.test(q("[data-est-decision]").textContent));
    check("price comparison is not a fairness guarantee", /does not establish a fair transaction price/.test(q("[data-est-decision]").textContent));
    await result({ purpose: "Buying", saleContext: "developer", developerFees: 100000 });
    check("developer budget uses quote without extra CGT", /3,100,000/.test(q("[data-est-decision]").textContent));
    const costs = [...document.querySelectorAll(".sf-est-rsec")].find(el => /Transaction costs/.test(el.querySelector("summary").textContent));
    check("developer source rules disclosed", /No blanket 6% CGT/.test(costs.textContent) && !/CGT 6% ≈ ₱180,000/.test(costs.textContent));
    await result({ purpose: "Buying", saleContext: "developer", developerFees: null });
    check("missing quote is not zero costs", /Not determined/.test(q("[data-est-decision]").textContent) && /Quotation required/.test(q("[data-est-pricing-body]").textContent));
    await result({ purpose: "Estate" }); check("estate output labelled property-only scenario", /Property-only estate tax scenario/.test(q("[data-est-decision]").textContent) && /entire citizen\/resident estate/.test(q("[data-est-decision]").textContent));
    await result({ purpose: "Loan" }); check("loan purpose never promises approval", /approval are not determined/.test(q("[data-est-decision]").textContent));
    await result({ purpose: "Buying", municipality: "LIPA CITY", barangay: "PINAGKAWITAN", streetKey: "", classification: "RR" });
    check("Lipa register preserves official specifications and unknown prices", /67.56/.test(q(".sf-est-project-context").textContent) && /price not published/.test(q(".sf-est-project-context").textContent));
    const context = q(".sf-est-project-context"); context.open = true;
    check("project sources remain linked", context.querySelectorAll('a[href^="https://"]').length > 5);
    api._state().municipality = "BAUAN"; api._state().municipalitySlug = "bauan"; api._state().muniRow = api.municipalityRow("BAUAN"); api._state().muniData = await api.loadMunicipality("bauan");
    api._state().barangay = "POBLACION III"; api._state().streetKey = "binay st ressurreccion st";
    api._state().streetLabel = "BINAY ST (RESSURRECCION ST)"; api._state().classification = "RR"; api._state().classificationUse = "residential";
    api._state().area = 100; api._state().salePrice = null; api.debug.render(1);
    check("buying input label appropriate", /Asking price or your offer/.test(q('[data-est-sale-price]').closest("label").textContent));
    const street = q("[data-est-street-q]"); street.value = "A DIFFERENT STREET"; street.dispatchEvent(new Event("input", { bubbles: true }));
    q("[data-est-next]").click();
    /* Street is optional (reference parity): typing a different street clears
       the stale calculation key, and proceeding without a match is allowed. */
    check("editing selected street clears stale calculation key", api._state().streetKey === "");
    /* The optional street let us advance; go back to screen 1 for the cost
       validation checks, which live on the location screen. */
    await wait(150);
    const prev = q("[data-est-prev]");
    if (prev) prev.click();
    await wait(150);
    check("back-on-screen1-after-optional-street", !!q('[data-est-screen="1"]'));
    q("[data-est-street-fallback]").click();
    q("[data-est-class]").value = "RR"; q("[data-est-class]").dispatchEvent(new Event("change", { bubbles: true }));
    q('[data-est-sale-price]').value = "-1"; q('[data-est-sale-price]').dispatchEvent(new Event("input", { bubbles: true }));
    q("[data-est-next]").click(); check("negative price rejected rather than treated as blank", /non-negative selling price/.test(q("[data-est-next-hint]").textContent));
    q('[data-est-sale-price]').value = ""; q('[data-est-sale-price]').dispatchEvent(new Event("input", { bubbles: true }));
    const commission = q('[data-est-cost="brokerPct"]'); commission.value = "-1"; commission.dispatchEvent(new Event("input", { bubbles: true }));
    q("[data-est-next]").click();
    check("invalid optional cost opens disclosure and receives focus", q(".sf-est-cost-inputs").open && document.activeElement === commission);
    check("optional controls usable when open", [...document.querySelectorAll("[data-est-cost]")].every(el => el.getBoundingClientRect().width >= 100 && el.getBoundingClientRect().height >= 44));
    check("no page overflow", document.documentElement.scrollWidth <= innerWidth);
  } catch (e) { check("runner", false, e.message); }
  window.__msOk = window.__msChecks.every(c => c.ok); window.__msDone = true;
})();
