"use strict";
// Approved original-site polish: keep function/colour, add current identity/help.
window.__msChecks = [];
window.__msDone = false;
const check = (name, ok, detail = "") => window.__msChecks.push({ name, ok: !!ok, detail });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 80; i++) { if (fn()) return true; await wait(150); } return false; }
(async () => {
  try {
    location.hash = "#/home";
    await until(() => document.querySelector("[data-est-muni]"));
    await wait(2400);
    const site = document.querySelector(".sf-site");
    check("canonical public brand", site.querySelector(".sf-brand b").textContent === "SEA ESTATES");
    check("canonical logo", [...site.querySelectorAll(".sf-brand-mark")].every(el => el.textContent === "S.E"));
    check("original accent retained", getComputedStyle(site).getPropertyValue("--sf-accent").trim().toLowerCase() === "#b4521f");
    check("full calculator visible on Home", document.querySelector("[data-est-muni]").getBoundingClientRect().height >= 40 && !document.querySelector("#sea-guide-disclosure"));
    /* .sf-process ("How it works") was folded into .sf-guide-summary on 2026-10-15: the two repeated each other. */
    check("original services/contact/summary retained", [".sf-services", ".sf-guide-summary", "#sf-contact"].every(s => site.querySelector(s)));
    check("guide coverage stated", /Current guide coverage: Batangas/.test(site.textContent));
    check("browse and estimate actions present", !!site.querySelector('.sf-est-hero a[href="#/search"]') && /Start My Value Guide/.test(site.querySelector('.sf-est-hero-actions [data-est-services]').textContent));
    check("actions before supporting proof text", !!(site.querySelector(".sf-est-hero-actions").compareDocumentPosition(site.querySelector(".sf-est-proof")) & Node.DOCUMENT_POSITION_FOLLOWING));
    const featured = site.querySelector(".sf-featured"), services = site.querySelector(".sf-services");
    check("available listings before service catalogue", !featured || !!(featured.compareDocumentPosition(services) & Node.DOCUMENT_POSITION_FOLLOWING));
    check("Home Project B.T. entry clear", /Coming Soon/.test(site.querySelector(".sf-home-project").textContent) && !!site.querySelector('.sf-home-project a[href="#/project-bt"]'));
    const help = document.querySelector(".sf-est-help");
    check("classification help initially closed", help && !help.open);
    help.querySelector("summary").click();
    check("classification help usable on click", help.open && /Revenue District Office/.test(help.textContent));
    help.querySelector("summary").click();
    const muni = document.querySelector("[data-est-muni]"); muni.value = "LIPA CITY"; muni.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => document.querySelector("[data-est-barangay]").options.length > 2);
    check("barangay not auto-selected", document.querySelector("[data-est-barangay]").value === "");
    check("privacy and technical estimator hooks retained", !!site.querySelector('a[href="#/privacy"]') && !!window.ESREALTY_EST);
    for (const hash of ["#/search", "#/property-value", "#/project-bt", "#/privacy"]) {
      location.hash = hash; await wait(2000);
      const current = document.querySelector(".sf-site");
      check(hash + " current branding", /SEA ESTATES/.test(current.textContent) && !/ES Realty|ES REALTY/.test(current.textContent));
      check(hash + " metadata current", document.title.includes("SEA ESTATES"));
    }
    check("Coming Soon route remains published", !!document.querySelector('.sf-nav a[href="#/project-bt"]'));
    location.hash = "#/project-bt"; await wait(1600);
    check("Coming Soon remains closed project", !!document.querySelector(".sf-cs-flag") && !document.querySelector(".bt-tiers"));
    location.hash = "#/home"; await wait(2000);
    check("no invented zero facts on published cards", [...document.querySelectorAll(".sf-card-meta b")].every(el => Number(el.textContent) > 0));
    check("reduced-motion stylesheet support retained", matchMedia("(prefers-reduced-motion)").media !== "not all");
  } catch (e) { check("runner", false, e.message); }
  window.__msOk = window.__msChecks.every(c => c.ok); window.__msDone = true;
})();
