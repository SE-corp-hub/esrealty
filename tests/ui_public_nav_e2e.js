"use strict";
/* Cover for the Phase 2/3 public navigation restructure:
 *   - single-source nav generation (desktop + mobile must agree)
 *   - Services and Project B.T dropdowns
 *   - #/shophouse redirecting to the coming-soon page
 *   - the coming-soon page exposing no project detail
 *   - the Get My Property Value page and its short form
 *   - route-aware document titles
 */
window.__msChecks = [];
window.__msDone = false;
function chk(n, ok, d) { window.__msChecks.push({ name: n, ok: !!ok, detail: d || "" }); }

(async () => {
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const go = async (hash, ms) => { location.hash = hash; await wait(ms || 1500); };
    const desktop = () => Array.from(document.querySelectorAll(".sf-nav a")).map(a => a.getAttribute("href"));
    const mobile = () => Array.from(document.querySelectorAll("[data-sf-menu-panel] a")).map(a => a.getAttribute("href"));

    await go("#/home", 1800);

    /* ---- dropdowns exist ---- */
    const drops = Array.from(document.querySelectorAll(".sf-nav [data-sf-drop]"));
    chk("nav-two-dropdowns", drops.length === 2, "count=" + drops.length);
    const labels = drops.map(d => (d.querySelector("summary") || {}).textContent || "");
    chk("nav-services-dropdown", labels.some(l => l.indexOf("Services") === 0), JSON.stringify(labels));
    chk("nav-projectbt-dropdown", labels.some(l => l.indexOf("Project B.T") === 0), JSON.stringify(labels));
    chk("nav-dropdown-summary-not-de", !drops.some(d => d.querySelector("summary").hasAttribute("aria-disabled")), "unexpected aria-disabled");
    chk("nav-dropdown-chevron-decorative", !!drops[0].querySelector(".sf-chev[aria-hidden='true']"), "chev=" + !!drops[0].querySelector(".sf-chev"));

    /* ---- services mega-menu content ---- */
    const svc = drops.find(d => (d.querySelector("summary").textContent || "").indexOf("Services") === 0);
    const svcItems = svc ? Array.from(svc.querySelectorAll(".sf-drop-panel a:not(.sf-drop-all)")) : [];
    chk("nav-services-nine-items", svcItems.length === 9, "count=" + svcItems.length);
    const tour = svc && svc.querySelector(".sf-drop-panel a.sf-drop-all");
    chk("nav-services-tour-first", !!tour && tour === svc.querySelector(".sf-drop-panel a") && tour.getAttribute("href") === "services-3d.html", tour ? tour.getAttribute("href") : "none");
    const svcLabels = svcItems.map(a => a.textContent.replace(/\s+/g, " ").trim());
    ["Buying a property", "Selling a property", "Renting / leasing", "Pre-selling & developer projects", "Property appraisal & valuation", "Talk to a licensed broker", "Property management", "Title & documentation", "Financing / Pag-IBIG & bank"]
      .forEach((label, i) => chk("nav-service-" + i + "-" + label.toLowerCase().replace(/[^a-z]/g, ""), (svcLabels[i] || "").indexOf(label) === 0, "got=" + svcLabels[i]));
    /* Every service must land somewhere real. Buying/Renting keep the listings
       search; everything else funnels through Get My Property Value with its
       own intro. None may bounce to the homepage services section. */
    const svcHrefList = svcItems.map(a => a.getAttribute("href"));
    chk("nav-services-no-homepage-bounce", svcHrefList.every(h => (h || "").indexOf("#/home?section=services") === -1), JSON.stringify(svcHrefList));
    chk("nav-services-buying-renting-to-search", svcHrefList[0] === "#/search" && svcHrefList[2] === "#/search?offer_type=rent", JSON.stringify(svcHrefList.slice(0, 3)));
    chk("nav-services-funnel-to-property-value", svcHrefList.filter(h => h.indexOf("#/property-value?service=") === 0).length === 7, JSON.stringify(svcHrefList));
    chk("nav-services-broker-item", svcHrefList.indexOf("#/property-value?service=broker") === 5, "broker=" + svcHrefList[5]);

    /* ---- Project B.T merges shophouse + project, both to coming soon ---- */
    const bt = drops.find(d => (d.querySelector("summary").textContent || "").indexOf("Project B.T") === 0);
    const btItems = bt ? Array.from(bt.querySelectorAll(".sf-drop-panel a:not(.sf-drop-all)")) : [];
    chk("nav-bt-two-items", btItems.length === 2, "count=" + btItems.length);
    chk("nav-bt-both-route-to-coming-soon", btItems.every(a => a.getAttribute("href") === "#/project-bt"), JSON.stringify(btItems.map(a => a.getAttribute("href"))));

    /* ---- no separate Shophouse top-level link, and desktop/mobile agree ---- */
    chk("nav-no-standalone-shophouse", !desktop().includes("#/shophouse"), JSON.stringify(desktop()));
    const d = desktop(), m = mobile();
    m.forEach((href, i) => chk("nav-parity-" + i, d.indexOf(href) > -1, "mobile " + href + " missing from desktop"));
    /* Since 2026-10-15 the highlighted nav item opens the calculator itself
       (Free Value Guide); the contact page is reached from Services. */
    chk("nav-value-guide-is-cta", !!document.querySelector(".sf-nav a.sf-nav-cta[data-est-services]") && /Free Value Guide/.test(document.querySelector(".sf-nav a.sf-nav-cta").textContent), "cta missing");
    chk("services-reach-contact-page", d.some(h => h.indexOf("#/property-value") === 0), JSON.stringify(d));
    chk("no-public-auth-in-header", !document.querySelector(".sf-header [data-sf-auth]"), "Sign in / Create account still in the header");

    /* ---- dropdown open/close behaviour ---- */
    const summary = svc.querySelector("summary");
    summary.click();
    await wait(320);
    chk("nav-dropdown-opens", svc.open === true, "open=" + svc.open);
    if (drops[1]) { drops[1].querySelector("summary").click(); await wait(320); }
    chk("nav-only-one-open", svc.open === false && (drops[1] ? drops[1].open === true : true), "svc=" + svc.open + " bt=" + (drops[1] ? drops[1].open : "n/a"));
    document.body.click();
    await wait(320);
    chk("nav-dropdown-closes-on-outside-click", drops.every(x => !x.open), "open=" + drops.map(x => x.open).join(","));
    summary.click(); await wait(200);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(300);
    chk("nav-dropdown-escape-closes", drops.every(x => !x.open), "open=" + drops.map(x => x.open).join(","));

    /* ---- route titles ---- */
    await go("#/property-value", 1600);
    chk("title-property-value", document.title === "Talk to our team | SEA ESTATES", "title=" + document.title);
    await go("#/property-value?service=broker", 1600);
    chk("title-property-value-broker", document.title === "Talk to a licensed broker | SEA ESTATES", "title=" + document.title);
    await go("#/project-bt", 1600);
    chk("title-project-bt", document.title.indexOf("Project B.T") === 0, "title=" + document.title);
    await go("#/search", 1800);
    chk("title-search", document.title.indexOf("Properties for sale and rent") === 0, "title=" + document.title);
    await go("#/home", 1600);
    chk("title-home", document.title === "SEA ESTATES | Properties & Batangas Value Guide", "title=" + document.title);

    /* ---- #/shophouse redirects to coming soon ---- */
    await go("#/shophouse", 1900);
    chk("shophouse-redirects-to-project-bt", location.hash === "#/project-bt", "hash=" + location.hash);
    chk("shophouse-legacy-content-not-rendered", !document.querySelector(".sf-hero") && !document.querySelector(".sf-marquee"), "legacy shophouse markup still present");

    /* ---- coming soon page ---- */
    chk("cs-page", !!document.querySelector(".sf-cs"), "cs=" + !!document.querySelector(".sf-cs"));
    chk("cs-coming-soon-flag", /coming soon/i.test((document.querySelector(".sf-cs-flag") || {}).textContent || ""), "flag=" + ((document.querySelector(".sf-cs-flag") || {}).textContent));
    chk("cs-notify-form", !!document.querySelector("[data-sf-notify]"), "form=" + !!document.querySelector("[data-sf-notify]"));
    chk("cs-notify-email-only", document.querySelectorAll("[data-sf-notify] input").length === 2, "inputs=" + document.querySelectorAll("[data-sf-notify] input").length);
    chk("cs-notify-consent-required", !!document.querySelector("[data-sf-notify] input[name=consent][required]"), "consent missing");
    chk("cs-hides-project-detail", !/floor plan|price|unit|₱|lot size|square meter/i.test(document.querySelector(".sf-cs").textContent), "leaked project detail");
    chk("cs-offers-next-step", !!document.querySelector(".sf-cs-actions a[data-est-services]"), "no next step");

    /* ---- Get My Property Value page ---- */
    await go("#/property-value", 1700);
    chk("pv-page", !!document.querySelector(".sf-pv"), "pv=" + !!document.querySelector(".sf-pv"));
    chk("pv-help-h1", /Get expert help/i.test((document.querySelector(".sf-pv-hero h1") || {}).textContent || ""), "h1=" + ((document.querySelector(".sf-pv-hero h1") || {}).textContent));
    chk("pv-what-happens", document.querySelectorAll(".sf-pv-steps-list li").length === 3, "steps=" + document.querySelectorAll(".sf-pv-steps-list li").length);
    chk("pv-team-call-step", /call with our team/i.test(document.querySelector(".sf-pv-steps-list").textContent), "no call step");
    const form = document.querySelector(".sf-pv-form[data-sf-consult]");
    chk("pv-form", !!form, "form=" + !!form);
    /* Research: 3-4 fields convert materially better than 6+. Count the
       askable fields, excluding the consent checkbox and submit. */
    const askable = form ? Array.from(form.querySelectorAll("input, select, textarea")).filter(el => el.type !== "checkbox" && el.name) : [];
    chk("pv-form-short", askable.length >= 3 && askable.length <= 4, "fields=" + askable.length);
    chk("pv-form-consent", !!form.querySelector("input[name=consent][required]"), "consent missing");
    chk("pv-form-microcopy", /30 seconds|no spam|no obligation/i.test(form.textContent), "no microcopy");
    chk("pv-form-autocomplete", Array.from(askable).some(el => el.getAttribute("autocomplete") === "name"), "no autocomplete=name");

    /* Field-name contract: the shared data-sf-consult handler reads
       consultData.get("name") into full_name, so any form using this handler
       must name that input "name". Mismatching it silently posts a null name. */
    const consultHandler = await fetch("js/storefront.js").then(r => r.text());
    const readsName = /full_name:\s*consultData\.get\("name"\)/.test(consultHandler);
    chk("consult-handler-reads-name", readsName, "handler no longer maps name -> full_name");
    chk("pv-form-name-field-matches-handler", !!form.querySelector("[name=name]"), "property-value form has no input[name=name]");
    chk("pv-form-no-stray-full_name-input", !form.querySelector("[name=full_name]"), "input[name=full_name] would post null");
    const homeBand = await go("#/home", 1700).then(() => document.querySelector("#sf-contact"));
    chk("home-band-links-to-request-form", !!(homeBand && homeBand.querySelector('a[href="#/property-value?go=form"]')) && !homeBand.querySelector("[data-sf-consult]"), "home band should link straight to the form, not repeat it");
    await go("#/property-value", 1500);
    chk("pv-no-obligation-note", /no obligation/i.test(document.querySelector(".sf-pv").textContent), "missing no-obligation note");
    chk("pv-no-false-claims", !/\d+\s*(properties sold|clients|homes sold|happy families)/i.test(document.querySelector(".sf-pv").textContent), "fabricated stat found");

    /* ---- services section on home, generated from the same array ---- */
    await go("#/home", 1800);
    const svcSection = document.getElementById("sf-services");
    chk("home-services-section", !!svcSection, "no #sf-services");
    const svcCards = svcSection ? Array.from(svcSection.querySelectorAll(".sf-service-card")) : [];
    chk("home-services-nine-cards", svcCards.length === 9, "cards=" + svcCards.length);
    /* The nav dropdown and the homepage section must offer the same set of
       destinations, or the marketing copy silently diverges from the nav. */
    const svcHrefs = svcCards.map(a => a.getAttribute("href")).sort().join("|");
    const dropHrefs = Array.from(svc.querySelectorAll(".sf-drop-panel a:not(.sf-drop-all)")).map(a => a.getAttribute("href")).sort().join("|");
    chk("home-services-match-nav", svcHrefs === dropHrefs, "section=" + svcHrefs + " nav=" + dropHrefs);
    chk("home-services-tour-link", !!svcSection.querySelector('.sf-services-tour a[href="services-3d.html"]'), "");
    chk("home-services-no-dead-links", svcCards.every(a => (a.getAttribute("href") || "").length > 3), "empty href");

    /* ---- #/home?section=services must actually scroll to it ---- */
    window.scrollTo(0, 0);
    await go("#/home?section=services", 1900);
    await wait(700);
    chk("section-scroll-moved", window.scrollY > 50, "scrollY=" + window.scrollY);
    chk("section-scroll-target-visible", (() => {
      /* Re-query: navigating re-renders home(), so the element captured earlier
         is now detached and its rect is all zeros. */
      const fresh = document.getElementById("sf-services");
      if (!fresh) return false;
      const r = fresh.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    })(), "services section not in viewport after scroll");
    chk("section-scroll-target-near-top", (() => {
      const fresh = document.getElementById("sf-services");
      if (!fresh) return false;
      const top = fresh.getBoundingClientRect().top;
      return Math.abs(top) < 200;
    })(), "services section not settled near the top of the viewport");
    await go("#/home", 1500);

    /* ---- sticky mobile CTA present ---- */
    chk("bottom-action-bar-removed", !document.querySelector("[data-sf-sticky]"), "no fixed bottom actions");
    chk("bottom-call-action-removed", !document.querySelector("[data-sf-sticky-call]"), "no fixed call action");
    chk("no-sticky-space-reservation", !document.body.classList.contains("sf-has-sticky"), "no bottom-bar spacing class");

    /* ---- stylesheet actually loaded ---- */
    chk("storefront-css-loaded", Array.from(document.styleSheets).some(s => (s.href || "").indexOf("storefront.css") > -1), "storefront.css not in document");
    /* .sr-only is a visually-hidden label helper, so assert the RULE exists in
       the loaded stylesheet rather than looking for an element on this page. */
    let srOnlyRule = false;
    try {
      const sheet = Array.from(document.styleSheets).find(s => (s.href || "").indexOf("storefront.css") > -1);
      if (sheet) {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule.selectorText && rule.selectorText.indexOf(".sr-only") > -1 && /position:\s*absolute/.test(rule.style.cssText)) { srOnlyRule = true; break; }
        }
      }
    } catch (e) { /* cross-origin sheet */ }
    chk("sr-only-rule-defined", srOnlyRule, "no .sr-only visually-hidden rule in storefront.css");
    chk("sr-only-hides-label-text", (() => {
      const back = document.createElement("span");
      back.className = "sr-only"; back.textContent = "x";
      document.querySelector(".sf-site").appendChild(back);
      const w = back.getBoundingClientRect().width;
      back.remove();
      return w <= 1;
    })(), "sr-only element is not visually hidden");
  } catch (e) {
    window.__msChecks.push({ name: "runner", ok: false, detail: (e && e.message || e) });
  }
  window.__msOk = window.__msChecks.every(c => c.ok);
  window.__msDone = true;
})();
