"use strict";
/* Phase 9 (22 Oct): late fees on a lease (I6), vacant unit to listing (I9), Value Guide finish
   panel for a request (G1), reminder wording (A4/J4). Demo data, super-admin. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s), qa = s => Array.from(document.querySelectorAll(s));
    const setVal = (sel, v) => { const el = q(sel); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    const tab = async name => { const t = q('[data-pmtab="' + name + '"]'); if (t && t.offsetParent !== null) t.click(); else { const s = q("#pms-section"); s.value = name; s.dispatchEvent(new Event("change", { bubbles: true })); } await wait(500); };
    window.confirm = () => true;
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click(); await wait(700);
    q('#nav [data-view="pms"]').click(); await wait(900);
    const H = window.__ESREALTY_TEST_HELPERS, S = H.getState(), L = window.ESPMSLEDGER;
    const lease = S.pms.leases.find(l => l.id === "l-seed-1");
    chk("the demo lease exists", !!lease);
    // Six months back, so some months are certainly past the grace days.
    const back = new Date(); back.setMonth(back.getMonth() - 6); lease.start = L.today(back);

    // I6: the lease form saves the late fee.
    await tab("leases");
    q('[data-pms-edit="lease:l-seed-1"]').click(); await wait(500);
    chk("the lease form has late fee, kind and grace days", !!q("#pms-lease-late") && !!q("#pms-lease-latetype") && !!q("#pms-lease-grace"));
    setVal("#pms-lease-late", "500"); setVal("#pms-lease-latetype", "fixed"); setVal("#pms-lease-grace", "5");
    q('[data-pms-save="lease"]').click(); await wait(700);
    chk("saved on the lease", Number(lease.late_fee) === 500 && lease.late_fee_type === "fixed" && Number(lease.grace_days) === 5, JSON.stringify({ f: lease.late_fee, t: lease.late_fee_type, g: lease.grace_days }));
    const due = L.lateFeesDue(lease, S.pms.payments.filter(p => !p.archived), L.today());
    chk("unpaid months past the grace days owe a late fee", due.length >= 1, JSON.stringify(due));
    await tab("leases");
    const badge = q("[data-pms-late-badge]");
    chk("the lease row says a late fee is waiting", !!badge && /late fee/i.test(badge.textContent), badge ? badge.textContent : "none");
    q('[data-pms-charges="l-seed-1"]').click(); await wait(500);
    const list = q("[data-pms-late-list]");
    chk("the Charges dialog lists the late fees", !!list && /Late fees to add/.test(list.textContent) && /₱500/.test(list.textContent), list ? list.textContent.slice(0, 140) : "none");
    const before = (lease.charges || []).length;
    q("[data-pms-latefees]").click(); await wait(600);
    const added = (lease.charges || []).filter(c => c.type === "Late fee");
    chk("one press adds them as charges", added.length === due.length && (lease.charges || []).length === before + due.length && added.every(c => Number(c.amount) === 500 && c.period), JSON.stringify(added.map(c => c.period)));
    chk("then nothing is left to add", L.lateFeesDue(lease, S.pms.payments.filter(p => !p.archived), L.today()).length === 0 && !q("[data-pms-late-list]"));
    // Waive one: removing it does not bring it back.
    q('[data-pms-chargedel="l-seed-1|' + added[0].id + '"]').click(); await wait(500);
    chk("a removed late fee counts as waived", L.lateFeesDue(lease, S.pms.payments.filter(p => !p.archived), L.today()).length === 0);
    const cx = q("[data-pms-cancel]"); if (cx) cx.click(); await wait(200);

    // I9: vacant unit to listing.
    S.pms.units.push({ id: "u-test-vac", property_id: "p-seed-1", unit_number: "9Z", bedrooms: 2, bathrooms: 1, size: 45, rent_amount: 15000, status: "vacant", capacity: 1, archived: false });
    await tab("units");
    const lb = q('[data-pms-list-unit="u-test-vac"]');
    chk("a vacant unit offers List for rent", !!lb && /List for rent/.test(lb.textContent));
    chk("an occupied unit does not", !q('[data-pms-list-unit="u-seed-1"]'));
    lb.click(); await wait(800);
    chk("the listing form opens filled from the unit", !!q("#ls-modal") && q("#ls-deal").value === "rent" && Number(q("#ls-rent").value.replace(/,/g, "")) === 15000 && /2 bedrooms, 45 sqm unit for rent/i.test(q("#ls-title").value) && q("#ls-published").checked === false, q("#ls-title") ? [q("#ls-title").value, q("#ls-deal").value, q("#ls-rent").value, q("#ls-published").checked].join(" | ") : "no form");
    q("[data-ls-save]").click(); await wait(1500);
    const made = (S.listings || []).find(x => x.pmsUnitId === "u-test-vac");
    chk("the saved listing remembers its unit and stays a draft", !!made && made.isPublished === false && made.dealType === "rent", made ? JSON.stringify({ id: made.id, pub: made.isPublished }) : "none");
    q('#nav [data-view="pms"]').click(); await wait(800);
    await tab("units");
    const ul = q("[data-pms-unit-listing]");
    chk("the unit now shows its draft listing", !!ul && /Listing \(draft\)/.test(ul.textContent) && !q('[data-pms-list-unit="u-test-vac"]'));
    chk("no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth + " > " + window.innerWidth);

    // G1: the Value Guide's last screen for a request.
    S.leads = S.leads || [];
    S.leads.push({ id: "lead-vg-test", name: "Vera Guide", email: "vera@example.com", phone: "09171234567", status: "contacted", reportStatus: "verified", fullReport: { location: { town: "LIPA CITY", barangay: "SABANG" }, property: {}, estimate: {} }, activity: [], createdBy: S.leads[0] ? S.leads[0].createdBy : "" });
    let html = H.vgLeadFinishHtml({ fromLead: "lead-vg-test" });
    const box = document.createElement("div"); box.innerHTML = html;
    const g = box.querySelector("a[data-gmail]");
    chk("finish panel: Gmail addressed to the customer with the report wording", !!g && new URL(g.href).searchParams.get("to") === "vera@example.com" && /property value report for Lipa City · Sabang/.test(new URL(g.href).searchParams.get("body")), g ? g.href.slice(0, 120) : "none");
    chk("finish panel: Mark report sent and Back to the lead", !!box.querySelector("[data-vg-finish-sent]") && !!box.querySelector("[data-vg-back-lead]"));
    S.leads[S.leads.length - 1].reportStatus = "";
    box.innerHTML = H.vgLeadFinishHtml({ fromLead: "lead-vg-test" });
    chk("before the call: no Mark sent, says to call first", !box.querySelector("[data-vg-finish-sent]") && /Call the customer first/.test(box.textContent));
    chk("no panel without a request", H.vgLeadFinishHtml({}) === "");
  } catch (e) { window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.stack || e.message || e) + "" }); }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
