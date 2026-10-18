"use strict";
/* Public site (2026-10-18): choosing a page from the menu while scrolled down
   opens it at the top (it used to open at the bottom); jumping to the request
   form (?go=form) still lands on the form. */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 80) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);
const bottom = () => window.scrollTo(0, document.documentElement.scrollHeight);

(async () => {
  try {
    localStorage.removeItem("esrealty_user");
    location.hash = "#/home";
    await until(() => q(".sf-cta-go"));
    await wait(800);
    bottom(); await wait(400);
    check("home is scrolled to the bottom", window.scrollY > 400, window.scrollY);
    // A service from the menu (same link the Services dropdown uses)
    location.hash = "#/property-value?service=sell";
    await until(() => q(".sf-pv")); await wait(500);
    check("the service page opens at the top", window.scrollY < 5, window.scrollY);
    bottom(); await wait(400);
    location.hash = "#/property-value?service=manage";
    await until(() => /manage/i.test(location.hash) && q(".sf-pv")); await wait(500);
    check("another service from the bottom of a service page: top again", window.scrollY < 5, window.scrollY);
    bottom(); await wait(300);
    location.hash = "#/search";
    await wait(900);
    check("another page from the menu: top", window.scrollY < 5, window.scrollY);
    location.hash = "#/home"; await until(() => q(".sf-cta-go")); await wait(800);
    bottom(); await wait(300);
    q(".sf-cta-go").click();
    await until(() => q("#sf-pv-form")); await wait(1400);
    const top = q("#sf-pv-form").getBoundingClientRect().top;
    check("Message our team still lands on the form", top >= 0 && top < 160, Math.round(top));
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack : String(e));
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
