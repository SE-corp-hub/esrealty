"use strict";
/* Agent websites, Phase 1: an agent's public page (#/agents/<slug>), drawn by js/agent_page.js.
   The listing API is stubbed, so this runs offline. Desktop and phone widths in CI. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
(async () => {
  const realFetch = window.fetch;
  const sent = [];
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s);
    const qa = s => Array.from(document.querySelectorAll(s));
    const PAGE = {
      slug: "maria-santos", name: "Maria Santos Dela Cruz", role: "salesperson", role_label: "PRC-accredited real estate salesperson",
      licence: { no: "0012345", valid_until: "2027-08-31", checked_on: "2026-10-12" },
      broker: { name: "Alfredo B. Reyes", licence_no: "0004321" },
      pitch: "Lots and homes in Lipa and Malvar, with the title checked before you pay a reservation.",
      bio: "I grew up in Lipa.\n\nMost of my clients are families buying their first lot.", bio_lang: "en",
      photo: "", towns: ["lipa-city", "malvar"], needs: ["buy", "lots"], languages: ["filipino", "english"],
      contacts: { call: "+639171234567", viber: "+639171234567", whatsapp: "+639181112222", messenger: "maria.santos" },
      sections: ["listings", "about", "video"], accent: "sea", reply: "within 30 minutes", listing_count: 3,
      listings: [
        { id: "L1", title: "Corner lot in Sabang", property_type: "lot", offer_type: "sale", price: 2850000, barangay: "Sabang", city: "Lipa City", lot_size_sqm: 300, image: "" },
        { id: "L2", title: "Two-storey house", property_type: "house-and-lot", offer_type: "sale", price: 4600000, city: "Lipa City", floor_area_sqm: 120, image: "" },
        { id: "L3", title: "Furnished 2-bedroom house", property_type: "house-and-lot", offer_type: "rent", rent: 18000, city: "Lipa City", image: "" }
      ]
    };
    window.fetch = function (url, init) {
      const u = String(url);
      const reply = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
      if (/\/agents\/maria-santos$/.test(u)) return reply(200, { data: PAGE });
      if (/\/agents\/maria-santos\/taps$/.test(u)) { sent.push({ kind: "tap", body: JSON.parse(init.body) }); return reply(202, { ok: true }); }
      if (/\/agents\/maria-santos\/inquiries$/.test(u)) { sent.push({ kind: "message", body: JSON.parse(init.body), key: (init.headers || {})["Idempotency-Key"] }); return reply(201, { id: "lead-1", message: "Sent" }); }
      if (/\/agents\/[^/]+$/.test(u)) return reply(404, { error: "Agent not found" });
      return realFetch.apply(this, arguments);
    };
    // Contact links would leave the page; keep the test here (the page's own handler still runs).
    document.addEventListener("click", e => { const a = e.target.closest && e.target.closest("a[data-ag-tap]"); if (a) e.preventDefault(); }, true);

    location.hash = "#/agents/maria-santos"; await wait(1600);
    const root = q(".ag");
    chk("the agent's page is drawn", !!root && /Maria Santos Dela Cruz/.test((q(".ag h1") || {}).textContent || ""));
    chk("the header says whose page it is, with SEA ESTATES", !!q(".ag-brand") && /Maria Santos Dela Cruz\s*with SEA ESTATES/.test(q(".ag-brand").textContent));
    chk("the role and towns are in plain words", /PRC-accredited real estate salesperson in Lipa City and Malvar, Batangas/.test((q(".ag-role") || {}).textContent || ""));
    const card = q(".ag-card");
    chk("the licence card shows the office's check and its date", !!card && /Licence checked by SEA ESTATES on 12 Oct 2026/.test(card.textContent));
    chk("and the licence number, valid-until month and supervising broker",
      !!card && /0012345/.test(card.textContent) && /Aug 2027/.test(card.textContent) && /Alfredo B\. Reyes, licence no\. 0004321/.test(card.textContent));
    chk("nothing claims to be verified yet (Phase 3)", !/verified/i.test(root ? root.textContent : ""));
    const actions = q(".ag-actions");
    chk("contact buttons for Viber, WhatsApp, Messenger and a call",
      !!actions && /Viber/.test(actions.textContent) && /WhatsApp/.test(actions.textContent) && /Messenger/.test(actions.textContent) && /Call 0917 123 4567/.test(actions.textContent)
      && !!q('a[href="https://wa.me/639181112222"]') && !!q('a[href="https://m.me/maria.santos"]') && !!q('a[href="tel:+639171234567"]'));
    chk("the reply time and listing count show", /3\s*active listings/.test((q(".ag-stats") || {}).textContent || "") && /Replies within 30 minutes/.test((q(".ag-stats") || {}).textContent || ""));
    chk("the page title names the agent", /^Maria Santos Dela Cruz, PRC-accredited real estate salesperson \| SEA ESTATES$/.test(document.title), document.title);
    chk("the chosen accent colour is used", getComputedStyle(q(".ag-mark")).backgroundColor === "rgb(14, 95, 99)", getComputedStyle(q(".ag-mark")).backgroundColor);

    // Listings and filters.
    chk("three listing cards", qa(".ag-listing").length === 3);
    const rentBtn = q('[data-ag-filter="rent"]');
    rentBtn.click(); await wait(100);
    chk("a filter shows only that kind and says it is on", qa(".ag-listing").filter(c => !c.hidden).length === 1 && rentBtn.getAttribute("aria-pressed") === "true" && q('[data-ag-filter="all"]').getAttribute("aria-pressed") === "false");
    q('[data-ag-filter="all"]').click(); await wait(100);
    chk("All shows every listing again", qa(".ag-listing").filter(c => !c.hidden).length === 3);
    chk("filters are buttons with a pressed state, not tabs", qa("[data-ag-filter]").every(b => b.tagName === "BUTTON" && b.hasAttribute("aria-pressed")) && !q('.ag [role="tab"]'));

    // About.
    const about = q(".ag-about");
    chk("about shows the bio and the fixed lists in words", !!about && /I grew up in Lipa\./.test(about.textContent) && /Lipa City, Malvar/.test(about.textContent) && /Buying a home, Lots and farm land/.test(about.textContent));
    chk("the footer carries the licence line and the scam warning", /supervised by Alfredo B\. Reyes/.test((q(".ag-footer") || {}).textContent || "") && /SEA ESTATES never asks you to pay into a personal account\./.test((q(".ag-footer") || {}).textContent || ""));

    // A tap is counted.
    q('.ag-actions a[data-ag-tap="viber"]').click(); await wait(200);
    chk("a Viber tap is counted", sent.some(s => s.kind === "tap" && s.body.kind === "viber"), JSON.stringify(sent));

    // Ask about a listing, then the form.
    q('[data-ag-ask="L1"]').click(); await wait(400);
    const form = q("[data-ag-form]");
    chk("Ask about this fills in the listing", form.listing_id.value === "L1" && /Corner lot in Sabang/.test(form.message.value));
    form.message.value = "";
    q(".ag-send").click(); await wait(200);
    chk("sending an empty form marks each problem beside its field",
      form.full_name.getAttribute("aria-invalid") === "true" && form.phone.getAttribute("aria-invalid") === "true" && form.consent.getAttribute("aria-invalid") === "true"
      && !!q("#ag-err-phone") && /Check the 3 highlighted fields/.test(q(".ag-status").textContent), q(".ag-status").textContent);
    chk("errors are tied to their fields for screen readers", /ag-err-phone/.test(form.phone.getAttribute("aria-describedby") || "") && /ag-phone-hint/.test(form.phone.getAttribute("aria-describedby") || ""));
    chk("the consent box starts unticked", form.consent.checked === false);
    form.full_name.value = "Ana Cruz"; form.phone.value = "0917 12"; form.consent.checked = true;
    q(".ag-send").click(); await wait(200);
    chk("a short phone number is refused with an example", /0917 123 4567/.test((q("#ag-err-phone") || {}).textContent || "") && !sent.some(s => s.kind === "message"));
    form.phone.value = "0917 222 3333";
    q(".ag-send").click(); await wait(600);
    const msg = sent.find(s => s.kind === "message");
    chk("the message is sent with consent, the listing and a resend key",
      !!msg && msg.body.consent === true && msg.body.full_name === "Ana Cruz" && msg.body.listing_id === "L1" && msg.body.section === "listing" && msg.body.want === "viewing" && !!msg.key && msg.body.website === "", JSON.stringify(msg));
    chk("the visitor is told it was sent and when to expect a reply", !!q(".ag-sent") && /Sent to Maria/.test(q(".ag-sent").textContent) && /usually within 30 minutes/.test(q(".ag-sent").textContent));

    chk("no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth + " > " + window.innerWidth);
    const phone = matchMedia("(max-width: 760px)").matches;
    const bar = q(".ag-phonebar");
    chk(phone ? "on a phone, the contact bar is fixed at the bottom" : "on a computer, there is no phone bar",
      phone ? getComputedStyle(bar).position === "fixed" && getComputedStyle(bar).display === "flex" : getComputedStyle(bar).display === "none");
    const small = qa(".ag button, .ag a.ag-btn, .ag input:not([type=hidden]), .ag select").filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44 && !e.closest(".ag-trap") && e.type !== "checkbox"; });
    chk("buttons and fields are at least 44 px tall", small.length === 0, small.map(e => e.className || e.name).join(", "));

    // An agent page that is not public.
    location.hash = "#/agents/nobody"; await wait(1200);
    chk("an unknown or unpublished agent shows a plain message, not an error", /This agent page is not available/.test(document.body.textContent) && !q(".ag"));

    // Signed in: the public page still shows, with a way back to the office.
    window.fetch = realFetch;
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    location.hash = "";
    await wait(300);
    q("#auth-role").value = "agent";
    q("#auth-test").click(); await wait(800);
    window.fetch = function (url) {
      if (/\/agents\/maria-santos$/.test(String(url))) return Promise.resolve(new Response(JSON.stringify({ data: PAGE }), { status: 200, headers: { "Content-Type": "application/json" } }));
      return realFetch.apply(this, arguments);
    };
    location.hash = "#/agents/maria-santos"; await wait(1500);
    chk("signed in, an agent link still opens the public page", !!q(".ag") && /Maria Santos Dela Cruz/.test(q(".ag h1").textContent));
    chk("with a bar back to the office, and the office menus out of the way",
      !!q("#office-bar") && q("#sidebar").classList.contains("hidden") && (!q("#tabbar") || q("#tabbar").classList.contains("hidden")));
    q("[data-office-back]").click(); await wait(900);
    chk("Back to the office returns to the office", !q("#office-bar") && !q("#sidebar").classList.contains("hidden") && !q(".ag") && !location.hash, location.hash);
  } catch (e) {
    chk("test ran without error", false, String(e && e.stack || e));
  } finally {
    window.fetch = realFetch;
    window.__msOk = window.__msChecks.length > 0 && window.__msChecks.every(c => c.ok);
    window.__msDone = true;
  }
})();
