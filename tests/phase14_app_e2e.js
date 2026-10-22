"use strict";
/* Phase 14 (22 Oct): rental application on a public rent listing (I10). The listing API is stubbed
   so the page and the form can be checked without a network; the request the form sends is read back. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
(async () => {
  const realFetch = window.fetch;
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s);
    const listing = { id: "test-rent-1", title: "2BR condo for rent in Lipa", offer_type: "rent", property_type: "condominium", display_price: 18000, rent: 18000, price: 0,
      city: "Lipa", province: "Batangas", bedrooms: 2, bathrooms: 1, floor_area_sqm: 45, images: [], description: "Near the cathedral.", details: {} };
    const sale = Object.assign({}, listing, { id: "test-sale-1", title: "House for sale", offer_type: "sale", display_price: 5000000, price: 5000000 });
    let sent = null;
    window.fetch = function (url, opts) {
      const u = String(url);
      if (/\/listings\/test-rent-1\/inquiries$/.test(u) && opts && opts.method === "POST") { sent = JSON.parse(opts.body); return Promise.resolve(new Response(JSON.stringify({ id: "inq-1", message: "Inquiry submitted" }), { status: 201, headers: { "Content-Type": "application/json" } })); }
      if (/\/listings\/test-rent-1$/.test(u)) return Promise.resolve(new Response(JSON.stringify({ data: listing }), { status: 200, headers: { "Content-Type": "application/json" } }));
      if (/\/listings\/test-sale-1$/.test(u)) return Promise.resolve(new Response(JSON.stringify({ data: sale }), { status: 200, headers: { "Content-Type": "application/json" } }));
      return realFetch.apply(this, arguments);
    };
    location.hash = "#/listing/test-sale-1"; await wait(1500);
    chk("a listing for sale has no rental application", !!q("[data-sf-inquiry]") && !q("[data-sf-apply]"));
    location.hash = "#/listing/test-rent-1"; await wait(1500);
    const form = q("[data-sf-inquiry]"), app = q("[data-sf-apply]");
    chk("a listing for rent offers the application details, folded away", !!form && !!app && !app.open && /Applying to rent\?/.test(app.textContent));
    app.open = true;
    const set = (n, v) => { const el = form.querySelector('[name="' + n + '"]'); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    set("full_name", "Rina Renter"); set("phone", "0917 123 4567"); set("email", "rina@example.com");
    set("move_in", "2026-11-15"); set("occupants", "3"); set("employment", "Teacher"); set("income", "40,000 to 79,999"); set("lease_months", "12"); set("pets", "cat");
    const consent = form.querySelector('[name="consent"]'); consent.checked = true;
    form.querySelector("button[type=submit]").click(); await wait(1200);
    chk("the inquiry is sent as a renter, with the application", !!sent && sent.contact_type === "renter" && sent.application && sent.application.move_in === "2026-11-15" && sent.application.occupants === "3" && sent.application.income === "40,000 to 79,999" && sent.application.pets === "cat", JSON.stringify(sent));
    chk("the visitor is told what happens next", /Application sent/.test((form.querySelector(".sf-form-status") || {}).textContent || ""));
    sent = null;
    set("full_name", "Ana Asker"); set("phone", "0917 765 4321"); consent.checked = true;
    form.querySelector("button[type=submit]").click(); await wait(1200);
    chk("a plain question on a rental sends no application", !!sent && sent.contact_type === "renter" && !sent.application, JSON.stringify(sent));
    const small = Array.from(form.querySelectorAll("input,select,button,summary")).filter(el => !(el.getBoundingClientRect().height >= 40 || el.type === "checkbox"));
    chk("touch targets", !small.length, small.map(el => (el.name || el.tagName) + ":" + Math.round(el.getBoundingClientRect().height)).join(", "));
    chk("no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth + " > " + window.innerWidth);
  } catch (e) { window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.stack || e.message || e) + "" }); }
  window.fetch = realFetch;
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
