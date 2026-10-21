"use strict";
/* Phase 8 app: "Email via Gmail" buttons (E1, owner decision: email by hand). Demo mode. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s), qa = s => Array.from(document.querySelectorAll(s));
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click(); await wait(600);
    q('[data-view="leads"]').click(); await wait(900);
    const H = window.__ESREALTY_TEST_HELPERS;
    const lead = (H.getState().leads || []).find(l => l.email);
    const card = lead && q('[data-lead-open="' + lead.id + '"]');
    chk("a demo lead with an email exists", !!card, lead && lead.id);
    card.click(); await wait(700);
    const g = qa("a[data-gmail]").find(a => /Email via Gmail/.test(a.textContent));
    chk("lead details offer Email via Gmail", !!g, "");
    const u = new URL(g.href);
    chk("it opens Gmail's new message", u.origin === "https://mail.google.com" && u.searchParams.get("view") === "cm", g.href.slice(0, 80));
    chk("addressed to the lead", u.searchParams.get("to") === lead.email, u.searchParams.get("to"));
    chk("with a subject and a greeting by first name", /^Your inquiry with SEA ESTATES/.test(u.searchParams.get("su")) && u.searchParams.get("body").indexOf("Hi " + lead.name.split(" ")[0] + ",") === 0, u.searchParams.get("su"));
    chk("in a new tab, without giving Gmail this page", g.target === "_blank" && /noopener/.test(g.rel));
    chk("signed with the staff name and SEA ESTATES", /\n\nRegards,\n.+\nSEA ESTATES/.test(u.searchParams.get("body")), "");
    // Password reset (demo): the modal offers Gmail when the account has an email.
    q('[data-view="users"]').click(); await wait(900);
    const approved = q('[data-users-tab="approved"]'); if (approved) { approved.click(); await wait(600); }
    const btn = q("[data-cloud-reset-pass]");
    chk("a reset button is shown", !!btn, "");
    btn.click(); await wait(900);
    const rp = q("#rp-modal");
    const rg = rp && Array.from(rp.querySelectorAll("a[data-gmail]"))[0];
    chk("the new password can be emailed via Gmail", !!rg && /Email it via Gmail/.test(rg.textContent), rp ? rp.textContent.slice(0, 120) : "no modal");
    if (rg) {
      const ru = new URL(rg.href);
      chk("the message holds the temporary password and says to change it", ru.searchParams.get("body").indexOf(q("#rp-pass").value) > 0 && /choose a new password/.test(ru.searchParams.get("body")), "");
    }
    // H8: listing performance for the owner.
    qa(".modal-backdrop, #rp-modal").forEach(m => m.remove());
    q('#nav [data-view="listings"]').click(); await wait(900);
    if (!q("[data-ls-open]")) {
      q("[data-ls-new]").click(); await wait(600);
      q("#ls-title").value = "Test 3BR House and Lot, Silang"; q("#ls-price").value = "5600000";
      q("[data-ls-save]").click(); await wait(1200);
    }
    const lc = q("[data-ls-open]");
    chk("a listing card exists", !!lc, "");
    lc.click(); await wait(900);
    const perf = q("[data-ls-perf]");
    chk("the listing shows its performance to staff", !!perf && /Page views/.test(perf.textContent) && /Inquiry rate/.test(perf.textContent) && /Days on market/.test(perf.textContent), perf ? perf.textContent.slice(0, 120) : "none");
    const pg = perf && perf.querySelector("a[data-gmail]");
    chk("with an Email the owner via Gmail link holding the summary", !!pg && /Page views: \d+/.test(new URL(pg.href).searchParams.get("body")), "");
    const pf = H.listingPerformance({ id: "x", views: 200, inquiries: 5, createdAt: "2026-10-01T00:00:00Z", price: 900, previousPrice: 1000 }, Date.parse("2026-10-15T00:00:00Z"));
    chk("performance numbers: 14 days, 2.5% rate, price drop", pf.days === 14 && pf.rate === 2.5 && pf.dropped && pf.perWeek === 100, JSON.stringify(pf));
    // I11: unpaid rent by age.
    const ag = H.pmsAgeing([]);
    chk("rent ageing has four buckets", Array.isArray(ag) && ag.length === 4, JSON.stringify(ag));
    q('#nav [data-view="pms"]').click(); await wait(800);
    const rt = q('[data-pmtab="reports"]'); if (rt && rt.offsetParent !== null) rt.click(); else { const s = q("#pms-section"); if (s) { s.value = "reports"; s.dispatchEvent(new Event("change", { bubbles: true })); } }
    await wait(700);
    chk("reports show unpaid rent by age and yield", /Unpaid rent by age/.test(document.body.textContent), "");
  } catch (e) { window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) }); }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
