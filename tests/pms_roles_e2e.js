"use strict";
/* Who gets Property Management (owner's decision, 2026-10-17): super-admins and
   brokers manage it; owners and tenants get their portals; agents, buyers and
   sellers get nothing. On the live site each broker manages a book of their
   own (supabase/archive/pms_v3_books.sql, tested against the database separately);
   this checks the menus and screens in the offline demo. */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);
const pmsInMenu = () => !!q('#nav [data-view="pms"]:not(.nav-hidden)');

async function loginAs(role) {
  const out = q("#btn-signout");
  if (out && q("#content") && q("#content").children.length && !q("#auth-test")) { out.click(); await wait(600); }
  await until(() => q("#auth-test"));
  localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
  q("#auth-role").value = role;
  q("#auth-test").click();
  await until(() => q("#content") && q("#content").children.length > 0);
  await wait(500);
}

(async () => {
  try {
    location.hash = "#/home";
    window.confirm = () => true;
    await loginAs("broker");
    check("broker: Property Manager is in the menu", pmsInMenu());
    const nav = q('#nav [data-view="pms"]');
    if (nav) { nav.click(); await wait(700); }
    check("broker: opens the management screen, not a portal", !!q(".pms-kpis") && !/Owner Portal|Tenant Portal/.test(q("#content").textContent));
    check("broker: can add records", !!q("[data-pms-new]"));
    for (const role of ["agent", "buyer", "seller"]) {
      await loginAs(role);
      check(role + ": no Property Manager in the menu", !pmsInMenu());
    }
    for (const role of ["owner", "tenant"]) {
      await loginAs(role);
      check(role + ": has their portal in the menu", pmsInMenu());
    }
    await loginAs("super-admin");
    check("super-admin: Property Manager is in the menu", pmsInMenu());
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack.slice(0, 300) : e);
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
