"use strict";
// Filters must stay visible/recoverable when applied, even in a collapsed UI.
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail });
const wait = ms => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);
async function go(hash) { location.hash = hash; await wait(2600); }
const visible = el => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
(async () => {
  try {
    const mobile = matchMedia("(max-width: 600px)").matches;
    await go("#/search");
    let form = q("[data-sf-search]"), more = q("[data-sf-more-filters]");
    check("filter form present", !!form && !!more);
    check("one control per filter, no duplicate inputs", ["city", "state", "property_type", "offer_type", "max_price"].every(n => form.querySelectorAll('[name="' + n + '"]').length === 1));
    check("location/budget/search initially usable", visible(form.querySelector('[name="city"]')) && visible(form.querySelector('[name="max_price"]')) && visible(form.querySelector('button[type="submit"]')));
    if (mobile) {
      check("mobile: native disclosure starts closed", !more.hidden && !more.open && more.querySelector("summary").tagName === "SUMMARY");
      check("mobile: advanced inputs not initially shown", ["state", "property_type", "offer_type"].every(n => !visible(form.querySelector('[name="' + n + '"]'))));
      check("mobile: disclosure follows search in DOM", form.lastElementChild === more);
      more.querySelector("summary").click();
      check("mobile: all advanced inputs usable when open", more.open && ["state", "property_type", "offer_type"].every(n => { const r = form.querySelector('[name="' + n + '"]').getBoundingClientRect(); return r.width >= 100 && r.height >= 44; }));
    } else {
      check("desktop: disclosure hidden, all five filters visible", more.hidden && ["city", "state", "property_type", "offer_type", "max_price"].every(n => visible(form.querySelector('[name="' + n + '"]'))));
      check("desktop: original keyboard/visual field order", [...form.children].filter(el => el.tagName === "LABEL").map(el => el.querySelector("[name]").name).join(",") === "q,city,state,property_type,offer_type,max_price"); // keyword (H2) on its own row first
    }

    await go("#/search?state=Batangas&property_type=house-and-lot&offer_type=sale");
    form = q("[data-sf-search]"); more = q("[data-sf-more-filters]");
    check("applied advanced filters never hidden on arrival", mobile ? !more.hidden && more.open : more.hidden && visible(form.querySelector('[name="state"]')));
    check("advanced applied count explained", /3 applied/.test(more.textContent));
    check("filter chips still visible and removable", document.querySelectorAll("[data-sf-clear-filter]").length === 3 && !!q(".sf-chip-clear"));
    check("applied fields reflect URL", form.elements.state.value === "Batangas" && form.elements.property_type.value === "house-and-lot" && form.elements.offer_type.value === "sale");

    form.elements.city.value = "Caloocan";
    form.elements.max_price.value = "3000000";
    if (mobile) more.querySelector("summary").click();
    check("closing disclosure does not disable filter controls", ["state", "property_type", "offer_type"].every(n => !form.elements[n].disabled));
    const data = new FormData(form);
    check("closed fields still serialise once", data.getAll("state").length === 1 && data.get("state") === "Batangas" && data.get("offer_type") === "sale");
    form.querySelector('button[type="submit"]').click();
    await wait(2600);
    const params = new URLSearchParams(location.hash.split("?")[1]);
    check("search preserves all five filters", params.get("city") === "Caloocan" && params.get("state") === "Batangas" && params.get("property_type") === "house-and-lot" && params.get("offer_type") === "sale" && params.get("max_price") === "3000000", params.toString());
    more = q("[data-sf-more-filters]");
    check("applied panel reopens after search on mobile", !mobile || more.open);
    q('[data-sf-clear-filter="state"]').click(); await wait(2600);
    check("remove one advanced chip keeps other filters", !new URLSearchParams(location.hash.split("?")[1]).has("state") && q('[name="offer_type"]').value === "sale");
    check("count updates after removing advanced filter", /2 applied/.test(q("[data-sf-more-filters]").textContent));
    q(".sf-chip-clear").click(); await wait(2600);
    check("Clear all resets filters and panel", location.hash === "#/search" && !q(".sf-chip-clear") && (!mobile || !q("[data-sf-more-filters]").open));
    await go("#/search?city=Caloocan&max_price=10000000");
    check("basic-only URL does not open advanced panel", !mobile || !q("[data-sf-more-filters]").open);
    await go("#/search?offer_type=rent");
    check("Rent service destination exposes applied offer", q('[name="offer_type"]').value === "rent" && (!mobile || q("[data-sf-more-filters]").open));
  } catch (e) { check("runner", false, e.message); }
  window.__msOk = window.__msChecks.every(c => c.ok); window.__msDone = true;
})();
