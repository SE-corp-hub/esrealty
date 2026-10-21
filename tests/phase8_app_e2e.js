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
  } catch (e) { window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) }); }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
