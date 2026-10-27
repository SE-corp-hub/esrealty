"use strict";
/* Regression cover for "Properties: No properties found".
 *
 * The primary nav linked to "#/search?state=Batangas" while searchFields() only
 * rendered city, property_type and max_price. The state filter narrowed the
 * query but appeared nowhere on screen, so every visitor landed on an empty
 * result set with an empty Location box, a generic "No properties found"
 * message, and no way to tell what had been applied or clear it.
 *
 * Three things are pinned here:
 *   1. No destination in the app ships an invisible filter.
 *   2. Every filter the form applies is represented in the form.
 *   3. An empty result set explains WHY and offers a way out.
 */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }

(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const go = async (h, ms) => { location.hash = h; await wait(ms || 2000); };

    /* ---- 1. the nav must not ship a filter the user cannot see ----
       Checked on the search page, where the filter form is actually rendered.
       Testing on #/home gave false positives: no form exists there, so every
       filter param looked "unrepresented". */
    await go("#/search", 2400);
    const form = document.querySelector("[data-sf-search]");
    chk("search-form-present", !!form, "form=" + !!form);
    const fieldNames = form ? Array.from(form.querySelectorAll("[name]")).map(f => f.getAttribute("name")) : [];

    const hrefs = Array.from(document.querySelectorAll(".sf-header a, .sf-footer a, .sf-site a"))
      .map(a => a.getAttribute("href") || "");
    const silent = hrefs.filter(h => {
      const q = h.split("?")[1];
      if (!q) return false;
      const p = new URLSearchParams(q);
      for (const k of p.keys()) {
        /* section/service steer page copy, go aims at a spot on the page (?go=form),
           sort/page are presentation */
        if (["section", "service", "go", "sort", "page"].indexOf(k) > -1) continue;
        if (fieldNames.indexOf(k) === -1) return true;
      }
      return false;
    });
    chk("nav-no-invisible-filters", silent.length === 0, "unrepresented filter params in: " + silent.join(" | "));
    chk("nav-properties-not-hardcoded-state", !hrefs.includes("#/search?state=Batangas"), "primary nav hrefs=" + hrefs.filter(h => h.indexOf("#/search") === 0).join(" | "));
    chk("nav-has-plain-properties-link", hrefs.includes("#/search"), "no plain #/search destination");

    /* ---- 2. the filter form must cover every filter it can apply ---- */
    ["city", "state", "property_type", "offer_type", "max_price"].forEach(n => {
      chk("search-form-exposes-" + n, fieldNames.indexOf(n) > -1, "fields=" + fieldNames.join(","));
    });

    /* ---- 3. an applied filter must be visible AND clearable ---- */
    await go("#/search?state=Batangas", 2400);
    /* Re-query: navigating re-renders the page, so a reference captured earlier
       is detached and its .value reads as empty. */
    const liveForm = document.querySelector("[data-sf-search]");
    const stateField = liveForm && liveForm.querySelector('[name="state"]');
    chk("applied-filter-visible-in-form", !!stateField && stateField.value === "Batangas",
      "state field value=" + (stateField ? JSON.stringify(stateField.value) : "(no field)"));
    const chips = Array.from(document.querySelectorAll("[data-sf-clear-filter]"));
    chk("applied-filter-has-chip", chips.length === 1, "chips=" + chips.length);
    chk("chip-labels-the-filter", chips.length === 1 && /state/i.test(chips[0].textContent),
      "chip text=" + (chips[0] ? chips[0].textContent.replace(/\s+/g, " ").trim() : ""));
    chk("chip-has-aria-label", chips.length === 1 && !!chips[0].getAttribute("aria-label"),
      "aria-label=" + (chips[0] ? chips[0].getAttribute("aria-label") : ""));
    chk("chip-clear-link-drops-state", chips.length === 1 && chips[0].getAttribute("href") === "#/search",
      "href=" + (chips[0] ? chips[0].getAttribute("href") : ""));
    chk("has-clear-all", !!document.querySelector(".sf-chip-clear"), "no clear-all link");

    /* ---- 4. the empty state must explain itself and offer a way out ---- */
    const emptyEl = document.querySelector(".sf-empty");
    chk("empty-state-shown", !!emptyEl, "empty=" + !!emptyEl);
    chk("empty-state-names-the-filter", !!emptyEl && /batangas/i.test(emptyEl.textContent),
      "text=" + (emptyEl ? emptyEl.textContent.replace(/\s+/g, " ").trim().slice(0, 90) : ""));
    chk("empty-state-not-generic", !!emptyEl && !/^No properties found/.test((emptyEl.querySelector("h3") || {}).textContent || ""),
      "h3=" + ((emptyEl && emptyEl.querySelector("h3")) || {}).textContent);
    const clearBtn = emptyEl && emptyEl.querySelector('a[href="#/search"]');
    chk("empty-state-offers-escape", !!clearBtn, "no clear-filters action");

    /* clicking the chip actually restores the listings */
    if (chips.length) {
      chips[0].click();
      await wait(2400);
      chk("clearing-filter-restores-results", location.hash === "#/search", "hash=" + location.hash);
      chk("results-return-after-clear", document.querySelectorAll(".sf-property-card").length > 0,
        "cards=" + document.querySelectorAll(".sf-property-card").length);
      chk("chips-gone-after-clear", document.querySelectorAll("[data-sf-clear-filter]").length === 0,
        "chips=" + document.querySelectorAll("[data-sf-clear-filter]").length);
    }

    /* ---- 5. the homepage must actually show the listings it fetches ---- */
    await go("#/home", 3200);
    chk("home-renders-featured-section", !!document.querySelector("#sf-featured"), "no #sf-featured after 3.2s");
    chk("home-shows-property-cards", document.querySelectorAll("#sf-featured .sf-property-card").length > 0,
      "cards=" + document.querySelectorAll("#sf-featured .sf-property-card").length);
    chk("home-featured-has-see-all", !!document.querySelector("#sf-featured a[href='#/search']"), "no see-all link");

    /* ---- 6. placeholder rows must not leak onto any public view ---- */
    await go("#/search", 2600);
    const titles = Array.from(document.querySelectorAll(".sf-site .sf-property-card h4")).map(h => h.textContent.trim());
    const numeric = titles.filter(t => /^\d+$/.test(t));
    chk("no-numeric-placeholder-cards", numeric.length === 0, "leaked=" + numeric.join(","));

    /* ---- 7. the storefront CSS must have loaded ---- */
    chk("storefront-css-loaded", Array.from(document.styleSheets).some(s => (s.href || "").indexOf("storefront.css") > -1), "storefront.css missing");
    chk("chip-styled", (() => {
      try {
        const sheet = Array.from(document.styleSheets).find(s => (s.href || "").indexOf("storefront.css") > -1);
        for (const r of Array.from(sheet.cssRules)) if (r.selectorText === ".sf-chip") return true;
      } catch (e) { /* noop */ }
      return false;
    })(), ".sf-chip rule missing from storefront.css");
  } catch (e) {
    window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) });
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
