"use strict";
/* Agent websites, Phase 1: My website (the agent's editor) and the Super Admin's licence check,
   both in demo mode, so this runs offline. Desktop, tablet and phone widths in CI. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s);
    const qa = s => Array.from(document.querySelectorAll(s));
    const type = async (el, value) => { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); await wait(80); };
    const tick = async (el, on) => { el.checked = on; el.dispatchEvent(new Event("change", { bubbles: true })); await wait(80); };
    const preview = () => q("[data-site-preview] .ag");

    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    location.hash = "";
    q("#auth-role").value = "agent";
    q("#auth-test").click(); await wait(800);
    chk("agents have My website in the menu", !!q('#nav [data-view="website"]') && !q('#nav [data-view="website"]').classList.contains("nav-hidden"));
    q('#nav [data-view="website"]').click(); await wait(900);
    chk("My website opens", !!q(".site-editor") && /My website/.test(q(".site-editor h1").textContent));
    chk("a new page is not published, and says so", /Not published/.test((q("[data-site-status]") || {}).textContent || ""));
    chk("the name and licence come from the office's licence check", /Ask a Super Admin to change them/.test(q(".site-editor").textContent) && !q("#site-name"));
    chk("the preview is the real page drawing, and cannot be used", !!preview() && q("[data-site-preview]").hasAttribute("inert"));
    chk("the readiness list starts at 0 of 5", /0 of 5 done/.test((q("[data-site-ready-count]") || {}).textContent || ""));

    await type(q("#site-pitch"), "Lots and homes in Lipa, with the title checked first.");
    chk("typing a pitch updates the preview and the count", /Lots and homes in Lipa, with the title checked first\./.test((preview().querySelector(".ag-pitch") || {}).textContent || "") && q('[data-site-count="pitch"]').textContent === "53");
    chk("and ticks the readiness list", /1 of 5 done/.test(q("[data-site-ready-count]").textContent));

    await type(q("#site-c-call"), "0917 12");
    chk("a short phone number gets a plain hint", /0917 123 4567/.test(q('[data-site-contact-hint="call"]').textContent) && q("#site-c-call").getAttribute("aria-invalid") === "true");
    await type(q("#site-c-call"), "0917 123 4567");
    await type(q("#site-c-viber"), "0917 123 4567");
    chk("a good number clears the hint and shows as a button in the preview", q('[data-site-contact-hint="call"]').textContent === "" && /Call 0917 123 4567/.test(preview().textContent) && /Viber/.test((preview().querySelector(".ag-actions") || {}).textContent || ""));

    await tick(q('[data-site-list="Towns you cover"][value="lipa-city"]'), true);
    await tick(q('[data-site-list="Towns you cover"][value="malvar"]'), true);
    chk("towns are picked from the Value Guide's list and shown in words", /in Lipa City and Malvar, Batangas/.test((preview().querySelector(".ag-role") || {}).textContent || ""));
    chk("there is no free page name field", !q('[data-site-field="name"]') && !q('[data-site-field="page_name"]'));
    await tick(q('[data-site-accent][value="sea"]'), true);
    chk("the colour choice shows in the preview", getComputedStyle(preview().querySelector(".ag-mark")).backgroundColor === "rgb(14, 95, 99)");
    await tick(q('[data-site-section="video"]'), true);
    chk("optional sections are switches", /Video viewings for buyers abroad/.test(preview().textContent));
    chk("the licence card has no switch", !q('[data-site-section="licence"]') && /Your licence card always shows/.test(q(".site-editor").textContent));

    q("[data-site-publish]").click(); await wait(900);
    chk("publishing makes the page live with its address", /^Live$/.test((q("[data-site-status]") || {}).textContent || "") && /agents\/[a-z0-9-]+$/.test((q("[data-site-address]") || {}).textContent || ""), (q("[data-site-address]") || {}).textContent);
    chk("with a link to view the page", !!q('.site-editor a[href^="#/agents/"]'));
    await type(q("#site-pitch"), "New words for my page.");
    chk("a change after publishing is marked as not published yet", /not published yet/.test(q("[data-site-status]").textContent));
    q("[data-site-unpublish]").click(); await wait(900);
    chk("taking the page down says so", /Not published/.test(q("[data-site-status]").textContent));
    chk("no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth + " > " + window.innerWidth);
    const small = qa(".site-editor button, .site-editor input:not([type=checkbox]):not([type=radio]):not([type=file]), .site-editor .site-check").filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 36 && !e.closest("[data-site-preview]"); });
    chk("controls are comfortable to tap", small.length === 0, small.map(e => e.className || e.id).join(", "));

    // A Super Admin records a licence check.
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    location.hash = "";
    q("#auth-role").value = "super-admin";
    q("#auth-test").click(); await wait(800);
    q('#nav [data-view="users"]').click(); await wait(900);
    const approvedTab = q('[data-users-tab="approved"]'); if (approvedTab) { approvedTab.click(); await wait(700); }
    const btn = q('[data-licence-check="demo-approved-1"]');
    chk("agents and brokers have a licence check button; the card says none is recorded", !!btn && /No licence check yet/.test(btn.closest(".user-card").textContent) && !q('[data-licence-check="demo-pending-1"]'));
    btn.click(); await wait(300);
    const modal = q("#lc-modal");
    chk("the licence check asks for the number, the PRC name and the date", !!modal && !!q("#lc-no") && !!q("#lc-name") && q("#lc-until").type === "date");
    q("#lc-no").value = "0012345"; q("#lc-name").value = "Ana M. Lopez"; q("#lc-until").value = "";
    q("[data-lc-save]").click(); await wait(200);
    chk("a missing date is explained", /valid until/.test(q("[data-lc-error]").textContent));
    q("#lc-no").value = "0012345"; q("#lc-name").value = "Ana M. Lopez"; q("#lc-until").value = "2027-08-31";
    const bk = q("#lc-broker"); if (bk) bk.checked = true;
    q("[data-lc-save]").click(); await wait(700);
    chk("saving closes the box and the card shows the check", !q("#lc-modal") && /Licence checked, valid until 2027-08-31/.test((q('[data-licence-check="demo-approved-1"]') || document.body).closest(".user-card").textContent));
    chk("the button now updates the check", /Update licence check/.test((q('[data-licence-check="demo-approved-1"]') || {}).textContent || ""));
  } catch (e) {
    chk("test ran without error", false, String(e && e.stack || e));
  } finally {
    window.__msOk = window.__msChecks.length > 0 && window.__msChecks.every(c => c.ok);
    window.__msDone = true;
  }
})();
