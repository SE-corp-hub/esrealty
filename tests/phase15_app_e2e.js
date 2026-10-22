"use strict";
/* Phase 15 (22 Oct): trust details on a public listing (H9). The listing API is stubbed for the
   public page; the back office part runs in demo mode and reads back what would be sent. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
(async () => {
  const realFetch = window.fetch;
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s);
    const base = { offer_type: "sale", property_type: "house-and-lot", display_price: 5600000, price: 5600000, city: "Lipa", province: "Batangas", bedrooms: 3, bathrooms: 2, images: [], description: "Corner lot." };
    const trusted = Object.assign({}, base, { id: "test-trust-1", title: "3BR house in Lipa", agent_name: "Maria Santos", details: { exclusive: true, docs_checked: true, agent_prc: "0012345", license_to_sell: "LTS-7788" } });
    const plain = Object.assign({}, base, { id: "test-plain-1", title: "Lot in Tanauan", details: {} });
    window.fetch = function (url) {
      const u = String(url);
      if (/\/listings\/test-trust-1$/.test(u)) return Promise.resolve(new Response(JSON.stringify({ data: trusted }), { status: 200, headers: { "Content-Type": "application/json" } }));
      if (/\/listings\/test-plain-1$/.test(u)) return Promise.resolve(new Response(JSON.stringify({ data: plain }), { status: 200, headers: { "Content-Type": "application/json" } }));
      return realFetch.apply(this, arguments);
    };
    location.hash = "#/listing/test-trust-1"; await wait(1500);
    const box = q("[data-sf-trust]");
    chk("the listing page shows what the office has checked", !!box && /Exclusive with SEA ESTATES/.test(box.textContent) && /Title and tax declaration seen by the agent/.test(box.textContent), box ? box.textContent : "none");
    chk("and who listed it, with their PRC number", !!box && /Listed by Maria Santos, PRC no\. 0012345/.test(box.textContent));
    chk("the DHSUD licence to sell still shows", /LTS-7788/.test((q(".sf-dhsud") || {}).textContent || ""));
    const badges = Array.from(document.querySelectorAll(".sf-trust-badge"));
    chk("badges are readable on a phone", badges.length === 2 && badges.every(b => parseFloat(getComputedStyle(b).fontSize) >= 14 && b.getBoundingClientRect().right <= window.innerWidth + 1), badges.map(b => Math.round(b.getBoundingClientRect().right)).join(","));
    chk("no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth + " > " + window.innerWidth);
    location.hash = "#/listing/test-plain-1"; await wait(1500);
    chk("a listing with nothing checked shows no badges", !!q("[data-sf-inquiry]") && !q("[data-sf-trust]"));
    window.fetch = realFetch;

    // Back office: the editor boxes are saved and sent.
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    location.hash = "";
    q("#auth-role").value = "super-admin";
    q("#auth-test").click(); await wait(700);
    q('#nav [data-view="listings"]').click(); await wait(900);
    q("[data-ls-new]").click(); await wait(600);
    const ex = q("#ls-exclusive"), dc = q("#ls-docs-checked");
    chk("the editor asks about exclusivity and documents, unticked", !!ex && !!dc && !ex.checked && !dc.checked);
    const lab = ex && ex.closest("label");
    chk("each box is easy to tap", !!lab && lab.getBoundingClientRect().height >= 40 && dc.closest("label").getBoundingClientRect().top >= lab.getBoundingClientRect().bottom - 1, lab ? Math.round(lab.getBoundingClientRect().height) + "" : "");
    q("#ls-title").value = "Test trust listing, Lipa"; q("#ls-price").value = "5600000";
    ex.checked = true; dc.checked = true;
    q("[data-ls-save]").click(); await wait(1200);
    const H = window.__ESREALTY_TEST_HELPERS;
    const rec = (H.getState().listings || []).find(l => l.title === "Test trust listing, Lipa");
    chk("the listing keeps both answers", !!rec && rec.exclusive === true && rec.docsChecked === true, rec ? JSON.stringify({ e: rec.exclusive, d: rec.docsChecked }) : "not saved");
    const sent = rec && H.listingToApi(rec);
    chk("and sends them to the website", !!sent && sent.details.exclusive === true && sent.details.docs_checked === true, sent ? JSON.stringify(sent.details) : "");
    const off = rec && H.listingToApi(Object.assign({}, rec, { exclusive: false, docsChecked: undefined }));
    chk("unticked is sent as false", !!off && off.details.exclusive === false && off.details.docs_checked === false);
    const ed = rec && q('[data-ls-edit="' + rec.id + '"]');
    if (ed) { ed.click(); await wait(600); }
    else { const op = rec && q('[data-ls-open="' + rec.id + '"]'); if (op) { op.click(); await wait(600); const e2 = q('[data-ls-edit="' + rec.id + '"]'); if (e2) { e2.click(); await wait(600); } } }
    chk("opening it again shows them ticked", !!q("#ls-exclusive") && q("#ls-exclusive").checked && q("#ls-docs-checked").checked);
  } catch (e) { window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.stack || e.message || e) + "" }); }
  window.fetch = realFetch;
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
