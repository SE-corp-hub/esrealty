"use strict";
/* Phase 12 (22 Oct): Find a person (B2) and last sign-in (K4). Demo, super-admin. */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }
(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s), qa = s => Array.from(document.querySelectorAll(s));
    window.confirm = () => true;
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "super-admin";
    q("#auth-test").click(); await wait(700);
    q('#nav [data-view="users"]').click(); await wait(900);
    const ap = q('[data-users-tab="approved"]'); if (ap) { ap.click(); await wait(600); }
    const chip = q("[data-last-signin]");
    chk("approved accounts show when they last signed in", !!chip && /Last signed in 3 days ago|Signed in|Never signed in/.test(chip.textContent), chip ? chip.textContent : "none");
    const tab = q('[data-users-tab="person"]');
    chk("Super Admins have Find a person", !!tab);
    tab.click(); await wait(600);
    chk("it explains what it is for", /Data Privacy Act/.test((q("#person-find") || {}).textContent || ""));
    q("#person-q").value = "0917 555 0123";
    q("[data-person-form] button[type=submit]").click(); await wait(800);
    const H = window.__ESREALTY_TEST_HELPERS;
    const rows = qa("#person-find table.data tr").slice(1);
    chk("a phone search lists every place the person appears", rows.length === 2 && /lead/.test(rows[0].textContent) && /listing inquiry/.test(rows[1].textContent), rows.map(r => r.textContent).join(" | "));
    chk("download and erase are offered for a phone or email search", !!q("[data-person-export]") && !!q("[data-person-erase]"));
    chk("it says what erase keeps", /Property Management records, accounts, deals/.test(q("#person-find").textContent));
    q("#person-q").value = "Maria";
    q("[data-person-form] button[type=submit]").click(); await wait(800);
    chk("a name search does not offer erase (a name can match others)", !q("[data-person-erase]") && /search by their phone number or email/.test(q("#person-find").textContent));
    q("#person-q").value = "0917 555 0123";
    q("[data-person-form] button[type=submit]").click(); await wait(800);
    const S = H.getState(); const before = S.leads.length;
    q("[data-person-erase]").click(); await wait(400);
    const typed = q("#cx-modal input"); if (typed) { typed.value = "ERASE"; typed.dispatchEvent(new Event("input", { bubbles: true })); }
    await wait(1500);
    chk("erase removes the person's leads (after typing ERASE)", S.leads.length === before - 1 && !S.leads.some(l => l.id === "lead-seed-2"), before + " -> " + S.leads.length);
    chk("no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth + " > " + window.innerWidth);
  } catch (e) { window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.stack || e.message || e) + "" }); }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
