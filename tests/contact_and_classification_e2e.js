"use strict";
/* Public site feedback (2026-10-18):
   - home "Message our team" lands on the request form itself (top of the
     screen), not the introduction above it;
   - Value Guide step 1: Classification sits right below Street, outside
     "More options", so a commercial or agricultural value isn't a surprise. */
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, tries = 80) { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(100); } return !!fn(); }
const q = s => document.querySelector(s);

(async () => {
  try {
    localStorage.removeItem("esrealty_user");
    location.hash = "#/home";
    await until(() => q(".sf-cta-go"));
    const btn = q(".sf-cta-go");
    check("home: Message our team goes to the form", !!btn && btn.getAttribute("href") === "#/property-value?go=form", btn && btn.getAttribute("href"));
    btn.scrollIntoView(); btn.click();
    await until(() => q("#sf-pv-form"));
    await wait(1500);
    const top = q("#sf-pv-form").getBoundingClientRect().top;
    check("the request form is at the top of the screen", top >= 0 && top < 160, Math.round(top));
    check("its first box is ready to type in (keyboard-and-mouse screens)", !window.matchMedia("(pointer: fine)").matches || (document.activeElement && document.activeElement.name === "name"), document.activeElement && document.activeElement.name);

    location.hash = "#/home";
    await until(() => q("[data-est-services]"));
    await wait(600);
    q("[data-est-services]").click();
    await until(() => q('[data-est-screen="1"] [data-est-class]'));
    const step = q('[data-est-screen="1"]');
    const order = Array.from(step.querySelectorAll(".sf-est-label")).filter(el => !el.closest(".sf-est-more")).map(el => el.textContent.trim().replace(/\s*\(.*$/, ""));
    const iStreet = order.indexOf("Street"), iClass = order.indexOf("Classification"), iArea = order.indexOf("Lot area");
    check("Value Guide: Classification comes right after Street, before Lot area", iStreet >= 0 && iClass === iStreet + 1 && (iArea === -1 || iArea === iClass + 1), JSON.stringify(order));
    check("... and is no longer inside More options", !q(".sf-est-more [data-est-class]") && !/classification/i.test((q(".sf-est-more-sub") || {}).textContent || ""));
    check("it says the classification changes the value", /own BIR rates/.test(q("[data-est-class]").closest(".sf-est-field").textContent));
    check("Residential is still the default", q("[data-est-class]").value === "RR", q("[data-est-class]").value);
    check("no sideways scroll", document.documentElement.scrollWidth <= window.innerWidth + 2, document.documentElement.scrollWidth);
  } catch (e) {
    check("runner", false, e && e.stack ? e.stack : String(e));
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
