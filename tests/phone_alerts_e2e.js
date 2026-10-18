"use strict";
/* Phone alerts (2026-10-18), demo: Settings has a Phone alerts card (demo
   explains it needs a live account), and the notification bell links to it. */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 60) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);

(async () => {
  try {
    location.hash = "#/home";
    await until(() => q("#auth-test"));
    localStorage.removeItem("esrealty_v1"); localStorage.removeItem("esrealty_user");
    q("#auth-role").value = "agent";
    q("#auth-test").click();
    await until(() => q("#content") && q("#content").children.length > 0);
    await wait(500);
    const bell = q("#notif-bell");
    check("the bell is there", !!bell);
    if (bell) { bell.click(); await wait(400); }
    const link = q("#ntf-phone");
    check("the bell's panel links to phone alerts", !!link && /Get these on your phone/.test(link.textContent));
    if (link) { link.click(); await wait(900); }
    const card = q("#st-push");
    check("it opens Settings at the Phone alerts card", !!card && /Phone alerts/.test(card.textContent));
    check("demo: says alerts need a live account, no buttons", !!card && /live account/.test(card.textContent) && !card.querySelector("[data-push-on]"));
    check("no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth);
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack : String(e));
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
